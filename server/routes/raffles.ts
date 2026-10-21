import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';
import { detectMime } from '../security/proofs.js';

const purchaseSchema = z.object({
  packageId: z.string().uuid().optional(),
  quantity: z.number().int().min(1).max(1000).default(1),
  adultConfirmed: z.literal(true),
  termsConfirmed: z.literal(true),
  idempotencyKey: z.string().uuid(),
  paymentMethod: z.enum(['wallet', 'bank_transfer']).default('wallet'),
  bankAccountId: z.string().uuid().optional(),
});

async function requireRaffleBuyer(request: FastifyRequest, reply: FastifyReply) {
  if (!request.actor || !request.database?.client || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para comprar y guardar tus números de rifa.' });
    return null;
  }
  if (request.actor.role !== 'client') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Las compras de rifas desde la billetera están disponibles para cuentas cliente.' });
    return null;
  }
  return { actor: request.actor, db: request.database.client, tenantId: request.tenant.id };
}

export async function rafflePurchaseRoutes(app: FastifyInstance) {
  app.get('/raffle-purchases/mine', async (request, reply) => {
    const context = await requireRaffleBuyer(request, reply);
    if (!context) return reply;
    const result = await context.db.query(`SELECT p.id,p.purchase_code AS "purchaseCode",p.status,p.total_cents::text AS "totalCents",p.quantity,p.created_at AS "createdAt",r.name AS "raffleName",CASE WHEN p.status='approved' THEN COALESCE(n.items,'[]'::jsonb) ELSE '[]'::jsonb END AS numbers FROM app.raffle_purchases p JOIN app.special_raffles r ON r.id=p.raffle_id AND r.tenant_id=p.tenant_id LEFT JOIN LATERAL(SELECT jsonb_agg(rn.number ORDER BY rn.number) items FROM app.raffle_numbers rn WHERE rn.purchase_id=p.id AND rn.tenant_id=p.tenant_id)n ON true WHERE p.tenant_id=$1 AND p.user_id=$2 ORDER BY p.created_at DESC LIMIT 100`, [context.tenantId, context.actor.id]);
    return { items: result.rows };
  });

  app.post('/raffles/:raffleId/purchases', async (request, reply) => {
    const params = z.object({ raffleId: z.string().uuid() }).safeParse(request.params);
    let raw: unknown = request.body;
    let proof: { bytes: Buffer; mime: 'image/jpeg'|'image/png'|'application/pdf' } | null = null;
    if (request.headers['content-type']?.includes('multipart/form-data')) {
      let serialized: string | undefined;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            if (part.fieldname !== 'proof') return reply.code(400).send({ code:'INVALID_FILE',message:'El comprobante adjunto no es válido.' });
            const bytes=await part.toBuffer(),mime=detectMime(bytes);
            if(!mime)return reply.code(400).send({code:'INVALID_FILE',message:'Adjunta un comprobante JPG, PNG o PDF válido.'});
            proof={bytes,mime};
          } else if(part.fieldname==='purchase'&&typeof part.value==='string') serialized=part.value;
        }
        if(!serialized)return reply.code(400).send({code:'INVALID_DATA',message:'Faltan los datos de la participación.'});
        raw=JSON.parse(serialized);
      } catch(error) {
        if((error as {code?:string}).code==='FST_REQ_FILE_TOO_LARGE')return reply.code(413).send({code:'FILE_TOO_LARGE',message:'El comprobante no puede superar 5 MB.'});
        if(error instanceof SyntaxError)return reply.code(400).send({code:'INVALID_DATA',message:'Revisa los datos de la participación.'});
        throw error;
      }
    }
    const parsed = purchaseSchema.safeParse(raw);
    if (!params.success || !parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa la cantidad, el paquete y la confirmación de compra.' });
    const context = await requireRaffleBuyer(request, reply);
    if (!context) return reply;
    const { actor, db, tenantId } = context;
    const age = await db.query<{ confirmed: boolean }>(
      'SELECT adult_confirmed_at IS NOT NULL AS confirmed FROM app.users WHERE id = $1 AND tenant_id = $2 AND is_active', [actor.id, tenantId],
    );
    if (!age.rows[0]?.confirmed) return reply.code(400).send({ code: 'AGE_CONFIRMATION_REQUIRED', message: 'Confirma tu mayoría de edad en los datos de tu cuenta antes de comprar.' });
    if(parsed.data.paymentMethod==='bank_transfer'&&!parsed.data.bankAccountId)return reply.code(400).send({code:'BANK_REQUIRED',message:'Selecciona la cuenta bancaria a la que realizaste la transferencia.'});
    if(parsed.data.paymentMethod==='bank_transfer'&&!proof)return reply.code(400).send({code:'RECEIPT_REQUIRED',message:'Adjunta el comprobante de transferencia.'});
    if(parsed.data.paymentMethod==='wallet'&&(proof||parsed.data.bankAccountId))return reply.code(400).send({code:'INVALID_DATA',message:'No adjuntes comprobante ni cuenta bancaria al pagar con billetera.'});
    const method=await db.query('SELECT 1 FROM app.payment_methods_config WHERE tenant_id=$1 AND method=$2::app.payment_method AND enabled',[tenantId,parsed.data.paymentMethod]);
    if(!method.rowCount)return reply.code(409).send({code:'METODO_NO_DISPONIBLE',message:'Este método de pago no está disponible.'});
    if(parsed.data.bankAccountId){const bank=await db.query('SELECT 1 FROM app.bank_accounts WHERE id=$1 AND tenant_id=$2 AND is_active',[parsed.data.bankAccountId,tenantId]);if(!bank.rowCount)return reply.code(400).send({code:'BANK_UNAVAILABLE',message:'La cuenta bancaria ya no está disponible.'});}
    const proofHash=proof?createHash('sha256').update(proof.bytes).digest('hex'):null;
    const fingerprint = createHash('sha256').update(JSON.stringify({
      actorId: actor.id, raffleId: params.data.raffleId, packageId: parsed.data.packageId ?? null,
      quantity: parsed.data.quantity, method: parsed.data.paymentMethod, bankAccountId: parsed.data.bankAccountId??null, proofHash, termsConfirmed: parsed.data.termsConfirmed,
    })).digest('hex');
    const key = parsed.data.idempotencyKey;
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:raffle:${key}`]);
    await db.query("INSERT INTO app.idempotency_keys (tenant_id, scope, key, response) VALUES ($1, 'raffle-purchase', $2, NULL) ON CONFLICT DO NOTHING", [tenantId, key]);
    const prior = await db.query<{ response: { fingerprint: string; result: unknown } | null }>(
      "SELECT response FROM app.idempotency_keys WHERE tenant_id = $1 AND scope = 'raffle-purchase' AND key = $2 FOR UPDATE", [tenantId, key],
    );
    if (prior.rows[0]?.response) {
      if (prior.rows[0].response.fingerprint !== fingerprint) return reply.code(409).send({ code: 'IDEMPOTENCY_CONFLICT', message: 'Esta clave de compra ya se usó con otros datos.' });
      return reply.send(prior.rows[0].response.result);
    }

    if(proofHash){
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${tenantId}:raffle-proof:${proofHash}`]);
      const reused=await db.query('SELECT 1 FROM app.payment_proofs WHERE tenant_id=$1 AND sha256=$2 LIMIT 1',[tenantId,proofHash]);
      if(reused.rowCount)return reply.code(409).send({code:'PROOF_REUSED',message:'Este comprobante ya fue presentado.'});
    }

    const buyer = { name: actor.fullName, phone: actor.phone, email: actor.email };
    const created = await db.query<{ id: string }>(
      `SELECT app.fn_submit_raffle_purchase($1, $2, $3::jsonb, $4, $5, $6::app.payment_method, $7, $8) AS id`,
      [params.data.raffleId, actor.id, JSON.stringify(buyer), parsed.data.packageId ?? null, parsed.data.quantity, parsed.data.paymentMethod, key, parsed.data.bankAccountId??null],
    );
    const purchase = await db.query(
      `SELECT p.id, p.purchase_code AS "purchaseCode", p.status, p.total_cents::text AS "totalCents", p.quantity,
              r.name AS "raffleName", COALESCE(jsonb_agg(n.number ORDER BY n.number) FILTER (WHERE n.number IS NOT NULL), '[]'::jsonb) AS numbers
         FROM app.raffle_purchases p JOIN app.special_raffles r ON r.id = p.raffle_id AND r.tenant_id = p.tenant_id
         LEFT JOIN app.raffle_numbers n ON n.purchase_id = p.id AND n.tenant_id = p.tenant_id
        WHERE p.id = $1 AND p.tenant_id = $2 AND p.user_id = $3 GROUP BY p.id, r.name`,
      [created.rows[0]?.id, tenantId, actor.id],
    );
    if (!purchase.rows[0]) throw new Error('RAFFLE_PURCHASE_NOT_FOUND');
    const result = { purchase: purchase.rows[0] };
    if(proof&&proofHash){
      const payment=await db.query<{id:string}>('SELECT id FROM app.payments WHERE tenant_id=$1 AND raffle_purchase_id=$2 ORDER BY created_at DESC LIMIT 1',[tenantId,created.rows[0]?.id]);
      if(!payment.rows[0])throw new Error('RAFFLE_PAYMENT_NOT_CREATED');
      const extension=proof.mime==='image/jpeg'?'jpg':proof.mime==='image/png'?'png':'pdf',filename=`${randomUUID()}.${extension}`,directory=join(resolve(env.STORAGE_PATH),tenantId),filePath=join(directory,filename);
      await mkdir(directory,{recursive:true});await writeFile(filePath,proof.bytes,{flag:'wx',mode:0o600});request.database!.cleanupPaths.push(filePath);
      await db.query('SELECT app.fn_attach_proof($1,$2,$3,$4,$5,$6,NULL)',[payment.rows[0].id,`${tenantId}/${filename}`,proof.mime,proof.bytes.byteLength,proofHash,actor.id]);
    }
    await db.query("UPDATE app.idempotency_keys SET response = $3::jsonb WHERE tenant_id = $1 AND scope = 'raffle-purchase' AND key = $2", [tenantId, key, JSON.stringify({ fingerprint, result })]);
    return reply.code(201).send(result);
  });
}
