# Zoe — Análise e arquitetura

Este documento responde aos itens da seção 13 da especificação: o que já existia, que tecnologia foi escolhida e por quê, como a Zoe se integra ao Linux (X11 e Wayland) e em que fase o projeto está.

## 1. O que já existia no repositório

| Arquivo | O que é | Como foi aproveitado |
| --- | --- | --- |
| `zoe.design` | Especificação visual e de comportamento (YAML): tokens, anatomia da orbe, estados e sorrisos | Continua sendo a fonte da verdade visual |
| `zoe-preview.html` | Demo da orbe roxa, com o CSS do portfólio e todos os estados | O CSS da orbe foi copiado sem mudanças para `desktop/renderer/orb.css` |
| `zoe-fx.js` | Animações extras (absorver arquivos, confete, aceno etc.), em JS puro, sem dependências | Carregado diretamente pela Zoe Desktop (`../../zoe-fx.js`) |

Conclusões:

- A parte de fala da versão antiga (voz TTS, boca, vídeos narrados em `video/`) foi removida: a Zoe se expressa só pelos olhos, pelo corpo e por texto.
- O projeto é **HTML/CSS/JS puro**, sem React e sem etapa de build. A orbe já tem as camadas (líquido, anéis, faísca), o piscar, o olhar que segue o mouse e vários estados.
- Não havia app desktop, serviço local nem banco de dados. A Fase 1 cria isso **sem reescrever a orbe**.

## 2. Decisões de tecnologia

| Camada | Escolha | Por quê |
| --- | --- | --- |
| Interface desktop | **Electron 33** + JS puro | Roda o CSS/JS existente sem adaptação nem build. Tem janela transparente, sem borda e sempre no topo bem testada no Linux. Dá para fazer testes ponta a ponta com o Playwright (`desktop/tests/e2e.js`). |
| Serviço local | **Python 3.10+ com aiohttp** | Uma dependência só para REST e WebSocket, com asyncio. É o mesmo ecossistema do `psutil`, que será usado na Fase 2. |
| Banco | **SQLite** (WAL, chaves estrangeiras, migrações por `PRAGMA user_version`) | Local, sem servidor, já vem no Python. |
| Comunicação | REST + WebSocket em `127.0.0.1`, com token | Tempo real para expressões e balões; REST para histórico e ajustes. |

**Por que não Tauri, por enquanto:** o Tauri gastaria menos memória (WebKitGTK em vez do Chromium, uns 60–100 MB a menos). Mas no Linux ele tem problemas conhecidos com transparência e "sempre no topo" que variam com a versão do WebKitGTK, e exigiria Rust no fluxo de desenvolvimento. Como a interface é JS puro e fala com o Core só pela API, **dá para migrar para Tauri depois sem tocar no Core**. Vale reavaliar na Fase 6 (otimização).

## 3. Módulos

```
┌──────────────────────── ZOE DESKTOP (Electron) ────────────────────────┐
│ main.js   janela flutuante · bandeja · arrastar · ociosidade do sistema │
│           inicia/reinicia o Core · proxy REST com lista de rotas         │
│ renderer/ orbe + expressões · balões · conversa · avisos · ajustes      │
└───────────────┬──────────────────────────────▲─────────────────────────┘
                │ REST (IPC → main)            │ WebSocket (eventos)
┌───────────────▼──────────────────────────────┴─────────────────────────┐
│                         ZOE CORE (Python)                               │
│  server.py   API local (127.0.0.1 + token)                              │
│  events.py   EventBus ── todo evento passa por ──► decision.py          │
│  decision.py regras locais → ignorar/aguardar/expressão/notificar/...   │
│  notifications.py  autonomia · frequência · silêncio · dedupe · entrega │
│  focus.py    sessões de foco          chat.py  comandos locais          │
│  db.py       ZOE DATABASE (SQLite, retenção, apagar dados)              │
├─────────────────────────────────────────────────────────────────────────┤
│  pc/         coleta (psutil, /sys, nvidia-smi) · diagnóstico · monitor  │
│  próximas fases: guardian/ · companion/ · ai/                           │
└─────────────────────────────────────────────────────────────────────────┘
```

Cada fase futura entra como um módulo do Core que **publica eventos** (por exemplo, `HIGH_MEMORY_USAGE`) e ganha regras no `decision.py`. A interface não precisa saber de onde vem cada evento: ela só recebe expressões, balões e estado.

## 4. Integração com o desktop Linux

### Como a janela funciona

- Uma única janela `transparent`, `frame: false`, `alwaysOnTop: 'floating'`, `skipTaskbar`, `type: toolbar`, visível em todas as áreas de trabalho.
- A janela tem **o tamanho do conteúdo**: 128×128 só com a orbe, 360×300 com balões e 400×600 com o painel. Ela cresce a partir da orbe na direção onde há espaço (o processo principal informa o canto: `br`, `bl`, `tr`, `tl`). Assim não sobra área transparente bloqueando cliques. Isso importa porque, no Linux, o Electron não consegue repassar cliques através de áreas transparentes (`setIgnoreMouseEvents` com `forward` só existe no Windows e no macOS).
- **Arrastar:** a interface envia a posição do ponteiro na tela e o processo principal move a janela. Ao soltar, a posição é salva em `~/.config/zoe-desktop/window.json`.
- **Olhar que segue o mouse:** o processo principal lê `screen.getCursorScreenPoint()` cerca de 8 vezes por segundo, só enquanto a orbe está visível.
- **Ociosidade:** `powerMonitor.getSystemIdleTime()` a cada 15 s, que gera `USER_IDLE` e `USER_RETURNED`. Nada de teclas ou conteúdo: só "há quantos segundos não há entrada".

### X11 e Wayland

| Recurso | X11 (qualquer WM) | Wayland via XWayland (padrão da Zoe) | Wayland nativo (`ZOE_NATIVE_WAYLAND=1`) |
| --- | --- | --- | --- |
| Transparência | ✅ precisa de compositor (GNOME/KDE têm) | ✅ | ✅ |
| Sempre no topo | ✅ | ✅ GNOME e KDE respeitam para janelas X | ❌ o protocolo não permite |
| Posicionar / arrastar a janela | ✅ | ✅ | ❌ o cliente não escolhe a posição. Alternativa: arrastar pelo cabeçalho do painel (`-webkit-app-region: drag`) |
| Olhar segue o mouse | ✅ em qualquer lugar | ⚠️ só sobre janelas X ou sobre a própria Zoe | ⚠️ só sobre a própria Zoe |
| Tempo ocioso | ✅ (XScreenSaver) | ⚠️ depende do compositor; quando ele não informa, o valor é 0 e a Zoe simplesmente não detecta ausência | ⚠️ idem |
| Bandeja | ✅ KDE; no GNOME precisa da extensão *AppIndicator* | idem | idem |

Por isso a Zoe Desktop **força XWayland** (`--ozone-platform=x11`) quando está numa sessão Wayland, e só usa Wayland nativo se o usuário pedir. Quando a bandeja não está disponível, o mesmo menu aparece com o **clique direito na orbe**.

Ambientes:

- **GNOME (Wayland):** funciona via XWayland. Para ter bandeja, instale a extensão "AppIndicator and KStatusNotifierItem Support".
- **KDE Plasma (X11/Wayland):** tudo funciona. Se quiser, o KWin permite forçar "manter acima" por regra de janela.
- **Sem compositor (WMs mínimos em X11):** a transparência vira fundo preto. Use um compositor (picom).

Nenhum recurso exige root. Tudo fica em `~/.local/share/zoe` (dados) e `$XDG_RUNTIME_DIR/zoe` (porta e token).

## 5. Fases

| Fase | Status | O que existe |
| --- | --- | --- |
| **1 — Zoe Desktop** | ✅ implementada e testada | Orbe flutuante com 8 expressões; arrastar; ocultar e ocultar por 30 min; balões com ações; painel (conversa, avisos, ajustes); bandeja e menu; Core com eventos, decisões, notificações, foco, banco e API; botão de emergência; apagar dados |
| **2 — PC Companion** | ✅ implementada e testada | CPU, RAM, swap, discos, leitura/gravação, rede, temperatura, GPU (NVIDIA/AMD), bateria e processos agrupados por app; aba "Recursos" com medidores e minilinhas ao vivo; diagnóstico assistido (botão e chat); alertas com histerese e dedupe; médias por minuto em `system_metrics`. Encerrar processos fica para o Guardian (Fase 4), sempre com autorização |
| 3 — Personal Companion | próxima | Tabelas já criadas (`interests`, `books`, `personal_projects`…); faltam rotas e interface |
| 4 — Guardian | — | Tabelas `application_usage` e `focus_rules` já existem; os níveis de autonomia já são aplicados nas notificações |
| 5 — Inteligência (Ollama) | — | O `decision.py` já tem a ação `consultar_llm` reservada; o chat responde com honestidade que ainda não conversa livremente |
| 6 — Evolução | — | Reavaliar Tauri; suporte a Windows (o Core já não depende de nada exclusivo do Linux, exceto `notify-send`) |

## 6. Como rodar

```bash
cd core && python3 -m pip install --user -r requirements.txt
```

```bash
cd desktop && npm install && npm start
```

A Zoe Desktop inicia o Core sozinha (e o reinicia se ele cair). Para instalar no menu e no início automático, use `packaging/install-linux.sh`.

Testes:

```bash
cd core && python3 -m pytest -q
```

```bash
cd desktop && xvfb-run -a npm test
```
