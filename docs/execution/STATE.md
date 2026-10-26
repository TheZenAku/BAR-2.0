# STATE

- **Marco:** M0 — Fundação · **Status:** APROVADO com itens NÃO VERIFICADO (abaixo)
- **Commit de referência:** `a464452` (código) + commit de documentação de estado seguinte
- **Data:** 2026-10-26

## Funciona (com evidência)

- Monorepo npm workspaces: `apps/client` (Vite + Three.js r186, boot + status do servidor), `apps/server` (config zod,
  pino, `GET /health`, shutdown gracioso), `packages/shared` (contrato `HealthResponse`, `PROTOCOL_VERSION`).
- Gates: `npm run verify` = Biome + TS 7 + Vitest (10 testes) + build + `check:arch` + `check:licenses` — verde local e em clone limpo.
- POCs de engine executados (84 runs, Edge + Firefox) → [RESULTS.md](../../research/engine-poc/results/RESULTS.md);
  decisão em [ADR-0001](../decisions/ADR-0001-engine.md); ferramentas/stack em [ADR-0002](../decisions/ADR-0002-platform-tooling.md).

## NÃO VERIFICADO / bloqueios

- CI no GitHub: workflow escrito, nunca executado (repositório sem remoto; `gh` não autenticado).
- Node 24 LTS: só Node 26.12.1 disponível localmente.
- Desempenho absoluto: única máquina é VM com GPU virtual; Firefox caiu em renderização por software.
- Shutdown por SIGTERM: não testável no Windows (sem handlers de sinal para `kill`).
- Docker e Blender ausentes (necessários a partir de M2 e M4, respectivamente).

## Próxima ação

Aguardar aprovação humana do M0. Ao aprovar: configurar remoto Git e rodar o CI; então iniciar **M1 — Vertical slice**
(criar `packages/game-core` com a simulação Rapier do POC, medir build determinístico vs compat e tamanho do WASM).
