"""Automatic updates for the packaged app (macOS .dmg, Windows setup .exe, Linux .tar.gz).

Releases are GitHub releases tagged v<version>. Each carries an `update.json` manifest written by
packaging/make_manifest.py; `releases/latest/download/update.json` always points at the newest one:

    {"schema": 1, "app": "shoal", "version": "1.2.0", "tag": "v1.2.0", "published": "...", "notes": "...",
     "assets": {"macos-arm64": {"name": "...dmg", "url": "https://github.com/...", "sha256": "...", "size": 123}, ...}}

Design rule (learned from AVAS, where a failed check at start-up crashed the app): nothing here may ever
raise into the caller or the launcher. Every public function records problems in the shared state, which
the web page and the tray menu display, and the app keeps running. The check runs on a daemon thread that
starts only after the server and the tray are up.

Installing: the verified package is handed to a small helper script (bash on macOS/Linux, PowerShell on
Windows) started as a detached process. It waits for this process to exit, swaps in the new version,
restores the old one if anything fails, writes a result file and starts Shoal again. The next start reads
the result and shows it once.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from ..config import FROZEN, user_data_dir
from ..version import __version__

log = logging.getLogger("shoal.update")

REPOSITORY = "lycself/Shoal"
DEFAULT_URL = f"https://github.com/{REPOSITORY}/releases/latest/download/update.json"
ASSET_PREFIX = f"https://github.com/{REPOSITORY}/releases/download/"
RELEASES_PAGE = f"https://github.com/{REPOSITORY}/releases/latest"
CHECK_INTERVAL = 6 * 3600

# Messages shown to the user, keyed by the codes the helper scripts write (they stay ASCII-only).
HELPER_ERRORS = {
    "mount": "无法打开下载的安装包（.dmg）。",
    "payload": "安装包内容不完整。",
    "copy": "复制新版本失败，可能是磁盘空间不足。",
    "swap": "替换旧版本失败，已恢复原来的版本。",
    "installer": "安装程序没有成功完成，已保留原来的版本。",
    "extract": "解压新版本失败，可能是磁盘空间不足。",
}

_lock = threading.RLock()
_state: dict = {
    "phase": "idle",  # idle | checking | available | latest | error | downloading | installing
    "current": __version__,
    "latest": None,  # {"version", "notes", "published", "size"}
    "error": None,  # user-facing message of the last failure
    "checked": None,  # unix time of the last successful check
    "progress": None,  # {"downloaded", "total"} while downloading
    "result": None,  # outcome of the previous update, shown once: {"ok", "message"}
}
_manifest: dict | None = None
_check_running = threading.Lock()
_started = False
_stop = threading.Event()  # ends the background loop (tests)


# ----------------------------------------------------------------------------- helpers
def platform_key() -> str:
    machine = platform.machine().lower()
    arch = "arm64" if machine in ("arm64", "aarch64") else "x64"
    system = "macos" if sys.platform == "darwin" else "windows" if os.name == "nt" else "linux"
    return f"{system}-{arch}"


def parse_version(text: str) -> tuple[int, ...]:
    m = re.fullmatch(r"v?(\d+(?:\.\d+)*)", str(text).strip())
    if not m:
        raise ValueError(f"版本号格式不对：{text!r}")
    return tuple(int(x) for x in m.group(1).split("."))


def is_newer(candidate: str, current: str) -> bool:
    a, b = parse_version(candidate), parse_version(current)
    n = max(len(a), len(b))
    return a + (0,) * (n - len(a)) > b + (0,) * (n - len(b))


def updates_dir() -> Path:
    d = user_data_dir() / "updates"
    d.mkdir(parents=True, exist_ok=True)
    return d


def manifest_url() -> str:
    return os.environ.get("SHOAL_UPDATE_URL") or DEFAULT_URL


def _set(**fields) -> None:
    with _lock:
        _state.update(fields)


def state() -> dict:
    """Snapshot for the web page and the tray (never raises)."""
    with _lock:
        snap = json.loads(json.dumps(_state))
    snap["can_install"], snap["cannot_install_reason"] = install_support()
    snap["releases_page"] = RELEASES_PAGE
    snap["platform"] = platform_key()
    return snap


def install_support() -> tuple[bool, str | None]:
    """Whether this installation can replace itself, and why not otherwise."""
    try:
        if not FROZEN:
            return False, "从源码运行的版本请用 git pull 更新。"
        target = install_target()
        if target is None:
            return False, "无法确定安装位置。"
        if sys.platform == "darwin":
            p = str(target)
            if "/AppTranslocation/" in p or p.startswith("/Volumes/"):
                return False, "Shoal 正从安装盘或临时位置运行：请先把 Shoal 拖进“应用程序”文件夹，再从那里打开。"
        if os.name != "nt" and not os.access(target.parent, os.W_OK):
            return False, f"没有写入 {target.parent} 的权限，请手动下载新版本。"
        return True, None
    except Exception as e:  # noqa: BLE001
        return False, f"无法判断能否自动更新：{e}"


def install_target() -> Path | None:
    """What the update replaces: Shoal.app (macOS), the install folder (Windows/Linux)."""
    exe = Path(sys.executable).resolve()
    if sys.platform == "darwin":
        for parent in exe.parents:
            if parent.suffix == ".app":
                return parent
        return None
    return exe.parent


# ----------------------------------------------------------------------------- checking
def _fetch_json(url: str, attempts: int = 3, timeout: float = 15) -> dict:
    last: Exception | None = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": f"Shoal/{__version__}", "Cache-Control": "no-cache"})
            # system proxies are looked up on every attempt (a VPN may have come up in the meantime)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler())
            with opener.open(req, timeout=timeout) as r:
                raw = r.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise ValueError("更新信息过大")
            return json.loads(raw)
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in (408, 429, 500, 502, 503, 504):
                break
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last = e
        except ValueError as e:  # malformed JSON: retrying will not help
            last = e
            break
        if i + 1 < attempts:
            time.sleep(2 ** i)
    raise last or RuntimeError("无法获取更新信息")


def validate(manifest: dict, url: str) -> dict:
    if not isinstance(manifest, dict) or manifest.get("schema") != 1 or manifest.get("app") != "shoal":
        raise ValueError("更新信息格式不对")
    parse_version(manifest.get("version", ""))
    assets = manifest.get("assets")
    if not isinstance(assets, dict):
        raise ValueError("更新信息里没有安装包列表")
    for key, item in assets.items():
        if not (isinstance(item, dict) and isinstance(item.get("url"), str)
                and re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256", "")))):
            raise ValueError(f"安装包信息不完整：{key}")
        # only official release assets, unless a test points the app at another manifest
        if url == DEFAULT_URL and not item["url"].startswith(ASSET_PREFIX):
            raise ValueError("安装包地址不是官方发布地址")
    return manifest


def _friendly(e: BaseException) -> str:
    if isinstance(e, urllib.error.HTTPError):
        if e.code == 404:
            return "还没有发布过可下载的版本。"
        return f"GitHub 返回错误 {e.code}，请稍后再试。"
    if isinstance(e, (urllib.error.URLError, TimeoutError, ConnectionError, OSError)):
        return "连不上 GitHub，检查网络（或代理）后再试。"
    return str(e) or e.__class__.__name__


def check() -> dict:
    """Ask GitHub for the newest release. Never raises; returns the new state."""
    global _manifest
    if not _check_running.acquire(timeout=90):  # a check is already running: wait for its answer
        return state()
    try:
        with _lock:
            busy = _state["phase"] in ("downloading", "installing")
        if not busy:
            _set(phase="checking")
        url = manifest_url()
        try:
            manifest = validate(_fetch_json(url), url)
        except Exception as e:  # noqa: BLE001
            log.warning("update check failed: %r", e)
            if not busy:
                _set(phase="error", error=_friendly(e))
            return state()
        latest = {"version": manifest["version"], "notes": str(manifest.get("notes") or ""),
                  "published": manifest.get("published"),
                  "size": (manifest["assets"].get(platform_key()) or {}).get("size")}
        with _lock:
            _manifest = manifest
            _state.update(latest=latest, checked=time.time())
            if not busy:
                newer = is_newer(manifest["version"], __version__) and platform_key() in manifest["assets"]
                _state.update(phase="available" if newer else "latest", error=None)
        log.info("update check: current %s, latest %s", __version__, manifest["version"])
        return state()
    except Exception as e:  # noqa: BLE001 - belt and braces: this function must never raise
        log.exception("update check crashed")
        _set(phase="error", error=_friendly(e))
        return state()
    finally:
        _check_running.release()


def start_background(delay: float | None = None, interval: float = CHECK_INTERVAL) -> None:
    """Check `delay` seconds after start-up, then every few hours, on a daemon thread."""
    global _started
    if _started:
        return
    _started = True
    if delay is None:
        try:
            delay = float(os.environ.get("SHOAL_UPDATE_DELAY", "8"))
        except ValueError:
            delay = 8.0

    def loop() -> None:
        if _stop.wait(max(0.0, delay)):
            return
        while True:
            try:
                check()
            except BaseException:  # noqa: BLE001 - the thread must never die with a traceback
                log.exception("background update check failed")
            if _stop.wait(interval):
                return

    try:
        threading.Thread(target=loop, name="update-check", daemon=True).start()
    except Exception:  # noqa: BLE001
        log.exception("could not start the update thread")


def read_previous_result() -> None:
    """Show the outcome of an update that finished while Shoal was closed (once). Never raises."""
    try:
        f = updates_dir() / "result.json"
        if not f.exists():
            return
        data = json.loads(f.read_text(encoding="utf-8"))
        f.unlink(missing_ok=True)
        if data.get("ok"):
            _set(result={"ok": True, "message": f"已更新到 {__version__}。"})
        else:
            msg = HELPER_ERRORS.get(str(data.get("code")), "更新没有完成，已保留原来的版本。")
            _set(result={"ok": False, "message": msg, "log": data.get("log")})
    except Exception:  # noqa: BLE001
        log.exception("could not read the previous update result")


def dismiss_result() -> None:
    _set(result=None)


# ----------------------------------------------------------------------------- installing
def _download(item: dict, dest: Path) -> None:
    req = urllib.request.Request(item["url"], headers={"User-Agent": f"Shoal/{__version__}"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler())
    digest = hashlib.sha256()
    done = 0
    with opener.open(req, timeout=60) as r, open(dest, "wb") as out:
        total = int(r.headers.get("Content-Length") or item.get("size") or 0) or None
        free = shutil.disk_usage(dest.parent).free
        if total and free < total * 3:  # the archive, the unpacked copy, and room to spare
            raise RuntimeError("磁盘空间不足，无法下载更新。")
        _set(progress={"downloaded": 0, "total": total})
        last = 0.0
        while True:
            chunk = r.read(256 * 1024)
            if not chunk:
                break
            out.write(chunk)
            digest.update(chunk)
            done += len(chunk)
            if time.monotonic() - last > 0.25:
                last = time.monotonic()
                _set(progress={"downloaded": done, "total": total})
    _set(progress={"downloaded": done, "total": total or done})
    if total and done != total:
        raise RuntimeError("下载不完整，请重试。")
    if digest.hexdigest() != item["sha256"]:
        raise RuntimeError("下载的文件校验失败（可能被网络篡改或损坏），请重试。")


def install(quit_app) -> dict:
    """Download, verify and hand over to the helper, then quit via `quit_app()`. Returns at once.

    The caller (the web API) has already checked that no simulation is running.
    """
    ok, reason = install_support()
    with _lock:
        manifest = _manifest
        phase = _state["phase"]
    if not ok:
        _set(error=reason)
        return state()
    if phase in ("downloading", "installing"):
        return state()
    if manifest is None or platform_key() not in manifest["assets"]:
        _set(phase="error", error="没有适合这台电脑的安装包，请先检查更新。")
        return state()
    _set(phase="downloading", error=None, progress={"downloaded": 0, "total": None})
    threading.Thread(target=_install_worker, args=(manifest, quit_app), name="update-install", daemon=True).start()
    return state()


def _install_worker(manifest: dict, quit_app) -> None:
    try:
        item = manifest["assets"][platform_key()]
        work = Path(tempfile.mkdtemp(prefix=f"update-{manifest['version']}-", dir=updates_dir()))
        package = work / Path(item.get("name") or item["url"].rsplit("/", 1)[-1]).name
        _download(item, package)
        _set(phase="installing", progress=None)
        _launch_helper(package, work, manifest["version"])
        log.info("update helper started for %s; quitting", manifest["version"])
        time.sleep(0.5)  # let the web page receive the "installing" state
        quit_app()
    except Exception as e:  # noqa: BLE001
        log.exception("update failed")
        _set(phase="error", progress=None, error=f"更新失败：{_friendly(e)} 原来的版本照常可用。")


def _launch_helper(package: Path, work: Path, version: str) -> None:
    target = install_target()
    result = updates_dir() / "result.json"
    logf = work / "update.log"
    pid = os.getpid()
    if sys.platform == "darwin":
        script = work / "update.sh"
        script.write_text(MAC_HELPER, encoding="utf-8")
        cmd = ["/bin/bash", str(script), str(pid), str(package), str(target), str(result), str(logf), version]
    elif os.name == "nt":
        script = work / "update.ps1"
        script.write_text(WINDOWS_HELPER, encoding="utf-8-sig")
        cmd = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
               "-File", str(script), str(pid), str(package), str(target), str(result), str(logf), version]
    else:
        script = work / "update.sh"
        script.write_text(LINUX_HELPER, encoding="utf-8")
        cmd = ["/bin/bash", str(script), str(pid), str(package), str(target), str(result), str(logf), version]
    kwargs: dict = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
                    "close_fds": True, "cwd": str(work)}
    if os.name == "nt":
        kwargs["creationflags"] = (subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
                                   | subprocess.CREATE_NO_WINDOW)
    else:
        kwargs["start_new_session"] = True
    env = dict(os.environ)
    for k in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH", "_MEIPASS2", "_PYI_APPLICATION_HOME_DIR", "_PYI_ARCHIVE_FILE",
              "_PYI_PARENT_PROCESS_LEVEL"):
        env.pop(k, None)  # the relaunched app must not inherit this process's bundle paths
    subprocess.Popen(cmd, env=env, **kwargs)


# The helpers take: <pid> <package> <target> <result.json> <log> <version>
MAC_HELPER = r"""#!/bin/bash
set -u
PID="$1"; PKG="$2"; APP="$3"; RESULT="$4"; LOG="$5"; VERSION="$6"
exec >>"$LOG" 2>&1
echo "update to $VERSION: $(date)"
MNT=""
finish() { # code
  if [ -n "$MNT" ]; then hdiutil detach "$MNT" -quiet -force || true; fi
  if [ ! -d "$APP" ] && [ -d "$APP.old" ]; then mv "$APP.old" "$APP"; fi
  if [ "$1" = ok ]; then printf '{"ok": true, "version": "%s"}' "$VERSION" > "$RESULT"
  else printf '{"ok": false, "code": "%s", "log": "%s"}' "$1" "$LOG" > "$RESULT"; fi
  if [ -d "$APP" ]; then rm -rf "$APP.new" "$APP.old"; fi  # never delete the only copy
  # SHOAL_* settings (only ever set for tests) are passed on; `open --env` needs macOS 13, so only when present
  ENVARGS=()
  while IFS='=' read -r k v; do case "$k" in SHOAL_*) ENVARGS+=(--env "$k=$v");; esac; done < <(env)
  open ${ENVARGS[@]+"${ENVARGS[@]}"} "$APP" || open "$APP"
  exit 0
}
for _ in $(seq 1 240); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
MNT="$(mktemp -d /tmp/shoal-update.XXXXXX)"
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MNT" "$PKG" || finish mount
[ -d "$MNT/Shoal.app" ] || finish payload
rm -rf "$APP.new"
ditto "$MNT/Shoal.app" "$APP.new" || finish copy
hdiutil detach "$MNT" -quiet -force || true
MNT=""
xattr -dr com.apple.quarantine "$APP.new" 2>/dev/null || true
rm -rf "$APP.old"
mv "$APP" "$APP.old" || finish swap
mv "$APP.new" "$APP" || finish swap
finish ok
"""

LINUX_HELPER = r"""#!/bin/bash
set -u
PID="$1"; PKG="$2"; DIR="$3"; RESULT="$4"; LOG="$5"; VERSION="$6"
exec >>"$LOG" 2>&1
echo "update to $VERSION: $(date)"
STAGE="$(dirname "$DIR")/.shoal-update.$$"
finish() { # code
  if [ ! -d "$DIR" ] && [ -d "$DIR.old" ]; then mv "$DIR.old" "$DIR"; fi
  if [ "$1" = ok ]; then printf '{"ok": true, "version": "%s"}' "$VERSION" > "$RESULT"
  else printf '{"ok": false, "code": "%s", "log": "%s"}' "$1" "$LOG" > "$RESULT"; fi
  if [ -d "$DIR" ]; then rm -rf "$STAGE" "$DIR.old"; fi  # never delete the only copy
  setsid "$DIR/Shoal" >/dev/null 2>&1 < /dev/null &
  exit 0
}
for _ in $(seq 1 240); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
rm -rf "$STAGE"; mkdir -p "$STAGE"
tar -xzf "$PKG" -C "$STAGE" || finish extract
[ -x "$STAGE/Shoal/Shoal" ] || finish payload
rm -rf "$DIR.old"
mv "$DIR" "$DIR.old" || finish swap
mv "$STAGE/Shoal" "$DIR" || finish swap
finish ok
"""

WINDOWS_HELPER = r"""param([int]$ProcId, [string]$Package, [string]$Dir, [string]$Result, [string]$Log, [string]$Version)
$ErrorActionPreference = 'Continue'
function Say($m) { Add-Content -LiteralPath $Log -Value ("{0}  {1}" -f (Get-Date -Format s), $m) }
function Finish($code) {
  if ($code -eq 'ok') { $o = @{ ok = $true; version = $Version } } else { $o = @{ ok = $false; code = $code; log = $Log } }
  [IO.File]::WriteAllText($Result, ($o | ConvertTo-Json -Compress))
  Start-Process -FilePath (Join-Path $Dir 'Shoal.exe')
  exit 0
}
Say "update to $Version"
try { Wait-Process -Id $ProcId -Timeout 120 -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Milliseconds 500
$p = Start-Process -FilePath $Package -Wait -PassThru -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', ('/DIR="{0}"' -f $Dir), ('/LOG="{0}"' -f "$Log.setup.txt"))
Say ("installer exit code {0}" -f $p.ExitCode)
if ($p.ExitCode -ne 0) { Finish 'installer' }
Finish 'ok'
"""
