import copy

import pytest

from zoe_core.core import ZoeCore
from zoe_core.pc import diagnostics as dg
from zoe_core.pc.collector import Collector, friendly_name
from zoe_core.pc.monitor import REARM_S, PcMonitor

GB = 2**30


def make_snap(ts, cpu=10.0, ram=40.0, disk_free_pct=50.0, temp=None, battery=None, top_mem=("Firefox", 3 * GB, 12),
              top_cpu=("Firefox", 4.0)):
    total = 16 * GB
    return {
        "timestamp": ts,
        "cpu": {"percent": cpu, "cores": 4, "freq_mhz": 2000, "load": [1, 1, 1]},
        "memory": {"total": total, "used": int(total * ram / 100), "available": int(total * (1 - ram / 100)),
                   "percent": ram, "swap_total": 2 * GB, "swap_used": 0, "swap_percent": 0},
        "disks": [{"mount": "/", "device": "/dev/sda2", "fstype": "ext4", "total": 256 * GB,
                   "used": int(256 * GB * (1 - disk_free_pct / 100)), "free": int(256 * GB * disk_free_pct / 100),
                   "percent": 100 - disk_free_pct}],
        "temperatures": {"cpu": temp, "cpu_high": 100, "sensors": []} if temp is not None else {},
        "battery": battery,
        "gpu": None,
        "io": {"read_bps": 0, "write_bps": 0},
        "network": {"down_bps": 0, "up_bps": 0, "link_mbps": None},
        "processes": {
            "by_memory": [{"app": top_mem[0], "processes": top_mem[2], "cpu_pct": 1, "mem_bytes": top_mem[1], "pids": [1]}],
            "by_cpu": [{"app": top_cpu[0], "processes": 1, "cpu_pct": top_cpu[1], "mem_bytes": GB, "pids": [1]}],
            "total": 200,
        },
    }


def hist(t_end, seconds, cpu, ram, step=5):
    return [(t_end - seconds + i, cpu, ram) for i in range(0, seconds + 1, step)]


# ---------------- diagnóstico (funções puras) ----------------
def test_healthy_machine_has_no_findings():
    s = make_snap(1000)
    assert dg.diagnose(s, hist(1000, 60, 10, 40)) == []


def test_ram_needs_to_be_sustained():
    s = make_snap(1000, ram=93)
    assert dg.diagnose(s, [(1000, 10, 93)]) == []                    # pico isolado
    assert dg.diagnose(s, hist(1000, 30, 10, 93))[0].kind == "ram_alta"
    mixed = hist(1000, 30, 10, 93)
    mixed[2] = (mixed[2][0], 10, 70)                                 # caiu no meio: não é sustentado
    assert dg.diagnose(s, mixed) == []


def test_ram_explains_culprit():
    f = dg.diagnose(make_snap(1000, ram=96), hist(1000, 30, 10, 96))[0]
    assert f.severity == "serious"
    assert "Firefox está usando 3,0 GB" in f.message and "12 processos" in f.message
    assert f.culprits[0]["app"] == "Firefox"


def test_cpu_uses_one_minute_average():
    s = make_snap(1000, cpu=99, top_cpu=("Blender", 87.0))
    assert dg.diagnose(s, hist(1000, 20, 99, 40)) == []              # pouco histórico
    f = dg.diagnose(s, hist(1000, 60, 95, 40))[0]
    assert f.kind == "cpu_alta" and "Blender" in f.message
    assert dg.diagnose(s, hist(1000, 60, 60, 40)) == []


def test_disk_low_by_percent_or_absolute():
    f = dg.diagnose(make_snap(1000, disk_free_pct=4), [])[0]
    assert f.kind == "disco_cheio" and "disco do sistema" in f.message
    f = dg.diagnose(make_snap(1000, disk_free_pct=1.5), [])[0]
    assert f.severity == "serious"


def test_temperature_and_battery():
    assert dg.diagnose(make_snap(1000, temp=80), []) == []
    f = dg.diagnose(make_snap(1000, temp=97), [])[0]
    assert f.kind == "temperatura_alta" and f.severity == "critical"
    bat = {"percent": 12, "plugged": False, "secs_left": 1500}
    f = dg.diagnose(make_snap(1000, battery=bat), [])[0]
    assert f.kind == "bateria_baixa" and "25 minutos" in f.message
    assert dg.diagnose(make_snap(1000, battery={**bat, "plugged": True}), []) == []


def test_custom_limits():
    s = make_snap(1000, ram=85)
    assert dg.diagnose(s, hist(1000, 30, 10, 85)) == []
    assert dg.diagnose(s, hist(1000, 30, 10, 85), {"ram_pct": 80})[0].kind == "ram_alta"


def test_summary_and_format():
    assert dg.fmt_bytes(1536 * 2**20) == "1,5 GB"
    txt = dg.summary(make_snap(1000, temp=55, battery={"percent": 80, "plugged": True, "secs_left": None}))
    assert txt.startswith("CPU em 10%") and "55 °C" in txt and "bateria 80% (carregando)" in txt


def test_friendly_names():
    assert friendly_name("Isolated Web Co", "/usr/lib/firefox/firefox") == "Firefox"
    assert friendly_name("code", None) == "VS Code"
    assert friendly_name("meuapp", "/opt/x/meuapp") == "meuapp"


def test_real_collector_snapshot():
    c = Collector()
    s1 = c.snapshot()
    s2 = c.snapshot()
    assert 0 <= s2["cpu"]["percent"] <= 100
    assert s2["memory"]["total"] > 0
    assert s2["network"]["down_bps"] is not None          # 2ª leitura já tem taxa
    assert s2["processes"]["by_memory"] and s2["processes"]["total"] > 0
    assert all(d["fstype"] != "squashfs" for d in s2["disks"])
    assert s1["timestamp"] <= s2["timestamp"]


# ---------------- monitor + decisão ----------------
class FakeCollector:
    def __init__(self, clock):
        self.clock, self.kw = clock, {}

    def snapshot(self):
        return make_snap(self.clock(), **self.kw)


@pytest.fixture
def pccore(db, clock, sink):
    core = ZoeCore(db, clock=clock, enable_pc=False)
    core.pc = PcMonitor(core, FakeCollector(clock))
    core.notifications.set_delivery(sink)
    core.decision.broadcast = sink
    core.hub.broadcast = sink
    return core


async def run_for(core, clock, seconds, step=5):
    for _ in range(seconds // step):
        clock.advance(step)
        await core.pc.tick()


async def test_ram_alert_fires_once_with_actions(pccore, clock, sink):
    pccore.pc.collector.kw = {"ram": 94}
    await run_for(pccore, clock, 120)
    notes = sink.of("notification")
    assert len(notes) == 1
    n = notes[0]["notification"]
    assert n["category"] == "pc" and n["expression"] == "preocupada"
    assert {a["id"] for a in n["actions"]} == {"ver_processos", "dismiss"}
    ev = pccore.db.query("SELECT type, source FROM events WHERE type = 'HIGH_MEMORY_USAGE'")
    assert ev == [{"type": "HIGH_MEMORY_USAGE", "source": "pc"}]


async def test_rearm_after_normalizing(pccore, db, clock, sink):
    db.update_settings({"frequencia": "alta"})
    pccore.pc.collector.kw = {"ram": 94}
    await run_for(pccore, clock, 40)
    pccore.pc.collector.kw = {"ram": 50}
    await run_for(pccore, clock, REARM_S + 10)
    assert "ram_alta" not in pccore.pc.active
    pccore.pc.collector.kw = {"ram": 94}
    clock.advance(3600)
    await run_for(pccore, clock, 40)
    assert len(sink.of("notification")) == 2


async def test_paused_monitoring_no_events_no_persist(pccore, db, clock, sink):
    await pccore.set_monitoring(False)
    sink.messages.clear()
    pccore.pc.collector.kw = {"ram": 97}
    await run_for(pccore, clock, 90)
    assert sink.of("notification") == []
    assert db.query("SELECT * FROM system_metrics") == []


async def test_pc_alerts_off(pccore, db, clock, sink):
    db.update_settings({"pc_alertas": False})
    pccore.pc.collector.kw = {"ram": 97}
    await run_for(pccore, clock, 70)
    assert sink.of("notification") == []
    assert db.query("SELECT COUNT(*) AS n FROM system_metrics")[0]["n"] >= 1   # métricas continuam


async def test_metrics_persisted_per_minute(pccore, db, clock):
    pccore.pc.collector.kw = {"cpu": 30, "ram": 50, "temp": 60}
    await run_for(pccore, clock, 185)
    rows = db.query("SELECT * FROM system_metrics")
    assert len(rows) == 3 and rows[-1]["cpu_usage"] == 30 and rows[-1]["temperature"] == 60


async def test_focus_holds_noncritical_but_not_critical(pccore, clock, sink):
    await pccore.focus.start(60)
    pccore.pc.collector.kw = {"ram": 94}
    await run_for(pccore, clock, 40)
    assert sink.of("notification") == []
    pccore.pc.collector.kw = {"ram": 50, "temp": 99}
    await pccore.pc.tick()
    n = sink.of("notification")[0]["notification"]
    assert n["expression"] == "alerta"


async def test_critical_passes_quiet_hours_but_not_observe(pccore, db, clock, sink):
    db.update_settings({"silencio_inicio": "14:00", "silencio_fim": "16:00"})
    pccore.pc.collector.kw = {"temp": 99}
    await pccore.pc.tick()
    assert len(sink.of("notification")) == 1
    db.update_settings({"autonomia": "observar"})
    pccore.pc.collector.kw = {"battery": {"percent": 3, "plugged": False, "secs_left": None}}
    await pccore.pc.tick()
    assert len(sink.of("notification")) == 1


async def test_subscribers_get_live_readings(pccore, clock):
    class WS:
        def __init__(self):
            self.sent = []

        async def send_str(self, s):
            self.sent.append(s)

    ws = WS()
    pccore.pc.subscribers.add(ws)
    await pccore.set_monitoring(False)      # mesmo pausado, o painel aberto recebe leituras
    await pccore.pc.tick()
    assert '"type": "pc"' in ws.sent[-1] and '"history"' in ws.sent[-1]


# ---------------- chat ----------------
async def test_chat_pc_commands(pccore, clock):
    pccore.pc.collector.kw = {"temp": 50}
    r = await pccore.chat.reply("Como está o PC?")
    assert r.text.startswith("CPU em 10%")
    r = await pccore.chat.reply("o que está pesando")
    assert "Firefox: 3,0 GB" in r.text
    r = await pccore.chat.reply("diagnóstico")
    assert "não achei nada fora do normal" in r.text
    clock.advance(120)                       # leituras normais anteriores saem da janela
    pccore.pc.history.extend(hist(clock(), 40, 10, 95))
    pccore.pc.collector.kw = {"ram": 95}
    r = await pccore.chat.reply("o computador está lento")
    assert "Memória quase cheia" in r.text and r.expression == "preocupada"


async def test_chat_without_psutil(core):
    core.pc_error = "falta psutil"
    assert (await core.chat.reply("diagnóstico")).text == "falta psutil"
