#!/usr/bin/env python3
"""
Testa, fora do celular, as mesmas chamadas que o app faz em Ia.kt:
  1. lista os modelos e escolhe o "flash" mais novo
  2. teste rápido ("Responda apenas: ok")
  3. pesquisa com Google Search (grounding)
  4. fontes abertas (Wikipedia / Open Library), caso a busca não esteja liberada
  5. perguntas em JSON com responseSchema
  6. conversa socrática com system_instruction

A chave vem da variável GEMINI_API_KEY. Sem ela, o script manda um valor de mentira no
cabeçalho x-goog-api-key, para o caso de um proxy injetar a chave de verdade.

Uso:  python3 testar_ia.py [--so-abertas]
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://generativelanguage.googleapis.com/v1beta"
UA = "ZoeFoco/0.2 (teste)"
CHAVE = os.environ.get("GEMINI_API_KEY") or "chave-injetada-pelo-proxy"


def http(url, corpo=None, chave=None):
    h = {"User-Agent": UA}
    data = None
    if chave:
        h["x-goog-api-key"] = chave
    if corpo is not None:
        h["Content-Type"] = "application/json; charset=utf-8"
        data = json.dumps(corpo).encode()
    req = urllib.request.Request(url, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def ok(titulo, cond, detalhe=""):
    print(("  OK   " if cond else "  FALHA") + "  " + titulo + (("  ·  " + detalhe) if detalhe else ""))
    return cond


def erro_msg(txt):
    try:
        return json.loads(txt)["error"]["message"][:200]
    except Exception:
        return txt[:200]


def texto(r):
    c = (r.get("candidates") or [{}])[0]
    return "".join(p.get("text", "") for p in c.get("content", {}).get("parts", []))


def usuario(t):
    return [{"role": "user", "parts": [{"text": t}]}]


# ---------------- fontes abertas ----------------

def wikipedia(lingua, busca, n):
    url = (f"https://{lingua}.wikipedia.org/w/api.php?action=query&format=json&generator=search"
           f"&gsrsearch={urllib.parse.quote(busca)}&gsrlimit={n}&prop=extracts&exintro=1&explaintext=1&exlimit={n}")
    st, t = http(url)
    if st != 200:
        return st, []
    pages = (json.loads(t).get("query") or {}).get("pages") or {}
    out = [p for p in sorted(pages.values(), key=lambda p: p.get("index", 99)) if len(p.get("extract", "")) > 80]
    return st, [(p["title"], len(p["extract"])) for p in out]


def open_library(titulo, autor):
    q = (f"https://openlibrary.org/search.json?limit=1&fields=key,title,author_name&title={urllib.parse.quote(titulo)}"
         + (f"&author={urllib.parse.quote(autor)}" if autor else ""))
    st, t = http(q)
    if st != 200:
        return st, None
    docs = json.loads(t).get("docs") or []
    if not docs:
        return st, None
    st2, t2 = http(f"https://openlibrary.org{docs[0]['key']}.json")
    obra = json.loads(t2) if st2 == 200 else {}
    d = obra.get("description")
    d = d.get("value") if isinstance(d, dict) else (d or "")
    return st2, (docs[0].get("title"), len(d), len(obra.get("subjects") or []))


def testar_abertas():
    print("\n[Fontes abertas, sem chave]")
    st, r = wikipedia("pt", "Python listas e dicionários", 3)
    ok("Wikipedia pt (estudo)", st == 200 and len(r) > 0, f"HTTP {st} · {r}")
    st, r = wikipedia("pt", "Sapiens livro Yuval Noah Harari", 2)
    ok("Wikipedia pt (livro)", st == 200 and len(r) > 0, f"HTTP {st} · {r}")
    st, r = open_library("Sapiens", "Yuval Noah Harari")
    ok("Open Library", st == 200 and r is not None, f"HTTP {st} · {r}")


# ---------------- Gemini ----------------

ESQUEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {**{k: {"type": "STRING"} for k in ["tipo", "pergunta", "codigo", "citacao", "dica", "resposta", "explicacao"]},
                       "fonte": {"type": "INTEGER"}, "dificuldade": {"type": "INTEGER"}},
        "required": ["tipo", "pergunta", "dica", "resposta", "fonte", "dificuldade"],
    },
}


def testar_gemini():
    print("\n[Gemini]" + ("" if "GEMINI_API_KEY" in os.environ else "  (sem GEMINI_API_KEY: contando com o proxy)"))
    st, t = http(f"{BASE}/models?pageSize=200", chave=CHAVE)
    if not ok("Listar modelos", st == 200, f"HTTP {st}" + ("" if st == 200 else " · " + erro_msg(t))):
        return
    nomes = [m["name"].removeprefix("models/") for m in json.loads(t).get("models", [])
             if "generateContent" in m.get("supportedGenerationMethods", [])]
    flash = re.compile(r"^gemini-([0-9.]+)-flash$")
    cand = sorted([n for n in nomes if flash.match(n)],
                  key=lambda n: [float(x) for x in flash.match(n).group(1).split(".")], reverse=True)
    ok("Modelos flash encontrados", len(cand) > 0, ", ".join(cand) or "nenhum")
    if not cand:
        cand = ["gemini-2.5-flash"]

    def gerar(corpo, nome):
        ultimo = None
        for m in cand[:3]:
            st, t = http(f"{BASE}/models/{m}:generateContent", corpo, CHAVE)
            if st == 200:
                ok(nome, True, m)
                return m, json.loads(t)
            ultimo = (m, st, erro_msg(t))
            if st in (400, 401) and "API key" in t:
                break
        ok(nome, False, f"{ultimo[0]} HTTP {ultimo[1]} · {ultimo[2]}")
        return None, None

    gerar({"contents": usuario("Responda apenas: ok")}, "Teste rápido")

    desc = "Estudo de Python, nível intermediário. Tópico atual: listas e dicionários."
    m, r = gerar({"contents": usuario("Pesquise na web e escreva notas de estudo objetivas, em português, para esta trilha. "
                                       + desc + " Máximo de 300 palavras."),
                  "tools": [{"google_search": {}}]}, "Pesquisa com Google Search")
    fontes = []
    notas = ""
    if r:
        notas = texto(r)
        chunks = ((r.get("candidates") or [{}])[0].get("groundingMetadata") or {}).get("groundingChunks") or []
        fontes = [(c["web"].get("title", "Fonte"), c["web"]["uri"]) for c in chunks if c.get("web")]
        ok("Busca trouxe fontes", len(fontes) > 0, f"{len(fontes)} fontes: " + ", ".join(f[0] for f in fontes[:5]))
    if not fontes:
        print("  ->   sem busca: o app usaria Wikipedia/Open Library como fonte")
        notas = notas or "Listas são mutáveis; dicionários guardam pares chave-valor."

    lista_fontes = "\n".join(f"{i + 1}. {t} — {u}" for i, (t, u) in enumerate(fontes[:8])) or "(nenhuma)"
    prompt = ("Você é a Zoe, uma parceira de estudo. Crie 4 perguntas para esta trilha: " + desc +
              "\nTipos: conceito, codigo (trecho em 'codigo'), erro. 'fonte' = número da fonte (0 se nenhuma)."
              f"\n\nNOTAS:\n{notas[:6000]}\n\nFONTES:\n{lista_fontes}\n\nResponda só com um array JSON.")
    m, r = gerar({"contents": usuario(prompt),
                  "generationConfig": {"responseMimeType": "application/json", "responseSchema": ESQUEMA}},
                 "Perguntas em JSON (responseSchema)")
    if r:
        t = texto(r)
        try:
            arr = json.loads(t[t.index("["):t.rindex("]") + 1])
            ok("JSON válido", isinstance(arr, list) and len(arr) > 0, f"{len(arr)} perguntas")
            for q in arr[:4]:
                f = q.get("fonte", 0)
                print(f"         · [{q.get('tipo')}] {q.get('pergunta')}  (fonte {f})")
        except Exception as e:
            ok("JSON válido", False, str(e))

    gerar({"system_instruction": {"parts": [{"text": "Você é a Zoe, parceira de estudo no modo socrático. "
                                                      "Responda com UMA pergunta curta, em português."}]},
           "contents": usuario("Não entendi a diferença entre lista e tupla.")}, "Conversa (system_instruction)")


if __name__ == "__main__":
    testar_abertas()
    if "--so-abertas" not in sys.argv:
        testar_gemini()
