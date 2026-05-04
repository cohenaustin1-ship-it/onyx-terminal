// ─── Indicator math — server-side ─────────────────────────────────────────
//
// Ported from the bot.js reference implementation. All functions take a
// closes[] array (most recent at index N-1) and return a single number
// (the current value). For series rendering we'd return arrays, but the
// executor only needs the current bar.

export function ema(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
  }
  return val;
}

export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function vwap(bars) {
  // bars: [{ price, volume }, ...] for the current session
  let pv = 0, v = 0;
  for (const b of bars) {
    pv += b.price * b.volume;
    v += b.volume;
  }
  return v > 0 ? pv / v : null;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  // Returns { macd, signal, histogram } using the latest bar.
  // Note: signal is a simple EMA of MACD values, so we need to compute
  // the MACD series first.
  if (closes.length < slow + signal) return null;
  const macdSeries = [];
  for (let i = slow - 1; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1);
    macdSeries.push(ema(slice, fast) - ema(slice, slow));
  }
  const macdVal = macdSeries[macdSeries.length - 1];
  const signalVal = ema(macdSeries, signal);
  return {
    macd: macdVal,
    signal: signalVal,
    histogram: macdVal - signalVal,
  };
}

export function atr(bars, period = 14) {
  // bars: [{ high, low, close }, ...]
  if (bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    );
    trs.push(tr);
  }
  // simple average of last N TRs
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

export function bollinger(closes, period = 20, stddev = 2) {
  if (closes.length < period) return null;
  const recent = closes.slice(-period);
  const mid = recent.reduce((a, b) => a + b, 0) / period;
  const variance = recent.reduce((acc, x) => acc + (x - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return {
    upper: mid + stddev * sd,
    middle: mid,
    lower: mid - stddev * sd,
  };
}

// Compute every indicator referenced in entry rules, returning a flat dict.
// The safety checker uses this to evaluate rule expressions.
export function computeIndicators(bars) {
  const closes = bars.map(b => b.close);
  const lastPrice = closes[closes.length - 1];
  const lastBar   = bars[bars.length - 1];
  const result = {
    price:   lastPrice,
    high:    lastBar?.high,
    low:     lastBar?.low,
    open:    lastBar?.open,
    volume:  lastBar?.volume,
  };
  // EMAs
  for (const p of [8, 13, 20, 50, 100, 200]) {
    if (closes.length >= p) result[`ema_${p}`] = ema(closes, p);
  }
  // RSIs
  for (const p of [3, 7, 14]) {
    if (closes.length >= p + 1) result[`rsi_${p}`] = rsi(closes, p);
  }
  // VWAP — uses current session bars (caller decides session boundary)
  result.vwap = vwap(bars.map(b => ({ price: b.close, volume: b.volume || 0 })));
  // MACD
  const m = macd(closes);
  if (m) {
    result.macd_line   = m.macd;
    result.macd_signal = m.signal;
    result.macd_hist   = m.histogram;
  }
  // Bollinger
  const b = bollinger(closes);
  if (b) {
    result.bb_upper  = b.upper;
    result.bb_middle = b.middle;
    result.bb_lower  = b.lower;
  }
  // ATR
  const a = atr(bars);
  if (a !== null) result.atr = a;
  return result;
}
