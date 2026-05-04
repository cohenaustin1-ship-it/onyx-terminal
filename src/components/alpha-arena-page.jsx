// IMO Onyx Terminal — Alpha Arena page
//
// Phase 3p.21 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~109872-110093, ~220 lines including the
// ALPHA_ARENA_COMPS data inlined since this page is its only caller).
//
// Trading competition leaderboard. Users can join active/upcoming
// competitions; their participation is stored per-username in
// localStorage. Pure UI — actual leaderboard scoring lives elsewhere
// (or is fixture-only in this build).
//
// Public export:
//   AlphaArenaPage({ user, account, setPage })
//     user     — the current user record (used to scope storage)
//     account  — account record (currently unused; kept for parity
//                with the page-component signature pattern)
//     setPage(id) — navigation callback
//
// Honest scope:
//   - Competition list is hardcoded. Real implementation would read
//     from a server/admin-curated registry.
//   - "Joining" is a localStorage flag. Real entry would coordinate
//     with a server (escrow, eligibility checks, etc.).

import React, { useState } from 'react';
import { COLORS } from '../lib/constants.js';

// ALPHA_ARENA_COMPS — hand-curated trading competition list.
// Inlined from monolith during 3p.21 since AlphaArenaPage is the
// only caller. Each entry: { id, name, status, ... }.
const ALPHA_ARENA_COMPS = [
  {
    id: 'q1-crypto-2026',
    name: 'Q1 2026 Crypto Sprint',
    desc: 'Best Sharpe ratio over Q1. Crypto perpetuals only.',
    metric: 'Sharpe',
    universe: 'Crypto',
    start: '2026-01-01',
    end:   '2026-03-31',
    status: 'active',
    entrants: 1247,
    prize: '$25,000',
    prizeNote: 'Top 3 split · plus alpha-arena badge for one year',
  },
  {
    id: 'macro-may-2026',
    name: 'Macro May Showdown',
    desc: 'Best risk-adjusted return on macro instruments.',
    metric: 'Sortino',
    universe: 'Macro / FX / Rates',
    start: '2026-05-01',
    end:   '2026-05-31',
    status: 'active',
    entrants: 542,
    prize: '$10,000',
    prizeNote: 'Winner takes all',
  },
  {
    id: 'options-april-2026',
    name: 'Options Income Month',
    desc: 'Highest realized P&L from defined-risk options strategies.',
    metric: 'Total return',
    universe: 'Equity options',
    start: '2026-04-01',
    end:   '2026-04-30',
    status: 'upcoming',
    entrants: 198,
    prize: '$5,000',
    prizeNote: 'Top 5 split equally',
  },
  {
    id: 'q4-equity-2025',
    name: 'Q4 2025 Equity Cup',
    desc: 'Highest absolute return on US equity. No leverage.',
    metric: 'Total return',
    universe: 'US Equity',
    start: '2025-10-01',
    end:   '2025-12-31',
    status: 'past',
    entrants: 2104,
    prize: '$15,000',
    prizeNote: 'Won by @marquant_42 · +47.3%',
  },
];

export const AlphaArenaPage = ({ user, account, setPage }) => {
  const STORAGE = `imo_arena_${user?.username ?? 'guest'}`;
  const [joined, setJoined] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const persist = (next) => {
    setJoined(next);
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); } catch {}
  };
  const join = (compId) => persist({ ...joined, [compId]: { joinedAt: Date.now() } });
  const leave = (compId) => {
    const next = { ...joined };
    delete next[compId];
    persist(next);
  };

  const active   = ALPHA_ARENA_COMPS.filter(c => c.status === 'active');
  const upcoming = ALPHA_ARENA_COMPS.filter(c => c.status === 'upcoming');
  const past     = ALPHA_ARENA_COMPS.filter(c => c.status === 'past');

  // Synthesize a mini-leaderboard for each active comp — top 5 by metric
  const mockLeaders = (compId) => {
    const seed = compId.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
    let x = seed;
    const r = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
    const handles = ['marquant_42','vol_grimes','delta_dan','alphakitten','strikezone',
                     'theta_ned','convex_jr','bookmaker','curveball','riskpremia'];
    return handles.slice(0, 5).map((h, i) => ({
      rank: i + 1,
      handle: h,
      score: 3.2 - i * 0.4 + r() * 0.2,
      isMe: false,
    }));
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: COLORS.bg, color: COLORS.text }}>
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-baseline gap-3 mb-1">
          <h1 className="text-[24px] font-medium">Alpha Arena</h1>
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(61,123,255,0.10)', color: COLORS.mint }}>{active.length} live</span>
        </div>
        <p className="text-[12.5px] mb-6" style={{ color: COLORS.textMute }}>
          Compete in time-bounded paper-trading competitions. Join for free · winners tracked on the public leaderboard.
        </p>

        {/* Active competitions */}
        {active.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[13px] uppercase tracking-wider mb-3" style={{ color: COLORS.mint }}>Active</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {active.map(comp => {
                const isJoined = !!joined[comp.id];
                const leaders = mockLeaders(comp.id);
                return (
                  <div key={comp.id} className="rounded-md overflow-hidden"
                       style={{ background: COLORS.surface, border: `1px solid ${isJoined ? COLORS.mint : COLORS.borderHi}` }}>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="text-[14.5px] font-medium">{comp.name}</h3>
                        {isJoined && (
                          <span className="text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                                style={{ background: COLORS.mint, color: '#FFFFFF', fontWeight: 600 }}>
                            Joined
                          </span>
                        )}
                      </div>
                      <p className="text-[11.5px] mb-3" style={{ color: COLORS.textDim }}>{comp.desc}</p>
                      <div className="grid grid-cols-3 gap-2 mb-3 text-[10.5px]">
                        <div>
                          <div className="uppercase tracking-wider mb-0.5" style={{ color: COLORS.textMute }}>Metric</div>
                          <div style={{ color: COLORS.text }}>{comp.metric}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wider mb-0.5" style={{ color: COLORS.textMute }}>Universe</div>
                          <div style={{ color: COLORS.text }}>{comp.universe}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wider mb-0.5" style={{ color: COLORS.textMute }}>Ends</div>
                          <div style={{ color: COLORS.text }} className="tabular-nums">{comp.end.slice(5)}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-3 text-[11px]">
                        <span style={{ color: COLORS.textMute }}>{comp.entrants.toLocaleString()} entrants</span>
                        <span style={{ color: COLORS.textMute }}>·</span>
                        <span style={{ color: COLORS.mint, fontWeight: 600 }}>{comp.prize}</span>
                      </div>
                      <button onClick={() => isJoined ? leave(comp.id) : join(comp.id)}
                              className="w-full py-2 rounded-md text-[12px] font-medium transition-colors"
                              style={{
                                background: isJoined ? 'transparent' : COLORS.mint,
                                color: isJoined ? COLORS.textMute : '#FFFFFF',
                                border: `1px solid ${isJoined ? COLORS.border : COLORS.mint}`,
                              }}>
                        {isJoined ? 'Leave competition' : 'Join · Free'}
                      </button>
                    </div>
                    {/* Mini leaderboard */}
                    <div className="border-t" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                      <div className="px-4 py-2 text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                        Top 5 · live
                      </div>
                      {leaders.map(l => (
                        <div key={l.handle} className="px-4 py-1.5 flex items-center gap-2 text-[11px]"
                             style={{ borderTop: `1px solid ${COLORS.border}` }}>
                          <span className="w-5 tabular-nums" style={{ color: COLORS.textMute }}>{l.rank}</span>
                          <span className="flex-1" style={{ color: COLORS.text }}>@{l.handle}</span>
                          <span className="tabular-nums" style={{ color: COLORS.green, fontWeight: 600 }}>{l.score.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[13px] uppercase tracking-wider mb-3" style={{ color: COLORS.textDim }}>Upcoming</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {upcoming.map(comp => (
                <div key={comp.id} className="rounded-md p-3"
                     style={{ background: COLORS.surface, border: `1px solid ${COLORS.borderHi}`, opacity: 0.85 }}>
                  <div className="flex items-baseline justify-between mb-1">
                    <h3 className="text-[13px] font-medium">{comp.name}</h3>
                    <span className="text-[10px] tabular-nums" style={{ color: COLORS.textMute }}>Starts {comp.start}</span>
                  </div>
                  <p className="text-[11px] mb-2" style={{ color: COLORS.textMute }}>{comp.desc}</p>
                  <div className="flex items-center gap-2 text-[10.5px]">
                    <span style={{ color: COLORS.mint }}>{comp.prize}</span>
                    <span style={{ color: COLORS.textMute }}>· {comp.entrants} pre-registered</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Past */}
        {past.length > 0 && (
          <section>
            <h2 className="text-[13px] uppercase tracking-wider mb-3" style={{ color: COLORS.textDim }}>Hall of Fame</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {past.map(comp => (
                <div key={comp.id} className="rounded-md p-3"
                     style={{ background: COLORS.surface, border: `1px solid ${COLORS.borderHi}`, opacity: 0.7 }}>
                  <div className="flex items-baseline justify-between mb-1">
                    <h3 className="text-[13px] font-medium">{comp.name}</h3>
                    <span className="text-[10px]" style={{ color: COLORS.textMute }}>Closed {comp.end}</span>
                  </div>
                  <p className="text-[11px]" style={{ color: COLORS.textDim }}>{comp.prizeNote}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
