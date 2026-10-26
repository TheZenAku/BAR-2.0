# Resultados — Rapier padrão × determinístico

- Data: 2026-10-26 · Rapier 0.21.0 · 5 repetições por caso · dados brutos: [results.json](results.json)
- Máquina: Windows 10 VM (x86-64, GPU virtual). **Tempos absolutos não representam hardware real**; comparar apenas
  relativamente entre as builds, na mesma máquina.

## Tamanho

| Build         | WASM bruto | WASM gzip | `rapier.mjs` (WASM em base64) | gzip     | Chunk Vite gzip |
| ------------- | ---------- | --------- | ----------------------------- | -------- | --------------- |
| compat        | 3009 KB    | 1148 KB   | 4239 KB                       | 1606 KB  | 1606 KB         |
| deterministic | 3033 KB    | 1152 KB   | 4270 KB                       | 1612 KB  | 1612 KB         |
| Diferença     | +0,8 %     | +0,3 %    | +0,7 %                        | +0,4 %   | **+6 KB**       |

## Inicialização e custo por passo (medianas de 5 execuções)

| Build         | Runtime         | Init (ms) | Passo médio (ms) | Passo p95 (ms) | Hash       |
| ------------- | --------------- | --------- | ---------------- | -------------- | ---------- |
| compat        | Node 26.12.1    | 75,2      | 1,066            | 2,01           | `01a62fdd` |
| deterministic | Node 26.12.1    | 77,0      | 1,092            | 2,49           | `01a62fdd` |
| compat        | Edge 156        | 165,8     | 0,931            | 2,10           | `01a62fdd` |
| deterministic | Edge 156        | 153,4     | 0,926            | 2,20           | `01a62fdd` |
| compat        | Firefox 157     | 221,0     | 0,906            | 2,00           | `01a62fdd` |
| deterministic | Firefox 157     | 251,0     | 0,937            | 2,00           | `01a62fdd` |

## Compatibilidade e diferenças

- API TypeScript idêntica (arquivos `.d.ts` byte a byte do mesmo tamanho); troca é só o nome do pacote. Ambas inicializam
  em Node 26, Edge 156 e Firefox 157 sem flags nem bundler especial (WASM embutido).
- Desempenho: diferenças dentro do ruído de medição (±10 %) em todos os runtimes. Init no navegador inclui decodificar o
  base64 e compilar o WASM (~150–250 ms).
- Determinismo: as **duas** builds produziram o mesmo hash em Node, Edge e Firefox **nesta** máquina x86-64. Isso não prova
  determinismo entre arquiteturas/CPUs diferentes (ARM, outras extensões x86): a build padrão pode divergir lá; a
  determinística é projetada para resultado bit a bit idêntico entre plataformas
  ([documentação Rapier](https://rapier.rs/docs/user_guides/javascript/determinism)). **NÃO VERIFICADO** em ARM (sem
  hardware).
- Observação independente da build: `compat` embute o WASM em base64 (~+40 % sobre o `.wasm` gzip: 1612 × 1152 KB) e
  impede compilação em streaming. A build não-compat (arquivo `.wasm` separado) economizaria ~460 KB gzip, mas exige
  integração de WASM ESM no Vite e flag no Node — avaliar no M12 (otimização).
