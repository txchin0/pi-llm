import type { TaskRecord } from '../queue/taskTypes.js';

/** Builds the initial worker prompt from a queued task and current time. */
export function buildWorkerTaskPrompt(task: TaskRecord, now: string): string {
  const contextLines = task.context.turns
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join('\n');

  const sections = [
    `[Current time: ${now}]`,
    '',
    `Task: ${task.description}`,
  ];

  if (contextLines.length > 0) {
    sections.push('', 'Recent conversation:', contextLines);
  }

  sections.push(
    '',
    'Complete this task using your tools. End with a concise summary of what you did.',
  );

  return sections.join('\n');
}
