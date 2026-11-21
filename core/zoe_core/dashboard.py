"""Painel "Início" do app: tudo calculado a partir do banco (nada inventado).

- saudação pela hora + resumo do dia + sugestão vinda das tarefas e da memória;
- "Sua produtividade": minutos realmente focados por dia (7 dias) e variação contra a semana anterior;
- "Tempo por categoria": minutos de foco por categoria (7 dias).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from .tasks import days_back, weekday_pt

if TYPE_CHECKING:
    from .core import ZoeCore

CATEGORY_LABEL = {"estudo": "Estudo", "trabalho": "Trabalho", "lazer": "Lazer", "geral": "Geral"}


def greeting(hour: int) -> str:
    return "Bom dia" if 5 <= hour < 12 else "Boa tarde" if 12 <= hour < 18 else "Boa noite"


def plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def focus_seconds_by_day(core: "ZoeCore", days: int, offset_days: int = 0) -> dict:
    """{date: segundos focados} para os `days` dias que terminam `offset_days` dias atrás."""
    today = datetime.fromtimestamp(core.clock()).date() - timedelta(days=offset_days)
    out = {d: 0.0 for d in days_back(today, days)}
    start = datetime.combine(min(out), datetime.min.time()).timestamp()
    end = datetime.combine(today + timedelta(days=1), datetime.min.time()).timestamp()
    for r in core.db.query("SELECT started_at, focused_s FROM focus_sessions WHERE started_at >= ? AND started_at < ?", (start, end)):
        d = datetime.fromtimestamp(r["started_at"]).date()
        if d in out:
            out[d] += r["focused_s"]
    live = core.focus.session                                   # sessão em andamento conta também
    if live and offset_days == 0:
        d = datetime.fromtimestamp(live.started_at).date()
        if d in out:
            out[d] += live.focused_s(core.clock())
    return out


def build(core: "ZoeCore") -> dict:
    now = datetime.fromtimestamp(core.clock())
    today = now.date()
    s = core.db.get_settings()
    name = s.get("nome_usuario") or ""

    tasks_today = core.tasks.list("hoje")
    done_today = core.tasks.done_on(today)
    pending = [t for t in tasks_today if not t["concluida"]]

    # ---------------- texto da Zoe ----------------
    hello = f"{greeting(now.hour)}{', ' + name if name else ''}!"
    lines = [f"Você concluiu {plural(done_today, 'tarefa', 'tarefas')} hoje." if done_today else "Nenhuma tarefa concluída ainda hoje."]
    focus = core.focus.status()
    if focus:
        lines.append(f"Você está em foco: faltam {max(1, focus['remaining_s'] // 60)} min." if not focus["paused"] else "Seu foco está pausado.")
    elif pending:
        lines.append(f"Próxima: {pending[0]['titulo']}.")
    else:
        projects = [p for p in core.memory.list("projeto") if p["status"] == "ativo"]
        books = [b for b in core.memory.list("livro") if b["status"] == "lendo"]
        if projects:
            lines.append(f"Que tal focar no projeto {projects[0]['nome']}?")
        elif books:
            lines.append(f"Que tal ler um pouco de {books[0]['titulo']}?")

    # ---------------- status (no lugar do "Energia: Alta" do mockup: só estados reais) ----------------
    if focus and not focus["paused"]:
        status = {"label": "Em foco", "kind": "foco"}
    elif s.get("nao_perturbe_ate", 0) > core.clock():
        status = {"label": "Não perturbe", "kind": "silencio"}
    elif not s.get("monitoramento_ativo", True):
        status = {"label": "Pausada", "kind": "pausa"}
    else:
        status = {"label": "Disponível", "kind": "ok"}

    # ---------------- produtividade (7 dias) ----------------
    week = focus_seconds_by_day(core, 7)
    prev = focus_seconds_by_day(core, 7, offset_days=7)
    this_total, prev_total = sum(week.values()), sum(prev.values())
    variation = round(100 * (this_total - prev_total) / prev_total) if prev_total >= 60 else None
    days = [{"dia": weekday_pt(d), "data": d.isoformat(), "foco_min": round(sec / 60), "tarefas": core.tasks.done_on(d),
             "hoje": d == today} for d, sec in week.items()]

    # ---------------- tempo por categoria (7 dias) ----------------
    start = datetime.combine(today - timedelta(days=6), datetime.min.time()).timestamp()
    by_cat = {r["category"]: r["s"] for r in core.db.query(
        "SELECT category, SUM(focused_s) AS s FROM focus_sessions WHERE started_at >= ? GROUP BY category", (start,))}
    live = core.focus.session
    if live and live.started_at >= start:
        by_cat[live.category] = by_cat.get(live.category, 0) + live.focused_s(core.clock())
    total_cat = sum(by_cat.values())
    categories = [{"id": c, "nome": CATEGORY_LABEL.get(c, c), "minutos": round(v / 60),
                   "pct": round(100 * v / total_cat) if total_cat else 0}
                  for c, v in sorted(by_cat.items(), key=lambda kv: -kv[1]) if v >= 30]

    learning = core.learning_stats(7)
    return {
        "saudacao": hello, "resumo": " ".join(lines), "status": status,
        "hoje": tasks_today[:8], "foco": focus, "foco_padrao": s.get("foco_minutos_padrao", 25),
        "produtividade": {"dias": days, "foco_min_semana": round(this_total / 60), "variacao_pct": variation},
        "categorias": categories,
        "numeros": {"tarefas_hoje": done_today, "foco_min_hoje": round(week.get(today, 0) / 60),
                    "sem_ia_pct": learning["sem_ia_pct"]},
        "proximo": core.tasks.next_due(),
    }
