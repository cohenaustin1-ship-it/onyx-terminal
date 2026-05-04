# Onyx Terminal — Integrated Architecture

This repo contains four components that together form the full Onyx Terminal platform:

```
┌─────────────────────────────────────────────────────────┐
│  Onyx Terminal SPA  (Vercel — pure presentation)        │
│  React + Vite + Tailwind                                │
│  • Charts, widgets, order entry, social feed            │
│  • Talks to backends via VITE_*_API_URL env vars        │
│  • Degrades gracefully if backends unavailable          │
└──┬─────────────┬──────────────┬─────────────────────────┘
   │ market data │ AI / agent   │ trade execution
   ▼             ▼              ▼
┌──────────┐ ┌──────────┐ ┌────────────────┐
│  Tick    │ │ Agent    │ │  Executor      │
│  service │ │ gateway  │ │  service       │
│  Python  │ │ Node     │ │  Node          │
│  DuckDB  │ │ Memory   │ │  Postgres      │
└──────────┘ └──────────┘ └────────────────┘
```

## What's where

| Path | What it is |
|---|---|
| `JPMOnyxTerminal.jsx` | The SPA — single file, ~40k lines, builds via Vite |
| `services/tick-ingestion/` | Python + DuckDB + FastAPI tick recorder + query API |
| `services/executor/` | Node + Postgres strategy executor with safety-check + audit |
| `services/agent/` | Node LLM gateway + cron skills + Telegram + tool calls |
| `docker-compose.yml` | Brings up all 3 backends + Postgres |
| `Makefile` | `make dev`, `make check`, `make spa`, etc. |

## Run the whole stack locally

Prereqs: Docker, Node 20+, npm.

```bash
# 1. Start the 3 backends + Postgres
make dev    # auto-creates .env files from .example, then `docker compose up`

# 2. In a second terminal — run the SPA dev server
make spa    # = npm run dev, opens at http://localhost:5173

# 3. Verify health
make check  # curls /health on all 3 services
```

The SPA's StatusBar shows three colored dots — TICK, EXEC, AGENT — that go green when each service is reachable.

## Configure the SPA to use the backends

Copy `.env.local.example` to `.env.local` and uncomment the backend URLs:

```
VITE_TICK_API_URL=http://localhost:8001
VITE_EXECUTOR_API_URL=http://localhost:8002
VITE_ZEROCLAW_GATEWAY_URL=http://localhost:7777
VITE_BACKEND_AUTH_TOKEN=dev_local_token_change_me   # must match each service's AUTH_TOKEN
```

When all three are unset, the SPA works exactly as it always has — pure simulated paper trading. When set, each backend takes priority over the public-API fallback path.

## What each service does in detail

### `services/tick-ingestion/` — Phase 1

Real-time market-data recorder + query API. **Read [its README](services/tick-ingestion/README.md)** for full details.

Highlights:
- Real Coinbase WebSocket producer captures every executed BTC-USD / ETH-USD / SOL-USD trade
- DuckDB-backed OHLC aggregation in SQL — sub-50ms even at 10M+ ticks
- `/data/{symbol}` for raw ticks, `/ohlc/{symbol}?interval=5m` for bars
- WebSocket fan-out at `/stream/{symbol}` so 100 SPA tabs don't each open their own Coinbase connection
- Hyperliquid producer is a stub — that protocol needs domain work

Wire-up: SPA's `usePriceFeed` checks the tick API first, falls through to public Coinbase WS / Polygon REST.

### `services/executor/` — Phase 2

Server-side strategy evaluation, safety-check gates, broker execution, audit trail. **Read [its README](services/executor/README.md)**.

Highlights:
- Real indicator engine (EMA/RSI/VWAP/MACD/Bollinger/ATR) ported from `bot.js`
- Real safety-check engine — every entry rule evaluated, structured pass/fail returned
- Real Alpaca paper broker (Bitget stubbed)
- Real Postgres schema with strategies/runs/trades/positions
- Real cron at 1m/5m/15m/1h intervals
- Real WebSocket event bus broadcasting fill/signal/rejection events
- Trades dual-written to Postgres + `trades.csv` for tax-ready audit

Wire-up: SPA's strategies widget switches to real strategies when executor connects, with Auto-execute toggle, Run safety check button, and a structured modal showing pass/fail per condition. The Execution Log page lists every run.

### `services/agent/` — Phase 3

LLM gateway + multi-channel notifications + cron-driven skills. ZeroClaw-style but a focused subset (~600 lines Node, not 50k Rust). **Read [its README](services/agent/README.md)**.

Highlights:
- Real provider chain: Anthropic → OpenAI → Ollama (each with retry logic)
- Real tool calling — 6 tools wired to tick/executor APIs
- Real Telegram via Bot API
- Real SSE web channel for browser push
- Persistent file-backed memory (swap to Postgres for prod)
- Cron skills: morning brief at 8:30 ET, position monitor every 30 min during market hours
- Event-driven skill: subscribes to executor's WebSocket and fans events out to user's preferred channels

Wire-up: SPA's `callAI` checks the agent gateway before falling through to Anthropic-direct. Settings → Notifications panel persists prefs to the agent. Status indicators show connection state.

## The chart-and-bot decoupling pattern

This is important and worth understanding:

> **The bot doesn't read pixels off your chart. It doesn't call into your React component. It doesn't need your tab to be open.**

Both the chart and the bot pull from the same tick API. Both compute EMA(8) and arrive at the same number, deterministically. The bot fires on cron, evaluates indicators server-side, and broadcasts events to the SPA via WebSocket. The chart paints those events as annotations.

This is what makes algorithmic trading actually work when the tab is closed, when the laptop is asleep, and when 100 users hit it at once.

## Production hardening — what's there now

| Item | Status |
|---|---|
| TLS on backend services | Not configured — terminate at reverse proxy (Caddy/Cloudflare) |
| **JWT auth** | ✅ HS256 self-signed JWTs, per-user data isolation across all 3 services. Skeleton: no password verification, no email — replace with Clerk/Supabase before going live |
| **Rate limiting** | ✅ Per-IP, per-minute caps on every endpoint. Tunable via env vars (`RATE_LIMIT_PUBLIC`, `RATE_LIMIT_READ`, `RATE_LIMIT_WRITE`, `RATE_LIMIT_LLM`) |
| **Sentry / error tracking** | ✅ SDK wired on all 3 services. Set `SENTRY_DSN` env var to activate. Captures errors + 10% of traces in prod. Free tier covers 5k events/month |
| Database backups | Not done — DuckDB has no replication |
| Position reconciliation against broker | Not done — DB is source of truth |
| Stop-loss order placement | Not done — entry rules only today |
| Discord / email / iMessage / voice channels | Stubs — adapter framework in place |
| Hyperliquid producer | Stub — protocol needs domain work |
| Bitget broker | Stub — port from `bot.js` and test on testnet |

## How auth works now

The three services share the same JWT secret (set `JWT_SECRET` to the same value in all three `.env` files). A token issued by any service works on all three. Two ways to authenticate:

**JWT (preferred):** SPA hits `POST /auth/login` with `{username}`, gets back a token, stores in localStorage. All subsequent calls use `Authorization: Bearer <jwt>`. Per-user data isolation is enforced server-side: `/strategies` returns only YOUR strategies, `/runs` only your runs, etc.

**Legacy bearer (backwards-compat):** If `LEGACY_AUTH_TOKEN` is set on a service, the SPA's `VITE_BACKEND_AUTH_TOKEN` env value is accepted alongside JWTs. This keeps existing dev setups working. To force JWT-only, leave `LEGACY_AUTH_TOKEN` empty in production.

**Inside the SPA:** Settings → Backend services has a "Sign in" row. Type a username, click Sign in, the JWT is stored. All backend calls switch to using it. The status indicator shows `jwt` (green) vs `legacy` (amber) vs `none` (grey) so you always know which path the SPA is taking.

## How to set up Sentry

1. Sign up at https://sentry.io (free tier is plenty for early stage)
2. Create three projects: `onyx-tick-ingestion`, `onyx-executor`, `onyx-agent`
3. Copy the DSN from each project into the corresponding service's `.env`:
   - `services/tick-ingestion/.env` → `SENTRY_DSN=https://...`
   - `services/executor/.env` → `SENTRY_DSN=https://...`
   - `services/agent/.env` → `SENTRY_DSN=https://...`
4. Restart the services. Sentry initializes on boot if the DSN is present, no-op otherwise.

Frontend Sentry (in the SPA) is not wired yet — you'd need to install `@sentry/react`, call `Sentry.init()` in `src/main.jsx`, and read `VITE_SENTRY_DSN` from env. Standard setup, ~10 minutes of work.

## How rate limiting works

Three tiers per service:
- `public` (120/min) — `/health`, `/auth/*`, anything browser-pollable
- `read` (60/min) — GET endpoints
- `write` (20/min) — POST/PATCH/DELETE
- `llm` (15/min, agent only) — `/agent/chat` since each call costs Anthropic dollars

Counts are per-IP. Set `trust proxy` is on, so `X-Forwarded-For` is honored when behind Cloudflare/Caddy/Railway. Override defaults via `RATE_LIMIT_PUBLIC`, `RATE_LIMIT_READ`, etc. env vars.

## Production hardening — what's still NOT done

The current implementation is honest about what's there and what isn't:

| Item | Status |
|---|---|
| TLS on backend services | Not configured — terminate at reverse proxy |
| JWT / per-user auth | Not done — single shared bearer token |
| Rate limiting | Not done — add at LB or Express middleware |
| Sentry / error tracking | Not done |
| Database backups | Not done — DuckDB has no replication |
| Position reconciliation against broker | Not done — DB is source of truth |
| Stop-loss order placement | Not done — entry rules only today |
| Discord / email / iMessage / voice channels | Stubs — adapter framework in place |
| Hyperliquid producer | Stub — protocol needs domain work |
| Bitget broker | Stub — port from `bot.js` and test on testnet |

These are real, multi-week pieces of work each. The current repo is a fully working development stack you can iterate on.

## Cost estimate (rough, 100 active users)

| Item | Monthly |
|---|---|
| Hetzner CX22 (tick + agent on one box) | $5 |
| Railway / Fly.io (executor + Postgres) | $25 |
| Polygon Stocks+Options Starter | $30 |
| Anthropic API (with provider fallback to OpenAI) | $50 |
| **Total** | **~$110/mo for 100 users = $1.10/user** |

## Deployment paths

- **SPA** → Vercel (already configured, just `vercel deploy`)
- **Tick service** → Hetzner / DigitalOcean droplet, run via Docker
- **Executor + Postgres** → Railway, Fly.io, or any Docker host
- **Agent** → same box as tick service (idle most of the time)

Each is an independent deploy. Outages in one don't take the others down.

## Legal / regulatory note

Auto-executing real trades crosses a line that paper trading does not. Before flipping `BROKER_ADAPTER` to anything other than `paper`:
- Clear ToS that explicitly addresses algorithmic trading
- Disclaimer that paper performance ≠ live
- Per-user trading agreement signed before auto-exec is enabled
- Talk to a securities lawyer in your jurisdiction

For paper trading and notifications-only, none of this applies.
