import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowRight, Check, CircleHelp, Database, Play, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { getJson, ApiError } from '../../services/http';
import './system-check.css';

type UserContext = { user: { role: string; permissions: string[]; fullName: string } };
type CheckState = 'ok' | 'error' | 'skipped';
type CheckResult = { id: string; label: string; group: string; path: string; state: CheckState; detail: string; count?: number };
type EndpointCheck = { id: string; label: string; group: string; path: string; roles?: string[]; permission?: string; permissionAny?: string[] };

const checks: EndpointCheck[] = [
  { id: 'live', label: 'Proceso de API', group: 'Infraestructura', path: '/health/live' },
  { id: 'ready', label: 'Conexión de bases de datos', group: 'Infraestructura', path: '/health/ready' },
  { id: 'tenant', label: 'Resolución de tenant y configuración', group: 'Plataforma', path: '/api/tenant/config' },
  { id: 'sessions', label: 'Sorteos abiertos', group: 'Plataforma', path: '/api/sessions/open' },
  { id: 'results', label: 'Resultados publicados', group: 'Plataforma', path: '/api/results' },
  { id: 'notifications', label: 'Bandeja de notificaciones propia', group: 'Cuenta', path: '/api/notifications' },
  { id: 'wallet', label: 'Billetera propia', group: 'Cuenta', path: '/api/wallet', roles: ['client'] },
  { id: 'tickets', label: 'Tickets propios', group: 'Cuenta', path: '/api/tickets', roles: ['client'] },
  { id: 'pos-sales', label: 'Ventas propias del POS', group: 'Operación', path: '/api/pos/sales', roles: ['seller', 'worker'], permission: 'sale.register' },
  { id: 'commissions', label: 'Comisiones propias', group: 'Operación', path: '/api/pos/commissions', roles: ['seller'], permission: 'sale.register' },
  { id: 'contracts', label: 'Contratas visibles', group: 'Operación', path: '/api/contracts', roles: ['seller', 'admin'], permissionAny: ['sale.register', 'finance.manage'] },
  { id: 'admin-dashboard', label: 'Indicadores administrativos', group: 'Administración', path: '/api/admin/dashboard', roles: ['admin'], permission: 'report.view' },
  { id: 'users', label: 'Usuarios y permisos', group: 'Administración', path: '/api/admin/users', roles: ['admin'] },
  { id: 'tenant-admin', label: 'Configuración de tenant', group: 'Administración', path: '/api/admin/tenant', roles: ['admin'], permission: 'tenant.manage' },
  { id: 'draw-schedule', label: 'Agenda de sorteos', group: 'Administración', path: '/api/admin/schedule', roles: ['admin'], permission: 'draw.create' },
  { id: 'plans', label: 'Planes de premio', group: 'Administración', path: '/api/admin/plans/manage', roles: ['admin'], permission: 'plan.edit' },
  { id: 'orders', label: 'Cola de compras', group: 'Administración', path: '/api/admin/orders/pending', roles: ['admin'], permission: 'order.approve' },
  { id: 'recharges', label: 'Cola de recargas', group: 'Administración', path: '/api/admin/recharges/pending', roles: ['admin'], permission: 'recharge.approve' },
  { id: 'result-sessions', label: 'Sesiones para resultados', group: 'Administración', path: '/api/admin/results/sessions', roles: ['admin'], permission: 'result.edit' },
  { id: 'withdrawals', label: 'Solicitudes de retiro', group: 'Administración', path: '/api/admin/withdrawals', roles: ['admin'], permission: 'withdrawal.manage' },
  { id: 'receivables', label: 'Cuentas por cobrar', group: 'Administración', path: '/api/admin/finance/receivables', roles: ['admin'], permission: 'finance.manage' },
  { id: 'refunds', label: 'Solicitudes de reembolso', group: 'Administración', path: '/api/admin/finance/refunds', roles: ['admin'], permission: 'refund.manage' },
  { id: 'raffles', label: 'Administración de rifas', group: 'Administración', path: '/api/admin/raffles/manage', roles: ['admin'], permission: 'raffle.manage' },
  { id: 'audit', label: 'Registro de auditoría', group: 'Administración', path: '/api/admin/audit', roles: ['admin'], permission: 'report.view' },
];

function permitted(check: EndpointCheck, user: UserContext['user']) {
  if (check.roles && !check.roles.includes(user.role)) return false;
  if (check.permission && !user.permissions.includes(check.permission)) return false;
  if (check.permissionAny && !check.permissionAny.some((permission) => user.permissions.includes(permission))) return false;
  return true;
}

async function runCheck(check: EndpointCheck): Promise<CheckResult> {
  try {
    const response = await getJson<unknown>(check.path);
    const data = response as { items?: unknown } | null;
    return { ...check, state: 'ok', detail: Array.isArray(data?.items) ? 'Respuesta correcta' : 'Servicio disponible', ...(Array.isArray(data?.items) ? { count: data.items.length } : {}) };
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    const detail = status === 401 ? 'La sesión dejó de ser válida; vuelve a iniciar sesión.'
      : status === 403 ? 'La API rechazó el permiso efectivo de esta cuenta.'
      : status === 404 ? 'La API no encontró esta ruta o el módulo está deshabilitado.'
      : error instanceof Error ? error.message : 'Error inesperado al consultar el servicio.';
    return { ...check, state: 'error', detail };
  }
}

export function AdminSystemCheckPage() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<UserContext>('/api/auth/me', signal), retry: false });
  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const user = auth.data?.user;
  const canRun = user?.role === 'admin' && user.permissions.includes('report.view');

  async function execute() {
    if (!user || !canRun || running) return;
    setRunning(true);
    const available = checks.filter((check) => permitted(check, user));
    const outcomes = await Promise.all(available.map(runCheck));
    setResults(outcomes);
    setLastRun(new Date());
    setRunning(false);
  }

  if (auth.isPending) return <section className="panel remote-state"><div className="loader"/><span>Verificando la sesión administrativa…</span></section>;
  if (!user || !canRun) return <section className="panel remote-state" role="alert"><span className="state-icon"><ShieldCheck size={20}/></span><strong>Acceso restringido</strong><span>Esta revisión requiere una cuenta admin con permiso report.view.</span></section>;

  const passed = results.filter((result) => result.state === 'ok').length;
  const failed = results.filter((result) => result.state === 'error').length;
  const groups = [...new Set(results.map((result) => result.group))];
  return <>
    <div className="page-heading"><div><div className="eyebrow">CONTROL DE OPERACIÓN</div><h1>Prueba completa del sistema</h1><p>Comprueba servicios y rutas de lectura accesibles para tu rol. La revisión no modifica compras, saldos, tickets ni sorteos.</p></div><button className="button button-gold" type="button" onClick={() => void execute()} disabled={running}><Play size={15}/>{running ? 'Comprobando…' : results.length ? 'Ejecutar de nuevo' : 'Ejecutar diagnóstico'}</button></div>
    <section className="system-check-summary">
      <article className="panel"><Activity size={18}/><small>Revisiones disponibles</small><strong>{results.length || checks.filter((check) => permitted(check, user)).length}</strong></article>
      <article className="panel"><Check size={18}/><small>Correctas</small><strong>{results.length ? passed : '—'}</strong></article>
      <article className="panel"><AlertTriangle size={18}/><small>Con error</small><strong>{results.length ? failed : '—'}</strong></article>
    </section>
    {results.length === 0 ? <section className="panel remote-state"><span className="state-icon"><Database size={19}/></span><strong>Diagnóstico de solo lectura</strong><span>Se consultarán salud de la API/BD, tenant y módulos permitidos a {user.fullName}. Los módulos fuera de su rol o permisos se omiten.</span><button type="button" className="text-link" onClick={() => void execute()}>Iniciar diagnóstico <ArrowRight size={14}/></button></section> : <>
      <div className="system-check-meta"><span><ShieldCheck size={15}/> Cuenta: {user.fullName} · {user.role}</span><span>{lastRun?.toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}</span><button className="text-link" type="button" onClick={() => void execute()} disabled={running}><RefreshCw size={14}/> Actualizar</button></div>
      {groups.map((group) => <section className="panel system-check-group" key={group}><div className="panel-heading"><h2>{group}</h2></div><div className="system-check-list">{results.filter((result) => result.group === group).map((result) => <article className="system-check-row" key={result.id}><span className={`system-check-icon ${result.state}`}>{result.state === 'ok' ? <Check size={15}/> : result.state === 'skipped' ? <CircleHelp size={15}/> : <X size={15}/>}</span><div><strong>{result.label}</strong><small>{result.detail}</small></div><span className="system-check-path">{result.path}{result.count !== undefined ? ` · ${result.count} registro(s)` : ''}</span></article>)}</div></section>)}
      <p className="system-check-note">Esta pantalla valida respuestas HTTP con tu sesión actual; no reemplaza pruebas de concurrencia, recorridos financieros ni aislamiento RLS en una base de prueba.</p>
    </>}
  </>;
}
