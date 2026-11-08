"""Background job runner.

Jobs:
* ``site``   — download / build a project's site forcing
* ``run``    — one GOTM simulation (prepare run dir, start gotm, follow progress)
* ``shelf``  — 3D column ensemble (many GOTM columns, see threed/columns.py)

GOTM runs execute as subprocesses in a thread pool sized by the
``max_parallel_runs`` setting. Progress of a GOTM run is read from the NetCDF
output (``sync_interval: 1`` makes GOTM flush every output step).
"""
from __future__ import annotations

import datetime as dt
import os
import signal
import subprocess
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import events, projects
from .config import gotm_executable, gotm_popen_kwargs, load_settings
from .runs import prepare_run
from .sites import builder as sites


def _now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


class Job:
    def __init__(self, kind: str, project: str, label: str, **meta):
        self.id = uuid.uuid4().hex[:10]
        self.kind = kind
        self.project = project
        self.label = label
        self.meta = meta
        self.status = "queued"
        self.progress = 0.0
        self.message = ""
        self.error: str | None = None
        self.created = _now()
        self.started: str | None = None
        self.finished: str | None = None
        self.proc: subprocess.Popen | None = None
        self.cancel_requested = False

    def to_dict(self) -> dict:
        return {
            "id": self.id, "kind": self.kind, "project": self.project, "label": self.label,
            "status": self.status, "progress": round(self.progress, 4), "message": self.message,
            "error": self.error, "created": self.created, "started": self.started, "finished": self.finished,
            **{k: v for k, v in self.meta.items() if isinstance(v, (str, int, float, bool, type(None)))},
        }


class Runner:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.lock = threading.Lock()
        n = int(load_settings().get("max_parallel_runs", 2))
        self.pool = ThreadPoolExecutor(max_workers=max(1, n), thread_name_prefix="gotm")
        self.io_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="io")

    # ------------------------------------------------------------ helpers
    def _emit(self, job: Job) -> None:
        events.emit("job", job.to_dict())

    def list(self) -> list[dict]:
        with self.lock:
            jobs = list(self.jobs.values())
        jobs.sort(key=lambda j: j.created, reverse=True)
        return [j.to_dict() for j in jobs[:200]]

    def active_for_project(self, pid: str) -> list[Job]:
        with self.lock:
            return [j for j in self.jobs.values() if j.project == pid and j.status in ("queued", "running")]

    def cancel(self, job_id: str) -> None:
        job = self.jobs.get(job_id)
        if not job:
            return
        job.cancel_requested = True
        if job.proc and job.proc.poll() is None:
            try:
                if os.name == "nt":
                    job.proc.terminate()  # gotm.exe has no children; TerminateProcess is enough
                else:
                    os.killpg(os.getpgid(job.proc.pid), signal.SIGTERM)
            except Exception:
                job.proc.terminate()
        if job.status == "queued":
            job.status = "cancelled"
            job.finished = _now()
            self._emit(job)
            if job.kind == "run":
                self._update_run_record(job, status="cancelled")

    # ------------------------------------------------------------ site job
    def build_site(self, pid: str) -> dict:
        for j in self.active_for_project(pid):
            if j.kind == "site":
                return j.to_dict()
        proj = projects.get_project(pid)
        job = Job("site", pid, f"构建站点：{proj['site'].get('name', '')}")
        with self.lock:
            self.jobs[job.id] = job
        projects.update_project(pid, {"site_status": "building"})
        self.io_pool.submit(self._site_worker, job)
        self._emit(job)
        return job.to_dict()

    def _site_worker(self, job: Job) -> None:
        job.status = "running"
        job.started = _now()
        self._emit(job)
        d = projects.project_dir(job.project)
        proj = projects.get_project(job.project)
        spec = proj["site"]
        last = [0.0]

        def progress(msg: str, frac: float):
            job.message = msg
            job.progress = max(0.0, min(1.0, frac))
            if time.time() - last[0] > 0.3:
                last[0] = time.time()
                self._emit(job)

        try:
            site_dir = d / "site"
            if spec["kind"] == "generated":
                sites.build_generated_site(site_dir, dict(spec), progress)
            elif spec["kind"] == "gotm_case":
                sites.build_case_site(site_dir, spec["case"])
            elif spec["kind"] == "imported":
                sites.import_site(site_dir, Path(spec["path"]))
            info = sites.load_site(site_dir) or {}
            if spec["kind"] == "generated" and info.get("depth") and not spec.get("depth"):
                spec["depth"] = info["depth"]
            p = projects._read(d / "project.json")
            p["site_status"] = "ready"
            p["site"] = spec
            # keep roughly 1 m vertical resolution (as in Vijayakumaran et al.: 83 levels for 83 m)
            # when the template's level count is grossly mismatched with the new site's depth
            depth = spec.get("depth") or info.get("depth")
            sim = p.get("simulation", {})
            if depth and sim.get("nlev") and abs(sim["nlev"] - depth) / depth > 0.5:
                sim["nlev"] = int(max(10, min(150, round(depth))))
                p["simulation"] = sim
            projects._write(d / "project.json", p)
            job.status = "done"
            job.progress = 1.0
            job.message = "站点就绪"
        except Exception as e:
            job.status = "failed"
            job.error = str(e)
            traceback.print_exc()
            p = projects._read(d / "project.json")
            p["site_status"] = "error"
            p["site_error"] = str(e)
            projects._write(d / "project.json", p)
        job.finished = _now()
        self._emit(job)
        events.emit("project", {"id": job.project})

    # ------------------------------------------------------------- run job
    def start_runs(self, pid: str, items: list[dict], experiment_id: str | None = None,
                   sim_override: dict | None = None) -> list[dict]:
        """items: [{config_id, label}] — one GOTM run each."""
        proj = projects.get_project(pid)
        if proj.get("site_status") != "ready":
            raise RuntimeError("站点数据尚未构建，请先在“站点”页构建站点")
        if gotm_executable() is None:
            raise RuntimeError("找不到 GOTM 内核，请先运行 pnpm kernel")
        sim = dict(proj["simulation"])
        if sim_override:
            sim.update(sim_override)
        out = []
        batch = uuid.uuid4().hex[:6]
        for it in items:
            cfg = projects.get_config(pid, it["config_id"])
            rid = f"{dt.datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}"
            run = {
                "id": rid, "label": it.get("label") or cfg["name"], "config_id": cfg["id"], "config_name": cfg["name"],
                "experiment_id": experiment_id, "batch": batch, "spec": cfg["spec"], "simulation": sim,
                "status": "queued", "created": _now(), "progress": 0.0,
            }
            projects.write_run(pid, run)
            job = Job("run", pid, run["label"], run_id=rid, experiment_id=experiment_id)
            with self.lock:
                self.jobs[job.id] = job
            run["job_id"] = job.id
            projects.write_run(pid, run)
            self.pool.submit(self._run_worker, job, sim)
            self._emit(job)
            out.append(run)
        events.emit("runs", {"project": pid})
        return out

    def _update_run_record(self, job: Job, **fields) -> None:
        try:
            run = projects.get_run(job.project, job.meta["run_id"])
            run.update(fields)
            projects.write_run(job.project, run)
        except Exception:
            pass
        events.emit("run", {"project": job.project, "run_id": job.meta["run_id"], **fields})

    def _run_worker(self, job: Job, sim: dict) -> None:
        if job.cancel_requested:
            return
        job.status = "running"
        job.started = _now()
        job.message = "准备配置"
        self._emit(job)
        pid, rid = job.project, job.meta["run_id"]
        rdir = projects.run_dir(pid, rid)
        t0 = time.time()
        try:
            run = projects.get_run(pid, rid)
            d = projects.project_dir(pid)
            site = sites.load_site(d / "site")
            info = prepare_run(rdir, d / "site", site, sim, run["spec"])
            self._update_run_record(job, status="running", started=job.started, timing=info["timing"], n_output=info["n_output"])
            total_days = (dt.date.fromisoformat(info["timing"]["stop"][:10]) - dt.date.fromisoformat(info["timing"]["start"][:10])).days
            exe = str(gotm_executable())
            with open(rdir / "gotm.log", "w") as log:
                job.proc = subprocess.Popen([exe, "gotm.yaml"], cwd=rdir, stdout=log, stderr=subprocess.STDOUT,
                                            **gotm_popen_kwargs())
                job.message = "GOTM 运行中"
                last_emit = 0.0
                while job.proc.poll() is None:
                    time.sleep(1.0)
                    days = _nc_days(rdir / "result.nc")
                    if days is not None and total_days > 0:
                        job.progress = min(0.999, days / total_days)
                        job.message = f"已模拟 {days} / {total_days} 天"
                    if time.time() - last_emit > 1.0:
                        last_emit = time.time()
                        self._emit(job)
                        events.emit("run", {"project": pid, "run_id": rid, "status": "running", "progress": job.progress})
                rc = job.proc.returncode
            if job.cancel_requested:
                job.status = "cancelled"
            elif rc != 0:
                job.status = "failed"
                job.error = _log_error(rdir / "gotm.log") or f"GOTM 退出码 {rc}"
            else:
                job.status = "done"
                job.progress = 1.0
                job.message = "完成"
        except Exception as e:
            job.status = "failed"
            job.error = str(e)
            traceback.print_exc()
        job.finished = _now()
        elapsed = round(time.time() - t0, 1)
        self._update_run_record(job, status=job.status, finished=job.finished, elapsed=elapsed, error=job.error,
                                progress=job.progress)
        self._emit(job)


def _nc_days(path: Path) -> int | None:
    if not path.exists():
        return None
    from .nclock import NC_LOCK

    try:
        import netCDF4

        with NC_LOCK:
            with netCDF4.Dataset(path) as ds:
                return len(ds.dimensions["time"])
    except Exception:
        return None


def _log_error(path: Path) -> str | None:
    try:
        lines = path.read_text(errors="replace").splitlines()
    except Exception:
        return None
    hits = [i for i, l in enumerate(lines) if "FATAL" in l or "ERROR" in l or "UNFULFILLED" in l]
    if hits:
        i = hits[0]
        return "\n".join(l.strip() for l in lines[i : i + 6])
    return "\n".join(lines[-5:])


RUNNER: Runner | None = None


def get_runner() -> Runner:
    global RUNNER
    if RUNNER is None:
        RUNNER = Runner()
    return RUNNER
