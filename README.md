# Zoe

Uma companheira digital para o Linux: uma orbe roxa que flutua na área de trabalho, conversa, acompanha o seu dia e, nas próximas fases, também os recursos do computador.

![Painel da Zoe](docs/img/painel.png)

## Estrutura

| Pasta / arquivo | O que é |
| --- | --- |
| `desktop/` | **Zoe Desktop** (Electron): orbe flutuante, expressões, balões, conversa, recursos do PC, memória pessoal, ajustes, bandeja |
| `core/` | **Zoe Core** (Python): API local, eventos, decisões, notificações, foco, monitor do PC, memória pessoal, banco SQLite |
| `zoe.design`, `zoe-preview.html`, `zoe-fx.js` | Design da orbe e animações (usados pela Zoe Desktop) |
| `docs/ARQUITETURA.md` | Análise do projeto, escolhas de tecnologia, X11/Wayland, fases |
| `docs/API.md` | API REST e WebSocket, eventos, banco de dados, permissões |
| `packaging/install-linux.sh` | Instala no menu de aplicativos e no início automático (sem root) |

## Rodar

Requisitos: Python 3.10+, Node 18+ e um compositor (GNOME, KDE ou picom).

No Ubuntu/Debian:

```bash
sudo apt install -y python3-aiohttp python3-psutil
```

Em outras distribuições: `python3 -m pip install --user -r core/requirements.txt`.

```bash
cd desktop && npm install && npm start
```

A orbe aparece no canto inferior direito. **Clique** para conversar, **arraste** para mover e use o **clique direito** para abrir o menu (ocultar, foco, pausar, parar tudo). Escreva `ajuda` para ver os comandos.

Se o Electron reclamar do *SUID sandbox* (comum no Ubuntu 24.04+), rode uma vez:

```bash
sudo chown root desktop/node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 desktop/node_modules/electron/dist/chrome-sandbox
```

## Testes

```bash
cd core && python3 -m pip install --user -r requirements-dev.txt && python3 -m pytest -q
```

```bash
cd desktop && xvfb-run -a npm test
```

## Status

Prontas: **Fase 1 (Zoe Desktop)**, **Fase 2 (PC Companion)** e **Fase 3 (Personal Companion)**. As fases 4 a 6 (Guardian, Ollama, evolução) estão descritas em `docs/ARQUITETURA.md`.
