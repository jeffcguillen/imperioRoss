import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { z } from 'zod';

if (process.env.NODE_ENV !== 'development') throw new Error('Demo seed only runs with NODE_ENV=development.');
const connectionString = z.string().url().parse(process.env.DATABASE_MIGRATOR_URL);
const pool = new pg.Pool({ connectionString, max: 1, application_name: 'imperio-ross-demo-seed', options: '-c search_path=app,public' });
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.environment', 'development', true)");
    await client.query(await readFile('database/seeds/demo_b.sql', 'utf8'));
    await client.query('COMMIT');
    console.log('Development tenant demo-b is ready.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
} finally { await pool.end(); }
