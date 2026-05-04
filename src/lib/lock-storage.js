// IMO Onyx Terminal — workspace lock storage
//
// Phase 3p.02 (file split, batch 14 — settings ecosystem prerequisite).
// Lets a user lock their workspace after a configurable idle timeout
// (or manually via Cmd/Ctrl+L) so screen-shoulder-surfing in an
// office or coffee shop doesn't expose live positions. The lock
// state lives in localStorage so it survives page reloads — a
// genuinely-locked workspace stays locked even if the user closes
// and reopens the tab.
//
// Storage shape:
//   imo_lock = { locked: bool, pinHash: string|null, lockedAt: ms,
//                idleMins: number, enabled: bool }
//
// Why a hash instead of plaintext PIN: nothing on a single-page app
// is genuinely secure (anyone with devtools can read localStorage),
// but storing the SHA-256 hash means a casual onlooker who spots
// the localStorage value can't read the PIN directly. This is a
// "deter casual access" feature, not a security boundary.
//
// Public exports:
//   LOCK_KEY        localStorage key.
//   loadLockState() Returns the persisted lock state (or defaults).
//   saveLockState(state)
//                   Persists.
//   hashPin(pin)    SHA-256 via SubtleCrypto. Returns hex string or
//                   null on failure. Async because SubtleCrypto.digest
//                   is promise-based.

import { appendAuditEntry } from './audit-log.js';

export const LOCK_KEY = 'imo_lock';

export const loadLockState = () => {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return { locked: false, pinHash: null, lockedAt: 0, idleMins: 5, enabled: false };
    const parsed = JSON.parse(raw);
    return {
      locked:    parsed.locked === true,
      pinHash:   parsed.pinHash ?? null,
      lockedAt:  parsed.lockedAt ?? 0,
      idleMins:  Number.isFinite(parsed.idleMins) ? parsed.idleMins : 5,
      enabled:   parsed.enabled === true,
    };
  } catch {
    return { locked: false, pinHash: null, lockedAt: 0, idleMins: 5, enabled: false };
  }
};

export const saveLockState = (state) => {
  // Capture the previous state for the audit trail before overwriting.
  const prev = loadLockState();
  try { localStorage.setItem(LOCK_KEY, JSON.stringify(state)); } catch {}
  // Audit: log the change. We capture a coarse delta — what changed and
  // whether it was a sensitive transition (enabled toggled, locked toggled,
  // or PIN changed). The pinHash field is intentionally NOT logged in
  // detail; we only log "pin set" / "pin removed".
  try {
    let action = 'updated';
    const detailDiff = [];
    if (prev.enabled !== state.enabled) {
      action = state.enabled ? 'enabled' : 'disabled';
    } else if (prev.locked !== state.locked) {
      action = state.locked ? 'locked' : 'unlocked';
    }
    if ((prev.pinHash || null) !== (state.pinHash || null)) {
      detailDiff.push(state.pinHash ? 'pin-set' : 'pin-removed');
    }
    if (prev.idleMins !== state.idleMins) {
      detailDiff.push(`idle-mins:${prev.idleMins}→${state.idleMins}`);
    }
    appendAuditEntry({
      category: 'lock',
      action,
      target: 'workspace',
      details: detailDiff.length ? detailDiff.join(',') : null,
    });
  } catch {}
};

export const hashPin = async (pin) => {
  if (!pin) return null;
  try {
    const enc = new TextEncoder().encode(String(pin));
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
};
