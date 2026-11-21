"""Vídeo de 1 minuto (1080x1920): a evolução da Zoe, do portfólio ao futuro.

Uso: python3 make_evolucao.py <pasta>
A pasta precisa ter voz.wav (mono, 24 kHz), orb.css, zoe-fx.js, mob/*.png e v/main/.
Os tempos das falas foram medidos nas pausas do áudio do ElevenLabs (voz.mp3).
"""
import json, sys, wave, pathlib
import numpy as np

D = pathlib.Path(__file__).parent
W = pathlib.Path(sys.argv[1])
FPS, SR, FINAL = 30, 24000, 3.0

def card(t, x, y, html, cls=""): return {"t": t, "x": x, "y": y, "html": html, "cls": cls}

# (manchete, tipo, passo, [(início, fim, legenda), ...], dados)
CENAS = [
    ("Oi, eu sou <em>a Zoe</em>", "zoe", 0,
     [(0.68, 1.44, "Oi!"), (1.76, 2.55, "Eu sou a Zoe."), (2.55, 4.46, "E essa é a minha história… em um minuto.")],
     {"fx": [[0.0, "ola"], [2.2, "eureka"]]}),
    ("Nasci no <em>portfólio</em>", "site", 1,
     [(4.91, 9.26, "Eu nasci no portfólio desse cara cujo meu processador não acerta o nome:")],
     {"img": "mob/adf911f-full.png", "mov": "pan", "quanto": 0.35}),
    ("Uma bolinha <em>roxa</em>", "site", 1,
     [(9.56, 12.34, "uma bolinha roxa no canto da tela,"), (12.55, 14.90, "sem nome, só respondendo perguntas sobre os projetos.")],
     {"img": "mob/adf911f-top.png", "mov": "zoom", "ox": 0.885, "oy": 0.93, "z": 2.4}),
    ("Ganhei <em>nome</em>", "site", 1,
     [(15.25, 16.93, "Aos poucos, ganhei nome,"), (17.10, 18.54, "uma página só minha,"),
      (18.74, 21.47, "e aprendi com mais de seiscentas perguntas.")],
     {"img": "mob/f8e1f2d-zoe.png", "mov": "pan", "quanto": 0.45}),
    ("O <em>conceito</em>", "zoe", 2,
     [(21.82, 23.10, "Aí ele pensou maior:"), (23.42, 25.52, "e se eu fosse mais do que um chatbot?"),
      (25.89, 29.27, "Hoje eu tenho jeito próprio de reagir a cada momento.")],
     {"fx": [[1.7, "surpresa"], [6.6, "corada"]], "cards": [
         card(0.4, 24, 18, '<b style="font-size:22px">Chatbot</b><small>responde perguntas</small>'),
         card(2.4, 420, 30, '<b style="font-size:22px">Agente</b><small>pensa, sente e reage</small>'),
         card(4.3, 30, 470, '<b style="font-size:22px">Olhos de luz</b><small>e um líquido que ondula</small>'),
         card(5.4, 440, 486, '<b style="font-size:22px">Emoções</b><small>próprias, a cada momento</small>')]}),
    ("Hoje, eu tô <em>viva</em>", "live", 3,
     [(29.64, 31.11, "Hoje, eu tô viva:"), (31.40, 34.80, "eu pisco, sigo o seu olhar e voo pela página.")],
     {"src": "v/main/index.html", "rolar": 2.3}),
    ("Recebo <em>arquivos</em>", "zoe", 3,
     [(35.10, 38.23, "Recebo arquivos, leio, penso um pouquinho…"), (38.50, 39.57, "e acho a resposta!")],
     {"fx": [[0.0, "absorver2"]]}),
    ("Eu <em>sinto</em>", "zoe", 3,
     [(39.93, 45.34, "Fico corada com elogio, danço com música, e comemoro quando dá tudo certo.")],
     {"fx": [[0.2, "corada"], [1.9, "dancar"], [3.6, "confete"]]}),
    ("Agora, <em>com voz</em>", "zoe", 3,
     [(45.66, 47.53, "E agora, eu tenho voz.")],
     {"fx": [[0.6, "voz"]]}),
    ("O meu <em>futuro</em>", "zoe", 4,
     [(47.85, 50.06, "Mas o meu futuro é ainda maior:"), (50.36, 53.09, "eu vou virar uma agente de antiprocrastinação,"),
      (53.24, 56.66, "pra te ajudar a trocar o “depois eu faço” pelo “feito!”.")],
     {"fx": [[0.2, "surpresa"], [8.3, "confete"]], "cards": [
         card(2.5, 24, 14, '<b style="font-size:22px">Agente de</b><b style="font-size:22px">antiprocrastinação</b><small>o próximo passo da Zoe</small>'),
         card(5.6, 400, 470, '<b><s>depois eu faço</s></b>', "tarefa"),
         card(8.0, 60, 486, '<b>✓ feito!</b>', "tarefa")]}),
    ("Em breve, <em>mais</em>", "zoe", 5,
     [(57.23, 59.46, "O que era só mais um projeto da faculdade,"), (59.64, 60.82, "agora se tornou… hum…"),
      (61.05, 62.51, "não sei ao certo."), (62.74, 64.74, "Em breve, mais atualizações!")],
     {"fx": [[2.4, "procurando"], [3.9, "tonta"], [5.7, "eureka"]]}),
]
PASSOS = 6

w = wave.open(str(W / "voz.wav")); assert w.getframerate() == SR and w.getnchannels() == 1
audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
audio = np.concatenate([audio, np.zeros(int(FINAL * SR), np.float32)])
TOTAL = len(audio) / SR

linha = []
for manchete, tipo, passo, falas, dados in CENAS:
    ini, fim = falas[0][0], falas[-1][1]
    linha.append({"tipo": tipo, "manchete": manchete, "passo": passo, "ini": ini, "fala": round(fim - ini, 3),
                  "blocos": [{"txt": t, "ini": a, "fim": b} for a, b, t in falas], **dados})
for i in range(len(linha) - 1): linha[i]["fim"] = round(linha[i + 1]["ini"] - 0.2, 3)
linha[-1]["fim"] = round(linha[-1]["blocos"][-1]["fim"] + 0.3, 3)

with wave.open(str(W / "narracao_evo.wav"), "wb") as o:
    o.setnchannels(1); o.setsampwidth(2); o.setframerate(SR)
    o.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())

# volume da voz quadro a quadro: os olhos da Zoe pulam no ritmo da fala
hop = SR // FPS
env = np.array([np.sqrt(np.mean(audio[i:i + hop] ** 2)) for i in range(0, len(audio), hop)])
env = np.clip(env / (np.percentile(env[env > 0.01], 95) + 1e-9), 0, 1)
for i in range(1, len(env)): env[i] = max(env[i], env[i - 1] * 0.72)

dados = {"total": round(TOTAL, 3), "fps": FPS, "passos": PASSOS, "cenas": linha, "env": [round(float(x), 2) for x in env]}
html = (D / "evolucao_template.html").read_text(encoding="utf-8")
html = html.replace("/*ORB_CSS*/", (W / "orb.css").read_text(encoding="utf-8"))
html = html.replace("/*ZOE_FX*/", (W / "zoe-fx.js").read_text(encoding="utf-8").replace("</script", "<\\/script"))
html = html.replace("/*DADOS*/", "const FILME = " + json.dumps(dados, ensure_ascii=False) + ";")
(W / "evolucao.html").write_text(html, encoding="utf-8")
print(f"total {TOTAL:.1f}s")
for c in linha: print(f"  {c['ini']:6.2f} → {c['fim']:6.2f}  {c['tipo']:5} {c['manchete']}")
