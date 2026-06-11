import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveMigrationsFolder } from '../../src/queue/resolveMigrationsFolder.js';
import { createSqliteTaskQueue } from '../../src/queue/sqliteTaskQueue.js';

describe('createSqliteTaskQueue', () => {
  let tempDir: string;
  let dbPath: string;
  let queue: Awaited<ReturnType<typeof createSqliteTaskQueue>>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pi-llm-queue-'));
    dbPath = join(tempDir, 'tasks.sqlite');
    queue = await createSqliteTaskQueue({
      dbPath,
      migrationsFolder: resolveMigrationsFolder(),
    });
  });

  afterEach(async () => {
    queue.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('enqueues a pending task scoped to the user', async () => {

    const record = await queue.enqueue({
      userId: 'web-user',
      sessionId: 'sess_test00000001',
      description: 'Remember to buy milk',
      context: {
        turns: [{ role: 'user', content: 'Remind me to buy milk' }],
      },
    });

    expect(record.status).toBe('pending');
    expect(record.userId).toBe('web-user');
    expect(record.sessionId).toBe('sess_test00000001');
    expect(record.id).toMatch(/^task_[a-f0-9]{16}$/);

    const fetched = await queue.getById('web-user', record.id);
    expect(fetched).toEqual(record);
  });

  it('returns tasks in FIFO order for a user', async () => {
    const first = await queue.enqueue({
      userId: 'web-user',
      description: 'first task',
      context: { turns: [] },
    });
    const second = await queue.enqueue({
      userId: 'web-user',
      description: 'second task',
      context: { turns: [] },
    });

    const pending = await queue.listPending('web-user');
    expect(pending.map((task) => task.id)).toEqual([first.id, second.id]);
  });

  it('isolates tasks by user id', async () => {
    const userTask = await queue.enqueue({
      userId: 'user-a',
      description: 'user a task',
      context: { turns: [] },
    });
    await queue.enqueue({
      userId: 'user-b',
      description: 'user b task',
      context: { turns: [] },
    });

    const pending = await queue.listPending('user-a');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(userTask.id);
  });
});
