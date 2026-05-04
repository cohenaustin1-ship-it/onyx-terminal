// ─── Vercel serverless proxy for Exa search ──────────────────────────────
//
// Exa blocks direct browser calls (no CORS). This function runs on Vercel's
// edge, accepts requests from the SPA, forwards them to Exa with the API
// key attached server-side, and returns the result.
//
// Why this is necessary:
//   - Exa's API requires Authorization header
//   - Exa doesn't return Access-Control-Allow-Origin for browser origins
//   - Even if it did, the API key would be exposed to anyone with DevTools
//
// Setup:
//   1. In Vercel dashboard → Settings → Environment Variables, add:
//        EXA_API_KEY = <your key>     (NO VITE_ prefix — server-side only)
//   2. Deploy. The SPA automatically uses /api/exa-search instead of
//      api.exa.ai when this endpoint is reachable.
//
// The function lives in /api/ which Vercel auto-detects as a serverless
// function. No routing config needed.

export default async function handler(req, res) {
  // Allow CORS from same origin only (browser will set Origin header).
  // The SPA on the same Vercel deploy is allowed; cross-origin is blocked.
  const origin = req.headers.origin || '';
  const host   = req.headers.host   || '';
  const allowedOrigin = origin.endsWith(host) || origin.includes(host)
    ? origin
    : '';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin || origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'EXA_API_KEY not configured on server. Set it in Vercel → Settings → Environment Variables.',
    });
  }

  // Whitelist of fields we forward — prevents the SPA from sending arbitrary
  // request bodies, which could otherwise be used to abuse our quota.
  const safeBody = {
    query:           req.body?.query,
    numResults:      req.body?.numResults,
    type:            req.body?.type,
    useAutoprompt:   req.body?.useAutoprompt,
    includeDomains:  req.body?.includeDomains,
    excludeDomains:  req.body?.excludeDomains,
    startPublishedDate: req.body?.startPublishedDate,
    endPublishedDate:   req.body?.endPublishedDate,
    contents:        req.body?.contents,
    category:        req.body?.category,
  };
  // Drop undefined keys so Exa doesn't get confused
  Object.keys(safeBody).forEach(k => safeBody[k] === undefined && delete safeBody[k]);

  if (!safeBody.query || typeof safeBody.query !== 'string') {
    return res.status(400).json({ error: 'query required (string)' });
  }
  // Cap quota usage per call
  if (safeBody.numResults && safeBody.numResults > 25) safeBody.numResults = 25;

  try {
    const r = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    apiKey,
      },
      body: JSON.stringify(safeBody),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({
        error: data?.error || `Exa returned ${r.status}`,
        upstream_status: r.status,
      });
    }
    res.status(200).json(data);
  } catch (e) {
    console.error('[exa-search] proxy error:', e);
    res.status(500).json({ error: 'proxy failed', detail: e.message });
  }
}
