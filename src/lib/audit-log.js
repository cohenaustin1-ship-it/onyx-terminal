// IMO Onyx Terminal — compliance audit log
//
// Phase 3p.05 (feature). Unified change log that captures every
// auditable event the user takes through the app. Built as a
// generalization of the safety-audit infrastructure (which was
// scoped only to "did the user confirm or cancel a safety-gated
// order?").
//
// What gets logged:
//   - Order placed, modified, cancelled, filled
//   - Settings changed (broker, llm, lock, safety, prefs)
//   - Broker config saved (new credentials, switching active)
//   - Executor JWT issued / revoked
//   - Privacy lock engaged / released
//   - Workspace lock state changes
//
// What does NOT get logged here:
//   - Read-only navigation (page changes)
//   - Live price ticks
//   - Idle-timer fires (too noisy)
//
// Storage shape:
//   imo_audit_log = [
//     { id, ts, category, action, actor, target, details, prev, next },
//     ...
//   ]
//
// Capped at 5,000 entries — older entries roll off FIFO. This is
// roughly 2-3 months of active trading for a power user, more for
// casual users. For longer retention, exports to CSV are encouraged.
//
// Categories:
//   'order'       — order lifecycle events
//   'settings'    — config changes (broker, llm, lock, safety, prefs)
//   'auth'        — login/logout, JWT mint/revoke
//   'lock'        — workspace lock engaged/released
//   'broker'      — broker connection added/removed/switched
//   'system'      — app-level events (onboarding completed, etc.)
//
// Public exports:
//   AUDIT_LOG_KEY                — localStorage key
//   AUDIT_LOG_CAP                — max entries (5,000)
//   loadAuditLog()               — read full log (newest first)
//   appendAuditEntry(entry)      — push + cap + dispatch event
//   clearAuditLog()              — wipe the log (requires confirmation
//                                   from the caller; this function just
//                                   does the storage operation)
//   exportAuditLogCSV()          — RFC 4180-compliant CSV string of
//                                   the full log, with headers. Suitable
//                                   for regulator-style review.
//   filterAuditLog(query)        — { category?, action?, sinceTs?,
//                                     untilTs?, search? } → filtered list

export const AUDIT_LOG_KEY = 'imo_audit_log';
export const AUDIT_LOG_CAP = 5000;

const AUDIT_EVENT = 'imo:audit-log-changed';

export const loadAuditLog = () => {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(AUDIT_LOG_KEY)
      : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const generateId = () => {
  // Compact id: timestamp (base36) + 4 random base36 chars.
  // Not cryptographic — just enough to uniquely identify events
  // for export/dedup.
  const ts = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 0x10000).toString(36).padStart(4, '0');
  return `${ts}-${rnd}`;
};

export const appendAuditEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  if (!entry.category || !entry.action) return null;
  try {
    const log = loadAuditLog();
    const full = {
      id: entry.id ?? generateId(),
      ts: entry.ts ?? Date.now(),
      category: String(entry.category),
      action:   String(entry.action),
      actor:    entry.actor ?? null,    // user id, 'ai-agent', or 'system'
      target:   entry.target ?? null,   // affected entity (ticker, key, etc.)
      details:  entry.details ?? null,  // free-form payload
      prev:     entry.prev ?? null,     // previous value (for settings changes)
      next:     entry.next ?? null,     // new value
    };
    log.unshift(full);
    const capped = log.slice(0, AUDIT_LOG_CAP);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(capped));
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AUDIT_EVENT, { detail: full }));
    }
    return full;
  } catch {
    return null;
  }
};

export const clearAuditLog = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(AUDIT_LOG_KEY);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AUDIT_EVENT));
    }
  } catch {}
};

// CSV escape per RFC 4180: wrap in quotes if the value contains
// quote/comma/newline; double up internal quotes.
const csvEscape = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

export const exportAuditLogCSV = (entries = null) => {
  const log = entries ?? loadAuditLog();
  const headers = ['id', 'timestamp', 'iso_time', 'category', 'action', 'actor', 'target', 'details', 'prev', 'next'];
  const lines = [headers.join(',')];
  for (const e of log) {
    const iso = new Date(e.ts).toISOString();
    lines.push([
      csvEscape(e.id),
      csvEscape(e.ts),
      csvEscape(iso),
      csvEscape(e.category),
      csvEscape(e.action),
      csvEscape(e.actor),
      csvEscape(e.target),
      csvEscape(e.details),
      csvEscape(e.prev),
      csvEscape(e.next),
    ].join(','));
  }
  return lines.join('\r\n');
};

export const filterAuditLog = (query = {}) => {
  const log = loadAuditLog();
  const { category, action, sinceTs, untilTs, search } = query;
  return log.filter(e => {
    if (category && e.category !== category) return false;
    if (action   && e.action   !== action)   return false;
    if (Number.isFinite(sinceTs) && e.ts < sinceTs) return false;
    if (Number.isFinite(untilTs) && e.ts > untilTs) return false;
    if (search) {
      const q = String(search).toLowerCase();
      const hay = JSON.stringify(e).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
};
