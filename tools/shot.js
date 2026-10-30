/* 通用截图工具：node shot.js <url|file> <out.png> [height] [full] [width] */
'use strict';
const CHROME = 'C:/Users/LCJ/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const { chromium } = require('playwright-core');

(async () => {
  const [, , target, out, h, full, w] = process.argv;
  if (!target || !out) {
    console.error('用法: node shot.js <url|file> <out.png> [height] [full] [width]');
    process.exit(1);
  }
  let url = target;
  if (!/^https?:|^file:/.test(url)) {
    url = 'file:///' + url.replace(/\\/g, '/').replace(/^\/+/, '');
  }
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: +(w || 1200), height: +(h || 900) } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: out, fullPage: full === 'full' });
  console.log('截图已保存:', out);
  await browser.close();
})().catch(e => { console.error(e); process.exit(2); });
