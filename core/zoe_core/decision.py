"""Camada de decisão (seção 9).

Para cada evento escolhe UMA ação: ignorar, aguardar, mudar expressão,
notificar, conversar, consultar a LLM ou executar uma ação. Regras simples
rodam aqui mesmo; a LLM (Fase 5) só entra quando uma regra pedir
"consultar_llm". Toda decisão fica registrada na tabela events.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Awaitable, Callable

from .db import Database
from .events import Event, EventBus, EventType
from .notifications import ORIGIN_SPONTANEOUS, ORIGIN_USER, Notification, NotificationService

log = logging.getLogger("zoe.decision")

ACTIONS = ("ignorar", "aguardar", "expressao", "notificar", "conversar", "consultar_llm", "executar")

# Expressões da orbe (seção 2.1).
EXPRESSIONS = ("normal", "pensando", "curiosa", "feliz", "preocupada", "foco", "descanso", "alerta")


@dataclass
class Decision:
    action: str
    reason: str = ""
    expression: str | None = None
    expression_ttl_ms: int = 0           # 0 = fica até a próxima mudança
    notification: Notification | None = None

    def summary(self) -> str:
        return f"{self.action}: {self.reason}" if self.reason else self.action


Rule = Callable[[Event, dict, "DecisionEngine"], Decision]


class DecisionEngine:
    def __init__(self, bus: EventBus, db: Database, notifications: NotificationService,
                 broadcast: Callable[[dict], Awaitable[int]]):
        self.db, self.notifications, self.broadcast = db, notifications, broadcast
        self.rules: dict[EventType, Rule] = dict(DEFAULT_RULES)
        self.idle_since: float | None = None
        self.base_expression = "normal"      # expressão "de fundo" (foco, descanso)
        self.focus_active = False
        self.last: list[tuple[str, Decision]] = []
        bus.subscribe(self.handle)

    def decide(self, event: Event) -> Decision:
        settings = self.db.get_settings()
        rule = self.rules.get(event.type)
        if not rule:
            return Decision("aguardar", "sem regra para este evento ainda")
        return rule(event, settings, self)

    async def handle(self, event: Event) -> Decision:
        d = self.decide(event)
        self.db.log_event(event.type.value, event.source, event.payload, d.summary(), event.timestamp)
        self.last = (self.last + [(event.type.value, d)])[-50:]
        if d.expression:
            if d.expression_ttl_ms == 0:
                self.base_expression = d.expression
            await self.broadcast({"type": "expression", "name": d.expression, "ttl_ms": d.expression_ttl_ms})
        if d.action == "notificar" and d.notification:
            await self.notifications.send(d.notification)
        return d


# ---------------- regras padrão ----------------
def _focus_started(e: Event, s: dict, eng: DecisionEngine) -> Decision:
    eng.focus_active = True
    return Decision("expressao", "sessão de foco iniciada", expression="foco")


def _focus_ended(e: Event, s: dict, eng: DecisionEngine) -> Decision:
    eng.focus_active = False
    if not e.payload.get("completed"):
        return Decision("expressao", "foco encerrado antes do fim", expression="normal")
    mins = e.payload.get("minutes", 0)
    dur = f"{round(mins * 60)} segundos" if mins < 1 else (f"{mins:g} minuto" if mins == 1 else f"{mins:g} minutos")
    n = Notification(
        message=f"Pronto! {dur} de foco concluídos. Que tal uma pausa de 5 minutos?",
        category="foco", origin=ORIGIN_USER, expression="feliz",
        actions=[{"id": "foco_novamente", "label": "Mais uma sessão"}, {"id": "dismiss", "label": "Pausa"}],
    )
    return Decision("notificar", "foco concluído", expression="normal", notification=n)


def _user_idle(e: Event, s: dict, eng: DecisionEngine) -> Decision:
    if not s["monitoramento_ativo"]:
        return Decision("ignorar", "monitoramento pausado")
    eng.idle_since = e.timestamp - float(e.payload.get("idle_s", 0))
    if eng.focus_active:
        return Decision("aguardar", "ocioso durante o foco")
    return Decision("expressao", "usuário ausente", expression="descanso")


def _user_returned(e: Event, s: dict, eng: DecisionEngine) -> Decision:
    since, eng.idle_since = eng.idle_since, None
    if not s["monitoramento_ativo"]:
        return Decision("ignorar", "monitoramento pausado")
    expr = "foco" if eng.focus_active else "normal"
    away_min = (e.timestamp - since) / 60 if since else 0
    if since and away_min >= 30 and not eng.focus_active:
        nome = s.get("nome_usuario") or ""
        n = Notification(
            message=f"Oi de novo{', ' + nome if nome else ''}! Você ficou uns {int(away_min)} minutos fora.",
            category="presenca", origin=ORIGIN_SPONTANEOUS, expression="feliz",
            dedupe_key="boas_vindas", dedupe_window_s=2 * 3600,
        )
        return Decision("notificar", "voltou após ausência longa", expression=expr, notification=n)
    return Decision("expressao", "usuário voltou", expression=expr)


def _emergency(e: Event, s: dict, eng: DecisionEngine) -> Decision:
    n = Notification(
        message="Parei todo o monitoramento e as intervenções. Quando quiser, é só retomar nas configurações.",
        category="controle", origin=ORIGIN_USER, expression="alerta",
    )
    return Decision("notificar", "botão de emergência", expression="normal", notification=n)


def _resumed(e: Event, s: dict, eng: DecisionEngine) -> Decision:
    return Decision("expressao", "monitoramento retomado", expression="feliz", expression_ttl_ms=1600)


def _user_request(e: Event, s: dict, eng: DecisionEngine) -> Decision:
    return Decision("conversar", "respondido pelo chat")


# ---------------- PC Companion ----------------
# janela do dedupe de cada alerta: não repetir o mesmo assunto antes disso
PC_DEDUPE_S = {"ram_alta": 3600, "cpu_alta": 3600, "disco_cheio": 24 * 3600,
               "temperatura_alta": 1800, "bateria_baixa": 1800}
PC_ACTIONS = {
    "ram_alta": [{"id": "ver_processos", "label": "Ver processos"}, {"id": "dismiss", "label": "Agora não"}],
    "cpu_alta": [{"id": "ver_processos", "label": "Ver processos"}, {"id": "dismiss", "label": "Agora não"}],
    "disco_cheio": [{"id": "ver_recursos", "label": "Ver discos"}, {"id": "dismiss", "label": "Depois"}],
    "temperatura_alta": [{"id": "ver_processos", "label": "Ver o que está pesando"}, {"id": "dismiss", "label": "Ok"}],
    "bateria_baixa": [{"id": "dismiss", "label": "Ok"}],
}


def _pc_alert(e: Event, s: dict, eng: DecisionEngine) -> Decision:
    f = e.payload
    kind = f.get("kind", "")
    if not s["pc_alertas"]:
        return Decision("ignorar", "alertas do PC desligados")
    if eng.focus_active and f.get("severity") != "critical":
        return Decision("aguardar", "não interrompe o foco por isso")
    critical = f.get("severity") == "critical"
    n = Notification(
        message=f"{f.get('message', '')} {f.get('suggestion', '')}".strip(),
        category="pc", origin=ORIGIN_SPONTANEOUS, expression="alerta" if critical else "preocupada",
        actions=PC_ACTIONS.get(kind, []), dedupe_key=f"pc:{kind}",
        dedupe_window_s=PC_DEDUPE_S.get(kind, 3600), urgent=critical,
    )
    return Decision("notificar", f.get("title", kind), notification=n)


# ---------------- Companion: lembrete a partir da memória ----------------
def _memory_checkin(e: Event, s: dict, eng: DecisionEngine) -> Decision:
    p = e.payload
    if not s.get("checkins_memoria", True):
        return Decision("ignorar", "lembretes da memória desligados")
    if eng.focus_active or eng.idle_since is not None:
        return Decision("aguardar", "usuário em foco ou ausente")
    n = Notification(
        message=p["message"], category="memoria", origin=ORIGIN_SPONTANEOUS, expression="curiosa",
        actions=[{"id": f"mem_responder:{p['tipo']}:{p['id']}", "label": "Responder"},
                 {"id": f"mem_adiar:{p['tipo']}:{p['id']}", "label": "Agora não"}],
        dedupe_key=p["dedupe_key"], dedupe_window_s=3 * 86400,
    )
    return Decision("notificar", f"lembrete: {p.get('nome', '')}", notification=n)


DEFAULT_RULES: dict[EventType, Rule] = {
    EventType.FOCUS_SESSION_STARTED: _focus_started,
    EventType.FOCUS_SESSION_ENDED: _focus_ended,
    EventType.USER_IDLE: _user_idle,
    EventType.USER_RETURNED: _user_returned,
    EventType.EMERGENCY_STOP: _emergency,
    EventType.MONITORING_RESUMED: _resumed,
    EventType.USER_REQUEST: _user_request,
    EventType.HIGH_MEMORY_USAGE: _pc_alert,
    EventType.CPU_OVERLOAD: _pc_alert,
    EventType.DISK_SPACE_LOW: _pc_alert,
    EventType.HIGH_TEMPERATURE: _pc_alert,
    EventType.BATTERY_LOW: _pc_alert,
    EventType.MEMORY_CHECKIN: _memory_checkin,
}
