import pg from 'pg';
import { env } from '../env.js';

const { Pool } = pg;
const poolOptions = { max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, options: '-c search_path=app,public -c statement_timeout=10000' };

export const staffPool = new Pool({ connectionString: env.DATABASE_STAFF_URL, ...poolOptions, application_name: 'imperio-ross-api-staff' });
export const adminPool = new Pool({ connectionString: env.DATABASE_ADMIN_URL, ...poolOptions, application_name: 'imperio-ross-api-admin' });

for (const [name, pool] of [['staff', staffPool], ['admin', adminPool]] as const) {
  pool.on('error', () => console.error(JSON.stringify({ level: 'error', event: 'database_pool_error', pool: name })));
}
