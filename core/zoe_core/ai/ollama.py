"""Cliente mínimo do Ollama (API HTTP local). Só gera texto: nenhuma ferramenta, nenhum comando."""
from __future__ import annotations

import json
import re
from typing import AsyncIterator, Awaitable, Callable

import aiohttp

THINK_RE = re.compile(r"<think>.*?</think>\s*", re.S)


class OllamaError(Exception):
    pass


class OllamaClient:
    def __init__(self, base_url: str, timeout_s: float = 120):
        self.base = base_url.rstrip("/")
        self.timeout = aiohttp.ClientTimeout(total=None, sock_connect=3, sock_read=timeout_s)

    async def _get(self, path: str) -> dict:
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=4)) as s:
                async with s.get(self.base + path) as r:
                    if r.status != 200:
                        raise OllamaError(f"Ollama respondeu {r.status}")
                    return await r.json()
        except (aiohttp.ClientError, OSError, TimeoutError) as e:
            raise OllamaError("não consegui falar com o Ollama") from e

    async def version(self) -> str:
        return (await self._get("/api/version")).get("version", "?")

    async def models(self) -> list[str]:
        return [m["name"] for m in (await self._get("/api/tags")).get("models", [])]

    async def _stream(self, path: str, body: dict) -> AsyncIterator[dict]:
        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as s:
                async with s.post(self.base + path, json=body) as r:
                    if r.status != 200:
                        try:
                            msg = (await r.json()).get("error", "")
                        except Exception:
                            msg = await r.text()
                        raise OllamaError(msg or f"Ollama respondeu {r.status}")
                    async for raw in r.content:
                        line = raw.strip()
                        if not line:
                            continue
                        data = json.loads(line)
                        if data.get("error"):
                            raise OllamaError(data["error"])
                        yield data
        except aiohttp.ClientConnectorError as e:          # nada escutando: Ollama não instalado ou parado
            raise OllamaError("não consegui falar com o Ollama") from e
        except (aiohttp.ClientError, OSError, TimeoutError) as e:
            raise OllamaError("a conexão com o Ollama caiu") from e

    async def chat(self, model: str, messages: list[dict], options: dict | None = None,
                   on_delta: Callable[[str], Awaitable[None]] | None = None, think: bool | None = None) -> str:
        body = {"model": model, "messages": messages, "stream": True, "keep_alive": "5m", "options": options or {}}
        if think is not None:
            body["think"] = think
        parts: list[str] = []
        async for d in self._stream("/api/chat", body):
            piece = (d.get("message") or {}).get("content", "")
            if piece:
                parts.append(piece)
                if on_delta:
                    await on_delta(piece)
            if d.get("done"):
                break
        return THINK_RE.sub("", "".join(parts)).strip()

    async def embed(self, model: str, texts: list[str]) -> list[list[float]]:
        """Embeddings (POST /api/embed). Um pedido para vários textos; o modelo fica carregado 10 min."""
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60, sock_connect=3)) as s:
                async with s.post(self.base + "/api/embed", json={"model": model, "input": texts, "keep_alive": "10m"}) as r:
                    data = await r.json(content_type=None)
                    if r.status != 200 or data.get("error"):
                        raise OllamaError(data.get("error") or f"Ollama respondeu {r.status}")
        except aiohttp.ClientConnectorError as e:
            raise OllamaError("não consegui falar com o Ollama") from e
        except (aiohttp.ClientError, OSError, TimeoutError, ValueError) as e:
            raise OllamaError("falha ao calcular embeddings") from e
        vecs = data.get("embeddings") or []
        if len(vecs) != len(texts):
            raise OllamaError("o Ollama devolveu um número errado de embeddings")
        return vecs

    async def pull(self, model: str, on_progress: Callable[[dict], Awaitable[None]]) -> None:
        async for d in self._stream("/api/pull", {"model": model, "stream": True}):
            await on_progress(d)
