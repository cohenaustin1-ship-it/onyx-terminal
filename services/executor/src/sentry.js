// ─── Sentry — error tracking ─────────────────────────────────────────────
//
// Initialized on boot if SENTRY_DSN is set. No-op otherwise.
// Captures unhandled errors, traces N% of requests (configurable), and
// flags slow requests automatically. Sign up at https://sentry.io to get
// a DSN — free tier covers 5k events/month which is plenty for early stage.

import * as Sentry from '@sentry/node';

const DSN = process.env.SENTRY_DSN;

export function initSentry({ service }) {
  if (!DSN) {
    console.log('[sentry] SENTRY_DSN not set — error tracking disabled');
    return null;
  }
  Sentry.init({
    dsn: DSN,
    serverName: service,
    environment: process.env.NODE_ENV || 'development',
    // Trace 10% of requests in production, 100% in dev
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    // Don't send PII
    sendDefaultPii: false,
    // Ignore expected errors
    ignoreErrors: [
      // Common bot scans against /health
      'Not Found',
    ],
  });
  console.log(`[sentry] initialized for ${service}`);
  return Sentry;
}

export { Sentry };
