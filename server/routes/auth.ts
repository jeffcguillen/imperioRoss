import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../env.js';
import { createSessionToken } from '../security/session.js';
import type { Actor } from '../types.js';

const loginSchema = z.object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(1).max(200) });
const registerSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(254).optional(),
  password: z.string().min(10).max(200),
  adultConfirmed: z.literal(true),
  termsAccepted: z.literal(true),
});
const recoverySchema = z.object({ identifier: z.string().trim().min(3).max(254) });
const profileSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  phone: z.string().trim().min(7).max(30),
  email: z.union([z.string().trim().email().max(254), z.literal('')]).optional(),
});
const passwordChangeSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(200) });

function requireDatabase(request: FastifyRequest) {
  if (!request.database || !request.tenant) throw new Error('REQUEST_CONTEXT_MISSING');
  return { client: request.database.client, tenant: request.tenant };
}

function safeActor(actor: Actor) {
  return { id: actor.id, role: actor.role, fullName: actor.fullName, phone: actor.phone, email: actor.email, locationId: actor.locationId };
}

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie('ross_session', token, {
    path: '/', httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict',
    maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.get('/me', async (request, reply) => {
    if (!request.actor) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    const { client, tenant } = requireDatabase(request);
    const permissions = await client.query<{ action: string }>(
      'SELECT action FROM app.role_permissions WHERE tenant_id = $1 AND role = $2 AND allowed ORDER BY action',
      [tenant.id, request.actor.role],
    );
    return { user: { ...safeActor(request.actor), permissions: permissions.rows.map((row) => row.action) } };
  });

  app.post('/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa los datos del formulario.' });
    const { client, tenant } = requireDatabase(request);
    const data = parsed.data;
    const phoneResult = await client.query<{ phone: string | null }>('SELECT app.fn_norm_phone($1) AS phone', [data.phone]);
    if (!phoneResult.rows[0]?.phone) return reply.code(400).send({ code: 'INVALID_PHONE', message: 'Ingresa un teléfono válido.' });
    const passwordHash = await bcrypt.hash(data.password, 12);
    const inserted = await client.query<{ id: string; role: Actor['role']; full_name: string; phone: string; email: string | null; location_id: string | null }>(
      `INSERT INTO app.users (tenant_id, role, full_name, phone, email, password_hash, adult_confirmed_at, terms_accepted_at)
       VALUES ($1, 'client'::app.user_role, $2, $3, $4, $5, now(), now())
       RETURNING id, role, full_name, phone, email, location_id`,
      [tenant.id, data.fullName, phoneResult.rows[0].phone, data.email ?? null, passwordHash],
    );
    const user = inserted.rows[0];
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    await client.query('SELECT app.fn_get_wallet($1)', [user.id]);
    const { token, tokenHash } = createSessionToken();
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO app.auth_sessions (tenant_id, user_id, refresh_token_hash, user_agent, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenant.id, user.id, tokenHash, request.headers['user-agent'] ?? null, request.ip, expiresAt],
    );
    setSessionCookie(reply, token);
    return reply.code(201).send({ user: safeActor({ id: user.id, tenantId: tenant.id, role: user.role, fullName: user.full_name, phone: user.phone, email: user.email, locationId: user.location_id }) });
  });

  app.post('/login', { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Ingresa tu teléfono o correo y contraseña.' });
    const { client, tenant } = requireDatabase(request);
    const { identifier, password } = parsed.data;
    const found = await client.query<{ id: string; role: Actor['role']; full_name: string; phone: string; email: string | null; location_id: string | null; password_hash: string; is_active: boolean; failed_logins: number; locked_until: Date | null }>(
      `SELECT id, role, full_name, phone, email, location_id, password_hash, is_active, failed_logins, locked_until
         FROM app.users WHERE tenant_id = $1 AND (phone_norm = app.fn_norm_phone($2) OR email = $2::citext) LIMIT 1`,
      [tenant.id, identifier],
    );
    const user = found.rows[0];
    const valid = Boolean(user && user.is_active && (!user.locked_until || user.locked_until <= new Date()) && await bcrypt.compare(password, user.password_hash));
    if (!valid) {
      if (user) {
        await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
        await client.query(
          `UPDATE app.users SET failed_logins = failed_logins + 1,
             locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
           WHERE id = $1`, [user.id],
        );
      }
      return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: 'No pudimos validar tus datos de acceso.' });
    }
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    await client.query('UPDATE app.users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
    const { token, tokenHash } = createSessionToken();
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const session = await client.query<{ id: string }>(
      `INSERT INTO app.auth_sessions (tenant_id, user_id, refresh_token_hash, user_agent, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenant.id, user.id, tokenHash, request.headers['user-agent'] ?? null, request.ip, expiresAt],
    );
    request.sessionId = session.rows[0].id;
    setSessionCookie(reply, token);
    return { user: safeActor({ id: user.id, tenantId: tenant.id, role: user.role, fullName: user.full_name, phone: user.phone, email: user.email, locationId: user.location_id }) };
  });

  app.post('/logout', async (request, reply) => {
    if (request.actor && request.sessionId) {
      const { client } = requireDatabase(request);
      await client.query('UPDATE app.auth_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [request.sessionId, request.actor.id]);
    }
    reply.clearCookie('ross_session', { path: '/', sameSite: 'strict', secure: env.NODE_ENV === 'production' });
    return reply.code(204).send();
  });

  app.patch('/profile', async (request, reply) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa tu nombre, teléfono y correo.' });
    if (!request.actor) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    const { client, tenant } = requireDatabase(request);
    const data = parsed.data;
    const phoneResult = await client.query<{ phone: string | null }>('SELECT app.fn_norm_phone($1) AS phone', [data.phone]);
    const normalizedPhone = phoneResult.rows[0]?.phone;
    if (!normalizedPhone) return reply.code(400).send({ code: 'INVALID_PHONE', message: 'Ingresa un teléfono válido.' });
    const email = data.email?.trim() || null;
    const duplicate = await client.query<{ id: string }>(
      `SELECT id FROM app.users WHERE tenant_id = $1 AND id <> $2
        AND (phone_norm = $3 OR ($4::citext IS NOT NULL AND email = $4::citext)) LIMIT 1`,
      [tenant.id, request.actor.id, normalizedPhone, email],
    );
    if (duplicate.rowCount) return reply.code(409).send({ code: 'PROFILE_CONTACT_IN_USE', message: 'Ese teléfono o correo ya está asociado a otra cuenta.' });
    await client.query('SAVEPOINT auth_profile_update');
    let updated;
    try {
      updated = await client.query<{ id: string; role: Actor['role']; full_name: string; phone: string; email: string | null; location_id: string | null }>(
        `UPDATE app.users SET full_name = $3, phone = $4, email = $5, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND is_active
          RETURNING id, role, full_name, phone, email, location_id`,
        [request.actor.id, tenant.id, data.fullName, normalizedPhone, email],
      );
      await client.query('RELEASE SAVEPOINT auth_profile_update');
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        await client.query('ROLLBACK TO SAVEPOINT auth_profile_update');
        await client.query('RELEASE SAVEPOINT auth_profile_update');
        return reply.code(409).send({ code: 'PROFILE_CONTACT_IN_USE', message: 'Ese teléfono o correo ya está asociado a otra cuenta.' });
      }
      throw error;
    }
    const user = updated.rows[0];
    if (!user) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'La cuenta ya no está disponible.' });
    return { user: safeActor({ id: user.id, tenantId: tenant.id, role: user.role, fullName: user.full_name, phone: user.phone, email: user.email, locationId: user.location_id }) };
  });

  app.post('/password/change', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = passwordChangeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'La contraseña nueva debe tener al menos 10 caracteres.' });
    if (!request.actor || !request.sessionId) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    const { client, tenant } = requireDatabase(request);
    const locked = await client.query<{ password_hash: string }>(
      'SELECT password_hash FROM app.users WHERE id = $1 AND tenant_id = $2 AND is_active FOR UPDATE',
      [request.actor.id, tenant.id],
    );
    const account = locked.rows[0];
    if (!account || !await bcrypt.compare(parsed.data.currentPassword, account.password_hash)) {
      return reply.code(400).send({ code: 'CURRENT_PASSWORD_INVALID', message: 'La contraseña actual no es correcta.' });
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return reply.code(400).send({ code: 'PASSWORD_UNCHANGED', message: 'Elige una contraseña distinta a la actual.' });
    }
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await client.query('UPDATE app.users SET password_hash = $3, failed_logins = 0, locked_until = NULL WHERE id = $1 AND tenant_id = $2', [request.actor.id, tenant.id, passwordHash]);
    await client.query('UPDATE app.auth_sessions SET revoked_at = now() WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL', [tenant.id, request.actor.id]);
    const { token, tokenHash } = createSessionToken();
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const session = await client.query<{ id: string }>(
      `INSERT INTO app.auth_sessions (tenant_id, user_id, refresh_token_hash, user_agent, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenant.id, request.actor.id, tokenHash, request.headers['user-agent'] ?? null, request.ip, expiresAt],
    );
    request.sessionId = session.rows[0].id;
    setSessionCookie(reply, token);
    return { changed: true, sessionsRevoked: true };
  });

  app.post('/recovery', { config: { rateLimit: { max: 4, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = recoverySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Ingresa un teléfono o correo válido.' });
    // No se generan OTP que no puedan entregarse. El proveedor de email/SMS se documenta y conecta en el bloque de notificaciones.
    return reply.code(503).send({ code: 'RECOVERY_NOT_CONFIGURED', message: 'La recuperación automática aún no está disponible. Contacta a Administración.' });
  });
}
