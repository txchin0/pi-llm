import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import {
  createPiEventMapperState,
  mapPiEventToAgentActivity,
} from '../agent/mapPiEventToAgentActivity.js';
import type { AgentActivityEvent } from '../contracts/agentActivity.js';
import type { AppLogger } from '../logging/types.js';
import type { TaskRecord } from '../queue/taskTypes.js';

export type WorkerRunOutcome =
  | { kind: 'completed'; summaryLength: number }
  | { kind: 'error'; message: string }
  | { kind: 'aborted' }
  | { kind: 'timeout' };

export type WorkerRunTraceSink = {
  onEvent(event: AgentSessionEvent): void;
  close(outcome: WorkerRunOutcome): Promise<void>;
};

type WorkerTraceEnvelope = {
  seq: number;
  at: string;
  task_id: string;
  user_id: string;
  session_id: string | null;
  retry_count: number;
};

type WorkerTraceRecord = WorkerTraceEnvelope & (
  | { type: 'run_start'; description: string; started_at: string }
  | ({ type: AgentActivityEvent['type'] } & Omit<AgentActivityEvent, 'type'>)
  | ({ type: 'run_end' } & WorkerRunOutcome & { completed_at: string })
);

type CreateWorkerRunTraceSinkOptions = {
  dataRoot: string;
  task: TaskRecord;
  startedAt: string;
  now?: () => string;
  log?: AppLogger;
};

/** Resolves the per-attempt worker trace JSONL path under the user data root. */
export function resolveWorkerTracePath(
  dataRoot: string,
  task: TaskRecord,
): string {
  return join(
    dataRoot,
    'users',
    task.userId,
    'worker-traces',
    `${task.id}-attempt-${task.retryCount}.jsonl`,
  );
}

/** Creates a JSONL trace sink for one worker task attempt. */
export function createWorkerRunTraceSink(
  options: CreateWorkerRunTraceSinkOptions,
): WorkerRunTraceSink {
  const now = options.now ?? (() => new Date().toISOString());
  const tracePath = resolveWorkerTracePath(options.dataRoot, options.task);
  const mapperState = createPiEventMapperState();
  let seq = 0;
  let closed = false;

  const streamReady = mkdir(dirname(tracePath), { recursive: true }).then(() => {
    return createWriteStream(tracePath, { flags: 'w' });
  });

  let writeChain: Promise<void> = streamReady.then(async (activeStream) => {
    await writeLine(
      activeStream,
      `${JSON.stringify({
        ...nextEnvelope(),
        type: 'run_start',
        description: options.task.description,
        started_at: options.startedAt,
      })}\n`,
    );
  });

  const sink: WorkerRunTraceSink = {
    onEvent(event) {
      if (closed) {
        return;
      }

      const activities = mapPiEventToAgentActivity(event, mapperState, {
        completedAt: now,
      });

      for (const activity of activities) {
        enqueueRecord(toActivityRecord(baseEnvelope(), activity));
      }
    },

    async close(outcome) {
      if (closed) {
        return;
      }

      closed = true;
      enqueueRecord({
        ...nextEnvelope(),
        type: 'run_end',
        ...outcome,
        completed_at: now(),
      });

      await writeChain;

      const activeStream = await streamReady;
      await closeStream(activeStream);
    },
  };

  streamReady.catch((error: unknown) => {
    logWriteFailure(options.log, error);
  });

  return sink;

  function baseEnvelope(): Omit<WorkerTraceEnvelope, 'seq'> {
    return {
      at: now(),
      task_id: options.task.id,
      user_id: options.task.userId,
      session_id: options.task.sessionId,
      retry_count: options.task.retryCount,
    };
  }

  function nextEnvelope(): WorkerTraceEnvelope {
    seq += 1;
    return {
      seq,
      ...baseEnvelope(),
    };
  }

  function enqueueRecord(record: WorkerTraceRecord): void {
    writeChain = writeChain.then(async () => {
      try {
        const activeStream = await streamReady;
        await writeLine(activeStream, `${JSON.stringify(record)}\n`);
      } catch (error: unknown) {
        logWriteFailure(options.log, error);
      }
    });
  }

  function toActivityRecord(
    base: Omit<WorkerTraceEnvelope, 'seq'>,
    activity: AgentActivityEvent,
  ): WorkerTraceRecord {
    seq += 1;
    return {
      ...base,
      seq,
      ...activity,
    };
  }
}

/** Appends one line to the trace stream. */
function writeLine(stream: WriteStream, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(line, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

/** Ends the trace stream after pending writes complete. */
function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end(() => {
      resolve();
    });
    stream.on('error', reject);
  });
}

/** Logs trace write failures without failing the worker task. */
function logWriteFailure(log: AppLogger | undefined, error: unknown): void {
  log?.warn(
    {
      event: 'worker.trace.write_failed',
      err: error,
    },
    'worker trace write failed',
  );
}
