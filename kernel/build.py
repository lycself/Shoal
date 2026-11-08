"""Build the Shoal computational kernel (macOS, Linux and native Windows).

  * gotm    GOTM 1D water column with FABM and the institutes below
  * pyfabm  FABM Python interface (0D runs, labs, offline MIZER) with the same institutes, installed into .venv

Institutes compiled on top of FABM's defaults:
  ersem      (pmlmodelling/ersem)          LTL host used by both papers
  mizer      (pmlmodelling/fabm-mizer)     size-spectrum HTL (Powley et al. 2026)
  e2e        (kernel/e2e) functional-group fish/macrobenthos re-implemented from the published equations
  ecosmoe2e  (vendor/ecosmo-e2e) the official ECOSMO E2E v2.0 code (Vijayakumaran et al. 2026, CC BY 4.0)
ECOSMO (nersc) and ERGOM (msi, iow) ship with FABM itself.

System tools (found on PATH): gfortran, cmake, git, and NetCDF-Fortran (nf-config on macOS/Linux; on
Windows the MSYS2 UCRT64 packages next to gfortran, plus mingw32-make). `pnpm check:env` checks them and
prints the install commands for each OS.

Usage:  pnpm kernel [--clean] [--only gotm|pyfabm]      (runs this file with the project's .venv Python)
        <.venv python> kernel/build.py [--clean] [--only gotm|pyfabm]
"""
from __future__ import annotations

import argparse
import datetime
import filecmp
import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SRC = HERE / "src"
BUILD = HERE / "build"
PREFIX = HERE / "install"
LOGS = HERE / "logs"
WINDOWS = os.name == "nt"
EXE = ".exe" if WINDOWS else ""

# Third-party sources are pinned to the commits Shoal was developed and tested against, so a fresh
# build reproduces the same model. To upgrade one, change its hash here and rebuild with --clean.
SOURCES = [
    ("gotm",         "https://github.com/gotm-model/code.git",           "771b3b5a36c10cbcf4fc3a5d5225d0f64a9c8159"),  # 2026-08-27
    ("fabm",         "https://github.com/fabm-model/fabm.git",           "4585bcf510ef862308147fa873beb4cf42f43341"),  # 2026-10-30
    ("ersem",        "https://github.com/pmlmodelling/ersem.git",        "ca71e5aae98477232c3510f3a4ffee496e83d62f"),  # 2026-10-29
    ("fabm-mizer",   "https://github.com/pmlmodelling/fabm-mizer.git",   "ed8b78a4ba6f4d6ca07a4028cee392bc8335fa93"),  # 2025-11-03
    ("gotm-cases",   "https://github.com/gotm-model/cases.git",          "caa8a1d67da4d0bfa7ad7e50b5a1b409c935b0aa"),  # 2026-03-18
    ("ersem-setups", "https://github.com/pmlmodelling/ersem-setups.git", "545b4dadb6bdd2387374adcf995c8e0289948faa"),  # 2026-08-25
]


def die(msg: str) -> None:
    sys.exit(f"!! {msg}")


def run(cmd: list, **kw) -> None:
    subprocess.check_call([str(c) for c in cmd], **kw)


def git(*args, cwd: Path) -> str:
    return subprocess.check_output(["git", "-C", str(cwd), *args], text=True).strip()


def venv_python() -> Path:
    """pyfabm goes into the project's .venv; prefer the interpreter we run under when it is that venv."""
    venv = REPO / ".venv"
    if Path(sys.prefix).resolve() == venv.resolve():
        return Path(sys.executable)
    py = venv / ("Scripts/python.exe" if WINDOWS else "bin/python")
    if not py.exists():
        die(f"找不到 {venv}。先用 Python 3.11 运行：python -m venv .venv ，再安装依赖（见 README）")
    return py


def tool(name: str, env_var: str | None = None) -> Path:
    path = os.environ.get(env_var) if env_var else None
    path = path or shutil.which(name)
    if not path:
        die(f"找不到 {name}。运行 pnpm check:env 查看各系统的安装方法。")
    return Path(path)


def fetch(name: str, url: str, rev: str) -> None:
    dest = SRC / name
    if not dest.is_dir():
        print(f">> fetching {name} @ {rev[:7]}")
        run(["git", "init", "-q", dest])
        run(["git", "-C", dest, "remote", "add", "origin", url])
        run(["git", "-C", dest, "fetch", "-q", "--depth", "1", "origin", rev])
        run(["git", "-C", dest, "checkout", "-q", "FETCH_HEAD"])
        run(["git", "-C", dest, "submodule", "update", "-q", "--init", "--recursive", "--depth", "1"])
    else:
        try:
            have = git("rev-parse", "HEAD", cwd=dest)
        except subprocess.CalledProcessError:
            have = "?"
        if have != rev:
            print(f"!! {name} is at {have[:7]}, Shoal is tested with {rev[:7]} (delete {dest} to refetch)")


def patch_official_e2e(official: Path) -> Path:
    """Apply patches/ecosmo-e2e-corrections.patch to a copy of the official sources in build/.

    The official sources are never edited. The patch adds optional corrections (mass and sign fixes, see
    patches/README.md) as FABM parameters that are all off by default, so an unmodified configuration still
    runs the original code path. Uses `git apply` (Git is needed anyway) so no separate `patch` tool is required.
    """
    patched = BUILD / "ecosmo-e2e-src"
    fresh = BUILD / "ecosmo-e2e-src.new"
    shutil.rmtree(fresh, ignore_errors=True)
    shutil.copytree(official / "src", fresh)
    # stop git from treating the Shoal repository around build/ as the target repository
    env = {**os.environ, "GIT_CEILING_DIRECTORIES": str(BUILD)}
    r = subprocess.run(["git", "apply", "-p1", "--whitespace=nowarn", str(HERE / "patches" / "ecosmo-e2e-corrections.patch")],
                       cwd=fresh, env=env)
    if r.returncode != 0:
        die(f"patches/ecosmo-e2e-corrections.patch does not apply to {official / 'src'} (different version?)")
    # only replace files whose content changed, so unchanged sources are not recompiled
    patched.mkdir(parents=True, exist_ok=True)
    for f in fresh.iterdir():
        target = patched / f.name
        if f.is_file() and not (target.exists() and filecmp.cmp(f, target, shallow=False)):
            shutil.copy2(f, target)
    shutil.rmtree(fresh)
    return patched


def netcdf_cmake_args(nf_config: Path) -> list[str]:
    """NetCDF-Fortran link flags from nf-config, plus the NetCDF-C library folder.

    `nf-config --flibs` ends in -lnetcdf but only names its own -L folder. That is enough when both libraries
    share a prefix (conda, apt), but Homebrew keeps them in separate Cellar folders, so add `nc-config --libdir`.
    """
    flibs = subprocess.check_output([str(nf_config), "--flibs"], text=True).strip()
    nc_config = shutil.which("nc-config")
    if nc_config:
        try:
            libdir = subprocess.check_output([nc_config, "--libdir"], text=True).strip()
        except subprocess.CalledProcessError:
            libdir = ""
        if libdir and f"-L{libdir}" not in flibs.split():
            flibs += f" -L{libdir}"
    return [f"-DNetCDF_CONFIG_EXECUTABLE={nf_config.as_posix()}", f"-DNetCDF_LIBRARIES={flibs}"]


def cmake_env() -> dict:
    """Makefiles everywhere. Ninja is not used: the out-of-tree FABM institutes (mizer, ecosmoe2e) then start
    compiling before FABM has written fabm_types.mod. On Windows CMake would default to Visual Studio, which
    cannot drive gfortran, so MinGW Makefiles (mingw32-make from MSYS2) is chosen explicitly."""
    env = dict(os.environ)
    if WINDOWS and "CMAKE_GENERATOR" not in env:
        if not shutil.which("mingw32-make"):
            die("Windows 上需要 mingw32-make（在 MSYS2 UCRT64 终端运行：pacman -S mingw-w64-ucrt-x86_64-make）")
        env["CMAKE_GENERATOR"] = "MinGW Makefiles"
    return env


def record_kernel(official: Path | None, fc: Path) -> None:
    """kernel.json: what was built (the backend reads this to report kernel capabilities)."""
    def rev(p: Path):
        try:
            return git("log", "-1", "--format=%h %cs", cwd=p)
        except Exception:
            return None
    info = {
        "built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "platform": sys.platform,
        "gotm": rev(SRC / "gotm"), "fabm": rev(SRC / "fabm"), "ersem": rev(SRC / "ersem"),
        "mizer": rev(SRC / "fabm-mizer"),
        # "official": ECOSMO E2E v2.0 compiled in (model ecosmoe2e_fish / ecosmoe2e_mb); the equation
        # re-implementation (e2e/fish, e2e/macrobenthos) is always present for comparison
        "e2e": {"source": "official" if official else "paper-equations",
                "official_path": str(official) if official else None,
                "reimplementation_path": str(HERE / "e2e"),
                # Shoal's optional corrections compiled into the official code (patches/ecosmo-e2e-corrections.patch)
                "corrections": bool(official)},
        "institutes_extra": ["ersem", "mizer", "e2e"] + (["ecosmoe2e"] if official else []),
        # Windows: gotm.exe and pyfabm need the MinGW runtime DLLs (libgfortran, NetCDF) found next to gfortran
        "runtime_dll_dirs": [str(fc.resolve().parent)] if WINDOWS else [],
    }
    (PREFIX / "kernel.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    print(json.dumps(info, indent=2))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clean", action="store_true", help="delete kernel/build first")
    ap.add_argument("--only", choices=["gotm", "pyfabm"])
    args = ap.parse_args()

    py = venv_python()
    fc = tool("gfortran", "FC")
    tool("cmake")
    tool("git")
    nf_config = None if WINDOWS else tool("nf-config")
    env = cmake_env()
    print(f">> Fortran {fc}\n>> Python  {py}\n>> CMake generator: {env.get('CMAKE_GENERATOR', 'default')}")

    for d in (SRC, BUILD, PREFIX / "bin", LOGS):
        d.mkdir(parents=True, exist_ok=True)
    for name, url, rev in SOURCES:
        fetch(name, url, rev)

    # E2E: the paper-equation implementation in kernel/e2e and the official ECOSMO E2E v2.0 code are built
    # side by side (model names e2e/fish vs ecosmoe2e_fish). The official sources ship in vendor/ecosmo-e2e
    # (CC BY 4.0, Zenodo 10.5281/zenodo.20413770, see its NOTICE.md); a full copy of the archive unpacked to
    # src/ecosmo-e2e (e.g. a newer release) takes precedence.
    official = next((d for d in (SRC / "ecosmo-e2e", HERE / "vendor" / "ecosmo-e2e")
                     if (d / "src" / "CMakeLists.txt").is_file()), None)
    extra = "ersem;mizer;e2e"
    if official:
        extra += ";ecosmoe2e"
        print(f">> also building the official ECOSMO E2E code from {official}")

    if args.clean:
        shutil.rmtree(BUILD, ignore_errors=True)
        BUILD.mkdir(parents=True)
        # pyfabm's setup.py builds in src/fabm/build; its CMake cache keeps the compiler and linker flags of the
        # first build (e.g. an old toolchain's rpaths) unless it is removed too
        shutil.rmtree(SRC / "fabm" / "build", ignore_errors=True)

    # forward slashes: CMake accepts them everywhere, and pyfabm's setup.py shlex-splits these options
    common = [
        "-DCMAKE_BUILD_TYPE=Release",
        f"-DCMAKE_Fortran_COMPILER={fc.as_posix()}",
        f"-DFABM_EXTRA_INSTITUTES={extra}",
        f"-DFABM_ERSEM_BASE={(SRC / 'ersem').as_posix()}",
        f"-DFABM_MIZER_BASE={(SRC / 'fabm-mizer').as_posix()}",
        f"-DFABM_E2E_BASE={(HERE / 'e2e').as_posix()}",
    ]
    if official:
        common.append(f"-DFABM_ECOSMOE2E_BASE={patch_official_e2e(official).as_posix()}")

    if args.only in (None, "gotm"):
        print(">> building GOTM")
        netcdf = netcdf_cmake_args(nf_config) if nf_config else \
                 [f"-DCMAKE_PREFIX_PATH={fc.resolve().parents[1].as_posix()}"]  # MSYS2 UCRT64: include/netcdf.mod, lib/libnetcdff
        run(["cmake", "-S", SRC / "gotm", "-B", BUILD / "gotm",
             f"-DFABM_BASE={(SRC / 'fabm').as_posix()}", "-DGOTM_USE_STIM=ON", "-DGOTM_USE_SEAGRASS=ON",
             "-DGOTM_USE_CVMIX=ON", f"-DCMAKE_INSTALL_PREFIX={PREFIX.as_posix()}", *netcdf, *common], env=env)
        run(["cmake", "--build", BUILD / "gotm", "--parallel"], env=env)
        shutil.copy2(BUILD / "gotm" / f"gotm{EXE}", PREFIX / "bin" / f"gotm{EXE}")
        print(f">> gotm installed at {PREFIX / 'bin' / f'gotm{EXE}'}")

    if args.only in (None, "pyfabm"):
        print(">> building pyfabm")
        # pyfabm's setup.py forwards cmake options from setup.cfg [build_ext] cmake_opts
        cfg = SRC / "fabm" / "setup.cfg"
        cfg.write_text("[build_ext]\ncmake_opts=" + " ".join(shlex.quote(o) for o in common) + "\n", encoding="utf-8")
        log = LOGS / "pyfabm_build.log"
        try:
            with open(log, "w", encoding="utf-8") as fh:
                r = subprocess.run([str(py), "-m", "pip", "install", "--no-build-isolation", "--no-deps",
                                    "--force-reinstall", str(SRC / "fabm"), "-v"], stdout=fh, stderr=subprocess.STDOUT, env=env)
        finally:
            cfg.unlink(missing_ok=True)
        if r.returncode != 0:
            print("".join(log.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)[-40:]))
            die(f"pyfabm build failed (full log: {log})")
        check = "import pyfabm; print('pyfabm', getattr(pyfabm, '__version__', ''), pyfabm.__file__)"
        if WINDOWS:
            check = f"import os; os.add_dll_directory({str(fc.resolve().parent)!r}); " + check
        run([py, "-c", check])

    record_kernel(official, fc)


if __name__ == "__main__":
    main()
