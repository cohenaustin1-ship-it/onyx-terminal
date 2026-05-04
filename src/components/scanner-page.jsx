// IMO Onyx Terminal — Scanner page
//
// Phase 3p.23 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~99106-100355, ~1,250 lines).
//
// Bar-by-bar setup detector running across a user-configured
// watchlist. Pulls daily bars from Polygon, runs every detector in
// SETUP_RULES against the latest bar, and surfaces the highest-
// scoring hits. Optional AI lens overlay (runInvestorLens) lets the
// user see e.g. "what would Buffett think about this hit?".
//
// Public export:
//   ScannerPage({ setActive, setPage })
//
// Imports scanner-config.js (3p.23 extraction) for the shared
// detector rules + investor lens prompts. Polygon helpers from
// polygon-api.js. LLM provider resolution from llm-providers.js.
//
// Internal (inlined from monolith — only used here in this module):
//   detectSetups       — runs SETUP_RULES against the latest bar
//   runInvestorLens    — invokes the active LLM with an investor's
//                        framework prompt
//   fmtPct             — percent formatter
//
// Honest scope:
//   - Polygon free tier rate-limits to 5 calls/min. Scanning a 30-
//     ticker watchlist takes 30 seconds with the natural pacing the
//     scanner applies; bigger watchlists incur visible delays.
//   - Detectors only see bars[0..i] (no lookahead). They run in
//     "current bar" mode, not historical replay, so backtesting
//     should use a separate harness.
//   - SCANNER_BASE / SCANNER_TOKEN come from VITE_SCANNER_API_URL /
//     VITE_BACKEND_AUTH_TOKEN env vars for users running the
//     server-side scanner; both optional, falls back to local-only.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Download, Play, RefreshCw, Wand2 } from 'lucide-react';
import { COLORS } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import { fetchPolygonAggs } from '../lib/polygon-api.js';
import { resolveActiveProvider } from '../lib/llm-providers.js';
import { detectSetupsMTF, renderSetupSVG, summarizeSetupWithAI, runHedgeFundTeam, detectSetups } from '../lib/strategy-helpers.js';
import {
  DETECTOR_DEFAULTS, SETUP_RULES, INVESTOR_LENSES, HEDGE_FUND_AGENTS,
  SCANNER_DEFAULT_WATCHLIST, SCANNER_CONFIG_KEY, SCANNER_HISTORY_KEY,
} from '../lib/scanner-config.js';

// Server-side scanner URL + auth token (optional — falls back to
// local-only scanning when these aren't set).
const SCANNER_BASE = (() => { try { return import.meta.env?.VITE_SCANNER_API_URL ?? ''; } catch { return ''; } })();

// Hoisted helper — request browser notification permission. Idempotent;
// returns silently if already granted or denied. Inlined from monolith
// in 3p.37 (scanner-page is the only extracted-module caller; monolith
// keeps its own copy for the alerts engine).
const requestNotifPermission = async () => {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch {}
  }
};
const SCANNER_TOKEN = (() => { try { return import.meta.env?.VITE_BACKEND_AUTH_TOKEN ?? ''; } catch { return ''; } })();

// fmtPct (inlined per established pattern).
const fmtPct = (n, d = 2) => `${(n * 100).toFixed(d)}%`;

// useScannerSSE — subscribe to the server-side scanner's alert stream
// when enabled in scanner config. Inlined since ScannerPage is the
// only caller. Browser auto-reconnects on connection drop.
const useScannerSSE = ({ baseUrl, userId, enabled, authToken, onAlert }) => {
  useEffect(() => {
    if (!enabled || !baseUrl || !userId) return undefined;
    let es;
    try {
      const url = new URL(`${baseUrl.replace(/\/$/, '')}/stream/${encodeURIComponent(userId)}`);
      if (authToken) url.searchParams.set('token', authToken);
      es = new EventSource(url.toString());
      es.addEventListener('alert', (ev) => {
        try {
          const alert = JSON.parse(ev.data);
          onAlert?.(alert);
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            const title = `[${alert.ticker}] ${alert.rule_id}`;
            const body  = `Score ${alert.score} · ${alert.notes || ''}`;
            try { new Notification(title, { body, icon: '/imo-icon.png', tag: alert.id }); } catch {}
          }
        } catch {}
      });
      es.addEventListener('ping', () => {/* keep-alive */});
      es.onerror = () => { /* browser auto-reconnects */ };
    } catch (e) {
      console.warn('[useScannerSSE]', e?.message);
    }
    return () => { try { es?.close(); } catch {} };
  }, [baseUrl, userId, enabled, authToken, onAlert]);
};


// runInvestorLens — calls the active LLM with the lens's framework
// applied to a ticker + price snapshot. Returns { signal, confidence,
// reasoning, ... } structured output. Inlined for the same reason as
// detectSetups.
const runInvestorLens = async (lensId, ticker, bars, extra = {}) => {
  const lens = INVESTOR_LENSES.find(l => l.id === lensId);
  if (!lens) return { error: 'Unknown lens' };
  const provider = (typeof resolveActiveProvider === 'function')
    ? resolveActiveProvider() : null;
  if (!provider) return { error: 'No AI provider configured' };
  const snap = (() => {
    if (!bars || bars.length < 2) return 'No price data';
    const last = bars[bars.length - 1];
    const first = bars[0];
    const ret = (last.close - first.close) / first.close;
    const ret1m = bars.length >= 21 ? (last.close - bars[bars.length - 21].close) / bars[bars.length - 21].close : null;
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
  const prompt = `${lens.promptCore}

Ticker: ${ticker}
Price snapshot: ${snap}
${extra.note ? `Additional context: ${extra.note}\n` : ''}
Reply with strict JSON ONLY (no prose, no markdown fences):
{
  "signal":     "bullish" | "bearish" | "neutral",
  "confidence": <number 0-1>,
  "horizon":    "${lens.horizon}",
  "thesis":     "<2-3 sentence summary in framework voice>",
  "key_points": ["<bullet 1>", "<bullet 2>", "<bullet 3>"],
  "risks":      ["<risk 1>", "<risk 2>"],
  "trade_plan": {
    "entry":         <number or null>,
    "stop":          <number or null>,
    "target":        <number or null>,
    "sizing_pct":    <number 0-15>,
    "invalidation":  "<plain-language description>"
  }
}`;
  try {
    const response = await provider.provider.callChat(
      [{ role: 'user', content: prompt }],
      { model: provider.model?.id, maxTokens: 800 }
    );
    const text = response?.content?.[0]?.text ?? response?.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { error: 'No JSON in response', raw: text };
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
};

export const ScannerPage = ({ setActive, setPage }) => {
  // Scanner config
  const [config, setConfig] = useState(() => {
    try {
      const raw = localStorage.getItem(SCANNER_CONFIG_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      watchlist: SCANNER_DEFAULT_WATCHLIST,
      minScore: 60,
      autoScan: false,
      scanIntervalMs: 5 * 60 * 1000,        // 5 minutes when autoScan is on
      enableAiSummary: true,
      enableNotifications: false,
      maxResults: 20,
      sides: { long: true, short: true, neutral: false },
      multiTimeframe: false,
      mutedTickers: [],
      detectorParams: {},  // ruleId → param overrides; empty = use defaults
      serverSideAlerts: false,  // opt-in: server-side scanner pushes alerts via SSE
    };
  });
  useEffect(() => {
    try { localStorage.setItem(SCANNER_CONFIG_KEY, JSON.stringify(config)); } catch {}
  }, [config]);

  // Server-side scanner alerts — pushed via SSE when serverSideAlerts is on.
  // Stored as a separate stream from the in-page scan results so the user
  // can see "while you slept" hits when they return to the tab.
  const [serverAlerts, setServerAlerts] = useState([]);
  const [serverScanStatus, setServerScanStatus] = useState('disconnected'); // disconnected | connecting | connected | error
  const SCANNER_BASE = import.meta.env.VITE_SCANNER_API_URL || '';
  const SCANNER_TOKEN = import.meta.env.VITE_BACKEND_AUTH_TOKEN || '';
  // Stable user id for the server-side scanner. We use a per-browser
  // pseudo-id stored in localStorage. Switch to authenticated user id
  // when a real auth flow is in place.
  const serverUserId = useMemo(() => {
    try {
      let id = localStorage.getItem('imo_scanner_user_id');
      if (!id) {
        id = 'sp_' + Math.random().toString(36).slice(2, 12);
        localStorage.setItem('imo_scanner_user_id', id);
      }
      return id;
    } catch { return 'anonymous'; }
  }, []);
  const handleServerAlert = useCallback((alert) => {
    setServerAlerts(prev => {
      // Dedup by id, keep newest 50
      if (prev.some(a => a.id === alert.id)) return prev;
      return [{ ...alert, _arrivedAt: Date.now() }, ...prev].slice(0, 50);
    });
    setServerScanStatus('connected');
  }, []);
  // Push the watchlist config to the server when serverSideAlerts is enabled.
  // Re-syncs whenever the user edits their watchlist or detectors.
  useEffect(() => {
    if (!config.serverSideAlerts || !SCANNER_BASE) return;
    const tickers = config.watchlist
      .split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    const payload = {
      tickers,
      rules: SETUP_RULES.map(r => r.id),
      scan_every_minutes: 15,
      alert_threshold_score: config.minScore,
      muted: config.mutedTickers || [],
    };
    const headers = { 'Content-Type': 'application/json' };
    if (SCANNER_TOKEN) headers.Authorization = `Bearer ${SCANNER_TOKEN}`;
    setServerScanStatus('connecting');
    fetch(`${SCANNER_BASE.replace(/\/$/, '')}/watchlist/${encodeURIComponent(serverUserId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setServerScanStatus('connected');
    }).catch(() => {
      setServerScanStatus('error');
    });
  }, [config.serverSideAlerts, config.watchlist, config.minScore, config.mutedTickers, SCANNER_BASE, SCANNER_TOKEN, serverUserId]);
  // Subscribe to the SSE stream when enabled
  useScannerSSE({
    baseUrl:   SCANNER_BASE,
    userId:    serverUserId,
    enabled:   config.serverSideAlerts && !!SCANNER_BASE,
    authToken: SCANNER_TOKEN,
    onAlert:   handleServerAlert,
  });

  const [scanStatus, setScanStatus] = useState('idle'); // idle | scanning | error
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState([]); // [{candidate, summary?, summaryLoading}]
  const [lastScanAt, setLastScanAt] = useState(null);
  const [scanError, setScanError] = useState(null);
  const cancelRef = useRef(false);

  // Run a scan over the current watchlist
  const runScan = useCallback(async () => {
    setScanStatus('scanning');
    setScanError(null);
    cancelRef.current = false;
    const tickers = config.watchlist
      .split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    setProgress({ done: 0, total: tickers.length });
    const all = [];
    for (let i = 0; i < tickers.length; i++) {
      if (cancelRef.current) break;
      const t = tickers[i];
      try {
        // Limit history to 250 bars (~1 year daily) — enough for 200-SMA
        const data = await fetchPolygonAggs(t, 280, 'day', 1);
        if (data && data.length >= 30) {
          const normalized = data.map(d => ({
            t: d.t, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
          }));
          const setups = config.multiTimeframe
            ? detectSetupsMTF(normalized, t, config.detectorParams || {})
            : detectSetups(normalized, t, config.detectorParams || {});
          for (const s of setups) {
            if (s.score < config.minScore) continue;
            if (!config.sides[s.side]) continue;
            // Skip muted tickers — keyed by `${ticker}:${ruleId}` so a user
            // can mute "AAPL bull-breakout" without muting all AAPL setups.
            // Wildcard "AAPL:*" mutes the entire ticker.
            const muteKey = `${s.ticker}:${s.ruleId}`;
            const wildKey = `${s.ticker}:*`;
            if ((config.mutedTickers || []).some(m => m === muteKey || m === wildKey)) continue;
            all.push(s);
          }
        }
      } catch (e) {
        // Single-ticker failure — keep scanning
      }
      setProgress({ done: i + 1, total: tickers.length });
    }
    if (cancelRef.current) {
      setScanStatus('idle');
      return;
    }
    // Sort by score descending, cap at maxResults
    all.sort((a, b) => b.score - a.score);
    const top = all.slice(0, config.maxResults);
    // Wrap each candidate into a result row with summary slots
    const rows = top.map(c => ({ candidate: c, summary: null, summaryLoading: false }));
    setResults(rows);
    setLastScanAt(Date.now());
    setScanStatus('idle');
    // Notification — fire after scan completes if enabled and we have hits
    if (config.enableNotifications && top.length > 0 && typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') {
        try {
          new Notification('Onyx Scanner', {
            body: `${top.length} setup${top.length === 1 ? '' : 's'} found · top: ${top[0].ticker} ${top[0].label} (${top[0].score})`,
            icon: '/favicon.ico',
            tag: 'imo-scanner',
          });
        } catch {}
      }
    }
    // Persist last results into history
    try {
      const histRaw = localStorage.getItem(SCANNER_HISTORY_KEY);
      const hist = histRaw ? JSON.parse(histRaw) : [];
      hist.unshift({
        ts: Date.now(),
        count: top.length,
        topThree: top.slice(0, 3).map(s => ({ ticker: s.ticker, ruleId: s.ruleId, score: s.score })),
      });
      // Cap history at 50 scans
      localStorage.setItem(SCANNER_HISTORY_KEY, JSON.stringify(hist.slice(0, 50)));
    } catch {}
    // Optional AI summarization — fire concurrently for top 5 only
    if (config.enableAiSummary) {
      const limit = Math.min(5, rows.length);
      for (let k = 0; k < limit; k++) {
        const idx = k;
        setResults(prev => prev.map((r, i) => i === idx ? { ...r, summaryLoading: true } : r));
        summarizeSetupWithAI(rows[k].candidate).then(({ summary, error }) => {
          setResults(prev => prev.map((r, i) => i === idx
            ? { ...r, summaryLoading: false, summary, summaryError: error || null }
            : r));
        });
      }
    }
  }, [config]);

  const cancelScan = () => {
    cancelRef.current = true;
    setScanStatus('idle');
  };

  // Auto-scan loop — only runs when autoScan is on. Interval driven
  // by config.scanIntervalMs (default 5 min). Cleans up on toggle off.
  useEffect(() => {
    if (!config.autoScan) return;
    const id = setInterval(() => {
      if (scanStatus === 'idle') runScan();
    }, Math.max(60_000, Number(config.scanIntervalMs) || 300_000));
    return () => clearInterval(id);
  }, [config.autoScan, config.scanIntervalMs, scanStatus, runScan]);

  // Multi-investor lens panel state
  const [activeLensTicker, setActiveLensTicker] = useState('AAPL');
  const [lensSelection, setLensSelection] = useState(['buffett', 'lynch', 'munger']);
  const [lensResults, setLensResults] = useState({}); // lensId → { signal, ... } | { error, ... } | { loading: true }
  const [lensBars, setLensBars] = useState(null);

  const runAllSelectedLenses = useCallback(async () => {
    if (!activeLensTicker || lensSelection.length === 0) return;
    // Fetch bars once
    let bars = lensBars;
    if (!bars || lensResults._ticker !== activeLensTicker) {
      try {
        const data = await fetchPolygonAggs(activeLensTicker, 365, 'day', 1);
        bars = (data || []).map(d => ({
          t: d.t, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
        }));
        setLensBars(bars);
      } catch {
        bars = [];
      }
    }
    setLensResults({ _ticker: activeLensTicker, ...Object.fromEntries(lensSelection.map(id => [id, { loading: true }])) });
    // Fire concurrently
    await Promise.all(lensSelection.map(async (lensId) => {
      const r = await runInvestorLens(lensId, activeLensTicker, bars);
      setLensResults(prev => ({ ...prev, [lensId]: r }));
    }));
  }, [activeLensTicker, lensSelection, lensBars, lensResults._ticker]);

  // Hedge fund team — multi-agent IC deliberation
  const [hfTicker, setHfTicker] = useState('AAPL');
  const [hfResults, setHfResults] = useState({}); // agentId → output
  const [hfStatus, setHfStatus] = useState('idle');
  const [hfCurrentAgent, setHfCurrentAgent] = useState(null);
  const runTeamNow = useCallback(async () => {
    if (!hfTicker) return;
    setHfStatus('running');
    setHfResults({ _ticker: hfTicker });
    setHfCurrentAgent('director');
    try {
      const data = await fetchPolygonAggs(hfTicker, 365, 'day', 1);
      const bars = (data || []).map(d => ({
        t: d.t, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
      }));
      const result = await runHedgeFundTeam(hfTicker, bars, (agentId, output) => {
        setHfResults(prev => ({ ...prev, [agentId]: output }));
        // Move pointer to next agent
        const idx = HEDGE_FUND_AGENTS.findIndex(a => a.id === agentId);
        if (idx >= 0 && idx < HEDGE_FUND_AGENTS.length - 1) {
          setHfCurrentAgent(HEDGE_FUND_AGENTS[idx + 1].id);
        } else {
          setHfCurrentAgent(null);
        }
      });
      if (result.error) {
        setHfResults(prev => ({ ...prev, _error: result.error }));
      }
      setHfStatus('idle');
      setHfCurrentAgent(null);
    } catch (e) {
      setHfStatus('error');
      setHfCurrentAgent(null);
      setHfResults(prev => ({ ...prev, _error: e?.message || 'Team run failed' }));
    }
  }, [hfTicker]);

  // Save current setup chart as PNG via SVG → blob
  const downloadSetupSVG = (candidate) => {
    const svg = renderSetupSVG(candidate, { width: 720, height: 360 });
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `setup-${candidate.ticker}-${candidate.ruleId}-${Date.now()}.svg`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const fmtPct = (x) => x == null ? '—' : `${(x * 100).toFixed(2)}%`;
  const tickers = config.watchlist.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: COLORS.bg, color: COLORS.text }}>
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="flex items-baseline gap-3 mb-1 flex-wrap">
          <h1 className="text-[24px] font-medium">AI Scanner</h1>
          <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(159,136,255,0.10)', color: '#9F88FF' }}>AI-assisted</span>
        </div>
        <p className="text-[12.5px] mb-6" style={{ color: COLORS.textMute }}>
          Continuous market scanner that walks your watchlist, detects 13 setup patterns (breakouts, reversions, MACD crosses, BB squeeze, golden/death cross, volume thrust, bull flag, more), ranks finalists, optionally boosts scores via multi-timeframe confluence (daily + weekly resonance), and optionally runs an AI narrative on top results. A multi-investor lens panel applies 12 legendary-investor frameworks (Buffett, Lynch, Munger, Klarman, Burry, Druckenmiller…) to the active ticker. A 5-agent hedge fund team panel runs full IC deliberation (Director → Quant → Risk → Execution → IC Chair) for end-to-end trade plans. Setups render as inline SVG charts with key levels marked.
        </p>

        {/* Scanner config bar */}
        <details className="rounded-md border mb-4"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          <summary className="px-3 py-2 cursor-pointer text-[11.5px] flex items-center justify-between"
                   style={{ color: COLORS.text }}>
            <span>Scanner settings</span>
            <span className="text-[10px]" style={{ color: COLORS.textMute }}>
              {tickers.length} tickers · min score {config.minScore} · {config.autoScan ? `auto every ${(config.scanIntervalMs / 60000).toFixed(0)}m` : 'manual'}
            </span>
          </summary>
          <div className="px-3 pb-3 pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                Watchlist (comma-separated tickers)
              </div>
              <textarea value={config.watchlist}
                        onChange={(e) => setConfig(c => ({ ...c, watchlist: e.target.value }))}
                        rows={3}
                        className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none font-mono resize-y"
                        style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Min score</div>
              <input type="range" min="30" max="95" step="5"
                     value={config.minScore}
                     onChange={(e) => setConfig(c => ({ ...c, minScore: Number(e.target.value) }))}
                     className="w-full" style={{ accentColor: COLORS.mint }} />
              <div className="text-[10px]" style={{ color: COLORS.textDim }}>{config.minScore} / 100</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Max results</div>
              <input type="number" min="5" max="50"
                     value={config.maxResults}
                     onChange={(e) => setConfig(c => ({ ...c, maxResults: Math.max(5, Math.min(50, Number(e.target.value) || 20)) }))}
                     className="w-full px-2 py-1.5 rounded text-[11.5px] outline-none tabular-nums"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            </div>
            <div className="sm:col-span-2 flex flex-wrap gap-3 items-center">
              <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: COLORS.text }}>
                <input type="checkbox"
                       checked={config.sides.long}
                       onChange={(e) => setConfig(c => ({ ...c, sides: { ...c.sides, long: e.target.checked } }))}
                       style={{ accentColor: COLORS.green }} />
                Include long setups
              </label>
              <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: COLORS.text }}>
                <input type="checkbox"
                       checked={config.sides.short}
                       onChange={(e) => setConfig(c => ({ ...c, sides: { ...c.sides, short: e.target.checked } }))}
                       style={{ accentColor: COLORS.red }} />
                Include short setups
              </label>
              <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: COLORS.text }}>
                <input type="checkbox"
                       checked={config.sides.neutral}
                       onChange={(e) => setConfig(c => ({ ...c, sides: { ...c.sides, neutral: e.target.checked } }))}
                       style={{ accentColor: '#7AC8FF' }} />
                Include neutral (squeezes)
              </label>
              <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: COLORS.text }}>
                <input type="checkbox"
                       checked={config.enableAiSummary}
                       onChange={(e) => setConfig(c => ({ ...c, enableAiSummary: e.target.checked }))}
                       style={{ accentColor: '#9F88FF' }} />
                AI narrative on top 5
              </label>
              <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: COLORS.text }}>
                <input type="checkbox"
                       checked={config.enableNotifications}
                       onChange={async (e) => {
                         const checked = e.target.checked;
                         if (checked) await requestNotifPermission();
                         setConfig(c => ({ ...c, enableNotifications: checked }));
                       }}
                       style={{ accentColor: COLORS.mint }} />
                Browser notifications
              </label>
              <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: COLORS.text }}>
                <input type="checkbox"
                       checked={config.multiTimeframe || false}
                       onChange={(e) => setConfig(c => ({ ...c, multiTimeframe: e.target.checked }))}
                       style={{ accentColor: '#7AC8FF' }} />
                Multi-timeframe (daily + weekly resonance)
              </label>
              <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: COLORS.text }}>
                <input type="checkbox"
                       checked={config.autoScan}
                       onChange={(e) => setConfig(c => ({ ...c, autoScan: e.target.checked }))}
                       style={{ accentColor: COLORS.mint }} />
                Auto-scan every
              </label>
              <select value={config.scanIntervalMs}
                      onChange={(e) => setConfig(c => ({ ...c, scanIntervalMs: Number(e.target.value) }))}
                      disabled={!config.autoScan}
                      className="px-2 py-1 rounded text-[11px] outline-none disabled:opacity-40"
                      style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                <option value={2 * 60_000}>2 min</option>
                <option value={5 * 60_000}>5 min</option>
                <option value={15 * 60_000}>15 min</option>
                <option value={30 * 60_000}>30 min</option>
                <option value={60 * 60_000}>1 hour</option>
              </select>
            </div>
          </div>
        </details>

        {/* Server-side scanner — opt-in. When on, the backend scanner
            service runs scans on a schedule against your watchlist
            and pushes alerts via SSE. Useful for "watch while you
            sleep" without keeping the tab open. */}
        <details className="rounded-md border mb-4"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          <summary className="px-3 py-2 cursor-pointer text-[11.5px] flex items-center justify-between"
                   style={{ color: COLORS.text }}>
            <span>
              Server-side scanner
              {config.serverSideAlerts && (
                <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{
                        background: serverScanStatus === 'connected' ? `${COLORS.green}20`
                                  : serverScanStatus === 'connecting' ? `${COLORS.mint}20`
                                  : serverScanStatus === 'error' ? `${COLORS.red}20`
                                  :                                    `${COLORS.textMute}20`,
                        color: serverScanStatus === 'connected' ? COLORS.green
                              : serverScanStatus === 'connecting' ? COLORS.mint
                              : serverScanStatus === 'error' ? COLORS.red
                              :                                  COLORS.textMute,
                      }}>
                  {serverScanStatus}
                </span>
              )}
            </span>
            <span className="text-[10px]" style={{ color: COLORS.textMute }}>
              {serverAlerts.length > 0 && `${serverAlerts.length} recent`}
            </span>
          </summary>
          <div className="px-3 pb-3 pt-2">
            <div className="text-[10.5px] mb-3 px-2 py-1.5 rounded"
                 style={{ background: 'rgba(122,200,255,0.06)', color: '#7AC8FF', border: '1px solid rgba(122,200,255,0.20)' }}>
              Backend scanner runs every 15 minutes against your watchlist.
              Hits push as browser notifications + appear in the feed below.
              Detectors on the server are currently stubs producing synthetic events for pipeline testing — real port pending Phase 1.
            </div>
            {!SCANNER_BASE && (
              <div className="text-[11px] px-2 py-1.5 rounded mb-3"
                   style={{ background: 'rgba(255,184,77,0.08)', color: '#FFB84D', border: '1px solid rgba(255,184,77,0.25)' }}>
                <strong>Not configured.</strong> Set <code>VITE_SCANNER_API_URL</code> in your environment to enable this feature.
              </div>
            )}
            <label className="flex items-center gap-1.5 text-[11.5px] mb-3" style={{ color: SCANNER_BASE ? COLORS.text : COLORS.textMute }}>
              <input type="checkbox"
                     checked={config.serverSideAlerts}
                     onChange={async (e) => {
                       const checked = e.target.checked;
                       if (checked) await requestNotifPermission();
                       setConfig(c => ({ ...c, serverSideAlerts: checked }));
                     }}
                     disabled={!SCANNER_BASE}
                     style={{ accentColor: COLORS.mint }} />
              Enable server-side scanning + SSE alerts
            </label>
            {config.serverSideAlerts && SCANNER_BASE && (
              <>
                <div className="text-[10px] mb-2" style={{ color: COLORS.textMute }}>
                  Scanner URL: <code style={{ color: COLORS.textDim }}>{SCANNER_BASE}</code>
                  · Session ID: <code style={{ color: COLORS.textDim }}>{serverUserId}</code>
                </div>
                <div className="text-[10px] mb-3" style={{ color: COLORS.textMute }}>
                  Watchlist syncs automatically when you edit it. Auth: {SCANNER_TOKEN ? <span style={{ color: COLORS.green }}>token configured</span> : <span style={{ color: '#FFB84D' }}>no auth (dev mode)</span>}.
                </div>
                {serverAlerts.length > 0 ? (
                  <div className="rounded border"
                       style={{ borderColor: COLORS.border, background: COLORS.bg, maxHeight: 240, overflowY: 'auto' }}>
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wider sticky top-0"
                         style={{ color: COLORS.textMute, background: COLORS.bg, borderBottom: `1px solid ${COLORS.border}` }}>
                      Recent alerts (newest first)
                    </div>
                    {serverAlerts.slice(0, 20).map((a) => (
                      <div key={a.id} className="px-2 py-1.5 text-[11px] border-b"
                           style={{ borderColor: COLORS.border }}>
                        <div className="flex items-baseline justify-between">
                          <div>
                            <span style={{ color: COLORS.text, fontWeight: 500 }}>{a.ticker}</span>
                            <span className="ml-1.5 text-[10px] uppercase tracking-wider px-1 py-0.5 rounded"
                                  style={{ background: 'rgba(255,255,255,0.04)', color: COLORS.textDim }}>
                              {a.rule_id}
                            </span>
                            <span className="ml-1.5 tabular-nums" style={{ color: a.score >= 75 ? COLORS.green : COLORS.text }}>
                              {a.score}
                            </span>
                          </div>
                          <span className="text-[9.5px] tabular-nums" style={{ color: COLORS.textMute }}>
                            {new Date(a.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                        {a.notes && (
                          <div className="text-[10px] mt-0.5" style={{ color: COLORS.textDim }}>{a.notes}</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10.5px] px-2 py-2 rounded text-center"
                       style={{ background: COLORS.bg, color: COLORS.textMute, border: `1px dashed ${COLORS.border}` }}>
                    No alerts yet. The scanner runs every 15 min — you'll see hits here as they arrive.
                  </div>
                )}
              </>
            )}
          </div>
        </details>

        {/* Detector parameters — collapsible */}
        <details className="rounded-md border mb-4"
                 style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          <summary className="px-3 py-2 cursor-pointer text-[11.5px] flex items-center justify-between"
                   style={{ color: COLORS.text }}>
            <span>Detector parameters</span>
            <span className="text-[10px]" style={{ color: COLORS.textMute }}>
              {Object.keys(config.detectorParams || {}).filter(k =>
                Object.keys(config.detectorParams[k] || {}).length > 0).length} customized
            </span>
          </summary>
          <div className="px-3 pb-3 pt-2">
            <div className="text-[10.5px] mb-3 px-2 py-1.5 rounded"
                 style={{ background: 'rgba(122,200,255,0.06)', color: '#7AC8FF', border: '1px solid rgba(122,200,255,0.20)' }}>
              Tune individual detectors. RSI period, breakout window, BB lookback etc. all become user-configurable. Empty fields use the defaults shown in placeholder text. Changes apply on the next scan.
            </div>
            <div className="space-y-3">
              {Object.entries(DETECTOR_DEFAULTS).map(([ruleId, defaults]) => {
                const rule = SETUP_RULES.find(r => r.id === ruleId);
                if (!rule) return null;
                if (Object.keys(defaults).length === 0) return null;
                const overrides = config.detectorParams?.[ruleId] || {};
                const setOverride = (key, value) => {
                  setConfig(c => ({
                    ...c,
                    detectorParams: {
                      ...(c.detectorParams || {}),
                      [ruleId]: value === '' || value == null
                        ? Object.fromEntries(Object.entries(c.detectorParams?.[ruleId] || {}).filter(([k]) => k !== key))
                        : { ...(c.detectorParams?.[ruleId] || {}), [key]: value },
                    },
                  }));
                };
                return (
                  <div key={ruleId} className="rounded border p-2"
                       style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <div className="text-[11.5px] font-medium" style={{ color: COLORS.text }}>{rule.label}</div>
                      <span className="text-[10px] font-mono" style={{ color: COLORS.textMute }}>{ruleId}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {Object.entries(defaults).map(([key, defVal]) => (
                        <div key={key}>
                          <div className="text-[9.5px] uppercase tracking-wider mb-0.5" style={{ color: COLORS.textMute }}>
                            {key}
                          </div>
                          <input type="number"
                                 step={typeof defVal === 'number' && defVal < 1 ? 0.05 : 1}
                                 placeholder={String(defVal)}
                                 value={overrides[key] ?? ''}
                                 onChange={(e) => {
                                   const v = e.target.value === '' ? '' : Number(e.target.value);
                                   setOverride(key, v);
                                 }}
                                 className="w-full px-1.5 py-1 rounded text-[10.5px] outline-none tabular-nums"
                                 style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              <button type="button"
                      onClick={() => setConfig(c => ({ ...c, detectorParams: {} }))}
                      className="px-2 py-1 rounded text-[10.5px] hover:bg-white/[0.04]"
                      style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                Reset all to defaults
              </button>
            </div>
          </div>
        </details>

        {/* Scan controls + status */}
        <div className="rounded-md border p-3 mb-4 flex items-center gap-3 flex-wrap"
             style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          {scanStatus === 'idle' ? (
            <button type="button" onClick={runScan}
                    className="px-3 py-1.5 rounded text-[12px] font-medium inline-flex items-center gap-1.5"
                    style={{ background: COLORS.mint, color: COLORS.bg }}>
              <Play size={11} fill="currentColor" />
              Scan {tickers.length} tickers
            </button>
          ) : (
            <button type="button" onClick={cancelScan}
                    className="px-3 py-1.5 rounded text-[12px] font-medium inline-flex items-center gap-1.5"
                    style={{ background: 'rgba(255,85,119,0.15)', color: COLORS.red, border: '1px solid rgba(255,85,119,0.30)' }}>
              Cancel scan
            </button>
          )}
          {scanStatus === 'scanning' && (
            <div className="flex items-center gap-2 flex-1">
              <RefreshCw size={11} className="animate-spin" style={{ color: COLORS.mint }} />
              <div className="text-[11px]" style={{ color: COLORS.textDim }}>
                Scanning {progress.done}/{progress.total}…
              </div>
              <div className="flex-1 max-w-[300px] h-1 rounded overflow-hidden"
                   style={{ background: COLORS.border }}>
                <div className="h-full transition-all"
                     style={{ width: `${progress.total > 0 ? (progress.done / progress.total * 100) : 0}%`, background: COLORS.mint }} />
              </div>
            </div>
          )}
          {scanStatus === 'idle' && lastScanAt && (
            <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
              Last scan: {new Date(lastScanAt).toLocaleTimeString()} · {results.length} hits
            </div>
          )}
          {scanError && (
            <div className="text-[10.5px]" style={{ color: COLORS.red }}>{scanError}</div>
          )}
        </div>

        {/* Setup feed */}
        {results.length === 0 && scanStatus === 'idle' && (
          <div className="rounded-md border p-6 text-center mb-6"
               style={{ borderColor: COLORS.border, background: COLORS.surface, color: COLORS.textMute }}>
            <div className="text-[12.5px]">
              {lastScanAt
                ? `No setups scored above ${config.minScore}. Try lowering the minimum, expanding the watchlist, or including more sides.`
                : 'No scans yet. Click "Scan" above to start, or enable Auto-scan in Settings.'}
            </div>
          </div>
        )}
        {results.length > 0 && (
          <div className="space-y-3 mb-8">
            <div className="text-[11px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
              Setup feed · {results.length} {results.length === 1 ? 'hit' : 'hits'}
            </div>
            {results.map((row, idx) => {
              const c = row.candidate;
              const tone = c.side === 'long'  ? COLORS.green
                         : c.side === 'short' ? COLORS.red
                         :                       '#7AC8FF';
              return (
                <div key={`${c.ticker}-${c.ruleId}-${idx}`}
                     className="rounded-md border p-3"
                     style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                  <div className="grid grid-cols-1 lg:grid-cols-[480px_1fr] gap-4">
                    {/* SVG chart */}
                    <div className="rounded overflow-hidden"
                         style={{ background: '#0F1115', border: `1px solid ${COLORS.border}` }}
                         dangerouslySetInnerHTML={{ __html: renderSetupSVG(c) }} />
                    {/* Right side — metadata + actions */}
                    <div className="min-w-0">
                      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
                        <div>
                          <div className="text-[15px] font-medium flex items-center gap-2 flex-wrap">
                            <span style={{ color: COLORS.text }}>{c.ticker}</span>
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                                  style={{ background: `${tone}20`, color: tone }}>
                              {c.side}
                            </span>
                            <span className="text-[12px]" style={{ color: COLORS.textDim }}>{c.label}</span>
                            {c.mtfBoost && (
                              <span className="text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
                                    style={{ background: 'rgba(122,200,255,0.10)', color: '#7AC8FF', border: '1px solid rgba(122,200,255,0.30)' }}
                                    title={`Weekly: ${c.weeklyConfirm?.label}`}>
                                MTF +20
                              </span>
                            )}
                            {c.mtfConflict && (
                              <span className="text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                                    style={{ background: 'rgba(255,184,77,0.10)', color: '#FFB84D', border: '1px solid rgba(255,184,77,0.30)' }}
                                    title="Weekly timeframe disagrees">
                                MTF conflict
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] mt-0.5" style={{ color: COLORS.textMute }}>
                            {c.notes}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Score</span>
                          <span className="text-[16px] font-medium tabular-nums"
                                style={{ color: c.score >= 80 ? COLORS.green : c.score >= 60 ? COLORS.text : COLORS.textDim }}>
                            {c.score}
                          </span>
                        </div>
                      </div>
                      {/* Levels */}
                      {c.levels && Object.keys(c.levels).length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
                          {Object.entries(c.levels).filter(([_, v]) => Number.isFinite(v)).map(([k, v]) => (
                            <div key={k} className="rounded border px-2 py-1"
                                 style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                              <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>{k}</div>
                              <div className="text-[11px] tabular-nums" style={{ color: COLORS.text }}>${v.toFixed(2)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* AI narrative */}
                      {row.summaryLoading && (
                        <div className="text-[11px] mb-2 px-2 py-1.5 rounded inline-flex items-center gap-1.5"
                             style={{ color: '#9F88FF', background: 'rgba(159,136,255,0.06)', border: '1px solid rgba(159,136,255,0.20)' }}>
                          <RefreshCw size={11} className="animate-spin" />
                          Generating AI narrative…
                        </div>
                      )}
                      {row.summary && !row.summaryLoading && (
                        <div className="text-[11.5px] mb-2 px-2 py-1.5 rounded leading-relaxed"
                             style={{ color: COLORS.text, background: 'rgba(159,136,255,0.04)', border: '1px solid rgba(159,136,255,0.20)' }}>
                          <div className="text-[9.5px] uppercase tracking-wider mb-1 flex items-center gap-1"
                               style={{ color: '#9F88FF' }}>
                            <Wand2 size={10} /> AI narrative
                          </div>
                          {row.summary}
                        </div>
                      )}
                      {/* Action buttons */}
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button"
                                onClick={() => {
                                  // Find an instrument by id and route to chart page
                                  const inst = (typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS : []).find(i => i.id === c.ticker);
                                  if (inst && setActive && setPage) {
                                    setActive(inst);
                                    setPage('trade');
                                  } else if (setPage) {
                                    setPage('research');
                                  }
                                }}
                                className="px-2 py-1 rounded text-[10.5px] hover:bg-white/[0.04]"
                                style={{ color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                          Open chart
                        </button>
                        {!row.summary && !row.summaryLoading && (
                          <button type="button"
                                  onClick={() => {
                                    setResults(prev => prev.map((r, i) => i === idx ? { ...r, summaryLoading: true } : r));
                                    summarizeSetupWithAI(c).then(({ summary, error }) => {
                                      setResults(prev => prev.map((r, i) => i === idx
                                        ? { ...r, summaryLoading: false, summary, summaryError: error || null }
                                        : r));
                                    });
                                  }}
                                  className="px-2 py-1 rounded text-[10.5px] inline-flex items-center gap-1 hover:bg-white/[0.04]"
                                  style={{ color: '#9F88FF', border: `1px solid rgba(159,136,255,0.30)` }}>
                            <Wand2 size={10} />
                            AI narrative
                          </button>
                        )}
                        <button type="button"
                                onClick={() => downloadSetupSVG(c)}
                                className="px-2 py-1 rounded text-[10.5px] inline-flex items-center gap-1 hover:bg-white/[0.04]"
                                style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                          <Download size={10} />
                          Save chart
                        </button>
                        <button type="button"
                                onClick={() => setActiveLensTicker(c.ticker)}
                                className="px-2 py-1 rounded text-[10.5px] hover:bg-white/[0.04]"
                                style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                          Run investor lens
                        </button>
                        <button type="button"
                                onClick={() => {
                                  const key = `${c.ticker}:${c.ruleId}`;
                                  setConfig(cfg => ({
                                    ...cfg,
                                    mutedTickers: [...(cfg.mutedTickers || []), key],
                                  }));
                                  // Optimistic — remove from current results
                                  setResults(prev => prev.filter((_, i) => i !== idx));
                                }}
                                className="px-2 py-1 rounded text-[10.5px] hover:bg-white/[0.04]"
                                style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}
                                title="Suppress this specific setup on this ticker until unmuted">
                          Mute setup
                        </button>
                        <button type="button"
                                onClick={() => {
                                  const key = `${c.ticker}:*`;
                                  setConfig(cfg => ({
                                    ...cfg,
                                    mutedTickers: [...(cfg.mutedTickers || []), key],
                                  }));
                                  setResults(prev => prev.filter(r => r.candidate.ticker !== c.ticker));
                                }}
                                className="px-2 py-1 rounded text-[10.5px] hover:bg-white/[0.04]"
                                style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}
                                title="Suppress all setups on this ticker">
                          Mute ticker
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Muted list — show below feed when there are muted entries */}
        {(config.mutedTickers || []).length > 0 && (
          <div className="rounded-md border p-3 mb-6"
               style={{ borderColor: COLORS.border, background: COLORS.surface }}>
            <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
              Muted · {(config.mutedTickers || []).length} entries
            </div>
            <div className="flex flex-wrap gap-1">
              {(config.mutedTickers || []).map((key, i) => (
                <button key={i} type="button"
                        onClick={() => setConfig(cfg => ({
                          ...cfg,
                          mutedTickers: (cfg.mutedTickers || []).filter((_, j) => j !== i),
                        }))}
                        className="px-2 py-1 rounded text-[10px] inline-flex items-center gap-1 hover:bg-white/[0.04]"
                        style={{ background: 'rgba(255,184,77,0.08)', color: '#FFB84D', border: '1px solid rgba(255,184,77,0.20)' }}
                        title="Click to unmute">
                  {key === key.replace(':*', '') ? key : key.replace(':*', ' (all)')}
                  <span style={{ color: COLORS.textMute }}>×</span>
                </button>
              ))}
              <button type="button"
                      onClick={() => setConfig(cfg => ({ ...cfg, mutedTickers: [] }))}
                      className="px-2 py-1 rounded text-[10px] hover:bg-white/[0.04]"
                      style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                Unmute all
              </button>
            </div>
          </div>
        )}

        {/* Multi-investor lens panel */}
        <div className="rounded-md border p-4 mb-6"
             style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          <div className="flex items-baseline gap-2 flex-wrap mb-3">
            <h2 className="text-[15px] font-medium" style={{ color: COLORS.text }}>Investor lens panel</h2>
            <span className="text-[10.5px]" style={{ color: COLORS.textMute }}>
              Apply legendary-investor frameworks to a single ticker
            </span>
          </div>

          {/* Ticker + lens picker */}
          <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr_auto] gap-3 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Ticker</div>
              <input type="text"
                     value={activeLensTicker}
                     onChange={(e) => setActiveLensTicker(e.target.value.toUpperCase())}
                     className="w-full px-2 py-1.5 rounded text-[12px] outline-none font-mono"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                Investor frameworks ({lensSelection.length} selected)
              </div>
              <div className="flex flex-wrap gap-1">
                {INVESTOR_LENSES.map(l => {
                  const picked = lensSelection.includes(l.id);
                  return (
                    <button key={l.id} type="button"
                            onClick={() => setLensSelection(s =>
                              s.includes(l.id) ? s.filter(x => x !== l.id) : [...s, l.id])}
                            className="px-2 py-1 rounded text-[10.5px] transition-colors"
                            style={{
                              background: picked ? `${COLORS.mint}1A` : COLORS.bg,
                              color: picked ? COLORS.mint : COLORS.textDim,
                              border: `1px solid ${picked ? COLORS.mint : COLORS.border}`,
                            }}
                            title={l.description}>
                      {l.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="self-end">
              <button type="button"
                      onClick={runAllSelectedLenses}
                      disabled={!activeLensTicker || lensSelection.length === 0}
                      className="px-3 py-1.5 rounded text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40"
                      style={{ background: COLORS.mint, color: COLORS.bg }}>
                <Wand2 size={11} /> Run lenses
              </button>
            </div>
          </div>

          {/* Lens results — one card per selected lens */}
          {Object.keys(lensResults).filter(k => k !== '_ticker').length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {lensSelection.map(lensId => {
                const lens = INVESTOR_LENSES.find(l => l.id === lensId);
                const r = lensResults[lensId];
                if (!lens || !r) return null;
                const tone = r.signal === 'bullish' ? COLORS.green
                           : r.signal === 'bearish' ? COLORS.red
                           : r.signal === 'neutral' ? COLORS.textDim
                           :                          COLORS.textMute;
                return (
                  <div key={lensId} className="rounded-md border p-3"
                       style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <div className="text-[12.5px] font-medium" style={{ color: COLORS.text }}>{lens.label}</div>
                      {r.loading && (
                        <span className="text-[10px] inline-flex items-center gap-1" style={{ color: COLORS.textMute }}>
                          <RefreshCw size={9} className="animate-spin" /> Thinking…
                        </span>
                      )}
                      {!r.loading && r.signal && (
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                              style={{ background: `${tone}20`, color: tone }}>
                          {r.signal} · {(r.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <div className="text-[10px]" style={{ color: COLORS.textMute }}>{lens.description}</div>
                    {r.error && (
                      <div className="text-[11px] mt-2 px-2 py-1 rounded"
                           style={{ background: 'rgba(255,85,119,0.08)', color: COLORS.red }}>
                        {r.error}
                      </div>
                    )}
                    {r.thesis && (
                      <div className="text-[11.5px] mt-2 leading-relaxed" style={{ color: COLORS.text }}>
                        {r.thesis}
                      </div>
                    )}
                    {Array.isArray(r.key_points) && r.key_points.length > 0 && (
                      <div className="mt-2">
                        <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Key points</div>
                        <ul className="text-[11px] space-y-0.5" style={{ color: COLORS.textDim, listStyle: 'disc', paddingLeft: 16 }}>
                          {r.key_points.map((p, i) => <li key={i}>{p}</li>)}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(r.risks) && r.risks.length > 0 && (
                      <div className="mt-2">
                        <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Risks</div>
                        <ul className="text-[11px] space-y-0.5" style={{ color: COLORS.textDim, listStyle: 'disc', paddingLeft: 16 }}>
                          {r.risks.map((p, i) => <li key={i}>{p}</li>)}
                        </ul>
                      </div>
                    )}
                    {/* Trade plan — only shown for non-neutral signals with valid prices */}
                    {r.trade_plan && r.signal !== 'neutral' && Number.isFinite(r.trade_plan.entry) && (
                      <div className="mt-2 pt-2 border-t" style={{ borderColor: COLORS.border }}>
                        <div className="text-[9.5px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.textMute }}>
                          Trade plan
                        </div>
                        <div className="grid grid-cols-3 gap-1 mb-1.5">
                          <div className="rounded border p-1.5" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                            <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Entry</div>
                            <div className="text-[11px] tabular-nums" style={{ color: tone }}>
                              ${Number(r.trade_plan.entry).toFixed(2)}
                            </div>
                          </div>
                          <div className="rounded border p-1.5" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                            <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Stop</div>
                            <div className="text-[11px] tabular-nums" style={{ color: COLORS.red }}>
                              {Number.isFinite(r.trade_plan.stop) ? `$${Number(r.trade_plan.stop).toFixed(2)}` : '—'}
                            </div>
                          </div>
                          <div className="rounded border p-1.5" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                            <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Target</div>
                            <div className="text-[11px] tabular-nums" style={{ color: COLORS.green }}>
                              {Number.isFinite(r.trade_plan.target) ? `$${Number(r.trade_plan.target).toFixed(2)}` : '—'}
                            </div>
                          </div>
                        </div>
                        {Number.isFinite(r.trade_plan.entry) && Number.isFinite(r.trade_plan.stop) &&
                         Number.isFinite(r.trade_plan.target) && r.trade_plan.entry !== r.trade_plan.stop && (
                          <div className="text-[10px] tabular-nums mb-1" style={{ color: COLORS.textDim }}>
                            R:R = {(Math.abs(r.trade_plan.target - r.trade_plan.entry) /
                                     Math.abs(r.trade_plan.entry - r.trade_plan.stop)).toFixed(2)}
                            {Number.isFinite(r.trade_plan.sizing_pct) && (
                              <span className="ml-3">Size: {r.trade_plan.sizing_pct}% of portfolio</span>
                            )}
                          </div>
                        )}
                        {r.trade_plan.invalidation && (
                          <div className="text-[10.5px] italic" style={{ color: COLORS.textDim }}>
                            Invalidation: {r.trade_plan.invalidation}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Consensus row — quick summary across all returned lenses */}
          {(() => {
            const valid = lensSelection
              .map(id => lensResults[id])
              .filter(r => r && r.signal);
            if (valid.length < 2) return null;
            const bull = valid.filter(r => r.signal === 'bullish').length;
            const bear = valid.filter(r => r.signal === 'bearish').length;
            const neut = valid.filter(r => r.signal === 'neutral').length;
            const avgConf = valid.reduce((a, b) => a + (b.confidence || 0), 0) / valid.length;
            const consensus = bull > bear + neut ? 'bullish'
                            : bear > bull + neut ? 'bearish'
                            : 'mixed';
            const tone = consensus === 'bullish' ? COLORS.green
                       : consensus === 'bearish' ? COLORS.red
                       :                            COLORS.textDim;
            return (
              <div className="mt-3 rounded-md border p-2 flex items-center justify-between flex-wrap gap-2"
                   style={{ borderColor: tone + '55', background: `${tone}0A` }}>
                <div className="text-[11px]" style={{ color: COLORS.text }}>
                  <span className="text-[9.5px] uppercase tracking-wider mr-2" style={{ color: COLORS.textMute }}>Consensus</span>
                  <span className="font-medium" style={{ color: tone }}>{consensus.toUpperCase()}</span>
                  <span className="ml-2" style={{ color: COLORS.textDim }}>
                    ({bull} bull · {bear} bear · {neut} neutral · avg confidence {(avgConf * 100).toFixed(0)}%)
                  </span>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Hedge fund team panel — multi-agent IC deliberation */}
        <div className="rounded-md border p-4 mb-6"
             style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          <div className="flex items-baseline gap-2 flex-wrap mb-3">
            <h2 className="text-[15px] font-medium" style={{ color: COLORS.text }}>Hedge fund team</h2>
            <span className="text-[10.5px]" style={{ color: COLORS.textMute }}>
              5-agent IC deliberation: Director → Quant → Risk → Execution → IC Chair
            </span>
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(159,136,255,0.10)', color: '#9F88FF' }}>5 LLM calls</span>
          </div>
          <p className="text-[11px] mb-3" style={{ color: COLORS.textDim }}>
            Adapted from the AutoHedge multi-agent pattern + FinceptTerminal's Renaissance Technologies hedgeFundAgents config. Each agent receives the prior agents' structured outputs as context, so by the time the IC reads, it sees the full debate. Risk can veto. The IC produces a final go/no-go.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Ticker</div>
              <input type="text"
                     value={hfTicker}
                     onChange={(e) => setHfTicker(e.target.value.toUpperCase())}
                     className="w-full px-2 py-1.5 rounded text-[12px] outline-none font-mono"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            </div>
            <div className="self-end">
              <button type="button"
                      onClick={runTeamNow}
                      disabled={!hfTicker || hfStatus === 'running'}
                      className="px-3 py-1.5 rounded text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-40"
                      style={{ background: COLORS.mint, color: COLORS.bg }}>
                {hfStatus === 'running' ? <RefreshCw size={11} className="animate-spin" /> : <Wand2 size={11} />}
                {hfStatus === 'running' ? `Running ${hfCurrentAgent || ''}…` : 'Run team deliberation'}
              </button>
            </div>
          </div>

          {hfResults._error && (
            <div className="rounded-md border p-2 text-[11.5px] mb-3"
                 style={{ borderColor: COLORS.red, color: COLORS.red, background: 'rgba(255,85,119,0.06)' }}>
              {hfResults._error}
            </div>
          )}

          {/* Agent pipeline visualization */}
          {(hfStatus === 'running' || Object.keys(hfResults).filter(k => k !== '_ticker' && k !== '_error').length > 0) && (
            <div className="space-y-2">
              {HEDGE_FUND_AGENTS.map((agent, idx) => {
                const r = hfResults[agent.id];
                const isCurrent = hfCurrentAgent === agent.id;
                const isDone = r && !r.loading;
                const hasError = r?.error;
                const tone = hasError ? COLORS.red
                           : isCurrent ? '#9F88FF'
                           : isDone     ? COLORS.green
                           :              COLORS.textMute;
                return (
                  <div key={agent.id} className="rounded-md border p-3"
                       style={{
                         borderColor: tone,
                         background: isCurrent ? 'rgba(159,136,255,0.04)' : COLORS.bg,
                       }}>
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium tabular-nums"
                           style={{ background: `${tone}20`, color: tone }}>
                        {idx + 1}
                      </div>
                      <div className="text-[12.5px] font-medium" style={{ color: COLORS.text }}>{agent.label}</div>
                      <div className="text-[10px]" style={{ color: COLORS.textMute }}>{agent.role}</div>
                      {isCurrent && (
                        <span className="ml-auto text-[10px] inline-flex items-center gap-1" style={{ color: '#9F88FF' }}>
                          <RefreshCw size={9} className="animate-spin" />
                          thinking
                        </span>
                      )}
                      {hasError && (
                        <span className="ml-auto text-[10px]" style={{ color: COLORS.red }}>error</span>
                      )}
                      {isDone && !hasError && (
                        <span className="ml-auto text-[10px]" style={{ color: COLORS.green }}>✓ done</span>
                      )}
                    </div>
                    {hasError && (
                      <div className="text-[11px]" style={{ color: COLORS.red }}>{r.error}</div>
                    )}
                    {isDone && !hasError && (
                      <div className="text-[11px] space-y-0.5">
                        {/* Director */}
                        {agent.id === 'director' && (
                          <>
                            <div style={{ color: COLORS.text }}>
                              <span className="text-[10px] uppercase tracking-wider mr-2" style={{ color: COLORS.textMute }}>Direction</span>
                              <span className="font-medium" style={{
                                color: r.direction === 'long' ? COLORS.green
                                     : r.direction === 'short' ? COLORS.red
                                     : COLORS.textDim
                              }}>{r.direction}</span>
                              <span className="ml-3 text-[10px]" style={{ color: COLORS.textMute }}>horizon: {r.horizon}</span>
                            </div>
                            {r.thesis && <div style={{ color: COLORS.textDim, marginTop: 4 }}>{r.thesis}</div>}
                            {Array.isArray(r.confirms) && r.confirms.length > 0 && (
                              <div style={{ color: COLORS.green, marginTop: 4 }}>
                                <span className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Confirms: </span>
                                {r.confirms.join(' · ')}
                              </div>
                            )}
                            {Array.isArray(r.breaks) && r.breaks.length > 0 && (
                              <div style={{ color: COLORS.red }}>
                                <span className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Breaks: </span>
                                {r.breaks.join(' · ')}
                              </div>
                            )}
                          </>
                        )}
                        {/* Quant */}
                        {agent.id === 'quant' && (
                          <>
                            <div className="flex flex-wrap gap-3 mt-1">
                              <span><span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>Tech</span><span className="tabular-nums">{r.technical_score}</span></span>
                              <span><span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>Mom</span><span className="tabular-nums">{r.momentum_score}</span></span>
                              <span><span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>Vol</span><span className="tabular-nums">{r.volatility_score}</span></span>
                              <span><span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>P(success)</span><span className="tabular-nums" style={{ color: r.probability >= 0.6 ? COLORS.green : r.probability >= 0.5 ? COLORS.text : COLORS.red }}>{(r.probability * 100).toFixed(0)}%</span></span>
                              <span><span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>vs Director</span><span style={{ color: r.agreement_with_director === 'agree' ? COLORS.green : r.agreement_with_director === 'disagree' ? COLORS.red : '#FFB84D' }}>{r.agreement_with_director}</span></span>
                            </div>
                            {Array.isArray(r.evidence) && (
                              <ul className="mt-1 list-disc pl-5" style={{ color: COLORS.textDim }}>
                                {r.evidence.map((e, i) => <li key={i}>{e}</li>)}
                              </ul>
                            )}
                            {r.rationale && <div style={{ color: COLORS.textDim, marginTop: 2 }}>{r.rationale}</div>}
                          </>
                        )}
                        {/* Risk */}
                        {agent.id === 'risk' && (
                          <>
                            <div className="flex flex-wrap gap-3 mt-1">
                              <span><span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>Size</span><span className="tabular-nums">{r.position_size_pct?.toFixed(1)}%</span></span>
                              <span><span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>Max DD est</span><span className="tabular-nums" style={{ color: COLORS.red }}>{(r.max_drawdown_est * 100).toFixed(1)}%</span></span>
                              <span><span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>VaR 95</span><span className="tabular-nums">{(r.var_95_est * 100).toFixed(1)}%</span></span>
                              <span><span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>Tail risk</span><span style={{ color: r.tail_risk === 'low' ? COLORS.green : r.tail_risk === 'high' ? COLORS.red : '#FFB84D' }}>{r.tail_risk}</span></span>
                              {r.veto && (
                                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded"
                                      style={{ background: `${COLORS.red}20`, color: COLORS.red }}>
                                  VETO
                                </span>
                              )}
                            </div>
                            {r.rationale && <div style={{ color: COLORS.textDim, marginTop: 2 }}>{r.rationale}</div>}
                            {r.veto && r.veto_reason && (
                              <div style={{ color: COLORS.red, marginTop: 2 }}>Veto reason: {r.veto_reason}</div>
                            )}
                          </>
                        )}
                        {/* Execution */}
                        {agent.id === 'execution' && (
                          <>
                            {r.skip_trade ? (
                              <div className="mt-1" style={{ color: '#FFB84D' }}>
                                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded mr-2"
                                      style={{ background: 'rgba(255,184,77,0.15)' }}>SKIP</span>
                                {r.skip_reason}
                              </div>
                            ) : (
                              <>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                                  <div className="rounded border p-1.5" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Entry</div>
                                    <div className="tabular-nums">${r.entry_price?.toFixed(2)}</div>
                                  </div>
                                  <div className="rounded border p-1.5" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Stop</div>
                                    <div className="tabular-nums" style={{ color: COLORS.red }}>${r.stop_price?.toFixed(2)}</div>
                                  </div>
                                  <div className="rounded border p-1.5" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Target</div>
                                    <div className="tabular-nums" style={{ color: COLORS.green }}>${r.target_price?.toFixed(2)}</div>
                                  </div>
                                  <div className="rounded border p-1.5" style={{ borderColor: COLORS.border, background: COLORS.surface }}>
                                    <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>R:R</div>
                                    <div className="tabular-nums" style={{ color: r.expected_r_r >= 2 ? COLORS.green : r.expected_r_r >= 1.5 ? COLORS.text : COLORS.red }}>{r.expected_r_r?.toFixed(2)}</div>
                                  </div>
                                </div>
                                <div className="text-[10px] mt-1" style={{ color: COLORS.textMute }}>
                                  {r.order_type} · {r.size_units} units · {r.time_in_force}
                                </div>
                              </>
                            )}
                          </>
                        )}
                        {/* IC */}
                        {agent.id === 'ic' && (
                          <>
                            <div className="mt-1">
                              <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded font-medium"
                                    style={{
                                      background: r.decision === 'approve' ? `${COLORS.green}20` : `${COLORS.red}20`,
                                      color: r.decision === 'approve' ? COLORS.green : COLORS.red,
                                    }}>
                                {r.decision === 'approve' ? '✓ APPROVED' : '✗ REJECTED'}
                              </span>
                            </div>
                            {r.rationale && <div style={{ color: COLORS.text, marginTop: 4 }}>{r.rationale}</div>}
                            {Array.isArray(r.concerns) && r.concerns.length > 0 && (
                              <div className="mt-1">
                                <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>Concerns:</span>
                                <span style={{ color: '#FFB84D' }}>{r.concerns.join(' · ')}</span>
                              </div>
                            )}
                            {Array.isArray(r.follow_ups) && r.follow_ups.length > 0 && (
                              <div>
                                <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: COLORS.textMute }}>Watch for:</span>
                                <span style={{ color: COLORS.textDim }}>{r.follow_ups.join(' · ')}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
