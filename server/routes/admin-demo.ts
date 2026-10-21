import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

async function requireDemoDashboard(request: FastifyRequest, reply: FastifyReply) {
  const db = request.database?.client;
  if (!request.actor || !db || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  if (request.actor.role !== 'admin') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'El estado de datos demo está reservado a Administración.' });
    return null;
  }
  const permission = await db.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [request.actor.id, 'report.view']);
  if (!permission.rows[0]?.allowed) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para consultar el estado de datos demo.' });
    return null;
  }
  return { db, tenantId: request.tenant.id };
}

export async function adminDemoRoutes(app: FastifyInstance) {
  app.get('/demo/status', async (request, reply) => {
    const context = await requireDemoDashboard(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `WITH demo_users AS (
         SELECT id FROM app.users WHERE tenant_id = $1 AND is_demo
       ), demo_draws AS (
         SELECT id FROM app.draws WHERE tenant_id = $1 AND (code ILIKE 'DEMO-%' OR name ILIKE '%DEMO%')
       ), demo_orders AS (
         SELECT id FROM app.orders WHERE tenant_id = $1 AND idempotency_key ILIKE 'demo-%'
       ), demo_raffles AS (
         SELECT id FROM app.special_raffles WHERE tenant_id = $1 AND name ILIKE '%DEMO%'
       ), demo_raffle_purchases AS (
         SELECT id FROM app.raffle_purchases WHERE tenant_id = $1 AND raffle_id IN (SELECT id FROM demo_raffles)
       ), demo_payments AS (
         SELECT id FROM app.payments WHERE tenant_id = $1 AND (order_id IN (SELECT id FROM demo_orders) OR raffle_purchase_id IN (SELECT id FROM demo_raffle_purchases))
       ), demo_sessions AS (
         SELECT id FROM app.draw_sessions WHERE tenant_id = $1 AND draw_id IN (SELECT id FROM demo_draws)
       ), demo_tickets AS (
         SELECT id FROM app.tickets WHERE tenant_id = $1 AND order_id IN (SELECT id FROM demo_orders)
       )
       SELECT
         (SELECT count(*)::text FROM demo_users) AS "demoUsers",
         (SELECT count(*)::text FROM demo_draws) AS "demoDraws",
         (SELECT count(*)::text FROM demo_sessions) AS "demoSessions",
         (SELECT count(*)::text FROM app.plans WHERE tenant_id = $1 AND draw_id IN (SELECT id FROM demo_draws)) AS "demoPlans",
         (SELECT count(*)::text FROM demo_orders) AS "demoOrders",
         (SELECT count(*)::text FROM demo_tickets) AS "demoTickets",
         (SELECT count(*)::text FROM app.results WHERE tenant_id = $1 AND session_id IN (SELECT id FROM demo_sessions)) AS "demoResults",
         (SELECT count(*)::text FROM app.prizes WHERE tenant_id = $1 AND ticket_id IN (SELECT id FROM demo_tickets)) AS "demoPrizes",
         (SELECT count(*)::text FROM demo_payments) AS "demoPayments",
         (SELECT count(*)::text FROM app.payment_proofs WHERE tenant_id=$1 AND payment_id IN (SELECT id FROM demo_payments)) AS "demoPaymentProofs",
         (SELECT count(*)::text FROM app.commissions WHERE tenant_id = $1 AND seller_id IN (SELECT id FROM demo_users)) AS "demoCommissions",
         (SELECT count(*)::text FROM app.contratas WHERE tenant_id = $1 AND created_by IN (SELECT id FROM demo_users)) AS "demoContracts",
         (SELECT count(*)::text FROM app.scheduled_plays WHERE tenant_id = $1 AND user_id IN (SELECT id FROM demo_users)) AS "demoScheduledPlays",
         (SELECT count(*)::text FROM demo_raffles) AS "demoRaffles",
         (SELECT count(*)::text FROM app.raffle_purchases WHERE tenant_id=$1 AND id IN (SELECT id FROM demo_raffle_purchases)) AS "demoRafflePurchases",
         (SELECT count(*)::text FROM app.raffle_packages WHERE tenant_id=$1 AND raffle_id IN (SELECT id FROM demo_raffles)) AS "demoRafflePackages",
         (SELECT count(*)::text FROM app.fortune_numbers WHERE tenant_id=$1 AND raffle_id IN (SELECT id FROM demo_raffles)) AS "demoFortuneNumbers",
         (SELECT count(*)::text FROM app.withdrawals WHERE tenant_id=$1 AND user_id IN (SELECT id FROM demo_users)) AS "demoWithdrawals",
         (SELECT count(*)::text FROM app.recharges r JOIN app.wallets w ON w.id=r.wallet_id AND w.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND w.user_id IN (SELECT id FROM demo_users)) AS "demoRecharges",
         (SELECT count(*)::text FROM app.financial_accounts WHERE tenant_id=$1 AND name ILIKE 'DEMO%') AS "demoFinancialAccounts",
         (SELECT count(*)::text FROM app.cash_closings WHERE tenant_id=$1 AND notes ILIKE '%DEMO%') AS "demoCashClosings",
         (SELECT count(*)::text FROM app.notifications WHERE tenant_id = $1 AND (user_id IN (SELECT id FROM demo_users) OR title ILIKE '%DEMO%' OR type ILIKE 'demo%')) AS "demoNotifications",
         (SELECT count(*)::text FROM app.audit_log WHERE tenant_id = $1 AND actor_id IN (SELECT id FROM demo_users)) AS "demoAuditEntries"`,
      [context.tenantId],
    );
    return { counts: result.rows[0], generatedAt: new Date().toISOString(), source: 'postgresql' };
  });
}
