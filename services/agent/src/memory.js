// ─── Persistent memory ────────────────────────────────────────────────────
// File-backed JSON store. For real production swap to Postgres + pgvector
// for semantic recall. This is the bare minimum that lets the agent
// remember user preferences across sessions.

import fs from 'fs';
import path from 'path';

const MEMORY_PATH = process.env.MEMORY_PATH || './data/agent_memory.json';

let cache = null;

function load() {
  if (cache) return cache;
  if (!fs.existsSync(MEMORY_PATH)) {
    cache = { users: {}, notifications: {}, conversation_history: {} };
    save();
    return cache;
  }
  try {
    cache = JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
  } catch {
    cache = { users: {}, notifications: {}, conversation_history: {} };
  }
  return cache;
}

function save() {
  if (!cache) return;
  const dir = path.dirname(MEMORY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(cache, null, 2));
}

export function getUser(userId) {
  const m = load();
  return m.users[userId] || null;
}

export function upsertUser(userId, patch) {
  const m = load();
  m.users[userId] = { ...(m.users[userId] || {}), ...patch };
  save();
  return m.users[userId];
}

export function getNotificationPrefs(userId) {
  const m = load();
  return m.notifications[userId] || {
    signal_fired:           { enabled: true, channels: ['web'] },
    order_filled:           { enabled: true, channels: ['web'] },
    stop_hit:               { enabled: true, channels: ['web'] },
    pnl_threshold_crossed:  { enabled: false, channels: ['web'] },
    morning_brief:          { enabled: false, channels: [] },
    system_alert:           { enabled: true, channels: ['web'] },
  };
}

export function setNotificationPrefs(userId, prefs) {
  const m = load();
  m.notifications[userId] = prefs;
  save();
  return prefs;
}

export function appendConversation(userId, role, content) {
  const m = load();
  if (!m.conversation_history[userId]) m.conversation_history[userId] = [];
  m.conversation_history[userId].push({ role, content, ts: Date.now() });
  // Keep last 100 messages per user
  if (m.conversation_history[userId].length > 100) {
    m.conversation_history[userId] = m.conversation_history[userId].slice(-100);
  }
  save();
}

export function getConversation(userId, limit = 20) {
  const m = load();
  return (m.conversation_history[userId] || []).slice(-limit);
}

export function listUsers() {
  const m = load();
  return Object.keys(m.users);
}
