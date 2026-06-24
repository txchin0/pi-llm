import type { TaskListSummary, TaskSummary } from './tasksClient.js';

const TRUNCATION_SUFFIX =
  '\n... and possibly more (narrow filters or increase maxResults).';

/** Renders task lists as plain text for tool output. */
export function summarizeTaskLists(lists: TaskListSummary[]): string {
  if (lists.length === 0) {
    return 'No task lists found.';
  }

  const lines = lists.map((list, index) => `${index + 1}. ${list.title} (list id: ${list.id})`);
  return ['Task lists:', ...lines].join('\n');
}

/** Renders tasks as plain text for tool output. */
export function summarizeTasks(
  tasks: TaskSummary[],
  list: TaskListSummary,
  truncated = false,
): string {
  const header = `[list: ${list.title} (${list.id})]`;

  if (tasks.length === 0) {
    return `${header}\nNo tasks found.`;
  }

  const lines = tasks.map((task) => formatTaskLine(task));
  let text = [header, ...lines].join('\n');
  if (truncated) {
    text += TRUNCATION_SUFFIX;
  }
  return text;
}

/** Renders one task as a single summary line with optional notes. */
function formatTaskLine(task: TaskSummary): string {
  const parts = [
    `- task id: ${task.id}`,
    `list id: ${task.listId}`,
    task.status,
  ];

  if (task.due !== undefined) {
    parts.push(`due ${task.due}`);
  }

  parts.push(task.title);

  const line = parts.join(' | ');
  if (task.notes !== undefined) {
    return `${line}\n  notes: ${task.notes}`;
  }
  return line;
}

/** Renders one task for write-tool idempotency echoes. */
export function summarizeSingleTask(task: TaskSummary, label: string): string {
  return [
    label,
    summarizeTasks([task], { id: task.listId, title: task.listTitle }),
    '',
    `Reuse task id ${task.id} and list id ${task.listId} on retries.`,
  ].join('\n');
}
