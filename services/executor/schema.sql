-- ════════════════════════════════════════════════════════════════════════
-- Onyx Executor — Postgres schema
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS strategies (
    id              SERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL,
    name            TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    interval        TEXT NOT NULL,                -- '1m' | '5m' | '1h' | '1d'
    side            TEXT NOT NULL DEFAULT 'long', -- 'long' | 'short'
    entry_rules     JSONB NOT NULL,               -- array of { name, expr }
    exit_rules      JSONB NOT NULL DEFAULT '[]',
    risk_rules      JSONB NOT NULL DEFAULT '{}',  -- { max_trade_size_usd, ... }
    auto_execute    BOOLEAN NOT NULL DEFAULT FALSE,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategies_user        ON strategies(user_id);
CREATE INDEX IF NOT EXISTS idx_strategies_enabled     ON strategies(enabled, auto_execute);
CREATE INDEX IF NOT EXISTS idx_strategies_interval    ON strategies(interval);

CREATE TABLE IF NOT EXISTS strategy_runs (
    id              SERIAL PRIMARY KEY,
    strategy_id     INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    ran_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decision        TEXT NOT NULL,                -- 'executed' | 'blocked' | 'skipped' | 'error'
    blocker         TEXT,                         -- which condition failed (or null)
    safety_check    JSONB NOT NULL,               -- full {conditions, passed} record
    indicator_values JSONB,
    fill_price      DOUBLE PRECISION,
    fill_qty        DOUBLE PRECISION,
    order_id        TEXT,                         -- broker-side ID
    error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_strategy ON strategy_runs(strategy_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_recent   ON strategy_runs(ran_at DESC);

CREATE TABLE IF NOT EXISTS trades (
    id              SERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL,
    strategy_id     INTEGER REFERENCES strategies(id) ON DELETE SET NULL,
    run_id          INTEGER REFERENCES strategy_runs(id) ON DELETE SET NULL,
    symbol          TEXT NOT NULL,
    side            TEXT NOT NULL,                -- 'buy' | 'sell'
    qty             DOUBLE PRECISION NOT NULL,
    price           DOUBLE PRECISION NOT NULL,
    fees            DOUBLE PRECISION NOT NULL DEFAULT 0,
    net_amount      DOUBLE PRECISION NOT NULL,    -- price*qty - fees (signed by side)
    broker_order_id TEXT,
    broker          TEXT NOT NULL DEFAULT 'paper',
    filled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    realized_pnl    DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_trades_user_filled ON trades(user_id, filled_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_symbol      ON trades(symbol);

-- A simple per-user position view, computed from trades. Lightweight enough
-- to recompute on demand.
CREATE OR REPLACE VIEW positions AS
SELECT
    user_id,
    symbol,
    SUM(CASE WHEN side='buy' THEN qty ELSE -qty END) AS net_qty,
    SUM(CASE WHEN side='buy' THEN qty * price ELSE -qty * price END) AS net_cost
FROM trades
GROUP BY user_id, symbol
HAVING ABS(SUM(CASE WHEN side='buy' THEN qty ELSE -qty END)) > 0.0000001;

-- ════════════════════════════════════════════════════════════════════════
-- NAV HISTORY — daily portfolio NAV snapshots per user
-- ════════════════════════════════════════════════════════════════════════
-- Replaces / complements the localStorage NAV history that the frontend
-- currently maintains. Backend persistence enables:
--   - Cross-device continuity (mobile ↔ desktop)
--   - Survives browser cache clears
--   - Aggregation over true 365-day windows even with infrequent logins
--
-- Frontend writes one NAV reading per day per user; if multiple writes
-- on same day, the unique constraint causes ON CONFLICT update to keep
-- the latest reading.
CREATE TABLE IF NOT EXISTS nav_history (
    id              SERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL,
    as_of_date      DATE NOT NULL,
    nav_usd         DOUBLE PRECISION NOT NULL,
    cash_usd        DOUBLE PRECISION,                 -- NULL = unknown
    invested_usd    DOUBLE PRECISION,                 -- equity portion only
    deposits_usd    DOUBLE PRECISION DEFAULT 0,       -- net deposits since prev snapshot
    source          TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'broker' | 'paper'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nav_user_date_uniq
    ON nav_history(user_id, as_of_date);
CREATE INDEX IF NOT EXISTS idx_nav_user_recent
    ON nav_history(user_id, as_of_date DESC);

-- ════════════════════════════════════════════════════════════════════════
-- Snippets — user-saved code/markdown/config snippets with cloud sync
-- (Phase 3p.11 / Addition 1)
-- ════════════════════════════════════════════════════════════════════════
--
-- Conflict resolution model: last-write-wins via updated_at + version.
-- Client sends its known `version`; server rejects writes where the
-- stored version is higher than the client's, returning HTTP 409 with
-- the server copy so the client can show a merge UI. Pure additive
-- sync (no deletes) for safety — clients soft-delete by setting
-- archived=true.

CREATE TABLE IF NOT EXISTS snippets (
    id              SERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL,
    client_id       TEXT NOT NULL,                -- stable client-side UUID
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'note', -- 'note' | 'code' | 'config'
    tags            JSONB NOT NULL DEFAULT '[]',
    version         INTEGER NOT NULL DEFAULT 1,   -- bumps on every server write
    archived        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_snippets_user_updated
  ON snippets(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_snippets_user_kind
  ON snippets(user_id, kind);
