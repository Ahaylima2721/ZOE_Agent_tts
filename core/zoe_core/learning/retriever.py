"""Recuperação para a cascata (R1): palavras (FTS5/BM25) + significado (embeddings).

- `lookup`: resposta DIRETA da base, sem IA. Primeiro a comparação estrita por palavras (como antes);
  depois por significado, só acima do limiar `direto` calibrado e com os mesmos nomes próprios.
- `related_knowledge` / `relevant_memory`: trechos para a IA (RAG), acima do limiar `contexto`.
Sem embeddings prontos, tudo continua funcionando só com palavras.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from ..ai.ollama import OllamaError
from .knowledge import USABLE, cacheable
from .semantic import SemanticIndex, same_entities

if TYPE_CHECKING:
    from ..core import ZoeCore

log = logging.getLogger("zoe.retriever")


class Retriever:
    def __init__(self, core: "ZoeCore"):
        self.core = core
        self.semantic = SemanticIndex(core)

    async def _hits(self, question: str, prefix: str, k: int) -> list[tuple[float, str, int]]:
        if not await self.semantic.ready():
            return []
        try:
            return await self.semantic.nearest(question, prefix, k)
        except OllamaError as e:
            log.info("busca por significado indisponível: %s", e)
            self.semantic.invalidate()
            return []

    async def lookup(self, question: str) -> tuple[dict, dict] | None:
        """(linha da base, {"via", "score"?}) ou None."""
        if not cacheable(question):
            return None
        row = self.core.knowledge.lookup(question)
        if row:
            return row, {"via": "palavras"}
        hits = await self._hits(question, "kq", 5)    # antes dos limiares: a 1ª busca pode calibrar o modelo
        th = self.semantic.thresholds()
        for score, _, rid in hits:
            if not th or score < th["direto"]:
                break
            row = self.core.knowledge.get(rid)
            if row and row["status"] in USABLE and same_entities(question, row["question"]):
                return row, {"via": "significado", "score": score}
        return None

    async def related_knowledge(self, question: str, k: int = 3) -> list[dict]:
        out = {r["id"]: r for r in self.core.knowledge.related(question, k)}
        hits = await self._hits(question, "kq", k * 2)
        th = self.semantic.thresholds()
        for score, _, rid in hits:
            if th and score >= th["contexto"] and rid not in out and len(out) < k:
                row = self.core.knowledge.get(rid)
                if row and row["status"] in USABLE:
                    out[rid] = row
        return list(out.values())[:k]

    async def relevant_memory(self, question: str, k: int = 6) -> list[dict] | None:
        """Itens da memória relacionados por significado; None = use a comparação por palavras."""
        hits = await self._hits(question, "mem:", k)
        th = self.semantic.thresholds()
        if not hits or not th:
            return None
        items = []
        for score, kind, rid in hits:
            if score >= th["contexto"]:
                it = self.core.memory.get(kind.split(":", 1)[1], rid)
                if it:
                    items.append(it)
        return items
