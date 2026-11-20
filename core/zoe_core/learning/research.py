"""Pesquisa depois da conversa (opcional, desligada por padrão).

Quando a conversa termina (2 min sem mensagens), a Zoe confere na Wikipédia os
assuntos que só a IA respondeu (primeiro os que levaram 👎) e guarda o resumo
com título e link. Na próxima vez, responde pela base, citando a fonte.

Privacidade: só o ASSUNTO sai do computador (a pergunta sem palavras pessoais,
que nem é guardada se for pessoal); nada da conversa, da memória ou do PC.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import TYPE_CHECKING
from urllib.parse import quote, urlparse

import aiohttp

from ..events import EventType
from ..text import tokens
from .knowledge import QUESTION_WORDS, cacheable, topic

if TYPE_CHECKING:
    from ..core import ZoeCore

log = logging.getLogger("zoe.research")

QUIET_AFTER_S = 120          # "a conversa terminou"
PER_RUN = 5
PER_DAY = 30
USER_AGENT = "ZoeDesktop/0.1 (assistente pessoal local)"
LEAD = re.compile(r"^(?:(?:e|mas)\s+)?(?:quem|qual|quais|o\s+que|que|como|onde|quando|por\s+que|porque|quanto[s]?|"
                  r"me\s+(?:fala|fale|conta|conte|explica|explique)(?:\s+sobre)?|fale\s+sobre|explique|voc[eê]\s+sabe)\b[\s,]*",
                  re.I)


def is_allowed_url(url: str) -> bool:
    """Só a Wikipédia (https) ou um servidor local de testes."""
    try:
        u = urlparse(url)
    except ValueError:
        return False
    if u.scheme == "https" and u.hostname and (u.hostname == "wikipedia.org" or u.hostname.endswith(".wikipedia.org")):
        return True
    return u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost")


def search_terms(question: str) -> str:
    """'Quem escreveu O Fantasma da Ópera?' -> 'escreveu O Fantasma da Ópera'"""
    q = question.strip().rstrip("?!. ")
    for _ in range(2):
        q = LEAD.sub("", q).strip()
    q = re.sub(r"^(?:é|e|foi|são|era)\s+", "", q, flags=re.I)
    return q[:120]


class Researcher:
    def __init__(self, core: "ZoeCore"):
        self.core = core
        self.last_chat = 0.0
        self._task: asyncio.Task | None = None
        self.done_today: list[float] = []

    def enabled(self) -> tuple[bool, str]:
        s = self.core.db.get_settings()
        url = s.get("pesquisa_web_url", "https://pt.wikipedia.org")
        return bool(s.get("pesquisa_web")) and is_allowed_url(url), url.rstrip("/")

    def touch(self) -> None:
        self.last_chat = self.core.clock()

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(30)
            if self.core.clock() - self.last_chat >= QUIET_AFTER_S:
                try:
                    await self.run()
                except Exception:
                    log.exception("falha na pesquisa pós-conversa")

    async def run(self) -> int:
        """Pesquisa até PER_RUN assuntos pendentes. Devolve quantos aprendeu."""
        on, base = self.enabled()
        if not on:
            return 0
        now = self.core.clock()
        self.done_today = [t for t in self.done_today if now - t < 86400]
        budget = min(PER_RUN, PER_DAY - len(self.done_today))
        learned = 0
        for row in self.core.knowledge.pending_research(max(budget, 0)):
            self.core.knowledge.mark_researched(row["id"])
            if not cacheable(row["question"]):
                continue
            self.done_today.append(now)
            found = await self.lookup(base, search_terms(row["question"]))
            if not found:
                continue
            kid = self.core.knowledge.add(row["question"], found["extract"], "web", "fonte",
                                          title=found["title"], url=found["url"])
            learned += 1
            await self.core.publish(EventType.NEW_DISCOVERY, {"knowledge_id": kid, "title": found["title"],
                                                              "url": found["url"]}, source="pesquisa")
        return learned

    async def lookup(self, base: str, terms: str) -> dict | None:
        if not terms or not topic(terms):
            return None
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8), headers=headers) as s:
                async with s.get(f"{base}/w/rest.php/v1/search/page", params={"q": terms, "limit": "3"}) as r:
                    if r.status != 200:
                        return None
                    pages = (await r.json()).get("pages") or []
                wanted = topic(terms) - QUESTION_WORDS
                page = next((p for p in pages if tokens(p.get("title", "")) & wanted), None)
                if not page:
                    return None
                async with s.get(f"{base}/api/rest_v1/page/summary/{quote(page['key'], safe='')}") as r:
                    if r.status != 200:
                        return None
                    data = await r.json()
        except (aiohttp.ClientError, OSError, TimeoutError, ValueError) as e:
            log.info("pesquisa falhou para %r: %s", terms, e)
            return None
        extract = (data.get("extract") or "").strip()
        if not extract or data.get("type") == "disambiguation":
            return None
        sentences = re.split(r"(?<=[.!?])\s+", extract)
        short = " ".join(sentences[:3])[:600]
        url = ((data.get("content_urls") or {}).get("desktop") or {}).get("page") or f"{base}/wiki/{quote(page['key'])}"
        return {"title": data.get("title") or page.get("title", ""), "extract": short, "url": url}
