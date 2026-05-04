// @ts-check
// IMO Onyx Terminal — News sentiment scoring
//
// Phase 3p.36 (TS-driven extraction): scoreSentiment + scoreSentimentBatch
// were used by chart-page.jsx (extracted in 3p.26) but never imported.
// TS surfaced the missing reference. Extracted here with their three
// fixture dependencies (LEXICON, NEGATORS, INTENSIFIERS).
//
// Public exports:
//   scoreSentiment(text)              — score one string
//   scoreSentimentBatch(items, fields) — score an array of news items

// Financial-news sentiment lexicon. Hand-curated based on Loughran-
// McDonald financial dictionary + common headline phrases. Multi-word
// phrases checked first to avoid being broken into less-meaningful
// individual tokens.
export const SENTIMENT_LEXICON = {
  // Strong positive (+0.8 to +1.0)
  'beat estimates': +1.0, 'beats estimates': +1.0, 'beat earnings': +1.0,
  'beats earnings': +1.0, 'crushes earnings': +1.0, 'blowout': +1.0,
  'all-time high': +0.9, 'record high': +0.9, 'record profits': +0.9,
  'record revenue': +0.9, 'breakthrough': +0.9, 'soars': +0.85,
  'surge': +0.8, 'surges': +0.8, 'surged': +0.8, 'rally': +0.7,
  'rallies': +0.7, 'rallied': +0.7, 'jumps': +0.7, 'jumped': +0.7,
  // Positive (+0.4 to +0.7)
  'rises': +0.5, 'rose': +0.5, 'gains': +0.5, 'gained': +0.5,
  'climbs': +0.5, 'climbed': +0.5, 'advances': +0.5, 'advanced': +0.5,
  'upgrade': +0.7, 'upgraded': +0.7, 'outperform': +0.6, 'overweight': +0.6,
  'positive': +0.5, 'strong': +0.5, 'robust': +0.6, 'solid': +0.5,
  'beats': +0.7, 'beat': +0.7, 'exceeds': +0.6, 'exceeded': +0.6,
  'top': +0.4, 'tops': +0.5, 'topped': +0.5, 'better than expected': +0.7,
  'profitable': +0.5, 'profit': +0.4, 'growth': +0.5, 'expansion': +0.5,
  'launch': +0.4, 'launches': +0.4, 'launched': +0.4, 'innovation': +0.5,
  'partnership': +0.4, 'acquisition': +0.4, 'acquires': +0.4,
  'buyback': +0.6, 'buybacks': +0.6, 'dividend': +0.4, 'increased dividend': +0.7,
  'guidance raised': +0.8, 'raised guidance': +0.8, 'raised outlook': +0.8,
  'optimistic': +0.5, 'bullish': +0.7, 'momentum': +0.4, 'expanding': +0.5,
  'breakout': +0.6, 'all-time': +0.5,

  // Strong negative (-0.8 to -1.0)
  'misses estimates': -1.0, 'missed estimates': -1.0, 'misses earnings': -1.0,
  'missed earnings': -1.0, 'collapse': -1.0, 'collapses': -1.0,
  'collapsed': -1.0, 'plunges': -0.9, 'plunged': -0.9, 'crash': -1.0,
  'crashes': -1.0, 'crashed': -1.0, 'tumbles': -0.85, 'tumbled': -0.85,
  'all-time low': -0.9, 'record low': -0.9, 'bankruptcy': -1.0,
  'bankrupt': -1.0, 'fraud': -1.0, 'investigation': -0.8, 'subpoena': -0.85,
  'lawsuit': -0.6, 'sued': -0.6, 'recall': -0.7, 'recalled': -0.7,
  // Negative (-0.4 to -0.7)
  'falls': -0.5, 'fell': -0.5, 'drops': -0.5, 'dropped': -0.5,
  'declines': -0.5, 'declined': -0.5, 'slides': -0.5, 'slid': -0.5,
  'downgrade': -0.7, 'downgraded': -0.7, 'underperform': -0.6, 'underweight': -0.6,
  'negative': -0.5, 'weak': -0.5, 'weakness': -0.5, 'weakening': -0.5,
  'misses': -0.7, 'miss': -0.7, 'missed': -0.7, 'worse than expected': -0.7,
  'loss': -0.5, 'losses': -0.5, 'unprofitable': -0.7, 'declining': -0.5,
  'cut': -0.5, 'cuts': -0.5, 'layoffs': -0.7, 'restructuring': -0.5,
  'guidance cut': -0.85, 'cut guidance': -0.85, 'lowered guidance': -0.85,
  'lowered outlook': -0.8, 'pessimistic': -0.5, 'bearish': -0.7,
  'concerns': -0.4, 'concern': -0.4, 'risk': -0.3, 'risks': -0.3,
  'warning': -0.6, 'warns': -0.6, 'warned': -0.6, 'breakdown': -0.6,
  'sell-off': -0.7, 'selloff': -0.7, 'sell off': -0.7, 'rout': -0.85,
  'slump': -0.7, 'slumps': -0.7, 'slumped': -0.7,
};

// Modifiers — adjust polarity of the next token. Negators flip; intensifiers boost.
export const SENTIMENT_NEGATORS = new Set(['no', 'not', "n't", 'never', 'without', 'fails to', 'failed to']);
export const SENTIMENT_INTENSIFIERS = { 'very': 1.4, 'extremely': 1.6, 'highly': 1.4, 'massively': 1.6, 'sharply': 1.4, 'dramatically': 1.5 };

// scoreSentiment — given a headline string, returns:
//   { score: -1..+1, label: 'very-positive'|...|'very-negative',
//     terms: [{term, polarity, weight, position}] (matched terms),
//     confidence: 0..1 (based on how many terms matched) }
export const scoreSentiment = (text) => {
  if (!text || typeof text !== 'string') {
    return { score: 0, label: 'neutral', terms: [], confidence: 0 };
  }
  const lower = text.toLowerCase();
  const matchedTerms = [];
  let totalScore = 0;
  let totalWeight = 0;
  // Sort lexicon entries by length descending to match longer phrases first
  const entries = Object.entries(SENTIMENT_LEXICON).sort((a, b) => b[0].length - a[0].length);
  // Track which characters have been "consumed" by matches to avoid
  // double-counting (e.g., "beats earnings" shouldn't also match "beats")
  const consumed = new Array(lower.length).fill(false);
  for (const [term, polarity] of entries) {
    let pos = 0;
    while (pos < lower.length) {
      const idx = lower.indexOf(term, pos);
      if (idx === -1) break;
      // Check word boundaries (no surrounding alpha)
      const before = idx === 0 ? ' ' : lower[idx - 1];
      const after = idx + term.length >= lower.length ? ' ' : lower[idx + term.length];
      const isBoundary = !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
      // Check not already consumed
      let alreadyConsumed = false;
      for (let k = idx; k < idx + term.length; k++) {
        if (consumed[k]) { alreadyConsumed = true; break; }
      }
      if (isBoundary && !alreadyConsumed) {
        // Mark consumed
        for (let k = idx; k < idx + term.length; k++) consumed[k] = true;
        // Check for negator within last ~2 words
        const beforeText = lower.slice(Math.max(0, idx - 30), idx);
        const lastWords = beforeText.trim().split(/\s+/).slice(-2);
        const isNegated = lastWords.some(w => SENTIMENT_NEGATORS.has(w) ||
          SENTIMENT_NEGATORS.has(lastWords.slice(-2).join(' ')));
        // Check for intensifier within last word
        let intensity = 1;
        for (const intens of Object.keys(SENTIMENT_INTENSIFIERS)) {
          if (lastWords.includes(intens)) { intensity = SENTIMENT_INTENSIFIERS[intens]; break; }
        }
        const adjPolarity = (isNegated ? -polarity : polarity) * intensity;
        const weight = Math.abs(polarity);
        totalScore += adjPolarity * weight;
        totalWeight += weight;
        matchedTerms.push({
          term, polarity: adjPolarity, weight, position: idx,
          negated: isNegated,
        });
      }
      pos = idx + term.length;
    }
  }
  const score = totalWeight > 0 ? totalScore / totalWeight : 0;
  const clipped = Math.max(-1, Math.min(1, score));
  const label = clipped >=  0.5 ? 'very-positive'
              : clipped >=  0.15 ? 'positive'
              : clipped <= -0.5 ? 'very-negative'
              : clipped <= -0.15 ? 'negative'
              :                    'neutral';
  // Confidence = function of how many terms matched. 0 matches → 0;
  // 1 match → 0.4; 3+ matches → 1.0. Saturates so multi-match
  // headlines aren't infinitely confident.
  const confidence = Math.min(1, matchedTerms.length / 3);
  return { score: clipped, label, terms: matchedTerms, confidence };
};

// scoreSentimentBatch — scores an array of news items in one pass.
// Each item has .title (or .headline / .description). Adds a
// `_sentiment` field with the score result; returns the array.
export const scoreSentimentBatch = (items, textFields = ['title', 'headline', 'description']) => {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    const text = textFields.map(f => item?.[f] || '').filter(Boolean).join(' ');
    return { ...item, _sentiment: scoreSentiment(text) };
  });
};
