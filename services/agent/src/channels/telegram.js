// ─── Telegram channel ─────────────────────────────────────────────────────
// Real implementation against Telegram Bot API.
// Setup:
//   1. Message @BotFather, /newbot, get a token
//   2. Set TELEGRAM_BOT_TOKEN in env
//   3. Have your user message the bot at least once
//   4. Call POST /channels/telegram/register with their chat_id
//      (or auto-discover via the /getUpdates endpoint)

import axios from 'axios';
import { upsertUser, getUser } from '../memory.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = TOKEN ? axios.create({
  baseURL: `https://api.telegram.org/bot${TOKEN}`,
  timeout: 5000,
}) : null;

export function isConfigured() {
  return !!TOKEN;
}

export async function sendMessage(userId, text) {
  if (!API) return { sent: false, reason: 'telegram_not_configured' };
  const user = getUser(userId);
  const chatId = user?.telegram_chat_id;
  if (!chatId) return { sent: false, reason: 'no_chat_id' };
  try {
    await API.post('/sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

export function registerUser(userId, chatId) {
  upsertUser(userId, { telegram_chat_id: chatId });
  return { userId, chatId };
}

// Auto-discover registrations via getUpdates polling
// (run once on boot to pick up any users who messaged the bot recently)
export async function pollUpdates() {
  if (!API) return [];
  try {
    const { data } = await API.post('/getUpdates', { timeout: 0 });
    if (!data.ok) return [];
    const newUsers = [];
    for (const u of data.result || []) {
      const msg = u.message;
      if (!msg) continue;
      const chatId = msg.chat?.id;
      const username = msg.from?.username;
      if (chatId && username) {
        upsertUser(username, { telegram_chat_id: chatId, telegram_username: msg.from.username });
        newUsers.push({ username, chatId });
      }
    }
    return newUsers;
  } catch (e) {
    console.warn('[telegram] pollUpdates error:', e.message);
    return [];
  }
}
