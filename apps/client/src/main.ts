// Boot: shows server status immediately, then loads the 3D slice (Three.js + Rapier) as a separate chunk.
import { fetchServerStatus } from './health.ts';
import { resolveProfile } from './render/graphics-profile.ts';

declare global {
  interface Window {
    /** Read-only diagnostics hook used by the E2E smoke test. Contains no sensitive state. */
    __bar?:
      | {
          ready: boolean;
          snapshot: () => import('./debug/debug-snapshot.ts').DebugSnapshot;
          resetStats: () => void;
          dispose: () => { geometries: number; textures: number };
        }
      | undefined;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#view');
const status = document.querySelector<HTMLDivElement>('#status');
if (!canvas || !status) throw new Error('missing #view or #status element');

const params = new URLSearchParams(location.search);

void fetchServerStatus().then((server) => {
  status.textContent = server.online
    ? `B.A.R. · servidor ${server.health.version} · protocolo ${server.health.protocol}`
    : `B.A.R. · servidor offline (${server.reason})`;
});

try {
  const { startGame } = await import('./game/game.ts');
  const game = await startGame({
    canvas,
    hudParent: document.body,
    profile: resolveProfile(location.search),
    showHud: params.get('hud') !== '0',
  });
  window.__bar = {
    ready: true,
    snapshot: () => game.snapshot(),
    resetStats: () => game.resetStats(),
    dispose: () => game.dispose(),
  };
  import.meta.hot?.dispose(() => {
    game.dispose();
    window.__bar = undefined;
  });
} catch (err) {
  console.error('falha ao iniciar a cena 3D', err);
  status.textContent = 'B.A.R. · não foi possível iniciar a cena 3D (WebGL indisponível?)';
}
