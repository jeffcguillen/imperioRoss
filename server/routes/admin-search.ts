import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

async function requireSearchAccess(request: FastifyRequest, reply: FastifyReply) {
  if (!request.actor || !request.database?.client || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  if (request.actor.role !== 'admin') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'La búsqueda global requiere acceso administrativo.' });
    return null;
  }
  const permission = await request.database.client.query<{ allowed: boolean }>(
    'SELECT app.fn_can($1, $2) AS allowed', [request.actor.id, 'report.view'],
  );
  if (!permission.rows[0]?.allowed) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para consultar la búsqueda global.' });
    return null;
  }
  return { db: request.database.client, tenantId: request.tenant.id };
}

export async function adminSearchRoutes(app: FastifyInstance) {
  app.post('/tickets/:ticketId/void', async (request, reply) => {
    if (!request.actor || !request.database?.client || !request.tenant) {
      return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    }
    if (request.actor.role !== 'admin') {
      return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Solo Administración puede anular tickets desde la búsqueda global.' });
    }
    const permission = await request.database.client.query<{ allowed: boolean }>(
      'SELECT app.fn_can($1, $2) AS allowed', [request.actor.id, 'ticket.void'],
    );
    if (!permission.rows[0]?.allowed) {
      return reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para anular tickets.' });
    }
    const params = z.object({ ticketId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ code: 'INVALID_DATA', message: 'Indica un motivo de al menos 5 caracteres y un ticket válido.' });
    }
    const ticket = await request.database.client.query<{ id: string; status: string }>(
      'SELECT id, status::text FROM app.tickets WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [params.data.ticketId, request.tenant.id],
    );
    if (!ticket.rows[0] || ticket.rows[0].status !== 'active') {
      return reply.code(409).send({ code: 'TICKET_NO_ANULABLE', message: 'El ticket no existe o ya no está activo.' });
    }
    await request.database.client.query('SELECT app.fn_void_ticket($1, $2, $3, $4)', [ticket.rows[0].id, request.actor.id, body.data.reason, 'none']);
    return { ticketId: ticket.rows[0].id, status: 'voided', financialEffect: 'none' };
  });

  app.get('/search', async (request, reply) => {
    const context = await requireSearchAccess(request, reply);
    if (!context) return reply;
    const parsed = z.object({ q: z.string().trim().min(2).max(100) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_SEARCH', message: 'Escribe al menos dos caracteres para buscar.' });
    const escaped = parsed.data.q.replace(/[\\%_]/g, '\\$&');
    const pattern = `%${escaped}%`;
    const result = await context.db.query(
      `WITH matches AS (
         SELECT 'order'::text AS kind, o.id, o.purchase_code AS code, o.buyer_name AS title,
                concat(o.buyer_phone, ' · ', o.payment_method::text) AS detail, o.status::text AS status, o.created_at AS "createdAt",
                NULL::text AS href
           FROM app.orders o
          WHERE o.tenant_id = $1 AND (o.purchase_code ILIKE $2 OR o.buyer_name ILIKE $2 OR o.buyer_phone_norm = app.fn_norm_phone($3))
         UNION ALL
         SELECT 'ticket', t.id, t.code, 'Ticket de ' || o.buyer_name,
                o.purchase_code || ' · ' || o.buyer_phone, t.status::text, t.created_at,
                '/verificar/' || t.code
           FROM app.tickets t JOIN app.orders o ON o.id = t.order_id AND o.tenant_id = t.tenant_id
          WHERE t.tenant_id = $1 AND (t.code ILIKE $2 OR o.purchase_code ILIKE $2 OR o.buyer_phone_norm = app.fn_norm_phone($3))
         UNION ALL
         SELECT 'user', u.id, u.role::text, u.full_name,
                concat(u.phone, CASE WHEN u.email IS NULL THEN '' ELSE ' · ' || u.email::text END),
                CASE WHEN u.is_active THEN 'active' ELSE 'inactive' END, u.created_at,
                '/admin/usuarios?q=' || replace(u.phone, '+', '%2B')
           FROM app.users u
          WHERE u.tenant_id = $1 AND (u.full_name ILIKE $2 OR u.phone_norm = app.fn_norm_phone($3) OR u.email::text ILIKE $2)
       )
       SELECT kind, id, code, title, detail, status, "createdAt", href
         FROM matches ORDER BY "createdAt" DESC, kind, code LIMIT 40`,
      [context.tenantId, pattern, parsed.data.q],
    );
    return { items: result.rows };
  });
}
