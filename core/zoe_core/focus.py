"""Sessões de concentração (foco): temporizador com pausa, categoria e histórico.

Cada sessão vira uma linha em focus_sessions (tempo realmente focado, sem as
pausas). É daí que saem os gráficos de produtividade e de tempo por categoria.
"""
from __future__ import annotations

import asyncio
import sqlite3
from dataclasses import dataclass, field

from .events import Event, EventBus, EventType

CATEGORIES = ("estudo", "trabalho", "lazer", "geral")


@dataclass
class FocusSession:
    minutes: float
    started_at: float
    ends_at: float
    category: str = "geral"
    paused_at: float | None = None       # quando foi pausada (None = correndo)
    paused_s: float = 0.0                # total de segundos em pausa
    row_id: int | None = None
    extra: dict = field(default_factory=dict)

    def remaining(self, now: float) -> float:
        ref = self.paused_at if self.paused_at is not None else now
        return max(0.0, self.ends_at - ref)

    def focused_s(self, now: float) -> float:
        ref = self.paused_at if self.paused_at is not None else now
        return max(0.0, ref - self.started_at - self.paused_s)

    def to_dict(self, now: float) -> dict:
        return {"minutes": self.minutes, "category": self.category, "started_at": self.started_at,
                "ends_at": self.ends_at, "remaining_s": round(self.remaining(now)), "paused": self.paused_at is not None,
                "focused_s": round(self.focused_s(now))}


class FocusManager:
    MAX_MINUTES = 240

    def __init__(self, bus: EventBus, clock, db=None):
        self.bus, self.clock, self.db = bus, clock, db
        self.session: FocusSession | None = None
        self._task: asyncio.Task | None = None

    def status(self) -> dict | None:
        return self.session.to_dict(self.clock()) if self.session else None

    async def start(self, minutes: float, category: str = "geral") -> FocusSession:
        if not (0 < minutes <= self.MAX_MINUTES):
            raise ValueError(f"duração deve estar entre 1 e {self.MAX_MINUTES} minutos")
        if category not in CATEGORIES:
            raise ValueError("categoria deve ser: " + ", ".join(CATEGORIES))
        if self.session:
            await self.stop(reason="substituida")
        now = self.clock()
        s = FocusSession(minutes, now, now + minutes * 60, category)
        if self.db:
            s.row_id = self.db.execute(
                "INSERT INTO focus_sessions (user_id, category, planned_min, focused_s, started_at, completed) VALUES (1, ?, ?, 0, ?, 0)",
                (category, minutes, now)).lastrowid
        self.session = s
        self._arm(s)
        await self.bus.publish(Event(EventType.FOCUS_SESSION_STARTED, {"minutes": minutes, "category": category}))
        return s

    def _arm(self, s: FocusSession) -> None:
        self._task = asyncio.create_task(self._run(s))

    async def _run(self, s: FocusSession) -> None:
        await asyncio.sleep(s.remaining(self.clock()))
        if self.session is s and s.paused_at is None:
            await self._finish(s, completed=True)

    async def pause(self) -> bool:
        s = self.session
        if not s or s.paused_at is not None:
            return False
        s.paused_at = self.clock()
        if self._task and not self._task.done():
            self._task.cancel()
        return True

    async def resume(self) -> bool:
        s = self.session
        if not s or s.paused_at is None:
            return False
        now = self.clock()
        gap = now - s.paused_at
        s.paused_s += gap
        s.ends_at += gap
        s.paused_at = None
        self._arm(s)
        return True

    async def stop(self, reason: str = "cancelada") -> bool:
        s = self.session
        if not s:
            return False
        if self._task and not self._task.done():
            self._task.cancel()
        await self._finish(s, completed=False, reason=reason)
        return True

    async def _finish(self, s: FocusSession, completed: bool, reason: str | None = None) -> None:
        now = self.clock()
        focused = s.focused_s(now)
        self.session, self._task = None, None
        if self.db and s.row_id:
            try:
                self.db.execute("UPDATE focus_sessions SET focused_s = ?, ended_at = ?, completed = ? WHERE id = ?",
                                (round(focused), now, int(completed), s.row_id))
            except sqlite3.ProgrammingError:        # banco já fechado (encerramento): nada a gravar
                pass
        payload = {"minutes": s.minutes, "completed": completed, "category": s.category,
                   "focused_min": round(focused / 60, 1)}
        if not completed:
            payload.update(reason=reason, elapsed_min=round(focused / 60, 1))
        await self.bus.publish(Event(EventType.FOCUS_SESSION_ENDED, payload))
