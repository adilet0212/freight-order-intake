import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Run from the repository root: `npm run web:dev`, `npm run web:build`.
export default defineConfig({
  // Vite reads .env files from its root. With the root set to web/, the repository's own
  // .env, which holds the model API key, is never loaded into the web build.
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    // Fixed, and fails if taken instead of moving to 5174: the API allows exactly this
    // origin by default (src/web-origin.ts), so a different port would be refused by CORS.
    port: 5173,
    strictPort: true,
    fs: {
      // The web imports a few pure files from the API (see web/src/shared.ts). Allow that
      // folder and the installed packages, and nothing else outside web/.
      allow: ['.', '../src/orders', '../node_modules'],
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
