import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { z } from 'zod';
import { env } from '../env.js';

const paramsSchema = z.object({ rechargeId: z.string().uuid() });
const decisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve') }),
  z.object({ decision: z.literal('reject'), reason: z.string().trim().min(3).max(500), hint: z.string().trim().max(300).optional() }),
]);

async function requireRechargePermission(request: FastifyRequest, reply: FastifyReply) {
  const db = request.database?.client;
  if (!request.actor || !db || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  if (request.actor.role !== 'admin') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Solo Administración puede aprobar recargas.' });
    return null;
  }
  const permission = await db.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [request.actor.id, 'recharge.approve']);
  if (!permission.rows[0]?.allowed) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para revisar recargas.' });
    return null;
  }
  return { db, actor: request.actor, tenant: request.tenant };
}

export async function adminRechargeRoutes(app: FastifyInstance) {
  app.get('/recharges/pending', async (request, reply) => {
    const context = await requireRechargePermission(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT r.id, r.amount_cents::text AS "amountCents", r.status, r.requested_at AS "requestedAt",
              u.full_name AS "buyerName", u.phone AS "buyerPhone", u.email AS "buyerEmail",
              b.bank_name AS "bankName", b.account_number AS "bankAccountNumber", p.id AS "paymentId", p.reference_code AS "referenceCode",
              COALESCE(proofs.items, '[]'::jsonb) AS proofs
         FROM app.recharges r JOIN app.wallets w ON w.id = r.wallet_id AND w.tenant_id = r.tenant_id
         JOIN app.users u ON u.id = w.user_id AND u.tenant_id = r.tenant_id
         LEFT JOIN app.bank_accounts b ON b.id = r.bank_account_id AND b.tenant_id = r.tenant_id
         JOIN app.payments p ON p.recharge_id = r.id AND p.tenant_id = r.tenant_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('id', proof.id, 'mimeType', proof.mime_type,
                      'sizeBytes', proof.size_bytes, 'uploadedAt', proof.uploaded_at) ORDER BY proof.uploaded_at DESC) AS items
             FROM app.payment_proofs proof WHERE proof.payment_id = p.id AND proof.tenant_id = p.tenant_id
         ) proofs ON true
        WHERE r.tenant_id = $1 AND r.status IN ('pending','in_review')
        ORDER BY r.requested_at ASC LIMIT 100`, [context.tenant.id],
    );
    return { items: result.rows };
  });

  app.post('/recharges/:rechargeId/review', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = decisionSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa la decisión y el motivo.' });
    const context = await requireRechargePermission(request, reply);
    if (!context) return reply;
    const approve = body.data.decision === 'approve';
    const reason = body.data.decision === 'reject' ? body.data.reason : null;
    const hint = body.data.decision === 'reject' ? body.data.hint ?? null : null;
    await context.db.query('SELECT app.fn_review_recharge($1, $2, $3, $4, $5)', [
      params.data.rechargeId, context.actor.id, approve, reason, hint,
    ]);
    return { rechargeId: params.data.rechargeId, status: approve ? 'approved' : 'rejected' };
  });

  app.get('/recharges/:rechargeId/proofs/:proofId', async (request, reply) => {
    const params = z.object({ rechargeId: z.string().uuid(), proofId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'La referencia del comprobante no es válida.' });
    const context = await requireRechargePermission(request, reply);
    if (!context) return reply;
    const result = await context.db.query<{ storage_key: string; mime_type: 'image/jpeg' | 'image/png' | 'application/pdf' }>(
      `SELECT proof.storage_key, proof.mime_type FROM app.payment_proofs proof
         JOIN app.payments p ON p.id = proof.payment_id AND p.tenant_id = proof.tenant_id
         JOIN app.recharges r ON r.id = p.recharge_id AND r.tenant_id = p.tenant_id
        WHERE proof.id = $1 AND r.id = $2 AND r.tenant_id = $3 LIMIT 1`,
      [params.data.proofId, params.data.rechargeId, context.tenant.id],
    );
    const proof = result.rows[0];
    if (!proof) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No encontramos el comprobante.' });
    const root = resolve(env.STORAGE_PATH);
    const filePath = resolve(root, proof.storage_key);
    if (isAbsolute(proof.storage_key) || !filePath.startsWith(`${root}${sep}`)) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No encontramos el comprobante.' });
    let bytes: Buffer;
    try { bytes = await readFile(filePath); }
    catch { return reply.code(404).send({ code: 'PROOF_UNAVAILABLE', message: 'El comprobante no está disponible.' }); }
    return reply.type(proof.mime_type).header('Content-Disposition', 'inline').header('Cache-Control', 'private, no-store').send(bytes);
  });
}
