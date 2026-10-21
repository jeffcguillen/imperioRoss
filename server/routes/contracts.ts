import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const contractBody = z.object({
  sellerId: z.string().uuid(), clientName: z.string().trim().min(2).max(120), clientPhone: z.string().trim().min(7).max(30).optional().or(z.literal('')),
  drawId: z.string().uuid(), digits: z.union([z.literal(2), z.literal(3), z.literal(4)]), number: z.string().regex(/^\d{2,4}$/),
  planId: z.string().uuid().optional(), amountCents: z.string().regex(/^[1-9]\d{0,11}$/).refine((value) => BigInt(value) >= 25n && BigInt(value) % 25n === 0n),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7), startDate: z.string().date(), endDate: z.string().date().nullable().optional(),
  collection: z.enum(['cash', 'transfer', 'credit']),
}).superRefine((value, context) => {
  if (value.number.length !== value.digits) context.addIssue({ code: 'custom', path: ['number'], message: 'El número debe coincidir con la modalidad.' });
  if (new Set(value.daysOfWeek).size !== value.daysOfWeek.length) context.addIssue({ code: 'custom', path: ['daysOfWeek'], message: 'No repitas días de la semana.' });
  if (value.endDate && value.endDate < value.startDate) context.addIssue({ code: 'custom', path: ['endDate'], message: 'La fecha final debe ser igual o posterior a la fecha inicial.' });
});

async function requireContractAccess(request: FastifyRequest, reply: FastifyReply, adminOnly = false) {
  if (!request.actor || !request.database?.client || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' }); return null;
  }
  const actor = request.actor;
  if (adminOnly ? actor.role !== 'admin' : !['admin', 'seller'].includes(actor.role)) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: adminOnly ? 'Solo Administración puede gestionar contratas.' : 'Tu rol no puede consultar contratas.' }); return null;
  }
  if (actor.role === 'seller' && !adminOnly) {
    const permission = await request.database.client.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [actor.id, 'sale.register']);
    if (!permission.rows[0]?.allowed) { await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para operar contratas.' }); return null; }
  }
  if (actor.role === 'admin' && !adminOnly) {
    const permission = await request.database.client.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [actor.id, 'report.view']);
    if (!permission.rows[0]?.allowed) { await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para consultar contratas.' }); return null; }
  }
  if (adminOnly) {
    const permission = await request.database.client.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [actor.id, 'finance.manage']);
    if (!permission.rows[0]?.allowed) { await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para gestionar contratas.' }); return null; }
  }
  return { actor, db: request.database.client, tenant: request.tenant };
}

export async function contractRoutes(app: FastifyInstance) {
  app.get('/contracts', async (request, reply) => {
    const context = await requireContractAccess(request, reply); if (!context) return reply;
    const result = await context.db.query(
      `SELECT c.id, c.client_name AS "clientName", c.client_phone AS "clientPhone", c.draw_id AS "drawId", d.name AS "drawName",
              c.digits, c.number, c.plan_id AS "planId", p.name AS "planName", c.amount_cents::text AS "amountCents", c.days_of_week AS "daysOfWeek",
              c.start_date::text AS "startDate", c.end_date::text AS "endDate", c.collection, c.status, c.created_by AS "sellerId", u.full_name AS "sellerName",
              COUNT(sl.id)::int AS "slotCount", COUNT(sl.id) FILTER (WHERE sl.status = 'reserved')::int AS "reservedCount",
              COUNT(sl.id) FILTER (WHERE sl.status = 'sold')::int AS "soldCount",
              COALESCE(SUM(r.amount_cents - r.collected_cents),0)::text AS "receivableCents", COALESCE(SUM(r.collected_cents),0)::text AS "collectedCents",
              COALESCE(jsonb_agg(jsonb_build_object('id', sl.id, 'sessionId', s.id, 'drawDate', s.draw_date, 'drawsAt', s.draws_at, 'closesAt', s.closes_at, 'status', sl.status, 'canSell', s.closes_at > now() AND s.status IN ('scheduled','open'), 'orderId', sl.order_id) ORDER BY s.draws_at) FILTER (WHERE sl.id IS NOT NULL), '[]'::jsonb) AS slots
         FROM app.contratas c JOIN app.draws d ON d.id = c.draw_id AND d.tenant_id = c.tenant_id
         LEFT JOIN app.plans p ON p.id = c.plan_id AND p.tenant_id = c.tenant_id
         LEFT JOIN app.users u ON u.id = c.created_by AND u.tenant_id = c.tenant_id
         LEFT JOIN app.contrata_slots sl ON sl.contrata_id = c.id AND sl.tenant_id = c.tenant_id
         LEFT JOIN app.draw_sessions s ON s.id = sl.session_id AND s.tenant_id = sl.tenant_id
         LEFT JOIN app.receivables r ON r.contrata_slot_id = sl.id AND r.tenant_id = sl.tenant_id
        WHERE c.tenant_id = $1 AND ($2::text = 'admin' OR c.created_by = $3)
        GROUP BY c.id, d.name, p.name, u.full_name ORDER BY c.created_at DESC LIMIT 100`,
      [context.tenant.id, context.actor.role, context.actor.id],
    );
    return { items: result.rows };
  });

  app.get('/admin/contracts/options', async (request, reply) => {
    const context = await requireContractAccess(request, reply, true); if (!context) return reply;
    const [sellers, draws] = await Promise.all([
      context.db.query('SELECT id, full_name AS "fullName" FROM app.users WHERE tenant_id = $1 AND role = \'seller\' AND is_active ORDER BY full_name', [context.tenant.id]),
      context.db.query(
        `SELECT d.id AS "drawId", d.name AS "drawName", d.days_of_week AS "drawDays", m.digits, m.min_cents::text AS "minCents", m.step_cents::text AS "stepCents",
                COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.name) FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb) AS plans
           FROM app.draws d JOIN app.draw_modalities m ON m.draw_id = d.id AND m.tenant_id = d.tenant_id AND m.enabled
           LEFT JOIN app.plans p ON p.draw_id = d.id AND p.tenant_id = d.tenant_id AND p.digits = m.digits AND p.is_active
             AND EXISTS (SELECT 1 FROM app.plan_versions pv WHERE pv.plan_id = p.id AND pv.is_current)
          WHERE d.tenant_id = $1 AND d.is_active GROUP BY d.id, m.digits, m.min_cents, m.step_cents ORDER BY d.sort_order, d.name, m.digits`, [context.tenant.id]),
    ]);
    return { sellers: sellers.rows, draws: draws.rows };
  });

  app.post('/admin/contracts', async (request, reply) => {
    const context = await requireContractAccess(request, reply, true); if (!context) return reply;
    const parsed = contractBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: parsed.error.issues[0]?.message ?? 'Revisa los datos de la contrata.' });
    const data = parsed.data;
    const valid = await context.db.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM app.users u JOIN app.draws d ON d.tenant_id = u.tenant_id
        JOIN app.draw_modalities m ON m.draw_id = d.id AND m.tenant_id = d.tenant_id AND m.digits = $4 AND m.enabled
        WHERE u.id = $1 AND u.tenant_id = $2 AND u.role = 'seller' AND u.is_active AND d.id = $3 AND d.is_active
          AND $5::bigint >= m.min_cents AND ($5::bigint - m.min_cents) % m.step_cents = 0
          AND $6::smallint[] <@ d.days_of_week
          AND ($7::uuid IS NULL OR EXISTS (SELECT 1 FROM app.plans p JOIN app.plan_versions pv ON pv.plan_id = p.id AND pv.is_current WHERE p.id = $7 AND p.tenant_id = d.tenant_id AND p.draw_id = d.id AND p.digits = $4 AND p.is_active))) AS ok`,
      [data.sellerId, context.tenant.id, data.drawId, data.digits, data.amountCents, data.daysOfWeek, data.planId ?? null],
    );
    if (!valid.rows[0]?.ok) return reply.code(400).send({ code: 'CONTRACT_NOT_ALLOWED', message: 'Vendedor, sorteo, plan, modalidad, importe o días no disponibles.' });
    if (data.collection === 'credit') await context.db.query("SELECT set_config('app.audit_reason', 'Autorización de crédito de contrata', true)");
    const result = await context.db.query<{ id: string }>(
      `INSERT INTO app.contratas (tenant_id, client_name, client_phone, draw_id, digits, number, plan_id, amount_cents, days_of_week, start_date, end_date, collection, credit_authorized_by, credit_authorized_at, created_by)
       VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10::date,$11::date,$12::app.collection_mode,CASE WHEN $12 = 'credit' THEN $13::uuid ELSE NULL END,CASE WHEN $12 = 'credit' THEN now() ELSE NULL END,$14) RETURNING id`,
      [context.tenant.id, data.clientName, data.clientPhone ?? '', data.drawId, data.digits, data.number, data.planId ?? null, data.amountCents, data.daysOfWeek, data.startDate, data.endDate ?? null, data.collection, context.actor.id, data.sellerId],
    );
    await context.db.query(
      `SELECT app.fn_materialize_contrata_slots($1,
        GREATEST($2::date, (now() AT TIME ZONE $4)::date),
        COALESCE($3::date, (now() AT TIME ZONE $4)::date + 60))`,
      [context.tenant.id, data.startDate, data.endDate ?? null, context.tenant.timezone],
    );
    return reply.code(201).send({ id: result.rows[0].id });
  });

  app.post('/contracts/slots/:slotId/sell', async (request, reply) => {
    const slotId = z.string().uuid().safeParse((request.params as { slotId?: string }).slotId);
    const body = z.object({ idempotencyKey: z.string().uuid() }).safeParse(request.body);
    if (!slotId.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'La solicitud de venta no es válida.' });
    const context = await requireContractAccess(request, reply); if (!context) return reply;
    if (context.actor.role !== 'seller' || !context.actor.locationId) return reply.code(403).send({ code: 'LOCAL_REQUERIDO', message: 'Solo un vendedor con local asignado puede vender esta contrata.' });
    const idem = `contrata:${slotId.data}:${body.data.idempotencyKey}`;
    const replay = async () => context.db.query<{ orderId: string; idempotencyKey: string }>(
      `SELECT o.id AS "orderId", o.idempotency_key AS "idempotencyKey" FROM app.contrata_slots sl JOIN app.orders o ON o.id = sl.order_id AND o.tenant_id = sl.tenant_id
        WHERE sl.id = $1 AND sl.tenant_id = $2 AND sl.sold_by = $3 AND o.idempotency_key = $4`,
      [slotId.data, context.tenant.id, context.actor.id, idem],
    );
    const previouslySold = await replay();
    if (previouslySold.rowCount) {
      const result = await orderReceipt(context.db, previouslySold.rows[0].orderId, context.tenant.id);
      return reply.code(200).send({ order: result });
    }
    let slot;
    try { slot = await context.db.query<{ orderId: string }>(
      `SELECT app.fn_sell_contrata_slot($1, $2, $3, $4) AS "orderId"
        WHERE EXISTS (SELECT 1 FROM app.contrata_slots s JOIN app.contratas c ON c.id = s.contrata_id AND c.tenant_id = s.tenant_id
          WHERE s.id = $1 AND s.tenant_id = $5 AND c.created_by = $2 AND s.status = 'reserved')`,
      [slotId.data, context.actor.id, context.actor.locationId, idem, context.tenant.id],
    ); } catch (error) {
      const concurrentReplay = await replay();
      if (concurrentReplay.rowCount) {
        const result = await orderReceipt(context.db, concurrentReplay.rows[0].orderId, context.tenant.id);
        return reply.code(200).send({ order: result });
      }
      if (error instanceof Error && error.message.includes('CUPO_NO_DISPONIBLE')) return reply.code(409).send({ code: 'SLOT_NOT_AVAILABLE', message: 'El cupo ya no está disponible. Actualiza la lista.' });
      throw error;
    }
    if (!slot.rowCount) return reply.code(404).send({ code: 'SLOT_NOT_AVAILABLE', message: 'El cupo ya no está disponible o no pertenece a tus contratas.' });
    const ticket = await orderReceipt(context.db, slot.rows[0].orderId, context.tenant.id);
    return reply.code(201).send({ order: ticket });
  });
}

async function orderReceipt(db: import('pg').PoolClient, orderId: string, tenantId: string) {
  const ticket = await db.query<{ purchaseCode: string; status: string; ticketCodes: string[] }>(
    `SELECT o.purchase_code AS "purchaseCode", o.status, COALESCE(array_agg(t.code) FILTER (WHERE t.code IS NOT NULL), ARRAY[]::text[]) AS "ticketCodes"
       FROM app.orders o LEFT JOIN app.tickets t ON t.order_id = o.id AND t.tenant_id = o.tenant_id
      WHERE o.id = $1 AND o.tenant_id = $2 GROUP BY o.id`, [orderId, tenantId],
  );
  return ticket.rows[0];
}
