/* Gera os PNGs de um carrossel (1080 × 1350, formato 4:5 do Instagram).
 * node docs/carrossel/render.js                          → carrossel.html → png/zoe-01.png …
 * node docs/carrossel/render.js tecnico.html zoe-tecnico → png/zoe-tecnico-01.png … */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const out = path.join(__dirname, 'png');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  const [html = 'carrossel.html', prefix = 'zoe'] = process.argv.slice(2);
  await page.goto('file://' + path.join(__dirname, html));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const slides = await page.$$('section.slide');
  for (let i = 0; i < slides.length; i++) {
    const file = path.join(out, `${prefix}-${String(i + 1).padStart(2, '0')}.png`);
    await slides[i].screenshot({ path: file });
    console.log(file);
  }
  await browser.close();
})();
