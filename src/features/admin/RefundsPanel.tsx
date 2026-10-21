import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, RotateCcw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { getJson, postJson } from '../../services/http';
import './refunds-panel.css';

type Refund = { id: string; paymentId: string; orderId: string | null; ticketId: string | null; reason: string; amountCents: string; status: string; notes: string | null; createdAt: string; paymentMethod: string; purchaseCode: string | null; buyerName: string | null; ticketCode: string | null };
const amount = (cents: string) => `$${(BigInt(cents) / 100n).toString()}.${(BigInt(cents) % 100n).toString().padStart(2, '0')}`;
const reasonLabels: Record<string, string> = { out_of_hours: 'Pago fuera de horario', duplicate_payment: 'Pago duplicado', technical_error: 'Error técnico', operation_not_executed: 'Operación no ejecutada', other_authorized: 'Otro motivo autorizado' };
type RefundReason = 'duplicate_payment' | 'technical_error' | 'operation_not_executed' | 'other_authorized';
function toCents(amount: string) {
  const match = /^(\d{1,10})(?:[.,](\d{1,2}))?$/.exec(amount.trim());
  return match ? `${BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')}` : null;
}

export function RefundsPanel() {
  const cache = useQueryClient();
  const [methods, setMethods] = useState<Record<string, 'bank_transfer' | 'cash' | 'other'>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [purchaseCode, setPurchaseCode] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState<RefundReason>('other_authorized');
  const [refundNotes, setRefundNotes] = useState('');
  const refunds = useQuery({ queryKey: ['/api/admin/finance/refunds'], queryFn: ({ signal }) => getJson<{ items: Refund[] }>('/api/admin/finance/refunds', signal), retry: false });
  const create = useMutation({
    mutationFn: () => postJson<{ refundId: string; status: string }>('/api/admin/finance/refunds', { purchaseCode: purchaseCode.trim().toUpperCase(), amountCents: toCents(refundAmount), reason: refundReason, notes: refundNotes.trim() }),
    onSuccess: async () => { setPurchaseCode(''); setRefundAmount(''); setRefundNotes(''); await cache.invalidateQueries({ queryKey: ['/api/admin/finance/refunds'] }); },
  });
  const complete = useMutation({
    mutationFn: (refund: Refund) => postJson(`/api/admin/finance/refunds/${refund.id}/complete`, refund.paymentMethod === 'wallet'
      ? {}
      : { method: methods[refund.id] ?? 'bank_transfer', reference: references[refund.id]?.trim() ?? '' }),
    onSuccess: async () => { await cache.invalidateQueries({ queryKey: ['/api/admin/finance/refunds'] }); await cache.invalidateQueries({ queryKey: ['/api/admin/finance'] }); },
  });

  return <section className="panel refunds-panel">
    <div className="panel-heading"><div><div className="eyebrow">DEVOLUCIONES Y SOLICITUDES</div><h2>Reembolsos</h2></div><RotateCcw size={19}/></div>
    <p className="refunds-note"><ShieldCheck size={15}/> Crea una solicitud parcial o total. La devolución a billetera se acredita al resolverla; los pagos externos deben devolverse manualmente antes de confirmar su referencia.</p>
    <form className="refund-create-form" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
      <div className="eyebrow">NUEVA SOLICITUD</div>
      <label className="field"><span>Código de compra</span><input value={purchaseCode} onChange={(event) => setPurchaseCode(event.target.value.toUpperCase())} placeholder="#000123" maxLength={13} required/></label>
      <label className="field"><span>Importe a devolver (USD)</span><input value={refundAmount} onChange={(event) => setRefundAmount(event.target.value.replace(/[^\d.,]/g, '').slice(0, 13))} inputMode="decimal" placeholder="0.00" required/></label>
      <label className="field"><span>Motivo</span><select value={refundReason} onChange={(event) => setRefundReason(event.target.value as RefundReason)}><option value="duplicate_payment">Pago duplicado</option><option value="technical_error">Error técnico</option><option value="operation_not_executed">Operación no ejecutada</option><option value="other_authorized">Otro motivo autorizado</option></select></label>
      <label className="field refund-notes-field"><span>Nota (opcional)</span><input value={refundNotes} onChange={(event) => setRefundNotes(event.target.value)} maxLength={500} placeholder="Contexto para la revisión"/></label>
      {create.isError && <div className="form-notice error" role="alert">No se pudo crear la solicitud: {create.error.message}</div>}
      {create.isSuccess && <div className="form-notice success" role="status">Solicitud creada y agregada a la cola pendiente.</div>}
      <button className="button button-gold" type="submit" disabled={create.isPending || !purchaseCode.trim() || !toCents(refundAmount) || BigInt(toCents(refundAmount) ?? '0') < 25n}>{create.isPending ? 'Creando solicitud…' : 'Solicitar reembolso'} <ArrowRight size={15}/></button>
    </form>
    {refunds.isError && <div className="form-notice error" role="alert">{refunds.error.message}</div>}
    {complete.isError && <div className="form-notice error" role="alert">No se pudo completar el reembolso: {complete.error.message}</div>}
    {refunds.isPending ? <div className="remote-state"><div className="loader"/><span>Cargando reembolsos pendientes…</span></div>
      : refunds.data?.items.length ? <div className="refund-list">{refunds.data.items.map((refund) => <article className="refund-row" key={refund.id}>
        <div className="refund-row-main"><div><span className="eyebrow">{reasonLabels[refund.reason] ?? refund.reason}</span><strong>{refund.purchaseCode ?? 'Sin compra asociada'}{refund.ticketCode ? ` · Ticket ${refund.ticketCode}` : ''}</strong><small>{refund.buyerName ?? 'Cliente'} · {new Date(refund.createdAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short' })}</small><small>{refund.notes ?? 'Sin nota adicional'} · Pago original: {refund.paymentMethod}</small></div><strong className="refund-amount">{amount(refund.amountCents)}</strong></div>
        {refund.paymentMethod === 'wallet' ? <button type="button" className="button button-green" disabled={complete.isPending} onClick={() => complete.mutate(refund)}>Acreditar a billetera <ArrowRight size={15}/></button>
          : <div className="refund-completion"><label className="field"><span>Método de devolución</span><select value={methods[refund.id] ?? 'bank_transfer'} onChange={(event) => setMethods((current) => ({ ...current, [refund.id]: event.target.value as 'bank_transfer' | 'cash' | 'other' }))}><option value="bank_transfer">Transferencia manual</option><option value="cash">Efectivo</option><option value="other">Otro</option></select></label><label className="field"><span>Referencia del comprobante</span><input value={references[refund.id] ?? ''} onChange={(event) => setReferences((current) => ({ ...current, [refund.id]: event.target.value }))} minLength={3} maxLength={200} placeholder="Código o referencia verificable"/></label><button type="button" className="button button-green" disabled={complete.isPending || (references[refund.id]?.trim().length ?? 0) < 3} onClick={() => complete.mutate(refund)}>Confirmar devolución realizada <ArrowRight size={15}/></button></div>}
      </article>)}</div> : <div className="remote-state"><strong>No hay reembolsos pendientes</strong><span>Las devoluciones justificadas aparecerán aquí para su resolución.</span></div>}
  </section>;
}
