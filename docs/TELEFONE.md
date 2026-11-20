# Zoe no telefone — arquitetura

Status: **desenho aprovado para implementar em etapas**. Nada abaixo está ativo ainda: hoje o Zoe Core só escuta em `127.0.0.1`.
Abrir a Zoe para a rede é a mudança mais sensível de segurança do projeto, então ela vem em etapas pequenas, cada uma testada.

## Princípio

**O PC continua sendo o cérebro; o telefone é só mais uma tela.** Memória, base aprendida, IA local e decisões ficam no
Zoe Core do computador. O telefone conversa com ele, sem nuvem no meio e sem cópia dos dados no servidor de ninguém.

```
┌──────────── Telefone ────────────┐         ┌──────────────── PC ─────────────────────┐
│ App Zoe (PWA → depois nativo)    │  TLS    │ Gateway (novo, desligado por padrão)    │
│  conversa · avisos · memória     │ ──────► │  tokens por aparelho · escopos · limite │
│  recursos do PC (só leitura)     │  WS     │            │                            │
└──────────────────────────────────┘         │            ▼                            │
                                             │ Zoe Core (127.0.0.1, como hoje)         │
                                             │  cascata · memória · base · IA · decisão│
                                             └─────────────────────────────────────────┘
```

## Como o telefone alcança o PC

| Opção | Como | Prós | Contras | Decisão |
| --- | --- | --- | --- | --- |
| **Tailscale** (rede privada WireGuard) | PC e telefone entram na mesma rede privada; o gateway escuta só no IP do Tailscale | Funciona fora de casa, sem abrir portas no roteador, criptografado de ponta a ponta | Instalar o Tailscale nos dois (gratuito para uso pessoal) | **Recomendada** |
| Rede local (Wi-Fi de casa) | Gateway escuta no IP da rede local, com TLS e certificado fixado pelo QR | Sem instalar nada extra | Só funciona em casa; exige cuidado com TLS | Alternativa |
| Servidor na nuvem (relay) | Telefone e PC falam por um servidor intermediário | Funciona em qualquer lugar | Os dados passam por terceiros | **Descartada** (contraria a seção 10) |

## Pareamento (uma vez por aparelho)

1. No PC: **Ajustes → Telefone → Conectar aparelho**. O gateway liga e mostra um **QR code** com `{endereço, porta, token do aparelho, impressão digital do certificado}`.
2. No telefone: abre o app, lê o QR. O token nunca é digitado nem passa por outro canal.
3. O PC mostra "Novo aparelho: Pixel do Ayalan — permitir?" e só então o token vale.
4. Tokens ficam guardados **com hash** numa tabela `devices` (`nome`, `escopos`, `criado_em`, `visto_em`, `revogado`). Revogar é um clique.

## O que o telefone pode fazer (escopos)

| Escopo | Permite | Padrão |
| --- | --- | --- |
| `conversa` | chat (a mesma cascata: regras → memória → base → IA) | ligado |
| `avisos` | receber e responder avisos (lembretes, foco, alertas do PC) | ligado |
| `memoria:ler` / `memoria:editar` | ver / mudar a memória pessoal e a base aprendida | ler ligado, editar desligado |
| `pc:ler` | ver recursos e processos | ligado |
| `emergencia` | botão "parar tudo" | ligado |
| — | mudar autonomia, limites, URL da IA ou da pesquisa; apagar dados | **nunca pelo telefone** (só no PC) |

O gateway aplica isso com a mesma ideia da lista `API_ALLOW` do Zoe Desktop: cada rota tem o escopo exigido; o que não está na lista não passa.

## Avisos no telefone

- A camada de decisão ganha **canais**: `orbe`, `sistema` (notify-send) e `telefone`.
- Regra inicial: se você está **ausente do PC** (`USER_IDLE`) e há um telefone pareado, o aviso vai para o telefone; senão, para a orbe.
- **App aberto:** chega pelo WebSocket, como na orbe.
- **App fechado (etapa posterior):** notificação push. Para não expor conteúdo a serviços de push (Google/Apple), o push leva só "A Zoe tem um aviso" e o texto é buscado direto no PC. Alternativa 100% própria: **ntfy** auto-hospedado.

## O app

1. **Primeiro: PWA** servida pelo próprio gateway (`/m`): conversa, avisos, memória e recursos, instalável na tela inicial (Android e iOS), sem loja. Reaproveita a API REST/WebSocket que já existe.
2. **Depois: app nativo** (Capacitor, reaproveitando a PWA) quando precisarmos de push em segundo plano e de integrações do telefone.

## O que já está pronto no código para isso

- A API é independente da interface: a orbe é só um cliente de REST + WebSocket. O telefone usa os mesmos endpoints.
- Autenticação por token, comparação em tempo constante, sem CORS.
- WebSocket com mensagens tipadas (`chat.delta`, `chat.reply`, `notification`, `state`, `pc`…), tratando o chat numa tarefa própria (um cliente lento não trava os outros).
- Camada de decisão central: é nela que entra o "para qual canal vai este aviso".
- Toda resposta diz de qual nível veio (`layer`) e de onde (`source`), o que funciona igual no telefone.

## Etapas de implementação

| Etapa | Entrega | Teste |
| --- | --- | --- |
| T1 | Tabela `devices`, tokens por aparelho com escopos, gateway separado (desligado por padrão), escutando só no IP escolhido | tokens/escopos: rota fora do escopo → 403; revogado → 401 |
| T2 | TLS (certificado próprio) + QR de pareamento com fixação de certificado + confirmação no PC | pareamento ponta a ponta com cliente de teste |
| T3 | PWA `/m`: conversa, avisos, memória (leitura), recursos | E2E com Playwright em viewport de celular |
| T4 | Canal `telefone` na camada de decisão (ausente do PC → telefone) | regra de canal com usuário ocioso |
| T5 | Push com app fechado (sem conteúdo no push) | — |

## Checklist de segurança (vale para todas as etapas)

- Gateway **desligado por padrão**; ligar exige ação no PC.
- Nunca escutar em `0.0.0.0` sem escolha explícita da interface (Tailscale ou Wi-Fi).
- TLS sempre; certificado fixado no pareamento.
- Limite de requisições por aparelho; registro de acessos na tabela `events`.
- Ações destrutivas e mudanças de configuração só no PC.
- "Parar tudo" no PC também desliga o gateway.
