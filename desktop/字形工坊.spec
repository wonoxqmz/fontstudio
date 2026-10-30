# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['E:/字体设计/desktop/main.py'],
    pathex=[],
    binaries=[],
    datas=[('E:/字体设计/index.html', '.'), ('E:/字体设计/js', 'js'), ('E:/字体设计/css', 'css')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='字形工坊',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
