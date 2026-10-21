import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminAuditRoutes } from './admin-audit.js';
import type { Actor, TenantContext } from '../types.js';

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'demo', name: 'Demo', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const admin: Actor = { id: 'c0000000-0000-0000-0000-000000000001', tenantId: tenant.id, role: 'admin', fullName: 'Admin', phone: '0990000001', email: null, locationId: null };
const client: Actor = { ...admin, id: 'c0000000-0000-0000-0000-000000000004', role: 'client' };
const apps: FastifyInstance[] = [];

async function createApp(actor: Actor, query = vi.fn()) {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('actor', null);
  app.decorateRequest('tenant', null);
  app.decorateRequest('database', null);
  app.addHook('onRequest', async (request) => {
    request.actor = actor;
    request.tenant = tenant;
    request.database = { client: { query } as unknown as PoolClient, finished: false, cleanupPaths: [] };
  });
  await app.register(adminAuditRoutes, { prefix: '/api/admin' });
  await app.ready();
  return { app, query };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('admin audit access and search', () => {
  it('blocks non-admin roles before querying audit data', async () => {
    const { app, query } = await createApp(client);
    const response = await app.inject({ method: 'GET', url: '/api/admin/audit' });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires report.view for administrators', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: false }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/audit' });
    expect(response.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns tenant-scoped audit records with bounded pagination', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ id: '4', actorName: 'Admin', action: 'result.modified', totalCount: '1' }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/audit?q=result&limit=20&offset=0' });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(query.mock.calls[1]?.[0]).toContain('a.tenant_id = $1');
    expect(query.mock.calls[1]?.[1]).toEqual([tenant.id, 'result', 20, 0]);
  });

  it('rejects out-of-range pagination input', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: true }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/audit?limit=500' });
    expect(response.statusCode).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
