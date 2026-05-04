// ─── Cron — schedule strategy runs at each interval ───────────────────────
import cron from 'node-cron';
import { runAllStrategiesForInterval } from './executor.js';

export function startCronJobs() {
  // Every minute
  cron.schedule('* * * * *', async () => {
    try {
      const r = await runAllStrategiesForInterval('1m');
      if (r.length) console.log(`[cron 1m] ran ${r.length} strategies`);
    } catch (e) { console.error('[cron 1m]', e); }
  });

  // Every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const r = await runAllStrategiesForInterval('5m');
      if (r.length) console.log(`[cron 5m] ran ${r.length} strategies`);
    } catch (e) { console.error('[cron 5m]', e); }
  });

  // Every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      const r = await runAllStrategiesForInterval('15m');
      if (r.length) console.log(`[cron 15m] ran ${r.length} strategies`);
    } catch (e) { console.error('[cron 15m]', e); }
  });

  // Every hour at :05
  cron.schedule('5 * * * *', async () => {
    try {
      const r = await runAllStrategiesForInterval('1h');
      if (r.length) console.log(`[cron 1h] ran ${r.length} strategies`);
    } catch (e) { console.error('[cron 1h]', e); }
  });

  // Daily at 9:30 ET (~14:30 UTC) — equity market open
  cron.schedule('30 14 * * 1-5', async () => {
    try {
      const r = await runAllStrategiesForInterval('1d');
      if (r.length) console.log(`[cron 1d] ran ${r.length} strategies`);
    } catch (e) { console.error('[cron 1d]', e); }
  });

  console.log('[cron] schedules registered: 1m, 5m, 15m, 1h, 1d');
}
