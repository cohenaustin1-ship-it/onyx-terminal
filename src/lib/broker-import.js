// IMO Onyx Terminal — cross-account broker CSV import
//
// Phase 3p.11. Lets users paste/upload CSV exports from external
// brokers (Schwab, Fidelity, Robinhood) and produces internal trade
// records compatible with the rest of the tax pipeline. Without this,
// the wash-sale detector and tax-loss harvester only see the in-app
// paper account — which is a real institutional gap because real
// users hold multiple accounts.
//
// Supported formats (initial pass — extensible via heuristics):
//   - Schwab    "Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
//   - Fidelity  "Run Date","Account","Action","Symbol","Description","Type","Exchange Quantity","Exchange Currency","Quantity","Currency","Price","Exchange Rate","Commission","Fees","Accrued Interest","Amount","Cash Balance","Settlement Date"
//   - Robinhood "Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"
//
// Auto-detection looks at the header row and picks a parser. Falls
// back to a generic parser that tries the most common column names.
//
// Output: array of { sym, side, size, price, time, broker, account,
//                    fee, source: 'imported' }
//
// Honest scope:
//   - Skips non-trade rows (dividends, transfers, interest) silently
//     UNLESS the caller passes opts.warnOnSkip=true (then collected
//     in the `skipped` array of the result).
//   - Doesn't reconcile against existing in-app trades — duplicate
//     imports are the caller's problem (typically dedup by date+sym
//     is handled at the import-time UI).
//   - Date parsing assumes US-style mm/dd/yyyy for Schwab/Fidelity
//     (their default) and ISO yyyy-mm-dd otherwise. Some brokers use
//     dd/mm/yyyy; the user has to clean up before importing in that
//     case.
//
// Public exports:
//   parseBrokerCSV(csvText, opts)
//                              Auto-detects format, returns
//                              { trades, skipped, format }
//   detectCSVFormat(headerLine)
//                              Returns 'schwab' | 'fidelity' |
//                              'robinhood' | 'generic'

const parseCSVLine = (line) => {
  // Simple CSV row parser handling quoted fields with embedded commas.
  // Not a full RFC 4180 parser (no multi-line quoted fields) but
  // sufficient for broker exports which are single-line per record.
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"')                   { inQuotes = false; }
      else                                    { cur += ch; }
    } else {
      if (ch === ',')      { out.push(cur); cur = ''; }
      else if (ch === '"') { inQuotes = true; }
      else                  { cur += ch; }
    }
  }
  out.push(cur);
  return out;
};

const parseUSDate = (s) => {
  if (!s) return 0;
  // mm/dd/yyyy or m/d/yyyy
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return new Date(+m[3], +m[1] - 1, +m[2]).getTime();
  }
  // ISO fallback
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : 0;
};

const cleanNumber = (s) => {
  if (typeof s === 'number') return s;
  if (!s) return NaN;
  // Remove $, commas, parentheses (negative)
  let str = String(s).trim().replace(/[$,]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(str)) { neg = true; str = str.slice(1, -1); }
  const n = parseFloat(str);
  return neg ? -n : n;
};

export const detectCSVFormat = (headerLine) => {
  if (!headerLine) return 'generic';
  const h = headerLine.toLowerCase();
  // Schwab — has "Fees & Comm" column
  if (h.includes('fees & comm')) return 'schwab';
  // Fidelity — has "Run Date" + "Settlement Date"
  if (h.includes('run date') && h.includes('settlement date')) return 'fidelity';
  // Robinhood — has "Activity Date" + "Trans Code"
  if (h.includes('activity date') && h.includes('trans code')) return 'robinhood';
  return 'generic';
};

// Map a broker-specific action string → our internal side ('buy'/'sell')
// or null if it's a non-trade row we should skip.
const mapAction = (action) => {
  if (!action) return null;
  const a = String(action).toLowerCase().trim();
  if (a.includes('buy'))  return 'buy';
  if (a.includes('sell')) return 'sell';
  // Common non-trade actions that appear in broker statements
  if (a.includes('dividend') || a.includes('interest') ||
      a.includes('transfer') || a.includes('deposit') ||
      a.includes('withdrawal') || a.includes('fee')) return null;
  return null;
};

const parseSchwabRow = (cols, headerMap) => {
  const action = cols[headerMap['action']];
  const side = mapAction(action);
  if (!side) return null;
  const sym = (cols[headerMap['symbol']] || '').trim().toUpperCase();
  if (!sym) return null;
  const qty = Math.abs(cleanNumber(cols[headerMap['quantity']]));
  const price = cleanNumber(cols[headerMap['price']]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    sym, side, size: qty, price,
    time: parseUSDate(cols[headerMap['date']]),
    fee:  cleanNumber(cols[headerMap['fees & comm']]) || 0,
    broker: 'schwab',
    source: 'imported',
  };
};

const parseFidelityRow = (cols, headerMap) => {
  const action = cols[headerMap['action']];
  const side = mapAction(action);
  if (!side) return null;
  const sym = (cols[headerMap['symbol']] || '').trim().toUpperCase();
  if (!sym) return null;
  const qty = Math.abs(cleanNumber(cols[headerMap['quantity']]));
  const price = cleanNumber(cols[headerMap['price']]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    sym, side, size: qty, price,
    time: parseUSDate(cols[headerMap['run date']]),
    fee: (cleanNumber(cols[headerMap['commission']]) || 0)
       + (cleanNumber(cols[headerMap['fees']]) || 0),
    account: cols[headerMap['account']] || '',
    broker: 'fidelity',
    source: 'imported',
  };
};

const parseRobinhoodRow = (cols, headerMap) => {
  const code = cols[headerMap['trans code']];
  const a = String(code || '').toUpperCase();
  // Robinhood codes: 'Buy', 'Sell', 'BTO' (buy to open), 'STC' etc.
  let side = null;
  if (a === 'BUY' || a === 'BTO' || a === 'BTC') side = 'buy';
  else if (a === 'SELL' || a === 'STO' || a === 'STC') side = 'sell';
  if (!side) return null;
  const sym = (cols[headerMap['instrument']] || '').trim().toUpperCase();
  if (!sym) return null;
  const qty = Math.abs(cleanNumber(cols[headerMap['quantity']]));
  const price = cleanNumber(cols[headerMap['price']]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    sym, side, size: qty, price,
    time: parseUSDate(cols[headerMap['activity date']]),
    fee: 0,
    broker: 'robinhood',
    source: 'imported',
  };
};

const parseGenericRow = (cols, headerMap) => {
  // Try common column-name variants
  const sideRaw = cols[headerMap['side']] ?? cols[headerMap['action']]
              ?? cols[headerMap['type']];
  const side = mapAction(sideRaw);
  if (!side) return null;
  const sym = (cols[headerMap['symbol']] ?? cols[headerMap['ticker']]
            ?? cols[headerMap['instrument']] ?? '').trim().toUpperCase();
  if (!sym) return null;
  const qty = Math.abs(cleanNumber(cols[headerMap['quantity']] ?? cols[headerMap['size']]));
  const price = cleanNumber(cols[headerMap['price']]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  const time = parseUSDate(cols[headerMap['date']] ?? cols[headerMap['timestamp']] ?? '');
  return {
    sym, side, size: qty, price, time,
    fee: 0,
    broker: 'imported',
    source: 'imported',
  };
};

export const parseBrokerCSV = (csvText, opts = {}) => {
  if (!csvText || typeof csvText !== 'string') {
    return { trades: [], skipped: [], format: 'generic' };
  }
  // Normalize line endings + drop blank lines
  const rawLines = csvText.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length);
  if (rawLines.length < 2) {
    return { trades: [], skipped: [], format: 'generic' };
  }

  const format = detectCSVFormat(rawLines[0]);
  const headerCols = parseCSVLine(rawLines[0]).map(h => h.toLowerCase().trim());
  const headerMap = {};
  headerCols.forEach((h, i) => { headerMap[h] = i; });

  const parser = format === 'schwab'    ? parseSchwabRow
              : format === 'fidelity'   ? parseFidelityRow
              : format === 'robinhood'  ? parseRobinhoodRow
              :                            parseGenericRow;

  const trades = [];
  const skipped = [];
  for (let i = 1; i < rawLines.length; i++) {
    const cols = parseCSVLine(rawLines[i]);
    try {
      const t = parser(cols, headerMap);
      if (t) trades.push(t);
      else if (opts.warnOnSkip) skipped.push({ line: i + 1, raw: rawLines[i] });
    } catch (err) {
      if (opts.warnOnSkip) skipped.push({ line: i + 1, raw: rawLines[i], error: String(err) });
    }
  }

  // Sort newest-first to match the buildRoundTrips / tax-pipeline
  // convention. CSV exports are typically chronological (oldest-first)
  // but the rest of the app stores trades newest-first.
  trades.sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));

  return { trades, skipped, format };
};
