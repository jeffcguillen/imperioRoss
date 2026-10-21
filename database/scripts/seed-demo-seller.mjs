import pg from 'pg';

// Fixture local idempotente para probar POS, comisiones y Contratas del vendedor.
// Ejecutar con NODE_ENV=development y DATABASE_ADMIN_URL apuntando a localhost.
const tenantId = 'a0000000-0000-0000-0000-000000000001';
const adminId = 'c0000000-0000-0000-0000-000000000001';
const sellerId = 'c0000000-0000-0000-0000-000000000003';
const drawCode = 'DEMO-LOCAL-OPERACIONES';
const orderKey = 'demo-seller-pos-v1';
const contractName = 'DEMO · Contrata vendedor';

if (process.env.NODE_ENV !== 'development') throw new Error('Solo se ejecuta en desarrollo local.');
const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error('DATABASE_ADMIN_URL es obligatorio.');
const connection = new URL(connectionString);
if (!['localhost', '127.0.0.1', '::1'].includes(connection.hostname) || connection.pathname !== '/imperio_de_ross') {
  throw new Error('El seed solo puede escribir en localhost/imperio_de_ross.');
}

const pool = new pg.Pool({ connectionString, max: 1, application_name: 'imperio-ross-demo-seller', options: '-c search_path=app,public' });
try {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT set_config($1,$2,true),set_config($3,$4,true),set_config($5,$6,true)', [
      'app.tenant_id', tenantId, 'app.user_id', adminId, 'app.environment', 'development',
    ]);

    const identity = await db.query(
      `SELECT (SELECT timezone FROM app.tenants WHERE id=$1) AS timezone,
              EXISTS(SELECT 1 FROM app.users WHERE id=$2 AND tenant_id=$1 AND role='admin' AND is_demo AND is_active) AS admin_ok,
              EXISTS(SELECT 1 FROM app.users WHERE id=$3 AND tenant_id=$1 AND role='seller' AND is_demo AND is_active AND location_id IS NOT NULL) AS seller_ok,
              app.fn_can($3,'sale.register') AS can_sell,
              app.fn_can($2,'commission.manage') AND app.fn_can($2,'finance.manage') AS can_manage_commissions,
              (SELECT id FROM app.draws WHERE tenant_id=$1 AND code=$4 AND is_active) AS draw_id,
              (SELECT id FROM app.plans WHERE tenant_id=$1 AND draw_id=(SELECT id FROM app.draws WHERE tenant_id=$1 AND code=$4) AND digits=2 AND name='DEMO LOCAL · NO OFICIAL' AND is_active ORDER BY created_at DESC LIMIT 1) AS play_plan_id`,
      [tenantId, adminId, sellerId, drawCode],
    );
    const fixture = identity.rows[0];
    if (!fixture.timezone || !fixture.admin_ok || !fixture.seller_ok || !fixture.can_sell || !fixture.can_manage_commissions || !fixture.draw_id || !fixture.play_plan_id) {
      throw new Error('Faltan tenant, identidades DEMO, permisos o configuración de sorteo/plan; no se aplicaron cambios.');
    }

    let commissionPlan = await db.query(
      `SELECT id FROM app.commission_plans WHERE tenant_id=$1 AND seller_id=$2 AND draw_id=$3 AND digits=2
        AND base='sales_percent' AND percent_bp=1000 AND is_active AND effective_from<=current_date
        AND (effective_to IS NULL OR effective_to>=current_date) ORDER BY created_at DESC LIMIT 1`,
      [tenantId, sellerId, fixture.draw_id],
    );
    if (!commissionPlan.rowCount) {
      commissionPlan = await db.query(
        `INSERT INTO app.commission_plans(tenant_id,seller_id,draw_id,digits,base,percent_bp,effective_from,is_active)
         VALUES($1,$2,$3,2,'sales_percent',1000,current_date,true) RETURNING id`,
        [tenantId, sellerId, fixture.draw_id],
      );
    }

    let order = await db.query('SELECT id FROM app.orders WHERE tenant_id=$1 AND idempotency_key=$2', [tenantId, orderKey]);
    let session;
    if (order.rowCount) {
      session = await db.query(
        `SELECT oi.session_id AS id FROM app.order_items oi WHERE oi.order_id=$1 AND oi.status='active' ORDER BY oi.created_at LIMIT 1`,
        [order.rows[0].id],
      );
    } else {
      session = await db.query(
        `SELECT id,status FROM app.draw_sessions WHERE tenant_id=$1 AND draw_id=$2 AND status IN ('scheduled','open') AND closes_at>now() AND draws_at>now() ORDER BY draws_at LIMIT 1`,
        [tenantId, fixture.draw_id],
      );
      if (!session.rowCount) throw new Error('No existe una sesión DEMO futura y abierta para la venta de prueba.');
    }
    if (!order.rowCount) {
      await db.query("SELECT set_config('app.user_id',$1,true)", [sellerId]);
      const created = await db.query(
        `SELECT app.fn_submit_order(NULL,$1::jsonb,$2::jsonb,'cash_counter'::app.payment_method,
          'seller'::app.sale_origin,$3,NULL,$4,$5,true,NULL,false) AS id`,
        [JSON.stringify({ name: 'DEMO · Cliente de vendedor', phone: '0990000004', adult: true, terms: true }),
          JSON.stringify([{ draw_id: fixture.draw_id, session_id: session.rows[0].id, digits: 2, number: '07', amount_cents: 25, plan_id: fixture.play_plan_id }]),
          sellerId, (await db.query('SELECT location_id FROM app.users WHERE id=$1', [sellerId])).rows[0].location_id, orderKey],
      );
      order = { rows: [{ id: created.rows[0].id }], rowCount: 1 };
    }

    await db.query("SELECT set_config('app.user_id',$1,true)", [adminId]);
    let contract = await db.query(
      `SELECT id FROM app.contratas WHERE tenant_id=$1 AND created_by=$2 AND client_name=$3 ORDER BY created_at DESC LIMIT 1`,
      [tenantId, sellerId, contractName],
    );
    if (!contract.rowCount) {
      contract = await db.query(
        `INSERT INTO app.contratas(tenant_id,client_name,client_phone,draw_id,digits,number,plan_id,amount_cents,days_of_week,start_date,end_date,collection,created_by)
         VALUES($1,$2,'0990000004',$3,2,'84',$4,25,
           ARRAY[extract(isodow FROM (now() AT TIME ZONE $5)::date + 1),extract(isodow FROM (now() AT TIME ZONE $5)::date + 2)]::smallint[],
           (now() AT TIME ZONE $5)::date + 1,(now() AT TIME ZONE $5)::date + 2,'cash',$6) RETURNING id`,
        [tenantId, contractName, fixture.draw_id, fixture.play_plan_id, fixture.timezone, sellerId],
      );
    }
    await db.query('SELECT app.fn_materialize_contrata_slots($1,(now() AT TIME ZONE $2)::date+1,(now() AT TIME ZONE $2)::date+2)', [tenantId, fixture.timezone]);

    const check = await db.query(
      `SELECT (SELECT count(*)::int FROM app.orders WHERE tenant_id=$1 AND idempotency_key=$2 AND seller_id=$3 AND origin='seller' AND status='approved') AS sales,
              (SELECT count(*)::int FROM app.commissions WHERE tenant_id=$1 AND order_id=(SELECT id FROM app.orders WHERE tenant_id=$1 AND idempotency_key=$2) AND seller_id=$3 AND commission_cents>0) AS commissions,
              (SELECT count(*)::int FROM app.contrata_slots sl JOIN app.contratas c ON c.id=sl.contrata_id WHERE c.tenant_id=$1 AND c.created_by=$3 AND c.client_name=$4 AND sl.status='reserved') AS reserved_slots,
              (SELECT count(*)::int FROM app.role_permissions WHERE tenant_id=$1 AND role='seller' AND action='sale.register' AND allowed) AS seller_sale_permission`,
      [tenantId, orderKey, sellerId, contractName],
    );
    if (Number(check.rows[0].sales) !== 1 || Number(check.rows[0].commissions) < 1 || Number(check.rows[0].reserved_slots) < 1 || Number(check.rows[0].seller_sale_permission) !== 1) {
      throw new Error(`La verificación del fixture falló: ${JSON.stringify(check.rows[0])}`);
    }
    await db.query('COMMIT');
    console.log(`Fixture vendedor DEMO listo: venta=${check.rows[0].sales}, comisiones=${check.rows[0].commissions}, cupos reservados=${check.rows[0].reserved_slots}, permiso de venta=${check.rows[0].seller_sale_permission}.`);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { db.release(); }
} finally { await pool.end(); }
