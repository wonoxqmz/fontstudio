/* ============================================================
 * fontimport.js — 字体导入内核
 * 解析 TTF / WOFF / BDF，把字形栅格化到画布网格（导出的逆运算）
 *
 * 坐标约定（与 vectorize.js / ttf.js 一致）：
 *   网格 (i,j)（j 从顶部数）→ 字体单位 y = (baselineRow - j) * (upm / grid.h)
 *   导入逆运算：fx/scale → gx；gy = baselineRow - fy/scale，scale = srcUpm / grid.h
 * ============================================================ */
window.FontImport = (function () {
  'use strict';

  /* ---------------- 字节读取 ---------------- */

  class R {
    constructor(u8, start, end) {
      this.data = u8.subarray(start || 0, end == null ? u8.length : end);
      this.dv = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
      this.p = 0;
    }
    u8() { return this.data[this.p++]; }
    u16() { const v = this.dv.getUint16(this.p); this.p += 2; return v; }
    s16() { const v = this.dv.getInt16(this.p); this.p += 2; return v; }
    u32() { const v = this.dv.getUint32(this.p); this.p += 4; return v; }
    f2() { return this.s16() / 16384; }   // F2Dot14
    skip(n) { this.p += n; }
    eof() { return this.p >= this.data.length; }
  }

  function ascii(u8, start, len) {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(u8[start + i]);
    return s;
  }

  /** zlib 解压（WOFF 表用） */
  async function inflateZlib(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前环境不支持解压（DecompressionStream 缺失）');
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  /* ---------------- cmap：码位 → GID ---------------- */

  function pickCmapSubtable(u8, off) {
    const r = new R(u8, off);
    r.u16(); // version
    const n = r.u16();
    let best = null, bestScore = -1;
    for (let i = 0; i < n; i++) {
      const pid = r.u16(), eid = r.u16(), soff = r.u32();
      let score = 0;
      if (pid === 3 && (eid === 10 || eid === 1)) score = eid === 10 ? 5 : 3;
      else if (pid === 0) score = 4;
      else if (pid === 1) score = 1;
      if (score > bestScore) { bestScore = score; best = off + soff; }
    }
    return best;
  }

  function parseCmapFormat(u8, soff) {
    const r = new R(u8, soff);
    const fmt = r.u16();
    if (fmt === 4) {
      r.u16(); r.u16();   // length, language
      const segX2 = r.u16();
      const seg = segX2 / 2;
      r.skip(6); // searchRange, entrySelector, rangeShift
      const endStart = r.p;
      r.skip(segX2 + 2);           // endCode[] + reservedPad
      const startStart = r.p;      // startCode[]
      r.skip(segX2);
      const deltaStart = r.p;      // idDelta[]
      r.skip(segX2);
      const rangeStart = r.p;      // idRangeOffset[]
      const dv = r.dv;
      const map = new Map();
      for (let i = 0; i < seg; i++) {
        const end = dv.getUint16(endStart + i * 2);
        const start = dv.getUint16(startStart + i * 2);
        const delta = dv.getInt16(deltaStart + i * 2) & 0xffff;
        const rangeOff = dv.getUint16(rangeStart + i * 2);
        if (start === 0xffff) continue;
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let gid;
          if (rangeOff === 0) {
            gid = (c + delta) & 0xffff;
          } else {
            // idRangeOffset 是相对自身项的字节偏移；glyphIdArray 从该项起
            gid = dv.getUint16(rangeStart + i * 2 + rangeOff + (c - start) * 2);
            if (gid) gid = (gid + delta) & 0xffff;
          }
          if (gid) map.set(c, gid);
        }
      }
      return map;
    }
    if (fmt === 12) {
      r.u16();
      r.u32(); r.u32();
      const n = r.u32();
      const map = new Map();
      for (let i = 0; i < n; i++) {
        const s = r.u32(), e = r.u32(), sg = r.u32();
        if (e - s > 65536) continue;   // 异常大组跳过
        for (let c = s; c <= e; c++) {
          const gid = sg + (c - s);
          if (gid) map.set(c, gid);
        }
      }
      return map;
    }
    if (fmt === 6) {
      r.u16(); r.u16();   // length, language
      const first = r.u16(), cnt = r.u16();
      const map = new Map();
      for (let i = 0; i < cnt; i++) { const g = r.u16(); if (g) map.set(first + i, g); }
      return map;
    }
    if (fmt === 0) {
      r.u16(); r.u16(); r.u16();
      const map = new Map();
      for (let c = 0; c < 256; c++) { const g = r.u8(); if (g) map.set(c, g); }
      return map;
    }
    throw new Error('不支持的 cmap 格式 ' + fmt);
  }

  /* ---------------- glyf 轮廓解码 ---------------- */

  /** 解码简单字形轮廓：返回 Array<Array<{x,y,on}>>（字体单位，y 向上） */
  function decodeSimple(u8, off, len) {
    const r = new R(u8, off, off + len);
    const nc = r.s16();
    r.skip(8); // bbox
    if (nc <= 0) return [];
    const endPts = [];
    for (let i = 0; i < nc; i++) endPts.push(r.u16());
    const nPts = endPts[nc - 1] + 1;
    const il = r.u16();
    r.skip(il); // instructions
    // flags
    const flags = new Array(nPts);
    for (let i = 0; i < nPts;) {
      const f = r.u8();
      flags[i++] = f;
      if (f & 0x08) { const rep = r.u8(); for (let k = 0; k < rep; k++) flags[i++] = f; }
    }
    // xs
    const xs = new Array(nPts);
    let x = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 0x02) x += (f & 0x10) ? r.u8() : -r.u8();
      else if (!(f & 0x10)) x += r.s16();
      xs[i] = x;
    }
    // ys
    const ys = new Array(nPts);
    let y = 0;
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 0x04) y += (f & 0x20) ? r.u8() : -r.u8();
      else if (!(f & 0x20)) y += r.s16();
      ys[i] = y;
    }
    // 切轮廓
    const contours = [];
    let s = 0;
    for (const e of endPts) {
      const c = [];
      for (let i = s; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 0x01) });
      contours.push(c);
      s = e + 1;
    }
    return contours;
  }

  /** 解析复合字形：返回 { components: [{gid, a,b,c,d, dx,dy}] } */
  function decodeComposite(u8, off, len) {
    const r = new R(u8, off, off + len);
    const nc = r.s16();
    r.skip(8);
    const comps = [];
    for (;;) {
      const flags = r.u16(), gid = r.u16();
      let a = 1, b = 0, c = 0, d = 1, dx = 0, dy = 0;
      if (flags & 0x0001) { dx = r.s16(); dy = r.s16(); }
      else { dx = r.u8() /* signed char */; if (dx > 127) dx -= 256; dy = r.u8(); if (dy > 127) dy -= 256; }
      if (flags & 0x0008) { a = d = r.f2(); }
      else if (flags & 0x0040) { a = r.f2(); d = r.f2(); }
      else if (flags & 0x0080) { a = r.f2(); b = r.f2(); c = r.f2(); d = r.f2(); }
      comps.push({ gid, a, b, c, d, dx, dy });
      if (!(flags & 0x0020)) break;
    }
    return { components: comps };
  }

  /* ---------------- 轮廓展开 + 栅格化 ---------------- */

  /** 二次曲线细分：p0 →(ctrl)→ p2 */
  function quadTo(segs, p0, ctrl, p2) {
    const dev = Math.abs(ctrl.x - (p0.x + p2.x) / 2) + Math.abs(ctrl.y - (p0.y + p2.y) / 2);
    const steps = Math.max(2, Math.min(24, Math.ceil(Math.sqrt(dev / 0.3))));
    let px = p0.x, py = p0.y;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, mt = 1 - t;
      const qx = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p2.x;
      const qy = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p2.y;
      segs.push([px, py, qx, qy]);
      px = qx; py = qy;
    }
  }

  /** 把 on/off 点列展开成折线段数组（含隐含中点、二次曲线细分） */
  function flattenContour(pts) {
    const n = pts.length;
    if (n < 2) return [];
    // 展开 off-off 隐含中点
    const ext = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      ext.push(a);
      if (!a.on && !b.on) {
        ext.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
      }
    }
    // 保证从 on 点起走（全 off 的退化轮廓直接放弃）
    let s0 = ext.findIndex(p => p.on);
    if (s0 === -1) return [];
    if (s0 > 0) ext.push(...ext.splice(0, s0));
    const m = ext.length;
    const segs = [];
    let i = 0;
    while (i < m) {
      const a = ext[i], b = ext[(i + 1) % m];
      if (a.on && b.on) {
        segs.push([a.x, a.y, b.x, b.y]);
        i++;
      } else {
        // a.on, b.off → 控制点 b，终点是 ext[i+2]（必为 on）
        quadTo(segs, a, b, ext[(i + 2) % m]);
        i += 2;
      }
    }
    return segs;
  }

  /** 轮廓数组（字体单位）→ 网格坐标折线 */
  function contoursToGrid(contours, scale, baselineRow) {
    const out = [];
    for (const c of contours) {
      const segs = flattenContour(c).map(s => [
        s[0] / scale, baselineRow - s[1] / scale,
        s[2] / scale, baselineRow - s[3] / scale,
      ]);
      if (segs.length) out.push(segs);
    }
    return out;
  }

  /** 非零环绕扫描线填充，3×3 超采样 → Uint8Array(w*h) */
  function rasterize(gridContours, w, h) {
    const bmp = new Uint8Array(w * h);
    const SUB = 3, SUB2 = SUB * SUB;
    const cross = [];
    for (let j = 0; j < h; j++) {
      const cov = new Float32Array(w);
      for (let s = 0; s < SUB; s++) {
        const y = j + (s + 0.5) / SUB;
        cross.length = 0;
        for (const segs of gridContours) {
          for (const sg of segs) {
            const x1 = sg[0], y1 = sg[1], x2 = sg[2], y2 = sg[3];
            if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
              const t = (y - y1) / (y2 - y1);
              cross.push([x1 + t * (x2 - x1), y2 > y1 ? 1 : -1]);
            }
          }
        }
        if (!cross.length) continue;
        cross.sort((a, b) => a[0] - b[0]);
        let acc = 0;
        for (let i = 0; i < cross.length - 1; i++) {
          acc += cross[i][1];
          if (acc === 0) continue;
          const xa = cross[i][0], xb = cross[i + 1][0];
          let c0 = Math.floor(xa), c1 = Math.ceil(xb);
          if (c1 <= 0 || c0 >= w) continue;
          c0 = Math.max(0, c0); c1 = Math.min(w, c1);
          for (let x = c0; x < c1; x++) {
            const a = Math.max(xa, x), b = Math.min(xb, x + 1);
            if (b > a) cov[x] += (b - a) / SUB;
          }
        }
      }
      for (let x = 0; x < w; x++) {
        if (cov[x] >= 0.45) bmp[j * w + x] = 1;   // cov ∈ [0,1]，≥0.45 视为实心
      }
    }
    return bmp;
  }

  /* ---------------- name 表 ---------------- */

  function parseName(u8, off) {
    const r = new R(u8, off);
    r.u16();
    const cnt = r.u16(), strOff = off + r.u16();
    const ids = {};
    for (let i = 0; i < cnt; i++) {
      const pid = r.u16(), eid = r.u16(), lid = r.u16(), nid = r.u16(), len = r.u16(), o = r.u16();
      if (nid in ids) continue;
      let val;
      if (pid === 3 || pid === 0) {
        // UTF-16BE
        let s = '';
        for (let k = 0; k < len; k += 2) {
          const ch = (u8[strOff + o + k] << 8) | u8[strOff + o + k + 1];
          if (ch) s += String.fromCharCode(ch);
        }
        val = s;
      } else {
        val = ascii(u8, strOff + o, len);
      }
      ids[nid] = val;
    }
    return {
      copyright: ids[0] || '', family: ids[1] || '', subfamily: ids[2] || '',
      fullName: ids[4] || '', version: ids[5] || '', psName: ids[6] || '',
      manufacturer: ids[8] || '', designer: ids[9] || '', license: ids[13] || '',
    };
  }

  /* ---------------- sfnt 主解析 ---------------- */

  async function parseSfnt(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const sig = dv.getUint32(0);
    let base = 0;
    if (sig === 0x74746366) { // 'ttcf'
      base = dv.getUint32(12);   // 取第一个字体
    }
    const isWoff = sig === 0x774F4646;
    const flavor = dv.getUint32(isWoff ? 4 : base);
    const isCFF = flavor === 0x4F54544F; // 'OTTO'
    const numTables = dv.getUint16(base + 4);
    const tables = {};
    for (let i = 0; i < numTables; i++) {
      const p = base + 12 + i * 16;
      const tag = ascii(u8, p, 4);
      tables[tag] = { off: dv.getUint32(p + 8), len: dv.getUint32(p + 12) };
    }

    const head = tables.head, glyf = tables.glyf, loca = tables.loca;
    if (!head) throw new Error('缺少 head 表，文件可能损坏');

    // WOFF 解包
    if (isWoff) {
      const dv0 = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      const n = dv0.getUint32(12);
      const out = {};
      const jobs = [];
      for (let i = 0; i < n; i++) {
        const p = 44 + i * 20;
        const tag = ascii(u8, p, 4);
        const toff = dv0.getUint32(p + 4), comp = dv0.getUint32(p + 8),
              orig = dv0.getUint32(p + 12);
        if (comp === orig || comp === 0) {
          out[tag] = u8.subarray(toff, toff + orig);
        } else {
          jobs.push(inflateZlib(u8.subarray(toff, toff + comp)).then(t => { out[tag] = t; }));
        }
      }
      await Promise.all(jobs);
      return buildFromTables(out, isCFF, 'woff');
    }
    if (isCFF) throw new Error('OTF/CFF 轮廓暂不支持，请导入 TrueType 字体（.ttf）');
    if (!glyf || !loca) throw new Error('这不是可解析的 TrueType 字体（缺 glyf/loca 表）');
    return await buildFromTables({
      head: u8.subarray(head.off, head.off + head.len),
      glyf: u8.subarray(glyf.off, glyf.off + glyf.len),
      loca: u8.subarray(loca.off, loca.off + loca.len),
      hhea: tables.hhea ? u8.subarray(tables.hhea.off, tables.hhea.off + tables.hhea.len) : null,
      hmtx: tables.hmtx ? u8.subarray(tables.hmtx.off, tables.hmtx.off + tables.hmtx.len) : null,
      cmap: tables.cmap ? u8.subarray(tables.cmap.off, tables.cmap.off + tables.cmap.len) : null,
      name: tables.name ? u8.subarray(tables.name.off, tables.name.off + tables.name.len) : null,
      maxp: tables.maxp ? u8.subarray(tables.maxp.off, tables.maxp.off + tables.maxp.len) : null,
    }, false, 'ttf');
  }

  async function buildFromTables(t, isCFF, kind) {
    if (isCFF) throw new Error('OTF/CFF 轮廓暂不支持，请导入 TrueType 字体（.ttf）');
    const hr = new R(t.head);
    hr.skip(18);
    const upm = hr.u16();
    hr.skip(30);   // created(8)+modified(8)+bbox(8)+macStyle(2)+lowestRecPPEM(2)+fontDirectionHint(2)
    const indexToLoc = hr.u16();

    let numGlyphs = 0;
    if (t.maxp) {
      const mr = new R(t.maxp);
      mr.u32();              // version 0.5/1.0 都是 4 字节
      numGlyphs = mr.u16();
    }

    // loca
    const loca = [];
    if (t.loca) {
      const lr = new R(t.loca);
      if (indexToLoc === 0) { while (!lr.eof() && loca.length <= numGlyphs) loca.push(lr.u16() * 2); }
      else { while (!lr.eof() && loca.length <= numGlyphs) loca.push(lr.u32()); }
    }

    // hhea + hmtx
    let nhm = numGlyphs, asc = Math.round(upm * 0.8), desc = -Math.round(upm * 0.2);
    if (t.hhea) {
      const r = new R(t.hhea);
      r.u32();                    // version
      asc = r.s16(); desc = r.s16();
      r.skip(26);                 // lineGap ~ metricDataFormat
      nhm = r.u16();
    }
    const advances = [];
    if (t.hmtx) {
      const r = new R(t.hmtx);
      for (let i = 0; i < Math.min(nhm, numGlyphs || nhm); i++) { advances.push(r.u16()); r.u16(); }
      while (advances.length < numGlyphs) advances.push(advances[advances.length - 1] || 0);
    }

    // cmap
    let chars = null;
    if (t.cmap) {
      const dv = new DataView(t.cmap.buffer, t.cmap.byteOffset, t.cmap.byteLength);
      const n = dv.getUint16(2);
      let best = null, bestScore = -1;
      for (let i = 0; i < n; i++) {
        const p = 4 + i * 8;
        const pid = dv.getUint16(p), eid = dv.getUint16(p + 2);
        const soff = dv.getUint32(p + 4);
        let score = 0;
        if (pid === 3 && eid === 10) score = 5;
        else if (pid === 0) score = 4;
        else if (pid === 3 && eid === 1) score = 3;
        else if (pid === 1) score = 1;
        if (score > bestScore) { bestScore = score; best = soff; }
      }
      if (best != null) {
        chars = parseCmapFormat(t.cmap, best);
      }
    }

    const name = t.name ? parseName(t.name, 0) : {};
    return { kind, upm, ascender: asc, descender: desc, numGlyphs, name, chars: chars || new Map(), advances, loca, glyf: t.glyf };
  }

  /* ---------------- 复合字形展开 ---------------- */

  /** 取某 GID 的最终轮廓（展开复合字形），depth 防爆栈 */
  function glyphContours(font, gid, depth) {
    depth = depth || 0;
    const { loca, glyf } = font;
    if (gid >= loca.length - 1 || depth > 8) return [];
    const off = loca[gid], len = loca[gid + 1] - off;
    if (len <= 0) return [];
    const dv = new DataView(glyf.buffer, glyf.byteOffset + off, len);
    const nc = dv.getInt16(0);
    if (nc >= 0) return decodeSimple(glyf, off, len);
    const comp = decodeComposite(glyf, off, len);
    const out = [];
    for (const cp of comp.components) {
      const sub = glyphContours(font, cp.gid, depth + 1);
      for (const c of sub) {
        out.push(c.map(p => ({
          x: cp.a * p.x + cp.b * p.y + cp.dx,
          y: cp.c * p.x + cp.d * p.y + cp.dy,
          on: p.on,
        })));
      }
    }
    return out;
  }

  /* ---------------- 对外主入口 ---------------- */

  /**
   * 解析字体文件（TTF/WOFF/BDF），返回统一结构。
   * TTF/WOFF: { kind:'sfnt', upm, name, chars: Map(code→gid), getContours(gid), advances }
   * BDF:      { kind:'bdf', chars: Map(code→{rows,w,h,xoff,yoff,dw}), name }
   */
  async function parse(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const sig = dv.getUint32(0);

    // BDF 是文本
    if (u8[0] === 0x53 && u8[1] === 0x54) { // 'ST'
      const text = new TextDecoder('utf-8').decode(u8);
      if (/^STARTFONT/m.test(text)) return parseBDF(text);
    }
    // 也可能带 BOM/前导空白
    const head = ascii(u8, 0, 16);
    if (/^\uFEFF?\s*STARTFONT/.test(head)) return parseBDF(new TextDecoder('utf-8').decode(u8));

    if (sig === 0x774F4646 || sig === 0x00010000 || sig === 0x74727565 || sig === 0x74746366) {
      const font = await parseSfnt(u8);
      return {
        kind: 'sfnt', upm: font.upm, name: font.name, chars: font.chars,
        ascender: font.ascender, descender: font.descender,
        numGlyphs: font.numGlyphs,
        advanceOf(gid) { return font.advances[gid] || 0; },
        getContours(gid) { return glyphContours(font, gid); },
      };
    }
    if (sig === 0x4F54544F) throw new Error('OTF/CFF 轮廓暂不支持，请导入 TrueType 字体（.ttf）');
    if (sig === 0x774F4632) throw new Error('WOFF2 暂不支持，请先用工具转成 TTF 或 WOFF');
    throw new Error('无法识别的字体文件格式');
  }

  /* ---------------- BDF ---------------- */

  function parseBDF(text) {
    const chars = new Map();
    const lines = text.split(/\r?\n/);
    let name = '', upix = 16;
    for (const ln of lines) {
      const m = ln.match(/^FONT\s+(.+)/); if (m) name = m[1].trim();
      const s = ln.match(/^SIZE\s+(\d+)/); if (s) upix = +s[1];
    }
    let cur = null;
    const done = [];
    const readHex = row => {
      const out = [];
      for (let i = 0; i < row.length; i += 2) out.push(parseInt(row.substr(i, 2), 16));
      return out;
    };
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (/^STARTCHAR/.test(ln)) cur = { rows: [] };
      else if (/^ENCODING\s+(0x)?(-?\d+)/.test(ln)) {
        const m = ln.match(/^ENCODING\s+(0x)?(-?\d+)/);
        cur.enc = m[1] ? parseInt(m[2], 16) : parseInt(m[2], 10);
      } else if (/^BBX\s/.test(ln)) {
        const p = ln.split(/\s+/);
        cur.bw = +p[1]; cur.bh = +p[2]; cur.bx = +p[3]; cur.by = +p[4];
      } else if (/^DWIDTH\s/.test(ln)) {
        cur.dw = +ln.split(/\s+/)[1];
      } else if (/^BITMAP/.test(ln)) {
        const rb = Math.ceil(cur.bw / 8);
        for (let r = 0; r < cur.bh; r++) {
          const bytes = readHex(lines[++i].trim());
          const bits = [];
          for (let b = 0; b < cur.bw; b++) {
            bits.push((bytes[(b / 8) | 0] >> (7 - (b & 7))) & 1);
          }
          cur.rows.push(bits);
        }
        done.push(cur); cur = null;
      }
    }
    for (const c of done) {
      if (c.enc >= 0) chars.set(c.enc, {
        rows: c.rows, w: c.bw, h: c.bh, xoff: c.bx, yoff: c.by,
        dw: c.dw != null ? c.dw : c.bw,
      });
    }
    return { kind: 'bdf', name: { family: name || 'BDF', subfamily: 'Regular' }, pixelSize: upix, chars };
  }

  /** BDF 字符 → 网格位图 */
  function bdfToGrid(ch, gridW, gridH, baselineRow) {
    const bmp = new Uint8Array(gridW * gridH);
    const top = baselineRow - ch.yoff - ch.h;   // 位图顶行所在网格行
    for (let r = 0; r < ch.h; r++) {
      const gy = top + r;
      if (gy < 0 || gy >= gridH) continue;
      for (let x = 0; x < ch.w; x++) {
        const gx = ch.xoff + x;
        if (gx >= 0 && gx < gridW && ch.rows[r][x]) bmp[gy * gridW + gx] = 1;
      }
    }
    return bmp;
  }

  /* ---------------- 栅格化对外接口 ---------------- */

  /**
   * sfnt 字形 → 网格位图
   * font: parse() 返回的 sfnt 结构；code: 码位
   */
  function gridFromSfnt(font, code, gridW, gridH, baselineRow) {
    const gid = font.chars.get(code);
    if (gid == null) return null;
    const scale = font.upm / gridH;
    const contours = font.getContours(gid);
    if (!contours.length) return { bmp: new Uint8Array(gridW * gridH), advance: font.advanceOf(gid) / scale };
    const segs = contoursToGrid(contours, scale, baselineRow);
    return { bmp: rasterize(segs, gridW, gridH), advance: font.advanceOf(gid) / scale };
  }

  return { parse, gridFromSfnt, bdfToGrid, rasterize, contoursToGrid };
})();
