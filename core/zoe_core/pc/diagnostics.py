"""Diagnóstico assistido (seção 5.3): métricas → anomalias → responsáveis → explicação → sugestão.

Funções puras: recebem uma leitura (snapshot), o histórico recente e os limites
configurados, e devolvem achados. Nada aqui executa ações no sistema.
"""
from __future__ import annotations

from dataclasses import dataclass, field

DEFAULT_LIMITS = {"ram_pct": 90, "cpu_pct": 90, "disco_livre_pct": 10, "temp_c": 90, "bateria_pct": 15}

RAM_SUSTAIN_S = 30      # RAM alta por pelo menos 30 s
CPU_WINDOW_S = 60       # média de CPU no último minuto
CPU_MIN_COVERAGE = 0.8  # precisa de dados cobrindo 80% da janela
DISK_MIN_FREE = 5 * 2**30


@dataclass
class Finding:
    kind: str               # ram_alta, cpu_alta, disco_cheio, temperatura_alta, bateria_baixa
    severity: str           # warning, serious, critical
    title: str
    message: str            # o que está acontecendo + quem é o responsável
    suggestion: str
    value: float
    culprits: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"kind": self.kind, "severity": self.severity, "title": self.title, "message": self.message,
                "suggestion": self.suggestion, "value": self.value, "culprits": self.culprits}


def fmt_bytes(n: float | None) -> str:
    if n is None:
        return "?"
    for unit, size in (("TB", 2**40), ("GB", 2**30), ("MB", 2**20), ("KB", 2**10)):
        if n >= size:
            v = n / size
            return (f"{v:.1f}" if v < 100 else f"{v:.0f}").replace(".", ",") + f" {unit}"
    return f"{int(n)} B"


def fmt_pct(v: float) -> str:
    return f"{v:.0f}%"


def _top(snapshot: dict, key: str) -> dict | None:
    groups = (snapshot.get("processes") or {}).get(key) or []
    return groups[0] if groups else None


def _recent(history: list[tuple[float, float, float]], now: float, window: float) -> list[tuple[float, float, float]]:
    return [h for h in history if now - h[0] <= window]


# ---------------- regras ----------------
def check_ram(s: dict, history, limits) -> Finding | None:
    m, now, lim = s["memory"], s["timestamp"], limits["ram_pct"]
    recent = _recent(history, now, RAM_SUSTAIN_S)
    if m["percent"] < lim or not recent or now - recent[0][0] < RAM_SUSTAIN_S * 0.8 or any(r[2] < lim for r in recent):
        return None
    top = _top(s, "by_memory")
    msg = f"Sua memória está {fmt_pct(m['percent'])} ocupada ({fmt_bytes(m['used'])} de {fmt_bytes(m['total'])})."
    if top:
        share = 100 * top["mem_bytes"] / m["total"]
        msg += f" {top['app']} está usando {fmt_bytes(top['mem_bytes'])} ({share:.0f}% da RAM)"
        msg += f", em {top['processes']} processos." if top["processes"] > 1 else "."
    if m.get("swap_total") and m.get("swap_percent", 0) > 50:
        msg += f" A swap também está {fmt_pct(m['swap_percent'])} cheia, por isso o sistema pode ficar lento."
    return Finding("ram_alta", "serious" if m["percent"] >= 95 else "warning", "Memória quase cheia", msg,
                   "Fechar abas ou programas que você não está usando libera memória.", m["percent"],
                   [top] if top else [])


def check_cpu(s: dict, history, limits) -> Finding | None:
    now, lim = s["timestamp"], limits["cpu_pct"]
    recent = _recent(history, now, CPU_WINDOW_S)
    if not recent or now - recent[0][0] < CPU_WINDOW_S * CPU_MIN_COVERAGE:
        return None
    avg = sum(r[1] for r in recent) / len(recent)
    if avg < lim:
        return None
    top = _top(s, "by_cpu")
    msg = f"O processador está em {fmt_pct(avg)} de uso há mais de um minuto."
    if top and top["cpu_pct"] >= 5:
        msg += f" Quem mais está usando é {top['app']} ({fmt_pct(top['cpu_pct'])} da máquina)."
    return Finding("cpu_alta", "serious" if avg >= 97 else "warning", "Processador sobrecarregado", msg,
                   "Se esse programa não deveria estar trabalhando agora, vale fechá-lo ou ver o que ele está fazendo.",
                   round(avg, 1), [top] if top and top["cpu_pct"] >= 5 else [])


def check_disks(s: dict, history, limits) -> Finding | None:
    worst = None
    for d in s.get("disks") or []:
        free_pct = 100 - d["percent"]
        low = free_pct < limits["disco_livre_pct"] or (d["total"] > 4 * DISK_MIN_FREE and d["free"] < DISK_MIN_FREE)
        if low and (worst is None or free_pct < 100 - worst["percent"]):
            worst = d
    if not worst:
        return None
    free_pct = 100 - worst["percent"]
    where = "o disco do sistema" if worst["mount"] == "/" else f"o disco em {worst['mount']}"
    msg = f"Só restam {fmt_bytes(worst['free'])} livres em {where} ({free_pct:.0f}% de {fmt_bytes(worst['total'])})."
    return Finding("disco_cheio", "serious" if free_pct < 3 else "warning", "Disco ficando sem espaço", msg,
                   "Esvaziar a lixeira, limpar ~/.cache e remover pacotes antigos (sudo apt autoremove) costuma liberar espaço.",
                   round(free_pct, 1), [])


def check_temperature(s: dict, history, limits) -> Finding | None:
    t = s.get("temperatures") or {}
    cpu = t.get("cpu")
    if cpu is None:
        return None
    lim = limits["temp_c"]
    if cpu < lim:
        return None
    critical = cpu >= max(lim + 5, 95)
    msg = f"A CPU está a {cpu:.0f} °C."
    top = _top(s, "by_cpu")
    if top and top["cpu_pct"] >= 10:
        msg += f" {top['app']} está puxando {fmt_pct(top['cpu_pct'])} do processador."
    return Finding("temperatura_alta", "critical" if critical else "serious", "Computador esquentando", msg,
                   "Deixe as saídas de ar livres (fora do colo ou da cama). Se continuar quente, feche o que está pesando.",
                   cpu, [top] if top and top["cpu_pct"] >= 10 else [])


def check_battery(s: dict, history, limits) -> Finding | None:
    b = s.get("battery")
    if not b or b["plugged"] or b["percent"] > limits["bateria_pct"]:
        return None
    msg = f"A bateria está em {b['percent']:.0f}%"
    if b.get("secs_left"):
        mins = b["secs_left"] // 60
        msg += f", mais ou menos {mins // 60}h{mins % 60:02d} de uso" if mins >= 60 else f", uns {mins} minutos de uso"
    msg += "."
    return Finding("bateria_baixa", "critical" if b["percent"] <= 5 else "warning", "Bateria baixa", msg,
                   "Conecte o carregador ou salve o que estiver fazendo.", b["percent"], [])


CHECKS = (check_ram, check_cpu, check_disks, check_temperature, check_battery)


def diagnose(snapshot: dict, history, limits: dict | None = None) -> list[Finding]:
    lim = {**DEFAULT_LIMITS, **(limits or {})}
    return [f for f in (c(snapshot, history, lim) for c in CHECKS) if f]


def summary(snapshot: dict) -> str:
    """Resumo curto e objetivo do estado atual (para o chat)."""
    c, m = snapshot["cpu"], snapshot["memory"]
    parts = [f"CPU em {fmt_pct(c['percent'])}", f"memória {fmt_pct(m['percent'])} ({fmt_bytes(m['used'])} de {fmt_bytes(m['total'])})"]
    root = next((d for d in snapshot.get("disks") or [] if d["mount"] == "/"), None)
    if root:
        parts.append(f"{fmt_bytes(root['free'])} livres no disco")
    t = (snapshot.get("temperatures") or {}).get("cpu")
    if t is not None:
        parts.append(f"CPU a {t:.0f} °C")
    b = snapshot.get("battery")
    if b:
        parts.append(f"bateria {b['percent']:.0f}%" + (" (carregando)" if b["plugged"] else ""))
    return ", ".join(parts[:-1]) + " e " + parts[-1] + "." if len(parts) > 1 else parts[0] + "."
