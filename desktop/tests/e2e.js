/* Teste ponta a ponta da Zoe Desktop: Electron real + Zoe Core real (Python).
 * Rodar (Linux sem tela):  xvfb-run -a node tests/e2e.js
 * Variáveis: ZOE_SHOTS=<dir> salva capturas de tela. */
'use strict';
const { _electron: electron } = require('playwright');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zoe-e2e-'));
const env = { ...process.env, ZOE_DATA_DIR: path.join(tmp, 'data'), ZOE_RUNTIME_DIR: path.join(tmp, 'run'),
  XDG_CONFIG_HOME: path.join(tmp, 'config'), ZOE_DISABLE_GPU: '1' };
delete env.XDG_SESSION_TYPE;
const shots = process.env.ZOE_SHOTS;
const children = [];   // servidores simulados (Ollama, Wikipédia): encerrados no fim

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
  // ZOE_E2E_EXE=dist/linux-unpacked/zoe testa o executável empacotado em vez do código-fonte
  const exe = process.env.ZOE_E2E_EXE;
  const app = await electron.launch(exe
    ? { executablePath: path.resolve(root, exe), args: ['--no-sandbox', '--oculto'], env, cwd: root }
    : { executablePath: require('electron'), args: [root, '--no-sandbox', '--oculto'], env, cwd: root });
  const results = [];
  const step = async (name, fn) => { await fn(); results.push(name); console.log('  ✓', name); };
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => console.error('[erro na página]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
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

    await step('recursos: medidores com dados reais e processos', async () => {
      await page.click('[data-tab="recursos"]');
      await until(() => page.$eval('[data-key="cpu"] .m-val', (e) => /^\d+%$/.test(e.textContent)), 6000, 'CPU');
      const ram = await page.$eval('[data-key="ram"] .m-val', (e) => e.textContent);
      assert.match(ram, /^[\d,]+ (MB|GB) de [\d,]+ GB$/);
      const total = (await coreApi('GET', '/api/pc')).snapshot.memory.total;
      assert.match(ram, new RegExp((total / 2 ** 30).toFixed(1).replace('.', ',') + ' GB$'));
      assert.ok((await page.$$('#procList li')).length >= 3, 'lista de processos');
      await page.click('.seg [data-sort="by_cpu"]');
      assert.match(await page.textContent('#procList li .p-val'), /%$/);
      assert.match(await page.textContent('[data-key="gpu"] .m-sub'), /indisponível/);   // sem GPU aqui: diz, não inventa
    });

    await step('recursos: leituras ao vivo enquanto a aba está aberta', async () => {
      await coreApi('PATCH', '/api/settings', { pc_intervalo_s: 2 });
      const before = await page.textContent('#recSum');
      await until(async () => (await page.textContent('#recSum')) !== before, 8000, 'nova leitura');
      await until(() => page.$eval('[data-key="cpu"] .sp-line', (l) => (l.getAttribute('points') || '').split(' ').length >= 2), 8000, 'minilinha');
      await page.hover('[data-key="cpu"] .spark', { position: { x: 300, y: 18 }, force: true });
      await until(() => page.$eval('[data-key="cpu"] .sp-tip', (t) => !t.hidden && /% · \d\d:\d\d:\d\d/.test(t.textContent)), 3000, 'dica');
    });
    await shot('6-recursos');

    await step('recursos: diagnóstico assistido', async () => {
      await page.click('#recDiag');
      await until(() => page.$eval('#recFindings', (e) => !e.hidden && e.textContent.length > 10), 6000, 'diagnóstico');
    });

    await step('ajustes: limite do PC grava sem apagar os outros', async () => {
      await page.click('[data-tab="ajustes"]');
      await page.fill('input[name="pc_limites.ram_pct"]', '85');
      await page.press('input[name="pc_limites.ram_pct"]', 'Tab');
      await until(async () => (await coreApi('GET', '/api/settings')).pc_limites.ram_pct === 85, 3000, 'limite');
      assert.equal((await coreApi('GET', '/api/settings')).pc_limites.cpu_pct, 90);
    });

    await step('chat: "como está o pc" responde com números reais', async () => {
      await page.click('[data-tab="conversa"]');
      await page.fill('#input', 'como está o pc?');
      await page.press('#input', 'Enter');
      await until(() => page.$$eval('.msg.zoe', (m) => /^CPU em \d+%, memória \d+%/.test(m.at(-1).textContent)), 5000, 'resumo');
    });

    const FINAL = '.msg.zoe:not(.typing):not(.streaming)';   // resposta já completa (não em streaming)
    const lastZoe = () => page.$$eval(FINAL, (m) => m.at(-1).textContent);
    // espera um balão NOVO da Zoe (respostas iguais às anteriores não podem enganar o teste)
    const chat = async (text, expect) => {
      const before = await page.$$eval(FINAL, (m) => m.length);
      await page.fill('#input', text);
      await page.press('#input', 'Enter');
      await until(async () => (await page.$$eval(FINAL, (m) => m.length)) > before
        && expect.test(await lastZoe()), 8000, `resposta para "${text}"`);
    };

    await step('memória: conversa pergunta o que falta em vez de inventar', async () => {
      await chat('Estou lendo Duna', /De quem é\?/);
      await chat('Frank Herbert', /Em que capítulo/);
      await chat('5', /^Anotado: Duna, capítulo 5\.$/);
      const book = (await coreApi('GET', '/api/memory')).items.livro[0];
      assert.deepEqual([book.titulo, book.autor, book.capitulo, book.status], ['Duna', 'Frank Herbert', '5', 'lendo']);
    });

    await step('memória: aba mostra o que foi guardado', async () => {
      await page.click('[data-tab="memoria"]');
      await page.waitForSelector('.mem-kind[data-kind="livro"] .mem-item');
      assert.equal(await page.$eval('.mem-kind[data-kind="livro"]', (d) => d.open), true);
      const meta = await page.textContent('.mem-kind[data-kind="livro"] .mem-item small');
      assert.match(meta, /Frank Herbert · cap\. 5 · lendo · falamos hoje/);
    });

    await step('memória: adicionar, editar e apagar pela aba', async () => {
      await page.click('.mem-kind[data-kind="hobby"] summary');
      await page.click('.mem-kind[data-kind="hobby"] .mem-add');
      await page.fill('.mem-kind[data-kind="hobby"] .mem-form [name="nome"]', 'Violão');
      await page.fill('.mem-kind[data-kind="hobby"] .mem-form [name="frequencia"]', '2x por semana');
      await page.click('.mem-kind[data-kind="hobby"] .mem-form button[type="submit"]');
      await page.waitForSelector('.mem-kind[data-kind="hobby"] .mem-item');
      assert.equal((await coreApi('GET', '/api/memory')).items.hobby[0].frequencia, '2x por semana');
      // erro de validação aparece no formulário, não some em silêncio
      await page.click('.mem-kind[data-kind="hobby"] .mem-add');
      await page.click('.mem-kind[data-kind="hobby"] .mem-form button[type="submit"]');
      await until(() => page.$eval('.mem-kind[data-kind="hobby"] .mem-err', (e) => /obrigat/.test(e.textContent)), 3000, 'erro');
      await page.click('.mem-kind[data-kind="hobby"] .mem-form .btn.ghost');
      // editar o capítulo
      await page.click('.mem-kind[data-kind="livro"] .mem-item .icon:has-text("✎")');
      await page.fill('.mem-kind[data-kind="livro"] .mem-form [name="capitulo"]', '6');
      await page.click('.mem-kind[data-kind="livro"] .mem-form button[type="submit"]');
      await until(async () => (await coreApi('GET', '/api/memory')).items.livro[0].capitulo === '6', 3000, 'edição');
      // apagar (com confirmação)
      page.once('dialog', (d) => d.accept());
      await page.click('.mem-kind[data-kind="hobby"] .mem-item .icon:has-text("✕")');
      await until(async () => (await coreApi('GET', '/api/memory')).items.hobby.length === 0, 3000, 'exclusão');
    });
    await shot('9-memoria');

    await step('preferências de interação gravam no Core', async () => {
      await page.click('[data-tab="ajustes"]');
      await page.selectOption('select[name="tom"]', 'direto');
      await page.fill('input[name="assuntos_evitar"]', 'trabalho, dieta');
      await page.press('input[name="assuntos_evitar"]', 'Tab');
      await until(async () => {
        const s = await coreApi('GET', '/api/settings');
        return s.tom === 'direto' && JSON.stringify(s.assuntos_evitar) === '["trabalho","dieta"]';
      }, 3000, 'preferências');
      await page.click('[data-tab="conversa"]');
    });

    await step('ia: sem Ollama, Ajustes explica como instalar', async () => {
      await page.click('[data-tab="ajustes"]');
      await until(() => page.$eval('#iaStatus', (e) => /Ollama não encontrado/.test(e.textContent)), 5000, 'status');
      assert.equal(await page.isVisible('#iaHint code'), true);
    });

    let fakeOllama = null;
    await step('ia: baixa o modelo pela Zoe, com progresso', async () => {
      const port = 20000 + Math.floor(Math.random() * 20000);
      fakeOllama = spawn('python3', [path.join(root, '..', 'core', 'tests', 'fake_ollama.py'), String(port), 'vazio'], { stdio: 'ignore' });
      children.push(fakeOllama);
      await until(async () => (await fetch(`http://127.0.0.1:${port}/api/version`)).ok, 8000, 'Ollama simulado');
      await coreApi('PATCH', '/api/settings', { ia_url: `http://127.0.0.1:${port}` });
      await page.click('[data-tab="conversa"]'); await page.click('[data-tab="ajustes"]');
      await until(() => page.isVisible('#iaPull'), 5000, 'botão de baixar');
      await page.click('#iaPull');
      await until(() => page.$eval('#iaStatus', (e) => /^Pronta: qwen3:0\.6b/.test(e.textContent)), 15000, 'modelo pronto');
    });
    await shot('10-ia-ajustes');

    await step('ia: conversa livre chega aos pedaços (streaming)', async () => {
      await page.click('[data-tab="conversa"]');
      await page.fill('#input', 'me fala de você');
      await page.press('#input', 'Enter');
      await until(() => page.$$eval('.msg.zoe', (m) => { const t = m.at(-1).textContent; return t.startsWith('Oi!') && !t.includes('local.'); }), 5000, 'pedaço parcial');
      await until(() => page.$$eval('.msg.zoe', (m) => m.at(-1).textContent === 'Oi! Eu sou a Zoe, rodando num modelo local.'), 8000, 'resposta completa');
      assert.equal(await page.$$eval('.msg.zoe.typing', (m) => m.length), 0);
    });

    await step('chat: duas perguntas seguidas mantêm a ordem das respostas', async () => {
      await page.fill('#input', 'primeira pergunta solta');
      await page.press('#input', 'Enter');
      await page.fill('#input', 'segunda pergunta solta');
      await page.press('#input', 'Enter');
      await until(() => page.$$eval('#log .msg.typing, #log .msg.streaming', (m) => m.length === 0), 10000, 'respostas');
      const seq = await page.$$eval('#log .msg', (ms) => ms.slice(-4).map((m) => (m.classList.contains('eu') ? 'eu:' : 'zoe:') + m.textContent.slice(0, 16)));
      assert.deepEqual(seq.map((x) => x.split(':')[0]), ['eu', 'zoe', 'eu', 'zoe']);
      assert.ok(seq[0].includes('primeira') && seq[2].includes('segunda'));
    });

    await step('aprendizado: 👍 guarda a resposta e a próxima vem da base, sem IA', async () => {
      await chat('me explica o que é um buraco negro', /rodando num modelo local\./);
      await page.click('.msg.zoe:last-child .msg-fb .fb:has-text("👍")');
      await until(() => page.$eval('.msg.zoe:last-child .msg-fb', (e) => /Guardei/.test(e.textContent)), 4000, 'confirmação do 👍');
      await chat('me explica o que é um buraco negro', /Lembrei da nossa conversa de \d\d\/\d\d/);
      const st = (await coreApi('GET', '/api/learning')).stats;
      assert.equal(st.by_layer.base, 1);
    });

    let fakeWiki = null;
    await step('aprendizado: pesquisa na Wikipédia e responde citando a fonte', async () => {
      const port = 20000 + Math.floor(Math.random() * 20000);
      fakeWiki = spawn('python3', [path.join(root, '..', 'core', 'tests', 'fake_wiki.py'), String(port)], { stdio: 'ignore' });
      children.push(fakeWiki);
      await until(async () => (await fetch(`http://127.0.0.1:${port}/w/rest.php/v1/search/page?q=x`)).ok, 8000, 'Wikipédia simulada');
      await coreApi('PATCH', '/api/settings', { pesquisa_web: true, pesquisa_web_url: `http://127.0.0.1:${port}` });
      await chat('Quem escreveu O Fantasma da Ópera?', /rodando num modelo local\./);
      await page.click('[data-tab="memoria"]');
      await page.click('#learnBox .btn:has-text("Pesquisar agora")');
      await until(() => page.$eval('#learnBox', (e) => /com fonte · Wikipédia · O Fantasma da Ópera/.test(e.textContent)), 6000, 'item com fonte');
      assert.match(await page.textContent('.learn-pct'), /^\d+%$/);
      await page.click('[data-tab="conversa"]');
      await chat('Quem escreveu O Fantasma da Ópera?', /Gaston Leroux/);
      assert.match(await page.textContent('.msg.zoe:last-child .msg-src'), /Fonte: Wikipédia · O Fantasma da Ópera/);
    });
    await shot('11-aprendizado');

    await step('chat: balões longos não se sobrepõem (crescem e o chat rola)', async () => {
      const r = await page.evaluate(() => {
        const log = document.getElementById('log');
        const long = 'Linha de resposta longa da IA, com bastante texto para quebrar em várias linhas no balão.\n'.repeat(6);
        for (let i = 0; i < 4; i++) {
          const z = document.createElement('div'); z.className = 'msg zoe'; z.textContent = long; log.append(z);
        }
        const ms = [...log.querySelectorAll('.msg')];
        return { clipped: ms.filter((m) => m.scrollHeight > m.clientHeight + 1).length,
          overlaps: ms.filter((m, i) => i && m.getBoundingClientRect().top < ms[i - 1].getBoundingClientRect().bottom - 1).length };
      });
      assert.deepEqual(r, { clipped: 0, overlaps: 0 });
    });

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
    children.forEach((c) => c.kill());
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('\nFALHOU:', e); process.exit(1); });
