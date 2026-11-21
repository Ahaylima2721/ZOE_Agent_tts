#!/bin/bash
# Pós-instalação do .deb da Zoe (substitui o padrão do electron-builder).
# Comando "zoe" no PATH (zoe --diagnostico):
if type update-alternatives >/dev/null 2>&1; then
    if [ -L '/usr/bin/${executable}' ] && [ -e '/usr/bin/${executable}' ] && [ "$(readlink '/usr/bin/${executable}')" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi
# Sandbox do Electron: SUID sempre (como o .deb do Chrome). O teste padrão do electron-builder roda como root,
# vê namespaces funcionando e tira o SUID; no Ubuntu 24.04 o AppArmor bloqueia namespaces para o usuário
# comum e o app fecharia. Com SUID o lançador "zoe" usa o sandbox completo.
chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
if hash update-mime-database 2>/dev/null; then update-mime-database /usr/share/mime || true; fi
if hash update-desktop-database 2>/dev/null; then update-desktop-database /usr/share/applications || true; fi
