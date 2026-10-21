import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminSearchRoutes } from './admin-search.js';
import type { Actor, TenantContext } from '../types.js';

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'ross', name: 'Ross', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const admin: Actor = { id: 'b0000000-0000-4000-8000-000000000001', tenantId: tenant.id, role: 'admin', fullName: 'Admin', phone: '+593990000001', email: null, locationId: null };
const worker: Actor = { ...admin, role: 'worker' };
const apps: FastifyInstance[] = [];

async function createApp(actor: Actor, query = vi.fn()) {
  const app = Fastify(); apps.push(app);
  app.decorateRequest('actor', null); app.decorateRequest('tenant', null); app.decorateRequest('database', null);
  app.addHook('onRequest', async (request) => {
    request.actor = actor; request.tenant = tenant;
    request.database = { client: { query } as unknown as PoolClient, finished: false, cleanupPaths: [] };
  });
  await app.register(adminSearchRoutes, { prefix: '/api/admin' }); await app.ready();
  return { app, query };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('administrative global search', () => {
  it('blocks ticket voiding for non-admin roles before database access', async () => {
    const { app, query } = await createApp(worker);
    const response = await app.inject({ method: 'POST', url: '/api/admin/tickets/b0000000-0000-4000-8000-000000000099/void', payload: { reason: 'Duplicado' } });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires ticket.void and a sufficiently detailed reason before invoking the SQL function', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/tickets/b0000000-0000-4000-8000-000000000099/void', payload: { reason: 'no' } });
    expect(response.statusCode).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('locks and tenant-scopes an active ticket then records the audited SQL void with no automatic refund', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'b0000000-0000-4000-8000-000000000099', status: 'active' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/tickets/b0000000-0000-4000-8000-000000000099/void', payload: { reason: 'Ticket emitido por duplicado' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'voided', financialEffect: 'none' });
    expect(query.mock.calls[1][0]).toContain('tenant_id = $2 FOR UPDATE');
    expect(query.mock.calls[1][1]).toEqual(['b0000000-0000-4000-8000-000000000099', tenant.id]);
    expect(query.mock.calls[2][0]).toContain('app.fn_void_ticket');
    expect(query.mock.calls[2][1]).toEqual(['b0000000-0000-4000-8000-000000000099', admin.id, 'Ticket emitido por duplicado', 'none']);
  });

  it('rejects non-admin roles before accessing the database', async () => {
    const { app, query } = await createApp(worker);
    const response = await app.inject({ method: 'GET', url: '/api/admin/search?q=ross' });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires report.view for admins before reading searchable records', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: false }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/search?q=Ross' });
    expect(response.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('requires report.view and performs tenant-scoped parameterized search', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ kind: 'ticket', id: 'ticket-id', code: 'ABCD2345', title: 'Ticket de Cliente', detail: '#000001 · +593990000001', status: 'active', createdAt: new Date(), href: '/verificar/ABCD2345' }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/search?q=%23ABC' });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({ kind: 'ticket', href: '/verificar/ABCD2345' });
    expect(query.mock.calls[1][0]).toContain('o.tenant_id = $1');
    expect(query.mock.calls[1][0]).toContain('t.tenant_id = $1');
    expect(query.mock.calls[1][0]).toContain('u.tenant_id = $1');
    expect(query.mock.calls[1][1]).toEqual([tenant.id, '%#ABC%', '#ABC']);
  });

  it('requires at least two search characters before querying records', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/search?q=x' });
    expect(response.statusCode).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('escapes wildcard characters so a search term cannot broaden into a full tenant scan', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/search?q=%25_%25' });
    expect(response.statusCode).toBe(200);
    expect(query.mock.calls[1][1]).toEqual([tenant.id, '%\\%\\_\\%%', '%_%']);
  });
});
