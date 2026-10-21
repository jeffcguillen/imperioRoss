import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { guestRecoveryRoutes } from './guest-recovery.js';
import type { TenantContext } from '../types.js';

vi.mock('../env.js', () => ({ env: { NODE_ENV: 'test', DATABASE_STAFF_URL: 'postgresql://test:test@localhost/test' } }));
const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'demo', name: 'Demo', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const apps: FastifyInstance[] = [];

async function createApp(query = vi.fn()) {
  const app = Fastify(); apps.push(app);
  app.decorateRequest('tenant', null); app.decorateRequest('database', null);
  app.addHook('onRequest', async (request) => { request.tenant = tenant; request.database = { client: { query } as unknown as PoolClient, finished: false, cleanupPaths: [] }; });
  await app.register(guestRecoveryRoutes, { prefix: '/api' }); await app.ready();
  return { app, query };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('guest purchase recovery', () => {
  it('uses a generic start response and stores only an HMAC of the local demo OTP', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ fn_find_guest_order: null }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const { app } = await createApp(query);
    const response = await app.inject({ method: 'POST', url: '/api/guest-purchases/recovery/start', payload: { code: '#000123', phone: '099 000 0000' } });
    expect(response.statusCode).toBe(202);
    expect(response.json().message).toMatch(/Si los datos corresponden/);
    expect(query.mock.calls[0][0]).toContain('app.fn_find_guest_order');
    const storedHash = query.mock.calls[3][1][2] as string;
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedHash).not.toBe('123456');
    expect(query.mock.calls[3][1]).toEqual([tenant.id, '+593990000000:#000123', storedHash]);
  });

  it('rejects malformed lookup data before querying the database', async () => {
    const query = vi.fn(); const { app } = await createApp(query);
    const response = await app.inject({ method: 'POST', url: '/api/guest-purchases/recovery/start', payload: { code: 'not-a-code', phone: '0990000000' } });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not reveal a purchase when a correct OTP is verified but the guest lookup has no match', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ valid: true }] })
      .mockResolvedValueOnce({ rows: [{ order_id: null }] });
    const { app } = await createApp(query);
    const response = await app.inject({ method: 'POST', url: '/api/guest-purchases/recovery/verify', payload: { code: '#000123', phone: '0990000000', otp: '123456' } });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('GUEST_PURCHASE_NOT_FOUND');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('app.fn_check_otp');
    expect(query.mock.calls[0][1][1]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns only purchase and ticket details after OTP and guest-order validation', async () => {
    const purchase = { id: 'order-id', purchaseCode: '#000123', status: 'approved', totalCents: '500', items: [] };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ valid: true }] })
      .mockResolvedValueOnce({ rows: [{ order_id: 'order-id' }] })
      .mockResolvedValueOnce({ rows: [purchase] });
    const { app } = await createApp(query);
    const response = await app.inject({ method: 'POST', url: '/api/guest-purchases/recovery/verify', payload: { code: '#000123', phone: '0990000000', otp: '123456' } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().purchase).toEqual(purchase);
    expect(query.mock.calls[2][0]).toContain('o.user_id IS NULL');
    expect(query.mock.calls[2][1]).toEqual(['order-id', tenant.id]);
  });

  it('does not look up an order when OTP validation fails', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ valid: false }] });
    const { app } = await createApp(query);
    const response = await app.inject({ method: 'POST', url: '/api/guest-purchases/recovery/verify', payload: { code: '#000123', phone: '0990000000', otp: '999999' } });
    expect(response.statusCode).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
