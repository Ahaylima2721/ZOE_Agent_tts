/* zoe --diagnostico: verifica tudo o que a Zoe precisa e diz como corrigir o que faltar.
 * Roda sem abrir janelas; o relatório vai para o terminal e para o zoe.log. */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000, ...opts, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim(), missing: r.error && r.error.code === 'ENOENT' };
  } catch (e) {
    return { ok: false, out: e.message };
  }
}

async function check({ coreDir, py, runtimeFile, packaged, logFile, version }) {
  const lines = [], fixes = [];
  const item = (ok, label, detail, fix) => {
    lines.push(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok && fix) fixes.push(fix);
  };

  lines.push(`Zoe ${version} · ${packaged ? (process.env.APPIMAGE ? 'AppImage' : 'instalada') : 'código-fonte'} · Electron ${process.versions.electron}`);
  lines.push(`Sessão: ${process.env.XDG_SESSION_TYPE || '?'} · Área de trabalho: ${process.env.XDG_CURRENT_DESKTOP || '?'} · DISPLAY=${process.env.DISPLAY || '(vazio)'}`);

  const pv = run(py, ['--version']);
  item(pv.ok, 'Python 3', pv.ok ? pv.out : (pv.missing ? `"${py}" não encontrado` : pv.out), 'sudo apt install -y python3');
  if (pv.ok) {
    const m = /Python (\d+)\.(\d+)/.exec(pv.out);
    const okVer = m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 10));
    item(okVer, 'Python 3.10 ou mais novo', m ? `${m[1]}.${m[2]}` : '?', 'A Zoe precisa de Python 3.10+ (Ubuntu 22.04 ou mais novo).');
    for (const [mod, pkg] of [['aiohttp', 'python3-aiohttp'], ['psutil', 'python3-psutil']]) {
      const r = run(py, ['-c', `import ${mod}; print(${mod}.__version__)`]);
      item(r.ok, `Biblioteca ${mod}`, r.ok ? r.out : 'não instalada', `sudo apt install -y ${pkg}`);
    }
    const core = run(py, ['-c', 'import zoe_core.server; print("ok")'], { cwd: coreDir });
    item(core.ok, 'Zoe Core', core.ok ? coreDir : core.out.split('\n').pop(), `Verifique a pasta ${coreDir}`);
  }

  let info = null;
  try { info = JSON.parse(fs.readFileSync(runtimeFile, 'utf8')); } catch { /* não está rodando */ }
  if (info) {
    let up = false;
    try {
      const r = await fetch(`http://127.0.0.1:${info.port}/api/health`, { headers: { Authorization: `Bearer ${info.token}` }, signal: AbortSignal.timeout(2000) });
      up = r.ok;
    } catch { /* fora do ar */ }
    item(up, 'Zoe Core rodando', up ? `porta ${info.port}` : `arquivo ${runtimeFile} existe, mas o serviço não responde (será reiniciado ao abrir)`);
  } else {
    lines.push(`· Zoe Core: não está rodando agora (a Zoe inicia ele sozinha ao abrir)`);
  }

  let ollama = false;
  try { ollama = (await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(1500) })).ok; } catch { /* sem Ollama */ }
  lines.push(`${ollama ? '✓' : '·'} Ollama (IA local, opcional) — ${ollama ? 'rodando' : 'não encontrado: curl -fsSL https://ollama.com/install.sh | sh'}`);

  if (packaged && !process.env.APPIMAGE) {
    const sb = path.join(path.dirname(process.execPath), 'chrome-sandbox');
    try {
      const st = fs.statSync(sb);
      const ok = st.uid === 0 && (st.mode & 0o4000) !== 0;
      item(ok, 'chrome-sandbox (segurança do Electron)', ok ? 'ok' : 'sem permissão SUID',
        `sudo chown root:root "${sb}" && sudo chmod 4755 "${sb}"`);
    } catch { /* sem sandbox separado */ }
  }
  if (process.env.APPIMAGE) {
    const fuse = run('sh', ['-c', 'ldconfig -p | grep -q libfuse.so.2']);
    item(fuse.ok, 'libfuse2 (para abrir AppImage)', fuse.ok ? 'ok' : 'ausente', 'sudo apt install -y libfuse2t64   # Ubuntu 24.04+ (no 22.04: libfuse2)');
  }

  lines.push(`Registro: ${logFile}`);
  if (fixes.length) {
    lines.push('', 'Para corrigir, rode:');
    fixes.forEach((f) => lines.push(`  ${f}`));
  } else {
    lines.push('', 'Tudo certo para rodar a Zoe.');
  }
  return { text: lines.join('\n'), ok: !fixes.length };
}

module.exports = { check };
