// ─── Onyx Agent — gateway entry point ────────────────────────────────────
import 'dotenv/config';
import { initSentry, Sentry } from './sentry.js';
initSentry({ service: 'onyx-agent' });

import express from 'express';
import crypto from 'crypto';

import { LLMChain } from './llm.js';
import { TOOL_SPECS, executeTool } from './tools.js';
import { startSkills } from './skills.js';
import * as memory from './memory.js';
import { notify, getChannelStatus } from './channels/index.js';
import * as telegram from './channels/telegram.js';
import * as web from './channels/web.js';
import { requireAuth, signToken } from './auth.js';
import { publicLimiter, readLimiter, writeLimiter, llmLimiter } from './rateLimits.js';

const PORT = parseInt(process.env.PORT || '7777', 10);
const LEGACY_TOKEN = process.env.LEGACY_AUTH_TOKEN || process.env.AUTH_TOKEN || '';

const llm = new LLMChain();
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Public ──────────────────────────────────────────────────────────────
app.get('/health', publicLimiter, (req, res) => {
  res.json({
    service: 'onyx-agent',
    version: '0.1.0',
    ts: Date.now(),
    llm: llm.status(),
    channels: getChannelStatus(),
    users: memory.listUsers().length,
    auth_modes: ['jwt', 'legacy'],
  });
});

// Auth endpoints (skeleton)
app.post('/auth/register', publicLimiter, async (req, res) => {
  const { username, name } = req.body || {};
  if (!username || !/^[a-z0-9_-]{3,32}$/i.test(username)) {
    return res.status(400).json({ error: 'username must be 3-32 chars, alphanumeric + _ -' });
  }
  memory.upsertUser(username, { username, name: name || username, created_at: Date.now() });
  const token = await signToken({ userId: username, name: name || username });
  res.json({ token, userId: username });
});

app.post('/auth/login', publicLimiter, async (req, res) => {
  const { username, name } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  const token = await signToken({ userId: username, name: name || username });
  res.json({ token, userId: username });
});

// ─── SSE endpoint for web channel ────────────────────────────────────────
// SPA opens an EventSource here. Auth via ?token= since EventSource can't
// set headers. Token can be a JWT or the legacy shared bearer.
app.get('/channels/web/stream', publicLimiter, async (req, res) => {
  const token = req.query.token;
  let userId = null;
  // JWT first
  try {
    const { jwtVerify } = await import('jose');
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret');
    const { payload } = await jwtVerify(token, secret);
    userId = payload.sub;
  } catch {
    if (LEGACY_TOKEN && token === LEGACY_TOKEN) {
      userId = req.query.user_id || 'default';
    }
  }
  if (!userId) return res.status(401).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: {"type":"connected"}\n\n`);
  web.subscribe(userId, res);
  const hb = setInterval(() => {
    try { res.write(`: heartbeat\n\n`); } catch {}
  }, 30000);
  req.on('close', () => clearInterval(hb));
});

// ─── Authenticated ───────────────────────────────────────────────────────
app.use(requireAuth);

// LLM chat endpoint — OpenAI-compatible shape so the SPA can swap from
// calling Anthropic direct to calling this gateway with no client-side
// changes beyond the URL.
app.post('/agent/chat', llmLimiter, async (req, res) => {
  const { messages, model, system, max_tokens, use_tools = false } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be array' });
  // user_id comes from auth, NEVER from the body
  const userId = req.userId;
  try {
    const opts = { model, system, max_tokens };
    if (use_tools) opts.tools = TOOL_SPECS;
    const result = await llm.chat(messages, opts);
    if (userId) {
      memory.appendConversation(userId, 'user', messages[messages.length - 1].content);
      memory.appendConversation(userId, 'assistant', result.content);
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tool execution endpoint — used by skills, also exposed for the SPA
// if you want to invoke tools from client code without a full chat round-trip
app.post('/agent/tool', writeLimiter, async (req, res) => {
  const { name, input } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = await executeTool(name, input);
  res.json(result);
});

app.get('/agent/tools', readLimiter, (req, res) => {
  res.json({ tools: TOOL_SPECS });
});

// ─── YouTube search proxy ───────────────────────────────────────────────
// Server-side proxy so the YOUTUBE_API_KEY never reaches the browser.
// The client posts { q, max_results } and gets back a normalized list of
// { videoId, title, channel, thumbnail, publishedAt }. If YOUTUBE_API_KEY
// isn't set, the route returns an explanatory error so the frontend can
// surface it to the user instead of failing silently.
//
// Quota: each search costs 100 units against the YouTube Data API
// (10,000 units/day default). At 100 units per call that's 100 searches
// per day — fine for a small user base; consider caching at this layer
// or upgrading the quota for production scale.
app.post('/youtube/search', readLimiter, async (req, res) => {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'YOUTUBE_API_KEY not configured on agent service',
    });
  }
  const { q, max_results = 8 } = req.body || {};
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return res.status(400).json({ error: 'q (query string) required' });
  }
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    q: q.trim(),
    maxResults: String(Math.min(Math.max(max_results, 1), 25)),
    key: apiKey,
    // safeSearch=moderate filters egregious content; relevanceLanguage
    // biases (not restricts) toward English. Tweak as needed.
    safeSearch: 'moderate',
    relevanceLanguage: 'en',
  });
  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: 'YouTube API error', detail: errText.slice(0, 500) });
    }
    const data = await r.json();
    // Normalize the response into the shape the client expects. We
    // collapse the relative time formatting into something compact
    // ("3d ago", "2w ago", "5mo ago") so the client doesn't need a
    // date library.
    const items = (data.items || []).map(it => {
      const sn = it.snippet || {};
      const ago = (() => {
        const d = sn.publishedAt ? new Date(sn.publishedAt) : null;
        if (!d || isNaN(d.getTime())) return '';
        const diffMs = Date.now() - d.getTime();
        const min = Math.floor(diffMs / 60000);
        if (min < 60)        return `${min}m ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24)         return `${hr}h ago`;
        const day = Math.floor(hr / 24);
        if (day < 7)         return `${day}d ago`;
        const wk = Math.floor(day / 7);
        if (wk < 5)          return `${wk}w ago`;
        const mo = Math.floor(day / 30);
        if (mo < 12)         return `${mo}mo ago`;
        return `${Math.floor(day / 365)}y ago`;
      })();
      return {
        videoId: it.id?.videoId,
        title: sn.title,
        channel: sn.channelTitle,
        // Prefer medium thumbnail (320×180) — fits the result row well
        // without bloating the response payload.
        thumbnail: sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url ?? null,
        publishedAt: ago,
      };
    }).filter(x => x.videoId);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// User memory — own-data only. Path param ignored, req.userId is canonical.
// (Admins would need a separate endpoint with role-based access.)
app.get('/users/me', readLimiter, (req, res) => {
  const user = memory.getUser(req.userId);
  res.json({ user, exists: !!user });
});

app.patch('/users/me', writeLimiter, (req, res) => {
  const updated = memory.upsertUser(req.userId, req.body);
  res.json(updated);
});

app.get('/users/me/prefs', readLimiter, (req, res) => {
  res.json(memory.getNotificationPrefs(req.userId));
});

app.patch('/users/me/prefs', writeLimiter, (req, res) => {
  const prefs = memory.setNotificationPrefs(req.userId, req.body);
  res.json(prefs);
});

app.get('/users/me/history', readLimiter, (req, res) => {
  const limit = parseInt(req.query.limit || '20', 10);
  res.json({ history: memory.getConversation(req.userId, limit) });
});

// Backward-compat /users/:userId — only returns the requester's own data.
// Reject if param doesn't match the authed user.
app.get('/users/:userId', readLimiter, (req, res) => {
  if (req.params.userId !== req.userId) return res.status(403).json({ error: 'not your user' });
  const user = memory.getUser(req.userId);
  res.json({ user, exists: !!user });
});

app.patch('/users/:userId', writeLimiter, (req, res) => {
  if (req.params.userId !== req.userId) return res.status(403).json({ error: 'not your user' });
  const updated = memory.upsertUser(req.userId, req.body);
  res.json(updated);
});

app.get('/users/:userId/prefs', readLimiter, (req, res) => {
  if (req.params.userId !== req.userId) return res.status(403).json({ error: 'not your user' });
  res.json(memory.getNotificationPrefs(req.userId));
});

app.patch('/users/:userId/prefs', writeLimiter, (req, res) => {
  if (req.params.userId !== req.userId) return res.status(403).json({ error: 'not your user' });
  const prefs = memory.setNotificationPrefs(req.userId, req.body);
  res.json(prefs);
});

app.get('/users/:userId/history', readLimiter, (req, res) => {
  if (req.params.userId !== req.userId) return res.status(403).json({ error: 'not your user' });
  const limit = parseInt(req.query.limit || '20', 10);
  res.json({ history: memory.getConversation(req.userId, limit) });
});

// Channels — register Telegram chat-id for THIS user only
app.post('/channels/telegram/register', writeLimiter, (req, res) => {
  const { chat_id } = req.body;
  if (!chat_id) return res.status(400).json({ error: 'chat_id required' });
  res.json(telegram.registerUser(req.userId, chat_id));
});

app.get('/channels/status', readLimiter, (req, res) => {
  res.json(getChannelStatus());
});

// Notification sender — invoked by the executor when something happens
// (or directly by the SPA for testing). Always sent to req.userId.
app.post('/notify', writeLimiter, async (req, res) => {
  const { event_type, message, payload } = req.body;
  if (!event_type || !message) {
    return res.status(400).json({ error: 'event_type, message required' });
  }
  const result = await notify(req.userId, event_type, message, payload);
  res.json(result);
});

// Global error handler with Sentry capture
app.use((err, req, res, next) => {
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}]`, err);
  if (Sentry) Sentry.captureException(err, { tags: { request_id: requestId } });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'internal error' : err.message,
    request_id: requestId,
  });
});

// ─── Boot ────────────────────────────────────────────────────────────────
async function main() {
  // Try to auto-discover Telegram users who messaged the bot
  if (telegram.isConfigured()) {
    const found = await telegram.pollUpdates();
    if (found.length) console.log(`[telegram] auto-registered ${found.length} users`);
  }

  startSkills();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[agent] listening on :${PORT}`);
    console.log(`[agent] LLM providers: ${llm.status().available.join(', ') || 'none'}`);
    console.log(`[agent] channels: ${JSON.stringify(getChannelStatus())}`);
  });
}

main().catch(e => {
  console.error('[agent] fatal:', e);
  process.exit(1);
});
