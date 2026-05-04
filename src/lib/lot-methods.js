// IMO Onyx Terminal — lot-selection methods (HIFO / FIFO / specific-ID)
//
// Phase 3p.11. The default tax-reporting flow uses FIFO (first-in,
// first-out) via buildRoundTrips. That's what brokers default to,
// but it's NOT tax-optimal in most cases.
//
// HIFO (highest-in, first-out) sells the lots with the highest cost
// basis first, minimizing realized gains (or maximizing realized
// losses). For a portfolio with both winners and losers, HIFO at
// year-end is a common tax-optimization play.
//
// LIFO (last-in, first-out) sells most-recent lots first. Useful in
// some narrow scenarios but rarely tax-optimal vs HIFO.
//
// Specific-ID lets the caller designate exactly which lots to sell.
// This is the most powerful method and what hedge funds typically use,
// but it requires lot-by-lot tracking that brokers may not surface
// directly to retail.
//
// What this module does:
//   - buildRoundTripsWithMethod(trades, method) — pair sells against
//     buys using the chosen method, producing the same trip shape as
//     buildRoundTrips so the rest of the tax pipeline works unchanged.
//   - compareLotMethods(trades) — run each method and return a side-by-
//     side comparison of total realized gain. Useful for the UI to
//     show "FIFO would realize $5K, HIFO would realize $1K — switch?"
//
// Honest scope:
//   - Specific-ID requires lot ids that aren't surfaced in this app's
//     trade format. Implementing it cleanly requires extending the
//     trade record with a lot identifier, which would touch every
//     broker adapter. Out of scope for this phase.
//   - Brokers limit which method they recognize. The user has to
//     elect a method with the broker; this module is purely a
//     reporting/planning tool.
//
// Public exports:
//   buildRoundTripsWithMethod(trades, method)
//                              method: 'fifo' | 'lifo' | 'hifo'
//                              Returns array of trip records matching
//                              buildRoundTrips' shape.
//   compareLotMethods(trades)
//                              Returns: { fifo, lifo, hifo } each with
//                              totalRealized, longTermRealized,
//                              shortTermRealized, count.

const ONE_YEAR_MS = 365.25 * 86400000;

const tripFromMatch = (sym, lot, sellPx, sellTime, matchedQty) => ({
  ticker: sym,
  qty: matchedQty,
  entryPrice: lot.price,
  exitPrice: sellPx,
  entryTime: lot.time,
  exitTime: sellTime,
  pnl: (sellPx - lot.price) * matchedQty,
  ret: lot.price > 0 ? (sellPx - lot.price) / lot.price : 0,
});

const pickLotIndex = (lots, method) => {
  if (lots.length === 0) return -1;
  if (method === 'fifo') return 0;
  if (method === 'lifo') return lots.length - 1;
  if (method === 'hifo') {
    // Highest cost basis first
    let bestIdx = 0;
    let bestPrice = lots[0].price;
    for (let i = 1; i < lots.length; i++) {
      if (lots[i].price > bestPrice) {
        bestPrice = lots[i].price;
        bestIdx = i;
      }
    }
    return bestIdx;
  }
  return 0; // unknown method falls back to FIFO
};

export const buildRoundTripsWithMethod = (trades = [], method = 'fifo') => {
  if (!Array.isArray(trades) || trades.length === 0) return [];
  // Sort by time ascending to apply lot-selection deterministically.
  // The default trade list arrives newest-first.
  const ordered = [...trades].sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));

  const openLots = {}; // sym → array of { qty, price, time, raw }
  const trips = [];

  for (const t of ordered) {
    const sym = t.sym;
    if (!sym) continue;
    const qty = parseFloat(t.size) || 0;
    const px  = parseFloat(t.price) || 0;
    const tt  = Number(t.time) || 0;
    if (qty <= 0 || px <= 0) continue;
    if (!openLots[sym]) openLots[sym] = [];

    if (t.side === 'buy') {
      openLots[sym].push({ qty, price: px, time: tt, raw: t });
    } else if (t.side === 'sell') {
      let remaining = qty;
      while (remaining > 0 && openLots[sym].length > 0) {
        const idx = pickLotIndex(openLots[sym], method);
        const lot = openLots[sym][idx];
        const matched = Math.min(remaining, lot.qty);
        trips.push(tripFromMatch(sym, lot, px, tt, matched));
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 0) openLots[sym].splice(idx, 1);
      }
      // If sells exceed buys, the excess is silently dropped (matches
      // buildRoundTrips behavior — short selling isn't modeled here).
    }
  }
  return trips;
};

const summarizeTrips = (trips) => {
  let total = 0, longRealized = 0, shortRealized = 0;
  for (const t of trips) {
    total += t.pnl;
    if ((t.exitTime - t.entryTime) > ONE_YEAR_MS) {
      longRealized += t.pnl;
    } else {
      shortRealized += t.pnl;
    }
  }
  return {
    totalRealized:    +total.toFixed(2),
    longTermRealized: +longRealized.toFixed(2),
    shortTermRealized:+shortRealized.toFixed(2),
    count:            trips.length,
  };
};

export const compareLotMethods = (trades = []) => {
  return {
    fifo: summarizeTrips(buildRoundTripsWithMethod(trades, 'fifo')),
    lifo: summarizeTrips(buildRoundTripsWithMethod(trades, 'lifo')),
    hifo: summarizeTrips(buildRoundTripsWithMethod(trades, 'hifo')),
  };
};
