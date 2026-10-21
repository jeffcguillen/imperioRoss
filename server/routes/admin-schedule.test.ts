import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Actor, TenantContext } from '../types.js';
import { adminScheduleRoutes } from './admin-schedule.js';

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
  await app.register(adminScheduleRoutes, { prefix: '/api/admin' }); await app.ready();
  return { app, query };
}

const drawPayload = {
  code: 'noche', name: 'Sorteo Noche', referenceLottery: 'Lotería Nacional', referenceAbbr: 'LTT',
  drawTime: '20:00', closeOffsetMinutes: 15, daysOfWeek: [1, 3, 5], isActive: true,
  modalities: [{ digits: 2, enabled: true, minCents: '25', stepCents: '25', quotaPerNumberCents: null, maxSuertes: 7 }],
  dayReferences: [{ dow: 1, referenceLottery: 'Lotería Nacional', referenceAbbr: 'LTT' }],
};

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('draw configuration administration', () => {
  it('rejects workers before reading or writing draw configuration', async () => {
    const { app, query } = await createApp(worker);
    const response = await app.inject({ method: 'POST', url: '/api/admin/schedule/draws', payload: drawPayload });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects duplicate modalities before querying the database', async () => {
    const { app, query } = await createApp(admin);
    const response = await app.inject({ method: 'POST', url: '/api/admin/schedule/draws', payload: { ...drawPayload, modalities: [drawPayload.modalities[0], drawPayload.modalities[0]] } });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires draw.create before changing configuration', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: false }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/schedule/draws', payload: drawPayload });
    expect(response.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('creates tenant-scoped draw, modality, and weekday reference rows in one request transaction', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'b0000000-0000-4000-8000-000000000099' }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/schedule/draws', payload: drawPayload });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ drawId: 'b0000000-0000-4000-8000-000000000099' });
    expect(query.mock.calls[2][0]).toContain('INSERT INTO app.draws');
    expect(query.mock.calls[2][1]).toContain(tenant.id);
    expect(query.mock.calls[4][0]).toContain('INSERT INTO app.draw_modalities');
    expect(query.mock.calls[4][1]).toEqual([tenant.id, 'b0000000-0000-4000-8000-000000000099', 2, true, '25', '25', null, 7]);
    expect(query.mock.calls[6][0]).toContain('INSERT INTO app.draw_day_references');
  });

  it('locks modality and quota changes when play rows already reference the draw', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'b0000000-0000-4000-8000-000000000099', name: 'Noche', code: 'noche', is_active: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ digits: 2, enabled: true, minCents: '25', stepCents: '25', quotaPerNumberCents: null, maxSuertes: 7 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ exists: true }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'PATCH', url: '/api/admin/schedule/draws/b0000000-0000-4000-8000-000000000099', payload: { ...drawPayload, modalities: [{ ...drawPayload.modalities[0], minCents: '50' }] } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'DRAW_MODALITY_LOCKED' });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[3][0]).toContain('app.order_items');
  });
});
