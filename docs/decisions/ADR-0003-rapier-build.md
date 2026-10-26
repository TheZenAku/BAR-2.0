# ADR-0003 — Física: Rapier 0.21, build determinística, corpo de personagem

- Status: **Aceita** (2026-10-26, M1). Reversível com custo mínimo (API idêntica; troca do nome do pacote).
- Evidência: [research/rapier-builds/results/RESULTS.md](../../research/rapier-builds/results/RESULTS.md) e testes de
  integração em `packages/game-core/src/simulation.test.ts` (Rapier real, sem mocks).

## Decisão 1 — `@dimforge/rapier3d-deterministic-compat` em cliente e servidor

`packages/game-core` usa a build determinística para tudo (predição no cliente e autoridade no servidor a partir do M3).

| Critério                 | compat              | deterministic         | Peso na decisão                               |
| ------------------------ | ------------------- | --------------------- | --------------------------------------------- |
| Download (gzip)          | 1606 KB             | 1612 KB (+6 KB)       | irrelevante                                   |
| Init / custo por passo   | igual (ruído)       | igual (ruído)         | irrelevante nesta medição (VM)                |
| Compatibilidade          | Node, Edge, Firefox | Node, Edge, Firefox   | empate                                        |
| Igualdade entre máquinas | não garantida       | garantida pelo Rapier | decisivo: reconciliação cliente×servidor (M3) |

Sem custo mensurável, a garantia de mesmo resultado entre plataformas (jogador em ARM/Apple Silicon × servidor x86)
reduz correções de predição. Limites: o determinismo só vale se as **entradas** forem idênticas; funções `Math.*` do JS
(sin/cos/atan2) não têm garantia bit a bit entre motores — o servidor permanece autoritativo e o cliente reconcilia (M3).

## Decisão 2 — Corpo do personagem: cilindro arredondado, não cápsula

Medido no M1 com o controlador cinemático do Rapier: com cápsula (raio 0,3 m), o auto-step **nunca** subiu degraus de
0,18 m nem meio-fio de 0,30 m. Causa provável (não instrumentada): a base curva toca a quina com normal inclinada
(~66° pela geometria), que o controlador trata como rampa íngreme em vez de parede, e o auto-step não é tentado. Com
`roundCylinder` (raio 0,3, borda 0,05, meia-altura 0,85) o auto-step funciona e os demais limites se mantêm:

| Caso              | Cápsula  | Cilindro arredondado |
| ----------------- | -------- | -------------------- |
| Escada 2 × 0,18 m | bloqueia | sobe                 |
| Meio-fio 0,30 m   | bloqueia | sobe                 |
| Bloco 0,50 m      | —        | bloqueia             |
| Rampa 9,5°        | sobe     | sobe                 |
| Rampa 50°         | bloqueia | bloqueia             |

`—` = não medido com a cápsula.

## Decisão 3 — Parâmetros do controlador

Passo fixo 60 Hz; `autostep(0,35 m, largura mín. 0,15 m)`, `snapToGround 0,3 m`, subida máx. 40°, deslize a partir de 45°.
Duas correções medidas (testes de regressão em `simulation.test.ts`):

- Sem empurrão vertical constante quando no chão (o snap mantém o contato). Com −1 m/s, o controlador retornava avanço
  zero a cada ~7 ticks (travadas visíveis).
- A velocidade realimentada só pode **reduzir** a velocidade comandada (`limitToProgress`). Realimentar o movimento
  bruto transformava a correção de penetração no meio-fio em impulso para trás (4,8 m/s).

## Consequências

- Build `compat` (WASM em base64) adiciona ~1,6 MB gzip ao cliente, isolado em chunk `rapier` próprio (cache). Otimização
  possível no M12: build não-compat com `.wasm` separado (~−460 KB gzip).
- Determinismo entre arquiteturas **NÃO VERIFICADO** (sem hardware ARM).
