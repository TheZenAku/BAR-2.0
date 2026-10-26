# B.A.R.

Jogo social multiplayer 3D para navegadores, ambientado em um bar brasileiro. Estado atual e próxima ação:
[docs/execution/STATE.md](docs/execution/STATE.md).

## Pré-requisitos

| Ferramenta | Versão                                | Observação                                               |
| ---------- | ------------------------------------- | -------------------------------------------------------- |
| Node.js    | ≥ 24.7 (LTS; `.nvmrc` = 24)           | Inclui npm ≥ 11. Validado localmente em 26.12.1. 24.7+ tem Argon2 nativo |
| Git        | qualquer versão recente               | `core.autocrlf=false` recomendado (o repositório usa LF) |

| Docker     | opcional                              | Para PostgreSQL via `compose.yaml`. Sem Docker: `npm run db:local` |

PostgreSQL 18 é obrigatório para o servidor e para `npm test`. Os testes usam `BAR_TEST_DATABASE_URL` (servidor descartável)
ou, sem ela, sobem PostgreSQL real local via `embedded-postgres` (dados em `.data/`, ignorado pelo Git; nada é instalado
globalmente). Os testes criam e apagam bancos próprios `bar_test_*` e nunca leem `DATABASE_URL`.

## Instalação e uso

```bash
npm ci                 # instala exatamente o lockfile
cp .env.example .env   # troque POSTGRES_PASSWORD e a senha em DATABASE_URL
npm run db:up          # PostgreSQL via Docker Compose (healthcheck)…
npm run db:local       # …ou, sem Docker, PostgreSQL local em primeiro plano (outro terminal)
npm run dev:server     # aplica migrações e sobe http://127.0.0.1:2567 (/health, /ready, /api/v1)
npm run dev:client     # http://localhost:5173 (proxy de /api, /health e /ready para o servidor)
```

Com `MAIL_TRANSPORT=dev-outbox` (padrão do `.env.example`), links de recuperação de senha são gravados em `.data/outbox/`
(não há envio real de e-mail). Variáveis documentadas em [.env.example](.env.example) e `apps/server/src/config.ts`.

## Scripts

| Script                            | O que faz                                                     |
| --------------------------------- | ------------------------------------------------------------- |
| `npm run lint` / `npm run format` | Biome (lint + formatação)                                     |
| `npm run typecheck`               | TypeScript estrito em cada workspace                          |
| `npm test`                        | Vitest: unitários + integração com PostgreSQL real            |
| `npm run test:unit` / `test:integration` | Só um dos projetos do Vitest                           |
| `npm run db:up` / `db:local`      | PostgreSQL via Docker Compose / binários locais sem Docker    |
| `npm run db:migrate`              | Aplica migrações pendentes (`-- down` reverte a última)       |
| `npm run build`                   | Build de produção do cliente (o servidor roda TS diretamente) |
| `npm run check:arch`              | Ciclos, direção de dependências e imports entre workspaces    |
| `npm run check:licenses`          | Licenças das dependências de produção (allowlist)             |
| `npm run verify`                  | Todos os gates acima, na ordem do CI                          |
| `npm run test:e2e`                | Navegador real: login/logout + cena (Edge padrão; `BAR_E2E_BROWSER`) |

Na cena: WASD/setas movem, Shift corre, clique captura o mouse (Esc solta), roda = zoom, F3 = HUD de métricas.
Perfil gráfico: `?gfx=low|medium|high` na URL.

## Estrutura

```
apps/client        cliente web (Vite + Three.js): input, câmera, avatar, render, debug
apps/server        servidor Node: API Fastify, contas/sessões, PostgreSQL (Kysely, migrações), logs pino
packages/game-core simulação compartilhada (passo fixo, movimento, Rapier determinístico)
packages/shared    contratos zod compartilhados
tests/e2e          navegador real (Playwright)
tests/support      PostgreSQL real para testes
docs/              arquitetura, decisões (ADRs), execução, assets
research/          POCs de engine (M0) e comparação de builds Rapier (M1); projetos npm separados, fora do CI
scripts/           gates de arquitetura e licenças; db-local (PostgreSQL sem Docker)
```

Arquitetura: [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) · Decisões: [docs/decisions](docs/decisions).
