"""Research checks: validation against WOA23, spin-up drift, shelf regional statistics."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .nclock import locked
from .results import _column, _depth, open_result

# host variable for each WOA quantity: (name, factor host->WOA units)
WOA_MAP = {
    "ersem": {"temperature": ("temp", 1.0), "salinity": ("salt", 1.0), "nitrate": ("N3_n", 1.0), "phosphate": ("N1_p", 1.0), "silicate": ("N5_s", 1.0), "oxygen": ("O2_o", 1.0)},
    "ecosmo": {"temperature": ("temp", 1.0), "salinity": ("salt", 1.0), "nitrate": ("ECO_no3", 1 / 79.5663), "phosphate": ("ECO_pho", 1 / 1273.06), "silicate": ("ECO_sil", 1 / 79.5663), "oxygen": ("ECO_oxy", 1.0)},
    "ergom": {"temperature": ("temp", 1.0), "salinity": ("salt", 1.0), "nitrate": ("ergom_nn", 1.0), "phosphate": ("ergom_po", 1.0), "oxygen": ("ergom_o2", 1.0)},
}
WOA_LABEL = {"temperature": ("温度", "°C"), "salinity": ("盐度", "PSU"), "nitrate": ("硝酸盐", "mmol N m⁻³"), "phosphate": ("磷酸盐", "mmol P m⁻³"),
             "silicate": ("硅酸盐", "mmol Si m⁻³"), "oxygen": ("溶解氧", "mmol O₂ m⁻³")}


def _r(v, d=4):
    return None if v is None or not math.isfinite(v) else float(f"{v:.{d}g}")


@locked
def validation(run_dir: Path, run: dict, site_dir: Path) -> dict:
    """Model monthly climatology vs WOA23 at the WOA depths (analysis window)."""
    woa_f = site_dir / "woa.json"
    if not woa_f.exists():
        return {"available": False, "reason": "该站点没有 WOA 气候态（GOTM 算例或导入的站点），无法做气候态验证。"}
    woa = json.loads(woa_f.read_text())
    ds = open_result(run_dir)
    start = (run.get("timing") or {}).get("analysis_start")
    if start:
        ds = ds.sel(time=slice(start, None))
    depth_model = _depth(ds)
    order = np.argsort(depth_model)
    zmax = float(depth_model.max())
    dz = [d for d in woa["depth"] if d <= zmax + 1e-6]
    k = len(dz)
    host = run["spec"]["host"]
    out = {"available": True, "depth": dz, "vars": [], "window": [str(ds["time"].values[0])[:10], str(ds["time"].values[-1])[:10]],
           "note": "注意：模拟过程中温盐和营养盐持续向 WOA23 气候态松弛，因此两者吻合度较高属于预期结果，主要用于检验模型自洽性；独立验证需对比现场观测资料。"}
    for key, (name, factor) in WOA_MAP[host].items():
        if key not in woa or name not in ds:
            continue
        clim = ds[name].groupby("time.month").mean().values  # month x z
        if clim.shape[0] != 12:
            continue
        model = np.array([np.interp(dz, depth_model[order], clim[m][order]) for m in range(12)]) * factor  # 12 x k
        obs = np.array([np.array(woa[key][m][:k], dtype=float) for m in range(12)])
        a, b = model.ravel(), obs.ravel()
        ok = np.isfinite(a) & np.isfinite(b)
        a, b = a[ok], b[ok]
        if a.size < 3:
            continue
        bias = float(np.mean(a - b))
        rmse = float(np.sqrt(np.mean((a - b) ** 2)))
        r = float(np.corrcoef(a, b)[0, 1]) if np.std(a) > 0 and np.std(b) > 0 else float("nan")
        sd_ratio = float(np.std(a) / np.std(b)) if np.std(b) > 0 else float("nan")
        crmse = float(np.sqrt(max(0.0, np.mean(((a - a.mean()) - (b - b.mean())) ** 2)))) / (np.std(b) or 1)
        label, unit = WOA_LABEL[key]
        out["vars"].append({
            "key": key, "label": label, "units": unit, "model_var": name,
            "model": np.round(model, 4).tolist(), "obs": np.round(obs, 4).tolist(),
            "surface": {"model": np.round(model[:, 0], 4).tolist(), "obs": np.round(obs[:, 0], 4).tolist()},
            "bottom": {"model": np.round(model[:, -1], 4).tolist(), "obs": np.round(obs[:, -1], 4).tolist()},
            "stats": {"bias": _r(bias), "rmse": _r(rmse), "r": _r(r, 3), "sd_ratio": _r(sd_ratio, 3), "crmse": _r(crmse, 3), "obs_mean": _r(float(b.mean())), "model_mean": _r(float(a.mean()))},
        })
    return out


SPINUP_PREFS = ["temp", "N3_n", "ECO_no3", "ergom_nn", "P1_c", "ECO_dia", "ergom_pp", "Z4_c", "ECO_mesozoo", "ergom_zz",
                "Q6_c", "ECO_sed1", "ergom_fl", "MB_c", "F1_c", "F2_c", "fish_c_tot"]


@locked
def spinup(run_dir: Path, run: dict) -> dict:
    """Annual means of key state variables over every simulated year (incl. spin-up) and year-to-year drift."""
    ds = open_result(run_dir)
    yr = ds["time"].dt.year.values
    counts = {int(y): int((yr == y).sum()) for y in set(yr.tolist())}
    full = [y for y, n in counts.items() if n >= 300]  # drop the partial final day/year
    ds = ds.sel(time=np.isin(yr, full))
    years = sorted(full)
    out = {"years": years, "analysis_from": int(str((run.get("timing") or {}).get("analysis_start", years[0]))[:4]), "vars": []}
    for name in SPINUP_PREFS:
        if name not in ds:
            continue
        da, units = _column(ds, name, "mean" if name == "temp" else "integral")
        ann = da.groupby("time.year").mean()
        vals = [float(v) for v in ann.values]
        drift = None
        if len(vals) >= 2 and vals[-2]:
            drift = (vals[-1] - vals[-2]) / abs(vals[-2]) * 100
        out["vars"].append({"name": name, "long_name": ds[name].attrs.get("long_name", name), "units": units,
                            "values": [_r(v) for v in vals], "drift_pct": _r(drift, 3)})
    worst = max((abs(v["drift_pct"]) for v in out["vars"] if v["drift_pct"] is not None), default=None)
    out["max_drift_pct"] = _r(worst, 3)
    out["verdict"] = None if worst is None else ("已达稳态：最后两年年均值变化小于 1%" if worst < 1 else "接近稳态：最后两年仍有 1–5% 的年际变化，研究用途建议适当延长预热年数" if worst < 5 else "尚未达到稳态：最后两年变化超过 5%，结果仍受初始条件影响，请增加预热年数")
    return out


# Approximate shelf regions (rectangles approximating the Wakelin et al. 2012 / ICES regions used by Powley et al.)
REGIONS = [
    ("南部北海", 51.0, 54.5, 0.5, 9.0), ("中部北海", 54.5, 57.5, -2.0, 9.0), ("北部北海", 57.5, 61.5, -2.0, 4.0),
    ("斯卡格拉克", 57.0, 59.5, 7.5, 11.5), ("英吉利海峡", 48.5, 51.0, -5.5, 2.0), ("凯尔特海", 48.0, 51.5, -11.0, -5.5),
    ("爱尔兰海", 51.5, 55.0, -6.5, -2.8), ("爱尔兰陆架", 51.5, 56.0, -11.5, -6.5), ("苏格兰陆架 / 设得兰", 56.0, 62.0, -9.0, -2.0),
]


def region_of(lat: float, lon: float) -> str | None:
    for name, a0, a1, o0, o1 in REGIONS:
        if a0 <= lat < a1 and o0 <= lon < o1:
            return name
    return None


# Generic regions for any shelf sea: depth bands (shallow, well-mixed water behaves differently
# from seasonally stratified mid/outer shelf water).
DEPTH_BANDS = [("近岸浅水（< 30 m）", 0, 30), ("内陆架（30–60 m）", 30, 60), ("中陆架（60–100 m）", 60, 100),
               ("外陆架（100–200 m）", 100, 200), ("陆架坡折以外（> 200 m）", 200, 1e9)]


def depth_band(depth: float | None) -> str | None:
    if depth is None:
        return None
    for name, d0, d1 in DEPTH_BANDS:
        if d0 <= depth < d1:
            return name
    return None


def region_scheme(points: list[dict]) -> str:
    """'boxes' when most columns lie in the NW European shelf regions of Powley et al., else 'depth'."""
    if not points:
        return "depth"
    inside = sum(1 for p in points if region_of(p["lat"], p["lon"]))
    return "boxes" if inside >= 0.5 * len(points) else "depth"


def shelf_regions(results: list[dict], res: float) -> dict:
    """Region means and totals for each configuration (cf. Powley et al. Table 2)."""
    km_per_deg = 111.32
    scheme = region_scheme(results[0]["points"] if results else [])
    names = [r[0] for r in REGIONS] if scheme == "boxes" else [b[0] for b in DEPTH_BANDS]
    out = {"regions": names + ["全部陆架"], "configs": [], "metrics": {}, "scheme": scheme}
    for cfg in results:
        rows = {}
        for p in cfg["points"]:
            reg = region_of(p["lat"], p["lon"]) if scheme == "boxes" else depth_band(p.get("depth"))
            area = (res * km_per_deg) * (res * km_per_deg * math.cos(math.radians(p["lat"])))  # km2
            for key in (reg, "全部陆架"):
                if key is None:
                    continue
                d = rows.setdefault(key, {"n": 0, "area": 0.0, "sum": {}, "wsum": {}})
                d["n"] += 1
                d["area"] += area
                for m, v in p["metrics"].items():
                    if v is None or not math.isfinite(v):
                        continue
                    d["wsum"][m] = d["wsum"].get(m, 0.0) + v * area
                    d["sum"][m] = d["sum"].get(m, 0.0) + area
        table = {}
        for reg, d in rows.items():
            table[reg] = {"n": d["n"], "area_km2": round(d["area"]), "mean": {m: _r(d["wsum"][m] / d["sum"][m]) for m in d["wsum"]}}
        out["configs"].append({"config_name": cfg["config_name"], "config_id": cfg["config_id"], "table": table})
        out["metrics"].update(cfg.get("meta", {}))
    out["note"] = ("区域划分采用 Powley et al. (2026) 分区的近似矩形；表中数值为按格点面积加权的区域平均值。" if scheme == "boxes"
                   else "研究区位于西北欧陆架以外，按水深带分区统计；表中数值为按格点面积加权的区域平均值。")
    return out
