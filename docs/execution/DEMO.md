# Demo local

Um comando sobe tudo o que existe, isolado do restante do ambiente:

```sh
npm ci          # uma vez
npm run demo    # Ctrl+C encerra API, cliente e PostgreSQL de demonstração
```

| Peça       | Onde                                              | Observação                                                        |
| ---------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| Cliente    | `http://127.0.0.1:5173` e `http://localhost:5173` | Vite dev; as duas URLs são verificadas antes de serem exibidas    |
| API        | `http://127.0.0.1:2567` (via proxy do cliente)    | `NODE_ENV=development`, `MAIL_TRANSPORT=dev-outbox`               |
| PostgreSQL | `.data/pg-demo`, porta livre, só loopback         | Banco `bar_demo`; nunca lê `.env` nem `DATABASE_URL`              |
| Contas     | `.data/demo-accounts.json` (fora do git)          | 2 contas; senhas aleatórias geradas na 1ª execução e reutilizadas |
- O script checa Node, dependências, portas (2567/5173, configuráveis por `BAR_DEMO_API_PORT`/`BAR_DEMO_WEB_PORT`),
  PostgreSQL, `/ready`, cadastro/login das contas e login pelo proxy do cliente. Cada falha é exibida com a causa e a
  correção.
- As credenciais são impressas no terminal ao iniciar. São descartáveis e só existem no banco de demonstração local.
- `npm run demo -- --smoke` executa todas as verificações e encerra (código 1 em falha).
- Dois jogadores: segunda conta em janela anônima, outro navegador ou na outra URL (cookies separados por host).

## Controles

WASD/setas: mover · Shift: correr · clique na cena: captura o mouse (Esc solta) · mouse: câmera · roda: zoom ·
F3: HUD · `?gfx=low|medium|high` na URL: perfil gráfico (recarrega a página).

## Checklist rápido

1. Login com a conta 1 → cena carrega; nome na barra superior.
2. Andar/correr (Shift): animações idle/walk/run.
3. Colisões: balcão e paredes bloqueiam; obstáculos e meio-fio (sobe) × bloco (bloqueia).
4. Escada do palco sobe; rampa do lounge sobe; rampa íngreme bloqueia.
5. Câmera contra paredes não atravessa; zoom funciona.
6. F3 mostra FPS, p95, draw calls; `?gfx=low` muda o perfil.
7. "Sair" → volta à tela de conta; recarregar continua deslogado.

## Registro

- 2026-10-26: `npm run demo -- --smoke` aprovado duas vezes seguidas (segunda execução reutiliza contas e banco:
  idempotente); portas liberadas ao encerrar.
