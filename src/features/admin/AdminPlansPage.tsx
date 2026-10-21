import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BadgeDollarSign, Layers3, Plus, Save, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { getJson, patchJson, postJson } from '../../services/http';
import './admin-plans.css';

type Prize = { suerteNo: number; name: string; payoutPerDollarCents: string };
type Modality = { digits: 2 | 3 | 4; maxSuertes: number; enabled: boolean };
type Draw = { id: string; name: string; modalities: Modality[] };
type Plan = { id: string; drawId: string; drawName: string; digits: number; name: string; isActive: boolean; version: number | null; prizes: Prize[] };
type PlanData = { draws: Draw[]; items: Plan[] };

const cash = (cents: string) => {
  try { return `$${(BigInt(cents) / 100n).toString()}.${(BigInt(cents) % 100n).toString().padStart(2, '0')}`; }
  catch { return '—'; }
};

export function AdminPlansPage() {
  const cache = useQueryClient();
  const [draft, setDraft] = useState<{ planId?: string; drawId: string; digits: 2 | 3 | 4 | ''; name: string; prizes: Prize[] } | null>(null);
  const auth = useQuery({ queryKey: ['auth','me'], queryFn: ({ signal }) => getJson<{ user: { role: string; permissions: string[] } }>('/api/auth/me', signal), retry: false });
  const query = useQuery({ queryKey: ['admin','plans'], queryFn: ({ signal }) => getJson<PlanData>('/api/admin/plans/manage', signal), enabled: auth.data?.user.role === 'admin' && auth.data.user.permissions.includes('plan.edit'), retry: false });
  const save = useMutation({
    mutationFn: (value: NonNullable<typeof draft>) => value.planId
      ? postJson(`/api/admin/plans/manage/${value.planId}/versions`, { prizes: value.prizes })
      : postJson('/api/admin/plans/manage', { drawId: value.drawId, digits: value.digits, name: value.name.trim(), prizes: value.prizes }),
    onSuccess: async () => { setDraft(null); await cache.invalidateQueries({ queryKey: ['admin','plans'] }); },
  });
  const changeStatus = useMutation({ mutationFn: (item: Plan) => patchJson(`/api/admin/plans/manage/${item.id}/status`, { isActive: !item.isActive }), onSuccess: () => cache.invalidateQueries({ queryKey: ['admin','plans'] }) });
  const availableDraws = query.data?.draws ?? [];
  const selectedDraw = useMemo(() => availableDraws.find((draw) => draw.id === draft?.drawId), [availableDraws, draft?.drawId]);
  const selectedModality = selectedDraw?.modalities.find((item) => item.digits === draft?.digits);

  function beginCreate() {
    const draw = availableDraws.find((item) => item.modalities.some((modality) => modality.enabled));
    const modality = draw?.modalities.find((item) => item.enabled);
    if (!draw || !modality) return;
    setDraft({ drawId: draw.id, digits: modality.digits, name: '', prizes: Array.from({ length: modality.maxSuertes }, (_, index) => ({ suerteNo: index + 1, name: index === 0 ? 'Primera suerte' : `Suerte ${index + 1}`, payoutPerDollarCents: '0' })) });
    save.reset();
  }

  function selectModality(drawId: string, digits: 2 | 3 | 4) {
    const modality = availableDraws.find((item) => item.id === drawId)?.modalities.find((item) => item.digits === digits);
    if (!modality) return;
    setDraft((current) => current ? { ...current, drawId, digits, prizes: Array.from({ length: modality.maxSuertes }, (_, index) => ({ suerteNo: index + 1, name: `Suerte ${index + 1}`, payoutPerDollarCents: '0' })) } : current);
  }

  function beginVersion(item: Plan) {
    setDraft({ planId: item.id, drawId: item.drawId, digits: item.digits as 2 | 3 | 4, name: item.name, prizes: item.prizes.map((prize) => ({ ...prize })) });
    save.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (draft) save.mutate(draft); }

  if (auth.isPending) return <section className="panel remote-state"><div className="loader"/><span>Verificando permisos…</span></section>;
  if (auth.data?.user.role !== 'admin' || !auth.data.user.permissions.includes('plan.edit')) return <section className="panel remote-state"><ShieldCheck size={20}/><strong>Acceso restringido</strong><span>Se requiere Administración y el permiso plan.edit.</span></section>;

  return <div className="admin-plans-page">
    <div className="page-heading"><div><div className="eyebrow">CONFIGURACIÓN DE PREMIOS</div><h1>Planes de premio</h1><p>Cada cambio crea una versión nueva; las jugadas previas conservan la versión que usaron.</p></div><button className="button button-gold" type="button" onClick={beginCreate} disabled={!availableDraws.some((draw) => draw.modalities.some((modality) => modality.enabled))}><Plus size={16}/>Nuevo plan</button></div>
    {draft && <form className="panel plan-editor" onSubmit={submit}>
      <div className="panel-heading"><div><div className="eyebrow">{draft.planId ? 'NUEVA VERSIÓN INMUTABLE' : 'PLAN NUEVO'}</div><h2>{draft.planId ? `Editar ${draft.name}` : 'Configurar plan'}</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={() => setDraft(null)}><X size={17}/></button></div>
      <div className="plan-editor-fields">{!draft.planId ? <><label className="field"><span>Sorteo</span><select value={draft.drawId} onChange={(event) => { const drawId = event.target.value; const modality = availableDraws.find((draw) => draw.id === drawId)?.modalities.find((item) => item.enabled); if (modality) selectModality(drawId, modality.digits); }} required>{availableDraws.filter((draw) => draw.modalities.some((item) => item.enabled)).map((draw) => <option key={draw.id} value={draw.id}>{draw.name}</option>)}</select></label><label className="field"><span>Modalidad</span><select value={draft.digits} onChange={(event) => selectModality(draft.drawId, Number(event.target.value) as 2 | 3 | 4)} required>{selectedDraw?.modalities.filter((item) => item.enabled).map((item) => <option key={item.digits} value={item.digits}>{item.digits} cifras · {item.maxSuertes} suertes</option>)}</select></label><label className="field"><span>Nombre del plan</span><input value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} minLength={2} maxLength={100} required/></label></> : <div className="plan-version-context"><strong>{draft.name}</strong><span>{selectedDraw?.name ?? ''} · {draft.digits} cifras · {draft.prizes.length} suertes</span></div>}</div>
      <div className="plan-prize-list"><div className="eyebrow">PREMIO POR CADA $1 JUGADO</div>{draft.prizes.map((prize, index) => <div className="plan-prize-row" key={prize.suerteNo}><strong>{prize.suerteNo}.ª</strong><label className="field"><span>Nombre</span><input value={prize.name} onChange={(event) => setDraft((current) => current ? { ...current, prizes: current.prizes.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry) } : current)} maxLength={80} required/></label><label className="field"><span>Pago (centavos)</span><input type="number" min={0} value={prize.payoutPerDollarCents} onChange={(event) => setDraft((current) => current ? { ...current, prizes: current.prizes.map((entry, i) => i === index ? { ...entry, payoutPerDollarCents: event.target.value } : entry) } : current)} required/></label><span className="plan-prize-preview">{cash(prize.payoutPerDollarCents)} por cada dólar</span></div>)}</div>
      {selectedModality && draft.prizes.length !== selectedModality.maxSuertes && <p className="form-notice error">Esta modalidad requiere {selectedModality.maxSuertes} suertes.</p>}{save.isError && <p className="form-notice error" role="alert">No se pudo guardar: {save.error.message}</p>}
      <div className="plan-editor-actions"><span>Las versiones anteriores permanecen ligadas a sus tickets.</span><button className="button button-gold" type="submit" disabled={save.isPending || !draft.name.trim() || draft.prizes.some((item) => !/^\d{1,15}$/.test(item.payoutPerDollarCents))}><Save size={15}/>{save.isPending ? 'Guardando…' : draft.planId ? 'Publicar nueva versión' : 'Crear plan'}</button></div>
    </form>}
    {query.isPending ? <section className="panel remote-state"><div className="loader"/><span>Cargando planes desde PostgreSQL…</span></section> : query.isError ? <section className="panel remote-state"><strong>No se pudieron cargar los planes</strong><span>{query.error.message}</span><button className="text-link" type="button" onClick={() => void query.refetch()}>Reintentar <ArrowRight size={14}/></button></section> : query.data?.items.length ? <section className="plan-grid">{query.data.items.map((item) => <article className={`panel plan-card ${item.isActive ? '' : 'is-inactive'}`} key={item.id}><div className="plan-card-top"><span className="plan-digits">{item.digits} cifras</span><span className={`status-badge ${item.isActive ? 'status-active' : 'status-cancelled'}`}>{item.isActive ? 'Activo' : 'Inactivo'}</span></div><h2>{item.name}</h2><p>{item.drawName} · {item.version ? `Versión ${item.version}` : 'Sin versión'}</p><div className="plan-card-prizes">{item.prizes.map((prize) => <div key={prize.suerteNo}><span>{prize.suerteNo}.ª {prize.name}</span><strong>{cash(prize.payoutPerDollarCents)}</strong></div>)}</div><div className="plan-card-actions"><button className="button button-outline" type="button" onClick={() => beginVersion(item)} disabled={!item.version}><Layers3 size={14}/>Nueva versión</button><button className="button button-outline" type="button" onClick={() => changeStatus.mutate(item)} disabled={changeStatus.isPending}>{item.isActive ? 'Desactivar' : 'Activar'}</button></div></article>)}</section> : <section className="panel remote-state"><BadgeDollarSign size={22}/><strong>Aún no hay planes de premio</strong><span>Crea un plan para una modalidad activa. Debes configurar una suerte por cada posición del sorteo.</span></section>}
    {changeStatus.isError && <div className="form-notice error" role="alert">No se pudo actualizar el estado: {changeStatus.error.message}</div>}
  </div>;
}
