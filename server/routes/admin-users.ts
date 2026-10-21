import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const adminOnlyActions = new Set([
  'result.edit', 'draw.create', 'plan.edit', 'recharge.approve', 'withdrawal.manage',
  'refund.manage', 'finance.manage', 'cash.close', 'report.view', 'commission.manage', 'raffle.manage', 'tenant.manage', 'prize.see_claim_code',
]);

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.actor || !request.database?.client || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  if (request.actor.role !== 'admin') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Solo Administración puede gestionar usuarios y permisos.' });
    return null;
  }
  return { actor: request.actor, db: request.database.client, tenant: request.tenant };
}

export async function adminUserRoutes(app: FastifyInstance) {
  app.get('/locations', async (request, reply) => {
    const context = await requireAdmin(request, reply);
    if (!context) return reply;
    const result = await context.db.query('SELECT id, name, city, address, is_active AS "isActive" FROM app.locations WHERE tenant_id = $1 ORDER BY is_active DESC, name', [context.tenant.id]);
    return { items: result.rows };
  });

  app.post('/locations', async (request, reply) => {
    const context = await requireAdmin(request, reply);
    if (!context) return reply;
    const body = z.object({ name: z.string().trim().min(2).max(120), city: z.string().trim().max(120).optional().default(''), address: z.string().trim().max(240).optional().default(''), reason: z.string().trim().min(5).max(500) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa el nombre, ciudad, dirección y motivo del local.' });
    try {
      await context.db.query('SAVEPOINT admin_location_create');
      const result = await context.db.query<{ id: string; name: string; city: string | null; address: string | null }>(
        `INSERT INTO app.locations (tenant_id, name, city, address) VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''))
         RETURNING id, name, city, address`,
        [context.tenant.id, body.data.name, body.data.city, body.data.address],
      );
      const location = result.rows[0];
      await context.db.query("SELECT app.fn_audit($1, $2, 'location.created', 'location', $3, NULL, $4::jsonb, $5)",
        [context.tenant.id, context.actor.id, location.id, JSON.stringify(location), body.data.reason]);
      await context.db.query('RELEASE SAVEPOINT admin_location_create');
      return reply.code(201).send({ location });
    } catch (error) {
      await context.db.query('ROLLBACK TO SAVEPOINT admin_location_create');
      await context.db.query('RELEASE SAVEPOINT admin_location_create');
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ code: 'LOCATION_EXISTS', message: 'Ya existe un local con ese nombre en esta plataforma.' });
      throw error;
    }
  });

  app.patch('/locations/:locationId', async (request, reply) => {
    const context = await requireAdmin(request, reply);
    if (!context) return reply;
    const params = z.object({ locationId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ name: z.string().trim().min(2).max(120), city: z.string().trim().max(120).optional().default(''), address: z.string().trim().max(240).optional().default(''), reason: z.string().trim().min(5).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa los datos y el motivo de edición del local.' });
    try {
      await context.db.query('SAVEPOINT admin_location_update');
      const previous = await context.db.query<{ id: string; name: string; city: string | null; address: string | null }>(
        'SELECT id, name, city, address FROM app.locations WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [params.data.locationId, context.tenant.id],
      );
      if (!previous.rows[0]) { await context.db.query('RELEASE SAVEPOINT admin_location_update'); return reply.code(404).send({ code: 'LOCATION_NOT_FOUND', message: 'No encontramos ese local de esta plataforma.' }); }
      const result = await context.db.query<{ id: string; name: string; city: string | null; address: string | null }>(
        `UPDATE app.locations SET name = $3, city = NULLIF($4, ''), address = NULLIF($5, ''), updated_at = now()
          WHERE id = $1 AND tenant_id = $2 RETURNING id, name, city, address`,
        [params.data.locationId, context.tenant.id, body.data.name, body.data.city, body.data.address],
      );
      await context.db.query("SELECT app.fn_audit($1, $2, 'location.updated', 'location', $3, $4::jsonb, $5::jsonb, $6)",
        [context.tenant.id, context.actor.id, params.data.locationId, JSON.stringify(previous.rows[0]), JSON.stringify(result.rows[0]), body.data.reason]);
      await context.db.query('RELEASE SAVEPOINT admin_location_update');
      return { location: result.rows[0] };
    } catch (error) {
      await context.db.query('ROLLBACK TO SAVEPOINT admin_location_update');
      await context.db.query('RELEASE SAVEPOINT admin_location_update');
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ code: 'LOCATION_EXISTS', message: 'Ya existe un local con ese nombre en esta plataforma.' });
      throw error;
    }
  });

  app.patch('/locations/:locationId/status', async (request, reply) => {
    const context = await requireAdmin(request, reply);
    if (!context) return reply;
    const params = z.object({ locationId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ isActive: z.boolean(), reason: z.string().trim().min(5).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa el estado y escribe un motivo de al menos 5 caracteres.' });
    const location = await context.db.query<{ id: string; name: string; is_active: boolean }>(
      'SELECT id, name, is_active FROM app.locations WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
      [params.data.locationId, context.tenant.id],
    );
    if (!location.rows[0]) return reply.code(404).send({ code: 'LOCATION_NOT_FOUND', message: 'No encontramos ese local de esta plataforma.' });
    if (location.rows[0].is_active === body.data.isActive) return { locationId: params.data.locationId, isActive: body.data.isActive, unchanged: true };
    if (!body.data.isActive) {
      const assigned = await context.db.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM app.users WHERE tenant_id=$1 AND location_id=$2 AND is_active',
        [context.tenant.id, params.data.locationId],
      );
      if ((assigned.rows[0]?.count ?? 0) > 0) return reply.code(409).send({ code: 'LOCATION_HAS_ACTIVE_STAFF', message: 'Reasigna o desactiva primero el personal activo asignado a este local.' });
    }
    await context.db.query('UPDATE app.locations SET is_active=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2', [params.data.locationId, context.tenant.id, body.data.isActive]);
    await context.db.query(
      "SELECT app.fn_audit($1, $2, 'location.status_updated', 'location', $3, $4::jsonb, $5::jsonb, $6)",
      [context.tenant.id, context.actor.id, params.data.locationId, JSON.stringify({ name: location.rows[0].name, isActive: location.rows[0].is_active }), JSON.stringify({ name: location.rows[0].name, isActive: body.data.isActive }), body.data.reason],
    );
    return { locationId: params.data.locationId, isActive: body.data.isActive };
  });

  app.post('/users', async (request, reply) => {
    const context = await requireAdmin(request, reply);
    if (!context) return reply;
    const body = z.object({
      fullName: z.string().trim().min(3).max(120), phone: z.string().trim().min(7).max(30),
      email: z.string().trim().email().max(254).optional().or(z.literal('')),
      role: z.enum(['worker', 'seller']), locationId: z.string().uuid(), password: z.string().min(12).max(200), reason: z.string().trim().min(5).max(500),
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Completa los datos; la clave inicial debe tener al menos 12 caracteres.' });
    const location = await context.db.query('SELECT 1 FROM app.locations WHERE id = $1 AND tenant_id = $2 AND is_active', [body.data.locationId, context.tenant.id]);
    if (!location.rowCount) return reply.code(400).send({ code: 'INVALID_LOCATION', message: 'Selecciona un local activo.' });
    const phone = await context.db.query<{ phone: string | null }>('SELECT app.fn_norm_phone($1) AS phone', [body.data.phone]);
    if (!phone.rows[0]?.phone) return reply.code(400).send({ code: 'INVALID_PHONE', message: 'Ingresa un teléfono válido.' });
    const passwordHash = await bcrypt.hash(body.data.password, 12);
    const inserted = await context.db.query<{ id: string; role: string; full_name: string; phone: string; email: string | null; location_id: string }>(
      `INSERT INTO app.users (tenant_id, role, full_name, phone, email, password_hash, location_id)
       VALUES ($1, $2::app.user_role, $3, $4, NULLIF($5, '')::citext, $6, $7)
       RETURNING id, role, full_name, phone, email::text AS email, location_id`,
      [context.tenant.id, body.data.role, body.data.fullName, phone.rows[0].phone, body.data.email ?? '', passwordHash, body.data.locationId],
    );
    const user = inserted.rows[0];
    await context.db.query('INSERT INTO app.staff_profiles (user_id, tenant_id) VALUES ($1, $2)', [user.id, context.tenant.id]);
    await context.db.query(
      'SELECT app.fn_audit($1, $2, $3, $4, $5, NULL, $6::jsonb, $7)',
      [context.tenant.id, context.actor.id, 'user.staff_created', 'user', user.id,
        JSON.stringify({ role: user.role, full_name: user.full_name, location_id: user.location_id }), body.data.reason],
    );
    return reply.code(201).send({ user: { id: user.id, role: user.role, fullName: user.full_name, phone: user.phone, email: user.email, locationId: user.location_id } });
  });

  app.get('/users', async (request, reply) => {
    const context = await requireAdmin(request, reply);
    if (!context) return reply;
    const query = z.object({ q: z.string().trim().max(100).optional(), role: z.enum(['admin', 'worker', 'seller', 'client']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(100000).default(0) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa los filtros de búsqueda.' });
    const result = await context.db.query(
      `SELECT u.id, u.role, u.full_name AS "fullName", u.phone, u.email::text AS email,
              u.is_active AS "isActive", u.is_demo AS "isDemo", u.location_id AS "locationId",
              l.name AS "locationName", u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt",
              sp.can_pay_prizes AS "canPayPrizes", sp.can_review_receipts_until_close AS "canReviewReceiptsUntilClose",
              sp.void_window_minutes AS "voidWindowMinutes",
              count(*) OVER()::text AS "totalCount"
         FROM app.users u
         LEFT JOIN app.locations l ON l.id = u.location_id AND l.tenant_id = u.tenant_id
         LEFT JOIN app.staff_profiles sp ON sp.user_id = u.id AND sp.tenant_id = u.tenant_id
        WHERE u.tenant_id = $1 AND ($2::text IS NULL OR u.role::text = $2)
          AND ($3::text IS NULL OR u.full_name ILIKE '%' || $3 || '%' OR u.phone ILIKE '%' || $3 || '%' OR u.email::text ILIKE '%' || $3 || '%')
        ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'worker' THEN 1 WHEN 'seller' THEN 2 ELSE 3 END, u.created_at DESC
        LIMIT $4 OFFSET $5`, [context.tenant.id, query.data.role ?? null, query.data.q || null, query.data.limit, query.data.offset],
    );
    return { items: result.rows, totalCount: Number(result.rows[0]?.totalCount ?? 0), limit: query.data.limit, offset: query.data.offset };
  });

  app.patch('/users/:userId/role', async (request, reply) => {
    const context = await requireAdmin(request, reply);
    if (!context) return reply;
    const params = z.object({ userId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ role: z.enum(['worker', 'seller']), reason: z.string().trim().min(5).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Selecciona un rol de personal y escribe un motivo de al menos 5 caracteres.' });
    const user = await context.db.query<{ role: string; location_id: string | null; is_active: boolean; full_name: string }>(
      'SELECT role, location_id, is_active, full_name FROM app.users WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [params.data.userId, context.tenant.id],
    );
    const current = user.rows[0];
    if (!current || !['worker', 'seller'].includes(current.role)) return reply.code(403).send({ code: 'ROLE_CHANGE_RESTRICTED', message: 'Solo se puede cambiar entre los roles de trabajador y vendedor. Las cuentas administrativas y de cliente mantienen su tipo de cuenta.' });
    if (!current.is_active) return reply.code(409).send({ code: 'USER_INACTIVE', message: 'Reactiva la cuenta antes de cambiar su rol.' });
    if (current.role === body.data.role) return { userId: params.data.userId, role: current.role, unchanged: true };
    if (!current.location_id) return reply.code(409).send({ code: 'LOCATION_REQUIRED', message: 'Asigna un local activo antes de cambiar el rol de esta cuenta.' });
    const location = await context.db.query('SELECT 1 FROM app.locations WHERE id = $1 AND tenant_id = $2 AND is_active', [current.location_id, context.tenant.id]);
    if (!location.rowCount) return reply.code(409).send({ code: 'ACTIVE_LOCATION_REQUIRED', message: 'La cuenta debe tener asignado un local activo antes de cambiar su rol.' });
    await context.db.query('UPDATE app.users SET role = $3::app.user_role, updated_at = now() WHERE id = $1 AND tenant_id = $2', [params.data.userId, context.tenant.id, body.data.role]);
    await context.db.query('INSERT INTO app.staff_profiles (user_id, tenant_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING', [params.data.userId, context.tenant.id]);
    await context.db.query(
      'SELECT app.fn_audit($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)',
      [context.tenant.id, context.actor.id, 'user.role_updated', 'user', params.data.userId,
        JSON.stringify({ role: current.role }), JSON.stringify({ role: body.data.role, full_name: current.full_name }), body.data.reason],
    );
    return { userId: params.data.userId, role: body.data.role };
  });

  app.get('/roles/permissions', async (request, reply) => {
    const context = await requireAdmin(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT role, action, allowed, scope, updated_at AS "updatedAt"
         FROM app.role_permissions WHERE tenant_id = $1 AND role IN ('worker','seller')
        ORDER BY action, role`, [context.tenant.id],
    );
    return { items: result.rows };
  });

  app.patch('/roles/permissions', async (request, reply) => {
    const context = await requireAdmin(request, reply);
    if (!context) return reply;
    const body = z.object({ role: z.enum(['worker', 'seller']), action: z.string().trim().min(3).max(100), allowed: z.boolean(), scope: z.enum(['all', 'own', 'before_close', 'authorized_only']), reason: z.string().trim().min(5).max(500) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa el permiso y escribe un motivo de al menos 5 caracteres.' });
    if (adminOnlyActions.has(body.data.action)) return reply.code(403).send({ code: 'ADMIN_ONLY_PERMISSION', message: 'Este permiso está reservado a Administración.' });
    const previous = await context.db.query<{ allowed: boolean; scope: string }>(
      'SELECT allowed, scope FROM app.role_permissions WHERE tenant_id = $1 AND role = $2 AND action = $3 FOR UPDATE',
      [context.tenant.id, body.data.role, body.data.action],
    );
    if (!previous.rows[0]) return reply.code(404).send({ code: 'PERMISSION_NOT_FOUND', message: 'Ese permiso no está configurado para el rol.' });
    await context.db.query(
      'UPDATE app.role_permissions SET allowed = $4, scope = $5 WHERE tenant_id = $1 AND role = $2 AND action = $3',
      [context.tenant.id, body.data.role, body.data.action, body.data.allowed, body.data.scope],
    );
    await context.db.query(
      'SELECT app.fn_audit($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)',
      [context.tenant.id, context.actor.id, 'permission.updated', 'role_permission', `${body.data.role}:${body.data.action}`,
        JSON.stringify(previous.rows[0]), JSON.stringify({ allowed: body.data.allowed, scope: body.data.scope }), body.data.reason],
    );
    return { role: body.data.role, action: body.data.action, allowed: body.data.allowed, scope: body.data.scope };
  });

  app.patch('/users/:userId/status', async (request, reply) => {
    const context = await requireAdmin(request, reply);
    if (!context) return reply;
    const params = z.object({ userId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ isActive: z.boolean(), reason: z.string().trim().min(5).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa la cuenta y escribe un motivo de al menos 5 caracteres.' });
    const user = await context.db.query<{ role: string; is_active: boolean; full_name: string }>(
      'SELECT role, is_active, full_name FROM app.users WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [params.data.userId, context.tenant.id],
    );
    if (!user.rows[0]) return reply.code(404).send({ code: 'USER_NOT_FOUND', message: 'No encontramos esa cuenta.' });
    if (user.rows[0].role === 'admin') return reply.code(403).send({ code: 'PROTECTED_ACCOUNT', message: 'Las cuentas de Administración se gestionan fuera de esta pantalla.' });
    if (user.rows[0].is_active === body.data.isActive) return { userId: params.data.userId, isActive: body.data.isActive, unchanged: true };
    await context.db.query('UPDATE app.users SET is_active = $3 WHERE id = $1 AND tenant_id = $2', [params.data.userId, context.tenant.id, body.data.isActive]);
    if (!body.data.isActive) await context.db.query('UPDATE app.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL', [params.data.userId, context.tenant.id]);
    await context.db.query(
      'SELECT app.fn_audit($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)',
      [context.tenant.id, context.actor.id, 'user.status_updated', 'user', params.data.userId,
        JSON.stringify({ isActive: user.rows[0].is_active }), JSON.stringify({ isActive: body.data.isActive }), body.data.reason],
    );
    return { userId: params.data.userId, isActive: body.data.isActive };
  });

  app.patch('/staff/:userId/permissions', async (request, reply) => {
    const context = await requireAdmin(request, reply);
    if (!context) return reply;
    const params = z.object({ userId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ canPayPrizes: z.boolean(), canReviewReceiptsUntilClose: z.boolean(), voidWindowMinutes: z.number().int().min(0).max(240), reason: z.string().trim().min(5).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa los permisos y escribe un motivo de al menos 5 caracteres.' });
    const user = await context.db.query<{ role: string }>('SELECT role FROM app.users WHERE id = $1 AND tenant_id = $2 AND is_active FOR UPDATE', [params.data.userId, context.tenant.id]);
    if (!user.rows[0] || !['worker', 'seller'].includes(user.rows[0].role)) return reply.code(404).send({ code: 'STAFF_NOT_FOUND', message: 'No encontramos un trabajador o vendedor activo con esa cuenta.' });
    const old = await context.db.query<{ can_pay_prizes: boolean; can_review_receipts_until_close: boolean; void_window_minutes: number }>(
      'SELECT can_pay_prizes, can_review_receipts_until_close, void_window_minutes FROM app.staff_profiles WHERE user_id = $1 AND tenant_id = $2 FOR UPDATE', [params.data.userId, context.tenant.id],
    );
    if (!old.rows[0]) return reply.code(409).send({ code: 'STAFF_PROFILE_MISSING', message: 'La cuenta no tiene un perfil de personal configurado.' });
    await context.db.query(
      'UPDATE app.staff_profiles SET can_pay_prizes = $3, can_review_receipts_until_close = $4, void_window_minutes = $5 WHERE user_id = $1 AND tenant_id = $2',
      [params.data.userId, context.tenant.id, body.data.canPayPrizes, body.data.canReviewReceiptsUntilClose, body.data.voidWindowMinutes],
    );
    await context.db.query(
      'SELECT app.fn_audit($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)',
      [context.tenant.id, context.actor.id, 'staff.permissions_updated', 'user', params.data.userId,
        JSON.stringify(old.rows[0]), JSON.stringify({ can_pay_prizes: body.data.canPayPrizes, can_review_receipts_until_close: body.data.canReviewReceiptsUntilClose, void_window_minutes: body.data.voidWindowMinutes }), body.data.reason],
    );
    return { userId: params.data.userId, ...body.data };
  });
}
