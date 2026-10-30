"""开发用：校验生成的 TTF 是否为合法字体，并用 FreeType 实际渲染。

用法: python tools/verify.py <font.ttf> [out.png]
"""
import struct
import sys
import os
import tempfile

from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen


def file_checksum_ok(path):
    data = bytearray(open(path, 'rb').read())
    num_tables = struct.unpack('>H', bytes(data[4:6]))[0]
    head_off = None
    for i in range(num_tables):
        off = 12 + i * 16
        if data[off:off + 4] == b'head':
            head_off = struct.unpack('>I', bytes(data[off + 8:off + 12]))[0]
    if head_off is None:
        return False, 'no head table'
    adj = struct.unpack('>I', bytes(data[head_off + 8:head_off + 12]))[0]
    buf = bytearray(data)
    buf[head_off + 8:head_off + 12] = b'\x00\x00\x00\x00'
    while len(buf) % 4:
        buf.append(0)
    s = 0
    for i in range(0, len(buf), 4):
        s = (s + struct.unpack('>I', bytes(buf[i:i + 4]))[0]) & 0xFFFFFFFF
    expected = (0xB1B0AFBA - s) & 0xFFFFFFFF
    return expected == adj, f'expected={expected:#010x} stored={adj:#010x}'


def main():
    path = sys.argv[1]
    out_png = sys.argv[2] if len(sys.argv) > 2 else None

    print('=' * 62)
    print('字体:', path, f'({os.path.getsize(path)} bytes)')
    print('=' * 62)

    ok, msg = file_checksum_ok(path)
    print(f'[{"OK " if ok else "FAIL"}] head.checkSumAdjustment  {msg}')

    f = TTFont(path)
    print('[OK ] 表:', ' '.join(sorted(f.keys())))

    required = ['head', 'hhea', 'hmtx', 'maxp', 'cmap', 'glyf', 'loca', 'name', 'OS/2', 'post']
    missing = [t for t in required if t not in f]
    print(f'[{"OK " if not missing else "FAIL"}] 必需表齐全' + (f' 缺失: {missing}' if missing else ''))

    upm = f['head'].unitsPerEm
    print(f'      unitsPerEm={upm}  numGlyphs={f["maxp"].numGlyphs}')
    print(f'      ascender={f["hhea"].ascender} descender={f["hhea"].descender}')

    cmap = f.getBestCmap()
    print(f'[OK ] cmap 条目 {len(cmap)} 个:', ', '.join(f'{chr(c)} U+{c:04X}->{g}' for c, g in sorted(cmap.items())))

    print('-' * 62)
    print('字形轮廓（首点 / 点数量 / 有符号面积）:')
    gs = f.getGlyphSet()
    for name in f.getGlyphOrder():
        pen = RecordingPen()
        gs[name].draw(pen)
        npts = 0
        area = 0.0
        for op, args in pen.value:
            if op in ('lineTo', 'qCurveTo', 'curveTo'):
                npts += len(args)
        try:
            from fontTools.pens.areaPen import AreaPen
            ap = AreaPen(gs)
            gs[name].draw(ap)
            area = ap.value
        except Exception:
            pass
        hmtx = f['hmtx'][name]
        print(f'  {name:<10} adv={hmtx[0]:<6} lsb={hmtx[1]:<6} 顶点={npts:<4} 面积={area:>10.1f}')

    print('-' * 62)
    try:
        rt = os.path.join(tempfile.gettempdir(), '_rt.ttf')
        f.save(rt)
        TTFont(rt)
        print('[OK ] fontTools 往返读写正常')
    except Exception as e:
        print('[FAIL] 往返读写:', e)

    # FreeType 实际渲染
    if out_png:
        try:
            from PIL import Image, ImageDraw, ImageFont
            chars = ''.join(chr(c) for c in sorted(cmap.keys()))
            font = ImageFont.truetype(path, 72)
            W, H = 60 * max(1, len(chars)) + 20, 110
            img = Image.new('L', (W, H), 255)
            d = ImageDraw.Draw(img)
            d.text((10, 5), chars, font=font, fill=0)
            # 参考线
            for i, ch in enumerate(chars):
                d.rectangle([10 + i * 60, 5, 10 + i * 60 + 59, 105], outline=210)
            img.save(out_png)
            print('[OK ] FreeType 渲染成功 ->', out_png)
        except Exception as e:
            print('[FAIL] FreeType 渲染:', type(e).__name__, e)

    print('=' * 62)


if __name__ == '__main__':
    main()
