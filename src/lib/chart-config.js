// IMO Onyx Terminal — chart configuration
//
// Phase 3p.06 (feature/chart-tests prerequisite). The Chart component
// depends on these data structures for its range/frequency picker.
// Extracting them here lets us test the validation logic in isolation
// without rendering 5,000 lines of Chart React.
//
// Public exports:
//   TIME_RANGES           Range options surfaced in the UI.
//                         { id, label, desc, spanMins, defaultInterval }.
//                         spanMins=null for dynamic (YTD, MAX).
//   INTERVALS             Candle frequencies.
//                         { id, label, mins, maxRangeMins }.
//                         maxRangeMins=null = unlimited (e.g. 1d / 1w / 1M).
//                         Used to prevent absurd combinations
//                         (1-minute candles over 5 years = 2.6M points).
//   TIMEFRAMES            Legacy back-compat list (16 entries) — older
//                         code paths reference these directly.
//                         { id, label, desc, barTf, bars }.
//   resolveRangeMins(rid) Range id → actual span in minutes.
//                         Computes YTD on demand from current date;
//                         MAX uses a 20-year cap.
//   isValidCombination(rangeId, intervalId)
//                         Returns true if the combo is allowed by the
//                         interval's maxRangeMins guard. Encapsulates
//                         the validation logic the Chart uses to gray
//                         out impossible buttons.

export const TIME_RANGES = [
  { id: '1D',  label: '1D',  desc: 'Past trading day',     spanMins: 60 * 24,           defaultInterval: '1m'  },
  { id: '5D',  label: '5D',  desc: 'Past 5 trading days',  spanMins: 60 * 24 * 5,       defaultInterval: '5m'  },
  { id: '1M',  label: '1M',  desc: 'Past month',           spanMins: 60 * 24 * 30,      defaultInterval: '1h'  },
  { id: '6M',  label: '6M',  desc: 'Past 6 months',        spanMins: 60 * 24 * 182,     defaultInterval: '1d'  },
  { id: 'YTD', label: 'YTD', desc: 'Year to date',         spanMins: null /* dynamic */, defaultInterval: '1d'  },
  { id: '1Y',  label: '1Y',  desc: 'Past year',            spanMins: 60 * 24 * 365,     defaultInterval: '1d'  },
  { id: '5Y',  label: '5Y',  desc: 'Past 5 years',         spanMins: 60 * 24 * 365 * 5, defaultInterval: '1w'  },
  { id: 'MAX', label: 'Max', desc: 'All available history', spanMins: null,             defaultInterval: '1M'  },
];

export const INTERVALS = [
  { id: '1m',  label: '1 min',  mins: 1,        maxRangeMins: 60 * 24 * 5    },  // up to 5 days
  { id: '2m',  label: '2 min',  mins: 2,        maxRangeMins: 60 * 24 * 5    },
  { id: '5m',  label: '5 min',  mins: 5,        maxRangeMins: 60 * 24 * 30   },  // up to 1 month
  { id: '15m', label: '15 min', mins: 15,       maxRangeMins: 60 * 24 * 60   },
  { id: '30m', label: '30 min', mins: 30,       maxRangeMins: 60 * 24 * 90   },
  { id: '1h',  label: '1 hour', mins: 60,       maxRangeMins: 60 * 24 * 365  },  // up to 1 year
  { id: '4h',  label: '4 hour', mins: 240,      maxRangeMins: 60 * 24 * 365  },
  { id: '1d',  label: '1 day',  mins: 1440,     maxRangeMins: null /* unlimited */ },
  { id: '1w',  label: '1 week', mins: 10080,    maxRangeMins: null },
  { id: '1M',  label: '1 month',mins: 43200,    maxRangeMins: null },
];

export const TIMEFRAMES = [
  // Legacy intraday bucket — these were both range AND interval in the
  // old model. Map them to a sensible synthesized definition.
  { id: '1m',  label: '1m',  desc: 'Past 1 hour · 1-minute candles',     barTf: '1m',  bars: 60   },
  { id: '5m',  label: '5m',  desc: 'Past 5 hours · 5-minute candles',    barTf: '5m',  bars: 60   },
  { id: '15m', label: '15m', desc: 'Past 24 hours · 15-minute candles',  barTf: '15m', bars: 96   },
  { id: '30m', label: '30m', desc: 'Past 2 days · 30-minute candles',    barTf: '30m', bars: 96   },
  { id: '1H',  label: '1H',  desc: 'Past 7 days · 1-hour candles',       barTf: '1h',  bars: 168  },
  // New canonical ranges
  { id: '1D',  label: '1D',  desc: 'Past trading day',                   barTf: '1m',  bars: 390  },
  { id: '5D',  label: '5D',  desc: 'Past 5 trading days',                barTf: '5m',  bars: 390  },
  { id: '1W',  label: '1W',  desc: 'Past week · 15-minute candles',      barTf: '15m', bars: 96   },
  { id: '1M',  label: '1M',  desc: 'Past month · hourly candles',        barTf: '1h',  bars: 168  },
  { id: '3M',  label: '3M',  desc: 'Past 3 months · 4-hour candles',     barTf: '4h',  bars: 90   },
  { id: '6M',  label: '6M',  desc: 'Past 6 months · daily candles',      barTf: '1d',  bars: 130  },
  { id: 'YTD', label: 'YTD', desc: 'Year to date · daily candles',       barTf: '1d',  bars: 252  },
  { id: '1Y',  label: '1Y',  desc: 'Past year · daily candles',          barTf: '1d',  bars: 252  },
  { id: '5Y',  label: '5Y',  desc: 'Past 5 years · weekly candles',      barTf: '1w',  bars: 260  },
  { id: '10Y', label: '10Y', desc: 'Past 10 years · monthly candles',    barTf: '1M',  bars: 120  },
  { id: 'MAX', label: 'Max', desc: 'All available history',              barTf: '1M',  bars: 240  },
];

export const resolveRangeMins = (rangeId) => {
  if (rangeId === 'YTD') {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    return Math.floor((now - yearStart) / (60 * 1000));
  }
  if (rangeId === 'MAX') {
    return 60 * 24 * 365 * 20;
  }
  const r = TIME_RANGES.find(x => x.id === rangeId);
  return r?.spanMins ?? (60 * 24 * 30);
};

export const isValidCombination = (rangeId, intervalId) => {
  const interval = INTERVALS.find(i => i.id === intervalId);
  if (!interval) return false;
  const rangeMins = resolveRangeMins(rangeId);
  // Lower bound: the interval must fit at least once in the range
  // (otherwise computeBarCount returns 0 and the chart is empty).
  if (interval.mins > rangeMins) return false;
  // Upper bound: the interval's data-density guard.
  if (interval.maxRangeMins === null) return true;
  return rangeMins <= interval.maxRangeMins;
};

// reconcileFrequency — the Chart component's UX rule. When the user
// changes the range, the previously-chosen frequency may no longer be
// valid (e.g. they had 1m candles for a 1D range, then switched to 5Y;
// 1m × 5Y is 2.6M data points so it's blocked).
//
// Inputs:
//   newRangeId      — the range the user just selected
//   currentInterval — the interval that was active before the change
//   wasSticky       — whether the user had explicitly picked
//                     `currentInterval` (sticky=true) or it was just
//                     the previous range's default (sticky=false)
//
// Behavior:
//   - If not sticky → return the new range's defaultInterval, sticky=false.
//   - If sticky AND combo is still valid → keep currentInterval, sticky=true.
//   - If sticky AND combo is now invalid → drop sticky, return default.
//
// Returns: { interval, sticky, fellBack }
//   `fellBack` lets the UI flash a brief "your frequency was reset"
//   indicator when an invalid sticky pick gets dropped.
export const reconcileFrequency = (newRangeId, currentInterval, wasSticky) => {
  const range = TIME_RANGES.find(r => r.id === newRangeId);
  const defaultInterval = range?.defaultInterval ?? '1d';
  if (!wasSticky) {
    return { interval: defaultInterval, sticky: false, fellBack: false };
  }
  if (isValidCombination(newRangeId, currentInterval)) {
    return { interval: currentInterval, sticky: true, fellBack: false };
  }
  return { interval: defaultInterval, sticky: false, fellBack: true };
};
