// IMO Onyx Terminal — options payoff module
//
// Phase 3o.92 (file split, batch 4): extracted from JPMOnyxTerminal.jsx.
// Options pricing + multi-leg P&L curves. Adapted from the
// Vibe-Trading "options-payoff" skill — pure JS, research-only
// (we never quote live options).
//
// Note: there's a separate `blackScholes` helper elsewhere in the
// monolith (older API, returns both call+put together). This module's
// `blackScholesAdvanced` is the typed single-side version with
// dividend yield support and full greeks — more convenient for
// multi-leg payoff analysis where each leg has its own type.
//
// Exports:
//   blackScholesAdvanced(S, K, T, r, sigma, type, q)
//     → { price, delta, gamma, vega, theta, rho }
//   computeOptionLegPnL(leg, priceGrid)
//     → number[]  (P&L array aligned with priceGrid)

// ════════════════════════════════════════════════════════════════════
// OPTIONS PAYOFF — Black-Scholes pricing + multi-leg P&L curves
// ════════════════════════════════════════════════════════════════════
//
// Adapted from the Vibe-Trading "options-payoff" skill. Pure JS,
// research-only (we never quote live options).

// Standard normal CDF approximation (Abramowitz & Stegun)
const _normCDF = (x) => {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
};

// blackScholes — European option price + greeks.
//   S = spot, K = strike, T = time to expiry in years, r = risk-free,
//   sigma = annualized vol, type = 'call' | 'put', q = dividend yield
// blackScholesAdvanced — typed Black-Scholes (single side) with
// dividend yield support and full greeks. Distinct from the existing
// blackScholes() helper (which returns both call+put together) so we
// keep both APIs; this one is more convenient for multi-leg payoff
// analysis where each leg has its own type.
export const blackScholesAdvanced = (S, K, T, r, sigma, type = 'call', q = 0) => {
  if (T <= 0 || sigma <= 0) {
    // Intrinsic only at expiry
    const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return { price: intrinsic, delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  }
  const sqT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + sigma * sigma / 2) * T) / (sigma * sqT);
  const d2 = d1 - sigma * sqT;
  const Nd1 = _normCDF(d1);
  const Nd2 = _normCDF(d2);
  // Standard normal PDF
  const phi = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  const ePos = Math.exp(-q * T);
  const erT  = Math.exp(-r * T);
  let price, delta, theta;
  if (type === 'call') {
    price = S * ePos * Nd1 - K * erT * Nd2;
    delta = ePos * Nd1;
    theta = -(S * ePos * phi(d1) * sigma) / (2 * sqT) - r * K * erT * Nd2 + q * S * ePos * Nd1;
  } else {
    price = K * erT * (1 - Nd2) - S * ePos * (1 - Nd1);
    delta = ePos * (Nd1 - 1);
    theta = -(S * ePos * phi(d1) * sigma) / (2 * sqT) + r * K * erT * (1 - Nd2) - q * S * ePos * (1 - Nd1);
  }
  const gamma = ePos * phi(d1) / (S * sigma * sqT);
  const vega = S * ePos * phi(d1) * sqT;
  const rho = type === 'call' ? K * T * erT * Nd2 / 100 : -K * T * erT * (1 - Nd2) / 100;
  return { price, delta, gamma, vega: vega / 100, theta: theta / 365, rho };
};

// computeOptionLegPnL — per-leg P&L at expiry over a price grid.
// Args: leg = { type: 'call'|'put'|'underlying', side: 'long'|'short',
//               strike, premium, qty }
// Returns: array of P&L values aligned with priceGrid.
export const computeOptionLegPnL = (leg, priceGrid) => {
  const sign = leg.side === 'long' ? 1 : -1;
  const qty = Math.abs(Number(leg.qty) || 1);
  return priceGrid.map(s => {
    let intrinsic = 0;
    if (leg.type === 'call') intrinsic = Math.max(s - Number(leg.strike), 0);
    else if (leg.type === 'put') intrinsic = Math.max(Number(leg.strike) - s, 0);
    else if (leg.type === 'underlying') intrinsic = s - Number(leg.strike); // strike = entry price
    const cost = leg.type === 'underlying' ? 0 : Number(leg.premium) || 0;
    const pnl = leg.type === 'underlying' ? intrinsic : (intrinsic - cost);
    return sign * qty * pnl;
  });
};
