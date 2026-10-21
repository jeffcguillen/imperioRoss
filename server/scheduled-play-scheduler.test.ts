import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { runScheduledPlayBatch } from './scheduled-play-scheduler.js';

const tenantId = 'a0000000-0000-0000-0000-000000000001';
const play = { playId: 'c0000000-0000-4000-8000-000000000001', sessionId: 'd0000000-0000-4000-8000-000000000001', userId: 'e0000000-0000-4000-8000-000000000001' };
function setup(query: ReturnType<typeof vi.fn>) {
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  const logger = { info: vi.fn(), error: vi.fn() };
  return { pool, logger, release };
}
const options = { tenantIds: [tenantId], intervalMs: 30_000, lookaheadSeconds: 300, batchSize: 25, logger: { info: vi.fn(), error: vi.fn() } };

describe('scheduled play scheduler', () => {
  it('processes a due non-demo play under its tenant and customer context', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [play] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ fn_execute_scheduled_play: 'f0000000-0000-4000-8000-000000000001' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const { pool, release } = setup(query);
    const logger = { info: vi.fn(), error: vi.fn() };
    await runScheduledPlayBatch(pool, { ...options, logger });
    expect(query.mock.calls[1]?.[0]).toContain("set_config('app.tenant_id'");
    expect(query.mock.calls[2]?.[0]).toContain("t.modules->>'jugadasProgramadas'='true'");
    expect(query.mock.calls[2]?.[0]).toContain('NOT u.is_demo');
    expect(query.mock.calls[2]?.[1]).toEqual([tenantId, 300]);
    expect(query.mock.calls[3]?.[1]).toEqual([play.userId]);
    expect(query.mock.calls[4]?.[1]).toEqual([play.playId, play.sessionId]);
    expect(query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ event: 'scheduled_play_processed', orderCreated: true }));
    expect(logger.error).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('does not call the debit function when there is no due session', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const { pool, release } = setup(query);
    const logger = { info: vi.fn(), error: vi.fn() };
    await runScheduledPlayBatch(pool, { ...options, logger });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('fn_execute_scheduled_play'))).toBe(false);
    expect(logger.info).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back and logs a safe error code if execution fails', async () => {
    const error = Object.assign(new Error('database detail'), { code: 'SESSION_CLOSED' });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [play] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ rows: [] });
    const { pool, release } = setup(query);
    const logger = { info: vi.fn(), error: vi.fn() };
    await runScheduledPlayBatch(pool, { ...options, logger });
    expect(query.mock.calls.some(([sql]) => String(sql) === 'ROLLBACK')).toBe(true);
    expect(logger.error).toHaveBeenCalledWith({ event: 'scheduled_play_failed', tenantId, errorCode: 'SESSION_CLOSED' });
    expect(logger.error.mock.calls[0]?.[0]).not.toHaveProperty('error');
    expect(release).toHaveBeenCalledOnce();
  });
});
