/* 打开帮助弹窗后截图，顺便验证版本脚注渲染 */
'use strict';
const CHROME = 'C:/Users/LCJ/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const { chromium } = require('playwright-core');

(async () => {
  const out = process.argv[2] || 'E:/字体设计/_build/help.png';
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('file:///E:/字体设计/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  // 画点东西，让画布不是空白
  await page.click('#btnHelp');
  await page.waitForTimeout(400);
  const dlg = await page.$('#dlgHelp');
  const foot = await page.textContent('.dlg-foot');
  const box = await dlg.boundingBox();
  console.log('帮助弹窗尺寸:', JSON.stringify(box));
  console.log('脚注:', foot);
  await page.screenshot({ path: out });
  console.log('截图已保存:', out);
  await browser.close();
})().catch(e => { console.error(e); process.exit(2); });
