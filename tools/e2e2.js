/* E2E 测试 2：字形预览渲染 + 图片导入 */
'use strict';
const fs = require('fs');
const CHROME = 'C:/Users/LCJ/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file:///E:/' + encodeURIComponent('字体设计') + '/index.html');
  await page.waitForTimeout(500);

  // —— 画一个「山」字形到 A（用矩形工具手搓：三竖一横）——
  const box = await page.locator('#cv').boundingBox();
  const cell = box.width / (+ (await page.$eval("#gridSize", el => el.value))); // 动态网格尺寸
  async function drag(nx0, ny0, nx1, ny1) {
    await page.mouse.move(box.x + nx0 * cell + 1, box.y + ny0 * cell + 1);
    await page.mouse.down();
    await page.mouse.move(box.x + nx1 * cell, box.y + ny1 * cell, { steps: 4 });
    await page.mouse.up();
  }
  // 底横 + 三竖
  await drag(2, 11, 13, 11);
  await drag(2, 3, 2, 11);
  await drag(7, 5, 7, 11);
  await drag(13, 3, 13, 11);
  await page.waitForTimeout(200);

  // 截预览面板区域
  const pv = await page.locator('#preview').boundingBox();
  await page.screenshot({
    path: 'E:/字体设计/_build/e2e2_preview.png',
    clip: { x: pv.x - 10, y: pv.y - 40, width: pv.width + 20, height: pv.height + 60 },
  });
  console.log('步骤1: 字形预览截图完成');

  // —— 图片导入 ——
  await page.click('#btnImport');
  await page.setInputFiles('#fileInput', 'E:/字体设计/_build/test_shan.png');
  await page.waitForTimeout(500);
  const dlg = await page.locator('#dlgImport').boundingBox();
  await page.screenshot({
    path: 'E:/字体设计/_build/e2e2_import.png',
    clip: dlg ? { x: dlg.x - 5, y: dlg.y - 5, width: dlg.width + 10, height: dlg.height + 10 } : undefined,
  });
  console.log('步骤2: 导入对话框截图完成, info =', await page.textContent('#importInfo'));

  await page.click('#btnImportOk');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'E:/字体设计/_build/e2e2_after.png' });
  console.log('步骤3: 导入后画布截图完成');

  // 导出并验证（导出在「导出 ▾」下拉菜单里）
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#btnExport'),
    page.click('#exportMenu button[data-fmt="ttf"]'),
  ]);
  await download.saveAs('E:/字体设计/_build/e2e2_export.ttf');
  console.log('步骤4: 导出 TTF,', fs.statSync('E:/字体设计/_build/e2e2_export.ttf').size, 'bytes');

  console.log('\n===== JS 错误 =====');
  console.log(errors.length ? errors.join('\n') : '(无)');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('E2E2 失败:', e); process.exit(2); });
