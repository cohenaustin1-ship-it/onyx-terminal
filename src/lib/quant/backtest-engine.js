// IMO Onyx Terminal — backtest engine + strategy runners module
//
// Phase 3o.94 (file split, batch 6): extracted from JPMOnyxTerminal.jsx.
// Single-asset backtest engine plus the AI QUANT LAB strategy primitives
// + factor library + multi-mode runners (walk-forward, Monte Carlo
// permutation, cross-sectional, pair-trade, seasonal).
//
// This is the largest module in the migration so far — combines what
// were two separated blocks in the monolith (basic backtest helpers
// near line 96k, then the strategy infrastructure near line 110k).
// They belong together because QUANT_PRIMITIVES uses _btSma/_btRsi
// and runWalkForward/runMonteCarloPermutation/etc. all call runBacktest.
//
// Internal helpers (not exported):
//   _btSma(bars, i, w)            — simple moving average at index i
//   _btRsi(bars, i, w)            — Wilder RSI
//
// Public exports:
//   runBacktest({ bars, strategy, capital, sizing, sizingParam, costs, ctx })
//     → { equity, stats, trades }
//     Single-asset backtest engine. Strategy can be a string keyword
//     ('sma-crossover', 'rsi-mean-rev', ...) or a function
//     (bars, i, ctx) → 'enter' | 'exit' | 'hold'. Position sizing
//     models: 'all-in', 'fixed', 'voltarget', 'kelly'. Costs model
//     supports per-fill basis-point fees + slippage.
//
//   QUANT_PRIMITIVES                — registry of (bars, i) → number
//                                     primitives (sma, rsi, mom, roc,
//                                     obv, atr, stoch, bollinger,
//                                     volZ, returns, ...)
//   FACTOR_LIBRARY                  — curated list of trading factors
//                                     (momentum, mean-reversion, vol,
//                                     volume, carry, ...) each with a
//                                     signal function and metadata
//   buildCompositeStrategy(factors, threshold, hysteresis)
//     → strategy function           Combines weighted factors into a
//                                   single entry/exit signal with
//                                   threshold + hysteresis.
//
//   runWalkForward({ bars, strategy, splitRatio, ...rest })
//     → { in: stats, out: stats, trades, equity }
//     Train/test split walk-forward analysis. Strategy params optimized
//     on the in-sample, performance evaluated on out-of-sample.
//
//   runMonteCarloPermutation({ bars, strategy, runs, ... })
//     → { observed, percentile, distribution }
//     Permutes return series and re-runs the strategy to test if the
//     observed performance is statistically significant vs random.
//
//   runCrossSectional({ barsByTicker, factor, longPct, shortPct })
//     → { equity, stats, exposureTimeline }
//     Long-top / short-bottom percentile strategy across a universe.
//
//   runPairTrade({ ySeries, xSeries, ... })
//     → { equity, stats, trades }
//     Z-score-driven pairs trading on a synthetic spread.
//
//   runSeasonalStrategy({ bars, monthsLong, monthsShort })
//     → { equity, stats, trades }
//     Calendar-anchored buy/sell rules (month-of-year etc).
//
//   computeCorrelationMatrix(barsByTicker)
//     → { tickers, matrix }         Pairwise return correlations.
//   renderCorrelationHeatmapSVG(corrResult, opts)
//     → SVG string                  Static heat-map of the matrix.

// Compute SMA at index i with window w
const _btSma = (bars, i, w) => {
  if (i < w - 1) return null;
  let s = 0;
  for (let k = i - w + 1; k <= i; k++) s += bars[k].close;
  return s / w;
};

// Compute Wilder RSI at index i with window w
const _btRsi = (bars, i, w = 14) => {
  if (i < w) return null;
  let gains = 0, losses = 0;
  for (let k = i - w + 1; k <= i; k++) {
    const ch = bars[k].close - bars[k - 1].close;
    if (ch > 0) gains += ch; else losses -= ch;
  }
  const avgG = gains / w, avgL = losses / w;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
};

// Run backtest — returns { equity[], stats, trades[] }
// runBacktest — single-asset backtest engine.
//
// Parameters:
//   bars     — [{ t, open, high, low, close, volume }, ...]
//   strategy — string keyword OR (bars, i, ctx) => 'enter'|'exit'|'hold'
//   capital  — starting cash (default 10_000)
//   sizing   — position sizing model. Either:
//                'all-in'    — use all cash on enter (default; legacy)
//                'fixed'     — fixed fraction (sizingParam = fraction 0-1)
//                'voltarget' — vol-target sizing (sizingParam = annualized
//                              vol target in %; e.g. 15 = 15% target).
//                              Position size = capital × volTarget /
//                              realized_vol_at_entry.
//                'kelly'     — half-Kelly heuristic from rolling win-rate
//                              and win/loss ratio. Capped at sizingParam
//                              (default 0.5 fraction).
//              Sizing only applies on entries; exits always close the
//              full position.
//   sizingParam — the parameter for the chosen model (see above).
//   costs    — transaction cost model:
//                { feeBps:  basis points per fill (default 0)
//                  slippageBps: basis points slippage per fill (default 0) }
//              Fees deducted from cash on entry; both fees + slippage
//              degrade the effective fill price.
//   ctx      — optional caller-supplied context object passed through to
//              function-mode strategies (so callers can stash extra state
//              like indicator series).
//
// Return shape is flat-with-nested-stats so old callers (BacktestPage)
// can keep destructuring `stats` and new ones (QuantLabPage) can read
// fields directly.
export const runBacktest = ({
  bars,
  strategy,
  capital = 10000,
  sizing = 'all-in',
  sizingParam = null,
  costs = null,
  ctx: callerCtx = null,
}) => {
  const n = bars.length;
  const feeBps      = costs?.feeBps      || 0;
  const slippageBps = costs?.slippageBps || 0;
  let cash = capital;
  let pos = 0;          // shares
  let entryPx = 0;
  const equity = [];
  const trades = [];
  // Rolling stats for Kelly sizing — last 20 trades' wins/losses.
  const recentTrades = [];

  // Compute the share count for an entry given the chosen sizing model.
  // Returns shares to buy. Caller deducts fees from cash separately.
  const sizeFor = (i, price) => {
    if (sizing === 'fixed') {
      const frac = Math.min(1, Math.max(0, Number(sizingParam) || 0.25));
      return (cash * frac) / price;
    }
    if (sizing === 'voltarget') {
      // sizingParam = annualized target vol in % (default 15)
      const target = Number(sizingParam) || 15;
      const realized = QUANT_PRIMITIVES.vol(bars, i, 20);
      if (!realized || realized <= 0) return cash / price; // fall back to all-in
      // size fraction = target / realized, clipped to [0.05, 1]
      const frac = Math.min(1, Math.max(0.05, (target / 100) / realized));
      return (cash * frac) / price;
    }
    if (sizing === 'kelly') {
      // Half-Kelly with Bayesian shrinkage toward a conservative prior.
      // Why shrink: empirical Kelly is HIGH-variance on small samples.
      // After 5 trades with W=80% the naive estimate is wildly optimistic
      // — could easily flip to 20% with bad luck. We shrink toward a
      // "default" of W=0.5, R=1 (which gives fStar=0) by sample weight.
      //
      //   posterior_W = (n/(n+k))*W_obs + (k/(n+k))*W_prior
      //   posterior_R = (n/(n+k))*R_obs + (k/(n+k))*R_prior
      //
      // Where k is the prior strength (we use k=10, meaning we trust
      // observed data 50/50 with the prior at 10 trades; mostly trust
      // observed at 50+ trades). This is essentially a Beta(α=5, β=5)
      // prior on win-rate.
      const cap = Number(sizingParam) || 0.5;
      if (recentTrades.length < 5) return (cash * cap * 0.5) / price; // warmup
      const wins = recentTrades.filter(t => t > 0);
      const losses = recentTrades.filter(t => t < 0).map(Math.abs);
      const n = recentTrades.length;
      const k = 10; // prior strength
      const W_prior = 0.5, R_prior = 1.0;
      const W_obs = wins.length / n;
      const avgW = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
      const avgL = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 1;
      const R_obs = avgL > 0 ? avgW / avgL : 1;
      // Bayesian shrinkage toward prior
      const w = n / (n + k);
      const W = w * W_obs + (1 - w) * W_prior;
      const R = w * R_obs + (1 - w) * R_prior;
      const fStar = R > 0 ? Math.max(0, W - ((1 - W) / R)) : 0;
      const frac = Math.min(cap, fStar * 0.5); // half-Kelly
      return (cash * frac) / price;
    }
    // 'all-in' or unknown — use all cash
    return cash / price;
  };

  const enter = (i, price) => {
    // Slippage drives the effective fill price up on a buy.
    const fillPx = price * (1 + slippageBps / 10000);
    const shares = sizeFor(i, fillPx);
    if (shares <= 0) return;
    const notional = shares * fillPx;
    const fee = notional * (feeBps / 10000);
    if (cash < notional + fee) return; // can't afford
    cash -= notional + fee;
    pos = shares;
    entryPx = fillPx;
  };
  const exit = (i, price) => {
    if (pos === 0) return;
    // Slippage drives the effective fill price down on a sell.
    const fillPx = price * (1 - slippageBps / 10000);
    const notional = pos * fillPx;
    const fee = notional * (feeBps / 10000);
    cash += notional - fee;
    const pnl = pos * (fillPx - entryPx) - fee; // includes both round-trip
    trades.push({
      idx: i, entry: entryPx, exit: fillPx,
      pnl, pnlPct: (fillPx - entryPx) / entryPx,
    });
    recentTrades.push(pnl);
    if (recentTrades.length > 20) recentTrades.shift();
    pos = 0;
    entryPx = 0;
  };

  // Strategy can be either:
  //   - a string keyword ('buyhold', 'sma', 'rsi', 'donchian',
  //     'voltarget') matching the canned strategies below
  //   - a function (bars, i, ctx) => 'enter'|'exit'|'hold'
  //     for arbitrary signals (used by the AI Quant Lab)
  // Function-mode strategies receive a `ctx` with the current
  // position state so they can decide whether to enter / exit.
  const isFunctionStrategy = typeof strategy === 'function';

  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    const px = bar.close;

    let signal = 'hold';

    if (isFunctionStrategy) {
      try {
        signal = strategy(bars, i, { pos, entryPx, cash, capital, ...(callerCtx || {}) }) || 'hold';
      } catch {
        signal = 'hold';
      }
    } else if (strategy === 'buyhold') {
      if (i === 0) signal = 'enter';
    } else if (strategy === 'sma') {
      const fast = _btSma(bars, i, 20);
      const slow = _btSma(bars, i, 50);
      const fastPrev = _btSma(bars, i - 1, 20);
      const slowPrev = _btSma(bars, i - 1, 50);
      if (fast && slow && fastPrev && slowPrev) {
        const crossUp = fastPrev <= slowPrev && fast > slow;
        const crossDn = fastPrev >= slowPrev && fast < slow;
        if (crossUp && pos === 0) signal = 'enter';
        else if (crossDn && pos > 0) signal = 'exit';
      }
    } else if (strategy === 'rsi') {
      const r = _btRsi(bars, i);
      if (r != null) {
        if (r < 30 && pos === 0) signal = 'enter';
        else if (r > 50 && pos > 0) signal = 'exit';
      }
    } else if (strategy === 'donchian') {
      const w = 20;
      if (i >= w) {
        let hi = -Infinity, lo = Infinity;
        for (let k = i - w; k < i; k++) {
          if (bars[k].close > hi) hi = bars[k].close;
          if (bars[k].close < lo) lo = bars[k].close;
        }
        if (px > hi && pos === 0) signal = 'enter';
        else if (px < lo && pos > 0) signal = 'exit';
      }
    } else if (strategy === 'voltarget') {
      // Always long; "size" is implicit since we go all-in. Treat as buy & hold variant.
      if (i === 0) signal = 'enter';
    }

    if (signal === 'enter' && pos === 0) enter(i, px);
    else if (signal === 'exit' && pos > 0) exit(i, px);

    const eq = cash + pos * px;
    equity.push({ idx: i, t: bar.t, equity: eq });
  }
  // Force-close any open position at end
  if (pos > 0) exit(n - 1, bars[n - 1].close);

  // Stats
  const startEq = equity[0]?.equity ?? capital;
  const endEq   = equity[equity.length - 1]?.equity ?? capital;
  const totalReturn = (endEq - startEq) / startEq;
  const years = n / 252;
  const cagr = years > 0 ? Math.pow(endEq / startEq, 1 / years) - 1 : 0;

  // Daily returns
  const rets = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1].equity;
    if (prev > 0) rets.push((equity[i].equity - prev) / prev);
  }
  const meanRet = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length ? rets.reduce((a, b) => a + (b - meanRet) ** 2, 0) / rets.length : 0;
  const stdRet = Math.sqrt(variance);
  const sharpe = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(252) : 0;
  // Sortino — downside-only deviation, so a strategy that's volatile
  // only on the upside doesn't get penalized.
  const downsideRets = rets.filter(r => r < 0);
  const downStd = downsideRets.length
    ? Math.sqrt(downsideRets.reduce((a, b) => a + b * b, 0) / downsideRets.length)
    : 0;
  const sortino = downStd > 0 ? (meanRet / downStd) * Math.sqrt(252) : 0;

  // Max drawdown
  let peak = equity[0]?.equity ?? capital;
  let maxDD = 0;
  const ddSeries = equity.map(e => {
    if (e.equity > peak) peak = e.equity;
    const dd = peak > 0 ? (e.equity - peak) / peak : 0;
    if (dd < maxDD) maxDD = dd;
    return { idx: e.idx, t: e.t, dd };
  });

  const winners = trades.filter(t => t.pnl > 0).length;
  const winRate = trades.length ? winners / trades.length : 0;
  const avgWin = winners > 0 ? trades.filter(t => t.pnl > 0).reduce((a, b) => a + b.pnl, 0) / winners : 0;
  const avgLoss = (trades.length - winners) > 0 ? trades.filter(t => t.pnl <= 0).reduce((a, b) => a + b.pnl, 0) / (trades.length - winners) : 0;
  const profitFactor = avgLoss < 0 ? Math.abs((avgWin * winners) / (avgLoss * (trades.length - winners))) : 0;

  // Build the result with both flat fields and nested stats so
  // both old callers (BacktestPage destructuring stats) and new
  // ones (QuantLabPage reading flat fields) work.
  const result = {
    equity, ddSeries, trades,
    // Flat fields (QuantLabPage)
    totalReturn, cagr, sharpe, sortino, maxDrawdown: maxDD,
    winRate, profitFactor, nTrades: trades.length, endEq, startEq,
    // Nested stats (BacktestPage compatibility)
    stats: {
      totalReturn, cagr, sharpe, sortino, maxDD,
      winRate, profitFactor, nTrades: trades.length, endEq, startEq,
    },
  };
  return result;
};


// ════════════════════════════════════════════════════════════════════
// AI QUANT LAB
// ════════════════════════════════════════════════════════════════════
//
// Three-mode lab for quantitative strategy R&D.
//
//   1. Factor Discovery — describe a hypothesis in natural language;
//      AI proposes signal formulas using a small DSL of price/volume
//      primitives. Each proposal is automatically backtested on the
//      selected ticker over the visible window. Results ranked by
//      Sharpe.
//
//   2. Strategy Builder — pick factors (from discovery results or
//      from a curated library), assign weights, set entry threshold.
//      Composite signal triggers entry when weighted sum exceeds the
//      threshold; exits when it drops back below.
//
//   3. RL Sandbox — toy reinforcement-learning environment that
//      shows a Q-learning agent learning a simple buy/hold/sell
//      policy on real OHLC data. Toy-grade since real RL training
//      would need a backend with episode replay, GPU sampling, etc.
//      Ships as an educational visualization, not a serious tool.
//
// Reuses the runBacktest engine (extended in this drop to accept
// function-based strategies). All three modes write into the same
// equity-curve / trades / Sharpe pipeline so results are
// directly comparable.

// Quant signal primitives — each is a (bars, i) → number (or null).
// AI factor proposals are expressed as combinations of these.
// Same shape as _btSma/_btRsi but exposed as a registry.
export const QUANT_PRIMITIVES = {
  sma:    (bars, i, w = 20) => _btSma(bars, i, w),
  rsi:    (bars, i, w = 14) => _btRsi(bars, i, w),
  // Returns the bar's close price.
  close:  (bars, i) => bars[i]?.close ?? null,
  // Volume z-score over a lookback window — measures unusual volume.
  volz:   (bars, i, w = 20) => {
    if (i < w) return null;
    let sum = 0; for (let k = i - w; k < i; k++) sum += bars[k].volume || 0;
    const mean = sum / w;
    let varSum = 0; for (let k = i - w; k < i; k++) varSum += ((bars[k].volume || 0) - mean) ** 2;
    const std = Math.sqrt(varSum / w);
    return std > 0 ? (((bars[i].volume || 0) - mean) / std) : 0;
  },
  // Momentum: return over the past w bars
  mom:    (bars, i, w = 20) => {
    if (i < w) return null;
    const past = bars[i - w]?.close;
    if (!past) return null;
    return (bars[i].close - past) / past;
  },
  // Realized volatility over w bars
  vol:    (bars, i, w = 20) => {
    if (i < w) return null;
    const rets = [];
    for (let k = i - w + 1; k <= i; k++) {
      const prev = bars[k - 1]?.close;
      if (prev) rets.push((bars[k].close - prev) / prev);
    }
    if (rets.length < 2) return null;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    return Math.sqrt(v) * Math.sqrt(252);
  },
  // High-low range as a fraction of close — proxy for intraday vol
  range:  (bars, i) => {
    const b = bars[i]; if (!b?.close) return null;
    return ((b.high || b.close) - (b.low || b.close)) / b.close;
  },
  // Exponential moving average — recursive on close, alpha = 2/(w+1).
  // Cached on bars[i].__ema_w to avoid recomputing for every i.
  ema:    (bars, i, w = 20) => {
    if (i < 0 || i >= bars.length) return null;
    const key = `__ema_${w}`;
    if (bars[i][key] != null) return bars[i][key];
    const alpha = 2 / (w + 1);
    let prev = null;
    for (let k = 0; k <= i; k++) {
      if (bars[k][key] != null) { prev = bars[k][key]; continue; }
      if (k < w - 1) { bars[k][key] = null; continue; }
      if (k === w - 1) {
        // Seed with SMA of first w bars
        let sum = 0; for (let j = 0; j < w; j++) sum += bars[j].close;
        prev = sum / w;
      } else {
        prev = (bars[k].close - prev) * alpha + prev;
      }
      bars[k][key] = prev;
    }
    return bars[i][key];
  },
  // MACD — returns { macd, signal, hist }. fast=12, slow=26, signal=9
  // are conventional. Returns null if insufficient bars.
  macd:   (bars, i, fast = 12, slow = 26, sig = 9) => {
    if (i < slow + sig) return null;
    const fastEma = QUANT_PRIMITIVES.ema(bars, i, fast);
    const slowEma = QUANT_PRIMITIVES.ema(bars, i, slow);
    if (fastEma == null || slowEma == null) return null;
    const macd = fastEma - slowEma;
    // Signal line = EMA of MACD itself, computed pointwise here
    // (we don't cache the macd-series since it's only used inside
    // this primitive in current callers).
    let sigSum = 0;
    for (let k = i - sig + 1; k <= i; k++) {
      const fe = QUANT_PRIMITIVES.ema(bars, k, fast);
      const se = QUANT_PRIMITIVES.ema(bars, k, slow);
      if (fe == null || se == null) return null;
      sigSum += (fe - se);
    }
    const signal = sigSum / sig;
    return { macd, signal, hist: macd - signal };
  },
  // Bollinger bands — { upper, middle, lower, width, pctB }.
  // Standard 20/2 (window=20, stdev multiplier=2).
  bb:     (bars, i, w = 20, k = 2) => {
    const m = _btSma(bars, i, w);
    if (m == null || i < w - 1) return null;
    let varSum = 0;
    for (let j = i - w + 1; j <= i; j++) varSum += (bars[j].close - m) ** 2;
    const std = Math.sqrt(varSum / w);
    const upper = m + k * std;
    const lower = m - k * std;
    const width = (upper - lower) / m;     // BB width as % of price
    const pctB  = std > 0 ? (bars[i].close - lower) / (upper - lower) : 0.5;
    return { upper, middle: m, lower, width, pctB };
  },
  // Average True Range — w-bar smoothed True Range. Standard w=14.
  atr:    (bars, i, w = 14) => {
    if (i < w) return null;
    let sumTr = 0;
    for (let k = i - w + 1; k <= i; k++) {
      const b = bars[k];
      const prev = bars[k - 1];
      if (!b || !prev) return null;
      const tr = Math.max(
        (b.high || b.close) - (b.low || b.close),
        Math.abs((b.high || b.close) - prev.close),
        Math.abs((b.low  || b.close) - prev.close),
      );
      sumTr += tr;
    }
    return sumTr / w;
  },
  // Stochastic oscillator — { k, d } (fast %K + 3-bar %D smoothing).
  // %K = 100 * (close - low_w) / (high_w - low_w) over window.
  stoch:  (bars, i, w = 14, smoothD = 3) => {
    if (i < w + smoothD) return null;
    const computeK = (idx) => {
      let hi = -Infinity, lo = Infinity;
      for (let k = idx - w + 1; k <= idx; k++) {
        if (bars[k].high > hi) hi = bars[k].high;
        if (bars[k].low  < lo) lo = bars[k].low;
      }
      return hi > lo ? 100 * (bars[idx].close - lo) / (hi - lo) : 50;
    };
    const kNow = computeK(i);
    let dSum = 0;
    for (let k = i - smoothD + 1; k <= i; k++) dSum += computeK(k);
    return { k: kNow, d: dSum / smoothD };
  },
  // Rate of change — % change vs w bars ago. Like mom but expressed
  // as a percentage (multiply by 100).
  roc:    (bars, i, w = 12) => {
    const m = QUANT_PRIMITIVES.mom(bars, i, w);
    return m == null ? null : m * 100;
  },
  // On-Balance Volume — running cumulative volume signed by close
  // direction. Cached on bars[i].__obv. Useful as a divergence signal.
  obv:    (bars, i) => {
    if (i < 0 || i >= bars.length) return null;
    if (bars[i].__obv != null) return bars[i].__obv;
    let cum = 0;
    for (let k = 0; k <= i; k++) {
      if (k === 0) {
        bars[k].__obv = 0;
      } else {
        const prev = bars[k - 1].close;
        const cur  = bars[k].close;
        const v    = bars[k].volume || 0;
        cum = bars[k - 1].__obv + (cur > prev ? v : cur < prev ? -v : 0);
        bars[k].__obv = cum;
      }
    }
    return bars[i].__obv;
  },
};

// Curated factor library — pre-built signals users can pick from
// without going through factor discovery. Each has a `signal`
// function that returns a normalized score (-1 to +1, where +1 is
// strong long bias).
export const FACTOR_LIBRARY = [
  {
    id: 'momentum-20',
    label: 'Momentum (20-day)',
    description: '20-bar return; positive = uptrend.',
    signal: (bars, i) => {
      const m = QUANT_PRIMITIVES.mom(bars, i, 20);
      if (m == null) return 0;
      return Math.max(-1, Math.min(1, m * 5)); // scale ~20% return → 1.0
    },
  },
  {
    id: 'mean-reversion-rsi',
    label: 'Mean reversion (RSI)',
    description: 'RSI inverted: oversold = positive long bias.',
    signal: (bars, i) => {
      const r = QUANT_PRIMITIVES.rsi(bars, i);
      if (r == null) return 0;
      // 30 → +1, 50 → 0, 70 → -1
      return Math.max(-1, Math.min(1, (50 - r) / 20));
    },
  },
  {
    id: 'sma-trend',
    label: 'Trend (SMA20 / SMA50)',
    description: 'Above 50-day SMA = positive trend score.',
    signal: (bars, i) => {
      const fast = QUANT_PRIMITIVES.sma(bars, i, 20);
      const slow = QUANT_PRIMITIVES.sma(bars, i, 50);
      if (!fast || !slow) return 0;
      return Math.max(-1, Math.min(1, ((fast - slow) / slow) * 20));
    },
  },
  {
    id: 'volume-spike',
    label: 'Volume spike',
    description: 'Unusual volume z-score; high vol can confirm breakouts.',
    signal: (bars, i) => {
      const z = QUANT_PRIMITIVES.volz(bars, i, 20);
      if (z == null) return 0;
      return Math.max(-1, Math.min(1, z / 3));
    },
  },
  {
    id: 'low-vol-regime',
    label: 'Low-vol regime',
    description: 'Realized vol below historical avg — suggests stable trend.',
    signal: (bars, i) => {
      const v20 = QUANT_PRIMITIVES.vol(bars, i, 20);
      const v60 = QUANT_PRIMITIVES.vol(bars, i, 60);
      if (!v20 || !v60) return 0;
      // Lower current vol = higher score
      return Math.max(-1, Math.min(1, (v60 - v20) / v60 * 2));
    },
  },
];

// Build a function-based strategy from a list of weighted factors.
// Composite score = Σ(weight × factor.signal). Enter when score
// crosses above threshold; exit when below threshold - hysteresis.
export const buildCompositeStrategy = (factors, threshold = 0.3, hysteresis = 0.1) => {
  // Cache factor lookups by id so we don't recompute the lookup each bar
  const resolved = factors.map(f => ({
    weight: Number(f.weight) || 0,
    fn: FACTOR_LIBRARY.find(lib => lib.id === f.id)?.signal,
  })).filter(f => f.fn);
  return (bars, i, ctx) => {
    if (resolved.length === 0) return 'hold';
    let totalWeight = 0;
    let weightedScore = 0;
    for (const f of resolved) {
      const s = f.fn(bars, i);
      if (s != null && Number.isFinite(s)) {
        weightedScore += s * f.weight;
        totalWeight += Math.abs(f.weight);
      }
    }
    if (totalWeight === 0) return 'hold';
    const score = weightedScore / totalWeight;
    if (ctx.pos === 0 && score > threshold) return 'enter';
    if (ctx.pos > 0 && score < threshold - hysteresis) return 'exit';
    return 'hold';
  };
};

// Toy Q-learning agent for the RL sandbox. State: discretized
// (RSI bucket, trend bucket, position). Actions: hold/buy/sell.
// Reward: change in equity each bar. Pure educational visualization
// — not meant to produce alpha.
// runWalkForward — split bars into in-sample (IS) and out-of-sample
// (OOS) segments, run the strategy on each, return both results so
// callers can compare. Useful for detecting overfit: if IS Sharpe is
// 2.5 and OOS Sharpe is 0.1, the strategy is curve-fit.
//
// Args:
//   bars     — full bar series
//   strategy — function-mode strategy (string keywords work too)
//   options  — { capital, sizing, sizingParam, costs, splitRatio }
// Returns:
//   { is: { ... runBacktest result }, oos: { ... }, splitIdx, summary }
export const runWalkForward = ({ bars, strategy, splitRatio = 0.7, ...rest }) => {
  const n = bars.length;
  const splitIdx = Math.floor(n * splitRatio);
  const isBars  = bars.slice(0, splitIdx);
  const oosBars = bars.slice(splitIdx);
  const is  = runBacktest({ bars: isBars,  strategy, ...rest });
  const oos = runBacktest({ bars: oosBars, strategy, ...rest });
  // Overfit score — ratio of OOS Sharpe to IS Sharpe. Closer to 1 is
  // good; near 0 or negative means the strategy doesn't generalize.
  const overfitRatio = is.sharpe > 0
    ? oos.sharpe / is.sharpe
    : oos.sharpe; // when IS sharpe non-positive, just surface OOS
  return {
    is, oos, splitIdx,
    summary: {
      isStartT:  bars[0]?.t,
      isEndT:    bars[splitIdx - 1]?.t,
      oosStartT: bars[splitIdx]?.t,
      oosEndT:   bars[n - 1]?.t,
      isSharpe:  is.sharpe,
      oosSharpe: oos.sharpe,
      overfitRatio,
      verdict:
        overfitRatio > 0.7 ? 'robust' :
        overfitRatio > 0.3 ? 'modest-decay' :
        overfitRatio > 0   ? 'fragile' : 'broken',
    },
  };
};

// runMonteCarloPermutation — bootstrap-style significance test for
// strategies. The hypothesis we're testing: "Is this strategy's edge
// real, or could random luck on this exact path explain it?"
//
// Method:
//   1. Run the strategy on the actual bars → real Sharpe.
//   2. For each permutation, shuffle the BAR-TO-BAR returns to break
//      time-series structure while keeping the return distribution.
//      Reconstruct synthetic bars from the shuffled returns starting
//      at the original close.
//   3. Run the same strategy on the synthetic bars → null Sharpe.
//   4. p-value = fraction of null Sharpes >= real Sharpe.
//
// If the real Sharpe is at the 95th percentile of null Sharpes,
// p ≈ 0.05 — strong evidence the edge isn't random. p > 0.20
// suggests the strategy is no better than random on this dataset.
//
// Costs: O(n_perms × backtest_cost). 100 permutations on 250 bars
// runs in ~1-3 seconds for typical strategies. Async via setTimeout
// chunking so the UI stays responsive.
export const runMonteCarloPermutation = async ({
  bars, strategy, nPerms = 100, onProgress = null, ...rest
} = {}) => {
  if (!bars || bars.length < 30) {
    return { error: 'Need at least 30 bars', perms: [] };
  }
  // Real Sharpe on actual bars
  const real = runBacktest({ bars, strategy, ...rest });
  // Compute bar-to-bar returns
  const rets = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    if (prev > 0) rets.push(bars[i].close / prev);
  }
  // Run permutations
  const nullSharpes = [];
  const nullReturns = [];
  for (let p = 0; p < nPerms; p++) {
    // Fisher-Yates shuffle
    const shuffled = rets.slice();
    for (let k = shuffled.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
    }
    // Rebuild synthetic bars: start at first close, multiply by
    // shuffled returns. Preserve volume too (shuffled or not — the
    // simple choice is to just keep the original volumes since they
    // don't affect most strategies' enter/exit logic).
    const synthBars = [bars[0]];
    for (let i = 0; i < shuffled.length; i++) {
      const prev = synthBars[i].close;
      const next = prev * shuffled[i];
      const orig = bars[i + 1];
      synthBars.push({
        t:    orig.t,
        open: prev,                     // use prior close as open
        high: Math.max(prev, next),
        low:  Math.min(prev, next),
        close: next,
        volume: orig.volume,
      });
    }
    const synthResult = runBacktest({ bars: synthBars, strategy, ...rest });
    nullSharpes.push(synthResult.sharpe);
    nullReturns.push(synthResult.totalReturn);
    if (onProgress) onProgress(p + 1, nPerms);
    // Yield to event loop every 10 perms
    if (p % 10 === 9) await new Promise(r => setTimeout(r, 0));
  }
  // p-values: fraction of null >= real (one-sided)
  const sharpePValue = nullSharpes.filter(s => s >= real.sharpe).length / nPerms;
  const returnPValue = nullReturns.filter(s => s >= real.totalReturn).length / nPerms;
  // Percentile of real result within null distribution
  nullSharpes.sort((a, b) => a - b);
  const sharpePercentile = nullSharpes.findIndex(s => s >= real.sharpe);
  const realSharpePctile = sharpePercentile === -1 ? 100 : (sharpePercentile / nPerms) * 100;
  return {
    real,
    nullSharpes,
    nullReturns,
    nPerms,
    sharpePValue,
    returnPValue,
    realSharpePctile,
    verdict:
      sharpePValue < 0.05 ? 'significant'         // < 5% — strong edge
      : sharpePValue < 0.10 ? 'marginal'          // < 10% — suggestive
      : sharpePValue < 0.20 ? 'weak'              // < 20% — leaning real
      :                       'no-edge',          // >= 20% — likely random
  };
};

// runCrossSectional — multi-asset strategy where the signal ranks
// a basket of tickers each bar, longs the top N, shorts the bottom
// N (or just longs the top, depending on `mode`).
//
// Args:
//   barsByTicker — { [ticker]: [{ t, ... }] }   pre-aligned bar series
//   factor       — (bars, i) => number          single-asset factor
//                                               that returns a score
//   options      — { mode: 'long-only'|'long-short',
//                    quintile: number (default 0.2 = top 20%),
//                    capital, costs, rebalance: 'weekly'|'monthly'|'daily' }
// Returns:
//   { equity, trades, ... } in the same shape as runBacktest
//
// Important caveat: this assumes the ticker bar series have already
// been aligned on a common date axis (same length, same indices map
// to same dates). The Quant Lab fetches and aligns when the user
// submits a basket; misaligned data is the caller's responsibility.
export const runCrossSectional = ({
  barsByTicker,
  factor,
  mode = 'long-only',
  quintile = 0.2,
  capital = 10000,
  costs = null,
  rebalance = 'weekly',
  // Cross-section enhancements:
  //   sectorMap        — { ticker → sectorId } for sector neutralization
  //                      (z-normalize within sector instead of across all tickers)
  //   rankIcWeighting  — when true, factor composite uses each factor's
  //                      rolling rank-IC as its weight instead of the
  //                      user-specified weight. Recomputes from the
  //                      last `rankIcWindow` rebalance periods.
  //   rankIcWindow     — number of past rebalance periods to use (default 12)
  sectorMap = null,
  rankIcWeighting = false,
  rankIcWindow = 12,
} = {}) => {
  const tickers = Object.keys(barsByTicker);
  if (tickers.length < 5) {
    return { error: `Need at least 5 tickers, got ${tickers.length}`, equity: [], trades: [] };
  }
  const n = Math.min(...tickers.map(t => barsByTicker[t].length));
  if (n === 0) return { error: 'No bars', equity: [], trades: [] };
  const feeBps = costs?.feeBps || 0;
  const slipBps = costs?.slippageBps || 0;
  // Per-ticker book — tracks current weight (-1, 0, +1) for each.
  let positions = {};       // ticker → { weight, shares, entryPx }
  let cash = capital;
  let equity = capital;
  const equityCurve = [];
  const trades = [];
  // Rebalance cadence — number of bars between rebalances
  const rebalanceEvery = rebalance === 'daily' ? 1
                       : rebalance === 'weekly' ? 5
                       : rebalance === 'monthly' ? 21
                       : 5;
  const topN = Math.max(1, Math.floor(tickers.length * quintile));

  // Track per-factor rank-IC history when rankIcWeighting is enabled.
  // At each rebalance: store [factorScores, forwardReturns] for each
  // factor. After enough history we compute Spearman rank correlation
  // between each factor's scores and the realized forward returns,
  // and use that as the factor's weight in the composite.
  // Shape: factorIcHistory[fIdx] = [{ rankIc, n }, ...]
  const factorIcHistory = [];
  // For each rebalance, save the (scores, prevPrices) needed to compute
  // forward IC at the next rebalance.
  let pendingIc = null; // { perFactor: [{ scores, tickerOrder }], priceAt: { ticker → price } }

  // Helper: Spearman rank correlation
  const spearmanCorr = (xs, ys) => {
    if (xs.length !== ys.length || xs.length < 3) return 0;
    const rank = (arr) => {
      const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
      const ranks = new Array(arr.length);
      for (let i = 0; i < idx.length; i++) ranks[idx[i].i] = i + 1;
      return ranks;
    };
    const rx = rank(xs);
    const ry = rank(ys);
    const m = rx.length;
    let sumX = 0, sumY = 0;
    for (let i = 0; i < m; i++) { sumX += rx[i]; sumY += ry[i]; }
    const meanX = sumX / m, meanY = sumY / m;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < m; i++) {
      const dxi = rx[i] - meanX, dyi = ry[i] - meanY;
      num += dxi * dyi;
      dx2 += dxi * dxi;
      dy2 += dyi * dyi;
    }
    return (dx2 > 0 && dy2 > 0) ? num / Math.sqrt(dx2 * dy2) : 0;
  };

  for (let i = 0; i < n; i++) {
    // Mark to market every bar
    let posValue = 0;
    for (const t of tickers) {
      const p = positions[t];
      if (p) {
        const px = barsByTicker[t][i].close;
        posValue += p.shares * px * Math.sign(p.weight);
      }
    }
    equity = cash + posValue;
    equityCurve.push({ idx: i, t: barsByTicker[tickers[0]][i].t, equity });

    // Rebalance only on schedule + after enough warmup for factors
    if (i < 30 || i % rebalanceEvery !== 0) continue;

    // Compute factor scores for each ticker. Two modes:
    //   1. factor is a function — single-factor (legacy)
    //   2. factor is array of { fn, weight } — composite. Each factor
    //      ranks tickers, scores are z-normalized within the cross-
    //      section so different factor scales don't dominate, then
    //      weighted-summed.
    let scores;
    if (typeof factor === 'function') {
      scores = tickers.map(t => ({
        ticker: t,
        score:  factor(barsByTicker[t], i),
      })).filter(s => s.score != null && Number.isFinite(s.score));
    } else if (Array.isArray(factor) && factor.length > 0) {
      // For each component factor, compute scores then z-normalize
      // within the cross-section. This way a factor that returns
      // [0, 0.5, 1] doesn't dominate a factor that returns [-2, 0, 2]
      // — both contribute proportionally to the composite rank.
      //
      // When sectorMap is provided, z-normalize within each sector
      // bucket separately. This neutralizes sector exposure: a stock
      // ranks high only if it's strong VS its sector peers, not just
      // because the sector itself is rallying.
      const perFactor = factor.map(f => {
        const raw = tickers.map(t => f.fn(barsByTicker[t], i));
        const valid = raw.filter(v => v != null && Number.isFinite(v));
        if (valid.length < 2) return null;
        let z;
        if (sectorMap && typeof sectorMap === 'object') {
          // Bucket by sector, z-normalize within each bucket
          const buckets = {}; // sector → [{ idx, value }]
          for (let k = 0; k < tickers.length; k++) {
            const sec = sectorMap[tickers[k]] || '__other__';
            const v = raw[k];
            if (v == null || !Number.isFinite(v)) continue;
            if (!buckets[sec]) buckets[sec] = [];
            buckets[sec].push({ idx: k, value: v });
          }
          z = new Array(tickers.length).fill(null);
          for (const sec of Object.keys(buckets)) {
            const arr = buckets[sec];
            if (arr.length < 2) {
              // single-ticker sector — z = 0 (neutral)
              for (const { idx } of arr) z[idx] = 0;
              continue;
            }
            const m = arr.reduce((a, b) => a + b.value, 0) / arr.length;
            const v = arr.reduce((a, b) => a + (b.value - m) ** 2, 0) / arr.length;
            const sd = Math.sqrt(v);
            for (const { idx, value } of arr) {
              z[idx] = sd > 0 ? (value - m) / sd : 0;
            }
          }
        } else {
          // Standard cross-section z-normalization
          const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
          const std = Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length);
          z = raw.map(v => (v != null && Number.isFinite(v) && std > 0) ? (v - mean) / std : null);
        }
        return { z, weight: Number(f.weight) || 1, raw };
      }).filter(Boolean);
      if (perFactor.length === 0) continue;

      // Compute IC from previous rebalance if we have one pending
      if (pendingIc) {
        const fwdRets = tickers.map(t => {
          const prevPx = pendingIc.priceAt[t];
          const curPx = barsByTicker[t][i].close;
          return prevPx && curPx ? (curPx - prevPx) / prevPx : null;
        });
        for (let f = 0; f < pendingIc.perFactor.length; f++) {
          const pf = pendingIc.perFactor[f];
          // Pair up scores with forward returns where both are valid
          const xs = [], ys = [];
          for (let k = 0; k < tickers.length; k++) {
            if (pf.scores[k] != null && fwdRets[k] != null) {
              xs.push(pf.scores[k]);
              ys.push(fwdRets[k]);
            }
          }
          if (xs.length >= 5) {
            const rho = spearmanCorr(xs, ys);
            if (!factorIcHistory[f]) factorIcHistory[f] = [];
            factorIcHistory[f].push({ rankIc: rho, n: xs.length });
            // Cap history length
            if (factorIcHistory[f].length > rankIcWindow * 2) {
              factorIcHistory[f] = factorIcHistory[f].slice(-rankIcWindow * 2);
            }
          }
        }
      }
      // Save current state for next IC update
      pendingIc = {
        perFactor: perFactor.map(pf => ({ scores: pf.z })),
        priceAt: Object.fromEntries(tickers.map(t => [t, barsByTicker[t][i].close])),
      };

      // Determine effective weights — equal/user-specified or rank-IC weighted
      let effectiveWeights;
      if (rankIcWeighting) {
        // Use mean rank-IC over last rankIcWindow periods as weight.
        // Negative IC factors get negated weights (the factor predicts
        // OPPOSITE of the right direction, so flip its sign).
        // Factors with no IC history yet fall back to user weight.
        effectiveWeights = perFactor.map((pf, fIdx) => {
          const hist = factorIcHistory[fIdx] || [];
          if (hist.length < 3) return pf.weight; // fallback
          const recent = hist.slice(-rankIcWindow);
          const meanIc = recent.reduce((a, h) => a + h.rankIc, 0) / recent.length;
          // Sign comes from IC direction; magnitude is |IC| (so a 0.05 IC
          // factor weighs less than a 0.30 IC factor in the composite).
          return meanIc;
        });
      } else {
        effectiveWeights = perFactor.map(pf => pf.weight);
      }
      const totalW = effectiveWeights.reduce((a, w) => a + Math.abs(w), 0) || 1;
      scores = tickers.map((t, idx) => {
        let composite = 0;
        let usedWeight = 0;
        for (let fIdx = 0; fIdx < perFactor.length; fIdx++) {
          const pf = perFactor[fIdx];
          const w = effectiveWeights[fIdx];
          if (pf.z[idx] != null) {
            composite += pf.z[idx] * w;
            usedWeight += Math.abs(w);
          }
        }
        // Require at least 50% of total weight to count this ticker
        if (usedWeight / totalW < 0.5) return null;
        return { ticker: t, score: composite / usedWeight };
      }).filter(s => s != null && s.score != null && Number.isFinite(s.score));
    } else {
      continue;
    }
    if (scores.length < 5) continue;
    scores.sort((a, b) => b.score - a.score);

    // Determine target weights
    const longSet  = new Set(scores.slice(0, topN).map(s => s.ticker));
    const shortSet = mode === 'long-short'
      ? new Set(scores.slice(-topN).map(s => s.ticker))
      : new Set();

    // Close positions that should no longer be open
    for (const t of tickers) {
      const cur = positions[t];
      if (!cur) continue;
      const wantsLong  = longSet.has(t);
      const wantsShort = shortSet.has(t);
      const correctSide = (cur.weight > 0 && wantsLong) || (cur.weight < 0 && wantsShort);
      if (!correctSide) {
        // Close
        const px = barsByTicker[t][i].close;
        const fillPx = px * (1 - slipBps / 10000 * Math.sign(cur.weight));
        const notional = cur.shares * fillPx;
        const fee = notional * (feeBps / 10000);
        const pnl = cur.shares * (fillPx - cur.entryPx) * Math.sign(cur.weight) - fee;
        cash += notional - fee;
        trades.push({ idx: i, ticker: t, side: cur.weight > 0 ? 'long' : 'short', entry: cur.entryPx, exit: fillPx, pnl });
        delete positions[t];
      }
    }
    // Open new positions for targets we don't yet hold
    const targetCount = longSet.size + shortSet.size;
    if (targetCount > 0) {
      const perPositionCash = cash / targetCount;
      const openPosition = (t, side) => {
        if (positions[t]) return;
        const px = barsByTicker[t][i].close;
        const fillPx = px * (1 + slipBps / 10000 * (side === 'long' ? 1 : -1));
        const shares = perPositionCash / fillPx;
        const notional = shares * fillPx;
        const fee = notional * (feeBps / 10000);
        if (cash < notional + fee) return;
        cash -= notional + fee;
        positions[t] = {
          weight:  side === 'long' ? 1 : -1,
          shares,
          entryPx: fillPx,
        };
      };
      for (const t of longSet)  openPosition(t, 'long');
      for (const t of shortSet) openPosition(t, 'short');
    }
  }
  // Close any remaining positions at the end
  for (const t of Object.keys(positions)) {
    const cur = positions[t];
    const px = barsByTicker[t][n - 1].close;
    const fillPx = px * (1 - slipBps / 10000 * Math.sign(cur.weight));
    const pnl = cur.shares * (fillPx - cur.entryPx) * Math.sign(cur.weight);
    cash += cur.shares * fillPx;
    trades.push({ idx: n - 1, ticker: t, side: cur.weight > 0 ? 'long' : 'short', entry: cur.entryPx, exit: fillPx, pnl });
  }
  // Stats — same shape as runBacktest
  const startEq = capital;
  const endEq = equityCurve[equityCurve.length - 1]?.equity ?? capital;
  const totalReturn = (endEq - startEq) / startEq;
  const years = n / 252;
  const cagr = years > 0 ? Math.pow(endEq / startEq, 1 / years) - 1 : 0;
  const rets = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) rets.push((equityCurve[i].equity - prev) / prev);
  }
  const meanRet = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length ? rets.reduce((a, b) => a + (b - meanRet) ** 2, 0) / rets.length : 0;
  const sharpe = variance > 0 ? (meanRet / Math.sqrt(variance)) * Math.sqrt(252) : 0;
  let peak = startEq, maxDD = 0;
  for (const e of equityCurve) {
    if (e.equity > peak) peak = e.equity;
    const dd = peak > 0 ? (e.equity - peak) / peak : 0;
    if (dd < maxDD) maxDD = dd;
  }
  const winners = trades.filter(t => t.pnl > 0).length;
  const winRate = trades.length ? winners / trades.length : 0;
  // Mean rank-IC per factor — useful diagnostic regardless of weighting mode
  const factorIcSummary = factorIcHistory.map((hist, idx) => {
    if (!hist || hist.length === 0) return null;
    const meanIc = hist.reduce((a, h) => a + h.rankIc, 0) / hist.length;
    const stdIc = Math.sqrt(hist.reduce((a, h) => a + (h.rankIc - meanIc) ** 2, 0) / hist.length);
    // ICIR = mean / std — quality of factor signal vs its noise
    return {
      factorIdx: idx,
      meanIc,
      stdIc,
      icir: stdIc > 0 ? meanIc / stdIc : 0,
      nObservations: hist.length,
    };
  });
  return {
    equity: equityCurve, trades, totalReturn, cagr, sharpe,
    maxDrawdown: maxDD, winRate, nTrades: trades.length, endEq, startEq,
    factorIcSummary,
  };
};

// runPairTrade — z-score-based mean-reversion pair-trading backtest.
// Adapted from the Vibe-Trading "pair-trading" skill pattern. Trades
// the spread between two correlated instruments.
//
// Signal logic:
//   ratio = closeA / closeB
//   z = (ratio - rolling_mean) / rolling_std
//   z < -entryZ → long A, short B (ratio is too low; expect mean revert)
//   z > +entryZ → short A, long B
//   |z| < exitZ → close
//
// Equal-weight allocation: each leg gets 50% of capital. No precise
// hedge-ratio calc (would need cointegration test); v1 ships the
// simpler version.
export const runPairTrade = ({
  barsA, barsB,
  lookback = 60,
  entryZ = 2.0,
  exitZ = 0.5,
  capital = 10000,
  costs = null,
  hedgeMethod = 'equal',  // 'equal' | 'ols' | 'rolling-ols'
} = {}) => {
  if (!barsA || !barsB || barsA.length === 0 || barsB.length === 0) {
    return { error: 'Need bars for both legs', equity: [], trades: [] };
  }
  // Align to common length (trim from start)
  const n = Math.min(barsA.length, barsB.length);
  const A = barsA.slice(-n);
  const B = barsB.slice(-n);
  const feeBps = costs?.feeBps || 0;
  const slipBps = costs?.slippageBps || 0;

  // OLS hedge ratio — fits a line A = alpha + beta * B over a window
  // and returns beta. This is the static Engle-Granger hedge ratio:
  // a beta-units short of B per long unit of A makes the spread
  // mean-reverting if A and B are cointegrated.
  const computeOLS = (aPrices, bPrices) => {
    const m = aPrices.length;
    if (m < 5) return { alpha: 0, beta: 1, residuals: [] };
    let sumA = 0, sumB = 0, sumAB = 0, sumBB = 0;
    for (let k = 0; k < m; k++) {
      sumA += aPrices[k];
      sumB += bPrices[k];
      sumAB += aPrices[k] * bPrices[k];
      sumBB += bPrices[k] * bPrices[k];
    }
    const meanA = sumA / m, meanB = sumB / m;
    const beta = (sumAB - m * meanA * meanB) / (sumBB - m * meanB * meanB || 1e-9);
    const alpha = meanA - beta * meanB;
    const residuals = aPrices.map((aV, k) => aV - (alpha + beta * bPrices[k]));
    return { alpha, beta, residuals };
  };

  // ADF-style stationarity check on residuals — simple AR(1) test.
  // Tests whether the residual series mean-reverts. We use a basic
  // version: regress Δresid_t on resid_{t-1}; if the coefficient is
  // negative and significantly less than zero, the series is stationary.
  // For a true ADF we'd need critical-value tables; here we surface
  // the AR(1) coefficient and a simple "looks-mean-reverting" flag.
  // ADF test on residuals — augmented Dickey-Fuller (lag=0 / no drift)
  // with proper t-statistic and critical-value comparison.
  //
  // Test regression: Δresid_t = γ * resid_{t-1} + ε
  // Null hypothesis: γ = 0 (unit root, non-stationary)
  // Alternative:     γ < 0 (mean-reverting, stationary)
  //
  // We compute γ̂, its standard error, and the t-statistic. ADF
  // critical values (lag=0 / no drift) come from MacKinnon (1991, 2010);
  // we use the asymptotic constants for a one-sided left-tail test:
  //   1% : -2.566   5% : -1.941   10% : -1.616
  // (These are for the 'no constant, no trend' case which matches
  // residuals from an OLS that already absorbs the intercept.)
  //
  // Returns: { coef, tStat, isStationary, criticalLevel, halfLife }
  // criticalLevel = 0.01 / 0.05 / 0.10 / null indicating significance
  // Augmented Dickey-Fuller test on residuals (no constant, no trend).
  //
  // Test regression with `p` augmented lags:
  //   Δresid_t = γ · resid_{t-1} + Σᵢ δᵢ · Δresid_{t-i} + ε   (i = 1..p)
  //
  // Null hypothesis: γ = 0 (unit root, non-stationary)
  // Alternative:     γ < 0 (mean-reverting, stationary)
  //
  // The augmented lags soak up serial correlation in the differences,
  // which would otherwise inflate the t-statistic. Standard practice:
  //   p = ⌊(n-1)^(1/3)⌋  (Schwert's rule, conservative)
  // For most pair-trade residual series of length 60-250 this gives
  // p = 4–6. We auto-pick that unless the caller overrides.
  //
  // Critical values (MacKinnon, no constant/no trend, asymptotic):
  //   1% : -2.566   5% : -1.941   10% : -1.616
  //
  // We use the Gauss-Jordan-style normal-equations OLS solve. The
  // coefficient on resid_{t-1} is `γ̂`; its t-statistic is reported.
  //
  // Returns: { coef, tStat, isStationary, criticalLevel, halfLife,
  //            augmentedLags, deltaCoefs, useAugmented }
  const adfTest = (resid, opts = {}) => {
    if (!Array.isArray(resid) || resid.length < 20) {
      return {
        coef: 0, tStat: 0, isStationary: false, criticalLevel: null,
        halfLife: null, augmentedLags: 0, deltaCoefs: [], useAugmented: false,
      };
    }
    // Auto-pick lag count via Schwert's rule unless caller specifies
    const useAugmented = opts.useAugmented !== false; // default true
    const p = useAugmented
      ? (typeof opts.lags === 'number' ? Math.max(0, opts.lags) :
         Math.max(1, Math.floor(Math.pow(resid.length - 1, 1 / 3))))
      : 0;
    const n = resid.length;
    const dResidAll = new Array(n - 1);
    for (let k = 0; k < n - 1; k++) dResidAll[k] = resid[k + 1] - resid[k];
    // Effective sample after dropping the first p observations to make
    // room for the augmented lag terms in the regression.
    // y = Δresid_{p+1}, ..., Δresid_{n-1}
    // Each row: [resid_{t-1}, Δresid_{t-1}, ..., Δresid_{t-p}]
    const m = (n - 1) - p;
    if (m < 5) {
      // Fall back to non-augmented if there's not enough data
      return adfTest(resid, { ...opts, useAugmented: false });
    }
    const k = p + 1; // number of regressors
    // Build X (m × k) and y (m × 1)
    const X = new Array(m);
    const y = new Array(m);
    for (let i = 0; i < m; i++) {
      const t = p + i; // index into dResidAll: 0-based of Δresid_{p+1}, etc
      // resid_{t-1} where t corresponds to Δresid_t = resid_{t+1} - resid_t
      // dResidAll[i] = resid[i+1] - resid[i]  → Δresid at the bar between i and i+1
      // We want dResid_{t} where t = p+i. The lag resid_{t-1} = resid[t-1] = resid[p+i-1+1] = resid[p+i]
      // Actually: dResidAll[t] = resid[t+1] - resid[t]. We use t = p, p+1, ..., n-2.
      // For row i: t = p + i; y[i] = dResidAll[t]; lag = resid[t]; aug lags = dResidAll[t-1..t-p]
      const tt = p + i;
      y[i] = dResidAll[tt];
      const row = new Array(k);
      row[0] = resid[tt]; // resid_{t-1} (since dResidAll[tt] uses resid[tt+1] vs resid[tt])
      for (let j = 1; j <= p; j++) {
        row[j] = dResidAll[tt - j]; // Δresid_{t-j}
      }
      X[i] = row;
    }
    // OLS via normal equations: β̂ = (X'X)⁻¹ X'y
    const XtX = new Array(k);
    for (let r = 0; r < k; r++) {
      XtX[r] = new Array(k).fill(0);
      for (let c = 0; c < k; c++) {
        let s = 0;
        for (let i = 0; i < m; i++) s += X[i][r] * X[i][c];
        XtX[r][c] = s;
      }
    }
    const Xty = new Array(k).fill(0);
    for (let r = 0; r < k; r++) {
      let s = 0;
      for (let i = 0; i < m; i++) s += X[i][r] * y[i];
      Xty[r] = s;
    }
    // Invert XtX via Gauss-Jordan (small matrix; k ≤ ~7)
    const inv = (M) => {
      const sz = M.length;
      const A = M.map(r => r.slice());
      const I = Array.from({ length: sz }, (_, i) => {
        const row = new Array(sz).fill(0);
        row[i] = 1;
        return row;
      });
      for (let i = 0; i < sz; i++) {
        // Partial pivot
        let pivot = i;
        for (let j = i + 1; j < sz; j++) {
          if (Math.abs(A[j][i]) > Math.abs(A[pivot][i])) pivot = j;
        }
        if (pivot !== i) { [A[i], A[pivot]] = [A[pivot], A[i]]; [I[i], I[pivot]] = [I[pivot], I[i]]; }
        const piv = A[i][i];
        if (Math.abs(piv) < 1e-12) return null; // singular
        for (let c = 0; c < sz; c++) { A[i][c] /= piv; I[i][c] /= piv; }
        for (let j = 0; j < sz; j++) {
          if (j === i) continue;
          const f = A[j][i];
          if (f === 0) continue;
          for (let c = 0; c < sz; c++) {
            A[j][c] -= f * A[i][c];
            I[j][c] -= f * I[i][c];
          }
        }
      }
      return I;
    };
    const XtXinv = inv(XtX);
    if (!XtXinv) {
      return { coef: 0, tStat: 0, isStationary: false, criticalLevel: null, halfLife: null, augmentedLags: 0, deltaCoefs: [], useAugmented: false };
    }
    const beta = new Array(k).fill(0);
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) beta[r] += XtXinv[r][c] * Xty[c];
    }
    const gamma = beta[0];
    const deltaCoefs = beta.slice(1);
    // Residuals from full regression
    let sse = 0;
    for (let i = 0; i < m; i++) {
      let yhat = 0;
      for (let r = 0; r < k; r++) yhat += beta[r] * X[i][r];
      sse += (y[i] - yhat) ** 2;
    }
    const dof = Math.max(1, m - k);
    const sigma2 = sse / dof;
    // SE of γ̂ = √(σ² · [(X'X)⁻¹]₀₀)
    const seGamma = Math.sqrt(Math.max(0, sigma2 * XtXinv[0][0]));
    const tStat = seGamma > 0 ? gamma / seGamma : 0;
    // Critical values (asymptotic; no constant, no trend)
    let criticalLevel = null;
    if (tStat <= -2.566) criticalLevel = 0.01;
    else if (tStat <= -1.941) criticalLevel = 0.05;
    else if (tStat <= -1.616) criticalLevel = 0.10;
    // Half-life: t_½ = -ln(2) / ln(1 + γ)
    let halfLife = null;
    if (gamma < 0 && gamma > -1) {
      halfLife = Math.round(-Math.log(2) / Math.log(1 + gamma));
    }
    return {
      coef: gamma,
      tStat,
      isStationary: criticalLevel != null,
      criticalLevel,
      halfLife,
      augmentedLags: p,
      deltaCoefs,
      useAugmented: p > 0,
    };
  };
  // Legacy alias — keep old call sites working
  const adfLite = adfTest;

  // Build the spread series + rolling z-score. Different hedge methods:
  //   'equal':       spread = log(A) - log(B)   (legacy)
  //   'ols':         compute beta once on full window, spread = A - beta*B
  //   'rolling-ols': re-fit beta every bar over [i-lookback, i]
  const aPrices = A.map(b => b.close);
  const bPrices = B.map(b => b.close);
  const zScores = new Array(n).fill(null);
  const hedgeRatios = new Array(n).fill(1);
  let staticBeta = 1;
  let coint = null;
  if (hedgeMethod === 'ols') {
    const fit = computeOLS(aPrices, bPrices);
    staticBeta = fit.beta;
    coint = adfLite(fit.residuals);
    hedgeRatios.fill(staticBeta);
  }

  for (let i = lookback; i < n; i++) {
    let beta = 1;
    let spread;
    if (hedgeMethod === 'equal') {
      // Original log-ratio path
      spread = Math.log(aPrices[i]) - Math.log(bPrices[i]);
      hedgeRatios[i] = bPrices[i] / aPrices[i]; // value-equivalent for sizing
    } else if (hedgeMethod === 'rolling-ols') {
      const winA = aPrices.slice(i - lookback + 1, i + 1);
      const winB = bPrices.slice(i - lookback + 1, i + 1);
      const fit = computeOLS(winA, winB);
      beta = fit.beta;
      hedgeRatios[i] = beta;
      spread = aPrices[i] - beta * bPrices[i];
    } else {
      beta = staticBeta;
      hedgeRatios[i] = beta;
      spread = aPrices[i] - beta * bPrices[i];
    }
    // Rolling mean+std of the spread series at this i
    const lo = Math.max(0, i - lookback + 1);
    let sum = 0, count = 0;
    const winSpread = [];
    for (let k = lo; k <= i; k++) {
      let s;
      if (hedgeMethod === 'equal') s = Math.log(aPrices[k]) - Math.log(bPrices[k]);
      else if (hedgeMethod === 'rolling-ols') s = aPrices[k] - hedgeRatios[k] * bPrices[k];
      else s = aPrices[k] - staticBeta * bPrices[k];
      winSpread.push(s);
      sum += s; count++;
    }
    const mean = sum / count;
    let varSum = 0;
    for (const s of winSpread) varSum += (s - mean) ** 2;
    const std = Math.sqrt(varSum / count);
    zScores[i] = std > 0 ? (spread - mean) / std : 0;
  }
  // Backtest
  let cash = capital;
  let posA = 0, posB = 0;       // shares (positive = long, negative = short)
  let entryA = 0, entryB = 0;
  const equity = [];
  const trades = [];
  let direction = 0;            // -1 = short ratio (long B / short A), +1 = long ratio (long A / short B), 0 = flat
  for (let i = 0; i < n; i++) {
    const z = zScores[i];
    const pA = A[i].close;
    const pB = B[i].close;
    // Mark to market
    const mtm = posA * pA + posB * pB;
    const equityNow = cash + mtm;
    equity.push({ idx: i, t: A[i].t, equity: equityNow, z });
    if (z == null) continue;
    // Exit logic — when z reverts toward zero
    if (direction !== 0 && Math.abs(z) < exitZ) {
      // Close both legs
      const slipA = pA * (1 - Math.sign(posA) * slipBps / 10000);
      const slipB = pB * (1 - Math.sign(posB) * slipBps / 10000);
      const grossA = posA * slipA;
      const grossB = posB * slipB;
      const fees = (Math.abs(grossA) + Math.abs(grossB)) * (feeBps / 10000);
      cash += grossA + grossB - fees;
      const pnl = posA * (slipA - entryA) + posB * (slipB - entryB) - fees;
      trades.push({
        idx: i, direction, pnl,
        entryRatio: entryA / entryB, exitRatio: pA / pB,
      });
      posA = 0; posB = 0; direction = 0;
    }
    // Entry logic — when z is sufficiently extreme
    if (direction === 0 && Math.abs(z) >= entryZ) {
      // Sizing depends on hedge method:
      //
      //   'equal'    — 50/50 cash allocation across legs (legacy).
      //                Implicit hedge ratio is just price ratio.
      //
      //   'ols' / 'rolling-ols' — proper β-weighted sizing so the
      //                spread A − β·B is what we're actually trading.
      //                Shares: sharesB = β · sharesA. Position is
      //                NOT dollar-neutral; it's *spread*-neutral.
      //
      //                Risk-cap: total gross exposure (long + short
      //                notional) capped at `cash` so we don't run
      //                into 2x leverage. Compute sharesA such that
      //                |sharesA·pA| + |β·sharesA·pB| = cash, i.e.
      //                sharesA = cash / (pA + |β|·pB).
      const halfCash = cash / 2;
      const beta = hedgeRatios[i] || 1;
      let sharesAMag, sharesBMag;
      if (hedgeMethod === 'equal') {
        sharesAMag = halfCash / pA;
        sharesBMag = halfCash / pB;
      } else {
        // β-weighted, gross-exposure-capped at `cash`
        const denom = pA + Math.abs(beta) * pB;
        if (denom <= 0) {
          sharesAMag = halfCash / pA;
          sharesBMag = halfCash / pB;
        } else {
          sharesAMag = cash / denom;
          sharesBMag = sharesAMag * Math.abs(beta);
        }
      }
      if (z > 0) {
        // Spread too high: short A, long B
        const slipA = pA * (1 - slipBps / 10000); // selling A
        const slipB = pB * (1 + slipBps / 10000); // buying B
        const sharesA = -sharesAMag;              // negative = short
        const sharesB = +sharesBMag;
        const fees = (sharesAMag * slipA + sharesBMag * slipB) * (feeBps / 10000);
        cash -= sharesA * slipA + sharesB * slipB + fees;
        posA = sharesA; posB = sharesB;
        entryA = slipA; entryB = slipB;
        direction = -1;
      } else {
        // Spread too low: long A, short B
        const slipA = pA * (1 + slipBps / 10000);
        const slipB = pB * (1 - slipBps / 10000);
        const sharesA = +sharesAMag;
        const sharesB = -sharesBMag;
        const fees = (sharesAMag * slipA + sharesBMag * slipB) * (feeBps / 10000);
        cash -= sharesA * slipA + sharesB * slipB + fees;
        posA = sharesA; posB = sharesB;
        entryA = slipA; entryB = slipB;
        direction = +1;
      }
    }
  }
  // Force close at end
  if (direction !== 0) {
    const lastA = A[n - 1].close, lastB = B[n - 1].close;
    cash += posA * lastA + posB * lastB;
    const pnl = posA * (lastA - entryA) + posB * (lastB - entryB);
    trades.push({ idx: n - 1, direction, pnl, forced: true });
  }
  // Stats — mirror runBacktest shape
  const startEq = capital;
  const endEq = equity[equity.length - 1]?.equity ?? capital;
  const totalReturn = (endEq - startEq) / startEq;
  const years = n / 252;
  const cagr = years > 0 ? Math.pow(endEq / startEq, 1 / years) - 1 : 0;
  const rets = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1].equity;
    if (prev > 0) rets.push((equity[i].equity - prev) / prev);
  }
  const meanRet = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance = rets.length ? rets.reduce((a, b) => a + (b - meanRet) ** 2, 0) / rets.length : 0;
  const sharpe = variance > 0 ? (meanRet / Math.sqrt(variance)) * Math.sqrt(252) : 0;
  let peak = startEq, maxDD = 0;
  for (const e of equity) {
    if (e.equity > peak) peak = e.equity;
    const dd = peak > 0 ? (e.equity - peak) / peak : 0;
    if (dd < maxDD) maxDD = dd;
  }
  const winners = trades.filter(t => t.pnl > 0).length;
  const winRate = trades.length ? winners / trades.length : 0;
  return {
    equity, trades, zScores,
    totalReturn, cagr, sharpe, maxDrawdown: maxDD,
    winRate, nTrades: trades.length, endEq, startEq,
    hedgeMethod,
    hedgeRatios: hedgeMethod === 'equal' ? null : hedgeRatios,
    cointegration: coint,  // null if hedgeMethod !== 'ols'
  };
};

// runSeasonalStrategy — month-of-year (and optional weekday) effect
// strategy. Goes long in bullishMonths, short in bearishMonths,
// flat otherwise. Adapted from the Vibe-Trading "seasonal" skill.
//
// Common calendar effects:
//   "Sell in May" — bullishMonths = [11,12,1,2,3,4], bearishMonths = [5,6,7,8,9,10]
//   January effect — bullishMonths = [1]
//   Year-end rally — bullishMonths = [11,12]
export const runSeasonalStrategy = ({
  bars,
  bullishMonths = [],
  bearishMonths = [],
  bullishWeekdays = [],
  bearishWeekdays = [],
  capital = 10000,
  costs = null,
} = {}) => {
  if (!bars || bars.length === 0) {
    return { error: 'No bars', equity: [], trades: [] };
  }
  // Build the strategy fn for runBacktest
  const strategy = (bars, i, ctx) => {
    const d = new Date(bars[i].t);
    const month = d.getUTCMonth() + 1; // 1-12
    const weekday = d.getUTCDay();     // 0-6 (Sun-Sat)
    let monthSig = 'neutral';
    if (bullishMonths.includes(month)) monthSig = 'bull';
    else if (bearishMonths.includes(month)) monthSig = 'bear';
    let weekdaySig = 'neutral';
    if (bullishWeekdays.length > 0 && bullishWeekdays.includes(weekday)) weekdaySig = 'bull';
    else if (bearishWeekdays.length > 0 && bearishWeekdays.includes(weekday)) weekdaySig = 'bear';
    // Combine — if either filter is configured, both must agree (or be neutral)
    const wantLong = monthSig === 'bull' && weekdaySig !== 'bear';
    const wantFlat = monthSig === 'bear' || weekdaySig === 'bear';
    if (ctx.pos === 0 && wantLong) return 'enter';
    if (ctx.pos > 0 && wantFlat) return 'exit';
    return 'hold';
  };
  return runBacktest({ bars, strategy, capital, costs });
};

// computeCorrelationMatrix — Pearson correlation matrix across a
// basket of return series. Returns:
//   { tickers, matrix: [[rho_ij]], maxOffDiagonal, mean, sortedPairs }
//
// `sortedPairs` is the upper-triangle pairs sorted by |rho| desc, so
// callers can list "most-correlated pairs" easily.
export const computeCorrelationMatrix = (barsByTicker) => {
  const tickers = Object.keys(barsByTicker);
  const n = tickers.length;
  if (n < 2) return null;
  // Align to common length, compute returns
  const lens = tickers.map(t => barsByTicker[t].length);
  const minLen = Math.min(...lens);
  if (minLen < 5) return null;
  const returns = {};
  for (const t of tickers) {
    const bars = barsByTicker[t].slice(-minLen);
    const r = [];
    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1].close;
      r.push(prev > 0 ? (bars[i].close - prev) / prev : 0);
    }
    returns[t] = r;
  }
  const length = returns[tickers[0]].length;
  // Pearson correlation between all pairs
  const matrix = [];
  for (let i = 0; i < n; i++) {
    matrix.push(new Array(n).fill(0));
  }
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j) { matrix[i][j] = 1; continue; }
      const a = returns[tickers[i]];
      const b = returns[tickers[j]];
      let sumA = 0, sumB = 0;
      for (let k = 0; k < length; k++) { sumA += a[k]; sumB += b[k]; }
      const meanA = sumA / length, meanB = sumB / length;
      let num = 0, denA = 0, denB = 0;
      for (let k = 0; k < length; k++) {
        const da = a[k] - meanA, db = b[k] - meanB;
        num += da * db;
        denA += da * da;
        denB += db * db;
      }
      const rho = (denA > 0 && denB > 0) ? num / Math.sqrt(denA * denB) : 0;
      matrix[i][j] = rho;
      matrix[j][i] = rho;
    }
  }
  // Stats
  let maxOffDiag = 0, sumOffDiag = 0, count = 0;
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const rho = matrix[i][j];
      if (Math.abs(rho) > Math.abs(maxOffDiag)) maxOffDiag = rho;
      sumOffDiag += rho;
      count++;
      pairs.push({ a: tickers[i], b: tickers[j], rho });
    }
  }
  pairs.sort((x, y) => Math.abs(y.rho) - Math.abs(x.rho));
  return {
    tickers,
    matrix,
    maxOffDiagonal: maxOffDiag,
    mean: count > 0 ? sumOffDiag / count : 0,
    sortedPairs: pairs,
  };
};

// renderCorrelationHeatmapSVG — visualize a correlation matrix as a
// heat-map grid. Uses a diverging red-white-green palette so users
// can read positive (green), zero (white), negative (red) at a glance.
export const renderCorrelationHeatmapSVG = (corrResult, opts = {}) => {
  if (!corrResult || !corrResult.tickers) return '';
  const { tickers, matrix } = corrResult;
  const n = tickers.length;
  const cell = opts.cell || 22;
  const labelW = opts.labelW || 56;
  const padT = 4, padL = 4;
  const W = labelW + n * cell + padL * 2 + 40;
  const H = padT * 2 + labelW + n * cell;
  const colorFor = (rho) => {
    // -1 = bright red; 0 = white-ish; +1 = bright green
    if (rho >= 0) {
      const a = Math.min(1, rho);
      const r = Math.round(255 * (1 - a) + 31 * a);
      const g = Math.round(255 * (1 - a) + 178 * a);
      const b = Math.round(255 * (1 - a) + 107 * a);
      return `rgb(${r},${g},${b})`;
    } else {
      const a = Math.min(1, -rho);
      const r = Math.round(255 * (1 - a) + 255 * a);
      const g = Math.round(255 * (1 - a) + 85 * a);
      const b = Math.round(255 * (1 - a) + 119 * a);
      return `rgb(${r},${g},${b})`;
    }
  };
  let cells = '';
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const rho = matrix[i][j];
      const x = padL + labelW + j * cell;
      const y = padT + labelW + i * cell;
      cells += `<rect x="${x}" y="${y}" width="${cell - 1}" height="${cell - 1}" fill="${colorFor(rho)}" stroke="rgba(0,0,0,0.2)" stroke-width="0.5"/>`;
      // Number inside cell — only if cell big enough
      if (cell >= 18) {
        const txtCol = Math.abs(rho) > 0.5 ? '#FFF' : '#000';
        cells += `<text x="${x + cell / 2}" y="${y + cell / 2 + 3}" font-size="9" fill="${txtCol}" text-anchor="middle" font-family="ui-monospace,monospace">${rho.toFixed(2)}</text>`;
      }
    }
  }
  // Row + col labels
  let labels = '';
  for (let i = 0; i < n; i++) {
    labels += `<text x="${padL + labelW - 4}" y="${padT + labelW + i * cell + cell / 2 + 3}" font-size="9" fill="#9CA3AF" text-anchor="end" font-family="ui-sans-serif,system-ui,sans-serif">${tickers[i]}</text>`;
    labels += `<text x="${padL + labelW + i * cell + cell / 2}" y="${padT + labelW - 4}" font-size="9" fill="#9CA3AF" text-anchor="middle" transform="rotate(-45 ${padL + labelW + i * cell + cell / 2} ${padT + labelW - 4})" font-family="ui-sans-serif,system-ui,sans-serif">${tickers[i]}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="background:#0F1115;border-radius:6px">
    <rect width="${W}" height="${H}" fill="#0F1115" rx="6"/>
    ${cells}
    ${labels}
  </svg>`;
};
