// Boot: shows server status immediately, resolves the session, then loads the 3D slice (Three.js + Rapier) as a
// separate chunk only for signed-in players. Logout disposes the scene and returns to the account screen.
import { OpaqueToken, type PublicUser } from '@bar/shared';
import { AuthApi, errorMessage } from './auth/api.ts';
import { AuthPanel } from './auth/auth-panel.ts';
import { UserBar } from './auth/user-bar.ts';
import type { Game } from './game/game.ts';
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
          simulateNetworkDrop: () => void;
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

const api = new AuthApi();
let game: Game | undefined;
let starting: Promise<void> | undefined;

async function startScene(): Promise<void> {
  try {
    const { startGame } = await import('./game/game.ts');
    canvas!.hidden = false;
    game = await startGame({
      canvas: canvas!,
      hudParent: document.body,
      profile: resolveProfile(location.search),
      showHud: params.get('hud') !== '0',
      onSessionEnded: () => void sessionEnded(),
    });
    const g = game;
    window.__bar = {
      ready: true,
      snapshot: () => g.snapshot(),
      resetStats: () => g.resetStats(),
      dispose: () => g.dispose(),
      simulateNetworkDrop: () => g.simulateNetworkDrop(),
    };
  } catch (err) {
    console.error('falha ao iniciar a cena 3D', err);
    status!.textContent = 'B.A.R. · não foi possível iniciar a cena 3D (WebGL indisponível?)';
  }
}

function stopScene(): void {
  game?.dispose();
  game = undefined;
  window.__bar = undefined;
  canvas!.hidden = true;
}

function enter(user: PublicUser): void {
  panel.hide();
  userBar.show(user);
  starting ??= startScene().finally(() => {
    starting = undefined;
  });
}

async function logout(): Promise<void> {
  await starting;
  stopScene(); // leaves the room first, so other players see us go at once
  const result = await api.logout();
  userBar.hide();
  // The cookie is cleared server-side even if this fails; the local session state is gone either way.
  panel.show('login', result.ok ? { notice: 'Você saiu da sua conta.' } : { error: errorMessage(result.code) });
}

/** The server closed the game connection because this session is no longer valid. */
async function sessionEnded(): Promise<void> {
  await starting;
  stopScene();
  userBar.hide();
  panel.show('login', { error: 'Sua sessão foi encerrada. Entre novamente.' });
}

const panel = new AuthPanel(document.body, api, enter);
const userBar = new UserBar(document.body, logout);
canvas.hidden = true;

// Recovery links carry the token in the fragment (never sent to servers or in Referer); drop it from the URL at once.
const resetToken = /^#reset=(.+)$/.exec(location.hash)?.[1];
if (resetToken !== undefined) history.replaceState(null, '', location.pathname + location.search);

if (resetToken !== undefined && OpaqueToken.safeParse(resetToken).success) {
  panel.show('reset', { resetToken });
} else {
  const session = await api.session();
  if (session.ok) enter(session.data);
  else if (session.code === 'unauthenticated') panel.show('login');
  else panel.show('login', { error: errorMessage(session.code) });
}

import.meta.hot?.dispose(() => {
  stopScene();
  panel.dispose();
  userBar.dispose();
});
