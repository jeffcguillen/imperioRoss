import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const resultBody = z.object({
  sessionId: z.string().uuid(),
  digits: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  positions: z.array(z.string().regex(/^\d+$/)).min(1).max(100),
  reason: z.string().trim().max(500).optional(),
});

async function requireResultEditor(request: FastifyRequest, reply: FastifyReply) {
  const db = request.database?.client;
  if (!request.actor || !db || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  if (request.actor.role !== 'admin') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Solo Administración puede publicar resultados.' });
    return null;
  }
  const permission = await db.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [request.actor.id, 'result.edit']);
  if (!permission.rows[0]?.allowed) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para publicar resultados.' });
    return null;
  }
  return { db, actor: request.actor, tenant: request.tenant };
}

export async function adminResultRoutes(app: FastifyInstance) {
  app.get('/results/sessions', async (request, reply) => {
    const context = await requireResultEditor(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT s.id AS "sessionId", s.draw_date::text AS "drawDate", s.status,
              s.draws_at AS "drawsAt", d.name AS "drawName",
              COALESCE(modalities.items, '[]'::jsonb) AS modalities
         FROM app.draw_sessions s
         JOIN app.draws d ON d.id = s.draw_id AND d.tenant_id = s.tenant_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
             'digits', m.digits, 'maxSuertes', m.max_suertes,
             'resultId', r.id, 'version', r.version, 'publishedAt', r.published_at,
             'positions', COALESCE(pos.items, '[]'::jsonb)
           ) ORDER BY m.digits) AS items
             FROM app.draw_modalities m
             LEFT JOIN app.results r ON r.session_id = s.id AND r.digits = m.digits AND r.is_current
             LEFT JOIN LATERAL (
               SELECT jsonb_agg(rp.winning_number ORDER BY rp.suerte_no) AS items
                 FROM app.result_positions rp WHERE rp.result_id = r.id AND rp.tenant_id = r.tenant_id
             ) pos ON true
            WHERE m.draw_id = s.draw_id AND m.tenant_id = s.tenant_id AND m.enabled
         ) modalities ON true
        WHERE s.tenant_id = $1 AND s.status <> 'cancelled'
          AND s.draws_at <= now()
          AND s.draw_date >= (now() AT TIME ZONE $2)::date - 14
        ORDER BY s.draw_date DESC, s.draws_at DESC LIMIT 100`,
      [context.tenant.id, context.tenant.timezone],
    );
    return { items: result.rows };
  });

  app.post('/results', async (request, reply) => {
    const body = resultBody.safeParse(request.body);
    if (!body.success || body.data.positions.some((number) => number.length !== body.data.digits)) {
      return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa la cantidad de cifras y las suertes del resultado.' });
    }
    const context = await requireResultEditor(request, reply);
    if (!context) return reply;
    const { sessionId, digits, positions, reason } = body.data;
    await context.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`result:${sessionId}:${digits}`]);
    const sessionState = await context.db.query<{ can_publish: boolean }>(
      "SELECT draws_at <= now() AND status <> 'cancelled' AS can_publish FROM app.draw_sessions WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
      [sessionId, context.tenant.id],
    );
    if (!sessionState.rows[0]?.can_publish) return reply.code(409).send({ code: 'RESULTADO_ANTES_DEL_SORTEO', message: 'El resultado solo se puede publicar después del horario del sorteo.' });
    const current = await context.db.query<{ id: string; positions: string[] }>(
      `SELECT r.id, COALESCE(jsonb_agg(rp.winning_number ORDER BY rp.suerte_no), '[]'::jsonb) AS positions
         FROM app.results r LEFT JOIN app.result_positions rp ON rp.result_id = r.id AND rp.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1 AND r.session_id = $2 AND r.digits = $3 AND r.is_current
        GROUP BY r.id`, [context.tenant.id, sessionId, digits],
    );
    if (current.rows[0]?.positions.length === positions.length && current.rows[0].positions.every((value, index) => value === positions[index])) {
      return { resultId: current.rows[0].id, unchanged: true };
    }
    const result = await context.db.query<{ result_id: string }>(
      'SELECT app.fn_register_result($1, $2, $3::jsonb, $4, $5) AS result_id',
      [sessionId, digits, JSON.stringify(positions), context.actor.id, reason ?? null],
    );
    return { resultId: result.rows[0].result_id, unchanged: false };
  });
}
