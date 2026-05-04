// IMO Onyx Terminal — scanner configuration
//
// Phase 3p.23 file-splitting / extracted from JPMOnyxTerminal.jsx.
//
// Shared scanner reference data. Used by ScannerPage AND by other
// monolith features (alert engine, history viewer, detector tuner).
// Co-locating here lets every consumer import a single source of
// truth without duplicating ~715 lines of config across modules.
//
// Public exports:
//   DETECTOR_DEFAULTS         tunable params per detector
//   SETUP_RULES               array of detector implementations (the
//                             rules each scanner applies bar-by-bar)
//   INVESTOR_LENSES           investor-style LLM analysis prompts
//                             (Buffett, Lynch, Burry, Druckenmiller,
//                             Howard Marks, etc.)
//   HEDGE_FUND_AGENTS         multi-agent hedge-fund decision pipeline
//                             (Director → Quant → Risk → Execution → IC)
//   SCANNER_DEFAULT_WATCHLIST default ticker universe for new users
//   SCANNER_CONFIG_KEY        localStorage key for scanner config
//   SCANNER_HISTORY_KEY       localStorage key for hit history
//
// Honest scope:
//   - SETUP_RULES detector functions are pure: they take a bar window
//     and return { hit, score, notes } or null. They do NOT perform
//     any side effects (no fetches, no LLM calls).
//   - INVESTOR_LENSES and HEDGE_FUND_AGENTS contain prompt strings
//     intended for use with an LLM (callAI from src/lib/ai-calls.js).
//     The orchestration logic lives in the monolith for now.

import { QUANT_PRIMITIVES } from './quant/backtest-engine.js';

// ──── Detector tunable parameters ────
export const DETECTOR_DEFAULTS = {
  'bull-breakout':    { window: 20, minVolZ: 0.5 },
  'bear-breakdown':   { window: 20, minVolZ: 0.5 },
  'oversold-bounce':  { rsiWindow: 14, rsiThreshold: 30 },
  'overbought-fade':  { rsiWindow: 14, rsiThreshold: 70 },
  'bb-squeeze':       { window: 20, k: 2, decilePct: 0.10 },
  'macd-bull-cross':  {},
  'macd-bear-cross':  {},
  'golden-cross':     { fast: 50, slow: 200 },
  'death-cross':      { fast: 50, slow: 200 },
  'volume-thrust':    { multiplier: 3, closeRangePct: 0.65 },
  'higher-low-stack': { lookback: 28 },
  'lower-high-stack': { lookback: 28 },
  'bull-flag':        { impulseStart: 15, impulseEnd: 7, minImpulsePct: 0.08, maxFlagRangePct: 0.06 },
};

// ──── SETUP_RULES — detector implementations ────
export const SETUP_RULES = [
  {
    id: 'bull-breakout',
    label: 'Bull breakout',
    side: 'long',
    detect: (bars, i, opts = {}) => {
      const params = { ...DETECTOR_DEFAULTS['bull-breakout'], ...opts };
      const w = params.window;
      if (i < w) return null;
      let hi = -Infinity;
      for (let k = i - w; k < i; k++) if (bars[k].high > hi) hi = bars[k].high;
      const cur = bars[i];
      const volZ = QUANT_PRIMITIVES.volz(bars, i, 20);
      if (cur.close <= hi) return null;
      if (volZ == null || volZ < params.minVolZ) return null;
      const score = Math.min(100, 50 + (cur.close / hi - 1) * 500 + Math.min(30, volZ * 12));
      return {
        score: Math.round(score),
        levels: { entry: cur.close, breakout: hi, stop: hi * 0.97, target: hi * (1 + (cur.close / hi - 1) * 3) },
        notes: `Closed above ${hi.toFixed(2)} (${w}-day high) on ${volZ.toFixed(1)}σ volume`,
      };
    },
  },
  {
    id: 'bear-breakdown',
    label: 'Bear breakdown',
    side: 'short',
    detect: (bars, i, opts = {}) => {
      const params = { ...DETECTOR_DEFAULTS['bear-breakdown'], ...opts };
      const w = params.window;
      if (i < w) return null;
      let lo = Infinity;
      for (let k = i - w; k < i; k++) if (bars[k].low < lo) lo = bars[k].low;
      const cur = bars[i];
      const volZ = QUANT_PRIMITIVES.volz(bars, i, 20);
      if (cur.close >= lo) return null;
      if (volZ == null || volZ < params.minVolZ) return null;
      const score = Math.min(100, 50 + (1 - cur.close / lo) * 500 + Math.min(30, volZ * 12));
      return {
        score: Math.round(score),
        levels: { entry: cur.close, breakdown: lo, stop: lo * 1.03, target: lo * (1 - (1 - cur.close / lo) * 3) },
        notes: `Closed below ${lo.toFixed(2)} (${w}-day low) on ${volZ.toFixed(1)}σ volume`,
      };
    },
  },
  {
    id: 'oversold-bounce',
    label: 'Oversold bounce',
    side: 'long',
    detect: (bars, i, opts = {}) => {
      const params = { ...DETECTOR_DEFAULTS['oversold-bounce'], ...opts };
      if (i < 20) return null;
      const rsiNow = QUANT_PRIMITIVES.rsi(bars, i, params.rsiWindow);
      const rsiPrev = QUANT_PRIMITIVES.rsi(bars, i - 1, params.rsiWindow);
      if (rsiNow == null || rsiPrev == null) return null;
      if (rsiPrev > params.rsiThreshold || rsiNow < params.rsiThreshold) return null; // need cross from oversold
      const cur = bars[i], prev = bars[i - 1];
      // Bullish candle confirmation
      if (cur.close <= cur.open) return null;
      if (cur.close <= prev.high) return null;
      const sma20 = QUANT_PRIMITIVES.sma(bars, i, 20);
      const distFromSma = sma20 ? (sma20 - cur.close) / sma20 : 0;
      const score = Math.min(95, 50 + (params.rsiThreshold - rsiPrev) * 2 + Math.min(20, distFromSma * 200));
      return {
        score: Math.round(score),
        levels: { entry: cur.close, stop: prev.low * 0.99, target: sma20 || cur.close * 1.05 },
        notes: `RSI crossed up from ${rsiPrev.toFixed(1)} (oversold) with bullish engulfing-style candle`,
      };
    },
  },
  {
    id: 'overbought-fade',
    label: 'Overbought fade',
    side: 'short',
    detect: (bars, i, opts = {}) => {
      const params = { ...DETECTOR_DEFAULTS['overbought-fade'], ...opts };
      if (i < 20) return null;
      const rsiNow = QUANT_PRIMITIVES.rsi(bars, i, params.rsiWindow);
      const rsiPrev = QUANT_PRIMITIVES.rsi(bars, i - 1, params.rsiWindow);
      if (rsiNow == null || rsiPrev == null) return null;
      if (rsiPrev < params.rsiThreshold || rsiNow > params.rsiThreshold) return null;
      const cur = bars[i], prev = bars[i - 1];
      if (cur.close >= cur.open) return null;
      if (cur.close >= prev.low) return null;
      const sma20 = QUANT_PRIMITIVES.sma(bars, i, 20);
      const distFromSma = sma20 ? (cur.close - sma20) / sma20 : 0;
      const score = Math.min(95, 50 + (rsiPrev - params.rsiThreshold) * 2 + Math.min(20, distFromSma * 200));
      return {
        score: Math.round(score),
        levels: { entry: cur.close, stop: prev.high * 1.01, target: sma20 || cur.close * 0.95 },
        notes: `RSI crossed down from ${rsiPrev.toFixed(1)} (overbought) with bearish candle`,
      };
    },
  },
  {
    id: 'bb-squeeze',
    label: 'Bollinger squeeze',
    side: 'neutral',
    detect: (bars, i, opts = {}) => {
      const params = { ...DETECTOR_DEFAULTS['bb-squeeze'], ...opts };
      if (i < params.window + 10) return null;
      const bbNow = QUANT_PRIMITIVES.bb(bars, i, params.window, params.k);
      const bbPrev = QUANT_PRIMITIVES.bb(bars, i - params.window, params.window, params.k);
      if (!bbNow || !bbPrev) return null;
      // Squeeze = current width in lowest decilePct of recent (window+10)-bar history
      let widths = [];
      for (let k = i - (params.window + 10); k <= i; k++) {
        const b = QUANT_PRIMITIVES.bb(bars, k, params.window, params.k);
        if (b) widths.push(b.width);
      }
      if (widths.length === 0) return null;
      widths.sort((a, b) => a - b);
      const decileIdx = Math.floor(widths.length * params.decilePct);
      const decile = widths[decileIdx];
      if (bbNow.width > decile * 1.05) return null;
      const cur = bars[i];
      // Direction hint from %B and most recent close vs middle
      const dir = cur.close > bbNow.middle ? 'long' : 'short';
      const score = Math.min(90, 40 + (1 - bbNow.width / bbPrev.width) * 80);
      return {
        score: Math.round(score),
        side: dir,
        levels: { entry: cur.close, upperBand: bbNow.upper, lowerBand: bbNow.lower, mid: bbNow.middle },
        notes: `BB width compressed to ${(bbNow.width * 100).toFixed(2)}% — primed for expansion. Bias ${dir} based on close vs middle band.`,
      };
    },
  },
  {
    id: 'macd-bull-cross',
    label: 'MACD bull cross',
    side: 'long',
    detect: (bars, i) => {
      if (i < 35) return null;
      const m = QUANT_PRIMITIVES.macd(bars, i);
      const mP = QUANT_PRIMITIVES.macd(bars, i - 1);
      if (!m || !mP) return null;
      if (!(mP.macd <= mP.signal && m.macd > m.signal)) return null;
      // Score boost when cross happens in negative territory (oversold)
      const oversoldBoost = m.macd < 0 ? 20 : 0;
      const histStrength = Math.min(20, Math.abs(m.hist) * 100);
      const cur = bars[i];
      const score = 50 + oversoldBoost + histStrength;
      return {
        score: Math.round(Math.min(95, score)),
        levels: { entry: cur.close, stop: cur.close * 0.96, target: cur.close * 1.06 },
        notes: m.macd < 0
          ? `MACD bull cross from below zero — strongest setup`
          : `MACD line crossed above signal (hist ${m.hist.toFixed(3)})`,
      };
    },
  },
  {
    id: 'macd-bear-cross',
    label: 'MACD bear cross',
    side: 'short',
    detect: (bars, i) => {
      if (i < 35) return null;
      const m = QUANT_PRIMITIVES.macd(bars, i);
      const mP = QUANT_PRIMITIVES.macd(bars, i - 1);
      if (!m || !mP) return null;
      if (!(mP.macd >= mP.signal && m.macd < m.signal)) return null;
      const overboughtBoost = m.macd > 0 ? 20 : 0;
      const histStrength = Math.min(20, Math.abs(m.hist) * 100);
      const cur = bars[i];
      const score = 50 + overboughtBoost + histStrength;
      return {
        score: Math.round(Math.min(95, score)),
        levels: { entry: cur.close, stop: cur.close * 1.04, target: cur.close * 0.94 },
        notes: m.macd > 0
          ? `MACD bear cross from above zero — strongest fade`
          : `MACD line crossed below signal (hist ${m.hist.toFixed(3)})`,
      };
    },
  },
  {
    id: 'golden-cross',
    label: 'Golden cross',
    side: 'long',
    detect: (bars, i, opts = {}) => {
      const params = { ...DETECTOR_DEFAULTS['golden-cross'], ...opts };
      if (i < params.slow) return null;
      const smaF = QUANT_PRIMITIVES.sma(bars, i, params.fast);
      const smaFp = QUANT_PRIMITIVES.sma(bars, i - 1, params.fast);
      const smaS = QUANT_PRIMITIVES.sma(bars, i, params.slow);
      const smaSp = QUANT_PRIMITIVES.sma(bars, i - 1, params.slow);
      if (!smaF || !smaFp || !smaS || !smaSp) return null;
      if (!(smaFp <= smaSp && smaF > smaS)) return null;
      const cur = bars[i];
      const score = 65;
      return {
        score,
        levels: { entry: cur.close, smaFast: smaF, smaSlow: smaS, stop: smaS * 0.98, target: cur.close * 1.15 },
        notes: `${params.fast}-day SMA crossed above ${params.slow}-day SMA — long-term trend turning bullish`,
      };
    },
  },
  {
    id: 'death-cross',
    label: 'Death cross',
    side: 'short',
    detect: (bars, i, opts = {}) => {
      const params = { ...DETECTOR_DEFAULTS['death-cross'], ...opts };
      if (i < params.slow) return null;
      const smaF = QUANT_PRIMITIVES.sma(bars, i, params.fast);
      const smaFp = QUANT_PRIMITIVES.sma(bars, i - 1, params.fast);
      const smaS = QUANT_PRIMITIVES.sma(bars, i, params.slow);
      const smaSp = QUANT_PRIMITIVES.sma(bars, i - 1, params.slow);
      if (!smaF || !smaFp || !smaS || !smaSp) return null;
      if (!(smaFp >= smaSp && smaF < smaS)) return null;
      const cur = bars[i];
      return {
        score: 65,
        levels: { entry: cur.close, smaFast: smaF, smaSlow: smaS, stop: smaS * 1.02, target: cur.close * 0.85 },
        notes: `${params.fast}-day SMA crossed below ${params.slow}-day SMA — long-term trend turning bearish`,
      };
    },
  },
  {
    id: 'volume-thrust',
    label: 'Volume thrust',
    side: 'long',
    detect: (bars, i, opts = {}) => {
      const params = { ...DETECTOR_DEFAULTS['volume-thrust'], ...opts };
      if (i < 20) return null;
      let avgVol = 0;
      for (let k = i - 20; k < i; k++) avgVol += bars[k].volume || 0;
      avgVol /= 20;
      const cur = bars[i];
      if (!cur.volume || cur.volume < avgVol * params.multiplier) return null;
      // Close in upper portion of bar's range
      const range = (cur.high || cur.close) - (cur.low || cur.close);
      if (range <= 0) return null;
      const closeInRange = (cur.close - (cur.low || cur.close)) / range;
      if (closeInRange < params.closeRangePct) return null;
      const volRatio = cur.volume / avgVol;
      const score = Math.min(95, 40 + Math.min(35, volRatio * 8) + closeInRange * 20);
      return {
        score: Math.round(score),
        levels: { entry: cur.close, stop: cur.low * 0.99, target: cur.close + range * 2 },
        notes: `${volRatio.toFixed(1)}x average volume, closed in top ${(closeInRange * 100).toFixed(0)}% of bar`,
      };
    },
  },
  {
    id: 'higher-low-stack',
    label: 'Higher-low uptrend',
    side: 'long',
    detect: (bars, i, opts = {}) => {
      const params = { ...DETECTOR_DEFAULTS['higher-low-stack'], ...opts };
      if (i < params.lookback + 2) return null;
      // Find swing lows in last `lookback` bars (a swing low = bar where low is
      // lower than 2 bars before AND 2 bars after)
      const lows = [];
      for (let k = i - (params.lookback - 2); k <= i - 2; k++) {
        if (bars[k].low < bars[k - 1].low && bars[k].low < bars[k - 2].low &&
            bars[k].low < bars[k + 1].low && bars[k].low < bars[k + 2].low) {
          lows.push({ idx: k, low: bars[k].low });
        }
      }
      if (lows.length < 3) return null;
      // Check ascending sequence
      const recent3 = lows.slice(-3);
      if (!(recent3[0].low < recent3[1].low && recent3[1].low < recent3[2].low)) return null;
      const cur = bars[i];
      const slope = (recent3[2].low - recent3[0].low) / (recent3[2].idx - recent3[0].idx);
      return {
        score: 60,
        levels: { entry: cur.close, stop: recent3[2].low * 0.99, target: cur.close + slope * 30 },
        notes: `Three consecutive higher lows: ${recent3.map(l => l.low.toFixed(2)).join(' → ')}`,
      };
    },
  },
  {
    id: 'lower-high-stack',
    label: 'Lower-high downtrend',
    side: 'short',
    detect: (bars, i, opts = {}) => {
      const params = { ...DETECTOR_DEFAULTS['lower-high-stack'], ...opts };
      if (i < params.lookback + 2) return null;
      const highs = [];
      for (let k = i - (params.lookback - 2); k <= i - 2; k++) {
        if (bars[k].high > bars[k - 1].high && bars[k].high > bars[k - 2].high &&
            bars[k].high > bars[k + 1].high && bars[k].high > bars[k + 2].high) {
          highs.push({ idx: k, high: bars[k].high });
        }
      }
      if (highs.length < 3) return null;
      const recent3 = highs.slice(-3);
      if (!(recent3[0].high > recent3[1].high && recent3[1].high > recent3[2].high)) return null;
      const cur = bars[i];
      const slope = (recent3[0].high - recent3[2].high) / (recent3[2].idx - recent3[0].idx);
      return {
        score: 60,
        levels: { entry: cur.close, stop: recent3[2].high * 1.01, target: cur.close - slope * 30 },
        notes: `Three consecutive lower highs: ${recent3.map(h => h.high.toFixed(2)).join(' → ')}`,
      };
    },
  },
  {
    id: 'bull-flag',
    label: 'Bull flag',
    side: 'long',
    detect: (bars, i, opts = {}) => {
      const params = { ...DETECTOR_DEFAULTS['bull-flag'], ...opts };
      if (i < params.impulseStart + 10) return null;
      // Need an impulse leg up over [i-impulseStart, i-impulseEnd]
      const impulseStartPx = bars[i - params.impulseStart]?.close;
      const impulseEndPx   = bars[i - params.impulseEnd]?.close;
      if (!impulseStartPx || !impulseEndPx) return null;
      const impulseRet = (impulseEndPx - impulseStartPx) / impulseStartPx;
      if (impulseRet < params.minImpulsePct) return null;
      // Then a tight pullback: high-low over last impulseEnd bars stays within maxFlagRangePct
      let phi = -Infinity, plo = Infinity;
      for (let k = i - (params.impulseEnd - 1); k <= i; k++) {
        if (bars[k].high > phi) phi = bars[k].high;
        if (bars[k].low < plo) plo = bars[k].low;
      }
      const flagRange = (phi - plo) / impulseEndPx;
      if (flagRange > params.maxFlagRangePct) return null;
      // Pullback should hold above the 20EMA
      const ema = QUANT_PRIMITIVES.ema(bars, i, 20);
      if (!ema || bars[i].close < ema) return null;
      return {
        score: Math.min(90, Math.round(55 + impulseRet * 200)),
        levels: { entry: phi, flagHigh: phi, flagLow: plo, stop: plo * 0.99, target: phi + (impulseEndPx - impulseStartPx) },
        notes: `${(impulseRet * 100).toFixed(1)}% impulse + tight ${(flagRange * 100).toFixed(1)}% pullback holding above 20EMA`,
      };
    },
  },
];

// ──── Default watchlist + storage keys ────
export const SCANNER_DEFAULT_WATCHLIST =
  'AAPL,MSFT,GOOGL,AMZN,META,NVDA,TSLA,JPM,BAC,WMT,XOM,JNJ,UNH,V,MA,' +
  'AVGO,LLY,COST,HD,ORCL,NFLX,DIS,AMD,INTC,CRM,ADBE,KO,PEP,PFE,MRK';

// localStorage keys for scanner config + history
export const SCANNER_CONFIG_KEY  = 'imo_scanner_config';
export const SCANNER_HISTORY_KEY = 'imo_scanner_history';

// ──── INVESTOR_LENSES — investor-style LLM analysis prompts ────
export const INVESTOR_LENSES = [
  {
    id: 'buffett',
    label: 'Warren Buffett',
    description: 'Moat, owner earnings, predictable cash flow, fortress balance sheet.',
    horizon: 'long',
    promptCore: `You are a value-investing analyst in the Warren Buffett tradition. You are a business analyst, not a personality cosplay. Every recommendation has a named moat source, a returns-on-capital number, a management-quality check, and a valuation. No exceptions.

FRAMEWORK (every section required):
1. MOAT — name it: brand / switching cost / network effect / cost advantage / scale / regulatory. If you cannot name one concrete moat, the answer is "no moat".
2. RETURNS ON CAPITAL — ROE >= 15% for 7 of last 10 years? ROIC > WACC?
3. EARNINGS PREDICTABILITY — positive earnings in >=8 of last 10 years; operating margin std under 5 points.
4. BALANCE SHEET — D/E < 0.5, interest coverage > 5x.
5. MANAGEMENT — capital allocation track record (buybacks, M&A, reinvestment).
6. VALUATION — owner earnings yield. Discount at 10%.

Do NOT call something "wonderful" without naming the moat. Do NOT use folksy aphorisms as a substitute for numbers. Do NOT treat rising share price as confirmation.`,
  },
  {
    id: 'graham',
    label: 'Benjamin Graham',
    description: 'Margin of safety, balance-sheet bargains, deep value with collateral.',
    horizon: 'long',
    promptCore: `You are a deep-value analyst in the Benjamin Graham tradition. Your only job is finding margin of safety — quantitative, not qualitative.

CHECKLIST (use Graham's defensive criteria adjusted to current dollars):
- Adequate size (>$2B market cap for defensive; smaller for enterprising)
- Strong balance sheet: current ratio >= 2.0; long-term debt < net current assets
- Earnings stability: positive earnings each year for the last 10 years
- Dividend record: continuous payments for at least 20 years (relax to 5 if recent IPO)
- Earnings growth: at least 33% in 10-year EPS using 3-year averages
- Moderate P/E: <= 15 (or current Aaa yield × 9)
- Moderate P/B × P/E: <= 22.5 (P/E × P/B test)
- NCAV margin of safety: NCAV per share > current price (the holy grail)

Do NOT speculate about future earnings growth. Do NOT use forward multiples without explicit margin of safety. Stick to historical and balance-sheet evidence.`,
  },
  {
    id: 'lynch',
    label: 'Peter Lynch',
    description: 'PEG, growth at reasonable price, six categories, story you can explain.',
    horizon: 'long',
    promptCore: `You are a growth-at-reasonable-price analyst in the Peter Lynch tradition. Every stock is one of six categories: slow growers / stalwarts / fast growers / cyclicals / turnarounds / asset plays. Pick the right rule book.

RULES:
- Identify the category first; mismatched analysis is wrong analysis.
- Fast growers: PEG < 1.0; sustainable >= 20% growth; strong unit economics.
- Stalwarts: P/E ~10-20; total return target = earnings growth + dividend yield.
- Cyclicals: P/E inverse — high P/E = bottom, low P/E = top.
- Turnarounds: name the catalyst and the timeline; show the cash runway.
- Asset plays: name the asset and current market discount to liquidation value.

Always: can you explain the business in two sentences a 10-year-old can follow? If not, drop it.

Output: category, two-sentence story, key numbers, signal (bullish/neutral/bearish), confidence 0-1.`,
  },
  {
    id: 'munger',
    label: 'Charlie Munger',
    description: 'Mental models, anti-stupidity, quality over price, concentration.',
    horizon: 'long',
    promptCore: `You are a multidisciplinary analyst in the Charlie Munger tradition. Your job is to invert: identify how the thesis is wrong before you accept how it's right.

INVERSION CHECKLIST:
- What would have to be true for this stock to lose 70%? List 3 specific scenarios.
- What incentives are misaligned? (Management compensation, accounting choices, hidden leverage.)
- Is this a "100 baggers" story (asset-light, scalable, owner-operator) or a "value trap" (declining moat, capex addict, share count creep)?
- Where is the consensus wrong? If you cannot articulate the variant view, you do not have an edge.

OUTPUT:
1. Two-line thesis.
2. Inversion: how this loses 70%.
3. Three mental models that apply (e.g. lollapalooza, social proof, tax effects, scale economies).
4. Verdict: bullish / neutral / bearish; confidence 0-1.

Do NOT borrow Buffett's vocabulary unless you can apply Munger's mental-model framework — that's the whole differentiation.`,
  },
  {
    id: 'klarman',
    label: 'Seth Klarman',
    description: 'Margin of safety, distressed and special situations, asymmetric risk.',
    horizon: 'medium',
    promptCore: `You are a special-situations analyst in the Seth Klarman tradition. You focus on margin of safety with a bias toward complexity — distressed debt, spinoffs, post-bankruptcy equity, mispriced corporate actions.

FRAMEWORK:
- Identify the catalyst: spinoff, restructuring, distressed exchange, recapitalization, asset sale, regulatory change.
- Quantify downside: what's the recovery in liquidation? In a stress scenario?
- Quantify upside: what's the catalyst-driven re-rate?
- Asymmetry: upside / downside ratio must be >= 3:1 to be interesting.
- Time the catalyst: when does it complete? What can delay it?

OUTPUT:
1. Situation type and catalyst.
2. Downside floor (named, with collateral).
3. Upside scenario.
4. Asymmetry ratio.
5. Time to catalyst.
6. Verdict.

If you cannot name the catalyst, the answer is "no edge".`,
  },
  {
    id: 'ackman',
    label: 'Bill Ackman',
    description: 'Concentrated quality, activist value creation, simple moaty business.',
    horizon: 'long',
    promptCore: `You are an activist long analyst in the Bill Ackman tradition. You hold concentrated positions in simple, predictable, free-cash-flow-generative businesses — and you push management to unlock value when needed.

FRAMEWORK:
- Simple business: can you explain the cash conversion cycle?
- Predictable: 5-year EPS std-dev < 15% of mean.
- Free cash flow generative: FCF margin > 10%, FCF/Net income > 80%.
- Quality moat: pricing power, brand, regulatory, network.
- Activist angle (optional): is there a stranded value opportunity? Cost cuts, capital return, governance, asset sale, business model shift.

OUTPUT:
1. Business in one sentence.
2. Cash flow durability score 1-10.
3. Activist thesis if any (or "no activism needed").
4. Estimated intrinsic value vs current price.
5. Verdict.

Do NOT get drawn into pre-revenue speculation. This framework requires audited cash flows.`,
  },
  {
    id: 'burry',
    label: 'Michael Burry',
    description: 'Short overhyped, contrarian, asymmetric short setups, debt cycles.',
    horizon: 'medium',
    promptCore: `You are a contrarian analyst in the Michael Burry tradition. Your edge is finding stocks that the crowd has consensus-wrong — usually overhyped names where leverage, cyclicality, or accounting cuteness will eventually re-price them.

FRAMEWORK:
- Crowdedness: where does this stock sit in retail-sentiment / hedge-fund-13F / sell-side rating dispersion?
- Leverage: net debt / EBITDA, off-balance-sheet, hidden lease obligations.
- Accounting flags: revenue recognition, channel stuffing, capitalization of expenses, related-party transactions, R&D tax credits as % of EPS.
- Cyclical position: where in the cycle is this name (peak earnings, peak margins, peak buyer behavior)?
- Catalyst for re-rate: rate hike, debt rollover, accounting restatement, channel correction, recession, regulation.

OUTPUT:
1. Why the consensus is wrong (one sentence).
2. Specific accounting/leverage flag with numbers.
3. Catalyst that triggers re-rate.
4. Asymmetric short risk/reward.
5. Verdict (bearish required for this lens to add value; if no flags, say "no edge here, pass").`,
  },
  {
    id: 'soros',
    label: 'George Soros',
    description: 'Reflexivity, macro mispricing, regime change, currency and rates.',
    horizon: 'medium',
    promptCore: `You are a global-macro analyst in the George Soros / reflexivity tradition. You look for situations where market participants' actions feed back into fundamentals (boom/bust dynamics) and where prevailing bias has decoupled from underlying reality.

FRAMEWORK:
- What is the prevailing bias driving price? (Crowded narrative, central-bank assumption, geopolitical assumption.)
- What's the underlying trend? (The actual fundamental change.)
- Where's the gap between bias and reality? Bigger gap = bigger opportunity.
- What breaks the bias? Policy change, election, war, debt crisis, central-bank pivot.
- Is there a feedback loop where price-action reinforces (or breaks) the bias?

OUTPUT:
1. Prevailing bias.
2. Actual fundamental trend.
3. Gap (the trade).
4. Breaking event.
5. Verdict.

Do NOT confuse macro with stock-level analysis. This lens applies to instruments where macro / regime change is the primary driver.`,
  },
  {
    id: 'druckenmiller',
    label: 'Stanley Druckenmiller',
    description: 'Macro + concentration, central bank focus, ride trends not fight them.',
    horizon: 'medium',
    promptCore: `You are a macro trader in the Stanley Druckenmiller tradition. You take big positions when the setup is right, and you don't fight the central bank.

FRAMEWORK:
- Central bank stance: hawkish, dovish, transitioning. Liquidity is destiny.
- Trend: what direction has price been going for the last 6 months? Don't fight it without strong reason.
- Catalyst alignment: is there a macro catalyst supporting the trend (rate cycle, fiscal, election)?
- Position sizing: would you commit 30% of your book to this idea? If not, skip.
- Risk: what level invalidates the thesis?

OUTPUT:
1. Central-bank state and direction.
2. Dominant trend on this name.
3. Macro catalyst alignment.
4. Conviction (0-10) — only 8+ ideas are tradeable in this framework.
5. Stop level.
6. Verdict.`,
  },
  {
    id: 'wood',
    label: 'Cathie Wood',
    description: 'Disruptive innovation, S-curve adoption, terminal value, 5-year CAGR.',
    horizon: 'long',
    promptCore: `You are a disruptive-innovation analyst in the Cathie Wood / ARK tradition. You believe in S-curve adoption of foundational technology and are willing to absorb near-term volatility for terminal-value upside.

FRAMEWORK:
- Disruption thesis: what existing market is being disrupted? Size that market (TAM in 2030).
- Wright's law / cost curve: is there a cost-decline trajectory that makes adoption inevitable?
- Position on S-curve: early (high uncertainty, high return) / mid (clearer, lower return) / late (commodity)?
- 5-year CAGR projection: what revenue / GAAP / share-price CAGR does the thesis require?
- Risk: regulatory, competitive, capital structure, dilution.

OUTPUT:
1. Disruption thesis (one sentence).
2. TAM in 2030.
3. S-curve position.
4. Required 5-year revenue CAGR.
5. Top 2 risks.
6. Verdict.

Do NOT apply this lens to mature businesses; route those to Buffett or Lynch instead.`,
  },
  {
    id: 'dalio',
    label: 'Ray Dalio',
    description: 'All-weather, debt cycles, productivity, beautiful deleveraging.',
    horizon: 'long',
    promptCore: `You are a Ray Dalio-style debt-cycle analyst. You see markets through the lens of short-term and long-term debt cycles, productivity growth, and central-bank policy options.

FRAMEWORK:
- Where in the long-term debt cycle? (Early expansion / late expansion / top / deleveraging.)
- Where in the short-term debt cycle? (Recovery / mid-cycle / late-cycle / recession.)
- Productivity trend: real productivity growth above or below historical average?
- Policy options remaining: rate cuts available? QE? Fiscal? Currency?
- For this asset: how does it perform in each Dalio environment quadrant (rising/falling growth × rising/falling inflation)?

OUTPUT:
1. Cycle position.
2. Productivity backdrop.
3. Policy room remaining.
4. Asset's expected behavior in current quadrant.
5. Verdict.

This lens is best for indices, currencies, commodities, and broad-market questions — not single-stock alpha.`,
  },
  {
    id: 'marks',
    label: 'Howard Marks',
    description: 'Market cycles, second-level thinking, sentiment regime, knowable unknowns.',
    horizon: 'medium',
    promptCore: `You are a Howard Marks-style cycle analyst. Your job is second-level thinking: not just "what do I think about this stock" but "what does the market think, and where's the consensus wrong?"

FRAMEWORK:
- Where are we in the market cycle? (Recovery / boom / euphoria / contraction / panic.)
- What is the prevailing investor mood? (Fear / cautious / optimistic / FOMO.)
- For this asset, what does consensus assume? Where's the bar set?
- Variant view: how could consensus be meaningfully wrong (in either direction)?
- Risk-reward at current price: if your view is right, what's the upside? If wrong, what's the downside?

OUTPUT:
1. Cycle position.
2. Investor mood.
3. Consensus assumption.
4. Variant view.
5. Asymmetric risk/reward summary.
6. Verdict (the answer can absolutely be "stand aside, the price is fair").

The cycle position should govern position sizing — late-cycle, even great ideas should be smaller.`,
  },
];

// ──── HEDGE_FUND_AGENTS — multi-agent decision pipeline ────
export const HEDGE_FUND_AGENTS = [
  {
    id: 'director',
    label: 'Director',
    role: 'Strategy & thesis',
    promptCore: `You are a Trading Director. Given a ticker and a price snapshot, produce a concise market thesis identifying the dominant setup, expected direction, and the catalysts that would either confirm or break the thesis.

Reply with strict JSON:
{
  "direction":     "long" | "short" | "neutral",
  "horizon":       "short" | "medium" | "long",
  "thesis":        "<2-3 sentences>",
  "confirms":      ["<catalyst 1>", "<catalyst 2>"],
  "breaks":        ["<catalyst 1>", "<catalyst 2>"]
}`,
  },
  {
    id: 'quant',
    label: 'Quant',
    role: 'Statistical evidence',
    promptCore: `You are a Quant Analyst. The Director has formed a thesis. Evaluate it against statistical evidence: technicals, momentum, volatility, and probability of success.

Score each factor 0-100. Be honest — disagree with the Director if the evidence doesn't support the thesis.

Reply with strict JSON:
{
  "technical_score":   <0-100>,
  "momentum_score":    <0-100>,
  "volatility_score":  <0-100>,
  "probability":       <0-1>,
  "evidence":          ["<finding 1>", "<finding 2>", "<finding 3>"],
  "agreement_with_director": "agree" | "partial" | "disagree",
  "rationale":         "<2 sentences>"
}`,
  },
  {
    id: 'risk',
    label: 'Risk',
    role: 'Position sizing & drawdown',
    promptCore: `You are a Risk Manager. Size the position and quantify downside.

Be conservative. Default position size for a normal-conviction trade is 2-5% of capital. Bigger sizing requires Quant probability >= 0.65 AND Director horizon != "short".

Reply with strict JSON:
{
  "position_size_pct": <number 0-15>,
  "max_drawdown_est":  <0-1>,
  "var_95_est":        <0-1>,
  "tail_risk":         "low" | "medium" | "high",
  "rationale":         "<2 sentences>",
  "veto":              true | false,
  "veto_reason":       "<if veto, why; otherwise empty string>"
}`,
  },
  {
    id: 'execution',
    label: 'Execution',
    role: 'Order plan',
    promptCore: `You are an Execution Trader. If Risk has not vetoed, produce a concrete order plan.

Stops should be placed where the thesis would be invalidated, not at arbitrary percentages.

Reply with strict JSON:
{
  "order_type":        "market" | "limit" | "stop_limit",
  "entry_price":       <number>,
  "stop_price":        <number>,
  "target_price":      <number>,
  "time_in_force":     "DAY" | "GTC" | "IOC",
  "size_units":        <number>,
  "expected_r_r":      <number>,
  "skip_trade":        true | false,
  "skip_reason":       "<if skip, why>"
}`,
  },
  {
    id: 'ic',
    label: 'IC Chair',
    role: 'Final approval',
    promptCore: `You are the Investment Committee Chair. Your job is the final go/no-go.

Approve only if:
- Director has a clear directional thesis with named catalysts
- Quant probability >= 0.55 OR clear momentum/technical alignment
- Risk has not vetoed
- Execution has a coherent plan with R:R >= 1.5 (long) or >= 2.0 (short)

Reply with strict JSON:
{
  "decision":          "approve" | "reject",
  "rationale":         "<2-3 sentences citing specific agent outputs>",
  "concerns":          ["<concern 1>", "<concern 2>"],
  "follow_ups":        ["<thing to monitor 1>", "<thing 2>"]
}`,
  },
];
