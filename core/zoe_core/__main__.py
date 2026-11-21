"""python -m zoe_core [--port N] [--data-dir DIR]"""
from __future__ import annotations

import argparse
import asyncio
import logging
from pathlib import Path

from .config import DEFAULT_PORT, Paths
from .core import ZoeCore
from .db import Database
from .server import serve


def main() -> None:
    p = argparse.ArgumentParser(prog="zoe_core", description="Serviço local da Zoe")
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--data-dir", type=Path)
    p.add_argument("--runtime-dir", type=Path)
    p.add_argument("-v", "--verbose", action="store_true")
    a = p.parse_args()
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    paths = Paths.default()
    if a.data_dir:
        paths.data_dir = a.data_dir
    if a.runtime_dir:
        paths.runtime_dir = a.runtime_dir
    core = ZoeCore(Database(paths.db_file))
    asyncio.run(serve(core, paths.runtime_file, a.port))


if __name__ == "__main__":
    main()
