"""
DuckDB connection + schema management.

Why DuckDB over SQLite: we run aggregation queries (1m / 5m / 1h OHLC bars)
on millions of rows. DuckDB's columnar engine makes those P99 < 50ms even
at 10M+ ticks. SQLite would chew through them sequentially.

Schema is intentionally simple — one ticks table, one ohlc_cache table for
materialized aggregates. Everything else is computed on demand.
"""
import os
import duckdb
import pathlib
from contextlib import contextmanager


DB_PATH = os.getenv("DB_PATH", "./data/onyx_ticks.duckdb")


def init_db():
    """Create database file and tables if they don't exist."""
    pathlib.Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS ticks (
            symbol      VARCHAR NOT NULL,
            ts          BIGINT  NOT NULL,        -- ms since epoch
            price       DOUBLE  NOT NULL,
            size        DOUBLE  NOT NULL DEFAULT 0,
            side        VARCHAR DEFAULT NULL,    -- 'buy' | 'sell' | NULL
            source      VARCHAR NOT NULL,        -- 'coinbase' | 'hyperliquid' | 'polygon'
            PRIMARY KEY (symbol, ts, source)
        );
    """)
    # Indexes that keep the common queries fast
    con.execute("CREATE INDEX IF NOT EXISTS idx_ticks_symbol_ts ON ticks(symbol, ts DESC);")
    con.execute("""
        CREATE TABLE IF NOT EXISTS ohlc_cache (
            symbol     VARCHAR NOT NULL,
            interval   VARCHAR NOT NULL,         -- '1m' | '5m' | '1h' | '1d'
            bucket_ts  BIGINT  NOT NULL,
            open       DOUBLE,
            high       DOUBLE,
            low        DOUBLE,
            close      DOUBLE,
            volume     DOUBLE,
            tick_count INTEGER,
            PRIMARY KEY (symbol, interval, bucket_ts)
        );
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS heartbeat (
            source         VARCHAR PRIMARY KEY,
            last_tick_ts   BIGINT,
            ticks_received INTEGER DEFAULT 0,
            connected      BOOLEAN DEFAULT FALSE,
            updated_at     BIGINT
        );
    """)
    con.close()


@contextmanager
def get_conn():
    """Short-lived connection. DuckDB allows many readers + 1 writer."""
    con = duckdb.connect(DB_PATH)
    try:
        yield con
    finally:
        con.close()


def insert_ticks(rows):
    """Batch insert. rows is a list of (symbol, ts, price, size, side, source).
    Uses INSERT OR IGNORE semantics via DuckDB's ON CONFLICT DO NOTHING."""
    if not rows:
        return 0
    with get_conn() as con:
        con.executemany(
            "INSERT INTO ticks VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
            rows,
        )
        return len(rows)


def update_heartbeat(source: str, last_tick_ts: int, ticks_received: int, connected: bool):
    import time
    now = int(time.time() * 1000)
    with get_conn() as con:
        con.execute("""
            INSERT INTO heartbeat (source, last_tick_ts, ticks_received, connected, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (source) DO UPDATE SET
                last_tick_ts = excluded.last_tick_ts,
                ticks_received = heartbeat.ticks_received + excluded.ticks_received,
                connected = excluded.connected,
                updated_at = excluded.updated_at
        """, [source, last_tick_ts, ticks_received, connected, now])


def get_recent_ticks(symbol: str, limit: int = 100):
    with get_conn() as con:
        return con.execute("""
            SELECT ts, price, size, side, source
            FROM ticks
            WHERE symbol = ?
            ORDER BY ts DESC
            LIMIT ?
        """, [symbol.upper(), limit]).fetchall()


def get_ohlc(symbol: str, interval: str, limit: int = 200):
    """Aggregate ticks into OHLC bars on the fly using DuckDB SQL.
    For larger ranges or higher traffic, we'd materialize into ohlc_cache
    via a scheduled job. For now: compute live."""
    bucket_ms = {
        "1m": 60_000,
        "5m": 5 * 60_000,
        "15m": 15 * 60_000,
        "1h": 60 * 60_000,
        "4h": 4 * 60 * 60_000,
        "1d": 24 * 60 * 60_000,
    }.get(interval)
    if not bucket_ms:
        raise ValueError(f"unsupported interval: {interval}")

    with get_conn() as con:
        return con.execute(f"""
            SELECT
                (ts // {bucket_ms}) * {bucket_ms} AS bucket_ts,
                FIRST(price ORDER BY ts) AS open,
                MAX(price)               AS high,
                MIN(price)               AS low,
                LAST(price ORDER BY ts)  AS close,
                SUM(size)                AS volume,
                COUNT(*)                 AS tick_count
            FROM ticks
            WHERE symbol = ?
            GROUP BY bucket_ts
            ORDER BY bucket_ts DESC
            LIMIT ?
        """, [symbol.upper(), limit]).fetchall()


def get_known_symbols():
    with get_conn() as con:
        return [r[0] for r in con.execute(
            "SELECT DISTINCT symbol FROM ticks ORDER BY symbol"
        ).fetchall()]


def get_health():
    with get_conn() as con:
        rows = con.execute("""
            SELECT source, last_tick_ts, ticks_received, connected, updated_at
            FROM heartbeat
        """).fetchall()
        total = con.execute("SELECT COUNT(*) FROM ticks").fetchone()[0]
        return {
            "ticks_total": total,
            "sources": [
                {
                    "source": r[0],
                    "last_tick_ts": r[1],
                    "ticks_received": r[2],
                    "connected": r[3],
                    "updated_at": r[4],
                }
                for r in rows
            ],
        }


def cleanup_old_ticks(retention_days: int):
    import time
    cutoff = int(time.time() * 1000) - (retention_days * 86400 * 1000)
    with get_conn() as con:
        result = con.execute("DELETE FROM ticks WHERE ts < ?", [cutoff])
        return result.fetchone()[0] if result else 0
