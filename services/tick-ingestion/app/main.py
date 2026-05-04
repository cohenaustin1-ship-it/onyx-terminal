"""
FastAPI consumer + main entrypoint.

Runs the producer in the background, exposes REST endpoints for the SPA
to query historical ticks and OHLC bars, and a WebSocket /stream endpoint
that fans out live ticks.
"""
import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Header, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Optional: Sentry. No-op if SENTRY_DSN not set.
try:
    import sentry_sdk
    if os.getenv("SENTRY_DSN"):
        sentry_sdk.init(
            dsn=os.getenv("SENTRY_DSN"),
            environment=os.getenv("NODE_ENV", "development"),
            traces_sample_rate=0.1 if os.getenv("NODE_ENV") == "production" else 1.0,
            send_default_pii=False,
        )
except ImportError:
    pass

# Rate limiting — slowapi (Redis-backed in prod, in-memory for now)
try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded
    limiter = Limiter(key_func=get_remote_address)
except ImportError:
    limiter = None

from app import db
from app.auth import require_auth, verify_token, LEGACY_TOKEN
from app.producers.coinbase import CoinbaseProducer
from app.producers.hyperliquid import HyperliquidProducer


load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("main")


PORT = int(os.getenv("PORT", "8001"))
COINBASE_SYMBOLS = [s.strip() for s in os.getenv("COINBASE_SYMBOLS", "BTC-USD,ETH-USD,SOL-USD").split(",") if s.strip()]
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "50"))
BATCH_FLUSH_SECONDS = float(os.getenv("BATCH_FLUSH_SECONDS", "2"))
RETENTION_DAYS = int(os.getenv("RETENTION_DAYS", "30"))
HYPERLIQUID_ENABLED = os.getenv("HYPERLIQUID_ENABLED", "false").lower() == "true"

# Rate-limit configurations (per IP per minute)
RL_PUBLIC = os.getenv("RATE_LIMIT_PUBLIC", "120/minute")
RL_READ   = os.getenv("RATE_LIMIT_READ",   "60/minute")


# Single producer instance — global so request handlers can broadcast/read prices
coinbase_producer: CoinbaseProducer | None = None
hyperliquid_producer: HyperliquidProducer | None = None
producer_tasks: list[asyncio.Task] = []
janitor_task: asyncio.Task | None = None


async def janitor_loop():
    """Cleanup old ticks once a day."""
    while True:
        try:
            await asyncio.sleep(86400)
            deleted = await asyncio.to_thread(db.cleanup_old_ticks, RETENTION_DAYS)
            log.info(f"janitor: removed {deleted} ticks older than {RETENTION_DAYS}d")
        except asyncio.CancelledError:
            break
        except Exception as e:
            log.exception(f"janitor error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global coinbase_producer, hyperliquid_producer, producer_tasks, janitor_task
    db.init_db()
    log.info(f"DuckDB initialized at {db.DB_PATH}")

    coinbase_producer = CoinbaseProducer(
        symbols=COINBASE_SYMBOLS,
        batch_size=BATCH_SIZE,
        flush_seconds=BATCH_FLUSH_SECONDS,
    )
    producer_tasks.append(asyncio.create_task(coinbase_producer.run()))
    log.info(f"started Coinbase producer for {COINBASE_SYMBOLS}")

    if HYPERLIQUID_ENABLED:
        hyperliquid_producer = HyperliquidProducer()
        producer_tasks.append(asyncio.create_task(hyperliquid_producer.run()))

    janitor_task = asyncio.create_task(janitor_loop())

    yield

    # Shutdown
    log.info("shutting down...")
    if coinbase_producer:
        coinbase_producer.stop()
    if hyperliquid_producer:
        hyperliquid_producer.stop()
    if janitor_task:
        janitor_task.cancel()
    for t in producer_tasks:
        t.cancel()
    await asyncio.gather(*producer_tasks, return_exceptions=True)


app = FastAPI(title="Onyx Tick Ingestion", version="0.1.0", lifespan=lifespan)

# Rate limiter (slowapi) — only attach if available
if limiter is not None:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — allow the SPA dev server + Vercel deploy
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten in production
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
async def health(request: Request):
    """Public — no auth. SPA polls this for status indicator."""
    return {
        "service": "onyx-tick-ingestion",
        "version": "0.1.0",
        "ts": int(time.time() * 1000),
        "auth_modes": ["jwt", "legacy"],
        **(await asyncio.to_thread(db.get_health))
    }


@app.get("/symbols", dependencies=[Depends(require_auth)])
async def symbols():
    rows = await asyncio.to_thread(db.get_known_symbols)
    return {"symbols": rows}


@app.get("/data/{symbol}", dependencies=[Depends(require_auth)])
async def get_data(symbol: str, limit: int = 100):
    """Most recent N ticks for a symbol."""
    if limit < 1 or limit > 10_000:
        raise HTTPException(status_code=400, detail="limit must be 1..10000")
    rows = await asyncio.to_thread(db.get_recent_ticks, symbol, limit)
    return {
        "symbol": symbol.upper(),
        "count": len(rows),
        "data": [
            {"ts": r[0], "price": r[1], "size": r[2], "side": r[3], "source": r[4]}
            for r in rows
        ],
    }


@app.get("/ohlc/{symbol}", dependencies=[Depends(require_auth)])
async def get_ohlc_bars(symbol: str, interval: str = "1m", limit: int = 200):
    if interval not in ("1m", "5m", "15m", "1h", "4h", "1d"):
        raise HTTPException(status_code=400, detail="invalid interval")
    if limit < 1 or limit > 5_000:
        raise HTTPException(status_code=400, detail="limit must be 1..5000")
    rows = await asyncio.to_thread(db.get_ohlc, symbol, interval, limit)
    return {
        "symbol": symbol.upper(),
        "interval": interval,
        "bars": [
            {"ts": r[0], "open": r[1], "high": r[2], "low": r[3],
             "close": r[4], "volume": r[5], "tick_count": r[6]}
            for r in rows
        ],
    }


@app.get("/latest/{symbol}", dependencies=[Depends(require_auth)])
async def get_latest(symbol: str):
    """Last seen price — served from in-memory cache for speed."""
    canonical = symbol.upper().split("-")[0]
    if coinbase_producer and canonical in coinbase_producer.last_prices:
        return {"symbol": canonical, **coinbase_producer.last_prices[canonical]}
    # fallback to most recent in DB
    rows = await asyncio.to_thread(db.get_recent_ticks, canonical, 1)
    if rows:
        return {"symbol": canonical, "ts": rows[0][0], "price": rows[0][1]}
    raise HTTPException(status_code=404, detail="symbol not found")


@app.websocket("/stream/{symbol}")
async def stream(ws: WebSocket, symbol: str, token: str = ""):
    """Live tick fan-out for a single symbol.
    Auth via ?token= query string since browser WS API can't set headers.
    Accepts either a JWT or the legacy shared bearer."""
    valid = False
    if token:
        # Try JWT first
        jwt_result = verify_token(token)
        if jwt_result and jwt_result.get("userId"):
            valid = True
        elif LEGACY_TOKEN and token == LEGACY_TOKEN:
            valid = True
    if not valid:
        await ws.close(code=4401)
        return
    await ws.accept()
    canonical = symbol.upper().split("-")[0]
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    if coinbase_producer:
        coinbase_producer.add_subscriber(queue)
    try:
        await ws.send_text(json.dumps({"type": "subscribed", "symbol": canonical}))
        while True:
            tick = await queue.get()
            if tick.get("symbol") == canonical:
                await ws.send_text(json.dumps(tick))
    except WebSocketDisconnect:
        pass
    finally:
        if coinbase_producer:
            coinbase_producer.remove_subscriber(queue)


def main():
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=PORT,
        log_level="info",
    )


if __name__ == "__main__":
    main()
