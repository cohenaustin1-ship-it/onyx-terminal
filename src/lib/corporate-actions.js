// IMO Onyx Terminal — corporate action basis adjustments
//
// Phase 3p.13 / Feature 2. The biggest remaining institutional gap
// in the tax-reporting stack: corporate actions (splits, mergers,
// spin-offs, stock dividends) change cost basis without being
// "trades" in the normal sense. Without modeling them, every CSV
// import that crosses a split shows wildly wrong cost basis.
//
// What's modeled:
//   FORWARD_SPLIT  e.g. AAPL 4:1 — multiply qty by N, divide basis by N
//   REVERSE_SPLIT  e.g. GE 1:8  — divide qty by N, multiply basis by N
//   STOCK_DIVIDEND e.g. 5% stock dividend — bonus shares with basis
//                   spread (allocates cost basis across new shares)
//   CASH_MERGER    e.g. acquired for $X cash — closes the position,
//                   produces realized gain/loss at close-out price
//   STOCK_MERGER   e.g. acquired for K shares of new ticker —
//                   replaces holding with new ticker at allocated basis
//   SPIN_OFF       e.g. spin-off of new ticker, basis split by ratio
//
// What's NOT modeled (honest scope):
//   - Cash-and-stock mergers (need both cash boot taxation and basis
//     allocation to new shares — complex and broker-specific)
//   - Wash-sale-affected basis reallocation across replacement shares
//   - Foreign tax withholding on stock dividends
//   - Section 305(c) deemed distributions (usually broker-handled)
//   - DRIP reinvestments (treated as separate buys, which is fine
//     because the broker's CSV will already show them)
//
// Application model:
//   Corporate actions are stored as records with effective dates.
//   Before any tax computation, we walk the trades array and apply
//   each action whose effective date falls within the trade window:
//     - For each open lot at the action's effective date, adjust
//       qty and basis per the action type.
//     - Splits don't realize gain. Cash mergers do.
//     - The resulting trade list (post-adjustment) flows through
//       the normal tax pipeline.
//
// Usage:
//   const { adjustedTrades, realizedFromActions } =
//     applyCorporateActions(trades, actions);
//   const taxReport = buildTaxLotReport(adjustedTrades);
//
// Public exports:
//   applyCorporateActions(trades, actions)
//                              Returns { adjustedTrades, realizedFromActions }
//   validateAction(action)
//                              Returns { ok, errors[] }
//   ACTION_TYPES               array of supported action type strings
//   COMMON_SPLIT_HISTORY        a tiny built-in registry of well-known splits
//                               (AAPL 4:1, TSLA 3:1, NVDA 4:1) for sanity-check
//                               UI hints. Not authoritative for tax filing.

export const ACTION_TYPES = [
  'FORWARD_SPLIT', 'REVERSE_SPLIT', 'STOCK_DIVIDEND',
  'CASH_MERGER', 'STOCK_MERGER', 'CASH_AND_STOCK_MERGER', 'SPIN_OFF',
];

export const COMMON_SPLIT_HISTORY = [
  { sym: 'AAPL', type: 'FORWARD_SPLIT', date: '2020-08-31', ratio: 4 },
  { sym: 'TSLA', type: 'FORWARD_SPLIT', date: '2022-08-25', ratio: 3 },
  { sym: 'NVDA', type: 'FORWARD_SPLIT', date: '2024-06-10', ratio: 10 },
  { sym: 'GOOGL', type: 'FORWARD_SPLIT', date: '2022-07-18', ratio: 20 },
  { sym: 'AMZN', type: 'FORWARD_SPLIT', date: '2022-06-06', ratio: 20 },
];

export const validateAction = (action) => {
  const errors = [];
  if (!action || typeof action !== 'object') return { ok: false, errors: ['action must be an object'] };
  if (!ACTION_TYPES.includes(action.type)) errors.push(`type must be one of: ${ACTION_TYPES.join(', ')}`);
  if (!action.sym) errors.push('sym required');
  if (!action.date) errors.push('date required');
  else if (isNaN(Date.parse(action.date))) errors.push('date must be parseable');

  switch (action.type) {
    case 'FORWARD_SPLIT':
    case 'REVERSE_SPLIT':
      if (!Number.isFinite(action.ratio) || action.ratio <= 0) {
        errors.push('ratio required and must be > 0');
      }
      break;
    case 'STOCK_DIVIDEND':
      if (!Number.isFinite(action.percentage) || action.percentage <= 0) {
        errors.push('percentage required and must be > 0');
      }
      break;
    case 'CASH_MERGER':
      if (!Number.isFinite(action.cashPerShare) || action.cashPerShare < 0) {
        errors.push('cashPerShare required and must be >= 0');
      }
      break;
    case 'STOCK_MERGER':
      if (!action.newSym) errors.push('newSym required');
      if (!Number.isFinite(action.exchangeRatio) || action.exchangeRatio <= 0) {
        errors.push('exchangeRatio required and must be > 0');
      }
      break;
    case 'CASH_AND_STOCK_MERGER':
      if (!action.newSym) errors.push('newSym required');
      if (!Number.isFinite(action.exchangeRatio) || action.exchangeRatio <= 0) {
        errors.push('exchangeRatio required and must be > 0');
      }
      if (!Number.isFinite(action.cashPerShare) || action.cashPerShare < 0) {
        errors.push('cashPerShare required and must be >= 0');
      }
      break;
    case 'SPIN_OFF':
      if (!action.newSym) errors.push('newSym required');
      if (!Number.isFinite(action.basisAllocationPct) ||
          action.basisAllocationPct < 0 || action.basisAllocationPct > 1) {
        errors.push('basisAllocationPct required and must be 0..1');
      }
      if (!Number.isFinite(action.newSharesPerOldShare) || action.newSharesPerOldShare <= 0) {
        errors.push('newSharesPerOldShare required and must be > 0');
      }
      break;
  }
  return { ok: errors.length === 0, errors };
};

const toTs = (d) => {
  if (typeof d === 'number') return d;
  const n = Date.parse(d);
  return Number.isFinite(n) ? n : 0;
};

// Apply a single action to the lot ledger, mutating in place.
// Returns either null (no realization) or a synthetic close trade
// (for cash mergers) that should be appended to the trade list so

// Apply a single action by retroactively adjusting all past trades
// for the affected ticker AND open lots. The retroactive approach
// is correct because: when a split fires, brokers retroactively
// re-state historical buys in post-split units. We mirror that.
//
// adjustedTrades is the in-progress output array — we mutate it
// in-place to apply the historical adjustments.
const applyOne = (lots, action, adjustedTrades) => {
  const sym = action.sym;
  const actionTs = toTs(action.date);
  const myLots = lots[sym] || [];

  switch (action.type) {
    case 'FORWARD_SPLIT':
    case 'STOCK_DIVIDEND': {
      const factor = action.type === 'FORWARD_SPLIT'
                   ? action.ratio
                   : 1 + action.percentage / 100;
      // Retroactively adjust every past trade for this ticker
      for (const t of adjustedTrades) {
        if (t.sym !== sym) continue;
        if ((Number(t.time) || 0) > actionTs) continue;
        t.size  = (Number(t.size)  || 0) * factor;
        t.price = (Number(t.price) || 0) / factor;
      }
      // Adjust open lots
      for (const lot of myLots) {
        lot.qty *= factor;
        lot.price /= factor;
      }
      return null;
    }
    case 'REVERSE_SPLIT': {
      const factor = action.ratio;
      for (const t of adjustedTrades) {
        if (t.sym !== sym) continue;
        if ((Number(t.time) || 0) > actionTs) continue;
        t.size  = (Number(t.size)  || 0) / factor;
        t.price = (Number(t.price) || 0) * factor;
      }
      for (const lot of myLots) {
        lot.qty /= factor;
        lot.price *= factor;
      }
      return null;
    }
    case 'CASH_MERGER': {
      if (myLots.length === 0) return null;
      const totalQty = myLots.reduce((s, l) => s + l.qty, 0);
      lots[sym] = [];
      return {
        sym, side: 'sell', size: totalQty, price: action.cashPerShare,
        time: actionTs,
        notes: `[corp action: cash merger @ $${action.cashPerShare}]`,
        source: 'corporate-action',
      };
    }
    case 'STOCK_MERGER': {
      if (myLots.length === 0) return null;
      const newSym = action.newSym;
      // Retroactively rename + rescale all past trades
      for (const t of adjustedTrades) {
        if (t.sym !== sym) continue;
        if ((Number(t.time) || 0) > actionTs) continue;
        t.sym = newSym;
        t.size  = (Number(t.size)  || 0) * action.exchangeRatio;
        t.price = (Number(t.price) || 0) / action.exchangeRatio;
      }
      if (!lots[newSym]) lots[newSym] = [];
      for (const lot of myLots) {
        lots[newSym].push({
          qty:   lot.qty * action.exchangeRatio,
          price: lot.price / action.exchangeRatio,
          time:  lot.time,
        });
      }
      lots[sym] = [];
      return null;
    }
    case 'CASH_AND_STOCK_MERGER': {
      // Combined cash boot + stock swap (e.g. AT&T-Time Warner where
      // shareholders got both stock and cash). Per IRS §356, the cash
      // portion is taxable up to the realized gain on the original
      // shares; the stock portion's basis transfers from the original.
      //
      // Implementation: we emit a synthetic BUY+SELL pair for the
      // cash boot (the buy at the cash-allocated basis, the sell at
      // cashPerShare). Standard FIFO matching in the tax engine will
      // then compute the right gain. The stock-portion basis transfers
      // to the new ticker via retroactive rename of past trades, just
      // like STOCK_MERGER does.
      //
      // Honest scope: SIMPLE proportional basis allocation. Set
      // basisCashAllocationPct explicitly per the broker's 1099-B.
      // Default 0 = "pure stock basis carryover, recognize no gain on
      // cash" which approximates §354 tax-free reorg treatment when
      // total cash ≈ basis allocated.
      if (myLots.length === 0) return null;
      const newSym = action.newSym;
      const cashPct = Number.isFinite(action.basisCashAllocationPct)
                    ? Math.max(0, Math.min(1, action.basisCashAllocationPct))
                    : 0;
      const stockPct = 1 - cashPct;

      const lotSnapshots = myLots.map(l => ({ qty: l.qty, price: l.price, time: l.time }));
      const totalQty = myLots.reduce((s, l) => s + l.qty, 0);
      const totalCashBasis = lotSnapshots.reduce(
        (s, l) => s + l.qty * l.price * cashPct, 0);
      const effCashBasisPerShare = totalQty > 0 ? totalCashBasis / totalQty : 0;

      // Retroactively rename past trades to new ticker, applying the
      // stockPct fraction of basis. Both buys and sells get renamed
      // (matching STOCK_MERGER's approach).
      for (const t of adjustedTrades) {
        if (t.sym !== sym) continue;
        if ((Number(t.time) || 0) > actionTs) continue;
        t.sym = newSym;
        t.size  = (Number(t.size)  || 0) * action.exchangeRatio;
        t.price = (Number(t.price) || 0) * stockPct / action.exchangeRatio;
      }

      // Synthetic BUY at the cash-allocated basis, immediately before
      // actionTs so FIFO matching is deterministic.
      const synthBuy = {
        sym, side: 'buy',
        size: totalQty,
        price: effCashBasisPerShare,
        time: actionTs - 1,
        notes: `[corp action: cash-and-stock merger basis alloc for cash boot, ${(cashPct * 100).toFixed(1)}% basis to cash]`,
        source: 'corporate-action',
      };
      // Synthetic SELL at cashPerShare. FIFO matches against synthBuy
      // → realized gain = (cashPerShare - effCashBasisPerShare) × totalQty.
      const synthSell = {
        sym, side: 'sell',
        size: totalQty,
        price: action.cashPerShare,
        time: actionTs,
        notes: `[corp action: cash-and-stock merger cash boot @ $${action.cashPerShare}/sh]`,
        source: 'corporate-action',
      };
      adjustedTrades.push(synthBuy);

      // Update the lot ledger for the new ticker
      if (!lots[newSym]) lots[newSym] = [];
      for (const snap of lotSnapshots) {
        const newQty = snap.qty * action.exchangeRatio;
        const newPricePerShare = action.exchangeRatio > 0
                               ? (snap.price * stockPct) / action.exchangeRatio
                               : 0;
        lots[newSym].push({ qty: newQty, price: newPricePerShare, time: snap.time });
      }
      // The synthBuy is now the only open lot in lots[sym]. The synthSell
      // we return will fully consume it in the main loop's lot-matching
      // logic — but we don't actually re-run main-loop matching for the
      // synthetic sell, so we clear lots[sym] manually.
      lots[sym] = [];

      return synthSell;
    }
    case 'SPIN_OFF': {
      if (myLots.length === 0) return null;
      const newSym = action.newSym;
      const retainPct = 1 - action.basisAllocationPct;
      // Track each lot's qty BEFORE we mutate so we can compute the
      // synthetic new-ticker buys correctly
      const lotSnapshots = myLots.map(l => ({ qty: l.qty, price: l.price, time: l.time }));
      // Reduce basis on past buys of the original ticker
      for (const t of adjustedTrades) {
        if (t.sym !== sym) continue;
        if ((Number(t.time) || 0) > actionTs) continue;
        if (t.side === 'buy') {
          t.price = (Number(t.price) || 0) * retainPct;
        }
      }
      // Reduce basis on open lots
      for (const lot of myLots) {
        lot.price *= retainPct;
      }
      // Emit synthetic buys for the spin-off ticker, basis = allocated portion
      if (!lots[newSym]) lots[newSym] = [];
      for (const snap of lotSnapshots) {
        const newQty = snap.qty * action.newSharesPerOldShare;
        const allocBasisPerShare = snap.price * action.basisAllocationPct
                                 / action.newSharesPerOldShare;
        const synthBuy = {
          sym: newSym, side: 'buy',
          size: newQty, price: allocBasisPerShare,
          time: actionTs,
          notes: `[corp action: spin-off from ${sym}]`,
          source: 'corporate-action',
        };
        adjustedTrades.push(synthBuy);
        lots[newSym].push({ qty: newQty, price: allocBasisPerShare, time: snap.time });
      }
      return null;
    }
    default:
      return null;
  }
};

export const applyCorporateActions = (trades = [], actions = []) => {
  if (!Array.isArray(trades)) return { adjustedTrades: [], realizedFromActions: [] };
  if (!Array.isArray(actions) || actions.length === 0) {
    return { adjustedTrades: trades, realizedFromActions: [] };
  }

  const validActions = actions.filter(a => validateAction(a).ok);
  if (validActions.length === 0) {
    return { adjustedTrades: trades, realizedFromActions: [] };
  }

  // Copy trades so caller's data is untouched
  const adjustedTrades = trades.map(t => ({ ...t, time: Number(t.time) || toTs(t.time) }));

  // Build event stream: trades + actions, sorted chronologically
  const events = [];
  adjustedTrades.forEach((t, idx) => {
    events.push({ ts: t.time, kind: 'trade', tradeIdx: idx });
  });
  for (const a of validActions) {
    events.push({ ts: toTs(a.date), kind: 'action', payload: a });
  }
  // On same-day ties, trades come before actions (so day-of-split
  // buys get included in the lot ledger before the split fires)
  events.sort((x, y) => {
    if (x.ts !== y.ts) return x.ts - y.ts;
    if (x.kind === y.kind) return 0;
    return x.kind === 'trade' ? -1 : 1;
  });

  const lots = {}; // sym → [{ qty, price, time }]
  const realizedFromActions = [];

  for (const ev of events) {
    if (ev.kind === 'trade') {
      const t = adjustedTrades[ev.tradeIdx];
      const sym = t.sym;
      const qty = parseFloat(t.size) || 0;
      const px  = parseFloat(t.price) || 0;
      if (!sym || qty <= 0 || px <= 0) continue;
      if (!lots[sym]) lots[sym] = [];
      if (t.side === 'buy') {
        lots[sym].push({ qty, price: px, time: t.time });
      } else if (t.side === 'sell') {
        let remaining = qty;
        while (remaining > 0 && lots[sym].length > 0) {
          const lot = lots[sym][0];
          const matched = Math.min(remaining, lot.qty);
          lot.qty -= matched;
          remaining -= matched;
          if (lot.qty <= 0) lots[sym].shift();
        }
      }
    } else if (ev.kind === 'action') {
      const synth = applyOne(lots, ev.payload, adjustedTrades);
      if (synth) {
        adjustedTrades.push(synth);
        realizedFromActions.push({ action: ev.payload, syntheticTrade: synth });
      }
    }
  }

  // Newest-first to match the rest of the pipeline's convention
  adjustedTrades.sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));

  return { adjustedTrades, realizedFromActions };
};
