import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const schemaShape = z.object({
  sellerId: z.string().uuid().nullable().optional(), drawId: z.string().uuid().nullable().optional(),
  digits: z.union([z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
  base: z.enum(['sales_percent', 'fixed_amount', 'monthly_profit_percent']),
  percentBp: z.number().int().min(0).max(10_000).optional(), fixedCents: z.string().regex(/^\d{1,12}$/).optional(),
  effectiveFrom: z.string().date(), effectiveTo: z.string().date().nullable().optional(),
});
function refineCommission(value: z.infer<typeof schemaShape>, context: z.RefinementCtx) {
  if (value.base === 'fixed_amount' && value.fixedCents === undefined) context.addIssue({ code: 'custom', path: ['fixedCents'], message: 'Indica el valor fijo de la comisión.' });
  if (value.base !== 'fixed_amount' && value.percentBp === undefined) context.addIssue({ code: 'custom', path: ['percentBp'], message: 'Indica el porcentaje de la comisión.' });
  if (value.base === 'monthly_profit_percent' && (value.drawId || value.digits)) context.addIssue({ code: 'custom', path: ['base'], message: 'La utilidad mensual se configura por vendedor y no admite filtros de sorteo o modalidad.' });
  if (value.base === 'monthly_profit_percent' && value.effectiveTo) context.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'La función de liquidación mensual mantiene la regla activa hasta que Administración la desactive.' });
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) context.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'La fecha final debe ser igual o posterior a la inicial.' });
}
const schema = schemaShape.superRefine(refineCommission);
const updateSchema = schemaShape.extend({ reason: z.string().trim().min(5).max(500) }).superRefine(refineCommission);

async function requireCommissionAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.actor || !request.database?.client || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' }); return null;
  }
  if (request.actor.role !== 'admin') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Solo Administración puede configurar comisiones.' }); return null;
  }
  const allowed = await request.database.client.query<{ action: string; allowed: boolean }>(
    'SELECT p.action, app.fn_can($1, p.action) AS allowed FROM unnest(ARRAY[\'commission.manage\', \'finance.manage\']) AS p(action)', [request.actor.id],
  );
  if (allowed.rows.some((item) => !item.allowed)) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene autorización para configurar comisiones.' }); return null;
  }
  return { db: request.database.client, actor: request.actor, tenant: request.tenant };
}

export async function adminCommissionRoutes(app: FastifyInstance) {
  app.get('/commission-plans', async (request, reply) => {
    const context = await requireCommissionAdmin(request, reply); if (!context) return reply;
    const [plans, sellers, draws] = await Promise.all([
      context.db.query(
        `SELECT cp.id, cp.seller_id AS "sellerId", u.full_name AS "sellerName", cp.draw_id AS "drawId", d.name AS "drawName", cp.digits, cp.base,
                cp.percent_bp AS "percentBp", cp.fixed_cents::text AS "fixedCents", cp.effective_from::text AS "effectiveFrom", cp.effective_to::text AS "effectiveTo",
                cp.is_active AS "isActive", cp.created_at AS "createdAt"
           FROM app.commission_plans cp LEFT JOIN app.users u ON u.id = cp.seller_id AND u.tenant_id = cp.tenant_id
           LEFT JOIN app.draws d ON d.id = cp.draw_id AND d.tenant_id = cp.tenant_id
          WHERE cp.tenant_id = $1 ORDER BY cp.is_active DESC, cp.created_at DESC LIMIT 200`, [context.tenant.id]),
      context.db.query('SELECT id, full_name AS "fullName" FROM app.users WHERE tenant_id = $1 AND role = \'seller\' AND is_active ORDER BY full_name', [context.tenant.id]),
      context.db.query('SELECT id, name FROM app.draws WHERE tenant_id = $1 AND is_active ORDER BY sort_order, name', [context.tenant.id]),
    ]);
    return { items: plans.rows, sellers: sellers.rows, draws: draws.rows };
  });

  app.post('/commission-plans', async (request, reply) => {
    const context = await requireCommissionAdmin(request, reply); if (!context) return reply;
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: parsed.error.issues[0]?.message ?? 'Revisa la configuración de la comisión.' });
    const data = parsed.data;
    if (data.base === 'monthly_profit_percent' && data.effectiveFrom > new Date().toLocaleDateString('en-CA', { timeZone: context.tenant.timezone })) {
      return reply.code(400).send({ code: 'INVALID_EFFECTIVE_DATE', message: 'La comisión mensual entra en vigor ahora y permanece activa hasta su desactivación.' });
    }
    const validScope = await context.db.query<{ valid: boolean }>(
      `SELECT ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM app.users WHERE id = $1 AND tenant_id = $3 AND role = 'seller' AND is_active))
         AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM app.draws WHERE id = $2 AND tenant_id = $3 AND is_active)) AS valid`,
      [data.sellerId ?? null, data.drawId ?? null, context.tenant.id],
    );
    if (!validScope.rows[0]?.valid) return reply.code(400).send({ code: 'INVALID_SCOPE', message: 'El vendedor o sorteo elegido no está disponible.' });
    const overlap = await context.db.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM app.commission_plans cp WHERE cp.tenant_id = $1 AND cp.is_active
        AND cp.seller_id IS NOT DISTINCT FROM $2::uuid AND cp.draw_id IS NOT DISTINCT FROM $3::uuid AND cp.digits IS NOT DISTINCT FROM $4::smallint
        AND ((cp.base = 'monthly_profit_percent' AND $5 = 'monthly_profit_percent') OR (cp.base <> 'monthly_profit_percent' AND $5 <> 'monthly_profit_percent'))
        AND cp.effective_from <= COALESCE($7::date, 'infinity'::date) AND COALESCE(cp.effective_to, 'infinity'::date) >= $6::date) AS exists`,
      [context.tenant.id, data.sellerId ?? null, data.drawId ?? null, data.digits ?? null, data.base, data.effectiveFrom, data.effectiveTo ?? null],
    );
    if (overlap.rows[0]?.exists) return reply.code(409).send({ code: 'PLAN_SCOPE_OVERLAP', message: 'Ya hay un plan activo para ese alcance y periodo. Desactívalo o elige fechas sin cruce.' });
    const inserted = await context.db.query<{ id: string }>(
      `INSERT INTO app.commission_plans (tenant_id, seller_id, draw_id, digits, base, percent_bp, fixed_cents, effective_from, effective_to)
       VALUES ($1,$2,$3,$4,$5::app.commission_base,$6,$7,$8::date,$9::date) RETURNING id`,
      [context.tenant.id, data.sellerId ?? null, data.drawId ?? null, data.digits ?? null, data.base, data.percentBp ?? null, data.fixedCents ?? null, data.effectiveFrom, data.effectiveTo ?? null],
    );
    return reply.code(201).send({ id: inserted.rows[0].id });
  });

  app.patch('/commission-plans/:id', async (request, reply) => {
    const context = await requireCommissionAdmin(request, reply); if (!context) return reply;
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const parsed = updateSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: parsed.success ? 'Identificador de regla no válido.' : parsed.error.issues[0]?.message ?? 'Revisa la configuración de la comisión.' });
    const data = parsed.data;
    if (data.base === 'monthly_profit_percent' && data.effectiveFrom > new Date().toLocaleDateString('en-CA', { timeZone: context.tenant.timezone })) {
      return reply.code(400).send({ code: 'INVALID_EFFECTIVE_DATE', message: 'La comisión mensual entra en vigor ahora y permanece activa hasta su desactivación.' });
    }
    const validScope = await context.db.query<{ valid: boolean }>(
      `SELECT ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM app.users WHERE id = $1 AND tenant_id = $3 AND role = 'seller' AND is_active))
         AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM app.draws WHERE id = $2 AND tenant_id = $3 AND is_active)) AS valid`,
      [data.sellerId ?? null, data.drawId ?? null, context.tenant.id],
    );
    if (!validScope.rows[0]?.valid) return reply.code(400).send({ code: 'INVALID_SCOPE', message: 'El vendedor o sorteo elegido no está disponible.' });
    const overlap = await context.db.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM app.commission_plans cp WHERE cp.tenant_id = $1 AND cp.id <> $8 AND cp.is_active
        AND cp.seller_id IS NOT DISTINCT FROM $2::uuid AND cp.draw_id IS NOT DISTINCT FROM $3::uuid AND cp.digits IS NOT DISTINCT FROM $4::smallint
        AND ((cp.base = 'monthly_profit_percent' AND $5 = 'monthly_profit_percent') OR (cp.base <> 'monthly_profit_percent' AND $5 <> 'monthly_profit_percent'))
        AND cp.effective_from <= COALESCE($7::date, 'infinity'::date) AND COALESCE(cp.effective_to, 'infinity'::date) >= $6::date) AS exists`,
      [context.tenant.id, data.sellerId ?? null, data.drawId ?? null, data.digits ?? null, data.base, data.effectiveFrom, data.effectiveTo ?? null, params.data.id],
    );
    if (overlap.rows[0]?.exists) return reply.code(409).send({ code: 'PLAN_SCOPE_OVERLAP', message: 'Ya hay otra regla activa para ese alcance y periodo. Ajusta su vigencia o retírala antes de publicar.' });
    await context.db.query("SELECT set_config('app.audit_reason', $1, true)", [data.reason]);
    const updated = await context.db.query(
      `UPDATE app.commission_plans
          SET seller_id = $3, draw_id = $4, digits = $5, base = $6::app.commission_base,
              percent_bp = $7, fixed_cents = $8, effective_from = $9::date, effective_to = $10::date, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND is_active RETURNING id`,
      [params.data.id, context.tenant.id, data.sellerId ?? null, data.drawId ?? null, data.digits ?? null, data.base, data.percentBp ?? null, data.fixedCents ?? null, data.effectiveFrom, data.effectiveTo ?? null],
    );
    if (!updated.rowCount) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'No encontramos una regla activa para actualizar.' });
    return { id: params.data.id, updated: true, isActive: true };
  });

  app.patch('/commission-plans/:id/active', async (request, reply) => {
    const context = await requireCommissionAdmin(request, reply); if (!context) return reply;
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ isActive: z.boolean(), reason: z.string().trim().min(5).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Indica el estado y el motivo del cambio.' });
    if (body.data.isActive) {
      const overlap = await context.db.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM app.commission_plans target JOIN app.commission_plans other ON other.tenant_id = target.tenant_id
            WHERE target.id = $1 AND target.tenant_id = $2 AND other.id <> target.id AND other.is_active
              AND other.seller_id IS NOT DISTINCT FROM target.seller_id AND other.draw_id IS NOT DISTINCT FROM target.draw_id
              AND other.digits IS NOT DISTINCT FROM target.digits
              AND ((other.base = 'monthly_profit_percent' AND target.base = 'monthly_profit_percent') OR (other.base <> 'monthly_profit_percent' AND target.base <> 'monthly_profit_percent'))
              AND other.effective_from <= COALESCE(target.effective_to, 'infinity'::date) AND COALESCE(other.effective_to, 'infinity'::date) >= target.effective_from
         ) AS exists`,
        [params.data.id, context.tenant.id],
      );
      if (overlap.rows[0]?.exists) return reply.code(409).send({ code: 'PLAN_SCOPE_OVERLAP', message: 'No se puede reactivar: otra regla activa ya cubre ese alcance y periodo.' });
    }
    await context.db.query("SELECT set_config('app.audit_reason', $1, true)", [body.data.reason]);
    const result = await context.db.query(
      'UPDATE app.commission_plans SET is_active = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [params.data.id, context.tenant.id, body.data.isActive],
    );
    if (!result.rowCount) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'No encontramos este plan de comisión.' });
    return { id: params.data.id, isActive: body.data.isActive };
  });
}
