/* Gera os PNGs do carrossel (1080 × 1350, formato 4:5 do Instagram).
 * Rodar: node docs/carrossel/render.js   →   docs/carrossel/png/zoe-01.png … zoe-06.png */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const out = path.join(__dirname, 'png');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'carrossel.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const slides = await page.$$('section.slide');
  for (let i = 0; i < slides.length; i++) {
    const file = path.join(out, `zoe-${String(i + 1).padStart(2, '0')}.png`);
    await slides[i].screenshot({ path: file });
    console.log(file);
  }
  await browser.close();
})();
