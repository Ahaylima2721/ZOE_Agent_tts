import pytest

from fake_ollama import FakeOllama
from zoe_core.learning import semantic
from zoe_core.learning.semantic import CALIBRATION, entities, same_entities
from zoe_core.server import build_app

TOKEN = "t0k3n"
H = {"Authorization": f"Bearer {TOKEN}"}
Q = "Quem escreveu O Fantasma da Ópera?"
PARAFRASE = "Quem é o autor de O Fantasma da Ópera?"


@pytest.fixture
async def fake(aiohttp_server, db):
    f = FakeOllama(installed=("qwen3:0.6b", "paraphrase-multilingual"), chunks=("Resposta ", "da IA."))
    server = await aiohttp_server(f.app())
    db.update_settings({"ia_url": str(server.make_url("")).rstrip("/")})
    return f


def chat_calls(fake):
    return [r for r in fake.requests if "messages" in r]


# ---------------- guarda de nomes próprios ----------------
def test_entities_guard():
    assert entities("Qual a capital da França?") == {"franca"}
    assert not same_entities("Qual a capital da França?", "Qual a capital da Alemanha?")
    assert same_entities(Q, PARAFRASE)
    assert same_entities("Qual a capital da França?", "Qual é a capital francesa?")      # um lado sem nome: decide o modelo
    assert not same_entities("Quantos anos tinha em 1910?", "Quantos anos tinha em 1920?")


# ---------------- calibração ----------------
async def test_calibration_is_safe_and_saved(core, fake, db):
    res = await core.retriever.semantic.calibrate()
    assert res["direto"] >= semantic.MIN_DIRECT and res["contexto"] <= res["direto"]
    assert res["pares"] == sum(1 for *_, same in CALIBRATION if same) and 0 < res["acertos"] <= res["pares"]
    assert res["confusoes"] == 0 and res["media_iguais"] > res["media_diferentes"]
    assert db.get_settings()["emb_calibracao"]["paraphrase-multilingual"] == res


async def test_auto_calibrates_on_first_use(core, fake, db):
    assert db.get_settings()["emb_calibracao"] == {}
    assert await core.retriever.semantic.ready()
    assert "paraphrase-multilingual" in db.get_settings()["emb_calibracao"]


# ---------------- a cascata com significado ----------------
async def test_paraphrase_answered_from_base_without_ai(core, fake):
    core.knowledge.add(Q, "Foi Gaston Leroux.", "correcao", "validada")
    r = await core.chat.reply(PARAFRASE)
    assert r.layer == "base" and r.text == "Foi Gaston Leroux."
    assert "parecida com “Quem escreveu O Fantasma da Ópera?”" in r.source["label"] and r.source["score"] >= 0.75
    assert chat_calls(fake) == []                                     # nenhuma chamada ao LLM


async def test_guard_blocks_same_topic_other_name(core, fake):
    core.knowledge.add("Qual a capital da França?", "Paris.", "correcao", "validada")
    r = await core.chat.reply("Qual a capital da Alemanha?")
    assert r.layer == "ia"


async def test_rejected_and_candidates_are_never_used(core, fake):
    kid = core.knowledge.add(Q, "Gustav Le Guin.", "ia", "candidata")
    assert (await core.chat.reply(PARAFRASE)).layer == "ia"
    core.knowledge.set_status(kid, "rejeitada")
    assert (await core.chat.reply(PARAFRASE)).layer == "ia"


async def test_without_embedding_model_falls_back_to_words(core, fake):
    fake.installed.remove("paraphrase-multilingual")
    core.knowledge.add(Q, "Foi Gaston Leroux.", "correcao", "validada")
    assert (await core.chat.reply(PARAFRASE)).layer == "ia"           # paráfrase: só por significado
    assert (await core.chat.reply(Q)).layer == "base"                 # mesma pergunta: palavras ainda acham


async def test_disabled_semantic(core, fake, db):
    db.update_settings({"emb_ativo": False})
    core.knowledge.add(Q, "Foi Gaston Leroux.", "correcao", "validada")
    assert (await core.chat.reply(PARAFRASE)).layer == "ia" and fake.embed_calls == 0


# ---------------- índice ----------------
async def test_index_follows_changes(core, fake, db):
    sem = core.retriever.semantic
    it, _ = core.memory.create("hobby", {"nome": "Tocar violão"})
    first = await sem.sync()
    assert first >= 1 and await sem.sync() == 0                        # nada mudou: nada recalculado
    core.memory.update("hobby", it["id"], {"frequencia": "2x por semana"})
    assert await sem.sync() == 1                                       # texto mudou: recalcula só ele
    core.memory.delete("hobby", it["id"])
    await sem.sync()
    assert db.query("SELECT COUNT(*) AS n FROM vectors WHERE kind = 'mem:hobby'")[0]["n"] == 0


async def test_rag_memory_by_meaning(core, fake):
    core.memory.create("hobby", {"nome": "Tocar violão"})
    core.memory.create("projeto", {"nome": "Fluxo", "descricao": "app de finanças"})
    await core.chat.reply("me dá dicas de guitarra acústica")
    system = chat_calls(fake)[-1]["messages"][0]["content"]
    assert "Tocar violão" in system and "Fluxo" not in system


async def test_close_question_goes_to_ai_with_context(core, fake):
    # mesmo assunto, outra pergunta: não responde direto, mas a IA recebe o que já se sabe
    core.knowledge.add(Q, "Gaston Leroux escreveu em 1910.", "correcao", "validada")
    r = await core.chat.reply("O Fantasma da Ópera virou musical?")
    assert r.layer == "ia"
    assert "Gaston Leroux escreveu em 1910." in chat_calls(fake)[-1]["messages"][0]["content"]


async def test_rag_semantic_only_context(core, fake):
    # nenhuma palavra em comum (guitarra × violão): só a busca por significado acha
    core.knowledge.add("Qual a melhor guitarra para iniciantes?", "Uma acústica de cordas de nylon.", "correcao", "validada")
    r = await core.chat.reply("comprar violão barato iniciante")
    assert r.layer == "ia"
    assert "Uma acústica de cordas de nylon." in chat_calls(fake)[-1]["messages"][0]["content"]


def test_cosine_without_numpy(monkeypatch):
    v = semantic.normalize([1.0, 2.0, 2.0])
    rows = [semantic.unpack(semantic.pack(v)), semantic.unpack(semantic.pack(semantic.normalize([2.0, -1.0, 0.0])))]
    with_np = semantic.cosine_many(v, rows)
    monkeypatch.setattr(semantic, "np", None)
    assert [round(x, 4) for x in semantic.cosine_many(v, rows)] == [round(x, 4) for x in with_np]
    assert round(with_np[0], 4) == 1.0 and round(with_np[1], 4) == 0.0


# ---------------- API ----------------
@pytest.fixture
async def client(aiohttp_client, core):
    return await aiohttp_client(build_app(core, TOKEN))


async def test_semantic_api(client, fake, db):
    st = await (await client.get("/api/semantic", headers=H)).json()
    assert st["model_installed"] and st["calibration"] is None and st["models"][0]["id"] == "paraphrase-multilingual"
    r = await client.post("/api/semantic/calibrate", json={}, headers=H)
    data = await r.json()
    assert r.status == 200 and data["calibration"]["direto"] >= 0.75
    fake.installed.remove("paraphrase-multilingual")
    assert (await client.post("/api/semantic/calibrate", json={}, headers=H)).status == 409
    assert (await client.post("/api/ai/pull", json={"model": "modelo-qualquer"}, headers=H)).status == 400
    r = await client.post("/api/ai/pull", json={"model": "paraphrase-multilingual"}, headers=H)
    assert (await r.json())["pull"]["model"] == "paraphrase-multilingual"
    assert (await client.patch("/api/settings", json={"emb_modelo": "bge-m3"}, headers=H)).status == 200
    assert (await client.patch("/api/settings", json={"emb_calibracao": {}}, headers=H)).status == 400   # só pela calibração
