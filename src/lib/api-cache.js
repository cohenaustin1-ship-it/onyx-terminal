// IMO Onyx Terminal — shared in-memory TTL cache
//
// Phase 3p.17 file-splitting / extracted from JPMOnyxTerminal.jsx.
// Originally inlined as `cacheGet`/`cacheSet` near the external-data
// fetchers. Many other parts of the monolith (broker providers, AI
// call layer, Polygon fetchers, search) also use it, so we extract
// it first as its own module and have callers import from here.
//
// One process-wide Map. Each value is `{ t, v }` — the timestamp at
// insertion and the value. cacheGet checks TTL on access; expired
// entries are deleted on read. Not LRU-bounded — entries linger in
// memory until they're either re-fetched (overwritten) or expire and
// get touched. For the volumes this app handles (a few hundred keys
// at most, none of them huge), bounded LRU isn't worth the complexity.
//
// Honest scope:
//   - In-memory only (per browser tab). No persistence; reload clears it.
//   - Not safe for concurrent writers (though JS is single-threaded
//     within a tab, so this is moot in practice).
//   - TTL is checked on read, not via timer — entries that nothing
//     touches before they expire just sit until something asks for them.

export const _apiCache = new Map();

export const cacheGet = (key, ttlMs) => {
  const hit = _apiCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > ttlMs) {
    _apiCache.delete(key);
    return null;
  }
  return hit.v;
};

export const cacheSet = (key, value) => {
  _apiCache.set(key, { t: Date.now(), v: value });
};

// Test/debug aid — not used in normal app flow.
export const _cacheClear = () => _apiCache.clear();
export const _cacheSize = () => _apiCache.size;
