# STATE

- **Marco:** M3 — Multiplayer · **Status:** CONCLUÍDO (local), aguardando aprovação humana; CI: ver abaixo
- **M2:** CONCLUÍDO (local + CI), aguardando aprovação. **M1:** CONCLUÍDO tecnicamente; revisão visual humana NÃO VERIFICADA.
- **Data:** 2026-10-26
- **Demo:** `npm run demo` → `http://127.0.0.1:5173` (detalhes, contas e checklist: [DEMO.md](DEMO.md))

## Funciona (com evidência — [TESTS.md](TESTS.md))

- **Sala compartilhada** (Colyseus 0.18 no mesmo processo/porta do Fastify — [ADR-0005](../decisions/ADR-0005-multiplayer.md)):
  vaga por `POST /api/v1/game/join` com a sessão do M2; handshake WebSocket valida Origin e o cookie de sessão
  (`AuthService.authenticate`), também na reconexão; nenhum token em URL, mensagem ou log.
- **Autoridade:** cliente envia só intenções; o servidor simula 60 Hz com o `game-core` (colisão com o cenário no
  servidor), aplica a sequência exata do cliente sob um orçamento de tempo (anti speed hack), ignora duplicatas,
  descarta mensagens inválidas e fecha conexões abusivas. Snapshots 20 Hz com `ack`.
- **Sessão:** logout, recuperação de senha e exclusão de conta derrubam a conexão na hora; expiração em ≤ 15 s;
  uma presença por conta (nova aba substitui a anterior); limite configurável `GAME_MAX_PLAYERS` (409 `room_full`).
- **Cliente:** predição imediata + reconciliação (0 correções nos E2E), remotos interpolados (100 ms) em laranja com
  nome, animações idle/walk/run locais, indicador de conexão e jogadores, linha de rede no F3, reconexão automática.
- **Demo:** banco isolado, 2 contas descartáveis idempotentes, verificação da sala por WebSocket antes de exibir a URL.
- **Testes:** 165 (39 novos) + E2E multiplayer com 2 navegadores (Edge e Firefox) + regressão M1/M2; carga 1/2/8/16.

## NÃO VERIFICADO / riscos

- **Processos órfãos nesta máquina:** dois `postgres.exe --forkchild=io_worker` do projeto (PIDs 1144 e 3884) seguram a
  memória compartilhada de `.data/pg-test` e `.data/pg-e2e`; enquanto existirem, `npm test`/`test:e2e` locais só rodam
  com `BAR_TEST_DATABASE_URL` (foi assim a validação desta sessão). Encerrar esses PIDs (ou reiniciar) resolve. Causa
  corrigida: clusters embutidos agora usam `io_method=sync`.
- Desempenho e picos de tick (até 106 ms isolados) medidos só em VM; cargas > 16 jogadores não testadas.
- Um mundo Rapier por jogador (~0,2 ms/jogador/tick) e jogadores sem colisão entre si — revisar para salas grandes.
- Um processo: sala, revogações e rate limit em memória. Multi-processo exige Redis/presença compartilhada.
- Colyseus aumenta as dependências de produção do servidor (67 → 158 pacotes; licenças ok, 0 vulnerabilidades).
- Herdados: Docker local, e-mail real, cadastro revela e-mail existente, exclusão sem tela, SIGTERM no Windows,
  desempenho em GPU física, determinismo ARM (mitigado pela reconciliação).

## CI

Pendente do push deste marco (registrado ao final da sessão). Último aprovado: run 40400920825 (`c096ee3`, M2).

## Próxima ação

1. Revisão humana: M1 visual + M2 + M3 pela demo ([DEMO.md](DEMO.md), seção "Multiplayer em 2 janelas").
2. Ao aprovar: **M4 — Arte** (pesquisa/licenças, comparação visual, pipeline). Não iniciar sem aprovação.
