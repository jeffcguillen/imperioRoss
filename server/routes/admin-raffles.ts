import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { z } from 'zod';

async function requireRafflePermission(request: FastifyRequest, reply: FastifyReply, action: 'raffle.manage' | 'order.approve') {
  const db = request.database?.client;
  if (!request.actor || !db || !request.tenant) { await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' }); return null; }
  if (request.actor.role !== 'admin') { await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Esta operación está reservada a Administración.' }); return null; }
  const permission = await db.query<{ allowed: boolean }>('SELECT app.fn_can($1,$2) AS allowed', [request.actor.id, action]);
  if (!permission.rows[0]?.allowed) { await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para esta operación.' }); return null; }
  return { db, actor: request.actor, tenant: request.tenant };
}

const raffleBody = z.object({
  name: z.string().trim().min(3).max(120), description: z.string().trim().max(1500).optional(), prizeDescription: z.string().trim().min(3).max(300),
  prizeValueCents: z.string().regex(/^\d{1,15}$/).optional(), numberDigits: z.number().int().min(1).max(9), rangeStart: z.string().regex(/^\d{1,15}$/), rangeEnd: z.string().regex(/^\d{1,15}$/),
  priceCents: z.string().regex(/^\d{1,15}$/), opensAt: z.string().datetime({ offset: true }), closeMode: z.enum(['date','sold_out','manual']), closesAt: z.string().datetime({ offset: true }).optional(),
  drawMethod: z.string().trim().max(200).optional(), rules: z.string().trim().max(3000).optional(),
}).superRefine((body, ctx) => {
  const start = BigInt(body.rangeStart), end = BigInt(body.rangeEnd), max = 10n ** BigInt(body.numberDigits) - 1n;
  if (end < start || end > max) ctx.addIssue({ code: 'custom', path: ['rangeEnd'], message: 'El rango debe caber en la cantidad de cifras.' });
  if (BigInt(body.priceCents) < 25n || BigInt(body.priceCents) % 5n !== 0n) ctx.addIssue({ code: 'custom', path: ['priceCents'], message: 'El precio debe ser al menos 25 centavos y múltiplo de 5.' });
  if (body.closeMode === 'date' && !body.closesAt) ctx.addIssue({ code: 'custom', path: ['closesAt'], message: 'El cierre por fecha requiere día y hora.' });
  if (body.closesAt && new Date(body.closesAt) <= new Date(body.opensAt)) ctx.addIssue({ code: 'custom', path: ['closesAt'], message: 'El cierre debe ocurrir después de la apertura.' });
});
const packageBody = z.object({ label: z.string().trim().min(2).max(100), priceCents: z.string().regex(/^[1-9]\d{0,14}$/), chances: z.number().int().min(1).max(1000) });
const fortuneBody = z.object({ number: z.string().regex(/^\d{1,9}$/), prizeCents: z.string().regex(/^[1-9]\d{0,14}$/) });

export async function adminRaffleRoutes(app: FastifyInstance) {
  app.get('/raffles/manage', async (request, reply) => {
    const context = await requireRafflePermission(request, reply, 'raffle.manage'); if (!context) return reply;
    const result = await context.db.query(`SELECT r.id,r.name,r.description,r.prize_description AS "prizeDescription",r.prize_value_cents::text AS "prizeValueCents",r.number_digits AS "numberDigits",r.range_start::text AS "rangeStart",r.range_end::text AS "rangeEnd",r.price_cents::text AS "priceCents",r.opens_at AS "opensAt",r.close_mode AS "closeMode",r.closes_at AS "closesAt",r.status,r.sold_count::text AS "soldCount",(r.range_end-r.range_start+1)::text AS "totalNumbers",r.draw_method AS "drawMethod",r.rules,COALESCE(pk.items,'[]'::jsonb) AS packages,COALESCE(fn.items,'[]'::jsonb) AS "fortuneNumbers",COALESCE(pending.count,0)::text AS "pendingPurchases"
      FROM app.special_raffles r
      LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',p.id,'label',p.label,'priceCents',p.price_cents::text,'chances',p.chances,'isActive',p.is_active) ORDER BY p.price_cents) items FROM app.raffle_packages p WHERE p.raffle_id=r.id AND p.tenant_id=r.tenant_id) pk ON true
      LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('number',f.number,'prizeCents',f.prize_cents::text,'matched',f.matched_purchase_id IS NOT NULL) ORDER BY f.number) items FROM app.fortune_numbers f WHERE f.raffle_id=r.id AND f.tenant_id=r.tenant_id) fn ON true
      LEFT JOIN LATERAL (SELECT count(*) count FROM app.raffle_purchases rp WHERE rp.raffle_id=r.id AND rp.tenant_id=r.tenant_id AND rp.status='pending_payment') pending ON true
      WHERE r.tenant_id=$1 ORDER BY r.created_at DESC`, [context.tenant.id]);
    return { items: result.rows };
  });

  app.post('/raffles/manage', async (request, reply) => {
    const body = raffleBody.safeParse(request.body); if (!body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa los datos, el rango, el precio y las fechas de la rifa.' });
    const context = await requireRafflePermission(request, reply, 'raffle.manage'); if (!context) return reply;
    const result = await context.db.query<{ id: string }>(`INSERT INTO app.special_raffles(tenant_id,name,description,prize_description,prize_value_cents,number_digits,range_start,range_end,price_cents,opens_at,close_mode,closes_at,draw_method,rules,status)
      VALUES($1,$2,$3,$4,$5::bigint,$6,$7::bigint,$8::bigint,$9::bigint,$10::timestamptz,$11::app.raffle_close_mode,$12::timestamptz,$13,$14,'draft') RETURNING id`,
      [context.tenant.id,body.data.name,body.data.description||null,body.data.prizeDescription,body.data.prizeValueCents??null,body.data.numberDigits,body.data.rangeStart,body.data.rangeEnd,body.data.priceCents,body.data.opensAt,body.data.closeMode,body.data.closesAt??null,body.data.drawMethod||null,body.data.rules||null]);
    return reply.code(201).send({ raffleId: result.rows[0].id, status: 'draft' });
  });

  app.post('/raffles/manage/:raffleId/packages', async (request, reply) => {
    const params = z.object({ raffleId:z.string().uuid() }).safeParse(request.params), body = packageBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code:'INVALID_DATA',message:'Revisa los datos del paquete.' });
    const context = await requireRafflePermission(request, reply, 'raffle.manage'); if (!context) return reply;
    const raffle = await context.db.query('SELECT id FROM app.special_raffles WHERE id=$1 AND tenant_id=$2 AND status=\'draft\' FOR UPDATE',[params.data.raffleId,context.tenant.id]);
    if (!raffle.rowCount) return reply.code(409).send({ code:'RAFFLE_NOT_EDITABLE',message:'Los paquetes solo se configuran mientras la rifa está en borrador.' });
    const result = await context.db.query<{id:string}>(`INSERT INTO app.raffle_packages(tenant_id,raffle_id,label,price_cents,chances) VALUES($1,$2,$3,$4::bigint,$5) RETURNING id`,[context.tenant.id,params.data.raffleId,body.data.label,body.data.priceCents,body.data.chances]);
    await context.db.query('SELECT app.fn_audit($1,$2,$3,$4,$5,NULL,$6::jsonb)',[context.tenant.id,context.actor.id,'raffle.package.created','raffle_package',result.rows[0].id,JSON.stringify(body.data)]);
    return reply.code(201).send({ packageId:result.rows[0].id });
  });

  app.post('/raffles/manage/:raffleId/fortune-numbers', async (request, reply) => {
    const params=z.object({raffleId:z.string().uuid()}).safeParse(request.params),body=fortuneBody.safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({code:'INVALID_DATA',message:'Revisa el número Fortuna y el valor del premio.'});
    const context=await requireRafflePermission(request,reply,'raffle.manage');if(!context)return reply;
    const raffle=await context.db.query<{number_digits:number;range_start:string;range_end:string}>(`SELECT number_digits,range_start::text,range_end::text FROM app.special_raffles WHERE id=$1 AND tenant_id=$2 AND status='draft' FOR UPDATE`,[params.data.raffleId,context.tenant.id]);
    const r=raffle.rows[0];
    if(!r)return reply.code(409).send({code:'RAFFLE_NOT_EDITABLE',message:'Los Números Fortuna se fijan antes de abrir la rifa.'});
    if(body.data.number.length!==r.number_digits||BigInt(body.data.number)<BigInt(r.range_start)||BigInt(body.data.number)>BigInt(r.range_end))return reply.code(400).send({code:'INVALID_FORTUNE_NUMBER',message:'El número debe tener las cifras configuradas y estar dentro del rango de la rifa.'});
    const exists=await context.db.query('SELECT 1 FROM app.fortune_numbers WHERE raffle_id=$1 AND tenant_id=$2 AND number=$3',[params.data.raffleId,context.tenant.id,body.data.number]);
    if(exists.rowCount)return reply.code(409).send({code:'DUPLICATE_FORTUNE_NUMBER',message:'Ese número ya tiene un premio configurado.'});
    await context.db.query('INSERT INTO app.fortune_numbers(raffle_id,tenant_id,number,prize_cents) VALUES($1,$2,$3,$4::bigint)',[params.data.raffleId,context.tenant.id,body.data.number,body.data.prizeCents]);
    return reply.code(201).send({number:body.data.number});
  });

  app.patch('/raffles/manage/:raffleId/status', async (request, reply) => {
    const params=z.object({raffleId:z.string().uuid()}).safeParse(request.params),body=z.object({status:z.enum(['open','closed'])}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({code:'INVALID_DATA',message:'Selecciona un estado válido.'});
    const context=await requireRafflePermission(request,reply,'raffle.manage');if(!context)return reply;
    const current=await context.db.query<{status:string;sold_count:string;range_end:string;range_start:string}>(`SELECT status,sold_count::text,range_end::text,range_start::text FROM app.special_raffles WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,[params.data.raffleId,context.tenant.id]);
    const raffle=current.rows[0];if(!raffle)return reply.code(404).send({code:'NOT_FOUND',message:'No encontramos la rifa.'});
    const valid=body.data.status==='open'?raffle.status==='draft':['open','sold_out'].includes(raffle.status);
    if(!valid)return reply.code(409).send({code:'INVALID_TRANSITION',message:'Ese cambio de estado no está permitido.'});
    if(body.data.status==='open'&&BigInt(raffle.sold_count)>=BigInt(raffle.range_end)-BigInt(raffle.range_start)+1n)return reply.code(409).send({code:'RAFFLE_NO_CAPACITY',message:'No hay números disponibles para abrir la rifa.'});
    await context.db.query('UPDATE app.special_raffles SET status=$3::app.raffle_status,updated_at=now() WHERE id=$1 AND tenant_id=$2',[params.data.raffleId,context.tenant.id,body.data.status]);
    return {raffleId:params.data.raffleId,status:body.data.status};
  });

  app.get('/raffles/purchases/pending',async(request,reply)=>{
    const context=await requireRafflePermission(request,reply,'order.approve');if(!context)return reply;
    const result=await context.db.query(`SELECT p.id,p.purchase_code AS "purchaseCode",p.buyer_name AS "buyerName",p.buyer_phone AS "buyerPhone",p.total_cents::text AS "totalCents",p.quantity,p.created_at AS "createdAt",r.name AS "raffleName",pay.method,pay.reference_code AS "referenceCode",pay.proof_uploaded_at AS "proofUploadedAt",COALESCE(proofs.items,'[]'::jsonb) AS proofs FROM app.raffle_purchases p JOIN app.special_raffles r ON r.id=p.raffle_id AND r.tenant_id=p.tenant_id LEFT JOIN LATERAL(SELECT id,method,reference_code,proof_uploaded_at FROM app.payments WHERE raffle_purchase_id=p.id AND tenant_id=p.tenant_id ORDER BY created_at DESC LIMIT 1) pay ON true LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',pr.id,'mimeType',pr.mime_type,'sizeBytes',pr.size_bytes,'uploadedAt',pr.uploaded_at) ORDER BY pr.uploaded_at DESC) items FROM app.payment_proofs pr WHERE pr.payment_id=pay.id AND pr.tenant_id=p.tenant_id) proofs ON true WHERE p.tenant_id=$1 AND p.status='pending_payment' ORDER BY p.created_at LIMIT 100`,[context.tenant.id]);
    return {items:result.rows};
  });

  app.get('/raffles/purchases/:purchaseId/proofs/:proofId',async(request,reply)=>{
    const params=z.object({purchaseId:z.string().uuid(),proofId:z.string().uuid()}).safeParse(request.params);
    if(!params.success)return reply.code(400).send({code:'INVALID_DATA',message:'La referencia del comprobante no es válida.'});
    const context=await requireRafflePermission(request,reply,'order.approve');if(!context)return reply;
    const result=await context.db.query<{storage_key:string;mime_type:'image/jpeg'|'image/png'|'application/pdf'}>(`SELECT pr.storage_key,pr.mime_type FROM app.payment_proofs pr JOIN app.payments pay ON pay.id=pr.payment_id AND pay.tenant_id=pr.tenant_id JOIN app.raffle_purchases rp ON rp.id=pay.raffle_purchase_id AND rp.tenant_id=pay.tenant_id WHERE pr.id=$1 AND rp.id=$2 AND rp.tenant_id=$3 LIMIT 1`,[params.data.proofId,params.data.purchaseId,context.tenant.id]);
    const proof=result.rows[0];if(!proof)return reply.code(404).send({code:'NOT_FOUND',message:'No encontramos el comprobante.'});
    const {env}=await import('../env.js');
    const root=resolve(env.STORAGE_PATH),filePath=resolve(root,proof.storage_key);
    if(isAbsolute(proof.storage_key)||!filePath.startsWith(`${root}${sep}`))return reply.code(404).send({code:'NOT_FOUND',message:'No encontramos el comprobante.'});
    let bytes:Buffer;try{bytes=await readFile(filePath);}catch{return reply.code(404).send({code:'PROOF_UNAVAILABLE',message:'El comprobante no está disponible.'});}
    return reply.type(proof.mime_type).header('Content-Disposition','inline').header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').send(bytes);
  });

  app.post('/raffles/purchases/:purchaseId/review',async(request,reply)=>{
    const params=z.object({purchaseId:z.string().uuid()}).safeParse(request.params),body=z.discriminatedUnion('decision',[z.object({decision:z.literal('approve')}),z.object({decision:z.literal('reject'),reason:z.string().trim().min(5).max(500)})]).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({code:'INVALID_DATA',message:'Indica una aprobación o un motivo de rechazo de al menos 5 caracteres.'});
    const context=await requireRafflePermission(request,reply,'order.approve');if(!context)return reply;
    const pending=await context.db.query<{id:string;payment_id:string|null}>(`SELECT rp.id,p.id AS payment_id FROM app.raffle_purchases rp LEFT JOIN LATERAL(SELECT id FROM app.payments WHERE raffle_purchase_id=rp.id AND tenant_id=rp.tenant_id AND status IN('pending','in_review') ORDER BY created_at DESC LIMIT 1)p ON true WHERE rp.id=$1 AND rp.tenant_id=$2 AND rp.status='pending_payment' FOR UPDATE OF rp`,[params.data.purchaseId,context.tenant.id]);
    const purchase=pending.rows[0];if(!purchase)return reply.code(409).send({code:'PURCHASE_NOT_PENDING',message:'La participación ya fue revisada o no existe.'});
    if(body.data.decision==='approve'){
      if(!purchase.payment_id)return reply.code(409).send({code:'PAYMENT_NOT_FOUND',message:'No encontramos un pago pendiente para esta participación.'});
      await context.db.query('SELECT app.fn_approve_raffle_purchase($1,$2)',[purchase.id,context.actor.id]);
      return {purchaseId:purchase.id,status:'approved'};
    }
    await context.db.query(`UPDATE app.raffle_purchases SET status='rejected',updated_at=now() WHERE id=$1 AND tenant_id=$2`,[purchase.id,context.tenant.id]);
    if(purchase.payment_id)await context.db.query(`UPDATE app.payments SET status='rejected',rejection_reason=$3,reviewed_by=$4,reviewed_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2`,[purchase.payment_id,context.tenant.id,body.data.reason,context.actor.id]);
    return {purchaseId:purchase.id,status:'rejected'};
  });
}
