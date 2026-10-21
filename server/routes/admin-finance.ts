import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';

async function requireFinance(request: FastifyRequest, reply: FastifyReply, action: 'report.view' | 'cash.close' | 'finance.manage' | 'refund.manage') {
  const db = request.database?.client;
  if (!request.actor || !db || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  if (request.actor.role !== 'admin') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Finanzas y cierres están reservados a Administración.' });
    return null;
  }
  const allowed = await db.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [request.actor.id, action]);
  if (!allowed.rows[0]?.allowed) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para esta operación.' });
    return null;
  }
  return { db, actor: request.actor, tenant: request.tenant };
}

const cashQuery = z.object({ locationId: z.string().uuid().nullable().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const closeBody = cashQuery.extend({ countedCents: z.string().regex(/^\d{1,15}$/), notes: z.string().trim().max(1000).optional() });
const transferBody = z.object({ fromAccountId: z.string().uuid(), toAccountId: z.string().uuid(), amountCents: z.string().regex(/^[1-9]\d{0,14}$/), note: z.string().trim().min(3).max(500) }).refine((body) => body.fromAccountId !== body.toAccountId, { path: ['toAccountId'], message: 'Las cuentas deben ser distintas.' });
const receivablePaymentBody = z.object({ amountCents: z.string().regex(/^[1-9]\d{0,14}$/), idempotencyKey: z.string().uuid() });
const refundCreateBody = z.object({
  purchaseCode: z.string().trim().toUpperCase().regex(/^(?:#\d{6}|RF-\d{4,10})$/),
  amountCents: z.string().regex(/^[1-9]\d{0,14}$/),
  reason: z.enum(['duplicate_payment','technical_error','operation_not_executed','other_authorized']),
  notes: z.string().trim().max(500).optional(),
});

export async function adminFinanceRoutes(app: FastifyInstance) {
  app.post('/finance/refunds', async (request, reply) => {
    const body = refundCreateBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Indica el código de compra, importe y motivo válido del reembolso.' });
    const context = await requireFinance(request, reply, 'refund.manage');
    if (!context) return reply;
    const payment = await context.db.query<{ id: string; order_id: string; amount_cents: string; status: string }>(
      `SELECT p.id, p.order_id, p.amount_cents::text, p.status::text
         FROM app.orders o JOIN app.payments p ON p.order_id=o.id AND p.tenant_id=o.tenant_id
        WHERE o.tenant_id=$1 AND o.purchase_code=$2 AND p.status IN ('approved','refunded')
        ORDER BY p.created_at DESC,p.id LIMIT 1 FOR UPDATE OF p`,
      [context.tenant.id, body.data.purchaseCode],
    );
    const paid = payment.rows[0];
    if (!paid) return reply.code(404).send({ code: 'REFUND_PAYMENT_NOT_FOUND', message: 'No encontramos un pago aprobado asociado a esa compra.' });
    const totals = await context.db.query<{ reserved_cents: string }>(
      "SELECT COALESCE(sum(amount_cents),0)::text AS reserved_cents FROM app.refunds WHERE payment_id=$1 AND status IN ('pending','completed')",
      [paid.id],
    );
    const amount = BigInt(body.data.amountCents);
    const remaining = BigInt(paid.amount_cents) - BigInt(totals.rows[0]?.reserved_cents ?? '0');
    if (amount > remaining) return reply.code(409).send({ code: 'REFUND_LIMIT_EXCEEDED', message: 'El importe supera el saldo todavía reembolsable de este pago.' });
    await context.db.query('SELECT set_config(\'app.audit_reason\',$1,true)', [`Solicitud de reembolso ${body.data.reason} (${body.data.amountCents} centavos) para ${body.data.purchaseCode}`]);
    const inserted = await context.db.query<{ id: string }>(
      `INSERT INTO app.refunds (tenant_id,payment_id,order_id,reason,amount_cents,notes)
       VALUES ($1,$2,$3,$4::app.refund_reason,$5,$6) RETURNING id`,
      [context.tenant.id, paid.id, paid.order_id, body.data.reason, body.data.amountCents, body.data.notes || null],
    );
    return reply.code(201).send({ refundId: inserted.rows[0]?.id, status: 'pending' });
  });

  app.get('/finance/refunds', async (request, reply) => {
    const context = await requireFinance(request, reply, 'refund.manage');
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT r.id,r.payment_id AS "paymentId",r.order_id AS "orderId",r.ticket_id AS "ticketId",
              r.reason::text,r.amount_cents::text AS "amountCents",r.status,r.notes,r.created_at AS "createdAt",
              p.method::text AS "paymentMethod",o.purchase_code AS "purchaseCode",o.buyer_name AS "buyerName",
              t.code AS "ticketCode"
         FROM app.refunds r JOIN app.payments p ON p.id=r.payment_id AND p.tenant_id=r.tenant_id
         LEFT JOIN app.orders o ON o.id=r.order_id AND o.tenant_id=r.tenant_id
         LEFT JOIN app.tickets t ON t.id=r.ticket_id AND t.tenant_id=r.tenant_id
        WHERE r.tenant_id=$1 AND r.status='pending'
        ORDER BY r.created_at,r.id LIMIT 100`, [context.tenant.id],
    );
    return { items: result.rows };
  });

  app.post('/finance/refunds/:refundId/complete', async (request, reply) => {
    const params = z.object({ refundId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ method: z.enum(['bank_transfer','cash','other']).optional(), reference: z.string().trim().min(3).max(200).optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Indica una referencia válida de la devolución.' });
    const context = await requireFinance(request, reply, 'refund.manage');
    if (!context) return reply;
    const refund = await context.db.query<{ id: string; payment_id: string; amount_cents: string; status: string; notes: string | null; payment_method: string; payment_amount_cents: string; user_id: string | null }>(
      `SELECT r.id,r.payment_id,r.amount_cents::text,r.status,r.notes,p.method::text AS payment_method,p.amount_cents::text AS payment_amount_cents,o.user_id
         FROM app.refunds r JOIN app.payments p ON p.id=r.payment_id AND p.tenant_id=r.tenant_id
         LEFT JOIN app.orders o ON o.id=r.order_id AND o.tenant_id=r.tenant_id
        WHERE r.id=$1 AND r.tenant_id=$2 FOR UPDATE OF r,p`, [params.data.refundId, context.tenant.id],
    );
    const pending = refund.rows[0];
    if (!pending || pending.status !== 'pending') return reply.code(409).send({ code: 'REFUND_NOT_PENDING', message: 'El reembolso no existe o ya fue resuelto.' });
    const totals = await context.db.query<{ reserved_cents: string }>(
      "SELECT COALESCE(sum(amount_cents),0)::text AS reserved_cents FROM app.refunds WHERE payment_id=$1 AND status IN ('pending','completed')", [pending.payment_id],
    );
    if (BigInt(totals.rows[0]?.reserved_cents ?? '0') > BigInt(pending.payment_amount_cents)) return reply.code(409).send({ code: 'REFUND_LIMIT_EXCEEDED', message: 'Los reembolsos vinculados superan el importe del pago. Revisa los registros antes de continuar.' });
    if (pending.payment_method !== 'wallet' && (!body.data.method || !body.data.reference)) return reply.code(400).send({ code: 'REFUND_REFERENCE_REQUIRED', message: 'Registra el método y la referencia de la devolución que ya realizaste.' });
    if (pending.payment_method !== 'wallet') {
      const account = await context.db.query<{ id: string }>("SELECT id FROM app.financial_accounts WHERE tenant_id=$1 AND kind='payout' AND is_active ORDER BY created_at LIMIT 1", [context.tenant.id]);
      if (!account.rows[0]) return reply.code(409).send({ code: 'PAYOUT_ACCOUNT_REQUIRED', message: 'Configura una cuenta activa de egresos antes de cerrar este reembolso.' });
      const reference = body.data.reference!;
      const methodLabel = body.data.method!;
      await context.db.query("SELECT set_config('app.audit_reason',$1,true)", [`Devolución externa confirmada (${methodLabel}); referencia ${reference}`]);
      await context.db.query(
        `UPDATE app.refunds SET notes=concat_ws(' · ',NULLIF(notes,''),$3) WHERE id=$1 AND tenant_id=$2 AND status='pending'`,
        [pending.id, context.tenant.id, `Devolución manual ${methodLabel}: ${reference}`],
      );
    }
    const method = pending.payment_method === 'wallet' && pending.user_id ? 'wallet_credit' : body.data.method ?? pending.payment_method;
    await context.db.query('SELECT app.fn_complete_refund($1,$2,$3,$4)', [pending.id, context.actor.id, method, null]);
    return { refundId: pending.id, status: 'completed' };
  });

  app.get('/finance/receivables', async (request, reply) => {
    const context = await requireFinance(request, reply, 'finance.manage');
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT r.id, r.debtor_name AS "debtorName", r.amount_cents::text AS "amountCents", r.collected_cents::text AS "collectedCents",
              (r.amount_cents-r.collected_cents)::text AS "remainingCents", r.status, r.due_date::text AS "dueDate", r.created_at AS "createdAt",
              c.id AS "contractId", c.client_name AS "clientName", c.client_phone AS "clientPhone", d.name AS "drawName",
              s.draw_date::text AS "drawDate", o.purchase_code AS "purchaseCode",
              COALESCE(p.items,'[]'::jsonb) AS payments
         FROM app.receivables r
         LEFT JOIN app.contratas c ON c.id=r.contrata_id AND c.tenant_id=r.tenant_id
         LEFT JOIN app.draws d ON d.id=c.draw_id AND d.tenant_id=c.tenant_id
         LEFT JOIN app.contrata_slots sl ON sl.id=r.contrata_slot_id AND sl.tenant_id=r.tenant_id
         LEFT JOIN app.draw_sessions s ON s.id=sl.session_id AND s.tenant_id=sl.tenant_id
         LEFT JOIN app.orders o ON o.id=r.order_id AND o.tenant_id=r.tenant_id
         LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('amountCents',rp.amount_cents::text,'receivedAt',rp.received_at,'receivedBy',u.full_name) ORDER BY rp.received_at DESC) items
           FROM app.receivable_payments rp LEFT JOIN app.users u ON u.id=rp.received_by AND u.tenant_id=rp.tenant_id
           WHERE rp.receivable_id=r.id AND rp.tenant_id=r.tenant_id) p ON true
        WHERE r.tenant_id=$1 AND r.status IN ('open','partial') ORDER BY r.due_date NULLS LAST,r.created_at LIMIT 200`, [context.tenant.id],
    );
    return { items: result.rows };
  });

  app.post('/finance/receivables/:id/payments', async (request, reply) => {
    const params=z.object({id:z.string().uuid()}).safeParse(request.params);
    const body=receivablePaymentBody.safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({code:'INVALID_DATA',message:'Indica un importe válido y una clave de operación.'});
    const context=await requireFinance(request,reply,'finance.manage');
    if(!context)return reply;
    const {id}=params.data,{amountCents,idempotencyKey}=body.data;
    const fingerprint=createHash('sha256').update(JSON.stringify({tenantId:context.tenant.id,receivableId:id,amountCents,actorId:context.actor.id})).digest('hex');
    await context.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${context.tenant.id}:receivable-payment:${idempotencyKey}`]);
    await context.db.query("INSERT INTO app.idempotency_keys (tenant_id,scope,key,response) VALUES ($1,'receivable-payment',$2,NULL) ON CONFLICT DO NOTHING",[context.tenant.id,idempotencyKey]);
    const prior=await context.db.query<{response:{fingerprint:string;result:unknown}|null}>("SELECT response FROM app.idempotency_keys WHERE tenant_id=$1 AND scope='receivable-payment' AND key=$2 FOR UPDATE",[context.tenant.id,idempotencyKey]);
    if(prior.rows[0]?.response){if(prior.rows[0].response.fingerprint!==fingerprint)return reply.code(409).send({code:'IDEMPOTENCY_CONFLICT',message:'La clave ya se usó para otro cobro.'});return reply.send(prior.rows[0].response.result);}
    const receivable=await context.db.query<{amountCents:string;collectedCents:string;status:string}>('SELECT amount_cents::text AS "amountCents",collected_cents::text AS "collectedCents",status FROM app.receivables WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,context.tenant.id]);
    const current=receivable.rows[0];
    if(!current||!['open','partial'].includes(current.status))return reply.code(404).send({code:'RECEIVABLE_NOT_OPEN',message:'La cuenta por cobrar no existe o ya está saldada.'});
    if(BigInt(amountCents)>BigInt(current.amountCents)-BigInt(current.collectedCents))return reply.code(400).send({code:'AMOUNT_EXCEEDS_BALANCE',message:'El abono no puede superar el saldo pendiente.'});
    await context.db.query('SELECT app.fn_receive_receivable_payment($1,$2::bigint,$3)',[id,amountCents,context.actor.id]);
    const updated=await context.db.query('SELECT status,amount_cents::text AS "amountCents",collected_cents::text AS "collectedCents",(amount_cents-collected_cents)::text AS "remainingCents" FROM app.receivables WHERE id=$1 AND tenant_id=$2',[id,context.tenant.id]);
    const result={id,...updated.rows[0]};
    await context.db.query("UPDATE app.idempotency_keys SET response=$3::jsonb WHERE tenant_id=$1 AND scope='receivable-payment' AND key=$2",[context.tenant.id,idempotencyKey,JSON.stringify({fingerprint,result})]);
    return reply.code(201).send(result);
  });

  app.get('/finance/accounts', async (request, reply) => {
    const context = await requireFinance(request, reply, 'finance.manage');
    if (!context) return reply;
    const result = await context.db.query(`SELECT id,kind::text,name FROM app.financial_accounts WHERE tenant_id=$1 AND is_active ORDER BY kind,name`, [context.tenant.id]);
    return { items: result.rows };
  });

  app.post('/finance/transfer', async (request, reply) => {
    const body = transferBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Completa dos cuentas distintas, un valor válido y una nota.' });
    const context = await requireFinance(request, reply, 'finance.manage');
    if (!context) return reply;
    const accounts = await context.db.query<{ id: string }>('SELECT id FROM app.financial_accounts WHERE tenant_id=$1 AND is_active AND id=ANY($2::uuid[])', [context.tenant.id, [body.data.fromAccountId, body.data.toAccountId]]);
    if (accounts.rowCount !== 2) return reply.code(400).send({ code: 'INVALID_ACCOUNT', message: 'Selecciona dos cuentas financieras activas de esta plataforma.' });
    const result = await context.db.query<{ transfer_ref: string }>('SELECT app.fn_internal_transfer($1,$2,$3::bigint,$4,$5) AS transfer_ref', [body.data.fromAccountId, body.data.toAccountId, body.data.amountCents, context.actor.id, body.data.note]);
    return reply.code(201).send({ transferId: result.rows[0].transfer_ref });
  });

  app.get('/finance', async (request, reply) => {
    const context = await requireFinance(request, reply, 'report.view');
    if (!context) return reply;
    const query = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), locationId: z.string().uuid().nullable().optional() }).safeParse(request.query);
    if (!query.success || query.data.from > query.data.to) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Selecciona un rango de fechas válido.' });
    const { from, to, locationId = null } = query.data;
    const [summary, days, locations, closings] = await Promise.all([
      context.db.query(`SELECT
        COALESCE(sum(amount_cents) FILTER (WHERE direction='in'),0)::text AS income,
        COALESCE(sum(amount_cents) FILTER (WHERE direction='out'),0)::text AS outflow,
        (COALESCE(sum(amount_cents) FILTER (WHERE direction='in'),0) - COALESCE(sum(amount_cents) FILTER (WHERE direction='out'),0))::text AS net,
        count(*)::text AS movements
        FROM app.financial_transactions WHERE tenant_id=$1 AND (occurred_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date AND ($5::uuid IS NULL OR location_id=$5)`, [context.tenant.id, context.tenant.timezone, from, to, locationId]),
      context.db.query(`SELECT (occurred_at AT TIME ZONE $2)::date::text AS date,
        COALESCE(sum(amount_cents) FILTER (WHERE direction='in'),0)::text AS income,
        COALESCE(sum(amount_cents) FILTER (WHERE direction='out'),0)::text AS outflow,
        count(*)::text AS movements FROM app.financial_transactions
        WHERE tenant_id=$1 AND (occurred_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date AND ($5::uuid IS NULL OR location_id=$5)
        GROUP BY 1 ORDER BY 1 DESC`, [context.tenant.id, context.tenant.timezone, from, to, locationId]),
      context.db.query(`SELECT id,name FROM app.locations WHERE tenant_id=$1 AND is_active ORDER BY name`, [context.tenant.id]),
      context.db.query(`SELECT c.id,c.location_id AS "locationId",COALESCE(l.name,'Caja general') AS "locationName",c.closing_date::text AS date,c.opening_cents::text AS opening,c.income_cents::text AS income,c.transfers_in_cents::text AS "transfersIn",c.prizes_paid_cents::text AS "prizesPaid",c.expenses_cents::text AS expenses,c.withdrawals_cents::text AS withdrawals,c.transfers_out_cents::text AS "transfersOut",c.expected_cents::text AS expected,c.counted_cents::text AS counted,c.difference_cents::text AS difference,c.notes,c.closed_at AS "closedAt"
        FROM app.cash_closings c LEFT JOIN app.locations l ON l.id=c.location_id AND l.tenant_id=c.tenant_id WHERE c.tenant_id=$1 AND c.closing_date BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR c.location_id IS NOT DISTINCT FROM $4) ORDER BY c.closing_date DESC,c.closed_at DESC LIMIT 100`, [context.tenant.id, from, to, locationId]),
    ]);
    return { summary: summary.rows[0], days: days.rows, locations: locations.rows, closings: closings.rows, timezone: context.tenant.timezone };
  });

  app.get('/cash/preview', async (request, reply) => {
    const context = await requireFinance(request, reply, 'cash.close');
    if (!context) return reply;
    const query = cashQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Selecciona un día y un local válido.' });
    const result = await context.db.query(`SELECT opening::text,income::text,transfers_in::text AS "transfersIn",prizes_paid::text AS "prizesPaid",expenses::text,withdrawals::text,transfers_out::text AS "transfersOut",expected::text FROM app.fn_cash_preview($1,$2::date)`, [query.data.locationId ?? null, query.data.date]);
    const existing = await context.db.query('SELECT id FROM app.cash_closings WHERE tenant_id=$1 AND location_id IS NOT DISTINCT FROM $2::uuid AND closing_date=$3::date LIMIT 1', [context.tenant.id, query.data.locationId ?? null, query.data.date]);
    return { preview: result.rows[0], closed: existing.rowCount !== 0 };
  });

  app.post('/cash/close', async (request, reply) => {
    const body = closeBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Verifica la fecha, el valor contado y las observaciones.' });
    const context = await requireFinance(request, reply, 'cash.close');
    if (!context) return reply;
    const today = await context.db.query<{ date: string }>('SELECT (now() AT TIME ZONE $1)::date::text AS date', [context.tenant.timezone]);
    if (body.data.date !== today.rows[0]?.date) return reply.code(400).send({ code: 'INVALID_DATE', message: 'El cierre solo puede registrarse para el día actual.' });
    const result = await context.db.query<{ id: string }>('SELECT app.fn_close_cash($1,$2::date,$3::bigint,$4,$5) AS id', [body.data.locationId ?? null, body.data.date, body.data.countedCents, context.actor.id, body.data.notes || null]);
    return reply.code(201).send({ closingId: result.rows[0].id });
  });
}
