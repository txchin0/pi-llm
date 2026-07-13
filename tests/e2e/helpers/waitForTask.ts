import { setTimeout as sleep } from 'node:timers/promises';

import type { TaskQueue } from '../../../src/queue/taskQueue.js';
import type { TaskRecord } from '../../../src/queue/taskTypes.js';

export type WaitForTaskOptions = {
  /** Default 240s: covers one worker-task timeout plus one retry attempt. */
  timeoutMs?: number;
  pollMs?: number;
};

/** Polls the queue until the task reaches `completed` or `failed`. */
export async function waitForTerminalTask(
  taskQueue: TaskQueue,
  userId: string,
  taskId: string,
  options: WaitForTaskOptions = {},
): Promise<TaskRecord> {
  const timeoutMs = options.timeoutMs ?? 240_000;
  const pollMs = options.pollMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'not found';

  while (Date.now() < deadline) {
    const record = await taskQueue.getById(userId, taskId);
    if (record !== null) {
      lastStatus = record.status;
      if (record.status === 'completed' || record.status === 'failed') {
        return record;
      }
    }

    await sleep(pollMs);
  }

  throw new Error(
    `Task ${taskId} did not reach a terminal status within ${timeoutMs}ms (last status: ${lastStatus})`,
  );
}
