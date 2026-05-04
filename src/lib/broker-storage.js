// IMO Onyx Terminal — broker config storage helpers
//
// Phase 3p.01 (file split, batch 13 — chrome layer prerequisite).
// localStorage-backed broker provider configurations + active broker
// selection. Stored separately from the paper account so the paper
// trading state is independent of any real-broker connections.
//
// Public exports:
//   BROKERS_STORAGE         localStorage key for {providerId: config}
//   ACTIVE_BROKER_STORAGE   localStorage key for { providerId, accountId }
//   loadBrokerConfigs()     → { [providerId]: config }  defaults to {}
//   saveBrokerConfigs(cfg)  Persists + dispatches imo:broker-config-changed
//   loadActiveBroker()      → { providerId, accountId }  defaults to paper
//   saveActiveBroker(act)   Persists + dispatches imo:active-broker-changed
//
// CustomEvents are how the BrokerStatusPill stays in sync — any save
// triggers a refresh in any listening component.

import { appendAuditEntry } from './audit-log.js';

export const BROKERS_STORAGE = 'imo_brokers';
export const ACTIVE_BROKER_STORAGE = 'imo_active_broker';

export const loadBrokerConfigs = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(BROKERS_STORAGE) : null;
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};

export const saveBrokerConfigs = (cfg) => {
  // Diff the previous config against the new one — log additions and
  // removals as separate audit entries to give a clear trail of which
  // brokers were added/configured/removed and when.
  const prev = loadBrokerConfigs();
  try {
    localStorage.setItem(BROKERS_STORAGE, JSON.stringify(cfg));
    window.dispatchEvent(new CustomEvent('imo:broker-config-changed'));
  } catch {}
  try {
    const prevIds = new Set(Object.keys(prev || {}));
    const nextIds = new Set(Object.keys(cfg || {}));
    for (const id of nextIds) {
      if (!prevIds.has(id)) {
        appendAuditEntry({ category: 'broker', action: 'added', target: id });
      } else {
        // Existing — log update only if the serialized form changed
        if (JSON.stringify(prev[id]) !== JSON.stringify(cfg[id])) {
          appendAuditEntry({ category: 'broker', action: 'updated', target: id });
        }
      }
    }
    for (const id of prevIds) {
      if (!nextIds.has(id)) {
        appendAuditEntry({ category: 'broker', action: 'removed', target: id });
      }
    }
  } catch {}
};

export const loadActiveBroker = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_BROKER_STORAGE) : null;
    return raw ? JSON.parse(raw) : { providerId: 'paper', accountId: null };
  } catch { return { providerId: 'paper', accountId: null }; }
};

export const saveActiveBroker = (active) => {
  const prev = loadActiveBroker();
  try {
    localStorage.setItem(ACTIVE_BROKER_STORAGE, JSON.stringify(active));
    window.dispatchEvent(new CustomEvent('imo:active-broker-changed'));
  } catch {}
  try {
    if (prev.providerId !== active.providerId || prev.accountId !== active.accountId) {
      appendAuditEntry({
        category: 'broker',
        action: 'switched',
        target: active.providerId,
        prev,
        next: active,
      });
    }
  } catch {}
};
