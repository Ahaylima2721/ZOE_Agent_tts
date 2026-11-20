"""ZOE DATABASE: SQLite local com migrações versionadas e política de retenção.

O esquema segue a seção 8 da especificação, com chaves estrangeiras para o
usuário e índices nas colunas usadas em consultas por tempo/status.
Versão do esquema em PRAGMA user_version.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable

from .config import DEFAULT_SETTINGS

MIGRATIONS: list[str] = [
    # v1 — esquema inicial
    """
    CREATE TABLE users (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL DEFAULT '',
        preferences TEXT NOT NULL DEFAULT '{}',
        created_at  REAL NOT NULL
    );
    CREATE TABLE interests (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category    TEXT NOT NULL,
        description TEXT NOT NULL,
        priority    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_interests_user_cat ON interests(user_id, category);
    CREATE TABLE personal_projects (
        id               INTEGER PRIMARY KEY,
        user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name             TEXT NOT NULL,
        description      TEXT NOT NULL DEFAULT '',
        status           TEXT NOT NULL DEFAULT 'ativo',
        last_interaction REAL
    );
    CREATE INDEX idx_projects_user_status ON personal_projects(user_id, status);
    CREATE TABLE personal_activities (
        id        INTEGER PRIMARY KEY,
        user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name      TEXT NOT NULL,
        category  TEXT NOT NULL DEFAULT '',
        frequency TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE books (
        id              INTEGER PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title           TEXT NOT NULL,
        author          TEXT NOT NULL DEFAULT '',
        current_chapter TEXT NOT NULL DEFAULT '',
        status          TEXT NOT NULL DEFAULT 'lendo',
        started_at      REAL,
        last_update     REAL
    );
    CREATE INDEX idx_books_user_status ON books(user_id, status);
    CREATE TABLE tasks (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title        TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        scheduled_at REAL,
        status       TEXT NOT NULL DEFAULT 'pendente'
    );
    CREATE INDEX idx_tasks_status_when ON tasks(status, scheduled_at);
    CREATE TABLE application_usage (
        id          INTEGER PRIMARY KEY,
        application TEXT NOT NULL,
        category    TEXT NOT NULL DEFAULT '',
        duration    REAL NOT NULL,
        timestamp   REAL NOT NULL
    );
    CREATE INDEX idx_appusage_time ON application_usage(timestamp);
    CREATE INDEX idx_appusage_app_time ON application_usage(application, timestamp);
    CREATE TABLE focus_rules (
        id                  INTEGER PRIMARY KEY,
        user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        application         TEXT NOT NULL,
        daily_limit         INTEGER NOT NULL,
        monitoring_schedule TEXT NOT NULL DEFAULT '{}',
        intervention_level  INTEGER NOT NULL DEFAULT 1 CHECK (intervention_level BETWEEN 1 AND 4)
    );
    CREATE UNIQUE INDEX idx_focus_rules_app ON focus_rules(user_id, application);
    CREATE TABLE system_metrics (
        id          INTEGER PRIMARY KEY,
        cpu_usage   REAL,
        ram_usage   REAL,
        gpu_usage   REAL,
        disk_usage  REAL,
        temperature REAL,
        timestamp   REAL NOT NULL
    );
    CREATE INDEX idx_metrics_time ON system_metrics(timestamp);
    CREATE TABLE interactions (
        id               INTEGER PRIMARY KEY,
        user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE,
        interaction_type TEXT NOT NULL,
        context          TEXT NOT NULL DEFAULT '',
        response         TEXT NOT NULL DEFAULT '',
        timestamp        REAL NOT NULL
    );
    CREATE INDEX idx_interactions_time ON interactions(timestamp);
    CREATE TABLE notifications (
        id           INTEGER PRIMARY KEY,
        user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
        message      TEXT NOT NULL,
        category     TEXT NOT NULL,
        origin       TEXT NOT NULL DEFAULT 'espontanea',
        expression   TEXT,
        actions      TEXT NOT NULL DEFAULT '[]',
        dedupe_key   TEXT,
        scheduled_at REAL NOT NULL,
        delivered_at REAL,
        status       TEXT NOT NULL DEFAULT 'pendente'
    );
    CREATE INDEX idx_notifications_status ON notifications(status, scheduled_at);
    CREATE INDEX idx_notifications_dedupe ON notifications(dedupe_key, scheduled_at);
    CREATE TABLE events (
        id        INTEGER PRIMARY KEY,
        type      TEXT NOT NULL,
        source    TEXT NOT NULL,
        payload   TEXT NOT NULL DEFAULT '{}',
        decision  TEXT,
        timestamp REAL NOT NULL
    );
    CREATE INDEX idx_events_time ON events(timestamp);
    CREATE INDEX idx_events_type_time ON events(type, timestamp);
    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """,
    # v2 — memória pessoal (Fase 3): datas de conversa, notas, progresso e objetivos
    """
    ALTER TABLE interests ADD COLUMN notes TEXT NOT NULL DEFAULT '';
    ALTER TABLE interests ADD COLUMN created_at REAL;
    ALTER TABLE interests ADD COLUMN last_interaction REAL;
    ALTER TABLE books ADD COLUMN progress TEXT NOT NULL DEFAULT '';
    ALTER TABLE books ADD COLUMN notes TEXT NOT NULL DEFAULT '';
    ALTER TABLE personal_projects ADD COLUMN notes TEXT NOT NULL DEFAULT '';
    ALTER TABLE personal_projects ADD COLUMN created_at REAL;
    ALTER TABLE personal_activities ADD COLUMN notes TEXT NOT NULL DEFAULT '';
    ALTER TABLE personal_activities ADD COLUMN created_at REAL;
    ALTER TABLE personal_activities ADD COLUMN last_interaction REAL;
    CREATE INDEX idx_activities_user_cat ON personal_activities(user_id, category);
    CREATE TABLE goals (
        id               INTEGER PRIMARY KEY,
        user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title            TEXT NOT NULL,
        kind             TEXT NOT NULL DEFAULT 'pessoal' CHECK (kind IN ('pessoal', 'profissional')),
        description      TEXT NOT NULL DEFAULT '',
        status           TEXT NOT NULL DEFAULT 'ativo',
        target_date      TEXT NOT NULL DEFAULT '',
        created_at       REAL,
        last_interaction REAL
    );
    CREATE INDEX idx_goals_user_status ON goals(user_id, status);
    """,
]

# Tabelas com dados pessoais (apagadas em "apagar meus dados").
PERSONAL_TABLES = (
    "interests", "personal_projects", "personal_activities", "books", "tasks", "goals",
    "focus_rules", "interactions", "notifications", "application_usage", "events",
)

# Coluna de tempo usada pela retenção de cada tabela.
RETENTION_COLUMNS = {
    "system_metrics": "timestamp",
    "application_usage": "timestamp",
    "events": "timestamp",
    "notifications": "scheduled_at",
}


class Database:
    """Acesso thread-safe ao SQLite (uma conexão, protegida por lock)."""

    def __init__(self, path: Path | str, clock=time.time):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        if self.path != ":memory:":
            self.conn.execute("PRAGMA journal_mode = WAL")
        self.migrate()
        self._ensure_user()

    # ---------------- infraestrutura ----------------
    @property
    def schema_version(self) -> int:
        return self.conn.execute("PRAGMA user_version").fetchone()[0]

    def migrate(self) -> None:
        with self._lock:
            current = self.schema_version
            for version, sql in enumerate(MIGRATIONS[current:], start=current + 1):
                self.conn.execute("BEGIN")
                try:
                    for stmt in _split_sql(sql):
                        self.conn.execute(stmt)
                    self.conn.execute(f"PRAGMA user_version = {version}")
                    self.conn.execute("COMMIT")
                except Exception:
                    self.conn.execute("ROLLBACK")
                    raise

    def _ensure_user(self) -> None:
        with self._lock:
            if not self.conn.execute("SELECT 1 FROM users WHERE id = 1").fetchone():
                self.conn.execute("INSERT INTO users (id, name, created_at) VALUES (1, '', ?)", (self.clock(),))

    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            return self.conn.execute(sql, tuple(params))

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self.conn.execute(sql, tuple(params)).fetchall()]

    def close(self) -> None:
        with self._lock:
            self.conn.close()

    # ---------------- configurações ----------------
    def get_settings(self) -> dict:
        stored = {r["key"]: json.loads(r["value"]) for r in self.query("SELECT key, value FROM settings")}
        merged = json.loads(json.dumps(DEFAULT_SETTINGS))
        for k, v in stored.items():
            if k in merged and isinstance(merged[k], dict) and isinstance(v, dict):
                merged[k].update(v)
            else:
                merged[k] = v
        return merged

    def update_settings(self, changes: dict) -> dict:
        with self._lock:
            for k, v in changes.items():
                self.conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (k, json.dumps(v)),
                )
        return self.get_settings()

    # ---------------- eventos / interações ----------------
    def log_event(self, type_: str, source: str, payload: dict, decision: str | None, ts: float) -> int:
        cur = self.execute(
            "INSERT INTO events (type, source, payload, decision, timestamp) VALUES (?, ?, ?, ?, ?)",
            (type_, source, json.dumps(payload, ensure_ascii=False), decision, ts),
        )
        return cur.lastrowid

    def log_interaction(self, kind: str, context: str, response: str, ts: float | None = None) -> int:
        cur = self.execute(
            "INSERT INTO interactions (user_id, interaction_type, context, response, timestamp) VALUES (1, ?, ?, ?, ?)",
            (kind, context, response, ts if ts is not None else self.clock()),
        )
        return cur.lastrowid

    def interactions(self, limit: int = 50) -> list[dict]:
        rows = self.query("SELECT * FROM interactions ORDER BY timestamp DESC, id DESC LIMIT ?", (limit,))
        return list(reversed(rows))

    # ---------------- retenção / privacidade ----------------
    def apply_retention(self, now: float | None = None) -> dict[str, int]:
        now = self.clock() if now is None else now
        days = self.get_settings()["retencao_dias"]
        removed = {}
        with self._lock:
            for table, col in RETENTION_COLUMNS.items():
                d = days.get(table)
                if not d or d <= 0:
                    continue
                cur = self.conn.execute(f"DELETE FROM {table} WHERE {col} < ?", (now - d * 86400,))
                removed[table] = cur.rowcount
        return removed

    def delete_personal_data(self) -> None:
        with self._lock:
            self.conn.execute("BEGIN")
            try:
                for t in PERSONAL_TABLES:
                    self.conn.execute(f"DELETE FROM {t}")
                self.conn.execute("UPDATE users SET name = '', preferences = '{}' WHERE id = 1")
                self.conn.execute("DELETE FROM settings WHERE key = 'nome_usuario'")
                self.conn.execute("COMMIT")
            except Exception:
                self.conn.execute("ROLLBACK")
                raise


def _split_sql(script: str) -> list[str]:
    return [s.strip() for s in script.split(";") if s.strip()]
