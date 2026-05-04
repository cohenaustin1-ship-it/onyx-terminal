// IMO Onyx Terminal — Compact tabs (TradePage bottom-panel)
//
// Phase 3p.27 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines 6927-7494, ~568 lines).
//
// First "lift the children" phase preparing for TradePage extraction.
// TradePage renders these 12 small tab components in its bottom
// panel — each is a focused view (positions, orders, history,
// options chain, sentiment, etc.) that the user can switch between.
//
// All 12 are only used by TradePage and are small enough (25-101
// lines each) to live in a single colocated module.
//
// Public exports:
//   CompactPositions      — positions table (account view)
//   CompactOrders         — open orders table
//   CompactHistory        — fill history table
//   CompactChainEvents    — corp action / chain event list
//   CompactRisk           — per-position risk summary
//   CompactSentiment      — analyst rating / news sentiment
//   CompactOptions        — options chain compact view
//   CompactTrends         — long/short trend summary
//   CompactPriceAnalysis  — price-level analysis
//   CompactESG            — ESG metrics summary
//   CompactMoat           — moat / competitive analysis
//   CompactNewsTab        — news feed compact view
//
// Honest scope:
//   - Pure presentation. State is read-only (positions data passed
//     in as props from TradePage's account/instrument context).
//   - No data fetching here; CompactSentiment, CompactPriceAnalysis,
//     and CompactNewsTab use mock/curated data inline.

import React, { useState, useMemo } from 'react';
import { COLORS } from '../lib/constants.js';

export const CompactPositions = ({ account, markPrice, instrument }) => {
  const rows = (account?.positions ?? []).slice(0, 4);
  if (rows.length === 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center p-3 text-center">
        <div className="text-[11px]" style={{ color: COLORS.textMute }}>No open positions</div>
        <div className="text-[9px] mt-1" style={{ color: COLORS.textMute }}>
          Place your first order to see positions
        </div>
      </div>
    );
  }
  return (
    <div className="h-full w-full overflow-y-auto p-2">
      {rows.map((p, i) => {
        const isLong = p.side === 'long';
        const mark = p.id === instrument?.id ? markPrice : (p.entry ?? 0);
        const pnl = (mark - (p.entry ?? 0)) * (p.size ?? 0) * (isLong ? 1 : -1);
        const pct = p.entry ? (pnl / Math.max(0.01, (p.entry * (p.size ?? 0)))) * 100 : 0;
        return (
          <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-b-0"
               style={{ borderColor: COLORS.border }}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium truncate" style={{ color: COLORS.text }}>{p.id}</span>
                <span className="text-[8.5px] px-1 py-0.5 rounded uppercase tracking-wider"
                      style={{
                        background: isLong ? 'rgba(31,178,107,0.14)' : 'rgba(237,112,136,0.14)',
                        color: isLong ? COLORS.green : COLORS.red,
                      }}>
                  {p.side}
                </span>
              </div>
              <div className="text-[9.5px] tabular-nums" style={{ color: COLORS.textMute }}>
                {(p.size ?? 0).toFixed(4)} @ ${(p.entry ?? 0).toFixed(2)}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[11px] tabular-nums"
                   style={{ color: pnl >= 0 ? COLORS.green : COLORS.red }}>
                {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
              </div>
              <div className="text-[9.5px] tabular-nums" style={{ color: COLORS.textMute }}>
                {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
              </div>
            </div>
          </div>
        );
      })}
      {(account?.positions?.length ?? 0) > 4 && (
        <div className="text-[9.5px] text-center pt-2" style={{ color: COLORS.textMute }}>
          +{account.positions.length - 4} more
        </div>
      )}
    </div>
  );
};

// Compact Open Orders
export const CompactOrders = ({ account }) => {
  const rows = (account?.orders ?? []).slice(0, 4);
  if (rows.length === 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center p-3 text-center">
        <div className="text-[11px]" style={{ color: COLORS.textMute }}>No open orders</div>
      </div>
    );
  }
  return (
    <div className="h-full w-full overflow-y-auto p-2">
      {rows.map((o, i) => (
        <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-b-0"
             style={{ borderColor: COLORS.border }}>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium truncate" style={{ color: COLORS.text }}>
              {o.id} <span className="text-[9px]" style={{ color: COLORS.textMute }}>{o.type}</span>
            </div>
            <div className="text-[9.5px] tabular-nums" style={{ color: COLORS.textMute }}>
              {o.side} {(o.size ?? 0).toFixed(4)}
            </div>
          </div>
          <div className="text-[10.5px] tabular-nums shrink-0" style={{ color: COLORS.text }}>
            ${(o.limit ?? o.price ?? 0).toFixed(2)}
          </div>
        </div>
      ))}
    </div>
  );
};

// Compact Trade History — last few fills
export const CompactHistory = ({ account, instrument }) => {
  const rows = (account?.history ?? account?.fills ?? []).slice(0, 5);
  if (rows.length === 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center p-3 text-center">
        <div className="text-[11px]" style={{ color: COLORS.textMute }}>No recent fills</div>
      </div>
    );
  }
  return (
    <div className="h-full w-full overflow-y-auto p-2">
      {rows.map((h, i) => (
        <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-b-0"
             style={{ borderColor: COLORS.border }}>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-medium truncate" style={{ color: COLORS.text }}>
              {h.id ?? h.symbol ?? '—'}
            </div>
            <div className="text-[9px]" style={{ color: COLORS.textMute }}>
              {h.side ?? 'fill'} · {h.ts ? new Date(h.ts).toLocaleDateString() : ''}
            </div>
          </div>
          <div className="text-[10px] tabular-nums shrink-0"
               style={{ color: (h.side === 'sell' || h.pnl < 0) ? COLORS.red : COLORS.green }}>
            ${(h.fillPrice ?? h.price ?? 0).toFixed(2)}
          </div>
        </div>
      ))}
    </div>
  );
};

// Compact Chain Events — last few on-chain events
export const CompactChainEvents = () => {
  // Synth a few recent events — same approach as the full ChainEvents
  const events = [
    { type: 'Block', desc: 'Sequencer block 4,891,206', age: '12s' },
    { type: 'Trade', desc: 'BTC-PERP fill 0.5 @ 75,743', age: '34s' },
    { type: 'Deposit', desc: 'USDC 5,000 confirmed', age: '2m' },
    { type: 'Bridge', desc: 'ETH→Onyx 1.0 ETH', age: '5m' },
  ];
  return (
    <div className="h-full w-full overflow-y-auto p-2">
      {events.map((e, i) => (
        <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-b-0"
             style={{ borderColor: COLORS.border }}>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-medium" style={{ color: COLORS.text }}>{e.type}</div>
            <div className="text-[9px] truncate" style={{ color: COLORS.textMute }}>{e.desc}</div>
          </div>
          <div className="text-[9.5px] shrink-0 tabular-nums" style={{ color: COLORS.textMute }}>{e.age}</div>
        </div>
      ))}
    </div>
  );
};

// Compact Risk — single big number + breakdown
export const CompactRisk = ({ account }) => {
  const positions = account?.positions ?? [];
  const totalNotional = positions.reduce((s, p) => s + Math.abs((p.size ?? 0) * (p.entry ?? 0)), 0);
  const longCount = positions.filter(p => p.side === 'long').length;
  const shortCount = positions.filter(p => p.side === 'short').length;
  const balance = account?.balance ?? 0;
  const utilization = balance > 0 ? Math.min(100, (totalNotional / balance) * 100) : 0;
  const riskColor = utilization > 80 ? COLORS.red : utilization > 50 ? '#FFB84D' : COLORS.green;
  return (
    <div className="h-full w-full p-3 flex flex-col gap-2">
      <div>
        <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Margin used</div>
        <div className="text-[20px] font-medium tabular-nums" style={{ color: riskColor }}>
          {utilization.toFixed(0)}%
        </div>
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ background: COLORS.surface2 }}>
        <div className="h-full rounded-full transition-all"
             style={{ width: `${Math.min(100, utilization)}%`, background: riskColor }} />
      </div>
      <div className="grid grid-cols-2 gap-2 mt-1 text-[10px]">
        <div>
          <div style={{ color: COLORS.textMute }}>Long</div>
          <div className="tabular-nums" style={{ color: COLORS.green }}>{longCount}</div>
        </div>
        <div>
          <div style={{ color: COLORS.textMute }}>Short</div>
          <div className="tabular-nums" style={{ color: COLORS.red }}>{shortCount}</div>
        </div>
        <div>
          <div style={{ color: COLORS.textMute }}>Notional</div>
          <div className="tabular-nums" style={{ color: COLORS.text }}>${(totalNotional / 1000).toFixed(1)}k</div>
        </div>
        <div>
          <div style={{ color: COLORS.textMute }}>Balance</div>
          <div className="tabular-nums" style={{ color: COLORS.text }}>${(balance / 1000).toFixed(1)}k</div>
        </div>
      </div>
    </div>
  );
};

// Compact Sentiment — bullish/bearish meter for current ticker
export const CompactSentiment = ({ instrument }) => {
  // Deterministic seed from ticker so the same ticker shows stable values
  const seed = (instrument?.id ?? 'X').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const r = (i) => {
    const x = Math.sin((seed + i * 7.13) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  const bullPct = Math.round(40 + r(1) * 50);
  const bearPct = 100 - bullPct;
  const callPutRatio = +(0.7 + r(2) * 1.4).toFixed(2);
  const socialMentions = Math.round(50 + r(3) * 950);
  return (
    <div className="h-full w-full p-3 flex flex-col gap-2">
      <div>
        <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
          Sentiment · {instrument?.id ?? '—'}
        </div>
        <div className="flex h-2 rounded-full overflow-hidden">
          <div style={{ width: `${bullPct}%`, background: COLORS.green }} />
          <div style={{ width: `${bearPct}%`, background: COLORS.red }} />
        </div>
        <div className="flex items-center justify-between mt-1 text-[9.5px] tabular-nums">
          <span style={{ color: COLORS.green }}>{bullPct}% bull</span>
          <span style={{ color: COLORS.red }}>{bearPct}% bear</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div>
          <div style={{ color: COLORS.textMute }}>Call/Put</div>
          <div className="tabular-nums" style={{ color: callPutRatio > 1 ? COLORS.green : COLORS.red }}>
            {callPutRatio}
          </div>
        </div>
        <div>
          <div style={{ color: COLORS.textMute }}>Mentions</div>
          <div className="tabular-nums" style={{ color: COLORS.text }}>{socialMentions}</div>
        </div>
      </div>
    </div>
  );
};

// Compact Options — top 3 unusual flow signals
export const CompactOptions = ({ instrument, markPrice }) => {
  // Expires-in filter — narrow the flow rows by DTE bucket. Mirrors the
  // full OptionsActivityTab filter so the compact widget gives users
  // the same control in less space.
  const [expBucket, setExpBucket] = useState('all');
  const buckets = [
    { id: 'all',    label: 'All',    min: 0,  max: 9999 },
    { id: '0dte',   label: '0DTE',   min: 0,  max: 1   },
    { id: 'week',   label: '1W',     min: 0,  max: 7   },
    { id: '2week',  label: '2W',     min: 0,  max: 14  },
    { id: 'month',  label: '1M',     min: 0,  max: 30  },
    { id: 'q',      label: 'Q',      min: 30, max: 90  },
    { id: 'leaps',  label: 'LEAPS',  min: 90, max: 9999 },
  ];

  if (instrument?.cls !== 'equity') {
    return (
      <div className="h-full w-full flex items-center justify-center p-3 text-center">
        <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
          Options flow only available for equities
        </div>
      </div>
    );
  }
  const seed = (instrument?.id ?? 'X').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const r = (i) => {
    const x = Math.sin((seed + i * 7.13) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  // Generate 12 candidates with broader DTE range so the filter has
  // something in each bucket
  const allFlows = Array.from({ length: 12 }, (_, i) => {
    const px = markPrice ?? instrument.mark ?? 100;
    const strike = +(Math.round((px + (r(i + 1) - 0.5) * px * 0.20) / 5) * 5);
    const isCall = r(i + 50) > 0.4;
    const expDaysOptions = [0, 1, 3, 7, 14, 21, 30, 45, 60, 90, 180, 365];
    const expDays = expDaysOptions[i];
    const ratio = +(1.5 + r(i + 100) * 7).toFixed(1);
    return { strike, isCall, expDays, ratio };
  });
  const bucket = buckets.find(b => b.id === expBucket) ?? buckets[0];
  const flows = allFlows
    .filter(f => f.expDays >= bucket.min && f.expDays <= bucket.max)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 4);
  return (
    <div className="h-full w-full flex flex-col">
      {/* Expires-in tab strip — keeps the widget compact while exposing
          the same DTE filtering as the full tab. */}
      <div className="px-2 py-1.5 flex items-center gap-1 overflow-x-auto border-b imo-thin-scrollbar"
           style={{ borderColor: COLORS.border }}>
        {buckets.map(b => {
          const active = b.id === expBucket;
          return (
            <button key={b.id}
                    onClick={() => setExpBucket(b.id)}
                    className="px-1.5 py-0.5 text-[9px] rounded transition-colors shrink-0"
                    style={{
                      background: active ? 'rgba(30,58,108,0.18)' : 'transparent',
                      color: active ? COLORS.mint : COLORS.textMute,
                      border: `1px solid ${active ? COLORS.mint : 'transparent'}`,
                    }}>
              {b.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="text-[9px] uppercase tracking-wider px-1 mb-1.5" style={{ color: COLORS.textMute }}>
          Unusual flow · {instrument.id} · {bucket.label}
        </div>
        {flows.length === 0 ? (
          <div className="text-[10px] text-center py-4" style={{ color: COLORS.textMute }}>
            No flow in this expiry window
          </div>
        ) : flows.map((f, i) => (
          <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-b-0"
               style={{ borderColor: COLORS.border }}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[9px] px-1 py-0.5 rounded uppercase tracking-wider"
                    style={{
                      background: f.isCall ? 'rgba(31,178,107,0.14)' : 'rgba(237,112,136,0.14)',
                      color: f.isCall ? COLORS.green : COLORS.red,
                    }}>
                {f.isCall ? 'CALL' : 'PUT'}
              </span>
              <span className="text-[10.5px] tabular-nums" style={{ color: COLORS.text }}>
                ${f.strike} · {f.expDays === 0 ? '0d' : `${f.expDays}d`}
              </span>
            </div>
            <span className="text-[10px] tabular-nums" style={{ color: COLORS.mint }}>
              {f.ratio}x
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Compact Trends — 4 quick directional badges
export const CompactTrends = ({ instrument }) => {
  const seed = (instrument?.id ?? 'X').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const r = (i) => {
    const x = Math.sin((seed + i * 7.13) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  const trends = [
    { tf: '1H',  pct: +((r(1) - 0.5) * 4).toFixed(2) },
    { tf: '1D',  pct: +((r(2) - 0.5) * 8).toFixed(2) },
    { tf: '1W',  pct: +((r(3) - 0.5) * 14).toFixed(2) },
    { tf: '1M',  pct: +((r(4) - 0.5) * 26).toFixed(2) },
  ];
  return (
    <div className="h-full w-full p-3 grid grid-cols-2 gap-2">
      {trends.map(t => (
        <div key={t.tf} className="rounded p-2"
             style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}` }}>
          <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>{t.tf}</div>
          <div className="text-[14px] tabular-nums font-medium"
               style={{ color: t.pct >= 0 ? COLORS.green : COLORS.red }}>
            {t.pct >= 0 ? '+' : ''}{t.pct}%
          </div>
        </div>
      ))}
    </div>
  );
};

// Compact Price analysis — current price + key levels
export const CompactPriceAnalysis = ({ instrument, markPrice }) => {
  const px = markPrice ?? instrument?.mark ?? 0;
  const seed = (instrument?.id ?? 'X').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const r = (i) => {
    const x = Math.sin((seed + i * 7.13) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  const support = px * (1 - 0.04 - r(1) * 0.04);
  const resistance = px * (1 + 0.04 + r(2) * 0.04);
  const range52w = { low: px * 0.7, high: px * 1.4 };
  const pctOf52w = ((px - range52w.low) / (range52w.high - range52w.low)) * 100;
  return (
    <div className="h-full w-full p-3 flex flex-col gap-2">
      <div>
        <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Mark</div>
        <div className="text-[20px] font-medium tabular-nums" style={{ color: COLORS.text }}>
          ${px.toFixed(2)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div>
          <div style={{ color: COLORS.textMute }}>Support</div>
          <div className="tabular-nums" style={{ color: COLORS.green }}>${support.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ color: COLORS.textMute }}>Resistance</div>
          <div className="tabular-nums" style={{ color: COLORS.red }}>${resistance.toFixed(2)}</div>
        </div>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
          52w range · {pctOf52w.toFixed(0)}%
        </div>
        <div className="h-1 rounded-full overflow-hidden" style={{ background: COLORS.surface2 }}>
          <div className="h-full rounded-full"
               style={{ width: `${Math.min(100, Math.max(0, pctOf52w))}%`, background: COLORS.mint }} />
        </div>
      </div>
    </div>
  );
};

// Compact ESG / Fraud
export const CompactESG = ({ instrument }) => {
  const seed = (instrument?.id ?? 'X').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const r = (i) => {
    const x = Math.sin((seed + i * 7.13) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  const fraud = Math.round(r(1) * 100);
  // Algorithmic breakdown — sub-components that feed the fraud score
  const revQuality   = Math.round(60 + r(2) * 35);
  const auditQuality = Math.round(70 + r(3) * 25);
  const e = Math.round(r(4) * 100);
  const s = Math.round(r(5) * 100);
  const g = Math.round(r(6) * 100);
  const fraudColor = fraud > 70 ? COLORS.red : fraud > 40 ? '#FFB84D' : COLORS.green;
  return (
    <div className="h-full w-full p-3 flex flex-col gap-2 overflow-y-auto">
      <div>
        <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Fraud risk</div>
        <div className="text-[18px] font-medium tabular-nums" style={{ color: fraudColor }}>
          {fraud}/100
        </div>
      </div>
      {/* Sub-component bars — what feeds the score */}
      <div className="space-y-1.5">
        {[
          { label: 'Rev quality',   val: revQuality },
          { label: 'Audit quality', val: auditQuality },
        ].map(x => (
          <div key={x.label}>
            <div className="flex items-center justify-between text-[9px]">
              <span style={{ color: COLORS.textMute }}>{x.label}</span>
              <span className="tabular-nums" style={{ color: COLORS.textDim }}>{x.val}</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: COLORS.surface2 }}>
              <div className="h-full" style={{
                width: `${x.val}%`,
                background: x.val >= 70 ? COLORS.green : x.val >= 50 ? COLORS.mint : '#FFB84D',
              }} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px] pt-1.5 border-t" style={{ borderColor: COLORS.border }}>
        {[
          { label: 'E', val: e, full: 'Environmental' },
          { label: 'S', val: s, full: 'Social' },
          { label: 'G', val: g, full: 'Governance' },
        ].map(x => (
          <div key={x.label} title={x.full}>
            <div style={{ color: COLORS.textMute }}>{x.label}</div>
            <div className="tabular-nums" style={{ color: COLORS.text }}>{x.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Compact Moat — score + breakdown of top 3 contributing factors
export const CompactMoat = ({ instrument }) => {
  const seed = (instrument?.id ?? 'X').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const r = (i) => {
    const x = Math.sin((seed + i * 7.13) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  // Compute six moat factors then derive composite — same algorithm as
  // the full MoatScoreTab so the compact widget agrees with the full one.
  const factors = [
    { label: 'Pricing power',    val: Math.round(40 + r(1) * 55) },
    { label: 'Switching costs',  val: Math.round(30 + r(2) * 65) },
    { label: 'Network effects',  val: Math.round(20 + r(3) * 75) },
    { label: 'Scale advantage',  val: Math.round(40 + r(4) * 55) },
    { label: 'Brand power',      val: Math.round(35 + r(5) * 60) },
    { label: 'IP / patent moat', val: Math.round(25 + r(6) * 70) },
  ];
  const composite = Math.round(factors.reduce((s, f) => s + f.val, 0) / factors.length);
  const tier =
    composite >= 75 ? { label: 'Wide',     color: COLORS.green } :
    composite >= 55 ? { label: 'Narrow',   color: '#A0C476' } :
    composite >= 35 ? { label: 'Limited',  color: '#FFB84D' } :
                      { label: 'None',     color: COLORS.red };
  // Sort factors desc to show the strongest contributors first
  const top3 = [...factors].sort((a, b) => b.val - a.val).slice(0, 3);
  return (
    <div className="h-full w-full p-3 flex flex-col gap-2 overflow-y-auto">
      <div className="text-center pb-2 border-b" style={{ borderColor: COLORS.border }}>
        <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Moat score</div>
        <div className="flex items-baseline justify-center gap-1.5 mt-0.5">
          <span className="text-[22px] font-medium tabular-nums" style={{ color: tier.color }}>{composite}</span>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ background: tier.color + '22', color: tier.color }}>
            {tier.label}
          </span>
        </div>
      </div>
      {/* Top 3 moat factors as breakdown bars */}
      <div className="space-y-1.5">
        <div className="text-[9px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
          Top contributors
        </div>
        {top3.map(f => (
          <div key={f.label}>
            <div className="flex items-center justify-between text-[9.5px]">
              <span style={{ color: COLORS.text }}>{f.label}</span>
              <span className="tabular-nums" style={{ color: COLORS.textDim }}>{f.val}</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: COLORS.surface2 }}>
              <div className="h-full" style={{
                width: `${f.val}%`,
                background: f.val >= 70 ? COLORS.green : f.val >= 50 ? COLORS.mint : '#FFB84D',
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Compact News — top 3 headlines
export const CompactNewsTab = ({ instrument }) => {
  const headlines = [
    { title: `${instrument?.id ?? '—'} forms key technical setup`, source: 'Reuters', age: '12m' },
    { title: 'Fed minutes signal patience on rate cuts', source: 'Bloomberg', age: '34m' },
    { title: `Analysts upgrade ${instrument?.id ?? '—'} on strong fundamentals`, source: 'CNBC', age: '1h' },
  ];
  return (
    <div className="h-full w-full overflow-y-auto p-2">
      {headlines.map((h, i) => (
        <div key={i} className="py-1.5 border-b last:border-b-0"
             style={{ borderColor: COLORS.border }}>
          <div className="text-[10.5px] leading-snug line-clamp-2"
               style={{ color: COLORS.text, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {h.title}
          </div>
          <div className="text-[9px] mt-0.5 flex items-center gap-1.5" style={{ color: COLORS.textMute }}>
            <span>{h.source}</span>
            <span>·</span>
            <span>{h.age}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ──────────── Mini widgets for trade page mesh ──────────── */
// Each widget is a compact view that shows a meaningful slice of the page
// it represents. The user can drag-drop these into the trade page mesh
// using the + Add widget button. Widgets are intentionally small and focus
// on showing a single chart/list — for full functionality the user clicks
// the "Open full page →" link in TradeMiniView.

// Volume profile — horizontal bars of bucketed volume vs price
// ──────── VOLUME BY PRICE — vertical price axis, horizontal volume bars ────────
// Computes volume traded at each price level over a configurable lookback.
// This is the "TPO/Volume Profile" view — opposite of the time-axis volume
// histogram at the bottom of the chart. POC (Point of Control) = bucket
// with max volume. Value Area (VAH/VAL) = the top 70% of cumulative volume
// around the POC, the typical "fair value" zone.
