// IMO Onyx Terminal — tax reporting (1099-B / Schedule D export)
//
// Phase 3p.08 (institutional compliance feature). Generates IRS-style
// tax reports from realized round-trip trades.
//
// Phase 3p.09 (wash-sale detection). The buildTaxLotReport function
// now scans for wash sales per IRS Pub 550:
//   - A wash sale occurs when a security is sold at a loss AND a
//     substantially-identical security is purchased within ±30 days
//     of the sale (a 61-day window centered on the sale date).
//   - The disallowed loss is flagged with code 'W' on the 1099-B.
//   - "Substantially identical" uses the same heuristic as the
//     tax-loss harvesting recommender: same ticker, or one of the
//     known equivalent-pair groups (S&P 500 trackers, etc.).
//
// Output formats:
//   1099-B  — broker substitute statement format (Form 1099-B box-style
//              columns). Used for sale proceeds reporting to IRS.
//              Columns: 1a Description, 1b Date acquired, 1c Date sold,
//              1d Proceeds, 1e Cost basis, 1f Wash sale loss disallowed,
//              1g Code (W for wash sale, etc.), 4 Federal income tax
//              withheld, 14 State, 15 State id no., 16 State tax withheld.
//
//   Schedule D — taxpayer's worksheet for capital gains/losses, broken
//              out by short-term vs long-term holding period.
//              Long-term = held > 1 year.
//
// What this module does NOT do (be honest about scope):
//   - Wash sale across accounts (we only see this account's trades)
//   - Section 1256 mark-to-market for futures/regulated commodities
//   - Foreign tax credit (Form 1116)
//   - State-specific reporting (each state has its own forms)
//   - Cost-basis adjustments for corporate actions (splits, M&A,
//     spin-offs)
//
// The output is suitable as a STARTING POINT for tax prep software
// (TurboTax CSV import, H&R Block, etc.) or for handing to a CPA. It
// is NOT a substitute for filing the actual IRS forms — those should
// be reviewed by a tax professional.
//
// Public exports:
//   buildTaxLotReport(trades, options)
//                              Aggregates trades into per-lot rows
//                              with proceeds, basis, gain/loss, and
//                              short/long-term classification.
//                              Now also detects wash sales (Phase 3p.09).
//                              Returns: { rows, summary, taxYear }
//   exportSchedule1099B(report)
//                              RFC 4180-compliant CSV in 1099-B column
//                              order, one row per closed lot.
//   exportScheduleD(report)
//                              Schedule D summary CSV — short-term
//                              proceeds/basis/gain, long-term ditto.
//   filterByTaxYear(report, year)
//                              Subset to a calendar year (sale date
//                              within Jan 1 – Dec 31).
//   detectWashSales(trades, trips)
//                              Phase 3p.09. Standalone wash-sale
//                              scanner — exposed for testing and for
//                              consumers who want the analysis without
//                              building the full report.

import { buildRoundTrips } from './quant/quant-misc.js';
import { areSubstantiallyIdentical } from './quant/tax-lots.js';

// IRS classification: long-term if held > 1 year. Boundary case (held
// exactly 1 year) is short-term per Pub 550.
const ONE_YEAR_MS = 365.25 * 86400000;
const isLongTerm = (entryTs, exitTs) => {
  return (exitTs - entryTs) > ONE_YEAR_MS;
};

// Wash sale window: ±30 days from the sale date, INCLUSIVE on both
// sides. IRS Pub 550 says "30 days before or after" without further
// qualification; the convention is to include the sale day itself in
// neither window (so total = 30 + 1 + 30 = 61 days centered on sale).
const WASH_SALE_WINDOW_MS = 30 * 86400000;

// detectWashSales — given the original trade list and the round-trips,
// flag each trip with whether it triggered a wash sale.
//
// Algorithm:
//   1. Walk every loss-producing round-trip (gain < 0).
//   2. For each loss-trip, scan the ORIGINAL trades for any 'buy'
//      that:
//        a) was placed within ±30 days of the loss-trip's exitTime
//        b) is for a substantially-identical security (same ticker,
//           or same equivalent group via TLH_SWAP_MAP)
//        c) is NOT the buy that opened this same trip (we don't want
//           the original buy to count as a "replacement")
//   3. If any qualifying replacement exists, the loss is disallowed.
//      The disallowed amount equals the loss (capped at the qty of
//      the replacement; we approximate as the full loss since most
//      retail wash sales are full-replacement).
//
// Returns a Map keyed by a stable trip identifier (we use
// `${ticker}|${entryTime}|${exitTime}|${qty}`) → {
//   washSale: boolean,
//   washSaleAdj: number (always >= 0),
//   replacementSym: string | null,
//   replacementTime: number | null,
// }
//
// Note on accuracy:
//   The IRS rule technically apportions the disallowed loss across
//   the qty of replacement shares; if you sold 100 at a loss but
//   only re-bought 50 within the window, only HALF the loss is
//   disallowed. This implementation flags the full loss as
//   disallowed if ANY qualifying replacement exists — which is
//   conservative (over-reports the disallowance, never under-reports).
//   This is the safer default; commercial tax software handles the
//   apportionment math.
export const detectWashSales = (trades, trips) => {
  const result = new Map();
  if (!Array.isArray(trades) || !Array.isArray(trips)) return result;

  // Index trades by symbol for the substantially-identical check.
  // Each entry is { time, sym, side, size, price, raw } with
  // numeric time. We only care about buys for replacement detection.
  const buyTradesBySym = {};
  for (const t of trades) {
    if (t.side !== 'buy' || !t.sym) continue;
    const time = Number(t.time) || 0;
    const sym  = String(t.sym);
    if (!buyTradesBySym[sym]) buyTradesBySym[sym] = [];
    buyTradesBySym[sym].push({ time, sym, raw: t });
  }

  for (const trip of trips) {
    const tripKey = `${trip.ticker}|${trip.entryTime}|${trip.exitTime}|${trip.qty}`;
    const loss = trip.pnl;
    // Only losses can be wash sales — gains are unaffected.
    if (loss >= 0) {
      result.set(tripKey, { washSale: false, washSaleAdj: 0, replacementSym: null, replacementTime: null });
      continue;
    }

    const lossTime = Number(trip.exitTime) || 0;
    const windowStart = lossTime - WASH_SALE_WINDOW_MS;
    const windowEnd   = lossTime + WASH_SALE_WINDOW_MS;

    // Search every symbol that's substantially-identical to the loss
    // ticker. Including the ticker itself.
    let replacementSym = null;
    let replacementTime = null;
    for (const sym of Object.keys(buyTradesBySym)) {
      if (!areSubstantiallyIdentical(trip.ticker, sym)) continue;
      for (const buy of buyTradesBySym[sym]) {
        // Skip the original entry buy (matching exact entry time)
        if (sym === trip.ticker && buy.time === trip.entryTime) continue;
        if (buy.time < windowStart || buy.time > windowEnd) continue;
        // Don't count the loss-sale day itself in either window
        // (the sale and the buy can't be the same instant).
        if (buy.time === lossTime) continue;
        replacementSym = sym;
        replacementTime = buy.time;
        break;
      }
      if (replacementSym) break;
    }

    if (replacementSym) {
      // Disallowed amount = absolute value of the loss
      // (over-reports vs apportionment — see header note)
      result.set(tripKey, {
        washSale: true,
        washSaleAdj: Math.abs(loss),
        replacementSym,
        replacementTime,
      });
    } else {
      result.set(tripKey, {
        washSale: false, washSaleAdj: 0,
        replacementSym: null, replacementTime: null,
      });
    }
  }

  return result;
};

// Convert a trade time field to a Date timestamp. Trades may store
// time as HH:MM:SS (legacy local), as an ISO string, or as a number.
// We accept all three; missing/unparseable falls back to 0.
const isoDate = (ts) => {
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
};

// Convert a trade time field to a Date timestamp. Trades may store
// time as HH:MM:SS (legacy local), as an ISO string, or as a number.
const toTs = (t) => {
  if (Number.isFinite(t)) return t;
  if (typeof t === 'string') {
    const n = Date.parse(t);
    if (Number.isFinite(n)) return n;
    // HH:MM:SS without a date — treat as today (best-effort)
    if (/^\d{1,2}:\d{2}/.test(t)) {
      const [hh, mm, ss = '0'] = t.split(':');
      const d = new Date();
      d.setHours(+hh, +mm, +ss, 0);
      return d.getTime();
    }
  }
  return 0;
};

export const buildTaxLotReport = (trades = [], options = {}) => {
  // Normalize trades to have numeric timestamps. buildRoundTrips
  // already pairs buys with sells FIFO; we extend each round-trip
  // with tax-relevant fields (basis, proceeds, gain, hold-period
  // classification, wash-sale code).
  const normalized = trades.map(t => ({
    ...t,
    time: toTs(t.time ?? t.timestamp ?? t.date),
  }));

  const trips = buildRoundTrips(normalized);

  // Phase 3p.09: scan for wash sales BEFORE constructing rows so each
  // row gets the correct code + washSaleAdj.
  const washSales = detectWashSales(normalized, trips);

  const rows = trips.map((trip, idx) => {
    const proceeds = trip.exitPrice * trip.qty;
    const basis    = trip.entryPrice * trip.qty;
    const gain     = proceeds - basis;
    const longTerm = isLongTerm(trip.entryTime, trip.exitTime);
    const tripKey = `${trip.ticker}|${trip.entryTime}|${trip.exitTime}|${trip.qty}`;
    const ws = washSales.get(tripKey) ?? { washSale: false, washSaleAdj: 0, replacementSym: null, replacementTime: null };
    return {
      idx: idx + 1,
      ticker:       trip.ticker,
      qty:          trip.qty,
      acquiredDate: isoDate(trip.entryTime),
      soldDate:     isoDate(trip.exitTime),
      proceeds:     +proceeds.toFixed(2),
      basis:        +basis.toFixed(2),
      gain:         +gain.toFixed(2),
      term:         longTerm ? 'long' : 'short',
      // Wash sale fields populated by detectWashSales above.
      // code='W' is the IRS box-1g designation for wash sales.
      // washSaleAdj is the disallowed loss amount (always >= 0).
      // replacementSym/Time tell the user WHY the loss was flagged.
      code:         ws.washSale ? 'W' : '',
      washSaleAdj:  +ws.washSaleAdj.toFixed(2),
      replacementSym:  ws.replacementSym,
      replacementTime: ws.replacementTime,
    };
  });

  // Summary buckets for Schedule D.
  // gainAfterWash = gain + washSaleAdj (the disallowed loss is added
  // back, since the IRS doesn't recognize it for the year). We track
  // both so the UI / CSV can show pre-wash and post-wash totals.
  const summary = {
    short: { proceeds: 0, basis: 0, gain: 0, washSaleAdj: 0, gainAfterWash: 0, count: 0 },
    long:  { proceeds: 0, basis: 0, gain: 0, washSaleAdj: 0, gainAfterWash: 0, count: 0 },
    total: { proceeds: 0, basis: 0, gain: 0, washSaleAdj: 0, gainAfterWash: 0, count: rows.length },
  };
  for (const r of rows) {
    const bucket = summary[r.term];
    bucket.proceeds    += r.proceeds;
    bucket.basis       += r.basis;
    bucket.gain        += r.gain;
    bucket.washSaleAdj += r.washSaleAdj;
    bucket.count       += 1;
    summary.total.proceeds    += r.proceeds;
    summary.total.basis       += r.basis;
    summary.total.gain        += r.gain;
    summary.total.washSaleAdj += r.washSaleAdj;
  }
  // Compute gain-after-wash (disallowed losses are added back to gain)
  for (const bucket of [summary.short, summary.long, summary.total]) {
    bucket.gainAfterWash = bucket.gain + bucket.washSaleAdj;
    bucket.proceeds      = +bucket.proceeds.toFixed(2);
    bucket.basis         = +bucket.basis.toFixed(2);
    bucket.gain          = +bucket.gain.toFixed(2);
    bucket.washSaleAdj   = +bucket.washSaleAdj.toFixed(2);
    bucket.gainAfterWash = +bucket.gainAfterWash.toFixed(2);
  }

  return {
    rows,
    summary,
    taxYear: options.taxYear ?? null,
    generatedAt: Date.now(),
  };
};

export const filterByTaxYear = (report, year) => {
  if (!report || !Number.isFinite(year)) return report;
  const y = String(year);
  const rows = report.rows.filter(r => r.soldDate.startsWith(y));
  const summary = {
    short: { proceeds: 0, basis: 0, gain: 0, washSaleAdj: 0, gainAfterWash: 0, count: 0 },
    long:  { proceeds: 0, basis: 0, gain: 0, washSaleAdj: 0, gainAfterWash: 0, count: 0 },
    total: { proceeds: 0, basis: 0, gain: 0, washSaleAdj: 0, gainAfterWash: 0, count: rows.length },
  };
  for (const r of rows) {
    const bucket = summary[r.term];
    bucket.proceeds    += r.proceeds;
    bucket.basis       += r.basis;
    bucket.gain        += r.gain;
    bucket.washSaleAdj += r.washSaleAdj;
    bucket.count       += 1;
    summary.total.proceeds    += r.proceeds;
    summary.total.basis       += r.basis;
    summary.total.gain        += r.gain;
    summary.total.washSaleAdj += r.washSaleAdj;
  }
  for (const bucket of [summary.short, summary.long, summary.total]) {
    bucket.gainAfterWash = bucket.gain + bucket.washSaleAdj;
    bucket.proceeds      = +bucket.proceeds.toFixed(2);
    bucket.basis         = +bucket.basis.toFixed(2);
    bucket.gain          = +bucket.gain.toFixed(2);
    bucket.washSaleAdj   = +bucket.washSaleAdj.toFixed(2);
    bucket.gainAfterWash = +bucket.gainAfterWash.toFixed(2);
  }
  return { ...report, rows, summary, taxYear: year };
};

// CSV escape per RFC 4180
const csvEscape = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

export const exportSchedule1099B = (report) => {
  if (!report || !Array.isArray(report.rows)) return '';
  const headers = [
    '1a_Description',           // qty + ticker
    '1b_DateAcquired',          // YYYY-MM-DD
    '1c_DateSold',              // YYYY-MM-DD
    '1d_Proceeds',              // gross proceeds (USD)
    '1e_CostBasis',             // adjusted basis (USD)
    '1f_WashSaleLossDisallowed',// USD
    '1g_Code',                  // W for wash sale
    '2_Term',                   // short / long
    'RealizedGainLoss',         // 1d - 1e (computed convenience)
  ];
  const lines = [headers.join(',')];
  for (const r of report.rows) {
    lines.push([
      csvEscape(`${r.qty} sh ${r.ticker}`),
      csvEscape(r.acquiredDate),
      csvEscape(r.soldDate),
      csvEscape(r.proceeds.toFixed(2)),
      csvEscape(r.basis.toFixed(2)),
      csvEscape(r.washSaleAdj.toFixed(2)),
      csvEscape(r.code),
      csvEscape(r.term === 'long' ? 'long-term' : 'short-term'),
      csvEscape(r.gain.toFixed(2)),
    ].join(','));
  }
  return lines.join('\r\n');
};

export const exportScheduleD = (report) => {
  if (!report || !report.summary) return '';
  const headers = ['Term', 'Count', 'Proceeds', 'CostBasis', 'GainLoss',
                   'WashSaleAdj', 'GainAfterWash'];
  const fmt = (s, name) =>
    [name, s.count,
     s.proceeds.toFixed(2), s.basis.toFixed(2), s.gain.toFixed(2),
     s.washSaleAdj.toFixed(2), s.gainAfterWash.toFixed(2),
    ].map(csvEscape).join(',');
  return [
    headers.join(','),
    fmt(report.summary.short, 'Short-term'),
    fmt(report.summary.long,  'Long-term'),
    fmt(report.summary.total, 'Total'),
  ].join('\r\n');
};
