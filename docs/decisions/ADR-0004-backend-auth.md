# ADR-0004 — Backend: HTTP, PostgreSQL, contas e sessões

- Status: **Aceita** (2026-10-26, M2). Todas as decisões são reversíveis; o contrato público é `/api/v1` (`packages/shared/src/auth.ts`).
- Evidência: testes de integração com PostgreSQL 18.4 real (`apps/server/src/**/*.int.test.ts`) e E2E em navegador
  ([TESTS.md](../execution/TESTS.md)).

## Stack

| Área          | Escolha                                                                                               | Motivo                                                                                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP          | Fastify 5 + `@fastify/cookie` (MIT)                                                                   | Maduro; logger **é** pino (mantém ADR-0002), `reqId` por requisição, parser JSON com proteção a `__proto__`, `inject()` para testes sem rede. `node:http` puro exigiria reimplementar parsing, cookies e erros. |
| Banco         | PostgreSQL 18 (driver `pg` 8, pool limitado)                                                          | Transações/constraints para ledger (M10). Pool com `max`, timeout de conexão e `statement_timeout` configuráveis.                                                                                               |
| Persistência  | Kysely 0.29 (query builder tipado, MIT)                                                               | SQL explícito com tipos; sem ORM/geração de código. Parametrização sempre (sem SQL injection).                                                                                                                  |
| Migrações     | Migrator do Kysely, lista estática em `db/migrator.ts`                                                | Versionadas, append-only, com `down`; lock no banco serializa execuções concorrentes (testado). Aplicadas no boot (`DB_AUTO_MIGRATE`) ou via `npm run db:migrate`.                                              |
| Senhas        | Argon2id **nativo do Node** (`crypto.argon2`, ≥ 24.7)                                                 | Sem addon nativo. Parâmetros OWASP mínimos (m=19 MiB, t=2, p=1), formato PHC, `needsRehash` + rehash transparente no login. Motivo do `engines.node >=24.7.0`.                                                  |
| Validação     | zod 4 (schemas em `packages/shared`)                                                                  | Mesmo schema no cliente (feedback) e no servidor (autoridade). Entradas estritas.                                                                                                                               |
| Rate limiting | Janela fixa em memória (`http/rate-limit.ts`)                                                         | Um processo até M13 (ADR-0002). Com múltiplos processos, trocar por store compartilhado.                                                                                                                        |
| PG local      | Docker Compose (`compose.yaml`) **ou** `embedded-postgres` (binários oficiais via npm, devDependency) | Docker ausente nesta máquina: `embedded-postgres` dá PostgreSQL real sem instalação global (dados em `.data/`, ignorado). CI usa o Compose.                                                                     |

Descartados: Express (sem schemas/hook model equivalentes, logger separado), Drizzle/Prisma (geração de código/CLI extra),
`argon2` npm (addon nativo, desnecessário com Node ≥ 24.7), `@fastify/rate-limit` (uma regra por rota; precisamos IP + conta),
PGlite (Postgres em WASM/in-memory não é evidência de integração real).

## Sessões

- Token opaco de 256 bits em cookie `HttpOnly; SameSite=Lax; Path=/`; com `COOKIE_SECURE` (forçado em produção) vira
  `__Host-bar_sid` + `Secure`. O banco guarda só o **SHA-256** do token (vazamento do banco não gera sessões válidas).
- Expiração absoluta `SESSION_TTL_HOURS` (padrão 30 dias), verificada no banco a cada requisição; purga horária.
- Invalidação: logout apaga a sessão no servidor; login rotaciona a sessão apresentada (anti-fixação); redefinição de
  senha e exclusão de conta revogam todas as sessões. Sem expiração por inatividade nem "lembrar de mim" (decidir no M12).

## CSRF

Cookie de sessão ⇒ defesa obrigatória. Em todo método não-seguro sob `/api`: `Content-Type: application/json`
(formulários HTML não conseguem enviar; `fetch` cross-origin com JSON exige preflight CORS, que nunca é concedido) **e**
`Origin` na allowlist `ALLOWED_ORIGINS` (sem `Origin`, `Sec-Fetch-Site` precisa ser `same-origin`). Somado a `SameSite=Lax`.
Sem token sincronizador: desnecessário com essas camadas (OWASP CSRF Cheat Sheet, defesas baseadas em Origin/Fetch Metadata).

## Enumeração de contas

- Login: mesma resposta (`401 invalid_credentials`) para e-mail inexistente e senha errada; conta inexistente verifica
  contra um hash descartável (custo Argon2 equivalente).
- Recuperação: sempre `202` sem corpo; envio em segundo plano.
- **Cadastro revela** se o e-mail já existe (`409 email_unavailable`, mensagem neutra). Inevitável sem confirmação de e-mail
  por mensagem; mitigado por rate limit por IP. Revisitar quando houver provedor de e-mail (confirmar antes de ativar).

## Rate limits (padrão)

| Ação                       | Por IP      | Por conta (e-mail) |
| -------------------------- | ----------- | ------------------ |
| cadastro                   | 5 / h       | —                  |
| login                      | 20 / 15 min | 10 / 15 min        |
| pedido de recuperação      | 5 / h       | 3 / h              |
| confirmação de recuperação | 10 / 15 min | —                  |
| exclusão de conta          | 5 / 15 min  | —                  |

Limite por conta permite bloquear temporariamente o login de terceiros (custo aceito; janela curta). Atrás de proxy,
`TRUST_PROXY=true` só se o proxy sobrescrever `X-Forwarded-For`.

## Recuperação de acesso

Token de uso único (256 bits, SHA-256 no banco, TTL `PASSWORD_RESET_TTL_MINUTES`=30), um ativo por conta. Link
`PUBLIC_APP_URL/#reset=<token>`: no fragmento (não vai a servidores nem ao `Referer`) e removido da URL pelo cliente.
**Não há envio real de e-mail**: `MAIL_TRANSPORT=disabled` (padrão; nada é enviado, só um aviso no log) ou `dev-outbox`
(grava JSON em `.data/outbox/`, proibido em produção pela validação de config). Provedor real = decisão futura (antes do beta).

## Exclusão de conta e política de dados

- `DELETE /api/v1/account` com reconfirmação de senha. **Exclusão definitiva** (hard delete): conta, sessões e tokens
  (FK `on delete cascade`). O e-mail fica livre para novo cadastro.
- Dados guardados hoje: e-mail (privado, nunca retornado pela API), hash da senha, nome de exibição, id público, datas.
  Logs: só `publicId` e `reqId` — nunca e-mail, senha, tokens, cookies ou `DATABASE_URL` (redaction + teste dedicado).
- A partir do M10 (ledger), dados financeiros exigem retenção: a exclusão passará a **anonimizar** a conta e manter os
  lançamentos. Decidir junto com o M10.

## Contratos e compatibilidade

Prefixo `/api/v1`. Servidor rejeita campos desconhecidos (schemas estritos); cliente ignora campos novos nas respostas
(leitor tolerante). Mudança incompatível → `/api/v2` mantendo `v1` por pelo menos uma versão do cliente. Erros sempre em
`{ error: { code, message, requestId, issues? } }`; o cliente traduz por `code`.

## Operação

`/health` = liveness (não toca no banco); `/ready` = PostgreSQL responde em ≤ 2 s e o processo não está drenando.
Banco fora do ar → `503 service_unavailable` (sem derrubar o processo). Desligamento: readiness 503 → `close()` aguarda
requisições → pool liberado. Métricas Prometheus: **não justificadas ainda** (um processo, sem consumidor); logs com
`reqId` + `responseTime` cobrem o M2. Reavaliar no M13.
