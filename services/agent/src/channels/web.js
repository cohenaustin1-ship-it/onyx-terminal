// ─── Web channel ─────────────────────────────────────────────────────────
// SSE-style: SPA opens an EventSource to /channels/web/stream?token=...&user_id=...
// and we push notifications down it.

const sseClients = new Map(); // userId → Set<res>

export function subscribe(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);
  res.on('close', () => {
    sseClients.get(userId)?.delete(res);
  });
}

export function isConfigured() { return true; }

export async function sendMessage(userId, text, payload = null) {
  const set = sseClients.get(userId);
  if (!set || !set.size) return { sent: false, reason: 'no_active_browser' };
  const data = JSON.stringify({ text, payload, ts: Date.now() });
  for (const res of set) {
    try { res.write(`data: ${data}\n\n`); } catch {}
  }
  return { sent: true, count: set.size };
}
