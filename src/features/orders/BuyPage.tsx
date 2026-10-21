import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Banknote, Check, Clock3, Clover, Minus, Plus, RefreshCw, ShieldCheck, Trash2, Wallet } from 'lucide-react';
import { centsToUsd, dollarsToCents, loadCartDraft, newCartKey, saveCartDraft, totalCartCents, type DraftCartLine } from '../../domain/cart';
import { isValidPlayedNumber, normalizePlayedInput } from '../../domain/played-number';
import { getJson, postFormData } from '../../services/http';
import type { ApiList, OpenSession } from '../../types/api';
import { TenantLogo } from '../../tenants/TenantProvider';
import './orders.css';

interface PaymentOptions {
  methods: Array<{ method: 'wallet' | 'bank_transfer'; minCents: string; maxCents: string | null; helpText: string | null }>;
  bankAccounts: Array<{ id: string; bankName: string; holder: string; accountType: string; accountNumber: string }>;
}
interface BuyerDraft { fullName: string; phone: string; email: string; document: string; adultConfirmed: boolean; termsAccepted: boolean }
interface OrderResponse { order: { id: string; purchaseCode: string; status: string; totalCents: string; paymentId: string; referenceCode: string; method: string } }
interface AuthResponse { user: { fullName: string; phone: string; email: string | null } }
interface RepeatPlayResponse { items: Array<{ drawId: string; digits: 2 | 3 | 4; number: string; amountCents: string; planId: string }> }

function moneyInput(cents: string) {
  const amount = BigInt(cents);
  const dollars = amount / 100n;
  const fraction = amount % 100n;
  return fraction === 0n ? dollars.toString() : `${dollars}.${fraction.toString().padStart(2, '0')}`;
}

export function BuyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repeatTicketId] = useState(() => searchParams.get('repeatTicketId') ?? '');
  const initialDigitsValue = Number(searchParams.get('digits'));
  const initialDigits: 2 | 3 | 4 = initialDigitsValue === 3 || initialDigitsValue === 4 ? initialDigitsValue : 2;
  const initialSessionId = searchParams.get('sessionId') ?? '';
  const initialNumber = searchParams.get('number') ?? '';
  const prefilledNumber = /^\d+$/.test(initialNumber) && initialNumber.length === initialDigits;
  const [draft, setDraft] = useState(loadCartDraft);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [digits, setDigits] = useState<2 | 3 | 4>(initialDigits);
  const [number, setNumber] = useState(prefilledNumber ? initialNumber : '0'.repeat(initialDigits));
  const [isFavoritePrefill, setIsFavoritePrefill] = useState(prefilledNumber);
  const [amount, setAmount] = useState('1');
  const [planId, setPlanId] = useState('');
  const [method, setMethod] = useState<'wallet' | 'bank_transfer' | ''>('');
  const [bankId, setBankId] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState('');
  const [buyer, setBuyer] = useState<BuyerDraft>({ fullName: '', phone: '', email: '', document: '', adultConfirmed: false, termsAccepted: false });
  const [completed, setCompleted] = useState<OrderResponse['order'] | null>(null);
  const [repeatNotice, setRepeatNotice] = useState('');
  const repeatProcessed = useRef(false);
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions', 'open'], queryFn: ({ signal }) => getJson<ApiList<OpenSession>>('/api/sessions/open', signal), refetchInterval: 30_000 });
  const options = useQuery({ queryKey: ['payment-options'], queryFn: ({ signal }) => getJson<PaymentOptions>('/api/payment-options', signal), retry: false });
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<AuthResponse>('/api/auth/me', signal), retry: false, staleTime: 60_000 });
  const repeatPlay = useQuery({ queryKey: ['tickets', 'repeat', repeatTicketId], queryFn: ({ signal }) => getJson<RepeatPlayResponse>(`/api/tickets/${encodeURIComponent(repeatTicketId)}/repeat`, signal), enabled: Boolean(repeatTicketId && auth.data), retry: false });
  const selected = sessions.data?.items.find((item) => item.id === sessionId);
  const modality = selected?.modalities.find((item) => item.digits === digits);
  const plans = selected?.plans.filter((plan) => plan.digits === digits) ?? [];
  const priceCents = dollarsToCents(amount);
  const minimum = modality ? BigInt(modality.minCents) : 25n;
  const step = modality ? BigInt(modality.stepCents) : 25n;
  const amountValid = priceCents !== null && BigInt(priceCents) >= minimum && BigInt(priceCents) % step === 0n;
  const numberValid = Boolean(modality && isValidPlayedNumber(number, digits));
  const canAdd = Boolean(selected && modality && numberValid && amountValid && plans.length > 0 && (plans.length < 2 || planId));
  const selectedBank = options.data?.bankAccounts.find((bank) => bank.id === bankId);
  const total = useMemo(() => totalCartCents(draft.items), [draft.items]);

  useEffect(() => {
    if (searchParams.has('number') || searchParams.has('digits') || searchParams.has('sessionId')) {
      const next = new URLSearchParams(searchParams);
      next.delete('number'); next.delete('digits'); next.delete('sessionId');
      setSearchParams(next, { replace: true });
    }
  }, []);

  useEffect(() => {
    if (!repeatTicketId || repeatProcessed.current || !repeatPlay.data || !sessions.data) return;
    repeatProcessed.current = true;
    const repeated: DraftCartLine[] = [];
    let unavailable = 0;
    let changedPlan = 0;
    for (const line of repeatPlay.data.items) {
      const nextSession = sessions.data.items.find((session) => session.drawId === line.drawId && session.modalities.some((item) => item.digits === line.digits));
      if (!nextSession) { unavailable += 1; continue; }
      const currentPlans = nextSession.plans.filter((plan) => plan.digits === line.digits);
      if (!currentPlans.length) { unavailable += 1; continue; }
      const originalPlan = currentPlans.find((plan) => plan.id === line.planId);
      if (!originalPlan) changedPlan += 1;
      const selectedPlanId = originalPlan?.id ?? (currentPlans.length === 1 ? currentPlans[0].id : undefined);
      repeated.push({
        id: globalThis.crypto.randomUUID(), drawId: line.drawId, sessionId: nextSession.id,
        drawName: nextSession.drawName, drawDate: nextSession.drawDate, digits: line.digits,
        number: line.number, amountCents: line.amountCents, ...(selectedPlanId ? { planId: selectedPlanId } : {}),
      });
    }
    if (repeated.length) {
      const first = repeated[0];
      setDraft((current) => ({ idempotencyKey: newCartKey(), items: [...current.items, ...repeated] }));
      setSessionId(first.sessionId); setDigits(first.digits); setNumber(first.number);
      setAmount(moneyInput(first.amountCents)); setPlanId(first.planId ?? ''); setIsFavoritePrefill(false);
    }
    const parts = [`${repeated.length} jugada(s) cargada(s) al carrito para revisión.`];
    if (changedPlan) parts.push(`${changedPlan} requiere elegir un plan vigente.`);
    if (unavailable) parts.push(`${unavailable} no se pudo cargar porque el sorteo o modalidad ya no está disponible.`);
    setRepeatNotice(parts.join(' '));
    const next = new URLSearchParams(searchParams); next.delete('repeatTicketId');
    setSearchParams(next, { replace: true });
  }, [repeatTicketId, repeatPlay.data, sessions.data, searchParams, setSearchParams]);

  useEffect(() => {
    const available = sessions.data?.items ?? [];
    if (available.length && !available.some((item) => item.id === sessionId)) {
      const preferred = available.find((item) => item.modalities.some((modality) => modality.digits === digits)) ?? available[0];
      setSessionId(preferred.id);
      const first = preferred.modalities.find((modality) => modality.digits === digits) ?? preferred.modalities[0];
      if (first && first.digits !== digits) { setDigits(first.digits); setNumber('0'.repeat(first.digits)); setIsFavoritePrefill(false); }
    }
  }, [sessions.data, sessionId]);

  useEffect(() => {
    if (selected && !selected.modalities.some((item) => item.digits === digits)) {
      const first = selected.modalities[0];
      if (first) { setDigits(first.digits); setNumber('0'.repeat(first.digits)); setIsFavoritePrefill(false); }
    }
  }, [selected, digits]);

  useEffect(() => {
    if (plans.length === 1) setPlanId(plans[0].id);
    else if (!plans.some((plan) => plan.id === planId)) setPlanId('');
  }, [plans, planId]);

  useEffect(() => {
    if (auth.data?.user) setBuyer((current) => ({ ...current, fullName: auth.data!.user.fullName, phone: auth.data!.user.phone, email: auth.data!.user.email ?? '' }));
  }, [auth.data]);

  useEffect(() => { saveCartDraft(draft); }, [draft]);

  const order = useMutation({
    mutationFn: async () => {
      const payload = {
        items: draft.items.map((item) => ({ drawId: item.drawId, sessionId: item.sessionId, digits: item.digits, number: item.number, amountCents: item.amountCents, planId: item.planId })),
        paymentMethod: method,
        ...(method === 'bank_transfer' ? { bankAccountId: bankId } : {}),
        buyer,
        idempotencyKey: draft.idempotencyKey,
      };
      const form = new FormData();
      form.set('order', JSON.stringify(payload));
      if (method === 'bank_transfer' && receipt) form.set('receipt', receipt, receipt.name);
      return postFormData<OrderResponse>('/api/orders', form);
    },
    onSuccess: async (response) => {
      setCompleted(response.order);
      setDraft({ idempotencyKey: newCartKey(), items: [] });
      setReceipt(null);
      setMethod('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/tickets'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/wallet'] }),
        queryClient.invalidateQueries({ queryKey: ['auth'] }),
      ]);
    },
  });

  function updateCart(items: DraftCartLine[]) {
    setDraft({ idempotencyKey: newCartKey(), items });
    setCompleted(null);
    order.reset();
  }

  function addLine() {
    if (!canAdd || !selected || !priceCents) return;
    updateCart([...draft.items, {
      id: globalThis.crypto.randomUUID(), drawId: selected.drawId, sessionId: selected.id,
      drawName: selected.drawName, drawDate: selected.drawDate, digits, number,
      amountCents: priceCents, ...(planId ? { planId } : {}),
    }]);
    setNumber('0'.repeat(digits));
    setIsFavoritePrefill(false);
  }

  function onReceipt(file?: File) {
    setReceiptError(''); setReceipt(file ?? null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setReceipt(null); setReceiptError('El comprobante no puede superar 5 MB.'); return; }
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) { setReceipt(null); setReceiptError('Adjunta un archivo JPG, PNG o PDF.'); }
  }

  function submit(event: FormEvent) { event.preventDefault(); if (!canCheckout) return; order.mutate(); }
  const invalidCartPlans = draft.items.some((line) => {
    const currentSession = sessions.data?.items.find((session) => session.id === line.sessionId);
    const currentPlans = currentSession?.plans.filter((plan) => plan.digits === line.digits) ?? [];
    return currentPlans.length === 0 || !currentPlans.some((plan) => plan.id === line.planId);
  });
  const canCheckout = draft.items.length > 0 && !invalidCartPlans && Boolean(method) && buyer.fullName.trim().length >= 3 && buyer.phone.trim().length >= 7 && buyer.adultConfirmed && buyer.termsAccepted && (method === 'wallet' || Boolean(bankId && receipt)) && !order.isPending;

  if (completed) return <OrderConfirmation order={completed} hasReceipt={completed.method === 'bank_transfer'} onAgain={() => setCompleted(null)} />;

  return <>
    <div className="page-heading"><div><div className="eyebrow">TU PRÓXIMA JUGADA</div><h1>Comprar</h1><p>Arma tu jugada y revisa el resumen antes de enviarla. El servidor valida precio, cupo y horario al confirmar.</p></div></div>
    {repeatTicketId && repeatPlay.isPending && <section className="panel remote-state"><div className="loader"/><span>Cargando la jugada anterior para que la revises…</span></section>}
    {repeatTicketId && repeatPlay.isError && <div className="form-notice error" role="alert">No se pudo cargar la jugada anterior: {repeatPlay.error.message}</div>}
    {repeatNotice && <div className="form-notice success" role="status">{repeatNotice} No se realiza ninguna compra automáticamente.</div>}
    {sessions.isPending ? <section className="panel remote-state"><div className="loader"/><span>Consultando sorteos disponibles…</span></section> : sessions.isError ? <RemoteError text={sessions.error.message} onRetry={() => void sessions.refetch()} /> : sessions.data.items.length === 0 ? <section className="panel remote-state"><span className="state-icon"><Clock3 size={20}/></span><strong>No hay sorteos abiertos</strong><span>Cuando la administración publique un sorteo, podrás armar tu jugada aquí.</span></section> : <div className="buy-layout">
      <div className="buy-main">
        <section className="panel buy-panel"><div className="panel-heading"><div><div className="eyebrow">1 · JUGADA</div><h2>Arma tus números</h2></div><span className="live-label"><i/> CUPO VALIDADO AL ENVIAR</span></div>
          <div className="buy-fields">
            <label className="field"><span>Sorteo</span><select value={sessionId} onChange={(event) => { const next = sessions.data.items.find((item) => item.id === event.target.value); setSessionId(event.target.value); setIsFavoritePrefill(false); if (next?.modalities[0]) { setDigits(next.modalities[0].digits); setNumber('0'.repeat(next.modalities[0].digits)); } }}><option value="" disabled>Selecciona un sorteo</option>{sessions.data.items.map((item) => <option key={item.id} value={item.id}>{item.drawName} · {new Date(item.drawsAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short' })}</option>)}</select></label>
            <div className="buy-two-cols"><label className="field"><span>Modalidad</span><select value={digits} onChange={(event) => { const nextDigits = Number(event.target.value) as 2 | 3 | 4; setDigits(nextDigits); setNumber('0'.repeat(nextDigits)); setIsFavoritePrefill(false); }}>{(selected?.modalities ?? []).map((item) => <option key={item.digits} value={item.digits}>{item.digits} cifras</option>)}</select></label>
              <label className="field"><span>Tu número</span><input className="played-number" type="text" inputMode="numeric" autoComplete="off" maxLength={digits} value={number} onChange={(event) => { setNumber(normalizePlayedInput(event.target.value, digits)); setIsFavoritePrefill(false); }} aria-describedby="number-help" /><small id="number-help">Conserva los ceros iniciales · {digits} cifras</small>{isFavoritePrefill && <small className="favorite-prefill-note">Número cargado desde tus favoritos. Revisa sorteo, importe y jugada antes de agregar.</small>}</label></div>
            <label className="field"><span>Plan de premios</span><select value={planId} onChange={(event) => setPlanId(event.target.value)} disabled={plans.length < 2}><option value="">{plans.length === 1 ? plans[0].name : plans.length ? 'Selecciona un plan' : 'No hay plan activo'}</option>{plans.length > 1 && plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select>{plans.length === 0 && <small>No se puede agregar esta modalidad hasta que exista un plan activo.</small>}</label>
            <div className="field"><span>Valor por jugada</span><div className="amount-shortcuts">{['100','200','300','500','1000'].map((cents) => <button key={cents} className={`amount-chip ${priceCents === cents ? 'selected' : ''}`} type="button" onClick={() => setAmount(moneyInput(cents))}>{centsToUsd(cents)}</button>)}</div><label className="amount-input"><span>$</span><input aria-label="Valor personalizado en dólares" type="number" inputMode="decimal" min={modality ? moneyInput(modality.minCents) : '0.25'} step={modality ? moneyInput(modality.stepCents) : '0.25'} value={amount} onChange={(event) => setAmount(event.target.value)} /><small>Desde {centsToUsd(minimum)} · pasos de {centsToUsd(step)}</small></label>{priceCents && !amountValid && <small className="input-error">Ingresa un valor que cumpla el mínimo y los incrementos del sorteo.</small>}</div>
          </div>
          <button type="button" className="button button-green add-line" onClick={addLine} disabled={!canAdd}><Plus size={17}/> Agregar al carrito</button>
        </section>
        <section className="panel cart-panel"><div className="panel-heading"><div><div className="eyebrow">2 · RESUMEN</div><h2>Tu carrito <span className="cart-count">{draft.items.length}</span></h2></div>{draft.items.length > 0 && <button className="text-link" type="button" onClick={() => updateCart([])}><Trash2 size={14}/> Vaciar</button>}</div>
          {draft.items.length === 0 ? <div className="cart-empty"><Clover size={21}/><span>Agrega una o más jugadas para continuar.</span></div> : <div className="cart-lines">{draft.items.map((line) => { const lineSession = sessions.data?.items.find((session) => session.id === line.sessionId); const linePlans = lineSession?.plans.filter((plan) => plan.digits === line.digits) ?? []; const selectedPlan = linePlans.find((plan) => plan.id === line.planId); return <article className="cart-line" key={line.id}><div className="cart-line-number">{line.number}<small>{line.digits} CIFRAS</small></div><div className="cart-line-info"><strong>{line.drawName}</strong><span>{new Date(`${line.drawDate}T12:00:00`).toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium' })}</span>{linePlans.length > 1 ? <label className="cart-plan-select"><span>Plan de premios</span><select aria-label={`Plan de premios para el número ${line.number}`} value={line.planId ?? ''} onChange={(event) => updateCart(draft.items.map((item) => item.id === line.id ? { ...item, ...(event.target.value ? { planId: event.target.value } : { planId: undefined }) } : item))}><option value="">Selecciona un plan</option>{linePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label> : <small>Plan: {selectedPlan?.name ?? 'No disponible'}</small>}</div><strong className="cart-line-amount">{centsToUsd(line.amountCents)}</strong><button type="button" className="icon-button cart-remove" onClick={() => updateCart(draft.items.filter((item) => item.id !== line.id))} aria-label={`Quitar número ${line.number}`}><Minus size={16}/></button></article>; })}</div>}
          {invalidCartPlans && draft.items.length > 0 && <div className="form-notice error" role="alert">Selecciona un plan vigente para cada jugada antes de continuar. El sistema no cambiará el plan por su cuenta.</div>}
          {draft.items.length > 0 && <div className="cart-total"><span>Total de tu borrador</span><strong>{centsToUsd(total)}</strong></div>}
        </section>
      </div>
      <aside className="checkout-panel panel"><div className="eyebrow">3 · ENVÍO</div><h2>Confirma tu compra</h2><p className="checkout-hint">La compra quedará pendiente de revisión. No se activa un ticket al enviar el comprobante.</p>
        <form className="checkout-form" onSubmit={submit}>
          <label className="field"><span>Nombre del comprador</span><input autoComplete="name" value={buyer.fullName} onChange={(event) => setBuyer({ ...buyer, fullName: event.target.value })} required minLength={3}/></label>
          <label className="field"><span>Teléfono</span><input autoComplete="tel" type="tel" inputMode="tel" placeholder="+593 99 123 4567" value={buyer.phone} onChange={(event) => setBuyer({ ...buyer, phone: event.target.value })} required minLength={7}/></label>
          <label className="field"><span>Correo electrónico <small>Opcional</small></span><input autoComplete="email" type="email" value={buyer.email} onChange={(event) => setBuyer({ ...buyer, email: event.target.value })}/></label>
          <div className="field"><span>Método de pago</span>{options.isPending ? <small>Consultando opciones…</small> : options.isError ? <small className="input-error">No pudimos cargar los métodos de pago.</small> : <div className="payment-options">{options.data.methods.filter((item) => item.method !== 'wallet' || auth.data).map((item) => <button type="button" key={item.method} className={`payment-option ${method === item.method ? 'selected' : ''}`} onClick={() => { setMethod(item.method); setReceipt(null); setReceiptError(''); }}><span className="payment-icon">{item.method === 'wallet' ? <Wallet size={17}/> : <Banknote size={17}/>}</span><span><strong>{item.method === 'wallet' ? 'Mi billetera' : 'Transferencia'}</strong><small>{item.helpText ?? (item.method === 'wallet' ? 'Usa tu saldo disponible' : 'Adjunta tu comprobante')}</small></span>{method === item.method && <Check size={15}/>}</button>)}</div>}</div>
          {method === 'bank_transfer' && <><label className="field"><span>Cuenta bancaria</span><select value={bankId} onChange={(event) => setBankId(event.target.value)} required><option value="">Selecciona una cuenta</option>{options.data?.bankAccounts.map((bank) => <option key={bank.id} value={bank.id}>{bank.bankName} · {bank.accountType} · {bank.accountNumber}</option>)}</select></label>{selectedBank && <div className="bank-card"><strong>{selectedBank.bankName}</strong><span>{selectedBank.holder} · {selectedBank.accountType}</span><code>{selectedBank.accountNumber}</code></div>}<label className="field proof-field"><span>Comprobante de transferencia</span><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => onReceipt(event.target.files?.[0])} required/><small>JPG, PNG o PDF · máximo 5 MB</small>{receipt && <small className="proof-name">{receipt.name} · {(receipt.size / 1024).toFixed(0)} KB</small>}{receiptError && <small className="input-error">{receiptError}</small>}</label></>}
          <label className="check-row"><input type="checkbox" checked={buyer.adultConfirmed} onChange={(event) => setBuyer({ ...buyer, adultConfirmed: event.target.checked })} required/><span>Confirmo que soy mayor de 18 años.</span></label>
          <label className="check-row"><input type="checkbox" checked={buyer.termsAccepted} onChange={(event) => setBuyer({ ...buyer, termsAccepted: event.target.checked })} required/><span>Acepto los términos y condiciones y confirmo mi jugada antes de enviarla.</span></label>
          {order.isError && <div className="form-notice error" role="alert">{order.error.message}</div>}
          <div className="checkout-total"><span>Total a enviar</span><strong>{centsToUsd(total)}</strong></div>
          <button type="submit" className="button button-green checkout-submit" disabled={!canCheckout || options.isPending || (method === 'bank_transfer' && !options.data?.bankAccounts.length)}>{order.isPending ? 'Enviando…' : 'Enviar compra'} <ArrowRight size={17}/></button>
          <div className="secure-note checkout-secure"><ShieldCheck size={16}/><span>Precio, cierre, cupo y pago se verifican en el servidor.</span></div>
        </form>
      </aside>
    </div>}
  </>;
}

function RemoteError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return <section className="panel remote-state"><span className="state-icon state-error"><RefreshCw size={18}/></span><strong>No pudimos cargar los sorteos</strong><span>{text}</span><button type="button" className="text-link retry" onClick={onRetry}>Intentar de nuevo <ArrowRight size={15}/></button></section>;
}

function OrderConfirmation({ order, hasReceipt, onAgain }: { order: OrderResponse['order']; hasReceipt: boolean; onAgain: () => void }) {
  return <><div className="page-heading"><div><div className="eyebrow">COMPRA ENVIADA</div><h1>¡Compra recibida!</h1><p>Tu operación quedó registrada y está pendiente de revisión.</p></div></div><section className="panel order-success"><TenantLogo variant="full" className="confirmation-logo" alt="El Imperio de Ross"/><span className="order-success-icon"><Check size={25}/></span><div className="eyebrow">CÓDIGO DE COMPRA</div><h2>{order.purchaseCode}</h2><span className="status-badge pending">PENDIENTE DE REVISIÓN</span><p>{hasReceipt ? 'El comprobante se recibió para revisión. Todavía no se ha emitido un ticket activo.' : 'Tu pago está pendiente de verificación. Todavía no se ha emitido un ticket activo.'}</p><div className="order-receipt-total"><span>Total informado por el servidor</span><strong>{centsToUsd(order.totalCents)}</strong></div><button className="button button-green" type="button" onClick={onAgain}>Armar otra jugada <Plus size={16}/></button></section></>;
}
