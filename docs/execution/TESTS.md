# TESTS

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
| CI remoto         | GitHub Actions                                                 | NÃO VERIFICADO — sem remoto                                                              |
| Node 24           | —                                                              | NÃO VERIFICADO — indisponível localmente                                                 |
