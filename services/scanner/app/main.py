"""
Onyx Scanner Service — server-side technical setup scanner.

Runs detector logic on a schedule against each user's configured
watchlist, stores the resulting alerts, and exposes them via REST + SSE.
The SPA's service worker subscribes to /stream/<user_id> and surfaces
the alerts as browser notifications.

This is the Phase 0 foundation: API + scheduler + alert store. Detectors
are stubs producing realistic-looking synthetic events for end-to-end
testing of the alert pipeline. Phase 1 ports the actual detector library
from the SPA.
"""

import asyncio
import json
import logging
import os
import random
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.detectors import run_all_detectors, ALL_DETECTORS

load_dotenv()
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("scanner")

DB_PATH = os.getenv("SCANNER_DB_PATH", "/tmp/onyx-scanner.db")
AUTH_TOKEN = os.getenv("BACKEND_AUTH_TOKEN", "")  # shared with SPA
POLYGON_API_KEY = os.getenv("POLYGON_API_KEY", "")
SCAN_INTERVAL_MIN = int(os.getenv("SCAN_INTERVAL_MIN", "15"))


# ─────────────────────────────────────────────────────────────────
# Database — SQLite for simplicity. Single file, no server needed.
# Schema:
#   watchlists(user_id, config_json, updated_at)
#   alerts(id, user_id, ticker, rule_id, score, payload_json, created_at)
# ─────────────────────────────────────────────────────────────────
def db_conn():
    return sqlite3.connect(DB_PATH, timeout=10)


def db_init():
    with db_conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS watchlists (
            user_id TEXT PRIMARY KEY,
            config_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            ticker TEXT NOT NULL,
            rule_id TEXT NOT NULL,
            score INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_alerts_user_created
            ON alerts(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_alerts_dedup
            ON alerts(user_id, ticker, rule_id, created_at);
        """)


def auth_required(authorization: Optional[str] = Header(default=None)):
    """Reject if the SPA's auth token doesn't match. Optional in dev."""
    if not AUTH_TOKEN:
        return  # dev mode — no auth
    expected = f"Bearer {AUTH_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="invalid auth")


# In-memory queue of recent alerts per user, used for SSE fanout. The DB
# is the durable store; this is just the "live" tap.
LIVE_QUEUES: dict[str, asyncio.Queue] = {}


def push_alert(user_id: str, alert: dict):
    """Insert into DB + push to live queue."""
    with db_conn() as c:
        c.execute(
            "INSERT INTO alerts (id, user_id, ticker, rule_id, score, payload_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                alert["id"], user_id, alert["ticker"], alert["rule_id"],
                int(alert.get("score", 0)),
                json.dumps(alert),
                int(alert["created_at"]),
            ),
        )
    q = LIVE_QUEUES.get(user_id)
    if q is not None:
        try:
            q.put_nowait(alert)
        except asyncio.QueueFull:
            pass  # client too slow; will catch up via /alerts poll


def get_recent_alerts(user_id: str, since_ms: int = 0, limit: int = 50):
    with db_conn() as c:
        rows = c.execute(
            "SELECT payload_json FROM alerts WHERE user_id=? AND created_at>? "
            "ORDER BY created_at DESC LIMIT ?",
            (user_id, since_ms, limit),
        ).fetchall()
    return [json.loads(r[0]) for r in rows]


def get_watchlist(user_id: str) -> Optional[dict]:
    with db_conn() as c:
        row = c.execute(
            "SELECT config_json FROM watchlists WHERE user_id=?",
            (user_id,),
        ).fetchone()
    return json.loads(row[0]) if row else None


def upsert_watchlist(user_id: str, config: dict):
    with db_conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO watchlists (user_id, config_json, updated_at) "
            "VALUES (?, ?, ?)",
            (user_id, json.dumps(config), int(time.time() * 1000)),
        )


def list_active_users():
    with db_conn() as c:
        rows = c.execute(
            "SELECT user_id, config_json FROM watchlists"
        ).fetchall()
    return [(uid, json.loads(cfg)) for uid, cfg in rows]


# ─────────────────────────────────────────────────────────────────
# Polygon bar fetcher — pulls daily aggregates for a ticker, used as
# input to the real detectors. We fetch ~90 days back from today;
# this gives detectors enough warmup history (200-day SMA needs the
# longer window though — golden-cross detector won't fire until the
# scanner has been observing for a while).
# ─────────────────────────────────────────────────────────────────
async def fetch_polygon_bars(ticker: str, days: int = 90) -> list:
    """Returns a list of bar dicts: [{t, open, high, low, close, volume}, ...]
    Sorted oldest → newest. Empty list on failure."""
    if not POLYGON_API_KEY:
        return []
    end = time.time()
    start = end - (days * 86400)
    end_iso = time.strftime("%Y-%m-%d", time.gmtime(end))
    start_iso = time.strftime("%Y-%m-%d", time.gmtime(start))
    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{ticker}/range/1/day/"
        f"{start_iso}/{end_iso}"
    )
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url, params={
                "adjusted": "true",
                "sort": "asc",
                "limit": 5000,
                "apiKey": POLYGON_API_KEY,
            })
            if r.status_code != 200:
                return []
            data = r.json()
            results = data.get("results") or []
            return [
                {"t": b["t"], "open": b["o"], "high": b["h"],
                 "low": b["l"], "close": b["c"], "volume": b.get("v", 0)}
                for b in results
            ]
    except Exception as e:
        log.warning("polygon fetch err %s: %s", ticker, e)
        return []


# Stub fallback (kept for envs without Polygon — produces low-frequency
# synthetic events so the alert pipeline can still be tested).
STUB_RULES = list(ALL_DETECTORS.keys())


def stub_detect(ticker: str, rules: list[str]) -> Optional[dict]:
    if random.random() > 0.05:  # ~5% chance per scan
        return None
    rule = random.choice([r for r in rules if r in STUB_RULES])
    score = random.randint(60, 92)
    base_price = 50 + random.random() * 200
    return {
        "id": uuid.uuid4().hex[:16],
        "ticker": ticker,
        "rule_id": rule,
        "score": score,
        "side": "long" if "bull" in rule or "bounce" in rule or "cross" in rule else "short",
        "levels": {
            "entry": round(base_price, 2),
            "stop": round(base_price * 0.97, 2),
            "target": round(base_price * 1.06, 2),
        },
        "notes": f"[STUB] {rule} fired on {ticker} at price {base_price:.2f}",
        "created_at": int(time.time() * 1000),
    }


async def real_detect(ticker: str, rules: list[str], params_by_rule: dict) -> list[dict]:
    """Fetch real bars and run real detectors. Returns a list of events."""
    bars = await fetch_polygon_bars(ticker, days=90)
    if not bars or len(bars) < 30:
        return []
    setups = run_all_detectors(bars, ticker, rules, params_by_rule)
    out = []
    for s in setups:
        out.append({
            "id": uuid.uuid4().hex[:16],
            "ticker": ticker,
            "rule_id": s["rule_id"],
            "score": s["score"],
            "side": s.get("side", "long"),
            "levels": s.get("levels", {}),
            "notes": s.get("notes", ""),
            "created_at": int(time.time() * 1000),
        })
    return out


async def scan_user(user_id: str, config: dict):
    tickers = config.get("tickers", [])
    rules = config.get("rules", list(ALL_DETECTORS.keys()))
    threshold = int(config.get("alert_threshold_score", 60))
    muted = set(config.get("muted", []))
    detector_params = config.get("detector_params", {})
    use_real = bool(POLYGON_API_KEY)
    for t in tickers:
        try:
            events = []
            if use_real:
                events = await real_detect(t, rules, detector_params)
            else:
                stub = stub_detect(t, rules)
                if stub:
                    events = [stub]
            for event in events:
                if event["score"] < threshold:
                    continue
                mute_key = f"{t}:{event['rule_id']}"
                wildcard = f"{t}:*"
                if mute_key in muted or wildcard in muted:
                    continue
                # Dedup — suppress if the same (ticker, rule) fired in last hour
                with db_conn() as c:
                    row = c.execute(
                        "SELECT 1 FROM alerts WHERE user_id=? AND ticker=? AND rule_id=? "
                        "AND created_at > ? LIMIT 1",
                        (user_id, t, event["rule_id"], int((time.time() - 3600) * 1000)),
                    ).fetchone()
                if row:
                    continue
                push_alert(user_id, event)
                log.info("alert: user=%s ticker=%s rule=%s score=%d %s",
                         user_id, t, event["rule_id"], event["score"],
                         "(real)" if use_real else "(stub)")
        except Exception as e:
            log.warning("scan_user err uid=%s ticker=%s: %s", user_id, t, e)


async def run_scheduled_scans():
    """Scan all active users. Spreads work across an interval to avoid
    bursts when many users have similar configs."""
    users = list_active_users()
    if not users:
        return
    log.info("scanning %d user(s)", len(users))
    for user_id, config in users:
        await scan_user(user_id, config)


# ─────────────────────────────────────────────────────────────────
# FastAPI app
# ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    db_init()
    scheduler = AsyncIOScheduler()
    scheduler.add_job(run_scheduled_scans, "interval", minutes=SCAN_INTERVAL_MIN)
    scheduler.start()
    log.info("scanner started; interval=%d min", SCAN_INTERVAL_MIN)
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Onyx Scanner Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in prod
    allow_methods=["*"],
    allow_headers=["*"],
)


class WatchlistConfig(BaseModel):
    tickers: list[str]
    rules: list[str] = []
    scan_every_minutes: int = 15
    alert_threshold_score: int = 60
    muted: list[str] = []


@app.get("/health")
async def health():
    return {"ok": True, "service": "scanner", "interval_min": SCAN_INTERVAL_MIN}


@app.get("/alerts", dependencies=[Depends(auth_required)])
async def alerts_endpoint(user_id: str, since: int = 0, limit: int = 50):
    return {"alerts": get_recent_alerts(user_id, since, limit)}


@app.get("/watchlist/{user_id}", dependencies=[Depends(auth_required)])
async def watchlist_get(user_id: str):
    cfg = get_watchlist(user_id)
    if not cfg:
        raise HTTPException(status_code=404, detail="no watchlist for user")
    return cfg


@app.post("/watchlist/{user_id}", dependencies=[Depends(auth_required)])
async def watchlist_set(user_id: str, cfg: WatchlistConfig):
    upsert_watchlist(user_id, cfg.dict())
    return {"ok": True}


@app.delete("/watchlist/{user_id}", dependencies=[Depends(auth_required)])
async def watchlist_delete(user_id: str):
    with db_conn() as c:
        c.execute("DELETE FROM watchlists WHERE user_id=?", (user_id,))
    return {"ok": True}


@app.get("/stream/{user_id}")
async def stream_endpoint(user_id: str, request: Request):
    """SSE stream of new alerts. The service worker / SPA opens this
    once per session; we push events as they fire."""
    if user_id not in LIVE_QUEUES:
        LIVE_QUEUES[user_id] = asyncio.Queue(maxsize=100)
    q = LIVE_QUEUES[user_id]

    async def event_gen():
        # Initial backfill — last 10 alerts so a freshly-connected
        # client immediately sees recent context
        for a in reversed(get_recent_alerts(user_id, limit=10)):
            yield {"event": "alert", "data": json.dumps(a)}
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    a = await asyncio.wait_for(q.get(), timeout=15)
                    yield {"event": "alert", "data": json.dumps(a)}
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
        finally:
            # leave queue around for next connect; cleanup is by GC
            pass

    return EventSourceResponse(event_gen())


@app.post("/admin/run-scan-now", dependencies=[Depends(auth_required)])
async def admin_run_scan_now():
    """Manual trigger for testing. Hits all active users."""
    await run_scheduled_scans()
    return {"ok": True}
