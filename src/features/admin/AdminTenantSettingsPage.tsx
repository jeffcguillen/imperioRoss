import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, getJson, patchJson } from '../../services/http';

const logoOptions = ['logo-horizontal.png', 'logo-monogram.png', 'logo-full.png', 'logo-full-slogan.png'] as const;
type LogoKey = 'horizontal' | 'monogram' | 'full' | 'full_slogan';
type TenantSettings = { id: string; slug: string; domain: string | null; name: string; tagline: string | null; timezone: string; currency: string; locale: string; revision: string; gold: string; emerald: string; logos: Record<LogoKey, typeof logoOptions[number]>; rafflesEnabled: boolean };
type SettingsDraft = Omit<TenantSettings, 'id' | 'slug' | 'revision' | 'tagline' | 'domain'> & { domain: string; tagline: string; expectedRevision: string; reason: string };
const initialDraft = (tenant: TenantSettings): SettingsDraft => ({ domain: tenant.domain ?? '', name: tenant.name, tagline: tenant.tagline ?? '', timezone: tenant.timezone, currency: tenant.currency, locale: tenant.locale, gold: tenant.gold, emerald: tenant.emerald, logos: tenant.logos, rafflesEnabled: tenant.rafflesEnabled, expectedRevision: tenant.revision, reason: '' });

export function AdminTenantSettingsPage() {
  const cache = useQueryClient();
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [notice, setNotice] = useState('');
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: { role: string; permissions?: string[] } }>('/api/auth/me', signal), retry: false });
  const settings = useQuery({ queryKey: ['admin', 'tenant'], queryFn: ({ signal }) => getJson<{ tenant: TenantSettings }>('/api/admin/tenant', signal), enabled: auth.data?.user.role === 'admin', retry: false });
  useEffect(() => { if (settings.data) setDraft(initialDraft(settings.data.tenant)); }, [settings.data]);
  const save = useMutation({
    mutationFn: () => patchJson<{ tenant: TenantSettings }>('/api/admin/tenant', draft),
    onSuccess: async ({ tenant }) => {
      setDraft(initialDraft(tenant)); setNotice('Configuración guardada y cambio auditado.');
      cache.setQueryData(['admin', 'tenant'], { tenant });
      await cache.invalidateQueries({ queryKey: ['tenant'] });
    },
  });
  const submit = (event: FormEvent) => { event.preventDefault(); setNotice(''); if (draft?.reason.trim().length && draft.reason.trim().length >= 5) save.mutate(); };
  const update = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);

  if (auth.isPending) return <><Heading/><section className="panel remote-state"><div className="loader"/><span>Verificando permisos…</span></section></>;
  if (auth.data?.user.role !== 'admin' || !auth.data.user.permissions?.includes('tenant.manage')) return <><Heading/><section className="panel remote-state"><span className="state-icon"><ShieldCheck size={20}/></span><strong>Acceso restringido</strong><span>Se requiere el permiso administrativo tenant.manage para editar esta configuración.</span></section></>;
  if (settings.isError) return <><Heading/><section className="panel remote-state"><strong>No se pudo cargar la configuración</strong><span>{settings.error.message}</span><button className="text-link" type="button" onClick={() => void settings.refetch()}>Intentar de nuevo <RefreshCw size={14}/></button></section></>;
  if (settings.isPending || !draft) return <><Heading/><section className="panel remote-state"><div className="loader"/><span>Cargando configuración de la plataforma…</span></section></>;

  return <>
    <Heading/>
    <section className="panel tenant-settings-identity"><Building2 size={20}/><div><strong>{settings.data.tenant.name}</strong><small>Tenant {settings.data.tenant.slug} · Dominio: {settings.data.tenant.domain ?? 'resuelto por slug'}</small></div><span>El slug permanece inmutable. El dominio personalizado requiere DNS apuntando a este sistema.</span></section>
    {notice && <div className="form-notice success" role="status">{notice}</div>}
    {save.isError && <div className="form-notice error" role="alert">{save.error.message}{save.error instanceof ApiError && save.error.status === 409 && <button className="text-link" type="button" onClick={() => void settings.refetch()}>Cargar cambios actuales</button>}</div>}
    <form className="panel tenant-settings-form" onSubmit={submit}>
      <div className="panel-heading"><div><div className="eyebrow">IDENTIDAD Y OPERACIÓN</div><h2>Configuración del tenant</h2></div><Building2 size={19}/></div>
      <div className="tenant-settings-grid">
        <label className="field"><span>Dominio personalizado (opcional)</span><input value={draft.domain} onChange={(event) => update('domain', event.target.value.trim().toLowerCase())} maxLength={253} placeholder="jugar.ejemplo.com" autoComplete="off"/><small>Solo el host, sin https://, ruta ni puerto. Deja vacío para usar el slug.</small></label>
        <label className="field"><span>Nombre de marca</span><input maxLength={120} minLength={2} value={draft.name} onChange={(event) => update('name', event.target.value)} required/></label>
        <label className="field"><span>Lema</span><input maxLength={180} value={draft.tagline} onChange={(event) => update('tagline', event.target.value)}/></label>
        <label className="field"><span>Zona horaria</span><input maxLength={80} value={draft.timezone} onChange={(event) => update('timezone', event.target.value)} required/><small>Ejemplo: America/Guayaquil</small></label>
        <label className="field"><span>Idioma regional</span><input pattern="[a-z]{2}-[A-Z]{2}" maxLength={5} value={draft.locale} onChange={(event) => update('locale', event.target.value)} required/></label>
        <label className="field"><span>Moneda ISO</span><input pattern="[A-Z]{3}" maxLength={3} value={draft.currency} onChange={(event) => update('currency', event.target.value.toUpperCase())} required/></label>
        <label className="field"><span>Color dorado</span><div className="tenant-color-control"><input type="color" aria-label="Color dorado" value={draft.gold} onChange={(event) => update('gold', event.target.value)}/><input value={draft.gold} pattern="#[0-9a-fA-F]{6}" maxLength={7} onChange={(event) => update('gold', event.target.value)} required/></div></label>
        <label className="field"><span>Color esmeralda</span><div className="tenant-color-control"><input type="color" aria-label="Color esmeralda" value={draft.emerald} onChange={(event) => update('emerald', event.target.value)}/><input value={draft.emerald} pattern="#[0-9a-fA-F]{6}" maxLength={7} onChange={(event) => update('emerald', event.target.value)} required/></div></label>
        {(Object.keys(draft.logos) as LogoKey[]).map((variant) => <label className="field" key={variant}><span>Logo · {variant.replace('_', ' ')}</span><select value={draft.logos[variant]} onChange={(event) => update('logos', { ...draft.logos, [variant]: event.target.value as typeof logoOptions[number] })}>{logoOptions.map((logo) => <option key={logo}>{logo}</option>)}</select><small>Solo se usan PNG originales disponibles en el proyecto.</small></label>)}
      </div>
      <label className="check-row tenant-module-toggle"><input type="checkbox" checked={draft.rafflesEnabled} onChange={(event) => update('rafflesEnabled', event.target.checked)}/><span>Habilitar Rifas Especiales para este tenant. Al desactivarlo se bloquean la ruta pública y la API.</span></label>
      <label className="field"><span>Motivo del cambio <small>Se registra en auditoría · mínimo 5 caracteres</small></span><textarea rows={3} maxLength={500} minLength={5} value={draft.reason} onChange={(event) => update('reason', event.target.value)} required/></label>
      <div className="tenant-settings-actions"><span>Los cambios visuales se actualizan en la configuración pública al guardar.</span><button className="button button-green" type="submit" disabled={save.isPending || draft.reason.trim().length < 5}><Save size={16}/>{save.isPending ? 'Guardando…' : 'Guardar configuración'}</button></div>
    </form>
  </>;
}

function Heading() { return <div className="page-heading"><div><div className="eyebrow">ADMINISTRACIÓN DE LA PLATAFORMA</div><h1>Marca y configuración</h1><p>Actualiza identidad, zona horaria, moneda y módulos de este tenant.</p></div></div>; }
