// M0 boot skeleton: proves the toolchain (Vite + Three.js + shared contracts). Gameplay starts in M1.
import { Color, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { fetchServerStatus } from './health.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#view');
const status = document.querySelector<HTMLDivElement>('#status');
if (!canvas || !status) throw new Error('missing #view or #status element');

const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new Scene();
scene.background = new Color(0x1a1410);
const camera = new PerspectiveCamera(60, 1, 0.1, 100);

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}
window.addEventListener('resize', resize);
resize();

const server = await fetchServerStatus();
status.textContent = server.online
  ? `B.A.R. · servidor ${server.health.version} · protocolo ${server.health.protocol}`
  : `B.A.R. · servidor offline (${server.reason})`;
