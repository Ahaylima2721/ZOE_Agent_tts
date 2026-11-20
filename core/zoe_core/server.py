"""API local (REST + WebSocket) do Zoe Core.

Segurança:
  - escuta só em 127.0.0.1;
  - toda requisição precisa do token gerado no início (Authorization: Bearer
    <token>, ou ?token= no WebSocket). O token fica em core.json (0600);
  - sem CORS: páginas web abertas no navegador não conseguem usar a API;
  - não existe rota que execute comandos arbitrários.
"""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import re
import secrets
from pathlib import Path

from aiohttp import WSMsgType, web

from .ai.engine import is_local_url
from .learning.research import is_allowed_url
from .config import AUTONOMY_LEVELS, FREQUENCIES
from .core import ZoeCore
from .decision import EXPRESSIONS
from .events import CLIENT_EVENTS, EventType

log = logging.getLogger("zoe.server")

CORE_KEY = web.AppKey("core", ZoeCore)
TOKEN_KEY = web.AppKey("token", str)

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
PC_LIMIT_RANGES = {"ram_pct": (50, 99), "cpu_pct": (50, 100), "disco_livre_pct": (1, 50),
                   "temp_c": (60, 105), "bateria_pct": (5, 50)}

SETTINGS_VALIDATORS = {
    "nome_usuario": lambda v: isinstance(v, str) and len(v) <= 40,
    "autonomia": lambda v: v in AUTONOMY_LEVELS,
    "frequencia": lambda v: v in FREQUENCIES,
    "silencio_inicio": lambda v: isinstance(v, str) and bool(_HHMM.match(v)),
    "silencio_fim": lambda v: isinstance(v, str) and bool(_HHMM.match(v)),
    "nao_perturbe_ate": lambda v: isinstance(v, (int, float)) and v >= 0,
    "foco_minutos_padrao": lambda v: isinstance(v, int) and 1 <= v <= 240,
    "ocioso_minutos": lambda v: isinstance(v, int) and 1 <= v <= 240,
    "notificacoes_nativas": lambda v: isinstance(v, bool),
    "pc_alertas": lambda v: isinstance(v, bool),
    "checkins_memoria": lambda v: isinstance(v, bool),
    "ia_ativa": lambda v: isinstance(v, bool),
    "pesquisa_web": lambda v: isinstance(v, bool),
    "pesquisa_web_url": lambda v: isinstance(v, str) and is_allowed_url(v),   # só Wikipédia (ou servidor local de teste)
    "ia_modelo": lambda v: isinstance(v, str) and bool(re.fullmatch(r"[a-z0-9][a-z0-9._:/-]{0,79}", v)),
    "ia_url": lambda v: isinstance(v, str) and is_local_url(v),     # nunca um servidor externo
    "tom": lambda v: v in ("equilibrado", "direto", "descontraido"),
    "assuntos_evitar": lambda v: isinstance(v, list) and len(v) <= 30 and all(isinstance(x, str) and 0 < len(x.strip()) <= 60 for x in v),
    "pc_intervalo_s": lambda v: isinstance(v, int) and not isinstance(v, bool) and 2 <= v <= 60,
    "pc_limites": lambda v: isinstance(v, dict) and all(
        k in PC_LIMIT_RANGES and isinstance(x, (int, float)) and not isinstance(x, bool)
        and PC_LIMIT_RANGES[k][0] <= x <= PC_LIMIT_RANGES[k][1] for k, x in v.items()),
    "retencao_dias": lambda v: isinstance(v, dict) and all(
        k in ("system_metrics", "application_usage", "events", "notifications") and isinstance(d, int) and 1 <= d <= 3650
        for k, d in v.items()),
}
# monitoramento_ativo / intervencoes_ativas mudam só por /api/monitoring e
# /api/emergency-stop, para sempre gerarem o evento correspondente.


def _bad(msg: str, status: int = 400) -> web.Response:
    return web.json_response({"error": msg}, status=status)


@web.middleware
async def auth_middleware(request: web.Request, handler):
    token = request.app[TOKEN_KEY]
    given = request.headers.get("Authorization", "").removeprefix("Bearer ").strip() or request.query.get("token", "")
    if not hmac.compare_digest(given.encode(), token.encode()):
        return _bad("não autorizado", 401)
    return await handler(request)


async def _json(request: web.Request) -> dict:
    try:
        data = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise web.HTTPBadRequest(text='{"error":"json inválido"}', content_type="application/json")
    if not isinstance(data, dict):
        raise web.HTTPBadRequest(text='{"error":"esperado um objeto"}', content_type="application/json")
    return data


# ---------------- rotas ----------------
async def health(request):
    return web.json_response({"ok": True, "name": "zoe-core", "version": "0.1.0"})


async def get_state(request):
    return web.json_response(request.app[CORE_KEY].state())


async def get_settings(request):
    return web.json_response(request.app[CORE_KEY].db.get_settings())


async def patch_settings(request):
    core = request.app[CORE_KEY]
    data = await _json(request)
    for k, v in data.items():
        check = SETTINGS_VALIDATORS.get(k)
        if not check:
            return _bad(f"configuração desconhecida ou somente leitura: {k}")
        if not check(v):
            return _bad(f"valor inválido para {k}")
    current = core.db.get_settings()
    # dicionários (pc_limites, retencao_dias) são mesclados: mudar um limite não apaga os outros
    data = {k: ({**current[k], **v} if isinstance(v, dict) and isinstance(current.get(k), dict) else v)
            for k, v in data.items()}
    settings = core.db.update_settings(data)
    await core.broadcast_state()
    return web.json_response(settings)


async def chat(request):
    core = request.app[CORE_KEY]
    data = await _json(request)
    text = data.get("text")
    if not isinstance(text, str):
        return _bad("campo 'text' obrigatório")
    await core.publish(EventType.USER_REQUEST, {"kind": "chat"}, source="api")
    return web.json_response((await core.chat.reply(text)).to_dict())


async def interactions(request):
    limit = min(int(request.query.get("limit", 50)), 500)
    return web.json_response(request.app[CORE_KEY].db.interactions(limit))


async def notifications(request):
    limit = min(int(request.query.get("limit", 50)), 500)
    return web.json_response(request.app[CORE_KEY].notifications.history(limit))


async def notification_ack(request):
    core = request.app[CORE_KEY]
    data = await _json(request)
    try:
        nid = int(request.match_info["id"])
        await core.handle_notification_action(nid, data.get("action"))
    except ValueError as e:
        return _bad(str(e))
    return web.json_response({"ok": True})


def _pc_or_error(core):
    if not core.pc:
        raise web.HTTPServiceUnavailable(
            text=json.dumps({"error": core.pc_error or "monitor do PC desligado"}, ensure_ascii=False),
            content_type="application/json")
    return core.pc


async def pc_status(request):
    """Leitura atual + histórico curto. Lê na hora se ainda não houver leitura recente."""
    core = request.app[CORE_KEY]
    pc = _pc_or_error(core)
    if not pc.latest or core.clock() - pc.latest["timestamp"] > 15:
        await pc.read()
    return web.json_response(pc.payload())


async def pc_diagnose(request):
    """Diagnóstico assistido sob demanda (mesmo com alertas desligados)."""
    from .pc import diagnostics
    core = request.app[CORE_KEY]
    pc = _pc_or_error(core)
    snap = await pc.read()
    findings = diagnostics.diagnose(snap, list(pc.history), core.db.get_settings().get("pc_limites"))
    return web.json_response({"summary": diagnostics.summary(snap), "findings": [f.to_dict() for f in findings],
                              "processes": snap["processes"]})


# ---------------- memória pessoal (Fase 3) ----------------
def _kind_or_404(request):
    from .companion.memory import KINDS
    key = request.match_info["kind"]
    if key not in KINDS:
        raise web.HTTPNotFound(text=json.dumps({"error": f"tipo desconhecido: {key}"}, ensure_ascii=False),
                               content_type="application/json")
    return key


def _item_id(request) -> int:
    try:
        return int(request.match_info["id"])
    except ValueError:
        raise web.HTTPBadRequest(text='{"error":"id inválido"}', content_type="application/json")


async def memory_all(request):
    from .companion.memory import KINDS
    core = request.app[CORE_KEY]
    kinds = [{"key": k.key, "label": k.label, "plural": k.plural, "name_field": k.name_field,
              "fields": {n: {"kind": f.kind, "choices": list(f.choices), "required": f.required, "max_len": f.max_len,
                             "min": f.minimum, "max": f.maximum} for n, f in k.fields.items()}}
             for k in KINDS.values()]
    return web.json_response({"kinds": kinds, "items": core.memory.all()})


async def memory_create(request):
    core, key = request.app[CORE_KEY], _kind_or_404(request)
    try:
        item, created = core.memory.create(key, await _json(request))
    except ValueError as e:
        return _bad(str(e))
    return web.json_response({"item": item, "created": created}, status=201 if created else 200)


async def memory_update(request):
    core, key = request.app[CORE_KEY], _kind_or_404(request)
    try:
        item = core.memory.update(key, _item_id(request), await _json(request))
    except LookupError as e:
        return _bad(str(e), 404)
    except ValueError as e:
        return _bad(str(e))
    return web.json_response({"item": item})


async def memory_delete(request):
    core, key = request.app[CORE_KEY], _kind_or_404(request)
    if not core.memory.delete(key, _item_id(request)):
        return _bad("item não encontrado", 404)
    return web.json_response({"ok": True})


async def ai_status(request):
    return web.json_response(await request.app[CORE_KEY].ai.status())


async def ai_pull(request):
    """Baixa o modelo configurado (só quando o usuário pede). Progresso vai pelo WebSocket (ai.pull)."""
    core = request.app[CORE_KEY]
    st = await core.ai.status()
    if not st["ollama"]:
        return _bad(st["hint"], 503)
    started = core.ai.start_pull()
    return web.json_response({"started": started, "pull": core.ai.pull_state})


# ---------------- aprendizado ----------------
def _kid(request) -> int:
    try:
        return int(request.match_info["id"])
    except ValueError:
        raise web.HTTPBadRequest(text='{"error":"id inválido"}', content_type="application/json")


async def learning_overview(request):
    core = request.app[CORE_KEY]
    return web.json_response({"stats": core.learning_stats(), "items": core.knowledge.list()})


async def learning_feedback(request):
    core = request.app[CORE_KEY]
    data = await _json(request)
    if not isinstance(data.get("interaction_id"), int):
        return _bad("interaction_id obrigatório")
    try:
        msg = core.learning_feedback(data["interaction_id"], data.get("vote"))
    except ValueError as e:
        return _bad(str(e))
    return web.json_response({"message": msg})


async def learning_update(request):
    core = request.app[CORE_KEY]
    data = await _json(request)
    if data.get("status") not in ("validada", "rejeitada"):
        return _bad("status deve ser validada ou rejeitada")
    if not core.knowledge.set_status(_kid(request), data["status"]):
        return _bad("item não encontrado", 404)
    return web.json_response({"ok": True})


async def learning_delete(request):
    if not request.app[CORE_KEY].knowledge.delete(_kid(request)):
        return _bad("item não encontrado", 404)
    return web.json_response({"ok": True})


async def learning_research(request):
    """Pesquisa agora (botão), sem esperar a conversa terminar. Só com a opção ligada."""
    core = request.app[CORE_KEY]
    if not core.research.enabled()[0]:
        return _bad("a pesquisa na internet está desligada em Ajustes", 409)
    return web.json_response({"learned": await core.research.run()})


async def post_event(request):
    core = request.app[CORE_KEY]
    data = await _json(request)
    try:
        etype = EventType(data.get("type"))
    except ValueError:
        return _bad("tipo de evento desconhecido")
    if etype not in CLIENT_EVENTS:
        return _bad("este evento não pode ser enviado por clientes", 403)
    payload = data.get("payload") or {}
    if not isinstance(payload, dict):
        return _bad("payload deve ser um objeto")
    await core.publish(etype, payload, source="desktop")
    return web.json_response({"ok": True})


async def focus_start(request):
    core = request.app[CORE_KEY]
    data = await _json(request)
    mins = data.get("minutes", core.db.get_settings()["foco_minutos_padrao"])
    if not isinstance(mins, (int, float)):
        return _bad("minutes deve ser número")
    try:
        await core.focus.start(mins)
    except ValueError as e:
        return _bad(str(e))
    return web.json_response(core.focus.status())


async def focus_stop(request):
    core = request.app[CORE_KEY]
    stopped = await core.focus.stop()
    return web.json_response({"stopped": stopped})


async def monitoring(request):
    core = request.app[CORE_KEY]
    data = await _json(request)
    if not isinstance(data.get("active"), bool):
        return _bad("campo 'active' (bool) obrigatório")
    await core.set_monitoring(data["active"])
    return web.json_response(core.state())


async def emergency_stop(request):
    core = request.app[CORE_KEY]
    await core.emergency_stop()
    return web.json_response(core.state())


async def delete_personal_data(request):
    core = request.app[CORE_KEY]
    data = await _json(request)
    if data.get("confirm") != "APAGAR":
        return _bad("envie {\"confirm\": \"APAGAR\"} para confirmar")
    await core.focus.stop(reason="dados apagados")
    core.db.delete_personal_data()
    await core.broadcast_state()
    return web.json_response({"ok": True})


async def _ws_chat(core, ws, text: str, ref) -> None:
    async def delta(piece: str) -> None:
        if not ws.closed:
            await ws.send_json({"type": "chat.delta", "ref": ref, "text": piece})

    try:
        await core.publish(EventType.USER_REQUEST, {"kind": "chat"}, source="ws")
        reply = await core.chat.reply(text, on_delta=delta)
        if not ws.closed:
            await ws.send_json({"type": "chat.reply", "ref": ref, **reply.to_dict()})
    except Exception:
        log.exception("falha respondendo no chat")
        if not ws.closed:
            await ws.send_json({"type": "chat.reply", "ref": ref, "text": "Tive um problema para responder. Tenta de novo?",
                                "expression": "preocupada", "quick_replies": []})


async def websocket(request):
    core = request.app[CORE_KEY]
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    core.hub.clients.add(ws)
    tasks: set[asyncio.Task] = set()
    await ws.send_json({"type": "hello", "state": core.state(), "expressions": list(EXPRESSIONS)})
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except json.JSONDecodeError:
                continue
            kind = data.get("type")
            if kind == "ping":
                await ws.send_json({"type": "pong"})
            elif kind == "chat" and isinstance(data.get("text"), str):
                # em tarefa própria: a IA pode levar segundos e o WebSocket continua respondendo (ping, ack…)
                tasks.add(asyncio.create_task(_ws_chat(core, ws, data["text"], data.get("ref"))))
                tasks = {t for t in tasks if not t.done()}
            elif kind == "notification.ack" and isinstance(data.get("id"), int):
                await core.handle_notification_action(data["id"], data.get("action"))
            elif kind == "pc.subscribe" and core.pc:
                # painel de recursos aberto/fechado: só então mandamos leituras ao vivo
                if data.get("on"):
                    core.pc.subscribers.add(ws)
                    core.pc.wake()
                else:
                    core.pc.subscribers.discard(ws)
    finally:
        core.hub.clients.discard(ws)
        if core.pc:
            core.pc.subscribers.discard(ws)
    return ws


def build_app(core: ZoeCore, token: str) -> web.Application:
    app = web.Application(middlewares=[auth_middleware], client_max_size=64 * 1024)
    app[CORE_KEY] = core
    app[TOKEN_KEY] = token
    app.router.add_get("/api/health", health)
    app.router.add_get("/api/state", get_state)
    app.router.add_get("/api/settings", get_settings)
    app.router.add_patch("/api/settings", patch_settings)
    app.router.add_post("/api/chat", chat)
    app.router.add_get("/api/interactions", interactions)
    app.router.add_get("/api/notifications", notifications)
    app.router.add_post("/api/notifications/{id}/ack", notification_ack)
    app.router.add_post("/api/events", post_event)
    app.router.add_get("/api/pc", pc_status)
    app.router.add_get("/api/memory", memory_all)
    app.router.add_get("/api/ai", ai_status)
    app.router.add_get("/api/learning", learning_overview)
    app.router.add_post("/api/learning/feedback", learning_feedback)
    app.router.add_post("/api/learning/research", learning_research)
    app.router.add_patch("/api/learning/{id}", learning_update)
    app.router.add_delete("/api/learning/{id}", learning_delete)
    app.router.add_post("/api/ai/pull", ai_pull)
    app.router.add_post("/api/memory/{kind}", memory_create)
    app.router.add_patch("/api/memory/{kind}/{id}", memory_update)
    app.router.add_delete("/api/memory/{kind}/{id}", memory_delete)
    app.router.add_get("/api/pc/diagnose", pc_diagnose)
    app.router.add_post("/api/focus/start", focus_start)
    app.router.add_post("/api/focus/stop", focus_stop)
    app.router.add_post("/api/monitoring", monitoring)
    app.router.add_post("/api/emergency-stop", emergency_stop)
    app.router.add_post("/api/personal-data/delete", delete_personal_data)
    app.router.add_get("/ws", websocket)

    async def on_startup(app):
        await core.start()

    async def on_cleanup(app):
        await core.stop()

    async def on_shutdown(app):
        # sem isto o aiohttp espera os WebSockets abertos antes de encerrar
        for ws in list(core.hub.clients):
            await ws.close(code=1001, message=b"zoe core encerrando")

    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)
    app.on_cleanup.append(on_cleanup)
    return app


def write_runtime_file(path: Path, port: int, token: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"host": "127.0.0.1", "port": port, "token": token, "pid": os.getpid()}, f)
    os.replace(tmp, path)


async def _watch_parent(stop: asyncio.Event) -> None:
    """Encerra o Core quando o processo que o iniciou (Zoe Desktop) deixa de existir."""
    parent = int(os.environ["ZOE_PARENT_PID"])
    while True:
        await asyncio.sleep(2)
        try:
            os.kill(parent, 0)
        except ProcessLookupError:
            log.info("processo pai %s terminou; encerrando", parent)
            stop.set()
            return
        except PermissionError:
            pass


async def serve(core: ZoeCore, runtime_file: Path, port: int) -> None:
    token = secrets.token_urlsafe(32)
    app = build_app(core, token)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    try:
        site = web.TCPSite(runner, "127.0.0.1", port)
        await site.start()
    except OSError:
        log.warning("porta %s ocupada; usando uma porta livre", port)
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
    real_port = site._server.sockets[0].getsockname()[1]
    write_runtime_file(runtime_file, real_port, token)
    log.info("Zoe Core ouvindo em 127.0.0.1:%s (runtime: %s)", real_port, runtime_file)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    import signal
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:   # Windows
            pass
    watcher = asyncio.create_task(_watch_parent(stop)) if os.environ.get("ZOE_PARENT_PID") else None
    try:
        await stop.wait()
    finally:
        if watcher:
            watcher.cancel()
        try:
            runtime_file.unlink()
        except FileNotFoundError:
            pass
        await runner.cleanup()
