import { getSupabaseConnection } from './supabase-connection.js';

const { connectionString } = getSupabaseConnection();
process.env.DATABASE_MIGRATOR_URL = connectionString;
await import('./migrate.js');
