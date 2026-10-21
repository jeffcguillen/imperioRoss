import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { repeatPlayRoutes } from './repeat-plays.js';
import type { Actor, TenantContext } from '../types.js';

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'demo', name: 'Demo', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const client: Actor = { id: 'c0000000-0000-0000-0000-000000000004', tenantId: tenant.id, role: 'client', fullName: 'Cliente Demo', phone: '0990000004', email: null, locationId: null };
const admin: Actor = { ...client, id: 'c0000000-0000-0000-0000-000000000001', role: 'admin' };
const ticketId = 'b0000000-0000-4000-8000-000000000001';
const apps: FastifyInstance[] = [];

async function createApp(actor: Actor | null, query = vi.fn()) {
  const app = Fastify(); apps.push(app);
  app.decorateRequest('actor', null);
  app.decorateRequest('tenant', null);
  app.decorateRequest('database', null);
  app.addHook('onRequest', async (request) => {
    request.actor = actor;
    request.tenant = tenant;
    request.database = { client: { query } as unknown as PoolClient, finished: false, cleanupPaths: [] };
  });
  await app.register(repeatPlayRoutes, { prefix: '/api' }); await app.ready();
  return { app, query };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('repeat a previous play', () => {
  it('requires an authenticated session', async () => {
    const { app, query } = await createApp(null);
    const response = await app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/repeat` });
    expect(response.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('allows only registered clients', async () => {
    const { app, query } = await createApp(admin);
    const response = await app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/repeat` });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns only active play details from a ticket owned by the client', async () => {
    const play = { drawId: 'd0000000-0000-4000-8000-000000000001', digits: 2, number: '07', amountCents: '100', planId: 'e0000000-0000-4000-8000-000000000001' };
    const query = vi.fn().mockResolvedValue({ rows: [play] });
    const { app } = await createApp(client, query);
    const response = await app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/repeat` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [play] });
    expect(query.mock.calls[0]?.[0]).toContain('o.user_id = $3');
    expect(query.mock.calls[0]?.[1]).toEqual([ticketId, tenant.id, client.id]);
  });

  it('does not reveal tickets with no repeatable lines', async () => {
    const { app } = await createApp(client, vi.fn().mockResolvedValue({ rows: [] }));
    const response = await app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/repeat` });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('NOT_FOUND');
  });
});
