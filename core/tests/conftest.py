import sys
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from zoe_core.core import ZoeCore  # noqa: E402
from zoe_core.db import Database  # noqa: E402

# 2026-11-19 15:00 local: fora do horário silencioso padrão
NOON = datetime(2026, 11, 19, 15, 0).timestamp()


class FakeClock:
    def __init__(self, t: float = NOON):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def db(clock):
    d = Database(":memory:", clock=clock)
    # IA aponta para uma porta fechada: testes determinísticos mesmo se houver um Ollama na máquina
    d.update_settings({"notificacoes_nativas": False, "ia_url": "http://127.0.0.1:9"})
    yield d
    d.close()


@pytest.fixture
def core(db, clock):
    return ZoeCore(db, clock=clock, enable_pc=False)


class Sink:
    """Cliente falso: recebe o que seria enviado pelo WebSocket."""

    def __init__(self):
        self.messages = []

    async def __call__(self, msg):
        self.messages.append(msg)
        return 1

    def of(self, kind):
        return [m for m in self.messages if m["type"] == kind]


@pytest.fixture
def sink(core):
    s = Sink()
    core.notifications.set_delivery(s)
    core.decision.broadcast = s
    return s
