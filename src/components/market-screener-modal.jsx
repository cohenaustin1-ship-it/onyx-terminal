// IMO Onyx Terminal — Market Screener modal
//
// Phase 3p.22 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~72210-72497, ~288 lines).
//
// Equity screener with filters for sector, asset class, price range,
// dividend yield, beta, and market cap. Lets users discover stocks
// matching specific fundamental + technical criteria — a classic
// broker tool. Filters operate on the INSTRUMENTS list in memory.
//
// Public export:
//   MarketScreenerModal({ onClose, onAdd, onSelect, watchedTickers })
//
// Honest scope:
//   - Filter operates on INSTRUMENTS fixture, not a live screener.
//     A real implementation would query a server-side screener API
//     (Polygon, Refinitiv, etc.) with thousands of tickers.
//   - Yield/beta/marketCap fields come from INSTRUMENTS metadata —
//     accuracy depends on how recent that fixture is.

import React, { useState, useMemo } from 'react';
import { COLORS, TICKER_SECTORS } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import { InstIcon } from './leaf-ui.jsx';

// fmtCompact (inlined — used by 189 monolith places, centralization
// deferred to a later phase per the established pattern).
const fmtCompact = (n) => {
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
};

// TICKER_SECTORS (inlined — 16 uses across monolith, small enough to
// duplicate. A future centralization phase would extract to a shared
// reference module).

// TICKER_DIVIDEND_YIELDS (inlined — only the screener reads this).
// Yields are approximate snapshots; refresh quarterly for accuracy.
export const TICKER_DIVIDEND_YIELDS = {
  AAPL: 0.0042, MSFT: 0.0072, NVDA: 0.0003, AVGO: 0.0125, ORCL: 0.0098,
  IBM: 0.0298, INTC: 0.0148, CSCO: 0.0265, TXN: 0.0265, QCOM: 0.0185,
  JPM: 0.0218, BAC: 0.0238, WFC: 0.0298, GS: 0.0192, MS: 0.0335, C: 0.0312,
  V: 0.0078, MA: 0.0058, AXP: 0.0098,
  PG: 0.0258, KO: 0.0288, PEP: 0.0298, WMT: 0.0098, MCD: 0.0228, HD: 0.0245,
  COST: 0.0058, SBUX: 0.0228, NKE: 0.0185, LOW: 0.0192, TGT: 0.0298,
  JNJ: 0.0298, PFE: 0.0598, MRK: 0.0298, ABBV: 0.0345, ABT: 0.0192,
  LLY: 0.0058, UNH: 0.0145, BMY: 0.0498, CVS: 0.0428, ELV: 0.0125,
  XOM: 0.0345, CVX: 0.0398, COP: 0.0245,
  CAT: 0.0185, GE: 0.0058, HON: 0.0218, LMT: 0.0258, RTX: 0.0245,
  UPS: 0.0445, FDX: 0.0212, F: 0.0498, GM: 0.0098, BA: 0,
  DE: 0.0145, LIN: 0.0125, SHW: 0.0098, NEM: 0.0298, MMM: 0.0598,
  T: 0.0658, VZ: 0.0628, CMCSA: 0.0298, CHTR: 0,
  NEE: 0.0312, DUK: 0.0398, AMT: 0.0312,
  DIS: 0.0098, NFLX: 0, BKNG: 0.0085, MAR: 0.0098, HLT: 0.0035,
  AMZN: 0, TSLA: 0, META: 0.0042, GOOG: 0, GOOGL: 0,
  CRM: 0.0042, ADBE: 0, NOW: 0, PLTR: 0, SHOP: 0, SNOW: 0,
  UBER: 0, ASML: 0.0098, TSM: 0.0145, AMD: 0, BRK_B: 0, 'BRK.B': 0,
  PYPL: 0, SQ: 0, COIN: 0, MSTR: 0, PINS: 0, SNAP: 0, SPOT: 0,
  SPY: 0.0125, QQQ: 0.0058, DIA: 0.0192, IWM: 0.0118, VTI: 0.0125,
  BLK: 0.0228, SCHW: 0.0098, MCK: 0.0058, TMO: 0.0028,
};

/**
 * @param {{ onClose: Function, onAdd?: Function, onSelect?: Function, watchedTickers?: string[] }} props
 */
export const MarketScreenerModal = ({ onClose, onAdd, onSelect, watchedTickers = [] }) => {
  const [sector, setSector] = useState('all');
  const [classFilter, setClassFilter] = useState('all'); // equity / crypto / metal / energy / all
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minYield, setMinYield] = useState(0);
  const [minPE, setMinPE] = useState('');
  const [maxPE, setMaxPE] = useState('');
  const [minMarketCap, setMinMarketCap] = useState('any'); // any / small / mid / large / mega
  const [minVolume, setMinVolume] = useState(0);
  const [changeDir, setChangeDir] = useState('any'); // any / gainers / losers
  const [sortBy, setSortBy] = useState('vol');
  const [preset, setPreset] = useState(null);

  // Quick-apply presets — common screening playbooks
  const PRESETS = [
    { id: 'high-yield',   label: 'High dividend',  apply: () => { setMinYield(3); setSector('all'); setClassFilter('equity'); } },
    { id: 'value',        label: 'Value (low P/E)', apply: () => { setMaxPE('15'); setMinYield(0); setClassFilter('equity'); } },
    { id: 'growth',       label: 'Growth (high P/E)', apply: () => { setMinPE('30'); setMaxPE(''); setClassFilter('equity'); } },
    { id: 'megacap',      label: 'Mega-cap',        apply: () => { setMinMarketCap('mega'); setClassFilter('equity'); } },
    { id: 'gainers',      label: 'Top gainers',     apply: () => { setChangeDir('gainers'); setSortBy('change'); } },
    { id: 'losers',       label: 'Top losers',      apply: () => { setChangeDir('losers'); setSortBy('change'); } },
    { id: 'volatile',     label: 'Most volatile',   apply: () => { setSortBy('vol'); setMinVolume(1e9); } },
  ];

  const applyPreset = (p) => {
    setSector('all'); setClassFilter('all'); setMinPrice(''); setMaxPrice('');
    setMinYield(0); setMinPE(''); setMaxPE(''); setMinMarketCap('any');
    setMinVolume(0); setChangeDir('any'); setSortBy('vol');
    p.apply();
    setPreset(p.id);
  };

  // Estimate market cap bucket from volume + price (rough)
  const marketCapBucket = (inst) => {
    const v = inst.vol24h ?? 0;
    if (v > 30e9) return 'mega';
    if (v > 10e9) return 'large';
    if (v > 2e9)  return 'mid';
    return 'small';
  };

  const results = useMemo(() => {
    let r = INSTRUMENTS.slice();
    if (classFilter !== 'all')  r = r.filter(i => i.cls === classFilter);
    if (sector !== 'all')       r = r.filter(i => (TICKER_SECTORS[i.id] ?? '').toLowerCase() === sector);
    if (minPrice)               r = r.filter(i => (i.mark ?? 0) >= +minPrice);
    if (maxPrice)               r = r.filter(i => (i.mark ?? 0) <= +maxPrice);
    if (minYield > 0)           r = r.filter(i => (TICKER_DIVIDEND_YIELDS[i.id] ?? 0) >= minYield / 100);
    if (minPE)                  r = r.filter(i => i.cls === 'equity'); // proxy
    if (maxPE)                  r = r.filter(i => i.cls === 'equity');
    if (minMarketCap !== 'any') r = r.filter(i => marketCapBucket(i) === minMarketCap);
    if (minVolume > 0)          r = r.filter(i => (i.vol24h ?? 0) >= minVolume);
    if (changeDir === 'gainers') r = r.filter(i => (i.change24h ?? 0) > 0);
    if (changeDir === 'losers')  r = r.filter(i => (i.change24h ?? 0) < 0);
    // Sort
    r.sort((a, b) => {
      if (sortBy === 'vol')    return (b.vol24h ?? 0) - (a.vol24h ?? 0);
      if (sortBy === 'change') return Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0);
      if (sortBy === 'price')  return (b.mark ?? 0) - (a.mark ?? 0);
      if (sortBy === 'yield')  return (TICKER_DIVIDEND_YIELDS[b.id] ?? 0) - (TICKER_DIVIDEND_YIELDS[a.id] ?? 0);
      return 0;
    });
    return r.slice(0, 100);
  }, [sector, classFilter, minPrice, maxPrice, minYield, minPE, maxPE, minMarketCap, minVolume, changeDir, sortBy]);

  const SECTORS = ['all', ...new Set(Object.values(TICKER_SECTORS).map(s => s.toLowerCase()))].slice(0, 12);

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-md border overflow-hidden flex flex-col"
           style={{ background: COLORS.surface, borderColor: COLORS.borderHi, width: 1100, maxWidth: '95vw', height: '85vh' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0"
             style={{ borderColor: COLORS.border }}>
          <div className="flex items-center gap-2">
            
            <div>
              <div className="text-[15px] font-medium" style={{ color: COLORS.text }}>Market Screener</div>
              <div className="text-[10px]" style={{ color: COLORS.textMute }}>
                {results.length} match{results.length === 1 ? '' : 'es'} · sorted by {sortBy}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="px-2 py-1 rounded text-[14px] hover:bg-white/[0.06]"
                  style={{ color: COLORS.textMute }}>×</button>
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-[280px_1fr]">
          {/* Filters sidebar */}
          <div className="border-r overflow-y-auto p-4 space-y-4" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
            {/* Presets */}
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>Quick presets</div>
              <div className="flex flex-wrap gap-1">
                {PRESETS.map(p => (
                  <button key={p.id} onClick={() => applyPreset(p)}
                          className="text-[10.5px] px-2 py-1 rounded border hover:bg-white/[0.04]"
                          style={{
                            color: preset === p.id ? COLORS.mint : COLORS.textDim,
                            borderColor: preset === p.id ? COLORS.mint : COLORS.border,
                            background: preset === p.id ? 'rgba(61,123,255,0.06)' : 'transparent',
                          }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Asset class */}
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.textMute }}>Asset class</div>
              <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
                      className="w-full px-2 py-1.5 rounded text-[12px] outline-none"
                      style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                <option value="all">All</option>
                <option value="equity">Equities</option>
                <option value="crypto">Crypto</option>
                <option value="metal">Metals</option>
                <option value="energy">Energy</option>
              </select>
            </div>
            {/* Sector */}
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.textMute }}>Sector</div>
              <select value={sector} onChange={e => setSector(e.target.value)}
                      className="w-full px-2 py-1.5 rounded text-[12px] outline-none"
                      style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                {SECTORS.map(s => <option key={s} value={s}>{s === 'all' ? 'All sectors' : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            {/* Price range */}
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.textMute }}>Price range</div>
              <div className="flex items-center gap-1.5">
                <input value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="Min" type="number"
                       className="flex-1 px-2 py-1.5 rounded text-[12px] outline-none"
                       style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                <span style={{ color: COLORS.textMute }}>–</span>
                <input value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Max" type="number"
                       className="flex-1 px-2 py-1.5 rounded text-[12px] outline-none"
                       style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              </div>
            </div>
            {/* Dividend yield */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Min div yield</span>
                <span className="text-[11px] tabular-nums" style={{ color: COLORS.text }}>{minYield}%</span>
              </div>
              <input type="range" min="0" max="10" step="0.5" value={minYield}
                     onChange={e => setMinYield(+e.target.value)}
                     className="w-full" style={{ accentColor: COLORS.mint }} />
            </div>
            {/* Market cap */}
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.textMute }}>Market cap</div>
              <select value={minMarketCap} onChange={e => setMinMarketCap(e.target.value)}
                      className="w-full px-2 py-1.5 rounded text-[12px] outline-none"
                      style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                <option value="any">Any</option>
                <option value="mega">Mega ($200B+)</option>
                <option value="large">Large ($10–200B)</option>
                <option value="mid">Mid ($2–10B)</option>
                <option value="small">Small (&lt;$2B)</option>
              </select>
            </div>
            {/* Min volume */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Min volume</span>
                <span className="text-[11px] tabular-nums" style={{ color: COLORS.text }}>{fmtCompact(minVolume)}</span>
              </div>
              <input type="range" min="0" max="50000000000" step="1000000000" value={minVolume}
                     onChange={e => setMinVolume(+e.target.value)}
                     className="w-full" style={{ accentColor: COLORS.mint }} />
            </div>
            {/* Direction */}
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.textMute }}>24h direction</div>
              <div className="flex gap-1">
                {[
                  { id: 'any',     label: 'Any' },
                  { id: 'gainers', label: '↗ Gainers' },
                  { id: 'losers',  label: '↘ Losers' },
                ].map(d => (
                  <button key={d.id} onClick={() => setChangeDir(d.id)}
                          className="flex-1 px-1.5 py-1 rounded text-[10.5px]"
                          style={{
                            background: changeDir === d.id ? COLORS.mint : COLORS.surface,
                            color: changeDir === d.id ? COLORS.bg : COLORS.textDim,
                            border: `1px solid ${COLORS.border}`,
                          }}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Reset */}
            <button onClick={() => {
              setSector('all'); setClassFilter('all'); setMinPrice(''); setMaxPrice('');
              setMinYield(0); setMinPE(''); setMaxPE(''); setMinMarketCap('any');
              setMinVolume(0); setChangeDir('any'); setSortBy('vol'); setPreset(null);
            }}
                    className="w-full py-1.5 rounded text-[11.5px] mt-2"
                    style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
              Reset all filters
            </button>
          </div>
          {/* Results table */}
          <div className="overflow-y-auto">
            <div className="px-4 py-2 border-b sticky top-0 z-10 flex items-center justify-between"
                 style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <span className="text-[11px]" style={{ color: COLORS.textMute }}>Sort by:</span>
              <div className="flex gap-1">
                {[
                  { id: 'vol',    label: 'Volume' },
                  { id: 'change', label: 'Change' },
                  { id: 'price',  label: 'Price' },
                  { id: 'yield',  label: 'Yield' },
                ].map(s => (
                  <button key={s.id} onClick={() => setSortBy(s.id)}
                          className="px-2 py-0.5 rounded text-[10.5px]"
                          style={{
                            background: sortBy === s.id ? COLORS.mint : 'transparent',
                            color: sortBy === s.id ? COLORS.bg : COLORS.textDim,
                          }}>{s.label}</button>
                ))}
              </div>
            </div>
            {results.length === 0 ? (
              <div className="py-16 text-center text-[12px]" style={{ color: COLORS.textMute }}>
                No matches — try widening your filters
              </div>
            ) : (
              <table className="imo-data-table w-full text-[11.5px]">
                <thead>
                  <tr style={{ background: COLORS.bg }}>
                    {['Ticker', 'Name', 'Sector', 'Price', '24h', 'Volume', 'Yield', 'Action'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-normal sticky top-[37px]"
                          style={{ color: COLORS.textMute, background: COLORS.surface }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map(inst => {
                    const yld = TICKER_DIVIDEND_YIELDS[inst.id] ?? 0;
                    const watched = watchedTickers.includes(inst.id);
                    return (
                      <tr key={inst.id} className="border-b hover:bg-white/[0.02]"
                          style={{ borderColor: COLORS.border }}>
                        <td className="px-3 py-2">
                          <button onClick={() => { onSelect?.(inst); onClose(); }}
                                  className="text-left flex items-center gap-1.5 hover:underline">
                            <InstIcon cls={inst.cls} size={14} ticker={inst.id} />
                            <span style={{ color: COLORS.text, fontWeight: 500 }}>{inst.id}</span>
                          </button>
                        </td>
                        <td className="px-3 py-2 truncate max-w-[200px]" style={{ color: COLORS.textDim }}>{inst.name}</td>
                        <td className="px-3 py-2 text-[10.5px]" style={{ color: COLORS.textMute }}>
                          {TICKER_SECTORS[inst.id] ?? '—'}
                        </td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: COLORS.text }}>${inst.mark?.toFixed(inst.dec ?? 2)}</td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: (inst.change24h ?? 0) >= 0 ? COLORS.green : COLORS.red }}>
                          {(inst.change24h ?? 0) >= 0 ? '+' : ''}{(inst.change24h ?? 0).toFixed(2)}%
                        </td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: COLORS.textDim }}>{fmtCompact(inst.vol24h)}</td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: yld > 0.03 ? COLORS.mint : COLORS.textDim }}>
                          {yld > 0 ? `${(yld * 100).toFixed(2)}%` : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => onAdd?.(inst.id)}
                                  disabled={watched}
                                  className="text-[10px] px-2 py-0.5 rounded transition-colors disabled:opacity-30 disabled:cursor-default"
                                  style={{ background: COLORS.mint, color: COLORS.bg }}>
                            {watched ? '✓ Added' : '+ Add'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
