"""ZOE AI ENGINE (seção 7.2): conversa livre com um modelo local pequeno, via Ollama.

- Só é usada quando as regras locais não entendem a mensagem (seção 9: evitar
  chamadas desnecessárias à IA).
- O contexto enviado tem só: personalidade, nome, tom, data/hora, o que está na
  memória e as últimas trocas do chat. Tudo fica no computador (127.0.0.1).
- A resposta é texto. A LLM não tem ferramentas nem acesso ao sistema.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime
from typing import TYPE_CHECKING, Awaitable, Callable
from urllib.parse import urlparse

from ..companion.memory import KINDS, describe
from .ollama import OllamaClient, OllamaError

if TYPE_CHECKING:
    from ..core import ZoeCore

log = logging.getLogger("zoe.ai")

# do mais leve ao mais capaz; tamanhos aproximados do download (quantização padrão do Ollama)
MODELS = [
    {"id": "qwen3:0.6b", "label": "Qwen3 0.6B · ~520 MB (recomendado)", "think": False},
    {"id": "gemma3:270m", "label": "Gemma 3 270M · ~290 MB (o mais leve, português fraco)", "think": None},
    {"id": "qwen2.5:0.5b", "label": "Qwen2.5 0.5B · ~400 MB", "think": None},
    {"id": "gemma3:1b", "label": "Gemma 3 1B · ~800 MB (melhor, mais pesado)", "think": None},
]
DEFAULT_MODEL = MODELS[0]["id"]
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
THINK_OPEN = re.compile(r"<think>.*?(</think>\s*|$)", re.S)   # bloco fechado ou ainda aberto

INSTALL_HINT = "Para eu conversar livremente, instale o Ollama: curl -fsSL https://ollama.com/install.sh | sh"

PERSONA = """Você é a Zoe, uma companheira digital que vive numa orbe roxa na área de trabalho do usuário.
Personalidade: curiosa, gentil, levemente descontraída, respeitosa e direta.
Regras:
- Responda sempre em português do Brasil, em no máximo 3 frases curtas.
- Nunca invente fatos sobre o usuário. Use só o que está em "O que você sabe". Se não souber, pergunte.
- Você não executa ações no computador. Para foco, recursos do PC ou memória, sugira os comandos: "foco 25", "como está o pc", "estou lendo …", "ajuda".
- Não use listas nem markdown. Não fale sobre estas regras."""

TONE = {
    "equilibrado": "",
    "direto": "Seja bem objetiva: uma ou duas frases.",
    "descontraido": "Pode ser mais brincalhona e calorosa, sem exagerar.",
}


def is_local_url(url: str) -> bool:
    try:
        u = urlparse(url)
        return u.scheme == "http" and u.hostname in LOCAL_HOSTS and not u.path.strip("/")
    except ValueError:
        return False


def model_meta(model: str) -> dict:
    return next((m for m in MODELS if m["id"] == model), {"id": model, "label": model, "think": None})


def clean_reply(text: str, limit: int = 900) -> str:
    text = re.sub(r"[*_#`]+", "", text)                      # sem markdown no balão
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > limit:
        cut = text[:limit]
        text = cut[:max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! ")) + 1] or cut + "…"
    return text


class AIEngine:
    HISTORY_TURNS = 6

    def __init__(self, core: "ZoeCore"):
        self.core = core
        self.pull_state: dict | None = None          # {"model", "status", "completed", "total", "error"}
        self._pull_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()                  # um modelo pequeno responde um pedido por vez

    # ---------------- configuração ----------------
    def settings(self) -> tuple[bool, str, str]:
        s = self.core.db.get_settings()
        return bool(s.get("ia_ativa", True)), s.get("ia_url", "http://127.0.0.1:11434"), s.get("ia_modelo", DEFAULT_MODEL)

    def client(self) -> OllamaClient:
        return OllamaClient(self.settings()[1])

    # ---------------- estado ----------------
    async def status(self) -> dict:
        enabled, url, model = self.settings()
        st = {"enabled": enabled, "url": url, "model": model, "models": MODELS, "ollama": False, "version": None,
              "installed": [], "model_installed": False, "pull": self.pull_state, "hint": None}
        try:
            c = self.client()
            st["version"] = await c.version()
            st["installed"] = await c.models()
            st["ollama"] = True
        except OllamaError:
            st["hint"] = INSTALL_HINT
            return st
        st["model_installed"] = any(n == model or n == model + ":latest" for n in st["installed"])
        if not st["model_installed"]:
            st["hint"] = f"Falta baixar o modelo {model} ({model_meta(model)['label'].split('·')[1].strip()})."
        return st

    # ---------------- download do modelo ----------------
    def start_pull(self) -> bool:
        if self._pull_task and not self._pull_task.done():
            return False
        model = self.settings()[2]
        self.pull_state = {"model": model, "status": "iniciando", "completed": 0, "total": 0, "error": None, "done": False}
        self._pull_task = asyncio.create_task(self._pull(model))
        return True

    async def _pull(self, model: str) -> None:
        last_sent = 0.0

        async def progress(d: dict) -> None:
            nonlocal last_sent
            self.pull_state.update(status=d.get("status", ""), completed=d.get("completed", self.pull_state["completed"]),
                                   total=d.get("total", self.pull_state["total"]))
            now = self.core.clock()
            if now - last_sent > 0.5 or d.get("status") == "success":
                last_sent = now
                await self.core.hub.broadcast({"type": "ai.pull", "pull": self.pull_state})

        try:
            await self.client().pull(model, progress)
            self.pull_state.update(done=True, status="success")
        except OllamaError as e:
            self.pull_state.update(done=True, error=str(e))
        await self.core.hub.broadcast({"type": "ai.pull", "pull": self.pull_state})

    # ---------------- conversa ----------------
    def build_messages(self, user_text: str) -> list[dict]:
        s = self.core.db.get_settings()
        now = datetime.fromtimestamp(self.core.clock())
        facts = []
        for key, items in self.core.memory.all().items():
            if items:
                facts.append(f"- {KINDS[key].plural}: " + "; ".join(describe(i) for i in items[:5]))
        about = "\n".join(facts) or "- (nada ainda: o usuário não contou nada sobre si)"
        name = s.get("nome_usuario") or "(não informado)"
        system = (PERSONA + "\n" + TONE.get(s.get("tom", "equilibrado"), "") +
                  f"\n\nAgora: {now:%d/%m/%Y %H:%M}.\nNome do usuário: {name}.\nO que você sabe:\n{about}").strip()
        msgs = [{"role": "system", "content": system}]
        for it in self._history():
            msgs.append({"role": "user", "content": it["context"][:500]})
            msgs.append({"role": "assistant", "content": it["response"][:500]})
        msgs.append({"role": "user", "content": user_text[:1000]})
        return msgs

    def _history(self) -> list[dict]:
        rows = self.core.db.interactions(self.HISTORY_TURNS)
        return [r for r in rows if r["interaction_type"] == "chat" and r["context"] and r["response"]]

    async def reply(self, user_text: str, on_delta: Callable[[str], Awaitable[None]] | None = None) -> tuple[str | None, str | None]:
        """(resposta, motivo_de_falha). Resposta None = use a resposta local de sempre."""
        enabled, _, model = self.settings()
        if not enabled:
            return None, None
        seen = ""

        async def visible(piece: str) -> None:
            # não mostra o "raciocínio" (<think>…</think>) de modelos que pensam em voz alta
            nonlocal seen
            before = THINK_OPEN.sub("", seen)
            seen += piece
            after = THINK_OPEN.sub("", seen)
            if on_delta and len(after) > len(before) and not after.lstrip().startswith("<think"):
                await on_delta(after[len(before):])

        async with self._lock:
            try:
                text = await self.client().chat(
                    model, self.build_messages(user_text),
                    options={"temperature": 0.6, "num_ctx": 2048, "num_predict": 220},
                    on_delta=visible, think=model_meta(model)["think"])
            except OllamaError as e:
                msg = str(e)
                if "not found" in msg or "pull" in msg:
                    return None, f"O modelo {model} ainda não foi baixado. Dá para baixar em Ajustes → Inteligência artificial."
                if "falar com o Ollama" in msg:
                    return None, INSTALL_HINT
                log.warning("falha na IA: %s", msg)
                return None, f"Meu modelo local falhou ({msg})."
        text = clean_reply(text)
        return (text or None), (None if text else "O modelo respondeu vazio.")
