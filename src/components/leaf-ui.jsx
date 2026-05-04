// IMO Onyx Terminal — leaf UI components
//
// Phases 3o.98, 3o.99, 3p.00, 3p.01 (file split, batches 10-13).
// Eleven leaf components used across the app. Each is self-contained:
// no children-of-this-codebase dependencies. Includes the small core
// (3o.98), CircularPageNav (3o.99), CommandPaletteModal (3p.00, paired
// with INSTRUMENTS extraction), and the chrome layer
// (NotificationBell + BrokerStatusPill + StatusBar + AISearchBar in 3p.01).
//
// Public exports:
//   MicButton                  Voice dictation button (Web Speech API).
//   ScrollableRowWithProgress  Horizontal-scroll wrapper with rail.
//   LogoMark                   IMO brand glyph (SVG, 2-color).
//   SettingsToggle             Reusable toggle row.
//   MinimizedDock              Bottom rail of minimized pages.
//   CircularPageNav            Top-bar page-cycle widget.
//   CommandPaletteModal        ⌘K palette over PAGES + INSTRUMENTS.
//   NotificationBell           Top-bar bell + dropdown panel with
//                              filter tabs (all/portfolio/market/eod)
//                              and inline message composer.
//   BrokerStatusPill           Compact status pill showing the active
//                              broker (paper / IBKR / Schwab / etc.)
//                              with click-to-switch dropdown.
//   StatusBar                  Bottom-bar with chain status + market
//                              hours + active page meta + balance.
//   AISearchBar                Top-bar combined search + AI prompt.
//                              Smart-routes chart-edit phrases vs
//                              free-form queries.
//
// Public exports:
//   MicButton                  Voice dictation button — wraps Web Speech
//                              Recognition API. Self-contained: handles
//                              browser support detection, listening
//                              state, transcript callback. Animated
//                              with imo-pulse keyframe when listening.
//   ScrollableRowWithProgress  Horizontal-scroll wrapper that hides the
//                              native scrollbar (which looked clunky on
//                              the Predictions page) and replaces it
//                              with a thin progress rail underneath.
//                              Pure layout component.
//   LogoMark                   The IMO brand glyph (SVG). Two-color
//                              system: black for light themes, brand
//                              blue for dark. Aspect ratio tuned so
//                              the rising-arrow tail isn't crowded.
//   SettingsToggle             Reusable toggle row for the Settings
//                              panel. Pure presentation — caller owns
//                              the value + onChange.
//   MinimizedDock              Bottom rail listing minimized pages with
//                              restore + drop + clear-all controls.
//                              Reads PAGES from constants.
//   CircularPageNav            Horizontal page-cycle widget at top of
//                              the app. Two-finger trackpad scroll +
//                              keyboard arrows cycle through pages.
//                              Throttled rAF scroll handler. Filters
//                              by user experience level (advancedOnly /
//                              noviceOnly via PAGES metadata).
// (See top-of-file public-exports list for descriptions.)
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Bell, Bitcoin, Building2, Droplet } from 'lucide-react';
import { COLORS, PAGES } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import { formatTicker } from '../lib/format.js';
import { PROVIDER_PAPER, getBrokerProvider } from '../lib/broker-providers.js';
import { loadActiveBroker, loadBrokerConfigs } from '../lib/broker-storage.js';

export const MicButton = ({ onTranscript, size = 'sm', title = 'Speak — tap to dictate', interim = false }) => {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);
  if (!supported) return null;
  const start = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = !!interim;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        const last = e.results[e.results.length - 1];
        const text = last?.[0]?.transcript ?? '';
        // Only emit final results unless the caller asked for interims —
        // avoids the input flickering as the engine refines its guess.
        if (interim || last.isFinal) {
          onTranscript?.(text.trim());
        }
      };
      rec.onerror = (e) => {
        // Common errors: 'no-speech', 'aborted', 'not-allowed' (denied
        // mic permission). We log quietly and let the listening state
        // unwind; no popup so the experience stays calm.
        console.warn('[mic]', e.error);
        setListening(false);
      };
      rec.onend = () => setListening(false);
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch (err) {
      console.warn('[mic] failed to start:', err.message);
      setListening(false);
    }
  };
  const stop = () => {
    try { recognitionRef.current?.stop(); } catch {}
    setListening(false);
  };
  const handleClick = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (listening) stop(); else start();
  };
  const dim = size === 'xs' ? 18 : 22;
  return (
    <button
      onClick={handleClick}
      type="button"
      className="rounded-full flex items-center justify-center transition-all shrink-0"
      style={{
        width: dim, height: dim,
        background: listening ? COLORS.red : 'transparent',
        color: listening ? '#FFF' : COLORS.textDim,
        border: `1px solid ${listening ? COLORS.red : COLORS.border}`,
        animation: listening ? 'pulse 1.4s ease-in-out infinite' : 'none',
      }}
      title={listening ? 'Listening — tap to stop' : title}>
      <svg width={size === 'xs' ? 9 : 11} height={size === 'xs' ? 11 : 13} viewBox="0 0 16 20" fill="currentColor">
        <path d="M8 12C9.66 12 11 10.66 11 9V4C11 2.34 9.66 1 8 1S5 2.34 5 4V9C5 10.66 6.34 12 8 12Z" />
        <path d="M14 9C14 12.31 11.31 15 8 15C4.69 15 2 12.31 2 9H4C4 11.21 5.79 13 8 13S12 11.21 12 9H14Z" />
        <path d="M7 16H9V19H7V16Z" />
      </svg>
    </button>
  );
};

export const ScrollableRowWithProgress = ({ children, className = '' }) => {
  const scrollRef = useRef(null);
  const [progress, setProgress] = useState({ ratio: 1, pos: 0, needed: false });
  const update = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1) {
      setProgress(p => p.needed ? { ratio: 1, pos: 0, needed: false } : p);
      return;
    }
    const ratio = el.clientWidth / el.scrollWidth;
    const pos = el.scrollLeft / max;
    setProgress({ ratio, pos, needed: true });
  };
  useEffect(() => {
    update();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);
  return (
    <div>
      <div ref={scrollRef}
           className={`overflow-x-auto imo-no-scrollbar ${className}`}
           style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {children}
      </div>
      {progress.needed && (
        <div className="relative mt-1.5 mx-1 rounded-full overflow-hidden"
             style={{ height: 2, background: 'rgba(255,255,255,0.06)' }}>
          {/* Thumb — width is the visible:content ratio, x-translation
              is scroll progress. Position interpolates between
              0 (left) and 100% - thumbWidth (right) so it never
              overshoots the rail. */}
          <div className="absolute top-0 left-0 h-full rounded-full transition-transform"
               style={{
                 width: `${progress.ratio * 100}%`,
                 transform: `translateX(${progress.pos * (1 - progress.ratio) * 100 / progress.ratio}%)`,
                 background: 'rgba(255,255,255,0.45)',
               }} />
        </div>
      )}
    </div>
  );
};

export const LogoMark = ({ size = 28, black = false, blue = false }) => {
  // Color resolution:
  //   - explicit `black` prop → black (used on light pages / pink theme)
  //   - explicit `blue` prop  → brand blue (default, dark mode)
  //   - neither → fall back to brand blue
  const fill = black ? '#0A0E14' : '#3D7BFF';
  // Aspect ratio tuned to match the design photo: "imo" with a rising
  // line+arrow that emerges from the right side of the "o" and climbs
  // up-and-to-the-right with a slight dip before the apex. Ratio is
  // ~2.0:1 so the logo doesn't get visually crowded by the arrow's
  // exit path.
  const w = Math.round(size * 2.0);
  return (
    <svg
      viewBox="0 0 200 100"
      width={w}
      height={size}
      style={{ display: 'block', flexShrink: 0 }}
      aria-label="IMO"
      fill="none"
    >
      {/* Italic "imo" wordmark. Heavy weight, tight letter-spacing so
          the rising line can thread through the right edge of the "o"
          and exit cleanly. The "o" itself is rendered as text but the
          arrow path overlays its right side, creating the visual
          effect of the line "passing through" the letter. */}
      <text
        x="4"
        y="76"
        fontFamily="Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontSize="84"
        fontWeight="800"
        fontStyle="italic"
        letterSpacing="-3"
        fill={fill}
      >
        imo
      </text>
      {/* Rising line — a smooth curved path that emerges from inside
          the "o" mid-height, dips slightly to the right (the design's
          characteristic "valley" before the rise), then climbs sharply
          to the upper-right corner. Drawn as a single stroked path
          with quadratic curves so the corners are rounded rather than
          sharp like the prior zigzag implementation. */}
      <path
        d="M138 56 Q150 48 158 60 Q168 70 178 38"
        stroke={fill}
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Arrowhead — angled triangle at the apex of the rising line.
          Aligned with the line's exit angle (sharply up-and-right) so
          the arrow looks like a continuation of the path rather than
          a stuck-on element. */}
      <path
        d="M180 32 L162 36 L172 50 Z"
        fill={fill}
        stroke={fill}
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const SettingsToggle = ({ label, sub, value, onChange }) => (
  <button
    onClick={() => onChange(!value)}
    className="w-full flex items-start gap-3 px-3 py-2.5 rounded-md border transition-colors text-left hover:bg-white/[0.02]"
    style={{ borderColor: COLORS.border, background: COLORS.bg }}
  >
    <div className="flex-1 min-w-0">
      <div className="text-[12px]" style={{ color: COLORS.text }}>{label}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: COLORS.textMute }}>{sub}</div>}
    </div>
    <div className="w-9 h-5 rounded-full relative shrink-0 mt-0.5 transition-colors"
         style={{ background: value ? COLORS.mint : COLORS.surface2 }}>
      <div className="w-4 h-4 rounded-full absolute top-0.5 transition-all"
           style={{
             left: value ? 18 : 2,
             background: value ? COLORS.bg : COLORS.textDim,
           }} />
    </div>
  </button>
);

export const MinimizedDock = ({ minimizedPages, onRestore, onDrop, onClearAll }) => {
  if (!minimizedPages.length) return null;
  // Map page IDs → labels (defensive: fall back to id if PAGES doesn't have it).
  const labelFor = (id) => PAGES.find(p => p.id === id)?.label ?? id;
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-t overflow-x-auto"
         style={{ borderColor: COLORS.borderHi, background: COLORS.surface }}>
      <span className="text-[9px] uppercase tracking-wider shrink-0"
            style={{ color: COLORS.textMute }}>
        Minimized · {minimizedPages.length}
      </span>
      {minimizedPages.map(id => (
        <div key={id}
             className="flex items-center gap-1 rounded-md text-[11px] shrink-0"
             style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
          <button onClick={() => onRestore(id)}
                  className="pl-2 pr-1 py-1 hover:opacity-80 transition-opacity"
                  style={{ color: COLORS.text }}
                  title={`Restore ${labelFor(id)}`}>
            <span className="opacity-70 mr-1">▴</span>{labelFor(id)}
          </button>
          <button onClick={() => onDrop(id)}
                  className="px-1.5 py-1 hover:opacity-80 transition-opacity"
                  style={{ color: COLORS.textMute }}
                  title="Remove from dock">×</button>
        </div>
      ))}
      <button onClick={onClearAll}
              className="ml-auto text-[10px] px-2 py-1 rounded shrink-0 hover:opacity-80"
              style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}
              title="Clear all minimized pages">Clear all</button>
    </div>
  );
};

export const CircularPageNav = ({ pages, activeId, onChange }) => {
  const idx = Math.max(0, pages.findIndex(p => p.id === activeId));
  const containerRef = useRef(null);
  const lastScrollTs = useRef(0);

  const cycle = (dir) => {
    const next = ((idx + dir) % pages.length + pages.length) % pages.length;
    onChange(pages[next].id);
  };

  // Two-finger trackpad horizontal scroll → cycle pages. Throttle to one
  // page per ~250ms so a single swipe doesn't blow through 5 pages.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      const dx = e.deltaX;
      if (Math.abs(dx) < 8) return;
      const now = Date.now();
      if (now - lastScrollTs.current < 220) return;
      lastScrollTs.current = now;
      e.preventDefault();
      cycle(dx > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [idx, pages.length]);

  // Page nav layout (tilted-disk style):
  // - The active page sits at the center, full size, full opacity
  // - Items recede on either side along an arc — like reading text on the
  //   front face of a vinyl record tilted toward you
  // - All pages are visible on the wheel (RADIUS increased) so no page
  //   is unreachable. Edge items fade heavily to keep the cluster legible.
  // - Edge fade gradients bleed the outermost pages into the page bg
  //
  // Spacing — pages further from the active center are TIGHTER together,
  // not looser. Per UX request: the central page deserves the most
  // breathing room (it's the focus); peripheral pages can pack closer
  // because they're glanceable not interactive. SLOT_GROWTH negative
  // means each successive slot is N pixels narrower than the last,
  // floored at MIN_SLOT so labels don't crash into each other on long
  // page names. The tighter outer cluster also creates room to render
  // more pages on the wheel (RADIUS increased to 8) before edge fade.
  const BASE_SLOT = 64;
  const SLOT_GROWTH = -4;     // negative = tighter as we move away from center
  const MIN_SLOT = 36;        // floor so far-away labels don't overlap
  // Show enough items that every page in the list is reachable on the
  // wheel. Cap at 8 each side so the strip doesn't grow infinitely on
  // very long lists (the edge fade hides whatever's past that).
  const RADIUS = Math.min(8, Math.floor((pages.length - 1) / 2));

  // Pre-compute cumulative offset for each distance d. Symmetric on both sides.
  const offsetForD = (d) => {
    let off = 0;
    for (let k = 1; k <= Math.abs(d); k++) {
      const slot = Math.max(MIN_SLOT, BASE_SLOT + (k - 1) * SLOT_GROWTH);
      off += slot;
    }
    return d < 0 ? -off : off;
  };

  const halfWidth = offsetForD(RADIUS);
  const totalWidth = halfWidth * 2 + 160;
  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center imo-disk-nav"
      style={{
        width: totalWidth,
        maxWidth: '100%',
        height: 64,
        overflow: 'hidden',
        // 3D perspective for the tilted-disk effect
        perspective: '900px',
        perspectiveOrigin: 'center 80%',
      }}
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          transform: 'rotateX(18deg)',
          transformStyle: 'preserve-3d',
        }}
      >
      {pages.map((p, i) => {
        let d = i - idx;
        if (d > pages.length / 2) d -= pages.length;
        if (d < -pages.length / 2) d += pages.length;
        if (Math.abs(d) > RADIUS) return null;
        const absD = Math.abs(d);
        // No more multipliers — the previous *1.6 and *1.15 boosts
        // pushed adjacent items closer to the center, which overlapped
        // long labels. Use the raw cumulative offset so each pill sits
        // exactly where BASE_SLOT/SLOT_GROWTH says it should.
        const x = offsetForD(d);
        const opacity = absD === 0 ? 1 : Math.max(0.45, 0.85 - (absD - 1) * 0.10);
        const isActive = d === 0;
        // Font sizes bumped up across the board per UX request — every
        // page name is more legible, with active the largest. Active 19,
        // ±1 16, ±2 14.5, ±3 13.5, ±4 13. Non-active sizes raised so
        // pages farther from center stay readable, not just suggestive.
        let fontSize;
        if (isActive)        fontSize = 19;
        else if (absD === 1) fontSize = 16;
        else if (absD === 2) fontSize = 14.5;
        else if (absD === 3) fontSize = 13.5;
        else                 fontSize = 13;
        const scale = isActive ? 1 : 1 - absD * 0.025;
        return (
          <button
            key={p.id}
            onClick={() => onChange(p.id)}
            className="absolute whitespace-nowrap transition-all duration-300"
            style={{
              left: '50%',
              transform: `translate(${x}px, 0) translateX(-50%) scale(${scale})`,
              opacity,
              // Tighter fit — was 6px 12px, now 4px 10px so the pill
              // sits closer to the text.
              padding: '4px 10px',
              fontSize,
              fontWeight: isActive ? 700 : 500,
              color: isActive ? COLORS.text : COLORS.textDim,
              cursor: 'pointer',
              userSelect: 'none',
              // z-index inverted so closer-to-center pills layer ON TOP
              // of farther-out ones (per user request: "pages closer to
              // the center are layered over the ones farther away").
              zIndex: 100 - absD,
              borderRadius: 999,
              // Pills are now FULLY OPAQUE so an in-front pill cleanly
              // covers the one behind it where they overlap. The inactive
              // background uses COLORS.bg (the page background) so the
              // pill reads as if it's punched out of the page surface.
              // Active gets the liquid-glass treatment.
              background: isActive
                ? 'rgba(30,58,108,0.95)'
                : COLORS.bg,
              border: isActive
                ? `1px solid rgba(80,140,220,0.65)`
                : `1px solid ${COLORS.border}`,
              letterSpacing: isActive ? '0.01em' : '0',
              // Liquid-glass glow only on the active pill — outer light +
              // inner highlight to suggest a lit-up lens.
              boxShadow: isActive
                ? '0 4px 14px rgba(30,58,108,0.40), inset 0 1px 0 rgba(255,255,255,0.08)'
                : 'none',
            }}
            title={`Open ${p.label}`}
          >
            {p.label}
            {/* White underline indicator on the active pill — sits flush
                under the pill so the user can spot the active page at a
                glance even before reading the label color. Hidden on
                inactive pills. */}
            {isActive && (
              <span className="absolute left-1/2 -translate-x-1/2"
                    style={{
                      bottom: -5,
                      width: '70%',
                      height: 2,
                      background: '#FFFFFF',
                      borderRadius: 999,
                      boxShadow: '0 0 6px rgba(255,255,255,0.5)',
                    }} />
            )}
          </button>
        );
      })}
      </div>
      {/* Edge fade gradients — bleed outer items into the page background */}
      <div className="absolute left-0 top-0 bottom-0 pointer-events-none"
           style={{ width: 100, background: `linear-gradient(90deg, ${COLORS.bg} 0%, transparent 100%)`, zIndex: 20 }} />
      <div className="absolute right-0 top-0 bottom-0 pointer-events-none"
           style={{ width: 100, background: `linear-gradient(270deg, ${COLORS.bg} 0%, transparent 100%)`, zIndex: 20 }} />
    </div>
  );
};

export const CommandPaletteModal = ({ onClose, onPickPage, onPickTicker, onAction }) => {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => {
    // Autofocus on mount
    inputRef.current?.focus();
  }, []);

  // Build the candidate list. Each entry has: id, label, kind, keywords, run.
  const candidates = useMemo(() => {
    const out = [];
    // Pages
    PAGES.forEach(p => {
      out.push({
        id: `page-${p.id}`,
        label: p.label,
        kind: 'Page',
        keywords: ['go to', 'open', p.id, p.label].join(' ').toLowerCase(),
        icon: '◇',
        run: () => onPickPage(p.id),
      });
    });
    // Tickers
    INSTRUMENTS.slice(0, 60).forEach(inst => {
      out.push({
        id: `tick-${inst.id}`,
        label: `${inst.id} · ${inst.name}`,
        kind: inst.cls,
        keywords: [inst.id, inst.name, inst.cls].join(' ').toLowerCase(),
        icon: '$',
        run: () => onPickTicker(inst),
      });
    });
    // Actions
    [
      { id: 'ai',       label: 'Ask AI / AI Edit',  keywords: 'ai claude assistant chat', icon: '✦', run: () => onAction('ai') },
      { id: 'deposit',  label: 'Deposit funds',     keywords: 'deposit fund money',       icon: '$', run: () => onAction('deposit') },
      { id: 'settings', label: 'Open settings',     keywords: 'settings preferences theme', icon: '⚙', run: () => onAction('settings') },
      { id: 'theme',    label: 'Toggle theme',      keywords: 'theme dark light rose',    icon: '◐', run: () => onAction('theme') },
      { id: 'signout',  label: 'Sign out',          keywords: 'signout logout exit',      icon: '⏻', run: () => onAction('signout') },
    ].forEach(a => out.push({
      id: `act-${a.id}`,
      label: a.label,
      kind: 'Action',
      keywords: a.keywords.toLowerCase(),
      icon: a.icon,
      run: a.run,
    }));
    return out;
  }, [onPickPage, onPickTicker, onAction]);

  // Filter + rank by the search query
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates.slice(0, 12);
    const scored = candidates.map(c => {
      const label = c.label.toLowerCase();
      let score = 0;
      if (label.startsWith(q)) score = 100;
      else if (label.includes(' ' + q)) score = 70;
      else if (label.includes(q)) score = 40;
      else if (c.keywords.includes(q)) score = 20;
      return { c, score };
    }).filter(x => x.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 12).map(x => x.c);
  }, [candidates, query]);

  // Reset highlight when results change
  useEffect(() => { setHighlight(0); }, [query]);

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = results[highlight];
      if (sel) { sel.run(); onClose(); }
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-24 px-4"
         style={{ background: 'rgba(0,0,0,0.5)' }}
         onClick={onClose}>
      <div className="rounded-md overflow-hidden w-[560px] max-w-full"
           style={{ background: COLORS.surface, border: `1px solid ${COLORS.borderHi}`, boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}
           onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div className="px-3 py-2.5 border-b flex items-center gap-2"
             style={{ borderColor: COLORS.border }}>
          <Search size={14} style={{ color: COLORS.textMute }} />
          <input ref={inputRef}
                 value={query}
                 onChange={e => setQuery(e.target.value)}
                 onKeyDown={onKey}
                 placeholder="Type a page, ticker, or action…"
                 className="flex-1 bg-transparent text-[14px] outline-none"
                 style={{ color: COLORS.text }} />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border tabular-nums"
               style={{ borderColor: COLORS.border, color: COLORS.textMute }}>ESC</kbd>
        </div>
        {/* Results */}
        <div className="max-h-[420px] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px]" style={{ color: COLORS.textMute }}>
              No matches for "{query}"
            </div>
          ) : results.map((r, i) => {
            const isActive = i === highlight;
            return (
              <button key={r.id}
                      onClick={() => { r.run(); onClose(); }}
                      onMouseEnter={() => setHighlight(i)}
                      className="w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors"
                      style={{
                        background: isActive ? `${COLORS.mint}14` : 'transparent',
                        borderLeft: `2px solid ${isActive ? COLORS.mint : 'transparent'}`,
                      }}>
                <span className="w-5 text-center text-[13px]"
                      style={{ color: isActive ? COLORS.mint : COLORS.textMute }}>{r.icon}</span>
                <span className="flex-1 text-[12.5px]"
                      style={{ color: isActive ? COLORS.text : COLORS.textDim }}>{r.label}</span>
                <span className="text-[9.5px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: COLORS.surface2, color: COLORS.textMute }}>{r.kind}</span>
              </button>
            );
          })}
        </div>
        {/* Hint footer */}
        <div className="px-3 py-1.5 border-t flex items-center gap-3 text-[10px]"
             style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
          <span><kbd className="px-1 rounded" style={{ border: `1px solid ${COLORS.border}` }}>↑↓</kbd> navigate</span>
          <span><kbd className="px-1 rounded" style={{ border: `1px solid ${COLORS.border}` }}>↵</kbd> select</span>
          <span className="ml-auto">Cmd+K to toggle</span>
        </div>
      </div>
    </div>
  );
};


// DEFAULT_NOTIFICATIONS — seed mock notifications shown on first load.
// Bundled here because NotificationBell is the only consumer.
const DEFAULT_NOTIFICATIONS = [
  { id: 'n1', type: 'portfolio', title: 'Position closed', body: 'NVDA long position closed +$1,240.50', ts: Date.now() - 1000 * 60 * 30, read: false },
  { id: 'n2', type: 'market',    title: 'Major economic event', body: 'Fed minutes released — markets reacting', ts: Date.now() - 1000 * 60 * 60 * 2, read: false },
  { id: 'n3', type: 'eod',       title: 'Daily trading summary', body: 'Yesterday: 3 trades · realized P/L +$432.10 · 2 winners 1 loser', ts: Date.now() - 1000 * 60 * 60 * 14, read: true },
  { id: 'n4', type: 'message',   title: 'Message from desk lead', body: 'Sarah: "great trade on the AAPL squeeze, lets discuss sizing"', ts: Date.now() - 1000 * 60 * 60 * 18, read: true },
  { id: 'n5', type: 'market',    title: 'Watchlist alert', body: 'TSLA broke above $250 — your saved alert', ts: Date.now() - 1000 * 60 * 60 * 22, read: true },
];

export const NotificationBell = ({ onOpenMessages }) => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [notifications, setNotifications] = useState(DEFAULT_NOTIFICATIONS);
  const [composing, setComposing] = useState(false);
  const [msgRecipient, setMsgRecipient] = useState('');
  const [msgBody, setMsgBody] = useState('');

  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const unreadCount = notifications.filter(n => !n.read).length;
  const filtered = filter === 'all'
    ? notifications
    : notifications.filter(n => n.type === filter);

  const markRead = (id) => setNotifications(prev =>
    prev.map(n => n.id === id ? { ...n, read: true } : n)
  );
  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));

  const sendMessage = () => {
    if (!msgRecipient.trim() || !msgBody.trim()) return;
    setNotifications(prev => [{
      id: `n_${Date.now()}`,
      type: 'message',
      title: `Message sent to ${msgRecipient}`,
      body: msgBody,
      ts: Date.now(),
      read: true,
    }, ...prev]);
    setMsgRecipient(''); setMsgBody(''); setComposing(false);
  };

  const fmtTs = (ts) => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
              className="relative p-1.5 rounded-md hover:bg-white/[0.05] transition-colors"
              title="Notifications, messages, and trading day summaries">
        <Bell size={16} style={{ color: COLORS.textDim }} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full text-[9px] font-bold flex items-center justify-center px-1"
                style={{ background: COLORS.red, color: '#FFF' }}>
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-[420px] rounded-md border z-50 overflow-hidden flex flex-col"
             style={{ background: COLORS.surface, borderColor: COLORS.borderHi, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxHeight: '70vh' }}>
          <div className="flex items-center justify-between p-3 border-b shrink-0"
               style={{ borderColor: COLORS.border }}>
            <div className="text-[13px] font-medium" style={{ color: COLORS.text }}>
              Notifications
              {unreadCount > 0 && (
                <span className="ml-1.5 text-[10px] tabular-nums" style={{ color: COLORS.mint }}>
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => { onOpenMessages?.(); setOpen(false); }}
                      className="px-2 py-1 rounded text-[10px]"
                      style={{ background: COLORS.mint, color: COLORS.bg }}
                      title="Open full Messages page">
                Messages
              </button>
              <button onClick={markAllRead}
                      className="px-2 py-1 rounded text-[10px]"
                      style={{ color: COLORS.textDim }}
                      title="Mark all notifications as read">
                Mark all read
              </button>
            </div>
          </div>

          {/* Type filters */}
          <div className="flex items-center gap-1 px-3 py-2 border-b overflow-x-auto shrink-0"
               style={{ borderColor: COLORS.border }}>
            {NOTIFICATION_TYPES.map(t => (
              <button key={t.id} onClick={() => setFilter(t.id)}
                      className="px-2 py-1 rounded text-[10.5px] shrink-0 whitespace-nowrap transition-colors"
                      style={{
                        background: filter === t.id ? COLORS.surface2 : 'transparent',
                        color: filter === t.id ? COLORS.text : COLORS.textDim,
                      }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-[12px]" style={{ color: COLORS.textMute }}>
                No notifications in this category
              </div>
            ) : filtered.map(n => (
              <button key={n.id} onClick={() => markRead(n.id)}
                      className="w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-white/[0.02] transition-colors"
                      style={{
                        borderColor: COLORS.border,
                        background: n.read ? 'transparent' : 'rgba(61,123,255,0.03)',
                      }}>
                <div className="flex items-start gap-2.5">
                  {/* Type indicator — small colored dot keyed to category. */}
                  <span className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                        style={{ background:
                          n.type === 'portfolio' ? '#7AC8FF' :
                          n.type === 'market'    ? '#FFB84D' :
                          n.type === 'eod'       ? COLORS.mint :
                          n.type === 'message'   ? '#FF7AB6' :
                                                    COLORS.textMute
                        }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12.5px] font-medium" style={{ color: COLORS.text }}>{n.title}</span>
                      {!n.read && (
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: COLORS.mint }} />
                      )}
                    </div>
                    <div className="text-[11px] mt-0.5 leading-snug" style={{ color: COLORS.textDim }}>{n.body}</div>
                    <div className="text-[10px] mt-1" style={{ color: COLORS.textMute }}>{fmtTs(n.ts)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const BrokerStatusPill = () => {
  const [active, setActive] = useState(loadActiveBroker);
  const [configs, setConfigs] = useState(loadBrokerConfigs);
  useEffect(() => {
    const refresh = () => {
      setActive(loadActiveBroker());
      setConfigs(loadBrokerConfigs());
    };
    window.addEventListener('imo:active-broker-changed', refresh);
    window.addEventListener('imo:broker-config-changed', refresh);
    return () => {
      window.removeEventListener('imo:active-broker-changed', refresh);
      window.removeEventListener('imo:broker-config-changed', refresh);
    };
  }, []);
  const provider = getBrokerProvider(active.providerId) || PROVIDER_PAPER;
  const isPaper = provider.id === 'paper';
  const cfg = configs[provider.id];
  const isConfigured = isPaper || (cfg && provider.configFields.every(f => !f.required || cfg[f.key]));
  // Detect "live trading" — different brokers flag this differently:
  //   IBKR:    accountId doesn't start with 'DU' (DU is paper)
  //   Tradier: environment field is 'production'
  //   Alpaca:  environment field is 'live'
  //   Schwab:  always live (no sandbox)
  const isLiveTrading = (() => {
    if (isPaper) return false;
    if (!isConfigured || !active.accountId) return false;
    if (provider.id === 'ibkr') {
      return !active.accountId.startsWith('DU');
    }
    if (provider.id === 'tradier') {
      return cfg?.environment === 'production';
    }
    if (provider.id === 'alpaca') {
      return cfg?.environment === 'live';
    }
    if (provider.id === 'schwab') {
      return true; // Schwab Trader API is production-only
    }
    return false;
  })();
  const tone = isPaper          ? COLORS.textDim
             : !isConfigured    ? '#FFB84D'
             : !active.accountId ? '#FFB84D'
             : isLiveTrading    ? '#FF7A33'   // production live trading — distinct alert color
                                : COLORS.mint;
  // Environment suffix shown after the broker name
  const envSuffix = (() => {
    if (isPaper) return '';
    if (!isConfigured || !active.accountId) return '';
    if (provider.id === 'ibkr')    return active.accountId.startsWith('DU') ? ' · PAPER' : ' · LIVE';
    if (provider.id === 'tradier') return cfg?.environment === 'production' ? ' · LIVE' : ' · SANDBOX';
    if (provider.id === 'alpaca')  return cfg?.environment === 'live'       ? ' · LIVE' : ' · PAPER';
    if (provider.id === 'schwab')  return ' · LIVE';
    return '';
  })();
  const onClick = () => {
    try { window.dispatchEvent(new CustomEvent('imo:open-settings', { detail: 'brokers' })); } catch {}
  };
  return (
    <button type="button"
            onClick={onClick}
            className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
            title={isPaper
              ? 'Paper account · click to switch broker'
              : !isConfigured
                ? `${provider.label} · configuration incomplete`
                : !active.accountId
                  ? `${provider.label} · no account selected`
                  : isLiveTrading
                    ? `${provider.label} · LIVE TRADING · ${active.accountId}`
                    : `${provider.label} · ${active.accountId}`}>
      <span className="rounded-full" style={{ width: 6, height: 6, background: tone }} />
      <span style={{ color: tone, textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.05em' }}>
        {isPaper ? 'PAPER' : `${provider.id.toUpperCase()}${envSuffix}`}
      </span>
    </button>
  );
};

export const StatusBar = ({ chainStatus, user, account, page, active }) => {
  const [time, setTime] = useState(new Date());
  // Last-tick state — updated by `imo:tick` events fired from usePriceFeed.
  // Shows "TICK 2s" + "LAT 8ms" + "WS OPEN" in the status bar so users always
  // know the connection is alive. Falls back to "—" if no tick observed yet.
  const [lastTick, setLastTick] = useState(null); // { ts, latencyMs, symbol, source }
  // Backend-services connection state — driven by `imo:backend-status` events
  // dispatched from the useBackend hook. Each is one of:
  // 'connected' | 'down' | 'unconfigured' | 'connecting'
  const [backendStatus, setBackendStatus] = useState({
    tick: 'unconfigured', executor: 'unconfigured', zeroclaw: 'unconfigured',
  });
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    const handler = (e) => {
      const d = e?.detail;
      if (!d) return;
      setLastTick({ ts: d.ts, latencyMs: d.latencyMs, symbol: d.symbol, source: d.source });
    };
    const beHandler = (e) => {
      if (e?.detail?.status) setBackendStatus(e.detail.status);
    };
    window.addEventListener('imo:tick', handler);
    window.addEventListener('imo:backend-status', beHandler);
    return () => {
      clearInterval(t);
      window.removeEventListener('imo:tick', handler);
      window.removeEventListener('imo:backend-status', beHandler);
    };
  }, []);
  // Connection state derived from how recently we saw a tick. < 5s = OPEN,
  // 5-30s = SLOW, > 30s = STALE. Color reflects health.
  const conn = useMemo(() => {
    if (!lastTick) return { label: 'INIT', tone: COLORS.textMute };
    const ageMs = time.getTime() - lastTick.ts;
    if (ageMs < 5000)  return { label: 'OPEN',  tone: COLORS.green };
    if (ageMs < 30000) return { label: 'SLOW',  tone: '#FFB84D' };
    return { label: 'STALE', tone: COLORS.red };
  }, [lastTick, time]);
  const tickAgeStr = useMemo(() => {
    if (!lastTick) return '—';
    const sec = Math.max(0, Math.floor((time.getTime() - lastTick.ts) / 1000));
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    return `${Math.floor(sec / 3600)}h`;
  }, [lastTick, time]);

  // Tier 4 — derive US market session from current time. Approximate as
  // UTC-4 (EDT). Real-world this would respect actual timezone + DST + half-
  // day holidays, but for a status indicator a four-state read is enough.
  const session = useMemo(() => {
    const day = time.getUTCDay();
    if (day === 0 || day === 6) return { label: 'CLOSED', tone: COLORS.textMute };
    const m = time.getUTCHours() * 60 + time.getUTCMinutes();
    const open    = 13 * 60 + 30; // 9:30 ET
    const close   = 20 * 60;      // 16:00 ET
    const preOpen =  8 * 60;      // 4:00 ET
    if (m >= open && m < close)            return { label: 'OPEN',  tone: COLORS.green };
    if (m >= preOpen && m < open)          return { label: 'PRE',   tone: COLORS.mint };
    if (m >= close && m < close + 4 * 60)  return { label: 'POST',  tone: COLORS.mint };
    return { label: 'CLOSED', tone: COLORS.textMute };
  }, [time]);

  const balance   = account?.balance ?? 0;
  const upnl      = account?.unrealizedPnl ?? 0;
  const positions = account?.positions ?? [];

  return (
    <div
      className="flex items-center justify-between h-6 px-3 text-[10px] tabular-nums border-t shrink-0 select-none imo-mobile-statusbar"
      style={{
        borderColor: COLORS.border,
        background: COLORS.surface,
        color: COLORS.textMute,
        fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
        letterSpacing: 0.2,
      }}
    >
      {/* LEFT — environment, market session, page, instrument */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Compact production indicator — small static dot, no ping animation */}
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded-full" style={{ width: 6, height: 6, background: COLORS.green }} />
          <span style={{ color: COLORS.textDim }}>PROD</span>
        </span>
        <span style={{ color: COLORS.textMute }}>·</span>
        <span style={{ color: session.tone }}>● US {session.label}</span>
        {page && (
          <>
            <span style={{ color: COLORS.textMute }}>·</span>
            <span style={{ color: COLORS.text, textTransform: 'uppercase' }}>{page}</span>
          </>
        )}
        {active && (
          <>
            <span style={{ color: COLORS.textMute }}>·</span>
            <span style={{ color: COLORS.text }}>{formatTicker(active.id, active.cls)}</span>
            <span style={{ color: COLORS.textMute }}>{active.cls?.toUpperCase()}</span>
          </>
        )}
        <span style={{ color: COLORS.textMute }}>·</span>
        <BrokerStatusPill />
      </div>

      {/* RIGHT — account snapshot, chain telemetry, clock */}
      <div className="flex items-center gap-3 shrink-0">
        {user && (
          <>
            <span>POS <span style={{ color: COLORS.text }}>{positions.length}</span></span>
            <span style={{ color: COLORS.textMute }}>·</span>
            <span>BAL <span style={{ color: COLORS.text }}>${balance.toLocaleString()}</span></span>
            <span style={{ color: COLORS.textMute }}>·</span>
            <span>UPNL <span style={{ color: upnl >= 0 ? COLORS.green : COLORS.red }}>
              {upnl >= 0 ? '+' : ''}${upnl.toFixed(2)}
            </span></span>
            <span style={{ color: COLORS.textMute }}>·</span>
          </>
        )}
        <span>SEQ <span style={{ color: COLORS.mint }}>{chainStatus.seq}ms</span></span>
        <span>BFT <span style={{ color: COLORS.mintDim }}>{chainStatus.bft}ms</span></span>
        <span>BLK <span style={{ color: COLORS.textDim }}>#{chainStatus.blk.toLocaleString()}</span></span>
        <span>TPS <span style={{ color: COLORS.textDim }}>{chainStatus.tps}</span></span>
        <span style={{ color: COLORS.textMute }}>·</span>
        {/* WebSocket / feed connection state — driven by `imo:tick` events.
            Color: green=OPEN, amber=SLOW, red=STALE, grey=INIT. */}
        <span className="inline-flex items-center gap-1">
          <span className="rounded-full" style={{ width: 6, height: 6, background: conn.tone, display: 'inline-block' }} />
          <span style={{ color: conn.tone }}>WS {conn.label}</span>
        </span>
        <span>TICK <span style={{ color: lastTick ? COLORS.text : COLORS.textMute }}>{tickAgeStr}</span></span>
        <span>LAT <span style={{ color: lastTick ? (lastTick.latencyMs < 10 ? COLORS.green : lastTick.latencyMs < 25 ? '#FFB84D' : COLORS.red) : COLORS.textMute }}>
          {lastTick ? `${lastTick.latencyMs}ms` : '—'}
        </span></span>
        {/* Backend services — TICK/EXEC/AGENT dots driven by useBackend's
            health polling. green=connected, amber=connecting, red=down,
            grey=unconfigured. Hidden entirely if all three unconfigured. */}
        {(backendStatus.tick !== 'unconfigured'
          || backendStatus.executor !== 'unconfigured'
          || backendStatus.zeroclaw !== 'unconfigured') && (
          <>
            <span style={{ color: COLORS.textMute }}>·</span>
            {[
              { id: 'tick', label: 'TICK' },
              { id: 'executor', label: 'EXEC' },
              { id: 'zeroclaw', label: 'AGENT' },
            ].map(({ id, label }) => {
              const s = backendStatus[id];
              const tone = s === 'connected' ? COLORS.green
                         : s === 'connecting' ? '#FFB84D'
                         : s === 'down' ? COLORS.red
                         : COLORS.textMute;
              return (
                <span key={id} className="inline-flex items-center gap-1" title={`${label} — ${s}`}>
                  <span className="rounded-full" style={{ width: 6, height: 6, background: tone, display: 'inline-block' }} />
                  <span style={{ color: s === 'connected' ? COLORS.text : COLORS.textMute }}>{label}</span>
                </span>
              );
            })}
          </>
        )}
        <span style={{ color: COLORS.textMute }}>·</span>
        <span style={{ color: COLORS.text }}>{time.toLocaleTimeString('en-US', { hour12: false })} ET</span>
      </div>
    </div>
  );
};

export const AISearchBar = ({ onOpenAI }) => {
  const [val, setVal] = useState('');
  // Voice input — uses Web Speech API. Hold-to-talk pattern: clicking the
  // mic starts recording, clicking again stops. The transcript is fed
  // into onOpenAI as the starter prompt (same pathway as typed queries).
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef(null);

  const submit = () => {
    const q = val.trim();
    if (!q) {
      onOpenAI();
      return;
    }
    // Smart routing: if the query reads like a chart-edit command, route
    // it to the chart's AI Edit pathway via a global event. Otherwise
    // fall back to the regular AI assistant (open the panel with the
    // query as starter prompt).
    const lc = q.toLowerCase();
    const looksLikeChartEdit =
      // Style intents
      /day\s*trad|swing\s*trad|long.?term|momentum/.test(lc) ||
      // Indicator commands
      /\bsma\b|\bema\b|\brsi\b|\bmacd\b|bollinger|vwap|fibonacci/.test(lc) ||
      // Drawing
      /draw\s+(line|level)|hline|trendline|fib/.test(lc) ||
      // Subchart
      /show\s+(me\s+)?(dark\s*pool|net\s*flow|net\s*drift|heat\s*map|vol(atility)?\s*skew|gainers)/.test(lc) ||
      // Annotation
      /\b(annotate|label|mark|tag|pin)\b/.test(lc) ||
      // Preset / clean
      /^(save|load|recall|use|apply|remember|store)\b/.test(lc) ||
      /clean\s*(it|up)|^reset\b|clear\s+(drawing|indicator|annotation)/.test(lc);
    if (looksLikeChartEdit) {
      try {
        // Fire a global event the chart listens for. The chart's AI Edit
        // handler will pick it up and run the same parsing pipeline.
        window.dispatchEvent(new CustomEvent('imo:ai-edit-chart', {
          detail: { prompt: q },
        }));
      } catch {}
      setVal('');
      return;
    }
    // Otherwise: feed to the regular AI panel
    try { window.__pendingAIQuery = q; } catch {}
    setVal('');
    onOpenAI();
  };

  const startVoice = () => {
    // SpeechRecognition is supported in Chromium and most desktop Safari.
    // We feature-detect and fall back to opening the AI panel if not.
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      // No voice support — open AI panel and let the user type instead
      onOpenAI();
      return;
    }
    if (recording) {
      // Toggle off — stop the current recognition
      try { recognitionRef.current?.stop(); } catch {}
      setRecording(false);
      return;
    }
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const transcript = last[0].transcript;
      setVal(transcript);
      if (last.isFinal) {
        // Stash + open AI panel with the transcript
        try { window.__pendingAIQuery = transcript.trim(); } catch {}
        setVal('');
        setRecording(false);
        onOpenAI();
      }
    };
    r.onerror = () => setRecording(false);
    r.onend = () => setRecording(false);
    recognitionRef.current = r;
    r.start();
    setRecording(true);
  };

  return (
    <div className="relative">
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-md transition-all"
        style={{
          background: COLORS.surface,
          border: `1px solid ${recording ? COLORS.red : COLORS.mint + '55'}`,
          width: 160,
          boxShadow: recording
            ? `0 0 0 2px ${COLORS.red}33, 0 1px 4px rgba(0,0,0,0.1)`
            : `0 0 0 0 ${COLORS.mint}, 0 1px 4px rgba(0,0,0,0.1)`,
        }}
      >
        <input value={val}
               onChange={e => setVal(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') submit(); }}
               onClick={() => !val && !recording && onOpenAI()}
               placeholder={recording ? 'Listening…' : 'Ask me anything'}
               className="flex-1 bg-transparent outline-none text-[12.5px] min-w-0"
               style={{ color: COLORS.text }} />
        {val ? (
          <button onClick={submit}
                  className="text-[11px] px-1.5 py-0.5 rounded hover:bg-white/[0.06]"
                  style={{ color: COLORS.mint }}
                  title="Send">
            ↵
          </button>
        ) : (
          <button onClick={startVoice}
                  className="w-6 h-6 rounded-full flex items-center justify-center transition-all"
                  style={{
                    background: recording ? COLORS.red : COLORS.surface2,
                    border: `1px solid ${recording ? COLORS.red : COLORS.border}`,
                  }}
                  title={recording ? 'Stop listening' : 'Talk to AI'}>
                  {/* Mic glyph — drawn as SVG so it works without an icon
                      import. Color flips white when recording. */}
            <svg viewBox="0 0 24 24" width="12" height="12"
                 fill="none" stroke={recording ? '#FFFFFF' : COLORS.textDim}
                 strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8"  y1="23" x2="16" y2="23" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

// ───────────── InstIcon ─────────────
// Phase 3p.20 file-splitting: instrument-class icon. Renders an
// appropriate visual for crypto (Bitcoin glyph), stablecoin (green
// disc with $), equity (color-keyed letter tile), metal (gold disc
// with abbreviation), or fallback Droplet for FX/rates/etc.

export const EQUITY_TILE_COLORS = {
  // Mega-cap tech
  AAPL: '#A3AAAE', MSFT: '#00A4EF', NVDA: '#76B900', GOOG: '#4285F4',
  AMZN: '#FF9900', META: '#0866FF', TSLA: '#CC0000', AVGO: '#CC092F',
  // Financials
  JPM:  '#0066B2', BAC:  '#012169', GS:   '#7399C6', V:    '#1A1F71',
  // Consumer & retail
  WMT:  '#0071CE', COST: '#E31837', DIS:  '#006E9F',
  // Healthcare
  UNH:  '#002677', LLY:  '#D52B1E', JNJ:  '#D5282E',
  // Indices / ETFs
  SPY:  '#3D7BFF', QQQ:  '#6BA4E0', DIA:  '#3D7BFF',
  IWM:  '#6BA4E0', VTI:  '#3D7BFF',
};

/**
 * Instrument icon — renders an asset-class-appropriate symbol.
 *
 * @param {{ cls: string, size?: number, color?: string, ticker?: string }} props
 */
export const InstIcon = ({ cls, size = 16, color, ticker }) => {
  if (cls === 'crypto') return <Bitcoin size={size} style={{ color: color ?? '#F7931A' }} />;
  if (cls === 'stablecoin') {
    // USD-pegged token icon: green-tinted disc with "$" mark. Indicates
    // the asset is meant to track $1.00.
    return (
      <div style={{
        width: size, height: size,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #2EB872, #1B7F4F)',
        color: '#FFFFFF',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size > 20 ? 11 : 9,
        fontWeight: 700,
        lineHeight: 1,
      }}>$</div>
    );
  }
  if (cls === 'equity' && ticker) {
    const bg = EQUITY_TILE_COLORS[ticker] ?? COLORS.surface2;
    // First 1-2 chars of ticker, padded. AAPL → "A", SPY → "S", QQQ → "Q".
    const label = ticker.slice(0, 2);
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size > 20 ? 4 : 3,
          background: bg,
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size > 20 ? 11 : 8.5,
          fontWeight: 600,
          fontFamily: 'Inter, system-ui, sans-serif',
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {label}
      </div>
    );
  }
  if (cls === 'equity') return <Building2 size={size} style={{ color: color ?? '#3D7BFF' }} />;
  if (cls === 'metal') {
    // Metals get a gold-tinted disc with two-letter abbrev (XAU, XAG, etc.)
    const label = ticker ? ticker.slice(0, 2).replace(/-/g, '') : '⚱';
    return (
      <div style={{
        width: size, height: size,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #DBC375, #B8860B)',
        color: '#FFFFFF',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size > 20 ? 10 : 8,
        fontWeight: 700,
      }}>{label}</div>
    );
  }
  return <Droplet size={size} style={{ color: color ?? '#6BA4E0' }} />;
};

// ───────────── DetailRow ─────────────
// Phase 3p.24 file-splitting: tiny generic key/value display row.
// Used 50+ times across the app (instrument metadata pop-ups,
// company info panels, detail tooltips). Moved here so multiple
// page components can import it without duplication.
export const DetailRow = ({ k, v }) => (
  <div className="flex items-center justify-between">
    <span style={{ color: COLORS.textMute }}>{k}</span>
    <span className="tabular-nums" style={{ color: COLORS.text }}>{v}</span>
  </div>
);

// ───────────── SectorLetter ─────────────
// Phase 3p.31 file-splitting: small letter-tile component identifying
// an instrument's asset class. 3 uses across the app.

const SECTOR_LETTER_MAP = {
  equity:     { L: 'E', c: '#7AC8FF' },
  crypto:     { L: 'C', c: '#FFB84D' },
  stablecoin: { L: 'S', c: '#2EB872' },
  energy:     { L: 'O', c: '#FF8855' },
  metal:      { L: 'M', c: '#FFD050' },
  fx:         { L: 'F', c: '#7BFFB5' },
  rates:      { L: 'R', c: '#9F88FF' },
  index:      { L: 'I', c: '#FF9CDB' },
  bond:       { L: 'B', c: '#9F88FF' },
  ag:         { L: 'A', c: '#A0D67D' },
};

/**
 * Asset-class letter tile (E for equity, C for crypto, etc.). Extra
 * props are silently accepted to match InstIcon's signature for
 * convenience at call sites.
 *
 * @param {{ cls: string, size?: number, [key: string]: any }} props
 */
export const SectorLetter = ({ cls, size = 16, ...rest }) => {
  const tag = SECTOR_LETTER_MAP[cls] ?? { L: '?', c: '#999' };
  return (
    <span className="inline-flex items-center justify-center font-bold rounded shrink-0"
          style={{
            width: size, height: size,
            border: `1px solid ${tag.c}`,
            color: tag.c,
            background: `${tag.c}14`,
            fontFamily: 'ui-monospace, monospace',
            fontSize: Math.max(8, size * 0.6),
            lineHeight: 1,
          }}
          title={(cls ?? 'instrument').toUpperCase()}>
      {tag.L}
    </span>
  );
};
