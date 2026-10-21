import pg from 'pg';

const tenantId = 'a0000000-0000-0000-0000-000000000001';
const adminId = 'c0000000-0000-0000-0000-000000000001';
const clientId = 'c0000000-0000-0000-0000-000000000004';
const drawCode = 'DEMO-LOCAL-OPERACIONES';
const orderKey = 'demo-local-operations-ticket-v2';

if (process.env.NODE_ENV !== 'development') throw new Error('Solo se ejecuta en desarrollo local.');
const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error('DATABASE_ADMIN_URL es obligatorio.');
const claimCodeKey = process.env.CLAIM_CODE_KEY;
if (!claimCodeKey || claimCodeKey.length < 32) throw new Error('CLAIM_CODE_KEY debe tener al menos 32 caracteres para generar códigos privados de premio.');
const connection = new URL(connectionString);
if (!['localhost', '127.0.0.1', '::1'].includes(connection.hostname) || connection.pathname !== '/imperio_de_ross') {
  throw new Error('El seed solo puede escribir en localhost/imperio_de_ross.');
}

const pool = new pg.Pool({ connectionString, max: 1, application_name: 'imperio-ross-demo-operations', options: '-c search_path=app,public' });
try {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT set_config($1,$2,true), set_config($3,$4,true), set_config($5,$6,true), set_config($7,$8,true)', [
      'app.tenant_id', tenantId, 'app.user_id', adminId, 'app.environment', 'development', 'app.claim_key', claimCodeKey,
    ]);

    const identities = await db.query(
      `SELECT EXISTS(SELECT 1 FROM app.users WHERE id=$1 AND tenant_id=$3 AND role='admin' AND is_demo AND is_active) AS admin_ok,
              EXISTS(SELECT 1 FROM app.users WHERE id=$2 AND tenant_id=$3 AND role='client' AND is_demo AND is_active) AS client_ok,
              app.fn_can($1, 'result.edit') AS can_result,
              app.fn_can($1, 'plan.edit') AS can_plan,
              (SELECT timezone FROM app.tenants WHERE id=$3) AS timezone`,
      [adminId, clientId, tenantId],
    );
    const identity = identities.rows[0];
    if (!identity.admin_ok || !identity.client_ok || !identity.can_result || !identity.can_plan || !identity.timezone) {
      throw new Error('No se encontraron las cuentas demo/permisos requeridos; no se aplicaron cambios.');
    }

    const draw = await db.query(
      `INSERT INTO app.draws
        (tenant_id,code,name,country_code,reference_lottery,reference_abbr,draw_time,close_offset_minutes,days_of_week,ticket_note,is_active,sort_order)
       VALUES ($1,$2,'DEMO LOCAL · NO OFICIAL','EC','DEMO LOCAL','DEMO',time '20:00',15,ARRAY[1,2,3,4,5,6,7]::smallint[],
               'Datos ficticios de desarrollo. No corresponde a ningún sorteo oficial.',true,999)
       ON CONFLICT (tenant_id,code) DO UPDATE SET name=EXCLUDED.name,ticket_note=EXCLUDED.ticket_note,is_active=true,updated_at=now()
       RETURNING id`, [tenantId, drawCode],
    );
    const drawId = draw.rows[0].id;

    await db.query(
      `INSERT INTO app.draw_modalities(tenant_id,draw_id,digits,enabled,min_cents,step_cents,quota_per_number_cents,max_suertes)
       VALUES($1,$2,2,true,25,25,10000,1)
       ON CONFLICT(draw_id,digits) DO UPDATE SET enabled=true,min_cents=25,step_cents=25,max_suertes=1,updated_at=now()`, [tenantId, drawId],
    );
    const plan = await db.query(
      `INSERT INTO app.plans(tenant_id,draw_id,digits,name,is_active)
       VALUES($1,$2,2,'DEMO LOCAL · NO OFICIAL',true)
       ON CONFLICT(draw_id,digits,name) DO UPDATE SET is_active=true,updated_at=now() RETURNING id`, [tenantId, drawId],
    );
    const planId = plan.rows[0].id;
    const currentPrize = await db.query(
      `SELECT pv.id FROM app.plan_versions pv JOIN app.plan_prizes pp ON pp.plan_version_id=pv.id AND pp.tenant_id=pv.tenant_id
        WHERE pv.plan_id=$1 AND pv.tenant_id=$2 AND pv.is_current AND pp.suerte_no=1
          AND pp.suerte_name='Premio demo' AND pp.payout_per_dollar_cents=100`, [planId, tenantId],
    );
    if (!currentPrize.rowCount) {
      await db.query('SELECT app.fn_new_plan_version($1,$2::jsonb,$3)', [planId, JSON.stringify([{ suerte_no: 1, name: 'Premio demo', payout_per_dollar_cents: '100' }]), adminId]);
    }

    let order = await db.query('SELECT id FROM app.orders WHERE tenant_id=$1 AND idempotency_key=$2', [tenantId, orderKey]);
    let sessionId;
    if (order.rowCount) {
      const item = await db.query('SELECT session_id FROM app.order_items WHERE order_id=$1 ORDER BY created_at LIMIT 1', [order.rows[0].id]);
      sessionId = item.rows[0]?.session_id;
      if (!sessionId) throw new Error('La compra demo existente no tiene sesión.');
    } else {
      const session = await db.query(
        `WITH timing AS (
           SELECT (now() AT TIME ZONE $2)::date + 2 AS demo_date
         ), instants AS (
           SELECT demo_date, ((demo_date + time '20:00') AT TIME ZONE $2) AS draws_at FROM timing
         )
         INSERT INTO app.draw_sessions(tenant_id,draw_id,draw_date,closes_at,draws_at,status,reference_lottery,reference_abbr)
         SELECT $1,$3,demo_date,draws_at-interval '15 minutes',draws_at,'scheduled','DEMO LOCAL','DEMO' FROM instants
         ON CONFLICT(draw_id,draw_date) DO UPDATE SET reference_lottery='DEMO LOCAL',reference_abbr='DEMO'
         RETURNING id`, [tenantId, identity.timezone, drawId],
      );
      sessionId = session.rows[0].id;

      const wallet = await db.query('SELECT available_cents FROM app.wallets WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE', [tenantId, clientId]);
      if (!wallet.rowCount || BigInt(wallet.rows[0].available_cents) < 25n) throw new Error('La billetera demo no tiene saldo suficiente para emitir el ticket.');
      await db.query("SELECT set_config('app.user_id',$1,true)", [clientId]);
      const created = await db.query(
        `SELECT app.fn_submit_order(
          $1,$2::jsonb,$3::jsonb,'wallet'::app.payment_method,'direct'::app.sale_origin,
          NULL,NULL,NULL,$4,true,NULL,false) AS id`,
        [clientId,
          JSON.stringify({ name: 'DEMO · Cliente de pruebas', phone: '0990000004', adult: true, terms: true }),
          JSON.stringify([{ draw_id: drawId, session_id: sessionId, digits: 2, number: '42', amount_cents: 25, plan_id: planId }]),
          orderKey],
      );
      order = { rows: [{ id: created.rows[0].id }], rowCount: 1 };
    }

    await db.query(
      `WITH timing AS (
         SELECT (now() AT TIME ZONE $2)::date + 3 AS demo_date
       ), instants AS (
         SELECT demo_date, ((demo_date + time '20:00') AT TIME ZONE $2) AS draws_at FROM timing
       )
       INSERT INTO app.draw_sessions(tenant_id,draw_id,draw_date,closes_at,draws_at,status,reference_lottery,reference_abbr)
       SELECT $1,$3,demo_date,draws_at-interval '15 minutes',draws_at,'scheduled','DEMO LOCAL','DEMO' FROM instants
       ON CONFLICT(draw_id,draw_date) DO NOTHING`, [tenantId, identity.timezone, drawId],
    );

    await db.query("SELECT set_config('app.user_id',$1,true)", [adminId]);
    const currentResult = await db.query('SELECT id FROM app.results WHERE tenant_id=$1 AND session_id=$2 AND digits=2 AND is_current', [tenantId, sessionId]);
    if (!currentResult.rowCount) {
      await db.query("SELECT app.fn_register_result($1,2,'[\"42\"]'::jsonb,$2,$3)", [sessionId, adminId, 'DEMO local no oficial para verificar el módulo de premios']);
    }
    const check = await db.query(
      `SELECT (SELECT count(*)::int FROM app.tickets WHERE tenant_id=$1 AND order_id=$2) AS tickets,
              (SELECT count(*)::int FROM app.prizes WHERE tenant_id=$1 AND ticket_id IN (SELECT id FROM app.tickets WHERE order_id=$2)) AS prizes`,
      [tenantId, order.rows[0].id],
    );
    if (Number(check.rows[0].tickets) < 1 || Number(check.rows[0].prizes) < 1) throw new Error('El flujo demo no generó ticket y premio como se esperaba.');
    await db.query('COMMIT');
    console.log(`Fixture DEMO local listo: ${check.rows[0].tickets} ticket(s), ${check.rows[0].prizes} premio(s); sorteo marcado NO OFICIAL.`);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { db.release(); }
} finally { await pool.end(); }
