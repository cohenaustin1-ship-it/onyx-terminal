// IMO Onyx Terminal — cross-account holdings reconciliation
//
// Phase 3p.13 / Feature 1. Aggregates position data from multiple
// brokers (in-app paper account, imported Schwab/Fidelity/Robinhood
// CSVs, manual entries) and shows side-by-side per-symbol holdings
// with detected discrepancies.
//
// Why this matters:
//   - The wash-sale detector in 3p.09 only sees in-account trades.
//     Cross-account import (3p.11) lets us pull Schwab/Fidelity in,
//     but the user still has no view of "I own 500 AAPL across 3
//     brokers" — they just see one consolidated trade list.
//   - Real institutional reconciliation involves comparing what the
//     broker says you hold vs what your trade history implies you
//     hold. A delta usually means a missed corporate action, a
//     transfer, or (rarely) a broker accounting error.
//
// Public exports:
//   buildHoldingsReconciliation({ accounts, computedFromTrades, opts })
//                              accounts: array of { broker, name, holdings: [...] }
//                                where holdings is [{ sym, qty, avgCost?, mark? }]
//                              computedFromTrades: optional { [broker]: holdings }
//                                derived from trade history; if provided, we
//                                compare reported vs computed to detect discrepancies
//                              Returns: { rows, summary, discrepancies }
//
//   buildHoldingsFromTrades(trades)
//                              Compute current open positions from a trade list
//                              (FIFO close-out). Returns [{ sym, qty, avgCost }].
//
// Honest scope:
//   - Doesn't model fractional shares with sub-cent prices (rounded
//     to standard 8-decimal precision).
//   - Doesn't reconcile against intraday timing (a trade pending
//     settlement at the broker but already in our trade history will
//     show as a discrepancy).
//   - Avg cost from trades uses FIFO basis. If the user elects HIFO/
//     LIFO at the broker, the reported avg cost can legitimately
//     differ from the computed value — we surface the delta either way.

const EPSILON_QTY = 0.00000001; // 8-decimal precision threshold

export const buildHoldingsFromTrades = (trades = []) => {
  // Pair buys with sells FIFO; whatever's left in openLots is the
  // current holding.
  if (!Array.isArray(trades) || trades.length === 0) return [];
  // Sort ascending so we process oldest first
  const ordered = [...trades].sort((a, b) =>
    (Number(a.time) || 0) - (Number(b.time) || 0));

  const openLots = {}; // sym → array of { qty, price }

  for (const t of ordered) {
    const sym = t.sym;
    if (!sym) continue;
    const qty = parseFloat(t.size) || 0;
    const px  = parseFloat(t.price) || 0;
    if (qty <= 0 || px <= 0) continue;
    if (!openLots[sym]) openLots[sym] = [];
    if (t.side === 'buy') {
      openLots[sym].push({ qty, price: px });
    } else if (t.side === 'sell') {
      let remaining = qty;
      while (remaining > 0 && openLots[sym].length > 0) {
        const lot = openLots[sym][0];
        const matched = Math.min(remaining, lot.qty);
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 0) openLots[sym].shift();
      }
    }
  }

  // Aggregate remaining open lots into per-symbol totals
  const holdings = [];
  for (const sym of Object.keys(openLots)) {
    const lots = openLots[sym];
    if (lots.length === 0) continue;
    const totalQty = lots.reduce((s, l) => s + l.qty, 0);
    if (totalQty <= EPSILON_QTY) continue;
    const totalCost = lots.reduce((s, l) => s + l.qty * l.price, 0);
    holdings.push({
      sym,
      qty: +totalQty.toFixed(8),
      avgCost: totalQty > 0 ? +(totalCost / totalQty).toFixed(4) : 0,
    });
  }
  return holdings.sort((a, b) => a.sym.localeCompare(b.sym));
};

export const buildHoldingsReconciliation = ({
  accounts = [],
  computedFromTrades = null,
  opts = {},
}) => {
  // Collect every (broker, sym, qty, avgCost, mark) tuple
  const universe = new Set();
  const byBrokerSym = {}; // `${broker}|${sym}` → { qty, avgCost, mark, source }

  for (const acct of accounts) {
    if (!acct || !Array.isArray(acct.holdings)) continue;
    const broker = acct.broker || 'unknown';
    for (const h of acct.holdings) {
      if (!h.sym) continue;
      universe.add(h.sym);
      const key = `${broker}|${h.sym}`;
      byBrokerSym[key] = {
        broker,
        sym: h.sym,
        qty: Number(h.qty) || 0,
        avgCost: Number.isFinite(h.avgCost) ? Number(h.avgCost) : null,
        mark: Number.isFinite(h.mark) ? Number(h.mark) : null,
        source: 'reported',
      };
    }
  }

  // Add symbols that exist only in trade-derived holdings
  if (computedFromTrades) {
    for (const broker of Object.keys(computedFromTrades)) {
      for (const h of computedFromTrades[broker]) {
        universe.add(h.sym);
      }
    }
  }

  // Build per-symbol rows: one row per ticker, showing qty per broker
  // and an aggregated total
  const allBrokers = Array.from(new Set(accounts.map(a => a.broker || 'unknown')));
  const rows = [];
  const discrepancies = [];

  for (const sym of Array.from(universe).sort()) {
    const perBroker = {};
    let totalQty = 0;
    let totalCostBasis = 0;
    let totalMarket = 0;

    for (const broker of allBrokers) {
      const reported = byBrokerSym[`${broker}|${sym}`];
      const computed = computedFromTrades?.[broker]?.find(h => h.sym === sym);

      const reportedQty = reported ? reported.qty : 0;
      const computedQty = computed ? computed.qty : 0;

      perBroker[broker] = {
        reportedQty,
        computedQty,
        avgCost: reported?.avgCost ?? computed?.avgCost ?? null,
        mark:    reported?.mark ?? null,
        delta:   +(reportedQty - computedQty).toFixed(8),
      };

      // Discrepancy if reported and computed differ (and both are non-zero)
      if (computed && reported &&
          Math.abs(reportedQty - computedQty) > EPSILON_QTY) {
        discrepancies.push({
          sym, broker,
          reportedQty,
          computedQty,
          delta: +(reportedQty - computedQty).toFixed(8),
          severity: Math.abs(reportedQty - computedQty) > Math.max(0.01 * computedQty, 1)
                    ? 'major' : 'minor',
        });
      }

      totalQty += reportedQty;
      if (reported?.avgCost) {
        totalCostBasis += reportedQty * reported.avgCost;
      }
      if (reported?.mark) {
        totalMarket += reportedQty * reported.mark;
      }
    }

    if (totalQty <= EPSILON_QTY) continue; // skip fully-closed positions

    rows.push({
      sym,
      perBroker,
      totalQty: +totalQty.toFixed(8),
      avgCostBlended: totalQty > 0 ? +(totalCostBasis / totalQty).toFixed(4) : null,
      marketValue: totalMarket > 0 ? +totalMarket.toFixed(2) : null,
      brokerCount: allBrokers.filter(b => perBroker[b].reportedQty > EPSILON_QTY).length,
    });
  }

  // Summary
  const summary = {
    totalSymbols: rows.length,
    totalMarketValue: +rows.reduce((s, r) => s + (r.marketValue || 0), 0).toFixed(2),
    multiBrokerSymbols: rows.filter(r => r.brokerCount > 1).length,
    discrepancyCount: discrepancies.length,
    majorDiscrepancyCount: discrepancies.filter(d => d.severity === 'major').length,
    brokers: allBrokers,
  };

  return { rows, summary, discrepancies };
};
