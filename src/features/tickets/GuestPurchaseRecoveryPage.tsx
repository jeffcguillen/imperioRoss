import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Search, ShieldCheck, Ticket } from 'lucide-react';
import { Link } from 'react-router-dom';
import { postJson } from '../../services/http';
import './tickets.css';

type RecoveredItem = { ticketCode: string | null; ticketStatus: string | null; drawName: string; drawDate: string; digits: number; number: string; amountCents: string; itemStatus: string };
type RecoveredPurchase = { id: string; purchaseCode: string; status: string; totalCents: string; createdAt: string; paymentMethod: string; items: RecoveredItem[] };
const money = (cents: string) => { try { const value = BigInt(cents); return `$${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`; } catch { return '—'; } };
const codePattern = /^(?:#\d{6}|RF-\d{4,10}|[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8})$/;

export function GuestPurchaseRecoveryPage() {
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'lookup' | 'verify'>('lookup');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [purchase, setPurchase] = useState<RecoveredPurchase | null>(null);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setFeedback('');
    const normalized = code.trim().toUpperCase();
    if (!codePattern.test(normalized) || phone.trim().length < 7) { setError('Ingresa el código de compra o ticket y el teléfono utilizado al comprar.'); return; }
    setBusy(true);
    try {
      const result = await postJson<{ accepted: boolean; message: string }>('/api/guest-purchases/recovery/start', { code: normalized, phone: phone.trim() });
      setCode(normalized); setFeedback(result.message); setStep('verify');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos iniciar la consulta.'); }
    finally { setBusy(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const result = await postJson<{ purchase: RecoveredPurchase }>('/api/guest-purchases/recovery/verify', { code: code.trim().toUpperCase(), phone: phone.trim(), otp });
      setPurchase(result.purchase);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos verificar los datos ingresados.'); }
    finally { setBusy(false); }
  }

  function reset() { setCode(''); setPhone(''); setOtp(''); setStep('lookup'); setFeedback(''); setError(''); setPurchase(null); }

  return <main className="ticket-verify-page guest-recovery-page">
    <Link to="/acceso" className="ticket-back"><ArrowLeft size={16}/> Volver al acceso</Link>
    <header className="ticket-verify-brand"><Ticket size={20}/><span>EL IMPERIO DE ROSS</span></header>
    <section className="panel ticket-verify-card guest-recovery-card">
      <div className="eyebrow">COMPRA COMO INVITADO</div>
      {!purchase ? <>
        <h1>Recupera tu compra</h1>
        <p className="guest-recovery-intro">Consulta el estado de tu compra con el código y el teléfono que registraste. No mostraremos datos personales.</p>
        {step === 'lookup' ? <form className="guest-recovery-form" onSubmit={start}>
          <label className="field"><span>Código de compra o ticket</span><input className="text-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="#000123 o ABCD2345" maxLength={24} autoComplete="off" required/></label>
          <label className="field"><span>Teléfono de la compra</span><input className="text-input" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="099 000 0000" inputMode="tel" autoComplete="tel" maxLength={30} required/></label>
          {error && <p className="form-notice error" role="alert">{error}</p>}
          <button className="button button-gold" type="submit" disabled={busy}>{busy ? 'Verificando datos…' : 'Continuar'} <ArrowRight size={16}/></button>
          <p className="coming-note">Para proteger tu compra, se requiere confirmar ambos datos.</p>
        </form> : <form className="guest-recovery-form" onSubmit={verify}>
          <div className="form-notice success" role="status">{feedback}</div>
          {import.meta.env.DEV && <p className="coming-note guest-demo-note">Modo local de demostración: usa el código 123456.</p>}
          <label className="field"><span>Código de verificación</span><input className="text-input guest-otp-input" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required/></label>
          {error && <p className="form-notice error" role="alert">{error}</p>}
          <button className="button button-gold" type="submit" disabled={busy || otp.length !== 6}>{busy ? 'Validando…' : 'Consultar compra'} <Search size={16}/></button>
          <button className="text-link guest-retry" type="button" onClick={reset}>Usar otros datos</button>
        </form>}
      </> : <>
        <div className="guest-recovered-heading"><CheckCircle2 size={25}/><div><h1>Compra localizada</h1><p>{purchase.purchaseCode} · {new Date(purchase.createdAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short' })}</p></div></div>
        <div className="ticket-verify-details"><span>Estado de compra</span><strong>{purchase.status}</strong><span>Total</span><strong>{money(purchase.totalCents)}</strong></div>
        {purchase.items.length ? <ol className="ticket-verify-lines guest-recovered-lines">{purchase.items.map((item, index) => <li key={`${purchase.id}-${index}`}><div><strong>{item.number} · {item.digits} cifras</strong><small>{item.drawName} · {new Date(`${item.drawDate}T12:00:00`).toLocaleDateString('es-EC', { dateStyle: 'medium' })}</small>{item.ticketCode && <Link className="text-link" to={`/verificar/${item.ticketCode}`}>Ver ticket {item.ticketCode} <ArrowRight size={13}/></Link>}</div><span>{money(item.amountCents)}</span></li>)}</ol> : <p className="coming-note">Los tickets se mostrarán aquí cuando la compra sea aprobada y emitida.</p>}
        <p className="guest-recovery-privacy"><ShieldCheck size={15}/> No se consultó ni mostró el teléfono, correo o documento del comprador.</p>
        <button className="button button-outline" type="button" onClick={reset}>Consultar otra compra</button>
      </>}
    </section>
    <p className="ticket-verify-privacy">La consulta está limitada a compras de invitado y requiere validar el código junto con el teléfono.</p>
  </main>;
}
