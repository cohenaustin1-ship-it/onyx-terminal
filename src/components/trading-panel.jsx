// @ts-check
// IMO Onyx Terminal — Trading panel (TradePage right rail)
//
// Phase 3p.30 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines 10589-11971, ~1,383 lines).
//
// Fourth "lift the children" phase preparing for TradePage extraction.
// All the components that make up TradePage's right-side trading
// panel: order book, recent trades, options chain, options strategy
// picker, and the order entry ticket.
//
// Public exports:
//   OrderBook({ book, instrument, mid, onOptionTrade })
//   TradesList({ instrument })
//   OptionsChain({ instrument, spot, onOptionTrade })
//   OptionsStrategiesModal({ instrument, spot, rows, onClose, onPick })
//   OrderEntry({ instrument, markPrice, account, user, onOpenPosition, initialSide })
//
// Internal companions (only used inside this module):
//   BookRow            — single price level row in OrderBook
//   GreekCell          — single greek value cell in OptionsChain
//   LabeledField       — labeled input wrapper in OrderEntry
//   SummaryRow         — order summary row in OrderEntry
//   OPTIONS_OBJECTIVES — strategy picker fixture
//
// Honest scope:
//   - Order book / trades data is mock-streamed by useOrderBook in
//     monolith; this module renders whatever data it's given.
//   - Options pricing uses Black-Scholes from quant-misc, with
//     IV_BY_CLASS as the default per-asset-class implied vol.
//   - OptionsStrategiesModal is a strategy picker (covered call,
//     spread, iron condor, etc.); it builds the leg structure
//     and OptionsChain executes the legs.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Area, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts';
import {
  Activity, Diamond, DollarSign, Shield, TrendingDown, TrendingUp,
  X, Zap,
} from 'lucide-react';
import { COLORS, IV_BY_CLASS, RISK_FREE_RATE } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import { blackScholes } from '../lib/quant/quant-misc.js';
import { usePriceFeed, useTradeFeed } from '../lib/trade-feeds.js';

// fmt + fmtCompact (inlined per established pattern).
const _getFmtLocale = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('imo_settings') : null;
    if (!raw) return 'en-US';
    const s = JSON.parse(raw);
    const loc = s?.numberFormat;
    if (typeof loc === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(loc)) return loc;
    return 'en-US';
  } catch { return 'en-US'; }
};
const fmt = (n, d = 2) => Number(n).toLocaleString(_getFmtLocale(), {
  minimumFractionDigits: d, maximumFractionDigits: d,
});
const fmtCompact = (n) => {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs/1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}${(abs/1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}${(abs/1e6).toFixed(2)}M`;
  if (abs >= 1e3)  return `${sign}${(abs/1e3).toFixed(2)}K`;
  return `${sign}${abs.toFixed(2)}`;
};

// Env-var keys (duplicated from monolith).
const MASSIVE_API_KEY = (() => { try { return import.meta.env?.VITE_MASSIVE_API_KEY ?? ''; } catch { return ''; } })();

export const OrderBook = ({ book, instrument, mid, onOptionTrade }) => {
  const [view, setView] = useState('book');
  const maxTotal = Math.max(
    ...book.bids.map(b => b.total), ...book.asks.map(a => a.total), 1
  );

  return (
    <div className="h-full w-full flex flex-col"
         style={{ background: COLORS.bg }}>
      <div className="flex items-center px-3 pt-2 pb-1.5 border-b gap-1 shrink-0" style={{ borderColor: COLORS.border }}>
        <button
          onClick={() => setView('book')}
          className="px-2.5 py-1 text-[12px] rounded-md transition-colors"
          style={{
            color: view === 'book' ? COLORS.text : COLORS.textDim,
            background: view === 'book' ? COLORS.surface : 'transparent',
          }}
        >Order book</button>
        <button
          onClick={() => setView('trades')}
          className="px-2.5 py-1 text-[12px] rounded-md transition-colors"
          style={{
            color: view === 'trades' ? COLORS.text : COLORS.textDim,
            background: view === 'trades' ? COLORS.surface : 'transparent',
          }}
        >Recent trades</button>
        <button
          onClick={() => setView('options')}
          className="px-2.5 py-1 text-[12px] rounded-md transition-colors"
          style={{
            color: view === 'options' ? COLORS.text : COLORS.textDim,
            background: view === 'options' ? COLORS.surface : 'transparent',
          }}
        >Options</button>
      </div>

      {view === 'book' && (
        <>
          <div className="grid grid-cols-3 gap-2 px-4 py-1.5 text-[10px] uppercase tracking-wider border-b shrink-0"
               style={{ color: COLORS.textMute, borderColor: COLORS.border }}>
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Total</span>
          </div>

          {/* The min-h-0 + overflow-hidden below are what fixes the overflow bug.
              flex-1 asks and bids each take equal half; excess rows are clipped,
              keeping the spread row always centered. */}
          <div className="flex-1 min-h-0 flex flex-col text-[11.5px] tabular-nums">
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col justify-end">
              {book.asks.map((a, i) => (
                <BookRow key={`a${i}`} row={a} side="ask" dec={instrument.dec} maxTotal={maxTotal} />
              ))}
            </div>

            <div
              className="flex items-center justify-between px-4 py-2 border-y shrink-0"
              style={{ borderColor: COLORS.borderHi, background: COLORS.surface }}
            >
              <span className="text-[15px] font-medium tabular-nums" style={{ color: COLORS.mint }}>
                {fmt(mid, instrument.dec)}
              </span>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                Spread {(0.01 * mid).toFixed(instrument.dec)}
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              {book.bids.map((b, i) => (
                <BookRow key={`b${i}`} row={b} side="bid" dec={instrument.dec} maxTotal={maxTotal} />
              ))}
            </div>
          </div>
        </>
      )}

      {view === 'trades' && <TradesList instrument={instrument} />}
      {view === 'options' && <OptionsChain instrument={instrument} spot={mid} onOptionTrade={onOptionTrade} />}
    </div>
  );
};

const BookRow = ({ row, side, dec, maxTotal }) => {
  const pct = (row.total / maxTotal) * 100;
  const isBid = side === 'bid';
  return (
    <div className="relative px-3 py-[3px] grid grid-cols-3 gap-1 hover:bg-white/[0.02] transition-colors shrink-0 text-[11px] tabular-nums">
      <div
        className="absolute top-0 right-0 h-full pointer-events-none"
        style={{
          width: `${pct}%`,
          background: isBid ? 'rgba(31,178,107,0.09)' : 'rgba(237,112,136,0.09)',
        }}
      />
      <span className="relative truncate" style={{ color: isBid ? COLORS.green : COLORS.red }}>
        {fmt(row.price, dec)}
      </span>
      <span className="relative text-right truncate" style={{ color: COLORS.text }}>
        {row.size.toFixed(3)}
      </span>
      <span className="relative text-right truncate" style={{ color: COLORS.textDim }}>
        {row.total >= 1000 ? `${(row.total / 1000).toFixed(2)}K` : row.total.toFixed(2)}
      </span>
    </div>
  );
};

export const TradesList = ({ instrument }) => {
  const feed = usePriceFeed(instrument);
  const trades = useTradeFeed(instrument, feed.price);
  return (
    <>
      <div className="grid grid-cols-3 gap-2 px-4 py-1.5 text-[10px] uppercase tracking-wider border-b shrink-0"
           style={{ color: COLORS.textMute, borderColor: COLORS.border }}>
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto text-[11.5px] tabular-nums">
        {trades.map((t, i) => (
          <div key={t.id}
               className="grid grid-cols-3 gap-2 px-4 py-[3px] hover:bg-white/[0.02]"
               style={{
                 // First (newest) trade pulses briefly to make activity visible
                 background: i === 0
                   ? (t.side === 'buy' ? 'rgba(31,178,107,0.06)' : 'rgba(237,112,136,0.06)')
                   : 'transparent',
               }}>
            <span style={{ color: t.side === 'buy' ? COLORS.green : COLORS.red }}>
              {fmt(t.price, instrument.dec)}
            </span>
            <span className="text-right" style={{ color: COLORS.text }}>{t.size.toFixed(3)}</span>
            <span className="text-right" style={{ color: COLORS.textDim }}>{t.time.slice(0,8)}</span>
          </div>
        ))}
        {trades.length === 0 && (
          <div className="px-4 py-6 text-[11px] text-center" style={{ color: COLORS.textMute }}>
            Waiting for trades…
          </div>
        )}
      </div>
    </>
  );
};

/* ──────────── Options Chain (Black-Scholes) ──────────── */

// Options Strategies recommender. User picks an objective and gets a
// suggested options structure with payoff diagram + rationale. Shows
// 2-3 anomalies from the loaded chain (high IV vs neighbors, unusual OI).
// Lucide-component icons replace the previous emoji icons (💰 🛡 🚀
// 📉 ⚡ 🦅) per UX feedback. Emojis rendered inconsistently across
// platforms and couldn't be theme-tinted; lucide icons inherit
// surrounding color so they read cleanly in both dark + light modes.
const OPTIONS_OBJECTIVES = [
  {
    id: 'income',
    Icon: DollarSign,
    label: 'Generate income',
    desc: 'You own the stock and want to collect premium',
    strategy: 'covered-call',
    strategyName: 'Covered Call',
    risk: 'Low',
    complexity: 'Beginner',
    rationale: 'Sell out-of-the-money calls against your existing share holdings. Capped upside, but you collect premium. Best when you expect sideways to slightly bullish movement.',
  },
  {
    id: 'hedge',
    Icon: Shield,
    label: 'Hedge a long position',
    desc: 'Protect downside on shares you already hold',
    strategy: 'protective-put',
    strategyName: 'Protective Put',
    risk: 'Low',
    complexity: 'Beginner',
    rationale: 'Buy out-of-the-money puts. Floors your downside in exchange for premium paid. Best for portfolio insurance during uncertain periods.',
  },
  {
    id: 'speculate-up',
    Icon: TrendingUp,
    label: 'Speculate on a big up move',
    desc: 'Cheap leveraged upside exposure',
    strategy: 'long-call',
    strategyName: 'Long Call',
    risk: 'Medium',
    complexity: 'Beginner',
    rationale: 'Buy slightly OTM calls. Limited downside (premium paid), unlimited upside. Best when you have a strong directional view and time horizon.',
  },
  {
    id: 'speculate-down',
    Icon: TrendingDown,
    label: 'Speculate on a big down move',
    desc: 'Cheap leveraged downside exposure',
    strategy: 'long-put',
    strategyName: 'Long Put',
    risk: 'Medium',
    complexity: 'Beginner',
    rationale: 'Buy slightly OTM puts. Limited downside, profits if the stock falls significantly. Best for bearish thesis or earnings hedges.',
  },
  {
    id: 'volatility',
    Icon: Zap,
    label: 'Bet on volatility (either direction)',
    desc: 'You expect a big move but don\'t know direction',
    strategy: 'long-straddle',
    strategyName: 'Long Straddle',
    risk: 'High',
    complexity: 'Intermediate',
    rationale: 'Buy ATM call AND ATM put at same strike. Expensive but profits from any large move. Best around earnings, FDA decisions, or central-bank events.',
  },
  {
    id: 'low-vol',
    Icon: Activity,
    label: 'Profit from sideways action',
    desc: 'You expect price to stay near current level',
    strategy: 'iron-condor',
    strategyName: 'Iron Condor',
    risk: 'Limited',
    complexity: 'Advanced',
    rationale: 'Sell OTM call spread and OTM put spread. You collect premium if price stays between the inner strikes at expiration. Limited risk and reward.',
  },
];

export const OptionsStrategiesModal = ({ instrument, spot, rows, onClose, onPick }) => {
  const [objIdx, setObjIdx] = useState(0);
  const obj = OPTIONS_OBJECTIVES[objIdx];

  // Defensive picker: returns a safe number for premium fields. Some Polygon
  // partial chains return undefined for call/put — treat as 0 so the payoff
  // diagram still renders something meaningful instead of NaN cascading.
  const safeNum = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

  // Pick contracts for the recommended strategy
  const recommendation = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const atmIdx = rows.reduce((best, r, i) => Math.abs(r.K - spot) < Math.abs(rows[best].K - spot) ? i : best, 0);

    if (obj.strategy === 'covered-call') {
      const target = spot * 1.05;
      const idx = rows.reduce((b, r, i) => Math.abs(r.K - target) < Math.abs(rows[b].K - target) ? i : b, 0);
      const r = rows[idx];
      const prem = safeNum(r.call);
      return { legs: [{ side: 'sell', type: 'call', strike: r.K, premium: prem }], net: prem };
    }
    if (obj.strategy === 'protective-put') {
      const target = spot * 0.95;
      const idx = rows.reduce((b, r, i) => Math.abs(r.K - target) < Math.abs(rows[b].K - target) ? i : b, 0);
      const r = rows[idx];
      const prem = safeNum(r.put);
      return { legs: [{ side: 'buy', type: 'put', strike: r.K, premium: prem }], net: -prem };
    }
    if (obj.strategy === 'long-call') {
      const target = spot * 1.02;
      const idx = rows.reduce((b, r, i) => Math.abs(r.K - target) < Math.abs(rows[b].K - target) ? i : b, 0);
      const r = rows[idx];
      const prem = safeNum(r.call);
      return { legs: [{ side: 'buy', type: 'call', strike: r.K, premium: prem }], net: -prem };
    }
    if (obj.strategy === 'long-put') {
      const target = spot * 0.98;
      const idx = rows.reduce((b, r, i) => Math.abs(r.K - target) < Math.abs(rows[b].K - target) ? i : b, 0);
      const r = rows[idx];
      const prem = safeNum(r.put);
      return { legs: [{ side: 'buy', type: 'put', strike: r.K, premium: prem }], net: -prem };
    }
    if (obj.strategy === 'long-straddle') {
      const r = rows[atmIdx];
      const c = safeNum(r.call), p = safeNum(r.put);
      return {
        legs: [
          { side: 'buy', type: 'call', strike: r.K, premium: c },
          { side: 'buy', type: 'put',  strike: r.K, premium: p },
        ],
        net: -(c + p),
      };
    }
    if (obj.strategy === 'iron-condor') {
      const findIdx = (mult) => rows.reduce((b, r, i) => Math.abs(r.K - spot * mult) < Math.abs(rows[b].K - spot * mult) ? i : b, 0);
      const sC = rows[findIdx(1.03)];
      const lC = rows[findIdx(1.06)];
      const sP = rows[findIdx(0.97)];
      const lP = rows[findIdx(0.94)];
      const sCp = safeNum(sC.call), lCp = safeNum(lC.call);
      const sPp = safeNum(sP.put),  lPp = safeNum(lP.put);
      return {
        legs: [
          { side: 'sell', type: 'call', strike: sC.K, premium: sCp },
          { side: 'buy',  type: 'call', strike: lC.K, premium: lCp },
          { side: 'sell', type: 'put',  strike: sP.K, premium: sPp },
          { side: 'buy',  type: 'put',  strike: lP.K, premium: lPp },
        ],
        net: sCp - lCp + sPp - lPp,
      };
    }
    return null;
  }, [obj, rows, spot]);

  // Build payoff diagram data
  const payoffData = useMemo(() => {
    if (!recommendation) return [];
    const range = spot * 0.4;
    const steps = 60;
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const px = spot - range / 2 + (range * i) / steps;
      let pnl = recommendation.net; // start with net premium paid/received
      recommendation.legs.forEach(leg => {
        const intrinsic = leg.type === 'call'
          ? Math.max(0, px - leg.strike)
          : Math.max(0, leg.strike - px);
        if (leg.side === 'buy')  pnl += intrinsic - leg.premium;
        if (leg.side === 'sell') pnl += leg.premium - intrinsic;
      });
      out.push({ px: +px.toFixed(2), pnl: +pnl.toFixed(2) });
    }
    return out;
  }, [recommendation, spot]);

  // Identify anomalies in the chain (high IV outliers, unusual OI)
  const anomalies = useMemo(() => {
    if (!rows || rows.length < 5) return [];
    const out = [];
    // High call OI
    const sortedByCallOI = [...rows].sort((a, b) => (b.callOi ?? 0) - (a.callOi ?? 0));
    if (sortedByCallOI[0]?.callOi > 0) {
      const r = sortedByCallOI[0];
      out.push({
        kind: 'high-oi',
        text: `Unusual call open interest at $${r.K} strike (OI: ${(r.callOi).toLocaleString()}) — large positioning here`,
      });
    }
    // High put OI
    const sortedByPutOI = [...rows].sort((a, b) => (b.putOi ?? 0) - (a.putOi ?? 0));
    if (sortedByPutOI[0]?.putOi > 0 && sortedByPutOI[0].K !== sortedByCallOI[0]?.K) {
      const r = sortedByPutOI[0];
      out.push({
        kind: 'high-oi',
        text: `High put OI at $${r.K} (OI: ${(r.putOi).toLocaleString()}) — possible support / hedge level`,
      });
    }
    // IV skew check
    const ivs = rows.map(r => r.iv ?? 0).filter(v => v > 0);
    if (ivs.length >= 3) {
      const avgIv = ivs.reduce((s, v) => s + v, 0) / ivs.length;
      const maxIv = rows.reduce((m, r) => (r.iv ?? 0) > (m.iv ?? 0) ? r : m, rows[0]);
      if ((maxIv.iv ?? 0) > avgIv * 1.3) {
        out.push({
          kind: 'iv-spike',
          text: `Elevated IV at $${maxIv.K} strike (${((maxIv.iv ?? 0) * 100).toFixed(0)}% vs ${(avgIv * 100).toFixed(0)}% avg) — pricing in event risk`,
        });
      }
    }
    return out.slice(0, 3);
  }, [rows]);

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="w-[920px] max-w-full max-h-[90vh] rounded-md border overflow-hidden flex flex-col pointer-events-auto"
             style={{ background: COLORS.surface, borderColor: COLORS.borderHi, boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
          <div className="flex items-center justify-between px-5 py-4 border-b shrink-0"
               style={{ borderColor: COLORS.border }}>
            <div className="flex items-center gap-2.5">
              
              <div>
                <div className="text-[15px] font-medium" style={{ color: COLORS.text }}>
                  Options Strategy Recommender
                </div>
                <div className="text-[11px]" style={{ color: COLORS.textMute }}>
                  {instrument?.id ?? '—'} · spot ${(spot ?? 0).toFixed(2)}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-white/[0.05]">
              <X size={16} style={{ color: COLORS.textDim }} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 grid grid-cols-[280px_1fr] gap-5">
            {(!rows || rows.length === 0) ? (
              <div className="col-span-2 flex flex-col items-center justify-center py-16 text-center">
                <div style={{ fontSize: 36, opacity: 0.3 }}>📊</div>
                <div className="text-[14px] mt-3" style={{ color: COLORS.text }}>
                  No options chain data available
                </div>
                <div className="text-[12px] mt-1.5 max-w-md" style={{ color: COLORS.textMute }}>
                  This instrument doesn't have a loaded options chain yet. Switch to the Options view first to load contracts, then come back to the strategy recommender.
                </div>
                <button onClick={onClose}
                        className="mt-5 px-4 py-2 rounded-md text-[12px] font-medium"
                        style={{ background: COLORS.surface2, color: COLORS.text }}>
                  Close
                </button>
              </div>
            ) : (
            <>
            {/* Objectives */}
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                What's your objective?
              </div>
              {OPTIONS_OBJECTIVES.map((o, i) => {
                const Ico = o.Icon ?? Diamond;
                return (
                <button key={o.id} onClick={() => setObjIdx(i)}
                        className="w-full text-left p-3 rounded-md border transition-colors"
                        style={{
                          borderColor: objIdx === i ? COLORS.mint : COLORS.border,
                          background: objIdx === i ? 'rgba(61,123,255,0.06)' : COLORS.bg,
                        }}>
                  <div className="flex items-start gap-2.5">
                    <Ico size={16} className="mt-0.5"
                         style={{ color: objIdx === i ? COLORS.mint : COLORS.textDim }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px]" style={{ color: objIdx === i ? COLORS.mint : COLORS.text }}>
                        {o.label}
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: COLORS.textMute }}>{o.desc}</div>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="text-[9px] px-1.5 py-0.5 rounded"
                              style={{
                                background: o.risk === 'Low' ? 'rgba(31,178,107,0.1)' :
                                            o.risk === 'Medium' ? 'rgba(255,184,77,0.1)' :
                                            o.risk === 'High' ? 'rgba(237,112,136,0.1)' :
                                            'rgba(255,255,255,0.05)',
                                color: o.risk === 'Low' ? COLORS.green :
                                       o.risk === 'Medium' ? '#FFB84D' :
                                       o.risk === 'High' ? COLORS.red :
                                       COLORS.textDim,
                              }}>
                          {o.risk} risk
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded"
                              style={{ background: COLORS.surface, color: COLORS.textDim }}>
                          {o.complexity}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
                );
              })}
            </div>

            {/* Recommendation */}
            <div className="space-y-3">
              <div className="rounded-md border p-4"
                   style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                        style={{ background: 'rgba(61,123,255,0.12)', color: COLORS.mint }}>
                    Recommended strategy
                  </span>
                </div>
                <div className="text-[16px] font-medium" style={{ color: COLORS.text }}>{obj.strategyName}</div>
                <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: COLORS.textDim }}>
                  {obj.rationale}
                </p>
              </div>

              {/* Legs */}
              {recommendation && (
                <div className="rounded-md border p-4"
                     style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                    Trade legs
                  </div>
                  <div className="space-y-1.5">
                    {recommendation.legs.map((l, i) => (
                      <div key={i} className="flex items-center justify-between text-[12px] py-1.5 border-b last:border-b-0"
                           style={{ borderColor: COLORS.border }}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded"
                                style={{
                                  background: l.side === 'buy' ? 'rgba(61,123,255,0.1)' : 'rgba(237,112,136,0.1)',
                                  color: l.side === 'buy' ? COLORS.mint : COLORS.red,
                                }}>
                            {l.side}
                          </span>
                          <span style={{ color: COLORS.text }}>
                            {l.type === 'call' ? 'CALL' : 'PUT'} ${l.strike}
                          </span>
                        </div>
                        <span className="tabular-nums" style={{ color: COLORS.textDim }}>
                          ${l.premium.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-2 border-t text-[11px]"
                       style={{ borderColor: COLORS.border }}>
                    <span style={{ color: COLORS.textDim }}>Net debit / credit</span>
                    <span className="tabular-nums" style={{ color: recommendation.net >= 0 ? COLORS.green : COLORS.red }}>
                      {recommendation.net >= 0 ? '+' : '-'}${Math.abs(recommendation.net).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* Payoff diagram */}
              {payoffData.length > 0 && (
                <div className="rounded-md border p-4"
                     style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                    Payoff at expiration
                  </div>
                  <ResponsiveContainer width="100%" height={150}>
                    <ComposedChart data={payoffData} margin={{ top: 6, right: 4, left: -28, bottom: 0 }}>
                      <XAxis dataKey="px" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent" />
                      <YAxis tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent" />
                      <Tooltip contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.borderHi}`, borderRadius: 6, fontSize: 11 }}
                               formatter={(v) => [`$${v}`, 'P/L']} />
                      <ReferenceLine y={0} stroke={COLORS.border} />
                      <ReferenceLine x={spot} stroke={COLORS.mint} strokeDasharray="3 3" />
                      <Area type="monotone" dataKey="pnl"
                            stroke={COLORS.mint} strokeWidth={1.5}
                            fill="rgba(61,123,255,0.1)"
                            isAnimationActive={false} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className="text-[10px] text-center mt-1" style={{ color: COLORS.textMute }}>
                    Stock price at expiration
                  </div>
                </div>
              )}

              {/* Anomalies */}
              {anomalies.length > 0 && (
                <div className="rounded-md border p-4"
                     style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                    Price anomalies on this chain
                  </div>
                  <div className="space-y-1.5">
                    {anomalies.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11.5px]" style={{ color: COLORS.textDim }}>
                        <span style={{ color: COLORS.mint, fontSize: 10 }}>●</span>
                        <span>{a.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-[10px] leading-relaxed" style={{ color: COLORS.textMute }}>
                Educational illustration only. Actual prices may differ. Consult a licensed advisor before trading options.
              </div>
            </div>
            </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export const OptionsChain = ({ instrument, spot, onOptionTrade }) => {
  const [expIdx, setExpIdx] = useState(1); // 0=7d, 1=30d, 2=90d
  const [hovered, setHovered] = useState(null);
  /** @typedef {{ rows: any[], expiryDate: string, daysToExpiry: number }} PolygonOptionsData */
  const [polygonOptions, setPolygonOptions] = useState(/** @type {null | PolygonOptionsData} */ (null)); // real chain from Polygon
  const [loading, setLoading] = useState(false);
  const [strategiesOpen, setStrategiesOpen] = useState(false);

  const expirations = [
    { label: '7d',  days: 7 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
  ];
  const exp = expirations[expIdx];
  const T = exp.days / 365;
  const sigma = IV_BY_CLASS[instrument.cls] ?? 0.5;

  // ── Fetch REAL options chain from Polygon for equity instruments ──
  // The Options Starter tier includes /v3/snapshot/options/{underlying} which
  // returns contracts with real IV, Greeks, last trade, bid/ask, and OI.
  // We filter contracts expiring near our target date window.
  useEffect(() => {
    if (instrument.cls !== 'equity' || !MASSIVE_API_KEY) {
      setPolygonOptions(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const targetDays = exp.days;
    const targetDate = new Date(Date.now() + targetDays * 86400000);
    const targetYmd = targetDate.toISOString().slice(0, 10);
    // Filter for contracts within ±7 days of the target expiration.
    const minDate = new Date(Date.now() + (targetDays - 7) * 86400000).toISOString().slice(0, 10);
    const maxDate = new Date(Date.now() + (targetDays + 14) * 86400000).toISOString().slice(0, 10);

    const fetchOptions = async () => {
      try {
        const url = `https://api.polygon.io/v3/snapshot/options/${instrument.id}?expiration_date.gte=${minDate}&expiration_date.lte=${maxDate}&strike_price.gte=${spot * 0.85}&strike_price.lte=${spot * 1.15}&limit=100&apiKey=${MASSIVE_API_KEY}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        if (cancelled) return;

        const contracts = body?.results ?? [];
        // Group by strike and find single nearest expiration to target
        const byStrike = {};
        let nearestExpiry = /** @type {string | null} */ (null);
        let nearestDiff = Infinity;

        contracts.forEach(c => {
          const expDate = c?.details?.expiration_date;
          if (!expDate) return;
          const diff = Math.abs((+new Date(expDate)) - (+targetDate)) / 86400000;
          if (diff < nearestDiff) {
            nearestDiff = diff;
            nearestExpiry = expDate;
          }
        });

        contracts.forEach(c => {
          if (c?.details?.expiration_date !== nearestExpiry) return;
          const strike = c?.details?.strike_price;
          const type = c?.details?.contract_type; // 'call' or 'put'
          if (strike == null || !type) return;

          if (!byStrike[strike]) byStrike[strike] = { K: strike };
          // Use day.close as the mark price; fall back to last_quote mid
          const dayClose = c?.day?.close;
          const bid = c?.last_quote?.bid;
          const ask = c?.last_quote?.ask;
          const mid = (bid != null && ask != null) ? (bid + ask) / 2 : null;
          const price = Number.isFinite(dayClose) ? dayClose : mid;

          const greeks = c?.greeks ?? {};
          const iv = c?.implied_volatility;
          const oi = c?.open_interest;

          if (type === 'call') {
            byStrike[strike].call = price;
            byStrike[strike].callDelta = greeks.delta;
            byStrike[strike].callTheta = greeks.theta;
            byStrike[strike].callOi = oi;
          } else {
            byStrike[strike].put = price;
            byStrike[strike].putDelta = greeks.delta;
            byStrike[strike].putTheta = greeks.theta;
            byStrike[strike].putOi = oi;
          }
          // Greeks that don't differ call/put
          byStrike[strike].gamma = greeks.gamma;
          byStrike[strike].vega  = greeks.vega;
          byStrike[strike].iv    = iv;
        });

        const sorted = Object.values(byStrike).sort((a, b) => a.K - b.K);
        if (sorted.length > 0 && nearestExpiry) {
          setPolygonOptions({
            rows: sorted,
            expiryDate: nearestExpiry,
            daysToExpiry: Math.round(((+new Date(nearestExpiry)) - Date.now()) / 86400000),
          });
          console.log('[polygon options]', instrument.id, sorted.length, 'strikes @', nearestExpiry);
        } else {
          setPolygonOptions(null);
        }
      } catch (err) {
        if (!cancelled) console.warn('[polygon options]', instrument.id, /** @type {Error} */ (err).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchOptions();
    // Re-fetch the chain every 30s. The Options Starter tier returns
    // 15-minute delayed quotes & Greeks but data does refresh continuously,
    // so a tight refresh keeps the panel looking live.
    const chainInterval = setInterval(fetchOptions, 30 * 1000);
    return () => {
      cancelled = true;
      clearInterval(chainInterval);
    };
  }, [instrument.id, instrument.cls, exp.days]);
  // Note: spot is intentionally NOT in deps — we don't want to refetch the
  // entire chain every time the underlying price ticks. The chain is fetched
  // once per instrument/expiration change and stays stable. The Black-Scholes
  // fallback for missing strikes still uses the live spot.

  // Build a strike ladder: 5 below spot + ATM + 5 above. Step is 2% of spot,
  // rounded to a sensible tick for the instrument's decimal class.
  const fallbackStrikes = useMemo(() => {
    const step = spot * 0.02;
    // Round to a nice tick — $1 for cheap things, $5 for stocks, $500 for BTC
    let tick = 1;
    if (spot < 10)        tick = 0.10;
    else if (spot < 100)  tick = 1;
    else if (spot < 500)  tick = 5;
    else if (spot < 5000) tick = 25;
    else                  tick = 500;
    const atm = Math.round(spot / tick) * tick;
    const arr = [];
    for (let i = -5; i <= 5; i++) {
      arr.push(+(atm + i * tick).toFixed(instrument.dec));
    }
    return arr;
  }, [spot, instrument.dec]);

  // Choose data source: real Polygon chain (if available) or Black-Scholes theoretical
  const usingLive = !!polygonOptions;
  const rows = usingLive
    ? polygonOptions.rows.map(r => {
        // Guarantee all fields defined; fall back to Black-Scholes if Polygon
        // didn't return a value for some strike/side pair.
        const fallback = blackScholes(spot, r.K, T, RISK_FREE_RATE, sigma);
        return {
          K: r.K,
          call: r.call ?? fallback.call,
          put:  r.put  ?? fallback.put,
          callDelta: r.callDelta ?? fallback.callDelta,
          putDelta:  r.putDelta  ?? fallback.putDelta,
          gamma: r.gamma ?? fallback.gamma,
          vega:  r.vega  ?? fallback.vega,
          callOi: r.callOi,
          putOi:  r.putOi,
          iv: r.iv,
        };
      })
    : fallbackStrikes.map(K => {
        const bs = blackScholes(spot, K, T, RISK_FREE_RATE, sigma);
        return { K, ...bs };
      });

  const fmtOpt = (v) => v < 0.01 ? '0.00' : v.toFixed(2);
  const fmtGrk = (v) => Math.abs(v) < 0.001 ? '0.00' : v.toFixed(3);

  const handleOptionClick = (type, K, price) => {
    onOptionTrade?.({
      underlying: instrument,
      type,                 // 'call' | 'put'
      strike: K,
      expiryDays: exp.days,
      premium: price,
      spot,
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Implied Move panel — derives the expected $/% move by expiry from
          the ATM straddle (call + put). This is the standard formula:
            implied_move ≈ (call_price + put_price) × 0.85
          (the 0.85 multiplier corrects for the straddle overstating the
          1-σ move slightly for short-dated options). */}
      {(() => {
        // Pick the ATM strike (closest to spot)
        const atmRow = rows.reduce((best, r) =>
          Math.abs(r.K - spot) < Math.abs((best?.K ?? Infinity) - spot) ? r : best,
          /** @type {any} */ (null));
        if (!atmRow) return null;
        const straddle = (atmRow.call ?? 0) + (atmRow.put ?? 0);
        const impliedMove = straddle * 0.85;
        const impliedMovePct = spot > 0 ? (impliedMove / spot) * 100 : 0;
        const upperBound = spot + impliedMove;
        const lowerBound = spot - impliedMove;
        return (
          <div className="px-3 py-2.5 border-b shrink-0 flex items-center justify-between gap-3 flex-wrap"
               style={{ borderColor: COLORS.border, background: 'rgba(61,123,255,0.04)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider font-semibold"
                    style={{ color: COLORS.mint, letterSpacing: '0.06em' }}>
                Implied Move · {exp.label}
              </span>
              <span className="text-[9.5px] px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(255,184,77,0.12)', color: '#FFB84D' }}
                    title="Computed from the ATM straddle premium">
                ATM straddle
              </span>
            </div>
            <div className="flex items-center gap-4 tabular-nums text-[12px]">
              <div>
                <span style={{ color: COLORS.textMute }}>Move </span>
                <span className="font-semibold" style={{ color: COLORS.text }}>
                  ±${impliedMove.toFixed(2)}
                </span>
                <span className="ml-1" style={{ color: COLORS.textMute }}>
                  ({impliedMovePct.toFixed(2)}%)
                </span>
              </div>
              <div className="h-3 w-px" style={{ background: COLORS.border }} />
              <div>
                <span style={{ color: COLORS.textMute }}>Range </span>
                <span style={{ color: COLORS.red }}>${lowerBound.toFixed(2)}</span>
                <span className="mx-1" style={{ color: COLORS.textMute }}>↔</span>
                <span style={{ color: COLORS.green }}>${upperBound.toFixed(2)}</span>
              </div>
              <div className="h-3 w-px" style={{ background: COLORS.border }} />
              <div title="Probability that the underlying stays inside the implied range — 1-σ ≈ 68%">
                <span style={{ color: COLORS.textMute }}>1σ confidence </span>
                <span style={{ color: COLORS.text }}>~68%</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Expiration tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b shrink-0"
           style={{ borderColor: COLORS.border }}>
        {expirations.map((e, i) => (
          <button
            key={e.label}
            onClick={() => setExpIdx(i)}
            className="px-2.5 py-1 text-[11px] rounded transition-colors"
            style={{
              color: expIdx === i ? COLORS.text : COLORS.textDim,
              background: expIdx === i ? COLORS.surface : 'transparent',
            }}
          >{e.label}</button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {loading && (
            <span className="text-[10px]" style={{ color: COLORS.textMute }}>Loading…</span>
          )}
          {usingLive && (
            <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded"
                  style={{ background: 'rgba(151, 252, 228, 0.12)', color: COLORS.mint }}
                  title="Real chain from Polygon (delayed 15min)">
              LIVE · {polygonOptions.expiryDate}
            </span>
          )}
          <span className="text-[10px] tabular-nums" style={{ color: COLORS.textMute }}>
            IV {usingLive && /** @type {any} */ (rows[0])?.iv ? (/** @type {any} */ (rows[0]).iv * 100).toFixed(0) : (sigma * 100).toFixed(0)}%
          </span>
          <button onClick={() => setStrategiesOpen(true)}
                  className="px-2 py-0.5 text-[10px] rounded border ml-1"
                  style={{ borderColor: COLORS.mint, color: COLORS.mint, background: 'rgba(61,123,255,0.06)' }}
                  title="Get an options strategy recommendation based on your objective">
            ✨ Strategies
          </button>
        </div>
      </div>

      {strategiesOpen && (
        <OptionsStrategiesModal
          instrument={instrument}
          spot={spot}
          rows={rows}
          onClose={() => setStrategiesOpen(false)}
          onPick={(payload) => { onOptionTrade(payload); setStrategiesOpen(false); }}
        />
      )}

      {/* Header row */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider border-b shrink-0"
           style={{ color: COLORS.textMute, borderColor: COLORS.border }}>
        <span className="text-right" style={{ color: COLORS.green }}>Call</span>
        <span className="text-center">Strike</span>
        <span style={{ color: COLORS.red }}>Put</span>
      </div>

      {/* Rows — click Call/Put prices to open the trade ticket */}
      <div className="flex-1 min-h-0 overflow-y-auto text-[11.5px] tabular-nums">
        {rows.map((r, i) => {
          const isAtm = Math.abs(r.K - spot) < spot * 0.005;
          return (
            <div
              key={i}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              className="grid grid-cols-[1fr_auto_1fr] gap-2 px-3 py-[5px] transition-colors"
              style={{
                background: hovered === i ? 'rgba(255,255,255,0.02)' :
                            isAtm        ? 'rgba(61,123,255,0.06)' : 'transparent',
              }}
            >
              <button
                onClick={() => handleOptionClick('call', r.K, r.call)}
                className="text-right transition-colors hover:bg-white/[0.04] rounded px-1 -mx-1"
                style={{ color: COLORS.green }}
                title={`Buy ${instrument.id} ${exp.label} ${fmt(r.K, instrument.dec)} call @ ${fmtOpt(r.call)}`}
              >
                {fmtOpt(r.call)}
              </button>
              <span className="text-center px-2"
                    style={{
                      color: isAtm ? COLORS.mint : COLORS.text,
                      fontWeight: isAtm ? 500 : 400,
                    }}>
                {fmt(r.K, instrument.dec)}
              </span>
              <button
                onClick={() => handleOptionClick('put', r.K, r.put)}
                className="text-left transition-colors hover:bg-white/[0.04] rounded px-1 -mx-1"
                style={{ color: COLORS.red }}
                title={`Buy ${instrument.id} ${exp.label} ${fmt(r.K, instrument.dec)} put @ ${fmtOpt(r.put)}`}
              >
                {fmtOpt(r.put)}
              </button>
            </div>
          );
        })}
      </div>

      {/* Greeks panel — shows greeks for hovered or ATM row */}
      <div className="border-t shrink-0 px-3 py-2 text-[10px]"
           style={{ borderColor: COLORS.border, background: COLORS.surface }}>
        {(() => {
          const i = hovered ?? rows.findIndex(r => Math.abs(r.K - spot) < spot * 0.005);
          const r = rows[i] ?? rows[Math.floor(rows.length/2)];
          return (
            <>
              <div className="flex items-center justify-between mb-1.5">
                <span style={{ color: COLORS.textMute }}>Greeks at K = {fmt(r.K, instrument.dec)}</span>
                <span style={{ color: COLORS.textMute }}>Spot {fmt(spot, instrument.dec)}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 tabular-nums">
                <GreekCell label="Δ Call" value={fmtGrk(r.callDelta)} />
                <GreekCell label="Δ Put"  value={fmtGrk(r.putDelta)} />
                <GreekCell label="Γ"      value={fmtGrk(r.gamma)} />
                <GreekCell label="ν"      value={fmtGrk(r.vega)} />
              </div>
              <div className="mt-1.5 text-[9px]" style={{ color: COLORS.textMute }}>
                {usingLive
                  ? `Polygon (delayed 15min) · Expires ${polygonOptions.expiryDate} · Click a price to trade`
                  : `Pricing model: Black-Scholes · r=${RISK_FREE_RATE * 100}% · σ=${(sigma*100).toFixed(0)}% · T=${exp.days}d · Click a price to trade`}
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
};

const GreekCell = ({ label, value }) => (
  <div className="flex flex-col">
    <span className="text-[9px]" style={{ color: COLORS.textMute }}>{label}</span>
    <span className="text-[11px]" style={{ color: COLORS.text }}>{value}</span>
  </div>
);

/* ──────────── Order Entry ──────────── */

/**
 * @param {{ instrument: any, markPrice: number, account: any, user: any, onOpenPosition: Function, initialSide?: 'buy'|'sell' }} props
 */
export const OrderEntry = ({ instrument, markPrice, account, user, onOpenPosition, initialSide }) => {
  const [side, setSide]       = useState(initialSide ?? 'buy');
  const [type, setType]       = useState('limit');
  const [price, setPrice]     = useState(markPrice.toFixed(instrument.dec));
  const [size, setSize]       = useState('');
  const [sizePct, setSizePct] = useState(0);
  // Cash mode forces leverage = 1 (no margin used). Margin mode allows leverage > 1.
  const [useMargin, setUseMargin] = useState(false);
  const [leverage, setLev]    = useState(1);
  const [reduceOnly, setRO]   = useState(false);
  const [postOnly, setPO]     = useState(false);
  const [tif, setTif]         = useState('GTC');
  const [ackMsg, setAckMsg]   = useState(/** @type {null | { kind: 'info'|'err'|'ok', text: string }} */ (null));
  // Pro-mode: stop-limit + bracket order parameters
  const [stopPrice, setStopPrice]   = useState('');
  const [stopDir, setStopDir]       = useState('above'); // 'above' | 'below'
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss]     = useState('');

  useEffect(() => {
    if (type === 'market') setPrice(markPrice.toFixed(instrument.dec));
  }, [markPrice, type, instrument.dec]);

  // Order prefill — when the Position Sizer (or any other surface) wants
  // to populate this form, it stores a payload in localStorage. We
  // consume it on mount + when the instrument changes, then clear it.
  // Payload shape: { symbol, side, size, source: 'sizer' }
  useEffect(() => {
    try {
      const raw = localStorage.getItem('imo_order_prefill');
      if (!raw) return;
      const prefill = JSON.parse(raw);
      const sym = instrument.id?.split('-')[0] ?? instrument.symbol;
      if (prefill.symbol && sym !== prefill.symbol) return; // wrong instrument
      if (prefill.side) setSide(prefill.side);
      if (prefill.size) setSize(String(prefill.size));
      if (prefill.source === 'sizer') {
        setAckMsg({
          kind: 'info',
          text: `Prefilled from Position Sizer (${prefill.size} shares ${prefill.side}). Adjust as needed before submitting.`,
        });
      }
      localStorage.removeItem('imo_order_prefill');
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument?.id]);

  // Cash mode forces leverage to 1x — toggling cash also resets the slider
  useEffect(() => {
    if (!useMargin && leverage !== 1) setLev(1);
  }, [useMargin, leverage]);

  // Experience-aware leverage cap. Novice users get 2x cap to avoid blow-ups.
  const exp = user?.profile?.experience ?? 'intermediate';
  const maxLev = exp === 'novice' ? 2 : 10;
  const balance = account?.balance ?? 0;
  const marginUsedTotal = account?.marginUsed ?? 0;
  const availableUsd = Math.max(0, balance - marginUsedTotal);
  const notional = (parseFloat(size) || 0) * (parseFloat(price) || markPrice);
  const margin = notional / leverage;
  const isBuy = side === 'buy';
  const hasFunds = availableUsd > 0;

  const setPctOfAvail = (pct) => {
    setSizePct(pct);
    if (availableUsd <= 0) return;
    const usd = availableUsd * (pct / 100) * leverage;
    const qty = usd / (parseFloat(price) || markPrice);
    setSize(qty.toFixed(instrument.cls === 'crypto' ? 4 : 0));
  };

  const handleSubmit = () => {
    const sz = parseFloat(size);
    const px = type === 'market' ? markPrice : parseFloat(price);
    if (!isFinite(sz) || sz <= 0) return;

    if (!hasFunds) {
      setAckMsg({ kind: 'err', text: 'No funds. Deposit via the Deposit button.' });
      setTimeout(() => setAckMsg(null), 2500);
      return;
    }
    if (margin > availableUsd) {
      setAckMsg({ kind: 'err', text: `Insufficient margin. Need ${fmtCompact(margin)}, have ${fmtCompact(availableUsd)}.` });
      setTimeout(() => setAckMsg(null), 3000);
      return;
    }

    // Open the position on the account. For limit orders we book at the
    // limit price; for market orders we book at the current mark. A real
    // exchange would fill against the book — here we simulate instant fill.
    //
    // onOpenPosition may return either a sync result OR a Promise
    // (when the App's safety gate is enabled and the notional clears
    // the threshold). Promise.resolve() handles both shapes, so the
    // success/error UI fires AFTER the user confirms or cancels.
    Promise.resolve(onOpenPosition?.({
      instrument,
      side: isBuy ? 'long' : 'short',
      size: sz,
      leverage,
      entryPrice: px,
    })).then((result) => {
      if (result?.ok === false) {
        setAckMsg({ kind: 'err', text: result.error || 'Order rejected' });
        setTimeout(() => setAckMsg(null), 3000);
        return;
      }
      setAckMsg({
        kind: 'ok',
        text: `${isBuy ? 'Long' : 'Short'} ${sz} ${instrument.id.split('-')[0]} @ ${fmt(px, instrument.dec)} · ${leverage}× · margin ${fmtCompact(margin)}`,
      });
      setSize('');
      setSizePct(0);
      setTimeout(() => setAckMsg(null), 3500);
    });
  };

  const leverageTicks = exp === 'novice' ? [1, 2] : [1, 2, 3, 5, 10];

  return (
    <div
      className="h-full w-full flex flex-col"
      style={{ background: COLORS.bg }}
    >
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-md" style={{ background: COLORS.surface }}>
          <button
            onClick={() => setSide('buy')}
            className="py-2 text-[13px] font-medium rounded-md transition-all"
            style={{
              color: isBuy ? COLORS.bg : COLORS.textDim,
              background: isBuy ? COLORS.green : 'transparent',
            }}
          >Buy / Long</button>
          <button
            onClick={() => setSide('sell')}
            className="py-2 text-[13px] font-medium rounded-md transition-all"
            style={{
              color: !isBuy ? COLORS.bg : COLORS.textDim,
              background: !isBuy ? COLORS.red : 'transparent',
            }}
          >Sell / Short</button>
        </div>
      </div>

      <div className="px-4 pb-3 flex items-center gap-1 shrink-0">
        {(() => {
          // Experience-aware: novice users only see market and limit.
          // Intermediate/experienced see the pro option (stop-limit, brackets).
          const exp = user?.profile?.experience ?? 'novice';
          const types = exp === 'novice' ? ['market', 'limit'] : ['market', 'limit', 'pro'];
          return types;
        })().map(t => (
          <button
            key={t}
            onClick={() => setType(t)}
            className="px-3 py-1 text-[12px] rounded-md transition-colors capitalize"
            style={{
              color: type === t ? COLORS.text : COLORS.textDim,
              background: type === t ? COLORS.surface : 'transparent',
            }}
          >{t}</button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
        <LabeledField label="Available to trade">
          <div className="flex items-baseline justify-between">
            <span className="text-[15px] tabular-nums"
                  style={{ color: hasFunds ? COLORS.text : COLORS.textMute }}>
              {hasFunds ? fmtCompact(availableUsd) : '$0.00'}
            </span>
            <span className="text-[11px]" style={{ color: COLORS.textMute }}>USD</span>
          </div>
        </LabeledField>

        <LabeledField label="Price (USD)" disabled={type === 'market'}>
          <input
            type="text"
            value={type === 'market' ? 'Market' : price}
            onChange={e => setPrice(e.target.value)}
            disabled={type === 'market'}
            className="w-full bg-transparent text-[15px] tabular-nums outline-none disabled:text-white/40"
            style={{ color: COLORS.text }}
          />
        </LabeledField>

        {/* Pro mode: stop-limit + bracket order. The order triggers as a
            limit at `price` only after the mark crosses `stopPrice` in the
            chosen direction. Take-profit and stop-loss create OCO closes. */}
        {type === 'pro' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <LabeledField label="Trigger price">
                <input
                  type="text"
                  value={stopPrice}
                  onChange={e => setStopPrice(e.target.value)}
                  placeholder={fmt(markPrice, instrument.dec)}
                  className="w-full bg-transparent text-[14px] tabular-nums outline-none placeholder-white/20"
                  style={{ color: COLORS.text }}
                />
              </LabeledField>
              <LabeledField label="Trigger when">
                <select
                  value={stopDir}
                  onChange={e => setStopDir(e.target.value)}
                  className="w-full bg-transparent text-[13px] outline-none cursor-pointer"
                  style={{ color: COLORS.text, colorScheme: 'dark' }}
                >
                  <option value="above" style={{ background: COLORS.surface }}>Mark ≥ trigger</option>
                  <option value="below" style={{ background: COLORS.surface }}>Mark ≤ trigger</option>
                </select>
              </LabeledField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <LabeledField label="Take profit (optional)">
                <input
                  type="text"
                  value={takeProfit}
                  onChange={e => setTakeProfit(e.target.value)}
                  placeholder="—"
                  className="w-full bg-transparent text-[13px] tabular-nums outline-none placeholder-white/20"
                  style={{ color: COLORS.green }}
                />
              </LabeledField>
              <LabeledField label="Stop loss (optional)">
                <input
                  type="text"
                  value={stopLoss}
                  onChange={e => setStopLoss(e.target.value)}
                  placeholder="—"
                  className="w-full bg-transparent text-[13px] tabular-nums outline-none placeholder-white/20"
                  style={{ color: COLORS.red }}
                />
              </LabeledField>
            </div>
            <div className="text-[10px] -mt-1" style={{ color: COLORS.textMute }}>
              Order rests until mark price crosses the trigger, then enters as a {price ? 'limit' : 'market'} order.
              Take-profit and stop-loss form an OCO bracket once filled.
            </div>
          </>
        )}

        <LabeledField label={`Size (${instrument.cls === 'crypto' ? instrument.id.split('-')[0] : 'contracts'})`}>
          <input
            type="text"
            value={size}
            onChange={e => { setSize(e.target.value); setSizePct(0); }}
            placeholder="0.00"
            className="w-full bg-transparent text-[15px] tabular-nums outline-none placeholder-white/20"
            style={{ color: COLORS.text }}
          />
        </LabeledField>

        <div className="flex items-center gap-1">
          {[25, 50, 75, 100].map(p => (
            <button
              key={p}
              onClick={() => setPctOfAvail(p)}
              className="flex-1 py-1.5 text-[11px] rounded-md transition-colors tabular-nums"
              style={{
                color: sizePct === p ? COLORS.bg : COLORS.textDim,
                background: sizePct === p ? COLORS.mint : COLORS.surface,
              }}
            >{p}%</button>
          ))}
        </div>

        <div className="pt-1">
          {/* Cash vs Margin selector */}
          <div className="flex items-center gap-1 mb-3 p-0.5 rounded-md"
               style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
            <button
              onClick={() => setUseMargin(false)}
              className="flex-1 py-1 text-[11px] rounded transition-colors"
              style={{
                color: !useMargin ? COLORS.bg : COLORS.textDim,
                background: !useMargin ? COLORS.mint : 'transparent',
                fontWeight: !useMargin ? 600 : 400,
              }}
              title="Cash mode — pay full notional, no borrowing"
            >Cash</button>
            <button
              onClick={() => setUseMargin(true)}
              className="flex-1 py-1 text-[11px] rounded transition-colors"
              style={{
                color: useMargin ? COLORS.bg : COLORS.textDim,
                background: useMargin ? COLORS.mint : 'transparent',
                fontWeight: useMargin ? 600 : 400,
              }}
              title="Margin mode — use leverage to amplify exposure"
            >Margin</button>
          </div>

          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px]" style={{ color: useMargin ? COLORS.textMute : COLORS.textMute, opacity: useMargin ? 1 : 0.5 }}>
              Leverage {!useMargin && '(cash mode locked)'}
            </span>
            <input
              type="number"
              min={1}
              max={maxLev}
              step={1}
              value={leverage}
              onChange={e => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setLev(Math.max(1, Math.min(maxLev, v)));
              }}
              disabled={!useMargin}
              className="px-2 py-0.5 rounded text-[11px] font-medium tabular-nums w-14 text-center outline-none"
              style={{
                color: useMargin ? COLORS.mint : COLORS.textMute,
                background: useMargin ? 'rgba(61,123,255,0.08)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${COLORS.border}`,
              }}
              title="Type an exact leverage value"
            />
            <span
              className="text-[11px] font-medium"
              style={{
                color: useMargin ? COLORS.mint : COLORS.textMute,
              }}
            >×</span>
          </div>
          <div className="relative pt-1" style={{ opacity: useMargin ? 1 : 0.4, pointerEvents: useMargin ? 'auto' : 'none' }}>
            <input
              type="range"
              min={1}
              max={maxLev}
              value={leverage}
              onChange={e => setLev(Number(e.target.value))}
              disabled={!useMargin}
              className="w-full hl-slider"
            />
          </div>
          <div className="relative h-6 mt-1" style={{ opacity: useMargin ? 1 : 0.4 }}>
            {leverageTicks.map(t => {
              const pct = ((t - 1) / (maxLev - 1)) * 100;
              return (
                <button
                  key={t}
                  onClick={() => useMargin && setLev(t)}
                  disabled={!useMargin}
                  className="absolute top-0 text-[10px] tabular-nums transition-colors whitespace-nowrap"
                  style={{
                    left: `${pct}%`,
                    transform: 'translateX(-50%)',
                    color: leverage === t ? COLORS.mint : COLORS.textMute,
                    cursor: useMargin ? 'pointer' : 'not-allowed',
                  }}
                >{t}×</button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] pt-1">
          <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: COLORS.textDim }}>
            <input type="checkbox" checked={reduceOnly} onChange={e => setRO(e.target.checked)} className="accent-mint" />
            <span>Reduce only</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: COLORS.textDim }}>
            <input type="checkbox" checked={postOnly} onChange={e => setPO(e.target.checked)} className="accent-mint" />
            <span>Post only</span>
          </label>
          <select
            value={tif}
            onChange={e => setTif(e.target.value)}
            className="ml-auto px-1.5 py-0.5 rounded text-[11px] border outline-none tabular-nums"
            style={{ color: COLORS.textDim, borderColor: COLORS.border, background: COLORS.surface }}
          >
            <option>GTC</option><option>IOC</option><option>FOK</option>
          </select>
        </div>

        <div
          className="mt-2 pt-3 space-y-1.5 border-t"
          style={{ borderColor: COLORS.border }}
        >
          <SummaryRow label="Order value" value={fmtCompact(notional)} />
          <SummaryRow label="Margin required" value={fmtCompact(margin)} />
          <SummaryRow
            label="Est. liquidation"
            value={size && price
              ? fmt(parseFloat(price) * (isBuy ? (1 - 0.95 / leverage) : (1 + 0.95 / leverage)), instrument.dec)
              : '—'}
          />
          <SummaryRow label="Fee (taker)" value={fmtCompact(notional * 0.00025)} />
          <SummaryRow label="Settlement" value="JPM Coin · T+0" mint />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!size || parseFloat(size) === 0}
          className="mt-2 py-3 rounded-md text-[13px] font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            color: COLORS.bg,
            background: isBuy ? COLORS.green : COLORS.red,
          }}
        >
          {ackMsg?.kind === 'ok' ? 'Order placed' : `Place ${isBuy ? 'buy' : 'sell'} order`}
        </button>

        {ackMsg && (
          <div
            className="text-[11px] px-3 py-2 rounded-md flex items-center gap-1.5 tabular-nums"
            style={{
              background: ackMsg.kind === 'err' ? 'rgba(237,112,136,0.06)' : 'rgba(61,123,255,0.06)',
              color:      ackMsg.kind === 'err' ? COLORS.red : COLORS.mint,
              border:     ackMsg.kind === 'err'
                ? '1px solid rgba(237,112,136,0.15)'
                : '1px solid rgba(61,123,255,0.15)',
            }}
          >
            <Zap size={11} />
            <span>{ackMsg.text}</span>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * @param {{ label: string, children?: any, disabled?: boolean }} props
 */
export const LabeledField = ({ label, children, disabled }) => (
  <div
    className="px-3 py-2 rounded-md border transition-colors"
    style={{
      background: disabled ? 'transparent' : COLORS.surface,
      borderColor: COLORS.border,
    }}
  >
    <div className="text-[10px] mb-1" style={{ color: COLORS.textMute }}>{label}</div>
    {children}
  </div>
);

/**
 * @param {{ label: string, value: any, mint?: boolean }} props
 */
export const SummaryRow = ({ label, value, mint }) => (
  <div className="flex items-center justify-between text-[11px]">
    <span style={{ color: COLORS.textMute }}>{label}</span>
    <span className="tabular-nums" style={{ color: mint ? COLORS.mint : COLORS.text }}>{value}</span>
  </div>
);
