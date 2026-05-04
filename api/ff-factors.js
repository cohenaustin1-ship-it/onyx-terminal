// ─── Vercel serverless proxy for Kenneth French factor data ─────────
//
// Phase 3o.86 — closes the long-deferred "live FF factors" item.
// The 5-factor daily CSV at Tuck/Dartmouth is published as a ZIP that
// browsers can't fetch directly (Tuck doesn't serve CORS, and the file
// is binary-zipped). This serverless function:
//
//   1. Fetches the official Tuck ZIP
//   2. Extracts the CSV from the first ZIP entry using a minimal
//      inline parser (DEFLATE via Node's built-in zlib — no new deps)
//   3. Parses the daily factor rows (skipping French's header preamble)
//   4. Returns a clean JSON array: [{date, mktrf, smb, hml, rmw, cma, rf}]
//
// Setup:
//   This function ships with the project; no env vars needed.
//   Tuck publishes the file freely; we cache 24h via Vercel cache headers.
//
// Honest scope:
//   - Tuck updates monthly. Live freshness is ~30d at most; for daily
//     factors more recent than the last update, ETF proxies remain.
//   - The minimal ZIP parser handles the standard Tuck format (single
//     deflate entry, no encryption, no multi-disk). If Tuck ever changes
//     format, this falls through; the SPA falls back to ETF proxies.

import { inflateRawSync } from 'node:zlib';

const TUCK_URL = 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_daily_CSV.zip';

// Minimal ZIP local-file-header parser. Tuck's CSV is a single entry,
// stored deflated. We scan for the local-file-header signature
// (0x04034b50), read the entry's compressed bytes, inflate them, and
// return the resulting string. Robust enough for the Tuck format.
function extractFirstZipEntryToString(zipBuffer) {
  const buf = Buffer.from(zipBuffer);
  const SIG = 0x04034b50;
  if (buf.readUInt32LE(0) !== SIG) {
    throw new Error('Not a ZIP — magic mismatch');
  }
  // Local file header layout (offset → size in bytes):
  //   0  →  4  signature
  //   4  →  2  version
  //   6  →  2  flags
  //   8  →  2  compression method (8 = deflate)
  //   10 →  4  mod time/date
  //   14 →  4  CRC32
  //   18 →  4  compressed size
  //   22 →  4  uncompressed size
  //   26 →  2  filename length
  //   28 →  2  extra field length
  //   30 →  filename + extra field + compressed data
  const compressionMethod = buf.readUInt16LE(8);
  const compressedSize = buf.readUInt32LE(18);
  const filenameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const dataOffset = 30 + filenameLen + extraLen;
  const compressed = buf.slice(dataOffset, dataOffset + compressedSize);
  if (compressionMethod === 0) {
    return compressed.toString('utf8');
  }
  if (compressionMethod === 8) {
    const inflated = inflateRawSync(compressed);
    return inflated.toString('utf8');
  }
  throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
}

// Parse Tuck's daily CSV. Format (after preamble):
//   YYYYMMDD,MktRF,SMB,HML,RMW,CMA,RF
// Values are in *percent* (e.g. 0.50 means +0.50%). We convert to
// decimal returns for downstream use.
function parseFFDailyCSV(csv) {
  const lines = csv.split(/\r?\n/);
  const out = [];
  let inData = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Header row starts when we see the column labels
    if (!inData) {
      if (/^\s*,?\s*Mkt-?RF/i.test(line)) { inData = true; continue; }
      continue;
    }
    // Data rows start with 8-digit YYYYMMDD; skip footer / monthly section
    const parts = line.split(',').map(s => s.trim());
    if (parts.length < 7) continue;
    if (!/^\d{8}$/.test(parts[0])) continue;
    const d = parts[0];
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const mktrf = Number(parts[1]) / 100;
    const smb   = Number(parts[2]) / 100;
    const hml   = Number(parts[3]) / 100;
    const rmw   = Number(parts[4]) / 100;
    const cma   = Number(parts[5]) / 100;
    const rf    = Number(parts[6]) / 100;
    if (![mktrf, smb, hml, rmw, cma, rf].every(Number.isFinite)) continue;
    out.push({ date, mktrf, smb, hml, rmw, cma, rf });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const upstream = await fetch(TUCK_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OnyxTerminal/1.0)' },
    });
    if (!upstream.ok) {
      res.status(502).json({
        error: `Tuck upstream returned HTTP ${upstream.status}`,
        url: TUCK_URL,
      });
      return;
    }
    const zipBuffer = await upstream.arrayBuffer();
    const csv = extractFirstZipEntryToString(zipBuffer);
    const rows = parseFFDailyCSV(csv);
    if (rows.length === 0) {
      res.status(502).json({ error: 'Parsed zero rows from Tuck CSV' });
      return;
    }
    // Cache aggressively — Tuck updates monthly. 24h browser cache,
    // 7d edge cache. Matches Vercel ISR-style for static-ish data.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    res.status(200).json({
      source: 'tuck-french-data-library',
      count: rows.length,
      asOf: rows[rows.length - 1]?.date,
      rows,
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Unknown error', stack: String(e?.stack || '').slice(0, 500) });
  }
}
