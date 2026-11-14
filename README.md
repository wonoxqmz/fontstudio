# 字形工坊（Font Studio）

一款本地运行的通用字体设计器：选 Unicode 码位 → 手绘 / 导入图片 / **导入现成字体** → 自动矢量化 → 导出 TTF 字体。高分辨率网格绘制，输出是平滑矢量轮廓，不是马赛克像素块。

> 当前版本 v0.1.5 —— 三端齐发：网页版 / Windows exe / Android APK（共用同一套 JS 内核）
>
> Gitee 仓库：https://gitee.com/i-dont-want-to-pick-a-name/fontstudio
> 下载页（Cloudflare Worker）：https://fontstudio.3772387377.workers.dev/

## 三端

| 端 | 位置 | 说明 |
| --- | --- | --- |
| 网页版 | `index.html` 双击即用 | Chrome / Edge 等现代浏览器，无需服务器 |
| Windows | `desktop/dist/字形工坊.exe` | pywebview 薄壳（Edge WebView2），单文件 7.9MB，免安装 |
| Android | `android/FontStudio-v0.1.5.apk` | WebView 壳，minSdk 19；建议 Android 5+ 并保持系统 WebView 较新 |

三端共用 `index.html + js/ + css/` 这一套内核：改一处三端同步。安卓端通过
`AndroidBridge` 原生桥实现文件保存（SAF 免权限）与项目打开；Windows 端下载走
浏览器下载流程。

## 功能

- **Unicode 字形编辑**：支持单字符（`中`）、码位（`U+4E2D`）两种输入方式；支持粘贴一段文本批量提取字符；内置 ASCII / 常用标点 / 数字 / 常用汉字预设
- **自由绘制**：画笔、橡皮、直线、矩形、椭圆、油漆桶、吸管；镜像 / 翻转 / 旋转 / 平移；复制粘贴字形；多级撤销重做
- **图片导入**：自动去白底（亮度阈值 / Otsu 自动阈值）、反色、保持比例、轻微模糊、去噪，一键把图片转成字形
- **字体导入**（顶栏「⤓ 导入字体」）：直接加载现成字体文件继续改——
  - 支持 `.ttf` / `.ttc`（取第一个字体）/ `.woff` / `.bdf` 点阵
  - TrueType 轮廓（含复合字形）自动栅格化到画布网格，扫描线填充带 3×3 超采样抗锯齿
  - 可选导入范围（全部 / ASCII / 自定义字符）、数量上限、网格尺寸、是否覆盖已有字形
  - 自动沿用源字体的 UPM、基线比例、家族名 / 版权等元数据；字宽从 hmtx / DWIDTH 读入
- **矢量内核**：位图自动矢量化（8 连通轮廓追踪 + Douglas-Peucker 简化 + 可选顶角圆滑），画布实时叠加矢量轮廓预览，矢量锚点符合 TrueType 规范（外轮廓顺时针、内孔逆时针）
- **字体参数**：家族名 / 样式名 / 版权 / 设计者 / UPM（1000-2048）/ 字重 / 基线行 / 等宽标记等全套元数据
- **网格尺寸**：8×8 到 128×128，默认 64×64 —— 网格越细，矢量化后的字形越平滑；16 以下的粗网格适合点阵风字体
- **导出**（右上「导出 ▾」菜单）：
  - `.ttf` 标准 TrueType 字体，Windows / macOS / Android / Linux 可直接安装
  - `.woff` 网页字体（浏览器内置 zlib 压缩，@font-face 使用）
  - `.bdf` 位图点阵字体（嵌入式 / Linux console / 超小屏设备通用）
  - `.zip` 全套打包：TTF + WOFF + BDF + 双击即看的字体预览页 + 说明
  - `.fontproj` 项目文件（JSON），随时保存/继续编辑
- **自动保存**：编辑内容实时存入浏览器 localStorage，误关不丢；保存失败会在顶部给出提示条
- **更新检查**：启动时静默检查一次，设置面板里也有「检查更新」按钮；发现新版本会弹窗附下载链接。检查走三条源自动兜底：**Gitee API（国内首选）→ GitHub API → Cloudflare Worker**，任一可用即可
- **快捷键**：工具栏「?」可查全部快捷键；Ctrl+Z / Ctrl+Y 撤销重做、Ctrl+S 保存项目、数字键切工具

## 发布与更新链路

```
源码仓库        Gitee  fontstudio（主）           GitHub  fontstudio（镜像）
安装包          Gitee Releases 附件               GitHub Releases 副本
版本清单        Gitee 仓库根目录 version.json（客户端读它）
客户端检查      Gitee API → GitHub API → Cloudflare Worker（依次兜底）
下载页/网关     Cloudflare Worker: fontstudio.<子域>.workers.dev
                /version.json 代理 Gitee 版本清单（加 CORS，境外可用）
                /apk /exe     302 到对应安装包
                /             简易下载页
```

发新版流程：

1. 改 `js/app.js` 里的 `APP_VERSION` 与 `android/build.sh` 的版本号，打包 APK / exe
2. 上传到 Gitee Releases（`tools/gitee_release.py`）
3. 把仓库根目录 `version.json` 的 `version` / `notes` / 两个 URL 改成新版本，git push
4. 客户端下次启动即提示更新（Worker 与 GitHub 镜像无需改动）

## 目录结构

```
字体设计/
├── index.html          # 主程序（双击即可运行，无需服务器）
├── css/style.css
├── js/
│   ├── vectorize.js    # 位图矢量化内核（轮廓追踪 / 简化 / 圆滑 / 图片二值化）
│   ├── ttf.js          # TrueType + WOFF 生成内核（纯 JS，零依赖）
│   ├── exporters.js    # BDF 点阵 / ZIP 打包 / 字体预览页生成
│   ├── fontimport.js   # 字体导入内核（TTF/TTC/WOFF/BDF 解析 → 栅格化到网格）
│   └── app.js          # UI 逻辑
├── desktop/
│   ├── main.py         # Windows 壳入口（pywebview）
│   └── dist/字形工坊.exe
├── android/
│   ├── AndroidManifest.xml
│   ├── src/com/lcj/fontstudio/MainActivity.java   # WebView 壳 + SAF 文件桥
│   ├── build.sh        # 无 Gradle 构建（aapt2/javac/d8/zipalign/apksigner）
│   └── FontStudio-v0.1.apk
├── tools/              # 开发工具（不影响使用）
│   ├── build-test.js   # 无头生成测试字体
│   ├── verify.py       # fontTools + FreeType 校验与渲染
│   ├── verify-formats.py # WOFF / BDF / ZIP 产物校验
│   ├── e2e.js          # 主流程端到端（绘制 / 批量添加 / 导出 / 存项目）
│   ├── e2e3.js         # 四格式导出
│   ├── e2e-mobile.js   # 移动端 400×780 触摸绘制与面板切换
│   ├── e2e-fixes.js    # 回归用例（确认框 / 删除选中 / 跨字形撤销 / 断笔 / 中文名 / 帮助）
│   ├── e2e-update.js   # 更新检查流程（mock 版本号 / 弹窗 / 手动检查）
│   ├── e2e-update-live.js # 更新检查真实网络验证（Gitee 线上源）
│   ├── e2e-fontimport.js  # 字体导入全流程（TTF/BDF/覆盖开关/自定义范围/再导出）
│   ├── test-fontimport.js # 导入内核单测（含真实系统字体）
│   └── shot.js         # 通用网页截图工具
└── _build/             # 测试产物输出目录
```

## 重新打包

```bash
# Windows exe（需 pywebview + pyinstaller；用 spec 才能带上 index.html / js / css）
cd 字体设计 && pyinstaller --noconfirm \
  --distpath "E:/字体设计/desktop/dist" --workpath "E:/字体设计/desktop/build" \
  "E:/字体设计/desktop/字形工坊.spec"

# Android APK（需 Android SDK，详见 android/build.sh）
cd android && bash build.sh
```

> 打包前若 `desktop/dist/字形工坊.exe` 已存在，先手动删掉再跑，否则可能因文件占用/删除被拦而失败。

## 使用

1. 双击 `index.html`（Chrome / Edge 等现代浏览器）
2. 左栏添加字符（输入字符回车，或点预设批量加）
3. 中间画布用画笔绘制，或右栏「导入图片」自动转字形
4. 右上「导出 ▾」选择格式：TTF / WOFF / BDF / ZIP 全套（含预览页），字体文件右键安装即可使用

## 技术说明

- TrueType / WOFF / BDF / ZIP 生成完全自研零依赖：手写 sfnt 表结构（head / hhea / hmtx / maxp / cmap4+12 / glyf / loca / name / OS/2 / post），坐标 delta 编码带 flags 压缩，输出经过 fontTools 解析与 FreeType 实际渲染双重验证
- 轮廓追踪用「像素边缘有向边 + 歧义点左转」算法，天然保证 8 连通语义，对角相连的笔画会合并为一个轮廓
- 导出的字体中未绘制的字形保留 cmap 映射（显示为空白，而不是缺字方框），方便分阶段设计字库

## 免责声明 / 状态

- 本项目是个人练手作品，功能持续迭代中
- 图片导入的二值化效果取决于源图质量，复杂图片建议先在画图软件里清理
- 导入的图片请确认你有权使用，字体设计器不负责版权判断

## 联系

LCJ · 3772387377@qq.com

## 更新日志

### v0.1.5 (2026-11-14) —— 导入现成字体
- 新增「⤓ 导入字体」：加载 `.ttf` / `.ttc` / `.woff` / `.bdf` 现成字体文件，把字形栅格化到画布网格后继续编辑
- TrueType 轮廓解码支持简单字形 + 复合字形（递归展开组件与 2×2 变换矩阵），cmap 支持 format 4 / 12 / 6 / 0
- 扫描线非零环绕填充 + 3×3 超采样，导入的字形边缘平滑；基线按源字体 ascender/descender 比例自动落位
- 导入选项：全部字符 / ASCII / 自定义字符、数量上限（默认 300，防大字库卡顿）、画布网格、覆盖已有字形开关
- 自动沿用源字体元数据（家族名 / 版权 / 设计者 / UPM 等），字宽从 hmtx 读入
- 真实字体验证：Arial（复合字形）、SimHei（中文渲染正确）、Microsoft YaHei（.ttc 集合）均通过；自研字体导出→导入往返 7/7 位图完全一致
- GitHub 镜像迁移到新账号

### v0.1.4 (2026-10-30) —— 托管迁移到国内（Gitee + Cloudflare）
- 源码与安装包迁移到 Gitee：仓库、Release 附件均可在国内直连下载；GitHub 保留为镜像
- 更新检查改为三源兜底：Gitee OpenAPI（`Access-Control-Allow-Origin: *`，匿名可读、国内快）→ GitHub API → Cloudflare Worker，某一源失败自动换下一个
- 部署 Cloudflare Worker 作为下载网关：`/version.json` 代理 Gitee 版本清单并补 CORS，`/apk` `/exe` 302 跳转安装包，`/` 提供下载页
- 版本清单唯一来源改为 Gitee 仓库根目录 `version.json`，发版只需改这一个文件

### v0.1.3 (2026-10-18) —— 更新检查
- 新增更新检查：启动 4 秒后静默查一次 `version.json`（GitHub raw），有新版弹窗提示并附下载链接；设置面板里有「检查更新」按钮可手动查
- 更新包（APK / exe）托管在 GitHub Releases，`version.json` 放在仓库根目录，发新版只需改版本号 + 传附件
- 安卓壳新增 `AndroidBridge.openUrl()`：点「去下载」用系统浏览器打开；并放开 file:// 页面的网络访问权限以便检查更新
- 网页版 / exe 检查失败（无网、超时）静默跳过，手动检查时给出提示

### v0.1.2 (2026-10-18) —— 定位调整：通用字体设计器
- 产品定位从「像素字体设计器」改为「通用字体设计器」，相关文案同步更新
- 默认网格 16×16 → 64×64：画布分辨率大幅提高，绘制出的字形经矢量化后是平滑轮廓，不再是马赛克像素块；新增 96×96、128×128 档位
- 切换网格尺寸时基线按比例映射（原来固定 n-2），不同尺寸间字形观感一致
- 大网格（>32）下网格线自动变淡、加深参考线改每 8 格，画布更接近普通绘图软件而不是点阵编辑器
- 端到端测试改为动态读取当前网格尺寸，不再硬编码 16

### v0.1.1 (2026-10-18) —— 打磨与健壮性
**导出正确性**
- 中文字体名不再导致导出失败：PostScript 名自动剔除非法字符，全中文时回退为哈希生成的合法名（`FontXXXXXX`）
- name 表只在内容为纯 ASCII 时才写 Mac/ASCII 平台记录，避免非 ASCII 被写坏
- OS/2 的 `usFirstCharIndex` / `usLastCharIndex` 按规范钳制到 uint16 范围，扩展区码位（>U+FFFF）不再溢出

**交互与容错**
- 确认弹窗改为自绘 `<dialog>`（WebView 里 `window.confirm` 是哑的，安卓端点删除原本没反应）
- 删除字形后自动选中相邻字形，不会掉进"空选中"状态
- 撤销/重做跨字形时自动切到被改动的那个字形，改动看得见
- 拖出画布会自动断笔，回到画布不再拉出一条穿屏长直线
- 网格尺寸切换后，网格下拉框与状态栏同步刷新
- 自动保存失败时顶部弹出提示条，不再静默丢数据
- 首次运行才放 A/B/C 示例字形；删光后重启不会复活
- Ctrl+S 在任何焦点下都生效（含输入框内）
- 空字库时画布显示引导文案，不再是一片白
- 新增「?」快捷键帮助弹窗

**移动端**
- 绘制改用 Pointer 事件 + `touch-action: none`，手指跟手不误触
- 切到属性面板时立即重绘预览，不用等下一次编辑
- 触摸设备上字形删除按钮常驻显示（没有 hover）
- 安卓壳补 `WebChromeClient`，返回键优先关闭打开中的弹窗

**测试**
- 新增回归用例 `tools/e2e-fixes.js`：确认框 / 删除后选中 / 跨字形撤销 / 断笔 / 中文名导出 / 空状态 / 帮助弹窗，共 13 项断言全部通过
- 字体产物复核：fontTools 解析 + FreeType 渲染、WOFF 解包回 TTF 字节一致、BDF 位图行宽对齐 BBX、ZIP 完整性与预览页渲染

### v0.1 (2026-10-16)
- 首个可用版本：像素编辑器 + 图片导入 + 矢量化 + 多格式导出（TTF/WOFF/BDF/ZIP）+ 项目保存/加载
- 三端齐发：网页版 / Windows exe（pywebview）/ Android APK（WebView + SAF 文件桥）
- 矢量化输出经 fontTools 解析 + FreeType 实际渲染双重验证
- 移动端响应式适配：窄屏三面板互斥切换（底部导航）、画布支持触摸绘制（Pointer 事件 + touch-action）、弹窗防溢出
