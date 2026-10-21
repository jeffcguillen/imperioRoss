import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminFinanceRoutes } from './admin-finance.js';
import type { Actor, TenantContext } from '../types.js';

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'demo', name: 'Demo', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const admin: Actor = { id: 'c0000000-0000-4000-8000-000000000001', tenantId: tenant.id, role: 'admin', fullName: 'Admin', phone: '0990000001', email: null, locationId: null };
const client: Actor = { ...admin, id: 'c0000000-0000-4000-8000-000000000004', role: 'client' };
const apps: FastifyInstance[] = [];

async function createApp(actor: Actor, query = vi.fn()) {
  const app = Fastify(); apps.push(app);
  app.decorateRequest('actor', null); app.decorateRequest('tenant', null); app.decorateRequest('database', null);
  app.addHook('onRequest', async (request) => { request.actor = actor; request.tenant = tenant; request.database = { client: { query } as unknown as PoolClient, finished: false, cleanupPaths: [] }; });
  await app.register(adminFinanceRoutes, { prefix: '/api/admin' }); await app.ready();
  return { app, query };
}
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('finance and cash access', () => {
  it('blocks non-admins before querying finance tables', async () => {
    const { app, query } = await createApp(client);
    const response = await app.inject({ method: 'GET', url: '/api/admin/finance?from=2026-10-01&to=2026-10-19' });
    expect(response.statusCode).toBe(403); expect(query).not.toHaveBeenCalled();
  });

  it('requires report.view before exposing financial summaries', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: false }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/finance?from=2026-10-01&to=2026-10-19' });
    expect(response.statusCode).toBe(403); expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid close amounts before checking permissions or writing', async () => {
    const query = vi.fn(); const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/cash/close', payload: { date: '2026-10-19', countedCents: '-50' } });
    expect(response.statusCode).toBe(400); expect(query).not.toHaveBeenCalled();
  });

  it('requires cash.close to preview cash', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: false }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/cash/preview?date=2026-10-19' });
    expect(response.statusCode).toBe(403); expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects a transfer if both active accounts are not in the tenant', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'c0000000-0000-4000-8000-000000000010' }], rowCount: 1 });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/finance/transfer', payload: {
      fromAccountId: 'c0000000-0000-4000-8000-000000000010', toAccountId: 'c0000000-0000-4000-8000-000000000011', amountCents: '500', note: 'Movimiento de caja',
    } });
    expect(response.statusCode).toBe(400); expect(query).toHaveBeenCalledTimes(2);
  });

  it('requires finance.manage to read receivables', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: false }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/finance/receivables' });
    expect(response.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects a partial collection greater than the remaining balance', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ response: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ amountCents: '1000', collectedCents: '700', status: 'partial' }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/finance/receivables/c0000000-0000-4000-8000-000000000001/payments', payload: { amountCents: '301', idempotencyKey: 'f0000000-0000-4000-8000-000000000001' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('AMOUNT_EXCEEDS_BALANCE');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('fn_receive_receivable_payment'))).toBe(false);
  });

  it('rejects malformed collection amounts before database access', async () => {
    const query = vi.fn();
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/finance/receivables/c0000000-0000-4000-8000-000000000001/payments', payload: { amountCents: '-1', idempotencyKey: 'f0000000-0000-4000-8000-000000000001' } });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('records a valid partial payment through the audited SQL function', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ response: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ amountCents: '1000', collectedCents: '200', status: 'partial' }] })
      .mockResolvedValueOnce({ rows: [{ fn_receive_receivable_payment: null }] })
      .mockResolvedValueOnce({ rows: [{ status: 'partial', amountCents: '1000', collectedCents: '700', remainingCents: '300' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/finance/receivables/c0000000-0000-4000-8000-000000000001/payments', payload: { amountCents: '500', idempotencyKey: 'f0000000-0000-4000-8000-000000000001' } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ collectedCents: '700', remainingCents: '300', status: 'partial' });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('fn_receive_receivable_payment'))).toBe(true);
  });

  it('requires refund.manage to inspect the pending refund queue', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ allowed: false }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'GET', url: '/api/admin/finance/refunds' });
    expect(response.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('requires refund.manage before creating a refund request', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ allowed: false }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/finance/refunds', payload: { purchaseCode: '#000123', amountCents: '500', reason: 'other_authorized' } });
    expect(response.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects a refund request that exceeds the payment remainder', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'e0000000-0000-4000-8000-000000000001', order_id: 'f0000000-0000-4000-8000-000000000001', amount_cents: '1000', status: 'approved' }] })
      .mockResolvedValueOnce({ rows: [{ reserved_cents: '700' }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/finance/refunds', payload: { purchaseCode: '#000123', amountCents: '301', reason: 'other_authorized' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('REFUND_LIMIT_EXCEEDED');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('creates an audited pending refund without completing or paying it early', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'e0000000-0000-4000-8000-000000000001', order_id: 'f0000000-0000-4000-8000-000000000001', amount_cents: '1000', status: 'approved' }] })
      .mockResolvedValueOnce({ rows: [{ reserved_cents: '200' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'd0000000-0000-4000-8000-000000000001' }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/finance/refunds', payload: { purchaseCode: '#000123', amountCents: '500', reason: 'technical_error', notes: 'Servicio interrumpido' } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ refundId: 'd0000000-0000-4000-8000-000000000001', status: 'pending' });
    expect(query.mock.calls[4][0]).toContain('INSERT INTO app.refunds');
    expect(query.mock.calls[4][0]).not.toContain('fn_complete_refund');
    expect(query.mock.calls[4][1]).toEqual([tenant.id, 'e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'technical_error', '500', 'Servicio interrumpido']);
  });

  it('completes wallet refunds through the audited SQL function after locking and checking payment totals', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'd0000000-0000-4000-8000-000000000001', payment_id: 'e0000000-0000-4000-8000-000000000001', amount_cents: '500', status: 'pending', payment_method: 'wallet', payment_amount_cents: '1000', user_id: 'f0000000-0000-4000-8000-000000000001' }] })
      .mockResolvedValueOnce({ rows: [{ reserved_cents: '500' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/finance/refunds/d0000000-0000-4000-8000-000000000001/complete', payload: {} });
    expect(response.statusCode).toBe(200);
    expect(query.mock.calls[3][0]).toContain('app.fn_complete_refund');
    expect(query.mock.calls[3][1]).toEqual(['d0000000-0000-4000-8000-000000000001', admin.id, 'wallet_credit', null]);
  });

  it('requires a manual refund reference before completing non-wallet refunds', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'd0000000-0000-4000-8000-000000000001', payment_id: 'e0000000-0000-4000-8000-000000000001', amount_cents: '500', status: 'pending', payment_method: 'bank_transfer', payment_amount_cents: '1000', user_id: null }] })
      .mockResolvedValueOnce({ rows: [{ reserved_cents: '500' }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/finance/refunds/d0000000-0000-4000-8000-000000000001/complete', payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REFUND_REFERENCE_REQUIRED');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('refuses to close a refund if pending and completed refunds exceed the original payment', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'd0000000-0000-4000-8000-000000000001', payment_id: 'e0000000-0000-4000-8000-000000000001', amount_cents: '500', status: 'pending', payment_method: 'bank_transfer', payment_amount_cents: '1000', user_id: null }] })
      .mockResolvedValueOnce({ rows: [{ reserved_cents: '1100' }] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/finance/refunds/d0000000-0000-4000-8000-000000000001/complete', payload: { method: 'bank_transfer', reference: 'TRX-88321' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('REFUND_LIMIT_EXCEEDED');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('requires an active payout account before completing a manual refund', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'd0000000-0000-4000-8000-000000000001', payment_id: 'e0000000-0000-4000-8000-000000000001', amount_cents: '500', status: 'pending', payment_method: 'bank_transfer', payment_amount_cents: '1000', user_id: null }] })
      .mockResolvedValueOnce({ rows: [{ reserved_cents: '500' }] })
      .mockResolvedValueOnce({ rows: [] });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/finance/refunds/d0000000-0000-4000-8000-000000000001/complete', payload: { method: 'bank_transfer', reference: 'TRX-88321' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('PAYOUT_ACCOUNT_REQUIRED');
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('stores the manual refund method/reference in the audit trail before closing the refund', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ allowed: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'd0000000-0000-4000-8000-000000000001', payment_id: 'e0000000-0000-4000-8000-000000000001', amount_cents: '500', status: 'pending', notes: 'Pago fuera de horario', payment_method: 'bank_transfer', payment_amount_cents: '1000', user_id: null }] })
      .mockResolvedValueOnce({ rows: [{ reserved_cents: '500' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'f0000000-0000-4000-8000-000000000001' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const { app } = await createApp(admin, query);
    const response = await app.inject({ method: 'POST', url: '/api/admin/finance/refunds/d0000000-0000-4000-8000-000000000001/complete', payload: { method: 'bank_transfer', reference: 'TRX-88321' } });
    expect(response.statusCode).toBe(200);
    expect(query.mock.calls[4][1][0]).toContain('referencia TRX-88321');
    expect(query.mock.calls[5][0]).toContain('UPDATE app.refunds SET notes');
    expect(query.mock.calls[5][1][2]).toContain('TRX-88321');
    expect(query.mock.calls[6][0]).toContain('app.fn_complete_refund');
    expect(query.mock.calls[6][1][3]).toBeNull();
  });
});
