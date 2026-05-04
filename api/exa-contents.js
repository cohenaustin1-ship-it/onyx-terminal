// ─── Vercel serverless proxy for Exa /contents ────────────────────────
// Companion to /api/exa-search — fetches the full-text contents of URLs
// previously returned by a search call. Used by the Terminal "Full report"
// button to pull article bodies before passing to AI for synthesis.

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const host   = req.headers.host   || '';
  const allowedOrigin = origin.endsWith(host) || origin.includes(host)
    ? origin
    : '';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin || origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'EXA_API_KEY not configured on server. Set it in Vercel → Settings → Environment Variables.',
    });
  }

  const safeBody = {
    ids:        req.body?.ids,
    text:       req.body?.text,
    highlights: req.body?.highlights,
    summary:    req.body?.summary,
  };
  Object.keys(safeBody).forEach(k => safeBody[k] === undefined && delete safeBody[k]);

  if (!Array.isArray(safeBody.ids) || safeBody.ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  // Cap to prevent quota abuse — usually 5-10 articles per report is plenty
  if (safeBody.ids.length > 20) safeBody.ids = safeBody.ids.slice(0, 20);

  try {
    const r = await fetch('https://api.exa.ai/contents', {
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
    console.error('[exa-contents] proxy error:', e);
    res.status(500).json({ error: 'proxy failed', detail: e.message });
  }
}
