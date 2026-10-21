import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, Database, RefreshCw, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { getJson } from '../../services/http';
import './demo-data.css';

type DemoCounts = {
  demoUsers: string; demoDraws: string; demoSessions: string; demoPlans: string;
  demoOrders: string; demoTickets: string; demoResults: string; demoPrizes: string;
  demoPayments: string; demoPaymentProofs: string; demoRafflePurchases: string; demoRafflePackages: string; demoFortuneNumbers: string;
  demoCommissions: string; demoContracts: string; demoScheduledPlays: string;
  demoRaffles: string; demoNotifications: string; demoAuditEntries: string;
  demoWithdrawals: string; demoRecharges: string; demoFinancialAccounts: string; demoCashClosings: string;
};
type DemoStatus = { counts: DemoCounts; generatedAt: string; source: 'postgresql' };
type DemoCard = { label: string; key: keyof DemoCounts; detail: string };

const demoCards: Array<{ title: string; records: DemoCard[] }> = [
  { title: 'Acceso y plataforma', records: [
    { label: 'Usuarios DEMO', key: 'demoUsers', detail: 'Cuentas identificadas explícitamente como demostración.' },
    { label: 'Sorteos DEMO', key: 'demoDraws', detail: 'Sorteos con código DEMO o nombre rotulado como DEMO.' },
    { label: 'Sesiones DEMO', key: 'demoSessions', detail: 'Fechas y horarios conectados a sorteos DEMO.' },
    { label: 'Planes DEMO', key: 'demoPlans', detail: 'Planes de premio asociados a sorteos DEMO.' },
  ] },
  { title: 'Compras y premios', records: [
    { label: 'Compras DEMO', key: 'demoOrders', detail: 'Órdenes creadas por seeds con clave idempotente demo.' },
    { label: 'Tickets DEMO', key: 'demoTickets', detail: 'Tickets vinculados a esas compras demo.' },
    { label: 'Resultados DEMO', key: 'demoResults', detail: 'Resultados publicados en sesiones demo.' },
    { label: 'Premios DEMO', key: 'demoPrizes', detail: 'Premios vinculados a tickets demo.' },
    { label: 'Pagos DEMO', key: 'demoPayments', detail: 'Registros de pago asociados a órdenes y rifas demo.' },
    { label: 'Comprobantes DEMO', key: 'demoPaymentProofs', detail: 'Archivos de pago asociados a pagos demo.' },
    { label: 'Compras de rifas DEMO', key: 'demoRafflePurchases', detail: 'Participaciones de rifas de prueba.' },
    { label: 'Paquetes de rifa DEMO', key: 'demoRafflePackages', detail: 'Paquetes de oportunidades de rifas demo.' },
    { label: 'Números Fortuna DEMO', key: 'demoFortuneNumbers', detail: 'Números de premio configurados en rifas demo.' },
  ] },
  { title: 'Operación y participación', records: [
    { label: 'Comisiones DEMO', key: 'demoCommissions', detail: 'Comisiones de vendedores demo.' },
    { label: 'Contratas DEMO', key: 'demoContracts', detail: 'Contratas creadas o asignadas a usuarios demo.' },
    { label: 'Jugadas programadas DEMO', key: 'demoScheduledPlays', detail: 'Programaciones propiedad de usuarios demo.' },
    { label: 'Rifas DEMO', key: 'demoRaffles', detail: 'Rifas cuyo nombre incluye DEMO.' },
    { label: 'Recargas DEMO', key: 'demoRecharges', detail: 'Solicitudes de recarga con clave demo.' },
    { label: 'Retiros DEMO', key: 'demoWithdrawals', detail: 'Solicitudes de retiro con clave demo.' },
    { label: 'Cuentas financieras DEMO', key: 'demoFinancialAccounts', detail: 'Cuentas contables identificadas como demo.' },
    { label: 'Cierres de caja DEMO', key: 'demoCashClosings', detail: 'Cierres con nota identificada como demo.' },
    { label: 'Notificaciones DEMO', key: 'demoNotifications', detail: 'Notificaciones dirigidas a demo o rotuladas como DEMO.' },
    { label: 'Auditoría DEMO', key: 'demoAuditEntries', detail: 'Eventos auditados por cuentas demo.' },
  ] },
];

export function AdminDemoDataPage() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: { role: string; permissions: string[] } }>('/api/auth/me', signal), retry: false });
  const allowed = auth.data?.user.role === 'admin' && auth.data.user.permissions.includes('report.view');
  const query = useQuery({ queryKey: ['admin', 'demo-status'], queryFn: ({ signal }) => getJson<DemoStatus>('/api/admin/demo/status', signal), enabled: allowed, retry: false });

  if (auth.isPending) return <section className="panel remote-state"><div className="loader"/><span>Verificando los permisos de Administración…</span></section>;
  if (!allowed) return <section className="panel remote-state" role="alert"><span className="state-icon"><ShieldCheck size={20}/></span><strong>Acceso restringido</strong><span>Esta página requiere una cuenta admin con el permiso report.view.</span></section>;

  return <>
    <div className="page-heading"><div><div className="eyebrow">ENTORNO DE DESARROLLO</div><h1>Estado de datos DEMO</h1><p>Inventario de registros marcados como demostración en PostgreSQL y estado de las capacidades principales.</p></div><button className="button button-outline" type="button" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={15}/>{query.isFetching ? 'Actualizando…' : 'Actualizar'}</button></div>
    <section className="panel demo-data-banner"><span className="demo-data-banner-icon"><Database size={20}/></span><div><strong>PostgreSQL es la fuente de estos conteos</strong><span>No se muestran datos personales, montos ni credenciales. Los conteos se calculan para el tenant de la sesión actual.</span></div><span className="demo-data-source">{query.data?.source === 'postgresql' ? 'CONECTADO' : 'LECTURA BD'}</span></section>
    {query.isPending ? <section className="panel remote-state"><div className="loader"/><span>Consultando inventario de demostración…</span></section>
      : query.isError ? <section className="panel remote-state"><span className="state-icon"><TriangleAlert size={20}/></span><strong>No se pudo leer el inventario</strong><span>{query.error.message}</span><button className="text-link" type="button" onClick={() => void query.refetch()}>Reintentar <ArrowRight size={14}/></button></section>
      : <>
        <section className="demo-data-grid">{demoCards.map((group) => <article className="panel demo-data-group" key={group.title}><div className="panel-heading"><div><div className="eyebrow">INVENTARIO</div><h2>{group.title}</h2></div><Sparkles size={18}/></div><div className="demo-data-records">{group.records.map((record) => { const count = Number(query.data.counts[record.key] ?? 0); return <div className="demo-data-record" key={record.key}><div><strong>{record.label}</strong><small>{record.detail}</small></div><span className={`demo-data-count ${count ? 'has-data' : ''}`}>{count}</span></div>; })}</div></article>)}</section>
        <section className="panel demo-capabilities"><div className="panel-heading"><div><div className="eyebrow">ESTADO DE CAPACIDADES</div><h2>Qué funciona y qué está pendiente</h2></div><Activity size={18}/></div><div className="demo-capability-list">
          <Capability state="ok" title="Persistencia y autenticación" detail="API conectada a PostgreSQL; login, roles, permisos y sesiones se validan en servidor."/>
          <Capability state="ok" title="Sorteos, compras, tickets y premios" detail="Flujos conectados a PostgreSQL; los registros DEMO se distinguen mediante nombres, códigos y seeds dedicados."/>
          <Capability state="ok" title="POS, Contratas y comisiones" detail="Módulos conectados a endpoints y limitados por rol/permisos; el conteo de arriba refleja únicamente registros identificables como DEMO."/>
          <Capability state="pending" title="Pasarela, SMS/correo y notificaciones externas" detail="No hay proveedor real configurado. La interfaz no reporta cobros ni mensajes externos exitosos."/>
          <Capability state="pending" title="Móvil nativo y pruebas E2E en base desechable" detail="PWA preparada; falta toolchain móvil y una base aislada para probar concurrencia, RLS y recorridos completos."/>
        </div></section>
        <div className="demo-data-footer"><span>Última lectura: {new Date(query.data.generatedAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}</span><div><NavLink className="button button-outline" to="/admin/prueba-completa">Ejecutar diagnóstico <ArrowRight size={14}/></NavLink><NavLink className="text-link" to="/admin">Volver al panel administrativo</NavLink></div></div>
      </>}
  </>;
}

function Capability({ state, title, detail }: { state: 'ok' | 'pending'; title: string; detail: string }) {
  return <article className="demo-capability"><span className={`demo-capability-dot ${state}`}/><div><strong>{title}</strong><small>{detail}</small></div><span className={`demo-capability-label ${state}`}>{state === 'ok' ? 'CONECTADO' : 'PENDIENTE'}</span></article>;
}
