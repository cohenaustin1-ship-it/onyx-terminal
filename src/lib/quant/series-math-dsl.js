// IMO Onyx Terminal — series math DSL evaluator
//
// Phase 3o.95 (file split, batch 7a). Minimal expression evaluator for
// time-series math used by the macro/economic data overlay. Supports
// scalar arithmetic + a handful of series-aware functions
// (ma/lag/yoy) for things like "real yield = nominal yield − YoY CPI"
// computed live from FRED / DBnomics series.
//
// Public exports:
//   computeMathSeries(expr, seriesCache)
//     → { points: [{t, v}], referencedSeriesIds: [...] } | null
//     Tokenizes + evaluates expr. seriesCache is { [id]: { data: { points } } }
//     keyed by DBnomics provider/dataset/series identifiers (≥2 slashes).
//
// Internal (not exported):
//   FUNCTIONS                  — registry of supported functions
//   tokenizeMathExpr(expr)     — lexer for the DSL
//   parser/evaluator helpers   — operator-precedence walker
//
// Operators:    + - * / ( )
// Functions:    abs, log, exp, sqrt, min, max, pct, ma, lag, yoy
// Variables:    let name = expr;
// Statements:   ; separated; last expression's value is the result
// Comments:     # to end of line

// Series math DSL — minimal evaluator that takes a string like
// "FED/H15/RIFLGFCY10_N.B - FED/H15/RIFLGFCY02_N.B" and an
// already-fetched seriesCache, returns a synthetic time series of
// the result.
//
// Phase 3o.30 expansion: now supports functions, variables, and
// multi-statement programs.
//
//   Operators:    + - * / ( )
//   Functions:    abs(x), log(x), exp(x), sqrt(x),
//                 min(a, b), max(a, b),
//                 pct(a, b)         — percent difference (a - b) / b * 100
//                 ma(series, n)     — n-bar simple moving average
//                 lag(series, n)    — value n bars ago
//                 yoy(series)       — year-over-year % change (252-day approx)
//   Variables:    let name = expr;  — binds a subexpression to a name
//   Statements:   ; separates; last expression's value is the result
//   Comments:     # to end of line
//
// Examples that work:
//   "FED/H15/RIFLGFCY10_N.B - FED/H15/RIFLGFCY02_N.B"
//     → 10s/2s spread
//   "let r = FED/H15/RIFLGFCY10_N.B; let i = BLS/cu/CUSR0000SA0L1E; r - yoy(i)"
//     → 10Y nominal yield minus YoY core CPI = real yield approx
//   "ma(FED/H15/RIFLGFCY10_N.B, 20) - FED/H15/RIFLGFCY10_N.B"
//     → mean reversion signal: 20-day MA minus current
//   "max(0, FED/H15/RIFLGFCY10_N.B - FED/H15/RIFLGFCY02_N.B)"
//     → curve spread, floored at zero
//
// Series identifiers are detected by having ≥2 slashes (matching
// DBnomics' {provider}/{dataset}/{series} format). Function names
// and variables are bare identifiers without slashes.
//
// The evaluator returns a per-date series. For functions like ma/
// lag/yoy that need access to the *full* operand series (not just
// today's value), the evaluator constructs a virtual series for
// the inner expression first, then applies the function over the
// time axis. This means nested expressions like `ma(a + b, 20)`
// work correctly — the (a + b) series is computed first, then
// the 20-bar MA is taken over that.

const FUNCTIONS = {
  // Scalar functions — applied per-date
  abs:  { arity: 1, kind: 'scalar', fn: (a) => Math.abs(a) },
  log:  { arity: 1, kind: 'scalar', fn: (a) => a > 0 ? Math.log(a) : null },
  exp:  { arity: 1, kind: 'scalar', fn: (a) => Math.exp(a) },
  sqrt: { arity: 1, kind: 'scalar', fn: (a) => a >= 0 ? Math.sqrt(a) : null },
  min:  { arity: 2, kind: 'scalar', fn: (a, b) => Math.min(a, b) },
  max:  { arity: 2, kind: 'scalar', fn: (a, b) => Math.max(a, b) },
  pct:  { arity: 2, kind: 'scalar', fn: (a, b) => b === 0 ? null : ((a - b) / b) * 100 },
  // Series functions — operate on the entire time-aligned series
  ma:   { arity: 2, kind: 'series' },  // ma(series, n)
  lag:  { arity: 2, kind: 'series' },  // lag(series, n)
  yoy:  { arity: 1, kind: 'series' },  // yoy(series) — uses 252 bars for daily, 12 for monthly
};

export const tokenizeMathExpr = (expr) => {
  // Strip line-end comments (#...) before tokenizing
  const stripped = expr.replace(/#[^\n]*/g, '');
  const tokens = [];
  let i = 0;
  const s = stripped;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === ';') { tokens.push({ kind: 'sep' }); i++; continue; }
    if (c === ',') { tokens.push({ kind: 'comma' }); i++; continue; }
    if (c === '=') { tokens.push({ kind: 'eq' }); i++; continue; }
    if ('+-*/()'.includes(c)) { tokens.push({ kind: 'op', value: c }); i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      // Read an identifier-like word — series ids contain slashes,
      // function/variable names don't.
      let j = i;
      while (j < s.length && /[A-Za-z0-9_./'-]/.test(s[j])) j++;
      const word = s.slice(i, j);
      if (word === 'let') {
        tokens.push({ kind: 'let' });
      } else if (word.split('/').length >= 3) {
        tokens.push({ kind: 'series', value: word });
      } else if (/^\d/.test(word)) {
        // Started with digit but treated as word — bail
        return null;
      } else if (FUNCTIONS[word]) {
        tokens.push({ kind: 'func', value: word });
      } else {
        // Bare identifier — treat as variable reference
        tokens.push({ kind: 'var', value: word });
      }
      i = j; continue;
    }
    if (/[\d.]/.test(c)) {
      let j = i;
      while (j < s.length && /[\d.]/.test(s[j])) j++;
      tokens.push({ kind: 'num', value: Number(s.slice(i, j)) });
      i = j; continue;
    }
    return null;
  }
  return tokens;
};

const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 };

// Split a token stream into statements separated by ';'.
// Each statement is either a `let` binding or an expression.
const parseStatements = (tokens) => {
  const stmts = [];
  let cur = [];
  for (const t of tokens) {
    if (t.kind === 'sep') {
      if (cur.length > 0) { stmts.push(cur); cur = []; }
    } else {
      cur.push(t);
    }
  }
  if (cur.length > 0) stmts.push(cur);
  return stmts;
};

// Convert one statement's tokens into RPN. Returns either:
//   { kind: 'let', name, rpn }
//   { kind: 'expr', rpn }
// Returns null on parse error.
const stmtToRpn = (stmtTokens) => {
  // Detect `let name = ...` form
  if (stmtTokens.length >= 4 &&
      stmtTokens[0].kind === 'let' &&
      stmtTokens[1].kind === 'var' &&
      stmtTokens[2].kind === 'eq') {
    const name = stmtTokens[1].value;
    const exprTokens = stmtTokens.slice(3);
    const rpn = shuntYard(exprTokens);
    if (!rpn) return null;
    return { kind: 'let', name, rpn };
  }
  const rpn = shuntYard(stmtTokens);
  if (!rpn) return null;
  return { kind: 'expr', rpn };
};

const shuntYard = (tokens) => {
  // Standard shunting-yard extended with function calls and commas.
  // Function call: name '(' arg [',' arg]* ')'. We push the function
  // onto the operator stack; when we hit ')' we pop ops until '('
  // and then if the top is a function, pop it onto output.
  const out = [];
  const ops = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'num' || t.kind === 'series' || t.kind === 'var') {
      out.push(t);
      continue;
    }
    if (t.kind === 'func') {
      ops.push(t);
      continue;
    }
    if (t.kind === 'comma') {
      // Pop until '(' but don't pop the '('
      while (ops.length && ops[ops.length - 1].value !== '(') out.push(ops.pop());
      continue;
    }
    if (t.kind === 'op') {
      if (t.value === '(') { ops.push(t); continue; }
      if (t.value === ')') {
        while (ops.length && ops[ops.length - 1].value !== '(') out.push(ops.pop());
        if (ops.length === 0) return null; // mismatched paren
        ops.pop(); // discard '('
        // If a function is on top of the stack, it's a function call
        if (ops.length > 0 && ops[ops.length - 1].kind === 'func') {
          out.push(ops.pop());
        }
        continue;
      }
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.value === '(' || top.kind === 'func') break;
        if (PREC[top.value] >= PREC[t.value]) out.push(ops.pop());
        else break;
      }
      ops.push(t);
    }
  }
  while (ops.length) {
    const top = ops.pop();
    if (top.value === '(' || top.value === ')') return null; // mismatched
    out.push(top);
  }
  return out;
};

// Evaluate an RPN sequence in series mode — every operand is
// itself a per-date series (Map<dateStr, number|null>) and
// operators apply elementwise. This lets series functions like
// ma() and lag() compose with arithmetic correctly.
//
// `varBindings` is a Map<string, SeriesMap> for `let`-bound names.
// `seriesLookup(id)` returns a SeriesMap for a DBnomics id.
//
// Returns a SeriesMap (the result series).
const evalRpnSeries = (rpn, seriesLookup, varBindings, allDates) => {
  const stack = [];
  // Helper: scalar-mode wrapper for an op
  const elementwiseOp = (op, A, B) => {
    const out = new Map();
    for (const t of allDates) {
      const a = (A instanceof Map) ? A.get(t) : A;
      const b = (B instanceof Map) ? B.get(t) : B;
      if (a == null || b == null) { out.set(t, null); continue; }
      let v;
      if (op === '+') v = a + b;
      else if (op === '-') v = a - b;
      else if (op === '*') v = a * b;
      else if (op === '/') v = b === 0 ? null : a / b;
      out.set(t, Number.isFinite(v) ? v : null);
    }
    return out;
  };
  const liftScalar = (x) => {
    // Promote a constant to a constant SeriesMap so elementwise
    // ops can mix scalars and series.
    if (x instanceof Map) return x;
    const m = new Map();
    for (const t of allDates) m.set(t, x);
    return m;
  };
  for (const t of rpn) {
    if (t.kind === 'num') { stack.push(t.value); continue; }
    if (t.kind === 'series') {
      const m = seriesLookup(t.value);
      stack.push(m ?? new Map());
      continue;
    }
    if (t.kind === 'var') {
      const m = varBindings.get(t.value);
      if (!m) return null;
      stack.push(m);
      continue;
    }
    if (t.kind === 'func') {
      const def = FUNCTIONS[t.value];
      if (!def) return null;
      const args = [];
      for (let k = 0; k < def.arity; k++) args.unshift(stack.pop());
      let result;
      if (def.kind === 'scalar') {
        // Scalar function — apply elementwise across allDates
        result = new Map();
        const ams = args.map(a => liftScalar(a));
        for (const dt of allDates) {
          const vals = ams.map(m => m.get(dt));
          if (vals.some(v => v == null)) { result.set(dt, null); continue; }
          const v = def.fn(...vals);
          result.set(dt, Number.isFinite(v) ? v : null);
        }
      } else if (def.kind === 'series') {
        // Series function — apply over the time axis
        if (t.value === 'ma') {
          const series = liftScalar(args[0]);
          const n = Math.max(1, Math.round(args[1] instanceof Map ? Number.NaN : args[1]));
          if (!Number.isFinite(n)) return null;
          result = new Map();
          // Walk dates in order, maintain rolling sum
          let buf = [];
          let sum = 0;
          for (const dt of allDates) {
            const v = series.get(dt);
            if (v == null) {
              result.set(dt, null);
              continue;
            }
            buf.push(v); sum += v;
            if (buf.length > n) sum -= buf.shift();
            result.set(dt, buf.length === n ? +(sum / n).toFixed(6) : null);
          }
        } else if (t.value === 'lag') {
          const series = liftScalar(args[0]);
          const n = Math.max(0, Math.round(args[1] instanceof Map ? Number.NaN : args[1]));
          if (!Number.isFinite(n)) return null;
          result = new Map();
          // Build an ordered array of (dt, value) and lookup by index
          const ordered = allDates.map(dt => [dt, series.get(dt)]);
          for (let i = 0; i < ordered.length; i++) {
            const [dt] = ordered[i];
            if (i < n) { result.set(dt, null); continue; }
            const [, v] = ordered[i - n];
            result.set(dt, v);
          }
        } else if (t.value === 'yoy') {
          // YoY % change — guess lookback from cadence
          const series = liftScalar(args[0]);
          // Detect cadence by sampling 3 consecutive dates
          let lookback = 252; // default daily
          if (allDates.length >= 3) {
            const a = new Date(allDates[allDates.length - 1]);
            const b = new Date(allDates[allDates.length - 2]);
            const dDays = Math.abs((a - b) / 86400000);
            if (dDays > 25) lookback = 12;       // monthly
            else if (dDays > 5) lookback = 52;   // weekly
            else lookback = 252;                  // daily
          }
          result = new Map();
          const ordered = allDates.map(dt => [dt, series.get(dt)]);
          for (let i = 0; i < ordered.length; i++) {
            const [dt, cur] = ordered[i];
            if (i < lookback || cur == null) { result.set(dt, null); continue; }
            const [, old] = ordered[i - lookback];
            if (old == null || old === 0) { result.set(dt, null); continue; }
            result.set(dt, +(((cur - old) / old) * 100).toFixed(6));
          }
        } else {
          return null;
        }
      }
      stack.push(result);
      continue;
    }
    if (t.kind === 'op') {
      const b = stack.pop(), a = stack.pop();
      if (a == null && b == null) { stack.push(null); continue; }
      const A = liftScalar(a == null ? 0 : a);
      const B = liftScalar(b == null ? 0 : b);
      stack.push(elementwiseOp(t.value, A, B));
    }
  }
  return stack[0];
};

// Top-level entry point. Returns
//   { points: [{t, v}], referencedSeriesIds: [...] } | null
export const computeMathSeries = (expr, seriesCache) => {
  const tokens = tokenizeMathExpr(expr);
  if (!tokens || tokens.length === 0) return null;
  const referenced = Array.from(new Set(
    tokens.filter(t => t.kind === 'series').map(t => t.value)
  ));
  if (referenced.length === 0) return null;
  // Need all referenced series cached and ok
  const datas = referenced.map(id => seriesCache[id]?.data);
  if (datas.some(d => !d || !Array.isArray(d.points))) {
    return { points: [], referencedSeriesIds: referenced, missing: true };
  }
  // Build per-series date→value lookups
  const lookups = {};
  let dateSet = null;
  datas.forEach((d, i) => {
    const m = new Map();
    for (const p of d.points) if (p.v != null) m.set(p.t, p.v);
    lookups[referenced[i]] = m;
    const keys = new Set(m.keys());
    dateSet = dateSet === null
      ? keys
      : new Set([...dateSet].filter(k => keys.has(k)));
  });
  const allDates = Array.from(dateSet ?? []).sort();
  const seriesLookup = (id) => lookups[id] ?? null;
  // Parse statements
  const stmts = parseStatements(tokens);
  if (stmts.length === 0) return null;
  // Evaluate sequentially. `let` binds a name; final expr is result.
  const varBindings = new Map();
  let lastResult = null;
  for (const stmt of stmts) {
    const parsed = stmtToRpn(stmt);
    if (!parsed) return null;
    const result = evalRpnSeries(parsed.rpn, seriesLookup, varBindings, allDates);
    if (result == null) return null;
    if (parsed.kind === 'let') {
      varBindings.set(parsed.name, result instanceof Map ? result : new Map([['_', result]]));
    } else {
      lastResult = result;
    }
  }
  if (!lastResult || !(lastResult instanceof Map)) {
    // Single-scalar expression — broadcast to all dates
    const m = new Map();
    for (const t of allDates) m.set(t, lastResult);
    lastResult = m;
  }
  // Convert SeriesMap → points array
  const points = allDates.map(t => ({
    t,
    v: lastResult.has(t) && Number.isFinite(lastResult.get(t)) ? lastResult.get(t) : null,
  }));
  return { points, referencedSeriesIds: referenced };
};
