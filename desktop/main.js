/* ZOE DESKTOP — processo principal do Electron.
 *
 * - Janela flutuante, transparente, sem borda, sempre no topo, fora da barra de tarefas.
 * - A janela tem o tamanho do conteúdo: só a orbe, orbe + balões, ou orbe + painel.
 *   Ela cresce a partir da orbe na direção em que há espaço na tela.
 * - Encontra (ou inicia) o Zoe Core e entrega à interface o endereço do WebSocket.
 * - Chamadas REST passam por aqui (IPC), então a interface nunca faz fetch direto.
 * - Mede o tempo ocioso do sistema e envia USER_IDLE / USER_RETURNED ao Core.
 */
'use strict';
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, powerMonitor, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// ---------------- ambiente gráfico (X11 / Wayland) ----------------
const SESSION = (process.env.XDG_SESSION_TYPE || '').toLowerCase();
const NATIVE_WAYLAND = SESSION === 'wayland' && process.env.ZOE_NATIVE_WAYLAND === '1';
if (process.platform === 'linux') {
  // No Wayland nativo o app não pode posicionar a própria janela nem ficar "sempre no topo".
  // Por padrão a Zoe roda via XWayland, onde as duas coisas funcionam.
  if (!NATIVE_WAYLAND) app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('enable-transparent-visuals');
}
if (process.env.ZOE_DISABLE_GPU === '1') app.disableHardwareAcceleration();
// Sandbox no Linux: decidido pelo lançador "zoe" (build/afterPack.js) ANTES do Electron iniciar;
// daqui de dentro já seria tarde (a checagem do sandbox acontece antes deste código).

// ---------------- registro (zoe.log): tudo o que der errado fica anotado ----------------
const LOG_FILE = path.join(app.getPath('userData'), 'zoe.log');
function logLine(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    fs.appendFileSync(LOG_FILE, line);
  } catch { /* sem disco: segue sem registro */ }
}
process.on('uncaughtException', (e) => { logLine('erro não tratado:', e); console.error(e); });
process.on('unhandledRejection', (e) => { logLine('promessa rejeitada:', e); });
logLine(`iniciando Zoe ${app.getVersion()} (${app.isPackaged ? 'empacotada' : 'código-fonte'}) sessão=${process.env.XDG_SESSION_TYPE || '?'} args=${process.argv.slice(1).join(' ')}`);
const START_HIDDEN = process.argv.includes('--oculto');      // início automático: só a orbe, sem a janela
app.commandLine.appendSwitch('lang', process.env.ZOE_LANG || 'pt-BR');   // horários 24h, textos do sistema em pt-BR

const ORB_BOX = 128;                       // área da orbe (orbe + brilho + flutuação)
const SIZES = { orb: [ORB_BOX, ORB_BOX], bubble: [360, 300], panel: [400, 600] };
const MARGIN = 24;

let win = null, tray = null, core = null, coreProc = null;
let mode = 'orb', anchor = null, hiddenUntil = 0, hideTimer = null;
let monitoringActive = true, idleState = 'active', idleTimer = null, cursorTimer = null;
const statePath = () => path.join(app.getPath('userData'), 'window.json');

// ---------------- Zoe Core ----------------
function runtimeFile() {
  if (process.env.ZOE_RUNTIME_DIR) return path.join(process.env.ZOE_RUNTIME_DIR, 'core.json');
  if (process.env.XDG_RUNTIME_DIR) return path.join(process.env.XDG_RUNTIME_DIR, 'zoe', 'core.json');
  const data = process.env.ZOE_DATA_DIR ||
    path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'zoe');
  return path.join(data, 'run', 'core.json');
}

function readRuntime() {
  try { return JSON.parse(fs.readFileSync(runtimeFile(), 'utf8')); } catch { return null; }
}

async function api(method, p, body) {
  if (!core) throw new Error('Zoe Core indisponível');
  const r = await fetch(`http://127.0.0.1:${core.port}${p}`, {
    method,
    headers: { Authorization: `Bearer ${core.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

async function healthy(info) {
  if (!info) return false;
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/api/health`, {
      headers: { Authorization: `Bearer ${info.token}` }, signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

// no executável o Core vai em resources/core; em desenvolvimento fica ao lado (../core)
function coreDirPath() {
  return process.env.ZOE_CORE_DIR || (app.isPackaged ? path.join(process.resourcesPath, 'core') : path.join(__dirname, '..', 'core'));
}
function pythonCmd() { return process.env.ZOE_PYTHON || 'python3'; }

// uma conexão por vez: a janela e a inicialização pedem o Core ao mesmo tempo
let connecting = null;
function connectCore() {
  if (!connecting) connecting = doConnectCore().finally(() => { connecting = null; });
  return connecting;
}

// Falhas seguidas ao iniciar o Core: espera cada vez mais antes de tentar de novo
// (em vez de reiniciar sem parar) e guarda o motivo para mostrar na interface.
let coreFailures = 0, coreRetryAt = 0, coreError = null;

function explainCoreFailure(stderr, spawnErr) {
  if (spawnErr && spawnErr.code === 'ENOENT') {
    return 'Não encontrei o Python 3. Instale com: sudo apt install python3';
  }
  const mod = /No module named '([^']+)'/.exec(stderr);
  if (mod && mod[1].split('.')[0] === 'aiohttp') {
    return 'Falta a biblioteca aiohttp do Python. Instale com: sudo apt install python3-aiohttp';
  }
  if (mod) return `Falta o módulo Python "${mod[1]}".`;
  const last = stderr.trim().split('\n').pop();
  return last ? `Meu serviço local falhou: ${last}` : 'Meu serviço local não iniciou.';
}

async function doConnectCore() {
  let info = readRuntime();
  if (await healthy(info)) { core = info; coreError = null; coreFailures = 0; return core; }
  if (process.env.ZOE_NO_SPAWN === '1') throw new Error('Zoe Core não está rodando');
  if (Date.now() < coreRetryAt) throw new Error(coreError || 'Zoe Core indisponível');
  // no executável o Core vai em resources/core; em desenvolvimento fica ao lado (../core)
  const coreDir = coreDirPath();
  const py = pythonCmd();
  let stderr = '', exited = false, spawnErr = null;
  // ZOE_PARENT_PID: o Core se encerra sozinho se a Zoe Desktop morrer sem avisar
  coreProc = spawn(py, ['-m', 'zoe_core'], { cwd: coreDir, stdio: ['ignore', 'inherit', 'pipe'],
    // PYTHONDONTWRITEBYTECODE: não gravar cache em /opt (somente leitura para o usuário; o .deb removeria incompleto)
    env: { ...process.env, ZOE_PARENT_PID: String(process.pid), PYTHONDONTWRITEBYTECODE: '1' } });
  coreProc.stderr.on('data', (d) => { process.stderr.write(d); stderr = (stderr + d).slice(-4000); logLine('[core]', String(d).trimEnd()); });
  coreProc.on('error', (e) => { spawnErr = e; exited = true; });
  coreProc.on('exit', (code) => { coreProc = null; exited = true; if (code) console.error(`[zoe] core saiu com código ${code}`); });
  for (let i = 0; i < 50 && !exited; i++) {
    await new Promise((r) => setTimeout(r, 200));
    info = readRuntime();
    if (await healthy(info)) { core = info; coreError = null; coreFailures = 0; return core; }
  }
  if (!exited && coreProc) coreProc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 100));   // deixa o stderr terminar de chegar
  coreFailures++;
  coreRetryAt = Date.now() + Math.min(60000, 5000 * 2 ** (coreFailures - 1));
  coreError = exited ? explainCoreFailure(stderr, spawnErr) : 'Meu serviço local não respondeu a tempo.';
  console.error('[zoe]', coreError);
  logLine('core não iniciou:', coreError);
  throw new Error(coreError);
}

// ---------------- geometria da janela ----------------
function loadAnchor() {
  try {
    const a = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    const d = screen.getDisplayNearestPoint(a);
    if (a.x >= d.workArea.x && a.x <= d.workArea.x + d.workArea.width) return a;
  } catch { /* primeira execução */ }
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - MARGIN - ORB_BOX / 2, y: wa.y + wa.height - MARGIN - ORB_BOX / 2 };
}

function saveAnchor() {
  try { fs.writeFileSync(statePath(), JSON.stringify(anchor)); } catch { /* sem importância */ }
}

/** Calcula os limites da janela para o modo atual, mantendo a orbe no mesmo lugar. */
function layout() {
  const [w, h] = SIZES[mode];
  const wa = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) }).workArea;
  const right = anchor.x > wa.x + wa.width / 2;
  const bottom = anchor.y > wa.y + wa.height / 2;
  const half = ORB_BOX / 2;
  let x = right ? anchor.x + half - w : anchor.x - half;
  let y = bottom ? anchor.y + half - h : anchor.y - half;
  x = Math.min(Math.max(x, wa.x), wa.x + wa.width - w);
  y = Math.min(Math.max(y, wa.y), wa.y + wa.height - h);
  return { bounds: { x: Math.round(x), y: Math.round(y), width: w, height: h }, corner: (bottom ? 'b' : 't') + (right ? 'r' : 'l') };
}

function applyLayout() {
  if (!win) return;
  const { bounds, corner } = layout();
  win.setBounds(bounds);
  win.webContents.send('layout', { mode, corner, nativeWayland: NATIVE_WAYLAND });
}

// ---------------- janela ----------------
function createWindow() {
  anchor = loadAnchor();
  const { bounds } = layout();
  win = new BrowserWindow({
    ...bounds,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, maximizable: false, minimizable: false,
    backgroundColor: '#00000000', show: false, title: 'Zoe',
    type: process.platform === 'linux' ? 'toolbar' : undefined,   // evita foco/alt-tab em vários WMs
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.showInactive(); applyLayout(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
  startCursorFollow();
}

// ---------------- janela principal (o app do mockup) ----------------
let mainWin = null, quitting = false;
function showMain(page) {
  if (!mainWin) {
    mainWin = new BrowserWindow({
      width: 1240, height: 800, minWidth: 900, minHeight: 620, show: false, title: 'Zoe',
      backgroundColor: '#120c22', autoHideMenuBar: true, icon: path.join(__dirname, 'assets', 'zoe.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    mainWin.removeMenu();
    mainWin.loadFile(path.join(__dirname, 'renderer', 'app', 'index.html'));
    mainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWin.webContents.on('will-navigate', (e) => e.preventDefault());
    mainWin.webContents.on('render-process-gone', (_e, d) => logLine('janela principal caiu:', d.reason));
    mainWin.once('ready-to-show', () => mainWin.show());
    // fechar só esconde: a Zoe continua na orbe (sair pelo menu)
    mainWin.on('close', (e) => { if (!quitting) { e.preventDefault(); mainWin.hide(); } });
    mainWin.on('closed', () => { mainWin = null; });
  } else {
    mainWin.show(); mainWin.focus();
  }
  if (page) mainWin.webContents.send('open-page', page);
}

function setHidden(minutes) {
  if (!win) return;
  clearTimeout(hideTimer);
  if (minutes === 0) { hiddenUntil = 0; win.showInactive(); return; }
  win.hide();
  if (minutes > 0) {
    hiddenUntil = Date.now() + minutes * 60000;
    hideTimer = setTimeout(() => { hiddenUntil = 0; win && win.showInactive(); }, minutes * 60000);
  }
  rebuildMenus();
}

// olhos seguem o cursor: lê a posição global ~8x/s (só quando visível)
function startCursorFollow() {
  let last = '';
  cursorTimer = setInterval(() => {
    if (!win || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint(), b = win.getBounds();
    const key = p.x + ',' + p.y + ',' + b.x + ',' + b.y;
    if (key === last) return;
    last = key;
    win.webContents.send('cursor', { x: p.x - b.x, y: p.y - b.y });
  }, 125);
}

// ---------------- ociosidade ----------------
function startIdleWatch() {
  idleTimer = setInterval(async () => {
    if (!core || !monitoringActive) return;
    let limitMin = 5;
    try { limitMin = (await api('GET', '/api/settings')).ocioso_minutos || 5; } catch { return; }
    const idle = powerMonitor.getSystemIdleTime();   // segundos; 0 quando o ambiente não informa
    const next = idle >= limitMin * 60 ? 'idle' : 'active';
    if (next === idleState) return;
    idleState = next;
    const type = next === 'idle' ? 'USER_IDLE' : 'USER_RETURNED';
    api('POST', '/api/events', { type, payload: { idle_s: idle } }).catch(() => {});
  }, 15000);
}

// ---------------- menus (bandeja e clique direito) ----------------
function menuTemplate() {
  const visible = win && win.isVisible();
  return [
    { label: 'Abrir a Zoe', click: () => showMain() },
    { type: 'separator' },
    { label: visible ? 'Ocultar a orbe' : 'Mostrar a orbe', click: () => setHidden(visible ? -1 : 0) },
    { label: 'Ocultar por 30 minutos', enabled: !!visible, click: () => setHidden(30) },
    { type: 'separator' },
    { label: 'Iniciar foco (padrão)', click: () => api('POST', '/api/focus/start', {}).catch(() => {}) },
    { label: 'Abrir conversa', click: () => { setHidden(0); win && win.webContents.send('open-panel', 'conversa'); } },
    { label: 'Configurações', click: () => { setHidden(0); win && win.webContents.send('open-panel', 'ajustes'); } },
    { type: 'separator' },
    monitoringActive
      ? { label: 'Pausar monitoramento', click: () => api('POST', '/api/monitoring', { active: false }).catch(() => {}) }
      : { label: 'Retomar monitoramento', click: () => api('POST', '/api/monitoring', { active: true }).catch(() => {}) },
    { label: '⏻ Parar tudo (emergência)', click: () => api('POST', '/api/emergency-stop', {}).catch(() => {}) },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ];
}

function rebuildMenus() {
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
    tray.setToolTip('Zoe');
    tray.on('click', () => setHidden(win && win.isVisible() ? -1 : 0));
    rebuildMenus();
  } catch (e) {
    // GNOME sem extensão AppIndicator: sem bandeja; o clique direito na orbe tem o mesmo menu.
    console.warn('[zoe] bandeja indisponível:', e.message);
  }
}

// ---------------- IPC ----------------
ipcMain.handle('core:info', async () => {
  try {
    if (core && !(await healthy(core))) core = null;   // Core caiu ou reiniciou com outro token
    const c = core || await connectCore();
    return { ok: true, wsUrl: `ws://127.0.0.1:${c.port}/ws?token=${encodeURIComponent(c.token)}` };
  } catch (e) { return { ok: false, error: e.message }; }
});

const API_ALLOW = [
  ['GET', /^\/api\/(state|settings|health|pc|pc\/diagnose)$/],
  ['GET', /^\/api\/(interactions|notifications)(\?limit=\d+)?$/],
  ['PATCH', /^\/api\/settings$/],
  ['POST', /^\/api\/(chat|focus\/start|focus\/stop|monitoring|emergency-stop|personal-data\/delete)$/],
  ['POST', /^\/api\/notifications\/\d+\/ack$/],
  ['GET', /^\/api\/memory$/],
  ['GET', /^\/api\/(dashboard|tasks(\?escopo=(hoje|todas))?)$/],
  ['POST', /^\/api\/(tasks|focus\/pause|focus\/resume)$/],
  ['PATCH', /^\/api\/tasks\/\d+$/],
  ['DELETE', /^\/api\/tasks\/\d+$/],
  ['GET', /^\/api\/ai$/],
  ['GET', /^\/api\/semantic$/],
  ['POST', /^\/api\/semantic\/calibrate$/],
  ['GET', /^\/api\/learning$/],
  ['POST', /^\/api\/learning\/(feedback|research)$/],
  ['PATCH', /^\/api\/learning\/\d+$/],
  ['DELETE', /^\/api\/learning\/\d+$/],
  ['POST', /^\/api\/ai\/pull$/],
  ['POST', /^\/api\/memory\/[a-z_]+$/],
  ['PATCH', /^\/api\/memory\/[a-z_]+\/\d+$/],
  ['DELETE', /^\/api\/memory\/[a-z_]+\/\d+$/],
];
ipcMain.handle('core:api', async (_e, method, p, body) => {
  if (!API_ALLOW.some(([m, re]) => m === method && re.test(p))) return { ok: false, error: 'rota não permitida' };
  try { return { ok: true, data: await api(method, p, body) }; } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.on('ui:open-main', (_e, page) => showMain(typeof page === 'string' ? page : undefined));
ipcMain.on('ui:mode', (_e, m) => { if (SIZES[m] && m !== mode) { mode = m; applyLayout(); } });
ipcMain.on('ui:state', (_e, st) => {
  if (typeof st.monitoring === 'boolean' && st.monitoring !== monitoringActive) {
    monitoringActive = st.monitoring;
    if (!monitoringActive) idleState = 'active';
    rebuildMenus();
  }
});
// links de fonte (Wikipédia) abrem no navegador do sistema; só https
ipcMain.on('ui:open-external', (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'https:') shell.openExternal(u.toString());
  } catch { /* URL inválida: ignora */ }
});
ipcMain.on('ui:context-menu', () => { if (win) Menu.buildFromTemplate(menuTemplate()).popup({ window: win }); });

// arrastar: a interface manda a posição do ponteiro na tela; aqui a janela acompanha
let drag = null;
ipcMain.on('drag:start', (_e, p) => { if (win) drag = { px: p.x, py: p.y, b: win.getBounds() }; });
ipcMain.on('drag:move', (_e, p) => {
  if (!win || !drag) return;
  win.setPosition(Math.round(drag.b.x + p.x - drag.px), Math.round(drag.b.y + p.y - drag.py));
});
ipcMain.on('drag:end', (_e, orbCenter) => {
  if (!win || !drag) return;
  drag = null;
  const b = win.getBounds();
  anchor = { x: b.x + orbCenter.x, y: b.y + orbCenter.y };
  saveAnchor();
  applyLayout();
});

// ---------------- ciclo de vida ----------------
if (process.argv.includes('--diagnostico')) {
  // zoe --diagnostico: relatório no terminal (e no zoe.log), sem abrir janelas; nunca passa de 45 s
  console.log(`Zoe ${app.getVersion()}: verificando… (leva até 30 segundos)`);
  setTimeout(() => { console.log('Tempo esgotado no diagnóstico. Veja o registro: ' + LOG_FILE); app.exit(3); }, 45000).unref();
  require('./diagnostico').check({ coreDir: coreDirPath(), py: pythonCmd(), runtimeFile: runtimeFile(), packaged: app.isPackaged,
    logFile: LOG_FILE, version: app.getVersion() })
    .then((r) => { console.log(r.text); logLine('diagnóstico:\n' + r.text); app.exit(r.ok ? 0 : 1); })
    .catch((e) => { console.error(e); app.exit(2); });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { setHidden(0); showMain(); });
  app.whenReady().then(async () => {
    // pequeno atraso: em alguns compositores Linux a transparência falha se a janela nascer cedo demais
    await new Promise((r) => setTimeout(r, process.platform === 'linux' ? 300 : 0));
    createWindow();
    createTray();
    if (!START_HIDDEN) showMain();
    connectCore().then(startIdleWatch).catch((e) => console.error('[zoe]', e.message));
    screen.on('display-metrics-changed', applyLayout);
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
    clearInterval(idleTimer); clearInterval(cursorTimer);
    if (coreProc) coreProc.kill('SIGTERM');   // só encerra o Core se foi a Zoe que o iniciou
  });
}
