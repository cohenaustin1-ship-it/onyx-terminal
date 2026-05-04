// IMO Onyx Terminal — tax-loss harvesting (TLH) recommender
//
// Phase 3p.10. Companion feature to the wash-sale detector (3p.09).
// Where wash-sale detection looks BACKWARD ("did I trip the rule?"),
// the TLH recommender looks FORWARD ("can I harvest a loss without
// tripping the rule?").
//
// What TLH means:
//   1. Sell a position at a loss to realize the deductible capital loss
//   2. Buy a NOT-substantially-identical alternative to maintain market
//      exposure (so you don't miss the rebound)
//   3. Wait 31 days before re-buying the ORIGINAL ticker (otherwise the
//      sale becomes a wash sale and the loss is disallowed)
//
// This module:
//   - Identifies open positions trading at an unrealized loss
//   - For each loss position, suggests acceptable replacement tickers
//     using the TLH_SWAP_MAP from tax-lots.js
//   - Calculates the harvestable loss in dollars
//   - Notes the safe re-buy date for the original (sale + 31 days)
//   - Filters out positions where a recent buy would create an
//     immediate wash sale (so we don't suggest "harvest AAPL" if the
//     user just bought AAPL last week — they'd trip the rule going
//     into the sale)
//
// Honest scope:
//   - "Substantially identical" is a judgment call by the IRS without
//     a bright-line rule. The TLH_SWAP_MAP encodes commonly-accepted
//     swaps but the user's CPA gets the final say.
//   - We don't account for transaction costs (would erode small
//     harvests).
//   - We assume FIFO basis. The user can specify other lot-selection
//     methods (HIFO, specific identification) for better tax outcomes,
//     but lot-selection is broker-side and out of scope here.
//   - The "harvestable loss" assumes selling the entire position.
//     Partial-position harvesting requires manual sizing.
//
// Public exports:
//   buildTLHRecommendations({ positions, recentTrades, opts })
//                              positions: [{ sym, qty, avgCost, mark, ... }]
//                              recentTrades: trade history for wash-sale check
//                              opts: { minLossUsd, lookbackDays }
//                              Returns: { recommendations, summary }
//   formatSafeRebuyDate(saleDate, daysAhead = 31)
//                              Helper for UI: "you can re-buy AAPL on
//                              YYYY-MM-DD".

import { areSubstantiallyIdentical, TLH_SWAP_MAP } from './quant/tax-lots.js';

const DAY_MS = 86400000;
const WASH_WINDOW_DAYS = 30;
const SAFE_REBUY_DAYS = 31;

const isoDateLocal = (ts) => {
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
};

export const formatSafeRebuyDate = (saleDate, daysAhead = SAFE_REBUY_DAYS) => {
  const baseTs = (saleDate instanceof Date) ? saleDate.getTime()
               : Number.isFinite(saleDate) ? saleDate
               : Date.now();
  return isoDateLocal(baseTs + daysAhead * DAY_MS);
};

// hasRecentReplacementBuy — looks at recent trades to see if the user
// already bought a substantially-identical security within the past
// 30 days. If they did, harvesting NOW would still trigger the wash
// sale rule because the recent buy is within the ±30-day window of
// the planned sale. We surface this as a warning, not a hard block —
// the user might want to know AND choose to wait.
const hasRecentReplacementBuy = (sym, recentTrades, nowTs) => {
  if (!Array.isArray(recentTrades)) return null;
  const cutoff = nowTs - WASH_WINDOW_DAYS * DAY_MS;
  for (const t of recentTrades) {
    if (t.side !== 'buy') continue;
    const tts = Number(t.time) || 0;
    if (tts < cutoff || tts > nowTs) continue;
    if (!t.sym) continue;
    if (areSubstantiallyIdentical(sym, t.sym)) {
      return { sym: t.sym, time: tts };
    }
  }
  return null;
};

// suggestReplacements — return swap candidates from TLH_SWAP_MAP.
// Falls back to a generic "no curated swap" hint if the ticker isn't
// in our map (most single-stock positions won't have a documented
// non-identical alternative — that's the normal case for individual
// equities, where the harvest still works but there's no easy
// "substitute" because no other stock IS that company).
const suggestReplacements = (sym) => {
  const swaps = TLH_SWAP_MAP.get((sym || '').toUpperCase()) || [];
  if (swaps.length === 0) {
    return {
      hasCuratedSwap: false,
      candidates: [],
      note: 'No curated swap. For individual stocks, exposure is unique to the issuer; harvesting requires accepting tracking error or sitting in cash for 31 days.',
    };
  }
  // Flatten all swap candidates with their notes
  const seen = new Set();
  const candidates = [];
  for (const swap of swaps) {
    for (const target of swap.to) {
      if (seen.has(target)) continue;
      seen.add(target);
      candidates.push({ sym: target, note: swap.note });
    }
  }
  return { hasCuratedSwap: true, candidates, note: null };
};

export const buildTLHRecommendations = ({
  positions = [],
  recentTrades = [],
  opts = {},
}) => {
  const minLossUsd = Number.isFinite(opts.minLossUsd) ? opts.minLossUsd : 100;
  const nowTs = Number.isFinite(opts.now) ? opts.now : Date.now();

  const recommendations = [];

  for (const pos of positions) {
    if (!pos || !pos.sym) continue;
    const qty     = Number(pos.qty)     || 0;
    const avgCost = Number(pos.avgCost) || 0;
    const mark    = Number(pos.mark)    || 0;
    if (qty <= 0 || avgCost <= 0 || mark <= 0) continue;

    const unrealizedPnl = (mark - avgCost) * qty;
    // Only flag positions with sufficient loss to be worth harvesting
    if (unrealizedPnl >= 0) continue;
    if (Math.abs(unrealizedPnl) < minLossUsd) continue;

    const replacement = suggestReplacements(pos.sym);
    const recentBuy = hasRecentReplacementBuy(pos.sym, recentTrades, nowTs);

    recommendations.push({
      sym:           pos.sym,
      qty,
      avgCost,
      mark,
      harvestableLoss: +Math.abs(unrealizedPnl).toFixed(2),
      pctLoss:        +((mark - avgCost) / avgCost * 100).toFixed(2),
      // Replacement guidance
      hasCuratedSwap: replacement.hasCuratedSwap,
      candidates:     replacement.candidates,
      replacementNote: replacement.note,
      // Wash-sale guardrails
      recentReplacementBuy: recentBuy, // null if safe; { sym, time } if risky
      safeRebuyDate:        formatSafeRebuyDate(nowTs),
      // Tax bracket-agnostic estimate at common rates (not actual savings —
      // depends on user's marginal rate; UI shows multiple brackets)
      estimatedTaxSavings: {
        atShortTerm22: +(Math.abs(unrealizedPnl) * 0.22).toFixed(2),
        atShortTerm32: +(Math.abs(unrealizedPnl) * 0.32).toFixed(2),
        atLongTerm15:  +(Math.abs(unrealizedPnl) * 0.15).toFixed(2),
        atLongTerm20:  +(Math.abs(unrealizedPnl) * 0.20).toFixed(2),
      },
    });
  }

  // Sort by largest harvestable loss first (biggest tax benefit at top)
  recommendations.sort((a, b) => b.harvestableLoss - a.harvestableLoss);

  const summary = {
    candidateCount: recommendations.length,
    totalHarvestable: +recommendations.reduce((s, r) => s + r.harvestableLoss, 0).toFixed(2),
    riskyCount: recommendations.filter(r => r.recentReplacementBuy).length,
  };

  return { recommendations, summary, generatedAt: nowTs };
};
