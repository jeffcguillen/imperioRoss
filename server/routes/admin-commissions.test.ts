import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminCommissionRoutes } from './admin-commissions.js';
import type { Actor, TenantContext } from '../types.js';

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'demo', name: 'Demo', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const admin: Actor = { id: 'c0000000-0000-4000-8000-000000000001', tenantId: tenant.id, role: 'admin', fullName: 'Admin', phone: '0990000001', email: null, locationId: null };
const clientActor: Actor = { ...admin, id: 'c0000000-0000-4000-8000-000000000004', role: 'client' };
const apps: FastifyInstance[] = [];

async function createApp(actor: Actor, query = vi.fn()) {
  const app = Fastify(); apps.push(app);
  app.decorateRequest('actor', null); app.decorateRequest('tenant', null); app.decorateRequest('database', null);
  app.addHook('onRequest', async (request) => {
    request.actor = actor; request.tenant = tenant;
    request.database = { client: { query } as unknown as PoolClient, finished: false, cleanupPaths: [] };
  });
  await app.register(adminCommissionRoutes, { prefix: '/api/admin' }); await app.ready();
  return { app, query };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('commission plan administration', () => {
  it('blocks non-admin accounts before database access', async () => {
    const { app, query } = await createApp(clientActor);
    const response = await app.inject({ method: 'GET', url: '/api/admin/commission-plans' });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires both commission and finance permissions', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ action: 'commission.manage', allowed: true }, { action: 'finance.manage', allowed: false }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/commission-plans' });
    expect(response.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('validates the calculation fields before any plan writes', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ action: 'commission.manage', allowed: true }, { action: 'finance.manage', allowed: true }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/commission-plans', payload: { base: 'fixed_amount' } });
    expect(response.statusCode).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects overlapping commission periods before inserting a duplicate scope', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ action: 'commission.manage', allowed: true }, { action: 'finance.manage', allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ valid: true }] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/commission-plans', payload: {
      base: 'sales_percent', percentBp: 600, sellerId: null, drawId: null, digits: null, effectiveFrom: '2026-10-20', effectiveTo: null,
    } });
    expect(response.statusCode).toBe(409);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('updates and publishes an active plan with a required audit reason', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ action: 'commission.manage', allowed: true }, { action: 'finance.manage', allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ valid: true }] })
      .mockResolvedValueOnce({ rows: [{ exists: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'b0000000-0000-4000-8000-000000000001' }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: '/api/admin/commission-plans/b0000000-0000-4000-8000-000000000001', payload: {
      base: 'sales_percent', percentBp: 750, sellerId: null, drawId: null, digits: null, effectiveFrom: '2026-10-20', effectiveTo: null, reason: 'Ajuste aprobado por administración',
    } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ updated: true, isActive: true });
    expect(query.mock.calls[3]?.[0]).toContain('app.audit_reason');
    expect(query.mock.calls[4]?.[0]).toContain('UPDATE app.commission_plans');
  });

  it('requires a reason before updating a commission plan', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ action: 'commission.manage', allowed: true }, { action: 'finance.manage', allowed: true }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: '/api/admin/commission-plans/b0000000-0000-4000-8000-000000000001', payload: {
      base: 'sales_percent', percentBp: 750, effectiveFrom: '2026-10-20', reason: 'ok',
    } });
    expect(response.statusCode).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('prevents reactivating a rule that overlaps another active rule', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ action: 'commission.manage', allowed: true }, { action: 'finance.manage', allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: '/api/admin/commission-plans/b0000000-0000-4000-8000-000000000001/active', payload: { isActive: true, reason: 'Reactivar regla aprobada' } });
    expect(response.statusCode).toBe(409);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
