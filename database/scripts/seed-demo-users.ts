import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import pg from 'pg';

if (process.env.NODE_ENV !== 'development') throw new Error('Demo users can only be provisioned in development.');
const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error('DATABASE_ADMIN_URL is required.');
const parsed = new URL(connectionString);
if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || parsed.pathname !== '/imperio_de_ross') {
  throw new Error('Demo users can only be provisioned on localhost/imperio_de_ross.');
}

const tenantId = 'a0000000-0000-0000-0000-000000000001';
const demoUsers = [
  { id: 'c0000000-0000-0000-0000-000000000001', role: 'admin', name: 'Administrador Demo', phone: '0990000001', email: 'admin@demo.local' },
  { id: 'c0000000-0000-0000-0000-000000000002', role: 'worker', name: 'Trabajadora Demo', phone: '0990000002', email: 'worker@demo.local' },
  { id: 'c0000000-0000-0000-0000-000000000003', role: 'seller', name: 'Vendedora Demo', phone: '0990000003', email: 'seller@demo.local' },
  { id: 'c0000000-0000-0000-0000-000000000004', role: 'client', name: 'Cliente Demo', phone: '0990000004', email: 'cliente@demo.local' },
] as const;
const credentials = demoUsers.map((user) => ({ ...user, password: randomBytes(18).toString('base64url') }));
const pool = new pg.Pool({ connectionString, max: 1, options: '-c search_path=app,public', application_name: 'imperio-ross-demo-users' });
const credentialsPath = resolve('.local/demo-usuarios.txt');
let committed = false;
let credentialFileCreated = false;
try {
  await mkdir(resolve('.local'), { recursive: true });
  const contents = [
    'EL IMPERIO DE ROSS — CUENTAS DEMO LOCALES',
    'Solo para desarrollo local. Cambia o elimina estas claves antes de compartir el equipo.',
    'El invitado compra sin cuenta; client representa al usuario registrado.',
    '',
    ...credentials.flatMap((user) => [`[${user.role.toUpperCase()}]`, `Nombre: ${user.name}`, `Teléfono / usuario: ${user.phone}`, `Correo: ${user.email}`, `Contraseña: ${user.password}`, '']),
  ].join('\n');
  await writeFile(credentialsPath, contents, { flag: 'wx', mode: 0o600 });
  credentialFileCreated = true;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.environment', 'development', true)");
    await client.query("SELECT set_config('app.user_id', $1, true)", [demoUsers[0].id]);
    const found = await client.query<{ id: string; role: string; is_demo: boolean; password_hash: string }>(
      `SELECT id::text, role::text, is_demo, password_hash FROM app.users
       WHERE tenant_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
      [tenantId, demoUsers.map(({ id }) => id)],
    );
    if (found.rowCount !== demoUsers.length || found.rows.some((row) => !row.is_demo || !demoUsers.some((demo) => demo.id === row.id && demo.role === row.role))) {
      throw new Error('Seed demo users differ from the expected role fixtures; no rows changed.');
    }
    if (found.rows.some((row) => !row.password_hash.includes('REEMPLAZAR_HASH_REAL'))) {
      throw new Error('Demo accounts already have usable hashes; refusing to rotate their credentials.');
    }
    for (const user of credentials) {
      const hash = await bcrypt.hash(user.password, 12);
      const updated = await client.query(
        `UPDATE app.users SET password_hash = $1, is_active = true, updated_at = now()
         WHERE id = $2 AND tenant_id = $3 AND role::text = $4 AND is_demo
           AND password_hash LIKE '%REEMPLAZAR_HASH_REAL%'`,
        [hash, user.id, tenantId, user.role],
      );
      if (updated.rowCount !== 1) throw new Error(`Could not provision the ${user.role} fixture.`);
    }
    await client.query(
      `INSERT INTO app.staff_profiles (user_id, tenant_id, can_pay_prizes, can_review_receipts_until_close, void_window_minutes)
       SELECT id, tenant_id, false, false, 30 FROM app.users
       WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND role IN ('worker','seller')
       ON CONFLICT (user_id) DO NOTHING`,
      [tenantId, demoUsers.map(({ id }) => id)],
    );
    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }

  console.log('Provisioned 4 local DEMO accounts; credentials saved in .local/demo-usuarios.txt.');
} catch (error) {
  if (committed) console.error('Database accounts were provisioned, but the credential file could not be written. Do not rerun; recover the generated credentials securely before retrying.');
  else if (credentialFileCreated) await unlink(credentialsPath).catch(() => undefined);
  throw error;
} finally { await pool.end(); }
