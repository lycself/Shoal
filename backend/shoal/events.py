"""In-process event bus: background jobs publish, WebSocket clients subscribe."""
from __future__ import annotations

import asyncio
import copy
import threading
import time
from typing import Any

_loop: asyncio.AbstractEventLoop | None = None
_queues: set[asyncio.Queue] = set()
_lock = threading.Lock()


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=1000)
    with _lock:
        _queues.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    with _lock:
        _queues.discard(q)


def emit(name: str, payload: Any = None) -> None:
    """Thread-safe; payload is deep-copied at emit time."""
    msg = {"event": name, "payload": copy.deepcopy(payload), "t": time.time()}
    loop = _loop
    if loop is None:
        return
    with _lock:
        qs = list(_queues)
    for q in qs:
        def put(q=q):
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(msg)
        try:
            loop.call_soon_threadsafe(put)
        except RuntimeError:
            pass
