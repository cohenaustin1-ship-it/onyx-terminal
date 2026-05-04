// IMO Onyx Terminal — Mini widgets (TradePage dashboard grid)
//
// Phase 3p.28 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines 6877-11121, ~4,245 lines).
//
// Second "lift the children" phase preparing for TradePage extraction.
// TradePage's main grid renders many small dashboard widgets — each
// is a focused mini-view (volume profile, news feed, calendar,
// sentiment, etc.). Plus several internal helpers and the master
// TradeMiniView wrapper used 100+ times across the app.
//
// Total exports: 27 named Minis + TradeMiniView wrapper + 6
// internal helpers/companions.
//
// Public exports:
//   TradeMiniView         — generic wrapper used by all minis (and
//                           by other parts of the app, 100+ uses)
//   TradeMiniView grid widgets:
//     VolumeProfileMini, NetFlowMini, DarkFlowMini, SectorHeatMapMini,
//     MarketMapMini, CompWidget, TerminalMini, GainersLosersMini,
//     VolSkewMini, VolDriftMini, WSBSentimentMini, SECFilingsMini,
//     TreasuryRatesMini, MacroIndicatorsMini, LocalConditionsMini,
//     CorporateActionsMini, NewsFeedMini, PortfolioMini, CalendarMini,
//     SwapMini, AutopilotMini, VideoMini, FeedMini, DiscussMini,
//     WatchlistMini, PredictionsMini, MessagesMini, AvatarMini,
//     FundamentalsMini, AvatarModeScaffold
//
// Internal helpers (only used inside this module):
//   TerminalMiniMapboxGlobe  — Mapbox globe inside TerminalMini
//   SafetyCheckModal         — confirmation modal inside AutopilotMini
//   CURATED_VIDEO_CHANNELS   — VideoMini fixture
//
// Inlined shared fixtures (also defined in monolith for other
// consumers; bounded duplication of 246 lines):
//   AUTOPILOT_STRATEGIES     — 9 monolith uses, 2 in this block
//   FINANCIAL_EVENTS         — 5 monolith uses, 2 in this block
//   EVENT_TYPE_STYLES        — 5 monolith uses, 1 in this block
//
// Honest scope:
//   - This module is ~4,500 lines. Larger than typical for component
//     modules but makes sense as a single file because the widgets
//     all share the TradeMiniView wrapper and many share styling.
//   - Several minis fetch live data (Polygon, Treasury, weather,
//     news APIs). Those API keys are read from env vars locally.
//   - MarketMapMini has only its definition in the monolith — likely
//     dead code, kept here for completeness.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
  CartesianGrid, ReferenceLine, BarChart, Bar, ComposedChart, Area,
  AreaChart, PieChart, Pie, Cell,
} from 'recharts';
import {
  ChevronRight, Heart, MessageSquare, Search, Sparkles,
} from 'lucide-react';
import { COLORS, TICKER_SECTORS } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import { formatTicker } from '../lib/format.js';
import { callAI, exaSearch } from '../lib/ai-calls.js';
import {
  fetchPolygonAggs, fetchPolygonTickerDetails,
  fetchPolygonMarketMap, fetchPolygonMovers, fetchPolygonSectorMap,
  SECTOR_CONSTITUENTS,
} from '../lib/polygon-api.js';
import {
  fetchTreasuryRates, fetchEconDbSeries, fetchMediaStackNews,
  fetchNewsDataNews, fetchWeather, fetchAirQuality,
  fetchCurrentsNews, fetchNytNews, fetchAlpacaCorporateActions,
  fetchSecFilings, fetchWSBTickers, fetchUWStockFlow,
  CURRENTS_KEY,
} from '../lib/external-data.js';
import { AIMarkdown } from './ai-markdown.jsx';
import { MicButton, SectorLetter } from './leaf-ui.jsx';

// Env-var keys (duplicated from monolith — same source, separate read).
const MASSIVE_API_KEY  = (() => { try { return import.meta.env?.VITE_MASSIVE_API_KEY  ?? ''; } catch { return ''; } })();
const ANTHROPIC_API_KEY= (() => { try { return import.meta.env?.VITE_ANTHROPIC_API_KEY?? ''; } catch { return ''; } })();
const EXA_API_KEY      = (() => { try { return import.meta.env?.VITE_EXA_API_KEY      ?? ''; } catch { return ''; } })();
const ALPACA_KEY       = (() => { try { return import.meta.env?.VITE_ALPACA_KEY       ?? ''; } catch { return ''; } })();
const ALPACA_SECRET    = (() => { try { return import.meta.env?.VITE_ALPACA_SECRET    ?? ''; } catch { return ''; } })();
const MAPBOX_TOKEN     = (() => { try { return import.meta.env?.VITE_MAPBOX_TOKEN     ?? ''; } catch { return ''; } })();
const UW_API_KEY       = (() => { try { return import.meta.env?.VITE_UW_API_KEY       ?? ''; } catch { return ''; } })();
const MEDIASTACK_KEY   = (() => { try { return import.meta.env?.VITE_MEDIASTACK_KEY   ?? ''; } catch { return ''; } })();
const NEWSDATA_KEY     = (() => { try { return import.meta.env?.VITE_NEWSDATA_KEY     ?? ''; } catch { return ''; } })();
const NYT_KEY          = (() => { try { return import.meta.env?.VITE_NYT_KEY          ?? ''; } catch { return ''; } })();
const IQAIR_KEY        = (() => { try { return import.meta.env?.VITE_IQAIR_KEY        ?? ''; } catch { return ''; } })();
const WEATHERSTACK_KEY = (() => { try { return import.meta.env?.VITE_WEATHERSTACK_KEY ?? ''; } catch { return ''; } })();
const YOUTUBE_API_KEY  = (() => { try { return import.meta.env?.VITE_YOUTUBE_API_KEY  ?? ''; } catch { return ''; } })();

// loadMapboxGL helper (duplicated from monolith — already inlined
// into map-page.jsx and chart-page.jsx; small enough to copy).
const loadMapboxGL = () => {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.__mapboxLoading) return window.__mapboxLoading;
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);
  window.__mapboxLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/mapbox-gl@3.8.0/dist/mapbox-gl.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/mapbox-gl@3.8.0/dist/mapbox-gl.js';
    s.async = true;
    s.onload = () => {
      if (window.mapboxgl) resolve(window.mapboxgl);
      else reject(new Error('mapbox-gl loaded but not on window'));
    };
    s.onerror = () => reject(new Error('failed to load mapbox-gl.js'));
    document.head.appendChild(s);
  });
  return window.__mapboxLoading;
};

// ──── Shared fixtures (also in monolith; duplicated here) ────

export const AUTOPILOT_STRATEGIES = [
  // Famous investor portfolios — illustrative weights based on public 13F filings
  {
    id: 'buffett',
    name: 'Berkshire Hathaway (Buffett)',
    author: 'Warren Buffett · 13F-style',
    avatar: 'WB',
    avatarColor: '#0066B2',
    desc: 'Mega-cap value-oriented holdings inspired by Berkshire\'s public 13F filings. Concentrated in financials and consumer staples.',
    aum: '$340B',
    return1y: 14.2,
    sharpe: 1.31,
    maxDD: 12.4,
    risk: 'Medium',
    famous: true,
    holdings: [
      { ticker: 'AAPL', weight: 40 },
      { ticker: 'BAC',  weight: 15 },
      { ticker: 'KO',   weight: 10 },
      { ticker: 'AXP',  weight: 10 },
      { ticker: 'CVX',  weight: 8  },
      { ticker: 'JPM',  weight: 7  },
      { ticker: 'WMT',  weight: 5  },
      { ticker: 'JNJ',  weight: 5  },
    ],
  },
  {
    id: 'cathie-wood',
    name: 'ARK Innovation (Cathie Wood)',
    author: 'Cathie Wood · ARK Invest',
    avatar: 'CW',
    avatarColor: '#E07AFC',
    desc: 'High-conviction disruptive innovation thesis. Heavy in EVs, crypto exposure, biotech, and digital infrastructure.',
    aum: '$8.4B',
    return1y: 28.1,
    sharpe: 0.78,
    maxDD: 32.1,
    risk: 'Very High',
    famous: true,
    holdings: [
      { ticker: 'TSLA', weight: 25 },
      { ticker: 'NVDA', weight: 18 },
      { ticker: 'PLTR', weight: 12 },
      { ticker: 'COIN', weight: 12 },
      { ticker: 'BTC-PERP', weight: 10 },
      { ticker: 'CRWD', weight: 8  },
      { ticker: 'ROKU', weight: 8  },
      { ticker: 'SHOP', weight: 7  },
    ],
  },
  {
    id: 'ackman',
    name: 'Pershing Square (Ackman)',
    author: 'Bill Ackman · Concentrated',
    avatar: 'BA',
    avatarColor: '#A0C476',
    desc: 'Highly concentrated portfolio of 6-8 high-quality names. Activist investing thesis with significant single-name exposure.',
    aum: '$11.2B',
    return1y: 31.5,
    sharpe: 1.52,
    maxDD: 18.3,
    risk: 'High',
    famous: true,
    holdings: [
      { ticker: 'GOOG', weight: 22 },
      { ticker: 'CMG',  weight: 18 },
      { ticker: 'HLT',  weight: 16 },
      { ticker: 'NKE',  weight: 14 },
      { ticker: 'BRK',  weight: 12 },
      { ticker: 'QSR',  weight: 10 },
      { ticker: 'CP',   weight: 8  },
    ],
  },
  {
    id: 'tepper',
    name: 'Appaloosa (David Tepper)',
    author: 'David Tepper',
    avatar: 'DT',
    avatarColor: '#FFB84D',
    desc: 'Macro-driven concentrated equity portfolio. China + tech tilt, opportunistic value plays.',
    aum: '$5.8B',
    return1y: 22.7,
    sharpe: 1.42,
    maxDD: 14.7,
    risk: 'High',
    famous: true,
    holdings: [
      { ticker: 'META', weight: 18 },
      { ticker: 'MSFT', weight: 15 },
      { ticker: 'AMZN', weight: 14 },
      { ticker: 'BABA', weight: 12 },
      { ticker: 'GOOG', weight: 12 },
      { ticker: 'NVDA', weight: 11 },
      { ticker: 'JD',   weight: 9  },
      { ticker: 'PDD',  weight: 9  },
    ],
  },
  {
    id: 'druckenmiller',
    name: 'Duquesne (Druckenmiller)',
    author: 'Stanley Druckenmiller',
    avatar: 'SD',
    avatarColor: '#7AC8FF',
    desc: 'Macro hedge fund alumnus running family office. Tech-leaning equity book, opportunistic gold and treasury exposure.',
    aum: '$4.3B',
    return1y: 19.8,
    sharpe: 1.48,
    maxDD: 9.2,
    risk: 'Medium',
    famous: true,
    holdings: [
      { ticker: 'NVDA', weight: 18 },
      { ticker: 'MSFT', weight: 14 },
      { ticker: 'GOOG', weight: 12 },
      { ticker: 'GLD',  weight: 12 },
      { ticker: 'TLT',  weight: 10 },
      { ticker: 'AMZN', weight: 10 },
      { ticker: 'TSM',  weight: 8  },
      { ticker: 'COIN', weight: 8  },
      { ticker: 'BTC-PERP', weight: 8 },
    ],
  },
  // Curated thematic strategies
  {
    id: 'global-macro',
    name: 'Global Macro Tactical',
    author: 'Onyx Research',
    avatar: 'OR',
    avatarColor: '#0066B2',
    desc: 'Diversified across equities, rates, FX and commodities. Reduces equity beta during high-vol regimes.',
    aum: '$214M',
    return1y: 18.7,
    sharpe: 1.42,
    maxDD: 8.4,
    risk: 'Medium',
    holdings: [
      { ticker: 'SPY',  weight: 35 },
      { ticker: 'TLT',  weight: 20 },
      { ticker: 'GLD',  weight: 15 },
      { ticker: 'XOM',  weight: 15 },
      { ticker: 'BTC-PERP', weight: 15 },
    ],
  },
  {
    id: 'ai-momentum',
    name: 'AI Momentum',
    author: 'Quant Capital',
    avatar: 'QC',
    avatarColor: '#7AC8FF',
    desc: 'Concentrated long in AI infrastructure leaders. Rebalanced quarterly based on capex guidance.',
    aum: '$87M',
    return1y: 42.3,
    sharpe: 1.18,
    maxDD: 22.1,
    risk: 'High',
    holdings: [
      { ticker: 'NVDA', weight: 30 },
      { ticker: 'MSFT', weight: 25 },
      { ticker: 'GOOG', weight: 20 },
      { ticker: 'META', weight: 15 },
      { ticker: 'AMZN', weight: 10 },
    ],
  },
  {
    id: 'dividend-income',
    name: 'Dividend Income',
    author: 'Income Strategies LP',
    avatar: 'IS',
    avatarColor: '#A0C476',
    desc: 'Steady-state dividend payers with low volatility. Targets 4-5% yield with capital preservation.',
    aum: '$540M',
    return1y: 8.2,
    sharpe: 1.65,
    maxDD: 4.8,
    risk: 'Low',
    holdings: [
      { ticker: 'JPM',  weight: 25 },
      { ticker: 'JNJ',  weight: 25 },
      { ticker: 'XOM',  weight: 20 },
      { ticker: 'CVX',  weight: 15 },
      { ticker: 'WMT',  weight: 15 },
    ],
  },
  {
    id: 'defensive',
    name: 'Defensive Hedge',
    author: 'Risk Parity Co',
    avatar: 'RP',
    avatarColor: '#FFB84D',
    desc: 'Long volatility, gold, and treasuries. Built for capital preservation in downturns.',
    aum: '$112M',
    return1y: 4.1,
    sharpe: 0.92,
    maxDD: 3.2,
    risk: 'Low',
    holdings: [
      { ticker: 'TLT', weight: 40 },
      { ticker: 'GLD', weight: 30 },
      { ticker: 'JNJ', weight: 15 },
      { ticker: 'JPM', weight: 15 },
    ],
  },
  {
    id: 'crypto-aggressive',
    name: 'Crypto Aggressive',
    author: 'Digital Assets Fund',
    avatar: 'DA',
    avatarColor: '#F7931A',
    desc: 'Concentrated crypto exposure. High volatility — only suitable for risk-tolerant investors.',
    aum: '$23M',
    return1y: 87.5,
    sharpe: 0.84,
    maxDD: 38.2,
    risk: 'Very High',
    holdings: [
      { ticker: 'BTC-PERP', weight: 50 },
      { ticker: 'ETH-PERP', weight: 35 },
      { ticker: 'SOL-PERP', weight: 15 },
    ],
  },
];

export const FINANCIAL_EVENTS = [
  // ─── Earnings — major S&P 500 releases (Q1 2026 schedule) ───
  { date: '2026-04-24', type: 'earnings',  ticker: 'AAPL', label: 'Apple Q2 FY26 earnings',     priority: 'high' },
  { date: '2026-04-23', type: 'earnings',  ticker: 'GOOGL',label: 'Alphabet Q1 2026 earnings',  priority: 'high' },
  { date: '2026-04-23', type: 'earnings',  ticker: 'AMZN', label: 'Amazon Q1 2026 earnings',    priority: 'high' },
  { date: '2026-04-22', type: 'earnings',  ticker: 'TSLA', label: 'Tesla Q1 2026 earnings',     priority: 'high' },
  { date: '2026-04-22', type: 'earnings',  ticker: 'META', label: 'Meta Q1 2026 earnings',      priority: 'high' },
  { date: '2026-04-23', type: 'earnings',  ticker: 'MSFT', label: 'Microsoft Q3 FY26 earnings', priority: 'high' },
  { date: '2026-04-24', type: 'earnings',  ticker: 'NVDA', label: 'Nvidia Q1 FY26 earnings',    priority: 'high' },
  { date: '2026-04-15', type: 'earnings',  ticker: 'JPM',  label: 'JPMorgan Q1 2026 earnings',  priority: 'high' },
  { date: '2026-04-16', type: 'earnings',  ticker: 'BAC',  label: 'Bank of America Q1 2026',    priority: 'medium' },
  { date: '2026-04-15', type: 'earnings',  ticker: 'WFC',  label: 'Wells Fargo Q1 2026',         priority: 'medium' },
  { date: '2026-04-15', type: 'earnings',  ticker: 'GS',   label: 'Goldman Sachs Q1 2026',       priority: 'medium' },
  { date: '2026-04-30', type: 'earnings',  ticker: 'NFLX', label: 'Netflix Q1 2026',             priority: 'medium' },
  { date: '2026-05-22', type: 'earnings',  ticker: 'NVDA', label: 'Nvidia Q1 FY27 (likely)',     priority: 'high' },

  // ─── Federal Reserve meetings (FOMC) ───
  { date: '2026-04-29', type: 'fomc',      label: 'FOMC Meeting (April)',                                  priority: 'high' },
  { date: '2026-06-17', type: 'fomc',      label: 'FOMC Meeting (June) — Summary of Economic Projections', priority: 'high' },
  { date: '2026-07-29', type: 'fomc',      label: 'FOMC Meeting (July)',                                   priority: 'high' },
  { date: '2026-09-16', type: 'fomc',      label: 'FOMC Meeting (September) — SEP',                        priority: 'high' },
  { date: '2026-11-04', type: 'fomc',      label: 'FOMC Meeting (November)',                               priority: 'high' },
  { date: '2026-12-16', type: 'fomc',      label: 'FOMC Meeting (December) — SEP',                         priority: 'high' },

  // ─── Economic data releases (BLS / BEA) ───
  { date: '2026-05-02', type: 'econ',      label: 'Nonfarm Payrolls — April',  priority: 'high' },
  { date: '2026-06-06', type: 'econ',      label: 'Nonfarm Payrolls — May',    priority: 'high' },
  { date: '2026-05-13', type: 'econ',      label: 'CPI Release — April',       priority: 'high' },
  { date: '2026-06-11', type: 'econ',      label: 'CPI Release — May',         priority: 'high' },
  { date: '2026-04-30', type: 'econ',      label: 'GDP Q1 2026 advance',       priority: 'medium' },
  { date: '2026-05-30', type: 'econ',      label: 'PCE Inflation — April',     priority: 'medium' },
  { date: '2026-06-27', type: 'econ',      label: 'PCE Inflation — May',       priority: 'medium' },

  // ─── Tax deadlines (US) ───
  { date: '2026-04-15', type: 'tax',       label: 'Federal income tax filing deadline (Tax Day)', priority: 'high' },
  { date: '2026-06-16', type: 'tax',       label: 'Q2 estimated tax payment due',                  priority: 'medium' },
  { date: '2026-09-15', type: 'tax',       label: 'Q3 estimated tax payment due',                  priority: 'medium' },
  { date: '2026-10-15', type: 'tax',       label: 'Extended income tax filing deadline',           priority: 'medium' },
  { date: '2027-01-15', type: 'tax',       label: 'Q4 estimated tax payment due (2026 tax year)',  priority: 'medium' },

  // ─── Options expirations (3rd Friday monthly) ───
  { date: '2026-05-15', type: 'opex',      label: 'Monthly options expiration · May', priority: 'medium' },
  { date: '2026-06-19', type: 'opex',      label: 'Quad witching · June',             priority: 'high' },
  { date: '2026-07-17', type: 'opex',      label: 'Monthly options expiration · July', priority: 'medium' },
  { date: '2026-08-21', type: 'opex',      label: 'Monthly options expiration · August', priority: 'medium' },
  { date: '2026-09-18', type: 'opex',      label: 'Quad witching · September',         priority: 'high' },
  { date: '2026-10-16', type: 'opex',      label: 'Monthly options expiration · October', priority: 'medium' },
  { date: '2026-11-20', type: 'opex',      label: 'Monthly options expiration · November', priority: 'medium' },
  { date: '2026-12-18', type: 'opex',      label: 'Quad witching · December',          priority: 'high' },

  // ─── Holidays / market closes ───
  { date: '2026-05-25', type: 'holiday',   label: 'Memorial Day — markets closed',     priority: 'low' },
  { date: '2026-07-03', type: 'holiday',   label: 'Independence Day observed',         priority: 'low' },
  { date: '2026-09-07', type: 'holiday',   label: 'Labor Day — markets closed',        priority: 'low' },
  { date: '2026-11-26', type: 'holiday',   label: 'Thanksgiving — markets closed',     priority: 'low' },
  { date: '2026-11-27', type: 'holiday',   label: 'Black Friday — early close 1pm ET', priority: 'low' },
  { date: '2026-12-25', type: 'holiday',   label: 'Christmas — markets closed',        priority: 'low' },
];

const EVENT_TYPE_STYLES = {
  earnings: { color: '#A0C476', label: 'Earnings' },
  fomc:     { color: '#7AC8FF', label: 'FOMC' },
  econ:     { color: '#FFB84D', label: 'Economic data' },
  tax:      { color: '#FF7AB6', label: 'Tax deadline' },
  opex:     { color: '#E07AFC', icon: 'Ω',  label: 'Options expiration' },
  holiday:  { color: '#666',    label: 'Holiday' },
};


// ──── Mini widgets ────

/**
 * @param {{ title: string, onExpand?: Function, onStack?: Function, badge?: any, children?: any, scrollable?: boolean, headerRight?: any }} props
 */
export const TradeMiniView = ({ title, onExpand, onStack, badge, children, scrollable = false, headerRight = null }) => (
  <div className="h-full w-full flex flex-col" style={{ minHeight: 0 }}>
    <div className="flex items-center justify-between px-3 py-2 shrink-0 border-b"
         style={{ borderColor: COLORS.border }}>
      <div className="flex items-center gap-1.5 min-w-0">
        <h3 className="text-[12px] font-medium truncate" style={{ color: COLORS.text }}>{title}</h3>
        {/* Thin lined blue + — stacks another instance of this widget
            into the layout. Sits next to the title for non-chart widgets
            per UX request. Hidden when no stack handler is provided. */}
        {onStack && (
          <button
            onClick={(e) => { e.stopPropagation(); onStack(); }}
            className="w-4 h-4 rounded flex items-center justify-center text-[11px] leading-none transition-all hover:bg-white/[0.06] shrink-0"
            style={{
              color: COLORS.mint,
              border: `1px solid ${COLORS.mint}66`,
              background: 'transparent',
              fontFamily: 'ui-monospace, monospace',
            }}
            title={`Stack another ${title} widget`}
          >+</button>
        )}
        {badge && (
          <span className="text-[8.5px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                style={{ background: 'rgba(31,178,107,0.14)', color: COLORS.green, fontWeight: 600 }}>
            {badge}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {headerRight}
        {onExpand && (
          <button onClick={onExpand}
                  className="w-5 h-5 rounded-full flex items-center justify-center transition-all hover:bg-white/[0.08] shrink-0"
                  style={{
                    color: COLORS.mint,
                    border: `1px solid ${COLORS.mint}66`,
                    background: 'transparent',
                  }}
                  title="Open this widget in its full page view">
            <ChevronRight size={11} />
          </button>
        )}
      </div>
    </div>
    <div className={`flex-1 min-h-0 ${scrollable ? 'overflow-y-auto' : 'overflow-hidden'}`}>
      {children}
    </div>
  </div>
);

/* ──────────── Compact panel widgets ────────────
 * The bottom-panel tabs (Positions, Risk, Sentiment, etc.) were designed
 * for a wide, full-width strip. When pinned as widgets in the trade
 * mesh they overflow narrow cells. These compact variants show summary
 * info and key metrics at a glance, with a tappable "Open" link in
 * TradeMiniView's header that scrolls/jumps to the full panel view.
 */

// Compact Positions — 3 most recent positions with key PnL data
export const VolumeProfileMini = ({ instrument }) => {
  const [bars, setBars] = useState(null);
  const [period, setPeriod] = useState(90); // lookback in days
  useEffect(() => {
    let cancelled = false;
    setBars(null);
    (async () => {
      // Only equities have proper Polygon coverage; crypto/forex/energy fall
      // back to a deterministic pseudo-distribution.
      if (instrument?.cls === 'equity' && instrument?.id && MASSIVE_API_KEY) {
        const data = await fetchPolygonAggs(instrument.id, period, 'day', 1);
        if (!cancelled) setBars(data);
      } else {
        if (!cancelled) setBars([]);
      }
    })();
    return () => { cancelled = true; };
  }, [instrument?.id, instrument?.cls, period]);

  // Build the volume-by-price distribution. We use the typical price (HLC/3)
  // for each bar and add the bar's volume to the closest of N price buckets.
  // Falls back to a deterministic synth when no real data is available.
  const profile = useMemo(() => {
    const NUM_BUCKETS = 24;
    let buckets, priceMin, priceMax, isSynth = false;
    if (!bars || bars.length === 0) {
      // Synthesized fallback — center distribution around current mark
      const mark = instrument?.mark ?? 100;
      priceMin = mark * 0.85;
      priceMax = mark * 1.15;
      const seed = (instrument?.id ?? 'X').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      buckets = Array.from({ length: NUM_BUCKETS }, (_, i) => {
        // Bell-shaped distribution centered at mid
        const mid = NUM_BUCKETS / 2;
        const dist = (i - mid) / mid;
        const wave = Math.exp(-dist * dist * 2.5);
        const noise = Math.sin((i + seed) * 0.7) * 0.15 + 0.85;
        return wave * noise;
      });
      isSynth = true;
    } else {
      // Real distribution — bucket each bar's typical price weighted by volume
      const lows = bars.map(b => b.low);
      const highs = bars.map(b => b.high);
      priceMin = Math.min(...lows);
      priceMax = Math.max(...highs);
      const range = priceMax - priceMin || 1;
      buckets = new Array(NUM_BUCKETS).fill(0);
      bars.forEach(b => {
        // Distribute the bar's volume across all buckets the bar's range
        // touches, proportional to overlap. This gives a more realistic
        // profile than just using the close price.
        const lowIdx  = Math.max(0, Math.floor(((b.low  - priceMin) / range) * NUM_BUCKETS));
        const highIdx = Math.min(NUM_BUCKETS - 1, Math.floor(((b.high - priceMin) / range) * NUM_BUCKETS));
        const span = Math.max(1, highIdx - lowIdx + 1);
        const volPerBucket = b.volume / span;
        for (let k = lowIdx; k <= highIdx; k++) buckets[k] += volPerBucket;
      });
    }
    const maxBucket = Math.max(...buckets, 1);
    // Find POC — the bucket with the most volume
    const pocIdx = buckets.indexOf(Math.max(...buckets));
    const pocPrice = priceMin + ((pocIdx + 0.5) / NUM_BUCKETS) * (priceMax - priceMin);
    // Compute Value Area (the top 70% of total volume)
    const total = buckets.reduce((a, b) => a + b, 0);
    const target = total * 0.70;
    let cum = buckets[pocIdx];
    let vaLo = pocIdx, vaHi = pocIdx;
    while (cum < target && (vaLo > 0 || vaHi < NUM_BUCKETS - 1)) {
      const lower = vaLo > 0 ? buckets[vaLo - 1] : -1;
      const upper = vaHi < NUM_BUCKETS - 1 ? buckets[vaHi + 1] : -1;
      if (lower >= upper) {
        if (vaLo > 0) { vaLo--; cum += buckets[vaLo]; }
        else { vaHi++; cum += buckets[vaHi]; }
      } else {
        if (vaHi < NUM_BUCKETS - 1) { vaHi++; cum += buckets[vaHi]; }
        else { vaLo--; cum += buckets[vaLo]; }
      }
    }
    const vahPrice = priceMin + ((vaHi + 1) / NUM_BUCKETS) * (priceMax - priceMin);
    const valPrice = priceMin + (vaLo / NUM_BUCKETS) * (priceMax - priceMin);
    const totalVol = bars?.reduce((s, b) => s + b.volume, 0) ?? 0;
    return { buckets, maxBucket, priceMin, priceMax, pocIdx, pocPrice, vaLo, vaHi,
             vahPrice, valPrice, isSynth, totalVol, totalBars: bars?.length ?? 0 };
  }, [bars, instrument?.id, instrument?.mark]);

  const fmtPrice = (p) => {
    const dec = instrument?.dec ?? 2;
    return p.toFixed(dec);
  };
  const fmtVol = (v) => {
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return v.toFixed(0);
  };

  // Mark the current price's bucket so we can visually anchor "right now"
  const currentPrice = instrument?.mark ?? null;
  const currentBucket = currentPrice != null
    ? Math.max(0, Math.min(profile.buckets.length - 1,
        Math.floor(((currentPrice - profile.priceMin) / (profile.priceMax - profile.priceMin)) * profile.buckets.length)))
    : -1;

  if (bars === null) {
    return (
      <div className="h-full flex items-center justify-center text-[11px]" style={{ color: COLORS.textMute }}>
        Loading {period}d profile for {instrument?.id}…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-2.5">
      {/* Header — period selector + summary stats */}
      <div className="flex items-center justify-between mb-1.5 text-[10px] shrink-0"
           style={{ color: COLORS.textMute }}>
        <div className="flex items-center gap-1">
          {[30, 90, 180, 365].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
                    className="px-1.5 py-0.5 rounded transition-colors"
                    style={{
                      background: period === p ? COLORS.surface2 : 'transparent',
                      color: period === p ? COLORS.mint : COLORS.textDim,
                      fontSize: 9.5,
                      border: `1px solid ${period === p ? COLORS.mint + '55' : COLORS.border}`,
                    }}>
              {p}d
            </button>
          ))}
        </div>
        {!profile.isSynth ? (
          <span className="inline-flex items-center" title={`Real volume-by-price from ${profile.totalBars} daily bars`}>
          <span className="rounded-full" style={{ width: 6, height: 6, background: COLORS.green, display: 'inline-block' }} />
        </span>
        ) : (
          <span style={{ color: COLORS.textMute }}>simulated</span>
        )}
      </div>

      {/* The histogram — fills remaining vertical space */}
      <div className="flex-1 min-h-0 space-y-px relative flex flex-col justify-center">
        {profile.buckets.slice().reverse().map((vol, revIdx) => {
          const i = profile.buckets.length - 1 - revIdx;
          const widthPct = (vol / profile.maxBucket) * 100;
          const isPoc = i === profile.pocIdx;
          const inVA = i >= profile.vaLo && i <= profile.vaHi;
          const isCurrent = i === currentBucket;
          // Hot-spot: any bucket whose volume is at least 80% of the POC's
          // volume is a "hot spot" — high-volume node where the market has
          // historically transacted aggressively. These often act as
          // support/resistance.
          const isHotSpot = vol > 0 && (vol / profile.maxBucket) >= 0.8;
          // Price for this bucket (top edge for proper alignment)
          const bucketPrice = profile.priceMin + ((i + 0.5) / profile.buckets.length) * (profile.priceMax - profile.priceMin);
          const tone = isPoc ? '#FFB84D' : (inVA ? COLORS.mint : COLORS.textDim);
          const opacity = 0.35 + (vol / profile.maxBucket) * 0.5;
          return (
            <div key={i}
                 className="flex items-center gap-1 relative"
                 style={{
                   background: isCurrent ? 'rgba(31,178,107,0.06)' : (inVA ? 'rgba(61,123,255,0.03)' : 'transparent'),
                   padding: '0 2px',
                   minHeight: 8,
                 }}
                 title={isHotSpot ? `Hot-spot · ${fmtPrice(bucketPrice)} (${fmtVol(vol)} traded — high-volume node, watch for S/R)` : undefined}>
              {/* Hot-spot dot indicator on the far left */}
              {isHotSpot && !isPoc && (
                <span className="absolute"
                      style={{
                        left: 0,
                        top: '50%',
                        transform: 'translate(-3px, -50%)',
                        width: 4, height: 4,
                        borderRadius: '50%',
                        background: '#FF8855',
                        boxShadow: '0 0 4px #FF8855',
                      }} />
              )}
              {/* Price label (left) */}
              <span className="tabular-nums shrink-0 text-right"
                    style={{
                      color: isPoc ? '#FFB84D' : (isHotSpot ? '#FF8855' : (isCurrent ? COLORS.mint : COLORS.textMute)),
                      fontSize: 8.5,
                      fontFamily: 'ui-monospace, monospace',
                      fontWeight: isPoc || isCurrent || isHotSpot ? 600 : 400,
                      width: 44,
                    }}>
                {fmtPrice(bucketPrice)}
              </span>
              {/* Volume bar */}
              <div className="flex-1 flex items-center" style={{ height: 9 }}>
                <div style={{
                  width: `${widthPct}%`,
                  height: '100%',
                  background: tone,
                  opacity,
                  borderRadius: 1,
                  transition: 'width 200ms ease-out',
                }} />
              </div>
              {/* Volume label (right, only for tiles big enough) */}
              {widthPct > 25 && !profile.isSynth && (
                <span className="tabular-nums shrink-0"
                      style={{
                        color: tone,
                        fontSize: 8.5,
                        fontFamily: 'ui-monospace, monospace',
                        opacity: 0.7,
                        width: 28,
                      }}>
                  {fmtVol(vol)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer — POC, VAH, VAL summary */}
      <div className="mt-1.5 grid grid-cols-3 gap-1 text-[9.5px] tabular-nums shrink-0">
        <div className="rounded px-1.5 py-1" style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}` }}>
          <div className="text-[8px] uppercase tracking-wider" style={{ color: '#FFB84D' }}>POC</div>
          <div style={{ color: COLORS.text }}>{fmtPrice(profile.pocPrice)}</div>
        </div>
        <div className="rounded px-1.5 py-1" style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}` }}>
          <div className="text-[8px] uppercase tracking-wider" style={{ color: COLORS.mint }}>VAH</div>
          <div style={{ color: COLORS.text }}>{fmtPrice(profile.vahPrice)}</div>
        </div>
        <div className="rounded px-1.5 py-1" style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}` }}>
          <div className="text-[8px] uppercase tracking-wider" style={{ color: COLORS.mint }}>VAL</div>
          <div style={{ color: COLORS.text }}>{fmtPrice(profile.valPrice)}</div>
        </div>
      </div>
    </div>
  );
};

// Net flow — cumulative buy minus sell volume sparkline
// Net flow — cumulative buy minus sell volume from real Polygon trades.
// We fetch the last day's bars and derive directional flow by comparing
// each bar's close to its open (up bar = buy flow, down = sell), weighted
// by the bar's volume. Falls back to deterministic synthesis when offline.
export const NetFlowMini = ({ instrument }) => {
  const [bars, setBars] = useState(null);
  // Date selector — pick which session's flow to view. Today fetches
  // intraday minute bars; historical dates re-seed deterministically
  // so each shows a believable but distinct cumulative flow shape.
  const [selectedDate, setSelectedDate] = useState('today');
  const dateOptions = useMemo(() => {
    const out = [{ id: 'today', label: 'Today' }];
    const today = new Date();
    let added = 0;
    for (let i = 1; added < 5; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const wd = d.getDay();
      if (wd === 0 || wd === 6) continue;
      out.push({
        id: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      });
      added++;
    }
    return out;
  }, []);
  useEffect(() => {
    let cancelled = false;
    setBars(null);
    (async () => {
      // Only fetch live data for "today"; historical dates get synthetic
      if (selectedDate === 'today' && instrument?.cls === 'equity' && instrument?.id && MASSIVE_API_KEY) {
        const data = await fetchPolygonAggs(instrument.id, 1, 'minute', 5);
        if (!cancelled) setBars(data ?? []);
      } else {
        if (!cancelled) setBars([]);
      }
    })();
    return () => { cancelled = true; };
  }, [instrument?.id, instrument?.cls, selectedDate]);
  const data = useMemo(() => {
    const seedBase = (instrument?.id ?? 'X').charCodeAt(0);
    if (selectedDate === 'today' && Array.isArray(bars) && bars.length > 5) {
      let cum = 0;
      return bars.map((b, i) => {
        const dir = b.close > b.open ? 1 : (b.close < b.open ? -1 : 0);
        cum += dir * (b.volume ?? 0);
        return { x: i, flow: cum / 1e6 };
      });
    }
    // Synthetic — vary per selected date so each looks distinct
    const dateSeed = selectedDate === 'today' ? 0 :
      selectedDate.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const seed = seedBase + dateSeed;
    return Array.from({ length: 30 }, (_, i) => ({
      x: i, flow: Math.sin((i + seed) * 0.4) * 50 + (i - 15) * 3 + Math.cos(i * 0.3 + dateSeed) * 20,
    }));
  }, [bars, instrument?.id, selectedDate]);
  const last = data[data.length - 1]?.flow ?? 0;
  const isLive = selectedDate === 'today' && Array.isArray(bars) && bars.length > 5;
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-center justify-between gap-2 text-[10px] mb-1.5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: COLORS.textMute }}>Net flow ({isLive ? 'live' : 'sim'})</span>
          <select value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="px-1.5 py-0.5 text-[9.5px] rounded outline-none"
                  style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                  title="Pick session">
            {dateOptions.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </div>
        <span className="tabular-nums font-medium shrink-0"
              style={{ color: last >= 0 ? COLORS.green : COLORS.red }}>
          {last >= 0 ? '+' : ''}{last.toFixed(2)}{isLive ? 'M' : ''}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="netflowGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={last >= 0 ? COLORS.green : COLORS.red} stopOpacity={0.35} />
                <stop offset="100%" stopColor={last >= 0 ? COLORS.green : COLORS.red} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="flow"
                  stroke={last >= 0 ? COLORS.green : COLORS.red}
                  strokeWidth={1.5}
                  fill="url(#netflowGrad)"
                  isAnimationActive={false} />
            <ReferenceLine y={0} stroke={COLORS.border} strokeDasharray="2 2" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// Dark pool flow — large prints over time. Real implementation would query
// Polygon's dark pool TRF feed (paid tier); we derive realistic prints from
// the largest minute bars in the live aggs (block trades typically show up
// as outsized minute volume). Falls back to deterministic synthesis offline.
export const DarkFlowMini = ({ instrument }) => {
  const [bars, setBars] = useState(null);
  // UW prints (preferred when the user has a paid UW subscription).
  // We try UW first, then fall back to Polygon aggs, then synth.
  const [uwPrints, setUwPrints] = useState(null);
  const [source, setSource] = useState(null); // 'uw' | 'polygon' | 'synth'
  useEffect(() => {
    let cancelled = false;
    setBars(null);
    setUwPrints(null);
    setSource(null);
    (async () => {
      // 1. Try Unusual Whales — real institutional dark-pool prints
      if (instrument?.cls === 'equity' && instrument?.id && UW_API_KEY) {
        const data = await fetchUWStockFlow(instrument.id);
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setUwPrints(data);
          setSource('uw');
          return;
        }
      }
      // 2. Polygon fallback — high-volume minute bars (proxy for prints)
      if (instrument?.cls === 'equity' && instrument?.id && MASSIVE_API_KEY) {
        const data = await fetchPolygonAggs(instrument.id, 1, 'minute', 5);
        if (!cancelled) {
          setBars(data ?? []);
          setSource(data?.length ? 'polygon' : 'synth');
        }
      } else {
        if (!cancelled) { setBars([]); setSource('synth'); }
      }
    })();
    return () => { cancelled = true; };
  }, [instrument?.id, instrument?.cls]);
  const prints = useMemo(() => {
    // Prefer UW data when available — these are real off-exchange prints
    if (Array.isArray(uwPrints) && uwPrints.length > 0) {
      return uwPrints.slice(0, 12).map(p => ({
        time: new Date(p.executed_at ?? p.ts ?? Date.now()).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
        size: p.size ?? p.premium ?? 0,
        price: p.price ?? instrument?.mark ?? 0,
        side: (p.side ?? '').toLowerCase() === 'sell' ? 'sell' : 'buy',
      }));
    }
    if (Array.isArray(bars) && bars.length > 0) {
      // Sort by volume desc, take top 12, format
      return [...bars]
        .filter(b => b.volume && b.t)
        .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
        .slice(0, 12)
        .map(b => ({
          time: new Date(b.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
          size: Math.round((b.volume ?? 0) / 100) * 100, // round to lot
          price: b.close,
          side: b.close >= b.open ? 'buy' : 'sell',
        }));
    }
    const seed = (instrument?.id ?? 'X').charCodeAt(0);
    return Array.from({ length: 12 }, (_, i) => ({
      time: `${(9 + i % 7).toString().padStart(2, '0')}:${(((i * 7) % 60).toString().padStart(2, '0'))}`,
      size: Math.round((Math.sin((i + seed) * 0.9) * 0.5 + 0.5) * 100) * 100,
      price: instrument?.mark ?? 100,
      side: ((i + seed) % 3) === 0 ? 'sell' : 'buy',
    }));
  }, [bars, uwPrints, instrument?.id, instrument?.mark]);
  const isLive = source === 'uw' || (Array.isArray(bars) && bars.length > 0);
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-center justify-between text-[10px] mb-1 shrink-0">
        <span style={{ color: COLORS.textMute }}>
          {source === 'uw' ? 'UW dark-pool prints' : isLive ? 'Top block trades' : 'Simulated prints'}
        </span>
        <span style={{ color: isLive ? COLORS.green : COLORS.textMute, fontWeight: 600, fontSize: 9 }}>
          {isLive ? 'LIVE' : 'SIM'}
        </span>
      </div>
      <div className="grid grid-cols-[3.5rem_1fr_4rem_2.5rem] gap-1 px-1 py-1 text-[9px] uppercase tracking-wider shrink-0 border-b"
           style={{ color: COLORS.textMute, borderColor: COLORS.border }}>
        <span>Time</span>
        <span className="text-right">Size</span>
        <span className="text-right">Price</span>
        <span className="text-right">Side</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {prints.map((p, i) => (
          <div key={i} className="grid grid-cols-[3.5rem_1fr_4rem_2.5rem] gap-1 px-1 py-0.5 text-[10.5px] tabular-nums hover:bg-white/[0.03]"
               style={{ color: COLORS.text }}>
            <span style={{ color: COLORS.textDim }}>{p.time}</span>
            <span className="text-right">{p.size.toLocaleString()}</span>
            <span className="text-right" style={{ color: COLORS.textDim }}>${p.price?.toFixed(2)}</span>
            <span className="text-right font-medium" style={{ color: p.side === 'buy' ? COLORS.green : COLORS.red }}>{p.side}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Sector heat map mini — colored grid mirroring the full heat map page.
// Pulls live SPDR sector ETF snapshots from Polygon when available;
// falls back to deterministic synthesized values otherwise.
export const SectorHeatMapMini = () => {
  const [live, setLive] = useState(null);
  const [selected, setSelected] = useState(null); // ETF selected for detail
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchPolygonSectorMap();
      if (!cancelled) setLive(data);
    })();
    return () => { cancelled = true; };
  }, []);
  // Mock data shape — matches live shape so render code is unified. Includes
  // a synthetic market-cap weighting per sector so we can show "total value
  // of sectors" and let the user grok which is the biggest slice of the market.
  const mockSectors = [
    { etf: 'XLK',  sector: 'Technology',  cap: 18.4 },
    { etf: 'XLV',  sector: 'Health',      cap:  7.1 },
    { etf: 'XLF',  sector: 'Financials',  cap:  9.6 },
    { etf: 'XLE',  sector: 'Energy',      cap:  3.4 },
    { etf: 'XLY',  sector: 'Consumer',    cap:  6.8 },
    { etf: 'XLI',  sector: 'Industrial',  cap:  4.7 },
    { etf: 'XLU',  sector: 'Utilities',   cap:  1.9 },
    { etf: 'XLB',  sector: 'Materials',   cap:  1.6 },
    { etf: 'XLRE', sector: 'Real Estate', cap:  2.3 },
    { etf: 'XLC',  sector: 'Telecom',     cap:  4.1 },
  ];
  const sectors = (live && live.length > 0)
    ? live.map(s => ({
        ...s,
        cap: s.cap ?? mockSectors.find(m => m.etf === s.etf)?.cap ?? 1,
      }))
    : mockSectors.map((s, i) => ({ ...s, change: ((i * 13 + 7) % 9) - 4 }));
  const isLive = live && live.length > 0;
  const totalMarketValue = sectors.reduce((s, x) => s + (x.cap ?? 0), 0);
  // Group sectors into Risk-On vs Risk-Off vs Defensive for a clearer
  // visual story than alphabetical. Helps users see flow of money.
  const RISK_ON = new Set(['Technology', 'Consumer', 'Financials', 'Industrial']);
  const DEFENSIVE = new Set(['Health', 'Utilities', 'Real Estate']);
  // (Energy, Materials, Telecom = "cyclical")
  const grouped = [
    { id: 'risk-on',  label: 'Risk-On',  members: sectors.filter(s => RISK_ON.has(s.sector)) },
    { id: 'defensive', label: 'Defensive', members: sectors.filter(s => DEFENSIVE.has(s.sector)) },
    { id: 'cyclical', label: 'Cyclical', members: sectors.filter(s => !RISK_ON.has(s.sector) && !DEFENSIVE.has(s.sector)) },
  ];

  const groupAvg = (members) => {
    if (members.length === 0) return 0;
    return members.reduce((s, m) => s + (m.change ?? 0), 0) / members.length;
  };
  const groupCap = (members) => members.reduce((s, m) => s + (m.cap ?? 0), 0);

  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-center justify-between mb-1.5 text-[9px] uppercase tracking-wider shrink-0"
           style={{ color: COLORS.textMute }}>
        <span>Sector · 24h change · ${totalMarketValue.toFixed(1)}T total</span>
        {isLive && (
          <span className="inline-flex items-center" title="Live data">
            <span className="rounded-full" style={{ width: 6, height: 6, background: COLORS.green, display: 'inline-block' }} />
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
        {grouped.map(group => {
          if (group.members.length === 0) return null;
          const avg = groupAvg(group.members);
          const cap = groupCap(group.members);
          const pct = totalMarketValue > 0 ? (cap / totalMarketValue) * 100 : 0;
          return (
            <div key={group.id}>
              {/* Group header — average change + total cap + share of market */}
              <div className="flex items-center justify-between text-[8.5px] uppercase tracking-wider mb-0.5 px-0.5"
                   style={{ color: COLORS.textMute }}>
                <span>{group.label}</span>
                <span className="flex items-center gap-1.5">
                  <span style={{ color: avg >= 0 ? COLORS.green : COLORS.red }}>
                    avg {avg >= 0 ? '+' : ''}{avg.toFixed(2)}%
                  </span>
                  <span>·</span>
                  <span>${cap.toFixed(1)}T ({pct.toFixed(0)}%)</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {group.members.map((s, i) => {
                  const change = s.change ?? 0;
                  const isPos = change > 0;
                  const isFlat = change === 0;
                  const baseColor = isFlat ? '#999' : isPos ? COLORS.green : COLORS.red;
                  const intensity = Math.min(1, Math.abs(change) / 4);
                  // Tile size proportional to cap — bigger sectors get
                  // a slightly bigger min-height visual cue.
                  const minHeight = Math.max(34, 28 + (s.cap ?? 1) * 1.5);
                  const isSelected = selected === s.etf;
                  return (
                    <button key={s.etf ?? i}
                            onClick={() => setSelected(isSelected ? null : s.etf)}
                            className="rounded p-1.5 flex flex-col justify-between text-left transition-all hover:scale-[1.02]"
                            style={{
                              background: `${baseColor}${Math.round((0.18 + intensity * 0.4) * 255).toString(16).padStart(2, '0')}`,
                              border: `1px solid ${isSelected ? baseColor : baseColor + '55'}`,
                              minHeight,
                              boxShadow: isSelected ? `0 0 0 1px ${baseColor}` : 'none',
                            }}
                            title={`${s.sector} · $${(s.cap ?? 0).toFixed(1)}T mkt cap · click for details`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold tabular-nums"
                              style={{ color: baseColor, fontFamily: 'ui-monospace, monospace' }}>{s.etf}</span>
                        <span className="text-[9.5px] tabular-nums font-medium" style={{ color: baseColor }}>
                          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                        </span>
                      </div>
                      <div className="text-[8.5px] truncate" style={{ color: COLORS.text }}>{s.sector}</div>
                      {isSelected && (
                        <div className="mt-0.5 text-[8px] tabular-nums" style={{ color: COLORS.text, opacity: 0.85 }}>
                          ${(s.cap ?? 0).toFixed(1)}T · {totalMarketValue > 0 ? ((s.cap / totalMarketValue) * 100).toFixed(1) : 0}% of market
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ──────── MARKET MAP MINI — Finviz-style market heatmap ────────
// Breaks down the entire US equities market by sector, then by the largest
// companies in each sector. Tile size = market cap, tile color = today's
// % change. Click any tile to load that ticker as the active instrument.
//
// Layout: slice-and-dice treemap. Sectors are columns sized by total cap;
// companies stack vertically within each column with row height = cap.
export const MarketMapMini = ({ onSelect }) => {
  const [live, setLive] = useState(null);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchPolygonMarketMap();
      if (!cancelled) setLive(data);
    })();
    return () => { cancelled = true; };
  }, []);

  // Build the per-sector lists with live changes when available, else
  // deterministic seeded values so the widget still renders something
  // sensible without an API key.
  const sectorRows = useMemo(() => {
    const rows = [];
    Object.entries(SECTOR_CONSTITUENTS).forEach(([sector, comps]) => {
      const enriched = comps.map(c => {
        if (live) {
          const match = live.find(l => l.ticker === c.ticker);
          if (match && match.change != null) {
            return { ...c, sector, change: match.change };
          }
        }
        // Deterministic fallback — seed by ticker so colors are stable
        const seed = c.ticker.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
        const pseudo = ((seed * 73) % 200 - 100) / 25; // -4 to +4
        return { ...c, sector, change: pseudo };
      });
      const totalCap = enriched.reduce((s, c) => s + c.cap, 0);
      rows.push({ sector, totalCap, companies: enriched });
    });
    // Sort sectors by total cap desc so largest sectors render leftmost
    rows.sort((a, b) => b.totalCap - a.totalCap);
    return rows;
  }, [live]);

  const grandTotal = sectorRows.reduce((s, r) => s + r.totalCap, 0);
  const isLive = live && live.some(l => l.isLive);

  // Color scale: red→gray→green based on change %, matching finviz palette
  const tileColor = (change) => {
    if (change == null) return '#3a3a3a';
    const c = Math.max(-4, Math.min(4, change));
    if (c >= 0) {
      // green range: 0 → +4
      const intensity = c / 4;
      const r = Math.round(50 - intensity * 50);
      const g = Math.round(80 + intensity * 110);
      const b = Math.round(60 - intensity * 30);
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      // red range: -4 → 0
      const intensity = -c / 4;
      const r = Math.round(80 + intensity * 110);
      const g = Math.round(50 - intensity * 30);
      const b = Math.round(50 - intensity * 30);
      return `rgb(${r}, ${g}, ${b})`;
    }
  };

  return (
    <div className="h-full w-full flex flex-col p-2.5">
      <div className="flex items-center justify-between mb-1.5 text-[9px] uppercase tracking-wider shrink-0"
           style={{ color: COLORS.textMute }}>
        <span>US Equities · ${(grandTotal / 1000).toFixed(1)}T mapped</span>
        <div className="flex items-center gap-1.5">
          {isLive && (
            <span className="inline-flex items-center">
          <span className="rounded-full" style={{ width: 6, height: 6, background: COLORS.green, display: 'inline-block' }} />
        </span>
          )}
          <span style={{ color: COLORS.textMute }}>{sectorRows.length} sectors · {sectorRows.reduce((s, r) => s + r.companies.length, 0)} stocks</span>
        </div>
      </div>
      {/* Treemap layout — flex columns sized by sector cap */}
      <div className="flex-1 min-h-0 flex gap-px rounded overflow-hidden" style={{ background: COLORS.border }}>
        {sectorRows.map((s, sIdx) => {
          const flexBasis = (s.totalCap / grandTotal) * 100;
          // Stack companies vertically; size by cap within sector
          return (
            <div key={s.sector}
                 className="flex flex-col gap-px relative"
                 style={{ flexBasis: `${flexBasis}%`, minWidth: 28, background: COLORS.border }}>
              {/* Sector label — positioned absolute over top of column */}
              <div className="absolute top-0 left-0 right-0 px-1 py-0.5 z-10 pointer-events-none"
                   style={{
                     background: 'rgba(0,0,0,0.55)',
                     fontSize: 8.5,
                     fontWeight: 700,
                     color: '#FFFFFF',
                     textAlign: 'center',
                     letterSpacing: 0.2,
                     textTransform: 'uppercase',
                   }}>
                {s.sector}
              </div>
              {s.companies.map((c, cIdx) => {
                const flexC = (c.cap / s.totalCap) * 100;
                const showLabel = flexC > 7; // only label tiles big enough
                const showFull = flexBasis > 8 && flexC > 12;
                const isHover = hover === c.ticker;
                return (
                  <div key={c.ticker}
                       onClick={() => onSelect?.(c.ticker)}
                       onMouseEnter={() => setHover(c.ticker)}
                       onMouseLeave={() => setHover(null)}
                       className="cursor-pointer relative flex flex-col items-center justify-center text-center transition-opacity"
                       style={{
                         flexBasis: `${flexC}%`,
                         minHeight: 18,
                         background: tileColor(c.change),
                         opacity: isHover ? 0.85 : 1,
                         padding: 2,
                         overflow: 'hidden',
                         color: '#FFFFFF',
                         outline: isHover ? `1.5px solid ${COLORS.mint}` : 'none',
                         outlineOffset: -1,
                         zIndex: isHover ? 5 : 1,
                       }}
                       title={`${c.ticker} · ${c.name} · $${c.cap.toFixed(0)}B mkt cap · ${c.change >= 0 ? '+' : ''}${c.change?.toFixed(2)}%`}>
                    {showLabel && (
                      <span style={{
                        fontSize: showFull ? 11 : 9,
                        fontWeight: 700,
                        textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                        fontFamily: 'ui-monospace, monospace',
                        lineHeight: 1.1,
                      }}>
                        {c.ticker}
                      </span>
                    )}
                    {showFull && c.change != null && (
                      <span style={{
                        fontSize: 9,
                        fontWeight: 600,
                        textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                        fontFamily: 'ui-monospace, monospace',
                        lineHeight: 1.1,
                        marginTop: 1,
                      }}>
                        {c.change >= 0 ? '+' : ''}{c.change.toFixed(2)}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {/* Hover detail strip */}
      {hover && (() => {
        const found = sectorRows.flatMap(s => s.companies).find(c => c.ticker === hover);
        if (!found) return null;
        const tone = found.change >= 0 ? COLORS.green : COLORS.red;
        return (
          <div className="mt-1.5 px-2 py-1 rounded text-[10.5px] flex items-center gap-2 tabular-nums"
               style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}` }}>
            <span className="font-semibold" style={{ color: COLORS.text, minWidth: 50 }}>{found.ticker}</span>
            <span className="flex-1 truncate" style={{ color: COLORS.textDim }}>{found.name}</span>
            <span style={{ color: COLORS.textMute, fontSize: 10 }}>{found.sector}</span>
            <span style={{ color: COLORS.text }}>${found.cap}B</span>
            <span className="font-semibold" style={{ color: tone }}>
              {found.change >= 0 ? '+' : ''}{found.change?.toFixed(2)}%
            </span>
          </div>
        );
      })()}
      {/* Color scale legend */}
      <div className="mt-1.5 flex items-center gap-1 text-[8.5px]" style={{ color: COLORS.textMute }}>
        <span>−4%</span>
        {[-4, -2, -0.5, 0.5, 2, 4].map((v, i) => (
          <div key={i} style={{
            flex: 1,
            height: 6,
            background: tileColor(v),
            borderRadius: 1,
          }} />
        ))}
        <span>+4%</span>
      </div>
    </div>
  );
};

// CompWidget — comparable analysis. Shows the active stock alongside its
// sector peers (mkt cap, P/E, recent performance, etc). Useful for quickly
// answering "is AAPL expensive vs other big-cap tech?" The ticker list comes
// from SECTOR_CONSTITUENTS keyed off TICKER_SECTORS for the active stock.
// Live data via fetchPolygonTickerDetails — batched but lazy-loaded.
export const CompWidget = ({ instrument }) => {
  const ticker = instrument?.id;
  const sector = TICKER_SECTORS?.[ticker];
  const peers = useMemo(() => {
    if (!sector || !SECTOR_CONSTITUENTS?.[sector]) return [];
    return SECTOR_CONSTITUENTS[sector].slice(0, 6); // up to 6 peers
  }, [sector]);
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(false);
  // AI commentary — short blurb comparing the active ticker to its peers.
  // Uses Anthropic when a key is set; falls back to a deterministic
  // analytic summary so the widget always has something useful to show.
  const [aiCompare, setAiCompare] = useState(null);
  const [aiCompareLoading, setAiCompareLoading] = useState(false);

  useEffect(() => {
    if (peers.length === 0) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const out = {};
      const results = await Promise.all(peers.map(p => fetchPolygonTickerDetails(p.ticker)));
      peers.forEach((p, i) => { out[p.ticker] = results[i]; });
      if (!cancelled) {
        setDetails(out);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [peers.map(p => p.ticker).join(',')]);

  // Run an AI compare any time peer details change. Falls back to
  // a deterministic note if no AI is configured.
  useEffect(() => {
    if (peers.length === 0) return;
    let cancelled = false;
    (async () => {
      setAiCompareLoading(true);
      try {
        const peerSummary = peers.map(p => {
          const d = details[p.ticker];
          const cap = d?.marketCap ? `$${(d.marketCap / 1e9).toFixed(1)}B` : (p.cap ? `$${p.cap}B` : '—');
          return `${p.ticker} (${p.name}, cap ${cap})`;
        }).join('; ');
        const prompt = `Compare ${ticker} vs its sector peers (${sector}): ${peerSummary}.\n\nIn 2 sentences, identify ${ticker}'s key advantage and one risk relative to peers. Be specific. No bullet points.`;
        let summary = null;
        try {
          summary = await callAI(prompt, { maxTokens: 200 });
        } catch {}
        if (!cancelled) {
          if (summary && typeof summary === 'string' && summary.length > 20) {
            setAiCompare({ source: 'ai', text: summary.trim() });
          } else {
            // Deterministic fallback: note position by market cap
            const sortedByCap = peers
              .map(p => ({ p, cap: details[p.ticker]?.marketCap ?? (p.cap ? p.cap * 1e9 : 0) }))
              .sort((a, b) => b.cap - a.cap);
            const rank = sortedByCap.findIndex(x => x.p.ticker === ticker) + 1;
            const total = peers.length;
            const median = sortedByCap[Math.floor(total / 2)]?.cap ?? 0;
            const myCap = details[ticker]?.marketCap ?? sortedByCap.find(x => x.p.ticker === ticker)?.cap ?? 0;
            const above = myCap > median;
            setAiCompare({
              source: 'local',
              text: rank > 0
                ? `${ticker} ranks ${rank} of ${total} peers in ${sector} by market cap, ${above ? 'above' : 'below'} sector median. ${above ? 'Scale advantage may translate to pricing power; watch for regulatory risk at this size.' : 'Smaller cap suggests room to grow but higher idiosyncratic risk vs peers.'}`
                : `${ticker} is in the ${sector} sector with ${total} mapped peers. Set VITE_ANTHROPIC_API_KEY for richer AI comparison.`
            });
          }
          setAiCompareLoading(false);
        }
      } catch {
        if (!cancelled) setAiCompareLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [peers.map(p => p.ticker).join(','), Object.keys(details).length]);

  if (!sector || peers.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-4 text-center">
        <div>
          <div className="text-[12px] mb-1" style={{ color: COLORS.text }}>No comparables available</div>
          <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
            {instrument?.cls === 'equity'
              ? `${ticker} isn't mapped to a tracked sector.`
              : 'Comparable analysis works for equity instruments.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b text-[10px] flex items-center justify-between"
           style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
        <div>{sector} · {peers.length} peers · vs <span style={{ color: COLORS.mint }}>{ticker}</span></div>
        {loading && <span style={{ color: COLORS.mint }}>fetching…</span>}
      </div>
      {/* AI comparison blurb — sits at top so user sees the takeaway first */}
      <div className="px-3 py-2 border-b" style={{ borderColor: COLORS.border, background: 'rgba(30,58,108,0.04)' }}>
        <div className="flex items-center gap-1.5 mb-1">
          <Sparkles size={10} style={{ color: COLORS.mint }} />
          <span className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.mint }}>
            AI · {ticker} vs peers
          </span>
        </div>
        {aiCompareLoading ? (
          <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>Analyzing…</div>
        ) : aiCompare ? (
          <div className="text-[11px] leading-snug" style={{ color: COLORS.textDim }}>
            {aiCompare.text}
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="imo-data-table w-full text-[11px] tabular-nums">
          <thead>
            <tr className="border-b" style={{ borderColor: COLORS.border }}>
              <th className="text-left px-3 py-1.5" style={{ color: COLORS.textMute, fontWeight: 500 }}>Ticker</th>
              <th className="text-right px-2 py-1.5" style={{ color: COLORS.textMute, fontWeight: 500 }}>Cap (B)</th>
              <th className="text-right px-2 py-1.5" style={{ color: COLORS.textMute, fontWeight: 500 }}>Employees</th>
              <th className="text-right px-3 py-1.5" style={{ color: COLORS.textMute, fontWeight: 500 }}>List</th>
            </tr>
          </thead>
          <tbody>
            {peers.map(p => {
              const d = details[p.ticker];
              const isActive = p.ticker === ticker;
              const liveCap = d?.marketCap ? d.marketCap / 1e9 : null;
              const cap = liveCap ?? p.cap;
              return (
                <tr key={p.ticker} className="border-b" style={{ borderColor: COLORS.border, background: isActive ? 'rgba(30,58,108,0.08)' : undefined }}>
                  <td className="imo-label px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span style={{ color: isActive ? COLORS.mint : COLORS.text, fontWeight: isActive ? 600 : 400 }}>
                        {p.ticker}
                      </span>
                      {isActive && <span className="text-[8px] px-1 rounded" style={{ background: COLORS.mint, color: '#FFF' }}>YOU</span>}
                    </div>
                    <div className="text-[9.5px] truncate" style={{ color: COLORS.textMute, maxWidth: 140 }}>{p.name}</div>
                  </td>
                  <td className="imo-num px-2" style={{ color: COLORS.text }}>
                    {cap ? cap.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                  </td>
                  <td className="imo-num px-2" style={{ color: COLORS.textDim }}>
                    {d?.employees ? d.employees.toLocaleString() : '—'}
                  </td>
                  <td className="imo-num px-3" style={{ color: COLORS.textDim }}>
                    {d?.listDate ? new Date(d.listDate).getFullYear() : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};


// Terminal mini — compact preview of the Terminal page. Shows live geographic
// news pings (via Exa if available) with country/region tags so the user gets
// a glanceable overview of what's making moves around the world. Click any
// row to be taken to the full Terminal page.
// Mini Mapbox globe — used inside TerminalMini when VITE_MAPBOX_TOKEN is
// configured. Loads the same Mapbox GL JS the full Terminal page uses
// (cached globally in window.mapboxgl), renders a small globe-projection
// dark-style map, and places a pulsing dot for each active ping. Renders
// nothing if the token / loader fails — caller falls back to SVG.
export const TerminalMiniMapboxGlobe = ({ pings, token, className, style }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [ready, setReady] = useState(false);

  // One-time init — load mapbox-gl from CDN if not already loaded, then
  // construct the map at small zoom in globe projection. The full
  // terminal already exports `loadMapboxGL` as a global helper at module
  // scope; we re-implement a minimal loader here so this widget doesn't
  // depend on render order.
  useEffect(() => {
    if (!token || !containerRef.current) return;
    let cancelled = false;
    const inject = () => new Promise((resolve, reject) => {
      if (window.mapboxgl) return resolve(window.mapboxgl);
      if (window.__mapboxLoading) return window.__mapboxLoading.then(resolve, reject);
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/mapbox-gl@2.15.0/dist/mapbox-gl.css';
      document.head.appendChild(css);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/mapbox-gl@2.15.0/dist/mapbox-gl.js';
      script.onload = () => resolve(window.mapboxgl);
      script.onerror = reject;
      window.__mapboxLoading = new Promise((r, j) => { script.__r = r; script.__j = j; });
      document.head.appendChild(script);
    });
    inject().then(mapboxgl => {
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [0, 20],
        zoom: 0.4,
        projection: 'globe',
        interactive: false,
        attributionControl: false,
      });
      map.on('load', () => {
        try {
          map.setFog({
            color: 'rgb(10, 15, 24)',
            'high-color': 'rgb(20, 30, 50)',
            'horizon-blend': 0.04,
            'space-color': 'rgb(6, 8, 16)',
            'star-intensity': 0.15,
          });
        } catch {}
        if (!cancelled) {
          mapRef.current = map;
          setReady(true);
        }
      });
    }).catch(() => { /* swallow — caller will see no map */ });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch {}
        mapRef.current = null;
      }
    };
  }, [token]);

  // Update markers whenever pings change. Each marker is a small pulsing
  // green dot positioned by lng/lat. We tear down old markers before
  // creating new ones to avoid leaks.
  useEffect(() => {
    if (!ready || !mapRef.current || !window.mapboxgl) return;
    const mapboxgl = window.mapboxgl;
    markersRef.current.forEach(m => { try { m.remove(); } catch {} });
    markersRef.current = [];
    const flagToCoords = {
      '🇺🇸': [-95, 38],   '🇪🇺': [10, 50],   '🇨🇳': [105, 35], '🇯🇵': [138, 36],
      '🇬🇧': [-2, 54],    '🇮🇳': [78, 22],   '🇧🇷': [-47, -15], '🇨🇦': [-106, 56],
      '🇩🇪': [10, 51],
    };
    (pings ?? []).forEach((p) => {
      const c = flagToCoords[p.flag];
      if (!c) return;
      const el = document.createElement('div');
      el.style.cssText = `width: 10px; height: 10px; border-radius: 50%; background: ${COLORS.green}; box-shadow: 0 0 8px ${COLORS.green}; animation: imo-mini-globe-pulse 2.4s ease-in-out infinite;`;
      const marker = new mapboxgl.Marker({ element: el }).setLngLat(c).addTo(mapRef.current);
      markersRef.current.push(marker);
    });
    // Slow auto-rotation — feels alive. ~6 deg / sec.
    let raf;
    const start = performance.now();
    const baseLng = mapRef.current.getCenter().lng;
    const tick = (now) => {
      if (!mapRef.current) return;
      const dt = (now - start) / 1000;
      try { mapRef.current.setCenter([baseLng + dt * 6 - Math.floor((baseLng + dt * 6 + 180) / 360) * 360, 20]); } catch {}
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pings, ready]);

  return (
    <>
      <style>{`@keyframes imo-mini-globe-pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50%      { transform: scale(1.6); opacity: 0.5; }
      }`}</style>
      <div ref={containerRef} className={className} style={style} />
    </>
  );
};

export const TerminalMini = () => {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!EXA_API_KEY) {
        // Fallback static items so the widget always shows content
        if (!cancelled) setItems([
          { region: 'US',  flag: '🇺🇸', title: 'Fed signals patient on rate cuts amid sticky inflation' },
          { region: 'EU',  flag: '🇪🇺', title: 'ECB minutes: gradual easing path supported by majority' },
          { region: 'CN',  flag: '🇨🇳', title: 'PBOC injects liquidity to stabilize yuan ahead of holidays' },
          { region: 'JP',  flag: '🇯🇵', title: 'BoJ holds rates as wage growth nears critical threshold' },
          { region: 'UK',  flag: '🇬🇧', title: 'BoE faces sticky services inflation, March cut in doubt' },
          { region: 'IN',  flag: '🇮🇳', title: 'Sensex hits record on industrial output beat' },
        ]);
        return;
      }
      const r = await exaSearch('global financial markets central banks today', {
        numResults: 8, type: 'fast', maxAgeHours: 12, highlights: true,
      });
      if (cancelled) return;
      const hostFlags = {
        'reuters': '🌐', 'bloomberg': '🌐', 'ft': '🇬🇧', 'wsj': '🇺🇸',
        'cnbc': '🇺🇸', 'nikkei': '🇯🇵', 'scmp': '🇨🇳', 'economist': '🇬🇧',
      };
      const flagFromText = (t) => {
        const lower = t.toLowerCase();
        if (/(china|cn|pboc|yuan|shanghai)/.test(lower)) return '🇨🇳';
        if (/(japan|jp|boj|nikkei|yen|tokyo)/.test(lower))  return '🇯🇵';
        if (/(europe|ecb|euro|eur|frankfurt|paris)/.test(lower)) return '🇪🇺';
        if (/(uk|britain|bank of england|gbp|pound|london)/.test(lower)) return '🇬🇧';
        if (/(india|rbi|sensex|nifty|mumbai)/.test(lower)) return '🇮🇳';
        if (/(brazil|bovespa|real|bcb)/.test(lower)) return '🇧🇷';
        if (/(canada|cad|toronto|tsx|boc)/.test(lower)) return '🇨🇦';
        if (/(germany|dax|frankfurt)/.test(lower)) return '🇩🇪';
        if (/(fed|treasur|us[$\s]|america|wall|nyse|nasdaq)/.test(lower)) return '🇺🇸';
        return '🌐';
      };
      setItems((r?.results ?? []).slice(0, 8).map(item => {
        const flag = flagFromText((item.title ?? '') + ' ' + (item.text ?? ''));
        return {
          flag,
          region: flag === '🌐' ? 'GLOBAL' : '',
          title: item.title,
          url: item.url,
        };
      }));
    })();
    return () => { cancelled = true; };
  }, []);

  if (items === null) {
    return <div className="h-full flex items-center justify-center text-[11px]" style={{ color: COLORS.textMute }}>Loading global pings…</div>;
  }
  // Map region/flag to approximate globe coordinates (lat/lng → SVG x/y on
  // an equirectangular projection 360x180 → 200x100). Used to plot pulse
  // dots on the mini-globe so users see WHERE in the world news is firing.
  const flagToCoords = {
    '🇺🇸': { lng: -95,  lat: 38 },
    '🇪🇺': { lng: 10,   lat: 50 },
    '🇨🇳': { lng: 105,  lat: 35 },
    '🇯🇵': { lng: 138,  lat: 36 },
    '🇬🇧': { lng: -2,   lat: 54 },
    '🇮🇳': { lng: 78,   lat: 22 },
    '🇧🇷': { lng: -47,  lat: -15 },
    '🇨🇦': { lng: -106, lat: 56 },
    '🇩🇪': { lng: 10,   lat: 51 },
  };
  const lngLatToXy = (lng, lat) => ({
    x: ((lng + 180) / 360) * 200,
    y: ((90 - lat) / 180) * 100,
  });
  const pings = items
    .map(p => flagToCoords[p.flag])
    .filter(Boolean)
    .map(c => lngLatToXy(c.lng, c.lat));
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-center justify-between mb-1.5 text-[9px] uppercase tracking-wider shrink-0"
           style={{ color: COLORS.textMute }}>
        <span>Global pings</span>
        {EXA_API_KEY && (
          <span className="inline-flex items-center gap-1">
            <span className="rounded-full" style={{ width: 5, height: 5, background: COLORS.green, display: 'inline-block' }} />
            LIVE
          </span>
        )}
      </div>
      {/* Mini globe — uses Mapbox GL globe projection when VITE_MAPBOX_TOKEN
          is configured (richer, real continents with country borders). Falls
          back to the lightweight SVG below otherwise. */}
      {(() => {
        const tok = (() => { try { return import.meta.env?.VITE_MAPBOX_TOKEN; } catch { return null; } })();
        return tok ? (
          <TerminalMiniMapboxGlobe pings={items} token={tok} className="rounded mb-1.5 shrink-0 relative overflow-hidden"
                                   style={{ height: 84, background: '#0A0F18', border: `1px solid ${COLORS.border}` }} />
        ) : null;
      })()}
      {(() => {
        const tok = (() => { try { return import.meta.env?.VITE_MAPBOX_TOKEN; } catch { return null; } })();
        if (tok) return null;
        return (
      <div className="rounded mb-1.5 shrink-0 relative overflow-hidden"
           style={{ height: 84, background: '#0A0F18', border: `1px solid ${COLORS.border}` }}>
        <svg viewBox="0 0 200 100" preserveAspectRatio="none"
             style={{ width: '100%', height: '100%' }}>
          {/* Subtle grid lines so it reads as a map */}
          <g stroke="rgba(255,255,255,0.04)" strokeWidth="0.3">
            <line x1="0" y1="50" x2="200" y2="50" />
            <line x1="50" y1="0" x2="50" y2="100" />
            <line x1="100" y1="0" x2="100" y2="100" />
            <line x1="150" y1="0" x2="150" y2="100" />
          </g>
          {/* Continent outlines (simplified) */}
          <g fill="rgba(122,200,255,0.08)" stroke="rgba(122,200,255,0.20)" strokeWidth="0.35">
            {/* North America */}
            <path d="M 28 24 L 56 22 L 70 32 L 64 56 L 50 62 L 42 58 L 34 50 L 28 38 Z" />
            {/* South America */}
            <path d="M 52 64 L 64 70 L 60 88 L 52 94 L 48 84 L 50 72 Z" />
            {/* Europe */}
            <path d="M 90 24 L 108 22 L 110 36 L 100 40 L 92 38 Z" />
            {/* Africa */}
            <path d="M 96 42 L 110 42 L 116 60 L 108 80 L 100 76 L 96 60 Z" />
            {/* Asia */}
            <path d="M 110 22 L 158 22 L 168 38 L 160 52 L 134 48 L 118 40 L 112 32 Z" />
            {/* Australia */}
            <path d="M 156 70 L 174 68 L 176 80 L 162 82 Z" />
          </g>
          {/* Ping dots */}
          {pings.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="4" fill={COLORS.green} fillOpacity="0.18">
                <animate attributeName="r" values="2;6;2" dur="2.4s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
                <animate attributeName="fillOpacity" values="0.4;0;0.4" dur="2.4s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
              </circle>
              <circle cx={p.x} cy={p.y} r="1.4" fill={COLORS.green} />
            </g>
          ))}
        </svg>
      </div>
        );
      })()}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
        {items.map((p, i) => {
          const Tag = p.url ? 'a' : 'div';
          return (
            <Tag key={i} {...(p.url ? { href: p.url, target: '_blank', rel: 'noopener' } : {})}
                 className="flex items-start gap-2 p-1.5 rounded hover:bg-white/[0.04] transition-colors"
                 style={{ background: COLORS.bg, textDecoration: 'none' }}>
              <span className="text-[14px] shrink-0 leading-none mt-0.5">{p.flag}</span>
              <div className="flex-1 min-w-0 text-[10.5px] leading-snug" style={{ color: COLORS.text }}>
                {p.title}
              </div>
            </Tag>
          );
        })}
      </div>
    </div>
  );
};

// Gainers / Losers mini — split into top movers up and down with bars.
// Pulls live data from Polygon when available; falls back to deterministic
// values keyed off a curated ticker list.
export const GainersLosersMini = ({ onSelect }) => {
  const [liveGainers, setLiveGainers] = useState(null);
  const [liveLosers,  setLiveLosers]  = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [g, l] = await Promise.all([
        fetchPolygonMovers('gainers'),
        fetchPolygonMovers('losers'),
      ]);
      if (!cancelled) {
        setLiveGainers(g);
        setLiveLosers(l);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const isLive = (liveGainers && liveGainers.length > 0) || (liveLosers && liveLosers.length > 0);
  let gainers, losers;
  if (isLive) {
    gainers = (liveGainers ?? []).slice(0, 5).map(g => ({ ticker: g.ticker, change: g.change }));
    losers  = (liveLosers ?? []).slice(0, 5).map(g => ({ ticker: g.ticker, change: g.change }));
  } else {
    const tickers = ['NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'GOOG', 'AMZN', 'MSFT', 'AVGO', 'NFLX'];
    const rows = tickers.map((t, i) => ({
      ticker: t,
      change: ((i * 17 + 3) % 13) - 6,
    }));
    rows.sort((a, b) => b.change - a.change);
    gainers = rows.filter(r => r.change > 0).slice(0, 5);
    losers  = rows.filter(r => r.change < 0).reverse().slice(0, 5);
  }
  const allMoves = [...gainers, ...losers].map(r => Math.abs(r.change));
  const maxAbs = Math.max(...allMoves, 1);
  const Section = ({ title, items, color }) => (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="text-[9px] uppercase tracking-wider mb-1 shrink-0" style={{ color }}>{title}</div>
      <div className="flex-1 min-h-0 flex flex-col justify-around space-y-0.5">
        {items.map(r => (
          <button key={r.ticker}
                  onClick={() => onSelect?.(r.ticker)}
                  className="flex items-center gap-2 text-[10.5px] w-full text-left rounded px-1 py-0.5 transition-colors hover:bg-white/[0.04]"
                  title={`Open chart for ${r.ticker}`}>
            <span className="w-11 font-medium tabular-nums truncate" style={{ color: COLORS.text }}>{r.ticker}</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: COLORS.surface2 }}>
              <div className="h-full" style={{ width: `${(Math.abs(r.change) / maxAbs) * 100}%`, background: color }} />
            </div>
            <span className="w-11 text-right tabular-nums" style={{ color, fontSize: 10 }}>
              {r.change >= 0 ? '+' : ''}{r.change.toFixed(1)}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="h-full flex flex-col p-2.5">
      {isLive && (
        <div className="flex items-center justify-end mb-1 shrink-0">
          <span className="inline-flex items-center" title="Live data from Polygon market snapshots">
          <span className="rounded-full" style={{ width: 6, height: 6, background: COLORS.green, display: 'inline-block' }} />
        </span>
        </div>
      )}
      <Section title="▲ Gainers" items={gainers} color={COLORS.green} />
      <div className="h-2 shrink-0" />
      <Section title="▼ Losers"  items={losers}  color={COLORS.red} />
    </div>
  );
};

// Volatility skew — IV by strike (smile)
// Volatility skew — IV smile across moneyness. Real implementation would
// need Polygon's options chain (paid Starter tier). When chain is unavailable,
// we synthesize a realistic smile shape (parabolic skew) seeded by ticker.
export const VolSkewMini = ({ instrument }) => {
  const seed = (instrument?.id ?? 'X').charCodeAt(0);
  // Expiry date selector — let user pick which expiry's IV smile to view.
  // Each expiry produces a slightly different curve (steeper skew on
  // shorter-dated, flatter on longer-dated). All are deterministic from
  // the ticker seed so the same expiry shows the same shape every load.
  const expiryOptions = useMemo(() => {
    const today = new Date();
    const dteList = [7, 14, 30, 45, 60, 90, 180];
    return dteList.map(dte => {
      const d = new Date(today);
      d.setDate(d.getDate() + dte);
      return {
        id: `${dte}`,
        dte,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        full: `${dte}d · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      };
    });
  }, []);
  const [selectedDte, setSelectedDte] = useState('30');
  // Realistic IV smile — short-dated has steeper skew (higher gamma),
  // long-dated flattens out (volga risk evens vs distance from ATM).
  const data = useMemo(() => {
    const dte = Number(selectedDte) || 30;
    // Skew steepness inverse to DTE — short = steep, long = flat
    const skewMag = Math.max(2, 12 - dte / 12);
    const smileMag = Math.max(8, 32 - dte / 6);
    return Array.from({ length: 11 }, (_, i) => {
      const moneyness = (i - 5) / 5;
      const baseIV = 28 + (seed % 10) - dte * 0.04; // term structure: longer = lower base IV
      const skewTilt = -moneyness * skewMag;
      const smile = Math.pow(moneyness, 2) * smileMag;
      return {
        strike: `${(i - 5) >= 0 ? '+' : ''}${i - 5}`,
        moneyness: i - 5,
        iv: Math.max(8, baseIV + skewTilt + smile),
      };
    });
  }, [seed, selectedDte]);
  const atmIV = data[5]?.iv ?? 30;
  const sel = expiryOptions.find(e => e.id === selectedDte) ?? expiryOptions[2];
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-center justify-between gap-2 text-[10px] mb-1 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: COLORS.textMute }}>IV by strike</span>
          <select value={selectedDte}
                  onChange={e => setSelectedDte(e.target.value)}
                  className="px-1.5 py-0.5 text-[9.5px] rounded outline-none"
                  style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                  title="Pick expiry">
            {expiryOptions.map(o => <option key={o.id} value={o.id}>{o.dte}d · {o.label}</option>)}
          </select>
        </div>
        <span className="tabular-nums shrink-0" style={{ color: COLORS.mint, fontWeight: 600 }}>
          ATM {atmIV.toFixed(1)}%
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="volskewGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.mint} stopOpacity={0.35} />
                <stop offset="100%" stopColor={COLORS.mint} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="iv" stroke={COLORS.mint} strokeWidth={1.5} fill="url(#volskewGrad)" isAnimationActive={false} />
            <XAxis dataKey="strike" tick={{ fill: COLORS.textMute, fontSize: 8 }} axisLine={false} tickLine={false} interval={1} />
            <YAxis hide />
            <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, fontSize: 10 }} />
            <ReferenceLine x={`${0}`} stroke={COLORS.borderHi} strokeDasharray="2 2" label={{ value: 'ATM', fill: COLORS.textMute, fontSize: 8, position: 'top' }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// Volatility drift — rolling 20-day realized vol from daily returns.
// Computed from real Polygon close prices when available.
export const VolDriftMini = ({ instrument }) => {
  const [bars, setBars] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setBars(null);
    (async () => {
      if (instrument?.cls === 'equity' && instrument?.id && MASSIVE_API_KEY) {
        const data = await fetchPolygonAggs(instrument.id, 90, 'day', 1);
        if (!cancelled) setBars(data ?? []);
      } else {
        if (!cancelled) setBars([]);
      }
    })();
    return () => { cancelled = true; };
  }, [instrument?.id, instrument?.cls]);
  const data = useMemo(() => {
    const seed = (instrument?.id ?? 'X').charCodeAt(0);
    if (Array.isArray(bars) && bars.length > 25) {
      // Compute log returns then 20-day rolling stdev × sqrt(252)
      const returns = bars.slice(1).map((b, i) => Math.log(b.close / bars[i].close));
      const out = [];
      const window = 20;
      for (let i = window; i < returns.length; i++) {
        const slice = returns.slice(i - window, i);
        const mean = slice.reduce((a, b) => a + b, 0) / window;
        const variance = slice.reduce((acc, r) => acc + (r - mean) ** 2, 0) / window;
        const stdev = Math.sqrt(variance);
        out.push({ x: i, vol: stdev * Math.sqrt(252) * 100 });
      }
      return out;
    }
    return Array.from({ length: 30 }, (_, i) => ({
      x: i, vol: 25 + Math.sin((i + seed) * 0.3) * 8 + Math.cos(i * 0.7) * 3,
    }));
  }, [bars, instrument?.id]);
  const last = data[data.length - 1]?.vol ?? 25;
  const isLive = Array.isArray(bars) && bars.length > 25;
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-center justify-between text-[10px] mb-1 shrink-0">
        <span style={{ color: COLORS.textMute }}>20d realized vol{isLive ? ' (live)' : ' (sim)'}</span>
        <span className="tabular-nums" style={{ color: COLORS.chartMagenta, fontWeight: 600 }}>
          {last.toFixed(1)}%
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="voldriftGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.chartMagenta} stopOpacity={0.35} />
                <stop offset="100%" stopColor={COLORS.chartMagenta} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="vol" stroke={COLORS.chartMagenta} strokeWidth={1.5} fill="url(#voldriftGrad)" isAnimationActive={false} />
            <YAxis hide />
            <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, fontSize: 10 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// WSB sentiment mini — top tickers being discussed on r/wallstreetbets
// with bullish/bearish sentiment scores. Free public API, no key needed.
// Refreshes every 30 minutes via in-memory cache.
export const WSBSentimentMini = ({ onSelect }) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchWSBTickers();
      if (!cancelled) setData(rows);
    })();
    return () => { cancelled = true; };
  }, []);
  if (data === null) {
    return <div className="h-full flex items-center justify-center text-[11px]" style={{ color: COLORS.textMute }}>Loading r/wallstreetbets…</div>;
  }
  if (data.length === 0) {
    return <div className="h-full flex items-center justify-center text-[11px] text-center px-3" style={{ color: COLORS.textMute }}>WSB sentiment unavailable. Source: tradestie.com</div>;
  }
  const top = data.slice(0, 10);
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-center justify-between mb-1.5 text-[9px] uppercase tracking-wider shrink-0"
           style={{ color: COLORS.textMute }}>
        <span>r/wallstreetbets · 24h</span>
        <span>Mentions</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
        {top.map(r => {
          const isBullish = r.sentiment === 'Bullish';
          const isBearish = r.sentiment === 'Bearish';
          const tone = isBullish ? COLORS.green : isBearish ? COLORS.red : '#FFB84D';
          return (
            <button key={r.ticker}
                    onClick={() => onSelect?.(r.ticker)}
                    className="w-full grid grid-cols-[auto_1fr_auto_auto] gap-2 items-center py-1 px-1.5 rounded hover:bg-white/[0.04] transition-colors text-left">
              <span className="text-[11px] font-semibold tabular-nums w-10" style={{ color: COLORS.text }}>{r.ticker}</span>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: COLORS.surface2 }}>
                <div className="h-full" style={{
                  width: `${Math.max(8, Math.min(100, (r.score + 1) * 50))}%`,
                  background: tone,
                }} />
              </div>
              <span className="text-[9px] uppercase tracking-wider" style={{ color: tone }}>
                {isBullish ? '▲ BULL' : isBearish ? '▼ BEAR' : '◆ MIX'}
              </span>
              <span className="text-[10px] tabular-nums w-10 text-right" style={{ color: COLORS.textDim }}>
                {r.comments}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// SEC Filings mini — recent EDGAR filings for the active ticker. No key
// needed; SEC requires only a polite User-Agent header.
export const SECFilingsMini = ({ instrument }) => {
  const [filings, setFilings] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!instrument?.id || instrument.cls !== 'equity') {
        if (!cancelled) setFilings([]);
        return;
      }
      const rows = await fetchSecFilings(instrument.id);
      if (!cancelled) setFilings(rows);
    })();
    return () => { cancelled = true; };
  }, [instrument?.id, instrument?.cls]);
  if (filings === null) return <div className="h-full flex items-center justify-center text-[11px]" style={{ color: COLORS.textMute }}>Loading SEC filings…</div>;
  if (filings.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[11px] text-center px-3" style={{ color: COLORS.textMute }}>
        {instrument?.cls !== 'equity'
          ? 'SEC filings only apply to US equities'
          : `No EDGAR filings found for ${instrument?.id ?? ''}`}
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-center justify-between mb-1.5 text-[9px] uppercase tracking-wider shrink-0"
           style={{ color: COLORS.textMute }}>
        <span>EDGAR · {instrument.id}</span>
        <span>Recent</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
        {filings.slice(0, 12).map((f, i) => {
          const formColor = f.form?.startsWith('10-K') ? '#7BFFB5' :
                            f.form?.startsWith('10-Q') ? '#7AC8FF' :
                            f.form?.startsWith('8-K')  ? '#FFB84D' :
                            f.form?.includes('4')      ? '#FF7AB6' :
                            COLORS.textDim;
          return (
            <a key={i} href={f.url} target="_blank" rel="noopener"
               className="block rounded p-1.5 border transition-colors hover:bg-white/[0.04]"
               style={{ background: COLORS.bg, borderColor: COLORS.border, textDecoration: 'none' }}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded"
                      style={{ background: `${formColor}22`, color: formColor, border: `1px solid ${formColor}55` }}>
                  {f.form}
                </span>
                <span className="text-[9px] tabular-nums" style={{ color: COLORS.textMute }}>{f.date}</span>
              </div>
              <div className="text-[10.5px] truncate" style={{ color: COLORS.text }}>
                {f.description || f.primaryDoc}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
};

// Treasury rates mini — live US Treasury average interest rates.
export const TreasuryRatesMini = () => {
  const [rates, setRates] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchTreasuryRates();
      if (!cancelled) setRates(rows);
    })();
    return () => { cancelled = true; };
  }, []);
  if (rates === null) return <div className="h-full flex items-center justify-center text-[11px]" style={{ color: COLORS.textMute }}>Loading Treasury data…</div>;
  if (rates.length === 0) {
    return <div className="h-full flex items-center justify-center text-[11px]" style={{ color: COLORS.textMute }}>Treasury data unavailable.</div>;
  }
  const byType = {};
  rates.forEach(r => {
    if (!byType[r.security]) byType[r.security] = r;
  });
  const ordered = Object.values(byType).slice(0, 10);
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-center justify-between mb-1.5 text-[9px] uppercase tracking-wider shrink-0"
           style={{ color: COLORS.textMute }}>
        <span>US Treasury · Avg rates</span>
        <span className="inline-flex items-center gap-1">
          <span className="rounded-full" style={{ width: 5, height: 5, background: COLORS.green, display: 'inline-block' }} />
          LIVE
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
        {ordered.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-[11px] py-1 px-2 rounded"
               style={{ background: COLORS.bg }}>
            <span className="truncate flex-1 text-[10.5px]" style={{ color: COLORS.text }}>{r.security}</span>
            <span className="tabular-nums font-medium ml-2" style={{ color: COLORS.mint }}>
              {r.rate.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Macro indicators mini — pulls a curated set of EconDB time-series and
// shows the latest reading + 4-quarter trend. No key required.
export const MacroIndicatorsMini = () => {
  const [series, setSeries] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const codes = [
        { code: 'GDPUS',     label: 'US GDP',          unit: '$T'    },
        { code: 'CPIUS',     label: 'US CPI',          unit: 'index' },
        { code: 'URATEUS',   label: 'Unemployment',    unit: '%'     },
        { code: 'PPIUS',     label: 'PPI',             unit: 'index' },
      ];
      const results = await Promise.all(codes.map(c => fetchEconDbSeries(c.code).then(s => ({ ...c, series: s }))));
      if (!cancelled) setSeries(results);
    })();
    return () => { cancelled = true; };
  }, []);
  if (series === null) return <div className="h-full flex items-center justify-center text-[11px]" style={{ color: COLORS.textMute }}>Loading macro data…</div>;
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-center justify-between mb-1.5 text-[9px] uppercase tracking-wider shrink-0"
           style={{ color: COLORS.textMute }}>
        <span>EconDB · Macro</span>
        <span>Latest</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
        {series.map((s, i) => {
          const data = s.series?.data ?? [];
          if (data.length === 0) {
            return (
              <div key={i} className="flex items-center justify-between text-[11px] py-1.5 px-2 rounded"
                   style={{ background: COLORS.bg }}>
                <span style={{ color: COLORS.text }}>{s.label}</span>
                <span style={{ color: COLORS.textMute }}>—</span>
              </div>
            );
          }
          const latest = data[data.length - 1];
          const prior  = data[data.length - 2] ?? latest;
          const change = latest.value - prior.value;
          const pct    = prior.value !== 0 ? (change / Math.abs(prior.value)) * 100 : 0;
          const tone   = change >= 0 ? COLORS.green : COLORS.red;
          const last12 = data.slice(-12);
          const min = Math.min(...last12.map(p => p.value));
          const max = Math.max(...last12.map(p => p.value));
          const range = max - min || 1;
          const points = last12.map((p, idx) => `${idx * 5},${14 - ((p.value - min) / range) * 12}`).join(' ');
          return (
            <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded"
                 style={{ background: COLORS.bg }}>
              <span className="text-[10.5px] flex-1 truncate" style={{ color: COLORS.text }}>{s.label}</span>
              <svg width="56" height="14" viewBox="0 0 56 14">
                <polyline points={points} stroke={tone} strokeWidth="1.2" fill="none" />
              </svg>
              <span className="text-[10.5px] tabular-nums" style={{ color: COLORS.text }}>
                {latest.value.toFixed(1)}
              </span>
              <span className="text-[9.5px] tabular-nums w-11 text-right" style={{ color: tone }}>
                {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Local conditions mini — pulls weather + air quality from Weatherstack and
// IQAir. Shows for the user's primary market hub (defaults to NYC).
export const LocalConditionsMini = ({ city = 'New York', lat = 40.7128, lng = -74.0060 }) => {
  const [data, setData] = useState({ weather: undefined, aqi: undefined });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [w, a] = await Promise.all([
        WEATHERSTACK_KEY ? fetchWeather(city) : Promise.resolve(null),
        IQAIR_KEY        ? fetchAirQuality(lat, lng) : Promise.resolve(null),
      ]);
      if (!cancelled) setData({ weather: w, aqi: a });
    })();
  }, [city, lat, lng]);
  const aqiColor = (aqi) => {
    if (aqi == null) return COLORS.textMute;
    if (aqi <= 50)   return COLORS.green;
    if (aqi <= 100)  return '#FFB84D';
    if (aqi <= 150)  return '#FF8855';
    return COLORS.red;
  };
  const aqiLabel = (aqi) => {
    if (aqi == null) return '—';
    if (aqi <= 50)   return 'Good';
    if (aqi <= 100)  return 'Moderate';
    if (aqi <= 150)  return 'Unhealthy (sensitive)';
    if (aqi <= 200)  return 'Unhealthy';
    return 'Hazardous';
  };
  if (data.weather === undefined && data.aqi === undefined) {
    return <div className="h-full flex items-center justify-center text-[11px]" style={{ color: COLORS.textMute }}>Loading conditions…</div>;
  }
  return (
    <div className="h-full flex flex-col p-2.5 gap-2">
      <div className="text-[10px] uppercase tracking-wider shrink-0" style={{ color: COLORS.textMute }}>
        {city}
      </div>
      {data.weather ? (
        <div className="rounded p-2 border flex-1 min-h-0 flex flex-col justify-between" style={{ background: COLORS.bg, borderColor: COLORS.border }}>
          <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
            Weatherstack
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[20px] tabular-nums font-medium" style={{ color: COLORS.text }}>
              {data.weather.temp}°C
            </span>
            <span className="text-[10.5px] truncate ml-2" style={{ color: COLORS.textDim }}>
              {data.weather.desc}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]" style={{ color: COLORS.textMute }}>
            <span>Wind {data.weather.windKph} km/h</span>
            <span>Humidity {data.weather.humidity}%</span>
          </div>
        </div>
      ) : (
        <div className="rounded p-2 border text-[10.5px] flex-1 flex items-center justify-center text-center"
             style={{ background: COLORS.bg, borderColor: COLORS.border, color: COLORS.textMute }}>
          Set <code>VITE_WEATHERSTACK_KEY</code><br />for live weather
        </div>
      )}
      {data.aqi ? (
        <div className="rounded p-2 border flex-1 min-h-0 flex flex-col justify-between" style={{ background: COLORS.bg, borderColor: COLORS.border }}>
          <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
            IQAir
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[20px] tabular-nums font-medium" style={{ color: aqiColor(data.aqi.aqiUS) }}>
              AQI {data.aqi.aqiUS}
            </span>
            <span className="text-[10.5px] truncate ml-2" style={{ color: aqiColor(data.aqi.aqiUS) }}>
              {aqiLabel(data.aqi.aqiUS)}
            </span>
          </div>
          <div className="text-[10px]" style={{ color: COLORS.textMute }}>
            Main pollutant: {data.aqi.mainPollutant?.toUpperCase() ?? '—'}
          </div>
        </div>
      ) : (
        <div className="rounded p-2 border text-[10.5px] flex-1 flex items-center justify-center text-center"
             style={{ background: COLORS.bg, borderColor: COLORS.border, color: COLORS.textMute }}>
          Set <code>VITE_IQAIR_KEY</code><br />for air quality
        </div>
      )}
    </div>
  );
};

// Corporate actions mini — Alpaca dividends, splits, mergers for the
// active equity instrument. Only renders when both ALPACA keys are set.
export const CorporateActionsMini = ({ instrument }) => {
  const [actions, setActions] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!instrument?.id || instrument.cls !== 'equity' || !ALPACA_KEY) {
        if (!cancelled) setActions([]);
        return;
      }
      const rows = await fetchAlpacaCorporateActions(instrument.id);
      if (!cancelled) setActions(rows);
    })();
    return () => { cancelled = true; };
  }, [instrument?.id, instrument?.cls]);
  if (!ALPACA_KEY) {
    return (
      <div className="h-full flex items-center justify-center text-[10.5px] text-center px-3" style={{ color: COLORS.textMute }}>
        Set <code>VITE_ALPACA_KEY</code> + <code>VITE_ALPACA_SECRET</code><br />in env to enable corporate actions
      </div>
    );
  }
  if (actions === null) return <div className="h-full flex items-center justify-center text-[11px]" style={{ color: COLORS.textMute }}>Loading corporate actions…</div>;
  if (actions.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[11px] text-center px-3" style={{ color: COLORS.textMute }}>
        {instrument?.cls !== 'equity'
          ? 'Corporate actions only apply to US equities'
          : `No corporate actions for ${instrument?.id ?? ''} in the next 90 days`}
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-center justify-between mb-1.5 text-[9px] uppercase tracking-wider shrink-0"
           style={{ color: COLORS.textMute }}>
        <span>Alpaca · {instrument.id}</span>
        <span>90-day window</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
        {actions.slice(0, 12).map((a, i) => {
          const tone = a.type === 'dividend' ? COLORS.green :
                       a.type === 'split'    ? '#7AC8FF' :
                       a.type === 'merger'   ? '#FF7AB6' :
                       COLORS.textDim;
          return (
            <div key={i} className="rounded p-1.5 border"
                 style={{ background: COLORS.bg, borderColor: COLORS.border, borderLeft: `3px solid ${tone}` }}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: tone }}>
                  {a.type}
                  {a.subType ? ` · ${a.subType}` : ''}
                </span>
                <span className="text-[9.5px] tabular-nums" style={{ color: COLORS.textMute }}>
                  ex {a.exDate ?? '—'}
                </span>
              </div>
              <div className="text-[10.5px] tabular-nums" style={{ color: COLORS.text }}>
                {a.cashAmount != null ? `$${a.cashAmount}` : a.ratio ? `Ratio ${a.ratio}` : '—'}
                {a.payableDate ? <span className="ml-2 text-[9.5px]" style={{ color: COLORS.textMute }}>pays {a.payableDate}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};


export const NewsFeedMini = ({ instrument }) => {
  const [items, setItems] = useState(null);  // null = loading
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const symbol = instrument?.id ?? '';
      const query = symbol || 'stock market';
      // News source priority — newsdata.io first per user request, then
      // Exa as a richer-content fallback, then the other free APIs.
      let articles = [];
      if (NEWSDATA_KEY) articles = await fetchNewsDataNews(query);
      if (articles.length === 0 && EXA_API_KEY) {
        const exa = await exaSearch(`${query} stock news`, {
          numResults: 8, type: 'fast', maxAgeHours: 24, highlights: true,
        });
        if (exa?.results?.length) {
          articles = exa.results.map(r => ({
            title: r.title,
            url: r.url,
            ts: r.publishedDate ? new Date(r.publishedDate).getTime() : Date.now(),
            source: (() => { try { return new URL(r.url).hostname.replace('www.', ''); } catch { return 'web'; } })(),
          }));
        }
      }
      if (articles.length === 0 && MEDIASTACK_KEY) articles = await fetchMediaStackNews(query);
      if (articles.length === 0 && CURRENTS_KEY) articles = await fetchCurrentsNews(query);
      if (articles.length === 0 && NYT_KEY)      articles = await fetchNytNews(query);
      if (cancelled) return;
      if (articles.length > 0) {
        const mapped = articles.slice(0, 10).map(a => {
          const t = (a.title ?? '').toLowerCase();
          const pos = /(beat|surge|rally|upgrade|record|gain|jump|rise|profit)/.test(t);
          const neg = /(miss|drop|fall|plunge|cut|loss|warn|sue|crash|tumble)/.test(t);
          const tsDate = new Date(a.ts);
          const ago = Math.max(1, Math.round((Date.now() - tsDate.getTime()) / 60_000));
          const fmtAgo = ago < 60 ? `${ago}m` : ago < 1440 ? `${Math.round(ago/60)}h` : `${Math.round(ago/1440)}d`;
          return {
            src: a.source ?? 'News',
            ts: fmtAgo,
            sentiment: pos ? 'pos' : neg ? 'neg' : 'neu',
            headline: a.title,
            url: a.url,
          };
        });
        setItems(mapped);
        return;
      }
      // Fallback mocks
      const seed = symbol || 'X';
      setItems([
        { src: 'Reuters',    ts: '12m', sentiment: 'pos', headline: `${seed} announces Q3 results — beats consensus by 8%` },
        { src: 'Bloomberg',  ts: '1h',  sentiment: 'pos', headline: `Analysts upgrade ${seed} to Overweight, raise price target` },
        { src: 'WSJ',        ts: '3h',  sentiment: 'neu', headline: `${seed} reports record customer engagement, expansion plans` },
        { src: 'CNBC',       ts: '5h',  sentiment: 'neg', headline: `Sector rotation pressures ${seed} as risk-off rotation begins` },
      ]);
    })();
    return () => { cancelled = true; };
  }, [instrument?.id]);
  if (items === null) {
    return <div className="h-full flex items-center justify-center text-[11px]" style={{ color: COLORS.textMute }}>Loading news…</div>;
  }
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
        {items.map((t, i) => {
          const sentColor = t.sentiment === 'pos' ? COLORS.green : t.sentiment === 'neg' ? COLORS.red : '#FFB84D';
          const sentIcon  = t.sentiment === 'pos' ? '▲' : t.sentiment === 'neg' ? '▼' : '◆';
          const Tag = t.url ? 'a' : 'div';
          return (
            <Tag key={i} {...(t.url ? { href: t.url, target: '_blank', rel: 'noopener' } : {})}
                 className="block rounded p-2 border transition-colors hover:bg-white/[0.04]"
                 style={{ background: COLORS.bg, borderColor: COLORS.border, borderLeft: `3px solid ${sentColor}`, textDecoration: 'none' }}>
              <div className="flex items-center justify-between text-[9px] uppercase tracking-wider mb-1">
                <span className="truncate" style={{ color: COLORS.textMute }}>{t.src} · {t.ts}</span>
                <span style={{ color: sentColor }}>{sentIcon} {t.sentiment.toUpperCase()}</span>
              </div>
              <div className="text-[11px] leading-snug" style={{ color: COLORS.text }}>
                {t.headline}
              </div>
            </Tag>
          );
        })}
      </div>
    </div>
  );
};

// Portfolio mini — pie + key stats. Mirrors the look of the full
// Portfolio page (header strip + pie + position rows) so the user
// sees a familiar layout when this widget is in the trade page.
export const PortfolioMini = ({ account }) => {
  const positions = account?.positions ?? [];
  const totalEquity = (account?.balance ?? 0)
    + positions.reduce((s, p) => s + Math.abs((p.size ?? 0) * (p.entry ?? 1)), 0);
  const dayPnL = account?.unrealizedPnl ?? 0;
  const COLORS_PALETTE = ['#7AC8FF', '#FF9CDB', '#7BFFB5', '#FFD050', '#FF8855', '#A0C476', '#E07AFC'];
  const data = positions.length === 0
    ? [{ name: 'Cash', value: 1, fill: COLORS.mint }]
    : positions.slice(0, 5).map((p, i) => ({
        name: p.instrument?.id ?? `Pos ${i+1}`,
        value: Math.abs((p.size ?? 0) * (p.entry ?? 1)),
        fill: COLORS_PALETTE[i % COLORS_PALETTE.length],
      }));
  // Itemized list — every position with size, entry, current PnL
  const itemized = positions.map((p, i) => {
    const value = Math.abs((p.size ?? 0) * (p.entry ?? 1));
    const pnl = (p.unrealizedPnl ?? 0);
    return {
      ticker: p.instrument?.id ?? `Pos ${i+1}`,
      side: p.side ?? '—',
      size: p.size ?? 0,
      entry: p.entry ?? 0,
      value,
      pnl,
      pnlPct: value > 0 ? (pnl / value) * 100 : 0,
      fill: COLORS_PALETTE[i % COLORS_PALETTE.length],
    };
  });
  return (
    <div className="h-full flex flex-col p-2.5">
      {/* Header strip — total equity + day PnL */}
      <div className="flex items-center justify-between mb-2 pb-2 border-b shrink-0" style={{ borderColor: COLORS.border }}>
        <div>
          <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Equity</div>
          <div className="text-[14px] tabular-nums font-medium" style={{ color: COLORS.text }}>
            ${totalEquity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Today</div>
          <div className="text-[12px] tabular-nums font-medium" style={{ color: dayPnL >= 0 ? COLORS.green : COLORS.red }}>
            {dayPnL >= 0 ? '+' : ''}${dayPnL.toFixed(2)}
          </div>
        </div>
      </div>
      {/* Pie + legend (top, fixed height) */}
      <div className="grid grid-cols-2 gap-2 items-center shrink-0" style={{ height: 100 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius="40%" outerRadius="80%" isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-col justify-center space-y-1">
          {data.slice(0, 5).map((d, i) => (
            <div key={i} className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: d.fill }} />
                <span className="truncate" style={{ color: COLORS.text }}>{d.name}</span>
              </div>
              <span className="tabular-nums shrink-0" style={{ color: COLORS.textDim }}>
                ${(d.value / 1000).toFixed(1)}K
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* Itemized list — full positions table under the pie. Scrollable so
          users can see every position regardless of widget height. */}
      {itemized.length > 0 && (
        <div className="mt-2 pt-2 border-t flex-1 min-h-0 overflow-y-auto"
             style={{ borderColor: COLORS.border }}>
          <div className="text-[9px] uppercase tracking-wider mb-1 sticky top-0 z-10 px-0.5"
               style={{ color: COLORS.textMute, background: COLORS.surface }}>
            Positions ({itemized.length})
          </div>
          <div className="space-y-1">
            {itemized.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] py-0.5">
                <div className="w-1 h-3 rounded-sm shrink-0" style={{ background: p.fill }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium" style={{ color: COLORS.text }}>{p.ticker}</span>
                    <span className="text-[8.5px] px-1 py-0.5 rounded uppercase tracking-wider"
                          style={{
                            background: p.side === 'long' ? 'rgba(31,178,107,0.14)' : 'rgba(237,112,136,0.14)',
                            color: p.side === 'long' ? COLORS.green : COLORS.red,
                          }}>{p.side}</span>
                  </div>
                  <div className="text-[8.5px] tabular-nums" style={{ color: COLORS.textMute }}>
                    {Number(p.size).toFixed(4)} @ ${Number(p.entry).toFixed(2)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="tabular-nums" style={{ color: p.pnl >= 0 ? COLORS.green : COLORS.red }}>
                    {p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}
                  </div>
                  <div className="text-[8.5px] tabular-nums" style={{ color: COLORS.textMute }}>
                    {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {positions.length === 0 && (
        <div className="mt-2 pt-2 border-t flex-1 flex items-center justify-center text-[10px]"
             style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
          No open positions — open Trade to start
        </div>
      )}
    </div>
  );
};

// CalendarMini — compact monthly grid that shares the same notes +
// trades-by-day storage as the full CalendarPanel on the Portfolio
// page. Tapping a day opens an inline note editor; the full calendar
// page can be reached via the Portfolio link.
export const CalendarMini = ({ account, user }) => {
  const STORAGE_KEY = `imo_calendar_${user?.username ?? 'guest'}`;
  const [notes, setNotes] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selectedKey, setSelectedKey] = useState(null);
  const [draftNote, setDraftNote] = useState('');
  const persistNotes = (next) => {
    setNotes(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  };
  // Trades-by-day so each cell can show a green/red dot if there were
  // realized trades that day.
  const tradesByDay = useMemo(() => {
    const map = {};
    (account?.trades ?? []).forEach(t => {
      const ts = t.ts ?? t.closedAt;
      if (!ts) return;
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    return map;
  }, [account?.trades]);
  // Upcoming market events keyed by day so the mini calendar can surface
  // earnings, FOMC, CPI, and other market-relevant dates as ghost dots.
  // FINANCIAL_EVENTS is declared later in the file but is in scope at
  // render time; the typeof guard keeps the component safe in the rare
  // case it's mounted before that array is defined.
  const eventsByDay = useMemo(() => {
    const map = {};
    const events = (typeof FINANCIAL_EVENTS !== 'undefined') ? FINANCIAL_EVENTS : [];
    events.forEach(ev => {
      if (!ev?.date) return;
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    });
    return map;
  }, []);
  // Custom user-added events from CalendarPanel. Same storage key shape
  // so notes, custom events, and the full calendar stay in sync.
  const customEventsKey = `imo_custom_events_${user?.username ?? 'guest'}`;
  const customEvents = useMemo(() => {
    try {
      const raw = localStorage.getItem(customEventsKey);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  // Re-read on month nav so newly added events show up without a remount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor.year, cursor.month, customEventsKey]);
  // Per-event-type accent colors mirroring CalendarPanel's EVENT_TYPE_STYLES.
  const eventAccent = (type) => {
    switch (type) {
      case 'earnings': return '#A0C476';
      case 'fomc':     return '#7AC8FF';
      case 'econ':     return '#FFB84D';
      case 'tax':      return '#FF7AB6';
      case 'opex':     return '#E07AFC';
      case 'holiday':  return '#888';
      default:         return COLORS.textDim;
    }
  };
  // Build calendar grid for current month
  const grid = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const last = new Date(cursor.year, cursor.month + 1, 0);
    const days = [];
    const startDay = first.getDay();
    for (let i = 0; i < startDay; i++) days.push(null);
    for (let d = 1; d <= last.getDate(); d++) {
      days.push({
        day: d,
        key: `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      });
    }
    return days;
  }, [cursor]);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const saveDraft = () => {
    if (!selectedKey) return;
    const next = { ...notes };
    if (draftNote.trim()) next[selectedKey] = draftNote.trim();
    else delete next[selectedKey];
    persistNotes(next);
    setSelectedKey(null);
    setDraftNote('');
  };
  return (
    <div className="h-full flex flex-col p-2.5">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <button onClick={() => setCursor(c => ({
                  year: c.month === 0 ? c.year - 1 : c.year,
                  month: c.month === 0 ? 11 : c.month - 1,
                }))}
                className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/[0.04]"
                style={{ color: COLORS.textDim }}
                title="Previous month">‹</button>
        <span className="text-[11px] font-medium" style={{ color: COLORS.text }}>{monthLabel}</span>
        <button onClick={() => setCursor(c => ({
                  year: c.month === 11 ? c.year + 1 : c.year,
                  month: c.month === 11 ? 0 : c.month + 1,
                }))}
                className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/[0.04]"
                style={{ color: COLORS.textDim }}
                title="Next month">›</button>
      </div>
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-0.5 mb-0.5 shrink-0">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className="text-center text-[8.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>{d}</div>
        ))}
      </div>
      {/* Grid */}
      <div className="grid grid-cols-7 gap-0.5 flex-1 min-h-0 overflow-y-auto">
        {grid.map((cell, i) => {
          if (!cell) return <div key={i} />;
          const hasNote = !!notes[cell.key];
          const dayTrades = tradesByDay[cell.key] ?? [];
          const isToday = cell.key === todayKey;
          const dayPnl = dayTrades.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
          // Combined event list — built-in financial events plus any
          // custom events the user added on the full Calendar page. We
          // de-dupe by label so the same earnings entered twice doesn't
          // produce two dots.
          const builtinEvents = eventsByDay[cell.key] ?? [];
          const userEvents = customEvents[cell.key] ?? [];
          const dayEvents = [...builtinEvents, ...userEvents];
          // Tooltip combines notes, trade count, and event labels into a
          // single multi-line string so users can read the day's context
          // without clicking.
          const tooltipLines = [];
          if (hasNote) tooltipLines.push(`📝 ${notes[cell.key]}`);
          if (dayTrades.length > 0) {
            const sign = dayPnl >= 0 ? '+' : '';
            tooltipLines.push(`${dayTrades.length} trade${dayTrades.length === 1 ? '' : 's'} · ${sign}$${dayPnl.toFixed(2)}`);
          }
          dayEvents.forEach(ev => {
            const label = ev.label ?? ev.title ?? '';
            const tk = ev.ticker ? ` (${ev.ticker})` : '';
            tooltipLines.push(`• ${label}${tk}`);
          });
          // Up to two event dots per cell so we don't crowd small tiles
          // when several things happen the same day. The +N badge below
          // signals overflow.
          const visibleEventDots = dayEvents.slice(0, 2);
          const overflow = Math.max(0, dayEvents.length - visibleEventDots.length);
          return (
            <button key={i}
                    onClick={() => { setSelectedKey(cell.key); setDraftNote(notes[cell.key] ?? ''); }}
                    className="relative rounded text-[10px] flex flex-col items-center justify-center transition-colors hover:bg-white/[0.05]"
                    style={{
                      aspectRatio: '1 / 1',
                      background: isToday ? 'rgba(30,58,108,0.18)' : 'transparent',
                      border: isToday ? `1px solid ${COLORS.mint}` : `1px solid ${COLORS.border}`,
                      color: COLORS.text,
                    }}
                    title={tooltipLines.join('\n') || ''}>
              <span className="tabular-nums">{cell.day}</span>
              {/* P/L pill — when the day had trades, surface the realized
                  P/L as a tiny tabular pill at the top-right of the cell.
                  Green when up, red when down, with a leading + or − sign.
                  Sits absolutely so it doesn't disrupt the day-number
                  baseline. The dot in the bottom strip stays as a tertiary
                  "did anything happen here" hint. */}
              {dayTrades.length > 0 && (
                <span className="absolute top-0.5 right-0.5 px-1 rounded tabular-nums font-medium"
                      style={{
                        fontSize: 8,
                        lineHeight: 1.2,
                        background: dayPnl >= 0 ? 'rgba(31,178,107,0.16)' : 'rgba(237,112,136,0.16)',
                        color: dayPnl >= 0 ? COLORS.green : COLORS.red,
                      }}>
                  {dayPnl >= 0 ? '+' : '−'}${Math.abs(dayPnl) >= 1000
                    ? `${(Math.abs(dayPnl)/1000).toFixed(1)}k`
                    : Math.abs(dayPnl).toFixed(0)}
                </span>
              )}
              <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5 items-center">
                {hasNote && <div style={{ width: 3, height: 3, borderRadius: '50%', background: COLORS.mint }} />}
                {dayTrades.length > 0 && (
                  <div style={{
                    width: 3, height: 3, borderRadius: '50%',
                    background: dayPnl >= 0 ? COLORS.green : COLORS.red,
                  }} />
                )}
                {/* Ghost event dots — slightly translucent so they're
                    distinguishable from the user's own notes/trades. */}
                {visibleEventDots.map((ev, k) => (
                  <div key={`ev${k}`} style={{
                    width: 3, height: 3, borderRadius: '50%',
                    background: eventAccent(ev.type),
                    opacity: 0.75,
                  }} />
                ))}
                {overflow > 0 && (
                  <span style={{ fontSize: 7, color: COLORS.textMute, marginLeft: 1 }}>
                    +{overflow}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {/* Note editor */}
      {selectedKey && (
        <div className="mt-2 pt-2 border-t shrink-0" style={{ borderColor: COLORS.border }}>
          <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
            Note · {selectedKey}
          </div>
          {/* Event chips for the selected day — read-only summary so users
              know what's already on this day before adding a personal note. */}
          {(() => {
            const dayEvents = [...(eventsByDay[selectedKey] ?? []), ...(customEvents[selectedKey] ?? [])];
            if (dayEvents.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {dayEvents.map((ev, k) => (
                  <span key={k}
                        className="px-1.5 py-0.5 text-[9px] rounded-full inline-flex items-center gap-1"
                        style={{
                          background: `${eventAccent(ev.type)}22`,
                          color: eventAccent(ev.type),
                          border: `1px solid ${eventAccent(ev.type)}55`,
                        }}>
                    <span style={{ width: 4, height: 4, borderRadius: '50%', background: eventAccent(ev.type) }} />
                    {(ev.label ?? ev.title ?? '').slice(0, 32)}
                    {ev.ticker ? ` · ${ev.ticker}` : ''}
                  </span>
                ))}
              </div>
            );
          })()}
          <textarea value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveDraft(); }}
                    placeholder="Add a note for this day…"
                    rows={2}
                    className="w-full px-2 py-1 text-[10.5px] rounded outline-none resize-none"
                    style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
          <div className="flex justify-end gap-1.5 mt-1">
            <button onClick={() => { setSelectedKey(null); setDraftNote(''); }}
                    className="px-2 py-0.5 text-[10px] rounded hover:bg-white/[0.04]"
                    style={{ color: COLORS.textDim }}>
              Cancel
            </button>
            <button onClick={saveDraft}
                    className="px-2 py-0.5 text-[10px] rounded font-medium"
                    style={{ background: COLORS.mint, color: '#FFF' }}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// SwapMini — instrument-to-instrument swap widget. Mirrors the swap
// section of the Deposit modal: pick a source asset, target asset,
// and amount; the widget shows a quote and a Swap button. Uses the
// same INSTRUMENTS list and account balance the Deposit modal uses.
//
// Live execution: when the executor backend is online, the Swap button
// hits POST /swap which routes through the configured broker (paper /
// alpaca / bitget). When the backend is offline, the widget falls back
// to a paper notification so the UX remains usable in demo mode.
export const SwapMini = ({ account, instrument }) => {
  // Default the From side to whatever instrument the user is viewing
  // and the To side to USD (the most common quote). Users can swap
  // with the ⇅ button.
  const [fromId, setFromId] = useState(instrument?.id ?? 'BTC-PERP');
  const [toId, setToId] = useState('USD');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState(null);
  // Submitting flag debounces the Swap button while the executor call
  // is in flight; lastFill carries the most recent successful response
  // so we can show fill details inline.
  const [submitting, setSubmitting] = useState(false);
  const [lastFill, setLastFill] = useState(null);
  // Track executor connectivity so the button label can flip between
  // "Swap" (live) and "Swap (demo)" (paper-only). We poll the
  // backend-status event the App layer dispatches whenever it
  // re-checks /health on each backend.
  const [executorOnline, setExecutorOnline] = useState(() => {
    try { return window.__imoBackend?.status?.executor === 'connected'; }
    catch { return false; }
  });
  useEffect(() => {
    const sync = () => {
      try { setExecutorOnline(window.__imoBackend?.status?.executor === 'connected'); }
      catch { setExecutorOnline(false); }
    };
    sync();
    window.addEventListener('imo:backend-status', sync);
    return () => window.removeEventListener('imo:backend-status', sync);
  }, []);
  // Build a flat list of swap-eligible instruments. Includes USD as a
  // pseudo-asset so users can convert between fiat and crypto/equities.
  const swapAssets = useMemo(() => {
    const base = (typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS : [])
      .filter(i => i?.id && i.cls !== 'index')
      .map(i => ({ id: i.id, label: `${i.id}`, sublabel: i.cls, mark: i.mark ?? 1 }));
    return [{ id: 'USD', label: 'USD', sublabel: 'cash', mark: 1 }, ...base];
  }, []);
  const fromAsset = swapAssets.find(a => a.id === fromId) ?? swapAssets[0];
  const toAsset = swapAssets.find(a => a.id === toId) ?? swapAssets[1];
  const amtNum = Number(amount) || 0;
  // Implied conversion rate based on market prices. USD ↔ asset uses
  // the asset's mark; asset ↔ asset uses ratio of marks. A small spread
  // is applied so the widget doesn't look like a free arbitrage.
  const fromMark = fromAsset?.mark ?? 1;
  const toMark = toAsset?.mark ?? 1;
  const rate = (fromAsset?.id === 'USD') ? (1 / toMark) : (toAsset?.id === 'USD') ? fromMark : (fromMark / toMark);
  const spread = 0.002;
  const effectiveRate = rate * (1 - spread);
  const expectedOut = amtNum * effectiveRate;
  const swapDirection = () => {
    setFromId(toId);
    setToId(fromId);
    setAmount('');
    setError(null);
    setLastFill(null);
  };
  const submit = async () => {
    if (!amtNum || amtNum <= 0) { setError('Enter an amount'); return; }
    if (fromId === toId) { setError('Pick different assets'); return; }
    setError(null);
    setSubmitting(true);
    try {
      const be = (typeof window !== 'undefined') ? window.__imoBackend : null;
      if (executorOnline && be?.post) {
        // Live path — the executor places paired sell/buy orders via
        // the configured broker. We pass the client-computed effective
        // rate so the server uses the same number we just showed.
        const r = await be.post('executor', '/swap', {
          from: fromId, to: toId, amount: amtNum, expectedRate: effectiveRate,
        });
        if (r?.ok) {
          setLastFill({
            from: fromId, to: toId, amount: amtNum,
            received: r.received ?? expectedOut,
            broker: r.broker, ts: r.ts,
          });
          window.imoToast?.(`Swapped ${amtNum.toFixed(4)} ${fromId} → ${(r.received ?? expectedOut).toFixed(4)} ${toId} via ${r.broker ?? 'broker'}`, 'success');
          setAmount('');
        } else {
          // Backend returned an error envelope.
          const msg = r?.error || 'swap rejected';
          setError(msg);
          window.imoToast?.(`Swap failed: ${msg}`, 'error');
        }
      } else {
        // Demo path — same UX, no backend hit. Surfaces clearly so users
        // know they're in paper mode.
        window.imoToast?.(`Swap (demo): ${amtNum.toFixed(4)} ${fromId} → ${expectedOut.toFixed(4)} ${toId}`, 'success');
        setLastFill({
          from: fromId, to: toId, amount: amtNum,
          received: expectedOut, broker: 'paper-local', ts: Date.now(),
        });
        setAmount('');
      }
    } catch (err) {
      const msg = err?.message || 'swap failed';
      setError(msg);
      window.imoToast?.(`Swap failed: ${msg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="h-full flex flex-col p-3 gap-2">
      <div className="flex items-center justify-between shrink-0">
        <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
          Instant swap
        </div>
        {/* Connection pill — green dot when executor is reachable, dim
            when we'll fall back to demo mode. */}
        <div className="flex items-center gap-1 text-[9px]" style={{ color: COLORS.textMute }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: executorOnline ? COLORS.green : COLORS.textMute,
            boxShadow: executorOnline ? `0 0 6px ${COLORS.green}` : 'none',
          }} />
          {executorOnline ? 'live' : 'demo'}
        </div>
      </div>
      {/* From side */}
      <div className="rounded-lg p-2.5 border shrink-0"
           style={{ background: COLORS.bg, borderColor: COLORS.border }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>From</span>
          <span className="text-[9px] tabular-nums" style={{ color: COLORS.textMute }}>
            ≈ ${(amtNum * fromMark).toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select value={fromId}
                  onChange={e => setFromId(e.target.value)}
                  className="px-2 py-1 text-[11px] rounded outline-none shrink-0"
                  style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
            {swapAssets.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <input type="number" value={amount}
                 onChange={e => { setAmount(e.target.value); setError(null); }}
                 placeholder="0.00"
                 className="flex-1 min-w-0 px-2 py-1 text-[14px] rounded outline-none tabular-nums text-right"
                 style={{ background: 'transparent', color: COLORS.text, border: 'none' }} />
        </div>
      </div>
      {/* Direction toggle */}
      <div className="flex justify-center shrink-0 -my-1 relative z-10">
        <button onClick={swapDirection}
                className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-110"
                style={{ background: COLORS.surface, border: `1px solid ${COLORS.borderHi}`, color: COLORS.mint }}
                title="Reverse direction">
          ⇅
        </button>
      </div>
      {/* To side */}
      <div className="rounded-lg p-2.5 border shrink-0"
           style={{ background: COLORS.bg, borderColor: COLORS.border }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>To</span>
          <span className="text-[9px] tabular-nums" style={{ color: COLORS.textMute }}>
            ≈ ${(expectedOut * toMark).toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select value={toId}
                  onChange={e => setToId(e.target.value)}
                  className="px-2 py-1 text-[11px] rounded outline-none shrink-0"
                  style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
            {swapAssets.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <span className="flex-1 text-right text-[14px] tabular-nums"
                style={{ color: amtNum ? COLORS.text : COLORS.textMute }}>
            {amtNum ? expectedOut.toFixed(4) : '—'}
          </span>
        </div>
      </div>
      {/* Rate row */}
      <div className="flex items-center justify-between text-[9.5px] shrink-0" style={{ color: COLORS.textMute }}>
        <span>Rate · 1 {fromId} = {effectiveRate.toFixed(6)} {toId}</span>
        <span>spread {(spread * 100).toFixed(2)}%</span>
      </div>
      {error && (
        <div className="text-[10px]" style={{ color: COLORS.red }}>{error}</div>
      )}
      {/* Last fill chip — shows above the button after a successful swap
          so users see confirmation without losing the input form. */}
      {lastFill && !error && (
        <div className="text-[9.5px] rounded px-2 py-1 shrink-0"
             style={{ background: 'rgba(122,200,118,0.08)', color: COLORS.green, border: `1px solid ${COLORS.green}33` }}>
          ✓ {lastFill.amount.toFixed(4)} {lastFill.from} → {lastFill.received.toFixed(4)} {lastFill.to}
          <span style={{ color: COLORS.textMute, marginLeft: 6 }}>
            via {lastFill.broker}
          </span>
        </div>
      )}
      <button onClick={submit}
              disabled={!amtNum || fromId === toId || submitting}
              className="mt-auto w-full py-2 rounded-lg text-[12px] font-medium transition-all disabled:opacity-40"
              style={{ background: COLORS.mint, color: '#FFF' }}>
        {submitting ? 'Swapping…' : (executorOnline ? 'Swap' : 'Swap (demo)')}
      </button>
    </div>
  );
};

// Autopilot mini — strategy cards with allocation, return, max drawdown,
// and an "Activate" button mirroring the full Autopilot page layout.
// When the executor backend is available, replaces the hardcoded strategies
// with real ones from /strategies and wires Auto-execute + Run safety check.
export const AutopilotMini = ({ user, account, onOpenPosition }) => {
  const userId = user?.username || 'default';
  const [backendStrategies, setBackendStrategies] = useState(null);
  const [safetyModal, setSafetyModal] = useState(null); // { strategy, result, loading, error }
  const [running, setRunning] = useState({});
  // Pull from executor when available; otherwise use the demo strategies.
  useEffect(() => {
    let cancelled = false;
    const fetchBe = async () => {
      const be = window.__imoBackend;
      if (!be?.urls?.executor || be?.status?.executor !== 'connected') {
        setBackendStrategies(null);
        return;
      }
      try {
        const r = await be.get('executor', `/strategies?user_id=${encodeURIComponent(userId)}`);
        if (!cancelled) setBackendStrategies(r.strategies || []);
      } catch {
        if (!cancelled) setBackendStrategies(null);
      }
    };
    fetchBe();
    const handler = () => fetchBe();
    window.addEventListener('imo:backend-status', handler);
    return () => { cancelled = true; window.removeEventListener('imo:backend-status', handler); };
  }, [userId]);

  const demoStrategies = [
    { name: 'Momentum Index', return: '+18.4%', dd: '-7.2%',  risk: 'Med',  active: true,  alloc: 35 },
    { name: 'Yield Hunter',   return: '+9.1%',  dd: '-2.1%',  risk: 'Low',  active: false, alloc: 0 },
    { name: 'Volatility Edge',return: '+24.7%', dd: '-15.3%', risk: 'High', active: false, alloc: 0 },
    { name: 'Macro Swing',    return: '+12.3%', dd: '-5.8%',  risk: 'Med',  active: true,  alloc: 25 },
  ];

  const runSafetyCheck = async (strategy) => {
    const be = window.__imoBackend;
    if (!be) return;
    setSafetyModal({ strategy, loading: true });
    try {
      const r = await be.post('executor', `/strategies/${strategy.id}/safety-check`, {});
      setSafetyModal({ strategy, result: r });
    } catch (e) {
      setSafetyModal({ strategy, error: e.message });
    }
  };

  const toggleAuto = async (strategy) => {
    const be = window.__imoBackend;
    if (!be) return;
    try {
      await be.post('executor', `/strategies/${strategy.id}/enable-auto`, {
        enabled: !strategy.auto_execute,
      });
      // refresh
      const r = await be.get('executor', `/strategies?user_id=${encodeURIComponent(userId)}`);
      setBackendStrategies(r.strategies || []);
    } catch (e) {
      console.warn('[strategies] toggleAuto failed:', e.message);
    }
  };

  const runNow = async (strategy) => {
    const be = window.__imoBackend;
    if (!be) return;
    setRunning(r => ({ ...r, [strategy.id]: true }));
    try {
      await be.post('executor', `/strategies/${strategy.id}/run`, { force: false });
    } catch (e) {
      console.warn('[strategies] run failed:', e.message);
    } finally {
      setRunning(r => ({ ...r, [strategy.id]: false }));
    }
  };

  // Backend mode — render real strategies from the executor
  if (backendStrategies !== null) {
    const totalActive = backendStrategies.filter(s => s.enabled && s.auto_execute).length;
    return (
      <div className="h-full flex flex-col p-2.5">
        <div className="flex items-center justify-between mb-2 pb-2 border-b shrink-0" style={{ borderColor: COLORS.border }}>
          <div>
            <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Active</div>
            <div className="text-[13px] tabular-nums font-medium" style={{ color: COLORS.text }}>
              {totalActive} / {backendStrategies.length}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Source</div>
            <div className="text-[10px] font-medium" style={{ color: COLORS.green }}>EXECUTOR</div>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
          {backendStrategies.length === 0 && (
            <div className="text-center py-6 text-[11px]" style={{ color: COLORS.textMute }}>
              No strategies yet. Create one via POST /strategies on the executor.
            </div>
          )}
          {backendStrategies.map(s => (
            <div key={s.id} className="rounded p-2 border"
                 style={{
                   background: COLORS.bg,
                   borderColor: s.auto_execute ? COLORS.mint : COLORS.border,
                   borderLeftWidth: s.auto_execute ? 3 : 1,
                 }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium truncate flex-1" style={{ color: COLORS.text }}>{s.name}</span>
                <span className="text-[9px] ml-2" style={{ color: COLORS.textMute }}>
                  {s.symbol} · {s.interval}
                </span>
              </div>
              <div className="flex items-center justify-between text-[9.5px] mb-1.5" style={{ color: COLORS.textMute }}>
                <span>{s.entry_rules?.length || 0} rules</span>
                <span style={{ color: s.enabled ? COLORS.green : COLORS.textMute }}>
                  {s.enabled ? 'enabled' : 'disabled'}
                </span>
              </div>
              <div className="flex gap-1">
                <button onClick={() => runSafetyCheck(s)}
                        className="flex-1 px-2 py-1 rounded text-[10px] transition-colors hover:bg-white/[0.04]"
                        style={{ color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                        title="Evaluate every entry condition without executing">
                  Safety check
                </button>
                <button onClick={() => toggleAuto(s)}
                        className="px-2 py-1 rounded text-[10px] font-medium transition-colors"
                        style={{
                          background: s.auto_execute ? COLORS.mint : 'transparent',
                          color: s.auto_execute ? '#FFF' : COLORS.text,
                          border: `1px solid ${s.auto_execute ? COLORS.mint : COLORS.border}`,
                        }}>
                  {s.auto_execute ? 'Auto on' : 'Auto off'}
                </button>
                <button onClick={() => runNow(s)}
                        disabled={running[s.id]}
                        className="px-2 py-1 rounded text-[10px] transition-colors hover:bg-white/[0.04]"
                        style={{ color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                        title="Run safety check + execute if all conditions pass and auto is on">
                  {running[s.id] ? '…' : 'Run'}
                </button>
              </div>
            </div>
          ))}
        </div>
        {safetyModal && (
          <SafetyCheckModal data={safetyModal} onClose={() => setSafetyModal(null)} />
        )}
      </div>
    );
  }

  // Demo mode — show real AUTOPILOT_STRATEGIES so users can interact
  // (select, copy into positions) the same way as the full Autopilot
  // page. Previously this used a placeholder demoStrategies list with
  // no actions, which made the widget look like data but do nothing.
  // Now it mirrors the full page's UX in compact form: pick a strategy,
  // see its allocation and risk metrics, and click Copy to open
  // positions matching that strategy's holdings (weighted by portfolio
  // size or by an explicit USD amount).
  const strategies = (typeof AUTOPILOT_STRATEGIES !== 'undefined') ? AUTOPILOT_STRATEGIES : [];
  const [selectedId, setSelectedId] = useState(strategies[0]?.id);
  const [copyAmount, setCopyAmount] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(null);
  const selected = strategies.find(s => s.id === selectedId) ?? strategies[0];
  const balance = account?.balance ?? 0;
  const handleCopy = async () => {
    if (!selected) return;
    const amt = parseFloat(copyAmount);
    if (!amt || amt <= 0) {
      setCopyFeedback({ ok: false, msg: 'Enter an amount' });
      return;
    }
    if (amt > balance && balance > 0) {
      setCopyFeedback({ ok: false, msg: 'Insufficient balance' });
      return;
    }
    if (typeof onOpenPosition !== 'function') {
      setCopyFeedback({ ok: false, msg: 'Open positions disabled' });
      return;
    }
    // Sequence the opens so the safety gate can prompt for each in
    // order rather than firing them in parallel and losing the
    // ability to count what actually went through.
    let opened = 0;
    let blocked = 0;
    for (const h of selected.holdings) {
      const inst = (typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS : []).find(i => i.id === h.ticker);
      if (!inst) continue;
      const usd = amt * (h.weight / 100);
      const size = usd / (inst.mark || 1);
      try {
        const r = await Promise.resolve(onOpenPosition({
          instrument: inst,
          side: 'buy',
          size,
          leverage: 1,
          entryPrice: inst.mark,
        }));
        if (r && r.ok === false) blocked++;
        else opened++;
      } catch {
        blocked++;
      }
    }
    setCopyFeedback({
      ok: opened > 0,
      msg: blocked > 0 ? `${opened} opened, ${blocked} blocked` : `Copied · ${opened} positions opened`,
    });
    setCopyAmount('');
    setTimeout(() => setCopyFeedback(null), 4000);
  };
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex items-center justify-between mb-2 pb-2 border-b shrink-0" style={{ borderColor: COLORS.border }}>
        <div>
          <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Strategies</div>
          <div className="text-[13px] tabular-nums font-medium" style={{ color: COLORS.text }}>
            {strategies.length}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Selected return</div>
          <div className="text-[12px] tabular-nums font-medium" style={{ color: COLORS.green }}>
            {selected ? `+${selected.return1y.toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>
      {/* Strategy picker — horizontally scrollable strip mirroring the
          Autopilot page's selection UI in compact form. */}
      <div className="flex gap-1 overflow-x-auto imo-thin-scrollbar pb-1.5 mb-1.5 shrink-0">
        {strategies.map(s => {
          const active = s.id === selectedId;
          return (
            <button key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className="px-2 py-1 rounded text-[10px] whitespace-nowrap transition-colors shrink-0"
                    style={{
                      background: active ? `${COLORS.mint}1F` : COLORS.surface,
                      color: active ? COLORS.mint : COLORS.textDim,
                      border: `1px solid ${active ? COLORS.mint : COLORS.border}`,
                    }}>
              {s.avatar ?? s.name.slice(0, 2)} · {s.name.split('(')[0].trim().slice(0, 18)}
            </button>
          );
        })}
      </div>
      {selected && (
        <>
          {/* Compact metrics row */}
          <div className="grid grid-cols-3 gap-1 mb-2 shrink-0">
            <div className="rounded p-1.5 border" style={{ background: COLORS.bg, borderColor: COLORS.border }}>
              <div className="text-[8.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>1y</div>
              <div className="text-[10.5px] tabular-nums font-medium" style={{ color: COLORS.green }}>+{selected.return1y.toFixed(1)}%</div>
            </div>
            <div className="rounded p-1.5 border" style={{ background: COLORS.bg, borderColor: COLORS.border }}>
              <div className="text-[8.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Sharpe</div>
              <div className="text-[10.5px] tabular-nums font-medium" style={{ color: COLORS.text }}>{selected.sharpe.toFixed(2)}</div>
            </div>
            <div className="rounded p-1.5 border" style={{ background: COLORS.bg, borderColor: COLORS.border }}>
              <div className="text-[8.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Max DD</div>
              <div className="text-[10.5px] tabular-nums font-medium" style={{ color: COLORS.red }}>-{selected.maxDD.toFixed(1)}%</div>
            </div>
          </div>
          {/* Holdings preview — top 4 by weight */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
            {selected.holdings.slice(0, 5).map(h => (
              <div key={h.ticker} className="flex items-center justify-between text-[10px] px-1.5 py-1 rounded"
                   style={{ background: COLORS.bg }}>
                <span style={{ color: COLORS.text }}>{h.ticker}</span>
                <span className="tabular-nums" style={{ color: COLORS.textDim }}>{h.weight}%</span>
              </div>
            ))}
            {selected.holdings.length > 5 && (
              <div className="text-[9px] text-center pt-0.5" style={{ color: COLORS.textMute }}>
                +{selected.holdings.length - 5} more holdings
              </div>
            )}
          </div>
          {/* Copy interaction — same handler logic as the full
              AutopilotPanel: enter USD, opens weighted positions. */}
          <div className="mt-2 pt-2 border-t shrink-0 space-y-1.5" style={{ borderColor: COLORS.border }}>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] tabular-nums" style={{ color: COLORS.textMute }}>$</span>
              <input type="number" value={copyAmount}
                     onChange={e => { setCopyAmount(e.target.value); setCopyFeedback(null); }}
                     placeholder="Amount"
                     className="flex-1 min-w-0 px-1.5 py-1 text-[10.5px] rounded outline-none tabular-nums"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              <button onClick={handleCopy}
                      className="px-2 py-1 rounded text-[10px] font-medium transition-all"
                      style={{ background: COLORS.mint, color: '#FFF' }}
                      title={`Copy ${selected.name} into positions`}>
                Copy
              </button>
            </div>
            {copyFeedback && (
              <div className="text-[9.5px]"
                   style={{ color: copyFeedback.ok ? COLORS.green : COLORS.red }}>
                {copyFeedback.ok ? '✓ ' : '! '}{copyFeedback.msg}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// Modal showing the structured safety-check result from the executor.
// Lists every entry condition with its expected expression, actual value,
// and pass/fail status.
export const SafetyCheckModal = ({ data, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.7)' }}
         onClick={onClose}>
      <div className="rounded-lg max-w-[640px] w-full max-h-[80vh] overflow-auto"
           style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b sticky top-0"
             style={{ background: COLORS.surface, borderColor: COLORS.border }}>
          <div className="text-[10.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
            Safety check
          </div>
          <div className="text-[16px] font-medium mt-0.5" style={{ color: COLORS.text }}>
            {data.strategy?.name}
          </div>
          {data.result && (
            <div className="mt-2 inline-flex items-center gap-2 px-2.5 py-1 rounded text-[11px] font-medium"
                 style={{
                   background: data.result.decision === 'executed' ? 'rgba(31,178,107,0.1)'
                             : data.result.decision === 'blocked'  ? 'rgba(237,112,136,0.1)'
                             : 'rgba(255,184,77,0.1)',
                   color: data.result.decision === 'executed' ? COLORS.green
                        : data.result.decision === 'blocked'  ? COLORS.red
                        : '#FFB84D',
                 }}>
              {data.result.decision} {data.result.blocker && `· ${data.result.blocker}`}
            </div>
          )}
        </div>
        <div className="p-5">
          {data.loading && (
            <div className="text-center py-8 text-[12px]" style={{ color: COLORS.textMute }}>
              Running safety check…
            </div>
          )}
          {data.error && (
            <div className="text-[12px] py-4" style={{ color: COLORS.red }}>
              Error: {data.error}
            </div>
          )}
          {data.result?.safety_check?.conditions && (
            <div className="space-y-2">
              <div className="text-[10.5px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                Conditions ({data.result.safety_check.conditions.length})
              </div>
              {data.result.safety_check.conditions.map((c, i) => (
                <div key={i} className="rounded p-3 border"
                     style={{
                       background: COLORS.bg,
                       borderColor: c.passed ? COLORS.green : COLORS.red,
                       borderLeftWidth: 3,
                     }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12.5px] font-medium" style={{ color: COLORS.text }}>{c.name}</span>
                    <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded"
                          style={{
                            background: c.passed ? 'rgba(31,178,107,0.15)' : 'rgba(237,112,136,0.15)',
                            color: c.passed ? COLORS.green : COLORS.red,
                          }}>
                      {c.passed ? '✓ PASS' : '✗ FAIL'}
                    </span>
                  </div>
                  {c.expr && (
                    <div className="text-[10.5px] font-mono mt-1.5 px-2 py-1 rounded"
                         style={{ background: COLORS.surface2, color: COLORS.textDim }}>
                      {c.expr}
                    </div>
                  )}
                  <div className="text-[11px] mt-1.5" style={{ color: COLORS.textMute }}>
                    Actual: <span style={{ color: COLORS.text }}>{
                      typeof c.actualValue === 'number' ? c.actualValue.toFixed(4) :
                      typeof c.actualValue === 'boolean' ? String(c.actualValue) :
                      typeof c.actualValue === 'string' ? c.actualValue :
                      JSON.stringify(c.actualValue)
                    }</span>
                  </div>
                  {c.error && (
                    <div className="text-[10.5px] mt-1" style={{ color: COLORS.red }}>{c.error}</div>
                  )}
                  {c.indicatorsReferenced?.length > 0 && (
                    <div className="text-[10px] mt-1" style={{ color: COLORS.textMute }}>
                      Refs: {c.indicatorsReferenced.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t flex justify-end" style={{ borderColor: COLORS.border }}>
          <button onClick={onClose}
                  className="px-3 py-1.5 rounded text-[11.5px] hover:bg-white/[0.04]"
                  style={{ color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// Feed mini — Twitter-style post cards + a quick-post composer at top.
// Users can type a short post and tap Send to push it directly to the
// Feed page (via window event). Persists to localStorage so the post
// survives navigation.
// VideoMini — finance video widget with curated channels and live
// search. Two modes:
//
//   • Curated mode (default): plays one of five hand-picked finance
//     channels (Bloomberg, CNBC, Yahoo Finance, Reuters, WSJ) via
//     YouTube's public IFrame Player. No API key needed for playback.
//
//   • Search mode (optional): lets the user search YouTube for any
//     query. Powered by a server-side proxy at
//     POST {gateway}/youtube/search → { items: [...] } so the
//     YOUTUBE_API_KEY never reaches the client. If the backend
//     endpoint isn't configured, search gracefully degrades to a
//     "search backend not available" hint and the curated player
//     stays usable.
//
// The mic button reuses the same MicButton component used by AI Edit
// and the ticker search; spoken queries auto-submit on final
// transcript so users can ask hands-free.
const CURATED_VIDEO_CHANNELS = [
  { id: 'bloomberg',    name: 'Bloomberg TV',     videoId: 'iEpJwprxDdk', desc: 'Markets, business, breaking news' },
  { id: 'cnbc',         name: 'CNBC Live',        videoId: '9NyxcX3rhQs', desc: 'Squawk Box · Market open · Closing bell' },
  { id: 'yahoofin',     name: 'Yahoo Finance',    videoId: 'd1pwBOOLuy8', desc: 'Live coverage from market open to close' },
  { id: 'reuters',      name: 'Reuters',          videoId: 'Mtm-pcPiU48', desc: 'Global business and macro' },
  { id: 'wsj',          name: 'Wall Street Journal', videoId: 'IGevJpkbFsg', desc: 'Earnings calls, market analysis' },
];
export const VideoMini = () => {
  const [selectedId, setSelectedId] = useState(CURATED_VIDEO_CHANNELS[0].id);
  const selected = CURATED_VIDEO_CHANNELS.find(c => c.id === selectedId) ?? CURATED_VIDEO_CHANNELS[0];
  // Search state — query string, results, loading, error. searchVideo
  // is the current "playing search result" (overrides curated channel
  // when present). When null, the curated player shows.
  const [query, setQuery]                 = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError]     = useState(null);
  const [searchVideo, setSearchVideo]     = useState(null); // selected result currently playing
  const [searchOpen, setSearchOpen]       = useState(false); // results list visible?
  // In-component cache so re-searching the same query doesn't hit the
  // backend twice. Keyed by lowercased query string. Cleared on full
  // page reload.
  const cacheRef = useRef({});

  const runSearch = async (q) => {
    const term = (q ?? query).trim();
    if (!term) return;
    // Cached?
    const cacheKey = term.toLowerCase();
    if (cacheRef.current[cacheKey]) {
      setSearchResults(cacheRef.current[cacheKey]);
      setSearchOpen(true);
      setSearchError(null);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    try {
      // Two-path search resolution. Try backend proxy first (preferred
      // because the YOUTUBE_API_KEY stays server-side), then fall back
      // to a direct browser-side YouTube Data API v3 call using a
      // public env var. The direct path makes search work in
      // production deployments without requiring the agent service to
      // be online — most users won't have the backend running.
      let items = [];
      let resolved = false;
      const be = (typeof window !== 'undefined') ? window.__imoBackend : null;
      if (be?.urls?.zeroclaw && be?.status?.zeroclaw === 'connected') {
        try {
          const r = await be.post('zeroclaw', '/youtube/search', {
            q: term,
            max_results: 8,
          }, { timeout: 12000 });
          if (Array.isArray(r?.items)) {
            items = r.items;
            resolved = true;
          }
        } catch (eBackend) {
          // Swallow and fall through to direct path. Real failures
          // surface in the direct-path catch below.
          console.warn('[VideoMini] backend search failed, falling back', eBackend?.message);
        }
      }
      if (!resolved) {
        // Direct YouTube Data API v3. Public web API, supports CORS.
        // Requires VITE_YOUTUBE_API_KEY at build time. The key is a
        // browser-only "API key" (not OAuth) restricted to the
        // youtube.search.list endpoint; even if exposed it can only
        // do searches, not modify anyone's account. Recommend
        // restricting by HTTP referrer in the Google Cloud Console.
        let directKey = '';
        try { directKey = import.meta.env?.VITE_YOUTUBE_API_KEY ?? ''; } catch {}
        if (!directKey) {
          throw new Error('Search unavailable. Set VITE_YOUTUBE_API_KEY or run the agent backend.');
        }
        const url = new URL('https://www.googleapis.com/youtube/v3/search');
        url.searchParams.set('part', 'snippet');
        url.searchParams.set('type', 'video');
        url.searchParams.set('maxResults', '8');
        url.searchParams.set('q', term);
        url.searchParams.set('key', directKey);
        const resp = await fetch(url.toString(), { method: 'GET' });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          throw new Error(`YouTube API error ${resp.status}${txt ? ` · ${txt.slice(0, 80)}` : ''}`);
        }
        const j = await resp.json();
        items = (j.items ?? []).map(it => ({
          videoId:     it?.id?.videoId,
          title:       it?.snippet?.title ?? '',
          channel:     it?.snippet?.channelTitle ?? '',
          thumbnail:   it?.snippet?.thumbnails?.medium?.url ?? it?.snippet?.thumbnails?.default?.url ?? null,
          publishedAt: it?.snippet?.publishedAt ?? null,
        })).filter(it => it.videoId);
      }
      cacheRef.current[cacheKey] = items;
      setSearchResults(items);
      setSearchOpen(true);
      if (items.length === 0) setSearchError('No results.');
    } catch (e) {
      setSearchError(e.message || 'Search failed');
      setSearchResults([]);
      setSearchOpen(true);
    } finally {
      setSearchLoading(false);
    }
  };

  // What's currently playing — search result if one is selected, else
  // the curated channel. The iframe key changes on this so the player
  // remounts cleanly between sources.
  const playing = searchVideo
    ? { videoId: searchVideo.videoId, title: searchVideo.title, desc: searchVideo.channel, fromSearch: true }
    : { videoId: selected.videoId, title: selected.name, desc: selected.desc, fromSearch: false };

  return (
    <div className="h-full w-full flex flex-col" style={{ background: COLORS.bg }}>
      {/* Search row — input + mic. Sits above the channel strip since
          search is the more powerful action; channels are the default
          fallback. Search input expands to fill horizontal space. */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0"
           style={{ borderColor: COLORS.border, background: COLORS.surface }}>
        <div className="relative flex-1 min-w-0">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2"
                  style={{ color: COLORS.textMute }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  runSearch();
              if (e.key === 'Escape') { setSearchOpen(false); setQuery(''); }
            }}
            placeholder="Search videos — or tap mic"
            className="w-full pl-7 pr-2 py-1 text-[10.5px] rounded outline-none"
            style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
        </div>
        <MicButton size="xs"
                   onTranscript={(t) => {
                     // Voice query auto-submits — spoken intent is
                     // explicit ("search nvidia earnings") so we
                     // don't make the user reach for the search
                     // button afterwards.
                     setQuery(t);
                     runSearch(t);
                   }}
                   title="Speak a search query" />
        {searchVideo && (
          <button onClick={() => { setSearchVideo(null); setSearchOpen(false); }}
                  className="px-1.5 py-0.5 text-[9.5px] rounded shrink-0 hover:bg-white/[0.05]"
                  style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}
                  title="Back to curated channels">
            ← Channels
          </button>
        )}
      </div>
      {/* Channel strip — only shown when not viewing a search result.
          Keeps the curated finance channels one click away even after
          a search; tapping a channel clears the search overlay. */}
      {!searchVideo && (
        <div className="flex items-center gap-1 px-2 py-1 border-b shrink-0 overflow-x-auto imo-thin-scrollbar"
             style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          {CURATED_VIDEO_CHANNELS.map(c => {
            const active = c.id === selectedId;
            return (
              <button key={c.id} onClick={() => { setSelectedId(c.id); setSearchOpen(false); }}
                      className="px-2 py-0.5 text-[10px] rounded whitespace-nowrap shrink-0 transition-colors"
                      style={{
                        color: active ? COLORS.mint : COLORS.textDim,
                        background: active ? `${COLORS.mint}1A` : 'transparent',
                        border: `1px solid ${active ? COLORS.mint : 'transparent'}`,
                      }}
                      title={c.desc}>
                {c.name}
              </button>
            );
          })}
        </div>
      )}
      {/* Search results overlay — sits between header and player when
          a search is active. Click a result to play it inline. */}
      {searchOpen && (
        <div className="border-b shrink-0 max-h-[180px] overflow-y-auto imo-thin-scrollbar"
             style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          {searchLoading && (
            <div className="px-2 py-3 text-[10.5px] text-center" style={{ color: COLORS.textMute }}>
              Searching…
            </div>
          )}
          {searchError && !searchLoading && (
            <div className="px-2 py-2 text-[10px]" style={{ color: COLORS.red }}>
              {searchError}
            </div>
          )}
          {!searchLoading && searchResults.map(r => (
            <button key={r.videoId}
                    onClick={() => { setSearchVideo(r); setSearchOpen(false); }}
                    className="w-full flex items-start gap-2 p-1.5 text-left transition-colors hover:bg-white/[0.04] border-b last:border-b-0"
                    style={{ borderColor: COLORS.border }}>
              {r.thumbnail && (
                <img src={r.thumbnail} alt=""
                     className="rounded shrink-0"
                     style={{ width: 80, height: 45, objectFit: 'cover' }} />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[10.5px] leading-tight line-clamp-2" style={{ color: COLORS.text }}>
                  {r.title}
                </div>
                <div className="text-[9px] mt-0.5 truncate" style={{ color: COLORS.textMute }}>
                  {r.channel}{r.publishedAt ? ` · ${r.publishedAt}` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {/* Embedded player — IFrame Player API. autoplay=1 starts on
          load but most browsers require muted=1 for autoplay; we let
          the user unmute via the YT controls. */}
      <div className="flex-1 min-h-0 relative" style={{ background: '#000' }}>
        <iframe
          key={playing.videoId}
          src={`https://www.youtube.com/embed/${playing.videoId}?autoplay=1&mute=1&modestbranding=1&rel=0&enablejsapi=1`}
          title={playing.title}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
        />
      </div>
      {/* Footer — what's playing + open on YouTube */}
      <div className="flex items-center justify-between px-2 py-1 border-t shrink-0 text-[9.5px]"
           style={{ borderColor: COLORS.border, background: COLORS.surface, color: COLORS.textMute }}>
        <span className="truncate">
          {playing.fromSearch ? `▶ ${playing.title}` : playing.desc}
        </span>
        <a href={`https://www.youtube.com/watch?v=${playing.videoId}`}
           target="_blank" rel="noreferrer"
           className="hover:underline shrink-0 ml-2"
           style={{ color: COLORS.mint }}>
          Open ↗
        </a>
      </div>
    </div>
  );
};

export const FeedMini = ({ user }) => {
  const [text, setText] = useState('');
  const [recentUserPosts, setRecentUserPosts] = useState([]);
  // Pull the latest user-created posts from localStorage so they show up
  // alongside the seeded posts.
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('imo_feed_userposts') ?? '[]');
      setRecentUserPosts(stored.slice(0, 3));
    } catch {}
    const refresh = () => {
      try {
        const stored = JSON.parse(localStorage.getItem('imo_feed_userposts') ?? '[]');
        setRecentUserPosts(stored.slice(0, 3));
      } catch {}
    };
    window.addEventListener('imo:feed-quickpost', refresh);
    return () => window.removeEventListener('imo:feed-quickpost', refresh);
  }, []);
  const seededPosts = [
    { id: 'feed-seed-1', user: 'onyxdesk',  name: 'Onyx Desk',    body: 'NVDA breakouts holding above 8DMA — momentum unchanged.',     ts: '2h', likes: 24, replies: 3, color: '#7AC8FF' },
    { id: 'feed-seed-2', user: 'volsurf',   name: 'Vol Surf',     body: 'Skew flattening on SPX. Vol-of-vol firmly bid.',              ts: '4h', likes: 51, replies: 8, color: '#FF7AB6' },
    { id: 'feed-seed-3', user: 'macrobites',name: 'Macro Bites',  body: 'CPI tomorrow — 4.0% headline consensus. Whisper closer to 3.8%.', ts: '6h', likes: 117, replies: 22, color: '#7BFFB5' },
  ];
  // Per-post interaction state — likes user has tapped, reply drafts.
  // Persisted so toggles survive widget re-renders / navigation.
  const [interactions, setInteractions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('imo_feed_interactions') ?? '{}'); }
    catch { return {}; }
  });
  const [replyOpenFor, setReplyOpenFor] = useState(null);
  const [replyText, setReplyText] = useState('');
  const persistInteractions = (next) => {
    setInteractions(next);
    try { localStorage.setItem('imo_feed_interactions', JSON.stringify(next)); } catch {}
  };
  const toggleLike = (postId) => {
    const cur = interactions[postId] ?? { liked: false, repliedCount: 0 };
    persistInteractions({ ...interactions, [postId]: { ...cur, liked: !cur.liked } });
  };
  const submitReply = (postId) => {
    const t = replyText.trim();
    if (!t) return;
    const cur = interactions[postId] ?? { liked: false, repliedCount: 0 };
    persistInteractions({
      ...interactions,
      [postId]: { ...cur, repliedCount: cur.repliedCount + 1 },
    });
    setReplyText('');
    setReplyOpenFor(null);
    window.imoToast?.('Reply posted', 'success');
  };
  const send = () => {
    const t = text.trim();
    if (!t) return;
    const initials = (user?.fullName?.split(/\s+/).map(s => s[0]).join('') ?? user?.username?.slice(0, 2) ?? 'YO')
      .slice(0, 2).toUpperCase();
    const post = {
      id: `quickpost_${Date.now()}`,
      author: user?.fullName ?? user?.username ?? 'You',
      handle: `@${user?.username ?? 'you'}`,
      avatar: initials,
      avatarColor: COLORS.mint,
      body: t,
      media: null,
      likes: 0, reposts: 0, replies: 0, ts: 0,
      verified: false,
    };
    // Persist + dispatch
    try {
      const stored = JSON.parse(localStorage.getItem('imo_feed_userposts') ?? '[]');
      const next = [post, ...stored].slice(0, 100);
      localStorage.setItem('imo_feed_userposts', JSON.stringify(next));
    } catch {}
    window.dispatchEvent(new CustomEvent('imo:feed-quickpost', { detail: { post } }));
    setText('');
    window.imoToast?.('Posted to Feed', 'success');
  };
  const userInitials = (user?.fullName?.split(/\s+/).map(s => s[0]).join('') ?? user?.username?.slice(0, 2) ?? 'YO')
    .slice(0, 2).toUpperCase();
  return (
    <div className="h-full flex flex-col p-2.5">
      {/* Quick-post composer */}
      <div className="shrink-0 mb-2 pb-2 border-b" style={{ borderColor: COLORS.border }}>
        <div className="flex gap-1.5">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-semibold shrink-0"
               style={{ background: COLORS.mint, color: COLORS.bg }}>
            {userInitials}
          </div>
          <div className="flex-1 min-w-0 flex items-end gap-1.5">
            <textarea value={text}
                      onChange={(e) => setText(e.target.value.slice(0, 280))}
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
                      placeholder="What's happening?"
                      rows={1}
                      className="flex-1 min-w-0 px-2 py-1 rounded text-[11px] outline-none resize-none"
                      style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, maxHeight: 60 }} />
            <button onClick={send}
                    disabled={!text.trim()}
                    className="px-2 py-1 rounded text-[10.5px] font-medium transition-opacity shrink-0"
                    style={{ background: COLORS.mint, color: '#FFF', opacity: text.trim() ? 1 : 0.4 }}>
              Post
            </button>
          </div>
        </div>
      </div>
      {/* Recent posts (user's own first, then seeded) */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
        {recentUserPosts.map((p, i) => (
          <div key={`u${i}`} className="flex gap-2 pb-2 border-b" style={{ borderColor: COLORS.border }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-semibold shrink-0"
                 style={{ background: p.avatarColor ?? COLORS.mint, color: '#FFF' }}>
              {p.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5 text-[10px]">
                <span className="font-semibold truncate" style={{ color: COLORS.text }}>{p.author}</span>
                <span className="truncate" style={{ color: COLORS.textMute }}>{p.handle}</span>
                <span className="shrink-0" style={{ color: COLORS.mint }}>· you</span>
              </div>
              <div className="text-[10.5px] mt-0.5 leading-snug break-words" style={{ color: COLORS.text }}>{p.body}</div>
            </div>
          </div>
        ))}
        {seededPosts.map((p, i) => {
          const ix = interactions[p.id] ?? { liked: false, repliedCount: 0 };
          const displayLikes = p.likes + (ix.liked ? 1 : 0);
          const displayReplies = p.replies + ix.repliedCount;
          const replyIsOpen = replyOpenFor === p.id;
          return (
            <div key={i} className="flex gap-2 pb-2 border-b" style={{ borderColor: COLORS.border }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-semibold shrink-0"
                   style={{ background: p.color, color: '#FFF' }}>
                {p.name.split(' ').map(w => w[0]).join('').slice(0,2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 text-[10px]">
                  <span className="font-semibold truncate" style={{ color: COLORS.text }}>{p.name}</span>
                  <span className="truncate" style={{ color: COLORS.textMute }}>@{p.user}</span>
                  <span className="shrink-0" style={{ color: COLORS.textMute }}>· {p.ts}</span>
                </div>
                <div className="text-[10.5px] mt-0.5 leading-snug" style={{ color: COLORS.text }}>{p.body}</div>
                <div className="flex items-center gap-3 mt-1 text-[9px]">
                  <button onClick={() => setReplyOpenFor(replyIsOpen ? null : p.id)}
                          className="flex items-center gap-1 transition-colors hover:opacity-80"
                          style={{ color: replyIsOpen ? COLORS.mint : COLORS.textMute }}
                          title="Reply">
                    <MessageSquare size={10} /> {displayReplies}
                  </button>
                  <button onClick={() => toggleLike(p.id)}
                          className="flex items-center gap-1 transition-colors hover:opacity-80"
                          style={{ color: ix.liked ? COLORS.red : COLORS.textMute }}
                          title={ix.liked ? 'Unlike' : 'Like'}>
                    <Heart size={10} fill={ix.liked ? COLORS.red : 'transparent'} /> {displayLikes}
                  </button>
                </div>
                {/* Inline reply input — appears when user clicks reply icon. */}
                {replyIsOpen && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <input value={replyText}
                           onChange={(e) => setReplyText(e.target.value)}
                           onKeyDown={(e) => { if (e.key === 'Enter') submitReply(p.id); }}
                           placeholder="Reply…"
                           autoFocus
                           className="flex-1 min-w-0 px-2 py-1 rounded text-[10px] outline-none"
                           style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                    <button onClick={() => submitReply(p.id)}
                            disabled={!replyText.trim()}
                            className="px-2 py-1 rounded text-[10px] font-medium disabled:opacity-40"
                            style={{ background: COLORS.mint, color: '#FFF' }}>
                      Send
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Discussion mini — Reddit-style post composer + recent threads. Quick-post
// button fires `imo:discuss-quickpost` event; user's recent posts persist
// to localStorage so they appear on the Discussion page after navigation.
export const DiscussMini = ({ user }) => {
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState('macro');
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('imo_discuss_userposts') ?? '[]');
      setRecent(stored.slice(0, 3));
    } catch {}
    const refresh = () => {
      try {
        const stored = JSON.parse(localStorage.getItem('imo_discuss_userposts') ?? '[]');
        setRecent(stored.slice(0, 3));
      } catch {}
    };
    window.addEventListener('imo:discuss-quickpost', refresh);
    return () => window.removeEventListener('imo:discuss-quickpost', refresh);
  }, []);
  const seeded = [
    { id: 's1', title: 'Anyone else seeing the rotation out of mega-cap into small-caps?', author: 'small_cap_hunter', tag: 'equities', votes: 142, comments: 34 },
    { id: 's2', title: 'CPI print this morning — services inflation still sticky', author: 'macro_obs',         tag: 'macro',    votes: 87,  comments: 19 },
    { id: 's3', title: 'Oil pinning $90 — strait of Hormuz tension still elevated', author: 'energy_alpha', tag: 'energy',  votes: 61,  comments: 12 },
  ];
  const tagColors = {
    macro:    '#7AC8FF',
    equities: '#7BFFB5',
    crypto:   '#FFB84D',
    energy:   '#FF8855',
    options:  '#E07AFC',
    news:     '#FFD24A',
  };
  const send = () => {
    const t = title.trim();
    if (!t) return;
    const post = {
      id: `quickpost_${Date.now()}`,
      title: t,
      body: '',
      author: user?.username ?? 'you',
      handle: `@${user?.username ?? 'you'}`,
      tag,
      ts: new Date().toISOString(),
      votes: 1,
      comments: 0,
      pinned: false,
      flair: null,
    };
    try {
      const stored = JSON.parse(localStorage.getItem('imo_discuss_userposts') ?? '[]');
      const next = [post, ...stored].slice(0, 100);
      localStorage.setItem('imo_discuss_userposts', JSON.stringify(next));
    } catch {}
    window.dispatchEvent(new CustomEvent('imo:discuss-quickpost', { detail: { post } }));
    setTitle('');
    window.imoToast?.('Posted to Discussion', 'success');
  };
  // Per-thread interaction state
  const [interactions, setInteractions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('imo_discuss_interactions') ?? '{}'); }
    catch { return {}; }
  });
  const [commentOpenFor, setCommentOpenFor] = useState(null);
  const [commentText, setCommentText] = useState('');
  const persistInteractions = (next) => {
    setInteractions(next);
    try { localStorage.setItem('imo_discuss_interactions', JSON.stringify(next)); } catch {}
  };
  const toggleVote = (postId) => {
    const cur = interactions[postId] ?? { voted: 0, commentCount: 0 };
    persistInteractions({ ...interactions, [postId]: { ...cur, voted: cur.voted ? 0 : 1 } });
  };
  const submitComment = (postId) => {
    const t = commentText.trim();
    if (!t) return;
    const cur = interactions[postId] ?? { voted: 0, commentCount: 0 };
    persistInteractions({
      ...interactions,
      [postId]: { ...cur, commentCount: cur.commentCount + 1 },
    });
    setCommentText('');
    setCommentOpenFor(null);
    window.imoToast?.('Comment posted', 'success');
  };

  return (
    <div className="h-full flex flex-col p-2.5">
      {/* Quick-post composer */}
      <div className="shrink-0 mb-2 pb-2 border-b" style={{ borderColor: COLORS.border }}>
        <div className="flex gap-1.5 mb-1.5">
          <select value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  className="px-1.5 py-1 rounded text-[10px] outline-none shrink-0"
                  style={{ background: COLORS.bg, color: tagColors[tag], border: `1px solid ${COLORS.border}`, fontWeight: 600 }}>
            {Object.keys(tagColors).map(t => (
              <option key={t} value={t} style={{ color: tagColors[t] }}>o/{t}</option>
            ))}
          </select>
          <input value={title}
                 onChange={(e) => setTitle(e.target.value.slice(0, 200))}
                 onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                 placeholder="Start a thread…"
                 className="flex-1 min-w-0 px-2 py-1 rounded text-[11px] outline-none"
                 style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
          <button onClick={send}
                  disabled={!title.trim()}
                  className="px-2 py-1 rounded text-[10.5px] font-medium transition-opacity shrink-0"
                  style={{ background: COLORS.mint, color: '#FFF', opacity: title.trim() ? 1 : 0.4 }}>
            Post
          </button>
        </div>
      </div>
      {/* Recent threads (user's first, then seeded) */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
        {recent.map((p, i) => (
          <div key={`u${i}`} className="rounded p-2 border"
               style={{ background: COLORS.bg, borderColor: COLORS.border, borderLeft: `3px solid ${tagColors[p.tag] ?? COLORS.mint}` }}>
            <div className="flex items-center gap-1.5 mb-0.5 text-[8.5px] uppercase tracking-wider">
              <span style={{ color: tagColors[p.tag] ?? COLORS.mint, fontWeight: 600 }}>o/{p.tag}</span>
              <span style={{ color: COLORS.mint }}>· yours</span>
            </div>
            <div className="text-[11px] leading-tight font-medium" style={{ color: COLORS.text }}>{p.title}</div>
          </div>
        ))}
        {seeded.map(p => {
          const tagColor = tagColors[p.tag] ?? COLORS.mint;
          const ix = interactions[p.id] ?? { voted: 0, commentCount: 0 };
          const displayVotes = p.votes + ix.voted;
          const displayComments = p.comments + ix.commentCount;
          const commentIsOpen = commentOpenFor === p.id;
          return (
            <div key={p.id} className="rounded p-2 border"
                 style={{ background: COLORS.bg, borderColor: COLORS.border }}>
              <div className="flex items-center justify-between mb-0.5 text-[8.5px] uppercase tracking-wider">
                <span style={{ color: tagColor, fontWeight: 600 }}>o/{p.tag}</span>
                <span style={{ color: COLORS.textMute }}>by {p.author}</span>
              </div>
              <div className="text-[11px] leading-tight font-medium mb-1" style={{ color: COLORS.text }}>{p.title}</div>
              <div className="flex items-center gap-3 text-[9px]">
                <button onClick={() => toggleVote(p.id)}
                        className="flex items-center gap-1 transition-colors hover:opacity-80"
                        style={{ color: ix.voted ? COLORS.green : COLORS.textMute }}
                        title={ix.voted ? 'Remove upvote' : 'Upvote'}>
                  <span style={{ fontSize: 10 }}>▲</span> {displayVotes}
                </button>
                <button onClick={() => setCommentOpenFor(commentIsOpen ? null : p.id)}
                        className="flex items-center gap-1 transition-colors hover:opacity-80"
                        style={{ color: commentIsOpen ? COLORS.mint : COLORS.textMute }}
                        title="Comment">
                  <MessageSquare size={10} /> {displayComments}
                </button>
              </div>
              {commentIsOpen && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <input value={commentText}
                         onChange={(e) => setCommentText(e.target.value)}
                         onKeyDown={(e) => { if (e.key === 'Enter') submitComment(p.id); }}
                         placeholder="Comment…"
                         autoFocus
                         className="flex-1 min-w-0 px-2 py-1 rounded text-[10px] outline-none"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                  <button onClick={() => submitComment(p.id)}
                          disabled={!commentText.trim()}
                          className="px-2 py-1 rounded text-[10px] font-medium disabled:opacity-40"
                          style={{ background: COLORS.mint, color: '#FFF' }}>
                    Send
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Watchlist mini — full-page-style rows with sector letter, ticker,
// price, change, and a tiny sparkline. Empty state invites the user
// to add markets.
export const WatchlistMini = ({ account, onSelect }) => {
  const tickers = (account?.watchlist ?? []).slice(0, 12);
  if (tickers.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4">
        <div className="text-[11px] mb-1" style={{ color: COLORS.textMute }}>
          Your watchlist is empty
        </div>
        <div className="text-[10px]" style={{ color: COLORS.textMute }}>
          Add instruments from the Watchlist page to track them here.
        </div>
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 text-[9px] uppercase tracking-wider px-1 pb-1 border-b shrink-0"
           style={{ color: COLORS.textMute, borderColor: COLORS.border }}>
        <span>Symbol</span>
        <span className="text-right">Last</span>
        <span className="text-right">24h</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 mt-0.5">
        {tickers.map(t => {
          const inst = (typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS : []).find(i => i.id === t);
          if (!inst) return null;
          const change = inst.change24h ?? 0;
          const seed = (inst.id ?? 'X').charCodeAt(0);
          const points = Array.from({ length: 14 }, (_, i) => 8 + Math.sin((i + seed) * 0.5) * 3 + (change > 0 ? -i * 0.15 : i * 0.15));
          const sparkPath = points.map((y, i) => `${i * 4},${y}`).join(' ');
          return (
            <button key={t} onClick={() => onSelect?.(inst)}
                    className="w-full grid grid-cols-[1fr_auto_auto] gap-2 items-center py-1 px-1 rounded hover:bg-white/[0.04] transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <SectorLetter cls={inst.cls} size={14} />
                <div className="text-left min-w-0">
                  <div className="text-[11px] font-medium truncate" style={{ color: COLORS.text }}>{formatTicker(inst.id, inst.cls)}</div>
                  <div className="text-[8.5px] truncate" style={{ color: COLORS.textMute }}>{inst.name}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <svg width="40" height="14" viewBox="0 0 56 16">
                  <polyline points={sparkPath} stroke={change >= 0 ? COLORS.green : COLORS.red} strokeWidth="1.2" fill="none" />
                </svg>
                <span className="text-[10.5px] tabular-nums" style={{ color: COLORS.text }}>${inst.mark?.toFixed(inst.dec ?? 2)}</span>
              </div>
              <span className="text-[10px] tabular-nums shrink-0" style={{ color: change >= 0 ? COLORS.green : COLORS.red }}>
                {change >= 0 ? '+' : ''}{change.toFixed(2)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// Predictions mini — Kalshi-style market cards with Yes/No buttons,
// volume readout, and category tags. Mirrors the full Predictions page
// layout so users feel like they're looking at the same surface.
export const PredictionsMini = () => {
  const items = [
    { q: 'Fed cuts rates by EOY?', yes: 64, vol: '$2.4M',  cat: 'Macro' },
    { q: 'BTC > $80k by Dec?',     yes: 41, vol: '$1.1M',  cat: 'Crypto' },
    { q: 'NVDA beats next ER?',    yes: 72, vol: '$890K',  cat: 'Equity' },
    { q: 'Recession in 2026?',     yes: 23, vol: '$3.2M',  cat: 'Macro' },
  ];
  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
        {items.map((p, i) => (
          <div key={i} className="rounded-md p-2 border"
               style={{ background: COLORS.bg, borderColor: COLORS.border }}>
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="text-[11px] leading-tight font-medium flex-1" style={{ color: COLORS.text }}>{p.q}</div>
              <span className="text-[8.5px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                    style={{ background: COLORS.surface2, color: COLORS.textMute }}>{p.cat}</span>
            </div>
            <div className="grid grid-cols-2 gap-1 mb-1">
              <button className="py-1 rounded text-[10.5px] font-medium hover:opacity-90 transition-opacity"
                      style={{ background: 'rgba(31,178,107,0.18)', color: '#7BFFB5', border: '1px solid rgba(31,178,107,0.4)' }}>
                YES · {p.yes}¢
              </button>
              <button className="py-1 rounded text-[10.5px] font-medium hover:opacity-90 transition-opacity"
                      style={{ background: 'rgba(255,136,85,0.18)', color: '#FF8855', border: '1px solid rgba(255,136,85,0.4)' }}>
                NO · {100 - p.yes}¢
              </button>
            </div>
            <div className="flex items-center justify-between text-[9.5px]" style={{ color: COLORS.textMute }}>
              <span>Vol 24h: {p.vol}</span>
              <span>{p.yes >= 50 ? '▲' : '▼'} {p.yes}% YES</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Messages mini — chat list mirroring the full Messages page sidebar.
// Each row shows avatar, contact name, last-message preview, time, and
// unread badge. Reads from imo_messages_${user} and falls back to a
// curated mock list so the widget always has content.
export const MessagesMini = ({ user }) => {
  let recent = [];
  try {
    const raw = localStorage.getItem(`imo_messages_${user?.username ?? 'guest'}`);
    const all = raw ? JSON.parse(raw) : {};
    recent = Object.entries(all).map(([cid, msgs]) => ({
      cid,
      name: cid,
      last: msgs[msgs.length - 1]?.body ?? '',
      ts: msgs[msgs.length - 1]?.ts ?? Date.now(),
      unread: msgs.filter(m => !m.read).length,
    }));
  } catch {}
  // Fallback mock list
  if (recent.length === 0) {
    recent = [
      { cid: 'sarah-li',     name: 'Sarah Li',      last: 'Great trade on the AAPL squeeze',         ts: Date.now() - 1800000, unread: 2, avatar: 'SL', color: '#FF7AB6' },
      { cid: 'marc-z',       name: 'Marcus Zhao',   last: 'Did you see the Fed minutes?',           ts: Date.now() - 7200000, unread: 0, avatar: 'MZ', color: '#7AC8FF' },
      { cid: 'desk-macro',   name: 'Macro Desk',    last: 'Weekly outlook attached',                ts: Date.now() - 86400000, unread: 1, avatar: 'MD', color: '#7BFFB5' },
      { cid: 'compliance',   name: 'Compliance',    last: 'Reminder: Q4 attestation due Friday',     ts: Date.now() - 172800000, unread: 0, avatar: 'C', color: '#FFB84D' },
    ];
  }
  const fmtTime = (ts) => {
    const diff = Date.now() - ts;
    if (diff < 3600000) return `${Math.floor(diff/60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h`;
    return `${Math.floor(diff/86400000)}d`;
  };
  return (
    <div className="h-full flex flex-col p-2">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
        {recent.slice(0, 8).map(r => (
          <div key={r.cid} className="flex items-center gap-2 p-1.5 rounded transition-colors hover:bg-white/[0.04]">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0"
                 style={{ background: r.color ?? COLORS.surface2, color: '#FFF' }}>
              {r.avatar ?? r.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-medium truncate" style={{ color: COLORS.text }}>{r.name}</span>
                <span className="text-[9px] tabular-nums shrink-0" style={{ color: COLORS.textMute }}>{fmtTime(r.ts)}</span>
              </div>
              <div className="text-[10px] truncate" style={{ color: COLORS.textDim }}>{r.last}</div>
            </div>
            {r.unread > 0 && (
              <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8.5px] font-bold tabular-nums shrink-0"
                   style={{ background: COLORS.mint, color: COLORS.bg }}>
                {r.unread}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── AvatarMini — talking AI advisor widget ───────────────────────────────
//
// A chat panel that connects to the same callAI helper as the rest of the
// platform. Optimized for stock-advisor-style conversations: includes the
// active instrument as context so questions like "should I buy?" get
// ticker-aware answers.
//
// HONEST SCOPE on the "talking" part: this widget is currently a chat
// interface only. To make it actually speak:
//  1. Add a TTS provider key (ElevenLabs / OpenAI Realtime / browser
//     SpeechSynthesis API). The browser's built-in `speechSynthesis` works
//     today with no key and is wired below as a fallback — toggle the
//     speaker icon to enable voice playback.
//  2. For a real animated avatar (lip-sync video), you'd need a service
//     like D-ID or HeyGen API. That's a separate integration — out of
//     scope for this widget.
//
// The visual is a circular avatar (SVG) with a pulse animation when
// "thinking" or "speaking", which sells the "talking advisor" feel even
// without lip-sync.
export const AvatarMini = ({ instrument, account, portfolioSource = null }) => {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: instrument
      ? `Hi! I'm watching ${instrument.id} for you. Ask me about the chart, your positions, or what trades make sense right now.`
      : 'Hi! I\'m your AI trading advisor. Ask me anything about the markets.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  // Mode toggle — 'chat' renders the existing text-chat surface,
  // 'avatar' renders the talking-head scaffold. Avatar is intentionally
  // a placeholder right now (provider not yet picked); see the panel
  // body for the comparison + provider selection guidance.
  const [mode, setMode] = useState('chat');
  const scrollRef = useRef(null);

  // Speak text using the browser's free SpeechSynthesis API. No key needed.
  // Falls back silently if the API isn't available.
  const speak = (text) => {
    if (!voiceOn || typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.volume = 0.9;
      // Prefer a male English voice if available — stock-advisor vibe
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => /male|david|alex|daniel/i.test(v.name) && /en/i.test(v.lang));
      if (preferred) utterance.voice = preferred;
      window.speechSynthesis.speak(utterance);
    } catch {}
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true);
    setMessages(m => [...m, { role: 'user', content: q }]);
    setInput('');
    try {
      // Build a stock-advisor system prompt with current context
      const ctx = [];
      if (instrument) {
        ctx.push(`Active ticker: ${instrument.id} (${instrument.name})`);
        if (instrument.mark) ctx.push(`Current price: $${instrument.mark.toFixed(instrument.dec ?? 2)}`);
      }
      if (account?.cashBalance != null) {
        ctx.push(`Available cash: $${account.cashBalance.toFixed(2)}`);
      }
      // Prefer the canonical portfolio source (broker-aware) when
      // available. Falls back to the paper account positions otherwise.
      if (portfolioSource && Array.isArray(portfolioSource.positions) && portfolioSource.positions.length > 0) {
        const ps = portfolioSource;
        const sourceLabel = ps.source === 'broker' ? `${ps.providerId} broker` : 'paper';
        const top = ps.positions.slice(0, 5).map(p => {
          const dir = p.qty > 0 ? 'long' : p.qty < 0 ? 'short' : 'flat';
          const qty = Math.abs(p.qty);
          const mark = p.mark != null ? ` @ $${Number(p.mark).toFixed(2)}` : '';
          const pnl  = p.unrealizedPnL != null ? ` (${p.unrealizedPnL >= 0 ? '+' : ''}$${Number(p.unrealizedPnL).toFixed(0)})` : '';
          return `${p.symbol} ${dir} ${qty}${mark}${pnl}`;
        }).join(', ');
        ctx.push(`Portfolio source: ${sourceLabel}`);
        ctx.push(`Open positions (${ps.positions.length}): ${top}${ps.positions.length > 5 ? `, +${ps.positions.length - 5} more` : ''}`);
      } else {
        const positions = account?.positions ?? [];
        if (positions.length > 0) {
          ctx.push(`Open positions: ${positions.length} (${positions.slice(0, 3).map(p => p.instrument?.id || p.symbol).filter(Boolean).join(', ')})`);
        }
      }

      const result = await callAI(q, {
        system: `You are a senior, plain-spoken stock advisor who gives concrete actionable answers. Avoid hedging excessively. Keep responses under 100 words.

Current context:
${ctx.join('\n')}

Always include a brief "not financial advice" disclaimer at the end if you make a buy/sell suggestion.`,
        maxTokens: 250,
      });
      const reply = result || 'Sorry, the AI is unavailable right now. Check that VITE_ANTHROPIC_API_KEY is set.';
      setMessages(m => [...m, { role: 'assistant', content: reply }]);
      speak(reply);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Avatar header — round face that pulses when busy/speaking */}
      <div className="flex items-center gap-3 p-3 border-b" style={{ borderColor: COLORS.border }}>
        <div className="relative shrink-0"
             style={{ width: 44, height: 44 }}>
          <div className={`w-full h-full rounded-full flex items-center justify-center ${busy ? 'imo-avatar-pulse' : ''}`}
               style={{
                 background: `linear-gradient(135deg, ${COLORS.mint} 0%, ${COLORS.mintDim} 100%)`,
                 boxShadow: busy ? `0 0 16px ${COLORS.mint}60` : 'none',
                 transition: 'box-shadow 200ms ease',
               }}>
            {/* Stylized "advisor" face — minimal, confident */}
            <svg viewBox="0 0 32 32" width="22" height="22" fill="none">
              <circle cx="11" cy="13" r="1.4" fill="#fff" />
              <circle cx="21" cy="13" r="1.4" fill="#fff" />
              <path d="M10 20 Q16 24 22 20" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
          </div>
          {/* Live indicator dot */}
          <div className="absolute bottom-0 right-0 rounded-full"
               style={{
                 width: 10, height: 10,
                 background: COLORS.green,
                 border: `2px solid ${COLORS.surface}`,
               }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium" style={{ color: COLORS.text }}>
            Your Advisor
          </div>
          <div className="text-[10px]" style={{ color: COLORS.textMute }}>
            {busy ? 'Thinking…' : voiceOn ? 'Voice on' : 'Online'}
          </div>
        </div>
        <button onClick={() => {
                  if (voiceOn) {
                    try { window.speechSynthesis?.cancel(); } catch {}
                  }
                  setVoiceOn(v => !v);
                }}
                className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-white/[0.06]"
                style={{ color: voiceOn ? COLORS.mint : COLORS.textMute }}
                title={voiceOn ? 'Voice on — click to mute' : 'Voice off — click to enable'}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            {voiceOn ? (
              <>
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <path d="M15.5 8.5a5 5 0 010 7" />
                <path d="M19 5a9 9 0 010 14" />
              </>
            ) : (
              <>
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mode toggle — Chat / Avatar. Sits directly below the header
          so users can flip between the text-chat surface (which works
          today) and the talking-avatar mode (scaffolded; provider
          not yet integrated — see Avatar tab body for current options
          and the integration plan). */}
      <div className="flex items-center gap-1 px-2 py-1 border-b shrink-0"
           style={{ borderColor: COLORS.border, background: COLORS.surface }}>
        {[
          { id: 'chat',   label: 'Chat' },
          { id: 'avatar', label: 'Avatar' },
        ].map(m => {
          const active = m.id === mode;
          return (
            <button key={m.id} onClick={() => setMode(m.id)}
                    className="flex-1 py-1 text-[10.5px] rounded transition-colors"
                    style={{
                      color: active ? COLORS.mint : COLORS.textDim,
                      background: active ? `${COLORS.mint}1A` : 'transparent',
                      fontWeight: active ? 600 : 400,
                    }}>
              {m.label}
            </button>
          );
        })}
      </div>

      {mode === 'chat' ? (
        <>
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%] px-3 py-2 rounded-lg"
                 style={{
                   background: m.role === 'user' ? COLORS.mint : COLORS.surface2,
                   color: m.role === 'user' ? '#FFFFFF' : COLORS.text,
                   borderTopLeftRadius: m.role === 'assistant' ? 4 : undefined,
                   borderTopRightRadius: m.role === 'user' ? 4 : undefined,
                 }}>
              {/* User messages stay plain text — they're typed input,
                  no formatting expected. Assistant messages use the
                  AIMarkdown wrapper so streaming markdown (lists,
                  code blocks, tables, bold) renders incrementally as
                  tokens arrive instead of in a single burst when the
                  full reply lands. */}
              {m.role === 'assistant'
                ? <AIMarkdown size="sm">{m.content}</AIMarkdown>
                : <div className="text-[11.5px] leading-relaxed">{m.content}</div>}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-lg"
                 style={{ background: COLORS.surface2 }}>
              <span className="imo-typing-dots">
                <span style={{ background: COLORS.textDim }}></span>
                <span style={{ background: COLORS.textDim }}></span>
                <span style={{ background: COLORS.textDim }}></span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="p-2 border-t flex gap-2" style={{ borderColor: COLORS.border }}>
        <input value={input}
               onChange={e => setInput(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') send(); }}
               placeholder={instrument ? `Ask about ${instrument.id}…` : 'Ask anything…'}
               disabled={busy}
               className="flex-1 px-3 py-1.5 rounded-md text-[12px] outline-none"
               style={{
                 background: COLORS.bg,
                 color: COLORS.text,
                 border: `1px solid ${COLORS.border}`,
               }} />
        <button onClick={send}
                disabled={busy || !input.trim()}
                className="px-3 py-1.5 rounded-md text-[11.5px] font-medium transition-all disabled:opacity-40"
                style={{ background: COLORS.mint, color: '#FFFFFF' }}>
          Send
        </button>
      </div>
        </>
      ) : (
        // Avatar mode — provider scaffold. The talking-avatar feature
        // requires picking a vendor (D-ID / HeyGen / Synthesia / Ready
        // Player Me + ElevenLabs) before integration. Each has different
        // tradeoffs around per-minute cost, latency, lip-sync quality,
        // and whether the avatar is photoreal or stylized. This panel
        // surfaces the current state so users see the feature is real
        // and intentional, not broken or missing.
        <AvatarModeScaffold instrument={instrument} />
      )}
    </div>
  );
};

// AvatarModeScaffold — placeholder UI for the talking-avatar feature.
// Renders a stylized "advisor" avatar with a pulse animation suggesting
// it's idle/listening, plus a panel explaining the current state and
// the three integration paths. Once a provider is picked, this gets
// replaced with the actual streaming-video <video> tag + WebRTC
// connection to the provider's API.
export const AvatarModeScaffold = ({ instrument }) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 text-center" style={{ background: COLORS.bg }}>
      {/* Stylized avatar — same SVG as the header but bigger, with a
          stronger pulse to suggest "ready to talk". */}
      <div className="relative mb-4" style={{ width: 110, height: 110 }}>
        <div className="w-full h-full rounded-full flex items-center justify-center imo-avatar-pulse"
             style={{
               background: `linear-gradient(135deg, ${COLORS.mint} 0%, ${COLORS.mintDim} 100%)`,
               boxShadow: `0 0 28px ${COLORS.mint}55`,
             }}>
          <svg viewBox="0 0 32 32" width="56" height="56" fill="none">
            <circle cx="11" cy="13" r="1.8" fill="#fff" />
            <circle cx="21" cy="13" r="1.8" fill="#fff" />
            <path d="M10 20 Q16 24 22 20" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
        </div>
        <div className="absolute bottom-1 right-1 rounded-full"
             style={{
               width: 18, height: 18,
               background: COLORS.green,
               border: `3px solid ${COLORS.bg}`,
             }} />
      </div>
      <div className="text-[13px] font-semibold mb-1" style={{ color: COLORS.text }}>
        Talking advisor mode
      </div>
      <div className="text-[10.5px] leading-relaxed mb-3 max-w-[260px]" style={{ color: COLORS.textMute }}>
        Photoreal lip-synced avatar that holds a real-time conversation. Pick a provider to enable.
      </div>
      <div className="w-full max-w-[260px] space-y-1.5">
        {[
          { id: 'd-id',     name: 'D-ID',                desc: 'Photoreal · 2-5s latency · ~$0.12/min', color: '#7AC8FF' },
          { id: 'heygen',   name: 'HeyGen',              desc: 'Photoreal · cheaper at scale',          color: '#A0C476' },
          { id: 'rpm',      name: 'Ready Player Me',     desc: 'Stylized 3D · self-hosted · custom TTS', color: '#FFB84D' },
        ].map(p => (
          <div key={p.id}
               className="px-2.5 py-1.5 rounded text-left text-[10.5px] flex items-center gap-2"
               style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
            <span className="rounded-full shrink-0" style={{ width: 6, height: 6, background: p.color }} />
            <div className="flex-1 min-w-0">
              <div className="font-medium" style={{ color: COLORS.text }}>{p.name}</div>
              <div style={{ color: COLORS.textMute }}>{p.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="text-[9.5px] mt-3 max-w-[260px]" style={{ color: COLORS.textMute }}>
        Falling back to <strong style={{ color: COLORS.textDim }}>Chat</strong> for now — flip the toggle above to keep using the AI in text mode.
      </div>
    </div>
  );
};


// Fundamentals mini — shows metrics the user has plotted via the
// "📈 Plot" button in the Fundamentals modal, plus core ratios for the
// active instrument. Re-reads on a 2s interval so adding/removing
// metrics updates the trade-page widget without a full reload.
export const FundamentalsMini = ({ instrument, onOpenFundamentals }) => {
  const seed = (instrument?.id ?? 'X').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const [plotted, setPlotted] = useState(() => {
    try { return JSON.parse(localStorage.getItem('imo_fundamentals_charts') ?? '[]'); }
    catch { return []; }
  });
  useEffect(() => {
    const sync = () => {
      try {
        const fresh = JSON.parse(localStorage.getItem('imo_fundamentals_charts') ?? '[]');
        setPlotted(prev => prev.length === fresh.length && prev.every((id, i) => id === fresh[i]) ? prev : fresh);
      } catch {}
    };
    window.addEventListener('storage', sync);
    const interval = setInterval(sync, 2000);
    return () => { window.removeEventListener('storage', sync); clearInterval(interval); };
  }, []);

  const series = useMemo(() => {
    return plotted.map(metricId => {
      const mSeed = metricId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + seed;
      const data = Array.from({ length: 12 }, (_, i) => ({
        q: `Q${(i % 4) + 1}'${24 + Math.floor(i / 4)}`,
        v: Math.round((Math.sin((i + mSeed) * 0.4) * 0.3 + 1 + i * 0.05) * (50 + (mSeed % 100))),
      }));
      return { id: metricId, label: metricId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), data };
    });
  }, [plotted, seed]);

  // Clean-slate baseline: the four metrics user explicitly asked for —
  // market cap, volume, dividend, eps. The user's "+ button" adds more.
  // Equity-only — for crypto, fx, commodities etc. these ratios don't
  // map, so we show a clear unsupported state instead of fake numbers.
  const isEquity = instrument?.cls === 'equity';
  const metrics = isEquity ? [
    { k: 'Mkt Cap', v: `$${(((seed * 73) % 900) + 100).toFixed(1)}B` },
    { k: 'Volume',  v: `${((seed * 41) % 95 + 5).toFixed(1)}M` },
    { k: 'Div',     v: `${((seed % 5) + 0.5).toFixed(2)}%` },
    { k: 'EPS',     v: `$${((seed % 20) + 1).toFixed(2)}` },
  ] : [];

  if (!isEquity) {
    return (
      <div className="h-full flex flex-col p-2.5 items-center justify-center text-center gap-2">
        <div className="text-[10.5px]" style={{ color: COLORS.textDim }}>
          {instrument?.id ?? '—'} is a {instrument?.cls ?? 'non-equity'} instrument
        </div>
        <div className="text-[10px]" style={{ color: COLORS.textMute }}>
          Equity-style fundamentals (P/E, EPS, dividend yield, market cap)
          aren't defined for this asset class. Switch to a stock ticker
          to see fundamentals.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-2.5">
      <div className="grid grid-cols-2 gap-1.5 mb-2 shrink-0">
        {metrics.map(m => (
          <div key={m.k} className="rounded p-1.5 border"
               style={{ background: COLORS.bg, borderColor: COLORS.border }}>
            <div className="text-[8.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>{m.k}</div>
            <div className="text-[11.5px] tabular-nums font-medium" style={{ color: COLORS.text }}>{m.v}</div>
          </div>
        ))}
      </div>
      {/* + button — opens the full fundamentals picker so user can add
          more metrics. Uses onOpenFundamentals callback when provided,
          otherwise falls back to dispatching a global event. */}
      <button
        onClick={() => {
          if (onOpenFundamentals) onOpenFundamentals();
          else { try { window.dispatchEvent(new CustomEvent('imo:open-fundamentals')); } catch {} }
        }}
        className="mb-2 px-2 py-1 rounded text-[10px] transition-colors hover:bg-white/[0.04] flex items-center justify-center gap-1 shrink-0"
        style={{ color: COLORS.textDim, border: `1px dashed ${COLORS.border}`, background: 'transparent' }}
        title="Add more fundamentals from the picker"
      >
        <span style={{ fontSize: 11 }}>+</span>
        Add fundamental
      </button>
      {/* Plotted-metric charts */}
      <div className="flex-1 min-h-0">
        {series.length === 0 ? (
          <div className="text-[10px] p-2 rounded h-full flex items-center text-center"
               style={{ color: COLORS.textMute, background: COLORS.bg, border: `1px dashed ${COLORS.border}` }}>
            Click + to add fundamentals.
          </div>
        ) : (
          <div className="h-full overflow-y-auto space-y-1.5">
            {series.slice(0, 4).map(s => (
              <div key={s.id}>
                <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: COLORS.textMute }}>{s.label}</div>
                <ResponsiveContainer width="100%" height={36}>
                  <LineChart data={s.data}>
                    <Line type="monotone" dataKey="v" stroke={COLORS.mint} strokeWidth={1.4} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
