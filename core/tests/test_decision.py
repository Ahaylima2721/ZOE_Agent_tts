import asyncio

from zoe_core.events import Event, EventType


async def test_unknown_rule_waits_and_is_logged(core, db, sink):
    d = await core.decision.handle(Event(EventType.TASK_OVERDUE, {}, timestamp=1))
    assert d.action == "aguardar"
    row = db.query("SELECT type, decision FROM events")[0]
    assert row["type"] == "TASK_OVERDUE" and row["decision"].startswith("aguardar")


async def test_focus_flow(core, sink):
    await core.focus.start(1)
    assert sink.of("expression")[-1]["name"] == "foco"
    assert core.decision.base_expression == "foco"
    await core.focus.stop()
    assert sink.of("expression")[-1]["name"] == "normal"
    assert sink.of("notification") == []  # cancelado: sem notificação


async def test_focus_completed_notifies(core, sink):
    await core.publish(EventType.FOCUS_SESSION_ENDED, {"minutes": 25, "completed": True})
    n = sink.of("notification")[0]["notification"]
    assert "25 minutos" in n["message"] and n["origin"] == "usuario"
    assert {a["id"] for a in n["actions"]} == {"foco_novamente", "dismiss"}


async def test_idle_then_short_return(core, clock, sink):
    await core.publish(EventType.USER_IDLE, {"idle_s": 300})
    assert sink.of("expression")[-1]["name"] == "descanso"
    clock.advance(60)
    await core.publish(EventType.USER_RETURNED)
    assert sink.of("expression")[-1]["name"] == "normal"
    assert sink.of("notification") == []


async def test_long_absence_welcome_once(core, db, clock, sink):
    db.update_settings({"nome_usuario": "Ana"})
    for _ in range(2):
        await core.publish(EventType.USER_IDLE, {"idle_s": 300})
        clock.advance(40 * 60)
        await core.publish(EventType.USER_RETURNED)
    notes = sink.of("notification")
    assert len(notes) == 1 and "Ana" in notes[0]["notification"]["message"]


async def test_monitoring_off_ignores_presence(core, db, sink):
    await core.set_monitoring(False)
    sink.messages.clear()
    d = await core.decision.handle(Event(EventType.USER_IDLE, {"idle_s": 600}))
    assert d.action == "ignorar"
    assert sink.messages == []


async def test_emergency_stop(core, db, sink):
    await core.emergency_stop()
    s = db.get_settings()
    assert not s["monitoramento_ativo"] and not s["intervencoes_ativas"]
    assert "Parei" in sink.of("notification")[0]["notification"]["message"]


async def test_focus_timer_really_ends(db):
    import time
    from zoe_core.core import ZoeCore
    core = ZoeCore(db, clock=time.time)
    got = []

    async def sink(msg):
        got.append(msg)
        return 1

    core.notifications.set_delivery(sink)
    core.decision.broadcast = sink
    await core.focus.start(0.002)  # ~0.12 s
    await asyncio.sleep(0.4)
    assert core.focus.status() is None
    assert any(m["type"] == "notification" for m in got)


async def test_focus_rejects_bad_duration(core):
    import pytest
    with pytest.raises(ValueError):
        await core.focus.start(0)
    with pytest.raises(ValueError):
        await core.focus.start(500)


async def test_focus_broadcasts_state(core, sink):
    core.hub.broadcast = sink
    await core.chat.reply("foco 5")
    states = sink.of("state")
    assert states and states[-1]["state"]["focus"]["minutes"] == 5
