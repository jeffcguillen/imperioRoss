import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Printer, Share2, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getJson } from '../../services/http';
import { TenantLogo } from '../../tenants/TenantProvider';
import { createTicketQr } from './ticket-qr';
import { createTicketPdf } from './ticket-pdf';
import './tickets.css';

interface VerifiedTicket {
  id: string; code: string; status: string; digits: number; totalCents: string; createdAt: string;
  drawName: string; drawDate: string; lines: Array<{ number: string; amountCents: string }>;
}
const money = (value: string) => {
  try {
    const cents = BigInt(value); const sign = cents < 0n ? '−' : ''; const amount = cents < 0n ? -cents : cents;
    return `${sign}$${new Intl.NumberFormat('es-EC').format(amount / 100n)}.${(amount % 100n).toString().padStart(2, '0')}`;
  }
  catch { return '—'; }
};
const safeDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('es-EC', { dateStyle: 'full' });

export function VerifyTicketPage() {
  const { codigo = '' } = useParams();
  const validCode = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/i.test(codigo);
  const query = useQuery({
    queryKey: ['/api/tickets/verify', codigo],
    queryFn: ({ signal }) => getJson<{ ticket: VerifiedTicket }>(`/api/tickets/verify/${encodeURIComponent(codigo)}`, signal),
    enabled: validCode, retry: false,
  });
  const ticket = query.data?.ticket;
  const status = ticket?.status === 'active' ? 'Válido' : ticket?.status === 'voided' ? 'Anulado' : ticket?.status === 'winner' ? 'Ganador' : ticket?.status === 'non_winner' ? 'Sin premio' : ticket ? 'Estado no disponible' : '';
  const verificationUrl = ticket ? new URL(`/verificar/${encodeURIComponent(ticket.code)}`, window.location.origin).toString() : '';
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrError, setQrError] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState('');
  useEffect(() => {
    let current = true;
    setQrDataUrl(''); setQrError(false);
    if (verificationUrl) void createTicketQr(verificationUrl)
      .then((dataUrl) => { if (current) setQrDataUrl(dataUrl); })
      .catch(() => { if (current) setQrError(true); });
    return () => { current = false; };
  }, [verificationUrl]);
  const download = async () => {
    if (!ticket || !qrDataUrl || downloadingPdf) return;
    setDownloadingPdf(true); setPdfError('');
    try {
      const blob = await createTicketPdf({
        code: ticket.code,
        status,
        drawName: ticket.drawName,
        drawDate: safeDate(ticket.drawDate),
        issuedAt: new Date(ticket.createdAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short' }),
        digits: ticket.digits,
        total: money(ticket.totalCents),
        lines: ticket.lines.map((line) => ({ number: line.number, amount: money(line.amountCents) })),
      }, qrDataUrl);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = `ticket-${ticket.code}.pdf`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      setPdfError('No se pudo preparar el PDF. Inténtalo de nuevo o usa Imprimir y elige “Guardar como PDF”.');
    } finally { setDownloadingPdf(false); }
  };
  const share = async () => {
    if (!ticket) return;
    try {
      if (navigator.share) await navigator.share({ title: `Ticket ${ticket.code}`, text: `Consulta el ticket ${ticket.code} de ${ticket.drawName}.`, url: verificationUrl });
      else if (navigator.clipboard) await navigator.clipboard.writeText(verificationUrl);
    } catch { /* El usuario puede cancelar el diálogo nativo. */ }
  };

  return <main className="ticket-verify-page">
    <Link to="/" className="ticket-back"><ArrowLeft size={16}/> Volver al inicio</Link>
    <header className="ticket-verify-brand"><TenantLogo variant="horizontal" className="ticket-verify-logo" alt="El Imperio de Ross"/></header>
    <section className="panel ticket-verify-card">
      <div className="eyebrow">VERIFICACIÓN PÚBLICA</div>
      {!validCode && <div className="ticket-verify-error"><ShieldCheck size={24}/><h1>No encontramos ese ticket</h1><p>Verifica el código de 8 caracteres e inténtalo nuevamente.</p></div>}
      {validCode && query.isPending && <div className="remote-state"><div className="loader"/><span>Consultando el ticket…</span></div>}
      {validCode && query.isError && !query.isPending && <div className="ticket-verify-error"><ShieldCheck size={24}/><h1>No encontramos ese ticket</h1><p>Verifica el código de 8 caracteres e inténtalo nuevamente.</p></div>}
      {ticket && <>
        <div className={`ticket-verify-status ${ticket.status === 'active' ? 'valid' : 'invalid'}`}><ShieldCheck size={20}/><span>Ticket {status}</span></div>
        <h1>{ticket.code}</h1><p className="ticket-verify-draw">{ticket.drawName}<br/><span>{safeDate(ticket.drawDate)}</span></p>
        <div className="ticket-verify-details"><span>Modalidad</span><strong>{ticket.digits} cifras</strong><span>Fecha de emisión</span><strong>{new Date(ticket.createdAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short' })}</strong></div>
        <ol className="ticket-verify-lines">{ticket.lines.map((line, index) => <li key={`${ticket.id}-${index}`}><strong>{line.number}</strong><span>{money(line.amountCents)}</span></li>)}</ol>
        <div className="ticket-verify-total"><span>Total</span><strong>{money(ticket.totalCents)}</strong></div>
        <div className="ticket-verify-qr"><div>{qrDataUrl ? <img src={qrDataUrl} alt={`Código QR para verificar el ticket ${ticket.code}`}/> : <span>{qrError ? 'No se pudo generar el QR.' : 'Generando código QR…'}</span>}</div><span>Escanea para verificar este ticket</span></div>
        <div className="ticket-verify-actions"><button className="button button-outline" onClick={() => window.print()}><Printer size={16}/> Imprimir</button><button className="button button-outline" onClick={() => void download()} disabled={!qrDataUrl || downloadingPdf}><Download size={16}/> {downloadingPdf ? 'Preparando PDF…' : 'Descargar PDF'}</button><button className="button button-green" onClick={() => void share()}><Share2 size={16}/> Compartir</button></div>
        {pdfError && <p className="form-notice error" role="alert">{pdfError}</p>}
      </>}
    </section>
    <p className="ticket-verify-privacy">Esta consulta confirma el estado y los datos de juego. No expone información personal del comprador.</p>
  </main>;
}
