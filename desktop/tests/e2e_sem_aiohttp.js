/* Reproduz um Python sem a biblioteca aiohttp: a Zoe deve explicar o problema
 * no chat e não ficar reiniciando o Core sem parar.
 * Rodar: xvfb-run -a node tests/e2e_sem_aiohttp.js */
'use strict';
const { _electron: electron } = require('playwright');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zoe-semaio-'));
// um "aiohttp" falso que falha ao importar, igual a quando ele não está instalado
fs.mkdirSync(path.join(tmp, 'fake', 'aiohttp'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'fake', 'aiohttp', '__init__.py'),
  "raise ModuleNotFoundError(\"No module named 'aiohttp'\", name='aiohttp')\n");
const env = { ...process.env, ZOE_DATA_DIR: path.join(tmp, 'data'), ZOE_RUNTIME_DIR: path.join(tmp, 'run'),
  XDG_CONFIG_HOME: path.join(tmp, 'config'), ZOE_DISABLE_GPU: '1', PYTHONPATH: path.join(tmp, 'fake') };
delete env.XDG_SESSION_TYPE;

(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: [root, '--no-sandbox', '--oculto'], env, cwd: root });
  let starts = 0;
  app.process().stderr.on('data', (d) => { starts += (String(d).match(/core saiu com código/g) || []).length; });
  try {
    const page = await app.firstWindow();
    await page.waitForTimeout(2500);
    await page.click('#zoe', { force: true });
    await page.fill('#input', 'oi');
    await page.press('#input', 'Enter');
    const msg = await page.$$eval('.msg.zoe', (m) => m.at(-1).textContent);
    assert.match(msg, /sudo apt install python3-aiohttp/);
    console.log('  ✓ chat explica o que falta:', JSON.stringify(msg));
    await page.waitForTimeout(6000);
    assert.ok(starts <= 3, `tentou iniciar o Core ${starts} vezes em ~9 s`);
    console.log(`  ✓ não fica reiniciando sem parar (${starts} tentativas em ~9 s)`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('\nFALHOU:', e); process.exit(1); });
