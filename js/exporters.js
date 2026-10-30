/* ============================================================================
 * exporters.js — 附加导出格式
 * ---------------------------------------------------------------------------
 *  · BDF  位图点阵字体（嵌入式 / Linux / 超小屏设备的通用格式）
 *  · ZIP  零依赖打包（store 模式，无需压缩库）
 *  · HTML 字体预览页（内嵌 base64 字体，双击即可查看全部字形）
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ CRC32 */

  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* -------------------------------------------------------------------- ZIP */

  /**
   * 生成 ZIP（store 模式，不压缩 —— 字体本身已是紧凑二进制）
   * @param {Array<{name: string, data: Uint8Array|string}>} files
   * @returns {Uint8Array}
   */
  function makeZip(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const nameBytes = enc.encode(f.name);
      const crc = crc32(data);
      const size = data.length;

      const lh = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);        // version needed
      dv.setUint16(6, 0x0800, true);    // flag: 文件名为 UTF-8
      dv.setUint16(8, 0, true);         // method: store
      dv.setUint16(10, 0, true);        // mod time
      dv.setUint16(12, 0x21, true);     // mod date (1980-01-01)
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      chunks.push(lh, data);

      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);        // version made by
      cv.setUint16(6, 20, true);        // version needed
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);        // method
      cv.setUint16(12, 0, true);        // time
      cv.setUint16(14, 0x21, true);     // date
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);   // local header 偏移
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += lh.length + size;
    }

    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    const total = offset + cdSize + 22;
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    for (const c of central) { out.set(c, p); p += c.length; }
    out.set(eocd, p);
    return out;
  }

  /* -------------------------------------------------------------------- BDF */

  /**
   * 生成 BDF 位图点阵字体。
   * BDF 的 y 轴向上，每个像素行用十六进制字节表示（宽度向上补齐到 8 的倍数）。
   * @param {Array<{code:number, bmp:Uint8Array, advance:number}>} glyphs advance 为网格单位
   * @param {object} opt {gridW, gridH, baselineRow, familyName, styleName, version, copyright}
   * @returns {string}
   */
  function makeBDF(glyphs, opt) {
    const W = opt.gridW, H = opt.gridH, bl = opt.baselineRow;
    const desc = H - bl;
    const family = (opt.familyName || 'MyFont').replace(/[\s-]+/g, '');
    const style = (opt.styleName || 'Regular').replace(/[\s-]+/g, '');
    const swidth = Math.round(W * 1000 / H);

    const L = [];
    L.push('STARTFONT 2.1');
    L.push(`FONT -FontStudio-${family}-Medium-R-Normal--${H}-${H * 10}-75-75-M-${swidth}-ISO10646-1`);
    L.push(`SIZE ${H} 75 75`);
    L.push(`FONTBOUNDINGBOX ${W} ${H} 0 ${-desc}`);
    L.push(`STARTPROPERTIES 7`);
    L.push(`FONT_ASCENT ${bl}`);
    L.push(`FONT_DESCENT ${desc}`);
    L.push(`FONT_VERSION "${(opt.version || '1.0').replace(/"/g, '')}"`);
    if (opt.copyright) L.push(`COPYRIGHT "${String(opt.copyright).replace(/"/g, '')}"`);
    L.push(`DEFAULT_CHAR 0`);
    L.push(`CHARSET_REGISTRY "ISO10646"`);
    L.push(`CHARSET_ENCODING "1"`);
    L.push(`ENDPROPERTIES`);
    L.push(`CHARS ${glyphs.length}`);

    for (const g of glyphs) {
      // 实际包围盒
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (g.bmp[y * W + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      const empty = x1 < 0;
      const bw = empty ? 0 : x1 - x0 + 1;
      const bh = empty ? 0 : y1 - y0 + 1;
      // 字体坐标：行 y 占据 [bl-y-1, bl-y]
      const xoff = empty ? 0 : x0;
      const yoff = empty ? 0 : (bl - y1 - 1);
      const adv = Math.round(g.advance);

      L.push(`STARTCHAR U+${g.code.toString(16).toUpperCase().padStart(4, '0')}`);
      L.push(`ENCODING ${g.code}`);
      L.push(`SWIDTH ${swidth} 0`);
      L.push(`DWIDTH ${adv} 0`);
      L.push(`BBX ${bw} ${bh} ${xoff} ${yoff}`);
      L.push('BITMAP');
      if (empty) {
        L.push('00');
      } else {
        // BDF 的位图行宽由本字形的 BBX 宽度决定：ceil(bw / 8) 字节
        const rowBytes = Math.ceil(bw / 8);
        for (let row = 0; row < bh; row++) {
          const srcY = y0 + row;
          let hex = '';
          for (let b = 0; b < rowBytes; b++) {
            let v = 0;
            for (let bit = 0; bit < 8; bit++) {
              const cx = x0 + b * 8 + bit;
              if (cx <= x1 && g.bmp[srcY * W + cx]) v |= (0x80 >> bit);
            }
            hex += v.toString(16).toUpperCase().padStart(2, '0');
          }
          L.push(hex);
        }
      }
      L.push('ENDCHAR');
    }

    L.push('ENDFONT');
    return L.join('\n') + '\n';
  }

  /* ------------------------------------------------------------ 预览 HTML */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /**
   * 生成字体预览页（内嵌 base64 字体，双击即可看效果）
   * @param {string} b64 字体文件的 base64
   * @param {string} mime font/ttf 或 font/woff
   * @param {object} meta {familyName, styleName, version, copyright, glyphCount, upm}
   * @param {string[]} chars 用于展示的字符
   * @returns {string} HTML
   */
  function makePreviewHTML(b64, mime, meta, chars) {
    const fmt = mime === 'font/woff' ? 'woff' : 'truetype';
    const fam = escapeHtml(meta.familyName);
    const sty = escapeHtml(meta.styleName || 'Regular');
    const sample = chars.join('');
    const nums = '0123456789 0123456789';
    const lat = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz';

    const cellHTML = chars.map(c =>
      `<div class="g"><span class="ch">${escapeHtml(c)}</span><span class="cp">U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}</span></div>`
    ).join('');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${fam} ${sty} — 字体预览</title>
<style>
@font-face {
  font-family: 'PreviewFont';
  src: url(data:${mime};base64,${b64}) format('${fmt}');
  font-display: block;
}
:root { --ink:#1a202c; --ink2:#718096; --line:#e2e8f0; --accent:#2b6cb0; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 32px;
  font-family: "Segoe UI","Microsoft YaHei",system-ui,sans-serif;
  background: #f7f9fc; color: var(--ink);
}
.wrap { max-width: 1000px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
.meta { color: var(--ink2); font-size: 13px; margin-bottom: 24px; }
.meta code { background:#eef2f7; padding:1px 6px; border-radius:4px; font-size:12px; }
.card {
  background:#fff; border:1px solid var(--line); border-radius:10px;
  padding:22px 24px; margin-bottom:18px;
}
.card h2 { font-size:12px; color:var(--ink2); margin:0 0 12px; letter-spacing:1px; font-weight:600; }
.preview { font-family:'PreviewFont'; line-height:1.5; word-break:break-all; }
.s1 { font-size:44px; }
.s2 { font-size:26px; }
.s3 { font-size:15px; }
.ctl { display:flex; align-items:center; gap:10px; margin-bottom:14px; font-size:12px; color:var(--ink2); }
.ctl input { flex:1; accent-color: var(--accent); }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(84px,1fr)); gap:10px; }
.g {
  border:1px solid var(--line); border-radius:8px;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  padding:10px 4px 6px; background:#fcfdff;
}
.g .ch { font-family:'PreviewFont'; font-size:40px; line-height:1.1; }
.g .cp { font-size:9px; color:#a0aec0; font-family:Consolas,monospace; margin-top:4px; }
footer { color:var(--ink2); font-size:11px; text-align:center; margin-top:26px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${fam} <span style="color:var(--ink2);font-weight:400">${sty}</span></h1>
  <div class="meta">
    ${escapeHtml(meta.version || '')} ·
    字形 <code>${meta.glyphCount}</code> 个 ·
    UPM <code>${meta.upm}</code>
    ${meta.copyright ? ' · ' + escapeHtml(meta.copyright) : ''}
  </div>

  <div class="card">
    <h2>字号预览</h2>
    <div class="ctl"><span>大小</span><input id="sz" type="range" min="12" max="96" value="44"><span id="szv">44px</span></div>
    <div class="preview" id="prev" style="font-size:44px">${escapeHtml(sample)}</div>
  </div>

  <div class="card"><h2>文本</h2>
    <div class="preview s3">${escapeHtml(lat)}</div>
    <div class="preview s2" style="margin-top:10px">${escapeHtml(nums)}</div>
  </div>

  <div class="card"><h2>字形表（${chars.length}）</h2>
    <div class="grid">${cellHTML}</div>
  </div>

  <footer>由 字形工坊 生成</footer>
</div>
<script>
var sz = document.getElementById('sz');
sz.addEventListener('input', function () {
  document.getElementById('prev').style.fontSize = sz.value + 'px';
  document.getElementById('szv').textContent = sz.value + 'px';
});
<\/script>
</body>
</html>`;
  }

  /* ---------------------------------------------------------------- 工具 */

  function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  global.Exporters = { makeZip, makeBDF, makePreviewHTML, bytesToBase64, crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
