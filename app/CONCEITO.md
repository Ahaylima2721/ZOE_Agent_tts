# Zoe Foco — conceito do app

> A Zoe sai do portfólio e vai para o bolso: um bichinho virtual (estilo Tamagotchi) que também é uma assistente anti-procrastinação. Você escolhe seus hábitos, marca horários de foco e, se abrir Instagram, Facebook ou YouTube nessa hora, a Zoe fecha o app e te dá um peteleco.

Versão do documento: 0.1 · 25/11/2026 · status: conceito, sem código ainda.

---

## 1. A ideia em uma frase

**Cuidar da Zoe é cuidar de você.** Quando você cumpre seus hábitos e respeita seus horários de foco, ela fica feliz e evolui. Quando você procrastina, ela fica triste, sonolenta ou brava, e se você abrir uma rede social no horário de foco ela aparece na frente, fecha o app e te dá uma bronca.

## 2. Os três papéis da Zoe

| Papel | O que faz | Como aparece |
| --- | --- | --- |
| **Bichinho** | Tem humor e energia que dependem dos seus hábitos. Evolui com a sequência de dias. | Tela inicial e widget |
| **Guardiã do foco** | No horário de foco, vigia os apps que você marcou e interrompe quando você abre um deles. | Tela cheia por cima do app |
| **Assistente** | Lembra os hábitos, comemora quando você conclui um, faz o resumo do dia. | Notificações e voz |

## 3. Fluxo do usuário

### 3.1 Primeira vez (menos de 2 minutos)
1. A Zoe se apresenta (uma frase falada, com o orbe animado).
2. **Escolha seus hábitos**: uma lista de cartões para tocar (beber água, ler 10 páginas, exercício, estudar, dormir antes das 23h, meditar) e a opção "criar o meu".
3. **Escolha seus vilões**: a Zoe mostra os apps instalados que mais consomem tempo (pelas estatísticas de uso) e você marca quais ela deve vigiar. Já vêm sugeridos: Instagram, Facebook, YouTube, TikTok, X.
4. **Escolha o horário de foco**: por exemplo, de segunda a sexta, das 9h às 12h e das 14h às 18h. Também dá para iniciar um foco avulso ("foco agora por 25 min").
5. **Escolha o jeito da Zoe**: Gentil, Firme ou Brava (muda o tom das broncas).
6. Conceder as permissões (seção 6), uma de cada vez, com a Zoe explicando o porquê de cada uma.

### 3.2 Dia a dia
- **Tela inicial**: a Zoe no centro, com humor visível; embaixo, os hábitos de hoje para marcar com um toque; em cima, o próximo foco.
- **Marcou um hábito**: a Zoe comemora (as animações do `zoe-fx.js`: pulinho, confete, corada).
- **Começou o foco**: notificação fixa "Zoe de guarda até 12h"; a Zoe fica com cara de concentrada.
- **Abriu um app vigiado**: o peteleco (seção 4).
- **Fim do dia**: resumo curto ("3 de 4 hábitos, 2h40 de foco, só 1 peteleco. Orgulho!").

## 4. O peteleco (a mecânica principal)

Quando você abre um app vigiado durante o foco, a Zoe aparece por cima em tela cheia. A bronca sobe de nível conforme você insiste:

| Tentativa no mesmo foco | O que acontece |
| --- | --- |
| 1ª | **Cutucada**: a Zoe aparece, fala uma frase curta e te manda de volta para a tela inicial. Botão "Tá bom, Zoe". |
| 2ª | **Peteleco**: a animação de peteleco (ela "bate" na tela, a tela treme), bronca mais firme, ela fica brava. Volta para a tela inicial. |
| 3ª em diante | **Bloqueio**: o app fica bloqueado até o fim do foco. Cada nova tentativa mostra a Zoe de braços cruzados e um contador ("faltam 47 min"). |

**Saída de emergência (obrigatória):** sempre existe o botão "Preciso mesmo" que libera o app por 5 minutos. Custa energia da Zoe e ela fica triste, mas nunca te prende. Isso evita que o app atrapalhe algo importante (uma mensagem de trabalho no Instagram, um tutorial no YouTube) e é o que faz as pessoas não desinstalarem o app na primeira semana.

Exemplos de falas (tom Firme):
- "Ei! A gente combinou foco até meio-dia. Volta pra tarefa!"
- "De novo o Instagram? Peteleco! 👉"
- "Bloqueado até as 12h. Você consegue, faltam só 40 minutinhos."

Tom Gentil: "Opa, acho que você abriu sem querer. Bora voltar?" · Tom Bravo: "NÃO. Fecha isso agora."

## 5. A Zoe como bichinho

Dois medidores simples, nada de planilha:

- **Energia** (0 a 100): sobe quando você conclui hábitos e termina focos; cai com petelecos e com o botão de emergência.
- **Sequência**: quantos dias seguidos você cumpriu pelo menos metade dos hábitos.

**Humores** (todos já desenhados no `zoe.design`): feliz, animada, concentrada (no foco), sonolenta (energia baixa), triste, brava (peteleco), dormindo (à noite).

**Evolução**: com 7, 30 e 100 dias de sequência a Zoe ganha um visual novo (um anel a mais, outra cor de líquido, um acessório). É a recompensa de longo prazo.

**Regra de ouro: a Zoe nunca morre.** No pior caso ela dorme e acorda quando você volta. Aplicativo de hábito que pune com culpa faz a pessoa abandonar; o objetivo é trazer de volta, não envergonhar.

## 6. Como rodar no telefone

### 6.1 O que cada plataforma permite (a parte importante)

| | Android | iPhone (iOS) | Web (PWA) |
| --- | --- | --- | --- |
| Saber qual app está aberto | Sim, com a permissão "Acesso aos dados de uso" | Não diretamente | Não |
| Fechar ou cobrir o outro app | Sim: abrir a tela da Zoe por cima e mandar para a tela inicial | Não pode fechar; pode **bloquear** com a API de Tempo de Uso | Não |
| Personalizar a tela de bloqueio | Totalmente (é a nossa tela) | Parcial: ícone, título, texto e botões | — |
| Custo de entrada | Grátis para instalar fora da loja; US$ 25 para a Play Store | US$ 99/ano e pedido de autorização especial à Apple | Grátis |

Conclusão: **o peteleco de verdade (abrir e a Zoe fechar) só é possível no Android.** No iPhone dá para fazer uma versão de "bloqueio com a cara da Zoe", mas exige o programa pago da Apple e aprovação de um direito especial (Family Controls). Um PWA (site instalável) não consegue vigiar outros apps, então não serve para o núcleo do produto.

### 6.2 Recomendação: Android primeiro, nativo e leve

- **Linguagem**: Kotlin, com as telas simples do próprio Android (sem Flutter nem React Native, que somam 10 a 30 MB ao app).
- **A Zoe na tela**: um WebView (o navegador que já vem no sistema) desenhando o orbe com o mesmo CSS e o `zoe-fx.js` que já existem neste repositório. Reaproveitamos toda a identidade visual e as animações, e o WebView não aumenta o tamanho do app.
- **Meta de tamanho**: APK com menos de 5 MB.
- **Android mínimo**: 8.0 (cobre praticamente todos os celulares em uso).
- **Tudo offline, sem conta e sem servidor**: hábitos e estatísticas ficam só no celular (Room/SQLite). Os dados de uso de apps são sensíveis, então não saem do aparelho. Isso também deixa o app de graça para manter.

### 6.3 Como o vigia funciona sem gastar bateria

1. Fora do horário de foco **nada roda**. Os horários são agendados com o despertador do sistema (AlarmManager).
2. No início do foco, liga um serviço em primeiro plano com a notificação "Zoe de guarda".
3. Esse serviço pergunta ao sistema, a cada 1 segundo, "qual foi o último app aberto?" (UsageStatsManager). É uma consulta pequena, praticamente sem gasto de bateria.
4. Se for um app vigiado: abre a tela do peteleco por cima (permitido porque o app tem a permissão de sobreposição) e, ao fechar, manda o usuário para a tela inicial.
5. No fim do foco, o serviço se desliga sozinho.

Permissões necessárias (todas pedidas com a Zoe explicando):

| Permissão | Para quê |
| --- | --- |
| Acesso aos dados de uso | Saber qual app foi aberto |
| Sobrepor a outros apps | Mostrar a Zoe por cima do Instagram |
| Notificações | Lembretes de hábitos e a notificação "de guarda" |
| Ignorar otimização de bateria (opcional) | Algumas marcas (Xiaomi, Samsung) matam serviços em segundo plano |

**Sobre o Serviço de Acessibilidade**: ele daria um controle mais fino (por exemplo, bloquear só os Reels e deixar o direct do Instagram, ou só os Shorts do YouTube), mas a Google Play recusa apps que usam acessibilidade para isso. Fica para uma versão futura distribuída fora da loja (APK direto), como opção avançada.

### 6.4 A voz da Zoe (adiada)

**Decisão de 25/11/2026: por enquanto a Zoe é só texto e vibração.** O plano abaixo fica para uma versão futura.

- **Broncas e comemorações**: cerca de 40 frases pré-gravadas com a voz Luana (a mesma do vídeo, gerada pelo Speko), em Opus, cerca de 10 KB cada, ou seja, uns 400 KB no total. Soa natural e funciona offline.
- **Frases dinâmicas** (nome do hábito, minutos restantes): o leitor de voz do próprio Android (TextToSpeech), offline e grátis.
- Opção "Zoe silenciosa" para quem está em lugar público: só animação e vibração.

### 6.5 Acessível de verdade

- Funciona em celular simples e sem internet.
- Respeita "reduzir movimento" (já previsto no `zoe-fx.js`): sem partículas, só a expressão muda.
- Toda fala da Zoe aparece também como texto (legenda) e é lida pelo TalkBack.
- Botões grandes, contraste alto no texto, nada importante só por cor.
- Sem anúncios e sem coleta de dados.

## 7. Escopo por etapa

**MVP (v0.1, Android)**
- Escolher hábitos, marcar como feito, lembrete diário
- Horários de foco recorrentes e foco avulso
- Escolher apps vigiados
- Peteleco com os 3 níveis e a saída de emergência
- Zoe com energia, humores e sequência
- Voz pré-gravada para as falas principais

**v0.2**
- Widget da Zoe na tela inicial do celular
- Resumo semanal
- Evolução visual por sequência
- Boca de volta (a fala com boca já está especificada no `zoe.design`)

**v0.3**
- Versão iPhone com Tempo de Uso (tela de bloqueio com a Zoe)
- Modo avançado com acessibilidade (bloquear só Reels e Shorts), fora da loja

**Fora do escopo por enquanto**: conta online, sincronizar entre aparelhos, ranking com amigos, IA conversando livremente (aumenta custo e exige internet).

## 8. Estrutura sugerida do código (Android)

```
app/android/
  app/src/main/
    java/.../zoe/
      MainActivity.kt          tela inicial (Zoe + hábitos)
      OnboardingActivity.kt    primeira vez + permissões
      FocusScheduler.kt        agenda início e fim dos focos (AlarmManager)
      FocusGuardService.kt     serviço "de guarda": consulta o app aberto
      PetelecoActivity.kt      tela por cima com a Zoe e a bronca
      ZoeState.kt              energia, humor, sequência
      data/                    Room: hábitos, focos, eventos
    assets/zoe/
      zoe.html  zoe.css  zoe-fx.js   (vindos deste repositório)
      voz/*.opus                      (falas pré-gravadas)
```

## 9. Riscos e decisões em aberto

| Risco | Como lidar |
| --- | --- |
| Xiaomi, Samsung e outras marcas matam o serviço em segundo plano | Tela de ajuda por marca no onboarding + pedido de ignorar otimização de bateria |
| Usuário revoga a permissão e o vigia para de funcionar em silêncio | Checar ao abrir o app e no início de cada foco; a Zoe avisa "fiquei cega, me ajuda?" |
| Política da Play Store para o serviço em primeiro plano (Android 14+) | Declarar o tipo `specialUse` com a justificativa "bloqueio de distrações agendado pelo usuário" |
| Bronca que vira chatice | Tons configuráveis, saída de emergência sempre disponível, nunca punir com perda permanente |

Decisões para o Ayalan:
1. Nome do app: "Zoe Foco"? Outro?
2. Começamos só pelo Android, como recomendado?
3. Distribuição inicial: APK direto para testar com amigos, ou já preparar para a Play Store?
4. O peteleco visual: a Zoe "bate" na tela (tela treme) ou um dedinho de luz sai do orbe?
