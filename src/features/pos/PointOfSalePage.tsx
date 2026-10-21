import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { ArrowRight, Banknote, Check, Minus, Plus, ReceiptText, Ticket, Wallet } from 'lucide-react';
import { centsToUsd, dollarsToCents } from '../../domain/cart';
import { isValidPlayedNumber, normalizePlayedInput } from '../../domain/played-number';
import { getJson, postJson } from '../../services/http';
import type { ApiList, OpenSession } from '../../types/api';
import './pos.css';

type CartLine = { id: string; drawId: string; sessionId: string; drawName: string; drawDate: string; digits: 2 | 3 | 4; number: string; amountCents: string; planId?: string };
type SaleOrder = { id: string; purchaseCode: string; status: string; totalCents: string; createdAt: string; ticketCodes: string[] };
type RecentSale = { id: string; purchaseCode: string; buyerName: string; totalCents: string; status: string; createdAt: string; onCredit: boolean; tickets: Array<{ id: string; code: string; status: string; canVoid: boolean }> };
type Commission = { id: string; baseAmountCents: string; commissionCents: string; status: string; generatedAt: string; paidAt: string | null; drawName: string | null; digits: number | null };
type Buyer = { fullName: string; phone: string; email: string; adultConfirmed: boolean };

function dateTime(value: string) { return new Date(value).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short' }); }
function dollars(value: string) { return centsToUsd(value); }

export function PointOfSalePage() {
  const [sessionId, setSessionId] = useState('');
  const [digits, setDigits] = useState<2 | 3 | 4>(2);
  const [number, setNumber] = useState('00');
  const [amount, setAmount] = useState('1.00');
  const [planId, setPlanId] = useState('');
  const [buyer, setBuyer] = useState<Buyer>({ fullName: '', phone: '', email: '', adultConfirmed: false });
  const [termsConfirmed, setTermsConfirmed] = useState(false);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [receipt, setReceipt] = useState<SaleOrder | null>(null);
  const [voidingTicket, setVoidingTicket] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const queryClient = useQueryClient();
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: { role: string; permissions: string[] } }>('/api/auth/me', signal), retry: false });
  const sessions = useQuery({ queryKey: ['sessions', 'open'], queryFn: ({ signal }) => getJson<ApiList<OpenSession>>('/api/sessions/open', signal), refetchInterval: 30_000 });
  const sales = useQuery({ queryKey: ['/api/pos/sales'], queryFn: ({ signal }) => getJson<ApiList<RecentSale>>('/api/pos/sales', signal), enabled: ['worker', 'seller'].includes(auth.data?.user.role ?? '') });
  const commissions = useQuery({ queryKey: ['/api/pos/commissions'], queryFn: ({ signal }) => getJson<ApiList<Commission>>('/api/pos/commissions', signal), enabled: auth.data?.user.role === 'seller' });
  const voidOwnTicket = useMutation({
    mutationFn: (ticketId: string) => postJson(`/api/pos/tickets/${ticketId}/void`, { reason: voidReason.trim() }),
    onSuccess: async () => { setVoidingTicket(null); setVoidReason(''); await queryClient.invalidateQueries({ queryKey: ['/api/pos/sales'] }); },
  });
  const selected = sessions.data?.items.find((item) => item.id === sessionId);
  const modality = selected?.modalities.find((item) => item.digits === digits);
  const plans = selected?.plans.filter((item) => item.digits === digits) ?? [];
  const selectedPlan = plans.find((item) => item.id === planId);
  const amountCents = dollarsToCents(amount);
  const totalCents = useMemo(() => lines.reduce((sum, line) => sum + BigInt(line.amountCents), 0n).toString(), [lines]);
  const canAdd = Boolean(selected && modality && isValidPlayedNumber(number, digits) && amountCents && BigInt(amountCents) >= BigInt(modality.minCents) && BigInt(amountCents) % BigInt(modality.stepCents) === 0n && plans.length > 0 && (plans.length === 1 || selectedPlan));

  useEffect(() => {
    const available = sessions.data?.items ?? [];
    if (available.length && !available.some((item) => item.id === sessionId)) {
      setSessionId(available[0].id);
      const first = available[0].modalities[0];
      if (first) { setDigits(first.digits); setNumber('0'.repeat(first.digits)); }
    }
  }, [sessions.data, sessionId]);
  useEffect(() => {
    if (selected && !selected.modalities.some((item) => item.digits === digits)) {
      const first = selected.modalities[0];
      if (first) { setDigits(first.digits); setNumber('0'.repeat(first.digits)); }
    }
  }, [selected, digits]);
  useEffect(() => {
    if (plans.length === 1) setPlanId(plans[0].id);
    else if (!plans.some((item) => item.id === planId)) setPlanId('');
  }, [plans, planId]);

  const sale = useMutation({
    mutationFn: (body: { buyer: Buyer; termsConfirmed: true; items: CartLine[]; idempotencyKey: string }) => postJson<{ order: SaleOrder }>('/api/pos/orders', {
      buyer: body.buyer, termsConfirmed: body.termsConfirmed,
      items: body.items.map(({ id: _id, drawName: _name, drawDate: _date, ...item }) => item),
      idempotencyKey: body.idempotencyKey,
    }),
    onSuccess: async (result) => {
      setReceipt(result.order); setLines([]); setBuyer({ fullName: '', phone: '', email: '', adultConfirmed: false }); setTermsConfirmed(false);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['/api/pos/sales'] }), queryClient.invalidateQueries({ queryKey: ['/api/pos/commissions'] }), queryClient.invalidateQueries({ queryKey: ['sessions'] })]);
    },
  });

  function addLine() {
    if (!canAdd || !selected || !amountCents) return;
    const line: CartLine = { id: globalThis.crypto.randomUUID(), drawId: selected.drawId, sessionId: selected.id, drawName: selected.drawName, drawDate: selected.drawDate, digits, number, amountCents, ...(selectedPlan ? { planId: selectedPlan.id } : plans.length === 1 ? { planId: plans[0].id } : {}) };
    setLines((current) => [...current, line]); setNumber('0'.repeat(digits));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!lines.length || buyer.fullName.trim().length < 3 || buyer.phone.trim().length < 7 || !buyer.adultConfirmed || !termsConfirmed || sale.isPending) return;
    sale.mutate({ buyer: { ...buyer, fullName: buyer.fullName.trim(), phone: buyer.phone.trim(), email: buyer.email.trim() }, termsConfirmed: true, items: lines, idempotencyKey: globalThis.crypto.randomUUID() });
  }

  if (auth.isPending) return <section className="panel remote-state"><div className="loader"/><span>Verificando permisos del Punto de Venta…</span></section>;
  if (!auth.data) return <section className="panel remote-state"><strong>Inicia sesión</strong><span>El Punto de Venta requiere una cuenta de trabajador o vendedor.</span></section>;
  if (!['worker', 'seller'].includes(auth.data.user.role)) return <section className="panel remote-state"><strong>Acceso restringido</strong><span>Esta sección está disponible para personal autorizado.</span></section>;

  return <>
    <div className="page-heading"><div><div className="eyebrow">VENTA CON TRAZABILIDAD</div><h1>Punto de Venta</h1><p>Registra el pago recibido en caja. El sistema valida horario, modalidad, plan y cupo antes de emitir el ticket.</p></div></div>
    {receipt && <section className="panel pos-receipt" role="status"><span className="order-success-icon"><Check size={22}/></span><div><div className="eyebrow">VENTA REGISTRADA · {receipt.purchaseCode}</div><strong>{dollars(receipt.totalCents)} · {receipt.ticketCodes.length} ticket(s)</strong><small>{receipt.ticketCodes.length ? `Códigos: ${receipt.ticketCodes.join(', ')}` : 'La venta fue registrada; revisa el estado antes de entregar el comprobante.'}</small></div><button type="button" className="text-link" onClick={() => setReceipt(null)}>Cerrar</button></section>}
    {sale.isError && <div className="form-notice error" role="alert">{sale.error.message}</div>}
    {sessions.isPending ? <section className="panel remote-state"><div className="loader"/><span>Consultando sesiones abiertas…</span></section> : sessions.isError ? <section className="panel remote-state"><strong>No pudimos consultar los sorteos</strong><span>{sessions.error.message}</span><button className="text-link" type="button" onClick={() => void sessions.refetch()}>Intentar de nuevo <ArrowRight size={15}/></button></section> : !sessions.data?.items.length ? <section className="panel remote-state"><strong>No hay sesiones abiertas</strong><span>Cuando haya un sorteo abierto podrás registrar ventas aquí.</span></section> : <div className="pos-layout">
      <div className="pos-main">
        <section className="panel pos-entry"><div className="panel-heading"><div><div className="eyebrow">NUEVA VENTA</div><h2>Arma la jugada</h2></div><span className="live-label"><i/> VALIDACIÓN EN SERVIDOR</span></div>
          <div className="pos-fields">
            <label className="field"><span>Sorteo y sesión</span><select value={sessionId} onChange={(event) => { const next = sessions.data!.items.find((item) => item.id === event.target.value); setSessionId(event.target.value); if (next?.modalities[0]) { setDigits(next.modalities[0].digits); setNumber('0'.repeat(next.modalities[0].digits)); } }}><option value="">Selecciona un sorteo</option>{sessions.data.items.map((item) => <option key={item.id} value={item.id}>{item.drawName} · {new Date(item.drawsAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short' })}</option>)}</select></label>
            <label className="field"><span>Modalidad</span><select value={digits} onChange={(event) => { const value = Number(event.target.value) as 2 | 3 | 4; setDigits(value); setNumber('0'.repeat(value)); }} disabled={!selected}>{(selected?.modalities ?? []).map((item) => <option key={item.digits} value={item.digits}>{item.digits} cifras</option>)}</select></label>
            <label className="field"><span>Número</span><input className="played-number" inputMode="numeric" maxLength={digits} value={number} onChange={(event) => setNumber(normalizePlayedInput(event.target.value, digits))}/><small>Conserva los ceros iniciales.</small></label>
            <label className="field"><span>Plan de premios</span><select value={planId} onChange={(event) => setPlanId(event.target.value)} disabled={plans.length < 2}><option value="">{plans.length === 1 ? plans[0].name : plans.length ? 'Selecciona un plan' : 'No hay plan activo'}</option>{plans.length > 1 && plans.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="field"><span>Valor jugado (USD)</span><input type="number" inputMode="decimal" min={modality ? Number(modality.minCents) / 100 : 0.25} step={modality ? Number(modality.stepCents) / 100 : 0.25} value={amount} onChange={(event) => setAmount(event.target.value)}/><small>{modality ? `Mínimo ${centsToUsd(modality.minCents)} · pasos de ${centsToUsd(modality.stepCents)}` : 'El valor se valida al registrar.'}</small></label>
          </div>
          <button className="button button-green add-line" type="button" disabled={!canAdd} onClick={addLine}><Plus size={17}/> Agregar jugada</button>
        </section>
        <section className="panel pos-cart"><div className="panel-heading"><div><div className="eyebrow">RESUMEN</div><h2>Venta actual <span className="cart-count">{lines.length}</span></h2></div>{lines.length > 0 && <button type="button" className="text-link" onClick={() => setLines([])}>Vaciar</button>}</div>
          {!lines.length ? <div className="cart-empty"><Ticket size={20}/><span>Agrega una o más jugadas para registrar la venta.</span></div> : <><div className="cart-lines">{lines.map((line) => <article className="cart-line" key={line.id}><div className="cart-line-number">{line.number}<small>{line.digits} CIFRAS</small></div><div className="cart-line-info"><strong>{line.drawName}</strong><span>{line.drawDate} · {line.planId ? 'Plan seleccionado' : 'Plan activo'}</span></div><strong className="cart-line-amount">{dollars(line.amountCents)}</strong><button className="icon-button cart-remove" type="button" aria-label={`Quitar número ${line.number}`} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}><Minus size={15}/></button></article>)}</div><div className="cart-total"><span>Total a cobrar en caja</span><strong>{dollars(totalCents)}</strong></div></>}
        </section>
      </div>
      <aside className="panel pos-checkout"><div className="eyebrow">DATOS DEL CLIENTE</div><h2>Registrar en caja</h2><p className="checkout-hint">Se emitirá el ticket al registrar el efectivo. Entrega el código únicamente después de confirmar el pago recibido.</p><form className="checkout-form" onSubmit={submit}>
        <label className="field"><span>Nombre completo</span><input autoComplete="name" value={buyer.fullName} onChange={(event) => setBuyer((value) => ({ ...value, fullName: event.target.value }))} minLength={3} required/></label>
        <label className="field"><span>Teléfono</span><input type="tel" inputMode="tel" autoComplete="tel" value={buyer.phone} onChange={(event) => setBuyer((value) => ({ ...value, phone: event.target.value }))} minLength={7} required/></label>
        <label className="field"><span>Correo electrónico <small>Opcional</small></span><input type="email" autoComplete="email" value={buyer.email} onChange={(event) => setBuyer((value) => ({ ...value, email: event.target.value }))}/></label>
        <label className="check-row"><input type="checkbox" checked={buyer.adultConfirmed} onChange={(event) => setBuyer((value) => ({ ...value, adultConfirmed: event.target.checked }))} required/><span>El cliente confirma que es mayor de 18 años.</span></label>
        <label className="check-row"><input type="checkbox" checked={termsConfirmed} onChange={(event) => setTermsConfirmed(event.target.checked)} required/><span>El cliente revisó y confirmó las jugadas y sus términos.</span></label>
        <div className="checkout-total"><span>Total a cobrar en caja</span><strong>{dollars(totalCents)}</strong></div>
        <button type="submit" className="button button-green checkout-submit" disabled={!lines.length || buyer.fullName.trim().length < 3 || buyer.phone.trim().length < 7 || !buyer.adultConfirmed || !termsConfirmed || sale.isPending}>{sale.isPending ? 'Registrando…' : 'Confirmar pago recibido'} <Banknote size={17}/></button>
        <div className="secure-note checkout-secure"><Wallet size={15}/><span>La operación queda auditada; el cupo y cierre los verifica PostgreSQL.</span></div>
      </form></aside>
    </div>}
    <section className="panel pos-sales"><div className="panel-heading"><div><div className="eyebrow">TU ACTIVIDAD</div><h2>Ventas recientes</h2></div><button className="text-link" type="button" onClick={() => void sales.refetch()}>Actualizar <ArrowRight size={14}/></button></div>
      {sales.isPending ? <div className="remote-state"><div className="loader"/><span>Cargando ventas…</span></div> : sales.isError ? <div className="remote-state"><strong>No pudimos cargar las ventas</strong><span>{sales.error.message}</span></div> : !sales.data?.items.length ? <div className="remote-state"><span className="state-icon"><ReceiptText size={18}/></span><strong>Aún no hay ventas registradas</strong><span>Tus operaciones aparecerán aquí después de registrarlas.</span></div> : <div className="pos-sales-list">{sales.data.items.map((item) => <article className="pos-sale-row" key={item.id}><div><strong>{item.purchaseCode} · {item.buyerName}</strong><small>{dateTime(item.createdAt)}</small>{item.tickets.map((ticket) => <div className="pos-sale-ticket" key={ticket.id}><span>Ticket {ticket.code} · {ticket.status === 'active' ? 'Activo' : ticket.status === 'voided' ? 'Anulado' : 'Estado no disponible'}</span><NavLink className="text-link" to={`/verificar/${ticket.code}`}>Ver ticket y código QR</NavLink>{ticket.canVoid && auth.data.user.permissions.includes('ticket.void_own') && (voidingTicket === ticket.id ? <form className="pos-ticket-void-form" onSubmit={(event) => { event.preventDefault(); voidOwnTicket.mutate(ticket.id); }}><label className="field"><span>Motivo de anulación</span><input minLength={5} maxLength={500} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} required/></label><button className="button button-danger-outline" type="submit" disabled={voidOwnTicket.isPending || voidReason.trim().length < 5}>{voidOwnTicket.isPending ? 'Anulando…' : 'Confirmar'}</button><button className="text-link" type="button" onClick={() => { setVoidingTicket(null); setVoidReason(''); }}>Cancelar</button></form> : <button className="text-link" type="button" onClick={() => { setVoidingTicket(ticket.id); voidOwnTicket.reset(); }}>Anular venta propia</button>)}</div>)}{voidOwnTicket.isError && voidingTicket && item.tickets.some((ticket) => ticket.id === voidingTicket) && <span className="form-notice error" role="alert">{voidOwnTicket.error.message}</span>}</div><span className={`status-badge status-${item.status}`}>{({pending_review:'En revisión',approved:'Aprobada',rejected:'Rechazada',cancelled:'Cancelada',expired:'Vencida',refunded:'Reembolsada'} as Record<string,string>)[item.status] ?? 'Estado actualizado'}</span><strong>{dollars(item.totalCents)}</strong></article>)}</div>}
    </section>
    {auth.data.user.role === 'seller' && <section className="panel pos-sales"><div className="panel-heading"><div><div className="eyebrow">LIQUIDACIÓN</div><h2>Mis comisiones</h2></div><span className="eyebrow">Solo tus ventas aprobadas</span></div>{commissions.isPending ? <div className="remote-state"><div className="loader"/><span>Consultando comisiones…</span></div> : commissions.isError ? <div className="remote-state"><strong>No pudimos cargar las comisiones</strong><span>{commissions.error.message}</span></div> : !commissions.data?.items.length ? <div className="remote-state"><strong>Sin comisiones registradas</strong><span>Las comisiones aparecerán cuando una venta cumpla las reglas configuradas.</span></div> : <div className="pos-sales-list">{commissions.data.items.map((item) => <article className="pos-sale-row" key={item.id}><div><strong>{item.drawName ?? 'Venta'}{item.digits ? ` · ${item.digits} cifras` : ''}</strong><small>{dateTime(item.generatedAt)} · {item.status === 'paid' ? `Pagada ${item.paidAt ? dateTime(item.paidAt) : ''}` : ({generated:'Generada',void:'Anulada'} as Record<string,string>)[item.status] ?? 'Estado actualizado'}</small></div><span>{dollars(item.baseAmountCents)} base</span><strong>{dollars(item.commissionCents)}</strong></article>)}</div>}</section>}
  </>;
}

