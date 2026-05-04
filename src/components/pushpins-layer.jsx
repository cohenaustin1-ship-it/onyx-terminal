// IMO Onyx Terminal — pushpin annotation layer
//
// Phase 3p.17 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines ~877-1031).
//
// Lets users alt-click anywhere on a page to drop a sticky pin with
// a short text note. Pins are stored in localStorage (`imo_pushpins`),
// scoped per page (page id is what distinguishes one rendering surface
// from another). Click-to-edit, drag to move. Pure UI, no external
// dependencies beyond React.
//
// Honest scope:
//   - localStorage only — pins don't sync between devices. The cloud
//     storage path that exists for snippets isn't extended here yet.
//   - x/y are stored as fractional viewport coordinates (0..1) so
//     pins survive resizes. They DON'T survive layout changes that
//     move content (e.g. opening a side panel that reflows the page).
//   - No conflict handling for multi-tab editing of the same page.

import React, { useState, useEffect, useRef } from 'react';

const KEY = 'imo_pushpins';

// usePushpins — hook reading/writing the pin list for a given page
// from localStorage. The `page` prop is just a string key the caller
// uses to scope pins per surface.
const usePushpins = (page) => {
  const [pins, setPins] = useState(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  const persist = (next) => {
    setPins(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  };
  const addPin = (xFrac, yFrac, opts = {}) => {
    const pin = {
      id: `pin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      page,
      x: xFrac,
      y: yFrac,
      text: opts.text ?? '',
      color: opts.color ?? '#FFD60A',
      createdAt: Date.now(),
    };
    persist([...pins, pin]);
    return pin.id;
  };
  const updatePin = (id, patch) => persist(pins.map(p => p.id === id ? { ...p, ...patch } : p));
  const removePin = (id) => persist(pins.filter(p => p.id !== id));
  const visiblePins = pins.filter(p => p.page === page);
  return { pins: visiblePins, addPin, updatePin, removePin };
};

export const PushpinsLayer = ({ page }) => {
  const { pins, addPin, updatePin, removePin } = usePushpins(page);
  const [editingId, setEditingId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const layerRef = useRef(null);

  // Alt+click on the layer drops a new pin. Layer is
  // pointer-events:none by default, so we install the listener on
  // the window and check the modifier; the pin children re-enable
  // their own pointer events.
  useEffect(() => {
    const onClick = (e) => {
      if (!e.altKey) return;
      // Skip if click was on an interactive element (input, button)
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') return;
      e.preventDefault();
      const xFrac = e.clientX / window.innerWidth;
      const yFrac = e.clientY / window.innerHeight;
      const id = addPin(xFrac, yFrac);
      setEditingId(id);
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [addPin]);

  // Drag handler — listen to global mousemove while a pin is being
  // dragged. Update position in fractional coords as the cursor
  // moves; release on mouseup.
  useEffect(() => {
    if (!draggingId) return;
    const onMove = (e) => {
      const xFrac = Math.max(0, Math.min(1, e.clientX / window.innerWidth));
      const yFrac = Math.max(0, Math.min(1, e.clientY / window.innerHeight));
      updatePin(draggingId, { x: xFrac, y: yFrac });
    };
    const onUp = () => setDraggingId(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingId, updatePin]);

  return (
    <div ref={layerRef}
         className="fixed inset-0 z-[150]"
         style={{ pointerEvents: 'none' }}>
      {pins.map(pin => (
        <div key={pin.id}
             className="absolute"
             style={{
               left: `${pin.x * 100}%`,
               top:  `${pin.y * 100}%`,
               pointerEvents: 'auto',
               transform: 'translate(-8px, -8px)',
             }}>
          {/* Pushpin "head" — small colored disk that acts as the
              grip for dragging. Click toggles edit mode. */}
          <div className="relative"
               style={{
                 background: pin.color,
                 width: 16, height: 16, borderRadius: '50%',
                 border: '2px solid rgba(0,0,0,0.4)',
                 boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                 cursor: draggingId === pin.id ? 'grabbing' : 'grab',
               }}
               onMouseDown={(e) => { e.stopPropagation(); setDraggingId(pin.id); }}
               onClick={(e) => { e.stopPropagation(); setEditingId(pin.id === editingId ? null : pin.id); }}
               title="Drag to move · click to edit">
          </div>
          {/* Note body — only visible when editing or has text */}
          {(editingId === pin.id || pin.text) && (
            <div className="absolute mt-1 rounded shadow-lg p-2"
                 style={{
                   left: 18, top: 0,
                   width: 220,
                   background: pin.color,
                   color: '#0F172A',
                   fontSize: 11.5,
                   border: '1px solid rgba(0,0,0,0.15)',
                 }}>
              {editingId === pin.id ? (
                <>
                  <textarea autoFocus
                            value={pin.text}
                            onChange={e => updatePin(pin.id, { text: e.target.value })}
                            onBlur={() => setEditingId(null)}
                            placeholder="Note…"
                            rows={3}
                            className="w-full bg-transparent outline-none resize-none"
                            style={{ color: '#0F172A' }} />
                  <div className="flex items-center justify-between mt-1.5">
                    {/* Color picker — small swatches */}
                    <div className="flex gap-1">
                      {['#FFD60A', '#FF6B6B', '#3BC4D7', '#7CFC9D', '#FFA94D'].map(c => (
                        <button key={c}
                                onClick={(e) => { e.stopPropagation(); updatePin(pin.id, { color: c }); }}
                                className="w-3.5 h-3.5 rounded-full border"
                                style={{ background: c, borderColor: pin.color === c ? '#0F172A' : 'rgba(0,0,0,0.15)' }} />
                      ))}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); removePin(pin.id); setEditingId(null); }}
                            className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: 'rgba(0,0,0,0.12)', color: '#0F172A' }}>
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <div onClick={(e) => { e.stopPropagation(); setEditingId(pin.id); }}
                     className="cursor-text whitespace-pre-wrap leading-snug">
                  {pin.text}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
