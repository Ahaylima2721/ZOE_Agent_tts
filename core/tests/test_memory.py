import sqlite3

import pytest

from zoe_core.companion import checkins
from zoe_core.companion.memory import Memory
from zoe_core.db import MIGRATIONS, Database, _split_sql
from zoe_core.server import build_app

DAY = 86400
TOKEN = "t0k3n"
H = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def mem(db, clock):
    return Memory(db, clock)


async def say(core, text):
    return await core.chat.reply(text)


# ---------------- banco ----------------
def test_upgrade_from_v1_keeps_data(tmp_path, clock):
    path = tmp_path / "v1.db"
    con = sqlite3.connect(path)
    for stmt in _split_sql(MIGRATIONS[0]):
        con.execute(stmt)
    con.execute("PRAGMA user_version = 1")
    con.execute("INSERT INTO users (id, name, created_at) VALUES (1, '', 0)")
    con.execute("INSERT INTO books (user_id, title, author, current_chapter, status) VALUES (1, 'Duna', 'Frank Herbert', '5', 'lendo')")
    con.commit()
    con.close()
    db = Database(path, clock=clock)
    assert db.schema_version == len(MIGRATIONS)
    item = Memory(db, clock).list("livro")[0]
    assert item["titulo"] == "Duna" and item["capitulo"] == "5" and item["progresso"] == ""


def test_delete_personal_data_includes_goals(db, mem):
    mem.create("objetivo", {"titulo": "Virar dev sênior"})
    db.delete_personal_data()
    assert mem.list("objetivo") == []


# ---------------- memória ----------------
def test_create_dedupes_by_name(mem, clock):
    a, created = mem.create("livro", {"titulo": "Memórias Póstumas"})
    assert created and a["status"] == "lendo" and a["criado_em"] == clock()
    clock.advance(DAY)
    b, created = mem.create("livro", {"titulo": "memorias postumas", "capitulo": "3"})
    assert not created and b["id"] == a["id"] and b["capitulo"] == "3" and b["atualizado_em"] == clock()
    assert len(mem.list("livro")) == 1


def test_validation(mem):
    with pytest.raises(ValueError, match="status"):
        mem.create("livro", {"titulo": "X", "status": "devorando"})
    with pytest.raises(ValueError, match="desconhecido"):
        mem.create("livro", {"titulo": "X", "isbn": "1"})
    with pytest.raises(ValueError, match="titulo"):
        mem.create("livro", {"autor": "Alguém"})
    it, _ = mem.create("projeto", {"nome": "Fluxo"})
    with pytest.raises(ValueError):
        mem.update("projeto", it["id"], {"nome": "  "})
    with pytest.raises(ValueError):
        mem.create("interesse", {"nome": "IA", "prioridade": 9})


def test_shared_tables_are_isolated_by_category(mem):
    mem.create("hobby", {"nome": "Violão"})
    mem.create("adiada", {"nome": "Academia"})
    mem.create("aprender", {"nome": "Python"})
    mem.create("interesse", {"nome": "IA"})
    assert [i["nome"] for i in mem.list("hobby")] == ["Violão"]
    assert [i["nome"] for i in mem.list("adiada")] == ["Academia"]
    assert [i["nome"] for i in mem.list("aprender")] == ["Python"]
    hobby = mem.list("hobby")[0]
    assert mem.get("adiada", hobby["id"]) is None and not mem.delete("adiada", hobby["id"])


def test_search(mem):
    mem.create("livro", {"titulo": "O Senhor dos Anéis"})
    mem.create("projeto", {"nome": "Fluxo"})
    assert mem.search("senhor dos aneis")[0]["titulo"] == "O Senhor dos Anéis"
    assert mem.search("fluxo", ("projeto",))[0]["nome"] == "Fluxo"
    assert mem.search("inexistente") == []


# ---------------- conversa ----------------
async def test_book_asks_instead_of_guessing(core):
    r = await say(core, "Estou lendo Duna")
    assert "De quem é?" in r.text
    assert core.memory.list("livro")[0]["autor"] == ""          # não inventou autor
    r = await say(core, "Frank Herbert")
    assert "Em que capítulo" in r.text
    r = await say(core, "5")
    assert r.text == "Anotado: Duna, capítulo 5."
    b = core.memory.list("livro")[0]
    assert (b["autor"], b["capitulo"], b["status"]) == ("Frank Herbert", "5", "lendo")


async def test_book_with_author_and_titles_with_de(core):
    r = await say(core, "estou lendo Duna, de Frank Herbert")
    assert "Em que capítulo" in r.text and "Frank Herbert" in r.text
    await say(core, "não sei")
    await say(core, "estou lendo Memórias Póstumas de Brás Cubas")
    await say(core, "deixa pra lá")
    await say(core, "comecei a ler Cem anos de solidão, de Gabriel García Márquez, no capítulo 2")
    books = {b["titulo"]: b for b in core.memory.list("livro")}
    assert "Memórias Póstumas de Brás Cubas" in books                  # "de" sem vírgula não vira autor
    c = books["Cem anos de solidão"]
    assert c["autor"] == "Gabriel García Márquez" and c["capitulo"] == "2"


async def test_chapter_and_finish(core):
    await say(core, "estou lendo Duna, de Frank Herbert, no capítulo 3")
    r = await say(core, "estou no capítulo 7")
    assert r.text == "Anotado: Duna, capítulo 7."
    await say(core, "estou lendo O Hobbit, de Tolkien, no capítulo 1")
    r = await say(core, "cheguei no capítulo 9")
    assert r.text == "De qual livro?" and set(r.quick_replies) == {"Duna", "O Hobbit"}
    r = await say(core, "O Hobbit")
    assert r.text == "Anotado: O Hobbit, capítulo 9."
    r = await say(core, "terminei Duna!")
    assert "Parabéns" in r.text and core.memory.find_by_name("livro", "Duna")["status"] == "lido"


async def test_other_kinds(core):
    r = await say(core, "quero aprender Python e Rust")
    assert "Python e Rust" in r.text
    await say(core, "meu hobby é tocar violão")
    await say(core, "meu objetivo profissional é virar dev sênior")
    await say(core, "novo projeto Fluxo, que é um app de finanças")
    await say(core, "vivo adiando a academia")
    await say(core, "minha banda favorita é Radiohead")
    await say(core, "quero assistir a série Dark")
    await say(core, "me interesso por inteligência artificial")
    m = core.memory
    assert [i["nome"] for i in m.list("aprender")] == ["Rust", "Python"] or {i["nome"] for i in m.list("aprender")} == {"Python", "Rust"}
    assert m.list("hobby")[0]["nome"] == "Tocar violão"
    g = m.list("objetivo")[0]
    assert g["titulo"] == "Virar dev sênior" and g["categoria"] == "profissional"
    p = m.list("projeto")[0]
    assert p["nome"] == "Fluxo" and p["descricao"] == "um app de finanças"
    assert m.list("adiada")[0]["nome"] == "A academia"
    assert m.list("musica")[0]["nome"] == "Radiohead"
    assert m.list("filme_serie")[0]["nome"] == "Dark"
    assert m.list("interesse")[0]["nome"] == "Inteligência artificial"
    r = await say(core, "quero aprender Python")
    assert "já sabia" in r.text and len(m.list("aprender")) == 2


async def test_hobby_practice_updates_last_talk(core, clock):
    await say(core, "meu hobby é tocar violão")
    clock.advance(20 * DAY)
    r = await say(core, "hoje toquei violão")
    assert "Anotei" in r.text
    assert core.memory.list("hobby")[0]["atualizado_em"] == clock()


async def test_about_me_and_forget(core):
    assert "quase nada" in (await say(core, "o que você sabe sobre mim?")).text
    await say(core, "estou lendo Duna, de Frank Herbert, no capítulo 3")
    await say(core, "meu hobby é xadrez")
    r = await say(core, "o que você sabe sobre mim?")
    assert "Duna, de Frank Herbert (capítulo 3, lendo)" in r.text and "Xadrez" in r.text
    r = await say(core, "esqueça Duna")
    assert "Quer mesmo" in r.text and "sim, pode apagar" in r.quick_replies
    assert core.memory.list("livro")                                     # ainda não apagou
    r = await say(core, "sim, pode apagar")
    assert "esqueci" in r.text and core.memory.list("livro") == []
    assert "Não encontrei" in (await say(core, "esqueça Nárnia")).text


async def test_commands_win_over_pending_question(core, sink):
    await say(core, "estou lendo Duna")
    r = await say(core, "foco 10")
    assert "10 minutos de foco" in r.text
    assert core.memory.list("livro")[0]["autor"] == ""


async def test_pending_question_expires(core, clock):
    await say(core, "estou lendo Duna")
    clock.advance(11 * 60)
    r = await say(core, "Frank Herbert")
    assert core.memory.list("livro")[0]["autor"] == "" and "Ollama" in r.text


# ---------------- lembretes da memória ----------------
class FakeWS:
    async def send_str(self, s):
        pass


def test_checkin_message_uses_stored_chapter(mem, clock):
    it, _ = mem.create("livro", {"titulo": "Duna", "capitulo": "5"})
    assert checkins.pick(mem, clock(), {}, set()) is None             # recém-conversado
    clock.advance(4 * DAY)
    c = checkins.pick(mem, clock(), {}, set())
    assert c["message"] == "Você conseguiu avançar em Duna? Da última vez você estava no capítulo 5."
    assert checkins.pick(mem, clock(), {"assuntos_evitar": ["duna"]}, set()) is None
    assert checkins.pick(mem, clock(), {}, {c["dedupe_key"]}) is None
    assert checkins.pick(mem, clock(), {"tom": "direto"}, set())["message"] == "E Duna? Ainda no capítulo 5?"
    mem.update("livro", it["id"], {"status": "lido"})
    clock.advance(10 * DAY)
    assert checkins.pick(mem, clock(), {}, set()) is None             # livro lido não gera lembrete


def test_checkin_messages_for_each_kind(mem, clock):
    mem.create("projeto", {"nome": "Fluxo"})
    mem.create("aprender", {"nome": "Python"})
    mem.create("hobby", {"nome": "violão"})
    clock.advance(15 * DAY)
    msgs = {c[1]["tipo"]: checkins.message(c[1], 15) for c in checkins.candidates(mem, clock(), [], set())}
    assert msgs["projeto"] == "Como está aquele projeto, Fluxo? Faz 15 dias que você não comenta."
    assert msgs["aprender"] == "Você conseguiu avançar nos estudos de Python?"
    assert msgs["hobby"] == "Faz tempo que você não fala de violão. Tem conseguido?"


async def test_checkin_flow_and_reply(core, clock, sink):
    core.hub.broadcast = sink
    await say(core, "estou lendo Duna, de Frank Herbert, no capítulo 5")
    clock.advance(4 * DAY)
    assert await core.memory_checkin() is None                          # orbe fechada: não puxa assunto
    core.hub.clients.add(FakeWS())
    c = await core.memory_checkin()
    n = sink.of("notification")[-1]["notification"]
    assert n["message"] == c["message"] and n["category"] == "memoria" and n["expression"] == "curiosa"
    assert await core.memory_checkin() is None                          # no máximo 1 a cada 4 h
    # "Responder" faz a próxima mensagem responder ao lembrete
    await core.handle_notification_action(n["id"], n["actions"][0]["id"])
    r = await say(core, "cheguei no 8")
    assert r.text == "Anotado: Duna, capítulo 8."


async def test_checkin_postpone_and_gates(core, db, clock, sink):
    core.hub.clients.add(FakeWS())
    core.memory.create("projeto", {"nome": "Fluxo"})
    clock.advance(8 * DAY)
    await core.focus.start(30)
    assert await core.memory_checkin() is None                          # em foco
    await core.focus.stop()
    db.update_settings({"checkins_memoria": False})
    assert await core.memory_checkin() is None
    db.update_settings({"checkins_memoria": True})
    await core.memory_checkin()
    n = sink.of("notification")[-1]["notification"]
    await core.handle_notification_action(n["id"], n["actions"][1]["id"])   # "Agora não"
    assert core.memory.list("projeto")[0]["atualizado_em"] == clock()


async def test_checkin_reply_as_note(core, clock, sink):
    core.hub.clients.add(FakeWS())
    core.memory.create("projeto", {"nome": "Fluxo"})
    clock.advance(8 * DAY)
    await core.memory_checkin()
    n = sink.of("notification")[-1]["notification"]
    await core.handle_notification_action(n["id"], n["actions"][0]["id"])
    r = await say(core, "terminei a tela de login")
    assert "Anotei isso em Fluxo" in r.text
    assert "terminei a tela de login" in core.memory.list("projeto")[0]["notas"]


# ---------------- API ----------------
@pytest.fixture
async def client(aiohttp_client, core):
    return await aiohttp_client(build_app(core, TOKEN))


async def test_memory_api(client):
    r = await client.post("/api/memory/livro", json={"titulo": "Duna", "autor": "Frank Herbert"}, headers=H)
    assert r.status == 201
    item = (await r.json())["item"]
    r = await client.patch(f"/api/memory/livro/{item['id']}", json={"capitulo": "4"}, headers=H)
    assert (await r.json())["item"]["capitulo"] == "4"
    data = await (await client.get("/api/memory", headers=H)).json()
    assert data["items"]["livro"][0]["titulo"] == "Duna"
    assert {k["key"] for k in data["kinds"]} >= {"livro", "projeto", "hobby", "objetivo"}
    assert (await client.post("/api/memory/livro", json={"titulo": "Duna"}, headers=H)).status == 200   # já existia
    assert (await client.post("/api/memory/livro", json={"status": "x", "titulo": "A"}, headers=H)).status == 400
    assert (await client.post("/api/memory/dinossauro", json={}, headers=H)).status == 404
    assert (await client.patch("/api/memory/livro/999", json={"capitulo": "1"}, headers=H)).status == 404
    assert (await client.delete(f"/api/memory/livro/{item['id']}", headers=H)).status == 200
    assert (await client.delete(f"/api/memory/livro/{item['id']}", headers=H)).status == 404


async def test_preferences_validation(client):
    r = await client.patch("/api/settings", json={"tom": "direto", "assuntos_evitar": ["trabalho"]}, headers=H)
    assert (await r.json())["tom"] == "direto"
    assert (await client.patch("/api/settings", json={"tom": "grosso"}, headers=H)).status == 400
    assert (await client.patch("/api/settings", json={"assuntos_evitar": "trabalho"}, headers=H)).status == 400


async def test_finish_project_and_goal(core):
    await say(core, "novo projeto Fluxo")
    await say(core, "meu objetivo é correr 5 km")
    r = await say(core, "terminei o projeto Fluxo")
    assert r.text == "Que conquista! Marquei o projeto Fluxo como concluído."
    r = await say(core, "alcancei meu objetivo correr 5 km")
    assert "Correr 5 km" in r.text and core.memory.list("objetivo")[0]["status"] == "alcancado"
