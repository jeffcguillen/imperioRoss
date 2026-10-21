import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

async function requireAuditAccess(request: FastifyRequest, reply: FastifyReply) {
  if (!request.actor || !request.database?.client || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  if (request.actor.role !== 'admin') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Solo Administración puede consultar la auditoría.' });
    return null;
  }
  const allowed = await request.database.client.query<{ allowed: boolean }>(
    'SELECT app.fn_can($1, $2) AS allowed', [request.actor.id, 'report.view'],
  );
  if (!allowed.rows[0]?.allowed) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para consultar la auditoría.' });
    return null;
  }
  return { db: request.database.client, tenantId: request.tenant.id };
}

export async function adminAuditRoutes(app: FastifyInstance) {
  app.get('/audit', async (request, reply) => {
    const context = await requireAuditAccess(request, reply);
    if (!context) return reply;
    const query = z.object({
      q: z.string().trim().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100_000).default(0),
    }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa los filtros de auditoría.' });

    const result = await context.db.query(
      `SELECT a.id::text AS id, a.actor_id AS "actorId", a.actor_role::text AS "actorRole",
              COALESCE(u.full_name, 'Usuario desactivado o sistema') AS "actorName",
              a.action, a.entity_type AS "entityType", a.entity_id AS "entityId",
              a.old_value AS "oldValue", a.new_value AS "newValue", a.reason,
              a.created_at AS "createdAt", count(*) OVER()::text AS "totalCount"
         FROM app.audit_log a
         LEFT JOIN app.users u ON u.id = a.actor_id AND u.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1
          AND ($2::text IS NULL OR concat_ws(' ', a.action, a.entity_type, a.entity_id,
               a.reason, u.full_name, a.actor_role::text) ILIKE '%' || $2 || '%')
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $3 OFFSET $4`,
      [context.tenantId, query.data.q || null, query.data.limit, query.data.offset],
    );
    return { items: result.rows, totalCount: Number(result.rows[0]?.totalCount ?? 0), limit: query.data.limit, offset: query.data.offset };
  });
}
