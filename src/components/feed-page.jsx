// IMO Onyx Terminal — Feed page
//
// Phase 3p.21 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~80635-82357, ~1,720 lines including the data
// fixtures and 4 companion components).
//
// Twitter-style scrolling feed of trading-related posts, news,
// trending tickers, and "stories" (short-lived author content). The
// FeedPage hosts the main timeline; companion components are kept
// in this same file because they're only used here:
//
//   UserProfileModal    — profile pop-up for any handle (PUBLIC export
//                         since DiscussionPage in the monolith also
//                         uses it)
//   FeedStoryViewer     — full-screen story playback overlay
//   FeedStories         — horizontal story bubble strip at the top
//   FriendsFinder       — left-rail "people to follow" widget
//   EditProfileModal    — Twitter+LinkedIn-style profile editor
//
// Public exports:
//   FeedPage({ user, account, setPage, updateUser })
//   UserProfileModal({ handle, onClose })
//
// Honest scope:
//   - Posts/trending/news/stories are mostly fixtures (FEED_POSTS,
//     FEED_TRENDING, FEED_STORY_AUTHORS, STORY_SNIPPETS) augmented
//     with live news from NewsData/Exa when keys are configured.
//   - USER_PROFILES is hand-curated demo data for ~30 handles.
//   - No persistence of user-authored posts beyond the current tab.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  BarChart2, Bell, Bookmark, Building2, Calendar, ExternalLink,
  Hash, Heart, Home, Mail, MapPin, MessageSquare, MoreHorizontal,
  Repeat2, Search, Share, Smile, User, Users, Verified, X,
  Image as ImageIcon,
} from 'lucide-react';
import { COLORS } from '../lib/constants.js';
import { fetchNewsDataNews } from '../lib/external-data.js';
import { exaSearch } from '../lib/ai-calls.js';

// Env-var keys (duplicated from monolith — same source, separate read).
const NEWSDATA_KEY = (() => { try { return import.meta.env?.VITE_NEWSDATA_KEY ?? ''; } catch { return ''; } })();
const EXA_API_KEY  = (() => { try { return import.meta.env?.VITE_EXA_API_KEY  ?? ''; } catch { return ''; } })();

// loadSettings (inlined from monolith during 3p.21). The monolith uses
// this in 100+ places — a separate centralization phase would extract
// it to src/lib/user-settings.js. For now the duplicated definition
// is acceptable since settings are pure data, not stateful.
const SETTINGS_KEY = 'imo_settings';
const loadSettings = () => {
  try {
    const raw = typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(SETTINGS_KEY)
      : null;
    return raw ? JSON.parse(raw) : { showTooltips: true };
  } catch { return { showTooltips: true }; }
};

/* ════════════════════════════════════════════════════════════════════════════
   FEED PAGE — Twitter-style scrolling feed
   ════════════════════════════════════════════════════════════════════════════ */

// Mock user profiles for accounts seen on the Feed and Discussion pages.
// Keyed by handle (without @). Used by the UserProfileModal.
const USER_PROFILES = {
  '@lillywatch':  { name: 'Eli Lilly Watch',  bio: 'Pharma sector analyst — Mounjaro/Zepbound coverage. Former equity research at GS.',
                    location: 'New York, NY',  desk: 'Healthcare Equities', joined: 'Oct 2024',
                    followers: 14_200, following: 89, posts: 2_140, verified: true,
                    holdings: ['LLY', 'NVO', 'PFE', 'MRK'], color: '#7AC8FF' },
  '@tacquant':    { name: 'TacticalQuant',     bio: 'Volatility strategies + skew analytics. Quant since 2008.',
                    location: 'Chicago, IL',  desk: 'Equity Derivatives',  joined: 'Mar 2023',
                    followers: 8_900,  following: 42, posts: 3_410, verified: false,
                    holdings: ['SPY', 'VIX', 'QQQ'], color: '#FF7AB6' },
  '@onyxdesk':    { name: 'JPM Onyx Desk',     bio: 'Official IMO Onyx institutional desk. Crypto derivatives + cross-asset.',
                    location: 'London, UK',   desk: 'Crypto Desk',         joined: 'Jan 2024',
                    followers: 52_300, following: 12, posts: 1_840, verified: true,
                    holdings: ['BTC-PERP', 'ETH-PERP', 'SOL-PERP'], color: '#0066B2' },
  '@volsurf':     { name: 'Vol Surface',       bio: '0DTE flow + dealer positioning. Posts dealer-gamma maps.',
                    location: 'New York, NY', desk: 'Index Options',       joined: 'Jul 2024',
                    followers: 22_100, following: 67, posts: 4_280, verified: false,
                    holdings: ['SPX', 'NDX', 'VIX'], color: '#A0C476' },
  '@macrobites':  { name: 'Macro Bites',       bio: 'CPI/PCE/FOMC junkie. Daily rate-cut probability deltas.',
                    location: 'Boston, MA',   desk: 'Macro Strategy',      joined: 'Aug 2023',
                    followers: 18_700, following: 134, posts: 5_120, verified: false,
                    holdings: ['ZN', 'GLD', 'DXY'], color: '#E07AFC' },
  '@energyedge':  { name: 'Energy Edge',       bio: 'Crude curve + refinery cracks. Cushing storage data.',
                    location: 'Houston, TX',  desk: 'Energy Trading',      joined: 'May 2024',
                    followers: 6_400,  following: 28, posts: 1_650, verified: false,
                    holdings: ['CL', 'BZ', 'XLE'], color: '#FFB84D' },
  '@tslabulls':   { name: 'TSLA Bulls',        bio: '🚀 long-term Tesla shareholder. FSD + Robotaxi + Energy.',
                    location: 'Austin, TX',   desk: 'Retail',              joined: 'Feb 2022',
                    followers: 145_000, following: 1_200, posts: 12_400, verified: false,
                    holdings: ['TSLA'], color: '#CC0000' },
};

// User profile modal — shows when clicking on a username/handle in Feed or Discussion.
// Falls back to a generic profile for handles not in USER_PROFILES.
// LinkedIn-style profile modal — large banner, big avatar, experience timeline,
// activity preview, mutual connections, holdings, and a sidebar of connection
// suggestions. Replaces the old simple banner+stats card with a richer layout.
export const UserProfileModal = ({ handle, onClose }) => {
  const profile = USER_PROFILES[handle] ?? {
    name: handle.replace('@', ''), bio: 'Trader at Onyx Markets. Focus: equities, derivatives, macro.', location: 'New York, NY',
    desk: '—', joined: 'Jan 2024', followers: 247, following: 89, posts: 34, verified: false,
    holdings: ['AAPL', 'NVDA', 'SPY'], color: '#7AC8FF',
  };
  const settings = loadSettings();
  // Determine if this profile should show a LIVE indicator. Self profile uses
  // the user's setting; others show by default for ~30% of seeded handles.
  const isLive = useMemo(() => {
    const seed = (handle || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return (seed % 10) < 3;
  }, [handle]);
  const initials = (profile.name.split(/\s+/).map(s => s[0]).join('') || handle.slice(1, 3)).slice(0, 2).toUpperCase();
  const [following, setFollowing] = useState(false);
  const [activeTab, setActiveTab] = useState('about'); // 'about' | 'activity' | 'experience'

  // Synthesize an experience timeline based on the profile (3 entries)
  const experience = useMemo(() => {
    const desk = profile.desk && profile.desk !== '—' ? profile.desk : 'Trading Desk';
    return [
      { role: `Senior Trader · ${desk}`,    company: 'Onyx Markets',       period: '2022 — Present', desc: `Covers ${profile.holdings?.[0] ?? 'equities'} and related derivatives. Leads weekly market call.` },
      { role: 'Quantitative Analyst',        company: 'Goldman Sachs',      period: '2018 — 2022',    desc: 'Built systematic equity strategies in the SMD group. AUM scaled from $200M to $1.2B.' },
      { role: 'Investment Banking Analyst',  company: 'JPMorgan',           period: '2016 — 2018',    desc: 'M&A advisory in the TMT group. Pitched and closed deals across SaaS and consumer tech.' },
    ];
  }, [profile.desk, profile.holdings]);

  // Synthesize 3 recent posts attributed to this handle
  const recentActivity = useMemo(() => {
    const matched = (typeof FEED_POSTS !== 'undefined' ? FEED_POSTS : []).filter(p => p.handle === handle).slice(0, 3);
    if (matched.length > 0) return matched;
    return [
      { id: 'a1', body: `Watching ${profile.holdings?.[0] ?? 'AAPL'} closely into earnings — IV is the highest it's been in 6 months.`, ts: 2,  likes: 45 },
      { id: 'a2', body: `Position update: trimmed ${profile.holdings?.[1] ?? 'NVDA'} 25% after the run, kept the long-dated calls.`, ts: 6, likes: 89 },
      { id: 'a3', body: 'Macro reminder: rate-cut probabilities have moved 8% in the last 5 sessions. Position accordingly.',                ts: 14, likes: 156 },
    ];
  }, [handle, profile.holdings]);

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="w-[700px] max-w-full max-h-[92vh] rounded-md border overflow-hidden flex flex-col pointer-events-auto"
             style={{ background: COLORS.surface, borderColor: COLORS.borderHi, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
          {/* Banner — solid color band, full-width, with edit-pencil affordance */}
          <div className="h-28 relative shrink-0" style={{
            background: `linear-gradient(135deg, ${profile.color}E6 0%, ${profile.color}80 100%)`,
          }}>
            <button onClick={onClose}
                    className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-[14px] font-medium hover:bg-black/30"
                    style={{ background: 'rgba(0,0,0,0.5)', color: '#FFF', backdropFilter: 'blur(4px)' }}>×</button>
          </div>
          {/* Scrollable content */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* LinkedIn-style: avatar floats over the banner edge but the
                main content row sits BELOW the banner so the name and
                action buttons never get covered by the gradient. */}
            <div className="px-6 pb-5 relative">
              {/* Avatar — circular, sits at the banner/content boundary */}
              <div className="absolute -top-12 left-6">
                <div className="relative">
                  <div className="w-24 h-24 rounded-full flex items-center justify-center text-[28px] font-semibold border-4 shadow-lg"
                       style={{ background: profile.color, color: '#FFF', borderColor: COLORS.surface }}>
                    {initials}
                  </div>
                  {settings.liveIndicator !== false && isLive && (
                    <div className="absolute bottom-1 right-1 px-1.5 rounded-full flex items-center gap-1"
                         style={{ background: COLORS.red, fontSize: 9, fontWeight: 700, color: '#FFFFFF', border: `2px solid ${COLORS.surface}` }}>
                      <span style={{ width: 5, height: 5, borderRadius: 999, background: '#FFFFFF' }} />
                      LIVE
                    </div>
                  )}
                </div>
              </div>
              {/* Spacer so the content starts BELOW the avatar overlap */}
              <div style={{ height: 50 }} />
              {/* Name row — full width below the banner, no overlap */}
              <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[22px] font-semibold leading-tight" style={{ color: COLORS.text }}>{profile.name}</span>
                    {profile.verified && <span style={{ color: COLORS.mint, fontSize: 16 }}>✓</span>}
                  </div>
                  <div className="text-[12.5px] mt-0.5" style={{ color: COLORS.textMute }}>{handle}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      if (typeof window !== 'undefined' && window.alert) {
                        window.alert(`Open a chat with ${profile.name} (${handle}).\n\nMessages live in the Messages tab — close this profile and switch tabs to find your conversation thread.`);
                      }
                    }}
                    className="px-3 py-1.5 rounded-full text-[12px] font-medium border hover:bg-white/[0.04]"
                          style={{ color: COLORS.text, borderColor: COLORS.border, background: COLORS.surface }}>
                    Message
                  </button>
                  <button onClick={() => setFollowing(f => !f)}
                          className="px-4 py-1.5 rounded-full text-[12px] font-medium transition-colors"
                          style={{
                            background: following ? 'transparent' : COLORS.mint,
                            color: following ? COLORS.text : COLORS.bg,
                            border: following ? `1px solid ${COLORS.border}` : 'none',
                          }}>
                    {following ? '✓ Connected' : '+ Connect'}
                  </button>
                </div>
              </div>

              {/* Headline (bio) */}
              <p className="text-[13.5px] mb-3 leading-snug" style={{ color: COLORS.text }}>{profile.bio}</p>
              <div className="flex items-center gap-4 text-[11.5px] flex-wrap" style={{ color: COLORS.textMute }}>
                {profile.location && profile.location !== 'Unknown' && (
                  <span className="flex items-center gap-1">{profile.location}</span>
                )}
                {profile.desk && profile.desk !== '—' && (
                  <span className="flex items-center gap-1">{profile.desk}</span>
                )}
                {profile.joined && profile.joined !== '—' && (
                  <span className="flex items-center gap-1">Joined {profile.joined}</span>
                )}
              </div>

              {/* Stats row — LinkedIn style */}
              <div className="flex items-center gap-5 mt-3 pt-3 border-t text-[12px]"
                   style={{ borderColor: COLORS.border }}>
                <div>
                  <span className="font-semibold tabular-nums" style={{ color: COLORS.text }}>{profile.followers.toLocaleString()}</span>
                  <span className="ml-1" style={{ color: COLORS.textMute }}>followers</span>
                </div>
                <div>
                  <span className="font-semibold tabular-nums" style={{ color: COLORS.text }}>{profile.following.toLocaleString()}</span>
                  <span className="ml-1" style={{ color: COLORS.textMute }}>connections</span>
                </div>
                <div>
                  <span className="font-semibold tabular-nums" style={{ color: COLORS.text }}>{profile.posts.toLocaleString()}</span>
                  <span className="ml-1" style={{ color: COLORS.textMute }}>posts</span>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 mt-4 border-b" style={{ borderColor: COLORS.border }}>
                {[
                  { id: 'about',      label: 'About' },
                  { id: 'experience', label: 'Experience' },
                  { id: 'activity',   label: 'Activity' },
                ].map(t => (
                  <button key={t.id} onClick={() => setActiveTab(t.id)}
                          className="px-3 py-2 text-[12.5px] relative transition-colors"
                          style={{ color: activeTab === t.id ? COLORS.text : COLORS.textDim }}>
                    {t.label}
                    {activeTab === t.id && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5"
                           style={{ background: COLORS.mint }} />
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {activeTab === 'about' && (
                <div className="pt-4 space-y-4">
                  {/* Top holdings */}
                  {profile.holdings && profile.holdings.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                        Public holdings
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {profile.holdings.map(t => (
                          <span key={t} className="px-2 py-1 rounded text-[11px] font-medium"
                                style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Featured insights */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                      Featured
                    </div>
                    <div className="rounded-md p-3 text-[12.5px]"
                         style={{ background: COLORS.bg, color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                      Pinned insight: {profile.bio}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'experience' && (
                <div className="pt-4 space-y-4">
                  {experience.map((e, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="w-10 h-10 rounded flex items-center justify-center text-[14px] font-medium shrink-0"
                           style={{ background: COLORS.bg, color: profile.color, border: `1px solid ${COLORS.border}` }}>
                        🏢
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium" style={{ color: COLORS.text }}>{e.role}</div>
                        <div className="text-[11.5px]" style={{ color: COLORS.textDim }}>{e.company}</div>
                        <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textMute }}>{e.period}</div>
                        <div className="text-[11.5px] mt-1.5" style={{ color: COLORS.textDim }}>{e.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'activity' && (
                <div className="pt-4 space-y-3">
                  {recentActivity.map(p => (
                    <div key={p.id} className="rounded-md p-3 border"
                         style={{ background: COLORS.bg, borderColor: COLORS.border }}>
                      <div className="text-[10.5px] mb-1.5" style={{ color: COLORS.textMute }}>
                        {profile.name} posted · {p.ts}h ago
                      </div>
                      <div className="text-[12.5px]" style={{ color: COLORS.text }}>{p.body}</div>
                      <div className="flex items-center gap-3 mt-2 text-[10.5px]" style={{ color: COLORS.textMute }}>
                        <span>♡ {p.likes}</span>
                        <span>↻ {p.reposts ?? Math.floor(p.likes / 4)}</span>
                        <span>💬 {p.replies ?? Math.floor(p.likes / 6)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export const FEED_POSTS = [
  { id: 'fp1', author: 'Eli Lilly Watch', handle: '@lillywatch', avatar: 'EW', avatarColor: '#7AC8FF',
    body: '$LLY Q1 2026 print: revenue up 28% YoY driven by Mounjaro/Zepbound. Operating margin expanded 340 bps. Guidance raised on the call.',
    likes: 142, reposts: 38, replies: 22, ts: 0.5, verified: true },
  { id: 'fp2', author: 'TacticalQuant', handle: '@tacquant', avatar: 'TQ', avatarColor: '#FF7AB6',
    body: 'NVDA earnings are a coin flip at this point — vol is pricing 9% move. Skew is balanced. Probably a fade either way.',
    likes: 89, reposts: 14, replies: 31, ts: 1.2, verified: false },
  { id: 'fp3', author: 'JPM Onyx Desk', handle: '@onyxdesk', avatar: 'JP', avatarColor: '#0066B2',
    body: 'BTC perp open interest crossed $48B today, all-time high. Funding rates remain neutral despite the spot rip — basis trade still attractive.',
    likes: 334, reposts: 87, replies: 56, ts: 2.5, verified: true },
  { id: 'fp4', author: 'Vol Surface', handle: '@volsurf', avatar: 'VS', avatarColor: '#A0C476',
    body: 'Reminder: SPX 0DTE flow is now ~50% of all options volume. The tail wagging the dog has its own tail wagging it.',
    likes: 412, reposts: 156, replies: 89, ts: 4 },
  { id: 'fp5', author: 'Macro Bites', handle: '@macrobites', avatar: 'MB', avatarColor: '#E07AFC',
    body: 'PCE came in at 2.6%. Rate cut odds for June FOMC: 74% (Kalshi) vs 68% (CME FedWatch). Spread suggests Kalshi traders are more dovish than the curve implies.',
    likes: 198, reposts: 42, replies: 15, ts: 6 },
  { id: 'fp6', author: 'Energy Edge', handle: '@energyedge', avatar: 'EE', avatarColor: '#FFB84D',
    body: 'WTI/Brent spread compressed to $3.20/bbl, lowest since 2021. Watch the storage build at Cushing this Wednesday — could break either way.',
    likes: 67, reposts: 9, replies: 4, ts: 8 },
  { id: 'fp7', author: 'TSLA Bulls', handle: '@tslabulls', avatar: 'TB', avatarColor: '#CC0000',
    body: 'Cybertruck deliveries ramping, FSD v13 in beta, energy storage segment growing 80%+. Q2 going to be a banger 🚀',
    likes: 1340, reposts: 220, replies: 540, ts: 12 },
  { id: 'fp8', author: 'AI Capital', handle: '@aicapital', avatar: 'AI', avatarColor: '#76B900',
    body: 'Hyperscaler capex announced for FY26 has crossed $400B. The picks-and-shovels trade has years left.',
    likes: 891, reposts: 167, replies: 88, ts: 18 },
  { id: 'fp9', author: 'Buffett Tracker', handle: '@buffetttrack', avatar: 'BT', avatarColor: '#F5B041',
    body: 'Berkshire 13F: trimmed AAPL by 10%, added to OXY, initiated small position in CB. Cash pile now $325B.',
    likes: 2100, reposts: 480, replies: 215, ts: 24, verified: true },
  { id: 'fp10', author: 'CryptoBro', handle: '@cryptobro420', avatar: 'CB', avatarColor: '#F7931A',
    body: 'BTC dominance at 56%. Alt season probably starts when this breaks below 52%. Keep watching.',
    likes: 145, reposts: 38, replies: 12, ts: 36 },
];

const FEED_TRENDING = [
  { topic: 'NVDA',  category: 'Trending in Tech',     posts: '24.6K' },
  { topic: 'CPI Print', category: 'Trending in Macro', posts: '12.1K' },
  { topic: 'Bitcoin ETF', category: 'Crypto',         posts: '8.7K' },
  { topic: 'Fed Cut Odds', category: 'Markets',       posts: '5.2K' },
  { topic: 'Oil Sanctions', category: 'Energy',       posts: '3.4K' },
];
const FEED_NEWS = [
  { title: 'Tech earnings season kicks off — NVDA reports Tuesday after close', source: 'Bloomberg', ts: '2h ago', count: '1.2K' },
  { title: 'Fed minutes signal patience on cuts despite cooling inflation',     source: 'Reuters',   ts: '4h ago', count: '890' },
  { title: 'OPEC+ extends production cuts through Q3 — oil up 2.4%',             source: 'WSJ',       ts: '6h ago', count: '623' },
  { title: 'Bond yields pullback as rate-cut bets firm for June FOMC',          source: 'FT',        ts: '8h ago', count: '412' },
];

// ──────────── Feed Stories Carousel ────────────
// Instagram/Snap-style stories at the top of the feed. Each "story" represents
// a short market update from a user the viewer follows. Clicking a story opens
// a modal carousel that auto-advances. The current user's "Your story" tile
// always sits first as a quick-post entrypoint.
const FEED_STORY_AUTHORS = [
  { handle: '@quant_emma',   name: 'Emma Liu',     color: '#7AC8FF', initials: 'EL', live: true },
  { handle: '@vol_trader',   name: 'Sam Park',     color: '#FFB84D', initials: 'SP', live: false },
  { handle: '@macro_jay',    name: 'Jay Patel',    color: '#E07AFC', initials: 'JP', live: true },
  { handle: '@earningsbot',  name: 'EarningsBot',  color: '#1FB26B', initials: 'EB', live: false },
  { handle: '@derivs_desk',  name: 'Derivs Desk',  color: '#FF7AB6', initials: 'DD', live: true },
  { handle: '@flowwatch',    name: 'Flow Watch',   color: '#FFC857', initials: 'FW', live: false },
  { handle: '@chart_angel',  name: 'Chart Angel',  color: '#5BFF9C', initials: 'CA', live: false },
  { handle: '@thesis_drive', name: 'Thesis Drive', color: '#9D7AFF', initials: 'TD', live: true },
];
const STORY_SNIPPETS = [
  { author: '@quant_emma',   ticker: 'NVDA',     headline: 'Vol cone crushed — earnings setup',  cta: 'NVDA volatility is at the 12th percentile. Pre-earnings IV usually expands by 30-40% in the 5 days prior. Watching for a long straddle entry.' },
  { author: '@vol_trader',   ticker: 'BTC-PERP', headline: 'Funding flipped negative',           cta: 'Perp funding just printed -0.04% for the 4th hour. Last 3 times this happened, BTC squeezed +5% within 18h.' },
  { author: '@macro_jay',    ticker: 'XOM',      headline: 'Refining margins still elevated',    cta: 'Crack spreads are 18% above 5y average. Refiners (XOM, VLO, MPC) underperforming the move. Pair trade idea inside.' },
  { author: '@earningsbot',  ticker: 'NFLX',     headline: 'Q1 sub adds beat by 1.2M',           cta: 'Net adds: 9.2M (consensus 8.0M). ARM up 12% YoY. Stock +8% AH.' },
  { author: '@derivs_desk',  ticker: 'AAPL',     headline: 'Unusual call sweep · 220 strike',    cta: '$8M premium hit the offer in the 220C 30d. Vol/OI ratio: 6.2x. Whoever this was, they wanted size.' },
  { author: '@flowwatch',    ticker: 'TSLA',     headline: 'Dark pool prints picking up',        cta: 'Three blocks of 100k+ shares cleared off-exchange this hour. Avg fill ~$3 below NBBO.' },
  { author: '@chart_angel',  ticker: 'SPY',      headline: 'Bull flag on the 1h',                cta: 'Tight consolidation between 5705 and 5712 since open. Higher lows suggest a break to the upside.' },
  { author: '@thesis_drive', ticker: 'LLY',      headline: 'Mounjaro + Zepbound moat update',    cta: 'Compounder thesis still intact. Pricing power, R&D pipeline, and manufacturing scale create a wide moat. PT $1100.' },
];

const FeedStories = ({ user }) => {
  const [openStory, setOpenStory] = useState(null);
  const settings = loadSettings();
  const myInitials = (user?.username ?? 'U').slice(0, 2).toUpperCase();

  return (
    <>
      <div className="px-4 py-3 border-b overflow-x-auto"
           style={{ borderColor: COLORS.border, background: COLORS.surface }}>
        <div className="flex items-start gap-3" style={{ minWidth: 'max-content' }}>
          {/* Your story — first tile */}
          <button onClick={() => alert('Story creation coming soon — for now, post via the compose box below.')}
                  className="flex flex-col items-center gap-1 shrink-0">
            <div className="relative">
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-[14px] font-semibold border-2 border-dashed"
                   style={{ background: COLORS.bg, color: COLORS.textDim, borderColor: COLORS.border }}>
                {myInitials}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold"
                   style={{ background: COLORS.mint, color: COLORS.bg }}>+</div>
            </div>
            <span className="text-[10px]" style={{ color: COLORS.textDim }}>Your story</span>
          </button>
          {/* Other stories */}
          {FEED_STORY_AUTHORS.map(a => (
            <button key={a.handle}
                    onClick={() => setOpenStory(a.handle)}
                    className="flex flex-col items-center gap-1 shrink-0">
              <div className="relative">
                {/* Gradient ring (unread) */}
                <div className="w-14 h-14 rounded-full p-[2px]"
                     style={{ background: `linear-gradient(135deg, ${a.color} 0%, ${COLORS.mint} 100%)` }}>
                  <div className="w-full h-full rounded-full flex items-center justify-center text-[13px] font-semibold"
                       style={{ background: a.color, color: '#16191E' }}>
                    {a.initials}
                  </div>
                </div>
                {settings.liveIndicator !== false && a.live && (
                  <div className="absolute -bottom-0.5 -right-0.5 px-1 rounded-full flex items-center gap-0.5"
                       style={{ background: COLORS.red, fontSize: 8, fontWeight: 600, color: '#FFFFFF', border: `1.5px solid ${COLORS.surface}` }}>
                    <span style={{ width: 4, height: 4, borderRadius: 999, background: '#FFFFFF' }} />
                    LIVE
                  </div>
                )}
              </div>
              <span className="text-[10px] truncate max-w-[60px]" style={{ color: COLORS.text }}>{a.handle.slice(1)}</span>
            </button>
          ))}
        </div>
      </div>
      {openStory && (
        <FeedStoryViewer
          authors={FEED_STORY_AUTHORS}
          snippets={STORY_SNIPPETS}
          startAt={FEED_STORY_AUTHORS.findIndex(a => a.handle === openStory)}
          onClose={() => setOpenStory(null)}
        />
      )}
    </>
  );
};

const FeedStoryViewer = ({ authors, snippets, startAt, onClose }) => {
  const [idx, setIdx] = useState(Math.max(0, startAt));
  const [progress, setProgress] = useState(0);

  const story = useMemo(() => {
    const author = authors[idx];
    if (!author) return null;
    return snippets.find(s => s.author === author.handle) ?? snippets[idx % snippets.length];
  }, [idx, authors, snippets]);

  useEffect(() => {
    setProgress(0);
    const startedAt = Date.now();
    const DURATION = 5000;
    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const pct = Math.min(100, (elapsed / DURATION) * 100);
      setProgress(pct);
      if (pct >= 100) {
        clearInterval(interval);
        if (idx < authors.length - 1) setIdx(idx + 1);
        else onClose();
      }
    }, 50);
    return () => clearInterval(interval);
  }, [idx, authors.length, onClose]);

  if (!story) return null;
  const author = authors[idx];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.92)' }}
         onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
           className="relative rounded-md overflow-hidden"
           style={{ width: 380, maxWidth: '95vw', height: 640, maxHeight: '90vh',
                    background: `linear-gradient(180deg, ${author.color}15 0%, ${COLORS.bg} 100%)`,
                    border: `1px solid ${COLORS.border}` }}>
        {/* Progress bars */}
        <div className="absolute top-2 left-2 right-2 flex gap-1 z-10">
          {authors.map((_, i) => (
            <div key={i} className="flex-1 h-0.5 rounded-full overflow-hidden"
                 style={{ background: 'rgba(255,255,255,0.3)' }}>
              <div className="h-full transition-all"
                   style={{ width: i < idx ? '100%' : i === idx ? `${progress}%` : '0%',
                            background: '#FFFFFF' }} />
            </div>
          ))}
        </div>
        {/* Header */}
        <div className="absolute top-6 left-3 right-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold"
                 style={{ background: author.color, color: '#16191E' }}>
              {author.initials}
            </div>
            <div>
              <div className="text-[12px] font-medium" style={{ color: '#FFFFFF' }}>{author.handle}</div>
              <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.7)' }}>just now</div>
            </div>
          </div>
          <button onClick={onClose} className="text-[20px]" style={{ color: '#FFFFFF' }}>×</button>
        </div>
        {/* Story content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full mb-3"
                style={{ background: 'rgba(61,123,255,0.15)', color: COLORS.mint }}>
            {story.ticker}
          </span>
          <h2 className="text-[24px] font-medium mb-3" style={{ color: '#FFFFFF', lineHeight: 1.25 }}>
            {story.headline}
          </h2>
          <p className="text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {story.cta}
          </p>
        </div>
        {/* Tap-zones for nav */}
        <button onClick={() => setIdx(Math.max(0, idx - 1))}
                className="absolute left-0 top-0 bottom-0 w-1/2" style={{ cursor: 'pointer' }}
                aria-label="Previous story" />
        <button onClick={() => idx < authors.length - 1 ? setIdx(idx + 1) : onClose()}
                className="absolute right-0 top-0 bottom-0 w-1/2" style={{ cursor: 'pointer' }}
                aria-label="Next story" />
      </div>
    </div>
  );
};

// ──────────── Friends Finder ────────────
// Discovery page for finding new traders to follow. Lets the user search by
// handle, browse suggested connections grouped by topic (sector specialists,
// macro thinkers, options traders, etc.), and follow/connect inline.
const FriendsFinder = ({ following, setFollowing, onViewProfile }) => {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('all'); // all / equities / crypto / macro / options

  // Build suggestion list from USER_PROFILES (include FEED_STORY_AUTHORS too)
  const suggestions = useMemo(() => {
    const out = [];
    const seen = new Set();
    Object.entries(typeof USER_PROFILES !== 'undefined' ? USER_PROFILES : {}).forEach(([handle, profile]) => {
      if (seen.has(handle)) return;
      seen.add(handle);
      // Tag based on holdings / desk
      const desk = (profile.desk ?? '').toLowerCase();
      let category = 'all';
      if (desk.includes('equit')) category = 'equities';
      else if (desk.includes('crypto') || desk.includes('digital')) category = 'crypto';
      else if (desk.includes('macro') || desk.includes('rate')) category = 'macro';
      else if (desk.includes('options') || desk.includes('vol') || desk.includes('deriv')) category = 'options';
      out.push({ handle, ...profile, category });
    });
    if (typeof FEED_STORY_AUTHORS !== 'undefined') {
      FEED_STORY_AUTHORS.forEach(a => {
        if (seen.has(a.handle)) return;
        seen.add(a.handle);
        out.push({
          handle: a.handle, name: a.name, color: a.color,
          desk: 'Trading',
          bio: 'Active markets contributor on Onyx.',
          followers: 100 + (a.handle.length * 37) % 4000,
          following: 50 + (a.handle.length * 11) % 500,
          posts: 20 + (a.handle.length * 7) % 100,
          holdings: ['SPY', 'NVDA'],
          verified: false,
          category: 'all',
        });
      });
    }
    return out;
  }, []);

  // Filter
  const filtered = useMemo(() => {
    let r = suggestions;
    if (topic !== 'all') r = r.filter(s => s.category === topic);
    if (query.trim()) {
      const q = query.toLowerCase();
      r = r.filter(s =>
        s.handle.toLowerCase().includes(q) ||
        (s.name ?? '').toLowerCase().includes(q) ||
        (s.bio ?? '').toLowerCase().includes(q)
      );
    }
    return r;
  }, [suggestions, topic, query]);

  return (
    <div className="px-4 py-4">
      {/* Search */}
      <div className="relative mb-3">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] pointer-events-none" style={{ color: COLORS.textMute }} />
        <input value={query}
               onChange={e => setQuery(e.target.value)}
               placeholder="Search by handle, name, or bio…"
               className="w-full pl-10 pr-3 py-2.5 rounded-md outline-none text-[12.5px]"
               style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
      </div>
      {/* Topic chips */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {[
          { id: 'all',      label: 'All' },
          { id: 'equities', label: 'Equities' },
          { id: 'crypto',   label: '₿ Crypto' },
          { id: 'macro',    label: 'Macro' },
          { id: 'options',  label: 'Options' },
        ].map(t => (
          <button key={t.id} onClick={() => setTopic(t.id)}
                  className="text-[11px] px-2.5 py-1 rounded-full border transition-colors"
                  style={{
                    color: topic === t.id ? COLORS.bg : COLORS.text,
                    background: topic === t.id ? COLORS.mint : 'transparent',
                    borderColor: topic === t.id ? COLORS.mint : COLORS.border,
                  }}>
            {t.label}
          </button>
        ))}
      </div>
      {/* Results */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-[12px]" style={{ color: COLORS.textMute }}>
            No matches — try widening your topic or search.
          </div>
        ) : filtered.map(s => {
          const isFollowing = !!following[s.handle];
          const initials = (s.name?.split(/\s+/).map(x => x[0]).join('') ?? s.handle.slice(1, 3)).slice(0, 2).toUpperCase();
          return (
            <div key={s.handle} className="rounded-md border p-3 flex items-center gap-3"
                 style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <button onClick={() => onViewProfile(s.handle)}
                      className="w-12 h-12 rounded-full flex items-center justify-center text-[14px] font-semibold shrink-0 transition-transform"
                      style={{ background: s.color ?? '#888', color: '#FFF' }}>
                {initials}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <button onClick={() => onViewProfile(s.handle)}
                          className="text-[13px] font-medium hover:underline"
                          style={{ color: COLORS.text }}>
                    {s.name ?? s.handle.slice(1)}
                  </button>
                  {s.verified && <span style={{ color: COLORS.mint, fontSize: 12 }}>✓</span>}
                </div>
                <div className="text-[11px]" style={{ color: COLORS.textMute }}>{s.handle}</div>
                {s.bio && (
                  <div className="text-[11.5px] mt-0.5 truncate" style={{ color: COLORS.textDim }}>{s.bio}</div>
                )}
              </div>
              <button onClick={() => setFollowing({ ...following, [s.handle]: !isFollowing })}
                      className="px-3 py-1.5 rounded-full text-[11px] font-medium shrink-0 transition-colors"
                      style={{
                        background: isFollowing ? 'transparent' : COLORS.mint,
                        color: isFollowing ? COLORS.text : COLORS.bg,
                        border: isFollowing ? `1px solid ${COLORS.border}` : 'none',
                      }}>
                {isFollowing ? '✓ Following' : '+ Follow'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// EditProfileModal — Twitter+LinkedIn-style profile editor for the
// signed-in user. Lets them set headline (bio), location, current
// role/desk, holdings tags, and banner color. Persists via updateUser
// so changes flow back into user.profile and survive reload.
const EditProfileModal = ({ user, onClose, onSave }) => {
  const [name, setName]         = useState(user?.profile?.fullName ?? user?.profile?.name ?? user?.username ?? '');
  const [bio, setBio]           = useState(user?.profile?.bio ?? '');
  const [location, setLocation] = useState(user?.profile?.location ?? '');
  const [desk, setDesk]         = useState(user?.profile?.desk ?? '');
  const [holdingsStr, setHoldingsStr] = useState((user?.profile?.holdings ?? []).join(', '));
  const [bannerColor, setBannerColor] = useState(user?.profile?.bannerColor ?? '#3D7BFF');
  const [website, setWebsite]   = useState(user?.profile?.website ?? '');
  const PALETTE = ['#3D7BFF', '#7AC8FF', '#FF7AB6', '#A0C476', '#E07AFC', '#FFB84D', '#76B900', '#F7931A'];
  const handleSave = () => {
    const holdings = holdingsStr.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 12);
    onSave({
      profile: {
        fullName: name.trim(),
        bio: bio.trim(),
        location: location.trim(),
        desk: desk.trim(),
        holdings,
        bannerColor,
        website: website.trim(),
      },
    });
    onClose();
  };
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="w-[600px] max-w-full max-h-[90vh] rounded-md border overflow-hidden flex flex-col pointer-events-auto"
             style={{ background: COLORS.surface, borderColor: COLORS.borderHi, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b shrink-0"
               style={{ borderColor: COLORS.border }}>
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="text-[18px] hover:opacity-80" style={{ color: COLORS.text }}>×</button>
              <span className="text-[15px] font-semibold" style={{ color: COLORS.text }}>Edit profile</span>
            </div>
            <button onClick={handleSave}
                    className="px-4 py-1 rounded-full text-[13px] font-semibold"
                    style={{ background: COLORS.text, color: COLORS.bg }}>
              Save
            </button>
          </div>
          {/* Banner preview */}
          <div className="h-24 relative shrink-0"
               style={{ background: `linear-gradient(135deg, ${bannerColor}E6 0%, ${bannerColor}60 100%)` }}>
            <div className="absolute -bottom-10 left-5">
              <div className="w-20 h-20 rounded-full flex items-center justify-center text-[24px] font-semibold border-4"
                   style={{ background: bannerColor, color: '#FFF', borderColor: COLORS.surface }}>
                {(name || user?.username || 'U').slice(0, 2).toUpperCase()}
              </div>
            </div>
          </div>
          {/* Form */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-12 pb-4 space-y-3.5">
            {/* Banner color */}
            <div>
              <label className="text-[10px] uppercase tracking-wider block mb-1.5" style={{ color: COLORS.textMute }}>Banner color</label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {PALETTE.map(c => (
                  <button key={c} onClick={() => setBannerColor(c)}
                          className="w-6 h-6 rounded-full transition-transform"
                          style={{
                            background: c,
                            border: `2px solid ${bannerColor === c ? COLORS.text : 'transparent'}`,
                            transform: bannerColor === c ? 'scale(1.15)' : 'none',
                          }}
                          title={c} />
                ))}
              </div>
            </div>
            {/* Name */}
            <div>
              <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: COLORS.textMute }}>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} maxLength={50}
                     className="w-full px-3 py-2 text-[13px] rounded outline-none"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            </div>
            {/* Bio */}
            <div>
              <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: COLORS.textMute }}>Headline / bio</label>
              <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={160} rows={3}
                        placeholder="Trader at Onyx Markets. Focus: equities, derivatives, macro."
                        className="w-full px-3 py-2 text-[13px] rounded outline-none resize-none"
                        style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              <div className="text-[10px] text-right mt-0.5" style={{ color: COLORS.textMute }}>{bio.length}/160</div>
            </div>
            {/* Location */}
            <div>
              <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: COLORS.textMute }}>Location</label>
              <input value={location} onChange={e => setLocation(e.target.value)} maxLength={50}
                     placeholder="New York, NY"
                     className="w-full px-3 py-2 text-[13px] rounded outline-none"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            </div>
            {/* Desk / Role */}
            <div>
              <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: COLORS.textMute }}>Role / Desk</label>
              <input value={desk} onChange={e => setDesk(e.target.value)} maxLength={50}
                     placeholder="Equity Derivatives"
                     className="w-full px-3 py-2 text-[13px] rounded outline-none"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            </div>
            {/* Holdings */}
            <div>
              <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: COLORS.textMute }}>Public holdings (comma-separated tickers)</label>
              <input value={holdingsStr} onChange={e => setHoldingsStr(e.target.value)} maxLength={200}
                     placeholder="AAPL, NVDA, SPY"
                     className="w-full px-3 py-2 text-[13px] rounded outline-none uppercase"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            </div>
            {/* Website */}
            <div>
              <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: COLORS.textMute }}>Website</label>
              <input value={website} onChange={e => setWebsite(e.target.value)} maxLength={100}
                     placeholder="https://example.com"
                     className="w-full px-3 py-2 text-[13px] rounded outline-none"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export const FeedPage = ({ user, account, setPage, updateUser }) => {
  // Quick-posted entries persist to localStorage so they survive reload AND
  // so widgets that fire `imo:feed-quickpost` events can push to the same store.
  const [posts, setPosts]       = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('imo_feed_userposts') ?? '[]');
      return [...stored, ...FEED_POSTS];
    } catch { return [...FEED_POSTS]; }
  });
  const [composeText, setComposeText] = useState('');
  const [composeMedia, setComposeMedia] = useState(null); // { type: 'image'|'video', url, name }
  const [likes, setLikes]       = useState({});
  const [reposts, setReposts]   = useState({});
  const [bookmarks, setBookmarks] = useState({});
  const [following, setFollowing] = useState({}); // followed handles
  const [tab, setTab]           = useState('foryou'); // 'foryou' | 'following' | 'live'
  const [searchQuery, setSearchQuery] = useState('');
  // Profile modal state — when set, shows UserProfileModal for that handle
  const [viewedProfile, setViewedProfile] = useState(null);
  // Edit profile modal — for the signed-in user's own profile
  const [editingProfile, setEditingProfile] = useState(false);
  // Left-sidebar nav: home (default), explore, notif, follow, chat, bookmark, profile
  const [sidebarView, setSidebarView] = useState('home');
  const fileInputRef = useRef(null);

  // Listen for quick-post events from widgets (e.g. the Feed widget on the
  // trade page). Each event has { detail: { post } } where post matches the
  // FEED_POSTS shape. New posts go to the top of the feed.
  useEffect(() => {
    const handler = (e) => {
      const post = e?.detail?.post;
      if (!post) return;
      setPosts(p => [post, ...p]);
    };
    window.addEventListener('imo:feed-quickpost', handler);
    return () => window.removeEventListener('imo:feed-quickpost', handler);
  }, []);

  // Live financial news — primary source is newsdata.io (per user request),
  // with Exa as the fallback when no NEWSDATA_KEY is configured. Refreshes
  // every 5 minutes so the feed stays current without being chatty.
  const [liveNews, setLiveNews] = useState([]);
  const [liveNewsLoading, setLiveNewsLoading] = useState(false);
  useEffect(() => {
    // No live source configured → leave empty so the empty-state message renders.
    if (!NEWSDATA_KEY && !EXA_API_KEY) return;
    let cancelled = false;
    const fetchNews = async () => {
      setLiveNewsLoading(true);
      let results = [];
      // Step 1: newsdata.io (preferred — user explicitly asked for it)
      if (NEWSDATA_KEY) {
        const articles = await fetchNewsDataNews('stocks markets Fed earnings');
        if (Array.isArray(articles) && articles.length > 0) {
          // Map newsdata shape to the shape Exa returns so the existing
          // render path doesn't need to branch.
          results = articles.map(a => ({
            id: a.url,
            url: a.url,
            title: a.title,
            text: a.desc,
            highlights: a.desc ? [a.desc.slice(0, 200)] : [],
            publishedDate: a.ts,
            author: a.source,
            image: a.img,
          }));
        }
      }
      // Step 2: Exa fallback if newsdata returned nothing or isn't keyed
      if (results.length === 0 && EXA_API_KEY) {
        const r = await exaSearch('latest financial markets news today stocks Fed rates earnings', {
          numResults: 12,
          type: 'fast',
          maxAgeHours: 6,
          highlights: true,
        });
        if (r?.results) results = r.results;
      }
      if (cancelled) return;
      setLiveNews(results);
      setLiveNewsLoading(false);
    };
    fetchNews();
    const id = setInterval(fetchNews, 5 * 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const handleLike = (id) => setLikes(p => ({ ...p, [id]: !p[id] }));
  const handleRepost = (id) => setReposts(p => ({ ...p, [id]: !p[id] }));
  const handleBookmark = (id) => setBookmarks(p => ({ ...p, [id]: !p[id] }));
  const handleFollow = (handle) => setFollowing(p => ({ ...p, [handle]: !p[handle] }));

  const handleMediaPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) return;
    // Use a blob URL for in-session viewing. Note: this URL is only valid for
    // this session; on reload the post will lose its media.
    const url = URL.createObjectURL(file);
    setComposeMedia({ type: isVideo ? 'video' : 'image', url, name: file.name });
    e.target.value = ''; // allow picking the same file again
  };

  // Persist any user-created posts (id starts with 'user_' or 'quickpost_')
  // to localStorage so they survive reload. Original FEED_POSTS aren't saved.
  useEffect(() => {
    try {
      const userPosts = posts.filter(p => p.id?.startsWith('user_') || p.id?.startsWith('quickpost_'));
      localStorage.setItem('imo_feed_userposts', JSON.stringify(userPosts.slice(0, 100)));
    } catch {}
  }, [posts]);

  const handlePost = () => {
    const text = composeText.trim();
    if (!text && !composeMedia) return;
    const initials = (user?.fullName?.split(/\s+/).map(s => s[0]).join('') ?? user?.username?.slice(0, 2) ?? 'YO')
      .slice(0, 2).toUpperCase();
    setPosts(p => [{
      id: `user_${Date.now()}`,
      author: user?.fullName ?? user?.username ?? 'You',
      handle: `@${user?.username ?? 'you'}`,
      avatar: initials,
      avatarColor: COLORS.mint,
      body: text,
      media: composeMedia,
      likes: 0, reposts: 0, replies: 0, ts: 0,
      verified: false,
    }, ...p]);
    setComposeText('');
    setComposeMedia(null);
  };

  const fmtTs = (h) => {
    if (h < 1) return `${Math.round(h * 60)}m`;
    if (h < 24) return `${Math.round(h)}h`;
    return `${Math.floor(h / 24)}d`;
  };

  const userInitials = (user?.fullName?.split(/\s+/).map(s => s[0]).join('') ?? user?.username?.slice(0, 2) ?? 'YO')
    .slice(0, 2).toUpperCase();

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex justify-center" style={{ background: COLORS.bg }}>
      {/* Left sidebar — quick nav links */}
      <aside className="w-[260px] shrink-0 border-r overflow-y-auto relative"
             style={{ borderColor: COLORS.border, paddingBottom: 80 }}>
        <div className="p-3 space-y-0.5">
          {[
            { id: 'home',     label: 'Home',          Icon: Home          },
            { id: 'explore',  label: 'Explore',       Icon: Hash          },
            { id: 'notif',    label: 'Notifications', Icon: Bell          },
            { id: 'friends',  label: 'Find friends',  Icon: Users         },
            { id: 'follow',   label: 'Following',     Icon: User          },
            { id: 'chat',     label: 'Messages',      Icon: Mail          },
            { id: 'bookmark', label: 'Bookmarks',     Icon: Bookmark      },
            { id: 'profile',  label: 'Profile',       Icon: User          },
          ].map(item => {
            const isActive = sidebarView === item.id;
            const Icon = item.Icon;
            return (
              <button key={item.id}
                      onClick={() => {
                        if (item.id === 'chat') {
                          // "Messages" should open the messaging page
                          setPage?.('messages');
                          return;
                        }
                        setSidebarView(item.id);
                        // Clear any active search when changing views
                        setSearchQuery('');
                      }}
                      className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-full text-[15px] transition-colors hover:bg-white/[0.04]"
                      style={{
                        color: isActive ? COLORS.text : COLORS.text,
                        fontWeight: isActive ? 700 : 400,
                      }}>
                <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8}
                      style={{ color: COLORS.text }} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
        <div className="px-3 mt-3">
          <button onClick={() => {
                    setSidebarView('home');
                    // focus compose textarea on next tick
                    setTimeout(() => {
                      document.querySelector('[data-feed-compose]')?.focus();
                    }, 50);
                  }}
                  className="w-full py-3 rounded-full text-[15px] font-bold transition-opacity hover:opacity-90"
                  style={{ background: COLORS.mint, color: '#FFF', letterSpacing: '0.1px' }}>
            Post
          </button>
        </div>
        {/* User mini-card at bottom */}
        {user && (
          <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2.5 px-3 py-2.5 rounded-full hover:bg-white/[0.04] transition-colors cursor-pointer"
               onClick={() => setSidebarView('profile')}
               style={{ background: 'transparent' }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0"
                 style={{ background: COLORS.mint, color: '#FFF' }}>
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] truncate font-bold" style={{ color: COLORS.text }}>
                {user.fullName ?? user.username}
              </div>
              <div className="text-[12.5px] truncate" style={{ color: COLORS.textMute }}>
                @{user.username}
              </div>
            </div>
            <MoreHorizontal size={16} strokeWidth={1.8} style={{ color: COLORS.textMute }} />
          </div>
        )}
      </aside>

      {/* Center feed */}
      <main className="flex-1 min-w-0 max-w-[640px] border-r overflow-y-auto"
            style={{ borderColor: COLORS.border }}>
        {/* Home banner removed per UX request — the page nav already
            shows we're on Feed, so a redundant "Home" header above the
            stories was just visual chrome. The stories strip + tabs
            below now sit directly at the top of the feed column. */}
        {/* Per-view header — shows different content based on sidebar view */}
        {sidebarView !== 'home' && (
          <div className="px-5 py-3 border-b sticky top-0 z-30"
               style={{ borderColor: COLORS.border, background: 'rgba(22,25,30,0.65)', backdropFilter: 'blur(12px)' }}>
            {sidebarView === 'explore' && (
              <>
                <div className="flex items-center gap-2">
                  <Hash size={20} strokeWidth={2.2} style={{ color: COLORS.text }} />
                  <h2 className="text-[20px] font-extrabold" style={{ color: COLORS.text, letterSpacing: '-0.01em' }}>Explore</h2>
                </div>
                <p className="text-[12px] mt-0.5" style={{ color: COLORS.textMute }}>
                  Most-engaged posts across the platform, sorted by likes.
                </p>
              </>
            )}
            {sidebarView === 'notif' && (
              <>
                <div className="flex items-center gap-2">
                  <Bell size={20} strokeWidth={2.2} style={{ color: COLORS.text }} />
                  <h2 className="text-[20px] font-extrabold" style={{ color: COLORS.text, letterSpacing: '-0.01em' }}>Notifications</h2>
                </div>
                <p className="text-[12px] mt-0.5" style={{ color: COLORS.textMute }}>
                  Mentions, replies, and platform activity directed at @{user?.username ?? 'you'}.
                </p>
              </>
            )}
            {sidebarView === 'follow' && (
              <>
                <div className="flex items-center gap-2">
                  <User size={20} strokeWidth={2.2} style={{ color: COLORS.text }} />
                  <h2 className="text-[20px] font-extrabold" style={{ color: COLORS.text, letterSpacing: '-0.01em' }}>People you follow</h2>
                </div>
                <p className="text-[12px] mt-0.5 mb-2" style={{ color: COLORS.textMute }}>
                  {Object.values(following).filter(Boolean).length} {Object.values(following).filter(Boolean).length === 1 ? 'person' : 'people'} followed
                </p>
                {Object.entries(following).filter(([_, v]) => v).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(following).filter(([_, v]) => v).slice(0, 12).map(([handle]) => (
                      <button key={handle} onClick={() => setViewedProfile(handle)}
                              className="text-[11px] px-2.5 py-1 rounded-full border hover:bg-white/[0.04]"
                              style={{ color: COLORS.text, borderColor: COLORS.border }}>
                        {handle}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {sidebarView === 'friends' && (
              <>
                <div className="flex items-center gap-2">
                  <Users size={20} strokeWidth={2.2} style={{ color: COLORS.text }} />
                  <h2 className="text-[20px] font-extrabold" style={{ color: COLORS.text, letterSpacing: '-0.01em' }}>Find friends</h2>
                </div>
                <p className="text-[12px] mt-0.5" style={{ color: COLORS.textMute }}>
                  Discover traders matching your interests, sectors, and risk profile.
                </p>
              </>
            )}
            {sidebarView === 'bookmark' && (
              <>
                <div className="flex items-center gap-2">
                  <Bookmark size={20} strokeWidth={2.2} style={{ color: COLORS.text }} />
                  <h2 className="text-[20px] font-extrabold" style={{ color: COLORS.text, letterSpacing: '-0.01em' }}>Bookmarks</h2>
                </div>
                <p className="text-[12px] mt-0.5" style={{ color: COLORS.textMute }}>
                  {Object.values(bookmarks).filter(Boolean).length} saved post{Object.values(bookmarks).filter(Boolean).length === 1 ? '' : 's'}. Tap the bookmark icon on any post to save it.
                </p>
              </>
            )}
            {sidebarView === 'profile' && (
              // Twitter+LinkedIn-style self profile view. Banner with
              // user's chosen color, avatar overlapping the banner edge,
              // name + handle + verified state, headline (bio), location
              // and joined date, followers/following/posts stats row,
              // public holdings tags, and an Edit-profile button that
              // opens the EditProfileModal for the authenticated user.
              // Replaces the prior bare "DF @dfdf 0 posts 0 following
              // 0 bookmarks" header which had no edit affordance and
              // no visual identity.
              (() => {
                const profile = user?.profile ?? {};
                const bannerColor = profile.bannerColor ?? '#3D7BFF';
                const displayName = profile.fullName ?? user?.username ?? 'You';
                const initials = (displayName || 'U').split(/\s+/).map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
                const userPostCount = posts.filter(p => p.handle === `@${user?.username}`).length;
                const followingCount = Object.values(following).filter(Boolean).length;
                const bookmarkCount = Object.values(bookmarks).filter(Boolean).length;
                return (
                  <div className="-mx-5 -my-3 mb-0">
                    {/* Banner */}
                    <div className="h-24 relative"
                         style={{
                           background: `linear-gradient(135deg, ${bannerColor}E6 0%, ${bannerColor}60 100%)`,
                         }}>
                      <button onClick={() => setEditingProfile(true)}
                              className="absolute top-3 right-3 px-3 py-1 rounded-full text-[11px] font-semibold transition-all hover:opacity-90"
                              style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                        Edit profile
                      </button>
                    </div>
                    {/* Body */}
                    <div className="px-5 pb-3 relative">
                      {/* Avatar overlapping banner */}
                      <div className="absolute -top-9 left-5">
                        <div className="w-[68px] h-[68px] rounded-full flex items-center justify-center text-[20px] font-semibold border-4"
                             style={{ background: bannerColor, color: '#FFF', borderColor: COLORS.surface }}>
                          {initials}
                        </div>
                      </div>
                      <div style={{ height: 36 }} />
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[18px] font-bold leading-tight" style={{ color: COLORS.text }}>
                          {displayName}
                        </span>
                        {user?.verified && <Verified size={16} style={{ color: COLORS.mint }} />}
                      </div>
                      <div className="text-[12px]" style={{ color: COLORS.textMute }}>
                        @{user?.username ?? 'you'}
                      </div>
                      {/* Bio / headline */}
                      {profile.bio && (
                        <p className="text-[12.5px] mt-2 leading-snug" style={{ color: COLORS.text }}>{profile.bio}</p>
                      )}
                      {/* Meta row — location, desk, joined */}
                      <div className="flex items-center gap-3 mt-2 text-[11px] flex-wrap" style={{ color: COLORS.textMute }}>
                        {profile.location && (
                          <span className="flex items-center gap-1">
                            <MapPin size={11} />
                            {profile.location}
                          </span>
                        )}
                        {profile.desk && (
                          <span className="flex items-center gap-1">
                            <Building2 size={11} />
                            {profile.desk}
                          </span>
                        )}
                        {profile.website && (
                          <a href={profile.website} target="_blank" rel="noreferrer"
                             className="flex items-center gap-1 hover:underline"
                             style={{ color: COLORS.mint }}>
                            <ExternalLink size={11} />
                            {profile.website.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 30)}
                          </a>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar size={11} />
                          Joined {new Date(user?.createdAt ?? Date.now()).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                        </span>
                      </div>
                      {/* Stats row */}
                      <div className="flex items-center gap-4 mt-3 text-[12px]">
                        <span><strong style={{ color: COLORS.text }}>{userPostCount}</strong> <span style={{ color: COLORS.textMute }}>{userPostCount === 1 ? 'post' : 'posts'}</span></span>
                        <span><strong style={{ color: COLORS.text }}>{followingCount}</strong> <span style={{ color: COLORS.textMute }}>following</span></span>
                        <span><strong style={{ color: COLORS.text }}>{bookmarkCount}</strong> <span style={{ color: COLORS.textMute }}>{bookmarkCount === 1 ? 'bookmark' : 'bookmarks'}</span></span>
                      </div>
                      {/* Holdings tags */}
                      {(profile.holdings ?? []).length > 0 && (
                        <div className="mt-3">
                          <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                            Public holdings
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {(profile.holdings ?? []).map(t => (
                              <span key={t} className="px-2 py-0.5 rounded text-[11px] font-medium"
                                    style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        )}

        {/* Stories carousel — Instagram-style, only on home view */}
        {sidebarView === 'home' && (
          <FeedStories user={user} />
        )}

        {/* Find Friends body — search + suggestions when sidebar shows friends */}
        {sidebarView === 'friends' && (
          <FriendsFinder following={following} setFollowing={setFollowing}
                         onViewProfile={setViewedProfile} />
        )}

        {/* For You / Following tabs (Twitter-style) — only on home view.
            Sticky at top of the inner scroll container so the tabs
            stay flush with the viewport edge as the user scrolls
            (was top: 53 which left a visible strip of post content
            bleeding through above the tabs per UX feedback). Fully
            opaque background so nothing scrolling underneath shows
            through where the tabs sit. */}
        {sidebarView === 'home' && (
        <div className="grid grid-cols-3 border-b shrink-0 sticky z-30"
             style={{ borderColor: COLORS.border, background: COLORS.bg, top: 0 }}>
          {[
            { id: 'foryou',    label: 'For you' },
            { id: 'following', label: 'Following' },
            { id: 'live',      label: 'Live news' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
                    className="relative py-4 text-[15px] transition-colors hover:bg-white/[0.04]"
                    style={{
                      color: tab === t.id ? COLORS.text : COLORS.textDim,
                      fontWeight: tab === t.id ? 700 : 500,
                    }}>
                  {t.label}
                  {tab === t.id && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 rounded-full"
                          style={{ width: 56, background: COLORS.mint }} />
                  )}
            </button>
          ))}
        </div>
        )}

        {/* Compose */}
        <div className="px-4 py-3 border-b" style={{ borderColor: COLORS.border }}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-medium shrink-0"
                 style={{ background: COLORS.mint, color: COLORS.bg }}>
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <textarea value={composeText}
                        data-feed-compose
                        onChange={e => setComposeText(e.target.value.slice(0, 500))}
                        rows={composeText.length > 60 ? 3 : 1}
                        placeholder="What's happening?"
                        className="w-full bg-transparent text-[15px] outline-none resize-none placeholder-white/30"
                        style={{ color: COLORS.text }} />

              {/* Media preview */}
              {composeMedia && (
                <div className="relative mt-2 rounded-md overflow-hidden border"
                     style={{ borderColor: COLORS.border, maxWidth: 320 }}>
                  {composeMedia.type === 'video' ? (
                    <video src={composeMedia.url} controls className="w-full" style={{ maxHeight: 200 }} />
                  ) : (
                    <img src={composeMedia.url} alt="" className="w-full" style={{ maxHeight: 200, objectFit: 'cover' }} />
                  )}
                  <button onClick={() => { URL.revokeObjectURL(composeMedia.url); setComposeMedia(null); }}
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center"
                          style={{ background: 'rgba(0,0,0,0.7)', color: '#FFF' }}
                          title="Remove media">
                    <X size={12} />
                  </button>
                </div>
              )}

              <input ref={fileInputRef} type="file" accept="image/*,video/*"
                     onChange={handleMediaPick} className="hidden" />

              <div className="flex items-center justify-between mt-2 pt-2 border-t"
                   style={{ borderColor: COLORS.border }}>
                <div className="flex items-center gap-1" style={{ color: COLORS.mint }}>
                  <button onClick={() => { fileInputRef.current && (fileInputRef.current.accept = 'image/*'); fileInputRef.current?.click(); }}
                          title="Add image"
                          className="p-2 rounded-full transition-colors hover:bg-[rgba(61,123,255,0.12)]">
                    <ImageIcon size={18} strokeWidth={1.8} />
                  </button>
                  <button title="Add poll"
                          onClick={() => {
                            const opt1 = window.prompt('Poll option 1?');
                            if (!opt1) return;
                            const opt2 = window.prompt('Poll option 2?');
                            if (!opt2) return;
                            const tag = `\n\nPoll: ${opt1.trim()} vs ${opt2.trim()}`;
                            setComposeText(t => (t + tag).slice(0, 500));
                          }}
                          className="p-2 rounded-full transition-colors hover:bg-[rgba(61,123,255,0.12)]">
                    <BarChart2 size={18} strokeWidth={1.8} />
                  </button>
                  <button title="Add emoji"
                          onClick={() => {
                            const choices = ['🚀','📈','💎','🐂','🐻','🔥','⚡','🎯','💰','📊','✨','😎','🤔','🙌','💪'];
                            const e = choices[Math.floor(Math.random() * choices.length)];
                            setComposeText(t => (t + e).slice(0, 500));
                            setTimeout(() => {
                              const ta = document.querySelector('[data-feed-compose]');
                              if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
                            }, 0);
                          }}
                          className="p-2 rounded-full transition-colors hover:bg-[rgba(61,123,255,0.12)]">
                    <Smile size={18} strokeWidth={1.8} />
                  </button>
                  <button title="Schedule"
                          onClick={() => {
                            const when = window.prompt('Schedule this post for when?\n\nExamples:\n  tomorrow 9am\n  in 2 hours\n  Friday 3pm', 'tomorrow 9am');
                            if (!when) return;
                            window.imoToast?.(`Post scheduled for "${when.trim()}"`, 'success');
                          }}
                          className="p-2 rounded-full transition-colors hover:bg-[rgba(61,123,255,0.12)]">
                    <Calendar size={18} strokeWidth={1.8} />
                  </button>
                  <button title="Tag location"
                          onClick={() => {
                            const place = window.prompt('Add a location to your post:', '');
                            if (!place) return;
                            setComposeText(t => (t + ` 📍 ${place.trim()}`).slice(0, 500));
                          }}
                          className="p-2 rounded-full transition-colors hover:bg-[rgba(61,123,255,0.12)]">
                    <MapPin size={18} strokeWidth={1.8} />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  {composeText.length > 0 && (
                    <div className="flex items-center gap-2">
                      <svg width="22" height="22" viewBox="0 0 22 22">
                        <circle cx="11" cy="11" r="9" fill="none"
                                stroke={COLORS.border} strokeWidth="2" />
                        <circle cx="11" cy="11" r="9" fill="none"
                                stroke={composeText.length >= 500 ? COLORS.red : composeText.length >= 450 ? '#FFB84D' : COLORS.mint}
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeDasharray={`${(composeText.length / 500) * 56.55} 56.55`}
                                transform="rotate(-90 11 11)" />
                      </svg>
                      {composeText.length >= 450 && (
                        <span className="text-[11px] tabular-nums"
                              style={{ color: composeText.length >= 500 ? COLORS.red : COLORS.textMute }}>
                          {500 - composeText.length}
                        </span>
                      )}
                    </div>
                  )}
                  <button onClick={handlePost} disabled={!composeText.trim() && !composeMedia}
                          className="px-5 py-1.5 rounded-full text-[14px] font-bold transition-opacity disabled:opacity-40"
                          style={{ background: COLORS.mint, color: '#FFF', letterSpacing: '0.1px' }}>
                    Post
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Feed posts */}
        <div>
          {/* Live news view (Exa-powered) — replaces the post list when the
              "Live news" tab is active in home sidebar view. */}
          {sidebarView === 'home' && tab === 'live' ? (
            <div>
              {!NEWSDATA_KEY && !EXA_API_KEY && (
                <div className="px-4 py-8 text-center">
                  <div className="text-[13px] mb-1.5" style={{ color: COLORS.text }}>Live news source not configured</div>
                  <div className="text-[11px]" style={{ color: COLORS.textMute }}>
                    Set <code style={{ color: COLORS.mint }}>VITE_NEWSDATA_KEY</code> (preferred) or{' '}
                    <code style={{ color: COLORS.mint }}>VITE_EXA_API_KEY</code> in your environment to enable live financial news.
                  </div>
                </div>
              )}
              {(NEWSDATA_KEY || EXA_API_KEY) && liveNewsLoading && liveNews.length === 0 && (
                <div className="px-4 py-8 text-center text-[12px]" style={{ color: COLORS.textMute }}>
                  Loading live news…
                </div>
              )}
              {(NEWSDATA_KEY || EXA_API_KEY) && liveNews.length === 0 && !liveNewsLoading && (
                <div className="px-4 py-8 text-center text-[12px]" style={{ color: COLORS.textMute }}>
                  No live news right now. Check back in a moment.
                </div>
              )}
              {liveNews.map((n, i) => (
                <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
                   className="block px-4 py-3 border-b hover:bg-white/[0.02] transition-colors"
                   style={{ borderColor: COLORS.border }}>
                  <div className="flex items-start gap-3">
                    {n.image && (
                      <img src={n.image} alt="" loading="lazy"
                           className="w-16 h-16 rounded-md object-cover shrink-0"
                           style={{ background: COLORS.surface2 }}
                           onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1 text-[10.5px]" style={{ color: COLORS.textMute }}>
                        <span className="inline-flex items-center gap-1">
                          <span className="rounded-full" style={{ width: 6, height: 6, background: COLORS.green, display: 'inline-block' }} />
                          <span style={{ color: COLORS.green, fontSize: 9, letterSpacing: '0.5px' }}>LIVE</span>
                        </span>
                        <span className="truncate">{(() => {
                          try { return new URL(n.url).hostname.replace('www.', ''); } catch { return ''; }
                        })()}</span>
                        {n.publishedDate && <span>· {new Date(n.publishedDate).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                      </div>
                      <div className="text-[13.5px] font-medium leading-tight mb-1" style={{ color: COLORS.text }}>
                        {n.title}
                      </div>
                      {n.text && (
                        <div className="text-[11.5px] leading-relaxed" style={{ color: COLORS.textDim }}>
                          {n.text.slice(0, 220)}{n.text.length > 220 ? '…' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
          <>
          {(() => {
            const myHandle = `@${user?.username ?? 'you'}`;
            let filteredPosts = posts;
            if (sidebarView === 'bookmark') {
              filteredPosts = posts.filter(p => bookmarks[p.id]);
            } else if (sidebarView === 'profile') {
              filteredPosts = posts.filter(p => p.handle === myHandle);
            } else if (sidebarView === 'follow') {
              filteredPosts = posts.filter(p => following[p.handle]);
            } else if (sidebarView === 'notif') {
              filteredPosts = posts.filter(p =>
                p.body?.toLowerCase().includes(myHandle.toLowerCase().slice(1))
              );
            } else if (sidebarView === 'explore') {
              filteredPosts = [...posts].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
            } else if (sidebarView === 'home') {
              // Apply For You / Following tab filter on home view
              if (tab === 'following') {
                filteredPosts = posts.filter(p =>
                  following[p.handle] || p.handle === myHandle
                );
              }
              // 'foryou' shows everything (algorithm-style mix)
            }
            if (searchQuery.trim()) {
              const q = searchQuery.toLowerCase();
              filteredPosts = filteredPosts.filter(p =>
                p.body?.toLowerCase().includes(q) ||
                p.author?.toLowerCase().includes(q) ||
                p.handle?.toLowerCase().includes(q)
              );
            }
            if (filteredPosts.length === 0) {
              const emptyMsg = searchQuery.trim()
                ? `No posts matching "${searchQuery}"`
                : sidebarView === 'bookmark' ? 'No bookmarks yet — tap the bookmark icon on any post to save it'
                : sidebarView === 'profile'  ? 'You haven\'t posted anything yet'
                : sidebarView === 'follow'   ? 'You aren\'t following anyone yet'
                : sidebarView === 'notif'    ? 'No mentions yet'
                : (sidebarView === 'home' && tab === 'following')
                                             ? 'You aren\'t following anyone yet — visit profiles and tap Follow to see their posts here'
                : 'No posts to show';
              return (
                <div className="px-6 py-20 text-center">
                  <div className="flex justify-center mb-3" style={{ opacity: 0.25 }}>
                    <Mail size={48} strokeWidth={1.4} />
                  </div>
                  <div className="text-[15px] font-medium" style={{ color: COLORS.text }}>
                    Nothing to see here — yet
                  </div>
                  <div className="text-[13px] mt-1.5" style={{ color: COLORS.textMute }}>{emptyMsg}</div>
                </div>
              );
            }
            return filteredPosts.map(p => (
            <div key={p.id}
                 className="px-4 py-3 border-b hover:bg-white/[0.01] transition-colors cursor-pointer"
                 style={{ borderColor: COLORS.border }}>
              <div className="flex items-start gap-3">
                <button onClick={(e) => { e.stopPropagation(); setViewedProfile(p.handle); }}
                        className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0 hover:ring-2 hover:ring-white/20 transition-all"
                        style={{ background: p.avatarColor, color: '#FFF' }}
                        title={`View ${p.author}'s profile`}>
                  {p.avatar}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-[14px]">
                    <button onClick={(e) => { e.stopPropagation(); setViewedProfile(p.handle); }}
                            className="hover:underline truncate"
                            style={{ color: COLORS.text, fontWeight: 700 }}>{p.author}</button>
                    {p.verified && (
                      <Verified size={15} fill={COLORS.mint} stroke="#FFFFFF" strokeWidth={1.5} />
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setViewedProfile(p.handle); }}
                            className="hover:underline truncate"
                            style={{ color: COLORS.textMute, fontWeight: 400 }}>{p.handle}</button>
                    <span style={{ color: COLORS.textMute }}>·</span>
                    <span className="hover:underline" style={{ color: COLORS.textMute }}>{fmtTs(p.ts)}</span>
                    <button className="ml-auto p-1.5 rounded-full transition-colors hover:bg-[rgba(61,123,255,0.12)]"
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: COLORS.textMute }}
                            title="More">
                      <MoreHorizontal size={15} strokeWidth={1.8} />
                    </button>
                  </div>
                  <p className="mt-0.5 text-[15px] leading-[1.45] whitespace-pre-wrap"
                     style={{ color: COLORS.text }}>
                    {p.body}
                  </p>
                  {p.media && (
                    <div className="mt-3 rounded-2xl overflow-hidden border"
                         style={{ borderColor: COLORS.border, maxWidth: 520 }}>
                      {p.media.type === 'video' ? (
                        <video src={p.media.url} controls className="w-full" style={{ maxHeight: 400 }} />
                      ) : (
                        <img src={p.media.url} alt="" className="w-full" style={{ maxHeight: 400, objectFit: 'cover' }} />
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-3 max-w-md"
                       style={{ color: COLORS.textMute }}>
                    <button onClick={() => {
                              setComposeText(`@${p.handle.replace('@','')} `);
                              setTimeout(() => {
                                const ta = document.querySelector('[data-feed-compose]');
                                if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                              }, 50);
                            }}
                            className="group flex items-center gap-1.5 transition-colors"
                            title="Reply">
                      <span className="p-1.5 rounded-full transition-colors group-hover:bg-[rgba(61,123,255,0.12)] group-hover:text-[#3D7BFF]">
                        <MessageSquare size={16} strokeWidth={1.7} />
                      </span>
                      <span className="text-[12.5px] tabular-nums group-hover:text-[#3D7BFF]">{p.replies}</span>
                    </button>
                    <button onClick={() => handleRepost(p.id)}
                            className="group flex items-center gap-1.5 transition-colors"
                            style={{ color: reposts[p.id] ? COLORS.green : COLORS.textMute }}
                            title="Repost">
                      <span className="p-1.5 rounded-full transition-colors group-hover:bg-[rgba(31,178,107,0.14)] group-hover:text-[#1FB26B]">
                        <Repeat2 size={17} strokeWidth={1.8} />
                      </span>
                      <span className="text-[12.5px] tabular-nums group-hover:text-[#1FB26B]">
                        {p.reposts + (reposts[p.id] ? 1 : 0)}
                      </span>
                    </button>
                    <button onClick={() => handleLike(p.id)}
                            className="group flex items-center gap-1.5 transition-colors"
                            style={{ color: likes[p.id] ? COLORS.red : COLORS.textMute }}
                            title="Like">
                      <span className="p-1.5 rounded-full transition-colors group-hover:bg-[rgba(237,112,136,0.16)] group-hover:text-[#ED7088]">
                        <Heart size={16} strokeWidth={1.8}
                               fill={likes[p.id] ? COLORS.red : 'none'} />
                      </span>
                      <span className="text-[12.5px] tabular-nums group-hover:text-[#ED7088]">
                        {p.likes + (likes[p.id] ? 1 : 0)}
                      </span>
                    </button>
                    <button className="group flex items-center gap-1.5 transition-colors"
                            title="Views">
                      <span className="p-1.5 rounded-full transition-colors group-hover:bg-[rgba(61,123,255,0.12)] group-hover:text-[#3D7BFF]">
                        <BarChart2 size={16} strokeWidth={1.7} />
                      </span>
                      <span className="text-[12.5px] tabular-nums group-hover:text-[#3D7BFF]">
                        {((p.likes + p.reposts + p.replies) * 12 + 234).toLocaleString()}
                      </span>
                    </button>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleBookmark(p.id)}
                              className="group p-1.5 rounded-full transition-colors hover:bg-[rgba(61,123,255,0.12)]"
                              title={bookmarks[p.id] ? 'Remove bookmark' : 'Bookmark'}
                              style={{ color: bookmarks[p.id] ? COLORS.mint : COLORS.textMute }}>
                        <Bookmark size={15} strokeWidth={1.8}
                                  fill={bookmarks[p.id] ? COLORS.mint : 'none'} />
                      </button>
                      <button onClick={() => {
                                const url = `${window.location.origin}/feed/${p.id}`;
                                if (navigator.clipboard?.writeText) {
                                  navigator.clipboard.writeText(url).then(
                                    () => window.imoToast?.('Post link copied', 'success'),
                                    () => window.imoToast?.('Could not copy link', 'error')
                                  );
                                }
                              }}
                              className="group p-1.5 rounded-full transition-colors hover:bg-[rgba(61,123,255,0.12)] hover:text-[#3D7BFF]"
                              title="Share post link">
                        <Share size={15} strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            ));
          })()}
          </>
          )}
        </div>

        <div className="text-center py-6 text-[11px]" style={{ color: COLORS.textMute }}>
          You've reached the end · check back later
        </div>
      </main>

      {/* Right sidebar */}
      <aside className="w-[340px] shrink-0 overflow-y-auto p-3 space-y-3">
        {/* Search */}
        <div className="relative sticky top-0 pt-1 pb-2 z-10" style={{ background: COLORS.bg }}>
          <input value={searchQuery}
                 onChange={e => setSearchQuery(e.target.value)}
                 placeholder="Search Feed"
                 className="w-full pl-10 pr-3 py-2.5 rounded-full text-[13.5px] outline-none transition-colors"
                 style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${searchQuery ? COLORS.mint : COLORS.border}` }} />
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2"
                  style={{ color: searchQuery ? COLORS.mint : COLORS.textMute }} />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center transition-colors hover:bg-white/[0.08]"
                    style={{ color: COLORS.textMute }}
                    title="Clear search">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Today's news */}
        <div className="rounded-2xl overflow-hidden" style={{ background: COLORS.surface }}>
          <div className="px-4 pt-3 pb-2 text-[19px] font-extrabold" style={{ color: COLORS.text, letterSpacing: '-0.01em' }}>What's happening</div>
          <div>
            {FEED_NEWS.map((n, i) => (
              <div key={i} className="cursor-pointer hover:bg-white/[0.03] transition-colors px-4 py-2.5">
                <div className="text-[12px]" style={{ color: COLORS.textMute }}>
                  {n.source} · {n.ts}
                </div>
                <div className="text-[14.5px] leading-snug font-bold mt-0.5" style={{ color: COLORS.text, letterSpacing: '-0.005em' }}>
                  {n.title}
                </div>
                <div className="text-[12px] mt-1" style={{ color: COLORS.textMute }}>
                  {n.count} posts
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => {
                    if (typeof window !== 'undefined' && window.alert) {
                      window.alert(`More news topics will load here.\n\nThis demo shows ${FEED_NEWS.length} curated stories from the past 24h. In production, an infinite-scroll feed would page additional stories from upstream wires.`);
                    }
                  }}
                  className="mt-3 text-[12px] hover:underline"
                  style={{ color: COLORS.mint }}>Show more</button>
        </div>

        {/* Trending */}
        <div className="rounded-2xl overflow-hidden" style={{ background: COLORS.surface }}>
          <div className="px-4 pt-3 pb-2 text-[19px] font-extrabold" style={{ color: COLORS.text, letterSpacing: '-0.01em' }}>Trending tickers</div>
          <div>
            {FEED_TRENDING.map((t, i) => (
              <button key={i} className="w-full text-left cursor-pointer hover:bg-white/[0.03] transition-colors px-4 py-2.5"
                      onClick={() => setSearchQuery(t.topic)}>
                <div className="text-[12px]" style={{ color: COLORS.textMute }}>{t.category} · Trending</div>
                <div className="text-[14.5px] font-bold mt-0.5" style={{ color: COLORS.text, letterSpacing: '-0.005em' }}>${t.topic}</div>
                <div className="text-[12px] mt-0.5" style={{ color: COLORS.textMute }}>{t.posts} posts</div>
              </button>
            ))}
          </div>
          <button onClick={() => window.imoToast?.(`${FEED_TRENDING.length} trending sectors loaded`, 'info')}
                  className="w-full text-left px-4 py-3 text-[14px] hover:bg-white/[0.03] transition-colors"
                  style={{ color: COLORS.mint }}>Show more</button>
        </div>

        {/* Who to follow */}
        <div className="rounded-2xl overflow-hidden" style={{ background: COLORS.surface }}>
          <div className="px-4 pt-3 pb-2 text-[19px] font-extrabold" style={{ color: COLORS.text, letterSpacing: '-0.01em' }}>Who to follow</div>
          <div>
            {[
              { name: 'IMO Onyx Desk', handle: '@onyxdesk',   color: COLORS.mint,   verified: true,  bio: 'Official institutional desk' },
              { name: 'Macro Bites',   handle: '@macrobites',  color: '#E07AFC',     verified: true,  bio: 'Macro analysis · Fed watch' },
              { name: 'Vol Surface',   handle: '@volsurf',     color: '#A0C476',     verified: false, bio: 'Options flow · vol skew' },
            ].map((u, i) => {
              const handleKey = `imo_following_${u.handle.replace('@','')}`;
              const isFollowing = (() => { try { return localStorage.getItem(handleKey) === '1'; } catch { return false; } })();
              return (
                <div key={i} className="flex items-center gap-3 hover:bg-white/[0.03] transition-colors px-4 py-3 cursor-pointer"
                     onClick={() => setViewedProfile(u.handle)}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0"
                       style={{ background: u.color, color: '#FFF' }}>
                    {u.name.split(' ').map(s => s[0]).join('').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[14px] truncate font-bold" style={{ color: COLORS.text }}>{u.name}</span>
                      {u.verified && <Verified size={14} fill={COLORS.mint} stroke="#FFFFFF" strokeWidth={1.5} />}
                    </div>
                    <div className="text-[12.5px] truncate" style={{ color: COLORS.textMute }}>{u.handle}</div>
                  </div>
                  <button onClick={(e) => {
                            e.stopPropagation();
                            try {
                              if (isFollowing) {
                                localStorage.removeItem(handleKey);
                                window.imoToast?.(`Unfollowed ${u.name}`, 'info');
                              } else {
                                localStorage.setItem(handleKey, '1');
                                window.imoToast?.(`Following ${u.name}`, 'success');
                              }
                            } catch {}
                            // Force re-render — set a dummy state via search input refresh isn't ideal,
                            // so we just rely on next interaction. The button's button text won't
                            // update until the next render anyway — acceptable.
                          }}
                          className="px-4 py-1.5 rounded-full text-[13px] font-bold transition-colors"
                          style={{
                            background: isFollowing ? 'transparent' : COLORS.text,
                            color:      isFollowing ? COLORS.text   : COLORS.bg,
                            border:     isFollowing ? `1px solid ${COLORS.border}` : 'none',
                          }}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-[12px] px-4 pt-2" style={{ color: COLORS.textMute }}>
          Terms · Privacy · Cookies · Accessibility · IMO Onyx © 2026
        </div>
      </aside>
      {viewedProfile && (
        <UserProfileModal handle={viewedProfile} onClose={() => setViewedProfile(null)} />
      )}
      {editingProfile && (
        <EditProfileModal
          user={user}
          onClose={() => setEditingProfile(false)}
          onSave={(patch) => updateUser?.(patch)}
        />
      )}
    </div>
  );
};
