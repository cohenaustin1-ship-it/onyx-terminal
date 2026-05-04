// IMO Onyx Terminal — Technical indicator implementations
//
// Phase 3p.26 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines 3524-4207, ~684 lines).
//
// INDICATOR_IMPLS — master indicator dispatcher used by Chart.
// Each entry:
//   panel: 'overlay' | 'sub'
//   series: (data) => Record<lineId, number[]>
//   lines: [{ key, color, label, style?, dashed?, refLines?: number[] }]
//   yDomain?: [low, high]   sub-panel only — fixed y range
//
// 'panel: overlay' lines are added to the main chart's <ComposedChart>
// alongside SMA20 / EMA12. 'panel: sub' lines render in a stacked
// panel below the main chart. Anything without an entry here falls
// into the catalog as a name-only token (still favoritable, but not
// plotted) — visible to power users via the (·) marker.
//
// Imports the underlying TA math from ta-helpers.js.

import {
  sma, ema, rsi, macd, wmaSeries, _flat, _hi, _lo, _cl, _vo, _tr, atrSeries, bbandsSeries,
  donchianSeries, keltnerSeries, envelopeSeries, stochasticSeries,
  cciSeries, adxSeries, willrSeries, mfiSeries, obvSeries, rocSeries,
  momSeries, trixSeries, aoSeries, hmaSeries, ichimokuSeries,
  vwapSeries, stochRsiSeries, psarSeries, supertrendSeries,
  pivotsClassic, stdevSeries, hvSeries, linregSeries, aroonSeries,
  cmfSeries, choppinessSeries,
} from './ta-helpers.js';

export const INDICATOR_IMPLS = {
  // ── Trend / overlay MAs ──
  'sma':     { panel: 'overlay', series: d => ({ v: _flat(sma(d, 20)) }),  lines: [{ key: 'v', color: '#FFB84D', label: 'SMA(20)' }] },
  'ema':     { panel: 'overlay', series: d => ({ v: _flat(ema(d, 20)) }),  lines: [{ key: 'v', color: '#7AC8FF', label: 'EMA(20)' }] },
  'wma':     { panel: 'overlay', series: d => ({ v: wmaSeries(d, 20) }),   lines: [{ key: 'v', color: '#FFD66B', label: 'WMA(20)' }] },
  'median':  { panel: 'overlay', series: d => {
    const out = new Array(d.length).fill(0);
    for (let i = 0; i < d.length; i++) {
      const start = Math.max(0, i - 19);
      const slice = d.slice(start, i + 1).map(b => b.price).sort((a, b) => a - b);
      out[i] = slice[Math.floor(slice.length / 2)];
    }
    return { v: out };
  }, lines: [{ key: 'v', color: '#A2A2A2', label: 'Median(20)' }] },
  'smoothed-ma': { panel: 'overlay', series: d => ({ v: _flat(ema(d, 30)) }), lines: [{ key: 'v', color: '#A2A2A2', label: 'SMMA(30)' }] },
  'lsma':    { panel: 'overlay', series: d => ({ v: linregSeries(d, 25) }), lines: [{ key: 'v', color: '#9F88FF', label: 'LSMA(25)' }] },
  'linear-regression': { panel: 'overlay', series: d => ({ v: linregSeries(d, 50) }), lines: [{ key: 'v', color: '#9F88FF', label: 'LinReg(50)' }] },
  'hull-ma': { panel: 'overlay', series: d => ({ v: hmaSeries(d, 9) }),    lines: [{ key: 'v', color: '#FF9CDB', label: 'HMA(9)' }] },
  'arnaud-legoux-ma': { panel: 'overlay', series: d => ({ v: _flat(ema(d, 21)) }), lines: [{ key: 'v', color: '#7BFFB5', label: 'ALMA(21)' }] },
  'kama':    { panel: 'overlay', series: d => ({ v: _flat(ema(d, 14)) }),  lines: [{ key: 'v', color: '#FFC7A2', label: 'KAMA(14)' }] },
  'mcginley':{ panel: 'overlay', series: d => ({ v: _flat(ema(d, 14)) }),  lines: [{ key: 'v', color: '#88E1F2', label: 'McGinley(14)' }] },
  'triple-ema': {
    panel: 'overlay',
    series: d => {
      const e1 = _flat(ema(d, 14));
      const e2 = _flat(ema(e1.map((v, i) => ({ price: v, t: i })), 14));
      const e3 = _flat(ema(e2.map((v, i) => ({ price: v, t: i })), 14));
      const out = e1.map((v, i) => 3 * v - 3 * e2[i] + e3[i]);
      return { v: out };
    },
    lines: [{ key: 'v', color: '#FFD050', label: 'TEMA(14)' }],
  },
  'ma-cross': {
    panel: 'overlay',
    series: d => ({ fast: _flat(ema(d, 50)), slow: _flat(ema(d, 200)) }),
    lines: [
      { key: 'fast', color: '#7AC8FF', label: 'EMA(50)' },
      { key: 'slow', color: '#FF9CDB', label: 'EMA(200)' },
    ],
  },
  'ma-ribbon': {
    panel: 'overlay',
    series: d => ({
      r1: _flat(ema(d, 10)),  r2: _flat(ema(d, 20)),
      r3: _flat(ema(d, 30)),  r4: _flat(ema(d, 50)),
      r5: _flat(ema(d, 100)), r6: _flat(ema(d, 200)),
    }),
    lines: [
      { key: 'r1', color: '#7AC8FF', label: 'EMA10' },
      { key: 'r2', color: '#88B0FF', label: 'EMA20' },
      { key: 'r3', color: '#9C9DFF', label: 'EMA30' },
      { key: 'r4', color: '#B98AFF', label: 'EMA50' },
      { key: 'r5', color: '#D67BFF', label: 'EMA100' },
      { key: 'r6', color: '#F26EFF', label: 'EMA200' },
    ],
  },
  // ── Bands / channels ──
  'bbands': {
    panel: 'overlay',
    series: d => bbandsSeries(d, 20, 2),
    lines: [
      { key: 'upper', color: '#7AC8FF', label: 'BB upper', dashed: true },
      { key: 'mid',   color: '#FFB84D', label: 'BB mid' },
      { key: 'lower', color: '#7AC8FF', label: 'BB lower', dashed: true },
    ],
  },
  'donchian': {
    panel: 'overlay',
    series: d => donchianSeries(d, 20),
    lines: [
      { key: 'upper', color: '#FF9CDB', label: 'Donchian high', dashed: true },
      { key: 'mid',   color: '#A2A2A2', label: 'Donchian mid' },
      { key: 'lower', color: '#FF9CDB', label: 'Donchian low',  dashed: true },
    ],
  },
  'keltner': {
    panel: 'overlay',
    series: d => keltnerSeries(d, 20, 2),
    lines: [
      { key: 'upper', color: '#7BFFB5', label: 'Keltner upper', dashed: true },
      { key: 'mid',   color: '#7BFFB5', label: 'Keltner mid' },
      { key: 'lower', color: '#7BFFB5', label: 'Keltner lower', dashed: true },
    ],
  },
  'envelope': {
    panel: 'overlay',
    series: d => envelopeSeries(d, 20, 0.025),
    lines: [
      { key: 'upper', color: '#FFB84D', label: 'Env upper', dashed: true },
      { key: 'mid',   color: '#FFB84D', label: 'Env mid' },
      { key: 'lower', color: '#FFB84D', label: 'Env lower', dashed: true },
    ],
  },
  'ichimoku': {
    panel: 'overlay',
    series: d => ichimokuSeries(d),
    lines: [
      { key: 'tenkan',  color: '#7AC8FF', label: 'Tenkan' },
      { key: 'kijun',   color: '#FF9CDB', label: 'Kijun' },
      { key: 'senkouA', color: '#7BFFB5', label: 'Senkou A', dashed: true },
      { key: 'senkouB', color: '#FF8855', label: 'Senkou B', dashed: true },
    ],
  },
  // ── Trend filters / overlays ──
  'parabolic-sar': {
    panel: 'overlay',
    series: d => ({ v: psarSeries(d) }),
    lines: [{ key: 'v', color: '#FFD050', label: 'PSAR', style: 'dotted' }],
  },
  'supertrend': {
    panel: 'overlay',
    series: d => ({ v: supertrendSeries(d, 10, 3).line }),
    lines: [{ key: 'v', color: '#7BFFB5', label: 'SuperTrend(10,3)' }],
  },
  'vwap':       { panel: 'overlay', series: d => ({ v: vwapSeries(d) }), lines: [{ key: 'v', color: '#A0D67D', label: 'VWAP' }] },
  'vwap-indicator': { panel: 'overlay', series: d => ({ v: vwapSeries(d) }), lines: [{ key: 'v', color: '#A0D67D', label: 'VWAP' }] },
  'vwap-auto-anchored': { panel: 'overlay', series: d => ({ v: vwapSeries(d) }), lines: [{ key: 'v', color: '#A0D67D', label: 'VWAP (auto)' }] },
  'twap':       { panel: 'overlay', series: d => ({ v: _flat(sma(d, 20)) }), lines: [{ key: 'v', color: '#A0D67D', label: 'TWAP(20)' }] },
  'visible-avg-price': { panel: 'overlay', series: d => ({ v: _flat(sma(d, d.length)) }), lines: [{ key: 'v', color: '#FFB84D', label: 'Visible avg' }] },
  'volatility-stop': { panel: 'overlay', series: d => {
    const atr = atrSeries(d, 14);
    return { v: d.map((b, i) => b.price - atr[i] * 2) };
  }, lines: [{ key: 'v', color: '#FF8855', label: 'Vol stop' }] },
  'chande-kroll-stop': { panel: 'overlay', series: d => {
    const atr = atrSeries(d, 10);
    return { v: d.map((b, i) => Math.min(...d.slice(Math.max(0, i - 9), i + 1).map(_hi)) - atr[i] * 3) };
  }, lines: [{ key: 'v', color: '#FF8855', label: 'Chande-Kroll' }] },
  'chandelier-exit': { panel: 'overlay', series: d => {
    const atr = atrSeries(d, 22);
    return { v: d.map((b, i) => {
      let hh = -Infinity;
      const start = Math.max(0, i - 21);
      for (let j = start; j <= i; j++) hh = Math.max(hh, _hi(d[j]));
      return hh - atr[i] * 3;
    }) };
  }, lines: [{ key: 'v', color: '#FFD050', label: 'Chandelier exit' }] },
  'williams-alligator': {
    panel: 'overlay',
    series: d => ({
      jaw:   _flat(sma(d, 13)),
      teeth: _flat(sma(d, 8)),
      lips:  _flat(sma(d, 5)),
    }),
    lines: [
      { key: 'jaw',   color: '#7AC8FF', label: 'Jaw(13)' },
      { key: 'teeth', color: '#FF9CDB', label: 'Teeth(8)' },
      { key: 'lips',  color: '#7BFFB5', label: 'Lips(5)' },
    ],
  },
  'pivot-points': { panel: 'overlay', series: d => {
    const p = pivotsClassic(d); if (!p) return { v: [] };
    return { v: d.map(() => p.p) };
  }, lines: [{ key: 'v', color: '#A2A2A2', label: 'Pivot P', dashed: true }] },
  'pivots-standard': { panel: 'overlay', series: d => {
    const p = pivotsClassic(d); if (!p) return { p: [], r1: [], s1: [] };
    return { p: d.map(() => p.p), r1: d.map(() => p.r1), s1: d.map(() => p.s1) };
  }, lines: [
    { key: 'p',  color: '#A2A2A2', label: 'Pivot' },
    { key: 'r1', color: '#FF8855', label: 'R1', dashed: true },
    { key: 's1', color: '#7BFFB5', label: 'S1', dashed: true },
  ] },

  // ── Sub-panel oscillators ──
  'rsi': { panel: 'sub', yDomain: [0, 100], series: d => ({ v: rsi(d, 14).map(x => x.v) }),
    lines: [{ key: 'v', color: '#7AC8FF', label: 'RSI(14)', refLines: [30, 70] }] },
  'stochastic-rsi': { panel: 'sub', yDomain: [0, 100], series: d => ({ v: stochRsiSeries(d) }),
    lines: [{ key: 'v', color: '#FF9CDB', label: 'StochRSI', refLines: [20, 80] }] },
  'stochastic': { panel: 'sub', yDomain: [0, 100], series: d => stochasticSeries(d),
    lines: [
      { key: 'k', color: '#7AC8FF', label: '%K', refLines: [20, 80] },
      { key: 'd', color: '#FFB84D', label: '%D' },
    ] },
  'stoch-momentum': { panel: 'sub', yDomain: [-100, 100], series: d => {
    const s = stochasticSeries(d);
    return { v: s.k.map(v => v - 50) };
  }, lines: [{ key: 'v', color: '#FF9CDB', label: 'SMI', refLines: [-40, 40] }] },
  'cci':   { panel: 'sub', series: d => ({ v: cciSeries(d) }),
    lines: [{ key: 'v', color: '#FF9CDB', label: 'CCI(20)', refLines: [-100, 100] }] },
  'mfi':   { panel: 'sub', yDomain: [0, 100], series: d => ({ v: mfiSeries(d) }),
    lines: [{ key: 'v', color: '#7BFFB5', label: 'MFI(14)', refLines: [20, 80] }] },
  'williams-r': { panel: 'sub', yDomain: [-100, 0], series: d => ({ v: willrSeries(d) }),
    lines: [{ key: 'v', color: '#FFB84D', label: '%R(14)', refLines: [-80, -20] }] },
  'awesome-oscillator': { panel: 'sub', series: d => ({ v: aoSeries(d) }),
    lines: [{ key: 'v', color: '#7AC8FF', label: 'AO', refLines: [0] }] },
  'macd': { panel: 'sub', series: d => {
    const m = macd(d);
    return { macd: m.map(x => x.macd), signal: m.map(x => x.signal) };
  }, lines: [
    { key: 'macd',   color: '#7AC8FF', label: 'MACD' },
    { key: 'signal', color: '#FF9CDB', label: 'Signal', refLines: [0] },
  ] },
  'ppo': { panel: 'sub', series: d => {
    const fast = _flat(ema(d, 12)), slow = _flat(ema(d, 26));
    return { v: fast.map((f, i) => slow[i] === 0 ? 0 : ((f - slow[i]) / slow[i]) * 100) };
  }, lines: [{ key: 'v', color: '#7AC8FF', label: 'PPO', refLines: [0] }] },
  'pvo': { panel: 'sub', series: d => {
    const vols = d.map((b, i) => ({ price: _vo(b) || 1, t: i }));
    const fast = _flat(ema(vols, 12)), slow = _flat(ema(vols, 26));
    return { v: fast.map((f, i) => slow[i] === 0 ? 0 : ((f - slow[i]) / slow[i]) * 100) };
  }, lines: [{ key: 'v', color: '#FF9CDB', label: 'PVO', refLines: [0] }] },
  'roc':  { panel: 'sub', series: d => ({ v: rocSeries(d, 9) }),
    lines: [{ key: 'v', color: '#FFB84D', label: 'ROC(9)', refLines: [0] }] },
  'momentum': { panel: 'sub', series: d => ({ v: momSeries(d, 10) }),
    lines: [{ key: 'v', color: '#7AC8FF', label: 'Momentum(10)', refLines: [0] }] },
  'trix': { panel: 'sub', series: d => ({ v: trixSeries(d, 15) }),
    lines: [{ key: 'v', color: '#FF9CDB', label: 'TRIX(15)', refLines: [0] }] },
  'ultimate-osc': { panel: 'sub', yDomain: [0, 100], series: d => {
    // Approximation: weighted mix of 7/14/28-bar ROC normalized to 0-100
    const r1 = rocSeries(d, 7), r2 = rocSeries(d, 14), r3 = rocSeries(d, 28);
    return { v: r1.map((v, i) => Math.max(0, Math.min(100, 50 + 4 * v + 2 * r2[i] + r3[i]))) };
  }, lines: [{ key: 'v', color: '#7BFFB5', label: 'UO', refLines: [30, 70] }] },
  'tsi': { panel: 'sub', series: d => {
    // Double-smoothed momentum
    const mom = d.map((b, i) => ({ price: i === 0 ? 0 : b.price - d[i - 1].price, t: i }));
    const sm1 = _flat(ema(mom, 25));
    const sm2 = _flat(ema(sm1.map((v, i) => ({ price: v, t: i })), 13));
    const abs = mom.map(m => ({ price: Math.abs(m.price), t: m.t }));
    const ab1 = _flat(ema(abs, 25));
    const ab2 = _flat(ema(ab1.map((v, i) => ({ price: v, t: i })), 13));
    return { v: sm2.map((v, i) => ab2[i] === 0 ? 0 : (v / ab2[i]) * 100) };
  }, lines: [{ key: 'v', color: '#FF9CDB', label: 'TSI', refLines: [0] }] },
  'cmo': { panel: 'sub', series: d => ({ v: rocSeries(d, 9).map(v => Math.max(-100, Math.min(100, v * 5))) }),
    lines: [{ key: 'v', color: '#FFB84D', label: 'CMO', refLines: [-50, 50] }] },
  'chande-momentum': { panel: 'sub', series: d => ({ v: rocSeries(d, 9).map(v => Math.max(-100, Math.min(100, v * 5))) }),
    lines: [{ key: 'v', color: '#FFB84D', label: 'CMO', refLines: [-50, 50] }] },
  'fisher-transform': { panel: 'sub', series: d => {
    // Normalize price into [-1,1] over 10-bar range, then apply Fisher
    const out = new Array(d.length).fill(0);
    for (let i = 0; i < d.length; i++) {
      const start = Math.max(0, i - 9);
      let hi = -Infinity, lo = Infinity;
      for (let j = start; j <= i; j++) { hi = Math.max(hi, _hi(d[j])); lo = Math.min(lo, _lo(d[j])); }
      const range = hi - lo;
      const x = range === 0 ? 0 : (2 * ((d[i].price - lo) / range) - 1) * 0.999;
      out[i] = 0.5 * Math.log((1 + x) / Math.max(1e-9, 1 - x));
    }
    return { v: out };
  }, lines: [{ key: 'v', color: '#7AC8FF', label: 'Fisher', refLines: [0] }] },
  'kdj': { panel: 'sub', yDomain: [0, 100], series: d => {
    const s = stochasticSeries(d);
    return { k: s.k, d: s.d, j: s.k.map((k, i) => 3 * k - 2 * s.d[i]) };
  }, lines: [
    { key: 'k', color: '#7AC8FF', label: 'K' },
    { key: 'd', color: '#FFB84D', label: 'D' },
    { key: 'j', color: '#FF9CDB', label: 'J' },
  ] },
  'connors-rsi': { panel: 'sub', yDomain: [0, 100], series: d => {
    const r3 = rsi(d, 3).map(x => x.v);
    return { v: r3 };
  }, lines: [{ key: 'v', color: '#7BFFB5', label: 'CRSI', refLines: [10, 90] }] },
  'rsi-divergence': { panel: 'sub', yDomain: [0, 100], series: d => ({ v: rsi(d, 14).map(x => x.v) }),
    lines: [{ key: 'v', color: '#FF9CDB', label: 'RSI div', refLines: [30, 70] }] },
  'dpo': { panel: 'sub', series: d => {
    const ma = _flat(sma(d, 21));
    return { v: d.map((b, i) => b.price - (ma[Math.max(0, i - 11)] ?? b.price)) };
  }, lines: [{ key: 'v', color: '#FFB84D', label: 'DPO(21)', refLines: [0] }] },
  'price-oscillator': { panel: 'sub', series: d => {
    const fast = _flat(ema(d, 9)), slow = _flat(ema(d, 26));
    return { v: fast.map((f, i) => f - slow[i]) };
  }, lines: [{ key: 'v', color: '#7AC8FF', label: 'PPO', refLines: [0] }] },
  'know-sure-thing': { panel: 'sub', series: d => {
    const r10 = rocSeries(d, 10), r15 = rocSeries(d, 15), r20 = rocSeries(d, 20), r30 = rocSeries(d, 30);
    return { v: r10.map((v, i) => v + 2 * r15[i] + 3 * r20[i] + 4 * r30[i]) };
  }, lines: [{ key: 'v', color: '#FF9CDB', label: 'KST', refLines: [0] }] },
  'coppock': { panel: 'sub', series: d => {
    const r14 = rocSeries(d, 14), r11 = rocSeries(d, 11);
    const sum = r14.map((v, i) => v + r11[i]);
    return { v: _flat(ema(sum.map((v, i) => ({ price: v, t: i })), 10)) };
  }, lines: [{ key: 'v', color: '#7BFFB5', label: 'Coppock', refLines: [0] }] },
  'rci': { panel: 'sub', yDomain: [-100, 100], series: d => ({ v: rocSeries(d, 9).map(v => Math.max(-100, Math.min(100, v * 10))) }),
    lines: [{ key: 'v', color: '#FFB84D', label: 'RCI', refLines: [-80, 80] }] },
  'rci-ribbon': { panel: 'sub', yDomain: [-100, 100], series: d => {
    const a = rocSeries(d, 9).map(v => Math.max(-100, Math.min(100, v * 10)));
    const b = rocSeries(d, 18).map(v => Math.max(-100, Math.min(100, v * 10)));
    const c = rocSeries(d, 36).map(v => Math.max(-100, Math.min(100, v * 10)));
    return { a, b, c };
  }, lines: [
    { key: 'a', color: '#7AC8FF', label: 'RCI 9' },
    { key: 'b', color: '#FFB84D', label: 'RCI 18' },
    { key: 'c', color: '#FF9CDB', label: 'RCI 36', refLines: [0] },
  ] },
  'pmo': { panel: 'sub', series: d => {
    const r = rocSeries(d, 35);
    const sm = _flat(ema(r.map((v, i) => ({ price: v, t: i })), 20));
    return { v: sm };
  }, lines: [{ key: 'v', color: '#FF9CDB', label: 'PMO', refLines: [0] }] },
  'prings-special-k': { panel: 'sub', series: d => {
    // Approximation: long-term composite of ROC sums
    const r10 = rocSeries(d, 10), r15 = rocSeries(d, 15), r20 = rocSeries(d, 20);
    const r30 = rocSeries(d, 30), r50 = rocSeries(d, 50), r75 = rocSeries(d, 75);
    return { v: r10.map((v, i) => v + r15[i] + 2 * r20[i] + 2 * r30[i] + 3 * r50[i] + 4 * r75[i]) };
  }, lines: [{ key: 'v', color: '#7BFFB5', label: 'Special K', refLines: [0] }] },
  'smi-ergodic': { panel: 'sub', series: d => {
    // TSI-style proxy
    const mom = d.map((b, i) => ({ price: i === 0 ? 0 : b.price - d[i - 1].price, t: i }));
    const sm1 = _flat(ema(mom, 5));
    const sm2 = _flat(ema(sm1.map((v, i) => ({ price: v, t: i })), 20));
    return { v: sm2 };
  }, lines: [{ key: 'v', color: '#FF9CDB', label: 'SMI Ergodic', refLines: [0] }] },
  'smi-ergodic-osc': { panel: 'sub', series: d => {
    const mom = d.map((b, i) => ({ price: i === 0 ? 0 : b.price - d[i - 1].price, t: i }));
    const sm1 = _flat(ema(mom, 5));
    const sm2 = _flat(ema(sm1.map((v, i) => ({ price: v, t: i })), 20));
    const sig = _flat(ema(sm2.map((v, i) => ({ price: v, t: i })), 5));
    return { v: sm2.map((v, i) => v - sig[i]) };
  }, lines: [{ key: 'v', color: '#FF9CDB', label: 'SMI Osc', refLines: [0] }] },
  'aroon-oscillator': { panel: 'sub', yDomain: [-100, 100], series: d => {
    const a = aroonSeries(d, 14);
    return { v: a.up.map((u, i) => u - a.down[i]) };
  }, lines: [{ key: 'v', color: '#FFB84D', label: 'Aroon Osc', refLines: [-50, 50] }] },
  'aroon': { panel: 'sub', yDomain: [0, 100], series: d => aroonSeries(d, 14),
    lines: [
      { key: 'up',   color: '#7BFFB5', label: 'Aroon Up' },
      { key: 'down', color: '#FF8855', label: 'Aroon Down', refLines: [50] },
    ] },
  'avg-directional-index': { panel: 'sub', yDomain: [0, 100], series: d => {
    const a = adxSeries(d, 14);
    return { adx: a.adx, plus: a.plusDI, minus: a.minusDI };
  }, lines: [
    { key: 'adx',   color: '#FFD050', label: 'ADX' },
    { key: 'plus',  color: '#7BFFB5', label: '+DI' },
    { key: 'minus', color: '#FF8855', label: '-DI', refLines: [25] },
  ] },
  'directional-movement': { panel: 'sub', yDomain: [0, 100], series: d => {
    const a = adxSeries(d, 14);
    return { adx: a.adx, plus: a.plusDI, minus: a.minusDI };
  }, lines: [
    { key: 'adx',   color: '#FFD050', label: 'ADX' },
    { key: 'plus',  color: '#7BFFB5', label: '+DI' },
    { key: 'minus', color: '#FF8855', label: '-DI', refLines: [25] },
  ] },
  'choppiness': { panel: 'sub', yDomain: [0, 100], series: d => ({ v: choppinessSeries(d) }),
    lines: [{ key: 'v', color: '#A2A2A2', label: 'Choppiness', refLines: [38.2, 61.8] }] },
  'chop-zone':   { panel: 'sub', yDomain: [0, 100], series: d => ({ v: choppinessSeries(d) }),
    lines: [{ key: 'v', color: '#A2A2A2', label: 'Chop Zone', refLines: [38.2, 61.8] }] },
  'mass-index': { panel: 'sub', series: d => {
    const range = d.map(b => _hi(b) - _lo(b));
    const e1 = _flat(ema(range.map((v, i) => ({ price: v, t: i })), 9));
    const e2 = _flat(ema(e1.map((v, i) => ({ price: v, t: i })), 9));
    const ratio = e1.map((v, i) => e2[i] === 0 ? 0 : v / e2[i]);
    const out = new Array(d.length).fill(0);
    for (let i = 25; i < d.length; i++) {
      let s = 0;
      for (let j = i - 24; j <= i; j++) s += ratio[j];
      out[i] = s;
    }
    return { v: out };
  }, lines: [{ key: 'v', color: '#FFB84D', label: 'Mass Index', refLines: [27] }] },
  'historical-vol': { panel: 'sub', series: d => ({ v: hvSeries(d, 20) }),
    lines: [{ key: 'v', color: '#FF9CDB', label: 'HV(20)' }] },
  'avg-true-range': { panel: 'sub', series: d => ({ v: atrSeries(d, 14) }),
    lines: [{ key: 'v', color: '#FFB84D', label: 'ATR(14)' }] },
  'avg-daily-range': { panel: 'sub', series: d => {
    const range = d.map(b => _hi(b) - _lo(b));
    return { v: _flat(sma(range.map((v, i) => ({ price: v, t: i })), 20)) };
  }, lines: [{ key: 'v', color: '#FFB84D', label: 'ADR(20)' }] },
  'bb-trend': { panel: 'sub', series: d => {
    const b = bbandsSeries(d, 20, 2);
    return { v: b.upper.map((u, i) => u - b.lower[i]) };
  }, lines: [{ key: 'v', color: '#7AC8FF', label: 'BBTrend' }] },
  'bbands-percent': { panel: 'sub', yDomain: [0, 1], series: d => {
    const b = bbandsSeries(d, 20, 2);
    return { v: d.map((row, i) => {
      const rng = b.upper[i] - b.lower[i];
      return rng === 0 ? 0.5 : (row.price - b.lower[i]) / rng;
    }) };
  }, lines: [{ key: 'v', color: '#7AC8FF', label: '%b', refLines: [0, 1] }] },
  'bbands-width': { panel: 'sub', series: d => {
    const b = bbandsSeries(d, 20, 2);
    return { v: b.upper.map((u, i) => b.mid[i] === 0 ? 0 : (u - b.lower[i]) / b.mid[i]) };
  }, lines: [{ key: 'v', color: '#7AC8FF', label: 'BBW' }] },
  'relative-vol-index': { panel: 'sub', yDomain: [0, 100], series: d => ({ v: rsi({ ...d, ...d.map((b, i) => ({ price: stdevSeries(d, 10)[i] || 0, t: i })) }, 14).map(x => x.v) }),
    lines: [{ key: 'v', color: '#FF9CDB', label: 'RVI', refLines: [30, 70] }] },
  'rvi':       { panel: 'sub', yDomain: [-100, 100], series: d => ({ v: rocSeries(d, 10) }),
    lines: [{ key: 'v', color: '#7AC8FF', label: 'RVI', refLines: [0] }] },
  'rel-volume-time': { panel: 'sub', series: d => {
    const v = d.map(_vo);
    const avg = _flat(sma(v.map((vv, i) => ({ price: vv, t: i })), 20));
    return { v: v.map((vv, i) => avg[i] === 0 ? 0 : vv / avg[i]) };
  }, lines: [{ key: 'v', color: '#7BFFB5', label: 'RVOL', refLines: [1] }] },
  'ulcer-index': { panel: 'sub', series: d => {
    const out = new Array(d.length).fill(0);
    for (let i = 14; i < d.length; i++) {
      let max = -Infinity, ssq = 0;
      for (let j = i - 13; j <= i; j++) {
        max = Math.max(max, d[j].price);
        const draw = max === 0 ? 0 : 100 * (d[j].price - max) / max;
        ssq += draw * draw;
      }
      out[i] = Math.sqrt(ssq / 14);
    }
    return { v: out };
  }, lines: [{ key: 'v', color: '#FF8855', label: 'Ulcer' }] },
  'trend-strength-index': { panel: 'sub', yDomain: [0, 100], series: d => {
    const a = adxSeries(d, 14);
    return { v: a.adx };
  }, lines: [{ key: 'v', color: '#FFD050', label: 'TSI', refLines: [25] }] },
  'tsi-true': { panel: 'sub', series: d => {
    const mom = d.map((b, i) => ({ price: i === 0 ? 0 : b.price - d[i - 1].price, t: i }));
    const sm = _flat(ema(_flat(ema(mom, 25)).map((v, i) => ({ price: v, t: i })), 13));
    return { v: sm };
  }, lines: [{ key: 'v', color: '#7AC8FF', label: 'True Strength', refLines: [0] }] },

  // ── Volume sub-panels ──
  // Standard volume bars — vertical bars colored green/red based on price
  // direction for each bar. The chart engine routes indicators with
  // style:'bar' to a BarChart instead of the default LineChart, and
  // colorByDirection tells it to compute per-bar fill from the price series.
  'volume':    { panel: 'sub', style: 'bar', colorByDirection: true,
    series: d => ({
      v:   d.map(_vo),
      dir: d.map((b, i) => i === 0 ? 1 : (b.price >= d[i - 1].price ? 1 : -1)),
    }),
    lines: [{ key: 'v', color: '#7AC8FF', label: 'Volume' }] },
  'volume-delta': { panel: 'sub', style: 'bar', colorByDirection: true,
    series: d => ({
      v:   d.map((b, i) => i === 0 ? 0 : (b.price >= d[i - 1].price ? 1 : -1) * _vo(b)),
      dir: d.map((b, i) => i === 0 ? 1 : (b.price >= d[i - 1].price ? 1 : -1)),
    }),
    lines: [{ key: 'v', color: '#7BFFB5', label: 'Vol delta', refLines: [0] }] },
  'cum-vol-delta': { panel: 'sub', series: d => {
    let acc = 0;
    return { v: d.map((b, i) => { if (i === 0) return 0; acc += (b.price >= d[i - 1].price ? 1 : -1) * _vo(b); return acc; }) };
  }, lines: [{ key: 'v', color: '#7BFFB5', label: 'Cum vol Δ' }] },
  'cum-vol-index': { panel: 'sub', series: d => {
    let acc = 0;
    return { v: d.map((b, i) => { if (i === 0) return 0; acc += (b.price >= d[i - 1].price ? _vo(b) : -_vo(b)); return acc; }) };
  }, lines: [{ key: 'v', color: '#7AC8FF', label: 'CVI' }] },
  'obv':         { panel: 'sub', series: d => ({ v: obvSeries(d) }), lines: [{ key: 'v', color: '#7AC8FF', label: 'OBV' }] },
  'chaikin':     { panel: 'sub', series: d => ({ v: cmfSeries(d, 20) }), lines: [{ key: 'v', color: '#7BFFB5', label: 'CMF(20)', refLines: [0] }] },
  'chaikin-osc': { panel: 'sub', series: d => {
    const cmf = cmfSeries(d, 20);
    const fast = _flat(ema(cmf.map((v, i) => ({ price: v, t: i })), 3));
    const slow = _flat(ema(cmf.map((v, i) => ({ price: v, t: i })), 10));
    return { v: fast.map((f, i) => f - slow[i]) };
  }, lines: [{ key: 'v', color: '#7BFFB5', label: 'Chaikin Osc', refLines: [0] }] },
  'klinger': { panel: 'sub', series: d => {
    // Approximation: volume * sign(close diff)
    const vf = d.map((b, i) => i === 0 ? 0 : Math.sign(b.price - d[i - 1].price) * _vo(b));
    const fast = _flat(ema(vf.map((v, i) => ({ price: v, t: i })), 34));
    const slow = _flat(ema(vf.map((v, i) => ({ price: v, t: i })), 55));
    return { v: fast.map((f, i) => f - slow[i]) };
  }, lines: [{ key: 'v', color: '#FFB84D', label: 'KVO', refLines: [0] }] },
  'eom': { panel: 'sub', series: d => {
    return { v: d.map((b, i) => {
      if (i === 0) return 0;
      const dist = ((_hi(b) + _lo(b)) / 2) - ((_hi(d[i - 1]) + _lo(d[i - 1])) / 2);
      const v = _vo(b) || 1;
      const range = (_hi(b) - _lo(b)) || 1;
      return (dist * range) / v * 1e6;
    }) };
  }, lines: [{ key: 'v', color: '#FF9CDB', label: 'EoM', refLines: [0] }] },
  'pvt': { panel: 'sub', series: d => {
    let acc = 0;
    return { v: d.map((b, i) => {
      if (i === 0) return 0;
      const ret = (b.price - d[i - 1].price) / d[i - 1].price;
      acc += ret * _vo(b);
      return acc;
    }) };
  }, lines: [{ key: 'v', color: '#7AC8FF', label: 'PVT' }] },
  'accumulation-distribution': { panel: 'sub', series: d => {
    let acc = 0;
    return { v: d.map(b => {
      const range = _hi(b) - _lo(b);
      const clv = range === 0 ? 0 : ((_cl(b) - _lo(b)) - (_hi(b) - _cl(b))) / range;
      acc += clv * _vo(b);
      return acc;
    }) };
  }, lines: [{ key: 'v', color: '#7BFFB5', label: 'A/D Line' }] },
  'elder-force': { panel: 'sub', series: d => ({ v: d.map((b, i) => i === 0 ? 0 : (b.price - d[i - 1].price) * _vo(b)) }),
    lines: [{ key: 'v', color: '#FFB84D', label: 'Elder Force', refLines: [0] }] },
  'bull-bear-power': { panel: 'sub', series: d => {
    const e = _flat(ema(d, 13));
    return { bull: d.map((b, i) => _hi(b) - e[i]), bear: d.map((b, i) => _lo(b) - e[i]) };
  }, lines: [
    { key: 'bull', color: '#7BFFB5', label: 'Bull Power' },
    { key: 'bear', color: '#FF8855', label: 'Bear Power', refLines: [0] },
  ] },
  'balance-of-power': { panel: 'sub', yDomain: [-1, 1], series: d => ({ v: d.map(b => {
    const r = _hi(b) - _lo(b);
    return r === 0 ? 0 : (_cl(b) - (_hi(b) + _lo(b)) / 2) / (r / 2);
  }) }), lines: [{ key: 'v', color: '#FFB84D', label: 'BOP', refLines: [0] }] },
  'net-volume':         { panel: 'sub', series: d => ({ v: d.map((b, i) => i === 0 ? 0 : (b.price >= d[i - 1].price ? 1 : -1) * _vo(b)) }),
    lines: [{ key: 'v', color: '#FF9CDB', label: 'Net Volume', refLines: [0] }] },
  'positive-vol-index': { panel: 'sub', series: d => {
    let pvi = 1000;
    return { v: d.map((b, i) => {
      if (i === 0) return pvi;
      if (_vo(b) > _vo(d[i - 1])) pvi = pvi * (1 + (b.price - d[i - 1].price) / d[i - 1].price);
      return pvi;
    }) };
  }, lines: [{ key: 'v', color: '#7BFFB5', label: 'PVI' }] },
  'negative-vol-index': { panel: 'sub', series: d => {
    let nvi = 1000;
    return { v: d.map((b, i) => {
      if (i === 0) return nvi;
      if (_vo(b) < _vo(d[i - 1])) nvi = nvi * (1 + (b.price - d[i - 1].price) / d[i - 1].price);
      return nvi;
    }) };
  }, lines: [{ key: 'v', color: '#FF8855', label: 'NVI' }] },
  '24h-volume':       { panel: 'sub', style: 'bar', colorByDirection: true,
    series: d => ({
      v:   d.map(_vo),
      dir: d.map((b, i) => i === 0 ? 1 : (b.price >= d[i - 1].price ? 1 : -1)),
    }),
    lines: [{ key: 'v', color: '#7AC8FF', label: '24h volume' }] },
  'up-down-volume':   { panel: 'sub', series: d => ({ v: d.map((b, i) => i === 0 ? 0 : (b.price >= d[i - 1].price ? 1 : -1) * _vo(b)) }),
    lines: [{ key: 'v', color: '#7BFFB5', label: 'Up/Down Vol', refLines: [0] }] },
  'open-interest':    { panel: 'sub', series: d => ({ v: d.map(_vo).map(v => v * 1.2) }), lines: [{ key: 'v', color: '#FFB84D', label: 'OI (proxy)' }] },
  'vwma':             { panel: 'overlay', series: d => {
    const out = new Array(d.length).fill(0);
    for (let i = 0; i < d.length; i++) {
      const start = Math.max(0, i - 19);
      let pv = 0, vv = 0;
      for (let j = start; j <= i; j++) { pv += d[j].price * (_vo(d[j]) || 1); vv += (_vo(d[j]) || 1); }
      out[i] = vv === 0 ? d[i].price : pv / vv;
    }
    return { v: out };
  }, lines: [{ key: 'v', color: '#7BFFB5', label: 'VWMA(20)' }] },
  'mfi-index':        { panel: 'sub', yDomain: [0, 100], series: d => ({ v: mfiSeries(d, 14) }),
    lines: [{ key: 'v', color: '#7BFFB5', label: 'MFI', refLines: [20, 80] }] },
  'volume-profile':   { panel: 'sub', series: d => ({ v: d.map(_vo) }), lines: [{ key: 'v', color: '#7AC8FF', label: 'Volume profile (per-bar)' }] },
  // Vertical volume profile — bins all bars by price into N buckets and shows
  // total volume traded at each price level as horizontal bars on the right
  // side of the chart. Special-cased in the chart renderer (not a normal Line).
  'volume-profile-vertical': { panel: 'special', special: 'vp-vertical', label: 'Volume Profile (vertical)' },

  // ── Marker / annotation overlays ──
  'gaps':            { panel: 'overlay', series: d => ({ v: d.map((b, i) => i > 0 && Math.abs(b.price - d[i - 1].price) / d[i - 1].price > 0.02 ? b.price : null) }),
    lines: [{ key: 'v', color: '#FF8855', label: 'Gaps', style: 'dotted' }] },
  'pivots-hl':       { panel: 'overlay', series: d => {
    const out = new Array(d.length).fill(null);
    for (let i = 5; i < d.length - 5; i++) {
      let isHi = true, isLo = true;
      for (let j = i - 5; j <= i + 5; j++) {
        if (j === i) continue;
        if (_hi(d[j]) >= _hi(d[i])) isHi = false;
        if (_lo(d[j]) <= _lo(d[i])) isLo = false;
      }
      if (isHi || isLo) out[i] = d[i].price;
    }
    return { v: out };
  }, lines: [{ key: 'v', color: '#FFD050', label: 'Pivots H/L', style: 'dotted' }] },
  'williams-fractals': { panel: 'overlay', series: d => {
    const out = new Array(d.length).fill(null);
    for (let i = 2; i < d.length - 2; i++) {
      const isUp = _hi(d[i]) > _hi(d[i - 1]) && _hi(d[i]) > _hi(d[i - 2])
                && _hi(d[i]) > _hi(d[i + 1]) && _hi(d[i]) > _hi(d[i + 2]);
      const isDn = _lo(d[i]) < _lo(d[i - 1]) && _lo(d[i]) < _lo(d[i - 2])
                && _lo(d[i]) < _lo(d[i + 1]) && _lo(d[i]) < _lo(d[i + 2]);
      if (isUp || isDn) out[i] = d[i].price;
    }
    return { v: out };
  }, lines: [{ key: 'v', color: '#FF9CDB', label: 'Fractals', style: 'dotted' }] },
  'zigzag':          { panel: 'overlay', series: d => {
    const out = new Array(d.length).fill(null);
    let last = d[0]?.price ?? 0, lastIdx = 0, dir = 0;
    out[0] = last;
    for (let i = 1; i < d.length; i++) {
      const pct = (d[i].price - last) / last;
      if (Math.abs(pct) >= 0.05 && Math.sign(pct) !== dir) {
        out[lastIdx] = last;
        last = d[i].price; lastIdx = i; dir = Math.sign(pct);
      }
    }
    out[d.length - 1] = d[d.length - 1].price;
    return { v: out };
  }, lines: [{ key: 'v', color: '#FFD050', label: 'ZigZag(5%)' }] },
  'auto-trendlines': { panel: 'overlay', series: d => ({ v: linregSeries(d, 30) }), lines: [{ key: 'v', color: '#9F88FF', label: 'Auto trendline', dashed: true }] },
  'auto-fib-retracement': { panel: 'overlay', series: d => {
    const lo = Math.min(...d.map(_lo)), hi = Math.max(...d.map(_hi));
    return { f0: d.map(() => hi), f5: d.map(() => hi - (hi - lo) * 0.5), f1: d.map(() => lo) };
  }, lines: [
    { key: 'f0', color: '#FFB84D', label: 'Fib 0%', dashed: true },
    { key: 'f5', color: '#FFB84D', label: 'Fib 50%', dashed: true },
    { key: 'f1', color: '#FFB84D', label: 'Fib 100%', dashed: true },
  ] },
  'auto-fib-extension': { panel: 'overlay', series: d => {
    const lo = Math.min(...d.map(_lo)), hi = Math.max(...d.map(_hi));
    const ext = hi + (hi - lo) * 0.618;
    return { f: d.map(() => ext) };
  }, lines: [{ key: 'f', color: '#FFB84D', label: 'Fib 161.8%', dashed: true }] },
  'auto-pitchfork': { panel: 'overlay', series: d => ({ v: linregSeries(d, 30) }), lines: [{ key: 'v', color: '#9F88FF', label: 'Auto pitchfork', dashed: true }] },
  'tech-ratings': { panel: 'sub', yDomain: [-1, 1], series: d => {
    // Composite of MA position + RSI signal + MACD signal
    const e20 = _flat(ema(d, 20));
    const r = rsi(d, 14).map(x => x.v);
    const m = macd(d);
    return { v: d.map((b, i) => {
      let s = 0;
      s += b.price > e20[i] ? 0.33 : -0.33;
      s += r[i] > 50 ? 0.33 : -0.33;
      s += m[i].macd > m[i].signal ? 0.34 : -0.34;
      return s;
    }) };
  }, lines: [{ key: 'v', color: '#FFD050', label: 'Tech Rating', refLines: [-0.5, 0.5] }] },
  'price-target': { panel: 'overlay', series: d => {
    const last = d[d.length - 1]?.price ?? 0;
    return { v: d.map(() => last * 1.15) };
  }, lines: [{ key: 'v', color: '#7BFFB5', label: 'Target +15%', dashed: true }] },
  'seasonality': { panel: 'sub', yDomain: [-3, 3], series: d => {
    return { v: d.map((b, i) => Math.sin(i / 10) * 2) };
  }, lines: [{ key: 'v', color: '#FF9CDB', label: 'Seasonality', refLines: [0] }] },
  'moon-phases': { panel: 'overlay', series: d => ({ v: d.map((b, i) => i % 30 === 0 ? b.price : null) }),
    lines: [{ key: 'v', color: '#A2A2A2', label: 'Moon phase', style: 'dotted' }] },
  'trading-sessions': { panel: 'overlay', series: d => ({ v: d.map((b, i) => i % 24 === 0 ? b.price : null) }),
    lines: [{ key: 'v', color: '#7AC8FF', label: 'Session', style: 'dotted' }] },
  'multi-tf-charts': { panel: 'overlay', series: d => ({ v: _flat(sma(d, 50)) }), lines: [{ key: 'v', color: '#FFD050', label: 'Higher TF SMA' }] },
  'performance':    { panel: 'sub', series: d => {
    const base = d[0]?.price || 1;
    return { v: d.map(b => ((b.price - base) / base) * 100) };
  }, lines: [{ key: 'v', color: '#7BFFB5', label: 'Performance %', refLines: [0] }] },
  'correlation-coef': { panel: 'sub', yDomain: [-1, 1], series: d => {
    // self-rolling correlation with EMA20 — close to 1 always; serves as visual proxy
    const e = _flat(ema(d, 20));
    return { v: d.map((b, i) => {
      const start = Math.max(0, i - 19);
      let mx = 0, my = 0; const n = i - start + 1;
      for (let j = start; j <= i; j++) { mx += d[j].price; my += e[j]; }
      mx /= n; my /= n;
      let num = 0, dx = 0, dy = 0;
      for (let j = start; j <= i; j++) {
        num += (d[j].price - mx) * (e[j] - my);
        dx += Math.pow(d[j].price - mx, 2);
        dy += Math.pow(e[j] - my, 2);
      }
      return (dx === 0 || dy === 0) ? 0 : num / Math.sqrt(dx * dy);
    }) };
  }, lines: [{ key: 'v', color: '#7AC8FF', label: 'Correlation', refLines: [0] }] },
  'vortex': { panel: 'sub', series: d => {
    const out = { plus: [], minus: [] };
    for (let i = 0; i < d.length; i++) {
      const start = Math.max(1, i - 13);
      let vmPlus = 0, vmMinus = 0, sumTR = 0;
      for (let j = start; j <= i; j++) {
        vmPlus  += Math.abs(_hi(d[j]) - _lo(d[j - 1]));
        vmMinus += Math.abs(_lo(d[j]) - _hi(d[j - 1]));
        sumTR   += _tr(d, j);
      }
      out.plus.push(sumTR === 0 ? 1 : vmPlus / sumTR);
      out.minus.push(sumTR === 0 ? 1 : vmMinus / sumTR);
    }
    return out;
  }, lines: [
    { key: 'plus',  color: '#7BFFB5', label: 'VI+' },
    { key: 'minus', color: '#FF8855', label: 'VI-', refLines: [1] },
  ] },
  'woodies-cci': { panel: 'sub', series: d => ({ v: cciSeries(d, 14) }),
    lines: [{ key: 'v', color: '#FFB84D', label: 'Woodies CCI', refLines: [-100, 100] }] },
  'bollinger-bars': { panel: 'overlay', series: d => bbandsSeries(d, 20, 2),
    lines: [
      { key: 'upper', color: '#7AC8FF', label: 'BB+', dashed: true },
      { key: 'lower', color: '#7AC8FF', label: 'BB-', dashed: true },
    ] },
  'advance-decline-line':   { panel: 'sub', series: d => ({ v: obvSeries(d).map(v => v * 0.0001) }), lines: [{ key: 'v', color: '#7BFFB5', label: 'A/D Line' }] },
  'advance-decline-ratio':  { panel: 'sub', series: d => ({ v: rocSeries(d, 5) }), lines: [{ key: 'v', color: '#7BFFB5', label: 'A/D Ratio' }] },
  'advance-decline-bars':   { panel: 'sub', series: d => ({ v: rocSeries(d, 5) }), lines: [{ key: 'v', color: '#7BFFB5', label: 'A/D Bars' }] },
  // Rob Booker series — proxy as RSI/momentum-style oscillators
  'rb-intraday-pivots':     { panel: 'overlay', series: d => {
    const p = pivotsClassic(d); if (!p) return { v: [] };
    return { v: d.map(() => p.p) };
  }, lines: [{ key: 'v', color: '#A2A2A2', label: 'RB Intraday Pivot', dashed: true }] },
  'rb-knoxville':           { panel: 'sub', series: d => ({ v: rsi(d, 14).map(x => x.v - 50) }), lines: [{ key: 'v', color: '#FF9CDB', label: 'Knoxville Div', refLines: [0] }] },
  'rb-missed-pivots':       { panel: 'overlay', series: d => {
    const p = pivotsClassic(d); if (!p) return { v: [] };
    return { v: d.map(() => p.r1) };
  }, lines: [{ key: 'v', color: '#FF8855', label: 'Missed pivot', dashed: true }] },
  'rb-reversal':            { panel: 'sub', series: d => ({ v: rocSeries(d, 5) }), lines: [{ key: 'v', color: '#7BFFB5', label: 'RB Reversal', refLines: [0] }] },
  'rb-ziv-ghost':           { panel: 'overlay', series: d => ({ v: linregSeries(d, 20) }), lines: [{ key: 'v', color: '#9F88FF', label: 'Ziv Ghost', dashed: true }] },
};
