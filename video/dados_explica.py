"""Tira do modelo publicado da Zoe os números das imagens explicativas.
Uso: python3 dados_explica.py <pasta do assistente do portfólio> <pasta de saída>
Gera explicar.json (neurônios ativos e probabilidades de uma pergunta real, via motor.js)
e mapa.json (os vetores TF-IDF dos trechos projetados em 2D por PCA)."""
import json, subprocess, sys, pathlib
import numpy as np
A, OUT = pathlib.Path(sys.argv[1]).resolve(), pathlib.Path(sys.argv[2]).resolve()
PERGUNTA = "quantos testes tem o harmoni?"
js = """
const I=require('./indice.json');const M=require('./motor.js')(I);const e=M.explicar(process.argv[1]);const h=e.classes.indexOf('harmony');
const f=e.feats.map(x=>{const w=(x.pesos.find(p=>p[0]===h)||[0,0])[1];return {t:x.termo,p:x.parte,v:+x.v.toFixed(3),w:+w.toFixed(2),c:+(x.v*w).toFixed(3)}}).sort((a,b)=>b.c-a.c);
process.stdout.write(JSON.stringify({feats:f,toks:e.toks,probs:e.probs,classes:e.classes}));"""
(OUT / "explicar.json").write_text(subprocess.run(["node", "-e", js, PERGUNTA], cwd=A, capture_output=True, text=True, check=True).stdout)
I = json.loads((A / "indice.json").read_text()); V = len(I["vocabulario"]); T = I["trechos"]
X = np.zeros((len(T), V))
for i, t in enumerate(T):
    for j, v in t["vetor"]: X[i, j] = v
voc = {w: i for i, w in enumerate(I["vocabulario"])}; q = np.zeros(V)
for t in ["teste", "harmony"]: q[voc[t]] = I["idf"][voc[t]]
q /= np.linalg.norm(q); mu = X.mean(0); _, _, Vt = np.linalg.svd(X - mu, full_matrices=False)
P = (X - mu) @ Vt[:2].T; pq = (q - mu) @ Vt[:2].T
t130 = next(t for t in T if t["id"] == "t130")
top = [(I["vocabulario"][j], round(v, 3)) for j, v in sorted(t130["vetor"], key=lambda x: -x[1])[:6]]
json.dump({"pts": [[round(float(a), 4), round(float(b), 4), t["tema"], t["titulo"]] for (a, b), t in zip(P, T)],
           "q": [float(pq[0]), float(pq[1])], "V": V, "t130": top}, open(OUT / "mapa.json", "w"), ensure_ascii=False)
print("ok")
