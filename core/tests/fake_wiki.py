"""Wikipédia de mentira para testes: mesmas rotas da API REST real (busca e resumo).

Rodar sozinho: python3 tests/fake_wiki.py <porta>
"""
from __future__ import annotations

import sys
from urllib.parse import unquote

from aiohttp import web

PAGES = {
    "O_Fantasma_da_Ópera": {
        "title": "O Fantasma da Ópera",
        "extract": "O Fantasma da Ópera é um romance do escritor francês Gaston Leroux, publicado em 1910. "
                   "A história se passa na Ópera de Paris. Ela inspirou vários filmes e musicais. Esta frase passa do limite.",
    },
    "Python": {
        "title": "Python",
        "extract": "Python é uma linguagem de programação de alto nível, criada por Guido van Rossum em 1991.",
    },
}


class FakeWiki:
    def __init__(self):
        self.requests: list[str] = []

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/w/rest.php/v1/search/page", self.search)
        app.router.add_get("/api/rest_v1/page/summary/{key}", self.summary)
        return app

    async def search(self, request):
        q = request.query.get("q", "").lower()
        self.requests.append(f"search:{q}")
        pages = [{"key": k, "title": v["title"], "excerpt": v["extract"][:60]}
                 for k, v in PAGES.items() if any(w in v["title"].lower() for w in q.split() if len(w) > 3)]
        return web.json_response({"pages": pages})

    async def summary(self, request):
        key = unquote(request.match_info["key"])
        self.requests.append(f"summary:{key}")
        if key not in PAGES:
            return web.json_response({"title": "Not found"}, status=404)
        p = PAGES[key]
        return web.json_response({"type": "standard", "title": p["title"], "extract": p["extract"],
                                  "content_urls": {"desktop": {"page": f"https://pt.wikipedia.org/wiki/{key}"}}})


if __name__ == "__main__":
    web.run_app(FakeWiki().app(), host="127.0.0.1", port=int(sys.argv[1]), print=None)
