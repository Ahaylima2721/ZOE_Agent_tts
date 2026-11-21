/* Teste ponta a ponta da janela principal (o app do mockup) com o Zoe Core real.
 * Rodar: xvfb-run -a node tests/e2e_app.js   (ZOE_SHOTS=<dir> salva capturas; ZOE_E2E_EXE testa o executável) */
'use strict';
const { _electron: electron } = require('playwright');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zoe-app-'));
const env = { ...process.env, ZOE_DATA_DIR: path.join(tmp, 'data'), ZOE_RUNTIME_DIR: path.join(tmp, 'run'),
  XDG_CONFIG_HOME: path.join(tmp, 'config'), ZOE_DISABLE_GPU: '1' };
delete env.XDG_SESSION_TYPE;
const shots = process.env.ZOE_SHOTS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, what = 'condição') {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* de novo */ }
    if (Date.now() > end) throw new Error('tempo esgotado esperando ' + what);
    await sleep(100);
  }
}
async function coreApi(method, p, body) {
  const info = JSON.parse(fs.readFileSync(path.join(tmp, 'run', 'core.json'), 'utf8'));
  const r = await fetch(`http://127.0.0.1:${info.port}${p}`, { method,
    headers: { Authorization: `Bearer ${info.token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return r.json();
}
// grava sessões de foco direto no banco (hoje, ontem e na semana anterior) para conferir os gráficos
function seedFocus() {
  const py = `
import sqlite3, time
from datetime import datetime, timedelta
db = sqlite3.connect(r"${path.join(tmp, 'data', 'zoe.db')}")
noon = datetime.combine(datetime.now().date(), datetime.min.time()) + timedelta(hours=9)
rows = [(noon, 'estudo', 3600), (noon - timedelta(days=1), 'trabalho', 1800), (noon - timedelta(days=8), 'estudo', 3600)]
for when, cat, sec in rows:
    t = when.timestamp()
    db.execute("INSERT INTO focus_sessions (user_id, category, planned_min, focused_s, started_at, ended_at, completed) VALUES (1, ?, ?, ?, ?, ?, 1)",
               (cat, sec / 60, sec, t, t + sec))
db.commit()`;
  execFileSync('python3', ['-c', py]);
}

(async () => {
  const exe = process.env.ZOE_E2E_EXE;
  const app = await electron.launch(exe
    ? { executablePath: path.resolve(root, exe), args: ['--no-sandbox'], env, cwd: root }
    : { executablePath: require('electron'), args: [root, '--no-sandbox'], env, cwd: root });
  const results = [];
  const step = async (name, fn) => { await fn(); results.push(name); console.log('  ✓', name); };
  try {
    const page = await until(async () => app.windows().find((w) => w.url().includes('/app/index.html')), 15000, 'janela principal');
    page.on('pageerror', (e) => console.error('[erro na página]', e.message));
    await page.setViewportSize({ width: 1240, height: 800 }).catch(() => {});
    const shot = async (n) => shots && page.screenshot({ path: path.join(shots, n + '.png') });
    const nav = (p) => page.click(`.nav button[data-page="${p}"]`);

    await step('abre a janela principal junto com a orbe e conecta ao Core', async () => {
      assert.equal(app.windows().length, 2);
      await until(async () => (await page.textContent('#onlineTxt')) === 'Zoe Online', 15000, 'online');
      assert.match(await page.textContent('#hello'), /^(Bom dia|Boa tarde|Boa noite)!$/);
      assert.equal(await page.textContent('#statusTxt'), 'Disponível');
      assert.match(await page.textContent('#prodBars'), /Faça uma sessão de foco/);   // sem dados: diz, não inventa
    });

    await step('Hoje: anotar e concluir tarefa atualiza o resumo da Zoe', async () => {
      await page.fill('#quickAddInput', 'Revisar o portfólio');
      await page.press('#quickAddInput', 'Enter');
      await page.waitForSelector('#todayList li:has-text("Revisar o portfólio")');
      await page.click('#todayList li:has-text("Revisar o portfólio") .tick');
      await until(() => page.$eval('#todayList li:has-text("Revisar o portfólio")', (l) => l.classList.contains('done')), 4000, 'concluída');
      await until(async () => /Você concluiu 1 tarefa hoje\./.test(await page.textContent('#summary')), 4000, 'resumo');
    });

    await step('Foco no cartão: iniciar, pausar, continuar e parar', async () => {
      await page.selectOption('#focusActions select', 'estudo');
      await page.click('#focusActions .btn.primary');
      await until(async () => /Sessão atual · Estudo/.test(await page.textContent('#focusLabel')), 4000, 'foco iniciado');
      assert.equal(await page.textContent('#statusTxt'), 'Em foco');
      await page.click('#focusActions .btn.outline');
      await until(async () => (await page.textContent('#focusLabel')) === 'Pausado', 4000, 'pausado');
      await page.click('#focusActions .btn.primary');
      await until(async () => /Sessão atual/.test(await page.textContent('#focusLabel')), 4000, 'retomado');
      await page.click('#focusActions .btn:has-text("Parar")');
      await until(async () => (await page.textContent('#focusLabel')) === 'Pronta para começar', 4000, 'parado');
    });

    await step('gráficos refletem as sessões gravadas (barras, variação e categorias)', async () => {
      seedFocus();
      await nav('tarefas'); await nav('inicio');
      await until(async () => (await page.$$('#prodBars .bar')).length === 7 && !(await page.$('#prodBars .chart-empty')), 5000, 'barras');
      assert.equal(await page.textContent('#prodDelta'), '↑ 50%');                 // 90 min vs 60 min
      const tip = await page.$eval('#prodBars .bar.today .tip', (t) => t.textContent);
      assert.match(tip, /60 min de foco · 1 tarefa$/);
      const legend = await page.$$eval('#catsBody .legend li', (ls) => ls.map((l) => l.textContent));
      assert.deepEqual(legend, ['Estudo · 60 min67%', 'Trabalho · 30 min33%']);
      assert.equal(await page.$$eval('#catsBody .donut circle', (c) => c.length), 2);
    });
    await shot('app-1-inicio');

    await step('Assistente: comando cria tarefa e o Início atualiza sozinho', async () => {
      await nav('assistente');
      await page.fill('#input', 'nova tarefa: Praticar guitarra');
      await page.press('#input', 'Enter');
      await until(async () => /Anotei para hoje: Praticar guitarra/.test(await page.textContent('#log')), 5000, 'resposta');
      await nav('inicio');
      await page.waitForSelector('#todayList li:has-text("Praticar guitarra")');
    });
    await shot('app-2-assistente-volta');

    await step('Tarefas: adicionar com categoria e data, filtrar e apagar', async () => {
      await nav('tarefas');
      await page.fill('#taskForm [name="titulo"]', 'Estudar Python');
      await page.selectOption('#taskForm [name="categoria"]', 'estudo');
      await page.click('#taskForm .btn.primary');
      await page.waitForSelector('#taskList li:has-text("Estudar Python")');
      assert.match(await page.textContent('#taskList li:has-text("Estudar Python") small'), /^Estudo · \d\d\/\d\d$/);
      await page.click('#taskFilter [data-scope="todas"]');
      await until(async () => (await page.$$('#taskList li')).length === 3, 4000, 'todas');
      page.once('dialog', (d) => d.accept());
      await page.hover('#taskList li:has-text("Estudar Python")');
      await page.click('#taskList li:has-text("Estudar Python") .del');
      await until(async () => (await page.$$('#taskList li')).length === 2, 4000, 'apagada');
      // erro de validação aparece no formulário
      await page.fill('#taskForm [name="titulo"]', ' ');
      await page.$eval('#taskForm', (f) => f.requestSubmit());
    });
    await shot('app-3-tarefas');

    await step('Foco (página): escolher duração e categoria e iniciar', async () => {
      await nav('foco');
      await page.click('#focusMins [data-min="15"]');
      await page.click('#focusCat [data-cat="trabalho"]');
      assert.equal(await page.textContent('#focusTimeBig'), '15:00');
      await page.click('#focusActionsBig .btn.primary');
      await until(async () => (await coreApi('GET', '/api/state')).focus?.category === 'trabalho', 4000, 'foco trabalho');
      assert.equal(await page.isVisible('#focusSetup'), false);
      await shot('app-4-foco');
      await page.click('#focusActionsBig .btn:has-text("Parar")');
    });

    await step('Relatórios, Memória e Computador abrem com dados reais', async () => {
      await nav('relatorios');
      await until(async () => (await page.$$('#repFocus .bar')).length === 7, 4000, 'relatório');
      assert.match(await page.textContent('#repNoAi'), /^\d+%$/);
      await nav('memoria');
      await until(async () => (await page.textContent('#memSum')).length > 10, 4000, 'memória');
      await nav('computador');
      await until(() => page.$eval('[data-key="cpu"] .m-val', (e) => /^\d+%$/.test(e.textContent)), 8000, 'CPU');
      await shot('app-5-computador');
    });

    await step('Configurações: mudar o nome muda a saudação', async () => {
      await nav('configuracoes');
      await page.fill('#settingsForm [name="nome_usuario"]', 'Ayalan');
      await page.press('#settingsForm [name="nome_usuario"]', 'Tab');
      await until(async () => (await coreApi('GET', '/api/settings')).nome_usuario === 'Ayalan', 4000, 'nome');
      await shot('app-6-config');
      await nav('inicio');
      await until(async () => /, Ayalan!$/.test(await page.textContent('#hello')), 4000, 'saudação');
    });

    await step('fechar a janela só esconde (a orbe continua) e ela reabre', async () => {
      const hidden = await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('/app/'));
        w.close();
        return !w.isVisible() && !w.isDestroyed();
      });
      assert.equal(hidden, true);
      assert.equal(app.windows().length, 2);
      const orb = app.windows().find((w) => !w.url().includes('/app/'));
      await orb.evaluate(() => window.zoe.openMain('tarefas'));
      await until(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('/app/')).isVisible()), 4000, 'reaberta');
      await until(async () => !(await page.isHidden('.page[data-page="tarefas"]')), 4000, 'abriu em Tarefas');
    });

    console.log(`\n${results.length} verificações passaram`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('\nFALHOU:', e); process.exit(1); });
