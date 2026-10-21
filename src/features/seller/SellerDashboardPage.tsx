import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, ClipboardList, ReceiptText, RefreshCw, Ticket, TrendingUp } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { getJson } from '../../services/http';
import type { ApiList } from '../../types/api';
import './seller-dashboard.css';

type SellerSale = {
  id: string; purchaseCode: string; buyerName: string; totalCents: string;
  status: string; createdAt: string;
  tickets: Array<{ id: string; code: string; status: string; canVoid: boolean }>;
};
type SellerCommission = {
  id: string; baseAmountCents: string; commissionCents: string; status: string;
  generatedAt: string; paidAt: string | null; drawName: string | null; digits: number | null;
};
type SellerContract = {
  id: string; clientName: string; drawName: string; digits: number; number: string;
  amountCents: string; status: string; slotCount: number; reservedCount: number;
  soldCount: number; receivableCents: string; collectedCents: string; collection: string;
  slots: Array<{ id: string; drawDate: string; status: string; canSell: boolean }>;
};

const money = (cents: string | number) => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(Number(cents) / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Guayaquil' }).format(new Date(value));

export function SellerDashboardPage() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: { role: string; permissions: string[]; fullName: string } }>('/api/auth/me', signal), retry: false });
  const enabled = auth.data?.user.role === 'seller' && auth.data.user.permissions.includes('sale.register');
  const sales = useQuery({ queryKey: ['/api/pos/sales'], queryFn: ({ signal }) => getJson<ApiList<SellerSale>>('/api/pos/sales', signal), enabled, retry: false });
  const commissions = useQuery({ queryKey: ['/api/pos/commissions'], queryFn: ({ signal }) => getJson<ApiList<SellerCommission>>('/api/pos/commissions', signal), enabled, retry: false });
  const contracts = useQuery({ queryKey: ['/api/contracts'], queryFn: ({ signal }) => getJson<ApiList<SellerContract>>('/api/contracts', signal), enabled, retry: false });

  if (auth.isPending) return <section className="panel remote-state"><div className="loader"/><span>Verificando tu espacio de vendedor…</span></section>;
  if (!auth.data || !enabled) return <section className="panel remote-state" role="alert"><strong>Acceso restringido</strong><span>Este panel requiere el rol de vendedor y el permiso para registrar ventas.</span><NavLink className="text-link" to="/">Volver al inicio <ArrowRight size={15}/></NavLink></section>;

  const saleItems = sales.data?.items ?? [];
  const commissionItems = commissions.data?.items ?? [];
  const contractItems = contracts.data?.items ?? [];
  const totalSales = saleItems.reduce((sum, item) => sum + BigInt(item.totalCents || '0'), 0n).toString();
  const totalCommissions = commissionItems.reduce((sum, item) => sum + BigInt(item.commissionCents || '0'), 0n).toString();
  const openSlots = contractItems.reduce((sum, item) => sum + item.reservedCount, 0);
  const reload = () => { void sales.refetch(); void commissions.refetch(); void contracts.refetch(); };

  return <div className="seller-dashboard">
    <div className="page-heading"><div><div className="eyebrow">TU ESPACIO DE TRABAJO</div><h1>Panel de vendedor</h1><p>Consulta tus ventas, comisiones y contratas. Cada importe corresponde únicamente a la actividad de tu cuenta.</p></div><button type="button" className="button button-outline" onClick={reload}><RefreshCw size={15}/> Actualizar</button></div>
    <div className="seller-actions">
      <NavLink to="/pos" className="button button-green"><ReceiptText size={17}/> Registrar nueva venta <ArrowRight size={15}/></NavLink>
      <NavLink to="/contratas" className="button button-outline"><ClipboardList size={17}/> Gestionar mis contratas <ArrowRight size={15}/></NavLink>
    </div>
    <section className="seller-metrics" aria-label="Resumen de actividad">
      <article className="panel seller-metric"><span className="seller-metric-icon"><ReceiptText size={18}/></span><small>Ventas recientes</small><strong>{sales.isPending ? '…' : saleItems.length}</strong><span>Importe listado: {sales.isPending ? '…' : money(totalSales)}</span></article>
      <article className="panel seller-metric"><span className="seller-metric-icon"><TrendingUp size={18}/></span><small>Comisiones recientes</small><strong>{commissions.isPending ? '…' : money(totalCommissions)}</strong><span>{commissionItems.length} movimiento(s) en el historial</span></article>
      <article className="panel seller-metric"><span className="seller-metric-icon"><CalendarDays size={18}/></span><small>Mis contratas</small><strong>{contracts.isPending ? '…' : contractItems.length}</strong><span>{contracts.isPending ? 'Consultando cupos…' : `${openSlots} cupos disponibles para venta`}</span></article>
    </section>
    <div className="seller-columns">
      <section className="panel seller-section"><div className="panel-heading"><div><div className="eyebrow">HISTORIAL</div><h2>Mis ventas</h2></div><NavLink className="text-link" to="/pos">Nueva venta <ArrowRight size={14}/></NavLink></div>
        <RemoteState loading={sales.isPending} error={sales.error?.message} empty={!sales.isPending && !saleItems.length} emptyText="Todavía no tienes ventas registradas." retry={() => void sales.refetch()}/>
        {!sales.isPending && !sales.isError && saleItems.slice(0, 6).map((sale) => <article className="seller-row" key={sale.id}><div className="seller-row-icon"><Ticket size={16}/></div><div className="seller-row-main"><strong>{sale.purchaseCode} · {sale.buyerName}</strong><small>{dateTime(sale.createdAt)} · {sale.tickets.length} ticket(s)</small><div className="seller-ticket-codes">{sale.tickets.slice(0, 3).map((ticket) => <span key={ticket.id}>{ticket.code}</span>)}{sale.tickets.length > 3 && <span>+{sale.tickets.length - 3}</span>}</div></div><div className="seller-row-end"><strong>{money(sale.totalCents)}</strong><span className={`status-badge status-${sale.status}`}>{sale.status.replaceAll('_', ' ')}</span></div></article>)}
      </section>
      <section className="panel seller-section"><div className="panel-heading"><div><div className="eyebrow">LIQUIDACIÓN</div><h2>Mis comisiones</h2></div></div>
        <RemoteState loading={commissions.isPending} error={commissions.error?.message} empty={!commissions.isPending && !commissionItems.length} emptyText="Las comisiones aparecerán cuando tus ventas cumplan las reglas configuradas." retry={() => void commissions.refetch()}/>
        {!commissions.isPending && !commissions.isError && commissionItems.slice(0, 6).map((item) => <article className="seller-row" key={item.id}><div className="seller-row-icon"><TrendingUp size={16}/></div><div className="seller-row-main"><strong>{item.drawName ?? 'Venta'}{item.digits ? ` · ${item.digits} cifras` : ''}</strong><small>{dateTime(item.generatedAt)} · Base {money(item.baseAmountCents)}</small></div><div className="seller-row-end"><strong>{money(item.commissionCents)}</strong><span className={`status-badge status-${item.status}`}>{item.status === 'paid' ? 'Pagada' : ({generated:'Generada',void:'Anulada'} as Record<string,string>)[item.status] ?? 'Estado actualizado'}</span></div></article>)}
      </section>
    </div>
    <section className="panel seller-section seller-contract-section"><div className="panel-heading"><div><div className="eyebrow">SEGUIMIENTO DE CUPOS</div><h2>Mis contratas</h2></div><NavLink className="text-link" to="/contratas">Ver todas <ArrowRight size={14}/></NavLink></div>
      <RemoteState loading={contracts.isPending} error={contracts.error?.message} empty={!contracts.isPending && !contractItems.length} emptyText="No tienes contratas asignadas por el momento." retry={() => void contracts.refetch()}/>
      {!contracts.isPending && !contracts.isError && contractItems.slice(0, 5).map((contract) => <article className="seller-contract-row" key={contract.id}><div><strong>{contract.clientName} · {contract.drawName}</strong><small>{contract.digits} cifras · número {contract.number} · {contract.status === 'active' ? 'Activa' : contract.status}</small><div className="seller-contract-progress"><span style={{ width: `${contract.slotCount ? Math.min(100, Math.round(contract.soldCount / contract.slotCount * 100)) : 0}%` }}/></div></div><div className="seller-contract-stats"><span><strong>{contract.soldCount}/{contract.slotCount}</strong> vendidos</span><span><strong>{contract.reservedCount}</strong> disponibles</span><span><strong>{contract.collection === 'credit' ? money(contract.receivableCents) : money(contract.collectedCents)}</strong>{contract.collection === 'credit' ? ' por cobrar' : ' recaudado'}</span></div><NavLink className="text-link" to="/contratas" aria-label={`Abrir contrata de ${contract.clientName}`}><ArrowRight size={16}/></NavLink></article>)}
    </section>
  </div>;
}

function RemoteState({ loading, error, empty, emptyText, retry }: { loading: boolean; error?: string; empty: boolean; emptyText: string; retry: () => void }) {
  if (loading) return <div className="seller-inline-state"><div className="loader"/><span>Cargando información…</span></div>;
  if (error) return <div className="seller-inline-state" role="alert"><strong>No se pudo cargar</strong><span>{error}</span><button className="text-link" type="button" onClick={retry}>Reintentar <ArrowRight size={14}/></button></div>;
  if (empty) return <div className="seller-inline-state"><span>{emptyText}</span></div>;
  return null;
}
