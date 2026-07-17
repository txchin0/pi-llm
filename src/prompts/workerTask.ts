/** Label for the task description line in the worker task prompt. */
export const WORKER_TASK_LABEL = 'Task:';

/** Label for the recent conversation excerpt in the worker task prompt. */
export const WORKER_RECENT_CONVERSATION_LABEL = 'Recent conversation:';

/** Closing instruction appended to every worker task prompt. */
export const WORKER_TASK_CLOSING_INSTRUCTION =
  'Complete this task now using your tools. Your final message must begin with "OUTCOME: done" or "OUTCOME: failed - <reason>", followed by a short summary of what changed.';
