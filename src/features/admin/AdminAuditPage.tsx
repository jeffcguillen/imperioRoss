import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, ClipboardList, Search } from 'lucide-react';
import { getJson } from '../../services/http';

interface AuditRecord {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  createdAt: string;
}
interface AuditResponse { items: AuditRecord[]; totalCount: number; limit: number; offset: number }

function valueText(value: unknown) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return '—'; }
}

export function AdminAuditPage() {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 30;
  const query = useQuery({
    queryKey: ['admin', 'audit', search, offset],
    queryFn: ({ signal }) => getJson<AuditResponse>(`/api/admin/audit?limit=${limit}&offset=${offset}&q=${encodeURIComponent(search)}`, signal),
    placeholderData: (previous) => previous,
  });
  const rows = query.data?.items ?? [];
  const total = query.data?.totalCount ?? 0;

  return <>
    <div className="page-heading"><div><div className="eyebrow">TRAZABILIDAD</div><h1>Auditoría</h1><p>Consulta los cambios registrados con su responsable, fecha, valores y motivo.</p></div></div>
    <section className="panel audit-panel">
      <div className="audit-toolbar">
        <label className="field audit-search"><span>Buscar en el historial</span><span className="audit-search-control"><Search size={16}/><input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} placeholder="Responsable, acción, registro o motivo" type="search" maxLength={100}/></span></label>
        <span className="audit-count">{query.isPending ? 'Cargando…' : `${total.toLocaleString('es-EC')} registros`}</span>
      </div>
      {query.isPending ? <div className="panel remote-state"><div className="loader"/><span>Cargando historial seguro…</span></div>
        : query.isError ? <div className="panel remote-state"><span className="state-icon state-error"><ClipboardList size={18}/></span><strong>No pudimos cargar la auditoría</strong><span>{query.error.message}</span><button className="text-link" type="button" onClick={() => void query.refetch()}>Intentar de nuevo <ArrowRight size={15}/></button></div>
          : rows.length === 0 ? <div className="remote-state"><span className="state-icon"><ClipboardList size={18}/></span><strong>{search ? 'Sin coincidencias' : 'Todavía no hay registros'}</strong><span>{search ? 'Prueba con otro término de búsqueda.' : 'Los cambios auditados aparecerán aquí.'}</span></div>
            : <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>Responsable</th><th>Acción</th><th>Registro</th><th>Fecha</th><th>Antes</th><th>Después</th><th>Motivo</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.actorName}</strong><small>{row.actorRole ?? 'Sistema'}</small></td><td><code>{row.action}</code></td><td><span>{row.entityType}</span><small>{row.entityId ?? '—'}</small></td><td>{new Date(row.createdAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short' })}</td><td><pre>{valueText(row.oldValue)}</pre></td><td><pre>{valueText(row.newValue)}</pre></td><td>{row.reason ?? '—'}</td></tr>)}</tbody></table></div>}
      <div className="audit-pagination"><span>{total === 0 ? '0' : `${offset + 1}–${Math.min(offset + rows.length, total)}`} de {total}</span><div><button className="button button-outline" type="button" disabled={offset === 0 || query.isFetching} onClick={() => setOffset(Math.max(0, offset - limit))}><ArrowLeft size={14}/> Anterior</button><button className="button button-outline" type="button" disabled={offset + rows.length >= total || query.isFetching} onClick={() => setOffset(offset + limit)}>Siguiente <ArrowRight size={14}/></button></div></div>
    </section>
  </>;
}
