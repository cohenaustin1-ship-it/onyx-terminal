// IMO Onyx Terminal — Quant Lab page
//
// Phase 3p.25 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~91365-92017 + ~94397-98562, ~4,800 lines total
// after consolidating the workflow-builder fixtures, compile helpers,
// VolForecastMode, and QuantLabPage itself into a single module).
//
// The Quant Lab is the heaviest research surface in Onyx. Combines:
//   - Workflow graph editor (drag nodes, connect ports, compile to a
//     bar-by-bar strategy fn)
//   - Code-mode strategy editor (free-form JS with the QUANT_PRIMITIVES
//     + FACTOR_LIBRARY + bars/ctx in scope)
//   - Backtester (walk-forward over Polygon-fed history)
//   - Vol forecaster (GARCH(1,1) implementation)
//   - Workflow + strategy persistence in localStorage
//
// Public export:
//   QuantLabPage({ instrument, setActive })
//
// Internal companion:
//   VolForecastMode  — GARCH(1,1) volatility forecasting widget
//
// Internal helpers / fixtures (only used by QuantLabPage and
// VolForecastMode, all inlined from monolith):
//   QUANT_TEMPLATES         — starter strategies
//   CODE_HELP_REFERENCE     — collapsible cheat sheet
//   WORKFLOW_NODE_REGISTRY  — node type definitions for graph editor
//   compileWorkflow         — graph → executable strategy compiler
//   WORKFLOWS_KEY + loadWorkflows + saveWorkflows  — persistence
//   DEFAULT_WORKFLOW        — starter graph for new users
//
// Honest scope:
//   - Backtests are walk-forward bar-by-bar — not tick-accurate.
//     Slippage and commissions are approximated.
//   - GARCH(1,1) implementation uses MLE via gradient descent.
//     Convergence not guaranteed for pathological series.
//   - Workflow compiler does topological sort with cycle detection
//     but doesn't optimize past basic dead-node pruning.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
  CartesianGrid, ReferenceLine, BarChart, Bar, ComposedChart, Area,
  ReferenceArea,
} from 'recharts';
import {
  Bot, Download, FileCode, Play, Plus, RefreshCw, Star, Trash2, Wand2,
  Code as CodeIcon, Save as SaveIcon,
} from 'lucide-react';
import { COLORS } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import { fetchPolygonAggs } from '../lib/polygon-api.js';
import { callAI } from '../lib/ai-calls.js';
import { resolveActiveProvider } from '../lib/llm-providers.js';
import {
  runBacktest,
  QUANT_PRIMITIVES,
  FACTOR_LIBRARY,
  buildCompositeStrategy,
  runWalkForward,
  runMonteCarloPermutation,
  runCrossSectional,
  runPairTrade,
  runSeasonalStrategy,
  computeCorrelationMatrix,
  renderCorrelationHeatmapSVG,
} from '../lib/quant/backtest-engine.js';
import { blackScholesAdvanced } from '../lib/quant/options-payoff.js';
import { fitGARCH11, forecastGARCHVol } from '../lib/quant/risk-math.js';
import { compileCodeStrategy, stepDebugStrategy, renderOptionPayoffSVG, buildToyRLAgent } from '../lib/strategy-helpers.js';

// Env-var keys (duplicated from monolith — same source, separate read).
const MASSIVE_API_KEY  = (() => { try { return import.meta.env?.VITE_MASSIVE_API_KEY  ?? ''; } catch { return ''; } })();
const ANTHROPIC_API_KEY= (() => { try { return import.meta.env?.VITE_ANTHROPIC_API_KEY?? ''; } catch { return ''; } })();

// fmt (inlined per established pattern — used 100+ times monolith-wide).
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

// QUANT_TEMPLATES — starter strategies users can load.
// Inlined from monolith during 3p.25 — only QuantLabPage uses these.
const QUANT_TEMPLATES = [
  {
    id: 'rsi-mean-reversion',
    label: 'RSI mean reversion + Bollinger filter',
    description: 'Classic oversold-buy with band confirmation.',
    code: `// RSI mean reversion with Bollinger filter
//   Buy when RSI < 30 AND price near lower BB
//   Exit when RSI > 50 OR price near upper BB
const rsi = prim.rsi(bars, i, 14);
const bb  = prim.bb(bars, i, 20, 2);
if (rsi == null || !bb) return 'hold';

if (ctx.pos === 0 && rsi < 30 && bb.pctB < 0.2) {
  log('entering: rsi=' + rsi.toFixed(1) + ' pctB=' + bb.pctB.toFixed(2));
  return 'enter';
}
if (ctx.pos > 0 && (rsi > 50 || bb.pctB > 0.8)) return 'exit';
return 'hold';
`,
  },
  {
    id: 'macd-crossover',
    label: 'MACD crossover',
    description: 'Long when MACD line crosses above signal; exit on cross-under.',
    code: `// MACD crossover (12/26/9)
const m  = prim.macd(bars, i,     12, 26, 9);
const mP = prim.macd(bars, i - 1, 12, 26, 9);
if (!m || !mP) return 'hold';

const crossUp = mP.macd <= mP.signal && m.macd > m.signal;
const crossDn = mP.macd >= mP.signal && m.macd < m.signal;

if (ctx.pos === 0 && crossUp) return 'enter';
if (ctx.pos > 0  && crossDn) return 'exit';
return 'hold';
`,
  },
  {
    id: 'atr-breakout',
    label: 'ATR breakout (volatility-scaled)',
    description: '20-day high breakout with ATR-scaled stop-loss.',
    code: `// ATR breakout: enter on close above 20-day high
// Exit on a 2-ATR drawdown from peak since entry
const w = 20;
if (i < w) return 'hold';
let hi20 = -Infinity;
for (let k = i - w; k < i; k++) if (bars[k].close > hi20) hi20 = bars[k].close;
const atr = prim.atr(bars, i, 14);

if (ctx.pos === 0 && atr && bars[i].close > hi20) return 'enter';
if (ctx.pos > 0  && atr) {
  // Track peak since entry (uses ctx.entryPx as a fallback anchor)
  const peak = Math.max(ctx.entryPx, bars[i].close);
  if (bars[i].close < peak - 2 * atr) return 'exit';
}
return 'hold';
`,
  },
  {
    id: 'bollinger-squeeze',
    label: 'Bollinger squeeze breakout',
    description: 'Enter on expansion after low-volatility compression.',
    code: `// Bollinger squeeze: when band width compresses, expect expansion
const bb  = prim.bb(bars, i,     20, 2);
const bbP = prim.bb(bars, i - 5, 20, 2);
if (!bb || !bbP) return 'hold';

// Squeeze = current width less than 80% of width 5 bars ago
const isSqueeze = bb.width < bbP.width * 0.8;
const breakout  = bb.pctB > 0.85;   // close near upper band

if (ctx.pos === 0 && isSqueeze && breakout) return 'enter';
if (ctx.pos > 0  && bb.pctB < 0.5)            return 'exit';
return 'hold';
`,
  },
  {
    id: 'momentum-vol-filter',
    label: 'Momentum + low-vol filter',
    description: 'Trend follow only when realized vol is below historical average.',
    code: `// Trend-follow only in calm regimes
const mom20 = prim.mom(bars, i, 20);
const vol20 = prim.vol(bars, i, 20);
const vol60 = prim.vol(bars, i, 60);
if (mom20 == null || !vol20 || !vol60) return 'hold';

const lowVolRegime = vol20 < vol60 * 0.9;

if (ctx.pos === 0 && mom20 > 0.05 && lowVolRegime) return 'enter';
if (ctx.pos > 0  && mom20 < 0)                      return 'exit';
return 'hold';
`,
  },
  {
    id: 'stoch-oversold',
    label: 'Stochastic %K cross of %D',
    description: 'Buy when fast %K crosses above slow %D in oversold.',
    code: `// Stochastic oversold cross
const s  = prim.stoch(bars, i,     14, 3);
const sP = prim.stoch(bars, i - 1, 14, 3);
if (!s || !sP) return 'hold';

const crossUp   = sP.k <= sP.d && s.k > s.d;
const crossDn   = sP.k >= sP.d && s.k < s.d;
const oversold  = s.d < 25;

if (ctx.pos === 0 && crossUp && oversold) return 'enter';
if (ctx.pos > 0  && (crossDn || s.d > 80)) return 'exit';
return 'hold';
`,
  },
  {
    id: 'donchian-trend',
    label: 'Donchian trend (Turtle-style)',
    description: '20-day breakout entry, 10-day breakdown exit.',
    code: `// Donchian channel breakout — Turtle Traders style
const enterW = 20;
const exitW  = 10;
if (i < enterW) return 'hold';

let hiE = -Infinity, loX = Infinity;
for (let k = i - enterW; k < i; k++) if (bars[k].close > hiE) hiE = bars[k].close;
for (let k = i - exitW;  k < i; k++) if (bars[k].close < loX) loX = bars[k].close;

if (ctx.pos === 0 && bars[i].close > hiE) return 'enter';
if (ctx.pos > 0  && bars[i].close < loX)  return 'exit';
return 'hold';
`,
  },
  {
    id: 'pairs-cointegration-stub',
    label: 'Pair-trade hedge (stub)',
    description: 'Single-asset proxy: long when price deviates -2σ from 60-day mean.',
    code: `// Pair-trade-style mean reversion (single-asset proxy)
// Real pairs need 2 instruments; this is the same idea on one.
const w = 60;
if (i < w) return 'hold';

// Z-score of close vs w-bar mean/std
let sum = 0, sumSq = 0;
for (let k = i - w; k < i; k++) { sum += bars[k].close; sumSq += bars[k].close ** 2; }
const mean = sum / w;
const std  = Math.sqrt(sumSq / w - mean * mean);
if (!std) return 'hold';
const z = (bars[i].close - mean) / std;

if (ctx.pos === 0 && z < -2)  return 'enter';   // 2σ below mean
if (ctx.pos > 0  && z > -0.2) return 'exit';    // back near mean
return 'hold';
`,
  },
  {
    id: 'blank',
    label: 'Blank starter',
    description: 'Empty template with the API skeleton.',
    code: `// Custom strategy. Return 'enter' | 'exit' | 'hold' from each bar.
//
// Available variables:
//   bars  — OHLCV array, read-only
//   i     — current bar index
//   ctx   — { pos, entryPx, cash, capital }
//   prim  — primitive registry (sma, rsi, ema, macd, bb, atr,
//           stoch, roc, obv, mom, vol, volz, range, close)
//   util  — primitives + Math helpers + cross / crossUnder / clamp
//   log() — console.log proxy (max 200 entries per run)

return 'hold';
`,
  },
];

// CODE_HELP_REFERENCE — collapsible cheat sheet rendered in the help.
const CODE_HELP_REFERENCE = [
  {
    group: 'Position',
    entries: [
      { sig: 'ctx.pos',     desc: 'Current shares held (0 = flat)' },
      { sig: 'ctx.entryPx', desc: 'Entry price of current position (0 if flat)' },
      { sig: 'ctx.cash',    desc: 'Available cash' },
      { sig: 'ctx.capital', desc: 'Starting capital' },
    ],
  },
  {
    group: 'Bars',
    entries: [
      { sig: 'bars[i]',         desc: 'Current bar: { t, open, high, low, close, volume }' },
      { sig: 'bars[i-1]',       desc: 'Previous bar (use for crossover detection)' },
      { sig: 'bars.length',     desc: 'Total bars in the backtest' },
    ],
  },
  {
    group: 'Moving averages',
    entries: [
      { sig: 'prim.sma(bars, i, 20)',  desc: '20-bar simple moving average' },
      { sig: 'prim.ema(bars, i, 20)',  desc: '20-bar exponential moving average (cached)' },
    ],
  },
  {
    group: 'Oscillators',
    entries: [
      { sig: 'prim.rsi(bars, i, 14)',     desc: 'RSI 0-100; oversold < 30, overbought > 70' },
      { sig: 'prim.stoch(bars, i, 14, 3)',desc: '{ k, d } stochastic oscillator' },
      { sig: 'prim.macd(bars, i, 12, 26, 9)', desc: '{ macd, signal, hist } MACD' },
      { sig: 'prim.roc(bars, i, 12)',     desc: '12-bar rate of change %' },
    ],
  },
  {
    group: 'Volatility',
    entries: [
      { sig: 'prim.atr(bars, i, 14)',  desc: '14-bar Average True Range' },
      { sig: 'prim.vol(bars, i, 20)',  desc: 'Annualized realized vol over 20 bars' },
      { sig: 'prim.bb(bars, i, 20, 2)',desc: '{ upper, middle, lower, width, pctB } Bollinger bands' },
      { sig: 'prim.range(bars, i)',    desc: '(high - low) / close — intraday range' },
    ],
  },
  {
    group: 'Volume',
    entries: [
      { sig: 'prim.volz(bars, i, 20)', desc: 'Volume z-score (unusual-volume detector)' },
      { sig: 'prim.obv(bars, i)',      desc: 'On-balance volume (cumulative, cached)' },
    ],
  },
  {
    group: 'Returns',
    entries: [
      { sig: 'prim.mom(bars, i, 20)',  desc: '20-bar return as fraction (e.g. 0.05 = +5%)' },
    ],
  },
  {
    group: 'Helpers (util namespace)',
    entries: [
      { sig: 'util.cross(a, b, aPrev, bPrev)',      desc: 'true when a crosses above b' },
      { sig: 'util.crossUnder(a, b, aPrev, bPrev)', desc: 'true when a crosses below b' },
      { sig: 'util.clamp(x, lo, hi)',                desc: 'Bound x between lo and hi' },
      { sig: 'util.max, util.min, util.abs, util.sqrt, util.log, util.exp', desc: 'Math passthroughs' },
    ],
  },
  {
    group: 'Debug',
    entries: [
      { sig: "log('msg', value)",   desc: 'Emit a log entry shown below the editor (max 200 per run)' },
    ],
  },
];

// WORKFLOW_NODE_REGISTRY — node type definitions for the workflow graph.
const WORKFLOW_NODE_REGISTRY = {
  // Input nodes — read from bar data, no upstream inputs
  'input-close': {
    id: 'input-close', label: 'Close price',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'value', label: 'Close', type: 'number' }],
    params: [],
    evaluate: (_p, _i, ctx) => ({ value: ctx.bars[ctx.i]?.close ?? null }),
  },
  'input-volume': {
    id: 'input-volume', label: 'Volume',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'value', label: 'Vol', type: 'number' }],
    params: [],
    evaluate: (_p, _i, ctx) => ({ value: ctx.bars[ctx.i]?.volume ?? null }),
  },
  'input-sma': {
    id: 'input-sma', label: 'SMA',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'value', label: 'SMA', type: 'number' }],
    params: [{ id: 'window', label: 'Window', kind: 'number', default: 20, min: 2, max: 200 }],
    evaluate: (p, _i, ctx) => ({ value: QUANT_PRIMITIVES.sma(ctx.bars, ctx.i, p.window || 20) }),
  },
  'input-ema': {
    id: 'input-ema', label: 'EMA',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'value', label: 'EMA', type: 'number' }],
    params: [{ id: 'window', label: 'Window', kind: 'number', default: 20, min: 2, max: 200 }],
    evaluate: (p, _i, ctx) => ({ value: QUANT_PRIMITIVES.ema(ctx.bars, ctx.i, p.window || 20) }),
  },
  'input-rsi': {
    id: 'input-rsi', label: 'RSI',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'value', label: 'RSI', type: 'number' }],
    params: [{ id: 'window', label: 'Window', kind: 'number', default: 14, min: 2, max: 100 }],
    evaluate: (p, _i, ctx) => ({ value: QUANT_PRIMITIVES.rsi(ctx.bars, ctx.i, p.window || 14) }),
  },
  'input-bb': {
    id: 'input-bb', label: 'Bollinger %B',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'value', label: '%B', type: 'number' }],
    params: [
      { id: 'window', label: 'Window', kind: 'number', default: 20, min: 5, max: 100 },
      { id: 'k', label: 'StdDev', kind: 'number', default: 2, min: 0.5, max: 4, step: 0.1 },
    ],
    evaluate: (p, _i, ctx) => {
      const bb = QUANT_PRIMITIVES.bb(ctx.bars, ctx.i, p.window || 20, p.k || 2);
      return { value: bb?.pctB ?? null };
    },
  },
  'input-macd-hist': {
    id: 'input-macd-hist', label: 'MACD histogram',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'value', label: 'Hist', type: 'number' }],
    params: [],
    evaluate: (_p, _i, ctx) => {
      const m = QUANT_PRIMITIVES.macd(ctx.bars, ctx.i);
      return { value: m?.hist ?? null };
    },
  },
  'input-mom': {
    id: 'input-mom', label: 'Momentum',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'value', label: 'Mom', type: 'number' }],
    params: [{ id: 'window', label: 'Window', kind: 'number', default: 20, min: 2, max: 200 }],
    evaluate: (p, _i, ctx) => ({ value: QUANT_PRIMITIVES.mom(ctx.bars, ctx.i, p.window || 20) }),
  },
  'input-vol': {
    id: 'input-vol', label: 'Realized vol',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'value', label: 'Vol', type: 'number' }],
    params: [{ id: 'window', label: 'Window', kind: 'number', default: 20, min: 5, max: 100 }],
    evaluate: (p, _i, ctx) => ({ value: QUANT_PRIMITIVES.vol(ctx.bars, ctx.i, p.window || 20) }),
  },
  'input-constant': {
    id: 'input-constant', label: 'Constant',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'value', label: 'Value', type: 'number' }],
    params: [{ id: 'value', label: 'Value', kind: 'number', default: 0, step: 0.1 }],
    evaluate: (p) => ({ value: Number(p.value) }),
  },
  'input-position': {
    id: 'input-position', label: 'Have position?',
    category: 'input',
    inputs: [],
    outputs: [{ id: 'value', label: 'Yes/no', type: 'boolean' }],
    params: [],
    evaluate: (_p, _i, ctx) => ({ value: (ctx.pos || 0) > 0 }),
  },
  // Transform nodes — accept upstream values, produce derived ones
  'compare': {
    id: 'compare', label: 'Compare',
    category: 'transform',
    inputs: [
      { id: 'a', label: 'A', type: 'number' },
      { id: 'b', label: 'B', type: 'number' },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'boolean' }],
    params: [{
      id: 'op', label: 'Operator', kind: 'select', default: '>',
      options: [
        { value: '>',  label: 'A > B' },
        { value: '>=', label: 'A ≥ B' },
        { value: '<',  label: 'A < B' },
        { value: '<=', label: 'A ≤ B' },
        { value: '==', label: 'A ≈ B (within 1%)' },
      ],
    }],
    evaluate: (p, inputs) => {
      const a = inputs.a, b = inputs.b;
      if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) {
        return { result: false };
      }
      let r = false;
      if (p.op === '>')       r = a >  b;
      else if (p.op === '>=') r = a >= b;
      else if (p.op === '<')  r = a <  b;
      else if (p.op === '<=') r = a <= b;
      else if (p.op === '==') r = Math.abs(a - b) / (Math.abs(b) || 1) < 0.01;
      return { result: r };
    },
  },
  'threshold': {
    id: 'threshold', label: 'Threshold',
    category: 'transform',
    inputs: [{ id: 'value', label: 'Value', type: 'number' }],
    outputs: [
      { id: 'above', label: 'Above', type: 'boolean' },
      { id: 'below', label: 'Below', type: 'boolean' },
    ],
    params: [{ id: 'threshold', label: 'Threshold', kind: 'number', default: 50, step: 0.5 }],
    evaluate: (p, inputs) => {
      const v = inputs.value;
      if (v == null || !Number.isFinite(v)) return { above: false, below: false };
      return { above: v > p.threshold, below: v < p.threshold };
    },
  },
  'and': {
    id: 'and', label: 'AND',
    category: 'transform',
    inputs: [
      { id: 'a', label: 'A', type: 'boolean' },
      { id: 'b', label: 'B', type: 'boolean' },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'boolean' }],
    params: [],
    evaluate: (_p, inputs) => ({ result: !!inputs.a && !!inputs.b }),
  },
  'or': {
    id: 'or', label: 'OR',
    category: 'transform',
    inputs: [
      { id: 'a', label: 'A', type: 'boolean' },
      { id: 'b', label: 'B', type: 'boolean' },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'boolean' }],
    params: [],
    evaluate: (_p, inputs) => ({ result: !!inputs.a || !!inputs.b }),
  },
  'not': {
    id: 'not', label: 'NOT',
    category: 'transform',
    inputs: [{ id: 'a', label: 'A', type: 'boolean' }],
    outputs: [{ id: 'result', label: 'Result', type: 'boolean' }],
    params: [],
    evaluate: (_p, inputs) => ({ result: !inputs.a }),
  },
  'math': {
    id: 'math', label: 'Math',
    category: 'transform',
    inputs: [
      { id: 'a', label: 'A', type: 'number' },
      { id: 'b', label: 'B', type: 'number' },
    ],
    outputs: [{ id: 'result', label: 'Result', type: 'number' }],
    params: [{
      id: 'op', label: 'Operation', kind: 'select', default: '+',
      options: [
        { value: '+',     label: 'A + B' },
        { value: '-',     label: 'A − B' },
        { value: '*',     label: 'A × B' },
        { value: '/',     label: 'A ÷ B' },
        { value: 'min',   label: 'min(A, B)' },
        { value: 'max',   label: 'max(A, B)' },
      ],
    }],
    evaluate: (p, inputs) => {
      const a = Number(inputs.a), b = Number(inputs.b);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return { result: null };
      let r = null;
      if (p.op === '+') r = a + b;
      else if (p.op === '-') r = a - b;
      else if (p.op === '*') r = a * b;
      else if (p.op === '/') r = b !== 0 ? a / b : null;
      else if (p.op === 'min') r = Math.min(a, b);
      else if (p.op === 'max') r = Math.max(a, b);
      return { result: r };
    },
  },
  'cross': {
    id: 'cross', label: 'Crosses above',
    category: 'transform',
    inputs: [
      { id: 'a', label: 'A', type: 'number' },
      { id: 'b', label: 'B', type: 'number' },
    ],
    outputs: [{ id: 'result', label: 'Crossed', type: 'boolean' }],
    params: [],
    // Stateful: needs previous-bar values. Stored on ctx._nodeState
    // keyed by node id so each instance is independent.
    evaluate: (_p, inputs, ctx, nodeId) => {
      const state = ctx._nodeState[nodeId] ?? { aPrev: null, bPrev: null };
      const a = inputs.a, b = inputs.b;
      let crossed = false;
      if (state.aPrev != null && state.bPrev != null && a != null && b != null) {
        crossed = state.aPrev <= state.bPrev && a > b;
      }
      ctx._nodeState[nodeId] = { aPrev: a, bPrev: b };
      return { result: crossed };
    },
  },
  // Output nodes — terminal, produce the strategy signal
  'output-signal': {
    id: 'output-signal', label: 'Strategy signal',
    category: 'output',
    inputs: [
      { id: 'enter', label: 'Enter when', type: 'boolean' },
      { id: 'exit',  label: 'Exit when',  type: 'boolean' },
    ],
    outputs: [], // terminal
    params: [],
    evaluate: (_p, inputs, ctx) => {
      // Position-aware: only emit enter when flat, exit when long
      const hasPos = (ctx.pos || 0) > 0;
      if (inputs.enter && !hasPos) return { _signal: 'enter' };
      if (inputs.exit  &&  hasPos) return { _signal: 'exit'  };
      return { _signal: 'hold' };
    },
  },
};

// compileWorkflow — turn a workflow graph into an executable strategy fn.
const compileWorkflow = (workflow) => {
  if (!workflow || !Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    return { fn: null, error: 'Empty workflow' };
  }
  const outputNode = workflow.nodes.find(n => n.type === 'output-signal');
  if (!outputNode) return { fn: null, error: 'No output-signal node — every workflow needs one' };

  // Build adjacency
  const incoming = new Map(); // nodeId → [{ from: {node, port}, to: {node, port} }]
  const outgoing = new Map();
  for (const n of workflow.nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of (workflow.edges || [])) {
    if (!incoming.has(e.to.node) || !outgoing.has(e.from.node)) continue;
    incoming.get(e.to.node).push(e);
    outgoing.get(e.from.node).push(e);
  }

  // Topological sort (Kahn's algorithm)
  const sorted = [];
  const inDeg = new Map();
  for (const n of workflow.nodes) inDeg.set(n.id, incoming.get(n.id).length);
  const queue = workflow.nodes.filter(n => inDeg.get(n.id) === 0).map(n => n.id);
  while (queue.length > 0) {
    const id = queue.shift();
    sorted.push(id);
    for (const e of outgoing.get(id) || []) {
      const next = e.to.node;
      inDeg.set(next, inDeg.get(next) - 1);
      if (inDeg.get(next) === 0) queue.push(next);
    }
  }
  if (sorted.length !== workflow.nodes.length) {
    return { fn: null, error: 'Workflow has a cycle — every connection must flow forward' };
  }

  const nodeById = new Map(workflow.nodes.map(n => [n.id, n]));

  // Strategy fn
  const fn = (bars, i, ctx) => {
    if (!ctx._nodeState) ctx._nodeState = {};
    const cache = new Map(); // nodeId → { [portId]: value }
    let signal = 'hold';
    for (const nodeId of sorted) {
      const node = nodeById.get(nodeId);
      const def = WORKFLOW_NODE_REGISTRY[node.type];
      if (!def) continue;
      // Resolve inputs from incoming edges + upstream cache
      const inputs = {};
      for (const e of incoming.get(nodeId) || []) {
        const upstream = cache.get(e.from.node);
        if (upstream && e.from.port in upstream) {
          inputs[e.to.port] = upstream[e.from.port];
        }
      }
      try {
        const out = def.evaluate(node.params || {}, inputs, { bars, i, ...ctx, _nodeState: ctx._nodeState }, nodeId);
        cache.set(nodeId, out);
        if (node.type === 'output-signal' && out._signal) {
          signal = out._signal;
        }
      } catch {
        // Node-level exception — silent hold
      }
    }
    return signal;
  };
  return { fn, error: null };
};
// Quant strategy localStorage persistence (saved code-mode and
// composite strategies). Used in the strategies panel of the lab.
const QUANT_STRATEGIES_KEY = 'imo_quant_strategies';
const loadQuantStrategies = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(QUANT_STRATEGIES_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};
const saveQuantStrategies = (strats) => {
  try { localStorage.setItem(QUANT_STRATEGIES_KEY, JSON.stringify(strats)); } catch {}
};

// detectLookaheadBias — static analyzer that scans user code for
// patterns that look at future bars (i+N where N > 0). Returns a list
// of { line, col, snippet, kind } warnings.
//
// This is a lexical pass (regex-based), not a real AST analysis, so
// it can produce false positives if a user has a variable named
// e.g. `xi` or `bin`. The tradeoff is keeping the analyzer tiny — a
// real esprima/acorn parser would add ~150KB to the bundle.
//
// Patterns flagged:
//   bars[i+N]                 — explicit forward index
//   bars[N + i]               — same with reversed operand order
//   bars.slice(i+1)           — slicing into the future
//   bars[bars.length-1] OK    — end-of-array is fine, NOT flagged
//   bars[bars.length]         — past-end access, flagged separately
const detectLookaheadBias = (code) => {
  if (!code || typeof code !== 'string') return [];
  const out = [];
  const lines = code.split('\n');
  // Patterns
  // 1. bars[i + positiveInteger] — direct lookahead
  const re1 = /bars\s*\[\s*i\s*\+\s*(\d+)\s*\]/g;
  // 2. bars[positiveInteger + i] — same idea, swapped operands
  const re2 = /bars\s*\[\s*(\d+)\s*\+\s*i\s*\]/g;
  // 3. bars.slice(i + 1, ...)  or .slice(i+1)  — slicing into future
  const re3 = /bars\s*\.\s*slice\s*\(\s*i\s*\+\s*\d+/g;
  // 4. for (let k = i + 1; k <= N; k++) bars[k]    forward iteration
  // detected via the loop init; flag the range starting at i+N
  const re4 = /for\s*\([^)]*?\bk\s*=\s*i\s*\+\s*\d+[^)]*?\)/g;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let m;
    re1.lastIndex = 0;
    while ((m = re1.exec(line)) !== null) {
      out.push({
        line: lineIdx + 1, col: m.index + 1,
        kind: 'lookahead-bars',
        snippet: m[0],
        message: `Looking at future bar bars[i+${m[1]}] — this is lookahead bias and will overstate backtest performance`,
      });
    }
    re2.lastIndex = 0;
    while ((m = re2.exec(line)) !== null) {
      out.push({
        line: lineIdx + 1, col: m.index + 1,
        kind: 'lookahead-bars',
        snippet: m[0],
        message: `Looking at future bar bars[${m[1]}+i] — this is lookahead bias and will overstate backtest performance`,
      });
    }
    re3.lastIndex = 0;
    while ((m = re3.exec(line)) !== null) {
      out.push({
        line: lineIdx + 1, col: m.index + 1,
        kind: 'lookahead-slice',
        snippet: m[0],
        message: `Slicing bars from i+1 onwards — this includes future data the strategy shouldn't see`,
      });
    }
    re4.lastIndex = 0;
    while ((m = re4.exec(line)) !== null) {
      out.push({
        line: lineIdx + 1, col: m.index + 1,
        kind: 'lookahead-loop',
        snippet: m[0],
        message: `Loop iterates forward from i+N — verify it doesn't read future bars[k]`,
      });
    }
  }
  return out;
};

// Workflow localStorage persistence + default starter workflow.
const WORKFLOWS_KEY = 'imo_quant_workflows';
const loadWorkflows = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(WORKFLOWS_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};
const saveWorkflows = (list) => {
  try { localStorage.setItem(WORKFLOWS_KEY, JSON.stringify(list)); } catch {}
};

// Default starter workflow — a working 3-node example so users land
// in a non-empty graph and can see how connections work.
const DEFAULT_WORKFLOW = () => {
  const id = `wf-${Date.now()}`;
  return {
    id,
    name: 'New workflow',
    savedAt: Date.now(),
    nodes: [
      { id: 'n1', type: 'input-rsi',     position: { x: 60,  y: 80  }, params: { window: 14 } },
      { id: 'n2', type: 'threshold',     position: { x: 320, y: 80  }, params: { threshold: 30 } },
      { id: 'n3', type: 'output-signal', position: { x: 600, y: 120 }, params: {} },
    ],
    edges: [
      { from: { node: 'n1', port: 'value' }, to: { node: 'n2', port: 'value' } },
      { from: { node: 'n2', port: 'below' }, to: { node: 'n3', port: 'enter' } },
      { from: { node: 'n2', port: 'above' }, to: { node: 'n3', port: 'exit' } },
    ],
  };
};

// VolForecastMode + QuantLabPage
const VolForecastMode = ({ bars, ticker }) => {
  const returns = useMemo(() => {
    if (!Array.isArray(bars) || bars.length < 60) return [];
    const out = [];
    for (let i = 1; i < bars.length; i++) {
      const p0 = bars[i - 1]?.close ?? bars[i - 1]?.c;
      const p1 = bars[i]?.close ?? bars[i]?.c;
      if (p0 > 0 && p1 > 0) out.push(Math.log(p1 / p0));
    }
    return out;
  }, [bars]);

  const fit = useMemo(() => fitGARCH11(returns), [returns]);
  const forecasts = useMemo(
    () => forecastGARCHVol(fit, [1, 5, 10, 20, 60]),
    [fit]
  );

  // Sliding 30-day realized vol (annualized) for the chart overlay
  const rollingRV = useMemo(() => {
    if (returns.length < 30) return [];
    const out = [];
    for (let i = 29; i < returns.length; i++) {
      let s = 0, ss = 0;
      for (let j = i - 29; j <= i; j++) { s += returns[j]; ss += returns[j] * returns[j]; }
      const m = s / 30;
      const v = ss / 30 - m * m;
      out.push(Math.sqrt(Math.max(0, v) * 252));
    }
    return out;
  }, [returns]);

  // Build chart data: each row has condVol (GARCH path), rollingRV
  // (30d realized), and a horizonPath beyond the last bar
  const chartData = useMemo(() => {
    if (!fit?.fitted) return [];
    const rows = [];
    const offset = 29;
    for (let i = 0; i < fit.condVolPath.length; i++) {
      rows.push({
        t: i,
        garchVol: fit.condVolPath[i] * Math.sqrt(252) * 100,
        rv: i >= offset ? rollingRV[i - offset] * 100 : null,
        forecast: null,
      });
    }
    // Append forecast horizon (closed-form mean-reverting projection)
    const ab = fit.persistence;
    let varH = fit.nextStepVar;
    const lastIdx = fit.condVolPath.length - 1;
    for (let h = 1; h <= 60; h++) {
      if (ab < 0.999) {
        const power = Math.pow(ab, h - 1);
        varH = fit.omega * (1 - power) / (1 - ab) + power * fit.nextStepVar;
      }
      rows.push({
        t: lastIdx + h,
        garchVol: null,
        rv: null,
        forecast: Math.sqrt(varH) * Math.sqrt(252) * 100,
      });
    }
    return rows;
  }, [fit, rollingRV]);

  if (returns.length < 60) {
    return (
      <div className="rounded-md border p-4"
           style={{ borderColor: COLORS.border, background: COLORS.surface }}>
        <div className="text-[11px]" style={{ color: COLORS.textDim }}>
          Need at least 60 daily returns to fit GARCH(1,1). Currently have {returns.length}.
          Increase the period selector at the top to load more bars.
        </div>
      </div>
    );
  }
  if (!fit?.fitted) {
    return (
      <div className="rounded-md border p-4"
           style={{ borderColor: COLORS.border, background: COLORS.surface }}>
        <div className="text-[11px]" style={{ color: COLORS.red }}>
          GARCH fit failed: {fit?.reason || 'unknown'}.
        </div>
      </div>
    );
  }
  const annPct = (v) => (v * Math.sqrt(252) * 100).toFixed(1);
  return (
    <div className="space-y-4">
      <div className="rounded-md border p-4"
           style={{ borderColor: COLORS.border, background: COLORS.surface }}>
        <div className="text-[11px] uppercase tracking-wider mb-2"
             style={{ color: COLORS.textMute }}>
          GARCH(1,1) volatility forecast · {ticker} · {fit.n} returns
        </div>
        <p className="text-[11px] mb-3" style={{ color: COLORS.textDim }}>
          Standard GARCH(1,1) recursion: σ²<sub>t</sub> = ω + α·ε²<sub>t-1</sub> + β·σ²<sub>t-1</sub>.
          Persistence (α+β) controls how slowly vol shocks decay; long-run unconditional variance is ω/(1−α−β).
          Fitted via coordinate-descent QMLE (coarse grid → fine refinement) — adequate for in-browser use.
          Forecasts use the closed-form mean-reverting projection.
        </p>

        {/* Parameter cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>ω (omega)</div>
            <div className="text-[12px] tabular-nums" style={{ color: COLORS.text }}>
              {fit.omega.toExponential(2)}
            </div>
          </div>
          <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>α (ARCH)</div>
            <div className="text-[12px] tabular-nums" style={{ color: COLORS.text }}>
              {fit.alpha.toFixed(3)}
            </div>
          </div>
          <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>β (GARCH)</div>
            <div className="text-[12px] tabular-nums" style={{ color: COLORS.text }}>
              {fit.beta.toFixed(3)}
            </div>
          </div>
          <div className="rounded border p-2"
               style={{
                 borderColor: fit.persistence > 0.99 ? `${COLORS.red}55` : COLORS.border,
                 background: fit.persistence > 0.99 ? `${COLORS.red}08` : COLORS.bg,
               }}>
            <div className="text-[9.5px] uppercase tracking-wider"
                 style={{ color: fit.persistence > 0.99 ? COLORS.red : COLORS.textMute }}>
              Persistence (α+β)
            </div>
            <div className="text-[12px] tabular-nums"
                 style={{ color: fit.persistence > 0.99 ? COLORS.red : COLORS.text }}>
              {fit.persistence.toFixed(3)}
            </div>
            <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
              half-life {Number.isFinite(fit.halfLife) ? `${fit.halfLife.toFixed(1)}d` : '∞'}
            </div>
          </div>
        </div>

        {/* Vol summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
              Sample vol (ann.)
            </div>
            <div className="text-[14px] tabular-nums" style={{ color: COLORS.text }}>
              {annPct(fit.sampleVol)}%
            </div>
          </div>
          <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
              Long-run uncond.
            </div>
            <div className="text-[14px] tabular-nums" style={{ color: COLORS.text }}>
              {annPct(fit.uncondVol)}%
            </div>
          </div>
          <div className="rounded border p-2"
               style={{ borderColor: `${COLORS.chartGold}55`, background: `${COLORS.chartGold}08` }}>
            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.chartGold }}>
              Next-day forecast
            </div>
            <div className="text-[14px] tabular-nums" style={{ color: COLORS.chartGold, fontWeight: 500 }}>
              {annPct(fit.nextStepVol)}%
            </div>
          </div>
          <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
              Log-likelihood
            </div>
            <div className="text-[14px] tabular-nums" style={{ color: COLORS.text }}>
              {fit.logLik.toFixed(0)}
            </div>
          </div>
        </div>

        {/* Horizon forecast table */}
        <div className="rounded border mb-3"
             style={{ borderColor: COLORS.border, background: COLORS.bg }}>
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider"
               style={{ color: COLORS.textMute, borderBottom: `1px solid ${COLORS.border}` }}>
            Horizon forecasts (annualized vol)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] tabular-nums">
              <thead>
                <tr style={{ color: COLORS.textMute }}>
                  <th className="text-left px-3 py-1.5">Horizon</th>
                  <th className="text-right px-3">Forecast vol</th>
                  <th className="text-right px-3">vs. sample vol</th>
                  <th className="text-right px-3">vs. uncond.</th>
                </tr>
              </thead>
              <tbody>
                {forecasts.map(f => {
                  const annV = f.vol * Math.sqrt(252);
                  const sampleAnn = fit.sampleVol * Math.sqrt(252);
                  const uncondAnn = fit.uncondVol * Math.sqrt(252);
                  const dSample = (annV - sampleAnn) / sampleAnn;
                  const dUncond = (annV - uncondAnn) / uncondAnn;
                  return (
                    <tr key={f.h} className="border-t" style={{ borderColor: COLORS.border }}>
                      <td className="px-3 py-1" style={{ color: COLORS.textDim }}>
                        {f.h}d-ahead
                      </td>
                      <td className="text-right px-3" style={{ color: COLORS.chartGold, fontWeight: 500 }}>
                        {(annV * 100).toFixed(1)}%
                      </td>
                      <td className="text-right px-3"
                          style={{ color: dSample >= 0 ? COLORS.red : COLORS.green }}>
                        {dSample >= 0 ? '+' : ''}{(dSample * 100).toFixed(1)}%
                      </td>
                      <td className="text-right px-3"
                          style={{ color: Math.abs(dUncond) < 0.01 ? COLORS.textDim : (dUncond >= 0 ? COLORS.red : COLORS.green) }}>
                        {dUncond >= 0 ? '+' : ''}{(dUncond * 100).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Conditional vol path chart */}
        <div className="rounded border p-2"
             style={{ borderColor: COLORS.border, background: COLORS.bg }}>
          <div className="text-[10px] uppercase tracking-wider mb-1"
               style={{ color: COLORS.textMute }}>
            Conditional vol path · 30d realized · forecast cone
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: COLORS.textMute }}
                     stroke={COLORS.border} />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textMute }}
                     stroke={COLORS.border}
                     tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <Tooltip
                contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }}
                formatter={(val) => val == null ? '—' : `${Number(val).toFixed(1)}%`} />
              <Line dataKey="garchVol"  stroke={COLORS.chartCyan}  strokeWidth={1.5} dot={false} name="GARCH cond. vol" isAnimationActive={false} />
              <Line dataKey="rv"        stroke={COLORS.chartOlive} strokeWidth={1}   dot={false} name="30d realized" isAnimationActive={false} strokeDasharray="3 3" />
              <Line dataKey="forecast"  stroke={COLORS.chartGold}  strokeWidth={2}   dot={false} name="Forecast" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="text-[9.5px] mt-1 flex items-center gap-3 flex-wrap"
               style={{ color: COLORS.textMute }}>
            <span><span style={{ color: COLORS.chartCyan, fontWeight: 600 }}>—</span> GARCH conditional vol (in-sample)</span>
            <span><span style={{ color: COLORS.chartOlive, fontWeight: 600 }}>- - -</span> 30d trailing realized vol</span>
            <span><span style={{ color: COLORS.chartGold, fontWeight: 600 }}>—</span> Forecast (next 60 days)</span>
          </div>
        </div>

        <div className="text-[10px] mt-2" style={{ color: COLORS.textDim }}>
          <strong>Reading the fit</strong>: high α (e.g. &gt; 0.15) means vol reacts strongly to recent shocks (typical of equity indices in crises).
          High β (e.g. &gt; 0.90) means vol is persistent — once elevated, slow to come down. Persistence near 1 ("integrated GARCH") indicates the shock effects don't decay; that's a warning the model is at the edge of stationarity. The half-life tells you how long for a vol shock to decay halfway back to the long-run mean.
          <strong> Honest scope</strong>: this is a 1-equation GARCH fit on log-returns; it does not handle leverage effects (asymmetric vol response — GJR-GARCH or EGARCH would). Forecast cone widens with horizon as the model mean-reverts.
        </div>
      </div>
    </div>
  );
};

export const QuantLabPage = ({ instrument, setActive }) => {
  const [mode, setMode] = useState('discovery');
  const [bars, setBars] = useState([]);
  const [barsStatus, setBarsStatus] = useState('idle');
  const [period, setPeriod] = useState(180);
  const ticker = instrument?.id?.split('-')[0] || 'AAPL';

  // Global execution settings — apply to every mode's backtests so
  // results are comparable. Persisted to localStorage so user
  // preferences stick.
  const [execSettings, setExecSettings] = useState(() => {
    try {
      const raw = localStorage.getItem('imo_quant_exec');
      return raw ? JSON.parse(raw) : { sizing: 'all-in', sizingParam: null, feeBps: 0, slippageBps: 0 };
    } catch { return { sizing: 'all-in', sizingParam: null, feeBps: 0, slippageBps: 0 }; }
  });
  useEffect(() => {
    try { localStorage.setItem('imo_quant_exec', JSON.stringify(execSettings)); } catch {}
  }, [execSettings]);

  // Saved strategies — persisted across sessions
  const [savedStrats, setSavedStrats] = useState(loadQuantStrategies);

  // Helper that all modes use to run a backtest with the current
  // exec settings applied. Wraps runBacktest so we don't have to
  // pass sizing/costs through every call.
  const runWithSettings = useCallback((bars, strategy) => {
    return runBacktest({
      bars, strategy,
      capital: 10000,
      sizing:      execSettings.sizing,
      sizingParam: execSettings.sizingParam,
      costs:       { feeBps: execSettings.feeBps, slippageBps: execSettings.slippageBps },
    });
  }, [execSettings]);

  // Fetch bars on mount + when ticker/period changes
  useEffect(() => {
    let cancelled = false;
    setBarsStatus('loading');
    fetchPolygonAggs(ticker, period, 'day', 1)
      .then(data => {
        if (cancelled) return;
        if (!data || data.length === 0) {
          setBars([]); setBarsStatus('error'); return;
        }
        // Normalize keys — fetchPolygonAggs returns { t, open, high, low, close, volume, ... }
        const normalized = data.map(d => ({
          t: d.t, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
        }));
        setBars(normalized);
        setBarsStatus('ok');
      });
    return () => { cancelled = true; };
  }, [ticker, period]);

  // Discovery mode state
  const [hypothesis, setHypothesis] = useState('');
  const [proposals, setProposals] = useState([]); // [{ id, label, description, factors, threshold, result }]
  const [discoveryStatus, setDiscoveryStatus] = useState('idle');

  // Generate factor proposals from a natural-language hypothesis.
  // For now this uses a deterministic mapping (keyword matching →
  // pre-built factor combinations) so the lab works without an LLM
  // key. When VITE_ANTHROPIC_API_KEY is set we also call the AI for
  // additional creative proposals; the deterministic ones always
  // run as a baseline so users get results either way.
  const generateProposals = async () => {
    if (!hypothesis.trim() || bars.length === 0) return;
    setDiscoveryStatus('thinking');
    const lower = hypothesis.toLowerCase();
    const proposals = [];
    // Deterministic keyword mapping
    if (lower.match(/momentum|trend|breakout|uptrend/)) {
      proposals.push({
        id: 'p-momentum',
        label: 'Pure momentum',
        description: 'Long when 20-day momentum is strongly positive.',
        factors: [{ id: 'momentum-20', weight: 1.0 }],
        threshold: 0.3,
      });
      proposals.push({
        id: 'p-momentum-trend',
        label: 'Momentum + trend confirmation',
        description: 'Combines momentum with SMA trend filter.',
        factors: [
          { id: 'momentum-20', weight: 0.6 },
          { id: 'sma-trend',   weight: 0.4 },
        ],
        threshold: 0.25,
      });
    }
    if (lower.match(/reversion|oversold|reversal|bounce/)) {
      proposals.push({
        id: 'p-meanrev',
        label: 'Mean reversion (RSI)',
        description: 'Buy when RSI signals oversold conditions.',
        factors: [{ id: 'mean-reversion-rsi', weight: 1.0 }],
        threshold: 0.4,
      });
    }
    if (lower.match(/volume|breakout|confirmation|spike/)) {
      proposals.push({
        id: 'p-volbreak',
        label: 'Volume-confirmed breakout',
        description: 'Momentum signal weighted by volume confirmation.',
        factors: [
          { id: 'momentum-20',  weight: 0.6 },
          { id: 'volume-spike', weight: 0.4 },
        ],
        threshold: 0.35,
      });
    }
    if (lower.match(/low.?vol|stable|defensive|quiet/)) {
      proposals.push({
        id: 'p-lowvol',
        label: 'Low-vol regime trend',
        description: 'Trend follow only when volatility is low.',
        factors: [
          { id: 'sma-trend',     weight: 0.5 },
          { id: 'low-vol-regime', weight: 0.5 },
        ],
        threshold: 0.3,
      });
    }
    // Always add an "all-factors equal-weight" fallback
    proposals.push({
      id: 'p-multi',
      label: 'Multi-factor (equal weights)',
      description: 'Equal-weighted ensemble of all five base factors.',
      factors: FACTOR_LIBRARY.map(f => ({ id: f.id, weight: 0.2 })),
      threshold: 0.3,
    });
    // Run backtest on each proposal — uses current exec settings
    const evaluated = proposals.map(p => {
      const fn = buildCompositeStrategy(p.factors, p.threshold);
      const result = runWithSettings(bars, fn);
      return { ...p, result };
    });
    // Sort by Sharpe descending
    evaluated.sort((a, b) => (b.result?.sharpe || 0) - (a.result?.sharpe || 0));
    setProposals(evaluated);
    setDiscoveryStatus('ok');
    // Optional AI augmentation — fire-and-forget; results merge in
    // when they arrive
    if (resolveActiveProvider?.()) {
      try {
        const provider = resolveActiveProvider();
        if (!provider) return;
        const factorList = FACTOR_LIBRARY.map(f => `${f.id}: ${f.description}`).join('\n');
        const aiPrompt = `You are a quantitative strategist. The user's hypothesis: "${hypothesis}"

Available factors (each returns a normalized signal -1 to +1):
${factorList}

Propose ONE additional weighted-factor combination (not just equal weights, not the obvious single-factor version) that fits the hypothesis. Reply with strict JSON only, no prose:
{"label": "<short name>", "description": "<one sentence>", "factors": [{"id": "<factor_id>", "weight": <0-1>}], "threshold": <0-1>}

Use only the factor IDs listed above. The threshold is the score level above which to enter a long position.`;
        const aiResponse = await provider.provider.callChat([
          { role: 'user', content: aiPrompt }
        ], { model: provider.model.id, max_tokens: 400 });
        // Try parse
        const aiText = typeof aiResponse === 'string' ? aiResponse
                     : aiResponse?.content?.[0]?.text || '';
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const aiProposal = JSON.parse(jsonMatch[0]);
          if (aiProposal.factors && Array.isArray(aiProposal.factors)) {
            const fn = buildCompositeStrategy(aiProposal.factors, aiProposal.threshold);
            const result = runWithSettings(bars, fn);
            setProposals(prev => {
              const combined = [...prev, {
                id: `p-ai-${Date.now()}`,
                label: aiProposal.label,
                description: aiProposal.description,
                factors: aiProposal.factors,
                threshold: aiProposal.threshold,
                result,
                ai: true,
              }];
              combined.sort((a, b) => (b.result?.sharpe || 0) - (a.result?.sharpe || 0));
              return combined;
            });
          }
        }
      } catch (e) {
        // AI augmentation failed — fine, deterministic proposals are the main path
      }
    }
  };

  // Builder mode state — picks factors from library
  const [builderFactors, setBuilderFactors] = useState([
    { id: 'momentum-20', weight: 0.5 },
    { id: 'sma-trend',   weight: 0.5 },
  ]);
  const [builderThreshold, setBuilderThreshold] = useState(0.3);
  const builderResult = useMemo(() => {
    if (bars.length === 0 || builderFactors.length === 0) return null;
    const fn = buildCompositeStrategy(builderFactors, builderThreshold);
    return runWithSettings(bars, fn);
  }, [bars, builderFactors, builderThreshold, runWithSettings]);

  const toggleBuilderFactor = (id) => {
    setBuilderFactors(prev => {
      const exists = prev.find(f => f.id === id);
      if (exists) return prev.filter(f => f.id !== id);
      return [...prev, { id, weight: 0.5 }];
    });
  };
  const setBuilderWeight = (id, w) => {
    setBuilderFactors(prev => prev.map(f => f.id === id ? { ...f, weight: w } : f));
  };

  // RL sandbox state
  const [rlEpisodes, setRlEpisodes] = useState(50);
  const [rlTraining, setRlTraining] = useState(false);
  const [rlAgent, setRlAgent] = useState(null);
  const [rlResult, setRlResult] = useState(null);
  const [rlRewardHistory, setRlRewardHistory] = useState([]);

  // Code mode state — user-supplied strategy code
  const [codeText, setCodeText] = useState(`// Custom strategy. Return 'enter' | 'exit' | 'hold' from each bar.
//
// Available variables:
//   bars  — full OHLCV array (read-only)
//   i     — current bar index
//   ctx   — { pos, entryPx, cash, capital }
//   prim  — QUANT_PRIMITIVES registry: prim.sma(bars, i, w),
//           prim.rsi, prim.ema, prim.macd, prim.bb, prim.atr,
//           prim.stoch, prim.roc, prim.obv, prim.mom, prim.vol,
//           prim.volz, prim.range, prim.close
//
// Example — RSI mean reversion with Bollinger filter:
const rsi = prim.rsi(bars, i, 14);
const bb  = prim.bb(bars, i, 20, 2);
if (rsi == null || !bb) return 'hold';
// Buy when oversold AND price is near lower band
if (ctx.pos === 0 && rsi < 30 && bb.pctB < 0.2) return 'enter';
// Exit when RSI returns to neutral
if (ctx.pos > 0  && rsi > 50) return 'exit';
return 'hold';
`);
  const [codeResult, setCodeResult] = useState(null);
  const [codeError, setCodeError]   = useState(null);
  const [codeLogs, setCodeLogs]     = useState([]); // captured console.log entries from last run
  const [codeShowHelp, setCodeShowHelp] = useState(false);
  const [codeAiBusy, setCodeAiBusy] = useState(false);
  const [codeAiSuggestion, setCodeAiSuggestion] = useState(null); // { code, summary } | null
  // Strict mode — wraps `bars` in a Proxy that throws on any access at index > i
  const [codeStrictMode, setCodeStrictMode] = useState(false);
  const codeFileInputRef = useRef(null);

  const runCode = useCallback(() => {
    setCodeError(null);
    setCodeLogs([]);
    if (bars.length === 0) {
      setCodeError('Load price data first');
      return;
    }
    const compiled = compileCodeStrategy(codeText, { strict: codeStrictMode });
    if (compiled.error) {
      setCodeError(compiled.error);
      setCodeResult(null);
      return;
    }
    if (!compiled.fn) {
      setCodeError('Could not compile strategy');
      setCodeResult(null);
      return;
    }
    const result = runWithSettings(bars, compiled.fn);
    setCodeResult(result);
    // compiled.logs is the same array reference the strategy wrote
    // into during the backtest run, so it's already populated.
    setCodeLogs([...compiled.logs]);
  }, [codeText, bars, runWithSettings, codeStrictMode]);

  // Load a starter template into the editor — confirms before
  // overwriting non-empty edits.
  const loadCodeTemplate = useCallback((templateId) => {
    const tpl = QUANT_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return;
    if (codeText && codeText.trim() !== '' && !confirm('Replace current code with the template? Unsaved changes will be lost.')) return;
    setCodeText(tpl.code);
    setCodeResult(null);
    setCodeError(null);
    setCodeLogs([]);
    setCodeAiSuggestion(null);
  }, [codeText]);

  // Export current code as a .js file the user can save locally.
  const exportCodeFile = useCallback(() => {
    const blob = new Blob([codeText], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quant-strategy-${Date.now()}.js`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [codeText]);

  // Import code from a user-selected .js file.
  const onCodeFileSelected = useCallback((event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || '');
      if (codeText && codeText.trim() !== '' &&
          !confirm('Replace current code with file contents?')) return;
      setCodeText(text);
      setCodeResult(null);
      setCodeError(null);
      setCodeLogs([]);
      setCodeAiSuggestion(null);
    };
    reader.readAsText(file);
    event.target.value = ''; // reset so re-selecting same file works
  }, [codeText]);

  // AI assist — ask the active LLM provider to improve the user's
  // strategy. Returns the suggestion in `codeAiSuggestion` so the
  // user can review and accept/reject rather than overwriting blindly.
  const requestCodeAiAssist = useCallback(async () => {
    setCodeAiSuggestion(null);
    if (!codeText.trim()) return;
    const provider = resolveActiveProvider?.();
    if (!provider) {
      setCodeError('No AI provider configured. Set an API key in Settings → AI providers.');
      return;
    }
    setCodeAiBusy(true);
    try {
      const lastResultSummary = codeResult
        ? `Last run: total return ${(codeResult.totalReturn * 100).toFixed(2)}%, Sharpe ${codeResult.sharpe.toFixed(2)}, max DD ${(codeResult.maxDrawdown * 100).toFixed(2)}%, ${codeResult.trades?.length ?? 0} trades.`
        : 'Strategy not yet backtested.';
      const aiPrompt = `You are a quantitative trading strategy reviewer. The user has written this strategy code. Suggest ONE focused improvement (e.g. add a filter, adjust thresholds, fix a bug, improve exit logic) that would likely improve risk-adjusted returns.

${lastResultSummary}

Current code:
\`\`\`javascript
${codeText.slice(0, 4000)}
\`\`\`

Available primitives: prim.sma, prim.rsi, prim.ema, prim.macd, prim.bb, prim.atr, prim.stoch, prim.roc, prim.obv, prim.mom, prim.vol, prim.volz, prim.range, prim.close. Available helpers: util.cross, util.crossUnder, util.clamp.

Reply with strict JSON only, no prose:
{
  "summary": "<one-sentence description of the change>",
  "code":    "<full revised strategy code, ready to paste in>"
}`;
      const aiResponse = await provider.provider.callChat(
        [{ role: 'user', content: aiPrompt }],
        { model: provider.model.id, max_tokens: 1500 },
      );
      const aiText = typeof aiResponse === 'string'
        ? aiResponse
        : aiResponse?.content?.[0]?.text || '';
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.code && parsed.summary) {
            setCodeAiSuggestion(parsed);
          } else {
            setCodeError('AI returned an invalid response shape');
          }
        } catch (e) {
          setCodeError(`AI response not parseable: ${e.message}`);
        }
      } else {
        setCodeError('AI did not return a JSON code suggestion');
      }
    } catch (e) {
      setCodeError(`AI assist failed: ${e?.message || 'unknown error'}`);
    } finally {
      setCodeAiBusy(false);
    }
  }, [codeText, codeResult]);

  // Walk-forward state
  const [wfStrategySource, setWfStrategySource] = useState('builder'); // builder | code
  const [wfSplitRatio, setWfSplitRatio] = useState(0.7);
  const [wfResult, setWfResult] = useState(null);

  const runWalkForwardNow = useCallback(() => {
    if (bars.length < 60) return;
    let strategy;
    if (wfStrategySource === 'builder' && builderFactors.length > 0) {
      strategy = buildCompositeStrategy(builderFactors, builderThreshold);
    } else if (wfStrategySource === 'code') {
      const compiled = compileCodeStrategy(codeText);
      if (compiled.error || !compiled.fn) return;
      strategy = compiled.fn;
    } else {
      return;
    }
    const r = runWalkForward({
      bars, strategy,
      splitRatio: wfSplitRatio,
      capital: 10000,
      sizing:      execSettings.sizing,
      sizingParam: execSettings.sizingParam,
      costs:       { feeBps: execSettings.feeBps, slippageBps: execSettings.slippageBps },
    });
    setWfResult(r);
  }, [bars, wfStrategySource, builderFactors, builderThreshold, codeText, wfSplitRatio, execSettings]);

  // Monte Carlo permutation testing — significance testing on top of WF
  const [mcResult, setMcResult] = useState(null);
  const [mcStatus, setMcStatus] = useState('idle'); // idle | running | done | error
  const [mcProgress, setMcProgress] = useState({ done: 0, total: 0 });
  const [mcNPerms, setMcNPerms] = useState(100);

  const runMonteCarloNow = useCallback(async () => {
    if (bars.length < 60) return;
    let strategy;
    if (wfStrategySource === 'builder' && builderFactors.length > 0) {
      strategy = buildCompositeStrategy(builderFactors, builderThreshold);
    } else if (wfStrategySource === 'code') {
      const compiled = compileCodeStrategy(codeText);
      if (compiled.error || !compiled.fn) {
        setMcStatus('error'); return;
      }
      strategy = compiled.fn;
    } else {
      setMcStatus('error'); return;
    }
    setMcStatus('running');
    setMcProgress({ done: 0, total: mcNPerms });
    setMcResult(null);
    try {
      const r = await runMonteCarloPermutation({
        bars, strategy,
        nPerms: mcNPerms,
        capital: 10000,
        sizing:      execSettings.sizing,
        sizingParam: execSettings.sizingParam,
        costs:       { feeBps: execSettings.feeBps, slippageBps: execSettings.slippageBps },
        onProgress: (done, total) => setMcProgress({ done, total }),
      });
      setMcResult(r);
      setMcStatus('done');
    } catch (e) {
      setMcStatus('error');
    }
  }, [bars, wfStrategySource, builderFactors, builderThreshold, codeText, mcNPerms, execSettings]);

  // Cross-section state
  const [csBasket, setCsBasket] = useState('AAPL,MSFT,GOOGL,AMZN,META,NVDA,TSLA,JPM,BAC,WMT,XOM,JNJ,UNH,V,MA');
  // Multi-factor support — csFactors is an array of { id, weight }.
  // For backwards compatibility a single-factor selection just makes
  // a one-element array. Cross-sectional ranking is z-normalized
  // per-factor before weighting so different factor scales don't
  // dominate the composite.
  const [csFactors, setCsFactors] = useState([{ id: 'momentum-20', weight: 1.0 }]);
  const [csMode, setCsMode] = useState('long-only'); // long-only | long-short
  const [csQuintile, setCsQuintile] = useState(0.2);
  const [csRebalance, setCsRebalance] = useState('weekly');
  const [csStatus, setCsStatus] = useState('idle'); // idle | loading | ok | error
  const [csResult, setCsResult] = useState(null);
  // Cross-section enhancements: sector neutralization + rank-IC weighting
  const [csSectorNeutral, setCsSectorNeutral] = useState(false);
  const [csRankIcWeighting, setCsRankIcWeighting] = useState(false);
  const [csRankIcWindow, setCsRankIcWindow] = useState(12);

  const toggleCsFactor = (id) => {
    setCsFactors(prev => {
      const exists = prev.find(f => f.id === id);
      if (exists) return prev.filter(f => f.id !== id);
      return [...prev, { id, weight: 0.5 }];
    });
  };
  const setCsFactorWeight = (id, w) => {
    setCsFactors(prev => prev.map(f => f.id === id ? { ...f, weight: w } : f));
  };

  const runCrossSectionNow = useCallback(async () => {
    setCsStatus('loading');
    setCsResult(null);
    const tickers = csBasket.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    if (tickers.length < 5) { setCsStatus('error'); return; }
    // Fetch all bars in parallel
    const fetched = await Promise.all(tickers.map(t => fetchPolygonAggs(t, period, 'day', 1).catch(() => null)));
    const barsByTicker = {};
    let validCount = 0;
    for (let i = 0; i < tickers.length; i++) {
      const data = fetched[i];
      if (data && data.length > 0) {
        barsByTicker[tickers[i]] = data.map(d => ({
          t: d.t, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
        }));
        validCount++;
      }
    }
    if (validCount < 5) { setCsStatus('error'); return; }
    // Align to common length — trim to shortest
    const minLen = Math.min(...Object.values(barsByTicker).map(b => b.length));
    for (const t of Object.keys(barsByTicker)) {
      barsByTicker[t] = barsByTicker[t].slice(-minLen);
    }
    // Resolve factors. Single-factor (length 1) passes a function for
    // legacy code path; multi-factor passes an array of {fn, weight}.
    let factor;
    if (csFactors.length === 0) { setCsStatus('error'); return; }
    if (csFactors.length === 1) {
      factor = FACTOR_LIBRARY.find(f => f.id === csFactors[0].id)?.signal;
      if (!factor) { setCsStatus('error'); return; }
    } else {
      factor = csFactors.map(cf => ({
        fn: FACTOR_LIBRARY.find(f => f.id === cf.id)?.signal,
        weight: cf.weight,
      })).filter(f => f.fn);
      if (factor.length === 0) { setCsStatus('error'); return; }
    }
    // Build sector map — uses INSTRUMENTS list metadata if available
    let sectorMap = null;
    if (csSectorNeutral) {
      sectorMap = {};
      for (const t of Object.keys(barsByTicker)) {
        const inst = INSTRUMENTS.find(i => i.id?.startsWith(t + '-') || i.id === t || i.symbol === t);
        sectorMap[t] = inst?.sector || inst?.category || '__unknown__';
      }
    }
    const r = runCrossSectional({
      barsByTicker,
      factor,
      mode: csMode,
      quintile: csQuintile,
      capital: 10000,
      costs:    { feeBps: execSettings.feeBps, slippageBps: execSettings.slippageBps },
      rebalance: csRebalance,
      sectorMap,
      rankIcWeighting: csRankIcWeighting && csFactors.length > 1,
      rankIcWindow: csRankIcWindow,
    });
    setCsResult(r);
    setCsStatus(r.error ? 'error' : 'ok');
  }, [csBasket, csFactors, csMode, csQuintile, csRebalance, period, execSettings, csSectorNeutral, csRankIcWeighting, csRankIcWindow]);

  // Workflow state — visual node-graph strategy builder
  const [workflows, setWorkflows] = useState(loadWorkflows);
  const [activeWorkflow, setActiveWorkflow] = useState(() => {
    const stored = loadWorkflows();
    return stored.length > 0 ? stored[0] : DEFAULT_WORKFLOW();
  });
  // Undo/redo history — capped at 50 entries each
  const [wfHistory, setWfHistory] = useState({ undo: [], redo: [] });
  const [wfBacktestResult, setWfBacktestResult] = useState(null);
  const [wfCompileError, setWfCompileError] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [draggingNodeId, setDraggingNodeId] = useState(null);
  const [draggingFrom, setDraggingFrom] = useState(null); // { node, port } when drawing a new edge
  const [hoverPort, setHoverPort] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [palettOpen, setPaletteOpen] = useState(false);
  // Filter for node palette search
  const [paletteFilter, setPaletteFilter] = useState('');
  // Workflow viewport — pan offset + zoom level. Uses SVG viewBox transform.
  // viewBox = `${panX} ${panY} ${900/zoom} ${540/zoom}`
  const [wfViewport, setWfViewport] = useState({ panX: 0, panY: 0, zoom: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const wfCanvasRef = useRef(null);

  // Run the workflow against current bars + show result
  const runWorkflow = useCallback(() => {
    setWfCompileError(null);
    setWfBacktestResult(null);
    if (bars.length === 0) {
      setWfCompileError('Load price data first');
      return;
    }
    const compiled = compileWorkflow(activeWorkflow);
    if (compiled.error) {
      setWfCompileError(compiled.error);
      return;
    }
    const result = runWithSettings(bars, compiled.fn);
    setWfBacktestResult(result);
  }, [activeWorkflow, bars, runWithSettings]);

  // updateActiveWorkflow now snapshots prev state into undo stack, clears redo
  const updateActiveWorkflow = useCallback((updater) => {
    setActiveWorkflow(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      // Push prev into undo stack — but only if it's an actual change
      if (next !== prev) {
        setWfHistory(h => ({
          undo: [...h.undo, prev].slice(-50),
          redo: [], // clear redo on new action
        }));
      }
      return next;
    });
  }, []);

  const undoWorkflow = useCallback(() => {
    setWfHistory(h => {
      if (h.undo.length === 0) return h;
      const prev = h.undo[h.undo.length - 1];
      setActiveWorkflow(cur => {
        return prev;
      });
      return {
        undo: h.undo.slice(0, -1),
        redo: [activeWorkflow, ...h.redo].slice(0, 50),
      };
    });
    setSelectedNodeId(null);
  }, [activeWorkflow]);

  const redoWorkflow = useCallback(() => {
    setWfHistory(h => {
      if (h.redo.length === 0) return h;
      const next = h.redo[0];
      setActiveWorkflow(next);
      return {
        undo: [...h.undo, activeWorkflow].slice(-50),
        redo: h.redo.slice(1),
      };
    });
    setSelectedNodeId(null);
  }, [activeWorkflow]);

  // Keyboard shortcuts for workflow mode — only active when on workflow tab
  useEffect(() => {
    if (mode !== 'workflow') return;
    const handler = (e) => {
      // Ignore if typing in an input/textarea
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoWorkflow();
      } else if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redoWorkflow();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, undoWorkflow, redoWorkflow]);

  const addWorkflowNode = useCallback((typeId, position = { x: 200, y: 200 }) => {
    const id = `n${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const def = WORKFLOW_NODE_REGISTRY[typeId];
    if (!def) return;
    const params = {};
    for (const p of def.params || []) params[p.id] = p.default;
    updateActiveWorkflow(wf => ({
      ...wf,
      nodes: [...wf.nodes, { id, type: typeId, position, params }],
    }));
  }, [updateActiveWorkflow]);

  const deleteWorkflowNode = useCallback((nodeId) => {
    updateActiveWorkflow(wf => ({
      ...wf,
      nodes: wf.nodes.filter(n => n.id !== nodeId),
      edges: wf.edges.filter(e => e.from.node !== nodeId && e.to.node !== nodeId),
    }));
    setSelectedNodeId(s => s === nodeId ? null : s);
  }, [updateActiveWorkflow]);

  const updateNodeParam = useCallback((nodeId, paramKey, value) => {
    updateActiveWorkflow(wf => ({
      ...wf,
      nodes: wf.nodes.map(n => n.id === nodeId
        ? { ...n, params: { ...(n.params || {}), [paramKey]: value } }
        : n),
    }));
  }, [updateActiveWorkflow]);

  const addEdge = useCallback((from, to) => {
    // Reject if same connection already exists
    updateActiveWorkflow(wf => {
      const exists = wf.edges.some(e =>
        e.from.node === from.node && e.from.port === from.port &&
        e.to.node === to.node && e.to.port === to.port);
      if (exists) return wf;
      // Reject self-loops
      if (from.node === to.node) return wf;
      // For input ports, only allow ONE incoming edge — replace if needed
      const filteredEdges = wf.edges.filter(e =>
        !(e.to.node === to.node && e.to.port === to.port));
      return { ...wf, edges: [...filteredEdges, { from, to }] };
    });
  }, [updateActiveWorkflow]);

  const removeEdge = useCallback((edge) => {
    updateActiveWorkflow(wf => ({
      ...wf,
      edges: wf.edges.filter(e =>
        !(e.from.node === edge.from.node && e.from.port === edge.from.port &&
          e.to.node === edge.to.node && e.to.port === edge.to.port)),
    }));
  }, [updateActiveWorkflow]);

  const persistWorkflows = useCallback((next) => {
    setWorkflows(next);
    saveWorkflows(next);
  }, []);

  const saveCurrentWorkflow = useCallback(() => {
    const name = prompt('Save workflow as:', activeWorkflow.name);
    if (!name) return;
    const updated = { ...activeWorkflow, name, savedAt: Date.now() };
    setActiveWorkflow(updated);
    const next = [updated, ...workflows.filter(w => w.id !== updated.id)];
    persistWorkflows(next);
  }, [activeWorkflow, workflows, persistWorkflows]);

  const newWorkflow = useCallback(() => {
    if (!confirm('Discard current graph and start a new workflow?')) return;
    setActiveWorkflow(DEFAULT_WORKFLOW());
    setWfHistory({ undo: [], redo: [] });
    setWfBacktestResult(null);
    setWfCompileError(null);
    setSelectedNodeId(null);
  }, []);

  const loadWorkflow = useCallback((wf) => {
    setActiveWorkflow(wf);
    setWfHistory({ undo: [], redo: [] });
    setWfBacktestResult(null);
    setWfCompileError(null);
    setSelectedNodeId(null);
  }, []);

  const deleteSavedWorkflow = useCallback((id) => {
    if (!confirm('Delete this saved workflow?')) return;
    persistWorkflows(workflows.filter(w => w.id !== id));
  }, [workflows, persistWorkflows]);

  // Pair trading state
  const [pairTickerA, setPairTickerA] = useState('KO');
  const [pairTickerB, setPairTickerB] = useState('PEP');
  const [pairLookback, setPairLookback] = useState(60);
  const [pairEntryZ, setPairEntryZ] = useState(2.0);
  const [pairExitZ, setPairExitZ] = useState(0.5);
  const [pairHedgeMethod, setPairHedgeMethod] = useState('equal');  // equal | ols | rolling-ols
  const [pairResult, setPairResult] = useState(null);
  const [pairStatus, setPairStatus] = useState('idle');
  const runPairTradeNow = useCallback(async () => {
    if (!pairTickerA || !pairTickerB || pairTickerA === pairTickerB) return;
    setPairStatus('loading');
    try {
      const [dataA, dataB] = await Promise.all([
        fetchPolygonAggs(pairTickerA, period, 'day', 1),
        fetchPolygonAggs(pairTickerB, period, 'day', 1),
      ]);
      if (!dataA || !dataB || dataA.length === 0 || dataB.length === 0) {
        setPairStatus('error'); return;
      }
      const barsA = dataA.map(d => ({ t: d.t, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }));
      const barsB = dataB.map(d => ({ t: d.t, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }));
      const r = runPairTrade({
        barsA, barsB,
        lookback: pairLookback,
        entryZ:   pairEntryZ,
        exitZ:    pairExitZ,
        hedgeMethod: pairHedgeMethod,
        capital:  10000,
        costs:    { feeBps: execSettings.feeBps, slippageBps: execSettings.slippageBps },
      });
      setPairResult(r);
      setPairStatus(r.error ? 'error' : 'ok');
    } catch (e) {
      setPairStatus('error');
    }
  }, [pairTickerA, pairTickerB, pairLookback, pairEntryZ, pairExitZ, pairHedgeMethod, period, execSettings]);

  // Seasonal strategy state
  const [seasonalPreset, setSeasonalPreset] = useState('sell-in-may');
  const [seasonalBullMonths, setSeasonalBullMonths] = useState([11, 12, 1, 2, 3, 4]);
  const [seasonalBearMonths, setSeasonalBearMonths] = useState([5, 6, 7, 8, 9, 10]);
  // Weekday effect — 0 = Sun, 1 = Mon, ..., 6 = Sat. Trading happens
  // Mon–Fri only (1–5). Default empty = no weekday filter.
  const [seasonalBullWeekdays, setSeasonalBullWeekdays] = useState([]);
  const [seasonalBearWeekdays, setSeasonalBearWeekdays] = useState([]);
  const [seasonalResult, setSeasonalResult] = useState(null);
  const SEASONAL_PRESETS = [
    { id: 'sell-in-may', label: 'Sell in May', bull: [11, 12, 1, 2, 3, 4], bear: [5, 6, 7, 8, 9, 10], bullDay: [], bearDay: [] },
    { id: 'jan-effect',  label: 'January effect', bull: [1], bear: [], bullDay: [], bearDay: [] },
    { id: 'year-end',    label: 'Year-end rally', bull: [11, 12], bear: [], bullDay: [], bearDay: [] },
    { id: 'spring',      label: 'A-share spring rally', bull: [1, 2, 3], bear: [], bullDay: [], bearDay: [] },
    { id: 'mon-effect',  label: 'Monday effect (avoid Mondays)', bull: [], bear: [], bullDay: [], bearDay: [1] },
    { id: 'fri-effect',  label: 'Friday effect (long Fridays)', bull: [], bear: [], bullDay: [5], bearDay: [] },
    { id: 'custom',      label: 'Custom', bull: [], bear: [], bullDay: [], bearDay: [] },
  ];
  const applySeasonalPreset = (id) => {
    const p = SEASONAL_PRESETS.find(x => x.id === id);
    if (!p) return;
    setSeasonalPreset(id);
    if (id !== 'custom') {
      setSeasonalBullMonths(p.bull);
      setSeasonalBearMonths(p.bear);
      setSeasonalBullWeekdays(p.bullDay);
      setSeasonalBearWeekdays(p.bearDay);
    }
  };
  const toggleSeasonalMonth = (kind, m) => {
    if (kind === 'bull') {
      setSeasonalBullMonths(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
    } else {
      setSeasonalBearMonths(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
    }
    setSeasonalPreset('custom');
  };
  const toggleSeasonalWeekday = (kind, d) => {
    if (kind === 'bull') {
      setSeasonalBullWeekdays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
    } else {
      setSeasonalBearWeekdays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
    }
    setSeasonalPreset('custom');
  };
  const runSeasonalNow = useCallback(() => {
    if (bars.length === 0) return;
    const r = runSeasonalStrategy({
      bars,
      bullishMonths: seasonalBullMonths,
      bearishMonths: seasonalBearMonths,
      bullishWeekdays: seasonalBullWeekdays,
      bearishWeekdays: seasonalBearWeekdays,
      capital: 10000,
      costs:   { feeBps: execSettings.feeBps, slippageBps: execSettings.slippageBps },
    });
    setSeasonalResult(r);
  }, [bars, seasonalBullMonths, seasonalBearMonths, seasonalBullWeekdays, seasonalBearWeekdays, execSettings]);

  // Correlation matrix state
  const [corrBasket, setCorrBasket] = useState('AAPL,MSFT,GOOGL,AMZN,META,NVDA,TSLA,JPM,XOM,JNJ');
  const [corrResult, setCorrResult] = useState(null);
  const [corrStatus, setCorrStatus] = useState('idle');
  const runCorrelationNow = useCallback(async () => {
    setCorrStatus('loading');
    setCorrResult(null);
    const tickers = corrBasket.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    if (tickers.length < 2) { setCorrStatus('error'); return; }
    const fetched = await Promise.all(tickers.map(t =>
      fetchPolygonAggs(t, period, 'day', 1).catch(() => null)));
    const barsByTicker = {};
    let valid = 0;
    for (let i = 0; i < tickers.length; i++) {
      if (fetched[i] && fetched[i].length > 0) {
        barsByTicker[tickers[i]] = fetched[i].map(d => ({
          t: d.t, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
        }));
        valid++;
      }
    }
    if (valid < 2) { setCorrStatus('error'); return; }
    const result = computeCorrelationMatrix(barsByTicker);
    setCorrResult(result);
    setCorrStatus(result ? 'ok' : 'error');
  }, [corrBasket, period]);

  // Options payoff state
  const [optionLegs, setOptionLegs] = useState([
    { id: 'l1', type: 'call', side: 'long',  strike: 100, premium: 5,  qty: 1 },
  ]);
  const [optionSpot, setOptionSpot] = useState(100);
  const [optionPreset, setOptionPreset] = useState('long-call');
  // Configurable Black-Scholes inputs for the greeks table
  const [optionT, setOptionT] = useState(0.25);     // years to expiry
  const [optionSigma, setOptionSigma] = useState(0.25);  // annualized vol
  const [optionR, setOptionR] = useState(0.05);     // risk-free rate
  const OPTION_PRESETS = [
    { id: 'long-call',  label: 'Long call',
      legs: () => [{ id: 'l1', type: 'call', side: 'long', strike: 100, premium: 5, qty: 1 }] },
    { id: 'long-put',   label: 'Long put',
      legs: () => [{ id: 'l1', type: 'put', side: 'long', strike: 100, premium: 5, qty: 1 }] },
    { id: 'covered-call', label: 'Covered call',
      legs: () => [
        { id: 'l1', type: 'underlying', side: 'long',  strike: 100, premium: 0, qty: 100 },
        { id: 'l2', type: 'call',       side: 'short', strike: 105, premium: 2, qty: 100 },
      ] },
    { id: 'protective-put', label: 'Protective put',
      legs: () => [
        { id: 'l1', type: 'underlying', side: 'long', strike: 100, premium: 0, qty: 100 },
        { id: 'l2', type: 'put',        side: 'long', strike: 95,  premium: 2, qty: 100 },
      ] },
    { id: 'bull-call-spread', label: 'Bull call spread',
      legs: () => [
        { id: 'l1', type: 'call', side: 'long',  strike: 100, premium: 5, qty: 1 },
        { id: 'l2', type: 'call', side: 'short', strike: 110, premium: 2, qty: 1 },
      ] },
    { id: 'bear-put-spread', label: 'Bear put spread',
      legs: () => [
        { id: 'l1', type: 'put', side: 'long',  strike: 100, premium: 5, qty: 1 },
        { id: 'l2', type: 'put', side: 'short', strike: 90,  premium: 2, qty: 1 },
      ] },
    { id: 'iron-condor', label: 'Iron condor',
      legs: () => [
        { id: 'l1', type: 'put',  side: 'long',  strike: 90,  premium: 1, qty: 1 },
        { id: 'l2', type: 'put',  side: 'short', strike: 95,  premium: 2, qty: 1 },
        { id: 'l3', type: 'call', side: 'short', strike: 105, premium: 2, qty: 1 },
        { id: 'l4', type: 'call', side: 'long',  strike: 110, premium: 1, qty: 1 },
      ] },
    { id: 'long-straddle', label: 'Long straddle',
      legs: () => [
        { id: 'l1', type: 'call', side: 'long', strike: 100, premium: 5, qty: 1 },
        { id: 'l2', type: 'put',  side: 'long', strike: 100, premium: 5, qty: 1 },
      ] },
    { id: 'short-strangle', label: 'Short strangle',
      legs: () => [
        { id: 'l1', type: 'call', side: 'short', strike: 105, premium: 3, qty: 1 },
        { id: 'l2', type: 'put',  side: 'short', strike: 95,  premium: 3, qty: 1 },
      ] },
  ];
  const applyOptionPreset = (id) => {
    const p = OPTION_PRESETS.find(x => x.id === id);
    if (!p) return;
    setOptionPreset(id);
    setOptionLegs(p.legs());
  };
  const updateOptionLeg = (id, key, value) => {
    setOptionLegs(prev => prev.map(l => l.id === id ? { ...l, [key]: value } : l));
  };
  const addOptionLeg = () => {
    setOptionLegs(prev => [...prev, {
      id: `l${Date.now()}`, type: 'call', side: 'long', strike: 100, premium: 5, qty: 1,
    }]);
  };
  const removeOptionLeg = (id) => {
    setOptionLegs(prev => prev.filter(l => l.id !== id));
  };

  // Code mode lookahead bias warnings — recomputed on every code change
  const codeLookaheadWarnings = useMemo(() =>
    detectLookaheadBias(codeText), [codeText]);

  // Code mode step debugger
  const [stepTrace, setStepTrace] = useState(null);
  const [stepCursor, setStepCursor] = useState(0);
  const runStepDebugger = useCallback(() => {
    if (!codeText || bars.length === 0) return;
    const compiled = compileCodeStrategy(codeText, { strict: codeStrictMode });
    if (compiled.error || !compiled.fn) {
      setCodeError(compiled.error || 'Could not compile');
      return;
    }
    // Limit to last 250 bars to keep UI snappy
    const tail = bars.slice(-250);
    const trace = stepDebugStrategy(tail, compiled.fn, { capital: 10000 });
    setStepTrace(trace);
    setStepCursor(trace.length - 1);
  }, [codeText, bars, codeStrictMode]);

  // Save current strategy
  const saveCurrentStrategy = (name, strat) => {
    if (!name) return;
    const next = [...savedStrats.filter(s => s.name !== name), {
      ...strat,
      name,
      id: `strat-${Date.now()}`,
      savedAt: Date.now(),
    }];
    setSavedStrats(next);
    saveQuantStrategies(next);
  };
  const deleteSavedStrategy = (id) => {
    const next = savedStrats.filter(s => s.id !== id);
    setSavedStrats(next);
    saveQuantStrategies(next);
  };

  const trainRL = async () => {
    if (bars.length < 60) return;
    setRlTraining(true);
    // Use setTimeout so the UI can repaint before the (synchronous) training loop
    await new Promise(resolve => setTimeout(resolve, 50));
    const agent = buildToyRLAgent();
    const trainResult = agent.train(bars, rlEpisodes);
    setRlRewardHistory(trainResult.rewardsPerEpisode || []);
    // Replay the trained policy and capture equity curve
    const replayResult = runWithSettings(bars, agent.asStrategy());
    setRlAgent(agent);
    setRlResult(replayResult);
    setRlTraining(false);
  };

  const fmtPct = (x) => x == null ? '—' : `${(x * 100).toFixed(2)}%`;
  const fmtNum = (x, dp = 2) => x == null ? '—' : x.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp });

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: COLORS.bg, color: COLORS.text }}>
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="flex items-baseline gap-3 mb-1 flex-wrap">
          <h1 className="text-[24px] font-medium">Quant Lab</h1>
          <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(159,136,255,0.10)', color: '#9F88FF' }}>AI-assisted</span>
        </div>
        <p className="text-[12.5px] mb-6" style={{ color: COLORS.textMute }}>
          Build, test, and discover quantitative trading signals. Eleven modes: AI factor discovery, weighted-factor builder, custom JavaScript code (with lookahead-bias static analysis + bar-by-bar step debugger), walk-forward overfit detection, cross-sectional ranking on a basket (multi-factor composite supported), visual workflow node editor, pair trading (z-score mean reversion), seasonal calendar effects, correlation matrix heatmap, options payoff visualizer (BS pricing + greeks), and a toy RL sandbox. All modes share execution settings (sizing, fees, slippage) and backtest on real OHLC via Polygon.
        </p>

        {/* Mode selector */}
        <div className="flex items-center gap-1 mb-4 rounded-md p-0.5 inline-flex"
             style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
          {[
            { id: 'discovery',  label: '1. Discovery' },
            { id: 'builder',    label: '2. Builder' },
            { id: 'code',       label: '3. Code' },
            { id: 'walkforward',label: '4. Walk-forward' },
            { id: 'crosssec',   label: '5. Cross-section' },
            { id: 'workflow',   label: '6. Workflow' },
            { id: 'pair',       label: '7. Pair trade' },
            { id: 'seasonal',   label: '8. Seasonal' },
            { id: 'correlation',label: '9. Correlation' },
            { id: 'options',    label: '10. Options' },
            { id: 'rl',         label: '11. RL sandbox' },
            { id: 'volforecast',label: '12. Vol forecast' },
          ].map(m => (
            <button key={m.id} type="button"
                    onClick={() => setMode(m.id)}
                    className="px-3 py-1.5 text-[11.5px] rounded transition-colors"
                    style={{
                      background:  mode === m.id ? COLORS.mint : 'transparent',
                      color:       mode === m.id ? COLORS.bg : COLORS.textDim,
                      fontWeight:  mode === m.id ? 600 : 500,
                    }}>
              {m.label}
            </button>
          ))}
        </div>

        {/* Ticker + period bar */}
        <div className="rounded-md border p-3 mb-4 flex items-center gap-3 flex-wrap"
             style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          <div className="text-[11px]" style={{ color: COLORS.textMute }}>Universe</div>
          <div className="text-[13px] font-medium" style={{ color: COLORS.text }}>{ticker}</div>
          <span style={{ color: COLORS.textMute }}>·</span>
          <div className="text-[11px]" style={{ color: COLORS.textMute }}>Window</div>
          <select value={period}
                  onChange={(e) => setPeriod(Number(e.target.value))}
                  className="px-2 py-1 rounded text-[11.5px] outline-none"
                  style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>1 year</option>
            <option value={730}>2 years</option>
          </select>
          <span style={{ color: COLORS.textMute }}>·</span>
          <div className="text-[11px]" style={{ color: COLORS.textMute }}>
            {barsStatus === 'loading' && 'Loading bars…'}
            {barsStatus === 'ok'      && `${bars.length} bars loaded`}
            {barsStatus === 'error'   && (
              <span style={{ color: COLORS.red }}>Could not load price data — set VITE_MASSIVE_API_KEY for Polygon</span>
            )}
          </div>
        </div>

        {/* Execution settings — sizing, fees, slippage. Apply to every
            mode's backtests. Collapsed by default so beginners aren't
            overwhelmed. */}
        <details className="rounded-md border mb-4"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          <summary className="px-3 py-2 cursor-pointer text-[11.5px] flex items-center justify-between"
                   style={{ color: COLORS.text }}>
            <span>Execution settings</span>
            <span className="text-[10px]" style={{ color: COLORS.textMute }}>
              sizing: {execSettings.sizing}
              {execSettings.sizing !== 'all-in' && execSettings.sizingParam != null && ` (${execSettings.sizingParam})`}
              {(execSettings.feeBps > 0 || execSettings.slippageBps > 0) &&
                ` · ${execSettings.feeBps}bp fee · ${execSettings.slippageBps}bp slip`}
            </span>
          </summary>
          <div className="px-3 pb-3 pt-2 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                Position sizing
              </div>
              <select value={execSettings.sizing}
                      onChange={(e) => setExecSettings(s => ({ ...s, sizing: e.target.value, sizingParam: null }))}
                      className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none"
                      style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                <option value="all-in">All-in (use full cash)</option>
                <option value="fixed">Fixed fraction</option>
                <option value="voltarget">Vol-target</option>
                <option value="kelly">Half-Kelly</option>
              </select>
            </div>
            {execSettings.sizing !== 'all-in' && (
              <div>
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                  {execSettings.sizing === 'fixed'     ? 'Fraction (0-1)'
                  : execSettings.sizing === 'voltarget' ? 'Annualized vol target (%)'
                  : 'Kelly cap (0-1)'}
                </div>
                <input type="number" step="0.05" min="0" max={execSettings.sizing === 'voltarget' ? 100 : 1}
                       value={execSettings.sizingParam ?? (execSettings.sizing === 'voltarget' ? 15 : 0.25)}
                       onChange={(e) => setExecSettings(s => ({ ...s, sizingParam: Number(e.target.value) }))}
                       className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none tabular-nums"
                       style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              </div>
            )}
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                Fee per fill (bps)
              </div>
              <input type="number" step="1" min="0"
                     value={execSettings.feeBps}
                     onChange={(e) => setExecSettings(s => ({ ...s, feeBps: Number(e.target.value) || 0 }))}
                     className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none tabular-nums"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                Slippage (bps)
              </div>
              <input type="number" step="1" min="0"
                     value={execSettings.slippageBps}
                     onChange={(e) => setExecSettings(s => ({ ...s, slippageBps: Number(e.target.value) || 0 }))}
                     className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none tabular-nums"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            </div>
            <div className="sm:col-span-4 text-[10px]" style={{ color: COLORS.textMute }}>
              Sizing models: all-in uses full cash on each entry (default, legacy). Fixed = constant fraction. Vol-target = size = capital × target / realized_vol_at_entry. Half-Kelly uses rolling win-rate + win/loss ratio with Bayesian shrinkage toward a neutral prior (W=0.5, R=1) — small samples get shrunk hard toward the prior, so the strategy doesn't dangerously overbet on a few lucky trades. Fees + slippage apply per fill (entry & exit), so a 5bp fee + 5bp slippage = roughly 20bp round-trip drag.
            </div>
          </div>
        </details>

        {/* Mode content */}
        {mode === 'discovery' && (
          <div className="space-y-4">
            <div className="rounded-md border p-4"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                Your hypothesis
              </div>
              <textarea value={hypothesis}
                        onChange={(e) => setHypothesis(e.target.value)}
                        placeholder='e.g. "I think momentum continues for a few weeks after a volume spike" or "buy oversold pullbacks in low-vol regimes"'
                        rows={2}
                        className="w-full px-3 py-2 rounded text-[12px] outline-none resize-none"
                        style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
                <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
                  Factor discovery generates 2-5 weighted-factor strategies that fit your hypothesis, backtests each, and ranks by Sharpe ratio. AI augmentation enabled when an LLM provider is configured.
                </div>
                <button type="button"
                        onClick={generateProposals}
                        disabled={!hypothesis.trim() || barsStatus !== 'ok' || discoveryStatus === 'thinking'}
                        className="px-3 py-2 rounded text-[12px] font-medium transition-colors disabled:opacity-40"
                        style={{ background: COLORS.mint, color: COLORS.bg }}>
                  {discoveryStatus === 'thinking' ? 'Generating…' : 'Discover factors'}
                </button>
              </div>
            </div>

            {/* Quick hypothesis examples */}
            <div className="flex flex-wrap gap-1.5">
              {[
                'momentum continues after volume spikes',
                'mean reversion on oversold pullbacks',
                'trend follow only in low-vol regimes',
                'breakout above 20-day high with volume',
              ].map(ex => (
                <button key={ex} type="button"
                        onClick={() => setHypothesis(ex)}
                        className="px-2 py-1 rounded text-[10.5px] hover:bg-white/[0.04] transition-colors"
                        style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                  {ex}
                </button>
              ))}
            </div>

            {/* Proposals */}
            {proposals.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                  Ranked proposals · {proposals.length} strategies tested on {bars.length} bars
                </div>
                {proposals.map((p, idx) => {
                  const r = p.result;
                  const isWinner = idx === 0;
                  return (
                    <div key={p.id}
                         className="rounded-md border p-3"
                         style={{
                           borderColor: isWinner ? COLORS.green : COLORS.border,
                           background:  isWinner ? `${COLORS.green}0F` : COLORS.surface,
                         }}>
                      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-medium flex items-center gap-1.5" style={{ color: COLORS.text }}>
                            {isWinner && (
                              <Star size={12} fill={COLORS.green} stroke={COLORS.green} aria-label="Top result" />
                            )}
                            {p.ai && (
                              <Bot size={12} style={{ color: '#9F88FF' }} aria-label="AI-proposed" />
                            )}
                            <span className="truncate">{p.label}</span>
                          </div>
                          <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
                            {p.description}
                          </div>
                        </div>
                        <div className="text-[10px]" style={{ color: COLORS.textMute }}>
                          {p.factors.map(f => `${f.id} × ${f.weight.toFixed(1)}`).join(' + ')}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                        <div>
                          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Total</div>
                          <div className="tabular-nums font-medium"
                               style={{ color: r?.totalReturn >= 0 ? COLORS.green : COLORS.red }}>
                            {fmtPct(r?.totalReturn)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>CAGR</div>
                          <div className="tabular-nums">{fmtPct(r?.cagr)}</div>
                        </div>
                        <div>
                          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sharpe</div>
                          <div className="tabular-nums font-medium"
                               style={{ color: (r?.sharpe || 0) > 1 ? COLORS.green : (r?.sharpe || 0) > 0 ? COLORS.text : COLORS.red }}>
                            {fmtNum(r?.sharpe)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Max DD</div>
                          <div className="tabular-nums" style={{ color: COLORS.red }}>
                            {fmtPct(r?.maxDrawdown)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Trades</div>
                          <div className="tabular-nums">{r?.trades?.length ?? 0}</div>
                        </div>
                      </div>
                      <button type="button"
                              onClick={() => {
                                setBuilderFactors(p.factors.map(f => ({ ...f })));
                                setBuilderThreshold(p.threshold);
                                setMode('builder');
                              }}
                              className="mt-2 px-2 py-1 rounded text-[10.5px] hover:bg-white/[0.04] transition-colors"
                              style={{ color: COLORS.mint, border: `1px solid ${COLORS.border}` }}>
                        Open in Builder →
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {mode === 'builder' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
            <div className="rounded-md border p-4"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="text-[11px] uppercase tracking-wider mb-3" style={{ color: COLORS.textMute }}>
                Factor library
              </div>
              <div className="space-y-2">
                {FACTOR_LIBRARY.map(f => {
                  const picked = builderFactors.find(b => b.id === f.id);
                  return (
                    <div key={f.id} className="rounded-md border p-2.5"
                         style={{
                           borderColor: picked ? COLORS.mint : COLORS.border,
                           background:  picked ? `${COLORS.mint}0F` : COLORS.bg,
                         }}>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox"
                               checked={!!picked}
                               onChange={() => toggleBuilderFactor(f.id)}
                               className="mt-1"
                               style={{ accentColor: COLORS.mint }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium" style={{ color: COLORS.text }}>
                            {f.label}
                          </div>
                          <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
                            {f.description}
                          </div>
                        </div>
                      </label>
                      {picked && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[10px]" style={{ color: COLORS.textMute }}>Weight</span>
                          <input type="range" min="0" max="1" step="0.05"
                                 value={picked.weight}
                                 onChange={(e) => setBuilderWeight(f.id, Number(e.target.value))}
                                 className="flex-1"
                                 style={{ accentColor: COLORS.mint }} />
                          <span className="text-[11px] tabular-nums w-10" style={{ color: COLORS.text }}>
                            {picked.weight.toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                  Entry threshold
                </span>
                <input type="range" min="0" max="1" step="0.05"
                       value={builderThreshold}
                       onChange={(e) => setBuilderThreshold(Number(e.target.value))}
                       className="flex-1"
                       style={{ accentColor: COLORS.mint }} />
                <span className="text-[11px] tabular-nums w-10" style={{ color: COLORS.text }}>
                  {builderThreshold.toFixed(2)}
                </span>
              </div>
              <div className="text-[10px] mt-1" style={{ color: COLORS.textMute }}>
                Composite score must exceed this to enter; falls back below threshold − 0.1 to exit.
              </div>
            </div>

            {/* Right pane — backtest result */}
            <div className="rounded-md border p-4"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                  Backtest result
                </div>
                {builderFactors.length > 0 && (
                  <button type="button"
                          onClick={() => {
                            const name = prompt('Save strategy as:');
                            if (!name) return;
                            saveCurrentStrategy(name, {
                              mode: 'builder',
                              factors: builderFactors,
                              threshold: builderThreshold,
                            });
                          }}
                          className="px-2 py-0.5 rounded text-[10px]"
                          style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                    Save
                  </button>
                )}
              </div>
              {builderFactors.length === 0 && (
                <div className="text-[11.5px] py-6 text-center" style={{ color: COLORS.textMute }}>
                  Select at least one factor to see results.
                </div>
              )}
              {builderResult && builderFactors.length > 0 && (
                <>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="rounded-md border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Total return</div>
                      <div className="text-[15px] font-medium tabular-nums"
                           style={{ color: builderResult.totalReturn >= 0 ? COLORS.green : COLORS.red }}>
                        {fmtPct(builderResult.totalReturn)}
                      </div>
                    </div>
                    <div className="rounded-md border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sharpe</div>
                      <div className="text-[15px] font-medium tabular-nums"
                           style={{ color: builderResult.sharpe > 1 ? COLORS.green : COLORS.text }}>
                        {fmtNum(builderResult.sharpe)}
                      </div>
                    </div>
                    <div className="rounded-md border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Max DD</div>
                      <div className="text-[15px] font-medium tabular-nums" style={{ color: COLORS.red }}>
                        {fmtPct(builderResult.maxDrawdown)}
                      </div>
                    </div>
                    <div className="rounded-md border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Trades</div>
                      <div className="text-[15px] font-medium tabular-nums">
                        {builderResult.trades?.length ?? 0}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-md border" style={{ borderColor: COLORS.border, background: COLORS.bg, height: 240 }}>
                    {builderResult.equity && builderResult.equity.length > 0 && (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={builderResult.equity} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                          <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="idx" stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                                 interval={Math.max(0, Math.floor(builderResult.equity.length / 6))} />
                          <YAxis stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                                 domain={['auto', 'auto']}
                                 tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                          <Tooltip
                            contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }}
                            labelStyle={{ color: COLORS.text }}
                            formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Equity']} />
                          <Line type="monotone"
                                dataKey="equity"
                                stroke={COLORS.mint}
                                strokeWidth={1.5}
                                dot={false}
                                isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {mode === 'code' && (
          <div className="space-y-4">
            {/* Top bar — template picker + import/export + AI assist + save + run */}
            <div className="rounded-md border p-3"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <FileCode size={14} style={{ color: COLORS.textDim }} />
                  <select onChange={(e) => { if (e.target.value) loadCodeTemplate(e.target.value); e.target.value = ''; }}
                          defaultValue=""
                          className="px-2 py-1.5 rounded text-[11.5px] outline-none"
                          style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}
                          title="Load a starter template">
                    <option value="">Load template…</option>
                    {QUANT_TEMPLATES.map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="h-5 w-px" style={{ background: COLORS.border }} />
                <button type="button"
                        onClick={() => codeFileInputRef.current?.click()}
                        className="px-2 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-white/[0.04]"
                        style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}
                        title="Import from .js file">
                  Import
                </button>
                <input ref={codeFileInputRef} type="file" accept=".js,.txt" hidden
                       onChange={onCodeFileSelected} />
                <button type="button"
                        onClick={exportCodeFile}
                        disabled={!codeText.trim()}
                        className="px-2 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-white/[0.04] disabled:opacity-40"
                        style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}
                        title="Download as .js file">
                  <Download size={11} />
                  Export
                </button>
                <div className="h-5 w-px" style={{ background: COLORS.border }} />
                <button type="button"
                        onClick={requestCodeAiAssist}
                        disabled={!codeText.trim() || codeAiBusy}
                        className="px-2 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-white/[0.04] disabled:opacity-40"
                        style={{
                          color: '#9F88FF',
                          border: '1px solid rgba(159,136,255,0.30)',
                          background: 'rgba(159,136,255,0.06)',
                        }}
                        title="Ask the active AI provider to suggest an improvement">
                  <Wand2 size={11} />
                  {codeAiBusy ? 'Thinking…' : 'AI improve'}
                </button>
                <div className="h-5 w-px" style={{ background: COLORS.border }} />
                <button type="button"
                        onClick={() => setCodeShowHelp(s => !s)}
                        className="px-2 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-white/[0.04]"
                        style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}
                        title="Toggle API reference">
                  {codeShowHelp ? 'Hide help' : 'Show help'}
                </button>
                <div className="ml-auto flex items-center gap-1.5">
                  <button type="button"
                          onClick={() => {
                            const name = prompt('Save strategy as:');
                            if (!name) return;
                            saveCurrentStrategy(name, { mode: 'code', code: codeText });
                          }}
                          disabled={!codeText.trim()}
                          className="px-2 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-white/[0.04] disabled:opacity-40"
                          style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                    <SaveIcon size={11} />
                    Save
                  </button>
                  <button type="button"
                          onClick={runCode}
                          disabled={barsStatus !== 'ok'}
                          className="px-3 py-1.5 rounded text-[11px] font-medium inline-flex items-center gap-1 disabled:opacity-40"
                          style={{ background: COLORS.mint, color: COLORS.bg }}>
                    <Play size={11} fill="currentColor" />
                    Run
                  </button>
                  <button type="button"
                          onClick={runStepDebugger}
                          disabled={barsStatus !== 'ok' || !codeText.trim()}
                          className="px-2 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-white/[0.04] disabled:opacity-40"
                          style={{ color: '#7AC8FF', border: `1px solid rgba(122,200,255,0.30)`, background: 'rgba(122,200,255,0.04)' }}
                          title="Step through bar-by-bar">
                    Step debug
                  </button>
                  <label className="px-2 py-1.5 rounded text-[11px] inline-flex items-center gap-1.5 cursor-pointer"
                         style={{
                           color: codeStrictMode ? COLORS.red : COLORS.textDim,
                           border: `1px solid ${codeStrictMode ? COLORS.red : COLORS.border}`,
                           background: codeStrictMode ? 'rgba(255,85,119,0.04)' : 'transparent',
                         }}
                         title="Strict mode wraps `bars` in a Proxy that throws if you try to read bars[k] where k > current i. Catches lookahead bias the static analyzer misses (computed indices, runtime patterns).">
                    <input type="checkbox"
                           checked={codeStrictMode}
                           onChange={(e) => setCodeStrictMode(e.target.checked)}
                           className="cursor-pointer"
                           style={{ accentColor: COLORS.red }} />
                    Strict mode
                  </label>
                </div>
              </div>
            </div>

            {/* Lookahead bias warnings — static analysis */}
            {codeLookaheadWarnings.length > 0 && (
              <div className="rounded-md border p-3"
                   style={{ borderColor: COLORS.red, background: 'rgba(255,85,119,0.04)' }}>
                <div className="text-[10px] uppercase tracking-wider mb-1 inline-flex items-center gap-1.5"
                     style={{ color: COLORS.red }}>
                  <span>⚠</span> Lookahead bias detected — backtest results will be unrealistic
                </div>
                <div className="space-y-1">
                  {codeLookaheadWarnings.map((w, i) => (
                    <div key={i} className="text-[11px]" style={{ color: COLORS.text }}>
                      <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded mr-2"
                            style={{ background: 'rgba(255,85,119,0.08)', color: COLORS.red }}>
                        L{w.line}:{w.col}
                      </span>
                      <span className="font-mono text-[10.5px]" style={{ color: COLORS.textDim }}>{w.snippet}</span>
                      <span className="ml-2" style={{ color: COLORS.textDim }}>{w.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step debugger — appears below editor when stepTrace is populated */}
            {stepTrace && stepTrace.length > 0 && (() => {
              const step = stepTrace[stepCursor];
              if (!step) return null;
              const dt = step.t ? new Date(step.t).toLocaleDateString() : `bar ${step.i}`;
              return (
                <div className="rounded-md border p-3"
                     style={{ borderColor: '#7AC8FF', background: 'rgba(122,200,255,0.04)' }}>
                  <div className="flex items-center gap-3 flex-wrap mb-3">
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: '#7AC8FF' }}>
                      Step debugger
                    </div>
                    <div className="text-[11px] tabular-nums" style={{ color: COLORS.text }}>
                      Bar {stepCursor + 1} / {stepTrace.length} · {dt}
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <button type="button"
                              onClick={() => setStepCursor(0)}
                              disabled={stepCursor === 0}
                              className="px-2 py-1 rounded text-[10.5px] hover:bg-white/[0.04] disabled:opacity-30"
                              style={{ color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                        ⏮ first
                      </button>
                      <button type="button"
                              onClick={() => setStepCursor(c => Math.max(0, c - 1))}
                              disabled={stepCursor === 0}
                              className="px-2 py-1 rounded text-[10.5px] hover:bg-white/[0.04] disabled:opacity-30"
                              style={{ color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                        ◂ prev
                      </button>
                      <button type="button"
                              onClick={() => setStepCursor(c => Math.min(stepTrace.length - 1, c + 1))}
                              disabled={stepCursor === stepTrace.length - 1}
                              className="px-2 py-1 rounded text-[10.5px] hover:bg-white/[0.04] disabled:opacity-30"
                              style={{ color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                        next ▸
                      </button>
                      <button type="button"
                              onClick={() => setStepCursor(stepTrace.length - 1)}
                              disabled={stepCursor === stepTrace.length - 1}
                              className="px-2 py-1 rounded text-[10.5px] hover:bg-white/[0.04] disabled:opacity-30"
                              style={{ color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                        last ⏭
                      </button>
                      <button type="button"
                              onClick={() => { setStepTrace(null); setStepCursor(0); }}
                              className="px-2 py-1 rounded text-[10.5px] hover:bg-white/[0.04]"
                              style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                        ✕ close
                      </button>
                    </div>
                  </div>
                  {/* Slider for fast scrubbing */}
                  <input type="range" min="0" max={stepTrace.length - 1} value={stepCursor}
                         onChange={(e) => setStepCursor(Number(e.target.value))}
                         className="w-full mb-3" style={{ accentColor: '#7AC8FF' }} />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>OHLC</div>
                      <div className="text-[10.5px] tabular-nums" style={{ color: COLORS.text }}>
                        O {step.bar.open?.toFixed(2)} · H {step.bar.high?.toFixed(2)}
                      </div>
                      <div className="text-[10.5px] tabular-nums" style={{ color: COLORS.text }}>
                        L {step.bar.low?.toFixed(2)} · C {step.bar.close?.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Strategy signal</div>
                      <div className="text-[12px] font-medium"
                           style={{ color: step.signal === 'enter' ? COLORS.green
                                         : step.signal === 'exit'  ? COLORS.red
                                         :                            COLORS.textDim }}>
                        {step.signal.toUpperCase()}
                      </div>
                      <div className="text-[10px]" style={{ color: COLORS.textMute }}>
                        Pos {step.pos.toFixed(2)} · Cash ${step.cash.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Equity</div>
                      <div className="text-[12px] font-medium tabular-nums" style={{ color: COLORS.text }}>
                        ${step.equity.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Indicators</div>
                      {Object.entries(step.indicators).map(([k, v]) => (
                        <div key={k} className="text-[10px] tabular-nums flex justify-between" style={{ color: COLORS.textDim }}>
                          <span>{k}</span>
                          <span style={{ color: COLORS.text }}>{v == null ? '—' : v.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* AI suggestion banner — shown after a successful AI assist call */}
            {codeAiSuggestion && (
              <div className="rounded-md border p-3"
                   style={{ borderColor: '#9F88FF', background: 'rgba(159,136,255,0.04)' }}>
                <div className="flex items-start gap-2 mb-2">
                  <Wand2 size={14} style={{ color: '#9F88FF', marginTop: 2 }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] uppercase tracking-wider" style={{ color: '#9F88FF' }}>
                      AI suggestion
                    </div>
                    <div className="text-[12px]" style={{ color: COLORS.text }}>
                      {codeAiSuggestion.summary}
                    </div>
                  </div>
                </div>
                <pre className="text-[10.5px] font-mono p-2 rounded overflow-x-auto max-h-[200px]"
                     style={{ background: COLORS.bg, color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>{codeAiSuggestion.code}</pre>
                <div className="flex items-center gap-2 mt-2">
                  <button type="button"
                          onClick={() => {
                            setCodeText(codeAiSuggestion.code);
                            setCodeAiSuggestion(null);
                            setCodeResult(null);
                            setCodeError(null);
                            setCodeLogs([]);
                          }}
                          className="px-2.5 py-1 rounded text-[11px] font-medium"
                          style={{ background: '#9F88FF', color: COLORS.bg }}>
                    Apply
                  </button>
                  <button type="button"
                          onClick={() => setCodeAiSuggestion(null)}
                          className="px-2.5 py-1 rounded text-[11px]"
                          style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Help panel — collapsed by default */}
            {codeShowHelp && (
              <div className="rounded-md border p-3"
                   style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                  API reference
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {CODE_HELP_REFERENCE.map(group => (
                    <div key={group.group} className="rounded-md border p-2"
                         style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.mint }}>
                        {group.group}
                      </div>
                      <div className="space-y-1.5">
                        {group.entries.map((e, idx) => (
                          <div key={idx}>
                            <code className="text-[10.5px] font-mono px-1 py-0.5 rounded"
                                  style={{ background: 'rgba(255,255,255,0.04)', color: COLORS.text }}>
                              {e.sig}
                            </code>
                            <div className="text-[10px] mt-0.5" style={{ color: COLORS.textMute }}>
                              {e.desc}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 px-2 py-1.5 rounded text-[10px]"
                     style={{ background: 'rgba(122,200,255,0.06)', color: '#7AC8FF', border: '1px solid rgba(122,200,255,0.20)' }}>
                  Code runs sandboxed via Function() — exceptions return 'hold' silently. Console output is captured and shown below the editor (max 200 entries per run).
                </div>
              </div>
            )}

            {/* Editor + result side-by-side */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
              <div className="rounded-md border p-3"
                   style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <CodeIcon size={12} style={{ color: COLORS.textDim }} />
                    <div className="text-[11px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                      Strategy code
                    </div>
                  </div>
                  <div className="text-[10px] tabular-nums" style={{ color: COLORS.textMute }}>
                    {codeText.split('\n').length} lines · {codeText.length} chars
                  </div>
                </div>
                <textarea value={codeText}
                          onChange={(e) => setCodeText(e.target.value)}
                          spellCheck={false}
                          className="w-full font-mono text-[11px] outline-none resize-y rounded p-3"
                          style={{
                            background: COLORS.bg,
                            color: COLORS.text,
                            border: `1px solid ${COLORS.border}`,
                            minHeight: 420,
                            tabSize: 2,
                            lineHeight: 1.55,
                          }}
                          onKeyDown={(e) => {
                            // Tab inserts 2 spaces instead of changing focus
                            if (e.key === 'Tab') {
                              e.preventDefault();
                              const target = e.target;
                              const start = target.selectionStart;
                              const end   = target.selectionEnd;
                              const next = codeText.substring(0, start) + '  ' + codeText.substring(end);
                              setCodeText(next);
                              setTimeout(() => {
                                target.selectionStart = target.selectionEnd = start + 2;
                              }, 0);
                            }
                            // Cmd/Ctrl+Enter runs
                            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                              e.preventDefault();
                              runCode();
                            }
                          }} />
                <div className="text-[10px] mt-1" style={{ color: COLORS.textMute }}>
                  <kbd className="px-1 rounded" style={{ border: `1px solid ${COLORS.border}` }}>Tab</kbd> = 2 spaces
                  {' · '}
                  <kbd className="px-1 rounded" style={{ border: `1px solid ${COLORS.border}` }}>{navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}↩</kbd> to run
                </div>
                {codeError && (
                  <div className="mt-2 px-2 py-1.5 rounded text-[11px]"
                       style={{ background: 'rgba(255,85,119,0.10)', color: COLORS.red, border: '1px solid rgba(255,85,119,0.30)' }}>
                    <strong>Error:</strong> {codeError}
                  </div>
                )}

                {/* Console output panel */}
                <div className="mt-3 rounded-md border"
                     style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                  <div className="px-2.5 py-1.5 border-b flex items-center justify-between"
                       style={{ borderColor: COLORS.border }}>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                      Console · {codeLogs.length} {codeLogs.length === 1 ? 'entry' : 'entries'}
                    </div>
                    {codeLogs.length > 0 && (
                      <button type="button"
                              onClick={() => setCodeLogs([])}
                              className="px-1.5 py-0.5 rounded text-[10px] inline-flex items-center gap-1 hover:bg-white/[0.04]"
                              style={{ color: COLORS.textDim }}
                              title="Clear console">
                        <Trash2 size={10} />
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="max-h-[180px] overflow-y-auto font-mono text-[10.5px]"
                       style={{ color: COLORS.textDim }}>
                    {codeLogs.length === 0 ? (
                      <div className="px-2.5 py-3 text-center" style={{ color: COLORS.textMute }}>
                        No console output yet. Use <code>log('msg', value)</code> in your strategy.
                      </div>
                    ) : (
                      codeLogs.map((entry, idx) => (
                        <div key={idx}
                             className="px-2.5 py-1 border-b"
                             style={{
                               borderColor: 'rgba(255,255,255,0.03)',
                               color: entry.level === 'error' ? COLORS.red
                                    : entry.level === 'warn'  ? '#FFB84D'
                                    : COLORS.textDim,
                             }}>
                          <span style={{ color: COLORS.textMute, marginRight: 6 }}>
                            {entry.level === 'error' ? '✕' : entry.level === 'warn' ? '!' : '›'}
                          </span>
                          {entry.line != null && (
                            <span className="px-1 rounded mr-2"
                                  style={{ background: 'rgba(122,200,255,0.10)', color: '#7AC8FF', fontSize: 9 }}
                                  title={`Line ${entry.line} in your code`}>
                              L{entry.line}
                            </span>
                          )}
                          {entry.barIdx != null && entry.barIdx >= 0 && (
                            <span className="px-1 rounded mr-2"
                                  style={{ background: 'rgba(159,136,255,0.10)', color: '#9F88FF', fontSize: 9 }}
                                  title={`Bar index when emitted`}>
                              i={entry.barIdx}
                            </span>
                          )}
                          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{entry.msg}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Right pane — backtest result */}
              <div className="rounded-md border p-4"
                   style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                <div className="text-[11px] uppercase tracking-wider mb-3" style={{ color: COLORS.textMute }}>
                  Result
                </div>
                {!codeResult && (
                  <div className="text-[11.5px] py-6 text-center" style={{ color: COLORS.textMute }}>
                    Click <span style={{ color: COLORS.mint }}>Run</span> (or {navigator.platform?.includes('Mac') ? '⌘↩' : 'Ctrl+Enter'}) to execute the strategy.
                  </div>
                )}
                {codeResult && (
                  <>
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <div className="rounded-md border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                        <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Total return</div>
                        <div className="text-[15px] font-medium tabular-nums"
                             style={{ color: codeResult.totalReturn >= 0 ? COLORS.green : COLORS.red }}>
                          {fmtPct(codeResult.totalReturn)}
                        </div>
                      </div>
                      <div className="rounded-md border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                        <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sharpe</div>
                        <div className="text-[15px] font-medium tabular-nums"
                             style={{ color: codeResult.sharpe > 1 ? COLORS.green : COLORS.text }}>
                          {fmtNum(codeResult.sharpe)}
                        </div>
                      </div>
                      <div className="rounded-md border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                        <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sortino</div>
                        <div className="text-[15px] font-medium tabular-nums">{fmtNum(codeResult.sortino)}</div>
                      </div>
                      <div className="rounded-md border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                        <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Max DD</div>
                        <div className="text-[15px] font-medium tabular-nums" style={{ color: COLORS.red }}>
                          {fmtPct(codeResult.maxDrawdown)}
                        </div>
                      </div>
                      <div className="rounded-md border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                        <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Trades</div>
                        <div className="text-[15px] font-medium tabular-nums">{codeResult.trades?.length ?? 0}</div>
                      </div>
                      <div className="rounded-md border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                        <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Win rate</div>
                        <div className="text-[15px] font-medium tabular-nums">{fmtPct(codeResult.winRate)}</div>
                      </div>
                      <div className="rounded-md border p-2 col-span-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                        <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Profit factor</div>
                        <div className="text-[13px] font-medium tabular-nums"
                             style={{ color: (codeResult.profitFactor || 0) > 1.5 ? COLORS.green
                                           : (codeResult.profitFactor || 0) > 1   ? COLORS.text
                                           : COLORS.red }}>
                          {fmtNum(codeResult.profitFactor)}
                          <span className="ml-2 text-[9.5px]" style={{ color: COLORS.textMute }}>
                            {(codeResult.profitFactor || 0) > 2   ? 'excellent'
                          : (codeResult.profitFactor || 0) > 1.5  ? 'good'
                          : (codeResult.profitFactor || 0) > 1    ? 'profitable'
                          : 'unprofitable'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-md border" style={{ borderColor: COLORS.border, background: COLORS.bg, height: 200 }}>
                      {codeResult.equity && codeResult.equity.length > 0 && (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={codeResult.equity} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                            <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="idx" stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                                   interval={Math.max(0, Math.floor(codeResult.equity.length / 6))} />
                            <YAxis stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                                   domain={['auto', 'auto']}
                                   tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                            <Tooltip
                              contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }}
                              formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Equity']} />
                            <Line dataKey="equity" stroke={COLORS.mint} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {mode === 'walkforward' && (
          <div className="space-y-4">
            <div className="rounded-md border p-4"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                Walk-forward validation
              </div>
              <div className="text-[10.5px] mb-3 px-2.5 py-1.5 rounded"
                   style={{ background: 'rgba(122,200,255,0.06)', color: '#7AC8FF', border: '1px solid rgba(122,200,255,0.20)' }}>
                Splits the bar series into <strong>in-sample</strong> (early bars, used to "tune" the strategy if you've been iterating on the Builder/Code tabs) and <strong>out-of-sample</strong> (later bars, never seen during tuning). If OOS Sharpe is much worse than IS Sharpe, the strategy is curve-fit. Robust strategies show OOS performance close to (or even better than) in-sample.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                    Strategy source
                  </div>
                  <select value={wfStrategySource}
                          onChange={(e) => setWfStrategySource(e.target.value)}
                          className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none"
                          style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                    <option value="builder">From Builder tab ({builderFactors.length} factors)</option>
                    <option value="code">From Code tab</option>
                  </select>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                    IS / OOS split
                  </div>
                  <input type="range" min="0.5" max="0.9" step="0.05"
                         value={wfSplitRatio}
                         onChange={(e) => setWfSplitRatio(Number(e.target.value))}
                         className="w-full"
                         style={{ accentColor: COLORS.mint }} />
                  <div className="text-[10px] mt-0.5" style={{ color: COLORS.textDim }}>
                    {(wfSplitRatio * 100).toFixed(0)}% in-sample · {((1 - wfSplitRatio) * 100).toFixed(0)}% out-of-sample
                  </div>
                </div>
                <div className="flex items-end">
                  <button type="button"
                          onClick={runWalkForwardNow}
                          disabled={barsStatus !== 'ok'}
                          className="w-full px-3 py-2 rounded text-[12px] font-medium disabled:opacity-40"
                          style={{ background: COLORS.mint, color: COLORS.bg }}>
                    Run validation
                  </button>
                </div>
              </div>
            </div>

            {wfResult && (
              <>
                {/* Verdict pill */}
                <div className="rounded-md border p-3 flex items-center justify-between flex-wrap gap-2"
                     style={{
                       borderColor: wfResult.summary.verdict === 'robust'      ? COLORS.green
                                 : wfResult.summary.verdict === 'modest-decay' ? COLORS.mint
                                 : wfResult.summary.verdict === 'fragile'      ? '#FFB84D'
                                 : COLORS.red,
                       background: COLORS.surface,
                     }}>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                      Overfit verdict
                    </div>
                    <div className="text-[16px] font-medium uppercase tracking-wider"
                         style={{
                           color: wfResult.summary.verdict === 'robust'      ? COLORS.green
                                : wfResult.summary.verdict === 'modest-decay' ? COLORS.mint
                                : wfResult.summary.verdict === 'fragile'      ? '#FFB84D'
                                : COLORS.red,
                         }}>
                      {wfResult.summary.verdict}
                    </div>
                  </div>
                  <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
                    OOS / IS Sharpe ratio: <span style={{ color: COLORS.text, fontWeight: 600 }}>{fmtNum(wfResult.summary.overfitRatio)}</span>
                    {' · '}
                    {wfResult.summary.verdict === 'robust' && '> 0.7 — strategy generalizes well'}
                    {wfResult.summary.verdict === 'modest-decay' && '0.3–0.7 — some out-of-sample decay'}
                    {wfResult.summary.verdict === 'fragile' && '0.0–0.3 — likely overfit'}
                    {wfResult.summary.verdict === 'broken' && '< 0 — OOS lost money; almost certainly overfit'}
                  </div>
                </div>
                {/* Side-by-side IS vs OOS */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {[
                    { label: 'In-sample',     r: wfResult.is,  color: COLORS.mintDim },
                    { label: 'Out-of-sample', r: wfResult.oos, color: COLORS.mint },
                  ].map(panel => (
                    <div key={panel.label} className="rounded-md border p-3"
                         style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                      <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                        {panel.label}
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Total ret</div>
                          <div className="tabular-nums" style={{ color: panel.r.totalReturn >= 0 ? COLORS.green : COLORS.red }}>
                            {fmtPct(panel.r.totalReturn)}
                          </div>
                        </div>
                        <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sharpe</div>
                          <div className="tabular-nums">{fmtNum(panel.r.sharpe)}</div>
                        </div>
                        <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Max DD</div>
                          <div className="tabular-nums" style={{ color: COLORS.red }}>{fmtPct(panel.r.maxDrawdown)}</div>
                        </div>
                        <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Trades</div>
                          <div className="tabular-nums">{panel.r.trades?.length ?? 0}</div>
                        </div>
                      </div>
                      <div className="rounded border" style={{ borderColor: COLORS.border, background: COLORS.bg, height: 160 }}>
                        {panel.r.equity?.length > 0 && (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={panel.r.equity} margin={{ top: 6, right: 6, bottom: 6, left: 0 }}>
                              <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="idx" stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                                     interval={Math.max(0, Math.floor(panel.r.equity.length / 6))} />
                              <YAxis stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                                     tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                              <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }} />
                              <Line dataKey="equity" stroke={panel.color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Overlay chart — IS + OOS equity curves stacked
                    end-to-end with split marker. Easier to spot regime
                    shifts than reading two side-by-side panels. */}
                {(() => {
                  const isEq = wfResult.is.equity || [];
                  const oosEq = wfResult.oos.equity || [];
                  if (isEq.length === 0 || oosEq.length === 0) return null;
                  // Continuous global index — append OOS after IS
                  const isStartEq = isEq[0]?.equity || 10000;
                  const isEndEq = isEq[isEq.length - 1]?.equity || isStartEq;
                  // Scale OOS so it picks up where IS ended (we re-anchor
                  // the OOS curve to the IS terminal equity for visual continuity)
                  const oosStartEq = oosEq[0]?.equity || isEndEq;
                  const oosScale = isEndEq / oosStartEq;
                  const combined = [
                    ...isEq.map(e => ({ idx: e.idx, isEquity: e.equity, oosEquity: null })),
                    ...oosEq.map(e => ({
                      idx: isEq.length + e.idx,
                      isEquity: null,
                      oosEquity: e.equity * oosScale,
                    })),
                  ];
                  return (
                    <div className="rounded-md border p-3"
                         style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                      <div className="text-[10px] uppercase tracking-wider mb-2 flex items-center gap-3" style={{ color: COLORS.textMute }}>
                        <span>Equity overlay (IS → OOS, OOS rescaled to continue from IS terminal)</span>
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block w-2.5 h-0.5" style={{ background: COLORS.mintDim }} />
                          IS
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block w-2.5 h-0.5" style={{ background: COLORS.mint }} />
                          OOS
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block w-px h-2.5" style={{ background: '#FFB84D' }} />
                          IS/OOS split
                        </span>
                      </div>
                      <div style={{ height: 220 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={combined} margin={{ top: 6, right: 6, bottom: 6, left: 0 }}>
                            <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="idx" stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                                   interval={Math.max(0, Math.floor(combined.length / 8))} />
                            <YAxis stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                                   tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                            <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }}
                                     formatter={(v) => v == null ? null : `$${Number(v).toFixed(2)}`} />
                            <ReferenceLine x={isEq.length - 1} stroke="#FFB84D" strokeDasharray="3 3"
                                          label={{ value: 'split', position: 'top', fill: '#FFB84D', fontSize: 9 }} />
                            <Line dataKey="isEquity"  stroke={COLORS.mintDim} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} name="IS" />
                            <Line dataKey="oosEquity" stroke={COLORS.mint}    strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} name="OOS" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

            {/* Monte Carlo permutation testing */}
            <div className="rounded-md border p-4"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                Monte Carlo permutation test (significance)
              </div>
              <div className="text-[10.5px] mb-3 px-2.5 py-1.5 rounded"
                   style={{ background: 'rgba(159,136,255,0.06)', color: '#9F88FF', border: '1px solid rgba(159,136,255,0.20)' }}>
                Tests whether the strategy's edge is statistically real or could be explained by random luck on this exact path. Shuffles bar-to-bar returns to break time-series structure (preserving the return distribution) and re-runs the strategy {mcNPerms} times. p-value &lt; 0.05 = strong evidence of edge; &gt; 0.20 = likely random.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                    Permutations
                  </div>
                  <select value={mcNPerms}
                          onChange={(e) => setMcNPerms(Number(e.target.value))}
                          className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none"
                          style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                    <option value={50}>50 (~5s)</option>
                    <option value={100}>100 (~10s)</option>
                    <option value={250}>250 (~25s)</option>
                    <option value={500}>500 (~50s)</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button type="button"
                          onClick={runMonteCarloNow}
                          disabled={barsStatus !== 'ok' || mcStatus === 'running'}
                          className="w-full px-3 py-2 rounded text-[12px] font-medium disabled:opacity-40"
                          style={{ background: '#9F88FF', color: COLORS.bg }}>
                    {mcStatus === 'running'
                      ? `Running (${mcProgress.done}/${mcProgress.total})…`
                      : 'Run permutation test'}
                  </button>
                </div>
                <div className="flex items-end">
                  {mcStatus === 'running' && (
                    <div className="w-full">
                      <div className="text-[10px]" style={{ color: COLORS.textMute }}>
                        {mcProgress.done > 0 ? `${(mcProgress.done / mcProgress.total * 100).toFixed(0)}% done` : 'Starting…'}
                      </div>
                      <div className="h-1 rounded mt-1" style={{ background: COLORS.border }}>
                        <div className="h-full rounded transition-all"
                             style={{ width: `${(mcProgress.done / mcProgress.total) * 100}%`, background: '#9F88FF' }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {mcResult && (
                <div className="space-y-2">
                  <div className="rounded-md border p-3 flex items-center justify-between flex-wrap gap-2"
                       style={{
                         borderColor: mcResult.verdict === 'significant' ? COLORS.green
                                    : mcResult.verdict === 'marginal'    ? COLORS.mint
                                    : mcResult.verdict === 'weak'        ? '#FFB84D'
                                    :                                       COLORS.red,
                         background: COLORS.bg,
                       }}>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                        Significance verdict
                      </div>
                      <div className="text-[15px] font-medium uppercase tracking-wider"
                           style={{
                             color: mcResult.verdict === 'significant' ? COLORS.green
                                  : mcResult.verdict === 'marginal'    ? COLORS.mint
                                  : mcResult.verdict === 'weak'        ? '#FFB84D'
                                  :                                       COLORS.red,
                           }}>
                        {mcResult.verdict.replace('-', ' ')}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-right">
                      <div>
                        <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>p (Sharpe)</div>
                        <div className="text-[14px] tabular-nums font-medium"
                             style={{ color: mcResult.sharpePValue < 0.05 ? COLORS.green : mcResult.sharpePValue < 0.20 ? COLORS.text : COLORS.red }}>
                          {mcResult.sharpePValue.toFixed(3)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Real %ile</div>
                        <div className="text-[14px] tabular-nums">
                          {mcResult.realSharpePctile.toFixed(0)}th
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="text-[10.5px] px-3 py-2 rounded"
                       style={{ background: COLORS.bg, color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                    Real Sharpe: <strong style={{ color: COLORS.text }}>{mcResult.real.sharpe.toFixed(3)}</strong>.
                    Out of {mcResult.nPerms} random permutations, <strong style={{ color: COLORS.text }}>
                      {Math.round(mcResult.sharpePValue * mcResult.nPerms)}
                    </strong> achieved an equal or higher Sharpe ({(mcResult.sharpePValue * 100).toFixed(1)}%).
                    {mcResult.verdict === 'significant' && ' This is strong evidence the strategy has real edge — random reshuffling rarely beats it.'}
                    {mcResult.verdict === 'marginal' && ' Edge is plausible but not conclusive. Consider running more permutations or testing on different time periods.'}
                    {mcResult.verdict === 'weak' && ' Suggestive of edge but not strong. Could easily flip with different data.'}
                    {mcResult.verdict === 'no-edge' && ' Random reshuffles produce similar or better results too often. Likely no real edge — be cautious.'}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {mode === 'crosssec' && (
          <div className="space-y-4">
            <div className="rounded-md border p-4"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                Cross-sectional factor strategy
              </div>
              <div className="text-[10.5px] mb-3 px-2.5 py-1.5 rounded"
                   style={{ background: 'rgba(122,200,255,0.06)', color: '#7AC8FF', border: '1px solid rgba(122,200,255,0.20)' }}>
                Ranks a basket of tickers by a single factor each rebalance bar. Long the top quintile, optionally short the bottom (long-short mode). Backtested on aligned daily bars from Polygon.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div className="sm:col-span-2">
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                    Universe (comma-separated)
                  </div>
                  <input type="text"
                         value={csBasket}
                         onChange={(e) => setCsBasket(e.target.value)}
                         className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none font-mono"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                </div>
                <div className="sm:col-span-2">
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                    Ranking factor{csFactors.length > 1 ? 's (composite, z-normalized within cross-section)' : ''}
                  </div>
                  <div className="space-y-1.5">
                    {FACTOR_LIBRARY.map(f => {
                      const picked = csFactors.find(c => c.id === f.id);
                      return (
                        <div key={f.id} className="rounded-md border p-2"
                             style={{
                               borderColor: picked ? COLORS.mint : COLORS.border,
                               background: picked ? `${COLORS.mint}0F` : COLORS.bg,
                             }}>
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input type="checkbox" checked={!!picked}
                                   onChange={() => toggleCsFactor(f.id)}
                                   className="mt-0.5"
                                   style={{ accentColor: COLORS.mint }} />
                            <div className="flex-1 min-w-0">
                              <div className="text-[11.5px]" style={{ color: COLORS.text }}>{f.label}</div>
                              <div className="text-[10px]" style={{ color: COLORS.textMute }}>{f.description}</div>
                            </div>
                            {picked && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <input type="range" min="0" max="1" step="0.05"
                                       value={picked.weight}
                                       onChange={(e) => setCsFactorWeight(f.id, Number(e.target.value))}
                                       onClick={(e) => e.stopPropagation()}
                                       className="w-20"
                                       style={{ accentColor: COLORS.mint }} />
                                <span className="text-[10px] tabular-nums w-7" style={{ color: COLORS.text }}>
                                  {picked.weight.toFixed(2)}
                                </span>
                              </div>
                            )}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Mode</div>
                  <select value={csMode}
                          onChange={(e) => setCsMode(e.target.value)}
                          className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none"
                          style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                    <option value="long-only">Long-only (top quintile)</option>
                    <option value="long-short">Long-short (top &amp; bottom)</option>
                  </select>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Quintile</div>
                  <select value={csQuintile}
                          onChange={(e) => setCsQuintile(Number(e.target.value))}
                          className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none"
                          style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                    <option value="0.1">Decile (top 10%)</option>
                    <option value="0.2">Quintile (top 20%)</option>
                    <option value="0.33">Tercile (top 33%)</option>
                  </select>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Rebalance</div>
                  <select value={csRebalance}
                          onChange={(e) => setCsRebalance(e.target.value)}
                          className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none"
                          style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              {/* Sector neutralization + rank-IC toggles */}
              <div className="mt-3 space-y-2">
                <label className="flex items-center gap-2 text-[11.5px] cursor-pointer" style={{ color: COLORS.text }}>
                  <input type="checkbox"
                         checked={csSectorNeutral}
                         onChange={(e) => setCsSectorNeutral(e.target.checked)}
                         style={{ accentColor: COLORS.mint }} />
                  <span>Sector-neutral z-normalization</span>
                  <span className="text-[10px]" style={{ color: COLORS.textMute }}>
                    z-score within each sector instead of across all tickers — neutralizes sector-rotation effects
                  </span>
                </label>
                <label className="flex items-center gap-2 text-[11.5px] cursor-pointer"
                       style={{ color: csFactors.length < 2 ? COLORS.textMute : COLORS.text, opacity: csFactors.length < 2 ? 0.5 : 1 }}>
                  <input type="checkbox"
                         checked={csRankIcWeighting}
                         onChange={(e) => setCsRankIcWeighting(e.target.checked)}
                         disabled={csFactors.length < 2}
                         style={{ accentColor: COLORS.mint }} />
                  <span>Rank-IC weighting</span>
                  <span className="text-[10px]" style={{ color: COLORS.textMute }}>
                    {csFactors.length < 2
                      ? 'requires 2+ factors'
                      : 'weight each factor by its rolling rank-IC (Spearman corr with forward returns)'}
                  </span>
                </label>
                {csRankIcWeighting && csFactors.length >= 2 && (
                  <div className="ml-6 flex items-center gap-2 text-[10.5px]" style={{ color: COLORS.textDim }}>
                    <span>IC window (rebalance periods):</span>
                    <input type="number" min="3" max="60" step="1"
                           value={csRankIcWindow}
                           onChange={(e) => setCsRankIcWindow(Math.max(3, Math.min(60, Number(e.target.value) || 12)))}
                           className="w-16 px-1.5 py-0.5 rounded text-[10.5px] outline-none tabular-nums"
                           style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                    <span style={{ color: COLORS.textMute }}>
                      shorter = more reactive · longer = more stable
                    </span>
                  </div>
                )}
              </div>
              <button type="button"
                      onClick={runCrossSectionNow}
                      disabled={csStatus === 'loading'}
                      className="mt-3 px-3 py-2 rounded text-[12px] font-medium disabled:opacity-40"
                      style={{ background: COLORS.mint, color: COLORS.bg }}>
                {csStatus === 'loading' ? 'Fetching basket…' : 'Run cross-sectional backtest'}
              </button>
            </div>

            {csStatus === 'error' && (
              <div className="rounded-md border p-3 text-[11.5px]"
                   style={{ borderColor: COLORS.red, color: COLORS.red, background: COLORS.surface }}>
                {csResult?.error || 'Could not run cross-sectional backtest. Check your basket and Polygon API key.'}
              </div>
            )}

            {csStatus === 'ok' && csResult && !csResult.error && (
              <div className="rounded-md border p-4"
                   style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Total return</div>
                    <div className="tabular-nums font-medium"
                         style={{ color: csResult.totalReturn >= 0 ? COLORS.green : COLORS.red }}>
                      {fmtPct(csResult.totalReturn)}
                    </div>
                  </div>
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>CAGR</div>
                    <div className="tabular-nums">{fmtPct(csResult.cagr)}</div>
                  </div>
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sharpe</div>
                    <div className="tabular-nums font-medium"
                         style={{ color: (csResult.sharpe || 0) > 1 ? COLORS.green : COLORS.text }}>
                      {fmtNum(csResult.sharpe)}
                    </div>
                  </div>
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Max DD</div>
                    <div className="tabular-nums" style={{ color: COLORS.red }}>{fmtPct(csResult.maxDrawdown)}</div>
                  </div>
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Trades</div>
                    <div className="tabular-nums">{csResult.trades?.length ?? 0}</div>
                  </div>
                </div>
                <div className="rounded-md border" style={{ borderColor: COLORS.border, background: COLORS.bg, height: 240 }}>
                  {csResult.equity?.length > 0 && (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={csResult.equity} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                        <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="idx" stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                               interval={Math.max(0, Math.floor(csResult.equity.length / 6))} />
                        <YAxis stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                               tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                        <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }}
                                 formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Equity']} />
                        <Line dataKey="equity" stroke={COLORS.mint} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Factor IC summary — diagnostic card */}
                {Array.isArray(csResult.factorIcSummary) && csResult.factorIcSummary.some(s => s != null) && csFactors.length > 1 && (
                  <div className="mt-3 rounded-md border p-3"
                       style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                    <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                      Per-factor information coefficient (Spearman rank-IC of factor scores vs forward returns)
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px] tabular-nums">
                        <thead>
                          <tr style={{ color: COLORS.textMute, borderBottom: `1px solid ${COLORS.border}` }}>
                            <th className="text-left px-2 py-1">Factor</th>
                            <th className="text-right px-2">Mean IC</th>
                            <th className="text-right px-2">IC stdev</th>
                            <th className="text-right px-2">ICIR</th>
                            <th className="text-right px-2">Verdict</th>
                            <th className="text-right px-2">N</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csResult.factorIcSummary.map((s, idx) => {
                            if (!s) return null;
                            const fInfo = FACTOR_LIBRARY.find(f => f.id === csFactors[idx]?.id);
                            const verdict = Math.abs(s.meanIc) >= 0.05 && Math.abs(s.icir) >= 0.5 ? 'strong'
                                          : Math.abs(s.meanIc) >= 0.02 ? 'modest'
                                          :                                'weak';
                            const tone = verdict === 'strong' ? COLORS.green
                                       : verdict === 'modest' ? '#FFB84D'
                                       :                         COLORS.red;
                            return (
                              <tr key={idx} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                                <td className="px-2 py-1.5" style={{ color: COLORS.text }}>{fInfo?.label || csFactors[idx]?.id}</td>
                                <td className="text-right px-2" style={{ color: s.meanIc >= 0 ? COLORS.green : COLORS.red }}>
                                  {s.meanIc.toFixed(4)}
                                </td>
                                <td className="text-right px-2" style={{ color: COLORS.textDim }}>{s.stdIc.toFixed(4)}</td>
                                <td className="text-right px-2" style={{ color: COLORS.text }}>{s.icir.toFixed(2)}</td>
                                <td className="text-right px-2 uppercase" style={{ color: tone, fontSize: 10 }}>{verdict}</td>
                                <td className="text-right px-2" style={{ color: COLORS.textMute }}>{s.nObservations}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="text-[10.5px] mt-2" style={{ color: COLORS.textDim }}>
                      Information coefficient (IC) measures how well a factor's ranks predict future returns. |IC| ≥ 0.05 with ICIR ≥ 0.5 is a strong factor in cross-sectional equity. {csRankIcWeighting && <strong style={{ color: COLORS.mint }}>Active rank-IC weighting in use.</strong>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Saved strategies — visible across all modes */}
        {savedStrats.length > 0 && (
          <div className="mt-6 rounded-md border"
               style={{ borderColor: COLORS.border, background: COLORS.surface }}>
            <div className="px-3 py-2 border-b text-[11px] uppercase tracking-wider"
                 style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
              Saved strategies · {savedStrats.length}
            </div>
            <div className="max-h-[200px] overflow-y-auto">
              {savedStrats.map(s => (
                <div key={s.id}
                     className="flex items-center justify-between gap-2 px-3 py-1.5 border-b"
                     style={{ borderColor: COLORS.border }}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] truncate" style={{ color: COLORS.text }}>
                      {s.name}
                      <span className="ml-2 text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                            style={{ background: 'rgba(255,255,255,0.04)', color: COLORS.textMute }}>
                        {s.mode}
                      </span>
                    </div>
                    <div className="text-[10px]" style={{ color: COLORS.textDim }}>
                      saved {new Date(s.savedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button"
                            onClick={() => {
                              if (s.mode === 'code') {
                                setCodeText(s.code);
                                setMode('code');
                              } else if (s.mode === 'builder') {
                                setBuilderFactors(s.factors);
                                setBuilderThreshold(s.threshold);
                                setMode('builder');
                              }
                            }}
                            className="px-2 py-0.5 rounded text-[10px] hover:bg-white/[0.05]"
                            style={{ color: COLORS.mint }}>
                      Load
                    </button>
                    <button type="button"
                            onClick={() => deleteSavedStrategy(s.id)}
                            className="px-2 py-0.5 rounded text-[10px] hover:bg-white/[0.05]"
                            style={{ color: COLORS.textDim }}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === 'workflow' && (() => {
          const NODE_W = 200, NODE_H_BASE = 50, PORT_R = 5;
          // Compute node height based on max(inputs, outputs)
          const nodeHeight = (def) => {
            const portCount = Math.max(def.inputs?.length || 0, def.outputs?.length || 0);
            return NODE_H_BASE + Math.max(0, portCount - 1) * 22;
          };
          // Port position on a node (returns absolute SVG coords)
          const portPos = (node, side, idx) => {
            const def = WORKFLOW_NODE_REGISTRY[node.type];
            if (!def) return { x: 0, y: 0 };
            const list = side === 'in' ? def.inputs : def.outputs;
            const x = node.position.x + (side === 'in' ? 0 : NODE_W);
            const portsTop = node.position.y + 30;
            const y = portsTop + idx * 22 + (list.length === 1 ? (nodeHeight(def) - 30) / 2 : 0);
            return { x, y };
          };
          const findPortMeta = (nodeId, portId, side) => {
            const node = activeWorkflow.nodes.find(n => n.id === nodeId);
            if (!node) return null;
            const def = WORKFLOW_NODE_REGISTRY[node.type];
            if (!def) return null;
            const list = side === 'in' ? def.inputs : def.outputs;
            const idx = list.findIndex(p => p.id === portId);
            if (idx < 0) return null;
            const pos = portPos(node, side, idx);
            return { ...pos, def: list[idx], node };
          };
          // Bezier path between two points (left → right)
          const bezier = (a, b) => {
            const midX = (a.x + b.x) / 2;
            return `M ${a.x} ${a.y} C ${midX} ${a.y} ${midX} ${b.y} ${b.x} ${b.y}`;
          };
          const selectedNode = activeWorkflow.nodes.find(n => n.id === selectedNodeId);
          const selectedDef  = selectedNode ? WORKFLOW_NODE_REGISTRY[selectedNode.type] : null;

          return (
            <div className="space-y-4">
              {/* Top toolbar */}
              <div className="rounded-md border p-3 flex items-center gap-2 flex-wrap"
                   style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                <input type="text"
                       value={activeWorkflow.name}
                       onChange={(e) => updateActiveWorkflow(wf => ({ ...wf, name: e.target.value }))}
                       className="px-2 py-1.5 rounded text-[12px] outline-none"
                       style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, width: 220 }} />
                <button type="button"
                        onClick={() => setPaletteOpen(s => !s)}
                        className="px-2 py-1.5 rounded text-[11px] inline-flex items-center gap-1"
                        style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                  <Plus size={11} /> Add node
                </button>
                <button type="button" onClick={undoWorkflow}
                        disabled={wfHistory.undo.length === 0}
                        className="px-2 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-white/[0.04] disabled:opacity-30"
                        style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}
                        title="Undo (Cmd/Ctrl+Z)">
                  ↶ Undo
                  {wfHistory.undo.length > 0 && (
                    <span className="text-[9px] tabular-nums" style={{ color: COLORS.textMute }}>{wfHistory.undo.length}</span>
                  )}
                </button>
                <button type="button" onClick={redoWorkflow}
                        disabled={wfHistory.redo.length === 0}
                        className="px-2 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-white/[0.04] disabled:opacity-30"
                        style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}
                        title="Redo (Cmd/Ctrl+Shift+Z)">
                  ↷ Redo
                  {wfHistory.redo.length > 0 && (
                    <span className="text-[9px] tabular-nums" style={{ color: COLORS.textMute }}>{wfHistory.redo.length}</span>
                  )}
                </button>
                <button type="button" onClick={newWorkflow}
                        className="px-2 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-white/[0.04]"
                        style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                  New
                </button>
                <button type="button" onClick={saveCurrentWorkflow}
                        className="px-2 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-white/[0.04]"
                        style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                  <SaveIcon size={11} /> Save
                </button>
                <select onChange={(e) => {
                          if (!e.target.value) return;
                          const wf = workflows.find(w => w.id === e.target.value);
                          if (wf) loadWorkflow(wf);
                          e.target.value = '';
                        }}
                        defaultValue=""
                        className="px-2 py-1.5 rounded text-[11px] outline-none"
                        style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}
                        title="Load saved workflow">
                  <option value="">Load… ({workflows.length})</option>
                  {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10.5px]" style={{ color: COLORS.textMute }}>
                    {activeWorkflow.nodes.length} nodes · {activeWorkflow.edges.length} connections
                  </span>
                  <button type="button" onClick={runWorkflow}
                          disabled={barsStatus !== 'ok'}
                          className="px-3 py-1.5 rounded text-[11.5px] font-medium inline-flex items-center gap-1 disabled:opacity-40"
                          style={{ background: COLORS.mint, color: COLORS.bg }}>
                    <Play size={11} fill="currentColor" /> Run
                  </button>
                </div>
              </div>

              {/* Node palette — collapsible */}
              {palettOpen && (
                <div className="rounded-md border p-3"
                     style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                  <input type="text"
                         autoFocus
                         placeholder="Search nodes (rsi, sma, compare, …)"
                         value={paletteFilter}
                         onChange={(e) => setPaletteFilter(e.target.value)}
                         onKeyDown={(e) => {
                           if (e.key === 'Escape') {
                             setPaletteFilter('');
                             setPaletteOpen(false);
                           }
                         }}
                         className="w-full mb-3 px-2 py-1.5 rounded text-[11.5px] outline-none"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                  {['input', 'transform', 'output'].map(cat => {
                    const filtered = Object.values(WORKFLOW_NODE_REGISTRY)
                      .filter(d => d.category === cat)
                      .filter(d => !paletteFilter || d.label.toLowerCase().includes(paletteFilter.toLowerCase()) || d.id.toLowerCase().includes(paletteFilter.toLowerCase()));
                    if (filtered.length === 0 && paletteFilter) return null;
                    return (
                      <div key={cat} className="mb-3 last:mb-0">
                        <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.textMute }}>
                          {cat === 'input' ? 'Inputs' : cat === 'transform' ? 'Transforms' : 'Outputs'}
                          <span className="ml-2" style={{ color: COLORS.textDim }}>({filtered.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {filtered.map(d => (
                            <button key={d.id} type="button"
                                    onClick={() => { addWorkflowNode(d.id, { x: 220, y: 80 + Math.random() * 200 }); setPaletteOpen(false); setPaletteFilter(''); }}
                                    className="px-2 py-1.5 rounded text-[11px] hover:bg-white/[0.04]"
                                    style={{ color: COLORS.text, border: `1px solid ${COLORS.border}`, background: COLORS.bg }}>
                              {d.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {paletteFilter && Object.values(WORKFLOW_NODE_REGISTRY)
                    .filter(d => d.label.toLowerCase().includes(paletteFilter.toLowerCase()) || d.id.toLowerCase().includes(paletteFilter.toLowerCase()))
                    .length === 0 && (
                      <div className="text-[11px] text-center py-3" style={{ color: COLORS.textMute }}>
                        No nodes match "{paletteFilter}"
                      </div>
                    )}
                </div>
              )}

              {wfCompileError && (
                <div className="rounded-md border p-2 text-[11.5px]"
                     style={{ borderColor: COLORS.red, color: COLORS.red, background: 'rgba(255,85,119,0.06)' }}>
                  <strong>Compile error:</strong> {wfCompileError}
                </div>
              )}

              {/* Canvas + side panels */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
                <div className="rounded-md border overflow-hidden relative"
                     style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                  {/* Zoom controls overlay */}
                  <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
                    <button type="button"
                            onClick={() => setWfViewport(v => ({ ...v, zoom: Math.min(2.5, v.zoom * 1.2) }))}
                            className="w-7 h-7 rounded text-[12px] font-medium hover:bg-white/[0.06]"
                            style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                            title="Zoom in (or scroll)">
                      +
                    </button>
                    <button type="button"
                            onClick={() => setWfViewport(v => ({ ...v, zoom: Math.max(0.3, v.zoom / 1.2) }))}
                            className="w-7 h-7 rounded text-[12px] font-medium hover:bg-white/[0.06]"
                            style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                            title="Zoom out">
                      −
                    </button>
                    <button type="button"
                            onClick={() => setWfViewport({ panX: 0, panY: 0, zoom: 1 })}
                            className="w-7 h-7 rounded text-[10px] font-medium hover:bg-white/[0.06]"
                            style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                            title="Reset view">
                      ⌂
                    </button>
                    <div className="text-[9px] text-center tabular-nums px-1 py-0.5 rounded"
                         style={{ background: COLORS.bg, color: COLORS.textMute, border: `1px solid ${COLORS.border}` }}>
                      {(wfViewport.zoom * 100).toFixed(0)}%
                    </div>
                  </div>
                  <svg ref={wfCanvasRef}
                       width="100%" height="540"
                       viewBox={`${wfViewport.panX} ${wfViewport.panY} ${900 / wfViewport.zoom} ${540 / wfViewport.zoom}`}
                       style={{ background: 'rgba(0,0,0,0.15)', display: 'block', userSelect: 'none', cursor: isPanning ? 'grabbing' : 'default' }}
                       onWheel={(e) => {
                         // Zoom toward cursor
                         e.preventDefault();
                         if (!wfCanvasRef.current) return;
                         const rect = wfCanvasRef.current.getBoundingClientRect();
                         const cursorX = ((e.clientX - rect.left) / rect.width) * (900 / wfViewport.zoom) + wfViewport.panX;
                         const cursorY = ((e.clientY - rect.top) / rect.height) * (540 / wfViewport.zoom) + wfViewport.panY;
                         const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
                         const newZoom = Math.max(0.3, Math.min(2.5, wfViewport.zoom * factor));
                         // Anchor zoom at cursor
                         const newPanX = cursorX - ((e.clientX - rect.left) / rect.width) * (900 / newZoom);
                         const newPanY = cursorY - ((e.clientY - rect.top) / rect.height) * (540 / newZoom);
                         setWfViewport({ panX: newPanX, panY: newPanY, zoom: newZoom });
                       }}
                       onMouseDown={(e) => {
                         // Middle-click or shift+left-click = pan
                         if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
                           e.preventDefault();
                           setIsPanning(true);
                           panStartRef.current = {
                             x: e.clientX, y: e.clientY,
                             panX: wfViewport.panX, panY: wfViewport.panY,
                           };
                         }
                       }}
                       onMouseMove={(e) => {
                         if (isPanning) {
                           if (!wfCanvasRef.current) return;
                           const rect = wfCanvasRef.current.getBoundingClientRect();
                           const dx = (e.clientX - panStartRef.current.x) / rect.width * (900 / wfViewport.zoom);
                           const dy = (e.clientY - panStartRef.current.y) / rect.height * (540 / wfViewport.zoom);
                           setWfViewport(v => ({
                             ...v,
                             panX: panStartRef.current.panX - dx,
                             panY: panStartRef.current.panY - dy,
                           }));
                           return;
                         }
                         if (!wfCanvasRef.current) return;
                         const rect = wfCanvasRef.current.getBoundingClientRect();
                         // Convert client coords → canvas coords accounting for viewport
                         const x = (e.clientX - rect.left) / rect.width * (900 / wfViewport.zoom) + wfViewport.panX;
                         const y = (e.clientY - rect.top) / rect.height * (540 / wfViewport.zoom) + wfViewport.panY;
                         setMousePos({ x, y });
                         if (draggingNodeId) {
                           updateActiveWorkflow(wf => ({
                             ...wf,
                             nodes: wf.nodes.map(n => n.id === draggingNodeId
                               ? { ...n, position: { x: Math.max(0, x - NODE_W / 2), y: Math.max(0, y - 20) } }
                               : n),
                           }));
                         }
                       }}
                       onMouseUp={(e) => {
                         setIsPanning(false);
                         setDraggingNodeId(null);
                         // If we were drawing an edge and released over a port…
                         if (draggingFrom && hoverPort && hoverPort.side === 'in') {
                           addEdge(draggingFrom, { node: hoverPort.nodeId, port: hoverPort.portId });
                         }
                         setDraggingFrom(null);
                       }}
                       onMouseLeave={() => { setIsPanning(false); }}
                       onClick={(e) => {
                         // Don't deselect if we just finished panning
                         if (e.shiftKey || isPanning) return;
                         setSelectedNodeId(null);
                       }}>
                    {/* Grid */}
                    <defs>
                      <pattern id="wf-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke={COLORS.border} strokeWidth="0.5" opacity="0.5" />
                      </pattern>
                    </defs>
                    <rect width="900" height="540" fill="url(#wf-grid)" />

                    {/* Existing edges */}
                    {activeWorkflow.edges.map((edge, idx) => {
                      const from = findPortMeta(edge.from.node, edge.from.port, 'out');
                      const to   = findPortMeta(edge.to.node,   edge.to.port,   'in');
                      if (!from || !to) return null;
                      return (
                        <g key={idx} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); removeEdge(edge); }}>
                          <path d={bezier(from, to)} fill="none" stroke={COLORS.mint} strokeWidth="2" opacity="0.7" />
                          <path d={bezier(from, to)} fill="none" stroke="transparent" strokeWidth="10" />
                        </g>
                      );
                    })}

                    {/* In-progress edge while dragging */}
                    {draggingFrom && (() => {
                      const from = findPortMeta(draggingFrom.node, draggingFrom.port, 'out');
                      if (!from) return null;
                      return <path d={bezier(from, mousePos)} fill="none" stroke={COLORS.mint}
                                   strokeWidth="2" strokeDasharray="4 3" opacity="0.5" />;
                    })()}

                    {/* Nodes */}
                    {activeWorkflow.nodes.map(node => {
                      const def = WORKFLOW_NODE_REGISTRY[node.type];
                      if (!def) return null;
                      const isSelected = node.id === selectedNodeId;
                      const h = nodeHeight(def);
                      const tone = def.category === 'input'     ? '#7AC8FF'
                                 : def.category === 'transform' ? COLORS.mint
                                 :                                 '#FFB84D';
                      return (
                        <g key={node.id} transform={`translate(${node.position.x}, ${node.position.y})`}
                           onMouseDown={(e) => { e.stopPropagation(); setDraggingNodeId(node.id); setSelectedNodeId(node.id); }}
                           style={{ cursor: 'move' }}>
                          {/* Body */}
                          <rect width={NODE_W} height={h} rx="6"
                                fill={COLORS.surface}
                                stroke={isSelected ? tone : COLORS.border}
                                strokeWidth={isSelected ? 2 : 1} />
                          {/* Header bar */}
                          <rect width={NODE_W} height="22" rx="6" fill={tone} opacity="0.15" />
                          <text x="10" y="15" fontSize="11" fill={tone} fontWeight="600">
                            {def.label}
                          </text>
                          {/* Delete button (top right) */}
                          <g transform={`translate(${NODE_W - 18}, 4)`}
                             style={{ cursor: 'pointer' }}
                             onMouseDown={(e) => e.stopPropagation()}
                             onClick={(e) => { e.stopPropagation(); deleteWorkflowNode(node.id); }}>
                            <circle cx="7" cy="7" r="7" fill="rgba(255,85,119,0.10)" />
                            <text x="7" y="11" fontSize="10" textAnchor="middle" fill={COLORS.red}>×</text>
                          </g>
                          {/* Input ports */}
                          {def.inputs.map((p, idx) => {
                            const pp = portPos(node, 'in', idx);
                            const localY = pp.y - node.position.y;
                            return (
                              <g key={p.id}
                                 onMouseEnter={() => setHoverPort({ nodeId: node.id, portId: p.id, side: 'in' })}
                                 onMouseLeave={() => setHoverPort(null)}>
                                <circle cx="0" cy={localY} r={PORT_R}
                                        fill={p.type === 'boolean' ? '#FFB84D' : '#7AC8FF'}
                                        stroke={COLORS.border} strokeWidth="1" />
                                <text x="10" y={localY + 4} fontSize="10" fill={COLORS.textDim}>
                                  {p.label}
                                </text>
                              </g>
                            );
                          })}
                          {/* Output ports */}
                          {def.outputs.map((p, idx) => {
                            const pp = portPos(node, 'out', idx);
                            const localY = pp.y - node.position.y;
                            return (
                              <g key={p.id}
                                 onMouseDown={(e) => { e.stopPropagation(); setDraggingFrom({ node: node.id, port: p.id }); }}
                                 style={{ cursor: 'crosshair' }}>
                                <circle cx={NODE_W} cy={localY} r={PORT_R}
                                        fill={p.type === 'boolean' ? '#FFB84D' : '#7AC8FF'}
                                        stroke={COLORS.border} strokeWidth="1" />
                                <text x={NODE_W - 10} y={localY + 4} fontSize="10" fill={COLORS.textDim} textAnchor="end">
                                  {p.label}
                                </text>
                              </g>
                            );
                          })}
                        </g>
                      );
                    })}
                  </svg>
                  <div className="px-2 py-1 text-[9.5px] flex items-center justify-between"
                       style={{ background: COLORS.bg, color: COLORS.textMute, borderTop: `1px solid ${COLORS.border}` }}>
                    <span>Scroll to zoom · Shift+drag or middle-click to pan · ⌂ to reset</span>
                    {(wfViewport.panX !== 0 || wfViewport.panY !== 0 || wfViewport.zoom !== 1) && (
                      <button type="button"
                              onClick={() => setWfViewport({ panX: 0, panY: 0, zoom: 1 })}
                              className="text-[9.5px] hover:underline"
                              style={{ color: COLORS.mint }}>
                        reset view
                      </button>
                    )}
                  </div>
                </div>

                {/* Node config panel */}
                <div className="rounded-md border p-3"
                     style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                    {selectedNode ? selectedDef?.label : 'Properties'}
                  </div>
                  {!selectedNode && (
                    <div className="text-[11px]" style={{ color: COLORS.textMute }}>
                      Select a node to configure its parameters. Drag from output ports (right side, light blue/orange) to input ports (left side) to connect. Click a connection to delete it.
                    </div>
                  )}
                  {selectedNode && selectedDef && (
                    <>
                      {(selectedDef.params || []).length === 0 && (
                        <div className="text-[11px]" style={{ color: COLORS.textMute }}>
                          This node has no configurable parameters.
                        </div>
                      )}
                      {(selectedDef.params || []).map(p => (
                        <div key={p.id} className="mb-2.5">
                          <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                            {p.label}
                          </div>
                          {p.kind === 'number' && (
                            <input type="number"
                                   value={selectedNode.params?.[p.id] ?? p.default}
                                   onChange={(e) => updateNodeParam(selectedNode.id, p.id, Number(e.target.value))}
                                   step={p.step ?? 1}
                                   {...(p.min != null ? { min: p.min } : {})}
                                   {...(p.max != null ? { max: p.max } : {})}
                                   className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none tabular-nums"
                                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                          )}
                          {p.kind === 'select' && (
                            <select value={selectedNode.params?.[p.id] ?? p.default}
                                    onChange={(e) => updateNodeParam(selectedNode.id, p.id, e.target.value)}
                                    className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none"
                                    style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                              {(p.options || []).map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          )}
                          {p.kind === 'string' && (
                            <input type="text"
                                   value={selectedNode.params?.[p.id] ?? p.default ?? ''}
                                   onChange={(e) => updateNodeParam(selectedNode.id, p.id, e.target.value)}
                                   className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none"
                                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                          )}
                        </div>
                      ))}
                      <button type="button"
                              onClick={() => deleteWorkflowNode(selectedNode.id)}
                              className="mt-2 w-full px-2 py-1.5 rounded text-[11px] inline-flex items-center justify-center gap-1.5 hover:bg-white/[0.04]"
                              style={{ color: COLORS.red, border: '1px solid rgba(255,85,119,0.30)' }}>
                        <Trash2 size={11} />
                        Delete node
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Backtest result */}
              {wfBacktestResult && (
                <div className="rounded-md border p-3"
                     style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                  <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                    Workflow backtest
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
                    <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Total return</div>
                      <div className="tabular-nums font-medium"
                           style={{ color: wfBacktestResult.totalReturn >= 0 ? COLORS.green : COLORS.red }}>
                        {fmtPct(wfBacktestResult.totalReturn)}
                      </div>
                    </div>
                    <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sharpe</div>
                      <div className="tabular-nums">{fmtNum(wfBacktestResult.sharpe)}</div>
                    </div>
                    <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sortino</div>
                      <div className="tabular-nums">{fmtNum(wfBacktestResult.sortino)}</div>
                    </div>
                    <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Max DD</div>
                      <div className="tabular-nums" style={{ color: COLORS.red }}>{fmtPct(wfBacktestResult.maxDrawdown)}</div>
                    </div>
                    <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Trades</div>
                      <div className="tabular-nums">{wfBacktestResult.trades?.length ?? 0}</div>
                    </div>
                  </div>
                  <div className="rounded-md border" style={{ borderColor: COLORS.border, background: COLORS.bg, height: 200 }}>
                    {wfBacktestResult.equity?.length > 0 && (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={wfBacktestResult.equity} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                          <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="idx" stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                                 interval={Math.max(0, Math.floor(wfBacktestResult.equity.length / 6))} />
                          <YAxis stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                                 tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                          <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }}
                                   formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Equity']} />
                          <Line dataKey="equity" stroke={COLORS.mint} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              )}

              {/* Saved workflows list */}
              {workflows.length > 0 && (
                <div className="rounded-md border"
                     style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                  <div className="px-3 py-2 border-b text-[11px] uppercase tracking-wider"
                       style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
                    Saved workflows · {workflows.length}
                  </div>
                  {workflows.map(w => (
                    <div key={w.id}
                         className="flex items-center justify-between gap-2 px-3 py-1.5 border-b last:border-b-0"
                         style={{ borderColor: COLORS.border }}>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11.5px] truncate" style={{ color: COLORS.text }}>{w.name}</div>
                        <div className="text-[10px]" style={{ color: COLORS.textDim }}>
                          {w.nodes.length} nodes · saved {new Date(w.savedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => loadWorkflow(w)}
                                className="px-2 py-0.5 rounded text-[10px] hover:bg-white/[0.05]"
                                style={{ color: COLORS.mint }}>
                          Load
                        </button>
                        <button type="button" onClick={() => deleteSavedWorkflow(w.id)}
                                className="px-2 py-0.5 rounded text-[10px] hover:bg-white/[0.05]"
                                style={{ color: COLORS.textDim }}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {mode === 'pair' && (
          <div className="space-y-4">
            <div className="rounded-md border p-3"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                Pair trading — z-score-based mean-reversion
              </div>
              <p className="text-[11px] mb-3" style={{ color: COLORS.textDim }}>
                Trade the price ratio between two correlated tickers. Long ratio (long A / short B) when z-score is unusually low; short ratio when unusually high. Equal-weight 50/50 capital allocation per leg. Adapted from the Vibe-Trading pair-trading skill.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <div>
                  <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Ticker A</div>
                  <input type="text" value={pairTickerA}
                         onChange={(e) => setPairTickerA(e.target.value.toUpperCase())}
                         className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none font-mono"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                </div>
                <div>
                  <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Ticker B</div>
                  <input type="text" value={pairTickerB}
                         onChange={(e) => setPairTickerB(e.target.value.toUpperCase())}
                         className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none font-mono"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                </div>
                <div>
                  <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Lookback</div>
                  <input type="number" min="20" max="252" value={pairLookback}
                         onChange={(e) => setPairLookback(Number(e.target.value) || 60)}
                         className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none tabular-nums"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                </div>
                <div>
                  <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Entry |z|</div>
                  <input type="number" min="0.5" max="4" step="0.1" value={pairEntryZ}
                         onChange={(e) => setPairEntryZ(Number(e.target.value) || 2)}
                         className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none tabular-nums"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                </div>
                <div>
                  <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Exit |z|</div>
                  <input type="number" min="0" max="2" step="0.1" value={pairExitZ}
                         onChange={(e) => setPairExitZ(Number(e.target.value) || 0.5)}
                         className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none tabular-nums"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                <div>
                  <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                    Hedge method
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {[
                      { id: 'equal',       label: 'Equal weight (50/50)', desc: 'Naive log-ratio z-score' },
                      { id: 'ols',         label: 'OLS (static β)',        desc: 'One-shot Engle-Granger fit + ADF stationarity check' },
                      { id: 'rolling-ols', label: 'Rolling OLS',           desc: 'Re-fit β every bar (adaptive)' },
                    ].map(opt => (
                      <button key={opt.id} type="button"
                              onClick={() => setPairHedgeMethod(opt.id)}
                              className="px-2 py-1 rounded text-[10.5px] transition-colors"
                              style={{
                                background: pairHedgeMethod === opt.id ? `${COLORS.mint}1A` : COLORS.bg,
                                color: pairHedgeMethod === opt.id ? COLORS.mint : COLORS.textDim,
                                border: `1px solid ${pairHedgeMethod === opt.id ? COLORS.mint : COLORS.border}`,
                              }}
                              title={opt.desc}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="button" onClick={runPairTradeNow}
                        disabled={pairStatus === 'loading' || pairTickerA === pairTickerB}
                        className="px-3 py-1.5 rounded text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40"
                        style={{ background: COLORS.mint, color: COLORS.bg }}>
                  {pairStatus === 'loading' ? <RefreshCw size={11} className="animate-spin" /> : <Play size={11} fill="currentColor" />}
                  Backtest pair
                </button>
              </div>
            </div>

            {pairStatus === 'error' && (
              <div className="rounded-md border p-2 text-[11.5px]"
                   style={{ borderColor: COLORS.red, color: COLORS.red, background: 'rgba(255,85,119,0.06)' }}>
                Could not fetch data for both tickers. Check the symbols and try again.
              </div>
            )}

            {pairResult && !pairResult.error && (
              <>
                {/* Cointegration card — only shown for OLS hedge methods */}
                {pairResult.cointegration && (
                  <div className="rounded-md border p-3"
                       style={{
                         borderColor: pairResult.cointegration.isStationary ? COLORS.green : '#FFB84D',
                         background: pairResult.cointegration.isStationary ? 'rgba(31,178,107,0.04)' : 'rgba(255,184,77,0.04)',
                       }}>
                    <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
                      <div className="text-[11px] uppercase tracking-wider"
                           style={{ color: pairResult.cointegration.isStationary ? COLORS.green : '#FFB84D' }}>
                        Cointegration · Augmented Dickey-Fuller test
                      </div>
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-medium"
                            style={{
                              background: pairResult.cointegration.isStationary ? `${COLORS.green}20` : 'rgba(255,184,77,0.20)',
                              color: pairResult.cointegration.isStationary ? COLORS.green : '#FFB84D',
                            }}>
                        {pairResult.cointegration.criticalLevel === 0.01 ? 'Stationary @ 1% ✓✓✓'
                          : pairResult.cointegration.criticalLevel === 0.05 ? 'Stationary @ 5% ✓✓'
                          : pairResult.cointegration.criticalLevel === 0.10 ? 'Stationary @ 10% ✓'
                          : 'Cannot reject unit root'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                      <div>
                        <span className="text-[9.5px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>γ (AR coef)</span>
                        <span className="tabular-nums" style={{ color: COLORS.text }}>{pairResult.cointegration.coef.toFixed(4)}</span>
                      </div>
                      <div>
                        <span className="text-[9.5px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>t-statistic</span>
                        <span className="tabular-nums"
                              style={{ color: pairResult.cointegration.tStat <= -2.566 ? COLORS.green
                                            : pairResult.cointegration.tStat <= -1.941 ? COLORS.mint
                                            : pairResult.cointegration.tStat <= -1.616 ? '#FFB84D'
                                            :                                              COLORS.red }}>
                          {pairResult.cointegration.tStat?.toFixed(3) ?? '—'}
                        </span>
                      </div>
                      {pairResult.cointegration.halfLife != null && (
                        <div>
                          <span className="text-[9.5px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>Half-life</span>
                          <span className="tabular-nums" style={{ color: COLORS.text }}>~{pairResult.cointegration.halfLife} bars</span>
                        </div>
                      )}
                      {pairResult.hedgeRatios && (
                        <div>
                          <span className="text-[9.5px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>β (last)</span>
                          <span className="tabular-nums" style={{ color: COLORS.text }}>{pairResult.hedgeRatios[pairResult.hedgeRatios.length - 1]?.toFixed(4) ?? '—'}</span>
                        </div>
                      )}
                      {pairResult.cointegration.useAugmented && (
                        <div>
                          <span className="text-[9.5px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>Aug. lags</span>
                          <span className="tabular-nums" style={{ color: COLORS.text }}>p = {pairResult.cointegration.augmentedLags}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] mt-1.5" style={{ color: COLORS.textDim }}>
                      Critical values (no constant, no trend): 1% = -2.566 · 5% = -1.941 · 10% = -1.616.
                      Lower (more negative) t-stat = stronger evidence of stationarity / mean reversion.
                    </div>
                    <div className="text-[10.5px] mt-1.5" style={{ color: COLORS.textDim }}>
                      {pairResult.cointegration.criticalLevel != null
                        ? `Spread is stationary at the ${(pairResult.cointegration.criticalLevel * 100).toFixed(0)}% level — cointegration confirmed. Mean-reversion edge is statistically significant.`
                        : `t-statistic (${pairResult.cointegration.tStat?.toFixed(3) ?? 'n/a'}) doesn't cross the 10% critical value. Spread may not be cointegrated — z-score signals could give false reversals.`}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Total return</div>
                    <div className="tabular-nums font-medium"
                         style={{ color: pairResult.totalReturn >= 0 ? COLORS.green : COLORS.red }}>
                      {fmtPct(pairResult.totalReturn)}
                    </div>
                  </div>
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sharpe</div>
                    <div className="tabular-nums">{fmtNum(pairResult.sharpe)}</div>
                  </div>
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Max DD</div>
                    <div className="tabular-nums" style={{ color: COLORS.red }}>{fmtPct(pairResult.maxDrawdown)}</div>
                  </div>
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Win rate</div>
                    <div className="tabular-nums">{fmtPct(pairResult.winRate)}</div>
                  </div>
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Trades</div>
                    <div className="tabular-nums">{pairResult.nTrades}</div>
                  </div>
                </div>
                {/* Equity curve */}
                <div className="rounded-md border p-3" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>Equity curve</div>
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={pairResult.equity} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                        <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="idx" stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                               interval={Math.max(0, Math.floor(pairResult.equity.length / 6))} />
                        <YAxis stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                               tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                        <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }}
                                 formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Equity']} />
                        <Line dataKey="equity" stroke={COLORS.mint} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                {/* Z-score chart */}
                <div className="rounded-md border p-3" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                    Spread z-score (entry threshold ±{pairEntryZ.toFixed(1)}, exit ±{pairExitZ.toFixed(1)})
                  </div>
                  <div style={{ height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={pairResult.equity} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                        <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="idx" stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                               interval={Math.max(0, Math.floor(pairResult.equity.length / 6))} />
                        <YAxis stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                               tickFormatter={(v) => v.toFixed(1)} />
                        <ReferenceLine y={pairEntryZ}  stroke={COLORS.red}  strokeDasharray="3 3" />
                        <ReferenceLine y={-pairEntryZ} stroke={COLORS.green} strokeDasharray="3 3" />
                        <ReferenceLine y={pairExitZ}   stroke={COLORS.textMute} strokeDasharray="2 2" />
                        <ReferenceLine y={-pairExitZ}  stroke={COLORS.textMute} strokeDasharray="2 2" />
                        <ReferenceLine y={0} stroke={COLORS.textMute} />
                        <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }}
                                 formatter={(v) => [Number(v).toFixed(3), 'z']} />
                        <Line dataKey="z" stroke="#9F88FF" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                {/* Trades table */}
                {pairResult.trades && pairResult.trades.length > 0 && (
                  <div className="rounded-md border" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                    <div className="px-3 py-2 border-b text-[10px] uppercase tracking-wider"
                         style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
                      Trades · {pairResult.trades.length}
                    </div>
                    <div className="max-h-[200px] overflow-y-auto">
                      {pairResult.trades.slice(0, 50).map((t, idx) => (
                        <div key={idx}
                             className="flex items-center justify-between px-3 py-1 border-b last:border-b-0 text-[11px] tabular-nums"
                             style={{ borderColor: COLORS.border }}>
                          <span style={{ color: COLORS.textMute }}>#{idx + 1}</span>
                          <span style={{ color: t.direction > 0 ? COLORS.green : COLORS.red }}>
                            {t.direction > 0 ? `Long ${pairTickerA} / Short ${pairTickerB}` : `Short ${pairTickerA} / Long ${pairTickerB}`}
                          </span>
                          <span style={{ color: COLORS.textDim }}>
                            ratio {t.entryRatio?.toFixed(3) ?? '—'} → {t.exitRatio?.toFixed(3) ?? '—'}
                          </span>
                          <span style={{ color: t.pnl >= 0 ? COLORS.green : COLORS.red }}>
                            ${t.pnl.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {mode === 'seasonal' && (
          <div className="space-y-4">
            <div className="rounded-md border p-3"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                Seasonal / calendar effect strategy
              </div>
              <p className="text-[11px] mb-3" style={{ color: COLORS.textDim }}>
                Goes long during bullish months, flat during bearish months. Test classic effects ("sell in May", year-end rally, January effect, A-share spring rally) or design your own. Adapted from the Vibe-Trading seasonal skill.
              </p>
              {/* Preset picker */}
              <div className="mb-3">
                <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Preset</div>
                <div className="flex flex-wrap gap-1">
                  {SEASONAL_PRESETS.map(p => (
                    <button key={p.id} type="button"
                            onClick={() => applySeasonalPreset(p.id)}
                            className="px-2 py-1 rounded text-[10.5px] transition-colors"
                            style={{
                              background: seasonalPreset === p.id ? `${COLORS.mint}1A` : COLORS.bg,
                              color: seasonalPreset === p.id ? COLORS.mint : COLORS.textDim,
                              border: `1px solid ${seasonalPreset === p.id ? COLORS.mint : COLORS.border}`,
                            }}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Month grid — bull / bear toggles per month */}
              <div className="grid grid-cols-6 sm:grid-cols-12 gap-1">
                {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((name, idx) => {
                  const m = idx + 1;
                  const isBull = seasonalBullMonths.includes(m);
                  const isBear = seasonalBearMonths.includes(m);
                  return (
                    <div key={m} className="rounded border p-1"
                         style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="text-[10px] text-center mb-1" style={{ color: COLORS.text }}>{name}</div>
                      <div className="flex flex-col gap-0.5">
                        <button type="button" onClick={() => toggleSeasonalMonth('bull', m)}
                                className="text-[9px] py-0.5 rounded"
                                style={{
                                  background: isBull ? COLORS.green : COLORS.surface,
                                  color: isBull ? '#FFF' : COLORS.textMute,
                                }}>
                          long
                        </button>
                        <button type="button" onClick={() => toggleSeasonalMonth('bear', m)}
                                className="text-[9px] py-0.5 rounded"
                                style={{
                                  background: isBear ? COLORS.red : COLORS.surface,
                                  color: isBear ? '#FFF' : COLORS.textMute,
                                }}>
                          flat
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Weekday filter — optional overlay */}
              <details className="mt-3">
                <summary className="text-[10.5px] cursor-pointer" style={{ color: COLORS.textDim }}>
                  Weekday effect (optional overlay) · {seasonalBullWeekdays.length + seasonalBearWeekdays.length} day filters set
                </summary>
                <div className="mt-2 px-2 py-1.5 rounded text-[10.5px]"
                     style={{ background: 'rgba(122,200,255,0.06)', color: '#7AC8FF', border: '1px solid rgba(122,200,255,0.20)' }}>
                  Combined with the month effect: long when month says <em>long</em> AND weekday isn't <em>flat</em>; goes flat if either says flat. No weekday filters = month-only.
                </div>
                <div className="mt-2 grid grid-cols-5 gap-1">
                  {[
                    { d: 1, name: 'Mon' },
                    { d: 2, name: 'Tue' },
                    { d: 3, name: 'Wed' },
                    { d: 4, name: 'Thu' },
                    { d: 5, name: 'Fri' },
                  ].map(({ d, name }) => {
                    const isBull = seasonalBullWeekdays.includes(d);
                    const isBear = seasonalBearWeekdays.includes(d);
                    return (
                      <div key={d} className="rounded border p-1"
                           style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                        <div className="text-[10px] text-center mb-1" style={{ color: COLORS.text }}>{name}</div>
                        <div className="flex flex-col gap-0.5">
                          <button type="button" onClick={() => toggleSeasonalWeekday('bull', d)}
                                  className="text-[9px] py-0.5 rounded"
                                  style={{
                                    background: isBull ? COLORS.green : COLORS.surface,
                                    color: isBull ? '#FFF' : COLORS.textMute,
                                  }}>
                            long
                          </button>
                          <button type="button" onClick={() => toggleSeasonalWeekday('bear', d)}
                                  className="text-[9px] py-0.5 rounded"
                                  style={{
                                    background: isBear ? COLORS.red : COLORS.surface,
                                    color: isBear ? '#FFF' : COLORS.textMute,
                                  }}>
                            flat
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-[10px]" style={{ color: COLORS.textMute }}>
                  {seasonalBullMonths.length} long months · {seasonalBearMonths.length} flat months
                  {(seasonalBullWeekdays.length + seasonalBearWeekdays.length > 0) && (
                    <span> · {seasonalBullWeekdays.length} long days · {seasonalBearWeekdays.length} flat days</span>
                  )}
                </div>
                <button type="button" onClick={runSeasonalNow}
                        disabled={bars.length === 0}
                        className="px-3 py-1.5 rounded text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40"
                        style={{ background: COLORS.mint, color: COLORS.bg }}>
                  <Play size={11} fill="currentColor" />
                  Backtest on {instrument?.id || '—'}
                </button>
              </div>
            </div>

            {seasonalResult && !seasonalResult.error && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Total return</div>
                    <div className="tabular-nums font-medium"
                         style={{ color: seasonalResult.totalReturn >= 0 ? COLORS.green : COLORS.red }}>
                      {fmtPct(seasonalResult.totalReturn)}
                    </div>
                  </div>
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sharpe</div>
                    <div className="tabular-nums">{fmtNum(seasonalResult.sharpe)}</div>
                  </div>
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sortino</div>
                    <div className="tabular-nums">{fmtNum(seasonalResult.sortino)}</div>
                  </div>
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Max DD</div>
                    <div className="tabular-nums" style={{ color: COLORS.red }}>{fmtPct(seasonalResult.maxDrawdown)}</div>
                  </div>
                  <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Trades</div>
                    <div className="tabular-nums">{seasonalResult.nTrades ?? seasonalResult.trades?.length ?? 0}</div>
                  </div>
                </div>
                <div className="rounded-md border p-3" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>Equity curve</div>
                  <div style={{ height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={seasonalResult.equity || []} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                        <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="idx" stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                               interval={Math.max(0, Math.floor((seasonalResult.equity?.length || 0) / 6))} />
                        <YAxis stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                               tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                        <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }}
                                 formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Equity']} />
                        <Line dataKey="equity" stroke={COLORS.mint} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}
            {seasonalResult?.error && (
              <div className="rounded-md border p-2 text-[11.5px]"
                   style={{ borderColor: COLORS.red, color: COLORS.red, background: 'rgba(255,85,119,0.06)' }}>
                {seasonalResult.error}
              </div>
            )}
          </div>
        )}

        {mode === 'correlation' && (
          <div className="space-y-4">
            <div className="rounded-md border p-3"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                Correlation matrix
              </div>
              <p className="text-[11px] mb-3" style={{ color: COLORS.textDim }}>
                Pearson correlation of daily returns across the basket. Useful for finding pair-trade candidates (high |ρ|), portfolio diversification (low ρ), and sector clustering. Adapted from the Vibe-Trading correlation-analysis skill.
              </p>
              <div>
                <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                  Basket (comma-separated tickers, 2-30 recommended)
                </div>
                <textarea value={corrBasket}
                          onChange={(e) => setCorrBasket(e.target.value)}
                          rows={2}
                          className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none font-mono resize-y"
                          style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" onClick={runCorrelationNow}
                        disabled={corrStatus === 'loading'}
                        className="px-3 py-1.5 rounded text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40"
                        style={{ background: COLORS.mint, color: COLORS.bg }}>
                  {corrStatus === 'loading' ? <RefreshCw size={11} className="animate-spin" /> : <Play size={11} fill="currentColor" />}
                  Compute correlations
                </button>
              </div>
            </div>

            {corrStatus === 'error' && (
              <div className="rounded-md border p-2 text-[11.5px]"
                   style={{ borderColor: COLORS.red, color: COLORS.red, background: 'rgba(255,85,119,0.06)' }}>
                Could not compute correlation matrix. Need at least 2 valid tickers.
              </div>
            )}

            {corrResult && (
              <>
                <div className="rounded-md border p-3 overflow-x-auto"
                     style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                    Heatmap · {corrResult.tickers.length}×{corrResult.tickers.length}
                    <span className="ml-3" style={{ color: COLORS.textDim }}>
                      mean ρ {corrResult.mean.toFixed(3)} · max |ρ| {Math.abs(corrResult.maxOffDiagonal).toFixed(3)}
                    </span>
                  </div>
                  <div dangerouslySetInnerHTML={{ __html: renderCorrelationHeatmapSVG(corrResult, { cell: 26 }) }} />
                </div>
                <div className="rounded-md border" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                  <div className="px-3 py-2 border-b text-[10px] uppercase tracking-wider"
                       style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
                    Top pairs by |ρ| · click to load into pair-trade tab
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {corrResult.sortedPairs.slice(0, 30).map((p, idx) => (
                      <div key={idx}
                           className="flex items-center justify-between px-3 py-1.5 border-b last:border-b-0 cursor-pointer hover:bg-white/[0.03]"
                           style={{ borderColor: COLORS.border }}
                           onClick={() => {
                             setPairTickerA(p.a);
                             setPairTickerB(p.b);
                             setMode('pair');
                           }}>
                        <span className="text-[11.5px] font-mono" style={{ color: COLORS.text }}>
                          {p.a} · {p.b}
                        </span>
                        <span className="text-[11.5px] tabular-nums"
                              style={{ color: Math.abs(p.rho) > 0.7 ? COLORS.green
                                            : Math.abs(p.rho) > 0.4 ? COLORS.text
                                            : COLORS.textDim }}>
                          ρ = {p.rho.toFixed(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {mode === 'options' && (
          <div className="space-y-4">
            <div className="rounded-md border p-3"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                Options payoff visualizer (research only)
              </div>
              <p className="text-[11px] mb-3" style={{ color: COLORS.textDim }}>
                Build single-leg or multi-leg option positions and see the P&amp;L curve at expiry, breakeven points, and per-leg greeks. Black-Scholes pricing with dividend yield. Adapted from the Vibe-Trading options-payoff skill. We never quote live options — this is for visualization and education only.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3 mb-3">
                <div>
                  <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Spot reference</div>
                  <input type="number" min="1" step="0.5" value={optionSpot}
                         onChange={(e) => setOptionSpot(Number(e.target.value) || 100)}
                         className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none tabular-nums"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                </div>
                <div>
                  <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Preset</div>
                  <div className="flex flex-wrap gap-1">
                    {OPTION_PRESETS.map(p => (
                      <button key={p.id} type="button"
                              onClick={() => applyOptionPreset(p.id)}
                              className="px-2 py-1 rounded text-[10.5px] transition-colors"
                              style={{
                                background: optionPreset === p.id ? `${COLORS.mint}1A` : COLORS.bg,
                                color: optionPreset === p.id ? COLORS.mint : COLORS.textDim,
                                border: `1px solid ${optionPreset === p.id ? COLORS.mint : COLORS.border}`,
                              }}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {/* BS inputs for greeks calc */}
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                    Time to expiry (years)
                  </div>
                  <input type="number" min="0.01" max="5" step="0.05"
                         value={optionT}
                         onChange={(e) => setOptionT(Math.max(0.001, Number(e.target.value) || 0.25))}
                         className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none tabular-nums"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                         title="0.083 = ~30 days, 0.25 = 3 months, 0.5 = 6 months, 1 = 1 year" />
                </div>
                <div>
                  <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                    Implied vol (annualized)
                  </div>
                  <input type="number" min="0.01" max="3" step="0.05"
                         value={optionSigma}
                         onChange={(e) => setOptionSigma(Math.max(0.001, Number(e.target.value) || 0.25))}
                         className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none tabular-nums"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                         title="0.20 = 20% annualized vol; 0.50 = 50% (typical for high-vol stocks)" />
                </div>
                <div>
                  <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                    Risk-free rate (annualized)
                  </div>
                  <input type="number" min="0" max="0.20" step="0.005"
                         value={optionR}
                         onChange={(e) => setOptionR(Math.max(0, Number(e.target.value) || 0.05))}
                         className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none tabular-nums"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                         title="Use the current 3-month T-bill yield (e.g. 0.045 for 4.5%)" />
                </div>
              </div>
              {/* Leg list */}
              <div className="space-y-1">
                <div className="text-[9.5px] uppercase tracking-wider px-1" style={{ color: COLORS.textMute }}>Legs</div>
                {optionLegs.map(leg => (
                  <div key={leg.id} className="grid grid-cols-[100px_90px_90px_90px_60px_28px] gap-1 items-center">
                    <select value={leg.type}
                            onChange={(e) => updateOptionLeg(leg.id, 'type', e.target.value)}
                            className="px-2 py-1 rounded text-[11px] outline-none"
                            style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                      <option value="call">Call</option>
                      <option value="put">Put</option>
                      <option value="underlying">Underlying</option>
                    </select>
                    <select value={leg.side}
                            onChange={(e) => updateOptionLeg(leg.id, 'side', e.target.value)}
                            className="px-2 py-1 rounded text-[11px] outline-none"
                            style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                      <option value="long">Long</option>
                      <option value="short">Short</option>
                    </select>
                    <input type="number" step="0.5" placeholder="Strike"
                           value={leg.strike}
                           onChange={(e) => updateOptionLeg(leg.id, 'strike', Number(e.target.value))}
                           className="px-2 py-1 rounded text-[11px] outline-none tabular-nums"
                           style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                    <input type="number" step="0.05" min="0" placeholder="Premium"
                           value={leg.premium}
                           onChange={(e) => updateOptionLeg(leg.id, 'premium', Number(e.target.value))}
                           disabled={leg.type === 'underlying'}
                           className="px-2 py-1 rounded text-[11px] outline-none tabular-nums disabled:opacity-50"
                           style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                    <input type="number" step="1" min="1" placeholder="Qty"
                           value={leg.qty}
                           onChange={(e) => updateOptionLeg(leg.id, 'qty', Number(e.target.value))}
                           className="px-2 py-1 rounded text-[11px] outline-none tabular-nums"
                           style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                    <button type="button"
                            onClick={() => removeOptionLeg(leg.id)}
                            disabled={optionLegs.length === 1}
                            className="px-1.5 py-1 rounded hover:bg-white/[0.04] disabled:opacity-30"
                            style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addOptionLeg}
                        className="mt-1 px-2 py-1 rounded text-[10.5px] inline-flex items-center gap-1 hover:bg-white/[0.04]"
                        style={{ color: COLORS.textDim, border: `1px dashed ${COLORS.border}` }}>
                  <Plus size={10} /> Add leg
                </button>
              </div>
            </div>

            {/* Payoff chart */}
            <div className="rounded-md border p-3" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                P&amp;L at expiry · spot = {optionSpot.toFixed(2)}
              </div>
              <div className="rounded overflow-hidden"
                   dangerouslySetInnerHTML={{
                     __html: renderOptionPayoffSVG(optionLegs, { spot: optionSpot, width: 720, height: 320 })
                   }} />
            </div>

            {/* Per-leg greeks (using spot, fixed T=0.25, sigma=0.25, r=0.05 for illustration) */}
            <div className="rounded-md border" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="px-3 py-2 border-b text-[10px] uppercase tracking-wider"
                   style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
                Greeks per leg · T={optionT.toFixed(2)}y, σ={(optionSigma * 100).toFixed(0)}%, r={(optionR * 100).toFixed(1)}%
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] tabular-nums">
                  <thead>
                    <tr style={{ color: COLORS.textMute, borderBottom: `1px solid ${COLORS.border}` }}>
                      <th className="text-left px-3 py-1.5">Leg</th>
                      <th className="text-right px-2">Price</th>
                      <th className="text-right px-2">Δ delta</th>
                      <th className="text-right px-2">Γ gamma</th>
                      <th className="text-right px-2">ν vega</th>
                      <th className="text-right px-2">θ theta/d</th>
                      <th className="text-right px-3">ρ rho</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optionLegs.map(leg => {
                      if (leg.type === 'underlying') {
                        return (
                          <tr key={leg.id} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                            <td className="px-3 py-1.5" style={{ color: COLORS.text }}>
                              {leg.side} underlying × {leg.qty}
                            </td>
                            <td className="text-right px-2" style={{ color: COLORS.text }}>{Number(leg.strike).toFixed(2)}</td>
                            <td className="text-right px-2" style={{ color: COLORS.text }}>{leg.side === 'long' ? '+1.000' : '-1.000'}</td>
                            <td className="text-right px-2" style={{ color: COLORS.textDim }}>—</td>
                            <td className="text-right px-2" style={{ color: COLORS.textDim }}>—</td>
                            <td className="text-right px-2" style={{ color: COLORS.textDim }}>—</td>
                            <td className="text-right px-3" style={{ color: COLORS.textDim }}>—</td>
                          </tr>
                        );
                      }
                      const bs = blackScholesAdvanced(optionSpot, Number(leg.strike), optionT, optionR, optionSigma, leg.type, 0);
                      const sign = leg.side === 'long' ? 1 : -1;
                      const fmt = (v) => v.toFixed(3);
                      return (
                        <tr key={leg.id} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                          <td className="px-3 py-1.5" style={{ color: COLORS.text }}>
                            {leg.side} {leg.type} {Number(leg.strike).toFixed(0)} × {leg.qty}
                          </td>
                          <td className="text-right px-2" style={{ color: COLORS.text }}>{bs.price.toFixed(2)}</td>
                          <td className="text-right px-2" style={{ color: COLORS.text }}>{(sign * bs.delta).toFixed(3)}</td>
                          <td className="text-right px-2" style={{ color: COLORS.text }}>{(sign * bs.gamma).toFixed(4)}</td>
                          <td className="text-right px-2" style={{ color: COLORS.text }}>{(sign * bs.vega).toFixed(3)}</td>
                          <td className="text-right px-2" style={{ color: bs.theta < 0 ? COLORS.red : COLORS.green }}>{(sign * bs.theta).toFixed(3)}</td>
                          <td className="text-right px-3" style={{ color: COLORS.text }}>{(sign * bs.rho).toFixed(3)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {mode === 'rl' && (
          <div className="space-y-4">
            <div className="rounded-md border p-4"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
              <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                Toy reinforcement-learning sandbox
              </div>
              <div className="text-[10.5px] mb-3 px-2.5 py-1.5 rounded"
                   style={{ background: 'rgba(255,184,77,0.06)', color: '#FFD699', border: '1px solid rgba(255,184,77,0.20)' }}>
                <strong>Educational visualization.</strong> A Q-learning agent with 18 discrete states (RSI bucket × trend bucket × position) and 3 actions (hold/buy/sell) trains on historical bars. Toy-grade — real RL would need experience replay, function approximation, and a backend with GPU sampling. Useful to understand what RL <em>does</em>, not to deploy.
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2">
                  <span className="text-[11px]" style={{ color: COLORS.textMute }}>Episodes</span>
                  <input type="number" min={10} max={500} step={10}
                         value={rlEpisodes}
                         onChange={(e) => setRlEpisodes(Math.max(10, Math.min(500, Number(e.target.value))))}
                         className="w-20 px-2 py-1 rounded text-[11.5px] tabular-nums outline-none"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                </label>
                <button type="button"
                        onClick={trainRL}
                        disabled={rlTraining || barsStatus !== 'ok'}
                        className="px-3 py-1.5 rounded text-[11.5px] font-medium transition-colors disabled:opacity-40"
                        style={{ background: COLORS.mint, color: COLORS.bg }}>
                  {rlTraining ? 'Training…' : 'Train agent'}
                </button>
                {rlAgent && (
                  <span className="text-[10.5px]" style={{ color: COLORS.textDim }}>
                    Q-table populated with {Object.keys(rlAgent.Q).length} states
                  </span>
                )}
              </div>
            </div>

            {rlResult && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-md border p-3"
                     style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                  <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                    Trained policy replay
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="rounded-md border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Total return</div>
                      <div className="text-[14px] font-medium tabular-nums"
                           style={{ color: rlResult.totalReturn >= 0 ? COLORS.green : COLORS.red }}>
                        {fmtPct(rlResult.totalReturn)}
                      </div>
                    </div>
                    <div className="rounded-md border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sharpe</div>
                      <div className="text-[14px] font-medium tabular-nums">
                        {fmtNum(rlResult.sharpe)}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-md border" style={{ borderColor: COLORS.border, background: COLORS.bg, height: 200 }}>
                    {rlResult.equity && (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={rlResult.equity} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                          <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="idx" stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                                 interval={Math.max(0, Math.floor(rlResult.equity.length / 6))} />
                          <YAxis stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                                 domain={['auto', 'auto']}
                                 tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                          <Tooltip
                            contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }}
                            formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Equity']} />
                          <Line dataKey="equity" stroke="#9F88FF" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
                <div className="rounded-md border p-3"
                     style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                  <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                    Reward per episode (training)
                  </div>
                  <div className="rounded-md border" style={{ borderColor: COLORS.border, background: COLORS.bg, height: 200 }}>
                    {rlRewardHistory.length > 0 && (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={rlRewardHistory.map((r, i) => ({ episode: i, reward: r }))}
                                   margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                          <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="episode" stroke={COLORS.textMute} tick={{ fontSize: 9 }}
                                 interval={Math.max(0, Math.floor(rlRewardHistory.length / 6))} />
                          <YAxis stroke={COLORS.textMute} tick={{ fontSize: 9 }} />
                          <Tooltip
                            contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 11 }} />
                          <Line dataKey="reward" stroke="#FFB84D" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div className="text-[10px] mt-2" style={{ color: COLORS.textMute }}>
                    Trend tells you if the agent is learning. Flat or noisy = state space too coarse / not enough episodes / reward signal too weak.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mode 12 — GARCH(1,1) volatility forecasting (Phase 3o.85). */}
        {mode === 'volforecast' && (
          <VolForecastMode bars={bars} ticker={ticker} />
        )}
      </div>
    </div>
  );
};
