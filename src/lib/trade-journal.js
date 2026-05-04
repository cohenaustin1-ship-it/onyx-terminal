// IMO Onyx Terminal — trade journal export
//
// Phase 3p.11. Audit-style CSV of every individual trade — different
// from the 1099-B (which only shows closed lots) and from the audit
// log (which shows app events). The trade journal is the raw record:
// every buy and sell with full context for compliance archive,
// performance analytics, or hand-off to a CPA who wants to see the
// full picture.
//
// Columns:
//   timestamp, iso_time, symbol, side, qty, price, notional, fee,
//   pnl_realized, account, broker, order_id, notes
//
// Most fields fall back gracefully when missing (paper-account trades
// have no broker / order_id; market-buy fills have no notes; etc.).
//
// Public exports:
//   exportTradeJournalCSV(trades, options)
//                              Returns RFC 4180-compliant CSV string.
//                              options: { fromTs, toTs, includePaper }

const csvEscape = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const isoFmt = (ts) => {
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toISOString();
};

export const exportTradeJournalCSV = (trades = [], options = {}) => {
  const headers = [
    'timestamp', 'iso_time', 'symbol', 'side', 'qty', 'price',
    'notional', 'fee', 'pnl_realized', 'account', 'broker',
    'order_id', 'notes',
  ];
  const lines = [headers.join(',')];

  // Filter window if provided
  const fromTs = Number.isFinite(options.fromTs) ? options.fromTs : -Infinity;
  const toTs   = Number.isFinite(options.toTs)   ? options.toTs   :  Infinity;

  // Sort newest-first for human readability of the export
  const sorted = [...trades]
    .filter(t => {
      const ts = Number(t.time) || 0;
      return ts >= fromTs && ts <= toTs;
    })
    .sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));

  for (const t of sorted) {
    const ts = Number(t.time) || 0;
    const qty = Number(t.size) || 0;
    const price = Number(t.price) || 0;
    const notional = qty * price;
    lines.push([
      csvEscape(ts),
      csvEscape(isoFmt(ts)),
      csvEscape(t.sym ?? ''),
      csvEscape(t.side ?? ''),
      csvEscape(qty.toFixed(8)),
      csvEscape(price.toFixed(8)),
      csvEscape(notional.toFixed(2)),
      csvEscape(Number.isFinite(t.fee) ? t.fee.toFixed(2) : ''),
      csvEscape(Number.isFinite(t.pnl) ? t.pnl.toFixed(2) : ''),
      csvEscape(t.account ?? 'paper'),
      csvEscape(t.broker ?? ''),
      csvEscape(t.orderId ?? t.order_id ?? ''),
      csvEscape(t.notes ?? ''),
    ].join(','));
  }
  return lines.join('\r\n');
};
