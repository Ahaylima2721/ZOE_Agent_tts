"""Caminhos e configurações padrão do Zoe Core.

Tudo fica no diretório do usuário (sem precisar de root):
  dados:    $ZOE_DATA_DIR    ou $XDG_DATA_HOME/zoe    ou ~/.local/share/zoe
  runtime:  $ZOE_RUNTIME_DIR ou $XDG_RUNTIME_DIR/zoe  ou <dados>/run
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _data_dir() -> Path:
    if os.environ.get("ZOE_DATA_DIR"):
        return Path(os.environ["ZOE_DATA_DIR"])
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "zoe"


def _runtime_dir(data_dir: Path) -> Path:
    if os.environ.get("ZOE_RUNTIME_DIR"):
        return Path(os.environ["ZOE_RUNTIME_DIR"])
    if os.environ.get("XDG_RUNTIME_DIR"):
        return Path(os.environ["XDG_RUNTIME_DIR"]) / "zoe"
    return data_dir / "run"


@dataclass
class Paths:
    data_dir: Path
    runtime_dir: Path

    @property
    def db_file(self) -> Path:
        return self.data_dir / "zoe.db"

    @property
    def runtime_file(self) -> Path:
        """Arquivo com porta e token da API local (permissão 0600)."""
        return self.runtime_dir / "core.json"

    @classmethod
    def default(cls) -> "Paths":
        d = _data_dir()
        return cls(d, _runtime_dir(d))


DEFAULT_PORT = 47811

# Níveis de autonomia (seção 4.4 da especificação).
AUTONOMY_LEVELS = (
    "observar",                  # 0: só observa; nada espontâneo
    "conversar",                 # 1: observa e puxa conversa
    "recomendar",                # 2: conversa e recomenda
    "intervir_com_autorizacao",  # 3: pode propor ações, só executa com "sim"
    "intervir_automatico",       # 4: executa regras explícitas configuradas
)

# Frequência das interações espontâneas: intervalo mínimo e teto por hora.
FREQUENCIES = {
    "silenciosa": {"min_gap_s": None, "max_per_hour": 0},
    "baixa": {"min_gap_s": 30 * 60, "max_per_hour": 2},
    "normal": {"min_gap_s": 10 * 60, "max_per_hour": 4},
    "alta": {"min_gap_s": 3 * 60, "max_per_hour": 10},
}

DEFAULT_SETTINGS: dict = {
    "nome_usuario": "",
    "autonomia": "conversar",
    "frequencia": "normal",
    # Horário silencioso: nada espontâneo entre início e fim (HH:MM, local).
    "silencio_inicio": "23:30",
    "silencio_fim": "07:30",
    "nao_perturbe_ate": 0,          # epoch; 0 = desligado
    "monitoramento_ativo": True,
    "intervencoes_ativas": True,
    "foco_minutos_padrao": 25,
    "ocioso_minutos": 5,
    "notificacoes_nativas": True,   # usa notify-send quando a orbe não está aberta
    # Companion (seção 3): lembretes a partir da memória e preferências de interação
    "checkins_memoria": True,       # "Você conseguiu avançar naquele livro?"
    "tom": "equilibrado",           # equilibrado | direto | descontraido
    "assuntos_evitar": [],          # a Zoe não puxa conversa sobre estes assuntos
    # PC Companion (seção 5)
    "pc_alertas": True,             # a Zoe comenta sobre RAM, CPU, disco, temperatura e bateria
    "pc_intervalo_s": 5,            # intervalo entre leituras
    "pc_limites": {"ram_pct": 90, "cpu_pct": 90, "disco_livre_pct": 10, "temp_c": 90, "bateria_pct": 15},
    "retencao_dias": {
        "system_metrics": 7,
        "application_usage": 90,
        "events": 30,
        "notifications": 30,
    },
}
