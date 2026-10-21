import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Banknote, CircleCheck, RefreshCw, UploadCloud } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { getJson, postFormData } from '../../services/http';
import type { ApiList } from '../../types/api';
import './wallet.css';

interface BankAccount { id: string; bankName: string; holder: string; accountType: string; accountNumber: string }
interface RechargeRecord { id: string; amountCents: string; status: string; requestedAt: string; rejectionReason: string | null; correctionHint: string | null; bankAccountId: string; bankName: string | null; resubmittedFrom: string | null; referenceCode: string | null }
interface PaymentOptions { methods: Array<{ method: string; minCents: string; maxCents: string | null; helpText: string | null }>; bankAccounts: BankAccount[] }
const dollars = (cents: string) => {
  try { const v = BigInt(cents); return `$${new Intl.NumberFormat('es-EC').format(v / 100n)}.${(v % 100n).toString().padStart(2, '0')}`; }
  catch { return '—'; }
};
const date = (value: string) => new Date(value).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short' });
function parseCents(value: string) {
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return (BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')).toString();
}

export function RechargePanel() {
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: ['payment-options'], queryFn: ({ signal }) => getJson<PaymentOptions>('/api/payment-options', signal), retry: false });
  const history = useQuery({ queryKey: ['/api/wallet/recharges'], queryFn: ({ signal }) => getJson<ApiList<RechargeRecord>>('/api/wallet/recharges', signal), retry: false });
  const [amount, setAmount] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [resubmittedFrom, setResubmittedFrom] = useState<string | undefined>();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const method = options.data?.methods.find((item) => item.method === 'bank_transfer');
  const mutation = useMutation({
    mutationFn: (form: FormData) => postFormData<{ rechargeId: string; status: string; repeated: boolean }>('/api/wallet/recharges', form),
    onSuccess: async (result) => {
      setNotice(result.repeated ? 'Esta solicitud ya se había recibido; no se creó otra recarga.' : 'Comprobante enviado. El saldo se actualizará cuando Administración apruebe la recarga.');
      setAmount(''); setBankAccountId(''); setProof(null); setResubmittedFrom(undefined); setIdempotencyKey(crypto.randomUUID());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/wallet'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/wallet/recharges'] }),
      ]);
    },
    onError: (cause) => setError(cause.message),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice('');
    const cents = parseCents(amount);
    if (!cents || BigInt(cents) < 25n || !bankAccountId || !proof || !method) {
      setError('Ingresa un monto de al menos $0.25, selecciona una cuenta y adjunta el comprobante.'); return;
    }
    const data = new FormData();
    data.append('recharge', JSON.stringify({ amountCents: cents, bankAccountId, idempotencyKey, ...(resubmittedFrom ? { resubmittedFrom } : {}) }));
    data.append('proof', proof, proof.name);
    mutation.mutate(data);
  };
  const correctAndResubmit = (item: RechargeRecord) => {
    setAmount((BigInt(item.amountCents) / 100n).toString() + '.' + (BigInt(item.amountCents) % 100n).toString().padStart(2, '0'));
    setBankAccountId(item.bankAccountId ?? ''); setResubmittedFrom(item.id); setProof(null); setIdempotencyKey(crypto.randomUUID()); setNotice('Adjunta un comprobante corregido y vuelve a enviar la solicitud.'); setError('');
    document.getElementById('recharge-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const labels: Record<string, string> = { pending: 'Pendiente', in_review: 'En revisión', approved: 'Aprobada', rejected: 'Rechazada' };

  return <div className="recharge-layout">
    <section className="panel recharge-form-panel" id="recharge-form">
      <div className="panel-heading"><div><div className="eyebrow">RECARGA POR TRANSFERENCIA</div><h2>Agregar saldo</h2></div><Banknote size={20}/></div>
      <p className="recharge-explainer">El saldo no se acredita al enviar el comprobante. Administración revisará la transferencia y te notificará la decisión.</p>
      {method?.helpText && <p className="recharge-method-hint">{method.helpText}</p>}
      {!options.isPending && !options.isError && !method && <div className="form-notice error">Las recargas por transferencia están deshabilitadas en este momento.</div>}
      {notice && <div className="form-notice success" role="status"><CircleCheck size={16}/>{notice}</div>}
      {error && <div className="form-notice error" role="alert">{error}</div>}
      <form className="recharge-form" onSubmit={submit}>
        <label className="field"><span>Monto a recargar</span><div className="recharge-amount"><b>$</b><input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(event) => { setAmount(event.target.value.replace(/[^\d.,]/g, '').replace(',', '.').slice(0, 11)); setIdempotencyKey(crypto.randomUUID()); }} required/><small>USD</small></div>{method && <small>Mínimo {dollars(method.minCents)}{method.maxCents ? ` · Máximo ${dollars(method.maxCents)}` : ''}</small>}</label>
        <label className="field"><span>Cuenta bancaria de destino</span><select value={bankAccountId} onChange={(event) => { setBankAccountId(event.target.value); setIdempotencyKey(crypto.randomUUID()); }} required><option value="">Selecciona una cuenta…</option>{options.data?.bankAccounts.map((bank) => <option value={bank.id} key={bank.id}>{bank.bankName} · {bank.accountType} · {bank.accountNumber} · {bank.holder}</option>)}</select></label>
        {bankAccountId && options.data?.bankAccounts.find((bank) => bank.id === bankAccountId) && (() => { const bank = options.data.bankAccounts.find((item) => item.id === bankAccountId)!; return <div className="recharge-bank-card"><strong>{bank.bankName}</strong><span>{bank.holder} · {bank.accountType}</span><code>{bank.accountNumber}</code></div>; })()}
        <label className="field"><span>Comprobante <small>JPG, PNG o PDF · máximo 5 MB</small></span><span className="recharge-file"><UploadCloud size={17}/><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => { setProof(event.target.files?.[0] ?? null); setIdempotencyKey(crypto.randomUUID()); }} required/><span>{proof?.name ?? 'Selecciona un archivo'}</span></span></label>
        <button className="button button-green recharge-submit" type="submit" disabled={mutation.isPending || options.isPending || !method || !options.data?.bankAccounts.length}>{mutation.isPending ? 'Enviando comprobante…' : resubmittedFrom ? 'Corregir y reenviar' : 'Enviar solicitud'} <ArrowRight size={16}/></button>
      </form>
    </section>
    <section className="panel recharge-history">
      <div className="panel-heading"><div><div className="eyebrow">HISTORIAL</div><h2>Mis solicitudes</h2></div><RefreshCw size={18}/></div>
      {history.isPending && <div className="remote-state"><div className="loader"/><span>Cargando recargas…</span></div>}
      {history.isError && <div className="form-notice error">{history.error.message}</div>}
      {history.data && !history.data.items.length && <div className="remote-state"><strong>Sin solicitudes todavía</strong><span>Las recargas que envíes aparecerán aquí.</span></div>}
      {history.data?.items.map((item) => <article className="recharge-history-item" key={item.id}>
        <div className="recharge-history-head"><div><strong>{dollars(item.amountCents)}</strong><small>{item.bankName ?? 'Transferencia'} · {date(item.requestedAt)}</small></div><span className={`status-badge status-${item.status}`}>{labels[item.status] ?? 'Estado actualizado'}</span></div>
        {item.referenceCode && <small className="recharge-reference">Referencia: {item.referenceCode}</small>}
        {item.status === 'rejected' && <div className="recharge-rejection"><strong>{item.rejectionReason || 'Comprobante rechazado'}</strong>{item.correctionHint && <span>{item.correctionHint}</span>}<button className="text-link" type="button" onClick={() => correctAndResubmit(item)}>Corregir y reenviar <ArrowRight size={13}/></button></div>}
      </article>)}
    </section>
  </div>;
}
