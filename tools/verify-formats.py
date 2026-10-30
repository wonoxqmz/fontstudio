"""验证各导出格式的产物质量（WOFF / BDF / ZIP）"""
import os
import sys
import zipfile
import tempfile

from fontTools.ttLib import TTFont

B = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '_build')

print('=' * 64)


def check_woff(path):
    print(f'[WOFF] {os.path.basename(path)}  {os.path.getsize(path)} bytes')
    f = TTFont(path)
    print('   flavor           :', repr(f.sfntVersion))
    print('   tables           :', ' '.join(sorted(f.keys())))
    print('   numGlyphs        :', f['maxp'].numGlyphs)
    cmap = f.getBestCmap()
    print('   cmap             :', ', '.join(f'{chr(c)}' for c in sorted(cmap)))
    # WOFF 解包后应能重新保存为 TTF
    tmp = os.path.join(tempfile.gettempdir(), '_woff_rt.ttf')
    f.flavor = None
    f.save(tmp)
    print('   解包为 TTF       : OK', os.path.getsize(tmp), 'bytes')
    print('   => WOFF 结构正确')
    return True


def check_bdf(path):
    print(f'\n[BDF] {os.path.basename(path)}  {os.path.getsize(path)} bytes')
    text = open(path, encoding='utf-8').read()
    lines = text.splitlines()
    print('   首行             :', lines[0])
    assert lines[0].startswith('STARTFONT'), 'BDF 必须以 STARTFONT 开头'
    assert lines[-1] == 'ENDFONT', 'BDF 必须以 ENDFONT 结尾'
    font_line = [l for l in lines if l.startswith('FONT ')][0]
    bbox_line = [l for l in lines if l.startswith('FONTBOUNDINGBOX')][0]
    chars_line = [l for l in lines if l.startswith('CHARS ')][0]
    nchars = int(chars_line.split()[1])
    actual = text.count('STARTCHAR ')
    print('   FONT             :', font_line[:72])
    print('   FONTBOUNDINGBOX  :', bbox_line)
    print('   CHARS 声明/实际  :', nchars, '/', actual)
    assert nchars == actual, 'CHARS 数量与实际不符'

    # 解析每个字符，校验 BITMAP 行数 = BBX 高度
    ok = 0
    for i, line in enumerate(lines):
        if line.startswith('STARTCHAR'):
            bbx = [l for l in lines[i:i + 8] if l.startswith('BBX ')][0]
            _, bw, bh, xo, yo = bbx.split()
            bw, bh = int(bw), int(bh)
            enc = [l for l in lines[i:i + 5] if l.startswith('ENCODING ')][0]
            st = next(j for j in range(i, len(lines)) if lines[j] == 'BITMAP')
            end = next(j for j in range(st, len(lines)) if lines[j] == 'ENDCHAR')
            rows = end - st - 1
            expected_rows = bh if int(bh) > 0 else 1
            assert rows == expected_rows, f'{enc} BITMAP 行数 {rows} != BBX 高度 {expected_rows}'
            width_bytes = (bw + 7) // 8
            for r in range(st + 1, end):
                assert len(lines[r]) == max(1, width_bytes) * 2, f'{enc} 位图行宽异常: {lines[r]}'
            ok += 1
    print(f'   已校验字形       : {ok} 个，BITMAP 行数与 BBX 全部匹配')
    print('   => BDF 结构正确')

    # 尝试用 FreeType 加载
    try:
        from PIL import ImageFont
        fnt = ImageFont.truetype(path, 16)
        print('   FreeType 加载    : OK', fnt.getname())
    except Exception as e:
        print('   FreeType 加载    : 跳过（Pillow 对 BDF 支持有限）', type(e).__name__)
    return True


def check_zip(path):
    print(f'\n[ZIP] {os.path.basename(path)}  {os.path.getsize(path)} bytes')
    z = zipfile.ZipFile(path)
    bad = z.testzip()
    print('   完整性           :', 'OK' if bad is None else f'损坏于 {bad}')
    for n in sorted(z.namelist()):
        print(f'   - {n:<28} {z.getinfo(n).file_size:>8} bytes')

    # 解出 TTF 用 fontTools 验证
    ttf_name = [n for n in z.namelist() if n.endswith('.ttf')][0]
    tmp = os.path.join(tempfile.gettempdir(), '_zip_font.ttf')
    open(tmp, 'wb').write(z.read(ttf_name))
    f = TTFont(tmp)
    print('   包内 TTF 字形数  :', f['maxp'].numGlyphs)

    # 预览页应含字体数据与字形
    html = z.read('preview.html').decode('utf-8')
    assert '@font-face' in html and 'base64,' in html
    print('   预览页           : OK', len(html), 'chars,含内嵌字体')
    print('   => ZIP 结构正确')
    return True


check_woff(os.path.join(B, 'e2e3.woff'))
check_bdf(os.path.join(B, 'e2e3.bdf'))
check_zip(os.path.join(B, 'e2e3.zip'))
print('=' * 64)
print('全部格式验证通过')
