// IMO Onyx Terminal — formatting helpers
//
// Phase 3p.01 (file split, batch 13). Display-formatting utilities used
// across many surfaces — currently just the ticker formatter, but this
// is the home for future number/currency/date/percentage formatters as
// they get extracted.
//
// Public exports:
//   TICKER_EXCHANGE   { [equity ticker]: 'NASDAQ' | 'NYSE' | 'ARCA' }
//                     Static lookup table keyed by equity symbol.
//   formatTicker(id, cls)
//                     Returns "NSDQ:AAPL" / "NYSE:JPM" / "ARCA:SPY" for
//                     equities; raw id (BTC-PERP, EUR-USD, etc.) for
//                     non-equities. Used 10+ surfaces — order book,
//                     status bar, watchlist, etc.

export const TICKER_EXCHANGE = {
  // NYSE-listed
  'JPM': 'NYSE', 'V': 'NYSE', 'MA': 'NYSE', 'BAC': 'NYSE', 'WFC': 'NYSE',
  'GS': 'NYSE', 'MS': 'NYSE', 'BX': 'NYSE', 'C': 'NYSE',
  'JNJ': 'NYSE', 'UNH': 'NYSE', 'PFE': 'NYSE', 'MRK': 'NYSE', 'ABBV': 'NYSE',
  'LLY': 'NYSE', 'TMO': 'NYSE', 'ABT': 'NYSE',
  'XOM': 'NYSE', 'CVX': 'NYSE', 'COP': 'NYSE', 'SLB': 'NYSE', 'MPC': 'NYSE',
  'PSX': 'NYSE', 'EOG': 'NYSE',
  'WMT': 'NYSE', 'PG': 'NYSE', 'KO': 'NYSE', 'PEP': 'NASDAQ', 'PM': 'NYSE',
  'HD': 'NYSE', 'LOW': 'NYSE', 'NKE': 'NYSE', 'DIS': 'NYSE', 'MCD': 'NYSE',
  'TJX': 'NYSE', 'BKNG': 'NASDAQ', 'SBUX': 'NASDAQ',
  'CAT': 'NYSE', 'GE': 'NYSE', 'RTX': 'NYSE', 'HON': 'NASDAQ', 'BA': 'NYSE',
  'UPS': 'NYSE', 'LMT': 'NYSE', 'DE': 'NYSE',
  'BRK.B': 'NYSE',
  'NEE': 'NYSE', 'SO': 'NYSE', 'DUK': 'NYSE', 'AEP': 'NASDAQ',
  'LIN': 'NYSE', 'SHW': 'NYSE', 'ECL': 'NYSE', 'APD': 'NYSE',
  'AMT': 'NYSE', 'PLD': 'NYSE', 'WELL': 'NYSE', 'EQIX': 'NASDAQ',
  'ACN': 'NYSE', 'IBM': 'NYSE', 'ORCL': 'NYSE', 'CRM': 'NYSE',
  'VZ': 'NYSE', 'T': 'NYSE',
  // NASDAQ-listed
  'AAPL': 'NASDAQ', 'MSFT': 'NASDAQ', 'NVDA': 'NASDAQ', 'GOOGL': 'NASDAQ',
  'AMZN': 'NASDAQ', 'META': 'NASDAQ', 'TSLA': 'NASDAQ', 'NFLX': 'NASDAQ',
  'AVGO': 'NASDAQ', 'AMD': 'NASDAQ', 'CSCO': 'NASDAQ', 'ADBE': 'NASDAQ',
  'INTC': 'NASDAQ', 'QCOM': 'NASDAQ', 'TXN': 'NASDAQ', 'COST': 'NASDAQ',
  'CMCSA': 'NASDAQ', 'TMUS': 'NASDAQ',
  // ETFs (mostly ARCA / NYSEArca)
  'SPY': 'ARCA', 'QQQ': 'NASDAQ', 'IWM': 'ARCA', 'DIA': 'ARCA',
  'VOO': 'ARCA', 'VTI': 'ARCA', 'VEA': 'ARCA', 'VWO': 'ARCA',
  'XLF': 'ARCA', 'XLK': 'ARCA', 'XLE': 'ARCA', 'XLV': 'ARCA',
  'XLI': 'ARCA', 'XLP': 'ARCA', 'XLY': 'ARCA', 'XLU': 'ARCA', 'XLRE': 'ARCA',
};
// Format a ticker with its listing exchange prefix. Returns either
// "NSDQ:AAPL" / "NYSE:JPM" / "ARCA:SPY" or for unknown stocks just the
// raw ticker. Pass cls='equity' to enable the prefix; non-equity instruments
// return the raw id (BTC-PERP, EUR-USD, WTI-F26, etc.).
export const formatTicker = (id, cls) => {
  if (!id) return '';
  if (cls && cls !== 'equity') return id;
  const ex = TICKER_EXCHANGE[id];
  if (!ex) return id;
  // Use 4-char abbreviations: NSDQ instead of NASDAQ for compactness
  const abbrev = ex === 'NASDAQ' ? 'NSDQ' : ex;
  return `${abbrev}:${id}`;
};
