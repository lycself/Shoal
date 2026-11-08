"""Shoal desktop launcher (the packaged app's entry point; also `python -m shoal.desktop` from a checkout).

Double-clicking Shoal starts the backend in the background, opens the browser and puts an icon in the
system tray (Windows, Linux) or the menu bar (macOS). Closing the browser keeps Shoal and its simulations
running; clicking the icon (or launching Shoal again) reopens the browser. Only "退出 Shoal" in the icon's
menu (or the button on the settings page) ends it.

Start-up order is chosen so that nothing optional can take the app down: the server and the icon come
first, the update check last, on its own thread, with every failure caught (see updater.py).
"""
from __future__ import annotations

import argparse
import json
import logging
import logging.handlers
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

from ..config import FROZEN, user_data_dir
from ..version import __version__

log = logging.getLogger("shoal.desktop")
PREFERRED_PORT = 8765


# ----------------------------------------------------------------------------- logging
def _setup_logging() -> Path:
    logs = user_data_dir() / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    logfile = logs / "shoal.log"
    # A windowed app (no console) has no stdout/stderr; uvicorn and print() would fail on None.
    if sys.stdout is None or sys.stderr is None:
        stream = open(logs / "console.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or stream
        sys.stderr = sys.stderr or stream
    handler = logging.handlers.RotatingFileHandler(logfile, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    return logfile


# ----------------------------------------------------------------------------- single instance
def _instance_file() -> Path:
    return user_data_dir() / "instance.json"


def _health(port: int, timeout: float = 1.5) -> dict | None:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=timeout) as r:
            data = json.loads(r.read())
        return data if isinstance(data, dict) and data.get("app") == "shoal" else None
    except Exception:  # noqa: BLE001
        return None


def find_running() -> int | None:
    """Port of a Shoal that is already running for this user, if any."""
    ports = []
    try:
        ports.append(int(json.loads(_instance_file().read_text(encoding="utf-8"))["port"]))
    except Exception:  # noqa: BLE001
        pass
    ports.append(PREFERRED_PORT)
    for port in dict.fromkeys(ports):
        if _health(port):
            return port
    return None


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if os.name != "nt":
            # as uvicorn does: a port whose last connections are still in TIME_WAIT (e.g. right after an update
            # restart) is free to listen on. Without this Shoal would move to another port, and the browser keeps
            # its saved settings per address, so they would seem lost.
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def choose_port(requested: int | None) -> int:
    if requested:
        return requested
    for port in range(PREFERRED_PORT, PREFERRED_PORT + 20):
        if _port_free(port):
            return port
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def open_browser(url: str) -> None:
    if os.environ.get("SHOAL_NO_BROWSER"):  # tests
        log.info("would open the browser at %s", url)
        return
    log.info("opening the browser at %s", url)
    try:
        webbrowser.open(url)
    except Exception:  # noqa: BLE001
        log.exception("could not open the browser")


# ----------------------------------------------------------------------------- the app
class App:
    def __init__(self, port: int, headless: bool, browser: bool):
        self.port = port
        self.url = f"http://127.0.0.1:{port}/"
        self.headless = headless
        self.browser = browser
        self.server = None
        self.server_thread: threading.Thread | None = None
        self.stopped = threading.Event()
        self.tray = None
        self._quitting = threading.Lock()

    # -- server
    def start_server(self) -> None:
        import uvicorn

        from ..server import app as api

        config = uvicorn.Config(api, host="127.0.0.1", port=self.port, log_config=None, access_log=False,
                                timeout_graceful_shutdown=3, ws_ping_interval=20)
        self.server = uvicorn.Server(config)
        self.server_thread = threading.Thread(target=self.server.run, name="server", daemon=True)
        self.server_thread.start()
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if _health(self.port, timeout=0.5):
                return
            if not self.server_thread.is_alive():
                raise RuntimeError(f"后端没有启动（端口 {self.port}），详见日志")
            time.sleep(0.2)
        raise RuntimeError("后端启动超时，详见日志")

    def started(self) -> None:
        """Runs once the server answers: remember the instance, open the browser, start update checks."""
        try:
            _instance_file().write_text(json.dumps({"port": self.port, "pid": os.getpid(), "version": __version__}),
                                        encoding="utf-8")
        except Exception:  # noqa: BLE001
            log.exception("could not write the instance file")
        if self.browser:
            open_browser(self.url)
        if FROZEN or os.environ.get("SHOAL_UPDATE_URL"):
            from . import updater

            updater.read_previous_result()
            updater.start_background()

    # -- jobs
    @staticmethod
    def active_jobs() -> int:
        try:
            from ..runner import get_runner

            return len(get_runner().active())
        except Exception:  # noqa: BLE001
            return 0

    # -- quitting
    def quit(self) -> None:
        if not self._quitting.acquire(blocking=False):
            return
        log.info("quitting")
        try:
            from ..runner import get_runner

            get_runner().cancel_all()
        except Exception:  # noqa: BLE001
            log.exception("could not cancel running jobs")
        if self.server is not None:
            self.server.should_exit = True
        if self.server_thread is not None:
            self.server_thread.join(timeout=10)
        try:
            data = json.loads(_instance_file().read_text(encoding="utf-8"))
            if data.get("pid") == os.getpid():
                _instance_file().unlink()
        except Exception:  # noqa: BLE001
            pass
        self.stopped.set()
        if self.tray is not None:
            try:
                self.tray.stop()
            except Exception:  # noqa: BLE001
                log.exception("could not remove the tray icon")

    # -- main loop
    def run(self) -> int:
        from . import state

        if os.name == "nt":
            try:  # lets the Windows installer see that Shoal is running (AppMutex in packaging/shoal.iss)
                import ctypes

                self._mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "ShoalDesktopAppMutex")
            except Exception:  # noqa: BLE001
                pass

        state.desktop = True
        state.url = self.url
        state.set_quit(self.quit)

        def boot() -> None:
            try:
                self.start_server()
            except Exception as e:  # noqa: BLE001
                log.exception("server failed to start")
                if self.tray is not None:
                    self.tray.notify_error(str(e))
                self.quit()
                return
            if self.tray is not None:
                self.tray.set_ready()
            self.started()

        if not self.headless:
            try:
                from .tray import Tray

                self.tray = Tray(self)
            except Exception:  # noqa: BLE001 - e.g. no tray support on this Linux desktop
                log.exception("no tray icon available; running without one")
                self.tray = None
        if self.tray is not None:
            try:
                self.tray.run(setup=boot)  # blocks on the main thread until quit
                self.stopped.wait(15)
                return 0
            except Exception:  # noqa: BLE001
                log.exception("tray failed; continuing without it")
                self.tray = None
        # headless (or no tray): serve until /api/app/quit or Ctrl+C
        threading.Thread(target=boot, name="boot", daemon=True).start()
        try:
            while not self.stopped.wait(0.5):
                pass
        except KeyboardInterrupt:
            self.quit()
        return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    # Child processes of the packaged app (it has no python executable): `Shoal --shoal-module shoal.describe ...`
    if argv[:1] == ["--shoal-module"] and len(argv) >= 2:
        import runpy

        sys.argv = [argv[1], *argv[2:]]
        runpy.run_module(argv[1], run_name="__main__", alter_sys=True)
        return 0

    ap = argparse.ArgumentParser(prog="Shoal", description="Shoal 浅海生态模拟工作台")
    ap.add_argument("--headless", action="store_true", help="不显示托盘图标、不打开浏览器（测试与服务器用）")
    ap.add_argument("--no-browser", action="store_true", help="启动后不自动打开浏览器")
    ap.add_argument("--port", type=int, help=f"端口（默认 {PREFERRED_PORT}，被占用时自动换一个）")
    ap.add_argument("--version", action="version", version=f"Shoal {__version__}")
    args, _unknown = ap.parse_known_args(argv)  # macOS may pass -psn_… when launched from Finder

    logfile = _setup_logging()
    log.info("Shoal %s starting (frozen=%s, %s)", __version__, FROZEN, sys.platform)
    browser = not (args.headless or args.no_browser)
    if not args.port:
        try:
            running = find_running()
        except Exception:  # noqa: BLE001
            running = None
        if running:
            log.info("already running on port %s; opening the browser", running)
            if browser:
                open_browser(f"http://127.0.0.1:{running}/")
            return 0
    port = choose_port(args.port)
    log.info("serving on http://127.0.0.1:%s/ (log: %s)", port, logfile)
    return App(port, headless=args.headless, browser=browser).run()


if __name__ == "__main__":
    sys.exit(main())
