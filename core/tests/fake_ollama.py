"""Ollama de mentira para testes: mesmas rotas e formato NDJSON em streaming da API real.

Rodar sozinho (usado pelo teste ponta a ponta do desktop):
  python3 tests/fake_ollama.py <porta> [vazio]
"""
from __future__ import annotations

import asyncio
import json
import sys

from aiohttp import web


# ---------- "modelo" de embeddings de mentira: saco de conceitos com sinônimos ----------
import hashlib
import re
import unicodedata

_SYN = {"autor": "escreveu", "escritor": "escreveu", "pintor": "pintou", "francesa": "franca", "independente": "independencia",
        "utilidade": "serve", "neurais": "neural", "redes": "rede", "guitarra": "violao", "acustica": "violao",
        "existem": "tem", "iniciante": "iniciantes", "disco": "armazenamento", "concentrar": "concentracao", "estudando": "estudos",
        "machine": "aprendizado", "learning": "maquina", "processo": "funciona", "faco": "", "instalar": "instalar"}
_STOP = {"o", "a", "os", "as", "de", "da", "do", "dos", "das", "e", "um", "uma", "que", "qual", "quem", "como", "me", "eu",
         "para", "por", "em", "no", "na", "sao", "foi", "ano", "explica", "explique", "fala", "dicas", "melhor", "minha",
         "meu", "faco", "the", "tocar", "quais", "funciona"}


def fake_vector(text: str, dim: int = 64) -> list[float]:
    t = "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c))
    v = [0.0] * dim
    for w in re.findall(r"[a-z0-9]+", t):
        w = _SYN.get(w, w)
        if not w or w in _STOP:
            continue
        v[int(hashlib.md5(w.encode()).hexdigest(), 16) % dim] += 1.0
    v[0] += 0.3                      # um pouco de "fundo" comum, como modelos reais têm
    return v


class FakeOllama:
    def __init__(self, installed=("qwen3:0.6b",), chunks=("Paris ", "é a capital ", "da França."), delay=0.0):
        self.installed = list(installed)
        self.chunks = list(chunks)
        self.delay = delay
        self.requests: list[dict] = []
        self.embed_calls = 0

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/api/version", self.version)
        app.router.add_get("/api/tags", self.tags)
        app.router.add_post("/api/chat", self.chat)
        app.router.add_post("/api/pull", self.pull)
        app.router.add_post("/api/embed", self.embed)
        return app

    async def version(self, request):
        return web.json_response({"version": "0.99.0-fake"})

    async def tags(self, request):
        return web.json_response({"models": [{"name": n} for n in self.installed]})

    async def embed(self, request):
        body = await request.json()
        self.embed_calls += 1
        if body["model"] not in self.installed:
            return web.json_response({"error": f"model '{body['model']}' not found"}, status=404)
        return web.json_response({"model": body["model"], "embeddings": [fake_vector(t) for t in body["input"]]})

    async def _ndjson(self, request, lines):
        resp = web.StreamResponse(headers={"Content-Type": "application/x-ndjson"})
        await resp.prepare(request)
        for line in lines:
            await resp.write((json.dumps(line) + "\n").encode())
            if self.delay:
                await asyncio.sleep(self.delay)
        await resp.write_eof()
        return resp

    async def chat(self, request):
        body = await request.json()
        self.requests.append(body)
        if body["model"] not in self.installed:
            return web.json_response({"error": f"model '{body['model']}' not found, try pulling it first"}, status=404)
        lines = [{"message": {"role": "assistant", "content": c}, "done": False} for c in self.chunks]
        return await self._ndjson(request, lines + [{"message": {"role": "assistant", "content": ""}, "done": True}])

    async def pull(self, request):
        body = await request.json()
        self.requests.append(body)
        total = 500_000_000
        lines = [{"status": "pulling manifest"}] + [
            {"status": "pulling abc123", "total": total, "completed": total * k // 4} for k in range(1, 5)
        ] + [{"status": "verifying sha256 digest"}, {"status": "success"}]
        self.installed.append(body["model"])
        return await self._ndjson(request, lines)


if __name__ == "__main__":
    # argv: <porta> [vazio]   ("vazio": nenhum modelo instalado, para testar o download)
    fake = FakeOllama(installed=() if sys.argv[2:] == ["vazio"] else ("qwen3:0.6b",),
                      chunks=("Oi! ", "Eu sou a Zoe, ", "rodando num modelo local."), delay=0.4)
    web.run_app(fake.app(), host="127.0.0.1", port=int(sys.argv[1]), print=None)
