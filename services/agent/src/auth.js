// ─── Agent auth — JWT skeleton, no DB ────────────────────────────────────
// Same logic as executor's auth.js, but slimmer (no Postgres dependency).

import { SignJWT, jwtVerify } from 'jose';
import crypto from 'crypto';

const RAW_SECRET = process.env.JWT_SECRET || (
  process.env.NODE_ENV === 'production'
    ? null
    : crypto.randomBytes(32).toString('hex')
);
if (!RAW_SECRET) {
  console.error('[auth] FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}
const SECRET = new TextEncoder().encode(RAW_SECRET);
const TOKEN_TTL = '7d';
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

export async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const [scheme, token] = auth.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'missing or malformed authorization' });
  }
  const jwt = await verifyToken(token);
  if (jwt.ok) {
    req.userId = jwt.userId;
    req.userName = jwt.name;
    req.authMethod = 'jwt';
    return next();
  }
  if (LEGACY_TOKEN && token === LEGACY_TOKEN) {
    req.userId = req.query.user_id || req.body?.user_id || 'default';
    req.authMethod = 'legacy';
    return next();
  }
  return res.status(401).json({ error: 'invalid token', detail: jwt.reason });
}
