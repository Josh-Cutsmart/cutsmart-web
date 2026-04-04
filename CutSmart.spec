# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['main_pyside.py'],
    pathex=['src'],
    binaries=[],
    datas=[('C:\\Users\\PC\\Documents\\CutSmart\\Cutsmart_1.0\\secret', 'secret'), ('C:\\Users\\PC\\Documents\\CutSmart\\Cutsmart_1.0\\src\\cutsmart\\qtui\\assets', 'cutsmart\\qtui\\assets'), ('C:\\Users\\PC\\Documents\\CutSmart\\Cutsmart_1.0\\src\\cutsmart\\qtui\\assets', 'src\\cutsmart\\qtui\\assets')],
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
    [],
    exclude_binaries=True,
    name='CutSmart',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['C:\\Users\\PC\\Documents\\CutSmart\\Cutsmart_1.0\\src\\cutsmart\\local_data\\app_icon\\icon.ico'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='CutSmart',
)
