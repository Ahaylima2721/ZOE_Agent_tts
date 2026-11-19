# Zoe

Uma companheira digital para o Linux: uma orbe roxa que flutua na área de trabalho, conversa, acompanha o seu dia e, nas próximas fases, também os recursos do computador.

![Painel da Zoe](docs/img/painel.png)

## Estrutura

| Pasta / arquivo | O que é |
| --- | --- |
| `desktop/` | **Zoe Desktop** (Electron): orbe flutuante, expressões, balões, conversa, ajustes, bandeja |
| `core/` | **Zoe Core** (Python): API local, eventos, decisões, notificações, foco, banco SQLite |
| `zoe.design`, `zoe-preview.html`, `zoe-fx.js` | Design da orbe e animações (usados pela Zoe Desktop) |
| `docs/ARQUITETURA.md` | Análise do projeto, escolhas de tecnologia, X11/Wayland, fases |
| `docs/API.md` | API REST e WebSocket, eventos, banco de dados, permissões |
| `packaging/install-linux.sh` | Instala no menu de aplicativos e no início automático (sem root) |
| `video/` | Pipeline dos vídeos da Zoe |

## Rodar

Requisitos: Python 3.10+, Node 18+ e um compositor (GNOME, KDE ou picom).

```bash
python3 -m pip install --user -r core/requirements.txt
```

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

A **Fase 1 (Zoe Desktop)** está pronta. As fases 2 a 6 (PC Companion, memória pessoal, Guardian, Ollama, evolução) estão descritas em `docs/ARQUITETURA.md`.
