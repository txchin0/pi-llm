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

  it('claims the oldest pending task in global FIFO order', async () => {
    const first = await queue.enqueue({
      userId: 'user-a',
      description: 'first task',
      context: { turns: [] },
    });
    const second = await queue.enqueue({
      userId: 'user-b',
      description: 'second task',
      context: { turns: [] },
    });

    const claimedFirst = await queue.claimNextPending();
    expect(claimedFirst?.id).toBe(first.id);
    expect(claimedFirst?.status).toBe('running');

    const claimedSecond = await queue.claimNextPending();
    expect(claimedSecond?.id).toBe(second.id);
    expect(claimedSecond?.status).toBe('running');

    expect(await queue.claimNextPending()).toBeNull();
  });

  it('marks a running task completed with a result', async () => {
    const task = await queue.enqueue({
      userId: 'web-user',
      description: 'complete me',
      context: { turns: [] },
    });

    const claimed = await queue.claimNextPending();
    expect(claimed?.id).toBe(task.id);

    await queue.markCompleted(task.id, 'done');

    const completed = await queue.getById('web-user', task.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.result).toBe('done');
    expect(completed?.updatedAt).not.toBe(task.updatedAt);
  });

  it('marks a running task failed with an error message', async () => {
    const task = await queue.enqueue({
      userId: 'web-user',
      description: 'fail me',
      context: { turns: [] },
    });

    await queue.claimNextPending();

    await queue.markFailed(task.id, 'boom');

    const failed = await queue.getById('web-user', task.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.errorMessage).toBe('boom');
    expect(failed?.updatedAt).not.toBe(task.updatedAt);
  });

  it('requeues a running task, incrementing retryCount and storing the error', async () => {
    const task = await queue.enqueue({
      userId: 'web-user',
      description: 'retry me',
      context: { turns: [] },
    });

    const claimed = await queue.claimNextPending();
    expect(claimed?.id).toBe(task.id);

    await queue.requeue(task.id, 'transient error');

    const requeued = await queue.getById('web-user', task.id);
    expect(requeued?.status).toBe('pending');
    expect(requeued?.retryCount).toBe(1);
    expect(requeued?.errorMessage).toBe('transient error');
    expect(requeued?.updatedAt).not.toBe(task.updatedAt);
  });

  it('reclaims a requeued task after newer pending tasks', async () => {
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

    const claimedFirst = await queue.claimNextPending();
    expect(claimedFirst?.id).toBe(first.id);

    await queue.requeue(first.id, 'try again');

    const claimedSecond = await queue.claimNextPending();
    expect(claimedSecond?.id).toBe(second.id);

    const reclaimed = await queue.claimNextPending();
    expect(reclaimed?.id).toBe(first.id);
    expect(reclaimed?.retryCount).toBe(1);
  });

  it('requeues stuck running tasks at boot', async () => {
    const task = await queue.enqueue({
      userId: 'web-user',
      description: 'orphaned',
      context: { turns: [] },
    });

    const sqlite = new Database(dbPath);
    sqlite
      .prepare('UPDATE tasks SET status = ? WHERE id = ?')
      .run('running', task.id);
    sqlite.close();

    const count = await queue.requeueStuckRunning();
    expect(count).toBe(1);

    const recovered = await queue.getById('web-user', task.id);
    expect(recovered?.status).toBe('pending');
  });

  it('rejects state transitions when the task is not running', async () => {
    const task = await queue.enqueue({
      userId: 'web-user',
      description: 'still pending',
      context: { turns: [] },
    });

    await expect(queue.markCompleted(task.id, 'nope')).rejects.toThrow(
      /not running/,
    );
    await expect(queue.markFailed(task.id, 'nope')).rejects.toThrow(/not running/);
    await expect(queue.requeue(task.id, 'nope')).rejects.toThrow(/not running/);
  });
});
