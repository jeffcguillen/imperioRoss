import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduledPlayRoutes } from './scheduled-plays.js';
import type { Actor, TenantContext } from '../types.js';

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'demo', name: 'Demo', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const client: Actor = { id: 'c0000000-0000-0000-0000-000000000004', tenantId: tenant.id, role: 'client', fullName: 'Cliente', phone: '0990000004', email: null, locationId: null };
const worker: Actor = { ...client, role: 'worker' };
const apps: FastifyInstance[] = [];

async function createApp(actor: Actor, query = vi.fn()) {
  const app = Fastify(); apps.push(app);
  app.decorateRequest('actor', null); app.decorateRequest('tenant', null); app.decorateRequest('database', null);
  app.addHook('onRequest', async (request) => {
    request.actor = actor; request.tenant = tenant;
    request.database = { client: { query } as unknown as PoolClient, finished: false, cleanupPaths: [] };
  });
  await app.register(scheduledPlayRoutes, { prefix: '/api' }); await app.ready();
  return { app, query };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('scheduled plays access and validation', () => {
  it('blocks staff roles before reading or mutating schedules', async () => {
    const { app, query } = await createApp(worker);
    const response = await app.inject({ method: 'GET', url: '/api/scheduled-plays' });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a number whose length differs from the selected modality', async () => {
    const { app, query } = await createApp(client);
    const response = await app.inject({ method: 'POST', url: '/api/scheduled-plays', payload: {
      drawId: 'd0000000-0000-4000-8000-000000000001', digits: 3, number: '07', amountCents: '100', daysOfWeek: [1, 2],
    } });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects duplicate weekdays before database access', async () => {
    const { app, query } = await createApp(client);
    const response = await app.inject({ method: 'POST', url: '/api/scheduled-plays', payload: {
      drawId: 'd0000000-0000-4000-8000-000000000001', digits: 2, number: '07', amountCents: '100', daysOfWeek: [1, 1],
    } });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not allow changing a schedule outside active or paused states', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const { app } = await createApp(client, query);
    const response = await app.inject({ method: 'PATCH', url: '/api/scheduled-plays/00000000-0000-4000-8000-000000000001', payload: { status: 'active' } });
    expect(response.statusCode).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('user_id = $3');
  });
});
