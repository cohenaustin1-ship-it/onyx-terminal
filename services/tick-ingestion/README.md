# Onyx Tick Ingestion Service

Real-time market data recorder + query API. Subscribes to upstream WebSocket feeds (Coinbase, Hyperliquid), batches ticks into DuckDB, exposes REST + WS endpoints to the SPA and the executor.

## What's in the box

- **Real Coinbase WS producer** — connects to the `matches` channel, captures every executed trade, batches and stores in DuckDB
- **DuckDB-backed OHLC aggregation** — `/ohlc/BTC?interval=5m` runs as a single SQL query; P99 < 50ms even at 10M+ ticks
- **WebSocket fan-out** — `/stream/{symbol}` lets the SPA subscribe to live ticks without each tab opening its own connection to Coinbase
- **Heartbeat tracking** — `/health` reports last-tick timestamp per source so the SPA's StatusBar can show real connection state
- **Janitor** — cleans up ticks older than `RETENTION_DAYS` once a day
- **Hyperliquid stub** — wired in but not implemented; the protocol needs domain-specific work

## Run locally

```bash
cd services/tick-ingestion
cp .env.example .env
# edit .env if needed (defaults work for local dev)
docker build -t onyx-tick .
docker run --rm -p 8001:8001 -v $(pwd)/data:/app/data --env-file .env onyx-tick
```

Or with the project-root `docker compose up tick-ingestion`.

## Verify it's working

```bash
# Service should be healthy and connected to Coinbase
curl http://localhost:8001/health

# After ~30 seconds of running you should have hundreds of ticks
curl -H "Authorization: Bearer dev_local_token_change_me" \
     http://localhost:8001/data/BTC?limit=10

# OHLC bars
curl -H "Authorization: Bearer dev_local_token_change_me" \
     "http://localhost:8001/ohlc/BTC?interval=1m&limit=5"
```

## Production notes

- Drop the `allow_origins=["*"]` in `app/main.py` and pin to your SPA domain
- Run producer + API as separate services in production (currently they share a process for dev simplicity)
- Add backups for the DuckDB file — DuckDB has no built-in replication
- Consider migrating to PostgreSQL + TimescaleDB if you need replication / HA
- Rate-limit the API at the load balancer (currently no in-process rate limiting)
- Set `AUTH_TOKEN` to a real cryptographically-random value

## Architecture

```
upstream WS (Coinbase)
       │
       ▼
┌─────────────────────┐
│ CoinbaseProducer    │  ◀── async loop, reconnects with backoff
│  - buffer (in-mem)  │
│  - flush every Ns   │
└──────────┬──────────┘
           │ batched insert
           ▼
      ┌─────────┐
      │ DuckDB  │
      └────┬────┘
           │ on-demand queries
           ▼
   ┌──────────────┐
   │  FastAPI     │
   │  /data       │
   │  /ohlc       │
   │  /stream WS  │
   └──────────────┘
```

The producer also pushes each tick to in-memory subscribers (the `/stream` WebSocket clients), so the SPA gets sub-100ms latency from upstream tick to chart paint.

## OpenAPI

See `openapi.yaml` for the full contract. The SPA's `useBackend()` hook conforms to this exactly.
