// ─── Event bus — broadcasts strategy events to SPA WebSocket clients ──────
//
// The SPA opens one WS to /ws/events. Any strategy run, fill, or rejection
// gets pushed here. This is what makes the chart-and-bot decoupling work:
// the bot doesn't know about the chart; it just emits events.
//
// Phase 3p.16: added /ws/snippets channel as a WebSocket alternative to
// the SSE endpoint introduced in 3p.13. Same delivery semantics
// (per-user broadcast on snippet CRUD), different transport. Useful when
// SSE is blocked by intermediate proxies that don't handle long-lived
// HTTP connections well.

import { WebSocketServer } from 'ws';
import { jwtVerify } from 'jose';

const clients = new Set();

// Per-user WS subscribers for snippet events (Phase 3p.16).
// Mirrors the snippetSubscribers Map in index.js but for WS clients.
const snippetClients = new Map(); // userId → Set<ws>

const verifyJwt = async (token) => {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch { return null; }
};

export function attachWsServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  const wssSnippets = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/ws/events') {
      // Auth via ?token= query param (browser WS can't set headers)
      const token = url.searchParams.get('token');
      if (token !== process.env.AUTH_TOKEN) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.add(ws);
        ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }));
        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
      });
      return;
    }

    if (url.pathname === '/ws/snippets') {
      // Per-user WS — JWT in ?token=
      const token = url.searchParams.get('token');
      const payload = await verifyJwt(token);
      const userId = payload?.sub;
      if (!userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wssSnippets.handleUpgrade(req, socket, head, (ws) => {
        if (!snippetClients.has(userId)) snippetClients.set(userId, new Set());
        snippetClients.get(userId).add(ws);
        try { ws.send(JSON.stringify({ event: 'ready', ok: true })); } catch {}
        const cleanup = () => {
          const subs = snippetClients.get(userId);
          if (subs) {
            subs.delete(ws);
            if (subs.size === 0) snippetClients.delete(userId);
          }
        };
        ws.on('close', cleanup);
        ws.on('error', cleanup);
      });
      return;
    }

    socket.destroy();
  });

  // Heartbeat — drop dead connections
  setInterval(() => {
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
      }
    }
    for (const subs of snippetClients.values()) {
      for (const ws of subs) {
        if (ws.readyState === ws.OPEN) {
          try { ws.send(JSON.stringify({ event: 'heartbeat', ts: Date.now() })); }
          catch {}
        }
      }
    }
  }, 30000);

  return wss;
}

export function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(payload); } catch {}
    }
  }
}

// Per-user snippet broadcast for the /ws/snippets channel.
// Called by the POST/DELETE /snippets routes alongside the SSE
// broadcastSnippetEvent (Phase 3p.16).
export function broadcastSnippetWs(userId, event, payload) {
  const subs = snippetClients.get(userId);
  if (!subs || subs.size === 0) return;
  const data = JSON.stringify({ event, payload });
  for (const ws of subs) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(data); } catch {}
    }
  }
}
