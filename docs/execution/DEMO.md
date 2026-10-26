# Demo local

Um comando sobe tudo o que existe, isolado do restante do ambiente:

```sh
npm ci          # uma vez
npm run demo    # Ctrl+C encerra API, cliente e PostgreSQL de demonstração
```

| Peça       | Onde                                              | Observação                                                              |
| ---------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| Cliente    | `http://127.0.0.1:5173` e `http://localhost:5173` | Vite dev; as duas URLs são verificadas antes de serem exibidas          |
| API + sala | `http://127.0.0.1:2567` (via proxy do cliente)    | `/api`, `/health`, `/ready` e WebSocket `/game`; `NODE_ENV=development` |
| PostgreSQL | `.data/pg-demo`, porta livre, só loopback         | Banco `bar_demo`; nunca lê `.env` nem `DATABASE_URL`                    |
| Contas     | `.data/demo-accounts.json` (fora do git)          | 2 contas; senhas aleatórias geradas na 1ª execução e reutilizadas       |
- O script checa Node, dependências, portas (2567/5173, configuráveis por `BAR_DEMO_API_PORT`/`BAR_DEMO_WEB_PORT`),
  PostgreSQL, `/ready`, cadastro/login das contas e, pelo proxy do cliente, coloca **as duas contas na mesma sala via
  WebSocket**. Cada falha é exibida com causa e correção.
- As credenciais são impressas no terminal ao iniciar. São descartáveis e só existem no banco de demonstração local.
- `npm run demo -- --smoke` executa todas as verificações e encerra (código 1 em falha).
- Se a porta estiver ocupada por uma demo anterior que não foi encerrada com Ctrl+C, encerre aquele processo.

## Controles

WASD/setas: mover · Shift: correr · clique na cena: captura o mouse (Esc solta) · mouse: câmera · roda: zoom ·
F3: HUD (inclui linha de rede) · `?gfx=low|medium|high` na URL: perfil gráfico.

## Multiplayer em 2 janelas

1. Janela normal: `http://127.0.0.1:5173`, entrar com a conta 1.
2. Janela anônima (ou outro navegador, ou `http://localhost:5173`): entrar com a conta 2.
3. Canto inferior direito: "Online · 2/16 jogadores". O outro jogador aparece em laranja com o nome; você é azul.
4. Mova uma janela e observe na outra: andar/correr (animações), colisão no balcão.
5. Reconexão: F3 mostra `reconexões`; para testar, desligue a rede por alguns segundos ou recarregue a página.
6. "Sair" numa janela: o jogador some da outra na hora e o indicador volta a "1/16".

## Checklist rápido

1. Login com a conta 1 → cena carrega; nome na barra superior.
2. Andar/correr (Shift): animações idle/walk/run.
3. Colisões: balcão e paredes bloqueiam; obstáculos e meio-fio (sobe) × bloco (bloqueia).
4. Escada do palco sobe; rampa do lounge sobe; rampa íngreme bloqueia.
5. Câmera contra paredes não atravessa; zoom funciona.
6. F3 mostra FPS, p95, draw calls e rede (RTT, snapshots/s, correções); `?gfx=low` muda o perfil.
7. Segunda conta em outra janela: ambos se veem e se movem; "Sair" remove o jogador da sala.

## Não implementado (marcos futuros)

Avatar definitivo e personalização (M5), arte e cenário final (M4/M6), interações/cadeiras/portas (M7), chat (M8),
jogos e economia (M9/M10), tela de exclusão de conta, e-mail real. Jogadores não colidem entre si (ADR-0005).

## Registro

- 2026-10-26: `npm run demo -- --smoke` aprovado repetidas vezes (idempotente); multiplayer verificado pelo proxy WS;
  navegador real (Edge) nas duas URLs com as duas contas: ambos online, posição idêntica nas duas telas, 0 erros.
