import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { getJson } from '../../services/http';
import { RefundsPanel } from './RefundsPanel';

export function AdminRefundsPage() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: { role: string; permissions: string[] } }>('/api/auth/me', signal), retry: false });
  if (auth.isPending) return <section className="panel remote-state"><div className="loader"/><span>Verificando permisos…</span></section>;
  if (auth.data?.user.role !== 'admin' || !auth.data.user.permissions.includes('refund.manage')) return <section className="panel remote-state"><ShieldCheck size={20}/><strong>Acceso restringido</strong><span>Se requiere Administración y el permiso refund.manage.</span></section>;
  return <div className="admin-refunds-page"><div className="page-heading"><div><div className="eyebrow">CONTROL FINANCIERO</div><h1>Reembolsos</h1><p>Revisa devoluciones pendientes y registra su resolución con trazabilidad.</p></div></div><RefundsPanel/></div>;
}
