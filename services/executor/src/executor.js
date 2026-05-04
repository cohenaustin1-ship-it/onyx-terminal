// ─── Strategy executor — main orchestrator ───────────────────────────────
//
// Runs a single strategy through the full pipeline:
//   1. Pull bars from tick API
//   2. Compute indicators
//   3. Run safety check (entry rules + risk caps)
//   4. If passed AND auto_execute: place order via broker
//   5. Record run + fill to Postgres + CSV
//   6. Broadcast event to SPA WebSocket clients

import { query } from './db.js';
import { getOhlc } from './tickClient.js';
import { computeIndicators } from './indicators.js';
import { runSafetyCheck } from './safetyCheck.js';
import { createBroker } from './brokers/index.js';
import { recordFill, recordRun, countTradesToday } from './audit.js';
import { broadcast } from './eventBus.js';

const MAX_TRADES_PER_DAY = parseInt(process.env.MAX_TRADES_PER_DAY || '10', 10);
const MAX_TRADE_SIZE_USD = parseFloat(process.env.MAX_TRADE_SIZE_USD || '500');

// Notional sizing — figure out qty from a USD budget. Crude default: half
// the max trade size, rounded to 4 decimals. Real implementation would
// consider position sizing rules in the strategy.
function computeQty(price, budgetUsd) {
  if (!price || price <= 0) return 0;
  return Math.max(0, Math.floor((budgetUsd / price) * 10000) / 10000);
}

export async function runStrategy(strategyId, options = {}) {
  // 1. Load strategy
  const { rows } = await query('SELECT * FROM strategies WHERE id=$1', [strategyId]);
  if (!rows[0]) throw new Error(`strategy ${strategyId} not found`);
  const strategy = rows[0];

  // 2. Pull bars from tick API
  let bars;
  try {
    bars = await getOhlc(strategy.symbol, strategy.interval, 200);
  } catch (e) {
    const errRun = await recordRun({
      strategy_id: strategyId,
      decision: 'error',
      blocker: 'tick_api_unreachable',
      safety_check: { conditions: [], passed: false, error: e.message },
      indicator_values: null,
      error_message: e.message,
    });
    broadcast({ type: 'rejection', strategy_id: strategyId, reason: 'tick_api_unreachable', ts: Date.now() });
    return { decision: 'error', run_id: errRun.id };
  }

  if (bars.length < 30) {
    const skipRun = await recordRun({
      strategy_id: strategyId,
      decision: 'skipped',
      blocker: 'insufficient_data',
      safety_check: { conditions: [], passed: false },
      indicator_values: null,
    });
    return { decision: 'skipped', run_id: skipRun.id };
  }

  // 3. Compute indicators
  const indicators = computeIndicators(bars);

  // 4. Risk context
  const tradesToday = await countTradesToday(strategy.user_id);
  const lastBar = bars[bars.length - 1];
  const budget = strategy.risk_rules?.max_trade_size_usd ?? MAX_TRADE_SIZE_USD;
  const qty = computeQty(lastBar.close, budget);
  const notional = qty * lastBar.close;

  // 5. Safety check
  const safety = runSafetyCheck(strategy, indicators, {
    tradesToday,
    notional,
    maxTradesPerDay: MAX_TRADES_PER_DAY,
    maxTradeSizeUsd: budget,
  });

  // 6. If failed: log + broadcast + bail
  if (!safety.passed) {
    const run = await recordRun({
      strategy_id: strategyId,
      decision: 'blocked',
      blocker: safety.blocker,
      safety_check: safety,
      indicator_values: indicators,
    });
    broadcast({
      type: 'rejection',
      strategy_id: strategyId,
      strategy_name: strategy.name,
      symbol: strategy.symbol,
      blocker: safety.blocker,
      ts: Date.now(),
    });
    return { decision: 'blocked', blocker: safety.blocker, run_id: run.id };
  }

  // 7. If safety passed but auto_execute is off, just emit a signal
  if (!strategy.auto_execute && !options.force) {
    const run = await recordRun({
      strategy_id: strategyId,
      decision: 'skipped',
      blocker: 'auto_execute_disabled',
      safety_check: safety,
      indicator_values: indicators,
    });
    broadcast({
      type: 'signal',
      strategy_id: strategyId,
      strategy_name: strategy.name,
      symbol: strategy.symbol,
      side: strategy.side,
      price: lastBar.close,
      ts: Date.now(),
    });
    return { decision: 'signal', run_id: run.id };
  }

  // 8. Execute via broker
  const broker = createBroker();
  let order;
  try {
    order = await broker.placeOrder({
      symbol: strategy.symbol,
      side: strategy.side === 'short' ? 'sell' : 'buy',
      qty,
      price: lastBar.close,
      orderType: 'market',
    });
  } catch (e) {
    const run = await recordRun({
      strategy_id: strategyId,
      decision: 'error',
      blocker: 'broker_rejected',
      safety_check: safety,
      indicator_values: indicators,
      error_message: e.message,
    });
    broadcast({
      type: 'rejection',
      strategy_id: strategyId,
      blocker: 'broker_rejected',
      message: e.message,
      ts: Date.now(),
    });
    return { decision: 'error', error: e.message, run_id: run.id };
  }

  // 9. Record run + fill
  const run = await recordRun({
    strategy_id: strategyId,
    decision: 'executed',
    blocker: null,
    safety_check: safety,
    indicator_values: indicators,
    fill_price: order.filled_price,
    fill_qty: order.filled_qty,
    order_id: order.id,
  });
  await recordFill({
    user_id: strategy.user_id,
    strategy_id: strategyId,
    run_id: run.id,
    symbol: strategy.symbol,
    side: order.side,
    qty: order.filled_qty,
    price: order.filled_price,
    fees: order.fees || 0,
    broker_order_id: order.id,
    broker: broker.name,
  });
  broadcast({
    type: 'fill',
    strategy_id: strategyId,
    strategy_name: strategy.name,
    symbol: strategy.symbol,
    side: order.side,
    qty: order.filled_qty,
    price: order.filled_price,
    broker: broker.name,
    ts: Date.now(),
  });

  return { decision: 'executed', run_id: run.id, order };
}

// Run all enabled+auto strategies whose interval matches the current cron tick
export async function runAllStrategiesForInterval(interval) {
  const { rows } = await query(`
    SELECT id FROM strategies
    WHERE enabled = TRUE AND interval = $1
  `, [interval]);
  const results = [];
  for (const { id } of rows) {
    try {
      const r = await runStrategy(id);
      results.push({ id, ...r });
    } catch (e) {
      console.error(`[executor] strategy ${id} crashed:`, e);
      results.push({ id, decision: 'error', error: e.message });
    }
  }
  return results;
}
