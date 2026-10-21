import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

async function requireActor(request: FastifyRequest, reply: FastifyReply) {
  if (!request.actor || !request.database?.client || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  return { actor: request.actor, db: request.database.client, tenant: request.tenant };
}

const ticketCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,32}$/);
const withdrawalBody = z.object({ prizeId: z.string().uuid(), idempotencyKey: z.string().uuid().optional() });

export async function prizeRoutes(app: FastifyInstance) {
  app.get('/prizes/locations', async (request, reply) => {
    const context = await requireActor(request, reply);
    if (!context) return reply;
    if (!['admin', 'worker'].includes(context.actor.role)) return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu rol no puede registrar pagos de premios.' });
    const permission = await context.db.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [context.actor.id, 'prize.pay']);
    if (!permission.rows[0]?.allowed) return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para pagar premios.' });
    if (context.actor.role === 'worker') {
      const profile = await context.db.query<{ can_pay_prizes: boolean }>('SELECT can_pay_prizes FROM app.staff_profiles WHERE user_id = $1 AND tenant_id = $2', [context.actor.id, context.tenant.id]);
      if (!profile.rows[0]?.can_pay_prizes || !context.actor.locationId) return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no está autorizada para pagar premios.' });
    }
    const locations = await context.db.query('SELECT id, name, city FROM app.locations WHERE tenant_id = $1 AND is_active AND ($2::uuid IS NULL OR id = $2) ORDER BY name', [context.tenant.id, context.actor.role === 'worker' ? context.actor.locationId : null]);
    return { items: locations.rows };
  });

  app.get('/prizes/mine', async (request, reply) => {
    const context = await requireActor(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT p.id, t.code AS "ticketCode", d.name AS "drawName", s.draw_date::text AS "drawDate",
              p.suerte_no AS "suerteNo", p.suerte_name AS "suerteName", p.number,
              p.prize_cents::text AS "prizeCents", p.status, p.expires_on::text AS "expiresOn"
         FROM app.prizes p
         JOIN app.tickets t ON t.id = p.ticket_id AND t.tenant_id = p.tenant_id
         JOIN app.orders o ON o.id = t.order_id AND o.tenant_id = t.tenant_id
         JOIN app.draw_sessions s ON s.id = t.session_id AND s.tenant_id = t.tenant_id
         JOIN app.draws d ON d.id = s.draw_id AND d.tenant_id = s.tenant_id
        WHERE p.tenant_id = $1 AND o.user_id = $2
        ORDER BY p.created_at DESC LIMIT 100`, [context.tenant.id, context.actor.id],
    );
    return { items: result.rows };
  });

  app.post('/prizes/:prizeId/credit', async (request, reply) => {
    const context = await requireActor(request, reply);
    if (!context) return reply;
    const id = z.string().uuid().safeParse((request.params as { prizeId?: string }).prizeId);
    if (!id.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Premio no válido.' });
    const result = await context.db.query('SELECT app.fn_credit_prize_to_wallet($1, $2) AS ledger_id', [id.data, context.actor.id]);
    return { ledgerId: result.rows[0].ledger_id };
  });

  app.post('/prizes/:prizeId/withdrawal', async (request, reply) => {
    const context = await requireActor(request, reply);
    if (!context) return reply;
    const id = z.string().uuid().safeParse((request.params as { prizeId?: string }).prizeId);
    const body = withdrawalBody.safeParse({ ...(request.body && typeof request.body === 'object' ? request.body : {}), prizeId: id.success ? id.data : undefined });
    if (!body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Premio no válido.' });
    const idempotencyKey = body.data.idempotencyKey ?? randomUUID();
    const result = await context.db.query('SELECT app.fn_request_withdrawal($1, 0, $2, $3) AS withdrawal_id', [context.actor.id, body.data.prizeId, idempotencyKey]);
    return reply.code(201).send({ withdrawalId: result.rows[0].withdrawal_id });
  });

  app.post('/prizes/validate', async (request, reply) => {
    const context = await requireActor(request, reply);
    if (!context) return reply;
    if (!['admin', 'worker'].includes(context.actor.role)) return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu rol no puede validar premios.' });
    const body = z.object({ ticketCode }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Ingresa un código de ticket válido.' });
    const permission = await context.db.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [context.actor.id, 'prize.validate']);
    if (!permission.rows[0]?.allowed) return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para validar premios.' });
    const result = await context.db.query(
      'SELECT tkt_id AS "ticketId", prz_id AS "prizeId", suerte, suerte_label AS "suerteLabel", num, amount::text, prz_status AS status, msg FROM app.fn_validate_prize($1, $2)',
      [body.data.ticketCode, context.actor.id],
    );
    return { ticketCode: body.data.ticketCode, prizes: result.rows };
  });

  app.post('/prizes/pay', async (request, reply) => {
    const context = await requireActor(request, reply);
    if (!context) return reply;
    if (!['admin', 'worker'].includes(context.actor.role)) return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu rol no puede pagar premios.' });
    const body = z.object({ ticketId: z.string().uuid(), locationId: z.string().uuid().nullable(), method: z.enum(['cash', 'transfer']), proof: z.string().trim().max(300).optional() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa los datos del pago.' });
    const permission = await context.db.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [context.actor.id, 'prize.pay']);
    if (!permission.rows[0]?.allowed) return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para pagar premios.' });
    const locationId = body.data.locationId ?? context.actor.locationId;
    if (context.actor.role === 'worker' && (!locationId || locationId !== context.actor.locationId)) return reply.code(403).send({ code: 'SIN_PERMISO', message: 'El pago debe registrarse en tu local asignado.' });
    if (locationId) {
      const location = await context.db.query('SELECT 1 FROM app.locations WHERE id = $1 AND tenant_id = $2 AND is_active', [locationId, context.tenant.id]);
      if (!location.rowCount) return reply.code(400).send({ code: 'INVALID_LOCATION', message: 'Selecciona un local activo.' });
    }
    const result = await context.db.query('SELECT app.fn_confirm_prize_payment($1, $2, $3, $4, $5)::text AS amount_cents', [body.data.ticketId, context.actor.id, locationId, body.data.method, body.data.proof ?? null]);
    return { amountCents: result.rows[0].amount_cents };
  });
}

const withdrawalTransition = z.object({
  withdrawalId: z.string().uuid(),
  status: z.enum(['in_review', 'approved', 'paid', 'rejected', 'cancelled']),
  reason: z.string().trim().max(500).optional(),
  proof: z.string().trim().max(300).optional(),
});

export async function adminWithdrawalRoutes(app: FastifyInstance) {
  app.get('/withdrawals', async (request, reply) => {
    const context = await requireActor(request, reply);
    if (!context) return reply;
    if (context.actor.role !== 'admin') return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Solo Administración puede gestionar retiros.' });
    const permission = await context.db.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [context.actor.id, 'withdrawal.manage']);
    if (!permission.rows[0]?.allowed) return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para gestionar retiros.' });
    const result = await context.db.query(
      `SELECT w.id, w.amount_cents::text AS "amountCents", w.status, w.requested_at AS "requestedAt",
              w.proof_key AS "proofKey", w.rejection_reason AS "rejectionReason", u.full_name AS "userName", u.phone,
              t.code AS "ticketCode", p.suerte_name AS "suerteName"
         FROM app.withdrawals w JOIN app.users u ON u.id = w.user_id AND u.tenant_id = w.tenant_id
         LEFT JOIN app.prizes p ON p.id = w.source_prize_id AND p.tenant_id = w.tenant_id
         LEFT JOIN app.tickets t ON t.id = p.ticket_id AND t.tenant_id = p.tenant_id
        WHERE w.tenant_id = $1 AND w.status IN ('requested','in_review','approved')
        ORDER BY w.requested_at LIMIT 200`, [context.tenant.id],
    );
    return { items: result.rows };
  });

  app.post('/withdrawals/advance', async (request, reply) => {
    const context = await requireActor(request, reply);
    if (!context) return reply;
    if (context.actor.role !== 'admin') return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Solo Administración puede gestionar retiros.' });
    const body = withdrawalTransition.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa los datos de la decisión.' });
    const permission = await context.db.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [context.actor.id, 'withdrawal.manage']);
    if (!permission.rows[0]?.allowed) return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para gestionar retiros.' });
    await context.db.query('SELECT app.fn_advance_withdrawal($1, $2, $3::app.withdrawal_status, $4, $5)', [body.data.withdrawalId, context.actor.id, body.data.status, body.data.reason ?? null, body.data.proof ?? null]);
    return { ok: true };
  });
}
