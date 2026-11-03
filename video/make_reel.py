"""Reels vertical (1080x1920): monta a trilha, o envelope de voz e reel.html."""
import json, wave, pathlib
import numpy as np

D = pathlib.Path(__file__).parent
FPS, SR = 30, 24000

def card(t, x, y, html): return {"t": t, "x": x, "y": y, "html": html}

# (áudio, manchete, legenda, tipo, passo, dados)
CENAS = [
    ("ig01", "Um portfólio que ganhou <em>uma assistente</em>",
     "Esse portfólio começou como uma página simples. Hoje, ele tem uma assistente que pensa. Prazer, eu sou a Zoe!",
     "zoe", -1, {"fx": [[0.2, "eureka"], [5.6, "ola"]]}),
    ("ig02", "Comecei assim",
     "No começo, o Ayalan montou tudo com cara de editor de código: fundo escuro, arquivos na lateral, e um mapa de vendas pra mostrar o que ele faz com dados.",
     "site", 0, {"img": "mob/7eb4763-full.png", "mov": "pan", "quanto": 0.75}),
    ("ig03", "Depois, <em>simplifiquei</em>",
     "Depois, ele simplificou. Um visual claro e direto, pra quem chega entender rápido quem ele é e o que ele constrói.",
     "site", 1, {"img": "mob/946c6e9-full.png", "mov": "pan", "quanto": 0.7}),
    ("ig04", "Aí nasceu <em>a Zoe</em>",
     "Foi aí que eu nasci: uma bolinha roxa no canto da tela, ainda sem nome, respondendo perguntas sobre os projetos.",
     "site", 2, {"img": "mob/adf911f-top.png", "mov": "zoom", "ox": 0.885, "oy": 0.93, "z": 2.3}),
    ("ig05", "Como a Zoe <em>pensa</em>",
     "Por dentro, eu leio o portfólio inteiro e os repositórios dele. Aprendi com mais de seiscentas perguntas escritas à mão, corrijo erros de digitação, e entendo quando você continua o assunto.",
     "zoe", 3, {"fx": [[0.3, "absorver"]], "cards": [
        card(4.6, 24, 6, '<b data-conta="601">0</b><small>perguntas escritas à mão, em 15 temas</small>'),
        card(8.0, 410, 24, '<b style="font-size:20px">harmoni → harmony</b><small>corrige erros de digitação</small>'),
        card(10.6, 24, 470, '<b style="font-size:20px">“e os testes dele?”</b><small>entende quando você continua o assunto</small>')]}),
    ("ig06", "Tudo no <em>navegador</em>",
     "E o melhor: tudo roda no seu navegador. Sem servidor, sem chave de API, e acertando noventa e seis por cento das perguntas de teste.",
     "zoe", 3, {"fx": [[0.3, "procurando"], [8.0, "eureka"]], "cards": [
        card(3.0, 24, 20, '<b data-conta="0">0</b><small>servidores</small>'),
        card(4.4, 430, 20, '<b data-conta="0">0</b><small>chaves de API</small>'),
        card(7.2, 24, 452, '<b data-conta="96" data-suf="%">0%</b><small>de acerto nas perguntas de teste</small>'),
        card(8.6, 430, 452, '<b style="font-size:24px">~120 KB</b><small>de modelo, baixado uma vez</small>')]}),
    ("ig07", "A Zoe <em>ganhou nome</em>",
     "Com o tempo, eu ganhei nome, página própria, e um laboratório onde dá pra ver cada passo do meu raciocínio.",
     "site", 4, {"img": "mob/f8e1f2d-zoe.png", "mov": "pan", "quanto": 0.55}),
    ("ig08", "Zoe no topo… <em>e voando</em>",
     "O portfólio ganhou cara de revista, e eu fui morar no topo, cercada pelos projetos. Quando você rola a página, eu voo até o canto.",
     "live", 4, {"src": "v/c3666c8/index.html", "rolar": 4.9}),
    ("ig09", "Mais viva <em>do que nunca</em>",
     "Agora eu tô mais viva do que nunca: fico corada, danço, comemoro… e sigo aprendendo.",
     "zoe", 5, {"fx": [[2.6, "corada"], [4.2, "dancar"], [6.0, "confete"]]}),
    ("ig10", "Próximo passo: <em>voz</em>",
     "O próximo passo? Ganhar a minha própria voz. Enquanto isso, vem me conhecer no portfólio do Ayalan!",
     "zoe", 5, {"fx": [[0.3, "surpresa"], [4.4, "coracoes"]]}),
]
PASSOS = 6
ANTES, ENTRE, DEPOIS, FINAL = 0.5, 0.45, 0.3, 3.2

def ler(nome):
    w = wave.open(str(D / "audio_ig" / f"{nome}.wav")); assert w.getframerate() == SR
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

with wave.open(str(D / "narracao_reel.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())

hop = SR // FPS
env = np.array([np.sqrt(np.mean(audio[i:i + hop] ** 2)) for i in range(0, len(audio), hop)])
env = np.clip(env / (np.percentile(env[env > 0.01], 95) + 1e-9), 0, 1)
for i in range(1, len(env)): env[i] = max(env[i], env[i - 1] * 0.72)

dados = {"total": round(TOTAL, 3), "fps": FPS, "passos": PASSOS, "cenas": linha, "env": [round(float(x), 2) for x in env]}
html = (D / "reel_template.html").read_text(encoding="utf-8")
html = html.replace("/*ORB_CSS*/", (D / "orb.css").read_text(encoding="utf-8"))
html = html.replace("/*ZOE_FX*/", (D / "zoe-fx.js").read_text(encoding="utf-8").replace("</script", "<\\/script"))
html = html.replace("/*DADOS*/", "const FILME = " + json.dumps(dados, ensure_ascii=False) + ";")
(D / "reel.html").write_text(html, encoding="utf-8")
print(f"total {TOTAL:.1f}s")
for c in linha: print(f"  {c['id']} {c['ini']:6.2f} → {c['fim']:6.2f}  {c['tipo']}")
