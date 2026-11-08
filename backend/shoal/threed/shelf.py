"""Shelf-scale simulations as an ensemble of GOTM–FABM water columns.

Each wet grid cell of a lat/lon box gets its own column with ETOPO depth, ERA5
meteorology and WOA23 climatological profiles; every column is run with each
selected ecosystem configuration. Results are condensed to annual-mean
indicators and monthly climatologies per cell for map views, so e.g. the
difference between one-way and two-way coupled fish (Powley et al. 2026,
Figs. 3-7) can be mapped across the North West European Shelf.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import shutil
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np

from .. import events, projects, yamlio
from ..config import gotm_executable, kernel_env
from ..data import sources
from ..ecosystem import builder
from ..ecosystem.hosts import HOSTS
from ..runs import describe_fabm, select_output
from ..sites import builder as sites
from . import resources
from ..nclock import locked as _locked

AMM7_SHELF = [48.0, 62.0, -12.0, 10.0]  # lat0, lat1, lon0, lon1 — shelf part of the AMM7 domain
MAP_VARS = ["temp", "F1_c", "F2_c", "MB_c", "fish_c_tot", "Z4_c", "ECO_mesozoo", "ergom_zz"]


def _now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def shelf_dir(pid: str) -> Path:
    d = projects.project_dir(pid) / "shelf"
    d.mkdir(exist_ok=True)
    return d


def check_box(box: list[float]) -> None:
    lat0, lat1, lon0, lon1 = box
    if not (-90 <= lat0 < lat1 <= 90):
        raise ValueError("区域的南界必须小于北界（纬度 −90…90）")
    if not (-180 <= lon0 < lon1 <= 180):
        raise ValueError("区域的西界必须小于东界（经度 −180…180）；跨越 180° 经线的区域暂不支持，请分成两部分")


def plan_grid(box: list[float], res: float, min_depth: float, max_depth: float) -> dict:
    check_box(box)
    lat0, lat1, lon0, lon1 = box
    stride = max(1, int(round(res * 60 / 6)))  # ~6x6 ETOPO samples per cell
    g = sources.etopo_grid(lat0, lat1, lon0, lon1, stride=stride)
    lats = np.array(g["lat"])
    lons = np.array(g["lon"])
    z = np.array(g["altitude"], dtype=float)
    points = []
    nlat = int(math.floor((lat1 - lat0) / res))
    nlon = int(math.floor((lon1 - lon0) / res))
    for i in range(nlat):
        for j in range(nlon):
            la0, lo0 = lat0 + i * res, lon0 + j * res
            mi = (lats >= la0) & (lats < la0 + res)
            mj = (lons >= lo0) & (lons < lo0 + res)
            cell = z[np.ix_(mi, mj)]
            cell = cell[np.isfinite(cell)]
            if cell.size == 0:
                continue
            wet = cell[cell < 0]
            if wet.size < 0.5 * cell.size:
                continue  # mostly land
            d = float(-np.mean(wet))
            if d < min_depth or d > max_depth:
                continue
            points.append({"i": len(points), "lat": round(la0 + res / 2, 4), "lon": round(lo0 + res / 2, 4), "depth": round(d, 1)})
    return {"box": box, "res": res, "points": points}


def landmask(box: list[float], res: float = 0.1) -> dict:
    # maps near the poles or the date line ask for a little beyond the data: clip instead of failing
    lat0, lat1 = max(-89.9, box[0]), min(89.9, box[1])
    lon0, lon1 = max(-180.0, box[2]), min(180.0, box[3])
    if lat0 >= lat1 or lon0 >= lon1:
        raise ValueError("地图范围无效（跨越 180° 经线的范围暂不支持）")
    base = max(1, int(round(res * 60)))
    g, err = None, None
    # try the requested resolution, then coarser ones (ERDDAP refuses or times out on very large requests)
    for stride in (base, base * 2, base * 4, max(base * 8, 12)):
        try:
            g = sources.etopo_grid(lat0, lat1, lon0, lon1, stride=stride)
            break
        except Exception as e:  # noqa: BLE001
            err = e
    if g is None:
        raise RuntimeError(f"无法获取 ETOPO 水深（{err}）")
    z = np.array(g["altitude"], dtype=float)
    z = np.where(np.isfinite(z), z, 0.0)
    return {"lat": g["lat"], "lon": g["lon"], "alt": z.round(0).astype(int).tolist()}


def _calibration(pid: str, spec: dict) -> float | None:
    """Seconds per simulated column-year from a finished 1D run with the same host + HTL."""
    best = None
    for r in projects.list_runs(pid):
        if r.get("status") != "done" or not r.get("elapsed") or not r.get("timing"):
            continue
        s = r.get("spec", {})
        if s.get("host") == spec["host"] and s.get("htl", {}).get("kind") == spec["htl"]["kind"]:
            years = len(r["timing"].get("years", [])) or 1
            nlev = r["timing"].get("nlev", 30)
            dt_ = r["timing"].get("dt", 1800)
            per = r["elapsed"] / years * (30.0 / nlev) * (dt_ / 1800.0)
            best = per if best is None else min(best, per)
    return best


def estimate_study(pid: str, study: dict) -> dict:
    n = len(study["points"])
    configs = [projects.get_config(pid, cid) for cid in study["config_ids"]]
    est = None
    total_wall = 0.0
    parts = []
    for c in configs:
        spec = builder.normalize_spec(c["spec"])
        cal = _calibration(pid, spec)
        if cal:
            cal = cal * (study["nlev"] / 30.0) * (1800.0 / study["dt"])
        e = resources.estimate(n, study["years"], study["nlev"], study["dt"], spec["host"], spec["htl"]["kind"], cal)
        parts.append({"config": c["name"], "wall_minutes": e["wall_minutes"], "basis": e["basis"]})
        total_wall += e["wall_minutes"]
        est = e if est is None else est
    if est is None:
        est = resources.estimate(n, study["years"], study["nlev"], study["dt"], "ersem", "none")
    est = dict(est)
    est["wall_minutes"] = round(total_wall, 1)
    est["per_config"] = parts
    est["disk_gb"] = round(est["disk_gb"] * max(1, len(configs)), 2)
    if total_wall > 180:
        est["level"] = "heavy"
        if not any("3 小时" in w for w in est["warnings"]):
            est["warnings"].insert(0, "预计总耗时超过 3 小时：建议降低分辨率、减少年数或配置数量。")
    elif total_wall > 30 and est["level"] == "ok":
        est["level"] = "moderate"
    return est


# ------------------------------------------------------------------ CRUD
def list_studies(pid: str) -> list[dict]:
    out = []
    for f in sorted(shelf_dir(pid).glob("*/study.json")):
        s = json.loads(f.read_text())
        s.pop("points", None)
        out.append(s)
    return out


def get_study(pid: str, sid: str) -> dict:
    study = json.loads((shelf_dir(pid) / sid / "study.json").read_text())
    if study.get("status") == "done":
        # records finished before errors were cleared on completion may still carry a stale message
        study.pop("error", None)
        study["progress"] = 1.0
    return study


def save_study(pid: str, study: dict) -> None:
    d = shelf_dir(pid) / study["id"]
    d.mkdir(exist_ok=True)
    (d / "study.json").write_text(json.dumps(study, ensure_ascii=False, indent=1))


def create_study(pid: str, data: dict) -> dict:
    grid = plan_grid(data["box"], float(data["res"]), float(data.get("min_depth", 15)), float(data.get("max_depth", 200)))
    sid = f"{dt.datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}"
    study = {
        "id": sid, "name": data.get("name") or f"陆架 {data['res']}°", "box": data["box"], "res": float(data["res"]),
        "min_depth": float(data.get("min_depth", 15)), "max_depth": float(data.get("max_depth", 200)),
        "forcing_year": int(data.get("forcing_year", 2014)), "years": int(data.get("years", 3)),
        "nlev": int(data.get("nlev", 30)), "dt": float(data.get("dt", 1800)), "tide_scale": float(data.get("tide_scale", 1.0)),
        "config_ids": list(data.get("config_ids", [])), "points": grid["points"], "status": "planned",
        "created": _now(), "progress": 0.0,
    }
    save_study(pid, study)
    study["estimate"] = estimate_study(pid, study)
    save_study(pid, study)
    return study


def delete_study(pid: str, sid: str) -> None:
    shutil.rmtree(shelf_dir(pid) / sid, ignore_errors=True)


# --------------------------------------------------------------- running
class ShelfJob:
    def __init__(self, runner, pid: str, sid: str, only: list | None = None):
        from ..runner import Job

        self.runner = runner
        self.job = Job("shelf", pid, f"陆架集合：{get_study(pid, sid)['name']}", study_id=sid)
        self.pid, self.sid = pid, sid
        # rerun just these configs (e.g. after changing one), keeping the other configs' results
        self.only = [c for c in (only or []) if c in get_study(pid, sid)["config_ids"]] or None

    def start(self) -> dict:
        with self.runner.lock:
            self.runner.jobs[self.job.id] = self.job
        threading_start(self.run)
        self.runner._emit(self.job)
        return self.job.to_dict()

    def _progress(self, msg: str, frac: float) -> None:
        self.job.message = msg
        self.job.progress = frac
        self.runner._emit(self.job)

    def run(self) -> None:
        job = self.job
        job.status = "running"
        job.started = _now()
        study = get_study(self.pid, self.sid)
        study["status"] = "running"
        save_study(self.pid, study)
        d = shelf_dir(self.pid) / self.sid
        try:
            pts = study["points"]
            if not pts:
                raise RuntimeError("网格内没有符合水深条件的海洋格点")
            lat0, lat1, lon0, lon1 = study["box"]
            Y = study["forcing_year"]
            # 1. forcing
            met = sources.era5_multi([(p["lat"], p["lon"]) for p in pts], Y,
                                     progress=lambda m, f: self._progress(m, 0.15 * f))
            woa = sources.woa_box(lat0, lat1, lon0, lon1, ["temperature", "salinity", "nitrate", "phosphate", "silicate", "oxygen"],
                                  progress=lambda m, f: self._progress(m, 0.15 + 0.1 * f))
            # 2. column sites
            cols = d / "columns"
            cols.mkdir(exist_ok=True)
            valid = []
            for p, m in zip(pts, met):
                if not m or not m.get("time"):
                    continue
                prof = sources.woa_point_from_box(woa, p["lat"], p["lon"], ["temperature", "salinity", "nitrate", "phosphate", "silicate", "oxygen"])
                if prof is None:
                    continue
                cdir = cols / f"{p['i']:05d}"
                cdir.mkdir(exist_ok=True)
                (cdir / "meteo_era5.dat").write_text("\n".join(sources.era5_to_gotm_meteo(m)) + "\n")
                (cdir / "woa.json").write_text(json.dumps(prof))
                site = {"kind": "generated", "name": f"{p['lat']:.2f}N {p['lon']:.2f}E", "lat": p["lat"], "lon": p["lon"],
                        "depth": p["depth"], "forcing_years": [Y, Y]}
                (cdir / "site.json").write_text(json.dumps(site))
                valid.append((p, cdir, site))
            sim = {"mode": "repeat", "repeat_year": Y, "years": 1, "spinup_years": study["years"] - 1,
                   "dt": study["dt"], "nlev": study["nlev"], "relax_ts_days": 30.0, "relax_nut_days": 365.0,
                   "relax_nutrients": True, "output_unit": "month", "tide_scale": float(study.get("tide_scale", 1.0))}
            # 3. run all configs x columns
            exe = str(gotm_executable())
            run_ids = self.only or study["config_ids"]
            n_total = len(valid) * len(run_ids)
            done = 0
            for cid in run_ids:
                cfg = projects.get_config(self.pid, cid)
                spec = builder.normalize_spec(cfg["spec"])
                host = HOSTS[spec["host"]]
                tmpl_dir = d / f"cfg_{cid}"
                tmpl_dir.mkdir(exist_ok=True)
                yamlio.dump(builder.build_fabm_yaml(spec), tmpl_dir / "fabm.yaml")
                out_vars = select_output(describe_fabm(tmpl_dir / "fabm.yaml"))
                results = []
                workers = max(1, self.runner.pool._max_workers)

                def one(item):
                    p, cdir, site = item
                    rdir = cdir / f"run_{cid}"
                    rdir.mkdir(exist_ok=True)
                    shutil.copy2(tmpl_dir / "fabm.yaml", rdir / "fabm.yaml")
                    timing = sites.make_gotm_yaml(rdir, cdir, site, sim, host.fabm_inputs, host.nutrient_inputs, out_vars)
                    import subprocess

                    with open(rdir / "gotm.log", "w") as log:
                        proc = subprocess.run([exe, "gotm.yaml"], cwd=rdir, stdout=log, stderr=subprocess.STDOUT, env=kernel_env())
                    if proc.returncode != 0:
                        return {"i": p["i"], "error": True}
                    return {"i": p["i"], **_column_metrics(rdir, {"spec": spec, "timing": timing})}

                with ThreadPoolExecutor(max_workers=workers) as ex:
                    futs = [ex.submit(one, it) for it in valid]
                    for fut in as_completed(futs):
                        if job.cancel_requested:
                            break
                        try:
                            results.append(fut.result())
                        except Exception as e:
                            results.append({"error": True, "message": str(e)})
                        done += 1
                        if done % 2 == 0 or done == n_total:
                            self._progress(f"{cfg['name']}：已完成 {done}/{n_total} 个水柱", 0.25 + 0.75 * done / max(1, n_total))
                    if job.cancel_requested:
                        for f in futs:
                            f.cancel()
                if job.cancel_requested:
                    break  # keep this config's previous results instead of overwriting them with a partial set
                by_i = {p["i"]: p for p in pts}
                res = {"config_id": cid, "config_name": cfg["name"], "points": []}
                meta = {}
                for r in results:
                    if r.get("error") or "i" not in r:
                        continue
                    p = by_i[r["i"]]
                    res["points"].append({"i": r["i"], "lat": p["lat"], "lon": p["lon"], "depth": p["depth"],
                                          "metrics": r["metrics"], "monthly": r["monthly"]})
                    meta.update(r["meta"])
                res["meta"] = meta
                (d / f"results_{cid}.json").write_text(json.dumps(res))
            job.status = "cancelled" if job.cancel_requested else "done"
            job.progress = 1.0 if job.status == "done" else job.progress
            study = get_study(self.pid, self.sid)
            study["status"] = job.status
            study["finished"] = _now()
            if job.status == "done":
                study.pop("error", None)
                study["progress"] = 1.0
            save_study(self.pid, study)
        except Exception as e:
            traceback.print_exc()
            job.status = "failed"
            job.error = str(e)
            study = get_study(self.pid, self.sid)
            study["status"] = "failed"
            study["error"] = str(e)
            save_study(self.pid, study)
        job.finished = _now()
        self.runner._emit(job)
        events.emit("shelf", {"project": self.pid, "study": self.sid})


def threading_start(fn) -> None:
    import threading

    threading.Thread(target=fn, daemon=True, name="shelf").start()


@_locked
def _column_metrics(rdir: Path, run: dict) -> dict:
    from .. import results as R

    out = R.summary(rdir, run)
    metrics = {r["key"]: r["value"] for r in out["rows"]}
    meta = {r["key"]: {"label": r["label"], "units": r["units"]} for r in out["rows"]}
    ds = R.open_result(rdir)
    start = run["timing"]["analysis_start"]
    ds = ds.sel(time=slice(start, None))
    monthly = {}
    for v in MAP_VARS:
        if v in ds:
            da, _ = R._column(ds, v, "surface" if v == "temp" else "integral")
            vals = da.groupby("time.month").mean().values
            monthly[v] = [None if not np.isfinite(x) else float(f"{x:.4g}") for x in vals]
    return {"metrics": metrics, "meta": meta, "monthly": monthly}


def study_results(pid: str, sid: str) -> dict:
    d = shelf_dir(pid) / sid
    out = []
    from ..results import ZOO_NAMES

    for f in sorted(d.glob("results_*.json")):
        r = json.loads(f.read_text())
        for m in r.get("meta", {}).values():
            # studies computed by older versions carry older wording: show today's names
            m["label"] = {"浮游植物碳（深度积分）": "浮游植物生物量（以碳计，深度积分）", "浮游动物碳（深度积分）": "浮游动物生物量（以碳计，深度积分）"}.get(m["label"], m["label"])
            z = m["label"].strip()
            if z in ZOO_NAMES:
                m["label"] = "  " + ZOO_NAMES[z]
        out.append(r)
    return {"study": {k: v for k, v in get_study(pid, sid).items() if k != "points"}, "results": out}
