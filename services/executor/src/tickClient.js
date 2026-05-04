// ─── Tick API client ────────────────────────────────────────────────────
// Wraps the Phase 1 service so the executor doesn't repeat fetch boilerplate.

import axios from 'axios';

const TICK_API_URL = process.env.TICK_API_URL || 'http://localhost:8001';
const TICK_API_TOKEN = process.env.TICK_API_TOKEN || process.env.AUTH_TOKEN;

const http = axios.create({
  baseURL: TICK_API_URL,
  headers: { Authorization: `Bearer ${TICK_API_TOKEN}` },
  timeout: 5000,
});

export async function getOhlc(symbol, interval = '1m', limit = 200) {
  const { data } = await http.get(`/ohlc/${encodeURIComponent(symbol)}`, {
    params: { interval, limit },
  });
  // Sort ascending — indicators expect oldest-first
  return (data.bars || []).slice().reverse();
}

export async function getLatest(symbol) {
  try {
    const { data } = await http.get(`/latest/${encodeURIComponent(symbol)}`);
    return data;
  } catch (e) {
    if (e.response?.status === 404) return null;
    throw e;
  }
}

export async function getTickHealth() {
  try {
    const { data } = await http.get('/health');
    return data;
  } catch {
    return null;
  }
}
