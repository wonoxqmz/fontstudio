/* 真实网络验证：不 mock，直接让客户端访问线上更新源 */
'use strict';
const CHROME = 'C:/Users/LCJ/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto('file:///E:/字体设计/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  await page.click('#btnSettings');
  await page.waitForTimeout(300);
  await page.click('#btnCheckUpd');

  // 等 toast 出结果（"已是最新版本" = 连上了；"检查更新失败" = 没连上）
  let text = '';
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(700);
    text = await page.textContent('#toast');
    if (text && !text.includes('正在检查')) break;
  }
  console.log('toast =', JSON.stringify(text));
  const ok = /已是最新版本|发现新版本|v\d/.test(text) && !text.includes('失败');
  console.log(ok ? '[PASS] 真实网络下成功读取线上版本' : '[FAIL] 未能读取线上版本');
  if (errs.length) console.log('JS 错误:', errs.join(' | '));

  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
