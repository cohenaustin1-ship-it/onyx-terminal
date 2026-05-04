// IMO Onyx Terminal — Marketing site
//
// Phase 3p.19 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~89065-90360, ~1,295 lines).
//
// The unauthenticated landing page shown to visitors who haven't
// signed in. Uses its own Stripe-inspired light palette (the `S`
// object inside MarketingSite) — completely separate from the
// dark Onyx COLORS palette used in the authenticated app. That's
// why this extraction is so clean: no shared state, no shared
// styling, just three small helper components plus the page itself.
//
// Public export:
//   MarketingSite({ onSignIn })
//     onSignIn() — called when the visitor clicks "Sign in" or any
//                  CTA. The host app should swap to the authenticated
//                  surface in response.
//
// Internal:
//   MarketingContainer     — max-width centered wrapper
//   MarketingLiveStat      — count-up number that resets every ~12s
//   MarketingCounter       — count-up number, fires once on mount
//
// Honest scope:
//   - Pure presentation. No analytics, no form submission, no real
//     auth — all CTAs route through the single `onSignIn` callback.
//   - Hard-coded copy. If marketing copy needs to change frequently,
//     factor it out to a CMS or JSON file before shipping again.

import React, { useState, useEffect, useRef } from 'react';
import {
  Activity, BarChart3, Bot, Check, Eye, Layers, Radio, TrendingUp, Zap,
  LineChart as LineChartIcon,
} from 'lucide-react';
import { fetchPolygonMarketMap } from '../lib/polygon-api.js';

// Hoisted out of MarketingSite — defining it inside the parent component
// caused every re-render of MarketingSite (e.g. on scroll, on tickerData
// fetch) to create a brand-new function reference, which React treats as
// a different component type and unmounts/remounts the entire subtree.
// That made every MarketingCounter restart its animation and every text
// element flash. Keep this stable up here.
const MarketingContainer = ({ children, style = {} }) => (
  <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px', ...style }}>
    {children}
  </div>
);

// MarketingLiveStat — animates a count-up on mount, jitters slightly, and
// every ~12 seconds resets the count-up animation from zero so the number
// continually feels alive (per user request: "the 31T indicator animation
// should reset after a few seconds").
const MarketingLiveStat = ({ to, prefix = '', suffix = '', decimals = 0, jitter = 0.003 }) => {
  const [n, setN] = useState(0);
  // Trigger key — bumping this re-runs the count-up effect. We bump it
  // periodically so the animation re-plays after each cycle.
  const [animKey, setAnimKey] = useState(0);
  // Count-up phase — runs on mount and again every time `animKey` changes.
  useEffect(() => {
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 2500);
      // Ease-out quartic — feels punchy at the start, settles smoothly
      const eased = 1 - Math.pow(1 - t, 4);
      setN(to * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, animKey]);
  // Re-trigger the count-up every 12 seconds. After the count-up finishes
  // (~2.5s), the number sits at `to` for ~9.5s, then animates back from
  // zero. Gives the marketing page that "live ticker" pulse without being
  // distracting.
  useEffect(() => {
    const id = setInterval(() => setAnimKey(k => k + 1), 12000);
    return () => clearInterval(id);
  }, []);
  // Subtle jitter between count-up cycles so the number isn't perfectly
  // static. Smaller and slower than before so it doesn't fight the
  // count-up reset cycle.
  useEffect(() => {
    if (jitter <= 0) return;
    const id = setInterval(() => {
      const delta = (Math.random() - 0.5) * 2 * jitter * 0.5;
      setN(prev => to * (1 + delta));
    }, 4000);
    return () => clearInterval(id);
  }, [to, jitter]);
  return (
    <span style={{
      fontVariantNumeric: 'tabular-nums',
      fontFeatureSettings: '"tnum"',
      display: 'inline-block',
      willChange: 'contents',
      transition: 'opacity 200ms ease',
    }}>
      {prefix}{n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}{suffix}
    </span>
  );
};

const MarketingCounter = ({ to, prefix = '', suffix = '', decimals = 0 }) => {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf;
    let lastDisplayed = '';
    const start = performance.now();
    const tick = (now) => {
      // 3500ms count-up — was 1600ms. Slower feels more deliberate and stops
      // the eyebrow stat from looking like the page is rapidly refreshing.
      const t = Math.min(1, (now - start) / 3500);
      const eased = 1 - Math.pow(1 - t, 4);
      const next = to * eased;
      // Skip setState calls when rendered text wouldn't change. Cuts ~96fps
      // to once per visible integer step.
      const rendered = next.toFixed(decimals);
      if (rendered !== lastDisplayed) {
        lastDisplayed = rendered;
        setN(next);
      }
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, decimals]);
  return (
    <span style={{
      fontVariantNumeric: 'tabular-nums',
      fontFeatureSettings: '"tnum"',
      display: 'inline-block',
      // willChange tells the browser to GPU-composite this span so the
      // updates don't trigger surrounding layout reflow.
      willChange: 'contents',
    }}>
      {prefix}{n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}{suffix}
    </span>
  );
};

export const MarketingSite = ({ onSignIn }) => {
  // Track scroll for nav glassmorphism transition. Lightweight rAF-throttled
  // listener — only fires when crossing the 20px threshold so we're not
  // re-rendering on every pixel.
  const [scrolled, setScrolled] = useState(false);
  // The marketing root uses position:fixed + overflow:auto so it scrolls
  // independently of window. We attach the listener to the root via ref.
  const rootRef = useRef(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onScroll = () => setScrolled(root.scrollTop > 20);
    root.addEventListener('scroll', onScroll, { passive: true });
    // Also listen on window in case the user is testing in a harness where
    // marketing isn't fixed-positioned (e.g. dev preview).
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Stripe-style palette — light, generous whitespace, bold accents
  const S = {
    bg:           '#FFFFFF',
    bgSoft:       '#F6F9FC',          // Stripe's signature off-white
    surface:      '#FFFFFF',
    border:       '#E3E8EE',
    borderHi:     '#C1C9D2',
    text:         '#0A2540',          // Stripe's signature deep navy text
    textDim:      '#425466',
    textMute:     '#697386',
    accent:       '#635BFF',          // Stripe's exact indigo
    accentSoft:   '#EFEFFF',
    accentDark:   '#4F46DB',
    purple:       '#A28BF5',
    pink:         '#FF7AB6',
    orange:       '#FFB463',
    cyan:         '#75DDDD',
    code:         '#1A1F36',          // Dark code-block background
  };

  // Live ticker for the dashboard mockup card. Falls back to deterministic
  // values when no Polygon key is set so the visual still renders.
  const HEADLINE_TICKERS = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'JPM', 'V', 'XOM'];
  const [tickerData, setTickerData] = useState(() =>
    HEADLINE_TICKERS.map((t, i) => ({ ticker: t, change: ((i * 17 + 3) % 13) - 6, lastPrice: null }))
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = await fetchPolygonMarketMap();
      if (cancelled || !map) return;
      const live = HEADLINE_TICKERS.map(t => {
        const m = map.find(x => x.ticker === t);
        return m
          ? { ticker: t, change: m.change ?? 0, lastPrice: m.lastPrice }
          : { ticker: t, change: ((t.charCodeAt(0) * 17 + 3) % 13) - 6, lastPrice: null };
      });
      setTickerData(live);
    })();
    return () => { cancelled = true; };
  }, []);


  // Container is hoisted outside this component as MarketingContainer
  // to prevent the whole subtree from unmounting on every re-render.

  return (
    <div ref={rootRef} style={{
      position: 'fixed',
      inset: 0,
      zIndex: 100,
      overflow: 'auto',
      background: S.bg,
      color: S.text,
      fontFamily: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
    }}>
      {/* ────────── GLOBAL STYLES ────────── */}
      <style>{`
        @keyframes imo-mesh-drift {
          0%   { transform: translate(0%,   0%)   rotate(0deg)   scale(1); }
          25%  { transform: translate(-2%,  1%)   rotate(0.5deg) scale(1.02); }
          50%  { transform: translate(0%,   2%)   rotate(0deg)   scale(1.04); }
          75%  { transform: translate(2%,   1%)   rotate(-0.5deg) scale(1.02); }
          100% { transform: translate(0%,   0%)   rotate(0deg)   scale(1); }
        }
        @keyframes imo-fade-up {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes imo-ticker-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @keyframes imo-pulse {
          0%, 100% { opacity: 0.3; }
          50%      { opacity: 0.9; }
        }
        @keyframes imo-blink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0; }
        }
        .imo-fade-up { animation: imo-fade-up 1.2s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .imo-fade-up-d1 { animation-delay: 0.15s; }
        .imo-fade-up-d2 { animation-delay: 0.30s; }
        .imo-fade-up-d3 { animation-delay: 0.45s; }
        .imo-fade-up-d4 { animation-delay: 0.60s; }

        .imo-mkt-link {
          color: ${S.textDim};
          text-decoration: none;
          transition: color 200ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .imo-mkt-link:hover { color: ${S.accent}; }

        .imo-mkt-cta-primary {
          background: ${S.accent};
          color: #FFFFFF;
          border: none;
          font-weight: 500;
          transition: all 250ms cubic-bezier(0.22, 1, 0.36, 1);
          box-shadow: 0 1px 0 rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.15);
        }
        .imo-mkt-cta-primary:hover {
          background: ${S.accentDark};
          transform: translateY(-1px);
          box-shadow: 0 4px 14px rgba(99,91,255,0.30), inset 0 1px 0 rgba(255,255,255,0.15);
        }
        .imo-mkt-cta-secondary {
          background: rgba(255,255,255,0.85);
          color: ${S.accent};
          border: 1px solid ${S.border};
          font-weight: 500;
          transition: all 250ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .imo-mkt-cta-secondary:hover {
          background: ${S.bg};
          border-color: ${S.borderHi};
        }
        .imo-mkt-bento {
          background: ${S.bg};
          border-radius: 16px;
          border: 1px solid ${S.border};
          transition: box-shadow 400ms cubic-bezier(0.22, 1, 0.36, 1), border-color 400ms cubic-bezier(0.22, 1, 0.36, 1);
          overflow: hidden;
        }
        .imo-mkt-bento:hover {
          box-shadow: 0 18px 40px -16px rgba(50, 50, 93, 0.10), 0 8px 16px -8px rgba(0,0,0,0.06);
          border-color: ${S.borderHi};
        }
        .imo-mkt-logo-cloud img {
          filter: grayscale(100%) opacity(0.55);
          transition: filter 600ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .imo-mkt-logo-cloud > div:hover .imo-mkt-logo-text {
          color: ${S.text};
          opacity: 1;
        }
        .imo-mkt-logo-text {
          color: ${S.textMute};
          opacity: 0.55;
          font-weight: 700;
          letter-spacing: -0.5px;
          font-size: 22px;
          transition: all 600ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .imo-mkt-nav-item {
          padding: 10px 14px;
          border-radius: 8px;
          transition: background 250ms cubic-bezier(0.22, 1, 0.36, 1), color 250ms cubic-bezier(0.22, 1, 0.36, 1);
          font-size: 15px;
          font-weight: 500;
        }
        .imo-mkt-nav-item:hover {
          background: rgba(99,91,255,0.06);
          color: ${S.accent};
        }
        /* Scroll-margin so anchor sections aren't hidden behind the sticky nav.
           Combined with smooth scroll-behavior at the html level (set by the
           browser when behavior:'smooth' is passed), this gives a clean
           anchor jump that lands the section title visibly below the nav. */
        section[id] {
          scroll-margin-top: 80px;
        }
      `}</style>

      {/* ════════════════════════════════════════════════════════════
          NAV BAR — Stripe-style. Solid white from the start so it never
          blends with hero content behind it. Subtle border deepens on
          scroll for the layered-paper effect.
          ════════════════════════════════════════════════════════════ */}
      <nav style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        // Always-solid white background with high-saturation backdrop blur
        // — gives a premium frosted-glass feel without the "transparent
        // until scroll" trick that caused the blend-through bug.
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        // Bottom border deepens slightly when scrolled to communicate
        // "you've moved past the top" without changing background opacity.
        borderBottom: scrolled
          ? `1px solid ${S.border}`
          : `1px solid rgba(227,232,238,0.5)`,
        transition: 'border-color 400ms cubic-bezier(0.22, 1, 0.36, 1)',
        boxShadow: scrolled ? '0 1px 3px rgba(0,0,0,0.04)' : 'none',
      }}>
        <MarketingContainer style={{ padding: '16px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                {/* IMO wordmark — italic, bold, slight letterspace, Stripe vibe */}
                <span style={{
                  fontSize: 26,
                  fontWeight: 800,
                  letterSpacing: -1.2,
                  color: S.text,
                  fontStyle: 'italic',
                  fontFamily: '"Inter", sans-serif',
                }}>imo</span>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {/* Each label scrolls to the matching section on the marketing
                    page rather than navigating away. The IDs were added to
                    the corresponding <section> tags below. Smooth scroll uses
                    native `scrollIntoView` with behavior:'smooth'. */}
                {[
                  { label: 'Products',   anchor: 'products'   },
                  { label: 'Solutions',  anchor: 'solutions'  },
                  // Developers/Resources order swapped per UX request —
                  // Resources (docs, guides, learning content) is the
                  // higher-traffic destination so it gets the closer-
                  // to-center position; Developers (API/SDK) sits
                  // further out where the technical audience expects.
                  { label: 'Resources',  anchor: 'resources'  },
                  { label: 'Developers', anchor: 'developers' },
                  { label: 'Pricing',    anchor: 'pricing'    },
                ].map(item => (
                  <button
                    key={item.anchor}
                    onClick={() => {
                      // The MarketingSite root uses position:fixed + overflow:auto,
                      // so window.scrollTo is a no-op. We need to scroll the actual
                      // scrollable ancestor (the fixed div). Walk up until we find
                      // a node with overflow:auto/scroll, then call scrollTo on it.
                      const el = document.getElementById(item.anchor);
                      if (!el) return;
                      let scroller = el.parentElement;
                      while (scroller && scroller !== document.body) {
                        const cs = window.getComputedStyle(scroller);
                        if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break;
                        scroller = scroller.parentElement;
                      }
                      const navHeight = 80;
                      if (scroller && scroller !== document.body) {
                        const targetTop = el.getBoundingClientRect().top
                                        - scroller.getBoundingClientRect().top
                                        + scroller.scrollTop
                                        - navHeight;
                        scroller.scrollTo({ top: targetTop, behavior: 'smooth' });
                      } else {
                        // Fallback to native scrollIntoView
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }}
                    className="imo-mkt-nav-item imo-mkt-link"
                    style={{
                      color: S.text,
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={onSignIn} className="imo-mkt-cta-secondary"
                      style={{ padding: '8px 16px', borderRadius: 22, fontSize: 14, cursor: 'pointer' }}>
                Sign in
              </button>
              <button onClick={onSignIn} className="imo-mkt-cta-primary"
                      style={{ padding: '8px 16px', borderRadius: 22, fontSize: 14, cursor: 'pointer' }}>
                Get started ›
              </button>
            </div>
          </div>
        </MarketingContainer>
      </nav>

      {/* ════════════════════════════════════════════════════════════
          HERO — multi-layer mesh gradient sweep, big text, CTA pair
          ════════════════════════════════════════════════════════════ */}
      <section style={{
        position: 'relative',
        overflow: 'hidden',
        paddingTop: 80,
        paddingBottom: 100,
      }}>
        {/* Layer 1: large diagonal mesh gradient — Stripe's signature look */}
        <div style={{
          position: 'absolute',
          top: -300,
          right: -200,
          width: '95%',
          height: 1100,
          pointerEvents: 'none',
          animation: 'imo-mesh-drift 90s ease-in-out infinite',
          background: `
            radial-gradient(ellipse 60% 40% at 75% 20%, rgba(255,180,120,0.50) 0%, transparent 50%),
            radial-gradient(ellipse 50% 50% at 90% 35%, rgba(255,140,180,0.55) 0%, transparent 55%),
            radial-gradient(ellipse 60% 50% at 60% 50%, rgba(180,140,250,0.55) 0%, transparent 50%),
            radial-gradient(ellipse 50% 60% at 80% 70%, rgba(140,180,255,0.45) 0%, transparent 50%),
            radial-gradient(ellipse 40% 50% at 95% 85%, rgba(120,220,210,0.40) 0%, transparent 60%)
          `,
          filter: 'blur(50px) saturate(110%)',
        }} />
        {/* Layer 2: extra orange sweep for the right edge */}
        <div style={{
          position: 'absolute',
          top: -100,
          right: -100,
          width: '70%',
          height: 900,
          pointerEvents: 'none',
          background: `
            radial-gradient(ellipse 35% 60% at 95% 30%, rgba(255,140,80,0.32) 0%, transparent 60%),
            radial-gradient(ellipse 30% 50% at 85% 60%, rgba(255,90,180,0.28) 0%, transparent 60%)
          `,
          filter: 'blur(40px)',
          animation: 'imo-mesh-drift 110s ease-in-out infinite reverse',
        }} />

        <MarketingContainer style={{ position: 'relative' }}>
          <div className="imo-fade-up" style={{ maxWidth: 720 }}>
            {/* Eyebrow stat — like Stripe's "Global GDP running on Stripe" */}
            <div style={{
              fontSize: 14,
              color: S.textDim,
              marginBottom: 28,
              fontWeight: 500,
            }}>
              US equity market mapped:
              <span style={{ color: S.accent, marginLeft: 8, fontFamily: '"SF Mono", "JetBrains Mono", ui-monospace, monospace' }}>
                $<MarketingCounter to={32.4} decimals={2} />T
              </span>
            </div>

            {/* Headline — Stripe-style: bold dark text + lighter completion */}
            <h1 style={{
              fontSize: 'clamp(48px, 6vw, 72px)',
              lineHeight: 1.05,
              letterSpacing: -2,
              fontWeight: 600,
              color: S.text,
              margin: '0 0 24px 0',
            }}>
              <span>Trading infrastructure</span>{' '}
              <span style={{ color: S.textDim }}>to grow</span>{' '}
              <span style={{ color: S.text }}>your portfolio.</span>
            </h1>
            <p style={{
              fontSize: 21,
              lineHeight: 1.45,
              color: S.textDim,
              maxWidth: 620,
              margin: '0 0 36px 0',
              fontWeight: 400,
            }}>
              Trade equities, options, crypto, FX, and futures.
              Real-time data, AI research, and 130+ technical indicators —
              from your first trade to your billionth.
            </p>

            {/* CTA pair — primary indigo + Google sign-up secondary */}
            <div className="imo-fade-up imo-fade-up-d1" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={onSignIn} className="imo-mkt-cta-primary"
                      style={{ padding: '12px 24px', borderRadius: 22, fontSize: 15, cursor: 'pointer' }}>
                Get started ›
              </button>
              <button onClick={onSignIn} className="imo-mkt-cta-secondary"
                      style={{ padding: '12px 24px', borderRadius: 22, fontSize: 15, cursor: 'pointer',
                               display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M15.68 8.18c0-.6-.05-1.18-.15-1.73H8v3.27h4.3a3.68 3.68 0 0 1-1.6 2.41v2h2.58c1.51-1.4 2.4-3.45 2.4-5.95z" fill="#4285F4"/>
                  <path d="M8 16c2.16 0 3.97-.72 5.29-1.94l-2.58-2c-.72.48-1.63.77-2.7.77-2.08 0-3.84-1.4-4.47-3.29H.86v2.07A8 8 0 0 0 8 16z" fill="#34A853"/>
                  <path d="M3.53 9.54a4.79 4.79 0 0 1 0-3.08V4.4H.86a8 8 0 0 0 0 7.2l2.67-2.07z" fill="#FBBC04"/>
                  <path d="M8 3.18c1.18 0 2.23.4 3.05 1.2l2.29-2.3A8 8 0 0 0 .86 4.4l2.67 2.07C4.16 4.58 5.92 3.18 8 3.18z" fill="#EA4335"/>
                </svg>
                Sign up with Google
              </button>
            </div>
          </div>
        </MarketingContainer>
      </section>

      {/* ════════════════════════════════════════════════════════════
          LOGO CLOUD — removed per UX request. The brand row
          (Anthropic / Lightspeed / Cursor / OpenAI / amazon /
          NVIDIA / Ford) was generic-looking SaaS social proof and
          didn't add value above the section header that follows.
          ════════════════════════════════════════════════════════════ */}

      {/* ════════════════════════════════════════════════════════════
          SECTION HEADER — "Flexible solutions..."
          ════════════════════════════════════════════════════════════ */}
      <section id="solutions" style={{ padding: '80px 0 40px' }}>
        <MarketingContainer>
          <div style={{ maxWidth: 920 }}>
            <h2 style={{
              fontSize: 'clamp(32px, 4vw, 44px)',
              lineHeight: 1.15,
              letterSpacing: -1.2,
              fontWeight: 600,
              color: S.text,
              margin: 0,
            }}>
              Flexible solutions for every trader.
              <span style={{ color: S.textDim }}>
                {' '}Build your strategy with a comprehensive set of trading and research tools — designed to work individually or together.
              </span>
            </h2>
          </div>
        </MarketingContainer>
      </section>

      {/* ════════════════════════════════════════════════════════════
          BENTO BOX 1 — large feature card (chart preview) + 2 small
          ════════════════════════════════════════════════════════════ */}
      <section style={{ padding: '40px 0' }}>
        <MarketingContainer>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr',
            gap: 16,
            marginBottom: 16,
          }}>
            {/* Big chart preview card */}
            <div className="imo-mkt-bento" style={{ padding: 0, position: 'relative', minHeight: 480, overflow: 'hidden' }}>
              {/* Soft gradient sweep behind the chart */}
              <div style={{
                position: 'absolute',
                inset: 0,
                background: `
                  radial-gradient(ellipse 50% 60% at 80% 20%, rgba(255,200,160,0.30), transparent 60%),
                  radial-gradient(ellipse 60% 50% at 20% 80%, rgba(180,160,250,0.25), transparent 60%)
                `,
                pointerEvents: 'none',
              }} />
              <div style={{ position: 'relative', padding: 32 }}>
                <h3 style={{
                  fontSize: 28,
                  lineHeight: 1.15,
                  letterSpacing: -0.6,
                  fontWeight: 600,
                  color: S.text,
                  margin: '0 0 8px 0',
                  maxWidth: 380,
                }}>
                  Trade equities globally — online and on the chart
                </h3>
              </div>
              {/* Dashboard mockup */}
              <div style={{
                position: 'relative',
                margin: '20px 32px 32px',
                background: '#FFFFFF',
                borderRadius: 12,
                border: `1px solid ${S.border}`,
                boxShadow: '0 24px 60px -20px rgba(50,50,93,0.18), 0 4px 12px -4px rgba(0,0,0,0.06)',
                overflow: 'hidden',
              }}>
                {/* Browser chrome */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 14px',
                  borderBottom: `1px solid ${S.border}`,
                  gap: 6,
                  background: S.bgSoft,
                }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF5F57' }} />
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#FEBC2E' }} />
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#28C840' }} />
                  </div>
                  <div style={{
                    flex: 1, marginLeft: 12,
                    fontSize: 11, color: S.textMute,
                    fontFamily: 'ui-monospace, monospace',
                    textAlign: 'center',
                  }}>
                    🔒 onyx.imo/trade
                  </div>
                </div>
                <div style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 11, color: S.textMute, marginBottom: 2 }}>NASDAQ</div>
                      <div style={{ fontSize: 22, fontWeight: 600, color: S.text }}>
                        AAPL · ${tickerData.find(t => t.ticker === 'AAPL')?.lastPrice?.toFixed(2) ?? '232.15'}
                      </div>
                      <div style={{
                        fontSize: 13,
                        color: (tickerData.find(t => t.ticker === 'AAPL')?.change ?? 0.42) >= 0 ? '#1FB26B' : '#ED7088',
                      }}>
                        {(tickerData.find(t => t.ticker === 'AAPL')?.change ?? 0.42) >= 0 ? '+' : ''}
                        {(tickerData.find(t => t.ticker === 'AAPL')?.change ?? 0.42).toFixed(2)}% today
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {['1D','5D','1M','3M','1Y'].map((tf, i) => (
                        <span key={tf} style={{
                          padding: '4px 10px', borderRadius: 6, fontSize: 11,
                          background: i === 2 ? S.accentSoft : 'transparent',
                          color: i === 2 ? S.accent : S.textMute,
                          fontWeight: 500,
                        }}>{tf}</span>
                      ))}
                    </div>
                  </div>
                  <svg viewBox="0 0 600 200" style={{ width: '100%', height: 200 }}>
                    <defs>
                      <linearGradient id="grad-mkt-light" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={S.accent} stopOpacity="0.18"/>
                        <stop offset="100%" stopColor={S.accent} stopOpacity="0"/>
                      </linearGradient>
                    </defs>
                    {[40, 80, 120, 160].map(y => (
                      <line key={y} x1="0" y1={y} x2="600" y2={y}
                            stroke={S.border} strokeWidth="0.5" />
                    ))}
                    <path d="M 0,160 L 40,150 L 80,140 L 120,130 L 160,120 L 200,108 L 240,118 L 280,100 L 320,85 L 360,68 L 400,75 L 440,55 L 480,42 L 520,32 L 560,28 L 600,20 L 600,200 L 0,200 Z"
                          fill="url(#grad-mkt-light)" />
                    <path d="M 0,160 L 40,150 L 80,140 L 120,130 L 160,120 L 200,108 L 240,118 L 280,100 L 320,85 L 360,68 L 400,75 L 440,55 L 480,42 L 520,32 L 560,28 L 600,20"
                          stroke={S.accent} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Right column: 2 small bento cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="imo-mkt-bento" style={{ padding: 32, flex: 1, position: 'relative' }}>
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'radial-gradient(ellipse 60% 70% at 50% 100%, rgba(180,140,250,0.20), transparent 60%)',
                  pointerEvents: 'none',
                }} />
                <h3 style={{
                  fontSize: 24, lineHeight: 1.18, letterSpacing: -0.5,
                  fontWeight: 600, color: S.text, margin: '0 0 16px 0',
                  position: 'relative',
                }}>
                  Run any billing model
                </h3>
                <div style={{
                  position: 'relative', marginTop: 24,
                  background: S.bg, border: `1px solid ${S.border}`, borderRadius: 12, padding: 16,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 5, background: S.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 8, height: 8, borderRadius: 1, background: S.accent }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: S.text }}>Pro Plan</span>
                  </div>
                  <div style={{ fontSize: 11, color: S.textMute, marginBottom: 12 }}>Billed monthly</div>
                  <div style={{ fontSize: 12, color: S.textDim, marginBottom: 4 }}>Active strategies</div>
                  <div style={{ fontSize: 11, color: S.textMute, marginBottom: 8 }}>5 backtests / day</div>
                  <div style={{
                    height: 6, borderRadius: 3, overflow: 'hidden',
                    background: S.bgSoft,
                  }}>
                    <div style={{
                      width: '60%', height: '100%',
                      background: `linear-gradient(90deg, ${S.accent} 0%, ${S.purple} 50%, ${S.orange} 100%)`,
                    }} />
                  </div>
                </div>
              </div>

              <div className="imo-mkt-bento" style={{ padding: 32, flex: 1, position: 'relative', overflow: 'hidden' }}>
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'radial-gradient(ellipse 80% 80% at 50% 50%, rgba(255,170,120,0.20), transparent 60%)',
                  pointerEvents: 'none',
                }} />
                <h3 style={{
                  fontSize: 24, lineHeight: 1.18, letterSpacing: -0.5,
                  fontWeight: 600, color: S.text, margin: '0 0 12px 0',
                  position: 'relative',
                }}>
                  Tokens used in the last 30 days
                </h3>
                <div style={{ fontSize: 24, fontWeight: 600, color: S.text, position: 'relative', marginBottom: 16 }}>
                  2,010,569,010
                </div>
                {/* Mini bar chart */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 3, height: 70 }}>
                  {Array.from({ length: 24 }, (_, i) => {
                    const h = 12 + Math.abs(Math.sin(i * 0.5) * 50) + (i / 24) * 18;
                    return (
                      <div key={i} style={{
                        flex: 1,
                        height: h,
                        background: S.accent,
                        opacity: 0.5 + (i / 24) * 0.5,
                        borderRadius: 1,
                      }} />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ROW 2 — Three equal cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
          }}>
            <div className="imo-mkt-bento" style={{ padding: 32, position: 'relative', minHeight: 360, overflow: 'hidden' }}>
              <h3 style={{ fontSize: 22, lineHeight: 1.2, letterSpacing: -0.4, fontWeight: 600, color: S.text, margin: '0 0 20px 0' }}>
                Conversational AI research
              </h3>
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{
                  alignSelf: 'flex-end',
                  background: S.bgSoft, padding: '10px 14px', borderRadius: 14,
                  fontSize: 12, color: S.text, maxWidth: 220,
                  boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
                }}>
                  How is my AAPL position performing this week?
                </div>
                <div style={{
                  alignSelf: 'flex-start',
                  background: S.bg, border: `1px solid ${S.border}`,
                  padding: '10px 14px', borderRadius: 14,
                  fontSize: 12, color: S.text, maxWidth: 240,
                }}>
                  AAPL is up 1.42% week-over-week. Your 50 shares show $186 unrealized gain. RSI at 62 (neutral-bullish).
                </div>
                <div style={{
                  marginTop: 12, display: 'flex', gap: 8,
                }}>
                  <div style={{
                    flex: 1,
                    background: S.bgSoft, border: `1px solid ${S.border}`,
                    borderRadius: 10, padding: 12, position: 'relative',
                  }}>
                    <div style={{
                      width: '100%', aspectRatio: '1.4',
                      background: `linear-gradient(135deg, ${S.accent}, ${S.purple})`,
                      borderRadius: 6, marginBottom: 8,
                    }} />
                    <div style={{ fontSize: 11, fontWeight: 500, color: S.text, marginBottom: 2 }}>Buy more</div>
                    <div style={{ fontSize: 10, color: S.textMute }}>50 sh @ $232.15</div>
                  </div>
                  <div style={{
                    flex: 1,
                    background: S.bgSoft, border: `1px solid ${S.border}`,
                    borderRadius: 10, padding: 12,
                  }}>
                    <div style={{
                      width: '100%', aspectRatio: '1.4',
                      background: `linear-gradient(135deg, ${S.text}, ${S.textDim})`,
                      borderRadius: 6, marginBottom: 8,
                    }} />
                    <div style={{ fontSize: 11, fontWeight: 500, color: S.text, marginBottom: 2 }}>Hedge</div>
                    <div style={{ fontSize: 10, color: S.textMute }}>1 put @ $230</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="imo-mkt-bento" style={{ padding: 32, position: 'relative', minHeight: 360, overflow: 'hidden' }}>
              <h3 style={{ fontSize: 22, lineHeight: 1.2, letterSpacing: -0.4, fontWeight: 600, color: S.text, margin: '0 0 20px 0' }}>
                Issue tradeable derivatives
              </h3>
              <div style={{
                margin: '24px auto 0', maxWidth: 220,
                aspectRatio: '1.586', borderRadius: 16,
                background: `linear-gradient(135deg, ${S.purple} 0%, ${S.pink} 50%, ${S.orange} 100%)`,
                position: 'relative',
                boxShadow: '0 18px 36px -12px rgba(160,120,250,0.4)',
                overflow: 'hidden',
              }}>
                <div style={{ position: 'absolute', top: 16, left: 16, width: 36, height: 26, borderRadius: 4,
                  background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(8px)' }} />
                <div style={{
                  position: 'absolute', top: 18, right: 16,
                  fontSize: 10, color: '#FFFFFF', fontWeight: 700, letterSpacing: 1,
                }}>OPTIONS</div>
                <div style={{
                  position: 'absolute', bottom: 16, left: 16,
                  fontSize: 11, color: '#FFFFFF', opacity: 0.9, fontFamily: 'ui-monospace, monospace',
                }}>AAPL 240C 01/17</div>
                <div style={{
                  position: 'absolute', bottom: 14, right: 16,
                  fontSize: 16, color: '#FFFFFF', fontWeight: 800, fontStyle: 'italic',
                }}>imo</div>
              </div>
            </div>

            <div className="imo-mkt-bento" style={{ padding: 32, position: 'relative', minHeight: 360, overflow: 'hidden' }}>
              <h3 style={{ fontSize: 22, lineHeight: 1.2, letterSpacing: -0.4, fontWeight: 600, color: S.text, margin: '0 0 20px 0' }}>
                Access borderless markets with crypto and FX
              </h3>
              <svg viewBox="0 0 240 220" style={{ width: '100%', height: 220, position: 'relative' }}>
                {Array.from({ length: 60 }, (_, i) => {
                  const angle = (i / 60) * Math.PI * 2;
                  const r = 60 + (i % 5) * 6;
                  const cx = 120 + Math.cos(angle) * r;
                  const cy = 120 + Math.sin(angle) * r;
                  return <circle key={i} cx={cx} cy={cy} r={1.5} fill={S.accent} opacity={0.3 + (i % 7) * 0.07} />;
                })}
                {Array.from({ length: 80 }, (_, i) => {
                  const angle = (i / 80) * Math.PI * 2;
                  const r = 90 + (i % 7) * 4;
                  const cx = 120 + Math.cos(angle) * r;
                  const cy = 120 + Math.sin(angle) * r;
                  return <circle key={i + 100} cx={cx} cy={cy} r={1} fill={S.purple} opacity={0.4 + (i % 5) * 0.08} />;
                })}
                {[0, 1, 2].map(i => (
                  <ellipse key={i} cx="120" cy="120" rx={60 + i * 12} ry={20 + i * 4}
                           fill="none" stroke={S.purple} strokeWidth="0.6" opacity={0.4 - i * 0.1}
                           transform={`rotate(${-25 + i * 12} 120 120)`} />
                ))}
                <g transform="translate(160 50)">
                  <rect x="0" y="0" width="68" height="22" rx="6" fill="#FFFFFF" stroke={S.border} strokeWidth="1" />
                  <text x="8" y="15" fontSize="11" fontWeight="600" fill={S.text}>$844 USDC</text>
                </g>
              </svg>
            </div>
          </div>
        </MarketingContainer>
      </section>

      {/* ════════════════════════════════════════════════════════════
          STATS BAND
          ════════════════════════════════════════════════════════════ */}
      <section id="resources" style={{ padding: '80px 0', background: S.bgSoft }}>
        <MarketingContainer>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 32, textAlign: 'left',
          }}>
            {[
              { value: 32,    decimals: 1, suffix: 'T', prefix: '$', label: 'US equity market mapped' },
              { value: 130,   suffix: '+', label: 'Technical indicators' },
              { value: 22,    suffix: '+', label: 'Real-time data feeds' },
              { value: 99.97, decimals: 2, suffix: '%', label: 'Uptime, last 12 months' },
            ].map((s, i) => (
              <div key={i}>
                <div style={{
                  fontSize: 56, fontWeight: 600, letterSpacing: -2,
                  color: S.accent, lineHeight: 1, marginBottom: 8,
                }}>
                  <MarketingLiveStat to={s.value} prefix={s.prefix ?? ''} suffix={s.suffix ?? ''} decimals={s.decimals ?? 0} jitter={s.jitter ?? 0.003} />
                </div>
                <div style={{ fontSize: 14, color: S.textDim, fontWeight: 500 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </MarketingContainer>
      </section>

      {/* ════════════════════════════════════════════════════════════
          FEATURE GRID — multi-column with lucide-style icons
          ════════════════════════════════════════════════════════════ */}
      <section id="products" style={{ padding: '100px 0' }}>
        <MarketingContainer>
          <div style={{ maxWidth: 720, marginBottom: 64 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: S.accent,
              letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 16,
            }}>
              The whole stack
            </div>
            <h2 style={{
              fontSize: 'clamp(36px, 4vw, 52px)',
              lineHeight: 1.1, letterSpacing: -1.4,
              fontWeight: 600, color: S.text, margin: 0,
            }}>
              Everything you need.<br/>
              <span style={{ color: S.textDim }}>Nothing you don't.</span>
            </h2>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 48, rowGap: 56,
          }}>
            {[
              { icon: <TrendingUp size={20} />, title: 'Live order book',    body: 'Real bid/ask spreads from the exchange feed. Top-of-book updates with delayed-cluster WebSocket streaming.' },
              { icon: <Layers size={20} />,    title: 'Options chain',      body: 'Full chain with real Greeks (delta · gamma · theta · vega) and IV. Refreshes every 30 seconds during market hours.' },
              { icon: <BarChart3 size={20} />, title: 'Volume by Price',    body: 'Vertical price-axis profile shows where volume actually traded. POC, Value Area High/Low, all the way back 365 days.' },
              { icon: <Activity size={20} />,  title: '130+ indicators',    body: 'Every standard plus exotic. Bollinger, MACD, RSI, Ichimoku, Supertrend, Volume Profile, Anchored VWAP, fully wired.' },
              { icon: <Zap size={20} />,       title: 'Strategy backtest',  body: 'SMA/MA Cross, RSI, MACD, Bollinger Reversion, Channel Breakout. Star a strategy, signals appear instantly.' },
              { icon: <Eye size={20} />,       title: 'Pattern detection',  body: 'Auto-finds Doji, Hammer, Shooting Star, Engulfing — plus chart patterns: Head & Shoulders, Double Top, Cup & Handle.' },
              { icon: <Bot size={20} />,       title: 'AI research',        body: 'Ask Onyx anything about your portfolio. Powered by Anthropic Claude with full context: positions, balance, risk profile.' },
              { icon: <Radio size={20} />,     title: 'Geo-intelligence',   body: 'See wildfires, weather, supply chains, and military events overlaid on a real map. Trade the news before it\'s news.' },
              { icon: <LineChartIcon size={20} />, title: 'Market map',     body: 'Finviz-style heatmap of the entire US equity market. 80+ stocks, 11 sectors, sized by cap, colored by performance.' },
            ].map((f, i) => (
              <div key={i}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: S.accentSoft, color: S.accent,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 16,
                }}>
                  {f.icon}
                </div>
                <h3 style={{
                  fontSize: 17, fontWeight: 600, color: S.text,
                  margin: '0 0 8px 0', letterSpacing: -0.2,
                }}>
                  {f.title}
                </h3>
                <p style={{
                  fontSize: 14.5, lineHeight: 1.55, color: S.textDim, margin: 0,
                }}>
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </MarketingContainer>
      </section>

      {/* ════════════════════════════════════════════════════════════
          DATA SOURCES — code snippet + bullet list
          ════════════════════════════════════════════════════════════ */}
      <section id="developers" style={{ padding: '100px 0', background: S.bgSoft }}>
        <MarketingContainer>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center' }}>
            <div>
              <div style={{
                fontSize: 13, fontWeight: 600, color: S.accent,
                letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 16,
              }}>
                Real data, not demos
              </div>
              <h2 style={{
                fontSize: 'clamp(32px, 4vw, 44px)',
                lineHeight: 1.1, letterSpacing: -1.2,
                fontWeight: 600, color: S.text, margin: '0 0 20px 0',
              }}>
                Wired into the actual market.
              </h2>
              <p style={{
                fontSize: 17, lineHeight: 1.55, color: S.textDim, marginBottom: 32,
              }}>
                Onyx isn't a paper-trading sandbox with fake numbers.
                The chart you see is the chart that prints — Polygon equity feeds with real
                WebSocket Q-channel quotes, Coinbase crypto streams, EIA energy settlements,
                ExchangeRate-API FX, SEC EDGAR filings, and SPDR sector ETF snapshots — all live.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                {[
                  'Polygon · equities + options',
                  'Coinbase · crypto WebSocket',
                  'SEC EDGAR · 10-Q / 10-K filings',
                  'ExchangeRate-API · 6 FX pairs',
                  'NASA FIRMS · wildfire overlay',
                  'EconDB · macro time series',
                  'Tradestie · WSB sentiment',
                  'Anthropic · AI research',
                ].map((src, i) => (
                  <div key={i} style={{
                    fontSize: 13, color: S.textDim,
                    display: 'flex', alignItems: 'center', gap: 8,
                    fontFamily: '"SF Mono", ui-monospace, monospace',
                  }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%', background: S.accent,
                      animation: 'imo-pulse 8s ease-in-out infinite',
                      animationDelay: `${i * 280}ms`,
                    }} />
                    {src}
                  </div>
                ))}
              </div>
            </div>

            {/* Terminal-style code snippet */}
            <div style={{
              background: S.code,
              borderRadius: 14,
              padding: 0,
              overflow: 'hidden',
              boxShadow: '0 24px 48px -12px rgba(50,50,93,0.18)',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center',
                padding: '12px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                gap: 6,
              }}>
                <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#FF5F57' }} />
                <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#FEBC2E' }} />
                <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28C840' }} />
                <div style={{
                  flex: 1, textAlign: 'center',
                  fontSize: 11, color: 'rgba(255,255,255,0.5)',
                  fontFamily: '"SF Mono", ui-monospace, monospace',
                }}>
                  ~/imo-onyx
                </div>
              </div>
              <pre style={{
                margin: 0, padding: 24,
                fontFamily: '"SF Mono", "JetBrains Mono", ui-monospace, monospace',
                fontSize: 12.5,
                lineHeight: 1.7,
                color: '#A4B1CD',
              }}>
{`$ imo connect aapl --realtime
`}<span style={{ color: S.cyan }}>{`Connecting to Polygon WebSocket...`}</span>{`
`}<span style={{ color: '#5FCB87' }}>{`✓ Authenticated as cohenaustin1`}</span>{`
`}<span style={{ color: '#5FCB87' }}>{`✓ Subscribed: T.AAPL,A.AAPL,Q.AAPL`}</span>{`

`}<span style={{ color: S.orange }}>{`AAPL`}</span>{`  `}<span style={{ color: '#A4B1CD' }}>{`bid`}</span>{`  `}<span style={{ color: '#5FCB87' }}>{`232.14`}</span>{`  `}<span style={{ color: '#A4B1CD' }}>{`ask`}</span>{`  `}<span style={{ color: '#5FCB87' }}>{`232.16`}</span>{`
`}<span style={{ color: S.orange }}>{`AAPL`}</span>{`  `}<span style={{ color: '#A4B1CD' }}>{`last`}</span>{` `}<span style={{ color: '#5FCB87' }}>{`232.15`}</span>{`  `}<span style={{ color: '#A4B1CD' }}>{`vol`}</span>{`  `}<span style={{ color: '#5FCB87' }}>{`52.4M`}</span>{`
`}<span style={{ color: S.orange }}>{`AAPL`}</span>{`  `}<span style={{ color: '#A4B1CD' }}>{`change`}</span>{` `}<span style={{ color: '#5FCB87' }}>{`+0.42%`}</span>{`
`}<span style={{ color: '#A4B1CD' }}>{`Streaming `}</span><span style={{ color: '#5FCB87' }}>{`●`}</span><span style={{ animation: 'imo-blink 1.4s infinite', color: '#5FCB87' }}>{`_`}</span>
              </pre>
            </div>
          </div>
        </MarketingContainer>
      </section>

      {/* ════════════════════════════════════════════════════════════
          PRICING
          ════════════════════════════════════════════════════════════ */}
      <section id="pricing" style={{ padding: '100px 0' }}>
        <MarketingContainer>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: S.accent,
              letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 16,
            }}>
              Pricing
            </div>
            <h2 style={{
              fontSize: 'clamp(36px, 4vw, 48px)',
              lineHeight: 1.1, letterSpacing: -1.4,
              fontWeight: 600, color: S.text, margin: 0,
            }}>
              Honest tiers. No surprise fees.
            </h2>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16, maxWidth: 1080, margin: '0 auto',
          }}>
            {[
              {
                name: 'Free',
                price: '$0',
                tagline: 'Paper trading + delayed data',
                features: ['$100K paper money', '15-min delayed equity quotes', 'All 130+ indicators', 'Volume profile & market map', 'Basic AI research'],
                cta: 'Start free',
              },
              {
                name: 'Starter',
                price: '$30',
                priceSuffix: '/mo',
                tagline: 'Real data, real spreads',
                features: ['Everything in Free', 'Real-time WebSocket quotes', 'Full options chain + Greeks', '5-year historical bars', 'Live volume-by-price', 'SEC filings & financials'],
                cta: 'Upgrade',
                featured: true,
              },
              {
                name: 'Pro',
                price: '$199',
                priceSuffix: '/mo',
                tagline: 'Sub-50ms execution',
                features: ['Everything in Starter', 'Tick-level real-time data', 'Level-2 order book', 'Options WebSocket streaming', 'Unlimited API access', 'Priority support'],
                cta: 'Contact sales',
              },
            ].map(p => (
              <div key={p.name} className="imo-mkt-bento" style={{
                padding: 32,
                background: p.featured ? `linear-gradient(180deg, ${S.accentSoft} 0%, ${S.bg} 60%)` : S.bg,
                border: `1px solid ${p.featured ? S.accent + '44' : S.border}`,
                position: 'relative',
              }}>
                {p.featured && (
                  <div style={{
                    position: 'absolute', top: -10, right: 24,
                    padding: '4px 12px', borderRadius: 12,
                    background: S.accent, color: '#FFFFFF',
                    fontSize: 10, fontWeight: 700, letterSpacing: 1,
                  }}>POPULAR</div>
                )}
                <div style={{
                  fontSize: 12, color: S.textDim, fontWeight: 600,
                  letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12,
                }}>{p.name}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
                  <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: -1.4, color: S.text }}>{p.price}</div>
                  {p.priceSuffix && <div style={{ fontSize: 14, color: S.textDim, marginLeft: 6 }}>{p.priceSuffix}</div>}
                </div>
                <div style={{ fontSize: 14, color: S.textDim, marginBottom: 28 }}>{p.tagline}</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {p.features.map(f => (
                    <li key={f} style={{ fontSize: 14, color: S.text, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <Check size={16} style={{ color: S.accent, marginTop: 2, flexShrink: 0 }} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <button onClick={onSignIn}
                        className={p.featured ? 'imo-mkt-cta-primary' : 'imo-mkt-cta-secondary'}
                        style={{ width: '100%', padding: '12px 20px', borderRadius: 22, fontSize: 14, cursor: 'pointer' }}>
                  {p.cta}
                </button>
              </div>
            ))}
          </div>
        </MarketingContainer>
      </section>

      {/* ════════════════════════════════════════════════════════════
          FINAL CTA — gradient block
          ════════════════════════════════════════════════════════════ */}
      <section style={{ padding: '80px 0 120px' }}>
        <MarketingContainer>
          <div style={{
            background: `
              radial-gradient(ellipse 60% 80% at 0% 50%, rgba(255,180,120,0.4), transparent 60%),
              radial-gradient(ellipse 60% 80% at 100% 50%, rgba(180,140,250,0.4), transparent 60%),
              ${S.bgSoft}
            `,
            borderRadius: 24,
            padding: '80px 48px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <h2 style={{
              fontSize: 'clamp(36px, 5vw, 56px)',
              lineHeight: 1.05, letterSpacing: -2,
              fontWeight: 600, color: S.text, margin: '0 0 20px 0',
            }}>
              Stop guessing.<br/>Start trading.
            </h2>
            <p style={{
              fontSize: 18, color: S.textDim, maxWidth: 560,
              margin: '0 auto 36px', lineHeight: 1.5,
            }}>
              Every trader who joins gets $100,000 in paper money, real-time charts, and the entire platform — free.
            </p>
            <button onClick={onSignIn} className="imo-mkt-cta-primary"
                    style={{ padding: '14px 32px', borderRadius: 24, fontSize: 16, cursor: 'pointer' }}>
              Create your free account ›
            </button>
          </div>
        </MarketingContainer>
      </section>

      {/* ════════════════════════════════════════════════════════════
          FOOTER
          ════════════════════════════════════════════════════════════ */}
      <footer style={{ borderTop: `1px solid ${S.border}`, padding: '64px 0 40px', background: S.bg }}>
        <MarketingContainer>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 32, marginBottom: 48,
          }}>
            <div style={{ minWidth: 200 }}>
              <span style={{
                fontSize: 26, fontWeight: 800, letterSpacing: -1.2,
                color: S.text, fontStyle: 'italic',
              }}>imo</span>
              <p style={{ fontSize: 13, color: S.textMute, lineHeight: 1.55, margin: '12px 0 0 0', maxWidth: 220 }}>
                Institutional-grade trading infrastructure for retail traders.
              </p>
            </div>
            {[
              // Each footer link maps to either an app page (clicking
              // signs the user in directly to that page) or a marketing
              // section anchor (smooth-scrolls there). The `to` field
              // distinguishes: 'page:trade' = sign in to Trade,
              // 'anchor:pricing' = scroll to Pricing section.
              { title: 'Product',   items: [
                { label: 'Trading',     to: 'page:trade'      },
                { label: 'Portfolio',   to: 'page:portfolio'  },
                { label: 'Research',    to: 'page:feed'       },
                { label: 'AI Assistant',to: 'page:trade'      },
                { label: 'Pricing',     to: 'anchor:pricing'  },
              ]},
              { title: 'Markets',   items: [
                { label: 'Equities',  to: 'page:trade'     },
                { label: 'Options',   to: 'page:trade'     },
                { label: 'Crypto',    to: 'page:trade'     },
                { label: 'FX',        to: 'page:trade'     },
                { label: 'Energy',    to: 'page:trade'     },
                { label: 'Metals',    to: 'page:trade'     },
              ]},
              { title: 'Resources', items: [
                { label: 'Terminal',  to: 'page:map'         },
                { label: 'Watchlist', to: 'page:watchlist'   },
                { label: 'Predictions',to:'page:predictions' },
                { label: 'Learn',     to: 'page:learn'       },
                { label: 'Vaults',    to: 'page:vaults'      },
              ]},
              { title: 'Company',   items: [
                { label: 'Leaderboard',to:'page:leaderboard' },
                { label: 'Discuss',   to: 'page:discuss'     },
                { label: 'Docs',      to: 'page:docs'        },
                { label: 'Referrals', to: 'page:referrals'   },
                { label: 'Budget',    to: 'page:budget'      },
              ]},
            ].map(col => (
              <div key={col.title}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: S.text,
                  marginBottom: 16, letterSpacing: 0.2,
                }}>{col.title}</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {col.items.map(it => (
                    <li key={it.label}>
                      <button
                        onClick={() => {
                          if (it.to.startsWith('page:')) {
                            const page = it.to.slice(5);
                            try { localStorage.setItem('imo_pending_page', page); } catch {}
                            onSignIn();
                          } else if (it.to.startsWith('anchor:')) {
                            const id = it.to.slice(7);
                            const el = document.getElementById(id);
                            if (el) {
                              const top = el.getBoundingClientRect().top + window.scrollY - 80;
                              window.scrollTo({ top, behavior: 'smooth' });
                            }
                          }
                        }}
                        className="imo-mkt-link"
                        style={{
                          fontSize: 13.5,
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontFamily: 'inherit',
                        }}>
                        {it.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div style={{
            paddingTop: 32, borderTop: `1px solid ${S.border}`,
            display: 'flex', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 12,
            fontSize: 13, color: S.textMute,
          }}>
            <div>© 2026 IMO Onyx Terminal</div>
            <div style={{ display: 'flex', gap: 24 }}>
              <a href="#" className="imo-mkt-link">Privacy</a>
              <a href="#" className="imo-mkt-link">Terms</a>
              <a href="#" className="imo-mkt-link">Disclosures</a>
            </div>
          </div>
          <div style={{
            marginTop: 24, padding: 16,
            background: S.bgSoft, borderRadius: 8,
            fontSize: 12, color: S.textMute, lineHeight: 1.5,
          }}>
            <strong style={{ color: S.textDim }}>Disclosure:</strong> IMO Onyx Terminal is a fictional trading platform built as a product showcase.
            Market data displayed is real where API keys are configured (Polygon, Coinbase, EIA, etc.) and simulated otherwise.
            Paper trading does not involve real funds. Not investment advice.
          </div>
        </MarketingContainer>
      </footer>
    </div>
  );
};
