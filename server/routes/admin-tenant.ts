import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const logoNames = ['logo-horizontal.png', 'logo-monogram.png', 'logo-full.png', 'logo-full-slogan.png'] as const;
const settingsSchema = z.object({
  domain: z.string().trim().max(253).refine((value) => value === '' || /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)(?:\.(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?))*$/i.test(value), 'Ingresa un dominio DNS válido sin protocolo ni ruta.'),
  name: z.string().trim().min(2).max(120),
  tagline: z.string().trim().max(180),
  timezone: z.string().trim().min(1).max(80),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  locale: z.string().trim().regex(/^[a-z]{2}-[A-Z]{2}$/),
  gold: z.string().regex(/^#[\da-f]{6}$/i),
  emerald: z.string().regex(/^#[\da-f]{6}$/i),
  logos: z.object({
    horizontal: z.enum(logoNames), monogram: z.enum(logoNames), full: z.enum(logoNames), full_slogan: z.enum(logoNames),
  }),
  rafflesEnabled: z.boolean(),
  expectedRevision: z.string().regex(/^\d{10,20}$/),
  reason: z.string().trim().min(5).max(500),
});

async function requireTenantAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.actor || !request.database?.client || !request.tenant) {
    await reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
    return null;
  }
  if (request.actor.role !== 'admin') {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Solo Administración puede modificar la configuración de la marca.' });
    return null;
  }
  const permission = await request.database.client.query<{ allowed: boolean }>('SELECT app.fn_can($1, $2) AS allowed', [request.actor.id, 'tenant.manage']);
  if (!permission.rows[0]?.allowed) {
    await reply.code(403).send({ code: 'SIN_PERMISO', message: 'Tu cuenta no tiene permiso para editar la configuración de la plataforma.' });
    return null;
  }
  return { db: request.database.client, actor: request.actor, tenant: request.tenant };
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function logoFile(value: unknown, fallback: typeof logoNames[number]) {
  return typeof value === 'string' && (logoNames as readonly string[]).includes(value) ? value as typeof logoNames[number] : fallback;
}

function shape(row: { id: string; slug: string; domain: string | null; name: string; tagline: string | null; timezone: string; currency: string; locale: string; branding: unknown; modules: unknown; revision: string }) {
  const branding = jsonObject(row.branding);
  const palette = jsonObject(branding.palette);
  const logos = jsonObject(branding.logos);
  return {
    id: row.id, slug: row.slug, domain: row.domain, name: row.name, tagline: row.tagline,
    timezone: row.timezone, currency: row.currency, locale: row.locale, revision: row.revision,
    gold: typeof palette.gold === 'string' ? palette.gold : '#cdb273',
    emerald: typeof palette.emerald === 'string' ? palette.emerald : '#13351f',
    logos: {
      horizontal: logoFile(logos.horizontal, 'logo-horizontal.png'),
      monogram: logoFile(logos.monogram, 'logo-monogram.png'),
      full: logoFile(logos.full, 'logo-full.png'),
      full_slogan: logoFile(logos.full_slogan, 'logo-full-slogan.png'),
    },
    rafflesEnabled: jsonObject(row.modules).rifasEspeciales !== false,
  };
}

export async function adminTenantRoutes(app: FastifyInstance) {
  app.get('/tenant', async (request, reply) => {
    const context = await requireTenantAdmin(request, reply);
    if (!context) return reply;
    const result = await context.db.query(
      `SELECT id, slug::text AS slug, domain, name, tagline, timezone, currency, locale, branding, modules,
              floor(extract(epoch FROM updated_at) * 1000000)::bigint::text AS revision
         FROM app.tenants WHERE id = $1`,
      [context.tenant.id],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'TENANT_NOT_FOUND', message: 'No encontramos la configuración de esta plataforma.' });
    return { tenant: shape(result.rows[0]) };
  });

  app.patch('/tenant', async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_DATA', message: 'Revisa los datos de la marca y el motivo del cambio.' });
    try { new Intl.DateTimeFormat('en', { timeZone: parsed.data.timezone }); }
    catch { return reply.code(400).send({ code: 'INVALID_TIMEZONE', message: 'Selecciona una zona horaria válida.' }); }
    const context = await requireTenantAdmin(request, reply);
    if (!context) return reply;
    const currentResult = await context.db.query(
      `SELECT id, slug::text AS slug, domain, name, tagline, timezone, currency, locale, branding, modules,
              floor(extract(epoch FROM updated_at) * 1000000)::bigint::text AS revision
         FROM app.tenants WHERE id = $1 FOR UPDATE`,
      [context.tenant.id],
    );
    const current = currentResult.rows[0];
    if (!current) return reply.code(404).send({ code: 'TENANT_NOT_FOUND', message: 'No encontramos la configuración de esta plataforma.' });
    if (current.revision !== parsed.data.expectedRevision) return reply.code(409).send({ code: 'TENANT_SETTINGS_CHANGED', message: 'La configuración cambió en otra sesión. Actualiza y vuelve a revisar los datos.' });
    const oldSettings = shape(current);
    if (parsed.data.domain) {
      const domainConflict = await context.db.query(
        'SELECT 1 FROM app.tenants WHERE id <> $1 AND lower(domain) = lower($2) LIMIT 1',
        [context.tenant.id, parsed.data.domain],
      );
      if (domainConflict.rowCount) return reply.code(409).send({ code: 'TENANT_DOMAIN_IN_USE', message: 'Ese dominio ya está asociado a otra plataforma.' });
    }
    const updated = await context.db.query(
      `UPDATE app.tenants
          SET name = $2, domain = NULLIF($10, ''), tagline = NULLIF($3, ''), timezone = $4, currency = $5, locale = $6,
              branding = jsonb_set(jsonb_set(COALESCE(branding, '{}'::jsonb), '{palette}', COALESCE(branding->'palette', '{}'::jsonb) || $7::jsonb, true), '{logos}', COALESCE(branding->'logos', '{}'::jsonb) || $8::jsonb, true),
              modules = COALESCE(modules, '{}'::jsonb) || jsonb_build_object('rifasEspeciales', $9::boolean), updated_at = now()
        WHERE id = $1
        RETURNING id, slug::text AS slug, domain, name, tagline, timezone, currency, locale, branding, modules,
                  floor(extract(epoch FROM updated_at) * 1000000)::bigint::text AS revision`,
      [context.tenant.id, parsed.data.name, parsed.data.tagline, parsed.data.timezone, parsed.data.currency, parsed.data.locale,
        JSON.stringify({ gold: parsed.data.gold, emerald: parsed.data.emerald }), JSON.stringify(parsed.data.logos), parsed.data.rafflesEnabled, parsed.data.domain.toLowerCase()],
    );
    const tenant = shape(updated.rows[0]);
    await context.db.query(
      `SELECT app.fn_audit($1, $2, 'tenant.settings_updated', 'tenant', $3, $4::jsonb, $5::jsonb, $6)`,
      [context.tenant.id, context.actor.id, tenant.slug, JSON.stringify(oldSettings), JSON.stringify(tenant), parsed.data.reason],
    );
    return { tenant };
  });
}
