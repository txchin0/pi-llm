import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ListTasksResponseSchema } from '../../src/contracts/tasks.js';
import { resolveMigrationsFolder } from '../../src/queue/resolveMigrationsFolder.js';
import { createSqliteTaskQueue } from '../../src/queue/sqliteTaskQueue.js';
import type { TaskStatus } from '../../src/queue/taskTypes.js';

function setTaskStatus(dbPath: string, taskId: string, status: TaskStatus): void {
  const db = new Database(dbPath);
  db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, taskId);
  db.close();
}

describe('GET /v1/tasks', () => {
  let tempDir: string;
  let dbPath: string;
  let queue: Awaited<ReturnType<typeof createSqliteTaskQueue>>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pi-llm-tasks-route-'));
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

  async function createApp() {
    const { buildServer } = await import('../../src/server/buildServer.js');
    return buildServer({
      taskQueue: queue,
      requestIdFactory: () => 'req_test00000001',
    });
  }

  it('returns pending and running tasks by default in FIFO order', async () => {
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

    setTaskStatus(dbPath, running.id, 'running');
    setTaskStatus(dbPath, completed.id, 'completed');

    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      query: { user_id: 'web-user' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');

    const body = ListTasksResponseSchema.parse(response.json());
    expect(body.tasks.map((task) => task.id)).toEqual([pending.id, running.id]);

    await app.close();
  });

  it('filters by status when requested', async () => {
    const completed = await queue.enqueue({
      userId: 'web-user',
      description: 'completed task',
      context: { turns: [] },
    });
    await queue.enqueue({
      userId: 'web-user',
      description: 'pending task',
      context: { turns: [] },
    });

    setTaskStatus(dbPath, completed.id, 'completed');

    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      query: { user_id: 'web-user', status: 'completed' },
    });

    const body = ListTasksResponseSchema.parse(response.json());
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]?.id).toBe(completed.id);
    expect(body.tasks[0]?.status).toBe('completed');

    await app.close();
  });

  it('does not return another user tasks', async () => {
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

    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      query: { user_id: 'user-a' },
    });

    const body = ListTasksResponseSchema.parse(response.json());
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]?.id).toBe(userTask.id);

    await app.close();
  });

  it('returns 400 for missing user_id', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_error' });

    await app.close();
  });

  it('returns 400 for invalid status', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      query: { user_id: 'web-user', status: 'bogus' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_error' });

    await app.close();
  });

  it('returns 400 when limit exceeds the maximum', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      query: { user_id: 'web-user', limit: '101' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_error' });

    await app.close();
  });

  it('omits context, user_id, and session_id from task summaries', async () => {
    await queue.enqueue({
      userId: 'web-user',
      sessionId: 'sess_test00000001',
      description: 'queued task',
      context: { turns: [{ role: 'user', content: 'secret context' }] },
    });

    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      query: { user_id: 'web-user' },
    });

    const body = ListTasksResponseSchema.parse(response.json());
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({
      description: 'queued task',
      status: 'pending',
      retry_count: 0,
      result: null,
      error_message: null,
    });
    expect(body.tasks[0]).not.toHaveProperty('context');
    expect(body.tasks[0]).not.toHaveProperty('user_id');
    expect(body.tasks[0]).not.toHaveProperty('session_id');

    await app.close();
  });
});
