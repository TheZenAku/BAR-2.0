# STATE

- **Marco:** M1 — Vertical slice · **Status:** CONCLUÍDO localmente, aguardando aprovação humana (itens NÃO VERIFICADO abaixo)
- **M0:** pendências de CI e Node 24 encerradas (GitHub Actions run 40389749929 em `df06a2b`: Node 24 e 26 verdes).
- **Data:** 2026-10-26

## Funciona (com evidência — [TESTS.md](TESTS.md))

- `packages/game-core`: passo fixo 60 Hz (`FixedStepper`), `MoveIntent` sanitizado, aceleração/desaceleração, controlador
  Rapier determinístico (cilindro arredondado, auto-step 0,35 m, rampa ≤ 40°, snap ao chão), locomoção idle/walk/run com
  histerese, greybox do bar como dados (`GREYBOX_BAR`). Testado contra o WASM real.
- `apps/client`: módulos separados `input/`, `camera/` (órbita + sphere cast), `avatar/` (`AvatarView` + avatar técnico
  com AnimationMixer), `render/` (perfis low/medium/high via `?gfx=`, greybox mesclado por superfície), `debug/` (HUD F3:
  FPS, p50/p95/p99, CPU, sim, draw calls, triângulos, geometrias, texturas, heap), `game/` (composição, interpolação, dispose).
- Rapier padrão × determinístico comparado (tamanho, init, passo, compatibilidade, hash) →
  [ADR-0003](../decisions/ADR-0003-rapier-build.md).
- E2E em navegador real (`npm run test:e2e`): Edge e Firefox verdes; job `e2e` (Chromium/Linux) adicionado ao CI.
- Controles: WASD/setas, Shift corre, clique captura o mouse (Esc solta; arrastar também gira), roda = zoom, F3 = HUD.

## NÃO VERIFICADO / bloqueios

- Desempenho em hardware físico: única máquina é VM (Edge preso a 60 Hz por vsync; Firefox em WebGL por software).
- Determinismo entre arquiteturas (ARM): sem hardware.
- Shutdown por SIGTERM no Windows: não testável (inalterado desde M0).
- Docker (M2) e Blender (M4) ausentes.

## Próxima ação

Revisão humana do M1: `npm run dev:server` + `npm run dev:client` e jogar a cena (checklist: andar/correr, escada do
palco, rampa do lounge, rampa íngreme, meio-fio/bloco, câmera contra paredes, F3). Ao aprovar: iniciar **M2 — Backend**
(instalar Docker para PostgreSQL antes da sessão).
