import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { z } from 'zod';
import { env } from '../env.js';

const orderParams = z.object({ orderId: z.string().uuid() });
const reviewBody = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve'), reason: z.string().trim().max(500).optional() }),
  z.object({ decision: z.literal('reject'), reason: z.string().trim().min(3).max(500), hint: z.string().trim().max(300).optional() }),
]);

async function requireOrderPermission(request: FastifyRequest, reply: FastifyReply) {
  const db = request.database?.client;
  if (!request.actor || !db || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  const permission = await db.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [request.actor.id, 'order.approve']);
  if (!permission.rows[0]?.allowed) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para revisar comprobantes.' });
    return null;
  }
  return { db, actor: request.actor, tenant: request.tenant };
}

export async function adminOrderRoutes(app: FastifyInstance) {
  app.get('/orders/pending', async (request, reply) => {
    const context = await requireOrderPermission(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT o.id, o.purchase_code AS "purchaseCode", o.buyer_name AS "buyerName", o.buyer_phone AS "buyerPhone",
              o.buyer_email AS "buyerEmail", o.total_cents::text AS "totalCents", o.payment_method AS "paymentMethod",
              o.created_at AS "createdAt", p.id AS "paymentId", p.status AS "paymentStatus", p.reference_code AS "referenceCode",
              p.bank_account_id AS "bankAccountId", p.proof_uploaded_at AS "proofUploadedAt",
              COALESCE(lines.items, '[]'::jsonb) AS items, COALESCE(proofs.items, '[]'::jsonb) AS proofs
         FROM app.orders o
         JOIN app.payments p ON p.order_id = o.id AND p.tenant_id = o.tenant_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('drawName', d.name, 'drawDate', s.draw_date::text, 'digits', oi.digits,
                              'number', oi.number, 'amountCents', oi.amount_cents::text) ORDER BY oi.created_at) AS items
             FROM app.order_items oi
             JOIN app.draw_sessions s ON s.id = oi.session_id AND s.tenant_id = oi.tenant_id
             JOIN app.draws d ON d.id = oi.draw_id AND d.tenant_id = oi.tenant_id
            WHERE oi.order_id = o.id AND oi.tenant_id = o.tenant_id
         ) lines ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'mimeType', pr.mime_type, 'sizeBytes', pr.size_bytes,
                              'uploadedAt', pr.uploaded_at) ORDER BY pr.uploaded_at DESC) AS items
             FROM app.payment_proofs pr WHERE pr.payment_id = p.id AND pr.tenant_id = p.tenant_id
         ) proofs ON true
        WHERE o.tenant_id = $1 AND o.status = 'pending_review' AND p.status IN ('pending','in_review')
        ORDER BY o.created_at ASC LIMIT 100`, [context.tenant?.id],
    );
    return { items: result.rows };
  });

  app.post('/orders/:orderId/review', async (request, reply) => {
    const params = orderParams.safeParse(request.params);
    const body = reviewBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa la decisión y el motivo.' });
    const context = await requireOrderPermission(request, reply);
    if (!context) return reply;

    if (body.data.decision === 'approve') {
      const result = await context.db.query<{ ticket_id: string }>(
        'SELECT * FROM app.fn_review_order($1, $2, $3) AS ticket_id', [params.data.orderId, context.actor.id, body.data.reason ?? null],
      );
      return { orderId: params.data.orderId, status: result.rowCount ? 'approved' : 'refunded', ticketIds: result.rows.map((row) => row.ticket_id) };
    }

    await context.db.query('SELECT app.fn_reject_order($1, $2, $3, $4)', [params.data.orderId, context.actor.id, body.data.reason, body.data.hint ?? null]);
    return { orderId: params.data.orderId, status: 'rejected', ticketIds: [] };
  });

  app.get('/orders/:orderId/proofs/:proofId', async (request, reply) => {
    const params = z.object({ orderId: z.string().uuid(), proofId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'La referencia del comprobante no es válida.' });
    const context = await requireOrderPermission(request, reply);
    if (!context) return reply;
    const result = await context.db.query<{ storage_key: string; mime_type: 'image/jpeg' | 'image/png' | 'application/pdf' }>(
      `SELECT pr.storage_key, pr.mime_type
         FROM app.payment_proofs pr
         JOIN app.payments p ON p.id = pr.payment_id AND p.tenant_id = pr.tenant_id
         JOIN app.orders o ON o.id = p.order_id AND o.tenant_id = p.tenant_id
        WHERE pr.id = $1 AND o.id = $2 AND pr.tenant_id = $3 LIMIT 1`,
      [params.data.proofId, params.data.orderId, context.tenant.id],
    );
    const proof = result.rows[0];
    if (!proof) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No encontramos el comprobante.' });
    const root = resolve(env.STORAGE_PATH);
    const filePath = resolve(root, proof.storage_key);
    if (isAbsolute(proof.storage_key) || !filePath.startsWith(`${root}${sep}`)) {
      request.log.error({ event: 'invalid_proof_storage_key', requestId: request.id });
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'No encontramos el comprobante.' });
    }
    let bytes: Buffer;
    try { bytes = await readFile(filePath); }
    catch { return reply.code(404).send({ code: 'PROOF_UNAVAILABLE', message: 'El comprobante no está disponible.' }); }
    return reply.type(proof.mime_type).header('Content-Disposition', 'inline').header('Cache-Control', 'private, no-store').send(bytes);
  });
}
