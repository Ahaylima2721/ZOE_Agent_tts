# Zoe · app Android (v0.4)

Do [conceito](../CONCEITO.md) e da [Zoe de estudos](../INTELIGENCIA.md):

- **v0.1**: hábitos, horários de foco, apps vigiados e o peteleco em 3 níveis.
- **v0.2**: lembrete dos hábitos, resumo do dia às 22h, no máximo 2 emergências por dia, e **Estudos**:
  trilhas de estudo ou leitura, pacotes de perguntas feitos pelo Gemini (plano gratuito), revisão espaçada,
  pílula depois do foco, "Me dá uma pergunta no lugar" no peteleco, conversa socrática (20 mensagens por dia)
  e os óculos da Zoe com 50 respostas numa trilha.
- **v0.3**: o app passa a se chamar **Zoe**, ganha animação de entrada e a **bolinha** (estilo chat head):
  recados fora do foco (livro parado, revisão, hábito pendente, trilha parada, sequência) e **aviso de rolagem**
  quando você passa muito tempo nos apps vigiados fora do foco. Fora do foco ela só avisa; nunca fecha o app.
- **v0.4**: identidade nova, a **estufa da Zoe** ([IDENTIDADE.md](../IDENTIDADE.md)). A Zoe vira o **Broto** (corpo fosco
  com um broto na cabeça que mostra o humor) e ganha **28 animações** com gatilhos no app (`zoe-anim.js`). Hábitos viram
  vasos, a energia vira água, o foco fecha uma redoma ("estufa") e o resumo vira um diário. As abas passam a se chamar
  Canteiro, Estudos, Estufa e Zoe.
- **v0.4.1**: conserta os balões da conversa (a classe do balão colidia com a da Zoe), mostra uma mini Zoe pensando
  enquanto a resposta não chega e redesenha o app à meia-noite, para os contadores do dia (mensagens, hábitos,
  petelecos, foco) recomeçarem sem precisar fechar o app.
- **Sem voz**: a Zoe usa só texto e vibração.
- **Leve**: o APK tem cerca de 270 KB (136 KB são as fontes, que ficam dentro do app porque ele funciona offline).
  Usa só Kotlin e o WebView do sistema, sem bibliotecas extras.
- **Privado**: hábitos, horários e uso dos apps ficam só no celular. A internet é usada só em Estudos, com o tema da trilha.
- **Android 8.0 ou mais novo** (minSdk 26).

## Como instalar no celular

1. Baixe `app/dist/zoe-0.4.1.apk` (ou gere com o comando abaixo).
   Se o celular tiver a v0.3.0 e o Android recusar a atualização ("app não instalado"), desinstale a versão antiga antes:
   as duas foram assinadas com chaves de debug de máquinas diferentes.
2. No celular, abra o arquivo e permita "instalar apps desta fonte" quando o Android pedir.
3. Abra a Zoe Foco e siga as boas-vindas.

O APK de teste é assinado com a chave de debug. Antes de publicar na Play Store, criar uma chave própria.

## Como gerar o APK

Precisa do JDK 17+ e do Android SDK (platform 36, build-tools 36).

```bash
cd app/android
echo "sdk.dir=/caminho/do/android-sdk" > local.properties
./gradlew assembleRelease
```

O APK sai em `app/build/outputs/apk/release/app-release.apk`.

## Permissões

| Nível | Permissão | Para quê | Onde se libera |
| --- | --- | --- | --- |
| Essencial | Acesso aos dados de uso (`PACKAGE_USAGE_STATS`) | Saber qual app foi aberto durante o foco | Configurações › Acesso ao uso |
| Essencial | Sobrepor a outros apps (`SYSTEM_ALERT_WINDOW`) | Aparecer por cima do app e dar o peteleco | Configurações › Sobreposição |
| Recomendada | Notificações (`POST_NOTIFICATIONS`, Android 13+) | Avisar que o foco começou e mostrar "Zoe de guarda" | Pedido direto do app |
| Recomendada | Alarmes exatos (`SCHEDULE_EXACT_ALARM`, Android 12+) | Começar a vigiar na hora certa e poder iniciar o vigia em segundo plano | Configurações › Alarmes e lembretes |
| Recomendada | Sem otimização de bateria | Evitar que o sistema mate o vigia no meio do foco | Configurações › Bateria |
| Automática | Serviço em primeiro plano, iniciar com o celular, vibrar | Manter o vigia rodando, reagendar depois de reiniciar, vibrar no peteleco | Não pede nada ao usuário |
| Automática | Internet (`INTERNET`) | Só em Estudos: Gemini, Wikipedia e Open Library | Não pede nada ao usuário |
| Futura | Acessibilidade | Bloquear só Reels e Shorts | Não pedimos: a Play Store não aceita esse uso |

Em celulares Xiaomi, Samsung, Huawei, Oppo, Vivo, Realme, OnePlus, Motorola e Asus, a tela de permissões mostra um passo extra ("início automático").

## Como funciona

```
AlarmManager ──(início/fim de cada foco)──▶ Guard.sincronizar
                                              │
                                              ▼
                               FocusGuardService (só durante o foco)
                               a cada 1 s: UsageStatsManager.queryEvents
                                              │ abriu um app vigiado?
                                              ▼
                               PetelecoActivity (por cima do app)
                               1ª cutucada · 2ª peteleco · 3ª+ bloqueio
                               "Tá bom" → tela inicial · emergência → 5 min livres
```

| Arquivo | O que faz |
| --- | --- |
| `Store.kt` | Tudo que fica salvo: hábitos, energia, horários, vigiados, tentativas |
| `Perms.kt` | Checa e abre cada permissão |
| `Guard.kt` | Agenda alarmes, liga o vigia, notificações |
| `FocusGuardService.kt` | O vigia que detecta o app aberto |
| `PetelecoActivity.kt` | A tela por cima, com texto e vibração |
| `MainActivity.kt` | Hospeda a interface e a ponte `window.Zoe` |
| `Ia.kt` | Gemini: pacote de perguntas (busca do Google, ou Wikipedia e Open Library se a busca não for liberada) e conversa |
| `Lembretes.kt` | Lembrete dos hábitos e resumo das 22h |
| `Recados.kt` | O "cérebro" da bolinha: a cada ~5 min com a tela ligada, decide se mostra aviso de rolagem ou recado |
| `Bolha.kt` | A janela flutuante (arrastar, grudar na borda, soltar no X) e o serviço que a mantém viva |
| `assets/www/bolha.html` | Bolinha, cartão no topo e cartão central |
| `assets/www/` | Interface em HTML/CSS/JS, com o mesmo orbe do portfólio |

Para ver a interface no navegador do computador, abra `assets/www/index.html` (usa dados de exemplo; `index.html#novo` mostra as boas-vindas).

## Inteligência (Estudos)

1. Crie uma chave grátis em [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. No app: Zoe › Inteligência › cole a chave › Salvar e testar.

O app escolhe sozinho o modelo "flash" mais novo que a chave consegue usar.

Cada pacote de perguntas é feito em dois passos:

1. **Pesquisa:** o Gemini busca na web com o Google Search e escreve notas com fontes. Se a chave grátis não puder usar a busca, o app usa Wikipedia (e Open Library, para livros) como fonte.
2. **Perguntas:** o Gemini transforma as notas em 12 perguntas em JSON, cada uma apontando a fonte.

A chave fica no arquivo `segredo.xml`, fora do backup do Android. No plano gratuito, o Google pode usar o que é enviado para melhorar os produtos dele, e o app avisa isso na tela.

## Bolinha (v0.3)

- Fora do foco, das 8h às 22h, fora de ligações e só com a tela ligada (o alarme não acorda o celular).
- Recados: até 3 por dia (ajustável), com pelo menos 2h entre eles. Dispensou 3 seguidos: 1 por dia durante uma semana.
- Aviso de rolagem: 20 min seguidos nos apps vigiados (trocar entre eles conta junto) ou passou do limite do dia.
  1º aviso: cartão no topo. Se escolher "Só mais 10 min" e continuar: 2º aviso no centro, com foco de 25 min ou pausa de 30 min.
  No máximo 2 avisos por dia. "Tô de boa" / "Me deixa" silenciam o resto do dia.
- Ajustes em Zoe › Bolinha, com botões para ver um recado e um aviso de exemplo.

O `applicationId` continua `com.zoefoco.app` para a versão nova instalar por cima sem perder os dados.
