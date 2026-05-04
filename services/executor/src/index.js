// ─── Executor HTTP API + main entry ──────────────────────────────────────
import 'dotenv/config';
import { initSentry, Sentry } from './sentry.js';
initSentry({ service: 'onyx-executor' });   // must run before express import paths capture errors

import express from 'express';
import http from 'http';
import crypto from 'crypto';

import { initSchema, query, shutdown as dbShutdown } from './db.js';
import { runStrategy } from './executor.js';
import { startCronJobs } from './cron.js';
import { attachWsServer, broadcastSnippetWs } from './eventBus.js';
import { streamCsv, getRecentRuns } from './audit.js';
import { getTickHealth } from './tickClient.js';
import { requireAuth, signToken } from './auth.js';
import { publicLimiter, readLimiter, writeLimiter } from './rateLimits.js';
import { createBroker } from './brokers/index.js';

const PORT = parseInt(process.env.PORT || '8002', 10);

const app = express();
app.set('trust proxy', 1);  // honor X-Forwarded-For when behind a proxy
app.use(express.json({ limit: '256kb' }));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Public ─────────────────────────────────────────────────────────────
app.get('/health', publicLimiter, async (req, res) => {
  let dbOk = false;
  try {
    await query('SELECT 1');
    dbOk = true;
  } catch {}
  const tickHealth = await getTickHealth();
  res.json({
    service: 'onyx-executor',
    version: '0.1.0',
    ts: Date.now(),
    db_connected: dbOk,
    tick_api_connected: !!tickHealth,
    broker: process.env.BROKER_ADAPTER || 'paper',
    auth_modes: ['jwt', 'legacy'],
  });
});

// ─── Auth endpoints (public — no token required to acquire one) ──────────
// HONEST SCOPE: These are skeleton endpoints for the JWT system. Real
// production would require a real auth provider (Clerk, Supabase Auth).
// /auth/register here is registration-by-username only — no password,
// no email verification.

app.post('/auth/register', publicLimiter, async (req, res) => {
  const { username, name } = req.body || {};
  if (!username || !/^[a-z0-9_-]{3,32}$/i.test(username)) {
    return res.status(400).json({ error: 'username must be 3-32 chars, alphanumeric + _ -' });
  }
  // Persist a no-op user record so subsequent calls find one. We don't
  // actually need users table for the executor — it's just an audit trail.
  try {
    await query(`
      INSERT INTO strategies (user_id, name, symbol, interval, entry_rules, enabled)
      VALUES ($1, '__welcome__', 'BTC', '1h', '[]'::jsonb, FALSE)
      ON CONFLICT DO NOTHING
    `, [username]);
  } catch {}
  const token = await signToken({ userId: username, name: name || username });
  res.json({ token, userId: username });
});

app.post('/auth/login', publicLimiter, async (req, res) => {
  // No password verification — this is a skeleton. Real prod: verify hash.
  const { username, name } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  const token = await signToken({ userId: username, name: name || username });
  res.json({ token, userId: username });
});

// ─── Authenticated ──────────────────────────────────────────────────────
// Per-user data isolation: every authed handler reads req.userId from auth
// middleware and ignores any user_id in the query. JWT auth is canonical.
app.use(requireAuth);

// Strategies CRUD
app.get('/strategies', readLimiter, async (req, res) => {
  // req.userId is set by requireAuth — canonical, can't be overridden
  const userId = req.userId;
  const { rows } = await query('SELECT * FROM strategies WHERE user_id=$1 ORDER BY id', [userId]);
  res.json({ strategies: rows });
});

app.post('/strategies', writeLimiter, async (req, res) => {
  const userId = req.userId;
  const { name, symbol, interval, side = 'long',
          entry_rules, exit_rules = [], risk_rules = {} } = req.body;
  if (!name || !symbol || !interval || !entry_rules) {
    return res.status(400).json({ error: 'missing required fields' });
  }
  const { rows } = await query(`
    INSERT INTO strategies
      (user_id, name, symbol, interval, side, entry_rules, exit_rules, risk_rules)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
  `, [userId, name, symbol, interval, side,
      JSON.stringify(entry_rules), JSON.stringify(exit_rules), JSON.stringify(risk_rules)]);
  res.json(rows[0]);
});

app.patch('/strategies/:id', writeLimiter, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  // Verify ownership before allowing update
  const owned = await query('SELECT user_id FROM strategies WHERE id=$1', [id]);
  if (!owned.rows[0]) return res.status(404).json({ error: 'not found' });
  if (owned.rows[0].user_id !== req.userId) {
    return res.status(403).json({ error: 'not your strategy' });
  }
  const fields = ['name', 'symbol', 'interval', 'side', 'auto_execute', 'enabled'];
  const updates = [];
  const values = [];
  let idx = 1;
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = $${idx++}`);
      values.push(req.body[f]);
    }
  }
  if (req.body.entry_rules !== undefined) {
    updates.push(`entry_rules = $${idx++}`);
    values.push(JSON.stringify(req.body.entry_rules));
  }
  if (!updates.length) return res.status(400).json({ error: 'no fields to update' });
  updates.push(`updated_at = NOW()`);
  values.push(id);
  const { rows } = await query(
    `UPDATE strategies SET ${updates.join(', ')} WHERE id=$${idx} RETURNING *`,
    values,
  );
  res.json(rows[0]);
});

app.delete('/strategies/:id', writeLimiter, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const owned = await query('SELECT user_id FROM strategies WHERE id=$1', [id]);
  if (!owned.rows[0]) return res.status(404).json({ error: 'not found' });
  if (owned.rows[0].user_id !== req.userId) {
    return res.status(403).json({ error: 'not your strategy' });
  }
  await query('DELETE FROM strategies WHERE id=$1', [id]);
  res.json({ deleted: id });
});

// Manual safety check (no execution)
app.post('/strategies/:id/safety-check', writeLimiter, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const owned = await query('SELECT user_id FROM strategies WHERE id=$1', [id]);
  if (!owned.rows[0]) return res.status(404).json({ error: 'not found' });
  if (owned.rows[0].user_id !== req.userId) {
    return res.status(403).json({ error: 'not your strategy' });
  }
  // Run with auto_execute=force=false flag — safety check only
  try {
    const result = await runStrategy(id, { force: false });
    const { rows } = await query(
      'SELECT safety_check, indicator_values, decision, blocker FROM strategy_runs WHERE id=$1',
      [result.run_id],
    );
    res.json({
      run_id: result.run_id,
      decision: result.decision,
      ...rows[0],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual run (with execution if auto_execute=true OR force=true)
app.post('/strategies/:id/run', writeLimiter, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const owned = await query('SELECT user_id FROM strategies WHERE id=$1', [id]);
  if (!owned.rows[0]) return res.status(404).json({ error: 'not found' });
  if (owned.rows[0].user_id !== req.userId) {
    return res.status(403).json({ error: 'not your strategy' });
  }
  try {
    const result = await runStrategy(id, { force: req.body.force === true });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Toggle auto-execute
app.post('/strategies/:id/enable-auto', writeLimiter, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const owned = await query('SELECT user_id FROM strategies WHERE id=$1', [id]);
  if (!owned.rows[0]) return res.status(404).json({ error: 'not found' });
  if (owned.rows[0].user_id !== req.userId) {
    return res.status(403).json({ error: 'not your strategy' });
  }
  const { rows } = await query(
    'UPDATE strategies SET auto_execute=$1 WHERE id=$2 RETURNING *',
    [req.body.enabled !== false, id],
  );
  res.json(rows[0]);
});

// Recent runs (execution log) — scoped to authed user
app.get('/runs', readLimiter, async (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  const runs = await getRecentRuns(req.userId, limit);
  res.json({ runs });
});

// Trades — scoped to authed user
app.get('/trades', readLimiter, async (req, res) => {
  const limit = parseInt(req.query.limit || '500', 10);
  const { rows } = await query(`
    SELECT * FROM trades WHERE user_id=$1
    ORDER BY filled_at DESC LIMIT $2
  `, [req.userId, limit]);
  res.json({ trades: rows });
});

app.get('/trades.csv', readLimiter, async (req, res) => {
  // CSV download — server-side filtering by userId would require streaming
  // a filtered version. For now this is the global CSV — mark as TODO.
  // Real prod: stream a filtered query via pg's COPY TO.
  await streamCsv(res);
});

// Positions (computed view) — scoped
app.get('/positions', readLimiter, async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM positions WHERE user_id=$1', [req.userId]
  );
  res.json({ positions: rows });
});

// ─── Calendar events SSE stream ──────────────────────────────────────────
// Push-based delivery for upcoming earnings, macro events, and announcements.
// Frontend subscribes via EventSource; events are appended to a server-side
// in-memory buffer + broadcast to all active SSE clients.
//
// GET  /events/stream    — Server-Sent Events feed of new events
// GET  /events/recent    — Polling fallback for browsers w/o EventSource
// POST /events/announce  — Internal endpoint to push an event (cron / scanner)

const eventBuffer = []; // last 100 events, in-memory
const sseClients = new Set();

const broadcastEvent = (event) => {
  // Sanity check + assign id if missing
  if (!event || !event.title) return;
  if (!event.id) event.id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!event.ts) event.ts = Date.now();
  // Append to buffer
  eventBuffer.unshift(event);
  if (eventBuffer.length > 100) eventBuffer.length = 100;
  // Push to all active SSE clients
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch {}
  }
};

app.get('/events/stream', readLimiter, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders?.();
  // Send initial comment to open the stream
  res.write(': connected\n\n');
  // Replay last 5 events on connect so clients catch up if they
  // missed pushes during a reconnect window
  for (const e of eventBuffer.slice(0, 5)) {
    try { res.write(`data: ${JSON.stringify(e)}\n\n`); } catch {}
  }
  sseClients.add(res);
  // Keep-alive ping every 25 seconds (under typical proxy idle timeout)
  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 25_000);
  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
    try { res.end(); } catch {}
  });
});

app.get('/events/recent', readLimiter, (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  res.json({ events: eventBuffer.slice(0, limit) });
});

app.post('/events/announce', writeLimiter, (req, res) => {
  const { type, ticker, title, body, fireNotification } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title required' });
  }
  const event = {
    type: type || 'announcement',
    ticker: ticker ? String(ticker).slice(0, 10).toUpperCase() : undefined,
    title: title.slice(0, 200),
    body: body ? String(body).slice(0, 1000) : '',
    fireNotification: fireNotification !== false,
  };
  broadcastEvent(event);
  res.json({ ok: true, id: event.id });
});

// ─── NAV history endpoints ───────────────────────────────────────────────
// Backend persistence for the daily portfolio NAV time series. Replaces
// (or augments) the localStorage NAV the frontend maintains under the
// 'imo_nav_history' key. Cross-device continuity + survives cache clears.
//
// GET  /nav        — returns recent NAV history (default last 90d, max 365)
// POST /nav        — upsert one NAV reading for today (or specified date)
// POST /nav/import — bulk-import legacy localStorage NAV rows
// DELETE /nav      — clear all NAV history for current user
  res.json({ nav: rows });
});

app.post('/nav', writeLimiter, async (req, res) => {
  const { nav, asOfDate, cash, invested, deposits, source } = req.body || {};
  const navNum = Number(nav);
  if (!Number.isFinite(navNum) || navNum < 0) {
    return res.status(400).json({ error: 'nav must be a non-negative number' });
  }
  // Default to today if no date provided
  const date = asOfDate || new Date().toISOString().slice(0, 10);
  const cashN = cash != null ? Number(cash) : null;
  const investedN = invested != null ? Number(invested) : null;
  const depositsN = deposits != null ? Number(deposits) : 0;
  const sourceVal = (source || 'manual').slice(0, 32);
  // Upsert: one row per (user, date)
  const { rows } = await query(
    `INSERT INTO nav_history (user_id, as_of_date, nav_usd, cash_usd, invested_usd, deposits_usd, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, as_of_date)
     DO UPDATE SET
       nav_usd      = EXCLUDED.nav_usd,
       cash_usd     = COALESCE(EXCLUDED.cash_usd,     nav_history.cash_usd),
       invested_usd = COALESCE(EXCLUDED.invested_usd, nav_history.invested_usd),
       deposits_usd = nav_history.deposits_usd + EXCLUDED.deposits_usd,
       source       = EXCLUDED.source,
       created_at   = NOW()
     RETURNING *`,
    [req.userId, date, navNum, cashN, investedN, depositsN, sourceVal]
  );
  res.json({ ok: true, row: rows[0] });
});

app.post('/nav/import', writeLimiter, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'items array required' });
  }
  if (items.length > 1000) {
    return res.status(400).json({ error: 'max 1000 items per import' });
  }
  let inserted = 0;
  for (const item of items) {
    const navN = Number(item.nav);
    const date = item.asOfDate || item.date;
    if (!Number.isFinite(navN) || navN < 0 || !date) continue;
    try {
      await query(
        `INSERT INTO nav_history (user_id, as_of_date, nav_usd, cash_usd, invested_usd, source)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, as_of_date) DO NOTHING`,
        [
          req.userId, date, navN,
          item.cash != null ? Number(item.cash) : null,
          item.invested != null ? Number(item.invested) : null,
          (item.source || 'import').slice(0, 32),
        ]
      );
      inserted++;
    } catch (e) {
      // Skip bad rows; continue importing the rest
    }
  }
  res.json({ ok: true, inserted, total: items.length });
});

app.delete('/nav', writeLimiter, async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM nav_history WHERE user_id = $1', [req.userId]
  );
  res.json({ ok: true, deleted: rowCount });
});

// ─── Swap endpoint ───────────────────────────────────────────────────────
// Executes a paired sell/buy through the configured broker so the SPA's
// Swap widget can route to a real backend instead of a notification stub.
//
// Request body:
//   { from: 'BTC-PERP', to: 'USD', amount: 0.5, expectedRate: 67_321.0 }
//
// The amount is denominated in `from` units. We compute the to-leg quantity
// from expectedRate (provided by the client to keep slippage transparent)
// and place two orders. The paper broker executes instantly; live brokers
// reject the swap if either leg fails.
//
// HONEST SCOPE: this is a paired-orders implementation, not a true atomic
// swap. If leg 2 fails after leg 1 fills, the user is left holding the
// proceeds from leg 1 — same as if they'd executed two manual trades.
// We surface that risk in the response.
app.post('/swap', writeLimiter, async (req, res) => {
  const { from, to, amount, expectedRate } = req.body || {};
  if (!from || !to || from === to) {
    return res.status(400).json({ error: 'from and to must differ' });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'amount must be positive' });
  }
  const rate = Number(expectedRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return res.status(400).json({ error: 'expectedRate must be positive' });
  }
  const broker = createBroker();
  const fills = [];
  let toAmount = amt * rate;
  try {
    // Leg 1 — sell `from` for cash. USD is special-cased: when from is
    // USD we skip the sell leg (we already have cash) and only place
    // the buy leg.
    if (from !== 'USD') {
      const sellFill = await broker.placeOrder({
        symbol: from, side: 'sell', qty: amt, price: rate,
      });
      fills.push({ leg: 'sell', ...sellFill });
      // If the broker partially filled, scale the buy leg down so we
      // don't try to buy more than we actually got proceeds for.
      if (sellFill.filled_qty < amt) {
        toAmount = sellFill.filled_qty * rate;
      }
    }
    // Leg 2 — buy `to` with the cash from leg 1. USD is the cash leg
    // so we skip the buy when to is USD.
    if (to !== 'USD') {
      const buyFill = await broker.placeOrder({
        symbol: to, side: 'buy', qty: toAmount, price: 1,
      });
      fills.push({ leg: 'buy', ...buyFill });
    }
    res.json({
      ok: true,
      from, to, amount: amt, expectedRate: rate,
      received: toAmount,
      fills,
      broker: broker.name,
      ts: Date.now(),
    });
  } catch (err) {
    // Partial-fill failure surfaces with the legs that did succeed so
    // the client can show users what happened.
    res.status(500).json({
      ok: false,
      error: err?.message || 'swap failed',
      partial_fills: fills,
    });
  }
});

// ─── Global error handler ────────────────────────────────────────────────
// Captures any uncaught error from a route handler. Sentry sees it; client
// gets a generic 500 with a request ID they can quote.
// ─── Snippets (Phase 3p.11 / Addition 1) ─────────────────────────────────
// Cloud-synced snippets with last-write-wins + version-based conflict
// detection. Client sends its known `version`; server rejects mismatches
// with HTTP 409 and the server copy so the client can resolve.

app.get('/snippets', readLimiter, async (req, res) => {
  const userId = req.userId;
  const sinceTs = req.query.sinceTs ? new Date(parseInt(req.query.sinceTs, 10)) : null;
  let sql = 'SELECT * FROM snippets WHERE user_id=$1';
  const params = [userId];
  if (sinceTs && !isNaN(sinceTs.getTime())) {
    sql += ' AND updated_at > $2';
    params.push(sinceTs);
  }
  sql += ' ORDER BY updated_at DESC';
  const { rows } = await query(sql, params);
  res.json({ snippets: rows });
});

app.post('/snippets', writeLimiter, async (req, res) => {
  const userId = req.userId;
  const { client_id, title, body, kind = 'note', tags = [] } = req.body;
  if (!client_id || !title || body === undefined) {
    return res.status(400).json({ error: 'client_id, title, body required' });
  }
  const existing = await query(
    'SELECT * FROM snippets WHERE user_id=$1 AND client_id=$2',
    [userId, client_id],
  );
  if (existing.rows[0]) {
    const clientVersion = parseInt(req.body.version ?? 0, 10);
    if (clientVersion !== existing.rows[0].version) {
      return res.status(409).json({
        error: 'version conflict',
        server: existing.rows[0],
        clientVersion,
      });
    }
    const { rows } = await query(`
      UPDATE snippets
         SET title=$3, body=$4, kind=$5, tags=$6,
             version=version+1, updated_at=NOW()
       WHERE user_id=$1 AND client_id=$2
       RETURNING *
    `, [userId, client_id, title, body, kind, JSON.stringify(tags)]);
    broadcastSnippetEvent(userId, 'snippet-updated', rows[0]); broadcastSnippetWs(userId, 'snippet-updated', rows[0]);
    return res.json(rows[0]);
  }
  const { rows } = await query(`
    INSERT INTO snippets (user_id, client_id, title, body, kind, tags)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [userId, client_id, title, body, kind, JSON.stringify(tags)]);
  broadcastSnippetEvent(userId, 'snippet-created', rows[0]); broadcastSnippetWs(userId, 'snippet-created', rows[0]);
  res.json(rows[0]);
});

// ─── Snippet SSE broadcast (Phase 3p.13 / Feature 3) ─────────────────────
// In-memory pub/sub for snippet change events. Keyed by user_id so we
// only push to subscribers who own the snippet. EventSource clients
// subscribe via GET /snippets/stream and receive write/delete events
// in real time, replacing the 60s poll.
//
// Honest scope:
//   - In-memory only — multiple executor instances won't share
//     subscribers. For HA, swap this for Redis pub/sub.
//   - One-way (server → client). Writes still go through POST.
//   - No reconnection backoff on the server side; the EventSource
//     spec mandates client-side backoff which works fine for our
//     traffic level.
const snippetSubscribers = new Map(); // userId → Set<res>

const broadcastSnippetEvent = (userId, event, payload) => {
  const subs = snippetSubscribers.get(userId);
  if (!subs || subs.size === 0) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of subs) {
    try { res.write(data); }
    catch { subs.delete(res); }
  }
};

app.get('/snippets/stream', (req, res) => {
  // requireAuth has already populated req.userId via the global middleware.
  // SSE headers
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx proxy buffering
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  if (!snippetSubscribers.has(req.userId)) {
    snippetSubscribers.set(req.userId, new Set());
  }
  snippetSubscribers.get(req.userId).add(res);

  // Keepalive ping every 25s (proxies often kill idle connections at 30s)
  const keepalive = setInterval(() => {
    try { res.write(`: keepalive\n\n`); }
    catch { clearInterval(keepalive); }
  }, 25_000);

  req.on('close', () => {
    clearInterval(keepalive);
    const subs = snippetSubscribers.get(req.userId);
    if (subs) {
      subs.delete(res);
      if (subs.size === 0) snippetSubscribers.delete(req.userId);
    }
  });
});

app.delete('/snippets/:client_id', writeLimiter, async (req, res) => {
  const userId = req.userId;
  const clientId = req.params.client_id;
  const { rows } = await query(`
    UPDATE snippets
       SET archived=TRUE, version=version+1, updated_at=NOW()
     WHERE user_id=$1 AND client_id=$2
     RETURNING *
  `, [userId, clientId]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  broadcastSnippetEvent(userId, 'snippet-deleted', rows[0]); broadcastSnippetWs(userId, 'snippet-deleted', rows[0]);
  res.json(rows[0]);
});

// ─── Schwab broker OAuth proxy (Phase 3p.13 / scaffolding closeout) ───
// Server-side helpers for the Schwab OAuth flow. The client redirects
// the user to Schwab's authorize URL, Schwab redirects back to the
// app's callback with a `code`, the client POSTs that code here, and
// we exchange it for tokens using the client_secret which never
// leaves the server.
//
// Required env vars (none committed):
//   SCHWAB_CLIENT_ID
//   SCHWAB_CLIENT_SECRET
//   SCHWAB_REDIRECT_URI       — must match what's registered with Schwab
//
// Honest scope:
//   - Tokens are returned in the response body. The client is
//     responsible for storing them (the existing client module
//     stores them in localStorage with the dirty-bit handling).
//   - We do NOT persist refresh tokens server-side. That's a
//     deliberate choice — if a client gets compromised, only that
//     client loses access; the server has no token store to leak.
//     The trade-off is that signing in on a new device requires
//     re-authorizing through Schwab, not a server-side handoff.
//   - Schwab's API is rate-limited; we do not cache or batch token
//     refresh calls. A user pounding the refresh button will hit
//     Schwab's rate limit before ours.
//   - This is a partial integration. Schwab also requires SSL for
//     the redirect URI in production, MFA enrollment, and a
//     periodic re-consent flow we don't model here.

const SCHWAB_TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token';

const requireSchwabConfig = (res) => {
  if (!process.env.SCHWAB_CLIENT_ID || !process.env.SCHWAB_CLIENT_SECRET) {
    res.status(503).json({
      error: 'schwab not configured',
      detail: 'SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET must be set',
    });
    return false;
  }
  return true;
};

// Exchange an authorization code for an access token.
// Body: { code: string, redirect_uri: string }
// Returns the Schwab token response { access_token, refresh_token,
// expires_in, scope, token_type } verbatim.
app.post('/broker/schwab/exchange', writeLimiter, async (req, res) => {
  if (!requireSchwabConfig(res)) return;
  const { code, redirect_uri } = req.body || {};
  if (!code || !redirect_uri) {
    return res.status(400).json({ error: 'code and redirect_uri required' });
  }
  const expectedRedirect = process.env.SCHWAB_REDIRECT_URI;
  if (expectedRedirect && redirect_uri !== expectedRedirect) {
    return res.status(400).json({ error: 'redirect_uri mismatch' });
  }
  const basic = Buffer.from(
    `${process.env.SCHWAB_CLIENT_ID}:${process.env.SCHWAB_CLIENT_SECRET}`,
  ).toString('base64');
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri,
  });
  try {
    const r = await fetch(SCHWAB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({
        error: body.error || 'schwab token exchange failed',
        error_description: body.error_description,
      });
    }
    // Audit-log a successful exchange. We do NOT log the token itself.
    try {
      console.log(JSON.stringify({
        evt: 'broker.schwab.exchange',
        user_id: req.userId,
        scope: body.scope,
        ts: new Date().toISOString(),
      }));
    } catch {}
    res.json(body);
  } catch (err) {
    res.status(502).json({ error: 'upstream failure', detail: String(err.message || err) });
  }
});

// Refresh an access token using a stored refresh_token.
// Body: { refresh_token: string }
// Returns the new token response. Schwab's refresh tokens are
// rotating, so the response contains a NEW refresh_token the
// client must persist (replacing the old one).
app.post('/broker/schwab/refresh', writeLimiter, async (req, res) => {
  if (!requireSchwabConfig(res)) return;
  const { refresh_token } = req.body || {};
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });
  const basic = Buffer.from(
    `${process.env.SCHWAB_CLIENT_ID}:${process.env.SCHWAB_CLIENT_SECRET}`,
  ).toString('base64');
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token,
  });
  try {
    const r = await fetch(SCHWAB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({
        error: body.error || 'schwab refresh failed',
        error_description: body.error_description,
      });
    }
    res.json(body);
  } catch (err) {
    res.status(502).json({ error: 'upstream failure', detail: String(err.message || err) });
  }
});

// Build the authorize URL the client should redirect the user to.
// This is just convenience — the client has all it needs to build
// it themselves, but having a server endpoint avoids leaking the
// SCHWAB_CLIENT_ID into bundled client code.
app.get('/broker/schwab/authorize-url', (req, res) => {
  if (!requireSchwabConfig(res)) return;
  const state = req.query.state || crypto.randomBytes(16).toString('hex');
  const u = new URL('https://api.schwabapi.com/v1/oauth/authorize');
  u.searchParams.set('client_id', process.env.SCHWAB_CLIENT_ID);
  u.searchParams.set('redirect_uri', process.env.SCHWAB_REDIRECT_URI || '');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'readonly');
  u.searchParams.set('state', state);
  res.json({ url: u.toString(), state });
});

app.use((err, req, res, next) => {
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}]`, err);
  if (Sentry) {
    Sentry.captureException(err, { tags: { request_id: requestId } });
  }
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'internal error' : err.message,
    request_id: requestId,
  });
});

// ─── Boot ────────────────────────────────────────────────────────────────
async function main() {
  // Wait for Postgres to be ready (docker-compose may start us first)
  let attempts = 0;
  while (attempts < 30) {
    try {
      await initSchema();
      break;
    } catch (e) {
      attempts++;
      console.log(`[db] not ready (${attempts}/30), retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (attempts >= 30) {
    console.error('[db] failed to connect after 60s. Exiting.');
    process.exit(1);
  }

  const server = http.createServer(app);
  attachWsServer(server);
  startCronJobs();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[executor] listening on :${PORT}`);
    console.log(`[executor] broker: ${process.env.BROKER_ADAPTER || 'paper'}`);
    console.log(`[executor] tick API: ${process.env.TICK_API_URL}`);
  });

  process.on('SIGTERM', async () => {
    console.log('[executor] SIGTERM, shutting down...');
    server.close();
    await dbShutdown();
    process.exit(0);
  });
}

main().catch(e => {
  console.error('[executor] fatal:', e);
  process.exit(1);
});
