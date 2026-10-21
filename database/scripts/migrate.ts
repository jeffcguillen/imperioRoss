import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { z } from 'zod';

const connectionString = z.string().url().parse(process.env.DATABASE_MIGRATOR_URL);
const { Pool } = pg;
const pool = new Pool({ connectionString, max: 1, application_name: 'imperio-ross-migrator', options: '-c search_path=app,public' });
const directory = resolve('database/migrations');
const files = (await readdir(directory)).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
if (!files.length || files[0] !== '0001_schema_migrations.sql') throw new Error('Missing version table migration.');

const client = await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock(hashtext($1))', ['imperio-ross-migrations']);
  for (const file of files) {
    const sql = await readFile(join(directory, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const tracker = await client.query<{ exists: boolean }>("SELECT to_regclass('app.schema_migrations') IS NOT NULL AS exists");
    const exists = tracker.rows[0]?.exists ?? false;
    if (exists) {
      const applied = await client.query<{ checksum_sha256: string }>('SELECT checksum_sha256 FROM app.schema_migrations WHERE version = $1', [file]);
      if (applied.rows[0]) {
        if (applied.rows[0].checksum_sha256 !== checksum) throw new Error(`Applied migration checksum changed: ${file}`);
        continue;
      }
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      if (file !== '0001_schema_migrations.sql' || exists) {
        await client.query('INSERT INTO app.schema_migrations (version, checksum_sha256) VALUES ($1, $2)', [file, checksum]);
      } else {
        await client.query('INSERT INTO app.schema_migrations (version, checksum_sha256) VALUES ($1, $2)', [file, checksum]);
      }
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}
