// IMO Onyx Terminal — AI Agent panel
//
// Phase 3p.20 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~85503-86371, ~868 lines).
//
// The "Ask AI" sliding panel that opens from the chart toolbar.
// Routes user prompts through callAI (the multi-provider dispatcher
// in src/lib/ai-calls.js) and renders streamed responses via
// AIMarkdown. Chat history is kept in component state — not
// persisted between sessions.
//
// Public export:
//   AIAgentPanel({ instrument, page, account, onClose, setPage })
//     instrument — current instrument context (passed into prompts)
//     page       — current page id (used to bias suggested prompts)
//     account    — account record (lets the AI reason about positions)
//     onClose()  — collapse the panel
//     setPage(id) — navigate (the AI may suggest "open Portfolio")
//
// Honest scope:
//   - In-session chat only — closing the panel discards history.
//     The cloud-synced snippets feature (3p.13) is the persistence
//     surface for content the user wants to keep.
//   - Suggested prompts are hard-coded by page. A more sophisticated
//     version would generate them from the current instrument's
//     recent activity / news / chart pattern.

import React, { useState, useEffect, useRef } from 'react';
import {
  Send, Sparkles, X, ChevronDown, Image as ImageIcon,
  // Persona icons (inlined from monolith during 3p.20 — used by PERSONA_ICONS)
  Diamond, Target, Ruler, Search, Brain, Shield, Dice5, Globe, Sigma,
} from 'lucide-react';
import { COLORS } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import { callAI } from '../lib/ai-calls.js';
import { resolveActiveProvider, resolveLlmKey } from '../lib/llm-providers.js';
import { AI_SYSTEM_PROMPT } from '../lib/ai-prompts.js';
import { PREDICTION_EVENTS } from '../lib/map-data.js';
import { FINANCIAL_EVENTS } from './mini-widgets.jsx';
import { AIMarkdown } from './ai-markdown.jsx';
import { InstIcon } from './leaf-ui.jsx';

// Env-var key (duplicated from monolith — same source, separate read).
// Used to decide whether the "Bring your own key" hint shows.
const ANTHROPIC_API_KEY = (() => { try { return import.meta.env?.VITE_ANTHROPIC_API_KEY ?? ''; } catch { return ''; } })();

// fmt + fmtCompact (inlined from monolith during 3p.20 file-splitting).
// The monolith uses these in 189 places; rather than make every site
// import from a shared module — a separate refactor — we inline the
// tiny formatters here. _getFmtLocale reads imo_settings.numberFormat
// (set in the user's preferences) so locale-specific number rendering
// stays consistent with the rest of the app.
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
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
};


// AI_PERSONAS — named-investor agents inspired by FinceptTerminal's
// 37-agent system. Picking a persona prepends a system-prompt fragment
// that makes Claude reason in that investor's framework. Inlined from
// Minimal canned response used when no AI key is configured OR the real
// API call fails. Inlined from monolith in 3p.37 (ai-agent-panel is the
// only caller).
const cannedAIResponse = (inst, prompt) => {
  const clsLabel = inst.cls === 'crypto' ? 'cryptocurrency perpetual' :
                   inst.cls === 'equity' ? 'equity instrument' :
                   'energy futures contract';
  return `${inst.id} is a ${clsLabel} (${inst.name}) currently trading at approximately $${fmt(inst.mark, inst.dec)}. The 24-hour change is ${inst.change24h >= 0 ? '+' : ''}${inst.change24h.toFixed(2)}%, with $${fmtCompact(inst.vol24h).replace('$','')} in daily volume. I'm running in demo mode right now — add a VITE_ANTHROPIC_API_KEY in Vercel to enable real AI-generated summaries. (I would never recommend trading actions even with a key.)`;
};

// the monolith during 3p.20 file-splitting since AIAgentPanel is the
// only caller. PERSONA_ICONS maps persona id → lucide icon component
// for consistent monochrome rendering that respects text color.
const PERSONA_ICONS = {
  analyst: Diamond,
  buffett: Target,
  graham:  Ruler,
  lynch:   Search,
  munger:  Brain,
  klarman: Shield,
  marks:   Dice5,
  macro:   Globe,
  quant:   Sigma,
};

const AI_PERSONAS = [
  { id: 'analyst',  label: 'Analyst',         bio: 'Neutral institutional analyst. Default voice.',
    prompt: '' },
  { id: 'buffett',  label: 'Warren Buffett',  bio: 'Value · economic moat · long horizon · margin of safety.',
    prompt: 'Adopt the investing framework of Warren Buffett. Focus on intrinsic value, durable competitive advantages (economic moats), management quality, and a long holding period. Insist on a margin of safety. Avoid speculation. Use simple, plainspoken language. Quote Buffett-style aphorisms only when genuinely fitting.' },
  { id: 'graham',   label: 'Benjamin Graham', bio: 'Deep value · net-net · quantitative safety.',
    prompt: 'Reason as Benjamin Graham. Apply quantitative safety screens: P/E, P/B, current ratio, debt/equity, dividend record, earnings stability over 10 years. Treat the market as Mr. Market — moody and to be exploited, not followed. Emphasize defensive vs enterprising investor framing.' },
  { id: 'lynch',    label: 'Peter Lynch',     bio: 'GARP · invest in what you know · earnings growth.',
    prompt: 'Reason as Peter Lynch. Look for growth at a reasonable price (PEG ratio < 1 ideal). Categorize the stock (slow grower / stalwart / fast grower / cyclical / turnaround / asset play). Emphasize understanding the business — "invest in what you know". Look for ten-baggers but explain the risks plainly.' },
  { id: 'munger',   label: 'Charlie Munger',  bio: 'Mental models · invert · multidisciplinary thinking.',
    prompt: 'Reason as Charlie Munger. Apply multidisciplinary mental models (psychology, biology, physics) to investment analysis. Always invert: ask "what would make this a bad investment?" before "what makes it good?" Be brutally honest, prefer concentrated bets in great businesses, and quote Munger-isms sparingly.' },
  { id: 'klarman',  label: 'Seth Klarman',    bio: 'Margin of safety · contrarian · risk-first.',
    prompt: 'Reason as Seth Klarman. Risk first, return second. Hunt for distressed and overlooked situations. Demand a substantial margin of safety. Be patient — willing to hold cash if no opportunities meet the bar. Reference catalysts and downside scenarios explicitly.' },
  { id: 'marks',    label: 'Howard Marks',    bio: 'Cycles · second-level thinking · risk-aware.',
    prompt: 'Reason as Howard Marks. Where are we in the market cycle? Apply second-level thinking — what does the consensus believe, and why might they be wrong? Frame everything in terms of risk-adjusted return. Reference the pendulum between fear and greed.' },
  { id: 'macro',    label: 'Macro Strategist',bio: 'Top-down · rates / FX / commodities / geopolitics.',
    prompt: 'Reason as a global macro strategist (Druckenmiller / Dalio style). Start top-down: where are we in the global liquidity cycle? What are central banks doing? Currency dynamics? Commodity setup? Geopolitical risks? Then narrow down to the asset implications.' },
  { id: 'quant',    label: 'Quant',           bio: 'Factors · backtest · rules-based, not vibes.',
    prompt: 'Reason as a quantitative analyst. Frame ideas as testable factors (value, momentum, quality, low-vol, size). Cite statistical significance and backtested base rates. Be skeptical of stories without data. Recommend specific signals or screens, not narratives.' },
];

export const AIAgentPanel = ({ instrument, page, account, onClose, setPage }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]); // [{ role, content }]
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Image attachments staged for the next send. Each entry is
  // { mediaType: 'image/png'|'image/jpeg'|..., base64Data: '...' }.
  // Populated by the file picker, paste-from-clipboard handler, and
  // drag-and-drop. Cleared on send. Capped at 4 to keep the
  // request payload reasonable — anthropic supports more but the
  // wire size grows fast.
  const [pendingImages, setPendingImages] = useState([]);
  const [imageDragOver, setImageDragOver] = useState(false);
  // Selected persona — defaults to 'analyst' (neutral). Persisted
  // to localStorage so the user's choice survives sessions.
  const [personaId, setPersonaId] = useState(() => {
    try { return localStorage.getItem('imo_ai_persona') || 'analyst'; } catch { return 'analyst'; }
  });
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  const persona = AI_PERSONAS.find(p => p.id === personaId) ?? AI_PERSONAS[0];
  useEffect(() => {
    try { localStorage.setItem('imo_ai_persona', personaId); } catch {}
  }, [personaId]);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Pick up any query that was stashed by the AISearchBar before opening this
  // panel and auto-fire it. Cleared after consumption.
  useEffect(() => {
    try {
      const pending = window.__pendingAIQuery;
      if (pending) {
        window.__pendingAIQuery = null;
        // Defer to next tick so component is fully mounted
        setTimeout(() => send(pending), 0);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build per-page context. The agent gets different system context depending
  // on what the user is currently looking at — instrument details on Trade,
  // account stats on Portfolio, vault info on Vaults, etc.
  // Build a context block describing the current state. Pulls a snapshot of
  // available markets (top 12 by 24h volume) and live prediction events so
  // Claude can cite real platform data in its answers without hallucinating.
  const buildPageContext = () => {
    // Markets snapshot: top 12 instruments by volume + the active one
    const marketsList = (() => {
      const sorted = [...INSTRUMENTS].sort((a, b) => (b.vol24h ?? 0) - (a.vol24h ?? 0));
      const top = sorted.slice(0, 12);
      // Always include the active instrument if not already in the top
      const ids = new Set(top.map(i => i.id));
      if (!ids.has(instrument.id)) top.push(instrument);
      return top.map(i =>
        `${i.id} (${i.name}, ${i.cls}): ${fmt(i.mark, i.dec)} · 24h ${(i.change24h ?? 0) >= 0 ? '+' : ''}${(i.change24h ?? 0).toFixed(2)}% · vol ${fmtCompact(i.vol24h ?? 0)}`
      ).join('\n');
    })();

    // Predictions snapshot: top 8 events by volume
    const predictionsList = (() => {
      const sorted = [...PREDICTION_EVENTS].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
      return sorted.slice(0, 8).map(e =>
        `[${e.category}] ${e.question}: ${e.outcomes.map(o => `${o.name} ${o.pct}%`).join(', ')} (vol $${(e.volume / 1000).toFixed(0)}K)`
      ).join('\n');
    })();

    const baseCtx = `\n\n=== AVAILABLE MARKETS ON ONYX ===\n${marketsList}\n\n=== ACTIVE PREDICTION MARKETS ===\n${predictionsList}\n\nWhen asked about prices, use the markets list above. When asked about predictions or events, use the prediction markets list. Cite specific values from these lists rather than making up numbers.`;

    switch (page) {
      case 'trade':
        return `[User is on the Trade page viewing ${instrument.id} — ${instrument.name}. Class: ${instrument.cls}. Current approximate price: ${fmt(instrument.mark, instrument.dec)}. 24h change: ${instrument.change24h >= 0 ? '+' : ''}${instrument.change24h}%.]${baseCtx}`;
      case 'portfolio':
        return `[User is on the Portfolio page. Balance: $${(account?.balance ?? 0).toLocaleString()}. Open positions: ${account?.positions?.length ?? 0}. Open orders: ${account?.orders?.length ?? 0}. Help them analyze their portfolio composition, P&L, and exposure.]${baseCtx}`;
      case 'budget':
        return `[User is on the Budget page (envelope-style budgeting). Help them think about budgeting strategies and category planning. Do NOT provide specific financial advice.]${baseCtx}`;
      case 'taxes':
        return `[User is on the Taxes page (tax filing wizard for tax year 2026). Help them understand tax concepts and the wizard. Note: estimates only — recommend a CPA for actual filing.]${baseCtx}`;
      case 'feed':
        return `[User is on the Feed page (Twitter-style market chatter). Help them think about news interpretation.]${baseCtx}`;
      case 'watchlist':
        return `[User is on the Watchlist page. They've saved ${account?.watchlist?.length ?? 0} markets to track.]${baseCtx}`;
      case 'vaults':
        return `[User is on the Vaults page. Four vaults: OLP (Liquidity Provider, 13.2% APY), OEN (Energy Neutral, 6.8% APY), OLM (Liquidation Mule, 19.4% APY, high risk), OBF (Basis Fund, 5.4% APY).]${baseCtx}`;
      case 'referrals':
        return `[User is on the Referrals page. Help them understand the referral program tiers.]${baseCtx}`;
      case 'leaderboard':
        return `[User is on the Leaderboard page viewing top desks by volume.]${baseCtx}`;
      case 'map':
        return `[User is on the Terminal page (global flow map). Help them understand commodity flows and supply-chain visualizations.]${baseCtx}`;
      case 'predictions':
        return `[User is on the Prediction Markets page. The full active list is in the context below — help them understand specific events.]${baseCtx}`;
      case 'discuss':
        return `[User is on the Discussion page (community forum). Help with topic discussions but do not recommend trades.]${baseCtx}`;
      case 'docs':
        return `[User is on the Docs page. Help with Onyx platform technical documentation — Kadena chains, BFT consensus, Pact contracts, settlement model.]${baseCtx}`;
      default:
        return `[User is on the ${page} page.]${baseCtx}`;
    }
  };

  const pageGreeting = {
    trade: `Looking at ${instrument.id}? Ask me about market structure, fundamentals, or how to read the chart.`,
    portfolio: `I can help you analyze your positions, exposure, and P&L. What do you want to look at?`,
    watchlist: `Need help building a watchlist? Ask me what to consider for a sector, theme, or strategy.`,
    vaults: `I can explain the four vault strategies and help you think about which fits your risk tolerance.`,
    referrals: `Ask me how the referral program works or how to maximize your tier.`,
    leaderboard: `Curious about who's trading what? Ask me about market structure on Onyx.`,
    map: `The Terminal map shows global trade flows. Ask me about commodity routing, supply chain disruptions, or geographic concentrations.`,
    predictions: `Prediction markets aggregate beliefs about real-world outcomes. Ask me how they work or what to watch.`,
    discuss: `Want to discuss what's on the forum? I can help you think through topics without recommending trades.`,
    docs: `Ask me about Kadena chains, Pact contracts, BFT settlement, or any other Onyx technical detail.`,
  };

  // Helper — read a File/Blob as base64. Returns null on failure.
  // Filters by MIME type to avoid uploading random binaries.
  const fileToImageAttachment = async (file) => {
    if (!file) return null;
    const mediaType = file.type;
    // Anthropic supports image/jpeg, image/png, image/gif, image/webp.
    const SUPPORTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!SUPPORTED.includes(mediaType)) return null;
    // Cap at 5MB so we don't ship massive screenshots that bloat
    // the API request — Anthropic's hard limit is around 5MB
    // per image too.
    if (file.size > 5 * 1024 * 1024) return null;
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        // FileReader.readAsDataURL gives "data:image/png;base64,xxxx"
        // We want just the xxxx part.
        const dataUrl = String(reader.result ?? '');
        const idx = dataUrl.indexOf(',');
        const base64Data = idx >= 0 ? dataUrl.slice(idx + 1) : '';
        resolve(base64Data ? { mediaType, base64Data } : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  };
  // Handle one or more files from any source (picker, paste, drop).
  const ingestFiles = async (fileList) => {
    if (!fileList) return;
    const arr = Array.from(fileList);
    const slots = Math.max(0, 4 - pendingImages.length);
    if (slots === 0) {
      setError('Up to 4 images per message');
      setTimeout(() => setError(null), 2500);
      return;
    }
    const accepted = [];
    for (const f of arr.slice(0, slots)) {
      const att = await fileToImageAttachment(f);
      if (att) accepted.push(att);
    }
    if (accepted.length === 0) {
      setError('Only PNG, JPEG, GIF, or WEBP images up to 5MB');
      setTimeout(() => setError(null), 2500);
      return;
    }
    setPendingImages(prev => [...prev, ...accepted].slice(0, 4));
  };

  const send = async (userMsg, attachments = pendingImages) => {
    const trimmed = (userMsg ?? '').trim();
    // Allow image-only sends (no text) as long as at least one
    // image is attached. Otherwise require text.
    if (!trimmed && (!attachments || attachments.length === 0)) return;
    if (loading) return;
    const newUserMsg = {
      role: 'user',
      content: trimmed,
      images: (attachments && attachments.length > 0) ? attachments : undefined,
    };
    const conversation = [...messages, newUserMsg];
    setMessages(conversation);
    setInput('');
    setPendingImages([]);
    setLoading(true);
    setError(null);

    const ctx = buildPageContext();

    try {
      // Check what providers are available. Anthropic direct gives us
      // tool calls (web_search, navigate_to_page, search_calendar_events)
      // so we prefer it. If Anthropic isn't configured but the user has
      // chosen a different provider in Settings, fall through to callAI
      // which routes via the active provider — we lose tool calls but
      // basic chat still works.
      const anthropicKey = resolveLlmKey('anthropic');
      const altActive = resolveActiveProvider();
      const hasAltProvider = altActive && altActive.provider.id !== 'anthropic';
      if (!anthropicKey && !hasAltProvider) {
        // No working LLM at all → canned response
        await new Promise(r => setTimeout(r, 600));
        if (newUserMsg.images && newUserMsg.images.length > 0) {
          setMessages([...conversation, {
            role: 'assistant',
            content: 'I can see you attached an image, but image analysis requires a configured AI provider. Open Settings → AI provider to add a key for Anthropic Claude, OpenAI, Gemini, or Ollama (local). Once configured, I\'ll be able to analyze your screenshot.',
          }]);
          setLoading(false);
          return;
        }
        const canned = cannedAIResponse(instrument, userMsg);
        setMessages([...conversation, { role: 'assistant', content: canned }]);
        setLoading(false);
        return;
      }
      // Non-Anthropic provider path — use callAI for basic chat. We
      // lose web_search and navigate_to_page tools but the user's
      // chosen model still answers questions and analyzes images.
      if (!anthropicKey && hasAltProvider) {
        // Build a single prompt from the conversation. callAI accepts
        // a string prompt; for multi-turn we synthesize a transcript-
        // style prompt so the chosen model sees prior context.
        const transcript = conversation
          .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n\n');
        const lastImages = newUserMsg.images;
        const systemPrompt = AI_SYSTEM_PROMPT
          + (persona.prompt ? '\n\n--- ACTIVE PERSONA ---\n' + persona.prompt : '')
          + '\n\n' + ctx;
        const reply = await callAI(transcript, {
          system: systemPrompt,
          maxTokens: 800,
          images: lastImages,
        });
        setMessages([...conversation, {
          role: 'assistant',
          content: reply || `I couldn't get a response from ${altActive.provider.label}. The provider may be down or the key may be invalid. Try the Test button in Settings → AI provider.`,
        }]);
        setLoading(false);
        return;
      }

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          system: AI_SYSTEM_PROMPT + (persona.prompt ? '\n\n--- ACTIVE PERSONA ---\n' + persona.prompt : '') + '\n\n' + ctx,
          // Web search tool — lets Claude fetch documents and breaking news
          // when the user requests something that isn't in the injected context.
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
              max_uses: 3,
            },
            // Custom navigation tool — Claude can call this to take the user
            // to a different page in the terminal.
            {
              name: 'navigate_to_page',
              description: 'Navigate the user to a specific page in the IMO Onyx Terminal. Available pages: trade, portfolio, budget, feed, watchlist, vaults, referrals, leaderboard, map (Terminal), predictions, discuss, docs, taxes (Vault), messages.',
              input_schema: {
                type: 'object',
                properties: {
                  page: {
                    type: 'string',
                    enum: ['trade', 'portfolio', 'budget', 'build', 'learn', 'feed', 'watchlist', 'vaults', 'staking', 'referrals', 'leaderboard', 'map', 'predictions', 'discuss', 'docs', 'taxes', 'messages'],
                    description: 'The page id to navigate to.',
                  },
                  reason: {
                    type: 'string',
                    description: 'A brief explanation to show the user about why we are navigating.',
                  },
                },
                required: ['page'],
              },
            },
            // Calendar event search — Claude can find market-relevant events
            // (earnings, FOMC, economic data releases, etc.) and propose them
            // for the user to add to their portfolio calendar.
            {
              name: 'search_calendar_events',
              description: 'Search for market-relevant calendar events (earnings releases, FOMC meetings, CPI/PCE prints, options expiry, IPO dates, dividend dates). Returns a list of upcoming events that match the query. The user can then choose to add them to their calendar.',
              input_schema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'Search query — e.g. "NVDA earnings Q1 2026", "next FOMC meeting", "tech earnings this week", "Fed policy events", "dividend ex-dates for AAPL"',
                  },
                  category: {
                    type: 'string',
                    enum: ['earnings', 'fomc', 'economic', 'opex', 'ipo', 'dividend', 'all'],
                    description: 'Type of event to filter by, or "all" for any category.',
                  },
                },
                required: ['query'],
              },
            },
          ],
          messages: conversation.map(m => {
            // If the user message has images attached, build a
            // multimodal content array per the Anthropic API:
            // image blocks first (so the model "sees" before
            // reading the prompt), then a text block for the prompt
            // itself. Assistant turns and image-less user turns
            // pass through unchanged.
            if (m.role === 'user' && Array.isArray(m.images) && m.images.length > 0) {
              return {
                role: 'user',
                content: [
                  ...m.images.map(img => ({
                    type: 'image',
                    source: {
                      type:        'base64',
                      media_type:  img.mediaType,
                      data:        img.base64Data,
                    },
                  })),
                  { type: 'text', text: m.content || 'Please analyze the attached image.' },
                ],
              };
            }
            return { role: m.role, content: m.content };
          }),
        }),
      });

      if (!r.ok) {
        const errBody = await r.text().catch(() => '');
        throw new Error(`HTTP ${r.status}${errBody ? ': ' + errBody.slice(0, 200) : ''}`);
      }
      const body = await r.json();
      // Response may contain text + tool_use blocks. Look for navigate_to_page.
      const navCall = (body?.content ?? []).find(b => b.type === 'tool_use' && b.name === 'navigate_to_page');
      if (navCall && setPage && navCall.input?.page) {
        // Trigger navigation
        setPage(navCall.input.page);
      }
      // Handle calendar event search — Claude returns proposed events the
      // user can add to their portfolio calendar. The actual event lookup
      // here uses an in-memory dataset of upcoming market events; in a
      // production version this would hit a real economic-calendar API.
      const calCall = (body?.content ?? []).find(b => b.type === 'tool_use' && b.name === 'search_calendar_events');
      let calProposal = null;
      if (calCall && calCall.input?.query) {
        const q = calCall.input.query.toLowerCase();
        const cat = calCall.input.category ?? 'all';
        const matches = (typeof FINANCIAL_EVENTS !== 'undefined' ? FINANCIAL_EVENTS : []).filter(e => {
          if (cat !== 'all' && e.type !== cat) return false;
          const hay = `${e.title ?? ''} ${e.description ?? ''} ${e.ticker ?? ''}`.toLowerCase();
          return q.split(/\s+/).some(t => hay.includes(t));
        }).slice(0, 8);
        calProposal = { query: calCall.input.query, matches, category: cat };
      }
      const textBlocks = (body?.content ?? [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .filter(Boolean);
      let reply = textBlocks.length > 0 ? textBlocks.join('\n\n') : '';
      if (navCall && navCall.input?.reason) {
        reply = (reply ? reply + '\n\n' : '') + `🧭 Navigating to ${navCall.input.page} — ${navCall.input.reason}`;
      } else if (navCall) {
        reply = (reply ? reply + '\n\n' : '') + `🧭 Took you to ${navCall.input.page}.`;
      }
      if (calProposal) {
        if (calProposal.matches.length === 0) {
          reply = (reply ? reply + '\n\n' : '') + `📅 I searched for "${calProposal.query}" but didn't find any matching events in the upcoming calendar window.`;
        } else {
          const lines = calProposal.matches.map(e =>
            `• ${e.date ?? '?'} — ${e.title}${e.ticker ? ' (' + e.ticker + ')' : ''}`
          ).join('\n');
          reply = (reply ? reply + '\n\n' : '') +
            `📅 Found ${calProposal.matches.length} event${calProposal.matches.length === 1 ? '' : 's'} matching "${calProposal.query}":\n${lines}\n\nYou can add these to your portfolio calendar from the Calendar tab.`;
        }
      }
      if (!reply) reply = '(empty response)';
      setMessages([...conversation, { role: 'assistant', content: reply }]);
    } catch (err) {
      console.warn('[AI]', err.message);
      setError(err.message);
      setMessages([...conversation, {
        role: 'assistant',
        content: cannedAIResponse(instrument, userMsg),
      }]);
    } finally {
      setLoading(false);
    }
  };

  // Page-aware quick prompts. Each page suggests questions relevant to
  // what's in front of the user.
  const quickPrompts = (() => {
    switch (page) {
      case 'trade':
        return [
          `Summarize ${instrument.id}`,
          `What is ${instrument.name}?`,
          `Explain the current market stats`,
        ];
      case 'portfolio':
        return [
          'How is my portfolio diversified?',
          'What is my biggest risk exposure?',
          'Explain margin and leverage usage',
        ];
      case 'watchlist':
        return [
          'What sectors should I be watching?',
          'Build a tech watchlist',
          'Explain what to track for an earnings play',
        ];
      case 'vaults':
        return [
          'Compare the four vault strategies',
          'Which vault has the best risk/reward?',
          'Explain how vault yield is generated',
        ];
      case 'referrals':
        return [
          'How does the tier system work?',
          'How is the 50bps rebate paid out?',
          'Tips to grow my referral network',
        ];
      case 'leaderboard':
        return [
          'Who are the top desks on Onyx?',
          'Explain how rankings are calculated',
          'What makes a successful desk?',
        ];
      case 'map':
        return [
          'Explain global oil supply chains',
          'What disrupts shipping routes?',
          'How do I read commodity flows?',
        ];
      case 'predictions':
        return [
          'How do prediction markets price probability?',
          'Compare Kalshi vs Polymarket',
          'What macro events have liquid markets?',
        ];
      case 'discuss':
        return [
          'What are people debating today?',
          'Summarize a popular thread',
          'Help me draft a thoughtful post',
        ];
      case 'docs':
        return [
          'Explain Kadena chainweb in 3 sentences',
          'What is BFT finality?',
          'How does Pact differ from Solidity?',
        ];
      default:
        return [
          'What can I do on this page?',
          'Show me what is most important here',
        ];
    }
  })();

  // Draggable + resizable panel position/size (persisted)
  const [panelGeom, setPanelGeom] = useState(() => {
    try {
      const raw = localStorage.getItem('imo_ai_panel_geom');
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      x: typeof window !== 'undefined' ? Math.max(20, window.innerWidth - 500) : 20,
      y: 80,
      w: 460,
      h: 600,
    };
  });
  const persistGeom = (next) => {
    setPanelGeom(next);
    try { localStorage.setItem('imo_ai_panel_geom', JSON.stringify(next)); } catch {}
  };
  const dragRef = useRef(null);
  const startDrag = (e) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const startGeom = { ...panelGeom };
    const move = (ev) => {
      persistGeom({
        ...startGeom,
        x: Math.max(0, Math.min(window.innerWidth - 200, startGeom.x + ev.clientX - startX)),
        y: Math.max(0, Math.min(window.innerHeight - 100, startGeom.y + ev.clientY - startY)),
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startGeom = { ...panelGeom };
    const move = (ev) => {
      persistGeom({
        ...startGeom,
        w: Math.max(320, Math.min(900, startGeom.w + ev.clientX - startX)),
        h: Math.max(280, Math.min(window.innerHeight - 60, startGeom.h + ev.clientY - startY)),
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <>
      <div
        ref={dragRef}
        className="fixed z-50 flex flex-col rounded-md border overflow-hidden shadow-2xl"
        style={{
          left: panelGeom.x,
          top: panelGeom.y,
          width: panelGeom.w,
          height: panelGeom.h,
          background: COLORS.surface,
          borderColor: COLORS.borderHi,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header — draggable */}
        <div className="flex items-center justify-between p-4 border-b shrink-0 cursor-move select-none"
             onMouseDown={startDrag}
             style={{ borderColor: COLORS.border }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md flex items-center justify-center"
                 style={{ background: 'rgba(61,123,255,0.1)' }}>
              <Sparkles size={16} style={{ color: COLORS.mint }} />
            </div>
            <div className="leading-tight">
              <div className="text-[14px] font-medium" style={{ color: COLORS.text }}>
                Onyx Research
              </div>
              <div className="text-[10px]" style={{ color: COLORS.textMute }}>
                Factual summaries only · No trade recommendations
              </div>
            </div>
          </div>
          {/* Persona pill — opens a popover where the user can pick
              a named-investor agent style. The choice persists and
              prepends a persona-specific system prompt fragment. */}
          <div className="flex items-center gap-2 ml-auto">
            <div className="relative">
              <button onClick={() => setPersonaPickerOpen(s => !s)}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors hover:bg-white/[0.05]"
                      style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text }}
                      title={`Active persona: ${persona.label}`}>
                {(() => {
                  const Ico = PERSONA_ICONS[persona.id] ?? Diamond;
                  return <Ico size={11} style={{ color: COLORS.mint }} />;
                })()}
                <span>{persona.label}</span>
                <ChevronDown size={10} style={{ color: COLORS.textMute }} />
              </button>
              {personaPickerOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setPersonaPickerOpen(false)} />
                  <div className="absolute top-full right-0 mt-1 z-40 rounded-md border overflow-hidden"
                       style={{ width: 280, background: COLORS.surface, borderColor: COLORS.borderHi, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                    <div className="px-3 py-1.5 text-[9.5px] uppercase tracking-wider border-b"
                         style={{ color: COLORS.textMute, borderColor: COLORS.border }}>
                      AI Persona
                    </div>
                    {AI_PERSONAS.map(p => {
                      const Ico = PERSONA_ICONS[p.id] ?? Diamond;
                      return (
                      <button key={p.id}
                              onClick={() => { setPersonaId(p.id); setPersonaPickerOpen(false); }}
                              className="w-full text-left px-3 py-2 hover:bg-white/[0.04] flex items-start gap-2 transition-colors"
                              style={{ background: p.id === personaId ? `${COLORS.mint}10` : 'transparent' }}>
                        <Ico size={14} className="mt-0.5"
                             style={{ color: p.id === personaId ? COLORS.mint : COLORS.textDim }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium"
                               style={{ color: p.id === personaId ? COLORS.mint : COLORS.text }}>{p.label}</div>
                          <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textMute }}>{p.bio}</div>
                        </div>
                      </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-white/[0.05]"
            >
              <X size={16} style={{ color: COLORS.textDim }} />
            </button>
          </div>
        </div>

        {/* Current instrument context */}
        <div className="px-4 py-2.5 border-b shrink-0" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
          <div className="flex items-center gap-2">
            <InstIcon cls={instrument.cls} size={13} ticker={instrument.id} />
            <span className="text-[12px]" style={{ color: COLORS.textDim }}>Discussing </span>
            <span className="text-[12px] font-medium" style={{ color: COLORS.text }}>{instrument.id}</span>
            <span className="text-[11px] tabular-nums ml-auto" style={{ color: COLORS.textMute }}>
              {fmt(instrument.mark, instrument.dec)}
            </span>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !loading && (
            <div className="py-6">
              <div className="text-[12px] mb-3" style={{ color: COLORS.textMute }}>
                {pageGreeting[page] ?? `Ask me anything about ${instrument.id} — or any concept you want explained.`}
              </div>
              <div className="space-y-1.5">
                {quickPrompts.map(p => (
                  <button
                    key={p}
                    onClick={() => send(p)}
                    className="w-full text-left px-3 py-2 rounded-md text-[12px] border transition-colors hover:bg-white/[0.03]"
                    style={{ borderColor: COLORS.border, color: COLORS.textDim }}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {!ANTHROPIC_API_KEY && (
                <div className="mt-4 px-3 py-2 rounded-md text-[11px]"
                     style={{ background: 'rgba(245,176,65,0.08)', color: '#F5B041' }}>
                  No VITE_ANTHROPIC_API_KEY configured — using canned responses. Add key to Vercel env vars for real AI responses.
                </div>
              )}
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className="max-w-[85%] px-3.5 py-2.5 rounded-md relative group"
                style={{
                  background: m.role === 'user' ? 'rgba(61,123,255,0.1)' : COLORS.bg,
                  color: m.role === 'user' ? COLORS.mint : COLORS.text,
                  border: m.role === 'assistant' ? `1px solid ${COLORS.border}` : 'none',
                }}
              >
                {/* Image attachments — rendered above the text inside
                    the user's chat bubble. Up to 4 thumbnails wrap in
                    a small grid; each opens to full size in a new tab
                    on click. Only user messages can carry images for
                    now (assistant turns are text-only). */}
                {m.role === 'user' && Array.isArray(m.images) && m.images.length > 0 && (
                  <div className={`grid gap-1.5 mb-2 ${m.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    {m.images.map((img, j) => (
                      <a key={j} href={`data:${img.mediaType};base64,${img.base64Data}`}
                         target="_blank" rel="noopener noreferrer"
                         className="block rounded overflow-hidden"
                         style={{ border: `1px solid ${COLORS.border}` }}
                         title="Click to open full size">
                        <img src={`data:${img.mediaType};base64,${img.base64Data}`}
                             alt="Attached"
                             className="block w-full h-auto"
                             style={{ maxHeight: 220, objectFit: 'cover' }} />
                      </a>
                    ))}
                  </div>
                )}
                {m.role === 'assistant'
                  ? <AIMarkdown size="md">{m.content}</AIMarkdown>
                  : (m.content && <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{m.content}</div>)}
                {/* TTS speak button — appears on hover for assistant
                    messages. Uses the browser's Web Speech Synthesis
                    API (window.speechSynthesis) which is supported in
                    every modern desktop browser without API key.
                    Click to speak, click again to stop. */}
                {m.role === 'assistant' && m.content && typeof window !== 'undefined' && window.speechSynthesis && (
                  <button
                    onClick={() => {
                      const synth = window.speechSynthesis;
                      if (synth.speaking) { synth.cancel(); return; }
                      // Strip markdown for cleaner speech
                      const clean = String(m.content)
                        .replace(/```[\s\S]*?```/g, ' code block. ')
                        .replace(/`([^`]+)`/g, '$1')
                        .replace(/\*\*([^*]+)\*\*/g, '$1')
                        .replace(/[*_~#>]/g, '')
                        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                        .replace(/\s+/g, ' ')
                        .trim();
                      const utter = new SpeechSynthesisUtterance(clean);
                      utter.rate = 1.05;
                      utter.pitch = 1.0;
                      synth.speak(utter);
                    }}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    style={{
                      background: COLORS.surface,
                      border: `1px solid ${COLORS.border}`,
                      color: COLORS.mint,
                    }}
                    title="Speak this response (click again to stop)"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="px-3.5 py-2.5 rounded-md border text-[13px]"
                   style={{ background: COLORS.bg, borderColor: COLORS.border, color: COLORS.textMute }}>
                <span className="inline-flex gap-1">
                  <span className="live-dot">●</span>
                  <span className="live-dot" style={{ animationDelay: '0.15s' }}>●</span>
                  <span className="live-dot" style={{ animationDelay: '0.3s' }}>●</span>
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-md text-[11px]"
                 style={{ background: 'rgba(237,112,136,0.08)', color: COLORS.red }}>
              {error}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-3 border-t shrink-0"
             style={{
               borderColor: COLORS.border,
               // Highlight the entire input area when the user
               // drags an image over it so it's obvious where to drop.
               background: imageDragOver ? `${COLORS.mint}11` : 'transparent',
               outline: imageDragOver ? `2px dashed ${COLORS.mint}` : 'none',
               outlineOffset: -2,
             }}
             onDragOver={(e) => {
               // Only react if the drag carries files. Without this
               // check we'd flash the highlight on text drags too.
               if (e.dataTransfer?.types?.includes('Files')) {
                 e.preventDefault();
                 setImageDragOver(true);
               }
             }}
             onDragLeave={() => setImageDragOver(false)}
             onDrop={(e) => {
               e.preventDefault();
               setImageDragOver(false);
               if (e.dataTransfer?.files?.length > 0) {
                 ingestFiles(e.dataTransfer.files);
               }
             }}>
          {/* Pending image previews — shown above the input when the
              user has staged attachments. Each has an X to remove
              individually. Sent on the next message and cleared. */}
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {pendingImages.map((img, idx) => (
                <div key={idx} className="relative rounded overflow-hidden"
                     style={{ border: `1px solid ${COLORS.border}` }}>
                  <img src={`data:${img.mediaType};base64,${img.base64Data}`}
                       alt="Attached"
                       style={{ width: 56, height: 56, objectFit: 'cover', display: 'block' }} />
                  <button type="button"
                          onClick={() => setPendingImages(p => p.filter((_, i) => i !== idx))}
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[10px]"
                          style={{ background: 'rgba(0,0,0,0.7)', color: '#FFF' }}
                          title="Remove">×</button>
                </div>
              ))}
              <div className="text-[10px] flex items-center px-1"
                   style={{ color: COLORS.textMute }}>
                {pendingImages.length}/4
              </div>
            </div>
          )}
          <div className="flex gap-2 items-center">
            {/* Hidden file input — clicked via the paperclip button */}
            <input id="ai-image-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp"
                   multiple
                   className="hidden"
                   onChange={async (e) => {
                     await ingestFiles(e.target.files);
                     // Reset so picking the same file twice in a row works
                     e.target.value = '';
                   }} />
            <button type="button"
                    onClick={() => document.getElementById('ai-image-input')?.click()}
                    disabled={pendingImages.length >= 4 || loading}
                    className="px-2 py-2 rounded-md text-[12px] transition-colors disabled:opacity-30"
                    style={{ background: COLORS.bg, color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}
                    title="Attach an image — drag here or paste from clipboard too">
              <ImageIcon size={13} />
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
              onPaste={async (e) => {
                // Pull any images out of the clipboard. If the user
                // pasted a screenshot (Cmd+Shift+4 → Cmd+V on macOS,
                // Win+Shift+S → Ctrl+V on Windows), the items array
                // will carry an image/png Blob.
                const items = Array.from(e.clipboardData?.items ?? []);
                const files = items
                  .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
                  .map(i => i.getAsFile())
                  .filter(Boolean);
                if (files.length > 0) {
                  e.preventDefault();
                  await ingestFiles(files);
                }
                // If no images, fall through and let the browser
                // handle the paste as text into the input normally.
              }}
              placeholder={pendingImages.length > 0
                ? `Describe what you'd like analyzed (or send blank for default)`
                : `Ask about this instrument · paste a chart screenshot`}
              className="flex-1 px-3 py-2 rounded-md text-[13px] outline-none"
              style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
            />
            <button
              onClick={() => send(input)}
              disabled={(!input.trim() && pendingImages.length === 0) || loading}
              className="px-3 py-2 rounded-md text-[12px] transition-colors disabled:opacity-40"
              style={{ background: COLORS.mint, color: COLORS.bg }}
            >
              <Send size={13} />
            </button>
          </div>
          <div className="text-[9px] mt-2" style={{ color: COLORS.textMute }}>
            Onyx Research provides factual summaries only. Vision: paste
            or drop a chart screenshot to ask about pattern, levels, or
            structure. Claude vision requires VITE_ANTHROPIC_API_KEY.
          </div>
        </div>

        {/* Resize handle - bottom-right corner */}
        <div onMouseDown={startResize}
             className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
             style={{
               background: `linear-gradient(135deg, transparent 50%, ${COLORS.borderHi} 50%, ${COLORS.borderHi} 60%, transparent 60%, transparent 70%, ${COLORS.borderHi} 70%, ${COLORS.borderHi} 80%, transparent 80%)`,
             }}
             title="Drag to resize" />
      </div>
    </>
  );
};
