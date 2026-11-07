"""Paths and runtime settings for E2E Studio.

Everything location-dependent goes through this module so the backend can be
moved (another workspace, another kernel build) with environment variables:

    E2E_WORKSPACE   folder holding projects, data cache and settings (default <repo>/workspace)
    E2E_KERNEL      kernel install prefix containing bin/gotm and kernel.json (default <repo>/kernel/install)
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
KERNEL_DIR = REPO / "kernel"
KERNEL_SRC = KERNEL_DIR / "src"


def workspace() -> Path:
    p = Path(os.environ.get("E2E_WORKSPACE", REPO / "workspace")).expanduser()
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
    return Path(os.environ.get("E2E_KERNEL", KERNEL_DIR / "install")).expanduser()


def gotm_executable() -> Path | None:
    exe = kernel_prefix() / "bin" / "gotm"
    if exe.exists():
        return exe
    found = shutil.which("gotm")
    return Path(found) if found else None


def kernel_info() -> dict:
    """What the kernel build reported (kernel/build.sh writes kernel.json)."""
    info_file = kernel_prefix() / "kernel.json"
    info: dict = {}
    if info_file.exists():
        try:
            info = json.loads(info_file.read_text())
        except json.JSONDecodeError:
            info = {}
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
    info["e2e_official_present"] = (official / "CMakeLists.txt").exists()
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
    env_key = os.environ.get("E2E_ASSISTANT_API_KEY") or os.environ.get("OPENAI_API_KEY")
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
