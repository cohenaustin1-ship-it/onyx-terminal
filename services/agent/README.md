# Onyx Agent

ZeroClaw-style agent runtime — focused subset that gives you what the SPA actually needs:

- **LLM gateway** with multi-provider fallback (Anthropic → OpenAI → Ollama)
- **Tool calling** — agent has hands into the tick API and executor
- **Persistent memory** — user prefs and conversation history survive restarts
- **Multi-channel notifications** — Telegram + web (SSE) wired; framework for Discord/email/iMessage
- **Cron-driven skills** — morning brief, position monitor
- **Event-driven skills** — listens to executor's WebSocket, dispatches to user's preferred channel

## What's working today

| Feature | Status |
|---|---|
| Anthropic provider | ✅ Real, calls /v1/messages |
| OpenAI provider | ✅ Real, calls /v1/chat/completions |
| Ollama provider | ✅ Real, calls local `/api/chat` |
| Provider fallback chain | ✅ Each provider tried in order; falls through on 429/5xx |
| Tool calling | ✅ 6 tools wired (query_ticks, get_ohlc, list_strategies, run_strategy_safety_check, list_positions, list_recent_trades) |
| Memory store | ✅ File-backed JSON (swap to Postgres for prod) |
| Telegram channel | ✅ Real Telegram Bot API |
| Web SSE channel | ✅ Real EventSource pushed to SPA |
| Discord, email, iMessage, voice | 🟡 Framework in place, channel adapters not implemented |
| Morning brief skill | ✅ Cron at 08:30 ET, sends per-user brief |
| Position monitor skill | ✅ Every 30 min during market hours, alerts if PnL < -3% |
| Signal-watch skill | ✅ Subscribes to executor WS, fans out to channels |

## Run locally

```bash
cd services/agent
cp .env.example .env
# Set ANTHROPIC_API_KEY (or OPENAI_API_KEY) — at least one
# Optional: TELEGRAM_BOT_TOKEN
npm install
npm run dev
```

Or via project-root docker-compose:

```bash
docker compose up agent
```

## Verify it's working

```bash
# Health
curl http://localhost:7777/health

# LLM chat (fallback to whichever provider is configured)
curl -X POST http://localhost:7777/agent/chat \
  -H "Authorization: Bearer dev_local_token_change_me" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What is BTC trading at right now?"}], "use_tools": true, "user_id": "demo"}'

# Set notification preferences
curl -X PATCH http://localhost:7777/users/demo/prefs \
  -H "Authorization: Bearer dev_local_token_change_me" \
  -H "Content-Type: application/json" \
  -d '{"signal_fired":{"enabled":true,"channels":["telegram","web"]}}'

# Send a test notification (verifies the channel router)
curl -X POST http://localhost:7777/notify \
  -H "Authorization: Bearer dev_local_token_change_me" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"demo","event_type":"signal_fired","message":"Test signal"}'
```

## Telegram setup (optional)

1. Message @BotFather on Telegram, type `/newbot`, follow prompts
2. Copy the bot token into `.env` as `TELEGRAM_BOT_TOKEN`
3. Find your bot on Telegram, send it any message
4. The agent auto-discovers your `chat_id` on next boot OR call:
   ```bash
   curl -X POST http://localhost:7777/channels/telegram/register \
     -H "Authorization: Bearer dev_local_token_change_me" \
     -H "Content-Type: application/json" \
     -d '{"user_id":"demo","chat_id":123456789}'
   ```
5. Update prefs to add `telegram` to whichever events you want

## Why a focused subset, not a fork of ZeroClaw

ZeroClaw is a 400-crate Rust agent runtime with 71 tools, 40 channels, hardware peripherals (GPIO/I2C), security sandboxing (Landlock/Bubblewrap/Seatbelt), tool receipts, and a web dashboard. For the Onyx Terminal use-case — LLM proxy + cron + Telegram — you don't need any of that. This service implements the 5% of ZeroClaw that the SPA actually exercises, in ~600 lines of Node.js instead of ~50,000 lines of Rust.

If you ever want the full thing, the integration point is identical: the SPA calls `POST /agent/chat` with OpenAI-compatible payload. Replace this service with a real ZeroClaw deployment when you need hardware support, sandboxed shell, or 40 messaging channels.
