import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const saleSchema = z.object({
  buyer: z.object({
    fullName: z.string().trim().min(3).max(120),
    phone: z.string().trim().min(7).max(30),
    email: z.string().trim().email().max(254).optional().or(z.literal('')),
    adultConfirmed: z.literal(true),
  }),
  termsConfirmed: z.literal(true),
  items: z.array(z.object({
    drawId: z.string().uuid(), sessionId: z.string().uuid(), digits: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    number: z.string().regex(/^\d{2,4}$/), amountCents: z.string().regex(/^[1-9]\d{0,11}$/), planId: z.string().uuid().optional(),
  })).min(1).max(50),
  idempotencyKey: z.string().uuid(),
});

async function requireSalePermission(request: FastifyRequest, reply: FastifyReply) {
  if (!request.actor || !request.database?.client || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  if (!['worker', 'seller'].includes(request.actor.role)) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu rol no puede registrar ventas en Punto de Venta.' });
    return null;
  }
  const permission = await request.database.client.query<{ allowed: boolean }>(
    'SELECT app.fn_can($1, $2) AS allowed', [request.actor.id, 'sale.register'],
  );
  if (!permission.rows[0]?.allowed) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu usuario no tiene permiso para registrar ventas.' });
    return null;
  }
  if (request.actor.role !== 'admin' && !request.actor.locationId) {
    await reply.code(403).send({ code: 'LOCAL_REQUERIDO', message: 'Tu usuario necesita un local asignado para registrar ventas.' });
    return null;
  }
  return { actor: request.actor, db: request.database.client, tenantId: request.tenant.id };
}

export async function posRoutes(app: FastifyInstance) {
  app.get('/pos/sales', async (request, reply) => {
    const context = await requireSalePermission(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT o.id, o.purchase_code AS "purchaseCode", o.buyer_name AS "buyerName", o.total_cents::text AS "totalCents",
              o.status, o.created_at AS "createdAt", o.on_credit AS "onCredit",
      CASE WHEN o.origin = 'seller' THEN 'seller' ELSE 'worker' END AS origin,
              COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
                'id', t.id, 'code', t.code, 'status', t.status,
                'canVoid', ($2::text = 'worker' AND t.status = 'active' AND app.fn_can($3::uuid, 'ticket.void_own')
                  AND s.status <> 'resulted' AND now() < s.closes_at
                  AND now() <= t.created_at + make_interval(mins => COALESCE(sp.void_window_minutes, 30))
                  AND NOT EXISTS (SELECT 1 FROM app.prizes p WHERE p.ticket_id = t.id AND p.status IN ('paid','credited_to_wallet','withdrawal_requested')))
              )) FILTER (WHERE t.id IS NOT NULL), '[]'::jsonb) AS tickets
         FROM app.orders o
         LEFT JOIN app.tickets t ON t.order_id = o.id AND t.tenant_id = o.tenant_id
         LEFT JOIN app.draw_sessions s ON s.id = t.session_id AND s.tenant_id = t.tenant_id
         LEFT JOIN app.staff_profiles sp ON sp.user_id = $3::uuid AND sp.tenant_id = o.tenant_id
        WHERE o.tenant_id = $1 AND (($2::text = 'worker' AND o.worker_id = $3) OR ($2::text = 'seller' AND o.seller_id = $3))
        GROUP BY o.id ORDER BY o.created_at DESC LIMIT 50`,
      [context.tenantId, context.actor.role, context.actor.id],
    );
    return { items: result.rows };
  });

  app.post('/pos/tickets/:ticketId/void', async (request, reply) => {
    if (!request.actor || !request.database?.client || !request.tenant) {
      return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    }
    if (request.actor.role !== 'worker') return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Solo los trabajadores pueden anular una venta propia desde el POS.' });
    const params = z.object({ ticketId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Indica un motivo de al menos 5 caracteres y un ticket válido.' });
    const db = request.database.client;
    const permission = await db.query<{ allowed: boolean }>('SELECT app.fn_can($1,$2) AS allowed', [request.actor.id, 'ticket.void_own']);
    if (!permission.rows[0]?.allowed) return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para anular ventas propias.' });
    const ticket = await db.query<{ id: string }>(
      `SELECT t.id FROM app.tickets t
         JOIN app.orders o ON o.id=t.order_id AND o.tenant_id=t.tenant_id
        WHERE t.id=$1 AND t.tenant_id=$2 AND o.worker_id=$3 AND t.status='active' FOR UPDATE OF t`,
      [params.data.ticketId, request.tenant.id, request.actor.id],
    );
    if (!ticket.rows[0]) return reply.code(409).send({ code: 'TICKET_NO_ANULABLE', message: 'El ticket no existe, no es una venta propia o ya no está activo.' });
    try {
      await db.query('SELECT app.fn_void_ticket($1,$2,$3,$4)', [ticket.rows[0].id, request.actor.id, body.data.reason, 'none']);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/SIN_PERMISO|TICKET_NO_ANULABLE|PREMIO_YA_PAGADO/.test(message)) return reply.code(409).send({ code: 'TICKET_NO_ANULABLE', message: 'La venta salió de la ventana de anulación o tiene un premio en trámite.' });
      throw error;
    }
    return { ticketId: ticket.rows[0].id, status: 'voided', financialEffect: 'none' };
  });

  app.get('/pos/commissions', async (request, reply) => {
    const context = await requireSalePermission(request, reply);
    if (!context) return reply;
    if (context.actor.role !== 'seller') return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Las comisiones están disponibles para cuentas de vendedor.' });
    const result = await context.db.query(
      `SELECT c.id, c.base_amount_cents::text AS "baseAmountCents", c.commission_cents::text AS "commissionCents",
              c.status, c.generated_at AS "generatedAt", c.paid_at AS "paidAt", d.name AS "drawName", c.digits
         FROM app.commissions c LEFT JOIN app.draws d ON d.id = c.draw_id AND d.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND c.seller_id = $2 ORDER BY c.generated_at DESC LIMIT 100`,
      [context.tenantId, context.actor.id],
    );
    return { items: result.rows };
  });

  app.post('/pos/orders', async (request, reply) => {
    const parsed = saleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa los datos del comprador y cada jugada antes de registrar la venta.' });
    const context = await requireSalePermission(request, reply);
    if (!context) return reply;
    if (parsed.data.items.some((item) => item.number.length !== item.digits)) {
      return reply.code(400).send({ code: 'INVALID_NUMBER', message: 'Cada número debe tener exactamente las cifras de su modalidad.' });
    }

    const items = parsed.data.items.map((item) => ({
      draw_id: item.drawId, session_id: item.sessionId, digits: item.digits, number: item.number,
      amount_cents: item.amountCents, ...(item.planId ? { plan_id: item.planId } : {}),
    }));
    const buyer = { name: parsed.data.buyer.fullName, phone: parsed.data.buyer.phone, email: parsed.data.buyer.email || null, adult: true, terms: parsed.data.termsConfirmed };
    const fingerprint = createHash('sha256').update(JSON.stringify({
      actorId: context.actor.id, role: context.actor.role, buyer,
      items: [...items].sort((a, b) => `${a.session_id}:${a.digits}:${a.number}:${a.plan_id ?? ''}`.localeCompare(`${b.session_id}:${b.digits}:${b.number}:${b.plan_id ?? ''}`)),
    })).digest('hex');
    const { db, actor, tenantId } = context;
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:pos:${parsed.data.idempotencyKey}`]);
    await db.query("INSERT INTO app.idempotency_keys (tenant_id, scope, key, response) VALUES ($1, 'pos-sale', $2, NULL) ON CONFLICT DO NOTHING", [tenantId, parsed.data.idempotencyKey]);
    const previous = await db.query<{ response: { fingerprint: string; result: { order: unknown } } | null }>(
      "SELECT response FROM app.idempotency_keys WHERE tenant_id = $1 AND scope = 'pos-sale' AND key = $2 FOR UPDATE",
      [tenantId, parsed.data.idempotencyKey],
    );
    if (previous.rows[0]?.response) {
      if (previous.rows[0].response.fingerprint !== fingerprint) return reply.code(409).send({ code: 'IDEMPOTENCY_CONFLICT', message: 'Esta clave de venta ya se usó con otros datos.' });
      return reply.send(previous.rows[0].response.result);
    }

    const source = actor.role === 'seller' ? 'seller' : actor.role === 'worker' ? 'worker' : 'direct';
    const created = await db.query<{ id: string }>(
      `SELECT app.fn_submit_order(NULL, $1::jsonb, $2::jsonb, 'cash_counter'::app.payment_method,
              $3::app.sale_origin, $4, $5, $6, $7, true, NULL, false) AS id`,
      [JSON.stringify(buyer), JSON.stringify(items), source, source === 'seller' ? actor.id : null,
        source === 'worker' ? actor.id : null, actor.locationId, parsed.data.idempotencyKey],
    );
    const order = await db.query(
      `SELECT o.id, o.purchase_code AS "purchaseCode", o.status, o.total_cents::text AS "totalCents", o.created_at AS "createdAt",
              COALESCE(jsonb_agg(DISTINCT t.code) FILTER (WHERE t.code IS NOT NULL), '[]'::jsonb) AS "ticketCodes"
         FROM app.orders o LEFT JOIN app.tickets t ON t.order_id = o.id AND t.tenant_id = o.tenant_id
        WHERE o.id = $1 AND o.tenant_id = $2 GROUP BY o.id`, [created.rows[0]?.id, tenantId],
    );
    const result = { order: order.rows[0] };
    await db.query("UPDATE app.idempotency_keys SET response = $3::jsonb WHERE tenant_id = $1 AND scope = 'pos-sale' AND key = $2", [tenantId, parsed.data.idempotencyKey, JSON.stringify({ fingerprint, result })]);
    return reply.code(201).send(result);
  });
}
