import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Banknote, Bell, Building2, CalendarClock, Check, CircleHelp, Clock3, ClipboardList, Clover, Eye, EyeOff, Heart, Plus, ReceiptText, Save,
  LayoutDashboard, Menu, ShieldCheck, Sparkles,
  Repeat2, Search, Ticket, Trophy, UserRound, Wallet, X,
  ChartNoAxesCombined,
} from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { getJson, postFormData, postJson } from './services/http';
import type { ApiList, OpenSession } from './types/api';
import { LoginPage, RecoveryPage, RegisterPage } from './features/auth/AuthPages';
import { BuyPage } from './features/orders/BuyPage';
import './features/admin/admin-results.css';
import { VerifyTicketPage } from './features/tickets/VerifyTicketPage';
import { GuestPurchaseRecoveryPage } from './features/tickets/GuestPurchaseRecoveryPage';
import { RechargePanel } from './features/wallet/RechargePanel';
import { AdminWithdrawalsPage, MyPrizesPage, PrizeValidationPage } from './features/prizes/Prizes';
import { AdminDashboardPage } from './features/admin/AdminDashboardPage';
const AdminUsersPage = lazy(() => import('./features/admin/AdminUsersPage').then((module) => ({ default: module.AdminUsersPage })));
import { AdminSchedulePage } from './features/admin/AdminSchedulePage';
const AdminPlansPage = lazy(() => import('./features/admin/AdminPlansPage').then((module) => ({ default: module.AdminPlansPage })));
import { AdminAuditPage } from './features/admin/AdminAuditPage';
const AdminCommissionPlansPage = lazy(() => import('./features/admin/AdminCommissionPlansPage').then((module) => ({ default: module.AdminCommissionPlansPage })));
const AdminFinancePage = lazy(() => import('./features/admin/AdminFinancePage').then((module) => ({ default: module.AdminFinancePage })));
import { AdminRafflesPage } from './features/admin/AdminRafflesPage';
import { PointOfSalePage } from './features/pos/PointOfSalePage';
import { ScheduledPlaysPage } from './features/scheduled/ScheduledPlaysPage';
import { FavoritesPage } from './features/favorites/FavoritesPage';
import { AccountSettings } from './features/account/AccountSettings';
import { AdminTenantSettingsPage } from './features/admin/AdminTenantSettingsPage';
const AdminSearchPage = lazy(() => import('./features/admin/AdminSearchPage').then((module) => ({ default: module.AdminSearchPage })));
const AdminRefundsPage = lazy(() => import('./features/admin/AdminRefundsPage').then((module) => ({ default: module.AdminRefundsPage })));
const AdminSystemCheckPage = lazy(() => import('./features/admin/AdminSystemCheckPage').then((module) => ({ default: module.AdminSystemCheckPage })));
const AdminDemoDataPage = lazy(() => import('./features/admin/AdminDemoDataPage').then((module) => ({ default: module.AdminDemoDataPage })));
import { ContractsPage } from './features/contracts/ContractsPage';
import { SellerDashboardPage } from './features/seller/SellerDashboardPage';
import { TenantLogo, useTenantConfig } from './tenants/TenantProvider';

const links = [
  { to: '/', label: 'Inicio', icon: LayoutDashboard, end: true },
  { to: '/comprar', label: 'Comprar', icon: Clover, roles: ['client'] as const },
  { to: '/tickets', label: 'Mis tickets', icon: Ticket, roles: ['client'] as const },
  { to: '/resultados', label: 'Resultados', icon: Trophy },
  { to: '/rifas', label: 'Rifas especiales', icon: Sparkles, roles: ['client'] as const, moduleFlag: 'rifasEspeciales' },
  { to: '/billetera', label: 'Mi billetera', icon: Wallet, roles: ['client'] as const },
  { to: '/jugadas-programadas', label: 'Jugadas programadas', icon: CalendarClock, roles: ['client'] as const },
  { to: '/favoritos', label: 'Números favoritos', icon: Heart, roles: ['client'] as const },
  { to: '/contratas', label: 'Contratas', icon: ReceiptText, roles: ['admin', 'seller'] as const, permissionAny: ['finance.manage','sale.register'] as const },
  { to: '/vendedor', label: 'Mi actividad', icon: ChartNoAxesCombined, roles: ['seller'] as const, permission: 'sale.register' },
  { to: '/premios', label: 'Mis premios', icon: Trophy, roles: ['client'] as const },
  { to: '/operacion/premios', label: 'Validar premios', icon: Banknote, roles: ['admin', 'worker'] as const, permission: 'prize.validate' },
  { to: '/pos', label: 'Punto de venta', icon: ReceiptText, roles: ['worker', 'seller'] as const, permission: 'sale.register' },
  { to: '/admin/comprobantes', label: 'Revisión de pagos', icon: Banknote, roles: ['admin', 'worker'] as const, permission: 'order.approve' },
  { to: '/admin', label: 'Panel administrativo', icon: LayoutDashboard, roles: ['admin'] as const, permission: 'report.view' },
  { to: '/admin/prueba-completa', label: 'Prueba completa', icon: ShieldCheck, roles: ['admin'] as const, permission: 'report.view' },
  { to: '/admin/datos-demo', label: 'Estado de datos DEMO', icon: Sparkles, roles: ['admin'] as const, permission: 'report.view' },
  { to: '/admin/usuarios', label: 'Usuarios, roles y permisos', icon: UserRound, roles: ['admin'] as const },
  { to: '/admin/busqueda', label: 'Búsqueda global', icon: Search, roles: ['admin'] as const, permission: 'report.view' },
  { to: '/admin/tenant', label: 'Marca y configuración', icon: Building2, roles: ['admin'] as const, permission: 'tenant.manage' },
  { to: '/admin/sorteos', label: 'Agenda de sorteos', icon: Clock3, roles: ['admin'] as const, permission: 'draw.create' },
  { to: '/admin/planes', label: 'Planes de premio', icon: Banknote, roles: ['admin'] as const, permission: 'plan.edit' },
  { to: '/admin/auditoria', label: 'Auditoría', icon: ClipboardList, roles: ['admin'] as const, permission: 'report.view' },
  { to: '/admin/comisiones', label: 'Comisiones de vendedores', icon: Banknote, roles: ['admin'] as const, permissionAll: ['commission.manage','finance.manage'] as const },
  { to: '/admin/finanzas', label: 'Finanzas y caja', icon: ChartNoAxesCombined, roles: ['admin'] as const, permissionAny: ['report.view','cash.close','finance.manage','refund.manage'] as const },
  { to: '/admin/reembolsos', label: 'Reembolsos', icon: Banknote, roles: ['admin'] as const, permission: 'refund.manage' },
  { to: '/admin/rifas', label: 'Administrar rifas', icon: Sparkles, roles: ['admin'] as const, permission: 'raffle.manage' },
  { to: '/admin/recargas', label: 'Revisión de recargas', icon: Wallet, roles: ['admin'] as const, permission: 'recharge.approve' },
  { to: '/admin/resultados', label: 'Publicar resultados', icon: Trophy, roles: ['admin'] as const, permission: 'result.edit' },
  { to: '/admin/retiros', label: 'Retiros', icon: Wallet, roles: ['admin'] as const, permission: 'withdrawal.manage' },
  { to: '/notificaciones', label: 'Notificaciones', icon: Bell },
  { to: '/cuenta', label: 'Mi cuenta', icon: UserRound },
];

const moduleDescriptions: Record<string, string> = {
  '/comprar': 'Selecciona un sorteo y prepara tu jugada.',
  '/tickets': 'Consulta tus comprobantes y compras emitidas.',
  '/resultados': 'Revisa los resultados publicados.',
  '/rifas': 'Consulta rifas y tus participaciones.',
  '/billetera': 'Revisa saldo, recargas y movimientos.',
  '/jugadas-programadas': 'Administra tus jugadas recurrentes.',
  '/favoritos': 'Guarda y reutiliza tus números favoritos.',
  '/contratas': 'Consulta cupos, ventas y cobros asignados.',
  '/vendedor': 'Revisa tus ventas, metas y comisiones.',
  '/premios': 'Consulta y gestiona tus premios.',
  '/operacion/premios': 'Valida tickets y procesa premios autorizados.',
  '/pos': 'Registra ventas y consulta tickets emitidos.',
  '/admin/comprobantes': 'Revisa pagos y procesa compras pendientes.',
  '/admin': 'Consulta indicadores y accesos administrativos.',
  '/admin/prueba-completa': 'Comprueba los servicios disponibles para tu rol.',
  '/admin/datos-demo': 'Revisa el estado agregado de los datos DEMO.',
  '/admin/usuarios': 'Administra cuentas, roles y permisos.',
  '/admin/busqueda': 'Localiza usuarios, compras y tickets.',
  '/admin/tenant': 'Configura la marca y los módulos del sistema.',
  '/admin/sorteos': 'Configura sorteos, horarios y sesiones.',
  '/admin/planes': 'Administra planes y premios por modalidad.',
  '/admin/auditoria': 'Consulta el historial de cambios y operaciones.',
  '/admin/comisiones': 'Crea, edita y publica reglas de comisión.',
  '/admin/finanzas': 'Consulta finanzas, caja y conciliaciones.',
  '/admin/reembolsos': 'Revisa y registra devoluciones autorizadas.',
  '/admin/rifas': 'Configura rifas, paquetes y participaciones.',
  '/admin/recargas': 'Revisa solicitudes de recarga y comprobantes.',
  '/admin/resultados': 'Publica y corrige resultados de sorteos.',
  '/admin/retiros': 'Gestiona solicitudes de retiro de premios.',
  '/notificaciones': 'Lee avisos y actualizaciones de tu cuenta.',
  '/cuenta': 'Actualiza tu perfil y preferencias de acceso.',
};

function canSeeLink(link: typeof links[number], user?: SessionUser, modules?: Record<string, boolean>) {
  const allowedRoles = 'roles' in link ? link.roles : undefined;
  if (allowedRoles && (!user || !allowedRoles.some((role) => role === user.role))) return false;
  const permissions = user?.permissions ?? [];
  const permission = 'permission' in link ? link.permission : undefined;
  const permissionAny = 'permissionAny' in link ? link.permissionAny : undefined;
  const permissionAll = 'permissionAll' in link ? link.permissionAll : undefined;
  if (permission && !permissions.includes(permission)) return false;
  if (permissionAny && !permissionAny.some((action) => permissions.includes(action))) return false;
  if (permissionAll && !permissionAll.every((action) => permissions.includes(action))) return false;
  const flag = 'moduleFlag' in link ? link.moduleFlag : undefined;
  return !flag || modules?.[flag] !== false;
}

function Shell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const authQuery = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: SessionUser }>('/api/auth/me', signal), retry: false, staleTime: 60_000 });
  const tenantQuery = useTenantConfig();
  const notificationQuery = useQuery({ queryKey: ['/api/notifications'], queryFn: ({ signal }) => getJson<ApiList<NotificationRecord> & { unreadCount: number }>('/api/notifications', signal), enabled: Boolean(authQuery.data), retry: false });
  const visibleLinks = links.filter((link) => canSeeLink(link, authQuery.data?.user, tenantQuery.data?.tenant.modules));
  const mobileLinks = authQuery.data?.user.role === 'seller'
    ? [visibleLinks.find((link) => link.to === '/vendedor'), visibleLinks.find((link) => link.to === '/pos'), visibleLinks.find((link) => link.to === '/contratas'), ...visibleLinks.filter((link) => !['/vendedor', '/pos', '/contratas'].includes(link.to))].filter((link): link is typeof links[number] => Boolean(link)).slice(0, 5)
    : authQuery.data?.user.role === 'worker'
    ? [visibleLinks.find((link) => link.to === '/pos'), ...visibleLinks.filter((link) => link.to !== '/pos')].filter((link): link is typeof links[number] => Boolean(link)).slice(0, 5)
    : authQuery.data?.user.role === 'client'
      ? [visibleLinks.find((link) => link.to === '/jugadas-programadas'), ...visibleLinks.filter((link) => link.to !== '/jugadas-programadas')].filter((link): link is typeof links[number] => Boolean(link)).slice(0, 5)
    : visibleLinks.slice(0, 5);
  const primaryPaths = new Set(['/', '/comprar', '/tickets', '/resultados', '/rifas', '/billetera']);
  const primaryLinks = visibleLinks.filter((link) => primaryPaths.has(link.to));
  const currentModule = links.find((link) => link.to !== '/' && location.pathname === link.to);
  const currentModuleDenied = Boolean(currentModule && !visibleLinks.includes(currentModule));
  return (
    <div className="app-shell fortuna-gold-app">
      <header className="shell-header">
        <div className="header-inner">
          <NavLink to="/" className="header-brand" aria-label="El Imperio de Ross · Inicio"><TenantLogo className="navigation-logo" alt="El Imperio de Ross"/><span className="header-tagline">Tu momento. Tu suerte. Tu fortuna.</span></NavLink>
          <nav className="header-nav" aria-label="Navegación principal">{primaryLinks.map(({ to, label, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'active' : ''}>{label === 'Mis tickets' ? 'Tickets' : label === 'Rifas especiales' ? 'Rifas' : label === 'Mi billetera' ? 'Billetera' : label}</NavLink>)}</nav>
          <div className="header-end">
            <NavLink to="/notificaciones" className="header-icon" aria-label={`Notificaciones${notificationQuery.data?.unreadCount ? `, ${notificationQuery.data.unreadCount} sin leer` : ''}`}><Bell size={18}/>{Boolean(notificationQuery.data?.unreadCount) && <span className="notification-count">{notificationQuery.data!.unreadCount > 99 ? '99+' : notificationQuery.data!.unreadCount}</span>}</NavLink>
            <NavLink to={authQuery.data ? '/cuenta' : '/acceso'} className="header-account"><span className="avatar">{authQuery.data?.user.fullName.charAt(0).toUpperCase() ?? 'R'}</span><span>{authQuery.data?.user.fullName.split(' ')[0] ?? 'Ingresar'}</span></NavLink>
            <button className="header-menu-toggle" aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={19}/> : <Menu size={19}/>}<span>Menú</span></button>
          </div>
        </div>
        {menuOpen && <nav className="gold-menu" aria-label="Menú del sistema">{visibleLinks.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)} className={({ isActive }) => `gold-menu-link ${isActive ? 'active' : ''}`}><Icon size={17}/><span>{label}</span><ArrowRight size={14}/></NavLink>)}</nav>}
      </header>
      <main className="main-area">
        <div className="page-content">{currentModuleDenied ? <RestrictedModule /> : <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/comprar" element={<BuyPage />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/resultados" element={<ResultsPage />} />
          <Route path="/rifas" element={<RafflesPage />} />
          <Route path="/billetera" element={<WalletPage />} />
          <Route path="/jugadas-programadas" element={<ScheduledPlaysPage />} />
          <Route path="/favoritos" element={<FavoritesPage />} />
          <Route path="/contratas" element={<ContractsPage />} />
          <Route path="/vendedor" element={<SellerDashboardPage />} />
          <Route path="/notificaciones" element={<NotificationsPage />} />
          <Route path="/admin/comprobantes" element={<AdminReviewPage />} />
          <Route path="/admin/recargas" element={<AdminRechargesPage />} />
          <Route path="/admin/resultados" element={<AdminResultsPage />} />
          <Route path="/premios" element={<MyPrizesPage />} />
          <Route path="/operacion/premios" element={<PrizeValidationPage />} />
          <Route path="/admin/retiros" element={<AdminWithdrawalsPage />} />
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/prueba-completa" element={<Suspense fallback={<section className="panel remote-state"><div className="loader"/><span>Cargando diagnóstico…</span></section>}><AdminSystemCheckPage /></Suspense>} />
          <Route path="/admin/datos-demo" element={<Suspense fallback={<section className="panel remote-state"><div className="loader"/><span>Consultando datos demo…</span></section>}><AdminDemoDataPage /></Suspense>} />
          <Route path="/admin/usuarios" element={<Suspense fallback={<section className="panel remote-state"><div className="loader"/><span>Cargando usuarios y permisos…</span></section>}><AdminUsersPage /></Suspense>} />
          <Route path="/admin/tenant" element={<AdminTenantSettingsPage />} />
          <Route path="/admin/busqueda" element={<Suspense fallback={<section className="panel remote-state"><div className="loader"/><span>Cargando búsqueda administrativa…</span></section>}><AdminSearchPage /></Suspense>} />
          <Route path="/admin/sorteos" element={<AdminSchedulePage />} />
          <Route path="/admin/planes" element={<Suspense fallback={<section className="panel remote-state"><div className="loader"/><span>Cargando planes de premio…</span></section>}><AdminPlansPage /></Suspense>} />
          <Route path="/admin/auditoria" element={<AdminAuditPage />} />
          <Route path="/admin/comisiones" element={<Suspense fallback={<section className="panel remote-state"><div className="loader"/><span>Cargando planes de comisión…</span></section>}><AdminCommissionPlansPage /></Suspense>} />
          <Route path="/admin/finanzas" element={<Suspense fallback={<section className="panel remote-state"><div className="loader"/><span>Cargando finanzas, caja y reembolsos…</span></section>}><AdminFinancePage /></Suspense>} />
          <Route path="/admin/reembolsos" element={<Suspense fallback={<section className="panel remote-state"><div className="loader"/><span>Cargando reembolsos…</span></section>}><AdminRefundsPage /></Suspense>} />
          <Route path="/admin/rifas" element={<AdminRafflesPage />} />
          <Route path="/pos" element={<PointOfSalePage />} />
          <Route path="/cuenta" element={<Account authQuery={authQuery} />} />
          <Route path="/consultar" element={<TicketLookupPage />} />
          <Route path="/guia" element={<ResponsiblePlayPage />} />
          <Route path="*" element={<EmptyState title="No encontramos esta página" message="Revisa la dirección o vuelve al inicio." />} />
        </Routes>}</div>
        <footer className="footer shell-footer"><div className="footer-inner"><TenantLogo variant="horizontal" className="footer-logo" alt="El Imperio de Ross"/><p className="footer-tagline">Tu momento. Tu suerte. Tu fortuna.</p><nav className="footer-nav" aria-label="Ayuda y navegación"><NavLink to="/consultar">Consultar ticket</NavLink><NavLink to="/guia">Juego responsable</NavLink><a href="mailto:soporte@imperiodeross.com">Centro de ayuda</a></nav><span className="footer-copy">© {new Date().getFullYear()} El Imperio de Ross · Solo mayores de 18 años</span></div></footer>
      </main>
      <nav className="mobile-nav" aria-label="Navegación móvil">{mobileLinks.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `mobile-nav-link ${isActive ? 'active' : ''}`}><Icon size={19} /><span>{label === 'Rifas especiales' ? 'Rifas' : label === 'Mis tickets' ? 'Tickets' : label}</span></NavLink>)}</nav>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function RestrictedModule() {
  return <section className="panel remote-state" role="alert"><span className="state-icon state-error"><ShieldCheck size={20}/></span><strong>Este módulo no está habilitado para tu cuenta</strong><span>El acceso depende de tu rol, tus permisos asignados y la configuración del tenant.</span><NavLink className="text-link" to="/">Volver a mi inicio <ArrowRight size={15}/></NavLink></section>;
}

function RequireSession({ children }: { children: ReactNode }) {
  const location = useLocation();
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: SessionUser }>('/api/auth/me', signal), retry: false, staleTime: 60_000 });
  if (auth.isPending) return <main className="auth-page"><section className="panel remote-state"><div className="loader"/><span>Verificando tu sesión segura…</span></section></main>;
  if (auth.isError || !auth.data) return <Navigate to="/acceso" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }}/>;
  return children;
}

function Home() {
  const sessions = useQuery({ queryKey: ['sessions', 'open'], queryFn: ({ signal }) => getJson<ApiList<OpenSession>>('/api/sessions/open', signal), refetchInterval: 30_000 });
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: SessionUser }>('/api/auth/me', signal), retry: false });
  const tenant = useTenantConfig();
  const user = auth.data?.user;
  const role = user?.role ?? '';
  const permissions = user?.permissions ?? [];
  const client = role === 'client';
  const showRaffles = client && tenant.data?.tenant.modules.rifasEspeciales !== false;
  const moduleLinks = user ? links.filter((link) => link.to !== '/' && canSeeLink(link, user, tenant.data?.tenant.modules)) : [];
  const wallet = useQuery({ queryKey: ['/api/wallet'], queryFn: ({ signal }) => getJson<{ wallet: { available_cents: string; reserved_cents: string } | null }>('/api/wallet', signal), enabled: client, retry: false });
  const [balanceVisible, setBalanceVisible] = useState(true);
  const draws = [...new Map((sessions.data?.items ?? []).map((session) => [session.drawId, session])).values()];
  const roleLabel: Record<string, string> = { admin: 'Panel de administración', worker: 'Panel de operaciones', seller: 'Panel de vendedor', client: 'Tu espacio personal' };
  return <div className="imperio-home">
    <section className="home-welcome"><div><p className="eyebrow">{roleLabel[role]?.toUpperCase() ?? 'EL IMPERIO DE ROSS'}</p><h1>{user?.fullName ? <>Hola, {user.fullName.split(' ')[0]}.</> : <>Tu momento de <em>suerte.</em></>}</h1><p>{client ? 'Hoy puede comenzar una gran historia.' : 'Aquí tienes tus herramientas y tareas disponibles.'}</p></div><TenantLogo variant="full_slogan" className="home-cover-logo" alt="El Imperio de Ross · Tu momento. Tu suerte. Tu fortuna."/></section>
    {client ? <section className="home-balance" aria-label="Saldo de la cuenta">
      <div className="balance-copy"><div className="balance-label">Mi saldo <button className="balance-visibility" type="button" aria-label={balanceVisible ? 'Ocultar saldo' : 'Mostrar saldo'} onClick={() => setBalanceVisible((shown) => !shown)}>{balanceVisible ? <Eye size={17}/> : <EyeOff size={17}/>}</button></div>
        {wallet.isPending ? <strong className="balance-amount">Cargando…</strong> : wallet.isError ? <p className="balance-signin">No pudimos consultar tu saldo.</p> : <><strong className="balance-amount">{balanceVisible ? dollars(wallet.data?.wallet?.available_cents ?? '0') : '••••••'}</strong><small>Disponible en tu billetera</small></>}
      </div><NavLink to="/billetera" className="button button-gold">Ir a mi billetera <ArrowRight size={16}/></NavLink><div className="balance-emblem" aria-hidden="true"><Clover size={58} strokeWidth={1}/></div>
    </section> : null}
    <section className="home-modules" aria-label="Accesos a módulos de esta cuenta">
      <div className="home-section-heading"><div><p className="eyebrow">{client ? 'TU CUENTA' : 'HERRAMIENTAS DE TRABAJO'}</p><h2>{client ? 'Tus módulos' : 'Módulos habilitados'}</h2></div></div>
      <nav className="home-module-grid" aria-label="Módulos de esta cuenta">
        {moduleLinks.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className="home-module-card"><span className="home-module-icon"><Icon size={20} strokeWidth={1.6}/></span><span className="home-module-copy"><strong>{label}</strong><small>{moduleDescriptions[to] ?? 'Abre las herramientas disponibles para tu cuenta.'}</small><span className="home-module-open">Abrir módulo <ArrowRight size={13}/></span></span></NavLink>)}
      </nav>
      {!moduleLinks.length && auth.isPending && <div className="draw-state"><div className="loader"/><span>Cargando módulos autorizados…</span></div>}
    </section>
    {showRaffles && <section className="home-special"><div className="special-banner-copy"><p className="eyebrow">ALGO EXTRAORDINARIO TE ESPERA</p><h2>Rifas especiales</h2><p>Explora premios y oportunidades especiales publicados por el equipo.</p><NavLink to="/rifas" className="button button-gold">Ver rifas <ArrowRight size={16}/></NavLink></div><div className="special-banner-art" aria-hidden="true"><span className="special-orbit special-orbit-one"/><span className="special-orbit special-orbit-two"/><span className="special-art-coin"><Sparkles size={38}/></span><Clover className="special-clover" size={27}/></div></section>}
    <section className="home-draws"><div className="home-section-heading"><div><p className="eyebrow">CADA DÍA, UNA OPORTUNIDAD</p><h2>Sorteos disponibles</h2></div><span>Horarios de Ecuador<br/>America/Guayaquil</span></div>
      {sessions.isPending ? <div className="draw-state"><div className="loader"/><span>Cargando sorteos desde el sistema…</span></div> : sessions.isError ? <div className="draw-state"><strong>No pudimos cargar los sorteos</strong><span>{sessions.error.message}</span><button className="text-link" type="button" onClick={() => void sessions.refetch()}>Intentar de nuevo <ArrowRight size={14}/></button></div> : !draws.length ? <div className="draw-state"><strong>Aún no hay sesiones disponibles</strong><span>La agenda mostrará sorteos cuando haya horarios abiertos.</span></div> : <div className="live-draw-grid">{draws.slice(0, 6).map((draw) => { const demo = draw.drawName.toUpperCase().includes('DEMO'); const actionTo = client ? `/comprar?sessionId=${encodeURIComponent(draw.id)}` : role === 'admin' && permissions.includes('draw.create') ? '/admin/sorteos' : '/pos'; const actionLabel = client ? 'Jugar este sorteo' : role === 'admin' ? 'Administrar agenda' : 'Abrir punto de venta'; return <article className={`live-draw-card ${demo ? 'is-demo' : ''}`} key={draw.id}><div className="live-draw-meta"><span>{draw.drawName.split(' · ')[0]}</span><span className={`draw-badge ${demo ? 'demo' : ''}`}>{demo ? 'DEMO · NO OFICIAL' : 'VENTA ABIERTA'}</span></div><h3>{draw.drawName.split(' · ').slice(1).join(' · ') || draw.drawName}</h3><p className="live-draw-date">{new Date(`${draw.drawDate}T12:00:00`).toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil', weekday: 'long', day: 'numeric', month: 'long' })} · {dateTime(draw.drawsAt)}</p><div className="live-draw-modalities">{draw.modalities.map((modality) => <span key={modality.digits}>{modality.digits} cifras · desde {dollars(modality.minCents)}</span>)}</div>{(client || role === 'admin' && permissions.includes('draw.create') || permissions.includes('sale.register')) && <NavLink className="button button-green live-draw-action" to={actionTo}>{actionLabel} <ArrowRight size={16}/></NavLink>}</article>; })}</div>}
    </section>
    {client && <div className="home-trust"><ShieldCheck size={18}/><span>Tu jugada queda registrada en tu cuenta.</span><NavLink to="/tickets">Consultar mis tickets <ArrowRight size={15}/></NavLink></div>}
  </div>;
}

function TicketLookupPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(normalized)) {
      setError('Ingresa el código de 8 caracteres que aparece en tu comprobante.');
      return;
    }
    setError('');
    navigate(`/verificar/${encodeURIComponent(normalized)}`);
  }
  return <><PageHeading eyebrow="CONSULTA PÚBLICA" title="Consulta tu ticket" description="Verifica el estado y los datos de juego con el código de tu comprobante. No mostramos datos personales."/><form className="panel account-panel ticket-lookup-form" onSubmit={submit}><label className="field-label" htmlFor="ticket-lookup-code">Código del ticket</label><input id="ticket-lookup-code" className="text-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} autoComplete="off" maxLength={8} placeholder="Ej. ABCD2345" aria-describedby={error ? 'ticket-lookup-error' : undefined}/>{error && <p id="ticket-lookup-error" className="form-notice error" role="alert">{error}</p>}<button className="button button-gold" type="submit"><Search size={16}/> Consultar ticket</button><p className="coming-note">El código está en el comprobante emitido. Esta consulta no solicita teléfono, contraseña ni datos bancarios.</p><NavLink className="text-link guest-lookup-link" to="/recuperar-compra">¿Compraste como invitado? Recupera tu compra <ArrowRight size={14}/></NavLink></form></>;
}

function ResponsiblePlayPage() {
  return <><PageHeading eyebrow="INFORMACIÓN Y CUIDADO" title="Juega con responsabilidad" description="El juego debe ser una actividad recreativa, voluntaria y dentro de tus posibilidades."/><section className="panel responsible-play"><div className="state-icon"><ShieldCheck size={22}/></div><h2>Cuida tus límites</h2><ul><li>Participa solo si tienes 18 años o más.</li><li>Define un presupuesto de entretenimiento y no uses dinero destinado a necesidades esenciales.</li><li>No persigas pérdidas ni solicites préstamos para jugar.</li><li>Haz pausas y detente si el juego deja de ser una actividad recreativa.</li><li>Si te preocupa tu forma de jugar, habla con alguien de confianza y busca orientación profesional local.</li></ul><p>El sistema registra las operaciones para que puedas consultar tus tickets y movimientos desde tu cuenta.</p><NavLink className="text-link" to="/cuenta">Administrar mi cuenta <ArrowRight size={15}/></NavLink></section></>;
}

type TicketRecord = { id: string; code: string; status: string; digits: number; totalCents: string; createdAt: string; drawName: string; drawDate: string };
type ResultRecord = { id: string; drawName: string; drawDate: string; digits: number; publishedAt: string; positions: Array<{ position: number; number: string }> };
type RafflePackage = { id: string; label: string; priceCents: string; chances: number };
type RaffleRecord = { id: string; name: string; description: string | null; prizeDescription: string; prizeValueCents: string; numberDigits: number; priceCents: string; opensAt: string; closesAt: string | null; closeMode: 'date' | 'sold_out' | 'manual'; status: string; soldCount: string; totalNumbers: string; percent: number; packages: RafflePackage[] };
type RafflePaymentOptions = { methods: Array<{ method: 'wallet'|'bank_transfer'; helpText: string|null }>; bankAccounts: Array<{ id:string;bankName:string;holder:string;accountType:string;accountNumber:string }> };
type RafflePurchaseRecord = { id:string;purchaseCode:string;status:string;totalCents:string;quantity:number;createdAt:string;raffleName:string;numbers:string[] };
type WalletRecord = { wallet: { available_cents: string; reserved_cents: string } | null; movements: Array<{ id: string; createdAt: string; type: string; amountCents: string; balanceAfterCents: string; reason: string }> };
type NotificationRecord = { id: string; type: string; title: string; body: string; createdAt: string; readAt: string | null };

function useItems<T>(endpoint: string, enabled = true) {
  return useQuery({ queryKey: [endpoint], queryFn: ({ signal }) => getJson<ApiList<T>>(endpoint, signal), select: (response) => response.items, enabled });
}
function dollars(cents: string) {
  try {
    const value = BigInt(cents); const sign = value < 0n ? '−' : ''; const amount = value < 0n ? -value : value;
    return `${sign}$${new Intl.NumberFormat('es-EC').format(amount / 100n)}.${(amount % 100n).toString().padStart(2, '0')}`;
  }
  catch { return '—'; }
}
function dateTime(value: string) { return new Date(value).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short' }); }
function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { pending: 'Pendiente', review: 'En revisión', in_review: 'En revisión', pending_review: 'Pendiente de revisión', approved: 'Aprobado', rejected: 'Rechazado', active: 'Activo', inactive: 'Inactivo', voided: 'Anulado', void: 'Anulado', won: 'Ganador', winner: 'Ganador', non_winner: 'Sin premio', paid: 'Pagado', generated: 'Generado', expired: 'Vencido', superseded: 'Anulado por corrección', credited_to_wallet: 'Acreditado a billetera', withdrawal_requested: 'Retiro solicitado', cancelled: 'Cancelado', open: 'Abierta', closed: 'Cerrada', sold_out: 'Agotada', published: 'Publicado', scheduled: 'Programado', resulted: 'Con resultado', requested: 'Solicitado', completed: 'Completado', refunded: 'Reembolsado', pending_payment: 'Pendiente de pago', not_applicable: 'No aplica', reconciled: 'Conciliado', reserved: 'Reservado', sold: 'Vendido', paused: 'En pausa', executed: 'Ejecutado', not_executed_insufficient_balance: 'No ejecutado por saldo insuficiente', draft: 'Borrador', drawn: 'Sorteada', partial: 'Parcial', collected: 'Cobrado', written_off: 'Dado de baja', guest: 'Invitado', admin: 'Administración', worker: 'Trabajador', seller: 'Vendedor', client: 'Cliente' };
  return <span className={`status-badge status-${status}`}>{labels[status] ?? 'Estado actualizado'}</span>;
}
function DataQueryState<T>({ query, emptyTitle, emptyText, children }: { query: { isPending: boolean; isError: boolean; error: Error | null; data: T[] | undefined; refetch: () => unknown }; emptyTitle: string; emptyText: string; children: (items: T[]) => ReactNode }) {
  if (query.isPending) return <div className="panel remote-state"><div className="loader"/><span>Cargando desde tu cuenta…</span></div>;
  if (query.isError) return <div className="panel remote-state"><span className="state-icon state-error"><X size={19}/></span><strong>No pudimos cargar los datos</strong><span>{query.error?.message}</span><button className="text-link" onClick={() => void query.refetch()}>Intentar de nuevo <ArrowRight size={15}/></button></div>;
  if (!query.data?.length) return <EmptyState title={emptyTitle} message={emptyText}/>;
  return <>{children(query.data)}</>;
}
function TicketsPage() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: SessionUser }>('/api/auth/me', signal), retry: false });
  const query = useItems<TicketRecord>('/api/tickets', Boolean(auth.data));
  return <><PageHeading eyebrow="TU ESPACIO PERSONAL" title="Mis tickets" description="Consulta tus compras y repite una jugada con revisión antes de volver a comprar."/>{auth.isPending ? <section className="panel remote-state"><div className="loader"/><span>Verificando tu sesión…</span></section> : !auth.data ? <section className="panel account-panel"><div className="account-lock"><ShieldCheck size={22}/></div><div><h2>Inicia sesión para consultar tus tickets</h2><p>Tu historial de compras es privado y está asociado a tu cuenta.</p></div><NavLink className="button button-green" to="/acceso">Iniciar sesión <ArrowRight size={16}/></NavLink></section> : <DataQueryState query={query} emptyTitle="Aún no tienes tickets" emptyText="Los tickets aparecerán aquí cuando una compra haya sido aprobada y emitida.">{(items) => <div className="record-list">{items.map((ticket) => <article className="panel record-card" key={ticket.id}><div className="record-symbol"><Ticket size={19}/></div><div className="record-main"><strong>Ticket {ticket.code}</strong><span>{ticket.drawName} · {new Date(`${ticket.drawDate}T12:00:00`).toLocaleDateString('es-EC', { dateStyle: 'medium' })}</span><small>{ticket.digits} cifras · {dateTime(ticket.createdAt)}</small><NavLink className="text-link" to={`/verificar/${ticket.code}`}>Ver comprobante público <ArrowRight size={13}/></NavLink>{ticket.status === 'active' && <NavLink className="text-link" to={`/comprar?repeatTicketId=${encodeURIComponent(ticket.id)}`}><Repeat2 size={14}/> Repetir jugada</NavLink>}</div><div className="record-end"><strong>{dollars(ticket.totalCents)}</strong><StatusBadge status={ticket.status}/></div></article>)}</div>}</DataQueryState>}</>;
}
function ResultsPage() {
  const query = useItems<ResultRecord>('/api/results');
  return <><PageHeading eyebrow="SORTEOS PUBLICADOS" title="Resultados" description="Resultados vigentes publicados por la administración."/><DataQueryState query={query} emptyTitle="Todavía no hay resultados publicados" emptyText="Los resultados aparecerán después de su publicación oficial.">{(items) => <div className="result-grid">{items.map((result) => <article className="panel result-card" key={result.id}><div className="panel-heading"><div><div className="eyebrow">{result.digits} CIFRAS</div><h2>{result.drawName}</h2></div><Trophy size={20}/></div><p>{new Date(`${result.drawDate}T12:00:00`).toLocaleDateString('es-EC', { dateStyle: 'full' })}</p>{result.positions.length ? <ol className="result-positions">{result.positions.map((position) => <li key={position.position}><span>{position.position}ª suerte</span><strong>{position.number}</strong></li>)}</ol> : <div className="empty-inline">No hay suertes registradas para este resultado.</div>}<small>Publicado {dateTime(result.publishedAt)}</small></article>)}</div>}</DataQueryState></>;
}
function RafflesPage() {
  const tenant = useTenantConfig();
  const query = useItems<RaffleRecord>('/api/raffles', tenant.isSuccess && tenant.data.tenant.modules.rifasEspeciales !== false);
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: SessionUser }>('/api/auth/me', signal), retry: false });
  const wallet = useQuery({ queryKey: ['/api/wallet'], queryFn: ({ signal }) => getJson<WalletRecord>('/api/wallet', signal), enabled: auth.data?.user.role === 'client' });
  const paymentOptions = useQuery({ queryKey: ['raffles','payment-options'], queryFn: ({ signal }) => getJson<RafflePaymentOptions>('/api/payment-options', signal), enabled: auth.data?.user.role === 'client', retry: false });
  const history = useQuery({ queryKey: ['raffles','purchases','mine'], queryFn: ({ signal }) => getJson<ApiList<RafflePurchaseRecord>>('/api/raffle-purchases/mine', signal), enabled: auth.data?.user.role === 'client', retry: false });
  if (tenant.isPending) return <><PageHeading eyebrow="PARTICIPACIONES ESPECIALES" title="Rifas especiales" description="Consulta las rifas abiertas y su progreso actual."/><section className="panel remote-state"><div className="loader"/><span>Cargando configuración…</span></section></>;
  if (tenant.isError) return <><PageHeading eyebrow="PARTICIPACIONES ESPECIALES" title="Rifas especiales" description="Consulta las rifas abiertas y su progreso actual."/><FormError message={tenant.error.message}/></>;
  if (tenant.data?.tenant.modules.rifasEspeciales === false) return <><PageHeading eyebrow="TU ESPACIO PERSONAL" title="Rifas especiales" description="Participaciones y premios especiales."/><EmptyState title="Este módulo no está disponible" message="La configuración de esta plataforma no tiene habilitadas las rifas especiales."/></>;
  return <><PageHeading eyebrow="PARTICIPACIONES ESPECIALES" title="Rifas especiales" description="Consulta premios, progreso, compra números y revisa tus participaciones." action={auth.data?.user.role === 'client' && <span className="raffle-wallet-balance">Saldo: {dollars(wallet.data?.wallet?.available_cents ?? '0')}</span>}/>{wallet.isError && auth.data?.user.role === 'client' && <FormError message={wallet.error.message}/>}<DataQueryState query={query} emptyTitle="No hay rifas abiertas" emptyText="Cuando se publique una rifa, aparecerá aquí.">{(items) => <div className="result-grid">{items.map((raffle) => <SpecialRaffleCard key={raffle.id} raffle={raffle} user={auth.data?.user} balanceCents={wallet.data?.wallet?.available_cents ?? '0'} paymentOptions={paymentOptions.data} paymentOptionsError={paymentOptions.error?.message} onPurchased={() => { void query.refetch(); void wallet.refetch(); void history.refetch(); }}/>)}</div>}</DataQueryState>{auth.data?.user.role==='client'&&<section className="panel raffle-history"><div className="panel-heading"><div><div className="eyebrow">TU ACTIVIDAD</div><h2>Mis participaciones</h2></div><Ticket size={19}/></div>{history.isError&&<FormError message={history.error.message}/>}{history.isPending?<div className="remote-state"><div className="loader"/>Cargando participaciones…</div>:history.data?.items.length?<div className="raffle-history-list">{history.data.items.map((item)=><article key={item.id}><div><strong>{item.raffleName} · {item.purchaseCode}</strong><small>{item.quantity} número(s) · {dateTime(item.createdAt)}</small></div><div><strong>{dollars(item.totalCents)}</strong><StatusBadge status={item.status}/></div>{item.numbers.length>0&&<span className="raffle-history-numbers">Tus números: {item.numbers.join(' · ')}</span>}</article>)}</div>:<div className="remote-state">Tus participaciones aparecerán aquí después de comprar.</div>}</section>}</>;
}

function SpecialRaffleCard({ raffle, user, balanceCents, paymentOptions, paymentOptionsError, onPurchased }: { raffle: RaffleRecord; user?: SessionUser; balanceCents: string; paymentOptions?: RafflePaymentOptions; paymentOptionsError?: string; onPurchased: () => void }) {
  const [packageId, setPackageId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [termsConfirmed, setTermsConfirmed] = useState(false);
  const [method, setMethod] = useState<'wallet'|'bank_transfer'>('wallet');
  const [bankId,setBankId]=useState('');const [proof,setProof]=useState<File|null>(null);const [proofError,setProofError]=useState('');const [idempotencyKey,setIdempotencyKey]=useState(()=>globalThis.crypto.randomUUID());
  const [purchase, setPurchase] = useState<{ purchaseCode: string; numbers: string[]; totalCents: string;status:string } | null>(null);
  const packages = raffle.packages ?? [];
  const selectedPackage = packages.find((item) => item.id === packageId);
  const unitCents = selectedPackage?.priceCents ?? raffle.priceCents;
  const totalCents = (BigInt(unitCents) * BigInt(quantity)).toString();
  const balanceAvailable = BigInt(balanceCents || '0') >= BigInt(totalCents);
  const client = user?.role === 'client';
  const methods=paymentOptions?.methods??[];const activeMethod=methods.some((item)=>item.method===method)?method:methods[0]?.method??method;
  const selectedBank=paymentOptions?.bankAccounts.find((item)=>item.id===bankId);
  const mutation = useMutation({
    mutationFn: () => {const payload={...(selectedPackage?{packageId:selectedPackage.id}:{}),quantity,adultConfirmed:true as const,termsConfirmed:true as const,idempotencyKey,paymentMethod:activeMethod,...(activeMethod==='bank_transfer'?{bankAccountId:bankId}:{})};if(activeMethod==='bank_transfer'&&proof){const form=new FormData();form.append('purchase',JSON.stringify(payload));form.append('proof',proof);return postFormData<{purchase:{purchaseCode:string;numbers:string[];totalCents:string;status:string}}>(`/api/raffles/${raffle.id}/purchases`,form);}return postJson<{purchase:{purchaseCode:string;numbers:string[];totalCents:string;status:string}}>(`/api/raffles/${raffle.id}/purchases`,payload);},
    onSuccess: (response) => { setPurchase(response.purchase); setAdultConfirmed(false); setTermsConfirmed(false); setIdempotencyKey(globalThis.crypto.randomUUID()); onPurchased(); },
  });
  return <article className="panel raffle-card">
    <div className="panel-heading"><div><div className="eyebrow">PREMIO</div><h2>{raffle.name}</h2></div><StatusBadge status={raffle.status}/></div>
    {raffle.description && <p>{raffle.description}</p>}<strong className="raffle-prize">{raffle.prizeDescription}</strong><span>Valor referencial: {dollars(raffle.prizeValueCents)}</span>
    <div className="raffle-progress"><div><span>{raffle.soldCount} de {raffle.totalNumbers} números</span><strong>{Math.round(Number(raffle.percent) || 0)}%</strong></div><progress max="100" value={Number(raffle.percent) || 0}/></div>
    <div className="record-meta"><span>{dollars(raffle.priceCents)} por número</span><span>{raffle.closeMode === 'date' && raffle.closesAt ? `Cierra ${dateTime(raffle.closesAt)}` : raffle.closeMode === 'sold_out' ? 'Cierra al agotarse' : 'Cierre manual'}</span></div>
    {purchase ? <div className="raffle-purchase-success" role="status"><strong>{purchase.status==='approved'?'Compra aprobada':'Participación recibida · pendiente de revisión'} · {purchase.purchaseCode}</strong><span>{dollars(purchase.totalCents)} · {purchase.status==='approved'?`${purchase.numbers.length} número(s)`:'Los números se asignarán al aprobar el pago.'}</span>{purchase.numbers.length>0&&<div>{purchase.numbers.join(' · ')}</div>}</div>
      : client ? <div className="raffle-purchase-form">
        {packages.length > 0 && <label className="field"><span>Paquete</span><select value={packageId} onChange={(event) => setPackageId(event.target.value)}><option value="">Compra por número ({dollars(raffle.priceCents)})</option>{packages.map((item) => <option value={item.id} key={item.id}>{item.label} · {item.chances} oportunidad(es) · {dollars(item.priceCents)}</option>)}</select></label>}
        <label className="field"><span>{selectedPackage ? 'Cantidad de paquetes' : 'Cantidad de números'}</span><input type="number" min={1} max={1000} step={1} value={quantity} onChange={(event) => setQuantity(Math.min(1000, Math.max(1, Number(event.target.value) || 1)))}/></label>
        <div className="raffle-payment-methods">{methods.map((item)=><button type="button" key={item.method} className={`payment-option ${activeMethod===item.method?'selected':''}`} onClick={()=>{setMethod(item.method);setIdempotencyKey(globalThis.crypto.randomUUID());}}><span className="payment-icon">{item.method==='wallet'?<Wallet size={16}/>:<Banknote size={16}/>}</span><span><strong>{item.method==='wallet'?'Mi billetera':'Transferencia bancaria'}</strong><small>{item.helpText??(item.method==='wallet'?'Pago inmediato':'Envío a revisión')}</small></span></button>)}</div>
        <div className="raffle-wallet-total"><span>{activeMethod==='wallet'?'Total con billetera':'Total a transferir'}</span><strong>{dollars(totalCents)}</strong>{activeMethod==='wallet'&&<small>Saldo disponible: {dollars(balanceCents)}</small>}</div>
        {activeMethod==='bank_transfer'&&<><label className="field"><span>Cuenta bancaria de destino</span><select required value={bankId} onChange={(event)=>{setBankId(event.target.value);setIdempotencyKey(globalThis.crypto.randomUUID());}}><option value="">Selecciona una cuenta…</option>{paymentOptions?.bankAccounts.map((bank)=><option value={bank.id} key={bank.id}>{bank.bankName} · {bank.accountType} · {bank.accountNumber}</option>)}</select></label>{selectedBank&&<div className="bank-card"><strong>{selectedBank.bankName}</strong><span>{selectedBank.holder} · {selectedBank.accountType}</span><code>{selectedBank.accountNumber}</code></div>}<label className="field proof-field"><span>Comprobante de transferencia</span><input type="file" accept="image/jpeg,image/png,application/pdf" required onChange={(event)=>{const file=event.target.files?.[0]??null;if(file&&(file.size>5*1024*1024||!['image/jpeg','image/png','application/pdf'].includes(file.type))){setProof(null);setProofError('Usa JPG, PNG o PDF de hasta 5 MB.');return;}setProof(file);setProofError('');setIdempotencyKey(globalThis.crypto.randomUUID());}}/><small>JPG, PNG o PDF · máximo 5 MB</small>{proof&&<small className="proof-name">{proof.name} · {(proof.size/1024).toFixed(0)} KB</small>}{proofError&&<small className="input-error">{proofError}</small>}</label></>}
        <label className="check-row"><input type="checkbox" checked={adultConfirmed} onChange={(event) => setAdultConfirmed(event.target.checked)}/><span>Confirmo que soy mayor de 18 años.</span></label>
        <label className="check-row"><input type="checkbox" checked={termsConfirmed} onChange={(event) => setTermsConfirmed(event.target.checked)}/><span>Revisé y acepto las condiciones de esta rifa.</span></label>
        {mutation.isError && <div className="form-notice error" role="alert">{mutation.error.message}</div>}
        {paymentOptionsError&&<div className="form-notice error" role="alert">{paymentOptionsError}</div>}
        {!paymentOptionsError && paymentOptions && paymentOptions.methods.length === 0 && <div className="form-notice error" role="status">No hay métodos de pago habilitados para esta rifa.</div>}
        <button type="button" className="button button-green raffle-buy-button" disabled={raffle.status !== 'open' || !adultConfirmed || !termsConfirmed || !paymentOptions || paymentOptions.methods.length === 0 || paymentOptionsError !== undefined || (activeMethod==='wallet'&&!balanceAvailable) || (activeMethod==='bank_transfer'&&(!bankId||!proof)) || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Procesando compra…' : activeMethod==='wallet'?(balanceAvailable?'Pagar y revelar números':'Saldo insuficiente'):'Enviar transferencia para revisión'} <ArrowRight size={15}/></button>
      </div> : <div className="raffle-sign-in"><span>Compra con saldo Ross Fortuna y revela tus números al instante.</span><NavLink className="button button-outline" to="/acceso">{user ? 'Usa una cuenta cliente' : 'Inicia sesión para comprar'}</NavLink></div>}
  </article>;
}
function WalletPage() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: SessionUser }>('/api/auth/me', signal), retry: false });
  const query = useQuery({ queryKey: ['/api/wallet'], queryFn: ({ signal }) => getJson<WalletRecord>('/api/wallet', signal), enabled: Boolean(auth.data) });
  return <><PageHeading eyebrow="SALDO Y MOVIMIENTOS" title="Mi billetera" description="Consulta el saldo, solicita recargas y revisa el historial de movimientos."/>{!auth.isPending && !auth.data ? <EmptyState title="Inicia sesión para consultar tu billetera" message="El saldo y los movimientos son privados y solo están disponibles en tu cuenta."/> : auth.data?.user.role === 'client' && <RechargePanel/>}{auth.data && query.data && <><section className="panel wallet-summary"><div><div className="eyebrow">SALDO DISPONIBLE</div><strong>{dollars(query.data.wallet?.available_cents ?? '0')}</strong><span>Reservado: {dollars(query.data.wallet?.reserved_cents ?? '0')}</span></div><Wallet size={25}/></section><section className="panel ledger-panel"><div className="panel-heading"><div><div className="eyebrow">ACTIVIDAD</div><h2>Movimientos recientes</h2></div></div>{query.data.movements.length ? <div className="ledger-list">{query.data.movements.map((movement) => <article key={movement.id} className="ledger-row"><span className="ledger-sign">{BigInt(movement.amountCents) >= 0 ? '+' : '−'}</span><div><strong>{movement.reason || movement.type.replaceAll('_', ' ')}</strong><small>{dateTime(movement.createdAt)} · Saldo {dollars(movement.balanceAfterCents)}</small></div><strong className={BigInt(movement.amountCents) >= 0 ? 'positive' : ''}>{dollars(movement.amountCents)}</strong></article>)}</div> : <div className="remote-state"><span className="state-icon"><Wallet size={18}/></span><strong>Sin movimientos todavía</strong><span>Los movimientos aparecerán al registrarse una operación.</span></div>}</section></>}{(auth.isPending || (auth.data && query.isPending)) && <div className="panel remote-state"><div className="loader"/><span>Cargando información segura…</span></div>}{query.isError && <FormError message={query.error.message}/>}</>;
}
function NotificationsPage() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: SessionUser }>('/api/auth/me', signal), retry: false });
  const query = useItems<NotificationRecord>('/api/notifications', Boolean(auth.data));
  const queryClient = useQueryClient();
  const markRead = useMutation({ mutationFn: (id: string) => postJson('/api/notifications/' + id + '/read', {}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/notifications'] }) });
  const markAllRead = useMutation({ mutationFn: () => postJson('/api/notifications/read-all', {}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/notifications'] }) });
  const heading = <PageHeading eyebrow="ACTIVIDAD DE TU CUENTA" title="Notificaciones" description="Avisos persistentes relacionados con tus operaciones." action={query.data?.some((item) => !item.readAt) ? <button className="button button-outline" type="button" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>{markAllRead.isPending ? 'Guardando…' : 'Marcar todas como leídas'}</button> : undefined}/>;
  return <>{heading}{(markRead.isError || markAllRead.isError) && <FormError message={(markRead.error ?? markAllRead.error)?.message ?? 'No pudimos actualizar las notificaciones.'} />}{!auth.isPending && !auth.data ? <EmptyState title="Inicia sesión para ver tus notificaciones" message="Las notificaciones de cuenta son privadas."/> : <DataQueryState query={query} emptyTitle="No tienes notificaciones" emptyText="Los avisos de tu actividad aparecerán aquí.">{(items) => <div className="record-list">{items.map((item) => <article className={`panel notification-card ${item.readAt ? '' : 'unread'}`} key={item.id}><span className="notification-dot"/><div><strong>{item.title}</strong><p>{item.body}</p><small>{dateTime(item.createdAt)}{item.readAt ? ' · Leída' : ' · Sin leer'}</small></div>{!item.readAt && <button type="button" className="text-link notification-read" disabled={markRead.isPending} onClick={() => markRead.mutate(item.id)}>Marcar leída</button>}</article>)}</div>}</DataQueryState>}</>;
}

interface PendingOrder {
  id: string; purchaseCode: string; buyerName: string; buyerPhone: string; buyerEmail: string | null;
  totalCents: string; paymentMethod: string; createdAt: string; paymentId: string;
  paymentStatus: string; referenceCode: string | null; proofUploadedAt: string | null;
  items: Array<{ drawName: string; drawDate: string; digits: number; number: string; amountCents: string }>;
  proofs: Array<{ id: string; mimeType: string; sizeBytes: number; uploadedAt: string }>;
}
interface ReviewDecision { decision: 'approve' | 'reject'; reason?: string; hint?: string }
const apiBase = import.meta.env.VITE_API_URL ?? '';

function AdminReviewPage() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: SessionUser }>('/api/auth/me', signal), retry: false });
  const allowed = auth.data?.user.role === 'admin' || auth.data?.user.role === 'worker';
  const queue = useQuery({ queryKey: ['/api/admin/orders/pending'], queryFn: ({ signal }) => getJson<ApiList<PendingOrder>>('/api/admin/orders/pending', signal), enabled: Boolean(allowed), retry: false, refetchInterval: 30_000 });
  const queryClient = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const decision = useMutation({
    mutationFn: ({ orderId, ...body }: ReviewDecision & { orderId: string }) => postJson<{ orderId: string; status: string; ticketIds: string[] }>(`/api/admin/orders/${orderId}/review`, body),
    onSuccess: async (result) => {
      setFeedback(result.status === 'rejected' ? 'El comprobante fue rechazado con el motivo registrado.' : result.status === 'refunded' ? 'La revisión terminó sin emitir tickets; revisa el estado del reembolso.' : `Compra aprobada. Tickets emitidos: ${result.ticketIds.length}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/admin/orders/pending'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/tickets'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/wallet'] }),
      ]);
    },
  });
  const heading = <PageHeading eyebrow="OPERACIÓN ADMINISTRATIVA" title="Revisión de pagos" description="Revisa comprobantes y registra una decisión con las reglas transaccionales del servidor."/>;
  const queueState = { isPending: queue.isPending, isError: queue.isError, error: queue.error, data: queue.data?.items, refetch: queue.refetch };
  if (auth.isPending) return <>{heading}<section className="panel remote-state"><div className="loader"/><span>Verificando tu sesión…</span></section></>;
  if (!auth.data) return <>{heading}<EmptyState title="Inicia sesión con una cuenta autorizada" message="Esta cola contiene datos de compradores y solo está disponible para personal autorizado."/></>;
  if (!allowed) return <>{heading}<EmptyState title="No tienes acceso a esta sección" message="La revisión de pagos requiere permisos de operación configurados para tu usuario."/></>;
  return <>{heading}
    <section className="panel review-intro"><ShieldCheck size={19}/><span>Las decisiones se validan y auditan en PostgreSQL. Aprobar puede emitir tickets; el comprobante por sí solo nunca activa una jugada.</span><button className="text-link" type="button" onClick={() => void queue.refetch()}>Actualizar <ArrowRight size={14}/></button></section>
    {feedback && <div className="form-notice success" role="status">{feedback}</div>}
    {decision.isError && <FormError message={decision.error.message}/>}
    <DataQueryState query={queueState} emptyTitle="No hay comprobantes pendientes" emptyText="Las compras pendientes de revisión aparecerán aquí.">{(items) => <div className="review-list">{items.map((order) => <article className="panel review-card" key={order.id}>
      <div className="review-card-head"><div><div className="eyebrow">COMPRA {order.purchaseCode}</div><h2>{dollars(order.totalCents)}</h2></div><StatusBadge status={order.paymentStatus}/></div>
      <div className="review-buyer"><strong>{order.buyerName}</strong><span>{order.buyerPhone}{order.buyerEmail ? ` · ${order.buyerEmail}` : ''}</span><small>{dateTime(order.createdAt)} · {order.paymentMethod === 'bank_transfer' ? 'Transferencia bancaria' : order.paymentMethod}</small></div>
      <div className="review-lines">{order.items.map((item, index) => <div className="review-line" key={`${order.id}-${index}`}><strong>{item.number}</strong><span>{item.digits} cifras · {item.drawName} · {new Date(`${item.drawDate}T12:00:00`).toLocaleDateString('es-EC', { dateStyle: 'medium' })}</span><b>{dollars(item.amountCents)}</b></div>)}</div>
      {order.referenceCode && <div className="review-reference">Referencia de pago: <code>{order.referenceCode}</code></div>}
      <div className="review-proofs"><strong>Comprobantes</strong>{order.proofs.length ? order.proofs.map((proof) => <a key={proof.id} href={`${apiBase}/api/admin/orders/${order.id}/proofs/${proof.id}`} target="_blank" rel="noreferrer">Abrir {proof.mimeType === 'application/pdf' ? 'PDF' : 'imagen'} · {(proof.sizeBytes / 1024).toFixed(0)} KB <ArrowRight size={14}/></a>) : <span>Esta compra no tiene archivo adjunto.</span>}</div>
      <label className="field review-reason"><span>Motivo de aprobación o rechazo <small>Requerido si la operación lo solicita</small></span><textarea rows={2} maxLength={500} value={reasons[order.id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [order.id]: event.target.value }))}/></label>
      <div className="review-actions"><button className="button button-outline review-reject" type="button" disabled={decision.isPending || (reasons[order.id] ?? '').trim().length < 3} onClick={() => { if (window.confirm(`¿Rechazar la compra ${order.purchaseCode}? Se registrará el motivo y no se emitirán tickets.`)) decision.mutate({ orderId: order.id, decision: 'reject', reason: reasons[order.id] }); }}>Rechazar</button><button className="button button-green" type="button" disabled={decision.isPending} onClick={() => { if (window.confirm(`¿Aprobar la compra ${order.purchaseCode}? Esta acción puede emitir tickets y no se puede repetir.`)) decision.mutate({ orderId: order.id, decision: 'approve', ...(reasons[order.id]?.trim() ? { reason: reasons[order.id].trim() } : {}) }); }}>{decision.isPending ? 'Guardando…' : 'Aprobar y procesar'} <Check size={16}/></button></div>
    </article>)}</div>}</DataQueryState>
  </>;
}

interface PendingRecharge {
  id: string; amountCents: string; status: string; requestedAt: string; buyerName: string; buyerPhone: string;
  buyerEmail: string | null; bankName: string | null; bankAccountNumber: string | null; referenceCode: string | null;
  proofs: Array<{ id: string; mimeType: string; sizeBytes: number; uploadedAt: string }>;
}

function AdminRechargesPage() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: SessionUser }>('/api/auth/me', signal), retry: false });
  const allowed = auth.data?.user.role === 'admin';
  const queue = useQuery({ queryKey: ['/api/admin/recharges/pending'], queryFn: ({ signal }) => getJson<ApiList<PendingRecharge>>('/api/admin/recharges/pending', signal), enabled: Boolean(allowed), retry: false, refetchInterval: 30_000 });
  const queryClient = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [hints, setHints] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const review = useMutation({
    mutationFn: ({ rechargeId, ...body }: { rechargeId: string; decision: 'approve' | 'reject'; reason?: string; hint?: string }) => postJson<{ rechargeId: string; status: string }>(`/api/admin/recharges/${rechargeId}/review`, body),
    onSuccess: async (result) => {
      setFeedback(result.status === 'approved' ? 'Recarga aprobada y saldo acreditado en el libro de movimientos.' : 'Recarga rechazada; el cliente verá el motivo y podrá corregirla.');
      await queryClient.invalidateQueries({ queryKey: ['/api/admin/recharges/pending'] });
    },
  });
  const heading = <PageHeading eyebrow="OPERACIÓN ADMINISTRATIVA" title="Revisión de recargas" description="El saldo solo se acredita cuando apruebas una transferencia pendiente."/>;
  const queueState = { isPending: queue.isPending, isError: queue.isError, error: queue.error, data: queue.data?.items, refetch: queue.refetch };
  if (auth.isPending) return <>{heading}<section className="panel remote-state"><div className="loader"/><span>Verificando tu sesión…</span></section></>;
  if (!auth.data) return <>{heading}<EmptyState title="Inicia sesión como administrador" message="La revisión de recargas requiere permisos administrativos."/></>;
  if (!allowed) return <>{heading}<EmptyState title="No tienes acceso a esta sección" message="La aprobación de recargas está reservada a Administración."/></>;
  return <>{heading}
    <section className="panel review-intro"><ShieldCheck size={19}/><span>Al aprobar, PostgreSQL acredita una sola vez el monto y registra el movimiento en el ledger y finanzas. Rechazar conserva el registro y permite corregirlo.</span><button className="text-link" type="button" onClick={() => void queue.refetch()}>Actualizar <ArrowRight size={14}/></button></section>
    {feedback && <div className="form-notice success" role="status">{feedback}</div>}
    {review.isError && <FormError message={review.error.message}/>}
    <DataQueryState query={queueState} emptyTitle="No hay recargas pendientes" emptyText="Las solicitudes nuevas aparecerán aquí cuando un cliente envíe su comprobante.">{(items) => <div className="review-list">{items.map((item) => <article className="panel review-card" key={item.id}>
      <div className="review-card-head"><div><div className="eyebrow">RECARGA PENDIENTE</div><h2>{dollars(item.amountCents)}</h2></div><StatusBadge status={item.status}/></div>
      <div className="review-buyer"><strong>{item.buyerName}</strong><span>{item.buyerPhone}{item.buyerEmail ? ` · ${item.buyerEmail}` : ''}</span><small>{dateTime(item.requestedAt)}{item.bankName ? ` · ${item.bankName}` : ''}</small></div>
      {item.bankAccountNumber && <div className="review-reference">Cuenta receptora: <code>{item.bankAccountNumber}</code></div>}
      {item.referenceCode && <div className="review-reference">Referencia de recarga: <code>{item.referenceCode}</code></div>}
      <div className="review-proofs"><strong>Comprobante</strong>{item.proofs.map((proof) => <a key={proof.id} href={`${apiBase}/api/admin/recharges/${item.id}/proofs/${proof.id}`} target="_blank" rel="noreferrer">Abrir {proof.mimeType === 'application/pdf' ? 'PDF' : 'imagen'} · {(proof.sizeBytes / 1024).toFixed(0)} KB <ArrowRight size={14}/></a>)}</div>
      <label className="field review-reason"><span>Motivo del rechazo</span><textarea rows={2} maxLength={500} value={reasons[item.id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [item.id]: event.target.value }))}/></label>
      <label className="field review-reason"><span>Instrucción para corregir <small>Opcional</small></span><textarea rows={2} maxLength={300} value={hints[item.id] ?? ''} onChange={(event) => setHints((current) => ({ ...current, [item.id]: event.target.value }))}/></label>
      <div className="review-actions"><button className="button button-outline review-reject" type="button" disabled={review.isPending || (reasons[item.id] ?? '').trim().length < 3} onClick={() => { if (window.confirm('¿Rechazar esta recarga? El saldo no se acreditará.')) review.mutate({ rechargeId: item.id, decision: 'reject', reason: reasons[item.id], ...(hints[item.id]?.trim() ? { hint: hints[item.id].trim() } : {}) }); }}>Rechazar</button><button className="button button-green" type="button" disabled={review.isPending} onClick={() => { if (window.confirm(`¿Aprobar la recarga de ${dollars(item.amountCents)} y acreditar el saldo?`)) review.mutate({ rechargeId: item.id, decision: 'approve' }); }}>{review.isPending ? 'Guardando…' : 'Aprobar recarga'} <Check size={16}/></button></div>
    </article>)}</div>}</DataQueryState>
  </>;
}

interface AdminResultModality { digits: 2 | 3 | 4; maxSuertes: number; resultId: string | null; version: number | null; publishedAt: string | null; positions: string[] }
interface AdminResultSession { sessionId: string; drawDate: string; status: string; drawsAt: string; drawName: string; modalities: AdminResultModality[] }
interface SaveResult { sessionId: string; digits: 2 | 3 | 4; positions: string[]; reason?: string }

function AdminResultsPage() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: SessionUser }>('/api/auth/me', signal), retry: false });
  const allowed = auth.data?.user.role === 'admin';
  const query = useItems<AdminResultSession>('/api/admin/results/sessions', Boolean(allowed));
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState('');
  const [digits, setDigits] = useState<2 | 3 | 4>(2);
  const [positions, setPositions] = useState<string[]>(['']);
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const session = query.data?.find((item) => item.sessionId === sessionId);
  const modality = session?.modalities.find((item) => item.digits === digits);
  const isEditing = Boolean(modality?.resultId);
  const save = useMutation({
    mutationFn: (body: SaveResult) => postJson<{ resultId: string; unchanged: boolean }>('/api/admin/results', body),
    onSuccess: async (result) => {
      setFeedback(result.unchanged ? 'Este resultado ya estaba publicado sin cambios.' : 'Resultado publicado y premios procesados por PostgreSQL.');
      setReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/admin/results/sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/results'] }),
      ]);
    },
  });
  const chooseSession = (value: string) => {
    setSessionId(value);
    setReason('');
    const next = query.data?.find((item) => item.sessionId === value);
    const firstModality = next?.modalities[0];
    if (firstModality) { setDigits(firstModality.digits); setPositions(firstModality.positions.length ? firstModality.positions : ['']); }
  };
  const chooseDigits = (value: string) => {
    const nextDigits = Number(value) as 2 | 3 | 4;
    setDigits(nextDigits);
    setReason('');
    const next = session?.modalities.find((item) => item.digits === nextDigits);
    setPositions(next?.positions.length ? next.positions : ['']);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!session || !modality || positions.some((number) => number.length !== digits) || (isEditing && reason.trim().length < 5)) return;
    const action = isEditing ? 'reemplazar el resultado vigente y recalcular los premios afectados' : 'publicar este resultado y procesar los premios';
    if (!window.confirm(`¿Confirmas ${action} para ${session.drawName} (${digits} cifras)?`)) return;
    save.mutate({ sessionId, digits, positions, ...(reason.trim() ? { reason: reason.trim() } : {}) });
  };
  const heading = <PageHeading eyebrow="OPERACIÓN ADMINISTRATIVA" title="Publicar resultados" description="Registra resultados oficiales. PostgreSQL conserva cada versión y procesa los premios en una transacción."/>;
  if (auth.isPending) return <>{heading}<section className="panel remote-state"><div className="loader"/><span>Verificando tu sesión…</span></section></>;
  if (!auth.data) return <>{heading}<EmptyState title="Inicia sesión como administrador" message="La publicación de resultados requiere una cuenta administrativa autorizada."/></>;
  if (!allowed) return <>{heading}<EmptyState title="No tienes acceso a esta sección" message="Solo el rol de administración puede registrar o modificar resultados."/></>;
  return <>{heading}
    <section className="panel review-intro"><ShieldCheck size={19}/><span>Un resultado publicado puede generar o sustituir premios. Toda corrección requiere motivo y queda versionada con auditoría.</span><button className="text-link" type="button" onClick={() => void query.refetch()}>Actualizar <ArrowRight size={14}/></button></section>
    {feedback && <div className="form-notice success" role="status">{feedback}</div>}
    {save.isError && <FormError message={save.error.message}/>}
    {query.isPending && <section className="panel remote-state"><div className="loader"/><span>Cargando sorteos desde PostgreSQL…</span></section>}
    {query.isError && <FormError message={query.error.message}/>}
    {query.data && !query.data.length && <EmptyState title="No hay sorteos disponibles para resultados" message="Las sesiones no canceladas aparecerán aquí cuando existan en la base."/>}
    {session && modality?.resultId && <section className="panel current-result-note"><div><div className="eyebrow">VERSIÓN VIGENTE · V{modality.version}</div><strong>{modality.positions.map((number, index) => `${index + 1}ª ${number}`).join('  ·  ')}</strong></div><StatusBadge status="published"/></section>}
    <form className="panel admin-result-form" onSubmit={submit}>
      <label className="field"><span>Sorteo y fecha</span><select value={sessionId} onChange={(event) => chooseSession(event.target.value)} required><option value="">Selecciona una sesión…</option>{query.data?.map((item) => <option key={item.sessionId} value={item.sessionId}>{item.drawName} · {new Date(`${item.drawDate}T12:00:00`).toLocaleDateString('es-EC', { dateStyle: 'medium' })}</option>)}</select></label>
      <label className="field"><span>Modalidad</span><select value={digits} onChange={(event) => chooseDigits(event.target.value)} disabled={!session} required>{(session?.modalities ?? []).map((item) => <option key={item.digits} value={item.digits}>{item.digits} cifras</option>)}</select></label>
      {modality && <div className="field"><span>Suertes publicadas <small>Máximo {modality.maxSuertes}; conserva los ceros iniciales</small></span><div className="result-number-list">{positions.map((number, index) => <label className="result-number-field" key={index}><span>{index + 1}ª suerte</span><input inputMode="numeric" autoComplete="off" maxLength={digits} pattern={`[0-9]{${digits}}`} placeholder={'0'.repeat(digits)} value={number} onChange={(event) => setPositions((current) => current.map((value, position) => position === index ? event.target.value.replace(/\D/g, '').slice(0, digits) : value))} required/></label>)}</div><button className="text-link result-add" type="button" disabled={positions.length >= modality.maxSuertes} onClick={() => setPositions((current) => [...current, ''])}><Plus size={15}/> Agregar suerte</button></div>}
      {isEditing && <label className="field"><span>Motivo de la corrección <small>Requerido; mínimo 5 caracteres</small></span><textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} required minLength={5}/></label>}
      <div className="result-submit-row"><p>{isEditing ? 'La versión anterior quedará en el historial. Los premios pendientes se recalcularán según la función de negocio.' : 'La publicación activa el cálculo de premios en la base de datos.'}</p><button className="button button-green" type="submit" disabled={save.isPending || !session || !modality || positions.some((number) => number.length !== digits) || (isEditing && reason.trim().length < 5)}>{save.isPending ? 'Publicando…' : isEditing ? 'Publicar corrección' : 'Publicar resultado'} <Save size={16}/></button></div>
    </form>
  </>;
}

interface SessionUser { id: string; role: string; fullName: string; phone: string; email: string | null; locationId: string | null; permissions?: string[] }
type AuthQuery = UseQueryResult<{ user: SessionUser }, Error>;

function Account({ authQuery }: { authQuery: AuthQuery }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({ mutationFn: () => postJson<void>('/api/auth/logout', {}), onSuccess: () => { queryClient.clear(); navigate('/acceso', { replace: true }); } });
  if (authQuery.isPending) return <><PageHeading eyebrow="PERFIL Y SEGURIDAD" title="Mi cuenta" description="Consulta tus datos y preferencias de cuenta." /><section className="panel remote-state"><div className="loader"/><span>Consultando tu sesión…</span></section></>;
  if (!authQuery.data) return <><PageHeading eyebrow="PERFIL Y SEGURIDAD" title="Mi cuenta" description="Inicia sesión para consultar tus datos personales y preferencias." /><section className="panel account-panel"><div className="account-lock"><ShieldCheck size={22} /></div><div><h2>Accede a tu cuenta</h2><p>Tu perfil, compras y movimientos estarán protegidos por tu sesión.</p></div><NavLink className="button button-green" to="/acceso">Iniciar sesión <ArrowRight size={16} /></NavLink><span className="coming-note">¿Aún no tienes cuenta? <NavLink to="/registro">Regístrate aquí</NavLink></span></section></>;
  const user = authQuery.data.user;
  return <><PageHeading eyebrow="PERFIL Y SEGURIDAD" title={`Hola, ${user.fullName.split(' ')[0]}`} description="Administra tus datos personales, protege tu acceso y consulta tu actividad." action={<button className="button button-outline" onClick={() => logout.mutate()} disabled={logout.isPending}>{logout.isPending ? 'Cerrando…' : 'Cerrar sesión'}</button>} />{logout.isError && <FormError message={logout.error.message} />}<section className="panel account-details"><span className="avatar account-avatar">{user.fullName.charAt(0).toUpperCase()}</span><div><div className="eyebrow">CUENTA PERSONAL</div><h2>{user.fullName}</h2><p>{user.phone}{user.email ? ` · ${user.email}` : ''}</p></div></section><AccountSettings user={user}/><section className="account-links"><NavLink to="/tickets"><Ticket /><span><strong>Mis tickets</strong><small>Consulta tus jugadas confirmadas</small></span><ArrowRight /></NavLink><NavLink to="/billetera"><Wallet /><span><strong>Mi billetera</strong><small>Saldo y movimientos de tu cuenta</small></span><ArrowRight /></NavLink><NavLink to="/notificaciones"><Bell /><span><strong>Notificaciones</strong><small>Avisos relacionados con tu cuenta</small></span><ArrowRight /></NavLink></section></>;
}

function FormError({ message }: { message: string }) { return <div className="form-notice error" role="alert">{message}</div>; }

function EmptyState({ title, message }: { title: string; message: string }) {
  return <section className="panel remote-state"><span className="state-icon"><CircleHelp size={20} /></span><strong>{title}</strong><span>{message}</span><NavLink to="/" className="text-link">Volver al inicio <ArrowRight size={15} /></NavLink></section>;
}

export default function App() {
  return <Routes>
    <Route path="/acceso" element={<LoginPage />} />
    <Route path="/registro" element={<RegisterPage />} />
    <Route path="/recuperar" element={<RecoveryPage />} />
    <Route path="/recuperar-compra" element={<GuestPurchaseRecoveryPage />} />
    <Route path="/verificar/:codigo" element={<VerifyTicketPage />} />
    <Route path="*" element={<RequireSession><Shell /></RequireSession>} />
  </Routes>;
}
