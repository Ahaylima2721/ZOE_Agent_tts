"""Coleta de métricas do computador (Linux primeiro; nada aqui exige root).

Fontes: psutil (CPU, RAM, disco, rede, temperatura, bateria, processos),
nvidia-smi para GPUs NVIDIA e /sys/class/drm para GPUs AMD. GPUs Intel não
expõem uso sem privilégios: nesse caso o campo vem como None, nunca inventado.
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess
import time
from dataclasses import dataclass, field

import psutil

# sistemas de arquivos "de verdade" (exclui squashfs de snaps, tmpfs, overlay…)
REAL_FS = {"ext2", "ext3", "ext4", "btrfs", "xfs", "f2fs", "zfs", "vfat", "exfat", "ntfs", "ntfs3", "fuseblk", "jfs", "reiserfs"}
MIN_DISK_BYTES = 2**30   # partições pequenas (recuperação, EFI) não interessam e dariam alarme falso
SKIP_MOUNT_PREFIXES = ("/snap", "/boot", "/var/snap", "/run", "/proc", "/sys", "/dev")

# nomes amigáveis para agrupar processos por aplicativo
FRIENDLY = {
    "firefox": "Firefox", "firefox-bin": "Firefox", "chrome": "Google Chrome", "chromium": "Chromium",
    "chromium-browser": "Chromium", "brave": "Brave", "opera": "Opera", "msedge": "Microsoft Edge",
    "code": "VS Code", "electron": "Electron", "slack": "Slack", "discord": "Discord", "Discord": "Discord",
    "spotify": "Spotify", "steam": "Steam", "steamwebhelper": "Steam", "gnome-shell": "GNOME Shell",
    "plasmashell": "KDE Plasma", "kwin_x11": "KDE KWin", "kwin_wayland": "KDE KWin", "Xorg": "Servidor gráfico (Xorg)",
    "Xwayland": "XWayland", "nautilus": "Arquivos", "dolphin": "Dolphin", "thunderbird": "Thunderbird",
    "telegram-desktop": "Telegram", "obs": "OBS Studio", "gimp-2.10": "GIMP", "blender": "Blender",
    "java": "Java", "python3": "Python", "node": "Node.js", "docker": "Docker", "dockerd": "Docker",
    "snapd": "Snap", "tracker-miner-fs-3": "Indexador de arquivos", "packagekitd": "Atualizações (PackageKit)",
    "figma-linux": "Figma", "obsidian": "Obsidian",
}


@dataclass
class ProcGroup:
    app: str
    processes: int
    cpu_pct: float          # % da máquina inteira (0–100)
    mem_bytes: int
    pids: list[int] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"app": self.app, "processes": self.processes, "cpu_pct": round(self.cpu_pct, 1),
                "mem_bytes": self.mem_bytes, "pids": self.pids[:20]}


def friendly_name(name: str, exe: str | None) -> str:
    base = os.path.basename(exe) if exe else ""
    for key in (base, name):
        if key and key in FRIENDLY:
            return FRIENDLY[key]
    return base or name or "?"


class Collector:
    """Uma instância por processo: guarda contadores para calcular taxas (bytes/s)."""

    def __init__(self, clock=time.time) -> None:
        self.clock = clock
        self._last_io: tuple[float, object, object] | None = None
        self.ncpu = psutil.cpu_count() or 1
        psutil.cpu_percent(None)  # inicializa a medição de CPU
        self._nvidia = shutil.which("nvidia-smi")
        self._gpu_skip = 0

    # ---------------- leitura completa ----------------
    def snapshot(self) -> dict:
        now = self.clock()
        snap = {
            "timestamp": now,
            "cpu": self.cpu(),
            "memory": self.memory(),
            "disks": self.disks(),
            "temperatures": self.temperatures(),
            "battery": self.battery(),
            "gpu": self.gpu(),
        }
        snap["io"], snap["network"] = self.rates(now)
        snap["processes"] = self.process_groups()
        return snap

    def cpu(self) -> dict:
        try:
            freq = psutil.cpu_freq()
        except Exception:
            freq = None
        load = os.getloadavg() if hasattr(os, "getloadavg") else (0, 0, 0)
        return {"percent": psutil.cpu_percent(None), "cores": self.ncpu,
                "freq_mhz": round(freq.current) if freq else None, "load": [round(x, 2) for x in load]}

    def memory(self) -> dict:
        m, s = psutil.virtual_memory(), psutil.swap_memory()
        return {"total": m.total, "available": m.available, "used": m.total - m.available,
                "percent": round(100 * (m.total - m.available) / m.total, 1) if m.total else 0,
                "swap_total": s.total, "swap_used": s.used, "swap_percent": s.percent}

    def disks(self) -> list[dict]:
        out, seen = [], set()
        for p in psutil.disk_partitions(all=False):
            if p.fstype not in REAL_FS or p.mountpoint.startswith(SKIP_MOUNT_PREFIXES) or p.device in seen:
                continue
            seen.add(p.device)
            try:
                u = psutil.disk_usage(p.mountpoint)
            except (PermissionError, OSError):
                continue
            if u.total < MIN_DISK_BYTES:
                continue
            out.append({"mount": p.mountpoint, "device": p.device, "fstype": p.fstype,
                        "total": u.total, "used": u.used, "free": u.free, "percent": u.percent})
        return out

    def rates(self, now: float) -> tuple[dict, dict]:
        try:
            dio = psutil.disk_io_counters()
        except Exception:
            dio = None
        nio = psutil.net_io_counters()
        io = {"read_bps": None, "write_bps": None}
        net = {"down_bps": None, "up_bps": None, "link_mbps": self._link_speed()}
        if self._last_io:
            t0, d0, n0 = self._last_io
            dt = max(now - t0, 1e-3)
            if dio and d0:
                io = {"read_bps": max(0, (dio.read_bytes - d0.read_bytes) / dt),
                      "write_bps": max(0, (dio.write_bytes - d0.write_bytes) / dt)}
            net["down_bps"] = max(0, (nio.bytes_recv - n0.bytes_recv) / dt)
            net["up_bps"] = max(0, (nio.bytes_sent - n0.bytes_sent) / dt)
        self._last_io = (now, dio, nio)
        return io, net

    @staticmethod
    def _link_speed() -> int | None:
        best = 0
        for name, st in psutil.net_if_stats().items():
            if st.isup and name != "lo" and st.speed > 0:
                best = max(best, st.speed)
        return best or None

    def temperatures(self) -> dict:
        """{'cpu': °C, 'cpu_high': °C, 'sensors': [...]} — vazio quando o sistema não informa."""
        if not hasattr(psutil, "sensors_temperatures"):
            return {}
        try:
            temps = psutil.sensors_temperatures()
        except Exception:
            return {}
        sensors, cpu, cpu_high = [], None, None
        for chip in ("coretemp", "k10temp", "zenpower", "cpu_thermal", "acpitz", "thinkpad"):
            for t in temps.get(chip, []):
                if t.current and 0 < t.current < 130:
                    if cpu is None or t.label.lower().startswith(("package", "tctl", "tdie")):
                        cpu, cpu_high = t.current, t.high or t.critical
            if cpu is not None:
                break
        for chip, entries in temps.items():
            for t in entries:
                if t.current and 0 < t.current < 130:
                    sensors.append({"chip": chip, "label": t.label or chip, "current": t.current,
                                    "high": t.high, "critical": t.critical})
        return {"cpu": cpu, "cpu_high": cpu_high, "sensors": sensors[:12]} if sensors else {}

    @staticmethod
    def battery() -> dict | None:
        try:
            b = psutil.sensors_battery()
        except Exception:
            return None
        if b is None:
            return None
        secs = b.secsleft if isinstance(b.secsleft, int) and b.secsleft >= 0 else None
        return {"percent": round(b.percent, 1), "plugged": bool(b.power_plugged), "secs_left": secs}

    def gpu(self) -> dict | None:
        if self._nvidia:
            self._gpu_skip = (self._gpu_skip + 1) % 3     # nvidia-smi custa ~50 ms: 1 a cada 3 leituras
            if self._gpu_skip == 1 or not hasattr(self, "_gpu_cache"):
                self._gpu_cache = self._nvidia_read()
            return self._gpu_cache
        return self._amd_read()

    def _nvidia_read(self) -> dict | None:
        try:
            out = subprocess.run(
                [self._nvidia, "--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total",
                 "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=2).stdout
            name, util, temp, mu, mt = [x.strip() for x in out.splitlines()[0].split(",")]
            return {"name": name, "percent": float(util), "temp": float(temp),
                    "mem_used": int(float(mu)) * 2**20, "mem_total": int(float(mt)) * 2**20, "vendor": "nvidia"}
        except Exception:
            return None

    @staticmethod
    def _amd_read() -> dict | None:
        for busy in glob.glob("/sys/class/drm/card*/device/gpu_busy_percent"):
            dev = os.path.dirname(busy)
            try:
                pct = float(open(busy).read().strip())
                temp = None
                for t in glob.glob(dev + "/hwmon/hwmon*/temp1_input"):
                    temp = int(open(t).read().strip()) / 1000
                return {"name": "GPU AMD", "percent": pct, "temp": temp, "vendor": "amd"}
            except (OSError, ValueError):
                continue
        return None

    # ---------------- processos ----------------
    def process_groups(self, limit: int = 8) -> dict:
        """Agrupa processos por aplicativo (ex.: todas as abas do Firefox viram 'Firefox')."""
        groups: dict[str, ProcGroup] = {}
        for p in psutil.process_iter(["pid", "name", "exe", "memory_info"]):
            try:
                info = p.info
                cpu = p.cpu_percent(None) / self.ncpu   # 1ª leitura de cada processo é 0
                mem = info["memory_info"].rss if info["memory_info"] else 0
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
            app = friendly_name(info["name"] or "", info["exe"])
            g = groups.setdefault(app, ProcGroup(app, 0, 0.0, 0))
            g.processes += 1
            g.cpu_pct += cpu
            g.mem_bytes += mem
            g.pids.append(info["pid"])
        allg = list(groups.values())
        by_mem = sorted(allg, key=lambda g: g.mem_bytes, reverse=True)[:limit]
        by_cpu = sorted(allg, key=lambda g: g.cpu_pct, reverse=True)[:limit]
        return {"by_memory": [g.to_dict() for g in by_mem], "by_cpu": [g.to_dict() for g in by_cpu],
                "total": sum(g.processes for g in allg)}
