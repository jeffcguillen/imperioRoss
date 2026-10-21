import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminTenantRoutes } from './admin-tenant.js';
import type { Actor, TenantContext } from '../types.js';

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'ross', name: 'Ross', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const admin: Actor = { id: 'b0000000-0000-4000-8000-000000000001', tenantId: tenant.id, role: 'admin', fullName: 'Admin', phone: '+593990000001', email: null, locationId: null };
const worker: Actor = { ...admin, role: 'worker' };
const revision = '1792500000000000';
const currentRow = { id: tenant.id, slug: tenant.slug, domain: null, name: 'Ross', tagline: 'Suerte', timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: { palette: { gold: '#cdb273', emerald: '#13351f' }, logos: {} }, modules: { rifasEspeciales: true, futureFlag: true }, revision };
const apps: FastifyInstance[] = [];

async function createApp(actor: Actor, query = vi.fn()) {
  const app = Fastify(); apps.push(app);
  app.decorateRequest('actor', null); app.decorateRequest('tenant', null); app.decorateRequest('database', null);
  app.addHook('onRequest', async (request) => {
    request.actor = actor; request.tenant = tenant;
    request.database = { client: { query } as unknown as PoolClient, finished: false, cleanupPaths: [] };
  });
  await app.register(adminTenantRoutes, { prefix: '/api/admin' }); await app.ready();
  return { app, query };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const payload = { domain: '', name: 'Imperio Ross', tagline: 'Tu fortuna', timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', gold: '#cdb273', emerald: '#13351f', logos: { horizontal: 'logo-horizontal.png', monogram: 'logo-monogram.png', full: 'logo-full.png', full_slogan: 'logo-full-slogan.png' }, rafflesEnabled: false, expectedRevision: revision, reason: 'Ajuste aprobado de marca' };

describe('tenant configuration', () => {
  it('blocks non-admin users before reading or changing tenant settings', async () => {
    const { app, query } = await createApp(worker);
    const response = await app.inject({ method: 'GET', url: '/api/admin/tenant' });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires the tenant.manage permission even for the admin role', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ allowed: false }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/tenant' });
    expect(response.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reads settings only for the tenant resolved on the request', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [currentRow] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/tenant' });
    expect(response.statusCode).toBe(200);
    expect(response.json().tenant).toMatchObject({ id: tenant.id, slug: 'ross', rafflesEnabled: true, gold: '#cdb273' });
    expect(query.mock.calls[1][1]).toEqual([tenant.id]);
  });

  it('rejects a stale edit before updating or auditing', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [currentRow] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: '/api/admin/tenant', payload: { ...payload, expectedRevision: '1792499999999999' } });
    expect(response.statusCode).toBe(409);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('preserves unknown module flags and audits a tenant-scoped update with reason', async () => {
    const updatedRow = { ...currentRow, name: payload.name, tagline: payload.tagline, modules: { rifasEspeciales: false, futureFlag: true }, revision: '1792500000000001' };
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [currentRow] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [updatedRow] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: '/api/admin/tenant', payload });
    expect(response.statusCode).toBe(200);
    expect(query.mock.calls[2][0]).toContain("modules = COALESCE(modules, '{}'::jsonb) || jsonb_build_object('rifasEspeciales', $9::boolean)");
    expect(query.mock.calls[2][1][0]).toBe(tenant.id);
    expect(query.mock.calls[2][1][8]).toBe(false);
    expect(query.mock.calls[3][0]).toContain('app.fn_audit');
    expect(query.mock.calls[3][1][1]).toBe(admin.id);
    expect(query.mock.calls[3][1][5]).toBe(payload.reason);
    expect(response.json().tenant).toMatchObject({ name: payload.name, rafflesEnabled: false });
  });

  it('rejects invalid domains before reading the tenant row', async () => {
    const query = vi.fn(); const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: '/api/admin/tenant', payload: { ...payload, domain: 'https://ross.example/path' } });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('checks domain uniqueness before updating tenant routing', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [currentRow] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: '/api/admin/tenant', payload: { ...payload, domain: 'play.ross.example' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('TENANT_DOMAIN_IN_USE');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('saves a normalized unique custom domain and includes it in the audit change', async () => {
    const updatedRow = { ...currentRow, domain: 'play.ross.example', revision: '1792500000000002' };
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [currentRow] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [updatedRow] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: '/api/admin/tenant', payload: { ...payload, domain: 'PLAY.ROSS.EXAMPLE' } });
    expect(response.statusCode).toBe(200);
    expect(query.mock.calls[3][1][9]).toBe('play.ross.example');
    expect(query.mock.calls[4][0]).toContain('app.fn_audit');
    expect(response.json().tenant.domain).toBe('play.ross.example');
  });
});
