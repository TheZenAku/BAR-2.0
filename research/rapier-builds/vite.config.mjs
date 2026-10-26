import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2023',
    rollupOptions: { input: { compat: resolve('compat.html'), deterministic: resolve('deterministic.html') } },
  },
});
