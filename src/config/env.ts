import { DateTime } from 'luxon';

const DEFAULT_TIMEZONE = 'Australia/Sydney';

/** Reads `PORT` from the environment, defaulting to 3000 when unset. */
function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 3000;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return parsed;
}

const NODE_ENV_VALUES = ['development', 'production', 'test'] as const;

export type NodeEnv = (typeof NODE_ENV_VALUES)[number];

/** Normalizes `NODE_ENV`, defaulting to `development` when unset or unrecognized. */
function parseNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'production' || value === 'test') {
    return value;
  }

  return 'development';
}

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

  if (value === 'true' || value === '1') {
    return true;
  }

  if (value === 'false' || value === '0') {
    return false;
  }

  throw new Error(`Invalid LOG_PRETTY value: ${value}. Expected true or false.`);
}

/** Parses `TASK_CONTEXT_TURN_LIMIT`, defaulting to 3 when unset. */
function parseTaskContextTurnLimit(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return 3;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid TASK_CONTEXT_TURN_LIMIT value: ${value}. Expected a positive integer.`,
    );
  }

  return parsed;
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
  PORT: parsePort(process.env.PORT),
  NODE_ENV: nodeEnv,
  DATA_ROOT: parseDataRoot(process.env.DATA_ROOT),
  LOG_LEVEL: parseLogLevel(process.env.LOG_LEVEL, nodeEnv),
  LOG_PRETTY: parseLogPretty(process.env.LOG_PRETTY, nodeEnv),
  TIMEZONE: parseTimezone(process.env.TIMEZONE),
  TASK_CONTEXT_TURN_LIMIT: parseTaskContextTurnLimit(
    process.env.TASK_CONTEXT_TURN_LIMIT,
  ),
  isDev: nodeEnv === 'development',
  isTest: nodeEnv === 'test',
  isProd: nodeEnv === 'production',
} as const;
