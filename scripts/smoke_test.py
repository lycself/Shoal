"""End-to-end smoke test: start Shoal, let it seed the offline demo project, run one short GOTM simulation.

Used by CI on macOS, Linux and Windows, both for a source checkout and for the packaged app:

    .venv/bin/python scripts/smoke_test.py                      # backend from this checkout (uvicorn)
    .venv/bin/python scripts/smoke_test.py --app dist/Shoal/Shoal  # the packaged launcher (headless)

Only the standard library is used, so it can drive a packaged app from any Python. A fresh temporary
workspace is used, and the update check points at an unreachable address on purpose: the app must keep
running when the check fails.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Api:
    def __init__(self, port: int):
        self.base = f"http://127.0.0.1:{port}/api"

    def call(self, path: str, data: dict | None = None, method: str | None = None):
        body = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(self.base + path, data=body, method=method or ("POST" if body else "GET"),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"null")


def wait(what: str, fn, timeout: float, proc: subprocess.Popen, every: float = 1.0):
    end = time.monotonic() + timeout
    last = None
    while time.monotonic() < end:
        if proc.poll() is not None:
            raise SystemExit(f"!! Shoal exited with code {proc.returncode} while waiting for {what}")
        try:
            value = fn()
            if value:
                return value
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:
            last = e
        time.sleep(every)
    raise SystemExit(f"!! timed out waiting for {what} (last error: {last})")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", help="packaged Shoal executable to test instead of the source backend")
    ap.add_argument("--timeout", type=float, default=600)
    args = ap.parse_args()

    port = free_port()
    work = Path(tempfile.mkdtemp(prefix="shoal-smoke-"))
    env = {**os.environ, "SHOAL_WORKSPACE": str(work), "SHOAL_USER_DATA": str(work / "user-data"), "PYTHONUTF8": "1",
           "SHOAL_NO_BROWSER": "1",
           # the update check must fail here; the app has to stay up regardless
           "SHOAL_UPDATE_URL": "http://127.0.0.1:9/update.json", "SHOAL_UPDATE_DELAY": "1"}
    if args.app:
        cmd = [args.app, "--headless", "--port", str(port)]
        cwd = None
    else:
        cmd = [sys.executable, "-m", "uvicorn", "shoal.server:app", "--host", "127.0.0.1", "--port", str(port)]
        cwd = REPO / "backend"
    print(">> starting:", " ".join(cmd), flush=True)
    log = open(work / "shoal.log", "w", encoding="utf-8")
    proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
    api = Api(port)
    try:
        health = wait("the API", lambda: api.call("/health"), 120, proc)
        print(">> API up:", health, flush=True)
        kernel = api.call("/kernel")["kernel"]
        print(">> kernel: gotm", kernel["gotm_available"], "pyfabm", kernel["pyfabm_available"], flush=True)
        if not (kernel["gotm_available"] and kernel["pyfabm_available"]):
            raise SystemExit("!! kernel incomplete")

        def demo():
            for p in api.call("/projects"):
                if p.get("site_status") == "ready":
                    return p
                if p.get("site_status") in ("failed", "missing"):
                    raise SystemExit(f"!! demo site failed: {p}")
            return None
        project = wait("the offline demo project", demo, 180, proc, every=2)
        pid = project["id"]
        configs = api.call(f"/projects/{pid}/configs")
        configs = configs if isinstance(configs, list) else configs.get("configs", [])
        # LTL only: needs neither the official ECOSMO E2E code nor network access
        cfg = next(c for c in configs if "仅低营养级" in c["name"])
        run = api.call(f"/projects/{pid}/runs", {"items": [{"config_id": cfg["id"], "label": "smoke"}],
                                                 "simulation": {"spinup_years": 0, "years": 1}})[0]
        rid = run["id"]
        print(f">> running {cfg['name']} ({rid})", flush=True)

        def finished():
            r = api.call(f"/projects/{pid}/runs/{rid}")
            r = r.get("run", r)
            if r["status"] in ("done", "failed", "cancelled"):
                return r
            return None
        r = wait("the simulation", finished, args.timeout, proc, every=3)
        if r["status"] != "done":
            raise SystemExit(f"!! simulation {r['status']}: {r.get('error')}")
        variables = api.call(f"/projects/{pid}/runs/{rid}/variables")
        print(f">> simulation done in {r.get('elapsed')} s, {len(variables)} output variables", flush=True)
        if proc.poll() is not None:
            raise SystemExit("!! Shoal exited after the run")
        print(">> smoke test passed", flush=True)
    except BaseException:
        log.flush()
        print("---- Shoal log ----\n" + (work / "shoal.log").read_text(encoding="utf-8", errors="replace")[-8000:])
        raise
    finally:
        if args.app and proc.poll() is None:
            try:
                api.call("/app/quit", {})
            except Exception:
                pass
            try:
                proc.wait(20)
            except subprocess.TimeoutExpired:
                pass
        if proc.poll() is None:
            proc.kill()
        log.close()


if __name__ == "__main__":
    main()
