#!/usr/bin/env bash
# Instala a Zoe para o usuário atual (sem root):
#   - dependências Python do Zoe Core (pip --user) e Electron (npm)
#   - atalho no menu de aplicativos
#   - início automático com a sessão (use --sem-autostart para pular)
set -euo pipefail

ZOE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTOSTART=1
[[ "${1:-}" == "--sem-autostart" ]] && AUTOSTART=0

echo "Zoe em: $ZOE_DIR"

if ! python3 -c 'import aiohttp, psutil' 2>/dev/null; then
  echo "Instalando dependências do Zoe Core…"
  if command -v apt-get >/dev/null; then
    sudo apt-get install -y python3-aiohttp python3-psutil && DEPS_OK=1
  fi
fi
if [[ "${DEPS_OK:-0}" != 1 ]] && ! python3 -c 'import aiohttp, psutil' 2>/dev/null; then
  python3 -m pip install --user -r "$ZOE_DIR/core/requirements.txt" \
    || python3 -m pip install --user --break-system-packages -r "$ZOE_DIR/core/requirements.txt"
fi

if [[ ! -x "$ZOE_DIR/desktop/node_modules/.bin/electron" ]]; then
  echo "Instalando o Electron…"
  (cd "$ZOE_DIR/desktop" && npm install --no-audit --no-fund)
fi

APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS"
DESKTOP_FILE="$APPS/zoe.desktop"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Zoe
Comment=Sua companheira digital
Exec="$ZOE_DIR/desktop/node_modules/.bin/electron" "$ZOE_DIR/desktop"
Icon=$ZOE_DIR/desktop/assets/zoe.png
Terminal=false
Categories=Utility;
StartupNotify=false
X-GNOME-Autostart-enabled=true
EOF
echo "Atalho criado: $DESKTOP_FILE"

if [[ $AUTOSTART == 1 ]]; then
  AUTO="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
  mkdir -p "$AUTO"
  cp "$DESKTOP_FILE" "$AUTO/zoe.desktop"
  echo "Início automático: $AUTO/zoe.desktop"
fi

echo "Pronto. Abra 'Zoe' no menu de aplicativos."
