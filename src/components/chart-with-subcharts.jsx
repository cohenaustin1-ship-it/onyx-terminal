// @ts-check
// IMO Onyx Terminal — Chart with subcharts (TradePage chart pane)
//
// Phase 3p.29 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines 10435-11596, ~1,162 lines).
//
// Third "lift the children" phase preparing for TradePage extraction.
// ChartWithSubcharts wraps the main Chart component plus a stack of
// optional sub-chart panels (volume profile, vol skew, news, etc.)
// that the user can add/remove from a side menu.
//
// Public exports:
//   ChartWithSubcharts({ instrument, livePrice, instanceId, user, account })
//   SubChartFull       — full-width subchart used in expanded layouts
//
// Internal companions (only used inside this module):
//   SUBCHART_TYPES     — registry of available subchart types
//   SubChart           — router that picks the right SubChart* variant
//   SubChartNetDrift   — net drift visualization
//   SubChartHeatmap    — heatmap visualization
//   SubChartInterval   — interval band visualization
//   SubChartVolDrift   — volatility drift visualization
//   SubChartNetFlow    — net flow visualization
//   SubChartDarkFlow   — dark pool flow visualization
//   SubChartGainers    — gainers/losers visualization
//   SubChartMarketMap  — market map visualization
//   SubChartNews       — news feed visualization
//   SubChartVolSkew    — volatility skew visualization
//
// Honest scope:
//   - Subchart data is computed client-side (no live data fetches
//     beyond what Chart already pulls).
//   - Subchart layout is grid-based; user can drag to reorder.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
  CartesianGrid, ReferenceLine, BarChart, Bar, ComposedChart, Area,
  AreaChart, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { COLORS } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import { Chart } from './chart-page.jsx';

export const SUBCHART_TYPES = [
  { id: 'net-drift',     label: 'Net Drift',         desc: 'Cumulative premium imbalance: calls vs puts over time' },
  { id: 'heatmap',       label: 'Heat Map',          desc: 'Net GEX heat map by strike across days' },
  { id: 'interval',      label: 'Interval Map',      desc: 'Time-based exposure (Delta/Gamma/Vanna/Charm)' },
  { id: 'vol-drift',     label: 'Volatility Drift',  desc: 'IV evolution intraday vs price' },
  { id: 'net-flow',      label: 'Net Flow',          desc: 'Real-time options premium flowing into calls/puts' },
  { id: 'dark-flow',     label: 'Dark Flow',         desc: 'Off-exchange institutional equity activity' },
  { id: 'gainers',       label: 'Gainers/Losers',    desc: 'Tickers ranked by bullish/bearish premium' },
  { id: 'news',          label: 'News',              desc: 'Real-time market-relevant news feed' },
  { id: 'vol-skew',      label: 'Volatility Skew',   desc: 'IV across strikes, revealing asymmetric pricing' },
];

// Generates synthetic time-series data for a sub-chart visualization.
// All data is illustrative — these are "what this chart would look like"
// previews for an institutional flow-analytics product, not real flow data.
const useSubChartData = (type, instrument, seed = 0) => {
  return useMemo(() => {
    const rng = (i) => {
      const x = Math.sin((seed + i + 1) * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    const spot = instrument?.mark ?? 100;

    if (type === 'net-drift') {
      const points = 80;
      const data = [];
      let calls = 0, puts = 0;
      for (let i = 0; i < points; i++) {
        const dC = (rng(i) - 0.5) * 1.5;
        const dP = (rng(i + 100) - 0.5) * 2;
        calls += dC; puts += dP;
        data.push({
          t: i, time: `${9 + Math.floor(i * 7 / points)}:${String(Math.floor((i * 7 % points) * 60 / points)).padStart(2, '0')}`,
          calls: +(calls).toFixed(2),
          puts:  +(puts).toFixed(2),
          underlying: +(spot * (1 + (rng(i + 200) - 0.5) * 0.012)).toFixed(2),
          volume: rng(i + 300) * -250000,
        });
      }
      return data;
    }
    if (type === 'heatmap') {
      // Strike grid: 16 strikes x 11 dates
      const strikes = [];
      for (let s = -8; s <= 8; s++) {
        const strike = Math.round(spot + s * (spot * 0.005));
        const row = { strike };
        for (let d = 0; d < 11; d++) {
          const v = (rng(s + 50 + d * 10) - 0.5) * 1500;
          row[`d${d}`] = v;
        }
        strikes.push(row);
      }
      return strikes.reverse();
    }
    if (type === 'interval') {
      const cols = 36;
      const rows = 8;
      const dots = [];
      for (let r = 0; r < rows; r++) {
        const strike = +(spot + (r - rows / 2) * (spot * 0.005)).toFixed(2);
        for (let c = 0; c < cols; c++) {
          const intensity = rng(r * 100 + c) * (1 - Math.abs(r - rows / 2) / (rows / 2));
          dots.push({ x: c, y: strike, intensity });
        }
      }
      return { dots, strikes: Array.from({ length: rows }, (_, r) => +(spot + (r - rows / 2) * (spot * 0.005)).toFixed(2)).reverse() };
    }
    if (type === 'vol-drift') {
      // Same intraday timing format as net-flow. IV typically opens
      // higher (overnight gap risk priced in), declines through midday,
      // bounces toward close. ARV (actual realized vol) tends to lag.
      const today = new Date();
      const day = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const points = 78;
      const data = [];
      for (let i = 0; i < points; i++) {
        // Realistic intraday IV pattern: high at open, midday lull, EOD bump
        const tFrac = i / points;
        const ivShape = 38 - 8 * Math.sin(tFrac * Math.PI) + (rng(i + 100) - 0.5) * 4;
        const arvShape = ivShape * 0.62 + (rng(i + 300) - 0.5) * 8;
        const minutes = 9 * 60 + 30 + i * 5;
        const hh = Math.floor(minutes / 60);
        const mm = minutes % 60;
        const ampm = hh >= 12 ? 'p' : 'a';
        const hh12 = ((hh + 11) % 12) + 1;
        data.push({
          t: i,
          time: `${hh12}:${String(mm).padStart(2, '0')}${ampm}`,
          fullDateTime: `${day} ${hh12}:${String(mm).padStart(2, '0')}${ampm}`,
          iv: +ivShape.toFixed(2),
          arv: +Math.max(0, arvShape).toFixed(2),
          underlying: +(spot * (1 + Math.sin(i / 12) * 0.008 + (rng(i + 50) - 0.5) * 0.003)).toFixed(2),
        });
      }
      return data;
    }
    if (type === 'net-flow') {
      // Real-trading-day intraday data: 9:30am - 4:00pm ET, 5-minute bars.
      // Format times as "Mon 9:35a" style so the date is always visible.
      const today = new Date();
      const day = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const points = 78; // 6.5 hours of 5-min bars
      const data = [];
      for (let i = 0; i < points; i++) {
        const callSpike = rng(i) > 0.92 ? rng(i + 500) * 10 : 0;
        const putSpike = rng(i + 200) > 0.94 ? rng(i + 600) * 12 : 0;
        const minutes = 9 * 60 + 30 + i * 5;
        const hh = Math.floor(minutes / 60);
        const mm = minutes % 60;
        const ampm = hh >= 12 ? 'p' : 'a';
        const hh12 = ((hh + 11) % 12) + 1;
        data.push({
          t: i,
          time: `${hh12}:${String(mm).padStart(2, '0')}${ampm}`,
          fullDateTime: `${day} ${hh12}:${String(mm).padStart(2, '0')}${ampm}`,
          calls: +(rng(i + 100) * 4 + callSpike).toFixed(2),
          puts:  +(rng(i + 200) * 4 + putSpike).toFixed(2),
          underlying: +(spot * (1 + Math.sin(i / 18) * 0.005 + (rng(i) - 0.5) * 0.002)).toFixed(2),
        });
      }
      return data;
    }
    if (type === 'dark-flow') {
      const points = 100;
      const data = [];
      for (let i = 0; i < points; i++) {
        const notional = (rng(i) * 0.7 + (rng(i + 50) > 0.96 ? rng(i + 100) * 1.2 : 0)) * 200;
        data.push({
          t: i, time: `${8 + Math.floor(i * 9 / points)}:${String(Math.floor((i * 9 % points) * 60 / points)).padStart(2, '0')}`,
          notional: +notional.toFixed(2),
          underlying: +(spot * (1 + (i / points) * 0.04 + (rng(i + 200) - 0.5) * 0.01)).toFixed(2),
        });
      }
      return data;
    }
    if (type === 'gainers') {
      const tickers = ['SPY', 'SPX', 'MSTR', 'TSLA', 'QQQ', 'ORCL', 'UNH', 'NVDA', 'CRWV', 'COST', 'COIN', 'AVGO', 'META', 'NFLX', 'NDX', 'MU'];
      return tickers.map((t, i) => {
        const bullish = rng(i) * 17 + 0.5;
        const bearish = rng(i + 100) * 17 + 0.5;
        return {
          rank: i + 1, ticker: t,
          bullish: +bullish.toFixed(2),
          bearish: +bearish.toFixed(2),
          ratio: +(bullish / bearish).toFixed(2),
          volume: +(rng(i + 200) * 17e6).toFixed(0),
          tradeCount: +(rng(i + 300) * 100e3).toFixed(0),
          premium: +(rng(i + 400) * 850e6).toFixed(0),
        };
      });
    }
    if (type === 'market-map') {
      const sectors = [
        { name: 'Technology', tickers: ['NVDA', 'AAPL', 'MSFT', 'GOOG', 'GOOGL', 'META', 'AVGO', 'TSM'] },
        { name: 'Financial Services', tickers: ['VOO', 'JPM', 'SPY', 'V', 'IVV', 'VOO', 'BAC', 'MA'] },
        { name: 'Consumer Cyclical', tickers: ['AMZN', 'TSLA', 'HD', 'BABA', 'MCD'] },
        { name: 'Industrials', tickers: ['CAT', 'GE', 'BA'] },
        { name: 'Consumer Defensive', tickers: ['WMT', 'PG', 'KO'] },
        { name: 'Healthcare', tickers: ['LLY', 'JNJ', 'UNH'] },
        { name: 'Communication Services', tickers: ['NFLX', 'DIS', 'T'] },
        { name: 'Energy', tickers: ['XOM', 'CVX'] },
        { name: 'Utilities', tickers: ['NEE'] },
        { name: 'Basic Materials', tickers: ['LIN'] },
        { name: 'Real Estate', tickers: ['AMT'] },
      ];
      return sectors.map(sec => ({
        ...sec,
        tiles: sec.tickers.map((t, i) => ({
          ticker: t,
          change: +((rng(sec.name.length + i) - 0.5) * 6).toFixed(2),
        })),
      }));
    }
    if (type === 'news') {
      const items = [
        { headline: 'BlackBerry Sees Q4 Adj EPS $0.03-$0.05 vs $0.04 Est; Sees Sales $138.000M-$148.000M vs $143.393M Est', tags: ['News', 'Guidance'], ticker: 'BB, TSX:BB' },
        { headline: 'Cassava Sciences Received Formal Letter From FDA Confirming Proposed Clinical Trial Is On Full Clinical Hold', tags: ['News', 'General'], ticker: 'SAVA' },
        { headline: 'NIKE Says Our Sports Teams Are Quickly Finding The Rhythm In The New Sport Offense', tags: ['News'], ticker: 'NKE' },
        { headline: 'BlackBerry Q3 Adj. EPS $0.05 Beats $0.04 Estimate, Sales $141.800M Beat $137.398M Estimate', tags: ['Earnings', 'News', 'Slightly Bullish'], ticker: 'BB, TSX:BB' },
        { headline: "OpenAI's New Fundraising Round Could Value Startup at as Much As $830 Billion - WSJ", tags: ['News', 'General'], ticker: 'MSFT' },
        { headline: 'Pattern Group Acquires NextWave; Terms Not Disclosed', tags: ['News'], ticker: 'PTRN' },
        { headline: 'Adobe Teams Up With Runway To Deliver The Next Generation of AI Video for Creators', tags: ['News'], ticker: 'ADBE' },
        { headline: '$1000 Invested In Chipotle Mexican Grill 10 Years Ago Would Be Worth This Much Today', tags: ['News', 'Trading Ideas'], ticker: 'CMG' },
        { headline: 'Price Over Earnings Overview: Sherwin-Williams', tags: ['News', 'Intraday Update', 'Markets'], ticker: 'SHW' },
        { headline: 'Bitcoin Slides To $85,000 As Ethereum, XRP, Dogecoin Stare Into The Abyss', tags: ['Cryptocurrency', 'News'], ticker: '$BTC, $DOGE, $ETH, $SHIB, $SOL' },
      ];
      return items.map((it, i) => ({
        ...it,
        date: `Dec 18, 2025 at 5:0${i % 10} PM`,
      }));
    }
    if (type === 'vol-skew') {
      // Realistic option-chain expiries: weekly, monthly, quarterly,
      // LEAPS-style. Strike spacing wider for further-dated expiries
      // (more uncertainty, more $ moves), and IV term structure rises
      // with expiry per typical contango shape.
      const today = new Date();
      const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      // Find next Friday for weekly, then progressively further out
      const nextFriday = new Date(today);
      nextFriday.setDate(today.getDate() + ((5 - today.getDay() + 7) % 7 || 7));
      const expiryDates = [
        nextFriday,                                                   // Weekly
        new Date(nextFriday.getTime() + 14 * 24 * 60 * 60 * 1000),    // 2-week
        new Date(today.getFullYear(), today.getMonth() + 1, 15),      // Monthly
        new Date(today.getFullYear(), today.getMonth() + 3, 15),      // Quarterly
        new Date(today.getFullYear() + 1, today.getMonth(), 15),      // 1Y LEAPS
      ];
      const strikes = 20;
      const series = [];
      expiryDates.forEach((expDate, e) => {
        const dte = Math.max(1, Math.round((expDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)));
        // Strike width scales with sqrt(dte) per Black-Scholes intuition
        const widthPct = 0.15 + Math.sqrt(dte / 365) * 0.40;
        const points = [];
        for (let s = 0; s < strikes; s++) {
          const strike = Math.round(spot * (1 - widthPct / 2) + (s / strikes) * spot * widthPct);
          // Smile + term-structure: longer expiries have higher base IV
          const dist = Math.abs(strike - spot) / spot;
          const ivAtm = 16 + Math.sqrt(dte / 365) * 8; // contango term structure
          const skew = dist * dist * 800; // smile
          const ivJitter = (rng(e * 100 + s) - 0.5) * 4;
          points.push({ strike, iv: +Math.max(5, ivAtm + skew + ivJitter).toFixed(2) });
        }
        series.push({ expiry: fmtDate(expDate), dte, points });
      });
      return series;
    }
    return null;
  }, [type, instrument?.mark, instrument?.id, seed]);
};

// Sub-chart renderer — switches on type and renders the appropriate visualization.
const SubChart = ({ type, instrument, onClose }) => {
  const meta = SUBCHART_TYPES.find(t => t.id === type);
  const data = useSubChartData(type, instrument);
  const [seed] = useState(() => Math.floor(Math.random() * 1000));

  return (
    <div className="rounded-md border overflow-hidden flex flex-col"
         style={{ background: COLORS.surface, borderColor: COLORS.border, height: 320 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0"
           style={{ borderColor: COLORS.border, background: COLORS.bg }}>
        <div className="flex items-center gap-2">
          
          <span className="text-[12px] font-medium" style={{ color: COLORS.text }}>{meta?.label}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(61,123,255,0.08)', color: COLORS.mint }}>
            {instrument?.id}
          </span>
        </div>
        <button onClick={onClose}
                className="px-1.5 py-0.5 rounded text-[12px] hover:bg-white/[0.06]"
                style={{ color: COLORS.textMute }}
                title="Remove this sub-chart">
          ×
        </button>
      </div>
      {/* Body */}
      <div className="flex-1 min-h-0 p-2">
        {type === 'net-drift'    && <SubChartNetDrift     data={data} instrument={instrument} />}
        {type === 'heatmap'      && <SubChartHeatmap      data={data} instrument={instrument} />}
        {type === 'interval'     && <SubChartInterval     data={data} instrument={instrument} />}
        {type === 'vol-drift'    && <SubChartVolDrift     data={data} instrument={instrument} />}
        {type === 'net-flow'     && <SubChartNetFlow      data={data} instrument={instrument} />}
        {type === 'dark-flow'    && <SubChartDarkFlow     data={data} instrument={instrument} />}
        {type === 'gainers'      && <SubChartGainers      data={data} />}
        {type === 'market-map'   && <SubChartMarketMap    data={data} />}
        {type === 'news'         && <SubChartNews         data={data} />}
        {type === 'vol-skew'     && <SubChartVolSkew      data={data} instrument={instrument} />}
      </div>
      {/* Footer note */}
      <div className="px-3 py-1.5 border-t text-[9px] shrink-0"
           style={{ borderColor: COLORS.border, color: COLORS.textMute, background: COLORS.bg }}>
        {meta?.desc} · Illustrative data
      </div>
    </div>
  );
};

const SubChartNetDrift = ({ data, instrument }) => (
  <ResponsiveContainer width="100%" height="100%">
    <ComposedChart data={data} margin={{ top: 6, right: 38, left: -28, bottom: 0 }}>
      <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="time" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent" />
      <YAxis yAxisId="left" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent"
             tickFormatter={(v) => `${(v / 1).toFixed(0)}M`} />
      <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent"
             tickFormatter={(v) => `$${v.toFixed(0)}`} />
      <Tooltip contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.borderHi}`, borderRadius: 6, fontSize: 11 }} />
      <Line yAxisId="left" type="monotone" dataKey="calls" stroke={COLORS.chartOlive} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      <Line yAxisId="left" type="monotone" dataKey="puts"  stroke={COLORS.red} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      <Line yAxisId="right" type="monotone" dataKey="underlying" stroke={COLORS.chartCyan} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      <Legend verticalAlign="top" align="center" wrapperStyle={{ fontSize: 10, color: COLORS.textMute }} />
    </ComposedChart>
  </ResponsiveContainer>
);

const SubChartHeatmap = ({ data, instrument }) => {
  const allValues = data.flatMap(row => Object.entries(row).filter(([k]) => k !== 'strike').map(([_, v]) => v));
  const maxAbs = Math.max(...allValues.map(Math.abs), 1);
  return (
    <div className="h-full overflow-auto">
      <table className="imo-data-table w-full text-[8.5px] tabular-nums" style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {data.map(row => {
            const isATM = Math.abs(row.strike - instrument.mark) < instrument.mark * 0.001;
            return (
              <tr key={row.strike}>
                <td className="py-0.5 px-1 sticky left-0 text-right"
                    style={{
                      color: isATM ? COLORS.mint : COLORS.textDim,
                      background: COLORS.surface,
                      fontWeight: isATM ? 600 : 400,
                    }}>
                  ${row.strike}
                </td>
                {Object.entries(row).filter(([k]) => k !== 'strike').map(([k, v]) => {
                  const norm = v / maxAbs;
                  const isPos = v >= 0;
                  const intensity = Math.min(1, Math.abs(norm));
                  const bg = isPos
                    ? `rgba(31,178,107,${intensity * 0.7})`
                    : `rgba(237,112,136,${intensity * 0.7})`;
                  return (
                    <td key={k} className="px-0.5 py-0.5 text-center"
                        style={{ background: bg, color: intensity > 0.4 ? COLORS.text : COLORS.textDim, minWidth: 38 }}>
                      {Math.abs(v) > 1 ? `${v.toFixed(0)}M` : `${(v * 1000).toFixed(0)}K`}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const SubChartInterval = ({ data, instrument }) => {
  if (!data?.dots) return null;
  const maxX = 36, maxY = data.strikes.length;
  return (
    <svg className="w-full h-full">
      <defs>
        <pattern id="intgrid" width="3%" height="12%" patternUnits="userSpaceOnUse">
          <circle cx="50%" cy="50%" r="0.5" fill={COLORS.border} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#intgrid)" opacity="0.3" />
      {/* Strike axis */}
      {data.strikes.map((s, i) => (
        <text key={s} x="2" y={`${(i + 0.5) * 100 / maxY}%`}
              fill={COLORS.textMute} fontSize="8" textAnchor="start" alignmentBaseline="middle"
              style={{ fontFamily: 'ui-monospace, monospace' }}>
          ${s}
        </text>
      ))}
      {/* Dots */}
      {data.dots.map((d, i) => {
        const x = `${(d.x / maxX) * 92 + 5}%`;
        const yIdx = data.strikes.findIndex(s => s === d.y);
        const y = `${(yIdx + 0.5) * 100 / maxY}%`;
        const r = 2 + d.intensity * 5;
        return <circle key={i} cx={x} cy={y} r={r} fill={COLORS.green} fillOpacity={d.intensity * 0.85} />;
      })}
      {/* Underlying line — synth from middle strike */}
      <path d={(() => {
        let p = '';
        for (let i = 0; i < maxX; i++) {
          const xPos = (i / maxX) * 92 + 5;
          const yi = maxY / 2 + Math.sin(i / 4) * 1.5 + Math.cos(i / 6) * 0.8;
          const yPos = (yi + 0.5) * 100 / maxY;
          p += (i === 0 ? `M ${xPos}% ${yPos}%` : ` L ${xPos}% ${yPos}%`);
        }
        return p;
      })()} stroke={COLORS.chartCyan} strokeWidth="1.5" fill="none" />
    </svg>
  );
};

const SubChartVolDrift = ({ data, instrument }) => {
  const [selectedDate, setSelectedDate] = useState('today');
  const dateOptions = useMemo(() => {
    const out = [{ id: 'today', label: 'Today' }];
    const today = new Date();
    let added = 0;
    for (let i = 1; added < 7; i++) {
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
  const adjustedData = useMemo(() => {
    if (selectedDate === 'today') return data;
    if (!Array.isArray(data) || data.length === 0) return data;
    const seed = selectedDate.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return data.map((bar, i) => {
      const r = (n) => {
        const x = Math.sin((seed + i + n) * 12.9898) * 43758.5453;
        return x - Math.floor(x);
      };
      return {
        ...bar,
        iv: bar.iv != null ? +(bar.iv * (0.85 + r(1) * 0.30)).toFixed(2) : bar.iv,
        arv: bar.arv != null ? +(bar.arv * (0.85 + r(2) * 0.30)).toFixed(2) : bar.arv,
        underlying: bar.underlying != null ? +(bar.underlying * (1 + (r(3) - 0.5) * 0.04)).toFixed(2) : bar.underlying,
        fullDateTime: `${selectedDate} ${bar.time ?? ''}`,
      };
    });
  }, [data, selectedDate]);
  const dateLabel = adjustedData?.[0]?.fullDateTime?.split(' ').slice(0, 3).join(' ') ?? '';
  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-1.5 border-b flex items-center justify-between gap-2 text-[9.5px] shrink-0"
           style={{ borderColor: COLORS.border, background: COLORS.bg, color: COLORS.textMute }}>
        <span className="uppercase tracking-wider">Vol Drift · {dateLabel || 'today'}</span>
        <div className="flex items-center gap-2">
          <select value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="px-2 py-0.5 text-[10px] rounded outline-none"
                  style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                  title="View historical session">
            {dateOptions.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="w-2.5 h-0.5" style={{ background: COLORS.chartGold }} />IV</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-0.5" style={{ background: COLORS.chartPurple }} />ARV</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-0.5" style={{ background: COLORS.chartCyan }} />Spot</span>
          </span>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={adjustedData} margin={{ top: 6, right: 38, left: -28, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="time" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent" />
            <YAxis yAxisId="left" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent"
                   tickFormatter={(v) => `${v.toFixed(0)}%`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent"
                   tickFormatter={(v) => `$${v.toFixed(0)}`} />
            <Tooltip contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.borderHi}`, borderRadius: 6, fontSize: 11 }} />
            <Line yAxisId="left"  type="monotone" dataKey="iv"         stroke={COLORS.chartGold} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line yAxisId="left"  type="monotone" dataKey="arv"        stroke={COLORS.chartPurple} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line yAxisId="right" type="monotone" dataKey="underlying" stroke={COLORS.chartCyan} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const SubChartNetFlow = ({ data, instrument }) => {
  // Date selector — historical sessions to view. Today's data lives in
  // `data` already; switching dates re-seeds the bar values from the
  // chosen day so the user can scrub through recent sessions.
  const [selectedDate, setSelectedDate] = useState('today');
  const dateOptions = useMemo(() => {
    const out = [{ id: 'today', label: 'Today' }];
    const today = new Date();
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      // Skip weekends — markets closed
      const wd = d.getDay();
      if (wd === 0 || wd === 6) { i--; today.setDate(today.getDate() - 1); continue; }
      out.push({
        id: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      });
    }
    return out;
  }, []);
  // Re-shape the data based on selected date. For "today" we use the
  // upstream `data` array directly. For historical dates we re-seed the
  // values using the date string as a deterministic seed so each day
  // looks distinct but stable across renders.
  const adjustedData = useMemo(() => {
    if (selectedDate === 'today') return data;
    if (!Array.isArray(data) || data.length === 0) return data;
    const seed = selectedDate.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return data.map((bar, i) => {
      const r = (n) => {
        const x = Math.sin((seed + i + n) * 12.9898) * 43758.5453;
        return x - Math.floor(x);
      };
      const callMag = (bar.calls ?? 0) * (0.6 + r(1) * 0.8);
      const putMag = (bar.puts ?? 0) * (0.6 + r(2) * 0.8);
      const undMul = 1 + (r(3) - 0.5) * 0.04;
      return {
        ...bar,
        calls: +callMag.toFixed(2),
        puts: +putMag.toFixed(2),
        underlying: bar.underlying != null ? +(bar.underlying * undMul).toFixed(2) : bar.underlying,
        fullDateTime: `${selectedDate} ${bar.time ?? ''}`,
      };
    });
  }, [data, selectedDate]);

  const dateLabel = adjustedData?.[0]?.fullDateTime?.split(' ').slice(0, 3).join(' ') ?? '';
  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-1.5 border-b flex items-center justify-between gap-2 text-[9.5px] shrink-0"
           style={{ borderColor: COLORS.border, background: COLORS.bg, color: COLORS.textMute }}>
        <span className="uppercase tracking-wider">Net Flow · {dateLabel || 'today'}</span>
        <div className="flex items-center gap-2">
          <select value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="px-2 py-0.5 text-[10px] rounded outline-none"
                  style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                  title="View historical session">
            {dateOptions.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <span>5-min bars · 9:30a–4:00p ET</span>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={adjustedData} margin={{ top: 6, right: 38, left: -28, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="time" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent" />
            <YAxis yAxisId="left" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent"
                   tickFormatter={(v) => `$${v.toFixed(0)}M`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent"
                   tickFormatter={(v) => `$${v.toFixed(0)}`} />
            <Tooltip contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.borderHi}`, borderRadius: 6, fontSize: 11 }} />
            <Bar yAxisId="left" dataKey="calls" fill={COLORS.green} fillOpacity={0.8} isAnimationActive={false} />
            <Bar yAxisId="left" dataKey="puts"  fill={COLORS.red} fillOpacity={0.8} isAnimationActive={false} />
            <Line yAxisId="right" type="monotone" dataKey="underlying" stroke={COLORS.chartCyan} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Legend verticalAlign="top" align="center" wrapperStyle={{ fontSize: 10, color: COLORS.textMute }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const SubChartDarkFlow = ({ data, instrument }) => (
  <ResponsiveContainer width="100%" height="100%">
    <ComposedChart data={data} margin={{ top: 6, right: 38, left: -28, bottom: 0 }}>
      <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="time" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent" />
      <YAxis yAxisId="left" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent"
             tickFormatter={(v) => `$${v.toFixed(0)}M`} />
      <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent"
             tickFormatter={(v) => `$${v.toFixed(0)}`} />
      <Tooltip contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.borderHi}`, borderRadius: 6, fontSize: 11 }} />
      <Area yAxisId="left" type="monotone" dataKey="notional" stroke={COLORS.chartPurple} strokeWidth={1.5}
            fill="rgba(224,122,252,0.18)" isAnimationActive={false} />
      <Line yAxisId="right" type="monotone" dataKey="underlying" stroke={COLORS.chartCyan} strokeWidth={1.5} dot={false} isAnimationActive={false} />
    </ComposedChart>
  </ResponsiveContainer>
);

const SubChartGainers = ({ data }) => (
  <div className="h-full overflow-auto">
    <table className="imo-data-table w-full text-[10px] tabular-nums">
      <thead className="sticky top-0" style={{ background: COLORS.bg }}>
        <tr style={{ color: COLORS.textMute }}>
          <th className="px-2 py-1 text-left">Rank</th>
          <th className="px-2 py-1 text-left">Ticker</th>
          <th className="px-2 py-1 text-right">Bearish</th>
          <th className="px-2 py-1 text-right">Bullish</th>
          <th className="px-2 py-1 text-right">Vol</th>
          <th className="px-2 py-1 text-right">Premium</th>
        </tr>
      </thead>
      <tbody>
        {data.map(r => (
          <tr key={r.ticker} className="border-b" style={{ borderColor: COLORS.border, color: COLORS.text }}>
            <td className="px-2 py-1">{r.rank}</td>
            <td className="px-2 py-1 font-medium">{r.ticker}</td>
            <td className="px-2 py-1 text-right">
              <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(237,112,136,0.18)', color: '#FF9AAD' }}>
                ${r.bearish.toFixed(2)}M
              </span>
            </td>
            <td className="px-2 py-1 text-right">
              <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(31,178,107,0.18)', color: '#69D7A1' }}>
                ${r.bullish.toFixed(2)}M
              </span>
            </td>
            <td className="px-2 py-1 text-right" style={{ color: COLORS.textDim }}>
              {(r.volume / 1e6).toFixed(2)}M
            </td>
            <td className="px-2 py-1 text-right" style={{ color: COLORS.textDim }}>
              ${(r.premium / 1e6).toFixed(2)}M
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const SubChartMarketMap = ({ data }) => {
  // Treemap-like layout: each sector gets a horizontal block, tiles inside
  return (
    <div className="h-full grid grid-cols-3 gap-0.5 text-[8px]">
      {data.slice(0, 3).map(sec => (
        <div key={sec.name} className="flex flex-col">
          <div className="px-1 py-0.5 text-[8px] font-medium uppercase tracking-wider"
               style={{ background: '#1A3A6C', color: '#FFF' }}>
            {sec.name}
          </div>
          <div className="flex-1 grid grid-cols-2 gap-0.5">
            {sec.tiles.slice(0, 6).map(tile => {
              const isPos = tile.change >= 0;
              const intensity = Math.min(1, Math.abs(tile.change) / 4);
              const bg = isPos
                ? `rgba(31,178,107,${0.3 + intensity * 0.5})`
                : `rgba(237,112,136,${0.3 + intensity * 0.5})`;
              return (
                <div key={tile.ticker}
                     className="flex flex-col items-center justify-center p-1 text-center"
                     style={{ background: bg }}>
                  <div className="font-bold text-[10px]" style={{ color: '#FFF' }}>{tile.ticker}</div>
                  <div className="text-[9px]" style={{ color: '#FFF', opacity: 0.85 }}>
                    {isPos ? '+' : ''}{tile.change.toFixed(2)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

const SubChartNews = ({ data }) => {
  // Apple News-style row layout: small left-side thumbnail, multi-line
  // headline next to it, source + ticker + tags on a tight meta row
  // beneath. Thumbnails are derived from the headline's first letter
  // colored by the lead tag — no external image dependency, but each
  // story still gets a distinct visual anchor.
  // Tag colors map to the chart palette so they read as semantically
  // categorized rather than arbitrary.
  const tagColor = (t) => {
    const m = {
      'News':              '#7AC8FF',
      'Earnings':          '#A0C476',
      'Slightly Bullish':  '#1FB26B',
      'Bullish':           '#1FB26B',
      'Bearish':           '#E63E5C',
      'Slightly Bearish':  '#E63E5C',
      'Cryptocurrency':    '#FFB84D',
      'Trading Ideas':     '#E07AFC',
      'Markets':           '#FF7AB6',
      'Intraday Update':   '#FFD24A',
      'Guidance':          '#FFD24A',
      'General':           '#8A93A6',
    };
    return m[t] ?? '#7AC8FF';
  };
  return (
    <div className="h-full overflow-y-auto">
      {data.map((it, i) => {
        const leadTag = it.tags?.[0] ?? 'News';
        const accent = tagColor(leadTag);
        const initial = it.ticker?.replace(/^\$/, '').split(/[,\s]/)[0]?.charAt(0) ?? 'N';
        return (
          <div key={i}
               className="flex gap-3 px-2 py-2.5 border-b cursor-pointer hover:bg-white/[0.02] transition-colors"
               style={{ borderColor: COLORS.border }}>
            {/* Thumbnail — gradient block with the ticker initial.
                Sized to match Apple News' compact list-row thumb. */}
            <div className="rounded-md flex items-center justify-center shrink-0"
                 style={{
                   width: 56, height: 56,
                   background: `linear-gradient(135deg, ${accent}33 0%, ${accent}11 100%)`,
                   border: `1px solid ${accent}33`,
                 }}>
              <span style={{
                fontSize: 22,
                fontWeight: 800,
                color: accent,
                letterSpacing: '-0.04em',
              }}>{initial}</span>
            </div>
            <div className="flex-1 min-w-0">
              {/* Source line (lead tag styled like Apple's source label) */}
              <div className="text-[9.5px] uppercase tracking-wider font-semibold mb-0.5"
                   style={{ color: accent, letterSpacing: '0.06em' }}>
                {leadTag}
              </div>
              {/* Headline — clamped to 3 lines */}
              <div className="text-[12px] leading-snug font-medium"
                   style={{
                     color: COLORS.text,
                     display: '-webkit-box',
                     WebkitLineClamp: 3,
                     WebkitBoxOrient: 'vertical',
                     overflow: 'hidden',
                   }}>
                {it.headline}
              </div>
              {/* Meta row */}
              <div className="flex items-center gap-2 mt-1 text-[9.5px]"
                   style={{ color: COLORS.textMute }}>
                <span className="font-medium" style={{ color: COLORS.mint }}>{it.ticker}</span>
                <span>·</span>
                <span>{it.date}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const SubChartVolSkew = ({ data, instrument }) => {
  // Line chart with one line per expiry — flatten data
  const allStrikes = Array.from(new Set(data.flatMap(s => s.points.map(p => p.strike)))).sort((a, b) => a - b);
  const flat = allStrikes.map(strike => {
    const row = { strike };
    data.forEach(s => {
      const pt = s.points.find(p => p.strike === strike);
      if (pt) row[s.expiry] = pt.iv;
    });
    return row;
  });
  const colors = ['#A0C476', '#7AC8FF', '#FFD24A', '#FF7AB6', '#E07AFC'];
  return (
    <div className="h-full flex flex-col">
      {/* Date strip — shows each expiry with its DTE so user can see
          which line corresponds to which expiry without hovering. */}
      <div className="px-3 py-1.5 border-b flex items-center gap-3 flex-wrap text-[9.5px] shrink-0"
           style={{ borderColor: COLORS.border, background: COLORS.bg }}>
        <span className="uppercase tracking-wider" style={{ color: COLORS.textMute }}>Expiries:</span>
        {data.map((s, i) => (
          <span key={s.expiry} className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 inline-block" style={{ background: colors[i % colors.length] }} />
            <span style={{ color: COLORS.text }}>{s.expiry}</span>
            <span className="tabular-nums" style={{ color: COLORS.textMute }}>({s.dte}d)</span>
          </span>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={flat} margin={{ top: 6, right: 8, left: -28, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.border} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="strike" tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent"
                   tickFormatter={(v) => `$${v}`} />
            <YAxis tick={{ fill: COLORS.textMute, fontSize: 9 }} stroke="transparent"
                   tickFormatter={(v) => `${v.toFixed(0)}%`} />
            <Tooltip contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.borderHi}`, borderRadius: 6, fontSize: 11 }} />
            <ReferenceLine x={allStrikes.reduce((c, s) => Math.abs(s - instrument.mark) < Math.abs(c - instrument.mark) ? s : c, allStrikes[0])}
                           stroke={COLORS.chartCyan} strokeDasharray="3 3" strokeOpacity={0.6} />
            {data.map((s, i) => (
              <Line key={s.expiry} type="monotone" dataKey={s.expiry} stroke={colors[i % colors.length]}
                    strokeWidth={1.5} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// Main wrapper — main Chart at top, sub-charts below as a horizontal scroll grid
export const ChartWithSubcharts = ({ instrument, livePrice, instanceId, user, account }) => {
  // isCompact + showToolbar: in the original monolith these were
  // latent references to chart-page.jsx's local useState. Because of
  // single-file scope they never threw at module-load time but would
  // have ReferenceError'd at render. Defining them locally here
  // matches the monolith's defaults (false / true).
  const isCompact = false;
  const [showToolbar, setShowToolbar] = useState(() => {
    try { return localStorage.getItem('imo_chart_toolbar_visible') !== '0'; }
    catch { return true; }
  });
  /** @typedef {{ id: string, type: string }} SubChartEntry */
  const [subcharts, setSubcharts] = useState(/** @type {SubChartEntry[]} */ ([]));
  const [picker, setPicker] = useState(false);
  // Active page: 0 = main chart, 1..N = sub-charts
  const [pageIdx, setPageIdx] = useState(0);

  // Per-instance pinned instrument — when a user stacks multiple chart
  // widgets they often want each pane locked to its own ticker (BTC vs
  // ETH, AAPL vs NVDA). Without this every chart follows the global
  // "active" instrument and they all show the same thing. The pin
  // toggle in the header locks the chart to whatever ticker it's
  // currently displaying. Pinned state lives in localStorage keyed by
  // instanceId so the layout survives a refresh. When unpinned, the
  // chart reverts to following the prop.
  const PIN_KEY = instanceId ? `imo_chart_pin_${instanceId}` : null;
  const [pinnedId, setPinnedId] = useState(() => {
    if (!PIN_KEY) return null;
    try { return localStorage.getItem(PIN_KEY); } catch { return null; }
  });
  // Show a quick "ticker picker" overlay when the user clicks a pinned
  // chart's label — same dropdown they use elsewhere.
  const [showPinPicker, setShowPinPicker] = useState(false);
  const pinnedInstrument = useMemo(() => {
    if (!pinnedId) return null;
    if (typeof INSTRUMENTS === 'undefined') return null;
    return INSTRUMENTS.find(i => i.id === pinnedId) ?? null;
  }, [pinnedId]);
  // The "effective" instrument is what the chart actually renders. If the
  // user pinned this pane to a specific ticker, that wins; otherwise we
  // follow the prop. We fall back to the prop if the pinned ticker isn't
  // resolvable (e.g. the catalog changed and the stored id is now stale).
  const effInstrument = pinnedInstrument ?? instrument;
  const togglePin = () => {
    if (!PIN_KEY) return;
    if (pinnedId) {
      // Unpin — chart starts following the prop again.
      try { localStorage.removeItem(PIN_KEY); } catch {}
      setPinnedId(null);
    } else {
      // Pin to whatever we're currently showing.
      try { localStorage.setItem(PIN_KEY, instrument.id); } catch {}
      setPinnedId(instrument.id);
    }
  };
  const setPinTo = (newId) => {
    if (!PIN_KEY) return;
    try { localStorage.setItem(PIN_KEY, newId); } catch {}
    setPinnedId(newId);
    setShowPinPicker(false);
  };
  // Open the per-chart picker when the toolbar's small magnifier icon
  // fires its event. We match by instanceId so a global event only
  // hits the right chart pane in a stacked layout.
  useEffect(() => {
    if (!instanceId) return;
    const handler = (e) => {
      if (e?.detail?.instanceId === instanceId) setShowPinPicker(true);
    };
    window.addEventListener('imo:open-chart-picker', handler);
    return () => window.removeEventListener('imo:open-chart-picker', handler);
  }, [instanceId]);

  const addSubchart = (type) => {
    setSubcharts(prev => {
      const next = [...prev, { id: `sc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, type }];
      // Auto-jump to the newly added chart
      setPageIdx(next.length); // main is 0, new sub at length
      return next;
    });
    setPicker(false);
  };
  const removeSubchart = (id) => {
    setSubcharts(prev => {
      const next = prev.filter(s => s.id !== id);
      // If we removed the chart we were viewing, fall back to main
      if (pageIdx > next.length) setPageIdx(next.length);
      return next;
    });
  };

  const totalPages = 1 + subcharts.length;
  const goPrev = () => setPageIdx(i => Math.max(0, i - 1));
  const goNext = () => setPageIdx(i => Math.min(totalPages - 1, i + 1));

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 relative overflow-hidden"
         style={{
           // Liquid glass styling: subtle border + soft shadow + slight rounding
           // applied to the outermost chart container so the entire chart sits
           // on a "glass card" instead of bleeding edge-to-edge.
           borderRadius: 16,
           border: `1px solid ${COLORS.border}`,
           background: COLORS.surface,
           boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 1px 0 rgba(255,255,255,0.04) inset',
           margin: 8,
         }}>
      {/* Page indicator + nav (only when sub-charts exist) */}
      {subcharts.length > 0 && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b shrink-0"
             style={{ borderColor: COLORS.border, background: COLORS.bg }}>
          <div className="flex items-center gap-2">
            <button onClick={() => setPageIdx(0)}
                    className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
                    style={{
                      background: pageIdx === 0 ? COLORS.surface : 'transparent',
                      color: pageIdx === 0 ? COLORS.text : COLORS.textDim,
                      border: `1px solid ${pageIdx === 0 ? COLORS.mint : 'transparent'}`,
                    }}
                    title="Main price chart">
              {effInstrument.id}
            </button>
            {subcharts.map((s, i) => {
              const meta = SUBCHART_TYPES.find(t => t.id === s.type);
              const idx = i + 1;
              const isActive = pageIdx === idx;
              return (
                <div key={s.id} className="flex items-center gap-0.5">
                  <button onClick={() => setPageIdx(idx)}
                          className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
                          style={{
                            background: isActive ? COLORS.surface : 'transparent',
                            color: isActive ? COLORS.text : COLORS.textDim,
                            border: `1px solid ${isActive ? COLORS.mint : 'transparent'}`,
                          }}>
                    {meta?.label}
                  </button>
                  {isActive && (
                    <button onClick={() => removeSubchart(s.id)}
                            className="px-1.5 py-1 rounded text-[11px] hover:bg-white/[0.05]"
                            style={{ color: COLORS.textMute }}
                            title="Close this chart">×</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={goPrev}
                    disabled={pageIdx === 0}
                    className="w-6 h-6 rounded text-[11px] disabled:opacity-30 hover:bg-white/[0.05]"
                    style={{ color: COLORS.textDim }}>
              ‹
            </button>
            <span className="text-[10px] tabular-nums" style={{ color: COLORS.textMute }}>
              {pageIdx + 1} / {totalPages}
            </span>
            <button onClick={goNext}
                    disabled={pageIdx >= totalPages - 1}
                    className="w-6 h-6 rounded text-[11px] disabled:opacity-30 hover:bg-white/[0.05]"
                    style={{ color: COLORS.textDim }}>
              ›
            </button>
          </div>
        </div>
      )}

      {/* Pin toggle — bottom-left corner, always visible. When pinned the
          chart locks to its current ticker so a stacked chart pane can
      {/* Pin badge — moved to TOP CENTER of the chart per UX request.
          Was bottom-left, but the user feedback was that the BTC-PERP
          pin badge and the search trigger felt buried in the corner;
          centering them along the top edge makes them act like a
          chart-instance "title bar" — they describe what's in the
          chart and let you change it, which fits the natural reading
          flow (top → look at title → look at chart). */}
      {instanceId && (
        <div className="absolute z-30 flex items-center gap-1 left-1/2 -translate-x-1/2"
             style={{ bottom: 8 }}>
          <button onClick={togglePin}
                  className="px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-all flex items-center gap-1.5"
                  style={{
                    background: pinnedId ? `${COLORS.mint}1F` : 'rgba(0,0,0,0.55)',
                    color: pinnedId ? COLORS.mint : COLORS.text,
                    border: `1px solid ${pinnedId ? COLORS.mint + '88' : 'rgba(255,255,255,0.10)'}`,
                    backdropFilter: 'blur(8px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(8px) saturate(160%)',
                  }}
                  title={pinnedId
                    ? `Pinned to ${pinnedId} · click to unpin and follow the active ticker`
                    : `Pin this chart to ${instrument.id} so it stays put when other widgets change ticker`}>
            <svg width="11" height="13" viewBox="0 0 9 11" fill="currentColor">
              <path d="M4.5 0L6 2.5L8 3v1.5L6 5L4.5 11L3 5L1 4.5V3L3 2.5z"
                    opacity={pinnedId ? 1 : 0.55} />
            </svg>
            {pinnedId ?? 'pin'}
          </button>
          {/* Click pinned badge again to swap to a different ticker without unpinning */}
          {pinnedId && (
            <button onClick={() => setShowPinPicker(s => !s)}
                    className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center transition-all"
                    style={{
                      background: 'rgba(0,0,0,0.45)',
                      color: COLORS.mint,
                      border: `1px solid ${COLORS.mint}55`,
                      backdropFilter: 'blur(8px)',
                    }}
                    title="Change pinned ticker">⇅</button>
          )}
          {/* Hide / Show indicator-toolbar button — moved here from
              the right end of the indicator toolbar per UX feedback.
              Sits next to the pin badge so the two chart-overlay
              controls live in the same visual cluster. Same liquid
              glass styling as the pin so they read as a pair. The
              chevron flips ⌃/⌄ to indicate hide vs show. */}
          {!isCompact && (
            <button onClick={() => {
                      const next = !showToolbar;
                      setShowToolbar(next);
                      try { localStorage.setItem('imo_chart_toolbar_visible', next ? '1' : '0'); } catch {}
                    }}
                    className="px-2 py-1 rounded-full text-[10.5px] font-medium transition-all flex items-center gap-1"
                    style={{
                      background: 'rgba(0,0,0,0.55)',
                      color: COLORS.textDim,
                      border: '1px solid rgba(255,255,255,0.10)',
                      backdropFilter: 'blur(8px) saturate(160%)',
                      WebkitBackdropFilter: 'blur(8px) saturate(160%)',
                    }}
                    title={showToolbar
                      ? 'Hide the indicator toolbar (saves space)'
                      : 'Show the indicator toolbar'}>
              <span style={{ fontSize: 11 }}>{showToolbar ? '⌃' : '⌄'}</span>
              {showToolbar ? 'Hide' : 'Indicators'}
            </button>
          )}
        </div>
      )}
      {/* Pin picker overlay — rendered independently of the pinned-state
          chevron so the toolbar's per-chart search icon (which dispatches
          imo:open-chart-picker) opens the dropdown even when the chart
          has never been pinned yet. Previously this lived inside the
          {pinnedId && ...} block, so the search icon did nothing on
          unpinned charts. Picking a ticker calls setPinTo which both
          pins AND closes the picker, so the user gets a one-click
          "search and switch" without having to learn the pin model. */}
      {instanceId && showPinPicker && (
        <>
          {/* Backdrop — click outside the picker closes it. The picker
              itself is positioned over the pin badge so clicks inside
              propagate normally. */}
          <div className="absolute inset-0 z-30"
               onClick={() => setShowPinPicker(false)}
               style={{ background: 'transparent' }} />
          <div className="absolute z-40 rounded-lg shadow-xl py-1 max-h-72 overflow-y-auto left-1/2 -translate-x-1/2"
               style={{
                 // Pin badge is at bottom of chart — open the picker
                 // ABOVE it so it doesn't run off the chart frame.
                 bottom: 40,
                 background: COLORS.surface,
                 border: `1px solid ${COLORS.borderHi}`,
                 minWidth: 200,
               }}>
            <div className="px-3 py-1.5 text-[9.5px] uppercase tracking-wider border-b"
                 style={{ color: COLORS.textMute, borderColor: COLORS.border }}>
              Pin this chart to a ticker
            </div>
            {(typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS : []).map(inst => (
              <button key={inst.id}
                      onClick={() => setPinTo(inst.id)}
                      className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-white/[0.05] flex items-center justify-between"
                      style={{ color: inst.id === pinnedId ? COLORS.mint : COLORS.text }}>
                <span>{inst.id}</span>
                <span className="text-[9px]" style={{ color: COLORS.textMute }}>{inst.cls}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Active chart area — main chart at index 0, sub-charts thereafter, full area each */}
      <div className="flex-1 min-h-0 flex flex-col">
        {pageIdx === 0 ? (
          <Chart instrument={effInstrument} livePrice={livePrice} instanceId={instanceId}
                 subcharts={subcharts} setSubcharts={setSubcharts}
                 pageIdx={pageIdx} setPageIdx={setPageIdx}
                 user={user} account={account} />
        ) : (
          (() => {
            const sc = subcharts[pageIdx - 1];
            return sc ? (
              <SubChartFull type={sc.type} instrument={effInstrument}
                            onClose={() => removeSubchart(sc.id)} />
            ) : null;
          })()
        )}
      </div>

      {/* Floating + button — small, bottom-right */}
      <button onClick={() => setPicker(true)}
              className="absolute z-20 rounded-full flex items-center justify-center transition-all shadow-lg"
              style={{
                bottom: 12,
                right: 16,
                width: 26,
                height: 26,
                background: COLORS.mint,
                color: COLORS.bg,
                fontSize: 14,
                fontWeight: 600,
              }}
              title="Add a sub-chart">
        +
      </button>
      {/* Picker modal */}
      {picker && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setPicker(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="rounded-md border overflow-hidden flex flex-col pointer-events-auto"
                 style={{
                   background: COLORS.surface,
                   borderColor: COLORS.borderHi,
                   width: 720, maxWidth: '95vw', maxHeight: '85vh',
                   boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                 }}>
              <div className="flex items-center justify-between px-5 py-3 border-b shrink-0"
                   style={{ borderColor: COLORS.border }}>
                <div>
                  <div className="text-[14px] font-medium" style={{ color: COLORS.text }}>
                    Add chart
                  </div>
                  <div className="text-[11px]" style={{ color: COLORS.textMute }}>
                    The new chart will take over the chart area. Switch between charts using the tabs at top.
                  </div>
                </div>
                <button onClick={() => setPicker(false)}
                        className="px-2 py-1 rounded text-[14px] hover:bg-white/[0.06]"
                        style={{ color: COLORS.textMute }}>
                  ×
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 p-4 overflow-y-auto">
                {SUBCHART_TYPES.map(t => (
                  <button key={t.id}
                          onClick={() => addSubchart(t.id)}
                          className="text-left p-3 rounded-md border transition-colors hover:bg-white/[0.04]"
                          style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                    <div className="flex items-center gap-2 mb-1">
                      
                      <span className="text-[12.5px] font-medium" style={{ color: COLORS.text }}>{t.label}</span>
                    </div>
                    <div className="text-[10.5px] leading-snug" style={{ color: COLORS.textMute }}>{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// Full-area version of SubChart for the multi-chart trade view.
export const SubChartFull = ({ type, instrument, onClose }) => {
  const meta = SUBCHART_TYPES.find(t => t.id === type);
  const data = useSubChartData(type, instrument);
  return (
    <div className="flex-1 min-h-0 flex flex-col" style={{ background: COLORS.bg }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0"
           style={{ borderColor: COLORS.border }}>
        <div className="flex items-center gap-2">
          
          <span className="text-[13px] font-medium" style={{ color: COLORS.text }}>{meta?.label}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(61,123,255,0.08)', color: COLORS.mint }}>
            {instrument?.id}
          </span>
        </div>
        <div className="text-[10px]" style={{ color: COLORS.textMute }}>
          {meta?.desc} · Illustrative data
        </div>
      </div>
      {/* Body — fills full chart area */}
      <div className="flex-1 min-h-0 p-4">
        {type === 'net-drift'    && <SubChartNetDrift     data={data} instrument={instrument} />}
        {type === 'heatmap'      && <SubChartHeatmap      data={data} instrument={instrument} />}
        {type === 'interval'     && <SubChartInterval     data={data} instrument={instrument} />}
        {type === 'vol-drift'    && <SubChartVolDrift     data={data} instrument={instrument} />}
        {type === 'net-flow'     && <SubChartNetFlow      data={data} instrument={instrument} />}
        {type === 'dark-flow'    && <SubChartDarkFlow     data={data} instrument={instrument} />}
        {type === 'gainers'      && <SubChartGainers      data={data} />}
        {type === 'market-map'   && <SubChartMarketMap    data={data} />}
        {type === 'news'         && <SubChartNews         data={data} />}
        {type === 'vol-skew'     && <SubChartVolSkew      data={data} instrument={instrument} />}
      </div>
    </div>
  );
};
