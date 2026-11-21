"""Tarefas do dia a dia (cartão "Hoje" e página Tarefas)."""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from .db import Database
from .focus import CATEGORIES

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class TaskStore:
    def __init__(self, db: Database, clock):
        self.db, self.clock = db, clock

    def today(self) -> date:
        return datetime.fromtimestamp(self.clock()).date()

    @staticmethod
    def _out(r: dict) -> dict:
        return {"id": r["id"], "titulo": r["title"], "categoria": r["category"], "para": r["due_date"],
                "concluida": r["status"] == "concluida", "concluida_em": r["completed_at"], "criada_em": r["created_at"]}

    def _clean(self, data: dict, partial: bool) -> dict:
        out = {}
        if "titulo" in data or not partial:
            t = data.get("titulo")
            if not isinstance(t, str) or not t.strip() or len(t.strip()) > 160:
                raise ValueError("titulo: texto de 1 a 160 caracteres")
            out["title"] = t.strip()
        if "categoria" in data:
            if data["categoria"] not in CATEGORIES:
                raise ValueError("categoria: " + ", ".join(CATEGORIES))
            out["category"] = data["categoria"]
        if "para" in data:
            d = data["para"]
            if d is not None and (not isinstance(d, str) or not DATE_RE.match(d)):
                raise ValueError("para: data AAAA-MM-DD ou null")
            out["due_date"] = d
        if "concluida" in data:
            if not isinstance(data["concluida"], bool):
                raise ValueError("concluida: verdadeiro ou falso")
            out["status"] = "concluida" if data["concluida"] else "pendente"
            out["completed_at"] = self.clock() if data["concluida"] else None
        return out

    def create(self, data: dict) -> dict:
        cols = self._clean(data, partial=False)
        cols.setdefault("category", "geral")
        cols.setdefault("due_date", self.today().isoformat())        # sem data: é para hoje
        cols.update(user_id=1, created_at=self.clock(), status=cols.get("status", "pendente"))
        cur = self.db.execute(f"INSERT INTO tasks ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", list(cols.values()))
        return self.get(cur.lastrowid)

    def get(self, tid: int) -> dict | None:
        rows = self.db.query("SELECT * FROM tasks WHERE id = ?", (tid,))
        return self._out(rows[0]) if rows else None

    def update(self, tid: int, data: dict) -> dict:
        if not self.get(tid):
            raise LookupError("tarefa não encontrada")
        cols = self._clean(data, partial=True)
        if cols:
            self.db.execute(f"UPDATE tasks SET {', '.join(f'{c} = ?' for c in cols)} WHERE id = ?", [*cols.values(), tid])
        return self.get(tid)

    def delete(self, tid: int) -> bool:
        return self.db.execute("DELETE FROM tasks WHERE id = ?", (tid,)).rowcount > 0

    def list(self, scope: str = "todas") -> list[dict]:
        today = self.today()
        start = datetime.combine(today, datetime.min.time()).timestamp()
        if scope == "hoje":
            # pendentes até hoje (inclusive atrasadas) + concluídas hoje
            rows = self.db.query(
                "SELECT * FROM tasks WHERE (status != 'concluida' AND (due_date IS NULL OR due_date <= ?)) "
                "OR (status = 'concluida' AND completed_at >= ?) ORDER BY status = 'concluida' DESC, COALESCE(completed_at, created_at)",
                (today.isoformat(), start))
        else:
            rows = self.db.query("SELECT * FROM tasks ORDER BY status = 'concluida', COALESCE(due_date, '9999'), created_at DESC LIMIT 500")
        return [self._out(r) for r in rows]

    def find_open(self, text: str) -> list[dict]:
        from .text import normalize
        q = normalize(text)
        return [t for t in self.list("todas") if not t["concluida"] and q and q in normalize(t["titulo"])]

    def done_on(self, day: date) -> int:
        a = datetime.combine(day, datetime.min.time()).timestamp()
        b = a + 86400
        return self.db.query("SELECT COUNT(*) AS n FROM tasks WHERE status = 'concluida' AND completed_at >= ? AND completed_at < ?",
                             (a, b))[0]["n"]

    def next_due(self) -> dict | None:
        rows = self.db.query("SELECT * FROM tasks WHERE status != 'concluida' AND due_date > ? ORDER BY due_date LIMIT 1",
                             (self.today().isoformat(),))
        return self._out(rows[0]) if rows else None


def weekday_pt(d: date) -> str:
    return ("Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom")[d.weekday()]


def days_back(today: date, n: int) -> list[date]:
    return [today - timedelta(days=i) for i in range(n - 1, -1, -1)]
