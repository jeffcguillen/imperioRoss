import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { readFile, rm } from 'node:fs/promises';
import { env, webOrigins } from './env.js';
import { adminPool, staffPool } from './db/pools.js';
import { authRoutes } from './routes/auth.js';
import { adminOrderRoutes } from './routes/admin-orders.js';
import { adminResultRoutes } from './routes/admin-results.js';
import { publicTicketRoutes } from './routes/public-tickets.js';
import { guestRecoveryRoutes } from './routes/guest-recovery.js';
import { repeatPlayRoutes } from './routes/repeat-plays.js';
import { rechargeRoutes } from './routes/recharges.js';
import { adminRechargeRoutes } from './routes/admin-recharges.js';
import { adminWithdrawalRoutes, prizeRoutes } from './routes/prizes.js';
import { adminDashboardRoutes } from './routes/admin-dashboard.js';
import { adminUserRoutes } from './routes/admin-users.js';
import { adminScheduleRoutes } from './routes/admin-schedule.js';
import { adminPlanRoutes } from './routes/admin-plans.js';
import { adminAuditRoutes } from './routes/admin-audit.js';
import { posRoutes } from './routes/pos.js';
import { rafflePurchaseRoutes } from './routes/raffles.js';
import { scheduledPlayRoutes } from './routes/scheduled-plays.js';
import { favoriteRoutes } from './routes/favorites.js';
import { adminTenantRoutes } from './routes/admin-tenant.js';
import { adminDemoRoutes } from './routes/admin-demo.js';
import { adminSearchRoutes } from './routes/admin-search.js';
import { contractRoutes } from './routes/contracts.js';
import { adminCommissionRoutes } from './routes/admin-commissions.js';
import { adminFinanceRoutes } from './routes/admin-finance.js';
import { adminRaffleRoutes } from './routes/admin-raffles.js';
import { orderRoutes } from './routes/orders.js';
import { startScheduledPlayScheduler } from './scheduled-play-scheduler.js';
import { publicError } from './security/errors.js';
import { hashSessionToken } from './security/session.js';
import type { Actor, TenantContext } from './types.js';

const app = Fastify({
  logger: { level: env.NODE_ENV === 'production' ? 'info' : 'warn', redact: ['req.headers.cookie', 'req.headers.authorization'] },
  trustProxy: false,
  requestIdHeader: 'x-request-id',
  bodyLimit: 1_000_000,
  rewriteUrl(request) {
    return (request.url ?? '').replace(/^\/api\/v1(?=\/|\?|$)/, '/api');
  },
});

app.decorateRequest('tenant', null);
app.decorateRequest('actor', null);
app.decorateRequest('sessionId', null);
app.decorateRequest('database', null);

await app.register(helmet, { crossOriginResourcePolicy: { policy: 'cross-origin' } });
await app.register(cors, { origin: webOrigins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] });
await app.register(cookie);
await app.register(multipart, { limits: { fileSize: env.MAX_PROOF_FILE_BYTES, files: 1, fields: 1 } });
await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });

function publicRequestHost(hostHeader: string | undefined) {
  return hostHeader?.split(',')[0]?.trim().split(':')[0]?.toLowerCase() ?? '';
}

async function resolveTenant(host: string): Promise<TenantContext | null> {
  const result = await staffPool.query<TenantContext>(
    `SELECT id, slug::text AS slug, name, tagline, timezone, currency, locale, branding, modules
       FROM app.tenants
      WHERE is_active AND ((domain IS NOT NULL AND lower(domain) = lower($1)) OR slug = $2)
      ORDER BY CASE WHEN domain IS NOT NULL AND lower(domain) = lower($1) THEN 0 ELSE 1 END
      LIMIT 1`,
    [host, env.DEFAULT_TENANT_SLUG],
  );
  return result.rows[0] ?? null;
}

async function rollbackRequest(request: import('fastify').FastifyRequest) {
  const database = request.database;
  if (!database || database.finished) return;
  database.finished = true;
  try { await database.client.query('ROLLBACK'); } catch { /* conexión inestable */ }
  database.client.release();
  await Promise.all(database.cleanupPaths.map((path) => rm(path, { force: true }).catch(() => undefined)));
  database.cleanupPaths = [];
}

async function commitRequest(request: import('fastify').FastifyRequest) {
  const database = request.database;
  if (!database || database.finished) return;
  try {
    await database.client.query('COMMIT');
    database.finished = true;
  } catch (error) {
    await rollbackRequest(request);
    throw error;
  }
  database.client.release();
  database.cleanupPaths = [];
}

app.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/api/') || request.method === 'OPTIONS') return;
  const origin = request.headers.origin;
  if (['POST', 'PATCH', 'DELETE'].includes(request.method) && origin && !webOrigins.includes(origin)) {
    await reply.code(403).send({ code: 'ORIGIN_NOT_ALLOWED', message: 'No se permite esta solicitud.' });
    return;
  }
  try {
    const tenant = await resolveTenant(publicRequestHost(request.headers.host));
    if (!tenant) {
      await reply.code(404).send({ code: 'TENANT_NOT_FOUND', message: 'No encontramos esta plataforma.' });
      return;
    }
    const requestPool = request.url.split('?')[0].startsWith('/api/admin/') ? adminPool : staffPool;
    const client = await requestPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', '', true)", [tenant.id]);
      request.tenant = tenant;
      request.database = { client, finished: false, cleanupPaths: [] };

      const token = request.cookies.ross_session;
      if (token) {
        const tokenHash = hashSessionToken(token);
        const session = await client.query<{ id: string; user_id: string }>(
          `SELECT s.id, s.user_id
             FROM app.auth_sessions s
             JOIN app.users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
            WHERE s.tenant_id = $1 AND s.refresh_token_hash = $2 AND s.revoked_at IS NULL
              AND s.expires_at > now() AND u.is_active AND (u.locked_until IS NULL OR u.locked_until <= now())
            LIMIT 1`, [tenant.id, tokenHash],
        );
        const sessionRow = session.rows[0];
        if (sessionRow) {
          await client.query("SELECT set_config('app.user_id', $1, true)", [sessionRow.user_id]);
          const foundActor = await client.query<{ id: string; tenant_id: string; role: Actor['role']; full_name: string; phone: string; email: string | null; location_id: string | null }>(
            `SELECT id, tenant_id, role, full_name, phone, email, location_id FROM app.users WHERE id = $1 AND tenant_id = $2 AND is_active`,
            [sessionRow.user_id, tenant.id],
          );
          const row = foundActor.rows[0];
          if (row) {
            request.sessionId = sessionRow.id;
            request.actor = { id: row.id, tenantId: row.tenant_id, role: row.role, fullName: row.full_name, phone: row.phone, email: row.email, locationId: row.location_id };
          }
        }
      }
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* transacción no iniciada */ }
      request.database = null;
      client.release();
      throw error;
    }
  } catch (error) {
    request.log.error({ event: 'request_context_failed', requestId: request.id, errorCode: (error as { code?: string }).code ?? 'CONTEXT_ERROR' });
    await reply.code(503).send({ code: 'SERVICE_UNAVAILABLE', message: 'No pudimos iniciar la solicitud. Intenta nuevamente.', requestId: request.id });
  }
});

app.addHook('onSend', async (request, reply, payload) => {
  if (!request.database) return payload;
  if (reply.statusCode >= 500) await rollbackRequest(request);
  else await commitRequest(request);
  return payload;
});

app.addHook('onError', async (request) => { await rollbackRequest(request); });
app.addHook('onResponse', async (request) => { await rollbackRequest(request); });

app.setErrorHandler((error, request, reply) => {
  const mapped = publicError(error);
  if (mapped.status === 500) {
    const pgError = error as { code?: string };
    request.log.error({ event: 'request_failed', requestId: request.id, errorCode: pgError.code ?? 'UNEXPECTED', errorType: error instanceof Error ? error.name : typeof error,
      ...(env.NODE_ENV === 'development' && error instanceof Error ? { diagnostic: error.message.slice(0, 160) } : {}) });
    return reply.code(500).send({ code: 'INTERNAL_ERROR', message: mapped.message, requestId: request.id });
  }
  return reply.code(mapped.status).send({ code: mapped.code, message: mapped.message });
});

app.setNotFoundHandler((_request, reply) => reply.code(404).send({ code: 'NOT_FOUND', message: 'No encontramos esta dirección.' }));

let stopScheduledPlayScheduler: () => void = () => {};
app.addHook('onClose', async () => { stopScheduledPlayScheduler(); });

app.get('/health/live', async () => ({ status: 'ok' }));
app.get('/health/ready', async (_request, reply) => {
  try {
    await Promise.all([staffPool.query('SELECT 1'), adminPool.query('SELECT 1')]);
    return { status: 'ready' };
  } catch {
    return reply.code(503).send({ status: 'not_ready' });
  }
});

app.get('/api/tenant/config', async (request, reply) => {
  if (!request.tenant) return reply.code(404).send({ code: 'TENANT_NOT_FOUND', message: 'No encontramos esta plataforma.' });
  const { id: _id, ...publicTenant } = request.tenant;
  return { tenant: publicTenant };
});

app.get('/api/openapi.json', async (_request, reply) => {
  if (env.NODE_ENV !== 'development') return reply.code(404).send({ code: 'NOT_FOUND', message: 'No encontramos esta dirección.' });
  const document = JSON.parse(await readFile(new URL('../docs/openapi.json', import.meta.url), 'utf8'));
  return reply.type('application/json').send(document);
});

await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(orderRoutes, { prefix: '/api' });
await app.register(adminOrderRoutes, { prefix: '/api/admin' });
await app.register(adminResultRoutes, { prefix: '/api/admin' });
await app.register(publicTicketRoutes, { prefix: '/api' });
await app.register(guestRecoveryRoutes, { prefix: '/api' });
await app.register(repeatPlayRoutes, { prefix: '/api' });
await app.register(rechargeRoutes, { prefix: '/api' });
await app.register(adminRechargeRoutes, { prefix: '/api/admin' });
await app.register(prizeRoutes, { prefix: '/api' });
await app.register(adminWithdrawalRoutes, { prefix: '/api/admin' });
await app.register(adminDashboardRoutes, { prefix: '/api/admin' });
await app.register(adminUserRoutes, { prefix: '/api/admin' });
await app.register(adminScheduleRoutes, { prefix: '/api/admin' });
await app.register(adminPlanRoutes, { prefix: '/api/admin' });
await app.register(adminAuditRoutes, { prefix: '/api/admin' });
await app.register(posRoutes, { prefix: '/api' });
await app.register(rafflePurchaseRoutes, { prefix: '/api' });
await app.register(scheduledPlayRoutes, { prefix: '/api' });
await app.register(favoriteRoutes, { prefix: '/api' });
await app.register(contractRoutes, { prefix: '/api' });
await app.register(adminCommissionRoutes, { prefix: '/api/admin' });
await app.register(adminFinanceRoutes, { prefix: '/api/admin' });
await app.register(adminRaffleRoutes, { prefix: '/api/admin' });
await app.register(adminTenantRoutes, { prefix: '/api/admin' });
await app.register(adminDemoRoutes, { prefix: '/api/admin' });
await app.register(adminSearchRoutes, { prefix: '/api/admin' });

app.get('/api/sessions/open', async (request) => {
  const db = request.database?.client;
  if (!db || !request.tenant) throw new Error('REQUEST_CONTEXT_MISSING');
  const result = await db.query(
    `SELECT s.id, s.draw_id AS "drawId", d.name AS "drawName", s.draw_date::text AS "drawDate", s.draws_at AS "drawsAt", s.closes_at AS "closesAt",
            json_agg(json_build_object('digits', m.digits, 'minCents', m.min_cents::text, 'stepCents', m.step_cents::text,
                       'quotaPerNumberCents', m.quota_per_number_cents::text) ORDER BY m.digits) AS modalities,
            COALESCE(p.items, '[]'::jsonb) AS plans
       FROM app.draw_sessions s
       JOIN app.draws d ON d.id = s.draw_id AND d.tenant_id = s.tenant_id AND d.is_active
       JOIN app.draw_modalities m ON m.draw_id = s.draw_id AND m.tenant_id = s.tenant_id AND m.enabled
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('id', pl.id, 'digits', pl.digits, 'name', pl.name) ORDER BY pl.digits, pl.name) AS items
           FROM app.plans pl JOIN app.plan_versions pv ON pv.plan_id = pl.id AND pv.is_current
          WHERE pl.draw_id = s.draw_id AND pl.tenant_id = s.tenant_id AND pl.is_active
       ) p ON true
      WHERE s.tenant_id = $1 AND s.status IN ('scheduled','open') AND s.closes_at > now()
      GROUP BY s.id, d.name, p.items ORDER BY s.draws_at LIMIT 30`, [request.tenant.id],
  );
  return { items: result.rows };
});

app.get('/api/results', async (request) => {
  const db = request.database?.client;
  if (!db || !request.tenant) throw new Error('REQUEST_CONTEXT_MISSING');
  const result = await db.query(
    `SELECT r.id, d.name AS "drawName", s.draw_date::text AS "drawDate", r.digits,
            r.published_at AS "publishedAt",
            COALESCE(json_agg(json_build_object('position', rp.suerte_no, 'number', rp.winning_number) ORDER BY rp.suerte_no)
              FILTER (WHERE rp.result_id IS NOT NULL), '[]'::json) AS positions
       FROM app.results r
       JOIN app.draw_sessions s ON s.id = r.session_id AND s.tenant_id = r.tenant_id
       JOIN app.draws d ON d.id = s.draw_id AND d.tenant_id = r.tenant_id
       LEFT JOIN app.result_positions rp ON rp.result_id = r.id AND rp.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1 AND r.is_current
      GROUP BY r.id, d.name, s.draw_date ORDER BY s.draw_date DESC, d.name, r.digits LIMIT 100`, [request.tenant.id],
  );
  return { items: result.rows };
});

app.get('/api/raffles', async (request, reply) => {
  const db = request.database?.client;
  if (!db || !request.tenant) throw new Error('REQUEST_CONTEXT_MISSING');
  if (request.tenant.modules.rifasEspeciales === false) return reply.code(404).send({ code: 'MODULE_DISABLED', message: 'Este módulo no está disponible.' });
  const result = await db.query(
    `SELECT r.id, r.name, r.description, r.prize_description AS "prizeDescription", r.prize_value_cents::text AS "prizeValueCents",
            r.number_digits AS "numberDigits", r.price_cents::text AS "priceCents", r.opens_at AS "opensAt", r.closes_at AS "closesAt",
            r.close_mode AS "closeMode", r.status, r.sold_count::text AS "soldCount", p.total_numbers::text AS "totalNumbers", p.percent,
            COALESCE(pk.items, '[]'::jsonb) AS packages
       FROM app.special_raffles r LEFT JOIN app.v_raffle_progress p ON p.id = r.id AND p.tenant_id = r.tenant_id
       LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id', rp.id, 'label', rp.label, 'priceCents', rp.price_cents::text, 'chances', rp.chances) ORDER BY rp.price_cents, rp.chances) AS items
                           FROM app.raffle_packages rp WHERE rp.raffle_id = r.id AND rp.tenant_id = r.tenant_id AND rp.is_active) pk ON true
      WHERE r.tenant_id = $1 AND r.status IN ('open','sold_out') ORDER BY r.opens_at DESC LIMIT 100`, [request.tenant.id],
  );
  return { items: result.rows };
});

app.get('/api/wallet', async (request, reply) => {
  if (!request.actor) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para consultar tu billetera.' });
  const db = request.database?.client;
  if (!db) throw new Error('REQUEST_CONTEXT_MISSING');
  const wallet = await db.query<{ id: string; available_cents: string; reserved_cents: string }>(
    'SELECT id, available_cents::text, reserved_cents::text FROM app.wallets WHERE user_id = $1 LIMIT 1', [request.actor.id],
  );
  if (!wallet.rows[0]) return { wallet: null, movements: [] };
  const movements = await db.query(
    `SELECT id, created_at AS "createdAt", type, amount_cents::text AS "amountCents", balance_before_cents::text AS "balanceBeforeCents",
            balance_after_cents::text AS "balanceAfterCents", reason
       FROM app.v_wallet_statement WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [request.actor.id],
  );
  return { wallet: wallet.rows[0], movements: movements.rows };
});

app.get('/api/tickets', async (request, reply) => {
  if (!request.actor) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para consultar tus tickets.' });
  const db = request.database?.client;
  if (!db) throw new Error('REQUEST_CONTEXT_MISSING');
  const result = await db.query(
    `SELECT t.id, t.code, t.status, t.digits, t.total_cents::text AS "totalCents", t.created_at AS "createdAt",
            d.name AS "drawName", s.draw_date::text AS "drawDate"
       FROM app.tickets t JOIN app.orders o ON o.id = t.order_id AND o.tenant_id = t.tenant_id
       JOIN app.draw_sessions s ON s.id = t.session_id AND s.tenant_id = t.tenant_id
       JOIN app.draws d ON d.id = s.draw_id AND d.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1 AND o.user_id = $2 ORDER BY t.created_at DESC LIMIT 100`, [request.actor.tenantId, request.actor.id],
  );
  return { items: result.rows };
});

app.get('/api/notifications', async (request, reply) => {
  if (!request.actor) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para consultar tus notificaciones.' });
  const db = request.database?.client;
  if (!db) throw new Error('REQUEST_CONTEXT_MISSING');
  const result = await db.query(
    `SELECT id, type, title, body, created_at AS "createdAt", read_at AS "readAt"
       FROM app.notifications WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 100`,
    [request.actor.tenantId, request.actor.id],
  );
  const unread = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM app.notifications WHERE tenant_id = $1 AND user_id = $2 AND read_at IS NULL',
    [request.actor.tenantId, request.actor.id],
  );
  return { items: result.rows, unreadCount: Number(unread.rows[0]?.count ?? 0) };
});

app.post('/api/notifications/:notificationId/read', async (request, reply) => {
  if (!request.actor) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
  const { notificationId } = request.params as { notificationId: string };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationId)) {
    return reply.code(400).send({ code: 'INVALID_DATA', message: 'No encontramos esa notificación.' });
  }
  const db = request.database?.client;
  if (!db) throw new Error('REQUEST_CONTEXT_MISSING');
  const updated = await db.query(
    `UPDATE app.notifications SET read_at = COALESCE(read_at, now())
      WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING id`,
    [notificationId, request.actor.tenantId, request.actor.id],
  );
  return { read: Boolean(updated.rowCount) };
});

app.post('/api/notifications/read-all', async (request, reply) => {
  if (!request.actor) return reply.code(401).send({ code: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' });
  const db = request.database?.client;
  if (!db) throw new Error('REQUEST_CONTEXT_MISSING');
  const updated = await db.query(
    'UPDATE app.notifications SET read_at = now() WHERE tenant_id = $1 AND user_id = $2 AND read_at IS NULL',
    [request.actor.tenantId, request.actor.id],
  );
  return { markedRead: updated.rowCount ?? 0 };
});

async function checkRuntimeRoles() {
  const staff = await staffPool.query<{ current_user: string; is_super: boolean; bypass_rls: boolean; is_staff: boolean; is_admin: boolean; can_read_claim: boolean }>(
    `SELECT current_user, r.rolsuper AS is_super, r.rolbypassrls AS bypass_rls,
            pg_has_role(current_user, 'rf_api_staff', 'member') AS is_staff,
            pg_has_role(current_user, 'rf_api_admin', 'member') AS is_admin,
            has_table_privilege(current_user, 'app.ticket_claim_codes', 'SELECT') AS can_read_claim
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const admin = await adminPool.query<{ current_user: string; is_super: boolean; bypass_rls: boolean; is_staff: boolean; is_admin: boolean }>(
    `SELECT current_user, r.rolsuper AS is_super, r.rolbypassrls AS bypass_rls,
            pg_has_role(current_user, 'rf_api_staff', 'member') AS is_staff,
            pg_has_role(current_user, 'rf_api_admin', 'member') AS is_admin
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const s = staff.rows[0]; const a = admin.rows[0];
  if (!s || s.is_super || s.bypass_rls || !s.is_staff || s.is_admin || s.can_read_claim) throw new Error('INVALID_STAFF_DATABASE_ROLE');
  if (!a || a.is_super || a.bypass_rls || !a.is_admin || a.is_staff) throw new Error('INVALID_ADMIN_DATABASE_ROLE');
}

try {
  await checkRuntimeRoles();
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  if (env.SCHEDULED_PLAYS_ENABLED) {
    stopScheduledPlayScheduler = startScheduledPlayScheduler(adminPool, {
      tenantIds: env.SCHEDULED_PLAYS_TENANT_IDS,
      intervalMs: env.SCHEDULED_PLAYS_INTERVAL_MS,
      lookaheadSeconds: env.SCHEDULED_PLAYS_LOOKAHEAD_SECONDS,
      batchSize: env.SCHEDULED_PLAYS_BATCH_SIZE,
      logger: { info: (data) => app.log.info(data), error: (data) => app.log.error(data) },
    });
    app.log.info({ event: 'scheduled_play_scheduler_started', tenantCount: env.SCHEDULED_PLAYS_TENANT_IDS.length, intervalMs: env.SCHEDULED_PLAYS_INTERVAL_MS });
  } else {
    app.log.info({ event: 'scheduled_play_scheduler_disabled' });
  }
  app.log.info({ event: 'api_started', host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.error({ event: 'api_start_failed', errorCode: (error as { code?: string }).code ?? 'CONFIG_OR_DATABASE_ERROR' });
  await app.close();
  await staffPool.end();
  await adminPool.end();
  process.exitCode = 1;
}
