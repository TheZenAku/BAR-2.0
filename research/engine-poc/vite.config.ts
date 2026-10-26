import { defineConfig } from 'vite';

// One build per engine (POC_ENGINE) so bundle sizes are measured independently.
// Rapier (shared by all POCs, WASM embedded as base64) goes to its own chunk so engine cost is visible.
const engine = process.env.POC_ENGINE;

export default defineConfig({
  base: './',
  build: engine
    ? {
        outDir: `dist/${engine}`,
        emptyOutDir: true,
        chunkSizeWarningLimit: 8192,
        rolldownOptions: {
          input: `${engine}.html`,
          output: { codeSplitting: { groups: [{ name: 'rapier', test: /rapier3d/ }] } },
        },
      }
    : undefined,
});
