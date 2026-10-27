# ADR-0006 — Acesso remoto às demos (túnel HTTPS + gateway com link de acesso)

- **Status:** aceito (pós-M4, 2026-10-26) · ferramenta de demonstração, **não** é a hospedagem de produção (M13)
- **Contexto:** abrir as demos (multiplayer + galeria) em outro computador ou celular, de preferência pelo IP público
  da conexão, sem expor servidores de desenvolvimento nem mudar o ambiente da máquina.

## Diagnóstico (2026-10-26)

| Item                   | Achado                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Máquina                | VM VMware; uma interface IPv4 privada (/22)                                                                                |
| Caminho até a internet | dois gateways privados antes do 1º salto do provedor (NAT duplo); o salto seguinte não responde                            |
| CGNAT                  | **NÃO VERIFICADO** — exige comparar o IP WAN do roteador de borda com o IP público (acesso ao roteador)                    |
| Firewall do Windows    | ativo nos 3 perfis, entrada bloqueada por padrão; nenhuma regra criada                                                     |
| Bind                   | API, Vite e PostgreSQL só em `127.0.0.1` (correto; nada é alcançável de fora)                                              |
| Cliente                | URLs relativas; WebSocket em `location.origin` (`https` → `wss`). Única URL fixa (`:5173` na galeria) restrita ao modo dev |
| Servidor               | já pronto para proxy: `ALLOWED_ORIGINS` exato (CSRF e handshake WS), `COOKIE_SECURE` → `__Host-bar_sid`, `TRUST_PROXY`     |
| Vite dev               | servidor de desenvolvimento (HMR, `/@fs`, fontes): **não pode** ser exposto                                                |

**IP público direto:** exigiria redirecionar a porta nos **dois** roteadores (e não funciona se houver CGNAT), regra de
entrada no firewall, nome DNS dinâmico (o IP muda) e certificado TLS válido, mais um proxy reverso endurecido. Não foi
configurado: depende de acesso aos roteadores (ação humana) e amplia a superfície permanente da máquina.

## Decisão

`npm run demo:remote` = **Cloudflare quick tunnel** (só conexões de saída: atravessa NAT duplo/CGNAT sem abrir portas,
HTTPS/`wss` com certificado válido, sem conta) → **gateway próprio em loopback** → API em modo `production`.

| Camada     | Regra                                                                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acesso     | link secreto `/?acesso=<token>` (24 bytes aleatórios, `.data/remote-access.json`, fora do git) → cookie `__Host-bar_gate` HttpOnly Secure 12 h (HMAC do token); sem ele, 401 em página, API e WS; 20 tentativas erradas/10 min por IP → 429; `--new-token` revoga |
| Host       | só o hostname do túnel (421 para o resto)                                                                                                                                                                                                                         |
| Rotas      | build de produção (`index.html`, `art.html`, `assets/`), GLBs do catálogo, `/api/*`, `GET /health`, upgrade `/game`. Todo o resto: 404 (`/ready`, `.data`, fontes, `/@vite`, `report.json`)                                                                       |
| Cabeçalhos | CSP sem `unsafe-eval` (só `wasm-unsafe-eval` para Rapier/Meshopt; cliente usa Zod `jitless`), `nosniff`, `no-referrer`, `DENY`, HSTS 1 dia                                                                                                                        |
| API        | `NODE_ENV=production`: cookie `__Host-` Secure, Origin = URL do túnel, e-mail dev desligado; `TRUST_PROXY` com `X-Forwarded-For` **reescrito** pelo gateway (rate limit por IP real)                                                                              |
| Dados      | PostgreSQL próprio (`.data/pg-remote`, loopback); mesmas contas descartáveis (`.data/demo-accounts.json`)                                                                                                                                                         |
| Binário    | `cloudflared` 2026.10.0 oficial, SHA-256 das notas da release, em `.cache/tools` (sem instalação global)                                                                                                                                                          |
| Desligar   | Ctrl+C ou `npm run demo:remote -- --stop`: túnel fecha (URL responde 530); nada persiste fora do projeto                                                                                                                                                          |

## Alternativas

- **Tailscale (Funnel/rede privada):** melhor isolamento (só dispositivos da conta), mas exige conta, instalação global
  e o app em cada dispositivo — fica como opção se houver autorização.
- **Cloudflare Tunnel nomeado + Cloudflare Access:** URL fixa e login por e-mail; exige conta e domínio.
- **ngrok:** exige conta/token. **Porta no roteador:** ver diagnóstico.

## Limitações

URL nova a cada execução; quick tunnels não têm SLA (uso de teste). O link é um segredo compartilhável: quem o tiver
entra até `--new-token`. O tráfego passa pela Cloudflare (TLS termina na borda). A rede parece ter dois roteadores:
confirmar que sua política permite túneis de saída.
