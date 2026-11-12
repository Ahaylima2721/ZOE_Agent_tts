"""Stories de 1 minuto (1080x1920): monta a trilha, o envelope de voz e reel.html."""
import json, wave, pathlib
import numpy as np

D = pathlib.Path(__file__).parent
FPS, SR = 30, 24000

def card(t, x, y, html): return {"t": t, "x": x, "y": y, "html": html}

# (áudio, manchete, legenda, tipo, passo, dados)
CENAS = [
    ("st01", "Oi, eu sou <em>a Zoe</em>",
     "Olá! Eu sou a Zoe. Nasci apenas como um chatbot… e hoje tenho o projeto de virar uma inteligência artificial.",
     "zoe", 0, {"fx": [[0.2, "eureka"], [1.0, "ola"]]}),
    ("st02", "Nasci como <em>um chatbot</em>",
     "Sou um projeto de faculdade do Ayalan. No começo, eu era só uma bolinha roxa no canto do portfólio dele.",
     "site", 1, {"img": "mob/adf911f-top.png", "mov": "zoom", "ox": 0.885, "oy": 0.93, "z": 2.3}),
    ("st03", "Ganhei nome <em>e página</em>",
     "Depois ganhei nome, uma página só minha, e um laboratório que mostra como eu penso.",
     "site", 2, {"img": "mob/f8e1f2d-zoe.png", "mov": "pan", "quanto": 0.5}),
    ("st04", "Aprendi <em>a responder</em>",
     "Aprendi com mais de seiscentas perguntas, e hoje acerto noventa e seis por cento dos testes.",
     "zoe", 3, {"fx": [[0.2, "absorver2"]], "cards": [
        card(1.6, 24, 10, '<b data-conta="601">0</b><small>perguntas escritas à mão</small>'),
        card(3.9, 430, 452, '<b data-conta="96" data-suf="%">0%</b><small>de acerto nos testes</small>')]}),
    ("st05", "Ganhei <em>vida</em>",
     "Também ganhei vida: eu pisco, sigo o seu olhar, e voo pela página.",
     "live", 4, {"src": "v/novo/index.html", "rolar": 2.6}),
    ("st06", "Próximos <em>passos</em>",
     "Meus próximos passos? Ganhar a minha própria voz, e aprender cada vez mais, até virar uma inteligência artificial de verdade.",
     "zoe", 5, {"fx": [[0.3, "surpresa"], [7.6, "eureka"]], "cards": [
        card(1.9, 24, 14, '<b style="font-size:22px">1 · Voz própria</b><small>falar com você, de verdade</small>'),
        card(4.4, 420, 34, '<b style="font-size:22px">2 · Aprender mais</b><small>novos temas e conversas</small>'),
        card(6.8, 200, 478, '<b style="font-size:22px">3 · Virar uma IA</b><small>o objetivo do projeto</small>')]}),
    ("st07", "Vem <em>comigo</em>",
     "Vem acompanhar a minha evolução!",
     "zoe", 5, {"fx": [[0.1, "coracoes"], [1.2, "confete"]]}),
]
PASSOS = 6
ANTES, ENTRE, DEPOIS, FINAL = 0.5, 0.4, 0.3, 3.0

def ler(nome):
    w = wave.open(str(D / "audio_st" / f"{nome}.wav")); assert w.getframerate() == SR
    return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768

trilha, t, linha = [np.zeros(int(ANTES * SR), np.float32)], ANTES, []
for seg, manchete, leg, tipo, passo, dados in CENAS:
    a = ler(seg); dur = len(a) / SR
    linha.append({"id": seg, "tipo": tipo, "manchete": manchete, "legenda": leg, "passo": passo,
                  "ini": round(t, 3), "fala": round(dur, 3), **dados})
    trilha += [a, np.zeros(int((DEPOIS + ENTRE) * SR), np.float32)]
    t += dur + DEPOIS + ENTRE
trilha.append(np.zeros(int(FINAL * SR), np.float32))
audio = np.concatenate(trilha); TOTAL = len(audio) / SR
for i in range(len(linha) - 1): linha[i]["fim"] = round(linha[i + 1]["ini"] - 0.2, 3)
linha[-1]["fim"] = round(TOTAL - 2.4, 3)

with wave.open(str(D / "narracao_story.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())

hop = SR // FPS
env = np.array([np.sqrt(np.mean(audio[i:i + hop] ** 2)) for i in range(0, len(audio), hop)])
env = np.clip(env / (np.percentile(env[env > 0.01], 95) + 1e-9), 0, 1)
for i in range(1, len(env)): env[i] = max(env[i], env[i - 1] * 0.72)

dados = {"total": round(TOTAL, 3), "fps": FPS, "passos": PASSOS, "cenas": linha, "env": [round(float(x), 2) for x in env]}
html = (D / "story_template.html").read_text(encoding="utf-8")
html = html.replace("/*ORB_CSS*/", (D / "orb.css").read_text(encoding="utf-8"))
html = html.replace("/*ZOE_FX*/", (D / "zoe-fx.js").read_text(encoding="utf-8").replace("</script", "<\\/script"))
html = html.replace("/*DADOS*/", "const FILME = " + json.dumps(dados, ensure_ascii=False) + ";")
(D / "story.html").write_text(html, encoding="utf-8")
print(f"total {TOTAL:.1f}s")
for c in linha: print(f"  {c['id']} {c['ini']:6.2f} → {c['fim']:6.2f}  {c['tipo']}")
