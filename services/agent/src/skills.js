// ─── Skills — cron-driven and event-triggered routines ───────────────────
//
// Skills are the equivalent of ZeroClaw's `.claude/skills/*.md` — small
// focused agent tasks that fire on a schedule or event. Three example
// skills are wired up here. The pattern is: gather context via tools,
// hand it to the LLM, dispatch the result via the channel router.

import cron from 'node-cron';
import { LLMChain } from './llm.js';
import { executeTool } from './tools.js';
import { notify } from './channels/index.js';
import { listUsers } from './memory.js';

const llm = new LLMChain();

// ─── Morning brief (8am ET weekdays) ─────────────────────────────────────
async function morningBriefSkill() {
  for (const userId of listUsers()) {
    try {
      // Get user's positions and recent trades
      const positions = await executeTool('list_positions', { user_id: userId });
      const trades = await executeTool('list_recent_trades', { user_id: userId, limit: 5 });

      const prompt = `You are an institutional desk analyst preparing a morning brief.
The user has ${positions.positions?.length ?? 0} open positions:
${JSON.stringify(positions.positions || [], null, 2)}

Their last 5 trades:
${JSON.stringify(trades.trades || [], null, 2)}

Write a 3-sentence morning brief covering:
1. Overnight portfolio impact (if any positions had material moves)
2. What to watch today
3. One actionable observation

Be specific. No filler. Use concrete numbers.`;

      const r = await llm.chat([{ role: 'user', content: prompt }], {
        max_tokens: 400,
        system: "You are a Bloomberg-grade morning desk analyst. Be concise. No emoji.",
      });
      await notify(userId, 'morning_brief', `*Morning brief*\n\n${r.content}`);
    } catch (e) {
      console.warn(`[skill morning_brief] ${userId}:`, e.message);
    }
  }
}

// ─── Position monitor (every 30 min during market hours) ─────────────────
async function positionMonitorSkill() {
  const hour = new Date().getUTCHours();
  // Roughly US market hours 14:30-21:00 UTC
  if (hour < 14 || hour > 20) return;

  for (const userId of listUsers()) {
    try {
      const { positions = [] } = await executeTool('list_positions', { user_id: userId });
      for (const p of positions) {
        // Crude: alert if unrealized loss > 3%
        const pl = p.market_value && p.avg_entry_price * p.qty
          ? (p.market_value - p.avg_entry_price * p.qty) / (p.avg_entry_price * p.qty)
          : 0;
        if (pl < -0.03) {
          await notify(userId, 'pnl_threshold_crossed',
            `⚠️ ${p.symbol}: down ${(pl * 100).toFixed(1)}% — review your stop`,
            { symbol: p.symbol, pl });
        }
      }
    } catch (e) {
      console.warn(`[skill position_monitor] ${userId}:`, e.message);
    }
  }
}

// ─── Signal-fired skill (event-triggered) ────────────────────────────────
// Subscribes to the executor's WebSocket and dispatches a notification on
// each signal/fill/rejection.
import WebSocket from 'ws';
let signalWs = null;

function attachSignalListener() {
  const url = process.env.EXECUTOR_WS_URL;
  const token = process.env.EXECUTOR_AUTH_TOKEN;
  if (!url || !token) {
    console.log('[skill signal_watch] EXECUTOR_WS_URL not set — skipping');
    return;
  }
  function connect() {
    try {
      signalWs = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
      signalWs.on('open', () => console.log('[skill signal_watch] connected'));
      signalWs.on('message', async (raw) => {
        try {
          const event = JSON.parse(raw.toString());
          if (event.type === 'fill') {
            for (const userId of listUsers()) {
              await notify(userId, 'order_filled',
                `✅ ${event.side?.toUpperCase()} ${event.qty} ${event.symbol} @ ${event.price}\nstrategy: ${event.strategy_name}`,
                event);
            }
          } else if (event.type === 'signal') {
            for (const userId of listUsers()) {
              await notify(userId, 'signal_fired',
                `📈 Signal: ${event.strategy_name} (${event.symbol} ${event.side})`,
                event);
            }
          } else if (event.type === 'rejection') {
            for (const userId of listUsers()) {
              await notify(userId, 'system_alert',
                `🚫 Strategy blocked: ${event.strategy_name || event.strategy_id} — ${event.blocker}`,
                event);
            }
          }
        } catch (e) {
          console.warn('[skill signal_watch] parse error:', e.message);
        }
      });
      signalWs.on('close', () => {
        console.log('[skill signal_watch] disconnected, reconnecting in 5s');
        setTimeout(connect, 5000);
      });
      signalWs.on('error', (e) => {
        console.warn('[skill signal_watch] ws error:', e.message);
      });
    } catch (e) {
      console.warn('[skill signal_watch] connect failed:', e.message);
      setTimeout(connect, 5000);
    }
  }
  connect();
}

// ─── Schedule everything ─────────────────────────────────────────────────
export function startSkills() {
  cron.schedule('30 13 * * 1-5', morningBriefSkill);     // 13:30 UTC (~8:30 ET)
  cron.schedule('*/30 * * * *', positionMonitorSkill);    // every 30 min
  attachSignalListener();
  console.log('[skills] scheduled: morning_brief, position_monitor, signal_watch');
}
