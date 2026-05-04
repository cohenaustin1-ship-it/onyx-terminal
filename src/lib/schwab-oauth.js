// IMO Onyx Terminal — Schwab OAuth client (Phase 3p.11 / Addition 2)
//
// HONEST SCOPE NOTICE
// ===================
// This module is a SCAFFOLD. The Schwab API requires:
//   1. A registered developer account with Schwab
//   2. A registered app with a redirect URI
//   3. Production OAuth credentials (client_id / client_secret)
//   4. A real callback page hosted at the registered redirect URI
//   5. An HTTPS origin (Schwab won't redirect to http://)
//
// None of those can be done from this file or this codebase alone.
// Without a developer account, this module CANNOT successfully
// complete an OAuth handshake. What it provides is the wire-level
// shape so that, when credentials become available, the integration
// is ~30 lines of config away rather than a multi-day rewrite.
//
// The token refresh, expiry check, and storage abstractions ARE
// fully implemented and unit-testable — those work without a live
// Schwab account.
//
// Schwab OAuth flow (Authorization Code with PKCE):
//   1. App generates a code_verifier (random) and code_challenge
//      (SHA-256 of verifier, base64url-encoded).
//   2. App redirects user to:
//      https://api.schwabapi.com/v1/oauth/authorize
//        ?response_type=code
//        &client_id=<APP_KEY>
//        &redirect_uri=<REGISTERED>
//        &code_challenge=<CHALLENGE>
//        &code_challenge_method=S256
//   3. User authenticates with Schwab, gets redirected to:
//      <redirect_uri>?code=<AUTH_CODE>&state=...
//   4. App exchanges code for tokens at:
//      POST https://api.schwabapi.com/v1/oauth/token
//        grant_type=authorization_code
//        code=<AUTH_CODE>
//        redirect_uri=<SAME>
//        client_id=<APP_KEY>
//        code_verifier=<VERIFIER>
//      Returns: { access_token, refresh_token, expires_in, ... }
//   5. Access token expires in ~30 minutes; refresh token good for
//      7 days. App refreshes via POST /v1/oauth/token with
//      grant_type=refresh_token.
//
// What this module DOES:
//   - generates PKCE pairs (verifier + S256 challenge)
//   - builds the authorize URL
//   - parses the redirect callback URL
//   - manages token storage in localStorage with expiry
//   - knows when to refresh
//
// What this module DOES NOT do:
//   - run the actual code exchange (requires server-side proxy
//     because the Schwab token endpoint requires the client_secret
//     and that can't ship in a public web app)
//   - handle the redirect itself (that's a hosted callback page)

const STORAGE_KEY = 'imo_schwab_tokens';

// Base64url encode (no padding). Used for PKCE challenge.
const base64url = (bytes) => {
  let s = btoa(String.fromCharCode.apply(null, bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// Generate a cryptographically-random verifier (43-128 chars per RFC 7636)
export const generateCodeVerifier = (length = 64) => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return base64url(Array.from(arr)).slice(0, length);
  }
  // Fallback (non-cryptographic; only for test environments)
  let s = '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let i = 0; i < length; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
};

// SHA-256 hash + base64url encode (the S256 challenge method)
export const generateCodeChallenge = async (verifier) => {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const enc = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    return base64url(Array.from(new Uint8Array(hash)));
  }
  throw new Error('crypto.subtle not available — cannot generate S256 challenge');
};

// Build the Schwab authorize URL the user will be redirected to.
// state is a CSRF nonce — the caller should generate, store locally,
// and verify on the redirect callback.
export const buildAuthorizeUrl = ({
  appKey,
  redirectUri,
  codeChallenge,
  state,
  scope = 'AccountAccess',
  authBaseUrl = 'https://api.schwabapi.com/v1/oauth/authorize',
}) => {
  if (!appKey) throw new Error('appKey required');
  if (!redirectUri) throw new Error('redirectUri required');
  if (!codeChallenge) throw new Error('codeChallenge required');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: appKey,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope,
  });
  if (state) params.set('state', state);
  return `${authBaseUrl}?${params.toString()}`;
};

// Parse the callback URL Schwab redirected the user to. Returns
// { code, state, error, errorDescription } per RFC 6749.
export const parseCallbackUrl = (url) => {
  if (!url) return {};
  let urlObj;
  try { urlObj = new URL(url); }
  catch { return { error: 'invalid_url' }; }
  const params = urlObj.searchParams;
  return {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
    errorDescription: params.get('error_description'),
  };
};

// Token storage — wraps localStorage with expiry awareness
export const loadTokens = () => {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.access_token) return null;
    return parsed;
  } catch { return null; }
};

export const saveTokens = ({ access_token, refresh_token, expires_in, scope }) => {
  if (!access_token) return null;
  const expires_at = Date.now() + (Number(expires_in) || 1800) * 1000;
  const record = { access_token, refresh_token, expires_at, scope };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    }
  } catch {}
  return record;
};

export const clearTokens = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
};

// "Should I refresh?" — true if access token expires within `marginMs`.
// Default margin is 60s so we don't make API calls right at expiry.
export const shouldRefresh = (tokens, marginMs = 60_000, nowFn = Date.now) => {
  if (!tokens || !tokens.access_token) return false;
  if (!tokens.expires_at) return true;
  return tokens.expires_at - nowFn() <= marginMs;
};

// Refresh tokens via the executor's proxy endpoint. The executor must
// hold the client_secret server-side because Schwab requires it on
// refresh. This function POSTs the refresh_token to /broker/schwab/refresh
// (which the executor implements separately) and gets back fresh tokens.
//
// Honest scope: the executor endpoint isn't implemented in this codebase
// either. When it is, this function works as-is.
export const refreshTokens = async ({
  refreshToken,
  proxyUrl,
  jwt,
  fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
}) => {
  if (!refreshToken) throw new Error('refreshToken required');
  if (!proxyUrl) throw new Error('proxyUrl required (server-side proxy for client_secret)');
  if (!fetchImpl) throw new Error('fetch not available');

  const r = await fetchImpl(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`schwab refresh failed: ${r.status} ${err}`);
  }
  const data = await r.json();
  return saveTokens(data);
};

// Exchange an authorization code for tokens via the server-side proxy.
// (The proxy holds client_secret; we never put it in client bundles.)
//
// Phase 3p.13 scaffolding closeout: this pairs with the
// /broker/schwab/exchange route in services/executor/src/index.js.
export const exchangeCodeForTokens = async ({
  code,
  redirectUri,
  proxyUrl,
  jwt,
  fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
}) => {
  if (!code) throw new Error('code required');
  if (!redirectUri) throw new Error('redirectUri required');
  if (!proxyUrl) throw new Error('proxyUrl required');
  if (!fetchImpl) throw new Error('fetch not available');

  const r = await fetchImpl(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`schwab exchange failed: ${r.status} ${err}`);
  }
  const data = await r.json();
  return saveTokens(data);
};

// Fetch the authorize URL from the server (server holds CLIENT_ID).
// Returns { url, state } — the caller should persist `state` and
// verify it matches when Schwab redirects back to the callback.
export const getAuthorizeUrl = async ({
  proxyUrl,
  jwt,
  fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
}) => {
  if (!proxyUrl) throw new Error('proxyUrl required');
  if (!fetchImpl) throw new Error('fetch not available');
  const r = await fetchImpl(proxyUrl, {
    method: 'GET',
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`schwab authorize-url failed: ${r.status} ${err}`);
  }
  return r.json();
};
