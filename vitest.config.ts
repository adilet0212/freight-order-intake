import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// `npm test` runs both projects: the API's unit tests in Node, the web app's in a DOM.
export default defineConfig({
  test: {
    projects: [
      {
        // Resolves the path aliases declared in tsconfig.json, including the ones
        // added by `nest g library`. Requires Vite 8, which ships this option.
        resolve: { tsconfigPaths: true },
        test: {
          name: 'api',
          globals: true,
          root: './',
          include: ['**/*.spec.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          globals: true,
          root: './',
          environment: 'jsdom',
          include: ['web/src/**/*.test.{ts,tsx}'],
          setupFiles: ['web/src/test/setup.ts'],
        },
      },
    ],
  },
});
