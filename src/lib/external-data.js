// @ts-check
// IMO Onyx Terminal — external data sources
//
// Phase 3p.17 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~1025-1907 in the monolith).
//
// All external API integrations: SEC filings, Treasury rates,
// EconDB macro series, OpenFIGI symbology, news (MediaStack,
// NewsData, Currents, NYT), FX (ExchangeRate-API, Coinlayer),
// weather/air quality (Weatherstack, IQAir), Alpaca corporate
// actions, WSB Reddit sentiment (tradestie), and portfolio
// optimization. Plus the symbol maps (Coinbase, EIA, Massive
// tickers) used to translate Onyx instrument IDs → vendor symbols.
//
// API keys are read from VITE_* env vars at module-load time, the
// same way the rest of the app does it. Each integration falls back
// to mock data or null when its key is missing — the app degrades
// gracefully to simulation without keys.
//
// Cache helpers (cacheGet/cacheSet) come from ../api-cache.js so the
// monolith and this module share one process-wide cache instance.
//
// Honest scope:
//   - These functions are duplicated env reads compared to the
//     monolith's own copies (MASSIVE_API_KEY etc.). Each module
//     reads VITE_* fresh, so there's no live-update if the key
//     changes — but env vars don't change at runtime anyway.
//   - We keep symbol maps and SEC_USER_AGENT exported because some
//     are used outside this module (instrument resolution, e.g.).

import { cacheGet, cacheSet } from './api-cache.js';

export const COINBASE_SYMBOL_MAP = {
  'BTC-PERP': 'BTC-USD',
  'ETH-PERP': 'ETH-USD',
  'SOL-PERP': 'SOL-USD',
};

// Map Onyx instrument IDs → EIA series IDs (real settlement prices, daily)
export const EIA_SERIES_MAP = {
  'WTI-F26':   'PET.RWTC.D',
  'BRENT-F26': 'PET.RBRTE.D',
  'NG-G26':    'NG.RNGWHHD.D',
  'HO-F26':    'PET.EER_EPD2F_PF4_Y35NY_DPG.D',
};

// Equity instruments: massive.com uses the ticker directly as the symbol
export const MASSIVE_TICKERS = new Set([
  // Mega-cap tech
  'AAPL', 'MSFT', 'NVDA', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO',
  // Financials
  'JPM', 'BAC', 'GS', 'V',
  // Consumer
  'WMT', 'COST', 'DIS',
  // Healthcare
  'UNH', 'LLY', 'JNJ',
  // Indices / ETFs
  'SPY', 'QQQ', 'DIA', 'IWM', 'VTI',
]);

// API keys — read from Vite env vars set via Vercel or .env.local. Each is
// optional; the app degrades gracefully to simulation if a key is missing.
const EIA_API_KEY     = (() => { try { return import.meta.env?.VITE_EIA_API_KEY     ?? ''; } catch { return ''; } })();
const MASSIVE_API_KEY = (() => { try { return import.meta.env?.VITE_MASSIVE_API_KEY ?? ''; } catch { return ''; } })();
const ANTHROPIC_API_KEY = (() => { try { return import.meta.env?.VITE_ANTHROPIC_API_KEY ?? ''; } catch { return ''; } })();
const OPENAI_API_KEY    = (() => { try { return import.meta.env?.VITE_OPENAI_API_KEY    ?? ''; } catch { return ''; } })();
// Exa — web search and content extraction. Used for live news in the feed,
// company research enrichment, and AI tool-use grounding.
const EXA_API_KEY       = (() => { try { return import.meta.env?.VITE_EXA_API_KEY       ?? ''; } catch { return ''; } })();

/* ════════════════════════════════════════════════════════════════════════════
   THIRD-PARTY API INTEGRATIONS
   ────────────────────────────────────────────────────────────────────────────
   Each integration below either:
     a) needs no API key (free public endpoints, just a User-Agent header)
     b) reads its key from a VITE_* env var and falls back to mock data
   Integrations marked SKIPPED were evaluated but didn't fit the app's scope
   (auth providers, ticket vendors, payment processors, paid-only services
   that overlap existing free sources).
   ════════════════════════════════════════════════════════════════════════════ */

// ─── Optional API keys — set in Vercel / .env.local for live data ───
const MEDIASTACK_KEY      = (() => { try { return import.meta.env?.VITE_MEDIASTACK_KEY      ?? ''; } catch { return ''; } })();
const NEWSDATA_KEY        = (() => { try { return import.meta.env?.VITE_NEWSDATA_KEY        ?? ''; } catch { return ''; } })();
export const CURRENTS_KEY        = (() => { try { return import.meta.env?.VITE_CURRENTS_KEY        ?? ''; } catch { return ''; } })();
const NYT_KEY             = (() => { try { return import.meta.env?.VITE_NYT_KEY             ?? ''; } catch { return ''; } })();
export const EXCHANGERATE_KEY    = (() => { try { return import.meta.env?.VITE_EXCHANGERATE_KEY    ?? ''; } catch { return ''; } })();
const WEATHERSTACK_KEY    = (() => { try { return import.meta.env?.VITE_WEATHERSTACK_KEY    ?? ''; } catch { return ''; } })();
const IQAIR_KEY           = (() => { try { return import.meta.env?.VITE_IQAIR_KEY           ?? ''; } catch { return ''; } })();
export const COINLAYER_KEY       = (() => { try { return import.meta.env?.VITE_COINLAYER_KEY       ?? ''; } catch { return ''; } })();
const PORTFOLIO_OPT_KEY   = (() => { try { return import.meta.env?.VITE_PORTFOLIO_OPT_KEY   ?? ''; } catch { return ''; } })();
const ALPACA_KEY          = (() => { try { return import.meta.env?.VITE_ALPACA_KEY          ?? ''; } catch { return ''; } })();
const ALPACA_SECRET       = (() => { try { return import.meta.env?.VITE_ALPACA_SECRET       ?? ''; } catch { return ''; } })();

// SEC EDGAR requires a polite User-Agent string identifying the app + email
// per their fair-use policy: https://www.sec.gov/os/accessing-edgar-data
export const SEC_USER_AGENT = 'IMO Onyx Terminal info@imo-onyx.example';

// Generic in-memory TTL cache so we don't hammer free-tier endpoints

// ──────── 1. Tradestie WSB Reddit sentiment (NO KEY required) ────────
// Returns the top tickers being discussed on r/wallstreetbets with bullish/
// bearish sentiment scores. Updated daily.
export const fetchWSBTickers = async () => {
  const cached = cacheGet('wsb', 30 * 60_000);
  if (cached) return cached;
  // Synthetic fallback — when tradestie isn't reachable (CORS, rate limit,
  // outage), return a believable WSB-style ranking so the widget always
  // renders. Uses the most-mentioned WSB tickers historically with a
  // jittered comment count so each fresh load looks alive.
  const synthFallback = () => {
    const universe = [
      'TSLA', 'GME', 'AMC', 'NVDA', 'AAPL', 'PLTR', 'AMD', 'SOFI',
      'NIO', 'RIVN', 'COIN', 'HOOD', 'SPY', 'QQQ', 'META', 'GOOG',
    ];
    const seed = Math.floor(Date.now() / (60 * 60_000)); // changes hourly
    return universe.map((ticker, i) => {
      const r = ((Math.sin((seed + i) * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const score = (r - 0.5) * 1.8;
      const sentiment = score > 0.2 ? 'Bullish' : score < -0.2 ? 'Bearish' : 'Neutral';
      const comments = Math.floor(40 + r * 480);
      return { ticker, comments, sentiment, score };
    }).sort((a, b) => b.comments - a.comments);
  };
  try {
    const r = await fetch('https://tradestie.com/api/v1/apps/reddit');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const out = (Array.isArray(j) ? j : []).slice(0, 25).map(x => ({
      ticker: x.ticker,
      comments: x.no_of_comments ?? 0,
      sentiment: x.sentiment ?? 'Neutral',
      score: typeof x.sentiment_score === 'number' ? x.sentiment_score : 0,
    }));
    if (out.length === 0) {
      // Empty response — fall through to synth (don't cache it though,
      // so we retry next time).
      return synthFallback();
    }
    cacheSet('wsb', out);
    return out;
  } catch (e) {
    console.warn('[WSB]', /** @type {Error} */ (e).message);
    return synthFallback();
  }
};

// ──────── 2. SEC EDGAR filings (NO KEY, User-Agent only) ────────
// Recent filings for a ticker via the company-tickers + submissions endpoints.
export const fetchSecFilings = async (ticker) => {
  if (!ticker) return [];
  const cached = cacheGet(`sec:${ticker}`, 60 * 60_000);
  if (cached) return cached;
  try {
    // Step 1: lookup CIK from company_tickers.json (cached)
    let tickerMap = cacheGet('sec:tickerMap', 24 * 60 * 60_000);
    if (!tickerMap) {
      const r1 = await fetch('https://www.sec.gov/files/company_tickers.json', {
        headers: { 'User-Agent': SEC_USER_AGENT },
      });
      const j1 = await r1.json();
      tickerMap = {};
      Object.values(j1).forEach(x => { tickerMap[x.ticker] = String(x.cik_str).padStart(10, '0'); });
      cacheSet('sec:tickerMap', tickerMap);
    }
    const cik = tickerMap[ticker.toUpperCase()];
    if (!cik) return [];
    // Step 2: fetch submissions
    const r2 = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { 'User-Agent': SEC_USER_AGENT },
    });
    const j2 = await r2.json();
    const recent = j2?.filings?.recent;
    if (!recent) return [];
    const out = [];
    for (let i = 0; i < Math.min(10, recent.form?.length ?? 0); i++) {
      out.push({
        form: recent.form[i],
        date: recent.filingDate[i],
        accession: recent.accessionNumber[i],
        primaryDoc: recent.primaryDocument[i],
        description: recent.primaryDocDescription[i] ?? '',
        url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${recent.accessionNumber[i].replace(/-/g, '')}/${recent.primaryDocument[i]}`,
      });
    }
    cacheSet(`sec:${ticker}`, out);
    return out;
  } catch (e) {
    console.warn('[SEC]', /** @type {Error} */ (e).message);
    return [];
  }
};

// fetchSecFilingsByCIK — fetch the SEC submissions feed for a given CIK
// (used for institutional investors / insiders where the CIK is known
// directly rather than looked up from a ticker). Same shape as
// fetchSecFilings but skips the ticker → CIK step.
//
// `cik` is the 10-digit zero-padded CIK string (e.g. "0001067983" for
// Berkshire Hathaway). `formFilter` optionally filters to a specific
// form type (e.g. "13F-HR", "4").
export const fetchSecFilingsByCIK = async (cik, formFilter = null, maxResults = 20) => {
  if (!cik) return [];
  const padded = String(cik).padStart(10, '0');
  const cacheKey = `sec-cik:${padded}:${formFilter || 'all'}`;
  const cached = cacheGet(cacheKey, 60 * 60_000);
  if (cached) return cached;
  try {
    const r = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
      headers: { 'User-Agent': SEC_USER_AGENT },
    });
    if (!r.ok) return [];
    const j = await r.json();
    const recent = j?.filings?.recent;
    if (!recent || !recent.form) return [];
    const out = [];
    for (let i = 0; i < recent.form.length && out.length < maxResults; i++) {
      if (formFilter && recent.form[i] !== formFilter) continue;
      out.push({
        form: recent.form[i],
        date: recent.filingDate[i],
        accession: recent.accessionNumber[i],
        primaryDoc: recent.primaryDocument[i],
        description: recent.primaryDocDescription[i] ?? '',
        url: `https://www.sec.gov/Archives/edgar/data/${parseInt(padded, 10)}/${recent.accessionNumber[i].replace(/-/g, '')}/${recent.primaryDocument[i]}`,
        // Index URL — useful for linking to the filing detail page rather than the primary doc directly
        indexUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padded}&type=${recent.form[i]}&dateb=&owner=include&count=40`,
      });
    }
    cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    console.warn('[SEC by CIK]', /** @type {Error} */ (e).message);
    return [];
  }
};

// parseSecForm4 — fetch and parse a Form 4 filing's XML to extract
// the actual transaction data (insider name, share count, price,
// transaction code). Form 4 XML is well-structured but verbose.
//
// Returns: { issuer, insiderName, insiderRole, transactions: [...] }
// Each transaction: { date, code, shares, price, acquired, value }
//   code: 'P' = open-market purchase, 'S' = open-market sale,
//         'A' = grant/award, 'M' = option exercise, 'F' = tax withholding
//   acquired: 'A' (acquired) | 'D' (disposed)
export const parseSecForm4 = async (filingUrl) => {
  if (!filingUrl) return null;
  const cacheKey = `sec-form4:${filingUrl}`;
  const cached = cacheGet(cacheKey, 24 * 60 * 60_000);
  if (cached) return cached;
  try {
    const r = await fetch(filingUrl, {
      headers: { 'User-Agent': SEC_USER_AGENT },
    });
    if (!r.ok) return null;
    const xml = await r.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    // Helper: get text of first matching tag
    const tx = (parent, tag) => {
      const el = parent?.getElementsByTagName?.(tag)?.[0];
      return el ? el.textContent.trim() : null;
    };
    const txValue = (parent, tag) => {
      const el = parent?.getElementsByTagName?.(tag)?.[0];
      const valueEl = el?.getElementsByTagName?.('value')?.[0];
      return valueEl ? valueEl.textContent.trim() : tx(parent, tag);
    };
    const issuer = doc.getElementsByTagName('issuer')[0];
    const owner = doc.getElementsByTagName('reportingOwner')[0];
    const ownerRel = owner?.getElementsByTagName('reportingOwnerRelationship')[0];
    const issuerName = tx(issuer, 'issuerName');
    const issuerSymbol = tx(issuer, 'issuerTradingSymbol');
    const insiderName = tx(owner, 'rptOwnerName');
    const officerTitle = tx(ownerRel, 'officerTitle');
    const isOfficer = tx(ownerRel, 'isOfficer') === '1';
    const isDirector = tx(ownerRel, 'isDirector') === '1';
    const is10pct = tx(ownerRel, 'isTenPercentOwner') === '1';
    const insiderRole = officerTitle
      || (is10pct ? '10%+ Owner' : (isDirector ? 'Director' : (isOfficer ? 'Officer' : '')));
    // Parse non-derivative transactions (the common "buy/sell stock" case)
    const transactions = [];
    const ndTable = doc.getElementsByTagName('nonDerivativeTable')[0];
    if (ndTable) {
      const txs = ndTable.getElementsByTagName('nonDerivativeTransaction');
      for (let i = 0; i < txs.length; i++) {
        const t = txs[i];
        const date = txValue(t, 'transactionDate');
        const codingEl = t.getElementsByTagName('transactionCoding')[0];
        const code = tx(codingEl, 'transactionCode');
        const amountsEl = t.getElementsByTagName('transactionAmounts')[0];
        const shares = parseFloat(txValue(amountsEl, 'transactionShares')) || 0;
        const price = parseFloat(txValue(amountsEl, 'transactionPricePerShare')) || 0;
        const acquired = txValue(amountsEl, 'transactionAcquiredDisposedCode'); // 'A' or 'D'
        if (shares > 0) {
          transactions.push({
            date,
            code,
            shares,
            price,
            acquired,
            value: shares * price,
            // Map common codes to user-friendly type
            type: acquired === 'A' && (code === 'P') ? 'buy'
                : acquired === 'D' && (code === 'S') ? 'sell'
                : acquired === 'A' ? 'acquire'
                : acquired === 'D' ? 'dispose'
                :                    'other',
          });
        }
      }
    }
    // Parse derivative table — RSU vests, option grants, option exercises.
    // These are typically routine compensation events but useful for
    // estimating insider's economic exposure (post-vest holdings).
    //
    // Derivative transactions have additional fields:
    //   - underlyingSecurity (the stock the derivative converts to)
    //   - underlyingSecurityShares (how many shares it represents)
    //   - exerciseDate / expirationDate
    //   - conversionOrExercisePrice (strike for options; 0 for RSUs)
    const derivatives = [];
    const dTable = doc.getElementsByTagName('derivativeTable')[0];
    if (dTable) {
      const dtxs = dTable.getElementsByTagName('derivativeTransaction');
      for (let i = 0; i < dtxs.length; i++) {
        const t = dtxs[i];
        const date = txValue(t, 'transactionDate');
        const codingEl = t.getElementsByTagName('transactionCoding')[0];
        const code = tx(codingEl, 'transactionCode');
        const amountsEl = t.getElementsByTagName('transactionAmounts')[0];
        const shares = parseFloat(txValue(amountsEl, 'transactionShares')) || 0;
        const acquired = txValue(amountsEl, 'transactionAcquiredDisposedCode'); // 'A' or 'D'
        const securityTitle = txValue(t, 'securityTitle');
        const conversionPrice = parseFloat(txValue(t, 'conversionOrExercisePrice')) || 0;
        const exerciseDate = txValue(t, 'exerciseDate');
        const expirationDate = txValue(t, 'expirationDate');
        // Underlying security
        const underlyingEl = t.getElementsByTagName('underlyingSecurity')[0];
        const underlyingTitle = txValue(underlyingEl, 'underlyingSecurityTitle');
        const underlyingShares = parseFloat(txValue(underlyingEl, 'underlyingSecurityShares')) || 0;
        if (shares > 0 || underlyingShares > 0) {
          // Classify: RSU/PSU vs option vs other derivative
          const isRSU = (securityTitle || '').match(/restricted stock unit|rsu|psu|performance/i);
          const isOption = (securityTitle || '').match(/option|stock appreciation/i);
          // Typical Form 4 derivative codes:
          //   A = grant/award (typical for RSU + option grants)
          //   M = exercise of derivative (typical for option exercise)
          //   F = payment of exercise price / tax
          //   J = other transaction (vest is sometimes recorded here)
          //   D = disposition of derivative
          const derivType = code === 'A' && isRSU ? 'rsu-grant'
                          : code === 'A' && isOption ? 'option-grant'
                          : code === 'M' ? 'option-exercise'
                          : code === 'F' ? 'tax-withhold'
                          : code === 'J' && isRSU ? 'rsu-vest'
                          : isRSU ? 'rsu-other'
                          : isOption ? 'option-other'
                          :            'derivative-other';
          derivatives.push({
            date,
            code,
            type: derivType,
            securityTitle,
            shares: shares || underlyingShares,
            conversionPrice,
            exerciseDate,
            expirationDate,
            underlyingTitle,
            underlyingShares,
            acquired,
            // Estimated value for grants/vests: underlying shares × strike or 0 for RSUs
            // Real economic value would need current market price (which we don't fetch here)
            value: 0,
          });
        }
      }
    }
    const out = {
      issuerName, issuerSymbol, insiderName, insiderRole,
      isOfficer, isDirector, is10pct,
      transactions,
      derivatives,
    };
    cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    console.warn('[parseSecForm4]', /** @type {Error} */ (e).message);
    return null;
  }
};

// parseSec13F — fetch and parse a 13F-HR filing's information table
// to extract institutional holdings positions. The table is in a
// separate XML file (infotable.xml) referenced from the primary
// 13F-HR cover document.
//
// 13F-HR filings have two parts:
//   - Cover page (primaryDoc) with manager info + summary
//   - Information table (infotable.xml) with the actual positions
//
// Each holding row contains:
//   - nameOfIssuer     Issuer company name
//   - cusip            CUSIP identifier (9-char alphanumeric)
//   - titleOfClass     "COM" / "CL A" / "CALL" / "PUT" etc
//   - value            Market value at filing date (× $1000)
//   - sshPrnamt        Number of shares
//   - sshPrnamtType    "SH" (shares) or "PRN" (principal/face)
//   - putCall          Optional "Put" or "Call" for option positions
//   - investmentDiscretion
//   - votingAuthority  Sole / Shared / None counts
//
// Returns { holdings: [...], total: { value, positions } } or null.
export const parseSec13F = async (filing) => {
  if (!filing || !filing.url) return null;
  const cacheKey = `sec-13f:${filing.url}`;
  const cached = cacheGet(cacheKey, 24 * 60 * 60_000);
  if (cached) return cached;
  try {
    // Step 1: derive accession number directory URL
    // Filing primary URL looks like:
    //   https://www.sec.gov/Archives/edgar/data/{CIK}/{accession-no-dashes}/{primary-doc}.html
    // The information table lives in the same directory as infotable.xml.
    const m = filing.url.match(/\/Archives\/edgar\/data\/(\d+)\/(\d+)\/[^\/]+$/);
    if (!m) return null;
    const cikNum = m[1];
    const accNoDashes = m[2];
    const dirUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/`;
    // Step 2: fetch the directory index and find the .xml info table
    let infoTableUrl = null;
    try {
      const indexUrl = `${dirUrl}index.json`;
      const r = await fetch(indexUrl, { headers: { 'User-Agent': SEC_USER_AGENT } });
      if (r.ok) {
        const j = await r.json();
        const items = j?.directory?.item || [];
        // Look for an .xml file that's NOT the primary doc and NOT the
        // submission text file. Typically named "infotable.xml" or
        // "<accession>infotable.xml" or similar.
        for (const it of items) {
          const name = (it.name || '').toLowerCase();
          if (name.endsWith('.xml') && (name.includes('infotable') || name.includes('information'))) {
            infoTableUrl = `${dirUrl}${it.name}`;
            break;
          }
        }
        // Fallback: any .xml file other than primary
        if (!infoTableUrl) {
          for (const it of items) {
            const name = (it.name || '').toLowerCase();
            if (name.endsWith('.xml') && !name.endsWith('primary_doc.xml')) {
              infoTableUrl = `${dirUrl}${it.name}`;
              break;
            }
          }
        }
      }
    } catch (e) {
      // Fall through; we'll try a guess
    }
    // Fallback guess: most 13Fs use "infotable.xml" as the filename
    if (!infoTableUrl) {
      infoTableUrl = `${dirUrl}infotable.xml`;
    }
    // Step 3: fetch the info table XML
    const r2 = await fetch(infoTableUrl, { headers: { 'User-Agent': SEC_USER_AGENT } });
    if (!r2.ok) return null;
    const xmlText = await r2.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    // Look for parser errors
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
    // The table uses {ns:}infoTable elements; getElementsByTagNameNS
    // is unreliable across browsers, so we use getElementsByTagName
    // with various lowercase/uppercase forms.
    /** @type {HTMLCollectionOf<Element> | Element[]} */
    let infoTables = doc.getElementsByTagName('infoTable');
    if (infoTables.length === 0) infoTables = doc.getElementsByTagName('ns1:infoTable');
    if (infoTables.length === 0) infoTables = doc.getElementsByTagName('n1:infoTable');
    // Also try just 'infotable' lowercase
    if (infoTables.length === 0) {
      const all = doc.getElementsByTagName('*');
      const matched = [];
      for (let i = 0; i < all.length; i++) {
        const tn = (all[i].tagName || '').toLowerCase();
        if (tn === 'infotable' || tn.endsWith(':infotable')) matched.push(all[i]);
      }
      infoTables = matched;
    }
    const holdings = [];
    let totalValue = 0;
    const txt = (parent, key) => {
      // Helper: get text content of first child by local name (case-insensitive)
      if (!parent) return '';
      const lower = key.toLowerCase();
      const all = parent.getElementsByTagName('*');
      for (let i = 0; i < all.length; i++) {
        const tn = (all[i].tagName || '').toLowerCase();
        if (tn === lower || tn.endsWith(':' + lower)) {
          return (all[i].textContent || '').trim();
        }
      }
      return '';
    };
    for (let i = 0; i < infoTables.length; i++) {
      const t = infoTables[i];
      const nameOfIssuer = txt(t, 'nameOfIssuer');
      const cusip = txt(t, 'cusip');
      const titleOfClass = txt(t, 'titleOfClass');
      // value is reported in $1000s in 13F filings
      const valueRaw = parseFloat(txt(t, 'value')) || 0;
      const value = valueRaw * 1000; // back to actual dollars
      const sshPrnamt = parseFloat(txt(t, 'sshPrnamt')) || 0;
      const sshPrnamtType = txt(t, 'sshPrnamtType') || 'SH';
      const putCall = txt(t, 'putCall'); // "Put" / "Call" or empty
      const investmentDiscretion = txt(t, 'investmentDiscretion');
      // votingAuthority is a nested element with sole/shared/none child counts
      let votingSole = 0, votingShared = 0, votingNone = 0;
      const va = t.getElementsByTagName('votingAuthority');
      if (va.length > 0) {
        votingSole = parseFloat(txt(va[0], 'Sole')) || 0;
        votingShared = parseFloat(txt(va[0], 'Shared')) || 0;
        votingNone = parseFloat(txt(va[0], 'None')) || 0;
      }
      if (!nameOfIssuer && !cusip) continue;
      holdings.push({
        nameOfIssuer, cusip, titleOfClass,
        value, shares: sshPrnamt, sharesType: sshPrnamtType,
        putCall: putCall || null,
        investmentDiscretion,
        votingSole, votingShared, votingNone,
        // Pricing per share (rough proxy if value is positive and shares > 0)
        pricePerShare: (value > 0 && sshPrnamt > 0) ? value / sshPrnamt : null,
      });
      totalValue += value;
    }
    // Sort holdings by value descending (largest positions first)
    holdings.sort((a, b) => b.value - a.value);
    const out = {
      holdings,
      total: { value: totalValue, positions: holdings.length },
      filingDate: filing.date,
      accession: filing.accession,
    };
    cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    console.warn('[parseSec13F]', /** @type {Error} */ (e).message);
    return null;
  }
};

// ──────── 3. US Treasury Fiscal Data (NO KEY) ────────
// Pulls live Treasury yield curve data — used for the rates/macro widgets.
export const fetchTreasuryRates = async () => {
  const cached = cacheGet('treasury', 60 * 60_000);
  if (cached) return cached;
  try {
    const r = await fetch('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=20');
    const j = await r.json();
    const rows = (j?.data ?? []).slice(0, 20).map(d => ({
      date: d.record_date,
      security: d.security_desc,
      rate: parseFloat(d.avg_interest_rate_amt),
    }));
    cacheSet('treasury', rows);
    return rows;
  } catch (e) {
    console.warn('[Treasury]', /** @type {Error} */ (e).message);
    return [];
  }
};

// ──────── 4. EconDB economic time-series (NO KEY for basic series) ────────
// Free public series like CPI, unemployment, GDP. The /series endpoint
// returns paginated metadata; specific series are at /series/{code}.
export const fetchEconDbSeries = async (code = 'GDPUS') => {
  const cached = cacheGet(`econdb:${code}`, 6 * 60 * 60_000);
  if (cached) return cached;
  // Build a realistic synth fallback so the macro widget always renders.
  // Each series is anchored at a sensible recent value for the indicator,
  // with a believable monthly drift and seasonality. Used when EconDB is
  // unreachable (CORS, rate limit, downtime).
  const synthFor = (code) => {
    const meta = {
      GDPUS:   { base: 28.5, drift: 0.06, vol: 0.18, label: 'US GDP ($T)' },
      CPIUS:   { base: 309,  drift: 0.25, vol: 0.30, label: 'US CPI' },
      URATEUS: { base: 4.2,  drift: 0.01, vol: 0.06, label: 'Unemployment %' },
      PPIUS:   { base: 252,  drift: 0.20, vol: 0.40, label: 'PPI' },
    }[code] ?? { base: 100, drift: 0.5, vol: 1, label: code };
    const today = new Date();
    const points = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today);
      d.setMonth(d.getMonth() - i);
      const seasonal = Math.sin((i / 12) * Math.PI * 2) * meta.vol * 0.4;
      const trend = -i * meta.drift;
      const noise = (Math.sin(i * 0.7 + meta.base) * 0.5) * meta.vol;
      points.push({
        date: d.toISOString().slice(0, 10),
        value: +(meta.base + trend + seasonal + noise).toFixed(2),
      });
    }
    return { code, description: meta.label, data: points, _synth: true };
  };
  try {
    const r = await fetch(`https://www.econdb.com/api/series/${code}/?format=json`);
    const j = await r.json();
    const data = (j?.data?.values ?? []).map((v, i) => ({
      date: j?.data?.dates?.[i],
      value: v,
    })).filter(p => p.date && typeof p.value === 'number');
    if (data.length === 0) {
      // Empty response — fall through to synth
      const out = synthFor(code);
      cacheSet(`econdb:${code}`, out);
      return out;
    }
    const out = {
      code,
      description: j?.description ?? code,
      data,
    };
    cacheSet(`econdb:${code}`, out);
    return out;
  } catch (e) {
    console.warn('[EconDB]', /** @type {Error} */ (e).message);
    const out = synthFor(code);
    // Don't cache the synth — if the network comes back, we want to retry
    return out;
  }
};

// ──────── 5. OpenFIGI ticker mapping (NO KEY for low rate) ────────
// Resolves any ticker/CUSIP/ISIN to FIGI + asset class metadata.
export const fetchOpenFigi = async (ticker) => {
  const cached = cacheGet(`figi:${ticker}`, 24 * 60 * 60_000);
  if (cached) return cached;
  try {
    const r = await fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ idType: 'TICKER', idValue: ticker, exchCode: 'US' }]),
    });
    const j = await r.json();
    const data = j?.[0]?.data?.[0] ?? null;
    cacheSet(`figi:${ticker}`, data);
    return data;
  } catch (e) {
    console.warn('[OpenFIGI]', /** @type {Error} */ (e).message);
    return null;
  }
};

// ──────── 6. MediaStack news (KEY required) ────────
export const fetchMediaStackNews = async (query = 'stocks') => {
  if (!MEDIASTACK_KEY) return [];
  const cached = cacheGet(`media:${query}`, 15 * 60_000);
  if (cached) return cached;
  try {
    const r = await fetch(`https://api.mediastack.com/v1/news?access_key=${MEDIASTACK_KEY}&keywords=${encodeURIComponent(query)}&languages=en&limit=15`);
    const j = await r.json();
    const out = (j?.data ?? []).map(n => ({
      title: n.title,
      desc: n.description,
      source: n.source,
      url: n.url,
      ts: n.published_at,
      img: n.image,
    }));
    cacheSet(`media:${query}`, out);
    return out;
  } catch (e) {
    console.warn('[MediaStack]', /** @type {Error} */ (e).message);
    return [];
  }
};

// ──────── 7. NewsData.io (KEY required) ────────
export const fetchNewsDataNews = async (query = 'stocks') => {
  if (!NEWSDATA_KEY) return [];
  const cached = cacheGet(`newsdata:${query}`, 15 * 60_000);
  if (cached) return cached;
  try {
    const r = await fetch(`https://newsdata.io/api/1/news?apikey=${NEWSDATA_KEY}&q=${encodeURIComponent(query)}&language=en&category=business`);
    const j = await r.json();
    const out = (j?.results ?? []).slice(0, 15).map(n => ({
      title: n.title,
      desc: n.description,
      source: n.source_id,
      url: n.link,
      ts: n.pubDate,
      img: n.image_url,
    }));
    cacheSet(`newsdata:${query}`, out);
    return out;
  } catch (e) {
    console.warn('[NewsData]', /** @type {Error} */ (e).message);
    return [];
  }
};

// ──────── 8. ExchangeRate-API (KEY required) ────────
export const fetchFxRates = async (base = 'USD') => {
  if (!EXCHANGERATE_KEY) return null;
  const cached = cacheGet(`fx:${base}`, 60 * 60_000);
  if (cached) return cached;
  try {
    const r = await fetch(`https://v6.exchangerate-api.com/v6/${EXCHANGERATE_KEY}/latest/${base}`);
    const j = await r.json();
    if (j.result !== 'success') return null;
    cacheSet(`fx:${base}`, j.conversion_rates);
    return j.conversion_rates;
  } catch (e) {
    console.warn('[FX]', /** @type {Error} */ (e).message);
    return null;
  }
};

// ──────── 9. Weatherstack (KEY required) ────────
export const fetchWeather = async (location) => {
  if (!WEATHERSTACK_KEY || !location) return null;
  const cached = cacheGet(`wx:${location}`, 30 * 60_000);
  if (cached) return cached;
  try {
    // Use http (free tier limitation) or https on paid
    const r = await fetch(`https://api.weatherstack.com/current?access_key=${WEATHERSTACK_KEY}&query=${encodeURIComponent(location)}`);
    const j = await r.json();
    if (!j?.current) return null;
    const out = {
      location: j.location?.name,
      country: j.location?.country,
      temp: j.current.temperature,
      desc: j.current.weather_descriptions?.[0],
      windKph: j.current.wind_speed,
      humidity: j.current.humidity,
    };
    cacheSet(`wx:${location}`, out);
    return out;
  } catch (e) {
    console.warn('[Weatherstack]', /** @type {Error} */ (e).message);
    return null;
  }
};

// ──────── 10. IQAir air quality (KEY required) ────────
export const fetchAirQuality = async (lat, lng) => {
  if (!IQAIR_KEY || !lat || !lng) return null;
  const cached = cacheGet(`aqi:${lat},${lng}`, 60 * 60_000);
  if (cached) return cached;
  try {
    const r = await fetch(`https://api.airvisual.com/v2/nearest_city?lat=${lat}&lon=${lng}&key=${IQAIR_KEY}`);
    const j = await r.json();
    if (j.status !== 'success') return null;
    const out = {
      city: j.data.city,
      country: j.data.country,
      aqiUS: j.data.current?.pollution?.aqius,
      mainPollutant: j.data.current?.pollution?.mainus,
    };
    cacheSet(`aqi:${lat},${lng}`, out);
    return out;
  } catch (e) {
    console.warn('[IQAir]', /** @type {Error} */ (e).message);
    return null;
  }
};

// ──────── 11. Currents API news (KEY required) ────────
export const fetchCurrentsNews = async (query = 'stocks') => {
  if (!CURRENTS_KEY) return [];
  const cached = cacheGet(`currents:${query}`, 15 * 60_000);
  if (cached) return cached;
  try {
    const r = await fetch(`https://api.currentsapi.services/v1/search?keywords=${encodeURIComponent(query)}&language=en&apiKey=${CURRENTS_KEY}`);
    const j = await r.json();
    const out = (j?.news ?? []).slice(0, 15).map(n => ({
      title: n.title,
      desc: n.description,
      source: n.author ?? 'Currents',
      url: n.url,
      ts: n.published,
      img: n.image,
    }));
    cacheSet(`currents:${query}`, out);
    return out;
  } catch (e) {
    console.warn('[Currents]', /** @type {Error} */ (e).message);
    return [];
  }
};

// ──────── 12. NYT Article Search (KEY required) ────────
export const fetchNytNews = async (query = 'stocks') => {
  if (!NYT_KEY) return [];
  const cached = cacheGet(`nyt:${query}`, 30 * 60_000);
  if (cached) return cached;
  try {
    const r = await fetch(`https://api.nytimes.com/svc/search/v2/articlesearch.json?q=${encodeURIComponent(query)}&fq=section_name:("Business")&sort=newest&api-key=${NYT_KEY}`);
    const j = await r.json();
    const docs = j?.response?.docs ?? [];
    const out = docs.slice(0, 15).map(n => ({
      title: n.headline?.main,
      desc: n.abstract,
      source: 'New York Times',
      url: n.web_url,
      ts: n.pub_date,
      img: n.multimedia?.[0]?.url ? `https://www.nytimes.com/${n.multimedia[0].url}` : null,
    }));
    cacheSet(`nyt:${query}`, out);
    return out;
  } catch (e) {
    console.warn('[NYT]', /** @type {Error} */ (e).message);
    return [];
  }
};

// ──────── 13. Coinlayer crypto rates (KEY required) ────────
export const fetchCoinlayerRates = async (symbols = 'BTC,ETH,SOL,DOGE,XRP') => {
  if (!COINLAYER_KEY) return null;
  const cached = cacheGet(`coinlayer:${symbols}`, 5 * 60_000);
  if (cached) return cached;
  try {
    const r = await fetch(`https://api.coinlayer.com/live?access_key=${COINLAYER_KEY}&symbols=${symbols}`);
    const j = await r.json();
    if (!j.success) return null;
    cacheSet(`coinlayer:${symbols}`, j.rates);
    return j.rates;
  } catch (e) {
    console.warn('[Coinlayer]', /** @type {Error} */ (e).message);
    return null;
  }
};

// ──────── 14. Alpaca corporate actions (KEY + SECRET required) ────────
// Returns dividends, splits, mergers for a given symbol. Uses the
// /v1/corporate_actions/announcements endpoint which is free for
// paper trading accounts.
export const fetchAlpacaCorporateActions = async (symbol) => {
  if (!ALPACA_KEY || !ALPACA_SECRET || !symbol) return [];
  const cached = cacheGet(`alpaca:${symbol}`, 60 * 60_000);
  if (cached) return cached;
  try {
    // Get last 90 days of corporate actions
    const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
    const until = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
    const url = `https://data.alpaca.markets/v1/corporate_actions/announcements?ca_types=dividend,split,merger,name_change,worth_expiration&since=${since}&until=${until}&symbol=${symbol}`;
    const r = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': ALPACA_KEY,
        'APCA-API-SECRET-KEY': ALPACA_SECRET,
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const out = (Array.isArray(j) ? j : []).slice(0, 20).map(a => ({
      type: a.ca_type,
      subType: a.ca_sub_type,
      symbol: a.target_symbol ?? symbol,
      cashAmount: a.cash ?? null,
      ratio: a.old_rate && a.new_rate ? `${a.old_rate}:${a.new_rate}` : null,
      declarationDate: a.declaration_date,
      exDate: a.ex_date,
      recordDate: a.record_date,
      payableDate: a.payable_date,
    }));
    cacheSet(`alpaca:${symbol}`, out);
    return out;
  } catch (e) {
    console.warn('[Alpaca]', /** @type {Error} */ (e).message);
    return [];
  }
};

// ──────── 15. Portfolio Optimizer (NO KEY needed — public API) ────────
// Mean-variance optimization given expected returns and a covariance matrix.
// Rate-limited to ~5 req per 10s per IP. Returns optimal weights.
export const fetchOptimalWeights = async ({ assets, covariance, expectedReturns }) => {
  if (!Array.isArray(assets) || assets.length < 2) return null;
  const cacheKey = `popt:${assets.join(',')}:${(expectedReturns ?? []).join(',')}`;
  const cached = cacheGet(cacheKey, 5 * 60_000);
  if (cached) return cached;
  try {
    const body = {
      assets: assets.length,
      assetsCovarianceMatrix: covariance,
      assetsReturns: expectedReturns,
    };
    const r = await fetch('https://api.portfoliooptimizer.io/v1/portfolio/optimization/maximum-sharpe-ratio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    // Map weights back onto asset symbols
    const weights = (j?.assetsWeights ?? []).map((w, i) => ({
      symbol: assets[i],
      weight: w,
    }));
    cacheSet(cacheKey, weights);
    return weights;
  } catch (e) {
    console.warn('[PortfolioOptimizer]', /** @type {Error} */ (e).message);
    return null;
  }
};

// ────────── Unusual Whales API integration ──────────
// Phase 3p.36 (TS-driven extraction): UW_API_KEY + fetchUWStockFlow +
// fetchUWMarketTide moved here from monolith. mini-widgets.jsx and
// monolith both reference fetchUWStockFlow without import — TS
// surfaced this in 3p.36.
//
// Optional, paid. Users provide their own API key via VITE_UW_API_KEY.
// When absent, UW-backed widgets fall back to synthesized data.

export const UW_API_KEY = (() => { try { return import.meta.env?.VITE_UW_API_KEY ?? ''; } catch { return ''; } })();

export const fetchUWStockFlow = async (ticker) => {
  if (!UW_API_KEY || !ticker) return null;
  const cacheKey = `uw:flow:${ticker}`;
  const cached = cacheGet(cacheKey, 30_000);
  if (cached) return cached;
  try {
    const r = await fetch(`https://api.unusualwhales.com/api/stock/${ticker}/flow-recent`, {
      headers: { Authorization: `Bearer ${UW_API_KEY}` },
    });
    if (!r.ok) throw new Error(`UW HTTP ${r.status}`);
    const j = await r.json();
    const out = j?.data ?? [];
    cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    console.warn('[UW flow]', ticker, /** @type {Error} */ (e).message);
    return null;
  }
};

export const fetchUWMarketTide = async () => {
  if (!UW_API_KEY) return null;
  const cacheKey = `uw:tide`;
  const cached = cacheGet(cacheKey, 30_000);
  if (cached) return cached;
  try {
    const r = await fetch(`https://api.unusualwhales.com/api/market/market-tide`, {
      headers: { Authorization: `Bearer ${UW_API_KEY}` },
    });
    if (!r.ok) throw new Error(`UW HTTP ${r.status}`);
    const j = await r.json();
    const out = j?.data ?? null;
    cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    console.warn('[UW tide]', /** @type {Error} */ (e).message);
    return null;
  }
};
