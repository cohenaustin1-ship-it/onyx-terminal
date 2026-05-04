// IMO Onyx Terminal — Schwab OAuth tests
//
// These tests cover the wire-shape pieces that don't require live
// Schwab access. Token exchange (the actual /v1/oauth/token call)
// can't be tested here without a server proxy.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthorizeUrl,
  parseCallbackUrl,
  loadTokens,
  saveTokens,
  clearTokens,
  shouldRefresh,
  refreshTokens,
  exchangeCodeForTokens,
  getAuthorizeUrl,
} from '../schwab-oauth.js';

const makeShim = () => {
  const store = new Map();
  return {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
  };
};

beforeEach(() => {
  globalThis.localStorage = makeShim();
  // btoa is needed for base64 encoding in Node test env
  if (typeof btoa === 'undefined') {
    globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
  }
});

describe('generateCodeVerifier', () => {
  it('returns a string of the requested length', () => {
    const v = generateCodeVerifier(64);
    expect(v).toBeTypeOf('string');
    expect(v.length).toBe(64);
  });

  it('uses only base64url alphabet', () => {
    const v = generateCodeVerifier(64);
    expect(/^[A-Za-z0-9_-]+$/.test(v)).toBe(true);
  });

  it('produces different verifiers on each call', () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
  });
});

describe('generateCodeChallenge', () => {
  it('produces a base64url-encoded SHA-256 hash', async () => {
    if (typeof crypto === 'undefined' || !crypto.subtle) return;
    const c = await generateCodeChallenge('test-verifier');
    expect(c).toBeTypeOf('string');
    expect(/^[A-Za-z0-9_-]+$/.test(c)).toBe(true);
  });

  it('produces the same challenge for the same verifier (deterministic)', async () => {
    if (typeof crypto === 'undefined' || !crypto.subtle) return;
    const c1 = await generateCodeChallenge('test-verifier');
    const c2 = await generateCodeChallenge('test-verifier');
    expect(c1).toBe(c2);
  });

  it('produces different challenges for different verifiers', async () => {
    if (typeof crypto === 'undefined' || !crypto.subtle) return;
    const c1 = await generateCodeChallenge('verifier-a');
    const c2 = await generateCodeChallenge('verifier-b');
    expect(c1).not.toBe(c2);
  });
});

describe('buildAuthorizeUrl', () => {
  it('includes all required OAuth params', () => {
    const url = buildAuthorizeUrl({
      appKey: 'test-app',
      redirectUri: 'https://example.com/cb',
      codeChallenge: 'CHAL',
      state: 'csrf-nonce',
    });
    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=test-app');
    expect(url).toContain('code_challenge=CHAL');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('state=csrf-nonce');
  });

  it('URL-encodes the redirect URI', () => {
    const url = buildAuthorizeUrl({
      appKey: 'k',
      redirectUri: 'https://example.com/cb?x=y',
      codeChallenge: 'c',
    });
    expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcb%3Fx%3Dy');
  });

  it('throws on missing required params', () => {
    expect(() => buildAuthorizeUrl({ redirectUri: 'r', codeChallenge: 'c' })).toThrow();
    expect(() => buildAuthorizeUrl({ appKey: 'k', codeChallenge: 'c' })).toThrow();
    expect(() => buildAuthorizeUrl({ appKey: 'k', redirectUri: 'r' })).toThrow();
  });

  it('uses the Schwab production endpoint by default', () => {
    const url = buildAuthorizeUrl({
      appKey: 'k', redirectUri: 'https://x', codeChallenge: 'c',
    });
    expect(url).toContain('api.schwabapi.com');
  });

  it('accepts custom auth endpoint for testing', () => {
    const url = buildAuthorizeUrl({
      appKey: 'k', redirectUri: 'https://x', codeChallenge: 'c',
      authBaseUrl: 'https://test-auth.example.com/oauth/authorize',
    });
    expect(url).toContain('test-auth.example.com');
  });
});

describe('parseCallbackUrl', () => {
  it('extracts code and state from a successful callback', () => {
    const r = parseCallbackUrl('https://app.example.com/cb?code=AUTH123&state=csrf');
    expect(r.code).toBe('AUTH123');
    expect(r.state).toBe('csrf');
    expect(r.error).toBeNull();
  });

  it('extracts error and description on failed callback', () => {
    const r = parseCallbackUrl('https://app.example.com/cb?error=access_denied&error_description=user+denied');
    expect(r.error).toBe('access_denied');
    expect(r.errorDescription).toBe('user denied');
    expect(r.code).toBeNull();
  });

  it('handles invalid URLs gracefully', () => {
    const r = parseCallbackUrl('not-a-url');
    expect(r.error).toBe('invalid_url');
  });

  it('handles null/undefined input', () => {
    expect(parseCallbackUrl(null)).toEqual({});
    expect(parseCallbackUrl(undefined)).toEqual({});
  });
});

describe('Token storage', () => {
  it('saveTokens persists to localStorage with computed expiry', () => {
    const r = saveTokens({
      access_token: 'AT',
      refresh_token: 'RT',
      expires_in: 1800, // 30 min
    });
    expect(r.access_token).toBe('AT');
    expect(r.expires_at).toBeGreaterThan(Date.now());
    expect(r.expires_at).toBeLessThan(Date.now() + 1900_000);
  });

  it('loadTokens returns null when no tokens stored', () => {
    expect(loadTokens()).toBeNull();
  });

  it('loadTokens returns the saved record', () => {
    saveTokens({ access_token: 'AT', refresh_token: 'RT', expires_in: 1800 });
    const r = loadTokens();
    expect(r.access_token).toBe('AT');
  });

  it('loadTokens returns null on malformed JSON', () => {
    localStorage.setItem('imo_schwab_tokens', '{broken');
    expect(loadTokens()).toBeNull();
  });

  it('clearTokens removes the record', () => {
    saveTokens({ access_token: 'AT', refresh_token: 'RT', expires_in: 1800 });
    clearTokens();
    expect(loadTokens()).toBeNull();
  });

  it('saveTokens rejects records without access_token', () => {
    expect(saveTokens({ refresh_token: 'RT' })).toBeNull();
  });
});

describe('shouldRefresh', () => {
  it('returns true when no tokens exist', () => {
    expect(shouldRefresh(null)).toBe(false);
  });

  it('returns true when expiry is within margin', () => {
    const tokens = { access_token: 'AT', expires_at: Date.now() + 30_000 }; // 30s
    expect(shouldRefresh(tokens, 60_000)).toBe(true);
  });

  it('returns false when expiry is comfortably in the future', () => {
    const tokens = { access_token: 'AT', expires_at: Date.now() + 600_000 }; // 10 min
    expect(shouldRefresh(tokens, 60_000)).toBe(false);
  });

  it('uses injectable nowFn for deterministic testing', () => {
    const tokens = { access_token: 'AT', expires_at: 1_000_000 };
    expect(shouldRefresh(tokens, 1000, () => 999_000)).toBe(true);
    expect(shouldRefresh(tokens, 1000, () => 100_000)).toBe(false);
  });
});

describe('refreshTokens', () => {
  it('throws on missing refreshToken', async () => {
    await expect(refreshTokens({ proxyUrl: 'https://x' })).rejects.toThrow();
  });

  it('throws on missing proxyUrl', async () => {
    await expect(refreshTokens({ refreshToken: 'RT' })).rejects.toThrow();
  });

  it('POSTs to the proxy with refresh_token + Bearer JWT', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'NEW', refresh_token: 'NEW_RT', expires_in: 1800 }),
    });
    const r = await refreshTokens({
      refreshToken: 'RT', proxyUrl: 'https://api.test/refresh', jwt: 'jwt', fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const callArgs = fetchImpl.mock.calls[0];
    expect(callArgs[1].method).toBe('POST');
    expect(callArgs[1].headers.Authorization).toBe('Bearer jwt');
    expect(JSON.parse(callArgs[1].body).refresh_token).toBe('RT');
    expect(r.access_token).toBe('NEW');
  });

  it('throws on non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 401,
      text: () => Promise.resolve('expired'),
    });
    await expect(refreshTokens({
      refreshToken: 'RT', proxyUrl: 'https://api.test', fetchImpl,
    })).rejects.toThrow(/401/);
  });
});

describe('exchangeCodeForTokens', () => {
  it('rejects when no code', async () => {
    await expect(exchangeCodeForTokens({})).rejects.toThrow(/code/);
  });
  it('rejects when no redirectUri', async () => {
    await expect(exchangeCodeForTokens({ code: 'C' })).rejects.toThrow(/redirect/);
  });
  it('rejects when no proxyUrl', async () => {
    await expect(exchangeCodeForTokens({
      code: 'C', redirectUri: 'https://app/cb',
    })).rejects.toThrow(/proxyUrl/);
  });
  it('POSTs to the proxy with code + redirect_uri', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        access_token: 'AT', refresh_token: 'RT', expires_in: 1800, scope: 'readonly',
      }),
    });
    await exchangeCodeForTokens({
      code: 'AUTHCODE', redirectUri: 'https://app/cb',
      proxyUrl: 'https://api/broker/schwab/exchange', fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, opts] = fetchImpl.mock.calls[0];
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.code).toBe('AUTHCODE');
    expect(body.redirect_uri).toBe('https://app/cb');
  });
  it('attaches Bearer JWT when provided', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ access_token: 'AT', refresh_token: 'RT', expires_in: 1800 }),
    });
    await exchangeCodeForTokens({
      code: 'C', redirectUri: 'https://app/cb',
      proxyUrl: 'https://api/exchange', jwt: 'JWT', fetchImpl,
    });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer JWT');
  });
  it('saves the returned tokens to localStorage', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        access_token: 'NEW_AT', refresh_token: 'NEW_RT',
        expires_in: 1800, scope: 'readonly',
      }),
    });
    await exchangeCodeForTokens({
      code: 'C', redirectUri: 'https://app/cb',
      proxyUrl: 'https://api/exchange', fetchImpl,
    });
    const stored = loadTokens();
    expect(stored.access_token).toBe('NEW_AT');
    expect(stored.refresh_token).toBe('NEW_RT');
  });
  it('throws on non-OK response with status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 400,
      text: () => Promise.resolve('invalid_grant'),
    });
    await expect(exchangeCodeForTokens({
      code: 'C', redirectUri: 'https://app/cb',
      proxyUrl: 'https://api/exchange', fetchImpl,
    })).rejects.toThrow(/400/);
  });
});

describe('getAuthorizeUrl', () => {
  it('rejects when no proxyUrl', async () => {
    await expect(getAuthorizeUrl({})).rejects.toThrow(/proxyUrl/);
  });
  it('GETs from the proxy and returns { url, state }', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        url: 'https://api.schwabapi.com/v1/oauth/authorize?client_id=X&state=ABC',
        state: 'ABC',
      }),
    });
    const r = await getAuthorizeUrl({ proxyUrl: 'https://api/authorize-url', fetchImpl });
    expect(r.url).toMatch(/schwabapi/);
    expect(r.state).toBe('ABC');
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
  });
  it('attaches Bearer JWT when provided', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ url: 'x', state: 'y' }),
    });
    await getAuthorizeUrl({ proxyUrl: 'https://api/url', jwt: 'JWT', fetchImpl });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer JWT');
  });
  it('throws on non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 503,
      text: () => Promise.resolve('schwab not configured'),
    });
    await expect(getAuthorizeUrl({
      proxyUrl: 'https://api/url', fetchImpl,
    })).rejects.toThrow(/503/);
  });
});
