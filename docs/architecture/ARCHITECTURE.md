# Arquitetura

Estado: M0. Decisões em [docs/decisions](../decisions/). Este documento descreve fronteiras e regras; detalhes de cada sistema
entram quando o marco correspondente for executado.

## Visão lógica

```
 navegador                                   servidor (1 processo Node, M0–M13 até medição provar o contrário)
┌────────────────────────────┐   WebSocket   ┌──────────────────────────────────────────────┐
│ apps/client                │◄─────────────►│ apps/server                                  │
│  render 3D (ADR-0001)      │  (M3: Colyseus│  HTTP: /health (M0) · API/auth (M2)          │
│  UI DOM · input · áudio    │   schema bin.)│  salas autoritativas (M3) · regras (game-core)│
│  predição local (M3)       │               │  persistência PostgreSQL (M2) · logs pino    │
└─────────────┬──────────────┘               └───────────────┬──────────────────────────────┘
              │ importa                                      │ importa
              └──────────────► packages/shared ◄─────────────┘
                               contratos zod, versão de protocolo
                               (M3+: packages/game-core = regras determinísticas + Rapier)
```

## Workspaces (existentes)

| Workspace         | Responsabilidade                                                                                | Pode depender de  |
| ----------------- | ----------------------------------------------------------------------------------------------- | ----------------- |
| `packages/shared` | Schemas/contratos versionados (zod), constantes de protocolo. Sem I/O, sem DOM, sem Node APIs.  | bibliotecas puras |
| `apps/server`     | Processo autoritativo: config tipada, logging estruturado, HTTP, (futuro) salas e persistência. | `packages/*`      |
| `apps/client`     | Renderização, UI, input, conexão. Nunca é fonte de verdade de estado sensível.                  | `packages/*`      |

Planejados, criados apenas quando houver uso real: `packages/game-core` (M1/M3: simulação compartilhada cliente/servidor),
`packages/game-content` (dados de interações/itens), `packages/asset-pipeline` + `assets/` (M4), `tests/e2e|multiplayer|performance`
(M1/M3), `infrastructure/` (M13).

## Regras verificadas por gate

- `npm run check:arch`: pacotes não dependem de apps; sem ciclos entre workspaces nem entre módulos; todo `@bar/*` importado
  está declarado no `package.json`; nenhum import relativo sai do próprio workspace.
- `npm run check:licenses`: dependências de produção apenas com licenças da allowlist.
- TypeScript estrito (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`).
- Contratos de rede/HTTP são schemas zod **estritos** em `packages/shared`; o servidor valida toda entrada e também a própria saída.

## Princípios de autoridade e segurança

- Servidor autoritativo para movimento, colisões relevantes, interações, permissões, resultados, inventário e economia.
  O cliente envia **intenções** (inputs), nunca estados.
- Simulação compartilhada em TypeScript (Rapier WASM roda no navegador e no Node — verificado em M0) para predição no cliente
  e autoridade no servidor com o mesmo código.
- Configuração somente via ambiente, validada na inicialização (falha rápida). Segredos fora do repositório (`.env` ignorado).
- Logs JSON estruturados com redação de campos sensíveis.

## Execução do servidor

Node ≥ 24 executa TypeScript diretamente (type stripping). Por isso o código usa apenas sintaxe apagável
(`erasableSyntaxOnly`) e imports com extensão `.ts`. Não há etapa de transpilação do servidor; `typecheck` é o gate de tipos.
