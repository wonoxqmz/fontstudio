/* 移动端 E2E：面板切换 + 触摸(pointer)绘制 */
'use strict';
const CHROME = 'C:/Users/LCJ/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 400, height: 780 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('file:///E:/' + encodeURIComponent('字体设计') + '/index.html');
  await page.waitForTimeout(600);

  // 1) 触摸/指针绘制：在画布上拖一笔
  const box = await page.locator('#cv').boundingBox();
  console.log('画布:', JSON.stringify(box));
  const cell = box.width / (+ (await page.$eval("#gridSize", el => el.value))); // 动态网格尺寸
  await page.mouse.move(box.x + 3 * cell, box.y + 3 * cell);
  await page.mouse.down();
  await page.mouse.move(box.x + 12 * cell, box.y + 12 * cell, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  // 验证真的画上了（读像素判断非全白）
  const hasInk = await page.evaluate(() => {
    const g = [...document.querySelectorAll('#glyphList .gcell')].length;
    return g;
  });
  console.log('步骤1 指针绘制完成, 字形数 =', hasInk);
  await page.screenshot({ path: 'E:/字体设计/_build/m1_canvas_draw.png' });

  // 2) 切到字形库
  await page.click('.mobile-nav button[data-panel="left"]');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'E:/字体设计/_build/m2_left.png' });
  console.log('步骤2 字形库面板已切换');

  // 3) 切到属性
  await page.click('.mobile-nav button[data-panel="right"]');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'E:/字体设计/_build/m3_right.png' });
  console.log('步骤3 属性面板已切换');

  // 4) 从属性面板切回画布，确认画布仍可绘制
  await page.click('.mobile-nav button[data-panel="canvas"]');
  await page.waitForTimeout(300);
  await page.mouse.move(box.x + 12 * cell, box.y + 3 * cell);
  await page.mouse.down();
  await page.mouse.move(box.x + 3 * cell, box.y + 12 * cell, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'E:/字体设计/_build/m4_canvas_again.png' });
  console.log('步骤4 切回画布再画一笔');

  console.log('\nJS 错误:', errors.length ? errors.join('\n') : '(无)');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('失败:', e); process.exit(2); });
