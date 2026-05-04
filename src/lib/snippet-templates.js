// IMO Onyx Terminal — snippet templates registry
//
// Phase 3p.16 / Feature 3. Starter content patterns users can insert
// from the snippet editor. Each template has a label, a kind, a
// suggested title pattern (with {date} substitution), and a body
// template (also supporting {date}, {ticker} substitutions).
//
// Substitution tokens:
//   {date}      — YYYY-MM-DD of insertion
//   {datetime}  — ISO 8601 of insertion
//   {ticker}    — placeholder for the user to fill in (kept literal)

const today = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const substitute = (str) =>
  String(str || '')
    .replace(/\{date\}/g, today())
    .replace(/\{datetime\}/g, new Date().toISOString());

export const TEMPLATES = [
  {
    id: 'daily-log',
    label: 'Daily log',
    kind: 'note',
    titlePattern: 'Trading log {date}',
    tags: ['daily-log'],
    body: `# Trading log {date}

## Market context
-

## Trades placed
-

## Lessons / observations
-

## Tomorrow's plan
-
`,
  },
  {
    id: 'trade-thesis',
    label: 'Trade thesis',
    kind: 'note',
    titlePattern: 'Thesis: {ticker} ({date})',
    tags: ['thesis'],
    body: `# Thesis: {ticker}

**Date opened:** {date}
**Direction:** long / short
**Time horizon:**
**Position sizing:**

## Why
-

## Catalyst
-

## Invalidation (stop-loss reasoning)
-

## Exit plan
- Profit target:
- Stop:
- Time stop:

## Risk
-
`,
  },
  {
    id: 'post-mortem',
    label: 'Post-mortem',
    kind: 'note',
    titlePattern: 'Post-mortem: {ticker} ({date})',
    tags: ['post-mortem'],
    body: `# Post-mortem: {ticker}

**Closed:** {date}
**P&L:**
**Held for:**

## What went right
-

## What went wrong
-

## Was the thesis still valid at exit?
-

## What would I do differently?
-
`,
  },
  {
    id: 'options-sizing',
    label: 'Options sizing checklist',
    kind: 'note',
    titlePattern: 'Options sizing — {ticker}',
    tags: ['options', 'risk'],
    body: `# Options sizing checklist — {ticker}

- [ ] Underlying liquidity (avg daily volume > 1M shares)
- [ ] Option chain liquidity (open interest > 1000 at strike)
- [ ] Bid-ask spread < 5% of mid
- [ ] IV rank/percentile checked
- [ ] Earnings date NOT during expiry
- [ ] Defined max loss = position cost
- [ ] Max loss < 1% of portfolio
- [ ] Greeks reviewed (delta, theta, vega)
- [ ] Exit plan written before entry

## Position
**Strategy:**
**Strike(s):**
**Expiry:**
**Cost / max loss:**
`,
  },
  {
    id: 'strategy-config',
    label: 'Strategy config',
    kind: 'config',
    titlePattern: '{ticker} strategy config',
    tags: ['strategy', 'config'],
    body: `# Strategy config for {ticker}
# Created {datetime}

asset: {ticker}
timeframe: 5m
indicators:
  ema_fast: 9
  ema_slow: 21
  rsi_period: 14
risk:
  max_position_pct: 2.0
  stop_pct: 1.5
  take_profit_pct: 3.0
hours:
  start: "09:30"
  end: "15:55"
  timezone: "America/New_York"
`,
  },
  {
    id: 'snippet-of-code',
    label: 'Code snippet (JS)',
    kind: 'code',
    titlePattern: 'JS snippet — {date}',
    tags: ['code'],
    body: `// {datetime}
// Description:

const main = () => {
  // ...
};

main();
`,
  },
];

// Apply a template — returns a partial snippet { title, body, kind, tags }
// ready to seed the editor with.
export const applyTemplate = (templateId) => {
  const tpl = TEMPLATES.find(t => t.id === templateId);
  if (!tpl) return null;
  return {
    title: substitute(tpl.titlePattern),
    body:  substitute(tpl.body),
    kind:  tpl.kind,
    tags:  Array.isArray(tpl.tags) ? [...tpl.tags] : [],
  };
};

export const listTemplates = () =>
  TEMPLATES.map(t => ({ id: t.id, label: t.label, kind: t.kind }));
