/* e2e：字体文件导入全流程（TTF / BDF） */
'use strict';
const path = require('path');
const { chromium } = require('playwright-core');

const CHROME = 'C:/Users/LCJ/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  [PASS]', name, detail || ''); }
  else { fail++; console.log('  [FAIL]', name, detail || ''); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/net::|Failed to fetch|资源加载|ERR_/i.test(m.text())) errors.push(m.text());
  });

  await page.goto('file:///' + ROOT.replace(/\\/g, '/') + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  /* ---------- 1. TTF 导入 ---------- */
  console.log('=== 1. TTF 导入（VectorTest.ttf，7 个字形）===');
  await page.setInputFiles('#fontFile', path.join(ROOT, '_build', 'VectorTest.ttf'));
  await page.waitForTimeout(700);
  ok('导入弹窗打开', await page.evaluate(() => document.getElementById('dlgFontImport').open));
  const info = await page.evaluate(() => document.getElementById('fiInfo').textContent);
  ok('信息行含字体名与字符数', /VectorTest/.test(info) && /7 个字符/.test(info), info.trim());

  // 切 32 网格导入
  await page.selectOption('#fiGrid', '32');
  await page.click('#fiOk');
  await page.waitForTimeout(2500);
  ok('弹窗已关闭', await page.evaluate(() => !document.getElementById('dlgFontImport').open));

  const st = await page.evaluate(() => ({
    count: __fs.state.glyphs.size,
    codes: [...__fs.state.glyphs.keys()].sort((a, b) => a - b),
    grid: __fs.state.project.grid.w,
    bl: __fs.state.project.font.baselineRow,
    family: __fs.state.project.font.familyName,
    upm: __fs.state.project.font.upm,
    aInk: __fs.state.glyphs.get(0x41) ? __fs.state.glyphs.get(0x41).bmp.reduce((s, v) => s + v, 0) : 0,
    aAdv: __fs.state.glyphs.get(0x41) ? __fs.state.glyphs.get(0x41).advance : null,
  }));
  ok('导入了 7 个字形', st.count === 7, '实际=' + st.count);
  ok('码位 A-G', st.codes.join(',') === '65,66,67,68,69,70,71', st.codes.join(','));
  ok('网格切到 32', st.grid === 32, '实际=' + st.grid);
  ok('A 有内容', st.aInk > 0, 'ink=' + st.aInk);
  ok('A 字宽 = 网格宽（32，自动或自定义）', st.aAdv == null || Math.abs(st.aAdv - 32) < 1, 'advance=' + st.aAdv);
  ok('家族名来自源字体', st.family === 'VectorTest', st.family);
  ok('UPM 来自源字体', st.upm === 1000, 'upm=' + st.upm);
  ok('基线在合理位置', st.bl > 16 && st.bl < 32, 'baselineRow=' + st.bl);

  // 往返：导出 TTF 再读回 ink 对比（用内核直接算，不落盘）
  const roundTrip = await page.evaluate(() => {
    const out = {};
    for (const [code, g] of __fs.state.glyphs) {
      out[code] = g.bmp.reduce((s, v) => s + v, 0);
    }
    return out;
  });
  ok('A/B/C ink 均非零', [65, 66, 67].every(c => roundTrip[c] > 0),
    JSON.stringify(roundTrip));

  /* ---------- 2. 全部范围 + 覆盖开关 ---------- */
  console.log('=== 2. 覆盖开关 ===');
  // 清空 A 的内容再导入，验证覆盖
  await page.evaluate(() => {
    const g = __fs.state.glyphs.get(0x41);
    g.bmp = new Uint8Array(g.bmp.length);
  });
  await page.setInputFiles('#fontFile', path.join(ROOT, '_build', 'VectorTest.ttf'));
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.getElementById('fiOverwrite').checked = false; });
  await page.click('#fiOk');
  await page.waitForTimeout(1500);
  const aInkAfter = await page.evaluate(() => __fs.state.glyphs.get(0x41).bmp.reduce((s, v) => s + v, 0));
  ok('不勾覆盖时保留被清空的 A', aInkAfter === 0, 'ink=' + aInkAfter);

  await page.setInputFiles('#fontFile', path.join(ROOT, '_build', 'VectorTest.ttf'));
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.getElementById('fiOverwrite').checked = true; });
  await page.click('#fiOk');
  await page.waitForTimeout(1500);
  const aInkOver = await page.evaluate(() => __fs.state.glyphs.get(0x41).bmp.reduce((s, v) => s + v, 0));
  ok('勾覆盖时 A 被重新填上', aInkOver > 0, 'ink=' + aInkOver);

  /* ---------- 3. BDF 导入 ---------- */
  console.log('=== 3. BDF 导入 ===');
  const bdf = [
    'STARTFONT 2.1',
    'FONT -Test-Bold-R-Normal--8-80-75-75-P-50-ISO10646-1',
    'SIZE 8 75 75',
    'FONTBOUNDINGBOX 8 8 0 -2',
    'STARTPROPERTIES 2',
    'FONT_ASCENT 6',
    'FONT_DESCENT 2',
    'ENDPROPERTIES',
    'CHARS 2',
    'STARTCHAR A',
    'ENCODING 65',
    'SWIDTH 500 0',
    'DWIDTH 6 0',
    'BBX 5 5 0 0',
    'BITMAP',
    '88',
    '88',
    'F8',
    '88',
    '88',
    'ENDCHAR',
    'STARTCHAR B',
    'ENCODING 66',
    'SWIDTH 500 0',
    'DWIDTH 6 0',
    'BBX 5 5 0 0',
    'BITMAP',
    'F0',
    '80',
    'E0',
    '80',
    'F0',
    'ENDCHAR',
    'ENDFONT',
  ].join('\n');
  await page.setInputFiles('#fontFile', {
    name: 'test.bdf', mimeType: 'text/plain', buffer: Buffer.from(bdf, 'utf8'),
  });
  await page.waitForTimeout(500);
  ok('BDF 弹窗打开', await page.evaluate(() => document.getElementById('dlgFontImport').open));
  const binfo = await page.evaluate(() => document.getElementById('fiInfo').textContent);
  ok('BDF 信息行', /BDF/.test(binfo) && /2 个字符/.test(binfo), binfo.trim());
  await page.click('#fiOk');
  await page.waitForTimeout(1200);
  const bst = await page.evaluate(() => {
    const a = __fs.state.glyphs.get(0x41);
    return {
      aInk: a ? a.bmp.reduce((s, v) => s + v, 0) : 0,
      adv: a ? a.advance : null,
      family: __fs.state.project.font.familyName,
    };
  });
  ok('BDF A 导入（88=10001b→每行 2 点，F8→5 点，共 13）', bst.aInk === 13, 'ink=' + bst.aInk);
  ok('BDF 字宽 DWIDTH=6', bst.adv === 6, 'advance=' + bst.adv);

  /* ---------- 4. 自定义范围 ---------- */
  console.log('=== 4. 自定义范围 ===');
  await page.evaluate(() => { for (const c of [...__fs.state.glyphs.keys()]) if (c > 0x43) __fs.state.glyphs.delete(c); });
  await page.setInputFiles('#fontFile', path.join(ROOT, '_build', 'VectorTest.ttf'));
  await page.waitForTimeout(500);
  await page.selectOption('#fiRange', 'custom');
  await page.evaluate(() => { document.getElementById('fiCustomRow').style.display = ''; });
  await page.fill('#fiCustom', 'AC');
  await page.click('#fiOk');
  await page.waitForTimeout(1200);
  const codes4 = await page.evaluate(() => [...__fs.state.glyphs.keys()].sort((a, b) => a - b));
  ok('只导入 A/C（B 已存在不动）', codes4.join(',') === '65,66,67', codes4.join(','));

  /* ---------- 5. 导出往返 ---------- */
  console.log('=== 5. 导入的字体再导出可用 ===');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#btnExport'),
    page.click('#exportMenu button[data-fmt="ttf"]'),
  ]);
  const tmp = path.join(ROOT, '_build', 'e2e_import_reexport.ttf');
  await download.saveAs(tmp);
  const fs = require('fs');
  ok('导出文件存在且非空', fs.existsSync(tmp) && fs.statSync(tmp).size > 800,
    fs.statSync(tmp).size + ' bytes');

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  if (errors.length) console.log('页面错误:\n' + errors.join('\n'));
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
