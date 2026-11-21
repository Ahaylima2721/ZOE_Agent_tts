"""Base de conhecimento aprendida (nível 2 da cascata).

Ciclo:
  - toda resposta da IA entra como CANDIDATA (não é verdade ainda);
  - 👍 do usuário → VALIDADA; correção ("na verdade…") → VALIDADA com o texto do usuário;
  - pesquisa na web (opcional) → FONTE, sempre com título e link;
  - 👎 → REJEITADA (nunca mais é usada).
Só VALIDADA e FONTE respondem sozinhas. Perguntas sobre o usuário ou sobre coisas
que mudam (hora, hoje, PC…) nunca viram conhecimento.

Busca: FTS5 do SQLite (BM25, sem acentos) para achar candidatas e semelhança de
palavras (Jaccard) para decidir se a pergunta é a mesma. Sem FTS5, cai num
filtro por palavras em Python.
"""
from __future__ import annotations

import logging
import re
import sqlite3
from datetime import datetime

from ..db import Database
from ..text import normalize, tokens

log = logging.getLogger("zoe.learning")

USABLE = ("validada", "fonte")
# palavras que não dizem o ASSUNTO da pergunta
QUESTION_WORDS = {"qual", "quais", "quem", "que", "como", "onde", "quando", "porque", "por", "quanto", "quantos",
                  "quantas", "e", "eh", "foi", "sao", "era", "me", "fale", "fala", "sobre", "explique", "explica",
                  "conte", "conta", "voce", "sabe", "pode", "dizer", "diz", "isso", "ai", "zoe", "significa", "afinal"}
VOLATILE = re.compile(r"\b(hoje|agora|amanha|ontem|hora|horas|clima|previsao|cotacao|dolar|noticias?|ultim[oa]s?|"
                      r"semana|pc|computador|memoria|cpu|foco|lembra|lembrete)\b")
PERSONAL = re.compile(r"\b(eu|meu|minha|meus|minhas|mim|comigo|sou|estou|tenho|devo|posso|quero)\b")
MIN_SIMILARITY = 0.6


def topic(text: str) -> set[str]:
    return tokens(text) - QUESTION_WORDS


def similarity(a: str, b: str) -> float:
    ta, tb = topic(a), topic(b)
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


def cacheable(question: str) -> bool:
    """Vale guardar a resposta? Não para perguntas pessoais, voláteis ou sem assunto."""
    t = normalize(question)
    return len(topic(question)) >= 1 and not VOLATILE.search(t) and not PERSONAL.search(t) and len(t) <= 300


class KnowledgeBase:
    def __init__(self, db: Database, clock):
        self.db, self.clock = db, clock
        self.fts = self._ensure_fts()

    def _ensure_fts(self) -> bool:
        try:
            with self.db._lock:
                self.db.conn.executescript("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
                        question, answer, content='knowledge', content_rowid='id',
                        tokenize='unicode61 remove_diacritics 2');
                    CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
                        INSERT INTO knowledge_fts(rowid, question, answer) VALUES (new.id, new.question, new.answer);
                    END;
                    CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
                        INSERT INTO knowledge_fts(knowledge_fts, rowid, question, answer) VALUES ('delete', old.id, old.question, old.answer);
                    END;
                    CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE OF question, answer ON knowledge BEGIN
                        INSERT INTO knowledge_fts(knowledge_fts, rowid, question, answer) VALUES ('delete', old.id, old.question, old.answer);
                        INSERT INTO knowledge_fts(rowid, question, answer) VALUES (new.id, new.question, new.answer);
                    END;
                """)
            return True
        except sqlite3.OperationalError as e:            # SQLite compilado sem FTS5
            log.warning("FTS5 indisponível (%s); usando busca simples", e)
            return False

    # ---------------- escrita ----------------
    def add(self, question: str, answer: str, source: str, status: str, *, title: str = "", url: str = "",
            interaction_id: int | None = None) -> int:
        now = self.clock()
        cur = self.db.execute(
            "INSERT INTO knowledge (user_id, question, question_norm, answer, source, status, title, url, interaction_id, created_at) "
            "VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (question.strip()[:300], normalize(question), answer.strip()[:1200], source, status, title[:200], url[:500],
             interaction_id, now))
        return cur.lastrowid

    def set_status(self, kid: int, status: str) -> bool:
        return self.db.execute("UPDATE knowledge SET status = ? WHERE id = ?", (status, kid)).rowcount > 0

    def delete(self, kid: int) -> bool:
        return self.db.execute("DELETE FROM knowledge WHERE id = ?", (kid,)).rowcount > 0

    def by_interaction(self, interaction_id: int) -> dict | None:
        rows = self.db.query("SELECT * FROM knowledge WHERE interaction_id = ? ORDER BY id DESC LIMIT 1", (interaction_id,))
        return rows[0] if rows else None

    def get(self, kid: int) -> dict | None:
        rows = self.db.query("SELECT * FROM knowledge WHERE id = ?", (kid,))
        return rows[0] if rows else None

    def correct(self, question: str, answer: str) -> int:
        """O usuário corrigiu: a correção vale mais que qualquer resposta guardada antes para essa pergunta."""
        for row in self.search(question, statuses=("candidata", "validada", "fonte"), limit=10):
            if similarity(row["question"], question) >= MIN_SIMILARITY:
                self.set_status(row["id"], "rejeitada")
        return self.add(question, answer, "correcao", "validada")

    def mark_used(self, kid: int) -> None:
        self.db.execute("UPDATE knowledge SET uses = uses + 1, last_used = ? WHERE id = ?", (self.clock(), kid))

    # ---------------- busca ----------------
    def search(self, text: str, statuses=USABLE, limit: int = 8) -> list[dict]:
        words = sorted(topic(text))
        if not words:
            return []
        marks = ",".join("?" * len(statuses))
        if self.fts:
            q = " OR ".join(f'"{w}"' for w in words)
            return self.db.query(
                f"SELECT k.* FROM knowledge_fts f JOIN knowledge k ON k.id = f.rowid "
                f"WHERE knowledge_fts MATCH ? AND k.status IN ({marks}) ORDER BY bm25(knowledge_fts) LIMIT ?",
                (q, *statuses, limit))
        rows = self.db.query(f"SELECT * FROM knowledge WHERE status IN ({marks}) ORDER BY id DESC LIMIT 500", statuses)
        ws = set(words)
        return [r for r in rows if topic(r["question"] + " " + r["answer"]) & ws][:limit]

    def lookup(self, question: str) -> dict | None:
        """Melhor resposta confirmada para a MESMA pergunta (não só o mesmo assunto)."""
        if not cacheable(question):
            return None
        best, best_sim = None, 0.0
        for row in self.search(question):
            sim = similarity(row["question"], question)
            # correção do usuário > fonte com link > resposta validada; desempate por semelhança
            rank = sim + {"correcao": 0.02, "web": 0.01}.get(row["source"], 0)
            if sim >= MIN_SIMILARITY and rank > best_sim:
                best, best_sim = row, rank
        return best

    def related(self, question: str, k: int = 3) -> list[dict]:
        """Conhecimento confirmado sobre o mesmo assunto, para dar contexto à IA (nível 4)."""
        return [r for r in self.search(question, limit=k * 2) if topic(r["question"] + " " + r["title"]) & topic(question)][:k]

    def list(self, limit: int = 200) -> list[dict]:
        return self.db.query("SELECT * FROM knowledge WHERE status != 'rejeitada' ORDER BY COALESCE(last_used, created_at) DESC LIMIT ?",
                             (limit,))

    def pending_research(self, limit: int) -> list[dict]:
        """Respostas da IA ainda não conferidas numa fonte (as com 👎 primeiro)."""
        return self.db.query(
            "SELECT * FROM knowledge WHERE source = 'ia' AND researched_at IS NULL AND status IN ('candidata', 'rejeitada') "
            "ORDER BY (status = 'rejeitada') DESC, id DESC LIMIT ?", (limit,))

    def mark_researched(self, kid: int) -> None:
        self.db.execute("UPDATE knowledge SET researched_at = ? WHERE id = ?", (self.clock(), kid))

    # ---------------- como citar ----------------
    @staticmethod
    def source_of(row: dict) -> dict:
        when = datetime.fromtimestamp(row["created_at"]).strftime("%d/%m")
        if row["source"] == "web":
            return {"label": f"Fonte: Wikipédia · {row['title']}", "url": row["url"]}
        if row["source"] == "correcao":
            return {"label": f"Você me ensinou em {when}", "url": ""}
        return {"label": f"Lembrei da nossa conversa de {when}", "url": ""}
