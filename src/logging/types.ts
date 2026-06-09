import type { RequestId, SessionId, UserId } from '../contracts/respond.js';

type LogMethod = {
  (obj: object, msg?: string, ...args: unknown[]): void;
  (msg: string, ...args: unknown[]): void;
};

/** Application logger interface compatible with Pino and Fastify. */
export type AppLogger = {
  child(bindings: Record<string, unknown>): AppLogger;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  fatal: LogMethod;
  trace: LogMethod;
  isLevelEnabled(level: string): boolean;
};

/** Known structured log event names. */
export type LogEvent =
  | 'server.started'
  | 'server.start_failed'
  | 'respond.request.received'
  | 'respond.request.started'
  | 'respond.request.completed'
  | 'respond.request.failed'
  | 'respond.validation.failed'
  | 'tool.call'
  | 'tool.result'
  | 'respond.delta'
  | 'respond.thinking_delta'
  | 'task.state_changed'
  | 'agent.error'
  | 'surface.llm.endpoint_warning';

/** Bindings attached to child loggers for correlation and filtering. */
export type LogContext = {
  component: string;
  event?: LogEvent;
  request_id?: RequestId;
  session_id?: SessionId;
  user_id?: UserId;
  task_id?: string;
  worker_run_id?: string;
};
