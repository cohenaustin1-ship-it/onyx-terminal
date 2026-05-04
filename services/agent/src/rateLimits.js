// ─── Rate limiting ───────────────────────────────────────────────────────
//
// Three tiers, scaled to typical usage of each endpoint family:
//   - public  → /health, /trades.csv  (lenient, browser polling friendly)
//   - read    → GET /strategies, /runs, /trades, /positions  (moderate)
//   - write   → POST /strategies, /run, /safety-check  (tighter — these are
//               the ones that consume resources or place orders)
//
// Counts are per-IP. Headers include the limit + remaining count.

import rateLimit from 'express-rate-limit';

export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_PUBLIC || '120', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests' },
});

export const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_READ || '60', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests' },
});

export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_WRITE || '20', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests' },
});

// For agent gateway — LLM calls are expensive, tighter cap
export const llmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_LLM || '15', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many LLM requests' },
});
