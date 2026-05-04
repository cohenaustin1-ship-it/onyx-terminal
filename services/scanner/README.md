# Onyx Scanner Service

Server-side technical setup scanner. Runs the same SETUP_RULES detector
logic that the SPA does client-side, but on a schedule and against a
maintained universe so the user gets push alerts for setups that fired
while they weren't looking.

## Status

**Phase 1 (real detectors, current commit)**: Polygon bar fetcher +
10 ported detectors are live. The scanner uses real bars when
`POLYGON_API_KEY` is set; falls back to stub mode (low-frequency
synthetic events) when Polygon isn't configured, so the alert delivery
pipeline remains testable end-to-end without a real data feed.

**Detectors ported (Phase 1)**: bull-breakout, bear-breakdown,
oversold-bounce, overbought-fade, bb-squeeze, macd-bull-cross,
macd-bear-cross, golden-cross, death-cross, volume-thrust.

**Detectors still pending (Phase 2)**: higher-low-stack,
lower-high-stack, bull-flag. These have more complex pivot-detection
logic and will be added in a follow-up.

## Architecture

```
                    ┌──────────────────┐
                    │  Polygon API     │  fetch bars on schedule
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Scanner worker  │  cron-style: scan every N min
                    │  (apscheduler)   │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Real detectors  │  10/13 SPA detectors ported
                    │  (detectors.py)  │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Alert store     │  SQLite/DuckDB; FIFO retention
                    │  (recent events) │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  REST + SSE API  │  /alerts (poll), /stream (push)
                    └────────┬─────────┘
                             │
                             ▼
                       SPA service worker
                       browser notification
```

## Endpoints

- `GET /health`                  — health check
- `GET /alerts?since=<unix_ms>`  — alerts produced after the given
                                   timestamp (poll-based)
- `GET /watchlist/<user_id>`     — fetch the user's saved scan config
- `POST /watchlist/<user_id>`    — save/update the user's scan config
- `DELETE /watchlist/<user_id>`  — remove the user's watchlist
- `GET /stream/<user_id>`        — SSE stream of new alerts for the user
- `POST /admin/run-scan-now`     — manual trigger for testing

## Running

```
cd services/scanner
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8003
```

Set environment:

- `POLYGON_API_KEY`              — for fetching bars (required for real detectors)
- `BACKEND_AUTH_TOKEN`           — for auth between SPA and scanner
- `SCAN_INTERVAL_MIN`            — minutes between scans (default 15)

## Configuration

Each user has a watchlist config of shape:

```json
{
  "tickers": ["AAPL", "MSFT", "NVDA"],
  "rules": ["bull-breakout", "oversold-bounce"],
  "scan_every_minutes": 15,
  "alert_threshold_score": 60,
  "muted": ["AAPL:macd-bull-cross"],
  "detector_params": {
    "bull-breakout": {"window": 30, "minVolZ": 1.0}
  }
}
```

When a scan fires and a setup is detected with score >= threshold AND
the (ticker, rule) pair is not muted, an alert event is pushed.

## SPA integration

The SPA's existing service worker (`/imo-macro-sw.js`) is extended to
subscribe to `/stream/<user_id>` via SSE. Alerts that arrive trigger a
browser notification via the Notification API (already configured for
the macro alerts feature).

This is opt-in: users have to enable "server-side scan" in scanner
settings, which kicks off the SSE subscription.

## Limitations

- Single-host scheduler (no clustering). Fine for a few hundred users.
- Alert dedup is best-effort: if the same setup re-fires within an
  hour, it's treated as a duplicate and suppressed.
- No backfill of historical alerts; only forward-looking from when the
  user enabled their watchlist.
- Polygon-bar-fetch latency is ~1-2 seconds per ticker; scan time scales
  with watchlist size. For 30-ticker watchlists scanned every 15 min,
  total work ≈ 30s every 15 min. Comfortably within the cycle budget.
- 200-day SMA detectors (golden-cross, death-cross) need 200+ bars of
  history; we fetch 90 days by default, so these won't fire until we
  expand the fetch window. This is a deliberate trade-off — most
  detectors only need 30-50 bars and the long-only fetch is wasteful.

