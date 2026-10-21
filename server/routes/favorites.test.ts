import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { favoriteRoutes } from './favorites.js';
import type { Actor, TenantContext } from '../types.js';

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'demo', name: 'Demo', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const client: Actor = { id: 'c0000000-0000-4000-8000-000000000004', tenantId: tenant.id, role: 'client', fullName: 'Cliente', phone: '0990000004', email: null, locationId: null };
const worker: Actor = { ...client, role: 'worker' };
const apps: FastifyInstance[] = [];

async function createApp(actor: Actor | null, query = vi.fn()) {
  const app = Fastify(); apps.push(app);
  app.decorateRequest('actor', null); app.decorateRequest('tenant', null); app.decorateRequest('database', null);
  app.addHook('onRequest', async (request) => {
    request.actor = actor; request.tenant = tenant;
    request.database = { client: { query } as unknown as PoolClient, finished: false, cleanupPaths: [] };
  });
  await app.register(favoriteRoutes, { prefix: '/api' }); await app.ready();
  return { app, query };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('favorite numbers access and ownership', () => {
  it('requires a signed-in client before reading favorites', async () => {
    const { app, query } = await createApp(null);
    const response = await app.inject({ method: 'GET', url: '/api/favorites' });
    expect(response.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('blocks staff roles before database access', async () => {
    const { app, query } = await createApp(worker);
    const response = await app.inject({ method: 'GET', url: '/api/favorites' });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('preserves leading zeroes and scopes list to the authenticated tenant and user', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: '00000000-0000-4000-8000-000000000001' }] });
    const { app } = await createApp(client, query);
    const response = await app.inject({ method: 'POST', url: '/api/favorites', payload: { digits: 3, number: '007', label: 'Mi número' } });
    expect(response.statusCode).toBe(201);
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT (user_id, digits, number) DO NOTHING');
    expect(query.mock.calls[0][1]).toEqual([tenant.id, client.id, 3, '007', 'Mi número']);
  });

  it('rejects a number that does not match its modality without querying', async () => {
    const { app, query } = await createApp(client);
    const response = await app.inject({ method: 'POST', url: '/api/favorites', payload: { digits: 3, number: '07' } });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('deletes only a favorite owned by the authenticated tenant and user', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const { app } = await createApp(client, query);
    const response = await app.inject({ method: 'DELETE', url: '/api/favorites/00000000-0000-4000-8000-000000000001' });
    expect(response.statusCode).toBe(404);
    expect(query.mock.calls[0][0]).toContain('id = $1 AND tenant_id = $2 AND user_id = $3');
    expect(query.mock.calls[0][1]).toEqual(['00000000-0000-4000-8000-000000000001', tenant.id, client.id]);
  });
});
