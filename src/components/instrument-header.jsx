// @ts-check
// IMO Onyx Terminal — Instrument header + picker
//
// Phase 3p.31 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines 7874-9190, ~1,317 lines).
//
// Sixth "lift the children" phase preparing for TradePage extraction.
// This module covers TradePage's top-of-page strip:
//
//   - InstrumentHeader: shows ticker, price, change, watchlist toggle,
//     buy/sell quick-trade buttons, and a row of toggleable stats.
//     Used by TradePage and 3 other surfaces.
//
//   - InstrumentPicker: full-screen instrument browser with search,
//     watchlist, sector grouping, AI-suggested instruments. Opens
//     when the user clicks the ticker badge.
//
// Public exports:
//   InstrumentHeader({ instrument, feed, account, onOpenPicker, ... })
//   InstrumentPicker({ active, onSelect, onClose, watchlist, onToggleWatch })
//   AnalyzeChartButton({ instrument, feed })  — 3 callers
//
// Internal companions (only used inside this module):
//   HeaderStatsToggleable  — stats row inside InstrumentHeader
//   Stat                   — single labeled stat cell
//   MarketOpenIndicator    — "Open"/"Closed" pill (uses isMarketOpen)
//   isMarketOpen           — US equity market hours helper
//
// Imports:
//   lib/constants.js      (COLORS)
//   lib/instruments.js    (INSTRUMENTS)
//   lib/polygon-api.js    (SECTOR_CONSTITUENTS)
//   lib/ai-calls.js       (callAI, exaSearch)
//   leaf-ui.jsx           (InstIcon, MicButton, SectorLetter)

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowDownRight, ArrowUpRight, Filter, Layers, Search, Sparkles,
  Star, Target,
} from 'lucide-react';
import { COLORS, TICKER_SECTORS } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import { formatTicker } from '../lib/format.js';
import { isMarketOpen } from '../lib/market-hours.js';
import { SECTOR_CONSTITUENTS } from '../lib/polygon-api.js';
import { fetchOpenFigi } from '../lib/external-data.js';
import { callAI, exaSearch } from '../lib/ai-calls.js';
import { InstIcon, MicButton, SectorLetter } from './leaf-ui.jsx';

// fmt + fmtCompact (inlined per established pattern).
const _getFmtLocale = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('imo_settings') : null;
    if (!raw) return 'en-US';
    const s = JSON.parse(raw);
    const loc = s?.numberFormat;
    if (typeof loc === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(loc)) return loc;
    return 'en-US';
  } catch { return 'en-US'; }
};
const fmt = (n, d = 2) => Number(n).toLocaleString(_getFmtLocale(), {
  minimumFractionDigits: d, maximumFractionDigits: d,
});
const fmtCompact = (n) => {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs/1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}${(abs/1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}${(abs/1e6).toFixed(2)}M`;
  if (abs >= 1e3)  return `${sign}${(abs/1e3).toFixed(2)}K`;
  return `${sign}${abs.toFixed(2)}`;
};

// Env-var keys (duplicated from monolith).
const MASSIVE_API_KEY  = (() => { try { return import.meta.env?.VITE_MASSIVE_API_KEY  ?? ''; } catch { return ''; } })();
const ANTHROPIC_API_KEY= (() => { try { return import.meta.env?.VITE_ANTHROPIC_API_KEY?? ''; } catch { return ''; } })();
const EXA_API_KEY      = (() => { try { return import.meta.env?.VITE_EXA_API_KEY      ?? ''; } catch { return ''; } })();

// TICKER_DEBRIEFS — curated 1-line summaries shown as tooltip on
// the ticker badge. Inlined from monolith — only InstrumentHeader uses it.
const TICKER_DEBRIEFS = {
  AAPL:  'Apple — designs iPhone, Mac, Watch, AirPods + builds services revenue (App Store, iCloud).',
  MSFT:  'Microsoft — Windows + Office + Azure cloud + LinkedIn; AI-tilted via OpenAI partnership.',
  NVDA:  'Nvidia — leading designer of GPUs powering AI training, gaming, and data centers.',
  GOOG:  'Alphabet — Google Search, YouTube, Android, Cloud, and self-driving (Waymo).',
  GOOGL: 'Alphabet Class A (voting) — Google Search, YouTube, Android, Cloud.',
  AMZN:  'Amazon — global e-commerce + AWS cloud (largest profit driver) + advertising.',
  META:  'Meta Platforms — Facebook, Instagram, WhatsApp, and Reality Labs (VR).',
  TSLA:  'Tesla — EVs, energy storage, and robotaxi/Optimus ambitions.',
  JPM:   'JPMorgan Chase — largest US bank by assets; consumer + investment banking.',
  BAC:   'Bank of America — second-largest US bank; consumer-focused.',
  GS:    'Goldman Sachs — investment bank focused on M&A, trading, and asset management.',
  V:     'Visa — global card payments network; takes a fee on every swipe.',
  MA:    'Mastercard — second-largest payments network; competes with Visa.',
  BRK_B: 'Berkshire Hathaway — Warren Buffett conglomerate (insurance + utilities + stocks).',
  'BRK.B':'Berkshire Hathaway — Warren Buffett conglomerate (insurance + utilities + stocks).',
  WFC:   'Wells Fargo — large US consumer + commercial bank.',
  MS:    'Morgan Stanley — wealth management and investment banking.',
  C:     'Citigroup — global bank with focus on emerging markets + treasury services.',
  AXP:   'American Express — premium credit cards + travel + lending.',
  BLK:   'BlackRock — world\'s largest asset manager; runs iShares ETFs.',
  SCHW:  'Charles Schwab — discount broker + asset manager.',
  PYPL:  'PayPal — online payments + Venmo P2P transfers.',
  SQ:    'Block — Square POS + Cash App + bitcoin services.',
  PFE:   'Pfizer — global pharma; vaccines + cancer + cardiovascular drugs.',
  MRK:   'Merck — pharma; cancer drug Keytruda is the world\'s #1-selling drug.',
  ABBV:  'AbbVie — pharma maker of Humira and Botox.',
  ABT:   'Abbott Laboratories — diagnostics, medical devices, nutrition.',
  TMO:   'Thermo Fisher Scientific — lab equipment and analytical instruments.',
  BMY:   'Bristol-Myers Squibb — biopharma; cancer + cardiovascular.',
  CVS:   'CVS Health — drugstores + pharmacy benefits + Aetna insurance.',
  ELV:   'Elevance Health (formerly Anthem) — major US health insurer.',
  MCK:   'McKesson — largest US pharmaceutical distributor.',
  JNJ:   'Johnson & Johnson — pharma + medical devices; AAA-rated balance sheet.',
  LLY:   'Eli Lilly — pharma leader in diabetes (Mounjaro) and weight loss (Zepbound).',
  UNH:   'UnitedHealth — largest US health insurer + Optum services.',
  PG:    'Procter & Gamble — Tide, Pampers, Gillette, Crest; defensive consumer staple.',
  KO:    'Coca-Cola — global beverages; long dividend track record.',
  PEP:   'PepsiCo — beverages + Frito-Lay snacks (bigger than soda).',
  WMT:   'Walmart — largest US retailer by revenue; growing e-commerce + ads.',
  COST:  'Costco — membership warehouse club; high member retention.',
  MCD:   'McDonald\'s — global QSR franchise model with real estate component.',
  SBUX:  'Starbucks — global coffee chain; pricing power on premium beverages.',
  NKE:   'Nike — largest athletic apparel + footwear brand.',
  DIS:   'Disney — parks, streaming (Disney+, Hulu), studios, ESPN.',
  HD:    'Home Depot — largest home improvement retailer; pro-contractor focus.',
  LOW:   'Lowe\'s — second-largest home improvement; DIY-focused.',
  TGT:   'Target — discount retailer with strong owned brands.',
  XOM:   'ExxonMobil — largest US oil + gas major; integrated upstream/downstream.',
  CVX:   'Chevron — second-largest US oil major; strong dividend history.',
  COP:   'ConocoPhillips — pure-play upstream E&P (no refining).',
  SLB:   'Schlumberger — largest oilfield services company.',
  BA:    'Boeing — commercial aircraft (737, 787) + defense + space.',
  CAT:   'Caterpillar — construction + mining equipment maker; cyclical bellwether.',
  GE:    'General Electric — aerospace engines, healthcare, energy (post-split).',
  HON:   'Honeywell — aerospace + automation + materials.',
  LMT:   'Lockheed Martin — top US defense contractor; F-35 + missiles.',
  RTX:   'Raytheon Technologies — Pratt & Whitney engines + Collins + missiles.',
  UPS:   'United Parcel Service — global parcel delivery + supply chain.',
  FDX:   'FedEx — global parcel + freight; key logistics player.',
  F:     'Ford — US #2 automaker; truck + EV transition.',
  GM:    'General Motors — US #1 automaker; Cruise self-driving + EVs.',
  CMCSA: 'Comcast — Xfinity cable + NBCUniversal + Peacock streaming.',
  VZ:    'Verizon — largest US wireless carrier by subs + dividend favorite.',
  T:     'AT&T — wireless + fiber broadband post-WarnerMedia divestiture.',
  CHTR:  'Charter Communications — Spectrum cable broadband + cable TV.',
  SPOT:  'Spotify — leading audio streaming platform; podcasts + music.',
  PINS:  'Pinterest — visual discovery + shopping platform.',
  SNAP:  'Snap — Snapchat AR + messaging; Spectacles AR glasses.',
  NEE:   'NextEra Energy — largest US renewable energy utility.',
  DUK:   'Duke Energy — major US Southeast utility; reliable dividend.',
  AMT:   'American Tower — largest US cell tower REIT.',
  LIN:   'Linde — largest industrial gas supplier (oxygen, nitrogen, hydrogen).',
  SHW:   'Sherwin-Williams — largest US paint maker.',
  NEM:   'Newmont — world\'s largest gold miner.',
  DE:    'Deere — largest agricultural equipment maker (John Deere brand).',
  BKNG:  'Booking Holdings — owns Booking.com, Priceline, Kayak.',
  MAR:   'Marriott International — largest hotel operator by rooms.',
  HLT:   'Hilton Worldwide — second-largest hotel operator.',
  AMD:   'Advanced Micro Devices — CPUs + GPUs; main competitor to Intel + Nvidia.',
  INTC:  'Intel — long-time CPU leader; restructuring around foundry business.',
  CRM:   'Salesforce — leading CRM software + cloud apps.',
  ADBE:  'Adobe — Photoshop, Illustrator, PDF (Acrobat), Firefly AI.',
  ORCL:  'Oracle — database software + growing cloud (OCI) + Cerner healthcare.',
  IBM:   'IBM — hybrid cloud (Red Hat) + consulting + mainframes.',
  CSCO:  'Cisco — networking equipment + cybersecurity.',
  QCOM:  'Qualcomm — mobile chip designer; licenses 5G/4G IP.',
  TXN:   'Texas Instruments — analog + embedded semiconductors.',
  NFLX:  'Netflix — global streaming leader; entering games + ads tier.',
  NOW:   'ServiceNow — workflow automation software for enterprises.',
  PLTR:  'Palantir — data analytics for government + commercial.',
  SHOP:  'Shopify — e-commerce platform for online merchants.',
  SNOW:  'Snowflake — cloud data warehouse; consumption-based pricing.',
  UBER:  'Uber — rideshare + Uber Eats delivery; freight.',
  ASML:  'ASML — only maker of EUV lithography machines (essential for chips).',
  TSM:   'Taiwan Semiconductor — largest pure-play chip foundry; Apple + Nvidia client.',
  COIN:  'Coinbase — largest US crypto exchange; volume tied to crypto cycles.',
  MSTR:  'MicroStrategy — software firm with the largest corporate Bitcoin treasury.',
  AVGO:  'Broadcom — semiconductors + VMware enterprise software.',
  // Index ETFs
  SPY:   'SPDR S&P 500 ETF — tracks the 500 largest US companies; the market benchmark.',
  QQQ:   'Invesco QQQ — tracks Nasdaq-100 (heavy tech tilt).',
  DIA:   'SPDR DJIA — tracks Dow Jones Industrial Average (30 megacaps).',
  IWM:   'iShares Russell 2000 — tracks 2000 small-cap US stocks.',
  VTI:   'Vanguard Total Market — broad US equity exposure (4000+ stocks).',
  GLD:   'SPDR Gold Trust — physical gold ETF; inflation hedge proxy.',
  SLV:   'iShares Silver Trust — physical silver ETF.',
  // Crypto perps
  'BTC-PERP': 'Bitcoin perpetual futures — leveraged exposure to BTC, no expiry.',
  'ETH-PERP': 'Ethereum perpetual futures — leveraged exposure to ETH.',
  'SOL-PERP': 'Solana perpetual futures — leveraged exposure to SOL.',
  // Energy
  'WTI-F26':  'West Texas Intermediate June 2026 — US crude oil benchmark futures.',
  'BRENT-F26':'Brent crude June 2026 — global oil price benchmark.',
  'NG-F26':   'Natural gas June 2026 futures — Henry Hub benchmark.',
  'HO-F26':   'Heating oil June 2026 futures — distillate fuel benchmark.',
  // Metals
  'XAU-F26':  'Gold June 2026 futures — most-traded precious metal.',
  'XAG-F26':  'Silver July 2026 futures — both monetary + industrial demand.',
  'PLAT-F26': 'Platinum July 2026 futures — used in catalytic converters.',
  'PALL-F26': 'Palladium June 2026 futures — auto catalysts main driver.',
  'CU-F26':   'Copper July 2026 futures — bellwether for global manufacturing.',
};

// isMarketOpen — moved to lib/market-hours.js in 3p.34 because TS
// checking surfaced 2 additional latent callers in trade-feeds.js
// that needed access to it.

// MarketOpenIndicator — pill showing "Open" or "Closed".
const MarketOpenIndicator = () => {
  const [open, setOpen] = useState(() => isMarketOpen());
  useEffect(() => {
    const id = setInterval(() => setOpen(isMarketOpen()), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    // Slightly bigger per UX feedback — was px-1.5 py-0.5 text-[10px]
    // and visibly cramped against the BTC-PERP price tile. Bumped to
    // px-2 py-1 text-[11px] with a 6px dot so it reads as a real
    // button-sized status indicator.
    <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded text-[11px] shrink-0"
         style={{
           background: open ? 'rgba(31,178,107,0.10)' : 'rgba(138,147,166,0.08)',
           border: `1px solid ${open ? 'rgba(31,178,107,0.4)' : COLORS.border}`,
           color: open ? COLORS.green : COLORS.textDim,
         }}
         title={open ? 'US equity market is currently open (9:30am – 4:00pm ET)' : 'US equity market is currently closed'}>
      <span className="rounded-full" style={{ width: 6, height: 6, background: open ? COLORS.green : COLORS.textDim }} />
      <span className="font-medium">{open ? 'Open' : 'Closed'}</span>
    </div>
  );
};

const HeaderStatsToggleable = ({ instrument, feed, account, hasOrderEntry, onQuickTrade }) => {
  const ALL_STATS = [
    { id: 'oracle',   label: 'Oracle price', value: () => fmt(feed.price * 0.9998, instrument.dec) },
    { id: 'vol24h',   label: '24h volume',   value: () => fmtCompact(instrument.vol24h) },
    { id: 'oi',       label: 'Open interest', value: () => fmtCompact(instrument.oi) },
    { id: 'funding',  label: 'Funding / 8h',  value: () => `${instrument.funding >= 0 ? '+' : ''}${(instrument.funding * 100).toFixed(4)}%`,
      tone: () => instrument.funding >= 0 ? 'mint' : 'red' },
    { id: 'div',      label: 'Div yield',     value: () => {
        const seed = (instrument.id ?? 'X').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        const r = Math.sin(seed * 12.9898) * 43758.5453;
        const yld = ((r - Math.floor(r)) * 4).toFixed(2);
        return `${yld}%`;
      } },
  ];
  const [enabledStats, setEnabledStats] = useState(() => {
    try { return JSON.parse(localStorage.getItem('imo_header_stats') ?? '[]'); }
    catch { return []; }
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const toggleStat = (id) => {
    setEnabledStats(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      try { localStorage.setItem('imo_header_stats', JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const visibleStats = ALL_STATS.filter(s => enabledStats.includes(s.id));
  return (
    <div className="flex items-center gap-7">
      <Stat label="Bid"
            value={fmt(feed.price * 0.9999, instrument.dec)}
            tone="green" />
      <Stat label="Ask"
            value={fmt(feed.price * 1.0001, instrument.dec)}
            tone="red" />
      {/* Owned-shares indicator — only shown when the user has an open
          long position in this instrument. Sits right next to Bid/Ask
          so it answers "do I own this?" at a glance without scanning
          the Positions panel. We pull from account.positions, sum any
          buy-side size on this instrument, and render a compact green
          pill with the share count + unrealized P&L tone. The pill
          tooltip surfaces the entry price and full P&L so users get
          the full context on hover. */}
      {(() => {
        if (!account?.positions || !instrument?.id) return null;
        const positions = account.positions.filter(
          p => p.instrument?.id === instrument.id && (p.side === 'buy' || p.side === 'long')
        );
        if (positions.length === 0) return null;
        const totalSize = positions.reduce((s, p) => s + (Number(p.size) || 0), 0);
        if (totalSize <= 0) return null;
        const totalCost = positions.reduce((s, p) => s + (Number(p.size) || 0) * (Number(p.entry) || 0), 0);
        const avgEntry = totalSize > 0 ? totalCost / totalSize : 0;
        const mark = feed?.price ?? instrument.mark ?? avgEntry;
        const unrealized = (mark - avgEntry) * totalSize;
        const isUp = unrealized >= 0;
        // Ticker-class-aware unit label — equities show "shares", crypto
        // shows "units", futures show "contracts" — so the pill reads
        // accurately for whatever the user is actually holding.
        const unit = instrument.cls === 'equity' ? (totalSize === 1 ? 'share' : 'shares')
                   : instrument.cls === 'crypto' ? 'units'
                   : 'contracts';
        const sizeStr = totalSize >= 1000 ? `${(totalSize / 1000).toFixed(1)}k`
                      : totalSize >= 1     ? totalSize.toFixed(totalSize >= 100 ? 0 : 2)
                      :                       totalSize.toFixed(4);
        return (
          <div className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] shrink-0"
               style={{
                 background: isUp ? 'rgba(31,178,107,0.10)' : 'rgba(237,112,136,0.10)',
                 border: `1px solid ${isUp ? 'rgba(31,178,107,0.4)' : 'rgba(237,112,136,0.4)'}`,
                 color: isUp ? COLORS.green : COLORS.red,
               }}
               title={`You own ${totalSize.toFixed(4)} ${unit} of ${instrument.id} · avg entry $${avgEntry.toFixed(2)} · unrealized ${unrealized >= 0 ? '+' : ''}$${unrealized.toFixed(2)}`}>
            <span className="rounded-full"
                  style={{ width: 5, height: 5, background: isUp ? COLORS.green : COLORS.red }} />
            <span className="font-medium tabular-nums">{sizeStr}</span>
            <span style={{ color: isUp ? COLORS.green : COLORS.red, opacity: 0.85 }}>{unit}</span>
          </div>
        );
      })()}
      <MarketOpenIndicator />
      {visibleStats.map(s => (
        // Each added stat is wrapped in a group so a hover X appears
        // beneath it. The X removes the stat from enabledStats — same
        // effect as toggling it off in the + picker, but inline. The
        // wrapper uses Tailwind's `group` so the X is invisible until
        // the user mouses over the stat itself, keeping the header
        // clean when nothing is hovered.
        <div key={s.id} className="relative group">
          <Stat label={s.label}
                value={s.value()}
                tone={s.tone ? s.tone() : undefined} />
          <button
            onClick={() => toggleStat(s.id)}
            className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              background: COLORS.surface,
              color: COLORS.red,
              border: `1px solid ${COLORS.red}66`,
              fontSize: 10,
              lineHeight: 1,
            }}
            title={`Remove ${s.label}`}
          >×</button>
        </div>
      ))}
      <div className="relative">
        <button
          onClick={() => setPickerOpen(o => !o)}
          className="w-5 h-5 rounded flex items-center justify-center text-[12px] transition-colors hover:bg-white/[0.06]"
          style={{ color: COLORS.textMute, border: `1px dashed ${COLORS.border}` }}
          title="Add header stats">+</button>
        {pickerOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
            <div className="absolute right-0 top-full mt-1 rounded-md border z-50 overflow-hidden"
                 style={{ background: COLORS.surface, borderColor: COLORS.borderHi, minWidth: 180,
                          boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
              <div className="px-3 py-2 border-b text-[10px] uppercase tracking-wider"
                   style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
                Header stats
              </div>
              {ALL_STATS.map(s => {
                const on = enabledStats.includes(s.id);
                return (
                  <button key={s.id} onClick={() => toggleStat(s.id)}
                          className="w-full flex items-center justify-between px-3 py-1.5 text-[11.5px] hover:bg-white/[0.04] transition-colors">
                    <span style={{ color: COLORS.text }}>{s.label}</span>
                    <span style={{ color: on ? COLORS.mint : COLORS.textMute }}>{on ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      {!hasOrderEntry && onQuickTrade && (
        <div className="flex items-center gap-1.5 ml-1 pl-3 border-l" style={{ borderColor: COLORS.border }}>
          <button
            onClick={() => onQuickTrade('buy')}
            className="px-3.5 py-1.5 rounded-md text-[11.5px] font-medium transition-all hover:bg-white/[0.04]"
            style={{
              background: COLORS.surface,
              color: COLORS.green,
              border: `1px solid ${COLORS.green}55`,
              boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
            }}>Buy</button>
          <button
            onClick={() => onQuickTrade('sell')}
            className="px-3.5 py-1.5 rounded-md text-[11.5px] font-medium transition-all hover:bg-white/[0.04]"
            style={{
              background: COLORS.surface,
              color: COLORS.red,
              border: `1px solid ${COLORS.red}55`,
              boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
            }}>Sell</button>
        </div>
      )}
    </div>
  );
};

export const InstrumentHeader = ({ instrument, feed, account, onOpenPicker, isWatched, onToggleWatch, onOpenTerminal, onSelect, onEditLayout, hasOrderEntry, onQuickTrade, onOpenAI, onOpenScreener }) => {
  // Prefer the live-computed 24h change (from Coinbase open_24h or EIA
  // settlement delta) over the static placeholder in INSTRUMENTS.
  const change24h = feed.change24h ?? instrument.change24h ?? 0;
  const up = change24h >= 0;
  const DirIcon = up ? ArrowUpRight : ArrowDownRight;
  // Inline ticker quick-search — type a symbol/name and switch instruments
  // without opening the full picker modal. Auto-shows top 6 matches.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);

  const matches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return INSTRUMENTS
      .filter(i => i.id !== instrument.id)
      .filter(i => i.id.toLowerCase().includes(q) || i.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [searchQuery, instrument.id]);

  // Per-tick flash — triggers on every price update, not just on up/down
  const [flashKey, setFlashKey] = useState(0);
  const prevPriceRef = useRef(feed.price);
  useEffect(() => {
    if (feed.price !== prevPriceRef.current) {
      prevPriceRef.current = feed.price;
      setFlashKey(k => k + 1);
    }
  }, [feed.price]);

  // Up = green, down = red — standard market convention. Previously up was
  // mint (the brand blue) which conflicted with red and read incorrectly.
  const tickColor = feed.direction === 'up' ? COLORS.green : COLORS.red;
  const tickBg    = feed.direction === 'up' ? 'rgba(31,178,107,0.10)' : 'rgba(237,112,136,0.08)';

  return (
    <div
      className="flex items-center gap-5 px-5 py-4 border-b shrink-0 overflow-x-auto imo-thin-scrollbar"
      style={{
        borderColor: COLORS.border,
        background: COLORS.bg,
        // The header used to overflow off the right side at narrow widths
        // because it had `gap-8` and no overflow handling — long instrument
        // names plus the optional perp fields (Open interest, Funding,
        // Markets-status) would push the Watch / Analyze / Layout buttons
        // off-screen. Now: tighter gap, horizontal scroll on overflow.
        // The Watch/Analyze/Layout cluster is sticky-right via ml-auto so
        // it stays anchored even mid-scroll.
        scrollbarWidth: 'thin',
      }}
    >
      {/* Unified ticker + search — one button. Click to type a symbol or
          name, results appear in a dropdown. The current symbol/name is
          shown when not searching. Replaces the two-button "ticker | search"
          pattern. */}
      <div className="relative shrink-0" style={{ width: 280 }}>
        <button
          onClick={() => onOpenPicker?.()}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-all hover:bg-white/[0.03]"
          style={{
            borderColor: COLORS.border,
            background: COLORS.surface,
          }}
          title={TICKER_DEBRIEFS[instrument.id] ?? `${instrument.name} · ${instrument.cls} · click to browse`}
        >
          <InstIcon cls={instrument.cls} size={28} ticker={instrument.id} />
          <div className="leading-tight text-left flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[15px] font-semibold tracking-tight" style={{ color: COLORS.text }}>
                {formatTicker(instrument.id, instrument.cls)}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                    style={{ background: COLORS.bg, color: COLORS.textMute, fontWeight: 600 }}>
                {instrument.cls === 'equity' ? 'STK'
                 : instrument.cls === 'crypto' ? 'CRYPTO'
                 : instrument.cls === 'option' ? 'OPT'
                 : instrument.cls === 'fx' ? 'FX'
                 : instrument.cls === 'futures' ? 'FUT'
                 : instrument.cls === 'commodity' ? 'COMM'
                 : 'INDEX'}
              </span>
            </div>
            <div className="text-[11px] truncate mt-0.5" style={{ color: COLORS.textDim }}>
              {instrument.name}
            </div>
          </div>
          <Search size={14} style={{ color: COLORS.textMute, flexShrink: 0 }} />
        </button>

        {/* Search-active state: input replaces the button */}
        {searchOpen && (
          <div className="relative">
            <Search size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: COLORS.textDim }} />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onBlur={() => setTimeout(() => { setSearchOpen(false); setSearchQuery(''); }, 200)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }
                if (e.key === 'Enter' && matches[0]) {
                  onSelect?.(matches[0]);
                  setSearchOpen(false);
                  setSearchQuery('');
                }
              }}
              placeholder="Search ticker or company…"
              className="w-full pl-9 pr-3 py-2 rounded-lg outline-none text-[13px]"
              style={{
                background: COLORS.surface,
                color: COLORS.text,
                border: `1px solid ${COLORS.mint}`,
                height: 50,
              }}
              autoFocus
            />
            {/* Quick-action footer — always shown so the user can reach
                the market screener, AI, or full picker no matter what
                they've typed. These were the original three tools on the
                ticker button before the search merge; surfacing them here
                preserves that workflow. */}
            <div className="absolute left-0 top-full mt-1 w-full rounded-md border z-50 overflow-hidden"
                 style={{ background: COLORS.surface, borderColor: COLORS.borderHi, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
              {matches.length > 0 && matches.map(m => (
                <button key={m.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          onSelect?.(m);
                          setSearchQuery('');
                          setSearchOpen(false);
                        }}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-white/[0.04] border-b"
                        style={{ borderColor: COLORS.border }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <InstIcon cls={m.cls} size={20} ticker={m.id} />
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium" style={{ color: COLORS.text }}>{m.id}</div>
                      <div className="text-[10px] truncate" style={{ color: COLORS.textMute }}>{m.name}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] tabular-nums" style={{ color: COLORS.text }}>${m.mark?.toFixed(m.dec ?? 2)}</div>
                    <div className="text-[10px] tabular-nums" style={{ color: (m.change24h ?? 0) >= 0 ? COLORS.green : COLORS.red }}>
                      {(m.change24h ?? 0) >= 0 ? '+' : ''}{(m.change24h ?? 0).toFixed(2)}%
                    </div>
                  </div>
                </button>
              ))}
              {/* Quick-action rows — always at the bottom of the dropdown */}
              <div className="px-3 py-2 text-[9.5px] uppercase tracking-wider"
                   style={{ color: COLORS.textMute, background: COLORS.bg, letterSpacing: '0.06em' }}>
                Tools
              </div>
              <button onMouseDown={(e) => {
                        e.preventDefault();
                        setSearchOpen(false);
                        setSearchQuery('');
                        onOpenScreener?.();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.04] border-t"
                      style={{ borderColor: COLORS.border }}>
                <Target size={14} style={{ color: COLORS.mint }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium" style={{ color: COLORS.text }}>
                    Market screener
                  </div>
                  <div className="text-[10px]" style={{ color: COLORS.textMute }}>
                    Filter stocks by metrics — sector, P/E, market cap, momentum
                  </div>
                </div>
              </button>
              <button onMouseDown={(e) => {
                        e.preventDefault();
                        const q = searchQuery.trim();
                        setSearchOpen(false);
                        setSearchQuery('');
                        // Pass the user's typed text as a starter prompt to the AI panel
                        if (q) { try { window.__pendingAIQuery = q; } catch {} }
                        onOpenAI?.();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.04] border-t"
                      style={{ borderColor: COLORS.border }}>
                <Sparkles size={14} style={{ color: COLORS.mint }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium" style={{ color: COLORS.text }}>
                    Ask AI {searchQuery.trim() && <span style={{ color: COLORS.textMute }}>about "{searchQuery.trim()}"</span>}
                  </div>
                  <div className="text-[10px]" style={{ color: COLORS.textMute }}>
                    Find stocks by description, theme, or trading idea
                  </div>
                </div>
              </button>
              <button onMouseDown={(e) => {
                        e.preventDefault();
                        setSearchOpen(false);
                        setSearchQuery('');
                        onOpenPicker?.();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.04] border-t"
                      style={{ borderColor: COLORS.border }}>
                <span className="text-[14px]">≡</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium" style={{ color: COLORS.text }}>
                    Advanced picker
                  </div>
                  <div className="text-[10px]" style={{ color: COLORS.textMute }}>
                    Browse all instruments by category, watchlist, recent
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick-access Terminal button — only for equities, jumps to Terminal page filtered to this company */}
      {instrument.cls === 'equity' && onOpenTerminal && (
        <button onClick={() => onOpenTerminal(instrument.id)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] transition-colors hover:bg-white/[0.03]"
                style={{ borderColor: COLORS.border, color: COLORS.mint }}
                title={`View ${instrument.id} on Terminal map (HQ, factories, supply chain)`}>
          
          Terminal
        </button>
      )}

      <div>
        <div className="flex items-center gap-2.5">
          <div
            key={flashKey}
            className={`text-[26px] font-medium tabular-nums leading-none px-2 -mx-2 py-0.5 rounded ${feed.direction === 'up' ? 'onyx-flash-up' : 'onyx-flash-down'}`}
            style={{
              color: tickColor,
              background: tickBg,
            }}
          >
            {fmt(feed.price, instrument.dec)}
          </div>
          {/* Network status dot — single small dot that lights up based
              on the data feed connection. Tooltip explains the source.
              Replaces the verbose LIVE / EIA · DAILY / DEMO badges. */}
          <div
            className="flex items-center"
            title={
              feed.dataSource === 'live'    ? 'Connected · Real-time feed' :
              feed.dataSource === 'delayed' ? 'Connected · Delayed feed (EIA)' :
                                               'Disconnected · Simulated data'
            }
          >
            <span className="relative flex h-1.5 w-1.5">
              {feed.dataSource === 'live' && (
                <span className="live-dot absolute inline-flex h-full w-full rounded-full"
                      style={{ background: COLORS.green }} />
              )}
              <span className="relative inline-flex rounded-full h-1.5 w-1.5"
                    style={{
                      background:
                        feed.dataSource === 'live'    ? COLORS.green :
                        feed.dataSource === 'delayed' ? '#F5B041' :
                                                         COLORS.textMute,
                    }} />
            </span>
          </div>
        </div>
        <div
          className="flex items-center gap-1 mt-1.5 text-[12px] tabular-nums"
          style={{ color: up ? COLORS.green : COLORS.red }}
        >
          <DirIcon size={12} />
          <span>{up ? '+' : ''}{change24h.toFixed(2)}%</span>
          <span style={{ color: COLORS.textMute }}>24h</span>
        </div>
      </div>

      <HeaderStatsToggleable instrument={instrument} feed={feed} account={account} hasOrderEntry={hasOrderEntry} onQuickTrade={onQuickTrade} />

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {onToggleWatch && (
          <button
            onClick={() => onToggleWatch(instrument.id)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] border transition-colors hover:bg-white/[0.03]"
            style={{
              borderColor: isWatched ? COLORS.mint : COLORS.border,
              color: isWatched ? COLORS.mint : COLORS.textDim,
            }}
            title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
          >
            <Star size={11} style={{ fill: isWatched ? COLORS.mint : 'transparent' }} />
            {isWatched ? 'Watching' : 'Watch'}
          </button>
        )}
        <AnalyzeChartButton instrument={instrument} feed={feed} />
        <button
          onClick={() => onEditLayout?.()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] border transition-all hover:bg-white/[0.04]"
          style={{ borderColor: COLORS.border, color: COLORS.textDim, background: COLORS.surface }}
          title="Edit and customize the trade page layout"
        >
          <Layers size={13} style={{ color: COLORS.textMute }} />
          Layout
        </button>
      </div>
    </div>
  );
};

// ─── AnalyzeChartButton — AI analysis of the current chart ────────────────
//
// Pulls live OHLC + indicators, asks the agent to produce a 4-section
// structured analysis: Bias, Key levels, Setup, Strategy fit.
// When the agent gateway is connected, uses tool calling so the agent can
// fetch fresh data itself. When it's not, falls through to direct callAI
// with a snapshot of current bars.
export const AnalyzeChartButton = ({ instrument, feed }) => {
  const [open, setOpen] = useState(false);
  /** @type {[null | { text: string, elapsedMs: number }, Function]} */
  const [analysis, setAnalysis] = useState(/** @type {null | { text: string, elapsedMs: number }} */ (null));
  const [loading, setLoading] = useState(false);
  /** @type {[null | string, Function]} */
  const [error, setError] = useState(/** @type {null | string} */ (null));
  const [usingTools, setUsingTools] = useState(false);
  /** @type {[null | string, Function]} */
  const [provider, setProvider] = useState(/** @type {null | string} */ (null));

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    const symbol = instrument.id.split(':').pop().split('-')[0];
    const recentBars = (feed.history || []).slice(-60).map(h => ({ t: h.t, price: h.price }));
    const sparkSummary = recentBars.length > 1 ? (() => {
      const first = recentBars[0].price;
      const last = recentBars[recentBars.length - 1].price;
      const high = Math.max(...recentBars.map(b => b.price));
      const low = Math.min(...recentBars.map(b => b.price));
      const pct = ((last - first) / first * 100).toFixed(2);
      return { first, last, high, low, pct };
    })() : null;

    const be = (typeof window !== 'undefined') ? window.__imoBackend : null;
    const gatewayLive = be?.urls?.zeroclaw && be?.status?.zeroclaw === 'connected';

    const prompt = gatewayLive
      ? `You are a senior institutional trader analyzing ${instrument.id} (${instrument.name}, ${instrument.cls}) in real time. Current price: ${feed.price?.toFixed(instrument.dec)}. Use the get_ohlc tool to fetch the most recent 1-hour bars for symbol "${symbol}". Then provide a tight 4-section analysis:

**Bias:** bullish / bearish / neutral, with 1 sentence why
**Key levels:** support and resistance, with the price levels
**Setup:** is there a tradeable pattern right now? what kind?
**Strategy fit:** would any momentum, mean-reversion, or breakout strategy fire here?

Be specific. No filler. Use concrete numbers from the bars. Maximum 200 words total.`
      : `You are a senior institutional trader analyzing ${instrument.id} (${instrument.name}, ${instrument.cls}). Current price: ${feed.price?.toFixed(instrument.dec)}.

Recent ${recentBars.length}-period price action:
${sparkSummary ? `Open: ${sparkSummary.first.toFixed(instrument.dec)}, Close: ${sparkSummary.last.toFixed(instrument.dec)}, High: ${sparkSummary.high.toFixed(instrument.dec)}, Low: ${sparkSummary.low.toFixed(instrument.dec)}, Change: ${sparkSummary.pct}%` : 'no recent data available'}

Provide a tight 4-section analysis:

**Bias:** bullish / bearish / neutral, with 1 sentence why
**Key levels:** support and resistance, with the price levels
**Setup:** is there a tradeable pattern right now?
**Strategy fit:** would momentum, mean-reversion, or breakout strategies fire here?

Be specific. Use concrete numbers. Maximum 200 words.`;

    try {
      const startedAt = performance.now();
      let result;
      if (gatewayLive) {
        // Direct gateway call so we get the provider field back
        try {
          const r = await be.post('zeroclaw', '/agent/chat', {
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 600,
            system: 'You are a Bloomberg-grade institutional trading analyst. No filler. Concrete numbers. Markdown formatting.',
            user_id: 'default',
            use_tools: true,
          }, { timeout: 60000 });
          result = r?.content || '';
          setProvider(r?.provider || 'gateway');
          setUsingTools(true);
        } catch (e) {
          // Gateway call failed — fall through to direct callAI
          console.warn('[analyze] gateway failed, using direct:', /** @type {Error} */ (e).message);
        }
      }
      if (!result) {
        result = await callAI(prompt, {
          maxTokens: 600,
          system: 'You are a Bloomberg-grade institutional trading analyst. No filler. Concrete numbers.',
        });
        setProvider('direct');
      }
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (!result) {
        setError('AI returned no response. Check your VITE_ANTHROPIC_API_KEY or VITE_ZEROCLAW_GATEWAY_URL.');
      } else {
        setAnalysis({ text: result, elapsedMs });
      }
    } catch (e) {
      const err = /** @type {Error} */ (e);
      setError(err.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const onClick = () => {
    setOpen(true);
    if (!analysis && !loading) runAnalysis();
  };

  return (
    <>
      <button
        onClick={onClick}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] border transition-all hover:bg-white/[0.04]"
        style={{
          borderColor: COLORS.mint,
          color: COLORS.mint,
          background: 'rgba(61,123,255,0.06)',
        }}
        title="AI analysis of the current chart — bias, levels, setup, strategy fit"
      >
        <Sparkles size={13} />
        Analyze
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.7)' }}
             onClick={() => setOpen(false)}>
          <div className="rounded-lg max-w-[640px] w-full max-h-[85vh] overflow-auto"
               style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
               onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b sticky top-0 z-10 flex items-center justify-between gap-3"
                 style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sparkles size={15} style={{ color: COLORS.mint }} />
                  <span className="text-[10.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                    AI analysis
                  </span>
                  {provider && (
                    <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono"
                          style={{
                            background: COLORS.bg,
                            color: usingTools ? COLORS.mint : COLORS.textDim,
                          }}>
                      {provider}{usingTools ? ' · tools' : ''}
                    </span>
                  )}
                </div>
                <div className="text-[16px] font-medium mt-0.5 truncate" style={{ color: COLORS.text }}>
                  {instrument.id} · {instrument.name}
                </div>
                <div className="text-[11px] mt-0.5 tabular-nums" style={{ color: COLORS.textDim }}>
                  {feed.price?.toFixed(instrument.dec)}
                  {feed.change24h != null && (
                    <span className="ml-2" style={{ color: feed.change24h >= 0 ? COLORS.green : COLORS.red }}>
                      {feed.change24h >= 0 ? '+' : ''}{feed.change24h.toFixed(2)}% 24h
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={runAnalysis}
                        disabled={loading}
                        className="px-3 py-1.5 rounded text-[11.5px] hover:bg-white/[0.04]"
                        style={{ color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                  {loading ? '…' : 'Refresh'}
                </button>
                <button onClick={() => setOpen(false)}
                        className="px-3 py-1.5 rounded text-[11.5px] hover:bg-white/[0.04]"
                        style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                  Close
                </button>
              </div>
            </div>
            <div className="p-5">
              {loading && (
                <div className="text-center py-12">
                  <div className="text-[13px] mb-2" style={{ color: COLORS.text }}>
                    Analyzing chart…
                  </div>
                  <div className="text-[11px]" style={{ color: COLORS.textMute }}>
                    {window.__imoBackend?.status?.zeroclaw === 'connected'
                      ? 'Agent is fetching real-time data via tool calls'
                      : 'Calling AI directly with current snapshot'}
                  </div>
                  <div className="mt-4 mx-auto w-32 h-1 rounded-full overflow-hidden"
                       style={{ background: COLORS.surface2 }}>
                    <div className="h-full rounded-full"
                         style={{
                           background: COLORS.mint,
                           width: '40%',
                           animation: 'imo-loading-bar 1.4s ease-in-out infinite',
                         }} />
                  </div>
                </div>
              )}
              {error && (
                <div className="rounded p-3 text-[12px]"
                     style={{ background: 'rgba(237,112,136,0.1)', color: COLORS.red }}>
                  <div className="font-medium mb-1">Analysis failed</div>
                  <div>{error}</div>
                </div>
              )}
              {analysis && (
                <div>
                  <div className="text-[13px] leading-relaxed whitespace-pre-wrap"
                       style={{ color: COLORS.text }}>
                    {analysis.text.split('\n').map((line, i) => {
                      // Render markdown-bold sections as headers
                      if (line.startsWith('**') && line.includes(':**')) {
                        const [bold, ...rest] = line.split(':**');
                        return (
                          <div key={i} className="mt-3 first:mt-0">
                            <span className="text-[12px] font-semibold uppercase tracking-wider"
                                  style={{ color: COLORS.mint }}>
                              {bold.replace(/\*\*/g, '')}
                            </span>
                            <span className="ml-2">{rest.join(':**')}</span>
                          </div>
                        );
                      }
                      return <div key={i}>{line}</div>;
                    })}
                  </div>
                  <div className="mt-4 pt-3 border-t flex items-center justify-between text-[10.5px]"
                       style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
                    <span>Generated in {analysis.elapsedMs}ms</span>
                    <span>Not financial advice. AI may be wrong.</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};


/**
 * @param {{ label: string, value: any, tone?: string, title?: string }} props
 */
const Stat = ({ label, value, tone, title }) => (
  <div className="leading-tight" title={title}>
    <div className="text-[10px] mb-0.5" style={{ color: COLORS.textMute }}>{label}</div>
    <div
      className="text-[13px] tabular-nums"
      style={{
        color: tone === 'mint' ? COLORS.mint
             : tone === 'red'  ? COLORS.red
             : tone === 'green'? COLORS.green
                                : COLORS.text,
      }}
    >{value}</div>
  </div>
);

/* ──────────── Instrument Picker ──────────── */

export const InstrumentPicker = ({ active, onSelect, onClose, watchlist = [], onToggleWatch }) => {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  // AI search mode — when enabled, the search box accepts natural-language
  // queries like "high-growth small cap tech" or "dividend payers under PE
  // 15". The query is sent to Anthropic with a list of available tickers
  // and their sectors; the AI returns a ranked recommendation list.
  const [aiMode, setAiMode] = useState(false);
  /** @typedef {{ summary: string, picks: Array<{ id: string, rationale?: string }> }} AiResults */
  const [aiResults, setAiResults] = useState(/** @type {null | AiResults} */ (null));
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(/** @type {null | string} */ (null));
  // Screener mode — pre-browse filtering panel. Lets users filter INSTRUMENTS
  // by class, sector, cap range, change %, etc. before scrolling the full
  // list. When the user clicks "View results", the filters are applied and
  // results render in the existing list area.
  const [screenerMode, setScreenerMode] = useState(false);
  /** @typedef {{ classes: string[], sectors: string[], capMin: number, capMax: number, changeMin: number, changeMax: number, priceMin: number, priceMax: number }} ScreenerFilters */
  const [screenerFilters, setScreenerFilters] = useState(/** @type {ScreenerFilters} */ ({
    classes: [],          // array of cls ids (empty = all)
    sectors: [],          // array of sector names (empty = all)
    capMin: 0,            // $B minimum (0 = no min)
    capMax: 5000,         // $B maximum (5000 = no max)
    changeMin: -100,      // 24h change % minimum
    changeMax: 100,       // 24h change % maximum
    priceMin: 0,
    priceMax: 100000,
  }));
  const resetScreenerFilters = () => setScreenerFilters({
    classes: [], sectors: [], capMin: 0, capMax: 5000,
    changeMin: -100, changeMax: 100, priceMin: 0, priceMax: 100000,
  });
  // FIGI enrichment — when the user types a ticker that isn't in our local
  // INSTRUMENTS list, query OpenFIGI to confirm it's a real security and
  // surface its name/exchange/asset class. Result shown as an extra row.
  const [figiHint, setFigiHint] = useState(/** @type {null | { figi: string, name: string, exchCode: string, securityType: string, ticker?: string, marketSector?: string }} */ (null));
  const watchlistSet = useMemo(() => new Set(watchlist), [watchlist]);
  // Build a map of ticker → market cap (in $B) by collapsing SECTOR_CONSTITUENTS
  const capByTicker = useMemo(() => {
    const m = {};
    Object.values(SECTOR_CONSTITUENTS ?? {}).forEach(arr => {
      (arr || []).forEach(c => { m[c.ticker] = c.cap; });
    });
    return m;
  }, []);
  const filtered = INSTRUMENTS
    .filter(i => {
      if (tab === 'all') return true;
      if (tab === 'watchlist') return watchlistSet.has(i.id);
      return i.cls === tab;
    })
    .filter(i => !q || i.id.toLowerCase().includes(q.toLowerCase()) || i.name.toLowerCase().includes(q.toLowerCase()))
    // Apply screener filters when in screener mode (or always if filters set)
    .filter(i => {
      const hasActiveFilters = screenerFilters.classes.length > 0
        || screenerFilters.sectors.length > 0
        || screenerFilters.capMin > 0
        || screenerFilters.capMax < 5000
        || screenerFilters.changeMin > -100
        || screenerFilters.changeMax < 100
        || screenerFilters.priceMin > 0
        || screenerFilters.priceMax < 100000;
      if (!hasActiveFilters) return true;
      // Class filter
      if (screenerFilters.classes.length > 0 && !screenerFilters.classes.includes(i.cls)) return false;
      // Sector filter (equity only)
      if (screenerFilters.sectors.length > 0) {
        const sec = TICKER_SECTORS?.[i.id];
        if (!sec || !screenerFilters.sectors.includes(sec)) return false;
      }
      // Cap filter (only applies to equities; non-equity passes through)
      if (i.cls === 'equity') {
        const cap = capByTicker[i.id] ?? 0;
        if (cap < screenerFilters.capMin) return false;
        if (cap > screenerFilters.capMax) return false;
      }
      // Change %
      const ch = i.change24h ?? 0;
      if (ch < screenerFilters.changeMin) return false;
      if (ch > screenerFilters.changeMax) return false;
      // Price range
      const price = i.mark ?? 0;
      if (price < screenerFilters.priceMin) return false;
      if (price > screenerFilters.priceMax) return false;
      return true;
    });

  // Run AI search — submit the natural-language query along with a compact
  // list of available equity tickers (id + sector) so the AI can pick from
  // them. We restrict to equities since that's where fundamentals queries
  // make sense; "high-growth small cap tech" doesn't apply to BTC-PERP.
  const runAiSearch = async () => {
    if (!q.trim()) return;
    setAiLoading(true);
    setAiError(null);
    setAiResults(null);
    try {
      // Build a compact context of available equity tickers + their sectors
      const universe = INSTRUMENTS
        .filter(i => i.cls === 'equity')
        .slice(0, 200)
        .map(i => {
          const sector = TICKER_SECTORS?.[i.id] ?? 'Other';
          return `${i.id}|${i.name}|${sector}`;
        })
        .join('\n');
      // Optional Exa grounding: if EXA_API_KEY is set, search the web for
      // recent news/analysis matching the query, then include snippets in
      // the AI prompt so picks reflect current events (not just training data).
      let webContext = '';
      if (EXA_API_KEY) {
        const webResults = await exaSearch(`${q.trim()} stocks analysis`, {
          numResults: 4,
          type: 'fast',
          maxAgeHours: 168, // 1 week
          highlights: true,
        });
        if (webResults?.results?.length) {
          webContext = '\n\nRECENT WEB CONTEXT (for grounding):\n' + webResults.results
            .map((r, i) => `[${i + 1}] ${r.title}\n${r.text || ''}`)
            .join('\n\n');
        }
      }
      const system = 'You are a financial research assistant. The user is searching for stocks matching a natural-language query. From the AVAILABLE TICKERS list, pick the 5-8 best matches and return ONLY a JSON object with this exact shape (no prose, no markdown fences): {"summary":"one-sentence summary of what you matched","picks":[{"id":"AAPL","rationale":"one short sentence why it matches"}]}. If RECENT WEB CONTEXT is provided, factor it into your selections.';
      const prompt = `AVAILABLE TICKERS (id|name|sector):\n${universe}${webContext}\n\nUSER QUERY: ${q.trim()}\n\nReturn JSON only.`;
      const response = await callAI(prompt, { maxTokens: 700 });
      let parsed = null;
      if (response) {
        try {
          const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          parsed = JSON.parse(cleaned);
        } catch {
          const m = response.match(/\{[\s\S]*\}/);
          if (m) {
            try { parsed = JSON.parse(m[0]); } catch {}
          }
        }
      }
      // Local fallback when AI unavailable or returns garbage — keyword
      // match the query against ticker name + sector. Always returns
      // something so the button never appears broken.
      if (!parsed || !Array.isArray(parsed.picks)) {
        const qLower = q.trim().toLowerCase();
        const tokens = qLower.split(/\s+/).filter(t => t.length > 1);
        const scored = INSTRUMENTS
          .filter(i => i.cls === 'equity')
          .map(i => {
            const sector = (TICKER_SECTORS?.[i.id] ?? '').toLowerCase();
            const name = i.name.toLowerCase();
            const id = i.id.toLowerCase();
            let score = 0;
            tokens.forEach(t => {
              if (id.includes(t)) score += 5;
              if (name.includes(t)) score += 3;
              if (sector.includes(t)) score += 2;
            });
            return { i, score };
          })
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);
        parsed = {
          summary: scored.length === 0
            ? 'No matches found in the local catalog. Try different keywords or set VITE_ANTHROPIC_API_KEY for AI-powered search.'
            : `Local keyword match for "${q.trim()}" — configure AI key for richer recommendations.`,
          picks: scored.map(({ i }) => ({
            id: i.id,
            rationale: `${i.name} · ${TICKER_SECTORS?.[i.id] ?? 'Equity'}`,
          })),
          _offline: true,
        };
      }
      // Filter to picks that actually exist in INSTRUMENTS
      const validPicks = parsed.picks.filter(p => INSTRUMENTS.some(i => i.id === p.id));
      setAiResults({
        summary: parsed.summary ?? '',
        picks: validPicks,
      });
      setAiLoading(false);
    } catch (e) {
      setAiError(`AI search failed: ${/** @type {Error} */ (e).message}`);
      setAiLoading(false);
    }
  };

  // Debounced FIGI lookup when local results are empty and user typed
  // something ticker-shaped (1–6 uppercase letters).
  useEffect(() => {
    setFigiHint(null);
    const upper = q.trim().toUpperCase();
    if (!upper || filtered.length > 0 || !/^[A-Z]{1,6}$/.test(upper)) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const data = await fetchOpenFigi(upper);
      if (!cancelled && data) setFigiHint({ ticker: upper, ...data });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, filtered.length]);

  // Drag-to-move state — let the user reposition the picker on the page
  // by grabbing the title bar. Anchors it via fixed positioning once
  // the user drags, otherwise stays in its default top-left location.
  const [dragOffset, setDragOffset] = useState(/** @type {null | { x: number, y: number }} */ (null));
  /** @typedef {{ startX: number, startY: number, initial: { x: number, y: number } }} DragState */
  const dragStateRef = useRef(/** @type {DragState | null} */ (null));
  const onDragStart = (e) => {
    // Only start drag from the explicit drag handle (the bar at top of
    // header). Don't trigger on input clicks, button clicks, etc.
    if (e.target.closest('input, button, select, textarea')) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const initial = dragOffset ?? { x: 0, y: 0 };
    dragStateRef.current = { startX, startY, initial };
    const onMove = (ev) => {
      if (!dragStateRef.current) return;
      const { startX, startY, initial } = dragStateRef.current;
      setDragOffset({
        x: initial.x + (ev.clientX - startX),
        y: initial.y + (ev.clientY - startY),
      });
    };
    const onUp = () => {
      dragStateRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div
        className="absolute left-6 top-[13.5rem] z-50 w-[480px] rounded-md border overflow-hidden"
        style={{
          background: COLORS.surface,
          borderColor: COLORS.borderHi,
          // Apply drag offset if user has moved the picker
          transform: dragOffset ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined,
          boxShadow: dragOffset
            ? '0 24px 48px rgba(0,0,0,0.55)'
            : '0 8px 24px rgba(0,0,0,0.35)',
          transition: dragStateRef.current ? 'none' : 'box-shadow 200ms ease',
        }}
      >
        {/* Drag handle — a thin bar at the very top of the picker. Cursor
            becomes "grab" when hovering. The user can drag the entire
            picker around the page by holding here. Per UX request:
            "page draggable on ticker search press". */}
        <div
          onMouseDown={onDragStart}
          className="flex items-center justify-center select-none"
          style={{
            height: 8,
            cursor: dragStateRef.current ? 'grabbing' : 'grab',
            background: 'rgba(255,255,255,0.02)',
            borderBottom: `1px solid ${COLORS.border}`,
          }}
          title="Drag to reposition"
        >
          <span style={{ width: 28, height: 2, background: COLORS.borderHi, borderRadius: 999 }} />
        </div>
        <div className="p-3 border-b" style={{ borderColor: COLORS.border }}>
          {/* Mode toggle: Browse | Screener (filter UI) | Ask AI (natural language) */}
          <div className="flex items-center gap-1 mb-2.5 p-0.5 rounded-md w-fit"
               style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
            <button onClick={() => { setAiMode(false); setScreenerMode(false); setAiResults(null); setAiError(null); }}
                    className="px-2.5 py-1 rounded text-[11px] transition-colors"
                    style={{
                      background: !aiMode && !screenerMode ? COLORS.surface2 : 'transparent',
                      color: !aiMode && !screenerMode ? COLORS.text : COLORS.textDim,
                    }}>
              Browse
            </button>
            <button onClick={() => { setScreenerMode(true); setAiMode(false); }}
                    className="px-2.5 py-1 rounded text-[11px] transition-colors flex items-center gap-1"
                    style={{
                      background: screenerMode ? COLORS.surface2 : 'transparent',
                      color: screenerMode ? COLORS.mint : COLORS.textDim,
                    }}>
              <Filter size={11} />
              Screener
            </button>
            <button onClick={() => { setAiMode(true); setScreenerMode(false); }}
                    className="px-2.5 py-1 rounded text-[11px] transition-colors flex items-center gap-1"
                    style={{
                      background: aiMode ? COLORS.surface2 : 'transparent',
                      color: aiMode ? COLORS.mint : COLORS.textDim,
                    }}>
              <Sparkles size={11} />
              Ask AI
            </button>
          </div>
          <div className="relative flex items-center gap-1.5">
            <div className="relative flex-1 min-w-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: COLORS.textMute }} />
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => {
                  if (aiMode && e.key === 'Enter') runAiSearch();
                }}
                placeholder={aiMode
                  ? 'e.g. "small cap tech with strong revenue growth"'
                  : 'Search markets — type or tap mic'}
                className="w-full pl-9 pr-20 py-2 rounded-md text-[13px] outline-none"
                style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${aiMode ? COLORS.mint : COLORS.border}` }}
              />
              {aiMode && (
                <button onClick={runAiSearch}
                        disabled={aiLoading || !q.trim()}
                        className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded text-[11px] font-medium transition-opacity"
                        style={{
                          background: COLORS.mint,
                        color: '#FFF',
                        opacity: aiLoading || !q.trim() ? 0.5 : 1,
                      }}>
                {aiLoading ? '…' : 'Search'}
              </button>
            )}
            </div>
            <MicButton onTranscript={(t) => setQ(prev => prev ? `${prev} ${t}` : t)}
                       title="Speak a ticker or company name" />
          </div>
          {/* Screener filters panel — shown only in screener mode. Lets users
              narrow INSTRUMENTS by class, sector, cap range, change %, and
              price range BEFORE seeing the results. */}
          {screenerMode && (
            <div className="mt-3 p-3 rounded-md border" style={{ background: COLORS.bg, borderColor: COLORS.border }}>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color: COLORS.mint }}>
                  <Filter size={10} />
                  Screener filters
                </div>
                <button onClick={resetScreenerFilters}
                        className="text-[10px] px-2 py-0.5 rounded hover:bg-white/[0.04]"
                        style={{ color: COLORS.textDim }}>
                  Reset all
                </button>
              </div>
              {/* Asset class chips */}
              <div className="mb-2.5">
                <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Asset class</div>
                <div className="flex flex-wrap gap-1">
                  {['equity', 'crypto', 'stablecoin', 'energy', 'metal'].map(c => {
                    const isOn = screenerFilters.classes.includes(c);
                    return (
                      <button key={c}
                              onClick={() => setScreenerFilters(s => ({
                                ...s,
                                classes: isOn ? s.classes.filter(x => x !== c) : [...s.classes, c],
                              }))}
                              className="px-2 py-0.5 rounded text-[10px] transition-colors"
                              style={{
                                background: isOn ? COLORS.mint : COLORS.surface2,
                                color: isOn ? '#FFF' : COLORS.textDim,
                                border: `1px solid ${isOn ? COLORS.mint : COLORS.border}`,
                              }}>
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Sector chips (equity sectors) */}
              <div className="mb-2.5">
                <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Sector</div>
                <div className="flex flex-wrap gap-1">
                  {['Technology', 'Communications', 'Financials', 'Healthcare', 'Consumer', 'Energy', 'Industrials', 'Utilities', 'Materials', 'Real Estate'].map(s => {
                    const isOn = screenerFilters.sectors.includes(s);
                    return (
                      <button key={s}
                              onClick={() => setScreenerFilters(f => ({
                                ...f,
                                sectors: isOn ? f.sectors.filter(x => x !== s) : [...f.sectors, s],
                              }))}
                              className="px-2 py-0.5 rounded text-[10px] transition-colors"
                              style={{
                                background: isOn ? COLORS.mint : COLORS.surface2,
                                color: isOn ? '#FFF' : COLORS.textDim,
                                border: `1px solid ${isOn ? COLORS.mint : COLORS.border}`,
                              }}>
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Numeric range inputs — cap, change, price */}
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: COLORS.textMute }}>Mkt cap (B$)</div>
                  <div className="flex items-center gap-1 text-[10.5px]" style={{ color: COLORS.text }}>
                    <input type="number" value={screenerFilters.capMin} min={0}
                           onChange={e => setScreenerFilters(f => ({ ...f, capMin: Number(e.target.value) || 0 }))}
                           className="w-full px-1.5 py-0.5 rounded outline-none tabular-nums"
                           style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, color: COLORS.text }} />
                    <span style={{ color: COLORS.textMute }}>–</span>
                    <input type="number" value={screenerFilters.capMax} min={0}
                           onChange={e => setScreenerFilters(f => ({ ...f, capMax: Number(e.target.value) || 5000 }))}
                           className="w-full px-1.5 py-0.5 rounded outline-none tabular-nums"
                           style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, color: COLORS.text }} />
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: COLORS.textMute }}>24h Δ %</div>
                  <div className="flex items-center gap-1 text-[10.5px]" style={{ color: COLORS.text }}>
                    <input type="number" value={screenerFilters.changeMin}
                           onChange={e => setScreenerFilters(f => ({ ...f, changeMin: Number(e.target.value) || -100 }))}
                           className="w-full px-1.5 py-0.5 rounded outline-none tabular-nums"
                           style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, color: COLORS.text }} />
                    <span style={{ color: COLORS.textMute }}>–</span>
                    <input type="number" value={screenerFilters.changeMax}
                           onChange={e => setScreenerFilters(f => ({ ...f, changeMax: Number(e.target.value) || 100 }))}
                           className="w-full px-1.5 py-0.5 rounded outline-none tabular-nums"
                           style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, color: COLORS.text }} />
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: COLORS.textMute }}>Price ($)</div>
                  <div className="flex items-center gap-1 text-[10.5px]" style={{ color: COLORS.text }}>
                    <input type="number" value={screenerFilters.priceMin} min={0}
                           onChange={e => setScreenerFilters(f => ({ ...f, priceMin: Number(e.target.value) || 0 }))}
                           className="w-full px-1.5 py-0.5 rounded outline-none tabular-nums"
                           style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, color: COLORS.text }} />
                    <span style={{ color: COLORS.textMute }}>–</span>
                    <input type="number" value={screenerFilters.priceMax} min={0}
                           onChange={e => setScreenerFilters(f => ({ ...f, priceMax: Number(e.target.value) || 100000 }))}
                           className="w-full px-1.5 py-0.5 rounded outline-none tabular-nums"
                           style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, color: COLORS.text }} />
                  </div>
                </div>
              </div>
              <div className="text-[10px] flex justify-between items-center" style={{ color: COLORS.textMute }}>
                <span>{filtered.length} {filtered.length === 1 ? 'match' : 'matches'}</span>
                <span>Filters apply live</span>
              </div>
            </div>
          )}
          {!aiMode && !screenerMode && (
          <div className="flex items-center gap-1 mt-3">
            {[['all','All'], ['watchlist','Watchlist'], ['crypto','Crypto'], ['stablecoin','Stable'], ['equity','Equities'], ['energy','Energy'], ['metal','Metals']].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className="px-3 py-1 rounded-md text-[12px] transition-colors"
                style={{
                  color: tab === k ? COLORS.text : COLORS.textDim,
                  background: tab === k ? COLORS.surface2 : 'transparent',
                }}
              >
                {l}
                {k === 'watchlist' && watchlist.length > 0 && (
                  <span className="ml-1.5 text-[10px]" style={{ color: COLORS.mintDim }}>{watchlist.length}</span>
                )}
              </button>
            ))}
          </div>
          )}
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {/* AI mode results — shown when the user submitted an AI query.
              Each pick is clickable; clicking selects that ticker. */}
          {aiMode && (aiResults || aiError || aiLoading) && (
            <div className="px-4 py-3 border-b" style={{ borderColor: COLORS.border, background: 'rgba(61,123,255,0.04)' }}>
              <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider mb-2" style={{ color: COLORS.mint }}>
                <Sparkles size={10} />
                AI search · {aiLoading ? 'thinking…' : 'matches'}
              </div>
              {aiError && (
                <div className="text-[11px]" style={{ color: COLORS.red }}>{aiError}</div>
              )}
              {aiResults && (
                <>
                  {aiResults.summary && (
                    <div className="text-[11px] mb-2.5" style={{ color: COLORS.textDim }}>{aiResults.summary}</div>
                  )}
                  <div className="space-y-1.5">
                    {aiResults.picks.map(p => {
                      const inst = INSTRUMENTS.find(i => i.id === p.id);
                      if (!inst) return null;
                      return (
                        <button key={p.id}
                                onClick={() => { onSelect(inst); onClose(); }}
                                className="w-full flex items-start gap-2 p-2 rounded-md text-left hover:bg-white/[0.04] transition-colors"
                                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
                          <InstIcon cls={inst.cls} size={20} ticker={inst.id} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="text-[12.5px] font-medium" style={{ color: COLORS.text }}>{formatTicker(inst.id, inst.cls)}</div>
                              <div className="text-[10.5px] truncate" style={{ color: COLORS.textMute }}>{inst.name}</div>
                            </div>
                            <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textDim }}>{p.rationale}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
          {tab === 'watchlist' && filtered.length === 0 && (
            <div className="py-10 px-6 text-center">
              <Star size={24} className="mx-auto mb-2" style={{ color: COLORS.textMute }} />
              <div className="text-[13px] mb-1" style={{ color: COLORS.text }}>No saved markets</div>
              <div className="text-[11px]" style={{ color: COLORS.textMute }}>
                Tap the ☆ next to any market to add it here.
              </div>
            </div>
          )}
          {/* OpenFIGI suggestion row — appears when the user types a ticker
              not in our local list. Confirms the ticker is a real security
              and shows its asset class / exchange. */}
          {figiHint && filtered.length === 0 && tab !== 'watchlist' && (
            <div className="px-4 py-3 border-b" style={{ borderColor: COLORS.border, background: 'rgba(61,123,255,0.04)' }}>
              <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: COLORS.mint }}>
                OpenFIGI · external match
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium" style={{ color: COLORS.text }}>
                    {figiHint.ticker} · {figiHint.name ?? figiHint.securityType ?? 'Unknown'}
                  </div>
                  <div className="text-[10.5px] truncate" style={{ color: COLORS.textMute }}>
                    {figiHint.marketSector ?? ''}{figiHint.exchCode ? ` · ${figiHint.exchCode}` : ''}{figiHint.figi ? ` · ${figiHint.figi}` : ''}
                  </div>
                </div>
                <span className="text-[9.5px] px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: COLORS.surface2, color: COLORS.textDim }}>
                  not tradable here
                </span>
              </div>
            </div>
          )}
          {filtered.length > 0 && (
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 px-4 py-2 text-[10px] uppercase tracking-wider"
                 style={{ color: COLORS.textMute }}>
              <span></span>
              <span>Market</span>
              <span className="text-right">Mark</span>
              <span className="text-right">24h</span>
              <span className="text-right">Volume</span>
            </div>
          )}
          {filtered.map(inst => {
            const up = inst.change24h >= 0;
            const isActive = active.id === inst.id;
            const isWatched = watchlistSet.has(inst.id);
            return (
              <div
                key={inst.id}
                className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 px-4 py-2.5 items-center hover:bg-white/[0.02] transition-colors"
                style={{ background: isActive ? 'rgba(61,123,255,0.06)' : 'transparent' }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleWatch?.(inst.id); }}
                  className="hover:scale-110 transition-transform"
                  title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                >
                  <Star size={14}
                        style={{
                          color: isWatched ? COLORS.mint : COLORS.textMute,
                          fill: isWatched ? COLORS.mint : 'transparent',
                        }} />
                </button>
                <button
                  onClick={() => { onSelect(inst); onClose(); }}
                  className="flex items-center gap-2.5 text-left min-w-0"
                >
                  <SectorLetter cls={inst.cls} size={16} />
                  <InstIcon cls={inst.cls} size={16} ticker={inst.id} />
                  <div className="leading-tight min-w-0">
                    <div className="text-[13px] truncate" style={{ color: COLORS.text }}>{formatTicker(inst.id, inst.cls)}</div>
                    <div className="text-[10px] truncate" style={{ color: COLORS.textMute }}>{inst.name}</div>
                  </div>
                </button>
                <div className="text-[12px] tabular-nums text-right" style={{ color: COLORS.text }}>
                  {fmt(inst.mark, inst.dec)}
                </div>
                <div className="text-[12px] tabular-nums text-right" style={{ color: up ? COLORS.green : COLORS.red }}>
                  {up ? '+' : ''}{inst.change24h.toFixed(2)}%
                </div>
                <div className="text-[12px] tabular-nums text-right" style={{ color: COLORS.textDim }}>
                  {fmtCompact(inst.vol24h)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};
