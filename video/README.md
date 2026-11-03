# Vídeo: a evolução do portfólio e da Zoé

Vídeo de cerca de 2 minutos, em 1080p, narrado pela própria Zoé. Ele mostra as 8 fases do portfólio (a partir do histórico do Git de `Ahaylima2721/Meu-Portif-lio`) e as animações novas do `zoe-fx.js`.

## Voz

| Voz | Modelo | Resultado |
| --- | --- | --- |
| **Luana** (escolhida) | Azure MAI-Voice-2.1, pt-BR nativa | Transcrição perfeita, inclusive "Zoé" e "Ayalan"; ritmo calmo de narração |
| Alice | Cartesia Sonic 3.5, pt nativa | Rápida demais; "Ayalan" saiu como "Aklam" |
| Ana Paula | Cartesia Sonic 3.5, pt nativa | Rápida, com menos variação de entonação |

A síntese foi feita pelo Speko (`audio.synthesize`), com a voz `pt-BR-Luana:MAI-Voice-2.1` e o provedor fixado em `azure`. Cada trecho foi conferido por transcrição automática.

Dica de escrita: use **"Zoé"** (com acento) no texto da narração para a pronúncia sair certa.

## Roteiro (11 trechos, um por cena)

1. Oi! Eu sou a Zoé, a assistente do portfólio do Ayalan. Hoje eu vou te mostrar como esse portfólio cresceu… e como eu cresci junto com ele.
2. Tudo começou no dia trinta e um de outubro. A primeira versão parecia um editor de código: fundo escuro, arquivos na lateral, e um mapa de vendas logo de cara.
3. Poucas horas depois, ele mudou tudo. Um visual claro, neutro, com navegação simples, e o foco nos projetos.
4. E foi aí que eu apareci. Uma bolinha roxa, quietinha no canto da tela, respondendo perguntas sobre o Ayalan. Eu ainda nem tinha nome!
5. No dia seguinte, o portfólio ficou mais ousado: fundo escuro, com o vermelho como cor principal.
6. E eu ganhei um nome: Zoé. Com página própria e até um laboratório, que mostra como eu penso por dentro.
7. Depois veio o visual editorial, claro, com cara de revista. E eu fui promovida: saí do canto e passei a morar no topo, cercada pelas pastas dos projetos.
8. Aí eu ganhei vida de verdade. Um líquido que ondula aqui dentro, um olhar que segue o seu mouse, uns pulinhos… e, quando você rola a página, eu voo até o canto.
9. E agora, a novidade: eu consigo receber arquivos. Eles entram em mim, eu penso um pouquinho… e pronto, achei a resposta!
10. Eu também fico corada quando recebo um elogio, danço quando o assunto é música, e comemoro quando dá tudo certo.
11. Ah, e reparou? Eu tô sem boca por enquanto. Ela volta quando a minha voz chegar no portfólio. Até lá, é só me chamar no cantinho da tela!

## Fases do portfólio usadas

| Fase | Commit | Visual |
| --- | --- | --- |
| 1 | `7eb4763` | Editor de código escuro |
| 2 | `946c6e9` | Claro e neutro |
| 3 | `adf911f` | Nasce a assistente (orbe no canto) |
| 4 | `c697611` | Escuro com vermelho |
| 5 | `f8e1f2d` | Ela vira a Zoé, com página própria |
| 6 | `5daab0c` | Editorial, Zoé no topo |
| 7 | `c3666c8` | Zoé viva (portfólio real rodando, com o voo) |
| 8 | este repo | Animações do `zoe-fx.js`, boca oculta |

## Como refazer

Os arquivos ficam numa pasta de trabalho com `audio/seg01.wav … seg11.wav`, `shots/`, `v/<commit>/` (o `git archive` de cada commit), `orb.css` (bloco do orbe do `zoe-preview.html`) e `zoe-fx.js`.

1. `node shots.js <pasta>`: fotografa cada versão do portfólio.
2. `python3 make_film.py`: junta a narração (`narracao.wav`), calcula o volume da voz quadro a quadro (os olhos da Zoé pulam no ritmo da fala) e gera `film.html`.
3. `node record.js <pasta>`: grava a página em 1920×1080 em câmera lenta (40% da velocidade) para não perder quadros.
4. O ffmpeg junta os quadros nos tempos reais com a narração e normaliza o volume (−16 LUFS).

---

# Reels do Instagram (vertical, 1080×1920)

Mesma lógica do vídeo acima, com mais profundidade e sem datas. A narração diz "Zoe" sem acento. Tem cerca de 1min46.

- **Formato:** celular com o portfólio na versão mobile (`shots_mob.js` fotografa cada commit em 390×844), manchete grande por cena, barra de progresso e legenda em blocos, frase por frase.
- **Áreas seguras do Instagram:** nada importante nos ~190 px do topo (perfil), nos ~380 px de baixo (legenda do post e botões) nem nos ~135 px da direita.
- **Áudio:** normalizado em −14 LUFS, o padrão das redes sociais.
- **Arquivos:** `make_reel.py`, `reel_template.html` e `record_reel.js`; os trechos de áudio ficam em `audio_ig/ig01.wav … ig10.wav`.

## Roteiro do Reels

| Cena | Manchete | Narração |
| --- | --- | --- |
| 1 | Um portfólio que ganhou uma assistente | Esse portfólio começou como uma página simples. Hoje, ele tem uma assistente que pensa. Prazer, eu sou a Zoe! |
| 2 | Comecei assim | No começo, o Ayalan montou tudo com cara de editor de código: fundo escuro, arquivos na lateral, e um mapa de vendas pra mostrar o que ele faz com dados. |
| 3 | Depois, simplifiquei | Depois, ele simplificou. Um visual claro e direto, pra quem chega entender rápido quem ele é e o que ele constrói. |
| 4 | Aí nasceu a Zoe | Foi aí que eu nasci: uma bolinha roxa no canto da tela, ainda sem nome, respondendo perguntas sobre os projetos. |
| 5 | Como a Zoe pensa | Por dentro, eu leio o portfólio inteiro e os repositórios dele. Aprendi com mais de seiscentas perguntas escritas à mão, corrijo erros de digitação, e entendo quando você continua o assunto. |
| 6 | Tudo no navegador | E o melhor: tudo roda no seu navegador. Sem servidor, sem chave de API, e acertando noventa e seis por cento das perguntas de teste. |
| 7 | A Zoe ganhou nome | Com o tempo, eu ganhei nome, página própria, e um laboratório onde dá pra ver cada passo do meu raciocínio. |
| 8 | Zoe no topo… e voando | O portfólio ganhou cara de revista, e eu fui morar no topo, cercada pelos projetos. Quando você rola a página, eu voo até o canto. |
| 9 | Mais viva do que nunca | Agora eu tô mais viva do que nunca: fico corada, danço, comemoro… e sigo aprendendo. |
| 10 | Próximo passo: voz | O próximo passo? Ganhar a minha própria voz. Enquanto isso, vem me conhecer no portfólio do Ayalan! |

Os números das cenas 5 e 6 (601 perguntas, 15 temas, 96% de acerto, ~120 KB, zero servidores) vêm do README do repositório do portfólio.
