import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { env } from '../env.js';
import { detectMime } from '../security/proofs.js';

const rechargeBody = z.object({
  amountCents: z.string().regex(/^\d+$/).refine((value) => BigInt(value) >= 25n && BigInt(value) <= 2_000_000_000n),
  bankAccountId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  resubmittedFrom: z.string().uuid().optional(),
});

function requireClient(request: FastifyRequest, reply: FastifyReply) {
  if (!request.actor || !request.database || !request.tenant) {
    void reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para solicitar una recarga.' });
    return null;
  }
  if (request.actor.role !== 'client') {
    void reply.code(403).send({ code: 'SIN_PERMISO', message: 'La billetera de clientes no está disponible para este rol.' });
    return null;
  }
  return { db: request.database.client, actor: request.actor, tenant: request.tenant };
}

export async function rechargeRoutes(app: FastifyInstance) {
  app.get('/wallet/recharges', async (request, reply) => {
    const context = requireClient(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT r.id, r.amount_cents::text AS "amountCents", r.status, r.requested_at AS "requestedAt",
              r.rejection_reason AS "rejectionReason", r.correction_hint AS "correctionHint",
              r.bank_account_id AS "bankAccountId", r.resubmitted_from AS "resubmittedFrom", b.bank_name AS "bankName",
              p.reference_code AS "referenceCode"
         FROM app.recharges r
         JOIN app.wallets w ON w.id = r.wallet_id AND w.tenant_id = r.tenant_id
         LEFT JOIN app.payments p ON p.recharge_id = r.id AND p.tenant_id = r.tenant_id
         LEFT JOIN app.bank_accounts b ON b.id = r.bank_account_id AND b.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1 AND w.user_id = $2 ORDER BY r.requested_at DESC LIMIT 50`,
      [context.tenant.id, context.actor.id],
    );
    return { items: result.rows };
  });

  app.post('/wallet/recharges', async (request, reply) => {
    const context = requireClient(request, reply);
    if (!context) return reply;
    if (!request.headers['content-type']?.includes('multipart/form-data')) {
      return reply.code(400).send({ code: 'INVALID_DATA', message: 'Adjunta el comprobante de transferencia.' });
    }
    let raw: unknown;
    let file: { bytes: Buffer; mime: 'image/jpeg' | 'image/png' | 'application/pdf' } | null = null;
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'proof') return reply.code(400).send({ code: 'INVALID_FILE', message: 'El archivo adjunto no es válido.' });
          const bytes = await part.toBuffer();
          const mime = detectMime(bytes);
          if (!mime) return reply.code(400).send({ code: 'INVALID_FILE', message: 'Adjunta un comprobante JPG, PNG o PDF válido.' });
          file = { bytes, mime };
        } else if (part.fieldname === 'recharge' && typeof part.value === 'string') {
          try { raw = JSON.parse(part.value); }
          catch { return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa los datos de la recarga.' }); }
        }
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ code: 'FILE_TOO_LARGE', message: 'El comprobante no puede superar 5 MB.' });
      throw error;
    }
    const parsed = rechargeBody.safeParse(raw);
    if (!parsed.success || !file) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa el importe, la cuenta y el comprobante.' });
    const data = parsed.data;
    const method = await context.db.query<{ min_cents: string; max_cents: string | null }>(
      `SELECT min_cents::text, max_cents::text FROM app.payment_methods_config
        WHERE tenant_id = $1 AND method = 'bank_transfer' AND enabled`, [context.tenant.id],
    );
    if (!method.rows[0]) return reply.code(409).send({ code: 'METODO_NO_DISPONIBLE', message: 'Las recargas por transferencia no están disponibles.' });
    const amount = BigInt(data.amountCents);
    if (amount < BigInt(method.rows[0].min_cents) || (method.rows[0].max_cents && amount > BigInt(method.rows[0].max_cents))) {
      return reply.code(400).send({ code: 'MONTO_FUERA_DE_RANGO_METODO', message: 'El importe no cumple los límites de recarga.' });
    }
    const bank = await context.db.query('SELECT 1 FROM app.bank_accounts WHERE id = $1 AND tenant_id = $2 AND is_active', [data.bankAccountId, context.tenant.id]);
    if (!bank.rowCount) return reply.code(400).send({ code: 'BANK_UNAVAILABLE', message: 'La cuenta bancaria ya no está disponible.' });
    const wallet = await context.db.query<{ id: string }>('SELECT id FROM app.wallets WHERE tenant_id = $1 AND user_id = $2', [context.tenant.id, context.actor.id]);
    if (!wallet.rows[0]) return reply.code(404).send({ code: 'WALLET_NOT_FOUND', message: 'No encontramos tu billetera.' });
    await context.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${context.tenant.id}:recharge:${data.idempotencyKey}`]);
    const existing = await context.db.query<{ id: string; amount_cents: string; bank_account_id: string; status: string; resubmitted_from: string | null }>(
      `SELECT id, amount_cents::text, bank_account_id, status, resubmitted_from FROM app.recharges
        WHERE tenant_id = $1 AND wallet_id = $2 AND idempotency_key = $3`,
      [context.tenant.id, wallet.rows[0].id, data.idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].amount_cents !== data.amountCents || existing.rows[0].bank_account_id !== data.bankAccountId || existing.rows[0].resubmitted_from !== (data.resubmittedFrom ?? null)) {
        return reply.code(409).send({ code: 'IDEMPOTENCY_CONFLICT', message: 'La clave de recarga ya se usó con otros datos.' });
      }
      return reply.code(200).send({ rechargeId: existing.rows[0].id, status: existing.rows[0].status, repeated: true });
    }
    const sha = createHash('sha256').update(file.bytes).digest('hex');
    await context.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${context.tenant.id}:recharge-proof:${sha}`]);
    const reused = await context.db.query('SELECT 1 FROM app.payment_proofs WHERE tenant_id = $1 AND sha256 = $2 LIMIT 1', [context.tenant.id, sha]);
    if (reused.rowCount) return reply.code(409).send({ code: 'PROOF_REUSED', message: 'Este comprobante ya fue presentado.' });
    const extension = file.mime === 'image/jpeg' ? 'jpg' : file.mime === 'image/png' ? 'png' : 'pdf';
    const filename = `${randomUUID()}.${extension}`;
    const directory = join(resolve(env.STORAGE_PATH), context.tenant.id);
    const filePath = join(directory, filename);
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, file.bytes, { flag: 'wx', mode: 0o600 });
    request.database!.cleanupPaths.push(filePath);
    const result = await context.db.query<{ id: string }>(
      'SELECT app.fn_request_recharge($1, $2, $3, $4, $5, $6, $7, $8, $9) AS id',
      [context.actor.id, data.amountCents, data.bankAccountId, `${context.tenant.id}/${filename}`, file.mime, file.bytes.byteLength, sha, data.idempotencyKey, data.resubmittedFrom ?? null],
    );
    return reply.code(201).send({ rechargeId: result.rows[0].id, status: 'in_review', repeated: false });
  });
}
