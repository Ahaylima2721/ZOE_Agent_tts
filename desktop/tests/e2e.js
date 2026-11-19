/* Teste ponta a ponta da Zoe Desktop: Electron real + Zoe Core real (Python).
 * Rodar (Linux sem tela):  xvfb-run -a node tests/e2e.js
 * Variáveis: ZOE_SHOTS=<dir> salva capturas de tela. */
'use strict';
const { _electron: electron } = require('playwright');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zoe-e2e-'));
const env = { ...process.env, ZOE_DATA_DIR: path.join(tmp, 'data'), ZOE_RUNTIME_DIR: path.join(tmp, 'run'),
  XDG_CONFIG_HOME: path.join(tmp, 'config'), ZOE_DISABLE_GPU: '1' };
delete env.XDG_SESSION_TYPE;
const shots = process.env.ZOE_SHOTS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, what = 'condição') {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* tenta de novo */ }
    if (Date.now() > end) throw new Error('tempo esgotado esperando ' + what);
    await sleep(100);
  }
}
async function coreApi(method, p, body) {
  const info = JSON.parse(fs.readFileSync(path.join(tmp, 'run', 'core.json'), 'utf8'));
  const r = await fetch(`http://127.0.0.1:${info.port}${p}`, { method,
    headers: { Authorization: `Bearer ${info.token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body) });
  return r.json();
}

(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox'], env, cwd: root });
  const results = [];
  const step = async (name, fn) => { await fn(); results.push(name); console.log('  ✓', name); };
  try {
    const page = await app.firstWindow();
    const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    const shot = async (n) => shots && page.screenshot({ path: path.join(shots, n + '.png'), omitBackground: true });

    await step('janela flutuante transparente, sem borda e sempre no topo', async () => {
      const w = await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        return { top: w.isAlwaysOnTop(), resizable: w.isResizable(), bg: w.getBackgroundColor() };
      });
      assert.equal(w.top, true); assert.equal(w.resizable, false);
      assert.match(w.bg, /^#0{6,8}$/i);
      const b = await until(async () => { const b = await bounds(); return b.width === 128 && b; }, 8000, 'modo orbe');
      assert.equal(b.height, 128);
    });

    await step('conecta ao Zoe Core (iniciado pela própria Zoe)', async () => {
      await until(() => page.$eval('#connDot', (d) => d.classList.contains('on')), 15000, 'conexão');
      assert.equal(await page.$eval('#zoe', (o) => o.classList.contains('offline')), false);
    });
    await shot('1-orbe');

    await step('clique abre o painel e a janela cresce a partir da orbe', async () => {
      const before = await bounds();
      await page.click('#zoe', { force: true });
      await until(async () => (await bounds()).width === 400, 4000, 'modo painel');
      const b = await bounds();
      assert.equal(b.x + b.width, before.x + before.width, 'canto direito da orbe fica no lugar');
      assert.equal(b.y + b.height, before.y + before.height, 'base da orbe fica no lugar');
      assert.equal(await page.isVisible('#panel'), true);
    });

    await step('conversa: comando de foco muda a expressão para "foco"', async () => {
      await page.fill('#input', 'foco 3');
      await page.press('#input', 'Enter');
      await until(() => page.$$eval('.msg.zoe', (m) => m.some((x) => x.textContent.includes('3 minutos de foco'))), 5000, 'resposta');
      await until(() => page.$eval('#zoe', (o) => o.dataset.expression === 'foco'), 3000, 'expressão foco');
      assert.equal(await page.isVisible('#focusChip'), true);
    });
    await shot('2-painel-conversa');

    await step('pergunta fora do que ela sabe recebe resposta honesta', async () => {
      await page.fill('#input', 'me conta uma piada');
      await page.press('#input', 'Enter');
      await until(() => page.$$eval('.msg.zoe', (m) => m.at(-1).textContent.includes('Ollama')), 5000, 'resposta honesta');
    });

    await step('parar o foco pelo chip volta ao normal', async () => {
      await page.click('#focusChip');
      await until(() => page.$eval('#zoe', (o) => o.dataset.expression === 'normal'), 3000, 'expressão normal');
      await until(async () => !(await page.isVisible('#focusChip')), 3000, 'chip some');
    });

    await step('ajustes: mudar a frequência grava no Core', async () => {
      await page.click('[data-tab="ajustes"]');
      await page.selectOption('select[name="frequencia"]', 'baixa');
      await until(async () => (await coreApi('GET', '/api/settings')).frequencia === 'baixa', 3000, 'gravação');
      await page.fill('input[name="nome_usuario"]', 'Ayalan');
      await page.press('input[name="nome_usuario"]', 'Tab');
      await until(async () => (await coreApi('GET', '/api/settings')).nome_usuario === 'Ayalan', 3000, 'nome');
    });
    await shot('3-ajustes');

    await step('fechar painel e receber balão de notificação com ações', async () => {
      await page.click('#closePanel');
      await until(async () => (await bounds()).width === 128, 3000, 'volta ao modo orbe');
      await coreApi('POST', '/api/focus/start', { minutes: 0.02 });   // ~1,2 s
      await page.waitForSelector('.bubble', { timeout: 6000 });
      await until(async () => (await bounds()).width === 360, 3000, 'modo balão');
      assert.match(await page.textContent('.bubble'), /de foco concluídos/);
    });
    await shot('4-balao');

    await step('ação do balão é registrada e inicia nova sessão', async () => {
      await page.click('.bubble .chip:has-text("Mais uma sessão")');
      await until(async () => (await coreApi('GET', '/api/state')).focus, 3000, 'novo foco');
      const notes = await coreApi('GET', '/api/notifications');
      assert.equal(notes[0].status, 'respondida');
      await coreApi('POST', '/api/focus/stop', {});
      await until(async () => (await bounds()).width === 128, 3000, 'balão some');
    });

    await step('arrastar move a janela e a posição é lembrada', async () => {
      const b0 = await bounds();
      await page.evaluate(() => { window.zoe.dragStart({ x: 500, y: 500 }); window.zoe.dragMove({ x: 300, y: 380 }); });
      await sleep(200);
      await page.evaluate(() => window.zoe.dragEnd({ x: 64, y: 64 }));
      await sleep(300);
      const b1 = await bounds();
      assert.equal(b1.x, b0.x - 200); assert.equal(b1.y, b0.y - 120);
      const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'config', 'zoe-desktop', 'window.json'), 'utf8'));
      assert.equal(saved.x, b1.x + 64);
    });

    await step('botão de emergência pausa monitoramento e avisa', async () => {
      await coreApi('POST', '/api/emergency-stop', {});
      await page.waitForSelector('.bubble:has-text("Parei todo o monitoramento")', { timeout: 4000 });
      const st = await coreApi('GET', '/api/state');
      assert.equal(st.monitoring, false); assert.equal(st.interventions, false);
    });

    await step('IPC bloqueia rotas fora da lista permitida', async () => {
      const r = await page.evaluate(() => window.zoe.api('POST', '/api/events', { type: 'USER_IDLE' }));
      assert.equal(r.ok, false);
      assert.equal(await page.evaluate(() => typeof require), 'undefined');
    });

    await step('sem o Core a orbe fica "offline" e reconecta quando ele volta', async () => {
      const pid = JSON.parse(fs.readFileSync(path.join(tmp, 'run', 'core.json'), 'utf8')).pid;
      process.kill(pid, 'SIGTERM');
      await until(() => page.$eval('#zoe', (o) => o.classList.contains('offline')), 5000, 'offline');
      await shot('5-offline');
      await until(() => page.$eval('#connDot', (d) => d.classList.contains('on')), 20000, 'reconexão');
      const pid2 = JSON.parse(fs.readFileSync(path.join(tmp, 'run', 'core.json'), 'utf8')).pid;
      assert.notEqual(pid2, pid);
    });

    console.log(`\n${results.length} verificações passaram`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('\nFALHOU:', e); process.exit(1); });
