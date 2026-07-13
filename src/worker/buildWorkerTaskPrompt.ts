import type { TaskRecord } from '../queue/taskTypes.js';
import {
  WORKER_RECENT_CONVERSATION_LABEL,
  WORKER_TASK_CLOSING_INSTRUCTION,
  WORKER_TASK_LABEL,
} from '../prompts/workerTask.js';

/** Builds the initial worker prompt from a queued task and current time. */
export function buildWorkerTaskPrompt(task: TaskRecord, now: string): string {
  const contextLines = task.context.turns
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join('\n');

  const sections = [
    `[Current time: ${now}]`,
    '',
    `${WORKER_TASK_LABEL} ${task.description}`,
  ];

  if (contextLines.length > 0) {
    sections.push('', WORKER_RECENT_CONVERSATION_LABEL, contextLines);
  }

  sections.push('', WORKER_TASK_CLOSING_INSTRUCTION);

  return sections.join('\n');
}
