import type { PoolClient } from 'pg';

export interface TenantContext {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  timezone: string;
  currency: string;
  locale: string;
  branding: Record<string, unknown>;
  modules: Record<string, unknown>;
}

export interface Actor {
  id: string;
  tenantId: string;
  role: 'admin' | 'worker' | 'seller' | 'client';
  fullName: string;
  phone: string;
  email: string | null;
  locationId: string | null;
}

export interface RequestDatabase {
  client: PoolClient;
  finished: boolean;
  cleanupPaths: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    tenant: TenantContext | null;
    actor: Actor | null;
    sessionId: string | null;
    database: RequestDatabase | null;
  }
}
