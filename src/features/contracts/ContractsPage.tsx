import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CalendarDays, Check, CircleDollarSign, PackageCheck, Plus, ReceiptText, Ticket } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { getJson, postJson } from '../../services/http';
import type { ApiList } from '../../types/api';

type DrawOption = { drawId: string; drawName: string; drawDays: number[]; digits: number; minCents: string; stepCents: string; plans: Array<{ id: string; name: string }> };
type ContractSlot = { id: string; sessionId: string; drawDate: string; drawsAt: string; closesAt: string; status: 'reserved' | 'sold' | 'cancelled'; canSell: boolean; orderId: string | null };
type Contract = { id: string; clientName: string; clientPhone: string | null; drawId: string; drawName: string; digits: number; number: string; planId: string | null; planName: string | null; amountCents: string; daysOfWeek: number[]; startDate: string; endDate: string | null; collection: string; status: string; sellerId: string; sellerName: string | null; slotCount: number; reservedCount: number; soldCount: number; receivableCents: string; collectedCents: string; slots: ContractSlot[] };
type ContractResponse = ApiList<Contract>;
const weekday = [{ id: 1, short: 'Lun' }, { id: 2, short: 'Mar' }, { id: 3, short: 'Mié' }, { id: 4, short: 'Jue' }, { id: 5, short: 'Vie' }, { id: 6, short: 'Sáb' }, { id: 7, short: 'Dom' }];
const usd = (value: string) => `$${(Number(value) / 100).toLocaleString('es-EC', { minimumFractionDigits: 2 })}`;
const fmtDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('es-EC', { dateStyle: 'medium' });

export function ContractsPage() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: { id: string; role: string } }>('/api/auth/me', signal), retry: false });
  const admin = auth.data?.user.role === 'admin';
  const contracts = useQuery({ queryKey: ['/api/contracts'], queryFn: ({ signal }) => getJson<ContractResponse>('/api/contracts', signal), enabled: ['admin', 'seller'].includes(auth.data?.user.role ?? ''), retry: false });
  const options = useQuery({ queryKey: ['/api/admin/contracts/options'], queryFn: ({ signal }) => getJson<{ sellers: Array<{ id: string; fullName: string }>; draws: DrawOption[] }>('/api/admin/contracts/options', signal), enabled: admin, retry: false });
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [sellerId, setSellerId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [drawId, setDrawId] = useState('');
  const [digits, setDigits] = useState(2);
  const [number, setNumber] = useState('');
  const [planId, setPlanId] = useState('');
  const [amount, setAmount] = useState('30.00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [startDate, setStartDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' }));
  const [endDate, setEndDate] = useState('');
  const [collection, setCollection] = useState('cash');
  const rows = options.data?.draws ?? [];
  const drawChoices = useMemo(() => [...new Map(rows.map((row) => [row.drawId, row])).values()], [rows]);
  const selected = rows.find((row) => row.drawId === drawId && row.digits === digits);
  const create = useMutation({
    mutationFn: () => postJson('/api/admin/contracts', { sellerId, clientName, clientPhone, drawId, digits, number, ...(planId ? { planId } : {}), amountCents: String(Math.round(Number(amount) * 100)), daysOfWeek: days, startDate, endDate: endDate || null, collection }),
    onSuccess: () => { setFormOpen(false); setClientName(''); setClientPhone(''); setNumber(''); setPlanId(''); void queryClient.invalidateQueries({ queryKey: ['/api/contracts'] }); },
  });
  const sell = useMutation({
    mutationFn: (slotId: string) => postJson(`/api/contracts/slots/${slotId}/sell`, { idempotencyKey: globalThis.crypto.randomUUID() }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['/api/contracts'] }),
  });
  const toggleDay = (id: number) => setDays((current) => current.includes(id) ? current.filter((day) => day !== id) : [...current, id].sort());
  const submit = (event: FormEvent) => { event.preventDefault(); create.mutate(); };

  if (auth.isPending) return <section className="panel remote-state"><div className="loader"/><span>Verificando acceso…</span></section>;
  if (!auth.data) return <><Header/><section className="panel account-panel"><div><h2>Inicia sesión para consultar contratas</h2><p>Las asignaciones comerciales requieren una cuenta autorizada.</p></div><NavLink className="button button-green" to="/acceso">Iniciar sesión</NavLink></section></>;
  if (!admin && auth.data.user.role !== 'seller') return <><Header/><section className="panel remote-state"><strong>Acceso exclusivo de vendedores y administración</strong></section></>;
  const items = contracts.data?.items ?? [];
  const totals = items.reduce((acc, contract) => ({ contracted: acc.contracted + contract.slotCount, sold: acc.sold + contract.soldCount, open: acc.open + contract.reservedCount, credit: acc.credit + Number(contract.receivableCents), collected: acc.collected + Number(contract.collectedCents) }), { contracted: 0, sold: 0, open: 0, credit: 0, collected: 0 });
  return <>
    <Header action={admin ? <button className="button button-green" onClick={() => setFormOpen((value) => !value)}><Plus size={16}/>{formOpen ? 'Cerrar' : 'Nueva contrata'}</button> : undefined}/>
    {contracts.isError && <div className="form-notice error" role="alert">{contracts.error.message}</div>}
    {create.isError && <div className="form-notice error" role="alert">{create.error.message}</div>}
    {sell.isError && <div className="form-notice error" role="alert">{sell.error.message}</div>}
    <div className="contract-stats">
      <Stat icon={<PackageCheck/>} label="Cupos contratados" value={totals.contracted.toLocaleString('es-EC')} detail="Reservados para el periodo"/>
      <Stat icon={<Ticket/>} label="Vendidos" value={totals.sold.toLocaleString('es-EC')} detail={`${totals.open} cupos disponibles`}/>
      <Stat icon={<Banknote/>} label="Cobrado" value={usd(String(totals.collected))} detail="Ingresos registrados"/>
      <Stat icon={<CircleDollarSign/>} label="Por cobrar" value={usd(String(totals.credit))} detail="Crédito autorizado"/>
    </div>
    <div className="contract-principle"><strong>Contratado ≠ Vendido ≠ Cobrado</strong><span>Cada cupo reservado se convierte en venta solo al generar su ticket; el crédito autorizado queda como cuenta por cobrar.</span></div>
    {formOpen && admin && <form className="panel contract-form" onSubmit={submit}>
      <div className="panel-heading"><div><div className="eyebrow">ASIGNACIÓN DE CUPOS</div><h2>Crear contrata</h2></div><ReceiptText size={20}/></div>
      {options.isError && <div className="form-notice error">{options.error.message}</div>}
      {options.isPending ? <div className="remote-state"><div className="loader"/><span>Cargando opciones…</span></div> : <>
        <div className="contract-fields">
          <Field label="Vendedor"><select required value={sellerId} onChange={(event) => setSellerId(event.target.value)}><option value="">Asignar a…</option>{options.data?.sellers.map((seller) => <option value={seller.id} key={seller.id}>{seller.fullName}</option>)}</select></Field>
          <Field label="Nombre del cliente"><input required minLength={2} maxLength={120} value={clientName} onChange={(event) => setClientName(event.target.value)}/></Field>
          <Field label="Teléfono del cliente"><input inputMode="tel" value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} placeholder="Opcional"/></Field>
          <Field label="Sorteo"><select required value={drawId} onChange={(event) => { const id = event.target.value; const first = rows.find((row) => row.drawId === id); setDrawId(id); setPlanId(''); if (first) { setDigits(first.digits); setDays(first.drawDays); setAmount((Number(first.minCents) / 100).toFixed(2)); } }}><option value="">Selecciona sorteo…</option>{drawChoices.map((draw) => <option value={draw.drawId} key={draw.drawId}>{draw.drawName}</option>)}</select></Field>
          <Field label="Modalidad"><select value={digits} onChange={(event) => { const row = rows.find((item) => item.drawId === drawId && item.digits === Number(event.target.value)); setDigits(Number(event.target.value)); setPlanId(''); if (row) { setDays(row.drawDays); setAmount((Number(row.minCents) / 100).toFixed(2)); } }}>{rows.filter((row) => row.drawId === drawId).map((row) => <option key={row.digits} value={row.digits}>{row.digits} cifras</option>)}</select></Field>
          <Field label="Número"><input required inputMode="numeric" maxLength={digits} value={number} onChange={(event) => setNumber(event.target.value.replace(/\D/g, '').slice(0, digits))}/></Field>
          <Field label="Plan de premios"><select value={planId} onChange={(event) => setPlanId(event.target.value)}><option value="">Plan general</option>{selected?.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></Field>
          <Field label="Importe por cupo (USD)"><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}/><small>{selected && `Mínimo ${usd(selected.minCents)} · paso ${usd(selected.stepCents)}`}</small></Field>
          <Field label="Forma de cobro"><select value={collection} onChange={(event) => setCollection(event.target.value)}><option value="cash">Efectivo al vender</option><option value="transfer">Transferencia</option><option value="credit">Crédito (autorizado por admin)</option></select></Field>
          <Field label="Fecha inicial"><input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)}/></Field>
          <Field label="Fecha final"><input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)}/><small>Dejar vacía para mantenerla indefinida.</small></Field>
        </div>
        <fieldset className="contract-weekdays"><legend>Días del sorteo</legend><div>{weekday.filter((day) => selected?.drawDays.includes(day.id)).map((day) => <label key={day.id} className={days.includes(day.id) ? 'selected' : ''}><input type="checkbox" checked={days.includes(day.id)} onChange={() => toggleDay(day.id)}/>{day.short}</label>)}</div></fieldset>
        {collection === 'credit' && <div className="contract-credit-warning">Al crear esta contrata, Administración autoriza el crédito y cada venta genera una cuenta por cobrar identificable.</div>}
        <div className="contract-submit"><span>Los cupos disponibles se generan desde las sesiones existentes.</span><button className="button button-green" disabled={create.isPending || !sellerId || !drawId || number.length !== digits || !days.length || Number(amount) <= 0}>{create.isPending ? 'Guardando…' : 'Crear y reservar cupos'}</button></div>
      </>}
    </form>}
    {contracts.isPending ? <section className="panel remote-state"><div className="loader"/><span>Cargando contratas…</span></section> : !items.length ? <section className="panel remote-state"><span className="state-icon"><PackageCheck size={20}/></span><strong>No hay contratas asignadas</strong><span>Las contratas y sus cupos aparecerán aquí cuando Administración te asigne una.</span></section> : <div className="contract-list">{items.map((contract) => <article className="panel contract-card" key={contract.id}>
      <div className="contract-card-heading"><div><div className="eyebrow">{contract.drawName} · {contract.digits} CIFRAS</div><h2>{contract.clientName} · <span>{contract.number}</span></h2><p>{contract.planName ?? 'Plan general'} · {weekday.filter((day) => contract.daysOfWeek.includes(day.id)).map((day) => day.short).join(', ')}</p></div><span className={`status-badge status-${contract.status}`}>{({active:'Activa',paused:'Pausada',cancelled:'Cancelada',finished:'Finalizada'} as Record<string,string>)[contract.status] ?? 'Estado actualizado'}</span></div>
      <div className="contract-card-metrics"><Metric label="Reservado" value={contract.slotCount}/><Metric label="Vendido" value={contract.soldCount}/><Metric label="Disponible" value={contract.reservedCount}/><Metric label="Precio / cupo" value={usd(contract.amountCents)}/></div>
      <div className="contract-collection"><span>Forma de cobro: <strong>{contract.collection}</strong></span>{admin && <span>Vendedor: <strong>{contract.sellerName ?? 'Sin asignar'}</strong></span>}<span>Periodo: <strong>{fmtDate(contract.startDate)}{contract.endDate ? ` – ${fmtDate(contract.endDate)}` : ' · sin fecha final'}</strong></span></div>
      {contract.collection === 'credit' && <div className="contract-credit-warning">Cuentas por cobrar: {usd(contract.receivableCents)} · recaudado: {usd(contract.collectedCents)}</div>}
      <div className="contract-slot-list"><strong>Detalle de cupos · {contract.slots.length}</strong>{contract.slots.length ? contract.slots.map((slot) => <div className="contract-slot" key={slot.id}><span><CalendarDays size={14}/>{fmtDate(slot.drawDate)}</span><span className={`slot-state ${slot.status}`}>{slot.status === 'reserved' ? slot.canSell ? 'Disponible' : 'Cierre vencido' : slot.status === 'sold' ? 'Vendido' : 'Cancelado'}</span>{slot.status === 'reserved' && !admin && slot.canSell && <button className="button button-outline" disabled={sell.isPending} onClick={() => sell.mutate(slot.id)}><Check size={14}/>{sell.isPending ? 'Procesando…' : 'Registrar venta'}</button>}</div>) : <small>Las próximas sesiones todavía no se han generado.</small>}</div>
    </article>)}</div>}
  </>;
}

function Header({ action }: { action?: React.ReactNode }) { return <div className="page-heading"><div><div className="eyebrow">RED DE VENTAS</div><h1>Contratas</h1><p>Controla cupos reservados, tickets vendidos y cobros con trazabilidad.</p></div>{action}</div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Stat({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) { return <article className="panel contract-stat">{icon}<span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div><small>{label}</small><strong>{value}</strong></div>; }
