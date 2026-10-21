import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, CalendarClock, Pencil, Plus, ShieldCheck, UserRound, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { getJson, patchJson, postJson } from '../../services/http';

type Plan = { id: string; sellerId: string | null; sellerName: string | null; drawId: string | null; drawName: string | null; digits: number | null; base: 'sales_percent' | 'fixed_amount' | 'monthly_profit_percent'; percentBp: number | null; fixedCents: string | null; effectiveFrom: string; effectiveTo: string | null; isActive: boolean; createdAt: string };
type PlanData = { items: Plan[]; sellers: Array<{ id: string; fullName: string }>; draws: Array<{ id: string; name: string }> };
const baseLabel: Record<Plan['base'], string> = { sales_percent: 'Porcentaje de venta', fixed_amount: 'Valor fijo por venta', monthly_profit_percent: 'Porcentaje de utilidad mensual' };
const money = (cents: string) => `$${(Number(cents) / 100).toLocaleString('es-EC', { minimumFractionDigits: 2 })}`;
const today = () => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`; };

export function AdminCommissionPlansPage() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: { role: string } }>('/api/auth/me', signal), retry: false });
  const query = useQuery({ queryKey: ['/api/admin/commission-plans'], queryFn: ({ signal }) => getJson<PlanData>('/api/admin/commission-plans', signal), enabled: auth.data?.user.role === 'admin', retry: false });
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState<Plan['base']>('sales_percent');
  const [sellerId, setSellerId] = useState('');
  const [drawId, setDrawId] = useState('');
  const [digits, setDigits] = useState('');
  const [percent, setPercent] = useState('6');
  const [fixed, setFixed] = useState('0.10');
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState('');
  const [reason, setReason] = useState('');
  const [disableTarget, setDisableTarget] = useState<Plan | null>(null);
  const [targetActive, setTargetActive] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const create = useMutation({
    mutationFn: () => postJson('/api/admin/commission-plans', {
      base, sellerId: sellerId || null, drawId: drawId || null, digits: digits ? Number(digits) : null,
      ...(base === 'fixed_amount' ? { fixedCents: String(Math.round(Number(fixed) * 100)) } : { percentBp: Math.round(Number(percent) * 100) }),
      effectiveFrom, effectiveTo: base === 'monthly_profit_percent' ? null : effectiveTo || null,
    }),
    onSuccess: () => { setOpen(false); setSellerId(''); setDrawId(''); setDigits(''); void client.invalidateQueries({ queryKey: ['/api/admin/commission-plans'] }); },
  });
  const change = useMutation({
    mutationFn: ({ id, isActive, reason: auditReason }: { id: string; isActive: boolean; reason: string }) => patchJson(`/api/admin/commission-plans/${id}/active`, { isActive, reason: auditReason }),
    onSuccess: () => { setReason(''); setDisableTarget(null); void client.invalidateQueries({ queryKey: ['/api/admin/commission-plans'] }); },
  });
  const update = useMutation({
    mutationFn: () => patchJson(`/api/admin/commission-plans/${editing!.id}`, {
      base, sellerId: sellerId || null, drawId: drawId || null, digits: digits ? Number(digits) : null,
      ...(base === 'fixed_amount' ? { fixedCents: String(Math.round(Number(fixed) * 100)) } : { percentBp: Math.round(Number(percent) * 100) }),
      effectiveFrom, effectiveTo: base === 'monthly_profit_percent' ? null : effectiveTo || null, reason: reason.trim(),
    }),
    onSuccess: () => { setOpen(false); setEditing(null); setReason(''); void client.invalidateQueries({ queryKey: ['/api/admin/commission-plans'] }); },
  });
  const submit = (event: FormEvent) => { event.preventDefault(); if (editing) update.mutate(); else create.mutate(); };
  const startEditing = (plan: Plan) => {
    setEditing(plan); setOpen(true); setBase(plan.base); setSellerId(plan.sellerId ?? ''); setDrawId(plan.drawId ?? ''); setDigits(plan.digits?.toString() ?? '');
    setPercent(((plan.percentBp ?? 0) / 100).toString()); setFixed(((Number(plan.fixedCents ?? 0)) / 100).toFixed(2)); setEffectiveFrom(plan.effectiveFrom);
    setEffectiveTo(plan.effectiveTo ?? ''); setReason(''); create.reset(); update.reset();
  };
  const cancelForm = () => { setOpen(false); setEditing(null); setReason(''); create.reset(); update.reset(); };
  const plans = query.data?.items ?? [];
  const active = plans.filter((plan) => plan.isActive).length;
  const permission = auth.data?.user.role === 'admin';
  if (auth.isPending) return <section className="panel remote-state"><div className="loader"/><span>Verificando acceso…</span></section>;
  return <>
    <div className="page-heading"><div><div className="eyebrow">REGLAS DE LIQUIDACIÓN</div><h1>Planes de comisión</h1><p>Configura reglas por vendedor, sorteo y modalidad. Las comisiones ya generadas conservan su historial.</p></div>{permission && <button className="button button-green" onClick={() => setOpen((value) => !value)}><Plus size={16}/>{open ? 'Cerrar' : 'Nuevo plan'}</button>}</div>
    {!permission && <section className="panel remote-state"><span className="state-icon"><ShieldCheck size={20}/></span><strong>Acceso exclusivo de Administración</strong></section>}
    {query.isError && <div className="form-notice error" role="alert">{query.error.message}</div>}
    {change.isError && <div className="form-notice error" role="alert">{change.error.message}</div>}
    {create.isError && <div className="form-notice error" role="alert">{create.error.message}</div>}
    {update.isError && <div className="form-notice error" role="alert">{update.error.message}</div>}
    {create.isSuccess && <div className="form-notice success" role="status">Plan de comisión guardado. Se aplicará a las ventas que coincidan con su vigencia y alcance.</div>}
    {change.isSuccess && <div className="form-notice success" role="status">Estado del plan actualizado.</div>}
    {update.isSuccess && <div className="form-notice success" role="status">Regla actualizada y publicada. El historial de comisiones ya calculadas se conserva.</div>}
    {permission && <div className="commission-stats"><article className="panel commission-stat"><BadgePercent/><div><span>Planes activos</span><strong>{active}</strong></div></article><article className="panel commission-stat"><UserRound/><div><span>Vendedores activos</span><strong>{query.data?.sellers.length ?? '—'}</strong></div></article><article className="panel commission-stat"><CalendarClock/><div><span>Vigencia</span><strong>Por fecha efectiva</strong></div></article></div>}
    {open && permission && <form className="panel commission-form" onSubmit={submit}>
      <div className="panel-heading"><div><div className="eyebrow">{editing ? 'ACTUALIZAR CONFIGURACIÓN' : 'CREAR CONFIGURACIÓN'}</div><h2>{editing ? 'Editar regla de comisión' : 'Nueva regla de comisión'}</h2></div><BadgePercent size={20}/></div>
      <div className="commission-fields">
        <Field label="Base de cálculo"><select value={base} onChange={(event) => setBase(event.target.value as Plan['base'])}><option value="sales_percent">Porcentaje de venta</option><option value="fixed_amount">Valor fijo por venta</option><option value="monthly_profit_percent">Porcentaje de utilidad mensual</option></select></Field>
        <Field label="Vendedor"><select value={sellerId} onChange={(event) => setSellerId(event.target.value)}><option value="">Todos los vendedores</option>{query.data?.sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.fullName}</option>)}</select></Field>
        <Field label="Sorteo"><select value={drawId} onChange={(event) => setDrawId(event.target.value)}><option value="">Todos los sorteos</option>{query.data?.draws.map((draw) => <option key={draw.id} value={draw.id}>{draw.name}</option>)}</select></Field>
        <Field label="Modalidad"><select value={digits} onChange={(event) => setDigits(event.target.value)}><option value="">Todas</option><option value="2">2 cifras</option><option value="3">3 cifras</option><option value="4">4 cifras</option></select></Field>
        {base === 'fixed_amount' ? <Field label="Valor fijo por venta (USD)"><input inputMode="decimal" value={fixed} onChange={(event) => setFixed(event.target.value.replace(/[^\d.]/g, ''))}/></Field> : <Field label="Porcentaje (%)"><input inputMode="decimal" min="0" max="100" step="0.01" value={percent} onChange={(event) => setPercent(event.target.value)}/></Field>}
        <Field label={base === 'monthly_profit_percent' ? 'Activa desde hoy' : 'Vigente desde'}><input type="date" required value={effectiveFrom} max={base === 'monthly_profit_percent' ? today() : undefined} onChange={(event) => setEffectiveFrom(event.target.value)}/></Field>
        <Field label="Vigente hasta"><input type="date" min={effectiveFrom} value={effectiveTo} disabled={base === 'monthly_profit_percent'} onChange={(event) => setEffectiveTo(event.target.value)}/><small>{base === 'monthly_profit_percent' ? 'La liquidación mensual continúa hasta desactivar la regla.' : 'Sin fecha final para mantener la regla vigente.'}</small></Field>
        {editing && <Field label="Motivo del cambio (requerido)"><input minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explica el cambio para la auditoría" required/></Field>}
      </div>
      <div className="commission-form-footer"><span>Los cambios quedan auditados. Alcances específicos tienen prioridad sobre reglas generales.</span><div><button className="button button-outline" type="button" onClick={cancelForm}>Cancelar</button><button className="button button-green" disabled={create.isPending || update.isPending || Number(base === 'fixed_amount' ? fixed : percent) < 0 || (editing !== null && reason.trim().length < 5)}>{create.isPending || update.isPending ? 'Guardando…' : editing ? 'Guardar y publicar' : 'Crear plan'}</button></div></div>
    </form>}
    {permission && <section className="panel commission-list"><div className="panel-heading"><div><div className="eyebrow">HISTORIAL CONFIGURADO</div><h2>Reglas de comisión</h2></div><BadgePercent size={19}/></div>
      {query.isPending ? <div className="remote-state"><div className="loader"/><span>Cargando planes…</span></div> : !plans.length ? <div className="remote-state"><strong>No hay planes configurados</strong><span>Crea una regla para que el sistema calcule comisiones de ventas atribuibles.</span></div> : <div className="commission-table-wrap"><table className="commission-table"><thead><tr><th>Cálculo</th><th>Alcance</th><th>Vigencia</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{plans.map((plan) => <tr key={plan.id}><td><strong>{baseLabel[plan.base]}</strong><small>{plan.base === 'fixed_amount' ? money(plan.fixedCents ?? '0') : `${((plan.percentBp ?? 0) / 100).toLocaleString('es-EC')}%`}</small></td><td><strong>{plan.sellerName ?? 'Todos los vendedores'}</strong><small>{plan.drawName ?? 'Todos los sorteos'}{plan.digits ? ` · ${plan.digits} cifras` : ' · todas las modalidades'}</small></td><td>{plan.effectiveFrom}{plan.effectiveTo ? ` — ${plan.effectiveTo}` : ' en adelante'}</td><td><span className={`status-badge ${plan.isActive ? 'status-active' : 'status-cancelled'}`}>{plan.isActive ? 'Activo' : 'Inactivo'}</span></td><td><div className="commission-row-actions">{plan.isActive ? <><button className="button button-outline" type="button" onClick={() => startEditing(plan)} disabled={update.isPending}><Pencil size={14}/>Editar</button><button className="button button-danger-outline" type="button" onClick={() => { setReason(''); setTargetActive(false); setDisableTarget(plan); }} disabled={change.isPending}><X size={14}/>Eliminar</button></> : <button className="button button-outline" type="button" onClick={() => { setReason(''); setTargetActive(true); setDisableTarget(plan); }} disabled={change.isPending}>Reactivar</button>}</div></td></tr>)}</tbody></table></div>}
      {disableTarget && <div className="commission-disable"><strong>{targetActive ? 'Reactivar' : 'Eliminar'} regla de {disableTarget.sellerName ?? 'todos los vendedores'}</strong><p>La regla se elimina de forma lógica para proteger el historial contable.</p><label className="field"><span>Motivo de auditoría</span><input minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Describe el cambio"/></label><div><button className="button button-outline" type="button" onClick={() => setDisableTarget(null)}>Volver</button><button className={targetActive ? 'button button-green' : 'button button-danger-outline'} type="button" disabled={reason.trim().length < 5 || change.isPending} onClick={() => change.mutate({ id: disableTarget.id, isActive: targetActive, reason: reason.trim() })}>{change.isPending ? 'Guardando…' : targetActive ? 'Confirmar reactivación' : 'Confirmar eliminación'}</button></div></div>}
    </section>}
  </>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
