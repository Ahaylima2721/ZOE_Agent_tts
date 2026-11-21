from datetime import datetime

from zoe_core.notifications import ORIGIN_USER, Notification, _in_quiet_hours


def spont(msg="oi", **kw):
    return Notification(msg, "teste", **kw)


async def test_user_origin_always_delivered(core, db, sink):
    db.update_settings({"autonomia": "observar", "frequencia": "silenciosa"})
    ok, reason = await core.notifications.send(Notification("fim do foco", "foco", origin=ORIGIN_USER))
    assert ok and reason is None
    assert sink.of("notification")[0]["notification"]["message"] == "fim do foco"


async def test_observe_only_blocks_spontaneous(core, db, sink):
    db.update_settings({"autonomia": "observar"})
    ok, reason = await core.notifications.send(spont())
    assert not ok and reason.startswith("autonomia")
    assert sink.messages == []
    assert core.notifications.history()[0]["status"] == "bloqueada"


async def test_silent_frequency_blocks(core, db, sink):
    db.update_settings({"frequencia": "silenciosa"})
    assert (await core.notifications.send(spont()))[1] == "frequencia: silenciosa"


async def test_min_gap_and_hourly_cap(core, db, clock, sink):
    db.update_settings({"frequencia": "alta"})  # 3 min, 10/h
    assert (await core.notifications.send(spont("a")))[0]
    assert (await core.notifications.send(spont("b")))[1] == "intervalo minimo"
    clock.advance(181)
    assert (await core.notifications.send(spont("c")))[0]
    db.update_settings({"frequencia": "baixa"})  # 2/h
    clock.advance(31 * 60)
    assert (await core.notifications.send(spont("d")))[1] == "limite por hora"


async def test_dedupe(core, clock, sink):
    assert (await core.notifications.send(spont(dedupe_key="x")))[0]
    clock.advance(11 * 60)
    assert (await core.notifications.send(spont(dedupe_key="x")))[1] == "repetida"
    clock.advance(7 * 3600)
    assert (await core.notifications.send(spont(dedupe_key="x")))[0]


async def test_do_not_disturb(core, db, clock, sink):
    db.update_settings({"nao_perturbe_ate": clock() + 600})
    assert (await core.notifications.send(spont()))[1] == "nao perturbe"
    clock.advance(601)
    assert (await core.notifications.send(spont()))[0]


async def test_quiet_hours_block(core, db, sink):
    db.update_settings({"silencio_inicio": "14:00", "silencio_fim": "16:00"})
    assert (await core.notifications.send(spont()))[1] == "horario silencioso"


def test_quiet_hours_overnight():
    at = lambda h, m=0: datetime(2026, 1, 1, h, m)
    assert _in_quiet_hours(at(23, 45), "23:30", "07:30")
    assert _in_quiet_hours(at(3), "23:30", "07:30")
    assert not _in_quiet_hours(at(12), "23:30", "07:30")
    assert not _in_quiet_hours(at(7, 30), "23:30", "07:30")
    assert not _in_quiet_hours(at(10), "10:00", "10:00")


async def test_no_client_keeps_pending(core, db):
    core.notifications.set_delivery(None)
    ok, reason = await core.notifications.send(spont())
    assert not ok and reason == "sem cliente conectado"
    assert core.notifications.history()[0]["status"] == "pendente"


async def test_ack(core, sink):
    await core.notifications.send(spont())
    nid = core.notifications.history()[0]["id"]
    assert core.notifications.ack(nid, "dismiss")
    assert core.notifications.history()[0]["status"] == "lida"
