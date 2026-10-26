// M4 art gallery in one command: fetches/builds the candidate assets when missing, then serves the gallery page
// (apps/client/art.html) with Vite. Needs no database or API; the multiplayer demo (npm run demo) is untouched.
// Usage: npm run demo:art              (runs until Ctrl+C)
//        npm run demo:art -- --rebuild (re-runs fetch + build first)
//        npm run demo:art -- --smoke   (verifies every URL and exits; code 1 on failure)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.BAR_ART_PORT ?? 5174);
const CATALOG = join(ROOT, '.cache/assets/generated/catalog.json');
const SMOKE = process.argv.includes('--smoke');
const step = (m) => console.log(`[demo:art] ${m}`);
const fail = (what, hint) => {
  console.error(`\n[demo:art] FALHA: ${what}${hint ? `\n[demo:art] Como resolver: ${hint}` : ''}\n`);
  process.exit(1);
};

if (!existsSync(join(ROOT, 'node_modules', 'vite'))) fail('dependências ausentes', 'execute `npm ci`.');
if (process.argv.includes('--rebuild') || !existsSync(CATALOG)) {
  step('baixando originais (fontes oficiais, SHA-256 verificado) e gerando os GLBs…');
  for (const script of ['scripts/assets/fetch.mjs', 'scripts/assets/build.mjs']) {
    const r = spawnSync(process.execPath, [script], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) fail(`${script} falhou`, 'veja a mensagem acima (rede, hash divergente ou validador).');
  }
}
const free = await new Promise((res) => {
  const s = netServer()
    .once('error', () => res(false))
    .listen(PORT, '127.0.0.1', () => s.close(() => res(true)));
});
if (!free) fail(`porta ${PORT} ocupada`, 'encerre o processo que a usa ou defina BAR_ART_PORT.');

const { createServer } = await import('vite');
const web = await createServer({
  root: join(ROOT, 'apps/client'),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
});
await web.listen();
const base = `http://127.0.0.1:${PORT}`;

// Verify what will be printed: the page, the catalog and every generated file.
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const files = catalog.candidates.flatMap((c) =>
  [...c.variants, ...c.parts, ...(c.animationLibrary ? [c.animationLibrary] : [])].map((i) => i.file),
);
for (const path of ['/art.html', '/art-assets/catalog.json', ...files.map((f) => `/art-assets/${f}`)]) {
  const res = await fetch(base + path);
  if (!res.ok) {
    await web.close();
    fail(`${path} respondeu ${res.status}`);
  }
}
step(`${files.length} arquivos de ${catalog.candidates.length} candidatos verificados.`);

console.log(`
=========================== B.A.R. — GALERIA DE ARTE (M4) ===========================
Abra no navegador: ${base}/art.html   (somente nesta máquina)

Candidatos: 1 Kenney Mini · 2 KayKit Adventurers · 3 Quaternius Universal · L lado a lado
Câmera: arrastar gira · roda zoom · botão direito move · F/P/C frente/perfil/costas
Animação: ←/→ troca o clipe · Espaço pausa · Luz: I · Cenário (estúdio/bar): E · Material: M · Referência: R
Demo multiplayer: npm run demo → http://127.0.0.1:5173 (o link no rodapé da galeria aponta para lá)
Ctrl+C encerra.
=====================================================================================
`);
if (SMOKE) {
  await web.close();
  step('smoke: OK');
  process.exit(0);
}
process.on('SIGINT', () => web.close().then(() => process.exit(0)));
