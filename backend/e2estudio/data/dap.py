"""Minimal OPeNDAP ASCII client (plain HTTP, no netCDF4 / HDF5 and therefore no global lock)."""
from __future__ import annotations

import re
import time

import httpx
import numpy as np

FILL = 9.0e36


def _get(url: str, retries: int = 4) -> str:
    last = ""
    for a in range(retries):
        try:
            with httpx.Client(timeout=120, follow_redirects=True) as c:
                r = c.get(url)
                r.raise_for_status()
                return r.text
        except Exception as e:
            last = str(e)
            time.sleep(2 * (a + 1))
    raise RuntimeError(f"OPeNDAP 请求失败：{url}（{last}）")


def fetch(url: str, constraint: str) -> dict[str, np.ndarray]:
    """Arrays of an OPeNDAP ASCII response, keyed by variable name (grid maps included)."""
    text = _get(f"{url}.ascii?{constraint}")
    body = text.split("---------------------------------------------", 1)[-1]
    out: dict[str, np.ndarray] = {}
    for block in re.split(r"\n\s*\n", body.strip()):
        lines = [l for l in block.strip().splitlines() if l.strip()]
        if not lines:
            continue
        m = re.match(r"^([\w.]+)((?:\[\d+\])+)\s*$", lines[0].strip())
        if not m:
            continue
        name = m.group(1).split(".")[-1]
        shape = [int(x) for x in re.findall(r"\[(\d+)\]", m.group(2))]
        vals: list[float] = []
        for l in lines[1:]:
            l = re.sub(r"^(\[\d+\])+,?", "", l.strip())
            vals.extend(float(v) for v in l.split(",") if v.strip())
        arr = np.array(vals, dtype=float)
        if arr.size == int(np.prod(shape)):
            arr = arr.reshape(shape)
        arr[np.abs(arr) > FILL] = np.nan
        out[name] = arr
    return out
