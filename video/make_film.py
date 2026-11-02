"""Monta a trilha de áudio, o envelope de voz e a página film.html do vídeo."""
import json, wave, pathlib, subprocess
import numpy as np

D = pathlib.Path(__file__).parent
FPS = 30
SR = 24000

# cena: (id, áudio, legenda, tipo, dados)
CENAS = [
    ("abertura", "seg01", "Oi! Eu sou a Zoé, a assistente do portfólio do Ayalan. Hoje eu vou te mostrar como esse portfólio cresceu… e como eu cresci junto com ele.", "zoe", {}),
    ("v1", "seg02", "Tudo começou no dia 31 de outubro. A primeira versão parecia um editor de código: fundo escuro, arquivos na lateral e um mapa de vendas logo de cara.", "site",
        {"img": "shots/7eb4763-full.png", "data": "31 out", "titulo": "Editor de código", "fase": 0, "mov": "pan"}),
    ("v2", "seg03", "Poucas horas depois, ele mudou tudo. Um visual claro, neutro, com navegação simples e o foco nos projetos.", "site",
        {"img": "shots/946c6e9-full.png", "data": "31 out", "titulo": "Claro e neutro", "fase": 1, "mov": "pan"}),
    ("nasce", "seg04", "E foi aí que eu apareci. Uma bolinha roxa, quietinha no canto da tela, respondendo perguntas sobre o Ayalan. Eu ainda nem tinha nome!", "site",
        {"img": "shots/adf911f-top.png", "data": "31 out", "titulo": "Nasce a assistente", "fase": 2, "mov": "zoom", "ox": "94%", "oy": "90%", "z": 2.3}),
    ("escuro", "seg05", "No dia seguinte, o portfólio ficou mais ousado: fundo escuro, com o vermelho como cor principal.", "site",
        {"img": "shots/c697611-full.png", "data": "1 nov", "titulo": "Escuro e vermelho", "fase": 3, "mov": "pan"}),
    ("nome", "seg06", "E eu ganhei um nome: Zoé. Com página própria e até um laboratório, que mostra como eu penso por dentro.", "site",
        {"img": "shots/f8e1f2d-zoe.png", "data": "1 nov", "titulo": "Ela vira a Zoé", "fase": 4, "mov": "zoom", "ox": "78%", "oy": "40%", "z": 1.45}),
    ("editorial", "seg07", "Depois veio o visual editorial, claro, com cara de revista. E eu fui promovida: saí do canto e passei a morar no topo, cercada pelas pastas dos projetos.", "site",
        {"img": "shots/5daab0c-top.png", "data": "1 nov", "titulo": "Editorial, Zoé no topo", "fase": 5, "mov": "zoom", "ox": "72%", "oy": "45%", "z": 1.5}),
    ("viva", "seg08", "Aí eu ganhei vida de verdade. Um líquido que ondula aqui dentro, um olhar que segue o seu mouse, uns pulinhos… e, quando você rola a página, eu voo até o canto.", "live",
        {"src": "v/c3666c8/index.html", "data": "1 nov", "titulo": "Zoé viva", "fase": 6, "rolar": 8.6}),
    ("arquivos", "seg09", "E agora, a novidade: eu consigo receber arquivos. Eles entram em mim, eu penso um pouquinho… e pronto, achei a resposta!", "zoe",
        {"fx": [[0.6, "absorver"]], "tag": "Novo · zoe-fx.js"}),
    ("vida", "seg10", "Eu também fico corada quando recebo um elogio, danço quando o assunto é música, e comemoro quando dá tudo certo.", "zoe",
        {"fx": [[0.5, "corada"], [2.9, "dancar"], [5.0, "confete"]], "tag": "Novo · zoe-fx.js"}),
    ("fim", "seg11", "Ah, e reparou? Eu tô sem boca por enquanto. Ela volta quando a minha voz chegar no portfólio. Até lá, é só me chamar no cantinho da tela!", "zoe",
        {"fx": [[0.2, "surpresa"], [7.4, "ola"]], "tag": "Em breve · versão com voz"}),
]
FASES = ["31 out · editor", "claro", "nasce a assistente", "escuro", "Zoé", "editorial", "Zoé viva", "agora"]

ANTES, ENTRE, DEPOIS_FALA, FINAL = 0.8, 0.55, 0.35, 3.2

def ler(nome):
    w = wave.open(str(D / "audio" / f"{nome}.wav")); assert w.getframerate() == SR
    return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768

# ---------- trilha ----------
trilha, t, linha = [np.zeros(int(ANTES * SR), np.float32)], ANTES, []
for cid, seg, leg, tipo, dados in CENAS:
    a = ler(seg)
    ini = t; dur = len(a) / SR
    linha.append({"id": cid, "tipo": tipo, "legenda": leg, "ini": round(ini, 3), "fala": round(dur, 3),
                  "fim": round(ini + dur + DEPOIS_FALA, 3), **dados})
    trilha += [a, np.zeros(int((DEPOIS_FALA + ENTRE) * SR), np.float32)]
    t += dur + DEPOIS_FALA + ENTRE
trilha.append(np.zeros(int(FINAL * SR), np.float32))
audio = np.concatenate(trilha)
TOTAL = len(audio) / SR
# cenas emendadas: cada uma vai até o início da próxima
for i in range(len(linha) - 1):
    linha[i]["fim"] = linha[i + 1]["ini"] - 0.25
linha[-1]["fim"] = TOTAL - 1.9   # depois disso entra o cartão final

with wave.open(str(D / "narracao.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())

# ---------- envelope de voz (olhos falando) ----------
hop = SR // FPS
env = np.array([np.sqrt(np.mean(audio[i:i + hop] ** 2)) for i in range(0, len(audio), hop)])
env = np.clip(env / (np.percentile(env[env > 0.01], 95) + 1e-9), 0, 1)
suave = np.copy(env)
for i in range(1, len(suave)): suave[i] = max(env[i], suave[i - 1] * 0.72)   # ataque rápido, soltura suave
env_list = [round(float(x), 2) for x in suave]

dados = {"total": round(TOTAL, 3), "fps": FPS, "cenas": linha, "fases": FASES, "env": env_list}
html = (D / "film_template.html").read_text(encoding="utf-8")
html = html.replace("/*ORB_CSS*/", (D / "orb.css").read_text(encoding="utf-8"))
html = html.replace("/*ZOE_FX*/", (D / "zoe-fx.js").read_text(encoding="utf-8").replace("</script", "<\\/script"))
html = html.replace("/*DADOS*/", "const FILME = " + json.dumps(dados, ensure_ascii=False) + ";")
(D / "film.html").write_text(html, encoding="utf-8")
print(f"total {TOTAL:.1f}s, {len(linha)} cenas")
for c in linha: print(f"  {c['id']:10s} {c['ini']:6.2f} → {c['fim']:6.2f}")
