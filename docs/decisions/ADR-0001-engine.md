# ADR-0001 — Engine de renderização do cliente: Three.js

- Status: **Aceita** (2026-10-26, M0). Reversível até o fim de M1 com custo baixo (a lógica de jogo é independente da engine).
- Evidências: [research/engine-poc/results/RESULTS.md](../../research/engine-poc/results/RESULTS.md) (POCs reais) e pesquisa documental abaixo.

## Contexto

Jogo social 3D no navegador, desktop primeiro (Chromium/Firefox), hardware modesto, estilo PS2 estilizado, servidor
autoritativo em TypeScript/Node, equipe de 2 devs + IA. Candidatas: PlayCanvas, Babylon.js, Three.js, Godot Web.

## Eliminação documental: Godot Web (sem POC)

Eliminada antes do POC por restrições documentadas, não por desempenho:
- C# não exporta para Web no Godot 4 (docs estáveis 4.7) — [exporting_for_web](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html).
- GDScript não roda em Node: regras não podem ser compartilhadas com o servidor TS; exigiria servidor Godot headless (duplicação ou troca de backend) — [dedicated servers](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_dedicated_servers.html).
- Web export apenas WebGL2/Compatibility; WebGPU não suportado; threads exigem COOP/COEP — mesma fonte.
- Download: ~42 MB num export 3D padrão 4.4 (medição comunitária, [popcar.bearblog.dev](https://popcar.bearblog.dev/how-to-minify-godots-build-size/)); sem número oficial.

## POCs (3 finalistas, condições idênticas)

Mesmos assets GLB gerados, mesma simulação Rapier, câmera, input, iluminação e protocolo de medição.
Ambiente: **VM VMware com GPU virtual** — números servem para comparação relativa; valores absolutos: NÃO VERIFICADO.

| Edge sem vsync, 48 avatares + sombras | Three.js r186 | Babylon.js 9.32 | PlayCanvas 2.23 |
| ------------------------------------- | ------------- | --------------- | --------------- |
| FPS / frame p95                       | 117 / 10.6 ms | 102 / 12.1 ms   | 150 / 8.7 ms    |
| CPU main-thread p95                   | 8.3 ms        | 9.8 ms          | 6.0 ms          |
| JS da engine baixado (gzip)           | ~155 KB       | ~620 KB         | ~300 KB         |
| Heap JS                               | 23 MB         | 63 MB           | 44 MB           |
| Load até 1º frame (local)             | ~560 ms       | ~920–1150 ms    | ~640–680 ms     |

Todas: licença permissiva (MIT / Apache-2.0 / MIT), custo zero no uso engine-only, funcionamento correto em Edge e Firefox.

## Matriz ponderada (nota 1–5 × peso; licença/custo é critério eliminatório — todas passam)

| Critério (peso)                                   | Three.js | Babylon.js | PlayCanvas | Base                                                                                                                                                     |
| ------------------------------------------------- | -------- | ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desempenho medido (20)                            | 4        | 3          | 5          | POC: FPS, CPU p95                                                                                                                                        |
| Download/carregamento (15)                        | 5        | 2          | 4          | POC: KB gzip, load                                                                                                                                       |
| Memória (5)                                       | 5        | 2          | 4          | POC: heap                                                                                                                                                |
| Renderização/animação/pipeline glTF (15)          | 4        | 5          | 4          | Docs: KTX2/meshopt/Draco nas três (PlayCanvas: KTX2-em-glTF NÃO VERIFICADO); Babylon: retargeting, instancing automático, Inspector                      |
| Integração com simulação TS compartilhada (10)    | 4        | 4          | 4          | Rapier independe da engine (verificado)                                                                                                                  |
| Ecossistema/documentação/familiaridade de IA (15) | 5        | 4          | 3          | Comunidade/ exemplos; PlayCanvas engine-only menos documentado que o Editor                                                                              |
| Estabilidade de API (10)                          | 3        | 5          | 4          | Three sem semver, migração a cada release ([guia](https://github.com/mrdoob/three.js/wiki/Migration-Guide)); `Application` do PlayCanvas a ser deprecada |
| Produtividade code-first (10)                     | 4        | 4          | 3          | POC: volume e clareza do código de adaptação                                                                                                             |
| **Total (100)**                                   | **85**   | **73**     | **79**     |                                                                                                                                                          |

Sensibilidade: PlayCanvas empata com Three.js se o peso de desempenho subir de 20 para 30 retirando 10 de ecossistema,
ou para 35 retirando todo o peso de download; Babylon não passa Three.js em nenhuma redistribuição de até 10 pontos.
A vantagem de desempenho medida (≈+28% FPS com 48 avatares) foi obtida numa GPU virtual e ambos ficam muito acima de 60 FPS
nesse cenário; por isso não foi considerada decisiva.

## Decisão

**Three.js r186 (`three@0.186.1`) com `WebGLRenderer`**, versão fixada exatamente.

## Consequências

- Atualizações de Three são deliberadas (no máximo a cada ~10 releases, seguindo o guia de migração), com regressão de métricas.
- Props repetidos exigem `InstancedMesh`/`BatchedMesh` (M6), pois não há instancing automático (POC: 560 draw calls com 48 avatares e sombras).
- `WebGPURenderer` (TSL) será reavaliado após M6 com medição; até lá, nenhum shader customizado deve depender de recursos exclusivos do WebGL.
- Física/colisão: Rapier compartilhado (ADR-0002), não física de engine.
- Reabrir esta ADR se: medições em hardware físico (M1/M12) mostrarem CPU de render como gargalo, ou se o custo de migração de versões do Three se tornar recorrente.
