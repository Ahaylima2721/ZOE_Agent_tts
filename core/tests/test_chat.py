async def ask(core, text):
    return await core.chat.reply(text)


async def test_help_and_greeting(core, db):
    assert "foco 25" in (await ask(core, "ajuda")).text
    db.update_settings({"nome_usuario": "Ana"})
    assert (await ask(core, "Olá!")).text.startswith("Oi, Ana")


async def test_focus_commands(core, sink):
    r = await ask(core, "foco 15")
    assert r.expression == "foco" and core.focus.status()["minutes"] == 15
    assert "encerrado" in (await ask(core, "parar foco")).text
    assert "Não tem" in (await ask(core, "parar foco")).text


async def test_do_not_disturb(core, db, clock, sink):
    await ask(core, "não perturbe 20")
    assert db.get_settings()["nao_perturbe_ate"] == clock() + 1200


async def test_name_keeps_original_case(core, db):
    await ask(core, "Me chame de Ayalan")
    assert db.get_settings()["nome_usuario"] == "Ayalan"


async def test_pause_resume(core, db, sink):
    await ask(core, "pausar")
    assert not db.get_settings()["monitoramento_ativo"]
    await ask(core, "retomar")
    assert db.get_settings()["monitoramento_ativo"]


async def test_unknown_is_honest_and_logged(core, db):
    r = await ask(core, "qual o sentido da vida?")
    assert "Ollama" in r.text
    assert db.interactions()[-1]["context"] == "qual o sentido da vida?"
