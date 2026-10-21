import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const adminUrl = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '::1'].includes(adminUrl.hostname) || adminUrl.pathname !== '/imperio_de_ross') {
  throw new Error('Local bootstrap only accepts localhost/imperio_de_ross.');
}
const envPath = resolve('.env');
const envTextPath = resolve('.env.bootstrap.tmp');
const names = { staff: 'ir_api_staff', admin: 'ir_api_admin', migrator: 'ir_migrator' } as const;
const passwords = Object.fromEntries(Object.values(names).map((name) => [name, randomBytes(32).toString('base64url')])) as Record<(typeof names)[keyof typeof names], string>;
const dbHost = '127.0.0.1';
const dbPort = adminUrl.port || '5432';
const database = 'imperio_de_ross';
const url = (username: string) => `postgresql://${username}:${passwords[username as keyof typeof passwords]}@${dbHost}:${dbPort}/${database}`;
const configuration = [
  'VITE_API_URL=http://localhost:3000',
  'NODE_ENV=development',
  'API_HOST=127.0.0.1',
  'API_PORT=3000',
  'WEB_ORIGINS=http://localhost:5173',
  'DEFAULT_TENANT_SLUG=imperio-de-ross',
  `DATABASE_STAFF_URL=${url(names.staff)}`,
  `DATABASE_ADMIN_URL=${url(names.admin)}`,
  `DATABASE_MIGRATOR_URL=${url(names.migrator)}`,
  'SESSION_TTL_DAYS=7',
  'STORAGE_PATH=./var/private-uploads',
  'MAX_PROOF_FILE_BYTES=5242880',
  '',
].join('\n');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: 'imperio-ross-local-bootstrap' });
let envCreated = false;
let committed = false;
try {
  await writeFile(envPath, configuration, { flag: 'wx', mode: 0o600 });
  envCreated = true;
  const client = await pool.connect();
  try {
    const identity = await client.query<{ current_user: string; is_super: boolean; db: string }>(
      'SELECT current_user, r.rolsuper AS is_super, current_database() AS db FROM pg_roles r WHERE r.rolname = current_user',
    );
    if (identity.rows[0]?.current_user !== 'rf_dev' || !identity.rows[0].is_super || identity.rows[0].db !== database) {
      throw new Error('Expected rf_dev SUPERUSER connected to imperio_de_ross for one-time local role bootstrap.');
    }
    const groups = await client.query<{ rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('rf_api_staff','rf_api_admin') ORDER BY rolname",
    );
    if (groups.rows.length !== 2 || groups.rows.some((role) => role.rolcanlogin || role.rolsuper || role.rolbypassrls)) {
      throw new Error('Expected rf_api_staff and rf_api_admin to exist as NOLOGIN, non-superuser, non-BYPASSRLS groups.');
    }
    const conflicts = await client.query<{ rolname: string }>(
      'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])', [Object.values(names)],
    );
    if (conflicts.rowCount) throw new Error(`Refusing to replace existing role(s): ${conflicts.rows.map((row) => row.rolname).join(', ')}.`);
    await client.query('BEGIN');
    for (const [name, password] of Object.entries(passwords)) {
      const ddl = await client.query<{ statement: string }>(
        "SELECT format('CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text, $2::text) AS statement",
        [name, password],
      );
      await client.query(ddl.rows[0].statement);
      await client.query('GRANT CONNECT ON DATABASE imperio_de_ross TO ' + pg.escapeIdentifier(name));
    }
    await client.query(`GRANT rf_api_staff TO ${pg.escapeIdentifier(names.staff)}`);
    await client.query(`GRANT rf_api_admin TO ${pg.escapeIdentifier(names.admin)}`);
    await client.query(`GRANT USAGE ON SCHEMA app TO ${pg.escapeIdentifier(names.staff)}, ${pg.escapeIdentifier(names.admin)}`);
    await client.query(`GRANT USAGE, CREATE ON SCHEMA app TO ${pg.escapeIdentifier(names.migrator)}`);
    const checks = await client.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; staff: boolean; admin: boolean; reads_claim: boolean }>(
      `SELECT r.rolname, r.rolsuper, r.rolbypassrls,
              pg_has_role(r.rolname, 'rf_api_staff', 'member') AS staff,
              pg_has_role(r.rolname, 'rf_api_admin', 'member') AS admin,
              has_table_privilege(r.rolname, 'app.ticket_claim_codes', 'SELECT') AS reads_claim
         FROM pg_roles r WHERE r.rolname = ANY($1::text[]) ORDER BY r.rolname`, [Object.values(names).slice(0, 2)],
    );
    const staff = checks.rows.find((role) => role.rolname === names.staff);
    const admin = checks.rows.find((role) => role.rolname === names.admin);
    if (!staff || staff.rolsuper || staff.rolbypassrls || !staff.staff || staff.admin || staff.reads_claim) throw new Error('Staff role validation failed.');
    if (!admin || admin.rolsuper || admin.rolbypassrls || admin.staff || !admin.admin) throw new Error('Admin role validation failed.');
    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  console.log('Created least-privilege local logins and wrote their credentials to ignored .env.');
  console.log('Next: npm run db:migrate, then npm run dev:api. No base SQL was executed.');
} catch (error) {
  if (envCreated && !committed) await unlink(envPath).catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}
