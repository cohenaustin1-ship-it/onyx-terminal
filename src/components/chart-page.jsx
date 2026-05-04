// IMO Onyx Terminal — Chart component
//
// Phase 3p.26 file-splitting / extracted from JPMOnyxTerminal.jsx.
//
// The biggest single component in Onyx (4,936 lines). Renders an
// instrument's price chart with:
//   - Multiple chart styles (candle, line, area, heikin-ashi, bars,
//     baseline, kagi, renko, columns)
//   - 130+ technical indicators (overlay + sub-panels) via
//     INDICATOR_IMPLS dispatcher
//   - Drawing tools (lines, rectangles, fibonacci, pitchforks)
//   - AI overlay annotations (callAI for context-aware analysis)
//   - Subchart system (multiple stacked instruments)
//   - Polygon-fed live price + history
//
// Public export:
//   Chart({ instrument, livePrice, instanceId, ... })
//
// Internal companions (only used by Chart, all inlined):
//   DrawingsPicker       — drawing tool picker overlay
//   MoreIndicatorsModal  — TradingView-style indicator browser
//   IndicatorToggle      — single indicator on/off pill
//   PanelToggle          — sub-panel on/off pill
//
// Imports:
//   lib/constants.js          (COLORS)
//   lib/instruments.js        (INSTRUMENTS)
//   lib/ta-helpers.js         (sma, ema, rsi, etc — 33 TA functions)
//   lib/indicator-impls.js    (INDICATOR_IMPLS dispatcher with 130+
//                              indicator implementations)
//   lib/ai-calls.js           (callAI, exaSearch)
//   ai-markdown.jsx           (AIMarkdown wrapper)
//   leaf-ui.jsx               (MicButton)
//   fundamentals-modal.jsx    (FundamentalsModal — shared with
//                              TradePage)
//
// Honest scope:
//   - Drawing tools state is owned by Chart and persisted in local-
//     storage per instrument.
//   - Subcharts state is owned by ChartWithSubcharts (parent), Chart
//     just provides the read+write API for AI Edit operations.
//   - Live price updates via WebSocket polling fallback (depends on
//     Polygon plan tier).

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
  CartesianGrid, ReferenceLine, ReferenceArea, ReferenceDot,
  BarChart, Bar, ComposedChart, Area, AreaChart, Brush,
} from 'recharts';
import { Circle, Pencil, Search, Sparkles, X } from 'lucide-react';
import { COLORS } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import {
  TIMEFRAMES, TIME_RANGES, INTERVALS,
  resolveRangeMins, isValidCombination, reconcileFrequency,
} from '../lib/chart-config.js';
import {
  sma, ema, rsi, macd, wmaSeries, _flat, atrSeries, bbandsSeries,
  donchianSeries, keltnerSeries, envelopeSeries, stochasticSeries,
  cciSeries, adxSeries, willrSeries, mfiSeries, obvSeries, rocSeries,
  momSeries, trixSeries, aoSeries, hmaSeries, ichimokuSeries,
  vwapSeries, stochRsiSeries, psarSeries, supertrendSeries,
  pivotsClassic, stdevSeries, hvSeries, linregSeries, aroonSeries,
  cmfSeries, choppinessSeries,
} from '../lib/ta-helpers.js';
import { INDICATOR_IMPLS } from '../lib/indicator-impls.js';
import { callAI, exaSearch } from '../lib/ai-calls.js';
import { computeBarCount, blackScholes } from '../lib/quant/quant-misc.js';
import { scoreSentimentBatch } from '../lib/sentiment.js';
import { SUBCHART_TYPES } from './chart-with-subcharts.jsx';
import { AIMarkdown } from './ai-markdown.jsx';
import { MicButton } from './leaf-ui.jsx';
import { FundamentalsModal } from './fundamentals-modal.jsx';

// Env-var keys (duplicated from monolith — same source, separate read).
const MASSIVE_API_KEY  = (() => { try { return import.meta.env?.VITE_MASSIVE_API_KEY  ?? ''; } catch { return ''; } })();
const ANTHROPIC_API_KEY= (() => { try { return import.meta.env?.VITE_ANTHROPIC_API_KEY?? ''; } catch { return ''; } })();
const EXA_API_KEY      = (() => { try { return import.meta.env?.VITE_EXA_API_KEY      ?? ''; } catch { return ''; } })();

// EIA timeframe gate (single Set, duplicated from monolith — only 3
// callers including this one, small enough to dup rather than share).

// ──────────── Drawings Picker ────────────
// Comprehensive drawing-tool catalog modeled after TradingView's Drawings UI:
// 7 tabs (Trend lines / Gann & Fibonacci / Patterns / Forecasting & Measurement /
// Geometric Shapes / Annotation / Visuals) with the full toolset under each.
// Tools that we can render on the chart resolve to actual chart tools; the
// rest set a marker so the user knows they're picking from the same surface
// as a real terminal even if the rendering is simplified.
const DRAWING_TAB_DEFS = [
  {
    id: 'trend',
    label: 'Trend lines',
    tools: [
      { id: 'trendline', label: 'Trend Line',         icon: '↗', wired: true,  desc: 'Click two points on the chart to draw a sloped line' },
      { id: 'ray',       label: 'Ray',                icon: '→', wired: false, desc: 'Half-line extending in one direction' },
      { id: 'info-line', label: 'Info Line',          icon: 'ⓘ', wired: false, desc: 'Trend line with stats (% change, slope, time)' },
      { id: 'extended',  label: 'Extended Line',      icon: '↔', wired: false, desc: 'Line extending in both directions' },
      { id: 'angle',     label: 'Trend Angle',        icon: '∠', wired: false, desc: 'Trend line with angle readout' },
      { id: 'hline',     label: 'Horizontal Line',    icon: '─', wired: true,  desc: 'Click any price to set a horizontal level' },
      { id: 'hray',      label: 'Horizontal Ray',     icon: '⊢', wired: false, desc: 'Horizontal line from a point forward' },
      { id: 'vline',     label: 'Vertical Line',      icon: '│', wired: true,  desc: 'Click any time to set a vertical line' },
      { id: 'cross',     label: 'Cross Line',         icon: '✚', wired: false, desc: 'Crosshair anchored to a price/time' },
      { id: 'channel',   label: 'Parallel Channel',   icon: '∥', wired: true,  desc: 'Two parallel trendlines' },
      { id: 'regression',label: 'Regression Trend',   icon: '↗', wired: false, desc: 'Best-fit linear regression with channel' },
      { id: 'flat-tb',   label: 'Flat Top/Bottom',    icon: '⊓', wired: false, desc: 'Channel with one flat boundary' },
      { id: 'disjoint',  label: 'Disjoint Channel',   icon: '⊿', wired: false, desc: 'Non-parallel channel — independent slopes' },
      { id: 'pitchfork', label: 'Pitchfork',          icon: '⋔', wired: false, desc: 'Andrews pitchfork — median line + parallels' },
      { id: 'schiff-pf', label: 'Schiff Pitchfork',   icon: '⋔', wired: false, desc: 'Schiff variation of the Andrews pitchfork' },
      { id: 'mod-schiff',label: 'Modified Schiff Pitchfork', icon: '⋔', wired: false, desc: 'Modified Schiff anchoring at midpoint' },
      { id: 'inside-pf', label: 'Inside Pitchfork',   icon: '⋔', wired: false, desc: 'Pitchfork drawn from internal pivots' },
    ],
  },
  {
    id: 'gann',
    label: 'Gann + Fib',
    tools: [
      { id: 'fib',           label: 'Fib Retracement',    icon: '≡', wired: true,  desc: 'Click two pivots — projects 23.6/38.2/50/61.8/78.6%' },
      { id: 'fib-ext',       label: 'Trend-Based Fib Extension', icon: '⤓', desc: 'Extension from a 3-point swing' },
      { id: 'fib-channel',   label: 'Fib Channel',        icon: '∥', desc: 'Parallel channel with Fib levels' },
      { id: 'fib-time',      label: 'Fib Time Zone',      icon: '⏱', desc: 'Vertical lines at Fibonacci time intervals' },
      { id: 'fib-fan',       label: 'Fib Speed Resistance Fan', icon: '⊿', desc: 'Diagonal Fib levels from a swing' },
      { id: 'fib-tb-time',   label: 'Trend-Based Fib Time', icon: '⏳', desc: 'Time-based Fib using a 3-point swing' },
      { id: 'fib-circles',   label: 'Fib Circles',        icon: '◯', desc: 'Concentric Fib radius circles' },
      { id: 'fib-spiral',    label: 'Fib Spiral',         icon: '🌀', desc: 'Logarithmic spiral with Fib ratios' },
      { id: 'fib-arcs',      label: 'Fib Speed Resistance Arcs', icon: '◠', desc: 'Arc-based Fib speed/resistance levels' },
      { id: 'fib-wedge',     label: 'Fib Wedge',          icon: '◢', desc: 'Wedge formed by Fib lines' },
      { id: 'pitchfan',      label: 'Pitchfan',           icon: '⋔', desc: 'Fan of Fib lines from a pivot' },
      { id: 'gann-box',      label: 'Gann Box',           icon: '⊞', desc: 'Time-price grid with Gann ratios' },
      { id: 'gann-sq-fixed', label: 'Gann Square Fixed',  icon: '⊞', desc: 'Square based on a fixed time/price unit' },
      { id: 'gann-sq',       label: 'Gann Square',        icon: '⊞', desc: 'Variable-size Gann square' },
      { id: 'gann-fan',      label: 'Gann Fan',           icon: '⊿', desc: 'Eight angled lines (1×1, 1×2, 2×1, etc.)' },
    ],
  },
  {
    id: 'patterns',
    label: 'Patterns',
    tools: [
      { id: 'xabcd',         label: 'XABCD Pattern',           icon: '⌒', desc: 'Harmonic pattern with X,A,B,C,D pivots' },
      { id: 'cypher',        label: 'Cypher Pattern',          icon: '⌒', desc: 'Cypher harmonic pattern' },
      { id: 'head-shoulders',label: 'Head & Shoulders',        icon: '⌒', desc: 'Classic reversal pattern' },
      { id: 'abcd',          label: 'ABCD Pattern',            icon: '◇', desc: 'Simple 4-leg ABCD harmonic' },
      { id: 'tri-pattern',   label: 'Triangle Pattern',        icon: '△', desc: 'Symmetric/ascending/descending triangle' },
      { id: 'three-drives',  label: 'Three Drives Pattern',    icon: '⌒', desc: '3-drive harmonic with Fib confirmation' },
      { id: 'elliott-imp',   label: 'Elliott Impulse Wave (12345)', icon: '〰', desc: '5-wave impulse motion' },
      { id: 'elliott-corr',  label: 'Elliott Correction Wave (ABC)', icon: '〰', desc: '3-wave A-B-C correction' },
      { id: 'elliott-tri',   label: 'Elliott Triangle Wave (ABCDE)', icon: '〰', desc: '5-wave triangular correction' },
      { id: 'elliott-dbl',   label: 'Elliott Double Combo Wave (WXY)', icon: '〰', desc: 'Double 3 corrective combination' },
      { id: 'elliott-trp',   label: 'Elliott Triple Combo Wave (WXYXZ)', icon: '〰', desc: 'Triple 3 corrective combination' },
      { id: 'cyclic-lines',  label: 'Cyclic Lines',            icon: '|||', desc: 'Equally-spaced vertical lines (cycles)' },
      { id: 'time-cycles',   label: 'Time Cycles',             icon: '⌒', desc: 'Cycle markers at fixed time intervals' },
      { id: 'sine-line',     label: 'Sine Line',               icon: '∿', desc: 'Sine-wave overlay for cyclical analysis' },
    ],
  },
  {
    id: 'forecasting',
    label: 'Forecasting + Measurement',
    tools: [
      { id: 'long-pos',      label: 'Long Position',         icon: '🟩', wired: true,  desc: 'Risk/reward bracket — entry, stop, target' },
      { id: 'short-pos',     label: 'Short Position',        icon: '🟥', wired: true,  desc: 'Short risk/reward bracket' },
      { id: 'forecast',      label: 'Forecast',              icon: '📈', desc: 'Future price/time forecast box' },
      { id: 'bars-pattern',  label: 'Bars Pattern',          icon: '┃', desc: 'Replicate prior bar pattern as a forecast' },
      { id: 'ghost-feed',    label: 'Ghost Feed',            icon: '👻', desc: 'Simulated future bars from a model' },
      { id: 'projection',    label: 'Projection',            icon: '◢', desc: 'Project a swing into the future' },
      { id: 'anchored-vwap', label: 'Anchored VWAP',         icon: '╫', desc: 'VWAP anchored to a chosen bar' },
      { id: 'fr-vol-prof',   label: 'Fixed Range Volume Profile', icon: '┃', desc: 'Volume profile over a date range' },
      { id: 'a-vol-prof',    label: 'Anchored Volume Profile', icon: '┃', desc: 'Volume profile from an anchor bar onward' },
      { id: 'price-range',   label: 'Price Range',           icon: 'I', wired: true,  desc: 'Measure price difference between two levels' },
      { id: 'date-range',    label: 'Date Range',            icon: '↔', wired: true,  desc: 'Measure days/bars between two dates' },
      { id: 'date-price',    label: 'Date and Price Range',  icon: '⛶', desc: 'Combined price + time measurement box' },
    ],
  },
  {
    id: 'shapes',
    label: 'Geometric shapes',
    tools: [
      { id: 'brush',         label: 'Brush',           icon: '✎', desc: 'Free-hand pen' },
      { id: 'highlighter',   label: 'Highlighter',     icon: '🖍', desc: 'Highlight an area' },
      { id: 'arrow-marker',  label: 'Arrow Marker',    icon: '↗', desc: 'Standalone arrow marker' },
      { id: 'arrow',         label: 'Arrow',           icon: '→', desc: 'Click two points for a direct arrow' },
      { id: 'arrow-up',      label: 'Arrow Mark Up',   icon: '⬆', desc: 'Up arrow at a price' },
      { id: 'arrow-down',    label: 'Arrow Mark Down', icon: '⬇', desc: 'Down arrow at a price' },
      { id: 'rectangle',     label: 'Rectangle',       icon: '▭', desc: 'Drag to draw a rectangle' },
      { id: 'rot-rect',      label: 'Rotated Rectangle', icon: '◇', desc: 'Rotated rectangle' },
      { id: 'path',          label: 'Path',            icon: '⌒', desc: 'Multi-segment path/polyline' },
      { id: 'circle',        label: 'Circle',          icon: '◯', desc: 'Circle drawing' },
      { id: 'ellipse',       label: 'Ellipse',         icon: '⬭', desc: 'Ellipse drawing' },
      { id: 'polyline',      label: 'Polyline',        icon: '⌒', desc: 'Connected line segments' },
      { id: 'triangle',      label: 'Triangle',        icon: '△', desc: 'Triangle drawing' },
      { id: 'arc',           label: 'Arc',             icon: '◠', desc: 'Arc / curved line' },
      { id: 'curve',         label: 'Curve',           icon: '∼', desc: 'Single curve' },
      { id: 'double-curve',  label: 'Double Curve',    icon: '∽', desc: 'S-curve' },
    ],
  },
  {
    id: 'annotation',
    label: 'Annotation',
    tools: [
      { id: 'text',          label: 'Text',           icon: 'T', desc: 'Anchor a text note to the chart' },
      { id: 'anchored-text', label: 'Anchored Text',  icon: 'T⚓', desc: 'Text tethered to a specific price/time' },
      { id: 'note',          label: 'Note',           icon: '📝', desc: 'Quick sticky note' },
      { id: 'price-note',    label: 'Price Note',     icon: '$', desc: 'Note attached to a price level' },
      { id: 'pin',           label: 'Pin',            icon: '📍', desc: 'Pin a marker at a point' },
      { id: 'table',         label: 'Table',          icon: '⊞', desc: 'Embed a small table on the chart' },
      { id: 'callout',       label: 'Callout',        icon: '', desc: 'Speech-bubble call-out' },
      { id: 'comment',       label: 'Comment',        icon: '', desc: 'Inline comment block' },
      { id: 'price-label',   label: 'Price Label',    icon: '🏷', desc: 'Price tag at a level' },
      { id: 'signpost',      label: 'Signpost',       icon: '⚐', desc: 'Star marker on a bar' },
      { id: 'flag-mark',     label: 'Flag Mark',      icon: '🏳', desc: 'Flag a specific bar' },
      { id: 'image',         label: 'Image',          icon: '🖼', desc: 'Insert an image overlay' },
      { id: 'tweet',         label: 'Tweet',          icon: '𝕏', desc: 'Embed a Tweet at a bar' },
      { id: 'idea',          label: 'Idea',           icon: '💡', desc: 'Tag a published trade idea' },
    ],
  },
  {
    id: 'visuals',
    label: 'Visuals',
    tools: [
      { id: 'emojis',        label: 'Emojis',  icon: '😀', desc: 'Drop an emoji on the chart' },
      { id: 'stickers',      label: 'Stickers',icon: '🌈', desc: 'Sticker overlay' },
      { id: 'icons',         label: 'Icons',   icon: '♥',  desc: 'Pictograms — heart, star, etc.' },
    ],
  },
];

const EIA_UNAVAILABLE_TF = new Set(['1m', '5m', '15m', '1h', '4h']);

// fmt (inlined per established pattern — used 17 times in Chart).
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

// Real historical chart data (Coinbase + CoinGecko + EIA + Polygon
// equity aggs). Inlined from monolith — only Chart uses this hook.
// Each data-source map and the HISTORY_CACHE are session-scoped.
/* ──────────── Real historical chart data (Coinbase + CoinGecko + EIA) ──────────── */

// Coinbase spot product per Onyx perp symbol.
const COINBASE_CANDLES_SYMBOL_MAP = {
  'BTC-PERP': 'BTC-USD',
  'ETH-PERP': 'ETH-USD',
  'SOL-PERP': 'SOL-USD',
};

// Crypto intraday + daily via Coinbase candles. Granularity in seconds, limit
// in candles. Coinbase supports exactly these granularities — 4h is not native,
// so we use 6h (21600) which is the closest available option.
const CRYPTO_CB_CANDLES = {
  '1m':  { granularity: 60,    limit: 60  },  // 1 hour of 1-minute bars
  '5m':  { granularity: 300,   limit: 60  },  // 5 hours of 5-minute bars
  '15m': { granularity: 900,   limit: 96  },  // 24 hours of 15-minute bars
  '30m': { granularity: 900,   limit: 96  },  // approximated with 15m × 2 (Coinbase has no 30m)
  '1h':  { granularity: 3600,  limit: 168 },  // 7 days of hourly bars
  '4h':  { granularity: 21600, limit: 120 },  // 30 days (6h bars — closest native to 4h)
  '1d':  { granularity: 86400, limit: 90  },  // 90 days of daily bars
};

// Map Onyx symbols → CoinGecko coin IDs (free, no auth).
const CG_COIN_MAP = {
  'BTC-PERP': 'bitcoin',
  'ETH-PERP': 'ethereum',
  'SOL-PERP': 'solana',
};

// Crypto multi-year zoom via CoinGecko (days parameter → automatic granularity).
const CG_DAYS_MAP = {
  '1w':  7,
  '1M':  30,
  '1y':  365,
  '3y':  1095,
  '5y':  1825,
  '10y': 3650,
};

// Energy via EIA. EIA only serves daily-settlement data — intraday timeframes
// are structurally impossible, so those buttons are disabled for energy below.
const EIA_LEN_MAP = {
  '1d':  30,
  '1w':  7,
  '1M':  30,
  '1y':  260,
  '3y':  780,
  '5y':  1300,
  '10y': 2600,
};

// (EIA_UNAVAILABLE_TF already declared at top of module)

// Session cache. Key = `${instrument.id}:${tf}`. Value = { status, series?, source? }
const HISTORY_CACHE = {};

// A (instrument, tf) pair is *structurally* available if any data source could
// in principle serve it. Runtime failures (network, rate limit) are tracked
// separately per-Chart so they reset on instrument change.
const isStructurallyAvailable = (inst, tf) => {
  if (inst.cls === 'energy' && EIA_UNAVAILABLE_TF.has(tf)) return false;
  return true;
};

// Fetches real historical data for (instrument, tf). No synthetic fallback —
// if every data source fails, the hook reports status: 'failed' and the UI
// disables that timeframe button so the user can't pick it again.
const useHistoricalChart = (instrument, tf) => {
  const [state, setState] = useState({ status: 'loading', series: null, source: null });

  useEffect(() => {
    // Structural unavailability — bail immediately without hitting any API.
    if (!isStructurallyAvailable(instrument, tf)) {
      setState({ status: 'failed', series: null, source: null });
      return;
    }

    const cacheKey = `${instrument.id}:${tf}`;
    const cached = HISTORY_CACHE[cacheKey];
    if (cached) { setState(cached); return; }

    setState({ status: 'loading', series: null, source: null });
    const controller = new AbortController();
    let cancelled = false;

    const fetchData = async () => {
      try {
        let series = null;
        let source = null;

        // ── Crypto intraday/daily: Coinbase candles ──
        const cbSymbol = COINBASE_CANDLES_SYMBOL_MAP[instrument.id];
        if (cbSymbol && CRYPTO_CB_CANDLES[tf]) {
          const { granularity, limit } = CRYPTO_CB_CANDLES[tf];
          const endSec = Math.floor(Date.now() / 1000);
          const startSec = endSec - granularity * limit;
          const url = `https://api.exchange.coinbase.com/products/${cbSymbol}/candles` +
                      `?granularity=${granularity}` +
                      `&start=${new Date(startSec * 1000).toISOString()}` +
                      `&end=${new Date(endSec * 1000).toISOString()}`;
          const r = await fetch(url, { signal: controller.signal });
          if (!r.ok) throw new Error(`Coinbase HTTP ${r.status}`);
          const body = await r.json();
          if (!Array.isArray(body) || body.length === 0) throw new Error('Coinbase empty response');
          // Candle rows: [time, low, high, open, close, volume]. API returns
          // newest-first; sort ascending and extract close.
          const sorted = body.slice().sort((a, b) => a[0] - b[0]);
          series = sorted.map((row, i) => ({
            t: i,
            price: +Number(row[4]).toFixed(instrument.dec),
            v: Number(row[5]) || 0,
          }));
          source = 'coinbase';
        }

        // ── Crypto multi-year zoom: CoinGecko ──
        if (!series) {
          const cgCoin = CG_COIN_MAP[instrument.id];
          if (cgCoin && CG_DAYS_MAP[tf]) {
            const days = CG_DAYS_MAP[tf];
            const url = `https://api.coingecko.com/api/v3/coins/${cgCoin}/market_chart` +
                        `?vs_currency=usd&days=${days}`;
            const r = await fetch(url, { signal: controller.signal });
            if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`);
            const body = await r.json();
            const prices = body?.prices ?? [];
            if (!prices.length) throw new Error('CoinGecko empty response');
            series = prices.map(([, price], i) => ({
              t: i,
              price: +Number(price).toFixed(instrument.dec),
            }));
            source = 'coingecko';
          }
        }

        // ── Energy: generate synthetic historical data anchored to mark ──
        // EIA historical data is unreliable for this demo (stale spike values
        // contaminating the series), so we generate a realistic-looking
        // random walk centered on inst.mark instead.
        if (!series && instrument.cls === 'energy' && EIA_LEN_MAP[tf]) {
          const length = Math.min(EIA_LEN_MAP[tf], 300);
          // Seeded pseudo-random so chart is stable across re-renders for
          // the same instrument+tf (not true random — looks identical each time)
          let seed = 0;
          for (let i = 0; i < instrument.id.length; i++) seed += instrument.id.charCodeAt(i) * (i + 1);
          for (let i = 0; i < tf.length; i++) seed += tf.charCodeAt(i) * (i + 1);
          const rng = () => {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
          };
          // Random walk with mean reversion — visits highs and lows naturally
          // but ends near mark so the live header price matches
          const vol = 0.018;                       // ~1.8% daily vol for oil
          const points = [];
          let p = instrument.mark * (1 - vol * 2);  // start slightly below
          for (let i = 0; i < length; i++) {
            const drift = (instrument.mark - p) * 0.03;  // 3% snap to mark
            const noise = (rng() - 0.5) * 2 * vol * instrument.mark;
            p = Math.max(instrument.mark * 0.75, Math.min(instrument.mark * 1.25, p + drift + noise));
            points.push({ t: i, price: +p.toFixed(instrument.dec) });
          }
          // Force the final bar to end near the mark for realism
          points[points.length - 1].price = +instrument.mark.toFixed(instrument.dec);
          series = points;
          source = 'sim';
        }

        // ── Equities: massive.com aggregates (bars) ──
        // Maps UI timeframes to massive.com multiplier+timespan pairs. Free
        // Massive.com (Polygon) historical aggs endpoint. With the paid Stocks
        // Starter tier ($30/mo) there's no rate limit so we always fetch real
        // data when a key is set. 15-minute delayed bars; full 5-year history.
        if (!series && instrument.cls === 'equity' && MASSIVE_API_KEY) {
          const EQUITY_AGG_MAP = {
            '1m':  { mult: 1,    span: 'minute', range: 1 },   // 1 day of 1m
            '5m':  { mult: 5,    span: 'minute', range: 2 },
            '15m': { mult: 15,   span: 'minute', range: 5 },
            '1h':  { mult: 1,    span: 'hour',   range: 14 },
            '4h':  { mult: 4,    span: 'hour',   range: 60 },
            '1d':  { mult: 1,    span: 'day',    range: 90 },
            '1w':  { mult: 1,    span: 'week',   range: 365 },
            '1M':  { mult: 1,    span: 'month',  range: 1825 },
            '1y':  { mult: 1,    span: 'day',    range: 365 },
            '3y':  { mult: 1,    span: 'week',   range: 1095 },
            '5y':  { mult: 1,    span: 'month',  range: 1825 },
            '10y': { mult: 1,    span: 'month',  range: 3650 },
          };
          const cfg = EQUITY_AGG_MAP[tf];
          if (cfg) {
            const to = new Date();
            const from = new Date(to.getTime() - cfg.range * 24 * 60 * 60 * 1000);
            const toStr = to.toISOString().slice(0, 10);
            const fromStr = from.toISOString().slice(0, 10);
            const url = `https://api.polygon.io/v2/aggs/ticker/${instrument.id}/range/${cfg.mult}/${cfg.span}/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=5000&apiKey=${MASSIVE_API_KEY}`;
            const r = await fetch(url, { signal: controller.signal });
            if (r.ok) {
              const body = await r.json();
              const results = body?.results ?? [];
              if (results.length > 0) {
                series = results.map((bar, i) => ({
                  t: i,
                  price: +Number(bar.c).toFixed(instrument.dec),
                  v: Number(bar.v) || 0,
                }));
                source = 'massive';
              }
            }
          }
        }

        if (cancelled) return;
        if (!series) {
          const failed = { status: 'failed', series: null, source: null };
          HISTORY_CACHE[cacheKey] = failed;
          setState(failed);
          return;
        }

        const ok = { status: 'ok', series, source };
        HISTORY_CACHE[cacheKey] = ok;
        setState(ok);
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return;
        console.warn('[history]', instrument.id, tf, err.message);
        const failed = { status: 'failed', series: null, source: null };
        HISTORY_CACHE[cacheKey] = failed;
        setState(failed);
      }
    };

    fetchData();
    return () => { cancelled = true; controller.abort(); };
  }, [instrument.id, instrument.dec, instrument.cls, tf]);

  return state;
};

const DrawingsPicker = ({ activeTool, onPick, onClose }) => {
  const [tab, setTab] = useState('trend');
  const [query, setQuery] = useState('');
  const tabDef = DRAWING_TAB_DEFS.find(t => t.id === tab) ?? DRAWING_TAB_DEFS[0];
  const list = useMemo(() => {
    if (!query.trim()) return tabDef.tools;
    const q = query.toLowerCase();
    return tabDef.tools.filter(t =>
      t.label.toLowerCase().includes(q) || (t.desc ?? '').toLowerCase().includes(q));
  }, [tabDef, query]);

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-md border overflow-hidden flex flex-col"
           style={{ background: COLORS.surface, borderColor: COLORS.borderHi, width: 640, maxWidth: '95vw', height: '85vh' }}>
        {/* Header */}
        <div className="flex items-center px-4 py-3 border-b shrink-0"
             style={{ borderColor: COLORS.border }}>
          <h2 className="text-[15px] font-medium flex-1" style={{ color: COLORS.text }}>Drawings</h2>
          <button onClick={onClose} className="text-[18px]" style={{ color: COLORS.textDim }}>×</button>
        </div>
        {/* Search */}
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: COLORS.textMute }} />
            <input value={query} onChange={e => setQuery(e.target.value)}
                   placeholder="Search drawings…"
                   className="w-full pl-9 pr-3 py-2 rounded-md outline-none text-[12.5px]"
                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
          </div>
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 pb-3 shrink-0 overflow-x-auto">
          {DRAWING_TAB_DEFS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
                    className="px-3 py-1 rounded-full text-[11.5px] font-medium transition-colors shrink-0"
                    style={{
                      background: tab === t.id ? '#FFFFFF' : 'transparent',
                      color: tab === t.id ? '#000000' : COLORS.textDim,
                      border: tab === t.id ? '1px solid #FFFFFF' : `1px solid ${COLORS.border}`,
                    }}>{t.label}</button>
          ))}
        </div>
        {/* Grid of tool tiles */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {list.map(t => {
              const isActive = activeTool === t.id;
              return (
                <button key={t.id}
                        onClick={() => onPick(t.id)}
                        title={t.desc}
                        className="rounded-md border p-3 text-center transition-all"
                        style={{
                          background: isActive ? 'rgba(61,123,255,0.06)' : COLORS.bg,
                          borderColor: isActive ? COLORS.mint : COLORS.border,
                        }}>
                  <div style={{ fontSize: 22 }}>{t.icon}</div>
                  <div className="text-[11px] mt-1.5"
                       style={{ color: isActive ? COLORS.mint : COLORS.text }}>
                    {t.label}
                  </div>
                  {t.wired === false && (
                    <div className="text-[8.5px] mt-0.5 uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                      Aliased
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="px-4 py-2 border-t text-[10px] text-center shrink-0"
             style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
          All tools are clickable. Tools tagged "Aliased" route to the closest wired primitive (e.g., Ray → trendline, Pitchfork → channel) — toast confirms which.
        </div>
      </div>
    </>
  );
};

// ──────────── Fundamentals Modal ────────────
// Comprehensive fundamentals catalog — Income statement / Balance sheet /
// Cash flow / Statistics — mirrored from the TradingView Fundamentals UI.
// Values are seeded per ticker so they stay stable across renders.

const MoreIndicatorsModal = ({ onClose }) => {
  const [tab, setTab] = useState('indicators'); // indicators / strategies / profiles / patterns
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('imo_indicator_favorites') ?? '[]');
    } catch { return []; }
  });
  // Per-tab favorites are persisted to separate localStorage keys so each
  // tab's "active" set is independent. Chart code reads from these keys
  // (with storage-event polling) to render strategy backtests, volume-
  // profile overlays, and detected patterns.
  const STORAGE_KEYS = {
    indicators: 'imo_indicator_favorites',
    strategies: 'imo_strategy_favorites',
    profiles:   'imo_profile_favorites',
    patterns:   'imo_pattern_favorites',
  };
  // Helper labels for toast messages — describes the visual effect of starring
  const TAB_EFFECT = {
    indicators: 'plotted on the chart',
    strategies: 'backtest signals will appear on the chart',
    profiles:   'volume/TPO overlay added to the chart',
    patterns:   'auto-detection enabled — matches will be highlighted',
  };
  const persistFav = (next) => {
    setFavorites(next);
    try { localStorage.setItem(STORAGE_KEYS[tab] ?? 'imo_indicator_favorites', JSON.stringify(next)); } catch {}
  };
  const toggleFav = (id, item) => {
    const has = favorites.includes(id);
    const next = has ? favorites.filter(x => x !== id) : [...favorites, id];
    persistFav(next);
    // Toast confirmation — different message for each tab and for add vs remove
    const label = item?.name ?? id;
    if (has) {
      window.imoToast?.(`Removed "${label}" from chart`, 'info');
    } else {
      const effect = TAB_EFFECT[tab] ?? 'added to favorites';
      window.imoToast?.(`Added "${label}" — ${effect}`, 'success');
    }
  };
  // When the user switches tabs, reload favorites from the active tab's key
  useEffect(() => {
    try {
      const key = STORAGE_KEYS[tab] ?? 'imo_indicator_favorites';
      const raw = localStorage.getItem(key);
      setFavorites(raw ? JSON.parse(raw) : []);
    } catch { setFavorites([]); }
  }, [tab]);

  const INDICATORS = [
    // Mirrors TradingView's full mobile catalog as of 2026 — alphabetical order,
    // with NEW / UPDATED / BETA tags for the same set TradingView highlights.
    { id: '24h-volume',                name: '24-hour Volume',                desc: 'Trailing 24-hour traded volume' },
    { id: 'accumulation-distribution', name: 'Accumulation/Distribution',     desc: 'Volume-weighted price flow' },
    { id: 'advance-decline-line',      name: 'Advance Decline Line',          desc: 'Net advancing minus declining issues' },
    { id: 'advance-decline-ratio',     name: 'Advance Decline Ratio',         desc: 'Ratio of advancing to declining issues' },
    { id: 'advance-decline-bars',      name: 'Advance/Decline Ratio (Bars)',  desc: 'Bar-form A/D ratio visualization' },
    { id: 'arnaud-legoux-ma',          name: 'Arnaud Legoux Moving Average',  desc: 'Gaussian-weighted moving average' },
    { id: 'aroon',                     name: 'Aroon',                         desc: 'Identifies trend changes via highs/lows lookback' },
    { id: 'aroon-oscillator',          name: 'Aroon Oscillator',              desc: 'Aroon Up minus Aroon Down', tag: 'NEW' },
    { id: 'auto-fib-extension',        name: 'Auto Fib Extension',            desc: 'Auto-detected Fibonacci extension levels' },
    { id: 'auto-fib-retracement',      name: 'Auto Fib Retracement',          desc: 'Auto-detected Fibonacci retracement levels' },
    { id: 'auto-pitchfork',            name: 'Auto Pitchfork',                desc: 'Andrews Pitchfork drawn from auto-detected pivots' },
    { id: 'auto-trendlines',           name: 'Auto Trendlines',               desc: 'Auto-detected support/resistance trendlines', tag: 'BETA' },
    { id: 'avg-daily-range',           name: 'Average Daily Range',           desc: 'Average price range across N days' },
    { id: 'avg-directional-index',     name: 'Average Directional Index',     desc: 'Trend strength gauge (0–100)' },
    { id: 'avg-true-range',            name: 'Average True Range',            desc: 'Volatility measure using true range' },
    { id: 'awesome-oscillator',        name: 'Awesome Oscillator',            desc: 'Bill Williams momentum indicator' },
    { id: 'balance-of-power',          name: 'Balance of Power',              desc: 'Buying vs selling pressure ratio' },
    { id: 'bb-trend',                  name: 'BBTrend',                       desc: 'Trend gauge based on Bollinger Bands width/direction' },
    { id: 'bbands',                    name: 'Bollinger Bands',               desc: '2-σ envelope around 20-period SMA' },
    { id: 'bbands-percent',            name: 'Bollinger Bands %b',            desc: 'Where price sits within the bands' },
    { id: 'bbands-width',              name: 'Bollinger BandWidth',           desc: 'Distance between upper and lower band' },
    { id: 'bollinger-bars',            name: 'Bollinger Bars',                desc: 'Color-codes bars by Bollinger zone', tag: 'NEW' },
    { id: 'bull-bear-power',           name: 'Bull Bear Power',               desc: 'Elder Bull power minus Bear power' },
    { id: 'chaikin',                   name: 'Chaikin Money Flow',            desc: 'Volume-weighted accumulation/distribution' },
    { id: 'chaikin-osc',               name: 'Chaikin Oscillator',            desc: 'MACD applied to Accumulation/Distribution' },
    { id: 'chande-kroll-stop',         name: 'Chande Kroll Stop',             desc: 'Trend-following stop-loss levels' },
    { id: 'chande-momentum',           name: 'Chande Momentum Oscillator',    desc: 'Sum of up/down day price differences' },
    { id: 'chandelier-exit',           name: 'Chandelier Exit',               desc: 'ATR trailing-stop popularised by Chuck LeBeau', tag: 'NEW' },
    { id: 'chop-zone',                 name: 'Chop Zone',                     desc: 'Range/trend regime via slope of EMA34' },
    { id: 'choppiness',                name: 'Choppiness Index',              desc: 'Whether market is trending or sideways' },
    { id: 'cci',                       name: 'Commodity Channel Index',       desc: 'Cyclical mean-reversion oscillator' },
    { id: 'connors-rsi',               name: 'Connors RSI',                   desc: 'Composite of 3 RSI-like measures' },
    { id: 'coppock',                   name: 'Coppock Curve',                 desc: 'Long-term momentum gauge for equity indices' },
    { id: 'correlation-coef',          name: 'Correlation Coefficient',       desc: 'Pearson correlation vs another symbol' },
    { id: 'cum-vol-delta',             name: 'Cumulative Volume Delta',       desc: 'Running sum of buy − sell volume' },
    { id: 'cum-vol-index',             name: 'Cumulative Volume Index',       desc: 'Cumulative net volume of advancing/declining issues' },
    { id: 'dpo',                       name: 'Detrended Price Oscillator',    desc: 'Strips trend to highlight cycles' },
    { id: 'directional-movement',      name: 'Directional Movement Index',    desc: '+DI/-DI/ADX combined' },
    { id: 'donchian',                  name: 'Donchian Channels',             desc: 'High/low envelope over N bars' },
    { id: 'eom',                       name: 'Ease of Movement',              desc: 'Price change relative to volume' },
    { id: 'elder-force',               name: 'Elder Force Index',             desc: 'Volume-weighted price-change momentum' },
    { id: 'envelope',                  name: 'Envelope',                      desc: '%-band channel around an MA' },
    { id: 'fisher-transform',          name: 'Fisher Transform',              desc: 'Sharpens turning points in oscillators' },
    { id: 'gaps',                      name: 'Gaps',                          desc: 'Highlight gaps between bars' },
    { id: 'historical-vol',            name: 'Historical Volatility',         desc: 'Standard deviation of returns' },
    { id: 'hull-ma',                   name: 'Hull Moving Average',           desc: 'Smooth, low-lag moving average' },
    { id: 'ichimoku',                  name: 'Ichimoku Cloud',                desc: 'Multi-component trend, momentum, support/resistance system' },
    { id: 'kama',                      name: "Kaufman's Adaptive Moving Average",desc: 'Volatility-adaptive moving average', tag: 'NEW' },
    { id: 'keltner',                   name: 'Keltner Channels',              desc: 'ATR-based envelope around EMA' },
    { id: 'klinger',                   name: 'Klinger Oscillator',            desc: 'Volume force indicator' },
    { id: 'know-sure-thing',           name: 'Know Sure Thing',               desc: 'Smoothed momentum oscillator' },
    { id: 'lsma',                      name: 'Least Squares Moving Average',  desc: 'Linear regression-based moving average' },
    { id: 'linear-regression',         name: 'Linear Regression Channel',     desc: 'Best-fit channel over N bars' },
    { id: 'ma-cross',                  name: 'MA Cross',                      desc: 'Highlights MA crossovers' },
    { id: 'mass-index',                name: 'Mass Index',                    desc: 'Range-based reversal signal' },
    { id: 'mcginley',                  name: 'McGinley Dynamic',              desc: 'Self-adjusting moving average' },
    { id: 'median',                    name: 'Median',                        desc: 'Median price over N bars' },
    { id: 'momentum',                  name: 'Momentum',                      desc: 'Current close vs N-bars-ago close' },
    { id: 'mfi',                       name: 'Money Flow Index',              desc: 'Volume-weighted RSI' },
    { id: 'moon-phases',               name: 'Moon Phases',                   desc: 'Marker overlay for new/full moons' },
    { id: 'macd',                      name: 'Moving Average Convergence/Divergence', desc: 'MACD: 12-26-9 standard', tag: 'UPDATED' },
    { id: 'ema',                       name: 'Moving Average Exponential',    desc: 'EMA — exponential moving average' },
    { id: 'ma-ribbon',                 name: 'Moving Average Ribbon',         desc: 'Stack of multiple MAs of varying length' },
    { id: 'wma',                       name: 'Moving Average Weighted',       desc: 'Linearly weighted moving average' },
    { id: 'multi-tf-charts',           name: 'Multi-Time Period Charts',      desc: 'Show higher-TF candles inline', tag: 'UPDATED' },
    { id: 'negative-vol-index',        name: 'Negative Volume Index',         desc: 'Smart-money flow on quiet-volume days', tag: 'NEW' },
    { id: 'net-volume',                name: 'Net Volume',                    desc: 'Up volume minus down volume' },
    { id: 'obv',                       name: 'On Balance Volume',             desc: 'Cumulative volume signed by price direction' },
    { id: 'open-interest',             name: 'Open Interest',                 desc: 'Total open contracts (futures/options)' },
    { id: 'parabolic-sar',             name: 'Parabolic SAR',                 desc: 'Trend-following stop-and-reverse system' },
    { id: 'ppo',                       name: 'Percentage Price Oscillator',   desc: '% version of MACD', tag: 'UPDATED' },
    { id: 'pvo',                       name: 'Percentage Volume Oscillator',  desc: '% MACD on volume series', tag: 'UPDATED' },
    { id: 'performance',               name: 'Performance',                   desc: 'Total return since chart start', tag: 'UPDATED' },
    { id: 'pivots-hl',                 name: 'Pivot Points High Low',         desc: 'Local swing highs/lows' },
    { id: 'pivots-standard',           name: 'Pivot Points Standard',         desc: 'Floor-trader pivot levels' },
    { id: 'positive-vol-index',        name: 'Positive Volume Index',         desc: 'Smart-money flow on rising-volume days', tag: 'NEW' },
    { id: 'pmo',                       name: 'Price Momentum Oscillator',     desc: 'Smoothed RoC oscillator (DecisionPoint)', tag: 'NEW' },
    { id: 'price-target',              name: 'Price Target',                  desc: 'Analyst consensus 12m price target' },
    { id: 'pvt',                       name: 'Price Volume Trend',            desc: 'Cumulative price-change × volume' },
    { id: 'prings-special-k',          name: "Pring's Special K",             desc: 'Long-term composite momentum (Martin Pring)', tag: 'NEW' },
    { id: 'rci',                       name: 'Rank Correlation Index',        desc: 'Spearman rank correlation gauge' },
    { id: 'roc',                       name: 'Rate Of Change',                desc: 'Percent change vs N bars ago' },
    { id: 'rci-ribbon',                name: 'RCI Ribbon',                    desc: 'Stack of multi-period RCIs', tag: 'NEW' },
    { id: 'rsi',                       name: 'Relative Strength Index',       desc: 'Wilder RSI, 14-period default' },
    { id: 'rvi',                       name: 'Relative Vigor Index',          desc: 'Closing strength relative to range' },
    { id: 'relative-vol-index',        name: 'Relative Volatility Index',     desc: 'RSI applied to standard deviation' },
    { id: 'rel-volume-time',           name: 'Relative Volume at Time',       desc: 'Volume relative to same time-of-day average' },
    { id: 'rb-intraday-pivots',        name: 'Rob Booker - Intraday Pivot Points', desc: 'Booker intraday pivot levels' },
    { id: 'rb-knoxville',              name: 'Rob Booker - Knoxville Divergence',  desc: 'Booker divergence detector' },
    { id: 'rb-missed-pivots',          name: 'Rob Booker - Missed Pivot Points',   desc: 'Identifies missed pivot retests' },
    { id: 'rb-reversal',               name: 'Rob Booker - Reversal',         desc: 'Booker reversal pattern' },
    { id: 'rb-ziv-ghost',              name: 'Rob Booker - Ziv Ghost Pivots', desc: 'Booker ghost pivot indicator' },
    { id: 'rsi-divergence',            name: 'RSI Divergence Indicator',      desc: 'Auto-detect bullish/bearish RSI divergences' },
    { id: 'seasonality',               name: 'Seasonality',                   desc: 'Average return by calendar window' },
    { id: 'sma',                       name: 'Simple Moving Average',         desc: 'Arithmetic mean over N bars' },
    { id: 'smi-ergodic',               name: 'SMI Ergodic Indicator',         desc: 'TSI-derived signal indicator' },
    { id: 'smi-ergodic-osc',           name: 'SMI Ergodic Oscillator',        desc: 'Histogram form of SMI Ergodic' },
    { id: 'smoothed-ma',               name: 'Smoothed Moving Average',       desc: 'Wilder-style smoothed MA' },
    { id: 'stochastic',                name: 'Stochastic',                    desc: 'Close vs N-period high/low range' },
    { id: 'stoch-momentum',            name: 'Stochastic Momentum Index',    desc: 'Centered stochastic oscillator' },
    { id: 'stochastic-rsi',            name: 'Stochastic RSI',                desc: 'Stochastic applied to RSI values' },
    { id: 'supertrend',                name: 'Supertrend',                    desc: 'ATR-based trend filter' },
    { id: 'tech-ratings',              name: 'Technical Ratings',             desc: 'Composite buy/sell rating from MAs + oscillators' },
    { id: 'twap',                      name: 'Time Weighted Average Price',   desc: 'Average price weighted equally by time' },
    { id: 'trading-sessions',          name: 'Trading Sessions',              desc: 'Highlight pre-/post-/regular sessions on chart' },
    { id: 'trend-strength-index',      name: 'Trend Strength Index',          desc: 'Composite trend gauge' },
    { id: 'triple-ema',                name: 'Triple EMA',                    desc: 'TEMA — low-lag triple-smoothed EMA' },
    { id: 'trix',                      name: 'TRIX',                          desc: 'Triple-smoothed exponential rate of change' },
    { id: 'tsi',                       name: 'True Strength Index',           desc: 'Double-smoothed momentum oscillator' },
    { id: 'ulcer-index',               name: 'Ulcer Index',                   desc: 'Drawdown-based volatility gauge', tag: 'NEW' },
    { id: 'ultimate-osc',              name: 'Ultimate Oscillator',           desc: 'Multi-timeframe momentum (Larry Williams)' },
    { id: 'up-down-volume',            name: 'Up/Down Volume',                desc: 'Volume coloured by up vs down bar' },
    { id: 'visible-avg-price',         name: 'Visible Average Price',         desc: 'Average price over visible bars' },
    { id: 'volatility-stop',           name: 'Volatility Stop',               desc: 'ATR-based trailing stop' },
    { id: 'volume',                    name: 'Volume',                        desc: 'Per-bar trade volume' },
    { id: 'volume-delta',              name: 'Volume Delta',                  desc: 'Buying vs selling volume difference' },
    { id: 'vwap-indicator',            name: 'Volume Weighted Average Price', desc: 'Standard VWAP' },
    { id: 'vwma',                      name: 'Volume Weighted Moving Average',desc: 'MA weighted by volume' },
    { id: 'vortex',                    name: 'Vortex Indicator',              desc: 'Trend direction via VI+ / VI−' },
    { id: 'vwap-auto-anchored',        name: 'VWAP Auto Anchored',            desc: 'VWAP anchored to detected pivots' },
    { id: 'volume-profile',            name: 'Volume Profile',                desc: 'Volume distribution by price level' },
    { id: 'volume-profile-vertical',   name: 'Volume Profile (Vertical)',     desc: 'Horizontal volume bars at each price level on chart right' },
    { id: 'vwap',                      name: 'VWAP',                          desc: 'Volume-weighted average price' },
    { id: 'williams-alligator',        name: 'Williams Alligator',            desc: 'Three smoothed MAs (Bill Williams)' },
    { id: 'williams-fractals',         name: 'Williams Fractals',             desc: 'Bill Williams fractal pivots' },
    { id: 'williams-r',                name: 'Williams %R',                   desc: 'Stochastic-derivative momentum oscillator' },
    { id: 'woodies-cci',               name: 'Woodies CCI',                   desc: "Ken Wood's CCI variant with trendline" },
    { id: 'zigzag',                    name: 'ZigZag',                        desc: 'Filters out small price moves to highlight swings' },
    { id: 'kdj',                       name: 'KDJ',                           desc: 'Stochastic-derivative oscillator popular in Asia' },
    { id: 'price-oscillator',          name: 'Price Oscillator',              desc: 'Difference between two MAs' },
    { id: 'pivot-points',              name: 'Pivot Points',                  desc: 'Support/resistance levels from prior session HLC' },
  ];
  const STRATEGIES = [
    { id: 'bar-up-dn',         name: 'BarUpDn Strategy',                desc: 'Buy on consecutive up bars, sell on down' },
    { id: 'bbands-strat',      name: 'Bollinger Bands Strategy',        desc: 'Mean-reversion using ±2σ bands' },
    { id: 'bbands-strat-dir',  name: 'Bollinger Bands Strategy direction', desc: 'Directional Bollinger band cross' },
    { id: 'channel-breakout',  name: 'ChannelBreakOutStrategy',         desc: 'Long on N-bar high breakout' },
    { id: 'consecutive-updown',name: 'Consecutive Up/Down Strategy',    desc: 'Reverse on N consecutive same-direction bars' },
    { id: 'greedy-strat',      name: 'Greedy Strategy',                 desc: 'Take small profits frequently' },
    { id: 'inside-bar',        name: 'InSide Bar Strategy',             desc: 'Trade breakouts of inside bars' },
    { id: 'keltner-strat',     name: 'Keltner Channels Strategy',       desc: 'ATR-envelope breakout system' },
    { id: 'macd-strat',        name: 'MACD Strategy',                   desc: 'Long on signal-line crossover' },
    { id: 'momentum-strat',    name: 'Momentum Strategy',               desc: 'Long when momentum > 0' },
    { id: 'ma2-cross',         name: 'MovingAvg2Line Cross',            desc: 'Fast/slow MA crossover' },
    { id: 'ma-cross',          name: 'MovingAvg Cross',                 desc: 'Price/MA crossover entry' },
    { id: 'outside-bar',       name: 'OutSide Bar Strategy',            desc: 'Trade breakouts of outside bars' },
    { id: 'parabolic-sar-strat',name: 'Parabolic SAR Strategy',         desc: 'Trend-follow with SAR stops' },
    { id: 'pivot-extension',   name: 'Pivot Extension Strategy',        desc: 'Trade breakouts of prior pivot levels' },
    { id: 'pivot-reversal',    name: 'Pivot Reversal Strategy',         desc: 'Reverse at recent pivot levels' },
    { id: 'price-channel',     name: 'Price Channel Strategy',          desc: 'Donchian channel breakout' },
    { id: 'rob-booker-adx',    name: 'Rob Booker - ADX Breakout',       desc: 'ADX-confirmed breakout system' },
    { id: 'rsi-strat',         name: 'RSI Strategy',                    desc: 'Long below 30, short above 70' },
    { id: 'stochastic-slow',   name: 'Stochastic Slow Strategy',        desc: 'Slow stochastic crossover' },
    { id: 'supertrend-strat',  name: 'Supertrend Strategy',             desc: 'Trend-following with ATR stops' },
    { id: 'tech-ratings-strat',name: 'Technical Ratings Strategy',      desc: 'Composite indicator vote' },
    { id: 'volty-expan',       name: 'Volty Expan Close Strategy',      desc: 'Volatility-expansion close entry' },
    { id: 'sma-cross',         name: 'SMA Crossover',                   desc: 'Long when SMA 50 crosses above SMA 200' },
    { id: 'turtle',            name: 'Turtle Trading',                  desc: 'Donchian breakout system' },
    { id: 'mean-reversion',    name: 'Bollinger Reversion',             desc: 'Fade moves to outer bands' },
    { id: 'pairs',             name: 'Pairs Trading',                   desc: 'Long/short cointegrated pairs' },
  ];
  const PROFILES = [
    { id: 'tpo',                  name: 'Time Price Opportunity',       desc: 'Classic Market Profile letters' },
    { id: 'session-tpo',          name: 'Session Time Price Opportunity',desc: 'TPO for current session' },
    { id: 'auto-anchored-vol',    name: 'Auto Anchored Volume Profile', desc: 'Auto-anchored to swing pivots' },
    { id: 'fixed-range-vol',      name: 'Fixed Range Volume Profile',   desc: 'Volume distribution over a fixed bar range' },
    { id: 'periodic-vol',         name: 'Periodic Volume Profile',      desc: 'Repeating volume profile per period' },
    { id: 'session-volume',       name: 'Session Volume Profile',       desc: 'Volume profile for current session' },
    { id: 'session-volume-hd',    name: 'Session Volume Profile HD',    desc: 'High-resolution session volume profile' },
    { id: 'visible-range-vol',    name: 'Visible Range Volume Profile', desc: 'Volume traded across visible bars' },
  ];
  const PATTERNS = [
    // Chart patterns
    { id: 'all-chart-patterns',name: 'All Chart Patterns',             desc: 'Match every supported chart pattern', section: 'Chart' },
    { id: 'bear-flag',         name: 'Bearish Flag Chart Pattern',     desc: 'Continuation pattern (bearish)', section: 'Chart' },
    { id: 'bull-flag',         name: 'Bullish Flag Chart Pattern',     desc: 'Continuation pattern (bullish)', section: 'Chart' },
    { id: 'cup-handle',        name: 'Cup and Handle Chart Pattern',   desc: 'Bullish continuation (Bill O\'Neil)', section: 'Chart' },
    { id: 'inv-cup-handle',    name: 'Inverted Cup and Handle Chart Pattern', desc: 'Bearish continuation', section: 'Chart' },
    { id: 'double-bottom',     name: 'Double Bottom Chart Pattern',    desc: 'Bullish reversal — twin lows', section: 'Chart' },
    { id: 'double-top',        name: 'Double Top Chart Pattern',       desc: 'Bearish reversal — twin highs', section: 'Chart' },
    { id: 'elliott-wave',      name: 'Elliott Wave Chart Pattern',     desc: 'Detect 5-wave Elliott structure', section: 'Chart' },
    { id: 'head-shoulders',    name: 'Head and Shoulders Chart Pattern', desc: 'Bearish reversal pattern', section: 'Chart' },
    { id: 'inv-head-shoulders',name: 'Inverted Head and Shoulders Chart Pattern', desc: 'Bullish reversal pattern', section: 'Chart' },
    { id: 'bear-pennant',      name: 'Bearish Pennant Chart Pattern',  desc: 'Continuation triangle (bearish)', section: 'Chart' },
    { id: 'bull-pennant',      name: 'Bullish Pennant Chart Pattern',  desc: 'Continuation triangle (bullish)', section: 'Chart' },
    { id: 'rectangle',         name: 'Rectangle Chart Pattern',        desc: 'Range-bound consolidation', section: 'Chart' },
    { id: 'triangle',          name: 'Triangle Chart Pattern',         desc: 'Symmetric triangle', section: 'Chart' },
    { id: 'triple-bottom',     name: 'Triple Bottom Chart Pattern',    desc: 'Bullish reversal — three lows', section: 'Chart' },
    { id: 'triple-top',        name: 'Triple Top Chart Pattern',       desc: 'Bearish reversal — three highs', section: 'Chart' },
    { id: 'falling-wedge',     name: 'Falling Wedge Chart Pattern',    desc: 'Bullish reversal pattern', section: 'Chart' },
    { id: 'rising-wedge',      name: 'Rising Wedge Chart Pattern',     desc: 'Bearish reversal pattern', section: 'Chart' },
    { id: 'auto-trend',        name: 'Auto Trend Detector', tag: 'NEW', desc: 'Auto-detect trend direction', section: 'Chart' },
    // Candlestick patterns
    { id: 'all-candle-patterns',name: '*All Candlestick Patterns*',    desc: 'Match every candlestick pattern', section: 'Candlestick' },
    { id: 'abandoned-baby-bear',name: 'Abandoned Baby - Bearish',      desc: 'Three-candle bearish reversal', section: 'Candlestick' },
    { id: 'abandoned-baby-bull',name: 'Abandoned Baby - Bullish',      desc: 'Three-candle bullish reversal', section: 'Candlestick' },
    { id: 'dark-cloud-bear',   name: 'Dark Cloud Cover - Bearish',     desc: 'Bearish reversal after up-trend', section: 'Candlestick' },
    { id: 'doji',              name: 'Doji',                           desc: 'Open ≈ close — indecision', section: 'Candlestick' },
    { id: 'doji-star-bear',    name: 'Doji Star - Bearish',            desc: 'Doji at top of trend', section: 'Candlestick' },
    { id: 'doji-star-bull',    name: 'Doji Star - Bullish',            desc: 'Doji at bottom of trend', section: 'Candlestick' },
    { id: 'downside-tasuki',   name: 'Downside Tasuki Gap - Bearish',  desc: 'Bearish continuation after gap', section: 'Candlestick' },
    { id: 'dragonfly-doji',    name: 'Dragonfly Doji - Bullish',       desc: 'Doji with long lower wick', section: 'Candlestick' },
    { id: 'engulfing-bear',    name: 'Engulfing - Bearish',            desc: 'Bear body fully engulfs prior bull body', section: 'Candlestick' },
    { id: 'engulfing-bull',    name: 'Engulfing - Bullish',            desc: 'Bull body fully engulfs prior bear body', section: 'Candlestick' },
    { id: 'evening-doji-star', name: 'Evening Doji Star - Bearish',    desc: 'Three-candle bearish reversal w/ doji', section: 'Candlestick' },
    { id: 'evening-star',      name: 'Evening Star - Bearish',         desc: 'Three-candle bearish reversal', section: 'Candlestick' },
    { id: 'falling-three',     name: 'Falling Three Methods - Bearish',desc: 'Bearish continuation', section: 'Candlestick' },
    { id: 'falling-window',    name: 'Falling Window - Bearish',       desc: 'Gap-down continuation', section: 'Candlestick' },
    { id: 'gravestone-doji',   name: 'Gravestone Doji - Bearish',      desc: 'Doji with long upper wick', section: 'Candlestick' },
    { id: 'hammer',            name: 'Hammer - Bullish',               desc: 'Long lower wick — bullish reversal', section: 'Candlestick' },
    { id: 'hanging-man',       name: 'Hanging Man - Bearish',          desc: 'Hammer at top — bearish reversal', section: 'Candlestick' },
    { id: 'harami-bear',       name: 'Harami - Bearish',               desc: 'Small body inside prior larger body', section: 'Candlestick' },
    { id: 'harami-bull',       name: 'Harami - Bullish',               desc: 'Small body inside prior larger body', section: 'Candlestick' },
    { id: 'harami-cross-bear', name: 'Harami Cross - Bearish',         desc: 'Harami where second is a doji', section: 'Candlestick' },
    { id: 'harami-cross-bull', name: 'Harami Cross - Bullish',         desc: 'Harami where second is a doji', section: 'Candlestick' },
    { id: 'inverted-hammer',   name: 'Inverted Hammer - Bullish',      desc: 'Long upper wick at bottom', section: 'Candlestick' },
    { id: 'kicking-bear',      name: 'Kicking - Bearish',              desc: 'Two opposing marubozu', section: 'Candlestick' },
    { id: 'kicking-bull',      name: 'Kicking - Bullish',              desc: 'Two opposing marubozu', section: 'Candlestick' },
    { id: 'long-lower-shadow', name: 'Long Lower Shadow - Bullish',    desc: 'Lower wick > 2× body', section: 'Candlestick' },
    { id: 'long-upper-shadow', name: 'Long Upper Shadow - Bearish',    desc: 'Upper wick > 2× body', section: 'Candlestick' },
    { id: 'marubozu-black',    name: 'Marubozu Black - Bearish',       desc: 'Solid bear body, no wicks', section: 'Candlestick' },
    { id: 'marubozu-white',    name: 'Marubozu White - Bullish',       desc: 'Solid bull body, no wicks', section: 'Candlestick' },
    { id: 'morning-doji-star', name: 'Morning Doji Star - Bullish',    desc: 'Three-candle bullish reversal w/ doji', section: 'Candlestick' },
    { id: 'morning-star',      name: 'Morning Star - Bullish',         desc: 'Three-candle bullish reversal', section: 'Candlestick' },
    { id: 'on-neck',           name: 'On Neck - Bearish',              desc: 'Bear continuation pattern', section: 'Candlestick' },
    { id: 'piercing',          name: 'Piercing - Bullish',             desc: 'Bullish reversal — close above midpoint', section: 'Candlestick' },
    { id: 'rising-three',      name: 'Rising Three Methods - Bullish', desc: 'Bullish continuation', section: 'Candlestick' },
    { id: 'rising-window',     name: 'Rising Window - Bullish',        desc: 'Gap-up continuation', section: 'Candlestick' },
    { id: 'shooting-star',     name: 'Shooting Star - Bearish',        desc: 'Inverted hammer at top', section: 'Candlestick' },
    { id: 'spinning-top-black',name: 'Spinning Top Black - Bearish',   desc: 'Small bear body, long wicks', section: 'Candlestick' },
    { id: 'spinning-top-white',name: 'Spinning Top White - Bullish',   desc: 'Small bull body, long wicks', section: 'Candlestick' },
    { id: 'three-black-crows', name: 'Three Black Crows - Bearish',    desc: 'Three consecutive bear bars', section: 'Candlestick' },
    { id: 'three-white-soldiers',name: 'Three White Soldiers - Bullish',desc: 'Three consecutive bull bars', section: 'Candlestick' },
    { id: 'tri-star-bear',     name: 'Tri-Star - Bearish',             desc: 'Three consecutive doji at top', section: 'Candlestick' },
    { id: 'tri-star-bull',     name: 'Tri-Star - Bullish',             desc: 'Three consecutive doji at bottom', section: 'Candlestick' },
    { id: 'tweezer-bottom',    name: 'Tweezer Bottom - Bullish',       desc: 'Twin lows — bullish reversal', section: 'Candlestick' },
    { id: 'tweezer-top',       name: 'Tweezer Top - Bearish',          desc: 'Twin highs — bearish reversal', section: 'Candlestick' },
  ];
  const all = { indicators: INDICATORS, strategies: STRATEGIES, profiles: PROFILES, patterns: PATTERNS };
  // Programmatic sub-categorization by name keyword. Keeps the existing
  // INDICATORS list declarative; just adds a derived `subcategory` field
  // when the modal renders. Categories cover the main TA families.
  const indicatorSubcategory = (item) => {
    const n = (item.name + ' ' + (item.desc ?? '')).toLowerCase();
    if (/(rsi|stochastic|momentum|cci|williams|kdj|relative strength|chaikin|awesome|momentum|roc|tsi|coppock|ultimate)/i.test(n)) return 'Momentum';
    if (/(volume|volumetric|obv|accumulation|distribution|chaikin money|money flow|ease of move|vwap)/i.test(n)) return 'Volume';
    if (/(bollinger|atr|true range|volatility|deviation|envelope|keltner|donchian|chandelier)/i.test(n)) return 'Volatility';
    if (/(moving average|sma|ema|wma|hma|tema|dema|alma|kama|frama|mcginley|trend|adx|aroon|supertrend|ichimoku|parabolic|ssma)/i.test(n)) return 'Trend';
    if (/(pivot|fibonacci|gann|support|resistance|zigzag|swing|fractal|range)/i.test(n)) return 'Support/Resistance';
    if (/(macd|signal|divergence|oscillat|stochastic)/i.test(n)) return 'Oscillator';
    return 'Other';
  };
  const strategySubcategory = (item) => {
    const n = (item.name + ' ' + (item.desc ?? '')).toLowerCase();
    if (/(breakout|channel|donchian|range)/i.test(n)) return 'Breakout';
    if (/(cross|crossover)/i.test(n)) return 'Crossover';
    if (/(reversion|reverse|bollinger)/i.test(n)) return 'Mean Reversion';
    if (/(rsi|momentum|stochastic|adx)/i.test(n)) return 'Momentum';
    if (/(pivot|sar|trend)/i.test(n)) return 'Trend';
    return 'Other';
  };
  const patternSubcategory = (item) => item.section ?? 'Other';
  const subcatFor = (item) => {
    if (tab === 'indicators') return indicatorSubcategory(item);
    if (tab === 'strategies') return strategySubcategory(item);
    if (tab === 'patterns')   return patternSubcategory(item);
    return 'All';
  };
  // Selected sub-category — when 'All', no filter
  const [subCat, setSubCat] = useState('All');
  // Available sub-categories for the current tab
  const subCats = useMemo(() => {
    if (tab === 'profiles') return [];
    const set = new Set(['All']);
    (all[tab] ?? []).forEach(it => set.add(subcatFor(it)));
    return Array.from(set);
  }, [tab, all]);
  // Reset subcat when tab changes
  useEffect(() => { setSubCat('All'); }, [tab]);
  const list = (all[tab] ?? [])
    .filter(it => !query.trim() || it.name.toLowerCase().includes(query.toLowerCase()))
    .filter(it => subCat === 'All' || subcatFor(it) === subCat);

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-md border overflow-hidden flex flex-col"
           style={{ background: COLORS.surface, borderColor: COLORS.borderHi, width: 560, maxWidth: '95vw', height: '85vh' }}>
        {/* Header */}
        <div className="flex items-center px-4 py-3 border-b shrink-0"
             style={{ borderColor: COLORS.border }}>
          <button onClick={onClose} className="text-[18px] mr-2" style={{ color: COLORS.textDim }}>‹</button>
          <h2 className="text-[15px] font-medium flex-1" style={{ color: COLORS.text }}>Technicals</h2>
          <button onClick={onClose} className="text-[18px]" style={{ color: COLORS.textDim }}>×</button>
        </div>
        {/* Search */}
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: COLORS.textMute }} />
            <input value={query}
                   onChange={e => setQuery(e.target.value)}
                   placeholder="Search"
                   className="w-full pl-9 pr-3 py-2 rounded-md outline-none text-[12.5px]"
                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
          </div>
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 pb-3 shrink-0 overflow-x-auto">
          {[
            { id: 'indicators', label: 'Indicators' },
            { id: 'strategies', label: 'Strategies' },
            { id: 'profiles',   label: 'Profiles' },
            { id: 'patterns',   label: 'Patterns' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
                    className="px-3 py-1 rounded-full text-[11.5px] font-medium transition-colors shrink-0"
                    style={{
                      background: tab === t.id ? '#FFFFFF' : 'transparent',
                      color: tab === t.id ? '#000000' : COLORS.textDim,
                      border: tab === t.id ? '1px solid #FFFFFF' : `1px solid ${COLORS.border}`,
                    }}>{t.label}</button>
          ))}
        </div>
        {/* Sub-category chips — Momentum / Volume / Trend / etc. for indicators;
            Breakout / Crossover / Mean Reversion / etc. for strategies;
            Candlestick / Chart for patterns. Hidden for profiles tab. */}
        {subCats.length > 1 && (
          <div className="flex items-center gap-1 px-4 pb-3 shrink-0 overflow-x-auto">
            {subCats.map(c => (
              <button key={c} onClick={() => setSubCat(c)}
                      className="px-2.5 py-0.5 rounded-full text-[10.5px] transition-colors shrink-0"
                      style={{
                        background: subCat === c ? COLORS.mint : COLORS.bg,
                        color: subCat === c ? '#FFFFFF' : COLORS.textDim,
                        border: subCat === c ? `1px solid ${COLORS.mint}` : `1px solid ${COLORS.border}`,
                      }}>
                {c}
              </button>
            ))}
          </div>
        )}
        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {list.length === 0 ? (
            <div className="text-center py-12 text-[12px]" style={{ color: COLORS.textMute }}>No matches</div>
          ) : (() => {
            const rendered = [];
            let lastSection = null;
            list.forEach((it) => {
              if (it.section && it.section !== lastSection) {
                rendered.push(
                  <div key={`section-${it.section}`}
                       className="px-4 pt-3 pb-1.5 text-[9.5px] font-semibold uppercase tracking-wider"
                       style={{ color: COLORS.textMute, background: COLORS.bg }}>
                    {it.section} Patterns
                  </div>
                );
                lastSection = it.section;
              }
              rendered.push(
                <div key={it.id}
                     className="flex items-center gap-3 px-4 py-2.5 border-b hover:bg-white/[0.02]"
                     style={{ borderColor: COLORS.border }}>
                  <button onClick={() => toggleFav(it.id, it)}
                          className="text-[16px] transition-transform"
                          title={favorites.includes(it.id) ? 'Remove from chart' : (tab === 'indicators' && INDICATOR_IMPLS[it.id]) ? 'Add to chart' : 'Add to favorites'}>
                    {favorites.includes(it.id) ? '⭐' : '☆'}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px]" style={{ color: COLORS.text }}>{it.name}</span>
                      {/* Show a small badge when this item is wired to the
                          chart engine. Indicators show overlay/panel,
                          strategies/profiles/patterns show "active" when starred. */}
                      {tab === 'indicators' && INDICATOR_IMPLS[it.id] && (
                        <span title="Plots on chart when starred"
                              className="text-[8px] px-1 py-0.5 rounded uppercase tracking-wider"
                              style={{ background: 'rgba(61,123,255,0.12)', color: COLORS.mint }}>
                          {INDICATOR_IMPLS[it.id].panel === 'overlay' ? 'overlay' : 'panel'}
                        </span>
                      )}
                      {tab !== 'indicators' && favorites.includes(it.id) && (
                        <span title={`This ${tab.slice(0, -1)} is active on your chart`}
                              className="text-[8px] px-1 py-0.5 rounded uppercase tracking-wider"
                              style={{ background: 'rgba(61,123,255,0.12)', color: COLORS.mint }}>
                          active
                        </span>
                      )}
                      {it.tag && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                              style={{
                                background: it.tag === 'NEW' ? '#FB923C' : it.tag === 'BETA' ? '#3B3B3B' : it.tag === 'UPDATED' ? 'rgba(74,222,128,0.15)' : COLORS.border,
                                color: it.tag === 'NEW' ? '#16191E' : it.tag === 'BETA' ? '#D4D4D8' : it.tag === 'UPDATED' ? '#4ADE80' : COLORS.textDim,
                              }}>
                          {it.tag}
                        </span>
                      )}
                    </div>
                    <div className="text-[10.5px] truncate" style={{ color: COLORS.textMute }}>{it.desc}</div>
                  </div>
                  <button title="Help"
                          onClick={() => {
                            const wired = INDICATOR_IMPLS[it.id];
                            const wiredNote = wired
                              ? `Wired to chart (${wired.panel === 'overlay' ? 'overlay' : 'sub-panel'}, ${wired.lines.length} line${wired.lines.length === 1 ? '' : 's'})`
                              : tab === 'strategies' ? 'Strategy — generates entry/exit signals on the chart when starred'
                              : tab === 'profiles'   ? 'Volume profile — overlays vol-by-price distribution when starred'
                              : tab === 'patterns'   ? 'Pattern detector — highlights matches in the visible range when starred'
                              : 'In catalog — starring bookmarks for later';
                            window.imoToast?.(`${it.name} — ${wiredNote}`, 'info');
                          }}
                          className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center hover:bg-white/[0.08] transition-colors"
                          style={{ background: COLORS.bg, color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                    ?
                  </button>
                </div>
              );
            });
            return rendered;
          })()}
        </div>
        <div className="px-4 py-2 border-t text-[10px] text-center shrink-0"
             style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
          ⭐ Star an indicator to add it to your chart · {favorites.filter(id => INDICATOR_IMPLS[id]).length} active · {favorites.length} favorited
        </div>
      </div>
    </>
  );
};


const IndicatorToggle = ({ label, color, active, onToggle, tooltip }) => (
  <button
    onClick={onToggle}
    title={tooltip}
    className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] rounded border transition-colors"
    style={{
      borderColor: active ? color : COLORS.border,
      color: active ? color : COLORS.textDim,
      background: active ? `${color}10` : 'transparent',
    }}
  >
    <span className="inline-block w-2 h-0.5" style={{ background: active ? color : COLORS.textMute }} />
    {label}
  </button>
);


const PanelToggle = ({ label, active, onToggle, tooltip }) => (
  <button
    onClick={onToggle}
    title={tooltip}
    className="px-2 py-0.5 text-[10px] rounded border transition-colors"
    style={{
      borderColor: active ? COLORS.mint : COLORS.border,
      color: active ? COLORS.mint : COLORS.textDim,
      background: active ? 'rgba(61,123,255,0.06)' : 'transparent',
    }}
  >{label}</button>
);


/* ──────────── Order Book (clips overflow) ──────────── */


export const Chart = ({
  instrument,
  livePrice,
  instanceId,
  // subcharts state is owned by ChartWithSubcharts but the AI Edit
  // operations need read+write access to apply add/remove/switch
  // commands. We accept them as props with no-op defaults so a
  // standalone <Chart /> still renders without crashing the AI Edit
  // pipeline (which references subcharts.map at the top of runAiEdit
  // for every request, vague or specific).
  subcharts: subchartsProp,
  setSubcharts: setSubchartsProp,
  pageIdx: pageIdxProp,
  setPageIdx: setPageIdxProp,
  // user — used to default the chart style based on profile.experience.
  // Novice users get the line/area chart (less visual noise, easier to
  // read trend at a glance); intermediate/advanced default to candle.
  // The user can still flip via the chart-style picker; this only
  // controls the initial value. localStorage stores per-user override
  // so explicit picks persist across sessions.
  user,
  // account — needed so we can render entry markers on the chart
  // for any open positions in this instrument. Each position drops
  // a horizontal-axis dot at the entry price + entry timestamp so
  // the user can visually anchor "where I bought/sold this" against
  // the price history. Optional — chart still renders without
  // markers if account is missing.
  account,
}) => {
  // Hoist props into local names so the existing runAiEdit code paths
  // continue to work without rewriting a hundred references.
  const subcharts = subchartsProp ?? [];
  const setSubcharts = setSubchartsProp ?? (() => {});
  const pageIdx = pageIdxProp ?? 0;
  const setPageIdx = setPageIdxProp ?? (() => {});
  // Active timeframe button id ('1H', '1D', '1W', '1M', '3M', '1Y', '5Y', '10Y').
  // Each button represents a WINDOW (e.g. "last 7 days"). The window is
  // converted to a bar size + bar count below so the chart fetches +
  // displays exactly that span.
  const [tf, setTf] = useState('1D');
  // Resolve the active window to bar size + bar count
  const tfDef = useMemo(() => TIMEFRAMES.find(t => t.id === tf) ?? TIMEFRAMES[1], [tf]);
  // visibleBars derives from the chosen window's `bars` field by default.
  // The user can override via the Range dropdown to zoom in/out without
  // changing the bar size.
  const [visibleBars, setVisibleBars] = useState(tfDef.bars);
  // Frequency / interval state — separates "how big is each candle" from
  // "what's the time range". Defaults to the active range's recommended
  // interval. Becomes "sticky" once the user manually overrides; sticky
  // stays in effect across range changes UNTIL the new range can't
  // legally support it (e.g. 1m on a 5Y range), at which point we fall
  // back to the new range's default.
  const [freqInterval, setFreqInterval] = useState(() => tfDef.barTf);
  const [freqSticky, setFreqSticky] = useState(false);
  // EFFECTIVE bar size — when the user has overridden the frequency
  // (sticky), use their pick; otherwise use the range's default. Per
  // UX feedback the Frequency selector previously had no effect on
  // the chart because the chart fetched with `tfDef.barTf` directly.
  // Now `barTf` derives from freqInterval so picking 5m vs 1h
  // actually changes the candle resolution the chart fetches.
  const barTf = freqSticky ? freqInterval : tfDef.barTf;
  // When tf changes, snap visible bars back to the window's natural span
  useEffect(() => {
    setVisibleBars(tfDef.bars);
    // Reconcile frequency via the extracted helper. When the new range
    // can't legally support the previously-sticky frequency, this drops
    // sticky and falls back to the new range's default. See chart-config.js
    // for the precise rule + tests.
    const { interval, sticky } = reconcileFrequency(tf, freqInterval, freqSticky);
    if (interval !== freqInterval) setFreqInterval(interval);
    if (sticky !== freqSticky) setFreqSticky(sticky);
  }, [tf, tfDef.bars, tfDef.barTf]);
  const { status, series, source } = useHistoricalChart(instrument, barTf);

  // Track failures per timeframe. Only disable a timeframe after 2+
  // consecutive failures (a single AbortError or transient network blip
  // shouldn't make a button permanently disabled). On instrument change,
  // reset everything so the user can retry.
  const [failureCounts, setFailureCounts] = useState(() => ({}));
  const [failedTfs, setFailedTfs] = useState(() => new Set());
  useEffect(() => {
    setFailedTfs(new Set());
    setFailureCounts({});
  }, [instrument.id]);
  useEffect(() => {
    if (status === 'failed' && isStructurallyAvailable(instrument, barTf)) {
      setFailureCounts(prev => {
        const next = { ...prev, [tf]: (prev[tf] ?? 0) + 1 };
        // Only mark as failed after 3+ consecutive failures
        if (next[tf] >= 3) {
          setFailedTfs(s => {
            if (s.has(tf)) return s;
            const ns = new Set(s);
            ns.add(tf);
            return ns;
          });
        }
        return next;
      });
    } else if (status === 'ok') {
      // Successful load — clear any failure tracking for this timeframe
      setFailureCounts(prev => {
        if (!prev[tf]) return prev;
        const next = { ...prev };
        delete next[tf];
        return next;
      });
      setFailedTfs(s => {
        if (!s.has(tf)) return s;
        const ns = new Set(s);
        ns.delete(tf);
        return ns;
      });
    }
  }, [status, tf, barTf, instrument]);

  // If the user switches to an instrument where the current window's bar
  // size is structurally unsupported, fall back to a 1-day window which is
  // universally supported.
  useEffect(() => {
    const def = TIMEFRAMES.find(t => t.id === tf);
    if (def && !isStructurallyAvailable(instrument, def.barTf)) setTf('1D');
  }, [instrument.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isTfDisabled = (tfId) => {
    const def = TIMEFRAMES.find(t => t.id === tfId);
    if (def && !isStructurallyAvailable(instrument, def.barTf)) return true;
    if (failedTfs.has(tfId)) return true;
    return false;
  };

  const tfDisabledReason = (tfId) => {
    const def = TIMEFRAMES.find(t => t.id === tfId);
    if (def && !isStructurallyAvailable(instrument, def.barTf)) {
      return 'Not supported for this market — EIA provides only daily data';
    }
    if (failedTfs.has(tfId)) return 'Data unavailable for this market';
    return null;
  };

  // ───── Analysis tool state ─────
  // Indicators that overlay on the main chart
  const [showSma20, setShowSma20] = useState(false);
  const [showSma50, setShowSma50] = useState(false);
  const [showEma12, setShowEma12] = useState(false);
  const [showEma26, setShowEma26] = useState(false);
  // Sub-panels below the chart (only one at a time to keep layout simple)
  const [subPanel, setSubPanel] = useState(null); // null | 'rsi' | 'macd' | 'volume'
  // Volume bubbles overlay — circles on the chart sized by per-bar volume.
  // A volume profile alternative that's more visually integrated with price.
  const [showVolumeBubbles, setShowVolumeBubbles] = useState(false);
  // Selected volume bubble (when clicked) — shows volume + price popover
  const [bubbleSelected, setBubbleSelected] = useState(null);
  // Chart style: 'candle' (TradingView-style OHLC bars) or 'line' (area chart)
  // Initial value is profile-aware: novice users get a clean line/area
  // chart (less visual noise, easier to read trend at a glance);
  // intermediate/advanced default to candles. We read from a per-user
  // override first, then fall back to the profile-derived default —
  // so users who explicitly pick a style keep their choice across
  // sessions even if their profile changes.
  const [chartStyle, setChartStyle] = useState(() => {
    const username = user?.username ?? 'guest';
    try {
      const override = localStorage.getItem(`imo_chart_style_${username}`);
      if (override === 'candle' || override === 'line' || override === 'ha' || override === 'renko' || override === 'lb') {
        return override;
      }
    } catch {}
    const exp = user?.profile?.experience ?? 'novice';
    return exp === 'novice' ? 'line' : 'candle';
  });
  // Persist explicit picks so the user's choice sticks across reloads.
  useEffect(() => {
    const username = user?.username ?? 'guest';
    try { localStorage.setItem(`imo_chart_style_${username}`, chartStyle); } catch {}
  }, [chartStyle, user?.username]);
  // Active drawing tool from the left vertical toolbar
  // 'crosshair' (default) | 'trendline' | 'hline' | 'ruler' | 'text' | 'eraser'
  const [activeTool, setActiveTool] = useState('crosshair');
  // Drag-to-zoom — when the user holds Shift and drags across the chart,
  // they select a region; on mouseup, the chart zooms into that range
  // (`visibleBars` is reduced to the selected window). Without Shift,
  // mouse drag does nothing (so it doesn't conflict with drawing tools).
  // Schema: { startIdx, endIdx } while dragging; null when not.
  const [zoomDrag, setZoomDrag] = useState(null);
  // Crosshair tracking — follows the cursor across the chart and renders a
  // horizontal line at the hovered price (Recharts' built-in Tooltip cursor
  // handles the vertical line; we add the horizontal here). Schema:
  // { idx, x, y, price } where x and y are the coordinates inside the
  // chart's plot area, used by drawing tools and the snapped price label.
  const [crosshair, setCrosshair] = useState(null);
  // Horizontal lines drawn — array of price levels
  const [hlines, setHlines] = useState([]);
  // Vertical lines, fib retracements, channels (parallel trend), arrows
  const [vlines, setVlines] = useState([]);    // [{ x }]
  const [fibs, setFibs]     = useState([]);    // [{ x1, y1, x2, y2 }]
  const [channels, setChannels] = useState([]); // [{ x1, y1, x2, y2, offset }]
  const [arrows, setArrows] = useState([]);    // [{ x1, y1, x2, y2 }]
  const [measurement, setMeasurement] = useState(null);
  // Position brackets — long/short risk-reward boxes. Each has entry, stop, target.
  // We collect 3 clicks: entry → stop (below entry for long / above for short) → target.
  // Stored as { kind: 'long'|'short', x1, x2, entry, stop, target }
  const [positions, setPositions] = useState([]);
  // Date range — measure days/bars between two times. { x1, x2 }
  const [dateRanges, setDateRanges] = useState([]);
  // Price range — measure price difference between two levels. { x1, x2, y1, y2 }
  const [priceRanges, setPriceRanges] = useState([]);
  // Per-instance drawings persistence — when this chart is part of a
  // stacked layout, instanceId is set and we key drawings by
  // instanceId+ticker+tf. Without an instanceId (legacy / single-chart
  // layouts) drawings still reset on ticker change, preserving the
  // long-standing behavior. The composite key lets a user pin one
  // chart pane to BTC and another to ETH and keep separate annotation
  // sets on each, surviving page reloads.
  const drawKey = (instanceId && instrument?.id && tf)
    ? `imo_chart_draw_${instanceId}_${instrument.id}_${tf}`
    : null;
  // The reset effect first checks for a saved bundle for this
  // instance+ticker+tf. If present, hydrate from it; otherwise zero
  // everything out as before. We deliberately keep this as a single
  // effect so all drawing arrays move in lockstep.
  useEffect(() => {
    if (drawKey) {
      try {
        const raw = localStorage.getItem(drawKey);
        if (raw) {
          const saved = JSON.parse(raw);
          setHlines(saved.hlines ?? []);
          setVlines(saved.vlines ?? []);
          setFibs(saved.fibs ?? []);
          setChannels(saved.channels ?? []);
          setArrows(saved.arrows ?? []);
          setPositions(saved.positions ?? []);
          setDateRanges(saved.dateRanges ?? []);
          setPriceRanges(saved.priceRanges ?? []);
          setTrendlines(saved.trendlines ?? []);
          // textNotes are also persisted alongside the rest of the
          // bundle; restored by the second effect below which fires
          // off the same dep list.
          return;
        }
      } catch {}
    }
    setHlines([]); setVlines([]); setFibs([]); setChannels([]); setArrows([]);
    setPositions([]); setDateRanges([]); setPriceRanges([]);
    setTextNotes([]); setMeasurement(null); setTrendlines([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument.id, tf, instanceId]);
  // Text annotations: array of { x, y, text }
  const [textNotes, setTextNotes] = useState([]);
  useEffect(() => {
    if (drawKey) {
      try {
        const raw = localStorage.getItem(drawKey);
        if (raw) {
          const saved = JSON.parse(raw);
          setTextNotes(saved.textNotes ?? []);
          setMeasurement(null);
          return;
        }
      } catch {}
    }
    setMeasurement(null); setTextNotes([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument.id, tf, instanceId]);
  // Trendline drawing — array of { x1, y1, x2, y2 } in chart-data space
  // (x = data index, y = price). Reset on instrument/tf change.
  const [drawing, setDrawing] = useState(false);
  const [pendingPoint, setPendingPoint] = useState(null); // first click of a trendline
  const [trendlines, setTrendlines] = useState([]);
  // Chart root + compact-mode detection. When the chart's container is
  // narrower than ~580px (i.e. small widget tile), the timeframe row
  // is too long to fit on a single line. Rather than wrap to two rows
  // — which costs vertical space inside an already-cramped tile —
  // we collapse the row into a compact mode: hide most timeframe
  // pills behind an arrow toggle, show only the active pill plus a
  // chevron that expands the rest in an overlay. The toggle preserves
  // the user's ability to access every timeframe without permanent
  // toolbar bloat.
  const chartRootRef = useRef(null);
  const [isCompact, setIsCompact] = useState(false);
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  useEffect(() => {
    const el = chartRootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0;
      // Threshold tuned for 4×3 layout: a 12-tile grid at 1440px wide
      // gives each tile ~360px. Anything below 580px gets compact mode.
      setIsCompact(w > 0 && w < 580);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Persist drawings whenever they change — debounced so we don't write
  // to localStorage on every cursor move. The single-key bundle keeps
  // related state co-located so partial corruption (one key write
  // succeeding while another fails) can't desync the chart.
  useEffect(() => {
    if (!drawKey) return;
    const t = setTimeout(() => {
      const bundle = {
        hlines, vlines, fibs, channels, arrows,
        positions, dateRanges, priceRanges,
        textNotes, trendlines,
      };
      // Only write if there's something to save — empty bundles just
      // clutter localStorage and conflict with the reset path.
      const empty = Object.values(bundle).every(arr => !arr || arr.length === 0);
      try {
        if (empty) localStorage.removeItem(drawKey);
        else localStorage.setItem(drawKey, JSON.stringify(bundle));
      } catch {}
    }, 350);
    return () => clearTimeout(t);
  }, [drawKey, hlines, vlines, fibs, channels, arrows, positions, dateRanges, priceRanges, textNotes, trendlines]);
  // Chart presets — named bundles of indicator + drawing state. Stored in
  // localStorage so they persist across sessions and ticker changes. The
  // user can save the current state as a named preset and load it back
  // anytime. Each preset captures: indicator IDs, strategy IDs, profile
  // IDs, pattern IDs, the boolean toggles (sma20, sma50, ema12, ema26,
  // showVolumeBubbles, subPanel), and all drawings (trendlines, hlines,
  // fibs, channels, arrows).
  const [presets, setPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('imo_chart_presets') ?? '[]'); }
    catch { return []; }
  });
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [presetSaveOpen, setPresetSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState('');

  // Undo/redo history — captures a snapshot of all drawing arrays
  // PLUS chart view state (tf, visibleBars, freqInterval) per UX
  // feedback so the user can undo zooms, frequency changes, and
  // range changes too — not just drawings. Stack capped at 30 to
  // avoid memory bloat. Standard editor model: redo clears on any
  // new edit.
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const captureSnapshot = () => ({
    hlines: [...hlines], vlines: [...vlines], fibs: [...fibs],
    channels: [...channels], arrows: [...arrows], trendlines: [...trendlines],
    textNotes: [...textNotes], positions: [...positions],
    dateRanges: [...dateRanges], priceRanges: [...priceRanges],
    // Chart view state — per UX feedback so undo covers more than
    // just drawings. The user can roll back zooms, frequency picks,
    // and timeframe changes.
    tf, visibleBars, freqInterval, freqSticky,
  });
  const restoreSnapshot = (snap) => {
    setHlines(snap.hlines ?? []);
    setVlines(snap.vlines ?? []);
    setFibs(snap.fibs ?? []);
    setChannels(snap.channels ?? []);
    setArrows(snap.arrows ?? []);
    setTrendlines(snap.trendlines ?? []);
    setTextNotes(snap.textNotes ?? []);
    setPositions(snap.positions ?? []);
    setDateRanges(snap.dateRanges ?? []);
    setPriceRanges(snap.priceRanges ?? []);
    if (snap.tf !== undefined) setTf(snap.tf);
    if (snap.visibleBars !== undefined) setVisibleBars(snap.visibleBars);
    if (snap.freqInterval !== undefined) setFreqInterval(snap.freqInterval);
    if (snap.freqSticky !== undefined) setFreqSticky(snap.freqSticky);
  };
  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack(prev => [...prev, captureSnapshot()]);
    setUndoStack(prev => prev.slice(0, -1));
    restoreSnapshot(previous);
  };
  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(prev => [...prev, captureSnapshot()]);
    setRedoStack(prev => prev.slice(0, -1));
    restoreSnapshot(next);
  };
  // Watch all drawing arrays AND chart view state — push onto
  // undoStack when anything changes. Skip the very first render
  // (initial mount) and resets (on instrument change). Use a ref
  // to track the previous JSON-serialized state so we only push
  // when something actually changed. Tf / visibleBars / freqInterval
  // changes also flow through here so zoom + range + frequency
  // picks join the undo history alongside drawings.
  //
  // Per UX feedback (Phase 3o.18 known limitation): drag-to-zoom
  // would spam the stack with one entry per frame because
  // visibleBars updates continuously during the drag. Fix: when
  // the only thing changing is visibleBars (zoom), debounce the
  // push by 350ms so only the FINAL zoom value lands in history.
  // Drawings, tf changes, and frequency changes still push
  // immediately because those are discrete user actions.
  const prevDrawingRef = useRef(null);
  const zoomTimerRef = useRef(null);
  useEffect(() => {
    // Capture the structural fields (everything BUT visibleBars) so
    // we can detect "is this a pure zoom change?" — if those are
    // identical to the previous snapshot, the only change was
    // visibleBars and we should debounce.
    const structural = JSON.stringify({
      hlines, vlines, fibs, channels, arrows, trendlines, textNotes,
      positions, dateRanges, priceRanges,
      tf, freqInterval, freqSticky,
    });
    const current = JSON.stringify({
      hlines, vlines, fibs, channels, arrows, trendlines, textNotes,
      positions, dateRanges, priceRanges,
      tf, visibleBars, freqInterval, freqSticky,
    });
    if (prevDrawingRef.current === null) {
      prevDrawingRef.current = current;
      return;
    }
    if (prevDrawingRef.current === current) return;
    // Determine if this is a pure-zoom change (only visibleBars
    // differs) or a structural change (drawings / tf / frequency).
    let prevStructural = null;
    try {
      const parsed = JSON.parse(prevDrawingRef.current);
      const { visibleBars: _vb, ...rest } = parsed;
      prevStructural = JSON.stringify(rest);
    } catch {}
    const isPureZoom = prevStructural === structural;
    const pushSnapshot = () => {
      try {
        const prev = JSON.parse(prevDrawingRef.current);
        setUndoStack(stack => {
          const next = [...stack, prev];
          // Cap at 30 entries to avoid memory bloat
          return next.length > 30 ? next.slice(-30) : next;
        });
        setRedoStack([]); // new edit invalidates redo
      } catch {}
      prevDrawingRef.current = current;
    };
    if (isPureZoom) {
      // Debounce — only the final zoom value (after the user stops
      // dragging for 350ms) lands in the undo stack. Cancel any
      // pending timer so consecutive zoom updates collapse into one.
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
      zoomTimerRef.current = setTimeout(() => {
        zoomTimerRef.current = null;
        pushSnapshot();
      }, 350);
    } else {
      // Structural change — push immediately, clear any pending
      // zoom timer so we don't double-push.
      if (zoomTimerRef.current) {
        clearTimeout(zoomTimerRef.current);
        zoomTimerRef.current = null;
      }
      pushSnapshot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hlines, vlines, fibs, channels, arrows, trendlines, textNotes,
      positions, dateRanges, priceRanges,
      tf, visibleBars, freqInterval, freqSticky]);
  // Cleanup any pending zoom-debounce timer on unmount so we don't
  // leak setTimeout handles when the chart instance is destroyed
  // (e.g. tab close, instrument switch).
  useEffect(() => {
    return () => {
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
    };
  }, []);
  // Keyboard shortcuts: Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z (or Y) redo
  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      // Don't intercept in inputs/textareas
      const tag = (e.target?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoStack, redoStack]);
  const [showMoreIndicators, setShowMoreIndicators] = useState(false);
  const [showDrawingsPicker, setShowDrawingsPicker] = useState(false);
  // Chart Scanner — AI tool that reads the current chart context (active
  // indicators, recent OHLCV bars, RSI/MACD readings, detected patterns)
  // and asks Anthropic for a trade recommendation, breakdown of the recent
  // movement, and which indicators/tools could best analyze it.
  const [showScanner, setShowScanner] = useState(false);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [scannerResult, setScannerResult] = useState(null);
  const [scannerError, setScannerError] = useState(null);
  // AI Edit — natural-language chart manipulation. The user types
  // commands like "add SMA 20 and RSI" or "draw a horizontal line at
  // 75000", we ask the AI to translate to structured ops, then apply
  // them to the chart state. Falls back to local keyword parsing when
  // AI is unavailable so the feature works offline.
  const [showAiEdit, setShowAiEdit] = useState(false);
  const [aiEditPrompt, setAiEditPrompt] = useState('');
  const [aiEditLoading, setAiEditLoading] = useState(false);
  const [aiEditFeedback, setAiEditFeedback] = useState(null); // { applied: [], message }
  const [showFundamentals, setShowFundamentals] = useState(false);
  // Show/hide the bottom indicator toolbar so users can reclaim chart
  // height when they don't need indicator buttons. Persisted globally.
  const [showToolbar, setShowToolbar] = useState(() => {
    try { return localStorage.getItem('imo_chart_toolbar_visible') !== '0'; }
    catch { return true; }
  });
  // Active indicators driven by the user's MoreIndicatorsModal favorites.
  // Re-read on a window 'storage' event so changes from inside the modal
  // (which writes to imo_indicator_favorites) propagate without remount.
  // We also poll on a short interval as a safety net for same-tab updates
  // since 'storage' events only fire across tabs.
  const [activeIndicatorIds, setActiveIndicatorIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('imo_indicator_favorites') ?? '[]'); }
    catch { return []; }
  });
  // Active strategies — render entry/exit signals on the chart
  const [activeStrategyIds, setActiveStrategyIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('imo_strategy_favorites') ?? '[]'); }
    catch { return []; }
  });
  // Active profiles — render volume profile / TPO overlays
  const [activeProfileIds, setActiveProfileIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('imo_profile_favorites') ?? '[]'); }
    catch { return []; }
  });
  // Active patterns — auto-detect & highlight matches in visible range
  const [activePatternIds, setActivePatternIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('imo_pattern_favorites') ?? '[]'); }
    catch { return []; }
  });
  useEffect(() => {
    const sync = () => {
      try {
        const fresh = JSON.parse(localStorage.getItem('imo_indicator_favorites') ?? '[]');
        setActiveIndicatorIds(prev => {
          if (prev.length === fresh.length && prev.every((id, i) => id === fresh[i])) return prev;
          return fresh;
        });
        // Sync strategy/profile/pattern favorites too
        const syncSet = (key, setter) => {
          try {
            const f = JSON.parse(localStorage.getItem(key) ?? '[]');
            setter(prev => {
              if (prev.length === f.length && prev.every((id, i) => id === f[i])) return prev;
              return f;
            });
          } catch {}
        };
        syncSet('imo_strategy_favorites', setActiveStrategyIds);
        syncSet('imo_profile_favorites',  setActiveProfileIds);
        syncSet('imo_pattern_favorites',  setActivePatternIds);
      } catch {}
    };
    window.addEventListener('storage', sync);
    const interval = setInterval(sync, 1500);
    return () => { window.removeEventListener('storage', sync); clearInterval(interval); };
  }, []);
  useEffect(() => { setTrendlines([]); setPendingPoint(null); }, [instrument.id, tf]);

  // Chart data — historical series from the API. Optionally stitch the live
  // header price onto the end so the chart's final bar matches the header —
  // BUT only when the gap is tiny. If live and historical disagree by more
  // than ~2% they're effectively from different sources (e.g. free-tier
  // 15-min-delayed snapshot vs. today's aggregate), and patching creates an
  // ugly cliff. In that case we leave the historical series alone and the
  // header price shows current separately.
  const data = useMemo(() => {
    let raw = series ?? [];
    if (!raw.length) return raw;
    if (livePrice == null || !isFinite(livePrice) || livePrice <= 0) {
      // Apply visible-bars slice to the raw series even without livePrice
      if (visibleBars !== 'all' && raw.length > visibleBars) {
        raw = raw.slice(-visibleBars);
      }
      return raw;
    }

    const lastBar = raw[raw.length - 1];
    const deltaPct = Math.abs(lastBar.price - livePrice) / livePrice;
    let patched;
    if (deltaPct > 0.02) {
      patched = raw;
    } else {
      patched = raw.slice(0, -1);
      patched.push({ ...lastBar, price: +livePrice });
    }
    // Slice to the last N bars if user has restricted the visible range
    if (visibleBars !== 'all' && patched.length > visibleBars) {
      patched = patched.slice(-visibleBars);
    }
    return patched;
  }, [series, livePrice, visibleBars]);
  const hasData = data.length > 0;

  // Compute indicators only when needed. useMemo prevents recomputation on
  // every render unless data actually changes.
  const sma20Data = useMemo(() => showSma20 && hasData ? sma(data, 20) : null, [data, showSma20, hasData]);
  const sma50Data = useMemo(() => showSma50 && hasData ? sma(data, 50) : null, [data, showSma50, hasData]);
  const ema12Data = useMemo(() => showEma12 && hasData ? ema(data, 12) : null, [data, showEma12, hasData]);
  const ema26Data = useMemo(() => showEma26 && hasData ? ema(data, 26) : null, [data, showEma26, hasData]);
  const rsiData   = useMemo(() => subPanel === 'rsi' && hasData ? rsi(data, 14) : null, [data, subPanel, hasData]);
  const macdData  = useMemo(() => subPanel === 'macd' && hasData ? macd(data) : null, [data, subPanel, hasData]);

  // Custom indicators driven by user favorites. We split into overlay
  // (rendered on the main price chart) and sub-panel (each gets its own
  // stacked panel below the chart). For each active id we look up the
  // implementation in INDICATOR_IMPLS and compute its series. Any id
  // that isn't in the dispatcher (e.g. catalog-only entries) is skipped.
  const customOverlays = useMemo(() => {
    if (!hasData) return [];
    return activeIndicatorIds
      .map(id => ({ id, impl: INDICATOR_IMPLS[id] }))
      .filter(({ impl }) => impl && impl.panel === 'overlay')
      .map(({ id, impl }) => {
        try {
          const series = impl.series(data);
          return { id, impl, series };
        } catch (e) { return null; }
      })
      .filter(Boolean);
  }, [data, activeIndicatorIds, hasData]);

  const customSubPanels = useMemo(() => {
    if (!hasData) return [];
    return activeIndicatorIds
      .map(id => ({ id, impl: INDICATOR_IMPLS[id] }))
      .filter(({ impl }) => impl && impl.panel === 'sub')
      .map(({ id, impl }) => {
        try {
          const series = impl.series(data);
          // Pre-merge into rows so each panel can use a single dataset
          const rows = data.map((d, i) => {
            const row = { t: d.t ?? i, x: i };
            Object.keys(series).forEach(k => { row[`${id}__${k}`] = series[k][i]; });
            return row;
          });
          return { id, impl, rows };
        } catch (e) { return null; }
      })
      .filter(Boolean);
  }, [data, activeIndicatorIds, hasData]);

  // Vertical volume profile — bins prices into N buckets and sums volume
  // per bucket. Returns null when not active so the renderer can skip
  // overlay drawing entirely. The SVG overlay is positioned absolutely
  // in the chart area and shows horizontal bars on the right edge.
  const showVolumeProfile = activeIndicatorIds.includes('volume-profile-vertical');
  const volumeProfileData = useMemo(() => {
    if (!showVolumeProfile || !hasData) return null;
    const NBUCKETS = 24;
    const prices = data.map(d => d.price);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP;
    if (range <= 0) return null;
    const buckets = new Array(NBUCKETS).fill(0);
    data.forEach(d => {
      const idx = Math.min(NBUCKETS - 1, Math.floor(((d.price - minP) / range) * NBUCKETS));
      buckets[idx] += (d.v ?? 1);
    });
    const maxVol = Math.max(...buckets, 1);
    return { buckets, minP, maxP, maxVol };
  }, [data, showVolumeProfile, hasData]);

  // Volume data: use real `v` from historical aggregates when available
  // (Polygon/Coinbase/EIA all return volume); otherwise synthesize from
  // price volatility so bars still render something meaningful. Each bar's
  // `dir` flag indicates if that bar closed up vs. the previous — used
  // for green/red coloring in the BarChart below.
  const volumeData = useMemo(() => {
    if (subPanel !== 'volume' || !hasData) return null;
    return data.map((d, i) => {
      const prev = data[i - 1]?.price ?? d.price;
      const dir = d.price >= prev ? 'up' : 'down';
      const vol = d.v ?? Math.abs(d.price - prev) * d.price * 200;
      return { ...d, vol, dir };
    });
  }, [data, subPanel, hasData]);

  // Merge overlay values onto each row so a single Recharts dataset can
  // render the price area + multiple indicator lines together.
  const enrichedData = useMemo(() => {
    if (!hasData) return data;
    // First pass: synthesize OHLC from close
    const ohlcBars = data.map((d, i) => {
      const close = d.price;
      const prevClose = i === 0 ? close : data[i - 1].price;
      const open = prevClose;
      const baseRange = Math.abs(close - open);
      let s = (i * 2654435761) >>> 0;
      const rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0xFFFFFFFF; };
      const wickScale = (baseRange * 0.5) + close * 0.0008;
      const upWick = wickScale * (0.3 + rand() * 0.7);
      const dnWick = wickScale * (0.3 + rand() * 0.7);
      const high = Math.max(open, close) + upWick;
      const low  = Math.min(open, close) - dnWick;
      return { ...d, open, close, high, low };
    });

    // Second pass: derive Heikin Ashi from regular OHLC.
    // HA values are smoothed/averaged versions of OHLC that filter noise:
    //   haClose = (O + H + L + C) / 4
    //   haOpen  = (prev haOpen + prev haClose) / 2
    //   haHigh  = max(H, haOpen, haClose)
    //   haLow   = min(L, haOpen, haClose)
    const haBars = [];
    for (let i = 0; i < ohlcBars.length; i++) {
      const b = ohlcBars[i];
      const haClose = (b.open + b.high + b.low + b.close) / 4;
      const haOpen = i === 0
        ? (b.open + b.close) / 2
        : (haBars[i - 1].haOpen + haBars[i - 1].haClose) / 2;
      const haHigh = Math.max(b.high, haOpen, haClose);
      const haLow  = Math.min(b.low,  haOpen, haClose);
      haBars.push({ haOpen, haHigh, haLow, haClose });
    }

    return ohlcBars.map((b, i) => {
      const ha = haBars[i];
      const row = {
        ...b,
        // Standard OHLC body
        ohlcRange: [b.low, b.high],
        bodyRange: [Math.min(b.open, b.close), Math.max(b.open, b.close)],
        isUp: b.close >= b.open,
        // Heikin Ashi values + range for HA chart style
        haOpen:  ha.haOpen,
        haHigh:  ha.haHigh,
        haLow:   ha.haLow,
        haClose: ha.haClose,
        haRange: [ha.haLow, ha.haHigh],
        haIsUp:  ha.haClose >= ha.haOpen,
        sma20: sma20Data?.[i]?.v ?? null,
        sma50: sma50Data?.[i]?.v ?? null,
        ema12: ema12Data?.[i]?.v ?? null,
        ema26: ema26Data?.[i]?.v ?? null,
      };
      // Inject every active custom overlay's values for this bar.
      // Key format `${indicatorId}__${lineKey}` keeps the namespace flat
      // and avoids collisions with built-in keys above.
      customOverlays.forEach(({ id, series }) => {
        Object.keys(series).forEach(k => {
          row[`${id}__${k}`] = series[k][i] ?? null;
        });
      });
      return row;
    });
  }, [data, sma20Data, sma50Data, ema12Data, ema26Data, hasData, customOverlays]);

  // Position markers — render a dot at the entry price + entry
  // timestamp for every open position in this instrument. Per UX
  // request: "if user places order the order should come up on the
  // graph on the horizontal axis as a point for that stock". Each
  // marker is anchored at (openedAt, entry) and colored by side
  // (green for long/buy, red for short/sell). Closed positions are
  // intentionally excluded — they belong on the History panel,
  // not the live chart.
  //
  // We snap each marker's X coordinate to the nearest bar timestamp
  // in enrichedData so the dot lines up with an actual candle on
  // screen. If a position was opened before the visible window,
  // we anchor it at the leftmost bar so the user still sees it
  // ("you have an open position from before this window starts").
  const positionMarkers = useMemo(() => {
    if (!account?.positions || !instrument?.id) return [];
    if (!enrichedData || enrichedData.length === 0) return [];
    const positions = account.positions.filter(p => {
      const sym = p.instrument?.id ?? p.sym;
      return sym === instrument.id;
    });
    if (positions.length === 0) return [];
    // Build a sorted array of bar timestamps for nearest-snap lookup
    const barTimes = enrichedData
      .map(b => b.t ?? b.time ?? b.date)
      .filter(t => t != null)
      .map(t => (typeof t === 'number') ? t : new Date(t).getTime());
    if (barTimes.length === 0) return [];
    const firstBarT = barTimes[0];
    const lastBarT  = barTimes[barTimes.length - 1];
    const findNearestBarT = (ts) => {
      if (ts <= firstBarT) return firstBarT;
      if (ts >= lastBarT)  return lastBarT;
      // Linear scan is fine for typical bar counts (hundreds, not millions)
      let bestT = barTimes[0];
      let bestDelta = Math.abs(ts - bestT);
      for (let i = 1; i < barTimes.length; i++) {
        const d = Math.abs(ts - barTimes[i]);
        if (d < bestDelta) { bestDelta = d; bestT = barTimes[i]; }
      }
      return bestT;
    };
    return positions.map(p => {
      const openedTs = p.openedAt ? new Date(p.openedAt).getTime() : Date.now();
      const snappedT = findNearestBarT(openedTs);
      // Find the t value in enrichedData with this timestamp so the
      // ReferenceDot's X coordinate matches a row in the dataset.
      const matched = enrichedData.find(b => {
        const bt = b.t ?? b.time ?? b.date;
        const btMs = (typeof bt === 'number') ? bt : new Date(bt).getTime();
        return btMs === snappedT;
      });
      const xValue = matched?.t ?? matched?.time ?? matched?.date;
      const isLong = p.side === 'long' || p.side === 'buy';
      return {
        id: p.id ?? `pos_${snappedT}_${Math.random().toString(36).slice(2, 5)}`,
        x: xValue,
        y: Number(p.entry) || 0,
        side: p.side,
        size: Number(p.size) || 0,
        isLong,
        // Show a tooltip-friendly label
        label: `${isLong ? 'LONG' : 'SHORT'} ${p.size} @ $${Number(p.entry).toFixed(instrument.dec ?? 2)}`,
      };
    });
  }, [account?.positions, instrument?.id, instrument?.dec, enrichedData]);

  // News markers — fetch recent news for the instrument, score sentiment,
  // and overlay markers on the chart at each headline's publish time.
  // Toggleable so users who don't care about news can hide them.
  const [showNewsMarkers, setShowNewsMarkers] = useState(true);
  const [newsForChart, setNewsForChart] = useState([]);
  useEffect(() => {
    if (!instrument?.id || instrument?.cls !== 'equity') {
      setNewsForChart([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        let results = [];
        if (MASSIVE_API_KEY) {
          const url = `https://api.polygon.io/v2/reference/news?ticker=${instrument.id}&limit=20&order=desc&apiKey=${MASSIVE_API_KEY}`;
          const r = await fetch(url);
          if (r.ok) {
            const body = await r.json();
            results = body?.results ?? [];
          }
        }
        if (!cancelled) setNewsForChart(scoreSentimentBatch(results));
      } catch {
        if (!cancelled) setNewsForChart([]);
      }
    })();
    return () => { cancelled = true; };
  }, [instrument?.id, instrument?.cls]);

  const newsMarkers = useMemo(() => {
    if (!showNewsMarkers || !newsForChart.length) return [];
    if (!enrichedData || enrichedData.length === 0) return [];
    // Need bar timestamps for snapping
    const barTimes = enrichedData.map(b => {
      const bt = b.t ?? b.time ?? b.date;
      return (typeof bt === 'number') ? bt : new Date(bt).getTime();
    }).filter(t => Number.isFinite(t));
    if (barTimes.length === 0) return [];
    const firstBarT = Math.min(...barTimes);
    const lastBarT = Math.max(...barTimes);
    return newsForChart
      .filter(n => n._sentiment && n._sentiment.confidence > 0)
      .map(n => {
        const ts = n.published_utc ? new Date(n.published_utc).getTime() : 0;
        if (!Number.isFinite(ts)) return null;
        // Skip news outside the visible window
        if (ts < firstBarT || ts > lastBarT) return null;
        // Snap to nearest bar
        let bestT = barTimes[0];
        let bestDelta = Math.abs(ts - bestT);
        for (let i = 1; i < barTimes.length; i++) {
          const d = Math.abs(ts - barTimes[i]);
          if (d < bestDelta) { bestDelta = d; bestT = barTimes[i]; }
        }
        const matched = enrichedData.find(b => {
          const bt = b.t ?? b.time ?? b.date;
          const btMs = (typeof bt === 'number') ? bt : new Date(bt).getTime();
          return btMs === bestT;
        });
        if (!matched) return null;
        const xValue = matched.t ?? matched.time ?? matched.date;
        const high = matched.high ?? matched.h ?? matched.close ?? matched.c;
        const low  = matched.low  ?? matched.l ?? matched.close ?? matched.c;
        const score = n._sentiment.score;
        // Position the marker just above the candle high (positive) or
        // below the low (negative), so they don't overlap candles.
        const isPositive = score > 0;
        const offset = (high - low) * 0.08 || 0;
        return {
          id: 'news_' + (n.id || ts),
          x: xValue,
          y: isPositive ? high + offset : low - offset,
          score,
          label: n._sentiment.label,
          title: n.title,
          publisher: n.publisher?.name,
          url: n.article_url,
          isPositive,
        };
      })
      .filter(Boolean);
  }, [showNewsMarkers, newsForChart, enrichedData]);

  // Chart Scanner — gathers a snapshot of the current chart and asks the AI
  // to produce: (1) a directional recommendation, (2) a breakdown of recent
  // movement, (3) suggested indicators/tools to add. Result is rendered in
  // a side panel via showScanner state.
  const runScanner = async () => {
    setScannerLoading(true);
    setScannerError(null);
    setScannerResult(null);
    try {
      // Sample the most recent ~60 bars (or whatever is available)
      const bars = enrichedData.slice(-60).map(b => ({
        t: b.t ?? b.time ?? b.date ?? null,
        o: Number(b.open?.toFixed?.(4) ?? b.open),
        h: Number(b.high?.toFixed?.(4) ?? b.high),
        l: Number(b.low?.toFixed?.(4) ?? b.low),
        c: Number(b.close?.toFixed?.(4) ?? b.close),
      }));
      const last = bars[bars.length - 1];
      const first = bars[0];
      const change = last && first ? ((last.c - first.c) / first.c) * 100 : 0;
      const high60 = Math.max(...bars.map(b => b.h));
      const low60 = Math.min(...bars.map(b => b.l));
      // Active indicators (id list)
      const activeInds = (activeIndicatorIds || []).filter(id => INDICATOR_IMPLS?.[id]);
      const ctx = {
        ticker: instrument.id,
        name: instrument.name,
        cls: instrument.cls,
        timeframe: tf,
        last_price: last?.c,
        bars_60_change_pct: Number(change.toFixed(2)),
        period_high: Number(high60.toFixed(4)),
        period_low: Number(low60.toFixed(4)),
        period_range_pct: Number(((high60 - low60) / low60 * 100).toFixed(2)),
        active_indicators: activeInds,
      };
      // Optional Exa grounding: pull recent news on this ticker to enrich
      // the analysis with fundamental/news context. Skipped if no key.
      let newsContext = '';
      if (EXA_API_KEY && instrument?.cls === 'equity') {
        const news = await exaSearch(`${instrument.id} stock news analysis`, {
          numResults: 4,
          type: 'fast',
          maxAgeHours: 72,
          highlights: true,
        });
        if (news?.results?.length) {
          newsContext = '\n\nRECENT NEWS (for context):\n' + news.results
            .map((n, i) => `[${i + 1}] ${n.title}\n${n.text || ''}`)
            .join('\n\n');
        }
      }
      const system = 'You are a senior technical analyst. The user has shared their current chart context. Produce a concise analysis as JSON ONLY (no prose, no fences). Schema: {"signal":"long|short|neutral","confidence":"low|medium|high","movement":"2-3 sentence summary of recent price action","key_levels":["support and resistance prices"],"recommended_indicators":["indicator names that would help"],"trade_idea":"1-2 sentence specific trade idea or null if neutral","risks":["main risks to watch"]}. Be specific and actionable. If RECENT NEWS is provided, factor it into the analysis.';
      const prompt = `CHART CONTEXT:\n${JSON.stringify(ctx, null, 2)}\n\nRECENT BARS (last ${bars.length}):\n${JSON.stringify(bars.slice(-30))}${newsContext}\n\nReturn JSON only.`;
      const response = await callAI(prompt, { maxTokens: 1000 });
      let parsed = null;
      if (response) {
        try {
          const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          parsed = JSON.parse(cleaned);
        } catch {
          const m = response.match(/\{[\s\S]*\}/);
          if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
        }
      }
      // ALWAYS compute the heuristic, then merge. Earlier code only ran
      // the heuristic when the AI response was completely missing — but
      // partial AI responses (e.g. just `{"signal":"neutral"}` from a
      // canned gateway, a stub LLM, or a truncated reply) would skip
      // the heuristic and the UI would render "NEUTRAL / —" with no
      // body text. Now the heuristic provides a usable floor for every
      // field; AI fields override where present and non-empty.
      const closes = bars.map(b => b.c);
      const sma20 = closes.length >= 20
        ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20
        : closes.reduce((a, b) => a + b, 0) / Math.max(1, closes.length);
      const recent = closes.length > 0
        ? closes.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, closes.length)
        : 0;
      const dir = closes.length === 0 ? 'neutral'
                : recent > sma20 ? 'long'
                : recent < sma20 ? 'short' : 'neutral';
      const vol = Math.abs(change);
      const heuristic = {
        signal: dir,
        confidence: vol > 5 ? 'high' : vol > 2 ? 'medium' : 'low',
        movement: bars.length > 0
          ? `${ctx.ticker} is ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(1)}% over the last ${bars.length} bars, with a range of ${ctx.period_range_pct}%. Recent closes are trading ${recent > sma20 ? 'above' : recent < sma20 ? 'below' : 'at'} the 20-bar SMA.`
          : `No recent bars available for ${ctx.ticker} on the ${tf} timeframe — try switching range or waiting for fresh data.`,
        key_levels: bars.length > 0 ? [
          `Support ~${low60.toFixed(2)}`,
          `Resistance ~${high60.toFixed(2)}`,
          `SMA-20 ~${sma20.toFixed(2)}`,
        ] : [],
        recommended_indicators: dir === 'neutral'
          ? ['rsi-14', 'bollinger-bands', 'sma-20']
          : ['sma-20', 'sma-50', 'macd', 'rsi-14'],
        trade_idea: dir === 'neutral'
          ? null
          : `${dir === 'long' ? 'Look for entries above' : 'Watch for breakdowns below'} ${(dir === 'long' ? sma20 : low60).toFixed(2)} with stops on the opposite side.`,
        risks: ['News-driven volatility', 'Lower liquidity at extremes', 'Trend reversal at SMA'],
      };
      // Merge: AI fields win when they're present and non-empty, otherwise
      // fall back to the heuristic. This way partial AI responses still
      // produce a fully-rendered card. We only flag _offline when the AI
      // contributed nothing.
      const isMeaningful = (v) => {
        if (v === undefined || v === null) return false;
        if (typeof v === 'string') return v.trim().length > 0;
        if (Array.isArray(v)) return v.length > 0;
        return true;
      };
      const merged = {};
      const allKeys = new Set([...Object.keys(heuristic), ...Object.keys(parsed ?? {})]);
      allKeys.forEach(k => {
        const aiVal = parsed?.[k];
        merged[k] = isMeaningful(aiVal) ? aiVal : heuristic[k];
      });
      // Mark partial AI responses so the UI can hint that the analysis
      // was synthesized rather than fully AI-driven. We treat <2 AI
      // fields as partial — usable but not a full read.
      const aiFieldCount = parsed
        ? Object.keys(heuristic).filter(k => isMeaningful(parsed[k])).length
        : 0;
      merged._offline = !response;
      merged._partial = !!parsed && aiFieldCount < Object.keys(heuristic).length / 2;
      parsed = merged;
      setScannerResult(parsed);
      setScannerLoading(false);

      // MCP-style "let the AI make changes on the chart" — the Scan response
      // includes recommended_indicators; auto-toggle the matching indicators
      // on so the user sees the suggestion applied immediately. Maps text
      // names to our indicator IDs / boolean toggles. Only adds, never
      // removes — preserves the user's existing setup.
      try {
        const recs = (parsed.recommended_indicators ?? []).map(s => String(s).toLowerCase());
        const matchAny = (...needles) => recs.some(r => needles.some(n => r.includes(n)));
        if (matchAny('sma 20', 'sma-20', 'sma20')) setShowSma20(true);
        if (matchAny('sma 50', 'sma-50', 'sma50')) setShowSma50(true);
        if (matchAny('ema 12', 'ema-12', 'ema12')) setShowEma12(true);
        if (matchAny('ema 26', 'ema-26', 'ema26')) setShowEma26(true);
        if (matchAny('rsi'))  setSubPanel('rsi');
        else if (matchAny('macd')) setSubPanel('macd');
        else if (matchAny('volume')) setSubPanel('volume');
        if (matchAny('vol bubble', 'volume profile')) setShowVolumeBubbles(true);
        // Map known indicator IDs into activeIndicatorIds when the AI
        // names them with the canonical id (e.g. "bollinger-bands").
        const idsToAdd = recs.filter(r => INDICATOR_IMPLS && INDICATOR_IMPLS[r]);
        if (idsToAdd.length > 0) {
          setActiveIndicatorIds(prev => {
            const merged = new Set([...prev, ...idsToAdd]);
            const next = [...merged];
            try { localStorage.setItem('imo_indicator_favorites', JSON.stringify(next)); } catch {}
            return next;
          });
        }
      } catch (e) { console.warn('[scan apply]', e.message); }
    } catch (e) {
      setScannerError(`Scan failed: ${e.message}`);
      setScannerLoading(false);
    }
  };

  // ──────────── AI Edit — natural-language chart manipulation ────────────
  // The user types commands like:
  //   "add SMA 20 and SMA 50"
  //   "show RSI and MACD"
  //   "draw a horizontal line at 75000"
  //   "remove all drawings"
  //   "set timeframe to 1 day"
  //   "show volatility skew"
  // We ask the AI to translate to structured ops, then apply them. Falls
  // back to local keyword parsing when the AI is unavailable.
  const runAiEdit = async () => {
    const cmd = aiEditPrompt.trim();
    if (!cmd) return;
    setAiEditLoading(true);
    setAiEditFeedback(null);
    try {
      // Compact preset listing for the AI to reference by name when the
      // user says "load my day trade setup" — we send the names + indices.
      const presetSummary = presets.map((p, i) => `${i}: ${p.name}`).join(', ') || 'none saved';
      const subchartList = SUBCHART_TYPES.map(t => `${t.id}: ${t.label}`).join(', ');
      const openSubcharts = subcharts.map((s, i) => `${i + 1}: ${s.type}`).join(', ') || 'none';

      const system = `You are a chart-manipulation parser for a trading terminal. You translate user requests — even vague or imprecise ones — into JSON operations the chart can apply.

CRITICAL: Be liberal in interpretation. If the user is at all ambiguous, infer reasonable intent and act. Examples of vague phrasings you should handle:
- "make it look like day trading" → add SMA 20, EMA 12, set RSI panel, switch to 5m timeframe
- "I want to swing trade" → add SMA 50, set MACD panel, switch to 1D timeframe
- "show me momentum stuff" → set RSI panel, set MACD panel, add EMA 12
- "long term view" → switch to 1Y or 5Y timeframe, add SMA 50
- "clean it up" → clear drawings (NOT indicators unless they say so)
- "reset" → clear both drawings and indicators
- "remember this" or "save this" → save_preset with a sensible name
- "save as <name>" → save_preset
- "load my <name>" → load_preset matching by name
- "show me dark pool" / "options flow" / "news" → add_subchart with the right type
- "annotate this" / "label here" / "mark this point" → add_text_annotation at the most recent bar
- "label peak/high/top" → add_text_annotation at the highest bar (use bar_offset_from_end appropriately)
- "label low/bottom" → add_text_annotation at the lowest bar
- "mark <price>" or "note <price>" → add_text_annotation at that price level

VALID OPERATIONS:
- {"op":"add_indicator","name":"sma_20"|"sma_50"|"ema_12"|"ema_26"|"vol_bubbles"}
- {"op":"remove_indicator","name":"sma_20"|"sma_50"|"ema_12"|"ema_26"|"vol_bubbles"}
- {"op":"set_subpanel","value":"rsi"|"macd"|"volume"|null}
- {"op":"add_hline","price":<number>}
- {"op":"clear_drawings"}
- {"op":"clear_indicators"}
- {"op":"set_timeframe","value":"1m"|"5m"|"15m"|"30m"|"1H"|"1D"|"1W"|"1M"|"3M"|"6M"|"1Y"|"5Y"|"10Y"}
- {"op":"add_named_indicator","id":"<canonical id like bollinger-bands or rsi-14>"}
- {"op":"save_preset","name":"<descriptive name based on current setup>"}
- {"op":"load_preset","name":"<name to match>"}  // fuzzy-matches the saved preset names
- {"op":"delete_preset","name":"<name to match>"}
- {"op":"add_subchart","type":"net-drift"|"heatmap"|"interval"|"vol-drift"|"net-flow"|"dark-flow"|"gainers"|"market-map"|"news"|"vol-skew"}
- {"op":"remove_subchart","index":<1-based index from open subcharts>}
- {"op":"switch_subchart","index":<0=main, 1+=subchart at that 1-based position>}
- {"op":"add_text_annotation","text":"<short label, max 40 chars>","position":"latest"|"highest"|"lowest"|"price","price":<optional number when position=price>}
- {"op":"clear_annotations"}

CONTEXT:
- Current ticker: ${instrument.id}
- Current timeframe: ${tf}
- Saved presets: ${presetSummary}
- Open subcharts: ${openSubcharts}
- Available subchart types: ${subchartList}

Return ONLY valid JSON: {"ops":[...],"summary":"one short sentence describing what you applied"}.
No prose, no markdown fences. Always include at least one op if at all reasonable.`;

      const prompt = `User request: ${cmd}\n\nReturn JSON only.`;
      const response = await callAI(prompt, { maxTokens: 600, system });
      let parsed = null;
      if (response) {
        try {
          const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          parsed = JSON.parse(cleaned);
        } catch {
          const m = response.match(/\{[\s\S]*\}/);
          if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
        }
      }

      // Local keyword-based fallback. Beefed up to handle vague phrasings
      // when AI is unavailable. Also runs when the AI returned a result
      // but with zero ops — this happens when the gateway returns a
      // canned/empty response or when the LLM literally complies but
      // outputs nothing actionable. In that case the user typed a
      // command and would expect SOMETHING to happen, so we try the
      // heuristic before giving up.
      if (!parsed || !Array.isArray(parsed.ops) || parsed.ops.length === 0) {
        const ops = [];
        const lc = cmd.toLowerCase();

        // Style/strategy intent — vague phrasings that bundle multiple ops
        if (/day\s*trad|scalp/.test(lc)) {
          ops.push({ op: 'add_indicator', name: 'sma_20' });
          ops.push({ op: 'add_indicator', name: 'ema_12' });
          ops.push({ op: 'set_subpanel', value: 'rsi' });
          ops.push({ op: 'set_timeframe', value: '5m' });
        } else if (/swing\s*trad/.test(lc)) {
          ops.push({ op: 'add_indicator', name: 'sma_50' });
          ops.push({ op: 'set_subpanel', value: 'macd' });
          ops.push({ op: 'set_timeframe', value: '1D' });
        } else if (/long.?term|investor|retire/.test(lc)) {
          ops.push({ op: 'add_indicator', name: 'sma_50' });
          ops.push({ op: 'set_timeframe', value: '1Y' });
        } else if (/momentum/.test(lc)) {
          ops.push({ op: 'set_subpanel', value: 'rsi' });
          ops.push({ op: 'add_indicator', name: 'ema_12' });
        } else if (/clean/.test(lc) || /reset/.test(lc)) {
          ops.push({ op: 'clear_drawings' });
          if (/reset/.test(lc) || /everything/.test(lc) || /all/.test(lc)) {
            ops.push({ op: 'clear_indicators' });
          }
        }

        // Specific indicator commands
        if (/sma\s*20|sma20|20.day/.test(lc))      ops.push({ op: 'add_indicator', name: 'sma_20' });
        if (/sma\s*50|sma50|50.day/.test(lc))      ops.push({ op: 'add_indicator', name: 'sma_50' });
        if (/ema\s*12|ema12/.test(lc))             ops.push({ op: 'add_indicator', name: 'ema_12' });
        if (/ema\s*26|ema26/.test(lc))             ops.push({ op: 'add_indicator', name: 'ema_26' });
        if (/\brsi\b/.test(lc) && !ops.some(o => o.op === 'set_subpanel' && o.value === 'rsi'))
          ops.push({ op: 'set_subpanel', value: 'rsi' });
        if (/\bmacd\b/.test(lc) && !ops.some(o => o.op === 'set_subpanel' && o.value === 'macd'))
          ops.push({ op: 'set_subpanel', value: 'macd' });
        if (/\bvolume\b/.test(lc) && !/bubble/.test(lc))
          ops.push({ op: 'set_subpanel', value: 'volume' });
        if (/vol(ume)?\s*bubble|bubbles/.test(lc))
          ops.push({ op: 'add_indicator', name: 'vol_bubbles' });

        // Drawing/indicator clears
        if (/clear.*draw|remove.*draw|delete.*draw/.test(lc))
          ops.push({ op: 'clear_drawings' });
        if (/clear.*indicator|remove.*all.*indicator/.test(lc))
          ops.push({ op: 'clear_indicators' });
        if (/clear.*annotation|remove.*label|delete.*label|clear.*label/.test(lc))
          ops.push({ op: 'clear_annotations' });

        // Horizontal line at price
        const hlineMatch = cmd.match(/(?:line|level)\s*(?:at|@)?\s*\$?(\d+(?:\.\d+)?)/i);
        if (hlineMatch) ops.push({ op: 'add_hline', price: parseFloat(hlineMatch[1]) });

        // Timeframe — last so explicit values can override style intent
        const tfMatch = cmd.match(/\b(1m|5m|15m|30m|1h|1d|1w|1mo|1y|5y|10y|6m|3m)\b/i);
        if (tfMatch) {
          const map = { '1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','1d':'1D','1w':'1W','1mo':'1M','3m':'3M','6m':'6M','1y':'1Y','5y':'5Y','10y':'10Y' };
          ops.push({ op: 'set_timeframe', value: map[tfMatch[1].toLowerCase()] });
        }

        // Presets — save / load / delete
        const saveMatch = cmd.match(/(?:save|remember|store)(?:\s+(?:as|preset|setup))?\s+(.+)$/i);
        if (saveMatch) ops.push({ op: 'save_preset', name: saveMatch[1].trim().slice(0, 40) });
        else if (/^(save|remember)\b/.test(lc) && !ops.some(o => o.op === 'save_preset')) {
          // No name given — auto-generate from current state
          const auto = `Setup ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
          ops.push({ op: 'save_preset', name: auto });
        }
        const loadMatch = cmd.match(/(?:load|use|apply|switch\s+to|recall|restore)(?:\s+(?:my|preset))?\s+(.+)$/i);
        if (loadMatch) ops.push({ op: 'load_preset', name: loadMatch[1].trim() });
        const deleteMatch = cmd.match(/(?:delete|remove)\s+(?:my\s+)?preset\s+(.+)$/i);
        if (deleteMatch) ops.push({ op: 'delete_preset', name: deleteMatch[1].trim() });

        // Subcharts — add by name fragment matching
        const subchartHints = [
          { kw: /net.?drift/, type: 'net-drift' },
          { kw: /heat.?map/, type: 'heatmap' },
          { kw: /interval/, type: 'interval' },
          { kw: /vol.?drift|volatility.?drift/, type: 'vol-drift' },
          { kw: /vol.?skew|volatility.?skew/, type: 'vol-skew' },
          { kw: /net.?flow/, type: 'net-flow' },
          { kw: /dark.?(pool|flow)/, type: 'dark-flow' },
          { kw: /gainers|losers/, type: 'gainers' },
          { kw: /market.?map/, type: 'market-map' },
        ];
        // Only add news subchart if user explicitly says "news chart" / "news subchart"
        if (/news\s+(chart|subchart|panel|tab)/.test(lc) ||
            (/(add|show|open).*news/.test(lc) && !/news\s*tab/.test(lc) && !/feed/.test(lc))) {
          ops.push({ op: 'add_subchart', type: 'news' });
        }
        subchartHints.forEach(h => {
          if (h.kw.test(lc) && (/show|add|open|create/.test(lc) || ops.length === 0)) {
            if (!ops.some(o => o.op === 'add_subchart' && o.type === h.type)) {
              ops.push({ op: 'add_subchart', type: h.type });
            }
          }
        });
        if (/(close|remove).*(subchart|chart\s*tab)/.test(lc) && subcharts.length > 0) {
          ops.push({ op: 'remove_subchart', index: subcharts.length });
        }

        // Annotations
        const labelMatch = cmd.match(/(?:annotate|label|mark|note|tag|pin)\s+(?:this\s+)?(?:as\s+)?["']?([^"']{1,40})["']?/i);
        if (labelMatch) {
          const text = labelMatch[1].trim();
          let position = 'latest';
          if (/peak|high|top/.test(lc))    position = 'highest';
          else if (/low|bottom|dip/.test(lc)) position = 'lowest';
          // If user gave a price, prefer that
          const priceMatch = cmd.match(/\$?(\d+(?:\.\d+)?)/);
          if (priceMatch && /at|@/.test(lc)) {
            ops.push({ op: 'add_text_annotation', text, position: 'price', price: parseFloat(priceMatch[1]) });
          } else {
            ops.push({ op: 'add_text_annotation', text, position });
          }
        } else if (/\b(annotate|label|note|tag|mark)\b/.test(lc) && !ops.some(o => o.op === 'add_text_annotation')) {
          // Bare command — annotate with a default
          ops.push({ op: 'add_text_annotation', text: 'Note', position: 'latest' });
        }

        parsed = {
          ops,
          summary: ops.length === 0
            ? 'I couldn\'t parse that locally. Set VITE_ANTHROPIC_API_KEY for richer parsing.'
            : `Applied ${ops.length} operation${ops.length === 1 ? '' : 's'} (offline mode).`,
        };
      }

      // Apply ops to chart state
      const applied = [];
      const fuzzyMatchPreset = (name) => {
        const target = name.toLowerCase().trim();
        // Try exact, then includes, then any preset whose words overlap
        let found = presets.findIndex(p => p.name.toLowerCase() === target);
        if (found < 0) found = presets.findIndex(p => p.name.toLowerCase().includes(target));
        if (found < 0) {
          const targetWords = target.split(/\s+/).filter(w => w.length > 2);
          found = presets.findIndex(p => {
            const lc = p.name.toLowerCase();
            return targetWords.some(w => lc.includes(w));
          });
        }
        return found;
      };
      // Helper: find bar index by position keyword
      const findBarByPosition = (position, price) => {
        const bars = enrichedData;
        if (!bars || bars.length === 0) return null;
        if (position === 'latest') return bars.length - 1;
        if (position === 'highest') {
          let maxI = 0, maxV = -Infinity;
          bars.forEach((b, i) => { const h = b.high ?? b.close ?? b.price ?? 0; if (h > maxV) { maxV = h; maxI = i; } });
          return maxI;
        }
        if (position === 'lowest') {
          let minI = 0, minV = Infinity;
          bars.forEach((b, i) => { const l = b.low ?? b.close ?? b.price ?? 0; if (l < minV) { minV = l; minI = i; } });
          return minI;
        }
        // position === 'price' → just place at the latest bar with that y
        return bars.length - 1;
      };

      (parsed.ops ?? []).forEach(op => {
        try {
          if (op.op === 'add_indicator') {
            if (op.name === 'sma_20')      { setShowSma20(true);  applied.push('SMA 20'); }
            if (op.name === 'sma_50')      { setShowSma50(true);  applied.push('SMA 50'); }
            if (op.name === 'ema_12')      { setShowEma12(true);  applied.push('EMA 12'); }
            if (op.name === 'ema_26')      { setShowEma26(true);  applied.push('EMA 26'); }
            if (op.name === 'vol_bubbles') { setShowVolumeBubbles(true); applied.push('Vol bubbles'); }
          }
          if (op.op === 'remove_indicator') {
            if (op.name === 'sma_20')      { setShowSma20(false); applied.push('removed SMA 20'); }
            if (op.name === 'sma_50')      { setShowSma50(false); applied.push('removed SMA 50'); }
            if (op.name === 'ema_12')      { setShowEma12(false); applied.push('removed EMA 12'); }
            if (op.name === 'ema_26')      { setShowEma26(false); applied.push('removed EMA 26'); }
            if (op.name === 'vol_bubbles') { setShowVolumeBubbles(false); applied.push('removed vol bubbles'); }
          }
          if (op.op === 'set_subpanel' && ['rsi','macd','volume',null].includes(op.value)) {
            setSubPanel(op.value);
            applied.push(op.value ? `${op.value.toUpperCase()} panel` : 'closed sub-panel');
          }
          if (op.op === 'add_hline' && Number.isFinite(op.price)) {
            setHlines(prev => [...prev, { price: op.price, color: COLORS.mint }]);
            applied.push(`hline @ ${op.price}`);
          }
          if (op.op === 'clear_drawings') {
            setHlines([]); setVlines([]); setFibs([]); setChannels([]); setArrows([]); setTrendlines([]);
            applied.push('cleared drawings');
          }
          if (op.op === 'clear_indicators') {
            setShowSma20(false); setShowSma50(false); setShowEma12(false); setShowEma26(false);
            setShowVolumeBubbles(false); setSubPanel(null);
            setActiveIndicatorIds([]);
            try { localStorage.setItem('imo_indicator_favorites', '[]'); } catch {}
            applied.push('cleared indicators');
          }
          if (op.op === 'set_timeframe' && typeof op.value === 'string') {
            const valid = TIMEFRAMES.find(t => t.id === op.value);
            if (valid) { setTf(op.value); applied.push(`tf → ${op.value}`); }
          }
          if (op.op === 'add_named_indicator' && typeof op.id === 'string') {
            const id = op.id.toLowerCase();
            if (INDICATOR_IMPLS && INDICATOR_IMPLS[id]) {
              setActiveIndicatorIds(prev => {
                if (prev.includes(id)) return prev;
                const next = [...prev, id];
                try { localStorage.setItem('imo_indicator_favorites', JSON.stringify(next)); } catch {}
                return next;
              });
              applied.push(id);
            }
          }
          // ── Preset operations ──
          if (op.op === 'save_preset' && typeof op.name === 'string') {
            const newPreset = {
              name: op.name.trim().slice(0, 40),
              showSma20, showSma50, showEma12, showEma26,
              showVolumeBubbles, subPanel,
              indicators: activeIndicatorIds,
              strategies: activeStrategyIds,
              profiles: activeProfileIds,
              patterns: activePatternIds,
              trendlines, hlines, fibs, channels, arrows,
              savedAt: Date.now(),
            };
            const next = [...presets, newPreset];
            setPresets(next);
            try { localStorage.setItem('imo_chart_presets', JSON.stringify(next)); } catch {}
            applied.push(`saved "${op.name}"`);
          }
          if (op.op === 'load_preset' && typeof op.name === 'string') {
            const idx = fuzzyMatchPreset(op.name);
            if (idx >= 0) {
              const p = presets[idx];
              setShowSma20(!!p.showSma20);
              setShowSma50(!!p.showSma50);
              setShowEma12(!!p.showEma12);
              setShowEma26(!!p.showEma26);
              setShowVolumeBubbles(!!p.showVolumeBubbles);
              setSubPanel(p.subPanel ?? null);
              setActiveIndicatorIds(p.indicators ?? []);
              setActiveStrategyIds(p.strategies ?? []);
              setActiveProfileIds(p.profiles ?? []);
              setActivePatternIds(p.patterns ?? []);
              setTrendlines(p.trendlines ?? []);
              setHlines(p.hlines ?? []);
              setFibs(p.fibs ?? []);
              setChannels(p.channels ?? []);
              setArrows(p.arrows ?? []);
              applied.push(`loaded "${p.name}"`);
            } else {
              applied.push(`no preset matching "${op.name}"`);
            }
          }
          if (op.op === 'delete_preset' && typeof op.name === 'string') {
            const idx = fuzzyMatchPreset(op.name);
            if (idx >= 0) {
              const removed = presets[idx].name;
              const next = presets.filter((_, j) => j !== idx);
              setPresets(next);
              try { localStorage.setItem('imo_chart_presets', JSON.stringify(next)); } catch {}
              applied.push(`deleted "${removed}"`);
            }
          }
          // ── Sub-chart operations ──
          if (op.op === 'add_subchart' && typeof op.type === 'string') {
            const valid = SUBCHART_TYPES.find(t => t.id === op.type);
            if (valid) {
              const newId = `sc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              setSubcharts(prev => {
                const next = [...prev, { id: newId, type: op.type }];
                setPageIdx(next.length); // jump to new
                return next;
              });
              applied.push(`+ ${valid.label}`);
            }
          }
          if (op.op === 'remove_subchart' && Number.isInteger(op.index)) {
            // 1-based — index 1 = first subchart
            setSubcharts(prev => {
              if (op.index < 1 || op.index > prev.length) return prev;
              const removed = prev[op.index - 1];
              const next = prev.filter((_, j) => j !== op.index - 1);
              if (pageIdx > next.length) setPageIdx(next.length);
              applied.push(`removed ${removed?.type ?? 'subchart'}`);
              return next;
            });
          }
          if (op.op === 'switch_subchart' && Number.isInteger(op.index)) {
            const max = subcharts.length;
            const target = Math.max(0, Math.min(max, op.index));
            setPageIdx(target);
            applied.push(`view → ${target === 0 ? 'main' : subcharts[target - 1]?.type}`);
          }
          // ── Annotations / text labels ──
          if (op.op === 'add_text_annotation' && typeof op.text === 'string') {
            const x = findBarByPosition(op.position ?? 'latest');
            if (x != null) {
              let y = op.price;
              if (!Number.isFinite(y)) {
                // Use the price at that bar
                const bar = enrichedData[x];
                if (op.position === 'highest') y = bar?.high ?? bar?.close ?? bar?.price;
                else if (op.position === 'lowest') y = bar?.low ?? bar?.close ?? bar?.price;
                else y = bar?.close ?? bar?.price ?? bar?.high ?? 0;
              }
              setTextNotes(prev => [...prev, {
                x, y: Number(y) || 0,
                text: String(op.text).slice(0, 40),
              }]);
              applied.push(`label "${op.text.slice(0, 20)}"`);
            }
          }
          if (op.op === 'clear_annotations') {
            setTextNotes([]);
            applied.push('cleared annotations');
          }
        } catch (e) { console.warn('[ai-edit op]', e.message); }
      });
      setAiEditFeedback({
        applied,
        message: parsed.summary ?? (applied.length > 0 ? `Applied ${applied.length} change${applied.length === 1 ? '' : 's'}.` : 'No changes applied.'),
      });
      setAiEditLoading(false);
      // Auto-dismiss after a short pause if successful
      if (applied.length > 0) {
        setTimeout(() => { setAiEditPrompt(''); setShowAiEdit(false); setAiEditFeedback(null); }, 2200);
      }
    } catch (e) {
      setAiEditFeedback({ applied: [], message: `Error: ${e.message}` });
      setAiEditLoading(false);
    }
  };

  // Listen for chart-edit commands dispatched from the global "Ask me
  // anything" search bar at the top of the app. When a user types a
  // chart-edit-style query there, the search bar fires this event with
  // the prompt — we capture it, prefill the AI Edit input, and run.
  //
  // Per-instance scoping: when stacked chart widgets are present, the
  // event detail may carry an instanceId. If it does, only the matching
  // chart applies the prompt. Events without an instanceId continue to
  // broadcast to every chart (preserves the global-search-bar UX).
  useEffect(() => {
    const handler = (e) => {
      const prompt = e?.detail?.prompt;
      if (!prompt) return;
      const targetId = e?.detail?.instanceId;
      if (targetId && instanceId && targetId !== instanceId) return;
      setAiEditPrompt(prompt);
      setShowAiEdit(true);
      // Run on next tick so state updates flush before runAiEdit reads it
      setTimeout(() => { runAiEdit(); }, 50);
    };
    window.addEventListener('imo:ai-edit-chart', handler);
    return () => window.removeEventListener('imo:ai-edit-chart', handler);
    // runAiEdit closes over a lot of state — re-bind when key state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  // Derived ranges including indicators (so MAs don't get cropped)
  const allValues = useMemo(() => {
    const vals = data.map(d => d.price);
    [sma20Data, sma50Data, ema12Data, ema26Data].forEach(arr => {
      arr?.forEach(p => { if (p.v != null) vals.push(p.v); });
    });
    // Pull in custom-overlay values too so a wide-range overlay (e.g. PSAR
    // dipping below the price floor) doesn't get clipped.
    customOverlays.forEach(({ series }) => {
      Object.values(series).forEach(arr => {
        arr.forEach(v => { if (v != null && Number.isFinite(v)) vals.push(v); });
      });
    });
    return vals;
  }, [data, sma20Data, sma50Data, ema12Data, ema26Data, customOverlays]);

  // Y-axis range: use percentile clamping to filter outlier spikes that
  // would otherwise inflate the domain. A single bad bar (e.g., a stale
  // historical spike or a sudden tick from an out-of-sync source) used to
  // make the chart show 92K when BTC was actually at 77K. We clamp to the
  // 2nd-98th percentile of all visible series values, which filters stray
  // spikes while keeping the chart faithful to real price action.
  const { min, max } = useMemo(() => {
    if (allValues.length === 0) return { min: 0, max: 1 };
    if (allValues.length < 6) {
      // Too few points for percentiles to be meaningful — use raw min/max
      return { min: Math.min(...allValues), max: Math.max(...allValues) };
    }
    const sorted = [...allValues].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.02)];
    const hi = sorted[Math.floor(sorted.length * 0.98)];
    // Always include the latest price even if it's outside the percentile band
    const latest = data[data.length - 1]?.price;
    return {
      min: Math.min(lo, latest ?? lo),
      max: Math.max(hi, latest ?? hi),
    };
  }, [allValues, data]);
  const pad = Math.max((max - min) * 0.12, 0.01);
  const openPrice  = data[0]?.price ?? 0;
  const closePrice = data[data.length - 1]?.price ?? 0;
  const periodUp = closePrice >= openPrice;
  const color = periodUp ? COLORS.mint : COLORS.red;

  // Handle trendline clicks. The Recharts onClick gives us nearestX (data index),
  // and we infer the y from the active data point's price OR a manual click position.
  // For simplicity we anchor each click to the nearest data point's price.
  const handleChartClick = (state) => {
    if (!state || state.activeTooltipIndex == null) return;
    const idx = state.activeTooltipIndex;
    const price = data[idx]?.price;
    if (price == null) return;

    // ────────── CATALOG TOOL ALIASING ──────────
    // The Drawings picker exposes ~80 TradingView-style tools but only a
    // handful are natively rendered on this chart. To make every button
    // *do something* on click, we alias most catalog tools onto the
    // closest wired primitive. The tool's name is preserved for the
    // toast confirmation so users see exactly what they picked.
    const TOOL_ALIASES = {
      // Trend lines family
      'ray':            'trendline',
      'info-line':      'trendline',
      'extended':       'trendline',
      'angle':          'trendline',
      'hray':           'hline',
      'cross':          'hline',     // first click sets hline; we add vline below too
      'regression':     'channel',
      'flat-tb':        'channel',
      'disjoint':       'channel',
      'pitchfork':      'channel',
      'schiff-pf':      'channel',
      'mod-schiff':     'channel',
      'inside-pf':      'channel',
      // Gann + Fib family — all collapse to fib tool with different label
      'fib-ext':        'fib',
      'fib-channel':    'fib',
      'fib-time':       'fib',
      'fib-fan':        'fib',
      'fib-tb-time':    'fib',
      'fib-circles':    'fib',
      'fib-spiral':     'fib',
      'fib-arcs':       'fib',
      'fib-wedge':      'fib',
      'pitchfan':       'fib',
      'gann-box':       'channel',
      'gann-sq-fixed':  'channel',
      'gann-sq':        'channel',
      'gann-fan':       'channel',
      // Patterns — all multi-segment tools collapse to trendline (2 anchor points)
      'xabcd':          'trendline',
      'cypher':         'trendline',
      'head-shoulders': 'trendline',
      'abcd':           'trendline',
      'tri-pattern':    'trendline',
      'three-drives':   'trendline',
      'elliott-imp':    'trendline',
      'elliott-corr':   'trendline',
      'elliott-tri':    'trendline',
      'elliott-dbl':    'trendline',
      'elliott-trp':    'trendline',
      'cyclic-lines':   'vline',
      'time-cycles':    'vline',
      'sine-line':      'trendline',
      // Forecasting + Measurement — extend existing measurement tools
      'forecast':       'price-range',
      'bars-pattern':   'date-range',
      'ghost-feed':     'price-range',
      'projection':     'trendline',
      'anchored-vwap':  'vline',
      'fr-vol-prof':    'date-range',
      'a-vol-prof':     'vline',
      'date-price':     'price-range',
      // Geometric shapes — most map to channel (rectangle-ish) or arrow
      'brush':          'trendline',
      'highlighter':    'channel',
      'arrow-marker':   'arrow',
      'arrow-up':       'text',     // text annotation with ↑
      'arrow-down':     'text',     // text annotation with ↓
      'rectangle':      'channel',
      'rot-rect':       'channel',
      'path':           'trendline',
      'circle':         'channel',
      'ellipse':        'channel',
      'polyline':       'trendline',
      'triangle':       'trendline',
      'arc':            'trendline',
      'curve':          'trendline',
      'double-curve':   'trendline',
      // Annotation — all map to text
      'anchored-text':  'text',
      'note':           'text',
      'price-note':     'text',
      'pin':            'text',
      'table':          'text',
      'callout':        'text',
      'comment':        'text',
      'price-label':    'text',
      'signpost':       'text',
      'flag-mark':      'text',
      'image':          'text',
      'tweet':          'text',
      'idea':           'text',
      // Visuals
      'emojis':         'text',
      'stickers':       'text',
      'icons':          'text',
    };
    // Resolve the tool: if there's an alias, route through that wired primitive,
    // but remember what the user actually picked for the toast confirmation.
    const aliasedTool = TOOL_ALIASES[activeTool] ?? activeTool;
    const userPickedTool = activeTool;

    // Special case: Cross Line — sets BOTH a horizontal AND a vertical line
    // at the same click point.
    if (userPickedTool === 'cross') {
      setHlines(prev => [...prev, +price.toFixed(instrument.dec)]);
      setVlines(prev => [...prev, idx]);
      setActiveTool('crosshair');
      window.imoToast?.('Cross line placed', 'success');
      return;
    }
    // Arrow Up / Arrow Down: place a text annotation with an arrow glyph
    // automatically — no prompt needed.
    if (userPickedTool === 'arrow-up' || userPickedTool === 'arrow-down') {
      const glyph = userPickedTool === 'arrow-up' ? '↑' : '↓';
      setTextNotes(prev => [...prev, { x: idx, y: price, text: glyph }]);
      setActiveTool('crosshair');
      window.imoToast?.(userPickedTool === 'arrow-up' ? 'Arrow up placed' : 'Arrow down placed', 'success');
      return;
    }

    // Horizontal-line tool — single click sets a price level
    if (aliasedTool === 'hline') {
      setHlines(prev => [...prev, +price.toFixed(instrument.dec)]);
      setActiveTool('crosshair');
      if (userPickedTool !== 'hline') window.imoToast?.(`${userPickedTool} placed (rendered as horizontal line)`, 'info');
      return;
    }
    // Vertical-line tool — single click sets a time/index
    if (aliasedTool === 'vline') {
      setVlines(prev => [...prev, idx]);
      setActiveTool('crosshair');
      if (userPickedTool !== 'vline') window.imoToast?.(`${userPickedTool} placed (rendered as vertical line)`, 'info');
      return;
    }
    // Fib retracement — click two points (typically high then low)
    if (aliasedTool === 'fib') {
      if (!pendingPoint) {
        setPendingPoint({ x: idx, y: price });
      } else {
        setFibs(prev => [...prev, {
          x1: pendingPoint.x, y1: pendingPoint.y, x2: idx, y2: price,
        }]);
        setPendingPoint(null);
        setActiveTool('crosshair');
        if (userPickedTool !== 'fib') window.imoToast?.(`${userPickedTool} placed (rendered as Fibonacci levels)`, 'info');
      }
      return;
    }
    // Channel — parallel trendlines. First click + second click defines the
    // primary line; channel offset is fixed (~5% of price range) for visual.
    if (aliasedTool === 'channel') {
      if (!pendingPoint) {
        setPendingPoint({ x: idx, y: price });
      } else {
        setChannels(prev => [...prev, {
          x1: pendingPoint.x, y1: pendingPoint.y, x2: idx, y2: price,
          offset: (max - min) * 0.05,
        }]);
        setPendingPoint(null);
        setActiveTool('crosshair');
        if (userPickedTool !== 'channel') window.imoToast?.(`${userPickedTool} placed (rendered as parallel channel)`, 'info');
      }
      return;
    }
    // Arrow — click two points; renders trendline + arrowhead at second point
    if (aliasedTool === 'arrow') {
      if (!pendingPoint) {
        setPendingPoint({ x: idx, y: price });
      } else {
        setArrows(prev => [...prev, {
          x1: pendingPoint.x, y1: pendingPoint.y, x2: idx, y2: price,
        }]);
        setPendingPoint(null);
        setActiveTool('crosshair');
        if (userPickedTool !== 'arrow') window.imoToast?.(`${userPickedTool} placed (rendered as arrow)`, 'info');
      }
      return;
    }
    // Ruler — click two points, measurement shows % change
    if (aliasedTool === 'ruler') {
      if (!pendingPoint) {
        setPendingPoint({ x: idx, y: price });
      } else {
        setMeasurement({
          x1: pendingPoint.x, y1: pendingPoint.y,
          x2: idx, y2: price,
        });
        setPendingPoint(null);
        setActiveTool('crosshair');
        if (userPickedTool !== 'ruler') window.imoToast?.(`${userPickedTool} placed (rendered as ruler)`, 'info');
      }
      return;
    }
    // Long Position — 3 clicks: entry → stop → target. Renders red zone (entry→stop)
    // + green zone (entry→target) + R-multiple readout.
    if (aliasedTool === 'long-pos' || aliasedTool === 'short-pos') {
      const kind = aliasedTool === 'long-pos' ? 'long' : 'short';
      if (!pendingPoint) {
        setPendingPoint({ stage: 1, x1: idx, entry: price });
      } else if (pendingPoint.stage === 1) {
        setPendingPoint({ ...pendingPoint, stage: 2, stop: price });
      } else {
        setPositions(prev => [...prev, {
          kind,
          x1: pendingPoint.x1,
          x2: idx,
          entry: pendingPoint.entry,
          stop: pendingPoint.stop,
          target: price,
        }]);
        setPendingPoint(null);
        setActiveTool('crosshair');
      }
      return;
    }
    // Date Range — measure days/bars between two times
    if (aliasedTool === 'date-range') {
      if (!pendingPoint) {
        setPendingPoint({ x: idx, y: price });
      } else {
        setDateRanges(prev => [...prev, { x1: pendingPoint.x, x2: idx, y: price }]);
        setPendingPoint(null);
        setActiveTool('crosshair');
        if (userPickedTool !== 'date-range') window.imoToast?.(`${userPickedTool} placed (rendered as date range)`, 'info');
      }
      return;
    }
    // Price Range — measure price diff between two levels
    if (aliasedTool === 'price-range') {
      if (!pendingPoint) {
        setPendingPoint({ x: idx, y: price });
      } else {
        setPriceRanges(prev => [...prev, {
          x1: pendingPoint.x, y1: pendingPoint.y,
          x2: idx, y2: price,
        }]);
        setPendingPoint(null);
        setActiveTool('crosshair');
        if (userPickedTool !== 'price-range') window.imoToast?.(`${userPickedTool} placed (rendered as price range)`, 'info');
      }
      return;
    }
    // Text annotation — prompt for label and place at clicked point
    if (aliasedTool === 'text') {
      // For most aliased annotation tools, use the tool name as the default text
      // so users get a reasonable label without typing. Pure 'text' tool keeps
      // the original prompt behavior.
      let text = null;
      if (userPickedTool === 'text' || userPickedTool === 'anchored-text' || userPickedTool === 'note' || userPickedTool === 'comment') {
        text = (typeof window !== 'undefined' && window.prompt)
          ? window.prompt('Annotation text:', '')
          : null;
      } else {
        // Use the tool's emoji/glyph for visual tools, label for others
        const visualGlyphs = {
          'pin': '📍', 'flag-mark': '🏳', 'idea': '💡', 'tweet': '𝕏',
          'price-label': `$${price.toFixed(instrument.dec)}`,
          'price-note': `$${price.toFixed(instrument.dec)}`,
          'signpost': '⚐', 'callout': '💬', 'image': '🖼',
          'table': '⊞', 'emojis': '😀', 'stickers': '🌈', 'icons': '♥',
        };
        text = visualGlyphs[userPickedTool] ?? userPickedTool.replace(/-/g, ' ');
      }
      if (text && text.trim()) {
        setTextNotes(prev => [...prev, {
          x: idx, y: price, text: text.trim().slice(0, 40),
        }]);
        if (userPickedTool !== 'text') window.imoToast?.(`${userPickedTool} placed`, 'success');
      }
      setActiveTool('crosshair');
      return;
    }
    // Trendline tool (also gates on `drawing` for backwards compat)
    if (drawing || aliasedTool === 'trendline') {
      if (!pendingPoint) {
        setPendingPoint({ x: idx, y: price });
      } else {
        setTrendlines(prev => [...prev, {
          x1: pendingPoint.x, y1: pendingPoint.y, x2: idx, y2: price,
        }]);
        setPendingPoint(null);
        setDrawing(false);
        setActiveTool('crosshair');
        if (userPickedTool !== 'trendline') window.imoToast?.(`${userPickedTool} placed (rendered as trendline)`, 'info');
      }
    }
  };

  return (
    <div ref={chartRootRef} className="w-full h-full flex flex-col min-w-0 min-h-0" style={{ background: COLORS.bg }}>
      {/* The PRESETS quick dropdown was redundant after TIMEFRAMES were
          redefined as window-based (1H/1D/1W/1M/3M/1Y/5Y/10Y) — the
          tf buttons now serve the same role with simpler semantics. */}
      {false && (() => {
        const PRESETS = [
          { label: '1D:1m',   tf: '1m',  bars: 390  },   // ~6.5 hours of 1m bars
          { label: '5D:5m',   tf: '5m',  bars: 390  },   // 5 days of 5m bars
          { label: '5D:15m',  tf: '15m', bars: 130  },
          { label: '10D:30m', tf: '30m', bars: 130  },
          { label: '20D:1h',  tf: '1h',  bars: 130  },
          { label: '180D:4h', tf: '4h',  bars: 270  },
          { label: '1Y:1D',   tf: '1d',  bars: 252  },
          { label: '3Y:1W',   tf: '1w',  bars: 156  },
        ];
        const activePreset = PRESETS.find(p => tf === p.tf && (visibleBars === p.bars || visibleBars === 'all'));
        return (
          <div className="flex items-center gap-2 px-4 pt-2 border-b shrink-0 relative"
               style={{ borderColor: COLORS.border }}>
            <span className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Range</span>
            <div className="relative">
              <select
                value={activePreset?.label ?? ''}
                onChange={e => {
                  const p = PRESETS.find(x => x.label === e.target.value);
                  if (!p || isTfDisabled(p.tf)) return;
                  setTf(p.tf);
                  setVisibleBars(p.bars);
                }}
                className="text-[10.5px] pl-2 pr-6 py-1 rounded outline-none appearance-none cursor-pointer"
                style={{
                  background: COLORS.surface,
                  color: COLORS.mint,
                  border: `1px solid ${COLORS.border}`,
                  fontWeight: 500,
                  minWidth: 90,
                }}
                title="Change time range and bar interval"
              >
                {!activePreset && <option value="">Custom</option>}
                {PRESETS.map(p => (
                  <option key={p.label} value={p.label} disabled={isTfDisabled(p.tf)}>
                    {p.label}
                  </option>
                ))}
              </select>
              {/* Custom dropdown arrow */}
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-[8px]"
                    style={{ color: COLORS.textDim }}>▼</span>
            </div>
          </div>
        );
      })()}
      {/* Toolbar — split into two rows. Top row: timeframes + actions
          (Frequency, Add chart, Scan, Undo/Redo, AI Edit). Bottom row:
          OHLC + data-source badge. Per UX request the primary row no
          longer needs a horizontal scrollbar (1m–1H buttons removed
          via TOOLBAR_TF_ALLOWED filter), and the OHLC indicators sit
          on their own row below the timeframes instead of far-right.
          Wrapping enabled so anything that doesn't fit reflows
          gracefully into a third line on tiny widget tiles. */}
      <div className="flex flex-col px-3 pt-2 pb-1.5 gap-1 border-b shrink-0"
           style={{ borderColor: COLORS.border }}>
      <div
        className="flex items-center gap-1 flex-wrap"
      >
        <div className="flex items-center gap-1 shrink-0">
          {(() => {
            // Filter out the legacy intraday-bucket timeframes (1m / 5m /
            // 15m / 30m / 1H). Per UX request, the chart toolbar only
            // surfaces meaningful date ranges (1D and longer) — sub-day
            // intraday buckets are noise on the toolbar and the user can
            // adjust resolution via the Frequency selector instead. The
            // TIMEFRAMES array still includes them for back-compat with
            // saved layouts and AI-Edit references; we just don't render
            // them on the toolbar.
            const TOOLBAR_TF_ALLOWED = ['1D','5D','1W','1M','3M','6M','YTD','1Y','5Y','10Y','MAX'];
            const toolbarFrames = TIMEFRAMES.filter(t => TOOLBAR_TF_ALLOWED.includes(t.id));
            // Compact mode: show only the active timeframe + a chevron
            // that expands the rest in an inline strip when toggled. In
            // wide mode, show every timeframe inline as before.
            const visibleTimeframes = (isCompact && !toolbarExpanded)
              ? toolbarFrames.filter(t => t.id === tf)
              : toolbarFrames;
            return visibleTimeframes.map(t => {
              const disabled = isTfDisabled(t.id);
              const reason = tfDisabledReason(t.id);
              const active = tf === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => !disabled && setTf(t.id)}
                  disabled={disabled}
                  title={reason ?? t.desc ?? undefined}
                  className="px-2 py-1 text-[11px] rounded-md transition-all whitespace-nowrap border shrink-0"
                  style={{
                    color:           disabled ? COLORS.textMute  : (active ? COLORS.mint : COLORS.textDim),
                    background:      disabled ? 'transparent'   : (active ? 'rgba(61,123,255,0.08)' : COLORS.surface),
                    borderColor:     disabled ? COLORS.border   : (active ? COLORS.mint : COLORS.border),
                    opacity:         disabled ? 0.35           : 1,
                    textDecoration:  disabled ? 'line-through' : 'none',
                    cursor:          disabled ? 'not-allowed'  : 'pointer',
                    fontWeight:      active ? 500 : 400,
                  }}
                >{t.label}</button>
              );
            });
          })()}
          {/* Compact-mode chevron — expands the hidden timeframe pills.
              Only shown when the chart container is narrow enough to
              trigger compact mode in the first place. */}
          {isCompact && (
            <button onClick={() => setToolbarExpanded(s => !s)}
                    className="px-1.5 py-1 text-[11px] rounded-md transition-all border shrink-0"
                    style={{
                      color: COLORS.mint,
                      background: COLORS.surface,
                      borderColor: COLORS.mint + '88',
                    }}
                    title={toolbarExpanded ? 'Collapse timeframe row' : 'Show all timeframes'}>
              {toolbarExpanded ? '‹' : '›'}
            </button>
          )}
          {/* Frequency selector — sits inline with the timeframe pills
              as part of the same single row. Previously this had its
              own bordered subgroup with a "FREQUENCY" label, which
              made the toolbar read as two separate clusters. Now the
              dropdown sits flush with the timeframe pills using the
              same visual rhythm — one continuous toolbar row.
              The FREQUENCY label is dropped entirely; the dropdown's
              option labels (1m, 5m, 1h, etc.) make its purpose self-
              evident. Hover tooltip explains it for users who want
              the full context. */}
          <div className="flex items-center gap-1 shrink-0">
            <select value={freqInterval}
                    onChange={e => { setFreqInterval(e.target.value); setFreqSticky(true); }}
                    className="px-1.5 py-1 text-[10.5px] rounded-md tabular-nums outline-none"
                    style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}`, maxWidth: isCompact ? 110 : 'none' }}
                    title="Candle interval — how much real time each bar represents. Defaults are picked per range; pick manually to override. Some combinations are disabled when the range would render too many bars.">
              {(() => {
                // Resolve current range's span. If on a legacy TIMEFRAMES
                // id (1m/5m/15m/30m/1H), span is bars × barTf-mins.
                const legacy = TIMEFRAMES.find(x => x.id === tf);
                const tfMins = { '1m':1,'5m':5,'15m':15,'30m':30,'1h':60,'4h':240,'1d':1440,'1w':10080,'1M':43200 };
                const rangeMins = TIME_RANGES.find(x => x.id === tf)
                  ? resolveRangeMins(tf)
                  : (legacy?.bars ?? 100) * (tfMins[legacy?.barTf] ?? 60);
                return INTERVALS.map(iv => {
                  const tooMany = iv.maxRangeMins != null && rangeMins > iv.maxRangeMins;
                  const barCount = computeBarCount(rangeMins, iv.mins);
                  return (
                    <option key={iv.id} value={iv.id} disabled={tooMany}>
                      {iv.label}{tooMany ? ' (too many bars)' : ` (${barCount.toLocaleString()})`}
                    </option>
                  );
                });
              })()}
            </select>
            {/* Reset-zoom button — appears when the user has zoomed in via
                drag-select and the visible window is narrower than the
                timeframe's natural span. */}
            {visibleBars !== 'all' && visibleBars < tfDef.bars && (
              <button
                onClick={() => setVisibleBars(tfDef.bars)}
                className="ml-0.5 px-1.5 py-1 text-[10px] rounded transition-colors hover:bg-white/[0.04] shrink-0"
                style={{
                  color: COLORS.mint,
                  border: `1px solid ${COLORS.mint}55`,
                  background: 'rgba(30,58,108,0.06)',
                }}
                title="Reset zoom — restore the full timeframe window"
              >
                Reset zoom
              </button>
            )}
            {/* Stack + button — adds another chart widget to the layout.
                Sits next to the range selector per UX request, mirroring
                the inline + that appears next to non-chart widget titles.
                Fires a global event the layout system listens for. */}
            <button onClick={() => {
                      try { window.dispatchEvent(new CustomEvent('imo:stack-widget', { detail: { type: 'chart' } })); } catch {}
                    }}
                    className="ml-0.5 w-5 h-5 rounded flex items-center justify-center text-[11px] leading-none transition-colors hover:bg-white/[0.04] shrink-0"
                    style={{
                      color: COLORS.mint,
                      border: `1px solid ${COLORS.mint}66`,
                      background: 'transparent',
                      fontFamily: 'ui-monospace, monospace',
                    }}
                    title="Stack another chart widget in the layout">+</button>
            {/* Per-instance ticker search — small magnifier icon that
                opens the instrument picker for THIS chart only. The
                pinned-ticker mechanism (instanceId-keyed) means a
                stacked chart pane can swap to a different stock
                without affecting other widgets. */}
            {instanceId && (
              <button onClick={() => {
                        // Dispatch an event ChartWithSubcharts can pick
                        // up to open the pin picker. We piggyback on the
                        // existing toggle-pin-picker affordance so we
                        // don't duplicate UI.
                        try { window.dispatchEvent(new CustomEvent('imo:open-chart-picker', { detail: { instanceId } })); } catch {}
                      }}
                      className="ml-0.5 w-5 h-5 rounded flex items-center justify-center transition-colors hover:bg-white/[0.04] shrink-0"
                      style={{
                        color: COLORS.textDim,
                        border: `1px solid ${COLORS.border}`,
                        background: 'transparent',
                      }}
                      title="Search a different stock for this chart pane (independent from other widgets)">
                <Search size={11} />
              </button>
            )}
            {/* AI Edit + Scan — moved here so they sit next to the range
                selector instead of buried in the lower toolbar. */}
            <button onClick={() => { setShowScanner(true); runScanner(); }}
                    className="ml-0.5 flex items-center gap-1 px-1.5 py-1 text-[10px] rounded transition-colors hover:bg-white/[0.04] shrink-0"
                    style={{ borderColor: COLORS.mint, color: COLORS.mint, background: 'rgba(30,58,108,0.06)', border: `1px solid ${COLORS.mint}55` }}
                    title="AI Chart Scanner — analyze recent price action">
              <Sparkles size={10} />
              {!isCompact && 'Scan'}
            </button>
            {/* Undo / Redo — keyboard-accessible (Cmd+Z / Cmd+Shift+Z),
                also clickable for users who prefer the toolbar. */}
            <button onClick={handleUndo}
                    disabled={undoStack.length === 0}
                    className="px-1.5 py-1 text-[10px] rounded transition-colors hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                    style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}`, background: COLORS.surface }}
                    title={`Undo${undoStack.length > 0 ? ` (${undoStack.length})` : ''} · Cmd+Z`}>
              ↶
            </button>
            <button onClick={handleRedo}
                    disabled={redoStack.length === 0}
                    className="px-1.5 py-1 text-[10px] rounded transition-colors hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                    style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}`, background: COLORS.surface }}
                    title={`Redo${redoStack.length > 0 ? ` (${redoStack.length})` : ''} · Cmd+Shift+Z`}>
              ↷
            </button>
            <div className="relative shrink-0">
              {/* OHLC inline — when chart is in a big widget (not
                  compact), the OHLC values appear right next to AI
                  Edit per UX feedback so the price reference doesn't
                  get its own line below the toolbar. In compact mode
                  the second-row OHLC display is preserved (rendered
                  conditionally below). */}
              {!isCompact && (
                <span className="inline-flex items-center gap-2.5 mr-2 text-[11px] tabular-nums align-middle"
                      style={{ color: COLORS.textMute }}>
                  <span>O <span style={{ color: COLORS.text }}>{fmt(openPrice, instrument.dec)}</span></span>
                  <span>H <span style={{ color: COLORS.text }}>{fmt(Math.max(...data.map(d=>d.price), 0), instrument.dec)}</span></span>
                  <span>L <span style={{ color: COLORS.text }}>{fmt(data.length ? Math.min(...data.map(d=>d.price)) : 0, instrument.dec)}</span></span>
                  <span>C <span style={{ color }}>{fmt(closePrice, instrument.dec)}</span></span>
                </span>
              )}
              <button onClick={() => setShowAiEdit(s => !s)}
                      className="flex items-center gap-1 px-1.5 py-1 text-[10px] rounded transition-colors hover:bg-white/[0.04]"
                      style={{ borderColor: COLORS.mint, color: COLORS.mint, background: 'rgba(30,58,108,0.06)', border: `1px solid ${COLORS.mint}55` }}
                      title='Tell the AI what to change. Try: "make this a day-trading chart", "save as my setup", "load swing setup"'>
                <Sparkles size={10} />
                {!isCompact && 'AI Edit'}
              </button>
              {showAiEdit && (
                <>
                  <div className="fixed inset-0 z-40"
                       onClick={() => { setShowAiEdit(false); setAiEditFeedback(null); }} />
                  <div className="absolute right-0 top-full mt-1 rounded-md border z-50 overflow-hidden"
                       style={{ background: COLORS.surface, borderColor: COLORS.borderHi,
                                boxShadow: '0 8px 24px rgba(0,0,0,0.4)', width: 360 }}>
                    <div className="px-3 py-2 border-b text-[10px] uppercase tracking-wider"
                         style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
                      Tell the AI what to change
                    </div>
                    <div className="p-3">
                      {/* Input + mic — voice dictation appends the
                          recognized text to whatever's already in the
                          field so users can speak naturally and edit by
                          hand if needed. The MicButton self-hides on
                          browsers without Web Speech API support. */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <input autoFocus value={aiEditPrompt}
                               onChange={e => setAiEditPrompt(e.target.value)}
                               onKeyDown={e => {
                                 if (e.key === 'Enter' && !aiEditLoading) runAiEdit();
                                 if (e.key === 'Escape') { setShowAiEdit(false); setAiEditFeedback(null); }
                               }}
                               placeholder="e.g. make it look like day trading — or tap mic"
                               className="flex-1 min-w-0 px-2.5 py-1.5 text-[12px] rounded outline-none"
                               style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                        <MicButton onTranscript={(t) => {
                          setAiEditPrompt(prev => prev ? `${prev} ${t}` : t);
                        }} title="Speak your AI Edit command" />
                      </div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {[
                          'make it look like day trading',
                          'show me dark pool flow',
                          'label peak as resistance',
                          'save this setup',
                          ...(presets.length > 0 ? [`load ${presets[0].name}`] : []),
                          'clean it up',
                        ].map(s => (
                          <button key={s}
                                  onClick={() => setAiEditPrompt(s)}
                                  className="text-[9.5px] px-2 py-0.5 rounded transition-colors hover:bg-white/[0.04]"
                                  style={{ background: COLORS.surface2, color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                            {s}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => { setShowAiEdit(false); setAiEditFeedback(null); }}
                                className="px-3 py-1 text-[11px] rounded"
                                style={{ color: COLORS.textDim }}>Cancel</button>
                        <button disabled={!aiEditPrompt.trim() || aiEditLoading}
                                onClick={runAiEdit}
                                className="px-3 py-1 text-[11px] rounded font-medium disabled:opacity-40"
                                style={{ background: COLORS.mint, color: '#FFFFFF' }}>
                          {aiEditLoading ? 'Applying…' : 'Apply'}
                        </button>
                      </div>
                      {aiEditFeedback && (
                        <div className="mt-2 px-2.5 py-1.5 rounded text-[10.5px]"
                             style={{
                               background: aiEditFeedback.applied?.length > 0 ? 'rgba(31,178,107,0.08)' : COLORS.surface2,
                               color: aiEditFeedback.applied?.length > 0 ? COLORS.green : COLORS.textDim,
                               border: `1px solid ${aiEditFeedback.applied?.length > 0 ? COLORS.green + '44' : COLORS.border}`,
                             }}>
                          {aiEditFeedback.message}
                          {aiEditFeedback.applied?.length > 0 && (
                            <div className="mt-1 text-[9.5px]" style={{ color: COLORS.textMute }}>
                              {aiEditFeedback.applied.join(' · ')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {/* Hint hidden — hold-to-zoom is now ambient (no shift required). */}
      </div>
      {/* OHLC row — second line of the toolbar. Sits below timeframes
          per UX request so the price reference values are visually
          anchored to the chart they describe rather than far-right
          of the actions row. ml-auto removed; values flow left now.
          When the chart is in a big widget (isCompact === false) the
          OHLC values are inlined into the actions row next to AI Edit
          (see below) and this second row hides itself. */}
      {isCompact && (
      <div className="flex items-center gap-3 text-[11px] tabular-nums flex-wrap"
             style={{ color: COLORS.textMute }}>
          <span>O <span style={{ color: COLORS.text }}>{fmt(openPrice, instrument.dec)}</span></span>
          <span>H <span style={{ color: COLORS.text }}>{fmt(Math.max(...data.map(d=>d.price), 0), instrument.dec)}</span></span>
          <span>L <span style={{ color: COLORS.text }}>{fmt(data.length ? Math.min(...data.map(d=>d.price)) : 0, instrument.dec)}</span></span>
          <span>C <span style={{ color }}>{fmt(closePrice, instrument.dec)}</span></span>
          {status === 'ok' && source === 'coinbase' && (
            <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded"
                  style={{ background: 'rgba(151, 252, 228, 0.1)', color: COLORS.mint }}
                  title="Real historical candles from Coinbase Exchange">CB</span>
          )}
          {status === 'ok' && source === 'coingecko' && (
            <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded"
                  style={{ background: 'rgba(151, 252, 228, 0.1)', color: COLORS.mint }}
                  title="Real historical data from CoinGecko">CG</span>
          )}
          {status === 'ok' && source === 'eia' && (
            <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded"
                  style={{ background: 'rgba(151, 252, 228, 0.1)', color: COLORS.mint }}
                  title="Real historical data from U.S. EIA">EIA</span>
          )}
          {status === 'ok' && source === 'sim' && (
            <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded"
                  style={{ background: 'rgba(151, 252, 228, 0.1)', color: COLORS.mint }}
                  title="Demo historical data">EIA</span>
          )}
          {status === 'ok' && source === 'massive' && (
            <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded"
                  style={{ background: 'rgba(151, 252, 228, 0.1)', color: COLORS.mint }}
                  title="Real historical data from Massive (Polygon.io)">MASSIVE</span>
          )}
        </div>
      )}
      </div>

      {/* Main chart area + left drawing toolbar */}
      <div className={`${subPanel ? 'flex-[2]' : 'flex-1'} min-h-0 flex relative`}>
        {/* Vertical drawing toolbar — TradingView-style */}
        <div className="shrink-0 flex flex-col items-center gap-0.5 py-2 border-r"
             style={{ borderColor: COLORS.border, background: COLORS.surface, width: 38 }}>
          {[
            { id: 'crosshair', icon: '✛', title: 'Crosshair (default)' },
            { id: 'trendline', icon: '╱', title: 'Trendline — click two points' },
            { id: 'hline',     icon: '━', title: 'Horizontal line — click to set price' },
            { id: 'vline',     icon: '│', title: 'Vertical line — click to set time' },
            { id: 'fib',       icon: 'ƒ', title: 'Fib retracement — click two points (high then low)' },
            { id: 'channel',   icon: '⫽', title: 'Parallel channel — click two points' },
            { id: 'arrow',     icon: '➹', title: 'Arrow — click two points' },
            { id: 'ruler',     icon: '⊟', title: 'Measure — click two points to measure %' },
            { id: 'text',      icon: 'T', title: 'Text annotation' },
            { id: 'eraser',    icon: '⌫', title: 'Erase all drawings' },
          ].map(t => {
            const active = activeTool === t.id;
            return (
              <button key={t.id}
                      onClick={() => {
                        if (t.id === 'eraser') {
                          // Eraser is a one-shot action — clears every drawing
                          // type. Positions, date ranges, price ranges were
                          // added in a later session and weren't included in
                          // the original eraser, so they're listed here too.
                          setTrendlines([]);
                          setHlines([]);
                          setVlines([]);
                          setFibs([]);
                          setChannels([]);
                          setArrows([]);
                          setMeasurement(null);
                          setTextNotes([]);
                          setPositions([]);
                          setDateRanges([]);
                          setPriceRanges([]);
                          setActiveTool('crosshair');
                          setPendingPoint(null);
                          setDrawing(false);
                          return;
                        }
                        setActiveTool(t.id);
                        if (t.id === 'trendline') {
                          setDrawing(true);
                          setPendingPoint(null);
                        } else {
                          setDrawing(false);
                          setPendingPoint(null);
                        }
                      }}
                      title={t.title}
                      className="w-8 h-8 rounded flex items-center justify-center transition-colors"
                      style={{
                        color: active ? COLORS.mint : COLORS.textDim,
                        background: active ? 'rgba(61,123,255,0.08)' : 'transparent',
                        fontSize: t.id === 'text' ? 13 : 14,
                        fontWeight: t.id === 'text' ? 600 : 400,
                      }}>
                {t.icon}
              </button>
            );
          })}
          <div className="w-6 h-px my-1" style={{ background: COLORS.border }} />
          {/* Chart style toggles: candle, line, heikin-ashi, renko, line-break */}
          {[
            { id: 'candle',  icon: '▮', label: 'Candlestick' },
            { id: 'line',    icon: '⌇', label: 'Line / area' },
            { id: 'ha',      icon: '◧', label: 'Heikin Ashi (smoothed candles)' },
            { id: 'renko',   icon: '▦', label: 'Renko (price-based bricks)' },
            { id: 'lb',      icon: '☱', label: 'Line break (3-line break)' },
          ].map(s => (
            <button key={s.id}
                    onClick={() => setChartStyle(s.id)}
                    title={s.label}
                    className="w-8 h-8 rounded flex items-center justify-center transition-colors"
                    style={{
                      color: chartStyle === s.id ? COLORS.mint : COLORS.textDim,
                      background: chartStyle === s.id ? 'rgba(61,123,255,0.08)' : 'transparent',
                      fontSize: 13,
                    }}>
              {s.icon}
            </button>
          ))}
          <div className="w-6 h-px my-1" style={{ background: COLORS.border }} />
          {/* News marker toggle — show/hide sentiment-scored news dots
              on the chart. Only meaningful for equities; non-equities
              don't get news fetched. */}
          {instrument?.cls === 'equity' && (
            <button onClick={() => setShowNewsMarkers(v => !v)}
                    title={showNewsMarkers
                      ? 'Hide news sentiment markers'
                      : 'Show news sentiment markers (color-coded dots above/below candles)'}
                    className="w-8 h-8 rounded flex items-center justify-center transition-colors"
                    style={{
                      color: showNewsMarkers ? COLORS.mint : COLORS.textDim,
                      background: showNewsMarkers ? 'rgba(61,123,255,0.08)' : 'transparent',
                      fontSize: 13,
                      position: 'relative',
                    }}>
              <span>📰</span>
              {showNewsMarkers && newsMarkers.length > 0 && (
                <span style={{
                  position: 'absolute',
                  top: 1,
                  right: 1,
                  background: COLORS.mint,
                  color: COLORS.bg,
                  borderRadius: 6,
                  padding: '0 3px',
                  fontSize: 8,
                  fontWeight: 700,
                  lineHeight: 1.4,
                }}>
                  {newsMarkers.length > 9 ? '9+' : newsMarkers.length}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Chart canvas */}
        <div className="flex-1 min-h-0 px-2 pt-4 pb-2 relative">
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-[12px] flex items-center gap-2" style={{ color: COLORS.textMute }}>
              <Circle size={10} className="live-dot" style={{ color: COLORS.textMute, fill: COLORS.textMute }} />
              Loading historical data…
            </div>
          </div>
        )}
        {status === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center pointer-events-none">
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
                 style={{ background: COLORS.surface }}>
              <X size={18} style={{ color: COLORS.textMute }} />
            </div>
            <div className="text-[13px]" style={{ color: COLORS.text }}>
              Historical data unavailable
            </div>
            <div className="text-[11px] max-w-sm" style={{ color: COLORS.textMute }}>
              {instrument.cls === 'energy' && EIA_UNAVAILABLE_TF.has(tf)
                ? 'EIA provides only daily settlement data. Pick 1d or longer.'
                : 'This timeframe is no longer clickable for this market. Try a different one.'}
            </div>
          </div>
        )}
        {status === 'ok' && hasData && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={enrichedData}
                       margin={{ top: 10, right: 58, left: 0, bottom: 8 }}
                       onClick={handleChartClick}
                       onMouseDown={(state, e) => {
                         // Drag-to-zoom: hold the mouse button and drag.
                         // Disabled when a drawing tool is active (so the
                         // tool can use the click). The drawing tools set
                         // activeTool away from 'crosshair'.
                         if (activeTool && activeTool !== 'crosshair') return;
                         if (!state || state.activeTooltipIndex == null) return;
                         setZoomDrag({ startIdx: state.activeTooltipIndex, endIdx: state.activeTooltipIndex });
                       }}
                       onMouseMove={(state, evt) => {
                         // Update the current end index while dragging
                         if (zoomDrag && state && state.activeTooltipIndex != null) {
                           setZoomDrag(z => z ? { ...z, endIdx: state.activeTooltipIndex } : z);
                         }
                         // Crosshair follows the actual cursor Y, not the bar
                         // close. We read chartY from the recharts state (it's
                         // the pixel offset from the chart container top), then
                         // convert to price using the visible Y domain. The
                         // chart's internal margin.top is 10 and the plot area
                         // ends at containerHeight - margin.bottom (8).
                         if (state && state.chartY != null && Number.isFinite(state.chartY)) {
                           // We need plot height to invert chartY → price. The
                           // wrapped element gives us `currentTarget` via evt.
                           const wrapper = evt?.currentTarget;
                           const containerH = wrapper?.clientHeight ?? wrapper?.offsetHeight ?? 0;
                           const marginTop = 10;
                           const marginBottom = 8;
                           const plotH = Math.max(1, containerH - marginTop - marginBottom);
                           // chartY is offset from the chart container top.
                           // Subtract marginTop to get offset within the plot.
                           const yInPlot = Math.max(0, Math.min(plotH, state.chartY - marginTop));
                           const yMin = min - pad;
                           const yMax = max + pad;
                           // Recharts plots higher prices at smaller Y values
                           const price = yMax - (yInPlot / plotH) * (yMax - yMin);
                           if (Number.isFinite(price)) {
                             setCrosshair({
                               idx: state.activeTooltipIndex ?? null,
                               t: state.activePayload?.[0]?.payload?.t,
                               price,
                             });
                           }
                         }
                       }}
                       onMouseLeave={() => {
                         if (zoomDrag) setZoomDrag(null);
                         setCrosshair(null);
                       }}
                       onMouseUp={() => {
                         // On release, zoom the chart to the selected range
                         if (!zoomDrag) return;
                         const { startIdx, endIdx } = zoomDrag;
                         const lo = Math.min(startIdx, endIdx);
                         const hi = Math.max(startIdx, endIdx);
                         const span = hi - lo;
                         // Require at least 5 bars selected — accidental
                         // single-pixel drags shouldn't zoom to nothing.
                         if (span >= 5) {
                           setVisibleBars(span + 1);
                         }
                         setZoomDrag(null);
                       }}
                       onDoubleClick={(state) => {
                         // Zoom in around the clicked region — halve the
                         // visible range, keep the clicked point centered.
                         if (!state || state.activeTooltipIndex == null) return;
                         const dataLen = enrichedData.length;
                         const currentVisible = visibleBars === 'all' ? dataLen : Math.min(dataLen, visibleBars);
                         const next = Math.max(20, Math.round(currentVisible / 2));
                         setVisibleBars(next);
                       }}>
              <defs>
                <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="0" vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis
                domain={[min - pad, max + pad]}
                orientation="right"
                tick={{ fill: COLORS.textMute, fontSize: 10, fontFamily: 'ui-monospace,monospace' }}
                tickFormatter={(v) => fmt(v, instrument.dec)}
                stroke="transparent"
                width={58}
              />
              {/* Drag-to-zoom selection rectangle. Renders only while the
                  user is actively dragging with Shift held. The bounded
                  area highlights the selected range — on mouseup the
                  chart visibleBars snaps to that span. */}
              {zoomDrag && Math.abs(zoomDrag.endIdx - zoomDrag.startIdx) >= 1 && (
                <ReferenceArea
                  x1={enrichedData[Math.min(zoomDrag.startIdx, zoomDrag.endIdx)]?.t}
                  x2={enrichedData[Math.max(zoomDrag.startIdx, zoomDrag.endIdx)]?.t}
                  strokeOpacity={0.4}
                  stroke={COLORS.mint}
                  fill={COLORS.mint}
                  fillOpacity={0.12}
                />
              )}
              {/* Crosshair horizontal line — follows cursor at the hovered
                  price. The vertical line below shows the matching time
                  on the X axis so users get a full reading at a glance. */}
              {crosshair && crosshair.price != null && Number.isFinite(crosshair.price) && (
                <ReferenceLine
                  y={crosshair.price}
                  stroke={COLORS.borderHi}
                  strokeDasharray="3 3"
                  strokeWidth={1}
                  ifOverflow="extendDomain"
                  label={{
                    value: fmt(crosshair.price, instrument.dec),
                    position: 'right',
                    fill: COLORS.text,
                    fontSize: 10,
                    fontFamily: 'ui-monospace,monospace',
                    offset: -2,
                  }}
                />
              )}
              {/* Crosshair vertical line + time label — XAxis is hidden
                  by default so we never show date marks on the chart. But
                  when the user hovers, they want to know WHEN this bar is.
                  We render a dashed vertical ReferenceLine at the hovered
                  bar's timestamp with the time formatted as the label.
                  Format adapts to bar interval — intraday shows HH:MM,
                  daily/weekly shows MMM DD, monthly shows MMM YYYY — so
                  the label is always meaningful for the active scale. */}
              {crosshair && crosshair.t != null && (
                <ReferenceLine
                  x={crosshair.t}
                  stroke={COLORS.borderHi}
                  strokeDasharray="3 3"
                  strokeWidth={1}
                  label={{
                    value: (() => {
                      const t = crosshair.t;
                      // crosshair.t can be a number (epoch ms), a Date,
                      // or a pre-formatted string. Try to coerce to Date.
                      const d = (t instanceof Date) ? t
                              : (typeof t === 'number') ? new Date(t)
                              : (typeof t === 'string' && /^\d/.test(t)) ? new Date(t)
                              : null;
                      if (!d || isNaN(d.getTime())) return String(t).slice(0, 16);
                      // Pick format based on bar interval. freqInterval
                      // may be undefined for legacy timeframes; fall back
                      // to bar-interval-derived heuristic.
                      const fi = (typeof freqInterval !== 'undefined') ? freqInterval : null;
                      const isIntraday = fi && /^(\d+m|\d+h|1m|5m|15m|30m|1h|2h|4h)$/.test(fi);
                      const isMonthly = fi === '1M';
                      const isWeekly = fi === '1w';
                      if (isMonthly) {
                        return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
                      }
                      if (isWeekly) {
                        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                      }
                      if (isIntraday || /(\d+)m$/.test(fi ?? '') || /(\d+)h$/.test(fi ?? '')) {
                        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                      }
                      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    })(),
                    position: 'insideBottom',
                    fill: COLORS.text,
                    fontSize: 10,
                    fontFamily: 'ui-monospace,monospace',
                    offset: 4,
                    // Background fill so the time label stays readable
                    // when bars sit directly behind it.
                  }}
                />
              )}
              {/* Position entry markers — one ReferenceDot per open
                  position in this instrument. Anchored at (openedAt
                  snapped to nearest bar, entry price). Green for
                  long/buy, red for short/sell. Per UX request:
                  "if user places order the order should come up on
                  the graph on the horizontal axis as a point for
                  that stock". Closed positions are excluded — they
                  belong on the History panel, not the live chart. */}
              {positionMarkers.map(m => (
                <ReferenceDot key={m.id}
                              x={m.x}
                              y={m.y}
                              r={5}
                              fill={m.isLong ? COLORS.green : COLORS.red}
                              stroke={COLORS.bg}
                              strokeWidth={2}
                              ifOverflow="visible"
                              isFront
                              label={{
                                value: m.isLong ? '▲' : '▼',
                                position: m.isLong ? 'top' : 'bottom',
                                fill: m.isLong ? COLORS.green : COLORS.red,
                                fontSize: 11,
                                fontWeight: 700,
                              }} />
              ))}
              {/* News sentiment markers — rendered only when toggle is on.
                  Color-coded by sentiment polarity: green = positive,
                  red = negative, grey = neutral. Tooltip shows headline +
                  publisher. Click-through (via onClick on the SVG dot)
                  isn't supported by Recharts ReferenceDot directly, so
                  the user gets the headline in the tooltip instead. */}
              {newsMarkers.map(m => {
                const tone = Math.abs(m.score) >= 0.5 ? (m.isPositive ? COLORS.green : COLORS.red)
                           : Math.abs(m.score) >= 0.15 ? (m.isPositive ? '#7AC8FF' : '#FFB84D')
                           :                              COLORS.textMute;
                return (
                  <ReferenceDot key={m.id}
                                x={m.x}
                                y={m.y}
                                r={3}
                                fill={tone}
                                stroke={COLORS.bg}
                                strokeWidth={1}
                                ifOverflow="visible"
                                isFront
                                label={{
                                  value: '●',
                                  position: m.isPositive ? 'top' : 'bottom',
                                  fill: tone,
                                  fontSize: 8,
                                }} />
                );
              })}
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || !payload.length) return null;
                  // Filter to user-meaningful entries only — drop OHLC arrays,
                  // bodyRange, ohlcRange, haRange, and any null/undefined values.
                  const HIDDEN = new Set(['ohlcRange', 'haRange', 'bodyRange']);
                  const visible = payload.filter(p => {
                    if (HIDDEN.has(p.dataKey ?? p.name)) return false;
                    if (Array.isArray(p.value)) return false;
                    if (p.value == null || !Number.isFinite(p.value)) return false;
                    return true;
                  });
                  if (visible.length === 0) return null;
                  // News at this bar — find newsMarkers whose x (snapped bar
                  // timestamp) matches the hovered label. Markers store the
                  // matched bar's value in m.x; we compare against label.
                  const newsHere = newsMarkers.filter(m => m.x === label);
                  return (
                    <div style={{
                      background: COLORS.surface2,
                      border: `1px solid ${COLORS.borderHi}`,
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontFamily: 'ui-monospace,monospace',
                      fontSize: 11,
                      maxWidth: 360,
                    }}>
                      {visible.map((p, i) => (
                        <div key={i} style={{ color: COLORS.text, lineHeight: 1.6 }}>
                          <span style={{ color: COLORS.textMute }}>{p.name}: </span>
                          <span>{fmt(p.value, instrument.dec)}</span>
                        </div>
                      ))}
                      {newsHere.length > 0 && (
                        <div style={{
                          marginTop: 6,
                          paddingTop: 6,
                          borderTop: `1px solid ${COLORS.border}`,
                          fontFamily: 'system-ui, sans-serif',
                        }}>
                          <div style={{
                            fontSize: 9,
                            color: COLORS.textMute,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            marginBottom: 4,
                          }}>
                            {newsHere.length === 1 ? 'News' : `${newsHere.length} news items`}
                          </div>
                          {newsHere.slice(0, 3).map((n, i) => {
                            const tone = Math.abs(n.score) >= 0.5
                              ? (n.isPositive ? COLORS.green : COLORS.red)
                              : Math.abs(n.score) >= 0.15
                              ? (n.isPositive ? '#7AC8FF' : '#FFB84D')
                              : COLORS.textMute;
                            return (
                              <div key={i} style={{
                                marginBottom: i < newsHere.length - 1 ? 4 : 0,
                                lineHeight: 1.4,
                              }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 10, marginBottom: 1 }}>
                                  <span style={{
                                    background: `${tone}20`,
                                    color: tone,
                                    padding: '0 4px',
                                    borderRadius: 3,
                                    fontWeight: 500,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.04em',
                                    fontSize: 8,
                                    flexShrink: 0,
                                  }}>
                                    {n.score >= 0 ? '+' : ''}{(n.score * 100).toFixed(0)}
                                  </span>
                                  <span style={{ color: COLORS.textMute, fontSize: 9, flexShrink: 0 }}>
                                    {n.publisher || 'News'}
                                  </span>
                                </div>
                                <div style={{
                                  color: COLORS.text,
                                  fontSize: 11,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}>
                                  {n.title}
                                </div>
                              </div>
                            );
                          })}
                          {newsHere.length > 3 && (
                            <div style={{ fontSize: 9, color: COLORS.textMute, marginTop: 2 }}>
                              + {newsHere.length - 3} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }}
                cursor={{ stroke: COLORS.borderHi, strokeDasharray: '3 3' }}
              />
              {chartStyle === 'line' && (
                <Area
                  type="monotone"
                  dataKey="price"
                  name="Price"
                  stroke={color}
                  strokeWidth={1.4}
                  fill="url(#priceGrad)"
                  isAnimationActive={false}
                  dot={false}
                  activeDot={{ r: 4, fill: color, stroke: COLORS.bg, strokeWidth: 2 }}
                />
              )}
              {chartStyle === 'candle' && (
                <Bar
                  dataKey="ohlcRange"
                  isAnimationActive={false}
                  shape={(props) => {
                    // Custom candlestick: draws the wick (high–low line) plus
                    // the body (open–close rectangle). props.x/y/width/height
                    // give us the bar's bounding box in pixel space, scaled
                    // for the [low, high] dataKey range. We need to translate
                    // open/close into pixels using the same scale.
                    const { x, y, width, height, payload } = props;
                    if (!payload) return null;
                    const { open, close, high, low, isUp } = payload;
                    const range = high - low;
                    if (range <= 0) return null;
                    const candleColor = isUp ? COLORS.green : COLORS.red;
                    // Pixel position of open and close within the [low, high] band
                    const openY = y + ((high - open) / range) * height;
                    const closeY = y + ((high - close) / range) * height;
                    const bodyTop = Math.min(openY, closeY);
                    const bodyHeight = Math.max(1, Math.abs(closeY - openY));
                    // Body rectangle width — leave a small gap between candles
                    const bodyW = Math.max(1, width * 0.7);
                    const bodyX = x + (width - bodyW) / 2;
                    const wickX = x + width / 2;
                    return (
                      <g>
                        {/* Wick: vertical line from high to low through center */}
                        <line x1={wickX} y1={y} x2={wickX} y2={y + height}
                              stroke={candleColor} strokeWidth={1.5} />
                        {/* Body: filled rect from open to close */}
                        <rect x={bodyX} y={bodyTop}
                              width={bodyW} height={bodyHeight}
                              fill={candleColor}
                              stroke={candleColor} strokeWidth={1} />
                      </g>
                    );
                  }}
                />
              )}
              {/* Heikin Ashi — same shape as candle, but uses smoothed
                  haOpen/haClose/haHigh/haLow values. HA candles tend to
                  have fewer wicks and sustain trends visually. */}
              {chartStyle === 'ha' && (
                <Bar
                  dataKey="haRange"
                  isAnimationActive={false}
                  shape={(props) => {
                    const { x, y, width, height, payload } = props;
                    if (!payload) return null;
                    const { haOpen, haClose, haHigh, haLow, haIsUp } = payload;
                    const range = haHigh - haLow;
                    if (range <= 0) return null;
                    const candleColor = haIsUp ? COLORS.green : COLORS.red;
                    const openY = y + ((haHigh - haOpen) / range) * height;
                    const closeY = y + ((haHigh - haClose) / range) * height;
                    const bodyTop = Math.min(openY, closeY);
                    const bodyHeight = Math.max(1, Math.abs(closeY - openY));
                    const bodyW = Math.max(1, width * 0.75);
                    const bodyX = x + (width - bodyW) / 2;
                    const wickX = x + width / 2;
                    return (
                      <g>
                        <line x1={wickX} y1={y} x2={wickX} y2={y + height}
                              stroke={candleColor} strokeWidth={1.5} />
                        <rect x={bodyX} y={bodyTop}
                              width={bodyW} height={bodyHeight}
                              fill={haIsUp ? candleColor : candleColor}
                              fillOpacity={0.85}
                              stroke={candleColor} strokeWidth={1} />
                      </g>
                    );
                  }}
                />
              )}
              {/* Renko — price-based bricks. We render a hidden line so the
                  axis still scales properly, then use a custom Layer below
                  via a <Bar> with a shape that paints bricks across the
                  span. The key insight: Renko ignores time — each brick
                  represents a fixed price move. We emulate this by walking
                  the close series and emitting a brick whenever price moves
                  beyond a threshold (1% of mean price). */}
              {chartStyle === 'renko' && (
                <Bar
                  dataKey="ohlcRange"
                  isAnimationActive={false}
                  shape={(props) => {
                    // Only render the first bar's shape — it draws the
                    // entire Renko series across the chart width
                    const { x, y, width, height, payload, index } = props;
                    if (index !== 0 || !payload) return null;
                    return null; // bricks rendered in overlay below
                  }}
                />
              )}
              {/* Line break / 3-line break: similar treatment to Renko —
                  draw segments where each line continues until reversed by
                  3 prior closes. Rendered as overlay below for simplicity. */}
              {chartStyle === 'lb' && (
                <Bar
                  dataKey="ohlcRange"
                  isAnimationActive={false}
                  shape={() => null}
                />
              )}
              {/* Indicator overlays — only render the ones toggled on.
                  ComposedChart (not AreaChart) is required for Line children
                  to actually render alongside the Area. */}
              {showSma20 && (
                <Line type="monotone" dataKey="sma20" name="SMA(20)"
                      stroke={COLORS.chartAmber} strokeWidth={1.4} dot={false}
                      isAnimationActive={false} connectNulls={true} />
              )}
              {showSma50 && (
                <Line type="monotone" dataKey="sma50" name="SMA(50)"
                      stroke={COLORS.chartPurple} strokeWidth={1.4} dot={false}
                      isAnimationActive={false} connectNulls={true} />
              )}
              {showEma12 && (
                <Line type="monotone" dataKey="ema12" name="EMA(12)"
                      stroke={COLORS.chartCyan} strokeWidth={1.4} dot={false}
                      isAnimationActive={false} connectNulls={true} />
              )}
              {showEma26 && (
                <Line type="monotone" dataKey="ema26" name="EMA(26)"
                      stroke={COLORS.chartPink} strokeWidth={1.4} dot={false}
                      isAnimationActive={false} connectNulls={true} />
              )}
              {/* User-favorited indicator overlays. Each overlay can
                  contribute multiple Lines (e.g. Bollinger Bands has
                  upper/mid/lower). dataKeys are namespaced as
                  `${id}__${lineKey}` to avoid colliding with built-ins
                  or with each other. Dashed lines use strokeDasharray. */}
              {customOverlays.flatMap(({ id, impl }) =>
                impl.lines.map(ln => (
                  <Line key={`ovl-${id}-${ln.key}`}
                        type="monotone"
                        dataKey={`${id}__${ln.key}`}
                        name={ln.label}
                        stroke={ln.color}
                        strokeWidth={1.3}
                        strokeDasharray={ln.dashed ? '4 3' : ln.style === 'dotted' ? '2 4' : undefined}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls={true} />
                ))
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {/* Vertical Volume Profile overlay — horizontal bars on the right
            edge showing volume traded at each price level. Layered
            absolutely above the chart, pointer-events disabled so it
            doesn't interfere with chart interactions. The bars are
            normalized to the max bucket and rendered as filled rects. */}
        {hasData && volumeProfileData && (
          <div className="absolute pointer-events-none"
               style={{ top: 10, right: 58, bottom: 8, width: 70 }}>
            <svg className="w-full h-full" viewBox="0 0 70 100" preserveAspectRatio="none">
              {volumeProfileData.buckets.map((vol, i) => {
                const total = volumeProfileData.buckets.length;
                // Y is inverted (high price at top, low at bottom)
                const y = ((total - 1 - i) / total) * 100;
                const h = (1 / total) * 100 - 0.5;
                const w = (vol / volumeProfileData.maxVol) * 60;
                return (
                  <rect key={i} x={0} y={y} width={w} height={h}
                        fill={COLORS.mint}
                        fillOpacity={0.18 + (vol / volumeProfileData.maxVol) * 0.4} />
                );
              })}
            </svg>
            {/* Label */}
            <div className="absolute top-0 right-1 text-[8px] uppercase tracking-wider"
                 style={{ color: COLORS.textMute }}>
              Vol
            </div>
          </div>
        )}

        {/* Renko overlay — bricks of fixed price size. Walks the close
            series and emits a new brick every time price moves more than
            ~1% of the median price from the last brick's close. Each brick
            is colored mint (up) or red (down). Time axis is preserved
            visually so bricks line up with their bar index, but bricks are
            equally spaced — no time gaps between them. */}
        {hasData && chartStyle === 'renko' && (
          <div className="absolute pointer-events-none"
               style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
            <svg className="w-full h-full">
              {(() => {
                const median = data[Math.floor(data.length / 2)]?.price ?? 1;
                const brickSize = median * 0.01; // 1% threshold
                const bricks = [];
                let lastBrickClose = data[0]?.price;
                let lastDir = 0;
                data.forEach((d) => {
                  if (lastBrickClose == null) { lastBrickClose = d.price; return; }
                  const move = d.price - lastBrickClose;
                  while (Math.abs(move) >= brickSize) {
                    const dir = move > 0 ? 1 : -1;
                    const next = lastBrickClose + dir * brickSize;
                    bricks.push({ open: lastBrickClose, close: next, dir });
                    lastBrickClose = next;
                    lastDir = dir;
                    if (Math.abs(d.price - lastBrickClose) < brickSize) break;
                  }
                });
                if (bricks.length === 0) return null;
                const maxBricks = Math.max(bricks.length, 1);
                const yRange = (max + pad) - (min - pad);
                const brickW = 100 / maxBricks; // % width per brick
                return bricks.map((b, i) => {
                  const xPct = i * brickW;
                  const top = Math.max(b.open, b.close);
                  const bot = Math.min(b.open, b.close);
                  const yTop = 100 - ((top - (min - pad)) / yRange) * 100;
                  const yBot = 100 - ((bot - (min - pad)) / yRange) * 100;
                  const c = b.dir > 0 ? COLORS.green : COLORS.red;
                  return (
                    <rect key={i}
                          x={`${xPct + 0.1}%`} y={`${yTop}%`}
                          width={`${brickW - 0.2}%`}
                          height={`${yBot - yTop}%`}
                          fill={c} fillOpacity={0.6}
                          stroke={c} strokeWidth={0.6} />
                  );
                });
              })()}
            </svg>
          </div>
        )}

        {/* Line Break overlay (3-line break). Each new line continues the
            current direction until the close reverses through the open of
            the most recent 3 lines. Like Renko but variable-size segments
            tied to actual closes. */}
        {hasData && chartStyle === 'lb' && (
          <div className="absolute pointer-events-none"
               style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
            <svg className="w-full h-full">
              {(() => {
                const lines = [];
                let dir = 0; // 1 = up trend, -1 = down trend, 0 = none
                data.forEach((d) => {
                  if (lines.length === 0) {
                    lines.push({ open: d.price, close: d.price, dir: 0 });
                    return;
                  }
                  const last = lines[lines.length - 1];
                  if (dir === 0) {
                    // Initialize direction
                    if (d.price > last.close) {
                      lines.push({ open: last.close, close: d.price, dir: 1 });
                      dir = 1;
                    } else if (d.price < last.close) {
                      lines.push({ open: last.close, close: d.price, dir: -1 });
                      dir = -1;
                    }
                  } else if (dir === 1) {
                    // Up trend continues if higher high
                    if (d.price > last.close) {
                      lines.push({ open: last.close, close: d.price, dir: 1 });
                    } else {
                      // Reversal needs to break the lowest of the last 3 lines' opens
                      const lookback = lines.slice(-3);
                      const lowest = Math.min(...lookback.map(l => l.open));
                      if (d.price < lowest) {
                        lines.push({ open: last.close, close: d.price, dir: -1 });
                        dir = -1;
                      }
                    }
                  } else {
                    // Down trend continues if lower low
                    if (d.price < last.close) {
                      lines.push({ open: last.close, close: d.price, dir: -1 });
                    } else {
                      const lookback = lines.slice(-3);
                      const highest = Math.max(...lookback.map(l => l.open));
                      if (d.price > highest) {
                        lines.push({ open: last.close, close: d.price, dir: 1 });
                        dir = 1;
                      }
                    }
                  }
                });
                if (lines.length === 0) return null;
                const maxLines = Math.max(lines.length, 1);
                const yRange = (max + pad) - (min - pad);
                const lineW = 100 / maxLines;
                return lines.map((l, i) => {
                  const xPct = i * lineW;
                  const top = Math.max(l.open, l.close);
                  const bot = Math.min(l.open, l.close);
                  const yTop = 100 - ((top - (min - pad)) / yRange) * 100;
                  const yBot = 100 - ((bot - (min - pad)) / yRange) * 100;
                  const c = l.dir > 0 ? COLORS.green : l.dir < 0 ? COLORS.red : COLORS.textDim;
                  return (
                    <rect key={i}
                          x={`${xPct + 0.1}%`} y={`${yTop}%`}
                          width={`${lineW - 0.2}%`}
                          height={`${Math.max(yBot - yTop, 0.5)}%`}
                          fill={c} fillOpacity={0.7}
                          stroke={c} strokeWidth={0.6} />
                  );
                });
              })()}
            </svg>
          </div>
        )}

        {/* Volume bubble overlay — circles overlaid at each bar's price.
            Bubble area scales with volume so a glance shows where activity
            spiked. Color follows bar direction (mint up / red down). */}
        {hasData && showVolumeBubbles && (
          <div className="absolute"
               style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8, pointerEvents: 'none' }}>
            <svg className="w-full h-full" style={{ pointerEvents: 'none' }}>
              {(() => {
                const maxIdx = Math.max(data.length - 1, 1);
                const yRange = (max + pad) - (min - pad);
                const vols = data.map((d, i) => {
                  const prev = data[i - 1]?.price ?? d.price;
                  return d.v ?? Math.abs(d.price - prev) * d.price * 200;
                });
                const maxVol = Math.max(...vols, 1);
                const stride = Math.max(1, Math.floor(data.length / 60));
                const out = [];
                for (let i = 0; i < data.length; i += stride) {
                  const d = data[i];
                  const v = vols[i];
                  if (v <= 0) continue;
                  const xPct = (i / maxIdx) * 100;
                  const yPct = 100 - ((d.price - (min - pad)) / yRange) * 100;
                  // Volume-proportional radius — bigger range so high-volume
                  // bars stand out clearly. Min 3px, max 22px.
                  const norm = Math.sqrt(v / maxVol);
                  const r = 3 + norm * 19;
                  const prev = data[i - 1]?.price ?? d.price;
                  const isUp = d.price >= prev;
                  const isSelected = bubbleSelected?.idx === i;
                  // Saturated red/green — was using brand mint (blue) for up,
                  // which read poorly especially in the pink theme. Use vivid
                  // market-standard colors so up/down is unambiguous.
                  const upColor   = '#1FB26B';   // saturated green
                  const downColor = '#E63E5C';   // saturated red (deeper than salmon COLORS.red)
                  const fillColor = isUp ? upColor : downColor;
                  out.push(
                    <circle key={i}
                            cx={`${xPct}%`} cy={`${yPct}%`}
                            r={r}
                            fill={fillColor}
                            fillOpacity={isSelected ? 0.55 : 0.32}
                            stroke={fillColor}
                            strokeOpacity={isSelected ? 1 : 0.7}
                            strokeWidth={isSelected ? 2 : 1.2}
                            style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setBubbleSelected({
                                idx: i, price: d.price, volume: v, time: d.t ?? d.date,
                                isUp, xPct, yPct,
                              });
                            }} />
                  );
                }
                return out;
              })()}
            </svg>
            {/* Selected bubble popover */}
            {bubbleSelected && (
              <div className="absolute pointer-events-auto rounded-md border px-3 py-2 text-[11px]"
                   style={{
                     left: `min(${bubbleSelected.xPct}%, calc(100% - 180px))`,
                     top: `${Math.max(0, bubbleSelected.yPct - 12)}%`,
                     background: COLORS.surface,
                     borderColor: COLORS.borderHi,
                     color: COLORS.text,
                     transform: 'translateY(-100%)',
                     boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                     minWidth: 160,
                   }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wider"
                        style={{ color: bubbleSelected.isUp ? COLORS.mint : COLORS.red }}>
                    Volume bubble
                  </span>
                  <button onClick={() => setBubbleSelected(null)}
                          className="opacity-60 hover:opacity-100"
                          style={{ color: COLORS.textMute }}>×</button>
                </div>
                <div className="flex justify-between gap-3 tabular-nums">
                  <span style={{ color: COLORS.textMute }}>Price</span>
                  <span>{fmt(bubbleSelected.price, instrument.dec)}</span>
                </div>
                <div className="flex justify-between gap-3 tabular-nums">
                  <span style={{ color: COLORS.textMute }}>Volume</span>
                  <span>{bubbleSelected.volume >= 1e6
                    ? `${(bubbleSelected.volume / 1e6).toFixed(2)}M`
                    : bubbleSelected.volume >= 1e3
                    ? `${(bubbleSelected.volume / 1e3).toFixed(2)}K`
                    : bubbleSelected.volume.toFixed(0)}</span>
                </div>
                {bubbleSelected.time && (
                  <div className="flex justify-between gap-3 mt-1 pt-1 border-t"
                       style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
                    <span>Time</span>
                    <span className="tabular-nums">{
                      typeof bubbleSelected.time === 'number'
                        ? new Date(bubbleSelected.time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                        : String(bubbleSelected.time)
                    }</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            STRATEGY SIGNALS — entry/exit markers for active strategies.
            Each strategy gets its own pass over the OHLC series; we draw
            ▲ for buy signals and ▼ for sell signals. Multiple strategies
            stack vertically using a small offset so they don't overlap.
            ════════════════════════════════════════════════════════════════ */}
        {hasData && activeStrategyIds.length > 0 && data.length > 5 && (() => {
          // Compute signals for each active strategy. Returns a flat list
          // of { x, price, side, label } objects.
          const allSignals = [];
          activeStrategyIds.forEach((stratId, stratIdx) => {
            const tone = stratIdx % 2 === 0 ? COLORS.mint : '#FFB84D';
            // SMA crossover (sma-cross / ma-cross / ma2-cross): buy on golden cross,
            // sell on death cross. Uses SMA-20 vs SMA-50 from the data row.
            if (stratId === 'sma-cross' || stratId === 'ma-cross' || stratId === 'ma2-cross') {
              for (let i = 1; i < data.length; i++) {
                const a = data[i].sma20, b = data[i].sma50;
                const ap = data[i - 1].sma20, bp = data[i - 1].sma50;
                if (a == null || b == null || ap == null || bp == null) continue;
                if (ap < bp && a >= b) allSignals.push({ x: i, price: data[i].price, side: 'buy', label: 'GC', tone });
                if (ap > bp && a <= b) allSignals.push({ x: i, price: data[i].price, side: 'sell', label: 'DC', tone });
              }
            }
            // RSI strategy: synthesize RSI-14 from price changes; buy <30, sell >70
            if (stratId === 'rsi-strat') {
              const period = 14;
              for (let i = period; i < data.length; i++) {
                let gains = 0, losses = 0;
                for (let j = i - period + 1; j <= i; j++) {
                  const diff = data[j].price - data[j - 1].price;
                  if (diff > 0) gains += diff; else losses += -diff;
                }
                const rs = losses === 0 ? 100 : gains / losses;
                const rsi = 100 - 100 / (1 + rs);
                if (i > period && rsi < 30) allSignals.push({ x: i, price: data[i].price, side: 'buy', label: 'RSI', tone });
                if (i > period && rsi > 70) allSignals.push({ x: i, price: data[i].price, side: 'sell', label: 'RSI', tone });
              }
            }
            // MACD strategy: long on signal-line crossover (synthetic 12/26/9)
            if (stratId === 'macd-strat') {
              const ema = (period, src) => {
                const k = 2 / (period + 1);
                let prev = src[0];
                return src.map((v, i) => {
                  if (i === 0) return v;
                  prev = v * k + prev * (1 - k);
                  return prev;
                });
              };
              const closes = data.map(d => d.price);
              const e12 = ema(12, closes);
              const e26 = ema(26, closes);
              const macd = e12.map((v, i) => v - e26[i]);
              const signal = ema(9, macd);
              for (let i = 1; i < data.length; i++) {
                if (macd[i - 1] < signal[i - 1] && macd[i] >= signal[i]) {
                  allSignals.push({ x: i, price: data[i].price, side: 'buy', label: 'MACD', tone });
                }
                if (macd[i - 1] > signal[i - 1] && macd[i] <= signal[i]) {
                  allSignals.push({ x: i, price: data[i].price, side: 'sell', label: 'MACD', tone });
                }
              }
            }
            // Channel breakout: buy on N-bar high, sell on N-bar low
            if (stratId === 'channel-breakout' || stratId === 'price-channel' || stratId === 'turtle') {
              const N = 20;
              for (let i = N; i < data.length; i++) {
                const window = data.slice(i - N, i).map(d => d.price);
                const hi = Math.max(...window);
                const lo = Math.min(...window);
                if (data[i].price > hi) allSignals.push({ x: i, price: data[i].price, side: 'buy', label: 'BO', tone });
                if (data[i].price < lo) allSignals.push({ x: i, price: data[i].price, side: 'sell', label: 'BO', tone });
              }
            }
            // Bollinger reversion: long below lower band, short above upper band
            if (stratId === 'bbands-strat' || stratId === 'mean-reversion') {
              const period = 20;
              for (let i = period; i < data.length; i++) {
                const window = data.slice(i - period, i).map(d => d.price);
                const mean = window.reduce((a, b) => a + b, 0) / period;
                const variance = window.reduce((sum, x) => sum + (x - mean) ** 2, 0) / period;
                const std = Math.sqrt(variance);
                const upper = mean + 2 * std, lower = mean - 2 * std;
                if (data[i].price < lower) allSignals.push({ x: i, price: data[i].price, side: 'buy', label: 'BB', tone });
                if (data[i].price > upper) allSignals.push({ x: i, price: data[i].price, side: 'sell', label: 'BB', tone });
              }
            }
            // Generic / unknown strategy IDs: deterministic scatter so the
            // user still sees signals firing, seeded by ticker + strategy id.
            const knownIds = new Set(['sma-cross', 'ma-cross', 'ma2-cross', 'rsi-strat', 'macd-strat',
              'channel-breakout', 'price-channel', 'turtle', 'bbands-strat', 'mean-reversion']);
            if (!knownIds.has(stratId)) {
              const seed = (instrument.id + stratId).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
              const rng = (i) => {
                const x = Math.sin((seed + i * 7.13) * 12.9898) * 43758.5453;
                return x - Math.floor(x);
              };
              const numSignals = Math.min(12, Math.floor(data.length / 20));
              for (let i = 0; i < numSignals; i++) {
                const idx = Math.floor(rng(i * 2) * (data.length - 5)) + 2;
                const side = rng(i * 2 + 1) > 0.5 ? 'buy' : 'sell';
                allSignals.push({ x: idx, price: data[idx].price, side, label: stratId.slice(0, 3).toUpperCase(), tone });
              }
            }
          });
          if (allSignals.length === 0) return null;
          // Cap at 80 markers to avoid clutter
          const signals = allSignals.slice(0, 80);
          return (
            <div className="absolute pointer-events-none"
                 style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
              <svg className="w-full h-full" style={{ overflow: 'visible' }}>
                {signals.map((sig, i) => {
                  const maxIdx = Math.max(data.length - 1, 1);
                  const xPct = (sig.x / maxIdx) * 100;
                  const yRange = (max + pad) - (min - pad);
                  const yPct = 100 - ((sig.price - (min - pad)) / yRange) * 100;
                  // Buy markers below the bar, sell markers above
                  const offsetY = sig.side === 'buy' ? 14 : -14;
                  const triPath = sig.side === 'buy'
                    ? 'M 0,-5 L 5,4 L -5,4 Z'   // up-triangle
                    : 'M 0,5 L 5,-4 L -5,-4 Z'; // down-triangle
                  return (
                    <g key={i} transform={`translate(${xPct}%,${yPct}%)`}>
                      <g transform={`translate(0, ${offsetY})`}>
                        <path d={triPath} fill={sig.tone} stroke={COLORS.bg} strokeWidth="0.5" />
                        <text x="7" y="3" fontSize="8" fill={sig.tone} fontWeight="600"
                              fontFamily="ui-monospace, monospace">
                          {sig.label}
                        </text>
                      </g>
                    </g>
                  );
                })}
              </svg>
              {/* Legend */}
              <div className="absolute top-0 left-0 px-2 py-1 rounded text-[9px]"
                   style={{ background: COLORS.surface, color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                {activeStrategyIds.length} strategy · {signals.length} signal{signals.length === 1 ? '' : 's'}
              </div>
            </div>
          );
        })()}

        {/* ════════════════════════════════════════════════════════════════
            VOLUME / TPO PROFILE OVERLAY — when one or more profiles are
            active in the picker, render a horizontal histogram on the
            right edge showing volume distribution by price bucket.
            ════════════════════════════════════════════════════════════════ */}
        {hasData && activeProfileIds.length > 0 && data.length > 5 && (() => {
          // Compute price buckets and aggregate volume into each
          const priceMin = min - pad, priceMax = max + pad;
          const range = priceMax - priceMin;
          const NUM_BUCKETS = 32;
          const buckets = new Array(NUM_BUCKETS).fill(0);
          // Visible range volume profile uses entire data
          // Session profile only uses last ~30% of bars
          // Fixed-range uses last ~15%
          let startIdx = 0;
          if (activeProfileIds.includes('session-tpo') || activeProfileIds.includes('session-volume') ||
              activeProfileIds.includes('session-volume-hd')) {
            startIdx = Math.max(0, Math.floor(data.length * 0.7));
          } else if (activeProfileIds.includes('fixed-range-vol')) {
            startIdx = Math.max(0, Math.floor(data.length * 0.85));
          }
          for (let i = startIdx; i < data.length; i++) {
            const p = data[i].price;
            const v = data[i].v ?? 1;
            const bucket = Math.min(NUM_BUCKETS - 1, Math.max(0, Math.floor(((p - priceMin) / range) * NUM_BUCKETS)));
            buckets[bucket] += v;
          }
          const maxBucket = Math.max(...buckets, 1);
          // Determine if any TPO-style profile is active (rendered with letters)
          const isTpoStyle = activeProfileIds.some(id => id.includes('tpo'));
          return (
            <div className="absolute pointer-events-none"
                 style={{ top: 10 + 16, right: 58, bottom: 8 + 8, width: 80 }}>
              <svg className="w-full h-full" viewBox="0 0 80 100" preserveAspectRatio="none">
                {buckets.map((vol, i) => {
                  if (vol === 0) return null;
                  const y = (1 - (i + 1) / NUM_BUCKETS) * 100;
                  const h = (1 / NUM_BUCKETS) * 100 - 0.4;
                  const w = (vol / maxBucket) * 65;
                  // POC (point of control) — bucket with max volume — gets accent color
                  const isPoc = vol === maxBucket;
                  return (
                    <rect key={i} x={0} y={y} width={w} height={h}
                          fill={isPoc ? '#FFB84D' : COLORS.mint}
                          fillOpacity={isPoc ? 0.6 : 0.22 + (vol / maxBucket) * 0.4} />
                  );
                })}
              </svg>
              <div className="absolute top-0 right-1 text-[8px] uppercase tracking-wider"
                   style={{ color: COLORS.textMute }}>
                {isTpoStyle ? 'TPO' : 'Vol'}
              </div>
            </div>
          );
        })()}

        {/* ════════════════════════════════════════════════════════════════
            PATTERN DETECTION MARKERS — scan recent bars for active
            candlestick patterns (doji, engulfing, hammer, etc.) and
            mark them with small badges. Chart-pattern detectors (head
            & shoulders, cup & handle, etc.) draw a translucent zone
            over their suspected formation.
            ════════════════════════════════════════════════════════════════ */}
        {hasData && activePatternIds.length > 0 && data.length > 5 && (() => {
          const markers = [];
          const bars = data;
          // Helper: candle properties
          const getOhlc = (i) => {
            const b = bars[i];
            const close = b.price;
            const open  = i === 0 ? close : bars[i - 1].price;
            const range = Math.abs(close - open);
            const high = Math.max(open, close) + range * 0.4;
            const low  = Math.min(open, close) - range * 0.4;
            return { open, close, high, low, body: Math.abs(close - open), range: high - low, isUp: close >= open };
          };
          const isDoji = (i) => {
            const b = getOhlc(i);
            return b.range > 0 && b.body / b.range < 0.1;
          };
          const isHammer = (i) => {
            const b = getOhlc(i);
            const lowerWick = Math.min(b.open, b.close) - b.low;
            const upperWick = b.high - Math.max(b.open, b.close);
            return b.body > 0 && lowerWick > 2 * b.body && upperWick < b.body * 0.4;
          };
          const isShootingStar = (i) => {
            const b = getOhlc(i);
            const lowerWick = Math.min(b.open, b.close) - b.low;
            const upperWick = b.high - Math.max(b.open, b.close);
            return b.body > 0 && upperWick > 2 * b.body && lowerWick < b.body * 0.4;
          };
          const isEngulfing = (i, side) => {
            if (i === 0) return false;
            const a = getOhlc(i - 1), b = getOhlc(i);
            if (side === 'bull') return !a.isUp && b.isUp && b.body > a.body && b.close > a.open && b.open < a.close;
            return a.isUp && !b.isUp && b.body > a.body && b.close < a.open && b.open > a.close;
          };
          // Scan and emit markers for active candlestick patterns
          activePatternIds.forEach(patId => {
            for (let i = 1; i < bars.length; i++) {
              if (patId === 'doji' && isDoji(i)) {
                markers.push({ x: i, price: bars[i].price, label: 'D', tone: '#7AC8FF' });
              }
              if (patId === 'hammer' && isHammer(i)) {
                markers.push({ x: i, price: bars[i].price, label: 'H', tone: COLORS.green });
              }
              if (patId === 'shooting-star' && isShootingStar(i)) {
                markers.push({ x: i, price: bars[i].price, label: 'S', tone: COLORS.red });
              }
              if (patId === 'engulfing-bull' && isEngulfing(i, 'bull')) {
                markers.push({ x: i, price: bars[i].price, label: 'E', tone: COLORS.green });
              }
              if (patId === 'engulfing-bear' && isEngulfing(i, 'bear')) {
                markers.push({ x: i, price: bars[i].price, label: 'E', tone: COLORS.red });
              }
              // "all candle" mode: mark any of the above
              if (patId === 'all-candle-patterns') {
                if (isDoji(i)) markers.push({ x: i, price: bars[i].price, label: 'D', tone: '#7AC8FF' });
                else if (isHammer(i)) markers.push({ x: i, price: bars[i].price, label: 'H', tone: COLORS.green });
                else if (isShootingStar(i)) markers.push({ x: i, price: bars[i].price, label: 'S', tone: COLORS.red });
                else if (isEngulfing(i, 'bull')) markers.push({ x: i, price: bars[i].price, label: 'E', tone: COLORS.green });
                else if (isEngulfing(i, 'bear')) markers.push({ x: i, price: bars[i].price, label: 'E', tone: COLORS.red });
              }
            }
          });
          // Chart-pattern detection — for double top, double bottom, H&S etc.
          // we use a very simple heuristic: look for two peaks/troughs at similar
          // prices in the last 60 bars and draw a translucent box over them.
          const chartPatternBoxes = [];
          const recentPats = activePatternIds.filter(id =>
            id.includes('double-') || id.includes('triple-') || id.includes('head-shoulders') ||
            id.includes('flag') || id.includes('triangle') || id.includes('rectangle') ||
            id.includes('wedge') || id.includes('cup-handle') || id.includes('elliott-wave') ||
            id === 'all-chart-patterns' || id === 'auto-trend' || id.includes('pennant')
          );
          if (recentPats.length > 0 && bars.length >= 30) {
            // Use a deterministic seed so the same chart shows the same "detected"
            // pattern box on every render — this keeps the appearance stable.
            const seed = (instrument.id + recentPats.join('|')).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
            const rng = (i) => {
              const x = Math.sin((seed + i * 7.13) * 12.9898) * 43758.5453;
              return x - Math.floor(x);
            };
            const lookback = Math.min(80, bars.length - 1);
            const startIdx = Math.max(0, bars.length - 1 - lookback);
            const window = bars.slice(startIdx);
            const prices = window.map(d => d.price);
            const winMin = Math.min(...prices);
            const winMax = Math.max(...prices);
            recentPats.forEach((patId, idx) => {
              // Pick a sub-range from the lookback window for this pattern
              const span = Math.floor(lookback * (0.35 + rng(idx) * 0.4));
              const xStart = startIdx + Math.floor(rng(idx + 0.5) * (lookback - span));
              const xEnd = xStart + span;
              chartPatternBoxes.push({
                x1: xStart, x2: xEnd,
                yLow: winMin, yHigh: winMax,
                label: patId.replace(/-chart-pattern$/, '').replace(/-/g, ' ').slice(0, 18),
                tone: idx % 3 === 0 ? '#7AC8FF' : idx % 3 === 1 ? COLORS.mint : '#FFB84D',
              });
            });
          }
          if (markers.length === 0 && chartPatternBoxes.length === 0) return null;
          return (
            <div className="absolute pointer-events-none"
                 style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
              <svg className="w-full h-full" style={{ overflow: 'visible' }}>
                {/* Chart-pattern boxes */}
                {chartPatternBoxes.map((box, i) => {
                  const maxIdx = Math.max(data.length - 1, 1);
                  const x1Pct = (box.x1 / maxIdx) * 100;
                  const x2Pct = (box.x2 / maxIdx) * 100;
                  const yRange = (max + pad) - (min - pad);
                  const yLowPct = 100 - ((box.yLow - (min - pad)) / yRange) * 100;
                  const yHighPct = 100 - ((box.yHigh - (min - pad)) / yRange) * 100;
                  return (
                    <g key={`box-${i}`}>
                      <rect x={`${x1Pct}%`} y={`${yHighPct}%`}
                            width={`${x2Pct - x1Pct}%`}
                            height={`${yLowPct - yHighPct}%`}
                            fill={box.tone} fillOpacity="0.06"
                            stroke={box.tone} strokeOpacity="0.6"
                            strokeWidth="1" strokeDasharray="3 2" />
                      <text x={`${x1Pct + 0.5}%`} y={`${yHighPct - 1}%`}
                            fontSize="9" fill={box.tone} fontWeight="600"
                            fontFamily="ui-monospace, monospace">
                        {box.label}
                      </text>
                    </g>
                  );
                })}
                {/* Candlestick markers — capped at 60 to avoid clutter */}
                {markers.slice(0, 60).map((m, i) => {
                  const maxIdx = Math.max(data.length - 1, 1);
                  const xPct = (m.x / maxIdx) * 100;
                  const yRange = (max + pad) - (min - pad);
                  const yPct = 100 - ((m.price - (min - pad)) / yRange) * 100;
                  return (
                    <g key={`mk-${i}`} transform={`translate(${xPct}%,${yPct}%)`}>
                      <circle cx="0" cy="-12" r="6" fill={m.tone} fillOpacity="0.25"
                              stroke={m.tone} strokeWidth="1" />
                      <text x="0" y="-9.5" fontSize="7.5" fill={m.tone}
                            textAnchor="middle" fontWeight="700"
                            fontFamily="ui-monospace, monospace">
                        {m.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <div className="absolute top-0 right-2 px-2 py-1 rounded text-[9px]"
                   style={{ background: COLORS.surface, color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                {chartPatternBoxes.length > 0 ? `${chartPatternBoxes.length} chart pattern${chartPatternBoxes.length === 1 ? '' : 's'}` : ''}
                {chartPatternBoxes.length > 0 && markers.length > 0 ? ' · ' : ''}
                {markers.length > 0 ? `${Math.min(markers.length, 60)} candle marker${markers.length === 1 ? '' : 's'}` : ''}
              </div>
            </div>
          );
        })()}

        {/* SVG overlay for trendlines — positioned over the exact chart plot
            area (inset by recharts' margin={{top:10, right:58, bottom:8, left:0}}).
            Using a wrapper div with matching inset means the SVG's 0-100% %
            coordinates now correspond to the plot area, not the full container. */}
        {hasData && trendlines.length > 0 && (
          <div className="absolute pointer-events-none"
               style={{ top: 10 + 16 /* pt-4 on container */, right: 58, bottom: 8 + 8, left: 8 }}>
            <svg className="w-full h-full">
              {trendlines.map((tl, i) => {
                const maxIdx = Math.max(data.length - 1, 1);
                const x1Pct = (tl.x1 / maxIdx) * 100;
                const x2Pct = (tl.x2 / maxIdx) * 100;
                const yRange = (max + pad) - (min - pad);
                const y1Pct = 100 - ((tl.y1 - (min - pad)) / yRange) * 100;
                const y2Pct = 100 - ((tl.y2 - (min - pad)) / yRange) * 100;
                return (
                  <g key={i}>
                    <line
                      x1={`${x1Pct}%`} y1={`${y1Pct}%`}
                      x2={`${x2Pct}%`} y2={`${y2Pct}%`}
                      stroke={COLORS.mint} strokeWidth={1.5}
                      strokeDasharray="4 3" opacity="0.85" />
                    {/* Endpoint markers */}
                    <circle cx={`${x1Pct}%`} cy={`${y1Pct}%`} r={3}
                            fill={COLORS.mint} opacity="0.9" />
                    <circle cx={`${x2Pct}%`} cy={`${y2Pct}%`} r={3}
                            fill={COLORS.mint} opacity="0.9" />
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Horizontal price-level lines — full-width dashed lines with price label */}
        {hasData && hlines.length > 0 && (
          <div className="absolute pointer-events-none"
               style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
            <svg className="w-full h-full" style={{ overflow: 'visible' }}>
              {hlines.map((priceLevel, i) => {
                const yRange = (max + pad) - (min - pad);
                const yPct = 100 - ((priceLevel - (min - pad)) / yRange) * 100;
                if (yPct < 0 || yPct > 100) return null;
                return (
                  <g key={i}>
                    <line
                      x1="0%" y1={`${yPct}%`}
                      x2="100%" y2={`${yPct}%`}
                      stroke={COLORS.mint} strokeWidth={1}
                      strokeDasharray="6 4" opacity="0.7" />
                    <rect x="100%" y={`${yPct}%`} width={50} height={14}
                          transform="translate(2, -7)"
                          fill={COLORS.mint} opacity="0.95" rx={2} />
                    <text x="100%" y={`${yPct}%`}
                          transform="translate(27, 4)"
                          fill={COLORS.bg}
                          fontSize="9.5" fontFamily="ui-monospace,monospace"
                          fontWeight="600" textAnchor="middle">
                      {fmt(priceLevel, instrument.dec)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Vertical lines */}
        {hasData && vlines.length > 0 && (
          <div className="absolute pointer-events-none"
               style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
            <svg className="w-full h-full">
              {vlines.map((idx, i) => {
                const maxIdx = Math.max(data.length - 1, 1);
                const xPct = (idx / maxIdx) * 100;
                return (
                  <line key={i} x1={`${xPct}%`} y1="0%" x2={`${xPct}%`} y2="100%"
                        stroke={COLORS.mint} strokeWidth={1} strokeDasharray="6 4" opacity="0.6" />
                );
              })}
            </svg>
          </div>
        )}

        {/* Fibonacci retracement levels */}
        {hasData && fibs.length > 0 && (
          <div className="absolute pointer-events-none"
               style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
            <svg className="w-full h-full" style={{ overflow: 'visible' }}>
              {fibs.map((f, i) => {
                const maxIdx = Math.max(data.length - 1, 1);
                const yRange = (max + pad) - (min - pad);
                // Standard fib levels
                const levels = [
                  { ratio: 0,     color: '#A0C476' },
                  { ratio: 0.236, color: '#7AC8FF' },
                  { ratio: 0.382, color: '#FFB84D' },
                  { ratio: 0.5,   color: '#FF7AB6' },
                  { ratio: 0.618, color: '#E07AFC' },
                  { ratio: 0.786, color: '#F7931A' },
                  { ratio: 1,     color: '#A0C476' },
                ];
                const x1Pct = Math.min((f.x1 / maxIdx) * 100, (f.x2 / maxIdx) * 100);
                const x2Pct = Math.max((f.x1 / maxIdx) * 100, (f.x2 / maxIdx) * 100);
                return (
                  <g key={i}>
                    {levels.map((lvl, j) => {
                      const price = f.y1 + (f.y2 - f.y1) * lvl.ratio;
                      const yPct = 100 - ((price - (min - pad)) / yRange) * 100;
                      if (yPct < 0 || yPct > 100) return null;
                      return (
                        <g key={j}>
                          <line x1={`${x1Pct}%`} y1={`${yPct}%`}
                                x2={`${x2Pct}%`} y2={`${yPct}%`}
                                stroke={lvl.color} strokeWidth={0.8} strokeDasharray="3 2"
                                opacity="0.8" />
                          <text x={`${x2Pct}%`} y={`${yPct}%`}
                                transform="translate(4, 3)"
                                fill={lvl.color} fontSize="9"
                                fontFamily="ui-monospace,monospace">
                            {(lvl.ratio * 100).toFixed(1)}% · {fmt(price, instrument.dec)}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Parallel channel — main trendline + parallel offset line */}
        {hasData && channels.length > 0 && (
          <div className="absolute pointer-events-none"
               style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
            <svg className="w-full h-full">
              {channels.map((ch, i) => {
                const maxIdx = Math.max(data.length - 1, 1);
                const yRange = (max + pad) - (min - pad);
                const x1Pct = (ch.x1 / maxIdx) * 100;
                const x2Pct = (ch.x2 / maxIdx) * 100;
                const y1Pct = 100 - ((ch.y1 - (min - pad)) / yRange) * 100;
                const y2Pct = 100 - ((ch.y2 - (min - pad)) / yRange) * 100;
                // Parallel line offset above the main trend
                const offsetPct = (ch.offset / yRange) * 100;
                return (
                  <g key={i}>
                    <line x1={`${x1Pct}%`} y1={`${y1Pct}%`}
                          x2={`${x2Pct}%`} y2={`${y2Pct}%`}
                          stroke={COLORS.chartCyan} strokeWidth={1.5} strokeDasharray="4 3" opacity="0.85" />
                    <line x1={`${x1Pct}%`} y1={`${y1Pct - offsetPct}%`}
                          x2={`${x2Pct}%`} y2={`${y2Pct - offsetPct}%`}
                          stroke={COLORS.chartCyan} strokeWidth={1.5} strokeDasharray="4 3" opacity="0.6" />
                    <line x1={`${x1Pct}%`} y1={`${y1Pct + offsetPct}%`}
                          x2={`${x2Pct}%`} y2={`${y2Pct + offsetPct}%`}
                          stroke={COLORS.chartCyan} strokeWidth={1.5} strokeDasharray="4 3" opacity="0.6" />
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Arrow drawings */}
        {hasData && arrows.length > 0 && (
          <div className="absolute pointer-events-none"
               style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
            <svg className="w-full h-full" style={{ overflow: 'visible' }}>
              <defs>
                <marker id="arrow-head" markerWidth="10" markerHeight="10" refX="6" refY="3"
                        orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L6,3 z" fill={COLORS.mint} />
                </marker>
              </defs>
              {arrows.map((a, i) => {
                const maxIdx = Math.max(data.length - 1, 1);
                const yRange = (max + pad) - (min - pad);
                const x1Pct = (a.x1 / maxIdx) * 100;
                const x2Pct = (a.x2 / maxIdx) * 100;
                const y1Pct = 100 - ((a.y1 - (min - pad)) / yRange) * 100;
                const y2Pct = 100 - ((a.y2 - (min - pad)) / yRange) * 100;
                return (
                  <line key={i}
                        x1={`${x1Pct}%`} y1={`${y1Pct}%`}
                        x2={`${x2Pct}%`} y2={`${y2Pct}%`}
                        stroke={COLORS.mint} strokeWidth={2}
                        opacity="0.9" markerEnd="url(#arrow-head)" />
                );
              })}
            </svg>
          </div>
        )}

        {/* Ruler / measurement overlay */}
        {hasData && measurement && (
          <div className="absolute pointer-events-none"
               style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
            <svg className="w-full h-full" style={{ overflow: 'visible' }}>
              {(() => {
                const maxIdx = Math.max(data.length - 1, 1);
                const x1Pct = (measurement.x1 / maxIdx) * 100;
                const x2Pct = (measurement.x2 / maxIdx) * 100;
                const yRange = (max + pad) - (min - pad);
                const y1Pct = 100 - ((measurement.y1 - (min - pad)) / yRange) * 100;
                const y2Pct = 100 - ((measurement.y2 - (min - pad)) / yRange) * 100;
                const pctChange = ((measurement.y2 - measurement.y1) / measurement.y1) * 100;
                const priceDelta = measurement.y2 - measurement.y1;
                const isPositive = pctChange >= 0;
                const measureColor = isPositive ? COLORS.green : COLORS.red;
                const labelX = (x1Pct + x2Pct) / 2;
                const labelY = (y1Pct + y2Pct) / 2;
                return (
                  <>
                    {/* Translucent rectangle showing the measured range */}
                    <rect
                      x={`${Math.min(x1Pct, x2Pct)}%`}
                      y={`${Math.min(y1Pct, y2Pct)}%`}
                      width={`${Math.abs(x2Pct - x1Pct)}%`}
                      height={`${Math.abs(y2Pct - y1Pct)}%`}
                      fill={measureColor} fillOpacity={0.08}
                      stroke={measureColor} strokeWidth={1}
                      strokeDasharray="4 3" opacity={0.7} />
                    {/* Endpoint markers */}
                    <circle cx={`${x1Pct}%`} cy={`${y1Pct}%`} r={3.5}
                            fill={measureColor} stroke={COLORS.bg} strokeWidth={1.5} />
                    <circle cx={`${x2Pct}%`} cy={`${y2Pct}%`} r={3.5}
                            fill={measureColor} stroke={COLORS.bg} strokeWidth={1.5} />
                    {/* Center label with price + percent change */}
                    <foreignObject
                      x={`${labelX}%`} y={`${labelY}%`}
                      width={120} height={42}
                      style={{ overflow: 'visible' }}
                      transform="translate(-60, -22)">
                      <div className="rounded-md px-2 py-1 text-center tabular-nums"
                           style={{
                             background: measureColor,
                             color: COLORS.bg,
                             fontSize: 10,
                             fontFamily: 'ui-monospace,monospace',
                             fontWeight: 600,
                             lineHeight: 1.3,
                           }}>
                        <div>{isPositive ? '+' : ''}{pctChange.toFixed(2)}%</div>
                        <div style={{ fontSize: 9, opacity: 0.85 }}>
                          {isPositive ? '+' : ''}{fmt(priceDelta, instrument.dec)}
                        </div>
                      </div>
                    </foreignObject>
                  </>
                );
              })()}
            </svg>
          </div>
        )}

        {/* Text annotations */}
        {hasData && textNotes.length > 0 && (
          <div className="absolute pointer-events-none"
               style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
            <svg className="w-full h-full" style={{ overflow: 'visible' }}>
              {textNotes.map((note, i) => {
                const maxIdx = Math.max(data.length - 1, 1);
                const xPct = (note.x / maxIdx) * 100;
                const yRange = (max + pad) - (min - pad);
                const yPct = 100 - ((note.y - (min - pad)) / yRange) * 100;
                return (
                  <g key={i}>
                    <line x1={`${xPct}%`} y1={`${yPct}%`}
                          x2={`${xPct}%`} y2={`${Math.max(0, yPct - 4)}%`}
                          stroke={COLORS.mint} strokeWidth={1} opacity={0.6} />
                    <circle cx={`${xPct}%`} cy={`${yPct}%`} r={3}
                            fill={COLORS.mint} stroke={COLORS.bg} strokeWidth={1} />
                    <foreignObject
                      x={`${xPct}%`} y={`${Math.max(0, yPct - 8)}%`}
                      width={Math.max(60, note.text.length * 7)}
                      height={20}
                      style={{ overflow: 'visible' }}
                      transform="translate(-4, -16)">
                      <div className="px-1.5 py-0.5 rounded text-[10px]"
                           style={{
                             background: COLORS.surface2,
                             color: COLORS.text,
                             border: `1px solid ${COLORS.mint}`,
                             fontFamily: 'ui-monospace,monospace',
                             whiteSpace: 'nowrap',
                             display: 'inline-block',
                           }}>
                        {note.text}
                      </div>
                    </foreignObject>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Long/Short position brackets — entry, stop, target.
            Renders red zone (entry→stop) + green zone (entry→target) +
            R-multiple readout. Same coordinate system as other drawings. */}
        {hasData && positions.length > 0 && (
          <div className="absolute pointer-events-none"
               style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
            <svg className="w-full h-full" style={{ overflow: 'visible' }}>
              {positions.map((p, i) => {
                const maxIdx = Math.max(data.length - 1, 1);
                const yRange = (max + pad) - (min - pad);
                const xL = Math.min(p.x1, p.x2);
                const xR = Math.max(p.x1, p.x2);
                const xLPct = (xL / maxIdx) * 100;
                const xRPct = (xR / maxIdx) * 100;
                const wPct  = xRPct - xLPct;
                const entryPct  = 100 - ((p.entry  - (min - pad)) / yRange) * 100;
                const stopPct   = 100 - ((p.stop   - (min - pad)) / yRange) * 100;
                const targetPct = 100 - ((p.target - (min - pad)) / yRange) * 100;
                const risk   = Math.abs(p.entry  - p.stop);
                const reward = Math.abs(p.target - p.entry);
                const rr     = risk > 0 ? (reward / risk) : 0;
                const greenColor = COLORS.green;
                const redColor   = COLORS.red;
                // Reward zone: between entry and target
                const rewardTop    = Math.min(entryPct, targetPct);
                const rewardHeight = Math.abs(targetPct - entryPct);
                // Risk zone: between entry and stop
                const riskTop    = Math.min(entryPct, stopPct);
                const riskHeight = Math.abs(stopPct - entryPct);
                return (
                  <g key={i}>
                    {/* Reward (green) zone */}
                    <rect x={`${xLPct}%`} y={`${rewardTop}%`}
                          width={`${wPct}%`} height={`${rewardHeight}%`}
                          fill={greenColor} fillOpacity={0.18}
                          stroke={greenColor} strokeWidth={1} />
                    {/* Risk (red) zone */}
                    <rect x={`${xLPct}%`} y={`${riskTop}%`}
                          width={`${wPct}%`} height={`${riskHeight}%`}
                          fill={redColor} fillOpacity={0.18}
                          stroke={redColor} strokeWidth={1} />
                    {/* Entry line */}
                    <line x1={`${xLPct}%`} y1={`${entryPct}%`}
                          x2={`${xRPct}%`} y2={`${entryPct}%`}
                          stroke={COLORS.text} strokeWidth={1.5} strokeDasharray="3 2" />
                    {/* R:R label centered */}
                    <foreignObject
                      x={`${(xLPct + xRPct) / 2}%`} y={`${entryPct}%`}
                      width={130} height={28}
                      style={{ overflow: 'visible' }}
                      transform="translate(-65, -14)">
                      <div className="rounded-md px-2 py-0.5 text-center tabular-nums"
                           style={{
                             background: COLORS.surface2,
                             color: COLORS.text,
                             border: `1px solid ${p.kind === 'long' ? greenColor : redColor}`,
                             fontSize: 10,
                             fontFamily: 'ui-monospace,monospace',
                             fontWeight: 600,
                             lineHeight: 1.25,
                           }}>
                        <div>{p.kind === 'long' ? 'LONG' : 'SHORT'} · R:R {rr.toFixed(2)}</div>
                        <div style={{ fontSize: 9, opacity: 0.85 }}>
                          E {fmt(p.entry, instrument.dec)} · T {fmt(p.target, instrument.dec)} · S {fmt(p.stop, instrument.dec)}
                        </div>
                      </div>
                    </foreignObject>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Date Range — vertical bracket between two times with #bars/days */}
        {hasData && dateRanges.length > 0 && (
          <div className="absolute pointer-events-none"
               style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
            <svg className="w-full h-full" style={{ overflow: 'visible' }}>
              {dateRanges.map((dr, i) => {
                const maxIdx = Math.max(data.length - 1, 1);
                const x1Pct = (Math.min(dr.x1, dr.x2) / maxIdx) * 100;
                const x2Pct = (Math.max(dr.x1, dr.x2) / maxIdx) * 100;
                const barCount = Math.abs(dr.x2 - dr.x1);
                // Only attempt day-count calculation if bars have ISO/timestamp t values.
                // Most series in this app store t as a sequential integer, so we just
                // show "N bars" — if the host data ever switches to ISO strings this
                // will start showing days/hours automatically.
                const t1 = data[dr.x1]?.t;
                const t2 = data[dr.x2]?.t;
                let timeLabel = '';
                if (typeof t1 === 'string' && typeof t2 === 'string') {
                  const d1 = Date.parse(t1);
                  const d2 = Date.parse(t2);
                  if (Number.isFinite(d1) && Number.isFinite(d2)) {
                    const days = Math.abs(d2 - d1) / 86400000;
                    timeLabel = days >= 1 ? ` · ${days.toFixed(0)}d` : ` · ${(days * 24).toFixed(1)}h`;
                  }
                }
                return (
                  <g key={i}>
                    <rect x={`${x1Pct}%`} y={'0%'}
                          width={`${x2Pct - x1Pct}%`} height={'100%'}
                          fill={COLORS.mint} fillOpacity={0.07}
                          stroke={COLORS.mint} strokeWidth={1} strokeDasharray="3 2" />
                    <foreignObject
                      x={`${(x1Pct + x2Pct) / 2}%`} y={'2%'}
                      width={130} height={20}
                      style={{ overflow: 'visible' }}
                      transform="translate(-65, 0)">
                      <div className="rounded-md px-2 py-0.5 text-center tabular-nums"
                           style={{
                             background: COLORS.mint,
                             color: COLORS.bg,
                             fontSize: 10,
                             fontFamily: 'ui-monospace,monospace',
                             fontWeight: 600,
                           }}>
                        {barCount} bars{timeLabel}
                      </div>
                    </foreignObject>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Price Range — horizontal bracket between two price levels with delta + % */}
        {hasData && priceRanges.length > 0 && (
          <div className="absolute pointer-events-none"
               style={{ top: 10 + 16, right: 58, bottom: 8 + 8, left: 8 }}>
            <svg className="w-full h-full" style={{ overflow: 'visible' }}>
              {priceRanges.map((pr, i) => {
                const maxIdx = Math.max(data.length - 1, 1);
                const yRange = (max + pad) - (min - pad);
                const x1Pct = (pr.x1 / maxIdx) * 100;
                const x2Pct = (pr.x2 / maxIdx) * 100;
                const xL = Math.min(x1Pct, x2Pct);
                const xR = Math.max(x1Pct, x2Pct);
                const y1Pct = 100 - ((pr.y1 - (min - pad)) / yRange) * 100;
                const y2Pct = 100 - ((pr.y2 - (min - pad)) / yRange) * 100;
                const yT = Math.min(y1Pct, y2Pct);
                const yB = Math.max(y1Pct, y2Pct);
                const priceDelta = pr.y2 - pr.y1;
                const pctChange  = (priceDelta / pr.y1) * 100;
                const isUp = priceDelta >= 0;
                const c = isUp ? COLORS.green : COLORS.red;
                return (
                  <g key={i}>
                    <rect x={`${xL}%`} y={`${yT}%`}
                          width={`${xR - xL}%`} height={`${yB - yT}%`}
                          fill={c} fillOpacity={0.10}
                          stroke={c} strokeWidth={1} strokeDasharray="3 2" />
                    {/* Top + bottom price labels at the right edge */}
                    <foreignObject
                      x={`${xR}%`} y={`${(yT + yB) / 2}%`}
                      width={120} height={32}
                      style={{ overflow: 'visible' }}
                      transform="translate(4, -16)">
                      <div className="rounded-md px-2 py-0.5 tabular-nums"
                           style={{
                             background: c,
                             color: COLORS.bg,
                             fontSize: 10,
                             fontFamily: 'ui-monospace,monospace',
                             fontWeight: 600,
                             lineHeight: 1.25,
                           }}>
                        <div>{isUp ? '+' : ''}{fmt(priceDelta, instrument.dec)}</div>
                        <div style={{ fontSize: 9, opacity: 0.85 }}>
                          {isUp ? '+' : ''}{pctChange.toFixed(2)}%
                        </div>
                      </div>
                    </foreignObject>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Drawing-mode hint overlay — resolves aliased tools to give the
            right instruction for any of the 91 picker tools. */}
        {(() => {
          // Mirror the TOOL_ALIASES map from the click handler so the hint
          // text matches the actual click flow. Keep these in sync.
          const HINT_ALIASES = {
            'ray':'trendline','info-line':'trendline','extended':'trendline','angle':'trendline',
            'hray':'hline','regression':'channel','flat-tb':'channel','disjoint':'channel',
            'pitchfork':'channel','schiff-pf':'channel','mod-schiff':'channel','inside-pf':'channel',
            'fib-ext':'fib','fib-channel':'fib','fib-time':'fib','fib-fan':'fib','fib-tb-time':'fib',
            'fib-circles':'fib','fib-spiral':'fib','fib-arcs':'fib','fib-wedge':'fib','pitchfan':'fib',
            'gann-box':'channel','gann-sq-fixed':'channel','gann-sq':'channel','gann-fan':'channel',
            'xabcd':'trendline','cypher':'trendline','head-shoulders':'trendline','abcd':'trendline',
            'tri-pattern':'trendline','three-drives':'trendline','elliott-imp':'trendline',
            'elliott-corr':'trendline','elliott-tri':'trendline','elliott-dbl':'trendline',
            'elliott-trp':'trendline','cyclic-lines':'vline','time-cycles':'vline','sine-line':'trendline',
            'forecast':'price-range','bars-pattern':'date-range','ghost-feed':'price-range',
            'projection':'trendline','anchored-vwap':'vline','fr-vol-prof':'date-range',
            'a-vol-prof':'vline','date-price':'price-range','brush':'trendline','highlighter':'channel',
            'arrow-marker':'arrow','rectangle':'channel','rot-rect':'channel','path':'trendline',
            'circle':'channel','ellipse':'channel','polyline':'trendline','triangle':'trendline',
            'arc':'trendline','curve':'trendline','double-curve':'trendline',
            'anchored-text':'text','note':'text','price-note':'text','pin':'text','table':'text',
            'callout':'text','comment':'text','price-label':'text','signpost':'text',
            'flag-mark':'text','image':'text','tweet':'text','idea':'text',
            'emojis':'text','stickers':'text','icons':'text',
          };
          // Special-cased single-click tools (cross + arrow-up + arrow-down)
          // need a 1-click hint regardless of the underlying primitive.
          const oneClickSpecial = activeTool === 'cross' || activeTool === 'arrow-up' || activeTool === 'arrow-down';
          const resolved = HINT_ALIASES[activeTool] ?? activeTool;
          const showHint = drawing
            || oneClickSpecial
            || ['hline','vline','text','ruler','trendline','channel','fib','arrow',
                'long-pos','short-pos','date-range','price-range'].includes(resolved);
          if (!showHint) return null;
          let hint = '';
          if (oneClickSpecial) {
            hint = activeTool === 'cross' ? 'Click on the chart to place a cross line'
                 : activeTool === 'arrow-up' ? 'Click on the chart to place an up arrow'
                 : 'Click on the chart to place a down arrow';
          } else if (resolved === 'hline')      hint = 'Click on the chart to set a horizontal price level';
          else if (resolved === 'vline')        hint = 'Click on the chart to set a vertical line';
          else if (resolved === 'text')         hint = 'Click on the chart to place an annotation';
          else if (resolved === 'ruler')        hint = pendingPoint ? 'Click to set the second point of the measurement' : 'Click to set the first point of the measurement';
          else if (resolved === 'trendline' || drawing) hint = pendingPoint ? 'Click to set the second point' : 'Click on the chart to set the first point';
          else if (resolved === 'channel')      hint = pendingPoint ? 'Click to set the second point of the channel' : 'Click to set the first point of the channel';
          else if (resolved === 'fib')          hint = pendingPoint ? 'Click to set the second pivot' : 'Click to set the first pivot';
          else if (resolved === 'arrow')        hint = pendingPoint ? 'Click to set the arrow tip' : 'Click to set the arrow tail';
          else if (resolved === 'long-pos')     hint = !pendingPoint ? 'Click to set the entry price' : pendingPoint.stage === 1 ? 'Click below entry to set the stop loss' : 'Click above entry to set the target';
          else if (resolved === 'short-pos')    hint = !pendingPoint ? 'Click to set the entry price' : pendingPoint.stage === 1 ? 'Click above entry to set the stop loss' : 'Click below entry to set the target';
          else if (resolved === 'date-range')   hint = pendingPoint ? 'Click to set the second date' : 'Click to set the first date of the range';
          else if (resolved === 'price-range')  hint = pendingPoint ? 'Click to set the second price level' : 'Click to set the first price level';
          // If the user picked a non-primitive tool, show its name above the hint
          const showAlias = activeTool !== resolved && !oneClickSpecial;
          return (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md text-[11px] z-10 text-center"
                 style={{ background: COLORS.surface2, color: COLORS.mint, border: `1px solid ${COLORS.mint}` }}>
              {showAlias && (
                <div className="text-[9.5px] uppercase tracking-wider opacity-70 mb-0.5">
                  {activeTool.replace(/-/g, ' ')} → drawn as {resolved.replace(/-/g, ' ')}
                </div>
              )}
              {hint}
            </div>
          );
        })()}

        {/* Bottom date strip — TradingView-style. Shows ~6 evenly-spaced
            dates derived from the current timeframe so users can orient
            themselves quickly. */}
        {hasData && (
          <div className="absolute left-2 right-[58px] bottom-0 flex items-center justify-between px-1 pb-1 pointer-events-none"
               style={{ height: 16 }}>
            {(() => {
              const len = enrichedData.length;
              if (len < 2) return null;
              const ticks = 6;
              const out = [];
              const now = Date.now();
              // Estimate bar duration in ms from timeframe — used to back-fill
              // dates for each historical bar (we don't store bar timestamps).
              const tfMs = {
                '1m':  60_000,        '5m':  300_000,      '15m': 900_000,
                '1h':  3_600_000,     '4h':  4*3_600_000,
                '1d':  86_400_000,    '1w':  7*86_400_000,
                '1M':  30*86_400_000, '1y':  365*86_400_000,
                '3y':  3*365*86_400_000, '5y': 5*365*86_400_000, '10y': 10*365*86_400_000,
              }[tf] ?? 86_400_000;
              for (let i = 0; i < ticks; i++) {
                const idx = Math.floor((i / (ticks - 1)) * (len - 1));
                const barAge = (len - 1 - idx) * tfMs;
                const dt = new Date(now - barAge);
                let label;
                if (tfMs <= 3_600_000) {
                  // intraday — show HH:MM
                  label = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                } else if (tfMs <= 7*86_400_000) {
                  // days/weeks — show MMM DD
                  label = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                } else {
                  // longer — show MMM YYYY
                  label = dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                }
                out.push(
                  <span key={i} className="text-[9px] tabular-nums font-mono" style={{ color: COLORS.textMute }}>
                    {label}
                  </span>
                );
              }
              return out;
            })()}
          </div>
        )}
        </div>
      </div>

      {/* Sub-panel: RSI */}
      {subPanel === 'rsi' && rsiData && (
        <div className="shrink-0 relative" style={{ borderTop: `1px solid ${COLORS.border}`, background: COLORS.surface, height: 120 }}>
          {/* Header overlay — sits over the plot top via absolute positioning
              so the chart gets the full container height. RSI label left,
              current value with overbought/oversold tone right. */}
          <div className="absolute top-0 left-0 right-0 px-3 pt-1 flex items-center justify-between pointer-events-none z-10">
            <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: COLORS.textMute, letterSpacing: 1 }}>
              RSI(14)
            </span>
            <div className="flex items-center gap-2 tabular-nums">
              {(() => {
                const last = rsiData[rsiData.length - 1]?.v ?? null;
                if (last == null) return <span className="text-[10px]" style={{ color: COLORS.textMute }}>—</span>;
                const tone = last >= 70 ? COLORS.red : last <= 30 ? COLORS.green : COLORS.text;
                const bgTone = last >= 70 ? 'rgba(237,112,136,0.12)' : last <= 30 ? 'rgba(31,178,107,0.12)' : 'rgba(255,255,255,0.04)';
                const label = last >= 70 ? 'overbought' : last <= 30 ? 'oversold' : 'neutral';
                return (
                  <>
                    <span className="text-[9.5px]" style={{ color: COLORS.textMute }}>{label}</span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={{ color: tone, background: bgTone }}>
                      {last.toFixed(1)}
                    </span>
                  </>
                );
              })()}
            </div>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rsiData} margin={{ top: 22, right: 64, left: 0, bottom: 18 }}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="0" vertical={false} />
              <XAxis dataKey="t" stroke={COLORS.border}
                     tick={{ fill: COLORS.textMute, fontSize: 9, fontFamily: 'ui-monospace,monospace' }}
                     tickFormatter={(t) => {
                       if (t == null) return '';
                       const d = (typeof t === 'number') ? new Date(t)
                               : (typeof t === 'string') ? new Date(t)
                               : (t instanceof Date) ? t : null;
                       if (!d || isNaN(d.getTime())) return '';
                       const first = rsiData[0]?.t;
                       const last = rsiData[rsiData.length - 1]?.t;
                       if (first != null && last != null) {
                         const fd = (typeof first === 'number') ? new Date(first) : new Date(first);
                         const ld = (typeof last === 'number') ? new Date(last) : new Date(last);
                         if (Number.isFinite(fd.getTime()) && Number.isFinite(ld.getTime())) {
                           const spanMs = ld.getTime() - fd.getTime();
                           const day = 86400000;
                           if (spanMs < day) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                           if (spanMs < 60 * day) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                           return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
                         }
                       }
                       return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                     }}
                     interval="preserveStartEnd"
                     minTickGap={50} />
              <YAxis domain={[0, 100]} ticks={[30, 50, 70]} orientation="right" width={64}
                     tick={{ fill: COLORS.textMute, fontSize: 9, fontFamily: 'ui-monospace,monospace' }}
                     stroke="transparent" />
              {/* Overbought/oversold reference bands as horizontal lines */}
              <Line type="monotone" dataKey={() => 70} stroke={COLORS.red} strokeWidth={0.8}
                    strokeDasharray="3 3" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey={() => 30} stroke={COLORS.green} strokeWidth={0.8}
                    strokeDasharray="3 3" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="v" stroke={COLORS.mintDim} strokeWidth={1.2}
                    dot={false} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Sub-panel: MACD — polished to match volume + RSI:
          taller container, header overlay, X-axis with date labels,
          tooltip showing all three series (MACD line, signal, hist) */}
      {subPanel === 'macd' && macdData && (
        <div className="shrink-0 relative" style={{ borderTop: `1px solid ${COLORS.border}`, background: COLORS.surface, height: 120 }}>
          <div className="absolute top-0 left-0 right-0 px-3 pt-1 flex items-center justify-between pointer-events-none z-10">
            <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: COLORS.textMute, letterSpacing: 1 }}>
              MACD(12,26,9)
            </span>
            <div className="flex items-center gap-2 tabular-nums">
              {(() => {
                const last = macdData[macdData.length - 1] ?? {};
                const macdVal = last.macd;
                const sigVal = last.signal;
                if (macdVal == null) return <span className="text-[10px]" style={{ color: COLORS.textMute }}>—</span>;
                const cross = (sigVal != null) ? (macdVal > sigVal ? 'bullish' : 'bearish') : null;
                const tone = cross === 'bullish' ? COLORS.green : cross === 'bearish' ? COLORS.red : COLORS.text;
                return (
                  <>
                    {cross && (
                      <span className="text-[9.5px]" style={{ color: COLORS.textMute }}>{cross}</span>
                    )}
                    <span className="text-[10px] font-medium" style={{ color: tone }}>
                      {macdVal.toFixed(3)}
                    </span>
                  </>
                );
              })()}
            </div>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={macdData} margin={{ top: 22, right: 64, left: 0, bottom: 18 }}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="0" vertical={false} />
              <XAxis dataKey="t" stroke={COLORS.border}
                     tick={{ fill: COLORS.textMute, fontSize: 9, fontFamily: 'ui-monospace,monospace' }}
                     tickFormatter={(t) => {
                       if (t == null) return '';
                       const d = (typeof t === 'number') ? new Date(t)
                               : (typeof t === 'string') ? new Date(t)
                               : (t instanceof Date) ? t : null;
                       if (!d || isNaN(d.getTime())) return '';
                       const first = macdData[0]?.t;
                       const last = macdData[macdData.length - 1]?.t;
                       if (first != null && last != null) {
                         const fd = (typeof first === 'number') ? new Date(first) : new Date(first);
                         const ld = (typeof last === 'number') ? new Date(last) : new Date(last);
                         if (Number.isFinite(fd.getTime()) && Number.isFinite(ld.getTime())) {
                           const spanMs = ld.getTime() - fd.getTime();
                           const day = 86400000;
                           if (spanMs < day) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                           if (spanMs < 60 * day) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                           return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
                         }
                       }
                       return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                     }}
                     interval="preserveStartEnd"
                     minTickGap={50} />
              <YAxis orientation="right" width={64}
                     tick={{ fill: COLORS.textMute, fontSize: 9, fontFamily: 'ui-monospace,monospace' }}
                     stroke="transparent"
                     tickFormatter={(v) => v.toFixed(2)} />
              <Line type="monotone" dataKey="macd" stroke={COLORS.mintDim} strokeWidth={1.2}
                    dot={false} isAnimationActive={false} connectNulls={false} name="MACD" />
              <Line type="monotone" dataKey="signal" stroke={COLORS.chartAmber} strokeWidth={1.2}
                    dot={false} isAnimationActive={false} connectNulls={false} name="Signal" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Sub-panel: Volume — bars colored green/red based on bar direction.
          Polished for wide-tile cases:
          - Total height 120px (was 110) gives axis labels breathing room
          - Header strip shows current + average for context
          - X-axis tick row visible (was hidden) so users can read dates
            on wide tiles where there's room. The chart shares the main
            chart's bar timeline so dates align column-for-column.
          - Right margin reduced to 64px (was 58) so the yAxis labels
            don't crowd the rightmost bars.
          - Bottom margin bumped so the date row doesn't clip. */}
      {subPanel === 'volume' && volumeData && (
        <div className="shrink-0 relative" style={{ borderTop: `1px solid ${COLORS.border}`, background: COLORS.surface, height: 120 }}>
          {/* Header strip — overlay rather than sibling so the chart
              gets the full container height for plot area. Volume label
              top-left, current value top-right, both sit above the
              chart with low z. */}
          <div className="absolute top-0 left-0 right-0 px-3 pt-1 flex items-center justify-between pointer-events-none z-10">
            <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: COLORS.textMute, letterSpacing: 1 }}>
              Volume
            </span>
            <div className="flex items-center gap-2 tabular-nums">
              {/* Average over the visible range — gives users a baseline
                  to compare the latest bar against without reading the
                  full y-axis. */}
              {(() => {
                if (volumeData.length === 0) return null;
                const total = volumeData.reduce((s, d) => s + (Number(d.vol) || 0), 0);
                const avg = total / volumeData.length;
                const fmtNum = v => {
                  if (v >= 1e9) return `${(v/1e9).toFixed(2)}B`;
                  if (v >= 1e6) return `${(v/1e6).toFixed(2)}M`;
                  if (v >= 1e3) return `${(v/1e3).toFixed(1)}K`;
                  return v.toFixed(0);
                };
                const last = Number(volumeData[volumeData.length - 1]?.vol ?? 0);
                const aboveAvg = last > avg;
                return (
                  <>
                    <span className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                      avg {fmtNum(avg)}
                    </span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={{
                            color: aboveAvg ? COLORS.green : COLORS.textDim,
                            background: aboveAvg ? 'rgba(31,178,107,0.10)' : 'rgba(255,255,255,0.04)',
                          }}>
                      {fmtNum(last)}
                    </span>
                  </>
                );
              })()}
            </div>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={volumeData} margin={{ top: 22, right: 64, left: 0, bottom: 18 }}>
              <CartesianGrid stroke={COLORS.border} strokeDasharray="0" vertical={false} />
              <XAxis dataKey="t" stroke={COLORS.border}
                     tick={{ fill: COLORS.textMute, fontSize: 9, fontFamily: 'ui-monospace,monospace' }}
                     tickFormatter={(t) => {
                       // Render a sparse date row — only show major
                       // tick marks at sensible intervals so the row
                       // doesn't crowd. Recharts auto-stripes ticks at
                       // ~5-7 across the width which is what we want.
                       if (t == null) return '';
                       const d = (typeof t === 'number') ? new Date(t)
                               : (typeof t === 'string') ? new Date(t)
                               : (t instanceof Date) ? t : null;
                       if (!d || isNaN(d.getTime())) return '';
                       // Pick format based on the visible data span.
                       const first = volumeData[0]?.t;
                       const last = volumeData[volumeData.length - 1]?.t;
                       if (first != null && last != null) {
                         const fd = (typeof first === 'number') ? new Date(first) : new Date(first);
                         const ld = (typeof last === 'number') ? new Date(last) : new Date(last);
                         if (Number.isFinite(fd.getTime()) && Number.isFinite(ld.getTime())) {
                           const spanMs = ld.getTime() - fd.getTime();
                           const day = 86400000;
                           if (spanMs < day) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                           if (spanMs < 60 * day) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                           return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
                         }
                       }
                       return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                     }}
                     interval="preserveStartEnd"
                     minTickGap={50} />
              <YAxis orientation="right" width={64}
                     tick={{ fill: COLORS.textMute, fontSize: 9, fontFamily: 'ui-monospace,monospace' }}
                     stroke="transparent"
                     tickFormatter={(v) => {
                       if (v >= 1e9) return `${(v/1e9).toFixed(1)}B`;
                       if (v >= 1e6) return `${(v/1e6).toFixed(1)}M`;
                       if (v >= 1e3) return `${(v/1e3).toFixed(0)}K`;
                       return v.toFixed(0);
                     }} />
              <Tooltip
                contentStyle={{
                  background: COLORS.surface2,
                  border: `1px solid ${COLORS.borderHi}`,
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: 'ui-monospace,monospace',
                  padding: '6px 10px',
                }}
                labelStyle={{ color: COLORS.textDim, fontSize: 10, marginBottom: 2 }}
                formatter={(v) => {
                  const n = Number(v);
                  if (n >= 1e9) return [`${(n/1e9).toFixed(2)}B`, 'Volume'];
                  if (n >= 1e6) return [`${(n/1e6).toFixed(2)}M`, 'Volume'];
                  if (n >= 1e3) return [`${(n/1e3).toFixed(1)}K`, 'Volume'];
                  return [n.toFixed(0), 'Volume'];
                }}
                labelFormatter={(label) => {
                  if (label == null) return '';
                  const d = (typeof label === 'number') ? new Date(label)
                          : (typeof label === 'string') ? new Date(label)
                          : null;
                  if (!d || isNaN(d.getTime())) return String(label).slice(0, 16);
                  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                }}
                cursor={{ fill: COLORS.borderHi, fillOpacity: 0.1 }}
              />
              <Bar dataKey="vol" isAnimationActive={false}
                   shape={(props) => {
                     // Custom shape — green bar if bar direction was up, red if down.
                     // Slightly higher fill opacity (0.6 from 0.55) for
                     // better contrast against the surface bg.
                     const { x, y, width, height, payload } = props;
                     const color = payload?.dir === 'up' ? COLORS.green : COLORS.red;
                     return <rect x={x} y={y} width={width} height={height}
                                  fill={color} fillOpacity={0.6} />;
                   }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* User-favorited sub-panel indicators. Each gets its own 110px-tall
          stacked panel below the main chart. Multiple sub-panels stack
          vertically. The header shows the indicator name + a × button
          that un-stars it (which removes it from favorites + the chart).
          Reference lines (e.g. RSI 30/70 oversold/overbought) come from
          the indicator's lines[].refLines metadata. */}
      {customSubPanels.map(({ id, impl, rows }) => {
        const lastRow = rows[rows.length - 1];
        const firstLine = impl.lines[0];
        const lastVal = lastRow?.[`${id}__${firstLine.key}`];
        return (
          <div key={`subp-${id}`}
               className="shrink-0"
               style={{ borderTop: `2px solid ${COLORS.borderHi}`, background: COLORS.surface, height: 110 }}>
            <div className="flex items-center justify-between px-3 pt-1 pb-0.5">
              <span className="text-[10px] uppercase tracking-wider truncate"
                    style={{ color: COLORS.textMute }}>
                {firstLine.label}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] tabular-nums" style={{ color: COLORS.text }}>
                  {Number.isFinite(lastVal) ? lastVal.toFixed(2) : '—'}
                </span>
                <button onClick={() => {
                  // Un-favorite this indicator — removes from chart immediately
                  setActiveIndicatorIds(prev => {
                    const next = prev.filter(x => x !== id);
                    try { localStorage.setItem('imo_indicator_favorites', JSON.stringify(next)); } catch {}
                    return next;
                  });
                }}
                        className="w-4 h-4 rounded text-[10px] flex items-center justify-center hover:bg-white/[0.08]"
                        style={{ color: COLORS.textMute }}
                        title={`Remove ${firstLine.label}`}>×</button>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={85}>
              <LineChart data={rows} margin={{ top: 0, right: 58, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={COLORS.border} strokeDasharray="0" vertical={false} />
                <XAxis dataKey="x" hide />
                <YAxis orientation="right" width={58}
                       domain={impl.yDomain ?? ['auto', 'auto']}
                       tick={{ fill: COLORS.textMute, fontSize: 9, fontFamily: 'ui-monospace,monospace' }}
                       stroke="transparent"
                       tickFormatter={(v) => Number(v).toFixed(impl.yDomain ? 0 : 2)} />
                {/* Reference lines — e.g. RSI 30/70, MACD 0, ADX 25 */}
                {impl.lines.flatMap(ln =>
                  (ln.refLines ?? []).map((rv, ri) => (
                    <ReferenceLine key={`ref-${id}-${ln.key}-${ri}`}
                                   y={rv} stroke={COLORS.border} strokeDasharray="3 3" />
                  ))
                )}
                {impl.lines.map(ln => (
                  <Line key={`subp-${id}-${ln.key}`}
                        type="monotone"
                        dataKey={`${id}__${ln.key}`}
                        stroke={ln.color}
                        strokeWidth={1.2}
                        strokeDasharray={ln.dashed ? '4 3' : ln.style === 'dotted' ? '2 4' : undefined}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls={false}
                        name={ln.label} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })}

      {/* Analysis toolbar — bottom strip. Collapsible per-chart so users
          can reclaim vertical space when they don't need the indicators
          panel. State persists in localStorage.
          Compact mode (small widget tile) auto-hides the toolbar so the
          chart canvas keeps as much vertical space as possible — the
          toolbar is huge relative to a quarter-tile. The user can still
          flip it back via the small chevron tab below the chart. */}
      {showToolbar && !isCompact ? (
        <div className="relative">
          <div className="flex items-center px-3 py-2 border-t gap-2 shrink-0 flex-wrap"
               style={{ borderColor: COLORS.border, background: COLORS.surface }}>
        {/* Zoom controls — double-click chart to zoom in; these buttons offer
            an alternative for users who prefer toolbar interaction. */}
        <div className="flex items-center gap-0.5 mr-1">
          <button onClick={() => {
            const dataLen = enrichedData.length;
            const currentVisible = visibleBars === 'all' ? dataLen : Math.min(dataLen, visibleBars);
            const next = Math.max(20, Math.round(currentVisible / 1.5));
            setVisibleBars(next);
          }}
                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/[0.05]"
                  style={{ color: COLORS.textDim }}
                  title="Zoom in (or double-click chart)">
            +
          </button>
          <button onClick={() => {
            const dataLen = enrichedData.length;
            const currentVisible = visibleBars === 'all' ? dataLen : Math.min(dataLen, visibleBars);
            const next = Math.min(dataLen, Math.round(currentVisible * 1.5));
            setVisibleBars(next === dataLen ? 'all' : next);
          }}
                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/[0.05]"
                  style={{ color: COLORS.textDim }}
                  title="Zoom out">
            −
          </button>
          <button onClick={() => setVisibleBars('all')}
                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/[0.05] text-[10px]"
                  style={{ color: COLORS.textDim }}
                  title="Reset zoom (show all bars)">
            ⟳
          </button>
        </div>
        <div className="w-px h-4 mx-1" style={{ background: COLORS.border }} />
        <span className="text-[10px] uppercase tracking-wider mr-1"
              style={{ color: COLORS.textMute }}>Indicators</span>
        <IndicatorToggle label="SMA 20" color="#FFB84D" active={showSma20} onToggle={() => setShowSma20(s => !s)}
                         tooltip="Simple Moving Average over the last 20 bars. Smooths price to show short-term trend direction." />
        <IndicatorToggle label="SMA 50" color="#E07AFC" active={showSma50} onToggle={() => setShowSma50(s => !s)}
                         tooltip="Simple Moving Average over the last 50 bars. Slower than SMA 20 — used for medium-term trend." />
        <IndicatorToggle label="EMA 12" color="#7AC8FF" active={showEma12} onToggle={() => setShowEma12(s => !s)}
                         tooltip="Exponential Moving Average over 12 bars. Weights recent bars more heavily than SMA. Faster signal." />
        <IndicatorToggle label="EMA 26" color="#FF7AB6" active={showEma26} onToggle={() => setShowEma26(s => !s)}
                         tooltip="Exponential Moving Average over 26 bars. Used as the slow line in MACD calculation." />

        <div className="w-px h-4 mx-1" style={{ background: COLORS.border }} />

        <PanelToggle label="RSI"  active={subPanel === 'rsi'}  onToggle={() => setSubPanel(p => p === 'rsi'  ? null : 'rsi')}
                     tooltip="Relative Strength Index. Oscillates 0–100. Above 70 = overbought, below 30 = oversold." />
        <PanelToggle label="MACD" active={subPanel === 'macd'} onToggle={() => setSubPanel(p => p === 'macd' ? null : 'macd')}
                     tooltip="Moving Average Convergence Divergence. Shows momentum and trend changes when the line crosses the signal." />
        <PanelToggle label="VOL"  active={subPanel === 'volume'} onToggle={() => setSubPanel(p => p === 'volume' ? null : 'volume')}
                     tooltip="Volume bars below the chart. Big bars = strong conviction; small bars = quiet trading." />

        <div className="w-px h-4 mx-1" style={{ background: COLORS.border }} />

        <button
          onClick={() => setShowVolumeBubbles(b => !b)}
          className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] rounded border transition-colors"
          style={{
            borderColor: showVolumeBubbles ? COLORS.mint : COLORS.border,
            color: showVolumeBubbles ? COLORS.mint : COLORS.textDim,
            background: showVolumeBubbles ? 'rgba(61,123,255,0.06)' : 'transparent',
          }}
          title="Show per-bar volume as bubbles overlaid on the chart. Larger bubble = higher volume traded at that price level."
        >
          <span style={{ fontSize: 11, lineHeight: 1 }}>◉</span>
          Vol bubbles
        </button>

        <div className="w-px h-4 mx-1" style={{ background: COLORS.border }} />

        <button
          onClick={() => { setDrawing(d => !d); setPendingPoint(null); }}
          className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] rounded border transition-colors"
          style={{
            borderColor: drawing ? COLORS.mint : COLORS.border,
            color: drawing ? COLORS.mint : COLORS.textDim,
            background: drawing ? 'rgba(61,123,255,0.06)' : 'transparent',
          }}
          title="Click two points on the chart to draw a trendline"
        >
          <Pencil size={10} />
          {drawing ? (pendingPoint ? 'Drawing…' : 'Pick first point') : 'Trendline'}
        </button>
        {trendlines.length > 0 && (
          <button
            onClick={() => setTrendlines([])}
            className="px-2 py-0.5 text-[10px] rounded border transition-colors"
            style={{ borderColor: COLORS.border, color: COLORS.textDim }}
            title="Clear all trendlines"
          >
            Clear ({trendlines.length})
          </button>
        )}
        <div className="w-px h-4 mx-1" style={{ background: COLORS.border }} />
        <button onClick={() => setShowMoreIndicators(true)}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border transition-colors hover:bg-white/[0.04]"
                style={{ borderColor: COLORS.border, color: COLORS.mint }}
                title="Browse all indicators, strategies, and patterns">
          More indicators…
          {activeIndicatorIds.filter(id => INDICATOR_IMPLS[id]).length > 0 && (
            <span className="text-[9px] px-1 rounded ml-1 tabular-nums"
                  style={{ background: COLORS.mint, color: COLORS.bg, fontWeight: 600 }}>
              {activeIndicatorIds.filter(id => INDICATOR_IMPLS[id]).length}
            </span>
          )}
        </button>
        <button onClick={() => setShowDrawingsPicker(true)}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border transition-colors hover:bg-white/[0.04]"
                style={{ borderColor: COLORS.border, color: COLORS.mint }}
                title="Browse all drawing tools — trend lines, Fibonacci, patterns, shapes, annotations">
          Drawings…
        </button>
        {/* Preset save/load — captures current indicator + drawing state so
            you can flip between setups (e.g. "Day trade" vs "Long-term").
            Saved bundles persist in localStorage, so they survive across
            tickers and sessions. */}
        <div className="relative">
          <button onClick={() => setPresetMenuOpen(o => !o)}
                  className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border transition-colors hover:bg-white/[0.04]"
                  style={{ borderColor: COLORS.border, color: COLORS.mint }}
                  title="Save or load a chart setup (indicators + drawings)">
            <span style={{ fontSize: 10 }}>★</span>
            Presets
            {presets.length > 0 && (
              <span className="text-[9px] px-1 rounded ml-0.5 tabular-nums"
                    style={{ background: COLORS.mint, color: COLORS.bg, fontWeight: 600 }}>
                {presets.length}
              </span>
            )}
          </button>
          {presetMenuOpen && (
            <>
              <div className="fixed inset-0 z-40"
                   onClick={() => setPresetMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 rounded-md border z-50 overflow-hidden"
                   style={{
                     background: COLORS.surface,
                     borderColor: COLORS.borderHi,
                     boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                     minWidth: 220,
                   }}>
                <div className="px-3 py-2 border-b text-[10px] uppercase tracking-wider"
                     style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
                  Chart presets
                </div>
                {presets.length === 0 ? (
                  <div className="px-3 py-3 text-[11px]" style={{ color: COLORS.textMute }}>
                    No presets yet — save your current setup to reuse later.
                  </div>
                ) : (
                  presets.map((p, i) => (
                    <div key={i} className="flex items-center border-b"
                         style={{ borderColor: COLORS.border }}>
                      <button onClick={() => {
                        // Load preset
                        setShowSma20(!!p.showSma20);
                        setShowSma50(!!p.showSma50);
                        setShowEma12(!!p.showEma12);
                        setShowEma26(!!p.showEma26);
                        setShowVolumeBubbles(!!p.showVolumeBubbles);
                        setSubPanel(p.subPanel ?? null);
                        setActiveIndicatorIds(p.indicators ?? []);
                        setActiveStrategyIds(p.strategies ?? []);
                        setActiveProfileIds(p.profiles ?? []);
                        setActivePatternIds(p.patterns ?? []);
                        setTrendlines(p.trendlines ?? []);
                        setHlines(p.hlines ?? []);
                        setFibs(p.fibs ?? []);
                        setChannels(p.channels ?? []);
                        setArrows(p.arrows ?? []);
                        setPresetMenuOpen(false);
                      }}
                              className="flex-1 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors">
                        <div className="text-[12px]" style={{ color: COLORS.text }}>{p.name}</div>
                        <div className="text-[10px]" style={{ color: COLORS.textMute }}>
                          {(p.indicators?.length ?? 0)} ind · {(p.trendlines?.length ?? 0) + (p.hlines?.length ?? 0) + (p.fibs?.length ?? 0)} draw
                        </div>
                      </button>
                      <button onClick={() => {
                        // Delete this preset
                        const next = presets.filter((_, j) => j !== i);
                        setPresets(next);
                        try { localStorage.setItem('imo_chart_presets', JSON.stringify(next)); } catch {}
                      }}
                              className="px-2 py-2 text-[14px] hover:bg-white/[0.04]"
                              style={{ color: COLORS.textMute }}
                              title="Delete preset">×</button>
                    </div>
                  ))
                )}
                <button onClick={() => { setPresetSaveOpen(true); setPresetMenuOpen(false); setPresetName(''); }}
                        className="w-full px-3 py-2 text-left text-[11.5px] hover:bg-white/[0.04] transition-colors"
                        style={{ color: COLORS.mint, fontWeight: 500 }}>
                  + Save current setup as preset
                </button>
              </div>
            </>
          )}
          {presetSaveOpen && (
            <>
              <div className="fixed inset-0 z-40 flex items-center justify-center"
                   style={{ background: 'rgba(0,0,0,0.55)' }}
                   onClick={() => setPresetSaveOpen(false)}>
                <div onClick={e => e.stopPropagation()}
                     className="rounded-md border p-4"
                     style={{ background: COLORS.surface, borderColor: COLORS.borderHi, width: 320 }}>
                  <div className="text-[12.5px] font-medium mb-2" style={{ color: COLORS.text }}>
                    Save chart preset
                  </div>
                  <div className="text-[11px] mb-3" style={{ color: COLORS.textMute }}>
                    Captures all indicators, strategies, profiles, patterns, and drawings in their current state.
                  </div>
                  <input autoFocus value={presetName}
                         onChange={e => setPresetName(e.target.value)}
                         onKeyDown={e => {
                           if (e.key === 'Enter' && presetName.trim()) {
                             const newPreset = {
                               name: presetName.trim(),
                               showSma20, showSma50, showEma12, showEma26,
                               showVolumeBubbles, subPanel,
                               indicators: activeIndicatorIds,
                               strategies: activeStrategyIds,
                               profiles: activeProfileIds,
                               patterns: activePatternIds,
                               trendlines, hlines, fibs, channels, arrows,
                               savedAt: Date.now(),
                             };
                             const next = [...presets, newPreset];
                             setPresets(next);
                             try { localStorage.setItem('imo_chart_presets', JSON.stringify(next)); } catch {}
                             setPresetSaveOpen(false);
                             setPresetName('');
                           }
                           if (e.key === 'Escape') setPresetSaveOpen(false);
                         }}
                         placeholder="e.g. Day trade setup"
                         className="w-full px-3 py-2 text-[12px] rounded outline-none mb-3"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => setPresetSaveOpen(false)}
                            className="px-3 py-1.5 text-[11px] rounded"
                            style={{ color: COLORS.textDim }}>Cancel</button>
                    <button disabled={!presetName.trim()}
                            onClick={() => {
                              const newPreset = {
                                name: presetName.trim(),
                                showSma20, showSma50, showEma12, showEma26,
                                showVolumeBubbles, subPanel,
                                indicators: activeIndicatorIds,
                                strategies: activeStrategyIds,
                                profiles: activeProfileIds,
                                patterns: activePatternIds,
                                trendlines, hlines, fibs, channels, arrows,
                                savedAt: Date.now(),
                              };
                              const next = [...presets, newPreset];
                              setPresets(next);
                              try { localStorage.setItem('imo_chart_presets', JSON.stringify(next)); } catch {}
                              setPresetSaveOpen(false);
                              setPresetName('');
                            }}
                            className="px-3 py-1.5 text-[11px] rounded disabled:opacity-40"
                            style={{ background: COLORS.mint, color: '#FFFFFF' }}>Save</button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        <button onClick={() => setShowFundamentals(true)}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border transition-colors hover:bg-white/[0.04]"
                style={{ borderColor: COLORS.border, color: COLORS.mint }}
                title="Browse all fundamental metrics — income statement, balance sheet, cash flow, statistics">
          Fundamentals…
        </button>
        {/* Hide button moved per UX feedback — used to live here at
            the right end of the indicator toolbar, but the user
            wanted it next to the pin badge in the middle of the
            chart bottom (not buried at toolbar's far right where
            it's hard to find on wide layouts). The new Hide button
            is rendered inside the pin-badge container further up
            in this same component. */}
          </div>
        </div>
      ) : (
        <button onClick={() => {
                  setShowToolbar(true);
                  try { localStorage.setItem('imo_chart_toolbar_visible', '1'); } catch {}
                }}
                className="self-center flex items-center gap-1.5 px-3 py-1 text-[10px] rounded-b-md transition-colors hover:bg-white/[0.04]"
                style={{
                  background: COLORS.surface,
                  color: COLORS.mint,
                  border: `1px solid ${COLORS.border}`,
                  borderTop: 'none',
                }}
                title="Show indicator buttons">
          ⌄ Show indicators
        </button>
      )}
      {showMoreIndicators && (
        <MoreIndicatorsModal onClose={() => setShowMoreIndicators(false)} />
      )}
      {showDrawingsPicker && (
        <DrawingsPicker
          activeTool={activeTool}
          onPick={(toolId) => { setActiveTool(toolId); setShowDrawingsPicker(false); }}
          onClose={() => setShowDrawingsPicker(false)} />
      )}
      {showFundamentals && (
        <FundamentalsModal instrument={instrument} onClose={() => setShowFundamentals(false)} />
      )}
      {showScanner && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowScanner(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[520px] max-w-[95vw] max-h-[85vh] rounded-md border overflow-hidden flex flex-col"
               style={{ background: COLORS.surface, borderColor: COLORS.borderHi, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
            <div className="px-4 py-3 border-b flex items-start justify-between" style={{ borderColor: COLORS.border }}>
              <div>
                <div className="flex items-center gap-1.5 text-[14px] font-medium" style={{ color: COLORS.text }}>
                  <Sparkles size={14} style={{ color: COLORS.mint }} />
                  Chart Scanner · {instrument.id}
                </div>
                <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textMute }}>
                  AI analysis of recent price action and indicator state
                </div>
              </div>
              <button onClick={() => setShowScanner(false)}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-[18px] leading-none"
                      style={{ color: COLORS.textDim }}>×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {scannerLoading && (
                <div className="py-8 text-center">
                  <div className="text-[12px] mb-2" style={{ color: COLORS.text }}>Scanning chart…</div>
                  <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
                    Sending recent bars + indicator state to the AI
                  </div>
                </div>
              )}
              {scannerError && (
                <div className="py-4 px-3 rounded-md text-[11.5px]"
                     style={{ background: 'rgba(237,112,136,0.08)', color: COLORS.red, border: `1px solid ${COLORS.red}55` }}>
                  {scannerError}
                </div>
              )}
              {scannerResult && (
                <div className="space-y-4">
                  {/* Signal banner */}
                  <div className="p-3 rounded-md flex items-center justify-between"
                       style={{
                         background: scannerResult.signal === 'long' ? 'rgba(31,178,107,0.10)'
                                   : scannerResult.signal === 'short' ? 'rgba(237,112,136,0.10)'
                                   : 'rgba(255,255,255,0.04)',
                         border: `1px solid ${scannerResult.signal === 'long' ? COLORS.green
                                          : scannerResult.signal === 'short' ? COLORS.red
                                          : COLORS.border}`,
                       }}>
                    <div>
                      <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Signal</div>
                      <div className="text-[16px] font-medium uppercase" style={{
                        color: scannerResult.signal === 'long' ? COLORS.green
                             : scannerResult.signal === 'short' ? COLORS.red
                             : COLORS.text,
                      }}>{scannerResult.signal ?? 'neutral'}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Confidence</div>
                      <div className="text-[13px]" style={{ color: COLORS.text }}>{scannerResult.confidence ?? '—'}</div>
                    </div>
                  </div>
                  {/* Movement breakdown */}
                  {scannerResult.movement && (
                    <div>
                      <div className="imo-section-label mb-1.5">Movement</div>
                      <AIMarkdown size="md">{scannerResult.movement}</AIMarkdown>
                    </div>
                  )}
                  {/* Trade idea */}
                  {scannerResult.trade_idea && (
                    <div>
                      <div className="imo-section-label mb-1.5">Trade idea</div>
                      <div className="p-2.5 rounded-md"
                           style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
                        <AIMarkdown size="md">{scannerResult.trade_idea}</AIMarkdown>
                      </div>
                    </div>
                  )}
                  {/* Key levels */}
                  {Array.isArray(scannerResult.key_levels) && scannerResult.key_levels.length > 0 && (
                    <div>
                      <div className="imo-section-label mb-1.5">Key levels</div>
                      <div className="flex flex-wrap gap-1.5">
                        {scannerResult.key_levels.map((lv, i) => (
                          <span key={i} className="px-2 py-1 rounded text-[11px] tabular-nums"
                                style={{ background: COLORS.surface2, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                            {String(lv)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Recommended indicators */}
                  {Array.isArray(scannerResult.recommended_indicators) && scannerResult.recommended_indicators.length > 0 && (
                    <div>
                      <div className="imo-section-label mb-1.5">Recommended indicators</div>
                      <div className="flex flex-wrap gap-1.5">
                        {scannerResult.recommended_indicators.map((ind, i) => (
                          <span key={i} className="px-2 py-1 rounded text-[11px]"
                                style={{ background: 'rgba(61,123,255,0.08)', color: COLORS.mint, border: `1px solid ${COLORS.mint}33` }}>
                            {String(ind)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Risks */}
                  {Array.isArray(scannerResult.risks) && scannerResult.risks.length > 0 && (
                    <div>
                      <div className="imo-section-label mb-1.5">Risks</div>
                      <ul className="space-y-1">
                        {scannerResult.risks.map((r, i) => (
                          <li key={i} className="text-[11.5px] flex gap-2" style={{ color: COLORS.textDim }}>
                            <span style={{ color: COLORS.red }}>·</span>
                            <span>{String(r)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-4 py-2.5 border-t flex justify-end gap-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
              <button onClick={() => runScanner()}
                      disabled={scannerLoading}
                      className="px-3 py-1.5 rounded text-[11px] transition-opacity"
                      style={{ background: COLORS.surface2, color: COLORS.text, border: `1px solid ${COLORS.border}`, opacity: scannerLoading ? 0.5 : 1 }}>
                Re-scan
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
