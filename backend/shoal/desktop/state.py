"""What the web API needs to know about the desktop launcher (set by shoal.desktop.app)."""
from __future__ import annotations

import threading
from typing import Callable

desktop = False  # True when the server runs inside the packaged/desktop launcher
url: str | None = None
_quit: Callable[[], None] | None = None
_lock = threading.Lock()


def set_quit(fn: Callable[[], None]) -> None:
    global _quit
    with _lock:
        _quit = fn


def request_quit() -> bool:
    """Ask the launcher to shut down (cancels running jobs, stops the server, removes the icon)."""
    with _lock:
        fn = _quit
    if fn is None:
        return False
    threading.Thread(target=fn, name="quit", daemon=True).start()
    return True
