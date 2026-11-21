import pytest

from zoe_core.dashboard import build, greeting
from zoe_core.server import build_app

TOKEN = "t0k3n"
H = {"Authorization": f"Bearer {TOKEN}"}
DAY = 86400


# ---------------- tarefas ----------------
def test_task_crud_and_validation(core):
    t = core.tasks.create({"titulo": "Estudar Python", "categoria": "estudo"})
    assert t["para"] == "2026-11-19" and not t["concluida"] and t["categoria"] == "estudo"
    t = core.tasks.update(t["id"], {"concluida": True})
    assert t["concluida"] and t["concluida_em"]
    with pytest.raises(ValueError):
        core.tasks.create({"titulo": " "})
    with pytest.raises(ValueError):
        core.tasks.create({"titulo": "x", "categoria": "festa"})
    with pytest.raises(ValueError):
        core.tasks.create({"titulo": "x", "para": "amanhã"})
    with pytest.raises(LookupError):
        core.tasks.update(999, {"concluida": True})
    assert core.tasks.delete(t["id"]) and not core.tasks.delete(t["id"])


def test_today_scope(core, clock):
    late = core.tasks.create({"titulo": "Atrasada", "para": "2026-11-10"})
    core.tasks.create({"titulo": "Futura", "para": "2026-12-01"})
    done_y = core.tasks.create({"titulo": "Feita ontem"})
    clock.advance(-DAY)
    core.tasks.update(done_y["id"], {"concluida": True})
    clock.advance(DAY)
    done_t = core.tasks.create({"titulo": "Feita hoje"})
    core.tasks.update(done_t["id"], {"concluida": True})
    today = [t["titulo"] for t in core.tasks.list("hoje")]
    assert today == ["Feita hoje", "Atrasada"]                       # concluídas no topo, como no mockup
    assert core.tasks.next_due()["titulo"] == "Futura"
    assert core.tasks.find_open("atras")[0]["id"] == late["id"]


# ---------------- foco ----------------
async def test_focus_pause_resume_counts_only_focused_time(core, db, clock, sink):
    await core.focus.start(25, "estudo")
    clock.advance(10 * 60)
    assert await core.focus.pause()
    assert not await core.focus.pause()
    clock.advance(30 * 60)                                            # pausa não conta
    st = core.focus.status()
    assert st["paused"] and st["remaining_s"] == 15 * 60 and st["focused_s"] == 10 * 60
    assert await core.focus.resume()
    clock.advance(5 * 60)
    await core.focus.stop()
    row = db.query("SELECT * FROM focus_sessions")[0]
    assert (row["category"], row["focused_s"], row["completed"]) == ("estudo", 15 * 60, 0)
    with pytest.raises(ValueError):
        await core.focus.start(10, "festa")


# ---------------- painel ----------------
def test_greeting():
    assert greeting(8) == "Bom dia" and greeting(15) == "Boa tarde" and greeting(22) == "Boa noite" and greeting(3) == "Boa noite"


async def test_dashboard_from_real_data(core, db, clock, sink):
    db.update_settings({"nome_usuario": "Ayalan"})
    empty = build(core)
    assert empty["saudacao"] == "Boa tarde, Ayalan!" and empty["resumo"] == "Nenhuma tarefa concluída ainda hoje."
    assert empty["categorias"] == [] and empty["produtividade"]["variacao_pct"] is None
    assert [d["foco_min"] for d in empty["produtividade"]["dias"]] == [0] * 7 and empty["produtividade"]["dias"][-1]["hoje"]
    # semana anterior: 60 min; esta semana: 90 min (estudo 60 + trabalho 30) → +50%
    clock.advance(-8 * DAY)
    await core.focus.start(60, "estudo"); clock.advance(3600); await core.focus.stop()
    clock.advance(8 * DAY - 3600)
    await core.focus.start(60, "estudo"); clock.advance(3600); await core.focus.stop()
    await core.focus.start(30, "trabalho"); clock.advance(1800); await core.focus.stop()
    for title in ("Analisar dados do Fluxo", "Estudar Python"):
        t = core.tasks.create({"titulo": title})
        core.tasks.update(t["id"], {"concluida": True})
    core.tasks.create({"titulo": "Revisar o portfólio"})
    d = build(core)
    assert d["resumo"] == "Você concluiu 2 tarefas hoje. Próxima: Revisar o portfólio."
    assert d["produtividade"]["variacao_pct"] == 50 and d["produtividade"]["foco_min_semana"] == 90
    assert d["produtividade"]["dias"][-1]["foco_min"] == 90 and d["produtividade"]["dias"][-1]["tarefas"] == 2
    assert d["categorias"] == [{"id": "estudo", "nome": "Estudo", "minutos": 60, "pct": 67},
                               {"id": "trabalho", "nome": "Trabalho", "minutos": 30, "pct": 33}]
    assert [t["titulo"] for t in d["hoje"]][:2] == ["Analisar dados do Fluxo", "Estudar Python"]
    assert d["numeros"]["tarefas_hoje"] == 2 and d["status"]["label"] == "Disponível"


async def test_dashboard_suggestion_and_status(core, db, sink):
    core.memory.create("projeto", {"nome": "Fluxo"})
    assert build(core)["resumo"].endswith("Que tal focar no projeto Fluxo?")
    await core.focus.start(25, "trabalho")
    d = build(core)
    assert d["status"]["label"] == "Em foco" and "faltam 25 min" in d["resumo"]
    assert d["categorias"] == []                                      # menos de 30 s ainda: não aparece
    await core.focus.pause()
    assert build(core)["resumo"].endswith("Seu foco está pausado.")


# ---------------- chat ----------------
async def test_chat_tasks_and_focus(core, sink):
    r = await core.chat.reply("nova tarefa: Praticar guitarra")
    assert r.text == "Anotei para hoje: Praticar guitarra."
    assert "Praticar guitarra" in (await core.chat.reply("minhas tarefas")).text
    r = await core.chat.reply("foco 20 estudo")
    assert core.focus.status()["category"] == "estudo" and core.focus.status()["minutes"] == 20
    assert "pausado" in (await core.chat.reply("pausar foco")).text
    assert "retomado" in (await core.chat.reply("continuar foco")).text


# ---------------- API ----------------
@pytest.fixture
async def client(aiohttp_client, core):
    return await aiohttp_client(build_app(core, TOKEN))


async def test_api(client):
    r = await client.post("/api/tasks", json={"titulo": "Revisar o portfólio", "categoria": "trabalho"}, headers=H)
    assert r.status == 201
    tid = (await r.json())["id"]
    assert (await client.patch(f"/api/tasks/{tid}", json={"concluida": True}, headers=H)).status == 200
    assert (await client.patch(f"/api/tasks/{tid}", json={"concluida": "sim"}, headers=H)).status == 400
    assert len(await (await client.get("/api/tasks?escopo=hoje", headers=H)).json()) == 1
    d = await (await client.get("/api/dashboard", headers=H)).json()
    assert d["numeros"]["tarefas_hoje"] == 1
    r = await client.post("/api/focus/start", json={"minutes": 25, "categoria": "estudo"}, headers=H)
    assert (await r.json())["category"] == "estudo"
    assert (await (await client.post("/api/focus/pause", json={}, headers=H)).json())["focus"]["paused"] is True
    assert (await (await client.post("/api/focus/resume", json={}, headers=H)).json())["focus"]["paused"] is False
    assert (await client.post("/api/focus/start", json={"minutes": 25, "categoria": "x"}, headers=H)).status == 400
    assert (await client.delete(f"/api/tasks/{tid}", headers=H)).status == 200
