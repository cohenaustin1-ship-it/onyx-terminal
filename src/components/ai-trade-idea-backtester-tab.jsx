// IMO Onyx Terminal — AI Trade Idea Backtester tab
//
// Phase 3p.21 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~29563-30510, ~948 lines).
//
// Backtests AI-generated trade ideas against historical bar data
// from Polygon. User saves a strategy (entry/exit rules + universe),
// the component fetches historical bars, runs the rules, and
// reports performance metrics (Sharpe, max drawdown, win rate).
//
// Public export:
//   AITradeIdeaBacktesterTab({ instrument, account, ... })
//
// Internal helpers kept inline:
//   inferSectorETF        — heuristic sector lookup from SIC desc
//   persistStrategies     — localStorage save with audit-style log
//
// Honest scope:
//   - Polygon free tier rate-limits to 5 calls/min. Backtesting a
//     universe of 50+ tickers will hit that limit; the component
//     paces calls and surfaces a progress indicator.
//   - "Backtest" here means a simple bar-by-bar walk-forward — not
//     a tick-accurate simulation. Slippage and commissions are
//     approximated, not modeled to any precision.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { COLORS } from '../lib/constants.js';

// MASSIVE_API_KEY (Polygon) duplicated env read — same pattern as
// other modules using Polygon (polygon-api.js etc.).
const MASSIVE_API_KEY = (() => { try { return import.meta.env?.VITE_MASSIVE_API_KEY ?? ''; } catch { return ''; } })();

// AI_STRATEGIES_KEY + DEFAULT_AI_STRATEGIES inlined from monolith
// during 3p.21 — only used here.
const AI_STRATEGIES_KEY = 'imo_ai_strategies';
const DEFAULT_AI_STRATEGIES = [
  { name: 'All ideas', filterText: '' },
  { name: 'Tech only', filterText: 'AAPL,NVDA,MSFT,GOOGL,META,AMZN,TSLA' },
  { name: 'Defensive', filterText: 'PG,KO,JNJ,WMT,XLP,XLV,XLU' },
  { name: 'Earnings plays', filterText: 'tag:earnings' },
  { name: 'Momentum', filterText: 'tag:momentum' },
  { name: 'Macro-driven', filterText: 'tag:macro' },
];

export const AITradeIdeaBacktesterTab = () => {
  const [ideas, setIdeas] = useState([]);
  const [bars, setBars] = useState({}); // { sym-ts: bars[] }
  const [spyBars, setSpyBars] = useState({}); // { ts: bars[] } — 3o.80 benchmark
  const [sectorBenchmarkBars, setSectorBenchmarkBars] = useState({}); // 3o.81: { sym-ts: { etf, bars[] } }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  // 3o.84: named strategy slots (filter the ideas universe + compare)
  const [strategies, setStrategies] = useState(() => {
    try {
      const raw = localStorage.getItem(AI_STRATEGIES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return DEFAULT_AI_STRATEGIES;
  });
  const persistStrategies = useCallback((next) => {
    setStrategies(next);
    try { localStorage.setItem(AI_STRATEGIES_KEY, JSON.stringify(next)); } catch {}
  }, []);

  // Load ideas from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('imo_ai_trade_ideas');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setIdeas(parsed);
      }
    } catch {}
  }, []);

  // Fetch bars for each idea + SPY benchmark
  const fetchBars = useCallback(async () => {
    const tradeable = ideas.filter(i =>
      i.entry != null && i.target != null && i.stop != null
    );
    if (tradeable.length === 0) return;
    setLoading(true);
    setError(null);
    setProgress(`0 of ${tradeable.length}`);
    // 3o.81: sector keyword → ETF mapping (uses SIC descriptions / industry
    // names from Polygon ticker details — substring matched against keywords)
    const SECTOR_ETF_MAP = [
      { keys: ['software', 'computer', 'semiconductor', 'electronic', 'tech'], etf: 'XLK' },
      { keys: ['pharmaceutical', 'biotech', 'medical', 'health', 'biological'], etf: 'XLV' },
      { keys: ['bank', 'insurance', 'financ', 'invest'], etf: 'XLF' },
      { keys: ['retail', 'restaurant', 'auto', 'apparel', 'consumer-disc', 'leisure'], etf: 'XLY' },
      { keys: ['food', 'beverage', 'tobacco', 'household', 'consumer-stap'], etf: 'XLP' },
      { keys: ['oil', 'gas', 'energy', 'petroleum', 'pipeline'], etf: 'XLE' },
      { keys: ['industrial', 'aerospace', 'defense', 'machinery', 'transport', 'airline'], etf: 'XLI' },
      { keys: ['mining', 'chemical', 'metal', 'material', 'paper', 'forest'], etf: 'XLB' },
      { keys: ['utility', 'electric power', 'gas distribution', 'water'], etf: 'XLU' },
      { keys: ['real estate', 'reit', 'property'], etf: 'XLRE' },
      { keys: ['communic', 'media', 'broadcast', 'telephone', 'telecom', 'publish'], etf: 'XLC' },
    ];
    const inferSectorETF = (sicDescription) => {
      if (!sicDescription) return null;
      const lower = sicDescription.toLowerCase();
      for (const m of SECTOR_ETF_MAP) {
        for (const k of m.keys) {
          if (lower.includes(k)) return m.etf;
        }
      }
      return null;
    };
    try {
      const updates = {};
      const spyUpdates = {};
      const sectorBarsUpdates = {}; // { 'sym-ts': { etf, bars } }
      const BATCH_SIZE = 5;
      let processed = 0;
      // First pass: fetch ticker details to determine sector ETF per idea
      // (cache per-symbol so we don't re-fetch)
      const symToEtf = {};
      const uniqSyms = [...new Set(tradeable.map(i => i.sym))];
      await Promise.all(uniqSyms.slice(0, 30).map(async (sym) => {
        try {
          const r = await fetch(`https://api.polygon.io/v3/reference/tickers/${sym}?apiKey=${MASSIVE_API_KEY}`);
          if (!r.ok) return;
          const j = await r.json();
          const sic = j?.results?.sic_description;
          const etf = inferSectorETF(sic);
          if (etf) symToEtf[sym] = etf;
        } catch {}
      }));
      for (let i = 0; i < tradeable.length; i += BATCH_SIZE) {
        const batch = tradeable.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (idea) => {
          const key = `${idea.sym}-${idea.ts}`;
          if (bars[key] && spyBars[idea.ts]) return; // already fetched
          try {
            const fromDate = new Date(idea.ts).toISOString().slice(0, 10);
            const toDate = new Date().toISOString().slice(0, 10);
            const sectorEtf = symToEtf[idea.sym];
            // Fetch idea symbol + SPY (+ sector ETF if known) in parallel
            const fetches = [
              fetch(`https://api.polygon.io/v2/aggs/ticker/${idea.sym}/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=400&apiKey=${MASSIVE_API_KEY}`),
              fetch(`https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=400&apiKey=${MASSIVE_API_KEY}`),
            ];
            if (sectorEtf) {
              fetches.push(fetch(`https://api.polygon.io/v2/aggs/ticker/${sectorEtf}/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=400&apiKey=${MASSIVE_API_KEY}`));
            }
            const responses = await Promise.all(fetches);
            const [r, rSpy, rSec] = responses;
            if (r.ok) {
              const j = await r.json();
              updates[key] = j?.results || [];
            }
            if (rSpy.ok) {
              const jSpy = await rSpy.json();
              spyUpdates[idea.ts] = jSpy?.results || [];
            }
            if (rSec && rSec.ok) {
              const jSec = await rSec.json();
              sectorBarsUpdates[key] = { etf: sectorEtf, bars: jSec?.results || [] };
            }
          } catch {}
        }));
        processed += batch.length;
        setProgress(`${processed} of ${tradeable.length}`);
      }
      setBars(prev => ({ ...prev, ...updates }));
      setSpyBars(prev => ({ ...prev, ...spyUpdates }));
      setSectorBenchmarkBars(prev => ({ ...prev, ...sectorBarsUpdates }));
    } catch (e) {
      setError(e?.message || 'Fetch failed');
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [ideas, bars, spyBars]);

  useEffect(() => { fetchBars(); }, [fetchBars]);

  // Compute backtest results
  const results = useMemo(() => {
    if (ideas.length === 0) return null;
    const rows = [];
    for (const idea of ideas) {
      if (idea.entry == null || idea.target == null || idea.stop == null) continue;
      const key = `${idea.sym}-${idea.ts}`;
      const ideaBars = bars[key];
      if (!Array.isArray(ideaBars) || ideaBars.length === 0) continue;
      // Determine direction: 'bull' / 'long' = long; 'bear' / 'short' = short
      const dirRaw = (idea.direction || '').toLowerCase();
      const isLong = !(dirRaw.includes('bear') || dirRaw.includes('short'));
      // Walk forward bar-by-bar
      let outcome = 'OPEN';
      let exitPrice = null;
      let exitTs = null;
      let daysElapsed = ideaBars.length;
      for (const bar of ideaBars) {
        const high = bar.h, low = bar.l;
        if (isLong) {
          // Target hit if high >= target (favorable); stop if low <= stop (loss)
          if (low <= idea.stop) {
            outcome = 'STOP';
            exitPrice = idea.stop;
            exitTs = bar.t;
            break;
          }
          if (high >= idea.target) {
            outcome = 'TARGET';
            exitPrice = idea.target;
            exitTs = bar.t;
            break;
          }
        } else {
          // Short: target if low <= target (favorable for short); stop if high >= stop
          if (high >= idea.stop) {
            outcome = 'STOP';
            exitPrice = idea.stop;
            exitTs = bar.t;
            break;
          }
          if (low <= idea.target) {
            outcome = 'TARGET';
            exitPrice = idea.target;
            exitTs = bar.t;
            break;
          }
        }
      }
      if (outcome === 'OPEN') {
        // Mark to current
        exitPrice = ideaBars[ideaBars.length - 1]?.c;
        exitTs = ideaBars[ideaBars.length - 1]?.t;
      }
      // 3o.82: Walk bars to compute max drawdown + daily-return vol
      // for risk-adjusted metrics (Sharpe, Sortino, Calmar)
      // 3o.83: also track worst single-day return + ts for drawdown decomposition
      let maxDrawdown = 0;
      const dailyRets = [];
      let worstSingleDay = null; // { ts, ret, prevClose, close }
      if (Array.isArray(ideaBars) && ideaBars.length >= 2) {
        let peak = idea.entry;
        for (let i = 0; i < ideaBars.length; i++) {
          const close = ideaBars[i].c;
          // For longs: drawdown = (close - peak) / peak (negative when below peak)
          // For shorts: drawdown when price RISES from entry (loss)
          if (isLong) {
            if (close > peak) peak = close;
            const dd = (close - peak) / peak * 100;
            if (dd < maxDrawdown) maxDrawdown = dd; // most negative = worst dd
          } else {
            if (close < peak) peak = close; // shorts: peak = lowest (most favorable)
            const dd = (peak - close) / peak * 100; // positive = adverse for short
            if (-dd < maxDrawdown) maxDrawdown = -dd;
          }
          // Daily return
          if (i > 0) {
            const prev = ideaBars[i - 1].c;
            if (prev > 0) {
              const r = isLong ? (close - prev) / prev : (prev - close) / prev;
              dailyRets.push(r);
              // 3o.83: track worst single-day (most negative for direction)
              if (worstSingleDay == null || r < worstSingleDay.ret) {
                worstSingleDay = { ts: ideaBars[i].t, ret: r * 100, prevClose: prev, close };
              }
            }
          }
        }
      }
      // Annualized Sharpe (assume rf=0): mean × √252 / sd
      let sharpe = null;
      let sortino = null;
      if (dailyRets.length >= 5) {
        const mean = dailyRets.reduce((s, v) => s + v, 0) / dailyRets.length;
        const variance = dailyRets.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyRets.length;
        const sd = Math.sqrt(variance);
        sharpe = sd > 0 ? (mean * 252) / (sd * Math.sqrt(252)) : null;
        // Sortino: downside-only deviation (returns below 0)
        const downRets = dailyRets.filter(r => r < 0);
        if (downRets.length > 0) {
          const downVar = downRets.reduce((s, v) => s + v * v, 0) / downRets.length;
          const downSd = Math.sqrt(downVar);
          sortino = downSd > 0 ? (mean * 252) / (downSd * Math.sqrt(252)) : null;
        }
      }
      // P/L
      let pnlPct;
      if (isLong) {
        pnlPct = ((exitPrice - idea.entry) / idea.entry) * 100;
      } else {
        pnlPct = ((idea.entry - exitPrice) / idea.entry) * 100;
      }
      // Days
      if (exitTs && idea.ts) {
        daysElapsed = Math.round((exitTs - idea.ts) / 86400000);
      }
      // Calmar = annualized return / |max drawdown| — needs pnlPct + daysElapsed
      let calmar = null;
      if (maxDrawdown < 0 && daysElapsed > 0) {
        const annualPnL = (pnlPct / daysElapsed) * 252;
        calmar = annualPnL / Math.abs(maxDrawdown);
      }
      // 3o.80: SPY benchmark P/L over same period
      let spyPnLPct = null;
      const spy = spyBars[idea.ts];
      if (Array.isArray(spy) && spy.length >= 2 && exitTs) {
        const spyEntry = spy[0]?.c;
        // Find SPY bar closest to (or at) exitTs
        let spyExit = spy[spy.length - 1]?.c;
        for (let i = 0; i < spy.length; i++) {
          if (spy[i].t > exitTs) {
            spyExit = i > 0 ? spy[i-1].c : spy[i].c;
            break;
          }
        }
        if (spyEntry && spyExit) {
          spyPnLPct = ((spyExit - spyEntry) / spyEntry) * 100;
        }
      }
      const alphaPct = (spyPnLPct != null) ? pnlPct - spyPnLPct : null;
      // 3o.81: sector ETF benchmark P/L over same period
      let sectorPnLPct = null;
      let sectorEtf = null;
      const secEntry = sectorBenchmarkBars[`${idea.sym}-${idea.ts}`];
      if (secEntry && Array.isArray(secEntry.bars) && secEntry.bars.length >= 2 && exitTs) {
        sectorEtf = secEntry.etf;
        const secStart = secEntry.bars[0]?.c;
        let secExit = secEntry.bars[secEntry.bars.length - 1]?.c;
        for (let i = 0; i < secEntry.bars.length; i++) {
          if (secEntry.bars[i].t > exitTs) {
            secExit = i > 0 ? secEntry.bars[i-1].c : secEntry.bars[i].c;
            break;
          }
        }
        if (secStart && secExit) {
          sectorPnLPct = ((secExit - secStart) / secStart) * 100;
        }
      }
      const sectorAlphaPct = (sectorPnLPct != null) ? pnlPct - sectorPnLPct : null;
      rows.push({
        id: idea.id,
        sym: idea.sym,
        ts: idea.ts,
        direction: isLong ? 'LONG' : 'SHORT',
        entry: idea.entry,
        target: idea.target,
        stop: idea.stop,
        outcome,
        exitPrice,
        pnlPct,
        spyPnLPct,
        alphaPct,
        sectorPnLPct,
        sectorAlphaPct,
        sectorEtf,
        daysElapsed,
        thesis: idea.thesis,
        // 3o.82: risk-adjusted metrics
        maxDrawdown,
        sharpe,
        sortino,
        calmar,
        // 3o.83: worst single-day for drawdown decomposition
        worstSingleDay,
        // 3o.85: auto-tags from thesis text + idea metadata
        tags: (() => {
          const tags = [];
          const thesis = (idea.thesis || '').toLowerCase();
          // Trade-type tags
          if (/earnings|eps|revenue\s+beat|guidance/i.test(thesis)) tags.push('earnings');
          if (/momentum|breakout|rsi|trend/i.test(thesis)) tags.push('momentum');
          if (/fed|fomc|rate|cpi|jobs|payroll|inflation/i.test(thesis)) tags.push('macro');
          if (/oversold|mean\s+revers|reversal|bounce/i.test(thesis)) tags.push('mean-reversion');
          if (/technical|chart|support|resistance|moving\s+average|sma|ema/i.test(thesis)) tags.push('technical');
          if (/options|call|put|gamma|theta|iv/i.test(thesis)) tags.push('options');
          if (/insider|form\s*4|10%\s*owner/i.test(thesis)) tags.push('insider');
          if (/buyback|repurchas|dividend|special\s*dividend/i.test(thesis)) tags.push('capital-return');
          if (/m&a|merger|acqui|takeover|spinoff/i.test(thesis)) tags.push('m&a');
          if (/value|cheap|undervalued|p\/e|book\s*value/i.test(thesis)) tags.push('value');
          if (/growth|tam|expansion|tailwind/i.test(thesis)) tags.push('growth');
          // Direction tag
          if (idea.direction === 'short' || /short|put|bear|sell/i.test(thesis)) {
            if (!tags.includes('short')) tags.push('short');
          } else {
            tags.push('long');
          }
          return tags;
        })(),
      });
    }
    rows.sort((a, b) => b.ts - a.ts); // most recent first
    if (rows.length === 0) return null;
    // Aggregates
    const closed = rows.filter(r => r.outcome !== 'OPEN');
    const wins = closed.filter(r => r.outcome === 'TARGET').length;
    const losses = closed.filter(r => r.outcome === 'STOP').length;
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
    const avgPnL = rows.reduce((s, r) => s + r.pnlPct, 0) / rows.length;
    const avgWinPnL = wins > 0
      ? closed.filter(r => r.outcome === 'TARGET').reduce((s, r) => s + r.pnlPct, 0) / wins
      : 0;
    const avgLossPnL = losses > 0
      ? closed.filter(r => r.outcome === 'STOP').reduce((s, r) => s + r.pnlPct, 0) / losses
      : 0;
    // 3o.80: aggregate benchmark stats
    const withSpy = rows.filter(r => r.spyPnLPct != null);
    const avgSpyPnL = withSpy.length > 0
      ? withSpy.reduce((s, r) => s + r.spyPnLPct, 0) / withSpy.length
      : 0;
    const avgAlpha = withSpy.length > 0
      ? withSpy.reduce((s, r) => s + r.alphaPct, 0) / withSpy.length
      : 0;
    const beatBenchmark = withSpy.filter(r => r.alphaPct > 0).length;
    // 3o.81: sector benchmark stats
    const withSector = rows.filter(r => r.sectorPnLPct != null);
    const avgSectorPnL = withSector.length > 0
      ? withSector.reduce((s, r) => s + r.sectorPnLPct, 0) / withSector.length
      : 0;
    const avgSectorAlpha = withSector.length > 0
      ? withSector.reduce((s, r) => s + r.sectorAlphaPct, 0) / withSector.length
      : 0;
    const beatSector = withSector.filter(r => r.sectorAlphaPct > 0).length;
    // 3o.82: aggregate risk-adjusted metrics across closed ideas
    const closedRows = rows.filter(r => r.outcome !== 'OPEN');
    const withSharpe = closedRows.filter(r => r.sharpe != null);
    const avgSharpe = withSharpe.length > 0
      ? withSharpe.reduce((s, r) => s + r.sharpe, 0) / withSharpe.length
      : null;
    const withDD = closedRows.filter(r => r.maxDrawdown < 0);
    const avgMaxDD = withDD.length > 0
      ? withDD.reduce((s, r) => s + r.maxDrawdown, 0) / withDD.length
      : null;
    const worstDD = closedRows.length > 0
      ? closedRows.reduce((min, r) => r.maxDrawdown < min ? r.maxDrawdown : min, 0)
      : null;
    const withCalmar = closedRows.filter(r => r.calmar != null && Number.isFinite(r.calmar));
    const avgCalmar = withCalmar.length > 0
      ? withCalmar.reduce((s, r) => s + r.calmar, 0) / withCalmar.length
      : null;
    return {
      rows, closed: closed.length, wins, losses, winRate, avgPnL, avgWinPnL, avgLossPnL,
      avgSpyPnL, avgAlpha, beatBenchmark, withSpyCount: withSpy.length,
      avgSectorPnL, avgSectorAlpha, beatSector, withSectorCount: withSector.length,
      avgSharpe, avgMaxDD, worstDD, avgCalmar, sharpeCount: withSharpe.length,
    };
  }, [ideas, bars, spyBars, sectorBenchmarkBars]);

  // 3o.84: per-strategy aggregate metrics
  const strategyResults = useMemo(() => {
    if (!results || !results.rows) return null;
    const out = strategies.map(strat => {
      // 3o.85: filter accepts both ticker symbols and tag:NAME selectors.
      // Filter syntax: "AAPL,NVDA" matches by ticker; "tag:earnings" matches
      // by auto-detected tag; "tag:earnings,AAPL" matches either.
      const filterTokens = strat.filterText
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const tickerSet = new Set();
      const tagSet = new Set();
      for (const tok of filterTokens) {
        if (tok.toLowerCase().startsWith('tag:')) {
          tagSet.add(tok.slice(4).toLowerCase().trim());
        } else {
          tickerSet.add(tok.toUpperCase());
        }
      }
      const matched = (tickerSet.size === 0 && tagSet.size === 0)
        ? results.rows
        : results.rows.filter(r => {
            if (tickerSet.has(r.sym?.toUpperCase())) return true;
            if (Array.isArray(r.tags)) {
              for (const tag of r.tags) {
                if (tagSet.has(tag.toLowerCase())) return true;
              }
            }
            return false;
          });
      const closed = matched.filter(r => r.outcome !== 'OPEN');
      const wins = closed.filter(r => r.outcome === 'TARGET').length;
      const losses = closed.filter(r => r.outcome === 'STOP').length;
      const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
      const avgPnL = closed.length > 0
        ? closed.reduce((s, r) => s + r.pnlPct, 0) / closed.length
        : 0;
      const withSharpe = closed.filter(r => r.sharpe != null);
      const avgSharpe = withSharpe.length > 0
        ? withSharpe.reduce((s, r) => s + r.sharpe, 0) / withSharpe.length
        : null;
      return {
        name: strat.name,
        filterText: strat.filterText,
        n: matched.length,
        closed: closed.length,
        wins,
        losses,
        winRate,
        avgPnL,
        avgSharpe,
      };
    });
    return out;
  }, [results, strategies]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="text-[12px] font-medium" style={{ color: COLORS.text }}>
            AI trade idea backtester
          </div>
          <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
            Simulates historical performance of past AI-generated trade ideas · {ideas.length} stored
          </div>
        </div>
        <button type="button" onClick={fetchBars} disabled={loading || ideas.length === 0}
                className="px-2 py-1 rounded text-[10.5px] inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40"
                style={{ background: COLORS.bg, color: COLORS.textMute, border: `1px solid ${COLORS.border}` }}>
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {progress || 'Refresh'}
        </button>
      </div>

      {ideas.length === 0 && (
        <div className="text-[11px] py-6 text-center" style={{ color: COLORS.textMute }}>
          No AI trade ideas have been generated yet. Visit the "Trade ideas" tab on any symbol
          to generate ideas, then come back here to backtest them.
        </div>
      )}

      {error && (
        <div className="rounded p-2 text-[11px]"
             style={{ background: 'rgba(255,85,119,0.06)', color: COLORS.red, border: `1px solid ${COLORS.red}55` }}>
          {error}
        </div>
      )}

      {results && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded border p-2"
                 style={{
                   borderColor: results.winRate >= 50 ? `${COLORS.green}55` : `${COLORS.red}55`,
                   background: results.winRate >= 50 ? `${COLORS.green}05` : `${COLORS.red}05`,
                 }}>
              <div className="text-[9.5px] uppercase tracking-wider"
                   style={{ color: results.winRate >= 50 ? COLORS.green : COLORS.red }}>
                Win rate
              </div>
              <div className="tabular-nums text-[14px] font-medium"
                   style={{ color: results.winRate >= 50 ? COLORS.green : COLORS.red }}>
                {results.winRate.toFixed(0)}%
              </div>
              <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                {results.wins}W / {results.losses}L closed
              </div>
            </div>
            <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
              <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                Avg P/L
              </div>
              <div className="tabular-nums text-[14px] font-medium"
                   style={{ color: results.avgPnL >= 0 ? COLORS.green : COLORS.red }}>
                {results.avgPnL >= 0 ? '+' : ''}{results.avgPnL.toFixed(1)}%
              </div>
              <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                across all ideas
              </div>
            </div>
            <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
              <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.green }}>
                Avg win
              </div>
              <div className="tabular-nums text-[14px] font-medium" style={{ color: COLORS.green }}>
                {results.avgWinPnL >= 0 ? '+' : ''}{results.avgWinPnL.toFixed(1)}%
              </div>
            </div>
            <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
              <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.red }}>
                Avg loss
              </div>
              <div className="tabular-nums text-[14px] font-medium" style={{ color: COLORS.red }}>
                {results.avgLossPnL.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* SPY benchmark comparison (3o.80) */}
          {results.withSpyCount > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="rounded border p-2"
                   style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                  Avg SPY hold P/L
                </div>
                <div className="tabular-nums text-[14px] font-medium"
                     style={{ color: results.avgSpyPnL >= 0 ? COLORS.text : COLORS.red }}>
                  {results.avgSpyPnL >= 0 ? '+' : ''}{results.avgSpyPnL.toFixed(1)}%
                </div>
                <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                  same period passive bench
                </div>
              </div>
              <div className="rounded border p-2"
                   style={{
                     borderColor: results.avgAlpha > 0 ? `${COLORS.green}55` : `${COLORS.red}55`,
                     background: results.avgAlpha > 0 ? `${COLORS.green}05` : `${COLORS.red}05`,
                   }}>
                <div className="text-[9.5px] uppercase tracking-wider"
                     style={{ color: results.avgAlpha > 0 ? COLORS.green : COLORS.red }}>
                  Avg alpha vs SPY
                </div>
                <div className="tabular-nums text-[14px] font-medium"
                     style={{ color: results.avgAlpha > 0 ? COLORS.green : COLORS.red }}>
                  {results.avgAlpha >= 0 ? '+' : ''}{results.avgAlpha.toFixed(1)}pp
                </div>
                <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                  ideas P/L − SPY hold P/L
                </div>
              </div>
              <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                  Beat benchmark
                </div>
                <div className="tabular-nums text-[14px] font-medium" style={{ color: COLORS.text }}>
                  {results.beatBenchmark}/{results.withSpyCount}
                </div>
                <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                  {((results.beatBenchmark / results.withSpyCount) * 100).toFixed(0)}% of ideas
                </div>
              </div>
            </div>
          )}

          {/* Sector benchmark comparison (3o.81) */}
          {results.withSectorCount > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="rounded border p-2"
                   style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                  Avg sector ETF P/L
                </div>
                <div className="tabular-nums text-[14px] font-medium"
                     style={{ color: results.avgSectorPnL >= 0 ? COLORS.text : COLORS.red }}>
                  {results.avgSectorPnL >= 0 ? '+' : ''}{results.avgSectorPnL.toFixed(1)}%
                </div>
                <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                  XLK/XLV/XLF/etc per idea
                </div>
              </div>
              <div className="rounded border p-2"
                   style={{
                     borderColor: results.avgSectorAlpha > 0 ? `${COLORS.green}55` : `${COLORS.red}55`,
                     background: results.avgSectorAlpha > 0 ? `${COLORS.green}05` : `${COLORS.red}05`,
                   }}>
                <div className="text-[9.5px] uppercase tracking-wider"
                     style={{ color: results.avgSectorAlpha > 0 ? COLORS.green : COLORS.red }}>
                  Avg α vs sector
                </div>
                <div className="tabular-nums text-[14px] font-medium"
                     style={{ color: results.avgSectorAlpha > 0 ? COLORS.green : COLORS.red }}>
                  {results.avgSectorAlpha >= 0 ? '+' : ''}{results.avgSectorAlpha.toFixed(1)}pp
                </div>
                <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                  ideas P/L − sector ETF P/L
                </div>
              </div>
              <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                  Beat sector
                </div>
                <div className="tabular-nums text-[14px] font-medium" style={{ color: COLORS.text }}>
                  {results.beatSector}/{results.withSectorCount}
                </div>
                <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                  {((results.beatSector / results.withSectorCount) * 100).toFixed(0)}% of ideas
                </div>
              </div>
            </div>
          )}

          {/* 3o.82: Risk-adjusted metrics across closed ideas */}
          {results.sharpeCount > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded border p-2"
                   style={{
                     borderColor: results.avgSharpe > 1 ? `${COLORS.green}55`
                               : results.avgSharpe > 0 ? COLORS.border
                               : `${COLORS.red}55`,
                     background: results.avgSharpe > 1 ? `${COLORS.green}05`
                              : results.avgSharpe > 0 ? COLORS.bg
                              : `${COLORS.red}05`,
                   }}>
                <div className="text-[9.5px] uppercase tracking-wider"
                     style={{ color: results.avgSharpe > 1 ? COLORS.green
                                  : results.avgSharpe > 0 ? COLORS.text
                                  : COLORS.red }}>
                  Avg Sharpe
                </div>
                <div className="tabular-nums text-[14px] font-medium"
                     style={{ color: results.avgSharpe > 1 ? COLORS.green
                                  : results.avgSharpe > 0 ? COLORS.text
                                  : COLORS.red }}>
                  {results.avgSharpe != null ? results.avgSharpe.toFixed(2) : '—'}
                </div>
                <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                  ann. risk-adj return
                </div>
              </div>
              <div className="rounded border p-2"
                   style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                  Avg max DD
                </div>
                <div className="tabular-nums text-[14px] font-medium"
                     style={{ color: results.avgMaxDD != null && results.avgMaxDD < -10 ? COLORS.red : COLORS.text }}>
                  {results.avgMaxDD != null ? `${results.avgMaxDD.toFixed(1)}%` : '—'}
                </div>
                <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                  worst {results.worstDD != null ? `${results.worstDD.toFixed(1)}%` : '—'}
                </div>
              </div>
              <div className="rounded border p-2"
                   style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                  Avg Calmar
                </div>
                <div className="tabular-nums text-[14px] font-medium"
                     style={{ color: results.avgCalmar > 1 ? COLORS.green
                                  : results.avgCalmar > 0 ? COLORS.text
                                  : COLORS.red }}>
                  {results.avgCalmar != null ? results.avgCalmar.toFixed(2) : '—'}
                </div>
                <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                  return / drawdown
                </div>
              </div>
              <div className="rounded border p-2"
                   style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                  Sample size
                </div>
                <div className="tabular-nums text-[14px] font-medium" style={{ color: COLORS.text }}>
                  {results.sharpeCount}
                </div>
                <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                  ideas with risk metrics
                </div>
              </div>
            </div>
          )}

          {/* 3o.84: Multi-strategy comparison */}
          {strategyResults && strategyResults.length > 0 && (
            <div className="rounded border p-3"
                 style={{ borderColor: COLORS.border, background: COLORS.bg }}>
              <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
                <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                  Strategy slots · compare ideas filtered by ticker
                </div>
                <button type="button"
                        onClick={() => {
                          const name = prompt('Strategy name (e.g. "Tech megacaps"):', '');
                          if (!name) return;
                          const tickers = prompt('Comma-separated tickers (leave blank for all):', '');
                          const next = [...strategies, { name, filterText: tickers || '' }];
                          persistStrategies(next);
                        }}
                        className="px-2 py-1 rounded text-[10.5px] hover:opacity-90"
                        style={{ background: COLORS.bg, color: COLORS.mint, border: `1px solid ${COLORS.mint}55` }}>
                  + Add slot
                </button>
              </div>
              <div className="overflow-x-auto rounded border" style={{ borderColor: COLORS.border }}>
                <table className="w-full text-[10.5px] tabular-nums">
                  <thead>
                    <tr style={{ color: COLORS.textMute, background: COLORS.surface }}>
                      <th className="text-left px-3 py-1.5">Strategy</th>
                      <th className="text-left px-2">Filter</th>
                      <th className="text-right px-2">Ideas</th>
                      <th className="text-right px-2">Closed</th>
                      <th className="text-right px-2">Win %</th>
                      <th className="text-right px-2">Avg P/L</th>
                      <th className="text-right px-2">Avg Sharpe</th>
                      <th className="text-right px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {strategyResults.map((s, i) => (
                      <tr key={`strat-${i}`} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                        <td className="px-3 py-1" style={{ color: COLORS.text, fontWeight: 500 }}>
                          {s.name}
                        </td>
                        <td className="px-2 text-[10px]" style={{ color: COLORS.textDim }}>
                          {s.filterText || '(all)'}
                        </td>
                        <td className="text-right px-2" style={{ color: COLORS.textDim }}>
                          {s.n}
                        </td>
                        <td className="text-right px-2" style={{ color: COLORS.textDim }}>
                          {s.closed}
                        </td>
                        <td className="text-right px-2"
                            style={{ color: s.winRate > 60 ? COLORS.green
                                         : s.winRate > 40 ? COLORS.text
                                         : s.closed > 0 ? COLORS.red
                                         : COLORS.textMute }}>
                          {s.closed > 0 ? `${s.winRate.toFixed(0)}%` : '—'}
                        </td>
                        <td className="text-right px-2"
                            style={{ color: s.avgPnL > 0 ? COLORS.green
                                         : s.avgPnL < 0 ? COLORS.red
                                         : COLORS.textMute }}>
                          {s.closed > 0 ? `${s.avgPnL >= 0 ? '+' : ''}${s.avgPnL.toFixed(2)}%` : '—'}
                        </td>
                        <td className="text-right px-2"
                            style={{ color: s.avgSharpe == null ? COLORS.textMute
                                         : s.avgSharpe > 1 ? COLORS.green
                                         : s.avgSharpe > 0 ? COLORS.text
                                         : COLORS.red,
                                     fontWeight: s.avgSharpe != null ? 500 : 400 }}>
                          {s.avgSharpe != null ? s.avgSharpe.toFixed(2) : '—'}
                        </td>
                        <td className="text-right px-3">
                          {strategies.length > 1 && (
                            <button type="button"
                                    onClick={() => persistStrategies(strategies.filter((_, idx) => idx !== i))}
                                    className="text-[10px] hover:opacity-80"
                                    style={{ color: COLORS.red }}>
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[9.5px] mt-1.5" style={{ color: COLORS.textDim }}>
                Each slot filters ideas by symbol list and/or tags. Filter syntax:
                <code> AAPL,NVDA</code> (tickers); <code>tag:earnings</code> (tag);
                <code> AAPL,tag:momentum</code> (mix). Tags auto-derived from idea
                thesis: earnings, momentum, macro, mean-reversion, technical, options,
                insider, capital-return, m&amp;a, value, growth, long, short. Empty
                filter matches all ideas.
              </div>
            </div>
          )}

          {/* Per-idea table */}
          <div className="overflow-x-auto rounded border" style={{ borderColor: COLORS.border }}>
            <table className="w-full text-[10.5px] tabular-nums">
              <thead>
                <tr style={{ color: COLORS.textMute, background: COLORS.bg }}>
                  <th className="text-left px-3 py-1.5">Symbol</th>
                  <th className="text-left px-2">Dir</th>
                  <th className="text-right px-2">Entry</th>
                  <th className="text-right px-2">Target</th>
                  <th className="text-right px-2">Stop</th>
                  <th className="text-right px-2">Days</th>
                  <th className="text-center px-2">Outcome</th>
                  <th className="text-right px-2">P/L</th>
                  <th className="text-right px-2">SPY P/L</th>
                  <th className="text-right px-2">α vs SPY</th>
                  <th className="text-right px-2">α vs sector</th>
                  <th className="text-right px-3">Worst day</th>
                </tr>
              </thead>
              <tbody>
                {results.rows.slice(0, 30).map(r => {
                  const outcomeColor = r.outcome === 'TARGET' ? COLORS.green
                                    : r.outcome === 'STOP' ? COLORS.red
                                    : COLORS.chartGold;
                  const outcomeBg = r.outcome === 'TARGET' ? `${COLORS.green}1A`
                                  : r.outcome === 'STOP' ? `${COLORS.red}1A`
                                  : `${COLORS.chartGold}1A`;
                  return (
                    <tr key={r.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                      <td className="px-3 py-1" style={{ color: COLORS.text, fontWeight: 500 }}>
                        {r.sym}
                      </td>
                      <td className="px-2"
                          style={{ color: r.direction === 'LONG' ? COLORS.green : COLORS.red }}>
                        {r.direction}
                      </td>
                      <td className="text-right px-2" style={{ color: COLORS.textDim }}>
                        ${r.entry.toFixed(2)}
                      </td>
                      <td className="text-right px-2" style={{ color: COLORS.green }}>
                        ${r.target.toFixed(2)}
                      </td>
                      <td className="text-right px-2" style={{ color: COLORS.red }}>
                        ${r.stop.toFixed(2)}
                      </td>
                      <td className="text-right px-2" style={{ color: COLORS.textDim }}>
                        {r.daysElapsed}
                      </td>
                      <td className="text-center px-2">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider"
                              style={{ background: outcomeBg, color: outcomeColor, fontWeight: 500 }}>
                          {r.outcome}
                        </span>
                      </td>
                      <td className="text-right px-2"
                          style={{ color: r.pnlPct >= 0 ? COLORS.green : COLORS.red, fontWeight: 500 }}>
                        {r.pnlPct >= 0 ? '+' : ''}{r.pnlPct.toFixed(1)}%
                      </td>
                      <td className="text-right px-2"
                          style={{ color: r.spyPnLPct == null ? COLORS.textMute
                                       : r.spyPnLPct >= 0 ? COLORS.text : COLORS.red }}>
                        {r.spyPnLPct == null ? '—'
                          : `${r.spyPnLPct >= 0 ? '+' : ''}${r.spyPnLPct.toFixed(1)}%`}
                      </td>
                      <td className="text-right px-2"
                          style={{
                            color: r.alphaPct == null ? COLORS.textMute
                                 : r.alphaPct > 0 ? COLORS.green : COLORS.red,
                            fontWeight: r.alphaPct != null ? 500 : 400,
                          }}>
                        {r.alphaPct == null ? '—'
                          : `${r.alphaPct >= 0 ? '+' : ''}${r.alphaPct.toFixed(1)}pp`}
                      </td>
                      <td className="text-right px-3"
                          style={{
                            color: r.sectorAlphaPct == null ? COLORS.textMute
                                 : r.sectorAlphaPct > 0 ? COLORS.green : COLORS.red,
                            fontWeight: r.sectorAlphaPct != null ? 500 : 400,
                          }}
                          title={r.sectorEtf ? `vs ${r.sectorEtf} (${r.sectorPnLPct?.toFixed(1)}%)` : 'No sector match'}>
                        {r.sectorAlphaPct == null ? '—'
                          : <span>
                              {r.sectorAlphaPct >= 0 ? '+' : ''}{r.sectorAlphaPct.toFixed(1)}pp
                              <span className="ml-1 text-[8.5px]" style={{ color: COLORS.textMute }}>
                                ({r.sectorEtf})
                              </span>
                            </span>
                        }
                      </td>
                      {/* 3o.83: worst single-day drawdown contributor */}
                      <td className="text-right px-3"
                          style={{
                            color: r.worstSingleDay == null ? COLORS.textMute
                                 : r.worstSingleDay.ret < -5 ? COLORS.red
                                 : r.worstSingleDay.ret < -2 ? '#FFB84D'
                                 : COLORS.textDim,
                            fontWeight: r.worstSingleDay != null && r.worstSingleDay.ret < -2 ? 500 : 400,
                          }}
                          title={r.worstSingleDay
                            ? `${new Date(r.worstSingleDay.ts).toISOString().slice(0,10)} · close ${r.worstSingleDay.prevClose.toFixed(2)} → ${r.worstSingleDay.close.toFixed(2)}`
                            : 'No daily-return history'}>
                        {r.worstSingleDay == null ? '—'
                          : <span>
                              {r.worstSingleDay.ret >= 0 ? '+' : ''}{r.worstSingleDay.ret.toFixed(1)}%
                              <span className="ml-1 text-[8.5px]" style={{ color: COLORS.textMute }}>
                                {new Date(r.worstSingleDay.ts).toISOString().slice(5,10)}
                              </span>
                            </span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="text-[10px]" style={{ color: COLORS.textDim }}>
        <strong>Methodology</strong>: each idea with explicit entry/target/stop is walked
        bar-by-bar from generation date forward. First-trigger logic: target hit (favorable
        exit) vs stop hit (loss exit) — whichever comes first determines outcome. OPEN ideas
        are marked-to-market at current price.
        <strong> 3o.80 upgrade · SPY benchmark</strong>: for each idea, fetches SPY daily
        bars over the same period and computes passive-hold P/L. <strong>α vs SPY</strong>
        = idea P/L − SPY P/L (in pp). Aggregate cards show avg SPY hold P/L and avg alpha
        across all ideas with benchmark data. Reveals whether AI ideas ADD value beyond
        passive index hold or just track the market.
        <strong> Caveats</strong>: assumes you would have entered at exact suggested price
        (intraday gaps may have prevented that). Doesn't model slippage, fees, or partial
        fills. Win rate is for CLOSED ideas only. SPY is one benchmark — for sector-rotation
        ideas, sector-specific ETF would be more appropriate. <strong>NOT FINANCIAL ADVICE</strong>
        — backtest is informational; past idea performance doesn't predict future. Sample size
        grows with each idea generation — fewer than 10 closed ideas makes win-rate
        statistically meaningless.
      </div>
    </div>
  );
};
