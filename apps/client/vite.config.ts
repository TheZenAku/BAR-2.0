import { defineConfig } from 'vite';

const serverUrl = process.env.BAR_SERVER_URL ?? 'http://127.0.0.1:2567';

const proxy = () => ({
  '/health': serverUrl,
  '/ready': serverUrl,
  '/api': serverUrl,
  '/game': { target: serverUrl, ws: true },
});

export default defineConfig({
  // Same-origin API in dev/preview: the session cookie stays first-party and no CORS is needed.
  // `/game` is the multiplayer WebSocket (GAME_WS_PATH in @bar/shared); `ws: true` forwards the upgrade with its
  // Origin and session cookie untouched.
  server: { proxy: proxy() },
  preview: { proxy: proxy() },
  build: {
    target: 'es2023',
    sourcemap: true,
    // Rapier's compat build embeds its WASM as base64 (~4.3 MB raw, ~1.6 MB gzip) in one module; it cannot be
    // split further. Known and budgeted in ADR-0003 (optimization path: non-compat .wasm build, M12).
    chunkSizeWarningLimit: 4500,
    rolldownOptions: {
      output: {
        // Vendor chunks change rarely: keeping them separate preserves browser cache across app deploys.
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /node_modules[\\/]@dimforge/ },
            { name: 'three', test: /node_modules[\\/]three/ },
          ],
        },
      },
    },
  },
});
