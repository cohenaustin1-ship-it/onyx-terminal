// ─── LLM provider chain ───────────────────────────────────────────────────
//
// Three providers wrapped behind a uniform call(messages, opts) interface.
// Caller doesn't know or care which one served the response. Provider chain:
//   primary (default Anthropic) → fallback (OpenAI) → local (Ollama)
// Each is tried in order; we move to the next on network error or 429/5xx.

import axios from 'axios';

class AnthropicProvider {
  constructor(apiKey) {
    this.name = 'anthropic';
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: 'https://api.anthropic.com/v1',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 60000,
    });
  }

  async call(messages, { model = 'claude-sonnet-4-20250514', max_tokens = 1024, system, tools } = {}) {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    const body = {
      model,
      max_tokens,
      messages: messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    };
    if (system) body.system = system;
    if (tools) body.tools = tools;
    const { data } = await this.client.post('/messages', body);
    // Normalize to OpenAI-compatible shape
    return {
      provider: this.name,
      model,
      content: data.content?.[0]?.text || '',
      raw: data,
    };
  }
}

class OpenAIProvider {
  constructor(apiKey) {
    this.name = 'openai';
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      timeout: 60000,
    });
  }

  async call(messages, { model = 'gpt-4o-mini', max_tokens = 1024, system } = {}) {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');
    const allMessages = system
      ? [{ role: 'system', content: system }, ...messages]
      : messages;
    const { data } = await this.client.post('/chat/completions', {
      model, messages: allMessages, max_tokens,
    });
    return {
      provider: this.name,
      model,
      content: data.choices?.[0]?.message?.content || '',
      raw: data,
    };
  }
}

class OllamaProvider {
  constructor(baseUrl) {
    this.name = 'ollama';
    this.baseUrl = baseUrl || 'http://localhost:11434';
    this.client = axios.create({ baseURL: this.baseUrl, timeout: 120000 });
  }

  async call(messages, { model = 'llama3.1', system } = {}) {
    const allMessages = system
      ? [{ role: 'system', content: system }, ...messages]
      : messages;
    const { data } = await this.client.post('/api/chat', {
      model, messages: allMessages, stream: false,
    });
    return {
      provider: this.name,
      model,
      content: data.message?.content || '',
      raw: data,
    };
  }
}

export class LLMChain {
  constructor() {
    this.providers = [];
    if (process.env.ANTHROPIC_API_KEY) {
      this.providers.push(new AnthropicProvider(process.env.ANTHROPIC_API_KEY));
    }
    if (process.env.OPENAI_API_KEY) {
      this.providers.push(new OpenAIProvider(process.env.OPENAI_API_KEY));
    }
    if (process.env.OLLAMA_BASE_URL) {
      this.providers.push(new OllamaProvider(process.env.OLLAMA_BASE_URL));
    }
    if (!this.providers.length) {
      console.warn('[llm] no providers configured — will fail every call');
    }
  }

  async chat(messages, opts = {}) {
    let lastErr;
    for (const p of this.providers) {
      try {
        const r = await p.call(messages, opts);
        return r;
      } catch (e) {
        const status = e.response?.status;
        const retriable = !status || status === 429 || (status >= 500 && status < 600) || e.code === 'ECONNREFUSED';
        console.warn(`[llm] ${p.name} failed (${status || e.code}): ${e.message}${retriable ? ' — falling through' : ''}`);
        lastErr = e;
        if (!retriable) break;
      }
    }
    throw lastErr || new Error('no LLM providers available');
  }

  status() {
    return {
      available: this.providers.map(p => p.name),
      primary: this.providers[0]?.name || null,
    };
  }
}
