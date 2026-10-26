# B.A.R.

Jogo social multiplayer 3D para navegadores, ambientado em um bar brasileiro. Estado atual e próxima ação:
[docs/execution/STATE.md](docs/execution/STATE.md).

## Pré-requisitos

| Ferramenta | Versão                                | Observação                                               |
| ---------- | ------------------------------------- | -------------------------------------------------------- |
| Node.js    | ≥ 24 (LTS recomendada; `.nvmrc` = 24) | Inclui npm ≥ 11. Validado localmente em 26.12.1          |
| Git        | qualquer versão recente               | `core.autocrlf=false` recomendado (o repositório usa LF) |

Nada mais é necessário até o M2 (PostgreSQL).

## Instalação e uso

```bash
npm ci                 # instala exatamente o lockfile
cp .env.example .env   # opcional; o servidor tem defaults seguros para dev
npm run dev:server     # http://127.0.0.1:2567/health
npm run dev:client     # http://localhost:5173 (proxy de /health para o servidor)
```

## Scripts

| Script                            | O que faz                                                     |
| --------------------------------- | ------------------------------------------------------------- |
| `npm run lint` / `npm run format` | Biome (lint + formatação)                                     |
| `npm run typecheck`               | TypeScript estrito em cada workspace                          |
| `npm test`                        | Vitest (unitários + integração HTTP)                          |
| `npm run build`                   | Build de produção do cliente (o servidor roda TS diretamente) |
| `npm run check:arch`              | Ciclos, direção de dependências e imports entre workspaces    |
| `npm run check:licenses`          | Licenças das dependências de produção (allowlist)             |
| `npm run verify`                  | Todos os gates acima, na ordem do CI                          |

## Estrutura

```
apps/client        cliente web (Vite + Three.js)
apps/server        servidor Node (config tipada, logs pino, /health)
packages/shared    contratos zod compartilhados
docs/              arquitetura, decisões (ADRs), execução, assets
research/engine-poc  POCs de engine do M0 (projeto npm separado, fora do CI)
scripts/           gates de arquitetura e licenças
```

Arquitetura: [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) · Decisões: [docs/decisions](docs/decisions).
