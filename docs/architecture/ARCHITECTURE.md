# Arquitetura

Estado: M3. Decisões em [docs/decisions](../decisions/). Este documento descreve fronteiras e regras; detalhes de cada sistema
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
                               packages/game-core (M1): simulação + Rapier determinístico
```

## Workspaces (existentes)

| Workspace            | Responsabilidade                                                                                                                             | Pode depender de                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `packages/shared`    | Schemas/contratos versionados (zod), constantes de protocolo. Sem I/O, sem DOM, sem Node APIs.                                               | bibliotecas puras                 |
| `packages/game-core` | Simulação compartilhada: passo fixo, intenção de movimento, controlador Rapier (ADR-0003), nível como dados, locomoção. Sem DOM/render/rede. | `packages/*` (não `apps`), Rapier |
| `apps/server`        | Processo autoritativo: config tipada, logs pino, API HTTP (Fastify), contas/sessões, PostgreSQL (Kysely); (M3) salas.                        | `packages/*`                      |
| `apps/client`        | Renderização, UI, input, conexão. Nunca é fonte de verdade de estado sensível.                                                               | `packages/*`                      |

`tests/e2e` (M1/M2): navegador real (PostgreSQL + servidor + build de produção). `tests/support`: PostgreSQL real
para testes (Compose via `BAR_TEST_DATABASE_URL` ou `embedded-postgres`), um banco `bar_test_*` descartável por arquivo. Planejados, criados apenas quando houver uso
real: `packages/game-content` (dados de interações/itens), `packages/asset-pipeline` + `assets/` (M4),
`tests/performance`, `infrastructure/` (M13). Multiplayer: testes de integração/carga com WebSocket real em
`apps/server/src/game/*.int.test.ts` e E2E com 2 navegadores em `tests/e2e/multiplayer.e2e.mjs`.

## Cliente — vertical slice (M1)

```
input/ (teclado, mouse, pointer lock) ──► intenção {forward, right, run, yaw da câmera}
                                              │  amostrada 1× por frame
game/game.ts  rAF ─► FixedStepper 60 Hz ─► game-core Simulation.tick(intenção) ─► PlayerSnapshot (prev, curr)
                                              │  interpolação por alpha
      avatar/ (AvatarView: pose + locomoção → AnimationMixer)   camera/ (órbita + sphere cast estático)
      render/ (RenderStage: renderer, luzes, perfil gráfico; LevelView: greybox mesclado por superfície)
      debug/  (FrameStats p50/p95/p99, HUD F3, snapshot para E2E)
```

- Simulação nunca depende de FPS: ticks fixos de 1/60 s, até 15 por frame (250 ms); acima disso o tempo é descartado e
  contado em `droppedTicks`. Render interpola entre os dois últimos snapshots.
- O cliente produz **intenções**, nunca posições — o mesmo `MoveIntent` será a mensagem de rede no M3.
- `AvatarView` isola o personagem técnico; o avatar GLB do M5 implementa a mesma interface (clipes `idle/walk/run`).
- Todo subsistema tem `dispose()`; listeners usam `AbortController`. O E2E verifica que, após `dispose`, não restam
  geometrias na GPU (resta 1 textura: LUT DFG compartilhada pelo próprio Three.js).
- Nível é dado (`LevelDef`): física e render leem a mesma fonte; no M6 os colisores virão do GLB.

## Servidor — backend (M2)

```
main.ts  config (zod, falha rápida) → pino → pool pg/Kysely → migrações (lock) → Fastify → purga horária → SIGINT/SIGTERM
app.ts   onRequest: headers de segurança + x-request-id · guarda de Origin/Content-Type em /api (CSRF)
         rotas: /health (liveness) · /ready (PostgreSQL) · /api/v1/auth/{register,login,logout,session,recovery[/confirm]}
                /api/v1/account (DELETE) · /api/v1/users/:publicId
         erros: ApiError → { error: { code, message, requestId } } · banco indisponível → 503 · resto → 500 logado
auth/    service.ts (regras; Kysely parametrizado) · password.ts (Argon2id nativo, PHC) · tokens.ts (256 bits + SHA-256)
http/    errors · origin-guard (CSRF) · rate-limit (janela fixa em memória, por IP e por conta)
db/      database (pool, ping, classificação de indisponibilidade) · schema (tipos) · migrations/ (append-only)
mail/    Mailer: disabled | dev-outbox (sem provedor real)
```

- Tabelas: `users` (id interno bigint + `public_id` uuid, e-mail normalizado e único, hash Argon2id), `sessions` e
  `password_reset_tokens` (só hash do token, expiração, cascade). Constraints repetem as regras da API no banco.
- O id interno nunca sai do servidor; respostas só trazem `PublicUser` (`id` público, nome, data). Detalhes e políticas
  (sessão, CSRF, enumeração, rate limits, recuperação, exclusão de dados): [ADR-0004](../decisions/ADR-0004-backend-auth.md).
- Cliente: `auth/` (AuthApi tipada, painel acessível, barra do usuário). Sem sessão a cena 3D não é carregada; logout
  descarta a cena. Vite faz proxy de `/api` (mesma origem: cookie first-party, sem CORS).

## Multiplayer (M3)

```
cliente                                    servidor (mesmo processo/porta do Fastify)
 POST /api/v1/game/join (cookie) ───────►  requireUser → matchMaker.joinById → vaga vinculada à conta (15 s)
 WS /game/<proc>/<room>?sessionId ──────►  beforeUpgrade: Origin + cookie (reconexão: autentica e confere dono)
                                           onAuth: AuthService.authenticate(cookie) = conta da vaga
 'i' [seq,frente,lado,correr,yaw]×≤8 ───►  BarRoom → GameWorld: fila por jogador, orçamento de tempo, 60 Hz
 ◄─── 'w' welcome · 'r' roster · 's' snapshot 20 Hz {t, ack, me (estado completo), p (outros)}
```

- `apps/server/src/game/`: `attach.ts` (Colyseus no servidor HTTP; só o transporte WS), `room.ts` (identidade,
  sessão, revogação, loop), `world.ts` (simulação autoritativa sem rede). `app.ts`: rota `/api/v1/game/join`.
- `apps/client/src/net/`: `game-connection.ts` (vaga + SDK, reconexão, RTT), `prediction.ts` (predição/reconciliação),
  `interpolation.ts` (relógio do servidor + trilhas remotas), `net-badge.ts`. `game/remote-players.ts`: avatares remotos.
- Vite (dev/preview) faz proxy de `/game` com `ws: true`. Decisões e números: [ADR-0005](../decisions/ADR-0005-multiplayer.md).

## Regras verificadas por gate

- `npm run check:arch`: pacotes não dependem de apps; sem ciclos entre workspaces nem entre módulos; todo `@bar/*` importado
  está declarado no `package.json`; nenhum import relativo sai do próprio workspace.
- `npm run check:licenses`: dependências de produção apenas com licenças da allowlist.
- TypeScript estrito (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`).
- Contratos de rede/HTTP são schemas zod em `packages/shared`: entradas **estritas** (servidor valida toda entrada e a própria
  saída); respostas lidas de forma tolerante pelo cliente. API versionada por prefixo (`/api/v1`).

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
