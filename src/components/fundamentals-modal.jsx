// IMO Onyx Terminal — Fundamentals modal
//
// Phase 3p.26 file-splitting / extracted from JPMOnyxTerminal.jsx.
//
// Slide-out modal showing fundamentals (revenue, earnings, ratios)
// for any ticker. Polygon-fed when available, falls back to curated
// cached data. Used by both Chart and TradePage so kept as a shared
// component module.
//
// Public export:
//   FundamentalsModal({ instrument, onClose })

import React, { useState, useEffect, useMemo } from 'react';
import { Search } from 'lucide-react';
import { COLORS } from '../lib/constants.js';
import { fetchPolygonFinancials } from '../lib/polygon-api.js';

// Fundamental statement schemas (inlined from monolith — only
// FundamentalsModal uses these). Each entry maps to a row in the
// rendered table.
//   FUND_INCOME    — income statement line items
//   FUND_BALANCE   — balance sheet line items
//   FUND_CASHFLOW  — cash flow statement line items
//   FUND_STATS     — derived ratios + metrics
const FUND_INCOME = [
  { id: 'revenue',         label: 'Total revenue' },
  { id: 'cogs',            label: 'Cost of goods sold' },
  { id: 'd-and-a-cogs',    label: 'Depreciation and amortization' },
  { id: 'depreciation-cogs',label: 'Depreciation' },
  { id: 'amort-intangibles',label: 'Amortization of intangibles' },
  { id: 'amort-deferred-charges',label: 'Amortization of deferred charges' },
  { id: 'other-cogs',      label: 'Other cost of goods sold' },
  { id: 'gross-profit',    label: 'Gross profit' },
  { id: 'opex-excl-cogs',  label: 'Operating expenses (excl. COGS)' },
  { id: 'sg-and-a',        label: 'Selling/general/admin expenses (total)' },
  { id: 'r-and-d',         label: 'Research & development' },
  { id: 'sg-and-a-other',  label: 'Selling/general/admin expenses (other)' },
  { id: 'other-opex',      label: 'Other operating expenses (total)' },
  { id: 'opex',            label: 'Total operating expenses' },
  { id: 'operating-income',label: 'Operating income' },
  { id: 'non-op-income',   label: 'Non-operating income (total)' },
  { id: 'interest-exp',    label: 'Interest expense, net of interest capitalized' },
  { id: 'interest-exp-debt',label: 'Interest expense on debt' },
  { id: 'interest-capitalized',label: 'Interest capitalized' },
  { id: 'non-op-income-excl',label: 'Non-operating income (excl. interest exp)' },
  { id: 'non-op-int-income',label: 'Non-operating interest income' },
  { id: 'pretax-eq-earnings',label: 'Pretax equity in earnings' },
  { id: 'misc-non-op-exp', label: 'Miscellaneous non-operating expense' },
  { id: 'unusual-inc-exp', label: 'Unusual income/expense' },
  { id: 'impairments',     label: 'Impairments' },
  { id: 'restructuring',   label: 'Restructuring charge' },
  { id: 'legal-claim',     label: 'Legal claim expense' },
  { id: 'unrealized-gain-loss',label: 'Unrealized gain/loss' },
  { id: 'other-exceptional',label: 'Other exceptional charges' },
  { id: 'pretax-income',   label: 'Pretax income' },
  { id: 'equity-earnings', label: 'Equity in earnings' },
  { id: 'taxes',           label: 'Taxes' },
  { id: 'income-tax-current',label: 'Income tax (current)' },
  { id: 'income-tax-current-domestic',label: 'Income tax (current - domestic)' },
  { id: 'income-tax-current-foreign',label: 'Income tax (current - foreign)' },
  { id: 'income-tax-deferred',label: 'Income tax, deferred' },
  { id: 'income-tax-deferred-domestic',label: 'Income tax (deferred - domestic)' },
  { id: 'income-tax-deferred-foreign',label: 'Income tax (deferred - foreign)' },
  { id: 'income-tax-credits',label: 'Income tax credits' },
  { id: 'minority-interest',label: 'Non-controlling/minority interest' },
  { id: 'after-tax-other', label: 'After tax other income/expense' },
  { id: 'ni-before-disc',  label: 'Net income before discontinued operations' },
  { id: 'discontinued-ops',label: 'Discontinued operations' },
  { id: 'net-income',      label: 'Net income' },
  { id: 'dilution-adjustment',label: 'Dilution adjustment' },
  { id: 'preferred-dividends-is',label: 'Preferred dividends' },
  { id: 'diluted-ni-common',label: 'Diluted net income available to common' },
  { id: 'eps-basic',       label: 'Basic earnings per share (basic EPS)' },
  { id: 'eps-diluted',     label: 'Diluted earnings per share (diluted EPS)' },
  { id: 'avg-basic-shares',label: 'Average basic shares outstanding' },
  { id: 'shares-diluted',  label: 'Diluted shares outstanding' },
  { id: 'shares-basic',    label: 'Shares outstanding (basic)' },
  { id: 'ebitda',          label: 'EBITDA' },
  { id: 'ebit',            label: 'EBIT' },
];
const FUND_BALANCE = [
  { id: 'total-assets',    label: 'Total assets' },
  { id: 'current-assets',  label: 'Total current assets' },
  { id: 'cash-st-inv',     label: 'Cash and short term investments' },
  { id: 'cash',            label: 'Cash & equivalents' },
  { id: 'short-investments',label: 'Short term investments' },
  { id: 'total-receivables',label: 'Total receivables (net)' },
  { id: 'ar-trade-net',    label: 'Accounts receivable (trade, net)' },
  { id: 'ar-gross',        label: 'Accounts receivables (gross)' },
  { id: 'bad-debt',        label: 'Bad debt / Doubtful accounts' },
  { id: 'other-receivables',label: 'Other receivables' },
  { id: 'inventory',       label: 'Total inventory' },
  { id: 'inv-wip',         label: 'Inventories (work in progress)' },
  { id: 'inv-progress',    label: 'Inventories (progress payments & other)' },
  { id: 'inv-finished',    label: 'Inventories (finished goods)' },
  { id: 'inv-raw',         label: 'Inventories (raw materials)' },
  { id: 'prepaid',         label: 'Prepaid expenses' },
  { id: 'other-current',   label: 'Other current assets (total)' },
  { id: 'noncurrent-assets',label: 'Total non-current assets' },
  { id: 'lt-investments',  label: 'Long term investments' },
  { id: 'note-receivable-lt',label: 'Note receivable (long term)' },
  { id: 'inv-unconsolidated',label: 'Investments in unconsolidated subsidiaries' },
  { id: 'other-investments',label: 'Other investments' },
  { id: 'ppe-net',         label: 'Net property/plant/equipment' },
  { id: 'ppe-gross',       label: 'Gross property/plant/equipment' },
  { id: 'ppe-buildings',   label: 'Property/plant/equipment (buildings)' },
  { id: 'ppe-construction',label: 'Property/plant/equipment (construction in progress)' },
  { id: 'ppe-machinery',   label: 'Property/plant/equipment (machinery & equipment)' },
  { id: 'ppe-land',        label: 'Property/plant/equipment (land & improvements)' },
  { id: 'ppe-leased',      label: 'Property/plant/equipment (leased properties)' },
  { id: 'ppe-leases',      label: 'Property/plant/equipment (leases)' },
  { id: 'ppe-computer',    label: 'Property/plant/equipment (computer software & equipment)' },
  { id: 'ppe-transport',   label: 'Property/plant/equipment (transportation equipment)' },
  { id: 'ppe-other',       label: 'Property/plant/equipment (other)' },
  { id: 'accum-dep-total', label: 'Accumulated depreciation (total)' },
  { id: 'accum-dep-buildings',label: 'Accumulated depreciation (buildings)' },
  { id: 'accum-dep-construction',label: 'Accumulated depreciation (construction in progress)' },
  { id: 'accum-dep-machinery',label: 'Accumulated depreciation (machinery & equipment)' },
  { id: 'accum-dep-land',  label: 'Accumulated depreciation (land & improvements)' },
  { id: 'accum-dep-leased',label: 'Accumulated depreciation (leased properties)' },
  { id: 'accum-dep-computer',label: 'Accumulated depreciation (computer software & equipment)' },
  { id: 'accum-dep-transport',label: 'Accumulated depreciation (transportation)' },
  { id: 'accum-dep-other', label: 'Accumulated depreciation (other)' },
  { id: 'def-tax-assets',  label: 'Deferred tax assets' },
  { id: 'intangibles-net', label: 'Net intangible assets' },
  { id: 'goodwill',        label: 'Goodwill (net)' },
  { id: 'goodwill-gross',  label: 'Goodwill (gross)' },
  { id: 'accum-goodwill-amort',label: 'Accumulated goodwill amortization' },
  { id: 'other-intangibles-net',label: 'Other intangibles (net)' },
  { id: 'other-intangibles-gross',label: 'Other intangibles (gross)' },
  { id: 'accum-other-intang-amort',label: 'Accumulated amortization of other intangibles' },
  { id: 'deferred-charges',label: 'Deferred charges' },
  { id: 'other-lt-assets', label: 'Other long term assets (total)' },
  { id: 'total-liab',      label: 'Total liabilities' },
  { id: 'current-liab',    label: 'Total current liabilities' },
  { id: 'st-debt',         label: 'Short term debt' },
  { id: 'current-portion-lt-debt',label: 'Current portion of LT debt and capital lease' },
  { id: 'st-debt-excl',    label: 'Short term debt (excl. current portion)' },
  { id: 'notes-payable',   label: 'Notes payable' },
  { id: 'other-st-debt',   label: 'Other short term debt' },
  { id: 'ap',              label: 'Accounts payable' },
  { id: 'income-tax-payable',label: 'Income tax payable' },
  { id: 'dividends-payable',label: 'Dividends payable' },
  { id: 'accrued-payroll', label: 'Accrued payroll' },
  { id: 'def-income-current',label: 'Deferred income (current)' },
  { id: 'other-current-liab',label: 'Other current liabilities' },
  { id: 'noncurrent-liab', label: 'Total non-current liabilities' },
  { id: 'long-term-debt',  label: 'Long term debt' },
  { id: 'long-term-debt-no-lease', label: 'Long term debt (excl. lease liabilities)' },
  { id: 'lease-obligations',label: 'Capital and operating lease obligations' },
  { id: 'cap-lease',       label: 'Capitalized lease obligations' },
  { id: 'op-lease',        label: 'Operating lease liabilities' },
  { id: 'risk-charge',     label: 'Provision for risks & charge' },
  { id: 'def-tax-liab',    label: 'Deferred tax liabilities' },
  { id: 'def-income-nc',   label: 'Deferred income (non-current)' },
  { id: 'other-nc-liab',   label: 'Other non-current liabilities (total)' },
  { id: 'total-equity',    label: 'Total equity' },
  { id: 'shareholders-eq', label: "Shareholders' equity" },
  { id: 'common-eq',       label: 'Common equity (total)' },
  { id: 'retained-earnings',label: 'Retained earnings' },
  { id: 'paid-in-capital', label: 'Paid in capital' },
  { id: 'common-par',      label: 'Common stock par / Carrying value' },
  { id: 'apic',            label: 'Additional paid-in capital / Capital surplus' },
  { id: 'treasury',        label: 'Treasury stock (common)' },
  { id: 'other-common-eq', label: 'Other common equity' },
  { id: 'preferred-stock', label: 'Preferred stock (carrying value)' },
  { id: 'minority',        label: 'Minority interest' },
  { id: 'total-liab-eq',   label: "Total liabilities & shareholders' equities" },
  { id: 'total-debt',      label: 'Total debt' },
  { id: 'net-debt',        label: 'Net debt' },
];
const FUND_CASHFLOW = [
  { id: 'cf-operating',    label: 'Cash from operating activities' },
  { id: 'funds-from-ops',  label: 'Funds from operations' },
  { id: 'net-income-cf',   label: 'Net income (cash flow)' },
  { id: 'd-and-a',         label: 'Depreciation & amortization (cash flow)' },
  { id: 'depreciation',    label: 'Depreciation/depletion' },
  { id: 'amortization',    label: 'Amortization' },
  { id: 'def-tax-cf',      label: 'Deferred taxes (cash flow)' },
  { id: 'non-cash',        label: 'Non-cash items' },
  { id: 'wc-changes',      label: 'Changes in working capital' },
  { id: 'change-ar',       label: 'Change in accounts receivable' },
  { id: 'change-tax',      label: 'Change in taxes payable' },
  { id: 'change-ap',       label: 'Change in accounts payable' },
  { id: 'change-accrued',  label: 'Change in accrued expenses' },
  { id: 'change-inventory',label: 'Change in inventories' },
  { id: 'change-other',    label: 'Change in other assets/liabilities' },
  { id: 'cf-investing',    label: 'Cash from investing activities' },
  { id: 'biz-acquisition', label: 'Purchase/sale of business (net)' },
  { id: 'sale-fixed',      label: 'Sale of fixed assets & businesses' },
  { id: 'biz-acq',         label: 'Purchase/acquisition of business' },
  { id: 'investments-net', label: 'Purchase/sale of investments (net)' },
  { id: 'sale-investments',label: 'Sale/maturity of investments' },
  { id: 'purchase-investments', label: 'Purchase of investments' },
  { id: 'capex',           label: 'Capital expenditures' },
  { id: 'capex-fixed',     label: 'Capital expenditures (fixed assets)' },
  { id: 'capex-other',     label: 'Capital expenditures (other assets)' },
  { id: 'other-investing', label: 'Other investing cash flow items (total)' },
  { id: 'cf-financing',    label: 'Cash from financing activities' },
  { id: 'stock-issuance',  label: 'Issuance/retirement of stock (net)' },
  { id: 'stock-sale',      label: 'Sale of common & preferred stock' },
  { id: 'stock-buyback',   label: 'Repurchase of common & preferred stock' },
  { id: 'debt-issuance',   label: 'Issuance/retirement of debt (net)' },
  { id: 'lt-debt-issuance',label: 'Issuance/retirement of long term debt' },
  { id: 'lt-debt-issue',   label: 'Issuance of long term debt' },
  { id: 'lt-debt-reduce',  label: 'Reduction of long term debt' },
  { id: 'st-debt-issuance',label: 'Issuance/retirement of short term debt' },
  { id: 'other-debt-issuance',label: 'Issuance/retirement of other debt' },
  { id: 'dividends-paid',  label: 'Total cash dividends paid' },
  { id: 'common-divs',     label: 'Common dividends paid' },
  { id: 'preferred-divs',  label: 'Preferred dividends paid' },
  { id: 'other-financing', label: 'Other financing cash flow items (total)' },
  { id: 'financing-sources',label: 'Financing activities (other sources)' },
  { id: 'financing-uses',  label: 'Financing activities (other uses)' },
  { id: 'fcf',             label: 'Free cash flow' },
];
const FUND_STATS = [
  { id: 'mcap',            label: 'Market capitalization' },
  { id: 'shares-out',      label: 'Total common shares outstanding' },
  { id: 'free-float',      label: 'Free float' },
  { id: 'employees',       label: 'Number of employees' },
  { id: 'div-per-share',   label: 'Dividends per share' },
  { id: 'div-yield',       label: 'Dividend yield %' },
  { id: 'div-yield-tv',    label: 'Dividend yield % (calculated by Onyx)' },
  { id: 'div-payout',      label: 'Dividend payout ratio %' },
  { id: 'pe',              label: 'Price to earnings ratio' },
  { id: 'ps',              label: 'Price to sales ratio' },
  { id: 'pcf',             label: 'Price to cash flow ratio' },
  { id: 'pb',              label: 'Price to book ratio' },
  { id: 'enterprise-value',label: 'Enterprise value' },
  { id: 'ev-ebitda',       label: 'Enterprise value to EBITDA ratio' },
  { id: 'ev-ebit',         label: 'Enterprise value to EBIT ratio' },
  { id: 'ev-rev',          label: 'Enterprise value to revenue ratio' },
  { id: 'pe-fwd',          label: 'Price earnings ratio forward' },
  { id: 'ps-fwd',          label: 'Price sales ratio forward' },
  { id: 'p-fcf',           label: 'Price to free cash flow ratio' },
  { id: 'p-tangible',      label: 'Price to tangible book ratio' },
  { id: 'peg',             label: 'Price/earnings to growth ratio' },
  { id: 'roa',             label: 'Return on assets %' },
  { id: 'roe',             label: 'Return on equity %' },
  { id: 'roce',            label: 'Return on common equity %' },
  { id: 'roic',            label: 'Return on invested capital %' },
  { id: 'gross-margin',    label: 'Gross margin %' },
  { id: 'operating-margin',label: 'Operating margin %' },
  { id: 'ebitda-margin',   label: 'EBITDA margin %' },
  { id: 'net-margin',      label: 'Net margin %' },
  { id: 'roe-book',        label: 'Return on equity adjusted to book value %' },
  { id: 'ro-tangible-assets',label: 'Return on tangible assets %' },
  { id: 'ro-tangible-equity',label: 'Return on tangible equity %' },
  { id: 'fcf-margin',      label: 'Free cash flow margin %' },
  { id: 'quick-ratio',     label: 'Quick ratio' },
  { id: 'current-ratio',   label: 'Current ratio' },
  { id: 'inventory-turnover',label: 'Inventory turnover' },
  { id: 'asset-turnover',  label: 'Asset turnover' },
  { id: 'debt-assets',     label: 'Debt to assets ratio' },
  { id: 'debt-equity',     label: 'Debt to equity ratio' },
  { id: 'lt-debt-assets',  label: 'Long term debt to total assets ratio' },
  { id: 'lt-debt-equity',  label: 'Long term debt to total equity ratio' },
  { id: 'debt-ebitda',     label: 'Debt to EBITDA ratio' },
  { id: 'net-debt-ebitda', label: 'Net debt to EBITDA ratio' },
  { id: 'debt-revenue',    label: 'Debt to revenue ratio' },
  { id: 'tangible-book',   label: 'Tangible book value per share' },
  { id: 'eff-int-rate',    label: 'Effective interest rate on debt %' },
  { id: 'equity-assets',   label: 'Equity to assets ratio' },
  { id: 'goodwill-assets', label: 'Goodwill to assets ratio' },
  { id: 'interest-cov',    label: 'Interest coverage' },
  { id: 'inventory-revenue',label: 'Inventory to revenue ratio' },
  { id: 'shares-buyback',  label: 'Shares buyback ratio %' },
  { id: 'sloan',           label: 'Sloan ratio %' },
  { id: 'eps-est',         label: 'EPS estimates' },
  { id: 'rev-est',         label: 'Revenue estimates' },
  { id: 'rev-1y-growth',   label: 'Revenue one year growth %' },
  { id: 'eps-basic-1y',    label: 'EPS basic one year growth %' },
  { id: 'eps-diluted-1y',  label: 'EPS diluted one year growth %' },
  { id: 'accruals',        label: 'Accruals' },
  { id: 'tangible-eq-ratio',label: 'Tangible common equity ratio' },
  { id: 'rev-employee',    label: 'Revenue per employee' },
  { id: 'ni-employee',     label: 'Net income per employee' },
  { id: 'fcf-employee',    label: 'Free cash flow per employee' },
  { id: 'ebitda-employee', label: 'EBITDA per employee' },
  { id: 'opincome-employee',label: 'Operating income per employee' },
  { id: 'debt-employee',   label: 'Total debt per employee' },
  { id: 'assets-employee', label: 'Total assets per employee' },
  { id: 'rd-employee',     label: 'Research & development per employee' },
  { id: 'grahams',         label: "Graham's number" },
  { id: 'quality-ratio',   label: 'Quality ratio' },
  { id: 'gp-assets',       label: 'Gross profit to assets ratio' },
  { id: 'buyback-yield',   label: 'Buyback yield %' },
  { id: 'cash-conversion', label: 'Cash conversion cycle' },
  { id: 'altman-z',        label: 'Altman Z-score' },
  { id: 'piotroski',       label: 'Piotroski F-score' },
  { id: 'sustainable-growth',label: 'Sustainable growth rate %' },
  { id: 'rd-revenue',      label: 'Research & development to revenue ratio' },
  { id: 'earnings-yield',  label: 'Earnings yield %' },
  { id: 'op-earnings-yield',label: 'Operating earnings yield %' },
  { id: 'tobins-q',        label: "Tobin's Q (approximate)" },
  { id: 'beneish',         label: 'Beneish M-score' },
  { id: 'kz-index',        label: 'KZ index' },
  { id: 'fulmer',          label: 'Fulmer H factor' },
  { id: 'springate',       label: 'Springate score' },
  { id: 'zmijewski',       label: 'Zmijewski score' },
  { id: 'cash-debt',       label: 'Cash to debt ratio' },
  { id: 'cogs-revenue',    label: 'COGS to revenue ratio' },
  { id: 'days-inventory',  label: 'Days inventory' },
  { id: 'days-payable',    label: 'Days payable' },
  { id: 'days-sales',      label: 'Days sales outstanding' },
];

// fmtUsd + fmtPct (inlined per established pattern).
const fmtUsd = (n, d = 2) => {
  if (n == null || !isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${sign}$${(abs/1e12).toFixed(d)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs/1e9).toFixed(d)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs/1e6).toFixed(d)}M`;
  if (abs >= 1e3)  return `${sign}$${(abs/1e3).toFixed(d)}K`;
  return `${sign}$${abs.toFixed(d)}`;
};
const fmtPct = (n, d = 2) => `${(n * 100).toFixed(d)}%`;

export const FundamentalsModal = ({ instrument, onClose }) => {
  const [tab, setTab] = useState('income'); // income / balance / cashflow / stats
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('imo_fundamentals_favorites') ?? '[]'); }
    catch { return []; }
  });
  const persistFav = (next) => {
    setFavorites(next);
    try { localStorage.setItem('imo_fundamentals_favorites', JSON.stringify(next)); } catch {}
  };
  const toggleFav = (id) => {
    const has = favorites.includes(id);
    persistFav(has ? favorites.filter(x => x !== id) : [...favorites, id]);
  };

  // Fetch real Polygon financials in the background so we can replace
  // synthesized values with real ones for core metrics (revenue, gross
  // profit, net income, EPS, etc.). When the fetch fails or doesn't cover
  // a metric, we fall back to the seeded synthesizer below.
  const [livefin, setLivefin] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (instrument?.cls !== 'equity' || !instrument?.id) return;
      const fin = await fetchPolygonFinancials(instrument.id);
      if (!cancelled) setLivefin(fin);
    })();
    return () => { cancelled = true; };
  }, [instrument?.id, instrument?.cls]);

  // Map of metric ids → real values pulled from Polygon. When a key
  // exists in this map we render the live value (with a small "LIVE"
  // badge); otherwise we fall through to the synthesized one.
  const liveValues = useMemo(() => {
    if (!livefin || livefin.length === 0) return {};
    const latest = livefin[0];
    const fmtBig = (n) => {
      if (n == null) return null;
      const abs = Math.abs(n);
      if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
      if (abs >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
      if (abs >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
      return `$${n.toFixed(2)}`;
    };
    const grossMargin = latest.revenue && latest.grossProfit
      ? `${((latest.grossProfit / latest.revenue) * 100).toFixed(2)}%` : null;
    const netMargin = latest.revenue && latest.netIncome
      ? `${((latest.netIncome / latest.revenue) * 100).toFixed(2)}%` : null;
    const opMargin = latest.revenue && latest.operatingIncome
      ? `${((latest.operatingIncome / latest.revenue) * 100).toFixed(2)}%` : null;
    return {
      'revenue':         fmtBig(latest.revenue),
      'cost-of-revenue': fmtBig(latest.costOfRevenue),
      'gross-profit':    fmtBig(latest.grossProfit),
      'gross-margin':    grossMargin,
      'operating-income': fmtBig(latest.operatingIncome),
      'operating-margin': opMargin,
      'net-income':      fmtBig(latest.netIncome),
      'net-margin':      netMargin,
      'eps':             latest.eps != null ? `$${latest.eps.toFixed(2)}` : null,
      'eps-diluted':     latest.epsDiluted != null ? `$${latest.epsDiluted.toFixed(2)}` : null,
      'total-assets':    fmtBig(latest.totalAssets),
      'total-liabilities': fmtBig(latest.totalLiabilities),
      'total-equity':    fmtBig(latest.totalEquity),
      'cash-equivalents': fmtBig(latest.cashAndEquivalents),
      'op-cash-flow':    fmtBig(latest.opCashFlow),
      'inv-cash-flow':   fmtBig(latest.invCashFlow),
      'fin-cash-flow':   fmtBig(latest.finCashFlow),
    };
  }, [livefin]);

  // Per-ticker seeded value generator for each metric — gives stable
  // pseudo-realistic values that update only when the ticker changes.
  const synthesize = useMemo(() => {
    const seed = (instrument?.id || 'X').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const rng = (i) => {
      const x = Math.sin((seed + i * 13.37) * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    const fmtUsd = (v, magnitude = 1) => {
      const n = v * magnitude;
      if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
      if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
      if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
      return `$${n.toFixed(2)}`;
    };
    const fmtPct = (v) => `${v.toFixed(2)}%`;
    const fmtNum = (v, dec = 2) => v.toFixed(dec);
    return (id, idx) => {
      const r = rng(idx);
      // Map id → reasonable formatter
      if (id.includes('margin') || id.includes('yield') || id.includes('growth') ||
          id.includes('roa') || id.includes('roe') || id.includes('roic') || id.includes('roce') ||
          id.includes('-rate') || id === 'ebitda-margin' || id === 'gross-margin' ||
          id === 'net-margin' || id === 'fcf-margin') {
        return fmtPct(-2 + r * 50);
      }
      if (id.startsWith('p') && (id === 'pe' || id === 'pb' || id === 'ps' || id === 'pcf' ||
          id === 'pe-fwd' || id === 'ps-fwd' || id === 'p-fcf' || id === 'p-tangible' || id === 'peg')) {
        return fmtNum(2 + r * 60, 2);
      }
      if (id === 'eps-basic' || id === 'eps-diluted' || id === 'div-per-share') {
        return `$${(0.5 + r * 12).toFixed(2)}`;
      }
      if (id === 'shares-out' || id === 'shares-basic' || id === 'shares-diluted' || id === 'free-float') {
        return `${(50 + r * 4500).toFixed(1)}M`;
      }
      if (id === 'employees') {
        return Math.round(500 + r * 250000).toLocaleString();
      }
      if (id.endsWith('-employee')) {
        return fmtUsd(80 + r * 800, 1000);
      }
      if (id === 'altman-z' || id === 'piotroski' || id === 'beneish' || id === 'fulmer' ||
          id === 'springate' || id === 'zmijewski' || id === 'kz-index' || id === 'tobins-q') {
        return fmtNum(-3 + r * 8, 2);
      }
      if (id === 'days-inventory' || id === 'days-payable' || id === 'days-sales' || id === 'cash-conversion') {
        return `${Math.round(10 + r * 110)} days`;
      }
      if (id === 'quick-ratio' || id === 'current-ratio' || id === 'debt-equity' ||
          id === 'debt-assets' || id === 'asset-turnover' || id === 'inventory-turnover' ||
          id.includes('ratio')) {
        return fmtNum(0.2 + r * 4, 2);
      }
      if (id === 'interest-cov') {
        return `${(2 + r * 30).toFixed(1)}×`;
      }
      // Default: USD billions for big-line items, USD millions for smaller
      if (id === 'mcap' || id === 'enterprise-value' || id === 'total-assets' ||
          id === 'revenue' || id === 'fcf' || id === 'ebitda' || id === 'ebit' ||
          id === 'net-income' || id === 'gross-profit') {
        return fmtUsd(1 + r * 800, 1e9);
      }
      return fmtUsd(-50 + r * 500, 1e6);
    };
  }, [instrument?.id]);

  const all = { income: FUND_INCOME, balance: FUND_BALANCE, cashflow: FUND_CASHFLOW, stats: FUND_STATS };
  // Programmatic sub-categorization. For Statistics tab we split by valuation
  // / profitability / growth / dividends / efficiency. For income/balance/
  // cashflow we just split by sub-section keyword (revenue/expense/etc).
  const fundSubcategory = (item, tabId) => {
    const n = ((item.label ?? '') + ' ' + (item.id ?? '')).toLowerCase();
    if (tabId === 'stats') {
      if (/\b(p\/?e|pe ratio|p\/?b|p\/?s|p\/?ev|enterprise|ev\/|peg|price.{0,3}book|price.{0,3}sales|valuation|fair value|undervalued|overvalued)/i.test(n)) return 'Valuation';
      if (/(margin|return on|roe|roa|roic|profit|gross|operating|ebitda|net income)/i.test(n)) return 'Profitability';
      if (/(growth|cagr|yoy|increase|expansion|revenue.{0,4}growth|earnings.{0,4}growth)/i.test(n)) return 'Growth';
      if (/(dividend|yield|payout|distribution|buyback)/i.test(n)) return 'Dividends';
      if (/(turnover|efficiency|asset.{0,3}turnover|inventory|receivables|days)/i.test(n)) return 'Efficiency';
      if (/(debt|leverage|coverage|interest|liability|equity ratio|capital structure|liquidity|current ratio|quick)/i.test(n)) return 'Leverage';
      return 'Other';
    }
    if (tabId === 'income') {
      if (/(revenue|sales|top.{0,3}line)/i.test(n)) return 'Revenue';
      if (/(cost|expense|operating expense|sg&a|r&d|cogs)/i.test(n)) return 'Costs';
      if (/(profit|income|earnings|eps|gross|operating)/i.test(n)) return 'Profit';
      if (/(tax|provision)/i.test(n)) return 'Taxes';
      return 'Other';
    }
    if (tabId === 'balance') {
      if (/(asset|inventory|receivable|cash|investment)/i.test(n)) return 'Assets';
      if (/(liabilit|debt|payable|accrued)/i.test(n)) return 'Liabilities';
      if (/(equity|stock|retained|share)/i.test(n)) return 'Equity';
      return 'Other';
    }
    if (tabId === 'cashflow') {
      if (/(operating|operations)/i.test(n)) return 'Operating';
      if (/(invest|capex|acquisition)/i.test(n)) return 'Investing';
      if (/(financ|dividend|debt issu|repay|buyback)/i.test(n)) return 'Financing';
      return 'Other';
    }
    return 'All';
  };
  const fundSubcats = useMemo(() => {
    const set = new Set(['All']);
    (all[tab] ?? []).forEach(it => set.add(fundSubcategory(it, tab)));
    return Array.from(set);
  }, [tab, all]);
  const [fundSubCat, setFundSubCat] = useState('All');
  useEffect(() => { setFundSubCat('All'); }, [tab]);
  const list = (all[tab] ?? [])
    .filter(it => !query.trim() || it.label.toLowerCase().includes(query.toLowerCase()))
    .filter(it => fundSubCat === 'All' || fundSubcategory(it, tab) === fundSubCat);

  if (instrument?.cls !== 'equity') {
    return (
      <>
        <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose} />
        <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[400px] rounded-md border p-6 text-center"
             style={{ background: COLORS.surface, borderColor: COLORS.borderHi }}>
          <div className="text-[14px]" style={{ color: COLORS.text }}>Fundamentals are only available for equity instruments.</div>
          <button onClick={onClose}
                  className="mt-4 px-4 py-2 rounded text-[12px]"
                  style={{ background: COLORS.mint, color: COLORS.bg }}>Close</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-md border overflow-hidden flex flex-col"
           style={{ background: COLORS.surface, borderColor: COLORS.borderHi, width: 640, maxWidth: '95vw', height: '85vh' }}>
        {/* Header */}
        <div className="flex items-center px-4 py-3 border-b shrink-0"
             style={{ borderColor: COLORS.border }}>
          <button onClick={onClose} className="text-[18px] mr-2" style={{ color: COLORS.textDim }}>‹</button>
          <div className="flex-1">
            <h2 className="text-[15px] font-medium" style={{ color: COLORS.text }}>Fundamentals</h2>
            <div className="text-[10.5px]" style={{ color: COLORS.textMute }}>
              {instrument?.id} · {instrument?.name}
            </div>
          </div>
          <button onClick={onClose} className="text-[18px]" style={{ color: COLORS.textDim }}>×</button>
        </div>
        {/* Search */}
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: COLORS.textMute }} />
            <input value={query} onChange={e => setQuery(e.target.value)}
                   placeholder="Search"
                   className="w-full pl-9 pr-3 py-2 rounded-md outline-none text-[12.5px]"
                   style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
          </div>
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-2 px-4 pb-3 shrink-0 overflow-x-auto">
          {[
            { id: 'income',   label: 'Income statement' },
            { id: 'balance',  label: 'Balance sheet' },
            { id: 'cashflow', label: 'Cash flow' },
            { id: 'stats',    label: 'Statistics' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
                    className="px-3 py-1 rounded-full text-[11.5px] font-medium transition-colors shrink-0"
                    style={{
                      background: tab === t.id ? '#FFFFFF' : 'transparent',
                      color: tab === t.id ? '#000000' : COLORS.textDim,
                      border: tab === t.id ? '1px solid #FFFFFF' : `1px solid ${COLORS.border}`,
                    }}>{t.label}</button>
          ))}
        </div>
        {/* Sub-category chips per main tab */}
        {fundSubcats.length > 1 && (
          <div className="flex items-center gap-1 px-4 pb-3 shrink-0 overflow-x-auto">
            {fundSubcats.map(c => (
              <button key={c} onClick={() => setFundSubCat(c)}
                      className="px-2.5 py-0.5 rounded-full text-[10.5px] transition-colors shrink-0"
                      style={{
                        background: fundSubCat === c ? COLORS.mint : COLORS.bg,
                        color: fundSubCat === c ? '#FFFFFF' : COLORS.textDim,
                        border: fundSubCat === c ? `1px solid ${COLORS.mint}` : `1px solid ${COLORS.border}`,
                      }}>
                {c}
              </button>
            ))}
          </div>
        )}
        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {list.length === 0 ? (
            <div className="text-center py-12 text-[12px]" style={{ color: COLORS.textMute }}>No matches</div>
          ) : list.map((it, idx) => (
            <div key={it.id}
                 className="flex items-center gap-3 px-4 py-2.5 border-b hover:bg-white/[0.02]"
                 style={{ borderColor: COLORS.border }}>
              <button onClick={() => toggleFav(it.id)}
                      className="text-[16px] transition-transform"
                      title={favorites.includes(it.id) ? 'Remove from favorites' : 'Add to favorites'}>
                {favorites.includes(it.id) ? '⭐' : '☆'}
              </button>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {it.label.startsWith('  ') || it.id.includes('change-') || it.id.includes('issuance')
                 || it.id.includes('-paid') || it.id.includes('debt-issuance') ? (
                  <span style={{ color: COLORS.textMute, fontSize: 10 }}>•</span>
                ) : null}
                <span className="text-[12.5px]" style={{ color: COLORS.text }}>{it.label}</span>
              </div>
              <span className="text-[11.5px] tabular-nums shrink-0 flex items-center gap-1" style={{ color: COLORS.textDim }}>
                {liveValues[it.id] ?? synthesize(it.id, idx)}
                {liveValues[it.id] && (
                  <span className="inline-flex items-center" title="Live data from Polygon /vX/reference/financials">
          <span className="rounded-full" style={{ width: 6, height: 6, background: COLORS.green, display: 'inline-block' }} />
        </span>
                )}
              </span>
              {/* Plot button — adds this metric to a persistent list of
                  fundamentals charts. The trade page reads from
                  imo_fundamentals_charts and renders an addable
                  fundamentals chart widget showing all plotted metrics. */}
              <button title="Plot on a fundamentals chart"
                      onClick={() => {
                        try {
                          const key = 'imo_fundamentals_charts';
                          const cur = JSON.parse(localStorage.getItem(key) ?? '[]');
                          if (cur.includes(it.id)) {
                            const next = cur.filter(x => x !== it.id);
                            localStorage.setItem(key, JSON.stringify(next));
                            window.imoToast?.(`Removed "${it.label}" from fundamentals chart`, 'info');
                          } else {
                            const next = [...cur, it.id];
                            localStorage.setItem(key, JSON.stringify(next));
                            window.imoToast?.(`Added "${it.label}" to fundamentals chart — open the Fundamentals widget on the Trade page`, 'success');
                          }
                        } catch {}
                      }}
                      className="px-2 py-0.5 rounded text-[10px] hover:bg-white/[0.08] transition-colors"
                      style={{ background: COLORS.bg, color: COLORS.mint, border: `1px solid ${COLORS.border}` }}>
                Plot
              </button>
              <button title="Help"
                      onClick={() => {
                        window.imoToast?.(`${it.label} — ID: ${it.id}. Value is seeded per ticker; use the ★ to favorite.`, 'info');
                      }}
                      className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center hover:bg-white/[0.08] transition-colors"
                      style={{ background: COLORS.bg, color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                ?
              </button>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t text-[10px] text-center shrink-0"
             style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
          {list.length} metric{list.length === 1 ? '' : 's'} · ⭐ favorited {favorites.length} · values are seeded per ticker
        </div>
      </div>
    </>
  );
};
