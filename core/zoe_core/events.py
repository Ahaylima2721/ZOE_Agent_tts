"""Mecanismo central de eventos (seção 9).

Todo módulo publica eventos no EventBus; o DecisionEngine é o assinante
principal e decide o que fazer com cada um.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Awaitable, Callable

log = logging.getLogger("zoe.events")


class EventType(str, Enum):
    # Guardian
    APP_USAGE_LIMIT_REACHED = "APP_USAGE_LIMIT_REACHED"
    # PC Companion
    HIGH_MEMORY_USAGE = "HIGH_MEMORY_USAGE"
    CPU_OVERLOAD = "CPU_OVERLOAD"
    # Foco
    FOCUS_SESSION_STARTED = "FOCUS_SESSION_STARTED"
    FOCUS_SESSION_ENDED = "FOCUS_SESSION_ENDED"
    # Presença do usuário (vem do desktop: tempo ocioso do sistema)
    USER_IDLE = "USER_IDLE"
    USER_RETURNED = "USER_RETURNED"
    # Companion
    TASK_OVERDUE = "TASK_OVERDUE"
    NEW_DISCOVERY = "NEW_DISCOVERY"
    # Pedido explícito do usuário (chat, botão)
    USER_REQUEST = "USER_REQUEST"
    # Controle
    EMERGENCY_STOP = "EMERGENCY_STOP"
    MONITORING_RESUMED = "MONITORING_RESUMED"


# Eventos que a interface (cliente da API) pode publicar diretamente.
CLIENT_EVENTS = frozenset({EventType.USER_IDLE, EventType.USER_RETURNED, EventType.USER_REQUEST})


@dataclass
class Event:
    type: EventType
    payload: dict = field(default_factory=dict)
    source: str = "core"
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {"type": self.type.value, "payload": self.payload, "source": self.source, "timestamp": self.timestamp}


Handler = Callable[[Event], Awaitable[None] | None]


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[EventType | None, list[Handler]] = {}

    def subscribe(self, handler: Handler, *types: EventType) -> None:
        """Assina tipos específicos; sem tipos, recebe todos."""
        for t in types or (None,):
            self._subs.setdefault(t, []).append(handler)

    async def publish(self, event: Event) -> None:
        handlers = self._subs.get(event.type, []) + self._subs.get(None, [])
        for h in handlers:
            try:
                res = h(event)
                if asyncio.iscoroutine(res):
                    await res
            except Exception:  # um assinante com erro não derruba os outros
                log.exception("erro tratando %s em %r", event.type.value, h)
