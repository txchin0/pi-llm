import { DateTime } from 'luxon';

import { parseBoolean, parsePositiveInt } from './parseEnv.js';

const DEFAULT_TIMEZONE = 'Australia/Sydney';

const NODE_ENV_VALUES = ['development', 'production', 'test'] as const;

export type NodeEnv = (typeof NODE_ENV_VALUES)[number];

const LOG_LEVEL_VALUES = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

export type LogLevel = (typeof LOG_LEVEL_VALUES)[number];

/** Normalizes `NODE_ENV`, defaulting to `development` when unset or unrecognized. */
function parseNodeEnv(value: string | undefined): NodeEnv {
  if (
    value !== undefined &&
    (NODE_ENV_VALUES as readonly string[]).includes(value)
  ) {
    return value as NodeEnv;
  }

  return 'development';
}

/** Parses `LOG_LEVEL` or returns the default for the current environment. */
function parseLogLevel(
  value: string | undefined,
  nodeEnv: NodeEnv,
): LogLevel {
  if (value !== undefined) {
    if ((LOG_LEVEL_VALUES as readonly string[]).includes(value)) {
      return value as LogLevel;
    }

    throw new Error(
      `Invalid LOG_LEVEL value: ${value}. Expected one of ${LOG_LEVEL_VALUES.join(', ')}.`,
    );
  }

  if (nodeEnv === 'test') {
    return 'silent';
  }

  if (nodeEnv === 'development') {
    return 'debug';
  }

  return 'info';
}

/** Parses `DATA_ROOT`, defaulting to `./data` when unset. */
function parseDataRoot(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    return './data';
  }

  return value.trim();
}

/** Parses `LOG_PRETTY`, defaulting to true in development. */
function parseLogPretty(
  value: string | undefined,
  nodeEnv: NodeEnv,
): boolean {
  if (value === undefined) {
    return nodeEnv === 'development';
  }

  return parseBoolean(value, nodeEnv === 'development');
}

/** Parses `TIMEZONE` (IANA), defaulting to Australia/Sydney when unset. */
function parseTimezone(value: string | undefined): string {
  const zone =
    value === undefined || value.trim() === '' ? DEFAULT_TIMEZONE : value.trim();

  if (!DateTime.now().setZone(zone).isValid) {
    throw new Error(
      `Invalid TIMEZONE value: ${zone}. Expected a valid IANA timezone (e.g. Australia/Sydney).`,
    );
  }

  return zone;
}

const nodeEnv = parseNodeEnv(process.env.NODE_ENV);

export const env = {
  PORT: parsePositiveInt(process.env.PORT, 'PORT', 3000),
  NODE_ENV: nodeEnv,
  DATA_ROOT: parseDataRoot(process.env.DATA_ROOT),
  LOG_LEVEL: parseLogLevel(process.env.LOG_LEVEL, nodeEnv),
  LOG_PRETTY: parseLogPretty(process.env.LOG_PRETTY, nodeEnv),
  TIMEZONE: parseTimezone(process.env.TIMEZONE),
  TASK_CONTEXT_TURN_LIMIT: parsePositiveInt(
    process.env.TASK_CONTEXT_TURN_LIMIT,
    'TASK_CONTEXT_TURN_LIMIT',
    3,
  ),
  SURFACE_SESSION_CACHE_LIMIT: parsePositiveInt(
    process.env.SURFACE_SESSION_CACHE_LIMIT,
    'SURFACE_SESSION_CACHE_LIMIT',
    50,
  ),
  WORKER_ENABLED: parseBoolean(
    process.env.WORKER_ENABLED,
    nodeEnv === 'production',
  ),
  WORKER_POLL_INTERVAL_MS: parsePositiveInt(
    process.env.WORKER_POLL_INTERVAL_MS,
    'WORKER_POLL_INTERVAL_MS',
    5000,
  ),
  WORKER_MAX_RETRIES: parsePositiveInt(
    process.env.WORKER_MAX_RETRIES,
    'WORKER_MAX_RETRIES',
    2,
  ),
  WORKER_TASK_TIMEOUT_MS: parsePositiveInt(
    process.env.WORKER_TASK_TIMEOUT_MS,
    'WORKER_TASK_TIMEOUT_MS',
    120_000,
  ),
  isDev: nodeEnv === 'development',
  isTest: nodeEnv === 'test',
  isProd: nodeEnv === 'production',
} as const;
