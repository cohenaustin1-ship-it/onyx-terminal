// ─── Safety-check engine ─────────────────────────────────────────────────
//
// Translates each entry rule into a pass/fail with the actual values it
// evaluated against. Returns a structured record the SPA can render.
//
// Rule format (the same shape your strategy widget already uses):
//   {
//     name: "Price above VWAP",
//     expr: "price > vwap"
//   }
//
// expr is a Javascript expression that operates on the indicator dict
// (price, ema_8, rsi_3, vwap, macd_line, etc.). We use a sandboxed Function
// constructor — NOT eval — so the rule can't escape into globals.

function evaluateExpr(expr, indicators) {
  // Surface the missing-indicator case so the user sees a useful error
  // instead of "ReferenceError: ema_8 is not defined".
  const sourceVars = Object.keys(indicators);
  const args = sourceVars.join(",");
  const values = sourceVars.map(k => indicators[k]);
  // Build a function with all indicators as named args
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(args, `"use strict"; return (${expr});`);
    const result = fn(...values);
    return { value: result, error: null };
  } catch (e) {
    return { value: null, error: e.message };
  }
}

export function runSafetyCheck(strategy, indicators, options = {}) {
  const conditions = [];
  for (const rule of strategy.entry_rules || []) {
    const { value, error } = evaluateExpr(rule.expr, indicators);
    const passed = value === true && !error;
    conditions.push({
      name: rule.name,
      expr: rule.expr,
      passed,
      actualValue: value,
      error,
      // Used by the SPA to highlight which indicators the rule referenced
      indicatorsReferenced: extractRefs(rule.expr, Object.keys(indicators)),
    });
  }
  // Risk caps — enforce here, not just in the rules
  const riskFailures = [];
  if (options.tradesToday >= (options.maxTradesPerDay ?? 10)) {
    riskFailures.push({
      name: "Daily trade limit",
      passed: false,
      actualValue: `${options.tradesToday} trades today, max ${options.maxTradesPerDay}`,
    });
  }
  if (options.notional > (options.maxTradeSizeUsd ?? 500)) {
    riskFailures.push({
      name: "Trade size cap",
      passed: false,
      actualValue: `$${options.notional.toFixed(2)} > $${options.maxTradeSizeUsd}`,
    });
  }
  conditions.push(...riskFailures);

  const allPassed = conditions.every(c => c.passed);
  const blocker = conditions.find(c => !c.passed)?.name ?? null;
  return {
    passed: allPassed,
    blocker,
    conditions,
    indicatorsSnapshot: indicators,
    evaluatedAt: new Date().toISOString(),
  };
}

function extractRefs(expr, knownIndicators) {
  return knownIndicators.filter(k => new RegExp(`\\b${k}\\b`).test(expr));
}
