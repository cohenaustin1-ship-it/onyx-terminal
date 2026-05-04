// IMO Onyx Terminal — Settings sub-panels (lock + safety)
//
// Phase 3p.02 + 3p.03 + 3p.04 (file split, batches 14-16 — first
// SettingsPanel ecosystem batches). Four of the six settings sub-panels
// rendered inside the main SettingsPanel. Future batches will extract
// LlmSettingsPanel, BrokerSettingsPanel + BrokerPositionsView (need
// PROVIDER_X consts extracted first, ~700 lines), then SettingsPanel
// itself.
//
// These two land first because they're the most self-contained: their
// only cross-file deps are the lock-storage and safety-storage helper
// modules that ship in the same batch (3p.02).
//
// Public exports:
//   LockSettingsPanel
//     PIN hash + idle-lock-timer settings. Set/clear PIN via prompt
//     (rehashed via SubtleCrypto). Idle minutes selector. Manual "lock
//     now" button dispatches imo:lock-now CustomEvent.
//   SafetySettingsPanel
//     Order safety toggle + threshold + countdown. Inline audit log
//     of recent confirmations (capped at 100 entries). Listens for
//     imo:safety-audit-changed to refresh the audit view live.
//   NotificationPrefsPanel
//     Per-event channel preferences (signal_fired / order_filled /
//     stop_hit / pnl_threshold_crossed / morning_brief / system_alert
//     across web / telegram / email / discord / imessage). Persists
//     to the agent backend service when available, falls back to
//     localStorage. Added in 3p.03.
//   BackendServicesPanel
//     Live status + Test connection buttons for the 3 backend services
//     (executor, agent, snippets). Pulls from window.__imoBackend.
//     BackendAuthRow (internal helper, not exported) handles login/
//     logout against the executor's /auth/login JWT endpoint. Added
//     in 3p.04.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { COLORS } from '../lib/constants.js';
import { SettingsToggle } from './leaf-ui.jsx';
import { loadLockState, saveLockState, hashPin } from '../lib/lock-storage.js';
import {
  SAFETY_AUDIT_KEY,
  loadSafetyState,
  saveSafetyState,
  loadSafetyAudit,
} from '../lib/safety-storage.js';
import {
  loadAuditLog,
  filterAuditLog,
  exportAuditLogCSV,
  clearAuditLog,
  AUDIT_LOG_CAP,
} from '../lib/audit-log.js';

export const LockSettingsPanel = () => {
  const [state, setState] = useState(loadLockState);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [pinErr, setPinErr] = useState(null);

  const persist = (next) => {
    saveLockState(next);
    setState(next);
    try { window.dispatchEvent(new CustomEvent('imo:lock-state-changed')); } catch {}
  };

  const setEnabled = async (v) => {
    if (v && !state.pinHash) {
      // Need a PIN before we can enable. Open the PIN modal; the
      // toggle stays off until the PIN is set.
      setPinModalOpen(true);
      return;
    }
    persist({ ...state, enabled: v, locked: false });
  };

  const setIdleMins = (mins) => {
    persist({ ...state, idleMins: mins });
  };

  const submitPin = async () => {
    if (pin.length < 4 || pin.length > 6) {
      setPinErr('PIN must be 4 to 6 digits');
      return;
    }
    if (pin !== pin2) {
      setPinErr('PINs don\'t match');
      return;
    }
    const hash = await hashPin(pin);
    if (!hash) { setPinErr('Could not save PIN'); return; }
    persist({ ...state, pinHash: hash, enabled: true });
    setPinModalOpen(false);
    setPin(''); setPin2(''); setPinErr(null);
  };

  const removePin = () => {
    if (typeof window !== 'undefined' && window.confirm) {
      const ok = window.confirm('Remove your workspace PIN? The lock feature will be disabled.');
      if (!ok) return;
    }
    persist({ ...state, pinHash: null, enabled: false, locked: false });
  };

  const lockNow = () => {
    if (!state.pinHash) {
      setPinModalOpen(true);
      return;
    }
    try { window.dispatchEvent(new CustomEvent('imo:lock-now')); } catch {}
  };

  return (
    <div>
      <SettingsToggle
        label="Lock workspace when idle"
        sub="Hide your screen behind a PIN prompt after a period of inactivity. Off by default."
        value={state.enabled === true}
        onChange={setEnabled}
      />
      {/* Idle timeout selector — only meaningful when lock is on */}
      <div className="rounded-md border p-3 mb-2"
           style={{ borderColor: COLORS.border, background: COLORS.bg, opacity: state.enabled ? 1 : 0.55 }}>
        <div className="text-[11px] mb-2" style={{ color: COLORS.textDim }}>
          Idle timeout
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {[1, 5, 10, 30].map(m => (
            <button key={m} type="button"
                    disabled={!state.enabled}
                    onClick={() => setIdleMins(m)}
                    className="px-2.5 py-1 rounded text-[11.5px] transition-colors"
                    style={{
                      background: state.idleMins === m ? COLORS.mint : 'transparent',
                      color:      state.idleMins === m ? COLORS.bg : COLORS.textDim,
                      border:    `1px solid ${state.idleMins === m ? COLORS.mint : COLORS.border}`,
                    }}>
              {m} min
            </button>
          ))}
        </div>
        <div className="text-[10px] mt-2" style={{ color: COLORS.textMute }}>
          Manual lock: Cmd/Ctrl + L · or click "Lock now" below
        </div>
      </div>
      {/* PIN management + Lock now */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
        <button type="button"
                onClick={() => setPinModalOpen(true)}
                className="px-3 py-2 rounded-md text-[11.5px] transition-colors hover:bg-white/[0.04]"
                style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
          {state.pinHash ? 'Change PIN' : 'Set PIN'}
        </button>
        <button type="button"
                onClick={removePin}
                disabled={!state.pinHash}
                className="px-3 py-2 rounded-md text-[11.5px] transition-colors hover:bg-white/[0.04] disabled:opacity-30"
                style={{ background: COLORS.surface, color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
          Remove PIN
        </button>
        <button type="button"
                onClick={lockNow}
                disabled={!state.enabled || !state.pinHash}
                className="px-3 py-2 rounded-md text-[11.5px] font-medium transition-colors hover:opacity-90 disabled:opacity-30"
                style={{ background: COLORS.mint, color: COLORS.bg }}>
          Lock now
        </button>
      </div>
      {/* PIN set/change modal */}
      {pinModalOpen && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center"
             style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
             onClick={() => { setPinModalOpen(false); setPin(''); setPin2(''); setPinErr(null); }}>
          <div className="rounded-md border p-5 w-[320px]"
               style={{ background: COLORS.surface, borderColor: COLORS.borderHi, color: COLORS.text }}
               onClick={(e) => e.stopPropagation()}>
            <div className="text-[14px] font-medium mb-1">
              {state.pinHash ? 'Change PIN' : 'Set workspace PIN'}
            </div>
            <div className="text-[11px] mb-4" style={{ color: COLORS.textMute }}>
              4–6 digits. Locally stored as a SHA-256 hash; the plain
              PIN never leaves your browser.
            </div>
            <input type="password" inputMode="numeric"
                   value={pin}
                   onChange={(e) => { setPin((e.target.value ?? '').replace(/\D/g, '').slice(0, 6)); setPinErr(null); }}
                   placeholder="New PIN"
                   className="w-full px-3 py-2 rounded text-[13px] outline-none mb-2 tabular-nums"
                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                   autoFocus />
            <input type="password" inputMode="numeric"
                   value={pin2}
                   onChange={(e) => { setPin2((e.target.value ?? '').replace(/\D/g, '').slice(0, 6)); setPinErr(null); }}
                   onKeyDown={(e) => { if (e.key === 'Enter') submitPin(); }}
                   placeholder="Confirm PIN"
                   className="w-full px-3 py-2 rounded text-[13px] outline-none mb-2 tabular-nums"
                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            {pinErr && (
              <div className="text-[11px] mb-2" style={{ color: COLORS.red }}>{pinErr}</div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <button type="button"
                      onClick={() => { setPinModalOpen(false); setPin(''); setPin2(''); setPinErr(null); }}
                      className="flex-1 py-2 rounded text-[11.5px]"
                      style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                Cancel
              </button>
              <button type="button"
                      onClick={submitPin}
                      disabled={pin.length < 4 || pin2.length < 4}
                      className="flex-1 py-2 rounded text-[11.5px] font-medium disabled:opacity-30"
                      style={{ background: COLORS.mint, color: COLORS.bg }}>
                Save PIN
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const SafetySettingsPanel = () => {
  const [state, setState] = useState(loadSafetyState);
  const [audit, setAudit] = useState(loadSafetyAudit);
  useEffect(() => {
    const refresh = () => { setState(loadSafetyState()); setAudit(loadSafetyAudit()); };
    window.addEventListener('imo:safety-state-changed', refresh);
    window.addEventListener('imo:safety-audit-changed', refresh);
    return () => {
      window.removeEventListener('imo:safety-state-changed', refresh);
      window.removeEventListener('imo:safety-audit-changed', refresh);
    };
  }, []);
  const persist = (patch) => {
    const next = { ...state, ...patch };
    setState(next);
    saveSafetyState(next);
  };
  const clearAudit = () => {
    if (typeof window !== 'undefined' && window.confirm) {
      const ok = window.confirm('Clear the safety audit log? This can\'t be undone.');
      if (!ok) return;
    }
    try {
      localStorage.removeItem(SAFETY_AUDIT_KEY);
      setAudit([]);
      window.dispatchEvent(new CustomEvent('imo:safety-audit-changed'));
    } catch {}
  };
  const fmtUsd = (n) => Number.isFinite(n)
    ? '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
    : '—';
  const fmtTime = (ts) => {
    try {
      const d = new Date(ts);
      return d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  };
  return (
    <div>
      <SettingsToggle
        label="Confirm large orders"
        sub="Require an explicit confirm step for orders above the threshold below. Helps prevent fat-finger mistakes and stops AI agents from placing oversized trades without your approval."
        value={state.enabled === true}
        onChange={(v) => persist({ enabled: v })}
      />
      <div className="rounded-md border p-3 mb-2"
           style={{ borderColor: COLORS.border, background: COLORS.bg, opacity: state.enabled ? 1 : 0.55 }}>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-[10.5px] uppercase tracking-wider mb-1.5 block"
                   style={{ color: COLORS.textMute }}>
              Threshold (USD)
            </label>
            <div className="flex items-center rounded"
                 style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
              <span className="px-2 text-[11.5px]" style={{ color: COLORS.textMute }}>$</span>
              <input type="number" min="0" step="100"
                     disabled={!state.enabled}
                     value={state.thresholdUsd}
                     onChange={(e) => {
                       const v = parseFloat(e.target.value);
                       persist({ thresholdUsd: Number.isFinite(v) && v >= 0 ? v : 0 });
                     }}
                     className="flex-1 px-1 py-1.5 bg-transparent text-[12.5px] outline-none tabular-nums"
                     style={{ color: COLORS.text }} />
            </div>
            <div className="text-[10px] mt-1" style={{ color: COLORS.textMute }}>
              Orders ≥ this notional require confirm.
            </div>
          </div>
          <div>
            <label className="text-[10.5px] uppercase tracking-wider mb-1.5 block"
                   style={{ color: COLORS.textMute }}>
              Confirm countdown
            </label>
            <div className="flex items-center gap-1">
              {[0, 2, 3, 5].map(s => (
                <button key={s} type="button"
                        disabled={!state.enabled}
                        onClick={() => persist({ countdownSec: s })}
                        className="flex-1 px-2 py-1.5 rounded text-[11.5px] transition-colors"
                        style={{
                          background: state.countdownSec === s ? COLORS.mint : 'transparent',
                          color:      state.countdownSec === s ? COLORS.bg : COLORS.textDim,
                          border:    `1px solid ${state.countdownSec === s ? COLORS.mint : COLORS.border}`,
                        }}>
                  {s === 0 ? 'None' : `${s}s`}
                </button>
              ))}
            </div>
            <div className="text-[10px] mt-1" style={{ color: COLORS.textMute }}>
              How long Confirm stays disabled. Foils muscle-memory clicks.
            </div>
          </div>
        </div>
        <SettingsToggle
          label="Confirm every order"
          sub="Show the prompt for ALL orders, not just large ones. Useful when training the habit; turn off later."
          value={state.confirmAll === true}
          onChange={(v) => persist({ confirmAll: v })}
        />
      </div>
      {/* Audit log */}
      <div className="rounded-md border"
           style={{ borderColor: COLORS.border, background: COLORS.bg }}>
        <div className="flex items-center justify-between px-3 py-2 border-b"
             style={{ borderColor: COLORS.border }}>
          <div className="text-[11px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
            Audit log
            <span className="ml-1.5" style={{ color: COLORS.textDim }}>· {audit.length}</span>
          </div>
          {audit.length > 0 && (
            <button type="button" onClick={clearAudit}
                    className="text-[10.5px] hover:underline"
                    style={{ color: COLORS.textDim }}>
              Clear
            </button>
          )}
        </div>
        {audit.length === 0 ? (
          <div className="px-3 py-4 text-[11.5px]" style={{ color: COLORS.textMute }}>
            No audit entries yet. Place an order to see this populate.
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {audit.slice(0, 30).map((e, i) => (
              <div key={i}
                   className="flex items-center justify-between gap-2 px-3 py-1.5 border-b"
                   style={{ borderColor: COLORS.border }}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="rounded-full shrink-0"
                        style={{
                          width: 6, height: 6,
                          background: e.decision === 'confirmed' ? COLORS.green
                                    : e.decision === 'cancelled' ? COLORS.red
                                    : COLORS.textMute,
                        }} />
                  <span className="text-[11px] tabular-nums" style={{ color: COLORS.textDim }}>
                    {fmtTime(e.ts)}
                  </span>
                  <span className="text-[11.5px] truncate" style={{ color: COLORS.text }}>
                    {(e.side ?? '').toUpperCase()} {e.instrument} · {fmtUsd(e.notional)}
                  </span>
                </div>
                <span className="text-[10px] uppercase tracking-wider shrink-0"
                      style={{
                        color: e.decision === 'confirmed' ? COLORS.green
                             : e.decision === 'cancelled' ? COLORS.red
                             : COLORS.textMute,
                      }}>
                  {e.decision === 'auto-pass'
                    ? (e.kind === 'feature-off' ? 'gate off' : 'below thresh')
                    : e.decision}
                </span>
              </div>
            ))}
            {audit.length > 30 && (
              <div className="px-3 py-2 text-[10.5px] text-center"
                   style={{ color: COLORS.textMute }}>
                {audit.length - 30} more not shown · log capped at 100
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Per-event channel preferences. Persists to the agent service when
// available, otherwise to localStorage.
export const NotificationPrefsPanel = ({ user }) => {
  const userId = user?.username || 'default';
  const [prefs, setPrefs] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const events = [
    { id: 'signal_fired',          label: 'Strategy signal fired' },
    { id: 'order_filled',          label: 'Order filled' },
    { id: 'stop_hit',              label: 'Stop loss hit' },
    { id: 'pnl_threshold_crossed', label: 'P&L threshold crossed' },
    { id: 'morning_brief',         label: 'Morning brief (8:30 ET)' },
    { id: 'system_alert',          label: 'System alerts' },
  ];
  const channels = ['web', 'telegram', 'email', 'discord', 'imessage'];
  useEffect(() => {
    (async () => {
      const be = window.__imoBackend;
      if (be?.urls?.zeroclaw && be?.status?.zeroclaw === 'connected') {
        try {
          const r = await be.get('zeroclaw', `/users/${encodeURIComponent(userId)}/prefs`);
          setPrefs(r);
          setLoaded(true);
          return;
        } catch {}
      }
      // Fallback — localStorage
      try {
        const saved = localStorage.getItem(`imo_notif_prefs_${userId}`);
        if (saved) { setPrefs(JSON.parse(saved)); setLoaded(true); return; }
      } catch {}
      // Default
      const defaults = {};
      for (const e of events) {
        defaults[e.id] = {
          enabled: e.id === 'signal_fired' || e.id === 'order_filled' || e.id === 'system_alert',
          channels: ['web'],
        };
      }
      setPrefs(defaults);
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  const persist = async (next) => {
    setPrefs(next);
    setSaving(true);
    const be = window.__imoBackend;
    if (be?.urls?.zeroclaw && be?.status?.zeroclaw === 'connected') {
      try {
        await be.post('zeroclaw', `/users/${encodeURIComponent(userId)}/prefs`, next, { method: 'PATCH' });
      } catch {}
    }
    try { localStorage.setItem(`imo_notif_prefs_${userId}`, JSON.stringify(next)); } catch {}
    setSaving(false);
  };
  if (!loaded) return <div className="text-[11px]" style={{ color: COLORS.textMute }}>Loading…</div>;
  return (
    <div className="rounded-md border p-3 mb-2.5"
         style={{ borderColor: COLORS.border, background: COLORS.bg }}>
      <div className="text-[10.5px] mb-2.5" style={{ color: COLORS.textMute }}>
        {saving ? 'Saving…' : 'Configure where each event type is delivered. Web works without backend; other channels require the agent service.'}
      </div>
      {events.map(e => {
        const p = prefs[e.id] || { enabled: false, channels: [] };
        return (
          <div key={e.id} className="py-2 border-b last:border-b-0" style={{ borderColor: COLORS.border }}>
            <div className="flex items-center justify-between">
              <span className="text-[12px]" style={{ color: COLORS.text }}>{e.label}</span>
              <button onClick={() => persist({ ...prefs, [e.id]: { ...p, enabled: !p.enabled } })}
                      className="px-2 py-0.5 rounded text-[10.5px] font-medium transition-colors"
                      style={{
                        background: p.enabled ? COLORS.mint : 'transparent',
                        color: p.enabled ? '#FFF' : COLORS.textMute,
                        border: `1px solid ${p.enabled ? COLORS.mint : COLORS.border}`,
                      }}>
                {p.enabled ? 'On' : 'Off'}
              </button>
            </div>
            {p.enabled && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {channels.map(c => {
                  const active = p.channels.includes(c);
                  return (
                    <button key={c}
                            onClick={() => {
                              const nextChannels = active
                                ? p.channels.filter(x => x !== c)
                                : [...p.channels, c];
                              persist({ ...prefs, [e.id]: { ...p, channels: nextChannels } });
                            }}
                            className="px-2 py-0.5 rounded text-[10px] transition-colors"
                            style={{
                              background: active ? 'rgba(61,123,255,0.12)' : 'transparent',
                              color: active ? COLORS.mint : COLORS.textMute,
                              border: `1px solid ${active ? COLORS.mint : COLORS.border}`,
                            }}>
                      {c}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// Mint or revoke a JWT against the executor's /auth/login endpoint.
// When signed in, all backend calls use the JWT instead of the legacy
// shared bearer. Honest scope: this is a username-only login skeleton —
// production deployments would replace with Clerk/Supabase Auth.
const BackendAuthRow = ({ be }) => {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const tokenSource = be?.tokenSource || 'none';
  const hasJwt = be?.hasJwt;
  if (!be?.urls?.executor) return null;
  const handleSignIn = async () => {
    if (!username.trim()) return;
    setBusy(true); setErr(null);
    try {
      await be.login({ username: username.trim(), service: 'executor' });
      setUsername('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pt-2.5 mt-1 border-t" style={{ borderColor: COLORS.border }}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] font-medium" style={{ color: COLORS.text }}>
          Backend session
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: COLORS.bg,
                color: tokenSource === 'jwt' ? COLORS.green
                     : tokenSource === 'legacy' ? '#FFB84D'
                     : COLORS.textMute,
              }}>
          {tokenSource}
        </span>
      </div>
      {hasJwt ? (
        <button onClick={() => be.logout()}
                className="w-full px-2.5 py-1 rounded text-[10.5px] hover:bg-white/[0.04]"
                style={{ color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
          Sign out
        </button>
      ) : (
        <div className="flex gap-1.5">
          <input value={username}
                 onChange={e => setUsername(e.target.value)}
                 placeholder="username"
                 onKeyDown={e => e.key === 'Enter' && handleSignIn()}
                 className="flex-1 px-2 py-1 rounded text-[11px] outline-none"
                 style={{
                   background: COLORS.bg,
                   color: COLORS.text,
                   border: `1px solid ${COLORS.border}`,
                 }} />
          <button onClick={handleSignIn}
                  disabled={busy || !username.trim()}
                  className="px-2.5 py-1 rounded text-[10.5px] font-medium hover:opacity-90 disabled:opacity-50"
                  style={{ background: COLORS.mint, color: '#FFF' }}>
            {busy ? '…' : 'Sign in'}
          </button>
        </div>
      )}
      {err && (
        <div className="text-[10px] mt-1" style={{ color: COLORS.red }}>{err}</div>
      )}
      <div className="text-[10px] mt-1.5" style={{ color: COLORS.textMute }}>
        {hasJwt
          ? 'JWT stored locally — all backend calls now use it'
          : 'Skeleton login — username only, no password yet (replace with Clerk for prod)'}
      </div>
    </div>
  );
};

export const BackendServicesPanel = () => {
  const [tick, setTick] = useState(0);
  const [testing, setTesting] = useState({});
  const [results, setResults] = useState({});
  useEffect(() => {
    const handler = () => setTick(t => t + 1);
    window.addEventListener('imo:backend-status', handler);
    const interval = setInterval(handler, 5000); // reflect status changes
    return () => { window.removeEventListener('imo:backend-status', handler); clearInterval(interval); };
  }, []);
  const be = (typeof window !== 'undefined') ? window.__imoBackend : null;
  const services = [
    { id: 'tick',     label: 'Tick ingestion',  desc: 'Market data cache + WebSocket fan-out' },
    { id: 'executor', label: 'Strategy executor', desc: 'Cron-driven strategy runs + audit trail' },
    { id: 'zeroclaw', label: 'Agent gateway',   desc: 'LLM proxy + Telegram + tool calling' },
  ];
  const test = async (id) => {
    if (!be) return;
    setTesting(t => ({ ...t, [id]: true }));
    try {
      const r = await be.get(id, '/health', { skipAuth: true, timeout: 4000 });
      setResults(rs => ({ ...rs, [id]: { ok: true, msg: r.service || 'OK' } }));
    } catch (e) {
      setResults(rs => ({ ...rs, [id]: { ok: false, msg: e.message } }));
    } finally {
      setTesting(t => ({ ...t, [id]: false }));
    }
  };
  return (
    <div className="rounded-md border p-3 space-y-2.5"
         style={{ borderColor: COLORS.border, background: COLORS.bg }}>
      {services.map(s => {
        const status = be?.status?.[s.id] || 'unconfigured';
        const url = be?.urls?.[s.id] || '';
        const tone = status === 'connected' ? COLORS.green
                   : status === 'connecting' ? '#FFB84D'
                   : status === 'down' ? COLORS.red
                   : COLORS.textMute;
        const lastSeen = be?.lastSeen?.[s.id];
        const result = results[s.id];
        return (
          <div key={s.id} className="flex items-start gap-3 py-1">
            <span className="rounded-full mt-1.5"
                  style={{ width: 8, height: 8, background: tone, flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-medium" style={{ color: COLORS.text }}>
                {s.label} <span className="ml-1 text-[10.5px] font-normal" style={{ color: tone }}>· {status}</span>
              </div>
              <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textMute }}>{s.desc}</div>
              <div className="text-[10px] mt-1 font-mono truncate" style={{ color: COLORS.textDim }}>
                {url || 'Not configured · set VITE_' + (s.id === 'tick' ? 'TICK_API_URL' : s.id === 'executor' ? 'EXECUTOR_API_URL' : 'ZEROCLAW_GATEWAY_URL')}
              </div>
              {lastSeen && (
                <div className="text-[10px]" style={{ color: COLORS.textMute }}>
                  Last seen: {new Date(lastSeen).toLocaleTimeString()}
                </div>
              )}
              {result && (
                <div className="text-[10.5px] mt-1" style={{ color: result.ok ? COLORS.green : COLORS.red }}>
                  {result.ok ? '✓' : '✗'} {result.msg}
                </div>
              )}
            </div>
            <button onClick={() => test(s.id)}
                    disabled={!url || testing[s.id]}
                    className="px-2.5 py-1 rounded text-[10.5px] transition-colors hover:bg-white/[0.04]"
                    style={{
                      color: COLORS.text,
                      border: `1px solid ${COLORS.border}`,
                      opacity: !url ? 0.5 : 1,
                    }}>
              {testing[s.id] ? '…' : 'Test'}
            </button>
          </div>
        );
      })}
      {/* JWT auth row */}
      <BackendAuthRow be={be} />
    </div>
  );
};


// ─── CompliancePanel (Phase 3p.05) ─────────────────────────────────────────
// Unified audit log viewer + filters + CSV export. Powered by the
// audit-log lib module which captures changes from lock-storage,
// safety-storage, broker-storage automatically. Entries are also
// pushed by callers explicitly for order events.
//
// The panel:
//   - Lists most recent 200 entries with category/action/target/time
//   - Filters by category + free-text search
//   - Lets the user export full log to CSV (RFC 4180-compliant)
//   - Lets the user clear the log (with confirmation)

const AUDIT_CATEGORIES = ['all', 'order', 'settings', 'auth', 'lock', 'broker', 'system'];

const formatAuditTs = (ts) => {
  if (!Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  // YYYY-MM-DD HH:MM:SS local
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const summarizeAuditDetails = (e) => {
  if (e.details === null || e.details === undefined) return '';
  if (typeof e.details === 'string') return e.details;
  // Object — try the most useful fields
  if (typeof e.details === 'object') {
    const keys = Object.keys(e.details);
    if (keys.length === 0) return '';
    return keys.slice(0, 3).map(k => `${k}=${JSON.stringify(e.details[k])}`).join(' ');
  }
  return String(e.details);
};

export const CompliancePanel = () => {
  const [log, setLog] = useState(loadAuditLog);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');

  // Listen for live updates (order placements, settings changes, etc.)
  useEffect(() => {
    const refresh = () => setLog(loadAuditLog());
    window.addEventListener('imo:audit-log-changed', refresh);
    return () => window.removeEventListener('imo:audit-log-changed', refresh);
  }, []);

  const filtered = (() => {
    const q = { search: search.trim() || undefined };
    if (category !== 'all') q.category = category;
    return filterAuditLog(q).slice(0, 200);
  })();

  const downloadCsv = () => {
    const csv = exportAuditLogCSV();
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `imo-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[audit-log] export failed:', err);
    }
  };

  const handleClear = () => {
    if (!window.confirm(`Clear ${log.length} audit log entries? This cannot be undone.`)) return;
    clearAuditLog();
    setLog([]);
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[14px] font-medium" style={{ color: COLORS.text }}>Compliance audit log</div>
        <div className="text-[11px] mt-0.5" style={{ color: COLORS.textDim }}>
          Unified change log across orders, broker config, lock state, and safety settings.
          Capped at {AUDIT_LOG_CAP.toLocaleString()} most-recent entries · Exportable to CSV for review.
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="px-2 py-1 rounded text-[11px]"
                style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
          {AUDIT_CATEGORIES.map(c => (
            <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>
          ))}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
               placeholder="Search ticker, action, actor…"
               className="flex-1 min-w-[180px] px-2 py-1 rounded text-[11px] outline-none"
               style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
        <button onClick={downloadCsv}
                disabled={log.length === 0}
                className="px-2.5 py-1 rounded text-[11px] font-medium"
                style={{
                  background: log.length === 0 ? COLORS.surface : COLORS.mint,
                  color: log.length === 0 ? COLORS.textMute : COLORS.text,
                  border: `1px solid ${COLORS.border}`,
                  cursor: log.length === 0 ? 'not-allowed' : 'pointer',
                }}>
          Export CSV
        </button>
        <button onClick={handleClear}
                disabled={log.length === 0}
                className="px-2.5 py-1 rounded text-[11px]"
                style={{
                  background: 'transparent',
                  color: log.length === 0 ? COLORS.textMute : COLORS.red,
                  border: `1px solid ${COLORS.border}`,
                  cursor: log.length === 0 ? 'not-allowed' : 'pointer',
                }}>
          Clear log
        </button>
      </div>

      <div className="text-[10px]" style={{ color: COLORS.textMute }}>
        Showing {filtered.length} of {log.length} entries
        {filtered.length === 200 && log.length > 200 ? ' (most recent — narrow filters or export to see more)' : ''}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded p-4 text-center text-[11px]"
             style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
          {log.length === 0
            ? 'No audit events yet — actions you take will be logged here.'
            : 'No entries match your filters.'}
        </div>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: `1px solid ${COLORS.border}` }}>
          <div className="grid grid-cols-[150px_90px_1fr_120px] gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wider"
               style={{ background: COLORS.surface, color: COLORS.textMute, borderBottom: `1px solid ${COLORS.border}` }}>
            <div>Time</div>
            <div>Category</div>
            <div>Action / Target / Details</div>
            <div className="text-right">Actor</div>
          </div>
          <div className="max-h-[420px] overflow-auto" style={{ background: COLORS.bg }}>
            {filtered.map(e => (
              <div key={e.id}
                   className="grid grid-cols-[150px_90px_1fr_120px] gap-2 px-2 py-1.5 text-[11px] tabular-nums"
                   style={{ borderBottom: `1px solid ${COLORS.border}`, color: COLORS.text }}>
                <div style={{ color: COLORS.textDim }}>{formatAuditTs(e.ts)}</div>
                <div>
                  <span className="px-1.5 py-0.5 rounded text-[9.5px] uppercase tracking-wider"
                        style={{ background: COLORS.surface, color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                    {e.category}
                  </span>
                </div>
                <div>
                  <span style={{ color: COLORS.text }}>{e.action}</span>
                  {e.target ? (
                    <span style={{ color: COLORS.textMute }}> · {e.target}</span>
                  ) : null}
                  {(e.details || e.prev || e.next) ? (
                    <span style={{ color: COLORS.textMute }}> · {summarizeAuditDetails(e)}</span>
                  ) : null}
                </div>
                <div className="text-right" style={{ color: COLORS.textMute }}>
                  {e.actor ?? 'system'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};


// ─── TaxReportingPanel (Phase 3p.08) ───────────────────────────────────
// 1099-B / Schedule D export. Reads paper-account trades from the
// active account and produces IRS-style tax reports for download.
//
// Honest scope (also documented in tax-reporting.js):
//   - Wash sale detection is NOT implemented — module returns code=''
//     and washSaleAdj=0 for every row. A tax pro should review.
//   - Cost-basis adjustments for splits / corp actions not handled.
//   - Section 1256 mark-to-market for futures not handled.
//   - State reporting not handled.
import {
  buildTaxLotReport,
  exportSchedule1099B,
  exportScheduleD,
  filterByTaxYear,
} from '../lib/tax-reporting.js';
import { appendAuditEntry } from '../lib/audit-log.js';

const fmtUsd = (n) => {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const downloadCsv = (filename, csvBody) => {
  try {
    const blob = new Blob([csvBody], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[tax-export] download failed:', err);
  }
};

export const TaxReportingPanel = ({ trades = [] }) => {
  // Available tax years derived from the trade dates (sales only)
  const fullReport = buildTaxLotReport(trades);
  const availableYears = (() => {
    const ys = new Set(fullReport.rows.map(r => +r.soldDate.slice(0, 4)));
    return Array.from(ys).filter(y => Number.isFinite(y)).sort((a, b) => b - a);
  })();
  const defaultYear = availableYears[0] ?? new Date().getFullYear();

  const [year, setYear] = useState(defaultYear);
  const yearReport = filterByTaxYear(fullReport, year);

  const handle1099B = () => {
    const csv = exportSchedule1099B(yearReport);
    downloadCsv(`imo-1099b-${year}.csv`, csv);
    try {
      appendAuditEntry({
        category: 'system', action: 'tax-1099b-exported', target: String(year),
        details: { rows: yearReport.summary.total.count, totalGain: yearReport.summary.total.gain },
      });
    } catch {}
  };
  const handleScheduleD = () => {
    const csv = exportScheduleD(yearReport);
    downloadCsv(`imo-schedule-d-${year}.csv`, csv);
    try {
      appendAuditEntry({
        category: 'system', action: 'tax-schedule-d-exported', target: String(year),
        details: {
          shortGain: yearReport.summary.short.gain,
          longGain:  yearReport.summary.long.gain,
          totalGain: yearReport.summary.total.gain,
        },
      });
    } catch {}
  };

  const summary = yearReport.summary;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[14px] font-medium" style={{ color: COLORS.text }}>Tax reporting</div>
        <div className="text-[11px] mt-0.5" style={{ color: COLORS.textDim }}>
          IRS-style 1099-B and Schedule D export for paper-account trades.
          Long-term = held over 1 year. <strong>Wash sale detection covers within-account substantially-identical
          replacements within 30 days</strong> (per IRS Pub 550) — not cross-account or corporate-action adjustments.
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[11px]" style={{ color: COLORS.textDim }}>Tax year</label>
        <select value={year} onChange={(e) => setYear(+e.target.value)}
                disabled={availableYears.length === 0}
                className="px-2 py-1 rounded text-[11px]"
                style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
          {availableYears.length === 0 ? (
            <option value={defaultYear}>{defaultYear} (no trades)</option>
          ) : availableYears.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button onClick={handle1099B}
                disabled={summary.total.count === 0}
                className="px-2.5 py-1 rounded text-[11px] font-medium"
                style={{
                  background: summary.total.count === 0 ? COLORS.surface : COLORS.mint,
                  color:      summary.total.count === 0 ? COLORS.textMute : COLORS.text,
                  border:     `1px solid ${COLORS.border}`,
                  cursor:     summary.total.count === 0 ? 'not-allowed' : 'pointer',
                }}>
          Export 1099-B CSV
        </button>
        <button onClick={handleScheduleD}
                disabled={summary.total.count === 0}
                className="px-2.5 py-1 rounded text-[11px]"
                style={{
                  background: 'transparent',
                  color:      summary.total.count === 0 ? COLORS.textMute : COLORS.text,
                  border:     `1px solid ${COLORS.border}`,
                  cursor:     summary.total.count === 0 ? 'not-allowed' : 'pointer',
                }}>
          Export Schedule D CSV
        </button>
      </div>

      {summary.total.count === 0 ? (
        <div className="rounded p-4 text-center text-[11px]"
             style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
          No closed lots in {year}. Open and close positions to generate tax-reportable round-trips.
        </div>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: `1px solid ${COLORS.border}` }}>
          <div className="grid grid-cols-[100px_60px_110px_110px_110px] gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wider"
               style={{ background: COLORS.surface, color: COLORS.textMute, borderBottom: `1px solid ${COLORS.border}` }}>
            <div>Term</div>
            <div className="text-right">Count</div>
            <div className="text-right">Proceeds</div>
            <div className="text-right">Cost basis</div>
            <div className="text-right">Gain / loss</div>
          </div>
          {[
            { label: 'Short-term', s: summary.short },
            { label: 'Long-term',  s: summary.long },
            { label: 'Total',      s: summary.total, bold: true },
          ].map((row, i) => (
            <div key={i}
                 className="grid grid-cols-[100px_60px_110px_110px_110px] gap-2 px-2 py-1.5 text-[11px] tabular-nums"
                 style={{
                   borderBottom: `1px solid ${COLORS.border}`,
                   color: COLORS.text,
                   fontWeight: row.bold ? 600 : 400,
                 }}>
              <div>{row.label}</div>
              <div className="text-right" style={{ color: COLORS.textDim }}>{row.s.count}</div>
              <div className="text-right">{fmtUsd(row.s.proceeds)}</div>
              <div className="text-right">{fmtUsd(row.s.basis)}</div>
              <div className="text-right" style={{
                color: row.s.gain > 0 ? COLORS.green : row.s.gain < 0 ? COLORS.red : COLORS.text,
              }}>
                {fmtUsd(row.s.gain)}
              </div>
            </div>
          ))}
        </div>
      )}

      {summary.total.washSaleAdj > 0 && (
        <div className="rounded p-2.5 text-[11px] leading-relaxed"
             style={{
               background: COLORS.surface,
               border: `1px solid ${COLORS.border}`,
               color: COLORS.text,
             }}>
          <div className="font-medium mb-1" style={{ color: COLORS.text }}>
            ⚠ Wash sale adjustment
          </div>
          <div style={{ color: COLORS.textDim }}>
            {fmtUsd(summary.total.washSaleAdj)} of losses disallowed in {year} due to
            substantially-identical replacement purchases within 30 days.
            <br />
            <span style={{ color: COLORS.text }}>
              Recognized gain after wash: {fmtUsd(summary.total.gainAfterWash)}
            </span>
            <span style={{ color: COLORS.textMute }}> (vs raw gain {fmtUsd(summary.total.gain)})</span>
          </div>
        </div>
      )}

      {summary.total.count > 0 && (
        <div className="text-[10px] leading-relaxed" style={{ color: COLORS.textMute }}>
          {summary.total.count} closed lot{summary.total.count === 1 ? '' : 's'} for {year}.
          The 1099-B export includes per-lot rows; Schedule D summarizes by holding period.
          Wash sale detection covers substantially-identical replacements within 30 days
          (per IRS Pub 550). Cross-account wash sales and corporate-action basis
          adjustments are not handled — review with a tax professional.
        </div>
      )}
    </div>
  );
};


// ─── TLHRecommendationsPanel (Phase 3p.10) ─────────────────────────────
// Tax-loss harvesting recommender. Companion to the wash-sale
// detection from 3p.09.
//
// Inputs (from monolith):
//   positions    — current open equity positions { sym, qty, avgCost, mark }
//   recentTrades — last ~60 days of trades for wash-sale guard
//
// What it does:
//   - Surfaces every position trading at a loss above the $100 threshold
//   - Suggests acceptable replacement tickers from TLH_SWAP_MAP
//   - Estimates tax savings at common bracket points (22%, 32%, 15%, 20%)
//   - Warns when a recent buy of a substantially-identical security
//     would block harvesting (the planned sale would itself be a wash sale)
//   - Tells the user the safe re-buy date for the original (sale + 31 days)
import {
  buildTLHRecommendations,
} from '../lib/tlh-recommender.js';

export const TLHRecommendationsPanel = ({ positions = [], recentTrades = [] }) => {
  // Heuristic: extract simple { sym, qty, avgCost, mark } from the
  // monolith's position shape. Different code paths use different
  // shapes, so we accept either avgCost or entry, and qty or size.
  const normalized = positions.map(p => ({
    sym:     p.sym ?? p.symbol ?? p.id,
    qty:     Number(p.qty ?? p.size ?? p.shares ?? 0),
    avgCost: Number(p.avgCost ?? p.entry ?? p.entryPrice ?? p.costBasis ?? 0),
    mark:    Number(p.mark ?? p.price ?? 0),
  })).filter(p => p.sym && p.qty > 0 && p.avgCost > 0 && p.mark > 0);

  const result = buildTLHRecommendations({ positions: normalized, recentTrades });
  const { recommendations, summary } = result;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[14px] font-medium" style={{ color: COLORS.text }}>Tax-loss harvesting</div>
        <div className="text-[11px] mt-0.5" style={{ color: COLORS.textDim }}>
          Identifies open positions trading at a loss and suggests <strong>not-substantially-identical</strong> replacements
          so you can realize the deduction without triggering a wash sale (per IRS Pub 550).
          Threshold: $100 minimum loss.
        </div>
      </div>

      {recommendations.length === 0 ? (
        <div className="rounded p-4 text-center text-[11px]"
             style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
          No harvestable losses ≥ $100 in your current positions. Nothing to do — your portfolio is either profitable or below the threshold.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded p-2.5" style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Candidates</div>
              <div className="text-[18px] font-medium tabular-nums" style={{ color: COLORS.text }}>{summary.candidateCount}</div>
            </div>
            <div className="rounded p-2.5" style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Total harvestable</div>
              <div className="text-[18px] font-medium tabular-nums" style={{ color: COLORS.red }}>{fmtUsd(summary.totalHarvestable)}</div>
            </div>
            <div className="rounded p-2.5" style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Risky (recent buy)</div>
              <div className="text-[18px] font-medium tabular-nums"
                   style={{ color: summary.riskyCount > 0 ? COLORS.red : COLORS.textDim }}>
                {summary.riskyCount}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {recommendations.map((rec, i) => (
              <div key={`${rec.sym}-${i}`} className="rounded p-2.5"
                   style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <div className="flex items-baseline gap-2">
                    <div className="text-[14px] font-medium" style={{ color: COLORS.text }}>{rec.sym}</div>
                    <div className="text-[11px] tabular-nums" style={{ color: COLORS.textDim }}>
                      {rec.qty} sh @ {fmtUsd(rec.avgCost)} → {fmtUsd(rec.mark)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[14px] font-medium tabular-nums" style={{ color: COLORS.red }}>
                      {fmtUsd(-rec.harvestableLoss)}
                    </div>
                    <div className="text-[10px] tabular-nums" style={{ color: COLORS.textMute }}>
                      ({rec.pctLoss.toFixed(1)}%)
                    </div>
                  </div>
                </div>

                {rec.recentReplacementBuy && (
                  <div className="rounded p-1.5 mb-1.5 text-[11px]"
                       style={{ border: `1px solid ${COLORS.red}`, color: COLORS.red, background: 'transparent' }}>
                    ⚠ You bought {rec.recentReplacementBuy.sym} on{' '}
                    {new Date(rec.recentReplacementBuy.time).toLocaleDateString()} —
                    selling {rec.sym} now would be a wash sale. Wait until after the buy ages out of the 30-day window.
                  </div>
                )}

                {rec.hasCuratedSwap ? (
                  <div className="text-[11px]" style={{ color: COLORS.textDim }}>
                    <span style={{ color: COLORS.textMute }}>Replacements: </span>
                    {rec.candidates.slice(0, 6).map((c, j) => (
                      <span key={c.sym}>
                        <span style={{ color: COLORS.text }}>{c.sym}</span>
                        {j < Math.min(rec.candidates.length, 6) - 1 ? ', ' : ''}
                      </span>
                    ))}
                    {rec.candidates.length > 6 ? <span style={{ color: COLORS.textMute }}> + {rec.candidates.length - 6} more</span> : null}
                  </div>
                ) : (
                  <div className="text-[11px]" style={{ color: COLORS.textDim }}>
                    {rec.replacementNote}
                  </div>
                )}

                <div className="text-[10px] mt-1.5 flex items-center gap-3 flex-wrap"
                     style={{ color: COLORS.textMute }}>
                  <span>Estimated tax savings:</span>
                  <span><span style={{ color: COLORS.text }}>{fmtUsd(rec.estimatedTaxSavings.atShortTerm22)}</span> @22%</span>
                  <span><span style={{ color: COLORS.text }}>{fmtUsd(rec.estimatedTaxSavings.atShortTerm32)}</span> @32%</span>
                  <span><span style={{ color: COLORS.text }}>{fmtUsd(rec.estimatedTaxSavings.atLongTerm15)}</span> @15% LT</span>
                  <span style={{ color: COLORS.textDim }}>· Safe re-buy of {rec.sym}: {rec.safeRebuyDate}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="text-[10px] leading-relaxed" style={{ color: COLORS.textMute }}>
            "Substantially identical" is a judgment call by the IRS — the curated swap list reflects commonly-accepted alternatives but
            your CPA gets the final say. Estimated savings assume the loss offsets ordinary income at the named bracket;
            actual savings depend on your full return (other gains, carry-forwards, AMT, etc.).
          </div>
        </>
      )}
    </div>
  );
};


// ─── TradeJournalPanel + BrokerImportPanel (Phase 3p.11) ─────────────────
// Round out the tax/compliance feature set with two small panels:
//   - TradeJournalPanel: full audit-style trade log CSV export
//   - BrokerImportPanel: paste CSV from Schwab/Fidelity/Robinhood
import { exportTradeJournalCSV } from '../lib/trade-journal.js';
import { parseBrokerCSV } from '../lib/broker-import.js';
import { compareLotMethods } from '../lib/lot-methods.js';

export const TradeJournalPanel = ({ trades = [] }) => {
  const handleExport = () => {
    const csv = exportTradeJournalCSV(trades);
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `imo-trade-journal-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      try {
        appendAuditEntry({
          category: 'system', action: 'trade-journal-exported',
          details: { rows: trades.length },
        });
      } catch {}
    } catch {}
  };

  const lotComparison = compareLotMethods(trades);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[14px] font-medium" style={{ color: COLORS.text }}>Trade journal</div>
        <div className="text-[11px] mt-0.5" style={{ color: COLORS.textDim }}>
          Full audit-style CSV of every trade. Different from the 1099-B (closed lots only) and the
          audit log (app events). Suitable for compliance archive or hand-off to a CPA.
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={handleExport}
                disabled={trades.length === 0}
                className="px-2.5 py-1 rounded text-[11px] font-medium"
                style={{
                  background: trades.length === 0 ? COLORS.surface : COLORS.mint,
                  color:      trades.length === 0 ? COLORS.textMute : COLORS.text,
                  border:     `1px solid ${COLORS.border}`,
                  cursor:     trades.length === 0 ? 'not-allowed' : 'pointer',
                }}>
          Export Trade Journal CSV
        </button>
        <span className="text-[11px]" style={{ color: COLORS.textMute }}>
          {trades.length} trade{trades.length === 1 ? '' : 's'}
        </span>
      </div>

      {trades.length > 0 && (
        <div className="rounded p-2.5" style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
          <div className="text-[11px] font-medium mb-1.5" style={{ color: COLORS.text }}>
            Lot-selection method comparison
          </div>
          <div className="text-[10px] mb-1.5" style={{ color: COLORS.textDim }}>
            See how realized gain/loss changes by closing-method choice.
            Default is FIFO; HIFO often minimizes realized gains.
          </div>
          <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-1 text-[11px] tabular-nums">
            <div style={{ color: COLORS.textMute }}>Method</div>
            <div className="text-right" style={{ color: COLORS.textMute }}>Total realized</div>
            <div className="text-right" style={{ color: COLORS.textMute }}>Long-term</div>
            <div className="text-right" style={{ color: COLORS.textMute }}>Short-term</div>
            {[['FIFO', lotComparison.fifo], ['LIFO', lotComparison.lifo], ['HIFO', lotComparison.hifo]].map(([name, s]) => (
              <React.Fragment key={name}>
                <div style={{ color: COLORS.text }}>{name}</div>
                <div className="text-right" style={{ color: s.totalRealized > 0 ? COLORS.green : s.totalRealized < 0 ? COLORS.red : COLORS.text }}>
                  {fmtUsd(s.totalRealized)}
                </div>
                <div className="text-right" style={{ color: COLORS.textDim }}>{fmtUsd(s.longTermRealized)}</div>
                <div className="text-right" style={{ color: COLORS.textDim }}>{fmtUsd(s.shortTermRealized)}</div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const BrokerImportPanel = ({ onImport }) => {
  const [csvText, setCsvText] = useState('');
  const [result, setResult]   = useState(null);

  const handlePreview = () => {
    if (!csvText.trim()) {
      setResult({ error: 'Paste a CSV to preview.' });
      return;
    }
    try {
      const r = parseBrokerCSV(csvText, { warnOnSkip: true });
      setResult(r);
    } catch (err) {
      setResult({ error: String(err) });
    }
  };

  const handleImport = () => {
    if (!result || !result.trades || result.trades.length === 0) return;
    if (typeof onImport === 'function') onImport(result.trades);
    try {
      appendAuditEntry({
        category: 'system', action: 'broker-csv-imported',
        target: result.format,
        details: { count: result.trades.length, skipped: result.skipped?.length ?? 0 },
      });
    } catch {}
    setCsvText('');
    setResult(null);
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[14px] font-medium" style={{ color: COLORS.text }}>Broker CSV import</div>
        <div className="text-[11px] mt-0.5" style={{ color: COLORS.textDim }}>
          Paste an export from Schwab, Fidelity, or Robinhood to bring trades into IMO Onyx for unified
          tax reporting and wash-sale detection across accounts.
          Auto-detects format from the header row.
        </div>
      </div>
      <textarea value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder="Paste CSV here…"
                rows={6}
                className="w-full px-2 py-1.5 rounded text-[11px] font-mono outline-none"
                style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
      <div className="flex items-center gap-2">
        <button onClick={handlePreview}
                disabled={!csvText.trim()}
                className="px-2.5 py-1 rounded text-[11px]"
                style={{
                  background: 'transparent',
                  color:      !csvText.trim() ? COLORS.textMute : COLORS.text,
                  border:     `1px solid ${COLORS.border}`,
                  cursor:     !csvText.trim() ? 'not-allowed' : 'pointer',
                }}>
          Preview
        </button>
        <button onClick={handleImport}
                disabled={!result || !result.trades || result.trades.length === 0}
                className="px-2.5 py-1 rounded text-[11px] font-medium"
                style={{
                  background: !result?.trades?.length ? COLORS.surface : COLORS.mint,
                  color:      !result?.trades?.length ? COLORS.textMute : COLORS.text,
                  border:     `1px solid ${COLORS.border}`,
                  cursor:     !result?.trades?.length ? 'not-allowed' : 'pointer',
                }}>
          Import {result?.trades?.length ? `${result.trades.length} trades` : ''}
        </button>
      </div>
      {result?.error && (
        <div className="rounded p-2 text-[11px]" style={{ color: COLORS.red, border: `1px solid ${COLORS.border}` }}>
          {result.error}
        </div>
      )}
      {result?.trades && (
        <div className="rounded p-2.5 text-[11px]" style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.text }}>
          <div className="font-medium mb-1">Detected: {result.format}</div>
          <div style={{ color: COLORS.textDim }}>
            {result.trades.length} trade{result.trades.length === 1 ? '' : 's'} parsed
            {result.skipped?.length ? `, ${result.skipped.length} non-trade rows skipped` : ''}
          </div>
        </div>
      )}
    </div>
  );
};


// ─── HoldingsReconciliationPanel + CorporateActionsPanel (Phase 3p.13) ──
// Side-by-side multi-broker holdings + manual corporate-action entry.
import { buildHoldingsFromTrades, buildHoldingsReconciliation }
  from '../lib/holdings-recon.js';
import { applyCorporateActions, validateAction, ACTION_TYPES, COMMON_SPLIT_HISTORY }
  from '../lib/corporate-actions.js';

const RECON_PREFS_KEY = 'imo_recon_prefs';

const loadReconPrefs = () => {
  try {
    const raw = localStorage.getItem(RECON_PREFS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return typeof p === 'object' && p !== null ? p : {};
  } catch { return {}; }
};

const saveReconPrefs = (prefs) => {
  try { localStorage.setItem(RECON_PREFS_KEY, JSON.stringify(prefs)); } catch {}
};

export const HoldingsReconciliationPanel = ({ accounts = [], localTrades = [] }) => {
  // Derive computedFromTrades from in-app trade history (per-broker if
  // trades carry a broker tag, otherwise lumped under "paper").
  const computedFromTrades = useMemo(() => {
    if (!localTrades || localTrades.length === 0) return null;
    const byBroker = {};
    for (const t of localTrades) {
      const b = t.broker || 'paper';
      if (!byBroker[b]) byBroker[b] = [];
      byBroker[b].push(t);
    }
    const out = {};
    for (const b of Object.keys(byBroker)) {
      out[b] = buildHoldingsFromTrades(byBroker[b]);
    }
    return out;
  }, [localTrades]);

  const recon = useMemo(() =>
    buildHoldingsReconciliation({ accounts, computedFromTrades }),
    [accounts, computedFromTrades]);

  const { rows, summary, discrepancies } = recon;

  // ── User-controlled view state (Phase 3p.16) ─────────────────────
  // Persisted to localStorage as imo_recon_prefs.
  const initialPrefs = useMemo(() => loadReconPrefs(), []);
  const [columnOrder, setColumnOrder] = useState(() => {
    const stored = initialPrefs.columnOrder;
    if (Array.isArray(stored) && stored.every(s => summary.brokers.includes(s))) {
      // Append any new brokers that weren't in the stored order
      const missing = summary.brokers.filter(b => !stored.includes(b));
      return [...stored, ...missing];
    }
    return summary.brokers;
  });
  const [hiddenBrokers, setHiddenBrokers] = useState(
    new Set(Array.isArray(initialPrefs.hiddenBrokers) ? initialPrefs.hiddenBrokers : [])
  );
  const [discrepanciesOnly, setDiscrepanciesOnly] = useState(
    !!initialPrefs.discrepanciesOnly
  );

  // Sync columnOrder when brokers change (e.g. new account imported)
  useEffect(() => {
    setColumnOrder(prev => {
      const filtered = prev.filter(b => summary.brokers.includes(b));
      const missing = summary.brokers.filter(b => !filtered.includes(b));
      const next = [...filtered, ...missing];
      return next.length === prev.length && next.every((b, i) => b === prev[i])
           ? prev : next;
    });
  }, [summary.brokers.join('|')]);

  // Persist on any change
  useEffect(() => {
    saveReconPrefs({
      columnOrder,
      hiddenBrokers: Array.from(hiddenBrokers),
      discrepanciesOnly,
    });
  }, [columnOrder, hiddenBrokers, discrepanciesOnly]);

  // Effective brokers = columnOrder filtered by hiddenBrokers
  const visibleBrokers = useMemo(
    () => columnOrder.filter(b => !hiddenBrokers.has(b)),
    [columnOrder, hiddenBrokers]
  );

  // Set of symbols with at least one discrepancy
  const discrepancySymbols = useMemo(() => {
    const s = new Set();
    for (const d of discrepancies) s.add(d.sym);
    return s;
  }, [discrepancies]);

  const visibleRows = useMemo(() => {
    let list = rows;
    if (discrepanciesOnly) {
      list = list.filter(r => discrepancySymbols.has(r.sym));
    }
    return list;
  }, [rows, discrepanciesOnly, discrepancySymbols]);

  const toggleBrokerHidden = (b) => {
    setHiddenBrokers(prev => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
  };

  // Drag-and-drop column reorder via HTML5 native dnd
  const dragSrc = useRef(null);
  const onDragStart = (b) => (e) => {
    dragSrc.current = b;
    try { e.dataTransfer.effectAllowed = 'move'; } catch {}
  };
  const onDragOver = (b) => (e) => {
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch {}
  };
  const onDrop = (target) => (e) => {
    e.preventDefault();
    const src = dragSrc.current;
    dragSrc.current = null;
    if (!src || src === target) return;
    setColumnOrder(prev => {
      const next = prev.filter(b => b !== src);
      const idx = next.indexOf(target);
      if (idx < 0) return prev;
      next.splice(idx, 0, src);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[14px] font-medium" style={{ color: COLORS.text }}>Holdings reconciliation</div>
        <div className="text-[11px] mt-0.5" style={{ color: COLORS.textDim }}>
          Side-by-side view of positions across all configured brokers, with discrepancies between
          broker-reported holdings and trade-derived holdings flagged.
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded p-4 text-center text-[11px]"
             style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
          No holdings to reconcile. Import broker CSVs to get a multi-account view.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded p-2.5" style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Symbols</div>
              <div className="text-[18px] font-medium tabular-nums" style={{ color: COLORS.text }}>{summary.totalSymbols}</div>
            </div>
            <div className="rounded p-2.5" style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Total market value</div>
              <div className="text-[18px] font-medium tabular-nums" style={{ color: COLORS.text }}>{fmtUsd(summary.totalMarketValue)}</div>
            </div>
            <div className="rounded p-2.5" style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Multi-broker</div>
              <div className="text-[18px] font-medium tabular-nums" style={{ color: COLORS.text }}>{summary.multiBrokerSymbols}</div>
            </div>
            <div className="rounded p-2.5" style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Discrepancies</div>
              <div className="text-[18px] font-medium tabular-nums"
                   style={{ color: summary.majorDiscrepancyCount > 0 ? COLORS.red : COLORS.text }}>
                {summary.discrepancyCount}
              </div>
            </div>
          </div>

          {/* View controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 text-[11px]"
                   style={{ color: COLORS.text, cursor: 'pointer' }}>
              <input type="checkbox"
                     data-testid="discrepancies-only"
                     checked={discrepanciesOnly}
                     onChange={(e) => setDiscrepanciesOnly(e.target.checked)} />
              Show only discrepancies
              {discrepanciesOnly && discrepancySymbols.size > 0 && (
                <span style={{ color: COLORS.textMute }}>
                  ({discrepancySymbols.size} of {rows.length})
                </span>
              )}
            </label>
            <span className="text-[10px]" style={{ color: COLORS.textMute }}>·</span>
            <span className="text-[10px]" style={{ color: COLORS.textMute }}>Brokers:</span>
            {summary.brokers.map(b => {
              const hidden = hiddenBrokers.has(b);
              return (
                <button key={b}
                        onClick={() => toggleBrokerHidden(b)}
                        data-testid={`broker-toggle-${b}`}
                        className="px-1.5 py-0.5 rounded text-[10px]"
                        style={{
                          background: hidden ? 'transparent' : COLORS.mint,
                          color:      hidden ? COLORS.textMute : COLORS.bg,
                          border:     `1px solid ${hidden ? COLORS.border : COLORS.mint}`,
                          textDecoration: hidden ? 'line-through' : 'none',
                          cursor: 'pointer',
                        }}>
                  {b}
                </button>
              );
            })}
          </div>

          <div className="rounded overflow-hidden" style={{ border: `1px solid ${COLORS.border}` }}>
            <div className="grid gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wider"
                 style={{
                   gridTemplateColumns: `120px ${visibleBrokers.map(() => '1fr').join(' ')} 110px 100px`,
                   background: COLORS.surface, color: COLORS.textMute,
                 }}>
              <div>Symbol</div>
              {visibleBrokers.map(b => (
                <div key={b}
                     draggable
                     onDragStart={onDragStart(b)}
                     onDragOver={onDragOver(b)}
                     onDrop={onDrop(b)}
                     data-testid={`col-${b}`}
                     className="text-right cursor-move select-none"
                     title={`Drag to reorder · click ${b} chip above to hide`}
                     style={{ userSelect: 'none' }}>
                  ⋮⋮ {b}
                </div>
              ))}
              <div className="text-right">Total qty</div>
              <div className="text-right">Market value</div>
            </div>
            {visibleRows.length === 0 ? (
              <div className="px-2 py-3 text-center text-[11px]"
                   style={{ color: COLORS.textDim, borderTop: `1px solid ${COLORS.border}` }}>
                {discrepanciesOnly
                  ? 'No discrepancies in current view.'
                  : 'No rows match current filters.'}
              </div>
            ) : visibleRows.map((row, i) => (
              <div key={row.sym}
                   data-testid={`recon-row-${row.sym}`}
                   className="grid gap-2 px-2 py-1.5 text-[11px] tabular-nums"
                   style={{
                     gridTemplateColumns: `120px ${visibleBrokers.map(() => '1fr').join(' ')} 110px 100px`,
                     borderTop: i === 0 ? 'none' : `1px solid ${COLORS.border}`,
                     color: COLORS.text,
                     background: discrepancySymbols.has(row.sym)
                               ? 'rgba(255,100,100,0.05)' : 'transparent',
                   }}>
                <div className="font-medium">{row.sym}</div>
                {visibleBrokers.map(b => (
                  <div key={b} className="text-right" style={{
                    color: row.perBroker[b]?.delta && Math.abs(row.perBroker[b].delta) > 0.01
                         ? COLORS.red : COLORS.textDim,
                  }}>
                    {row.perBroker[b]?.reportedQty ? row.perBroker[b].reportedQty.toFixed(2) : '—'}
                  </div>
                ))}
                <div className="text-right">{row.totalQty.toFixed(2)}</div>
                <div className="text-right" style={{ color: COLORS.textDim }}>
                  {row.marketValue ? fmtUsd(row.marketValue) : '—'}
                </div>
              </div>
            ))}
          </div>

          {discrepancies.length > 0 && (
            <div className="rounded p-2.5"
                 style={{ background: COLORS.surface, border: `1px solid ${COLORS.red}`, color: COLORS.text }}>
              <div className="text-[12px] font-medium mb-1" style={{ color: COLORS.red }}>
                ⚠ {discrepancies.length} discrepanc{discrepancies.length === 1 ? 'y' : 'ies'} detected
              </div>
              <div className="text-[10px]" style={{ color: COLORS.textDim }}>
                Broker-reported qty differs from trade-derived qty for these positions. Common causes:
                missed corporate actions (use the panel below to record splits/mergers), pending
                settlement, or transfers not in your trade history.
              </div>
              <div className="text-[10px] mt-1.5" style={{ color: COLORS.text }}>
                {discrepancies.slice(0, 5).map(d => (
                  <div key={`${d.sym}-${d.broker}`}>
                    {d.sym} @ {d.broker}: reported {d.reportedQty.toFixed(2)} vs computed {d.computedQty.toFixed(2)} ({d.delta > 0 ? '+' : ''}{d.delta.toFixed(2)})
                  </div>
                ))}
                {discrepancies.length > 5 && (
                  <div style={{ color: COLORS.textMute }}>+ {discrepancies.length - 5} more</div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const CORPORATE_ACTIONS_KEY = 'imo_corporate_actions';

const loadCorporateActions = () => {
  try {
    const raw = localStorage.getItem(CORPORATE_ACTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const saveCorporateActions = (actions) => {
  try { localStorage.setItem(CORPORATE_ACTIONS_KEY, JSON.stringify(actions)); } catch {}
};

export const CorporateActionsPanel = () => {
  const [actions, setActions] = useState(loadCorporateActions);
  const [editing, setEditing] = useState(null);

  const startNew = (preset) => {
    setEditing(preset || {
      type: 'FORWARD_SPLIT', sym: '', date: '', ratio: 2,
    });
  };

  const saveEditing = () => {
    if (!editing) return;
    const v = validateAction(editing);
    if (!v.ok) {
      alert(`Invalid: ${v.errors.join(', ')}`);
      return;
    }
    const next = [...actions, { ...editing, id: Date.now() }];
    setActions(next);
    saveCorporateActions(next);
    try {
      appendAuditEntry({
        category: 'system', action: 'corporate-action-recorded',
        target: editing.sym,
        details: { type: editing.type, date: editing.date },
      });
    } catch {}
    setEditing(null);
  };

  const removeAction = (id) => {
    const next = actions.filter(a => a.id !== id);
    setActions(next);
    saveCorporateActions(next);
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[14px] font-medium" style={{ color: COLORS.text }}>Corporate actions</div>
        <div className="text-[11px] mt-0.5" style={{ color: COLORS.textDim }}>
          Splits, mergers, and spin-offs that adjust your cost basis. Recorded actions are applied to
          the trade history before tax reporting (1099-B, Schedule D). Most brokers include split
          adjustments in their CSV exports already; record here only if you have pre-split trades that
          weren't auto-adjusted.
        </div>
      </div>

      {actions.length > 0 && (
        <div className="rounded overflow-hidden" style={{ border: `1px solid ${COLORS.border}` }}>
          {actions.map(a => (
            <div key={a.id}
                 className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px]"
                 style={{ borderBottom: `1px solid ${COLORS.border}`, color: COLORS.text }}>
              <div className="tabular-nums">
                <span className="font-medium">{a.sym}</span>
                <span style={{ color: COLORS.textDim }}> · {a.type} · {a.date}</span>
                {a.type === 'FORWARD_SPLIT' && <span> · {a.ratio}:1</span>}
                {a.type === 'REVERSE_SPLIT' && <span> · 1:{a.ratio}</span>}
                {a.type === 'STOCK_DIVIDEND' && <span> · {a.percentage}%</span>}
                {a.type === 'CASH_MERGER' && <span> · ${a.cashPerShare}/sh</span>}
                {a.type === 'STOCK_MERGER' && <span> · → {a.newSym} ({a.exchangeRatio}×)</span>}
                {a.type === 'CASH_AND_STOCK_MERGER' && <span> · → {a.newSym} ({a.exchangeRatio}×) + ${a.cashPerShare}/sh</span>}
                {a.type === 'SPIN_OFF' && <span> · → {a.newSym} (basis {((a.basisAllocationPct || 0) * 100).toFixed(0)}%)</span>}
              </div>
              <button onClick={() => removeAction(a.id)}
                      className="px-2 py-0.5 rounded text-[10px]"
                      style={{ background: 'transparent', color: COLORS.red, border: `1px solid ${COLORS.border}` }}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {!editing ? (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => startNew()}
                  className="px-2.5 py-1 rounded text-[11px] font-medium"
                  style={{ background: COLORS.mint, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
            + Record action
          </button>
          <span className="text-[10px]" style={{ color: COLORS.textMute }}>or quick-add:</span>
          {COMMON_SPLIT_HISTORY.slice(0, 3).map(s => (
            <button key={`${s.sym}-${s.date}`}
                    onClick={() => startNew(s)}
                    className="px-2 py-0.5 rounded text-[10px]"
                    style={{ background: 'transparent', color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
              {s.sym} {s.ratio}:1 ({s.date.slice(0, 4)})
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded p-2.5 space-y-2"
             style={{ border: `1px solid ${COLORS.border}`, background: COLORS.surface }}>
          <div className="grid grid-cols-2 gap-2">
            <select value={editing.type}
                    onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                    className="px-2 py-1 rounded text-[11px]"
                    style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
              {ACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="date"
                   value={editing.date}
                   onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                   className="px-2 py-1 rounded text-[11px]"
                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
          </div>
          <input value={editing.sym}
                 onChange={(e) => setEditing({ ...editing, sym: e.target.value.toUpperCase() })}
                 placeholder="Symbol (e.g. AAPL)"
                 className="w-full px-2 py-1 rounded text-[11px]"
                 style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
          {(editing.type === 'FORWARD_SPLIT' || editing.type === 'REVERSE_SPLIT') && (
            <input type="number" step="0.01" min="0.01"
                   value={editing.ratio || ''}
                   onChange={(e) => setEditing({ ...editing, ratio: parseFloat(e.target.value) })}
                   placeholder="Ratio (e.g. 4 for 4:1 split)"
                   className="w-full px-2 py-1 rounded text-[11px]"
                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
          )}
          {editing.type === 'STOCK_DIVIDEND' && (
            <input type="number" step="0.01" min="0.01"
                   value={editing.percentage || ''}
                   onChange={(e) => setEditing({ ...editing, percentage: parseFloat(e.target.value) })}
                   placeholder="Percentage (e.g. 5 for 5%)"
                   className="w-full px-2 py-1 rounded text-[11px]"
                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
          )}
          {editing.type === 'CASH_MERGER' && (
            <input type="number" step="0.01" min="0"
                   value={editing.cashPerShare || ''}
                   onChange={(e) => setEditing({ ...editing, cashPerShare: parseFloat(e.target.value) })}
                   placeholder="Cash per share (e.g. 75.00)"
                   className="w-full px-2 py-1 rounded text-[11px]"
                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
          )}
          {(editing.type === 'STOCK_MERGER' || editing.type === 'CASH_AND_STOCK_MERGER' || editing.type === 'SPIN_OFF') && (
            <input value={editing.newSym || ''}
                   onChange={(e) => setEditing({ ...editing, newSym: e.target.value.toUpperCase() })}
                   placeholder="New symbol (e.g. NEW)"
                   className="w-full px-2 py-1 rounded text-[11px]"
                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
          )}
          {(editing.type === 'STOCK_MERGER' || editing.type === 'CASH_AND_STOCK_MERGER') && (
            <input type="number" step="0.0001" min="0.0001"
                   value={editing.exchangeRatio || ''}
                   onChange={(e) => setEditing({ ...editing, exchangeRatio: parseFloat(e.target.value) })}
                   placeholder="Exchange ratio (new shares per old, e.g. 0.5)"
                   className="w-full px-2 py-1 rounded text-[11px]"
                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
          )}
          {editing.type === 'CASH_AND_STOCK_MERGER' && (
            <>
              <input type="number" step="0.01" min="0"
                     value={editing.cashPerShare || ''}
                     onChange={(e) => setEditing({ ...editing, cashPerShare: parseFloat(e.target.value) })}
                     placeholder="Cash per share (e.g. 20.00)"
                     className="w-full px-2 py-1 rounded text-[11px]"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              <input type="number" step="0.01" min="0" max="1"
                     value={editing.basisCashAllocationPct ?? ''}
                     onChange={(e) => setEditing({ ...editing, basisCashAllocationPct: parseFloat(e.target.value) })}
                     placeholder="Basis allocation to cash (0..1, e.g. 0.4 from broker 1099-B)"
                     className="w-full px-2 py-1 rounded text-[11px]"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            </>
          )}
          {editing.type === 'SPIN_OFF' && (
            <>
              <input type="number" step="0.0001" min="0.0001"
                     value={editing.newSharesPerOldShare || ''}
                     onChange={(e) => setEditing({ ...editing, newSharesPerOldShare: parseFloat(e.target.value) })}
                     placeholder="New shares per old share (e.g. 0.5)"
                     className="w-full px-2 py-1 rounded text-[11px]"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              <input type="number" step="0.01" min="0" max="1"
                     value={editing.basisAllocationPct ?? ''}
                     onChange={(e) => setEditing({ ...editing, basisAllocationPct: parseFloat(e.target.value) })}
                     placeholder="Basis allocation to new shares (0..1, e.g. 0.2)"
                     className="w-full px-2 py-1 rounded text-[11px]"
                     style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
            </>
          )}
          <div className="flex items-center gap-2">
            <button onClick={saveEditing}
                    className="px-2.5 py-1 rounded text-[11px] font-medium"
                    style={{ background: COLORS.mint, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
              Save
            </button>
            <button onClick={() => setEditing(null)}
                    className="px-2.5 py-1 rounded text-[11px]"
                    style={{ background: 'transparent', color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
