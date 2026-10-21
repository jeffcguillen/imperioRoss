import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Banknote, BadgePercent, CalendarDays, ClipboardList, Clock3, ShieldCheck, Trophy, UserRound, Users, Wallet } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { getJson } from '../../services/http';

type DashboardMetrics = { salesTodayCents: string; approvedToday: string; ordersToReview: string; withdrawalsToReview: string; prizesToPay: string; activeClients: string; openSessions: string };
const dollars = (cents: string) => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(Number(BigInt(cents || '0')) / 100);

export function AdminDashboardPage() {
  const query = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: ({ signal }) => getJson<{ metrics: DashboardMetrics }>('/api/admin/dashboard', signal) });
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: { permissions: string[] } }>('/api/auth/me', signal), retry: false });
  const m = query.data?.metrics;
  const cards = [
    { label: 'Ventas aprobadas hoy', value: m ? dollars(m.salesTodayCents) : '—', detail: `${m?.approvedToday ?? '—'} compras`, icon: Banknote, to: '/admin/comprobantes' },
    { label: 'Compras por revisar', value: m?.ordersToReview ?? '—', detail: 'Comprobantes pendientes', icon: ClipboardList, to: '/admin/comprobantes' },
    { label: 'Retiros por gestionar', value: m?.withdrawalsToReview ?? '—', detail: 'Solicitados o en revisión', icon: Wallet, to: '/admin/retiros' },
    { label: 'Premios pendientes', value: m?.prizesToPay ?? '—', detail: 'Valida cada ticket antes de pagar', icon: Trophy, to: '/operacion/premios' },
    { label: 'Clientes activos', value: m?.activeClients ?? '—', detail: 'Cuentas habilitadas', icon: Users },
    { label: 'Sorteos abiertos', value: m?.openSessions ?? '—', detail: 'Sesiones con cierre futuro', icon: CalendarDays },
  ];
  const permissions = auth.data?.user.permissions ?? [];
  const managementLinks = [
    { to: '/admin/usuarios', label: 'Usuarios, roles y permisos', detail: 'Crear vendedores y trabajadores; configurar la matriz por rol.', icon: ShieldCheck },
    ...(permissions.includes('commission.manage') && permissions.includes('finance.manage') ? [{ to: '/admin/comisiones', label: 'Asignar comisiones', detail: 'Definir porcentaje o valor por vendedor, sorteo y modalidad.', icon: BadgePercent }] : []),
  ];
  return <><div className="page-heading"><div><div className="eyebrow">CENTRO DE OPERACIONES</div><h1>Panel administrativo</h1><p>Resumen de actividad y accesos rápidos para atender el día.</p></div></div>{query.isPending ? <div className="panel remote-state"><div className="loader"/><span>Cargando indicadores…</span></div> : query.isError ? <div className="panel remote-state"><strong>No se pudo cargar el panel</strong><span>{query.error.message}</span></div> : <><div className="dashboard-grid">{cards.map(({ label, value, detail, icon: Icon, to }) => { const content = <><span className="dashboard-card-icon"><Icon size={18}/></span><span className="dashboard-card-label">{label}</span><strong>{value}</strong><small>{detail}</small>{to && <ArrowRight className="dashboard-card-arrow" size={14}/>}</>; return to ? <NavLink className="panel dashboard-card" to={to} key={label}>{content}</NavLink> : <article className="panel dashboard-card" key={label}>{content}</article>; })}</div><section className="panel dashboard-management"><div className="panel-heading"><div><div className="eyebrow">CONFIGURACIÓN DE PERSONAL</div><h2>Gestionar equipo y comisiones</h2></div><UserRound size={19}/></div><div className="dashboard-management-links">{managementLinks.map(({ to, label, detail, icon: Icon }) => <NavLink key={to} to={to}><span className="dashboard-management-icon"><Icon size={18}/></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowRight size={16}/></NavLink>)}</div></section><section className="panel dashboard-note"><Clock3 size={18}/><div><strong>Los indicadores respetan la zona horaria del tenant</strong><span>Las ventas se cuentan cuando fueron aprobadas. Las ventas a crédito no se suman como dinero cobrado.</span></div></section></>}</>;
}
