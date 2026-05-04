# IMO Onyx Terminal — Outstanding Work Queue

## Production fixes (April 2026 — latest pass)

- [x] **Anthropic 404 fix** — `callAnthropic` default model updated from deprecated `claude-3-5-haiku-latest` to current `claude-haiku-4-5-20251001`. Restores Analyze button on production deploy.
- [x] **Exa CORS fix (Option A)** — Vercel serverless functions at `api/exa-search.js` and `api/exa-contents.js` proxy Exa requests server-side. `vercel.json` updated to exempt `/api` routes from SPA rewrite. SPA's `exaSearch`/`exaGetContents` now try (1) agent gateway → (2) `/api/exa-*` proxy → (3) direct fallback for localhost dev.
- [x] **Exa as agent tool (Option B)** — `services/agent/src/tools.js` gains `exa_search` + `exa_contents` tools with full Anthropic tool specs. When the agent is connected with `EXA_API_KEY` set, the AI can chain tool calls (e.g. fetch news → analyze chart → synthesize report).
- [x] **Server-side `EXA_API_KEY`** — `.env.local.example` documents both client-side `VITE_EXA_API_KEY` (localhost dev) and server-side `EXA_API_KEY` (Vercel + agent).

## Production hardening (April 2026)

- [x] **Sentry SDK** wired on all 3 backends (executor + agent + tick). Set `SENTRY_DSN` to activate.
- [x] **Rate limiting** — 4 tiers (public/read/write/llm) on all backends. Configurable via env.
- [x] **JWT auth skeleton** — HS256 tokens, per-user data isolation, ownership enforcement on `/strategies/*`, `/users/me/*`. Backwards-compat with legacy shared bearer for dev.
- [x] **Analyze chart** button on Trade page — modal with bias/levels/setup/strategy fit, uses agent gateway with tool calling when available, falls through to direct callAI.

## Phases 1, 2, 3 — Backend integration COMPLETE

- [x] **Phase 1 — Tick Ingestion Service** (`services/tick-ingestion/`)
  - Real Coinbase WebSocket producer, real DuckDB schema
  - FastAPI consumer: `/health`, `/data`, `/ohlc`, `/latest`, `/symbols`, `/stream` (WS)
  - OHLC aggregation in SQL, exponential backoff reconnect, in-memory last-prices cache
  - Hyperliquid producer stubbed (protocol needs domain work)
  - Janitor + heartbeat tracking
- [x] **Phase 2 — Strategy Executor** (`services/executor/`)
  - Real indicator engine (EMA/RSI/VWAP/MACD/Bollinger/ATR)
  - Real sandboxed safety-check engine returning structured pass/fail
  - Real Alpaca paper broker (Bitget stubbed)
  - Postgres schema with strategies/runs/trades/positions VIEW
  - Cron schedules at 1m/5m/15m/1h/1d
  - WebSocket event bus broadcasting fill/signal/rejection
  - trades.csv dual-write for tax audit
- [x] **Phase 3 — Agent Runtime** (`services/agent/`)
  - LLM provider chain: Anthropic + OpenAI + Ollama with fallback
  - 6 tools wired (query_ticks, get_ohlc, list_strategies, run_safety, list_positions, list_trades)
  - Real Telegram via Bot API
  - SSE web channel for browser push
  - File-backed persistent memory
  - Cron skills: morning brief, position monitor
  - Event-driven skill: signal-watch via WS subscription to executor
- [x] **SPA Integration A1-A11** (all in `JPMOnyxTerminal.jsx`)
  - A1: 4 new env vars (VITE_TICK_API_URL, VITE_EXECUTOR_API_URL, VITE_ZEROCLAW_GATEWAY_URL, VITE_BACKEND_AUTH_TOKEN)
  - A2: useBackend() hook with get/post/stream/status polling
  - A3: StatusBar TICK/EXEC/AGENT dots
  - A4: usePriceFeed gets tick API as priority-1 source
  - A5: callAI checks ZeroClaw gateway first
  - A6: Portfolio "Export trades" button (works backend-or-not)
  - A7: Settings → "Backend services" panel with Test buttons
  - A8: Strategies widget gets real backend strategies + Auto-execute + Safety check modal
  - A9: New Execution Log page accessible from account menu
  - A10: NotificationPrefsPanel in Settings with per-event channel pickers
  - A11: Persistent WS to executor for fill/signal/rejection events with toasts
- [x] **Orchestration**
  - docker-compose.yml + Postgres + healthchecks
  - Makefile with `make dev`, `make check`, `make spa`
  - README-INTEGRATION.md with full architecture

## ALL SESSIONS COMPLETEThis file tracks everything from the user's bulk request that's split across
multiple sessions. Each session aims to fully complete its scope (no half-
shipping). Items are picked up roughly in priority order — blockers first,
then visual polish, then new features.

## SESSION 1 — Critical fixes & visual polish (THIS SESSION)

- [x] Portfolio page crash: `recommended is not defined`
- [x] Logo button next to TOTAL VALUE: change from squiggle to straight dash
- [x] Marketing counter still glitching — throttle harder
- [x] Liquid glass effect: rebuild to match reference (frosted pane look)
- [x] Widget borders softened (`0.06` → `0.04`)
- [x] Widget sizing — make widgets fill their slots properly
- [x] Default trade page: 3-column layout (buy/sell · chart · book)
- [x] Top nav page selector: progressive scaling + edge fade
- [x] Hyperliquid-style chart line thickness
- [x] Buy/sell promotion to top bar when widget removed
- [x] Remove Build page from nav
- [x] Rose theme text contrast fix

## SESSION 2 — Trade page deepening

- [x] AI ticker search (sector / future growth / fundamentals queries)
- [x] Chart scanner tool (snapshot chart → Anthropic → recommendation)
- [x] Comp widget — chosen stock vs sector peers
- [x] AI onboarding: "stocks for you" based on profile inputs on trade entry
- [x] Standard color scheme + chart palette constants (chartCyan/Amber/Purple/Olive/Gold/Pink/Magenta)

## SESSION 3 — Terminal & screening

- [x] Terminal: AI-generated full company report on right side w/ interactive
      charts and datasets
- [x] Market screener pre-browse (filter panel before scrolling list) (before "browse market" is opened)
- [x] Stablecoins as instrument category (USDC, USDT, DAI feeds)

## SESSION 4 — Discovery & education

- [x] Learn page: real quizzes (multiple-choice + scoring + progress)
- [x] Learn page: web-sourced lesson reading via Exa
- [x] Feed page: live news tab via Exa (3-tab layout: For you · Following · Live news)
- [x] Exa integration: exaSearch / exaGetContents / exaGroundedAI helpers
- [x] Exa-grounded AI ticker search (factors in current events)
- [x] Exa-grounded Chart Scanner (recent ticker news as context)
- [x] Exa-grounded Terminal Full Report (recent news enriches thesis/risks)

## SESSION 5 — Information architecture

- [x] Widget picker organized by category with sidebar (All / Trading / Analytics / Market / News / Macro / Account)
- [x] Indicators sub-categorized via programmatic name matching (Momentum / Volume / Volatility / Trend / Support-Resistance / Oscillator)
- [x] Drawings already sub-categorized via DRAWING_TAB_DEFS (trend / gann / patterns / forecasting / shapes / annotation / visuals)
- [x] Fundamentals sub-categorized programmatically (Statistics: Valuation / Profitability / Growth / Dividends / Efficiency / Leverage; Income: Revenue / Costs / Profit / Taxes; Balance: Assets / Liabilities / Equity; Cashflow: Operating / Investing / Financing)

## SESSION 6 — Stripe-style polish + settings

- [x] Deposit modal: gradient surface, IMO Capital eyebrow, larger header with -0.01em letter-spacing, layered shadow, subtle gradient strip in header
- [x] Settings panel: matching gradient header, Stripe-style section labels (1.4px tracking, 600 weight), card surfaces with linear-gradient (surface2 → bg) backgrounds
- [x] Signup modal: replaced 5-dot step indicator with thin Stripe-style progress bar that fills as user advances; step counter "Step N of 5" + label below; bigger -0.02em letter-spacing on h1
- [x] Profile input page (step 4): condensed from 8 button grids into 1 input row + 1 chip row + 5 selects → fits in viewport without scrollbar; removed inner scroll container

## SESSION 7 — Responsive + final polish + widget overhaul

- [x] All 27 widgets rebuilt: TradeMiniView wrapper now flex-fill (no gray space). Each child uses h-full + flex-1 to fill body.
- [x] Live data wired: NetFlow (real Polygon directional flow), DarkFlow (real block trades), VolDrift (real realized vol from log returns × √252), NewsFeed (Exa-grounded), TerminalMini (Exa-powered global pings with country flags)
- [x] FeedMini quick-post composer — pushes to FeedPage via window event, persists to localStorage
- [x] DiscussMini new widget — Reddit-style composer with tag selector, pushes to DiscussionPage
- [x] OrderBook + OrderEntry refactored to fill widget slot (removed fixed widths)
- [x] Quick Buy/Sell promotion verified — when OrderEntry widget is removed, prominent green/red buttons appear in InstrumentHeader; modal mirrors OrderEntry inputs with colored gradient header
- [x] Universal screen-size adaptation — responsive media queries (1280/1024/900/720), App container minWidth: 320, TopNav responsive padding, viewport meta tag
- [x] Terminal widget mini-graph — built brand-new TerminalMini component (Exa-powered news pings) replacing the broken inline placeholder
- [x] Final color compliance pass — audited 819 hex codes; remaining hardcodes verified intentional (chart palette, sector tile colors, OAuth provider colors, budget swatches, marketing legend dots)

---

## ALL SESSIONS COMPLETE

## Bonus pass — final audit fixes

- [x] Original IMO logo installed (uploaded by user, 1536x1024 JPEG)
- [x] Ticker abbreviation sweep (formatTicker NSDQ:AAPL/NYSE:JPM/ARCA:SPY applied to StatusBar, InstrumentHeader, watchlist, instrument tiles)
- [x] Table number alignment + label alignment via .imo-num/.imo-label utility classes
- [x] Subtle column hover (rgba 0.04) on all .imo-data-table tables
- [x] LIVE badge → 6px green dot + LIVE label (no pill)
- [x] Status bar TICK + LAT + WS connection state (driven by imo:tick window event)
- [x] Multi-page tabs already fully implemented (workspaces.tabs system: nameable, removable, persisted)
- [x] Twitter-clone Feed page:
  - Lucide icons throughout (Home/Hash/Bell/Bookmark/User/Mail/Search)
  - Twitter-style action row (Reply/Repost/Like/Views/Bookmark/Share) with colored hover backgrounds
  - Verified blue badge component (lucide Verified icon)
  - Compose with circular character-count progress ring
  - Sticky page header with backdrop blur
  - Right rail: search + What's happening + Trending tickers + Who to follow
  - User pill at bottom of sidebar with MoreHorizontal
  - Bigger Post button (full-pill, bold, white text)

---

Notes:
- Each session ships a build that's verified clean before package
- The deploy.ps1 script picks up changes automatically
- This file lives in the repo root so it's tracked across deploys
