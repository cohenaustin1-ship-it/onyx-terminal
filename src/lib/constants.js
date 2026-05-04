// IMO Onyx Terminal — top-level constants
//
// Phase 3o.96 (file split, batch 8 — constants module). Foundational
// batch that enables the React component extraction phase. These
// constants used to live inline in JPMOnyxTerminal.jsx but they're
// referenced by every component module that ships in 3o.97+, so they
// need to be importable from a single source of truth.
//
// Public exports:
//   COLORS                  Theme palette: backgrounds, surfaces,
//                           borders, text shades, brand greens/reds,
//                           chart accent colors. Used by ~every
//                           component in the app.
//   PAGES                   Routing list — { id, label, advancedOnly?,
//                           noviceOnly? } per page. CircularPageNav
//                           filters by experience level.
//   KEYBOARD_SHORTCUTS      Categorized cheat-sheet content for the
//                           `?` overlay (Navigation, Trade, AI,
//                           General). Each item: { keys: [...], desc }.
//
// Note: ONBOARDING_STEPS stays in JPMOnyxTerminal.jsx for now because
// its `body` field contains JSX, so it can't live in a .js file. It
// will move out alongside OnboardingModal in the 3o.97 component
// extraction batch.

export const COLORS = {
  // Closer to black — the bg goes from #0D1219 to #060810, surfaces
  // proportionally darker. Keeps the very subtle blue tint so it doesn't
  // read as flat black, but matches the user's "more black" request.
  bg:        '#060810',
  surface:   '#0C111A',
  surface2:  '#111824',
  border:    'rgba(255,255,255,0.05)',
  borderHi:  'rgba(255,255,255,0.10)',
  // Even deeper navy accent — was #2A4A7F, now #1E3A6C for a more
  // institutional, less royal feel. Closer to JP Morgan navy.
  mint:      '#1E3A6C',
  mintDim:   '#142852',
  green:     '#1FB26B',
  greenDim:  '#0E8A52',
  red:       '#ED7088',
  redDim:    '#B84A60',
  text:      '#F0F3FA',
  textDim:   '#8A93A6',
  textMute:  '#5A6274',
  jpmBlue:   '#1A3A6C',
  // Chart palette extension — used for secondary series, multi-line charts,
  // overlays. Centralized here so theme switching can adjust them later.
  chartCyan:    '#7AC8FF',  // Secondary line / underlying overlay
  chartAmber:   '#FFB84D',  // Warning / alert / IV line
  chartPurple:  '#E07AFC',  // Exotic / notional / ARV
  chartOlive:   '#A0C476',  // Calls (positive bias)
  chartGold:    '#FFD24A',  // IV / volatility metrics
  chartPink:    '#FF7AB6',  // Quaternary line
  chartMagenta: '#FF9CDB',  // Volume secondary
};

export const PAGES = [
  { id: 'trade',       label: 'Trade' },
  { id: 'portfolio',   label: 'Portfolio' },
  { id: 'budget',      label: 'Budget' },
  { id: 'learn',       label: 'Learn', noviceOnly: true },
  { id: 'feed',        label: 'Feed' },
  { id: 'watchlist',   label: 'Watchlist' },
  { id: 'vaults',      label: 'LF' },
  { id: 'staking',     label: 'Staking', advancedOnly: true },
  { id: 'referrals',   label: 'Referrals' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'arena',       label: 'Arena' },           // AlphaArena — competitions
  { id: 'research',    label: 'Research' },        // Equity Research deep-dive
  { id: 'backtest',    label: 'Backtest', advancedOnly: true },  // strategy backtesting
  { id: 'quantlab',    label: 'Quant Lab', advancedOnly: true }, // AI factor discovery + builder + RL sandbox
  { id: 'scanner',     label: 'AI Scanner', advancedOnly: true }, // background scanner + multi-investor lens
  { id: 'sectors',     label: 'Sectors' },         // sector rotation analysis
  { id: 'macro',       label: 'Macro' },           // DBnomics macro browser
  { id: 'events',      label: 'Events' },          // earnings/dividends/FOMC calendar
  { id: 'alerts',      label: 'Alerts' },          // custom alert builder + alert log
  { id: 'strategies',  label: 'Strategies', advancedOnly: true }, // BL / pairs / sector rotation / 13F
  { id: 'fixedincome', label: 'Fixed Income', advancedOnly: true }, // Bond duration/convexity calculator
  { id: 'fx',          label: 'FX Calculator', advancedOnly: true }, // Forex cross-rates + carry trade
  { id: 'map',         label: 'Terminal' },
  { id: 'predictions', label: 'Predictions' },
  { id: 'discuss',     label: 'Discuss' },
  { id: 'docs',        label: 'Docs' },
  { id: 'taxes',       label: 'Vault' },
];

export const KEYBOARD_SHORTCUTS = [
  {
    category: 'Navigation',
    items: [
      { keys: ['⌘', 'K'], desc: 'Command palette (Ctrl+K on Win/Linux)' },
      { keys: ['G', 'T'], desc: 'Go to Trade' },
      { keys: ['G', 'P'], desc: 'Go to Portfolio' },
      { keys: ['G', 'R'], desc: 'Go to Risk' },
      { keys: ['G', 'M'], desc: 'Go to Markets' },
      { keys: ['G', 'A'], desc: 'Go to Alerts' },
      { keys: ['Esc'],    desc: 'Close any open modal / clear focus' },
    ],
  },
  {
    category: 'Trade page',
    items: [
      { keys: ['B'],      desc: 'Focus Buy panel' },
      { keys: ['S'],      desc: 'Focus Sell panel' },
      { keys: ['/'],      desc: 'Focus ticker search' },
      { keys: ['1', '2', '3', '4'], desc: 'Switch chart timeframe (1m / 5m / 1h / 1d)' },
      { keys: ['['],      desc: 'Previous instrument' },
      { keys: [']'],      desc: 'Next instrument' },
    ],
  },
  {
    category: 'AI + analysis',
    items: [
      { keys: ['⌘', 'I'], desc: 'Open AI sidebar / Ask AI' },
      { keys: ['⌘', 'E'], desc: 'AI edit current view' },
      { keys: ['⌘', 'B'], desc: 'Bookmark current ticker / page' },
    ],
  },
  {
    category: 'General',
    items: [
      { keys: ['?'],      desc: 'Toggle this cheat sheet' },
      { keys: ['⌘', ','], desc: 'Open Settings' },
      { keys: ['⌘', '/'], desc: 'Search past chats' },
      { keys: ['⌘', '\\'], desc: 'Toggle minimize-to-dock' },
    ],
  },
];

// ─── Trading / pricing constants ───
// Phase 3p.30 file-splitting: moved here so OrderEntry, OptionsChain,
// OrderBook + the monolith all share a single source of truth.

// IV_BY_CLASS — typical implied volatility per asset class. Used as
// the default IV when computing Black-Scholes prices for a quick
// quote (the user can override per-strike in OptionsChain).
export const IV_BY_CLASS = {
  crypto: 0.65,   // BTC/ETH typical range 50-90%
  equity: 0.30,   // S&P 500 typical range 15-35%
  energy: 0.40,   // WTI typical range 30-50%
};

// RISK_FREE_RATE — annualized risk-free rate used in Black-Scholes
// pricing. Refresh periodically as the Treasury curve shifts.
export const RISK_FREE_RATE = 0.05;  // ~5% Treasury yield as of April 2026

// ─── TICKER_SECTORS ───
// Phase 3p.34 (TS-driven extraction): TICKER_SECTORS was duplicated
// in 3 places (market-screener-modal, per-position-alpha-decomposition,
// monolith) and ALSO referenced in instrument-header.jsx without an
// import — TypeScript flagged that as "Cannot find name". The
// optional chaining `TICKER_SECTORS?.[id]` masked the runtime
// ReferenceError but the code path silently fell through to default
// "Other" / "Equity" labels. Centralizing here.
export const TICKER_SECTORS = {
  AAPL: 'Technology', NVDA: 'Technology', MSFT: 'Technology', GOOG: 'Technology', META: 'Technology',
  AMZN: 'Consumer', TSLA: 'Consumer', WMT: 'Consumer', HD: 'Consumer', NKE: 'Consumer',
  JPM: 'Financials', BAC: 'Financials', GS: 'Financials', WFC: 'Financials',
  JNJ: 'Healthcare', UNH: 'Healthcare', LLY: 'Healthcare', PFE: 'Healthcare',
  XOM: 'Energy', CVX: 'Energy',
  'BTC-PERP': 'Crypto', 'ETH-PERP': 'Crypto', 'SOL-PERP': 'Crypto',
  'WTI-F26': 'Commodities', 'BRENT-F26': 'Commodities', 'NG-F26': 'Commodities', 'HO-F26': 'Commodities',
  SPY: 'Index', QQQ: 'Index',
};
