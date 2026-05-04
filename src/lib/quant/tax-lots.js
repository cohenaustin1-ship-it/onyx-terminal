// IMO Onyx Terminal — tax lots / wash-sale infrastructure
//
// Phase 3o.95 (file split, batch 7b). IRS Sec. 1091 wash-sale
// substantially-identical detection plus 30-day swap-pair table for
// tax-loss-harvesting workflows.
//
// Public exports:
//   areSubstantiallyIdentical(symA, symB)
//     → bool   True when both symbols appear in the same group of
//              SUBSTANTIALLY_IDENTICAL_GROUPS, OR are the exact same
//              symbol. Used to flag wash-sale violations across the
//              tax-aware rebalancer + harvester surfaces.
//   TLH_SWAP_MAP
//     → Map<sym, [{ to: [sym], note }]>  Lookup of common-practice
//              swap targets that maintain market exposure during the
//              30-day wash-sale window without triggering Sec. 1091
//              (different indices, sponsors, or strategies).
//
// Both internal data tables (SUBSTANTIALLY_IDENTICAL_GROUPS,
// TLH_SWAP_PAIRS) are heuristic — IRS hasn't published exhaustive
// rulings beyond same-issuer different-share-class cases. Confirm
// with a CPA before executing wash-sale-avoidance trades.

// SUBSTANTIALLY_IDENTICAL_GROUPS — IRS wash-sale rule disallows
// losses on sales where you repurchase "substantially identical"
// securities within 30 days before/after. This list captures common
// equity-ETF substitutions that the IRS would treat as identical:
//
//   S&P 500: SPY, IVV, VOO, SPLG, RSP (last is equal-weight, debatable)
//   Nasdaq 100: QQQ, QQQM, ONEQ
//   Total US Market: VTI, ITOT, SCHB, VTHR
//   Russell 2000: IWM, VTWO, IJR (close but not exact — small-cap blend)
//   Dow: DIA
//   International developed: VEA, EFA, IEFA, IEUR
//   Emerging markets: VWO, EEM, IEMG, SCHE
//   Treasury duration: TLT, EDV, GOVT, IEF (different durations actually)
//   Corporate bonds: LQD, VCIT, AGG, BND
//   Tech sector: XLK, VGT, FTEC
//   Healthcare: XLV, VHT, IHF
//   Financials: XLF, VFH, IYG
//
// Each group represents securities the IRS would generally treat as
// substantially identical under Sec. 1091. The list is heuristic —
// IRS hasn't published an exhaustive ruling, but practitioners
// generally treat these as equivalent.
const SUBSTANTIALLY_IDENTICAL_GROUPS = [
  ['SPY', 'IVV', 'VOO', 'SPLG'],
  ['QQQ', 'QQQM', 'ONEQ'],
  ['VTI', 'ITOT', 'SCHB', 'VTHR'],
  ['IWM', 'VTWO'],
  ['DIA'],
  ['VEA', 'EFA', 'IEFA'],
  ['VWO', 'EEM', 'IEMG', 'SCHE'],
  ['TLT', 'EDV'],
  ['IEF', 'VGIT'],
  ['LQD', 'VCIT'],
  ['AGG', 'BND'],
  ['XLK', 'VGT', 'FTEC'],
  ['XLV', 'VHT'],
  ['XLF', 'VFH'],
  ['XLY', 'VCR'],
  ['XLP', 'VDC'],
  ['XLE', 'VDE', 'IXC'],
  ['XLI', 'VIS'],
  ['XLB', 'VAW'],
  ['XLU', 'VPU'],
  ['XLRE', 'VNQ'],
  ['XLC', 'VOX'],
  ['GLD', 'IAU', 'SGOL'],
  ['SLV', 'SIVR'],
];
// Build symbol → identical-set map for quick lookup
const buildIdenticalsMap = () => {
  const map = new Map();
  for (const group of SUBSTANTIALLY_IDENTICAL_GROUPS) {
    const set = new Set(group);
    for (const sym of group) {
      map.set(sym.toUpperCase(), set);
    }
  }
  return map;
};
const IDENTICALS_MAP = buildIdenticalsMap();
// Returns true if symA and symB are substantially identical per the
// SUBSTANTIALLY_IDENTICAL_GROUPS list, OR are the exact same symbol.
export const areSubstantiallyIdentical = (symA, symB) => {
  if (!symA || !symB) return false;
  const a = symA.toUpperCase();
  const b = symB.toUpperCase();
  if (a === b) return true;
  const setA = IDENTICALS_MAP.get(a);
  if (!setA) return false;
  return setA.has(b);
};

// 3o.82: TLH SWAP PAIRS — pairs that are similar (correlated, same
// asset class, same broad sector exposure) but NOT substantially
// identical per IRS (different indices, sponsors, or strategies).
// These are common-practice swap pairs used to maintain market
// exposure during the 30-day wash-sale window.
// IMPORTANT: IRS hasn't issued definitive guidance on what counts
// as "substantially identical" beyond same-issuer different-share-
// class cases (e.g. SPY/IVV/VOO are widely considered identical).
// Different-index ETFs in similar categories (S&P 500 vs Russell 1000
// vs Total Market) are commonly treated as non-identical by tax pros
// but practitioners differ. This table is INFORMATIONAL — confirm
// with your CPA before executing wash-sale-avoidance trades.
const TLH_SWAP_PAIRS = [
  // S&P 500 / large-cap broad — different indices = generally accepted swap
  { from: ['SPY', 'IVV', 'VOO', 'SPLG'], to: ['VTI', 'ITOT', 'SCHB', 'VV'], note: 'S&P 500 → Total Market' },
  { from: ['SPY', 'IVV', 'VOO', 'SPLG'], to: ['RSP'], note: 'Cap-weight → Equal-weight' },
  { from: ['SPY', 'IVV', 'VOO', 'SPLG'], to: ['SCHX', 'VV'], note: 'S&P 500 → Russell 1000 / Vanguard Large-Cap' },
  // Nasdaq-100 / large-cap growth
  { from: ['QQQ', 'QQQM', 'ONEQ'], to: ['VUG', 'IWF'], note: 'Nasdaq-100 → Large-Cap Growth' },
  { from: ['QQQ', 'QQQM', 'ONEQ'], to: ['VGT', 'XLK'], note: 'Nasdaq-100 → Tech sector' },
  // Total market
  { from: ['VTI', 'ITOT', 'SCHB'], to: ['SPY', 'VOO', 'IVV'], note: 'Total Market → S&P 500' },
  // Small-cap
  { from: ['IWM', 'VTWO'], to: ['IJR', 'VB'], note: 'Russell 2000 → S&P SmallCap 600 / Vanguard Small-Cap' },
  // International developed
  { from: ['VEA', 'EFA', 'IEFA'], to: ['SCHF', 'IDEV'], note: 'MSCI EAFE → FTSE Developed ex-US' },
  // Emerging markets
  { from: ['VWO', 'EEM', 'IEMG', 'SCHE'], to: ['EMXC'], note: 'Broad EM → EM ex-China' },
  // Long Treasuries
  { from: ['TLT'], to: ['VGLT', 'GOVT'], note: '20+yr Treasuries → Vanguard Long-Term Govt' },
  // Intermediate Treasuries
  { from: ['IEF', 'VGIT'], to: ['SCHR', 'GOVT'], note: '7-10yr Treasuries → Schwab Intermediate Govt' },
  // IG Corp
  { from: ['LQD', 'VCIT'], to: ['IGIB', 'IGSB'], note: 'LT IG Corp → MT/ST IG Corp' },
  // Aggregate bond
  { from: ['AGG', 'BND'], to: ['SCHZ', 'BIV'], note: 'Aggregate Bond → Schwab/Vanguard Intermediate' },
  // Tech sector swaps (different index providers)
  { from: ['XLK'], to: ['VGT', 'FTEC', 'IYW'], note: 'S&P 500 Tech → MSCI/Russell Tech' },
  { from: ['VGT'], to: ['XLK', 'IYW'], note: 'MSCI Tech → S&P 500 Tech' },
  // Healthcare
  { from: ['XLV'], to: ['VHT', 'IYH'], note: 'S&P 500 Health → MSCI/Russell Health' },
  // Financials
  { from: ['XLF'], to: ['VFH', 'IYF'], note: 'S&P 500 Financials → MSCI/Russell Financials' },
  // Gold
  { from: ['GLD', 'IAU', 'SGOL'], to: ['GLDM', 'BAR'], note: 'Gold → Lower-cost gold variant' },
  // Note: IRS considers most gold ETFs likely identical. Listed for completeness.
];
// Build a quick lookup for swap suggestions
const buildTLHSwapMap = () => {
  const m = new Map();
  for (const pair of TLH_SWAP_PAIRS) {
    for (const fromSym of pair.from) {
      const key = fromSym.toUpperCase();
      if (!m.has(key)) m.set(key, []);
      m.get(key).push({ to: pair.to, note: pair.note });
    }
  }
  return m;
};
export const TLH_SWAP_MAP = buildTLHSwapMap();
