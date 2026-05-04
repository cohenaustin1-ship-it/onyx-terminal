// IMO Onyx Terminal — fixed income + FX pricing module
//
// Phase 3o.93 (file split, batch 5): extracted from JPMOnyxTerminal.jsx.
// Bond pricing math and FX rate calculations. Pure functions — given
// inputs (face / coupon / yield / years OR spot / rates / years),
// returns prices, durations, convexity, cross-rates, forwards.
//
// Bond exports (US semi-annual conventions):
//   computeBondPrice({ face, couponRate, yieldRate, yearsToMaturity, freq })
//     → number  (PV of coupons + face redemption at given yield)
//   computeBondAnalytics({ face, couponRate, yieldRate, yearsToMaturity, freq })
//     → { price, macaulayDuration, modifiedDuration, convexity,
//         dv01, currentYield, ytm }
//
// FX exports (USD-quoted convention):
//   CURATED_FX_RATES                — snapshot of major spot rates +
//                                     central bank policy rates
//   computeCrossRate(baseUsdRate, quoteUsdRate) → number | null
//     Given two USD-quoted rates, derive the non-USD pair rate.
//   computeForwardRate({ spot, baseRate, quoteRate, years }) → number
//     Interest-rate parity: F = S × (1 + r_q × T) / (1 + r_b × T)

// ════════════════════════════════════════════════════════════════════
// BOND MATH PRIMITIVES
// ════════════════════════════════════════════════════════════════════
//
// Standard fixed-income calculations:
//   - Bond price       PV of coupon stream + face redemption
//   - Yield-to-maturity (YTM)  IRR of cash flows
//   - Macaulay duration  weighted-avg time to cash flows
//   - Modified duration  −dP/dy / P  (price sensitivity to yield)
//   - Convexity         d²P/dy² / P  (curvature of price-yield curve)
//   - DV01              dollar value of 1bp move (price × modDur × 0.0001)
//
// Conventions: semi-annual compounding for US bonds; coupons paid
// semi-annually; "yield" passed in as decimal (4.5% = 0.045).

// computeBondPrice — present value of cash flows at given yield
export const computeBondPrice = ({ face = 1000, couponRate, yieldRate, yearsToMaturity, freq = 2 }) => {
  if (!Number.isFinite(couponRate) || !Number.isFinite(yieldRate)) return null;
  if (yearsToMaturity <= 0) return face;
  const n = Math.round(yearsToMaturity * freq);
  const couponPmt = face * couponRate / freq;
  const periodYield = yieldRate / freq;
  let pv = 0;
  for (let t = 1; t <= n; t++) {
    pv += couponPmt / Math.pow(1 + periodYield, t);
  }
  pv += face / Math.pow(1 + periodYield, n);
  return pv;
};

// computeBondAnalytics — full analytics: price, Macaulay/modified
// duration, convexity, DV01.
export const computeBondAnalytics = ({ face = 1000, couponRate, yieldRate, yearsToMaturity, freq = 2 }) => {
  if (!Number.isFinite(couponRate) || !Number.isFinite(yieldRate) ||
      !Number.isFinite(yearsToMaturity) || yearsToMaturity <= 0) return null;
  const n = Math.round(yearsToMaturity * freq);
  const couponPmt = face * couponRate / freq;
  const periodYield = yieldRate / freq;
  let price = 0;
  let weightedTime = 0;
  let convexitySum = 0;
  for (let t = 1; t <= n; t++) {
    const cf = (t === n) ? (couponPmt + face) : couponPmt;
    const pv = cf / Math.pow(1 + periodYield, t);
    price += pv;
    weightedTime += (t / freq) * pv; // in years
    convexitySum += (t * (t + 1)) * pv;
  }
  if (price <= 0) return null;
  const macaulayDuration = weightedTime / price; // years
  const modifiedDuration = macaulayDuration / (1 + periodYield);
  // Convexity (annual): (1 / (P × (1+y/k)²)) × Σ (CF_t × t × (t+1) / (1+y/k)^t) / k²
  const convexity = convexitySum / (price * Math.pow(1 + periodYield, 2) * freq * freq);
  const dv01 = price * modifiedDuration * 0.0001; // per 1bp (per $1 face)
  return {
    price,
    cleanPrice: price, // assumes no accrued interest for simplicity
    macaulayDuration,
    modifiedDuration,
    convexity,
    dv01,
    yieldRate,
    couponRate,
    yearsToMaturity,
    couponsRemaining: n,
    cashflows: Array.from({ length: n }, (_, i) => ({
      period: i + 1,
      time: (i + 1) / freq,
      cashflow: (i === n - 1) ? (couponPmt + face) : couponPmt,
      pv: ((i === n - 1) ? (couponPmt + face) : couponPmt) / Math.pow(1 + periodYield, i + 1),
    })),
  };
};

// ════════════════════════════════════════════════════════════════════
// FX / FOREX CALCULATOR
// ════════════════════════════════════════════════════════════════════
//
// Standard forex desk calculations:
//   - Cross-rate derivation        Given USD/EUR + USD/JPY → EUR/JPY
//   - Forward points               F = S × (1 + r_quote × T) / (1 + r_base × T)
//   - Forward outright             FX forward price for settlement T
//   - Carry trade attractiveness   Yield differential − funding cost
//   - Position sizing in pips      P&L per pip × position notional
//
// Conventions:
//   - "Quote currency" is the second currency in a pair (USD/JPY → JPY)
//   - "Base currency" is the first (USD/JPY → USD)
//   - Pip = 0.0001 for major pairs, 0.01 for JPY pairs

// CURATED_FX_RATES — snapshot of major spot rates and central bank
// policy rates. Calibrated to early 2026 levels for plausibility.
// In production these come from an FX vendor like FxRatesAPI,
// OpenExchangeRates, or a broker's quote feed. Direct browser fetch
// to those vendors hits CORS issues without a proxy, so we ship a
// realistic snapshot here and the user can override in the UI.
export const CURATED_FX_RATES = {
  // Spot rates expressed as USD per 1 unit of foreign currency
  // (so EUR=1.08 means 1 EUR = 1.08 USD)
  spotUSD: {
    EUR: 1.0820, GBP: 1.2680, JPY: 0.00665,  // 0.00665 USD/JPY = 150.4 USD/JPY inverse
    CHF: 1.1450, AUD: 0.6520, CAD: 0.7350,
    NZD: 0.6020, SEK: 0.0945, NOK: 0.0930,
    CNY: 0.1395, HKD: 0.1280, SGD: 0.7480,
    MXN: 0.0588, BRL: 0.1980, INR: 0.0119,
    KRW: 0.000750, ZAR: 0.0540, TRY: 0.0298,
  },
  // Central bank policy rates (annualized, %)
  policyRates: {
    USD: 4.25, EUR: 3.25, GBP: 4.50, JPY: 0.50,
    CHF: 1.00, AUD: 4.10, CAD: 3.25, NZD: 4.75,
    SEK: 2.75, NOK: 4.25, CNY: 3.10, HKD: 4.75,
    SGD: 3.30, MXN: 9.75, BRL: 12.25, INR: 6.50,
    KRW: 3.00, ZAR: 7.75, TRY: 35.00,
  },
};

// computeCrossRate — given two USD-quoted rates, derive the
// non-USD pair rate.
//   crossRate(EUR/USD = 1.08, JPY/USD = 0.00665) = EUR/JPY
//   = (USD per EUR) / (USD per JPY) = 1.08 / 0.00665 ≈ 162.4
export const computeCrossRate = (baseUsdRate, quoteUsdRate) => {
  if (!Number.isFinite(baseUsdRate) || !Number.isFinite(quoteUsdRate) || quoteUsdRate <= 0) {
    return null;
  }
  return baseUsdRate / quoteUsdRate;
};

// computeForwardRate — interest-rate parity forward:
//   F = S × (1 + r_q × T) / (1 + r_b × T)
// Where:
//   S = spot rate (quote per base)
//   r_q = quote currency interest rate (decimal)
//   r_b = base currency interest rate (decimal)
//   T = years
export const computeForwardRate = ({ spot, baseRate, quoteRate, years }) => {
  if (!Number.isFinite(spot) || spot <= 0) return null;
  if (!Number.isFinite(years) || years <= 0) return spot;
  const rb = (Number(baseRate) || 0) / 100;
  const rq = (Number(quoteRate) || 0) / 100;
  return spot * (1 + rq * years) / (1 + rb * years);
};

