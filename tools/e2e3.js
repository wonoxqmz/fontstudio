/* E2E 测试 3：验证全部导出格式（TTF / WOFF / BDF / ZIP） */
'use strict';
const fs = require('fs');
const CHROME = 'C:/Users/LCJ/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const { chromium } = require('playwright-core');

const OUT = 'E:/字体设计/_build/';

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file:///E:/' + encodeURIComponent('字体设计') + '/index.html');
  await page.waitForTimeout(500);

  // 画几个有内容的字形
  const box = await page.locator('#cv').boundingBox();
  const cell = box.width / (+ (await page.$eval("#gridSize", el => el.value))); // 动态网格尺寸
  async function drag(x0, y0, x1, y1) {
    await page.mouse.move(box.x + x0 * cell + 1, box.y + y0 * cell + 1);
    await page.mouse.down();
    await page.mouse.move(box.x + x1 * cell, box.y + y1 * cell, { steps: 4 });
    await page.mouse.up();
  }
  // A：三角
  await drag(3, 12, 12, 12);
  await drag(3, 12, 7, 3);
  await drag(12, 12, 8, 3);
  await drag(5, 8, 10, 8);
  // B：矩形加竖线
  await page.click('#glyphList .gcell:nth-child(2)');
  await page.waitForTimeout(200);
  await drag(3, 3, 12, 3);
  await drag(3, 12, 12, 12);
  await drag(3, 3, 3, 12);
  await drag(12, 3, 12, 12);
  await drag(3, 8, 12, 8);
  await page.waitForTimeout(300);

  // 依次导出四种格式
  const formats = [
    ['ttf', 'e2e3.ttf'],
    ['woff', 'e2e3.woff'],
    ['bdf', 'e2e3.bdf'],
    ['zip', 'e2e3.zip'],
  ];
  for (const [fmt, file] of formats) {
    await page.click('#btnExport');
    await page.waitForTimeout(150);
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click(`#exportMenu button[data-fmt="${fmt}"]`),
    ]);
    await dl.saveAs(OUT + file);
    console.log(`导出 ${fmt.padEnd(5)} -> ${file}  ${fs.statSync(OUT + file).size} bytes`);
    await page.waitForTimeout(200);
  }

  await page.screenshot({ path: OUT + 'e2e3_ui.png' });
  console.log('\n===== JS 错误 =====');
  console.log(errors.length ? errors.join('\n') : '(无)');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('E2E3 失败:', e); process.exit(2); });
