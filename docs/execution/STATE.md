# STATE

- **Marco:** M2 — Backend · **Status:** CONCLUÍDO (local + CI com PostgreSQL real), aguardando aprovação humana
- **M1:** CONCLUÍDO tecnicamente; **revisão visual humana NÃO VERIFICADA** (não registrada em nenhum documento).
- **Data:** 2026-10-26

## Funciona (com evidência — [TESTS.md](TESTS.md))

- **API** (`apps/server`, Fastify 5, prefixo `/api/v1`): cadastro, login, logout, sessão atual, recuperação de acesso
  (pedido + confirmação), exclusão de conta com reconfirmação de senha, perfil público por `publicId`. `/health`
  (liveness) e `/ready` (PostgreSQL). Erros padronizados com `requestId`; logs pino correlacionados por `reqId`.
- **PostgreSQL 18** via Kysely + `pg` (pool limitado, timeouts, 503 quando indisponível). Migração `0001_initial`
  versionada/reversível; constraints (e-mail normalizado e único, nome 3–20, hash Argon2id, tamanho de token, cascade).
- **Segurança:** Argon2id nativo (OWASP), token de sessão opaco (só SHA-256 no banco) em cookie HttpOnly/SameSite=Lax
  (`__Host-` + Secure em produção), CSRF por Origin/Fetch Metadata + JSON obrigatório, rate limit por IP e por conta,
  anti-enumeração no login/recuperação, config validada (produção exige `ALLOWED_ORIGINS`), logs sem dados sensíveis.
  Políticas em [ADR-0004](../decisions/ADR-0004-backend-auth.md).
- **Cliente:** painel de conta acessível (entrar, criar conta, esqueci a senha, nova senha via `#reset=`), barra com nome e
  "Sair". Cena 3D do M1 só carrega com sessão; logout a descarta. E2E Edge e Firefox verdes (inclui todas as checagens M1).
- **Ambiente:** `compose.yaml` (PostgreSQL 18.4 com healthcheck/volume) para quem tem Docker; `npm run db:local`
  (binários oficiais via `embedded-postgres`, sem instalação global) para quem não tem. Testes nunca usam `DATABASE_URL`.

## Revisão visual humana do M1 — pendente (checklist)

`npm run db:local` (ou `db:up`) + `npm run dev:server` + `npm run dev:client`, criar conta e avaliar:
escada do palco · rampa do lounge · rampa íngreme (deve bloquear) · meio-fio (sobe) e bloco (bloqueia) · obstáculos e
balcão · câmera contra paredes (sem atravessar) · andar/correr (Shift) e transições de animação · HUD F3 (FPS, p95, draw calls).

## NÃO VERIFICADO / bloqueios

- Docker Compose nesta máquina (Docker ausente); `compose.yaml` validado no CI.
- Envio real de e-mail: não existe provedor (`MAIL_TRANSPORT=disabled|dev-outbox`). Recuperação funciona ponta a ponta
  só com o outbox de desenvolvimento/testes.
- Rate limit em memória: válido para um processo (ADR-0002); múltiplos processos exigem store compartilhado.
- Cadastro revela se o e-mail já existe (inevitável sem confirmação por e-mail; mitigado por rate limit — ADR-0004).
- Desligamento por SIGTERM no Windows não testável; desempenho em GPU física e determinismo ARM (herdados do M1).
- Exclusão de conta via API apenas (sem tela no cliente).

## CI

Run 40400920825 (`c096ee3`): verify Node 24 e 26 (inclui integração com PostgreSQL 18.4 do `compose.yaml` e
`npm run db:migrate` em banco limpo) + e2e Chromium/Linux — todos verdes. O run anterior (40400690422) falhou só no lint
de formatação Markdown; corrigido. Clone limpo: `npm ci` + `verify` verdes (126 testes).

## Próxima ação

1. Revisão visual humana do M1 (checklist acima) e aprovação do M2.
2. Ao aprovar: **M3 — Multiplayer** (Colyseus 0.18 provisório, ADR-0002): autenticar a conexão WebSocket com o cookie de
   sessão do M2 (`AuthService.authenticate`), sala única, spawn, `MoveIntent` do game-core como mensagem, servidor
   autoritativo. Não iniciar sem aprovação.
