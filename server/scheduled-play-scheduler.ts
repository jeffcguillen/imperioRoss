import type { Pool, PoolClient } from 'pg';

type ScheduledPlayCandidate = { playId: string; sessionId: string; userId: string };
type SchedulerLogger = { info: (data: Record<string, unknown>) => void; error: (data: Record<string, unknown>) => void };
type SchedulerOptions = {
  tenantIds: string[];
  intervalMs: number;
  lookaheadSeconds: number;
  batchSize: number;
  logger: SchedulerLogger;
};

async function processTenant(pool: Pick<Pool, 'connect'>, tenantId: string, options: SchedulerOptions) {
  for (let processed = 0; processed < options.batchSize; processed += 1) {
    const client: PoolClient = await pool.connect();
    let transaction = false;
    try {
      await client.query('BEGIN');
      transaction = true;
      await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id','',true)", [tenantId]);
      const candidate = await client.query<ScheduledPlayCandidate>(
        `SELECT sp.id AS "playId",s.id AS "sessionId",sp.user_id AS "userId"
           FROM app.scheduled_plays sp
           JOIN app.users u ON u.id=sp.user_id AND u.tenant_id=sp.tenant_id AND u.role='client' AND u.is_active AND NOT u.is_demo
           JOIN app.draws d ON d.id=sp.draw_id AND d.tenant_id=sp.tenant_id AND d.is_active
           JOIN app.draw_sessions s ON s.draw_id=sp.draw_id AND s.tenant_id=sp.tenant_id
          WHERE sp.tenant_id=$1 AND sp.status='active'
            AND EXISTS (SELECT 1 FROM app.tenants t WHERE t.id=sp.tenant_id AND t.is_active AND t.modules->>'jugadasProgramadas'='true')
            AND s.status IN ('scheduled','open') AND s.closes_at>now()
            AND s.closes_at<=now()+($2::int*interval '1 second')
            AND EXTRACT(ISODOW FROM s.draw_date)::smallint=ANY(sp.days_of_week)
            AND NOT EXISTS (SELECT 1 FROM app.scheduled_play_runs r WHERE r.scheduled_play_id=sp.id AND r.session_id=s.id AND r.tenant_id=sp.tenant_id)
          ORDER BY s.closes_at,sp.created_at
          LIMIT 1 FOR UPDATE OF sp SKIP LOCKED`,
        [tenantId, options.lookaheadSeconds],
      );
      const play = candidate.rows[0];
      if (!play) {
        await client.query('COMMIT');
        transaction = false;
        return;
      }
      await client.query("SELECT set_config('app.user_id',$1,true)", [play.userId]);
      const result = await client.query<{ fn_execute_scheduled_play: string | null }>(
        'SELECT app.fn_execute_scheduled_play($1,$2) AS fn_execute_scheduled_play', [play.playId, play.sessionId],
      );
      await client.query('COMMIT');
      transaction = false;
      options.logger.info({ event: 'scheduled_play_processed', tenantId, playId: play.playId, sessionId: play.sessionId, orderCreated: Boolean(result.rows[0]?.fn_execute_scheduled_play) });
    } catch (error) {
      if (transaction) await client.query('ROLLBACK').catch(() => undefined);
      options.logger.error({ event: 'scheduled_play_failed', tenantId, errorCode: (error as { code?: string }).code ?? 'SCHEDULED_PLAY_ERROR' });
      return;
    } finally {
      client.release();
    }
  }
}

export async function runScheduledPlayBatch(pool: Pick<Pool, 'connect'>, options: SchedulerOptions) {
  for (const tenantId of options.tenantIds) await processTenant(pool, tenantId, options);
}

export function startScheduledPlayScheduler(pool: Pick<Pool, 'connect'>, options: SchedulerOptions) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runScheduledPlayBatch(pool, options);
    } catch (error) {
      options.logger.error({ event: 'scheduled_play_scheduler_failed', errorCode: (error as { code?: string }).code ?? 'SCHEDULER_ERROR' });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, options.intervalMs);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
