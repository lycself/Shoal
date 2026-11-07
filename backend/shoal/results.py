"""Read GOTM/FABM NetCDF output for the result views.

All functions take a run directory and return JSON-ready dicts. Depth-resolved
variables have dims (time, z, lat, lon); horizontal ones (time, lat, lon).
"""
from __future__ import annotations

import functools
import math
import re
import threading
from pathlib import Path

import numpy as np
import xarray as xr

from .ecosystem.hosts import HOSTS
from .nclock import NC_LOCK, locked


@functools.lru_cache(maxsize=24)
def _open_cached(path: str, mtime: float) -> xr.Dataset:
    ds = xr.open_dataset(path, decode_times=True)
    return ds.squeeze(drop=True)


def open_result(run_dir: Path) -> xr.Dataset:
    f = Path(run_dir) / "result.nc"
    if not f.exists():
        raise FileNotFoundError("该运行还没有输出")
    with NC_LOCK:
        return _open_cached(str(f), f.stat().st_mtime)


def _dates(ds: xr.Dataset) -> list[str]:
    t = ds["time"].values
    return [str(np.datetime_as_string(v, unit="D")) for v in t]


def _clean(a: np.ndarray, digits: int = 5) -> list:
    a = np.asarray(a, dtype=float)
    out = np.where(np.isfinite(a), a, np.nan)
    rounded = np.vectorize(lambda v: None if not math.isfinite(v) else float(f"{v:.{digits}g}"), otypes=[object])(out)
    return rounded.tolist()


def _depth(ds: xr.Dataset) -> np.ndarray:
    z = ds["z"]
    if "time" in z.dims:
        z = z.mean("time")
    return -np.asarray(z.values, dtype=float)


# ------------------------------------------------------------- variables
GROUPS = [
    ("physics", "物理", re.compile(r"^(temp|salt|nuh|mld_surf|rad|u10|v10|airt|taub|h)$")),
    ("fish", "鱼类与大型底栖（高营养级）", re.compile(r"^(F1|F2|MB|fish)_")),
    ("phyto", "浮游植物", re.compile(r"^(P[1-4]_|ECO_(fla|dia|bg)|ergom_(pp|ff|bb)$)")),
    ("zoo", "浮游动物", re.compile(r"^(Z[4-6]_|ECO_(meso|micro)zoo|ergom_zz$)")),
    ("nutrients", "营养盐与氧", re.compile(r"^(N[1-5]_|O2_|ECO_(no3|nh4|pho|sil|oxy)|ergom_(aa|nn|po|o2)$)")),
    ("organic", "有机物与细菌", re.compile(r"^(R[1-8]_|B1_|ECO_(det|dom|opa)|ergom_dd$)")),
    ("benthic", "底栖与沉积", re.compile(r"^(Q[1-7]_|K[1-6]_|H[1-2]_|G[2-3]_|Y[2-4]_|D[1-9]m|ben_|bL2|ECO_sed|ergom_(fl|pb)$)")),
    ("carbonate", "碳酸盐系统", re.compile(r"^(O3_|L2_|CO2_)")),
    ("diagnostic", "诊断量", re.compile(r".")),
]


@locked
def list_variables(run_dir: Path) -> dict:
    ds = open_result(run_dir)
    groups: dict[str, dict] = {g: {"id": g, "label": label, "vars": []} for g, label, _ in GROUPS}
    for name, v in ds.data_vars.items():
        if "time" not in v.dims or name in ("zi", "z"):
            continue
        rec = {"name": name, "units": v.attrs.get("units", ""), "long_name": v.attrs.get("long_name", name),
               "depth": "z" in v.dims}
        for g, _, rx in GROUPS:
            if rx.search(name):
                groups[g]["vars"].append(rec)
                break
    return {"groups": [g for g in groups.values() if g["vars"]], "dates": [_dates(ds)[0], _dates(ds)[-1]],
            "n_time": int(ds.sizes["time"]), "n_z": int(ds.sizes.get("z", 0))}


def _window(ds: xr.Dataset, start: str | None, end: str | None) -> xr.Dataset:
    if start or end:
        ds = ds.sel(time=slice(start, end))
    return ds


def _thin_time(da: xr.DataArray, max_points: int = 1500) -> xr.DataArray:
    n = da.sizes["time"]
    if n <= max_points:
        return da
    k = math.ceil(n / max_points)
    return da.coarsen(time=k, boundary="trim").mean()


@locked
def hovmoller(run_dir: Path, var: str, start: str | None = None, end: str | None = None) -> dict:
    ds = _window(open_result(run_dir), start, end)
    if var not in ds:
        raise KeyError(f"输出中没有变量 {var}")
    da = ds[var]
    if "z" not in da.dims:
        raise ValueError(f"{var} 不是随深度变化的变量")
    da = _thin_time(da)
    depth = _depth(ds)
    values = da.transpose("z", "time").values  # z from bottom to surface in GOTM
    order = np.argsort(depth)
    return {
        "var": var, "units": ds[var].attrs.get("units", ""), "long_name": ds[var].attrs.get("long_name", var),
        "time": [str(np.datetime_as_string(t, unit="D")) for t in da["time"].values],
        "depth": _clean(depth[order], 4), "values": _clean(values[order, :]),
    }


def _column(ds: xr.Dataset, var: str, mode: str) -> tuple[xr.DataArray, str]:
    da = ds[var]
    units = da.attrs.get("units", "")
    if "z" not in da.dims:
        return da, units
    h = ds["h"]
    if mode == "integral":
        return (da * h).sum("z"), units.replace("/m^3", "/m^2").replace("m-3", "m-2").replace("/m3", "/m2").replace("/m**3", "/m**2")
    if mode == "mean":
        return (da * h).sum("z") / h.sum("z"), units
    if mode == "surface":
        return da.isel(z=-1), units
    if mode == "bottom":
        return da.isel(z=0), units
    raise ValueError(mode)


@locked
def timeseries(run_dirs: list[tuple[str, Path]], var: str, mode: str = "integral",
               start: str | None = None, end: str | None = None) -> dict:
    series = []
    units = ""
    for label, rd in run_dirs:
        try:
            ds = _window(open_result(rd), start, end)
        except FileNotFoundError:
            continue
        if var not in ds:
            series.append({"label": label, "missing": True})
            continue
        da, units = _column(ds, var, mode)
        da = _thin_time(da)
        series.append({"label": label, "time": [str(np.datetime_as_string(t, unit="D")) for t in da["time"].values],
                       "values": _clean(da.values)})
    return {"var": var, "mode": mode, "units": units, "series": series}


@locked
def annual_cycle(run_dirs: list[tuple[str, Path]], var: str, mode: str = "integral",
                 start: str | None = None, end: str | None = None) -> dict:
    out = []
    units = ""
    for label, rd in run_dirs:
        try:
            ds = _window(open_result(rd), start, end)
        except FileNotFoundError:
            continue
        if var not in ds:
            out.append({"label": label, "missing": True})
            continue
        da, units = _column(ds, var, mode)
        doy = da["time"].dt.dayofyear
        g = da.groupby(doy)
        mean = g.mean()
        lo = g.min()
        hi = g.max()
        out.append({"label": label, "doy": [int(d) for d in mean["dayofyear"].values], "mean": _clean(mean.values),
                    "min": _clean(lo.values), "max": _clean(hi.values), "years": int(len(set(da["time"].dt.year.values)))})
    return {"var": var, "mode": mode, "units": units, "series": out}


@locked
def profiles(run_dirs: list[tuple[str, Path]], var: str, months: list[int] | None = None,
             start: str | None = None, end: str | None = None) -> dict:
    out = []
    units = ""
    for label, rd in run_dirs:
        try:
            ds = _window(open_result(rd), start, end)
        except FileNotFoundError:
            continue
        if var not in ds or "z" not in ds[var].dims:
            continue
        units = ds[var].attrs.get("units", "")
        depth = _depth(ds)
        clim = ds[var].groupby("time.month").mean()
        for m in months or [1, 4, 7, 10]:
            if m in clim["month"].values:
                out.append({"label": label, "month": m, "depth": _clean(depth, 4), "values": _clean(clim.sel(month=m).values)})
    return {"var": var, "units": units, "profiles": out}


# --------------------------------------------------------------- summary
def _annual_mean(ds, var, mode="integral"):
    if var not in ds:
        return None
    da, units = _column(ds, var, mode)
    return float(da.mean("time")), units


ZOO_NAMES = {"Z4_c": "中型浮游动物 Z4", "Z5_c": "微型浮游动物 Z5", "Z6_c": "异养鞭毛虫 Z6",
             "ECO_mesozoo": "中型浮游动物", "ECO_microzoo": "微型浮游动物", "ergom_zz": "浮游动物"}


@locked
def summary(run_dir: Path, run: dict) -> dict:
    """Key annual-mean indicators over the analysis window (cf. Powley et al. Table 2)."""
    ds = open_result(run_dir)
    start = (run.get("timing") or {}).get("analysis_start")
    if start:
        ds = ds.sel(time=slice(start, None))
    host = HOSTS[run["spec"]["host"]]
    rows = []

    def add(key, label, val, units, note=""):
        if val is not None and math.isfinite(val):
            rows.append({"key": key, "label": label, "value": float(f"{val:.5g}"), "units": units, "note": note})

    def isum(names, mode="integral"):
        vals = [_annual_mean(ds, n, mode) for n in names]
        vals = [v for v in vals if v]
        if not vals:
            return None, ""
        return sum(v[0] for v in vals), vals[0][1]

    v, u = isum(host.phyto_carbon)
    add("phyto", "浮游植物碳（深度积分）", v, u)
    v, u = isum(host.zoo_carbon)
    add("zoo", "浮游动物碳（深度积分）", v, u)
    zoo_names = ZOO_NAMES
    for z in host.zoo_carbon:
        v = _annual_mean(ds, z)
        if v:
            add(f"zoo_{z}", f"  {zoo_names.get(z, z)}", v[0], v[1])
    v, u = isum(host.chlorophyll)
    add("chl", "叶绿素（深度积分）", v, u)
    if host.npp:
        v, u = isum(host.npp)
        if v is not None:
            add("npp", "净初级生产（深度积分）", v * (365.0 if "d" in u else 365.0 * 86400 if "s" in u else 1.0) / 1000.0,
                "g C m⁻² yr⁻¹")
    # HTL
    for inst, label in (("F1", "鱼 1（浮游食性）"), ("F2", "鱼 2（底栖/鱼食性）"), ("MB", "大型底栖动物")):
        if f"{inst}_c" in ds:
            # official ECOSMO E2E fish are concentrations (mg C m-3, per layer): integrate over depth
            da, _ = _column(ds, f"{inst}_c", "integral")
            add(f"{inst}_c", f"{label} 生物量", float(da.mean()), "mg C m⁻²")
            if f"{inst}_wet_mass" in ds:
                add(f"{inst}_ww", f"{label} 湿重", float(ds[f"{inst}_wet_mass"].mean()), "g WW m⁻²")
            if f"{inst}_production" in ds:
                add(f"{inst}_prod", f"{label} 生产", float(ds[f"{inst}_production"].mean()) * 365 / 1000, "g C m⁻² yr⁻¹")
    if "fish_c_tot" in ds:
        add("fish_ww", "鱼类群落湿重（MIZER）", float(ds["fish_c_tot"].mean()), ds["fish_c_tot"].attrs.get("units", "g m-2"))
        if "fish_landings" in ds:
            land = ds["fish_landings"]
            years = (land["time"].values[-1] - land["time"].values[0]) / np.timedelta64(365, "D")
            if years > 0:
                add("landings", "渔获量（MIZER）", float((land.values[-1] - land.values[0]) / years), "g WW m⁻² yr⁻¹")
        for k, lbl in (("fish_c_size1", "  其中 <10 g 的鱼"), ("fish_c_size2", "  其中 <80 g 的鱼"), ("fish_c_size3", "  其中 <1000 g 的鱼")):
            if k in ds:
                add(k, lbl, float(ds[k].mean()), ds[k].attrs.get("units", ""))
    if "O3_fair" in ds:
        add("co2", "海气 CO₂ 通量（正值为海洋吸收）", float(ds["O3_fair"].mean()) * 365 * 12.011 / 1000, "g C m⁻² yr⁻¹")
    if "temp" in ds:
        add("sst", "表层温度", float(ds["temp"].isel(z=-1).mean()), "°C")
        add("sbt", "底层温度", float(ds["temp"].isel(z=0).mean()), "°C")
    return {"window": [_dates(ds)[0], _dates(ds)[-1]] if ds.sizes.get("time") else None, "rows": rows}


@locked
def compare(runs: list[tuple[str, Path, dict]]) -> dict:
    """Summary table for several runs plus percentage change relative to the first."""
    tables = [(label, summary(rd, run)) for label, rd, run in runs]
    keys: list[str] = []
    meta = {}
    for _, t in tables:
        for r in t["rows"]:
            if r["key"] not in meta:
                keys.append(r["key"])
                meta[r["key"]] = {"label": r["label"], "units": r["units"]}
    rows = []
    for k in keys:
        vals = []
        for _, t in tables:
            v = next((r["value"] for r in t["rows"] if r["key"] == k), None)
            vals.append(v)
        base = vals[0]
        pct = [None if (v is None or base in (None, 0)) else round((v - base) / abs(base) * 100, 1) for v in vals]
        rows.append({"key": k, **meta[k], "values": vals, "pct": pct})
    return {"labels": [l for l, _ in tables], "rows": rows}


@locked
def difference(run_a: Path, run_b: Path, var: str, start: str | None = None, end: str | None = None) -> dict:
    a = hovmoller(run_a, var, start, end)
    b = hovmoller(run_b, var, start, end)
    n = min(len(a["time"]), len(b["time"]))
    va = np.array(a["values"], dtype=float)[:, :n]
    vb = np.array(b["values"], dtype=float)[:, :n]
    return {**a, "time": a["time"][:n], "values": _clean(vb - va), "kind": "difference"}


# ----------------------------------------------------------- size spectrum
@locked
def size_spectrum(run_dir: Path, run: dict, start: str | None = None, end: str | None = None) -> dict:
    ds = open_result(run_dir)
    if "fish_c1" not in ds:
        raise ValueError("该运行没有 MIZER 粒径谱鱼类")
    p = run["spec"]["htl"]["mizer"].get("params", {})
    from .ecosystem.builder import MIZER_DEFAULTS

    w_min = float(p.get("w_min", MIZER_DEFAULTS["w_min"]))
    w_inf = float(p.get("w_inf", MIZER_DEFAULTS["w_inf"]))
    n = int(p.get("nclass", MIZER_DEFAULTS["nclass"]))
    w = np.logspace(np.log10(w_min), np.log10(w_inf), n)
    edges = np.logspace(np.log10(w_min) - 0.5 * np.log10(w[1] / w[0]), np.log10(w_inf) + 0.5 * np.log10(w[1] / w[0]), n + 1)
    dw = np.diff(edges)
    start = start or (run.get("timing") or {}).get("analysis_start")
    sub = _window(ds, start, end)
    names = [f"fish_c{i}" for i in range(1, n + 1) if f"fish_c{i}" in sub]
    stack = np.stack([sub[nm].values for nm in names], axis=0)  # class x time, mmol C m-2
    wm = stack * 0.12  # g wet mass m-2 (0.12 g WM per mmol C, Powley et al.)
    mean_b = wm.mean(axis=1)
    density = mean_b / dw[: len(names)]                 # g m-2 per g
    abundance = density / w[: len(names)]               # # m-2 per g
    da = xr.DataArray(wm, dims=("cls", "time"), coords={"time": sub["time"]})
    da = _thin_time(da, 400)
    return {
        "w": _clean(w[: len(names)]), "biomass": _clean(mean_b), "density": _clean(density), "abundance": _clean(abundance),
        "time": [str(np.datetime_as_string(t, unit="D")) for t in da["time"].values],
        "log10_biomass_time": _clean(np.log10(np.maximum(da.values, 1e-12)), 4),
        "window": [str(np.datetime_as_string(sub["time"].values[0], unit="D")), str(np.datetime_as_string(sub["time"].values[-1], unit="D"))],
    }


# ---------------------------------------------------------- food-web state
@locked
def foodweb_state(run_dir: Path, run: dict) -> dict:
    """Annual-mean depth-integrated biomass for each food-web node (for the food-web view)."""
    ds = open_result(run_dir)
    start = (run.get("timing") or {}).get("analysis_start")
    if start:
        ds = ds.sel(time=slice(start, None))
    out = {}
    for name in ds.data_vars:
        v = ds[name]
        if "time" not in v.dims:
            continue
        if re.search(r"(_c|^ECO_[a-z]+|^ergom_[a-z]+)$", name) and not name.endswith("_sms"):
            da, units = _column(ds, name, "integral")
            out[name] = {"value": float(da.mean()), "units": units}
    for k in ("F1_consumption", "F2_consumption", "MB_consumption"):
        if k in ds:
            out[k] = {"value": float(ds[k].mean()), "units": ds[k].attrs.get("units", "")}
    return out
