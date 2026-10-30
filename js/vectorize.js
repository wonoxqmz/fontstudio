/* ============================================================================
 * vectorize.js — 位图 → 矢量轮廓
 * ---------------------------------------------------------------------------
 * 采用「像素边缘追踪」：把每个实心像素的四条边中有邻居空缺的部分作为有向边，
 * 沿边首尾相接形成闭合环。相邻格点出现「对角接触」歧义时按 8 连通语义左转，
 * 于是对角相连的笔画会被视为同一个连通块（更符合手写/像素字形的直觉）。
 *
 * 输出的是字体坐标系（y 向上）下的轮廓点列表，可直接喂给 ttf.js。
 * ==========================================================================*/
(function (global) {
  'use strict';

  // 方向编号：0=东 1=南 2=西 3=北（图像坐标，y 向下）
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];

  /* ---------------------------------------------------------------- 边缘追踪 */

  /**
   * 追踪二值位图的所有闭合环。
   * @param {Uint8Array|Uint8ClampedArray} bmp 长度 w*h，非 0 视为实心
   * @param {number} w
   * @param {number} h
   * @returns {Array<Array<[number,number]>>} 每个环是格点 [i,j] 序列（图像坐标）
   */
  function traceRings(bmp, w, h) {
    const NW = w + 1;
    const at = (x, y) => (x >= 0 && x < w && y >= 0 && y < h) ? (bmp[y * w + x] ? 1 : 0) : 0;

    // 出边表：nodeIndex -> [{ dir, to }]
    const outMap = new Map();
    function addEdge(i, j, dir) {
      const from = j * NW + i;
      const to = (j + DY[dir]) * NW + (i + DX[dir]);
      let arr = outMap.get(from);
      if (!arr) { arr = []; outMap.set(from, arr); }
      arr.push({ dir, to });
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!at(x, y)) continue;
        if (!at(x, y - 1)) addEdge(x, y, 0);           // 上边，向东
        if (!at(x + 1, y)) addEdge(x + 1, y, 1);       // 右边，向南
        if (!at(x, y + 1)) addEdge(x + 1, y + 1, 2);   // 下边，向西
        if (!at(x - 1, y)) addEdge(x, y + 1, 3);       // 左边，向北
      }
    }

    const rings = [];
    const visited = new Set();

    for (const [startNode, outs] of outMap) {
      for (const e0 of outs) {
        if (visited.has(startNode * 4 + e0.dir)) continue;

        const ring = [];
        let node = startNode;
        let dir = e0.dir;
        let guard = 0;

        while (guard++ < 4e6) {
          const k = node * 4 + dir;
          if (visited.has(k)) break;
          visited.add(k);

          const ci = node % NW;
          const cj = (node - ci) / NW;
          ring.push([ci, cj]);

          const to = (cj + DY[dir]) * NW + (ci + DX[dir]);
          const outs2 = outMap.get(to);
          if (!outs2) break;

          let ndir;
          if (outs2.length === 1) {
            ndir = outs2[0].dir;
          } else {
            // 歧义点（对角接触）：8 连通语义 = 相对来向左转 90°
            const turn = (dir + 3) % 4;
            const found = outs2.find(o => o.dir === turn);
            ndir = found ? found.dir : outs2[0].dir;
          }
          node = to;
          dir = ndir;
        }
        if (ring.length >= 4) rings.push(ring);
      }
    }
    return rings;
  }

  /* ------------------------------------------------------------------ 几何 */

  /** 有符号面积（字体坐标 y 向上时：正 = 逆时针） */
  function signedArea(pts) {
    let a = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  /** 射线法：点是否在多边形内部 */
  function pointInPoly(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** Douglas–Peucker 折线简化 */
  function simplifyDP(pts, eps) {
    if (eps <= 0 || pts.length < 4) return pts.slice();

    // 闭合环：先找距离首点最远的点，切成两段分别简化
    let far = 0, fard = -1;
    const p0 = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const d = (pts[i][0] - p0[0]) ** 2 + (pts[i][1] - p0[1]) ** 2;
      if (d > fard) { fard = d; far = i; }
    }
    const A = pts.slice(0, far + 1);
    const B = pts.slice(far).concat([pts[0]]);

    const out = segSimplify(A, eps).slice(0, -1)
      .concat(segSimplify(B, eps).slice(0, -1));
    return out.length >= 3 ? out : pts.slice();
  }

  function segSimplify(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = 1;
    keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    const e2 = eps * eps;

    while (stack.length) {
      const [s, e] = stack.pop();
      if (e - s < 2) continue;
      const [x1, y1] = pts[s], [x2, y2] = pts[e];
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      let maxD = -1, maxI = -1;
      for (let i = s + 1; i < e; i++) {
        let d;
        if (len2 === 0) {
          d = (pts[i][0] - x1) ** 2 + (pts[i][1] - y1) ** 2;
        } else {
          let t = ((pts[i][0] - x1) * dx + (pts[i][1] - y1) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
          const px = x1 + t * dx, py = y1 + t * dy;
          d = (pts[i][0] - px) ** 2 + (pts[i][1] - py) ** 2;
        }
        if (d > maxD) { maxD = d; maxI = i; }
      }
      if (maxD > e2) {
        keep[maxI] = 1;
        stack.push([s, maxI], [maxI, e]);
      }
    }
    const res = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) res.push(pts[i]);
    return res;
  }

  /* ------------------------------------------------------------ 顶角圆滑 */

  /**
   * 把折线的尖角替换成二次贝塞尔圆角。
   * @param {Array<[number,number]>} pts 闭合折线
   * @param {number} r 圆角半径（网格单位），0 = 保持锐利
   * @returns {Array<{x:number,y:number,on:boolean}>}
   */
  function roundCorners(pts, r) {
    const n = pts.length;
    const out = [];
    if (r <= 0 || n < 3) {
      for (const p of pts) out.push({ x: p[0], y: p[1], on: true });
      return out;
    }

    for (let i = 0; i < n; i++) {
      const P = pts[i], A = pts[(i - 1 + n) % n], B = pts[(i + 1) % n];
      let d1x = P[0] - A[0], d1y = P[1] - A[1];
      let d2x = B[0] - P[0], d2y = B[1] - P[1];
      const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
      if (l1 < 1e-9 || l2 < 1e-9) { out.push({ x: P[0], y: P[1], on: true }); continue; }
      d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;

      // 共线（或近共线）→ 保持顶点
      const cross = d1x * d2y - d1y * d2x;
      const dot = d1x * d2x + d1y * d2y;
      if (Math.abs(cross) < 1e-6 || dot > 0.9995) {
        out.push({ x: P[0], y: P[1], on: true });
        continue;
      }

      const rr = Math.min(r, l1 / 2, l2 / 2);
      const inX = P[0] - d1x * rr, inY = P[1] - d1y * rr;
      const outX = P[0] + d2x * rr, outY = P[1] + d2y * rr;

      out.push({ x: inX, y: inY, on: true });
      out.push({ x: P[0], y: P[1], on: false });  // 控制点
      out.push({ x: outX, y: outY, on: true });
    }

    // 清理零长度相邻 on 点
    const cleaned = [];
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      const prev = cleaned[cleaned.length - 1];
      if (prev && prev.on && c.on &&
          Math.abs(prev.x - c.x) < 1e-6 && Math.abs(prev.y - c.y) < 1e-6) continue;
      cleaned.push(c);
    }
    while (cleaned.length > 1) {
      const a = cleaned[0], b = cleaned[cleaned.length - 1];
      if (a.on && b.on && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) cleaned.pop();
      else break;
    }
    return cleaned;
  }

  /* -------------------------------------------------------- 位图预处理工具 */

  /** Otsu 自动阈值（输入 0-255 灰度数组） */
  function otsuThreshold(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i] | 0]++;
    const total = gray.length;
    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * hist[i];

    let sumB = 0, wB = 0, best = 0, bestVar = -1;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sumAll - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > bestVar) { bestVar = between; best = t; }
    }
    return best;
  }

  /** 形态学去噪：移除孤立实心点 / 填补孤立空洞 */
  function despeckle(bmp, w, h, minBlob) {
    if (minBlob <= 1) return bmp;

    // 移除小于 minBlob 的实心连通块（8 连通）
    const seen = new Uint8Array(w * h);
    const stack = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!bmp[idx] || seen[idx]) continue;
        stack.length = 0;
        stack.push(idx);
        seen[idx] = 1;
        const blob = [];
        while (stack.length) {
          const c = stack.pop();
          blob.push(c);
          const cx = c % w, cy = (c - cx) / w;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = cx + dx, ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const ni = ny * w + nx;
              if (bmp[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
            }
          }
        }
        if (blob.length < minBlob) for (const b of blob) bmp[b] = 0;
      }
    }

    // 填补小于 minBlob 的空洞（背景 4 连通，不含外边界）
    const seen2 = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (bmp[idx] || seen2[idx]) continue;
        stack.length = 0;
        stack.push(idx);
        seen2[idx] = 1;
        const hole = [];
        let touchEdge = false;
        while (stack.length) {
          const c = stack.pop();
          hole.push(c);
          const cx = c % w, cy = (c - cx) / w;
          if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) touchEdge = true;
          const nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (const [nx, ny] of nb) {
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (!bmp[ni] && !seen2[ni]) { seen2[ni] = 1; stack.push(ni); }
          }
        }
        if (!touchEdge && hole.length < minBlob) for (const b of hole) bmp[b] = 1;
      }
    }
    return bmp;
  }

  /* -------------------------------------------------------------- 主入口 */

  /**
   * 位图 → 轮廓集合。
   * @param {Uint8Array} bmp 长度 w*h，非 0 = 实心
   * @param {number} w
   * @param {number} h
   * @param {object} [opt]
   * @param {number} [opt.eps=0.4]      Douglas–Peucker 简化容差（网格单位，0=关闭）
   * @param {number} [opt.corner=0]     顶角圆角半径（网格单位，0=锐利）
   * @param {number} [opt.minArea=0.5]  丢弃面积小于该值的环（平方网格单位）
   * @param {number} [opt.yBase]        字体坐标下网格底边的 y 值，默认 h
   * @returns {{contours: Array<Array<{x:number,y:number,on:boolean}>>, rings: number}}
   *          坐标为「网格单位」的浮点数（未按 UPM 缩放）
   */
  function vectorize(bmp, w, h, opt) {
    opt = opt || {};
    const eps = opt.eps == null ? 0.4 : opt.eps;
    const corner = opt.corner == null ? 0 : opt.corner;
    const minArea = opt.minArea == null ? 0.5 : opt.minArea;
    const yBase = opt.yBase == null ? h : opt.yBase;

    const rawRings = traceRings(bmp, w, h);

    // 转字体坐标：图像 (i,j) → 字体 (i, yBase - j)
    const polys = rawRings.map(r => r.map(([i, j]) => [i, yBase - j]));

    // 建立包含层级：depth 偶数 = 外轮廓，奇数 = 洞
    // 代表点 = 环上 y 最小点的相邻边中点，再沿 y 正方向微移（必定落在环内部）
    const reps = polys.map(poly => {
      const n = poly.length;
      let bi = 0;
      for (let k = 1; k < n; k++) {
        if (poly[k][1] < poly[bi][1] ||
           (poly[k][1] === poly[bi][1] && poly[k][0] < poly[bi][0])) bi = k;
      }
      const a = poly[(bi - 1 + n) % n];
      const b = poly[(bi + 1) % n];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      return [mx, Math.max(my, poly[bi][1]) + 1e-3];
    });

    const contours = [];
    for (let i = 0; i < polys.length; i++) {
      let depth = 0;
      for (let j = 0; j < polys.length; j++) {
        if (i === j) continue;
        if (pointInPoly(reps[i][0], reps[i][1], polys[j])) depth++;
      }
      const poly = polys[i];
      const absA = Math.abs(signedArea(poly));
      if (absA < minArea) continue;

      // 简化
      let work = simplifyDP(poly, eps);
      work = dedupe(work);
      if (work.length < 3) continue;

      // 方向：外轮廓顺时针（字体坐标下面积 < 0），洞逆时针（面积 > 0）
      let area = signedArea(work);
      const wantNeg = (depth % 2 === 0);
      if ((wantNeg && area > 0) || (!wantNeg && area < 0)) work.reverse();

      const pts = roundCorners(work, corner);
      if (pts.length < 3) continue;
      contours.push(pts);
    }

    return { contours, rings: polys.length };
  }

  function dedupe(pts) {
    const out = [];
    for (const p of pts) {
      const prev = out[out.length - 1];
      if (prev && Math.abs(prev[0] - p[0]) < 1e-9 && Math.abs(prev[1] - p[1]) < 1e-9) continue;
      out.push(p);
    }
    if (out.length > 1) {
      const a = out[0], b = out[out.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) out.pop();
    }
    return out;
  }

  /* ---------------------------------------------------------- 图片 → 位图 */

  /**
   * 把图片数据二值化成位图。
   * @param {ImageData} imgData 源图（任意尺寸）
   * @param {number} w 目标宽
   * @param {number} h 目标高
   * @param {object} opt
   * @param {number} [opt.threshold] 0-255，null/undefined = Otsu 自动
   * @param {boolean} [opt.invert=false] 反色（浅字深底时使用）
   * @param {boolean} [opt.keepRatio=true] 保持宽高比
   * @param {'contain'|'stretch'|'fit'} [opt.mode='contain']
   * @param {number} [opt.blur=0] 缩放前的模糊强度（0-3）
   * @param {number} [opt.minBlob=1] 去噪阈值
   * @returns {Uint8Array} 长度 w*h
   */
  function imageToBitmap(imgData, w, h, opt) {
    opt = opt || {};
    const invert = !!opt.invert;
    const keepRatio = opt.keepRatio !== false;
    const blur = opt.blur || 0;
    const minBlob = opt.minBlob || 1;

    // 1) 缩放到目标网格：先把源图画进 (w*s, h*s) 的中等尺寸画布，避免直接缩小丢笔画
    const SS = 4;
    const BW = w * SS, BH = h * SS;
    const src = document.createElement('canvas');
    src.width = imgData.width;
    src.height = imgData.height;
    src.getContext('2d').putImageData(imgData, 0, 0);

    const cvs = document.createElement('canvas');
    cvs.width = BW;
    cvs.height = BH;
    const ctx = cvs.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 先算源图的「墨迹包围盒」，去掉图片周围多余留白
    const box = inkBBox(imgData, invert ? 'dark' : 'light');
    const sx = box ? box.x : 0, sy = box ? box.y : 0;
    const sw = box ? box.w : imgData.width, sh = box ? box.h : imgData.height;

    let dw = BW, dh = BH, dx = 0, dy = 0;
    if (keepRatio) {
      const scale = Math.min(BW / sw, BH / sh);
      dw = sw * scale;
      dh = sh * scale;
      dx = (BW - dw) / 2;
      dy = (BH - dh) / 2;
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, BW, BH);
    ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);

    // 2) 可选模糊（抗锯齿）
    let pixels = ctx.getImageData(0, 0, BW, BH);
    if (blur > 0) pixels = boxBlur(pixels, blur);

    // 3) 灰度化 + 按块取样降采样到目标网格
    const gray = new Float32Array(w * h);
    const d = pixels.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0, cnt = 0;
        for (let yy = 0; yy < SS; yy++) {
          for (let xx = 0; xx < SS; xx++) {
            const px = Math.min(BW - 1, x * SS + xx);
            const py = Math.min(BH - 1, y * SS + yy);
            const o = (py * BW + px) * 4;
            const a = d[o + 3] / 255;
            // 透明像素按白底处理
            const r = d[o] * a + 255 * (1 - a);
            const g = d[o + 1] * a + 255 * (1 - a);
            const b = d[o + 2] * a + 255 * (1 - a);
            acc += 0.299 * r + 0.587 * g + 0.114 * b;
            cnt++;
          }
        }
        gray[y * w + x] = acc / cnt;
      }
    }

    // 4) 阈值
    let thr;
    if (opt.threshold == null) {
      const arr = new Uint8Array(gray.length);
      for (let i = 0; i < gray.length; i++) arr[i] = Math.max(0, Math.min(255, Math.round(gray[i])));
      thr = otsuThreshold(arr);
    } else {
      thr = opt.threshold;
    }

    const bmp = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++) {
      const dark = gray[i] <= thr;
      bmp[i] = (invert ? !dark : dark) ? 1 : 0;
    }

    despeckle(bmp, w, h, minBlob);
    return bmp;
  }

  /** 找非背景像素的包围盒 */
  function inkBBox(imgData, bg) {
    const { width: W, height: H, data: d } = imgData;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const a = d[o + 3];
        let ink;
        if (a < 16) {
          ink = false; // 透明 = 背景
        } else {
          const lum = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
          ink = bg === 'dark' ? lum < 128 : lum < 200;
        }
        if (ink) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < x0 || y1 < y0) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** 简易盒式模糊 */
  function boxBlur(imgData, radius) {
    const { width: W, height: H, data: d } = imgData;
    const r = Math.max(1, Math.round(radius));
    const out = new Uint8ClampedArray(d.length);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = Math.max(0, Math.min(H - 1, y + dy));
          for (let dx = -r; dx <= r; dx++) {
            const xx = Math.max(0, Math.min(W - 1, x + dx));
            const o = (yy * W + xx) * 4;
            sr += d[o]; sg += d[o + 1]; sb += d[o + 2]; sa += d[o + 3];
            n++;
          }
        }
        const o = (y * W + x) * 4;
        out[o] = sr / n; out[o + 1] = sg / n; out[o + 2] = sb / n; out[o + 3] = sa / n;
      }
    }
    return new ImageData(out, W, H);
  }

  /* ---------------------------------------------------------------- 导出 */

  global.Vectorize = {
    vectorize,
    traceRings,
    signedArea,
    simplifyDP,
    roundCorners,
    imageToBitmap,
    otsuThreshold,
    despeckle,
  };
})(typeof window !== 'undefined' ? window : globalThis);
