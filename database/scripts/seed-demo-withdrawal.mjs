import pg from 'pg';

// Solicitud pendiente sobre el premio que ganó la compra DEMO, sin marcar pago externo.
const tenantId = 'a0000000-0000-0000-0000-000000000001';
const adminId = 'c0000000-0000-0000-0000-000000000001';
const clientId = 'c0000000-0000-0000-0000-000000000004';
const key = 'd0000000-0000-4000-8000-000000000001';
if (process.env.NODE_ENV !== 'development') throw new Error('Solo se ejecuta en desarrollo local.');
const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error('DATABASE_ADMIN_URL es obligatorio.');
const connection = new URL(connectionString);
if (!['localhost', '127.0.0.1', '::1'].includes(connection.hostname) || connection.pathname !== '/imperio_de_ross') {
  throw new Error('El seed solo puede escribir en localhost/imperio_de_ross.');
}

const pool = new pg.Pool({ connectionString, max: 1, application_name: 'imperio-ross-demo-withdrawal', options: '-c search_path=app,public' });
try {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.environment','development',true)", [tenantId, adminId]);
    const fixture = await db.query(
      `SELECT p.id FROM app.prizes p JOIN app.tickets t ON t.id=p.ticket_id AND t.tenant_id=p.tenant_id
       JOIN app.orders o ON o.id=t.order_id AND o.tenant_id=t.tenant_id
       JOIN app.users u ON u.id=o.user_id AND u.tenant_id=o.tenant_id
       WHERE p.tenant_id=$1 AND o.idempotency_key='demo-local-operations-ticket-v1'
         AND u.id=$2 AND u.is_demo AND p.status IN ('pending','generated') LIMIT 1`, [tenantId, clientId],
    );
    let withdrawalId;
    if (fixture.rowCount) {
      await db.query("SELECT set_config('app.user_id',$1,true)", [clientId]);
      const result = await db.query('SELECT app.fn_request_withdrawal($1,0,$2,$3) AS id', [clientId, fixture.rows[0].id, key]);
      withdrawalId = result.rows[0].id;
    } else {
      const prior = await db.query('SELECT id FROM app.withdrawals WHERE tenant_id=$1 AND user_id=$2 AND idempotency_key=$3', [tenantId, clientId, key]);
      if (!prior.rowCount) throw new Error('No existe el premio DEMO esperado para crear la solicitud; no se aplicaron cambios.');
      withdrawalId = prior.rows[0].id;
    }
    const check = await db.query(
      `SELECT w.status AS withdrawal_status,p.status AS prize_status
       FROM app.withdrawals w JOIN app.prizes p ON p.id=w.source_prize_id AND p.tenant_id=w.tenant_id
       WHERE w.id=$1 AND w.tenant_id=$2`, [withdrawalId, tenantId],
    );
    if (check.rows[0]?.withdrawal_status !== 'requested' || check.rows[0]?.prize_status !== 'withdrawal_requested') {
      throw new Error(`La solicitud no quedó pendiente como se esperaba: ${JSON.stringify(check.rows[0] ?? null)}`);
    }
    await db.query('COMMIT');
    console.log('Solicitud de retiro DEMO quedó pendiente; no se marcó transferencia ni pago.');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { db.release(); }
} finally { await pool.end(); }
