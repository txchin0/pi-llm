import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';
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

    const pending = await queue.listByUser('web-user', { statuses: ['pending'] });
    expect(pending.map((task) => task.id)).toEqual([first.id, second.id]);
  });

  it('lists tasks by multiple statuses in FIFO order', async () => {
    const pending = await queue.enqueue({
      userId: 'web-user',
      description: 'pending task',
      context: { turns: [] },
    });
    const running = await queue.enqueue({
      userId: 'web-user',
      description: 'running task',
      context: { turns: [] },
    });
    const completed = await queue.enqueue({
      userId: 'web-user',
      description: 'completed task',
      context: { turns: [] },
    });

    const sqlite = new Database(dbPath);
    sqlite
      .prepare('UPDATE tasks SET status = ? WHERE id = ?')
      .run('running', running.id);
    sqlite
      .prepare('UPDATE tasks SET status = ? WHERE id = ?')
      .run('completed', completed.id);
    sqlite.close();

    const active = await queue.listByUser('web-user', {
      statuses: ['pending', 'running'],
    });

    expect(active.map((task) => task.id)).toEqual([pending.id, running.id]);
    expect(active.every((task) => task.description)).toBe(true);
    expect(active.some((task) => 'context' in task)).toBe(false);
  });

  it('isolates listByUser results by user id', async () => {
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

    const listed = await queue.listByUser('user-a', { statuses: ['pending'] });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(userTask.id);
  });

  it('respects the listByUser limit', async () => {
    await queue.enqueue({
      userId: 'web-user',
      description: 'first task',
      context: { turns: [] },
    });
    await queue.enqueue({
      userId: 'web-user',
      description: 'second task',
      context: { turns: [] },
    });

    const listed = await queue.listByUser('web-user', {
      statuses: ['pending'],
      limit: 1,
    });
    expect(listed).toHaveLength(1);
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

    const pending = await queue.listByUser('user-a', { statuses: ['pending'] });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(userTask.id);
  });
});
