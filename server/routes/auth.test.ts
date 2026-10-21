import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authRoutes } from './auth.js';
import type { Actor, TenantContext } from '../types.js';

vi.mock('../env.js', () => ({ env: { NODE_ENV: 'test', SESSION_TTL_DAYS: 14 } }));

const tenant: TenantContext = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'demo', name: 'Demo', tagline: null, timezone: 'America/Guayaquil', currency: 'USD', locale: 'es-EC', branding: {}, modules: {} };
const actor: Actor = { id: 'c0000000-0000-4000-8000-000000000004', tenantId: tenant.id, role: 'client', fullName: 'Cliente Demo', phone: '+593990000004', email: 'cliente@example.test', locationId: null };
const apps: FastifyInstance[] = [];

async function createApp(query = vi.fn()) {
  const app = Fastify(); apps.push(app);
  app.decorateRequest('actor', null); app.decorateRequest('tenant', null); app.decorateRequest('database', null); app.decorateRequest('sessionId', null);
  app.addHook('onRequest', async (request) => {
    request.actor = actor; request.tenant = tenant; request.sessionId = 's0000000-0000-4000-8000-000000000001';
    request.database = { client: { query } as unknown as PoolClient, finished: false, cleanupPaths: [] };
  });
  await app.register(cookie); await app.register(authRoutes, { prefix: '/api/auth' }); await app.ready();
  return { app, query };
}

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('account self-service', () => {
  it('revokes the active session, clears its cookie and returns a successful logout', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const { app } = await createApp(query);
    const response = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { ross_session: 'session-token' } });
    expect(response.statusCode).toBe(204);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE app.auth_sessions SET revoked_at = now()'), ['s0000000-0000-4000-8000-000000000001', actor.id]);
    expect(response.headers['set-cookie']).toContain('ross_session=;');
    expect(response.headers['set-cookie']).toContain('Max-Age=0');
  });

  it('normalizes and saves profile contacts only for the authenticated tenant and user', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ phone: '+593990000004' }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: actor.id, role: actor.role, full_name: 'Nuevo Nombre', phone: '+593990000004', email: 'nuevo@example.test', location_id: null }] });
    const { app } = await createApp(query);
    const response = await app.inject({ method: 'PATCH', url: '/api/auth/profile', payload: { fullName: 'Nuevo Nombre', phone: '0990000004', email: 'nuevo@example.test' } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().user).toMatchObject({ id: actor.id, fullName: 'Nuevo Nombre', phone: '+593990000004', email: 'nuevo@example.test' });
    expect(query.mock.calls[3][1]).toEqual([actor.id, tenant.id, 'Nuevo Nombre', '+593990000004', 'nuevo@example.test']);
  });

  it('rejects a duplicate contact without updating the profile', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ phone: '+593990000004' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'other-user' }] });
    const { app } = await createApp(query);
    const response = await app.inject({ method: 'PATCH', url: '/api/auth/profile', payload: { fullName: 'Nuevo Nombre', phone: '0990000004', email: '' } });
    expect(response.statusCode).toBe(409);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('rolls back to a savepoint when a concurrent contact update wins the unique constraint', async () => {
    const duplicateError = Object.assign(new Error('unique conflict'), { code: '23505' });
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ phone: '+593990000004' }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockRejectedValueOnce(duplicateError)
      .mockResolvedValue({ rowCount: 0, rows: [] });
    const { app } = await createApp(query);
    const response = await app.inject({ method: 'PATCH', url: '/api/auth/profile', payload: { fullName: 'Nuevo Nombre', phone: '0990000004', email: 'nuevo@example.test' } });
    expect(response.statusCode).toBe(409);
    expect(query.mock.calls[4][0]).toBe('ROLLBACK TO SAVEPOINT auth_profile_update');
    expect(query.mock.calls[5][0]).toBe('RELEASE SAVEPOINT auth_profile_update');
  });

  it('rejects a wrong current password without changing the hash or sessions', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ password_hash: await bcrypt.hash('Correct-current-1', 4) }] });
    const { app } = await createApp(query);
    const response = await app.inject({ method: 'POST', url: '/api/auth/password/change', payload: { currentPassword: 'wrong-password', newPassword: 'New-secure-pass-2' } });
    expect(response.statusCode).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('changes password, revokes old sessions and issues a replacement cookie', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ password_hash: await bcrypt.hash('Correct-current-1', 4) }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 3, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 's0000000-0000-4000-8000-000000000099' }] });
    const { app } = await createApp(query);
    const response = await app.inject({ method: 'POST', url: '/api/auth/password/change', payload: { currentPassword: 'Correct-current-1', newPassword: 'New-secure-pass-2' } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ changed: true, sessionsRevoked: true });
    expect(response.headers['set-cookie']).toContain('ross_session=');
    expect(query.mock.calls[2][0]).toContain('UPDATE app.auth_sessions SET revoked_at = now()');
    expect(query.mock.calls[3][0]).toContain('INSERT INTO app.auth_sessions');
  });
});
