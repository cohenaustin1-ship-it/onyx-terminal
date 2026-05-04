// IMO Onyx Terminal — AI call helpers
//
// Phase 3p.18 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~996-1405).
//
// The actual function bodies that talk to LLM providers + Exa for
// grounded search. Pairs with src/lib/llm-providers.js — that module
// has the provider config objects; this module has the call layer.
//
// Public exports:
//   callAnthropic    — direct Anthropic call (Haiku 4.5 default)
//   callAI           — provider-agnostic call routed via the active
//                      provider from llm-providers.js
//   exaSearch        — Exa neural search
//   exaGetContents   — fetch full content for Exa search results
//   exaGroundedAI    — Exa-grounded LLM call: search, fetch, prompt
//                      with citations
//   callOpenAI       — direct OpenAI call (gpt-4o-mini default)
//
// Honest scope:
//   - Direct browser calls — Anthropic supports
//     dangerously_allow_browser, but a production deployment should
//     route through a server-side proxy that holds the keys. The
//     direct path here is for the dev build and the user-keyed
//     "Bring Your Own Key" path where the user pastes a key into
//     settings.

import { cacheGet, cacheSet } from './api-cache.js';
import { resolveLlmKey, resolveActiveProvider, LLM_PROVIDERS } from './llm-providers.js';

// Env-var keys (duplicated from monolith — same source, separate read).
const ANTHROPIC_API_KEY = (() => { try { return import.meta.env?.VITE_ANTHROPIC_API_KEY ?? ''; } catch { return ''; } })();
const OPENAI_API_KEY    = (() => { try { return import.meta.env?.VITE_OPENAI_API_KEY    ?? ''; } catch { return ''; } })();
const EXA_API_KEY       = (() => { try { return import.meta.env?.VITE_EXA_API_KEY       ?? ''; } catch { return ''; } })();

export const callAnthropic = async (prompt, {
  model = 'claude-haiku-4-5-20251001',
  maxTokens = 800,
  system = null,
  images = null,         // array of { mediaType, base64Data } for multimodal
} = {}) => {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    // If images are attached, build a multimodal user message —
    // image blocks first (so the model "sees" them before reading
    // the prompt), then a single text block for the prompt itself.
    // Otherwise fall back to the simpler string-content shape that
    // works for text-only requests.
    const userContent = (Array.isArray(images) && images.length > 0)
      ? [
          ...images.map(img => ({
            type: 'image',
            source: {
              type:        'base64',
              media_type:  img.mediaType,
              data:        img.base64Data,
            },
          })),
          { type: 'text', text: prompt },
        ]
      : prompt;
    const body = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userContent }],
    };
    if (system) body.system = system;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        // Required when calling from the browser. Without it the API
        // rejects the request with a CORS-related 401.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    // The content array contains text blocks. Concatenate any text fields.
    const txt = (j?.content ?? [])
      .filter(b => b?.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('\n')
      .trim();
    return txt || null;
  } catch (e) {
    console.warn('[Anthropic]', e.message);
    return null;
  }
};

// Unified AI text helper. Tries the ZeroClaw agent gateway first (if
// configured), then Anthropic direct, then OpenAI. The gateway path gives
// you persistent memory + tool calling + provider fallback chain. Direct
// Anthropic is the fallback when the gateway is unconfigured. Returns null
// if every option fails.
export const callAI = async (prompt, opts = {}) => {
  // Multi-provider routing: when the user has explicitly chosen a
  // provider in Settings, route there first. Otherwise fall back
  // through the legacy gateway → Anthropic → OpenAI chain.
  //
  // Vision: if images are attached, only providers/models that
  // support vision are eligible. We try the active model first,
  // then walk back through the registry looking for any vision-
  // capable provider with a configured key.
  const hasImages = Array.isArray(opts.images) && opts.images.length > 0;
  const active = resolveActiveProvider();
  // Try active provider first if it exists and (when image present)
  // its currently-selected model supports vision.
  if (active) {
    const supportsVision = active.model?.vision === true;
    if (!hasImages || supportsVision) {
      const messages = [{ role: 'user', content: prompt, images: hasImages ? opts.images : undefined }];
      const r = await active.provider.callChat(messages, {
        model: active.model.id,
        maxTokens: opts.maxTokens || 800,
        system: opts.system || null,
        images: hasImages ? opts.images : null,
      });
      if (r) return r;
    }
    // If we have images but the active model lacks vision, fall
    // through to the multimodal-only path below rather than
    // silently sending text-only.
  }
  // Multimodal vision path — when caller attached images, prefer
  // any vision-capable provider with a key. Walks the registry.
  if (hasImages) {
    for (const p of LLM_PROVIDERS) {
      const visionModel = p.models.find(m => m.vision);
      if (!visionModel) continue;
      const hasKey = !!resolveLlmKey(p.id) || p.id === 'ollama';
      if (!hasKey) continue;
      const messages = [{ role: 'user', content: prompt, images: opts.images }];
      const r = await p.callChat(messages, {
        model: visionModel.id,
        maxTokens: opts.maxTokens || 800,
        system: opts.system || null,
        images: opts.images,
      });
      if (r) return r;
    }
    // No vision path available — return null so the caller can
    // surface a helpful error rather than silently sending text-only.
    return null;
  }
  // Non-vision: try the agent gateway first (back-compat with
  // existing zeroclaw integration). The gateway path provides
  // persistent memory + tool calling + provider fallback chain.
  try {
    const be = (typeof window !== 'undefined') ? window.__imoBackend : null;
    if (be?.urls?.zeroclaw && be?.status?.zeroclaw === 'connected') {
      const r = await be.post('zeroclaw', '/agent/chat', {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: opts.maxTokens || 800,
        system: opts.system || null,
        user_id: opts.userId || undefined,
        use_tools: !!opts.useTools,
      }, { timeout: 60000 });
      if (r?.content) return r.content;
    }
  } catch (e) {
    console.warn('[gateway]', e.message);
  }
  // Last-resort fallback chain — Anthropic direct, then OpenAI.
  if (resolveLlmKey('anthropic')) {
    const r = await callAnthropic(prompt, opts);
    if (r) return r;
  }
  return callOpenAI(prompt, opts);
};

// ──────── Exa: live web search ────────
// Exa's neural search returns ranked URLs with optional content. Used for:
//   - Live news feed (FeedPage and NewsTab)
//   - Company research enrichment in Terminal full reports
//   - Stock-specific scrape-and-summarize for AI tool use
// Returns { results: [{title, url, publishedDate, text, highlights}] } or null
// on failure (graceful degradation — UI shows fallback content).
export const exaSearch = async (query, {
  numResults = 10,
  type = 'auto',           // auto | fast | instant | deep | deep-lite | deep-reasoning
  highlights = true,        // include highlights for token efficiency
  maxAgeHours = 24,         // 0 = always livecrawl, -1 = cache only
  includeDomains = null,    // optional array of domains to restrict to
  excludeDomains = null,    // optional array of domains to filter out
} = {}) => {
  // Note: we no longer require EXA_API_KEY here — the proxy / agent path
  // doesn't need a client-side key. The direct fallback at the end re-checks.
  if (!query) return null;
  // Cache short-lived to avoid hammering on rapid re-renders. Key is the
  // full query + options hash so different searches don't collide.
  const cacheKey = `exa:${query}:${numResults}:${type}:${maxAgeHours}:${(includeDomains||[]).join(',')}`;
  const cached = cacheGet(cacheKey, 5 * 60_000); // 5 min TTL
  if (cached) return cached;

  // Three transport options, in order:
  //   1. Agent gateway (best — has the key server-side, can also chain
  //      with tool calls). Used when /agent/tool is reachable AND has Exa.
  //   2. Vercel serverless proxy (/api/exa-search). Works in production
  //      without any backend services. EXA_API_KEY lives only on Vercel.
  //   3. Direct browser → api.exa.ai. Will CORS-fail in production but
  //      works in localhost dev where Vite proxies the request.
  const body = {
    query,
    numResults,
    type,
    contents: highlights
      ? { highlights: { maxCharacters: 600 } }
      : { text: { maxCharacters: 1500 } },
  };
  if (maxAgeHours !== undefined && maxAgeHours !== null) {
    body.contents.maxAgeHours = maxAgeHours;
  }
  if (includeDomains) body.includeDomains = includeDomains;
  if (excludeDomains) body.excludeDomains = excludeDomains;

  // Try agent gateway first (Option B from the README)
  try {
    const be = (typeof window !== 'undefined') ? window.__imoBackend : null;
    if (be?.urls?.zeroclaw && be?.status?.zeroclaw === 'connected') {
      const r = await be.post('zeroclaw', '/agent/tool', {
        name: 'exa_search',
        input: body,
      }, { timeout: 15000 });
      if (r && !r.error && r.results) {
        const result = {
          results: (r.results ?? []).map(item => ({
            title: item.title ?? '',
            url: item.url ?? '',
            publishedDate: item.publishedDate ?? null,
            author: item.author ?? null,
            text: item.highlights?.join(' … ') ?? item.text ?? '',
            score: item.score ?? null,
            favicon: item.favicon ?? null,
            image: item.image ?? null,
          })),
        };
        cacheSet(cacheKey, result);
        return result;
      }
    }
  } catch (e) {
    // fall through to proxy / direct
  }

  // Try Vercel serverless proxy next — works in production without any
  // backend service running. The proxy adds the API key from env.
  try {
    const r = await fetch('/api/exa-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const j = await r.json();
      const result = {
        results: (j?.results ?? []).map(item => ({
          title: item.title ?? '',
          url: item.url ?? '',
          publishedDate: item.publishedDate ?? null,
          author: item.author ?? null,
          text: item.highlights?.join(' … ') ?? item.text ?? '',
          score: item.score ?? null,
          favicon: item.favicon ?? null,
          image: item.image ?? null,
        })),
      };
      cacheSet(cacheKey, result);
      return result;
    }
    // Proxy returned an error — only fall through to direct if it's a 503
    // (proxy unconfigured), not a 4xx (real Exa error)
    if (r.status !== 503 && r.status !== 404) {
      console.warn('[Exa proxy]', r.status);
      return null;
    }
  } catch {
    // Proxy unreachable (e.g., running on localhost without serverless) —
    // try direct call. In production this will CORS-fail but that's expected.
  }

  // Last resort — direct browser call. Works only in localhost dev.
  if (!EXA_API_KEY) return null;
  try {
    const r = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EXA_API_KEY,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.warn('[Exa]', r.status, r.statusText);
      return null;
    }
    const j = await r.json();
    const result = {
      results: (j?.results ?? []).map(item => ({
        title: item.title ?? '',
        url: item.url ?? '',
        publishedDate: item.publishedDate ?? null,
        author: item.author ?? null,
        // Concatenate highlights into a single excerpt for display
        text: item.highlights?.join(' … ') ?? item.text ?? '',
        score: item.score ?? null,
        favicon: item.favicon ?? null,
        image: item.image ?? null,
      })),
    };
    cacheSet(cacheKey, result);
    return result;
  } catch (e) {
    console.warn('[Exa]', e.message);
    return null;
  }
};

// Exa /contents — fetch parsed content for known URLs. Used when we already
// have URLs and need the text (e.g. user clicks "Summarize" on a feed item).
// Same transport-priority chain as exaSearch: agent → proxy → direct.
// Note: Exa's /contents takes URL ids (which are the URLs themselves for
// public web pages). We pass them as `ids` to the proxy, matching Exa's API.
export const exaGetContents = async (urls, { highlights = true, maxAgeHours = 24 } = {}) => {
  if (!urls?.length) return null;
  const body = {
    ids: urls,
    contents: highlights
      ? { highlights: { maxCharacters: 1200 } }
      : { text: { maxCharacters: 4000 } },
  };
  if (maxAgeHours !== undefined && maxAgeHours !== null) {
    body.contents.maxAgeHours = maxAgeHours;
  }

  // Try agent gateway first
  try {
    const be = (typeof window !== 'undefined') ? window.__imoBackend : null;
    if (be?.urls?.zeroclaw && be?.status?.zeroclaw === 'connected') {
      const r = await be.post('zeroclaw', '/agent/tool', {
        name: 'exa_contents',
        input: body,
      }, { timeout: 20000 });
      if (r && !r.error) return r;
    }
  } catch {}

  // Try Vercel proxy
  try {
    const r = await fetch('/api/exa-contents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) return await r.json();
    if (r.status !== 503 && r.status !== 404) {
      return null;
    }
  } catch {}

  // Direct fallback (localhost only)
  if (!EXA_API_KEY) return null;
  try {
    const r = await fetch('https://api.exa.ai/contents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EXA_API_KEY,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.warn('[Exa contents]', e.message);
    return null;
  }
};

// Exa-grounded AI synthesis. Searches the web for the query, then asks the
// AI to synthesize an answer using the search results as context. Returns
// { answer, sources: [{title, url}] } or null if either tool unavailable.
// This is the "live web scraping for AI" capability — gives the AI fresh
// info it doesn't have in its training data.
export const exaGroundedAI = async (question, {
  numResults = 6,
  type = 'auto',
  maxAgeHours = 24,
  systemPrompt = null,
} = {}) => {
  // exaSearch handles its own transport chain (agent → proxy → direct).
  // If none works, fall back to plain AI.
  // 1. Search the web for context
  const search = await exaSearch(question, { numResults, type, maxAgeHours, highlights: true });
  if (!search?.results?.length) {
    // No web results — try plain AI as fallback
    const answer = await callAI(question);
    return answer ? { answer, sources: [] } : null;
  }
  // 2. Build a grounded prompt
  const sourcesText = search.results
    .slice(0, numResults)
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.publishedDate ? 'Date: ' + r.publishedDate.slice(0, 10) + '\n' : ''}${r.text || ''}`)
    .join('\n\n---\n\n');
  const system = systemPrompt
    ?? 'You are a financial research assistant. Answer the user\'s question using ONLY the provided search results. Cite sources by [1], [2] etc inline. If the sources do not contain enough information, say so.';
  const prompt = `SEARCH RESULTS:\n${sourcesText}\n\nQUESTION: ${question}\n\nAnswer concisely with inline [N] citations.`;
  const answer = await callAI(prompt, { system, maxTokens: 800 });
  if (!answer) return null;
  return {
    answer,
    sources: search.results.slice(0, numResults).map(r => ({
      title: r.title,
      url: r.url,
      publishedDate: r.publishedDate,
    })),
  };
};

// ──────── OpenAI fallback ────────
export const callOpenAI = async (prompt, { model = 'gpt-4o-mini', maxTokens = 400 } = {}) => {
  if (!OPENAI_API_KEY) return null;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await r.json();
    return j?.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.warn('[OpenAI]', e.message);
    return null;
  }
};
