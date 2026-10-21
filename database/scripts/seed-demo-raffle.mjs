import pg from 'pg';

// Datos locales para comprobar Rifas Especiales y Números Fortuna sin crear pagos.
const tenantId = 'a0000000-0000-0000-0000-000000000001';
const adminId = 'c0000000-0000-0000-0000-000000000001';
const raffleName = 'DEMO LOCAL · Efectivo y Números Fortuna';
if (process.env.NODE_ENV !== 'development') throw new Error('Solo se ejecuta en desarrollo local.');
const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error('DATABASE_ADMIN_URL es obligatorio.');
const connection = new URL(connectionString);
if (!['localhost', '127.0.0.1', '::1'].includes(connection.hostname) || connection.pathname !== '/imperio_de_ross') {
  throw new Error('El seed solo puede escribir en localhost/imperio_de_ross.');
}

const pool = new pg.Pool({ connectionString, max: 1, application_name: 'imperio-ross-demo-raffle', options: '-c search_path=app,public' });
try {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.environment','development',true)", [tenantId, adminId]);
    const valid = await db.query(
      `SELECT EXISTS(SELECT 1 FROM app.users WHERE id=$2 AND tenant_id=$1 AND role='admin' AND is_demo AND is_active) AS admin_ok,
              app.fn_can($2,'raffle.manage') AS can_manage`, [tenantId, adminId],
    );
    if (!valid.rows[0]?.admin_ok || !valid.rows[0]?.can_manage) throw new Error('La identidad DEMO o permiso raffle.manage no está disponible.');

    let raffle = await db.query('SELECT id FROM app.special_raffles WHERE tenant_id=$1 AND name=$2 LIMIT 1', [tenantId, raffleName]);
    if (!raffle.rowCount) {
      raffle = await db.query(
        `INSERT INTO app.special_raffles(tenant_id,name,description,prize_description,prize_value_cents,number_digits,range_start,range_end,price_cents,opens_at,close_mode,closes_at,draw_method,rules,status)
         VALUES($1,$2,'Datos ficticios de desarrollo. No corresponde a una rifa oficial.','Premio DEMO en efectivo: $1.000',100000,5,0,99999,25,now()-interval '1 day','date',now()+interval '90 days','Resultado local DEMO, sin valor oficial.','Participación de ejemplo para revisar el módulo; no se reciben pagos reales.','open') RETURNING id`,
        [tenantId, raffleName],
      );
    }
    const raffleId = raffle.rows[0].id;
    let pack = await db.query('SELECT id FROM app.raffle_packages WHERE tenant_id=$1 AND raffle_id=$2 AND label=$3 LIMIT 1', [tenantId, raffleId, 'DEMO · 4 oportunidades']);
    if (!pack.rowCount) {
      pack = await db.query('INSERT INTO app.raffle_packages(tenant_id,raffle_id,label,price_cents,chances,is_active) VALUES($1,$2,$3,100,4,true) RETURNING id', [tenantId, raffleId, 'DEMO · 4 oportunidades']);
    }
    await db.query(
      `INSERT INTO app.fortune_numbers(raffle_id,tenant_id,number,prize_cents) VALUES
        ($1,$2,'00027',10000),($1,$2,'34872',50000)
       ON CONFLICT(raffle_id,number) DO UPDATE SET prize_cents=EXCLUDED.prize_cents`, [raffleId, tenantId],
    );
    await db.query(
      `INSERT INTO app.financial_accounts(tenant_id,kind,name,is_active) VALUES
        ($1,'income','DEMO · Ingresos de prueba',true),($1,'payout','DEMO · Egresos de prueba',true)
       ON CONFLICT(tenant_id,name) DO UPDATE SET is_active=true`, [tenantId],
    );
    await db.query(
      `INSERT INTO app.notifications(tenant_id,user_id,type,title,body,data)
       SELECT $1,$2,'demo.module','DEMO · Rifa de prueba disponible','Rifa local y Números Fortuna para revisar el módulo.',jsonb_build_object('raffleId',$3::text)
       WHERE NOT EXISTS(SELECT 1 FROM app.notifications WHERE tenant_id=$1 AND user_id=$2 AND type='demo.module' AND title='DEMO · Rifa de prueba disponible')`,
      [tenantId, adminId, raffleId],
    );

    const check = await db.query(
      `SELECT (SELECT count(*)::int FROM app.special_raffles WHERE tenant_id=$1 AND id=$2 AND status='open') AS raffles,
              (SELECT count(*)::int FROM app.raffle_packages WHERE tenant_id=$1 AND raffle_id=$2 AND is_active) AS packages,
              (SELECT count(*)::int FROM app.fortune_numbers WHERE tenant_id=$1 AND raffle_id=$2) AS fortunes,
              (SELECT count(*)::int FROM app.financial_accounts WHERE tenant_id=$1 AND name LIKE 'DEMO · %') AS accounts,
              (SELECT count(*)::int FROM app.notifications WHERE tenant_id=$1 AND user_id=$3 AND title='DEMO · Rifa de prueba disponible') AS notifications`,
      [tenantId, raffleId, adminId],
    );
    if (Object.values(check.rows[0]).some((value) => Number(value) < 1)) throw new Error(`El fixture de rifa no quedó completo: ${JSON.stringify(check.rows[0])}`);
    await db.query('COMMIT');
    console.log(`Rifa DEMO persistida: ${check.rows[0].raffles} rifa, ${check.rows[0].packages} paquete, ${check.rows[0].fortunes} Números Fortuna, ${check.rows[0].accounts} cuentas, ${check.rows[0].notifications} notificación.`);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { db.release(); }
} finally { await pool.end(); }
