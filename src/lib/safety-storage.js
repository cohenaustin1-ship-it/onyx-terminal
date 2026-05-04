// IMO Onyx Terminal — order safety storage + audit
//
// Phase 3p.02 (file split, batch 14). User-configurable trade-confirmation
// rules: when an order's notional exceeds a threshold (or always, if
// confirmAll is set), surface a "Place this order?" modal with a
// configurable countdown. Audit log of every confirm/cancel decision
// is persisted alongside.
//
// Storage shapes:
//   imo_safety       = { enabled, thresholdUsd, confirmAll, countdownSec }
//   imo_safety_audit = [{ ts, side, instrument, notional, decision, ... }]
//                      capped at 100 entries (FIFO).
//
// Public exports:
//   SAFETY_KEY                 — main settings localStorage key
//   SAFETY_AUDIT_KEY           — audit log localStorage key
//   DEFAULT_SAFETY             — defaults: { enabled: false,
//                                            thresholdUsd: 10000,
//                                            confirmAll: false,
//                                            countdownSec: 3 }
//   loadSafetyState()          — load + merge with defaults
//   saveSafetyState(state)     — persist + dispatch imo:safety-state-changed
//   loadSafetyAudit()          — full audit log
//   appendSafetyAudit(entry)   — push + cap + dispatch imo:safety-audit-changed

import { appendAuditEntry } from './audit-log.js';

export const SAFETY_KEY = 'imo_safety';
export const SAFETY_AUDIT_KEY = 'imo_safety_audit';

export const DEFAULT_SAFETY = {
  enabled:      false,
  thresholdUsd: 10000,
  confirmAll:   false,
  countdownSec: 3,
};

export const loadSafetyState = () => {
  try {
    const raw = localStorage.getItem(SAFETY_KEY);
    if (!raw) return { ...DEFAULT_SAFETY };
    const parsed = JSON.parse(raw);
    return {
      enabled:      parsed.enabled === true,
      thresholdUsd: Number.isFinite(parsed.thresholdUsd) && parsed.thresholdUsd >= 0
                      ? parsed.thresholdUsd : DEFAULT_SAFETY.thresholdUsd,
      confirmAll:   parsed.confirmAll === true,
      countdownSec: Math.max(0, Math.min(15, Number.isFinite(parsed.countdownSec)
                      ? parsed.countdownSec : DEFAULT_SAFETY.countdownSec)),
    };
  } catch { return { ...DEFAULT_SAFETY }; }
};

export const saveSafetyState = (state) => {
  const prev = loadSafetyState();
  try {
    localStorage.setItem(SAFETY_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent('imo:safety-state-changed'));
  } catch {}
  // Audit: log non-trivial changes to the safety config. We don't log
  // every keystroke during the threshold input — that's the caller's
  // job (debouncing). Here we just diff the persisted form.
  try {
    const changed = (
      prev.enabled      !== state.enabled ||
      prev.thresholdUsd !== state.thresholdUsd ||
      prev.confirmAll   !== state.confirmAll ||
      prev.countdownSec !== state.countdownSec
    );
    if (changed) {
      appendAuditEntry({
        category: 'settings',
        action:   'safety-updated',
        target:   'safety',
        prev,
        next:     state,
      });
    }
  } catch {}
};

export const loadSafetyAudit = () => {
  try {
    const raw = localStorage.getItem(SAFETY_AUDIT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

export const appendSafetyAudit = (entry) => {
  try {
    const log = loadSafetyAudit();
    log.unshift({ ts: Date.now(), ...entry });
    const capped = log.slice(0, 100);
    localStorage.setItem(SAFETY_AUDIT_KEY, JSON.stringify(capped));
    window.dispatchEvent(new CustomEvent('imo:safety-audit-changed'));
  } catch {}
  // Mirror to the unified audit log so order-confirm decisions show up
  // in the compliance view alongside everything else. Keep the legacy
  // safety-audit storage intact for the existing SafetySettingsPanel UI.
  try {
    appendAuditEntry({
      category: 'order',
      action:   `safety-${entry?.decision ?? 'unknown'}`,
      target:   entry?.instrument ?? null,
      details:  entry,
    });
  } catch {}
};
