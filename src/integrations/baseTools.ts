/** Built-in Pi tools always enabled on the surface agent. */
export const SURFACE_BASE_TOOLS = [
  'read',
  'ls',
  'grep',
  'find',
  'schedule_task',
] as const;

/** Built-in Pi tools always enabled on the worker agent. */
export const WORKER_BASE_TOOLS = [
  'read',
  'write',
  'edit',
  'ls',
  'grep',
  'find',
] as const;

/** Union of all core platform tool names used for registry collision checks. */
export const ALL_BASE_TOOL_NAMES = [
  ...new Set([...SURFACE_BASE_TOOLS, ...WORKER_BASE_TOOLS]),
] as const;
