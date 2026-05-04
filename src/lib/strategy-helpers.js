// IMO Onyx Terminal — Strategy & scanner helpers
//
// Phase 3p.37 (TS-driven extraction): 8 helper functions used by
// quant-lab-page.jsx and scanner-page.jsx but defined only in monolith.
// All surfaced by `tsc -p tsconfig.sweep.json --noEmit` with checkJs:true.
//
// quant-lab-page consumers (4):
//   compileCodeStrategy  — JS strategy compiler (uses QUANT_PRIMITIVES)
//   stepDebugStrategy    — single-bar replay with breakpoint support
//   renderOptionPayoffSVG— inline option payoff diagram
//   buildToyRLAgent      — toy reinforcement-learning policy
//
// scanner-page consumers (4):
//   detectSetupsMTF      — multi-timeframe setup detection
//   renderSetupSVG       — inline thumbnail of detected setup
//   summarizeSetupWithAI — AI explanation of detected setup
//   runHedgeFundTeam     — hedge-fund multi-agent decision pipeline

import { QUANT_PRIMITIVES } from './quant/backtest-engine.js';
import { computeOptionLegPnL } from './quant/options-payoff.js';
import { HEDGE_FUND_AGENTS, SETUP_RULES } from './scanner-config.js';
import { resolveActiveProvider } from './llm-providers.js';
import { callAI } from './ai-calls.js';

// (Note: callAI, INVESTOR_LENSES, HEDGE_FUND_AGENTS, INSTRUMENTS, fmt,
// fmtCompact, fetchPolygonAggs etc are all imported in the consumer
// modules — these helper functions assume they're called in a context
// where those names resolve. Strategy assumes the caller passes data
// rather than referencing global state.)


// renderOptionPayoffSVG — multi-leg P&L curve at expiry. Highlights
// breakeven crosses, max profit / loss, current spot.
export const renderOptionPayoffSVG = (legs, opts = {}) => {
  if (!Array.isArray(legs) || legs.length === 0) return '';
  const w = opts.width || 480;
  const h = opts.height || 280;
  const padL = 44, padR = 12, padT = 18, padB = 24;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  // Spot range — center on average strike, span ±40%
  const strikes = legs.map(l => Number(l.strike) || 0).filter(v => v > 0);
  const spot = opts.spot || (strikes.length > 0 ? strikes.reduce((a, b) => a + b, 0) / strikes.length : 100);
  const lo = spot * 0.6;
  const hi = spot * 1.4;
  const grid = [];
  const steps = 200;
  for (let i = 0; i <= steps; i++) grid.push(lo + (hi - lo) * (i / steps));
  // Sum P&L across legs
  const legPnLs = legs.map(l => computeOptionLegPnL(l, grid));
  const totalPnL = grid.map((_, i) => legPnLs.reduce((a, ls) => a + ls[i], 0));
  const minP = Math.min(...totalPnL);
  const maxP = Math.max(...totalPnL);
  const padPx = (maxP - minP) * 0.1 || 1;
  const yMin = minP - padPx;
  const yMax = maxP + padPx;
  const xScale = (s) => padL + ((s - lo) / (hi - lo)) * innerW;
  const yScale = (p) => padT + innerH - ((p - yMin) / (yMax - yMin)) * innerH;
  // Curve path
  let pathD = '';
  for (let i = 0; i < grid.length; i++) {
    const cmd = i === 0 ? 'M' : 'L';
    pathD += `${cmd} ${xScale(grid[i])} ${yScale(totalPnL[i])} `;
  }
  // Zero P&L line
  const zeroY = yScale(0);
  // Breakeven points (where curve crosses zero)
  const breakevens = [];
  for (let i = 1; i < grid.length; i++) {
    if ((totalPnL[i - 1] <= 0 && totalPnL[i] > 0) ||
        (totalPnL[i - 1] >= 0 && totalPnL[i] < 0)) {
      // Linear interpolate
      const dx = grid[i] - grid[i - 1];
      const dy = totalPnL[i] - totalPnL[i - 1];
      const x = grid[i - 1] - totalPnL[i - 1] * dx / (dy || 1);
      breakevens.push(x);
    }
  }
  // Tick marks on x-axis (5 evenly spaced)
  let xTicks = '';
  for (let i = 0; i <= 4; i++) {
    const s = lo + (hi - lo) * (i / 4);
    const x = xScale(s);
    xTicks += `<line x1="${x}" y1="${padT + innerH}" x2="${x}" y2="${padT + innerH + 3}" stroke="#9CA3AF" stroke-width="0.5"/>` +
              `<text x="${x}" y="${padT + innerH + 14}" font-size="9" fill="#9CA3AF" text-anchor="middle" font-family="ui-monospace,monospace">${s.toFixed(0)}</text>`;
  }
  let yTicks = '';
  for (let i = 0; i <= 4; i++) {
    const p = yMin + (yMax - yMin) * (i / 4);
    const y = yScale(p);
    yTicks += `<line x1="${padL - 3}" y1="${y}" x2="${padL}" y2="${y}" stroke="#9CA3AF" stroke-width="0.5"/>` +
              `<text x="${padL - 5}" y="${y + 3}" font-size="9" fill="#9CA3AF" text-anchor="end" font-family="ui-monospace,monospace">${p.toFixed(0)}</text>`;
  }
  // Profit/loss zone shading
  let shading = '';
  for (let i = 1; i < grid.length; i++) {
    const x1 = xScale(grid[i - 1]);
    const x2 = xScale(grid[i]);
    const y1 = yScale(totalPnL[i - 1]);
    const y2 = yScale(totalPnL[i]);
    // Profit slice (above zero) → green tint; loss slice → red tint
    if (totalPnL[i - 1] >= 0 && totalPnL[i] >= 0) {
      shading += `<polygon points="${x1},${zeroY} ${x1},${y1} ${x2},${y2} ${x2},${zeroY}" fill="rgba(31,178,107,0.12)"/>`;
    } else if (totalPnL[i - 1] <= 0 && totalPnL[i] <= 0) {
      shading += `<polygon points="${x1},${zeroY} ${x1},${y1} ${x2},${y2} ${x2},${zeroY}" fill="rgba(255,85,119,0.12)"/>`;
    }
  }
  let breakevenMarkers = '';
  for (const b of breakevens) {
    const x = xScale(b);
    breakevenMarkers += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + innerH}" stroke="#FFB84D" stroke-width="1" stroke-dasharray="3 2" opacity="0.7"/>` +
                       `<text x="${x}" y="${padT + 11}" font-size="9" fill="#FFB84D" text-anchor="middle" font-family="ui-monospace,monospace">BE ${b.toFixed(2)}</text>`;
  }
  // Spot marker
  const spotX = xScale(spot);
  const spotMarker = `<line x1="${spotX}" y1="${padT}" x2="${spotX}" y2="${padT + innerH}" stroke="#7AC8FF" stroke-width="1" stroke-dasharray="2 2" opacity="0.7"/>` +
                    `<text x="${spotX}" y="${h - 4}" font-size="9" fill="#7AC8FF" text-anchor="middle" font-family="ui-monospace,monospace">spot ${spot.toFixed(2)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="background:#0F1115;border-radius:6px;font-family:ui-sans-serif,system-ui,sans-serif">
    <rect width="${w}" height="${h}" fill="#0F1115" rx="6"/>
    ${shading}
    <line x1="${padL}" y1="${zeroY}" x2="${w - padR}" y2="${zeroY}" stroke="#9CA3AF" stroke-width="0.5" opacity="0.6"/>
    <path d="${pathD}" fill="none" stroke="#1FB26B" stroke-width="2"/>
    ${xTicks}
    ${yTicks}
    ${breakevenMarkers}
    ${spotMarker}
    <text x="${padL}" y="12" font-size="10" fill="#9CA3AF">P&amp;L at expiry</text>
  </svg>`;
};

// Strategy storage — saved strategies persist in localStorage so
// users don't lose work across sessions. Each entry is:
//   { id, name, mode: 'builder'|'code'|'cross-section',
//     factors?, threshold?, code?, basket?, factorId?,
//     savedAt, lastRunStats? }

// Code-mode strategy compilation — wraps user-provided code in a
// safe Function() call. The user writes code that returns
// 'enter'|'exit'|'hold' from each bar, with QUANT_PRIMITIVES
// available as `prim`, current bar as `bar`, full bar history as
// `bars`, current index as `i`, position context as `ctx`.
//
// We use Function() instead of eval() so the code runs in the
// global lexical scope rather than inheriting our local closures.
// Still client-side trust — a malicious strategy can read window
// state, hit the network, etc. Users running their own code in
// their own browser is the threat model; we don't accept code
// from other users.
// compileCodeStrategy — wraps user JS in a Function() with sandboxed
// console + helpers. Returns an object:
//   { fn, error, logs }   where:
//     fn    = (bars, i, ctx) => 'enter'|'exit'|'hold' (or null on err)
//     error = parse-time error string (or null)
//     logs  = array of captured console.log/warn/error calls during
//             the most recent backtest run; flushed on each run
//
// User code has access to:
//   bars  — full OHLCV array
//   i     — current bar index
//   ctx   — { pos, entryPx, cash, capital, ... }  (caller-extensible)
//   prim  — QUANT_PRIMITIVES registry
//   log   — console.log proxy that captures (limited to 200 entries
//           total per run to avoid OOM for noisy strategies)
//   util  — small helper bundle: {
//             sma, ema, rsi, macd, bb, atr, stoch, roc, obv, mom,
//             vol, volz, range, close,  // QUANT_PRIMITIVES re-exported
//             max, min, abs, sqrt, log, exp,  // Math passthroughs
//             cross, crossUnder,                // event helpers below
//             clamp,                            // (x, lo, hi) => bounded
//           }
//
// Event helpers:
//   cross(a, b)       — true on the bar where series a crosses above b
//   crossUnder(a, b)  — true on the bar where series a crosses below b
// Both take values from current and previous bar (caller passes them in).

export const compileCodeStrategy = (code, opts = {}) => {
  if (!code || typeof code !== 'string') return { fn: null, error: null, logs: [] };
  const strict = !!opts.strict;
  const logs = [];
  const MAX_LOGS = 200;
  // Build a structured `util` bundle the user can call into.
  const util = {
    ...QUANT_PRIMITIVES,
    max: Math.max, min: Math.min, abs: Math.abs, sqrt: Math.sqrt,
    log: Math.log, exp: Math.exp,
    clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
    cross:      (a, b, aPrev, bPrev) => aPrev <= bPrev && a > b,
    crossUnder: (a, b, aPrev, bPrev) => aPrev >= bPrev && a < b,
  };
  // Capture console.log calls from inside the strategy. Each log
  // entry is tagged with the current bar index so the UI can group
  // logs by bar (a "source-mapped" view, even if not line-accurate).
  // Also do best-effort stack-trace parsing to extract the line in
  // user code that emitted the log.
  let currentBarIdx = -1;
  const captureLog = (level) => (...args) => {
    if (logs.length >= MAX_LOGS) return;
    const msg = args.map(a => {
      try {
        if (typeof a === 'string') return a;
        if (typeof a === 'number') return Number.isFinite(a) ? a.toString() : String(a);
        return JSON.stringify(a);
      } catch { return String(a); }
    }).join(' ');
    // Best-effort stack-frame extraction. The user's code lives in an
    // anonymous Function that V8 reports as "<anonymous>:<line>:<col>".
    // We pull the first such frame and surface line+col.
    let codeLine = null, codeCol = null;
    try {
      const stack = new Error().stack || '';
      const m = stack.match(/<anonymous>:(\d+):(\d+)/);
      if (m) {
        // Subtract 2 because new Function() adds one wrapper line at the top
        codeLine = Math.max(1, Number(m[1]) - 2);
        codeCol = Number(m[2]);
      }
    } catch { /* nbd if stack parsing fails */ }
    logs.push({ level, msg, ts: Date.now(), barIdx: currentBarIdx, line: codeLine, col: codeCol });
  };
  const sandboxConsole = {
    log:   captureLog('log'),
    warn:  captureLog('warn'),
    error: captureLog('error'),
    info:  captureLog('log'),
  };
  // Strict-mode bars wrapper — throws on any index access > current i.
  // This is the strongest form of lookahead detection: anything the
  // strategy actually does at runtime is checked, not just lexically.
  // Slight perf cost (Proxy adds overhead per access) so it's opt-in.
  const wrapBarsStrict = (bars, i) => {
    return new Proxy(bars, {
      get(target, prop) {
        if (prop === 'length') {
          // Pretend the array ends at i+1 so even .length checks see only past
          return i + 1;
        }
        if (prop === 'slice') {
          // Force slice to never go past i
          return (start, end) => {
            const s = start == null ? 0 : Number(start);
            const e = end == null ? i + 1 : Math.min(Number(end), i + 1);
            if (s > i) {
              throw new Error(`[strict] bars.slice(${start}, ${end}) at i=${i} reads future data`);
            }
            return Array.prototype.slice.call(target, s, e);
          };
        }
        // Numeric index access — block anything past i
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          const idx = Number(prop);
          if (idx > i) {
            throw new Error(`[strict] bars[${idx}] at i=${i} is lookahead bias`);
          }
        }
        return target[prop];
      },
    });
  };
  try {
    // Wrap user code in a function body with all bindings injected
    const fn = new Function(
      'bars', 'i', 'ctx', 'prim', 'util', 'log', 'console',
      code,
    );
    const wrapped = (bars, i, ctx) => {
      currentBarIdx = i;  // tag any console.log from this bar with this index
      try {
        const usedBars = strict ? wrapBarsStrict(bars, i) : bars;
        const r = fn(usedBars, i, ctx, QUANT_PRIMITIVES, util, sandboxConsole.log, sandboxConsole);
        if (r === 'enter' || r === 'exit' || r === 'hold') return r;
        return 'hold';
      } catch (e) {
        if (logs.length < MAX_LOGS) {
          logs.push({ level: 'error', msg: `[runtime] ${e?.message || e}`, ts: Date.now(), barIdx: i });
        }
        return 'hold';
      }
    };
    return { fn: wrapped, error: null, logs };
  } catch (e) {
    return { fn: null, error: e?.message || 'Syntax error', logs };
  }
};

// stepDebugStrategy — runs the strategy bar-by-bar capturing the
// signal output, position state, and any console output at each step.
// Used by the Code mode "step debugger" UI.
//
// Returns an array of { i, t, bar, signal, pos, cash, equity, logs }
// — one entry per bar (or up to maxSteps to bound memory).
export const stepDebugStrategy = (bars, fn, opts = {}) => {
  const maxSteps = opts.maxSteps || 500;
  const startIdx = opts.startIdx || 0;
  const endIdx = Math.min(bars.length - 1, startIdx + maxSteps - 1);
  const trace = [];
  let cash = opts.capital || 10000;
  let pos = 0, entryPx = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const bar = bars[i];
    const stepLogs = [];
    // Call the strategy with a wrapper that captures logs
    // (fn already has logs going into compileCodeStrategy's internal
    // array; for the step debugger we want a per-bar slice, but the
    // simplest API is to just record signals and key indicator values
    // at this step rather than reach into the compiled function's log
    // array. So we don't capture logs here — that's done in runCode.)
    let signal = 'hold';
    try {
      signal = fn(bars, i, { pos, entryPx, cash, capital: opts.capital || 10000 }) || 'hold';
    } catch (e) {
      stepLogs.push({ level: 'error', msg: `[runtime] ${/** @type {Error} */ (e).message}` });
    }
    if (signal === 'enter' && pos === 0) {
      pos = cash / bar.close;
      entryPx = bar.close;
      cash = 0;
    } else if (signal === 'exit' && pos > 0) {
      cash = pos * bar.close;
      pos = 0;
      entryPx = 0;
    }
    const equity = cash + pos * bar.close;
    // Capture key indicator values for this bar (cheap subset)
    const indicators = {
      rsi: QUANT_PRIMITIVES.rsi(bars, i, 14),
      sma20: QUANT_PRIMITIVES.sma(bars, i, 20),
      sma50: QUANT_PRIMITIVES.sma(bars, i, 50),
      ema20: QUANT_PRIMITIVES.ema(bars, i, 20),
      mom20: QUANT_PRIMITIVES.mom(bars, i, 20),
      vol20: QUANT_PRIMITIVES.vol(bars, i, 20),
    };
    trace.push({
      i, t: bar.t,
      bar: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
      signal, pos, cash, equity, entryPx,
      indicators, logs: stepLogs,
    });
  }
  return trace;
};

// detectSetupsMTF — multi-timeframe variant. Runs detectors against
// daily bars (primary) AND weekly bars (resampled), then boosts the
// score of any setup that has a confirming signal on the higher
// timeframe.
//
// "Confirming" = the same side direction is detected on both daily
// and weekly. So a daily bull-breakout that also has e.g. a weekly
// higher-low-stack gets +20 score; a daily bear-breakdown without
// weekly confirmation stays at the base score.
//
// This is the "resonance" pattern from the Vibe-Trading TA panel
// preset — multiple frameworks/timeframes agreeing increases
// confidence.
export const detectSetupsMTF = (bars, ticker, detectorParams = {}) => {
  // Primary daily setups
  const daily = detectSetups(bars, ticker, detectorParams);
  if (daily.length === 0) return [];
  // Weekly setups for confluence
  const weekly = resampleBarsToWeekly(bars);
  let weeklySetups = [];
  if (weekly.length >= 20) {
    weeklySetups = detectSetups(weekly, ticker, detectorParams);
  }
  // Boost daily setups that have weekly confirmation on the same side
  for (const d of daily) {
    const matchSide = weeklySetups.filter(w => w.side === d.side);
    if (matchSide.length > 0) {
      const bestWeekly = matchSide[0];
      d.score = Math.min(100, d.score + 20);
      d.mtfBoost = true;
      d.weeklyConfirm = { ruleId: bestWeekly.ruleId, label: bestWeekly.label, score: bestWeekly.score };
      d.notes = `${d.notes} · weekly confirms (${bestWeekly.label})`;
    } else if (weeklySetups.some(w => w.side !== d.side && w.side !== 'neutral')) {
      // Weekly setup is in opposite direction — penalty
      d.score = Math.max(20, d.score - 15);
      d.mtfConflict = true;
      d.notes = `${d.notes} · weekly suggests opposite direction`;
    }
  }
  // Re-sort after score adjustments
  daily.sort((a, b) => b.score - a.score);
  return daily;
};

// renderSetupSVG — produce an inline SVG (returned as string) showing
// the setup visually: candle chart of the last ~60 bars + setup-
// specific overlays (key levels, breakout line, etc.).
//
// Returns the SVG markup as a string so callers can either dangerouslySetInnerHTML
// it or convert to data URL for use in notification icons.
export const renderSetupSVG = (candidate, opts = {}) => {
  const w = opts.width  || 480;
  const h = opts.height || 240;
  const padL = 36, padR = 8, padT = 14, padB = 22;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  // Last 60 bars (or fewer) for the chart
  const tail = (candidate.bars || []).slice(-60);
  if (tail.length === 0) return '';
  const minP = Math.min(...tail.map(b => b.low ?? b.close));
  const maxP = Math.max(...tail.map(b => b.high ?? b.close));
  const range = maxP - minP || 1;
  const padPx = range * 0.05;
  const yMin = minP - padPx;
  const yMax = maxP + padPx;
  const yScale = (p) => padT + innerH - ((p - yMin) / (yMax - yMin)) * innerH;
  const xScale = (idx) => padL + (idx / Math.max(1, tail.length - 1)) * innerW;
  const candleW = Math.max(1.5, innerW / tail.length * 0.7);
  const sideTone = candidate.side === 'long'  ? '#1FB26B'
                : candidate.side === 'short' ? '#FF5577'
                :                                '#7AC8FF';
  const bgTone   = '#0F1115';
  const gridTone = 'rgba(255,255,255,0.08)';
  const textTone = '#9CA3AF';
  const candles = tail.map((bar, idx) => {
    const x = xScale(idx);
    const yO = yScale(bar.open ?? bar.close);
    const yC = yScale(bar.close);
    const yH = yScale(bar.high ?? bar.close);
    const yL = yScale(bar.low  ?? bar.close);
    const isUp = (bar.close ?? 0) >= (bar.open ?? bar.close ?? 0);
    const fill = isUp ? '#1FB26B' : '#FF5577';
    return `<line x1="${x}" y1="${yH}" x2="${x}" y2="${yL}" stroke="${fill}" stroke-width="1" />` +
           `<rect x="${x - candleW / 2}" y="${Math.min(yO, yC)}" width="${candleW}" height="${Math.max(0.5, Math.abs(yC - yO))}" fill="${fill}" />`;
  }).join('');
  // Setup-specific overlays
  let overlays = '';
  const lvl = candidate.levels || {};
  const drawHLine = (price, label, color, dash) => {
    if (price == null || !Number.isFinite(price)) return '';
    const y = yScale(price);
    return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${color}" stroke-width="1" stroke-dasharray="${dash || '4 3'}" opacity="0.8"/>` +
           `<text x="${w - padR - 4}" y="${y - 3}" font-size="9" fill="${color}" text-anchor="end" font-family="ui-sans-serif,system-ui,sans-serif">${label} ${price.toFixed(2)}</text>`;
  };
  if (candidate.ruleId === 'bull-breakout' || candidate.ruleId === 'bear-breakdown') {
    overlays += drawHLine(lvl.breakout || lvl.breakdown, candidate.ruleId === 'bull-breakout' ? 'Breakout' : 'Breakdown', sideTone, '5 3');
    overlays += drawHLine(lvl.stop, 'Stop', '#FF5577', '2 3');
    overlays += drawHLine(lvl.target, 'Target', '#1FB26B', '2 3');
  } else if (candidate.ruleId === 'oversold-bounce' || candidate.ruleId === 'overbought-fade' ||
             candidate.ruleId === 'macd-bull-cross' || candidate.ruleId === 'macd-bear-cross' ||
             candidate.ruleId === 'volume-thrust') {
    overlays += drawHLine(lvl.entry, 'Entry', sideTone, '3 3');
    overlays += drawHLine(lvl.stop, 'Stop', '#FF5577', '2 3');
    overlays += drawHLine(lvl.target, 'Target', '#1FB26B', '2 3');
  } else if (candidate.ruleId === 'bb-squeeze') {
    overlays += drawHLine(lvl.upperBand, 'Upper BB', '#7AC8FF', '3 3');
    overlays += drawHLine(lvl.mid, 'Mid', textTone, '3 3');
    overlays += drawHLine(lvl.lowerBand, 'Lower BB', '#7AC8FF', '3 3');
  } else if (candidate.ruleId === 'golden-cross' || candidate.ruleId === 'death-cross') {
    overlays += drawHLine(lvl.sma50, 'SMA50', '#FFB84D', '4 3');
    overlays += drawHLine(lvl.sma200, 'SMA200', '#9F88FF', '4 3');
  } else if (candidate.ruleId === 'bull-flag') {
    overlays += drawHLine(lvl.flagHigh, 'Flag high', sideTone, '5 3');
    overlays += drawHLine(lvl.flagLow, 'Flag low', sideTone, '3 3');
    overlays += drawHLine(lvl.target, 'Target', '#1FB26B', '2 3');
  }
  // Y-axis ticks (3 levels)
  let ticks = '';
  for (let frac of [0, 0.5, 1]) {
    const p = yMin + (yMax - yMin) * frac;
    const y = yScale(p);
    ticks += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${gridTone}" stroke-width="0.5"/>` +
             `<text x="${padL - 4}" y="${y + 3}" font-size="9" fill="${textTone}" text-anchor="end" font-family="ui-monospace,monospace">${p.toFixed(2)}</text>`;
  }
  const sideLabel = candidate.side ? candidate.side.toUpperCase() : '';
  const headerText = `${candidate.ticker} · ${candidate.label} · ${sideLabel} · score ${candidate.score}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="background:${bgTone};border-radius:6px;font-family:ui-sans-serif,system-ui,sans-serif">
    <rect width="${w}" height="${h}" fill="${bgTone}" rx="6"/>
    ${ticks}
    <text x="${padL}" y="11" font-size="10" fill="${sideTone}" font-weight="600">${headerText}</text>
    ${candles}
    ${overlays}
  </svg>`;
};

// summarizeSetupWithAI — optional one-shot LLM call that turns the
// detected setup into a 2-3 sentence trader-voice narrative.
// Returns { summary: string } or { error: string }.
//
// Uses the active LLM provider (resolveActiveProvider) — fails
// silently to a deterministic template when no provider is configured,
// so the scanner still returns useful results without an LLM key.
export const summarizeSetupWithAI = async (candidate) => {
  const provider = (typeof resolveActiveProvider === 'function')
    ? resolveActiveProvider() : null;
  if (!provider) {
    return {
      summary: `${candidate.label} on ${candidate.ticker}: ${candidate.notes}. Score ${candidate.score}/100. ${
        candidate.side === 'long' ? 'Long bias' : candidate.side === 'short' ? 'Short bias' : 'Neutral / wait for direction'
      }.`,
    };
  }
  try {
    const lvl = candidate.levels || {};
    const lvlStr = Object.entries(lvl)
      .filter(([_, v]) => Number.isFinite(v))
      .map(([k, v]) => `${k}: ${v.toFixed(2)}`).join(', ');
    const prompt = `You are a senior trading analyst. The scanner has identified this setup. Write a 2-3 sentence trader-voice narrative explaining what's happening, what to do, and what would invalidate the thesis. No emojis, no bullet points, no markdown.

Ticker: ${candidate.ticker}
Setup: ${candidate.label} (${candidate.side} bias)
Score: ${candidate.score}/100
Detector notes: ${candidate.notes}
Key levels: ${lvlStr}`;
    const ai = await provider.provider.callChat(
      [{ role: 'user', content: prompt }],
      { model: provider.model.id, maxTokens: 200 },
    );
    const text = typeof ai === 'string' ? ai : ai?.content?.[0]?.text || '';
    return { summary: (text || '').trim() };
  } catch (e) {
    return {
      summary: `${candidate.label} on ${candidate.ticker}: ${candidate.notes}.`,
      error: e?.message,
    };
  }
};

// ════════════════════════════════════════════════════════════════════
// HEDGE FUND TEAM — multi-agent IC deliberation flow
// ════════════════════════════════════════════════════════════════════
//
// Adapted from AutoHedge's Director/Quant/Risk/Execution pattern
// + the Renaissance-style Investment Committee deliberation pattern
// from FinceptTerminal's hedgeFundAgents config.
//
// Workflow:
//   1. Director  → forms initial thesis given the ticker + price snapshot
//   2. Quant     → tests thesis against statistical evidence
//   3. Risk      → assesses position-sizing, drawdown, and tail risk
//   4. Execution → produces concrete entry/stop/target/time-in-force
//   5. IC        → final approval check; can reject if any prior agent
//                  raised a red flag the others didn't address

// runHedgeFundTeam — execute all 5 agents in sequence, threading
// each agent's structured output forward. onProgress callback fires
// after each step so the UI can render incrementally.
export const runHedgeFundTeam = async (ticker, bars, onProgress = null) => {
  const provider = (typeof resolveActiveProvider === 'function') ? resolveActiveProvider() : null;
  if (!provider) return { error: 'No AI provider configured' };
  const snap = (() => {
    if (!bars || bars.length < 2) return 'No price data';
    const last = bars[bars.length - 1];
    const first = bars[0];
    const ret = (last.close - first.close) / first.close;
    const ret1m = bars.length >= 21
      ? (last.close - bars[bars.length - 21].close) / bars[bars.length - 21].close : null;
    const high52 = Math.max(...bars.slice(-252).map(b => b.high || b.close));
    const low52 = Math.min(...bars.slice(-252).map(b => b.low || b.close));
    const drawFromHigh = (last.close - high52) / high52;
    return [
      `Last close: ${last.close.toFixed(2)}`,
      `Total return (window): ${(ret * 100).toFixed(2)}%`,
      ret1m != null ? `1m return: ${(ret1m * 100).toFixed(2)}%` : null,
      `52w high: ${high52.toFixed(2)} (${(drawFromHigh * 100).toFixed(1)}% off)`,
      `52w low: ${low52.toFixed(2)}`,
    ].filter(Boolean).join(', ');
  })();
  const results = {};
  const contextStr = (priorIds) => {
    const lines = [];
    for (const id of priorIds) {
      if (results[id] && !results[id].error) {
        lines.push(`${id.toUpperCase()} OUTPUT:\n${JSON.stringify(results[id], null, 2)}`);
      }
    }
    return lines.length > 0 ? '\n\nPRIOR TEAM OUTPUTS:\n' + lines.join('\n\n') : '';
  };
  for (let i = 0; i < HEDGE_FUND_AGENTS.length; i++) {
    const agent = HEDGE_FUND_AGENTS[i];
    const priorIds = HEDGE_FUND_AGENTS.slice(0, i).map(a => a.id);
    const prompt = `${agent.promptCore}

Ticker: ${ticker}
Price snapshot: ${snap}${contextStr(priorIds)}`;
    try {
      const response = await provider.provider.callChat(
        [{ role: 'user', content: prompt }],
        { model: provider.model.id, maxTokens: 700 },
      );
      const text = typeof response === 'string' ? response : response?.content?.[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        results[agent.id] = { error: 'AI did not return JSON', raw: text };
      } else {
        try {
          results[agent.id] = JSON.parse(jsonMatch[0]);
        } catch (e) {
          results[agent.id] = { error: 'JSON parse error: ' + /** @type {Error} */ (e).message, raw: jsonMatch[0] };
        }
      }
    } catch (e) {
      results[agent.id] = { error: e?.message || 'Agent call failed' };
    }
    if (onProgress) onProgress(agent.id, results[agent.id]);
  }
  return { ticker, results, asOf: Date.now() };
};

export const buildToyRLAgent = () => {
  // 3 RSI buckets × 3 trend buckets × 2 position states = 18 states
  // Q[state][action] starts at zero, ε-greedy exploration.
  const Q = {};
  const stateKey = (rsiB, trendB, hasPos) => `${rsiB}|${trendB}|${hasPos ? 1 : 0}`;
  const ensureState = (key) => {
    if (!Q[key]) Q[key] = { hold: 0, buy: 0, sell: 0 };
    return Q[key];
  };
  const discretize = (bars, i) => {
    const r = QUANT_PRIMITIVES.rsi(bars, i) ?? 50;
    const m = QUANT_PRIMITIVES.mom(bars, i, 10) ?? 0;
    const rsiB = r < 35 ? 0 : r < 65 ? 1 : 2;
    const trendB = m < -0.02 ? 0 : m < 0.02 ? 1 : 2;
    return { rsiB, trendB };
  };
  return {
    Q,
    train: (bars, episodes = 50, lr = 0.1, gamma = 0.95, epsilon = 0.2) => {
      const n = bars.length;
      if (n < 30) return { episodes: 0, finalEquity: 1 };
      const rewardsPerEpisode = [];
      for (let ep = 0; ep < episodes; ep++) {
        let pos = 0, entryPx = 0, cash = 1, equity = 1;
        let totalReward = 0;
        for (let i = 30; i < n - 1; i++) {
          const { rsiB, trendB } = discretize(bars, i);
          const sKey = stateKey(rsiB, trendB, pos > 0);
          const qs = ensureState(sKey);
          // ε-greedy
          let action;
          if (Math.random() < epsilon) {
            const acts = ['hold', 'buy', 'sell'];
            action = acts[Math.floor(Math.random() * 3)];
          } else {
            action = ['hold', 'buy', 'sell'].reduce((best, a) => qs[a] > qs[best] ? a : best, 'hold');
          }
          // Apply action
          const px = bars[i].close;
          const pxNext = bars[i + 1].close;
          if (action === 'buy' && pos === 0) {
            pos = cash / px; entryPx = px; cash = 0;
          } else if (action === 'sell' && pos > 0) {
            cash = pos * px; pos = 0; entryPx = 0;
          }
          // Compute reward = next-bar equity change
          const nextEquity = cash + pos * pxNext;
          const reward = nextEquity - equity;
          totalReward += reward;
          // Q-learning update
          const { rsiB: nRsiB, trendB: nTrendB } = discretize(bars, i + 1);
          const sNextKey = stateKey(nRsiB, nTrendB, pos > 0);
          const qsNext = ensureState(sNextKey);
          const maxNext = Math.max(qsNext.hold, qsNext.buy, qsNext.sell);
          qs[action] = qs[action] + lr * (reward + gamma * maxNext - qs[action]);
          equity = nextEquity;
        }
        rewardsPerEpisode.push(totalReward);
        // Decay epsilon slightly each episode for less exploration over time
        epsilon = Math.max(0.05, epsilon * 0.98);
      }
      return { episodes, rewardsPerEpisode };
    },
    // Build a strategy function from the trained Q table for replay
    asStrategy: () => (bars, i, ctx) => {
      if (i < 30) return 'hold';
      const { rsiB, trendB } = discretize(bars, i);
      const sKey = stateKey(rsiB, trendB, ctx.pos > 0);
      const qs = Q[sKey] || { hold: 0, buy: 0, sell: 0 };
      const action = ['hold', 'buy', 'sell'].reduce((best, a) => qs[a] > qs[best] ? a : best, 'hold');
      if (action === 'buy' && ctx.pos === 0) return 'enter';
      if (action === 'sell' && ctx.pos > 0) return 'exit';
      return 'hold';
    },
  };
};


// resampleBarsToWeekly — turn daily bars into weekly OHLCV. Groups by
// ISO week (Monday-anchored). Useful for multi-timeframe analysis.
export const resampleBarsToWeekly = (dailyBars) => {
  if (!dailyBars || dailyBars.length === 0) return [];
  const weeks = [];
  let curWeek = null;
  let curWeekKey = null;
  for (const bar of dailyBars) {
    const d = new Date(bar.t);
    // ISO week — number of days since Monday of that week
    const day = d.getUTCDay() || 7;          // 1-7, Mon-Sun
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - (day - 1));
    monday.setUTCHours(0, 0, 0, 0);
    const key = monday.getTime();
    if (key !== curWeekKey) {
      if (curWeek) weeks.push(curWeek);
      curWeek = {
        t: key,
        open: bar.open,
        high: bar.high,
        low:  bar.low,
        close: bar.close,
        volume: bar.volume || 0,
      };
      curWeekKey = key;
    } else {
      curWeek.high = Math.max(curWeek.high, bar.high);
      curWeek.low  = Math.min(curWeek.low, bar.low);
      curWeek.close = bar.close;
      curWeek.volume = (curWeek.volume || 0) + (bar.volume || 0);
    }
  }
  if (curWeek) weeks.push(curWeek);
  return weeks;
};


// detectSetups — runs every SETUP_RULES detector against the latest
// bar (i = bars.length - 1) and returns all matching candidates.
// Inlined because ScannerPage is the primary surface for this; the
// monolith retains its own copy for use in other features.
export const detectSetups = (bars, ticker, detectorParams = {}) => {
  if (!bars || bars.length < 30) return [];
  const i = bars.length - 1;
  const out = [];
  for (const rule of SETUP_RULES) {
    try {
      const r = rule.detect(bars, i, detectorParams[rule.id] || {});
      if (r && r.score >= 30) {
        out.push({
          ticker, ruleId: rule.id, label: rule.label,
          side: r.side ?? rule.side, score: r.score,
          levels: r.levels || {}, notes: r.notes || '',
          barIdx: i, asOfT: bars[i].t, bars,
        });
      }
    } catch (e) { /* detector failure — skip silently */ }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
};
