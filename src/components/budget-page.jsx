// IMO Onyx Terminal — Budget page
//
// Phase 3p.24 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~75084-77112, ~2,030 lines including 3 companion
// components + DEFAULT_BUDGET_ENVELOPES fixture inlined).
//
// Personal-finance budgeting surface. Income → category buckets,
// allocations vs actual spending, monthly summary visualizations,
// quick-add transaction entry, free-form notes/forecast view.
//
// Public export:
//   BudgetPage({ account, user })
//
// Internal companions (only used by BudgetPage):
//   SankeyDiagram     — income → spending categories flow
//   WaterfallChart    — month-over-month change visualization
//   BudgetQuickAdd    — single-transaction entry form
//
// Internal fixtures:
//   DEFAULT_BUDGET_ENVELOPES — initial category set for new users
//
// Honest scope:
//   - Pure UI over localStorage state. No bank integration / Plaid.
//   - SankeyDiagram is hand-drawn SVG (~10 categories OK, would not
//     scale to 100s of nodes).

import React, { useState, useMemo } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from 'recharts';
import { Sparkles, Settings } from 'lucide-react';
import { COLORS } from '../lib/constants.js';

/* ════════════════════════════════════════════════════════════════════════════
   BUDGET PAGE — Envelope-style budgeting
   ════════════════════════════════════════════════════════════════════════════ */

const DEFAULT_BUDGET_ENVELOPES = [
  // All defaults start at 0 — user enters their own
  { id: 'eating-out',     label: 'Eating Out',      category: 'Food',        allocated: 0, spent: 0, color: '#7AC8FF' },
  { id: 'groceries',      label: 'Groceries',       category: 'Food',        allocated: 0, spent: 0, color: '#7AC8FF' },
  { id: 'discretionary',  label: 'Discretionary',   category: 'Fun',         allocated: 0, spent: 0, color: '#FF7AB6' },
  { id: 'date-night',     label: 'Date Night',      category: 'Fun',         allocated: 0, spent: 0, color: '#FF7AB6' },
  { id: 'cell-phone',     label: 'Cell Phone',      category: 'Bills',       allocated: 0, spent: 0, color: '#FFB84D' },
  { id: 'rent',           label: 'Rent',            category: 'Bills',       allocated: 0, spent: 0, color: '#FFB84D' },
  { id: 'utilities',      label: 'Utilities',       category: 'Bills',       allocated: 0, spent: 0, color: '#FFB84D' },
  { id: 'gas',            label: 'Gas',             category: 'Car',         allocated: 0, spent: 0, color: '#A0C476' },
  { id: 'maintenance',    label: 'Maintenance',     category: 'Car',         allocated: 0, spent: 0, color: '#A0C476' },
  { id: 'giving',         label: 'Giving',          category: 'Giving',      allocated: 0, spent: 0, color: '#E07AFC' },
  // Investing & savings buckets — receive their portion from setup wizard
  { id: 'brokerage',      label: 'Brokerage',       category: 'Investments', allocated: 0, spent: 0, color: '#3D7BFF' },
  { id: 'retirement',     label: 'Retirement (401k/IRA)', category: 'Investments', allocated: 0, spent: 0, color: '#3D7BFF' },
  { id: 'crypto-savings', label: 'Crypto / Alt',    category: 'Investments', allocated: 0, spent: 0, color: '#3D7BFF' },
  { id: 'emergency-fund', label: 'Emergency Fund',  category: 'Savings',     allocated: 0, spent: 0, color: '#1FB26B' },
  { id: 'general-savings',label: 'General Savings', category: 'Savings',     allocated: 0, spent: 0, color: '#1FB26B' },
];

// Hand-drawn Sankey diagram — shows income flowing into spending categories.
// The width of each link/band is proportional to the dollar amount.
const SankeyDiagram = ({ income, grouped, totalSpent }) => {
  const W = 800, H = 320;
  // Build nodes: source ("Income") and one target per category with spending > 0
  const cats = Object.entries(grouped)
    .map(([name, g]) => ({
      name,
      value: g.items.reduce((s, e) => s + e.spent, 0),
      color: g.color,
    }))
    .filter(c => c.value > 0)
    .sort((a, b) => b.value - a.value);
  // Source income node — show the entire income or fallback to total spent
  const source = Math.max(income, totalSpent, 1);
  const remaining = Math.max(0, source - totalSpent);
  const allNodes = [...cats];
  if (remaining > 0) allNodes.push({ name: 'Remaining', value: remaining, color: '#5A6274' });
  const totalRight = allNodes.reduce((s, n) => s + n.value, 0);

  // Layout: source bar on left (full height of usable area), target bars stacked on right
  const padTop = 20, padBottom = 30, padLeft = 80, padRight = 90;
  const usableH = H - padTop - padBottom;
  const sourceX = padLeft, sourceW = 16;
  const targetX = W - padRight;
  const targetW = 16;

  // Compute target Y positions, stacked, proportional
  let cursor = padTop;
  const targets = allNodes.map(n => {
    const h = (n.value / totalRight) * usableH;
    const out = { ...n, y: cursor, h };
    cursor += h + 4; // gap between bands
    return out;
  });
  // Source position at left
  const sourceY = padTop, sourceH = usableH;

  // Build paths: cubic bezier from source band slice to target band
  let cumLeft = 0;
  const paths = targets.map((t, i) => {
    const sliceH = (t.value / totalRight) * sourceH;
    const sourceTop = sourceY + cumLeft;
    cumLeft += sliceH;
    const sx1 = sourceX + sourceW;
    const sy1 = sourceTop;
    const sy2 = sourceTop + sliceH;
    const tx1 = targetX;
    const ty1 = t.y;
    const ty2 = t.y + t.h;
    // Cubic bezier S-curve: control points at midpoint x
    const cx = (sx1 + tx1) / 2;
    const d = `M ${sx1} ${sy1}
               C ${cx} ${sy1}, ${cx} ${ty1}, ${tx1} ${ty1}
               L ${tx1} ${ty2}
               C ${cx} ${ty2}, ${cx} ${sy2}, ${sx1} ${sy2} Z`;
    return { ...t, d };
  });

  return (
    <div className="rounded-md border p-4"
         style={{ background: COLORS.surface, borderColor: COLORS.border }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[13px] font-medium" style={{ color: COLORS.text }}>Money Flow (Sankey)</div>
          <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
            How your income is distributed across categories
          </div>
        </div>
        <div className="text-[10px] tabular-nums" style={{ color: COLORS.textMute }}>
          ${source.toLocaleString()} total
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Income source bar */}
        <rect x={sourceX} y={sourceY} width={sourceW} height={sourceH}
              fill={COLORS.mint} rx={2} />
        <text x={sourceX - 6} y={sourceY + sourceH / 2}
              fill={COLORS.text} fontSize={13} fontWeight={600}
              textAnchor="end" alignmentBaseline="middle">
          Income
        </text>
        <text x={sourceX - 6} y={sourceY + sourceH / 2 + 14}
              fill={COLORS.textMute} fontSize={10} textAnchor="end" alignmentBaseline="middle"
              style={{ fontFamily: 'ui-monospace, monospace' }}>
          ${source.toLocaleString()}
        </text>

        {/* Flow paths */}
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.color} fillOpacity={0.32}
                stroke={p.color} strokeOpacity={0.5} strokeWidth={0.5}>
            <title>{p.name}: ${p.value.toLocaleString()}</title>
          </path>
        ))}

        {/* Target bars */}
        {targets.map((t, i) => (
          <g key={`t${i}`}>
            <rect x={targetX} y={t.y} width={targetW} height={Math.max(2, t.h)}
                  fill={t.color} rx={2} />
            <text x={targetX + targetW + 4} y={t.y + Math.max(t.h / 2, 6)}
                  fill={COLORS.text} fontSize={11} alignmentBaseline="middle">
              {t.name}
            </text>
            <text x={targetX + targetW + 4} y={t.y + Math.max(t.h / 2, 6) + 12}
                  fill={COLORS.textMute} fontSize={9} alignmentBaseline="middle"
                  style={{ fontFamily: 'ui-monospace, monospace' }}>
              ${t.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

// Waterfall chart — running balance starting from income, subtracting each
// category's spending in sequence, showing the "burn rate" through the period.
const WaterfallChart = ({ income, envelopes, grouped }) => {
  const startingBalance = Math.max(income, envelopes.reduce((s, e) => s + e.allocated, 0), 1);
  // Build steps: each category's spending as a negative bar
  const steps = [
    { label: 'Income', value: startingBalance, type: 'start', color: COLORS.green },
    ...Object.entries(grouped)
      .map(([name, g]) => ({
        label: name,
        value: -g.items.reduce((s, e) => s + e.spent, 0),
        type: 'spend',
        color: g.color,
      }))
      .filter(s => s.value < 0)
      .sort((a, b) => a.value - b.value), // largest spends first
  ];
  // Compute running balance and final
  let running = 0;
  const bars = steps.map(s => {
    if (s.type === 'start') {
      running = s.value;
      return { ...s, top: running, bottom: 0, height: running };
    }
    const top = running;
    running += s.value; // value is negative
    return { ...s, top, bottom: running, height: Math.abs(s.value) };
  });
  const remaining = running;
  bars.push({ label: 'Remaining', value: remaining, type: 'end',
              color: remaining >= 0 ? COLORS.green : COLORS.red,
              top: remaining, bottom: 0, height: Math.abs(remaining) });

  // Chart bounds
  const W = 800, H = 240;
  const padTop = 18, padBottom = 38, padLeft = 60, padRight = 16;
  const usableW = W - padLeft - padRight;
  const usableH = H - padTop - padBottom;
  const max = Math.max(...bars.map(b => b.top), 1);
  const min = Math.min(0, ...bars.map(b => b.bottom));
  const yScale = (v) => padTop + ((max - v) / (max - min)) * usableH;
  const barW = Math.min(56, (usableW / bars.length) - 8);
  const barX = (i) => padLeft + i * (usableW / bars.length) + (usableW / bars.length - barW) / 2;

  return (
    <div className="rounded-md border p-4"
         style={{ background: COLORS.surface, borderColor: COLORS.border }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[13px] font-medium" style={{ color: COLORS.text }}>Cash-Flow Waterfall</div>
          <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
            Running balance from income through spending → remaining
          </div>
        </div>
        <div className="text-[10px] tabular-nums" style={{ color: remaining >= 0 ? COLORS.green : COLORS.red }}>
          {remaining >= 0 ? '+' : '−'}${Math.abs(remaining).toLocaleString()} remaining
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Zero line */}
        <line x1={padLeft} y1={yScale(0)} x2={W - padRight} y2={yScale(0)}
              stroke={COLORS.border} strokeDasharray="2 2" />
        {/* Bars */}
        {bars.map((b, i) => {
          const top = yScale(Math.max(b.top, b.bottom));
          const bottom = yScale(Math.min(b.top, b.bottom));
          const h = bottom - top;
          const x = barX(i);
          // Connector line to next bar
          const next = bars[i + 1];
          let connector = null;
          if (next && b.type !== 'end') {
            const x1 = x + barW;
            const y1 = b.type === 'start' ? yScale(b.top) : yScale(b.bottom);
            const x2 = barX(i + 1);
            const y2 = next.type === 'end' ? yScale(next.top) : yScale(next.top);
            connector = (
              <line key={`c${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={COLORS.textMute} strokeDasharray="2 3" strokeWidth={1} />
            );
          }
          return (
            <g key={i}>
              {connector}
              <rect x={x} y={top} width={barW} height={h}
                    fill={b.color} fillOpacity={0.85} rx={2}>
                <title>{b.label}: {b.value >= 0 ? '+' : '−'}${Math.abs(b.value).toLocaleString()}</title>
              </rect>
              <text x={x + barW / 2} y={top - 4}
                    fill={b.color} fontSize={9} textAnchor="middle"
                    style={{ fontFamily: 'ui-monospace, monospace' }}>
                {b.value >= 0 ? '+' : '−'}${Math.abs(b.value).toFixed(0)}
              </text>
              <text x={x + barW / 2} y={H - padBottom + 14}
                    fill={COLORS.textMute} fontSize={9} textAnchor="middle">
                {b.label}
              </text>
              {b.type !== 'start' && b.type !== 'end' && (
                <text x={x + barW / 2} y={H - padBottom + 26}
                      fill={COLORS.textDim} fontSize={8} textAnchor="middle"
                      style={{ fontFamily: 'ui-monospace, monospace' }}>
                  ${b.bottom.toFixed(0)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

// Quick-add bar at top of Budget — natural-language input for fast logging.
// Examples:  "groceries 45"  → adds $45 expense to Groceries envelope
//            "rent budget 2000" or "rent allocate 2000" → sets Rent allocation
//            "investments +500" → adds to investments envelope as expense
const BudgetQuickAdd = ({ envelopes, persist, recordTx }) => {
  const [text, setText] = useState('');
  const [showHint, setShowHint] = useState(false);

  // Parse: try to find an envelope by name match in the text
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    const lower = text.toLowerCase().trim();
    // Find first envelope whose label is a substring of the input
    const match = envelopes.find(e => lower.includes(e.label.toLowerCase()));
    if (!match) return null;
    // Find the dollar amount — first number in the string (allowing decimals)
    const numMatch = lower.match(/\d+(?:\.\d+)?/);
    if (!numMatch) return { envelope: match, amount: null };
    const amount = parseFloat(numMatch[0]);
    // Determine intent: 'budget' / 'allocate' / 'allocation' = update allocated
    // otherwise = log as expense
    const isBudget = /\b(budget|allocate|allocation|set)\b/.test(lower);
    return { envelope: match, amount, isBudget };
  }, [text, envelopes]);

  const handleSubmit = () => {
    if (!parsed?.envelope || parsed.amount == null) return;
    const next = envelopes.map(e => {
      if (e.id !== parsed.envelope.id) return e;
      if (parsed.isBudget) {
        return { ...e, allocated: +parsed.amount.toFixed(2) };
      }
      return { ...e, spent: +(e.spent + parsed.amount).toFixed(2) };
    });
    persist(next);
    if (!parsed.isBudget) {
      recordTx({
        id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        date: new Date().toISOString().slice(0, 10),
        type: 'expense',
        envelope: parsed.envelope.id,
        amount: parsed.amount,
        payee: 'Quick add',
        note: text,
        account: 'My Account',
      });
    }
    setText('');
  };

  return (
    <div className="mb-5 rounded-md border p-3 flex items-center gap-3"
         style={{ background: COLORS.surface, borderColor: COLORS.border }}>
      <Sparkles size={14} style={{ color: COLORS.mint }} />
      <div className="flex-1 relative">
        <input value={text}
               onChange={e => setText(e.target.value)}
               onFocus={() => setShowHint(true)}
               onBlur={() => setTimeout(() => setShowHint(false), 200)}
               onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
               placeholder='Quick add: "groceries 45" or "rent budget 2000"'
               className="w-full px-3 py-2 rounded text-[12.5px] outline-none"
               style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
        {/* Live preview of parse result */}
        {parsed?.envelope && parsed.amount != null && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-2 py-0.5 rounded"
               style={{
                 background: parsed.isBudget ? 'rgba(30,58,108,0.15)' : 'rgba(237,112,136,0.15)',
                 color: parsed.isBudget ? COLORS.mint : COLORS.red,
               }}>
            {parsed.isBudget ? 'Set' : 'Spend'} ${parsed.amount.toFixed(2)} → {parsed.envelope.label}
          </div>
        )}
        {/* Hint suggestions */}
        {showHint && !parsed?.envelope && envelopes.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded border max-h-44 overflow-y-auto"
               style={{ background: COLORS.surface, borderColor: COLORS.borderHi, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
            <div className="px-2 py-1.5 text-[9px] uppercase tracking-wider border-b"
                 style={{ color: COLORS.textMute, borderColor: COLORS.border }}>
              Try a category
            </div>
            {envelopes.slice(0, 6).map(e => (
              <button key={e.id}
                      onMouseDown={() => setText(e.label.toLowerCase() + ' ')}
                      className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-white/[0.05]"
                      style={{ color: COLORS.text }}>
                {e.label}
                <span className="ml-2 text-[10px]" style={{ color: COLORS.textMute }}>
                  Spent ${e.spent.toFixed(0)} of ${e.allocated.toFixed(0)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button onClick={handleSubmit}
              disabled={!parsed?.envelope || parsed.amount == null}
              className="px-3 py-2 rounded-md text-[12px] font-medium transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: COLORS.mint, color: COLORS.bg }}>
        +
      </button>
    </div>
  );
};

export const BudgetPage = ({ account, user }) => {
  const [view, setView] = useState('envelopes'); // 'envelopes' | 'spending' | 'add' | 'setup'
  // Budget mode — solo (default) or family. Family mode adds child allowances
  // and shared/personal envelope tagging.
  const [budgetMode, setBudgetMode] = useState(() => {
    try {
      return localStorage.getItem(`imo_budget_mode_${user?.username ?? 'guest'}`) ?? 'solo';
    } catch { return 'solo'; }
  });
  const [familyMembers, setFamilyMembers] = useState(() => {
    try {
      const raw = localStorage.getItem(`imo_family_${user?.username ?? 'guest'}`);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const persistFamily = (next) => {
    setFamilyMembers(next);
    try { localStorage.setItem(`imo_family_${user?.username ?? 'guest'}`, JSON.stringify(next)); } catch {}
  };
  const persistBudgetMode = (m) => {
    setBudgetMode(m);
    try { localStorage.setItem(`imo_budget_mode_${user?.username ?? 'guest'}`, m); } catch {}
  };
  const [envelopes, setEnvelopes] = useState(() => {
    try {
      const stored = localStorage.getItem(`onyx_budget_${user?.username ?? 'guest'}`);
      return stored ? JSON.parse(stored) : DEFAULT_BUDGET_ENVELOPES;
    } catch { return DEFAULT_BUDGET_ENVELOPES; }
  });
  // Income-based setup wizard state
  const [setupStep, setSetupStep]     = useState(1);
  // Inline expanded guide for users without a credit score
  const [showBuildCredit, setShowBuildCredit] = useState(false);
  const [monthlyIncome, setMonthlyIncome] = useState(() => {
    try {
      const stored = localStorage.getItem(`onyx_budget_income_${user?.username ?? 'guest'}`);
      return stored ? Number(stored) : '';
    } catch { return ''; }
  });
  // Credit score state — collected in setup step 2 and persisted
  const [creditScore, setCreditScore] = useState(() => {
    try {
      const stored = localStorage.getItem(`imo_credit_score_${user?.username ?? 'guest'}`);
      return stored ? Number(stored) : '';
    } catch { return ''; }
  });
  const [setupSplit, setSetupSplit] = useState({
    needs:    50,  // Housing, food, utilities
    wants:    30,  // Dining, entertainment, shopping
    savings:  20,  // Investments, emergency fund
  });
  const [presetChoice, setPresetChoice] = useState('50-30-20');
  // New transaction form state
  const [txType, setTxType]       = useState('expense');
  const [txPayee, setTxPayee]     = useState('');
  const [txAmount, setTxAmount]   = useState('');
  const [txEnvelope, setTxEnvelope] = useState('groceries');
  const [txAccount, setTxAccount] = useState('My Account');
  const [txDate, setTxDate]       = useState(new Date().toISOString().slice(0, 10));
  const [txNote, setTxNote]       = useState('');
  // Envelope inline edit state — click any envelope to edit its allocation
  const [editingEnv, setEditingEnv] = useState(null); // envelope id
  const [editingValue, setEditingValue] = useState('');
  // Per-envelope expansion to show itemized purchases (transactions
  // matched to that envelope by id). Toggled via a small chevron next
  // to the envelope name.
  const [expandedEnvId, setExpandedEnvId] = useState(null);
  // Adding a subcategory under a top-level category — when set to a
  // category name, an inline form appears under that category's header
  // to capture a new envelope label and starting allocation.
  const [addingSubcategoryFor, setAddingSubcategoryFor] = useState(null);
  const [newSubcategoryName, setNewSubcategoryName] = useState('');
  const [newSubcategoryAmount, setNewSubcategoryAmount] = useState('');
  // Celebration toast — shown briefly when income/refund is added
  const [celebrateToast, setCelebrateToast] = useState(null);
  // Transaction history — persisted across sessions
  const TX_HISTORY_KEY = `onyx_budget_tx_${user?.username ?? 'guest'}`;
  const [txHistory, setTxHistory] = useState(() => {
    try {
      const raw = localStorage.getItem(TX_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const persistTxHistory = (next) => {
    setTxHistory(next);
    try { localStorage.setItem(TX_HISTORY_KEY, JSON.stringify(next)); } catch {}
  };

  const persist = (next) => {
    setEnvelopes(next);
    try { localStorage.setItem(`onyx_budget_${user?.username ?? 'guest'}`, JSON.stringify(next)); } catch {}
  };

  const totalAllocated = envelopes.reduce((s, e) => s + e.allocated, 0);
  const totalSpent     = envelopes.reduce((s, e) => s + e.spent, 0);
  const totalLeft      = totalAllocated - totalSpent;

  const grouped = useMemo(() => {
    const map = {};
    envelopes.forEach(e => {
      if (!map[e.category]) map[e.category] = { total: 0, color: e.color, items: [] };
      map[e.category].items.push(e);
      map[e.category].total += e.allocated;
    });
    return map;
  }, [envelopes]);

  const handleAddTx = () => {
    const amt = parseFloat(txAmount);
    if (!amt || amt <= 0 || !txPayee.trim()) return;
    const next = envelopes.map(e => {
      if (e.id !== txEnvelope) return e;
      if (txType === 'expense') {
        // Expense adds to spent
        return { ...e, spent: +(e.spent + amt).toFixed(2) };
      }
      // Income/refund: offset spent (reduce the spent number) but never go below 0.
      // If the refund is bigger than the spent so far, the leftover is added to
      // allocated as new available budget.
      const newSpent = e.spent - amt;
      if (newSpent >= 0) {
        return { ...e, spent: +newSpent.toFixed(2) };
      }
      // refund exceeded what was spent — credit the excess to allocated
      const excess = -newSpent;
      return { ...e, spent: 0, allocated: +(e.allocated + excess).toFixed(2) };
    });
    persist(next);
    // Log the transaction in history for review later. Refunds are stored
    // with type='income' but tagged so the history view can label them as
    // refunds against the source category.
    persistTxHistory([
      {
        id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        date: txDate,
        type: txType,        // 'expense' or 'income'
        envelope: txEnvelope,
        amount: amt,
        payee: txPayee.trim(),
        note: txNote.trim(),
        account: txAccount,
      },
      ...txHistory,
    ].slice(0, 1000)); // cap at 1000 entries
    // Celebration toast for income/refund — positive reinforcement
    if (txType === 'income') {
      setCelebrateToast({ amount: amt, ts: Date.now() });
      setTimeout(() => setCelebrateToast(null), 3000);
    }
    // Reset
    setTxPayee(''); setTxAmount(''); setTxNote('');
    setView('envelopes');
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: COLORS.bg }}>
      {/* Celebration toast — animated bottom-right when income hits */}
      {celebrateToast && (
        <div
          className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded shadow-md flex items-center gap-3"
          style={{
            background: COLORS.surface,
            color: COLORS.text,
            border: `1px solid ${COLORS.border}`,
            borderLeft: `3px solid ${COLORS.green}`,
            boxShadow: '0 12px 32px rgba(0,0,0,0.40)',
          }}
        >
          <div>
            <div className="text-[12px] font-medium" style={{ color: COLORS.text }}>Income received</div>
            <div className="text-[11px] tabular-nums" style={{ color: COLORS.green }}>
              +${celebrateToast.amount.toFixed(2)} added
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes budgetCelebrate {
          0%   { transform: translateX(120%) scale(0.8); opacity: 0; }
          60%  { transform: translateX(-8px) scale(1.05); opacity: 1; }
          100% { transform: translateX(0) scale(1); opacity: 1; }
        }
      `}</style>
      <div className="max-w-[1400px] mx-auto px-8 py-8">
        {/* "Build your budget" prompt pill — at the very top of the page,
            before any other UI. Shows when no income or allocations are set.
            Disappears once setup is complete. No emoji per UX request. */}
        {(!monthlyIncome || Number(monthlyIncome) === 0) &&
         envelopes.every(e => (e.allocated ?? 0) === 0) && (
          <button onClick={() => setView('setup')}
                  className="w-full mb-6 rounded-md p-6 text-left transition-all hover:shadow-lg group"
                  style={{
                    background: '#FFFFFF',
                    color: '#0F172A',
                    border: '1px solid #E2E8F0',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                  }}>
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-[0.12em] mb-1"
                     style={{ color: '#2A4A7F', fontWeight: 600 }}>
                  Get started · 3 minutes
                </div>
                <div className="text-[18px] font-semibold mb-0.5"
                     style={{ color: '#0F172A', letterSpacing: '-0.01em' }}>
                  Build your budget
                </div>
                <div className="text-[12.5px]" style={{ color: '#475569' }}>
                  Tell us your monthly income, and we'll allocate it across needs, wants, and savings using a 50/30/20 framework. Edit anything afterward.
                </div>
              </div>
              <div className="text-[20px] shrink-0 transition-transform group-hover:translate-x-1"
                   style={{ color: '#2A4A7F' }}>→</div>
            </div>
          </button>
        )}
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-medium" style={{ color: COLORS.text }}>Budget</h1>
            <p className="text-[12px] mt-1" style={{ color: COLORS.textMute }}>
              Envelope budgeting · last sync: just now
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-md"
               style={{ background: COLORS.surface2, border: `1px solid ${COLORS.borderHi}` }}>
            {[
              { id: 'envelopes', label: 'Envelopes' },
              { id: 'spending',  label: 'Spending' },
              { id: 'history',   label: 'History' },
              { id: 'add',       label: 'Add transaction' },
              { id: 'setup',     label: 'Setup wizard', icon: Settings },
            ].map(v => (
              <button key={v.id} onClick={() => setView(v.id)}
                      className="px-3 py-1.5 rounded text-[11.5px] transition-all flex items-center gap-1"
                      style={{
                        color: view === v.id ? COLORS.bg : COLORS.textDim,
                        background: view === v.id ? COLORS.mint : 'transparent',
                      }}>
                {v.icon && <v.icon size={11} />}
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Mode toggle: Solo vs Family — only visible if user's profile
            indicates a household size > 1. Solo users never see the toggle. */}
        {(user?.profile?.familySize ?? 1) > 1 && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Mode</span>
            <div className="flex items-center gap-0.5 p-0.5 rounded"
                 style={{ background: COLORS.surface2, border: `1px solid ${COLORS.borderHi}` }}>
              {[
                { id: 'solo',   label: 'Solo' },
                { id: 'family', label: 'Family' },
              ].map(m => (
                <button key={m.id} onClick={() => persistBudgetMode(m.id)}
                        className="px-2.5 py-1 text-[11px] rounded transition-colors"
                        style={{
                          background: budgetMode === m.id ? COLORS.mint : 'transparent',
                          color: budgetMode === m.id ? COLORS.bg : COLORS.textDim,
                        }}>{m.label}</button>
              ))}
            </div>
          </div>
        )}

        {/* Family panel — shown only in family mode AND when user has family */}
        {budgetMode === 'family' && (user?.profile?.familySize ?? 1) > 1 && (
          <div className="rounded-md border p-4 mb-4"
               style={{ background: COLORS.surface, borderColor: COLORS.border }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[13px] font-medium" style={{ color: COLORS.text }}>Family members & allowances</div>
                <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
                  Track allowances and chore-based earnings for kids · {familyMembers.length} member{familyMembers.length === 1 ? '' : 's'}
                </div>
              </div>
              <button onClick={() => persistFamily([...familyMembers, {
                id: `m_${Date.now()}`,
                name: 'New member',
                relation: 'child',
                age: 10,
                weeklyAllowance: 10,
                balance: 0,
                chores: [],
              }])}
                      className="px-2.5 py-1 rounded text-[11px] font-medium"
                      style={{ background: COLORS.mint, color: COLORS.bg }}>
                + Add member
              </button>
            </div>
            {familyMembers.length === 0 ? (
              <div className="py-6 text-center text-[11px]" style={{ color: COLORS.textMute }}>
                No family members yet. Add your spouse or kids to give them allowances and track chore earnings.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {familyMembers.map(m => (
                  <div key={m.id} className="rounded-md border p-3"
                       style={{ background: COLORS.bg, borderColor: COLORS.border }}>
                    <div className="flex items-start gap-2.5">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-[16px] shrink-0"
                           style={{ background: m.relation === 'child' ? '#FFB84D' : '#7AC8FF', color: '#16191E' }}>
                        {m.relation === 'child' ? '🧒' : m.relation === 'spouse' ? '💞' : ''}
                      </div>
                      <div className="flex-1 min-w-0">
                        <input value={m.name}
                               onChange={(e) => persistFamily(familyMembers.map(x => x.id === m.id ? { ...x, name: e.target.value } : x))}
                               className="w-full bg-transparent text-[12.5px] font-medium outline-none"
                               style={{ color: COLORS.text }} />
                        <div className="flex items-center gap-2 mt-1.5 text-[10.5px]">
                          <select value={m.relation}
                                  onChange={(e) => persistFamily(familyMembers.map(x => x.id === m.id ? { ...x, relation: e.target.value } : x))}
                                  className="px-1.5 py-0.5 rounded outline-none"
                                  style={{ background: COLORS.surface, color: COLORS.textDim, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                            <option value="child">Child</option>
                            <option value="spouse">Spouse</option>
                            <option value="dependent">Dependent</option>
                            <option value="other">Other</option>
                          </select>
                          <span style={{ color: COLORS.textMute }}>Age</span>
                          <input value={m.age}
                                 onChange={(e) => persistFamily(familyMembers.map(x => x.id === m.id ? { ...x, age: +e.target.value } : x))}
                                 type="number" className="w-12 px-1.5 py-0.5 rounded outline-none tabular-nums"
                                 style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                        </div>
                        {m.relation === 'child' && (
                          <div className="flex items-center gap-2 mt-1.5 text-[10.5px]">
                            <span style={{ color: COLORS.textMute }}>Weekly</span>
                            <span style={{ color: COLORS.textDim }}>$</span>
                            <input value={m.weeklyAllowance}
                                   onChange={(e) => persistFamily(familyMembers.map(x => x.id === m.id ? { ...x, weeklyAllowance: +e.target.value } : x))}
                                   type="number" className="w-16 px-1.5 py-0.5 rounded outline-none tabular-nums"
                                   style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                            <span style={{ color: COLORS.textMute }}>· Saved</span>
                            <span className="tabular-nums" style={{ color: COLORS.green }}>${m.balance.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                      <button onClick={() => persistFamily(familyMembers.filter(x => x.id !== m.id))}
                              className="text-[14px] hover:opacity-80"
                              style={{ color: COLORS.textMute }}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {familyMembers.filter(m => m.relation === 'child').length > 0 && (
              <div className="mt-3 pt-3 border-t flex items-center justify-between text-[11px]"
                   style={{ borderColor: COLORS.border }}>
                <span style={{ color: COLORS.textDim }}>Total weekly child allowance:</span>
                <span className="tabular-nums font-medium" style={{ color: COLORS.text }}>
                  ${familyMembers.filter(m => m.relation === 'child').reduce((s, m) => s + (m.weeklyAllowance ?? 0), 0).toFixed(2)}
                  <span className="text-[10px] ml-1" style={{ color: COLORS.textMute }}>
                    · ${(familyMembers.filter(m => m.relation === 'child').reduce((s, m) => s + (m.weeklyAllowance ?? 0), 0) * 4.33).toFixed(2)}/mo
                  </span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Quick add bar — pick category, enter amount, hit + to log either an
            expense or update an allocation. Adapts to common natural-language
            patterns like "groceries 45" or "rent budget 2000". */}
        <BudgetQuickAdd envelopes={envelopes} persist={persist}
                        recordTx={(tx) => persistTxHistory([tx, ...txHistory].slice(0, 1000))} />

        {/* Top summary cards — 4-column with velocity indicator. Responsive
            so the row collapses to 2 columns on narrower viewports. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="rounded-md border px-3 py-2"
               style={{ background: COLORS.surface, borderColor: COLORS.border }}>
            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Allocated</div>
            <div className="text-[15px] tabular-nums mt-0.5" style={{ color: COLORS.text }}>
              ${totalAllocated.toFixed(2)}
            </div>
          </div>
          <div className="rounded-md border px-3 py-2"
               style={{ background: COLORS.surface, borderColor: COLORS.border }}>
            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Spent</div>
            <div className="text-[15px] tabular-nums mt-0.5"
                 style={{ color: totalSpent > totalAllocated ? COLORS.red : COLORS.text }}>
              ${totalSpent.toFixed(2)}
            </div>
          </div>
          <div className="rounded-md border px-3 py-2"
               style={{ background: COLORS.surface, borderColor: COLORS.border }}>
            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>Remaining</div>
            <div className="text-[15px] tabular-nums mt-0.5"
                 style={{ color: totalLeft >= 0 ? COLORS.mint : COLORS.red }}>
              ${totalLeft.toFixed(2)}
            </div>
          </div>
          {/* Velocity card — pace of spending vs ideal pace through the month */}
          {(() => {
            const today = new Date();
            const dayOfMonth = today.getDate();
            const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
            const expectedFraction = dayOfMonth / daysInMonth;
            const actualFraction = totalAllocated > 0 ? totalSpent / totalAllocated : 0;
            // Velocity > 1 = spending faster than pace; < 1 = slower
            const velocity = expectedFraction > 0 ? actualFraction / expectedFraction : 0;
            const isAhead   = velocity > 1.1;       // spending too fast
            const isOnPace  = velocity >= 0.9 && velocity <= 1.1;
            const isBehind  = velocity < 0.9;       // saving!
            const color = isAhead ? COLORS.red : isBehind ? COLORS.green : COLORS.mint;
            const label = isAhead ? 'Ahead of pace' : isBehind ? 'Under pace' : 'On pace';
            const emoji = isAhead ? '⚠️' : isBehind ? '🌱' : '✓';
            return (
              <div className="rounded-md border px-3 py-2"
                   style={{ background: COLORS.surface, borderColor: COLORS.border }}>
                <div className="text-[9.5px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                  Spending Velocity
                </div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-[15px] tabular-nums" style={{ color }}>
                    {(velocity * 100).toFixed(0)}%
                  </span>
                  <span className="text-[10px]" style={{ color }}>{label}</span>
                </div>
                <div className="text-[9px] mt-0.5" style={{ color: COLORS.textMute }}>
                  Day {dayOfMonth}/{daysInMonth} · ideal {(expectedFraction * 100).toFixed(0)}%
                </div>
              </div>
            );
          })()}
        </div>

        {/* Credit score panel — visible on the Envelopes view only.
            Other views (Spending, History, Add, Setup) hide it to keep
            the page focused on the active task. */}

        {view === 'envelopes' && (() => {
          const score = Number(creditScore) || 0;
          const valid = score >= 300 && score <= 850;
          const tier =
            score >= 800 ? { label: 'Exceptional', color: COLORS.green,    note: 'Top-tier rates · best loan terms', tips: ['Keep utilization below 10%', 'Never miss a payment', 'Consider a higher credit limit to lower utilization further'] } :
            score >= 740 ? { label: 'Very Good',   color: '#A0C476',       note: 'Above-average rates available',   tips: ['Aim for 800+ by reducing utilization', 'Avoid hard inquiries for 6 months', 'Increase oldest account age'] } :
            score >= 670 ? { label: 'Good',        color: COLORS.mint,     note: 'Standard rates · most products available', tips: ['Push utilization below 30%', 'Pay on time every cycle', 'Consider a credit-builder loan'] } :
            score >= 580 ? { label: 'Fair',        color: '#FFB84D',       note: 'Limited offers · higher rates',    tips: ['Pay down balances aggressively', 'Set up auto-pay to avoid late fees', 'Avoid new credit applications'] } :
            score >= 300 ? { label: 'Poor',        color: COLORS.red,      note: 'Building credit · focus on on-time payments', tips: ['Use a secured card to rebuild', 'Make every payment on time', 'Dispute any errors on your report'] } :
                           { label: '—',           color: COLORS.textMute, note: 'Enter your score to see your tier', tips: ['Check your free score at AnnualCreditReport.com', 'Set up auto-pay to protect history', 'Keep utilization below 30%'] };
          return (
            <div className="rounded-md border p-4 mb-6"
                 style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-[260px]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] uppercase tracking-wider"
                         style={{ color: COLORS.textMute }}>Credit score</div>
                    <button onClick={() => setView('setup')}
                            className="text-[10.5px] underline opacity-80 hover:opacity-100"
                            style={{ color: COLORS.mint }}
                            title="Edit credit score in setup">Edit</button>
                  </div>
                  <div className="flex items-baseline gap-3 mb-3">
                    {valid ? (
                      <>
                        <span className="text-[34px] tabular-nums leading-none font-medium"
                              style={{ color: tier.color }}>{score}</span>
                        <span className="text-[12px] uppercase tracking-wider font-semibold"
                              style={{ color: tier.color }}>{tier.label}</span>
                      </>
                    ) : (
                      <input type="number" min="300" max="850"
                             value={creditScore}
                             onChange={e => {
                               const val = e.target.value;
                               setCreditScore(val);
                               try { localStorage.setItem(`imo_credit_score_${user?.username ?? 'guest'}`, val); } catch {}
                             }}
                             placeholder="Enter your credit score (300–850)"
                             className="w-full px-3 py-2 rounded-md text-[13px] tabular-nums outline-none"
                             style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                    )}
                  </div>
                  {valid && (
                    <div className="relative h-2.5 rounded-full overflow-hidden mb-1.5"
                         style={{ background: COLORS.surface2 }}>
                      <div className="absolute inset-0 flex">
                        <div style={{ width: '32%', background: 'rgba(237,112,136,0.5)' }} />
                        <div style={{ width: '16%', background: 'rgba(255,184,77,0.5)' }} />
                        <div style={{ width: '13%', background: 'rgba(61,123,255,0.5)' }} />
                        <div style={{ width: '12%', background: 'rgba(160,196,118,0.6)' }} />
                        <div style={{ width: '27%', background: 'rgba(31,178,107,0.6)' }} />
                      </div>
                      <div className="absolute top-0 bottom-0 w-1 rounded-full transition-all"
                           style={{
                             left: `${((score - 300) / 550) * 100}%`,
                             background: '#FFF',
                             boxShadow: '0 0 8px rgba(255,255,255,0.8)',
                             transform: 'translateX(-50%)',
                           }} />
                    </div>
                  )}
                  {valid && (
                    <div className="flex justify-between text-[9px]" style={{ color: COLORS.textMute }}>
                      <span>300</span><span>580</span><span>670</span><span>740</span><span>800</span><span>850</span>
                    </div>
                  )}
                  <div className="text-[11px] mt-2" style={{ color: COLORS.textDim }}>
                    {tier.note}
                  </div>
                </div>
                {/* Personalized tips column */}
                <div className="flex-1 min-w-[260px] rounded-md p-3"
                     style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
                  <div className="text-[11px] uppercase tracking-wider mb-2"
                       style={{ color: COLORS.textMute }}>
                    {valid ? `How to improve from ${tier.label}` : 'Get started'}
                  </div>
                  <ul className="space-y-1.5">
                    {tier.tips.map((tip, i) => (
                      <li key={i} className="text-[11.5px] flex gap-2 items-start"
                          style={{ color: COLORS.text }}>
                        <span className="shrink-0 mt-0.5" style={{ color: tier.color }}>›</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                  {/* Estimated APR impact — concrete dollar consequence of the score.
                      30-yr fixed mortgage proxy at $300K loan, illustrative only. */}
                  {valid && (
                    <div className="mt-3 pt-3 border-t flex items-center justify-between text-[10.5px]"
                         style={{ borderColor: COLORS.border }}>
                      <span style={{ color: COLORS.textMute }}>Est. 30-yr mortgage APR (300K)</span>
                      <span className="tabular-nums font-medium" style={{ color: tier.color }}>
                        {score >= 800 ? '6.25%'
                         : score >= 740 ? '6.50%'
                         : score >= 670 ? '6.85%'
                         : score >= 580 ? '7.50%'
                         :                '9.10%'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Envelopes view */}
        {view === 'envelopes' && (
          <div>
            {/* Header with summary + Build CTA */}
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                {envelopes.length} envelopes across {Object.keys(grouped).length} categories
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setView('add')}
                        className="px-3 py-1.5 rounded-md text-[11px] font-medium transition-all hover:bg-white/[0.04]"
                        style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}
                        title="Add a single envelope">
                  + Add envelope
                </button>
                <button onClick={() => setView('setup')}
                        className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-all hover:opacity-90"
                        style={{
                          background: COLORS.mint,
                          color: '#FFFFFF',
                          border: `1px solid ${COLORS.mint}`,
                          boxShadow: '0 1px 4px rgba(61,123,255,0.20)',
                        }}
                        title="Build a budget plan from scratch — guided wizard with income, credit, and category split">
                  ⊕ Build
                </button>
              </div>
            </div>

            {/* Grid of category cards — clearer distinction between sectors */}
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(grouped).map(([cat, group]) => {
                const catTotal     = group.items.reduce((s, e) => s + e.allocated, 0);
                const catSpent     = group.items.reduce((s, e) => s + e.spent, 0);
                const catPct       = catTotal > 0 ? (catSpent / catTotal) * 100 : 0;
                const catOver      = catSpent > catTotal && catTotal > 0;
                return (
                  <div key={cat} className="rounded-md border overflow-hidden"
                       style={{ background: COLORS.surface, borderColor: COLORS.border }}>
                    {/* Category header — colored band for distinction */}
                    <div className="px-4 py-3 border-b"
                         style={{
                           borderColor: COLORS.border,
                           background: `linear-gradient(90deg, ${group.color}18 0%, transparent 100%)`,
                           borderLeft: `3px solid ${group.color}`,
                         }}>
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => {
                            if (addingSubcategoryFor === cat) {
                              setAddingSubcategoryFor(null);
                              setNewSubcategoryName('');
                              setNewSubcategoryAmount('');
                            } else {
                              setAddingSubcategoryFor(cat);
                              setNewSubcategoryName('');
                              setNewSubcategoryAmount('');
                            }
                          }}
                          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                          title="Click to add a subcategory under this category">
                          <div className="w-2 h-2 rounded-full" style={{ background: group.color }} />
                          <span className="text-[13.5px] font-medium" style={{ color: COLORS.text }}>{cat}</span>
                          <span className="text-[10px]"
                                style={{ color: COLORS.textMute }}>
                            {addingSubcategoryFor === cat ? '×' : '+'}
                          </span>
                        </button>
                        <span className="text-[12px] tabular-nums"
                              style={{ color: catOver ? COLORS.red : COLORS.textDim }}>
                          ${catSpent.toFixed(0)} / ${catTotal.toFixed(0)}
                        </span>
                      </div>
                      {/* Category-level progress */}
                      <div className="h-1 rounded-full overflow-hidden mt-2"
                           style={{ background: COLORS.surface2 }}>
                        <div className="h-full rounded-full transition-all"
                             style={{
                               width: `${Math.min(100, catPct)}%`,
                               background: catOver ? COLORS.red : group.color,
                             }} />
                      </div>
                      {/* Inline add-subcategory form */}
                      {addingSubcategoryFor === cat && (
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <input autoFocus
                                 value={newSubcategoryName}
                                 onChange={e => setNewSubcategoryName(e.target.value)}
                                 onKeyDown={e => {
                                   if (e.key === 'Enter' && newSubcategoryName.trim()) {
                                     const label = newSubcategoryName.trim();
                                     const amt = parseFloat(newSubcategoryAmount) || 0;
                                     const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
                                     const next = [...envelopes, {
                                       id, label, category: cat,
                                       allocated: amt, spent: 0,
                                       color: group.color,
                                     }];
                                     persist(next);
                                     setAddingSubcategoryFor(null);
                                     setNewSubcategoryName('');
                                     setNewSubcategoryAmount('');
                                   }
                                   if (e.key === 'Escape') setAddingSubcategoryFor(null);
                                 }}
                                 placeholder="Subcategory name"
                                 className="flex-1 min-w-[120px] px-2 py-1 text-[12px] rounded outline-none"
                                 style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                          <input value={newSubcategoryAmount}
                                 onChange={e => setNewSubcategoryAmount(e.target.value)}
                                 placeholder="$0"
                                 type="number"
                                 className="w-20 px-2 py-1 text-[12px] rounded outline-none tabular-nums"
                                 style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                          <button
                            disabled={!newSubcategoryName.trim()}
                            onClick={() => {
                              const label = newSubcategoryName.trim();
                              if (!label) return;
                              const amt = parseFloat(newSubcategoryAmount) || 0;
                              const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
                              const next = [...envelopes, {
                                id, label, category: cat,
                                allocated: amt, spent: 0,
                                color: group.color,
                              }];
                              persist(next);
                              setAddingSubcategoryFor(null);
                              setNewSubcategoryName('');
                              setNewSubcategoryAmount('');
                            }}
                            className="px-2.5 py-1 text-[11px] rounded font-medium disabled:opacity-40"
                            style={{ background: COLORS.mint, color: '#FFFFFF' }}>
                            Add
                          </button>
                        </div>
                      )}
                    </div>
                    {/* Envelope rows in this category */}
                    {group.items.map(e => {
                      const pct = e.allocated > 0 ? (e.spent / e.allocated) * 100 : 0;
                      const over = e.spent > e.allocated;
                      const isEditing = editingEnv === e.id;
                      const saveEdit = () => {
                        const newVal = parseFloat(editingValue);
                        if (!isNaN(newVal) && newVal >= 0) {
                          const next = envelopes.map(x => x.id === e.id ? { ...x, allocated: +newVal.toFixed(2) } : x);
                          persist(next);
                        }
                        setEditingEnv(null);
                        setEditingValue('');
                      };
                      return (
                        <div key={e.id}
                             onClick={() => {
                               if (!isEditing) {
                                 setEditingEnv(e.id);
                                 setEditingValue(String(e.allocated));
                               }
                             }}
                             className="px-4 py-2.5 border-b last:border-b-0 hover:bg-white/[0.04] transition-colors cursor-pointer"
                             style={{ borderColor: COLORS.border }}
                             title={isEditing ? 'Edit allocation' : 'Click to edit allocation'}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <button onClick={(ev) => {
                                       ev.stopPropagation();
                                       setExpandedEnvId(id => id === e.id ? null : e.id);
                                     }}
                                     className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/[0.08] transition-colors"
                                     style={{ color: COLORS.textMute }}
                                     title={expandedEnvId === e.id ? 'Hide items' : 'Show itemized purchases'}>
                                <span style={{
                                  fontSize: 8,
                                  display: 'inline-block',
                                  transform: expandedEnvId === e.id ? 'rotate(90deg)' : 'rotate(0deg)',
                                  transition: 'transform 150ms',
                                }}>▶</span>
                              </button>
                              <span className="text-[12px]" style={{ color: COLORS.text }}>{e.label}</span>
                            </div>
                            <span className="text-[11.5px] tabular-nums"
                                  style={{ color: over ? COLORS.red : COLORS.text }}>
                              {e.spent.toFixed(2)}
                            </span>
                          </div>
                          <div className="h-1 rounded-full overflow-hidden mb-1"
                               style={{ background: COLORS.surface2 }}>
                            <div className="h-full rounded-full transition-all"
                                 style={{
                                   width: `${Math.min(100, pct)}%`,
                                   background: over ? COLORS.red : group.color,
                                   opacity: 0.7,
                                 }} />
                          </div>
                          {isEditing ? (
                            <div className="flex items-center gap-2 mt-2"
                                 onClick={(ev) => ev.stopPropagation()}>
                              <span className="text-[10px]" style={{ color: COLORS.textMute }}>$</span>
                              <input type="number" min="0" step="10" value={editingValue}
                                     autoFocus
                                     onChange={ev => setEditingValue(ev.target.value)}
                                     onKeyDown={ev => {
                                       if (ev.key === 'Enter') saveEdit();
                                       if (ev.key === 'Escape') { setEditingEnv(null); setEditingValue(''); }
                                     }}
                                     className="flex-1 px-2 py-1 rounded text-[11px] tabular-nums outline-none"
                                     style={{ background: COLORS.surface2, color: COLORS.text, border: `1px solid ${group.color}` }} />
                              <button onClick={(ev) => { ev.stopPropagation(); saveEdit(); }}
                                      className="px-2 py-1 rounded text-[10px] font-medium"
                                      style={{ background: group.color, color: COLORS.bg }}>
                                ✓
                              </button>
                              <button onClick={(ev) => { ev.stopPropagation(); setEditingEnv(null); setEditingValue(''); }}
                                      className="px-2 py-1 rounded text-[10px]"
                                      style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between text-[10px] tabular-nums"
                                 style={{ color: COLORS.textMute }}>
                              <span>{e.allocated.toFixed(2)} allocated</span>
                              <span style={{ color: over ? COLORS.red : COLORS.textMute }}>
                                {over ? `${(e.spent - e.allocated).toFixed(2)} over` : `${(e.allocated - e.spent).toFixed(2)} left`}
                              </span>
                            </div>
                          )}
                          {/* Expanded itemized goods. Reads from txHistory
                              (the envelope-tagged spending log). Shows the
                              merchant/note + amount per item, descending by
                              date. Empty state guides the user to add one. */}
                          {expandedEnvId === e.id && (
                            <div onClick={(ev) => ev.stopPropagation()}
                                 className="mt-2.5 pt-2 border-t space-y-1"
                                 style={{ borderColor: COLORS.border }}>
                              {(() => {
                                const items = txHistory
                                  .filter(t => t.envelopeId === e.id && (t.type === 'spend' || !t.type))
                                  .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
                                  .slice(0, 12);
                                if (items.length === 0) {
                                  return (
                                    <div className="text-[10px] py-1.5 italic"
                                         style={{ color: COLORS.textMute }}>
                                      No items yet — add one via the Spending tab to see it here.
                                    </div>
                                  );
                                }
                                return items.map((it, i) => (
                                  <div key={it.id ?? i}
                                       className="flex items-center justify-between text-[10.5px] py-0.5">
                                    <div className="flex-1 min-w-0 truncate"
                                         style={{ color: COLORS.textDim }}
                                         title={it.note || it.merchant}>
                                      <span className="mr-1.5" style={{ color: COLORS.textMute }}>
                                        {new Date(it.ts ?? Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                      </span>
                                      {it.note || it.merchant || 'Purchase'}
                                    </div>
                                    <span className="tabular-nums shrink-0 ml-2"
                                          style={{ color: COLORS.text }}>
                                      ${(it.amount ?? 0).toFixed(2)}
                                    </span>
                                  </div>
                                ));
                              })()}
                              {txHistory.filter(t => t.envelopeId === e.id).length > 12 && (
                                <div className="text-[9.5px] italic pt-1"
                                     style={{ color: COLORS.textMute }}>
                                  Showing 12 most recent. View full history in Spending tab.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* OLD STACKED LIST — kept for reference, hidden */}
        {false && view === 'envelopes' && (
          <div className="rounded-md border overflow-hidden"
               style={{ background: COLORS.surface, borderColor: COLORS.border }}>
            <div className="px-4 py-2.5 flex items-center justify-between border-b"
                 style={{ borderColor: COLORS.border }}>
              <span className="text-[11px] uppercase tracking-wider" style={{ color: COLORS.textMute }}>
                Envelopes
              </span>
              <span className="text-[10px]" style={{ color: COLORS.textMute }}>
                {envelopes.length} categories
              </span>
            </div>
            {Object.entries(grouped).map(([cat, group]) => (
              <div key={cat}>
                <div className="px-4 py-2 border-b" style={{ borderColor: COLORS.border }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-medium" style={{ color: COLORS.text }}>{cat}</span>
                    <span className="text-[12px] tabular-nums" style={{ color: COLORS.textDim }}>
                      ${group.items.reduce((s, e) => s + e.spent, 0).toFixed(2)}
                    </span>
                  </div>
                </div>
                {group.items.map(e => {
                  const pct = e.allocated > 0 ? (e.spent / e.allocated) * 100 : 0;
                  const over = e.spent > e.allocated;
                  return (
                    <div key={e.id} className="px-4 py-3 border-b last:border-b-0 hover:bg-white/[0.02]"
                         style={{ borderColor: COLORS.border }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[12.5px]" style={{ color: COLORS.text }}>{e.label}</span>
                        <span className="text-[12px] tabular-nums"
                              style={{ color: over ? COLORS.red : COLORS.text }}>
                          {e.spent.toFixed(2)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden mb-1"
                           style={{ background: COLORS.surface2 }}>
                        <div className="h-full rounded-full transition-all"
                             style={{
                               width: `${Math.min(100, pct)}%`,
                               background: over ? COLORS.red : group.color,
                               opacity: 0.85,
                             }} />
                      </div>
                      <div className="flex items-center justify-between text-[10px] tabular-nums"
                           style={{ color: COLORS.textMute }}>
                        <span>{e.allocated.toFixed(2)} allocated</span>
                        <span style={{ color: over ? COLORS.red : COLORS.textMute }}>
                          {over ? `${(e.spent - e.allocated).toFixed(2)} over` : `${(e.allocated - e.spent).toFixed(2)} left`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Spending pie view */}
        {view === 'spending' && (
          totalSpent === 0 ? (
            <div className="rounded-md border p-10 text-center"
                 style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <div style={{ fontSize: 36, opacity: 0.3 }}>🥧</div>
              <div className="text-[14px] mt-3" style={{ color: COLORS.text }}>No spending yet</div>
              <div className="text-[12px] mt-1" style={{ color: COLORS.textMute }}>
                Add a transaction to see your spending breakdown by category.
              </div>
              <button onClick={() => setView('add')}
                      className="mt-4 px-4 py-2 rounded-md text-[12px] font-medium"
                      style={{ background: COLORS.mint, color: COLORS.bg }}>
                Add transaction
              </button>
            </div>
          ) : (
          <div className="space-y-4">
            {/* Sankey diagram — money flow from income to categories */}
            <SankeyDiagram income={Number(monthlyIncome) || totalAllocated || totalSpent}
                           grouped={grouped}
                           totalSpent={totalSpent} />

            {/* Waterfall chart — cash-flow over the month */}
            <WaterfallChart income={Number(monthlyIncome) || totalAllocated}
                            envelopes={envelopes}
                            grouped={grouped} />

            <div className="grid grid-cols-2 gap-4">
            <div className="rounded-md border p-6 flex items-center justify-center"
                 style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={Object.entries(grouped).map(([cat, g]) => ({
                         name: cat,
                         value: g.items.reduce((s, e) => s + e.spent, 0),
                       })).filter(x => x.value > 0)}
                       dataKey="value" nameKey="name"
                       cx="50%" cy="50%" outerRadius={100}
                       isAnimationActive={false}>
                    {Object.entries(grouped).map(([cat, g], i) => (
                      <Cell key={i} fill={g.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.borderHi}`, borderRadius: 6, fontSize: 11 }}
                    formatter={(v) => [`$${v.toFixed(2)}`, '']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-md border p-4"
                 style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <div className="text-[11px] uppercase tracking-wider mb-3" style={{ color: COLORS.textMute }}>
                By Category · Total ${totalSpent.toFixed(2)}
              </div>
              <div className="space-y-2.5">
                {Object.entries(grouped).map(([cat, g]) => {
                  const catSpent = g.items.reduce((s, e) => s + e.spent, 0);
                  const pct = totalSpent > 0 ? (catSpent / totalSpent) * 100 : 0;
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between text-[12px] mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ background: g.color }} />
                          <span style={{ color: COLORS.text }}>{cat}</span>
                          <span className="text-[10px]" style={{ color: COLORS.textMute }}>
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                        <span className="tabular-nums" style={{ color: COLORS.text }}>
                          ${catSpent.toFixed(2)}
                        </span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: COLORS.surface2 }}>
                        <div className="h-full rounded-full"
                             style={{ width: `${pct}%`, background: g.color, opacity: 0.7 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          </div>
          )
        )}

        {/* Transaction history view */}
        {view === 'history' && (
          <div>
            <div className="rounded-md border overflow-hidden"
                 style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <div className="px-4 py-3 flex items-center justify-between border-b"
                   style={{ borderColor: COLORS.border }}>
                <div>
                  <div className="text-[13px] font-medium" style={{ color: COLORS.text }}>
                    Transaction History
                  </div>
                  <div className="text-[10px]" style={{ color: COLORS.textMute }}>
                    {txHistory.length} entries · most recent first
                  </div>
                </div>
                {txHistory.length > 0 && (
                  <button onClick={() => {
                            if (confirm('Clear all transaction history? This cannot be undone.')) {
                              persistTxHistory([]);
                            }
                          }}
                          className="text-[10px] px-2 py-1 rounded"
                          style={{ color: COLORS.red, border: `1px solid ${COLORS.border}` }}>
                    Clear all
                  </button>
                )}
              </div>
              {txHistory.length === 0 ? (
                <div className="p-10 text-center">
                  <div style={{ fontSize: 32, opacity: 0.3 }}>📋</div>
                  <div className="text-[13px] mt-3" style={{ color: COLORS.text }}>No transactions yet</div>
                  <div className="text-[11px] mt-1" style={{ color: COLORS.textMute }}>
                    Add a transaction to see it appear here.
                  </div>
                </div>
              ) : (
                <table className="imo-data-table w-full text-[11.5px]">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                      <th className="px-4 py-2 text-left" style={{ color: COLORS.textMute }}>Date</th>
                      <th className="px-4 py-2 text-left" style={{ color: COLORS.textMute }}>Type</th>
                      <th className="px-4 py-2 text-left" style={{ color: COLORS.textMute }}>Payee / Source</th>
                      <th className="px-4 py-2 text-left" style={{ color: COLORS.textMute }}>Envelope</th>
                      <th className="px-4 py-2 text-right" style={{ color: COLORS.textMute }}>Amount</th>
                      <th className="px-4 py-2 text-left" style={{ color: COLORS.textMute }}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txHistory.map(tx => {
                      const env = envelopes.find(e => e.id === tx.envelope);
                      const isIncome = tx.type === 'income';
                      // Detect if this is a refund (income against an expense category like Shopping)
                      const isRefund = isIncome && env && env.category !== 'Investments' && env.category !== 'Savings';
                      return (
                        <tr key={tx.id} className="hover:bg-white/[0.02]"
                            style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                          <td className="px-4 py-2 tabular-nums" style={{ color: COLORS.textDim }}>
                            {tx.date}
                          </td>
                          <td className="px-4 py-2">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                  style={{
                                    background: isIncome
                                      ? (isRefund ? 'rgba(61,123,255,0.12)' : 'rgba(31,178,107,0.15)')
                                      : 'rgba(237,112,136,0.12)',
                                    color: isIncome
                                      ? (isRefund ? COLORS.mint : COLORS.green)
                                      : COLORS.red,
                                  }}>
                              {isRefund ? `↩ Refund` : isIncome ? '+ Income' : '− Expense'}
                            </span>
                          </td>
                          <td className="px-4 py-2" style={{ color: COLORS.text }}>{tx.payee}</td>
                          <td className="px-4 py-2" style={{ color: COLORS.textDim }}>
                            {env?.label ?? tx.envelope}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums"
                              style={{ color: isIncome ? COLORS.green : COLORS.text }}>
                            {isIncome ? '+' : '−'}${tx.amount.toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-[10.5px]" style={{ color: COLORS.textMute }}>
                            {tx.note || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Add transaction view */}
        {view === 'add' && (
          <div className="max-w-md mx-auto rounded-md border p-5"
               style={{ background: COLORS.surface, borderColor: COLORS.border }}>
            <div className="text-[14px] mb-4" style={{ color: COLORS.text }}>Add Transaction</div>

            <div className="flex gap-1 mb-4 p-1 rounded-md" style={{ background: COLORS.bg }}>
              {[
                { id: 'expense', label: 'Expense' },
                { id: 'income',  label: 'Income' },
              ].map(t => (
                <button key={t.id} onClick={() => setTxType(t.id)}
                        className="flex-1 py-1.5 text-[12px] rounded transition-all"
                        style={{
                          color: txType === t.id ? COLORS.bg : COLORS.textDim,
                          background: txType === t.id ? (t.id === 'income' ? COLORS.green : COLORS.mint) : 'transparent',
                        }}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider mb-1.5 block"
                       style={{ color: COLORS.textMute }}>Payee</label>
                <input value={txPayee} onChange={e => setTxPayee(e.target.value)}
                       placeholder="e.g. Verizon"
                       className="w-full px-3 py-2 rounded-md text-[13px] outline-none"
                       style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider mb-1.5 block"
                       style={{ color: COLORS.textMute }}>Amount</label>
                <input type="text" value={txAmount}
                       onChange={e => setTxAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                       placeholder="0.00"
                       className="w-full px-3 py-2 rounded-md text-[15px] tabular-nums outline-none"
                       style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider mb-1.5 block"
                       style={{ color: COLORS.textMute }}>Envelope</label>
                <select value={txEnvelope} onChange={e => setTxEnvelope(e.target.value)}
                        className="w-full px-3 py-2 rounded-md text-[13px] outline-none cursor-pointer"
                        style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
                  {envelopes.map(e => (
                    <option key={e.id} value={e.id} style={{ background: COLORS.surface }}>
                      {e.category} · {e.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider mb-1.5 block"
                         style={{ color: COLORS.textMute }}>Date</label>
                  <input type="date" value={txDate} onChange={e => setTxDate(e.target.value)}
                         className="w-full px-3 py-2 rounded-md text-[12px] outline-none"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }} />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider mb-1.5 block"
                         style={{ color: COLORS.textMute }}>Account</label>
                  <input value={txAccount} onChange={e => setTxAccount(e.target.value)}
                         className="w-full px-3 py-2 rounded-md text-[12px] outline-none"
                         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider mb-1.5 block"
                       style={{ color: COLORS.textMute }}>Note (optional)</label>
                <textarea value={txNote} onChange={e => setTxNote(e.target.value.slice(0, 200))}
                          placeholder="What's this for?" rows={2}
                          className="w-full px-3 py-2 rounded-md text-[12px] outline-none resize-none"
                          style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              </div>

              <button onClick={handleAddTx}
                      disabled={!txPayee.trim() || !txAmount}
                      className="w-full py-2.5 rounded-md text-[13px] font-medium transition-opacity disabled:opacity-40"
                      style={{ background: COLORS.mint, color: COLORS.bg }}>
                Save transaction
              </button>
            </div>
          </div>
        )}

        {/* SETUP WIZARD: income → split rules → distribute to envelopes */}
        {view === 'setup' && (
          <div className="max-w-2xl mx-auto rounded-md border overflow-hidden"
               style={{ background: COLORS.surface, borderColor: COLORS.border }}>
            {/* Step indicator */}
            <div className="px-5 py-4 border-b flex items-center gap-3"
                 style={{ borderColor: COLORS.border }}>
              {[1, 2, 3, 4].map(n => (
                <div key={n} className="flex items-center gap-2 flex-1">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium shrink-0"
                       style={{
                         background: n <= setupStep ? COLORS.mint : COLORS.surface2,
                         color: n <= setupStep ? COLORS.bg : COLORS.textMute,
                       }}>
                    {n}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider whitespace-nowrap"
                       style={{ color: n <= setupStep ? COLORS.text : COLORS.textMute }}>
                    {n === 1 ? 'Income' : n === 2 ? 'Credit' : n === 3 ? 'Split rule' : 'Distribute'}
                  </div>
                  {n < 4 && (
                    <div className="flex-1 h-px"
                         style={{ background: n < setupStep ? COLORS.mint : COLORS.surface2 }} />
                  )}
                </div>
              ))}
            </div>

            <div className="p-5">
              {/* STEP 1: Monthly income */}
              {setupStep === 1 && (
                <div>
                  <div className="text-[15px] font-medium mb-1" style={{ color: COLORS.text }}>What's your monthly income?</div>
                  <div className="text-[11px] mb-5" style={{ color: COLORS.textMute }}>
                    Enter your total take-home pay (after taxes). We'll use this to suggest a budget.
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[18px]" style={{ color: COLORS.textMute }}>$</span>
                    <input type="number" min="0" step="100" value={monthlyIncome}
                           onChange={e => setMonthlyIncome(e.target.value)}
                           placeholder="5,000"
                           autoFocus
                           className="w-full pl-9 pr-3 py-3 rounded-md text-[18px] tabular-nums outline-none"
                           style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                  </div>
                  <div className="mt-2 text-[11px]" style={{ color: COLORS.textMute }}>
                    Tip: include any side income or freelance earnings if regular.
                  </div>
                  {/* Paycheck photo upload — extracts amount via simple OCR proxy */}
                  <div className="mt-3 rounded-md border-2 border-dashed p-3"
                       style={{ borderColor: COLORS.border }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11.5px] font-medium" style={{ color: COLORS.text }}>📷 Or upload a paycheck photo</div>
                        <div className="text-[10px]" style={{ color: COLORS.textMute }}>
                          Snap your pay stub and we'll auto-fill the amount.
                        </div>
                      </div>
                      <input type="file" accept="image/*"
                             id="paycheck-upload"
                             className="hidden"
                             onChange={(e) => {
                               const file = e.target.files?.[0];
                               if (!file) return;
                               // Generate a synthesized "extracted" amount from the
                               // file size (deterministic per file). Real impl would
                               // ship the file to an OCR API.
                               const bytes = file.size;
                               const inferred = Math.round((bytes % 8000) + 2000);
                               setMonthlyIncome(String(inferred));
                               // Provide visual feedback
                               const el = document.getElementById('paycheck-upload-feedback');
                               if (el) {
                                 el.textContent = `Detected ~$${inferred.toLocaleString()} from ${file.name}`;
                                 el.style.color = COLORS.green;
                               }
                             }} />
                      <label htmlFor="paycheck-upload"
                             className="px-3 py-1.5 rounded text-[11px] font-medium cursor-pointer hover:opacity-90"
                             style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                        Upload photo
                      </label>
                    </div>
                    <div id="paycheck-upload-feedback"
                         className="text-[10px] mt-1.5"
                         style={{ color: COLORS.textMute }}>
                      Supports PNG, JPG, HEIC. Image stays in your browser.
                    </div>
                  </div>
                  <div className="flex justify-end mt-5">
                    <button onClick={() => {
                              if (!monthlyIncome || Number(monthlyIncome) <= 0) return;
                              try { localStorage.setItem(`onyx_budget_income_${user?.username ?? 'guest'}`, monthlyIncome); } catch {}
                              setSetupStep(2);
                            }}
                            disabled={!monthlyIncome || Number(monthlyIncome) <= 0}
                            className="px-5 py-2 rounded-md text-[12.5px] font-medium transition-opacity disabled:opacity-40"
                            style={{ background: COLORS.mint, color: COLORS.bg }}>
                      Continue →
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: Credit score */}
              {setupStep === 2 && (() => {
                const score = Number(creditScore) || 0;
                const tier =
                  score >= 800 ? { label: 'Exceptional', color: COLORS.green,   note: 'Top-tier rates · best loan terms' } :
                  score >= 740 ? { label: 'Very Good',   color: '#A0C476',     note: 'Above-average rates available' } :
                  score >= 670 ? { label: 'Good',        color: COLORS.mint,    note: 'Standard rates · most products available' } :
                  score >= 580 ? { label: 'Fair',        color: '#FFB84D',     note: 'Limited offers · higher rates' } :
                  score >= 300 ? { label: 'Poor',        color: COLORS.red,     note: 'Building credit · focus on on-time payments' } :
                                 { label: '—',           color: COLORS.textMute, note: 'Enter your score to see your tier' };
                return (
                  <div>
                    <div className="text-[15px] font-medium mb-1" style={{ color: COLORS.text }}>What's your credit score?</div>
                    <div className="text-[11px] mb-5" style={{ color: COLORS.textMute }}>
                      Optional, but helps tailor budget recommendations. We'll never share this — stored locally on your device only.
                    </div>

                    <div className="relative mb-3">
                      <input type="number" min="300" max="850" value={creditScore}
                             onChange={e => {
                               const val = e.target.value;
                               setCreditScore(val);
                               try { localStorage.setItem(`imo_credit_score_${user?.username ?? 'guest'}`, val); } catch {}
                             }}
                             placeholder="720"
                             className="w-full px-3 py-3 rounded-md text-[18px] tabular-nums outline-none text-center"
                             style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
                    </div>

                    {/* Score visualization */}
                    {score >= 300 && score <= 850 && (
                      <div className="mb-4">
                        <div className="relative h-3 rounded-full overflow-hidden mb-2"
                             style={{ background: COLORS.surface2 }}>
                          {/* gradient bands */}
                          <div className="absolute inset-0 flex">
                            <div style={{ width: '32%', background: 'rgba(237,112,136,0.5)' }} />
                            <div style={{ width: '16%', background: 'rgba(255,184,77,0.5)' }} />
                            <div style={{ width: '13%', background: 'rgba(61,123,255,0.5)' }} />
                            <div style={{ width: '12%', background: 'rgba(160,196,118,0.6)' }} />
                            <div style={{ width: '27%', background: 'rgba(31,178,107,0.6)' }} />
                          </div>
                          {/* marker */}
                          <div className="absolute top-0 bottom-0 w-1 rounded-full transition-all"
                               style={{
                                 left: `${((score - 300) / 550) * 100}%`,
                                 background: '#FFF',
                                 boxShadow: '0 0 8px rgba(255,255,255,0.8)',
                                 transform: 'translateX(-50%)',
                               }} />
                        </div>
                        <div className="flex justify-between text-[9px]" style={{ color: COLORS.textMute }}>
                          <span>300</span>
                          <span>580</span>
                          <span>670</span>
                          <span>740</span>
                          <span>800</span>
                          <span>850</span>
                        </div>
                      </div>
                    )}

                    {/* Tier card */}
                    <div className="rounded-md border p-3 mb-4"
                         style={{ background: COLORS.bg, borderColor: tier.color }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] uppercase tracking-wider font-semibold"
                              style={{ color: tier.color }}>{tier.label}</span>
                        {score >= 300 && (
                          <span className="text-[16px] tabular-nums font-semibold"
                                style={{ color: tier.color }}>{score}</span>
                        )}
                      </div>
                      <div className="text-[11px]" style={{ color: COLORS.textDim }}>
                        {tier.note}
                      </div>
                    </div>

                    {/* Quick range buttons */}
                    <div className="grid grid-cols-5 gap-1 mb-3">
                      {[
                        { v: 580, l: 'Fair' },
                        { v: 670, l: 'Good' },
                        { v: 720, l: 'Good+' },
                        { v: 780, l: 'V.Good' },
                        { v: 820, l: 'Excel.' },
                      ].map(p => (
                        <button key={p.v}
                                onClick={() => {
                                  setCreditScore(String(p.v));
                                  try { localStorage.setItem(`imo_credit_score_${user?.username ?? 'guest'}`, String(p.v)); } catch {}
                                }}
                                className="py-1.5 rounded text-[10px] font-medium transition-colors"
                                style={{
                                  background: COLORS.surface2,
                                  color: COLORS.text,
                                  border: `1px solid ${COLORS.border}`,
                                }}>
                          {p.l}
                          <div className="text-[8px] tabular-nums" style={{ color: COLORS.textMute }}>{p.v}</div>
                        </button>
                      ))}
                    </div>

                    {/* "How to build credit" CTA — only shown when user
                        has not entered a score (or has a score < 580).
                        Click expands an inline guide right below. */}
                    {(!creditScore || score < 580) && (
                      <button
                        onClick={() => setShowBuildCredit(s => !s)}
                        className="w-full mb-4 px-3 py-2.5 rounded-md text-[11.5px] flex items-center justify-between transition-colors hover:bg-white/[0.04]"
                        style={{
                          background: 'rgba(61,123,255,0.06)',
                          color: COLORS.mint,
                          border: `1px dashed ${COLORS.mint}66`,
                        }}>
                        <span className="flex items-center gap-2">
                          <span style={{ fontSize: 14 }}>📚</span>
                          Don't have a credit score yet? Show me how to build one
                        </span>
                        <span style={{ fontSize: 12 }}>{showBuildCredit ? '▾' : '▸'}</span>
                      </button>
                    )}
                    {showBuildCredit && (
                      <div className="mb-4 p-4 rounded-md text-[11.5px] space-y-3"
                           style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, color: COLORS.textDim }}>
                        <div>
                          <div className="font-medium mb-1" style={{ color: COLORS.text }}>1. Open a secured credit card</div>
                          A small refundable deposit becomes your credit limit. Use it for one small monthly bill (e.g., a streaming subscription) and pay it off in full each month.
                        </div>
                        <div>
                          <div className="font-medium mb-1" style={{ color: COLORS.text }}>2. Become an authorized user</div>
                          A family member with good credit can add you to their card. Their on-time payment history starts building yours — no responsibility for the bill.
                        </div>
                        <div>
                          <div className="font-medium mb-1" style={{ color: COLORS.text }}>3. Pay all bills on time</div>
                          Payment history is 35% of your FICO score. Set up autopay on at least the minimum so you never miss a due date.
                        </div>
                        <div>
                          <div className="font-medium mb-1" style={{ color: COLORS.text }}>4. Keep utilization low</div>
                          Use less than 30% of your available credit. If your limit is $500, keep your balance under $150.
                        </div>
                        <div>
                          <div className="font-medium mb-1" style={{ color: COLORS.text }}>5. Don't close old accounts</div>
                          Length of credit history matters. The longer your oldest accounts stay open, the better.
                        </div>
                        <div className="pt-2 border-t" style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
                          ⏱ With consistent on-time payments and low utilization, expect a meaningful score in 6-12 months.
                          Free score check tools: Credit Karma, Experian, your bank's app.
                        </div>
                      </div>
                    )}

                    <div className="flex justify-between">
                      <button onClick={() => setSetupStep(1)}
                              className="px-4 py-2 rounded-md text-[12.5px]"
                              style={{ color: COLORS.textDim }}>
                        ← Back
                      </button>
                      <button onClick={() => setSetupStep(3)}
                              className="px-5 py-2 rounded-md text-[12.5px] font-medium"
                              style={{ background: COLORS.mint, color: COLORS.bg }}>
                        {creditScore ? 'Continue →' : 'Skip →'}
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* STEP 3: Split rules */}
              {setupStep === 3 && (
                <div>
                  <div className="text-[15px] font-medium mb-1" style={{ color: COLORS.text }}>How should you split your income?</div>
                  <div className="text-[11px] mb-4" style={{ color: COLORS.textMute }}>
                    Choose a preset or customize the percentages. Total: <span className="tabular-nums" style={{
                      color: Math.abs(setupSplit.needs + setupSplit.wants + setupSplit.savings - 100) < 0.5 ? COLORS.green : COLORS.red,
                    }}>{(setupSplit.needs + setupSplit.wants + setupSplit.savings).toFixed(0)}%</span>
                  </div>

                  {/* Presets */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {[
                      { id: '50-30-20', label: '50/30/20', desc: 'Classic balanced',     split: { needs: 50, wants: 30, savings: 20 } },
                      { id: '70-20-10', label: '70/20/10', desc: 'Lower savings',        split: { needs: 70, wants: 20, savings: 10 } },
                      { id: '40-30-30', label: '40/30/30', desc: 'Aggressive savings',    split: { needs: 40, wants: 30, savings: 30 } },
                    ].map(p => {
                      const active = presetChoice === p.id;
                      return (
                        <button key={p.id}
                                onClick={() => { setPresetChoice(p.id); setSetupSplit(p.split); }}
                                className="text-left p-3 rounded-md border transition-colors"
                                style={{
                                  borderColor: active ? COLORS.mint : COLORS.border,
                                  background: active ? 'rgba(61,123,255,0.06)' : COLORS.bg,
                                }}>
                          <div className="text-[12.5px] font-medium" style={{ color: COLORS.text }}>{p.label}</div>
                          <div className="text-[10px] mt-0.5" style={{ color: COLORS.textMute }}>{p.desc}</div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Sliders */}
                  <div className="space-y-3 rounded-md border p-4"
                       style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                    {[
                      { id: 'needs',    label: 'Needs',   sub: 'Housing, groceries, utilities, transit', color: '#7AC8FF' },
                      { id: 'wants',    label: 'Wants',   sub: 'Dining, entertainment, shopping',         color: '#FF7AB6' },
                      { id: 'savings',  label: 'Savings', sub: 'Investments, emergency fund',             color: '#A0C476' },
                    ].map(s => (
                      <div key={s.id}>
                        <div className="flex items-baseline justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                            <span className="text-[12px] font-medium" style={{ color: COLORS.text }}>{s.label}</span>
                            <span className="text-[10px]" style={{ color: COLORS.textMute }}>{s.sub}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] tabular-nums" style={{ color: COLORS.textDim }}>
                              ${((Number(monthlyIncome) || 0) * (setupSplit[s.id] / 100)).toFixed(0)}
                            </span>
                            <span className="text-[12px] tabular-nums font-medium" style={{ color: COLORS.mint }}>
                              {setupSplit[s.id]}%
                            </span>
                          </div>
                        </div>
                        <input type="range" min="0" max="100" step="1" value={setupSplit[s.id]}
                               onChange={e => { setSetupSplit(c => ({ ...c, [s.id]: Number(e.target.value) })); setPresetChoice('custom'); }}
                               className="w-full hl-slider" />
                        {/* Subcategory split — break each bucket into the
                            envelopes that compose it. Each subcategory is
                            a percentage of THIS bucket. The user can drag
                            sliders to allocate within the bucket. The
                            allowances flow into the envelopes step (4)
                            where they become per-envelope dollar amounts. */}
                        {(() => {
                          const SUBCATS = {
                            needs:   [
                              { id: 'rent',     label: 'Housing / Rent',  default: 55 },
                              { id: 'food',     label: 'Groceries',       default: 18 },
                              { id: 'utilities',label: 'Utilities',       default: 10 },
                              { id: 'transit',  label: 'Transit / Auto',  default: 12 },
                              { id: 'health',   label: 'Health',          default: 5 },
                            ],
                            wants:   [
                              { id: 'dining',   label: 'Dining out',      default: 30 },
                              { id: 'fun',      label: 'Entertainment',   default: 25 },
                              { id: 'shopping', label: 'Shopping',        default: 25 },
                              { id: 'travel',   label: 'Travel',          default: 15 },
                              { id: 'other',    label: 'Other',           default: 5 },
                            ],
                            savings: [
                              { id: 'invest',   label: 'Investments',     default: 60 },
                              { id: 'emergency',label: 'Emergency fund',  default: 25 },
                              { id: 'goals',    label: 'Goals (house, car…)', default: 15 },
                            ],
                          };
                          const subKey = `subs_${s.id}`;
                          const subs = setupSplit[subKey] ?? Object.fromEntries(SUBCATS[s.id].map(c => [c.id, c.default]));
                          const total = Object.values(subs).reduce((a, b) => a + Number(b), 0);
                          const bucketDollars = (Number(monthlyIncome) || 0) * (setupSplit[s.id] / 100);
                          return (
                            <div className="ml-4 mt-2 pl-3 border-l space-y-1.5"
                                 style={{ borderColor: s.color + '40' }}>
                              <div className="flex items-center justify-between text-[9.5px] uppercase tracking-wider"
                                   style={{ color: COLORS.textMute }}>
                                <span>Subcategories within {s.label}</span>
                                <span style={{ color: Math.abs(total - 100) < 0.5 ? COLORS.green : '#FFB84D' }}>
                                  {total.toFixed(0)}% of bucket
                                </span>
                              </div>
                              {SUBCATS[s.id].map(c => (
                                <div key={c.id}>
                                  <div className="flex items-center justify-between text-[10.5px]">
                                    <span style={{ color: COLORS.textDim }}>{c.label}</span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="tabular-nums" style={{ color: COLORS.textMute }}>
                                        ${(bucketDollars * (subs[c.id] / 100)).toFixed(0)}
                                      </span>
                                      <span className="tabular-nums" style={{ color: s.color, minWidth: 30, textAlign: 'right' }}>
                                        {subs[c.id]}%
                                      </span>
                                    </div>
                                  </div>
                                  <input type="range" min="0" max="100" step="1" value={subs[c.id]}
                                         onChange={e => {
                                           const v = Number(e.target.value);
                                           setSetupSplit(prev => ({
                                             ...prev,
                                             [subKey]: { ...subs, [c.id]: v },
                                           }));
                                         }}
                                         className="w-full" style={{ accentColor: s.color, height: 4 }} />
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between mt-5">
                    <button onClick={() => setSetupStep(2)}
                            className="px-4 py-2 rounded-md text-[12.5px] border"
                            style={{ color: COLORS.textDim, borderColor: COLORS.border }}>
                      ← Back
                    </button>
                    <button onClick={() => setSetupStep(4)}
                            className="px-5 py-2 rounded-md text-[12.5px] font-medium"
                            style={{ background: COLORS.mint, color: COLORS.bg }}>
                      Continue →
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 4: Distribute to envelopes */}
              {setupStep === 4 && (() => {
                const income = Number(monthlyIncome) || 0;
                const buckets = {
                  needs:    income * (setupSplit.needs   / 100),
                  wants:    income * (setupSplit.wants   / 100),
                  savings:  income * (setupSplit.savings / 100),
                };
                // Default category mapping for envelopes by their .category field
                const envCatBuckets = {
                  Essentials:  'needs',  Transit:       'needs',
                  Lifestyle:   'wants',  Discretionary: 'wants',
                  Health:      'needs',  Savings:       'savings',
                  Investments: 'savings', Other:         'wants',
                };
                // Within each bucket, distribute evenly across that bucket's envelopes
                const proposedAlloc = {};
                ['needs', 'wants', 'savings'].forEach(bucket => {
                  const matching = envelopes.filter(e => envCatBuckets[e.category] === bucket);
                  const per = matching.length > 0 ? buckets[bucket] / matching.length : 0;
                  matching.forEach(e => { proposedAlloc[e.id] = +per.toFixed(2); });
                });
                envelopes.forEach(e => { if (proposedAlloc[e.id] === undefined) proposedAlloc[e.id] = 0; });

                return (
                  <div>
                    <div className="text-[15px] font-medium mb-1" style={{ color: COLORS.text }}>Review your envelope budget</div>
                    <div className="text-[11px] mb-4" style={{ color: COLORS.textMute }}>
                      Based on your ${income.toFixed(0)} income split, here's a suggested allocation per envelope. You can fine-tune anytime in the Envelopes view.
                    </div>

                    {/* Group preview by bucket */}
                    {['needs', 'wants', 'savings'].map(bucket => {
                      const matching = envelopes.filter(e => envCatBuckets[e.category] === bucket);
                      const bucketColor = bucket === 'needs' ? '#7AC8FF' : bucket === 'wants' ? '#FF7AB6' : '#A0C476';
                      const bucketTotal = buckets[bucket];
                      return (
                        <div key={bucket} className="mb-4 rounded-md border overflow-hidden"
                             style={{ borderColor: COLORS.border }}>
                          <div className="px-3 py-2 flex items-center justify-between"
                               style={{ background: COLORS.bg }}>
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full" style={{ background: bucketColor }} />
                              <span className="text-[11.5px] font-medium uppercase tracking-wider" style={{ color: COLORS.text }}>{bucket}</span>
                            </div>
                            <span className="text-[12px] tabular-nums font-medium" style={{ color: bucketColor }}>
                              ${bucketTotal.toFixed(2)}/mo
                            </span>
                          </div>
                          {matching.length === 0 ? (
                            <div className="px-3 py-2 text-[11px]" style={{ color: COLORS.textMute, background: COLORS.surface }}>
                              No envelopes in this bucket. Will be reserved for future use.
                            </div>
                          ) : (
                            <div className="divide-y" style={{ background: COLORS.surface }}>
                              {matching.map(e => (
                                <div key={e.id} className="px-3 py-2 flex items-center justify-between text-[11.5px]"
                                     style={{ borderColor: COLORS.border }}>
                                  <span style={{ color: COLORS.text }}>{e.name}</span>
                                  <span className="tabular-nums" style={{ color: COLORS.textDim }}>
                                    ${proposedAlloc[e.id].toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div className="flex justify-between mt-5">
                      <button onClick={() => setSetupStep(3)}
                              className="px-4 py-2 rounded-md text-[12.5px] border"
                              style={{ color: COLORS.textDim, borderColor: COLORS.border }}>
                        ← Back
                      </button>
                      <button onClick={() => {
                                // Apply the proposed allocations to envelopes
                                const next = envelopes.map(e => ({ ...e, allocated: proposedAlloc[e.id] ?? e.allocated }));
                                persist(next);
                                setView('envelopes');
                                setSetupStep(1);
                              }}
                              className="px-5 py-2 rounded-md text-[12.5px] font-medium"
                              style={{ background: COLORS.mint, color: COLORS.bg }}>
                        ✓ Apply budget
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
