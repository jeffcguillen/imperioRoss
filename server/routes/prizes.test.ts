import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Actor, TenantContext } from '../types.js';
import { prizeRoutes } from './prizes.js';

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'ross', name: 'Ross', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const admin: Actor = { id: 'b0000000-0000-4000-8000-000000000001', tenantId: tenant.id, role: 'admin', fullName: 'Admin', phone: '+593990000001', email: null, locationId: null };
const ticketId = 'c0000000-0000-4000-8000-000000000001';
const locationId = 'd0000000-0000-4000-8000-000000000001';
const apps: FastifyInstance[] = [];

async function createApp(actor: Actor, query = vi.fn()) {
  const app = Fastify(); apps.push(app);
  app.decorateRequest('actor', null); app.decorateRequest('tenant', null); app.decorateRequest('database', null);
  app.addHook('onRequest', async (request) => {
    request.actor = actor; request.tenant = tenant;
    request.database = { client: { query } as unknown as PoolClient, finished: false, cleanupPaths: [] };
  });
  await app.register(prizeRoutes, { prefix: '/api' }); await app.ready();
  return { app, query };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('prize payment claim-code validation', () => {
  const payload = { ticketId, locationId, method: 'cash', claimCode: '084219' };

  it('rejects a non-admin/non-worker role before database access', async () => {
    const { app, query } = await createApp({ ...admin, role: 'seller' });
    const response = await app.inject({ method: 'POST', url: '/api/prizes/pay', payload });
    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires a six-digit private claim code before database access', async () => {
    const { app, query } = await createApp(admin);
    const response = await app.inject({ method: 'POST', url: '/api/prizes/pay', payload: { ...payload, claimCode: 'wrong' } });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('passes the claim code to the transactional SQL payment function', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ amount_cents: '1250' }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/prizes/pay', payload });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ amountCents: '1250' });
    expect(query.mock.calls[2][0]).toContain('fn_confirm_prize_payment($1, $2, $3, $4, $5, $6)');
    expect(query.mock.calls[2][1]).toEqual([ticketId, admin.id, locationId, 'cash', null, payload.claimCode]);
  });

  it('returns the invalid-code result without recording a payout', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ amount_cents: '-1' }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/prizes/pay', payload });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('CLAIM_CODE_INVALID');
    expect(query).toHaveBeenCalledTimes(3);
  });
});
