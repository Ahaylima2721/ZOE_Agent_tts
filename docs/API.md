# Zoe Core — API, eventos, banco e permissões

## Conexão

O Core escuta **somente em `127.0.0.1`**, na porta 47811 (ou numa porta livre, se essa estiver ocupada). Ao iniciar, ele grava `$XDG_RUNTIME_DIR/zoe/core.json` com permissão `0600`:

```json
{ "host": "127.0.0.1", "port": 47811, "token": "…", "pid": 1234 }
```

Toda requisição precisa do token: `Authorization: Bearer <token>`, ou `?token=` no WebSocket. A API não responde a CORS, então páginas abertas no navegador não conseguem usá-la.

## REST

| Método | Rota | Corpo | Resposta |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ok, name, version}` |
| GET | `/api/state` | — | `{settings, expression, focus, monitoring, interventions, do_not_disturb_until, uptime_s, clients}` |
| GET | `/api/settings` | — | configurações (padrões + gravadas) |
| PATCH | `/api/settings` | campos parciais | configurações atualizadas; 400 para chave desconhecida ou valor inválido |
| POST | `/api/chat` | `{text}` | `{text, expression, quick_replies[]}` |
| GET | `/api/interactions?limit=50` | — | histórico da conversa (mais antigo primeiro) |
| GET | `/api/notifications?limit=50` | — | avisos (mais recente primeiro), com `status` |
| POST | `/api/notifications/{id}/ack` | `{action}` | `dismiss` marca como lida; outra ação marca como respondida e é executada (ex.: `foco_novamente`) |
| POST | `/api/events` | `{type, payload}` | só `USER_IDLE`, `USER_RETURNED` e `USER_REQUEST` (403 para os outros) |
| POST | `/api/focus/start` | `{minutes?, categoria?}` | sessão iniciada (1 a 240 min; categoria estudo · trabalho · lazer · geral) |
| POST | `/api/focus/stop` | `{}` | `{stopped}` |
| POST | `/api/monitoring` | `{active: bool}` | estado; liga ou desliga monitoramento **e** intervenções |
| POST | `/api/emergency-stop` | `{}` | estado; para tudo e avisa |
| POST | `/api/personal-data/delete` | `{confirm: "APAGAR"}` | apaga conversas, avisos, eventos e dados pessoais |
| GET | `/api/pc` | — | `{snapshot, history{t,cpu,ram}}`: leitura atual e o último ~minuto. 503 se faltar o psutil |
| GET | `/api/pc/diagnose` | — | `{summary, findings[], processes}`: diagnóstico na hora (funciona mesmo com alertas desligados) |
| GET | `/api/ai` | — | `{enabled, url, model, models[], ollama, version, installed[], model_installed, pull, hint}` |
| POST | `/api/ai/pull` | `{}` | começa a baixar o modelo configurado (só quando o usuário pede); 503 sem Ollama. Progresso pelo WebSocket (`ai.pull`) |
| GET | `/api/learning` | — | `{stats{total, local, sem_ia_pct, by_layer, knowledge}, items[]}`: o que a Zoe aprendeu e quanto responde sem IA (30 dias) |
| POST | `/api/learning/feedback` | `{interaction_id, vote: up\|down}` | `{message}`: 👍 promove a resposta da IA; 👎 rejeita (respostas da IA e da base) |
| PATCH | `/api/learning/{id}` | `{status: validada\|rejeitada}` | confirma ou rejeita um item |
| DELETE | `/api/learning/{id}` | — | esquece um item |
| POST | `/api/learning/research` | `{}` | pesquisa agora (409 com a pesquisa desligada) |
| GET | `/api/dashboard` | — | painel "Início": `{saudacao, resumo, status, hoje[], foco, produtividade{dias[7], foco_min_semana, variacao_pct}, categorias[], numeros, proximo}`, tudo calculado do banco |
| GET | `/api/tasks?escopo=hoje\|todas` | — | tarefas `{id, titulo, categoria, para, concluida, concluida_em}`; "hoje" = pendentes até hoje + concluídas hoje |
| POST | `/api/tasks` | `{titulo, categoria?, para?}` | 201 com a tarefa (sem `para`: é para hoje) |
| PATCH | `/api/tasks/{id}` | `{titulo?, categoria?, para?, concluida?}` | tarefa atualizada |
| DELETE | `/api/tasks/{id}` | — | `{ok}` |
| POST | `/api/focus/pause` · `/api/focus/resume` | `{}` | pausa/retoma o foco (pausas não contam como tempo focado) |
| GET | `/api/memory` | — | `{kinds[], items{tipo: [...]}}`: tudo o que a Zoe guardou + a descrição dos campos de cada tipo |
| POST | `/api/memory/{tipo}` | campos do tipo | `{item, created}`: 201 se criou; 200 se já existia um item com o mesmo nome (atualiza em vez de duplicar) |
| PATCH | `/api/memory/{tipo}/{id}` | campos parciais | `{item}`; 400 para campo/valor inválido, 404 se não existir |
| DELETE | `/api/memory/{tipo}/{id}` | — | `{ok}`; 404 se não existir |

### Configurações

| Chave | Valores | Padrão |
| --- | --- | --- |
| `nome_usuario` | texto (até 40) | `""` |
| `autonomia` | `observar` · `conversar` · `recomendar` · `intervir_com_autorizacao` · `intervir_automatico` | `conversar` |
| `frequencia` | `silenciosa` (0/h) · `baixa` (30 min, 2/h) · `normal` (10 min, 4/h) · `alta` (3 min, 10/h) | `normal` |
| `silencio_inicio`, `silencio_fim` | `HH:MM` (o período pode atravessar a meia-noite) | `23:30` – `07:30` |
| `nao_perturbe_ate` | epoch em segundos (0 = desligado) | `0` |
| `foco_minutos_padrao` | 1–240 | `25` |
| `ocioso_minutos` | 1–240 | `5` |
| `notificacoes_nativas` | bool (usa `notify-send` quando a orbe está fechada) | `true` |
| `pesquisa_web` | bool: depois da conversa, conferir na Wikipédia o que só a IA respondeu | `false` |
| `pesquisa_web_url` | só `https://*.wikipedia.org` (ou servidor local de teste) | `https://pt.wikipedia.org` |
| `ia_ativa` | bool: usar a IA local quando as regras não entendem | `true` |
| `ia_modelo` | nome do modelo no Ollama (`qwen3:0.6b`, `gemma3:270m`, `qwen2.5:0.5b`, `gemma3:1b`, `qwen3:1.7b`…) | `qwen3:0.6b` |
| `ia_url` | **só** `http://127.0.0.1`, `localhost` ou `::1` (nunca um servidor externo) | `http://127.0.0.1:11434` |
| `checkins_memoria` | bool: perguntar sobre o que você contou (livro, projeto, estudo, hobby, objetivo) | `true` |
| `tom` | `equilibrado` · `direto` · `descontraido` | `equilibrado` |
| `assuntos_evitar` | lista de textos (até 30): a Zoe não puxa conversa sobre itens que contenham estes termos | `[]` |
| `pc_alertas` | bool: a Zoe comenta sozinha sobre RAM, CPU, disco, temperatura e bateria | `true` |
| `pc_intervalo_s` | 2–60 (segundos entre leituras) | `5` |
| `pc_limites` | `{ram_pct 50–99, cpu_pct 50–100, disco_livre_pct 1–50, temp_c 60–105, bateria_pct 5–50}`; atualização parcial é mesclada | `90, 90, 10, 90, 15` |
| `retencao_dias` | `{system_metrics, application_usage, events, notifications}` em dias | `7, 90, 30, 30` |
| `monitoramento_ativo`, `intervencoes_ativas` | somente leitura no PATCH; mudam por `/api/monitoring` ou `/api/emergency-stop` | `true` |

## WebSocket `/ws?token=…`

Do servidor para o cliente:

| `type` | Campos | Quando |
| --- | --- | --- |
| `hello` | `state`, `expressions[]` | ao conectar |
| `state` | `state` | ajustes, foco, monitoramento ou não perturbe mudaram |
| `expression` | `name`, `ttl_ms` | `ttl_ms = 0`: expressão de fundo (foco, descanso). `> 0`: expressão passageira |
| `notification` | `notification {id, message, category, origin, expression, actions[{id,label}]}` | aviso aprovado pelas regras |
| `chat.reply` | `ref`, `text`, `expression`, `quick_replies[]` | resposta a um `chat` |
| `pong` | — | resposta a `ping` |
| `chat.delta` | `ref`, `text` | pedaço da resposta da IA enquanto ela é gerada; o `chat.reply` final traz o texto limpo |
| `ai.pull` | `pull {model, status, completed, total, done, error}` | progresso do download do modelo |
| `pc` | `snapshot`, `history` | a cada leitura, só para quem pediu `pc.subscribe` (aba Recursos aberta) |

Do cliente para o servidor: `{type:"chat", text, ref}`, `{type:"notification.ack", id, action}`, `{type:"pc.subscribe", on}` e `{type:"ping"}`.

Expressões: `normal`, `pensando`, `curiosa`, `feliz`, `preocupada`, `foco`, `descanso`, `alerta`.

![As 8 expressões](img/expressoes.png)

## Eventos e decisões

Todo evento passa pelo `DecisionEngine` (`core/zoe_core/decision.py`). Ele escolhe **uma** ação entre `ignorar`, `aguardar`, `expressao`, `notificar`, `conversar`, `consultar_llm` e `executar`. Cada evento fica gravado na tabela `events` junto com a decisão tomada.

| Evento | Origem hoje | Regra (Fase 1) |
| --- | --- | --- |
| `FOCUS_SESSION_STARTED` | chat, bandeja, API, ação de balão | expressão de fundo `foco` |
| `FOCUS_SESSION_ENDED` | temporizador ou cancelamento | concluído: aviso com ações "Mais uma sessão" e "Pausa". Cancelado: volta a `normal` |
| `USER_IDLE` | desktop (tempo ocioso ≥ `ocioso_minutos`) | `descanso`. Durante o foco: aguarda. Com monitoramento pausado: ignora |
| `USER_RETURNED` | desktop | volta à expressão anterior; após 30 min ou mais fora, aviso espontâneo de boas-vindas (no máximo 1 a cada 2 h) |
| `EMERGENCY_STOP` | menu, ajustes, API | desliga monitoramento e intervenções e avisa |
| `MONITORING_RESUMED` | menu, ajustes, API | `feliz` passageira |
| `USER_REQUEST` | chat | registrado; a resposta vem do chat |
| `HIGH_MEMORY_USAGE` | monitor do PC: RAM ≥ limite por 30 s | aviso "Memória quase cheia" com o app responsável e ação "Ver processos"; no máximo 1 por hora |
| `CPU_OVERLOAD` | monitor do PC: média de 1 min ≥ limite | aviso com o processo que mais usa CPU; no máximo 1 por hora |
| `DISK_SPACE_LOW` | monitor do PC: livre < limite % ou < 5 GB | aviso com ação "Ver discos"; no máximo 1 por dia |
| `HIGH_TEMPERATURE` | monitor do PC: CPU ≥ limite °C | aviso; **urgente** (≥ 95 °C ou limite + 5) |
| `BATTERY_LOW` | monitor do PC: ≤ limite % fora da tomada | aviso; **urgente** em ≤ 5% |
| `APP_USAGE_LIMIT_REACHED` | Fase 4 | ainda sem regra: `aguardar` |
| `MEMORY_CHECKIN` | companion: a cada 20 min, com a orbe aberta, sem foco e sem ausência | aviso espontâneo ("Você conseguiu avançar em Duna? Da última vez você estava no capítulo 5.") com "Responder" e "Agora não"; no máximo 1 a cada 4 h e o mesmo assunto a cada 3 dias |
| `TASK_OVERDUE`, `NEW_DISCOVERY` | Fases 4 e 5 | ainda sem regra: `aguardar` |

### Quando a Zoe pode falar sozinha

Um aviso **espontâneo** só é entregue se passar por todas estas verificações, nesta ordem:

1. autonomia diferente de `observar`;
2. frequência diferente de `silenciosa`;
3. fora do "não perturbe";
4. fora do horário silencioso;
5. não é repetido (`dedupe_key` dentro da janela);
6. abaixo do teto por hora;
7. respeita o intervalo mínimo desde o último aviso espontâneo.

Avisos de origem **usuário** (respostas, fim de um foco que o usuário iniciou, confirmação de emergência) não passam por esses limites. Avisos bloqueados ficam gravados com `status = bloqueada`. Se nenhuma orbe estiver conectada, o aviso vai para `notify-send` (D-Bus), quando permitido.

Regras comuns aos avisos do PC: durante uma sessão de foco só os críticos interrompem; com o monitoramento pausado nada é avaliado nem gravado; depois de disparar, o mesmo alerta só volta a valer quando a situação ficar normal por 2 minutos. Avisos **urgentes** passam por cima da frequência e do horário silencioso, mas nunca de "apenas observar" nem do "não perturbe".

O monitor só lê: ele não encerra processos nem muda configurações do sistema.

## Banco de dados

Arquivo `~/.local/share/zoe/zoe.db`, versão do esquema em `PRAGMA user_version`. As migrações ficam em `core/zoe_core/db.py` (`MIGRATIONS`).

Tabelas da seção 8 da especificação: `users`, `interests`, `personal_projects`, `personal_activities`, `books`, `tasks`, `application_usage`, `focus_rules`, `system_metrics`, `interactions`, `notifications`. Também foram criadas `events` (log de eventos e decisões), `settings` (chave/valor JSON) e, na v2, `goals` (objetivos pessoais e profissionais). A v2 também adiciona `notes`, `created_at`/`last_interaction` e `books.progress` às tabelas pessoais, sem perder dados de quem já usava a v1.

- As tabelas pessoais têm `user_id → users(id) ON DELETE CASCADE`, com chaves estrangeiras ativas.
- Há índices nas colunas de tempo e status: `idx_metrics_time`, `idx_appusage_app_time`, `idx_events_type_time`, `idx_notifications_status` e outros.
- `focus_rules.intervention_level` tem `CHECK` de 1 a 4 e é único por aplicativo.
- **Retenção:** aplicada ao iniciar e a cada 6 h, conforme `retencao_dias`. Conversas e dados pessoais não expiram sozinhos; apagam-se por "Apagar meus dados".

## Aprendizado (cascata)

Cada mensagem desce os níveis até alguém responder; o nível fica gravado em `interactions.layer`:

| Nível | `layer` | Quem responde |
| --- | --- | --- |
| 0 | `regras` | comandos (foco, PC, pausar, horas…) |
| 1 | `memoria` | memória pessoal (livros, projetos, "o que você sabe sobre mim") |
| — | `aprendizado` | correção de uma resposta anterior ("na verdade, …", até 10 min depois) |
| 2 | `base` | base aprendida: respostas com 👍, correções e resumos com fonte |
| 4 | `ia` | IA local, com contexto enxuto |
| — | `sem_resposta` | nada entendeu (sem IA disponível) |

**Base de conhecimento** (`knowledge`, busca FTS5/BM25 sem acentos + semelhança de palavras ≥ 0,6 na pergunta):

- toda resposta da IA entra como `candidata` e **não** responde sozinha;
- 👍 → `validada`; correção → `validada` (fonte `correcao`, vence as outras); Wikipédia → `fonte` (com título e link); 👎 → `rejeitada`;
- perguntas pessoais ("eu", "meu"…) ou que mudam (hoje, agora, horas, PC…) **nunca** são guardadas;
- a resposta reaproveitada diz de onde veio: "Lembrei da nossa conversa de 12/11", "Você me ensinou em 12/11" ou "Fonte: Wikipédia · Título" (com link).

**Pesquisa pós-conversa** (opcional, desligada por padrão): 2 min depois da última mensagem, até 5 assuntos por vez (30 por dia), primeiro os que levaram 👎. Só o assunto sai do computador; o resumo guardado tem no máximo 3 frases. Cada descoberta vira um evento `NEW_DISCOVERY`.

**Contexto enxuto da IA:** só itens da memória que têm palavras em comum com a pergunta (até 6) ou, sem nenhum, um retrato mínimo (o que está lendo/fazendo); mais até 3 itens confirmados da base sobre o assunto.

## Inteligência artificial (Ollama)

- **Quando é usada:** só quando nenhuma regra local entende a mensagem (comandos, foco, PC e memória continuam locais e instantâneos).
- **O que recebe:** personalidade e regras ("nunca invente fatos sobre o usuário"), data e hora, nome, tom, até 5 itens de cada tipo da memória e as últimas 6 trocas do chat. Nada de métricas, processos ou arquivos.
- **O que pode fazer:** só gerar texto. Não há ferramentas, comandos nem acesso ao sistema; a resposta é limpa (sem markdown, sem `<think>`, no máximo ~900 caracteres) antes de aparecer.
- **Recursos:** `num_ctx` 2048, `num_predict` 220, `keep_alive` 5 min (o modelo sai da memória quando não é usado), um pedido por vez. Em modelos Qwen3 o modo "pensar" é desligado (`think: false`).
- **Sem Ollama ou sem o modelo**, a Zoe diz exatamente o que falta (instalar o Ollama ou baixar o modelo) e o resto funciona igual.

## Memória pessoal

Tipos (`{tipo}` nas rotas) e campos:

| Tipo | Tabela | Campos | Quando a Zoe pergunta sozinha |
| --- | --- | --- | --- |
| `livro` | `books` | `titulo`*, `autor`, `capitulo`, `progresso`, `status` (quero_ler · lendo · pausado · lido), `notas` | lendo e parado há 3+ dias |
| `projeto` | `personal_projects` | `nome`*, `descricao`, `status` (ativo · pausado · concluido), `notas` | ativo e parado há 7+ dias |
| `objetivo` | `goals` | `titulo`*, `categoria` (pessoal · profissional), `descricao`, `status` (ativo · pausado · alcancado), `prazo` | ativo e parado há 14+ dias |
| `aprender` | `interests` | `nome`*, `notas`, `prioridade` (0–3) | parado há 5+ dias |
| `hobby` | `personal_activities` | `nome`*, `frequencia`, `notas` | parado há 14+ dias |
| `interesse`, `filme_serie`, `musica` | `interests` | `nome`*, `notas`, `prioridade` | — |
| `adiada` | `personal_activities` | `nome`*, `notas` | — (vai servir ao Guardian) |

\* obrigatório. Todo item também traz `id`, `tipo`, `criado_em` e `atualizado_em` (última vez que vocês falaram do assunto).

No chat, a Zoe entende frases como "estou lendo Duna, de Frank Herbert", "estou no capítulo 7", "terminei Duna", "quero aprender Python e Rust", "meu hobby é tocar violão", "hoje toquei violão", "meu objetivo profissional é…", "novo projeto Fluxo, que é…", "vivo adiando a academia", "o que você sabe sobre mim" e "esqueça Duna" (pede confirmação). O autor só é separado do título quando vem depois de uma vírgula ("Memórias Póstumas de Brás Cubas" continua sendo só o título). **Quando falta algo, ela pergunta** (autor, capítulo, qual livro); "não sei" ou "deixa pra lá" encerram a pergunta, que também expira em 10 minutos.

## Permissões e segurança

| Regra | Como é garantida |
| --- | --- |
| Nada sai do computador | Não há chamadas externas no Core. A API escuta só em `127.0.0.1` |
| Só a Zoe usa a API | Token aleatório por execução, guardado num arquivo `0600`; comparação em tempo constante |
| A interface não tem acesso ao sistema | `contextIsolation`, `sandbox`, sem `nodeIntegration`, CSP restrita; navegação e novas janelas bloqueadas |
| Sem comandos arbitrários | O IPC só repassa rotas de uma lista fixa (`API_ALLOW` em `desktop/main.js`). O Core não tem rota que execute comandos. Clientes só podem publicar 3 tipos de evento |
| Configurações validadas | Cada chave tem validador. Monitoramento e intervenções só mudam por rotas que geram o evento correspondente |
| Sem coleta invasiva | Nada de teclas, tela ou conteúdo de outros apps. Só o tempo ocioso do sistema (número de segundos) e métricas do PC (uso de CPU/RAM/disco, nomes e consumo dos processos) |
| Monitor do PC só lê | Coleta via psutil e /sys, sem root; nenhuma rota encerra processos ou muda o sistema. `system_metrics` guarda só médias por minuto (retenção de 7 dias) |
| Botão de emergência | Bandeja, clique direito, ajustes e API: desliga monitoramento e intervenções na hora |
| Histórico de intervenções | Tabela `events` (com a decisão) e `notifications` (com o status) |
| Apagar dados | `POST /api/personal-data/delete` com confirmação explícita |
| Processo órfão | O Core iniciado pela Zoe Desktop se encerra se ela morrer (`ZOE_PARENT_PID`) |
