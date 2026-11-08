"""Paths and runtime settings for Shoal.

Everything location-dependent goes through this module so the backend can be
moved (another workspace, another kernel build) with environment variables:

    SHOAL_WORKSPACE   folder holding projects, data cache and settings (default <repo>/workspace)
    SHOAL_KERNEL      kernel install prefix containing bin/gotm and kernel.json (default <repo>/kernel/install)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
KERNEL_DIR = REPO / "kernel"
KERNEL_SRC = KERNEL_DIR / "src"


def workspace() -> Path:
    p = Path(os.environ.get("SHOAL_WORKSPACE", REPO / "workspace")).expanduser()
    p.mkdir(parents=True, exist_ok=True)
    return p


def projects_dir() -> Path:
    p = workspace() / "projects"
    p.mkdir(parents=True, exist_ok=True)
    return p


def cache_dir() -> Path:
    p = workspace() / "cache"
    p.mkdir(parents=True, exist_ok=True)
    return p


def kernel_prefix() -> Path:
    return Path(os.environ.get("SHOAL_KERNEL", KERNEL_DIR / "install")).expanduser()


def gotm_executable() -> Path | None:
    exe = kernel_prefix() / "bin" / ("gotm.exe" if os.name == "nt" else "gotm")
    if exe.exists():
        return exe
    found = shutil.which("gotm")
    return Path(found) if found else None


def _read_kernel_json() -> dict:
    info_file = kernel_prefix() / "kernel.json"
    if info_file.exists():
        try:
            return json.loads(info_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def runtime_dll_dirs() -> list[str]:
    """Windows: folders holding the MinGW runtime DLLs (libgfortran, NetCDF) that gotm.exe and pyfabm load.

    kernel/build.py records the gfortran folder it compiled with; SHOAL_DLL_DIRS (os.pathsep-separated) adds more.
    """
    if os.name != "nt":
        return []
    dirs = list(_read_kernel_json().get("runtime_dll_dirs") or [])
    dirs += [d for d in os.environ.get("SHOAL_DLL_DIRS", "").split(os.pathsep) if d]
    return [d for d in dict.fromkeys(dirs) if Path(d).is_dir()]


def kernel_env() -> dict:
    """Environment for running gotm: on Windows its runtime DLL folders go in front of PATH."""
    env = dict(os.environ)
    dirs = runtime_dll_dirs()
    if dirs:
        env["PATH"] = os.pathsep.join(dirs + [env.get("PATH", "")])
    return env


def gotm_popen_kwargs() -> dict:
    """Start gotm in its own process group, so cancelling it never signals the backend itself."""
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP, "env": kernel_env()}
    return {"start_new_session": True}


def kernel_info() -> dict:
    """What the kernel build reported (kernel/build.py writes kernel.json)."""
    info = _read_kernel_json()
    exe = gotm_executable()
    info["gotm_path"] = str(exe) if exe else None
    info["gotm_available"] = exe is not None
    try:
        import pyfabm  # noqa: F401

        info["pyfabm_available"] = True
    except Exception:  # pragma: no cover - depends on environment
        info["pyfabm_available"] = False
    try:
        import pygetm  # noqa: F401

        info["pygetm_available"] = True
    except Exception:
        info["pygetm_available"] = False
    official = KERNEL_SRC / "ecosmo-e2e"
    info["e2e_official_present"] = (official / "src" / "CMakeLists.txt").exists()
    return info


# ---------------------------------------------------------------- settings
SETTINGS_FILE = "settings.json"
DEFAULT_SETTINGS = {
    "language": "zh",
    "max_parallel_runs": max(1, (os.cpu_count() or 2) - 2),
    "assistant": {
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
        "api_key": "",
        "auto_apply": False,
    },
}


def load_settings() -> dict:
    f = workspace() / SETTINGS_FILE
    data = json.loads(json.dumps(DEFAULT_SETTINGS))
    if f.exists():
        try:
            stored = json.loads(f.read_text())
            for k, v in stored.items():
                if isinstance(v, dict) and isinstance(data.get(k), dict):
                    data[k].update(v)
                else:
                    data[k] = v
        except json.JSONDecodeError:
            pass
    env_key = os.environ.get("SHOAL_ASSISTANT_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if env_key and not data["assistant"].get("api_key"):
        data["assistant"]["api_key"] = env_key
        data["assistant"]["api_key_from_env"] = True
    return data


def save_settings(data: dict) -> dict:
    current = load_settings()
    for k, v in data.items():
        if isinstance(v, dict) and isinstance(current.get(k), dict):
            current[k].update(v)
        else:
            current[k] = v
    current.get("assistant", {}).pop("api_key_from_env", None)
    (workspace() / SETTINGS_FILE).write_text(json.dumps(current, indent=2, ensure_ascii=False))
    return current
