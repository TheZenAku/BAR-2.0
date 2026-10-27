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

## Galeria de arte (M4) — separada do multiplayer

```sh
npm run demo:art   # http://127.0.0.1:5174/art.html (BAR_ART_PORT muda a porta); sem banco nem API
```

Na primeira vez baixa os originais das fontes oficiais (≈ 460 MB, SHA-256 conferido; a Quaternius abre o Edge para o
fluxo de download do itch.io) e gera os GLBs; depois reaproveita o cache. `-- --rebuild` refaz; `-- --smoke` verifica
página, catálogo e os 19 arquivos e encerra.

| Ação                                  | Controle                                                            |
| ------------------------------------- | ------------------------------------------------------------------- |
| Candidato 1/2/3 · lado a lado         | `1` `2` `3` · `L`                                                   |
| Girar · zoom · mover                  | arrastar · roda · botão direito                                     |
| Frente · perfil · costas              | `F` `P` `C`                                                         |
| Animação anterior/próxima · pausa     | `←` `→` · `Espaço`                                                  |
| Luz (estúdio/bar/noite) · cenário     | `I` · `E` (estúdio ↔ greybox do bar)                                |
| Material (PBR/argila/sem luz/arame)   | `M`; miniaturas das texturas no painel                              |
| Referência de 1,75 m                  | `R`                                                                 |
| Variante, cabelo, traje, estatísticas | painel à direita (origem, licença com trecho do arquivo, contagens) |

Avaliar: silhueta e leitura a distância no bar, proporção entre candidatos (mesma escala), deformação ao andar/sentar,
expressividade do rosto e adequação ao [conceito](../design/ART_DIRECTION.md). Nenhum candidato está no jogo ainda.

## Acesso remoto (outro computador ou celular) — HTTPS

```sh
npm run demo:remote            # multiplayer + galeria por uma URL https://<aleatório>.trycloudflare.com
npm run demo:remote -- --stop  # em outro terminal: fecha o túnel (ou Ctrl+C no terminal da demo)
```

1. O terminal mostra o **link de acesso** (secreto; também em `.data/remote-access.json`, campo `accessUrl`). Abra-o
   no celular/outro computador: ele grava um cookie de acesso e leva ao multiplayer. A galeria fica em `/art.html`.
2. Entre com uma conta descartável: e-mails no terminal, **senhas só em `.data/demo-accounts.json`** (nesta máquina).
   Para jogar a dois, use dois aparelhos (ou uma janela anônima, que precisa abrir o link de novo).
3. Para cortar o acesso de quem recebeu o link: `--stop`; para invalidar o link de vez: `-- --new-token`.

Independe das demos locais (portas 8780/2580, banco `.data/pg-remote`); podem rodar juntas. Sem conta, sem portas no
roteador, sem regra de firewall, sem instalação global (`cloudflared` oficial verificado em `.cache/tools`). A URL muda
a cada execução. Segurança e limites: [ADR-0006](../decisions/ADR-0006-acesso-remoto.md). `-- --smoke` verifica tudo
pela URL pública e encerra; `-- --local` faz o mesmo sem túnel (testes).

**IP público direto / LAN:** não configurado (NAT duplo, CGNAT não verificado, exigiria portas nos roteadores, regra de
firewall e TLS — ver ADR-0006). O link HTTPS funciona também de aparelhos na mesma rede.

## Não implementado (marcos futuros)

Avatar definitivo e personalização (M5), cenário final (M6), interações/cadeiras/portas (M7), chat (M8),
jogos e economia (M9/M10), tela de exclusão de conta, e-mail real. Jogadores não colidem entre si (ADR-0005).

## Registro

- 2026-10-26: `npm run demo -- --smoke` aprovado repetidas vezes (idempotente); multiplayer verificado pelo proxy WS;
  navegador real (Edge) nas duas URLs com as duas contas: ambos online, posição idêntica nas duas telas, 0 erros.
- 2026-10-26 (M4): `npm run demo:art -- --smoke` aprovado (19 arquivos); E2E da galeria no Edge aprovado; demo
  multiplayer `--smoke` aprovada de novo após o M4 (portas/cluster isolados), 2 contas na mesma sala.
- 2026-10-26 (acesso remoto): `demo:remote -- --smoke` aprovado pela URL pública (15 verificações); E2E em navegador real
  pela URL HTTPS (Edge, 16 verificações); `--stop` fecha o túnel (URL → 530). Rede externa de outro provedor: NÃO VERIFICADO.
