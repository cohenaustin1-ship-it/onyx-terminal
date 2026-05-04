// IMO Onyx Terminal — Create Account modal
//
// Phase 3p.19 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~87791-89051, ~1,260 lines).
//
// Multi-step onboarding modal shown to first-time users. 35 useState
// calls drive the form-state machine across the steps:
//   1. Identity (name, email)
//   2. Profile (age, occupation, household)
//   3. Goals (multi-select)
//   4. Risk tolerance (slider)
//   5. Confirm
//
// Internal sub-components defined inside the function body (Stepper,
// WealthSlider, SelectCard) are kept inline because they capture
// closure references to the parent's state setters. Hoisting them
// out would require prop-drilling all those setters.
//
// Public export:
//   CreateAccountModal({ onCreate })
//     onCreate(profile) — called when the user finishes the flow.
//                         profile is a normalized snapshot of all
//                         step state ready to seed the user record.
//
// Honest scope:
//   - Pure UI form. No real validation beyond required-field checks
//     and a basic email regex. No password handling — auth happens
//     after onCreate via a separate flow.
//   - The 35-useState pattern is a smell; a useReducer with a typed
//     state machine would be cleaner. Refactoring that is out of
//     scope for the file-splitting work — left as future cleanup.

import React, { useState, useEffect } from 'react';
import { Check, Mail, Search, Shield } from 'lucide-react';
import { COLORS } from '../lib/constants.js';
import { LogoMark } from './leaf-ui.jsx';

// generateLEI — synthesize a Legal Entity Identifier-shaped string.
// Inlined from the monolith during 3p.19 file-splitting since this
// modal is the only caller. Real LEIs are 20 characters (18 hex + 2
// digit checksum); this is a believable mock, not a real LEI.
const RISK_TIERS = [
  { id: 'tier-1', label: 'Tier 1', sub: 'JPM internal · highest limits' },
  { id: 'tier-2', label: 'Tier 2', sub: 'Investment-grade counterparty' },
  { id: 'tier-3', label: 'Tier 3', sub: 'Qualified institution' },
];

const generateLEI = () => {
  const hex = '0123456789ABCDEF';
  let out = '';
  for (let i = 0; i < 18; i++) out += hex[Math.floor(Math.random() * 16)];
  out += String(Math.floor(10 + Math.random() * 89));
  return out;
};

export const CreateAccountModal = ({ onCreate }) => {
  // Helper: Stepper — plus/minus number input for Age, Family size.
  // Per UX feedback steppers feel more deliberate than text inputs
  // for small bounded numeric values. Disabled at min/max so the
  // user can't go past the valid range.
  // Helper: Stepper — slider + text input combo. The slider is for
  // quick adjustment; the text input shows the same value and accepts
  // direct typing. Plus/minus buttons on either end. Fixed the prior
  // re-mount bug (defining the helper inside the parent re-created
  // it on every render → input lost focus on each keystroke → looked
  // like buttons didn't work). Keep the helper defined inline but
  // memoize-stable: parent never re-creates onChange because it's a
  // direct setter.
  const Stepper = ({ value, onChange, min = 0, max = 999, placeholder = '' }) => {
    const v = parseInt(value) || min;
    const fillPct = ((v - min) / (max - min)) * 100;
    return (
      <div>
        <div className="flex items-stretch rounded-md overflow-hidden"
             style={{ background: '#F9FAFB', border: '1.5px solid #D1D5DB' }}>
          <button type="button"
                  onClick={() => onChange(String(Math.max(min, v - 1)))}
                  disabled={v <= min}
                  className="px-3 text-[16px] transition-colors hover:bg-gray-100 disabled:opacity-30"
                  style={{ color: '#3F4DCC' }}>−</button>
          <input type="number" value={value || ''}
                 onChange={e => onChange(e.target.value)}
                 min={min} max={max} placeholder={placeholder}
                 className="flex-1 min-w-0 text-center bg-transparent text-[14px] tabular-nums outline-none"
                 style={{ color: '#111827' }} />
          <button type="button"
                  onClick={() => onChange(String(Math.min(max, v + 1)))}
                  disabled={v >= max}
                  className="px-3 text-[16px] transition-colors hover:bg-gray-100 disabled:opacity-30"
                  style={{ color: '#3F4DCC' }}>+</button>
        </div>
        {/* Slider tied to the same value — moves and types stay in sync */}
        <input type="range" min={min} max={max} value={v}
               onChange={e => onChange(e.target.value)}
               className="w-full mt-1.5 h-1 appearance-none rounded-full"
               style={{
                 background: `linear-gradient(to right, #3F4DCC 0%, #3F4DCC ${fillPct}%, #E5E7EB ${fillPct}%, #E5E7EB 100%)`,
                 accentColor: '#3F4DCC',
               }} />
      </div>
    );
  };

  // Helper: WealthSlider — discrete slider for Investable Wealth.
  // Maps slider position to a wealth bucket id and displays the
  // current selection's label below. Feels more premium than a
  // dropdown per UX feedback.
  const WEALTH_BUCKETS = [
    { id: '0-10k',     label: 'Under $10K' },
    { id: '10-50k',    label: '$10K – $50K' },
    { id: '50-250k',   label: '$50K – $250K' },
    { id: '250k-1m',   label: '$250K – $1M' },
    { id: '1m-10m',    label: '$1M – $10M' },
    { id: '10m+',      label: '$10M+' },
  ];
  const WealthSlider = ({ value, onChange }) => {
    const idx = Math.max(0, WEALTH_BUCKETS.findIndex(b => b.id === value));
    const fillPct = WEALTH_BUCKETS.length > 1 ? (idx / (WEALTH_BUCKETS.length - 1)) * 100 : 0;
    return (
      <div>
        <input type="range" min="0" max={WEALTH_BUCKETS.length - 1} value={idx}
               onChange={e => onChange(WEALTH_BUCKETS[parseInt(e.target.value)].id)}
               className="w-full"
               style={{ accentColor: '#3F4DCC' }} />
        <div className="flex items-center justify-between text-[10px] mt-1"
             style={{ color: '#9CA3AF' }}>
          <span>Under $10K</span>
          <span style={{ color: '#3F4DCC', fontWeight: 600 }}>{WEALTH_BUCKETS[idx]?.label ?? '—'}</span>
          <span>$10M+</span>
        </div>
      </div>
    );
  };

  // Helper: SelectCard — standardized card-selection style used across
  // all the demographic / strategy questions per UX feedback. Replaces
  // the prior mix of pill buttons, checkbox cards, and radio cards
  // with a single coherent visual grammar. Single-select by default;
  // pass `multi` to make it a checkbox-style chip.
  const SelectCard = ({ active, onClick, title, desc, multi = false, compact = false }) => (
    <button type="button" onClick={onClick}
            className={`text-left rounded-md transition-all ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2.5'}`}
            style={{
              background: active ? 'rgba(63,77,204,0.06)' : '#F9FAFB',
              border: `1.5px solid ${active ? '#3F4DCC' : '#E5E7EB'}`,
            }}>
        <div className="flex items-start gap-2">
          {!compact && (
            multi
              ? <div className="w-3.5 h-3.5 rounded shrink-0 mt-0.5 flex items-center justify-center"
                     style={{ background: active ? '#3F4DCC' : '#FFFFFF', border: `1.5px solid ${active ? '#3F4DCC' : '#D1D5DB'}` }}>
                  {active && <Check size={10} style={{ color: '#FFFFFF' }} />}
                </div>
              : <div className="w-3.5 h-3.5 rounded-full shrink-0 mt-0.5"
                     style={{ background: active ? '#3F4DCC' : 'transparent', border: `1.5px solid ${active ? '#3F4DCC' : '#D1D5DB'}` }} />
          )}
          <div className="flex-1 min-w-0">
            <div className={`${compact ? 'text-[11.5px]' : 'text-[12.5px]'} font-medium`}
                 style={{ color: active ? '#3F4DCC' : '#111827' }}>{title}</div>
            {desc && <div className="text-[10.5px] mt-0.5" style={{ color: '#6B7280' }}>{desc}</div>}
          </div>
        </div>
    </button>
  );
  // Local light/blue palette — overrides COLORS for the entire signup flow
  // so the white & blue scheme is consistent across all 5 steps. Inline
  // references to COLORS.* below have been replaced with these.
  const LIGHT = {
    bg:        '#F4F6FB',
    surface:   '#FFFFFF',
    surface2:  '#EAEEF6',
    text:      '#0F172A',
    textDim:   '#475569',
    textMute:  '#6B7280',
    border:    '#E2E8F0',
    borderHi:  '#CBD5E1',
    mint:      '#3F4DCC',
    mintDim:   '#5A6AE0',
    green:     '#1B7F4F',
    red:       '#C8264C',
  };
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [deskCode, setDeskCode] = useState('');
  const [tier, setTier] = useState('tier-2');
  const [accepted, setAccepted] = useState(false);
  // Plaid bank-link state — step 2 of the new 3-step flow.
  // bankSearch is the institution-grid filter string; selectedBank is
  // the chosen institution id. Both are mock — no real Plaid handoff
  // happens. The selection just advances the wizard.
  const [bankSearch, setBankSearch]   = useState('');
  const [selectedBank, setSelectedBank] = useState(null);
  const [lei] = useState(() => generateLEI());
  const [err, setErr] = useState(null);
  // Profile fields — step 4
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [wealthBucket, setWealthBucket] = useState('');
  const [riskGoal, setRiskGoal] = useState('');
  const [horizon, setHorizon] = useState('');
  const [familySize, setFamilySize] = useState('');
  const [experience, setExperience] = useState(''); // years investing
  const [employment, setEmployment] = useState('');
  const [primaryGoal, setPrimaryGoal] = useState('');
  // Starter widgets + portfolio style — collected in step 4 so the user
  // lands on a Trade page already configured with what they care about.
  // starterWidgets is a Set of widget IDs (chart, watchlist, news, etc.)
  // portfolioStyle is one of: 'aggressive', 'balanced', 'conservative',
  // 'income', 'imo-builds' — used to seed the auto-allocation suggestion.
  // Default starter widgets per UX feedback — chart + buy/sell pane
  // + order book is the most common first-trade configuration. User
  // can deselect or add others on the Tell-us-about-you page. These
  // get applied to the actual layout post-signup via applyStarterLayout.
  const [starterWidgets, setStarterWidgets] = useState(['chart', 'orderentry', 'orderbook']);
  const [portfolioStyle, setPortfolioStyle] = useState('balanced');
  // Step 3 sub-step — 'a' (demographics) or 'b' (strategy & tools).
  // Splits the dense "Tell us about you" page into two focused
  // panes per UX feedback (lower cognitive load, easier to skim).
  const [aboutSubStep, setAboutSubStep] = useState('a');
  // KYC + personalization additions per UX feedback. annualIncome
  // and sourceOfFunds are required by suitability rules for higher-
  // risk products. citizenship gates which products you can show.
  // sectorsOfInterest seeds the news feed widget post-signup.
  // panicReaction is the gold-standard behavioral risk question
  // (Panic sell vs Hold vs Buy more) used to override the named
  // risk goal if the two don't agree.
  const [annualIncome, setAnnualIncome]         = useState('');
  const [sourceOfFunds, setSourceOfFunds]       = useState('');
  const [citizenship, setCitizenship]           = useState('us');
  const [sectorsOfInterest, setSectorsOfInterest] = useState([]);
  const [advancedExperience, setAdvancedExperience] = useState([]); // ['options','margin','futures']
  const [panicReaction, setPanicReaction]       = useState('');
  // Theme — step 5
  const [theme, setTheme] = useState('default'); // 'default' | 'pink'

  // Auto-recommend portfolioStyle from riskGoal — they were asking
  // almost the same question per UX feedback. The user can still
  // override the recommendation by clicking a different card. Mapping:
  //   preserve   → conservative
  //   income     → income
  //   balanced   → balanced
  //   aggressive → aggressive
  useEffect(() => {
    if (!riskGoal) return;
    const recommendation = {
      preserve:   'conservative',
      income:     'income',
      balanced:   'balanced',
      aggressive: 'aggressive',
    }[riskGoal];
    if (recommendation) setPortfolioStyle(recommendation);
  }, [riskGoal]);

  // username is now an email per UX rebuild — keep cleanUsername for
  // back-compat with the OAuth path which auto-generates handles.
  const cleanUsername = (s) => s.trim().toLowerCase().replace(/[^a-z0-9._@-]/g, '').slice(0, 64);

  const handleStep1 = () => {
    const emailLike = username.trim().toLowerCase();
    if (!fullName.trim()) { setErr('Name is required'); return; }
    if (!emailLike || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailLike)) {
      setErr('Please enter a valid email address'); return;
    }
    if (password.length < 8) { setErr('Password must be at least 8 characters'); return; }
    if (!accepted) { setErr('Please agree to the terms to continue'); return; }
    setUsername(emailLike);
    setErr(null);
    setStep(2);
  };

  // OAuth simulation — auto-fill profile from "provider" and skip ahead
  const handleOAuth = (provider) => {
    if (!fullName.trim()) {
      setErr('Please enter your name first, then use ' + provider);
      return;
    }
    const u = (username.trim() || `${fullName.trim().toLowerCase().split(/\s+/).join('.')}@${provider.toLowerCase()}.com`);
    setUsername(u);
    setPassword('oauth_' + provider.toLowerCase());
    setAccepted(true);
    setErr(null);
    setStep(2);
  };

  // Step 2 — Plaid bank connection mock. The user picks a bank from
  // the institution grid which advances the flow. There's also a
  // "Skip for now" option since paper trading doesn't need real funds.
  const handleStep2 = () => {
    setErr(null);
    setStep(3);
  };

  // Step 3 — final submission (was step 4 in the old flow). Validates
  // the demographics + risk fields and creates the account. Uses the
  // sub-step state to gate: if we're on sub-step 'a' (demographics),
  // advance to 'b' (strategy); only call handleCreate when 'b' is
  // submitted with full validation.
  const handleStep3 = () => {
    if (aboutSubStep === 'a') {
      // Validate demographics first
      if (!age || +age < 18) { setErr('Age must be 18 or older'); return; }
      if (!gender) { setErr('Please select an identity (or select "Prefer not to say")'); return; }
      if (!wealthBucket) { setErr('Please select an investable wealth range'); return; }
      setErr(null);
      setAboutSubStep('b');
      return;
    }
    // Sub-step 'b' — strategy + tools. Final validation.
    if (!riskGoal) { setErr('Please pick a risk goal'); return; }
    setErr(null);
    handleCreate();
  };

  // Legacy handler names kept as aliases so existing onClick wiring
  // for the old steps 2/3/4 doesn't break — they all just funnel
  // through the new 3-step flow.
  const handleStep4 = handleStep3;

  const handleCreate = () => {
    // accepted check happens in handleStep1 now (terms moved into step 1)
    // so by the time handleCreate runs, the user has already accepted.
    // Auto-generate desk code since the desk-collection step was removed.
    let desk = deskCode.trim().toUpperCase();
    if (!desk) {
      const prefix = ['ECM','FX','EQD','RATES','COMMOD','MACRO'][Math.floor(Math.random()*6)];
      const num = String(Math.floor(100 + Math.random() * 900));
      desk = `${prefix}-${num}`;
    }
    const initials = (fullName.trim().split(/\s+/).map(p => p[0]).join('') || username.slice(0, 2)).slice(0, 2).toUpperCase();
    const tierLabel = RISK_TIERS.find(t => t.id === tier)?.label ?? 'Tier 2';
    onCreate({
      username,
      fullName: fullName.trim(),
      desk,
      lei,
      tier: tierLabel,
      initials,
      onboarded: new Date().toISOString(),
      // Auth metadata for the rememberMe feature.
      // password is stored as a hash so we don't keep cleartext anywhere.
      auth: {
        passwordHash: password ? hashPassword(password) : null,
        rememberMe,
        provider: password.startsWith('oauth_') ? password.slice(6) : 'password',
        lastLogin: new Date().toISOString(),
      },
      profile: {
        age: parseInt(age),
        gender,
        wealthBucket,
        riskGoal,
        horizon: horizon || 'medium',
        familySize: familySize ? parseInt(familySize) : 1,
        experience: experience || 'novice',
        employment: employment || 'unspecified',
        primaryGoal: primaryGoal || 'growth',
        // Starter UI personalization captured in step 3
        starterWidgets,
        portfolioStyle,
        // KYC + personalization additions per UX feedback
        annualIncome:    annualIncome || null,
        sourceOfFunds:   sourceOfFunds || null,
        citizenship:     citizenship || 'us',
        sectorsOfInterest,
        advancedExperience,
        panicReaction:   panicReaction || null,
      },
      theme,
    });
  };

  return (
    <div className="relative w-full min-h-full flex items-center justify-center py-8 px-4 overflow-y-auto"
         style={{
           // Soft neutral backdrop — the colored panel inside the card
           // carries the visual weight per the design reference.
           background: '#F2F4F8',
         }}>

      {/* Single-panel card — sign-up form takes the full width per UX
          request. The welcome-back side panel was dropped because the
          terminal isn't a re-login experience for most users; new users
          land here only once. */}
      <div className="relative w-[640px] max-w-full rounded-md overflow-hidden z-10 flex"
           style={{
             background: '#FFFFFF',
             boxShadow: '0 24px 64px -12px rgba(15, 23, 42, 0.18)',
             minHeight: 540,
           }}>
        {/* Right form panel — now spans full width */}
        <div className="flex-1 min-w-0 p-7 overflow-y-auto"
             style={{ maxHeight: '90vh' }}>
          {/* Logo at top */}
          <div className="flex justify-center mb-3">
            <LogoMark size={40} color="#3F4DCC" />
          </div>

          {/* Stripe-style progress bar — three-step flow:
              1. Account — credentials + terms + theme (combined from
                 the prior 5-step flow's Account, Agreement, Theme steps)
              2. Bank — Plaid-style bank-link mock (was previously the
                 Desk / Tier step which has been retired)
              3. Tell us about you — demographics + risk + interests
                 (previously step 4) */}
          <div className="mx-auto" style={{ maxWidth: 420 }}>
            <div className="h-[3px] rounded-full overflow-hidden mb-2"
                 style={{ background: '#E5E7EB' }}>
              <div className="h-full rounded-full transition-all duration-300"
                   style={{
                     width: `${(step / 3) * 100}%`,
                     background: 'linear-gradient(90deg, #3F4DCC 0%, #6675E0 100%)',
                   }} />
            </div>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[1.2px] mb-7"
                 style={{ color: '#9CA3AF', fontWeight: 600 }}>
              <span>Step {step} of 3</span>
              <span style={{ color: '#3F4DCC' }}>
                {step === 1 ? 'Account' :
                 step === 2 ? 'Connect bank' :
                 'About you'}
              </span>
            </div>
          </div>

          <h1 className="text-[28px] font-medium text-center"
              style={{ color: step === 1 ? '#3F4DCC' : '#0F172A', letterSpacing: '-0.02em' }}>
            {step === 1 ? 'Create Account' :
             step === 2 ? 'Connect your bank' :
             'Tell us about you'}
          </h1>
          <p className="text-[13.5px] text-center mb-7"
             style={{ color: '#6B7280' }}>
            {step === 1 ? 'Use your email to register' :
             step === 2 ? 'Securely link an account so you can deposit funds' :
             'Helps us tailor your recommendations · stays on your device'}
          </p>

          <div className="flex flex-col gap-4">
          {step === 1 && (
            <>
              {/* Social logins moved to step 2 per UX feedback —
                  step 1 is now a clean "your details" form. The
                  social login buttons live on step 2 next to the
                  bank-link / "Remember me" choices. */}
              {/* Name field — BOXED (not underlined) per UX feedback.
                  Boxed inputs perform better than underlines because
                  they give a clearer click/tap target and aren't
                  mistakable for decorative horizontal rules. */}
              <div>
                <label className="text-[10px] uppercase tracking-[1.2px] block mb-1.5"
                       style={{ color: '#6B7280', fontWeight: 600 }}>Full name</label>
                <input
                  autoFocus
                  type="text"
                  value={fullName}
                  onChange={e => { setFullName(e.target.value); setErr(null); }}
                  maxLength={64}
                  placeholder="Jane Smith"
                  className="w-full px-3 py-2.5 rounded-md text-[14px] outline-none transition-colors"
                  style={{ color: '#111827', background: '#F9FAFB', border: '1.5px solid #D1D5DB' }}
                  onFocus={e => e.target.style.borderColor = '#3F4DCC'}
                  onBlur={e => e.target.style.borderColor = '#D1D5DB'}
                />
              </div>

              {/* Email — used as both username and login per UX
                  feedback (one less thing to invent and remember). */}
              <div>
                <label className="text-[10px] uppercase tracking-[1.2px] block mb-1.5"
                       style={{ color: '#6B7280', fontWeight: 600 }}>Email address</label>
                <input
                  type="email"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setErr(null); }}
                  maxLength={64}
                  placeholder="you@company.com"
                  className="w-full px-3 py-2.5 rounded-md text-[14px] outline-none transition-colors"
                  style={{ color: '#111827', background: '#F9FAFB', border: '1.5px solid #D1D5DB' }}
                  onFocus={e => e.target.style.borderColor = '#3F4DCC'}
                  onBlur={e => e.target.style.borderColor = '#D1D5DB'}
                />
                <div className="text-[10px] mt-1" style={{ color: '#9CA3AF' }}>
                  We'll use this as your username too — keeps things simple.
                </div>
              </div>

              {/* Password — boxed input with show/hide toggle so users
                  can verify what they typed instead of getting locked
                  out by a typo. Real-time strength meter shows below. */}
              <div>
                <label className="text-[10px] uppercase tracking-[1.2px] block mb-1.5"
                       style={{ color: '#6B7280', fontWeight: 600 }}>Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setErr(null); }}
                    maxLength={64}
                    placeholder="At least 8 characters"
                    className="w-full px-3 py-2.5 pr-12 rounded-md text-[14px] outline-none transition-colors"
                    style={{ color: '#111827', background: '#F9FAFB', border: '1.5px solid #D1D5DB' }}
                    onFocus={e => e.target.style.borderColor = '#3F4DCC'}
                    onBlur={e => e.target.style.borderColor = '#D1D5DB'}
                  />
                  <button type="button"
                          onClick={() => setShowPassword(s => !s)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded text-[10.5px] uppercase tracking-wider"
                          style={{ color: '#3F4DCC' }}>
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {/* Strength meter — three segments fill as the password
                    gets stronger (length / mixed case / numbers / symbols). */}
                {password.length > 0 && (() => {
                  const score = (password.length >= 8 ? 1 : 0)
                              + (/[A-Z]/.test(password) && /[a-z]/.test(password) ? 1 : 0)
                              + (/[0-9]/.test(password) ? 1 : 0)
                              + (/[^A-Za-z0-9]/.test(password) ? 1 : 0);
                  const tone = score <= 1 ? '#DC2626' : score <= 2 ? '#F59E0B' : score <= 3 ? '#10B981' : '#059669';
                  const label = score <= 1 ? 'Weak' : score <= 2 ? 'Fair' : score <= 3 ? 'Good' : 'Strong';
                  return (
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 flex gap-1">
                        {[1,2,3,4].map(i => (
                          <div key={i} className="flex-1 h-1 rounded-full"
                               style={{ background: i <= score ? tone : '#E5E7EB' }} />
                        ))}
                      </div>
                      <span className="text-[10px] tabular-nums" style={{ color: tone, fontWeight: 600 }}>{label}</span>
                    </div>
                  );
                })()}
              </div>

              {/* Theme picker — moved into Step 1 per UX request so the
                  user makes a single visual decision early instead of
                  being asked to pick a theme as a final confirmation
                  step. Same three options as before; the active theme
                  highlights with its own brand color. */}
              <div>
                <label className="text-[10px] uppercase tracking-[1.2px] block mb-1.5"
                       style={{ color: '#6B7280', fontWeight: 600 }}>Color scheme</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'default', label: 'Dark',  bg: 'linear-gradient(180deg, #16191E 0%, #1A2B30 100%)', border: '#3D7BFF' },
                    { id: 'blue',    label: 'Light', bg: 'linear-gradient(180deg, #FFFFFF 0%, #DBE3F2 100%)', border: '#3F4DCC' },
                    { id: 'pink',    label: 'Rose',  bg: 'linear-gradient(180deg, #FFFFFF 0%, #FDF2F4 100%)', border: '#E15B7A' },
                  ].map(t => (
                    <button key={t.id} type="button" onClick={() => setTheme(t.id)}
                            className="rounded-md border-2 overflow-hidden transition-all"
                            style={{ borderColor: theme === t.id ? t.border : '#D1D5DB' }}>
                      <div className="h-12" style={{ background: t.bg }} />
                      <div className="px-2 py-1 text-[11px] text-center"
                           style={{ background: '#FFFFFF', color: theme === t.id ? t.border : '#374151', fontWeight: theme === t.id ? 600 : 400 }}>
                        {t.label}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Terms checkbox — moved INTO step 1 per UX request so
                  the legal consent happens at account creation rather
                  than buried in a later step the user might bail on. */}
              <label className="flex items-start gap-2 cursor-pointer text-[12px] leading-relaxed">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={e => { setAccepted(e.target.checked); setErr(null); }}
                  className="accent-mint mt-0.5 shrink-0"
                />
                <span style={{ color: '#374151' }}>
                  I agree to the <a href="#" style={{ color: '#3F4DCC' }}>Terms of Service</a> and <a href="#" style={{ color: '#3F4DCC' }}>Privacy Policy</a>, and acknowledge that Onyx is a demonstration environment.
                </span>
              </label>

              {err && (
                <div className="px-3 py-2 rounded text-[12px]"
                     style={{ background: '#FEE2E2', color: '#B91C1C' }}>
                  {err}
                </div>
              )}

              <button
                onClick={handleStep1}
                className="mt-1 py-3 rounded-full text-[12.5px] font-semibold uppercase transition-all hover:bg-[rgba(63,77,204,0.04)] self-center px-12"
                style={{
                  color: '#3F4DCC',
                  background: '#FFFFFF',
                  border: '2px solid #3F4DCC',
                  letterSpacing: '2px',
                  boxShadow: '0 1px 2px rgba(63,77,204,0.08)',
                }}
              >
                Continue
              </button>

              {/* Remember-me row — Forgot password link removed per UX
                  feedback (this is a sign-up page, the user has no
                  password to forget yet). */}
              <div className="flex items-center justify-center -my-1">
                <button type="button"
                        onClick={() => setRememberMe(r => !r)}
                        className="flex items-center gap-2 text-[12.5px]">
                  <div className="w-4 h-4 rounded flex items-center justify-center transition-colors"
                       style={{
                         background: rememberMe ? '#3F4DCC' : '#FFFFFF',
                         border: `1.5px solid ${rememberMe ? '#3F4DCC' : '#D1D5DB'}`,
                       }}>
                    {rememberMe && <Check size={11} style={{ color: '#FFFFFF' }} />}
                  </div>
                  <span style={{ color: '#374151' }}>Remember me on this device</span>
                </button>
              </div>

              {/* Guest pass — promoted from dashed-border (looked like
                  a coupon-code box) to solid-bordered styling so it
                  reads as a real "try it now" option. Paper trading
                  is a key feature, so it earns proper visual weight. */}
              <button type="button"
                      onClick={() => onCreate({
                        username:  `guest_${Math.random().toString(36).slice(2, 8)}`,
                        fullName:  'Guest Trader',
                        email:     '',
                        guestPass: true,
                        desk:      'GUEST',
                        lei:       Math.random().toString(16).slice(2, 14).toUpperCase(),
                        gender:    'unknown',
                        wealth:    'mid',
                        riskGoal:  'balanced',
                        horizon:   'long',
                        experience:'novice',
                        employment:'other',
                        primaryGoal:'learn',
                        theme:     'default',
                        password:  null,
                        provider:  'guest',
                      })}
                      className="w-full py-2.5 rounded-md text-[12.5px] font-medium border-2 transition-colors hover:bg-gray-50"
                      style={{ borderColor: '#D1D5DB', color: '#374151', background: '#FFFFFF' }}
                      title="Try the platform with $100K of paper money — no signup required.">
                Try as Guest · Paper trading
              </button>

              <div className="text-center text-[12px] mt-1" style={{ color: '#6B7280' }}>
                Already have an account?{' '}
                <span style={{ color: '#3F4DCC', textDecoration: 'underline' }} className="cursor-pointer">
                  Sign in
                </span>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {/* Social logins — moved here from step 1 per UX feedback.
                  Bigger buttons with proper SVG brand icons (Google G,
                  LinkedIn in-square, generic SSO key). Clicking either
                  auto-fills the profile and skips the rest of sign-up;
                  Plaid bank-link below is for users continuing with
                  email. */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    p: 'Google',
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                    ),
                  },
                  {
                    p: 'LinkedIn',
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="#0A66C2">
                        <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 110-4.12 2.06 2.06 0 010 4.12zm1.78 13.02H3.55V9h3.57v11.45zM22.23 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.72V1.72C24 .77 23.21 0 22.23 0z"/>
                      </svg>
                    ),
                  },
                  {
                    p: 'SSO',
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3F4DCC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0110 0v4"/>
                      </svg>
                    ),
                  },
                ].map(({ p, icon }) => (
                  <button key={p} type="button"
                          onClick={() => handleOAuth(p)}
                          className="py-2.5 rounded-md text-[12px] font-medium border-2 transition-colors hover:bg-gray-50 flex items-center justify-center gap-1.5"
                          style={{ borderColor: '#D1D5DB', color: '#3F4DCC', background: '#FFFFFF' }}
                          title={`Sign up via ${p} (auto-fills profile + skips password)`}>
                    {icon}
                    <span>{p}</span>
                  </button>
                ))}
              </div>

              {/* OR divider */}
              <div className="flex items-center gap-3 my-1">
                <div className="flex-1 h-px" style={{ background: '#E5E7EB' }} />
                <span className="text-[10px] uppercase tracking-wider" style={{ color: '#9CA3AF' }}>
                  Or connect a bank
                </span>
                <div className="flex-1 h-px" style={{ background: '#E5E7EB' }} />
              </div>

              {/* Plaid-style bank connection mock. Visually mirrors the
                  real Plaid Link flow: brand bar at top, search input,
                  grid of institution logos, security blurb at bottom.
                  Picking an institution OR clicking Skip advances the
                  flow. Real Plaid integration would replace the grid
                  with a Plaid Link iframe and exchange a public_token
                  for an access_token via the agent gateway. */}
              <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-md mb-2"
                   style={{ background: '#F4F6FB', border: '1px solid #E5E7EB' }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[14px] font-bold"
                     style={{ background: '#000000', color: '#FFFFFF' }}>P</div>
                <div className="flex-1">
                  <div className="text-[12.5px] font-semibold" style={{ color: '#0F172A' }}>
                    Plaid · Secure connection
                  </div>
                  <div className="text-[10px]" style={{ color: '#6B7280' }}>
                    Bank-grade encryption · 256-bit AES · Read-only access
                  </div>
                </div>
                <Shield size={16} style={{ color: '#10B981' }} />
              </div>

              {/* Institution search */}
              <div>
                <label className="text-[10px] uppercase tracking-[1.2px] block mb-1.5"
                       style={{ color: '#6B7280', fontWeight: 600 }}>Find your bank</label>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
                          style={{ color: '#9CA3AF' }} />
                  <input
                    type="text"
                    value={bankSearch}
                    onChange={e => setBankSearch(e.target.value)}
                    placeholder="Search 12,000+ institutions"
                    className="w-full pl-9 pr-3 py-2.5 rounded-md text-[13px] outline-none"
                    style={{ color: '#111827', background: '#F9FAFB', border: '1.5px solid #D1D5DB' }}
                    onFocus={e => e.target.style.borderColor = '#3F4DCC'}
                    onBlur={e => e.target.style.borderColor = '#D1D5DB'}
                  />
                </div>
              </div>

              {/* Popular institutions grid — picking one mocks the
                  Plaid OAuth handoff. Click flashes the selected card
                  with mint, then advances after 600ms so the user gets
                  visual confirmation of the link. */}
              <div>
                <div className="text-[10.5px] mb-2" style={{ color: '#6B7280' }}>
                  Popular institutions
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(() => {
                    const banks = [
                      { id: 'chase',    name: 'Chase',          color: '#117ACA' },
                      { id: 'bofa',     name: 'Bank of America', color: '#E31837' },
                      { id: 'wells',    name: 'Wells Fargo',    color: '#D71E28' },
                      { id: 'citi',     name: 'Citi',           color: '#003B70' },
                      { id: 'usbank',   name: 'US Bank',        color: '#0E4A8E' },
                      { id: 'pnc',      name: 'PNC Bank',       color: '#F58025' },
                      { id: 'ally',     name: 'Ally',           color: '#522D80' },
                      { id: 'capone',   name: 'Capital One',    color: '#004977' },
                      { id: 'schwab',   name: 'Charles Schwab', color: '#00A0DF' },
                    ].filter(b => !bankSearch || b.name.toLowerCase().includes(bankSearch.toLowerCase()));
                    return banks.map(b => (
                      <button key={b.id} type="button"
                              onClick={() => {
                                setSelectedBank(b.id);
                                // Brief flash then advance — mimics the
                                // Plaid handoff confirmation animation.
                                setTimeout(() => handleStep2(), 600);
                              }}
                              className="flex flex-col items-center justify-center gap-2 py-3.5 rounded-md border-2 transition-all hover:bg-gray-50"
                              style={{
                                borderColor: selectedBank === b.id ? b.color : '#E5E7EB',
                                background: selectedBank === b.id ? `${b.color}10` : '#FFFFFF',
                              }}>
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold"
                             style={{ background: b.color, color: '#FFFFFF' }}>
                          {b.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2)}
                        </div>
                        <div className="text-[10.5px] text-center" style={{ color: '#0F172A', fontWeight: 500 }}>
                          {b.name}
                        </div>
                      </button>
                    ));
                  })()}
                </div>
              </div>

              {/* Trust footer */}
              <div className="text-[10.5px] leading-relaxed px-1" style={{ color: '#6B7280' }}>
                By selecting a bank you authorize Plaid to securely connect to your account. Onyx never sees or stores your bank credentials. <a href="#" style={{ color: '#3F4DCC' }}>How Plaid keeps your data safe</a>
              </div>

              {err && (
                <div className="px-3 py-2 rounded-md text-[11px]"
                     style={{ background: 'rgba(237,112,136,0.08)', color: LIGHT.red, border: '1px solid rgba(237,112,136,0.2)' }}>
                  {err}
                </div>
              )}

              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={() => { setStep(1); setErr(null); }}
                  className="px-4 py-3 rounded-md text-[13px] border transition-colors"
                  style={{ color: LIGHT.textDim, borderColor: LIGHT.border }}
                >Back</button>
                <button
                  onClick={handleStep2}
                  className="flex-1 py-3 rounded-md text-[13px] font-medium transition-all hover:bg-gray-50"
                  style={{ color: LIGHT.textDim, background: LIGHT.surface, border: `1px solid ${LIGHT.border}` }}
                >Skip for now</button>
              </div>
            </>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              {/* Sub-step indicator — 'a' (Demographics) or 'b' (Strategy
                  & Tools). Splits the dense form per UX feedback so
                  users see a focused 1-screen pane at a time. */}
              <div className="flex items-center gap-1.5">
                {[
                  { id: 'a', label: 'Demographics' },
                  { id: 'b', label: 'Strategy & tools' },
                ].map(s => (
                  <button key={s.id} type="button" onClick={() => setAboutSubStep(s.id)}
                          className="flex-1 py-1.5 text-[10.5px] uppercase tracking-[1px] rounded transition-colors"
                          style={{
                            background: aboutSubStep === s.id ? 'rgba(63,77,204,0.08)' : 'transparent',
                            color: aboutSubStep === s.id ? '#3F4DCC' : '#6B7280',
                            fontWeight: aboutSubStep === s.id ? 600 : 500,
                            border: `1px solid ${aboutSubStep === s.id ? '#3F4DCC55' : 'transparent'}`,
                          }}>
                    {s.label}
                  </button>
                ))}
              </div>

              {aboutSubStep === 'a' && (
                <>
                  {/* Age + Family — plus/minus steppers per UX feedback. */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                             style={{ color: '#6B7280', fontWeight: 600 }}>Age</label>
                      <Stepper value={age} onChange={setAge} min={18} max={100} placeholder="35" />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                             style={{ color: '#6B7280', fontWeight: 600 }}>Family size</label>
                      <Stepper value={familySize} onChange={setFamilySize} min={1} max={20} placeholder="1" />
                    </div>
                  </div>

                  {/* Identity — full-word labels per UX feedback ("NB"
                      isn't universally clear). Compact card style. */}
                  <div>
                    <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                           style={{ color: '#6B7280', fontWeight: 600 }}>Identity</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { id: 'female', label: 'Female' },
                        { id: 'male',   label: 'Male' },
                        { id: 'nb',     label: 'Non-binary' },
                        { id: 'other',  label: 'Other' },
                        { id: 'na',     label: 'Prefer not to say' },
                      ].map(g => (
                        <SelectCard key={g.id} active={gender === g.id}
                                    onClick={() => setGender(g.id)}
                                    title={g.label}
                                    compact />
                      ))}
                    </div>
                  </div>

                  {/* Investable wealth — slider per UX feedback. Tooltip
                      clarifies what counts as "investable" (cash you have
                      ready to deploy, not net worth). */}
                  <div>
                    <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                           style={{ color: '#6B7280', fontWeight: 600 }}
                           title="Cash you have ready to invest right now — not your total net worth.">
                      Investable wealth · <span className="lowercase normal-case" style={{ color: '#9CA3AF', letterSpacing: 0 }}>cash ready to invest</span>
                    </label>
                    <WealthSlider value={wealthBucket} onChange={setWealthBucket} />
                  </div>

                  {/* KYC — annual income + source of funds. Required by
                      suitability rules for higher-risk products. Both
                      compact dropdowns to keep the visual footprint
                      small. */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                             style={{ color: '#6B7280', fontWeight: 600 }}>Annual income</label>
                      <select value={annualIncome} onChange={e => setAnnualIncome(e.target.value)}
                              className="w-full px-2.5 py-2 rounded-md text-[12px] outline-none"
                              style={{ background: '#F9FAFB', color: '#111827', border: '1.5px solid #D1D5DB' }}>
                        <option value="">Select range…</option>
                        <option value="0-50k">Under $50K</option>
                        <option value="50-100k">$50K – $100K</option>
                        <option value="100-250k">$100K – $250K</option>
                        <option value="250k+">$250K+</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                             style={{ color: '#6B7280', fontWeight: 600 }}>Source of funds</label>
                      <select value={sourceOfFunds} onChange={e => setSourceOfFunds(e.target.value)}
                              className="w-full px-2.5 py-2 rounded-md text-[12px] outline-none"
                              style={{ background: '#F9FAFB', color: '#111827', border: '1.5px solid #D1D5DB' }}>
                        <option value="">Select…</option>
                        <option value="salary">Salary / wages</option>
                        <option value="business">Business income</option>
                        <option value="savings">Savings</option>
                        <option value="inheritance">Inheritance / gift</option>
                        <option value="investments">Investment proceeds</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>

                  {/* Citizenship — gates which products are legally
                      shown to the user. */}
                  <div>
                    <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                           style={{ color: '#6B7280', fontWeight: 600 }}>Tax residency</label>
                    <select value={citizenship} onChange={e => setCitizenship(e.target.value)}
                            className="w-full px-2.5 py-2 rounded-md text-[12px] outline-none"
                            style={{ background: '#F9FAFB', color: '#111827', border: '1.5px solid #D1D5DB' }}>
                      <option value="us">United States</option>
                      <option value="ca">Canada</option>
                      <option value="uk">United Kingdom</option>
                      <option value="eu">European Union</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  {/* Employment — kept as compact dropdown */}
                  <div>
                    <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                           style={{ color: '#6B7280', fontWeight: 600 }}>Employment</label>
                    <select value={employment} onChange={e => setEmployment(e.target.value)}
                            className="w-full px-2.5 py-2 rounded-md text-[12px] outline-none"
                            style={{ background: '#F9FAFB', color: '#111827', border: '1.5px solid #D1D5DB' }}>
                      <option value="">Select…</option>
                      <option value="employed">Employed full-time</option>
                      <option value="self">Self-employed</option>
                      <option value="student">Student</option>
                      <option value="retired">Retired</option>
                      <option value="unemployed">Between jobs</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </>
              )}

              {aboutSubStep === 'b' && (
                <>
                  {/* Risk goal — drives the recommended portfolio style
                      automatically (auto-mapped via useEffect above).
                      Standardized card style. */}
                  <div>
                    <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                           style={{ color: '#6B7280', fontWeight: 600 }}>Risk goal</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: 'preserve',   label: 'Preserve',  desc: 'Low volatility, steady returns' },
                        { id: 'income',     label: 'Income',    desc: 'Dividends + bonds' },
                        { id: 'balanced',   label: 'Balanced',  desc: 'Mix of stocks, bonds, cash' },
                        { id: 'aggressive', label: 'Aggressive', desc: 'High growth, higher risk' },
                      ].map(r => (
                        <SelectCard key={r.id} active={riskGoal === r.id}
                                    onClick={() => setRiskGoal(r.id)}
                                    title={r.label} desc={r.desc} />
                      ))}
                    </div>
                  </div>

                  {/* Behavioral risk — gold-standard "what would you do"
                      question per UX feedback. The chosen reaction is
                      stored as panicReaction and can override the named
                      risk goal if the two disagree (e.g. user picked
                      Aggressive but said they'd Panic sell). */}
                  <div>
                    <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                           style={{ color: '#6B7280', fontWeight: 600 }}>
                      If your portfolio dropped 10% in a day, you would…
                    </label>
                    <div className="grid grid-cols-1 gap-1.5">
                      {[
                        { id: 'sell',  label: 'Panic sell',  desc: 'Cut losses to protect what\'s left' },
                        { id: 'hold',  label: 'Hold',        desc: 'Wait it out — this is normal volatility' },
                        { id: 'buy',   label: 'Buy more',    desc: 'Treat the dip as a discount' },
                      ].map(r => (
                        <SelectCard key={r.id} active={panicReaction === r.id}
                                    onClick={() => setPanicReaction(r.id)}
                                    title={r.label} desc={r.desc} />
                      ))}
                    </div>
                  </div>

                  {/* Investment horizon — kept short, standardized cards */}
                  <div>
                    <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                           style={{ color: '#6B7280', fontWeight: 600 }}>Investment horizon</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { id: 'short',  label: 'Short',  desc: '< 3 years' },
                        { id: 'medium', label: 'Medium', desc: '3 – 10 years' },
                        { id: 'long',   label: 'Long',   desc: '10+ years' },
                      ].map(h => (
                        <SelectCard key={h.id} active={horizon === h.id}
                                    onClick={() => setHorizon(h.id)}
                                    title={h.label} desc={h.desc} />
                      ))}
                    </div>
                  </div>

                  {/* Experience — standardized cards. Below it, an
                      "advanced experience" multi-select for products
                      that require extra warnings (options, margin,
                      futures). */}
                  <div>
                    <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                           style={{ color: '#6B7280', fontWeight: 600 }}>Experience level</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { id: 'novice',       label: 'Novice',       desc: '< 1 year' },
                        { id: 'intermediate', label: 'Intermediate', desc: '1 – 5 years' },
                        { id: 'experienced',  label: 'Experienced',  desc: '5+ years' },
                      ].map(e => (
                        <SelectCard key={e.id} active={experience === e.id}
                                    onClick={() => setExperience(e.id)}
                                    title={e.label} desc={e.desc} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                           style={{ color: '#6B7280', fontWeight: 600 }}>
                      Have you traded any of these? <span className="lowercase normal-case" style={{ color: '#9CA3AF', letterSpacing: 0 }}>optional</span>
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { id: 'options',  label: 'Options' },
                        { id: 'margin',   label: 'Margin' },
                        { id: 'futures',  label: 'Futures' },
                      ].map(p => {
                        const isOn = advancedExperience.includes(p.id);
                        return (
                          <SelectCard key={p.id} active={isOn}
                                      onClick={() => setAdvancedExperience(s =>
                                        isOn ? s.filter(x => x !== p.id) : [...s, p.id]
                                      )}
                                      title={p.label}
                                      compact multi />
                        );
                      })}
                    </div>
                  </div>

                  {/* Sectors of interest — multi-select chips. Seeds
                      the news feed widget with relevant content. */}
                  <div>
                    <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                           style={{ color: '#6B7280', fontWeight: 600 }}>
                      Sectors of interest <span className="lowercase normal-case" style={{ color: '#9CA3AF', letterSpacing: 0 }}>pick any</span>
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        'Tech', 'Crypto', 'Healthcare', 'Energy', 'Green energy',
                        'Financials', 'Consumer', 'Industrials', 'Real estate', 'Macro',
                      ].map(s => {
                        const isOn = sectorsOfInterest.includes(s);
                        return (
                          <button key={s} type="button"
                                  onClick={() => setSectorsOfInterest(prev =>
                                    isOn ? prev.filter(x => x !== s) : [...prev, s]
                                  )}
                                  className="px-2.5 py-1 rounded-full text-[11px] transition-colors"
                                  style={{
                                    background: isOn ? '#3F4DCC' : '#F9FAFB',
                                    color: isOn ? '#FFFFFF' : '#374151',
                                    border: `1.5px solid ${isOn ? '#3F4DCC' : '#E5E7EB'}`,
                                    fontWeight: isOn ? 600 : 500,
                                  }}>
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Primary financial goal — standardized cards.
                      Two-column to save vertical space. */}
                  <div>
                    <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                           style={{ color: '#6B7280', fontWeight: 600 }}>Primary financial goal</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: 'retirement',  label: 'Retirement',     desc: 'Long-term wealth' },
                        { id: 'home',        label: 'Buy a home',     desc: 'Down payment savings' },
                        { id: 'income',      label: 'Side income',    desc: 'Active trading' },
                        { id: 'education',   label: 'Education',      desc: 'Tuition / 529' },
                        { id: 'wealth',      label: 'Generational',   desc: 'Long-horizon legacy' },
                        { id: 'build-portfolio', label: 'Let IMO build it', desc: 'AI-managed portfolio' },
                      ].map(g => (
                        <SelectCard key={g.id} active={primaryGoal === g.id}
                                    onClick={() => setPrimaryGoal(g.id)}
                                    title={g.label} desc={g.desc} />
                      ))}
                    </div>
                  </div>

                  {/* Portfolio build style — auto-pre-selected from
                      Risk goal (above) but user can override. Pill
                      label "Recommended" appears next to the auto-
                      selected card. */}
                  <div>
                    <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                           style={{ color: '#6B7280', fontWeight: 600 }}>How should we build your portfolio?</label>
                    <div className="flex flex-col gap-1.5">
                      {[
                        { id: 'aggressive',   label: 'Aggressive growth',  desc: '90% stocks / crypto · long horizon' },
                        { id: 'balanced',     label: 'Balanced',           desc: '60% stocks / 30% bonds / 10% cash' },
                        { id: 'conservative', label: 'Conservative',       desc: '40% stocks / 50% bonds / 10% cash' },
                        { id: 'income',       label: 'Income & dividends', desc: 'Dividend equities + bond ladder' },
                        { id: 'imo-builds',   label: 'Let IMO build it for me', desc: 'AI-managed, risk-matched' },
                      ].map(p => {
                        const isOn = portfolioStyle === p.id;
                        const recommendedFromRisk = {
                          preserve: 'conservative', income: 'income',
                          balanced: 'balanced', aggressive: 'aggressive',
                        }[riskGoal];
                        const isRecommended = p.id === recommendedFromRisk;
                        return (
                          <button key={p.id} type="button"
                                  onClick={() => setPortfolioStyle(p.id)}
                                  className="text-left rounded-md transition-all px-3 py-2.5"
                                  style={{
                                    background: isOn ? 'rgba(63,77,204,0.06)' : '#F9FAFB',
                                    border: `1.5px solid ${isOn ? '#3F4DCC' : '#E5E7EB'}`,
                                  }}>
                            <div className="flex items-start gap-2">
                              <div className="w-3.5 h-3.5 rounded-full shrink-0 mt-0.5"
                                   style={{ background: isOn ? '#3F4DCC' : 'transparent', border: `1.5px solid ${isOn ? '#3F4DCC' : '#D1D5DB'}` }} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <div className="text-[12.5px] font-medium"
                                       style={{ color: isOn ? '#3F4DCC' : '#111827' }}>{p.label}</div>
                                  {isRecommended && (
                                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                                          style={{ background: '#3F4DCC', color: '#FFFFFF', fontWeight: 600 }}>
                                      Recommended
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10.5px] mt-0.5" style={{ color: '#6B7280' }}>{p.desc}</div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Starter widgets — kept as compact card grid. Per
                      UX feedback added vertical breathing room between
                      this section and the portfolio section above. */}
                  <div className="pt-2">
                    <label className="text-[10px] uppercase tracking-[1.2px] mb-1.5 block"
                           style={{ color: '#6B7280', fontWeight: 600 }}>
                      Starter widgets · pick what to show on Trade
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: 'chart',     label: 'Price chart' },
                        { id: 'watchlist', label: 'Watchlist' },
                        { id: 'news',      label: 'News feed' },
                        { id: 'orderbook', label: 'Order book' },
                        { id: 'positions', label: 'Positions' },
                        { id: 'orderentry',label: 'Buy/sell pane' },
                        { id: 'predictions',label: 'Predictions' },
                        { id: 'darkflow',  label: 'Dark pool flow' },
                      ].map(w => {
                        const isOn = starterWidgets.includes(w.id);
                        return (
                          <SelectCard key={w.id} active={isOn}
                                      onClick={() => setStarterWidgets(s =>
                                        isOn ? s.filter(x => x !== w.id) : [...s, w.id]
                                      )}
                                      title={w.label}
                                      compact multi />
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {err && (
                <div className="px-3 py-2 rounded-md text-[11px]"
                     style={{ background: 'rgba(237,112,136,0.08)', color: LIGHT.red, border: '1px solid rgba(237,112,136,0.2)' }}>
                  {err}
                </div>
              )}
            </div>
          )}
          {step === 3 && (
              <div className="flex items-center gap-2 mt-2">
                <button onClick={() => {
                          // Back: from sub-step 'b' go to 'a'; from 'a' go to step 2.
                          if (aboutSubStep === 'b') { setAboutSubStep('a'); setErr(null); }
                          else { setStep(2); setErr(null); }
                        }}
                        className="px-4 py-3 rounded-md text-[13px] border transition-colors"
                        style={{ color: LIGHT.textDim, borderColor: LIGHT.border }}>Back</button>
                <button onClick={handleStep3}
                        className="flex-1 py-3 rounded-md text-[13px] font-semibold transition-all hover:bg-[rgba(63,77,204,0.04)]"
                        style={{
                          color: '#3F4DCC',
                          background: '#FFFFFF',
                          border: '2px solid #3F4DCC',
                          boxShadow: '0 1px 2px rgba(63,77,204,0.08)',
                        }}>
                  {aboutSubStep === 'a' ? 'Next' : 'Create account & enter Onyx'}
                </button>
              </div>
          )}
          </div>
        </div>
      </div>
      {/* Forgot password modal — issues a reset email simulation since this
          is a browser-only demo. Real implementation would call an auth API. */}
      {showForgotModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.6)' }}
             onClick={() => { setShowForgotModal(false); setForgotSent(false); setForgotEmail(''); }}>
          <div onClick={e => e.stopPropagation()}
               className="rounded-md overflow-hidden w-[420px] max-w-full"
               style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
            <div className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={18} style={{ color: '#3F4DCC' }} />
                <h3 className="text-[18px] font-medium" style={{ color: '#111827' }}>Reset your password</h3>
              </div>
              {!forgotSent ? (
                <>
                  <p className="text-[13px] mb-4" style={{ color: '#6B7280' }}>
                    Enter the email associated with your account and we'll send you a reset link.
                  </p>
                  <input value={forgotEmail}
                         onChange={e => setForgotEmail(e.target.value)}
                         type="email"
                         placeholder="you@example.com"
                         className="w-full px-3 py-2.5 rounded text-[13px] outline-none"
                         style={{ background: '#F9FAFB', color: '#111827', border: '1px solid #D1D5DB' }} />
                  <div className="flex items-center gap-2 mt-4">
                    <button onClick={() => { setShowForgotModal(false); setForgotEmail(''); }}
                            className="flex-1 py-2 rounded text-[12.5px] border"
                            style={{ background: '#FFFFFF', color: '#6B7280', borderColor: '#D1D5DB' }}>
                      Cancel
                    </button>
                    <button onClick={() => forgotEmail && setForgotSent(true)}
                            disabled={!forgotEmail.includes('@')}
                            className="flex-1 py-2 rounded text-[12.5px] font-medium disabled:opacity-40"
                            style={{ background: '#3F4DCC', color: '#FFFFFF' }}>
                      Send reset link
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-center py-4">
                    <Mail size={32} style={{ color: '#3F4DCC', margin: '0 auto' }} />
                    <div className="text-[14px] mt-2" style={{ color: '#111827' }}>Check your inbox</div>
                    <div className="text-[11.5px] mt-1.5" style={{ color: '#6B7280' }}>
                      We sent a reset link to <strong>{forgotEmail}</strong>. The link expires in 30 minutes.
                    </div>
                  </div>
                  <button onClick={() => { setShowForgotModal(false); setForgotSent(false); setForgotEmail(''); }}
                          className="w-full py-2 rounded text-[12.5px] font-medium"
                          style={{ background: '#3F4DCC', color: '#FFFFFF' }}>
                    Got it
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
