import type { IntegrationDefinition, IntegrationToolSpec } from '../types.js';
import { warmGoogleApisIfConfigured } from '../google/loadGoogleApis.js';
import { registerTasksReadTool } from './tasksReadTool.js';
import { registerTasksWriteTool } from './tasksWriteTool.js';

const GOOGLE_TASKS_READONLY_SCOPE = 'https://www.googleapis.com/auth/tasks.readonly';
const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';

const tasksReadToolSpec: IntegrationToolSpec = {
  name: 'tasks_read',
  register(pi, ctx) {
    registerTasksReadTool(pi, ctx);
  },
};

const tasksWriteToolSpec: IntegrationToolSpec = {
  name: 'tasks_write',
  register(pi, ctx) {
    registerTasksWriteTool(pi, ctx);
  },
};

/** Google Tasks integration with OAuth-gated read (surface + worker) and write (worker) tools. */
export const googleTasksIntegration: IntegrationDefinition = {
  id: 'google_tasks',
  label: 'Google Tasks',
  defaultEnabled: false,
  workerCapability: 'Manage Google Tasks: create, update, or complete todos.',
  oauth: {
    providerId: 'google',
    scopes: {
      surface: [GOOGLE_TASKS_READONLY_SCOPE],
      worker: [GOOGLE_TASKS_SCOPE],
    },
  },
  tools: {
    surface: [tasksReadToolSpec],
    worker: [tasksReadToolSpec, tasksWriteToolSpec],
  },
  systemPrompt: {
    surface:
      'When the user asks about todos or due tasks, use tasks_read. Defer creates and completions via schedule_task. Share list id and task id from results; share the connect URL on auth failure.',
    worker:
      'Use tasks_read when you need to list tasks or resolve list/task ids before writing. Use tasks_write with required tasklistId from read/write results. To complete a task, update with status: completed. Reuse task id and list id on retries.',
  },
  onProcessStartup: warmGoogleApisIfConfigured,
};
