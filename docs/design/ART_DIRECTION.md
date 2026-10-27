# Direção artística — preliminar (M4)

> **Status: proposta.** Nenhuma escolha visual está aprovada. A escolha do personagem e as decisões marcadas como
> _pendente_ dependem de aprovação humana na galeria (`npm run demo:art`).

## Conceito

**Boteco brasileiro estilizado, com a cara da geração PS2 e acabamento atual.** Um bar de bairro (balcão de fórmica,
azulejo até meia parede, cadeiras de plástico, engradados, freezer, TV no alto, ventilador de teto, quadro de giz com o
cardápio, letreiro luminoso) visto por um filtro de jogo: formas simplificadas e legíveis, cores quentes e saturadas,
pequenos exageros de proporção. Social e bem-humorado, levemente caótico (copo que balança, garçom com pressa, fio de
luz pendurado), nunca sujo ou depreciativo.

- **Não é fotorrealista.** Detalhe vem da silhueta e da cor, não de microtextura.
- **Nada protegido:** sem marcas reais (cervejas, refrigerantes, times), sem personagens ou bares existentes. Rótulos e
  letreiros são fictícios.
- **Inclusivo:** variedade de corpos, tons de pele, idades e acessórios de acessibilidade (o pacote Kenney já traz
  cadeira de rodas, bengala e óculos). Humor vem das situações, não de estereótipos.

## Decisões técnicas (valem para qualquer candidato)

| Tema               | Regra                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Unidades e eixos   | 1 unidade = 1 m; +Y para cima; frente do modelo em +Z; pés em y = 0 (contrato do `AvatarView`, M1)                          |
| Altura de jogo     | Avatar de referência ≈ 1,75 m (pipeline normaliza o pacote inteiro preservando diferenças entre variantes)                  |
| Colisão            | O avatar visual nunca colide: a colisão é o cilindro do `game-core` (raio 0,3 m, altura 1,7 m)                              |
| Orçamento avatar   | ≤ 15 k triângulos, ≤ 6 draw calls, ≤ 3 materiais, texturas ≤ 1024² (WebP hoje; KTX2 avaliado), 1 esqueleto por pacote       |
| Animação           | Clipes compartilhados por esqueleto (nunca por personagem); papéis mínimos idle/walk/run + sentar, interagir, comemorar     |
| Personalização     | Peças modulares no mesmo esqueleto (cabeça, tronco, pernas, cabelo, traje), religadas por nome de osso (provado na galeria) |
| Rede               | Só estado de locomoção/escolhas de peças trafega; bones nunca (decisão do M3)                                               |
| Iluminação de jogo | Hemisférica quente + direcional com sombra (M1); luzes pontuais coloridas só como acento (custo por pixel)                  |
| Desempenho         | Metas finais medidas em hardware físico (M12); valores desta VM são relativos                                               |

## Escolhas visuais pendentes (decisão humana)

1. **Personagem base** — um dos 3 candidatos da galeria (ver [ASSET_RESEARCH.md](ASSET_RESEARCH.md)).
2. **Grau de estilização** — chibi (cabeça ≈ 1/3 da altura), estilizado intermediário ou proporção humana.
3. **Acabamento** — gradiente/atlas chapado (KayKit/Kenney) × PBR com normal map (Quaternius) × toon com contorno.
4. **Rosto** — expressões por troca de textura × sem expressão (o tema pede expressividade).
5. **Paleta final** — proposta abaixo.
6. **Identidade do bar** — nome, letreiro e cores próprias (M6).

## Paleta proposta (provisória)

| Uso                 | Cor       | Nota                         |
| ------------------- | --------- | ---------------------------- |
| Madeira / balcão    | `#7a4a2a` | já usada no greybox (`wood`) |
| Azulejo             | `#3f8f8a` | verde-água de boteco         |
| Cadeira de plástico | `#c8312b` | vermelho saturado, genérico  |
| Luz incandescente   | `#ffd9a0` | cor da luz principal         |
| Neon de acento      | `#ff3d9a` | rosa; usar com parcimônia    |
| Neon secundário     | `#2de0ff` | ciano                        |
| Fundo / sombra      | `#1a1410` | cor de fundo e névoa do M1   |

## Comparação para a decisão (análise, não decisão)

Números medidos nos GLBs gerados (catálogo do pipeline); "16 jogadores" = triângulos de avatares numa sala cheia
(limite atual `GAME_MAX_PLAYERS`). Estética e expressividade são leitura técnica da galeria: **confirme olhando**.

| Critério                       | Kenney Mini                                      | KayKit Adventurers                                                                  | Quaternius Universal                                                                    |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Adequação ao conceito (boteco) | humor e leveza; visual "mobile", distante do PS2 | **mais próxima**: chibi robusto, cores quentes, leitura a distância                 | proporção humana; puxa para o realista                                                  |
| Expressividade                 | baixa: 7 juntas, mãos sem dedos, rosto mínimo    | **alta**: rosto marcado, corpo com 41 juntas                                        | corpo bom (65 juntas, dedos); rosto neutro, sem expressões no tier gratuito             |
| Proporções                     | cabeça enorme, membros curtos                    | chibi (cabeça grande)                                                               | humanas (biotipo "super-herói" no gratuito)                                             |
| Animações (sociais)            | 32: sentar, sim/não, interagir, cadeira de rodas | 32 mantidas: sentar cadeira/chão (entrar/sair), comemorar, interagir                | **43**: dançar, conversar em pé e sentado, sentar, interagir                            |
| Personalização                 | 12 personagens fixos; troca de cor pela paleta   | partes do corpo separadas no mesmo rig (cabeça, tronco, braços…)                    | **cabelos e trajes modulares** já religados no mesmo esqueleto (provado)                |
| Roupas modernas                | não há; criar é limitado pelo estilo/rig mínimo  | não há (tema fantasia); formas simples → modelar casual é viável                    | não há no gratuito (só fantasia); roupa realista exige mais trabalho de pesos           |
| Desempenho (por avatar)        | ≈ 0,75 k tri, 1 material, 77 KB                  | ≈ 4,3–4,8 k tri, 1 material, 2,1 MB (animações embutidas)                           | ≈ 28–45 k tri com traje e cabelo, 5–6 materiais, 1,2–1,9 MB + 2,1 MB de animações       |
| 16 jogadores (triângulos)      | ≈ 12 k                                           | ≈ 75 k                                                                              | ≈ 450–730 k (fora do orçamento de ≤ 15 k/avatar sem LOD e corte do corpo oculto)        |
| Trabalho para adaptar (M5)     | baixo, mas teto baixo                            | **médio**: trajes casuais e cabelos no rig; separar animações num GLB compartilhado | alto: trajes atravessados pelo corpo, LOD, materiais, rosto; corpo "regular" só no pago |
| Ferramenta necessária          | —                                                | Blender (ausente nesta máquina) para trajes                                         | Blender para trajes/ajustes                                                             |

**Recomendação técnica (decisão sua):** KayKit como linguagem base — a mais próxima do conceito, expressiva e dentro do
orçamento com folga para 16+ jogadores; o custo é criar trajes casuais e cabelos no mesmo rig (exige Blender). Quaternius
vale se a preferência for proporção humana e mais animações sociais, aceitando bem mais trabalho de otimização. Kenney só
se a prioridade for multidões muito grandes ou estilo minimalista.

Para decidir, responda: **(1)** personagem base; **(2)** grau de estilização; **(3)** acabamento; **(4)** rosto com ou sem
expressões. Até lá nenhum trabalho do M5 (rig, trajes, personagens finais) é iniciado.
