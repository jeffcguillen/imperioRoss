import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const generateBody = z.object({ days: z.number().int().min(1).max(30) });
const drawConfigBody = z.object({
  code: z.string().trim().min(2).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(2).max(120),
  referenceLottery: z.string().trim().min(2).max(120),
  referenceAbbr: z.string().trim().min(1).max(20),
  drawTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  closeOffsetMinutes: z.number().int().min(0).max(360),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  isActive: z.boolean(),
  modalities: z.array(z.object({
    digits: z.union([z.literal(2), z.literal(3), z.literal(4)]), enabled: z.boolean(),
    minCents: z.string().regex(/^\d{1,15}$/), stepCents: z.string().regex(/^\d{1,15}$/),
    quotaPerNumberCents: z.string().regex(/^\d{1,15}$/).nullable(), maxSuertes: z.number().int().min(1).max(100),
  })).min(1).max(3),
  dayReferences: z.array(z.object({ dow: z.number().int().min(1).max(7), referenceLottery: z.string().trim().max(120).nullable(), referenceAbbr: z.string().trim().max(20).nullable() })).max(7),
}).superRefine((body, ctx) => {
  if (new Set(body.daysOfWeek).size !== body.daysOfWeek.length) ctx.addIssue({ code: 'custom', path: ['daysOfWeek'], message: 'No repitas días de operación.' });
  const digits = body.modalities.map((item) => item.digits);
  if (new Set(digits).size !== digits.length) ctx.addIssue({ code: 'custom', path: ['modalities'], message: 'No repitas una modalidad.' });
  if (!body.modalities.some((item) => item.enabled)) ctx.addIssue({ code: 'custom', path: ['modalities'], message: 'El sorteo debe conservar al menos una modalidad activa.' });
  if (new Set(body.dayReferences.map((item) => item.dow)).size !== body.dayReferences.length) ctx.addIssue({ code: 'custom', path: ['dayReferences'], message: 'No repitas referencias para el mismo día.' });
  body.modalities.forEach((modality, index) => {
    if (BigInt(modality.minCents) < 25n || BigInt(modality.stepCents) < 25n || (modality.quotaPerNumberCents !== null && BigInt(modality.quotaPerNumberCents) < 25n)) {
      ctx.addIssue({ code: 'custom', path: ['modalities', index], message: 'Mínimo, incremento y cupo deben ser de al menos 25 centavos.' });
    }
  });
});

async function requireScheduleEditor(request: FastifyRequest, reply: FastifyReply) {
  const db = request.database?.client;
  if (!request.actor || !db || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  if (request.actor.role !== 'admin') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Solo Administración puede gestionar la agenda de sorteos.' });
    return null;
  }
  const permission = await db.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [request.actor.id, 'draw.create']);
  if (!permission.rows[0]?.allowed) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para crear sesiones de sorteo.' });
    return null;
  }
  return { db, actor: request.actor, tenant: request.tenant };
}

export async function adminScheduleRoutes(app: FastifyInstance) {
  app.get('/schedule', async (request, reply) => {
    const context = await requireScheduleEditor(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT s.id, s.draw_date::text AS "drawDate", s.status, s.closes_at AS "closesAt", s.draws_at AS "drawsAt",
              s.reference_lottery AS "referenceLottery", s.reference_abbr AS "referenceAbbr", d.id AS "drawId", d.name AS "drawName",
              COALESCE(jsonb_agg(jsonb_build_object('digits', m.digits, 'enabled', m.enabled, 'minCents', m.min_cents::text,
                'maxSuertes', m.max_suertes) ORDER BY m.digits) FILTER (WHERE m.id IS NOT NULL), '[]'::jsonb) AS modalities
         FROM app.draw_sessions s
         JOIN app.draws d ON d.id = s.draw_id AND d.tenant_id = s.tenant_id
         LEFT JOIN app.draw_modalities m ON m.draw_id = d.id AND m.tenant_id = d.tenant_id
        WHERE s.tenant_id = $1 AND s.draw_date >= (now() AT TIME ZONE $2)::date - 1
        GROUP BY s.id, d.id
        ORDER BY s.draws_at LIMIT 200`,
      [context.tenant.id, context.tenant.timezone],
    );
    const configurations = await context.db.query(
      `SELECT d.id, d.name, d.code, d.draw_time::text AS "drawTime", d.close_offset_minutes AS "closeOffsetMinutes",
              d.days_of_week AS "daysOfWeek", d.reference_lottery AS "referenceLottery", d.reference_abbr AS "referenceAbbr", d.is_active AS "isActive",
              COALESCE(mods.items, '[]'::jsonb) AS modalities, COALESCE(refs.items, '[]'::jsonb) AS "dayReferences"
         FROM app.draws d
         LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('digits', m.digits, 'enabled', m.enabled,
           'minCents', m.min_cents::text, 'stepCents', m.step_cents::text,
           'quotaPerNumberCents', m.quota_per_number_cents::text, 'maxSuertes', m.max_suertes) ORDER BY m.digits) AS items
           FROM app.draw_modalities m WHERE m.draw_id = d.id AND m.tenant_id = d.tenant_id) mods ON true
         LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('dow', r.dow, 'referenceLottery', r.reference_lottery, 'referenceAbbr', r.reference_abbr) ORDER BY r.dow) AS items
           FROM app.draw_day_references r WHERE r.draw_id = d.id AND r.tenant_id = d.tenant_id) refs ON true
        WHERE d.tenant_id = $1 ORDER BY d.sort_order, d.name`, [context.tenant.id],
    );
    return { items: result.rows, draws: configurations.rows, timezone: context.tenant.timezone };
  });

  app.post('/schedule/draws', async (request, reply) => {
    const body = drawConfigBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa el código, horarios, días, modalidades y valores del sorteo.' });
    const context = await requireScheduleEditor(request, reply);
    if (!context) return reply;
    const data = body.data;
    await context.db.query("SELECT set_config('app.audit_reason',$1,true)", ['Configuración inicial de sorteo']);
    const created = await context.db.query<{ id: string }>(
      `INSERT INTO app.draws (tenant_id, code, name, reference_lottery, reference_abbr, draw_time, close_offset_minutes, days_of_week, is_active)
       VALUES ($1,$2,$3,$4,$5,$6::time,$7,$8::smallint[],$9) RETURNING id`,
      [context.tenant.id, data.code, data.name, data.referenceLottery, data.referenceAbbr, data.drawTime, data.closeOffsetMinutes, data.daysOfWeek, data.isActive],
    );
    const drawId = created.rows[0].id;
    await saveDrawConfiguration(context.db, context.tenant.id, drawId, data);
    return reply.code(201).send({ drawId });
  });

  app.patch('/schedule/draws/:drawId', async (request, reply) => {
    const params = z.object({ drawId: z.string().uuid() }).safeParse(request.params);
    const body = drawConfigBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa el sorteo y la configuración enviada.' });
    const context = await requireScheduleEditor(request, reply);
    if (!context) return reply;
    const data = body.data;
    const old = await context.db.query<{ id: string; name: string; code: string; is_active: boolean }>(
      'SELECT id,name,code,is_active FROM app.draws WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [params.data.drawId, context.tenant.id],
    );
    if (!old.rows[0]) return reply.code(404).send({ code: 'DRAW_NOT_FOUND', message: 'No encontramos ese sorteo en este tenant.' });
    const currentModalities = await context.db.query<DrawModalityRow>(
      'SELECT digits,enabled,min_cents::text AS "minCents",step_cents::text AS "stepCents",quota_per_number_cents::text AS "quotaPerNumberCents",max_suertes AS "maxSuertes" FROM app.draw_modalities WHERE draw_id=$1 AND tenant_id=$2 ORDER BY digits FOR UPDATE',
      [params.data.drawId, context.tenant.id],
    );
    if (modalitiesChanged(currentModalities.rows, data.modalities)) {
      const hasOrders = await context.db.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM app.draw_sessions s JOIN app.order_items oi ON oi.session_id=s.id AND oi.tenant_id=s.tenant_id
          WHERE s.draw_id=$1 AND s.tenant_id=$2) AS exists`, [params.data.drawId, context.tenant.id],
      );
      if (hasOrders.rows[0]?.exists) return reply.code(409).send({ code: 'DRAW_MODALITY_LOCKED', message: 'No se pueden cambiar modalidades ni cupos porque ya existen jugadas ligadas a este sorteo.' });
    }
    await context.db.query("SELECT set_config('app.audit_reason',$1,true)", ['Edición de configuración de sorteo']);
    await context.db.query(
      `UPDATE app.draws SET code=$3,name=$4,reference_lottery=$5,reference_abbr=$6,draw_time=$7::time,
       close_offset_minutes=$8,days_of_week=$9::smallint[],is_active=$10,updated_at=now() WHERE id=$1 AND tenant_id=$2`,
      [params.data.drawId, context.tenant.id, data.code, data.name, data.referenceLottery, data.referenceAbbr, data.drawTime, data.closeOffsetMinutes, data.daysOfWeek, data.isActive],
    );
    await saveDrawConfiguration(context.db, context.tenant.id, params.data.drawId, data);
    return { drawId: params.data.drawId, updated: true };
  });

  app.post('/schedule/generate', async (request, reply) => {
    const body = generateBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Selecciona un horizonte entre 1 y 30 días.' });
    const context = await requireScheduleEditor(request, reply);
    if (!context) return reply;
    const result = await context.db.query<{ created: number; draws: number }>(
      `WITH candidates AS (
         SELECT d.id AS draw_id, d.tenant_id, day::date AS draw_date,
                ((day::date + d.draw_time) AT TIME ZONE $2) AS draws_at,
                (((day::date + d.draw_time) AT TIME ZONE $2) - make_interval(mins => d.close_offset_minutes)) AS closes_at,
                COALESCE(ref.reference_lottery, d.reference_lottery) AS reference_lottery,
                COALESCE(ref.reference_abbr, d.reference_abbr) AS reference_abbr
           FROM app.draws d
           CROSS JOIN generate_series((now() AT TIME ZONE $2)::date, (now() AT TIME ZONE $2)::date + $3::int, interval '1 day') day
           LEFT JOIN app.draw_day_references ref ON ref.draw_id = d.id AND ref.tenant_id = d.tenant_id
             AND ref.dow = extract(isodow FROM day)::smallint
          WHERE d.tenant_id = $1 AND d.is_active
            AND extract(isodow FROM day)::smallint = ANY(d.days_of_week)
            AND EXISTS (SELECT 1 FROM app.draw_modalities m WHERE m.draw_id = d.id AND m.tenant_id = d.tenant_id AND m.enabled)
       ), inserted AS (
         INSERT INTO app.draw_sessions (tenant_id, draw_id, draw_date, closes_at, draws_at, status, reference_lottery, reference_abbr)
         SELECT tenant_id, draw_id, draw_date, closes_at, draws_at, 'scheduled', reference_lottery, reference_abbr
           FROM candidates WHERE closes_at > now()
         ON CONFLICT (draw_id, draw_date) DO NOTHING
         RETURNING draw_id
       )
       SELECT count(*)::int AS created, count(DISTINCT draw_id)::int AS draws FROM inserted`,
      [context.tenant.id, context.tenant.timezone, body.data.days],
    );
    return { created: result.rows[0]?.created ?? 0, draws: result.rows[0]?.draws ?? 0, days: body.data.days };
  });
}

async function saveDrawConfiguration(db: import('pg').PoolClient, tenantId: string, drawId: string, data: z.infer<typeof drawConfigBody>) {
  const enabledDigits = data.modalities.filter((item) => item.enabled).map((item) => item.digits);
  await db.query('UPDATE app.draw_modalities SET enabled=false,updated_at=now() WHERE draw_id=$1 AND tenant_id=$2 AND digits <> ALL($3::smallint[])', [drawId, tenantId, enabledDigits.length ? enabledDigits : [0]]);
  for (const modality of data.modalities) {
    await db.query(
      `INSERT INTO app.draw_modalities (tenant_id,draw_id,digits,enabled,min_cents,step_cents,quota_per_number_cents,max_suertes)
       VALUES ($1,$2,$3,$4,$5::bigint,$6::bigint,$7::bigint,$8)
       ON CONFLICT (draw_id,digits) DO UPDATE SET enabled=EXCLUDED.enabled,min_cents=EXCLUDED.min_cents,
         step_cents=EXCLUDED.step_cents,quota_per_number_cents=EXCLUDED.quota_per_number_cents,max_suertes=EXCLUDED.max_suertes,updated_at=now()`,
      [tenantId, drawId, modality.digits, modality.enabled, modality.minCents, modality.stepCents, modality.quotaPerNumberCents, modality.maxSuertes],
    );
  }
  const dows = data.dayReferences.map((item) => item.dow);
  await db.query('DELETE FROM app.draw_day_references WHERE draw_id=$1 AND tenant_id=$2 AND dow <> ALL($3::smallint[])', [drawId, tenantId, dows.length ? dows : [0]]);
  for (const reference of data.dayReferences) {
    await db.query(
      `INSERT INTO app.draw_day_references (draw_id,tenant_id,dow,reference_lottery,reference_abbr) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (draw_id,dow) DO UPDATE SET reference_lottery=EXCLUDED.reference_lottery,reference_abbr=EXCLUDED.reference_abbr`,
      [drawId, tenantId, reference.dow, reference.referenceLottery, reference.referenceAbbr],
    );
  }
}

type DrawModalityRow = { digits: number; enabled: boolean; minCents: string; stepCents: string; quotaPerNumberCents: string | null; maxSuertes: number };
function modalitiesChanged(current: DrawModalityRow[], next: z.infer<typeof drawConfigBody>['modalities']) {
  if (current.length !== next.length) return true;
  const existing = new Map(current.map((item) => [item.digits, item]));
  return next.some((item) => {
    const old = existing.get(item.digits);
    return !old || old.enabled !== item.enabled || old.minCents !== item.minCents || old.stepCents !== item.stepCents
      || old.quotaPerNumberCents !== item.quotaPerNumberCents || old.maxSuertes !== item.maxSuertes;
  });
}
