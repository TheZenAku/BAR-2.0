# STATE

- **Marco:** M4 — Arte · **Status:** técnico CONCLUÍDO (local); **aprovação artística humana PENDENTE**
- **M3:** CONCLUÍDO (local + CI), aguardando aprovação. **M2:** idem. **M1:** técnico concluído; visual NÃO VERIFICADO.
- **Data:** 2026-10-26
- **Demos:** `npm run demo` → `http://127.0.0.1:5173` · `npm run demo:art` → `http://127.0.0.1:5174/art.html` ·
  **remoto:** `npm run demo:remote` → link HTTPS `*.trycloudflare.com` com token ([DEMO.md](DEMO.md))

## Funciona (com evidência — [TESTS.md](TESTS.md))

- **Pipeline de assets sem Blender** ([ASSET_PIPELINE.md](../design/ASSET_PIPELINE.md)): fontes oficiais com SHA-256
  fixado, extração verificada, licença CC0 lida e afirmada no arquivo de cada pacote, normalização (m, +Y, frente +Z,
  pés em 0, referência 1,75 m), WebP ≤ 1024², Meshopt, validação Khronos. 19 GLBs, 0 erros; reprodutível byte a byte.
- **Manifest** ([docs/assets/MANIFEST.json](../assets/MANIFEST.json)): 19 entradas com origem, licença + hash do
  arquivo de licença, hashes original/gerado e modificações. Nada é incorporado ao jogo nem versionado em binário.
- **3 candidatos reais** ([ASSET_RESEARCH.md](../design/ASSET_RESEARCH.md)): Kenney Mini Characters, KayKit
  Adventurers, Quaternius Universal (+ trajes e biblioteca de animações), todos CC0.
- **Galeria** separada do multiplayer: alternar/lado a lado, órbita/zoom, frente/perfil/costas, 3 luzes, estúdio ou
  greybox do bar, todas as animações, 4 modos de material, texturas, cabelos/trajes, origem/licença/estatísticas.
- **Multiplayer preservado:** demo e E2E M1–M3 aprovados após as mudanças (o M4 só adicionou rota `/art-assets` ao
  servidor de dev do Vite).

- **Acesso remoto** ([ADR-0006](../decisions/ADR-0006-acesso-remoto.md)): túnel HTTPS de saída (sem conta, sem portas,
  sem firewall) → gateway em loopback (link secreto → cookie, Host, rotas fixas, CSP) → API em modo production
  (cookie `__Host-` Secure, Origin exata, rate limit por IP real) com banco próprio. Multiplayer, login/logout, `wss`
  e galeria verificados em navegador pela URL pública; `--stop` desliga.
- **Comparação artística** objetiva e recomendação técnica (KayKit) em [ART_DIRECTION.md](../design/ART_DIRECTION.md).

## NÃO VERIFICADO / riscos

- **Acesso de outra rede/celular:** NÃO VERIFICADO (testes saíram desta máquina pelo caminho público). IP público direto:
  não configurado — NAT duplo confirmado, CGNAT não verificado (ADR-0006). URL do túnel muda a cada execução.

- **Escolha artística:** nenhuma; direção em [ART_DIRECTION.md](../design/ART_DIRECTION.md) é proposta.
- Reprodutibilidade entre plataformas verificada só para Kenney + KayKit (CI Linux); Quaternius só no Windows.
- Quaternius só é baixável pelo fluxo do itch.io (Playwright); não roda no CI. Se o itch.io mudar a página, o fetch
  falha (com mensagem) — os originais em cache continuam válidos.
- Blender e KTX2 ausentes na máquina; LOD, atlas e KTX2 adiados até haver cena com vários avatares (M5/M6).
- **Processos órfãos:** `postgres.exe --forkchild=io_worker` (PIDs 1144 e 3884) ainda seguram `.data/pg-test` e
  `.data/pg-e2e`; testes locais rodam com `BAR_PG_SUFFIX=-m4` (outro diretório de cluster). Reiniciar resolve.
- No Windows, encerrar só o processo pai (ex.: fechar a ferramenta que rodou o npm) pode deixar filhos vivos; use
  `npm run demo:remote -- --stop`.
- Herdados do M3: desempenho só em VM, cargas > 16 jogadores, um processo (sem Redis), Docker local, e-mail real.

## CI

Run 40418272350 (`2d5bec9`, M4): verify Node 24 e 26 + e2e Chromium + `assets` (validação glTF e hashes idênticos ao
manifest em Linux) — todos verdes.

## Próxima ação

1. Revisão humana na galeria: escolher o personagem base e as decisões visuais pendentes de
   [ART_DIRECTION.md](../design/ART_DIRECTION.md) (estilização, acabamento, rosto, paleta).
2. Registrar a escolha (ROADMAP/ART_DIRECTION). Só então **M5 — Avatares**. Revisões M1–M3 continuam pendentes.
