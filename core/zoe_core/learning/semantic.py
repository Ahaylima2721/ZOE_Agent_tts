"""R1 — busca por significado (embeddings via Ollama) com calibração no próprio computador.

- Cada pergunta confirmada da base e cada item da memória ganha um vetor (tabela `vectors`),
  recalculado quando o texto muda.
- Uma pergunta nova é comparada por cosseno. Dois limiares, CALIBRADOS para o modelo instalado:
    `direto`   → responde pela base sem chamar a IA;
    `contexto` → o trecho vai como contexto para a IA (RAG).
- Guarda de nomes próprios: "capital da França" × "capital da Alemanha" ficam parecidas para
  embeddings, mas não são a mesma pergunta. Se os nomes próprios/números diferem, não é resposta direta.
- Sem Ollama, sem o modelo ou sem calibração: nada quebra; a Zoe volta para a busca por palavras.
"""
from __future__ import annotations

import hashlib
import logging
import re
import statistics
import unicodedata
from array import array
from typing import TYPE_CHECKING

from ..ai.ollama import OllamaClient, OllamaError

try:                                   # numpy é opcional: acelera, mas não é obrigatório
    import numpy as np
except ImportError:                    # pragma: no cover - depende do sistema
    np = None

if TYPE_CHECKING:
    from ..core import ZoeCore

log = logging.getLogger("zoe.semantic")

EMB_MODELS = [
    {"id": "paraphrase-multilingual", "label": "Paraphrase Multilingual · leve, feito para frases parecidas (recomendado)"},
    {"id": "bge-m3", "label": "BGE-M3 · mais preciso, mais pesado (~1,2 GB)"},
    {"id": "granite-embedding:278m", "label": "Granite Embedding 278M · multilíngue"},
]
DEFAULT_EMB_MODEL = EMB_MODELS[0]["id"]
BATCH = 32
MIN_DIRECT = 0.75      # pisos de segurança dos limiares calibrados
MIN_CONTEXT = 0.5

# Pares em português para calibrar: (a, b, é a mesma pergunta?)
# Os "não" são de propósito do MESMO assunto: é aí que um limiar frouxo erraria.
CALIBRATION = [
    ("Quem escreveu O Fantasma da Ópera?", "Quem é o autor de O Fantasma da Ópera?", True),
    ("O que é um buraco negro?", "Me explica o que é um buraco negro", True),
    ("Como funciona a fotossíntese?", "Explique o processo da fotossíntese", True),
    ("Qual a capital da França?", "Qual é a capital francesa?", True),
    ("Como instalar o Python no Ubuntu?", "Como faço para instalar Python no Ubuntu?", True),
    ("O que é uma rede neural?", "Me fala o que são redes neurais", True),
    ("Quantos planetas tem o sistema solar?", "Quantos planetas existem no sistema solar?", True),
    ("Qual a diferença entre RAM e armazenamento?", "Qual é a diferença entre memória RAM e disco?", True),
    ("Como melhorar minha concentração nos estudos?", "Dicas para me concentrar melhor estudando", True),
    ("O que significa API?", "O que é uma API?", True),
    ("Quem pintou a Mona Lisa?", "Quem foi o pintor da Mona Lisa?", True),
    ("Para que serve o Docker?", "Qual a utilidade do Docker?", True),
    ("Como afinar um violão?", "Como faço para afinar o violão?", True),
    ("Quando foi a independência do Brasil?", "Em que ano o Brasil ficou independente?", True),
    ("O que é aprendizado de máquina?", "Explique o que é machine learning", True),
    ("Como funciona o protocolo HTTP?", "Me explica como o HTTP funciona", True),
    ("Quem escreveu O Fantasma da Ópera?", "Quem escreveu Dom Casmurro?", False),
    ("O que é um buraco negro?", "O que é uma estrela de nêutrons?", False),
    ("Qual a capital da França?", "Qual a capital da Alemanha?", False),
    ("Como instalar o Python no Ubuntu?", "Como desinstalar o Python no Ubuntu?", False),
    ("Quantos planetas tem o sistema solar?", "Qual o maior planeta do sistema solar?", False),
    ("Quem pintou a Mona Lisa?", "Onde está exposta a Mona Lisa?", False),
    ("Para que serve o Docker?", "Para que serve o Kubernetes?", False),
    ("Como afinar um violão?", "Como trocar as cordas do violão?", False),
    ("Quando foi a independência do Brasil?", "Quando foi a proclamação da República no Brasil?", False),
    ("O que é uma API?", "O que é um banco de dados?", False),
    ("Como funciona a fotossíntese?", "Como funciona a respiração celular?", False),
    ("O que é aprendizado de máquina?", "O que é computação quântica?", False),
    ("Qual a diferença entre RAM e armazenamento?", "Quanto de RAM eu preciso para programar?", False),
    ("Como funciona o protocolo HTTP?", "Como funciona o protocolo FTP?", False),
    ("Quem é o autor de O Pequeno Príncipe?", "Quem é o autor de O Alquimista?", False),
    ("Como melhorar minha concentração nos estudos?", "Como melhorar meu sono?", False),
]


# ---------------- vetores ----------------
def pack(vec: list[float]) -> bytes:
    return array("f", vec).tobytes()


def unpack(blob: bytes) -> array:
    a = array("f")
    a.frombytes(blob)
    return a


def normalize(vec) -> list[float]:
    n = sum(x * x for x in vec) ** 0.5 or 1.0
    return [x / n for x in vec]


def cosine_many(q: list[float], mats: list) -> list[float]:
    """q e cada vetor já normalizados → produto interno = cosseno."""
    if not mats:
        return []
    if np is not None:
        m = np.frombuffer(b"".join(v.tobytes() for v in mats), dtype=np.float32).reshape(len(mats), -1)
        return (m @ np.asarray(q, dtype=np.float32)).tolist()
    return [sum(a * b for a, b in zip(q, v)) for v in mats]


def text_hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


# ---------------- guarda de nomes próprios ----------------
def _plain(w: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", w.lower()) if not unicodedata.combining(c))


def entities(text: str) -> set[str]:
    """Nomes próprios (palavra com maiúscula fora do começo da frase) e números."""
    words = re.findall(r"[\wÀ-ÿ]+", text)
    out = set()
    for i, w in enumerate(words):
        if w.isdigit() or (i > 0 and w[:1].isupper() and len(w) > 1 and w.lower() not in {"o", "a", "os", "as", "de", "da", "do"}):
            out.add(_plain(w))
    return out


def same_entities(a: str, b: str) -> bool:
    ea, eb = entities(a), entities(b)
    return not (ea and eb and ea != eb)


class SemanticIndex:
    def __init__(self, core: "ZoeCore"):
        self.core = core
        self._qcache: dict[tuple[str, str], list[float]] = {}
        self._ready: tuple[float, bool] = (0.0, False)

    # ---------------- configuração / estado ----------------
    def settings(self) -> tuple[bool, str, str]:
        s = self.core.db.get_settings()
        return bool(s.get("emb_ativo", True)), s.get("emb_modelo", DEFAULT_EMB_MODEL), s.get("ia_url", "http://127.0.0.1:11434")

    def thresholds(self, model: str | None = None) -> dict | None:
        model = model or self.settings()[1]
        return (self.core.db.get_settings().get("emb_calibracao") or {}).get(model)

    async def installed(self) -> tuple[bool, bool]:
        """(ollama respondendo, modelo de embeddings baixado)"""
        _, model, url = self.settings()
        try:
            names = await OllamaClient(url).models()
        except OllamaError:
            return False, False
        return True, any(n == model or n == model + ":latest" for n in names)

    async def ready(self) -> bool:
        """Pronto para usar: ligado, modelo baixado e calibrado. Calibra sozinho na primeira vez."""
        on, model, _ = self.settings()
        if not on:
            return False
        now = self.core.clock()
        if now - self._ready[0] < 60:
            return self._ready[1]
        ok = False
        ollama, has_model = await self.installed()
        if ollama and has_model:
            if not self.thresholds(model):
                try:
                    await self.calibrate()
                except OllamaError as e:
                    log.warning("calibração falhou: %s", e)
            ok = bool(self.thresholds(model))
        self._ready = (now, ok)
        return ok

    def invalidate(self) -> None:
        self._ready = (0.0, False)

    async def status(self) -> dict:
        on, model, _ = self.settings()
        ollama, has_model = await self.installed()
        return {"enabled": on, "model": model, "models": EMB_MODELS, "ollama": ollama, "model_installed": has_model,
                "calibration": self.thresholds(model),
                "indexed": self.core.db.query("SELECT COUNT(*) AS n FROM vectors WHERE model = ?", (model,))[0]["n"]}

    # ---------------- embeddings ----------------
    async def embed(self, texts: list[str]) -> list[list[float]]:
        _, model, url = self.settings()
        out: list[list[float] | None] = [self._qcache.get((model, t)) for t in texts]
        missing = [i for i, v in enumerate(out) if v is None]
        client = OllamaClient(url)
        for start in range(0, len(missing), BATCH):
            idx = missing[start:start + BATCH]
            vecs = await client.embed(model, [texts[i] for i in idx])
            for i, v in zip(idx, vecs):
                out[i] = normalize(v)
                if len(self._qcache) > 500:
                    self._qcache.pop(next(iter(self._qcache)))
                self._qcache[(model, texts[i])] = out[i]
        return out  # type: ignore[return-value]

    # ---------------- calibração ----------------
    async def calibrate(self) -> dict:
        """Mede o modelo instalado com os pares em português e guarda os limiares dele."""
        _, model, _ = self.settings()
        texts = sorted({t for a, b, _ in CALIBRATION for t in (a, b)})
        vec = dict(zip(texts, await self.embed(texts)))
        pos, neg = [], []
        for a, b, same in CALIBRATION:
            sim = sum(x * y for x, y in zip(vec[a], vec[b]))
            if same:
                pos.append(sim)
            elif same_entities(a, b):              # nomes diferentes já são barrados pela guarda
                neg.append(sim)
        worst_neg = max(neg) if neg else 0.0
        # nenhuma confusão no conjunto de teste, e nunca abaixo do piso (se a guarda barrar todos os 'não')
        direct = min(0.99, round(max(worst_neg + 0.02, MIN_DIRECT), 3))
        hits = sum(1 for (a, b, same), s in zip([p for p in CALIBRATION if p[2]], pos) if s >= direct and same_entities(a, b))
        context = round(min(direct, max(MIN_CONTEXT, (statistics.mean(pos) + statistics.mean(neg or [0])) / 2)), 3)
        result = {"direto": direct, "contexto": context, "acertos": hits, "pares": len(pos),
                  "confusoes": 0, "media_iguais": round(statistics.mean(pos), 3),
                  "media_diferentes": round(statistics.mean(neg or [0]), 3)}
        cal = dict(self.core.db.get_settings().get("emb_calibracao") or {})
        cal[model] = result
        self.core.db.update_settings({"emb_calibracao": cal})
        self.invalidate()
        log.info("calibração de %s: %s", model, result)
        return result

    # ---------------- índice ----------------
    def _corpus(self) -> list[tuple[str, int, str]]:
        """(tipo, id, texto) de tudo o que pode ser buscado por significado."""
        from ..companion.memory import KINDS, describe
        items: list[tuple[str, int, str]] = []
        for r in self.core.db.query("SELECT id, question FROM knowledge WHERE status IN ('validada', 'fonte')"):
            items.append(("kq", r["id"], r["question"]))
        for key in KINDS:
            for it in self.core.memory.list(key):
                text = describe(it) + (f". {it['notas']}" if it.get("notas") else "")
                items.append((f"mem:{key}", it["id"], text[:600]))
        return items

    async def sync(self) -> int:
        """Cria/atualiza os vetores que faltam e apaga os órfãos. Devolve quantos calculou."""
        _, model, _ = self.settings()
        corpus = self._corpus()
        have = {(r["kind"], r["ref_id"]): r["text_hash"] for r in
                self.core.db.query("SELECT kind, ref_id, text_hash FROM vectors WHERE model = ?", (model,))}
        todo = [(k, i, t) for k, i, t in corpus if have.get((k, i)) != text_hash(t)]
        live = {(k, i) for k, i, _ in corpus}
        for k, i in set(have) - live:
            self.core.db.execute("DELETE FROM vectors WHERE kind = ? AND ref_id = ? AND model = ?", (k, i, model))
        if todo:
            vecs = await self.embed([t for _, _, t in todo])
            now = self.core.clock()
            for (k, i, t), v in zip(todo, vecs):
                self.core.db.execute(
                    "INSERT INTO vectors (kind, ref_id, model, text_hash, dim, vec, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(kind, ref_id, model) DO UPDATE SET text_hash = excluded.text_hash, dim = excluded.dim, "
                    "vec = excluded.vec, updated_at = excluded.updated_at", (k, i, model, text_hash(t), len(v), pack(v), now))
        return len(todo)

    async def nearest(self, query: str, kind_prefix: str, k: int = 5) -> list[tuple[float, str, int]]:
        """[(cosseno, tipo, id)] mais próximos da pergunta, só dos tipos que começam com kind_prefix."""
        _, model, _ = self.settings()
        await self.sync()
        rows = self.core.db.query("SELECT kind, ref_id, vec FROM vectors WHERE model = ? AND kind LIKE ?", (model, kind_prefix + "%"))
        if not rows:
            return []
        q = (await self.embed([query]))[0]
        sims = cosine_many(q, [unpack(r["vec"]) for r in rows])
        ranked = sorted(zip(sims, rows), key=lambda x: -x[0])[:k]
        return [(round(s, 4), r["kind"], r["ref_id"]) for s, r in ranked]
