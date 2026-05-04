// @ts-check
// IMO Onyx Terminal — Market hours utility
//
// Phase 3p.34 (TypeScript-driven extraction): isMarketOpen was
// inlined into instrument-header.jsx during 3p.31 because that was
// the only known caller. TypeScript checking trade-feeds.js then
// surfaced TWO additional callers (lines 97 + 320) that were
// referencing isMarketOpen as if it were globally available — a
// latent bug that only ReferenceError'd in two specific edge code
// paths (equity simulation outside market hours).
//
// Moved to its own small lib so both callers can import cleanly.

/**
 * Returns true when the US equity market is currently open.
 * Approximate: covers Mon-Fri 9:30am-4:00pm ET. Does not account
 * for market holidays, half-days, or DST edge cases. For trading
 * decisions use a real holiday calendar.
 *
 * @returns {boolean}
 */
export const isMarketOpen = () => {
  const now = new Date();
  // Get the day-of-week and hour-minute in ET specifically
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find(p => p.type === 'weekday')?.value;
  const hour    = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute  = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  // Closed Sat/Sun
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const totalMinutes = hour * 60 + minute;
  // 9:30 AM = 570 minutes, 4:00 PM = 960 minutes
  return totalMinutes >= 570 && totalMinutes < 960;
};
