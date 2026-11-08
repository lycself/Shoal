"""Tray icon (Windows, Linux) / menu-bar icon (macOS) of the desktop launcher.

Menu: 打开 Shoal (also a left click on Windows) · running jobs · new version · 退出 Shoal.
On macOS, launching Shoal again while it runs sends the app a "reopen" event; it opens the browser too.
"""
from __future__ import annotations

import logging
import sys
import threading
from pathlib import Path

import pystray
from PIL import Image

log = logging.getLogger("shoal.tray")
ICON = Path(__file__).with_name("icon.png")


class Tray:
    def __init__(self, app):
        self.app = app
        self.ready = False
        self._jobs = 0
        self._update: str | None = None
        self._shown_key = None
        M = pystray.MenuItem
        menu = pystray.Menu(
            M(lambda _i: "打开 Shoal" if self.ready else "Shoal 正在启动…", self._open, default=True,
              enabled=lambda _i: self.ready),
            M(lambda _i: f"正在运行 {self._jobs} 个计算", None, enabled=False, visible=lambda _i: self._jobs > 0),
            M(lambda _i: f"有新版本 {self._update}，点击查看", self._open_update, visible=lambda _i: bool(self._update)),
            pystray.Menu.SEPARATOR,
            M(lambda _i: "退出 Shoal" + (f"（会停止 {self._jobs} 个计算）" if self._jobs else ""), self._quit),
        )
        self.icon = pystray.Icon("Shoal", Image.open(ICON), "Shoal（正在启动…）", menu=menu)

    # -- actions (pystray calls them on its own thread)
    def _open(self, *_):
        from .app import open_browser

        if self.ready:
            open_browser(self.app.url)

    def _open_update(self, *_):
        from .app import open_browser

        open_browser(self.app.url + "#update")

    def _quit(self, *_):
        threading.Thread(target=self.app.quit, name="quit", daemon=True).start()

    # -- state
    def set_ready(self) -> None:
        self.ready = True
        try:
            self.icon.title = f"Shoal（{self.app.url}）"
        except Exception:  # noqa: BLE001
            pass
        self._refresh(force=True)

    def notify_error(self, message: str) -> None:
        try:
            self.icon.notify(message, "Shoal 无法启动")
        except Exception:  # noqa: BLE001
            log.exception("notification failed")

    def _refresh(self, force: bool = False) -> None:
        try:
            from . import updater

            self._jobs = self.app.active_jobs()
            st = updater.state() if self.ready else {}
            self._update = (st.get("latest") or {}).get("version") if st.get("phase") == "available" else None
            key = (self.ready, self._jobs, self._update)
            if force or key != self._shown_key:
                self._shown_key = key
                self._on_main(self.icon.update_menu)
        except Exception:  # noqa: BLE001
            log.exception("tray refresh failed")

    @staticmethod
    def _on_main(fn) -> None:
        if sys.platform == "darwin":
            from PyObjCTools import AppHelper

            AppHelper.callAfter(fn)  # AppKit objects belong to the main thread
        else:
            fn()

    def _watch(self) -> None:
        while not self.app.stopped.wait(2.0):
            self._refresh()

    # -- run / stop
    def run(self, setup) -> None:
        def _setup(icon):
            icon.visible = True
            if sys.platform == "darwin":
                self._on_main(self._install_reopen_handler)
            threading.Thread(target=self._watch, name="tray-watch", daemon=True).start()
            setup()

        self.icon.run(setup=_setup)

    def stop(self) -> None:
        self.icon.stop()

    # -- macOS: "open Shoal" again while it runs
    def _install_reopen_handler(self) -> None:
        try:
            import objc  # noqa: F401
            from AppKit import NSAppleEventManager
            from Foundation import NSObject

            tray = self

            class ReopenHandler(NSObject):
                def handleReopen_withReplyEvent_(self, _event, _reply):
                    tray._open()

            self._reopen = ReopenHandler.alloc().init()  # keep a reference
            code = lambda s: int.from_bytes(s.encode(), "big")  # noqa: E731
            NSAppleEventManager.sharedAppleEventManager().setEventHandler_andSelector_forEventClass_andEventID_(
                self._reopen, "handleReopen:withReplyEvent:", code("aevt"), code("rapp"))
        except Exception:  # noqa: BLE001
            log.exception("could not install the reopen handler")
