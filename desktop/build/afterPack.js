/* Depois de empacotar (Linux): o executável "zoe" vira um lançador que decide o sandbox ANTES do Electron iniciar.
 * - .deb: o pós-instalação deixa o chrome-sandbox com SUID de root → sandbox completo.
 * - AppImage / pasta solta: sem SUID (e o AppArmor do Ubuntu 24.04 bloqueia o sandbox por namespaces) → --no-sandbox,
 *   em vez de o app fechar com "The SUID sandbox helper binary was found, but is not configured correctly". */
'use strict';
const fs = require('fs');
const path = require('path');

const LAUNCHER = `#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
SB="$HERE/chrome-sandbox"
if [ -u "$SB" ] && [ "$(stat -c %u "$SB" 2>/dev/null)" = "0" ] && [ "$(id -u)" != "0" ]; then
  exec "$HERE/zoe-bin" "$@"
fi
exec "$HERE/zoe-bin" --no-sandbox "$@"
`;

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'linux') return;
  const exe = path.join(ctx.appOutDir, ctx.packager.executableName);
  fs.renameSync(exe, `${exe}-bin`);
  fs.writeFileSync(exe, LAUNCHER, { mode: 0o755 });
};
