import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ListTasksResponseSchema } from '../../src/contracts/tasks.js';
import { resolveMigrationsFolder } from '../../src/queue/resolveMigrationsFolder.js';
import { createSqliteTaskQueue } from '../../src/queue/sqliteTaskQueue.js';
import type { TaskStatus } from '../../src/queue/taskTypes.js';
import { authHeaders } from '../helpers/auth.js';
import { buildTestServer } from '../helpers/buildTestServer.js';

function setTaskStatus(dbPath: string, taskId: string, status: TaskStatus): void {
  const db = new Database(dbPath);
  db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, taskId);
  db.close();
}

function finishTask(
  dbPath: string,
  taskId: string,
  status: 'completed' | 'failed',
  completedAt: string,
): void {
  const db = new Database(dbPath);
  db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?').run(
    status,
    completedAt,
    taskId,
  );
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
    return buildTestServer({
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
      headers: await authHeaders(app, 'web-user'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');

    const body = ListTasksResponseSchema.parse(response.json());
    expect(body.tasks.map((task) => task.id)).toEqual([pending.id, running.id]);

    await app.close();
  });

  it('returns 401 without a bearer token', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      query: { user_id: 'web-user' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'unauthorized' });

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
      query: { status: 'completed' },
      headers: await authHeaders(app, 'web-user'),
    });

    const body = ListTasksResponseSchema.parse(response.json());
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]?.id).toBe(completed.id);
    expect(body.tasks[0]?.status).toBe('completed');

    await app.close();
  });

  it('scopes tasks to the token identity, ignoring a user_id query param', async () => {
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
      // user-b in the query must not override the authenticated user-a.
      query: { user_id: 'user-b' },
      headers: await authHeaders(app, 'user-a'),
    });

    const body = ListTasksResponseSchema.parse(response.json());
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]?.id).toBe(userTask.id);

    await app.close();
  });

  it('returns 400 for invalid status', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      query: { status: 'bogus' },
      headers: await authHeaders(app, 'web-user'),
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
      query: { limit: '101' },
      headers: await authHeaders(app, 'web-user'),
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
      headers: await authHeaders(app, 'web-user'),
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

  it('windows finished tasks with completed_after and includes completed_at', async () => {
    const active = await queue.enqueue({
      userId: 'web-user',
      description: 'active task',
      context: { turns: [] },
    });
    const recent = await queue.enqueue({
      userId: 'web-user',
      description: 'recently finished',
      context: { turns: [] },
    });
    const stale = await queue.enqueue({
      userId: 'web-user',
      description: 'finished long ago',
      context: { turns: [] },
    });

    finishTask(dbPath, recent.id, 'completed', '2026-07-16T12:00:00.000Z');
    finishTask(dbPath, stale.id, 'failed', '2026-07-01T12:00:00.000Z');

    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      query: {
        status: 'pending,running,completed,failed',
        completed_after: '2026-07-14T00:00:00.000Z',
      },
      headers: await authHeaders(app, 'web-user'),
    });

    expect(response.statusCode).toBe(200);
    const body = ListTasksResponseSchema.parse(response.json());
    expect(body.tasks.map((task) => task.id)).toEqual([active.id, recent.id]);
    expect(body.tasks[0]?.completed_at).toBeNull();
    expect(body.tasks[1]?.completed_at).toBe('2026-07-16T12:00:00.000Z');

    await app.close();
  });

  it('normalizes offset and no-ms completed_after before windowing', async () => {
    const recent = await queue.enqueue({
      userId: 'web-user',
      description: 'boundary finished',
      context: { turns: [] },
    });
    const stale = await queue.enqueue({
      userId: 'web-user',
      description: 'older finished',
      context: { turns: [] },
    });

    // Equal to 2026-07-14T00:00:00.000Z; must survive offset / no-ms query forms.
    finishTask(dbPath, recent.id, 'completed', '2026-07-14T00:00:00.000Z');
    finishTask(dbPath, stale.id, 'failed', '2026-07-13T23:59:59.999Z');

    const app = await createApp();
    const headers = await authHeaders(app, 'web-user');

    for (const completed_after of [
      '2026-07-14T10:00:00+10:00',
      '2026-07-14T00:00:00Z',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tasks',
        query: {
          status: 'completed,failed',
          completed_after,
        },
        headers,
      });

      expect(response.statusCode).toBe(200);
      const body = ListTasksResponseSchema.parse(response.json());
      expect(body.tasks.map((task) => task.id)).toEqual([recent.id]);
    }

    await app.close();
  });

  it('returns 400 for a malformed completed_after', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      query: { completed_after: 'yesterday' },
      headers: await authHeaders(app, 'web-user'),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_error' });

    await app.close();
  });

  it('includes access-control-allow-origin for cross-origin GET requests', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      headers: {
        origin: 'http://localhost',
        ...(await authHeaders(app, 'web-user')),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost');

    await app.close();
  });
});

describe('POST /v1/tasks/:taskId/dismiss', () => {
  let tempDir: string;
  let dbPath: string;
  let queue: Awaited<ReturnType<typeof createSqliteTaskQueue>>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pi-llm-tasks-dismiss-'));
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
    return buildTestServer({
      taskQueue: queue,
      requestIdFactory: () => 'req_test00000001',
    });
  }

  async function enqueueFinishedTask(userId: string): Promise<string> {
    const task = await queue.enqueue({
      userId,
      description: 'finished task',
      context: { turns: [] },
    });
    finishTask(dbPath, task.id, 'completed', '2026-07-16T12:00:00.000Z');
    return task.id;
  }

  it('dismisses a finished task and removes it from lists', async () => {
    const taskId = await enqueueFinishedTask('web-user');

    const app = await createApp();
    const headers = await authHeaders(app, 'web-user');
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/dismiss`,
      headers,
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');

    const list = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      query: { status: 'completed,failed' },
      headers,
    });
    const body = ListTasksResponseSchema.parse(list.json());
    expect(body.tasks).toHaveLength(0);

    // Idempotent: a repeated dismiss still succeeds.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/dismiss`,
      headers,
    });
    expect(again.statusCode).toBe(204);

    await app.close();
  });

  it('returns 409 for a task that is not finished', async () => {
    const task = await queue.enqueue({
      userId: 'web-user',
      description: 'still pending',
      context: { turns: [] },
    });

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${task.id}/dismiss`,
      headers: await authHeaders(app, 'web-user'),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'task_not_terminal' });

    await app.close();
  });

  it("returns 404 for another user's task and for unknown ids", async () => {
    const taskId = await enqueueFinishedTask('user-a');

    const app = await createApp();
    const headersB = await authHeaders(app, 'user-b');

    const foreign = await app.inject({
      method: 'POST',
      url: `/v1/tasks/${taskId}/dismiss`,
      headers: headersB,
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ code: 'not_found' });

    const missing = await app.inject({
      method: 'POST',
      url: '/v1/tasks/task_missing/dismiss',
      headers: headersB,
    });
    expect(missing.statusCode).toBe(404);

    // The foreign dismiss must not have touched user-a's task.
    const listed = await queue.listByUser('user-a', {
      statuses: ['completed', 'failed'],
    });
    expect(listed.map((task) => task.id)).toEqual([taskId]);

    await app.close();
  });

  it('returns 401 without a bearer token', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks/task_whatever/dismiss',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'unauthorized' });

    await app.close();
  });
});
