"""Automatic updates must never take Shoal down (AVAS crashed at start-up when its update check failed).

Run:  node scripts/venv.mjs -m unittest discover -s backend/tests -t backend -v
"""
from __future__ import annotations

import hashlib
import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("SHOAL_USER_DATA", tempfile.mkdtemp(prefix="shoal-test-data-"))

from shoal.desktop import updater  # noqa: E402
from shoal.version import __version__  # noqa: E402


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class FakeReleaseServer:
    """Serves /update.json and /pkg with whatever a test asks for (or hangs, or returns garbage)."""

    def __init__(self):
        self.manifest: bytes | None = None
        self.status = 200
        self.hang = 0.0
        self.package = b"new version"
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                time.sleep(outer.hang)
                body = outer.manifest if self.path.startswith("/update.json") else outer.package
                self.send_response(outer.status if self.path.startswith("/update.json") else 200)
                self.send_header("Content-Length", str(len(body or b"")))
                self.end_headers()
                try:
                    self.wfile.write(body or b"")
                except OSError:
                    pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/update.json"

    def release(self, version: str, sha: str | None = None) -> None:
        sha = sha or hashlib.sha256(self.package).hexdigest()
        self.manifest = json.dumps({
            "schema": 1, "app": "shoal", "version": version, "tag": f"v{version}", "notes": "测试版本",
            "published": "2026-11-08T00:00:00Z",
            "assets": {updater.platform_key(): {"name": "pkg", "url": f"http://127.0.0.1:{self.port}/pkg",
                                                "sha256": sha, "size": len(self.package)}}}).encode()

    def close(self):
        self.httpd.shutdown()


class VersionTests(unittest.TestCase):
    def test_compare(self):
        self.assertTrue(updater.is_newer("1.0.1", "1.0.0"))
        self.assertTrue(updater.is_newer("v1.10", "1.9.9"))
        self.assertFalse(updater.is_newer("1.0", "1.0.0"))
        self.assertFalse(updater.is_newer("0.9.9", "1.0.0"))
        with self.assertRaises(ValueError):
            updater.parse_version("latest")


class CheckNeverRaises(unittest.TestCase):
    def setUp(self):
        self.server = FakeReleaseServer()
        os.environ["SHOAL_UPDATE_URL"] = self.server.url

    def tearDown(self):
        self.server.close()
        os.environ.pop("SHOAL_UPDATE_URL", None)

    def test_unreachable(self):
        os.environ["SHOAL_UPDATE_URL"] = f"http://127.0.0.1:{free_port()}/update.json"
        st = updater.check()
        self.assertEqual(st["phase"], "error")
        self.assertIn("GitHub", st["error"])

    def test_not_published(self):
        self.server.status, self.server.manifest = 404, b"Not Found"
        st = updater.check()
        self.assertEqual(st["phase"], "error")
        self.assertIn("还没有发布", st["error"])

    def test_garbage(self):
        for body in (b"<html>captive portal</html>", b"[]", b'{"schema": 2}', b'{"schema":1,"app":"shoal","version":"x"}'):
            self.server.manifest = body
            st = updater.check()
            self.assertEqual(st["phase"], "error", body)

    def test_newer_and_same(self):
        major = int(__version__.split(".")[0])
        self.server.release(f"{major + 1}.0.0")
        st = updater.check()
        self.assertEqual(st["phase"], "available")
        self.assertEqual(st["latest"]["version"], f"{major + 1}.0.0")
        self.server.release(__version__)
        self.assertEqual(updater.check()["phase"], "latest")

    def test_official_url_only_for_default_manifest(self):
        self.server.release("99.0.0")
        manifest = json.loads(self.server.manifest)
        with self.assertRaises(ValueError):
            updater.validate(manifest, updater.DEFAULT_URL)

    def test_background_thread_survives_failures(self):
        os.environ["SHOAL_UPDATE_URL"] = f"http://127.0.0.1:{free_port()}/update.json"
        updater._started = False
        updater._stop.clear()
        updater.start_background(delay=0, interval=0.05)
        try:
            time.sleep(0.5)
            names = [t.name for t in threading.enumerate()]
            self.assertIn("update-check", names)
            # the unreachable server is retried a few times, then reported as an error (on Windows each
            # refused connection to localhost takes about 2 s, so this can take ~12 s)
            for _ in range(400):
                if updater.state()["phase"] == "error":
                    break
                time.sleep(0.1)
            self.assertEqual(updater.state()["phase"], "error")
        finally:
            updater._stop.set()
            for t in threading.enumerate():
                if t.name == "update-check":
                    t.join(60)  # never let this thread leak into the next test
                    self.assertFalse(t.is_alive())


class InstallFailuresAreReported(unittest.TestCase):
    def setUp(self):
        self.server = FakeReleaseServer()

    def tearDown(self):
        self.server.close()

    def test_checksum_mismatch(self):
        self.server.release("99.0.0", sha="0" * 64)
        manifest = json.loads(self.server.manifest)
        quit_called = threading.Event()
        updater._install_worker(manifest, quit_called.set)
        st = updater.state()
        self.assertEqual(st["phase"], "error")
        self.assertIn("校验失败", st["error"])
        self.assertFalse(quit_called.is_set(), "a failed update must not quit the app")

    def test_corrupt_previous_result(self):
        (updater.updates_dir() / "result.json").write_text("{not json", encoding="utf-8")
        updater.read_previous_result()  # must not raise
        (updater.updates_dir() / "result.json").write_text('{"ok": false, "code": "swap"}', encoding="utf-8")
        updater.read_previous_result()
        self.assertIn("恢复", updater.state()["result"]["message"])


class LauncherSurvivesUpdateProblems(unittest.TestCase):
    """Start the real launcher headless; the update check fails in various ways; the app stays up and quits cleanly."""

    def launch(self, update_url: str):
        port = free_port()
        data = tempfile.mkdtemp(prefix="shoal-launch-")
        env = {**os.environ, "SHOAL_USER_DATA": data, "SHOAL_WORKSPACE": str(Path(data) / "ws"),
               "SHOAL_UPDATE_URL": update_url, "SHOAL_UPDATE_DELAY": "0", "PYTHONUTF8": "1"}
        proc = subprocess.Popen([sys.executable, "-m", "shoal.desktop", "--headless", "--port", str(port)],
                                cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(lambda: proc.poll() is None and proc.kill())
        base = f"http://127.0.0.1:{port}/api"
        for _ in range(240):
            self.assertIsNone(proc.poll(), "launcher exited during start-up")
            try:
                with urllib.request.urlopen(base + "/health", timeout=1) as r:
                    if json.loads(r.read()).get("app") == "shoal":
                        break
            except OSError:
                time.sleep(0.25)
        else:
            self.fail("launcher did not come up")
        return proc, base

    def get(self, url):
        with urllib.request.urlopen(url, timeout=5) as r:
            return json.loads(r.read())

    def wait_phase(self, proc, base, phase, timeout=60):
        """Poll until the update check settles, asserting the app stays up the whole time."""
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            self.assertIsNone(proc.poll(), "launcher exited while the update check failed")
            info = self.get(base + "/app")
            if info["update"]["phase"] == phase:
                return info
            time.sleep(0.5)
        self.fail(f"update phase never became {phase!r}: {info['update']}")

    def quit(self, proc, base):
        req = urllib.request.Request(base + "/app/quit", data=b"{}", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5).read()
        self.assertEqual(proc.wait(30), 0)

    def test_unreachable_update_server(self):
        proc, base = self.launch(f"http://127.0.0.1:{free_port()}/update.json")
        info = self.wait_phase(proc, base, "error")
        self.assertTrue(info["desktop"])
        self.quit(proc, base)

    def test_hanging_and_garbage_update_server(self):
        server = FakeReleaseServer()
        self.addCleanup(server.close)
        server.hang, server.manifest = 4, b"\x00garbage"
        proc, base = self.launch(server.url)
        # the app answers while the check is still hanging
        self.assertTrue(self.get(base + "/health")["ok"])
        self.wait_phase(proc, base, "error", timeout=60)
        self.quit(proc, base)


if __name__ == "__main__":
    unittest.main()
