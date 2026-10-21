import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export async function repeatPlayRoutes(app: FastifyInstance) {
  app.get('/tickets/:ticketId/repeat', async (request, reply) => {
    if (!request.actor || !request.database?.client || !request.tenant) {
      return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para repetir una jugada.' });
    }
    if (request.actor.role !== 'client') {
      return reply.code(403).send({ code: 'CLIENT_ONLY', message: 'Esta función está disponible para clientes registrados.' });
    }
    const params = z.object({ ticketId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No encontramos una jugada disponible para repetir.' });

    const result = await request.database.client.query(
      `SELECT oi.draw_id AS "drawId", oi.digits, oi.number, oi.amount_cents::text AS "amountCents",
              pv.plan_id AS "planId"
         FROM app.tickets t
         JOIN app.orders o ON o.id = t.order_id AND o.tenant_id = t.tenant_id
         JOIN app.order_items oi ON oi.ticket_id = t.id AND oi.tenant_id = t.tenant_id
         JOIN app.plan_versions pv ON pv.id = oi.plan_version_id
        WHERE t.id = $1 AND t.tenant_id = $2 AND o.user_id = $3
          AND t.status = 'active' AND oi.status = 'active'
        ORDER BY oi.created_at, oi.id`,
      [params.data.ticketId, request.tenant.id, request.actor.id],
    );
    if (!result.rows.length) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No encontramos una jugada disponible para repetir.' });
    return { items: result.rows };
  });
}
