import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import type { TaskQueue } from '../../queue/taskQueue.js';
import type { AppLogger } from '../../logging/types.js';
import { registerFilesystemSandbox } from './filesystemSandbox.js';
import { executeScheduleTask, scheduleTaskParameters } from './scheduleTaskTool.js';

export type SurfaceExtensionDependencies = {
  taskQueue: TaskQueue;
  userId: string;
  sessionId: string;
  contextTurnLimit: number;
  log?: AppLogger;
};

/** Creates a Pi extension factory with injected queue and session dependencies. */
export function createSurfaceExtensionFactory(
  deps: SurfaceExtensionDependencies,
): (pi: ExtensionAPI) => void {
  return (pi) => {
    createSurfaceExtension(pi, deps);
  };
}

/** Registers core surface tools and wires sandboxing. */
export function createSurfaceExtension(
  pi: ExtensionAPI,
  deps: SurfaceExtensionDependencies,
): void {
  registerFilesystemSandbox(pi);

  pi.registerTool({
    name: 'schedule_task',
    label: 'schedule_task',
    description:
      'Enqueue background work for a worker agent when a write or unsupported action is needed.',
    promptSnippet: 'Schedule deferred background work',
    promptGuidelines: [
      'Use schedule_task for any write, calendar change, or action you cannot complete with read-only tools.',
      'Pass a clear description of what should be done; confirm deferral to the user in natural language.',
      'Never claim a write is complete unless schedule_task was called successfully.',
    ],
    parameters: scheduleTaskParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeScheduleTask(deps, params, ctx);
    },
  });
}
