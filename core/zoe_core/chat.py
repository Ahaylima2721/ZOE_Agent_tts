"""Conversa local (sem LLM).

Até a Fase 5 (Ollama) a Zoe entende um conjunto pequeno e real de comandos.
Para o resto ela diz com honestidade que ainda não sabe conversar livremente,
em vez de fingir uma resposta.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

from .companion.conversation import MemoryChat
from .text import normalize  # noqa: F401  (reexportado: outros módulos importam daqui)

if TYPE_CHECKING:
    from .core import ZoeCore

HELP = (
    "Por enquanto eu entendo:\n"
    "• foco 25 — inicia uma sessão de foco (minutos)\n"
    "• parar foco\n"
    "• não perturbe 30 — silencio as conversas espontâneas por 30 min\n"
    "• pausar / retomar — monitoramento e intervenções\n"
    "• me chame de <nome>\n"
    "• como está o pc · diagnóstico · o que está pesando\n"
    "• estou lendo Duna, de Frank Herbert · estou no capítulo 7 · terminei Duna\n"
    "• quero aprender Python · meu hobby é tocar violão · meu objetivo é…\n"
    "• novo projeto Fluxo · o que você sabe sobre mim · esqueça <algo>\n"
    "• status · que horas são · ajuda"
)


@dataclass
class Reply:
    text: str
    expression: str = "normal"
    quick_replies: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {"text": self.text, "expression": self.expression, "quick_replies": list(self.quick_replies)}


# ---------------- PC Companion ----------------
PC_SUMMARY = {"como esta o pc", "como esta o computador", "status do pc", "status do computador", "pc", "computador",
              "recursos", "como esta a maquina", "uso do pc"}
PC_DIAGNOSE = {"diagnostico", "diagnosticar", "fazer diagnostico", "faz um diagnostico", "por que o pc esta lento",
               "por que o computador esta lento", "o pc esta lento", "o computador esta lento", "pc lento", "computador lento"}
PC_PROCESSES = {"processos", "o que esta pesando", "quem esta pesando", "o que esta usando memoria",
                "o que esta usando a memoria", "o que esta usando cpu", "o que esta usando a cpu", "top processos"}


class ChatHandler:
    def __init__(self, core: "ZoeCore"):
        self.core = core
        self.memchat = MemoryChat(core.memory, core.clock)

    async def reply(self, text: str, on_delta=None) -> Reply:
        """on_delta(pedaço): recebe a resposta da IA aos poucos (streaming), quando ela for usada."""
        text = text.strip()[:2000]
        r = await self._route(text, normalize(text), on_delta)
        self.core.db.log_interaction("chat", text, r.text)
        return r

    async def _route(self, raw: str, t: str, on_delta=None) -> Reply:
        core, s = self.core, self.core.db.get_settings()
        nome = s.get("nome_usuario") or ""

        if not t:
            return Reply("Hm? Pode escrever de novo?", "curiosa")
        ans = self.memchat.handle_pending(raw, t)      # resposta a uma pergunta que eu fiz
        if ans:
            return Reply(*ans)
        if t in ("ajuda", "help", "comandos", "o que voce faz", "o que voce sabe fazer"):
            return Reply(HELP, "feliz", ("foco 25", "status"))
        if re.fullmatch(r"(oi|ola|e ai|bom dia|boa tarde|boa noite|hey)( zoe)?", t):
            return Reply(f"Oi{', ' + nome if nome else ''}! Como posso ajudar?", "feliz", ("ajuda", "foco 25"))

        m = re.fullmatch(r"(?:iniciar |comecar )?(?:sessao de )?foco(?: de)?(?: (\d{1,3}))?(?: ?min(?:utos)?)?", t)
        if m:
            mins = int(m.group(1)) if m.group(1) else int(s["foco_minutos_padrao"])
            try:
                await core.focus.start(mins)
            except ValueError as e:
                return Reply(f"Não consegui: {e}.", "preocupada")
            return Reply(f"Combinado: {mins} minutos de foco. Eu fico quietinha e te aviso no final.", "foco", ("parar foco",))
        if t in ("parar foco", "cancelar foco", "encerrar foco", "parar"):
            if await core.focus.stop():
                return Reply("Foco encerrado. Sem problema, recomeçamos quando quiser.", "normal", ("foco 25",))
            return Reply("Não tem nenhuma sessão de foco rodando agora.", "curiosa", ("foco 25",))

        m = re.fullmatch(r"nao perturbe(?: (\d{1,3}))?(?: ?min(?:utos)?)?", t)
        if m:
            mins = int(m.group(1) or 60)
            core.db.update_settings({"nao_perturbe_ate": core.clock() + mins * 60})
            await core.broadcast_state()
            return Reply(f"Ok, fico em silêncio por {mins} minutos (só respondo se você me chamar).", "descanso")

        if t in ("pausar", "pausar monitoramento", "pare de me monitorar"):
            await core.set_monitoring(False)
            return Reply("Monitoramento e intervenções pausados.", "normal", ("retomar",))
        if t in ("retomar", "retomar monitoramento", "voltar"):
            await core.set_monitoring(True)
            return Reply("Voltei a acompanhar. Obrigada!", "feliz")

        m = re.fullmatch(r"(?:me chame de|meu nome e|pode me chamar de) (.{1,40})", t)
        if m:
            original = re.match(r"^\s*(?:me chame de|meu nome [eé]|pode me chamar de)\s+(.{1,40})$", raw.strip(" !?."), re.I)
            novo = (original.group(1) if original else m.group(1)).strip()
            core.db.update_settings({"nome_usuario": novo})
            return Reply(f"Prazer, {novo}! Vou lembrar.", "feliz")

        pc = await self._pc(t)
        if pc:
            return pc

        ans = self.memchat.handle(raw, t)              # coisas que você me conta sobre você
        if ans:
            return Reply(*ans)

        if t in ("status", "como voce esta", "tudo bem"):
            return Reply(core.status_text(), "normal")
        if t in ("que horas sao", "horas", "que horas"):
            return Reply(f"Agora são {datetime.fromtimestamp(core.clock()):%H:%M}.", "normal")

        # nenhuma regra local entendeu: aí sim a IA local (se estiver disponível)
        text, why = await core.ai.reply(raw, on_delta)
        if text:
            return Reply(text, "normal")
        if why:
            return Reply(f"Não sei responder isso sem a minha IA. {why}", "curiosa", ("ajuda",))
        return Reply(
            "Não entendi. A conversa livre (Ollama) está desligada em Ajustes → Inteligência artificial. "
            "Escreva \"ajuda\" para ver o que já sei fazer.",
            "curiosa", ("ajuda",),
        )

    async def _pc(self, t: str) -> Reply | None:
        if t not in PC_SUMMARY | PC_DIAGNOSE | PC_PROCESSES:
            return None
        core = self.core
        if not core.pc:
            return Reply(core.pc_error or "O monitor do computador está desligado.", "preocupada")
        from .pc import diagnostics as dg
        snap = await core.pc.read()
        if t in PC_SUMMARY:
            return Reply(dg.summary(snap), "normal", ("diagnóstico", "o que está pesando"))
        if t in PC_PROCESSES:
            mem = snap["processes"]["by_memory"][:4]
            cpu = [g for g in snap["processes"]["by_cpu"][:4] if g["cpu_pct"] >= 1]
            lines = ["Quem mais usa memória:"] + [f"• {g['app']}: {dg.fmt_bytes(g['mem_bytes'])}" for g in mem]
            if cpu:
                lines += ["Quem mais usa CPU agora:"] + [f"• {g['app']}: {g['cpu_pct']:.0f}%" for g in cpu]
            else:
                lines.append("No processador está tudo tranquilo agora.")
            return Reply("\n".join(lines), "curiosa", ("diagnóstico",))
        findings = dg.diagnose(snap, list(core.pc.history), core.db.get_settings().get("pc_limites"))
        if not findings:
            return Reply("Fiz um diagnóstico e não achei nada fora do normal. " + dg.summary(snap), "feliz",
                         ("o que está pesando",))
        worst = "alerta" if any(f.severity == "critical" for f in findings) else "preocupada"
        text = "\n\n".join(f"{f.title}: {f.message} {f.suggestion}" for f in findings)
        return Reply(text, worst, ("o que está pesando",))
