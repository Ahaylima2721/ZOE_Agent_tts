"""Conversa sobre a memória pessoal, por regras (sem LLM).

Entende frases comuns ("estou lendo Duna, de Frank Herbert", "estou no capítulo
7", "quero aprender Python", "meu hobby é tocar violão"...), guarda só o que
foi dito e, quando falta informação, PERGUNTA em vez de supor. Uma pergunta em
aberto (slot) vale por 10 minutos; "não sei" ou "deixa pra lá" encerram.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

from ..text import join_pt, normalize, tokens
from .memory import KINDS, Memory, describe

PENDING_TTL_S = 600
CANCEL = {"nao sei", "deixa pra la", "deixa para la", "esquece", "cancelar", "cancela", "nada", "pula", "nao quero dizer"}
YES = {"sim", "pode", "pode apagar", "sim, pode apagar", "sim pode apagar", "isso", "apaga", "confirmo"}
NO = {"nao", "nao apaga", "melhor nao", "nao, deixa"}
# começos de comandos de outras áreas: encerram a pergunta em aberto
OTHER_COMMANDS = re.compile(r"^(ajuda|foco|parar foco|nao perturbe|pausar|retomar|status|diagnostico|como esta o (pc|computador)|o que esta pesando|que horas)")

Answer = tuple[str, str, tuple[str, ...]]     # (texto, expressão, respostas rápidas)

# nomes podem vir com pontuação final; o resto do texto mantém a grafia original
_TAIL = " .!?;"


def _clean_name(x: str) -> str:
    x = x.strip(_TAIL).strip()
    x = re.sub(r'^["“”\']+|["“”\']+$', "", x).strip()
    return x[:1].upper() + x[1:]


def _split_list(x: str) -> list[str]:
    parts = re.split(r",\s*|\s+e\s+", x.strip(_TAIL))
    return [_clean_name(p) for p in parts if p.strip()]


@dataclass
class Pending:
    kind: str
    item_id: int | None
    slot: str            # autor | capitulo | nota | escolher_livro | confirmar_apagar
    created: float
    extra: dict | None = None


class MemoryChat:
    def __init__(self, memory: Memory, clock):
        self.memory, self.clock = memory, clock
        self.pending: Pending | None = None

    # ---------------- pontos de entrada ----------------
    def handle_pending(self, raw: str, t: str) -> Answer | None:
        """Resposta a uma pergunta que a Zoe fez (antes dos outros comandos)."""
        if self.pending and self.clock() - self.pending.created > PENDING_TTL_S:
            self.pending = None
        if not self.pending:
            return None
        if OTHER_COMMANDS.match(t):
            self.pending = None
            return None
        return self._answer_pending(raw.strip(), t)

    def handle(self, raw: str, t: str) -> Answer | None:
        """Frases sobre a memória (depois dos comandos da Zoe)."""
        for rule in (self._book_reading, self._chapter, self._finished, self._project, self._learn, self._hobby,
                     self._hobby_done, self._goal, self._postponed, self._music, self._screen, self._interest,
                     self._queries, self._forget):
            ans = rule(raw.strip(), t)
            if ans:
                return ans
        return None

    def ask(self, kind: str, item_id: int | None, slot: str, extra: dict | None = None) -> None:
        self.pending = Pending(kind, item_id, slot, self.clock(), extra)

    # ---------------- perguntas em aberto ----------------
    def _answer_pending(self, raw: str, t: str) -> Answer | None:
        p = self.pending
        if t in CANCEL:
            self.pending = None
            return ("Tudo bem, fica assim.", "normal", ())
        if p.slot == "confirmar_apagar":
            self.pending = None
            if t in YES:
                it = self.memory.get(p.kind, p.item_id)
                if it and self.memory.delete(p.kind, p.item_id):
                    return (f"Pronto, esqueci {describe(it)}.", "normal", ())
                return ("Esse item já não estava mais na minha memória.", "curiosa", ())
            return ("Ok, mantive.", "normal", ())
        if p.slot == "escolher_livro":
            found = self.memory.search(raw, ("livro",))
            if len(found) != 1:
                return ("Não achei esse livro entre os que você está lendo. Pode escrever o título?", "curiosa",
                        tuple(i["titulo"] for i in self.memory.list("livro") if i["status"] == "lendo")[:4])
            self.pending = None
            return self._set_chapter(found[0], p.extra["capitulo"])
        it = self.memory.get(p.kind, p.item_id)
        if not it:
            self.pending = None
            return None
        if p.slot == "autor":
            if len(raw) > 80 or "?" in raw:
                self.pending = None
                return None
            author = _clean_name(re.sub(r"^(e\s+)?(de|do|da|por)\s+", "", raw.strip(), flags=re.I))
            it = self.memory.update("livro", it["id"], {"autor": author})
            if not it["capitulo"]:
                self.ask("livro", it["id"], "capitulo")
                return (f"Anotado: {it['titulo']}, de {author}. Em que capítulo você está?", "feliz", ("não sei",))
            self.pending = None
            return (f"Anotado: {it['titulo']}, de {author}.", "feliz", ())
        if p.slot == "capitulo":
            if re.search(r"\bterminei\b|\bacabei\b", t):
                self.pending = None
                return self._finish(it)
            m = re.search(r"(?:cap[ií]tulo\s+)?\b(\d{1,4}|[ivxlc]{1,6})\b", raw, re.I)
            if m:
                self.pending = None
                return self._set_chapter(it, m.group(1).upper() if not m.group(1).isdigit() else m.group(1))
            self.pending = None
            return None
        if p.slot == "nota":
            self.pending = None
            return self._add_note(p.kind, it, raw)
        return None

    def _add_note(self, kind: str, it: dict, raw: str) -> Answer:
        k = KINDS[kind]
        stamp = datetime.fromtimestamp(self.clock()).strftime("%d/%m")
        if "notas" in k.fields:
            old = it.get("notas") or ""
            new = (old + "\n" if old else "") + f"{stamp}: {raw.strip()}"
            self.memory.update(kind, it["id"], {"notas": new[-500:]})
        elif "descricao" in k.fields:
            old = it.get("descricao") or ""
            self.memory.update(kind, it["id"], {"descricao": ((old + "\n" if old else "") + f"{stamp}: {raw.strip()}")[-500:]})
        else:
            self.memory.touch(kind, it["id"])
        return (f"Anotei isso em {it[k.name_field]}. Obrigada por me contar!", "feliz", ())

    # ---------------- livros ----------------
    def _book_reading(self, raw: str, t: str) -> Answer | None:
        m = re.match(r"^(?:eu\s+)?(?:(?:estou|t[oô]|to)\s+lendo|comecei\s+a\s+ler|vou\s+come[cç]ar\s+a\s+ler)\s+(?:o\s+livro\s+|o\s+livro:\s*)?(?P<x>.+)$", raw, re.I)
        if not m:
            return None
        x = m.group("x").strip(_TAIL)
        chapter = None
        cm = re.search(r",?\s*(?:e\s+)?(?:estou\s+)?(?:no|parei\s+no)\s+cap[ií]tulo\s+(\w+)\s*$", x, re.I)
        if cm:
            chapter, x = cm.group(1), x[:cm.start()].strip(_TAIL)
        author = None
        am = re.match(r"^(?P<t>.+?),\s*(?:de|do|da|por)\s+(?P<a>.+)$", x)    # autor só com vírgula: "Duna, de Frank Herbert"
        if am:
            x, author = am.group("t"), _clean_name(am.group("a"))
        title = _clean_name(x)
        if not title or len(title) > 160:
            return None
        data = {"titulo": title, "status": "lendo"}
        if author:
            data["autor"] = author
        if chapter:
            data["capitulo"] = chapter
        it, created = self.memory.create("livro", data)
        what = describe(it)
        if not it["autor"]:
            self.ask("livro", it["id"], "autor")
            return (f"Que legal! Anotei {it['titulo']}. De quem é?", "curiosa", ("não sei",))
        if not it["capitulo"]:
            self.ask("livro", it["id"], "capitulo")
            return (f"{'Anotado' if created else 'Atualizei'}: {what}. Em que capítulo você está?", "feliz", ("não sei",))
        return (f"{'Anotado' if created else 'Atualizei'}: {what}.", "feliz", ())

    def _set_chapter(self, it: dict, chapter: str) -> Answer:
        it = self.memory.update("livro", it["id"], {"capitulo": str(chapter), "status": "lendo"})
        return (f"Anotado: {it['titulo']}, capítulo {it['capitulo']}.", "feliz", ())

    def _chapter(self, raw: str, t: str) -> Answer | None:
        m = re.match(r"^(?:eu\s+)?(?:estou|t[oô]|to|parei|cheguei)\s+(?:no|ao|em)\s+cap[ií]tulo\s+(?P<c>\w+)(?:\s+(?:de|do|da)\s+(?P<t>.+))?$",
                     raw.strip(_TAIL), re.I)
        if not m:
            return None
        chapter = m.group("c")
        if m.group("t"):
            found = self.memory.search(m.group("t"), ("livro",))
            if len(found) == 1:
                return self._set_chapter(found[0], chapter)
            if not found:
                return (f"Não tenho {_clean_name(m.group('t'))} na memória. Quer que eu anote? É só dizer "
                        f"\"estou lendo {_clean_name(m.group('t'))}\".", "curiosa", ())
        reading = [i for i in self.memory.list("livro") if i["status"] == "lendo"]
        if len(reading) == 1:
            return self._set_chapter(reading[0], chapter)
        if not reading:
            return ("Ainda não sei o que você está lendo. Qual é o livro?", "curiosa", ())
        self.ask("livro", None, "escolher_livro", {"capitulo": chapter})
        return ("De qual livro?", "curiosa", tuple(i["titulo"] for i in reading[:4]))

    def _finish(self, it: dict) -> Answer:
        kind = it["tipo"]
        status = {"livro": "lido", "projeto": "concluido", "objetivo": "alcancado"}[kind]
        it = self.memory.update(kind, it["id"], {"status": status})
        name = it[KINDS[kind].name_field]
        msg = {"livro": f"Parabéns por terminar {name}! 🎉 Marquei como lido.",
               "projeto": f"Que conquista! Marquei o projeto {name} como concluído.",
               "objetivo": f"Parabéns! Marquei \"{name}\" como alcançado."}[kind]
        return (msg, "feliz", ())

    def _finished(self, raw: str, t: str) -> Answer | None:
        m = re.match(r"^(?:eu\s+)?(?:terminei|acabei|conclu[ií]|alcancei)(?:\s+de\s+ler)?(?:\s+(?:o|a|meu|minha))?(?:\s+(?P<k>livro|projeto|objetivo|meta))?\s*(?P<x>.*)$",
                     raw.strip(_TAIL), re.I)
        if not m:
            return None
        k = (m.group("k") or "").lower()
        keys = {"livro": ("livro",), "projeto": ("projeto",), "objetivo": ("objetivo",), "meta": ("objetivo",)}.get(k, ("livro", "projeto", "objetivo"))
        x = m.group("x").strip()
        if not x:
            if keys == ("livro",):
                reading = [i for i in self.memory.list("livro") if i["status"] == "lendo"]
                if len(reading) == 1:
                    return self._finish(reading[0])
            return None
        found = self.memory.search(x, keys)
        if len(found) == 1:
            return self._finish(found[0])
        if len(found) > 1:
            return ("Qual deles?", "curiosa", tuple(describe(i) for i in found[:4]))
        return None

    # ---------------- outros tipos ----------------
    def _save(self, kind: str, names: list[str], extra: dict | None = None) -> Answer | None:
        names = [n for n in names if n and len(n) <= 160]
        if not names:
            return None
        saved, again = [], []
        for n in names:
            it, created = self.memory.create(kind, {KINDS[kind].name_field: n, **(extra or {})})
            (saved if created else again).append(it[KINDS[kind].name_field])
        parts = []
        if saved:
            parts.append(f"Anotei {join_pt(saved)} em {KINDS[kind].plural.lower()}.")
        if again:
            parts.append(f"{join_pt(again)} eu já sabia. Atualizei a data da nossa conversa.")
        return (" ".join(parts), "feliz", ())

    def _project(self, raw: str, t: str) -> Answer | None:
        m = re.match(r"^(?:eu\s+)?(?:(?:estou|t[oô])\s+(?:trabalhando|fazendo|desenvolvendo|criando)\s+(?:no|o|num|um)\s+projeto|comecei\s+(?:o|um)\s+projeto|(?:tenho\s+um\s+)?novo\s+projeto|meu\s+projeto\s+(?:e|é|se\s+chama))(?:\s+chamado)?[:\s]+(?P<x>.+)$",
                     raw.strip(_TAIL), re.I)
        if not m:
            return None
        x = m.group("x")
        desc = None
        dm = re.match(r"^(?P<n>.+?)(?:,\s*que\s+(?:e|é)\s+|\s+[-–:]\s+)(?P<d>.+)$", x)
        if dm:
            x, desc = dm.group("n"), dm.group("d").strip(_TAIL)
        return self._save("projeto", [_clean_name(x)], {"descricao": desc} if desc else None)

    def _learn(self, raw: str, t: str) -> Answer | None:
        m = re.match(r"^(?:eu\s+)?(?:(?:quero|preciso|pretendo|gostaria\s+de)\s+aprender|(?:estou|t[oô])\s+(?:estudando|aprendendo))\s+(?:sobre\s+)?(?P<x>.+)$",
                     raw.strip(_TAIL), re.I)
        return self._save("aprender", _split_list(m.group("x"))) if m else None

    def _hobby(self, raw: str, t: str) -> Answer | None:
        m = re.match(r"^(?:meu\s+hobby\s+(?:e|é)|meus\s+hobbies\s+s[aã]o|tenho\s+como\s+hobby|um\s+hobby\s+meu\s+(?:e|é))\s+(?P<x>.+)$",
                     raw.strip(_TAIL), re.I)
        return self._save("hobby", _split_list(m.group("x"))) if m else None

    VERBS = r"toquei|pratiquei|joguei|desenhei|pintei|corri|nadei|treinei|cozinhei|escrevi|fotografei|pedalei|meditei|dancei|estudei|li"

    def _hobby_done(self, raw: str, t: str) -> Answer | None:
        if not re.match(rf"^(?:hoje\s+)?(?:eu\s+)?(?:acabei\s+de\s+|consegui\s+)?(?:{self.VERBS})\b", t):
            return None
        words = tokens(raw)
        for kind in ("hobby", "aprender"):
            for it in self.memory.list(kind):
                content = tokens(it["nome"]) - _VERB_TOKENS      # "tocar violão" -> {"violao"}
                if content and content & words:
                    self.memory.touch(kind, it["id"])
                    return (f"Que bom! Anotei que hoje teve {it['nome']}.", "feliz", ())
        return None

    def _goal(self, raw: str, t: str) -> Answer | None:
        m = re.match(r"^(?:meu|minha)\s+(?:objetivo|meta)(?:\s+(?P<k>profissional|pessoal))?(?:\s+(?:e|é)|:)\s+(?P<x>.+)$", raw.strip(_TAIL), re.I)
        if not m:
            return None
        return self._save("objetivo", [_clean_name(m.group("x"))], {"categoria": (m.group("k") or "pessoal").lower()})

    def _postponed(self, raw: str, t: str) -> Answer | None:
        m = re.match(r"^(?:eu\s+)?(?:(?:sempre|vivo|costumo)\s+(?:adio|adiando|adiar|deixo\s+para\s+depois|deixo\s+pra\s+depois)|preciso\s+parar\s+de\s+adiar)\s+(?P<x>.+)$",
                     raw.strip(_TAIL), re.I)
        return self._save("adiada", [_clean_name(m.group("x"))]) if m else None

    def _music(self, raw: str, t: str) -> Answer | None:
        m = re.match(r"^(?:(?:minha|meu)\s+(?:banda|cantora|cantor|artista|m[uú]sica|[aá]lbum)\s+(?:favorit[oa]|preferid[oa])\s+(?:e|é)|(?:gosto\s+(?:muito\s+)?de|adoro|curto)\s+ouvir)\s+(?P<x>.+)$",
                     raw.strip(_TAIL), re.I)
        return self._save("musica", _split_list(m.group("x"))) if m else None

    def _screen(self, raw: str, t: str) -> Answer | None:
        m = re.match(r"^(?:eu\s+)?(?:quero\s+(?:ver|assistir)|(?:estou|t[oô])\s+(?:vendo|assistindo))\s+(?:a\s+s[eé]rie\s+|o\s+filme\s+)?(?P<x>.+)$",
                     raw.strip(_TAIL), re.I)
        return self._save("filme_serie", [_clean_name(m.group("x"))]) if m else None

    def _interest(self, raw: str, t: str) -> Answer | None:
        m = re.match(r"^(?:eu\s+)?(?:me\s+interesso\s+(?:por|em)|tenho\s+interesse\s+em|gosto\s+(?:muito\s+)?de\s+(?:ler\s+sobre|estudar))\s+(?P<x>.+)$",
                     raw.strip(_TAIL), re.I)
        return self._save("interesse", _split_list(m.group("x"))) if m else None

    # ---------------- consultas e esquecer ----------------
    QUERY_KIND = {
        "o que estou lendo": "livro", "o que eu estou lendo": "livro", "meus livros": "livro",
        "meus projetos": "projeto", "quais sao meus projetos": "projeto", "meus hobbies": "hobby",
        "meus objetivos": "objetivo", "minhas metas": "objetivo", "o que eu quero aprender": "aprender",
        "o que quero aprender": "aprender", "meus interesses": "interesse", "o que eu adio": "adiada",
        "minhas musicas": "musica", "meus filmes": "filme_serie", "minhas series": "filme_serie",
    }
    ABOUT_ME = {"o que voce sabe sobre mim", "o que voce sabe de mim", "o que voce lembra de mim", "minha memoria",
                "meu perfil", "o que voce lembra sobre mim"}

    def _queries(self, raw: str, t: str) -> Answer | None:
        if t in self.QUERY_KIND:
            kind = self.QUERY_KIND[t]
            items = self.memory.list(kind)
            if kind == "livro":
                items = [i for i in items if i["status"] != "lido"] or items
            if not items:
                return (f"Ainda não tenho nada em {KINDS[kind].plural.lower()}. Me conta!", "curiosa", ())
            return (f"{KINDS[kind].plural}: " + join_pt([describe(i) for i in items[:8]]) + ".", "feliz", ())
        if t in self.ABOUT_ME:
            lines = []
            for key, items in self.memory.all().items():
                if items:
                    lines.append(f"• {KINDS[key].plural}: " + join_pt([describe(i) for i in items[:3]])
                                 + (f" (+{len(items) - 3})" if len(items) > 3 else ""))
            if not lines:
                return ("Ainda não sei quase nada sobre você. Me conta o que está lendo, seus projetos ou hobbies!",
                        "curiosa", ("ajuda",))
            return ("Isto é o que você me contou:\n" + "\n".join(lines) + "\nDá para editar tudo na aba Memória.", "feliz", ())
        return None

    def _forget(self, raw: str, t: str) -> Answer | None:
        m = re.match(r"^(?:esqueca|esquece|apague|apaga|remova|remove|tira)\s+(?:(?:o|a|que|do|da)\s+)?(?:livro|projeto|hobby|objetivo|meta|interesse)?\s*(?P<x>.+)$", t)
        if not m or t in CANCEL:
            return None
        found = self.memory.search(m.group("x"))
        if not found:
            return (f"Não encontrei \"{m.group('x')}\" na minha memória.", "curiosa", ())
        if len(found) > 1:
            return ("Achei mais de um. Qual deles? " + join_pt([describe(i) for i in found[:4]]) + ".", "curiosa", ())
        it = found[0]
        self.ask(it["tipo"], it["id"], "confirmar_apagar")
        return (f"Quer mesmo que eu esqueça {describe(it)}?", "preocupada", ("sim, pode apagar", "não"))


_VERB_TOKENS = {"tocar", "praticar", "jogar", "desenhar", "pintar", "correr", "nadar", "treinar", "cozinhar", "escrever",
                "fotografar", "pedalar", "meditar", "dancar", "estudar", "ler"}
