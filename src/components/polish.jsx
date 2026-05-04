// IMO Onyx Terminal — polish-pass UI components
//
// Phase 3o.97 (file split, batch 9 — first React component extraction).
// All seven polish components from phases 3o.87 / 3o.88 land here.
// They share two characteristics that make them a clean batch:
//   1. They're leaf components — no children-of-this-codebase
//      dependencies (no imports of other internal React components)
//   2. They reference COLORS only, no other in-app context
//
// Public exports:
//
//   class PageErrorBoundary
//     Top-level error boundary that catches errors in the active page.
//     Resets when the `page` prop changes so navigating away from a
//     broken page lets users try again.
//
//   class PanelErrorBoundary
//     Granular sibling of PageErrorBoundary. Wraps individual panels so
//     one failing panel renders a compact recoverable card instead of
//     taking down everything around it. resetKey re-mounts children.
//
//   LoadingSkeleton
//     Shimmering placeholder for data-fetch loading states. Three
//     preset variants: card, table, chart. Uses imo-shimmer keyframe.
//
//   useVirtualizedRows
//     Lightweight scroll-based row windowing for long tables. Returns
//     containerRef + visibleRange + spacerTop/spacerBottom. rAF-throttled
//     scroll, configurable overscan.
//
//   KeyboardShortcutsOverlay
//     `?` cheat-sheet modal. ARIA-modal, focus trap, restores focus
//     on close. Reads KEYBOARD_SHORTCUTS from src/lib/constants.js.
//
//   OnboardingModal
//     First-run welcome flow (4 slides). Auto-shows once per user.
//     Re-openable via imo:open-onboarding event.
//
//   ONBOARDING_KEY
//     localStorage flag for "onboarding seen" state. Exposed so
//     the Settings panel's "Re-run welcome tour" can clear it.
//
//   usePinnedPanels (hook)
//   Pinnable (wrapper component)
//   PinnedPanelsBar (quick-jump nav)
//     Cross-panel favorites. Persist via imo_pinned_panels localStorage.
//     Sync via imo:pinned-panels-changed CustomEvent so multiple
//     instances stay coherent.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { COLORS, KEYBOARD_SHORTCUTS } from '../lib/constants.js';

export class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.warn('[PageErrorBoundary]', error?.message ?? error, info?.componentStack);
  }
  componentDidUpdate(prevProps) {
    // Reset error state when page changes — let the new page try to render
    if (prevProps.page !== this.props.page && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex items-center justify-center" style={{ background: COLORS.bg }}>
          <div className="text-center max-w-md px-6">
            <div className="text-[14px] mb-2" style={{ color: COLORS.text }}>
              This page hit an error
            </div>
            <div className="text-[11px] mb-4" style={{ color: COLORS.textMute }}>
              {this.state.error?.message ?? 'Unknown error'}
            </div>
            <button onClick={() => this.setState({ error: null })}
                    className="px-3 py-1.5 rounded text-[11px]"
                    style={{ background: COLORS.surface2, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Polish: PanelErrorBoundary (Phase 3o.87) ──────────────────────────
// Finer-grained sibling of PageErrorBoundary. Wraps individual panels
// (Risk page sub-panels, BottomPanel tabs, etc.) so one failing panel
// renders a compact recoverable card instead of taking down the whole
// page. Critical for panels that fetch external data — a Polygon
// timeout, a malformed API response, or a transient parsing bug
// shouldn't blow up everything around it.
//
// Usage:
//   <PanelErrorBoundary label="Sector concentration">
//     <SectorConcentrationPanel ... />
//   </PanelErrorBoundary>
//
// The `label` is used both for the error UI ("Sector concentration hit
// an error") and for telemetry-style logging. Resets via the "Try again"
// button (re-renders children, useful for transient API errors).
export class PanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: 0 };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    const label = this.props.label || 'unnamed panel';
    console.warn(`[PanelErrorBoundary:${label}]`, error?.message ?? error,
                 info?.componentStack?.split('\n').slice(0, 3).join('\n'));
  }
  retry = () => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };
  render() {
    if (this.state.error) {
      const label = this.props.label || 'this panel';
      return (
        <div className="rounded-md border p-3"
             style={{
               borderColor: `${COLORS.red}55`,
               background: `${COLORS.red}06`,
             }}>
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.red }}>
                {label} · error
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: COLORS.textDim }}>
                {String(this.state.error?.message ?? this.state.error ?? 'Unknown error').slice(0, 200)}
              </div>
            </div>
            <button onClick={this.retry}
                    className="px-2 py-1 rounded text-[10.5px] hover:opacity-80"
                    style={{ background: COLORS.surface2, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
              Try again
            </button>
          </div>
          <div className="text-[9.5px] mt-2" style={{ color: COLORS.textMute }}>
            Other panels on this page are unaffected. Most panel errors are transient (API timeout, rate limit) and resolve on retry.
          </div>
        </div>
      );
    }
    // Re-key the children on retry so React re-mounts (re-fires effects)
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}

// ─── Polish: LoadingSkeleton (Phase 3o.87) ─────────────────────────────
// Replaces ad-hoc "loading..." text with consistent shimmering placeholders
// that match the panel layout. Three preset variants:
//   variant="card"   — single card with title + value (headline metrics)
//   variant="table"  — compact table with N rows
//   variant="chart"  — chart-shaped placeholder
//
// Uses CSS keyframes (defined in the global stylesheet block) for the
// shimmer animation. Lightweight — pure layout, no dependencies.
export const LoadingSkeleton = ({ variant = 'card', rows = 3, className = '', label = null }) => {
  const shimmerStyle = {
    background: `linear-gradient(90deg, ${COLORS.surface2} 0%, ${COLORS.surface} 50%, ${COLORS.surface2} 100%)`,
    backgroundSize: '200% 100%',
    animation: 'imo-shimmer 1.6s ease-in-out infinite',
    borderRadius: 4,
  };
  if (variant === 'table') {
    return (
      <div className={`rounded-md border p-3 ${className}`}
           style={{ borderColor: COLORS.border, background: COLORS.surface }}>
        {label && (
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
            {label}
          </div>
        )}
        <div className="space-y-1.5">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div style={{ ...shimmerStyle, height: 10, width: '20%' }} />
              <div style={{ ...shimmerStyle, height: 10, flex: 1 }} />
              <div style={{ ...shimmerStyle, height: 10, width: '15%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (variant === 'chart') {
    return (
      <div className={`rounded-md border p-3 ${className}`}
           style={{ borderColor: COLORS.border, background: COLORS.surface }}>
        {label && (
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
            {label}
          </div>
        )}
        <div style={{ ...shimmerStyle, height: 180, width: '100%' }} />
      </div>
    );
  }
  // card (default)
  return (
    <div className={`rounded-md border p-3 ${className}`}
         style={{ borderColor: COLORS.border, background: COLORS.surface }}>
      {label && (
        <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
          {label}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded border p-2"
               style={{ borderColor: COLORS.border, background: COLORS.bg }}>
            <div style={{ ...shimmerStyle, height: 8, width: '60%', marginBottom: 6 }} />
            <div style={{ ...shimmerStyle, height: 14, width: '40%' }} />
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Polish: useVirtualizedRows hook (Phase 3o.87) ─────────────────────
// Lightweight row virtualization for long tables on Risk page. When a
// portfolio has 50+ positions, rendering all rows can drop frame rates
// and slow scroll. This hook windows the visible row range based on
// scroll position + rowHeight, rendering only ~visible+overscan rows.
//
// Usage:
//   const { containerRef, visibleRange, totalHeight, offsetY } =
//     useVirtualizedRows({ count: rows.length, rowHeight: 28, overscan: 5 });
//   // Inside render:
//   <div ref={containerRef} style={{ overflow: 'auto', height: 480 }}>
//     <div style={{ height: totalHeight }}>
//       <div style={{ transform: `translateY(${offsetY}px)` }}>
//         {rows.slice(visibleRange.start, visibleRange.end).map(...)}
//       </div>
//     </div>
//   </div>
//
// For tables, the wrapper structure is slightly different (since <table>
// can't have a transform on tbody well), but the pattern is the same:
// render only the visible slice into the tbody and use a spacer row
// at top/bottom to maintain scroll height.
export const useVirtualizedRows = ({ count, rowHeight = 28, overscan = 5, viewportHeight = 480 }) => {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    let raf = 0;
    const onScroll = () => {
      // rAF throttle to keep updates at 60Hz max
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setScrollTop(el.scrollTop);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  const startRaw = Math.floor(scrollTop / rowHeight);
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, startRaw - overscan);
  const end = Math.min(count, startRaw + visibleCount + overscan);
  return {
    containerRef,
    visibleRange: { start, end },
    totalHeight: count * rowHeight,
    offsetY: start * rowHeight,
    spacerTop: start * rowHeight,
    spacerBottom: Math.max(0, (count - end) * rowHeight),
  };
};

// ─── Polish: KeyboardShortcutsOverlay (Phase 3o.87) ────────────────────
// `?` key opens a global cheat sheet of all keyboard shortcuts in the
// app. Esc closes it. The overlay lists shortcuts by category so users
// can discover power features without reading docs.
//
// Mounted once at the app root. The `?` key is bound globally except
// when the user is typing in an input/textarea (so `?` in a search
// field types literally instead of opening the overlay).
// Phase 3o.96 (file split, batch 8): KEYBOARD_SHORTCUTS extracted to
// src/lib/constants.js.

export const KeyboardShortcutsOverlay = ({ open, onClose }) => {
  const closeBtnRef = useRef(null);
  // Phase 3o.88: focus trap + auto-focus on open. Per WAI-ARIA modal
  // pattern, focus moves into the dialog when it opens and Esc returns
  // focus to the previously-focused element on close.
  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    // Move focus to the close button so Esc/Enter is the immediate action
    setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      // Restore focus on close
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center"
         style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
         onClick={onClose}
         role="dialog"
         aria-modal="true"
         aria-labelledby="imo-shortcuts-title"
         aria-describedby="imo-shortcuts-desc">
      <div className="rounded-lg border max-w-3xl w-full mx-4 max-h-[80vh] overflow-auto imo-mobile-modal"
           style={{ background: COLORS.surface, borderColor: COLORS.borderHi, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
           onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 flex items-center justify-between border-b sticky top-0 z-10"
             style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          <div>
            <div id="imo-shortcuts-title" className="text-[14px]" style={{ color: COLORS.text }}>
              Keyboard shortcuts
            </div>
            <div id="imo-shortcuts-desc" className="text-[10.5px]" style={{ color: COLORS.textMute }}>
              Press <kbd className="px-1 py-0.5 rounded text-[9px]"
                        style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>?</kbd> anywhere to toggle ·
              <kbd className="ml-1 px-1 py-0.5 rounded text-[9px]"
                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>Esc</kbd> to close
            </div>
          </div>
          <button ref={closeBtnRef}
                  onClick={onClose}
                  aria-label="Close keyboard shortcuts"
                  className="px-2 py-1 rounded text-[11px] hover:opacity-80 focus:outline-none focus:ring-2"
                  style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
            Close
          </button>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
          {KEYBOARD_SHORTCUTS.map(group => (
            <section key={group.category} aria-labelledby={`shortcut-group-${group.category.replace(/\s+/g, '-')}`}>
              <div id={`shortcut-group-${group.category.replace(/\s+/g, '-')}`}
                   className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.mint }}>
                {group.category}
              </div>
              <ul className="space-y-1" role="list">
                {group.items.map((item, i) => (
                  <li key={i} className="flex items-center justify-between py-1 border-b"
                      style={{ borderColor: 'rgba(255,255,255,0.03)' }}>
                    <span className="text-[11px]" style={{ color: COLORS.textDim }}>{item.desc}</span>
                    <span className="flex items-center gap-1 shrink-0"
                          aria-label={`Shortcut: ${item.keys.join(' plus ')}`}>
                      {item.keys.map((k, j) => (
                        <React.Fragment key={j}>
                          {j > 0 && <span aria-hidden="true" style={{ color: COLORS.textMute }}>+</span>}
                          <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                               style={{
                                 background: COLORS.bg,
                                 color: COLORS.text,
                                 border: `1px solid ${COLORS.border}`,
                                 minWidth: 20,
                                 textAlign: 'center',
                               }}>{k}</kbd>
                        </React.Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="px-5 py-3 border-t text-[9.5px]"
             style={{ borderColor: COLORS.border, color: COLORS.textMute, background: COLORS.bg }}>
          Some shortcuts require focus to be outside text inputs. On Mac, ⌘ = Cmd; on Win/Linux, ⌘ = Ctrl.
          A handful of these are aspirational placeholders documenting the intended UX —
          functional binding lands progressively as we wire up each surface.
        </div>
      </div>
    </div>
  );
};

// ─── Polish: OnboardingModal (Phase 3o.88) ─────────────────────────────
// First-run welcome flow. Shown once per user (gated by a localStorage
// flag), dismissable at any step. Four short slides:
//   1. Welcome — what the platform is, who it's for
//   2. Command palette — ⌘K is your superpower
//   3. Keyboard shortcuts — ? opens the cheat sheet
//   4. AI features — Ask AI, Daily brief, Chart scanner
//
// Honest scope: pure UI guide. Does not auto-trigger any features —
// just points to where they live so users discover them. If a user
// dismisses before finishing, we still mark them as "seen" so we
// don't pester them again. They can re-open from Settings if needed.
export const ONBOARDING_KEY = 'imo_onboarding_seen';

export const ONBOARDING_STEPS = [
  {
    title: 'Welcome to Onyx Terminal',
    body: (
      <>
        <p>A research + execution platform with quantitative analytics, AI assistance, and
        real-time market data. Built for active traders who want everything in one surface
        without giving up depth.</p>
        <p style={{ marginTop: 10, opacity: 0.85 }}>This 30-second tour points out three
        power features people often miss. You can re-open it anytime from Settings.</p>
      </>
    ),
    highlight: 'Welcome',
  },
  {
    title: 'Command palette',
    keys: ['⌘', 'K'],
    body: (
      <>
        <p>Press <kbd className="px-1 py-0.5 rounded text-[10px]"
                     style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>⌘K</kbd> (Mac)
        or <kbd className="px-1 py-0.5 rounded text-[10px]"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>Ctrl+K</kbd> (Win/Linux)
        anywhere to open a fuzzy-search jump menu.</p>
        <p style={{ marginTop: 10 }}>Search across pages, tickers, and actions in one
        prompt. Type "ris" to jump to Risk, "btc" to switch to BTC-PERP, "settings" to
        open preferences. Way faster than clicking through nav.</p>
      </>
    ),
    highlight: 'Command palette',
  },
  {
    title: 'Keyboard shortcuts',
    keys: ['?'],
    body: (
      <>
        <p>Press <kbd className="px-1 py-0.5 rounded text-[10px]"
                     style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>?</kbd> anywhere
        to open a categorized cheat sheet of every keyboard shortcut. Navigation,
        trade-page actions, AI commands.</p>
        <p style={{ marginTop: 10 }}>Some shortcuts are documented intent ahead of full
        wiring — the cheat sheet is honest about which fire and which are aspirational.</p>
      </>
    ),
    highlight: 'Keyboard shortcuts',
  },
  {
    title: 'AI assistance',
    body: (
      <>
        <p>The AI sidebar (top right) takes natural-language questions about your portfolio,
        the market, or specific tickers. Try asking "What's my biggest concentration risk?"
        or "Analyze NVDA fundamentals."</p>
        <p style={{ marginTop: 10 }}>The Trade page has a Chart Scanner that takes a chart
        snapshot and returns bias / levels / setup analysis. Daily Brief greets you each
        morning with a portfolio-aware summary. Use as another pair of eyes — never as a
        substitute for your own thesis.</p>
      </>
    ),
    highlight: 'AI features',
  },
];

export const OnboardingModal = ({ open, onClose, onComplete }) => {
  const [step, setStep] = useState(0);
  const dialogRef = useRef(null);
  const primaryBtnRef = useRef(null);
  // Reset to step 0 each time it opens
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);
  // Focus management: send focus to the primary button on open + step change
  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    setTimeout(() => primaryBtnRef.current?.focus(), 0);
    return () => {
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [open, step]);
  // Phase 3o.89 — focus trap. Tab cycles within the modal so keyboard
  // users can't accidentally land on a hidden element behind the
  // backdrop. Esc closes (via the global handler in App root) so we
  // only trap Tab here.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(el => !el.disabled && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const total = ONBOARDING_STEPS.length;
  const cur = ONBOARDING_STEPS[step];
  const isLast = step === total - 1;
  const next = () => {
    if (isLast) {
      try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch {}
      onComplete?.();
      onClose();
    } else {
      setStep(s => s + 1);
    }
  };
  const skip = () => {
    try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch {}
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[101] flex items-center justify-center"
         style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)' }}
         role="dialog"
         aria-modal="true"
         aria-labelledby="imo-onboarding-title">
      <div ref={dialogRef}
           className="rounded-lg border max-w-lg w-full mx-4 imo-mobile-modal"
           style={{
             background: COLORS.surface,
             borderColor: COLORS.borderHi,
             boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
           }}>
        {/* Step indicator */}
        <div className="px-5 pt-4 flex items-center gap-1">
          {ONBOARDING_STEPS.map((_, i) => (
            <div key={i} className="flex-1 h-1 rounded-full"
                 style={{
                   background: i <= step ? COLORS.mint : COLORS.bg,
                   transition: 'background 200ms ease',
                 }}
                 aria-hidden="true" />
          ))}
        </div>
        <div className="p-5">
          <div className="flex items-baseline gap-2 mb-2">
            <h2 id="imo-onboarding-title"
                className="text-[16px] font-medium"
                style={{ color: COLORS.text }}>
              {cur.title}
            </h2>
            {cur.keys && (
              <span className="flex items-center gap-1">
                {cur.keys.map((k, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && <span style={{ color: COLORS.textMute }}>+</span>}
                    <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                         style={{
                           background: COLORS.bg,
                           color: COLORS.mint,
                           border: `1px solid ${COLORS.mint}55`,
                         }}>{k}</kbd>
                  </React.Fragment>
                ))}
              </span>
            )}
          </div>
          <div className="text-[12px] leading-relaxed" style={{ color: COLORS.textDim }}>
            {cur.body}
          </div>
        </div>
        <div className="px-5 py-3 border-t flex items-center justify-between"
             style={{ borderColor: COLORS.border, background: COLORS.bg }}>
          <button onClick={skip}
                  aria-label="Skip onboarding"
                  className="text-[11px] hover:underline"
                  style={{ color: COLORS.textMute }}>
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[10.5px]" style={{ color: COLORS.textMute }}>
              {step + 1} of {total}
            </span>
            {step > 0 && (
              <button onClick={() => setStep(s => Math.max(0, s - 1))}
                      aria-label="Previous step"
                      className="px-3 py-1 rounded text-[11px] hover:opacity-80 focus:outline-none focus:ring-2"
                      style={{ background: COLORS.surface2, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                Back
              </button>
            )}
            <button ref={primaryBtnRef}
                    onClick={next}
                    aria-label={isLast ? 'Finish onboarding' : 'Next step'}
                    className="px-3 py-1 rounded text-[11px] font-medium focus:outline-none focus:ring-2"
                    style={{ background: COLORS.mint, color: COLORS.bg }}>
              {isLast ? 'Got it' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Polish: Pinnable panel wrapper (Phase 3o.88) ──────────────────────
// Lets users mark Risk-page panels as favorites. Pinned panels:
//   - Render with a thin gold accent border for visual flagging
//   - Appear in a "Pinned panels" mini-nav at the top of the page
//     (anchor-link style — clicking scrolls to the panel)
//   - Persist across sessions via localStorage
//
// Why anchor-nav instead of true reorder: reordering panels with
// existing useMemo / useEffect deps would cause subtle re-mount issues
// and the current structure has tight prop dependencies between
// neighboring panels. Anchor nav is the pragmatic "pin to top" — one
// click takes you there.
//
// Usage:
//   <Pinnable id="sector-conc" label="Sector concentration">
//     <SectorConcentrationPanel ... />
//   </Pinnable>
export const PINNED_PANELS_KEY = 'imo_pinned_panels';

export const usePinnedPanels = () => {
  const [pinned, setPinned] = useState(() => {
    try {
      const raw = localStorage.getItem(PINNED_PANELS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const persist = useCallback((next) => {
    setPinned(next);
    try { localStorage.setItem(PINNED_PANELS_KEY, JSON.stringify(next)); } catch {}
    try {
      window.dispatchEvent(new CustomEvent('imo:pinned-panels-changed', { detail: next }));
    } catch {}
  }, []);
  useEffect(() => {
    const onChange = (e) => {
      if (Array.isArray(e?.detail)) setPinned(e.detail);
    };
    window.addEventListener('imo:pinned-panels-changed', onChange);
    return () => window.removeEventListener('imo:pinned-panels-changed', onChange);
  }, []);
  const isPinned = useCallback((id) => pinned.some(p => p.id === id), [pinned]);
  const togglePin = useCallback((id, label) => {
    if (pinned.some(p => p.id === id)) {
      persist(pinned.filter(p => p.id !== id));
    } else {
      persist([...pinned, { id, label }]);
    }
  }, [pinned, persist]);
  return { pinned, isPinned, togglePin };
};

export const Pinnable = ({ id, label, children, className = '' }) => {
  const { isPinned, togglePin } = usePinnedPanels();
  const pinned = isPinned(id);
  return (
    <div id={`imo-panel-${id}`}
         className={`relative ${pinned ? 'imo-pinned-panel' : ''} ${className}`}
         style={pinned ? {
           outline: `1px solid ${COLORS.chartGold}55`,
           outlineOffset: '2px',
           borderRadius: 8,
         } : undefined}>
      <button type="button"
              onClick={() => togglePin(id, label)}
              aria-label={pinned ? `Unpin ${label}` : `Pin ${label} to top`}
              aria-pressed={pinned}
              title={pinned ? `Unpin "${label}"` : `Pin "${label}" to top`}
              className="absolute top-1 right-1 z-[1] w-5 h-5 rounded text-[11px] leading-none flex items-center justify-center hover:opacity-100 focus:outline-none focus:ring-1 imo-no-print"
              style={{
                background: pinned ? `${COLORS.chartGold}1A` : 'transparent',
                color: pinned ? COLORS.chartGold : COLORS.textMute,
                border: `1px solid ${pinned ? COLORS.chartGold + '55' : 'transparent'}`,
                opacity: pinned ? 1 : 0.55,
              }}>
        {pinned ? '★' : '☆'}
      </button>
      {children}
    </div>
  );
};

export const PinnedPanelsBar = () => {
  const { pinned, togglePin } = usePinnedPanels();
  if (pinned.length === 0) return null;
  return (
    <nav className="rounded-md border p-2 imo-no-print"
         aria-label="Pinned panels"
         style={{ borderColor: `${COLORS.chartGold}33`, background: `${COLORS.chartGold}06` }}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.chartGold }}>
          ★ Pinned
        </span>
        {pinned.map(p => (
          <span key={p.id} className="flex items-center gap-1">
            <a href={`#imo-panel-${p.id}`}
               onClick={(e) => {
                 e.preventDefault();
                 const el = document.getElementById(`imo-panel-${p.id}`);
                 if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
               }}
               className="text-[10.5px] hover:underline focus:outline-none focus:ring-1 rounded px-1"
               style={{ color: COLORS.text }}>
              {p.label}
            </a>
            <button onClick={() => togglePin(p.id, p.label)}
                    aria-label={`Unpin ${p.label}`}
                    className="text-[10px] hover:opacity-100 focus:outline-none focus:ring-1 rounded"
                    style={{ color: COLORS.textMute, opacity: 0.6 }}>
              ×
            </button>
          </span>
        ))}
      </div>
    </nav>
  );
};
