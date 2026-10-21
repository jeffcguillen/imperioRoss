import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { getSupabaseConnection } from './supabase-connection.js';

if (process.env.SUPABASE_INSTALL_EMPTY_DB !== 'YES') {
  throw new Error('Instalación cancelada. Confirma una base Supabase nueva con SUPABASE_INSTALL_EMPTY_DB=YES en .local/supabase.env.');
}

const { connectionString, projectRef } = getSupabaseConnection();
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, application_name: 'imperio-ross-supabase-installer' });
try {
  const client = await pool.connect();
  try {
    const identity = await client.query<{ database: string; schemaAvailable: boolean }>(
      "SELECT current_database() AS database, to_regnamespace('app') IS NULL AS \"schemaAvailable\"",
    );
    if (identity.rows[0]?.database !== 'postgres' || !identity.rows[0]?.schemaAvailable) {
      throw new Error('La base no parece vacía: se esperaba la base postgres sin esquema app. No se modificó nada.');
    }

    const sql = await readFile(resolve('imperio_de_ross_completo.sql'), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`Esquema base y datos DEMO instalados en Supabase (${projectRef}).`);
      console.log('Siguiente paso: npm run db:migrate:supabase');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
