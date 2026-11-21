"""Utilidades de texto em pt-BR (sem dependências)."""
from __future__ import annotations

import re
import unicodedata


def normalize(text: str) -> str:
    """minúsculas, sem acentos, espaços simples e sem pontuação nas pontas."""
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", t).strip(" !?.,;:\"'")


STOPWORDS = {"o", "a", "os", "as", "de", "do", "da", "dos", "das", "um", "uma", "e", "em", "no", "na", "meu", "minha"}


def tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9+#]+", normalize(text)) if w not in STOPWORDS}


def days_ago(now: float, ts: float | None) -> int | None:
    return None if not ts else int((now - ts) // 86400)


def join_pt(items: list[str]) -> str:
    """['a','b','c'] -> 'a, b e c'"""
    items = [i for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " e " + items[-1]
