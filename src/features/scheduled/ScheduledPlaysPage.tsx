import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, History, Pause, Play, Plus, Wallet, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { getJson, patchJson, postJson } from '../../services/http';
import type { ApiList } from '../../types/api';

type PlanOption = { id: string; name: string };
type Option = { drawId: string; drawName: string; drawTime: string; daysOfWeek: number[]; digits: number; minCents: string; stepCents: string; plans: PlanOption[] };
type Run = { id: string; outcome: string; runAt: string; orderId: string | null; drawDate: string };
type Audit = { id: string; changedAt: string; oldValue: unknown; newValue: unknown; reason: string | null };
type ScheduledPlay = { id: string; drawId: string; drawName: string; drawTime: string; digits: number; number: string; planId: string | null; planName: string | null; amountCents: string; daysOfWeek: number[]; status: string; version: number; createdAt: string; updatedAt: string; history: Audit[]; runs: Run[] };

const week = [{ day: 1, label: 'Lun' }, { day: 2, label: 'Mar' }, { day: 3, label: 'Mié' }, { day: 4, label: 'Jue' }, { day: 5, label: 'Vie' }, { day: 6, label: 'Sáb' }, { day: 7, label: 'Dom' }];
const dayLabel = (days: number[]) => week.filter(({ day }) => days.includes(day)).map(({ label }) => label).join(', ');
const money = (cents: string) => `$${(Number(cents) / 100).toLocaleString('es-EC', { minimumFractionDigits: 2 })}`;
const dateTime = (value: string) => new Date(value).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short' });
const statusText: Record<string, string> = { active: 'Activa', paused: 'Pausada', cancelled: 'Cancelada', executed: 'Ejecutada', not_executed_insufficient_balance: 'Saldo insuficiente' };

export function ScheduledPlaysPage() {
  const client = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: { role: string } }>('/api/auth/me', signal), retry: false });
  const plays = useQuery({ queryKey: ['/api/scheduled-plays'], queryFn: ({ signal }) => getJson<ApiList<ScheduledPlay> & { availableCents: string }>('/api/scheduled-plays', signal), enabled: client.data?.user.role === 'client', retry: false });
  const options = useQuery({ queryKey: ['/api/scheduled-plays/options'], queryFn: ({ signal }) => getJson<ApiList<Option>>('/api/scheduled-plays/options', signal), enabled: client.data?.user.role === 'client', retry: false });
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [drawId, setDrawId] = useState('');
  const [digits, setDigits] = useState(2);
  const [number, setNumber] = useState('');
  const [planId, setPlanId] = useState('');
  const [amount, setAmount] = useState('1.00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const rows = options.data?.items ?? [];
  const draws = useMemo(() => [...new Map(rows.map((item) => [item.drawId, item])).values()], [rows]);
  const selectedDraw = rows.find((item) => item.drawId === drawId && item.digits === digits);
  const create = useMutation({
    mutationFn: () => postJson('/api/scheduled-plays', { drawId, digits, number, ...(planId ? { planId } : {}), amountCents: String(Math.round(Number(amount) * 100)), daysOfWeek: days }),
    onSuccess: () => { setNumber(''); setPlanId(''); setFormOpen(false); void queryClient.invalidateQueries({ queryKey: ['/api/scheduled-plays'] }); },
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'paused' | 'cancelled' }) => patchJson(`/api/scheduled-plays/${id}`, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['/api/scheduled-plays'] }),
  });
  const toggleDay = (day: number) => setDays((current) => current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day].sort());

  if (client.isPending) return <section className="panel remote-state"><div className="loader"/><span>Verificando tu cuenta…</span></section>;
  if (!client.data) return <><Heading/><section className="panel account-panel"><div className="account-lock"><CalendarClock size={22}/></div><div><h2>Inicia sesión para programar jugadas</h2><p>Administra tus jugadas recurrentes desde tu cuenta cliente.</p></div><NavLink className="button button-green" to="/acceso">Iniciar sesión</NavLink></section></>;
  if (client.data.user.role !== 'client') return <><Heading/><section className="panel remote-state"><strong>Disponible para cuentas cliente</strong><span>Esta función utiliza tu billetera personal.</span></section></>;
  const items = plays.data?.items ?? [];
  const active = items.filter((item) => item.status === 'active').length;
  return <>
    <Heading action={<button className="button button-green" onClick={() => setFormOpen((open) => !open)}><Plus size={16}/>{formOpen ? 'Cerrar formulario' : 'Nueva programación'}</button>}/>
    {plays.isError && <div className="form-notice error" role="alert">{plays.error.message}</div>}
    {options.isError && <div className="form-notice error" role="alert">{options.error.message}</div>}
    {update.isError && <div className="form-notice error" role="alert">{update.error.message}</div>}
    <div className="scheduled-stats">
      <article className="panel scheduled-stat"><Wallet/><div><span>Saldo disponible</span><strong>{money(plays.data?.availableCents ?? '0')}</strong><small>Se valida antes de cada ejecución</small></div></article>
      <article className="panel scheduled-stat"><CalendarClock/><div><span>Programaciones activas</span><strong>{active}</strong><small>Conservas el control de cada una</small></div></article>
      <article className="panel scheduled-stat"><History/><div><span>Ejecuciones registradas</span><strong>{items.reduce((total, item) => total + item.runs.length, 0)}</strong><small>Tickets y rechazos de saldo</small></div></article>
    </div>
    <div className="scheduled-note"><strong>Saldo protegido</strong><span>Si no hay fondos suficientes, no se crea ticket ni se realiza un descuento parcial.</span></div>
    {formOpen && <section className="panel scheduled-form">
      <div className="panel-heading"><div><div className="eyebrow">CONFIGURA TU RECURRENCIA</div><h2>Nueva jugada programada</h2></div><CalendarClock size={21}/></div>
      {options.isPending ? <div className="remote-state"><div className="loader"/><span>Cargando sorteos habilitados…</span></div> : <>
        <div className="scheduled-fields">
          <label className="field"><span>Sorteo</span><select value={drawId} onChange={(event) => { const id = event.target.value; const first = rows.find((row) => row.drawId === id); setDrawId(id); setPlanId(''); if (first) { setDigits(first.digits); setDays(first.daysOfWeek); } }}><option value="">Selecciona un sorteo</option>{draws.map((draw) => <option key={draw.drawId} value={draw.drawId}>{draw.drawName} · {draw.drawTime.slice(0, 5)}</option>)}</select></label>
          <label className="field"><span>Modalidad</span><select value={digits} onChange={(event) => { const selected = rows.find((row) => row.drawId === drawId && row.digits === Number(event.target.value)); setDigits(Number(event.target.value)); setPlanId(''); if (selected) setDays(selected.daysOfWeek); }} disabled={!drawId}>{rows.filter((row) => row.drawId === drawId).map((row) => <option key={row.digits} value={row.digits}>{row.digits} cifras · mínimo {money(row.minCents)} · paso {money(row.stepCents)}</option>)}</select></label>
          <label className="field"><span>Número</span><input inputMode="numeric" autoComplete="off" maxLength={digits} value={number} onChange={(event) => setNumber(event.target.value.replace(/\D/g, '').slice(0, digits))} placeholder={`${digits} cifras`}/></label>
          <label className="field"><span>Plan de premios</span><select value={planId} onChange={(event) => setPlanId(event.target.value)} disabled={!selectedDraw?.plans.length}><option value="">Sin plan específico</option>{selectedDraw?.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
          <label className="field"><span>Importe por ejecución (USD)</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, '').slice(0, 12))} placeholder="1.00"/></label>
        </div>
        <fieldset className="scheduled-days"><legend>Días de ejecución</legend><div>{week.filter(({ day }) => selectedDraw?.daysOfWeek.includes(day)).map(({ day, label }) => <label key={day} className={days.includes(day) ? 'selected' : ''}><input type="checkbox" checked={days.includes(day)} onChange={() => toggleDay(day)}/>{label}</label>)}</div></fieldset>
        <div className="scheduled-form-footer"><span>La frecuencia debe coincidir con los días habilitados del sorteo.</span><button className="button button-green" disabled={!drawId || number.length !== digits || !days.length || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Guardando…' : 'Guardar programación'}</button></div>
        {create.isError && <div className="form-notice error" role="alert">{create.error.message}</div>}
      </>}
    </section>}
    {plays.isPending ? <section className="panel remote-state"><div className="loader"/><span>Cargando tus programaciones…</span></section> : !items.length ? <section className="panel remote-state"><span className="state-icon"><CalendarClock size={20}/></span><strong>Aún no tienes jugadas programadas</strong><span>Crea una programación para repetir una jugada según el sorteo y los días que elijas.</span></section> : <div className="scheduled-list">{items.map((item) => {
      const editable = item.status === 'active' || item.status === 'paused';
      return <article className="panel scheduled-card" key={item.id}>
        <div className="scheduled-card-top"><div><div className="eyebrow">{item.digits} CIFRAS · {item.drawName}</div><h2>N.º <span>{item.number}</span></h2><p>{dayLabel(item.daysOfWeek)} · {item.drawTime.slice(0, 5)}</p></div><span className={`status-badge status-${item.status}`}>{statusText[item.status] ?? 'Estado actualizado'}</span></div>
        <div className="scheduled-detail-grid"><div><small>Importe por jugada</small><strong>{money(item.amountCents)}</strong></div><div><small>Plan</small><strong>{item.planName ?? 'General'}</strong></div><div><small>Programada</small><strong>{dateTime(item.createdAt)}</strong></div><div><small>Versión</small><strong>{item.version}</strong></div></div>
        {editable && <div className="scheduled-actions"><button className="button button-outline" disabled={update.isPending} onClick={() => update.mutate({ id: item.id, status: item.status === 'active' ? 'paused' : 'active' })}>{item.status === 'active' ? <Pause size={15}/> : <Play size={15}/>} {item.status === 'active' ? 'Pausar' : 'Reactivar'}</button><button className="button button-danger-outline" disabled={update.isPending} onClick={() => update.mutate({ id: item.id, status: 'cancelled' })}><X size={15}/> Cancelar</button></div>}
        <details className="scheduled-history"><summary>Historial y ejecuciones · {item.history.length + item.runs.length}</summary>
          {item.runs.map((run) => <div className="scheduled-event" key={run.id}><strong>{run.outcome === 'executed' ? 'Jugada ejecutada' : 'No ejecutada · saldo insuficiente'}</strong><span>{new Date(`${run.drawDate}T12:00:00`).toLocaleDateString('es-EC', { dateStyle: 'medium' })} · {dateTime(run.runAt)}{run.orderId ? ` · Orden ${run.orderId.slice(0, 8)}` : ''}</span></div>)}
          {item.history.map((entry) => <div className="scheduled-event" key={entry.id}><strong>Cambio registrado{entry.reason ? ` · ${entry.reason}` : ''}</strong><span>{dateTime(entry.changedAt)}</span></div>)}
          {!item.runs.length && !item.history.length && <p className="scheduled-empty-history">Todavía no hay cambios ni ejecuciones.</p>}
        </details>
      </article>;
    })}</div>}
  </>;
}

function Heading({ action }: { action?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">AUTOMATIZACIÓN SEGURA</div><h1>Jugadas programadas</h1><p>Repite tus números en sorteos y días elegidos. Consulta cada cambio y resultado desde tu cuenta.</p></div>{action}</div>;
}
