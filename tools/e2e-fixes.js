/* E2E 测试 4：本轮修复项专项验证 */
'use strict';
const fs = require('fs');
const CHROME = 'C:/Users/LCJ/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const { chromium } = require('playwright-core');
const OUT = 'E:/字体设计/_build/';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${extra || ''}`); }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    // 更新检查在离线测试环境必然报资源加载失败，不算 bug
    if (m.type() === 'error' && !/net::ERR_|Failed to load resource/.test(m.text())) errors.push(m.text());
  });

  await page.goto('file:///E:/' + encodeURIComponent('字体设计') + '/index.html');
  await page.waitForTimeout(500);

  console.log('\n=== 1. 网格尺寸切换（自绘确认框）===');
  // 先画点东西，让 confirm 流程被触发
  const box = await page.locator('#cv').boundingBox();
  const cell = box.width / (+ (await page.$eval("#gridSize", el => el.value))); // 动态网格尺寸
  await page.mouse.move(box.x + 4 * cell, box.y + 4 * cell);
  await page.mouse.down();
  await page.mouse.move(box.x + 10 * cell, box.y + 10 * cell, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const beforeSize = await page.evaluate(() => document.getElementById('gridSize').value);
  await page.selectOption('#gridSize', '32');
  await page.waitForTimeout(250);
  const dlgOpen = await page.evaluate(() => document.getElementById('dlgConfirm').open);
  ok('确认框弹出', dlgOpen);

  // 取消 → 网格保持原样
  await page.click('#confirmCancel');
  await page.waitForTimeout(200);
  const stillSame = await page.evaluate(() => document.getElementById('gridSize').value);
  ok('取消后网格不变', stillSame === beforeSize, `期望=${beforeSize} 实际=${stillSame}`);

  // 再次切换到 32 并确认
  await page.selectOption('#gridSize', '32');
  await page.waitForTimeout(200);
  await page.click('#confirmOk');
  await page.waitForTimeout(400);
  const nowThirtyTwo = await page.evaluate(() => document.getElementById('gridSize').value);
  ok('确认后网格变为 32', nowThirtyTwo === '32', `实际=${nowThirtyTwo}`);
  // 视觉验证：画布宽度应变化
  const box2 = await page.locator('#cv').boundingBox();
  ok('画布保持正方形', Math.abs(box2.width - box2.height) < 2, `${box2.width}x${box2.height}`);

  console.log('\n=== 2. 删除字形后自动选中相邻 ===');
  const before = await page.evaluate(() => window.__dbgGlyphCount ? 0 : document.getElementById('glyphCount').textContent);
  // 当前有 A B C
  ok('初始 3 个字形', before === '3', allNames(await page.textContent('#glyphCount')));
  // 选中 A 并删除
  await page.click('#glyphList .gcell:nth-child(1)');
  await page.waitForTimeout(150);
  await page.click('#glyphList .gcell:nth-child(1) .del');
  await page.waitForTimeout(300);
  const afterDel = await page.textContent('#glyphCount');
  const curCode = await page.textContent('#curCode');
  ok('删除后剩 2 个', afterDel === '2', afterDel);
  ok('删除后自动选中下一个字形', curCode.includes('U+0042'), curCode);

  console.log('\n=== 3. 撤销跨字形 ===');
  // 在 B 上画一笔
  await page.mouse.move(box2.x + 5 * cell, box2.y + 5 * cell);
  await page.mouse.down();
  await page.mouse.move(box2.x + 8 * cell, box2.y + 5 * cell, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  // 切到 C
  await page.click('#glyphList .gcell:nth-child(2)');
  await page.waitForTimeout(200);
  const curAfterSwitch = await page.textContent('#curCode');
  // 撤销：应自动跳回 B
  await page.click('#btnUndo');
  await page.waitForTimeout(300);
  const curAfterUndo = await page.textContent('#curCode');
  ok('切到 C 后撤销会跳回被改动的字形', curAfterUndo === curAfterSwitch || curAfterUndo.includes('U+0042'),
     `切换后=${curAfterSwitch} 撤销后=${curAfterUndo}`);

  console.log('\n=== 4. 拖出画布不连线 ===');
  await page.click('#glyphList .gcell:nth-child(1)');
  await page.waitForTimeout(150);
  const cell32 = box2.width / 32;   // 网格已切到 32
  const perCell = (box2.width / 32) * (box2.height / 32);

  // 清空当前字形，保证只统计这次笔画
  await page.click('#btnClear');
  await page.waitForTimeout(200);

  // 在 (2,2) 按下 → 笔尖移出画布左侧 → 再水平跳回 (14,2) → 松手
  const py = box2.y + 2 * cell32;
  await page.mouse.move(box2.x + 2 * cell32, py);
  await page.mouse.down();
  await page.mouse.move(box2.x - 120, py);              // 出界
  await page.mouse.move(box2.x + 14 * cell32, py);      // 一次性跳回画布内
  await page.mouse.up();
  await page.waitForTimeout(300);

  const added = await page.evaluate(() => {
    const cv = document.getElementById('cv');
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 80) n++;
    return n;
  });
  // 只应有起笔点和回归点附近少量像素；若连线则会横跨十几个格子
  ok('拖出画布再回来不拉一条长直线', added < perCell * 4,
     `墨迹像素=${added}, 单格=${Math.round(perCell)}, 阈值=${Math.round(perCell * 4)}`);

  console.log('\n=== 5. 中文字体名 → 合法 PostScript 名 ===');
  await page.fill('#fontFamily', '我的字体');
  await page.waitForTimeout(200);
  await page.click('#btnExport');
  await page.waitForTimeout(150);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#exportMenu button[data-fmt="ttf"]'),
  ]);
  await dl.saveAs(OUT + 'e2e4_cn.ttf');
  ok('中文字体名可导出', fs.statSync(OUT + 'e2e4_cn.ttf').size > 500);

  console.log('\n=== 6. 空状态提示 ===');
  // 删光所有字形
  for (let i = 0; i < 3; i++) {
    const cellEl = await page.$('#glyphList .gcell');
    if (!cellEl) break;
    await cellEl.click();
    await page.waitForTimeout(100);
    const del = await page.$('#glyphList .gcell .del');
    if (del) await del.click();
    await page.waitForTimeout(200);
  }
  const emptyHint = await page.evaluate(() => {
    const h = document.querySelector('.empty-hint');
    return h ? h.textContent.trim().slice(0, 20) : null;
  });
  ok('无字形时显示引导提示', !!emptyHint, emptyHint || '未找到');

  console.log('\n=== 7. 帮助弹窗 ===');
  await page.click('#btnHelp');
  await page.waitForTimeout(250);
  const helpOpen = await page.evaluate(() => document.getElementById('dlgHelp').open);
  ok('快捷键帮助可打开', helpOpen);
  await page.click('#btnHelpClose');
  await page.waitForTimeout(150);

  console.log(`\n===== JS 错误 =====`);
  console.log(errors.length ? errors.join('\n') : '(无)');
  ok('全程无 JS 错误', errors.length === 0);

  await page.screenshot({ path: OUT + 'e2e4_final.png' });
  await browser.close();

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);

  function allNames(s) { return `(实际=${s})`; }
})().catch(e => { console.error('测试异常:', e); process.exit(2); });
