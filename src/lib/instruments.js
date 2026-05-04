// IMO Onyx Terminal — instrument catalog
//
// Phase 3p.00 (file split, batch 12 — pre-CommandPalette dependency).
// The full list of tradeable instruments displayed across the app:
// crypto perps, stablecoins, equities, ETFs, FX pairs, indices, options,
// futures. Each entry shape:
//   { id, cls, name, chain, mark, vol24h, oi, change24h, funding?, dec }
//
// Used by ~74 surfaces in the app: TradePage, OrderBook, CommandPaletteModal,
// WatchlistPage, ChartPage, etc. Keeping it as a single source of truth
// in src/lib/ makes ticker-by-id lookups consistent.
//
// Marks are realistic snapshots — in production these would stream from
// a market-data feed and INSTRUMENTS would just hold metadata.
//
// Public exports:
//   INSTRUMENTS   Full list, ~178 entries.

export const INSTRUMENTS = [
  { id: 'BTC-PERP',   cls: 'crypto', name: 'Bitcoin Perpetual',    chain: 3, mark: 76000.00, vol24h: 44e9,   oi: 12e9,  change24h: 1.52,  funding: 0.0082, dec: 2 },
  { id: 'ETH-PERP',   cls: 'crypto', name: 'Ethereum Perpetual',   chain: 4, mark: 2320.00,  vol24h: 18e9,   oi: 6e9,   change24h: 2.20,  funding: 0.0061, dec: 2 },
  { id: 'SOL-PERP',   cls: 'crypto', name: 'Solana Perpetual',     chain: 5, mark: 85.90,    vol24h: 3.4e9,  oi: 1.2e9, change24h: 1.17,  funding: -0.0024, dec: 2 },
  // ─── Stablecoins ─────────────────────────────────────────────────────
  // USD-pegged digital assets. Marks hover at $1.00 with tiny basis-point
  // variation reflecting redemption windows / collateral confidence. These
  // are spot pairs (cls: 'stablecoin') so they don't show funding/OI columns.
  // Real-time depeg detection: a sustained delta from $1.00 of ±50bps
  // triggers a yellow indicator on the instrument header.
  { id: 'USDC-USD',   cls: 'stablecoin', name: 'USD Coin',          chain: 7, mark: 1.0001,  vol24h: 8.4e9,   oi: 0,     change24h: 0.01,  funding: 0,       dec: 4 },
  { id: 'USDT-USD',   cls: 'stablecoin', name: 'Tether USD',        chain: 7, mark: 0.9998,  vol24h: 32.6e9,  oi: 0,     change24h: -0.02, funding: 0,       dec: 4 },
  { id: 'DAI-USD',    cls: 'stablecoin', name: 'Dai',               chain: 7, mark: 1.0002,  vol24h: 240e6,   oi: 0,     change24h: 0.02,  funding: 0,       dec: 4 },
  { id: 'PYUSD-USD',  cls: 'stablecoin', name: 'PayPal USD',        chain: 7, mark: 0.9999,  vol24h: 18e6,    oi: 0,     change24h: 0.00,  funding: 0,       dec: 4 },
  { id: 'FRAX-USD',   cls: 'stablecoin', name: 'Frax',              chain: 7, mark: 0.9996,  vol24h: 12e6,    oi: 0,     change24h: -0.04, funding: 0,       dec: 4 },
  // Energy marks are pre-load placeholders AND the reference point for the
  // live-price plausibility filter. As of April 2026: WTI ~$88, Brent ~$95
  // (elevated due to Strait of Hormuz tensions).
  { id: 'WTI-F26',    cls: 'energy', name: 'WTI Crude Jan 2026',   chain: 10, mark: 88.00,   vol24h: 2.1e9,  oi: 1.8e9, change24h: -0.40, funding: 0.0015, dec: 3 },
  { id: 'BRENT-F26',  cls: 'energy', name: 'Brent Crude Jan 2026', chain: 10, mark: 95.00,   vol24h: 1.9e9,  oi: 1.6e9, change24h: -0.22, funding: 0.0018, dec: 3 },
  { id: 'NG-G26',     cls: 'energy', name: 'Natural Gas Feb 2026', chain: 11, mark: 3.250,   vol24h: 620e6,  oi: 420e6, change24h: 3.14,  funding: 0.0092, dec: 4 },
  { id: 'HO-F26',     cls: 'energy', name: 'Heating Oil Jan 2026', chain: 12, mark: 2.850,   vol24h: 180e6,  oi: 95e6,  change24h: 0.68,  funding: 0.0031, dec: 4 },
  // Equities — priced via massive.com (polygon.io rebrand) REST API. Marks
  // are pre-load placeholders; real prices load in ~1-2 seconds after
  // page load. Chain routing maps to JPM's hypothetical equity-perps chain.
  // ─── Equities: mega-cap tech ───
  { id: 'AAPL',       cls: 'equity', name: 'Apple Inc.',           chain: 6, mark: 232.50,   vol24h: 62e9,   oi: 12e9,  change24h: 0.84,  funding: 0.0012, dec: 2 },
  { id: 'MSFT',       cls: 'equity', name: 'Microsoft Corp.',      chain: 6, mark: 428.70,   vol24h: 28e9,   oi: 8e9,   change24h: 1.12,  funding: 0.0010, dec: 2 },
  { id: 'NVDA',       cls: 'equity', name: 'NVIDIA Corp.',         chain: 6, mark: 142.80,   vol24h: 94e9,   oi: 18e9,  change24h: 2.47,  funding: 0.0024, dec: 2 },
  { id: 'GOOG',       cls: 'equity', name: 'Alphabet Inc.',        chain: 6, mark: 168.90,   vol24h: 22e9,   oi: 6e9,   change24h: 0.91,  funding: 0.0011, dec: 2 },
  { id: 'AMZN',       cls: 'equity', name: 'Amazon.com Inc.',      chain: 6, mark: 198.20,   vol24h: 26e9,   oi: 7e9,   change24h: 1.34,  funding: 0.0013, dec: 2 },
  { id: 'META',       cls: 'equity', name: 'Meta Platforms',       chain: 6, mark: 562.40,   vol24h: 18e9,   oi: 5e9,   change24h: 0.78,  funding: 0.0009, dec: 2 },
  { id: 'TSLA',       cls: 'equity', name: 'Tesla Inc.',           chain: 6, mark: 248.30,   vol24h: 46e9,   oi: 14e9,  change24h: -1.14, funding: 0.0038, dec: 2 },
  { id: 'AVGO',       cls: 'equity', name: 'Broadcom Inc.',        chain: 6, mark: 1642.50,  vol24h: 8e9,    oi: 2.5e9, change24h: 1.45,  funding: 0.0015, dec: 2 },
  // ─── Equities: financials & banks ───
  { id: 'JPM',        cls: 'equity', name: 'JPMorgan Chase',       chain: 6, mark: 218.60,   vol24h: 12e9,   oi: 4e9,   change24h: 0.52,  funding: 0.0007, dec: 2 },
  { id: 'BAC',        cls: 'equity', name: 'Bank of America',      chain: 6, mark: 42.80,    vol24h: 8e9,    oi: 2.2e9, change24h: 0.33,  funding: 0.0008, dec: 2 },
  { id: 'GS',         cls: 'equity', name: 'Goldman Sachs',        chain: 6, mark: 568.40,   vol24h: 6e9,    oi: 1.8e9, change24h: 0.67,  funding: 0.0009, dec: 2 },
  { id: 'V',          cls: 'equity', name: 'Visa Inc.',            chain: 6, mark: 298.50,   vol24h: 9e9,    oi: 2.5e9, change24h: 0.28,  funding: 0.0006, dec: 2 },
  // ─── Equities: consumer & retail ───
  { id: 'WMT',        cls: 'equity', name: 'Walmart Inc.',         chain: 6, mark: 94.20,    vol24h: 10e9,   oi: 2.8e9, change24h: 0.41,  funding: 0.0007, dec: 2 },
  { id: 'COST',       cls: 'equity', name: 'Costco Wholesale',     chain: 6, mark: 912.70,   vol24h: 5e9,    oi: 1.6e9, change24h: 0.78,  funding: 0.0010, dec: 2 },
  { id: 'DIS',        cls: 'equity', name: 'Walt Disney Co.',      chain: 6, mark: 108.30,   vol24h: 7e9,    oi: 2e9,   change24h: -0.42, funding: 0.0011, dec: 2 },
  // ─── Equities: healthcare ───
  { id: 'UNH',        cls: 'equity', name: 'UnitedHealth Group',   chain: 6, mark: 578.90,   vol24h: 4e9,    oi: 1.3e9, change24h: 0.56,  funding: 0.0008, dec: 2 },
  { id: 'LLY',        cls: 'equity', name: 'Eli Lilly & Co.',      chain: 6, mark: 842.60,   vol24h: 5e9,    oi: 1.5e9, change24h: 1.22,  funding: 0.0012, dec: 2 },
  { id: 'JNJ',        cls: 'equity', name: 'Johnson & Johnson',    chain: 6, mark: 158.40,   vol24h: 6e9,    oi: 1.7e9, change24h: 0.18,  funding: 0.0006, dec: 2 },
  // ─── Indices / ETFs ───
  { id: 'SPY',        cls: 'equity', name: 'SPDR S&P 500 ETF',     chain: 7, mark: 578.40,   vol24h: 36e9,   oi: 9e9,   change24h: 0.42,  funding: 0.0008, dec: 2 },
  { id: 'QQQ',        cls: 'equity', name: 'Invesco QQQ (Nasdaq)', chain: 7, mark: 492.80,   vol24h: 24e9,   oi: 7e9,   change24h: 0.68,  funding: 0.0009, dec: 2 },
  { id: 'DIA',        cls: 'equity', name: 'SPDR Dow Jones ETF',   chain: 7, mark: 428.30,   vol24h: 4e9,    oi: 1.5e9, change24h: 0.28,  funding: 0.0007, dec: 2 },
  { id: 'IWM',        cls: 'equity', name: 'iShares Russell 2000', chain: 7, mark: 218.50,   vol24h: 8e9,    oi: 2.5e9, change24h: 0.52,  funding: 0.0008, dec: 2 },
  { id: 'VTI',        cls: 'equity', name: 'Vanguard Total Market',chain: 7, mark: 288.70,   vol24h: 3e9,    oi: 1.2e9, change24h: 0.44,  funding: 0.0007, dec: 2 },

  // ─── S&P 500 Expansion: Tech ───
  { id: 'GOOGL',      cls: 'equity', name: 'Alphabet Class A',     chain: 6, mark: 167.20,   vol24h: 18e9,   oi: 4e9,   change24h: 0.88,  funding: 0.0011, dec: 2 },
  { id: 'AMD',        cls: 'equity', name: 'Advanced Micro Devices',chain: 6, mark: 168.50,   vol24h: 12e9,   oi: 3e9,   change24h: 1.85,  funding: 0.0018, dec: 2 },
  { id: 'INTC',       cls: 'equity', name: 'Intel Corp.',           chain: 6, mark: 28.40,    vol24h: 6e9,    oi: 1.8e9, change24h: -0.55, funding: 0.0014, dec: 2 },
  { id: 'CRM',        cls: 'equity', name: 'Salesforce Inc.',       chain: 6, mark: 282.60,   vol24h: 4e9,    oi: 1.4e9, change24h: 0.92,  funding: 0.0010, dec: 2 },
  { id: 'ADBE',       cls: 'equity', name: 'Adobe Inc.',            chain: 6, mark: 502.30,   vol24h: 3e9,    oi: 1.1e9, change24h: 0.45,  funding: 0.0009, dec: 2 },
  { id: 'ORCL',       cls: 'equity', name: 'Oracle Corp.',          chain: 6, mark: 142.80,   vol24h: 3e9,    oi: 1.2e9, change24h: 0.62,  funding: 0.0008, dec: 2 },
  { id: 'IBM',        cls: 'equity', name: 'IBM Corp.',             chain: 6, mark: 218.40,   vol24h: 2e9,    oi: 800e6, change24h: 0.34,  funding: 0.0007, dec: 2 },
  { id: 'CSCO',       cls: 'equity', name: 'Cisco Systems',         chain: 6, mark: 58.20,    vol24h: 4e9,    oi: 1.5e9, change24h: 0.28,  funding: 0.0007, dec: 2 },
  { id: 'QCOM',       cls: 'equity', name: 'Qualcomm Inc.',         chain: 6, mark: 168.50,   vol24h: 3e9,    oi: 1.2e9, change24h: 1.12,  funding: 0.0011, dec: 2 },
  { id: 'TXN',        cls: 'equity', name: 'Texas Instruments',     chain: 6, mark: 198.30,   vol24h: 2e9,    oi: 800e6, change24h: 0.55,  funding: 0.0008, dec: 2 },
  { id: 'NFLX',       cls: 'equity', name: 'Netflix Inc.',          chain: 6, mark: 858.40,   vol24h: 4e9,    oi: 1.2e9, change24h: 1.18,  funding: 0.0012, dec: 2 },
  { id: 'NOW',        cls: 'equity', name: 'ServiceNow Inc.',       chain: 6, mark: 924.50,   vol24h: 1.5e9,  oi: 600e6, change24h: 0.76,  funding: 0.0009, dec: 2 },
  { id: 'PLTR',       cls: 'equity', name: 'Palantir Technologies', chain: 6, mark: 78.20,    vol24h: 5e9,    oi: 1.4e9, change24h: 2.45,  funding: 0.0024, dec: 2 },
  { id: 'SHOP',       cls: 'equity', name: 'Shopify Inc.',          chain: 6, mark: 102.40,   vol24h: 2e9,    oi: 800e6, change24h: 1.62,  funding: 0.0015, dec: 2 },
  { id: 'SNOW',       cls: 'equity', name: 'Snowflake Inc.',        chain: 6, mark: 152.80,   vol24h: 2e9,    oi: 700e6, change24h: 1.04,  funding: 0.0014, dec: 2 },
  { id: 'UBER',       cls: 'equity', name: 'Uber Technologies',     chain: 6, mark: 78.40,    vol24h: 4e9,    oi: 1.2e9, change24h: 0.85,  funding: 0.0011, dec: 2 },
  { id: 'ASML',       cls: 'equity', name: 'ASML Holding (ADR)',    chain: 6, mark: 728.60,   vol24h: 2e9,    oi: 700e6, change24h: 1.45,  funding: 0.0013, dec: 2 },
  { id: 'TSM',        cls: 'equity', name: 'Taiwan Semi (ADR)',     chain: 6, mark: 184.80,   vol24h: 6e9,    oi: 2e9,   change24h: 1.22,  funding: 0.0012, dec: 2 },

  // ─── S&P 500 Expansion: Financials & Banks ───
  { id: 'BRK.B',      cls: 'equity', name: 'Berkshire Hathaway B',  chain: 6, mark: 458.20,   vol24h: 4e9,    oi: 1.4e9, change24h: 0.32,  funding: 0.0006, dec: 2 },
  { id: 'WFC',        cls: 'equity', name: 'Wells Fargo & Co.',     chain: 6, mark: 68.40,    vol24h: 6e9,    oi: 1.8e9, change24h: 0.42,  funding: 0.0008, dec: 2 },
  { id: 'MS',         cls: 'equity', name: 'Morgan Stanley',        chain: 6, mark: 128.60,   vol24h: 4e9,    oi: 1.4e9, change24h: 0.58,  funding: 0.0009, dec: 2 },
  { id: 'C',          cls: 'equity', name: 'Citigroup Inc.',        chain: 6, mark: 72.40,    vol24h: 5e9,    oi: 1.6e9, change24h: 0.38,  funding: 0.0008, dec: 2 },
  { id: 'AXP',        cls: 'equity', name: 'American Express',      chain: 6, mark: 282.40,   vol24h: 3e9,    oi: 1e9,   change24h: 0.54,  funding: 0.0009, dec: 2 },
  { id: 'MA',         cls: 'equity', name: 'Mastercard Inc.',       chain: 6, mark: 528.40,   vol24h: 4e9,    oi: 1.2e9, change24h: 0.45,  funding: 0.0008, dec: 2 },
  { id: 'BLK',        cls: 'equity', name: 'BlackRock Inc.',        chain: 6, mark: 968.50,   vol24h: 1.5e9,  oi: 600e6, change24h: 0.62,  funding: 0.0010, dec: 2 },
  { id: 'SCHW',       cls: 'equity', name: 'Charles Schwab',        chain: 6, mark: 78.20,    vol24h: 3e9,    oi: 1e9,   change24h: 0.48,  funding: 0.0008, dec: 2 },
  { id: 'PYPL',       cls: 'equity', name: 'PayPal Holdings',       chain: 6, mark: 78.40,    vol24h: 3e9,    oi: 1e9,   change24h: 0.42,  funding: 0.0010, dec: 2 },
  { id: 'SQ',         cls: 'equity', name: 'Block Inc.',            chain: 6, mark: 88.40,    vol24h: 2e9,    oi: 800e6, change24h: 1.18,  funding: 0.0014, dec: 2 },

  // ─── S&P 500 Expansion: Healthcare & Pharma ───
  { id: 'PFE',        cls: 'equity', name: 'Pfizer Inc.',           chain: 6, mark: 28.40,    vol24h: 6e9,    oi: 1.8e9, change24h: 0.18,  funding: 0.0008, dec: 2 },
  { id: 'MRK',        cls: 'equity', name: 'Merck & Co.',           chain: 6, mark: 122.40,   vol24h: 5e9,    oi: 1.6e9, change24h: 0.32,  funding: 0.0007, dec: 2 },
  { id: 'ABBV',       cls: 'equity', name: 'AbbVie Inc.',           chain: 6, mark: 178.50,   vol24h: 4e9,    oi: 1.4e9, change24h: 0.55,  funding: 0.0008, dec: 2 },
  { id: 'ABT',        cls: 'equity', name: 'Abbott Laboratories',   chain: 6, mark: 118.40,   vol24h: 3e9,    oi: 1e9,   change24h: 0.42,  funding: 0.0007, dec: 2 },
  { id: 'TMO',        cls: 'equity', name: 'Thermo Fisher Sci.',    chain: 6, mark: 558.30,   vol24h: 1.5e9,  oi: 600e6, change24h: 0.38,  funding: 0.0008, dec: 2 },
  { id: 'BMY',        cls: 'equity', name: 'Bristol-Myers Squibb',  chain: 6, mark: 52.40,    vol24h: 3e9,    oi: 1e9,   change24h: 0.22,  funding: 0.0008, dec: 2 },
  { id: 'CVS',        cls: 'equity', name: 'CVS Health Corp.',      chain: 6, mark: 62.40,    vol24h: 3e9,    oi: 1e9,   change24h: 0.18,  funding: 0.0009, dec: 2 },
  { id: 'ELV',        cls: 'equity', name: 'Elevance Health',       chain: 6, mark: 482.60,   vol24h: 1e9,    oi: 400e6, change24h: 0.58,  funding: 0.0008, dec: 2 },
  { id: 'MCK',        cls: 'equity', name: 'McKesson Corp.',        chain: 6, mark: 612.80,   vol24h: 800e6,  oi: 320e6, change24h: 0.42,  funding: 0.0007, dec: 2 },

  // ─── S&P 500 Expansion: Consumer & Retail ───
  { id: 'PG',         cls: 'equity', name: 'Procter & Gamble',      chain: 6, mark: 168.40,   vol24h: 4e9,    oi: 1.4e9, change24h: 0.22,  funding: 0.0006, dec: 2 },
  { id: 'KO',         cls: 'equity', name: 'Coca-Cola Co.',         chain: 6, mark: 68.40,    vol24h: 4e9,    oi: 1.2e9, change24h: 0.18,  funding: 0.0006, dec: 2 },
  { id: 'PEP',        cls: 'equity', name: 'PepsiCo Inc.',          chain: 6, mark: 168.50,   vol24h: 3e9,    oi: 1e9,   change24h: 0.28,  funding: 0.0007, dec: 2 },
  { id: 'MCD',        cls: 'equity', name: 'McDonalds Corp.',       chain: 6, mark: 298.40,   vol24h: 3e9,    oi: 1e9,   change24h: 0.34,  funding: 0.0007, dec: 2 },
  { id: 'NKE',        cls: 'equity', name: 'Nike Inc.',             chain: 6, mark: 78.40,    vol24h: 4e9,    oi: 1.2e9, change24h: -0.22, funding: 0.0009, dec: 2 },
  { id: 'SBUX',       cls: 'equity', name: 'Starbucks Corp.',       chain: 6, mark: 92.40,    vol24h: 3e9,    oi: 1e9,   change24h: 0.42,  funding: 0.0008, dec: 2 },
  { id: 'HD',         cls: 'equity', name: 'Home Depot',            chain: 6, mark: 392.40,   vol24h: 4e9,    oi: 1.4e9, change24h: 0.55,  funding: 0.0008, dec: 2 },
  { id: 'LOW',        cls: 'equity', name: 'Lowes Companies',       chain: 6, mark: 248.50,   vol24h: 2e9,    oi: 800e6, change24h: 0.42,  funding: 0.0007, dec: 2 },
  { id: 'TGT',        cls: 'equity', name: 'Target Corp.',          chain: 6, mark: 142.40,   vol24h: 2e9,    oi: 800e6, change24h: 0.32,  funding: 0.0008, dec: 2 },

  // ─── S&P 500 Expansion: Energy ───
  { id: 'XOM',        cls: 'equity', name: 'Exxon Mobil Corp.',     chain: 6, mark: 118.50,   vol24h: 6e9,    oi: 1.8e9, change24h: 0.62,  funding: 0.0008, dec: 2 },
  { id: 'CVX',        cls: 'equity', name: 'Chevron Corp.',         chain: 6, mark: 158.40,   vol24h: 4e9,    oi: 1.4e9, change24h: 0.48,  funding: 0.0008, dec: 2 },
  { id: 'COP',        cls: 'equity', name: 'ConocoPhillips',        chain: 6, mark: 108.40,   vol24h: 3e9,    oi: 1e9,   change24h: 0.55,  funding: 0.0009, dec: 2 },
  { id: 'SLB',        cls: 'equity', name: 'Schlumberger N.V.',     chain: 6, mark: 48.40,    vol24h: 3e9,    oi: 1e9,   change24h: 0.62,  funding: 0.0010, dec: 2 },

  // ─── S&P 500 Expansion: Industrials ───
  { id: 'BA',         cls: 'equity', name: 'Boeing Co.',            chain: 6, mark: 168.40,   vol24h: 4e9,    oi: 1.4e9, change24h: -0.42, funding: 0.0014, dec: 2 },
  { id: 'CAT',        cls: 'equity', name: 'Caterpillar Inc.',      chain: 6, mark: 348.40,   vol24h: 2e9,    oi: 800e6, change24h: 0.55,  funding: 0.0009, dec: 2 },
  { id: 'GE',         cls: 'equity', name: 'General Electric',      chain: 6, mark: 198.40,   vol24h: 3e9,    oi: 1e9,   change24h: 0.42,  funding: 0.0008, dec: 2 },
  { id: 'HON',        cls: 'equity', name: 'Honeywell International',chain: 6, mark: 218.40,   vol24h: 2e9,    oi: 800e6, change24h: 0.32,  funding: 0.0007, dec: 2 },
  { id: 'LMT',        cls: 'equity', name: 'Lockheed Martin',       chain: 6, mark: 528.40,   vol24h: 2e9,    oi: 800e6, change24h: 0.42,  funding: 0.0008, dec: 2 },
  { id: 'RTX',        cls: 'equity', name: 'Raytheon Technologies', chain: 6, mark: 122.40,   vol24h: 3e9,    oi: 1e9,   change24h: 0.38,  funding: 0.0008, dec: 2 },
  { id: 'UPS',        cls: 'equity', name: 'United Parcel Service', chain: 6, mark: 132.40,   vol24h: 3e9,    oi: 1e9,   change24h: -0.18, funding: 0.0009, dec: 2 },
  { id: 'FDX',        cls: 'equity', name: 'FedEx Corp.',           chain: 6, mark: 268.40,   vol24h: 2e9,    oi: 800e6, change24h: 0.32,  funding: 0.0009, dec: 2 },
  { id: 'F',          cls: 'equity', name: 'Ford Motor Co.',        chain: 6, mark: 11.40,    vol24h: 4e9,    oi: 1.2e9, change24h: 0.28,  funding: 0.0010, dec: 2 },
  { id: 'GM',         cls: 'equity', name: 'General Motors',        chain: 6, mark: 48.40,    vol24h: 3e9,    oi: 1e9,   change24h: 0.42,  funding: 0.0010, dec: 2 },

  // ─── S&P 500 Expansion: Communications & Media ───
  { id: 'CMCSA',      cls: 'equity', name: 'Comcast Corp.',         chain: 6, mark: 38.40,    vol24h: 4e9,    oi: 1.2e9, change24h: 0.18,  funding: 0.0008, dec: 2 },
  { id: 'VZ',         cls: 'equity', name: 'Verizon Communications',chain: 6, mark: 42.40,    vol24h: 5e9,    oi: 1.5e9, change24h: 0.22,  funding: 0.0006, dec: 2 },
  { id: 'T',          cls: 'equity', name: 'AT&T Inc.',             chain: 6, mark: 22.40,    vol24h: 5e9,    oi: 1.5e9, change24h: 0.18,  funding: 0.0007, dec: 2 },
  { id: 'CHTR',       cls: 'equity', name: 'Charter Communications',chain: 6, mark: 348.40,   vol24h: 1.5e9,  oi: 600e6, change24h: 0.42,  funding: 0.0008, dec: 2 },
  { id: 'SPOT',       cls: 'equity', name: 'Spotify Technology',    chain: 6, mark: 462.40,   vol24h: 1.5e9,  oi: 600e6, change24h: 0.78,  funding: 0.0010, dec: 2 },
  { id: 'PINS',       cls: 'equity', name: 'Pinterest Inc.',        chain: 6, mark: 32.40,    vol24h: 2e9,    oi: 800e6, change24h: 0.55,  funding: 0.0012, dec: 2 },
  { id: 'SNAP',       cls: 'equity', name: 'Snap Inc.',             chain: 6, mark: 11.40,    vol24h: 3e9,    oi: 1e9,   change24h: 0.85,  funding: 0.0014, dec: 2 },

  // ─── S&P 500 Expansion: Utilities & Real Estate ───
  { id: 'NEE',        cls: 'equity', name: 'NextEra Energy',        chain: 6, mark: 78.40,    vol24h: 3e9,    oi: 1e9,   change24h: 0.28,  funding: 0.0006, dec: 2 },
  { id: 'DUK',        cls: 'equity', name: 'Duke Energy Corp.',     chain: 6, mark: 118.40,   vol24h: 1.5e9,  oi: 600e6, change24h: 0.18,  funding: 0.0006, dec: 2 },
  { id: 'AMT',        cls: 'equity', name: 'American Tower Corp.',  chain: 6, mark: 218.40,   vol24h: 1.5e9,  oi: 600e6, change24h: 0.32,  funding: 0.0007, dec: 2 },

  // ─── S&P 500 Expansion: Materials ───
  { id: 'LIN',        cls: 'equity', name: 'Linde plc',             chain: 6, mark: 478.40,   vol24h: 1e9,    oi: 400e6, change24h: 0.28,  funding: 0.0007, dec: 2 },
  { id: 'SHW',        cls: 'equity', name: 'Sherwin-Williams Co.',  chain: 6, mark: 358.40,   vol24h: 800e6,  oi: 320e6, change24h: 0.42,  funding: 0.0007, dec: 2 },
  { id: 'NEM',        cls: 'equity', name: 'Newmont Corp.',         chain: 6, mark: 48.40,    vol24h: 2e9,    oi: 800e6, change24h: 1.15,  funding: 0.0011, dec: 2 },
  { id: 'DE',         cls: 'equity', name: 'Deere & Co.',           chain: 6, mark: 458.40,   vol24h: 1.5e9,  oi: 600e6, change24h: 0.42,  funding: 0.0008, dec: 2 },

  // ─── S&P 500 Expansion: Travel & Leisure ───
  { id: 'BKNG',       cls: 'equity', name: 'Booking Holdings',      chain: 6, mark: 4858.40,  vol24h: 800e6,  oi: 320e6, change24h: 0.62,  funding: 0.0009, dec: 2 },
  { id: 'MAR',        cls: 'equity', name: 'Marriott International',chain: 6, mark: 268.40,   vol24h: 1.5e9,  oi: 600e6, change24h: 0.42,  funding: 0.0008, dec: 2 },
  { id: 'HLT',        cls: 'equity', name: 'Hilton Worldwide',      chain: 6, mark: 248.40,   vol24h: 1e9,    oi: 400e6, change24h: 0.55,  funding: 0.0008, dec: 2 },

  // ─── Crypto-adjacent equities ───
  { id: 'COIN',       cls: 'equity', name: 'Coinbase Global',       chain: 6, mark: 248.40,   vol24h: 4e9,    oi: 1.2e9, change24h: 2.45,  funding: 0.0024, dec: 2 },
  { id: 'MSTR',       cls: 'equity', name: 'MicroStrategy Inc.',    chain: 6, mark: 1842.40,  vol24h: 3e9,    oi: 1e9,   change24h: 3.18,  funding: 0.0028, dec: 2 },

  // ─── Precious & industrial metals (futures) ───
  // Marks reflect early-2026 levels: gold near all-time highs as central bank
  // buying continues; silver tracking gold; copper elevated on tight supply.
  { id: 'XAU-F26',    cls: 'metal',  name: 'Gold Futures Jun 2026',  chain: 13, mark: 3142.50, vol24h: 4.8e9, oi: 18e9,  change24h: 0.62,  funding: 0.0012, dec: 2 },
  { id: 'XAG-F26',    cls: 'metal',  name: 'Silver Futures Jul 2026',chain: 13, mark: 38.42,   vol24h: 1.2e9, oi: 4.5e9, change24h: 1.18,  funding: 0.0018, dec: 3 },
  { id: 'PLAT-F26',   cls: 'metal',  name: 'Platinum Futures Jul 26',chain: 13, mark: 1024.50, vol24h: 380e6, oi: 1.2e9, change24h: 0.42,  funding: 0.0021, dec: 2 },
  { id: 'PALL-F26',   cls: 'metal',  name: 'Palladium Futures Jun 26',chain:13, mark: 1148.30, vol24h: 220e6, oi: 720e6, change24h: -0.85, funding: 0.0028, dec: 2 },
  { id: 'CU-F26',     cls: 'metal',  name: 'Copper Futures Jul 2026',chain: 13, mark: 4.624,   vol24h: 1.8e9, oi: 5.2e9, change24h: 0.95,  funding: 0.0015, dec: 4 },
  // Spot ETFs for retail-friendly metal exposure
  { id: 'GLD',        cls: 'equity', name: 'SPDR Gold Trust',        chain: 7,  mark: 292.40,  vol24h: 6e9,   oi: 1.8e9, change24h: 0.58,  funding: 0.0008, dec: 2 },
  { id: 'SLV',        cls: 'equity', name: 'iShares Silver Trust',   chain: 7,  mark: 35.20,   vol24h: 1.5e9, oi: 480e6, change24h: 1.12,  funding: 0.0011, dec: 2 },

  // ─── FX pairs (live via ExchangeRate-API when key present) ───
  // ID format is "BASE-QUOTE"; the FX feed handler in useFeed parses this
  // and queries https://v6.exchangerate-api.com for the live conversion.
  // Marks below are early-2026 reasonable values used as fallback.
  { id: 'EUR-USD', cls: 'fx', name: 'Euro / US Dollar',       chain: 14, mark: 1.0825,  vol24h: 6e9,  oi: 0, change24h: 0.18, funding: 0, dec: 4 },
  { id: 'GBP-USD', cls: 'fx', name: 'British Pound / USD',    chain: 14, mark: 1.2640,  vol24h: 4e9,  oi: 0, change24h: 0.22, funding: 0, dec: 4 },
  { id: 'USD-JPY', cls: 'fx', name: 'US Dollar / Yen',        chain: 14, mark: 152.40,  vol24h: 5e9,  oi: 0, change24h: -0.14, funding: 0, dec: 2 },
  { id: 'USD-CHF', cls: 'fx', name: 'US Dollar / Swiss Franc',chain: 14, mark: 0.8920,  vol24h: 2e9,  oi: 0, change24h: -0.08, funding: 0, dec: 4 },
  { id: 'AUD-USD', cls: 'fx', name: 'Australian Dollar / USD',chain: 14, mark: 0.6585,  vol24h: 1.8e9,oi: 0, change24h: 0.31, funding: 0, dec: 4 },
  { id: 'USD-CAD', cls: 'fx', name: 'US Dollar / Canadian',   chain: 14, mark: 1.3680,  vol24h: 1.5e9,oi: 0, change24h: 0.04, funding: 0, dec: 4 },
];

