// ─── Postgres connection pool + schema bootstrap ─────────────────────────────
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // small pool for now — adjust based on load
  max: 10,
  idleTimeoutMillis: 30000,
});

export async function query(sql, params = []) {
  return pool.query(sql, params);
}

export async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function initSchema() {
  // schema.sql lives at ../schema.sql relative to src/
  const schemaPath = path.resolve(__dirname, '..', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  console.log('[db] schema applied');
}

export async function shutdown() {
  await pool.end();
}
