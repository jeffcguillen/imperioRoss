import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminUserRoutes } from './admin-users.js';
import type { Actor, TenantContext } from '../types.js';

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'demo', name: 'Demo', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const admin: Actor = { id: 'c0000000-0000-0000-0000-000000000001', tenantId: tenant.id, role: 'admin', fullName: 'Admin', phone: '0990000001', email: null, locationId: null };
const clientActor: Actor = { ...admin, id: 'c0000000-0000-0000-0000-000000000004', role: 'client' };
const adminId = 'c0000000-0000-0000-0000-000000000001';
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
  await app.register(adminUserRoutes, { prefix: '/api/admin' });
  await app.ready();
  return { app, query };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('admin user access controls', () => {
  it('rejects user and permission reads for client without touching the database', async () => {
    const { app, query } = await createApp(clientActor);
    const users = await app.inject({ method: 'GET', url: '/api/admin/users' });
    const permissions = await app.inject({ method: 'GET', url: '/api/admin/roles/permissions' });
    expect(users.statusCode).toBe(403);
    expect(permissions.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('protects admin accounts from self-deactivation before any update', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ role: 'admin', is_active: true, full_name: 'Admin' }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({
      method: 'PATCH', url: `/api/admin/users/${adminId}/status`,
      payload: { isActive: false, reason: 'prueba segura' },
    });
    expect(response.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain('SELECT role, is_active');
  });

  it('does not allow roles to receive admin-only actions', async () => {
    const { app, query } = await createApp(admin);
    const response = await app.inject({
      method: 'PATCH', url: '/api/admin/roles/permissions',
      payload: { role: 'worker', action: 'report.view', allowed: true, scope: 'all', reason: 'prueba segura' },
    });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not create an admin account through staff provisioning', async () => {
    const { app, query } = await createApp(admin);
    const response = await app.inject({
      method: 'POST', url: '/api/admin/users',
      payload: { fullName: 'Cuenta elevada', phone: '0991234567', role: 'admin', locationId: adminId, password: 'UnaClaveRobusta123', reason: 'prueba segura' },
    });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('changes a staff account between worker and seller with an audit reason', async () => {
    const staffId = 'c0000000-0000-0000-0000-000000000002';
    const locationId = 'd0000000-0000-4000-8000-000000000001';
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ role: 'worker', location_id: locationId, is_active: true, full_name: 'Persona Demo' }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: `/api/admin/users/${staffId}/role`, payload: { role: 'seller', reason: 'Asignación de ventas' } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ userId: staffId, role: 'seller' });
    expect(query.mock.calls[2]?.[0]).toContain('UPDATE app.users SET role');
    expect(query.mock.calls[2]?.[1]).toEqual([staffId, tenant.id, 'seller']);
    expect(query.mock.calls[4]?.[0]).toContain('app.fn_audit');
    expect(query.mock.calls[4]?.[1][7]).toBe('Asignación de ventas');
  });

  it('does not allow changing an admin or client into a staff role', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ role: 'admin', location_id: null, is_active: true, full_name: 'Admin' }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: `/api/admin/users/${adminId}/role`, payload: { role: 'seller', reason: 'prueba segura' } });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('ROLE_CHANGE_RESTRICTED');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('creates a location inside the resolved tenant and audits the reason', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'd0000000-0000-4000-8000-000000000001', name: 'Centro Quito', city: 'Quito', address: 'Centro' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/locations', payload: { name: 'Centro Quito', city: 'Quito', address: 'Centro', reason: 'Apertura autorizada' } });
    expect(response.statusCode, response.body).toBe(201);
    expect(query.mock.calls[1][0]).toContain('INSERT INTO app.locations (tenant_id, name, city, address)');
    expect(query.mock.calls[1][1]).toEqual([tenant.id, 'Centro Quito', 'Quito', 'Centro']);
    expect(query.mock.calls[2][0]).toContain('app.fn_audit');
    expect(query.mock.calls[2][1][4]).toBe('Apertura autorizada');
  });

  it('rolls back the create savepoint on a duplicate name conflict', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: '23505' });
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(duplicate).mockResolvedValue({ rows: [] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/locations', payload: { name: 'Centro Quito', reason: 'Apertura autorizada' } });
    expect(response.statusCode).toBe(409);
    expect(query.mock.calls[2][0]).toBe('ROLLBACK TO SAVEPOINT admin_location_create');
  });

  it('updates a location scoped by tenant and records its before and after values', async () => {
    const locationId = 'd0000000-0000-4000-8000-000000000001';
    const before = { id: locationId, name: 'Centro Quito', city: 'Quito', address: null };
    const after = { ...before, name: 'Quito Centro' };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({ rows: [after] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: `/api/admin/locations/${locationId}`, payload: { name: 'Quito Centro', reason: 'Cambio de nombre' } });
    expect(response.statusCode, response.body).toBe(200);
    expect(query.mock.calls[1][1]).toEqual([locationId, tenant.id]);
    expect(query.mock.calls[2][1]).toEqual([locationId, tenant.id, 'Quito Centro', '', '']);
    expect(query.mock.calls[3][1][3]).toBe(JSON.stringify(before));
    expect(query.mock.calls[3][1][4]).toBe(JSON.stringify(after));
  });

  it('prevents deactivating a location while active staff remain assigned', async () => {
    const locationId = 'd0000000-0000-4000-8000-000000000001';
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: locationId, name: 'Centro Quito', is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: `/api/admin/locations/${locationId}/status`, payload: { isActive: false, reason: 'Cierre temporal' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('LOCATION_HAS_ACTIVE_STAFF');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reactivates a location and audits the state transition', async () => {
    const locationId = 'd0000000-0000-4000-8000-000000000001';
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: locationId, name: 'Centro Quito', is_active: false }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: `/api/admin/locations/${locationId}/status`, payload: { isActive: true, reason: 'Reapertura autorizada' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ locationId, isActive: true });
    expect(query.mock.calls[1][0]).toContain('UPDATE app.locations SET is_active');
    expect(query.mock.calls[2][0]).toContain('location.status_updated');
    expect(query.mock.calls[2][1][5]).toBe('Reapertura autorizada');
  });
});
