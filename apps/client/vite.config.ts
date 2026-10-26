import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const serverUrl = process.env.BAR_SERVER_URL ?? 'http://127.0.0.1:2567';

const proxy = () => ({
  '/health': serverUrl,
  '/ready': serverUrl,
  '/api': serverUrl,
  '/game': { target: serverUrl, ws: true },
});

/** Art gallery (M4, art.html): serves the locally generated candidates (npm run assets:build). Dev server only. */
const ART_DIR = resolve(import.meta.dirname, '../../.cache/assets/generated');
const artAssets = (): Plugin => ({
  name: 'bar-art-assets',
  configureServer(server) {
    server.middlewares.use('/art-assets', (req, res) => {
      const file = resolve(ART_DIR, `.${decodeURIComponent((req.url ?? '/').split('?')[0]!)}`);
      if (!file.startsWith(ART_DIR + sep) || !existsSync(file) || !statSync(file).isFile()) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('content-type', file.endsWith('.json') ? 'application/json' : 'model/gltf-binary');
      res.setHeader('cache-control', 'no-store');
      createReadStream(file).pipe(res);
    });
  },
});

export default defineConfig({
  plugins: [artAssets()],
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
