"""Build the Shoal desktop app and its installer for the current OS.

    node scripts/venv.mjs packaging/build_app.py [--platform macos-arm64|macos-x64|windows-x64|linux-x64]

Needs: the kernel built (`pnpm kernel`), the frontend built (`pnpm build`), and packaging/requirements.txt
installed into .venv. Produces in dist/release/:

    macOS    Shoal-<version>-macos-<arch>.dmg          (Shoal.app + a link to Applications)
    Windows  Shoal-<version>-windows-x64-setup.exe     (Inno Setup, per-user install, no admin rights)
    Linux    Shoal-<version>-linux-x64.tar.gz          (folder Shoal/ with the Shoal executable)

and dist/app-executable.txt with the path of the built launcher (for scripts/smoke_test.py --app).
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DIST = REPO / "dist"
RELEASE = DIST / "release"
sys.path.insert(0, str(REPO / "backend"))
from shoal.desktop.updater import platform_key  # noqa: E402
from shoal.version import __version__  # noqa: E402

WINDOWS = os.name == "nt"
MACOS = sys.platform == "darwin"


def run(cmd: list, **kw) -> None:
    print(">>", " ".join(str(c) for c in cmd), flush=True)
    subprocess.check_call([str(c) for c in cmd], **kw)


def preflight() -> None:
    ref = os.environ.get("GITHUB_REF_NAME", "")
    if os.environ.get("GITHUB_REF_TYPE") == "tag" and ref != f"v{__version__}":
        sys.exit(f"!! tag {ref} does not match backend/shoal/version.py ({__version__})")
    gotm = REPO / "kernel" / "install" / "bin" / ("gotm.exe" if WINDOWS else "gotm")
    for need, hint in [(gotm, "pnpm kernel"), (REPO / "kernel" / "install" / "kernel.json", "pnpm kernel"),
                       (REPO / "frontend" / "dist" / "index.html", "pnpm build"),
                       (REPO / "kernel" / "src" / "gotm-cases" / "nns_annual" / "gotm.yaml", "pnpm kernel")]:
        if not need.exists():
            sys.exit(f"!! missing {need.relative_to(REPO)} (run: {hint})")
    import importlib.util

    # only check that they are installed: importing pystray on Linux already needs an X display
    needed = ["pyfabm", "PyInstaller", "pystray", "PIL"] + (["delocate"] if MACOS else [])
    missing = [m for m in needed if importlib.util.find_spec(m) is None]
    if missing:
        sys.exit(f"!! missing {', '.join(missing)}. Install: python -m pip install -r packaging/requirements.txt")


def bundle_kernel_macos() -> Path:
    """gotm plus its own copies of the Homebrew libraries it links, relinked to @loader_path/../lib.

    Kept away from PyInstaller on purpose (it is copied into Shoal.app afterwards): the netCDF4 wheel ships a
    different build of libnetcdf.22.dylib, and PyInstaller, which de-duplicates libraries by file name, would
    otherwise link gotm's libnetcdff against that one (missing symbols at run time).
    """
    from delocate.delocating import delocate_path

    out = REPO / "build" / "kernel-bundle"
    shutil.rmtree(out, ignore_errors=True)
    (out / "bin").mkdir(parents=True)
    shutil.copy2(REPO / "kernel" / "install" / "bin" / "gotm", out / "bin" / "gotm")
    shutil.copy2(REPO / "kernel" / "install" / "kernel.json", out / "kernel.json")
    delocate_path(str(out / "bin"), str(out / "lib"), sanitize_rpaths=True)
    for f in [out / "bin" / "gotm", *sorted((out / "lib").glob("*.dylib"))]:
        run(["codesign", "--force", "--sign", "-", f])  # ad-hoc: Apple Silicon refuses unsigned code
    check = subprocess.run([out / "bin" / "gotm", "--version"], capture_output=True, text=True,
                           env={"PATH": "/usr/bin:/bin"})
    if "GOTM" not in check.stdout + check.stderr:
        sys.exit("!! relinked gotm does not start:\n" + check.stdout + check.stderr)
    return out


def pyinstaller() -> Path:
    shutil.rmtree(DIST / "Shoal", ignore_errors=True)
    shutil.rmtree(DIST / "Shoal.app", ignore_errors=True)
    kernel = bundle_kernel_macos() if MACOS else None
    run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--log-level", "WARN",
         "--distpath", DIST, "--workpath", REPO / "build" / "pyinstaller", REPO / "packaging" / "shoal.spec"])
    if MACOS:
        app = DIST / "Shoal.app"
        # sys._MEIPASS of a PyInstaller .app is Contents/Frameworks; shoal.config looks for kernel/install there
        shutil.copytree(kernel, app / "Contents" / "Frameworks" / "kernel" / "install", symlinks=True)
        run(["codesign", "--force", "--deep", "--sign", "-", app])  # re-seal the bundle with the added files
        run(["codesign", "--verify", "--deep", "--strict", app])
    if MACOS:
        return DIST / "Shoal.app" / "Contents" / "MacOS" / "Shoal"
    return DIST / "Shoal" / ("Shoal.exe" if WINDOWS else "Shoal")


def fix_linux_rpaths() -> None:
    """Let gotm and pyfabm find the bundled libraries (PyInstaller does not rewrite RPATHs on Linux)."""
    internal = DIST / "Shoal" / "_internal"
    patchelf = shutil.which("patchelf") or str(Path(sys.executable).parent / "patchelf")
    targets = [(internal / "kernel" / "install" / "bin" / "gotm", "$ORIGIN/../../..")]
    targets += [(p, "$ORIGIN/..") for p in (internal / "pyfabm").glob("*.so")]
    for path, rpath in targets:
        # DT_RPATH (not RUNPATH) so it also applies to the libraries these load
        run([patchelf, "--force-rpath", "--set-rpath", rpath, path])


def make_dmg(platform: str) -> Path:
    stage = DIST / "dmg"
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir()
    run(["ditto", DIST / "Shoal.app", stage / "Shoal.app"])
    (stage / "Applications").symlink_to("/Applications")
    for f in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copy2(REPO / f, stage / f)
    out = RELEASE / f"Shoal-{__version__}-{platform}.dmg"
    out.unlink(missing_ok=True)
    run(["hdiutil", "create", "-volname", f"Shoal {__version__}", "-srcfolder", stage, "-ov", "-format", "UDZO", out])
    shutil.rmtree(stage)
    return out


def make_setup(platform: str) -> Path:
    iscc = shutil.which("iscc") or r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
    if not Path(iscc).exists() and not shutil.which("iscc"):
        sys.exit("!! Inno Setup 6 (ISCC.exe) not found; install it from https://jrsoftware.org/isdl.php")
    name = f"Shoal-{__version__}-{platform}-setup"
    run([iscc, "/Q", f"/DVersion={__version__}", f"/DSourceDir={DIST / 'Shoal'}", f"/DOutputDir={RELEASE}",
         f"/DOutputName={name}", f"/DIconFile={REPO / 'packaging' / 'icons' / 'Shoal.ico'}",
         REPO / "packaging" / "shoal.iss"])
    return RELEASE / f"{name}.exe"


def make_tarball(platform: str) -> Path:
    out = RELEASE / f"Shoal-{__version__}-{platform}.tar.gz"
    shutil.copy2(REPO / "packaging" / "icons" / "Shoal.png", DIST / "Shoal" / "Shoal.png")
    shutil.copy2(REPO / "packaging" / "linux" / "install-desktop-entry.sh", DIST / "Shoal" / "install-desktop-entry.sh")
    for f in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copy2(REPO / f, DIST / "Shoal" / f)
    with tarfile.open(out, "w:gz") as tar:
        tar.add(DIST / "Shoal", arcname="Shoal")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", default=platform_key(), help="asset name suffix (default: this machine)")
    args = ap.parse_args()
    if args.platform != platform_key():
        sys.exit(f"!! this machine builds {platform_key()}, not {args.platform}")
    preflight()
    RELEASE.mkdir(parents=True, exist_ok=True)
    exe = pyinstaller()
    if sys.platform.startswith("linux"):
        fix_linux_rpaths()
    (DIST / "app-executable.txt").write_text(str(exe), encoding="utf-8")
    out = make_dmg(args.platform) if MACOS else make_setup(args.platform) if WINDOWS else make_tarball(args.platform)
    size = out.stat().st_size / 1048576
    print(f">> {out.relative_to(REPO)} ({size:.0f} MB)\n>> launcher: {exe}")


if __name__ == "__main__":
    main()
