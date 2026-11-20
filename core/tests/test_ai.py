import asyncio

import pytest

from fake_ollama import FakeOllama
from zoe_core.ai.engine import AIEngine, clean_reply, is_local_url
from zoe_core.server import build_app

TOKEN = "t0k3n"
H = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
async def fake(aiohttp_server, db):
    f = FakeOllama()
    server = await aiohttp_server(f.app())
    db.update_settings({"ia_url": str(server.make_url("")).rstrip("/")})
    return f


# ---------------- estado ----------------
async def test_status_without_ollama(core):
    st = await core.ai.status()
    assert st["ollama"] is False and "ollama.com/install.sh" in st["hint"]


async def test_status_with_and_without_model(core, fake, db):
    st = await core.ai.status()
    assert st["ollama"] and st["model_installed"] and st["version"] == "0.99.0-fake"
    db.update_settings({"ia_modelo": "gemma3:270m"})
    st = await core.ai.status()
    assert not st["model_installed"] and "~290 MB" in st["hint"]


# ---------------- conversa ----------------
async def test_free_chat_streams_and_is_logged(core, fake, db):
    got = []

    async def delta(p):
        got.append(p)

    r = await core.chat.reply("Qual é a capital da França?", on_delta=delta)
    assert r.text == "Paris é a capital da França."
    assert "".join(got) == "Paris é a capital da França."
    assert db.interactions()[-1]["response"] == r.text


async def test_prompt_has_only_stored_facts(core, fake, db):
    db.update_settings({"nome_usuario": "Ayalan", "tom": "direto"})
    await core.chat.reply("estou lendo Duna, de Frank Herbert, no capítulo 5")
    await core.chat.reply("me recomenda um livro?")
    body = fake.requests[-1]
    assert body["model"] == "qwen3:0.6b" and body["stream"] is True and body["think"] is False
    assert body["options"]["num_ctx"] == 2048 and body["keep_alive"] == "5m"
    system = body["messages"][0]["content"]
    assert "Nome do usuário: Ayalan" in system and "Duna, de Frank Herbert (capítulo 5, lendo)" in system
    assert "Nunca invente fatos sobre o usuário" in system and "uma ou duas frases" in system
    # histórico: a conversa anterior vai junto, a mensagem atual por último
    assert body["messages"][-1] == {"role": "user", "content": "me recomenda um livro?"}
    assert {"role": "user", "content": "estou lendo Duna, de Frank Herbert, no capítulo 5"} in body["messages"]


async def test_rules_answer_without_calling_the_model(core, fake):
    await core.chat.reply("foco 10")
    await core.chat.reply("ajuda")
    await core.chat.reply("quero aprender Rust")
    assert fake.requests == []


async def test_think_blocks_and_markdown_never_show(core, fake):
    fake.chunks = ["<think>o usuário quer", " saber…</think>", "**Claro!** ", "Posso ajudar."]
    got = []

    async def delta(p):
        got.append(p)

    r = await core.chat.reply("pode me ajudar?", on_delta=delta)
    assert r.text == "Claro! Posso ajudar."
    assert "think" not in "".join(got) and "o usuário quer" not in "".join(got)


async def test_missing_model_and_disabled(core, fake, db):
    db.update_settings({"ia_modelo": "gemma3:270m"})
    r = await core.chat.reply("conta uma curiosidade")
    assert "ainda não foi baixado" in r.text
    db.update_settings({"ia_ativa": False})
    n = len(fake.requests)
    r = await core.chat.reply("conta uma curiosidade")
    assert "desligada" in r.text and len(fake.requests) == n


async def test_without_ollama_explains_how_to_install(core):
    r = await core.chat.reply("conta uma piada")
    assert "ollama.com/install.sh" in r.text


def test_helpers():
    assert is_local_url("http://127.0.0.1:11434") and is_local_url("http://localhost:11434")
    assert not is_local_url("http://192.168.0.10:11434")
    assert not is_local_url("https://api.exemplo.com")
    assert not is_local_url("http://127.0.0.1:11434/api")
    long = "Frase um. " * 200
    assert len(clean_reply(long)) <= 900 and clean_reply(long).endswith(".")
    assert clean_reply("# Título\n\n\n\n`código` **forte**") == "Título\n\ncódigo forte"


# ---------------- download do modelo ----------------
async def test_pull_reports_progress(core, fake, db, sink):
    core.hub.broadcast = sink
    db.update_settings({"ia_modelo": "gemma3:270m"})
    assert core.ai.start_pull() is True
    assert core.ai.start_pull() is False                 # um download por vez
    await core.ai._pull_task
    assert core.ai.pull_state["done"] and core.ai.pull_state["error"] is None
    msgs = [m["pull"] for m in sink.of("ai.pull")]
    assert msgs[-1]["status"] == "success"
    assert (await core.ai.status())["model_installed"] is True


# ---------------- API / WebSocket ----------------
@pytest.fixture
async def client(aiohttp_client, core):
    return await aiohttp_client(build_app(core, TOKEN))


async def test_ai_routes_and_settings(client, db):
    st = await (await client.get("/api/ai", headers=H)).json()
    assert st["ollama"] is False and st["models"][0]["id"] == "qwen3:0.6b"
    assert (await client.post("/api/ai/pull", json={}, headers=H)).status == 503
    assert (await client.patch("/api/settings", json={"ia_url": "http://api.exemplo.com:11434"}, headers=H)).status == 400
    assert (await client.patch("/api/settings", json={"ia_modelo": "Qwen; rm -rf"}, headers=H)).status == 400
    assert (await client.patch("/api/settings", json={"ia_modelo": "gemma3:270m"}, headers=H)).status == 200


async def test_ws_streams_deltas_then_reply(client, fake):
    fake.delay = 0.02
    ws = await client.ws_connect(f"/ws?token={TOKEN}")
    await ws.receive_json()
    await ws.send_json({"type": "chat", "text": "qual a capital da França?", "ref": 3})
    await ws.send_json({"type": "ping"})                 # o WebSocket continua respondendo durante a IA
    deltas, pong_before_reply = [], False
    while True:
        m = await ws.receive_json(timeout=5)
        if m["type"] == "pong":
            pong_before_reply = True
        elif m["type"] == "chat.delta":
            deltas.append(m["text"])
        elif m["type"] == "chat.reply":
            break
    assert m["ref"] == 3 and m["text"] == "Paris é a capital da França."
    assert len(deltas) == 3 and pong_before_reply
    await ws.close()
