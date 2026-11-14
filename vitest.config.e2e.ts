import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // The API tests share one database, so they must not run side by side.
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgres://postgres:postgres@localhost:5432/intake_test',
      // AppModule needs a model to be configured; every test replaces it with a FakeModel,
      // so no key is read and no network call is made.
      LLM_PROVIDER: 'anthropic',
      LLM_MODEL: 'replaced-by-fake-model',
    },
  },
});
