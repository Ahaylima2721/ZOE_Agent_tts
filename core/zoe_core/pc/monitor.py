"""Laço de monitoramento do PC: lê métricas, guarda histórico, diagnostica e publica eventos.

- A coleta roda numa thread (asyncio.to_thread) para não travar a API.
- Com o monitoramento pausado (botão de emergência), não publica eventos nem grava
  métricas; só coleta quando o painel de recursos está aberto (pedido do usuário).
- Um alerta dispara uma vez e só volta a disparar depois que a situação normalizar
  por REARM_S segundos (histerese), além do dedupe das notificações.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import deque

from ..events import EventType
from . import diagnostics
from .collector import Collector

log = logging.getLogger("zoe.pc")

EVENT_FOR = {
    "ram_alta": EventType.HIGH_MEMORY_USAGE,
    "cpu_alta": EventType.CPU_OVERLOAD,
    "disco_cheio": EventType.DISK_SPACE_LOW,
    "temperatura_alta": EventType.HIGH_TEMPERATURE,
    "bateria_baixa": EventType.BATTERY_LOW,
}
REARM_S = 120
PERSIST_EVERY_S = 60
HISTORY_POINTS = 60          # pontos enviados para as minilinhas


class PcMonitor:
    def __init__(self, core, collector: Collector | None = None):
        self.core = core
        self.collector = collector or Collector(core.clock)
        self.latest: dict | None = None
        self.history: deque[tuple[float, float, float]] = deque(maxlen=720)   # (ts, cpu%, ram%)
        self.active: dict[str, float] = {}       # alerta ativo -> última vez visto
        self._persist_buf: list[dict] = []
        self._last_persist = 0.0
        self._task: asyncio.Task | None = None
        self.subscribers: set = set()            # WebSockets com o painel de recursos aberto
        self._wake = asyncio.Event()

    # ---------------- ciclo ----------------
    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    def wake(self) -> None:
        """Faz uma leitura imediata (ex.: o painel acabou de abrir)."""
        self._wake.set()

    async def _loop(self) -> None:
        while True:
            s = self.core.db.get_settings()
            try:
                if (s["monitoramento_ativo"] and s["pc_alertas"]) or self.subscribers:
                    await self.tick(s)
            except Exception:
                log.exception("falha na leitura do PC")
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=max(2, int(s.get("pc_intervalo_s", 5))))
            except asyncio.TimeoutError:
                pass

    async def read(self) -> dict:
        snap = await asyncio.to_thread(self.collector.snapshot)
        self.latest = snap
        self.history.append((snap["timestamp"], snap["cpu"]["percent"], snap["memory"]["percent"]))
        return snap

    async def tick(self, settings: dict | None = None) -> list[diagnostics.Finding]:
        s = settings or self.core.db.get_settings()
        snap = await self.read()
        if self.subscribers:
            await self._push(snap)
        if not s["monitoramento_ativo"]:
            return []
        self._persist(snap)
        if not s["pc_alertas"]:
            return []
        findings = diagnostics.diagnose(snap, list(self.history), s.get("pc_limites"))
        now = snap["timestamp"]
        seen = set()
        for f in findings:
            seen.add(f.kind)
            if f.kind not in self.active:
                await self.core.publish(EVENT_FOR[f.kind], f.to_dict(), source="pc")
            self.active[f.kind] = now
        for kind in list(self.active):
            if kind not in seen and now - self.active[kind] >= REARM_S:
                del self.active[kind]
        return findings

    # ---------------- saída ----------------
    def payload(self) -> dict:
        pts = list(self.history)[-HISTORY_POINTS:]
        return {"snapshot": self.latest,
                "history": {"t": [p[0] for p in pts], "cpu": [p[1] for p in pts], "ram": [p[2] for p in pts]}}

    async def _push(self, snap: dict) -> None:
        data = json.dumps({"type": "pc", **self.payload()}, ensure_ascii=False)
        for ws in list(self.subscribers):
            try:
                await ws.send_str(data)
            except Exception:
                self.subscribers.discard(ws)

    def _persist(self, snap: dict) -> None:
        """Grava a média de cada minuto em system_metrics (a retenção apaga o que for antigo)."""
        self._persist_buf.append(snap)
        now = snap["timestamp"]
        if not self._last_persist:          # 1ª leitura abre a janela do primeiro minuto
            self._last_persist = now
            return
        if now - self._last_persist < PERSIST_EVERY_S:
            return
        buf, self._persist_buf, self._last_persist = self._persist_buf, [], now
        avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
        root = [next((d["percent"] for d in b["disks"] if d["mount"] == "/"), None) for b in buf]
        temps = [(b.get("temperatures") or {}).get("cpu") for b in buf]
        gpus = [(b.get("gpu") or {}).get("percent") for b in buf]
        self.core.db.execute(
            "INSERT INTO system_metrics (cpu_usage, ram_usage, gpu_usage, disk_usage, temperature, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            (avg([b["cpu"]["percent"] for b in buf]), avg([b["memory"]["percent"] for b in buf]),
             avg([g for g in gpus if g is not None]), avg([r for r in root if r is not None]),
             avg([t for t in temps if t is not None]), now),
        )
