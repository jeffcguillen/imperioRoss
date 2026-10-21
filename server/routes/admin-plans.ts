import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const prizeSchema = z.object({
  suerteNo: z.number().int().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  payoutPerDollarCents: z.string().regex(/^\d{1,15}$/),
});
const newPlanSchema = z.object({ drawId: z.string().uuid(), digits: z.union([z.literal(2), z.literal(3), z.literal(4)]), name: z.string().trim().min(2).max(100), prizes: z.array(prizeSchema).min(1).max(100) });
const newVersionSchema = z.object({ prizes: z.array(prizeSchema).min(1).max(100) });

async function requirePlanEditor(request: FastifyRequest, reply: FastifyReply) {
  const db = request.database?.client;
  if (!request.actor || !db || !request.tenant) { await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' }); return null; }
  if (request.actor.role !== 'admin') { await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Solo Administración puede gestionar planes.' }); return null; }
  const permission = await db.query<{ allowed: boolean }>('SELECT app.fn_can($1,$2) AS allowed', [request.actor.id, 'plan.edit']);
  if (!permission.rows[0]?.allowed) { await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para editar planes.' }); return null; }
  return { db, actor: request.actor, tenant: request.tenant };
}

function validPrizeOrder(prizes: z.infer<typeof prizeSchema>[]) {
  const positions = prizes.map((item) => item.suerteNo);
  return new Set(positions).size === positions.length && positions.every((position) => position <= prizes.length)
    && Array.from({ length: prizes.length }, (_, index) => index + 1).every((position) => positions.includes(position));
}

function prizePayload(prizes: z.infer<typeof prizeSchema>[]) {
  return JSON.stringify(prizes.map((item) => ({ suerte_no: item.suerteNo, name: item.name, payout_per_dollar_cents: item.payoutPerDollarCents })));
}

export async function adminPlanRoutes(app: FastifyInstance) {
  app.get('/plans/manage', async (request, reply) => {
    const context = await requirePlanEditor(request, reply); if (!context) return reply;
    const draws = await context.db.query(
      `SELECT d.id,d.name,COALESCE(m.items,'[]'::jsonb) AS modalities
         FROM app.draws d
         LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('digits',dm.digits,'maxSuertes',dm.max_suertes,'enabled',dm.enabled) ORDER BY dm.digits) items
           FROM app.draw_modalities dm WHERE dm.draw_id=d.id AND dm.tenant_id=d.tenant_id) m ON true
        WHERE d.tenant_id=$1 ORDER BY d.sort_order,d.name`, [context.tenant.id],
    );
    const plans = await context.db.query(
      `SELECT p.id,p.draw_id AS "drawId",d.name AS "drawName",p.digits,p.name,p.is_active AS "isActive",
              v.version,COALESCE(pr.items,'[]'::jsonb) AS prizes
         FROM app.plans p JOIN app.draws d ON d.id=p.draw_id AND d.tenant_id=p.tenant_id
         LEFT JOIN app.plan_versions v ON v.plan_id=p.id AND v.tenant_id=p.tenant_id AND v.is_current
         LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('suerteNo',pp.suerte_no,'name',pp.suerte_name,
             'payoutPerDollarCents',pp.payout_per_dollar_cents::text) ORDER BY pp.suerte_no) items
           FROM app.plan_prizes pp WHERE pp.plan_version_id=v.id AND pp.tenant_id=p.tenant_id) pr ON true
        WHERE p.tenant_id=$1 ORDER BY d.sort_order,d.name,p.digits,p.name`, [context.tenant.id],
    );
    return { draws: draws.rows, items: plans.rows };
  });

  app.post('/plans/manage', async (request, reply) => {
    const body = newPlanSchema.safeParse(request.body);
    if (!body.success || !validPrizeOrder(body.data.prizes)) return reply.code(400).send({ code: 'INVALID_PLAN', message: 'Configura las suertes en orden continuo, sin duplicados, e importes válidos.' });
    const context = await requirePlanEditor(request, reply); if (!context) return reply;
    const modality = await context.db.query<{ max_suertes: number; enabled: boolean }>(
      'SELECT max_suertes,enabled FROM app.draw_modalities WHERE draw_id=$1 AND tenant_id=$2 AND digits=$3 FOR SHARE',
      [body.data.drawId, context.tenant.id, body.data.digits],
    );
    if (!modality.rows[0] || !modality.rows[0].enabled) return reply.code(409).send({ code: 'MODALITY_UNAVAILABLE', message: 'Activa primero esta modalidad en la configuración del sorteo.' });
    if (body.data.prizes.length !== modality.rows[0].max_suertes) return reply.code(400).send({ code: 'INVALID_PLAN', message: `Esta modalidad requiere configurar ${modality.rows[0].max_suertes} suertes.` });
    const plan = await context.db.query<{ id: string }>(
      'INSERT INTO app.plans (tenant_id,draw_id,digits,name) VALUES ($1,$2,$3,$4) RETURNING id',
      [context.tenant.id, body.data.drawId, body.data.digits, body.data.name],
    );
    const version = await context.db.query<{ version_id: string }>(
      'SELECT app.fn_new_plan_version($1,$2::jsonb,$3) AS version_id', [plan.rows[0].id, prizePayload(body.data.prizes), context.actor.id],
    );
    return reply.code(201).send({ planId: plan.rows[0].id, versionId: version.rows[0].version_id, version: 1 });
  });

  app.post('/plans/manage/:planId/versions', async (request, reply) => {
    const params = z.object({ planId: z.string().uuid() }).safeParse(request.params);
    const body = newVersionSchema.safeParse(request.body);
    if (!params.success || !body.success || !validPrizeOrder(body.data.prizes)) return reply.code(400).send({ code: 'INVALID_PLAN', message: 'Revisa el plan y configura suertes en orden continuo, sin duplicados.' });
    const context = await requirePlanEditor(request, reply); if (!context) return reply;
    const plan = await context.db.query<{ draw_id: string; digits: number }>(
      'SELECT draw_id,digits FROM app.plans WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [params.data.planId, context.tenant.id],
    );
    if (!plan.rows[0]) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'No encontramos ese plan en este tenant.' });
    const modality = await context.db.query<{ max_suertes: number }>(
      'SELECT max_suertes FROM app.draw_modalities WHERE draw_id=$1 AND tenant_id=$2 AND digits=$3', [plan.rows[0].draw_id, context.tenant.id, plan.rows[0].digits],
    );
    if (!modality.rows[0] || body.data.prizes.length !== modality.rows[0].max_suertes) return reply.code(400).send({ code: 'INVALID_PLAN', message: `Configura las ${modality.rows[0]?.max_suertes ?? 'suertes requeridas'} de esta modalidad.` });
    const version = await context.db.query<{ version_id: string }>(
      'SELECT app.fn_new_plan_version($1,$2::jsonb,$3) AS version_id', [params.data.planId, prizePayload(body.data.prizes), context.actor.id],
    );
    return { planId: params.data.planId, versionId: version.rows[0].version_id };
  });

  app.patch('/plans/manage/:planId/status', async (request, reply) => {
    const params = z.object({ planId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ isActive: z.boolean() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Selecciona un estado válido para el plan.' });
    const context = await requirePlanEditor(request, reply); if (!context) return reply;
    await context.db.query("SELECT set_config('app.audit_reason',$1,true)", ['Cambio de estado de plan']);
    const result = await context.db.query(
      'UPDATE app.plans SET is_active=$3,updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id,is_active AS "isActive"',
      [params.data.planId, context.tenant.id, body.data.isActive],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'No encontramos ese plan en este tenant.' });
    return result.rows[0];
  });
}
