"""Notificações: persistência, controle de frequência e entrega.

Dois tipos de origem:
  - "usuario": resposta ou algo que o usuário pediu (ex.: fim do foco). Nunca
    é limitada pela frequência; só não toca durante "não perturbe" se não for
    um pedido direto.
  - "espontanea": a Zoe decidiu falar sozinha. Passa por autonomia,
    horário silencioso, não perturbe, intervalo mínimo, teto por hora e dedupe.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
from dataclasses import dataclass, field
from datetime import datetime
from typing import Awaitable, Callable

from .config import AUTONOMY_LEVELS, FREQUENCIES
from .db import Database

log = logging.getLogger("zoe.notify")

ORIGIN_USER = "usuario"
ORIGIN_SPONTANEOUS = "espontanea"


@dataclass
class Notification:
    message: str
    category: str
    origin: str = ORIGIN_SPONTANEOUS
    expression: str | None = None
    actions: list[dict] = field(default_factory=list)   # [{id, label}]
    dedupe_key: str | None = None
    dedupe_window_s: int = 6 * 3600
    id: int | None = None
    status: str = "pendente"

    def to_dict(self) -> dict:
        return {
            "id": self.id, "message": self.message, "category": self.category, "origin": self.origin,
            "expression": self.expression, "actions": self.actions, "status": self.status,
        }


def _in_quiet_hours(now_local: datetime, start: str, end: str) -> bool:
    def mins(hhmm: str) -> int:
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)

    s, e, n = mins(start), mins(end), now_local.hour * 60 + now_local.minute
    if s == e:
        return False
    return s <= n < e if s < e else (n >= s or n < e)


class NotificationService:
    def __init__(self, db: Database, clock, local_now: Callable[[], datetime] | None = None):
        self.db = db
        self.clock = clock
        self.local_now = local_now or (lambda: datetime.fromtimestamp(self.clock()))
        self._deliver: Callable[[dict], Awaitable[int]] | None = None   # devolve nº de clientes que receberam
        self._native = NativeNotifier()

    def set_delivery(self, fn: Callable[[dict], Awaitable[int]]) -> None:
        self._deliver = fn

    # ---------------- regras ----------------
    def block_reason(self, n: Notification) -> str | None:
        """Motivo para NÃO entregar agora (None = pode entregar)."""
        s = self.db.get_settings()
        now = self.clock()
        if n.origin == ORIGIN_USER:
            return None
        if AUTONOMY_LEVELS.index(s["autonomia"]) < 1:
            return "autonomia: apenas observar"
        freq = FREQUENCIES.get(s["frequencia"], FREQUENCIES["normal"])
        if freq["max_per_hour"] == 0:
            return "frequencia: silenciosa"
        if s.get("nao_perturbe_ate", 0) > now:
            return "nao perturbe"
        if _in_quiet_hours(self.local_now(), s["silencio_inicio"], s["silencio_fim"]):
            return "horario silencioso"
        if n.dedupe_key:
            dup = self.db.query(
                "SELECT 1 FROM notifications WHERE dedupe_key = ? AND status != 'bloqueada' AND scheduled_at > ? LIMIT 1",
                (n.dedupe_key, now - n.dedupe_window_s),
            )
            if dup:
                return "repetida"
        recent = self.db.query(
            "SELECT scheduled_at FROM notifications WHERE origin = ? AND status IN ('entregue','lida','respondida','pendente') "
            "AND scheduled_at > ? ORDER BY scheduled_at DESC",
            (ORIGIN_SPONTANEOUS, now - 3600),
        )
        if len(recent) >= freq["max_per_hour"]:
            return "limite por hora"
        if recent and freq["min_gap_s"] and now - recent[0]["scheduled_at"] < freq["min_gap_s"]:
            return "intervalo minimo"
        return None

    # ---------------- envio ----------------
    async def send(self, n: Notification) -> tuple[bool, str | None]:
        reason = self.block_reason(n)
        status = "bloqueada" if reason else "pendente"
        cur = self.db.execute(
            "INSERT INTO notifications (user_id, message, category, origin, expression, actions, dedupe_key, scheduled_at, status) "
            "VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)",
            (n.message, n.category, n.origin, n.expression, json.dumps(n.actions, ensure_ascii=False),
             n.dedupe_key, self.clock(), status),
        )
        n.id, n.status = cur.lastrowid, status
        if reason:
            log.info("notificação bloqueada (%s): %s", reason, n.message)
            return False, reason
        delivered = await self._deliver({"type": "notification", "notification": n.to_dict()}) if self._deliver else 0
        if not delivered and self.db.get_settings().get("notificacoes_nativas"):
            delivered = int(self._native.show("Zoe", n.message))
        if delivered:
            self.db.execute("UPDATE notifications SET status = 'entregue', delivered_at = ? WHERE id = ?", (self.clock(), n.id))
            n.status = "entregue"
        return bool(delivered), None if delivered else "sem cliente conectado"

    def ack(self, notification_id: int, action: str | None) -> bool:
        status = "respondida" if action and action != "dismiss" else "lida"
        cur = self.db.execute("UPDATE notifications SET status = ? WHERE id = ?", (status, notification_id))
        return cur.rowcount > 0

    def history(self, limit: int = 50) -> list[dict]:
        rows = self.db.query("SELECT * FROM notifications ORDER BY scheduled_at DESC, id DESC LIMIT ?", (limit,))
        for r in rows:
            r["actions"] = json.loads(r["actions"])
        return rows


class NativeNotifier:
    """Fallback com notify-send (libnotify / D-Bus org.freedesktop.Notifications)."""

    def __init__(self) -> None:
        self.cmd = shutil.which("notify-send")

    def show(self, title: str, body: str) -> bool:
        if not self.cmd:
            return False
        try:
            subprocess.run([self.cmd, "--app-name=Zoe", title, body], timeout=3, check=False)
            return True
        except (OSError, subprocess.SubprocessError):
            return False
