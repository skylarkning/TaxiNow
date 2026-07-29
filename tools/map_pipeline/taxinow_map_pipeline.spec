# Build from tools/map_pipeline with:
#   pyinstaller --clean taxinow_map_pipeline.spec
from PyInstaller.utils.hooks import collect_submodules

a = Analysis(
    ["taxinow_map_pipeline.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=collect_submodules("encodings"),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="taxinow-map-pipeline",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    # The desktop host redirects stdin/stdout and starts the process without a
    # window. Keep console streams in the binary for the JSON-lines protocol.
    console=True,
)
