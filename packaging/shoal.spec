# PyInstaller spec of the Shoal desktop app. Built by packaging/build_app.py (do not call PyInstaller directly).
#
# The bundle mirrors the repository layout for the files the backend reads at run time, so shoal.config
# only has to point REPO at the bundle: frontend/dist, frontend/src/primer/content, kernel/install
# (gotm + kernel.json) and kernel/src/gotm-cases/nns_annual (the offline demo case).
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

REPO = Path(SPECPATH).resolve().parent
sys.path.insert(0, str(REPO / "backend"))
from shoal.version import __version__  # noqa: E402

WINDOWS = os.name == "nt"
MACOS = sys.platform == "darwin"
gotm = REPO / "kernel" / "install" / "bin" / ("gotm.exe" if WINDOWS else "gotm")

datas = [
    (str(REPO / "frontend" / "dist"), "frontend/dist"),
    (str(REPO / "frontend" / "src" / "primer" / "content"), "frontend/src/primer/content"),
    (str(REPO / "kernel" / "src" / "gotm-cases" / "nns_annual"), "kernel/src/gotm-cases/nns_annual"),
]
datas += collect_data_files("shoal")  # site templates, data tables, tray icon
datas += collect_data_files("pyfabm")
binaries = collect_dynamic_libs("pyfabm")

if MACOS:
    # gotm and its own relinked libraries are copied into Shoal.app after PyInstaller has finished
    # (packaging/build_app.py: bundle_kernel_macos). PyInstaller treats every Mach-O file, even in datas,
    # as a library and de-duplicates by file name, which would pair gotm's libnetcdff with the netCDF4
    # wheel's libnetcdf (a different build: missing symbols).
    pass
else:
    # Windows / Linux: gotm as a binary, so PyInstaller collects its NetCDF and gfortran libraries next to it
    datas += [(str(REPO / "kernel" / "install" / "kernel.json"), "kernel/install")]
    binaries += [(str(gotm), "kernel/install/bin")]

hiddenimports = collect_submodules("shoal") + collect_submodules("uvicorn") + collect_submodules("pyfabm")
hiddenimports += ["netCDF4", "cftime", "websockets", "ruamel.yaml", "psutil", "httpx", "openai", "yaml"]
hiddenimports += ["pystray._darwin"] if MACOS else ["pystray._win32"] if WINDOWS else ["pystray._xorg"]

a = Analysis(
    [str(REPO / "packaging" / "launcher.py")],
    pathex=[str(REPO / "backend")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "matplotlib", "IPython", "jupyter", "pytest", "PyQt5", "PyQt6", "PySide6"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    # UTF-8 mode, like PYTHONUTF8=1 for a source checkout (a frozen app ignores that variable). Without it,
    # Windows reads and writes text files in the locale code page and fails on Chinese text.
    [("X utf8", None, "OPTION")],
    exclude_binaries=True,
    name="Shoal",
    console=False,  # no terminal window; logs go to the user data folder (logs/shoal.log)
    icon=str(REPO / "packaging" / "icons" / ("Shoal.ico" if WINDOWS else "Shoal.icns")),
    version=None,
)
coll = COLLECT(exe, a.binaries, a.datas, name="Shoal")

if MACOS:
    app = BUNDLE(
        coll,
        name="Shoal.app",
        icon=str(REPO / "packaging" / "icons" / "Shoal.icns"),
        bundle_identifier="io.github.lycself.shoal",
        version=__version__,
        info_plist={
            "CFBundleName": "Shoal",
            "CFBundleDisplayName": "Shoal",
            "CFBundleShortVersionString": __version__,
            "CFBundleVersion": __version__,
            "LSUIElement": True,  # lives in the menu bar, no Dock icon; the work happens in the browser
            "LSMinimumSystemVersion": "12.0",
            "NSHighResolutionCapable": True,
            "NSHumanReadableCopyright": "Includes GOTM, FABM, ERSEM, FABM-MIZER (GPL) and ECOSMO E2E v2.0 (CC BY 4.0)",
        },
    )
