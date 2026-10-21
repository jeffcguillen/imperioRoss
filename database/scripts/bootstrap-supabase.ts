import { randomBytes } from 'node:crypto';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { getSupabaseConnection } from './supabase-connection.js';

const { connectionString, projectRef, url: ownerUrl } = getSupabaseConnection();
const tenantId = 'a0000000-0000-0000-0000-000000000001';
const users = [
  { id: 'c0000000-0000-0000-0000-000000000001', role: 'admin', name: 'Administrador Demo', phone: '0990000001', email: 'admin@demo.local' },
  { id: 'c0000000-0000-0000-0000-000000000002', role: 'worker', name: 'Trabajadora Demo', phone: '0990000002', email: 'worker@demo.local' },
  { id: 'c0000000-0000-0000-0000-000000000003', role: 'seller', name: 'Vendedora Demo', phone: '0990000003', email: 'seller@demo.local' },
  { id: 'c0000000-0000-0000-0000-000000000004', role: 'client', name: 'Cliente Demo', phone: '0990000004', email: 'cliente@demo.local' },
] as const;
const runtimeRoles = ['ir_api_staff', 'ir_api_admin'] as const;
const runtimePasswords = Object.fromEntries(runtimeRoles.map((role) => [role, randomBytes(32).toString('base64url')])) as Record<(typeof runtimeRoles)[number], string>;
const demoUsers = users.map((user) => ({ ...user, password: randomBytes(24).toString('base64url') }));
const makeRuntimeUrl = (role: (typeof runtimeRoles)[number]) => {
  const runtimeUrl = new URL(ownerUrl.toString());
  runtimeUrl.username = `${role}.${projectRef}`;
  runtimeUrl.password = runtimePasswords[role];
  return runtimeUrl.toString();
};
const runtimeEnvPath = resolve('.local/supabase-runtime.env');
const demoCredentialsPath = resolve('.local/supabase-demo-users.txt');
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, options: '-c search_path=app,public', application_name: 'imperio-ross-supabase-bootstrap' });
let runtimeFileCreated = false;
let demoFileCreated = false;
let committed = false;

try {
  await mkdir(resolve('.local'), { recursive: true });
  const runtimeEnv = [
    `DATABASE_STAFF_URL=${makeRuntimeUrl('ir_api_staff')}`,
    `DATABASE_ADMIN_URL=${makeRuntimeUrl('ir_api_admin')}`,
    `CLAIM_CODE_KEY=${randomBytes(32).toString('base64url')}`,
    '',
  ].join('\n');
  const demoContent = [
    'CUENTAS DEMO INICIALES DE SUPABASE',
    'Contraseñas aleatorias para revisión inicial. Cambia la contraseña del administrador al ingresar.',
    'No uses estas cuentas como cuentas reales de clientes.',
    '',
    ...demoUsers.flatMap((user) => [`[${user.role.toUpperCase()}]`, `Nombre: ${user.name}`, `Teléfono / usuario: ${user.phone}`, `Correo: ${user.email}`, `Contraseña: ${user.password}`, '']),
  ].join('\n');
  await writeFile(runtimeEnvPath, runtimeEnv, { flag: 'wx', mode: 0o600 });
  runtimeFileCreated = true;
  await writeFile(demoCredentialsPath, demoContent, { flag: 'wx', mode: 0o600 });
  demoFileCreated = true;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const migrationNames = (await readdir(resolve('database/migrations')))
      .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
    const appliedMigrations = await client.query<{ version: string }>('SELECT version FROM app.schema_migrations');
    const appliedVersions = new Set(appliedMigrations.rows.map(({ version }) => version));
    if (!migrationNames.length || migrationNames.some((name) => !appliedVersions.has(name))) {
      throw new Error('Faltan migraciones. Ejecuta npm run db:migrate:supabase primero.');
    }

    const existingRoles = await client.query<{ rolname: string }>(
      'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])', [runtimeRoles],
    );
    if (existingRoles.rowCount) throw new Error('Ya existen roles API; no se reemplazan credenciales. Revisa el panel del proveedor.');

    const existingUsers = await client.query<{ id: string; role: string; is_demo: boolean; password_hash: string }>(
      `SELECT id::text, role::text, is_demo, password_hash FROM app.users
       WHERE tenant_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
      [tenantId, users.map(({ id }) => id)],
    );
    if (existingUsers.rowCount !== users.length
      || existingUsers.rows.some((row) => !row.is_demo || !users.some((user) => user.id === row.id && user.role === row.role) || !row.password_hash.includes('REEMPLAZAR_HASH_REAL'))) {
      throw new Error('Las cuatro cuentas DEMO no están en estado inicial. No se modificó ninguna cuenta.');
    }

    for (const role of runtimeRoles) {
      const created = await client.query<{ statement: string }>(
        "SELECT format('CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text, $2::text) AS statement",
        [role, runtimePasswords[role]],
      );
      await client.query(created.rows[0].statement);
      await client.query(`GRANT CONNECT ON DATABASE postgres TO ${pg.escapeIdentifier(role)}`);
    }
    await client.query(`GRANT rf_api_staff TO ${pg.escapeIdentifier(runtimeRoles[0])}`);
    await client.query(`GRANT rf_api_admin TO ${pg.escapeIdentifier(runtimeRoles[1])}`);
    await client.query(`GRANT USAGE ON SCHEMA app TO ${pg.escapeIdentifier(runtimeRoles[0])}, ${pg.escapeIdentifier(runtimeRoles[1])}`);

    for (const user of demoUsers) {
      const passwordHash = await bcrypt.hash(user.password, 12);
      const updated = await client.query(
        `UPDATE app.users SET password_hash = $1, is_active = true, failed_logins = 0, locked_until = NULL, updated_at = now()
         WHERE tenant_id = $2 AND id = $3 AND role::text = $4 AND is_demo
           AND password_hash LIKE '%REEMPLAZAR_HASH_REAL%'`,
        [passwordHash, tenantId, user.id, user.role],
      );
      if (updated.rowCount !== 1) throw new Error(`No se pudo habilitar la cuenta DEMO de rol ${user.role}.`);
    }
    await client.query(
      `INSERT INTO app.staff_profiles (user_id, tenant_id, can_pay_prizes, can_review_receipts_until_close, void_window_minutes)
       SELECT id, tenant_id, false, false, 30 FROM app.users
       WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND role IN ('worker','seller')
       ON CONFLICT (user_id) DO NOTHING`,
      [tenantId, users.map(({ id }) => id)],
    );
    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  console.log('Roles de API y cuentas DEMO creados en Supabase.');
  console.log('Variables privadas para Render: .local/supabase-runtime.env');
  console.log('Credenciales DEMO: .local/supabase-demo-users.txt');
  console.log('Los archivos son locales e ignorados por Git; conserva una copia segura.');
} catch (error) {
  if (!committed) {
    if (demoFileCreated) await unlink(demoCredentialsPath).catch(() => undefined);
    if (runtimeFileCreated) await unlink(runtimeEnvPath).catch(() => undefined);
  } else {
    console.error('La base se inicializó, pero recupera con cuidado los archivos .local antes de continuar.');
  }
  throw error;
} finally {
  await pool.end();
}
