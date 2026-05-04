// ─── Channel router ──────────────────────────────────────────────────────
// Given a user + event type, look up their preferences and dispatch to the
// right channels.

import * as telegram from './telegram.js';
import * as web from './web.js';
import { getNotificationPrefs } from '../memory.js';

const CHANNELS = {
  telegram,
  web,
  // discord, email, imessage, voice — plug in here when you build them
};

export async function notify(userId, eventType, message, payload = null) {
  const prefs = getNotificationPrefs(userId);
  const pref = prefs[eventType];
  if (!pref || !pref.enabled) {
    return { delivered: [], skipped_reason: 'event_disabled_or_unknown' };
  }
  const results = [];
  for (const chan of pref.channels || []) {
    const handler = CHANNELS[chan];
    if (!handler) {
      results.push({ channel: chan, sent: false, reason: 'unknown_channel' });
      continue;
    }
    if (!handler.isConfigured()) {
      results.push({ channel: chan, sent: false, reason: 'channel_not_configured' });
      continue;
    }
    const r = await handler.sendMessage(userId, message, payload);
    results.push({ channel: chan, ...r });
  }
  return { delivered: results };
}

export function getChannelStatus() {
  return Object.fromEntries(
    Object.entries(CHANNELS).map(([k, v]) => [k, v.isConfigured()])
  );
}
