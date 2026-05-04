// IMO Onyx Terminal — Basket components (TradePage market baskets)
//
// Phase 3p.31 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines 5687-6466, ~780 lines).
//
// Fifth "lift the children" phase preparing for TradePage extraction.
// MarketBasketsModal is TradePage's pre-built portfolio basket
// browser (AI infrastructure, Magnificent 7, cloud titans, etc.)
// with one-click invest. Two helper components: AITrendingBasket
// generates a trending-stocks basket via AI, and AutopilotMiniSubpage
// shows autopilot strategy details.
//
// Public exports:
//   MarketBasketsModal({ account, onClose, onBuy, onOpenPosition })
//   BasketIcon({ iconKey, color, size })             — 8 callers
//   AutopilotMiniSubpage({ account, strategies, onOpenPosition,
//                          onBought })               — 3 callers
//
// Internal (only used by MarketBasketsModal):
//   AITrendingBasket    — AI-generated trending basket
//   BASKET_ICON_MAP     — basket-id → lucide-icon registry
//
// Imports:
//   lib/constants.js    (COLORS)
//   lib/instruments.js  (INSTRUMENTS)
//   lib/ai-calls.js     (callAI)
//   mini-widgets.jsx    (AUTOPILOT_STRATEGIES re-exported as a
//                        fixture there in 3p.28)

import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity, Award, Cloud, Coins, Cpu, Landmark, Layers, Leaf,
  Search, Shield, Smartphone, Sparkles, TrendingUp, X, Zap,
} from 'lucide-react';
import { COLORS } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import { callAI } from '../lib/ai-calls.js';
import { AUTOPILOT_STRATEGIES } from './mini-widgets.jsx';

// MARKET_BASKETS — curated basket fixtures (inlined from monolith).
const MARKET_BASKETS = [
  {
    id: 'ai-infra',
    name: 'AI Infrastructure',
    // iconKey is rendered via the BasketIcon helper below — looks up the
    // matching lucide icon. Replaces the prior emoji-only design which
    // didn't fit the polished UI surface.
    iconKey: 'ai-infra',
    color: '#7AC8FF',
    desc: 'The picks-and-shovels of the AI buildout — chip designers, hyperscalers, and networking.',
    holdings: [
      { ticker: 'NVDA', weight: 25, role: 'GPU compute' },
      { ticker: 'MSFT', weight: 25, role: 'Cloud + Copilot' },
      { ticker: 'GOOG', weight: 25, role: 'TPU + GCP' },
      { ticker: 'META', weight: 25, role: 'Llama + capex' },
    ],
    perf30d: 4.8,
  },
  {
    id: 'mag-7',
    name: 'Magnificent 7',
    iconKey: 'mag-7',
    color: '#FFB84D',
    desc: 'The market-cap leaders driving over half of S&P 500 returns.',
    holdings: [
      { ticker: 'AAPL', weight: 14, role: 'Consumer hardware' },
      { ticker: 'MSFT', weight: 14, role: 'Enterprise SaaS' },
      { ticker: 'GOOG', weight: 14, role: 'Search + ads' },
      { ticker: 'AMZN', weight: 14, role: 'E-comm + AWS' },
      { ticker: 'NVDA', weight: 14, role: 'AI chips' },
      { ticker: 'META', weight: 14, role: 'Social + ads' },
      { ticker: 'TSLA', weight: 14, role: 'EV + energy' },
    ],
    perf30d: 3.2,
  },
  {
    id: 'consumer-tech',
    name: 'Consumer Tech',
    iconKey: 'consumer-tech',
    color: '#FF7AB6',
    desc: 'Brands consumers see daily — devices, services, and the platforms underneath.',
    holdings: [
      { ticker: 'AAPL', weight: 35, role: 'Devices + services' },
      { ticker: 'AMZN', weight: 35, role: 'Retail + Prime' },
      { ticker: 'GOOG', weight: 30, role: 'Search + YouTube' },
    ],
    perf30d: 2.4,
  },
  {
    id: 'cloud-titans',
    name: 'Cloud Titans',
    iconKey: 'cloud-titans',
    color: '#A0C476',
    desc: 'The "big three" hyperscalers controlling enterprise compute infrastructure.',
    holdings: [
      { ticker: 'MSFT', weight: 34, role: 'Azure' },
      { ticker: 'AMZN', weight: 33, role: 'AWS' },
      { ticker: 'GOOG', weight: 33, role: 'GCP' },
    ],
    perf30d: 5.1,
  },
  {
    id: 'finance',
    name: 'Wall Street',
    iconKey: 'finance',
    color: '#E07AFC',
    desc: 'Money-center banks and asset managers — beneficiaries of high rates and active markets.',
    holdings: [
      { ticker: 'JPM',  weight: 50, role: 'Largest US bank' },
      { ticker: 'AAPL', weight: 50, role: 'Apple Card partnership' },
    ],
    perf30d: 1.8,
  },
];

const BASKET_ICON_MAP = {
  'ai-infra':       Cpu,
  'mag-7':          Award,
  'consumer-tech':  Smartphone,
  'cloud-titans':   Cloud,
  'finance':        Landmark,
  'trending':       TrendingUp,
  'energy':         Zap,
  'biotech':        Activity,
  'crypto':         Coins,
  'green':          Leaf,
  'defense':        Shield,
};
export const BasketIcon = ({ iconKey, color, size = 32 }) => {
  const Comp = BASKET_ICON_MAP[iconKey] ?? Layers;
  return <Comp size={size} strokeWidth={1.7} style={{ color: color ?? '#7AC8FF' }} />;
};

// AI-generated trending basket — fetches Exa "trending themes today" and
// asks Anthropic for a basket of 4-6 tickers that capture them. Click the
// row to load it into the same selection flow as a static basket.
//
// This is the live equivalent of the static MARKET_BASKETS list — the
// generation runs once per 12-hour window per session (cached in
// localStorage), so the user sees fresh themes daily without burning API
// quota on every modal open.
const AITrendingBasket = ({ onSelect }) => {
  const CACHE_KEY = 'imo_ai_basket_today';
  const [basket, setBasket] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Check cache first — only regenerate every 12 hours
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
      if (cached && (Date.now() - cached.ts) < 12 * 60 * 60 * 1000) {
        setBasket(cached.basket);
        return;
      }
    } catch {}
    // Otherwise fetch fresh
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Exa search for what's trending in financial news this week
        const exaRes = await fetch('/api/exa-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: 'most discussed stock market themes and sectors trending this week',
            numResults: 5,
            type: 'auto',
            useAutoprompt: true,
          }),
        }).catch(() => null);
        let exaContext = '';
        if (exaRes && exaRes.ok) {
          const exaJson = await exaRes.json();
          const titles = (exaJson?.results ?? []).slice(0, 5).map(r => `- ${r.title}`).join('\n');
          exaContext = titles ? `Recent trending headlines:\n${titles}\n\n` : '';
        }
        // 2. Ask Anthropic to synthesize a basket
        const prompt = `${exaContext}Based on what's trending in markets right now, propose ONE thematic stock basket of 4-6 large-cap US tickers that captures the strongest current theme.

Respond ONLY with valid JSON in this exact format (no markdown, no code fences):
{
  "name": "Theme Name",
  "icon": "single emoji",
  "desc": "one-sentence thesis explaining the theme",
  "holdings": [
    {"ticker": "TICKER", "weight": 25, "role": "what they do in this theme"},
    {"ticker": "TICKER", "weight": 25, "role": "..."}
  ]
}

Weights should sum to 100. Use tickers Americans can buy on a major US exchange.`;
        const text = await callAI(prompt, { maxTokens: 500 });
        if (cancelled) return;
        if (!text) throw new Error('AI returned empty response');
        // Strip any markdown fences just in case
        const cleaned = text.replace(/```json|```/g, '').trim();
        let parsed;
        try { parsed = JSON.parse(cleaned); }
        catch { throw new Error('AI returned invalid JSON'); }
        const ai = {
          id: 'ai-trending',
          name: parsed.name || 'Trending today',
          icon: parsed.icon || '🔥',
          color: '#FF8855',
          desc: parsed.desc || 'AI-generated thematic basket based on current market trends.',
          holdings: (parsed.holdings ?? []).filter(h => h.ticker).slice(0, 6),
          perf30d: 0,
          isAI: true,
          generatedAt: Date.now(),
        };
        setBasket(ai);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), basket: ai })); } catch {}
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          // Fall back to a generic "AI Picks" placeholder so the slot isn't empty
          setBasket({
            id: 'ai-trending-fallback',
            name: 'AI Picks (offline)',
            iconKey: 'ai',
            color: '#7AC8FF',
            desc: 'AI basket generation is offline. Configure VITE_ANTHROPIC_API_KEY and EXA_API_KEY in Vercel to enable.',
            holdings: [
              { ticker: 'NVDA', weight: 25, role: 'AI infrastructure' },
              { ticker: 'MSFT', weight: 25, role: 'Cloud + Copilot' },
              { ticker: 'GOOG', weight: 25, role: 'Search + cloud' },
              { ticker: 'AAPL', weight: 25, role: 'Consumer hardware' },
            ],
            perf30d: 0,
            isAI: true,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mb-6 rounded-md border overflow-hidden"
         style={{
           background: `linear-gradient(135deg, rgba(61,123,255,0.08) 0%, rgba(255,136,85,0.04) 100%)`,
           borderColor: COLORS.borderHi,
         }}>
      <div className="px-4 py-3 flex items-center justify-between border-b"
           style={{ borderColor: COLORS.border }}>
        <div className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: COLORS.mint }} />
          <span className="text-[10.5px] uppercase tracking-wider font-semibold"
                style={{ color: COLORS.mint, letterSpacing: '0.08em' }}>
            AI · Trending today
          </span>
          {loading && (
            <span className="text-[9.5px]" style={{ color: COLORS.textMute }}>
              · generating from Exa trends…
            </span>
          )}
        </div>
        <span className="text-[9.5px]" style={{ color: COLORS.textMute }}>
          Refreshes every 12h
        </span>
      </div>
      {basket ? (
        <button onClick={() => onSelect(basket)}
                className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/[0.03] transition-colors">
          <div className="rounded-md flex items-center justify-center shrink-0"
               style={{
                 width: 72, height: 72,
                 background: `linear-gradient(135deg, ${basket.color}40 0%, ${basket.color}10 100%)`,
                 border: `1px solid ${basket.color}33`,
               }}>
            {/* AI baskets don't have an iconKey, but the BasketIcon
                helper falls back to a generic Layers icon. We pass
                'trending' explicitly here since this whole component
                IS the trending AI basket — gives it a TrendingUp icon. */}
            <BasketIcon iconKey={basket.iconKey ?? 'trending'} color={basket.color ?? '#7AC8FF'} size={32} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
              <span className="text-[14px] font-medium" style={{ color: COLORS.text }}>
                {basket.name}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                    style={{ background: 'rgba(61,123,255,0.15)', color: COLORS.mint }}>
                AI generated
              </span>
            </div>
            <div className="text-[11.5px] leading-snug mb-2"
                 style={{ color: COLORS.textDim }}>
              {basket.desc}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {basket.holdings.map((h, i) => (
                <span key={i}
                      className="text-[10.5px] px-1.5 py-0.5 rounded tabular-nums"
                      style={{
                        background: COLORS.bg,
                        color: COLORS.text,
                        border: `1px solid ${COLORS.border}`,
                      }}>
                  {h.ticker}
                </span>
              ))}
            </div>
          </div>
          <div className="text-[11px] shrink-0 self-start" style={{ color: COLORS.mint }}>
            Click to buy →
          </div>
        </button>
      ) : (
        <div className="px-4 py-6 text-[11.5px]"
             style={{ color: COLORS.textMute }}>
          {loading ? 'Pulling trending themes from Exa + asking AI for a basket…' : (error ?? 'No basket available right now.')}
        </div>
      )}
    </div>
  );
};

// AutopilotMiniSubpage — copy-trade UI shown inside the Market Baskets
// modal under the "Autopilot" tab. Mirrors the full Autopilot page's
// strategy picker + copy flow but laid out for an inline modal panel.
// Reuses AUTOPILOT_STRATEGIES so the data is identical to the page.
export const AutopilotMiniSubpage = ({ account, strategies, onOpenPosition, onBought }) => {
  const [selectedId, setSelectedId] = useState(strategies[0]?.id);
  const [usdAmount, setUsdAmount] = useState('');
  const [feedback, setFeedback] = useState(null);
  const selected = strategies.find(s => s.id === selectedId) ?? strategies[0];
  const numericUsd = parseFloat(usdAmount) || 0;
  const balance = account?.balance ?? 0;
  const insufficient = numericUsd > balance && balance > 0;
  const handleCopy = async () => {
    if (!selected) return;
    if (!numericUsd || numericUsd <= 0) {
      setFeedback({ ok: false, msg: 'Enter an amount' });
      return;
    }
    if (insufficient) {
      setFeedback({ ok: false, msg: 'Insufficient balance' });
      return;
    }
    if (typeof onOpenPosition !== 'function') {
      setFeedback({ ok: false, msg: 'Open positions not available' });
      return;
    }
    // Await each open so the safety gate / broker router can sequence
    // the confirmations and we get accurate "opened" counts. Errors
    // and gate-blocked attempts no longer count toward `opened`.
    let opened = 0;
    let blocked = 0;
    for (const h of selected.holdings) {
      const inst = (typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS : []).find(i => i.id === h.ticker);
      if (!inst) continue;
      const usd = numericUsd * (h.weight / 100);
      const size = usd / (inst.mark || 1);
      try {
        const r = await Promise.resolve(onOpenPosition({
          instrument: inst, side: 'buy', size, leverage: 1, entryPrice: inst.mark,
        }));
        if (r && r.ok === false) blocked++;
        else opened++;
      } catch (e) {
        blocked++;
      }
    }
    setFeedback({
      ok: opened > 0,
      msg: blocked > 0
        ? `${selected.name.split('(')[0].trim()} · ${opened} opened, ${blocked} blocked`
        : `${selected.name.split('(')[0].trim()} copied · ${opened} positions opened`,
    });
    setUsdAmount('');
    setTimeout(() => { setFeedback(null); onBought?.(); }, 2400);
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
      {/* Strategy list */}
      <div className="space-y-1.5">
        {strategies.map(s => {
          const active = s.id === selectedId;
          return (
            <button key={s.id} onClick={() => setSelectedId(s.id)}
                    className="w-full text-left rounded-md p-2.5 transition-all"
                    style={{
                      background: active ? `${COLORS.mint}1A` : COLORS.surface,
                      border: `1px solid ${active ? COLORS.mint : COLORS.border}`,
                    }}>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
                     style={{ background: s.avatarColor ?? COLORS.mint, color: '#FFF' }}>
                  {s.avatar ?? s.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium truncate" style={{ color: COLORS.text }}>
                    {s.name.split('(')[0].trim()}
                  </div>
                  <div className="text-[10px] truncate" style={{ color: COLORS.textMute }}>
                    {s.author ?? ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] tabular-nums font-medium" style={{ color: COLORS.green }}>
                    +{s.return1y.toFixed(1)}%
                  </div>
                  <div className="text-[9px]" style={{ color: COLORS.textMute }}>1y</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {/* Selected detail */}
      {selected && (
        <div className="rounded-md p-4"
             style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold" style={{ color: COLORS.text }}>{selected.name}</div>
              <div className="text-[11px] mt-0.5" style={{ color: COLORS.textMute }}>{selected.author}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>AUM</div>
              <div className="text-[12px] tabular-nums" style={{ color: COLORS.text }}>{selected.aum}</div>
            </div>
          </div>
          <p className="text-[11.5px] mb-3" style={{ color: COLORS.textDim }}>
            {selected.desc}
          </p>
          {/* Metrics row */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="rounded p-2 border" style={{ background: COLORS.bg, borderColor: COLORS.border }}>
              <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sharpe</div>
              <div className="text-[13px] tabular-nums font-medium" style={{ color: COLORS.text }}>{selected.sharpe.toFixed(2)}</div>
            </div>
            <div className="rounded p-2 border" style={{ background: COLORS.bg, borderColor: COLORS.border }}>
              <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Max DD</div>
              <div className="text-[13px] tabular-nums font-medium" style={{ color: COLORS.red }}>-{selected.maxDD.toFixed(1)}%</div>
            </div>
            <div className="rounded p-2 border" style={{ background: COLORS.bg, borderColor: COLORS.border }}>
              <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Risk</div>
              <div className="text-[13px] font-medium" style={{ color: COLORS.text }}>{selected.risk}</div>
            </div>
          </div>
          {/* Holdings */}
          <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.textMute }}>
            Holdings ({selected.holdings.length})
          </div>
          <div className="grid grid-cols-2 gap-1 mb-4">
            {selected.holdings.map(h => (
              <div key={h.ticker} className="flex items-center justify-between text-[11px] px-2 py-1 rounded"
                   style={{ background: COLORS.bg }}>
                <span style={{ color: COLORS.text }}>{h.ticker}</span>
                <span className="tabular-nums" style={{ color: COLORS.textDim }}>{h.weight}%</span>
              </div>
            ))}
          </div>
          {/* Copy form */}
          <div className="border-t pt-3" style={{ borderColor: COLORS.border }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px]" style={{ color: COLORS.textMute }}>USD to allocate</span>
              {balance > 0 && (
                <span className="text-[10px] tabular-nums" style={{ color: COLORS.textMute }}>
                  · Balance ${balance.toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px]" style={{ color: COLORS.textMute }}>$</span>
              <input type="number" value={usdAmount}
                     onChange={e => { setUsdAmount(e.target.value); setFeedback(null); }}
                     placeholder="0.00"
                     className="flex-1 px-2 py-1.5 rounded text-[12px] outline-none tabular-nums"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${insufficient ? COLORS.red : COLORS.border}` }} />
              <button onClick={handleCopy}
                      className="px-4 py-1.5 rounded text-[12px] font-medium transition-all"
                      style={{ background: COLORS.mint, color: '#FFF' }}>
                Copy strategy
              </button>
            </div>
            {feedback && (
              <div className="text-[11px] mt-2" style={{ color: feedback.ok ? COLORS.green : COLORS.red }}>
                {feedback.ok ? '✓ ' : '! '}{feedback.msg}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const MarketBasketsModal = ({ account, onClose, onBuy, onOpenPosition }) => {
  const [selected, setSelected] = useState(null);
  const [usdAmount, setUsdAmount] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  // View mode — switches between the basket browser and the new
  // Autopilot tab (per UX request: "Add autopilot subpage to the
  // basket button"). 'baskets' shows the original Onyx Baskets
  // surface; 'autopilot' shows famous-investor strategies the user
  // can copy into their portfolio, mirroring the full Autopilot page
  // in compact form.
  const [view, setView] = useState('baskets');
  const numericUsd = parseFloat(usdAmount) || 0;
  const balance = account?.balance ?? 0;
  const insufficient = numericUsd > 0 && numericUsd > balance;

  // Filter baskets by category + search
  const filtered = useMemo(() => {
    let r = MARKET_BASKETS;
    if (category !== 'all') {
      r = r.filter(b => (b.category ?? 'thematic').toLowerCase() === category);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(b =>
        b.name.toLowerCase().includes(q) ||
        (b.description ?? '').toLowerCase().includes(q) ||
        b.holdings.some(h => h.toLowerCase().includes(q))
      );
    }
    return r;
  }, [category, search]);

  // Highlighted "sponsored" baskets — top performers
  const sponsored = useMemo(() =>
    [...MARKET_BASKETS].sort((a, b) => (b.perf30d ?? 0) - (a.perf30d ?? 0)).slice(0, 4),
  []);

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose} />
      <div className="fixed inset-2 sm:inset-8 z-50 rounded-md border overflow-hidden flex flex-col"
           style={{ background: COLORS.bg, borderColor: COLORS.borderHi, boxShadow: '0 16px 48px rgba(0,0,0,0.6)' }}>

        {/* Amazon-style top bar with search */}
        <div className="flex items-center gap-3 px-5 py-3 border-b shrink-0"
             style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          <div className="text-[16px] font-semibold flex items-center gap-2" style={{ color: COLORS.text }}>
            <span>Onyx Baskets</span>
          </div>
          <div className="flex-1 max-w-2xl mx-auto">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: COLORS.textMute }} />
              <input value={search}
                     onChange={e => setSearch(e.target.value)}
                     placeholder="Search baskets, themes, or tickers…"
                     className="w-full pl-9 pr-3 py-2 rounded-md outline-none text-[12.5px]"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              <button
                onClick={(e) => {
                  // Search is already live-filtered as the user types — clicking
                  // the button just refocuses the input so they can refine.
                  const input = e.currentTarget.parentElement?.querySelector('input');
                  input?.focus();
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 px-3 py-1 rounded text-[11px] font-medium"
                      style={{ background: COLORS.mint, color: COLORS.bg }}>
                Search
              </button>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/[0.05]">
            <X size={16} style={{ color: COLORS.textDim }} />
          </button>
        </div>

        {/* View tabs — Baskets vs Autopilot. Sits between the search bar
            and the category chips so the user can switch surfaces
            without leaving the modal. The Autopilot tab uses the same
            AUTOPILOT_STRATEGIES data the full Portfolio → Autopilot
            page uses; the Baskets tab is the Onyx Baskets browser. */}
        <div className="flex items-center gap-1 px-5 pt-2 border-b shrink-0"
             style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          {[
            { id: 'baskets',   label: 'Baskets' },
            { id: 'autopilot', label: 'Autopilot' },
          ].map(t => {
            const active = view === t.id;
            return (
              <button key={t.id} onClick={() => setView(t.id)}
                      className="px-3 py-1.5 text-[12px] font-medium transition-colors"
                      style={{
                        color: active ? COLORS.mint : COLORS.textDim,
                        borderBottom: `2px solid ${active ? COLORS.mint : 'transparent'}`,
                        marginBottom: -1,
                      }}>
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Category chips — only relevant on the Baskets surface. */}
        {view === 'baskets' && (
        <div className="px-5 py-2 flex items-center gap-2 overflow-x-auto border-b shrink-0"
             style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          {[
            { id: 'all',       label: 'All baskets' },
            { id: 'thematic',  label: 'Thematic' },
            { id: 'sector',    label: 'Sector ETFs' },
            { id: 'income',    label: 'Income' },
            { id: 'growth',    label: 'Growth' },
            { id: 'value',     label: 'Value' },
            { id: 'crypto',    label: '₿ Crypto' },
            { id: 'esg',       label: 'ESG' },
          ].map(c => (
            <button key={c.id} onClick={() => setCategory(c.id)}
                    className="px-3 py-1 rounded-full text-[11.5px] font-medium shrink-0 transition-colors"
                    style={{
                      background: category === c.id ? COLORS.text : 'transparent',
                      color: category === c.id ? COLORS.bg : COLORS.textDim,
                      border: `1px solid ${category === c.id ? COLORS.text : COLORS.border}`,
                    }}>{c.label}</button>
          ))}
        </div>
        )}

        {/* Autopilot subpage — famous-investor strategies, copy-into-portfolio
            UX matching the full Autopilot page. We render it inline in
            this modal to keep all "compose a portfolio" flows under one
            roof per UX request. */}
        {view === 'autopilot' && (
          <div className="flex-1 min-h-0 overflow-y-auto p-5">
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.mint }}>
                Copy-trade · Famous investors
              </div>
              <h2 className="text-[20px] font-semibold leading-tight" style={{ color: COLORS.text }}>
                Autopilot strategies
              </h2>
              <p className="text-[12px] mt-1" style={{ color: COLORS.textDim }}>
                Click a strategy to view holdings, then enter a USD amount and
                Copy to open positions weighted exactly like the source portfolio.
                Same execution path as the full Autopilot page.
              </p>
            </div>
            {(typeof AUTOPILOT_STRATEGIES !== 'undefined') && (
              <AutopilotMiniSubpage
                account={account}
                strategies={AUTOPILOT_STRATEGIES}
                onOpenPosition={onOpenPosition}
                onBought={() => onClose?.()}
              />
            )}
          </div>
        )}

        {/* Baskets surface — only render when on the baskets tab. */}
        {view === 'baskets' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-5">
            {/* Hero banner — Amazon-style large promo */}
            <div className="rounded-md overflow-hidden mb-5 grid grid-cols-1 md:grid-cols-[1fr_360px]"
                 style={{ background: 'linear-gradient(135deg, rgba(61,123,255,0.15) 0%, rgba(124,58,237,0.15) 100%)', border: `1px solid ${COLORS.border}` }}>
              <div className="p-6 flex flex-col justify-center">
                <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.mint }}>Featured · This week</div>
                <h2 className="text-[26px] font-semibold leading-tight" style={{ color: COLORS.text }}>
                  Build a portfolio in one click
                </h2>
                <p className="text-[13px] mt-2" style={{ color: COLORS.textDim }}>
                  Curated multi-stock baskets · USD split equally across holdings · Same-day execution
                </p>
                <div className="flex items-center gap-2 mt-4">
                  <button onClick={() => setSelected(MARKET_BASKETS[0])}
                          className="px-4 py-2 rounded-md text-[12.5px] font-medium"
                          style={{ background: COLORS.mint, color: COLORS.bg }}>
                    Browse top baskets →
                  </button>
                  <button onClick={() => setCategory('thematic')}
                          className="px-4 py-2 rounded-md text-[12.5px] border"
                          style={{ color: COLORS.text, borderColor: COLORS.border }}>
                    Thematic ideas
                  </button>
                </div>
              </div>
              <div className="hidden md:flex items-center justify-center p-6">
                <div className="grid grid-cols-2 gap-2 w-full">
                  {sponsored.slice(0, 4).map(b => (
                    <button key={b.id} onClick={() => setSelected(b)}
                            className="p-3 rounded-md text-left transition-transform"
                            style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
                      <div className="mb-1.5">
                        <BasketIcon iconKey={b.iconKey} color={b.color} size={20} />
                      </div>
                      <div className="text-[11.5px] font-medium" style={{ color: COLORS.text }}>{b.name}</div>
                      <div className="text-[10.5px] tabular-nums" style={{ color: b.perf30d >= 0 ? COLORS.green : COLORS.red }}>
                        {b.perf30d >= 0 ? '+' : ''}{b.perf30d.toFixed(1)}% · 30d
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* AI-generated trending basket — moved ABOVE Sponsored per
                UX feedback. AI-curated content is the more interesting
                hook for return visitors so it gets the better slot;
                sponsored cards remain visible just below. Uses Exa to
                discover trending themes, then asks Anthropic to propose
                4-6 tickers that capture them. */}
            <AITrendingBasket onSelect={(b) => setSelected(b)} />

            {/* Sponsored / Featured row */}
            <div className="mb-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-[15px] font-semibold" style={{ color: COLORS.text }}>Sponsored · Top performers</h3>
                <button onClick={() => { setCategory('all'); setSearch(''); }}
                        className="text-[11px] hover:underline" style={{ color: COLORS.mint }}>See all →</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {sponsored.map(b => (
                  <button key={b.id} onClick={() => setSelected(b)}
                          className="text-left rounded-md overflow-hidden border transition-all hover:border-white/[0.12] hover:bg-white/[0.02]"
                          style={{ background: COLORS.surface, borderColor: COLORS.border }}>
                    {/* Compact icon strip — was a full aspect-square that took
                        up most of the viewport. 80px gives a clean accent
                        without wasting space. */}
                    <div className="flex items-center justify-center"
                         style={{
                           height: 80,
                           background: `linear-gradient(135deg, ${b.color ?? '#7AC8FF'}30 0%, ${b.color ?? '#7AC8FF'}10 100%)`,
                         }}>
                      <BasketIcon iconKey={b.iconKey} color={b.color ?? '#7AC8FF'} size={40} />
                    </div>
                    <div className="p-3">
                      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.mint }}>Sponsored</div>
                      <div className="text-[12.5px] font-medium truncate" style={{ color: COLORS.text }}>{b.name}</div>
                      <div className="text-[10.5px] mt-0.5 tabular-nums" style={{ color: b.perf30d >= 0 ? COLORS.green : COLORS.red }}>
                        {b.perf30d >= 0 ? '↗' : '↘'} {b.perf30d >= 0 ? '+' : ''}{b.perf30d.toFixed(1)}% · 30d
                      </div>
                      <div className="text-[10.5px] mt-1" style={{ color: COLORS.textMute }}>
                        {b.holdings.length} holdings
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* All baskets grid */}
            <div className="mb-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-[15px] font-semibold" style={{ color: COLORS.text }}>
                  {category === 'all' ? 'All baskets' : category.charAt(0).toUpperCase() + category.slice(1) + ' baskets'}
                </h3>
                <span className="text-[11px]" style={{ color: COLORS.textMute }}>
                  {filtered.length} result{filtered.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered.map(b => (
                  <button key={b.id} onClick={() => setSelected(b)}
                          className="text-left rounded-md overflow-hidden border transition-transform"
                          style={{ background: COLORS.surface, borderColor: COLORS.border }}>
                    <div className="flex items-center gap-3 p-3">
                      <div className="w-16 h-16 rounded flex items-center justify-center shrink-0"
                           style={{ background: `${b.color ?? '#7AC8FF'}20` }}>
                        <BasketIcon iconKey={b.iconKey} color={b.color ?? '#7AC8FF'} size={28} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-medium" style={{ color: COLORS.text }}>{b.name}</div>
                        <div className="text-[10.5px] mt-0.5 truncate" style={{ color: COLORS.textMute }}>
                          {b.holdings.slice(0, 3).join(' · ')}{b.holdings.length > 3 ? ' …' : ''}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 text-[10.5px]">
                          <span className="tabular-nums" style={{ color: b.perf30d >= 0 ? COLORS.green : COLORS.red }}>
                            {b.perf30d >= 0 ? '+' : ''}{b.perf30d.toFixed(1)}%
                          </span>
                          <span style={{ color: COLORS.textMute }}>30d</span>
                          <span style={{ color: COLORS.textMute }}>·</span>
                          <span style={{ color: COLORS.textDim }}>{b.holdings.length} stocks</span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* "Buy it again" — placeholder simulating Amazon's order history */}
            <div className="mb-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-[15px] font-semibold" style={{ color: COLORS.text }}>Buy it again</h3>
                <button onClick={() => {
                  if (typeof window !== 'undefined' && window.alert) {
                    window.alert('Your basket purchase history will appear here once you complete your first basket allocation.');
                  }
                }}
                        className="text-[11px] hover:underline" style={{ color: COLORS.mint }}>View history →</button>
              </div>
              <div className="rounded-md border p-4 text-center text-[12px]"
                   style={{ background: COLORS.surface, borderColor: COLORS.border, color: COLORS.textMute }}>
                Your past basket purchases will appear here so you can re-allocate with one tap.
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Selected basket detail panel — slides in from right */}
        {selected && (
          <div className="absolute right-0 top-0 bottom-0 w-[420px] max-w-full border-l overflow-y-auto"
               style={{ background: COLORS.surface, borderColor: COLORS.borderHi }}>
            <div className="sticky top-0 px-4 py-3 border-b flex items-center justify-between"
                 style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 22 }}>{selected.icon}</span>
                <div>
                  <div className="text-[14px] font-medium" style={{ color: COLORS.text }}>{selected.name}</div>
                  <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
                    {selected.holdings.length} holdings · split equally
                  </div>
                </div>
              </div>
              <button onClick={() => setSelected(null)}
                      className="text-[16px] px-2" style={{ color: COLORS.textDim }}>×</button>
            </div>
            <div className="p-4">
              <div className="text-[11.5px] mb-3" style={{ color: COLORS.textDim }}>{selected.description}</div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="rounded-md p-2.5" style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
                  <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>30d perf</div>
                  <div className="text-[16px] tabular-nums" style={{ color: selected.perf30d >= 0 ? COLORS.green : COLORS.red }}>
                    {selected.perf30d >= 0 ? '+' : ''}{selected.perf30d.toFixed(1)}%
                  </div>
                </div>
                <div className="rounded-md p-2.5" style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
                  <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>YTD</div>
                  <div className="text-[16px] tabular-nums" style={{ color: (selected.perfYtd ?? 0) >= 0 ? COLORS.green : COLORS.red }}>
                    {(selected.perfYtd ?? 0) >= 0 ? '+' : ''}{(selected.perfYtd ?? selected.perf30d * 4).toFixed(1)}%
                  </div>
                </div>
              </div>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>Holdings</div>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {selected.holdings.map(h => (
                  <span key={h} className="px-2 py-1 rounded text-[11px] font-medium"
                        style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                    {h}
                  </span>
                ))}
              </div>
              {/* Buy section */}
              <div className="rounded-md p-3" style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
                <div className="text-[11px] mb-2" style={{ color: COLORS.textDim }}>Buy this basket</div>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: COLORS.textMute }}>$</span>
                  <input type="number" value={usdAmount}
                         onChange={e => setUsdAmount(e.target.value)}
                         placeholder="USD amount"
                         className="w-full pl-6 pr-3 py-2 rounded text-[13px] tabular-nums outline-none"
                         style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                </div>
                <div className="text-[10.5px] mt-1.5" style={{ color: insufficient ? COLORS.red : COLORS.textMute }}>
                  {insufficient ? '⚠ Insufficient balance' : `Available: $${balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                </div>
                {numericUsd > 0 && !insufficient && (
                  <div className="text-[10.5px] mt-1" style={{ color: COLORS.textDim }}>
                    Per holding: <strong className="tabular-nums">${(numericUsd / selected.holdings.length).toFixed(2)}</strong>
                  </div>
                )}
                <button onClick={() => {
                  if (numericUsd > 0 && !insufficient) {
                    onBuy(selected, numericUsd);
                    setUsdAmount('');
                    setSelected(null);
                    onClose();
                  }
                }}
                        disabled={!numericUsd || insufficient}
                        className="w-full mt-3 py-2 rounded-md text-[12.5px] font-medium transition-opacity disabled:opacity-40"
                        style={{ background: '#FFD814', color: '#0F1111' }}>
                  Buy basket · ${numericUsd ? numericUsd.toLocaleString() : '0'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

// Wrapper for embedded mini-views inside Trade workspace tabs. Provides a
// title bar with an "Open full page →" button to jump to the full route.
// TradeMiniView — wrapper for every widget in the trade-page mesh. Provides
// a consistent header + body structure that flex-fills to the available
// height (so widgets never leave gray space at the bottom). Children should
// use h-full and flex-1 to fill the body. The header is fixed-height (28px
// + padding); everything below scrolls or fills as needed.

