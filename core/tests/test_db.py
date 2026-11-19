from zoe_core.db import MIGRATIONS, Database


def test_schema_created(db):
    assert db.schema_version == len(MIGRATIONS)
    tables = {r["name"] for r in db.query("SELECT name FROM sqlite_master WHERE type='table'")}
    for t in ("users", "interests", "personal_projects", "personal_activities", "books", "tasks",
              "application_usage", "focus_rules", "system_metrics", "interactions", "notifications",
              "events", "settings"):
        assert t in tables
    assert db.query("SELECT id FROM users") == [{"id": 1}]


def test_migrate_is_idempotent(tmp_path, clock):
    p = tmp_path / "z.db"
    Database(p, clock=clock).close()
    d = Database(p, clock=clock)
    assert d.schema_version == len(MIGRATIONS)
    assert len(d.query("SELECT id FROM users")) == 1


def test_foreign_keys_enforced(db):
    import sqlite3
    import pytest
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO books (user_id, title) VALUES (999, 'x')")


def test_settings_merge_defaults(db):
    s = db.update_settings({"frequencia": "baixa", "retencao_dias": {"events": 5}})
    assert s["frequencia"] == "baixa"
    assert s["retencao_dias"]["events"] == 5
    assert s["retencao_dias"]["system_metrics"] == 7  # padrão mantido


def test_retention_removes_only_old_rows(db, clock):
    now = clock()
    db.execute("INSERT INTO system_metrics (cpu_usage, timestamp) VALUES (1, ?)", (now - 8 * 86400,))
    db.execute("INSERT INTO system_metrics (cpu_usage, timestamp) VALUES (2, ?)", (now - 1 * 86400,))
    db.log_event("USER_IDLE", "t", {}, None, now - 40 * 86400)
    removed = db.apply_retention()
    assert removed["system_metrics"] == 1 and removed["events"] == 1
    assert [r["cpu_usage"] for r in db.query("SELECT cpu_usage FROM system_metrics")] == [2]


def test_delete_personal_data(db):
    db.update_settings({"nome_usuario": "Ana", "frequencia": "alta"})
    db.execute("INSERT INTO books (user_id, title) VALUES (1, 'Duna')")
    db.log_interaction("chat", "oi", "oi!")
    db.delete_personal_data()
    assert db.query("SELECT * FROM books") == []
    assert db.interactions() == []
    s = db.get_settings()
    assert s["nome_usuario"] == "" and s["frequencia"] == "alta"
