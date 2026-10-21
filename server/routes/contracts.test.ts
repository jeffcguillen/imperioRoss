import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contractRoutes } from './contracts.js';
import type { Actor, TenantContext } from '../types.js';

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'demo', name: 'Demo', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const seller: Actor = { id: 'c0000000-0000-0000-0000-000000000002', tenantId: tenant.id, role: 'seller', fullName: 'Vendedor', phone: '0990000002', email: null, locationId: 'b0000000-0000-0000-0000-000000000001' };
const worker: Actor = { ...seller, role: 'worker' };
const admin: Actor = { ...seller, id: 'c0000000-0000-4000-8000-000000000001', role: 'admin', locationId: null };
const apps: FastifyInstance[] = [];

async function createApp(actor: Actor, query = vi.fn()) {
  const app = Fastify(); apps.push(app);
  app.decorateRequest('actor', null); app.decorateRequest('tenant', null); app.decorateRequest('database', null);
  app.addHook('onRequest', async (request) => {
    request.actor = actor; request.tenant = tenant;
    request.database = { client: { query } as unknown as PoolClient, finished: false, cleanupPaths: [] };
  });
  await app.register(contractRoutes, { prefix: '/api' }); await app.ready();
  return { app, query };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('contract role boundaries', () => {
  it('does not expose contract data to worker roles', async () => {
    const { app, query } = await createApp(worker);
    const response = await app.inject({ method: 'GET', url: '/api/contracts' });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires the seller-specific sale permission', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: false }] });
    const { app } = await createApp(seller, query);
    const response = await app.inject({ method: 'GET', url: '/api/contracts' });
    expect(response.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not let a seller create an administrative contract assignment', async () => {
    const { app, query } = await createApp(seller);
    const response = await app.inject({ method: 'POST', url: '/api/admin/contracts', payload: {} });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a number that does not match its modality before SQL', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: true }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/contracts', payload: {
      drawId: 'd0000000-0000-4000-8000-000000000001', digits: 3, number: '07', amountCents: '3000', daysOfWeek: [1], startDate: '2026-10-20', collection: 'cash',
    } });
    expect(response.statusCode).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
