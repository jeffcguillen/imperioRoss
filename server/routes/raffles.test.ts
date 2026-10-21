import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../env.js', () => ({ env: { STORAGE_PATH: 'C:/tmp/imperio-raffle-tests' } }));
import { rafflePurchaseRoutes } from './raffles.js';
import type { Actor, TenantContext } from '../types.js';

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'demo', name: 'Demo', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const client: Actor = { id: 'c0000000-0000-4000-8000-000000000004', tenantId: tenant.id, role: 'client', fullName: 'Cliente', phone: '0991234567', email: null, locationId: null };
const worker: Actor = { ...client, id: 'c0000000-0000-4000-8000-000000000005', role: 'worker' };
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
  await app.register(rafflePurchaseRoutes, { prefix: '/api' });
  await app.ready();
  return { app, query };
}

const raffleId = 'd0000000-0000-4000-8000-000000000001';
const body = { quantity: 1, adultConfirmed: true, termsConfirmed: true, idempotencyKey: 'f0000000-0000-4000-8000-000000000001' };
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('special raffle wallet checkout', () => {
  it('blocks staff roles from buying through a customer wallet', async () => {
    const { app, query } = await createApp(worker);
    const response = await app.inject({ method: 'POST', url: `/api/raffles/${raffleId}/purchases`, payload: body });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires server-recorded age confirmation before touching purchase functions', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ confirmed: false }] });
    const { app } = await createApp(client, query);
    const response = await app.inject({ method: 'POST', url: `/api/raffles/${raffleId}/purchases`, payload: body });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('AGE_CONFIRMATION_REQUIRED');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain('adult_confirmed_at');
  });

  it('requires both explicit confirmations in the request', async () => {
    const query = vi.fn();
    const { app } = await createApp(client, query);
    const response = await app.inject({ method: 'POST', url: `/api/raffles/${raffleId}/purchases`, payload: { ...body, termsConfirmed: false } });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires a destination bank account for transfer checkout', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ confirmed: true }], rowCount: 1 });
    const { app } = await createApp(client, query);
    const response = await app.inject({ method: 'POST', url: `/api/raffles/${raffleId}/purchases`, payload: { ...body, paymentMethod: 'bank_transfer' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('BANK_REQUIRED');
  });

  it('requires proof before accepting a transfer checkout', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ confirmed: true }], rowCount: 1 });
    const { app } = await createApp(client, query);
    const response = await app.inject({ method: 'POST', url: `/api/raffles/${raffleId}/purchases`, payload: { ...body, paymentMethod: 'bank_transfer', bankAccountId: 'b0000000-0000-4000-8000-000000000001' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('RECEIPT_REQUIRED');
  });
});
