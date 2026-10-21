import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

async function requireDashboardPermission(request: FastifyRequest, reply: FastifyReply) {
  if (!request.actor || !request.database?.client || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  if (request.actor.role !== 'admin') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Solo Administración puede consultar el tablero.' });
    return null;
  }
  const allowed = await request.database.client.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [request.actor.id, 'report.view']);
  if (!allowed.rows[0]?.allowed) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para consultar el tablero.' });
    return null;
  }
  return { db: request.database.client, tenant: request.tenant };
}

export async function adminDashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard', async (request, reply) => {
    const context = await requireDashboardPermission(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT
         (SELECT COALESCE(sum(o.total_cents), 0)::text FROM app.orders o
           WHERE o.tenant_id = $1 AND o.status = 'approved' AND NOT o.on_credit
             AND (o.approved_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date) AS "salesTodayCents",
         (SELECT count(*)::text FROM app.orders o WHERE o.tenant_id = $1 AND o.status = 'approved'
             AND (o.approved_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date) AS "approvedToday",
         (SELECT count(*)::text FROM app.orders o WHERE o.tenant_id = $1 AND o.status = 'pending_review') AS "ordersToReview",
         (SELECT count(*)::text FROM app.withdrawals w WHERE w.tenant_id = $1 AND w.status IN ('requested','in_review','approved')) AS "withdrawalsToReview",
         (SELECT count(*)::text FROM app.prizes p WHERE p.tenant_id = $1 AND p.status IN ('pending','generated')) AS "prizesToPay",
         (SELECT count(*)::text FROM app.users u WHERE u.tenant_id = $1 AND u.is_active AND u.role = 'client') AS "activeClients",
         (SELECT count(*)::text FROM app.draw_sessions s WHERE s.tenant_id = $1 AND s.status IN ('scheduled','open') AND s.closes_at > now()) AS "openSessions"`,
      [context.tenant.id, context.tenant.timezone],
    );
    return { metrics: result.rows[0] };
  });
}
