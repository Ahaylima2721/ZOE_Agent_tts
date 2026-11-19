"""Sessões de concentração (foco) com temporizador assíncrono."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass

from .events import Event, EventBus, EventType


@dataclass
class FocusSession:
    minutes: float
    started_at: float
    ends_at: float

    def to_dict(self, now: float) -> dict:
        return {"minutes": self.minutes, "started_at": self.started_at, "ends_at": self.ends_at,
                "remaining_s": max(0, round(self.ends_at - now))}


class FocusManager:
    MAX_MINUTES = 240

    def __init__(self, bus: EventBus, clock):
        self.bus, self.clock = bus, clock
        self.session: FocusSession | None = None
        self._task: asyncio.Task | None = None

    def status(self) -> dict | None:
        return self.session.to_dict(self.clock()) if self.session else None

    async def start(self, minutes: float) -> FocusSession:
        if not (0 < minutes <= self.MAX_MINUTES):
            raise ValueError(f"duração deve estar entre 1 e {self.MAX_MINUTES} minutos")
        if self.session:
            await self.stop(reason="substituida")
        now = self.clock()
        self.session = FocusSession(minutes, now, now + minutes * 60)
        self._task = asyncio.create_task(self._run(self.session))
        await self.bus.publish(Event(EventType.FOCUS_SESSION_STARTED, {"minutes": minutes}))
        return self.session

    async def _run(self, s: FocusSession) -> None:
        await asyncio.sleep(max(0.0, s.ends_at - self.clock()))
        if self.session is s:
            self.session, self._task = None, None
            await self.bus.publish(Event(EventType.FOCUS_SESSION_ENDED, {"minutes": s.minutes, "completed": True}))

    async def stop(self, reason: str = "cancelada") -> bool:
        s, t = self.session, self._task
        if not s:
            return False
        self.session, self._task = None, None
        if t and not t.done():
            t.cancel()
        elapsed = (self.clock() - s.started_at) / 60
        await self.bus.publish(Event(EventType.FOCUS_SESSION_ENDED, {
            "minutes": s.minutes, "completed": False, "reason": reason, "elapsed_min": round(elapsed, 1)}))
        return True
