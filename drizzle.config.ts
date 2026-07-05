import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: ['./src/queue/schema.ts', './src/auth/schema.ts'],
  out: './drizzle',
  dbCredentials: {
    url: './data/tasks.sqlite',
  },
});
