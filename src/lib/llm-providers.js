// IMO Onyx Terminal — LLM provider configs and key/active storage
//
// Phase 3p.17 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~918-1253).
//
// Multi-provider LLM abstraction. Each provider has a config object
// with { id, label, envVar, models[], call(prompt, opts) } so the
// rest of the app can talk to any provider through one interface.
// Currently supported:
//   - Anthropic Claude (anthropic.com)
//   - OpenAI (openai.com)
//   - Google Gemini (googleapis.com)
//   - Ollama (local — no key required)
//
// Storage:
//   imo_llm_keys    { [providerId]: 'sk-...' }   — user-set keys
//   imo_llm_active  { providerId, modelId }      — currently active
//
// Audit:
//   Key add/update/remove and provider switches are logged via
//   appendAuditEntry. Keys themselves are never written to the audit
//   log — only the providerId is recorded with action 'llm-key-added'
//   etc. (See src/lib/audit-log.js for the redaction rules.)

import { appendAuditEntry } from './audit-log.js';

// Env-var keys (duplicated from monolith — same source, separate read).
// User-set keys stored in localStorage win over env keys at runtime.
const ANTHROPIC_API_KEY = (() => { try { return import.meta.env?.VITE_ANTHROPIC_API_KEY ?? ''; } catch { return ''; } })();
const OPENAI_API_KEY    = (() => { try { return import.meta.env?.VITE_OPENAI_API_KEY    ?? ''; } catch { return ''; } })();

export const LLM_KEYS_STORAGE = 'imo_llm_keys';
export const LLM_ACTIVE_STORAGE = 'imo_llm_active';
export const loadLlmKeys = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LLM_KEYS_STORAGE) : null;
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};
export const saveLlmKeys = (keys) => {
  // Diff against the previous state so we can audit-log additions
  // and removals at the provider level (without leaking the keys
  // themselves — they get redacted to "***" in the audit trail).
  const prev = loadLlmKeys();
  try {
    localStorage.setItem(LLM_KEYS_STORAGE, JSON.stringify(keys));
    window.dispatchEvent(new CustomEvent('imo:llm-keys-changed'));
  } catch {}
  try {
    const prevIds = new Set(Object.keys(prev || {}).filter(k => prev[k]));
    const nextIds = new Set(Object.keys(keys || {}).filter(k => keys[k]));
    for (const id of nextIds) {
      if (!prevIds.has(id)) {
        appendAuditEntry({ category: 'settings', action: 'llm-key-added',   target: id });
      } else if (prev[id] !== keys[id]) {
        appendAuditEntry({ category: 'settings', action: 'llm-key-updated', target: id });
      }
    }
    for (const id of prevIds) {
      if (!nextIds.has(id)) {
        appendAuditEntry({ category: 'settings', action: 'llm-key-removed', target: id });
      }
    }
  } catch {}
};
export const loadLlmActive = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LLM_ACTIVE_STORAGE) : null;
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
export const saveLlmActive = (active) => {
  const prev = loadLlmActive();
  try {
    localStorage.setItem(LLM_ACTIVE_STORAGE, JSON.stringify(active));
    window.dispatchEvent(new CustomEvent('imo:llm-active-changed'));
  } catch {}
  try {
    if (!prev || prev.providerId !== active?.providerId || prev.modelId !== active?.modelId) {
      appendAuditEntry({
        category: 'settings',
        action:   'llm-provider-switched',
        target:   active?.providerId ?? null,
        prev,
        next:     active,
      });
    }
  } catch {}
};
// User key OR env key — user wins. Returns string or empty string.
export const resolveLlmKey = (providerId) => {
  const stored = loadLlmKeys();
  const userKey = (stored?.[providerId] ?? '').trim();
  if (userKey) return userKey;
  if (providerId === 'anthropic') return ANTHROPIC_API_KEY;
  if (providerId === 'openai')    return OPENAI_API_KEY;
  return '';
};

// Anthropic adapter
export const PROVIDER_ANTHROPIC = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  envVar: 'VITE_ANTHROPIC_API_KEY',
  models: [
    { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7',     vision: true,  contextWindow: 200000 },
    { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6',     vision: true,  contextWindow: 200000 },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',   vision: true,  contextWindow: 200000 },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',    vision: true,  contextWindow: 200000 },
  ],
  hasEnvKey: () => !!ANTHROPIC_API_KEY,
  callChat: async (messages, { model = 'claude-haiku-4-5-20251001', maxTokens = 800, system = null, images = null } = {}) => {
    const key = resolveLlmKey('anthropic');
    if (!key) return null;
    try {
      // If images are attached AND only one user message, build the
      // single-message multimodal shape (back-compat with callAnthropic).
      // Otherwise pass through messages as-is, expanding any with images.
      const apiMessages = messages.map(m => {
        if (m.role === 'user' && Array.isArray(m.images) && m.images.length > 0) {
          return {
            role: 'user',
            content: [
              ...m.images.map(img => ({
                type: 'image',
                source: { type: 'base64', media_type: img.mediaType, data: img.base64Data },
              })),
              { type: 'text', text: m.content || 'Please analyze the attached image.' },
            ],
          };
        }
        // If single-call style with images param, attach to last user msg
        if (m === messages[messages.length - 1] && m.role === 'user' &&
            Array.isArray(images) && images.length > 0) {
          return {
            role: 'user',
            content: [
              ...images.map(img => ({
                type: 'image',
                source: { type: 'base64', media_type: img.mediaType, data: img.base64Data },
              })),
              { type: 'text', text: m.content },
            ],
          };
        }
        return { role: m.role, content: m.content };
      });
      const body = { model, max_tokens: maxTokens, messages: apiMessages };
      if (system) body.system = system;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      const txt = (j?.content ?? [])
        .filter(b => b?.type === 'text' && typeof b.text === 'string')
        .map(b => b.text).join('\n').trim();
      return txt || null;
    } catch (e) {
      console.warn('[Anthropic]', e.message);
      return null;
    }
  },
};

// OpenAI adapter
export const PROVIDER_OPENAI = {
  id: 'openai',
  label: 'OpenAI',
  envVar: 'VITE_OPENAI_API_KEY',
  models: [
    { id: 'gpt-4o',           label: 'GPT-4o',          vision: true,  contextWindow: 128000 },
    { id: 'gpt-4o-mini',      label: 'GPT-4o mini',     vision: true,  contextWindow: 128000 },
    { id: 'gpt-4-turbo',      label: 'GPT-4 Turbo',     vision: true,  contextWindow: 128000 },
    { id: 'gpt-3.5-turbo',    label: 'GPT-3.5 Turbo',   vision: false, contextWindow: 16385 },
  ],
  hasEnvKey: () => !!OPENAI_API_KEY,
  callChat: async (messages, { model = 'gpt-4o-mini', maxTokens = 800, system = null, images = null } = {}) => {
    const key = resolveLlmKey('openai');
    if (!key) return null;
    try {
      // OpenAI's chat shape is a single messages array; system goes
      // as a role:'system' message at the front. Vision: image_url
      // blocks attached to user content with data: URLs.
      const apiMessages = [];
      if (system) apiMessages.push({ role: 'system', content: system });
      messages.forEach((m, idx) => {
        const isLastUser = idx === messages.length - 1 && m.role === 'user';
        const msgImages = (Array.isArray(m.images) && m.images.length > 0)
          ? m.images
          : (isLastUser && Array.isArray(images) && images.length > 0 ? images : null);
        if (m.role === 'user' && msgImages) {
          apiMessages.push({
            role: 'user',
            content: [
              ...msgImages.map(img => ({
                type: 'image_url',
                image_url: { url: `data:${img.mediaType};base64,${img.base64Data}` },
              })),
              { type: 'text', text: m.content || 'Please analyze the attached image.' },
            ],
          });
        } else {
          apiMessages.push({ role: m.role, content: m.content });
        }
      });
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: apiMessages }),
      });
      const j = await r.json();
      return j?.choices?.[0]?.message?.content ?? null;
    } catch (e) {
      console.warn('[OpenAI]', e.message);
      return null;
    }
  },
};

// Gemini adapter — Google's Generative Language API. Uses
// generateContent endpoint. Vision via inlineData blocks.
export const PROVIDER_GEMINI = {
  id: 'gemini',
  label: 'Google Gemini',
  envVar: 'VITE_GEMINI_API_KEY',
  models: [
    { id: 'gemini-2.0-flash',     label: 'Gemini 2.0 Flash',     vision: true, contextWindow: 1000000 },
    { id: 'gemini-1.5-pro',       label: 'Gemini 1.5 Pro',       vision: true, contextWindow: 2000000 },
    { id: 'gemini-1.5-flash',     label: 'Gemini 1.5 Flash',     vision: true, contextWindow: 1000000 },
  ],
  hasEnvKey: () => {
    try { return !!import.meta.env?.VITE_GEMINI_API_KEY; } catch { return false; }
  },
  callChat: async (messages, { model = 'gemini-1.5-flash', maxTokens = 800, system = null, images = null } = {}) => {
    const key = resolveLlmKey('gemini') ||
                (() => { try { return import.meta.env?.VITE_GEMINI_API_KEY ?? ''; } catch { return ''; } })();
    if (!key) return null;
    try {
      // Gemini's content shape: contents[].parts[]. Each part is
      // either { text } or { inlineData: { mimeType, data } }.
      // System prompts go in `systemInstruction` at request level.
      const contents = messages.map((m, idx) => {
        const isLastUser = idx === messages.length - 1 && m.role === 'user';
        const msgImages = (Array.isArray(m.images) && m.images.length > 0)
          ? m.images
          : (isLastUser && Array.isArray(images) && images.length > 0 ? images : null);
        const parts = [];
        if (m.role === 'user' && msgImages) {
          msgImages.forEach(img => {
            parts.push({ inlineData: { mimeType: img.mediaType, data: img.base64Data } });
          });
        }
        parts.push({ text: m.content || (msgImages ? 'Please analyze the attached image.' : '') });
        return { role: m.role === 'assistant' ? 'model' : 'user', parts };
      });
      const body = {
        contents,
        generationConfig: { maxOutputTokens: maxTokens },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      return j?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') ?? null;
    } catch (e) {
      console.warn('[Gemini]', e.message);
      return null;
    }
  },
};

// Ollama adapter — local LLM runtime. URL-configurable (default
// http://localhost:11434). Useful for users who want fully-local
// inference with no cloud roundtrip. Vision support depends on
// the model loaded (llava, bakllava, etc.).
export const PROVIDER_OLLAMA = {
  id: 'ollama',
  label: 'Ollama (local)',
  envVar: null,
  models: [
    { id: 'llama3.3',    label: 'Llama 3.3',    vision: false, contextWindow: 128000 },
    { id: 'llama3.2',    label: 'Llama 3.2',    vision: false, contextWindow: 128000 },
    { id: 'mistral',     label: 'Mistral',      vision: false, contextWindow: 32768 },
    { id: 'llava',       label: 'LLaVA (vision)', vision: true, contextWindow: 4096 },
    { id: 'bakllava',    label: 'BakLLaVA',      vision: true, contextWindow: 4096 },
    { id: 'qwen2.5',     label: 'Qwen 2.5',      vision: false, contextWindow: 32768 },
  ],
  hasEnvKey: () => true, // local — no key, just a URL
  callChat: async (messages, { model = 'llama3.3', maxTokens = 800, system = null, images = null } = {}) => {
    const stored = loadLlmKeys();
    const baseUrl = (stored?.ollama_url ?? 'http://localhost:11434').replace(/\/$/, '');
    try {
      // Ollama's /api/chat shape is similar to OpenAI's. Images
      // attach as base64 strings on the message in `images: [...]`.
      const apiMessages = [];
      if (system) apiMessages.push({ role: 'system', content: system });
      messages.forEach((m, idx) => {
        const isLastUser = idx === messages.length - 1 && m.role === 'user';
        const msgImages = (Array.isArray(m.images) && m.images.length > 0)
          ? m.images
          : (isLastUser && Array.isArray(images) && images.length > 0 ? images : null);
        const out = { role: m.role, content: m.content || '' };
        if (msgImages) out.images = msgImages.map(img => img.base64Data);
        apiMessages.push(out);
      });
      const r = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          stream: false,
          options: { num_predict: maxTokens },
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return j?.message?.content ?? null;
    } catch (e) {
      console.warn('[Ollama]', e.message);
      return null;
    }
  },
};

export const LLM_PROVIDERS = [
  PROVIDER_ANTHROPIC,
  PROVIDER_OPENAI,
  PROVIDER_GEMINI,
  PROVIDER_OLLAMA,
];
export const getProvider = (id) => LLM_PROVIDERS.find(p => p.id === id) ?? null;
// Resolve which provider+model is active. Falls back through
// configured providers if the active one has no key.
export const resolveActiveProvider = () => {
  const active = loadLlmActive();
  if (active?.providerId) {
    const p = getProvider(active.providerId);
    if (p) {
      const hasKey = !!resolveLlmKey(p.id) || (p.id === 'ollama');
      if (hasKey) {
        const model = p.models.find(m => m.id === active.modelId) ?? p.models[0];
        return { provider: p, model };
      }
    }
  }
  // Back-compat: pick the first provider with a working key
  for (const p of LLM_PROVIDERS) {
    if (resolveLlmKey(p.id)) {
      return { provider: p, model: p.models[0] };
    }
  }
  // Ollama is always considered "available" since there's no key
  // (we just don't auto-default to it without explicit user pick).
  return null;
};
