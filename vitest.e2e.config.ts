import { defineConfig } from 'vitest/config';

/**
 * Live-LLM e2e suite (tests/e2e): drives the real surface/worker pipeline
 * against a running llama.cpp endpoint. Excluded from `npm test`; run with
 * `npm run test:e2e`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    env: {
      NODE_ENV: 'test',
      // `.env` sets LOG_LEVEL=debug for dev; keep e2e output readable unless
      // explicitly overridden via E2E_LOG_LEVEL.
      LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'silent',
    },
    globalSetup: ['./tests/e2e/setup/globalSetup.ts'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    // llama.cpp serves one request at a time; keep everything sequential.
    fileParallelism: false,
    maxWorkers: 1,
    pool: 'forks',
  },
});
