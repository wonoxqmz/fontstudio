/* E2E：更新检查流程（mock 服务器返回新版 / 相同版本 / 手动检查） */
'use strict';
const CHROME = 'C:/Users/LCJ/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const { chromium } = require('playwright-core');

const API = 'https://api.github.com/repos/longchangjin2-arch/fontstudio/contents/version.json';
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  [PASS]', name); }
  else { fail++; console.log('  [FAIL]', name, extra || ''); }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  // mock：比 0.1.3 新
  await page.route(API, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      name: 'version.json', encoding: 'base64',
      content: Buffer.from(JSON.stringify({
        version: '9.9.9',
        notes: '测试更新说明',
        apkUrl: 'https://example.com/test.apk',
      })).toString('base64'),
    }),
  }));

  await page.goto('file:///E:/字体设计/index.html', { waitUntil: 'load' });
  // 等 4 秒的自动检查 + 弹窗（放宽余量）
  await page.waitForFunction(() => document.getElementById('dlgUpdate').open, null, { timeout: 15000 })
    .catch(() => {});

  const autoOpen = await page.evaluate(() => document.getElementById('dlgUpdate').open);
  ok(autoOpen, '启动后自动检查到新版本并弹窗');

  const ver = await page.textContent('#updVer');
  ok(ver.includes('9.9.9'), '弹窗显示新版本号', ver);
  const notes = await page.textContent('#updNotes');
  ok(notes.includes('测试更新说明'), '更新说明正确显示');
  const href = await page.$eval('#updLink', a => a.getAttribute('href'));
  ok(href === 'https://example.com/test.apk', '下载链接正确', href);

  await page.click('#updClose');
  await page.waitForTimeout(150);
  const closed = await page.evaluate(() => !document.getElementById('dlgUpdate').open);
  ok(closed, '「以后再说」可关闭');

  // 手动检查：mock 改成相同版本 → 提示已是最新，不弹窗
  await page.unroute(API);
  await page.route(API, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: Buffer.from(JSON.stringify({ version: '0.1.3' })).toString('base64') }),
  }));
  await page.click('#btnSettings');   // 打开设置面板
  await page.waitForTimeout(200);
  await page.click('#btnCheckUpd');
  await page.waitForTimeout(1500);
  const notOpen = await page.evaluate(() => !document.getElementById('dlgUpdate').open);
  ok(notOpen, '版本相同时不弹更新窗');

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(2); });
