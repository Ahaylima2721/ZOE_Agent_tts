"""ZOE CORE: liga banco, eventos, decisões, notificações, foco e clientes."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from .ai.engine import AIEngine
from .chat import ChatHandler
from .companion import checkins
from .companion.memory import Memory
from .learning.knowledge import KnowledgeBase
from .learning.research import Researcher
from .db import Database
from .decision import DecisionEngine
from .events import Event, EventBus, EventType
from .focus import FocusManager
from .notifications import NotificationService

log = logging.getLogger("zoe.core")

PSUTIL_MISSING = ("Para eu acompanhar o computador, falta a biblioteca psutil. "
                  "Instale com: sudo apt install python3-psutil")


class ClientHub:
    """Clientes WebSocket conectados (orbe, painéis)."""

    def __init__(self) -> None:
        self.clients: set[Any] = set()

    async def broadcast(self, msg: dict) -> int:
        data = json.dumps(msg, ensure_ascii=False)
        sent = 0
        for ws in list(self.clients):
            try:
                await ws.send_str(data)
                sent += 1
            except Exception:
                self.clients.discard(ws)
        return sent


class ZoeCore:
    RETENTION_EVERY_S = 6 * 3600
    CHECKIN_EVERY_S = 20 * 60
    CHECKIN_MIN_GAP_S = 4 * 3600     # no máximo um lembrete da memória a cada 4 h

    def __init__(self, db: Database, clock=time.time, enable_pc: bool = True, pc_collector=None):
        self.db, self.clock = db, clock
        self.started_at = clock()
        self.bus = EventBus()
        self.hub = ClientHub()
        self.notifications = NotificationService(db, clock)
        self.notifications.set_delivery(self.hub.broadcast)
        self.decision = DecisionEngine(self.bus, db, self.notifications, self.hub.broadcast)
        self.focus = FocusManager(self.bus, clock)
        self.memory = Memory(db, clock)
        self.knowledge = KnowledgeBase(db, clock)
        self.research = Researcher(self)
        self.ai = AIEngine(self)
        self.chat = ChatHandler(self)
        # PC Companion: opcional, para a Zoe funcionar mesmo sem o psutil instalado
        self.pc, self.pc_error = None, None
        if enable_pc:
            try:
                from .pc.monitor import PcMonitor
                self.pc = PcMonitor(self, pc_collector)
            except ImportError:
                self.pc_error = PSUTIL_MISSING
                log.warning(PSUTIL_MISSING)
        self._bg: list[asyncio.Task] = []
        # foco pode começar pelo chat, pela bandeja, pela API ou por uma ação de balão:
        # em todos os casos a interface recebe o estado novo
        self.bus.subscribe(lambda e: self.broadcast_state(),
                           EventType.FOCUS_SESSION_STARTED, EventType.FOCUS_SESSION_ENDED)

    # ---------------- ciclo de vida ----------------
    async def start(self) -> None:
        removed = self.db.apply_retention()
        log.info("retenção aplicada: %s", removed)
        self._bg.append(asyncio.create_task(self._retention_loop()))
        self._bg.append(asyncio.create_task(self._checkin_loop()))
        self.research.start()
        if self.pc:
            self.pc.start()

    async def stop(self) -> None:
        await self.focus.stop(reason="encerramento")
        if self.pc:
            await self.pc.stop()
        await self.research.stop()
        for t in self._bg:
            t.cancel()

    async def _retention_loop(self) -> None:
        while True:
            await asyncio.sleep(self.RETENTION_EVERY_S)
            self.db.apply_retention()

    async def _checkin_loop(self) -> None:
        await asyncio.sleep(5 * 60)          # não puxa assunto logo ao abrir
        while True:
            try:
                await self.memory_checkin()
            except Exception:
                log.exception("falha no lembrete da memória")
            await asyncio.sleep(self.CHECKIN_EVERY_S)

    async def memory_checkin(self) -> dict | None:
        """Escolhe um assunto parado e publica MEMORY_CHECKIN (a decisão e as regras de aviso filtram)."""
        s = self.db.get_settings()
        if not s.get("checkins_memoria") or not self.hub.clients:
            return None
        if self.decision.focus_active or self.decision.idle_since is not None:
            return None
        now = self.clock()
        recent = self.db.query(
            "SELECT dedupe_key, scheduled_at FROM notifications WHERE dedupe_key LIKE 'memoria:%' "
            "AND status != 'bloqueada' AND scheduled_at > ?", (now - checkins.ASK_AGAIN_AFTER_S,))
        if any(now - r["scheduled_at"] < self.CHECKIN_MIN_GAP_S for r in recent):
            return None
        choice = checkins.pick(self.memory, now, s, {r["dedupe_key"] for r in recent})
        if choice:
            await self.publish(EventType.MEMORY_CHECKIN, choice, source="companion")
        return choice

    # ---------------- aprendizado ----------------
    def learning_feedback(self, interaction_id: int, vote: str) -> str:
        """👍 promove a resposta da IA para a base; 👎 rejeita (e ela vai para a fila de pesquisa)."""
        rows = self.db.query("SELECT * FROM interactions WHERE id = ?", (interaction_id,))
        if not rows or vote not in ("up", "down"):
            raise ValueError("interação ou voto inválido")
        inter = rows[0]
        row = self.knowledge.by_interaction(interaction_id) if inter["layer"] == "ia" else \
            (self.knowledge.get(inter["knowledge_id"]) if inter["knowledge_id"] else None)
        if vote == "up":
            if row and row["status"] == "candidata":
                self.knowledge.set_status(row["id"], "validada")
                return "Obrigada! Guardei essa resposta: da próxima vez respondo sem precisar da IA."
            return "Obrigada!"
        if row:
            self.knowledge.set_status(row["id"], "rejeitada")
        return "Entendi, não vou repetir essa resposta. Se quiser, me corrija: \"na verdade, …\"."

    def learning_stats(self, days: int = 30) -> dict:
        since = self.clock() - days * 86400
        rows = self.db.query("SELECT layer, COUNT(*) AS n FROM interactions WHERE interaction_type = 'chat' "
                             "AND layer != '' AND timestamp > ? GROUP BY layer", (since,))
        by = {r["layer"]: r["n"] for r in rows}
        total = sum(by.values())
        local = sum(by.get(k, 0) for k in ("regras", "memoria", "aprendizado", "base"))
        kn = self.db.query("SELECT status, COUNT(*) AS n FROM knowledge GROUP BY status")
        return {"days": days, "total": total, "by_layer": by, "local": local,
                "sem_ia_pct": round(100 * local / total) if total else None,
                "knowledge": {r["status"]: r["n"] for r in kn}}

    # ---------------- estado ----------------
    def state(self) -> dict:
        s = self.db.get_settings()
        return {
            "settings": s,
            "expression": self.decision.base_expression,
            "focus": self.focus.status(),
            "pc": {"available": self.pc is not None, "error": self.pc_error},
            "monitoring": s["monitoramento_ativo"],
            "interventions": s["intervencoes_ativas"],
            "do_not_disturb_until": s["nao_perturbe_ate"] if s["nao_perturbe_ate"] > self.clock() else 0,
            "uptime_s": round(self.clock() - self.started_at),
            "clients": len(self.hub.clients),
        }

    async def broadcast_state(self) -> None:
        await self.hub.broadcast({"type": "state", "state": self.state()})

    def status_text(self) -> str:
        st = self.state()
        parts = [f"Estou ligada há {st['uptime_s'] // 60} min."]
        parts.append("Monitoramento ativo." if st["monitoring"] else "Monitoramento pausado.")
        if st["focus"]:
            parts.append(f"Foco: faltam {st['focus']['remaining_s'] // 60} min.")
        if st["do_not_disturb_until"]:
            parts.append("Modo não perturbe ligado.")
        return " ".join(parts)

    async def publish(self, type_: EventType, payload: dict | None = None, source: str = "core") -> None:
        await self.bus.publish(Event(type_, payload or {}, source, self.clock()))

    async def set_monitoring(self, active: bool) -> None:
        self.db.update_settings({"monitoramento_ativo": active, "intervencoes_ativas": active})
        await self.publish(EventType.MONITORING_RESUMED if active else EventType.EMERGENCY_STOP)
        await self.broadcast_state()

    async def emergency_stop(self) -> None:
        await self.set_monitoring(False)

    async def handle_notification_action(self, nid: int, action: str | None) -> None:
        self.notifications.ack(nid, action)
        if action == "foco_novamente":
            await self.focus.start(int(self.db.get_settings()["foco_minutos_padrao"]))
        elif action and action.startswith(("mem_responder:", "mem_adiar:")):
            verb, kind, item_id = action.split(":", 2)
            try:
                item = self.memory.get(kind, int(item_id))
            except (KeyError, ValueError):
                return
            if not item:
                return
            if verb == "mem_adiar":
                self.memory.touch(kind, item["id"])        # conta como conversado: espera o intervalo de novo
            else:
                # a próxima mensagem do chat responde ao lembrete
                self.chat.memchat.ask(kind, item["id"], "capitulo" if kind == "livro" else "nota")
