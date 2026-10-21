import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import pg from 'pg';

if (process.env.NODE_ENV !== 'development') throw new Error('Demo credentials can only be reset in development.');
const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error('DATABASE_ADMIN_URL is required.');
const parsed = new URL(connectionString);
if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || parsed.pathname !== '/imperio_de_ross') {
  throw new Error('Demo credentials can only be reset on localhost/imperio_de_ross.');
}

const tenantId = 'a0000000-0000-0000-0000-000000000001';
const fixtures = [
  { id: 'c0000000-0000-0000-0000-000000000001', role: 'admin', name: 'Administrador Demo', phone: '0990000001', email: 'admin@demo.local' },
  { id: 'c0000000-0000-0000-0000-000000000002', role: 'worker', name: 'Trabajadora Demo', phone: '0990000002', email: 'worker@demo.local' },
  { id: 'c0000000-0000-0000-0000-000000000003', role: 'seller', name: 'Vendedora Demo', phone: '0990000003', email: 'seller@demo.local' },
  { id: 'c0000000-0000-0000-0000-000000000004', role: 'client', name: 'Cliente Demo', phone: '0990000004', email: 'cliente@demo.local' },
] as const;
const credentials = fixtures.map((user) => ({ ...user, password: randomBytes(24).toString('base64url') }));
const pool = new pg.Pool({ connectionString, max: 1, options: '-c search_path=app,public', application_name: 'imperio-ross-reset-demo-users' });
const credentialsPath = resolve('.local/demo-usuarios.txt');
let fileCreated = false;
let committed = false;
try {
  await mkdir(resolve('.local'), { recursive: true });
  const contents = [
    'EL IMPERIO DE ROSS — CUENTAS DEMO LOCALES',
    'Solo para desarrollo local. Estas claves sustituyen las anteriores de cuentas is_demo=true.',
    'El invitado compra sin cuenta; client representa al usuario registrado.',
    '',
    ...credentials.flatMap((user) => [`[${user.role.toUpperCase()}]`, `Nombre: ${user.name}`, `Teléfono / usuario: ${user.phone}`, `Correo: ${user.email}`, `Contraseña: ${user.password}`, '']),
  ].join('\n');
  await writeFile(credentialsPath, contents, { flag: 'wx', mode: 0o600 });
  fileCreated = true;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.environment','development',true),set_config('app.user_id',$2,true)", [tenantId, fixtures[0].id]);
    const result = await client.query<{ id: string; role: string; is_demo: boolean }>(
      `SELECT id::text,role::text,is_demo FROM app.users WHERE tenant_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE`,
      [tenantId, fixtures.map((user) => user.id)],
    );
    if (result.rowCount !== fixtures.length || result.rows.some((row) => !row.is_demo || !fixtures.some((user) => user.id === row.id && user.role === row.role))) {
      throw new Error('Las cuentas no coinciden exactamente con los cuatro fixtures DEMO; no se modificó ninguna cuenta.');
    }
    for (const user of credentials) {
      const hash = await bcrypt.hash(user.password, 12);
      const changed = await client.query(
        `UPDATE app.users SET password_hash=$1,is_active=true,failed_logins=0,locked_until=NULL,updated_at=now()
          WHERE id=$2 AND tenant_id=$3 AND role::text=$4 AND is_demo`,
        [hash, user.id, tenantId, user.role],
      );
      if (changed.rowCount !== 1) throw new Error(`No se pudo actualizar la cuenta DEMO ${user.role}.`);
    }
    await client.query('UPDATE app.auth_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id=ANY($2::uuid[]) AND revoked_at IS NULL', [tenantId, fixtures.map((user) => user.id)]);
    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
  console.log('Se actualizaron las cuatro cuentas is_demo locales. Las claves están en .local/demo-usuarios.txt; no se mostraron ni se versionan.');
} catch (error) {
  if (fileCreated && !committed) await unlink(credentialsPath).catch(() => undefined);
  throw error;
} finally { await pool.end(); }
