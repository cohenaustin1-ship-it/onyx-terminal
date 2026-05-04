// ─── Agent tools ──────────────────────────────────────────────────────────
// These are the functions the LLM can call. Each returns a JSON-serializable
// result and never throws — errors come back as { error: "..." } objects so
// the LLM can decide what to do.

import axios from 'axios';

const TICK_API_URL = process.env.TICK_API_URL;
const TICK_API_TOKEN = process.env.TICK_API_TOKEN;
const EXEC_API_URL = process.env.EXECUTOR_API_URL;
const EXEC_AUTH_TOKEN = process.env.EXECUTOR_AUTH_TOKEN;
const EXA_API_KEY = process.env.EXA_API_KEY;

const tickHttp = TICK_API_URL ? axios.create({
  baseURL: TICK_API_URL,
  headers: { Authorization: `Bearer ${TICK_API_TOKEN}` },
  timeout: 5000,
}) : null;

const execHttp = EXEC_API_URL ? axios.create({
  baseURL: EXEC_API_URL,
  headers: { Authorization: `Bearer ${EXEC_AUTH_TOKEN}` },
  timeout: 5000,
}) : null;

// Exa client — server-side, has the API key. The SPA's exaSearch / exa-search
// proxy can route through this when the agent is reachable, which means
// the SPA never needs the Exa key in the browser at all.
const exaHttp = EXA_API_KEY ? axios.create({
  baseURL: 'https://api.exa.ai',
  headers: { 'x-api-key': EXA_API_KEY, 'Content-Type': 'application/json' },
  timeout: 15000,
}) : null;

export const TOOLS = {
  async query_ticks({ symbol, limit = 100 }) {
    if (!tickHttp) return { error: 'tick API not configured' };
    try {
      const { data } = await tickHttp.get(`/data/${symbol}`, { params: { limit } });
      return data;
    } catch (e) { return { error: e.message }; }
  },

  async get_ohlc({ symbol, interval = '1h', limit = 50 }) {
    if (!tickHttp) return { error: 'tick API not configured' };
    try {
      const { data } = await tickHttp.get(`/ohlc/${symbol}`, { params: { interval, limit } });
      return data;
    } catch (e) { return { error: e.message }; }
  },

  async list_strategies({ user_id = 'default' }) {
    if (!execHttp) return { error: 'executor not configured' };
    try {
      const { data } = await execHttp.get('/strategies', { params: { user_id } });
      return data;
    } catch (e) { return { error: e.message }; }
  },

  async run_strategy_safety_check({ strategy_id }) {
    if (!execHttp) return { error: 'executor not configured' };
    try {
      const { data } = await execHttp.post(`/strategies/${strategy_id}/safety-check`);
      return data;
    } catch (e) { return { error: e.message }; }
  },

  async list_positions({ user_id = 'default' }) {
    if (!execHttp) return { error: 'executor not configured' };
    try {
      const { data } = await execHttp.get('/positions', { params: { user_id } });
      return data;
    } catch (e) { return { error: e.message }; }
  },

  async list_recent_trades({ user_id = 'default', limit = 20 }) {
    if (!execHttp) return { error: 'executor not configured' };
    try {
      const { data } = await execHttp.get('/trades', { params: { user_id, limit } });
      return data;
    } catch (e) { return { error: e.message }; }
  },

  // Exa web search — gives the LLM access to live news + research articles.
  // The SPA also calls this via /agent/tool to avoid CORS issues with direct
  // browser calls to api.exa.ai.
  async exa_search({ query, numResults = 10, type = 'auto', highlights, contents,
                     includeDomains, excludeDomains,
                     startPublishedDate, endPublishedDate, useAutoprompt }) {
    if (!exaHttp) return { error: 'EXA_API_KEY not configured on agent' };
    if (!query) return { error: 'query required' };
    try {
      const body = { query, numResults: Math.min(numResults, 25), type };
      // Allow either {highlights: bool} shorthand or {contents: {...}} explicit
      if (contents) body.contents = contents;
      else if (highlights) body.contents = { highlights: { maxCharacters: 600 } };
      else body.contents = { text: { maxCharacters: 1500 } };
      if (includeDomains) body.includeDomains = includeDomains;
      if (excludeDomains) body.excludeDomains = excludeDomains;
      if (startPublishedDate) body.startPublishedDate = startPublishedDate;
      if (endPublishedDate)   body.endPublishedDate   = endPublishedDate;
      if (useAutoprompt !== undefined) body.useAutoprompt = useAutoprompt;
      const { data } = await exaHttp.post('/search', body);
      return data;
    } catch (e) {
      const status = e.response?.status;
      return { error: `Exa ${status || 'request'} failed: ${e.message}` };
    }
  },

  // Exa /contents — get full text for known URLs. Used by the Terminal full
  // report flow when we already have URLs and want article bodies.
  async exa_contents({ ids, contents, highlights }) {
    if (!exaHttp) return { error: 'EXA_API_KEY not configured on agent' };
    if (!Array.isArray(ids) || ids.length === 0) return { error: 'ids array required' };
    try {
      const body = { ids: ids.slice(0, 20) };
      if (contents) body.contents = contents;
      else if (highlights) body.contents = { highlights: { maxCharacters: 1200 } };
      else body.contents = { text: { maxCharacters: 4000 } };
      const { data } = await exaHttp.post('/contents', body);
      return data;
    } catch (e) {
      const status = e.response?.status;
      return { error: `Exa ${status || 'request'} failed: ${e.message}` };
    }
  },
};

// Tool specs for the LLM (Anthropic format)
export const TOOL_SPECS = [
  {
    name: 'query_ticks',
    description: 'Get recent raw ticks for a symbol. Use for very-short-term price action.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol e.g. "BTC", "AAPL"' },
        limit: { type: 'integer', description: 'How many ticks to return (1-1000)', default: 100 },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_ohlc',
    description: 'Get OHLC candle bars for a symbol at a given interval.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        interval: { type: 'string', enum: ['1m','5m','15m','1h','4h','1d'], default: '1h' },
        limit: { type: 'integer', default: 50 },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'list_strategies',
    description: "List a user's strategies and their auto-execute / enabled state.",
    input_schema: {
      type: 'object',
      properties: { user_id: { type: 'string', default: 'default' } },
    },
  },
  {
    name: 'run_strategy_safety_check',
    description: 'Evaluate every entry condition on a strategy and return pass/fail per condition.',
    input_schema: {
      type: 'object',
      properties: { strategy_id: { type: 'integer' } },
      required: ['strategy_id'],
    },
  },
  {
    name: 'list_positions',
    description: "Get a user's currently held positions.",
    input_schema: {
      type: 'object',
      properties: { user_id: { type: 'string', default: 'default' } },
    },
  },
  {
    name: 'list_recent_trades',
    description: "Get a user's most recent fills.",
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', default: 'default' },
        limit: { type: 'integer', default: 20 },
      },
    },
  },
  {
    name: 'exa_search',
    description: 'Search the live web via Exa for news, research papers, and analysis. Use when the user asks about recent events, company news, or anything that might have happened after your training cutoff.',
    input_schema: {
      type: 'object',
      properties: {
        query:       { type: 'string',  description: 'Natural-language search query — descriptive works best, e.g. "NVDA earnings reaction" or "chip companies that benefit from AI inference"' },
        numResults:  { type: 'integer', default: 10, description: 'Max 25' },
        type:        { type: 'string',  enum: ['auto', 'fast', 'instant', 'deep', 'deep-lite'], default: 'auto' },
        startPublishedDate: { type: 'string', description: 'ISO date — restrict to articles published on or after this date' },
        endPublishedDate:   { type: 'string', description: 'ISO date — restrict to articles published on or before this date' },
        includeDomains:     { type: 'array', items: { type: 'string' }, description: 'Restrict results to these domains' },
        excludeDomains:     { type: 'array', items: { type: 'string' }, description: 'Filter these domains out' },
      },
      required: ['query'],
    },
  },
  {
    name: 'exa_contents',
    description: 'Fetch the full article text for a list of URLs (returned by exa_search or known beforehand). Use to get more detail than search snippets provide.',
    input_schema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Array of URLs to fetch contents for. Max 20.' },
      },
      required: ['ids'],
    },
  },
];

export async function executeTool(name, input) {
  const fn = TOOLS[name];
  if (!fn) return { error: `unknown tool: ${name}` };
  try {
    return await fn(input || {});
  } catch (e) {
    return { error: e.message };
  }
}
