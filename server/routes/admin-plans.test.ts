import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Actor, TenantContext } from '../types.js';
import { adminPlanRoutes } from './admin-plans.js';

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
  await app.register(adminPlanRoutes, { prefix: '/api/admin' }); await app.ready();
  return { app, query };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('prize plan administration', () => {
  it('rejects non-admin reads before querying the database', async () => {
    const { app, query } = await createApp(worker);
    const response = await app.inject({ method: 'GET', url: '/api/admin/plans/manage' });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires plan.edit for plan creation', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: false }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/plans/manage', payload: { drawId: 'b0000000-0000-4000-8000-000000000099', digits: 2, name: 'Plan nuevo', prizes: [{ suerteNo: 1, name: 'Primera', payoutPerDollarCents: '5000' }] } });
    expect(response.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('requires the complete configured number of ordered prizes before inserting the plan', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ max_suertes: 7, enabled: true }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/plans/manage', payload: { drawId: 'b0000000-0000-4000-8000-000000000099', digits: 2, name: 'Plan nuevo', prizes: [{ suerteNo: 1, name: 'Primera', payoutPerDollarCents: '5000' }] } });
    expect(response.statusCode).toBe(400);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('persists a tenant plan then delegates its first immutable version to fn_new_plan_version', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ max_suertes: 1, enabled: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'c0000000-0000-4000-8000-000000000099' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ version_id: 'd0000000-0000-4000-8000-000000000099' }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/plans/manage', payload: { drawId: 'b0000000-0000-4000-8000-000000000099', digits: 2, name: 'Plan nuevo', prizes: [{ suerteNo: 1, name: 'Primera', payoutPerDollarCents: '5000' }] } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ planId: 'c0000000-0000-4000-8000-000000000099', version: 1 });
    expect(query.mock.calls[2][0]).toContain('INSERT INTO app.plans');
    expect(query.mock.calls[2][1]).toEqual([tenant.id, 'b0000000-0000-4000-8000-000000000099', 2, 'Plan nuevo']);
    expect(query.mock.calls[3][0]).toContain('app.fn_new_plan_version');
    expect(query.mock.calls[3][1][1]).toBe('[{"suerte_no":1,"name":"Primera","payout_per_dollar_cents":"5000"}]');
  });

  it('returns a conflict for a plan version that does not match the configured prize count', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ draw_id: 'e0000000-0000-4000-8000-000000000099', digits: 2 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ max_suertes: 2 }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/plans/manage/c0000000-0000-4000-8000-000000000099/versions', payload: { prizes: [{ suerteNo: 1, name: 'Primera', payoutPerDollarCents: '5000' }] } });
    expect(response.statusCode).toBe(400);
    expect(query).toHaveBeenCalledTimes(3);
  });
});
