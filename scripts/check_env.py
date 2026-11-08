"""Check the project's Python environment (.venv) and the system tools the kernel build needs.

It only checks and never creates or installs anything. Set the environment up yourself first:

    python -m venv .venv                                         (with Python 3.11)
    .venv/bin/python -m pip install -r backend/requirements.txt  (Windows: .venv\\Scripts\\python ...)

then run   pnpm check:env   (or this file with the .venv Python).

Checks: running inside <repo>/.venv, Python 3.11, backend/requirements.txt installed at the listed versions,
and gfortran / NetCDF-Fortran / CMake / Git on PATH. For anything missing it prints the install command for
this OS (macOS, Linux, Windows).
"""
from __future__ import annotations

import os
import platform
import re
import shutil
import sys
from importlib import metadata
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
VENV = REPO / ".venv"
REQUIREMENTS = REPO / "backend" / "requirements.txt"
WANT = (3, 11)
WINDOWS = os.name == "nt"
PIP = r".venv\Scripts\python -m pip install -r backend\requirements.txt" if WINDOWS else \
      ".venv/bin/python -m pip install -r backend/requirements.txt"


def ok(flag: bool, label: str, detail: str = "") -> bool:
    print(f"   {'✓' if flag else '✗'} {label:<34} {detail}")
    return flag


def check_python() -> bool:
    print(">> Python")
    in_venv = Path(sys.prefix).resolve() == VENV.resolve()
    good = ok(in_venv, "项目的 .venv", sys.prefix)
    if not in_venv:
        print(f"      请用 .venv 里的 Python 运行（pnpm check:env）。还没有 .venv 的话，用 Python 3.11 运行：python -m venv .venv")
    v = sys.version_info[:2]
    good &= ok(v == WANT, f"Python {WANT[0]}.{WANT[1]}", f"{v[0]}.{v[1]}")
    if v != WANT:
        print(f"      .venv 不是 3.11 建的：删掉 .venv，换成 Python 3.11 再运行 python -m venv .venv")
    return good


def check_packages() -> bool:
    print(f">> Python 依赖（{REQUIREMENTS.relative_to(REPO).as_posix()}）")
    good = True
    for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*([A-Za-z0-9_.\-]+)\s*==\s*([^\s#]+)", line)
        if not m:
            continue
        name, want = m.groups()
        try:
            have = metadata.version(name)
        except metadata.PackageNotFoundError:
            have = None
        detail = have if have == want else "未安装" if have is None else f"{have}（需要 {want}）"
        good &= ok(have == want, name, detail)
    if not good:
        print(f"      安装：{PIP}")
    return good


def linux_distro() -> str:
    try:
        text = Path("/etc/os-release").read_text()
    except OSError:
        return ""
    fields = dict(line.split("=", 1) for line in text.splitlines() if "=" in line)
    return (fields.get("ID", "") + " " + fields.get("ID_LIKE", "")).replace('"', "").lower()


def install_hint() -> str:
    system = platform.system()
    if system == "Darwin":
        return ("macOS（Homebrew）：\n"
                "    brew install gcc netcdf-fortran cmake git\n"
                "  gcc 里带 gfortran。")
    if system == "Linux":
        distro = linux_distro()
        if any(d in distro for d in ("ubuntu", "debian")):
            return ("Ubuntu / Debian：\n"
                    "    sudo apt update\n"
                    "    sudo apt install gfortran libnetcdff-dev cmake git")
        if any(d in distro for d in ("fedora", "rhel", "centos")):
            return "Fedora / RHEL：\n    sudo dnf install gcc-gfortran netcdf-fortran-devel cmake git"
        return "Linux：用发行版的包管理器安装 gfortran、NetCDF-Fortran 开发包（含 nf-config）、cmake、git。"
    if system == "Windows":
        return ("Windows（原生，用 MSYS2 的 UCRT64 工具链）：\n"
                "  1. 安装 MSYS2：https://www.msys2.org/\n"
                "  2. 在 “MSYS2 UCRT64” 终端里运行：\n"
                "       pacman -S --needed mingw-w64-ucrt-x86_64-gcc-fortran mingw-w64-ucrt-x86_64-netcdf-fortran \\\n"
                "                          mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-make git\n"
                "  3. 把 C:\\msys64\\ucrt64\\bin 加到 Windows 的 PATH（系统设置 → 环境变量），重新打开终端。")
    return "请安装 gfortran、NetCDF-Fortran、cmake、git。"


def check_tools() -> bool:
    print(">> 编译内核所需的系统工具")
    tools = {"gfortran": "Fortran 编译器", "cmake": "CMake", "git": "Git"}
    if WINDOWS:
        tools["mingw32-make"] = "mingw32-make（Windows 上用它驱动编译）"
    else:
        tools["nf-config"] = "NetCDF-Fortran（nf-config）"
    good = True
    for exe, label in tools.items():
        path = shutil.which(exe)
        good &= ok(bool(path), label, path or "未找到")
    if WINDOWS and shutil.which("gfortran"):
        mod = Path(shutil.which("gfortran")).resolve().parents[1] / "include" / "netcdf.mod"
        good &= ok(mod.exists(), "NetCDF-Fortran（netcdf.mod）", str(mod) if mod.exists() else "未找到")
    if not good:
        print("      安装方法：\n      " + install_hint().replace("\n", "\n      "))
    return good


def main() -> None:
    results = [check_python(), check_packages(), check_tools()]
    if all(results):
        print("\n>> 环境齐全。下一步：pnpm kernel   （编译 GOTM 与 pyfabm，含 ERSEM、MIZER、E2E）")
    else:
        print("\n!! 环境还不完整，按上面的提示补齐后再运行 pnpm check:env")
        sys.exit(1)


if __name__ == "__main__":
    main()
