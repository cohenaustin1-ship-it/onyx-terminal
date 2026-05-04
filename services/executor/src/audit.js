// ─── Audit ledger ────────────────────────────────────────────────────────
// Every fill writes BOTH to Postgres (for queries) AND to a CSV file
// (for tax export). The CSV is the source of truth for accountants.

import fs from 'fs';
import path from 'path';
import { query } from './db.js';

const CSV_PATH = process.env.TRADES_CSV_PATH || './data/trades.csv';

const HEADER = 'date,time,user_id,symbol,side,qty,price,fees,net_amount,broker,strategy_id,run_id,broker_order_id\n';

function ensureCsvHeader() {
  const dir = path.dirname(CSV_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, HEADER);
  }
}

function csvEscape(s) {
  if (s === null || s === undefined) return '';
  const str = String(s);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function recordFill({
  user_id, strategy_id, run_id, symbol, side, qty, price, fees,
  broker_order_id, broker,
}) {
  const filled_at = new Date();
  const net_amount = side === 'buy'
    ? -(qty * price + fees)
    :  (qty * price - fees);

  // Postgres
  const { rows } = await query(`
    INSERT INTO trades
      (user_id, strategy_id, run_id, symbol, side, qty, price, fees,
       net_amount, broker_order_id, broker, filled_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING id
  `, [user_id, strategy_id, run_id, symbol, side, qty, price, fees,
      net_amount, broker_order_id, broker, filled_at]);
  const tradeId = rows[0].id;

  // CSV
  ensureCsvHeader();
  const row = [
    filled_at.toISOString().slice(0, 10),
    filled_at.toISOString().slice(11, 19),
    user_id, symbol, side, qty, price, fees, net_amount,
    broker, strategy_id ?? '', run_id ?? '', broker_order_id ?? '',
  ].map(csvEscape).join(',') + '\n';
  fs.appendFileSync(CSV_PATH, row);

  return { id: tradeId, filled_at, net_amount };
}

export async function streamCsv(res) {
  ensureCsvHeader();
  const stream = fs.createReadStream(CSV_PATH);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="onyx-trades.csv"');
  stream.pipe(res);
}

export async function recordRun({
  strategy_id, decision, blocker, safety_check, indicator_values,
  fill_price, fill_qty, order_id, error_message,
}) {
  const { rows } = await query(`
    INSERT INTO strategy_runs
      (strategy_id, decision, blocker, safety_check, indicator_values,
       fill_price, fill_qty, order_id, error_message)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id, ran_at
  `, [strategy_id, decision, blocker, safety_check, indicator_values,
      fill_price, fill_qty, order_id, error_message]);
  return rows[0];
}

export async function getRecentRuns(userId, limit = 100) {
  const { rows } = await query(`
    SELECT r.*, s.name AS strategy_name, s.symbol
    FROM strategy_runs r
    JOIN strategies s ON s.id = r.strategy_id
    WHERE s.user_id = $1
    ORDER BY r.ran_at DESC
    LIMIT $2
  `, [userId, limit]);
  return rows;
}

export async function countTradesToday(userId) {
  const { rows } = await query(`
    SELECT COUNT(*)::int AS n
    FROM trades
    WHERE user_id = $1
      AND filled_at >= NOW() - INTERVAL '1 day'
  `, [userId]);
  return rows[0].n;
}
