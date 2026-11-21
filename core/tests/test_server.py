import json

import pytest

from zoe_core.server import build_app, write_runtime_file

TOKEN = "t0k3n"
H = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
async def client(aiohttp_client, core):
    return await aiohttp_client(build_app(core, TOKEN))


async def test_requires_token(client):
    assert (await client.get("/api/health")).status == 401
    assert (await client.get("/api/health", headers={"Authorization": "Bearer errado"})).status == 401
    r = await client.get("/api/health", headers=H)
    assert r.status == 200 and (await r.json())["ok"]


async def test_chat(client):
    r = await client.post("/api/chat", json={"text": "ajuda"}, headers=H)
    assert "foco" in (await r.json())["text"]
    r = await client.get("/api/interactions", headers=H)
    assert (await r.json())[-1]["context"] == "ajuda"


async def test_settings_validation(client):
    r = await client.patch("/api/settings", json={"frequencia": "baixa"}, headers=H)
    assert (await r.json())["frequencia"] == "baixa"
    assert (await client.patch("/api/settings", json={"frequencia": "muita"}, headers=H)).status == 400
    assert (await client.patch("/api/settings", json={"silencio_inicio": "25:00"}, headers=H)).status == 400
    # mudar monitoramento só pelas rotas próprias
    assert (await client.patch("/api/settings", json={"monitoramento_ativo": False}, headers=H)).status == 400
    assert (await client.patch("/api/settings", data="[1]", headers=H)).status == 400


async def test_client_events_whitelist(client, db):
    r = await client.post("/api/events", json={"type": "USER_IDLE", "payload": {"idle_s": 300}}, headers=H)
    assert r.status == 200
    r = await client.post("/api/events", json={"type": "EMERGENCY_STOP"}, headers=H)
    assert r.status == 403
    assert (await client.post("/api/events", json={"type": "rm -rf"}, headers=H)).status == 400


async def test_focus_routes(client):
    r = await client.post("/api/focus/start", json={"minutes": 10}, headers=H)
    assert (await r.json())["minutes"] == 10
    assert (await client.post("/api/focus/start", json={"minutes": 0}, headers=H)).status == 400
    r = await client.post("/api/focus/stop", json={}, headers=H)
    assert (await r.json())["stopped"] is True


async def test_emergency_and_resume(client):
    st = await (await client.post("/api/emergency-stop", json={}, headers=H)).json()
    assert st["monitoring"] is False and st["interventions"] is False
    st = await (await client.post("/api/monitoring", json={"active": True}, headers=H)).json()
    assert st["monitoring"] is True


async def test_delete_personal_data_needs_confirm(client, db):
    db.log_interaction("chat", "x", "y")
    assert (await client.post("/api/personal-data/delete", json={}, headers=H)).status == 400
    assert (await client.post("/api/personal-data/delete", json={"confirm": "APAGAR"}, headers=H)).status == 200
    assert db.interactions() == []


async def test_websocket_flow(client, core):
    assert (await client.get("/ws")).status == 401
    ws = await client.ws_connect(f"/ws?token={TOKEN}")
    hello = await ws.receive_json()
    assert hello["type"] == "hello" and "foco" in hello["expressions"]
    await ws.send_json({"type": "chat", "text": "foco 5", "ref": 7})
    seen = {}
    for _ in range(6):
        m = await ws.receive_json(timeout=2)
        seen.setdefault(m["type"], m)
        if "chat.reply" in seen:
            break
    assert seen["expression"]["name"] == "foco"
    assert seen["chat.reply"]["ref"] == 7 and seen["chat.reply"]["expression"] == "foco"
    # notificação do foco concluído chega pelo WS e o ack funciona
    from zoe_core.events import EventType
    await core.publish(EventType.FOCUS_SESSION_ENDED, {"minutes": 5, "completed": True})
    while True:
        m = await ws.receive_json(timeout=2)
        if m["type"] == "notification":
            break
    nid = m["notification"]["id"]
    await ws.send_json({"type": "notification.ack", "id": nid, "action": "dismiss"})
    await ws.send_json({"type": "ping"})
    while (await ws.receive_json(timeout=2))["type"] != "pong":
        pass
    assert core.notifications.history()[0]["status"] == "lida"
    await ws.close()


def test_runtime_file_permissions(tmp_path):
    p = tmp_path / "run" / "core.json"
    write_runtime_file(p, 1234, "abc")
    assert json.loads(p.read_text())["port"] == 1234
    assert (p.stat().st_mode & 0o777) == 0o600


async def test_pc_routes(aiohttp_client, db, clock):
    from zoe_core.core import ZoeCore
    core = ZoeCore(db, enable_pc=True)          # coletor real
    client = await aiohttp_client(build_app(core, TOKEN))
    r = await client.get("/api/pc", headers=H)
    data = await r.json()
    assert r.status == 200 and data["snapshot"]["memory"]["total"] > 0 and "cpu" in data["history"]
    r = await client.get("/api/pc/diagnose", headers=H)
    d = await r.json()
    assert "summary" in d and isinstance(d["findings"], list)
    ws = await client.ws_connect(f"/ws?token={TOKEN}")
    assert (await ws.receive_json())["state"]["pc"]["available"] is True
    await ws.send_json({"type": "pc.subscribe", "on": True})
    while (m := await ws.receive_json(timeout=5))["type"] != "pc":
        pass
    assert m["snapshot"]["cpu"]["cores"] >= 1
    await ws.close()


async def test_pc_unavailable_503(client):
    assert (await client.get("/api/pc", headers=H)).status == 503


async def test_pc_limits_validation_and_merge(client):
    r = await client.patch("/api/settings", json={"pc_limites": {"ram_pct": 85}}, headers=H)
    lim = (await r.json())["pc_limites"]
    assert lim["ram_pct"] == 85 and lim["cpu_pct"] == 90
    r = await client.patch("/api/settings", json={"pc_limites": {"cpu_pct": 80}}, headers=H)
    lim = (await r.json())["pc_limites"]
    assert lim["ram_pct"] == 85 and lim["cpu_pct"] == 80       # o anterior não se perdeu
    assert (await client.patch("/api/settings", json={"pc_limites": {"ram_pct": 10}}, headers=H)).status == 400
    assert (await client.patch("/api/settings", json={"pc_limites": {"xyz": 10}}, headers=H)).status == 400
    assert (await client.patch("/api/settings", json={"pc_intervalo_s": 1}, headers=H)).status == 400
