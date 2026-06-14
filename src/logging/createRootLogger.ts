import pino, { type LoggerOptions } from 'pino';

import { env } from '../config/env.js';
import type { AppLogger } from './types.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'authorization',
  'cookie',
  'api_key',
  'apiKey',
  'password',
  'token',
  'secret',
];

export type CreateRootLoggerOptions = {
  level?: string;
  pretty?: boolean;
  destination?: pino.DestinationStream;
};

/** Creates the application root Pino logger with base fields, redaction, and optional pretty output. */
export function createRootLogger(
  options: CreateRootLoggerOptions = {},
): AppLogger {
  const level = options.level ?? env.LOG_LEVEL;
  const pretty = options.pretty ?? env.LOG_PRETTY;

  const loggerOptions: LoggerOptions = {
    level,
    base: {
      service: 'pi-llm',
      env: env.NODE_ENV,
    },
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
  };

  if (options.destination) {
    return pino(loggerOptions, options.destination);
  }

  if (pretty) {
    return pino({
      ...loggerOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino(loggerOptions);
}
