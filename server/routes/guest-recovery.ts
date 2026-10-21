import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { env } from '../env.js';

const lookupSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(24).regex(/^(?:#\d{6}|RF-\d{4,10}|[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8})$/),
  phone: z.string().trim().min(7).max(30).regex(/^[+()\d .-]+$/).refine((phone) => phone.replace(/\D/g, '').length >= 7),
});
const verifySchema = lookupSchema.extend({ otp: z.string().regex(/^\d{6}$/) });
const demoOtp = '123456';
const normalizePhone = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('593')) return `+${digits}`;
  if (digits.startsWith('0')) return `+593${digits.slice(1)}`;
  return `+593${digits}`;
};
const isLocalRequest = (ip: string) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);

function hashOtp(tenantId: string, target: string, otp: string) {
  return createHmac('sha256', env.DATABASE_STAFF_URL)
    .update(`${tenantId}:${target}:${otp}`)
    .digest('hex');
}

function mockOtpEnabled(ip: string) {
  return env.NODE_ENV === 'test' || (env.NODE_ENV === 'development' && isLocalRequest(ip));
}

export async function guestRecoveryRoutes(app: FastifyInstance) {
  app.post('/guest-purchases/recovery/start', { config: { rateLimit: { max: 4, timeWindow: '15 minutes' } } }, async (request, reply) => {
    if (!mockOtpEnabled(request.ip)) {
      return reply.code(503).send({ code: 'OTP_PROVIDER_UNAVAILABLE', message: 'La recuperación por SMS no está disponible en este entorno.' });
    }
    const parsed = lookupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Ingresa el código de compra o ticket y un teléfono válido.' });
    const db = request.database?.client;
    const tenant = request.tenant;
    if (!db || !tenant) throw new Error('REQUEST_CONTEXT_MISSING');
    const phone = normalizePhone(parsed.data.phone);
    const target = `${phone}:${parsed.data.code}`;
    // Run the same tenant-scoped lookup for matching and non-matching data. The response never confirms
    // whether the purchase exists; only the verified step may return an order.
    await db.query('SELECT app.fn_find_guest_order($1, $2)', [parsed.data.code, phone]);
    const limit = await db.query(
      `SELECT count(*)::int AS count FROM app.otp_codes
        WHERE tenant_id = $1 AND purpose = 'guest_lookup'::app.otp_purpose AND target = $2
          AND created_at > now() - interval '15 minutes'`,
      [tenant.id, target],
    );
    // Keep the same response for throttled and accepted requests to avoid an existence oracle.
    if ((limit.rows[0]?.count ?? 0) < 4) {
      const codeHash = hashOtp(tenant.id, target, demoOtp);
      await db.query(
        `UPDATE app.otp_codes SET consumed_at = now()
          WHERE tenant_id = $1 AND purpose = 'guest_lookup'::app.otp_purpose AND target = $2 AND consumed_at IS NULL`,
        [tenant.id, target],
      );
      await db.query(
        `INSERT INTO app.otp_codes (tenant_id, purpose, target, code_hash, expires_at)
         VALUES ($1, 'guest_lookup'::app.otp_purpose, $2, $3, now() + interval '10 minutes')`,
        [tenant.id, target, codeHash],
      );
    }
    return reply.code(202).send({ accepted: true, message: 'Si los datos corresponden a una compra, podrás continuar con el código de verificación.' });
  });

  app.post('/guest-purchases/recovery/verify', { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } }, async (request, reply) => {
    if (!mockOtpEnabled(request.ip)) {
      return reply.code(503).send({ code: 'OTP_PROVIDER_UNAVAILABLE', message: 'La recuperación por SMS no está disponible en este entorno.' });
    }
    const parsed = verifySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa el código, el teléfono y el código de verificación.' });
    const db = request.database?.client;
    const tenant = request.tenant;
    if (!db || !tenant) throw new Error('REQUEST_CONTEXT_MISSING');
    const phone = normalizePhone(parsed.data.phone);
    const target = `${phone}:${parsed.data.code}`;
    const valid = await db.query<{ valid: boolean }>(
      `SELECT app.fn_check_otp('guest_lookup'::app.otp_purpose, $1, $2) AS valid`,
      [target, hashOtp(tenant.id, target, parsed.data.otp)],
    );
    if (!valid.rows[0]?.valid) return reply.code(400).send({ code: 'OTP_INVALID', message: 'El código venció o no es válido. Solicita uno nuevo e inténtalo otra vez.' });

    const found = await db.query<{ order_id: string }>('SELECT app.fn_find_guest_order($1, $2) AS order_id', [parsed.data.code, phone]);
    if (!found.rows[0]?.order_id) return reply.code(404).send({ code: 'GUEST_PURCHASE_NOT_FOUND', message: 'No encontramos una compra con esos datos. Revisa el código y el teléfono.' });
    const result = await db.query(
      `SELECT o.id, o.purchase_code AS "purchaseCode", o.status, o.total_cents::text AS "totalCents",
              o.created_at AS "createdAt", o.payment_method AS "paymentMethod",
              COALESCE(lines.items, '[]'::jsonb) AS items
         FROM app.orders o
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
             'ticketCode', t.code, 'ticketStatus', t.status, 'drawName', d.name,
             'drawDate', s.draw_date::text, 'digits', oi.digits, 'number', oi.number,
             'amountCents', oi.amount_cents::text, 'itemStatus', oi.status
           ) ORDER BY oi.created_at) AS items
             FROM app.order_items oi
             JOIN app.draw_sessions s ON s.id = oi.session_id AND s.tenant_id = oi.tenant_id
             JOIN app.draws d ON d.id = oi.draw_id AND d.tenant_id = oi.tenant_id
             LEFT JOIN app.tickets t ON t.id = oi.ticket_id AND t.tenant_id = oi.tenant_id
            WHERE oi.order_id = o.id AND oi.tenant_id = o.tenant_id
         ) lines ON true
        WHERE o.id = $1 AND o.tenant_id = $2 AND o.user_id IS NULL
        LIMIT 1`,
      [found.rows[0].order_id, tenant.id],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'GUEST_PURCHASE_NOT_FOUND', message: 'No encontramos una compra con esos datos. Revisa el código y el teléfono.' });
    return { purchase: result.rows[0] };
  });
}
