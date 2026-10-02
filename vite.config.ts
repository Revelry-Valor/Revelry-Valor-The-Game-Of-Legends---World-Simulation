import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022' },
  // Some tests simulate centuries of history.
  test: { testTimeout: 60000 },
} as Parameters<typeof defineConfig>[0]);
