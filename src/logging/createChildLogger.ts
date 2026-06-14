import type { AppLogger, LogContext } from './types.js';

/** Returns a child logger with correlation and component bindings merged into every log line. */
export function createChildLogger(
  parent: AppLogger,
  context: LogContext,
): AppLogger {
  return parent.child({ ...context });
}
