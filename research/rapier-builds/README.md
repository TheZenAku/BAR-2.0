# Rapier: build padrão × determinístico (M1)

Projeto npm isolado (fora dos workspaces e do CI). Executa a **mesma** carga nas duas builds `compat` do Rapier 0.21.0
(`@dimforge/rapier3d-compat` e `@dimforge/rapier3d-deterministic-compat`) em Node e em navegadores reais.

```bash
cd research/rapier-builds
npm ci
node tools/bench.mjs --reps=5   # usa vite e playwright do workspace raiz; grava results/results.json
```

Carga ([src/scenario.mjs](src/scenario.mjs)): sala greybox (piso, paredes, escada, rampa, 12 pilares), 16 controladores
de personagem cinemáticos andando em padrão determinístico, 1200 passos a 60 Hz. Mede init a frio (WASM), custo por passo
(média e p95) e hash FNV-1a bit a bit das posições finais. Cada execução em Node roda em processo novo; nos navegadores,
em página nova.

Resultados e conclusão: [results/RESULTS.md](results/RESULTS.md) → decisão em
[ADR-0003](../../docs/decisions/ADR-0003-rapier-build.md).
