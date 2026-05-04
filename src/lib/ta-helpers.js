// IMO Onyx Terminal — Technical analysis helpers
//
// Phase 3p.26 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines 2916-3522, ~607 lines).
//
// Pure-function technical analysis library. Every function takes an
// OHLCV bar series (or a thin wrapper {price, t, ...}) and returns
// either a flat number[] of values or a [{v, ...}] series. Used by
// both Chart (via INDICATOR_IMPLS) and many other monolith
// components (35+ callers for sma alone, 62 for ema).
//
// Honest scope:
//   - All functions are pure / no side effects.
//   - No charting; just the math. Visualization happens in Chart.
//   - Functions returning [{v}] are ready to plot directly via
//     recharts; functions returning number[] need wrapping.
//   - Default periods follow industry conventions (RSI 14, MACD
//     12/26/9, BB 20/2, etc).

// ────────── Technical indicators ──────────

// Simple Moving Average — last `period` values averaged
export const sma = (data, period, key = 'price') => {
  const out = [];
  for (let i = 0; i < data.length; i++) {
    // For warmup period, average whatever data we have so far instead of
    // returning null. This ensures the SMA line spans the entire chart from
    // bar 0 instead of starting partway through. Statistically less rigorous
    // for the first N bars, but visually consistent with how the user expects
    // overlays to behave (and how TradingView, ThinkOrSwim etc. render them).
    const start = Math.max(0, i - period + 1);
    let sum = 0;
    for (let j = start; j <= i; j++) sum += data[j][key];
    out.push({ ...data[i], v: sum / (i - start + 1) });
  }
  return out;
};

// Exponential Moving Average — recursive smoothing
export const ema = (data, period, key = 'price') => {
  const out = [];
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < data.length; i++) {
    const px = data[i][key];
    if (prev == null) {
      // Seed with the first value
      prev = px;
      out.push({ ...data[i], v: px });
    } else {
      const v = px * k + prev * (1 - k);
      prev = v;
      out.push({ ...data[i], v });
    }
  }
  return out;
};

// RSI (Relative Strength Index) — 14-period default. 0-100 scale.
export const rsi = (data, period = 14, key = 'price') => {
  const out = [];
  // First bar has no prior — emit a neutral 50 so the line still starts at bar 0
  // instead of cutting off. After that, accumulate partial gains/losses and
  // emit a running RSI for every bar; the value smooths out as more data
  // arrives, but it's never null.
  out.push({ ...data[0], v: 50 });
  let runningGain = 0, runningLoss = 0;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < data.length; i++) {
    const change = data[i][key] - data[i - 1][key];
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);
    if (i <= period) {
      // Warmup: simple running average across all bars seen so far
      runningGain += gain;
      runningLoss += loss;
      const denom = i;
      const ag = runningGain / denom;
      const al = runningLoss / denom;
      const rs = al === 0 ? 100 : ag / al;
      out.push({ ...data[i], v: 100 - 100 / (1 + rs) });
      if (i === period) { avgGain = ag; avgLoss = al; }
    } else {
      // Wilder smoothing once warmed up
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      out.push({ ...data[i], v: 100 - 100 / (1 + rs) });
    }
  }
  return out;
};

// MACD — 12-period EMA minus 26-period EMA, with 9-period signal line
export const macd = (data, fast = 12, slow = 26, signal = 9, key = 'price') => {
  const fastEma = ema(data, fast, key);
  const slowEma = ema(data, slow, key);
  const macdLine = data.map((d, i) => ({
    ...d,
    macd: fastEma[i].v - slowEma[i].v,
  }));
  const signalLine = ema(macdLine, signal, 'macd');
  return macdLine.map((d, i) => ({
    ...d,
    signal: signalLine[i].v,
    histogram: d.macd - signalLine[i].v,
  }));
};

/* ──────────── Generic indicator math library ────────────
   Every indicator is a pure function (data, ...params) → number[].
   Length matches data.length so series can be plotted directly via
   <Line dataKey="..."/> against the same x-axis. Where math needs a
   warmup, output values are filled forward from the first valid bar.

   Synthesizing OHLC: bar.price is the only value our data shape
   guarantees, so any indicator that needs high/low/close treats
   price as close, and synthesizes a tight ±0.3% range for high/low.
   This is good enough for visual indicator behavior on this app's
   simulated/aggregate price feeds. Real OHLC bars (when available
   on a higher-res source) would be picked up via bar.h / bar.l.
*/
export const _hi = (b) => (b.h ?? b.price * 1.003);
export const _lo = (b) => (b.l ?? b.price * 0.997);
export const _cl = (b) => (b.c ?? b.price);
export const _vo = (b) => (b.v ?? 0);

// WMA — linear-weight moving average
export const wmaSeries = (data, period, key = 'price') => {
  const out = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - period + 1);
    let num = 0, den = 0;
    for (let j = start, w = 1; j <= i; j++, w++) {
      num += data[j][key] * w;
      den += w;
    }
    out[i] = num / den;
  }
  return out;
};

// Helper: extract a flat number[] from sma()/ema() (which return enriched objects)
export const _flat = (xs) => xs.map(x => x.v);

// True Range (single-bar)
export const _tr = (data, i) => {
  if (i === 0) return _hi(data[0]) - _lo(data[0]);
  const h = _hi(data[i]), l = _lo(data[i]), pc = _cl(data[i - 1]);
  return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
};

// ATR — Wilder smoothed
export const atrSeries = (data, period = 14) => {
  const out = new Array(data.length).fill(0);
  let atr = 0;
  for (let i = 0; i < data.length; i++) {
    const tr = _tr(data, i);
    if (i < period) {
      atr = (atr * i + tr) / (i + 1);
    } else {
      atr = (atr * (period - 1) + tr) / period;
    }
    out[i] = atr;
  }
  return out;
};

// Bollinger Bands — returns { mid, upper, lower } number arrays
export const bbandsSeries = (data, period = 20, mult = 2) => {
  const mid = new Array(data.length).fill(0);
  const upper = new Array(data.length).fill(0);
  const lower = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - period + 1);
    let sum = 0;
    for (let j = start; j <= i; j++) sum += data[j].price;
    const m = sum / (i - start + 1);
    let varSum = 0;
    for (let j = start; j <= i; j++) varSum += Math.pow(data[j].price - m, 2);
    const sd = Math.sqrt(varSum / (i - start + 1));
    mid[i] = m;
    upper[i] = m + sd * mult;
    lower[i] = m - sd * mult;
  }
  return { mid, upper, lower };
};

// Donchian channels — { upper, lower, mid }
export const donchianSeries = (data, period = 20) => {
  const upper = new Array(data.length).fill(0);
  const lower = new Array(data.length).fill(0);
  const mid   = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - period + 1);
    let hi = -Infinity, lo = Infinity;
    for (let j = start; j <= i; j++) {
      hi = Math.max(hi, _hi(data[j]));
      lo = Math.min(lo, _lo(data[j]));
    }
    upper[i] = hi; lower[i] = lo; mid[i] = (hi + lo) / 2;
  }
  return { upper, lower, mid };
};

// Keltner — EMA mid ± mult × ATR
export const keltnerSeries = (data, period = 20, mult = 2) => {
  const mid = _flat(ema(data, period));
  const atr = atrSeries(data, period);
  return {
    mid,
    upper: mid.map((m, i) => m + atr[i] * mult),
    lower: mid.map((m, i) => m - atr[i] * mult),
  };
};

// Envelope — MA ± pct
export const envelopeSeries = (data, period = 20, pct = 0.025) => {
  const mid = _flat(sma(data, period));
  return {
    mid,
    upper: mid.map(m => m * (1 + pct)),
    lower: mid.map(m => m * (1 - pct)),
  };
};

// Stochastic Oscillator — %K and %D (smoothed %K)
export const stochasticSeries = (data, period = 14, smooth = 3) => {
  const k = new Array(data.length).fill(50);
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - period + 1);
    let hi = -Infinity, lo = Infinity;
    for (let j = start; j <= i; j++) {
      hi = Math.max(hi, _hi(data[j]));
      lo = Math.min(lo, _lo(data[j]));
    }
    const range = hi - lo;
    k[i] = range === 0 ? 50 : ((_cl(data[i]) - lo) / range) * 100;
  }
  // Smooth K with simple SMA(smooth)
  const d = new Array(data.length).fill(50);
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - smooth + 1);
    let sum = 0;
    for (let j = start; j <= i; j++) sum += k[j];
    d[i] = sum / (i - start + 1);
  }
  return { k, d };
};

// CCI — Commodity Channel Index
export const cciSeries = (data, period = 20) => {
  const tp = data.map(b => (_hi(b) + _lo(b) + _cl(b)) / 3);
  const out = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - period + 1);
    let mean = 0;
    for (let j = start; j <= i; j++) mean += tp[j];
    mean /= (i - start + 1);
    let mad = 0;
    for (let j = start; j <= i; j++) mad += Math.abs(tp[j] - mean);
    mad /= (i - start + 1);
    out[i] = mad === 0 ? 0 : (tp[i] - mean) / (0.015 * mad);
  }
  return out;
};

// ADX (+DI, -DI, ADX) — Wilder
export const adxSeries = (data, period = 14) => {
  const len = data.length;
  const plusDM = new Array(len).fill(0);
  const minusDM = new Array(len).fill(0);
  const tr = new Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    const upMove   = _hi(data[i]) - _hi(data[i - 1]);
    const downMove = _lo(data[i - 1]) - _lo(data[i]);
    plusDM[i]  = (upMove > downMove && upMove > 0)   ? upMove   : 0;
    minusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0;
    tr[i] = _tr(data, i);
  }
  // Wilder smooth
  const smooth = (arr) => {
    const out = new Array(len).fill(0);
    let s = 0;
    for (let i = 0; i < len; i++) {
      if (i < period) s += arr[i];
      else s = s - s / period + arr[i];
      out[i] = i < period - 1 ? s / Math.max(1, i + 1) : s;
    }
    return out;
  };
  const trS = smooth(tr);
  const plusDI = smooth(plusDM).map((v, i) => trS[i] === 0 ? 0 : (v / trS[i]) * 100);
  const minusDI = smooth(minusDM).map((v, i) => trS[i] === 0 ? 0 : (v / trS[i]) * 100);
  const dx = plusDI.map((p, i) => {
    const sum = p + minusDI[i];
    return sum === 0 ? 0 : (Math.abs(p - minusDI[i]) / sum) * 100;
  });
  // ADX = Wilder smoothed DX
  const adx = new Array(len).fill(0);
  let acc = 0;
  for (let i = 0; i < len; i++) {
    if (i < period) acc += dx[i];
    else acc = (acc * (period - 1) + dx[i]) / period;
    adx[i] = i < period - 1 ? acc / Math.max(1, i + 1) : (i < period ? acc / period : acc);
  }
  return { plusDI, minusDI, adx };
};

// Williams %R
export const willrSeries = (data, period = 14) => {
  const out = new Array(data.length).fill(-50);
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - period + 1);
    let hi = -Infinity, lo = Infinity;
    for (let j = start; j <= i; j++) {
      hi = Math.max(hi, _hi(data[j]));
      lo = Math.min(lo, _lo(data[j]));
    }
    const range = hi - lo;
    out[i] = range === 0 ? -50 : ((hi - _cl(data[i])) / range) * -100;
  }
  return out;
};

// Money Flow Index
export const mfiSeries = (data, period = 14) => {
  const tp = data.map(b => (_hi(b) + _lo(b) + _cl(b)) / 3);
  const out = new Array(data.length).fill(50);
  for (let i = 1; i < data.length; i++) {
    const start = Math.max(1, i - period + 1);
    let pos = 0, neg = 0;
    for (let j = start; j <= i; j++) {
      const flow = tp[j] * _vo(data[j]);
      if (tp[j] > tp[j - 1]) pos += flow;
      else if (tp[j] < tp[j - 1]) neg += flow;
    }
    if (pos + neg === 0) { out[i] = 50; continue; }
    const ratio = neg === 0 ? 100 : pos / neg;
    out[i] = 100 - 100 / (1 + ratio);
  }
  return out;
};

// On-Balance Volume — cumulative
export const obvSeries = (data) => {
  const out = new Array(data.length).fill(0);
  for (let i = 1; i < data.length; i++) {
    const prevClose = _cl(data[i - 1]);
    const curClose  = _cl(data[i]);
    const v = _vo(data[i]);
    out[i] = curClose > prevClose ? out[i - 1] + v
           : curClose < prevClose ? out[i - 1] - v
           : out[i - 1];
  }
  return out;
};

// ROC — Rate of Change
export const rocSeries = (data, period = 9, key = 'price') => {
  const out = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    if (i < period) { out[i] = 0; continue; }
    const prev = data[i - period][key];
    out[i] = prev === 0 ? 0 : ((data[i][key] - prev) / prev) * 100;
  }
  return out;
};

// Momentum — close[i] - close[i-period]
export const momSeries = (data, period = 10, key = 'price') => {
  const out = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    if (i < period) { out[i] = 0; continue; }
    out[i] = data[i][key] - data[i - period][key];
  }
  return out;
};

// TRIX — % rate of change of triple-smoothed EMA
export const trixSeries = (data, period = 15) => {
  const e1 = _flat(ema(data, period));
  const e2 = _flat(ema(e1.map((v, i) => ({ price: v, t: i })), period));
  const e3 = _flat(ema(e2.map((v, i) => ({ price: v, t: i })), period));
  const out = new Array(data.length).fill(0);
  for (let i = 1; i < data.length; i++) {
    out[i] = e3[i - 1] === 0 ? 0 : ((e3[i] - e3[i - 1]) / e3[i - 1]) * 100;
  }
  return out;
};

// Awesome Oscillator — 5-period SMA of median minus 34-period SMA
export const aoSeries = (data) => {
  const med = data.map(b => (_hi(b) + _lo(b)) / 2);
  const fast = _flat(sma(med.map((v, i) => ({ price: v, t: i })), 5));
  const slow = _flat(sma(med.map((v, i) => ({ price: v, t: i })), 34));
  return fast.map((v, i) => v - slow[i]);
};

// Hull MA — fast, low-lag MA: HMA = WMA(2*WMA(n/2) - WMA(n), sqrt(n))
export const hmaSeries = (data, period = 9) => {
  const half = Math.max(1, Math.floor(period / 2));
  const sqrtP = Math.max(1, Math.floor(Math.sqrt(period)));
  const w1 = wmaSeries(data, half);
  const w2 = wmaSeries(data, period);
  const raw = w1.map((v, i) => ({ price: 2 * v - w2[i], t: i }));
  return wmaSeries(raw, sqrtP);
};

// Ichimoku — Tenkan, Kijun, Senkou A, Senkou B (visualized as cloud bounds)
export const ichimokuSeries = (data) => {
  const tenkan = new Array(data.length).fill(0);
  const kijun  = new Array(data.length).fill(0);
  const senkouA = new Array(data.length).fill(0);
  const senkouB = new Array(data.length).fill(0);
  const hl = (i, p) => {
    const start = Math.max(0, i - p + 1);
    let hi = -Infinity, lo = Infinity;
    for (let j = start; j <= i; j++) {
      hi = Math.max(hi, _hi(data[j]));
      lo = Math.min(lo, _lo(data[j]));
    }
    return (hi + lo) / 2;
  };
  for (let i = 0; i < data.length; i++) {
    tenkan[i]  = hl(i, 9);
    kijun[i]   = hl(i, 26);
    senkouA[i] = (tenkan[i] + kijun[i]) / 2;
    senkouB[i] = hl(i, 52);
  }
  return { tenkan, kijun, senkouA, senkouB };
};

// VWAP — anchored to first bar
export const vwapSeries = (data) => {
  const out = new Array(data.length).fill(0);
  let pv = 0, vv = 0;
  for (let i = 0; i < data.length; i++) {
    const tp = (_hi(data[i]) + _lo(data[i]) + _cl(data[i])) / 3;
    const v = _vo(data[i]) || 1;
    pv += tp * v;
    vv += v;
    out[i] = vv === 0 ? tp : pv / vv;
  }
  return out;
};

// Stochastic RSI
export const stochRsiSeries = (data, rsiP = 14, stochP = 14) => {
  const rsiVals = rsi(data, rsiP).map(x => x.v);
  const out = new Array(data.length).fill(50);
  for (let i = 0; i < rsiVals.length; i++) {
    const start = Math.max(0, i - stochP + 1);
    let hi = -Infinity, lo = Infinity;
    for (let j = start; j <= i; j++) {
      hi = Math.max(hi, rsiVals[j]);
      lo = Math.min(lo, rsiVals[j]);
    }
    const range = hi - lo;
    out[i] = range === 0 ? 50 : ((rsiVals[i] - lo) / range) * 100;
  }
  return out;
};

// Parabolic SAR — simplified (always-on stop-and-reverse)
export const psarSeries = (data, step = 0.02, max = 0.2) => {
  const out = new Array(data.length).fill(0);
  if (!data.length) return out;
  let upTrend = true, ep = _hi(data[0]), af = step, sar = _lo(data[0]);
  out[0] = sar;
  for (let i = 1; i < data.length; i++) {
    const h = _hi(data[i]), l = _lo(data[i]);
    sar = sar + af * (ep - sar);
    if (upTrend) {
      if (l < sar) { upTrend = false; sar = ep; ep = l; af = step; }
      else if (h > ep) { ep = h; af = Math.min(max, af + step); }
    } else {
      if (h > sar) { upTrend = true; sar = ep; ep = h; af = step; }
      else if (l < ep) { ep = l; af = Math.min(max, af + step); }
    }
    out[i] = sar;
  }
  return out;
};

// SuperTrend — direction-flipping ATR band
export const supertrendSeries = (data, period = 10, mult = 3) => {
  const atr = atrSeries(data, period);
  const upper = new Array(data.length).fill(0);
  const lower = new Array(data.length).fill(0);
  const dir = new Array(data.length).fill(1);
  const line = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const mid = (_hi(data[i]) + _lo(data[i])) / 2;
    upper[i] = mid + mult * atr[i];
    lower[i] = mid - mult * atr[i];
    if (i === 0) { dir[i] = 1; line[i] = lower[i]; continue; }
    if (_cl(data[i]) > upper[i - 1]) dir[i] = 1;
    else if (_cl(data[i]) < lower[i - 1]) dir[i] = -1;
    else dir[i] = dir[i - 1];
    line[i] = dir[i] === 1 ? lower[i] : upper[i];
  }
  return { line, dir };
};

// Pivot Points (classic) — single set computed from full-period HLC; flat across chart
export const pivotsClassic = (data) => {
  if (!data.length) return null;
  let hi = -Infinity, lo = Infinity, lastClose = data[data.length - 1].price;
  for (const b of data) { hi = Math.max(hi, _hi(b)); lo = Math.min(lo, _lo(b)); }
  const p  = (hi + lo + lastClose) / 3;
  const r1 = 2 * p - lo, s1 = 2 * p - hi;
  const r2 = p + (hi - lo), s2 = p - (hi - lo);
  const r3 = hi + 2 * (p - lo), s3 = lo - 2 * (hi - p);
  return { p, r1, r2, r3, s1, s2, s3 };
};

// Standard deviation series
export const stdevSeries = (data, period = 20) => {
  const out = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - period + 1);
    let mean = 0;
    for (let j = start; j <= i; j++) mean += data[j].price;
    mean /= (i - start + 1);
    let v = 0;
    for (let j = start; j <= i; j++) v += Math.pow(data[j].price - mean, 2);
    out[i] = Math.sqrt(v / (i - start + 1));
  }
  return out;
};

// Historical volatility (% annualized, log returns)
export const hvSeries = (data, period = 20) => {
  const out = new Array(data.length).fill(0);
  const rets = new Array(data.length).fill(0);
  for (let i = 1; i < data.length; i++) {
    const r = Math.log(data[i].price / Math.max(1e-9, data[i - 1].price));
    rets[i] = r;
  }
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(1, i - period + 1);
    let mean = 0;
    for (let j = start; j <= i; j++) mean += rets[j];
    mean /= Math.max(1, i - start + 1);
    let v = 0;
    for (let j = start; j <= i; j++) v += Math.pow(rets[j] - mean, 2);
    const sd = Math.sqrt(v / Math.max(1, i - start + 1));
    out[i] = sd * Math.sqrt(252) * 100;
  }
  return out;
};

// Linear regression — slope/intercept over last N bars
export const linregSeries = (data, period = 50) => {
  const out = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - period + 1);
    const n = i - start + 1;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let j = start, k = 0; j <= i; j++, k++) {
      sx += k; sy += data[j].price; sxy += k * data[j].price; sxx += k * k;
    }
    const denom = n * sxx - sx * sx;
    if (denom === 0) { out[i] = data[i].price; continue; }
    const m = (n * sxy - sx * sy) / denom;
    const c = (sy - m * sx) / n;
    // Value at the current bar (last point of the regression)
    out[i] = m * (n - 1) + c;
  }
  return out;
};

// Aroon — Up/Down (0–100)
export const aroonSeries = (data, period = 14) => {
  const up = new Array(data.length).fill(0);
  const down = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - period);
    let hiIdx = start, loIdx = start;
    for (let j = start; j <= i; j++) {
      if (_hi(data[j]) > _hi(data[hiIdx])) hiIdx = j;
      if (_lo(data[j]) < _lo(data[loIdx])) loIdx = j;
    }
    const span = i - start;
    if (span === 0) { up[i] = 100; down[i] = 100; continue; }
    up[i]   = ((span - (i - hiIdx)) / span) * 100;
    down[i] = ((span - (i - loIdx)) / span) * 100;
  }
  return { up, down };
};

// Chaikin Money Flow
export const cmfSeries = (data, period = 20) => {
  const mfv = data.map(b => {
    const range = _hi(b) - _lo(b);
    if (range === 0) return 0;
    return ((_cl(b) - _lo(b)) - (_hi(b) - _cl(b))) / range * _vo(b);
  });
  const out = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - period + 1);
    let n = 0, d = 0;
    for (let j = start; j <= i; j++) { n += mfv[j]; d += _vo(data[j]); }
    out[i] = d === 0 ? 0 : n / d;
  }
  return out;
};

// Choppiness Index — 0 (trending) to 100 (sideways)
export const choppinessSeries = (data, period = 14) => {
  const out = new Array(data.length).fill(50);
  const atr = atrSeries(data, 1); // single-bar TR
  for (let i = period; i < data.length; i++) {
    let hi = -Infinity, lo = Infinity, sumTR = 0;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, _hi(data[j]));
      lo = Math.min(lo, _lo(data[j]));
      sumTR += atr[j];
    }
    const range = hi - lo;
    if (range <= 0) { out[i] = 50; continue; }
    out[i] = 100 * Math.log10(sumTR / range) / Math.log10(period);
  }
  return out;
};
