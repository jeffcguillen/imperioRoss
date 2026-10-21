import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const createSchema = z.object({
  digits: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  number: z.string().regex(/^\d{2,4}$/),
  label: z.string().trim().max(60).optional().transform((value) => value || null),
}).superRefine((data, context) => {
  if (data.number.length !== data.digits) context.addIssue({ code: 'custom', path: ['number'], message: 'El número debe coincidir con la modalidad.' });
});

async function requireCustomer(request: FastifyRequest, reply: FastifyReply) {
  if (!request.actor || !request.database?.client || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  if (request.actor.role !== 'client') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Los favoritos están disponibles para cuentas cliente.' });
    return null;
  }
  return { db: request.database.client, actor: request.actor, tenant: request.tenant };
}

export async function favoriteRoutes(app: FastifyInstance) {
  app.get('/favorites', async (request, reply) => {
    const context = await requireCustomer(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT id, digits, number, label, created_at AS "createdAt"
         FROM app.favorite_numbers
        WHERE tenant_id = $1 AND user_id = $2
        ORDER BY created_at DESC, digits, number LIMIT 100`,
      [context.tenant.id, context.actor.id],
    );
    return { items: result.rows };
  });

  app.post('/favorites', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: parsed.error.issues[0]?.message ?? 'Revisa el número favorito.' });
    const context = await requireCustomer(request, reply);
    if (!context) return reply;
    const { digits, number, label } = parsed.data;
    const inserted = await context.db.query<{ id: string }>(
      `INSERT INTO app.favorite_numbers (tenant_id, user_id, digits, number, label)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, digits, number) DO NOTHING
       RETURNING id`,
      [context.tenant.id, context.actor.id, digits, number, label],
    );
    if (!inserted.rowCount) return reply.code(409).send({ code: 'FAVORITE_EXISTS', message: 'Ese número ya está en tus favoritos.' });
    return reply.code(201).send({ id: inserted.rows[0].id });
  });

  app.delete('/favorites/:id', async (request, reply) => {
    const id = z.string().uuid().safeParse((request.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'El favorito indicado no es válido.' });
    const context = await requireCustomer(request, reply);
    if (!context) return reply;
    const deleted = await context.db.query(
      `DELETE FROM app.favorite_numbers WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING id`,
      [id.data, context.tenant.id, context.actor.id],
    );
    if (!deleted.rowCount) return reply.code(404).send({ code: 'FAVORITE_NOT_FOUND', message: 'No encontramos ese favorito en tu cuenta.' });
    return reply.code(204).send();
  });
}
