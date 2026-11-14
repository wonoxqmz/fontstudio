/* fontimport 内核单测：解析 TTF → 栅格化 → 与原位图对比 */
'use strict';
const fs = require('fs');
const path = require('path');
global.window = global;   // 让 window.FontImport 可用

require(path.join(__dirname, '..', 'js', 'fontimport.js'));
const FI = global.FontImport;

(async () => {
  const file = process.argv[2] || path.join(__dirname, '..', '_build', 'VectorTest.ttf');
  const buf = fs.readFileSync(file);
  const font = await FI.parse(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  console.log('kind =', font.kind, '| upm =', font.upm,
    '| chars =', font.chars.size, '| numGlyphs =', font.numGlyphs);
  console.log('name =', JSON.stringify(font.name.family), '/', font.name.subfamily, '| ps =', font.name.psName);

  const codes = [...font.chars.keys()].slice(0, 12).sort((a, b) => a - b);
  console.log('示例码位:', codes.map(c => 'U+' + c.toString(16).toUpperCase()).join(' '));

  // 栅格化前几个字形并画 ASCII 图
  const G = 32, BL = Math.round(G * 0.875);
  for (const code of codes.slice(0, 4)) {
    const r = FI.gridFromSfnt(font, code, G, BL === 0 ? G : G, BL);
    if (!r) continue;
    const ch = code >= 32 && code < 127 ? String.fromCharCode(code) : 'U+' + code.toString(16);
    console.log(`\n--- '${ch}' ink=${r.bmp.reduce((s, v) => s + v, 0)} advance=${r.advance.toFixed(1)}`);
    for (let j = 0; j < Math.min(G, 24); j++) {
      let line = '';
      for (let i = 0; i < G; i++) line += r.bmp[j * G + i] ? '#' : '.';
      if (line.includes('#') || j > 6) console.log(line);
    }
  }

  // 与源位图往返对比（build-test.js 生成的 TTF 里的字形来自网格位图矢量化）
  if (fs.existsSync(path.join(__dirname, '..', 'js', 'vectorize.js'))) {
    console.log('\n=== 往返对比（导入位图 vs 源位图）===');
    const tv = require(path.join(__dirname, '..', 'js', 'vectorize.js'));
    // build-test.js 的源位图在 _build/bmp.json（若有）
    const src = path.join(__dirname, '..', '_build', 'bmp.json');
    if (fs.existsSync(src)) {
      const bmps = new Map(JSON.parse(fs.readFileSync(src, 'utf8')));
      let same = 0, diff = 0;
      for (const [code, { bmp, w, h, bl }] of bmps) {
        const r = FI.gridFromSfnt(font, code, w, h, bl);
        if (!r) { diff++; continue; }
        let d = 0;
        for (let i = 0; i < bmp.length; i++) if (bmp[i] !== r.bmp[i]) d++;
        if (d === 0) same++; else { diff++; console.log(`  U+${(+code).toString(16)} 差异像素 ${d}/${bmp.length}`); }
      }
      console.log(`完全一致: ${same} / 差异: ${diff}`);
    } else {
      console.log('（无 bmp.json，跳过往返对比）');
    }
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
