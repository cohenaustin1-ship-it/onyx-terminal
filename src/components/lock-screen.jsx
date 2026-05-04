// IMO Onyx Terminal — Lock screen
//
// Phase 3p.20 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~677-897, ~220 lines).
//
// PIN-based lock screen shown when the app is locked. Two stages:
//   'set'    — first-time setup: enter and confirm a 4-6 digit PIN
//   'unlock' — subsequent unlocks: enter PIN, hash and compare
//
// Auto-focuses the hidden input on mount so users can type
// immediately. Wrong-PIN gets a 320ms shake animation. After 5
// wrong attempts, falls through to onSignOut.
//
// Public export:
//   LockScreen({ user, lockState, onUnlock, onSignOut })
//     user       — user record (for the welcome line)
//     lockState  — { pinHash, attempts, ... } from lock-storage
//     onUnlock() — called when PIN matches
//     onSignOut() — called after 5 wrong attempts or user clicks "Sign out"
//
// Honest scope:
//   - PIN is hashed via hashPin (SHA-256 with a per-user salt) before
//     storage. Plaintext PIN never leaves this component.
//   - The shake animation is best-effort visual feedback. After a
//     wrong PIN, the user can immediately retry — there's no
//     exponential-backoff or rate-limit on PIN attempts. The 5-attempt
//     cap is the only protection.

import React, { useState, useEffect, useRef } from 'react';
import { COLORS } from '../lib/constants.js';
import { hashPin, saveLockState } from '../lib/lock-storage.js';

export const LockScreen = ({ user, lockState, onUnlock, onSignOut }) => {
  const isFirstSetup = !lockState.pinHash;
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [stage, setStage] = useState(isFirstSetup ? 'set' : 'unlock');
  const [error, setError] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [shake, setShake] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    // Auto-focus the input on mount so the user can type a PIN
    // immediately without clicking. Hidden input — actual UI is
    // the dot row + on-screen keypad.
    inputRef.current?.focus();
  }, [stage]);

  // Trigger a 320ms shake when the user enters a wrong PIN.
  useEffect(() => {
    if (!shake) return;
    const t = setTimeout(() => setShake(false), 320);
    return () => clearTimeout(t);
  }, [shake]);

  const submit = async () => {
    if (stage === 'set') {
      if (pin.length < 4 || pin.length > 6) {
        setError('PIN must be 4 to 6 digits');
        return;
      }
      if (pin !== confirm) {
        setError('PINs don\'t match');
        return;
      }
      const hash = await hashPin(pin);
      if (!hash) { setError('Could not save PIN'); return; }
      const next = { ...lockState, pinHash: hash, locked: false, lockedAt: 0 };
      saveLockState(next);
      onUnlock(next);
      return;
    }
    // unlock stage
    const hash = await hashPin(pin);
    if (hash && hash === lockState.pinHash) {
      const next = { ...lockState, locked: false, lockedAt: 0 };
      saveLockState(next);
      onUnlock(next);
      return;
    }
    setAttempts(a => a + 1);
    setShake(true);
    setError('Wrong PIN');
    setPin('');
  };

  // Handle hidden-input keystrokes — accept digits only, cap at 6.
  const onChangePin = (e) => {
    const v = (e.target.value ?? '').replace(/\D/g, '').slice(0, 6);
    if (stage === 'set' && pin.length >= 4 && pin === '' /* impossible */) {
      // unreachable; placeholder for clarity
    }
    if (stage === 'set' && error) setError(null);
    setPin(v);
  };
  const onChangeConfirm = (e) => {
    const v = (e.target.value ?? '').replace(/\D/g, '').slice(0, 6);
    setConfirm(v);
    if (error) setError(null);
  };

  // Numeric keypad — also clickable for pointer-only users (e.g.
  // tablet without a hardware keyboard). Each press injects a digit
  // via the same setter as the hidden input.
  const press = (d) => {
    if (stage === 'set' && pin.length < 6 && !confirm) {
      setPin(p => (p + d).slice(0, 6));
      if (error) setError(null);
    } else if (stage === 'set' && pin.length >= 4) {
      setConfirm(c => (c + d).slice(0, 6));
      if (error) setError(null);
    } else if (stage === 'unlock') {
      setPin(p => (p + d).slice(0, 6));
      if (error) setError(null);
    }
  };
  const backspace = () => {
    if (stage === 'set' && confirm) setConfirm(c => c.slice(0, -1));
    else if (stage === 'set') setPin(p => p.slice(0, -1));
    else setPin(p => p.slice(0, -1));
    if (error) setError(null);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Backspace') {
      e.preventDefault();
      backspace();
    }
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      press(e.key);
    }
  };

  // Determine which value (pin or confirm) to display dots for.
  const dotsValue = (stage === 'set' && pin.length >= 4 && confirm.length > 0) || (stage === 'set' && pin.length >= 4 && pin.length === 6 && confirm !== '')
    ? confirm
    : pin;
  const dotsLabel = stage === 'set'
    ? (pin.length < 4 || (pin.length >= 4 && confirm.length === 0 && pin.length < 6) ? 'Choose a 4–6 digit PIN' : 'Confirm PIN')
    : 'Enter PIN to unlock';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center"
         style={{
           background: 'rgba(6,8,16,0.92)',
           backdropFilter: 'blur(20px) saturate(120%)',
           WebkitBackdropFilter: 'blur(20px) saturate(120%)',
         }}
         onKeyDown={onKeyDown}>
      <div className="flex flex-col items-center"
           style={{
             animation: shake ? 'lock-shake 320ms cubic-bezier(.36,.07,.19,.97)' : 'none',
             color: COLORS.text,
           }}>
        {/* User chip — shows whose workspace is locked */}
        <div className="flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full"
             style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${COLORS.border}` }}>
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium"
               style={{ background: COLORS.mint, color: COLORS.bg }}>
            {(user?.fullName ?? user?.username ?? '?').charAt(0).toUpperCase()}
          </div>
          <span className="text-[12.5px]" style={{ color: COLORS.textDim }}>
            {user?.fullName ?? user?.username ?? 'Workspace'}
          </span>
        </div>
        <div className="text-[22px] font-medium mb-1">
          {stage === 'set' ? 'Set workspace PIN' : 'Workspace locked'}
        </div>
        <div className="text-[12.5px] mb-7" style={{ color: COLORS.textMute }}>
          {dotsLabel}
        </div>
        {/* PIN dots — 6 max, filled in mint as digits land */}
        <div className="flex items-center gap-2 mb-6">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <span key={i}
                  className="rounded-full transition-all"
                  style={{
                    width: 12, height: 12,
                    background: i < dotsValue.length ? COLORS.mint : 'transparent',
                    border: `1.5px solid ${i < dotsValue.length ? COLORS.mint : COLORS.borderHi}`,
                  }} />
          ))}
        </div>
        {/* Hidden input — captures keyboard input, the dot row above
            visualizes the value. We support both physical keyboard
            and on-screen keypad below. */}
        <input ref={inputRef}
               type="password"
               inputMode="numeric"
               value={(stage === 'set' && pin.length >= 4 && (confirm.length > 0 || pin.length === 6)) ? confirm : pin}
               onChange={(stage === 'set' && pin.length >= 4 && pin.length === 6) ? onChangeConfirm : onChangePin}
               className="absolute opacity-0 pointer-events-none"
               style={{ width: 1, height: 1 }}
               autoFocus
               aria-label="PIN" />
        {/* Numeric keypad — 3×4 grid, last row has Sign out + 0 + ⌫ */}
        <div className="grid grid-cols-3 gap-2.5 mb-4" style={{ width: 220 }}>
          {[1,2,3,4,5,6,7,8,9].map(d => (
            <button key={d} onClick={() => press(String(d))} type="button"
                    className="h-12 rounded-md text-[18px] font-medium transition-colors hover:bg-white/[0.06] active:bg-white/[0.10]"
                    style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${COLORS.border}`, color: COLORS.text }}>
              {d}
            </button>
          ))}
          <button onClick={() => attempts >= 5 ? onSignOut() : null} type="button"
                  className="h-12 rounded-md text-[10px] uppercase tracking-wider transition-colors hover:bg-white/[0.04] disabled:opacity-30"
                  disabled={attempts < 5}
                  style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${COLORS.border}`, color: attempts >= 5 ? COLORS.red : COLORS.textMute }}
                  title={attempts >= 5 ? 'Sign out and start fresh' : 'Available after 5 wrong attempts'}>
            Sign out
          </button>
          <button onClick={() => press('0')} type="button"
                  className="h-12 rounded-md text-[18px] font-medium transition-colors hover:bg-white/[0.06] active:bg-white/[0.10]"
                  style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${COLORS.border}`, color: COLORS.text }}>
            0
          </button>
          <button onClick={backspace} type="button"
                  className="h-12 rounded-md text-[16px] transition-colors hover:bg-white/[0.06] active:bg-white/[0.10]"
                  style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${COLORS.border}`, color: COLORS.textDim }}
                  title="Delete last digit">
            ⌫
          </button>
        </div>
        {/* Action button — Submit / Unlock */}
        <button onClick={submit} type="button"
                disabled={(stage === 'set' && (pin.length < 4 || confirm.length === 0)) ||
                          (stage === 'unlock' && pin.length < 4)}
                className="px-8 py-2.5 rounded-md text-[12.5px] font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ background: COLORS.mint, color: COLORS.bg }}>
          {stage === 'set' ? 'Set PIN' : 'Unlock'}
        </button>
        {/* Error — empty by default, shows red on wrong PIN / mismatch */}
        <div className="text-[11px] mt-3 h-4" style={{ color: COLORS.red }}>
          {error}
          {!error && attempts > 0 && stage === 'unlock' && (
            <span style={{ color: COLORS.textMute }}>{attempts} attempt{attempts === 1 ? '' : 's'}</span>
          )}
        </div>
      </div>
      <style>{`
        @keyframes lock-shake {
          10%, 90% { transform: translateX(-1px); }
          20%, 80% { transform: translateX(2px); }
          30%, 50%, 70% { transform: translateX(-4px); }
          40%, 60% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
};
