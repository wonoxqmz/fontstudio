/* E2E 测试：真实浏览器里跑完整流程 */
'use strict';
const path = require('path');
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
  await page.waitForTimeout(600);

  // 1. 画布拖动画一个方块
  const box = await page.locator('#cv').boundingBox();
  console.log('画布位置:', JSON.stringify(box));
  const z = await page.evaluate(() => {
    // 通过缩放标签反推不了精确值，直接读内部状态不可行，改用几何：
    return null;
  });
  // 直接在画布中心区域画一个 8x8 的块（用归一化坐标）
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const cell = box.width / (+ (await page.$eval("#gridSize", el => el.value))); // 动态网格尺寸
  async function drag(nx0, ny0, nx1, ny1) {
    await page.mouse.move(box.x + nx0 * cell, box.y + ny0 * cell);
    await page.mouse.down();
    await page.mouse.move(box.x + nx1 * cell, box.y + ny1 * cell, { steps: 5 });
    await page.mouse.up();
  }
  // 矩形工具：点 4 个位置画边框太麻烦，直接用画笔画个 L 形+横线
  await drag(3, 3, 12, 3);   // 顶横线
  await drag(3, 4, 3, 12);   // 左竖线
  await drag(12, 4, 12, 12); // 右竖线
  await drag(3, 12, 12, 12); // 底横线
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'E:/字体设计/_build/e2e_draw.png' });
  console.log('步骤1 完成: 画布绘制');

  // 2. 添加一个汉字
  await page.fill('#charInput', '中');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const count = await page.textContent('#glyphCount');
  console.log('步骤2 完成: 添加「中」, 字形数 =', count);

  // 3. 批量添加
  await page.click('#btnPasteBatch');
  await page.fill('#batchText', '你好世界');
  await page.click('#btnBatchOk');
  await page.waitForTimeout(300);
  console.log('步骤3 完成: 批量添加, 字形数 =', await page.textContent('#glyphCount'));

  // 4. 撤销测试
  await page.click('#btnUndo');
  await page.waitForTimeout(200);

  // 5. 导出 TTF（先展开导出菜单）
  await page.click('#btnExport');
  await page.waitForTimeout(150);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#exportMenu button[data-fmt="ttf"]'),
  ]);
  const outPath = 'E:/字体设计/_build/e2e_export.ttf';
  await download.saveAs(outPath);
  const size = fs.statSync(outPath).size;
  console.log('步骤5 完成: 导出 TTF,', size, 'bytes');

  // 6. 保存项目
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#btnSave'),
  ]);
  await dl2.saveAs('E:/字体设计/_build/e2e_project.json');
  console.log('步骤6 完成: 保存项目 JSON,', fs.statSync('E:/字体设计/_build/e2e_project.json').size, 'bytes');

  // 最终截图
  await page.click('#btnRedo');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'E:/字体设计/_build/e2e_final.png' });

  console.log('\n===== JS 错误 =====');
  console.log(errors.length ? errors.join('\n') : '(无)');

  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('E2E 失败:', e); process.exit(2); });
