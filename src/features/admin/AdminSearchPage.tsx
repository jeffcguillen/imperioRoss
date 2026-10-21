import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Ban, Search, ShieldCheck } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { getJson, postJson } from '../../services/http';

type SearchResult = { kind: 'order' | 'ticket' | 'user'; id: string; code: string; title: string; detail: string; status: string; createdAt: string; href: string | null };
const kindLabel = { order: 'Compra', ticket: 'Ticket', user: 'Usuario' };
const statusLabel: Record<string, string> = { pending_review: 'Pendiente de revisión', pending: 'Pendiente', paid: 'Pagada', approved: 'Aprobada', rejected: 'Rechazada', refunded: 'Reembolsada', cancelled: 'Cancelada', expired: 'Vencida', active: 'Activo', voided: 'Anulado', inactive: 'Inactivo', client: 'Cliente', worker: 'Trabajador', seller: 'Vendedor', admin: 'Administración' };

export function AdminSearchPage() {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const queryText = useDeferredValue(search.trim());
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: { permissions: string[] } }>('/api/auth/me', signal), retry: false });
  const query = useQuery({
    queryKey: ['admin', 'global-search', queryText],
    queryFn: ({ signal }) => getJson<{ items: SearchResult[] }>(`/api/admin/search?q=${encodeURIComponent(queryText)}`, signal),
    enabled: queryText.length >= 2,
    retry: false,
  });
  const voidTicket = useMutation({
    mutationFn: (ticketId: string) => postJson(`/api/admin/tickets/${ticketId}/void`, { reason: voidReason.trim() }),
    onSuccess: async () => { setVoidingId(null); setVoidReason(''); await client.invalidateQueries({ queryKey: ['admin', 'global-search'] }); },
  });
  return <>
    <div className="page-heading"><div><div className="eyebrow">CONSULTA ADMINISTRATIVA</div><h1>Búsqueda global</h1><p>Localiza usuarios, compras y tickets de este tenant con permisos de reporte.</p></div></div>
    <section className="panel global-search-panel">
      <label className="field"><span>Nombre, teléfono, número de compra o código de ticket</span><span className="global-search-control"><Search size={18}/><input type="search" maxLength={100} minLength={2} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ej. 099…, #000123 o ABCD2345" autoComplete="off"/></span></label>
      <div className="global-search-privacy"><ShieldCheck size={16}/>La búsqueda se limita al tenant y solo muestra los datos necesarios para identificar el registro.</div>
    </section>
    {queryText.length < 2 ? <div className="panel remote-state"><span className="state-icon"><Search size={19}/></span><strong>Escribe al menos dos caracteres</strong><span>Busca por nombre, teléfono o código de compra/ticket.</span></div>
      : query.isPending ? <div className="panel remote-state"><div className="loader"/><span>Buscando en usuarios, compras y tickets…</span></div>
        : query.isError ? <div className="panel remote-state"><strong>No se pudo completar la búsqueda</strong><span>{query.error.message}</span><button className="text-link" type="button" onClick={() => void query.refetch()}>Intentar de nuevo <ArrowRight size={14}/></button></div>
          : !query.data.items.length ? <div className="panel remote-state"><strong>Sin coincidencias</strong><span>Prueba con otro nombre o código.</span></div>
            : <section className="global-search-results" aria-live="polite">{query.data.items.map((item) => <article className="panel global-search-result" key={`${item.kind}-${item.id}`}><div className="global-search-result-main"><span className="eyebrow">{kindLabel[item.kind]} · {statusLabel[item.status] ?? 'Estado actualizado'}</span><strong>{item.title}</strong><span>{item.detail}</span></div><code>{item.code}</code><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short' })}</time>{item.kind === 'ticket' && item.status === 'active' && auth.data?.user.permissions.includes('ticket.void') && <div className="ticket-void-controls">{voidingId === item.id ? <form onSubmit={(event) => { event.preventDefault(); voidTicket.mutate(item.id); }}><label className="field"><span>Motivo obligatorio</span><input minLength={5} maxLength={500} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} required autoFocus/></label><small>Se marcará anulado y quedará auditado; esta acción no genera un reembolso automático.</small><div><button className="button button-outline" type="button" onClick={() => { setVoidingId(null); setVoidReason(''); }}>Cancelar</button><button className="button button-danger-outline" type="submit" disabled={voidTicket.isPending || voidReason.trim().length < 5}>{voidTicket.isPending ? 'Anulando…' : 'Confirmar anulación'}</button></div></form> : <button className="button button-outline" type="button" onClick={() => { setVoidingId(item.id); voidTicket.reset(); }}><Ban size={14}/> Anular ticket</button>}{voidTicket.isError && voidingId === item.id && <span className="form-notice error" role="alert">{voidTicket.error.message}</span>}</div>}{item.href ? <NavLink className="button button-outline" to={item.href}>{item.kind === 'ticket' ? 'Verificar ticket' : 'Abrir usuario'} <ArrowRight size={14}/></NavLink> : <span className="global-search-readonly">Consulta informativa</span>}</article>)}</section>}
  </>;
}
