"""Shoal HTTP + WebSocket API (FastAPI).

Run with:  uvicorn shoal.server:app --port 8765   (pnpm dev starts it for you)
The server binds to 127.0.0.1 only: it reads and writes files in the workspace.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse

from . import events, projects, results, yamlio
from .config import REPO, kernel_info, load_settings, save_settings
from .ecosystem import builder, foodweb
from .ecosystem.hosts import HOSTS, host_summary
from .runner import get_runner
from .threed import resources, shelf

app = FastAPI(title="Shoal", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup() -> None:
    events.bind_loop(asyncio.get_running_loop())
    get_runner()
    _recover_interrupted()
    _seed_demo()


def _recover_interrupted() -> None:
    """A restart kills background jobs: reset states that would otherwise stay 'building' / 'running' forever."""
    from .sites.builder import load_site

    for p in projects.list_projects():
        d = projects.project_dir(p["id"])
        if p.get("site_status") == "building":
            proj = projects._read(d / "project.json")
            proj["site_status"] = "ready" if load_site(d / "site") else "missing"
            projects._write(d / "project.json", proj)
        for r in projects.list_runs(p["id"]):
            if r.get("status") in ("running", "queued"):
                r["status"] = "failed"
                r["error"] = "后端重启，运行被中断，请重新运行"
                projects.write_run(p["id"], r)
        for st in shelf.list_studies(p["id"]):
            if st.get("status") == "running":
                full = shelf.get_study(p["id"], st["id"])
                full["status"] = "failed"
                full["error"] = "后端重启，计算被中断；已下载的数据有缓存，可重新开始"
                shelf.save_study(p["id"], full)


def _seed_demo() -> None:
    """First launch: create the offline demo project so the app is usable immediately."""
    if projects.list_projects():
        return
    try:
        p = projects.create_project("离线演示：北海北部水柱", "offline_demo")
        get_runner().build_site(p["id"])
    except Exception as e:  # pragma: no cover
        print("seed demo failed:", e)


@app.exception_handler(KeyError)
async def _key_error(_, exc: KeyError):
    return JSONResponse(status_code=404, content={"detail": str(exc).strip("'\"")})


@app.exception_handler(FileNotFoundError)
async def _fnf(_, exc: FileNotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ValueError)
async def _value_error(_, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(RuntimeError)
async def _runtime_error(_, exc: RuntimeError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


# ------------------------------------------------------------------ system
@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/kernel")
def kernel() -> dict:
    return {"kernel": kernel_info(), "system": resources.system_info()}


@app.get("/api/settings")
def get_settings() -> dict:
    s = load_settings()
    a = s.get("assistant", {})
    a["has_key"] = bool(a.get("api_key"))
    a["api_key"] = ""
    return s


@app.put("/api/settings")
def put_settings(data: dict = Body(...)) -> dict:
    a = data.get("assistant")
    if isinstance(a, dict) and not a.get("api_key"):
        a.pop("api_key", None)
    save_settings(data)
    return get_settings()


@app.get("/api/hosts")
def hosts() -> dict:
    return {"hosts": [host_summary(h) for h in HOSTS.values()],
            "htl_defaults": {h: builder.htl_parameter_table(h) for h in HOSTS},
            "param_docs": builder.PARAM_DOCS}


@app.get("/api/templates")
def templates() -> dict:
    return {"designs": [{"id": k, **v} for k, v in projects.DESIGNS.items()], "hosts": projects.HOST_NAME,
            "templates": [{"id": k, **v} for k, v in projects.TEMPLATES.items()],
            "site_presets": projects.SITE_PRESETS, "sim_presets": projects.SIM_PRESETS}


# ---------------------------------------------------------------- projects
@app.get("/api/projects")
def list_projects() -> list:
    return projects.list_projects()


@app.post("/api/projects")
def create_project(data: dict = Body(...)) -> dict:
    p = projects.create_project(data.get("name", ""), data.get("template", ""), data.get("site"),
                                data.get("simulation"), data.get("description", ""), data.get("designs"),
                                data.get("hosts"), bool(data.get("offline")))
    if data.get("build_site", True):
        get_runner().build_site(p["id"])
    return projects.get_project(p["id"])


@app.get("/api/projects/{pid}")
def get_project(pid: str) -> dict:
    p = projects.get_project(pid)
    p["jobs"] = [j.to_dict() for j in get_runner().active_for_project(pid)]
    return p


@app.patch("/api/projects/{pid}")
def patch_project(pid: str, data: dict = Body(...)) -> dict:
    return projects.update_project(pid, data)


@app.delete("/api/projects/{pid}")
def delete_project(pid: str) -> dict:
    projects.delete_project(pid)
    return {"ok": True}


@app.post("/api/projects/{pid}/site/build")
def build_site(pid: str) -> dict:
    return get_runner().build_site(pid)


@app.get("/api/projects/{pid}/site/forcing")
def site_forcing(pid: str) -> dict:
    """Daily-mean meteorology and WOA profiles of the site, for the site page charts."""
    import numpy as np

    d = projects.project_dir(pid) / "site"
    info = json.loads((d / "site.json").read_text()) if (d / "site.json").exists() else None
    if not info:
        raise HTTPException(404, "站点尚未构建")
    out: dict[str, Any] = {"site": info}
    met = d / "meteo_era5.dat"
    if met.exists():
        days: dict[str, list] = {}
        for line in met.read_text().splitlines():
            parts = line.split()
            if len(parts) < 9:
                continue
            days.setdefault(parts[0], []).append([float(x) for x in parts[2:]])
        keys = sorted(days)
        arr = np.array([np.mean(days[k], axis=0) for k in keys])
        out["meteo"] = {"date": keys, "u10": arr[:, 0].round(2).tolist(), "v10": arr[:, 1].round(2).tolist(),
                        "airp": arr[:, 2].round(1).tolist(), "airt": arr[:, 3].round(2).tolist(),
                        "hum": arr[:, 4].round(1).tolist(), "cloud": arr[:, 5].round(2).tolist(),
                        "swr": arr[:, 6].round(1).tolist(),
                        "wind": np.hypot(arr[:, 0], arr[:, 1]).round(2).tolist()}
    woa = d / "woa.json"
    if woa.exists():
        w = json.loads(woa.read_text())
        dep = info.get("depth", 100)
        k = [i for i, z in enumerate(w["depth"]) if z <= dep]
        out["woa"] = {"depth": [w["depth"][i] for i in k],
                      **{v: [[m[i] for i in k] for m in w[v]] for v in ("temperature", "salinity", "nitrate", "phosphate", "silicate", "oxygen") if v in w}}
    return out


# ------------------------------------------------------------------ configs
@app.get("/api/projects/{pid}/configs")
def list_configs(pid: str) -> list:
    return projects.list_configs(pid)


@app.post("/api/projects/{pid}/configs")
def save_config(pid: str, data: dict = Body(...)) -> dict:
    return projects.save_config(pid, data)


@app.delete("/api/projects/{pid}/configs/{cid}")
def delete_config(pid: str, cid: str) -> dict:
    projects.delete_config(pid, cid)
    return {"ok": True}


@app.post("/api/fabm_yaml")
def fabm_yaml(spec: dict = Body(...)) -> PlainTextResponse:
    return PlainTextResponse(yamlio.dumps(builder.build_fabm_yaml(spec)))


@app.post("/api/foodweb")
def foodweb_graph(spec: dict = Body(...)) -> dict:
    return foodweb.build_graph(spec)


# -------------------------------------------------------------- experiments
@app.get("/api/projects/{pid}/experiments")
def list_experiments(pid: str) -> list:
    return projects.list_experiments(pid)


@app.post("/api/projects/{pid}/experiments")
def save_experiment(pid: str, data: dict = Body(...)) -> dict:
    return projects.save_experiment(pid, data)


@app.delete("/api/projects/{pid}/experiments/{eid}")
def delete_experiment(pid: str, eid: str) -> dict:
    projects.delete_experiment(pid, eid)
    return {"ok": True}


@app.post("/api/projects/{pid}/experiments/{eid}/run")
def run_experiment(pid: str, eid: str, data: dict = Body(default={})) -> list:
    exp = next(e for e in projects.list_experiments(pid) if e["id"] == eid)
    items = exp["items"]
    if data.get("only"):
        items = [i for i in items if i["config_id"] in data["only"]]
    return get_runner().start_runs(pid, items, eid, data.get("simulation"))


# --------------------------------------------------------------------- runs
@app.post("/api/projects/{pid}/runs")
def start_runs(pid: str, data: dict = Body(...)) -> list:
    return get_runner().start_runs(pid, data["items"], data.get("experiment_id"), data.get("simulation"))


@app.get("/api/projects/{pid}/runs")
def list_runs(pid: str) -> list:
    return projects.list_runs(pid)


@app.get("/api/projects/{pid}/runs/{rid}")
def get_run(pid: str, rid: str) -> dict:
    return projects.get_run(pid, rid)


@app.patch("/api/projects/{pid}/runs/{rid}")
def patch_run(pid: str, rid: str, data: dict = Body(...)) -> dict:
    run = projects.get_run(pid, rid)
    for k in ("label", "starred", "notes"):
        if k in data:
            run[k] = data[k]
    projects.write_run(pid, run)
    return run


@app.delete("/api/projects/{pid}/runs/{rid}")
def delete_run(pid: str, rid: str) -> dict:
    projects.delete_run(pid, rid)
    return {"ok": True}


@app.get("/api/projects/{pid}/runs/{rid}/file/{name}")
def run_file(pid: str, rid: str, name: str):
    if name not in ("gotm.yaml", "fabm.yaml", "gotm.log", "result.nc"):
        raise HTTPException(400, "不支持的文件")
    f = projects.run_dir(pid, rid) / name
    if not f.exists():
        raise HTTPException(404, "文件不存在")
    if name == "result.nc":
        return FileResponse(f, filename=f"{rid}.nc")
    text = f.read_text(errors="replace")
    if name == "gotm.log" and len(text) > 400_000:
        text = text[:100_000] + "\n…\n" + text[-200_000:]
    return PlainTextResponse(text)


def _rd(pid: str, rid: str) -> Path:
    return projects.run_dir(pid, rid)


def _labelled(pid: str, run_ids: list[str]) -> list[tuple[str, Path]]:
    out = []
    for rid in run_ids:
        run = projects.get_run(pid, rid)
        out.append((run.get("label", rid), _rd(pid, rid)))
    return out


@app.get("/api/projects/{pid}/runs/{rid}/variables")
def run_variables(pid: str, rid: str) -> dict:
    return results.list_variables(_rd(pid, rid))


@app.get("/api/projects/{pid}/runs/{rid}/hovmoller")
def run_hovmoller(pid: str, rid: str, var: str, start: str | None = None, end: str | None = None) -> dict:
    return results.hovmoller(_rd(pid, rid), var, start, end)


@app.get("/api/projects/{pid}/runs/{rid}/summary")
def run_summary(pid: str, rid: str) -> dict:
    return results.summary(_rd(pid, rid), projects.get_run(pid, rid))


@app.get("/api/projects/{pid}/runs/{rid}/spectrum")
def run_spectrum(pid: str, rid: str, start: str | None = None, end: str | None = None) -> dict:
    return results.size_spectrum(_rd(pid, rid), projects.get_run(pid, rid), start, end)


@app.get("/api/projects/{pid}/runs/{rid}/foodweb")
def run_foodweb(pid: str, rid: str) -> dict:
    run = projects.get_run(pid, rid)
    g = foodweb.build_graph(run["spec"])
    try:
        g["state"] = results.foodweb_state(_rd(pid, rid), run)
    except FileNotFoundError:
        g["state"] = {}
    return g


@app.post("/api/projects/{pid}/results/timeseries")
def res_timeseries(pid: str, data: dict = Body(...)) -> dict:
    return results.timeseries(_labelled(pid, data["run_ids"]), data["var"], data.get("mode", "integral"),
                              data.get("start"), data.get("end"))


@app.post("/api/projects/{pid}/results/annual")
def res_annual(pid: str, data: dict = Body(...)) -> dict:
    return results.annual_cycle(_labelled(pid, data["run_ids"]), data["var"], data.get("mode", "integral"),
                                data.get("start"), data.get("end"))


@app.post("/api/projects/{pid}/results/profiles")
def res_profiles(pid: str, data: dict = Body(...)) -> dict:
    return results.profiles(_labelled(pid, data["run_ids"]), data["var"], data.get("months"), data.get("start"), data.get("end"))


@app.post("/api/projects/{pid}/results/compare")
def res_compare(pid: str, data: dict = Body(...)) -> dict:
    runs = []
    for rid in data["run_ids"]:
        run = projects.get_run(pid, rid)
        runs.append((run.get("label", rid), _rd(pid, rid), run))
    return results.compare(runs)


@app.post("/api/projects/{pid}/results/difference")
def res_difference(pid: str, data: dict = Body(...)) -> dict:
    return results.difference(_rd(pid, data["a"]), _rd(pid, data["b"]), data["var"], data.get("start"), data.get("end"))


# ------------------------------------------------------------- research checks
@app.get("/api/projects/{pid}/runs/{rid}/validation")
def run_validation(pid: str, rid: str) -> dict:
    from . import analysis

    return analysis.validation(_rd(pid, rid), projects.get_run(pid, rid), projects.project_dir(pid) / "site")


@app.get("/api/projects/{pid}/runs/{rid}/spinup")
def run_spinup(pid: str, rid: str) -> dict:
    from . import analysis

    return analysis.spinup(_rd(pid, rid), projects.get_run(pid, rid))


@app.post("/api/projects/{pid}/scan")
def create_scan(pid: str, data: dict = Body(...)) -> dict:
    exp = projects.create_scan(pid, data)
    if data.get("start"):
        get_runner().start_runs(pid, exp["items"], exp["id"])
    return exp


@app.get("/api/projects/{pid}/shelf/{sid}/regions")
def shelf_regions(pid: str, sid: str) -> dict:
    from . import analysis

    r = shelf.study_results(pid, sid)
    return analysis.shelf_regions(r["results"], float(r["study"]["res"]))


@app.get("/api/shelf_regions")
def shelf_region_boxes() -> list:
    from . import analysis

    return [{"name": n, "box": [a0, a1, o0, o1]} for n, a0, a1, o0, o1 in analysis.REGIONS]


# --------------------------------------------------------------------- jobs
@app.get("/api/jobs")
def list_jobs() -> list:
    return get_runner().list()


@app.post("/api/jobs/{jid}/cancel")
def cancel_job(jid: str) -> dict:
    get_runner().cancel(jid)
    return {"ok": True}


# ----------------------------------------------------------------- 3D shelf
@app.get("/api/system")
def system() -> dict:
    return resources.system_info()


@app.post("/api/projects/{pid}/shelf/plan")
def shelf_plan(pid: str, data: dict = Body(...)) -> dict:
    grid = shelf.plan_grid(data.get("box", shelf.AMM7_SHELF), float(data.get("res", 1.0)),
                           float(data.get("min_depth", 10)), float(data.get("max_depth", 200)))
    study = {"points": grid["points"], "config_ids": data.get("config_ids", []), "years": int(data.get("years", 3)),
             "nlev": int(data.get("nlev", 30)), "dt": float(data.get("dt", 1800))}
    return {"grid": grid, "estimate": shelf.estimate_study(pid, study)}


@app.get("/api/projects/{pid}/shelf")
def shelf_list(pid: str) -> list:
    return shelf.list_studies(pid)


@app.post("/api/projects/{pid}/shelf")
def shelf_create(pid: str, data: dict = Body(...)) -> dict:
    return shelf.create_study(pid, data)


@app.get("/api/projects/{pid}/shelf/{sid}")
def shelf_get(pid: str, sid: str) -> dict:
    return shelf.get_study(pid, sid)


@app.delete("/api/projects/{pid}/shelf/{sid}")
def shelf_delete(pid: str, sid: str) -> dict:
    shelf.delete_study(pid, sid)
    return {"ok": True}


@app.post("/api/projects/{pid}/shelf/{sid}/start")
def shelf_start(pid: str, sid: str, data: dict = Body(default={})) -> dict:
    return shelf.ShelfJob(get_runner(), pid, sid, data.get("only")).start()


@app.get("/api/projects/{pid}/shelf/{sid}/results")
def shelf_results(pid: str, sid: str) -> dict:
    return shelf.study_results(pid, sid)


@app.get("/api/point")
def point_info(lat: float, lon: float) -> dict:
    """Water depth at a point (ETOPO) and whether it is land — used by the site picker."""
    from .data import sources

    try:
        return {"lat": lat, "lon": lon, "depth": round(sources.point_depth(lat, lon), 1), "land": False}
    except RuntimeError as e:
        return {"lat": lat, "lon": lon, "depth": None, "land": "陆地" in str(e), "error": str(e)}


@app.get("/api/landmask")
def landmask(lat0: float, lat1: float, lon0: float, lon1: float, res: float = 0.1) -> dict:
    return shelf.landmask([lat0, lat1, lon0, lon1], res)


# ---------------------------------------------------------------- assistant
@app.post("/api/assistant/chat")
def assistant_chat(data: dict = Body(...)) -> dict:
    from .assistant import agent

    return agent.start_chat(data)


@app.post("/api/assistant/apply")
def assistant_apply(data: dict = Body(...)) -> dict:
    from .assistant import agent

    return agent.apply_proposal(data)


@app.post("/api/assistant/test")
def assistant_test(data: dict = Body(default={})) -> dict:
    from .assistant import agent

    return agent.test_connection(data)


# ------------------------------------------------------------------- events
@app.websocket("/api/events")
async def ws_events(ws: WebSocket) -> None:
    await ws.accept()
    q = events.subscribe()
    try:
        await ws.send_text(json.dumps({"event": "hello", "payload": {"jobs": get_runner().list()}}))
        while True:
            msg = await q.get()
            batch = [msg]
            while not q.empty() and len(batch) < 50:
                batch.append(q.get_nowait())
            await ws.send_text(json.dumps({"event": "batch", "payload": batch}, ensure_ascii=False))
    except (WebSocketDisconnect, RuntimeError):
        pass
    except asyncio.CancelledError:
        # server shutting down / auto-reload: close quietly instead of logging a traceback
        try:
            await ws.close(code=1001)
        except Exception:  # noqa: BLE001
            pass
    finally:
        events.unsubscribe(q)


# Serve a production build of the frontend if present (pnpm build)
_dist = REPO / "frontend" / "dist"
if _dist.exists():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
