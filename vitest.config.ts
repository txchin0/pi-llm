import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Live-LLM e2e tests need a running llama.cpp endpoint; they run via
    // `npm run test:e2e` (vitest.e2e.config.ts), never in the default suite.
    exclude: ['tests/e2e/**', '**/node_modules/**'],
    env: {
      NODE_ENV: 'test',
    },
  },
});
