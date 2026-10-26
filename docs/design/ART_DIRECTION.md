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

## Como cada candidato se encaixa (análise, não decisão)

- **Kenney Mini:** humor e leveza imediatos, leve demais (≈ 730 triângulos, 7 juntas): pouca expressividade de corpo e
  mãos; braços abertos no idle. Ótimo para multidões; distante do "PS2 com acabamento".
- **KayKit Adventurers:** o mais próximo do conceito — formas robustas, rosto expressivo, atlas de gradiente leve,
  76 → 32 animações úteis (sentar em cadeira, comemorar, interagir). Tema fantasia: exige trajes casuais próprios
  (as partes do corpo já são separadas, o que facilita).
- **Quaternius Universal:** maior fidelidade e mais animações sociais (dançar, conversar sentado), mas puxa para o
  realista; na versão gratuita o corpo "super-herói" atravessa os trajes e não há cabeça avulsa (tier pago, também CC0).
  Mais pesado (≈ 14–27 k triângulos com traje, 3 conjuntos PBR).

Recomendação técnica para o protótipo do M5, **sujeita à sua escolha**: KayKit como linguagem base, com trajes casuais
de boteco modelados no mesmo rig.
