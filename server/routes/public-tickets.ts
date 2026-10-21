import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const ticketParams = z.object({ code: z.string().trim().toUpperCase().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/) });

export async function publicTicketRoutes(app: FastifyInstance) {
  app.get('/tickets/verify/:code', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = ticketParams.safeParse(request.params);
    if (!parsed.success) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No encontramos ese ticket.' });
    const db = request.database?.client;
    if (!db || !request.tenant) throw new Error('REQUEST_CONTEXT_MISSING');
    const result = await db.query(
      `SELECT t.id, t.code, t.status, t.digits, t.total_cents::text AS "totalCents", t.created_at AS "createdAt",
              d.name AS "drawName", s.draw_date::text AS "drawDate",
              COALESCE(lines.items, '[]'::jsonb) AS lines
         FROM app.tickets t
         JOIN app.draw_sessions s ON s.id = t.session_id AND s.tenant_id = t.tenant_id
         JOIN app.draws d ON d.id = s.draw_id AND d.tenant_id = t.tenant_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('number', oi.number, 'amountCents', oi.amount_cents::text) ORDER BY oi.created_at) AS items
             FROM app.order_items oi WHERE oi.ticket_id = t.id AND oi.tenant_id = t.tenant_id
         ) lines ON true
        WHERE t.tenant_id = $1 AND t.code = $2 LIMIT 1`,
      [request.tenant.id, parsed.data.code],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'NOT_FOUND', message: 'No encontramos ese ticket.' });
    return { ticket: result.rows[0] };
  });
}
