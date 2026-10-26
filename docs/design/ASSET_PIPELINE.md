# Pipeline de assets 3D (M4)

```
original oficial ──fetch──► .cache/assets/originals/<fonte>/   (SHA-256 fixado; nunca modificado)
   │                         licença lida do próprio pacote
   └──build──► importa (glTF-Transform) → normaliza → otimiza → GLB → valida (Khronos) → catálogo + manifest
                             .cache/assets/generated/<candidato>/<item>.glb · catalog.json · report.json
                             docs/assets/MANIFEST.json (versionado)
```

| Comando                                         | O que faz                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run assets:fetch`                          | Baixa das fontes oficiais (HTTP; itch.io pelo fluxo da página com Playwright), confere SHA-256, extrai zips |
| `npm run assets:build`                          | Gera os GLBs, valida cada um, escreve catálogo/relatório e o manifest; código 1 se houver erro de validação |
| `npm run assets:build -- --check[=ids]`         | Reprodutibilidade: gera em `.cache/assets/check`, valida e exige SHA-256 idêntico ao manifest (CI)          |
| `npm run demo:art`                              | Galeria (gera os assets se faltarem)                                                                        |
| `node scripts/assets/gltf-report.mjs <arquivo>` | Relatório avulso: validador + triângulos, juntas, animações, materiais, texturas, limites                   |

Configuração única: [assets/art-candidates.json](../../assets/art-candidates.json) (fontes, hashes, licenças, regras
por pacote). Hash divergente = o autor mudou o arquivo → revisar licença e conteúdo antes de atualizar o pin (o fetch
nunca atualiza um pin sozinho).

**Garantias verificadas:**

- **Licença:** cada pacote baixado traz seu arquivo de licença (`licenseEvidence`, um por pacote — a Quaternius combina
  3); o build lê esse arquivo e falha se ele não declarar a licença configurada. Só CC0 1.0 é aceita hoje.
- **Extração:** as entradas do zip são listadas antes e recusadas se forem absolutas ou tiverem `..`; links extraídos
  também abortam. Os originais ficam intactos ao lado (`x/` é a extração).
- **Reprodutível:** mesmos originais + mesmas versões ⇒ GLBs byte a byte iguais (19/19 conferidos com `--check`).
- **CI:** job `assets` refaz Kenney e KayKit (fontes HTTP, ≈ 17 MB) em Linux, valida e compara os hashes. A Quaternius
  (itch.io, ≈ 440 MB por fluxo de navegador) é conferida só localmente.
- **Testes sem download:** [scripts/assets/assets.test.mjs](../../scripts/assets/assets.test.mjs) (fontes oficiais e
  fixadas, evidência de licença por pacote, manifest ↔ configuração, caminhos de extração) no `npm test`.
- **Ferramentas de dev não distribuídas:** o binário do `sharp` inclui libvips (LGPL-3.0-or-later); só roda no build,
  não vai para o cliente nem para o servidor.

## Convenções

- **Escala/orientação:** metros, +Y para cima, frente em +Z, pés em y = 0. O pacote inteiro recebe uma escala
  uniforme para que a variante de referência meça 1,75 m (diferenças de altura entre variantes são preservadas). A
  escala fica num nó raiz `BAR_Normalized`; malhas e animações não são reamostradas.
- **Blender → Three.js:** Blender é Z-up; o exportador glTF oficial converte para Y-up (opção "+Y Up", padrão).
  Exportar com "Apply Modifiers", sem "Apply Transform" em armaduras animadas; escala 1,0 com unidade em metros;
  frente do personagem em −Y no Blender (vira +Z no glTF).
- **Nomes:** ossos idênticos dentro de um pacote (requisito para peças modulares e animações compartilhadas);
  peças `Slot_Variante` (ex.: `Male_Peasant_Body`); colisores de cenário, quando vierem do GLB (M6), com prefixo
  `COL_` e caixas/cápsulas simples — o avatar não usa a malha para colisão.
- **Materiais:** `MeshStandardMaterial` (metallic/roughness). ≤ 3 por avatar; nada de shaders customizados no asset.
- **UVs/texturas:** UV0 em [0,1] quando possível (a quantização Meshopt pula UVs fora da faixa — visto no corpo masculino da Quaternius);
  texturas ≤ 1024², WebP (`EXT_texture_webp`), normal maps sem perdas.
- **Metadados:** cada GLB gerado tem SHA-256, origem, licença e lista de modificações no manifest.
- **Relatórios:** `report.json` (erros/avisos do validador, contagens, tamanhos antes/depois); falha do validador
  interrompe o build.
- **Original preservado:** o pipeline só lê `.cache/assets/originals`; correções (ex.: referência de textura
  quebrada na Quaternius) acontecem em memória e ficam registradas.

## Ferramentas

| Ferramenta                   | Versão         | Uso                                     | Situação                                                                                      |
| ---------------------------- | -------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| glTF-Transform (core/ext/fn) | 4.5.1          | leitura, poda, dedup, resample, escrita | adotado (dev)                                                                                 |
| Khronos glTF-Validator       | 2.0.0-dev.3.10 | validação de todo GLB gerado            | adotado (dev)                                                                                 |
| meshoptimizer                | 1.3.0          | `EXT_meshopt_compression`               | adotado: KayKit 3,5 → 2,1 MB, biblioteca Quaternius 7,4 → 2,1 MB                              |
| sharp                        | 0.35.5         | redimensionar/WebP                      | adotado (dev, binário pré-compilado, sem scripts de instalação): corpo Quaternius 15 → 0,6 MB |
| KTX2 (KTX-Software `ktx`)    | —              | texturas comprimidas na GPU             | **NÃO VERIFICADO**: binário ausente; reavaliar quando houver texturas de cenário (M6)         |
| Blender                      | —              | modelagem/rig/trajes                    | **ausente nesta máquina**; não instalado (software global)                                    |

**Blender recomendado:** série **5.2 LTS** (5.2.3, atualizada em 2026-10-22 segundo blender.org/download/lts) ou
4.5 LTS (4.5.15) se algum addon exigir. Instalação: instalador oficial de blender.org (ou `winget install
BlenderFoundation.Blender`), sem alterar o projeto. O pipeline atual não depende do Blender: ele entra no M5 para
criar trajes/peças no rig escolhido; a validação continua sendo a desta página.

## O que não foi feito (sem benefício demonstrado ainda)

LODs automáticos, atlas de texturas entre peças, KTX2 e simplificação de malha. Cada um será medido quando houver
cena com vários avatares e o cenário final.
