import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '../services/http';

export interface TenantConfig {
  slug: string;
  name: string;
  tagline: string | null;
  branding: { palette?: Record<string, unknown>; logos?: Record<string, unknown> };
  modules: Record<string, boolean>;
}

const logoFiles = new Set(['logo-horizontal.png', 'logo-monogram.png', 'logo-full.png', 'logo-full-slogan.png']);

export function useTenantConfig() {
  return useQuery({
    queryKey: ['tenant', window.location.host],
    queryFn: ({ signal }) => getJson<{ tenant: TenantConfig }>('/api/tenant/config', signal),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function TenantLogo({ variant = 'horizontal', alt, className }: { variant?: 'horizontal' | 'monogram' | 'full' | 'full_slogan'; alt: string; className?: string }) {
  const tenant = useTenantConfig().data?.tenant;
  const candidate = tenant?.branding?.logos?.[variant];
  const filename = typeof candidate === 'string' && logoFiles.has(candidate) ? candidate : `logo-${variant.replace('_', '-')}.png`;
  return <img className={className} src={`/brand/${filename}`} alt={alt} />;
}

function validColor(value: unknown): value is string {
  return typeof value === 'string' && /^(#[\da-f]{3,8}|oklch\([\d.%\s+-]+\))$/i.test(value);
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const query = useTenantConfig();

  useEffect(() => {
    const tenant = query.data?.tenant;
    if (!tenant) return;
    document.title = tenant.name;
    const palette = tenant.branding?.palette ?? {};
    if (validColor(palette.gold)) document.documentElement.style.setProperty('--gold', palette.gold);
    if (validColor(palette.emerald)) document.documentElement.style.setProperty('--green-dark', palette.emerald);
  }, [query.data]);

  return children;
}
