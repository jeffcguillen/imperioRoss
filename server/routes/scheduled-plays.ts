import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const createSchema = z.object({
  drawId: z.string().uuid(),
  digits: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  number: z.string().regex(/^\d{2,4}$/),
  planId: z.string().uuid().optional(),
  amountCents: z.string().regex(/^[1-9]\d{0,11}$/).refine((amount) => BigInt(amount) >= 25n && BigInt(amount) <= 2_000_000_000n && BigInt(amount) % 25n === 0n),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7),
}).superRefine((data, context) => {
  if (data.number.length !== data.digits) context.addIssue({ code: 'custom', path: ['number'], message: 'El número debe coincidir con la modalidad.' });
  if (new Set(data.daysOfWeek).size !== data.daysOfWeek.length) context.addIssue({ code: 'custom', path: ['daysOfWeek'], message: 'No repitas días de la semana.' });
});

const updateSchema = z.object({ status: z.enum(['active', 'paused', 'cancelled']) });

async function requireCustomer(request: FastifyRequest, reply: FastifyReply) {
  if (!request.actor || !request.database?.client || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  if (request.actor.role !== 'client') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Las jugadas programadas están disponibles para cuentas cliente.' });
    return null;
  }
  return { db: request.database.client, actor: request.actor, tenant: request.tenant };
}

export async function scheduledPlayRoutes(app: FastifyInstance) {
  app.get('/scheduled-plays', async (request, reply) => {
    const context = await requireCustomer(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT sp.id, sp.draw_id AS "drawId", d.name AS "drawName", d.draw_time::text AS "drawTime",
              sp.digits, sp.number, sp.plan_id AS "planId", pl.name AS "planName", sp.amount_cents::text AS "amountCents",
              sp.days_of_week AS "daysOfWeek", sp.status, sp.version, sp.created_at AS "createdAt", sp.updated_at AS "updatedAt",
              COALESCE(h.items, '[]'::jsonb) AS history, COALESCE(r.items, '[]'::jsonb) AS runs
         FROM app.scheduled_plays sp
         JOIN app.draws d ON d.id = sp.draw_id AND d.tenant_id = sp.tenant_id
         LEFT JOIN app.plans pl ON pl.id = sp.plan_id AND pl.tenant_id = sp.tenant_id
         LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id', x.id, 'changedAt', x.changed_at, 'oldValue', x.old_value, 'newValue', x.new_value, 'reason', x.reason) ORDER BY x.changed_at DESC) items FROM app.scheduled_play_history x WHERE x.scheduled_play_id = sp.id AND x.tenant_id = sp.tenant_id) h ON true
         LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id', x.id, 'outcome', x.outcome, 'runAt', x.run_at, 'orderId', x.order_id, 'drawDate', s.draw_date) ORDER BY x.run_at DESC) items FROM app.scheduled_play_runs x JOIN app.draw_sessions s ON s.id = x.session_id AND s.tenant_id = x.tenant_id WHERE x.scheduled_play_id = sp.id AND x.tenant_id = sp.tenant_id) r ON true
        WHERE sp.tenant_id = $1 AND sp.user_id = $2
        ORDER BY CASE sp.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, sp.created_at DESC LIMIT 100`,
      [context.tenant.id, context.actor.id],
    );
    const wallet = await context.db.query<{ availableCents: string }>(
      `SELECT available_cents::text AS "availableCents" FROM app.wallets WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`,
      [context.tenant.id, context.actor.id],
    );
    return { items: result.rows, availableCents: wallet.rows[0]?.availableCents ?? '0' };
  });

  app.get('/scheduled-plays/options', async (request, reply) => {
    const context = await requireCustomer(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT d.id AS "drawId", d.name AS "drawName", d.draw_time::text AS "drawTime", d.days_of_week AS "daysOfWeek",
              m.digits, m.min_cents::text AS "minCents", m.step_cents::text AS "stepCents",
              COALESCE(jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name) ORDER BY pl.name) FILTER (WHERE pl.id IS NOT NULL), '[]'::jsonb) AS plans
         FROM app.draws d JOIN app.draw_modalities m ON m.draw_id = d.id AND m.tenant_id = d.tenant_id AND m.enabled
         LEFT JOIN app.plans pl ON pl.draw_id = d.id AND pl.tenant_id = d.tenant_id AND pl.digits = m.digits AND pl.is_active
           AND EXISTS (SELECT 1 FROM app.plan_versions pv WHERE pv.plan_id = pl.id AND pv.is_current)
        WHERE d.tenant_id = $1 AND d.is_active
         GROUP BY d.id, m.digits, m.min_cents, m.step_cents ORDER BY d.sort_order, d.name, m.digits`,
      [context.tenant.id],
    );
    return { items: result.rows };
  });

  app.post('/scheduled-plays', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: parsed.error.issues[0]?.message ?? 'Revisa los datos de la programación.' });
    const context = await requireCustomer(request, reply);
    if (!context) return reply;
    const { drawId, digits, number, planId, amountCents, daysOfWeek } = parsed.data;
    const eligible = await context.db.query<{ valid: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM app.draws d JOIN app.draw_modalities m ON m.draw_id = d.id AND m.tenant_id = d.tenant_id AND m.digits = $3 AND m.enabled
         WHERE d.id = $1 AND d.tenant_id = $2 AND d.is_active AND $4::bigint >= m.min_cents AND ($4::bigint - m.min_cents) % m.step_cents = 0
           AND $5::smallint[] <@ d.days_of_week
           AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM app.plans p JOIN app.plan_versions pv ON pv.plan_id = p.id AND pv.is_current WHERE p.id = $6 AND p.draw_id = d.id AND p.tenant_id = d.tenant_id AND p.digits = $3 AND p.is_active))) AS valid`,
      [drawId, context.tenant.id, digits, amountCents, daysOfWeek, planId ?? null],
    );
    if (!eligible.rows[0]?.valid) return reply.code(400).send({ code: 'SCHEDULE_NOT_ALLOWED', message: 'El sorteo, modalidad, plan, importe o frecuencia ya no están disponibles.' });
    const inserted = await context.db.query<{ id: string }>(
      `INSERT INTO app.scheduled_plays (tenant_id, user_id, draw_id, digits, number, plan_id, amount_cents, days_of_week)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [context.tenant.id, context.actor.id, drawId, digits, number, planId ?? null, amountCents, daysOfWeek],
    );
    return reply.code(201).send({ id: inserted.rows[0].id });
  });

  app.patch('/scheduled-plays/:id', async (request, reply) => {
    const id = z.string().uuid().safeParse((request.params as { id?: string }).id);
    const body = updateSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'La solicitud no es válida.' });
    const context = await requireCustomer(request, reply);
    if (!context) return reply;
    const changed = await context.db.query(
      `UPDATE app.scheduled_plays SET status = $4::app.scheduled_status, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND status IN ('active','paused')
          AND ($4 <> 'active' OR status = 'paused')
        RETURNING id`,
      [id.data, context.tenant.id, context.actor.id, body.data.status],
    );
    if (!changed.rowCount) return reply.code(404).send({ code: 'SCHEDULE_NOT_FOUND', message: 'No encontramos una programación que puedas cambiar.' });
    return { id: id.data, status: body.data.status };
  });
}
