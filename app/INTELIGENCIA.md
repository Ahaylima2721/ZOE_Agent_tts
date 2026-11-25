# Zoe Foco: a Zoe que te faz pensar

> Complemento do [CONCEITO.md](CONCEITO.md). Versão 0.1 · 25/11/2026 · status: conceito.

A Zoe deixa de ser só guardiã e vira **parceira de estudo**. Você conta o que está estudando ("Python") ou lendo ("Sapiens, capítulo 4") e ela busca na internet perguntas, exercícios e resenhas para te provocar a pensar, no momento certo, sem virar mais uma distração.

---

## 1. Princípio: ela pergunta antes de responder

A Zoe não é um chatbot que entrega respostas. Ela usa três técnicas que funcionam de verdade para aprender:

| Técnica | Como a Zoe aplica |
| --- | --- |
| **Lembrar ativamente** | Faz a pergunta e espera você tentar responder antes de mostrar a resposta |
| **Revisão espaçada** | Pergunta que você errou volta amanhã; a que acertou volta em 3, 7, 15 dias (caixas de Leitner, roda no celular, offline) |
| **Pergunta socrática** | Na conversa, responde com uma pergunta que te leva até a resposta; só explica direto se você pedir |

## 2. Trilhas: o que você está aprendendo

Cada assunto é uma **trilha**. Dois tipos:

- **Estudo** (ex.: Python): tema, nível (começando, intermediário, avançado), objetivo ("passar na entrevista", "automatizar planilhas") e o tópico atual ("listas e dicionários").
- **Leitura** (ex.: um livro): título, autor e o capítulo em que você está. A Zoe nunca traz nada depois desse capítulo (sem spoiler).

## 3. O que a Zoe busca e gera

| Para | A Zoe traz | Exemplo |
| --- | --- | --- |
| Estudo | Pergunta de conceito | "Qual a diferença entre uma lista e uma tupla? Quando você usaria cada uma?" |
| Estudo | Desafio de código curto | "O que este código imprime? `print([x*2 for x in range(3)])`" |
| Estudo | Erro comum | "Por que `def f(lista=[])` é uma armadilha?" |
| Leitura | Provocação de resenha | "Um crítico disse que o autor simplifica demais a revolução agrícola. Você concorda?" |
| Leitura | Conexão | "O que esse capítulo tem a ver com o que você estudou de Python esta semana?" |
| Leitura | Pergunta de fechamento | "Se tivesse que explicar o capítulo em uma frase, qual seria?" |

**Toda pergunta mostra a fonte** (título e link do artigo, documentação ou resenha). Trechos de livros e resenhas aparecem só em citações curtas, com crédito.

## 4. Quando ela aparece (o momento certo)

O segredo é não competir com o seu foco:

1. **No intervalo do foco**: terminou um bloco de 25 ou 50 minutos, a Zoe oferece uma **pílula** (1 pergunta, 1 minuto).
2. **Na troca do vício**: no peteleco, além de "Tá bom, Zoe", aparece **"Me dá uma pergunta no lugar"**. A vontade de abrir o Instagram vira 30 segundos de pensamento. Responder dá energia para a Zoe.
3. **Antes de dormir**: uma provocação do livro para pensar até o dia seguinte.
4. **Revisão do dia**: na tela Estudos, as perguntas que estão para revisar hoje.

Durante o foco ela **não interrompe** com perguntas.

## 5. Como funciona por dentro (sem pesar o celular)

```
 Celular (offline)                     Servidor fino                    Claude
 ┌────────────────────────┐   1x por    ┌──────────────────┐            ┌────────────────┐
 │ Trilhas, perguntas,    │  semana ou  │ Guarda a chave   │  pedido +  │ Busca na web e │
 │ revisão espaçada,      │ ──────────▶ │ da API, limita   │ ─────────▶ │ monta o pacote │
 │ respostas do usuário   │ ◀────────── │ uso por pessoa   │ ◀───────── │ em JSON        │
 └────────────────────────┘   pacote    └──────────────────┘            └────────────────┘
```

- **Pacote da semana**: quando você cria uma trilha, e depois uma vez por semana, o app pede um pacote de ~20 perguntas. Elas ficam salvas no celular, e a semana inteira funciona **sem internet**.
- **Servidor fino**: uma função pequena (por exemplo Cloudflare Workers, que tem plano gratuito) que guarda a chave da API. A chave **nunca** vai dentro do app, porque qualquer pessoa conseguiria extrair.
- **O que sai do celular**: só a trilha (tema, nível, tópico, livro e capítulo). **Nunca** o uso de apps, os hábitos ou os petelecos.
- **Modelo**: Claude Opus 5.5 (`claude-opus-5-5`) com a ferramenta de busca na web (`web_search_20260209`) e saída estruturada em JSON (`output_config.format`), para o app receber as perguntas já no formato certo. Ativar o `fallbacks` do lado do servidor para o caso de o modelo recusar um pedido.
- **Custo**: como só gera um pacote por semana por trilha, o custo por pessoa fica baixo. Antes de abrir para outras pessoas, medimos o custo real de um pacote. Se pesar, dá para trocar de modelo ou diminuir o pacote, mas é uma decisão a tomar com os números na mão.
- **Conversa com a Zoe** (opcional, online): chat socrático sobre a trilha, com limite diário de mensagens para controlar custo.

### Formato de uma pergunta no pacote

```json
{
  "id": "py-017",
  "trilha": "python",
  "tipo": "codigo",
  "pergunta": "O que este código imprime?",
  "codigo": "print([x*2 for x in range(3)])",
  "dica": "range(3) gera 0, 1 e 2.",
  "resposta": "[0, 2, 4]",
  "explicacao": "A compreensão de lista aplica x*2 a cada valor do range.",
  "fonte": { "titulo": "Documentação do Python: List Comprehensions", "url": "https://docs.python.org/3/tutorial/datastructures.html#list-comprehensions" },
  "dificuldade": 1
}
```

## 6. A Zoe como bichinho, agora estudante

- Responder uma pílula: **+5 de energia**. Acertar uma revisão difícil: **+10**.
- Trocar o Instagram por uma pergunta no peteleco: **anula a perda de energia** daquele peteleco.
- Nova evolução: a Zoe ganha **óculos** depois de 50 perguntas respondidas numa trilha.
- Novo humor **pensativa**: olhos olhando para cima e o líquido girando devagar, usado enquanto você pensa na pergunta.

## 7. Escopo

**v0.2 (depois do MVP do peteleco)**
- Trilhas de estudo e de leitura
- Pacote da semana com fontes
- Pílula no intervalo e na troca do vício
- Revisão espaçada offline

**v0.3**
- Conversa socrática online, com limite diário
- Resumo semanal de aprendizado ("você dominou 12 conceitos de Python")

## 8. Riscos

| Risco | Como lidar |
| --- | --- |
| Pergunta com resposta errada | Sempre mostrar a fonte; botão "essa pergunta está errada" que tira a pergunta do pacote |
| Spoiler do livro | O pedido sempre leva o capítulo atual; instrução explícita para não passar dele |
| Direitos autorais | Só citações curtas com crédito; nada de reproduzir capítulos |
| Custo crescer com muitos usuários | Pacote semanal, limite de conversa por dia, medir antes de lançar |
| A Zoe virar distração | Nunca pergunta durante o foco; no máximo 3 pílulas por dia, configurável |
