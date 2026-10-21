import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Check, Clock3, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../services/http';
import type { ApiList } from '../../types/api';

type ReceivablePayment = { amountCents: string; receivedAt: string; receivedBy: string | null };
type Receivable = { id: string; debtorName: string; amountCents: string; collectedCents: string; remainingCents: string; status: string; dueDate: string | null; createdAt: string; clientName: string | null; clientPhone: string | null; drawName: string | null; drawDate: string | null; purchaseCode: string | null; payments: ReceivablePayment[] };
const usd = (cents: string) => `$${(Number(cents) / 100).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString('es-EC', { dateStyle: 'medium' });
function toCents(value: string) {
  const match = /^(\d{1,12})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return (BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')).toString();
}

export function ReceivablesPanel() {
  const client = useQueryClient();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [keys, setKeys] = useState<Record<string, string>>({});
  const query = useQuery({ queryKey: ['/api/admin/finance/receivables'], queryFn: ({ signal }) => getJson<ApiList<Receivable>>('/api/admin/finance/receivables', signal), retry: false });
  const payment = useMutation({
    mutationFn: ({ id, amountCents, idempotencyKey }: { id: string; amountCents: string; idempotencyKey: string }) => postJson(`/api/admin/finance/receivables/${id}/payments`, { amountCents, idempotencyKey }),
    onSuccess: (_result, variables) => { setAmounts((current) => ({ ...current, [variables.id]: '' })); setKeys((current) => { const next = { ...current }; delete next[variables.id]; return next; }); void client.invalidateQueries({ queryKey: ['/api/admin/finance/receivables'] }); void client.invalidateQueries({ queryKey: ['/api/admin/finance'] }); },
  });
  const submit = (event: FormEvent, receivable: Receivable) => {
    event.preventDefault();
    const amountCents = toCents(amounts[receivable.id] ?? '');
    if (!amountCents || BigInt(amountCents) > BigInt(receivable.remainingCents)) return;
    if (window.confirm(`Registrar el abono de ${usd(amountCents)} de ${receivable.debtorName}? El movimiento quedará en el historial contable.`)) {
      const idempotencyKey = keys[receivable.id] ?? globalThis.crypto.randomUUID();
      setKeys((current) => ({ ...current, [receivable.id]: idempotencyKey }));
      payment.mutate({ id: receivable.id, amountCents, idempotencyKey });
    }
  };
  return <section className="panel receivables-panel">
    <div className="panel-heading"><div><div className="eyebrow">CRÉDITO DE CONTRATAS</div><h2>Cuentas por cobrar</h2></div><button className="button button-outline" type="button" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={14}/>Actualizar</button></div>
    <p className="receivables-intro">Registra pagos totales o parciales. Cada abono queda asociado a su cuenta y genera el movimiento financiero correspondiente.</p>
    {payment.isError && <div className="form-notice error" role="alert">{payment.error.message}</div>}
    {query.isError ? <div className="form-notice error" role="alert">{query.error.message}</div> : query.isPending ? <div className="remote-state"><div className="loader"/>Cargando cuentas por cobrar…</div> : !query.data.items.length ? <div className="remote-state"><span className="state-icon"><Check size={18}/></span><strong>No hay saldos pendientes</strong><span>Las cuentas de crédito aparecerán aquí cuando se registre una venta de Contrata.</span></div> : <div className="receivable-list">{query.data.items.map((item) => {
      const entered = toCents(amounts[item.id] ?? '');
      const overBalance = Boolean(entered && BigInt(entered) > BigInt(item.remainingCents));
      return <article className="receivable-card" key={item.id}>
        <div className="receivable-title"><div><strong>{item.debtorName}</strong><span>{item.drawName ?? 'Contrata'}{item.drawDate ? ` · ${fmtDate(item.drawDate)}` : ''}{item.purchaseCode ? ` · ${item.purchaseCode}` : ''}</span><small>{item.clientPhone ?? 'Sin teléfono'} · Creada {fmtDate(item.createdAt.slice(0, 10))}{item.dueDate ? ` · Vence ${fmtDate(item.dueDate)}` : ''}</small></div><span className={`status-badge ${item.status === 'partial' ? 'pending' : ''}`}>{item.status === 'partial' ? 'Abono parcial' : 'Abierta'}</span></div>
        <div className="receivable-balance"><span>Total <strong>{usd(item.amountCents)}</strong></span><span>Abonado <strong>{usd(item.collectedCents)}</strong></span><span>Saldo <strong>{usd(item.remainingCents)}</strong></span></div>
        {item.payments.length > 0 && <details className="receivable-history"><summary><Clock3 size={13}/>Historial de abonos ({item.payments.length})</summary><div>{item.payments.map((entry, index) => <span key={`${entry.receivedAt}-${index}`}>{usd(entry.amountCents)} · {new Date(entry.receivedAt).toLocaleString('es-EC')} · {entry.receivedBy ?? 'Administración'}</span>)}</div></details>}
        <form className="receivable-payment-form" onSubmit={(event) => submit(event, item)}><label className="field"><span>Abono (USD)</span><input required inputMode="decimal" placeholder="0,00" value={amounts[item.id] ?? ''} onChange={(event) => { const value=event.target.value.replace(/[^\d.,]/g,''); setAmounts((current) => ({ ...current, [item.id]: value })); setKeys((current) => ({ ...current, [item.id]: globalThis.crypto.randomUUID() })); }}/></label><button className="button button-green" disabled={payment.isPending || !entered || overBalance}>{payment.isPending ? 'Registrando…' : <><Banknote size={14}/>Registrar abono</>}</button>{overBalance && <small className="input-error">El abono supera el saldo pendiente.</small>}</form>
      </article>;
    })}</div>}
  </section>;
}
