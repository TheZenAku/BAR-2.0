# TESTS

## M1 — Vertical slice (2026-10-26, Windows 10 VM, Node 26.12.1, Edge 156, Firefox 157)

| Gate                    | Comando                                                   | Resultado                                                                                                                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verify completo         | `npm run verify`                                          | APROVADO — lint 66 arquivos; tipos 4 workspaces; 11 arquivos / 50 testes; build; arquitetura 40 módulos, 0 ciclos; licenças 16 pacotes (14 MIT, 1 ISC, 1 Apache-2.0)                                                                                                           |
| Simulação (Rapier real) | `npx vitest run packages/game-core`                       | APROVADO — 26 testes: queda/chão, parede, escada 0,18 m, rampa 9,5°, rampa 50° bloqueada, meio-fio 0,30 m sobe / bloco 0,50 m bloqueia, sem travadas, descida sem perder o chão, independência de FPS (30/144/irregular → estado idêntico), determinismo entre mundos, dispose |
| Cliente (lógica)        | `npx vitest run apps/client`                              | APROVADO — input (mapeamento, blur, remoção de listeners), câmera (colisão, limites), perfil gráfico, FrameStats, clipes e transição do avatar                                                                                                                                 |
| E2E em navegador real   | `npm run test:e2e` (servidor real + build de produção)    | APROVADO — Edge ×3 consecutivas (medium) + low + high; Firefox ×2. 13 verificações: boot, `/health`, render, screenshot não uniforme, andar/correr (estado + animação), colisão com o balcão, métricas, dispose sem geometrias restantes, 0 erros de console                   |
| Segurança               | `npm audit --audit-level=high`                            | APROVADO — 0 vulnerabilidades                                                                                                                                                                                                                                                  |
| Comparação Rapier       | `research/rapier-builds`: `node tools/bench.mjs --reps=5` | Concluída — [RESULTS.md](../../research/rapier-builds/results/RESULTS.md), decisão em ADR-0003                                                                                                                                                                                 |
| Clone limpo             | `git clone` → `npm ci` → `npm run verify`                 | APROVADO — `5ba4194`: npm ci + verify (50 testes)                                                                                                                                                                                                                              |
| CI (verify + e2e Linux) | GitHub Actions                                            | APROVADO — run 40395522234 em `5ba4194`: verify Node 24 e 26 + e2e Chromium headless (SwiftShader)                                                                                                                                                                             |

### Métricas de frame (E2E, 5 s parado, 1280×720) — VM com GPU virtual, **não representa hardware real**

| Navegador / perfil | Boot até cena | FPS  | p50 ms | p95 ms | p99 ms | CPU/frame ms | Sim ms/tick | Draw calls | Triângulos | Heap JS |
| ------------------ | ------------- | ---- | ------ | ------ | ------ | ------------ | ----------- | ---------- | ---------- | ------- |
| Edge — low         | 4,3 s         | 62,6 | 15,8   | 20,6   | 29,5   | 0,99         | 0,63        | 12         | 664        | 20,2 MB |
| Edge — medium      | 2,3 s         | 62,4 | 15,7   | 22,3   | 30,6   | 1,18         | 0,63        | 23         | 1304       | 17,1 MB |
| Edge — high        | 2,2 s         | 62,5 | 15,8   | 20,9   | 30,7   | 0,86         | 0,45        | 23         | 1304       | 16,8 MB |
| Firefox — medium   | 1,8 s         | 10,3 | 70,4   | 222,8  | 235,5  | 3,28         | 0,34        | 23         | 1304       | n/d     |
- Edge limitado a 60 Hz por vsync: os perfis não se diferenciam nesta VM (CPU/frame ~1 ms; gargalo é GPU virtual/compositor).
- Firefox headless nesta VM renderiza WebGL por software (igual ao M0): o número reflete o renderizador, não o jogo.
- `droppedTicks` > 0 vem de travamentos do carregamento (compilação de shaders > 250 ms), não do regime.
- Build (gzip): boot 26 KB + app 7,8 KB + Three.js 137 KB + Rapier 1677 KB.

## `a464452` — M0 (2026-10-26, Windows 10 VM, Node 26.12.1, npm 11.20.0)

| Gate              | Comando                                                        | Resultado                                                                                |
| ----------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Lint/format       | `npm run lint`                                                 | APROVADO — 33 arquivos, 0 erros                                                          |
| Tipos             | `npm run typecheck`                                            | APROVADO — 3 workspaces                                                                  |
| Testes            | `npm test`                                                     | APROVADO — 4 arquivos, 10 testes (schema, config, HTTP integração, health do cliente)    |
| Build             | `npm run build`                                                | APROVADO — cliente 154,7 KB gzip (aviso de chunk > 500 KB minificado: Three.js)          |
| Arquitetura       | `npm run check:arch`                                           | APROVADO — 12 módulos, 0 ciclos; teste negativo (ciclo + import não declarado) detectado |
| Licenças          | `npm run check:licenses`                                       | APROVADO — 15 pacotes de produção (14 MIT, 1 ISC)                                        |
| Segurança         | `npm audit --audit-level=high`                                 | APROVADO — 0 vulnerabilidades                                                            |
| Clone limpo       | `git clone` → `npm ci` → `npm run verify`                      | APROVADO                                                                                 |
| Smoke             | servidor + Vite dev proxy `/health`; página do cliente no Edge | APROVADO — status renderizado, 0 erros de página                                         |
| POC (clone limpo) | `npm ci`, `tsc`, `npm run build`, `npm run validate`           | APROVADO — tamanhos idênticos; glTF 0 erros (1 aviso)                                    |
| POC benchmark     | `node tools/bench.mjs` (Edge ×3, Edge uncapped ×2, Firefox ×2) | 84/84 execuções concluídas; ver RESULTS.md                                               |
| CI remoto         | GitHub Actions                                                 | APROVADO (verificado no M1) — run 40389749929 em `df06a2b`                               |
| Node 24           | GitHub Actions (matriz 24/26)                                  | APROVADO (verificado no M1) — mesmo run                                                  |
