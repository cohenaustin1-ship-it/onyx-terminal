// IMO Onyx Terminal — SnippetsPanel
//
// Phase 3p.12. Wires the snippets-sync.js client (built in 3p.11)
// into a real UI. Users can:
//   - Browse their cloud-synced snippets list
//   - Create / edit / archive snippets
//   - See sync status (last sync time, dirty count, pending conflicts)
//   - Manually trigger a sync
//   - Resolve version conflicts when they arise
//
// Component structure:
//   <SnippetsPanel executorUrl={...} getToken={...} />
//     ├─ <SnippetsList />        — left side, sorted by updated_at
//     ├─ <SnippetsEditor />      — right side, editing form
//     └─ <ConflictResolver />    — modal-ish overlay when 409 fires
//
// Honest scope:
//   - No realtime sync (manual button + auto-poll every 60s when
//     panel is mounted). Real-time push would need SSE/WebSocket.
//   - No diff view in the conflict resolver — user picks "keep mine"
//     or "take theirs" wholesale. Inline merge is out of scope.
//   - No tagging / search beyond simple title prefix match. Tag
//     filtering can come later.

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Streamdown } from 'streamdown';
import { COLORS } from '../lib/constants.js';
import { makeSnippetsClient } from '../lib/snippets-sync.js';
import { appendAuditEntry } from '../lib/audit-log.js';
import { listTemplates, applyTemplate } from '../lib/snippet-templates.js';

const KIND_LABELS = {
  note:   'Note',
  code:   'Code',
  config: 'Config',
};

const fmtRelativeTime = (iso) => {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '—';
  const delta = Date.now() - ts;
  if (delta < 0) return 'just now';
  const s = Math.floor(delta / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

// Default executor URL falls back to the Vite env var so the panel can
// be dropped into SettingsPanel without prop plumbing. Tests override
// via explicit prop.
const defaultExecutorUrl = () => {
  try {
    return (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_EXECUTOR_API_URL) || '';
  } catch { return ''; }
};
const defaultGetToken = () => {
  try { return localStorage.getItem('imo_jwt') || ''; } catch { return ''; }
};

// Minimal syntax highlighter — covers obvious tokens (keywords,
// strings, numbers, comments) for JS/TS/Python/JSON/SQL. Not a real
// parser; deliberately small. Phase 3p.13 / Feature 4.
const KEYWORD_PATTERNS = {
  js: /\b(const|let|var|function|return|if|else|for|while|class|extends|new|async|await|export|import|from|of|in|true|false|null|undefined|throw|try|catch|finally|switch|case|break|continue|do)\b/g,
  py: /\b(def|class|return|if|elif|else|for|while|try|except|finally|with|as|import|from|lambda|None|True|False|and|or|not|in|is|pass|raise|yield|global|nonlocal|async|await)\b/g,
  sql: /\b(SELECT|FROM|WHERE|AND|OR|NOT|JOIN|INNER|LEFT|RIGHT|OUTER|ON|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|NULL|DEFAULT|CASCADE|AS|UNION|DISTINCT|COUNT|SUM|AVG|MIN|MAX)\b/gi,
};

const detectLanguage = (body) => {
  if (!body) return 'js';
  const trimmed = body.trim();
  if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE)\s/i.test(trimmed)) return 'sql';
  if (/^(def\s|class\s|import\s|from\s)/m.test(trimmed)) return 'py';
  return 'js';
};

const highlightCode = (line, lang) => {
  const tokens = [];
  const claim = (start, end, kind) => tokens.push({ start, end, kind });
  const commentRe = lang === 'py' || lang === 'sql' ? /(--|#).*$/ : /(\/\/.*$|\/\*[\s\S]*?\*\/)/;
  const cm = line.match(commentRe);
  if (cm && cm.index !== undefined) claim(cm.index, cm.index + cm[0].length, 'comment');

  const strRe = /(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g;
  let m;
  while ((m = strRe.exec(line)) !== null) {
    if (tokens.some(t => m.index >= t.start && m.index < t.end)) continue;
    claim(m.index, m.index + m[0].length, 'string');
  }
  const numRe = /\b\d+(?:\.\d+)?\b/g;
  while ((m = numRe.exec(line)) !== null) {
    if (tokens.some(t => m.index >= t.start && m.index < t.end)) continue;
    claim(m.index, m.index + m[0].length, 'number');
  }
  const kwPattern = KEYWORD_PATTERNS[lang];
  if (kwPattern) {
    const re = new RegExp(kwPattern.source, kwPattern.flags);
    while ((m = re.exec(line)) !== null) {
      if (tokens.some(t => m.index >= t.start && m.index < t.end)) continue;
      claim(m.index, m.index + m[0].length, 'keyword');
    }
  }
  if (tokens.length === 0) return [{ text: line, kind: 'plain' }];
  tokens.sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = 0;
  for (const t of tokens) {
    if (t.start > cursor) out.push({ text: line.slice(cursor, t.start), kind: 'plain' });
    out.push({ text: line.slice(t.start, t.end), kind: t.kind });
    cursor = t.end;
  }
  if (cursor < line.length) out.push({ text: line.slice(cursor), kind: 'plain' });
  return out;
};

const TOKEN_COLORS = {
  keyword: '#C586C0',  // purple
  string:  '#CE9178',  // orange-brown
  number:  '#B5CEA8',  // light green
  comment: '#6A9955',  // muted green
  plain:   undefined,
};

const CodeRenderer = ({ body }) => {
  const lang = detectLanguage(body);
  const lines = (body || '').split('\n');
  return (
    <div className="flex-1 overflow-auto rounded text-[11px] font-mono"
         style={{ background: COLORS.surface, color: COLORS.text }}
         data-testid="code-render">
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {lines.map((line, i) => {
            const segs = highlightCode(line, lang);
            return (
              <tr key={i}>
                <td className="select-none text-right pr-2 pl-2 align-top"
                    style={{ color: COLORS.textMute, width: 36, userSelect: 'none' }}>
                  {i + 1}
                </td>
                <td className="pr-2 align-top whitespace-pre">
                  {segs.map((s, j) => (
                    <span key={j} style={{ color: TOKEN_COLORS[s.kind] }}>{s.text}</span>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// Split a markdown body into segments alternating prose and mermaid
// fences. Streamdown handles everything else (GFM task lists,
// tables, fenced code with the engine's own styling), so we only need
// to extract the mermaid blocks for special treatment.
const splitMermaidSegments = (body) => {
  const out = [];
  if (!body) return [{ kind: 'md', text: '' }];
  // Match ```mermaid …``` blocks (multiline, non-greedy)
  const re = /```mermaid\s*\n([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) {
      out.push({ kind: 'md', text: body.slice(last, m.index) });
    }
    out.push({ kind: 'mermaid', text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ kind: 'md', text: body.slice(last) });
  if (out.length === 0) out.push({ kind: 'md', text: body });
  return out;
};

const MermaidPlaceholder = ({ source }) => (
  <div className="rounded p-2 my-2"
       data-testid="mermaid-block"
       style={{ background: COLORS.bg, border: `1px dashed ${COLORS.border}` }}>
    <div className="text-[9.5px] uppercase tracking-wider mb-1"
         style={{ color: COLORS.textMute }}>
      Mermaid diagram · preview in mermaid.live
    </div>
    <pre className="text-[10px] font-mono whitespace-pre-wrap"
         style={{ color: COLORS.textDim, margin: 0 }}>
      {source}
    </pre>
  </div>
);

// MarkdownNoteRenderer — Streamdown-based with two extras:
//   1. ```mermaid fences are extracted and rendered as a styled
//      placeholder (we don't ship the mermaid library — too heavy
//      a bundle dep for an occasional feature). Users can copy the
//      diagram source into mermaid.live to view.
//   2. parseIncompleteMarkdown is on so users see formatting as they
//      type, and shikiTheme=undefined to skip the heavy syntax engine.
//      GFM task lists (`- [ ]` / `- [x]`) and tables are handled by
//      Streamdown's bundled remark-gfm.
const MarkdownNoteRenderer = ({ body }) => {
  const segments = useMemo(() => splitMermaidSegments(body), [body]);
  return (
    <div className="flex-1 overflow-auto p-2 rounded text-[12px] imo-snippet-md"
         style={{ background: COLORS.surface, color: COLORS.text }}
         data-testid="markdown-render">
      {segments.map((seg, i) =>
        seg.kind === 'mermaid'
          ? <MermaidPlaceholder key={i} source={seg.text} />
          : <Streamdown key={i} parseIncompleteMarkdown shikiTheme={undefined}>
              {seg.text}
            </Streamdown>
      )}
    </div>
  );
};

// Kind-aware body renderer.
//   note   → MarkdownNoteRenderer (Streamdown + mermaid extraction)
//   code   → Monospace with line numbers + minimal syntax highlighting
//   config → Plain <pre> monospace
const SnippetBodyRenderer = ({ snippet }) => {
  if (!snippet) return null;
  if (snippet.kind === 'code') {
    return <CodeRenderer body={snippet.body || ''} />;
  }
  if (snippet.kind === 'note') {
    return <MarkdownNoteRenderer body={snippet.body || ''} />;
  }
  return (
    <pre className="flex-1 text-[11px] font-mono overflow-auto p-2 rounded whitespace-pre-wrap"
         style={{ background: COLORS.surface, color: COLORS.text }}>
      {snippet.body}
    </pre>
  );
};

// Line-level diff (longest common subsequence). Returns an array of
// rows, each tagged 'common' / 'mine' / 'theirs' for side-by-side
// rendering. Phase 3p.15 / Feature 2.
//
// This is a small implementation chosen for clarity over performance.
// Bodies up to a few thousand lines render instantly. For pathological
// cases (huge bodies with many small differences), we degrade gracefully
// to character-level placement rather than blowing the LCS table size.
const diffLines = (mineText, theirsText) => {
  const mine   = (mineText   || '').split('\n');
  const theirs = (theirsText || '').split('\n');

  // Hard cap to avoid quadratic blowup on huge texts
  const MAX_LCS = 1500;
  if (mine.length > MAX_LCS || theirs.length > MAX_LCS) {
    // Bail to a coarse "everything is different" view
    return [
      ...mine.map(line => ({ kind: 'mine',   line })),
      ...theirs.map(line => ({ kind: 'theirs', line })),
    ];
  }

  // LCS DP table — store lengths only, then walk back
  const m = mine.length, n = theirs.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (mine[i] === theirs[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (mine[i] === theirs[j]) {
      out.push({ kind: 'common', line: mine[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'mine', line: mine[i] });
      i++;
    } else {
      out.push({ kind: 'theirs', line: theirs[j] });
      j++;
    }
  }
  while (i < m) out.push({ kind: 'mine',   line: mine[i++] });
  while (j < n) out.push({ kind: 'theirs', line: theirs[j++] });
  return out;
};

const DIFF_COLORS = {
  mine:   { bg: 'rgba(255, 100, 100, 0.10)', mark: '−', col: '#FF8888' },
  theirs: { bg: 'rgba(100, 255, 150, 0.10)', mark: '+', col: '#88EE99' },
  common: { bg: 'transparent',                mark: ' ', col: undefined },
};

const ConflictDiffView = ({ mine, theirs }) => {
  const rows = useMemo(() => diffLines(mine, theirs), [mine, theirs]);
  return (
    <div className="rounded text-[10px] font-mono overflow-auto max-h-48"
         data-testid="conflict-diff"
         style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {rows.map((r, idx) => {
            const cfg = DIFF_COLORS[r.kind];
            return (
              <tr key={idx} style={{ background: cfg.bg }}>
                <td className="select-none px-1 align-top whitespace-pre"
                    style={{ color: cfg.col, width: 18, userSelect: 'none' }}>
                  {cfg.mark}
                </td>
                <td className="px-1 align-top whitespace-pre">{r.line}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// Tag normalization — lowercase, strip whitespace, dedupe.
const normalizeTags = (tags) => {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const norm = String(t || '').trim().toLowerCase();
    if (!norm) continue;
    if (norm.length > 30) continue;        // sanity cap
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
};

// TagEditor — tokenized input where users type tags + comma/Enter to add.
// Backspace on empty input removes the last tag. Space collapses to dash.
// Phase 3p.15 / Feature 3.
const TagEditor = ({ tags = [], onChange }) => {
  const [draft, setDraft] = useState('');
  const safe = useMemo(() => normalizeTags(tags), [tags]);

  const commit = (raw) => {
    const t = String(raw || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!t) return;
    const next = normalizeTags([...safe, t]);
    onChange(next);
    setDraft('');
  };

  const removeAt = (idx) => {
    const next = safe.filter((_, i) => i !== idx);
    onChange(next);
  };

  return (
    <div className="flex items-center gap-1 flex-wrap rounded px-1.5 py-1"
         data-testid="tag-editor"
         style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
      {safe.map((t, i) => (
        <span key={`${t}-${i}`}
              className="px-1.5 py-0.5 rounded text-[10px] inline-flex items-center gap-1"
              data-testid={`tag-${t}`}
              style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
          {t}
          <button onClick={() => removeAt(i)}
                  aria-label={`Remove tag ${t}`}
                  className="text-[10px] leading-none"
                  style={{ color: COLORS.textMute, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
            ×
          </button>
        </span>
      ))}
      <input value={draft}
             onChange={(e) => setDraft(e.target.value)}
             onKeyDown={(e) => {
               if (e.key === 'Enter' || e.key === ',') {
                 e.preventDefault();
                 commit(draft);
               } else if (e.key === 'Backspace' && draft === '' && safe.length > 0) {
                 e.preventDefault();
                 removeAt(safe.length - 1);
               }
             }}
             onBlur={() => { if (draft.trim()) commit(draft); }}
             placeholder={safe.length === 0 ? 'Add tag…' : ''}
             data-testid="tag-input"
             className="flex-1 min-w-[80px] px-1 py-0.5 text-[10px] outline-none"
             style={{ background: 'transparent', color: COLORS.text, border: 'none' }} />
    </div>
  );
};

// Filter strip showing all tags across the snippet collection with
// counts. Clicking toggles selection; multiple selected tags AND-filter.
const TagFilterStrip = ({ snippets, selected, onChange }) => {
  const counts = useMemo(() => {
    const m = new Map();
    for (const s of snippets) {
      for (const t of normalizeTags(s.tags || [])) {
        m.set(t, (m.get(t) || 0) + 1);
      }
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [snippets]);

  if (counts.length === 0) return null;

  const toggle = (t) => {
    const set = new Set(selected);
    if (set.has(t)) set.delete(t);
    else set.add(t);
    onChange(Array.from(set));
  };

  return (
    <div className="flex items-center gap-1 flex-wrap" data-testid="tag-filter">
      {counts.map(([t, n]) => {
        const active = selected.includes(t);
        return (
          <button key={t}
                  onClick={() => toggle(t)}
                  data-testid={`tag-filter-${t}`}
                  className="px-1.5 py-0.5 rounded text-[10px]"
                  style={{
                    background: active ? COLORS.mint : 'transparent',
                    color:      active ? COLORS.bg   : COLORS.text,
                    border:     `1px solid ${active ? COLORS.mint : COLORS.border}`,
                    cursor: 'pointer',
                  }}>
            {t} <span style={{ opacity: 0.6 }}>({n})</span>
          </button>
        );
      })}
      {selected.length > 0 && (
        <button onClick={() => onChange([])}
                className="px-1.5 py-0.5 rounded text-[10px]"
                style={{ background: 'transparent', color: COLORS.textMute, border: `1px solid ${COLORS.border}`, cursor: 'pointer' }}>
          Clear
        </button>
      )}
    </div>
  );
};

export const SnippetsPanel = ({ executorUrl, getToken }) => {
  const resolvedUrl = executorUrl !== undefined ? executorUrl : defaultExecutorUrl();
  const resolvedGetToken = getToken !== undefined ? getToken : defaultGetToken;
  const [snippets, setSnippets] = useState([]);
  const [activeId, setActiveId] = useState(null);  // client_id of selected
  const [editing, setEditing]   = useState(null);  // snippet being edited (or null)
  const [conflict, setConflict] = useState(null);  // { local, server } or null
  const [syncStatus, setSyncStatus] = useState({
    lastSync: null, syncing: false, error: null, dirtyCount: 0,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  // Stable client reference. We rebuild only when resolvedUrl changes
  // because token changes need to be reflected via getToken() at
  // call-time, not at construction.
  const clientRef = useRef(null);
  if (!clientRef.current || clientRef.current._executorUrl !== resolvedUrl) {
    const client = makeSnippetsClient({
      baseUrl: resolvedUrl,
      getToken: resolvedGetToken,
      onConflict: ({ local, server }) => {
        setConflict({ local, server });
      },
    });
    client._executorUrl = resolvedUrl;
    clientRef.current = client;
  }

  const refresh = () => {
    const list = clientRef.current.list();
    setSnippets(list);
    setSyncStatus(prev => ({ ...prev, dirtyCount: list.filter(s => s.dirty).length }));
  };

  useEffect(() => { refresh(); }, []);

  // Live updates from the storage layer (CustomEvent dispatched by the
  // sync client whenever it writes to localStorage)
  useEffect(() => {
    const handler = () => refresh();
    if (typeof window !== 'undefined') {
      window.addEventListener('imo:snippets-changed', handler);
      return () => window.removeEventListener('imo:snippets-changed', handler);
    }
  }, []);

  // Auto-sync timer + SSE subscription for real-time push
  useEffect(() => {
    if (!resolvedUrl) return;
    const tick = async () => {
      setSyncStatus(prev => ({ ...prev, syncing: true, error: null }));
      try {
        const r = await clientRef.current.sync();
        setSyncStatus({
          lastSync: Date.now(),
          syncing: false,
          error: r.ok ? null : r.error,
          dirtyCount: clientRef.current.list().filter(s => s.dirty).length,
        });
        refresh();
      } catch (err) {
        setSyncStatus(prev => ({ ...prev, syncing: false, error: String(err) }));
      }
    };
    tick();
    // Real-time push via SSE (Phase 3p.13). Updates arrive instantly;
    // the 60s poll below is a fallback for SSE-unavailable environments.
    const unsubscribe = typeof clientRef.current.subscribe === 'function'
      ? clientRef.current.subscribe({ onEvent: () => refresh() })
      : () => {};
    const id = setInterval(tick, 60_000);
    return () => {
      clearInterval(id);
      try { unsubscribe(); } catch {}
    };
  }, [resolvedUrl]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    let list = snippets;
    if (q) {
      list = list.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.body  || '').toLowerCase().includes(q)
      );
    }
    if (selectedTags.length > 0) {
      // AND-filter: snippet must have ALL selected tags
      list = list.filter(s => {
        const norm = normalizeTags(s.tags || []);
        return selectedTags.every(t => norm.includes(t));
      });
    }
    return list.sort((a, b) =>
      new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    );
  }, [snippets, searchTerm, selectedTags]);

  // When search filters out the active snippet, clear the viewer
  // rather than continuing to show a filtered-out item — better UX,
  // and makes the search state honest.
  const active = filtered.find(s => s.client_id === activeId);

  const startNew = () => {
    setEditing({ client_id: null, title: '', body: '', kind: 'note', tags: [] });
    setActiveId(null);
    setTemplatePickerOpen(false);
  };

  const startFromTemplate = (templateId) => {
    const seed = applyTemplate(templateId);
    if (!seed) return;
    setEditing({ client_id: null, ...seed });
    setActiveId(null);
    setTemplatePickerOpen(false);
  };

  const startEdit = (snippet) => {
    setEditing({
      client_id: snippet.client_id,
      title:     snippet.title,
      body:      snippet.body,
      kind:      snippet.kind || 'note',
      tags:      snippet.tags || [],
    });
    setActiveId(snippet.client_id);
  };

  const saveSnippet = async () => {
    if (!editing) return;
    const trimmedTitle = editing.title.trim();
    if (!trimmedTitle) return;
    const r = await clientRef.current.save({
      client_id: editing.client_id,
      title:     trimmedTitle,
      body:      editing.body,
      kind:      editing.kind,
      tags:      editing.tags,
    });
    try {
      appendAuditEntry({
        category: 'system',
        action:   editing.client_id ? 'snippet-updated' : 'snippet-created',
        target:   r?.snippet?.client_id ?? null,
        details:  { title: trimmedTitle, kind: editing.kind },
      });
    } catch {}
    if (r?.snippet?.client_id) setActiveId(r.snippet.client_id);
    setEditing(null);
    refresh();
  };

  const deleteSnippet = async (snippet) => {
    if (!snippet?.client_id) return;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm(`Delete "${snippet.title}"?`)) return;
    }
    await clientRef.current.delete(snippet.client_id);
    try {
      appendAuditEntry({
        category: 'system', action: 'snippet-deleted',
        target: snippet.client_id, details: { title: snippet.title },
      });
    } catch {}
    if (activeId === snippet.client_id) setActiveId(null);
    refresh();
  };

  const manualSync = async () => {
    if (!resolvedUrl) return;
    setSyncStatus(prev => ({ ...prev, syncing: true, error: null }));
    const r = await clientRef.current.sync();
    setSyncStatus({
      lastSync: Date.now(),
      syncing: false,
      error: r.ok ? null : r.error,
      dirtyCount: clientRef.current.list().filter(s => s.dirty).length,
    });
    refresh();
  };

  const resolveConflict = async (winner) => {
    if (!conflict) return;
    if (winner === 'mine') {
      // Re-save local, bumping the version to match the server then +1
      // so the next push wins. We do this by setting the local version
      // to the server version (so the version-check passes) before save.
      await clientRef.current.save({
        ...conflict.local,
        version: conflict.server.version,
      });
    } else if (winner === 'theirs') {
      // Take server copy verbatim — overwrite local.
      await clientRef.current.save({
        ...conflict.server,
        version: conflict.server.version,
      });
    }
    setConflict(null);
    refresh();
  };

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[14px] font-medium" style={{ color: COLORS.text }}>Snippets</div>
        <div className="text-[11px] mt-0.5" style={{ color: COLORS.textDim }}>
          Cloud-synced notes, code, and config snippets. Stored locally and pushed to the executor when configured.
          Last write wins; conflicts surface a resolution dialog.
        </div>
      </div>

      {/* Sync status row */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]" style={{ color: COLORS.textDim }}>
        {!resolvedUrl ? (
          <span style={{ color: COLORS.textMute }}>
            No executor configured — snippets are saved locally only.
          </span>
        ) : (
          <>
            <span data-testid="sync-status">
              {syncStatus.syncing
                ? 'Syncing…'
                : syncStatus.lastSync
                  ? `Last sync: ${fmtRelativeTime(new Date(syncStatus.lastSync).toISOString())}`
                  : 'Not synced yet'}
            </span>
            {syncStatus.dirtyCount > 0 && (
              <span style={{ color: COLORS.amber ?? COLORS.text }}>
                · {syncStatus.dirtyCount} unsynced
              </span>
            )}
            {syncStatus.error && (
              <span style={{ color: COLORS.red }}>· {syncStatus.error}</span>
            )}
            <button onClick={manualSync}
                    disabled={syncStatus.syncing}
                    data-testid="sync-now"
                    className="px-2 py-0.5 rounded text-[11px]"
                    style={{
                      background: 'transparent', color: COLORS.text,
                      border: `1px solid ${COLORS.border}`,
                      cursor: syncStatus.syncing ? 'not-allowed' : 'pointer',
                    }}>
              Sync now
            </button>
          </>
        )}
      </div>

      {/* Search + new */}
      <div className="flex items-center gap-2">
        <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
               placeholder="Search snippets…"
               data-testid="search-input"
               className="flex-1 px-2 py-1 rounded text-[11px] outline-none"
               style={{ background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
        <button onClick={startNew}
                data-testid="new-snippet"
                className="px-2.5 py-1 rounded text-[11px] font-medium"
                style={{ background: COLORS.mint, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
          + New
        </button>
        <button onClick={() => setTemplatePickerOpen(o => !o)}
                data-testid="open-template-picker"
                className="px-2.5 py-1 rounded text-[11px]"
                style={{ background: 'transparent', color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
          + Template
        </button>
      </div>

      {/* Template picker overlay */}
      {templatePickerOpen && (
        <div data-testid="template-picker"
             className="rounded p-2 space-y-1"
             style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
          <div className="text-[10px] uppercase tracking-wider mb-1"
               style={{ color: COLORS.textMute }}>
            Insert from template
          </div>
          {listTemplates().map(tpl => (
            <button key={tpl.id}
                    onClick={() => startFromTemplate(tpl.id)}
                    data-testid={`template-${tpl.id}`}
                    className="w-full text-left px-2 py-1 rounded text-[11px] flex items-center gap-2"
                    style={{ background: 'transparent', color: COLORS.text, border: `1px solid ${COLORS.border}`, cursor: 'pointer' }}>
              <span className="px-1 rounded text-[9px]"
                    style={{ background: COLORS.bg, color: COLORS.textMute, border: `1px solid ${COLORS.border}` }}>
                {tpl.kind}
              </span>
              {tpl.label}
            </button>
          ))}
          <button onClick={() => setTemplatePickerOpen(false)}
                  data-testid="close-template-picker"
                  className="w-full px-2 py-0.5 text-[10px]"
                  style={{ background: 'transparent', color: COLORS.textMute, border: 'none', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      )}

      {/* Tag filter strip — appears only when at least one tag exists */}
      <TagFilterStrip
        snippets={snippets}
        selected={selectedTags}
        onChange={setSelectedTags}
      />

      {/* List + editor */}
      <div className="grid grid-cols-[200px_1fr] gap-2 min-h-[260px]">
        {/* List */}
        <div className="rounded overflow-hidden" style={{ border: `1px solid ${COLORS.border}` }}>
          {filtered.length === 0 ? (
            <div className="p-3 text-center text-[11px]"
                 style={{ color: COLORS.textDim, background: COLORS.surface }}>
              {searchTerm ? 'No matches.' : 'No snippets yet — click + New.'}
            </div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto" style={{ background: COLORS.bg }}>
              {filtered.map(s => (
                <button key={s.client_id}
                        onClick={() => { setActiveId(s.client_id); setEditing(null); }}
                        data-testid={`snippet-${s.client_id}`}
                        className="w-full text-left px-2 py-1.5 text-[11px] block"
                        style={{
                          background: activeId === s.client_id ? COLORS.surface : 'transparent',
                          borderBottom: `1px solid ${COLORS.border}`,
                          color: COLORS.text,
                        }}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-medium truncate flex-1">{s.title}</span>
                    {s.dirty && <span title="Not yet synced"
                                      style={{ color: COLORS.amber ?? COLORS.text, fontSize: 8 }}>●</span>}
                  </div>
                  <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                    {KIND_LABELS[s.kind] || s.kind} · {fmtRelativeTime(s.updated_at)}
                  </div>
                  {Array.isArray(s.tags) && s.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {normalizeTags(s.tags).slice(0, 4).map(t => (
                        <span key={t} className="px-1 rounded text-[9px]"
                              style={{ background: COLORS.surface, color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
                          {t}
                        </span>
                      ))}
                      {s.tags.length > 4 && (
                        <span className="text-[9px]" style={{ color: COLORS.textMute }}>
                          +{s.tags.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Editor / viewer */}
        <div className="rounded p-2.5 flex flex-col gap-2"
             style={{ border: `1px solid ${COLORS.border}`, background: COLORS.bg }}>
          {editing ? (
            <>
              <input value={editing.title}
                     onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                     placeholder="Title"
                     data-testid="editor-title"
                     className="px-2 py-1 rounded text-[12px] font-medium outline-none"
                     style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              <select value={editing.kind}
                      onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
                      data-testid="editor-kind"
                      className="px-2 py-1 rounded text-[11px] w-32"
                      style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                <option value="note">Note</option>
                <option value="code">Code</option>
                <option value="config">Config</option>
              </select>
              <TagEditor
                tags={editing.tags || []}
                onChange={(tags) => setEditing({ ...editing, tags })}
              />
              <textarea value={editing.body}
                        onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                        placeholder="Body…"
                        data-testid="editor-body"
                        rows={10}
                        className="px-2 py-1 rounded text-[11px] font-mono outline-none flex-1"
                        style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}` }} />
              <div className="flex items-center gap-2">
                <button onClick={saveSnippet}
                        disabled={!editing.title.trim()}
                        data-testid="save-snippet"
                        className="px-2.5 py-1 rounded text-[11px] font-medium"
                        style={{
                          background: !editing.title.trim() ? COLORS.surface : COLORS.mint,
                          color:      !editing.title.trim() ? COLORS.textMute : COLORS.text,
                          border:     `1px solid ${COLORS.border}`,
                          cursor:     !editing.title.trim() ? 'not-allowed' : 'pointer',
                        }}>
                  Save
                </button>
                <button onClick={() => setEditing(null)}
                        data-testid="cancel-edit"
                        className="px-2.5 py-1 rounded text-[11px]"
                        style={{ background: 'transparent', color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                  Cancel
                </button>
              </div>
            </>
          ) : active ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-medium" style={{ color: COLORS.text }}>
                  {active.title}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => startEdit(active)}
                          data-testid="edit-snippet"
                          className="px-2 py-0.5 rounded text-[10px]"
                          style={{ background: 'transparent', color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                    Edit
                  </button>
                  <button onClick={() => deleteSnippet(active)}
                          data-testid="delete-snippet"
                          className="px-2 py-0.5 rounded text-[10px]"
                          style={{ background: 'transparent', color: COLORS.red, border: `1px solid ${COLORS.border}` }}>
                    Delete
                  </button>
                </div>
              </div>
              <div className="text-[9.5px]" style={{ color: COLORS.textMute }}>
                {KIND_LABELS[active.kind] || active.kind} · {fmtRelativeTime(active.updated_at)}
                {active.dirty && ' · unsynced'}
              </div>
              <SnippetBodyRenderer snippet={active} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11px]"
                 style={{ color: COLORS.textDim }}>
              Pick a snippet from the list, or click + New.
            </div>
          )}
        </div>
      </div>

      {/* Conflict resolver */}
      {conflict && (
        <div data-testid="conflict-resolver"
             className="rounded p-3 space-y-2"
             style={{
               background: COLORS.surface,
               border: `1px solid ${COLORS.red}`,
               color: COLORS.text,
             }}>
          <div className="text-[12px] font-medium" style={{ color: COLORS.red }}>
            ⚠ Sync conflict on "{conflict.local.title}"
          </div>
          <div className="text-[11px]" style={{ color: COLORS.textDim }}>
            The server has a newer version. Below is a line-by-line diff
            (red = yours only, green = server only, white = unchanged).
            Pick which side wins; the other is overwritten.
          </div>

          <ConflictDiffView mine={conflict.local.body} theirs={conflict.server.body} />

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded p-2"
                 style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
              <div className="text-[10px] uppercase tracking-wider mb-1"
                   style={{ color: COLORS.textMute }}>Yours</div>
              <div className="text-[11px] font-medium mb-0.5">{conflict.local.title}</div>
              <div className="text-[9.5px]" style={{ color: COLORS.textDim }}>
                {(conflict.local.body || '').split('\n').length} lines
              </div>
              <button onClick={() => resolveConflict('mine')}
                      data-testid="keep-mine"
                      className="mt-2 px-2 py-0.5 rounded text-[11px]"
                      style={{ background: COLORS.mint, color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                Keep mine
              </button>
            </div>
            <div className="rounded p-2"
                 style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}` }}>
              <div className="text-[10px] uppercase tracking-wider mb-1"
                   style={{ color: COLORS.textMute }}>Theirs (server)</div>
              <div className="text-[11px] font-medium mb-0.5">{conflict.server.title}</div>
              <div className="text-[9.5px]" style={{ color: COLORS.textDim }}>
                {(conflict.server.body || '').split('\n').length} lines
              </div>
              <button onClick={() => resolveConflict('theirs')}
                      data-testid="take-theirs"
                      className="mt-2 px-2 py-0.5 rounded text-[11px]"
                      style={{ background: 'transparent', color: COLORS.text, border: `1px solid ${COLORS.border}` }}>
                Take theirs
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
