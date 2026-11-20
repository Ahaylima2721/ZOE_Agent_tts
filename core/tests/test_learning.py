import pytest

from fake_ollama import FakeOllama
from fake_wiki import FakeWiki
from zoe_core.events import EventType
from zoe_core.learning.knowledge import KnowledgeBase, cacheable, similarity
from zoe_core.learning.research import is_allowed_url, search_terms
from zoe_core.server import build_app

TOKEN = "t0k3n"
H = {"Authorization": f"Bearer {TOKEN}"}
Q = "Quem escreveu O Fantasma da Ópera?"


@pytest.fixture
async def fake(aiohttp_server, db):
    f = FakeOllama(chunks=("Foi Gustav ", "Le Guin."))
    server = await aiohttp_server(f.app())
    db.update_settings({"ia_url": str(server.make_url("")).rstrip("/")})
    return f


@pytest.fixture
async def wiki(aiohttp_server, db):
    w = FakeWiki()
    server = await aiohttp_server(w.app())
    db.update_settings({"pesquisa_web_url": str(server.make_url("")).rstrip("/")})
    return w


async def ask(core, text):
    return await core.chat.reply(text)


# ---------------- regras da base ----------------
def test_cacheable():
    assert cacheable(Q)
    assert not cacheable("qual livro eu estou lendo?")        # pessoal: vem da memória, não da base
    assert not cacheable("que horas são agora?")              # muda o tempo todo
    assert not cacheable("como está meu pc hoje")
    assert not cacheable("o que é?")                          # sem assunto


def test_similarity_is_strict_on_purpose():
    assert similarity(Q, "quem escreveu o fantasma da opera") == 1
    assert similarity(Q, "Quem escreveu Dom Casmurro?") < 0.6
    assert similarity(Q, "quem é o autor de O Fantasma da Ópera") < 0.6     # paráfrase: prefere perguntar à IA


def test_search_terms():
    assert search_terms(Q) == "escreveu O Fantasma da Ópera"
    assert search_terms("Me fala sobre Python") == "Python"
    assert search_terms("O que é a fotossíntese?") == "a fotossíntese"


def test_allowed_urls():
    assert is_allowed_url("https://pt.wikipedia.org") and is_allowed_url("https://en.wikipedia.org")
    assert not is_allowed_url("http://pt.wikipedia.org")
    assert not is_allowed_url("https://wikipedia.org.evil.com")
    assert not is_allowed_url("https://exemplo.com")


# ---------------- a cascata ----------------
async def test_answer_learned_after_thumbs_up(core, fake):
    r = await ask(core, Q)
    assert r.layer == "ia" and r.feedback and r.id
    assert core.knowledge.by_interaction(r.id)["status"] == "candidata"
    r2 = await ask(core, Q)
    assert r2.layer == "ia"                                   # candidata não responde sozinha
    msg = core.learning_feedback(r.id, "up")
    assert "Guardei" in msg
    calls = len(fake.requests)
    r3 = await ask(core, "quem escreveu o fantasma da opera")
    assert r3.layer == "base" and r3.text == "Foi Gustav Le Guin." and r3.source["label"].startswith("Lembrei da nossa conversa")
    assert len(fake.requests) == calls                        # não chamou a IA
    assert core.knowledge.get(r3.knowledge_id)["uses"] == 1


async def test_thumbs_down_and_correction(core, fake):
    r = await ask(core, Q)
    core.learning_feedback(r.id, "down")
    assert core.knowledge.by_interaction(r.id)["status"] == "rejeitada"
    assert (await ask(core, Q)).layer == "ia"
    fix = await ask(core, "na verdade, foi Gaston Leroux")
    assert fix.layer == "aprendizado" and "correção" in fix.text
    r = await ask(core, Q)
    assert r.layer == "base" and r.text == "Foi Gaston Leroux" and r.source["label"].startswith("Você me ensinou")
    # 👎 numa resposta da base também tira ela de circulação
    core.learning_feedback(r.id, "down")
    assert (await ask(core, Q)).layer == "ia"


async def test_correction_needs_a_recent_answer(core, fake, clock):
    await ask(core, Q)
    clock.advance(11 * 60)
    r = await ask(core, "na verdade, foi Gaston Leroux")
    assert r.layer != "aprendizado"


async def test_personal_questions_are_never_stored(core, fake):
    r = await ask(core, "qual livro eu deveria ler agora?")
    assert r.layer == "ia" and core.knowledge.by_interaction(r.id) is None


async def test_rules_and_memory_layers_are_recorded(core, fake):
    assert (await ask(core, "foco 5")).layer == "regras"
    assert (await ask(core, "quero aprender Rust")).layer == "memoria"
    await ask(core, Q)
    st = core.learning_stats()
    assert st["by_layer"] == {"regras": 1, "memoria": 1, "ia": 1} and st["sem_ia_pct"] == 67


async def test_works_without_fts(core, fake):
    core.knowledge.fts = False
    r = await ask(core, Q)
    core.learning_feedback(r.id, "up")
    assert (await ask(core, Q)).layer == "base"


# ---------------- pesquisa pós-conversa ----------------
async def test_research_is_off_by_default(core, fake, wiki):
    await ask(core, Q)
    assert await core.research.run() == 0 and wiki.requests == []


async def test_research_learns_with_source(core, fake, wiki, db):
    db.update_settings({"pesquisa_web": True})
    r = await ask(core, Q)
    await ask(core, "qual livro eu deveria ler agora?")       # pessoal: não é pesquisado
    assert await core.research.run() == 1
    assert wiki.requests[0] == "search:escreveu o fantasma da ópera"   # só o assunto sai do computador
    again = await ask(core, Q)
    assert again.layer == "base" and again.text.startswith("O Fantasma da Ópera é um romance do escritor francês Gaston Leroux")
    assert "Esta frase passa" not in again.text                         # no máximo 3 frases
    assert again.source == {"label": "Fonte: Wikipédia · O Fantasma da Ópera",
                            "url": "https://pt.wikipedia.org/wiki/O_Fantasma_da_Ópera"}
    assert db.query("SELECT type FROM events WHERE type = ?", (EventType.NEW_DISCOVERY.value,))
    assert await core.research.run() == 0                               # já pesquisado
    assert core.knowledge.by_interaction(r.id)["researched_at"]


async def test_research_daily_cap(core, fake, wiki, db):
    db.update_settings({"pesquisa_web": True})
    core.research.done_today = [core.clock()] * 30
    await ask(core, Q)
    assert await core.research.run() == 0 and wiki.requests == []


async def test_research_not_found(core, fake, wiki, db):
    db.update_settings({"pesquisa_web": True})
    await ask(core, "Quem inventou o tamagotchi?")
    assert await core.research.run() == 0


# ---------------- contexto enxuto da IA (etapa C) ----------------
async def test_ai_gets_only_relevant_context(core, fake, db):
    await ask(core, "estou lendo Duna, de Frank Herbert, no capítulo 5")
    await ask(core, "novo projeto Fluxo")
    await ask(core, "meu hobby é xadrez")
    await ask(core, "me dá uma dica de xadrez")
    system = fake.requests[-1]["messages"][0]["content"]
    assert "Xadrez" in system and "Fluxo" not in system and "Duna" not in system
    await ask(core, "me dá uma dica qualquer")                         # nada relacionado: retrato mínimo
    system = fake.requests[-1]["messages"][0]["content"]
    assert "Duna" in system and "Fluxo" in system and "Xadrez" not in system


async def test_ai_gets_confirmed_knowledge(core, fake):
    core.knowledge.add("Quem escreveu O Fantasma da Ópera?", "Gaston Leroux.", "correcao", "validada")
    await ask(core, "o fantasma da ópera virou filme?")
    system = fake.requests[-1]["messages"][0]["content"]
    assert "Conhecimento confirmado" in system and "Gaston Leroux." in system


def test_delete_personal_data_clears_knowledge(db, clock):
    kb = KnowledgeBase(db, clock)
    kb.add(Q, "Gaston Leroux", "correcao", "validada")
    db.delete_personal_data()
    assert kb.lookup(Q) is None and kb.search(Q) == []


# ---------------- API ----------------
@pytest.fixture
async def client(aiohttp_client, core):
    return await aiohttp_client(build_app(core, TOKEN))


async def test_learning_api(client, core, fake):
    r = await ask(core, Q)
    resp = await client.post("/api/learning/feedback", json={"interaction_id": r.id, "vote": "up"}, headers=H)
    assert "Guardei" in (await resp.json())["message"]
    data = await (await client.get("/api/learning", headers=H)).json()
    assert data["stats"]["by_layer"]["ia"] == 1 and data["items"][0]["status"] == "validada"
    kid = data["items"][0]["id"]
    assert (await client.patch(f"/api/learning/{kid}", json={"status": "rejeitada"}, headers=H)).status == 200
    assert (await client.patch(f"/api/learning/{kid}", json={"status": "fonte"}, headers=H)).status == 400
    assert (await client.delete(f"/api/learning/{kid}", headers=H)).status == 200
    assert (await client.delete(f"/api/learning/{kid}", headers=H)).status == 404
    assert (await client.post("/api/learning/feedback", json={"interaction_id": 999, "vote": "up"}, headers=H)).status == 400
    assert (await client.post("/api/learning/research", json={}, headers=H)).status == 409
    assert (await client.patch("/api/settings", json={"pesquisa_web_url": "https://exemplo.com"}, headers=H)).status == 400
    assert (await client.patch("/api/settings", json={"pesquisa_web": True}, headers=H)).status == 200
