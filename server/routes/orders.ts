import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { env } from '../env.js';
import { detectMime } from '../security/proofs.js';

const uuidSchema = z.string().uuid();
const itemSchema = z.object({
  drawId: uuidSchema,
  sessionId: uuidSchema,
  digits: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  number: z.string().regex(/^\d{2,4}$/),
  amountCents: z.string().regex(/^\d+$/).refine((value) => BigInt(value) >= 25n && BigInt(value) <= 2_000_000_000n),
  planId: uuidSchema.optional(),
}).superRefine((item, context) => {
  if (item.number.length !== item.digits) context.addIssue({ code: 'custom', path: ['number'], message: 'Número y modalidad no coinciden.' });
});

const orderSchema = z.object({
  items: z.array(itemSchema).min(1).max(100),
  paymentMethod: z.enum(['wallet', 'bank_transfer']),
  bankAccountId: uuidSchema.optional(),
  buyer: z.object({
    fullName: z.string().trim().min(3).max(120),
    phone: z.string().trim().min(7).max(30),
    email: z.string().trim().email().max(254).optional().or(z.literal('')),
    document: z.string().trim().max(24).optional().or(z.literal('')),
    adultConfirmed: z.literal(true),
    termsAccepted: z.literal(true),
  }),
  idempotencyKey: uuidSchema,
});

export async function orderRoutes(app: FastifyInstance) {
  app.get('/payment-options', async (request) => {
    const db = request.database?.client;
    if (!db || !request.tenant) throw new Error('REQUEST_CONTEXT_MISSING');
    const methods = await db.query(
      `SELECT method, min_cents::text AS "minCents", max_cents::text AS "maxCents", help_text AS "helpText", fee_message AS "feeMessage"
         FROM app.payment_methods_config
        WHERE tenant_id = $1 AND enabled AND method IN ('wallet','bank_transfer') ORDER BY method`, [request.tenant.id],
    );
    const banks = await db.query(
      `SELECT id, bank_name AS "bankName", holder, account_type AS "accountType", account_number AS "accountNumber"
         FROM app.bank_accounts WHERE tenant_id = $1 AND is_active ORDER BY sort_order, bank_name`, [request.tenant.id],
    );
    return { methods: methods.rows, bankAccounts: banks.rows };
  });

  app.post('/orders', async (request, reply) => {
    let payload: unknown = request.body;
    let receipt: { bytes: Buffer; mime: 'image/jpeg' | 'image/png' | 'application/pdf' } | null = null;
    if (request.headers['content-type']?.includes('multipart/form-data')) {
      let serialized: string | undefined;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            if (part.fieldname !== 'receipt') return reply.code(400).send({ code: 'INVALID_FILE', message: 'El archivo adjunto no es válido.' });
            const bytes = await part.toBuffer();
            const mime = detectMime(bytes);
            if (!mime) return reply.code(400).send({ code: 'INVALID_FILE', message: 'Adjunta un comprobante JPG, PNG o PDF válido.' });
            receipt = { bytes, mime };
          } else if (part.fieldname === 'order' && typeof part.value === 'string') serialized = part.value;
        }
        if (!serialized) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Falta la información de la compra.' });
        payload = JSON.parse(serialized);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ code: 'FILE_TOO_LARGE', message: 'El comprobante no puede superar 5 MB.' });
        if (error instanceof SyntaxError) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa la información de la compra.' });
        throw error;
      }
    }
    const parsed = orderSchema.safeParse(payload);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa el carrito y los datos del comprador.' });
    const data = parsed.data;
    const db = request.database?.client;
    const tenant = request.tenant;
    if (!db || !tenant) throw new Error('REQUEST_CONTEXT_MISSING');
    if (request.actor && request.actor.role !== 'client') return reply.code(403).send({ code: 'POS_REQUIRED', message: 'Usa el punto de venta para registrar una venta de personal.' });
    if (data.paymentMethod === 'wallet' && !request.actor) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para pagar con tu billetera.' });
    if (data.paymentMethod === 'bank_transfer' && !data.bankAccountId) return reply.code(400).send({ code: 'BANK_REQUIRED', message: 'Selecciona una cuenta bancaria disponible.' });
    if (data.paymentMethod === 'wallet' && data.bankAccountId) return reply.code(400).send({ code: 'INVALID_DATA', message: 'El método de pago no es válido.' });
    if (data.paymentMethod === 'bank_transfer' && !receipt) return reply.code(400).send({ code: 'RECEIPT_REQUIRED', message: 'Adjunta el comprobante de transferencia para enviar la compra.' });
    if (data.paymentMethod === 'wallet' && receipt) return reply.code(400).send({ code: 'INVALID_FILE', message: 'No adjuntes un comprobante al pagar con billetera.' });

    const method = await db.query('SELECT 1 FROM app.payment_methods_config WHERE tenant_id = $1 AND method = $2::app.payment_method AND enabled', [tenant.id, data.paymentMethod]);
    if (!method.rowCount) return reply.code(409).send({ code: 'METODO_NO_DISPONIBLE', message: 'Este método de pago no está disponible.' });

    if (data.bankAccountId) {
      const bank = await db.query('SELECT 1 FROM app.bank_accounts WHERE id = $1 AND tenant_id = $2 AND is_active', [data.bankAccountId, tenant.id]);
      if (!bank.rowCount) return reply.code(400).send({ code: 'BANK_UNAVAILABLE', message: 'La cuenta bancaria ya no está disponible.' });
    }
    for (const item of data.items) {
      if (!item.planId) continue;
      const plan = await db.query(
        `SELECT 1 FROM app.plans p JOIN app.plan_versions pv ON pv.plan_id = p.id AND pv.is_current
          WHERE p.id = $1 AND p.tenant_id = $2 AND p.draw_id = $3 AND p.digits = $4 AND p.is_active LIMIT 1`,
        [item.planId, tenant.id, item.drawId, item.digits],
      );
      if (!plan.rowCount) return reply.code(409).send({ code: 'PLAN_INVALIDO', message: 'El plan seleccionado ya no está disponible.' });
    }

    const buyer = request.actor
      ? { name: request.actor.fullName, phone: request.actor.phone, email: request.actor.email, document: data.buyer.document || null, adult: true, terms: true }
      : { name: data.buyer.fullName, phone: data.buyer.phone, email: data.buyer.email || null, document: data.buyer.document || null, adult: data.buyer.adultConfirmed, terms: data.buyer.termsAccepted };
    const items = data.items.map((item) => ({
      draw_id: item.drawId, session_id: item.sessionId, digits: item.digits, number: item.number,
      amount_cents: item.amountCents, ...(item.planId ? { plan_id: item.planId } : {}),
    }));
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenant.id}:order:${data.idempotencyKey}`]);
    const fingerprint = createHash('sha256').update(JSON.stringify({
      userId: request.actor?.id ?? null,
      paymentMethod: data.paymentMethod,
      bankAccountId: data.bankAccountId ?? null,
      items: [...items].sort((a, b) => `${a.session_id}:${a.digits}:${a.number}:${a.plan_id ?? ''}`.localeCompare(`${b.session_id}:${b.digits}:${b.number}:${b.plan_id ?? ''}`)),
    })).digest('hex');
    await db.query("INSERT INTO app.idempotency_keys (tenant_id, scope, key, response) VALUES ($1, 'order', $2, NULL) ON CONFLICT DO NOTHING", [tenant.id, data.idempotencyKey]);
    const idem = await db.query<{ response: { fingerprint: string; result: { order: unknown } } | null }>(
      "SELECT response FROM app.idempotency_keys WHERE tenant_id = $1 AND scope = 'order' AND key = $2 FOR UPDATE", [tenant.id, data.idempotencyKey],
    );
    const previous = idem.rows[0]?.response;
    if (previous) {
      if (previous.fingerprint !== fingerprint) return reply.code(409).send({ code: 'IDEMPOTENCY_CONFLICT', message: 'La clave de esta compra ya se usó con otros datos.' });
      return reply.code(200).send(previous.result);
    }
    const sha = receipt ? createHash('sha256').update(receipt.bytes).digest('hex') : null;
    if (receipt && sha) {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenant.id}:proof:${sha}`]);
      const reused = await db.query('SELECT 1 FROM app.payment_proofs WHERE tenant_id = $1 AND sha256 = $2 LIMIT 1', [tenant.id, sha]);
      if (reused.rowCount) return reply.code(409).send({ code: 'PROOF_REUSED', message: 'Este comprobante ya fue presentado.' });
    }
    const created = await db.query<{ id: string }>(
      `SELECT app.fn_submit_order($1, $2::jsonb, $3::jsonb, $4::app.payment_method, 'direct'::app.sale_origin,
                                  NULL, NULL, NULL, $5, NULL, $6, false) AS id`,
      [request.actor?.id ?? null, JSON.stringify(buyer), JSON.stringify(items), data.paymentMethod, data.idempotencyKey, data.bankAccountId ?? null],
    );
    const order = await db.query(
      `SELECT o.id, o.purchase_code AS "purchaseCode", o.status, o.total_cents::text AS "totalCents",
              p.id AS "paymentId", p.reference_code AS "referenceCode", p.method
         FROM app.orders o JOIN app.payments p ON p.order_id = o.id AND p.tenant_id = o.tenant_id
        WHERE o.id = $1 AND o.tenant_id = $2`, [created.rows[0].id, tenant.id],
    );
    const result = { order: order.rows[0] };
    if (receipt) {
      const paymentId = (order.rows[0] as { paymentId?: string }).paymentId;
      if (!paymentId) throw new Error('PAYMENT_NOT_CREATED');
      if (!sha) throw new Error('PROOF_HASH_MISSING');
      const extension = receipt.mime === 'image/jpeg' ? 'jpg' : receipt.mime === 'image/png' ? 'png' : 'pdf';
      const filename = `${randomUUID()}.${extension}`;
      const storageRoot = resolve(env.STORAGE_PATH);
      const directory = join(storageRoot, tenant.id);
      const filePath = join(directory, filename);
      await mkdir(directory, { recursive: true });
      await writeFile(filePath, receipt.bytes, { flag: 'wx', mode: 0o600 });
      request.database!.cleanupPaths.push(filePath);
      await db.query('SELECT app.fn_attach_proof($1, $2, $3, $4, $5, $6, NULL)', [paymentId, `${tenant.id}/${filename}`, receipt.mime, receipt.bytes.byteLength, sha, request.actor?.id ?? null]);
    }
    await db.query("UPDATE app.idempotency_keys SET response = $3::jsonb WHERE tenant_id = $1 AND scope = 'order' AND key = $2", [tenant.id, data.idempotencyKey, JSON.stringify({ fingerprint, result })]);
    return reply.code(201).send(result);
  });
}
