// IMO Onyx Terminal — AIMarkdown
//
// Phase 3p.20 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~340-382).
//
// Streamdown wrapper pre-styled to match the Onyx palette. Streamdown
// renders markdown progressively as tokens stream in, so users see
// formatting (bold, lists, code blocks, tables) appear character-by-
// character instead of waiting for the full response and rendering in
// a burst. Used wherever LLM output is displayed: the Daily Brief
// toast, Chart Scanner result panel, AI Edit feedback, the main Ask
// AI panel.
//
// The wrapper supplies a className with our color palette so headings,
// links, code, tables, and blockquotes inherit the surface tones
// rather than Streamdown's default "white card on light bg" that
// would clash on Onyx's dark canvas.
//
// Public export:
//   AIMarkdown({ children, className, size })
//     size — 'xs' | 'sm' | 'md' — selects a text-size preset:
//       xs (10.5px) — tooltips/toasts
//       sm (11.5px) — panels (default)
//       md (12.5px) — the main Ask AI body
//
// Honest scope: this is presentation styling only. The streaming/
// incremental-parse behavior is all in Streamdown itself.

import React from 'react';
import { Streamdown } from 'streamdown';
import { COLORS } from '../lib/constants.js';

export const AIMarkdown = ({ children, className = '', size = 'sm' }) => {
  const sizeStyles = {
    xs: 'text-[10.5px] leading-relaxed',
    sm: 'text-[11.5px] leading-relaxed',
    md: 'text-[12.5px] leading-relaxed',
  };
  const sz = sizeStyles[size] ?? sizeStyles.sm;
  return (
    <div className={`imo-ai-md ${sz} ${className}`} style={{ color: COLORS.text }}>
      <Streamdown
        parseIncompleteMarkdown
        // Skip Shiki — adds ~500kb to the bundle for code highlighting
        // we rarely surface in trading content. Plain <code> styling
        // covers the cases we hit (function names, indicator IDs).
        shikiTheme={undefined}
      >
        {children ?? ''}
      </Streamdown>
    </div>
  );
};
