"""Conversas espontâneas a partir da memória (seção 3.3, versão por regras).

Escolhe no máximo UM assunto parado há algum tempo e monta uma pergunta com o
que foi guardado ("Da última vez você estava no capítulo 5"). O evento passa
pela camada de decisão e pelas regras de notificação como qualquer outro.
Com a LLM (Fase 5), a pergunta poderá ser mais natural; os dados continuam
vindo só da memória.
"""
from __future__ import annotations

import random

from ..text import days_ago, normalize
from .memory import KINDS, Memory

# tipo -> (dias parado para perguntar, filtro do item)
RULES = {
    "livro": (3, lambda i: i["status"] == "lendo"),
    "projeto": (7, lambda i: i["status"] == "ativo"),
    "aprender": (5, lambda i: True),
    "hobby": (14, lambda i: True),
    "objetivo": (14, lambda i: i["status"] == "ativo"),
}
ASK_AGAIN_AFTER_S = 3 * 86400   # mesmo assunto: no máximo a cada 3 dias


def message(item: dict, days: int, tone: str = "equilibrado") -> str:
    k, name = item["tipo"], item[KINDS[item["tipo"]].name_field]
    direto = tone == "direto"
    if k == "livro":
        if item.get("capitulo"):
            return (f"E {name}? Ainda no capítulo {item['capitulo']}?" if direto else
                    f"Você conseguiu avançar em {name}? Da última vez você estava no capítulo {item['capitulo']}.")
        return f"Como está a leitura de {name}?" if direto else f"Já terminou {name}? Faz {days} dias que a gente não fala dele."
    if k == "projeto":
        return f"Novidades no projeto {name}?" if direto else f"Como está aquele projeto, {name}? Faz {days} dias que você não comenta."
    if k == "aprender":
        return f"Avançou em {name}?" if direto else f"Você conseguiu avançar nos estudos de {name}?"
    if k == "hobby":
        return f"Tem feito {name}?" if direto else f"Faz tempo que você não fala de {name}. Tem conseguido?"
    return f"E o objetivo \"{name}\"?" if direto else f"Como você está indo com o objetivo \"{name}\"?"


def candidates(memory: Memory, now: float, avoid: list[str], asked: set[str]) -> list[tuple[int, dict]]:
    avoid_n = [normalize(a) for a in avoid if a.strip()]
    out = []
    for kind, (min_days, ok) in RULES.items():
        for it in memory.list(kind):
            name = normalize(it[KINDS[kind].name_field] or "")
            if not ok(it) or any(a in name for a in avoid_n) or f"memoria:{kind}:{it['id']}" in asked:
                continue
            d = days_ago(now, it["atualizado_em"])
            if d is not None and d >= min_days:
                out.append((d - min_days, it))
    return out


def pick(memory: Memory, now: float, settings: dict, asked: set[str], rng=random) -> dict | None:
    """O assunto mais "atrasado" (com um pouco de sorte entre os empatados)."""
    cands = candidates(memory, now, settings.get("assuntos_evitar") or [], asked)
    if not cands:
        return None
    top = max(c[0] for c in cands)
    it = rng.choice([c[1] for c in cands if c[0] >= top - 2])
    days = days_ago(now, it["atualizado_em"]) or 0
    return {"tipo": it["tipo"], "id": it["id"], "nome": it[KINDS[it["tipo"]].name_field],
            "message": message(it, days, settings.get("tom", "equilibrado")),
            "dedupe_key": f"memoria:{it['tipo']}:{it['id']}"}
