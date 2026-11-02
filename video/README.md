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
