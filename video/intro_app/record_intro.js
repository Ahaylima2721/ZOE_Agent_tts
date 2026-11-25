// Grava build/intro.html em 1080x1920, em câmera lenta (R = 0.4) para não perder quadros.
// Uso: node record_intro.js   (gera build/frames/ e build/frames.json)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const B = path.join(__dirname, 'build'), OUT = path.join(B, 'frames'), R = 0.4;
(async () => {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);
  const b = await chromium.launch({ args: ['--disable-web-security', '--allow-file-access-from-files'] });
  const ctx = await b.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  // as telas do app (iframes) também precisam dos temporizadores esticados
  await ctx.addInitScript((R) => {
    if (window.top === window) { window.__R = R; return; }
    const st = window.setTimeout, si = window.setInterval;
    window.setTimeout = (f, ms, ...a) => st(f, (ms || 0) / R, ...a);
    window.setInterval = (f, ms, ...a) => si(f, (ms || 0) / R, ...a);
  }, R);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + B + '/intro.html', { waitUntil: 'load' }); await p.waitForTimeout(9000);
  const cdp = await ctx.newCDPSession(p); const frames = []; let n = 0;
  cdp.on('Page.screencastFrame', async f => {
    const name = String(n++).padStart(5, '0') + '.jpg';
    fs.writeFileSync(path.join(OUT, name), Buffer.from(f.data, 'base64')); frames.push([name, f.metadata.timestamp]);
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) { }
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });
  await p.waitForTimeout(300);
  await cdp.send('Animation.enable'); await cdp.send('Animation.setPlaybackRate', { playbackRate: R });
  await p.evaluate(() => window.iniciar());
  await p.waitForFunction(() => window.__acabou === true, null, { timeout: 900000, polling: 1000 });
  await cdp.send('Page.stopScreencast');
  const t0 = await p.evaluate(() => window.__t0wall);
  fs.writeFileSync(path.join(B, 'frames.json'), JSON.stringify({ t0, R, frames }));
  console.log('quadros', frames.length, 'erros', errs.slice(0, 5)); await b.close();
})();
