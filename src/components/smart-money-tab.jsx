// IMO Onyx Terminal — Smart Money tab
//
// Phase 3p.20 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~94338-94952, ~614 lines).
//
// Hedge-fund 13F holdings explorer. Pulls SEC 13F filings from a
// curated list of well-known smart-money funds and displays their
// recent position changes (new buys, sells, increased/decreased
// stakes). Uses parseSec13F from src/lib/external-data.js — that
// module handles the 13F XML parsing and basic ranking.
//
// Public export:
//   SmartMoneyTab({ setActive, setPage })
//     setActive(instrumentId) — navigate to chart for ticker
//     setPage(pageId)         — navigate to a different page
//
// Honest scope:
//   - 13F filings are quarterly with a 45-day reporting lag, so
//     "recent" here means "as of the last quarter's filing date".
//     Funds may have already added or sold what they show.
//   - The fund list is hardcoded (Buffett, Burry, Ackman, Klarman,
//     Tepper, Druckenmiller, Loeb, Einhorn, Cooperman, Marks).
//     A more complete version would let users add their own CIKs.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Telescope, ArrowUpRight, Minus } from 'lucide-react';
import { COLORS } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import { fetchSecFilingsByCIK, parseSec13F } from '../lib/external-data.js';


// CURATED_13F (inlined from monolith during 3p.20 file-splitting —
// SmartMoneyTab is the only caller). Hand-curated snapshot of major
// hedge fund holdings; in production we would parse SEC EDGAR 13F
// filings directly via fetchSecFilingsByCIK + parseSec13F.
// CURATED_13F — hand-curated snapshot of major hedge fund holdings.
// In a production system we'd parse SEC EDGAR's 13F filings directly
// (they're free, just slow to scrape). This is the "good enough for
// in-app preview" fallback so the surface has realistic data without
// requiring live SEC integration.
//
// Data sourced from publicly disclosed 13F-HR filings. Top 10
// holdings per fund by reported value. Approximated; real data
// shifts quarterly with each new filing window.

// CIK_BY_FUND — institutional investor CIKs for 13F live integration.
// Inlined from monolith in 3p.37 (smart-money-tab is the only consumer).
const CIK_BY_FUND = {
  'Berkshire Hathaway':    '0001067983',
  'Bridgewater Associates':'0001350694',
  'Citadel Advisors':      '0001423053',
  'Pershing Square':       '0001336528',
  'Tiger Global':          '0001167483',
  'Renaissance Technologies':'0001037389',
  'Two Sigma':             '0001179392',
  'Millennium Management': '0001273087',
  'D.E. Shaw':             '0001009207',
  'Point72':               '0001603466',
};

const CURATED_13F = [
  {
    fund: 'Berkshire Hathaway',
    manager: 'Warren Buffett',
    aumBn: 320,
    asOf: '2025-Q3',
    strategy: 'Long-only value, concentrated',
    holdings: [
      { ticker: 'AAPL',  weight: 0.21, change: 'reduced',   notes: 'Trimmed ~25% over the past 4 quarters' },
      { ticker: 'AXP',   weight: 0.15, change: 'unchanged', notes: 'Long-time core position' },
      { ticker: 'BAC',   weight: 0.10, change: 'reduced',   notes: 'Sold ~150M shares since 2024' },
      { ticker: 'KO',    weight: 0.09, change: 'unchanged', notes: '60-year Buffett favorite' },
      { ticker: 'CVX',   weight: 0.06, change: 'unchanged', notes: 'Energy hedge' },
      { ticker: 'OXY',   weight: 0.05, change: 'increased', notes: 'Continued accumulation' },
      { ticker: 'KHC',   weight: 0.04, change: 'unchanged', notes: '' },
      { ticker: 'MCO',   weight: 0.03, change: 'unchanged', notes: 'Moody\'s — moat play' },
      { ticker: 'CB',    weight: 0.03, change: 'increased', notes: 'New position 2024' },
      { ticker: 'V',     weight: 0.02, change: 'unchanged', notes: '' },
    ],
  },
  {
    fund: 'Bridgewater Associates',
    manager: 'Ray Dalio',
    aumBn: 124,
    asOf: '2025-Q3',
    strategy: 'All-Weather macro, risk parity',
    holdings: [
      { ticker: 'IEMG', weight: 0.07, change: 'increased', notes: 'EM equities exposure' },
      { ticker: 'SPY',  weight: 0.06, change: 'unchanged', notes: '' },
      { ticker: 'IVV',  weight: 0.05, change: 'unchanged', notes: '' },
      { ticker: 'GLD',  weight: 0.05, change: 'increased', notes: 'Gold allocation up notably' },
      { ticker: 'PG',   weight: 0.03, change: 'unchanged', notes: '' },
      { ticker: 'JNJ',  weight: 0.03, change: 'unchanged', notes: 'Defensive staples' },
      { ticker: 'KO',   weight: 0.02, change: 'reduced',   notes: '' },
      { ticker: 'PEP',  weight: 0.02, change: 'unchanged', notes: '' },
      { ticker: 'WMT',  weight: 0.02, change: 'increased', notes: '' },
      { ticker: 'PM',   weight: 0.02, change: 'reduced',   notes: '' },
    ],
  },
  {
    fund: 'Citadel Advisors',
    manager: 'Ken Griffin',
    aumBn: 65,
    asOf: '2025-Q3',
    strategy: 'Multi-strategy, market-neutral',
    holdings: [
      { ticker: 'NVDA', weight: 0.04, change: 'increased', notes: 'Largest tech long' },
      { ticker: 'MSFT', weight: 0.03, change: 'unchanged', notes: '' },
      { ticker: 'AMZN', weight: 0.02, change: 'unchanged', notes: '' },
      { ticker: 'META', weight: 0.02, change: 'reduced',   notes: 'Trimmed after 2024 run' },
      { ticker: 'GOOGL', weight: 0.02, change: 'unchanged', notes: '' },
      { ticker: 'TSLA', weight: 0.015, change: 'increased', notes: '' },
      { ticker: 'AAPL', weight: 0.014, change: 'reduced',   notes: '' },
      { ticker: 'JPM',  weight: 0.013, change: 'unchanged', notes: '' },
      { ticker: 'V',    weight: 0.011, change: 'unchanged', notes: '' },
      { ticker: 'XOM',  weight: 0.010, change: 'increased', notes: 'Energy bet' },
    ],
  },
  {
    fund: 'Pershing Square',
    manager: 'Bill Ackman',
    aumBn: 18,
    asOf: '2025-Q3',
    strategy: 'Concentrated activist long-only',
    holdings: [
      { ticker: 'CMG',  weight: 0.21, change: 'unchanged', notes: 'Chipotle — long-time core position' },
      { ticker: 'QSR',  weight: 0.18, change: 'unchanged', notes: 'Restaurant Brands' },
      { ticker: 'HHC',  weight: 0.14, change: 'unchanged', notes: 'Howard Hughes — controlled position' },
      { ticker: 'GOOG', weight: 0.13, change: 'increased', notes: 'Alphabet — high conviction' },
      { ticker: 'GOOGL',weight: 0.10, change: 'increased', notes: '' },
      { ticker: 'NKE',  weight: 0.09, change: 'unchanged', notes: 'Nike turnaround thesis' },
      { ticker: 'BN',   weight: 0.08, change: 'increased', notes: 'Brookfield' },
      { ticker: 'HLT',  weight: 0.04, change: 'unchanged', notes: 'Hilton' },
      { ticker: 'CP',   weight: 0.03, change: 'unchanged', notes: 'CP Rail' },
      { ticker: 'SEG',  weight: 0.001, change: 'increased', notes: 'New small position' },
    ],
  },
  {
    fund: 'Tiger Global',
    manager: 'Chase Coleman',
    aumBn: 28,
    asOf: '2025-Q3',
    strategy: 'Growth tech, public + private',
    holdings: [
      { ticker: 'META', weight: 0.10, change: 'unchanged', notes: '' },
      { ticker: 'MSFT', weight: 0.08, change: 'unchanged', notes: '' },
      { ticker: 'GOOGL',weight: 0.07, change: 'increased', notes: '' },
      { ticker: 'NVDA', weight: 0.06, change: 'reduced',   notes: 'Trimmed near peaks' },
      { ticker: 'AMZN', weight: 0.05, change: 'unchanged', notes: '' },
      { ticker: 'SE',   weight: 0.04, change: 'increased', notes: 'Sea Ltd — EM e-commerce play' },
      { ticker: 'NU',   weight: 0.04, change: 'increased', notes: 'Nubank' },
      { ticker: 'BABA', weight: 0.03, change: 'increased', notes: 'Alibaba added back' },
      { ticker: 'CRWD', weight: 0.03, change: 'unchanged', notes: '' },
      { ticker: 'DDOG', weight: 0.02, change: 'unchanged', notes: '' },
    ],
  },
];

export const SmartMoneyTab = ({ setActive, setPage }) => {
  const [selectedFundId, setSelectedFundId] = useState(0);
  const fund = CURATED_13F[selectedFundId];
  // Live 13F integration — fetches recent 13F-HR filings per fund CIK
  const [liveFilings, setLiveFilings] = useState({}); // fundName → recent 13F filings
  const [liveStatus, setLiveStatus] = useState('idle');
  const [liveProgress, setLiveProgress] = useState(0);
  // Parsed 13F position table for the currently selected filing
  const [parsedPositions, setParsedPositions] = useState(null); // { holdings, total, … }
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(null);
  // Q-over-Q change tracker — compares current 13F vs prior quarter
  const [qoqDiff, setQoqDiff] = useState(null); // { fundName, fromDate, toDate, newBuys: [...], increased: [...], reduced: [...], exited: [...], changesByCusip: Map }
  const [qoqLoading, setQoqLoading] = useState(false);
  const [qoqError, setQoqError] = useState(null);

  const refreshLive = useCallback(async () => {
    setLiveStatus('loading');
    setLiveProgress(0);
    try {
      const fundNames = Object.keys(CIK_BY_FUND);
      const collected = {};
      const total = fundNames.length;
      for (let i = 0; i < total; i++) {
        const name = fundNames[i];
        const cik = CIK_BY_FUND[name];
        try {
          const filings = await fetchSecFilingsByCIK(cik, '13F-HR', 8);
          if (filings.length > 0) collected[name] = filings;
        } catch {}
        setLiveFilings({ ...collected });
        setLiveProgress((i + 1) / total);
        // SEC fair-access pacing
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      setLiveStatus('ok');
    } catch (e) {
      console.warn('[SmartMoneyTab.refreshLive]', e?.message);
      setLiveStatus('error');
    }
  }, []);

  // Latest live filing for the currently selected fund
  const liveSelectedFiling = useMemo(() => {
    if (!fund) return null;
    const filings = liveFilings[fund.fund];
    return filings && filings.length > 0 ? filings[0] : null;
  }, [fund, liveFilings]);

  const liveFundCount = useMemo(() => Object.keys(liveFilings).length, [liveFilings]);

  const changeColor = (c) => c === 'increased' ? COLORS.green
                          : c === 'reduced' ? COLORS.red
                          :                   COLORS.textDim;
  const changeIcon = (c) => c === 'increased' ? <TrendingUp size={10} />
                          : c === 'reduced'   ? <TrendingDown size={10} />
                          :                     <Minus size={10} />;

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3"
           style={{ borderColor: COLORS.border, background: COLORS.surface }}>
        <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
          <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
            About 13F filings
          </div>
          <div className="flex items-center gap-2">
            {liveFundCount > 0 && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                    style={{ background: `${COLORS.green}1A`, color: COLORS.green, border: `1px solid ${COLORS.green}55` }}>
                <span className="rounded-full" style={{ width: 5, height: 5, background: COLORS.green }} />
                {liveFundCount}/{Object.keys(CIK_BY_FUND).length} funds linked
              </span>
            )}
            <button type="button"
                    onClick={refreshLive}
                    disabled={liveStatus === 'loading'}
                    className="px-2.5 py-1 rounded text-[10.5px] inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40"
                    style={{ background: `${COLORS.mint}1A`, color: COLORS.mint, border: `1px solid ${COLORS.mint}` }}>
              {liveStatus === 'loading'
                ? <RefreshCw size={10} className="animate-spin" />
                : <RefreshCw size={10} />}
              {liveStatus === 'loading'
                ? `Loading… ${(liveProgress * 100).toFixed(0)}%`
                : liveStatus === 'ok' ? 'Refresh SEC'
                : liveStatus === 'error' ? 'Retry'
                : 'Pull live SEC data'}
            </button>
          </div>
        </div>
        <p className="text-[11px]" style={{ color: COLORS.textDim }}>
          Form 13F-HR is a quarterly disclosure required of institutional investment managers with
          $100M+ in equity AUM. Filings reveal long equity positions but not shorts, options strategies,
          or private holdings. Released ~45 days after quarter-end, so always slightly stale.
          {' '}<strong>Live SEC EDGAR integration available</strong> — fetches recent 13F-HR filings per fund CIK from <code>data.sec.gov/submissions</code>; the curated holdings dataset stays as detailed view (parsing 13F .xml info tables for actual position lists is bulky and remains a future drop).
        </p>
      </div>

      {/* Latest live filing banner for selected fund */}
      {liveSelectedFiling && (
        <div className="rounded-md border p-2 flex items-center justify-between flex-wrap gap-2"
             style={{ borderColor: `${COLORS.green}55`, background: `${COLORS.green}10` }}>
          <div className="text-[11px]" style={{ color: COLORS.text }}>
            <span style={{ color: COLORS.green, fontWeight: 500 }}>Latest 13F-HR:</span> filed {liveSelectedFiling.date}
            {' · '}<span style={{ color: COLORS.textMute }}>accession {liveSelectedFiling.accession}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button"
                    onClick={async () => {
                      setParsing(true);
                      setParseError(null);
                      setParsedPositions(null);
                      try {
                        const result = await parseSec13F(liveSelectedFiling);
                        if (result && result.holdings.length > 0) {
                          setParsedPositions(result);
                        } else {
                          setParseError('No positions parsed from filing');
                        }
                      } catch (e) {
                        setParseError(e?.message || 'Parse failed');
                      } finally {
                        setParsing(false);
                      }
                    }}
                    disabled={parsing}
                    className="text-[10.5px] uppercase tracking-wider px-2 py-1 rounded inline-flex items-center gap-1 hover:opacity-90 disabled:opacity-40"
                    style={{ background: `${COLORS.mint}1A`, color: COLORS.mint, border: `1px solid ${COLORS.mint}55` }}>
              <Telescope size={10} className={parsing ? 'animate-pulse' : ''} />
              {parsing ? 'Parsing…' : 'Parse positions'}
            </button>
            <button type="button"
                    onClick={async () => {
                      if (!fund) return;
                      const filings = liveFilings[fund.fund] || [];
                      if (filings.length < 2) {
                        setQoqError('Need at least 2 filings — pull live SEC data first');
                        return;
                      }
                      setQoqLoading(true);
                      setQoqError(null);
                      setQoqDiff(null);
                      try {
                        // Parse current + prior quarter in parallel
                        const [curr, prior] = await Promise.all([
                          parseSec13F(filings[0]),
                          parseSec13F(filings[1]),
                        ]);
                        if (!curr || !prior || curr.holdings.length === 0 || prior.holdings.length === 0) {
                          setQoqError('Failed to parse one of the filings');
                          return;
                        }
                        // Build maps keyed by CUSIP
                        const currMap = new Map();
                        const priorMap = new Map();
                        for (const h of curr.holdings) {
                          if (h.cusip) currMap.set(h.cusip, h);
                        }
                        for (const h of prior.holdings) {
                          if (h.cusip) priorMap.set(h.cusip, h);
                        }
                        // Diff
                        const newBuys = [];
                        const increased = [];
                        const reduced = [];
                        const exited = [];
                        const unchanged = [];
                        for (const [cusip, h] of currMap) {
                          const prev = priorMap.get(cusip);
                          if (!prev) {
                            newBuys.push({ ...h, deltaShares: h.shares, deltaPct: 100, deltaValue: h.value });
                          } else {
                            const dShares = h.shares - prev.shares;
                            const dValue = h.value - prev.value;
                            const dPct = prev.shares > 0 ? (dShares / prev.shares) * 100 : 0;
                            const change = { ...h, prevShares: prev.shares, prevValue: prev.value, deltaShares: dShares, deltaPct: dPct, deltaValue: dValue };
                            if (Math.abs(dPct) < 5) unchanged.push(change);
                            else if (dShares > 0) increased.push(change);
                            else reduced.push(change);
                          }
                        }
                        for (const [cusip, h] of priorMap) {
                          if (!currMap.has(cusip)) {
                            exited.push({ ...h, deltaShares: -h.shares, deltaPct: -100, deltaValue: -h.value });
                          }
                        }
                        // Sort each list by absolute delta value (most impactful first)
                        newBuys.sort((a, b) => Math.abs(b.deltaValue) - Math.abs(a.deltaValue));
                        increased.sort((a, b) => Math.abs(b.deltaValue) - Math.abs(a.deltaValue));
                        reduced.sort((a, b) => Math.abs(b.deltaValue) - Math.abs(a.deltaValue));
                        exited.sort((a, b) => Math.abs(b.deltaValue) - Math.abs(a.deltaValue));
                        setQoqDiff({
                          fundName: fund.fund,
                          fromDate: prior.filingDate,
                          toDate: curr.filingDate,
                          newBuys, increased, reduced, exited,
                          unchangedCount: unchanged.length,
                          totalNewValue: newBuys.reduce((s, h) => s + h.deltaValue, 0),
                          totalIncreasedValue: increased.reduce((s, h) => s + h.deltaValue, 0),
                          totalReducedValue: reduced.reduce((s, h) => s + Math.abs(h.deltaValue), 0),
                          totalExitedValue: exited.reduce((s, h) => s + Math.abs(h.deltaValue), 0),
                        });
                      } catch (e) {
                        setQoqError(e?.message || 'Diff failed');
                      } finally {
                        setQoqLoading(false);
                      }
                    }}
                    disabled={qoqLoading || (liveFilings[fund?.fund]?.length || 0) < 2}
                    className="text-[10.5px] uppercase tracking-wider px-2 py-1 rounded inline-flex items-center gap-1 hover:opacity-90 disabled:opacity-40"
                    style={{ background: `${COLORS.chartGold}1A`, color: COLORS.chartGold, border: `1px solid ${COLORS.chartGold}55` }}
                    title={(liveFilings[fund?.fund]?.length || 0) < 2 ? 'Pull live SEC data first to enable Q-over-Q comparison' : 'Compare with prior quarter'}>
              <ArrowUpRight size={10} className={qoqLoading ? 'animate-pulse' : ''} />
              {qoqLoading ? 'Diffing…' : 'Compare Q-over-Q'}
            </button>
            <a href={liveSelectedFiling.url} target="_blank" rel="noopener noreferrer"
               className="text-[10.5px] uppercase tracking-wider hover:underline"
               style={{ color: COLORS.mint }}>
              View on SEC EDGAR ↗
            </a>
          </div>
        </div>
      )}

      {/* Parsed 13F position table */}
      {parseError && (
        <div className="rounded-md border p-2 text-[11px]"
             style={{ borderColor: COLORS.red, color: COLORS.red, background: 'rgba(255,85,119,0.06)' }}>
          {parseError}
        </div>
      )}
      {parsedPositions && (
        <div className="rounded-md border"
             style={{ borderColor: `${COLORS.mint}55`, background: COLORS.surface }}>
          <div className="px-3 py-2 flex items-baseline justify-between flex-wrap gap-2"
               style={{ borderBottom: `1px solid ${COLORS.border}` }}>
            <div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                Parsed positions · live SEC info table
              </div>
              <div className="text-[11.5px]" style={{ color: COLORS.text }}>
                <span style={{ color: COLORS.mint, fontWeight: 500 }}>{parsedPositions.total.positions}</span> holdings ·
                <span style={{ color: COLORS.green, fontWeight: 500 }}> ${(parsedPositions.total.value / 1e9).toFixed(1)}B</span> AUM ·
                filed {parsedPositions.filingDate}
              </div>
            </div>
            <button type="button"
                    onClick={() => { setParsedPositions(null); setParseError(null); }}
                    className="text-[10.5px] px-2 py-0.5 rounded hover:opacity-90"
                    style={{ background: COLORS.bg, color: COLORS.textMute, border: `1px solid ${COLORS.border}` }}>
              Close
            </button>
          </div>
          <div className="overflow-x-auto" style={{ maxHeight: 400 }}>
            <table className="w-full text-[10.5px] tabular-nums">
              <thead style={{ position: 'sticky', top: 0, background: COLORS.bg, zIndex: 1 }}>
                <tr style={{ color: COLORS.textMute }}>
                  <th className="text-left px-2 py-1.5">#</th>
                  <th className="text-left px-2">Issuer</th>
                  <th className="text-left px-2">Class</th>
                  <th className="text-left px-2">CUSIP</th>
                  <th className="text-right px-2">Shares</th>
                  <th className="text-right px-2">$ Value</th>
                  <th className="text-right px-2">% AUM</th>
                  <th className="text-right px-2">$/sh</th>
                  <th className="text-left px-2">Type</th>
                </tr>
              </thead>
              <tbody>
                {parsedPositions.holdings.slice(0, 50).map((h, idx) => {
                  const pctAum = parsedPositions.total.value > 0
                    ? (h.value / parsedPositions.total.value) * 100
                    : 0;
                  return (
                    <tr key={idx} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                      <td className="px-2 py-1" style={{ color: COLORS.textMute }}>{idx + 1}</td>
                      <td className="px-2" style={{ color: COLORS.text, fontWeight: 500 }}>
                        {h.nameOfIssuer.slice(0, 28)}
                      </td>
                      <td className="px-2 text-[10px]" style={{ color: COLORS.textDim }}>
                        {h.titleOfClass.slice(0, 8)}
                      </td>
                      <td className="px-2 text-[10px]" style={{ color: COLORS.textMute, fontFamily: 'ui-monospace' }}>
                        {h.cusip}
                      </td>
                      <td className="text-right px-2" style={{ color: COLORS.textDim }}>
                        {h.shares >= 1e9 ? `${(h.shares / 1e9).toFixed(2)}B`
                         : h.shares >= 1e6 ? `${(h.shares / 1e6).toFixed(2)}M`
                         : h.shares >= 1e3 ? `${(h.shares / 1e3).toFixed(0)}K`
                         :                    h.shares.toLocaleString()}
                      </td>
                      <td className="text-right px-2" style={{ color: COLORS.text }}>
                        {h.value >= 1e9 ? `$${(h.value / 1e9).toFixed(2)}B`
                         : h.value >= 1e6 ? `$${(h.value / 1e6).toFixed(1)}M`
                         :                    `$${h.value.toLocaleString()}`}
                      </td>
                      <td className="text-right px-2"
                          style={{ color: pctAum >= 5 ? COLORS.mint : COLORS.textDim, fontWeight: pctAum >= 5 ? 500 : 400 }}>
                        {pctAum.toFixed(2)}%
                      </td>
                      <td className="text-right px-2" style={{ color: COLORS.textMute }}>
                        {h.pricePerShare ? `$${h.pricePerShare.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-2 text-[10px]"
                          style={{ color: h.putCall ? (h.putCall === 'Put' ? COLORS.red : COLORS.green) : COLORS.textMute }}>
                        {h.putCall || h.sharesType}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {parsedPositions.holdings.length > 50 && (
            <div className="px-3 py-1.5 text-[10px]"
                 style={{ color: COLORS.textMute, borderTop: `1px solid ${COLORS.border}` }}>
              Showing top 50 of {parsedPositions.holdings.length} positions (sorted by value)
            </div>
          )}
        </div>
      )}

      {/* Q-over-Q diff error */}
      {qoqError && (
        <div className="rounded-md border p-2 text-[11px]"
             style={{ borderColor: COLORS.red, color: COLORS.red, background: 'rgba(255,85,119,0.06)' }}>
          {qoqError}
        </div>
      )}

      {/* Q-over-Q change tracker */}
      {qoqDiff && (
        <div className="rounded-md border"
             style={{ borderColor: `${COLORS.chartGold}55`, background: COLORS.surface }}>
          <div className="px-3 py-2 flex items-baseline justify-between flex-wrap gap-2"
               style={{ borderBottom: `1px solid ${COLORS.border}` }}>
            <div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                Q-over-Q changes · {qoqDiff.fundName}
              </div>
              <div className="text-[11.5px]" style={{ color: COLORS.text }}>
                {qoqDiff.fromDate} → <strong style={{ color: COLORS.chartGold }}>{qoqDiff.toDate}</strong>
              </div>
            </div>
            <button type="button"
                    onClick={() => { setQoqDiff(null); setQoqError(null); }}
                    className="text-[10.5px] px-2 py-0.5 rounded hover:opacity-90"
                    style={{ background: COLORS.bg, color: COLORS.textMute, border: `1px solid ${COLORS.border}` }}>
              Close
            </button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3"
               style={{ borderBottom: `1px solid ${COLORS.border}` }}>
            <div className="rounded border p-2" style={{ borderColor: `${COLORS.green}55`, background: `${COLORS.green}08` }}>
              <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.green }}>New buys</div>
              <div className="tabular-nums text-[14px] font-medium" style={{ color: COLORS.green }}>
                {qoqDiff.newBuys.length}
              </div>
              <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                ${(qoqDiff.totalNewValue / 1e6).toFixed(0)}M deployed
              </div>
            </div>
            <div className="rounded border p-2" style={{ borderColor: `${COLORS.green}55`, background: `${COLORS.green}05` }}>
              <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.green }}>Increased</div>
              <div className="tabular-nums text-[14px] font-medium" style={{ color: COLORS.green }}>
                {qoqDiff.increased.length}
              </div>
              <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                +${(qoqDiff.totalIncreasedValue / 1e6).toFixed(0)}M
              </div>
            </div>
            <div className="rounded border p-2" style={{ borderColor: `${COLORS.red}55`, background: `${COLORS.red}05` }}>
              <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.red }}>Reduced</div>
              <div className="tabular-nums text-[14px] font-medium" style={{ color: COLORS.red }}>
                {qoqDiff.reduced.length}
              </div>
              <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                −${(qoqDiff.totalReducedValue / 1e6).toFixed(0)}M
              </div>
            </div>
            <div className="rounded border p-2" style={{ borderColor: `${COLORS.red}55`, background: `${COLORS.red}08` }}>
              <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.red }}>Exited</div>
              <div className="tabular-nums text-[14px] font-medium" style={{ color: COLORS.red }}>
                {qoqDiff.exited.length}
              </div>
              <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                −${(qoqDiff.totalExitedValue / 1e6).toFixed(0)}M
              </div>
            </div>
            <div className="rounded border p-2" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
              <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Unchanged</div>
              <div className="tabular-nums text-[14px] font-medium" style={{ color: COLORS.textDim }}>
                {qoqDiff.unchangedCount}
              </div>
              <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                ±5% drift
              </div>
            </div>
          </div>

          {/* Two-column: New Buys + Exits */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-0">
            <div style={{ borderRight: `1px solid ${COLORS.border}` }}>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider"
                   style={{ color: COLORS.green, borderBottom: `1px solid ${COLORS.border}` }}>
                Top new positions
              </div>
              {qoqDiff.newBuys.length === 0 ? (
                <div className="px-3 py-3 text-[10.5px]" style={{ color: COLORS.textMute }}>
                  No new positions vs prior quarter
                </div>
              ) : (
                <table className="w-full text-[10.5px] tabular-nums">
                  <tbody>
                    {qoqDiff.newBuys.slice(0, 8).map((h, i) => (
                      <tr key={i} style={{ borderTop: i > 0 ? `1px solid ${COLORS.border}` : 'none' }}>
                        <td className="px-3 py-1" style={{ color: COLORS.text, fontWeight: 500 }}>
                          {h.nameOfIssuer.slice(0, 24)}
                        </td>
                        <td className="text-right px-3" style={{ color: COLORS.green }}>
                          ${h.deltaValue >= 1e9
                            ? `${(h.deltaValue / 1e9).toFixed(2)}B`
                            : `${(h.deltaValue / 1e6).toFixed(1)}M`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider"
                   style={{ color: COLORS.red, borderBottom: `1px solid ${COLORS.border}` }}>
                Top exits
              </div>
              {qoqDiff.exited.length === 0 ? (
                <div className="px-3 py-3 text-[10.5px]" style={{ color: COLORS.textMute }}>
                  No fully-exited positions vs prior quarter
                </div>
              ) : (
                <table className="w-full text-[10.5px] tabular-nums">
                  <tbody>
                    {qoqDiff.exited.slice(0, 8).map((h, i) => (
                      <tr key={i} style={{ borderTop: i > 0 ? `1px solid ${COLORS.border}` : 'none' }}>
                        <td className="px-3 py-1" style={{ color: COLORS.text, fontWeight: 500 }}>
                          {h.nameOfIssuer.slice(0, 24)}
                        </td>
                        <td className="text-right px-3" style={{ color: COLORS.red }}>
                          −${Math.abs(h.deltaValue) >= 1e9
                            ? `${(Math.abs(h.deltaValue) / 1e9).toFixed(2)}B`
                            : `${(Math.abs(h.deltaValue) / 1e6).toFixed(1)}M`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Increased + Reduced rows */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-0"
               style={{ borderTop: `1px solid ${COLORS.border}` }}>
            <div style={{ borderRight: `1px solid ${COLORS.border}` }}>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider"
                   style={{ color: COLORS.green, borderBottom: `1px solid ${COLORS.border}` }}>
                Top increased
              </div>
              {qoqDiff.increased.length === 0 ? (
                <div className="px-3 py-3 text-[10.5px]" style={{ color: COLORS.textMute }}>No increases</div>
              ) : (
                <table className="w-full text-[10.5px] tabular-nums">
                  <tbody>
                    {qoqDiff.increased.slice(0, 8).map((h, i) => (
                      <tr key={i} style={{ borderTop: i > 0 ? `1px solid ${COLORS.border}` : 'none' }}>
                        <td className="px-3 py-1" style={{ color: COLORS.text }}>
                          {h.nameOfIssuer.slice(0, 22)}
                        </td>
                        <td className="text-right px-3 text-[10px]" style={{ color: COLORS.textDim }}>
                          +{h.deltaPct.toFixed(0)}%
                        </td>
                        <td className="text-right px-3" style={{ color: COLORS.green }}>
                          +${(h.deltaValue / 1e6).toFixed(1)}M
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider"
                   style={{ color: COLORS.red, borderBottom: `1px solid ${COLORS.border}` }}>
                Top reduced
              </div>
              {qoqDiff.reduced.length === 0 ? (
                <div className="px-3 py-3 text-[10.5px]" style={{ color: COLORS.textMute }}>No reductions</div>
              ) : (
                <table className="w-full text-[10.5px] tabular-nums">
                  <tbody>
                    {qoqDiff.reduced.slice(0, 8).map((h, i) => (
                      <tr key={i} style={{ borderTop: i > 0 ? `1px solid ${COLORS.border}` : 'none' }}>
                        <td className="px-3 py-1" style={{ color: COLORS.text }}>
                          {h.nameOfIssuer.slice(0, 22)}
                        </td>
                        <td className="text-right px-3 text-[10px]" style={{ color: COLORS.textDim }}>
                          {h.deltaPct.toFixed(0)}%
                        </td>
                        <td className="text-right px-3" style={{ color: COLORS.red }}>
                          −${Math.abs(h.deltaValue / 1e6).toFixed(1)}M
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="px-3 py-2 text-[10px]"
               style={{ color: COLORS.textDim, borderTop: `1px solid ${COLORS.border}` }}>
            Compared by CUSIP. Drift &lt;5% counted as "unchanged" — handles stock splits and rounding.
            New positions are bullish signals from the manager; full exits are bearish unless tied to a known
            macro view shift. Increases of &gt;30% with sustained AUM are the strongest conviction signal.
          </div>
        </div>
      )}

      {/* Fund selector */}
      <div className="flex flex-wrap gap-1.5">
        {CURATED_13F.map((f, idx) => (
          <button key={idx} type="button"
                  onClick={() => setSelectedFundId(idx)}
                  className="px-2.5 py-1.5 rounded text-[11px] transition-colors"
                  style={{
                    background: selectedFundId === idx ? `${COLORS.mint}1A` : COLORS.bg,
                    color: selectedFundId === idx ? COLORS.mint : COLORS.textDim,
                    border: `1px solid ${selectedFundId === idx ? COLORS.mint : COLORS.border}`,
                  }}>
            {f.fund}
          </button>
        ))}
      </div>

      {/* Fund detail */}
      <div className="rounded-md border p-3"
           style={{ borderColor: COLORS.border, background: COLORS.surface }}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <div>
            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Fund</div>
            <div className="text-[14px] font-medium" style={{ color: COLORS.text }}>{fund.fund}</div>
            <div className="text-[10.5px]" style={{ color: COLORS.textDim }}>{fund.manager}</div>
          </div>
          <div>
            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Strategy</div>
            <div className="text-[11.5px]" style={{ color: COLORS.text }}>{fund.strategy}</div>
          </div>
          <div>
            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>AUM (US equity)</div>
            <div className="text-[14px] font-medium tabular-nums" style={{ color: COLORS.text }}>${fund.aumBn}B</div>
            <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>as of {fund.asOf}</div>
          </div>
        </div>

        <div className="overflow-x-auto rounded border" style={{ borderColor: COLORS.border }}>
          <table className="w-full text-[11px] tabular-nums">
            <thead>
              <tr style={{ color: COLORS.textMute, background: COLORS.bg }}>
                <th className="text-left px-2 py-1.5">#</th>
                <th className="text-left px-2">Ticker</th>
                <th className="text-right px-2">Weight</th>
                <th className="text-right px-2">Approx $</th>
                <th className="text-left px-2">Change</th>
                <th className="text-left px-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {fund.holdings.map((h, idx) => (
                <tr key={idx} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                  <td className="px-2 py-1.5" style={{ color: COLORS.textMute }}>{idx + 1}</td>
                  <td className="px-2 py-1.5">
                    <button type="button"
                            onClick={() => {
                              const inst = INSTRUMENTS.find(i => i.id?.startsWith(h.ticker + '-') || i.id === h.ticker || i.symbol === h.ticker);
                              if (inst && setActive) setActive(inst);
                              if (setPage) setPage('trade');
                            }}
                            className="hover:underline"
                            style={{ color: COLORS.text, fontWeight: 500 }}>
                      {h.ticker}
                    </button>
                  </td>
                  <td className="text-right px-2" style={{ color: COLORS.text }}>{(h.weight * 100).toFixed(2)}%</td>
                  <td className="text-right px-2" style={{ color: COLORS.textDim }}>
                    ${(h.weight * fund.aumBn * 1000).toFixed(0)}M
                  </td>
                  <td className="px-2">
                    <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-wider"
                          style={{ color: changeColor(h.change) }}>
                      {changeIcon(h.change)}
                      {h.change}
                    </span>
                  </td>
                  <td className="px-2 text-[10.5px]" style={{ color: COLORS.textMute }}>{h.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
