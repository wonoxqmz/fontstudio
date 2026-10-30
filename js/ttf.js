/* ============================================================================
 * ttf.js — 纯 JS 的 TrueType (sfnt) 字体生成器
 * ---------------------------------------------------------------------------
 * 从轮廓数据直接构造二进制 TTF 文件，不依赖任何第三方库。
 * 生成的表：head / hhea / hmtx / maxp / cmap(4+12) / glyf / loca / name /
 *           OS/2 / post
 *
 * 轮廓约定（TrueType / 非零环绕规则）：
 *   · 外轮廓顺时针（字体坐标 y 向上时，有符号面积为负）
 *   · 内孔逆时针（面积为正）
 *   点的 on=false 表示二次贝塞尔控制点。
 * ==========================================================================*/
(function (global) {
  'use strict';

  const UPM_DEFAULT = 1000;

  /* ------------------------------------------------------------ 字节写入器 */

  class W {
    constructor() { this.b = []; }
    get length() { return this.b.length; }
    u8(v) { this.b.push(v & 0xff); return this; }
    u16(v) { this.b.push((v >> 8) & 0xff, v & 0xff); return this; }
    s16(v) { v = Math.round(v); this.u16(v < 0 ? v + 0x10000 : v); return this; }
    u32(v) { this.b.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); return this; }
    s32(v) { this.u32(v < 0 ? v + 0x100000000 : v); return this; }
    i64(v) {
      const hi = Math.floor(v / 4294967296);
      const lo = v - hi * 4294967296;
      this.u32(hi >>> 0).u32(lo >>> 0);
      return this;
    }
    tag(s) {
      for (let i = 0; i < 4; i++) this.u8(i < s.length ? s.charCodeAt(i) : 0x20);
      return this;
    }
    bytes(arr) { for (const x of arr) this.u8(x); return this; }
    pad4() { while (this.b.length % 4) this.b.push(0); return this; }
    out() { return new Uint8Array(this.b); }
  }

  /** 计算 4 字节对齐的校验和 */
  function checksum(bytes) {
    let sum = 0;
    const n = bytes.length;
    for (let i = 0; i < n; i += 4) {
      const b0 = bytes[i] || 0, b1 = bytes[i + 1] || 0, b2 = bytes[i + 2] || 0, b3 = bytes[i + 3] || 0;
      sum = (sum + ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3)) >>> 0;
    }
    return sum >>> 0;
  }

  /* ------------------------------------------------------------- 轮廓规范化 */

  /**
   * 把 {x,y,on} 点列表规范化成 TrueType 友好的顺序：
   * 保证第一个点是 on-curve；连续 off-curve 之间补隐式中点。
   */
  function normalizeContour(pts) {
    let p = pts.slice();
    // 去掉重复的连续点
    const q = [];
    for (const c of p) {
      const prev = q[q.length - 1];
      if (prev && prev.on === c.on && Math.abs(prev.x - c.x) < 1e-6 && Math.abs(prev.y - c.y) < 1e-6) continue;
      q.push({ x: c.x, y: c.y, on: c.on });
    }
    p = q;
    if (p.length < 2) return null;

    // 旋转到第一个点是 on-curve
    let start = p.findIndex(c => c.on);
    if (start < 0) {
      // 全 off-curve：插入一个中点作为起点
      const a = p[0], b = p[1] || p[0];
      p.unshift({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
      start = 0;
    }
    if (start > 0) p = p.slice(start).concat(p.slice(0, start));

    // 两个连续 off-curve 之间补中点
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const cur = p[i];
      const next = p[(i + 1) % p.length];
      out.push(cur);
      if (!cur.on && !next.on) {
        out.push({ x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2, on: true });
      }
    }
    // 去掉首尾重复
    if (out.length > 1) {
      const a = out[0], b = out[out.length - 1];
      if (a.on && b.on && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) out.pop();
    }
    return out.length >= 3 ? out : null;
  }

  /* ---------------------------------------------------------------- glyf 表 */

  /** 编码单个简单字形 */
  function encodeGlyph(contours) {
    // contours: Array<Array<{x,y,on}>>，已按 UPM 缩放并取整
    const cs = [];
    for (const c of contours) {
      const n = normalizeContour(c);
      if (n) cs.push(n);
    }

    if (cs.length === 0) {
      // 空字形
      const w = new W();
      w.s16(0).s16(0).s16(0).s16(0).s16(0);
      return w.out();
    }

    // 收集所有点
    const allPts = [];
    const ends = [];
    for (const c of cs) {
      for (const p of c) allPts.push(p);
      ends.push(allPts.length - 1);
    }

    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    for (const p of allPts) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }

    const w = new W();
    w.s16(cs.length);
    w.s16(xMin).s16(yMin).s16(xMax).s16(yMax);
    for (const e of ends) w.u16(e);
    w.u16(0); // instructionLength

    // ---- flags + 坐标差值 ----
    const flags = [];
    const dxs = [], dys = [];
    let px = 0, py = 0;
    for (const p of allPts) {
      const X = Math.round(p.x), Y = Math.round(p.y);
      const dx = X - px, dy = Y - py;
      px = X; py = Y;
      dxs.push(dx); dys.push(dy);

      let f = p.on ? 0x01 : 0x00;
      if (dx === 0) f |= 0x10;                        // 与上一点相同，不写数据
      else if (dx >= -255 && dx <= 255) {             // 1 字节
        f |= 0x02;
        if (dx > 0) f |= 0x10;
      }
      if (dy === 0) f |= 0x20;
      else if (dy >= -255 && dy <= 255) {
        f |= 0x04;
        if (dy > 0) f |= 0x20;
      }
      flags.push(f);
    }

    // ---- flags 写盘（含 repeat 压缩） ----
    for (let i = 0; i < flags.length;) {
      let j = i + 1;
      while (j < flags.length && flags[j] === flags[i] && j - i < 256) j++;
      const run = j - i;
      if (run > 1) {
        w.u8(flags[i] | 0x08);
        w.u8(run - 1);
      } else {
        w.u8(flags[i]);
      }
      i = j;
    }

    // ---- x 坐标 ----
    for (let i = 0; i < flags.length; i++) writeCoord(w, flags[i], dxs[i], 0x02, 0x10);
    // ---- y 坐标 ----
    for (let i = 0; i < flags.length; i++) writeCoord(w, flags[i], dys[i], 0x04, 0x20);

    return w.out();
  }

  function writeCoord(w, f, d, shortBit, signBit) {
    if (f & shortBit) w.u8(Math.abs(d));
    else if (!(f & signBit)) w.s16(d);
  }

  /* ------------------------------------------------------------------ 主类 */

  class FontBuilder {
    /**
     * @param {object} meta 字体元信息
     */
    constructor(meta) {
      meta = meta || {};
      this.meta = {
        familyName: meta.familyName || 'MyFont',
        styleName: meta.styleName || 'Regular',
        version: meta.version || 'Version 1.000',
        copyright: meta.copyright || '',
        designer: meta.designer || '',
        license: meta.license || '',
        designerURL: meta.designerURL || '',
        manufacturer: meta.manufacturer || '',
        vendorID: (meta.vendorID || 'NONE').slice(0, 4).padEnd(4, ' '),
        weightClass: meta.weightClass == null ? 400 : meta.weightClass,
        italic: !!meta.italic,
        bold: !!meta.bold,
        monospace: !!meta.monospace,
        underlinePosition: meta.underlinePosition,
        underlineThickness: meta.underlineThickness,
      };
      this.upm = meta.upm || UPM_DEFAULT;
      this.ascender = meta.ascender == null ? Math.round(this.upm * 0.88) : meta.ascender;
      this.descender = meta.descender == null ? -Math.round(this.upm * 0.12) : meta.descender;
      this.lineGap = meta.lineGap || 0;
      // 字形表：gid -> {code, contours, advance}
      this.glyphs = [];
      this.notdef = null;
      this.emSquare = null;
      this.useEmSquare = meta.useEmSquare !== false;
    }

    /**
     * 设置 .notdef 字形（缺字时显示）
     */
    setNotdef(contours, advance) {
      this.notdef = { contours, advance };
      return this;
    }

    /** 加一个字形 */
    addGlyph(code, contours, advance) {
      this.glyphs.push({ code, contours, advance: advance == null ? null : advance });
      return this;
    }

    /** 内部实现：构建所有表并组装 sfnt */
    __build() {
      const upm = this.upm;
      const glyphList = [];

      // gid 0 = .notdef
      const notdefAdv = (this.notdef && this.notdef.advance != null)
        ? this.notdef.advance : (this.emSquare || upm);
      glyphList.push({
        code: null,
        contours: (this.notdef && this.notdef.contours) || defaultNotdef(upm),
        advance: notdefAdv,
      });

      // 按码位排序，保证 cmap 有序
      // 注意：此处传入的轮廓坐标已经是「字体单位」（由调用方按 UPM 缩放完成）
      const sorted = this.glyphs.slice().sort((a, b) => a.code - b.code);
      for (const g of sorted) {
        glyphList.push({
          code: g.code,
          contours: g.contours.map(c => c.map(p => ({
            x: p.x, y: p.y, on: p.on !== false,
          }))),
          advance: g.advance == null ? (this.emSquare || upm) : g.advance,
        });
      }

      // ---- glyf + loca ----
      const glyfW = new W();
      const loca = [];
      const bounds = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
      let maxPoints = 0, maxContours = 0;

      for (const g of glyphList) {
        loca.push(glyfW.length);
        const data = encodeGlyph(g.contours);
        glyfW.bytes(data);
        glyfW.pad4();

        let np = 0, nc = 0;
        for (const c of g.contours) {
          const n = normalizeContour(c);
          if (n) { np += n.length; nc++; }
        }
        if (np > maxPoints) maxPoints = np;
        if (nc > maxContours) maxContours = nc;

        for (const c of g.contours) {
          for (const p of c) {
            const X = Math.round(p.x), Y = Math.round(p.y);
            if (X < bounds.xMin) bounds.xMin = X;
            if (X > bounds.xMax) bounds.xMax = X;
            if (Y < bounds.yMin) bounds.yMin = Y;
            if (Y > bounds.yMax) bounds.yMax = Y;
          }
        }
      }
      loca.push(glyfW.length);
      const glyf = glyfW.out();

      if (!isFinite(bounds.xMin)) {
        bounds.xMin = 0; bounds.yMin = this.descender;
        bounds.xMax = upm; bounds.yMax = this.ascender;
      }
      if (maxContours > 0xffff) maxContours = 0xffff;
      if (maxPoints > 0xffff) maxPoints = 0xffff;

      const numGlyphs = glyphList.length;

      // ---- loca（一律用 long 格式，稳妥） ----
      const locaW = new W();
      for (const off of loca) locaW.u32(off);
      const locaBytes = locaW.out();

      // ---- hmtx ----
      const hmtxW = new W();
      let advMax = 0, minLsb = Infinity, minRsb = Infinity, xMaxExtent = -Infinity;
      for (const g of glyphList) {
        let gxMin = 0, gxMax = 0;
        let any = false;
        for (const c of g.contours) {
          for (const p of c) {
            const X = Math.round(p.x);
            if (!any) { gxMin = gxMax = X; any = true; }
            else { if (X < gxMin) gxMin = X; if (X > gxMax) gxMax = X; }
          }
        }
        const adv = g.advance;
        const lsb = any ? gxMin : 0;
        const rsb = adv - (any ? gxMax : 0);
        hmtxW.u16(adv).s16(lsb);
        if (adv > advMax) advMax = adv;
        if (lsb < minLsb) minLsb = lsb;
        if (rsb < minRsb) minRsb = rsb;
        if ((any ? gxMax : 0) > xMaxExtent) xMaxExtent = (any ? gxMax : 0);
      }
      if (!isFinite(minLsb)) minLsb = 0;
      if (!isFinite(minRsb)) minRsb = 0;
      if (!isFinite(xMaxExtent)) xMaxExtent = 0;
      const hmtx = hmtxW.out();

      // ---- maxp ----
      // maxp version 1.0 固定 32 字节：4 + 14 个 uint16
      const maxpW = new W();
      maxpW.u32(0x00010000);
      maxpW.u16(numGlyphs);   // numGlyphs
      maxpW.u16(maxPoints);   // maxPoints
      maxpW.u16(maxContours); // maxContours
      maxpW.u16(0);           // maxCompositePoints
      maxpW.u16(0);           // maxCompositeContours
      maxpW.u16(2);           // maxZones
      maxpW.u16(0);           // maxTwilightPoints
      maxpW.u16(0);           // maxStorage
      maxpW.u16(0);           // maxFunctionDefs
      maxpW.u16(0);           // maxInstructionDefs
      maxpW.u16(0);           // maxStackElements
      maxpW.u16(0);           // maxSizeOfInstructions
      maxpW.u16(0);           // maxComponentElements
      maxpW.u16(0);           // maxComponentDepth
      const maxp = maxpW.out();

      // ---- head ----
      const headW = new W();
      headW.u32(0x00010000);        // version
      headW.u32(0x00010000);        // fontRevision
      headW.u32(0);                 // checkSumAdjustment（稍后回填）
      headW.u32(0x5f0f3cf5);        // magicNumber
      headW.u16(0x000b);            // flags
      headW.u16(upm);
      headW.i64(macEpochNow());     // created
      headW.i64(macEpochNow());     // modified
      headW.s16(bounds.xMin).s16(bounds.yMin).s16(bounds.xMax).s16(bounds.yMax);
      headW.u16(this.meta.bold ? 0x20 : 0);   // macStyle
      headW.u16(8);                 // lowestRecPPEM
      headW.s16(2);                 // fontDirectionHint
      headW.s16(1);                 // indexToLocFormat = long
      headW.s16(0);                 // glyphDataFormat
      const head = headW.out();

      // ---- hhea ----
      const xAvg = Math.round(glyphList.reduce((s, g) => s + g.advance, 0) / glyphList.length);
      const hheaW = new W();
      hheaW.u32(0x00010000);
      hheaW.s16(this.ascender).s16(this.descender).s16(this.lineGap);
      hheaW.u16(advMax);
      hheaW.s16(minLsb).s16(minRsb).s16(xMaxExtent);
      hheaW.s16(1).s16(0).s16(0);   // caretSlopeRise/Run/Offset
      hheaW.s16(0).s16(0).s16(0).s16(0);
      hheaW.s16(0);                 // metricDataFormat
      hheaW.u16(numGlyphs);         // numberOfHMetrics（全部字宽都写）
      const hhea = hheaW.out();

      // ---- cmap ----
      const cmap = buildCmap(glyphList);

      // ---- name ----
      const name = buildName(this.meta);

      // ---- OS/2 ----
      const os2 = buildOS2({
        glyphs: glyphList,
        upm,
        ascender: this.ascender,
        descender: this.descender,
        lineGap: this.lineGap,
        xAvg,
        meta: this.meta,
        bounds,
      });

      // ---- post ----
      const postW = new W();
      postW.u32(0x00030000);
      postW.u32(0);                 // italicAngle
      postW.s16(this.meta.underlinePosition == null ? Math.round(-this.descender * 0.25) : this.meta.underlinePosition);
      postW.s16(this.meta.underlineThickness == null ? Math.max(1, Math.round(upm / 20)) : this.meta.underlineThickness);
      postW.u32(this.meta.monospace ? 1 : 0);
      postW.u32(0).u32(0).u32(0).u32(0);
      const post = postW.out();

      // ---- 组装 ----
      const tables = [
        { tag: 'OS/2', data: os2 },
        { tag: 'cmap', data: cmap },
        { tag: 'glyf', data: glyf },
        { tag: 'head', data: head },
        { tag: 'hhea', data: hhea },
        { tag: 'hmtx', data: hmtx },
        { tag: 'loca', data: locaBytes },
        { tag: 'maxp', data: maxp },
        { tag: 'name', data: name },
        { tag: 'post', data: post },
      ];
      return assemble(tables, head);
    }

    /** 只要 sfnt 二进制（TrueType） */
    build() {
      return this._buildParts().file;
    }

    /**
     * 构建 WOFF（Web Open Font Format 1.0）
     * 每个表单独 zlib 压缩；环境不支持压缩时退化为原样存储（规范允许）。
     * @returns {Promise<Uint8Array>}
     */
    async buildWOFF() {
      const parts = this._buildParts();
      const tables = parts.tables.slice().sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

      const packed = [];
      for (const t of tables) {
        const comp = await zlibCompress(t.data);
        // 压缩后反而更大就存原样
        if (comp && comp.length < t.data.length) {
          packed.push({ tag: t.tag, data: comp, orig: t.data, origLength: t.data.length });
        } else {
          packed.push({ tag: t.tag, data: t.data, orig: t.data, origLength: t.data.length });
        }
      }

      const numTables = packed.length;
      const headerLen = 44 + numTables * 20;
      let totalSfnt = 12 + numTables * 16;
      for (const t of packed) totalSfnt += (t.origLength + 3) & ~3;

      const w = new W();
      w.u32(0x774f4646);             // signature 'wOFF'
      w.u32(parts.flavor);           // flavor
      let totalLen = headerLen;
      for (const t of packed) totalLen += (t.data.length + 3) & ~3;
      w.u32(totalLen);
      w.u16(numTables);
      w.u16(0);                      // reserved
      w.u32(totalSfnt);
      w.u16(1).u16(0);               // majorVersion / minorVersion
      w.u32(0).u32(0).u32(0);        // metaOffset/metaLength/metaOrigLength
      w.u32(0).u32(0);               // privOffset/privLength

      let off = headerLen;
      const offsets = [];
      for (const t of packed) {
        offsets.push(off);
        off += (t.data.length + 3) & ~3;
      }

      for (let i = 0; i < numTables; i++) {
        const t = packed[i];
        w.tag(t.tag);
        w.u32(offsets[i]);
        w.u32(t.data.length);        // compLength
        w.u32(t.origLength);
        w.u32(checksum(t.orig));
      }
      for (let i = 0; i < numTables; i++) {
        while (w.length < offsets[i]) w.u8(0);
        w.bytes(packed[i].data);
        w.pad4();
      }
      return w.out();
    }

    /** 内部：构建所有表并组装 sfnt */
    _buildParts() {
      return this.__build();
    }
  }

  /* ------------------------------------------------------------------ 组装 */

  function assemble(tables, headBytes) {
    tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

    const numTables = tables.length;
    let searchRange = 1, entrySelector = 0;
    while (searchRange * 2 <= numTables) { searchRange *= 2; entrySelector++; }
    searchRange *= 16;
    const rangeShift = numTables * 16 - searchRange;

    const headerLen = 12 + numTables * 16;
    const out = new W();
    out.u32(0x00010000);
    out.u16(numTables);
    out.u16(searchRange);
    out.u16(entrySelector);
    out.u16(rangeShift);

    // 先算偏移
    let offset = headerLen;
    const entries = [];
    for (const t of tables) {
      const len = t.data.length;
      entries.push({ tag: t.tag, data: t.data, offset, length: len });
      offset += (len + 3) & ~3;
    }

    for (const e of entries) {
      out.tag(e.tag);
      out.u32(checksum(e.data));
      out.u32(e.offset);
      out.u32(e.length);
    }

    for (const e of entries) {
      while (out.length < e.offset) out.u8(0);
      out.bytes(e.data);
      out.pad4();
    }

    const file = out.out();

    // 回填 head.checkSumAdjustment
    const headEntry = entries.find(e => e.tag === 'head');
    if (headEntry) {
      const fileSum = checksum(file);
      const adj = (0xb1b0afba - fileSum) >>> 0;
      const ho = headEntry.offset;
      file[ho + 8] = (adj >>> 24) & 0xff;
      file[ho + 9] = (adj >>> 16) & 0xff;
      file[ho + 10] = (adj >>> 8) & 0xff;
      file[ho + 11] = adj & 0xff;
    }
    void headBytes;
    return { file, tables: entries, flavor: 0x00010000 };
  }

  function macEpochNow() {
    // 1904-01-01 → 1970-01-01 相差 2082844800 秒
    return Math.floor(Date.now() / 1000) + 2082844800;
  }

  function defaultNotdef(upm) {
    const m = Math.round(upm * 0.05);
    const s = Math.round(upm * 0.42);
    // 外框：顺时针（负面积）
    const outer = [
      { x: m, y: m, on: true }, { x: m, y: upm - m, on: true },
      { x: upm - m, y: upm - m, on: true }, { x: upm - m, y: m, on: true },
    ];
    // 内框：逆时针（正面积）= 挖空
    const inner = [
      { x: m + s, y: m + s, on: true }, { x: upm - m - s, y: m + s, on: true },
      { x: upm - m - s, y: upm - m - s, on: true }, { x: m + s, y: upm - m - s, on: true },
    ];
    return [outer, inner];
  }

  /* ------------------------------------------------------------------ cmap */

  function buildCmap(glyphList) {
    // code -> gid
    const map = [];
    for (let i = 0; i < glyphList.length; i++) {
      if (glyphList[i].code != null) map.push([glyphList[i].code, i]);
    }
    map.sort((a, b) => a[0] - b[0]);

    const bmp = map.filter(([c]) => c <= 0xffff);
    const fmt4 = buildFormat4(bmp, map);
    const fmt12 = buildFormat12(map);

    const hasNonBMP = map.some(([c]) => c > 0xffff);

    // 子表：尽可能复用同一份数据
    const subtables = [
      { platformID: 3, encodingID: 1, data: fmt4 },        // Windows BMP
      { platformID: 0, encodingID: 3, data: fmt4 },        // Unicode BMP
    ];
    if (hasNonBMP) {
      subtables.push({ platformID: 3, encodingID: 10, data: fmt12 }); // Windows UCS-4
      subtables.push({ platformID: 0, encodingID: 4, data: fmt12 });  // Unicode full
    }

    // 去重相同数据
    const unique = [];
    for (const st of subtables) {
      if (!unique.some(u => u.data === st.data)) unique.push({ data: st.data, refs: [] });
      unique.find(u => u.data === st.data).refs.push(st);
    }

    const w = new W();
    w.u16(0);                       // version
    w.u16(subtables.length);        // numTables

    let offset = 4 + subtables.length * 8;
    const encRecords = [];
    const dataOffsets = new Map();
    for (const st of subtables) {
      if (!dataOffsets.has(st.data)) {
        dataOffsets.set(st.data, offset);
        offset += st.data.length;
        offset = (offset + 3) & ~3;
      }
      encRecords.push({ platformID: st.platformID, encodingID: st.encodingID, off: dataOffsets.get(st.data) });
    }

    for (const r of encRecords) {
      w.u16(r.platformID).u16(r.encodingID).u32(r.off);
    }
    for (const [data, off] of dataOffsets) {
      while (w.length < off) w.u8(0);
      w.bytes(data);
      while (w.length % 4) w.u8(0);
    }
    return w.out();
  }

  function buildFormat4(bmpMap, allMap) {
    // 段：连续码位且 gid 连续 → 合并
    const segs = [];
    if (bmpMap.length === 0) {
      segs.push({ start: 0xffff, end: 0xffff, delta: 1, ro: 0, glyphs: [] });
    } else {
      let s = bmpMap[0][0], e = bmpMap[0][0], g0 = bmpMap[0][1];
      for (let i = 1; i <= bmpMap.length; i++) {
        const cur = bmpMap[i];
        const cont = cur && cur[0] === e + 1 && cur[1] === g0 + (e + 1 - s);
        if (cont) { e = cur[0]; continue; }
        segs.push({ start: s, end: e, delta: (g0 - s) & 0xffff, ro: 0, glyphs: [] });
        if (cur) { s = cur[0]; e = cur[0]; g0 = cur[1]; }
      }
    }
    // 结尾哨兵段
    const last = segs[segs.length - 1];
    if (last.end !== 0xffff) {
      segs.push({ start: 0xffff, end: 0xffff, delta: 1, ro: 0, glyphs: [] });
    }

    const segCount = segs.length;
    let searchRange = 1, entrySelector = 0;
    while (searchRange * 2 <= segCount) { searchRange *= 2; entrySelector++; }
    searchRange *= 2;
    const rangeShift = segCount * 2 - searchRange;

    const length = 16 + segCount * 8;
    const w = new W();
    w.u16(4).u16(length).u16(0);
    w.u16(segCount * 2).u16(searchRange).u16(entrySelector).u16(rangeShift);
    for (const s of segs) w.u16(s.end);
    w.u16(0);
    for (const s of segs) w.u16(s.start);
    for (const s of segs) w.s16(s.delta);
    for (const s of segs) w.u16(s.ro);
    void allMap;
    return w.out();
  }

  function buildFormat12(map) {
    const groups = [];
    if (map.length) {
      let s = map[0][0], e = map[0][0], g0 = map[0][1];
      for (let i = 1; i <= map.length; i++) {
        const cur = map[i];
        if (cur && cur[0] === e + 1 && cur[1] === g0 + (e + 1 - s)) { e = cur[0]; continue; }
        groups.push({ s, e, g: g0 });
        if (cur) { s = cur[0]; e = cur[0]; g0 = cur[1]; }
      }
    }
    const w = new W();
    w.u16(12).u16(0);
    w.u32(16 + groups.length * 12);
    w.u32(0);
    w.u32(groups.length);
    for (const g of groups) w.u32(g.s).u32(g.e).u32(g.g);
    return w.out();
  }

  /* ------------------------------------------------------------------ name */

  /**
   * 生成合法的 PostScript 名（只能含 ASCII 字母数字和连字符）。
   * 中文家族名清理后为空时，用码位哈希生成稳定的回退名。
   */
  function makePSName(family, style) {
    let s = (String(family || '') + '-' + String(style || ''))
      .replace(/[^A-Za-z0-9\-]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!/[A-Za-z0-9]/.test(s)) {
      let h = 0;
      const src = String(family || '') + String(style || '');
      for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) >>> 0;
      s = 'Font' + (h % 1000000).toString(36).toUpperCase();
    }
    return s.slice(0, 63);
  }

  function buildName(meta) {
    const psName = makePSName(meta.familyName, meta.styleName);

    const items = [
      [0, meta.copyright || ''],
      [1, meta.familyName],
      [2, meta.styleName],
      [3, psName + ':' + (meta.version || '1.000')],
      [4, meta.familyName + ' ' + meta.styleName],
      [5, meta.version || 'Version 1.000'],
      [6, psName],
      [8, meta.manufacturer || ''],
      [9, meta.designer || ''],
      [11, meta.designerURL || ''],
      [12, meta.designerURL || ''],
      [13, meta.license || ''],
    ].filter(([, v]) => v);

    // 记录：[platformID, encodingID, languageID, nameID, bytes]
    const records = [];
    for (const [id, val] of items) {
      // Windows / UTF-16BE：支持任意 Unicode（含中文）
      records.push({ p: 3, e: 1, l: 0x0409, id, bytes: utf16be(val) });
      // Mac / ASCII：仅纯 ASCII 字符串才写，否则会变问号乱码
      if (/^[\x20-\x7E]*$/.test(val)) {
        records.push({ p: 1, e: 0, l: 0, id, bytes: asciiBytes(val) });
      }
    }
    records.sort((a, b) =>
      a.p - b.p || a.e - b.e || a.l - b.l || a.id - b.id);

    const w = new W();
    w.u16(0);
    w.u16(records.length);
    const strOffset = 6 + records.length * 12;
    w.u16(strOffset);

    let cur = 0;
    for (const r of records) {
      w.u16(r.p).u16(r.e).u16(r.l).u16(r.id);
      w.u16(r.bytes.length).u16(cur);
      cur += r.bytes.length;
    }
    for (const r of records) w.bytes(r.bytes);
    return w.out();
  }

  function utf16be(s) {
    const a = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a.push((c >> 8) & 0xff, c & 0xff);
    }
    return a;
  }

  function asciiBytes(s) {
    const a = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a.push(c < 128 ? c : 0x3f);
    }
    return a;
  }

  /* ------------------------------------------------------------------ OS/2 */

  function buildOS2(o) {
    const { glyphs, upm, ascender, descender, lineGap, xAvg, meta, bounds } = o;

    let firstChar = 0xffff, lastChar = 0;
    for (const g of glyphs) {
      if (g.code == null) continue;
      if (g.code < firstChar) firstChar = g.code;
      if (g.code > lastChar) lastChar = g.code;
    }
    if (firstChar > lastChar) { firstChar = 0; lastChar = 0; }

    const w = new W();
    w.u16(4);                     // version
    w.s16(Math.max(1, xAvg));     // xAvgCharWidth
    w.u16(meta.weightClass);      // usWeightClass
    w.u16(5);                     // usWidthClass = Medium
    w.u16(0);                     // fsType = installable

    // 下标/上标/删除线尺寸（按 UPM 比例给个合理值）
    w.s16(Math.round(upm * 0.65)).s16(Math.round(upm * 0.6));
    w.s16(0).s16(Math.round(upm * 0.075));
    w.s16(Math.round(upm * 0.65)).s16(Math.round(upm * 0.6));
    w.s16(0).s16(Math.round(upm * 0.35));
    w.s16(Math.max(1, Math.round(upm * 0.05))).s16(Math.round(upm * 0.25));
    w.s16(0);                     // sFamilyClass

    // PANOSE
    const panose = meta.monospace
      ? [2, 11, 5, 9, 2, 2, 3, 2, 2, 7]
      : [2, 11, 5, 3, 2, 2, 3, 2, 2, 4];
    w.bytes(panose);

    // ulUnicodeRange1..4（各 32 位）
    const ur = unicodeRanges(glyphs);
    w.u32(ur[0]).u32(ur[1]).u32(ur[2]).u32(ur[3]);

    // achVendID
    w.tag(meta.vendorID);

    // fsSelection
    let fsSel = 0x0040;  // REGULAR
    if (meta.italic) fsSel = (fsSel & ~0x0040) | 0x0001;
    if (meta.bold) fsSel = (fsSel & ~0x0040) | 0x0020;
    if (meta.monospace) fsSel |= 0x0000;
    w.u16(fsSel);

    // usFirstCharIndex / usLastCharIndex 是 uint16，非 BMP 码位必须夹紧
    w.u16(Math.min(firstChar, 0xffff));
    w.u16(Math.min(lastChar, 0xffff));
    w.s16(ascender);
    w.s16(descender);
    w.s16(lineGap);
    w.u16(Math.max(0, ascender + lineGap));
    w.u16(Math.max(1, -descender));

    // CodePageRange
    w.u32(0x00000001);   // Latin 1
    w.u32(0);

    w.s16(Math.round(upm * 0.5));    // sxHeight
    w.s16(Math.round(upm * 0.7));    // sCapHeight
    w.u16(0);                        // usDefaultChar
    w.u16(0x20);                     // usBreakChar = 空格
    w.u16(2);                        // usMaxContext
    void bounds;
    return w.out();
  }

  function unicodeRanges(glyphs) {
    // bit 0: Basic Latin, bit 48: CJK Unified Ideographs 等（做粗略示意即可）
    const bits = [0, 0, 0, 0];
    const setBit = (b) => {
      if (b < 0 || b > 127) return;
      bits[(b / 32) | 0] |= (1 << (b % 32));
    };
    for (const g of glyphs) {
      const c = g.code;
      if (c == null) continue;
      if (c >= 0x20 && c <= 0x7e) setBit(0);
      else if (c >= 0xa0 && c <= 0xff) setBit(1);
      else if (c >= 0x0100 && c <= 0x017f) setBit(2);
      else if (c >= 0x0370 && c <= 0x03ff) setBit(7);
      else if (c >= 0x0400 && c <= 0x04ff) setBit(9);
      else if (c >= 0x2000 && c <= 0x206f) setBit(31);
      else if (c >= 0x2190 && c <= 0x21ff) setBit(37);
      else if (c >= 0x3000 && c <= 0x303f) setBit(48);
      else if (c >= 0x3040 && c <= 0x30ff) setBit(49);
      else if (c >= 0x4e00 && c <= 0x9fff) setBit(59);
      else if (c >= 0xac00 && c <= 0xd7af) setBit(56);
      else if (c >= 0xff00 && c <= 0xffef) setBit(60);
      else if (c >= 0x1f300 && c <= 0x1f9ff) setBit(57);
    }
    return [bits[0] >>> 0, bits[1] >>> 0, bits[2] >>> 0, bits[3] >>> 0];
  }

  /* ---------------------------------------------------------------- 压缩 */

  /**
   * 用浏览器内置 CompressionStream 做 zlib(RFC1950) 压缩，供 WOFF 使用。
   * 环境不支持时返回 null，调用方退化为原样存储。
   */
  async function zlibCompress(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate');   // 'deflate' = zlib 包装
      const writer = cs.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const buf = await new Response(cs.readable).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) {
      return null;
    }
  }

  /* ---------------------------------------------------------------- 导出 */

  global.TTF = { FontBuilder, checksum, normalizeContour, macEpochNow, defaultNotdef, zlibCompress };
})(typeof window !== 'undefined' ? window : globalThis);
