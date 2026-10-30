/* 开发用：跑通 位图 → 矢量 → TTF 全链路并输出测试字体 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js/vectorize.js'), 'utf8') + '\n' +
            fs.readFileSync(path.join(ROOT, 'js/ttf.js'), 'utf8');
(0, eval)(src);
const { Vectorize, TTF } = globalThis;

/* ---------------------------------------------------------------- 测试字形 */
const N = 16;

function blank() { return new Uint8Array(N * N); }
function set(b, x, y) { if (x >= 0 && y >= 0 && x < N && y < N) b[y * N + x] = 1; }
function rect(b, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(b, x, y);
}

// 1) 实心方块
const g_solid = blank(); rect(g_solid, 2, 2, 13, 13);

// 2) 回字形（带洞）
const g_ring = blank(); rect(g_ring, 1, 1, 14, 14); 
for (let y = 4; y <= 11; y++) for (let x = 4; x <= 11; x++) g_ring[y * N + x] = 0;

// 3) 十字形
const g_cross = blank();
rect(g_cross, 6, 1, 9, 14); rect(g_cross, 1, 6, 14, 9);

// 4) 对角相连的两个方块（测试 8 连通歧义）
const g_diag = blank(); rect(g_diag, 3, 3, 5, 5); rect(g_diag, 6, 6, 8, 8);

// 5) T 形
const g_T = blank(); rect(g_T, 1, 1, 14, 3); rect(g_T, 6, 4, 9, 14);

// 6) 两个不相连的块（测试多轮廓）
const g_two = blank(); rect(g_two, 1, 6, 5, 11); rect(g_two, 9, 4, 14, 12);

// 7) 单像素
const g_dot = blank(); set(g_dot, 8, 8);

const cases = [
  [0x41, g_solid, 'solid'],
  [0x42, g_ring, 'ring'],
  [0x43, g_cross, 'cross'],
  [0x44, g_diag, 'diag'],
  [0x45, g_T, 'T'],
  [0x46, g_two, 'two'],
  [0x47, g_dot, 'dot'],
];

/* ------------------------------------------------------------------- 构建 */
const UPM = 1000;
const baselineRow = N - 2;                    // 基线往下留 2 行作降部
const scale = UPM / N;                        // 1 网格单位 = UPM/N 字体单位

const fb = new TTF.FontBuilder({
  familyName: 'VectorTest',
  styleName: 'Regular',
  version: 'Version 1.000',
  upm: UPM,
  ascender: Math.round(baselineRow * scale),
  descender: -Math.round((N - baselineRow) * scale),
  copyright: 'Test build',
  monospace: true,
});

console.log('字形  环数  轮廓数  顶点数   面积符号');
for (const [code, bmp, name] of cases) {
  const res = Vectorize.vectorize(bmp, N, N, {
    eps: 0.35,
    corner: 0,
    minArea: 0.5,
    yBase: baselineRow,
  });
  let pts = 0;
  const signs = [];
  for (const c of res.contours) {
    pts += c.length;
    // 对 {x,y,on} 点列算有符号面积
    let a2 = 0;
    for (let i = 0, n = c.length; i < n; i++) {
      const p = c[i], q = c[(i + 1) % n];
      a2 += p.x * q.y - q.x * p.y;
    }
    signs.push(a2 / 2 > 0 ? '+' : '-');
  }
  console.log(
    `${name.padEnd(6)}${String(res.rings).padStart(4)}${String(res.contours.length).padStart(7)}${String(pts).padStart(8)}   ${signs.join('')}`
  );

  const scaled = res.contours.map(c => c.map(p => ({
    x: p.x * scale, y: p.y * scale, on: p.on,
  })));
  fb.addGlyph(code, scaled, N * scale);
}

const ttf = fb.build();
const outDir = path.join(ROOT, '_build');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'VectorTest.ttf');
fs.writeFileSync(outPath, Buffer.from(ttf));
console.log('\n写入:', outPath, ttf.length, 'bytes');
