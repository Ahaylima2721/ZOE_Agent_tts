# Vídeo de apresentação do app Zoe

Vertical 1080×1920, 61 segundos, para Reels, Stories e TikTok. Um diálogo entre a **Zoe** e **você**, a pessoa presa no feed, mostrando as telas reais do app dentro de um celular.

- **Vozes** (Speko, Azure MAI-Voice-2.1): Zoe = `pt-BR-Luana`, você = `pt-BR-Caio`. A pronúncia de "Zoe" e "peteleco" foi conferida por transcrição.
- **Telas:** vêm direto de `app/android/app/src/main/assets/www` (animação de entrada, Hoje, peteleco, aviso de rolagem, pílula), usando a ponte falsa do app em modo `#demo`.
- **Áreas seguras do Instagram:** nada importante nos ~190 px de cima, nos ~380 px de baixo nem nos ~135 px da direita.
- **Áudio:** −14 LUFS.

## Roteiro

| Tempo | Quem | Fala | Tela |
| --- | --- | --- | --- |
| 0:01 | Você | Só mais um vídeo… só mais um… | Feed rolando, 23:47, "2h 41min hoje" |
| 0:03 | Zoe | Ei, você aí! Já cansou de ficar horas parado no celular, sem resultado nenhum? | A bolinha entra pela borda |
| 0:10 | Você | Ué… quem é você? | |
| 0:12 | Zoe | Eu sou a Zoe. E eu posso te ajudar com isso. | Animação de entrada do app |
| 0:18 | Você | Ajudar como? | Tela Hoje |
| 0:19 | Zoe | Você escolhe seus hábitos e seus horários de foco. Se abrir o Instagram na hora do foco… peteleco! | Peteleco (tela treme) |
| 0:27 | Você | Ai! Tá bom, tá bom! | |
| 0:29 | Zoe | E fora do foco eu não brigo. Só te aviso quando você passa do ponto. A escolha é sua. | Aviso de rolagem no topo |
| 0:36 | Você | E se eu quiser aprender alguma coisa? | |
| 0:39 | Zoe | Me conta o que você tá estudando, ou o livro que tá lendo, e eu trago perguntas pra você pensar no intervalo. | Pílula de Python |
| 0:46 | Você | Gostei. Mas o que você ganha com isso? | Acertou: +5 de energia |
| 0:49 | Zoe | Cuidar de mim é cuidar de você. Quanto mais você cumpre, mais eu cresço. | Hábitos sendo marcados |
| 0:54 | Zoe | Bora largar o feed e começar? Eu sou a Zoe. | Cartão final |

## Como refazer

```bash
cd video/intro_app
python3 make_intro.py      # trilha, linha do tempo e build/intro.html
node record_intro.js       # grava em câmera lenta (uns 3 min)
python3 juntar.py          # build/zoe_apresentacao.mp4
```

Prévia rápida no navegador: abra `build/intro.html#rapido`. Para trocar uma fala, gere o áudio de novo em `audio/<id>.wav` (24 kHz mono; `extrair.py` converte a resposta do Speko) e edite `FALAS` em `make_intro.py`.
