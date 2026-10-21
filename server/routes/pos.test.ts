import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { posRoutes } from './pos.js';
import type { Actor, TenantContext } from '../types.js';

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'demo', name: 'Demo', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const seller: Actor = { id: 'c0000000-0000-0000-0000-000000000002', tenantId: tenant.id, role: 'seller', fullName: 'Vendedor', phone: '0990000002', email: null, locationId: 'b0000000-0000-0000-0000-000000000001' };
const client: Actor = { ...seller, id: 'c0000000-0000-0000-0000-000000000004', role: 'client' };
const worker: Actor = { ...seller, id: 'c0000000-0000-4000-8000-000000000003', role: 'worker' };
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
  await app.register(posRoutes, { prefix: '/api' });
  await app.ready();
  return { app, query };
}

const validSale = {
  buyer: { fullName: 'Cliente de prueba', phone: '0991234567', adultConfirmed: true }, termsConfirmed: true,
  items: [{ drawId: 'd0000000-0000-4000-8000-000000000001', sessionId: 'e0000000-0000-4000-8000-000000000001', digits: 2, number: '07', amountCents: '100' }],
  idempotencyKey: 'f0000000-0000-4000-8000-000000000001',
};

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('point of sale access and input checks', () => {
  it('blocks customer accounts before querying point-of-sale data', async () => {
    const { app, query } = await createApp(client);
    const response = await app.inject({ method: 'POST', url: '/api/pos/orders', payload: validSale });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('enforces the per-user sale.register permission', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: false }] });
    const { app } = await createApp(seller, query);
    const response = await app.inject({ method: 'POST', url: '/api/pos/orders', payload: validSale });
    expect(response.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('requires the buyer to confirm legal age and sale terms', async () => {
    const { app, query } = await createApp(seller);
    const response = await app.inject({ method: 'POST', url: '/api/pos/orders', payload: { ...validSale, termsConfirmed: false } });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires each number length to match its modality', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: true }] });
    const { app } = await createApp(seller, query);
    const response = await app.inject({ method: 'POST', url: '/api/pos/orders', payload: { ...validSale, items: [{ ...validSale.items[0], number: '007' }] } });
    expect(response.statusCode).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not allow sellers to use the worker self-void action', async () => {
    const { app, query } = await createApp(seller);
    const response = await app.inject({ method: 'POST', url: '/api/pos/tickets/b0000000-0000-4000-8000-000000000099/void', payload: { reason: 'Error de venta' } });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('checks ticket.void_own and scopes a void to the worker own sale', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'b0000000-0000-4000-8000-000000000099' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const { app } = await createApp(worker, query);
    const response = await app.inject({ method: 'POST', url: '/api/pos/tickets/b0000000-0000-4000-8000-000000000099/void', payload: { reason: 'Número ingresado por duplicado' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'voided', financialEffect: 'none' });
    expect(query.mock.calls[1][0]).toContain('o.worker_id=$3');
    expect(query.mock.calls[2][0]).toContain('app.fn_void_ticket');
    expect(query.mock.calls[2][1][3]).toBe('none');
  });

  it('rejects tickets not included in the worker own sales', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const { app } = await createApp(worker, query);
    const response = await app.inject({ method: 'POST', url: '/api/pos/tickets/b0000000-0000-4000-8000-000000000099/void', payload: { reason: 'Ticket que no corresponde' } });
    expect(response.statusCode).toBe(409);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
