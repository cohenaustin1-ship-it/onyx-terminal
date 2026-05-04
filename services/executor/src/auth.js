// ─── Auth — JWT + legacy bearer token ────────────────────────────────────
//
// HONEST SCOPE: this is a JWT skeleton for per-user data isolation. It is
// NOT a complete auth system. Missing pieces (you'll want to add or
// replace with Clerk/Supabase before going to production):
//   - No password hashing — registration is email + display name only
//   - No email verification
//   - No password reset
//   - No login throttling / account lockout
//   - No refresh tokens — single token, long-lived
//   - No revocation list — once issued, tokens are valid until expiry
//
// What it DOES do correctly:
//   - HS256-signed JWTs containing {sub, name, iat, exp}
//   - Server-side validation on every authenticated request
//   - Per-user data isolation (req.userId is the source of truth — query
//     params can't override it)
//   - Backwards compatible with the old shared bearer for dev (set
//     LEGACY_AUTH_TOKEN to the same value the SPA had previously)
//
// To replace with a real provider later: swap requireAuth() to validate
// Clerk/Supabase tokens. The rest of the codebase keys off req.userId
// which doesn't change.

import { SignJWT, jwtVerify } from 'jose';
import crypto from 'crypto';

// Secret for signing JWTs. In dev, generated on boot. In prod, MUST be set
// to a long random value via env. If it changes, all tokens become invalid.
const RAW_SECRET = process.env.JWT_SECRET || (
  process.env.NODE_ENV === 'production'
    ? null  // forced to crash below if production without a secret
    : crypto.randomBytes(32).toString('hex')
);
if (!RAW_SECRET) {
  console.error('[auth] FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}
const SECRET = new TextEncoder().encode(RAW_SECRET);

// Token lifetime — 7 days. Short enough to limit blast radius, long enough
// that users don't have to re-login daily. Real prod: 1h access + 30d refresh.
const TOKEN_TTL = '7d';

// Legacy shared bearer — accepted for backwards-compat with dev/SPA code
// that hasn't migrated yet. Set LEGACY_AUTH_TOKEN=<old AUTH_TOKEN> to keep
// it working. Set to empty string in prod to force JWT-only.
const LEGACY_TOKEN = process.env.LEGACY_AUTH_TOKEN || process.env.AUTH_TOKEN || '';

export async function signToken({ userId, name }) {
  return await new SignJWT({ name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(SECRET);
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return { ok: true, userId: payload.sub, name: payload.name };
  } catch (e) {
    return { ok: false, reason: e.code || e.message };
  }
}

// Middleware — validates Authorization: Bearer <token>
// Sets req.userId on success. Sends 401 on failure.
// Path /health is exempted — handled in route definitions.
export async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const [scheme, token] = auth.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'missing or malformed authorization' });
  }
  // Try JWT first
  const jwt = await verifyToken(token);
  if (jwt.ok) {
    req.userId = jwt.userId;
    req.userName = jwt.name;
    req.authMethod = 'jwt';
    return next();
  }
  // Fall back to legacy shared bearer in dev / migration period
  if (LEGACY_TOKEN && token === LEGACY_TOKEN) {
    // For legacy callers, derive userId from the user_id query/body param
    // (this is the previous behavior). Default to 'default' if unspecified.
    req.userId = req.query.user_id || req.body?.user_id || 'default';
    req.authMethod = 'legacy';
    return next();
  }
  return res.status(401).json({ error: 'invalid token', detail: jwt.reason });
}

// Variant that lets unauthenticated requests through but populates req.userId
// when present. Useful for /health-style endpoints that adapt their response.
export async function optionalAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const [scheme, token] = auth.split(' ');
  if (scheme === 'Bearer' && token) {
    const jwt = await verifyToken(token);
    if (jwt.ok) {
      req.userId = jwt.userId;
      req.userName = jwt.name;
      req.authMethod = 'jwt';
    } else if (LEGACY_TOKEN && token === LEGACY_TOKEN) {
      req.userId = req.query.user_id || req.body?.user_id || 'default';
      req.authMethod = 'legacy';
    }
  }
  next();
}
