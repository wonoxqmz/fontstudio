/* ============================================================================
 * app.js — 字形工坊主程序
 * ==========================================================================*/
(function () {
  'use strict';

  /* ============================================================ 状态 */

  const state = {
    project: {
      version: 1,
      grid: { w: 64, h: 64 },
      font: {
        familyName: 'MyFont',
        styleName: 'Regular',
        copyright: '',
        designer: '',
        manufacturer: '',
        license: '',
        version: 'Version 1.000',
        vendorID: 'VCWK',
        upm: 1000,
        weightClass: 400,
        baselineRow: 56,   // 基线在图像行索引（0 = 顶部），默认约在 7/8 高度处
        monospace: true,
        bold: false,
        italic: false,
      },
    },
    glyphs: new Map(),      // code -> {code, bmp, advance}
    current: null,          // 当前 code
    tool: 'pen',
    zoom: 24,
    history: [],
    future: [],
    vec: { eps: 0.4, corner: 0, minArea: 0.5 },
    clipboard: null,
    showVec: true,
    showGrid: true,
    showGuides: true,
  };

  /* ============================================================ DOM */

  const $ = id => document.getElementById(id);
  const els = {
    fontFamily: $('fontFamily'),
    btnSave: $('btnSave'), btnLoad: $('btnLoad'), btnExport: $('btnExport'),
    btnSettings: $('btnSettings'),
    glyphCount: $('glyphCount'),
    charInput: $('charInput'), btnPasteBatch: $('btnPasteBatch'),
    glyphList: $('glyphList'),
    toolbar: $('toolbar'),
    cv: $('cv'), canvasHost: $('canvasHost'),
    gridSize: $('gridSize'),
    statPos: $('statPos'), statChar: $('statChar'),
    chkVec: $('chkVec'), chkGrid: $('chkGrid'), chkGuides: $('chkGuides'),
    curCode: $('curCode'),
    advMode: $('advMode'), advCustomRow: $('advCustomRow'), advCustom: $('advCustom'),
    btnImport: $('btnImport'),
    vecEps: $('vecEps'), vecEpsV: $('vecEpsV'),
    vecCorner: $('vecCorner'), vecCornerV: $('vecCornerV'),
    vecMin: $('vecMin'), vecMinV: $('vecMinV'),
    preview: $('preview'),
    dlgSettings: $('dlgSettings'),
    s_family: $('s_family'), s_style: $('s_style'), s_copyright: $('s_copyright'),
    s_designer: $('s_designer'), s_manufacturer: $('s_manufacturer'),
    s_license: $('s_license'), s_version: $('s_version'), s_vendor: $('s_vendor'),
    s_upm: $('s_upm'), s_weight: $('s_weight'), s_baseline: $('s_baseline'),
    s_mono: $('s_mono'), s_bold: $('s_bold'), s_italic: $('s_italic'),
    btnSettingsOk: $('btnSettingsOk'), btnSettingsCancel: $('btnSettingsCancel'),
    dlgImport: $('dlgImport'),
    dropZone: $('dropZone'), fileInput: $('fileInput'),
    im_threshold_mode: $('im_threshold_mode'), im_threshold: $('im_threshold'),
    im_invert: $('im_invert'), im_ratio: $('im_ratio'),
    im_blur: $('im_blur'), im_denoise: $('im_denoise'),
    importPreview: $('importPreview'), importInfo: $('importInfo'),
    btnImportOk: $('btnImportOk'), btnImportCancel: $('btnImportCancel'),
    dlgBatch: $('dlgBatch'), batchText: $('batchText'), batchInfo: $('batchInfo'),
    btnBatchOk: $('btnBatchOk'), btnBatchCancel: $('btnBatchCancel'),
    dlgConfirm: $('dlgConfirm'), confirmTitle: $('confirmTitle'),
    confirmMsg: $('confirmMsg'), confirmOk: $('confirmOk'), confirmCancel: $('confirmCancel'),
    dlgHelp: $('dlgHelp'), btnHelp: $('btnHelp'), btnHelpClose: $('btnHelpClose'),
    saveWarn: $('saveWarn'),
    toast: $('toast'),
    fileProject: $('fileProject'),
    btnUndo: $('btnUndo'), btnRedo: $('btnRedo'),
    btnMirrorH: $('btnMirrorH'), btnMirrorV: $('btnMirrorV'), btnRotate: $('btnRotate'),
    btnShiftL: $('btnShiftL'), btnShiftR: $('btnShiftR'),
    btnShiftU: $('btnShiftU'), btnShiftD: $('btnShiftD'),
    btnCopy: $('btnCopy'), btnPaste: $('btnPaste'), btnClear: $('btnClear'),
    btnZoomIn: $('btnZoomIn'), btnZoomOut: $('btnZoomOut'), btnFit: $('btnFit'),
    zoomLabel: $('zoomLabel'),
  };

  /* ============================================================ 通用 */

  let toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800);
  }

  /**
   * 自绘确认框（不用 window.confirm —— Android WebView 没设 WebChromeClient 时它是哑的）
   * @param {string} title 标题
   * @param {string} msg 正文
   * @param {Function} onOk 确认后的回调
   * @param {string} [okText]
   */
  function askConfirm(title, msg, onOk, okText) {
    els.confirmTitle.textContent = title;
    els.confirmMsg.textContent = msg;
    els.confirmOk.textContent = okText || '确定';
    els.confirmOk.onclick = () => {
      els.dlgConfirm.close();
      onOk();
    };
    els.confirmCancel.onclick = () => els.dlgConfirm.close();
    if (!els.dlgConfirm.open) els.dlgConfirm.showModal();
  }

  function codeToLabel(code) {
    if (code == null) return '—';
    return `U+${code.toString(16).toUpperCase().padStart(4, '0')} ${String.fromCodePoint(code)}`;
  }

  /* ============================================================ 更新检查 */

  const APP_VERSION = '0.1.4';
  // 更新检查走多个源，任一可用即可（国内优先 Gitee，境外/备用 GitHub 与 Cloudflare）
  const UPDATE_SOURCES = [
    'https://gitee.com/api/v5/repos/i-dont-want-to-pick-a-name/fontstudio/contents/version.json?ref=master',
    'https://api.github.com/repos/longchangjin2-arch/fontstudio/contents/version.json',
    'https://fontstudio.3772387377.workers.dev/version.json',
  ];

  function b64ToUtf8(b64) {
    const bytes = Uint8Array.from(atob(String(b64).replace(/\s/g, '')), c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  /** 从各个源挨个取 version.json，返回第一个成功的结果 */
  async function fetchVersionInfo() {
    let lastErr = null;
    for (const url of UPDATE_SOURCES) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      try {
        const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const payload = await res.json();
        // Gitee / GitHub contents API 返回 { content: base64 }；纯 JSON 源直接是对象
        const info = typeof payload.content === 'string'
          ? JSON.parse(b64ToUtf8(payload.content))
          : payload;
        if (info && info.version) return info;
        throw new Error('bad payload');
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
      }
    }
    throw lastErr || new Error('no source');
  }

  /** 语义化版本比较：a > b 返回 true */
  function isNewer(a, b) {
    const pa = String(a || '').split('.').map(n => +n || 0);
    const pb = String(b || '').split('.').map(n => +n || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0;
    }
    return false;
  }

  function showUpdateDialog(info) {
    $('updVer').textContent = 'v' + info.version;
    $('updNotes').textContent = info.notes || '（无更新说明）';
    const url = info.apkUrl || info.exeUrl || info.url || '';
    const link = $('updLink');
    if (url) {
      link.href = url;
      link.style.display = '';
    } else {
      link.style.display = 'none';
    }
    $('updFoot').textContent = `当前版本 v${APP_VERSION} · 更新包托管于 Gitee Releases`;
    const dlg = $('dlgUpdate');
    if (!dlg.open) dlg.showModal();
  }

  /** manual=true 时给反馈；启动自动检查时静默失败 */
  async function checkUpdate(manual) {
    try {
      const info = await fetchVersionInfo();
      if (!isNewer(info.version, APP_VERSION)) {
        if (manual) toast(`已是最新版本 v${APP_VERSION}`);
        return;
      }
      showUpdateDialog(info);
    } catch (err) {
      if (manual) toast(err.name === 'AbortError' ? '检查更新失败：网络超时' : '检查更新失败：连不上服务器');
    }
  }

  /** 把用户输入解析成码位数组。支持单个字符 / U+XXXX / 多字符 */
  function parseCharInput(str) {
    str = str.trim();
    if (!str) return [];
    const out = [];
    if (/^[Uu]\+[0-9A-Fa-f]+$/.test(str)) {
      const n = parseInt(str.slice(2), 16);
      if (n >= 0 && n <= 0x10ffff) out.push(n);
      return out;
    }
    if (/^[0-9A-Fa-f]{1,6}$/.test(str)) {
      const n = parseInt(str, 16);
      if (n >= 0x20 && n <= 0x10ffff) out.push(n);
      return out;
    }
    for (const ch of str) out.push(ch.codePointAt(0));
    return out;
  }

  /* ============================================================ 字形管理 */

  function emptyBitmap() {
    return new Uint8Array(state.project.grid.w * state.project.grid.h);
  }

  function ensureGlyph(code) {
    let g = state.glyphs.get(code);
    if (!g) {
      g = { code, bmp: emptyBitmap(), advance: null };
      state.glyphs.set(code, g);
    }
    return g;
  }

  function currentGlyph() {
    return state.current == null ? null : state.glyphs.get(state.current);
  }

  /** 把当前字形的属性同步到右侧面板控件 */
  function syncCurrentUI() {
    const g = state.current == null ? null : state.glyphs.get(state.current);
    const custom = !!(g && g.advance != null);
    els.advMode.value = custom ? 'custom' : 'auto';
    els.advCustomRow.style.display = custom ? '' : 'none';
    if (custom) els.advCustom.value = g.advance;
  }

  function setCurrent(code) {
    state.current = code;
    state.history = [];
    state.future = [];
    syncCurrentUI();
    renderAll();
  }

  function deleteGlyph(code) {
    state.glyphs.delete(code);
    if (state.current === code) {
      // 自动选中相邻字形，避免画布突然空白
      const rest = [...state.glyphs.keys()].sort((a, b) => a - b);
      if (!rest.length) {
        state.current = null;
      } else {
        const idx = rest.findIndex(c => c > code);
        state.current = rest[idx === -1 ? rest.length - 1 : idx];
      }
      state.history = [];
      state.future = [];
      syncCurrentUI();
    }
    renderAll();
    scheduleSave();
  }

  function getAdvanceGrid(g) {
    if (g && g.advance != null) return g.advance;
    return state.project.grid.w;
  }

  /* ============================================================ 历史记录 */

  function pushHistory() {
    const g = currentGlyph();
    if (!g) return;
    state.history.push({ code: g.code, bmp: g.bmp.slice(), advance: g.advance });
    if (state.history.length > 100) state.history.shift();
    state.future = [];
  }

  function undo() {
    const item = state.history.pop();
    if (!item) { toast('没有可撤销的操作'); return; }
    if (state.current !== item.code) {
      // 撤销的是另一个字形：切过去，否则用户看不到变化
      state.current = item.code;
      state.future = [];
      syncCurrentUI();
    }
    const g = ensureGlyph(item.code);
    state.future.push({ code: g.code, bmp: g.bmp.slice(), advance: g.advance });
    g.bmp = item.bmp;
    g.advance = item.advance;
    renderAll();
  }

  function redo() {
    const item = state.future.pop();
    if (!item) { toast('没有可重做的操作'); return; }
    const g = ensureGlyph(item.code);
    state.history.push({ code: g.code, bmp: g.bmp.slice(), advance: g.advance });
    g.bmp = item.bmp;
    g.advance = item.advance;
    renderAll();
  }

  /* ============================================================ 画布渲染 */

  const PAD = 0;

  function renderCanvas() {
    const g = currentGlyph();
    const { w: W, h: H } = state.project.grid;
    const z = state.zoom;
    const cv = els.cv;
    const dpr = window.devicePixelRatio || 1;
    const cw = W * z, chh = H * z;
    cv.width = cw * dpr;
    cv.height = chh * dpr;
    cv.style.width = cw + 'px';
    cv.style.height = chh + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, chh);

    // 背景棋盘（表示空白）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, chh);

    // 参考线
    const bl = state.project.font.baselineRow;
    if (state.showGuides && bl >= 0 && bl <= H) {
      // 降部区域
      ctx.fillStyle = 'rgba(229,62,62,.05)';
      ctx.fillRect(0, bl * z, cw, (H - bl) * z);
      // 基线
      ctx.strokeStyle = 'rgba(229,62,62,.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, bl * z + 0.5);
      ctx.lineTo(cw, bl * z + 0.5);
      ctx.stroke();
    }

    // 像素
    if (g) {
      ctx.fillStyle = '#1a202c';
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (g.bmp[y * W + x]) ctx.fillRect(x * z, y * z, z, z);
        }
      }
    }

    // 矢量预览
    if (state.showVec && g) {
      const contours = computeContours(g);
      ctx.strokeStyle = 'rgba(49,130,206,.85)';
      ctx.lineWidth = Math.max(1, z / 20);
      for (const c of contours) {
        ctx.beginPath();
        contourToPath(ctx, c, x => x * z, y => (H - y) * z);
        ctx.stroke();
      }
    }

    // 网格线（大网格下更淡，避免像素块观感）
    if (state.showGrid && z >= 4) {
      const dense = W > 32;
      ctx.strokeStyle = dense ? 'rgba(0,0,0,.045)' : 'rgba(0,0,0,.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        ctx.moveTo(x * z + 0.5, 0);
        ctx.lineTo(x * z + 0.5, chh);
      }
      for (let y = 0; y <= H; y++) {
        ctx.moveTo(0, y * z + 0.5);
        ctx.lineTo(cw, y * z + 0.5);
      }
      ctx.stroke();
      // 每 4 格加深（大网格改每 8 格）
      const step = dense ? 8 : 4;
      ctx.strokeStyle = dense ? 'rgba(0,0,0,.10)' : 'rgba(0,0,0,.13)';
      ctx.beginPath();
      for (let x = 0; x <= W; x += step) {
        ctx.moveTo(x * z + 0.5, 0);
        ctx.lineTo(x * z + 0.5, chh);
      }
      for (let y = 0; y <= H; y += step) {
        ctx.moveTo(0, y * z + 0.5);
        ctx.lineTo(cw, y * z + 0.5);
      }
      ctx.stroke();
    }

    // 外框
    ctx.strokeStyle = 'rgba(0,0,0,.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, cw - 1, chh - 1);

    els.zoomLabel.textContent = Math.round(state.zoom / 16 * 100) + '%';
    updateStats();
  }

  function contourToPath(ctx, pts, toX, toY) {
    const n = pts.length;
    if (n < 2) return;
    let start = 0;
    for (let i = 0; i < n; i++) if (pts[i].on) { start = i; break; }
    const p0 = pts[start];
    ctx.moveTo(toX(p0.x), toY(p0.y));
    let prevOff = null;
    for (let k = 1; k <= n; k++) {
      const p = pts[(start + k) % n];
      if (p.on) {
        if (prevOff) {
          ctx.quadraticCurveTo(toX(prevOff.x), toY(prevOff.y), toX(p.x), toY(p.y));
          prevOff = null;
        } else {
          ctx.lineTo(toX(p.x), toY(p.y));
        }
      } else {
        prevOff = p;
      }
    }
    ctx.closePath();
  }

  function updateStats() {
    const g = currentGlyph();
    els.statChar.textContent = g ? codeToLabel(g.code) : '未选择字形';
    els.curCode.textContent = g ? codeToLabel(g.code) : '—';
  }

  /* ---------------------------------------------------------- 矢量化 */

  function computeContours(g) {
    if (!g) return [];
    try {
      const res = Vectorize.vectorize(g.bmp, state.project.grid.w, state.project.grid.h, {
        eps: state.vec.eps,
        corner: state.vec.corner,
        minArea: state.vec.minArea,
        yBase: state.project.font.baselineRow,
      });
      return res.contours;
    } catch (e) {
      console.error('vectorize error', e);
      return [];
    }
  }

  /* ============================================================ 交互 */

  let drag = null; // {tool, startX, startY, mode, snapshot}

  function canvasPos(e) {
    const r = els.cv.getBoundingClientRect();
    const z = state.zoom;
    const x = Math.floor((e.clientX - r.left) / z);
    const y = Math.floor((e.clientY - r.top) / z);
    return { x, y, in: x >= 0 && y >= 0 && x < state.project.grid.w && y < state.project.grid.h };
  }

  function onDown(e) {
    const g = currentGlyph();
    if (!g) { toast('请先添加一个字形'); return; }
    const p = canvasPos(e);
    if (!p.in) return;
    e.preventDefault();

    let tool = state.tool;
    if (e.button === 2) tool = 'eraser';

    pushHistory();

    let mode = null;
    if (tool === 'pen' || tool === 'eraser') {
      const idx = p.y * state.project.grid.w + p.x;
      mode = (tool === 'eraser') ? 0 : (g.bmp[idx] ? 0 : 1);
      setPixel(g, p.x, p.y, mode);
      drag = { tool, mode, sx: p.x, sy: p.y };
    } else if (tool === 'fill') {
      floodFill(g, p.x, p.y, g.bmp[p.y * state.project.grid.w + p.x] ? 0 : 1);
      drag = null;
      renderAll();
      scheduleSave();
      return;
    } else if (tool === 'pick') {
      const v = g.bmp[p.y * state.project.grid.w + p.x];
      setTool(v ? 'pen' : 'eraser');
      state.history.pop();
      return;
    } else {
      drag = { tool, mode: 1, sx: p.x, sy: p.y, snapshot: g.bmp.slice() };
    }
    renderCanvas();
  }

  function onMove(e) {
    const p = canvasPos(e);
    els.statPos.textContent = p.in ? `(${p.x}, ${p.y})` : '—';
    if (!drag) return;
    const g = currentGlyph();
    if (!g) return;
    const W = state.project.grid.w, H = state.project.grid.h;
    // 绘制类工具把坐标夹在画布内，拖出去时形状停在边缘
    const cx = Math.max(0, Math.min(W - 1, p.x));
    const cy = Math.max(0, Math.min(H - 1, p.y));

    if (drag.tool === 'pen' || drag.tool === 'eraser') {
      if (!p.in) {
        drag.outside = true;              // 移出画布：断笔，别和下一段连成直线
      } else if (drag.outside) {
        drag.outside = false;             // 重新进入：从当前格重新起笔
        drag.sx = p.x; drag.sy = p.y;
        setPixel(g, p.x, p.y, drag.mode);
      } else {
        linePixels(drag.sx, drag.sy, p.x, p.y, (x, y) => setPixel(g, x, y, drag.mode));
        drag.sx = p.x; drag.sy = p.y;
      }
    } else if (drag.tool === 'line') {
      g.bmp.set(drag.snapshot);
      linePixels(drag.sx, drag.sy, cx, cy, (x, y) => px(g, x, y, 1));
    } else if (drag.tool === 'rect') {
      g.bmp.set(drag.snapshot);
      const x0 = Math.min(drag.sx, cx), x1 = Math.max(drag.sx, cx);
      const y0 = Math.min(drag.sy, cy), y1 = Math.max(drag.sy, cy);
      for (let x = x0; x <= x1; x++) { px(g, x, y0, 1); px(g, x, y1, 1); }
      for (let y = y0; y <= y1; y++) { px(g, x0, y, 1); px(g, x1, y, 1); }
    } else if (drag.tool === 'ellipse') {
      g.bmp.set(drag.snapshot);
      const x0 = Math.min(drag.sx, cx), x1 = Math.max(drag.sx, cx);
      const y0 = Math.min(drag.sy, cy), y1 = Math.max(drag.sy, cy);
      drawEllipse(g, x0, y0, x1, y1);
    }
    renderCanvas();
  }

  function onUp(e) {
    if (drag) {
      drag = null;
      scheduleSave();
      renderAll();
    }
  }

  function setPixel(g, x, y, v) {
    const W = state.project.grid.w, H = state.project.grid.h;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    g.bmp[y * W + x] = v ? 1 : 0;
  }

  function px(g, x, y, v) { setPixel(g, x, y, v); }

  function linePixels(x0, y0, x1, y1, fn) {
    // Bresenham
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      fn(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function floodFill(g, x, y, v) {
    const W = state.project.grid.w, H = state.project.grid.h;
    const target = g.bmp[y * W + x];
    if (target === v) return;
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      const i = cy * W + cx;
      if (g.bmp[i] !== target) continue;
      g.bmp[i] = v;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  function drawEllipse(g, x0, y0, x1, y1) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    if (rx < 0.5 || ry < 0.5) { px(g, Math.round(cx), Math.round(cy), 1); return; }
    const steps = Math.max(32, Math.round((rx + ry) * 4));
    let lx = null, ly = null;
    for (let i = 0; i <= steps; i++) {
      const a = i / steps * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * rx);
      const y = Math.round(cy + Math.sin(a) * ry);
      if (lx !== null && (lx !== x || ly !== y)) linePixels(lx, ly, x, y, (xx, yy) => px(g, xx, yy, 1));
      lx = x; ly = y;
    }
  }

  /* ============================================================ 变换 */

  function transformGlyph(fn) {
    const g = currentGlyph();
    if (!g) return;
    pushHistory();
    fn(g);
    renderAll();
    scheduleSave();
  }

  function mirrorH(g) {
    const { w: W, h: H } = state.project.grid;
    const nb = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        nb[y * W + x] = g.bmp[y * W + (W - 1 - x)];
    g.bmp = nb;
  }

  function mirrorV(g) {
    const { w: W, h: H } = state.project.grid;
    const nb = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        nb[y * W + x] = g.bmp[(H - 1 - y) * W + x];
    g.bmp = nb;
  }

  function rotate90(g) {
    const { w: W, h: H } = state.project.grid;
    if (W !== H) { toast('旋转需要正方形网格'); return; }
    const nb = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        nb[x * W + (W - 1 - y)] = g.bmp[y * W + x];
    g.bmp = nb;
  }

  function shift(g, dx, dy) {
    const { w: W, h: H } = state.project.grid;
    const nb = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      for (let x = 0; x < W; x++) {
        const nx = x + dx;
        if (nx < 0 || nx >= W) continue;
        nb[ny * W + nx] = g.bmp[y * W + x];
      }
    }
    g.bmp = nb;
  }

  /* ============================================================ 字形列表 */

  function renderGlyphList() {
    const list = els.glyphList;
    list.innerHTML = '';
    const codes = [...state.glyphs.keys()].sort((a, b) => a - b);
    els.glyphCount.textContent = codes.length;

    if (codes.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.innerHTML =
        '还没有任何字形<br><br>' +
        '在上方输入 <b>一个字符</b> 回车即可添加<br>' +
        '也可以点下面的预设批量加入';
      els.glyphList.appendChild(hint);
      return;
    }

    for (const code of codes) {
      const g = state.glyphs.get(code);
      const cell = document.createElement('div');
      cell.className = 'gcell' + (code === state.current ? ' active' : '');
      const cv = document.createElement('canvas');
      const S = 64;
      cv.width = S; cv.height = S;
      drawThumb(cv, g);
      cell.appendChild(cv);

      const ch = document.createElement('span');
      ch.className = 'ch';
      ch.textContent = String.fromCodePoint(code);
      cell.appendChild(ch);

      const hasInk = g.bmp.some(v => v);
      if (!hasInk) cell.classList.add('empty');

      const del = document.createElement('span');
      del.className = 'del';
      del.textContent = '×';
      del.title = '删除字形';
      del.onclick = ev => { ev.stopPropagation(); deleteGlyph(code); };
      cell.appendChild(del);

      cell.onclick = () => setCurrent(code);
      list.appendChild(cell);
    }
  }

  function drawThumb(cv, g) {
    const ctx = cv.getContext('2d');
    const S = cv.width;
    const { w: W, h: H } = state.project.grid;
    ctx.clearRect(0, 0, S, S);
    if (!g) return;
    // 按内容包围盒适配
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (g.bmp[y * W + x]) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    ctx.fillStyle = '#1a202c';
    if (x1 < 0) return;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const s = Math.min(S / bw, S / bh) * 0.85;
    const ox = (S - bw * s) / 2, oy = (S - bh * s) / 2;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (g.bmp[y * W + x])
          ctx.fillRect(ox + (x - x0) * s, oy + (y - y0) * s, s, s);
  }

  /* ============================================================ 添加字符 */

  function addChars(codes, silent) {
    let added = 0;
    for (const c of codes) {
      if (c < 0x20) continue;
      if (!state.glyphs.has(c)) { ensureGlyph(c); added++; }
    }
    if (added > 0) {
      renderGlyphList();
      scheduleSave();
      if (!silent) toast(`添加了 ${added} 个字形`);
    } else if (!silent) {
      toast('没有新增字形');
    }
    return added;
  }

  const PRESETS = {
    ascii: Array.from({ length: 0x7f - 0x20 }, (_, i) => 0x20 + i),
    punct: '。，、；：？！“”‘’（）《》〈〉【】〔〕…—·～｜／＼＋－＝'.split('').map(c => c.codePointAt(0)),
    digits: '0123456789'.split('').map(c => c.codePointAt(0)),
    common: ('的一是了我不人在他有这上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家' +
      '可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己' +
      '面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被' +
      '高已亲其进此话常与活正感').split('').map(c => c.codePointAt(0)),
  };

  /* ============================================================ 图片导入 */

  const imp = {
    imgData: null,
    lastBitmap: null,
  };

  function openImport() {
    if (state.current == null) { toast('请先选择一个字形'); return; }
    imp.imgData = null;
    imp.lastBitmap = null;
    els.importPreview.getContext('2d').clearRect(0, 0, 256, 256);
    els.importInfo.textContent = '—';
    els.dlgImport.showModal();
  }

  function fileToImageData(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const cvs = document.createElement('canvas');
        cvs.width = img.naturalWidth;
        cvs.height = img.naturalHeight;
        const ctx = cvs.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(ctx.getImageData(0, 0, cvs.width, cvs.height));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
      img.src = url;
    });
  }

  function updateImportPreview() {
    if (!imp.imgData) return;
    const { w, h } = state.project.grid;
    const bmp = Vectorize.imageToBitmap(imp.imgData, w, h, {
      threshold: els.im_threshold_mode.value === 'manual' ? +els.im_threshold.value : null,
      invert: els.im_invert.checked,
      keepRatio: els.im_ratio.checked,
      blur: +els.im_blur.value,
      minBlob: +els.im_denoise.value,
    });
    imp.lastBitmap = bmp;
    const cvs = els.importPreview;
    const ctx = cvs.getContext('2d');
    const S = cvs.width;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, S, S);
    const z = S / Math.max(w, h);
    const ox = (S - w * z) / 2, oy = (S - h * z) / 2;
    ctx.fillStyle = '#1a202c';
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (bmp[y * w + x]) ctx.fillRect(ox + x * z, oy + y * z, z, z);

    let ink = 0;
    for (let i = 0; i < bmp.length; i++) ink += bmp[i];
    els.importInfo.textContent = `墨迹像素：${ink} / ${w * h}（${(ink / (w * h) * 100).toFixed(1)}%）`;
  }

  function confirmImport() {
    if (!imp.lastBitmap) { toast('请先选择图片'); return; }
    const g = currentGlyph();
    if (!g) return;
    pushHistory();
    g.bmp = imp.lastBitmap;
    els.dlgImport.close();
    renderAll();
    scheduleSave();
    toast('导入成功');
  }

  /* ============================================================ 字形预览 */

  function renderPreview() {
    const cvs = els.preview;
    const ctx = cvs.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = cvs.clientWidth || 280, H = 200;
    cvs.width = W * dpr;
    cvs.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    const g = currentGlyph();
    if (!g) {
      ctx.fillStyle = '#a0aec0';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('未选择字形', W / 2, H / 2);
      return;
    }

    const f = state.project.font;
    const grid = state.project.grid;
    const scale = f.upm / grid.h;                 // 1 网格单位 = 多少字体单位
    const adv = getAdvanceGrid(g) * scale;
    const asc = f.baselineRow * scale;
    const desc = -(grid.h - f.baselineRow) * scale;

    // em square 映射到画布
    const emW = adv, emH = asc - desc;
    const s = Math.min((W - 30) / emW, (H - 30) / emH);
    const ox = (W - emW * s) / 2;
    const oy = (H - emH * s) / 2;
    // 字体坐标 (fx, fy) → 画布
    const toX = fx => ox + fx * s;
    const toY = fy => oy + (asc - fy) * s;

    // em 边框
    ctx.strokeStyle = '#cbd5e0';
    ctx.strokeRect(toX(0), toY(asc), emW * s, emH * s);
    // 基线
    ctx.strokeStyle = 'rgba(229,62,62,.5)';
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(0));
    ctx.lineTo(toX(emW), toY(0));
    ctx.stroke();

    const contours = computeContours(g);
    ctx.fillStyle = '#1a202c';
    ctx.beginPath();
    for (const c of contours) {
      contourToPath(ctx, c, x => toX(x * scale), y => toY(y * scale));
    }
    ctx.fill('evenodd');

    // 字宽标注
    ctx.fillStyle = '#718096';
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(adv)} / ${f.upm}`, W / 2, H - 6);
  }

  /* ============================================================ 全局设置 */

  function openSettings() {
    const f = state.project.font;
    els.s_family.value = f.familyName;
    els.s_style.value = f.styleName;
    els.s_copyright.value = f.copyright;
    els.s_designer.value = f.designer;
    els.s_manufacturer.value = f.manufacturer;
    els.s_license.value = f.license;
    els.s_version.value = f.version;
    els.s_vendor.value = f.vendorID;
    els.s_upm.value = f.upm;
    els.s_weight.value = f.weightClass;
    els.s_baseline.value = f.baselineRow;
    els.s_mono.checked = f.monospace;
    els.s_bold.checked = f.bold;
    els.s_italic.checked = f.italic;
    els.dlgSettings.showModal();
  }

  function applySettings() {
    const f = state.project.font;
    f.familyName = els.s_family.value.trim() || 'MyFont';
    f.styleName = els.s_style.value.trim() || 'Regular';
    f.copyright = els.s_copyright.value;
    f.designer = els.s_designer.value;
    f.manufacturer = els.s_manufacturer.value;
    f.license = els.s_license.value;
    f.version = els.s_version.value;
    f.vendorID = els.s_vendor.value.trim().slice(0, 4) || 'VCWK';
    f.upm = +els.s_upm.value;
    f.weightClass = +els.s_weight.value;
    const nb = Math.max(1, Math.min(state.project.grid.h, +els.s_baseline.value || f.baselineRow));
    f.baselineRow = nb;
    f.monospace = els.s_mono.checked;
    f.bold = els.s_bold.checked;
    f.italic = els.s_italic.checked;
    els.fontFamily.value = f.familyName;
    els.dlgSettings.close();
    renderAll();
    scheduleSave();
  }

  /* ============================================================ 导出 TTF */

  function buildContours(g) {
    const f = state.project.font;
    const grid = state.project.grid;
    const scale = f.upm / grid.h;
    const raw = computeContours(g);
    return raw.map(c => c.map(p => ({ x: p.x * scale, y: p.y * scale, on: p.on })));
  }

  /** 构建 FontBuilder（所有格式共用） */
  function makeFontBuilder() {
    const f = state.project.font;
    const grid = state.project.grid;
    const scale = f.upm / grid.h;
    const fb = new TTF.FontBuilder({
      familyName: f.familyName,
      styleName: f.styleName,
      version: f.version,
      copyright: f.copyright,
      designer: f.designer,
      manufacturer: f.manufacturer,
      license: f.license,
      vendorID: f.vendorID,
      upm: f.upm,
      weightClass: f.weightClass,
      bold: f.bold,
      italic: f.italic,
      monospace: f.monospace,
      ascender: Math.round(f.baselineRow * scale),
      descender: -Math.round((grid.h - f.baselineRow) * scale),
    });

    // 空字形也导出（保留 cmap 映射，排版时显示为空白而非缺字方框）
    const glyphList = [...state.glyphs.values()].sort((a, b) => a.code - b.code);
    for (const g of glyphList) {
      fb.addGlyph(g.code, buildContours(g), Math.round(getAdvanceGrid(g) * scale));
    }
    return { fb, glyphList };
  }

  /** BDF 的 DWIDTH 用网格单位（点阵字体的度量就是像素数） */
  function makeBDFString(glyphList) {
    const grid = state.project.grid;
    const f = state.project.font;
    return Exporters.makeBDF(
      glyphList.map(g => ({ code: g.code, bmp: g.bmp, advance: getAdvanceGrid(g) })),
      {
        gridW: grid.w,
        gridH: grid.h,
        baselineRow: f.baselineRow,
        familyName: f.familyName,
        styleName: f.styleName,
        version: f.version,
        copyright: f.copyright,
      }
    );
  }

  /**
   * 导出字体
   * @param {'ttf'|'woff'|'bdf'|'zip'} fmt
   */
  async function exportFont(fmt) {
    const f = state.project.font;
    if (state.glyphs.size === 0) { toast('还没有任何字形'); return; }

    const base = safeFileName(f.familyName) || 'font';
    const { fb, glyphList } = makeFontBuilder();
    const kb = n => (n / 1024).toFixed(1);

    try {
      if (fmt === 'ttf') {
        const ttf = fb.build();
        downloadBlob(ttf, base + '.ttf', 'font/ttf');
        toast(`已导出 ${glyphList.length} 个字形 → ${base}.ttf (${kb(ttf.length)} KB)`);

      } else if (fmt === 'woff') {
        const woff = await fb.buildWOFF();
        downloadBlob(woff, base + '.woff', 'font/woff');
        toast(`已导出 → ${base}.woff (${kb(woff.length)} KB)`);

      } else if (fmt === 'bdf') {
        const bdf = makeBDFString(glyphList);
        downloadBlob(strToBytes(bdf), base + '.bdf', 'text/plain');
        toast(`已导出点阵字体 → ${base}.bdf (${glyphList.length} 字形)`);

      } else if (fmt === 'zip') {
        const ttf = fb.build();
        const woff = await fb.buildWOFF();
        const bdf = makeBDFString(glyphList);
        const withInk = glyphList.filter(g => g.bmp.some(v => v));
        const chars = (withInk.length ? withInk : glyphList).map(g => String.fromCodePoint(g.code));
        const html = Exporters.makePreviewHTML(
          Exporters.bytesToBase64(ttf), 'font/ttf',
          {
            familyName: f.familyName,
            styleName: f.styleName,
            version: f.version,
            copyright: f.copyright,
            glyphCount: glyphList.length,
            upm: f.upm,
          },
          chars
        );
        const readme =
          `${f.familyName} ${f.styleName}\n` +
          `由「字形工坊」生成\n\n` +
          `文件说明：\n` +
          `  ${base}.ttf    TrueType 字体（Windows / macOS / Android / Linux 可安装）\n` +
          `  ${base}.woff   网页字体（CSS @font-face 使用）\n` +
          `  ${base}.bdf    位图点阵字体（嵌入式 / Linux console / 小屏设备）\n` +
          `  preview.html   双击查看字体效果\n\n` +
          `字形数：${glyphList.length}\n` +
          `UPM：${f.upm}\n` +
          `版本：${f.version}\n`;
        const zip = Exporters.makeZip([
          { name: base + '.ttf', data: ttf },
          { name: base + '.woff', data: woff },
          { name: base + '.bdf', data: bdf },
          { name: 'preview.html', data: html },
          { name: 'README.txt', data: readme },
        ]);
        downloadBlob(zip, base + '_fontpack.zip', 'application/zip');
        toast(`已打包 → ${base}_fontpack.zip (${kb(zip.length)} KB)`);
      }
    } catch (e) {
      console.error(e);
      toast('导出失败：' + e.message);
    }
  }

  function exportTTF() { return exportFont('ttf'); }

  function safeFileName(s) {
    return (s || 'font').replace(/[\\/:*?"<>|]/g, '_');
  }

  /** 字节数组 → base64（安卓桥用） */
  function toBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function strToBytes(s) {
    const enc = new TextEncoder();
    return enc.encode(s);
  }

  function downloadBlob(data, name, type) {
    // 安卓：走原生桥（WebView 对 blob: 下载支持差）
    const bridge = window.AndroidBridge;
    if (bridge && bridge.saveFile && !(data instanceof Blob)) {
      bridge.saveFile(name, toBase64(data));
      return;
    }
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  /* ============================================================ 项目保存 */

  function serializeProject() {
    const glyphs = [];
    for (const g of state.glyphs.values()) {
      glyphs.push({
        code: g.code,
        advance: g.advance,
        bmp: Array.from(g.bmp),
      });
    }
    return JSON.stringify({
      version: 1,
      app: 'fontstudio',
      grid: state.project.grid,
      font: state.project.font,
      vec: state.vec,
      glyphs,
    });
  }

  function deserializeProject(json) {
    const obj = JSON.parse(json);
    if (!obj || obj.app !== 'fontstudio') throw new Error('不是有效的项目文件');
    state.project.grid = obj.grid || { w: 64, h: 64 };
    Object.assign(state.project.font, obj.font || {});
    if (obj.vec) state.vec = obj.vec;
    state.glyphs.clear();
    const { w, h } = state.project.grid;
    for (const g of (obj.glyphs || [])) {
      const bmp = new Uint8Array(w * h);
      const n = Math.min(bmp.length, g.bmp.length);
      for (let i = 0; i < n; i++) bmp[i] = g.bmp[i] ? 1 : 0;
      state.glyphs.set(g.code, { code: g.code, bmp, advance: g.advance ?? null });
    }
    state.current = null;
    state.history = [];
    state.future = [];
    // 自动选中第一个字形，避免加载后画布一片空白
    if (state.glyphs.size > 0) {
      state.current = [...state.glyphs.keys()].sort((a, b) => a - b)[0];
    }
  }

  function saveProjectFile() {
    const data = serializeProject();
    const bridge = window.AndroidBridge;
    if (bridge && bridge.saveFile) {
      bridge.saveFile(safeFileName(state.project.font.familyName) + '.fontproj', toBase64(strToBytes(data)));
      toast('项目已保存');
      return;
    }
    downloadBlob(data, safeFileName(state.project.font.familyName) + '.fontproj', 'application/json');
    toast('项目已保存');
  }

  /** 安卓桥回调：接收项目 JSON */
  window._receiveProjectData = function (json) {
    try {
      deserializeProject(json);
      syncGridUI();
      renderAll();
      toast('项目已加载');
    } catch (e) {
      toast('加载失败：' + e.message);
    }
  };

  function loadProjectFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        deserializeProject(reader.result);
        syncGridUI();
        renderAll();
        toast('项目已加载');
      } catch (e) {
        toast('加载失败：' + e.message);
      }
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------- localStorage */

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem('fontstudio_autosave', serializeProject());
        els.saveWarn.classList.remove('show');
      } catch (e) {
        // 存储配额用尽：明确提示，别让用户以为已经存好了
        els.saveWarn.classList.add('show');
      }
    }, 600);
  }

  function loadAutosave() {
    try {
      const s = localStorage.getItem('fontstudio_autosave');
      if (s) deserializeProject(s);
    } catch (e) { /* 忽略损坏的数据 */ }
  }

  /* ============================================================ 网格尺寸 */

  function changeGridSize(n) {
    const old = state.project.grid;
    if (old.w === n && old.h === n) return;
    syncGridUI();

    const hasInk = [...state.glyphs.values()].some(g => g.bmp.some(v => v));
    if (!hasInk) { applyGridSize(n); return; }   // 还没有任何内容，直接换

    askConfirm('更改网格尺寸',
      `网格将从 ${old.w} × ${old.h} 改为 ${n} × ${n}。\n\n` +
      '· 已有字形按左上角对齐迁移，超出新尺寸的部分会被裁掉\n' +
      '· 字宽设置将重置为默认\n' +
      '· 基线行会重新定位',
      () => applyGridSize(n), '继续');
  }

  function applyGridSize(n) {
    const old = state.project.grid;
    for (const g of state.glyphs.values()) {
      const nb = new Uint8Array(n * n);
      const cw = Math.min(old.w, n), chh = Math.min(old.h, n);
      for (let y = 0; y < chh; y++)
        for (let x = 0; x < cw; x++)
          nb[y * n + x] = g.bmp[y * old.w + x];
      g.bmp = nb;
      g.advance = null;
    }
    state.project.grid = { w: n, h: n };
    // 基线按比例映射到新网格
    state.project.font.baselineRow = Math.min(n - 1,
      Math.max(1, Math.round(state.project.font.baselineRow / old.h * n)));
    state.history = [];
    state.future = [];
    syncGridUI();
    fitZoom();
    renderAll();
    scheduleSave();
  }

  function syncGridUI() {
    els.gridSize.value = String(state.project.grid.w);
    els.fontFamily.value = state.project.font.familyName;
  }

  /* ============================================================ 缩放 */

  function fitZoom() {
    const host = els.canvasHost;
    const availW = host.clientWidth - 60;
    const availH = host.clientHeight - 60;
    const { w, h } = state.project.grid;
    state.zoom = Math.max(4, Math.floor(Math.min(availW / w, availH / h)));
  }

  function setZoom(z) {
    state.zoom = Math.max(2, Math.min(80, z));
    renderCanvas();
  }

  /* ============================================================ 渲染总入口 */

  function renderAll() {
    renderCanvas();
    renderGlyphList();
    renderPreview();
  }

  /* ============================================================ 事件绑定 */

  function setTool(t) {
    state.tool = t;
    for (const b of els.toolbar.querySelectorAll('.tool[data-tool]')) {
      b.classList.toggle('active', b.dataset.tool === t);
    }
  }

  function bindEvents() {
    // 顶栏
    els.fontFamily.oninput = () => {
      state.project.font.familyName = els.fontFamily.value.trim() || 'MyFont';
      scheduleSave();
    };
    els.btnSettings.onclick = openSettings;
    els.btnHelp.onclick = () => els.dlgHelp.showModal();
    els.btnHelpClose.onclick = () => els.dlgHelp.close();

    // 更新检查
    $('btnCheckUpd').onclick = () => { toast('正在检查更新…'); checkUpdate(true); };
    $('updClose').onclick = () => $('dlgUpdate').close();
    // 安卓 WebView 里 target=_blank 开不了，走原生桥用系统浏览器打开
    $('updLink').addEventListener('click', (ev) => {
      const url = $('updLink').href;
      if (window.AndroidBridge && window.AndroidBridge.openUrl && /^https?:/.test(url)) {
        ev.preventDefault();
        window.AndroidBridge.openUrl(url);
      }
    });
    els.btnSettingsOk.onclick = applySettings;
    els.btnSettingsCancel.onclick = () => els.dlgSettings.close();
    els.btnSave.onclick = saveProjectFile;
    els.btnLoad.onclick = () => {
      const bridge = window.AndroidBridge;
      if (bridge && bridge.openProject) { bridge.openProject(); return; }
      els.fileProject.click();
    };
    els.fileProject.onchange = e => {
      if (e.target.files[0]) loadProjectFile(e.target.files[0]);
      e.target.value = '';
    };
    // 导出下拉菜单
    const dd = els.btnExport.closest('.dd');
    els.btnExport.onclick = e => {
      e.stopPropagation();
      dd.classList.toggle('open');
    };
    document.addEventListener('click', () => dd.classList.remove('open'));
    for (const b of document.querySelectorAll('#exportMenu button')) {
      b.onclick = e => {
        e.stopPropagation();
        dd.classList.remove('open');
        exportFont(b.dataset.fmt);
      };
    }

    // 添加字符
    els.charInput.onkeydown = e => {
      if (e.key === 'Enter') {
        const codes = parseCharInput(els.charInput.value);
        if (codes.length) {
          addChars(codes);
          if (codes.length === 1) setCurrent(codes[0]);
          els.charInput.value = '';
        }
      }
      e.stopPropagation();
    };
    els.btnPasteBatch.onclick = () => {
      els.batchText.value = '';
      els.batchInfo.textContent = '0 个新字符';
      els.dlgBatch.showModal();
      els.batchText.focus();
    };
    els.batchText.oninput = () => {
      const set = new Set();
      for (const ch of els.batchText.value) {
        const c = ch.codePointAt(0);
        if (c >= 0x20 && !state.glyphs.has(c)) set.add(c);
      }
      els.batchInfo.textContent = `${set.size} 个新字符`;
    };
    els.btnBatchOk.onclick = () => {
      const codes = [];
      for (const ch of els.batchText.value) {
        const c = ch.codePointAt(0);
        if (c >= 0x20) codes.push(c);
      }
      addChars(codes);
      els.dlgBatch.close();
    };
    els.btnBatchCancel.onclick = () => els.dlgBatch.close();

    // 预设
    for (const btn of document.querySelectorAll('.chip[data-preset]')) {
      btn.onclick = () => {
        const codes = PRESETS[btn.dataset.preset] || [];
        const n = addChars(codes);
        toast(n > 0 ? `添加了 ${n} 个字形` : '这些字形已存在');
      };
    }

    // 工具
    for (const b of els.toolbar.querySelectorAll('.tool[data-tool]')) {
      b.onclick = () => setTool(b.dataset.tool);
    }
    els.btnUndo.onclick = undo;
    els.btnRedo.onclick = redo;
    els.btnMirrorH.onclick = () => transformGlyph(mirrorH);
    els.btnMirrorV.onclick = () => transformGlyph(mirrorV);
    els.btnRotate.onclick = () => transformGlyph(rotate90);
    els.btnShiftL.onclick = () => transformGlyph(g => shift(g, -1, 0));
    els.btnShiftR.onclick = () => transformGlyph(g => shift(g, 1, 0));
    els.btnShiftU.onclick = () => transformGlyph(g => shift(g, 0, -1));
    els.btnShiftD.onclick = () => transformGlyph(g => shift(g, 0, 1));
    els.btnCopy.onclick = () => {
      const g = currentGlyph();
      if (!g) return;
      state.clipboard = g.bmp.slice();
      toast('已复制当前字形');
    };
    els.btnPaste.onclick = () => {
      const g = currentGlyph();
      if (!g || !state.clipboard) { toast(state.clipboard ? '请先选择字形' : '剪贴板为空'); return; }
      pushHistory();
      g.bmp = state.clipboard.slice();
      renderAll();
      scheduleSave();
    };
    els.btnClear.onclick = () => {
      const g = currentGlyph();
      if (!g) return;
      pushHistory();
      g.bmp = emptyBitmap();
      renderAll();
      scheduleSave();
    };

    // 缩放
    els.btnZoomIn.onclick = () => setZoom(state.zoom + 4);
    els.btnZoomOut.onclick = () => setZoom(state.zoom - 4);
    els.btnFit.onclick = () => { fitZoom(); renderCanvas(); };

    // 画布（Pointer 事件同时支持鼠标与触摸屏）
    els.cv.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    els.cv.addEventListener('contextmenu', e => e.preventDefault());
    els.canvasHost.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(state.zoom + (e.deltaY < 0 ? 2 : -2));
      }
    }, { passive: false });

    // 网格
    els.gridSize.onchange = () => changeGridSize(+els.gridSize.value);
    els.chkVec.onchange = () => { state.showVec = els.chkVec.checked; renderCanvas(); };
    els.chkGrid.onchange = () => { state.showGrid = els.chkGrid.checked; renderCanvas(); };
    els.chkGuides.onchange = () => { state.showGuides = els.chkGuides.checked; renderCanvas(); };

    // 字宽
    els.advMode.onchange = () => {
      els.advCustomRow.style.display = els.advMode.value === 'custom' ? '' : 'none';
      const g = currentGlyph();
      if (!g) return;
      pushHistory();
      g.advance = els.advMode.value === 'custom' ? (+els.advCustom.value || state.project.grid.w) : null;
      renderAll();
      scheduleSave();
    };
    els.advCustom.onchange = () => {
      const g = currentGlyph();
      if (!g || els.advMode.value !== 'custom') return;
      pushHistory();
      g.advance = +els.advCustom.value || state.project.grid.w;
      renderAll();
      scheduleSave();
    };

    // 矢量化参数
    const vecBind = (input, label, key, fmt) => {
      input.oninput = () => {
        state.vec[key] = +input.value;
        label.textContent = fmt(+input.value);
        renderCanvas();
        renderPreview();
        scheduleSave();
      };
    };
    vecBind(els.vecEps, els.vecEpsV, 'eps', v => v.toFixed(2));
    vecBind(els.vecCorner, els.vecCornerV, 'corner', v => v.toFixed(2));
    vecBind(els.vecMin, els.vecMinV, 'minArea', v => v.toFixed(1));

    // 导入
    els.btnImport.onclick = openImport;
    els.dropZone.onclick = () => els.fileInput.click();
    els.fileInput.onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        imp.imgData = await fileToImageData(f);
        els.dropZone.textContent = f.name;
        updateImportPreview();
      } catch (err) {
        toast(err.message);
      }
      e.target.value = '';
    };
    els.dropZone.ondragover = e => { e.preventDefault(); els.dropZone.classList.add('drag'); };
    els.dropZone.ondragleave = () => els.dropZone.classList.remove('drag');
    els.dropZone.ondrop = async e => {
      e.preventDefault();
      els.dropZone.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) {
        try {
          imp.imgData = await fileToImageData(f);
          els.dropZone.textContent = f.name;
          updateImportPreview();
        } catch (err) { toast(err.message); }
      }
    };
    for (const id of ['im_threshold_mode', 'im_threshold', 'im_invert', 'im_ratio', 'im_blur', 'im_denoise']) {
      els[id].onchange = updateImportPreview;
      els[id].oninput = updateImportPreview;
    }
    els.im_threshold_mode.onchange = () => {
      els.im_threshold.disabled = els.im_threshold_mode.value !== 'manual';
      updateImportPreview();
    };
    els.btnImportOk.onclick = confirmImport;
    els.btnImportCancel.onclick = () => els.dlgImport.close();

    // 快捷键
    window.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      const inField = tag === 'input' || tag === 'textarea' || tag === 'select';

      // Ctrl+S 在任何焦点下都要拦住（否则浏览器会弹"保存网页"）
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveProjectFile();
        return;
      }
      if (inField) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
        else if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redo(); }
        return;
      }
      if (!e.key) return;
      const map = { b: 'pen', e: 'eraser', l: 'line', r: 'rect', o: 'ellipse', f: 'fill', i: 'pick' };
      const k = e.key.toLowerCase();
      if (map[k]) { setTool(map[k]); return; }
      const g = currentGlyph();
      if (!g) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); transformGlyph(gg => shift(gg, -1, 0)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); transformGlyph(gg => shift(gg, 1, 0)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); transformGlyph(gg => shift(gg, 0, -1)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); transformGlyph(gg => shift(gg, 0, 1)); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        pushHistory();
        g.bmp = emptyBitmap();
        renderAll();
        scheduleSave();
      }
    });

    window.addEventListener('resize', () => { fitZoom(); renderAll(); });

    // 移动端底部导航（面板互斥切换）
    const navBtns = document.querySelectorAll('.mobile-nav button');
    for (const b of navBtns) {
      b.addEventListener('click', () => {
        document.body.dataset.panel = b.dataset.panel;
        for (const x of navBtns) x.classList.toggle('active', x === b);
        if (b.dataset.panel === 'canvas') { fitZoom(); renderAll(); }
        else if (b.dataset.panel === 'right') { renderPreview(); }  // 面板刚从 display:none 恢复，尺寸才有值
      });
    }
  }

  /* ============================================================ 启动 */

  function init() {
    // 只有真正首次使用（没有任何存档）才预置示例字形；
    // 用户把字形删光后重启，不应该又冒出 A/B/C
    const isFirstRun = !localStorage.getItem('fontstudio_autosave');
    loadAutosave();

    if (isFirstRun && state.glyphs.size === 0) {
      addChars([0x41, 0x42, 0x43], true);
      state.current = 0x41;
    } else if (state.current == null && state.glyphs.size > 0) {
      state.current = [...state.glyphs.keys()].sort((a, b) => a - b)[0];
    }

    syncGridUI();
    syncCurrentUI();
    fitZoom();
    bindEvents();
    setTool('pen');
    renderAll();
    // 启动后延迟静默检查一次更新（失败不打扰）
    setTimeout(() => checkUpdate(false), 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
