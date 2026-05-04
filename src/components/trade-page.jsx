// @ts-check
// IMO Onyx Terminal — TradePage (the main trading surface)
//
// Phase 3p.32 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally ~2,175 lines).
//
// THE CULMINATION OF TIER C. After 5 "lift the children" phases
// (3p.27-3p.31) extracting all 51 of TradePage's monolith-defined
// child components, this is TradePage proper as a clean module.
//
// TradePage is the multi-pane trading workspace: instrument header
// at the top, customizable widget grid in the middle (chart, order
// book, options chain, mini-dashboards), and a bottom panel for
// positions/orders/history. Users can drag-rearrange widgets,
// pin charts to specific tickers, and switch between layouts
// (default, compact, sentiment-focused, etc.).
//
// Public exports:
//   TradePage({ active, setActive, pickerOpen, setPickerOpen,
//              account, portfolioSource, user, onOpenPosition,
//              onClosePosition, onToggleWatch, onOptionTrade,
//              onOpenTerminal, setPage, onOpenAI,
//              BottomPanel, Positions })
//
// Component injection:
//   BottomPanel and Positions are passed as component props rather
//   than imported, because they remain in the monolith (BottomPanel
//   has a cascading 40+ Tab dependency). The monolith renders
//   <TradePage ... BottomPanel={BottomPanel} Positions={Positions} />.
//
// Imports:
//   lib/constants.js          (COLORS)
//   lib/instruments.js        (INSTRUMENTS)
//   lib/format.js             (formatTicker)
//   lib/ai-calls.js           (callAI)
//   lib/trade-feeds.js        (usePriceFeed, useOrderBook)
//   leaf-ui.jsx               (InstIcon)
//   compact-tabs.jsx          (12 Compact* tabs)
//   mini-widgets.jsx          (TradeMiniView, 27 *Mini, AvatarMode...)
//   chart-with-subcharts.jsx  (ChartWithSubcharts)
//   trading-panel.jsx         (OrderBook, OrderEntry, OptionsChain)
//   instrument-header.jsx     (InstrumentHeader, InstrumentPicker)
//   fundamentals-modal.jsx    (FundamentalsModal)
//   market-screener-modal.jsx (MarketScreenerModal)
//   basket-components.jsx     (MarketBasketsModal)
//
// (CompWidget comes from mini-widgets.jsx)

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { COLORS, TICKER_SECTORS } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import { formatTicker } from '../lib/format.js';
import { callAI } from '../lib/ai-calls.js';
import { usePriceFeed, useOrderBook } from '../lib/trade-feeds.js';
import { InstIcon } from './leaf-ui.jsx';
import {
  CompactPositions, CompactOrders, CompactHistory, CompactChainEvents,
  CompactRisk, CompactSentiment, CompactOptions, CompactTrends,
  CompactPriceAnalysis, CompactESG, CompactMoat, CompactNewsTab,
} from './compact-tabs.jsx';
import {
  TradeMiniView, CompWidget, VolumeProfileMini, NetFlowMini,
  DarkFlowMini, MarketMapMini, TerminalMini, GainersLosersMini,
  VolSkewMini, VolDriftMini, WSBSentimentMini, SECFilingsMini,
  TreasuryRatesMini, MacroIndicatorsMini, LocalConditionsMini,
  CorporateActionsMini, NewsFeedMini, PortfolioMini, CalendarMini,
  SwapMini, AutopilotMini, VideoMini, FeedMini, DiscussMini,
  WatchlistMini, PredictionsMini, MessagesMini, AvatarMini,
  FundamentalsMini, SectorHeatMapMini,
} from './mini-widgets.jsx';
import { ChartWithSubcharts } from './chart-with-subcharts.jsx';
import {
  OrderBook, OptionsChain, OrderEntry,
} from './trading-panel.jsx';
import {
  InstrumentHeader, InstrumentPicker,
} from './instrument-header.jsx';
import { FundamentalsModal } from './fundamentals-modal.jsx';
import { MarketScreenerModal } from './market-screener-modal.jsx';
import { MarketBasketsModal } from './basket-components.jsx';
import { FEED_POSTS } from './feed-page.jsx';

// API key declarations (duplicate from monolith pattern). These gate
// the AI recommendations effect; without them we silently skip the
// AI call rather than hitting an unreachable endpoint.
const ANTHROPIC_API_KEY = (() => { try { return import.meta.env?.VITE_ANTHROPIC_API_KEY ?? ''; } catch { return ''; } })();
const OPENAI_API_KEY    = (() => { try { return import.meta.env?.VITE_OPENAI_API_KEY    ?? ''; } catch { return ''; } })();

// useWindowSize — inlined from monolith (only used by TradePage,
// orphaned after extraction).
const useWindowSize = () => {
  const [size, setSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1440,
    h: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let frame;
    const handler = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setSize({ w: window.innerWidth, h: window.innerHeight });
      });
    };
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('resize', handler);
      cancelAnimationFrame(frame);
    };
  }, []);
  return size;
};


export const TradePage = ({ active, setActive, pickerOpen, setPickerOpen, account, portfolioSource, user, onOpenPosition, onClosePosition, onToggleWatch, onOptionTrade, onOpenTerminal, setPage, onOpenAI, BottomPanel, Positions }) => {
  const feed = usePriceFeed(active);
  const book = useOrderBook(active, feed.price);
  const [basketOpen, setBasketOpen] = useState(false);
  // Wide-mode layout — at viewport widths ≥1440px we switch from the
  // count-based grid (1×1, 2×1, 3×3, 4×3 etc.) to a region-based
  // layout: chart center top, order entry left, order book right,
  // everything else in a bottom row. This gives a real institutional
  // terminal feel on big monitors without changing the underlying
  // midOrder schema — the same array drives both modes; only the
  // rendering placement changes. Updated via window resize listener
  // so the layout switches live as users resize their window.
  const [wideMode, setWideMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth >= 1440;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setWideMode(window.innerWidth >= 1440);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  // Quick-trade modal — opened from the InstrumentHeader's Buy/Sell buttons
  // when the OrderEntry widget isn't in the layout. Mirrors the same inputs
  // (price, size, cash/margin) and routes through the same openPosition()
  // handler so behavior is identical.
  const [quickTradeSide, setQuickTradeSide] = useState(null); // 'buy' | 'sell' | null
  // Market Screener modal — opened from the ticker search dropdown's
  // "Market screener" quick action.
  const [screenerOpen, setScreenerOpen] = useState(false);
  // Fundamentals picker modal — opened from FundamentalsMini's "+ Add
  // fundamental" button. Lives at TradePage level so the modal renders
  // outside the widget grid (otherwise the modal's fixed positioning
  // gets clipped by the workspace overflow). The widget previously
  // dispatched an imo:open-fundamentals event that nothing listened
  // for, so the button was silently broken.
  const [fundamentalsOpen, setFundamentalsOpen] = useState(false);

  // AI personalized recommendations — shown as a banner on first trade-page
  // entry per user. Reads user.profile (riskGoal, age, horizon, experience)
  // and asks Anthropic for 5 ticker recommendations matching that profile.
  // Persists to imo_ai_recs_${user} so the banner doesn't re-fetch on every
  // page enter; also flagged via imo_ai_recs_seen_${user} when dismissed so
  // it never shows again for that account.
  const AI_RECS_KEY = `imo_ai_recs_${user?.username ?? 'guest'}`;
  const AI_RECS_SEEN_KEY = `imo_ai_recs_seen_${user?.username ?? 'guest'}`;
  const [aiRecsSeen, setAiRecsSeen] = useState(() => {
    try { return localStorage.getItem(AI_RECS_SEEN_KEY) === '1'; }
    catch { return false; }
  });
  const [aiRecs, setAiRecs] = useState(() => {
    try {
      const raw = localStorage.getItem(AI_RECS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null; // { picks: [{id, rationale}], summary, fetchedAt }
  });
  const [aiRecsLoading, setAiRecsLoading] = useState(false);

  const dismissAiRecs = () => {
    try { localStorage.setItem(AI_RECS_SEEN_KEY, '1'); } catch {}
    setAiRecsSeen(true);
  };

  // Fetch personalized recommendations on first trade-page entry per user.
  // Skipped if: already cached, already dismissed, no profile, or no AI key.
  useEffect(() => {
    if (aiRecsSeen || aiRecs || !user?.profile || aiRecsLoading) return;
    if (!ANTHROPIC_API_KEY && !OPENAI_API_KEY) return;
    let cancelled = false;
    setAiRecsLoading(true);
    (async () => {
      try {
        const profile = user.profile;
        const universe = INSTRUMENTS
          .filter(i => i.cls === 'equity')
          .slice(0, 150)
          .map(i => `${i.id}|${i.name}|${TICKER_SECTORS?.[i.id] ?? 'Other'}`)
          .join('\n');
        const profileSummary = [
          profile.age && `age ${profile.age}`,
          profile.experience && `${profile.experience} experience`,
          profile.riskGoal && `goal: ${profile.riskGoal}`,
          profile.horizon && `horizon: ${profile.horizon}`,
          profile.familySize && `family of ${profile.familySize}`,
        ].filter(Boolean).join(', ');
        const system = 'You are a financial planning assistant. Pick 5 stocks from the AVAILABLE TICKERS that best fit the user\'s investment profile. Return ONLY JSON (no prose, no fences) with this exact shape: {"summary":"one sentence summarizing the recommendation strategy","picks":[{"id":"AAPL","rationale":"one short sentence on why this fits the profile"}]}. Be specific, mention growth/income/stability as appropriate.';
        const prompt = `AVAILABLE TICKERS (id|name|sector):\n${universe}\n\nUSER PROFILE: ${profileSummary}\n\nReturn JSON only.`;
        const response = await callAI(prompt, { maxTokens: 600 });
        if (cancelled) return;
        if (!response) {
          setAiRecsLoading(false);
          return;
        }
        let parsed = null;
        try {
          const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          parsed = JSON.parse(cleaned);
        } catch {
          const m = response.match(/\{[\s\S]*\}/);
          if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
        }
        if (parsed && Array.isArray(parsed.picks)) {
          const validPicks = parsed.picks.filter(p => INSTRUMENTS.some(i => i.id === p.id));
          if (validPicks.length > 0) {
            const result = {
              summary: parsed.summary ?? '',
              picks: validPicks,
              fetchedAt: new Date().toISOString(),
            };
            setAiRecs(result);
            try { localStorage.setItem(AI_RECS_KEY, JSON.stringify(result)); } catch {}
          }
        }
        setAiRecsLoading(false);
      } catch (e) {
        if (!cancelled) setAiRecsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.username, user?.profile, aiRecsSeen, aiRecs, aiRecsLoading]);
  const { w: winW } = useWindowSize();
  // Below 1200px we hide the order book (lowest priority).
  // Below 900px we also hide the order entry pane (Chart-first).
  const showOrderBook = winW >= 1200;
  const showOrderEntry = winW >= 900;

  // First-login prompt — show a one-time "build your layout" banner that
  // guides the user toward customizing the trade page. Tracks per-user via
  // imo_trade_layout_seen so it never reappears once dismissed or actioned.
  const LAYOUT_SEEN_KEY = `imo_trade_layout_seen_${user?.username ?? 'guest'}`;
  const [showLayoutPrompt, setShowLayoutPrompt] = useState(() => {
    try { return localStorage.getItem(LAYOUT_SEEN_KEY) !== '1'; }
    catch { return false; }
  });
  const dismissLayoutPrompt = () => {
    setShowLayoutPrompt(false);
    try { localStorage.setItem(LAYOUT_SEEN_KEY, '1'); } catch {}
  };

  // Workspace tabs — let users embed mini views of other pages alongside the
  // chart so they can monitor portfolio/watchlist/feed without leaving Trade.
  // Each tab is one of: chart | portfolio | watchlist | feed | budget. The
  // active tab determines which content area renders. Persisted per-user.
  const WORKSPACE_KEY = `imo_trade_workspaces_${user?.username ?? 'guest'}`;
  const [workspaces, setWorkspaces] = useState(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      tabs: [{ id: 'chart', label: 'Chart' }],
      active: 'chart',
    };
  });
  const persistWorkspaces = (next) => {
    setWorkspaces(next);
    try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(next)); } catch {}
  };
  // Default workspace tabs ship with one "Chart" tab that has the
  // standard 3-widget layout. Each tab is fully named/save-able and
  // optionally a "single-chart" tab (showing only one chart, no other
  // widgets). Layouts per tab are stored in `tabLayouts` keyed by tab id.
  const [showAddTab, setShowAddTab] = useState(false);
  // Sub-section toggle inside the add-tab dropdown — shows the saved
  // layouts list when expanded so the dropdown stays compact by default.
  const [showSavedLayouts, setShowSavedLayouts] = useState(false);
  const [showRenameTab, setShowRenameTab] = useState(null); // tab id being renamed
  const [renameInput, setRenameInput] = useState('');

  // Add a brand-new named workspace. The user picks a name and chooses
  // either "Full layout" (3-widget default), "Single widget" (one widget
  // of the user's choice), "Same layout" (clones the current tab's
  // layout into the new tab), or "Saved layout" (loads a previously
  // saved layout from the registry).
  const addNamedTab = (name, mode = 'full', singleType = 'chart') => {
    const trimmed = (name || '').trim() || `Workspace ${workspaces.tabs.length + 1}`;
    const newId = `ws-${Date.now()}`;
    const newTab = { id: newId, label: trimmed, mode };
    persistWorkspaces({
      tabs: [...workspaces.tabs, newTab],
      active: newId,
    });
    // Initialize the new tab's layout. Mode-dependent:
    //   single  → just the chosen widget
    //   full    → the standard 2-widget default
    //   same    → clones whatever the currently-active tab has, with
    //             freshly-minted instance ids so widget state doesn't
    //             leak between tabs
    let initialMidOrder;
    if (mode === 'single') {
      initialMidOrder = [singleType];
    } else if (mode === 'same') {
      const currentMid = layout?.midOrder ?? ['orderentry', 'chart'];
      // Re-mint each id's nonce so per-instance state (chart pins,
      // drawings, fundamentals plots, etc.) is independent of the
      // source tab. Plain typed ids (no ::) are passed through and
      // get a nonce minted on first widget interaction.
      initialMidOrder = currentMid.map(id => {
        const type = id.includes('::') ? id.split('::')[0] : id;
        return `${type}::${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      });
    } else {
      initialMidOrder = ['orderentry', 'chart'];
    }
    try {
      const layoutKey = `imo_trade_layout_${user?.username ?? 'guest'}_${newId}`;
      localStorage.setItem(layoutKey, JSON.stringify({
        midOrder: initialMidOrder,
        showBottom: false,
        editing: false,
        presets: [],
      }));
    } catch {}
    setShowAddTab(false);
    setShowSinglePicker(false);
  };
  // Saved-layout registry — per-user collection of named layouts the
  // user can load into a new workspace. Stored as
  // imo_saved_layouts_${username}: [{id, name, midOrder, savedAt}]
  // Save = take whatever's in the active workspace + a name. Load =
  // create a new tab (or replace the current one) with that midOrder.
  const SAVED_LAYOUTS_KEY = `imo_saved_layouts_${user?.username ?? 'guest'}`;
  const [savedLayouts, setSavedLayouts] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_LAYOUTS_KEY) ?? '[]'); }
    catch { return []; }
  });
  const persistSavedLayouts = (next) => {
    setSavedLayouts(next);
    try { localStorage.setItem(SAVED_LAYOUTS_KEY, JSON.stringify(next)); } catch {}
  };
  const saveCurrentLayout = (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const entry = {
      id: `sl-${Date.now()}`,
      name: trimmed,
      midOrder: layout?.midOrder ?? [],
      savedAt: Date.now(),
    };
    persistSavedLayouts([entry, ...savedLayouts.filter(s => s.name !== trimmed)]);
  };
  const loadSavedLayoutAsNewTab = (sl, tabName) => {
    const newId = `ws-${Date.now()}`;
    const newTab = { id: newId, label: (tabName || sl.name || 'Saved layout'), mode: 'full' };
    persistWorkspaces({
      tabs: [...workspaces.tabs, newTab],
      active: newId,
    });
    // Re-mint instance ids so loaded layout doesn't share per-instance
    // state with the saved source.
    const fresh = (sl.midOrder ?? []).map(id => {
      const type = id.includes('::') ? id.split('::')[0] : id;
      return `${type}::${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    });
    try {
      const layoutKey = `imo_trade_layout_${user?.username ?? 'guest'}_${newId}`;
      localStorage.setItem(layoutKey, JSON.stringify({
        midOrder: fresh,
        showBottom: false,
        editing: false,
        presets: [],
      }));
    } catch {}
    setShowAddTab(false);
  };
  const deleteSavedLayout = (id) => {
    persistSavedLayouts(savedLayouts.filter(s => s.id !== id));
  };
  // For the "Single chart" creation flow — show a sub-picker so the
  // user can pick which widget type populates the single-widget tab.
  const [showSinglePicker, setShowSinglePicker] = useState(false);

  const removeTab = (tabId) => {
    if (workspaces.tabs.length <= 1) return; // never remove the last tab
    const remaining = workspaces.tabs.filter(t => t.id !== tabId);
    persistWorkspaces({
      tabs: remaining,
      active: workspaces.active === tabId ? remaining[0].id : workspaces.active,
    });
    try { localStorage.removeItem(`imo_trade_layout_${user?.username ?? 'guest'}_${tabId}`); } catch {}
  };

  // Rename — let users label workspaces (e.g. "Earnings", "Macro day", "Crypto")
  const renameTab = (tabId, newLabel) => {
    const trimmed = (newLabel || '').trim();
    if (!trimmed) return;
    persistWorkspaces({
      ...workspaces,
      tabs: workspaces.tabs.map(t => t.id === tabId ? { ...t, label: trimmed } : t),
    });
    setShowRenameTab(null);
    setRenameInput('');
  };

  // Customizable widget layout — per workspace tab so each named tab
  // saves its own widget arrangement. Single-chart tabs lock to just
  // one widget. Persisted by `${user}_${tabId}`.
  const activeTabId = workspaces.active;
  const activeTabMode = workspaces.tabs.find(t => t.id === activeTabId)?.mode ?? 'full';
  const LAYOUT_KEY = `imo_trade_layout_${user?.username ?? 'guest'}_${activeTabId}`;
  const [layout, setLayout] = useState(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) return JSON.parse(raw);
      // Fall back to the global "starting layout" if one was saved
      const def = localStorage.getItem('imo_trade_layout_default');
      if (def) {
        const parsed = JSON.parse(def);
        return {
          midOrder: parsed.midOrder ?? ['orderentry', 'chart'],
          showBottom: parsed.showBottom === true,
          editing: false,
          presets: [],
        };
      }
    } catch {}
    // Experience-based starter layout. Novices see a friendlier
    // 2-widget layout (just chart + buy/sell) so they aren't
    // overwhelmed. Intermediate and advanced users land on a real
    // institutional 3-widget layout (buy/sell + chart + options) with
    // the bottom panel visible — closer to a Bloomberg / TradingView
    // pro setup. The user can override at any time via Layout editor
    // or the new Superchart preset; this is just the FIRST-RUN
    // experience for users who haven't customized yet.
    //
    // Honor the user's starter-widget picks from sign-up if they made
    // them — those override the experience-based defaults. Maps the
    // sign-up widget IDs to the slot types the trade layout expects.
    // Order is meaningful: first selected = leftmost.
    const starterPicks = user?.profile?.starterWidgets;
    if (Array.isArray(starterPicks) && starterPicks.length > 0) {
      const idMap = {
        chart:       'chart',
        orderentry:  'orderentry',
        orderbook:   'orderbook',
        watchlist:   'watchlist',
        news:        'news',
        positions:   'positionspanel',
        predictions: 'predictions',
        darkflow:    'darkflow',
      };
      const mapped = starterPicks.map(id => idMap[id] ?? id).filter(Boolean);
      if (mapped.length > 0) {
        return {
          midOrder: mapped,
          showBottom: false,
          editing: false,
          presets: [],
        };
      }
    }
    const exp = user?.profile?.experience ?? 'novice';
    if (exp === 'intermediate' || exp === 'advanced') {
      return {
        midOrder: ['orderentry', 'chart', 'optionchain'],
        showBottom: true,
        editing: false,
        presets: [],
      };
    }
    return {
      // Novice default — buy/sell left, chart center.
      midOrder: ['orderentry', 'chart'],
      // Whether the bottom panel is visible — hidden by default for
      // novices to keep the surface uncluttered.
      showBottom: false,
      // Whether the layout-editor banner is open
      editing: false,
      // Saved layout presets
      presets: [],
    };
  });
  const persistLayout = (next) => {
    // For single-chart tabs, lock midOrder to just the chart
    const constrained = activeTabMode === 'single'
      ? { ...next, midOrder: ['chart'] }
      : next;
    setLayout(constrained);
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(constrained)); } catch {}
  };

  // When the active workspace tab changes, reload that tab's layout so
  // each tab keeps its own widget arrangement.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setLayout(parsed);
      } else {
        // No saved layout for this tab → default by mode
        setLayout({
          midOrder: activeTabMode === 'single' ? ['chart'] : ['orderentry', 'chart'],
          showBottom: false,
          editing: false,
          presets: [],
        });
      }
    } catch {}
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag-and-drop reorder for mid-row widgets. INSERT semantics — drag
  // widget A onto widget C and A is *moved* to C's position with the
  // others shifting around it (rather than swapping A and C). This
  // matches how every other modern card-grid behaves.
  const [dragging, setDragging] = useState(null);
  const handleDragStart = (id) => () => setDragging(id);
  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (targetId) => (e) => {
    e.preventDefault();
    if (!dragging || dragging === targetId) return;
    const order = [...layout.midOrder];
    const fromIdx = order.indexOf(dragging);
    const toIdx = order.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    // Remove from original position, then insert before the target
    const [moved] = order.splice(fromIdx, 1);
    // After the splice, target's index may have shifted by 1
    const insertAt = order.indexOf(targetId);
    order.splice(insertAt, 0, moved);
    persistLayout({ ...layout, midOrder: order });
    setDragging(null);
  };

  // Render a widget by id
  // Widget catalog — every widget the user can add to the trade page mesh.
  // Each entry has an id, label (used in the picker), and an emoji icon.
  // The renderer dispatches by id to the actual component below.
  // Each widget has a preferred aspect: 'wide' (charts, heatmaps),
  // 'narrow' (order book, buy/sell, lists), 'square' (everything else).
  // The grid layout uses these hints to size cells naturally — wide
  // widgets get stretched horizontally, narrow widgets get a thin column.
  const WIDGET_CATALOG = [
    // ─── Trading ───
    { id: 'chart',          label: 'Stock chart',         aspect: 'wide',   category: 'Trading'    },
    { id: 'orderbook',      label: 'Order book',          aspect: 'narrow', category: 'Trading'    },
    { id: 'orderentry',     label: 'Buy / Sell',          aspect: 'narrow', category: 'Trading'    },
    { id: 'volprofile',     label: 'Volume by Price',     aspect: 'narrow', category: 'Trading'    },
    { id: 'optionchain',    label: 'Options Chain',       aspect: 'narrow', category: 'Trading'    },
    // ─── Analytics ───
    { id: 'netflow',        label: 'Net flow',            aspect: 'wide',   category: 'Analytics'  },
    { id: 'darkflow',       label: 'Dark pool flow',      aspect: 'square', category: 'Analytics'  },
    { id: 'volskew',        label: 'Volatility skew',     aspect: 'wide',   category: 'Analytics'  },
    { id: 'voldrift',       label: 'Volatility drift',    aspect: 'wide',   category: 'Analytics'  },
    { id: 'comp',           label: 'Comparables',         aspect: 'wide',   category: 'Analytics'  },
    { id: 'fundmini',       label: 'Fundamentals',        aspect: 'square', category: 'Analytics'  },
    // ─── Market overview ───
    { id: 'heatmap',        label: 'Sector heat map',     aspect: 'wide',   category: 'Market'     },
    { id: 'gainers',        label: 'Gainers / Losers',    aspect: 'narrow', category: 'Market'     },
    // ─── News & sentiment ───
    { id: 'newsfeed',       label: 'News',                aspect: 'narrow', category: 'News'       },
    { id: 'wsbmini',        label: 'WSB Sentiment',       aspect: 'narrow', category: 'News'       },
    { id: 'feedmini',       label: 'Feed',                aspect: 'narrow', category: 'News'       },
    { id: 'discussmini',    label: 'Discussion',          aspect: 'narrow', category: 'News'       },
    { id: 'video',          label: 'Video',               aspect: 'wide',   category: 'News'       },
    // ─── Macro & regulatory ───
    { id: 'secfilings',     label: 'SEC Filings',         aspect: 'narrow', category: 'Macro'      },
    { id: 'treasury',       label: 'Treasury Rates',      aspect: 'narrow', category: 'Macro'      },
    { id: 'macroind',       label: 'Macro Indicators',    aspect: 'narrow', category: 'Macro'      },
    { id: 'localcond',      label: 'Local Conditions',    aspect: 'narrow', category: 'Macro'      },
    { id: 'corpactions',    label: 'Corporate Actions',   aspect: 'narrow', category: 'Macro'      },
    // ─── AI ───
    { id: 'avatar',         label: 'AI Advisor',          aspect: 'square', category: 'AI'         },
    // ─── Account & social ───
    { id: 'portfoliomini',  label: 'Portfolio',           aspect: 'square', category: 'Account'    },
    { id: 'calendarmini',   label: 'Calendar',            aspect: 'square', category: 'Account'    },
    { id: 'swapmini',       label: 'Swap',                aspect: 'narrow', category: 'Trading'    },
    { id: 'autopilotmini',  label: 'Autopilot',           aspect: 'narrow', category: 'Account'    },
    { id: 'watchmini',      label: 'Watchlist',           aspect: 'narrow', category: 'Account'    },
    { id: 'predmini',       label: 'Predictions',         aspect: 'narrow', category: 'Account'    },
    { id: 'msgmini',        label: 'Messages',            aspect: 'narrow', category: 'Account'    },
    { id: 'terminalmini',   label: 'Terminal',            aspect: 'wide',   category: 'Account'    },
    // ─── Bottom-panel tabs as widgets ───
    // Every tab from the bottom panel is also available as a draggable
    // widget so users who never expand the bottom panel can still pin
    // these views directly into their layout grid.
    { id: 'positionswidget',     label: 'Positions',         aspect: 'wide',   category: 'Panel'      },
    { id: 'orderswidget',        label: 'Open orders',       aspect: 'wide',   category: 'Panel'      },
    { id: 'historywidget',       label: 'Trade history',     aspect: 'wide',   category: 'Panel'      },
    { id: 'chainwidget',         label: 'Chain events',      aspect: 'narrow', category: 'Panel'      },
    { id: 'riskwidget',          label: 'Risk',              aspect: 'narrow', category: 'Panel'      },
    { id: 'sentimentwidget',     label: 'Sentiment',         aspect: 'narrow', category: 'Panel'      },
    { id: 'optionswidget',       label: 'Options activity',  aspect: 'wide',   category: 'Panel'      },
    { id: 'unusualwidget',       label: 'Unusual options',   aspect: 'wide',   category: 'Panel'      },
    { id: 'trendswidget',        label: 'Trading trends',    aspect: 'wide',   category: 'Panel'      },
    { id: 'priceanalysiswidget', label: 'Price analysis',    aspect: 'wide',   category: 'Panel'      },
    { id: 'esgwidget',           label: 'Fraud + ESG',       aspect: 'narrow', category: 'Panel'      },
    { id: 'moatwidget',          label: 'Moat score',        aspect: 'narrow', category: 'Panel'      },
    { id: 'newstabwidget',       label: 'News (full)',       aspect: 'wide',   category: 'Panel'      },
  ];
  // Widget categories — render order in the picker. Each renders as a
  // collapsible section. "All" shows everything in a flat list.
  const WIDGET_CATEGORIES = ['All', 'Trading', 'Analytics', 'AI', 'Market', 'News', 'Macro', 'Account', 'Panel'];
  // State for the widget-picker modal (+ button menu)
  const [showAddWidget, setShowAddWidget] = useState(false);
  // Picker category filter — All by default. When a specific category is
  // selected, only widgets in that category are shown.
  const [pickerCategory, setPickerCategory] = useState('All');
  const [pickerSearch, setPickerSearch] = useState('');
  // Wrap a child in the standard liquid-glass shell with a drag handle
  // at the top. Widgets are always draggable (not just in edit mode) so
  // users can reorder live. Dropping on another widget swaps positions.
  //
  // Apple-liquid-glass effect: a translucent surface tint, backdrop-filter
  // blur+saturate, and a 1px inner highlight on the top edge to suggest a
  // refractive glass pane. Looks particularly good over the chart's dynamic
  // gradient. The surface still falls back to a solid color on browsers
  // without backdrop-filter (Safari + Chrome have it, Firefox needs flag).
  const wrap = (id, child) => {
    // Stack handler — adds another instance of THIS widget type to the
    // layout. Instance ids use the format "type::nonce" so duplicates
    // are unique. We extract the base type from the current id and
    // append a fresh nonce.
    const handleStack = () => {
      const baseType = id.includes('::') ? id.split('::')[0] : id;
      const newId = `${baseType}::${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      persistLayout({ ...layout, midOrder: [...layout.midOrder, newId] });
    };
    // Inject onStack into the child if it's a TradeMiniView. We detect
    // by checking the child's props for the `title` field — TradeMiniView
    // is the only consistent wrapper across all panel widgets. Other
    // wrappers (raw <div>, etc.) won't receive the prop and the inline
    // + button simply won't render.
    const childWithStack = (child && child.props && child.props.title)
      ? React.cloneElement(child, { onStack: handleStack })
      : child;
    return (
    <div key={id}
         onDragOver={handleDragOver}
         onDrop={handleDrop(id)}
         className="relative w-full h-full min-w-0 min-h-0 flex flex-col group imo-glass-widget"
         style={{
           borderRadius: 14,
           // Softened border — was 0.06 white, now 0.04 + a thin colored tint
           // line on the very inside edge for the refractive feel.
           border: `1px solid rgba(255,255,255,0.04)`,
           // Layered background: solid surface + a very subtle iridescent
           // gradient sweep that suggests glass. The gradient is so muted
           // (~3% opacity) that it doesn't compete with content but adds
           // depth like the reference image.
           background: `
             linear-gradient(135deg, rgba(120,150,255,0.04) 0%, transparent 35%, rgba(180,140,250,0.03) 100%),
             ${COLORS.surface}
           `,
           // Removed backdrop-filter to prevent color-bleed from neighboring
           // widgets (red order book rows etc). The frosted look comes from
           // the gradient overlay above + edge highlights below, not from
           // an actual backdrop blur.
           // Three-layer shadow:
           //   1. Outer drop shadow for depth
           //   2. Inner top edge highlight (1px white) — light catches glass
           //   3. Inner ALL-edges hairline (very subtle) — refraction tone
           boxShadow: `
             0 8px 24px rgba(0,0,0,0.22),
             0 1px 0 rgba(255,255,255,0.06) inset,
             0 0 0 1px rgba(255,255,255,0.015) inset
           `,
           overflow: 'hidden',
           outline: dragging === id
             ? `2px dashed ${COLORS.mint}`
             : layout.editing ? `1px dashed rgba(255,255,255,0.08)` : 'none',
         }}>
      {/* Top-edge highlight overlay — a 1px line that catches "light" along
          the upper rim of the glass pane. Combined with the gradient bg this
          gives the reference image's frosted pane feel without using backdrop-
          filter (which was causing color bleed from neighbors). */}
      <div className="absolute top-0 left-4 right-4 pointer-events-none"
           style={{
             height: 1,
             background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.10) 50%, transparent)',
             zIndex: 1,
           }} />
      {/* Drag handle — small dotted bar at top-center. Hover anywhere
          on the widget reveals it; grabbing here lets the user drag the
          widget to swap with another one. */}
      <div
        draggable
        onDragStart={handleDragStart(id)}
        onDragEnd={() => setDragging(null)}
        className="absolute top-1 left-1/2 -translate-x-1/2 z-20 flex items-center justify-center opacity-30 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
        style={{
          width: 36, height: 16,
          color: COLORS.textMute,
        }}
        title="Drag to swap with another widget">
        <svg width="20" height="6" viewBox="0 0 20 6" fill="none">
          <circle cx="3" cy="2" r="1" fill="currentColor" />
          <circle cx="10" cy="2" r="1" fill="currentColor" />
          <circle cx="17" cy="2" r="1" fill="currentColor" />
          <circle cx="3" cy="5" r="1" fill="currentColor" />
          <circle cx="10" cy="5" r="1" fill="currentColor" />
          <circle cx="17" cy="5" r="1" fill="currentColor" />
        </svg>
      </div>
      {/* Widget controls — visible on hover. × removes the widget; +
          opens a quick-replace picker. */}
      <div className="absolute top-1 right-1 z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
           style={{ opacity: layout.editing ? 1 : undefined }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setReplaceSlotIdx(layout.midOrder.indexOf(id));
            setShowAddWidget(true);
          }}
          className="w-5 h-5 rounded-full flex items-center justify-center text-[12px] transition-transform"
          style={{ background: 'rgba(0,0,0,0.7)', color: COLORS.mint, border: `1px solid ${COLORS.mint}55` }}
          title="Replace this widget with a different one">+</button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            persistLayout({ ...layout, midOrder: layout.midOrder.filter(x => x !== id) });
          }}
          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] transition-transform"
          style={{ background: 'rgba(0,0,0,0.7)', color: '#FFF', border: '1px solid rgba(255,255,255,0.2)' }}
          title="Remove widget">×</button>
      </div>
      {childWithStack}
    </div>
    );
  };

  // Track which slot the user wants to replace via the + button on a
  // widget header. -1 means "append" (regular + Add tile); >=0 means
  // swap that index when a widget is picked.
  const [replaceSlotIdx, setReplaceSlotIdx] = useState(-1);

  // Listen for global stack-widget events fired from inside widgets that
  // don't have direct access to the layout state (e.g. the chart's stack
  // + button). The handler appends a new instance of the requested type.
  // Uses a ref to read the latest layout to avoid stale closure issues.
  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => {
    const handler = (e) => {
      const baseType = e?.detail?.type;
      if (!baseType) return;
      const newId = `${baseType}::${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const current = layoutRef.current;
      persistLayout({ ...current, midOrder: [...(current?.midOrder ?? []), newId] });
    };
    window.addEventListener('imo:stack-widget', handler);
    return () => window.removeEventListener('imo:stack-widget', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderWidget = (id) => {
    // Instance ids are formatted "type::nonce" so we split off the type
    // to dispatch. Widgets without :: (legacy) still match directly.
    const type = id.includes('::') ? id.split('::')[0] : id;
    if (type === 'chart') {
      return wrap(id, <ChartWithSubcharts instrument={active} livePrice={feed.price} instanceId={id} user={user} account={account} />);
    }
    if (type === 'orderbook' && showOrderBook) {
      return wrap(id, <OrderBook book={book} instrument={active} mid={feed.price} onOptionTrade={onOptionTrade} />);
    }
    if (type === 'orderentry' && showOrderEntry) {
      return wrap(id, <OrderEntry instrument={active} markPrice={feed.price} account={account} user={user} onOpenPosition={onOpenPosition} />);
    }
    // ── New widget types — each is a compact mini-view that pulls the same
    //    data the full page does but renders in the trade mesh. ──
    if (type === 'volprofile') {
      // Real volume-by-price (TPO) — shows volume traded at each price level
      // over the selected lookback. Vertical price axis, horizontal bars.
      return wrap(id, (
        <TradeMiniView title="Volume by Price">
          <VolumeProfileMini instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'optionchain') {
      // Standalone Options Chain widget — wraps OptionsChain in a
      // TradeMiniView so it can sit alongside the chart and order
      // entry as a peer widget (rather than only being accessible
      // via the Chart's internal "Options" tab). Used by the
      // intermediate / advanced experience-based default layout
      // where the institutional setup is buy-sell + chart + options.
      return wrap(id, (
        <TradeMiniView title="Options Chain">
          <OptionsChain instrument={active} spot={feed.price} onOptionTrade={onOptionTrade} />
        </TradeMiniView>
      ));
    }
    if (type === 'netflow') {
      return wrap(id, (
        <TradeMiniView title="Net flow">
          <NetFlowMini instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'darkflow') {
      return wrap(id, (
        <TradeMiniView title="Dark pool flow">
          <DarkFlowMini instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'heatmap') {
      return wrap(id, (
        <TradeMiniView title="Sector heat map">
          <SectorHeatMapMini />
        </TradeMiniView>
      ));
    }
    if (type === 'gainers') {
      // Click any row to load that ticker. Try to match local catalog;
      // fall back to a synthetic instrument when the ticker isn't local.
      const handleSelect = (ticker) => {
        const inst = INSTRUMENTS.find(i => i.id === ticker);
        if (inst) {
          setActive(inst);
        } else {
          window.imoToast?.(`${ticker} isn't in the local catalog — opening anyway`, 'info');
          setActive({
            id: ticker, cls: 'equity', name: ticker, chain: 6,
            mark: 100, vol24h: 1e9, oi: 1e8, change24h: 0, funding: 0, dec: 2,
          });
        }
      };
      return wrap(id, (
        <TradeMiniView title="Gainers / Losers">
          <GainersLosersMini onSelect={handleSelect} />
        </TradeMiniView>
      ));
    }
    if (type === 'volskew') {
      return wrap(id, (
        <TradeMiniView title="Volatility skew">
          <VolSkewMini instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'voldrift') {
      return wrap(id, (
        <TradeMiniView title="Volatility drift">
          <VolDriftMini instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'newsfeed') {
      return wrap(id, (
        <TradeMiniView title="News">
          <NewsFeedMini instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'portfoliomini') {
      return wrap(id, (
        <TradeMiniView title="Portfolio" onExpand={() => setPage?.('portfolio')}>
          <PortfolioMini account={account} />
        </TradeMiniView>
      ));
    }
    if (type === 'calendarmini') {
      return wrap(id, (
        <TradeMiniView title="Calendar" onExpand={() => setPage?.('portfolio')}>
          <CalendarMini account={account} user={user} />
        </TradeMiniView>
      ));
    }
    if (type === 'swapmini') {
      return wrap(id, (
        <TradeMiniView title="Swap">
          <SwapMini account={account} instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'autopilotmini') {
      return wrap(id, (
        <TradeMiniView title="Autopilot" onExpand={() => setPage?.('portfolio')}>
          <AutopilotMini user={user} account={account} onOpenPosition={onOpenPosition} />
        </TradeMiniView>
      ));
    }
    if (type === 'feedmini') {
      return wrap(id, (
        <TradeMiniView title="Feed" onExpand={() => setPage?.('feed')}>
          <FeedMini user={user} />
        </TradeMiniView>
      ));
    }
    if (type === 'video') {
      return wrap(id, (
        <TradeMiniView title="Video">
          <VideoMini />
        </TradeMiniView>
      ));
    }
    if (type === 'discussmini') {
      return wrap(id, (
        <TradeMiniView title="Discussion" onExpand={() => setPage?.('discuss')}>
          <DiscussMini user={user} />
        </TradeMiniView>
      ));
    }
    if (type === 'watchmini') {
      return wrap(id, (
        <TradeMiniView title="Watchlist" onExpand={() => setPage?.('watchlist')}>
          <WatchlistMini account={account} onSelect={setActive} />
        </TradeMiniView>
      ));
    }
    if (type === 'terminalmini') {
      // Real mini-terminal preview — shows live geographic news pings
      // (Exa-powered if key set) with country/region tags so the user
      // gets a glanceable view of what's happening on the Terminal.
      return wrap(id, (
        <TradeMiniView title="Terminal" onExpand={() => setPage?.('terminal')}>
          <TerminalMini />
        </TradeMiniView>
      ));
    }
    if (type === 'predmini') {
      return wrap(id, (
        <TradeMiniView title="Predictions" onExpand={() => setPage?.('predictions')}>
          <PredictionsMini />
        </TradeMiniView>
      ));
    }
    if (type === 'msgmini') {
      return wrap(id, (
        <TradeMiniView title="Messages" onExpand={() => setPage?.('messages')}>
          <MessagesMini user={user} />
        </TradeMiniView>
      ));
    }
    if (type === 'avatar') {
      return wrap(id, (
        <TradeMiniView title="AI Advisor">
          <AvatarMini instrument={active} account={account} portfolioSource={portfolioSource} />
        </TradeMiniView>
      ));
    }
    if (type === 'fundmini') {
      return wrap(id, (
        <TradeMiniView title={`Fundamentals · ${active?.id ?? '—'}`}>
          <FundamentalsMini instrument={active} onOpenFundamentals={() => setFundamentalsOpen(true)} />
        </TradeMiniView>
      ));
    }
    if (type === 'wsbmini') {
      return wrap(id, (
        <TradeMiniView title="r/WSB Sentiment">
          <WSBSentimentMini onSelect={(ticker) => {
            const inst = (typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS : []).find(i => i.id === ticker);
            if (inst) setActive(inst);
          }} />
        </TradeMiniView>
      ));
    }
    if (type === 'secfilings') {
      return wrap(id, (
        <TradeMiniView title="SEC Filings">
          <SECFilingsMini instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'treasury') {
      return wrap(id, (
        <TradeMiniView title="Treasury Rates">
          <TreasuryRatesMini />
        </TradeMiniView>
      ));
    }
    if (type === 'macroind') {
      return wrap(id, (
        <TradeMiniView title="Macro Indicators">
          <MacroIndicatorsMini />
        </TradeMiniView>
      ));
    }
    if (type === 'localcond') {
      return wrap(id, (
        <TradeMiniView title="Local Conditions">
          <LocalConditionsMini />
        </TradeMiniView>
      ));
    }
    if (type === 'corpactions') {
      return wrap(id, (
        <TradeMiniView title="Corporate Actions">
          <CorporateActionsMini instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'comp') {
      return wrap(id, (
        <TradeMiniView title={`Comparables · ${active.id}`}>
          <CompWidget instrument={active} />
        </TradeMiniView>
      ));
    }
    // ── Bottom-panel tabs as widgets — each uses a compact variant
    //    designed to fit narrow widget cells. The full version is still
    //    available in the bottom panel itself. ──
    if (type === 'positionswidget') {
      return wrap(id, (
        <TradeMiniView title="Positions">
          <CompactPositions account={account} markPrice={feed.price} instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'orderswidget') {
      return wrap(id, (
        <TradeMiniView title="Open orders">
          <CompactOrders account={account} />
        </TradeMiniView>
      ));
    }
    if (type === 'historywidget') {
      return wrap(id, (
        <TradeMiniView title="Trade history">
          <CompactHistory account={account} instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'chainwidget') {
      return wrap(id, (
        <TradeMiniView title="Chain events">
          <CompactChainEvents />
        </TradeMiniView>
      ));
    }
    if (type === 'riskwidget') {
      return wrap(id, (
        <TradeMiniView title="Risk">
          <CompactRisk account={account} />
        </TradeMiniView>
      ));
    }
    if (type === 'sentimentwidget') {
      return wrap(id, (
        <TradeMiniView title="Sentiment">
          <CompactSentiment instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'optionswidget') {
      return wrap(id, (
        <TradeMiniView title="Options activity">
          <CompactOptions instrument={active} markPrice={feed.price} />
        </TradeMiniView>
      ));
    }
    if (type === 'unusualwidget') {
      return wrap(id, (
        <TradeMiniView title="Unusual options">
          <CompactOptions instrument={active} markPrice={feed.price} />
        </TradeMiniView>
      ));
    }
    if (type === 'trendswidget') {
      return wrap(id, (
        <TradeMiniView title="Trading trends">
          <CompactTrends instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'priceanalysiswidget') {
      return wrap(id, (
        <TradeMiniView title="Price analysis">
          <CompactPriceAnalysis instrument={active} markPrice={feed.price} />
        </TradeMiniView>
      ));
    }
    if (type === 'esgwidget') {
      return wrap(id, (
        <TradeMiniView title="Fraud + ESG">
          <CompactESG instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'moatwidget') {
      return wrap(id, (
        <TradeMiniView title="Moat score">
          <CompactMoat instrument={active} />
        </TradeMiniView>
      ));
    }
    if (type === 'newstabwidget') {
      return wrap(id, (
        <TradeMiniView title="News">
          <CompactNewsTab instrument={active} />
        </TradeMiniView>
      ));
    }
    return null;
  };

  return (
    <>
      <InstrumentHeader
        instrument={active}
        feed={feed}
        account={account}
        onOpenPicker={() => setPickerOpen(true)}
        isWatched={(account?.watchlist ?? []).includes(active.id)}
        onToggleWatch={onToggleWatch}
        onOpenTerminal={onOpenTerminal}
        onSelect={setActive}
        onEditLayout={() => persistLayout({ ...layout, editing: true })}
        hasOrderEntry={layout.midOrder.some(id => (id.split('::')[0] ?? id) === 'orderentry')}
        onQuickTrade={(side) => setQuickTradeSide(side)}
        onOpenAI={onOpenAI}
        onOpenScreener={() => setScreenerOpen(true)}
      />
      {/* First-login layout-build prompt — shown once per user. Encourages
          customizing the default 3-widget setup (chart/orderbook/orderentry)
          with the + Add system. Dismissible with × or via Build button. */}
      {showLayoutPrompt && !layout.editing && (
        <div className="px-4 py-2.5 flex items-center justify-between border-b shrink-0 gap-3 flex-wrap"
             style={{
               background: `linear-gradient(90deg, rgba(61,123,255,0.10) 0%, rgba(61,123,255,0.04) 100%)`,
               borderColor: COLORS.mint,
             }}>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium" style={{ color: COLORS.mint }}>
                Welcome — build your trade layout
              </div>
              <div className="text-[10.5px]" style={{ color: COLORS.textDim }}>
                Add charts, mini-views, news, fundamentals, watchlist… up to 6 widgets in any arrangement.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => { persistLayout({ ...layout, editing: true }); dismissLayoutPrompt(); }}
                    className="px-3 py-1.5 rounded-md text-[11.5px] font-medium hover:opacity-90"
                    style={{ background: COLORS.mint, color: COLORS.bg }}>
              Build my layout →
            </button>
            <button onClick={dismissLayoutPrompt}
                    className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/[0.06]"
                    style={{ color: COLORS.textMute }}
                    title="Dismiss — won't show again">×</button>
          </div>
        </div>
      )}
      {/* AI personalized recommendations banner — shown once per user when
          the AI has computed picks based on their profile. Click any chip
          to load that ticker as the active instrument. Dismissed permanently
          via × — won't reappear for that user. */}
      {!aiRecsSeen && aiRecs && aiRecs.picks?.length > 0 && !showLayoutPrompt && !layout.editing && (
        <div className="px-4 py-2.5 border-b shrink-0"
             style={{
               background: `linear-gradient(90deg, rgba(61,123,255,0.10) 0%, rgba(61,123,255,0.02) 100%)`,
               borderColor: COLORS.mint,
             }}>
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-start gap-2 min-w-0">
              <Sparkles size={14} style={{ color: COLORS.mint, marginTop: 2 }} />
              <div className="min-w-0">
                <div className="text-[12px] font-medium" style={{ color: COLORS.mint }}>
                  Stocks for you · AI picks
                </div>
                <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textDim }}>
                  {aiRecs.summary || 'Based on your profile'}
                </div>
              </div>
            </div>
            <button onClick={dismissAiRecs}
                    className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-white/[0.06] shrink-0"
                    style={{ color: COLORS.textMute }}
                    title="Dismiss — won't show again">×</button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {aiRecs.picks.map(p => {
              const inst = INSTRUMENTS.find(i => i.id === p.id);
              if (!inst) return null;
              return (
                <button key={p.id}
                        onClick={() => setActive(inst)}
                        className="px-2.5 py-1 rounded-md text-[11px] flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                        style={{
                          background: COLORS.surface,
                          border: `1px solid ${COLORS.border}`,
                          color: COLORS.text,
                        }}
                        title={p.rationale}>
                  <InstIcon cls={inst.cls} size={12} ticker={inst.id} />
                  <span className="font-medium">{inst.id}</span>
                  <span className="text-[9.5px]" style={{ color: COLORS.textMute }}>·</span>
                  <span className="text-[9.5px] truncate" style={{ color: COLORS.textDim, maxWidth: 220 }}>{p.rationale}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* Layout editor banner — only visible while editing */}
      {layout.editing && (
        <div className="px-4 py-2 flex items-center justify-between border-b shrink-0 flex-wrap gap-2"
             style={{ background: 'rgba(61,123,255,0.06)', borderColor: COLORS.mint }}>
          <div className="text-[11.5px]" style={{ color: COLORS.mint }}>
            Layout editor — drag widgets to reorder, save presets, set as default
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => persistLayout({ ...layout, showBottom: !layout.showBottom })}
                    className="text-[10.5px] px-2 py-1 rounded border"
                    style={{ color: COLORS.text, borderColor: COLORS.border, background: COLORS.surface }}>
              {layout.showBottom ? 'Hide bottom panel' : 'Show bottom panel'}
            </button>
            {/* Superchart — one-click prebuilt layout that mirrors a
                Bloomberg / TradingView institutional setup: chart in
                the dominant slot, order entry left, order book right,
                positions panel below. Resets midOrder to the canonical
                three-widget arrangement and pops the bottom panel
                open. Useful for users who customized their layout and
                want to snap back to a known-good professional config. */}
            <button onClick={() => {
              persistLayout({
                ...layout,
                midOrder: ['orderentry', 'chart', 'orderbook'],
                showBottom: true,
                editing: false,
              });
            }}
                    className="text-[10.5px] px-2 py-1 rounded border font-medium"
                    style={{
                      color: COLORS.mint,
                      borderColor: COLORS.mint,
                      background: 'rgba(61,123,255,0.08)',
                    }}
                    title="Apply Superchart layout — chart center, buy/sell left, order book right, positions below">
              ⚡ Superchart
            </button>
            {/* Save current layout as a named preset */}
            <button onClick={() => {
              const name = prompt('Name this layout preset:', `Layout ${(layout.presets ?? []).length + 1}`);
              if (!name) return;
              const presets = [...(layout.presets ?? []), {
                id: `p_${Date.now()}`,
                name,
                midOrder: layout.midOrder,
                showBottom: layout.showBottom,
              }];
              persistLayout({ ...layout, presets });
            }}
                    className="text-[10.5px] px-2 py-1 rounded border"
                    style={{ color: COLORS.text, borderColor: COLORS.border, background: COLORS.surface }}>
              Save preset
            </button>
            {/* Load saved presets */}
            {(layout.presets ?? []).length > 0 && (
              <select onChange={(e) => {
                if (!e.target.value) return;
                const p = (layout.presets ?? []).find(x => x.id === e.target.value);
                if (p) persistLayout({ ...layout, midOrder: p.midOrder, showBottom: p.showBottom });
              }}
                      className="text-[10.5px] px-2 py-1 rounded border outline-none"
                      style={{ color: COLORS.text, borderColor: COLORS.border, background: COLORS.surface, colorScheme: 'dark' }}
                      defaultValue="">
                <option value="">Load preset…</option>
                {(layout.presets ?? []).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            {/* Set current as the global default — saved to a separate key */}
            <button onClick={() => {
              try {
                localStorage.setItem('imo_trade_layout_default', JSON.stringify({
                  midOrder: layout.midOrder,
                  showBottom: layout.showBottom,
                }));
                alert('This layout is now the default for new sessions.');
              } catch {}
            }}
                    className="text-[10.5px] px-2 py-1 rounded border"
                    style={{ color: COLORS.mint, borderColor: COLORS.mint, background: 'rgba(61,123,255,0.05)' }}
                    title="Save as the default layout for any new session of this app">
              ⭐ Set as starting layout
            </button>
            <button onClick={() => persistLayout({
              midOrder: ['orderentry', 'chart'],
              showBottom: false,
              editing: true,
              presets: layout.presets,
            })}
                    className="text-[10.5px] px-2 py-1 rounded border"
                    style={{ color: COLORS.textDim, borderColor: COLORS.border, background: COLORS.surface }}>
              Reset
            </button>
            <button onClick={() => persistLayout({ ...layout, editing: false })}
                    className="text-[10.5px] px-2 py-1 rounded font-medium"
                    style={{ color: COLORS.bg, background: COLORS.mint }}>
              Done
            </button>
          </div>
        </div>
      )}
      {/* Workspace tabs — every tab is a named, save-able trade workspace
          with its own widget layout. + Add creates a new tab; user picks
          a name and whether it's "Full layout" (3-widget default) or
          "Single chart" (just one chart, no other widgets). */}
      <div className="flex items-center gap-1 px-3 py-0.5 border-b shrink-0"
           style={{ borderColor: COLORS.border, background: COLORS.bg }}>
        {workspaces.tabs.map(t => {
          const isActive = workspaces.active === t.id;
          const isRenaming = showRenameTab === t.id;
          return (
            <div key={t.id} className="group relative flex items-center">
              {isRenaming ? (
                <input value={renameInput}
                       autoFocus
                       onChange={e => setRenameInput(e.target.value)}
                       onBlur={() => { renameTab(t.id, renameInput); }}
                       onKeyDown={e => {
                         if (e.key === 'Enter') renameTab(t.id, renameInput);
                         if (e.key === 'Escape') { setShowRenameTab(null); setRenameInput(''); }
                       }}
                       className="px-3 py-1 text-[11.5px] rounded-md outline-none"
                       style={{ width: 120, background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.mint}` }} />
              ) : (
                <button onClick={() => persistWorkspaces({ ...workspaces, active: t.id })}
                        onDoubleClick={() => { setShowRenameTab(t.id); setRenameInput(t.label); }}
                        className="px-2.5 py-0.5 text-[11.5px] rounded-md transition-colors flex items-center gap-1.5"
                        style={{
                          background: isActive ? COLORS.surface : 'transparent',
                          color: isActive ? COLORS.text : COLORS.textDim,
                          border: isActive ? `1px solid ${COLORS.border}` : '1px solid transparent',
                        }}
                        title="Click to switch · double-click to rename">
                  {t.mode === 'single' && (
                    <span className="text-[8.5px] px-1 py-0.5 rounded"
                          style={{ background: `${COLORS.mint}22`, color: COLORS.mint, border: `1px solid ${COLORS.mint}55`, fontFamily: 'ui-monospace, monospace' }}
                          title="Single-chart workspace">1C</span>
                  )}
                  {t.label}
                </button>
              )}
              {workspaces.tabs.length > 1 && !isRenaming && (
                <button onClick={(e) => { e.stopPropagation(); removeTab(t.id); }}
                        className="ml-0.5 opacity-0 group-hover:opacity-100 px-1 text-[10px] hover:bg-white/[0.06] rounded transition-all"
                        style={{ color: COLORS.textMute }}
                        title={`Remove ${t.label}`}>×</button>
              )}
            </div>
          );
        })}
        <div className="relative">
          <button onClick={() => setShowAddTab(s => !s)}
                  className="px-1.5 py-0 text-[10.5px] rounded transition-colors hover:bg-white/[0.05]"
                  style={{ color: COLORS.mint }}
                  title="Add a workspace tab">
            + Add
          </button>
          {showAddTab && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowAddTab(false)} />
              <div className="absolute left-0 top-full mt-1 w-80 rounded-md border z-40 overflow-hidden"
                   style={{ background: COLORS.surface, borderColor: COLORS.borderHi, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                {/* "Add a widget" entry removed per UX feedback — the
                    +Add button is for creating new workspaces, not
                    adding individual widgets to the current layout.
                    Users who want to add a widget can use the "+Add"
                    cell that appears as a dashed-border tile inside
                    the current layout itself. */}
                {/* Workspace creation — name input shared by the four
                    layout options below. */}
                <div className="px-3 py-2.5 border-b" style={{ borderColor: COLORS.border }}>
                  <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                    Create a new workspace
                  </div>
                  <input id="new-tab-name"
                         placeholder="Name (optional)"
                         className="w-full px-2 py-1.5 text-[12px] rounded outline-none"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                         onKeyDown={(e) => {
                           if (e.key === 'Enter') addNamedTab(e.currentTarget.value, 'full');
                         }} />
                </div>
                {/* Same layout — clones the active workspace's widget
                    set into a new tab so the user gets a duplicate to
                    experiment with without losing the original. */}
                <button onClick={() => {
                          const inp = /** @type {HTMLInputElement | null} */ (document.getElementById('new-tab-name'));
                          addNamedTab(inp?.value, 'same');
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-white/[0.04] border-b transition-colors"
                        style={{ borderColor: COLORS.border }}>
                  <div className="text-[12px] font-medium" style={{ color: COLORS.text }}>Same layout</div>
                  <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textMute }}>
                    Clone what's on this tab into a new one — independent state, identical widgets.
                  </div>
                </button>
                {/* Saved layouts — opens a sub-list of previously saved
                    layouts the user can pick from. Empty-state shows a
                    "save current" affordance so first-time users know
                    how the registry gets populated. */}
                <button onClick={() => setShowSavedLayouts(s => !s)}
                        className="w-full text-left px-3 py-2.5 hover:bg-white/[0.04] border-b transition-colors flex items-center justify-between"
                        style={{ borderColor: COLORS.border }}>
                  <div>
                    <div className="text-[12px] font-medium" style={{ color: COLORS.text }}>
                      Saved layouts
                      {savedLayouts.length > 0 && (
                        <span className="ml-1.5 text-[10px] tabular-nums px-1.5 py-0.5 rounded"
                              style={{ background: `${COLORS.mint}22`, color: COLORS.mint }}>
                          {savedLayouts.length}
                        </span>
                      )}
                    </div>
                    <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textMute }}>
                      Load a layout you saved earlier, or save the current one.
                    </div>
                  </div>
                  <span className="text-[12px]" style={{ color: COLORS.textMute }}>
                    {showSavedLayouts ? '▾' : '▸'}
                  </span>
                </button>
                {showSavedLayouts && (
                  <div className="px-3 py-2 border-b max-h-60 overflow-y-auto"
                       style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                    {/* Save-current — type a name + click save. The
                        button is in-modal so users don't need to leave
                        the dropdown to populate the registry. */}
                    <div className="flex items-center gap-1.5 mb-2">
                      <input id="save-layout-name"
                             placeholder="Save current as…"
                             className="flex-1 min-w-0 px-2 py-1 text-[11px] rounded outline-none"
                             style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                             onKeyDown={(e) => {
                               if (e.key === 'Enter') {
                                 saveCurrentLayout(e.currentTarget.value);
                                 e.currentTarget.value = '';
                               }
                             }} />
                      <button onClick={() => {
                                const inp = /** @type {HTMLInputElement | null} */ (document.getElementById('save-layout-name'));
                                saveCurrentLayout(inp?.value);
                                if (inp) inp.value = '';
                              }}
                              className="px-2 py-1 rounded text-[10.5px] font-medium"
                              style={{ background: COLORS.mint, color: '#FFF' }}>
                        Save
                      </button>
                    </div>
                    {savedLayouts.length === 0 ? (
                      <div className="py-2 text-[10.5px] text-center" style={{ color: COLORS.textMute }}>
                        No saved layouts yet. Type a name above and click Save.
                      </div>
                    ) : savedLayouts.map(sl => (
                      <div key={sl.id} className="flex items-center gap-1 mb-1 last:mb-0">
                        <button onClick={() => {
                                  const inp = /** @type {HTMLInputElement | null} */ (document.getElementById('new-tab-name'));
                                  loadSavedLayoutAsNewTab(sl, inp?.value);
                                }}
                                className="flex-1 min-w-0 text-left px-2 py-1.5 rounded transition-colors hover:bg-white/[0.04]"
                                style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
                          <div className="text-[11.5px] truncate" style={{ color: COLORS.text }}>{sl.name}</div>
                          <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                            {sl.midOrder.length} widget{sl.midOrder.length === 1 ? '' : 's'} · {new Date(sl.savedAt).toLocaleDateString()}
                          </div>
                        </button>
                        <button onClick={() => deleteSavedLayout(sl.id)}
                                className="w-6 h-6 rounded text-[11px] hover:bg-white/[0.04]"
                                style={{ color: COLORS.textMute }}
                                title="Delete saved layout">×</button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Single widget — opens an overlay picker so user can pick
                    which widget the new tab should contain. The popup
                    floats over the current screen; layout doesn't shift
                    until the user has picked. */}
                <button onClick={() => {
                          // Stash the workspace name so the picker can
                          // use it when creating the tab.
                          const inp = /** @type {HTMLInputElement | null} */ (document.getElementById('new-tab-name'));
                          window.__pendingSingleWidgetName = inp?.value ?? '';
                          setShowAddTab(false);
                          setShowSinglePicker(true);
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-white/[0.04] border-b transition-colors"
                        style={{ borderColor: COLORS.border }}>
                  <div className="text-[12px] font-medium" style={{ color: COLORS.text }}>Single widget</div>
                  <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textMute }}>
                    Distraction-free — just one widget of your choice. Pick the type next.
                  </div>
                </button>
                {/* Full layout — empty workspace primed for the user to
                    build out from scratch. Defaults to chart + buy/sell
                    so the canvas isn't empty. */}
                <button onClick={() => {
                          const inp = /** @type {HTMLInputElement | null} */ (document.getElementById('new-tab-name'));
                          addNamedTab(inp?.value, 'full');
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-white/[0.04] transition-colors">
                  <div className="text-[12px] font-medium" style={{ color: COLORS.text }}>Full layout</div>
                  <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textMute }}>
                    Build from scratch — starts with chart + buy/sell, add more from the picker.
                  </div>
                </button>
              </div>
              {/* "Single widget" no longer has a sub-step here — clicking
                  "Add a widget" at the top opens the centered widget-picker
                  overlay (see showAddWidget below) which adds to the
                  current layout without creating a new tab. */}
            </>
          )}
        </div>
      </div>

      {/* Active workspace content — every workspace tab (default 'chart'
          plus any user-named tabs prefixed with 'ws-') renders the
          customizable chart layout. Old special tabs (portfolio,
          watchlist, etc) still render their dedicated mini-view for
          backwards compatibility with previously-saved workspaces. */}
      {(workspaces.active === 'chart' || workspaces.active.startsWith('ws-')) ? (
        <>
          {/* Smart grid container — arranges widgets in an optimal layout.
              1 widget: full screen. 2: side-by-side. 3: 1 big left + 2 right.
              4: 2x2. 5: 2 top + 3 bottom. 6: 3x2. 7-9: 3x3. 10-12: 4x3. The
              + Add widget button is included as part of the grid count
              when in edit mode. The midOrder cap was 6 — now 12, since
              the user wanted stackable widgets to actually fit. */}
          {(() => {
            const aspectFor = (instId) => {
              const t = instId.includes('::') ? instId.split('::')[0] : instId;
              const w = WIDGET_CATALOG.find(x => x.id === t);
              return w?.aspect ?? 'square';
            };
            const aspectFr = (a) => a === 'wide' ? 2.4 : a === 'narrow' ? 1 : 1.4;
            // Cap raised from 6 to 12. With stack-as-many-as-you-want UX,
            // 6 is too restrictive. 12 gives the user a 4×3 ceiling that
            // still keeps each widget readable.
            const ids = layout.midOrder.slice(0, 12);
            const count = ids.length;
            const showAddSlot = layout.editing || count === 0;
            const aspects = ids.map(aspectFor);
            // Wide-mode region layout — at viewport ≥1440px we override
            // the count-based grid with a named-region layout. Widgets
            // are auto-distributed by type:
            //   - chart        → CENTER TOP (largest single area)
            //   - orderentry   → LEFT TOP   (vertical strip, buy/sell)
            //   - orderbook    → RIGHT TOP  (vertical strip, depth)
            //   - everything else → BOTTOM ROW
            // Uses CSS grid-template-areas so the named placement is
            // declarative and easy to read. No persistence change —
            // same midOrder array drives both modes; users see the
            // same widgets regardless of viewport width.
            const wideRegions = (() => {
              // Only switch to the region layout when there are MORE than
              // three widgets. With ≤3 widgets we want the chart to take
              // its full natural share of the screen via the count-based
              // grid (1 widget → full screen, 2 → split, 3 → big-left
              // with chart dominant). The region layout only earns its
              // keep when there are enough widgets that the bottom row
              // isn't visually empty — otherwise the chart gets squeezed
              // into a center column with awkward empty side strips.
              if (!wideMode || count <= 3) return null;
              const typeOf = (instId) => instId.includes('::') ? instId.split('::')[0] : instId;
              const chartIdx = ids.findIndex(id => typeOf(id) === 'chart');
              const orderEntryIdx = ids.findIndex(id => typeOf(id) === 'orderentry');
              const orderBookIdx = ids.findIndex(id => typeOf(id) === 'orderbook');
              const bottomIdxs = ids
                .map((_, i) => i)
                .filter(i => i !== chartIdx && i !== orderEntryIdx && i !== orderBookIdx);
              // Need at least a chart for the region layout to make
              // sense. If no chart in layout, fall back to default.
              if (chartIdx < 0) return null;
              // Build the bottom row's grid-template-columns: equal
              // fractions for each widget, defaulting to 1fr each.
              const bottomCount = bottomIdxs.length;
              const hasLeft  = orderEntryIdx >= 0;
              const hasRight = orderBookIdx  >= 0;
              // Top row split: order entry (left, narrow), chart
              // (center, wide), order book (right, narrow). If a
              // side widget is missing, the chart absorbs that side.
              const leftFr   = hasLeft  ? '280px' : '0px';
              const rightFr  = hasRight ? '280px' : '0px';
              return {
                chartIdx,
                orderEntryIdx,
                orderBookIdx,
                bottomIdxs,
                bottomCount,
                hasLeft,
                hasRight,
                leftFr,
                rightFr,
              };
            })();
            const gridTemplate = (() => {
              // Wide-mode override — use grid-template-areas with named
              // regions instead of count-based grid. The bottom row is
              // an inner grid; we render the top row here and emit
              // bottom widgets with explicit grid-area assignment.
              if (wideRegions) {
                const { leftFr, rightFr, hasLeft, hasRight, bottomCount } = wideRegions;
                // 2-row layout: top is chart + side strips, bottom is
                // the remaining widgets in a single horizontal row. If
                // there are no bottom widgets, the top row gets full
                // height. Bottom row is fixed-height (38% of page) so
                // the chart still gets the dominant space.
                const cols = `${leftFr} 1fr ${rightFr}`;
                const rows = bottomCount > 0 ? '62fr 38fr' : '1fr';
                return {
                  cols,
                  rows,
                  layout: 'wide-regions',
                };
              }
              const total = count + (showAddSlot ? 1 : 0);
              if (total <= 1) return { cols: '1fr', rows: '1fr' };
              if (total === 2) {
                const fr = aspects.map(aspectFr);
                const addFr = showAddSlot ? ' 1fr' : '';
                return { cols: count === 2 ? `${fr[0]}fr ${fr[1]}fr` : `${fr[0]}fr${addFr}`, rows: '1fr' };
              }
              if (total === 3) {
                const fr = aspects.map(aspectFr);
                const wideIdx = aspects.indexOf('wide');
                if (wideIdx >= 0) {
                  return {
                    cols: `${aspectFr('wide')}fr 1fr`,
                    rows: '1fr 1fr',
                    layout: 'big-left',
                    bigIdx: wideIdx,
                  };
                }
                return { cols: `${fr[0]}fr ${fr[1]}fr ${fr[2] ?? 1}fr`, rows: '1fr' };
              }
              if (total === 4) return { cols: '1fr 1fr', rows: '1fr 1fr' };
              if (total === 5) return { cols: '1fr 1fr 1fr', rows: '1fr 1fr', layout: 'five-top' };
              if (total === 6) return { cols: '1fr 1fr 1fr', rows: '1fr 1fr' };
              // 7-9 widgets: 3 columns, 3 rows. Last row may have fewer
              // tiles — they'll stretch to fill via grid auto-flow.
              if (total <= 9) return { cols: '1fr 1fr 1fr', rows: '1fr 1fr 1fr' };
              // 10-12 widgets: 4 columns, 3 rows.
              return { cols: '1fr 1fr 1fr 1fr', rows: '1fr 1fr 1fr' };
            })();
            return (
              <div className="flex-1 min-h-0 relative grid"
                   style={{
                     gridTemplateColumns: gridTemplate.cols,
                     gridTemplateRows: gridTemplate.rows,
                     gap: 4,
                     padding: 4,
                   }}>
                {ids.map((id, i) => {
                  let gridArea;
                  if (gridTemplate.layout === 'wide-regions') {
                    // Wide-mode placement: chart center top, order
                    // entry left top, order book right top, others
                    // span the bottom row evenly. Bottom widgets are
                    // wrapped in a single grid cell that hosts an
                    // inner flex row; this avoids needing variable
                    // grid-template-columns when bottomCount changes.
                    if (i === wideRegions?.chartIdx) {
                      gridArea = '1 / 2 / 2 / 3';
                    } else if (i === wideRegions?.orderEntryIdx) {
                      gridArea = '1 / 1 / 2 / 2';
                    } else if (i === wideRegions?.orderBookIdx) {
                      gridArea = '1 / 3 / 2 / 4';
                    } else {
                      // Bottom-row widgets: skip — they'll be rendered
                      // separately below in a dedicated bottom-row
                      // container so they share a flex layout.
                      return null;
                    }
                  } else if (gridTemplate.layout === 'big-left') {
                    if (i === gridTemplate.bigIdx) {
                      gridArea = '1 / 1 / 3 / 2';
                    } else {
                      const otherIdx = ids.slice(0, i).filter((_, j) => j !== gridTemplate.bigIdx).length;
                      gridArea = otherIdx === 0 ? '1 / 2 / 2 / 3' : '2 / 2 / 3 / 3';
                    }
                  } else if (gridTemplate.layout === 'five-top') {
                    if (i === 0) gridArea = '1 / 1 / 2 / 2';
                    else if (i === 1) gridArea = '1 / 2 / 2 / 4';
                  }
                  const widget = renderWidget(id);
                  if (!widget) return null;
                  return (
                    <div key={`slot-${id}-${i}`} style={{ gridArea, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                      {widget}
                    </div>
                  );
                })}
                {/* Wide-mode bottom row — flex container spanning all
                    three columns. Each bottom widget gets equal share
                    of the available width. */}
                {gridTemplate.layout === 'wide-regions' && (wideRegions?.bottomCount > 0 || showAddSlot) && (
                  <div className="flex gap-1"
                       style={{ gridArea: '2 / 1 / 3 / 4', minWidth: 0, minHeight: 0 }}>
                    {wideRegions?.bottomIdxs?.map((bi) => {
                      const id = ids[bi];
                      const widget = renderWidget(id);
                      if (!widget) return null;
                      return (
                        <div key={`bottom-${id}-${bi}`}
                             className="flex-1 min-w-0"
                             style={{ display: 'flex', flexDirection: 'column' }}>
                          {widget}
                        </div>
                      );
                    })}
                    {/* Add tile lives inside the flex row in wide-regions
                        mode so it stays within the visible region grid
                        and can't get clipped off the right edge. */}
                    {showAddSlot && (
                      <div className="flex-1 min-w-0" style={{ display: 'flex' }}>
                        <button
                          onClick={() => setShowAddWidget(true)}
                          className="flex-1 flex items-center justify-center transition-all hover:opacity-80"
                          style={{
                            borderRadius: 14,
                            border: `2px dashed ${COLORS.mint}`,
                            background: 'rgba(61,123,255,0.04)',
                            color: COLORS.mint,
                            minWidth: 56,
                          }}
                          title="Add a chart or panel to the trade page"
                        >
                          <span className="flex flex-col items-center gap-1">
                            <span style={{ fontSize: 24 }}>+</span>
                            <span className="text-[9px]">ADD</span>
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {/* + Add widget tile — sits in the last grid cell.
                    In wide-regions layout the bottom widgets render
                    in a dedicated flex row above; the add slot needs
                    to live INSIDE that flex row too, otherwise it
                    auto-flows into a cell already occupied by chart
                    or order entry and gets visually clipped off-page.
                    For wide-regions we render it AFTER the bottom-row
                    widgets inside the same flex container instead of
                    here. For all other layouts (count-based grid)
                    grid auto-flow handles placement just fine. */}
                {showAddSlot && gridTemplate.layout !== 'wide-regions' && (
                  <div style={{ minWidth: 0, minHeight: 0, display: 'flex' }}>
                    <button
                      onClick={() => setShowAddWidget(true)}
                      className="flex-1 flex items-center justify-center transition-all hover:opacity-80"
                      style={{
                        borderRadius: 14,
                        border: `2px dashed ${COLORS.mint}`,
                        background: 'rgba(61,123,255,0.04)',
                        color: COLORS.mint,
                        minWidth: 56,
                      }}
                      title="Add a chart or panel to the trade page"
                    >
                      <span className="flex flex-col items-center gap-1">
                        <span style={{ fontSize: 24 }}>+</span>
                        <span className="text-[9px]">ADD</span>
                      </span>
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
          {/* Bottom panel — hidden by default, slides up from a small
              chevron tab at the bottom of the chart area. Liquid-glass
              styling: rounded top corners, soft shadow, blurred surface. */}
          <div className="relative">
            <button
              onClick={() => persistLayout({ ...layout, showBottom: !layout.showBottom })}
              className="absolute left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 px-2 py-0.5 text-[9.5px] font-medium transition-all"
              style={{
                top: layout.showBottom ? -10 : -20,
                background: COLORS.surface,
                color: COLORS.mint,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 999,
                // Tighter shadow + tighter padding so the button doesn't
                // dominate the chart edge. Was px-3 py-1 / 10.5px text;
                // shrank to px-2 py-0.5 / 9.5px text per UX request.
                boxShadow: '0 2px 10px rgba(0,0,0,0.16), 0 1px 0 rgba(255,255,255,0.04) inset',
                backdropFilter: 'blur(10px)',
              }}
              title={layout.showBottom ? 'Hide bottom panel' : 'Show positions, orders, and history'}
            >
              <span style={{ fontSize: 10 }}>{layout.showBottom ? '▾' : '▴'}</span>
              <span>{layout.showBottom ? 'Hide' : 'Positions · Orders · History'}</span>
            </button>
            {layout.showBottom && (
              <div style={{
                margin: '0 8px 8px 8px',
                borderRadius: '16px 16px 12px 12px',
                border: `1px solid ${COLORS.border}`,
                background: COLORS.surface,
                boxShadow: '0 -8px 32px rgba(0,0,0,0.2), 0 1px 0 rgba(255,255,255,0.04) inset',
                overflow: 'hidden',
              }}>
                <BottomPanel instrument={active} account={account} markPrice={feed.price} onClosePosition={onClosePosition} />
              </div>
            )}
          </div>
        </>
      ) : workspaces.active === 'portfolio' ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <TradeMiniView title="Portfolio" onExpand={() => setPage?.('portfolio')}>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Cash', value: account?.balance ?? 0, color: COLORS.text },
                { label: 'Positions', value: (account?.positions ?? []).length, color: COLORS.mint, isCount: true },
                { label: 'Unrealized PnL', value: account?.unrealizedPnl ?? 0, color: (account?.unrealizedPnl ?? 0) >= 0 ? COLORS.green : COLORS.red, isPnl: true },
              ].map(s => (
                <div key={s.label} className="rounded-md border p-3" style={{ background: COLORS.surface, borderColor: COLORS.border }}>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>{s.label}</div>
                  <div className="text-[20px] tabular-nums mt-1" style={{ color: s.color }}>
                    {s.isCount ? s.value : s.isPnl ? `${s.value >= 0 ? '+' : ''}$${Math.abs(s.value).toLocaleString()}` : `$${s.value.toLocaleString()}`}
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-md border mt-4" style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <div className="px-4 py-2 text-[11px] border-b" style={{ borderColor: COLORS.border, color: COLORS.textDim }}>Open positions</div>
              <Positions account={account} markPrice={feed.price} instrument={active} onClosePosition={onClosePosition} />
            </div>
          </TradeMiniView>
        </div>
      ) : workspaces.active === 'watchlist' ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <TradeMiniView title="Watchlist" onExpand={() => setPage?.('watchlist')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {INSTRUMENTS.filter(i => (account?.watchlist ?? []).includes(i.id)).slice(0, 9).map(inst => (
                <button key={inst.id} onClick={() => { setActive(inst); persistWorkspaces({ ...workspaces, active: 'chart' }); }}
                        className="rounded-md border p-3 text-left hover:bg-white/[0.03] transition-colors"
                        style={{ background: COLORS.surface, borderColor: COLORS.border }}>
                  <div className="flex items-center gap-2 mb-1">
                    <InstIcon cls={inst.cls} size={16} ticker={inst.id} />
                    <span className="text-[12.5px] font-medium" style={{ color: COLORS.text }}>{formatTicker(inst.id, inst.cls)}</span>
                  </div>
                  <div className="text-[16px] tabular-nums" style={{ color: COLORS.text }}>${inst.mark?.toFixed(inst.dec ?? 2)}</div>
                  <div className="text-[10.5px] tabular-nums" style={{ color: (inst.change24h ?? 0) >= 0 ? COLORS.green : COLORS.red }}>
                    {(inst.change24h ?? 0) >= 0 ? '+' : ''}{(inst.change24h ?? 0).toFixed(2)}%
                  </div>
                </button>
              ))}
              {INSTRUMENTS.filter(i => (account?.watchlist ?? []).includes(i.id)).length === 0 && (
                <div className="col-span-3 text-center py-8 text-[12px]" style={{ color: COLORS.textMute }}>
                  Star instruments to add them to your watchlist
                </div>
              )}
            </div>
          </TradeMiniView>
        </div>
      ) : workspaces.active === 'feed' ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <TradeMiniView title="Feed" onExpand={() => setPage?.('feed')}>
            <div className="rounded-md border overflow-hidden" style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              {(FEED_POSTS ?? []).slice(0, 8).map((p, i) => (
                <div key={p.id ?? i} className="px-4 py-3 border-b last:border-b-0" style={{ borderColor: COLORS.border }}>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-[12px] font-medium" style={{ color: COLORS.text }}>{p.author}</span>
                    <span className="text-[10.5px]" style={{ color: COLORS.textMute }}>{p.handle} · {p.time ?? '2h'}</span>
                  </div>
                  <div className="text-[12.5px]" style={{ color: COLORS.textDim }}>{p.body}</div>
                </div>
              ))}
              {(!FEED_POSTS || FEED_POSTS.length === 0) && (
                <div className="px-4 py-8 text-center text-[12px]" style={{ color: COLORS.textMute }}>
                  No feed posts available
                </div>
              )}
            </div>
          </TradeMiniView>
        </div>
      ) : workspaces.active === 'budget' ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <TradeMiniView title="Budget" onExpand={() => setPage?.('budget')}>
            <div className="rounded-md border p-4" style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <div className="text-[12px]" style={{ color: COLORS.textMute }}>Open Budget tab to manage envelopes, see spending velocity, and track family allowances.</div>
              <button onClick={() => setPage?.('budget')}
                      className="mt-3 px-3 py-1.5 rounded text-[11.5px] font-medium"
                      style={{ background: COLORS.mint, color: COLORS.bg }}>
                Open Budget →
              </button>
            </div>
          </TradeMiniView>
        </div>
      ) : workspaces.active === 'predictions' ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <TradeMiniView title="Predictions" onExpand={() => setPage?.('predictions')}>
            <div className="rounded-md border p-4" style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <div className="text-[12px]" style={{ color: COLORS.textMute }}>Open Predictions to browse Kalshi-style markets with live odds.</div>
              <button onClick={() => setPage?.('predictions')}
                      className="mt-3 px-3 py-1.5 rounded text-[11.5px] font-medium"
                      style={{ background: COLORS.mint, color: COLORS.bg }}>
                Open Predictions →
              </button>
            </div>
          </TradeMiniView>
        </div>
      ) : null}
      {/* Floating Baskets button — same pill family as Ask AI / Deposit
          for visual consistency. Surface background, mint accent border,
          subtle drop shadow. */}
      <button
        onClick={() => setBasketOpen(true)}
        className="fixed bottom-12 right-6 px-4 py-2 rounded-md text-[12px] font-medium z-30 transition-all hover:bg-white/[0.04]"
        style={{
          background: COLORS.surface,
          color: COLORS.mint,
          border: `1px solid ${COLORS.mint}55`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4), 0 0 0 0 rgba(61,123,255,0.15)',
        }}
        title="Browse curated multi-stock baskets"
      >
        Market Baskets
      </button>
      {pickerOpen && (
        <InstrumentPicker
          active={active}
          onSelect={setActive}
          onClose={() => setPickerOpen(false)}
          watchlist={account?.watchlist ?? []}
          onToggleWatch={onToggleWatch}
        />
      )}
      {/* Market screener — opened from the ticker search dropdown */}
      {screenerOpen && (
        <MarketScreenerModal
          onClose={() => setScreenerOpen(false)}
          onSelect={(ticker) => {
            const inst = INSTRUMENTS.find(i => i.id === ticker);
            if (inst) setActive(inst);
            setScreenerOpen(false);
          }}
          watchedTickers={account?.watchlist ?? []}
        />
      )}
      {/* Fundamentals picker — opened from the FundamentalsMini widget's
          + Add fundamental button. Renders at TradePage level so the
          modal's fixed positioning isn't clipped by the workspace
          overflow. The modal pushes selections into
          localStorage 'imo_fundamentals_charts'; the widget polls
          that key every 2s and picks up the new metrics. */}
      {fundamentalsOpen && (
        <FundamentalsModal instrument={active} onClose={() => setFundamentalsOpen(false)} />
      )}
      {/* Quick Trade modal — opens from the InstrumentHeader's Buy/Sell
          buttons when the OrderEntry widget is not in the layout. Reuses
          the same OrderEntry component so behavior is identical, just in a
          dialog overlay. The `side` prop pre-selects buy or sell. */}
      {quickTradeSide && (
        <>
          <div className="fixed inset-0 z-40"
               style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
               onClick={() => setQuickTradeSide(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="w-[440px] max-w-full max-h-[90vh] rounded-xl overflow-auto pointer-events-auto"
                 style={{
                   background: `linear-gradient(180deg, ${COLORS.surface} 0%, ${COLORS.bg} 100%)`,
                   border: `1px solid ${COLORS.borderHi}`,
                   boxShadow: '0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
                 }}>
              <div className="px-5 pt-4 pb-3 border-b flex items-center justify-between"
                   style={{
                     borderColor: COLORS.border,
                     background: quickTradeSide === 'buy'
                       ? `linear-gradient(180deg, rgba(31,178,107,0.06) 0%, transparent 100%)`
                       : `linear-gradient(180deg, rgba(237,112,136,0.06) 0%, transparent 100%)`,
                   }}>
                <div>
                  <div className="text-[10px] uppercase tracking-[1.5px] mb-1"
                       style={{ color: quickTradeSide === 'buy' ? COLORS.green : COLORS.red, fontWeight: 600 }}>
                    {quickTradeSide === 'buy' ? 'Buy order' : 'Sell order'}
                  </div>
                  <div className="text-[16px] font-medium" style={{ color: COLORS.text, letterSpacing: '-0.01em' }}>
                    {active.id} · ${feed.price?.toFixed(active.dec ?? 2)}
                  </div>
                  <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textMute }}>
                    {active.name} · Review and place your order
                  </div>
                </div>
                <button onClick={() => setQuickTradeSide(null)}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-[18px] transition-colors hover:bg-white/[0.05]"
                        style={{ color: COLORS.textDim }}
                        title="Close">×</button>
              </div>
              <div className="p-3">
                <OrderEntry
                  instrument={active}
                  markPrice={feed.price}
                  account={account}
                  user={user}
                  onOpenPosition={(payload) => {
                    onOpenPosition?.(payload);
                    setQuickTradeSide(null);
                  }}
                  initialSide={quickTradeSide}
                />
              </div>
            </div>
          </div>
        </>
      )}
      {basketOpen && (
        <MarketBasketsModal
          account={account}
          onClose={() => setBasketOpen(false)}
          onOpenPosition={onOpenPosition}
          onBuy={async (basket, usd) => {
            // Split USD across underlyings; each member gets equal weight.
            // Sequence the opens so the safety gate confirmation prompts
            // queue properly and we know how many actually went through.
            const perAsset = usd / basket.holdings.length;
            for (const h of basket.holdings) {
              const inst = INSTRUMENTS.find(i => i.id === h.ticker) ?? h.refInst;
              if (!inst) continue;
              const size = perAsset / (inst.mark || 1);
              try {
                await Promise.resolve(onOpenPosition?.({
                  instrument: inst,
                  side: 'buy',
                  size,
                  leverage: 1,
                  entryPrice: inst.mark,
                }));
              } catch {
                // Individual leg failure — continue with the others
              }
            }
            setBasketOpen(false);
          }}
        />
      )}
      {/* Widget picker modal — invoked by the + Add widget button.
          Displays the WIDGET_CATALOG as a grid of cards. Click a card
          to append it to the trade page midOrder layout. Already-added
          widgets are dimmed but can still be re-added (allows duplicates
          if desired). */}
      {showAddWidget && (
        <>
          <div className="fixed inset-0 z-40"
               style={{ background: 'rgba(0,0,0,0.7)' }}
               onClick={() => setShowAddWidget(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="w-[860px] max-w-full rounded-md border overflow-hidden flex flex-col pointer-events-auto"
                 style={{
                   background: COLORS.surface,
                   borderColor: COLORS.border,
                   boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                   // Locked height — was max-h-[80vh] which let the
                   // modal expand/shrink as the user navigated between
                   // categories with different widget counts. Now the
                   // modal is a fixed 70vh (clamped 480-720px) so the
                   // outline stays put and only the inner grid scrolls.
                   height: 'min(720px, max(480px, 70vh))',
                 }}>
              <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: COLORS.border }}>
                <div>
                  <div className="text-[15px] font-medium" style={{ color: COLORS.text }}>
                    {replaceSlotIdx >= 0 ? `Replace widget` : 'Add a widget'}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: COLORS.textMute }}>
                    {replaceSlotIdx >= 0
                      ? `Pick a new widget to swap into this slot.`
                      : 'Browse by category or search to add a chart, mini-view, or panel.'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: COLORS.textMute }} />
                    <input value={pickerSearch}
                           onChange={(e) => setPickerSearch(e.target.value)}
                           placeholder="Search widgets…"
                           className="pl-7 pr-2.5 py-1.5 rounded-md text-[11.5px] outline-none"
                           style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, width: 200 }} />
                  </div>
                  <button onClick={() => { setShowAddWidget(false); setReplaceSlotIdx(-1); setPickerSearch(''); }}
                          className="w-7 h-7 rounded-md flex items-center justify-center"
                          style={{ background: COLORS.surface2, color: COLORS.textDim }}>×</button>
                </div>
              </div>
              <div className="flex-1 min-h-0 flex">
                {/* Category sidebar */}
                <div className="w-44 shrink-0 border-r overflow-y-auto p-2"
                     style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                  {WIDGET_CATEGORIES.map(cat => {
                    const count = cat === 'All'
                      ? WIDGET_CATALOG.length
                      : WIDGET_CATALOG.filter(w => w.category === cat).length;
                    const active = pickerCategory === cat;
                    return (
                      <button key={cat}
                              onClick={() => setPickerCategory(cat)}
                              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-[11.5px] mb-0.5 transition-colors"
                              style={{
                                background: active ? COLORS.surface2 : 'transparent',
                                color: active ? COLORS.text : COLORS.textDim,
                                fontWeight: active ? 500 : 400,
                                borderLeft: active ? `2px solid ${COLORS.mint}` : '2px solid transparent',
                              }}>
                        <span>{cat}</span>
                        <span className="text-[9.5px] tabular-nums" style={{ color: COLORS.textMute }}>{count}</span>
                      </button>
                    );
                  })}
                </div>
                {/* Widget grid */}
                <div className="flex-1 overflow-y-auto p-4">
                  {(() => {
                    const q = pickerSearch.trim().toLowerCase();
                    const visible = WIDGET_CATALOG.filter(w => {
                      if (pickerCategory !== 'All' && w.category !== pickerCategory) return false;
                      if (q && !w.label.toLowerCase().includes(q) && !w.id.toLowerCase().includes(q)) return false;
                      return true;
                    });
                    if (visible.length === 0) {
                      return (
                        <div className="py-8 text-center text-[12px]" style={{ color: COLORS.textMute }}>
                          No widgets match {q ? `"${pickerSearch}"` : 'this category'}.
                        </div>
                      );
                    }
                    // Render the widget tile (extracted for reuse in
                    // both the flat and grouped views).
                    const renderTile = (w) => {
                      const count = layout.midOrder.filter(id => (id.split('::')[0] ?? id) === w.id).length;
                      return (
                        <button key={w.id}
                                onClick={() => {
                                  const instanceId = `${w.id}::${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
                                  let nextOrder;
                                  if (replaceSlotIdx >= 0) {
                                    nextOrder = [...layout.midOrder];
                                    nextOrder[replaceSlotIdx] = instanceId;
                                  } else {
                                    nextOrder = [...layout.midOrder, instanceId];
                                  }
                                  persistLayout({ ...layout, midOrder: nextOrder });
                                  setShowAddWidget(false);
                                  setReplaceSlotIdx(-1);
                                  setPickerSearch('');
                                }}
                                className="text-left p-3 rounded-md border transition-all hover:bg-white/[0.04]"
                                style={{ background: COLORS.bg, borderColor: COLORS.border }}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[12.5px] font-medium" style={{ color: COLORS.text }}>{w.label}</span>
                            {count > 0 && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded tabular-nums"
                                    style={{ background: `${COLORS.mint}33`, color: COLORS.mint, border: `1px solid ${COLORS.mint}55` }}
                                    title={`${count} instance${count === 1 ? '' : 's'} on page`}>
                                ×{count}
                              </span>
                            )}
                          </div>
                          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                            {w.category}
                          </div>
                        </button>
                      );
                    };
                    // When "All" category is active and there's no
                    // search, group widgets by category so the picker
                    // is pre-organized rather than a flat 40+ item grid.
                    if (pickerCategory === 'All' && !q) {
                      const grouped = {};
                      visible.forEach(w => {
                        const cat = w.category ?? 'Other';
                        if (!grouped[cat]) grouped[cat] = [];
                        grouped[cat].push(w);
                      });
                      // Use the canonical order from WIDGET_CATEGORIES so
                      // sections appear in a consistent order.
                      const orderedCats = WIDGET_CATEGORIES.filter(c => c !== 'All' && grouped[c]?.length);
                      return (
                        <div className="space-y-5">
                          {orderedCats.map(cat => (
                            <div key={cat}>
                              {/* Sticky header — extended full-bleed
                                  (negative margin to cover parent's
                                  p-4) and given a -1px top so it
                                  butts flush against the scroll
                                  container edge with no visible gap.
                                  Per UX feedback: previous version
                                  left ~1/5" of content showing above
                                  the header. */}
                              <div className="text-[10px] uppercase tracking-[1.4px] mb-2 sticky z-20 py-2 -mx-4 px-4 border-b"
                                   style={{
                                     color: COLORS.mint,
                                     fontWeight: 600,
                                     background: COLORS.surface,
                                     borderColor: COLORS.border,
                                     top: -16,  // counter parent's p-4 = 16px
                                   }}>
                                {cat}
                                <span className="ml-1.5 text-[9.5px]" style={{ color: COLORS.textMute, fontWeight: 500 }}>
                                  · {grouped[cat].length}
                                </span>
                              </div>
                              <div className="grid grid-cols-3 gap-2.5">
                                {grouped[cat].map(renderTile)}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }
                    // Filtered category or active search → flat grid.
                    return (
                      <div className="grid grid-cols-3 gap-2.5">
                        {visible.map(renderTile)}
                      </div>
                    );
                  })()}
                </div>
              </div>
              <div className="px-4 py-2 border-t text-[10px] text-center" style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
                Tip: drag widgets to reorder. Click × on a widget header to remove. Up to 6 widgets recommended.
              </div>
            </div>
          </div>
        </>
      )}
      {/* Single-widget picker overlay — shown when user clicks "Single
          widget" in the new-workspace dropdown. Floats over the current
          screen; the layout doesn't shift. Picking a widget creates a
          new workspace tab with that widget as its only contents. */}
      {showSinglePicker && (
        <>
          <div className="fixed inset-0 z-40"
               style={{ background: 'rgba(0,0,0,0.7)' }}
               onClick={() => setShowSinglePicker(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="w-[640px] max-w-full max-h-[80vh] rounded-md border overflow-hidden flex flex-col pointer-events-auto"
                 style={{ background: COLORS.surface, borderColor: COLORS.border, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
              <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: COLORS.border }}>
                <div>
                  <div className="text-[15px] font-medium" style={{ color: COLORS.text }}>
                    Pick a widget for your single-widget workspace
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: COLORS.textMute }}>
                    Distraction-free view of just one widget. You can add more later.
                  </div>
                </div>
                <button onClick={() => setShowSinglePicker(false)}
                        className="w-7 h-7 rounded-md flex items-center justify-center"
                        style={{ background: COLORS.surface2, color: COLORS.textDim }}>×</button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <div className="grid grid-cols-3 gap-2">
                  {WIDGET_CATALOG.map(w => (
                    <button key={w.id}
                            onClick={() => {
                              const name = window.__pendingSingleWidgetName ?? '';
                              addNamedTab(name, 'single', w.id);
                              window.__pendingSingleWidgetName = '';
                              setShowSinglePicker(false);
                            }}
                            className="flex flex-col items-start gap-1 px-3 py-2 rounded-md transition-all text-left hover:bg-white/[0.04]"
                            style={{
                              background: COLORS.bg,
                              border: `1px solid ${COLORS.border}`,
                            }}>
                      <span className="text-[11.5px] font-medium" style={{ color: COLORS.text }}>{w.label}</span>
                      <span className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                        {w.category}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};

