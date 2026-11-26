# Identidade do app: a estufa da Zoe (v0.4)

O app é o canteiro da Zoe. Cada parte da interface vem dessa ideia, em vez de peças genéricas.

| No app | Na estufa |
| --- | --- |
| Hábitos | Mudas em vasos. Cumpriu, a planta cresce e floresce ("regado"). |
| Energia | Água: uma gota que enche, e o líquido dentro da Zoe no mesmo nível. |
| Foco | Fechar a estufa: uma redoma de vidro desce sobre a Zoe; os apps vigiados ficam "lá fora". |
| Sequência | O broto da Zoe floresce com 7, 30 e 100 dias seguidos. |
| Resumo do dia | Diário em papel pautado, com barras feitas à mão. |
| Abas | Canteiro, Estudos, Estufa e Zoe, com ícones desenhados (a folhinha marca a aba atual). |

## Regras visuais

- **Cores**: papel lavanda (`#EEEBF4`), tinta ameixa (`#2B2540`), lavanda para escolhas, sálvia para o que cresce
  (hábitos, energia, fontes), pêssego para cuidado e peteleco. Ficam em `zoe.css`.
- **Letra**: Bricolage Grotesque nos títulos e números, Figtree no texto, Caveat só nos recados da Zoe (ela "escreve à mão").
  As três ficam em `www/fontes/` (licença OFL).
- **Superfícies**: sem borda de 1px; papel sobre papel, linhas tracejadas e terra. Balões com um canto mais fechado.
- **Textura**: um grão de papel leve no fundo (SVG pequeno, sem imagem).

## A Zoe e as animações (`zoe-anim.js`)

`ZoeAnim.html(tamanho, humor)` desenha a Zoe; `ZoeAnim.tocar(el, nome)` toca uma animação. Com "reduzir movimento"
ligado no Android, nada se mexe.

| Animação | Quando aparece |
| --- | --- |
| brotar | abertura do app |
| oi | boas-vindas |
| feliz | avançar nas boas-vindas, acertar com leitura, diário de dia bom |
| regar | marcar um hábito |
| beber, exercicio, meditar | marcar esses hábitos |
| corada | o último hábito do dia |
| florescer | sequência de 7, 30 ou 100 dias (uma vez por marco) |
| comemorar | terminar as boas-vindas |
| vigia | estufa fechada (foco), jeito "Firme", peteleco nível 3 |
| murcha | abrir a estufa antes da hora, diário de dia fraco, bolinha triste |
| surpresa | voltar ao app depois de 3 horas |
| pensando | a IA montando perguntas |
| lendo | abrir uma pílula de estudo |
| eureka | acertar uma pergunta |
| coracoes | agradecer na conversa, jeito "Gentil" |
| brava | jeito "Brava", depois do peteleco nível 2 |
| peteleco | peteleco nível 2: ela dá um tapinha no app e ele sai voando |
| desconfiada | peteleco nível 1 |
| falando | a bolinha chegando com um recado |
| gelatina, tonta | tocar na Zoe; 5 toques em 2 segundos |
| olhar, espirro, bocejo, sono | gestos ao acaso quando ela está parada (à noite, mais sono) |
| danca, guarda | disponíveis para os próximos gatilhos |
