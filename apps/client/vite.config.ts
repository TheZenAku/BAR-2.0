import { defineConfig } from 'vite';

const serverUrl = process.env.BAR_SERVER_URL ?? 'http://127.0.0.1:2567';

export default defineConfig({
  server: { proxy: { '/health': serverUrl } },
  build: { target: 'es2023', sourcemap: true },
});
