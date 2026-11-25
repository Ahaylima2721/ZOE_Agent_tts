"""Vídeo de apresentação do app Zoe (vertical 1080x1920): diálogo entre a Zoe e "você".

1. junta as falas (audio/*.wav) com pausas e gera build/narracao.wav
2. calcula o volume da voz da Zoe quadro a quadro (os olhos dela pulam no ritmo da fala)
3. copia as telas do app (assets/www) para build/www e gera build/intro.html

Depois: node record_intro.js (grava) e python3 juntar.py (monta o MP4).
"""
import json, pathlib, shutil, wave
import numpy as np

D = pathlib.Path(__file__).parent
B = D / "build"
WWW = D.parent.parent / "app/android/app/src/main/assets/www"
FPS, SR = 30, 24000

# (id, quem, texto da legenda, manchete, tela, eventos [(segundos desde o início da fala, ação)])
FALAS = [
    ("v01", "voce", "Só mais um vídeo… só mais um…", "23:47. Ainda rolando.", "feed", []),
    ("z02", "zoe", "Ei, você aí! Já cansou de ficar horas parado no celular, sem resultado nenhum?", "23:47. Ainda rolando.", "feed", [(0.0, "bolhaEntra")]),
    ("v03", "voce", "Ué… quem é você?", "23:47. Ainda rolando.", "feed", []),
    ("z04", "zoe", "Eu sou a Zoe. E eu posso te ajudar com isso.", "Prazer, <em>Zoe</em>", "hoje", [(0.0, "carregarHoje")]),
    ("v05", "voce", "Ajudar como?", "Prazer, <em>Zoe</em>", "hoje", []),
    ("z06", "zoe", "Você escolhe seus hábitos e seus horários de foco. Se abrir o Instagram na hora do foco… peteleco!", "Foco com <em>peteleco</em>", "hoje", [(-1.5, "peteleco")]),
    ("v07", "voce", "Ai! Tá bom, tá bom!", "Foco com <em>peteleco</em>", "peteleco", []),
    ("z08", "zoe", "E fora do foco eu não brigo. Só te aviso quando você passa do ponto. A escolha é sua.", "Fora do foco, <em>só um toque</em>", "feed", [(0.5, "topo")]),
    ("v09", "voce", "E se eu quiser aprender alguma coisa?", "Fora do foco, <em>só um toque</em>", "feed", []),
    ("z10", "zoe", "Me conta o que você tá estudando, ou o livro que tá lendo, e eu trago perguntas pra você pensar no intervalo.", "Estude <em>no intervalo</em>", "pilula", [(4.6, "revelar")]),
    ("v11", "voce", "Gostei. Mas o que você ganha com isso?", "Estude <em>no intervalo</em>", "pilula", [(0.4, "acertei")]),
    ("z12", "zoe", "Cuidar de mim é cuidar de você. Quanto mais você cumpre, mais eu cresço.", "Cuidar de mim <em>é cuidar de você</em>", "hoje", [(0.6, "habito"), (1.7, "habito"), (2.8, "habito")]),
    ("z13", "zoe", "Bora largar o feed e começar? Eu sou a Zoe.", "", "final", []),
]
ANTES, DEPOIS_VOCE, DEPOIS_ZOE, FINAL = 0.9, 0.25, 0.4, 3.2


def ler(nome):
    w = wave.open(str(D / "audio" / f"{nome}.wav"))
    assert w.getframerate() == SR, nome
    a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    # corta o silêncio do começo e do fim (deixa 40 ms)
    on = np.where(np.abs(a) > 0.02)[0]
    if len(on):
        a = a[max(0, on[0] - int(0.04 * SR)): min(len(a), on[-1] + int(0.04 * SR))]
    return a


trilha, zoe = [np.zeros(int(ANTES * SR), np.float32)], [np.zeros(int(ANTES * SR), np.float32)]
t, linha = ANTES, []
for fid, quem, texto, manchete, tela, ev in FALAS:
    a = ler(fid)
    dur = len(a) / SR
    eventos = [[round(t + (o if o >= 0 else dur + o), 3), acao] for o, acao in ev]
    linha.append({"id": fid, "quem": quem, "texto": texto, "manchete": manchete, "tela": tela,
                  "ini": round(t, 3), "fala": round(dur, 3), "eventos": eventos})
    pausa = np.zeros(int((DEPOIS_ZOE if quem == "zoe" else DEPOIS_VOCE) * SR), np.float32)
    trilha += [a, pausa]
    zoe += [a if quem == "zoe" else np.zeros_like(a), pausa]
    t += dur + len(pausa) / SR
trilha.append(np.zeros(int(FINAL * SR), np.float32))
zoe.append(np.zeros(int(FINAL * SR), np.float32))
audio, voz_zoe = np.concatenate(trilha), np.concatenate(zoe)
TOTAL = len(audio) / SR

B.mkdir(exist_ok=True)
with wave.open(str(B / "narracao.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())

hop = SR // FPS
env = np.array([np.sqrt(np.mean(voz_zoe[i:i + hop] ** 2)) for i in range(0, len(voz_zoe), hop)])
ref = np.percentile(env[env > 0.01], 95) if np.any(env > 0.01) else 1
env = np.clip(env / (ref + 1e-9), 0, 1)
for i in range(1, len(env)):
    env[i] = max(env[i], env[i - 1] * 0.72)

if (B / "www").exists():
    shutil.rmtree(B / "www")
shutil.copytree(WWW, B / "www")

dados = {"total": round(TOTAL, 3), "fps": FPS, "falas": linha, "env": [round(float(x), 2) for x in env]}
html = (D / "intro_template.html").read_text(encoding="utf-8").replace("/*DADOS*/", "const FILME = " + json.dumps(dados, ensure_ascii=False) + ";")
(B / "intro.html").write_text(html, encoding="utf-8")
print(f"total {TOTAL:.1f}s")
for c in linha:
    print(f"  {c['id']} {c['ini']:6.2f}s  +{c['fala']:.2f}s  {c['tela']:9s} {c['texto'][:50]}")
