"""ZOE COMPANION — memória pessoal (seções 3.1 e 3.2).

Um repositório genérico sobre as tabelas do banco. Cada tipo de lembrança
(livro, projeto, hobby…) declara seus campos; a API, o chat e a interface usam
os mesmos nomes em português. A Zoe só guarda o que o usuário disse ou
cadastrou: nada aqui é deduzido ou inventado.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from ..db import Database
from ..text import normalize, tokens


@dataclass(frozen=True)
class Field:
    column: str
    kind: str = "text"                 # text | int | choice
    max_len: int = 200
    choices: tuple[str, ...] = ()
    required: bool = False
    minimum: int = 0
    maximum: int = 10

    def clean(self, value: Any) -> Any:
        if self.kind == "int":
            if isinstance(value, bool) or not isinstance(value, int) or not self.minimum <= value <= self.maximum:
                raise ValueError(f"deve ser um número de {self.minimum} a {self.maximum}")
            return value
        if not isinstance(value, str):
            raise ValueError("deve ser texto")
        value = value.strip()
        if self.kind == "choice" and value not in self.choices:
            raise ValueError("opções: " + ", ".join(self.choices))
        if self.required and not value:
            raise ValueError("não pode ficar vazio")
        if len(value) > self.max_len:
            raise ValueError(f"máximo de {self.max_len} caracteres")
        return value


@dataclass(frozen=True)
class Kind:
    key: str
    label: str
    plural: str
    table: str
    name_field: str
    fields: dict[str, Field]
    touch_col: str
    created_col: str | None = None
    category: str | None = None        # tabelas compartilhadas (interests, personal_activities)
    defaults: dict[str, Any] = field(default_factory=dict)

    @property
    def name_col(self) -> str:
        return self.fields[self.name_field].column


BOOK_STATUS = ("quero_ler", "lendo", "pausado", "lido")
PROJECT_STATUS = ("ativo", "pausado", "concluido")
GOAL_STATUS = ("ativo", "pausado", "alcancado")


def _interest(key, label, plural):
    return Kind(key, label, plural, "interests", "nome",
                {"nome": Field("description", required=True, max_len=120), "notas": Field("notes", max_len=500),
                 "prioridade": Field("priority", "int", minimum=0, maximum=3)},
                touch_col="last_interaction", created_col="created_at", category=key)


KINDS: dict[str, Kind] = {k.key: k for k in (
    Kind("livro", "livro", "Livros", "books", "titulo",
         {"titulo": Field("title", required=True, max_len=160), "autor": Field("author", max_len=120),
          "capitulo": Field("current_chapter", max_len=40), "progresso": Field("progress", max_len=60),
          "status": Field("status", "choice", choices=BOOK_STATUS), "notas": Field("notes", max_len=500)},
         touch_col="last_update", created_col="started_at", defaults={"status": "lendo"}),
    Kind("projeto", "projeto", "Projetos", "personal_projects", "nome",
         {"nome": Field("name", required=True, max_len=120), "descricao": Field("description", max_len=500),
          "status": Field("status", "choice", choices=PROJECT_STATUS), "notas": Field("notes", max_len=500)},
         touch_col="last_interaction", created_col="created_at", defaults={"status": "ativo"}),
    Kind("objetivo", "objetivo", "Objetivos", "goals", "titulo",
         {"titulo": Field("title", required=True, max_len=160), "categoria": Field("kind", "choice", choices=("pessoal", "profissional")),
          "descricao": Field("description", max_len=500), "status": Field("status", "choice", choices=GOAL_STATUS),
          "prazo": Field("target_date", max_len=40)},
         touch_col="last_interaction", created_col="created_at", defaults={"status": "ativo", "categoria": "pessoal"}),
    _interest("aprender", "assunto para aprender", "Quero aprender"),
    Kind("hobby", "hobby", "Hobbies", "personal_activities", "nome",
         {"nome": Field("name", required=True, max_len=120), "frequencia": Field("frequency", max_len=60),
          "notas": Field("notes", max_len=500)},
         touch_col="last_interaction", created_col="created_at", category="hobby"),
    _interest("interesse", "interesse", "Interesses"),
    _interest("filme_serie", "filme ou série", "Filmes e séries"),
    _interest("musica", "música ou artista", "Músicas e artistas"),
    Kind("adiada", "atividade que você adia", "Costumo adiar", "personal_activities", "nome",
         {"nome": Field("name", required=True, max_len=120), "notas": Field("notes", max_len=500)},
         touch_col="last_interaction", created_col="created_at", category="adiada"),
)}

CATEGORY_COL = {"interests": "category", "personal_activities": "category"}


class Memory:
    def __init__(self, db: Database, clock: Callable[[], float]):
        self.db, self.clock = db, clock

    # ---------------- utilidades ----------------
    @staticmethod
    def kind(key: str) -> Kind:
        if key not in KINDS:
            raise KeyError(f"tipo desconhecido: {key}")
        return KINDS[key]

    def _where(self, k: Kind) -> tuple[str, list]:
        if k.category:
            return f"user_id = 1 AND {CATEGORY_COL[k.table]} = ?", [k.category]
        return "user_id = 1", []

    def _to_item(self, k: Kind, row: dict) -> dict:
        item = {}
        for name, f in k.fields.items():
            item[name] = row.get(f.column)
        item["id"], item["tipo"] = row["id"], k.key       # "tipo" e "id" são reservados: nenhum campo pode usá-los
        item["atualizado_em"] = row.get(k.touch_col)
        item["criado_em"] = row.get(k.created_col) if k.created_col else None
        return item

    def _clean(self, k: Kind, data: dict, partial: bool) -> dict[str, Any]:
        out = {}
        for name, value in data.items():
            if name not in k.fields:
                raise ValueError(f"campo desconhecido para {k.label}: {name}")
            try:
                out[k.fields[name].column] = k.fields[name].clean(value)
            except ValueError as e:
                raise ValueError(f"{name}: {e}") from None
        if not partial and not out.get(k.name_col):
            raise ValueError(f"{k.name_field}: obrigatório")
        return out

    # ---------------- leitura ----------------
    def list(self, key: str) -> list[dict]:
        k = self.kind(key)
        where, params = self._where(k)
        order = f"COALESCE({k.touch_col}, 0) DESC, id DESC"
        return [self._to_item(k, r) for r in self.db.query(f"SELECT * FROM {k.table} WHERE {where} ORDER BY {order}", params)]

    def all(self) -> dict[str, list[dict]]:
        return {key: self.list(key) for key in KINDS}

    def get(self, key: str, item_id: int) -> dict | None:
        k = self.kind(key)
        where, params = self._where(k)
        rows = self.db.query(f"SELECT * FROM {k.table} WHERE id = ? AND {where}", [item_id, *params])
        return self._to_item(k, rows[0]) if rows else None

    def find_by_name(self, key: str, name: str) -> dict | None:
        """Mesmo nome (sem acento/caixa) dentro do tipo."""
        target = normalize(name)
        return next((i for i in self.list(key) if normalize(i[KINDS[key].name_field] or "") == target), None)

    def search(self, text: str, keys: tuple[str, ...] | None = None) -> list[dict]:
        """Itens cujo nome casa com o texto: igual > contém > todas as palavras."""
        q, qt = normalize(text), tokens(text)
        if not q:
            return []
        scored = []
        for key in keys or tuple(KINDS):
            for it in self.list(key):
                n = normalize(it[KINDS[key].name_field] or "")
                if not n:
                    continue
                score = 3 if n == q else 2 if (q in n or n in q) else 1 if qt and qt <= tokens(n) else 0
                if score:
                    scored.append((score, it))
        scored.sort(key=lambda x: -x[0])
        best = scored[0][0] if scored else 0
        return [it for s, it in scored if s == best]

    # ---------------- escrita ----------------
    def create(self, key: str, data: dict) -> tuple[dict, bool]:
        """Cria; se já existir um item com o mesmo nome, atualiza esse (não duplica)."""
        k = self.kind(key)
        merged = {**{n: v for n, v in k.defaults.items()}, **data}
        cols = self._clean(k, merged, partial=False)
        existing = self.find_by_name(key, cols[k.name_col])
        if existing:
            changes = {n: v for n, v in data.items() if n != k.name_field}
            return (self.update(key, existing["id"], changes) if changes else self.touch(key, existing["id"])), False
        now = self.clock()
        cols[k.touch_col] = now
        if k.created_col:
            cols[k.created_col] = now
        if k.category:
            cols[CATEGORY_COL[k.table]] = k.category
        cols["user_id"] = 1
        names = ", ".join(cols)
        cur = self.db.execute(f"INSERT INTO {k.table} ({names}) VALUES ({', '.join('?' * len(cols))})", list(cols.values()))
        return self.get(key, cur.lastrowid), True

    def update(self, key: str, item_id: int, data: dict) -> dict:
        k = self.kind(key)
        if not self.get(key, item_id):
            raise LookupError("item não encontrado")
        cols = self._clean(k, data, partial=True)
        if k.name_col in cols and not cols[k.name_col]:
            raise ValueError(f"{k.name_field}: não pode ficar vazio")
        cols[k.touch_col] = self.clock()
        sets = ", ".join(f"{c} = ?" for c in cols)
        self.db.execute(f"UPDATE {k.table} SET {sets} WHERE id = ?", [*cols.values(), item_id])
        return self.get(key, item_id)

    def touch(self, key: str, item_id: int) -> dict | None:
        """Registra que o assunto foi conversado agora (sem mudar o conteúdo)."""
        k = self.kind(key)
        self.db.execute(f"UPDATE {k.table} SET {k.touch_col} = ? WHERE id = ?", [self.clock(), item_id])
        return self.get(key, item_id)

    def delete(self, key: str, item_id: int) -> bool:
        k = self.kind(key)
        where, params = self._where(k)
        return self.db.execute(f"DELETE FROM {k.table} WHERE id = ? AND {where}", [item_id, *params]).rowcount > 0


def describe(item: dict) -> str:
    """Texto curto e fiel ao que foi guardado (para o chat)."""
    k = KINDS[item["tipo"]]
    name = item[k.name_field]
    if k.key == "livro":
        parts = [name + (f", de {item['autor']}" if item.get("autor") else "")]
        if item.get("capitulo"):
            parts.append(f"capítulo {item['capitulo']}")
        if item.get("progresso"):
            parts.append(item["progresso"])
        status = {"quero_ler": "quer ler", "lendo": "lendo", "pausado": "pausado", "lido": "lido"}[item["status"]]
        return f"{parts[0]} ({', '.join(parts[1:] + [status])})"
    if k.key in ("projeto", "objetivo") and item.get("status") not in (None, "ativo"):
        return f"{name} ({item['status'].replace('concluido', 'concluído').replace('alcancado', 'alcançado')})"
    if k.key == "hobby" and item.get("frequencia"):
        return f"{name} ({item['frequencia']})"
    return name


for _k in KINDS.values():
    assert not {"id", "tipo", "atualizado_em", "criado_em"} & set(_k.fields), f"campo reservado em {_k.key}"
