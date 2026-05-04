# Onyx Strategy Executor

Server-side strategy evaluation, safety-check gates, broker execution, and audit trail. Pulls market data from the tick-ingestion service, posts orders via a pluggable broker adapter, broadcasts events to the SPA via WebSocket.

## What's working today

- **Real strategy CRUD** — Postgres-backed, JSON entry-rule expressions
- **Real indicator engine** — EMA/RSI/VWAP/MACD/Bollinger/ATR, ported from `bot.js`
- **Real safety check** — every entry rule evaluated, structured pass/fail returned, indicator values captured
- **Real risk caps** — `MAX_TRADES_PER_DAY` and `MAX_TRADE_SIZE_USD` enforced before any order
- **Real Alpaca paper broker** — places orders against paper-api.alpaca.markets when `BROKER_ADAPTER=alpaca`
- **Real paper broker** — fallback simulated execution that mirrors the SPA's existing paper-trading
- **Bitget broker** — stubbed (porting from `bot.js`'s `signBitGet()` requires testing against a live key)
- **Real audit trail** — every fill writes to Postgres `trades` table AND appends to `trades.csv`
- **Real cron scheduling** — 1m/5m/15m/1h strategies fire automatically
- **Real WebSocket fan-out** — `/ws/events` broadcasts fill/signal/rejection events

## Run locally

```bash
# Postgres needs to be running; easiest path:
docker compose up postgres tick-ingestion executor   # from project root
```

Standalone (no docker-compose):

```bash
cd services/executor
cp .env.example .env
# Set DATABASE_URL to your Postgres
npm install
npm run dev
```

## Verify it's working

```bash
# Health
curl http://localhost:8002/health

# Create a strategy (requires the tick service to have data for BTC)
curl -X POST http://localhost:8002/strategies \
  -H "Authorization: Bearer dev_local_token_change_me" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "demo",
    "name": "BTC oversold scalp",
    "symbol": "BTC",
    "interval": "1m",
    "side": "long",
    "entry_rules": [
      {"name":"Price above EMA20","expr":"price > ema_20"},
      {"name":"RSI(3) below 30","expr":"rsi_3 < 30"}
    ]
  }'

# Run safety check (no execution)
curl -X POST http://localhost:8002/strategies/1/safety-check \
  -H "Authorization: Bearer dev_local_token_change_me"

# Enable auto-execute
curl -X POST http://localhost:8002/strategies/1/enable-auto \
  -H "Authorization: Bearer dev_local_token_change_me" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# Watch events
wscat -c "ws://localhost:8002/ws/events?token=dev_local_token_change_me"
```

## Strategy rule expressions

Rules are Javascript expressions evaluated in a sandboxed `Function` (NOT `eval`). Available variables:

| Variable | Source |
|---|---|
| `price` | latest close |
| `open`, `high`, `low`, `volume` | latest bar |
| `ema_8`, `ema_13`, `ema_20`, `ema_50`, `ema_100`, `ema_200` | EMAs |
| `rsi_3`, `rsi_7`, `rsi_14` | RSIs |
| `vwap` | session VWAP |
| `macd_line`, `macd_signal`, `macd_hist` | MACD components |
| `bb_upper`, `bb_middle`, `bb_lower` | Bollinger bands (20, 2σ) |
| `atr` | 14-period ATR |

Example expressions:

- `price > vwap && rsi_3 < 30` — bullish pullback
- `macd_line > macd_signal && macd_hist > 0` — MACD bull cross
- `price < bb_lower` — Bollinger lower-band tag

## Production checklist

- Real authentication (replace shared bearer with per-user JWT)
- Per-user risk caps in DB instead of single env vars
- Connection pool sizing under load
- Position reconciliation against broker (currently DB is source of truth)
- Stop-loss order placement (entry rules only today; exits not enforced)
- TLS termination at the load balancer
- Sentry / logging / metrics

## Why this is the right architecture

**Decoupled from the SPA.** Strategies run on cron whether your browser is open or not. The SPA just *displays* what the executor records.

**Decoupled from the chart.** The bot doesn't read pixels off your chart. Both the chart and the bot pull from the tick API. Both compute EMA(8) and arrive at the same number, deterministically.

**Audited end-to-end.** Every decision — including blocked ones — has a `strategy_runs` row with the full safety-check JSON. Tax-ready trades.csv is appended on every fill.
