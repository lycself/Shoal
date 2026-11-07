"""Open data sources used to build water-column sites anywhere on the globe.

* ERA5 hourly meteorology through the Open-Meteo archive API (no key needed),
  i.e. the same reanalysis both papers used for atmospheric forcing.
* ETOPO 2022 bathymetry through NOAA CoastWatch ERDDAP.
* World Ocean Atlas 2023 monthly climatologies (temperature, salinity,
  nitrate, phosphate, silicate, oxygen) through NCEI OPeNDAP — paper 2
  initialises and relaxes nutrients and T/S to WOA.

All downloads are cached under <workspace>/cache so a site can be rebuilt
offline once fetched.
"""
from __future__ import annotations

import hashlib
import functools
import json
import math
import time
from pathlib import Path
from typing import Callable

import httpx
import numpy as np

from ..config import cache_dir

Progress = Callable[[str, float], None] | None

OPEN_METEO = "https://archive-api.open-meteo.com/v1/archive"
ERDDAP_ETOPO = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.json"
WOA_BASE = "https://www.ncei.noaa.gov/thredds-ocean/dodsC/woa23/DATA"

WOA_VARS = {
    # key: (folder, period, prefix letter, variable, unit conversion to mmol m-3 or native)
    "temperature": ("temperature", "decav", "t", "t_an", 1.0),
    "salinity": ("salinity", "decav", "s", "s_an", 1.0),
    "nitrate": ("nitrate", "all", "n", "n_an", 1.025),       # umol/kg -> mmol/m3
    "phosphate": ("phosphate", "all", "p", "p_an", 1.025),
    "silicate": ("silicate", "all", "i", "i_an", 1.025),
    "oxygen": ("oxygen", "all", "o", "o_an", 1.025),
}


def _cache_file(kind: str, key: dict, ext: str = "json") -> Path:
    h = hashlib.sha1(json.dumps(key, sort_keys=True).encode()).hexdigest()[:16]
    d = cache_dir() / kind
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{h}.{ext}"


def _report(progress: Progress, msg: str, frac: float) -> None:
    if progress:
        progress(msg, frac)


# ------------------------------------------------------------------ ERA5
ERA5_HOURLY = [
    "temperature_2m",
    "relative_humidity_2m",
    "surface_pressure",
    "cloud_cover",
    "wind_speed_10m",
    "wind_direction_10m",
    "shortwave_radiation",
    "precipitation",
]


def era5_hourly(lat: float, lon: float, year_start: int, year_end: int, progress: Progress = None) -> dict:
    """Hourly ERA5 at a point for whole years [year_start, year_end]. Cached per year."""
    out: dict[str, list] = {"time": []}
    for k in ERA5_HOURLY:
        out[k] = []
    years = list(range(year_start, year_end + 1))
    for n, year in enumerate(years):
        key = {"lat": round(lat, 3), "lon": round(lon, 3), "year": year, "vars": ERA5_HOURLY}
        f = _cache_file("era5", key)
        if f.exists():
            data = json.loads(f.read_text())
        else:
            _report(progress, f"下载 ERA5 {year} ({lat:.2f}N, {lon:.2f}E)", n / len(years))
            params = {
                "latitude": lat,
                "longitude": lon,
                "start_date": f"{year}-01-01",
                "end_date": f"{year}-12-31",
                "hourly": ",".join(ERA5_HOURLY),
                "wind_speed_unit": "ms",
                "timezone": "GMT",
                "models": "era5",
            }
            data = _get_json(OPEN_METEO, params)["hourly"]
            f.write_text(json.dumps(data))
        for k in out:
            out[k].extend(data[k])
    _report(progress, "ERA5 完成", 1.0)
    return out


def era5_multi(points: list[tuple[float, float]], year: int, progress: Progress = None) -> list[dict]:
    """ERA5 for many points in one year (Open-Meteo accepts comma-separated coordinates)."""
    results: list[dict | None] = [None] * len(points)
    todo = []
    for i, (lat, lon) in enumerate(points):
        key = {"lat": round(lat, 3), "lon": round(lon, 3), "year": year, "vars": ERA5_HOURLY}
        f = _cache_file("era5", key)
        if f.exists():
            results[i] = json.loads(f.read_text())
        else:
            todo.append(i)
    batch = 8
    for b in range(0, len(todo), batch):
        idx = todo[b : b + batch]
        _report(progress, f"下载 ERA5 {year}：{b + len(idx)}/{len(todo)} 个网格点", b / max(1, len(todo)))
        params = {
            "latitude": ",".join(f"{points[i][0]:.3f}" for i in idx),
            "longitude": ",".join(f"{points[i][1]:.3f}" for i in idx),
            "start_date": f"{year}-01-01",
            "end_date": f"{year}-12-31",
            "hourly": ",".join(ERA5_HOURLY),
            "wind_speed_unit": "ms",
            "timezone": "GMT",
            "models": "era5",
        }
        resp = _get_json(OPEN_METEO, params)
        if isinstance(resp, dict):
            resp = [resp]
        for i, r in zip(idx, resp):
            data = r["hourly"]
            key = {"lat": round(points[i][0], 3), "lon": round(points[i][1], 3), "year": year, "vars": ERA5_HOURLY}
            _cache_file("era5", key).write_text(json.dumps(data))
            results[i] = data
        time.sleep(6.0)
    _report(progress, "ERA5 完成", 1.0)
    return [r or {} for r in results]


def _get_json(url: str, params: dict, retries: int = 7) -> dict | list:
    """GET JSON with retries; Open-Meteo rate limits (HTTP 429) get a long back-off."""
    last: str = ""
    for attempt in range(retries):
        try:
            with httpx.Client(timeout=180, follow_redirects=True) as c:
                r = c.get(url, params=params)
                if r.status_code == 429:
                    last = "HTTP 429（请求过于频繁，超出 Open-Meteo 免费额度的每分钟限制）"
                    wait = float(r.headers.get("Retry-After") or 0) or 20.0 * (attempt + 1)
                    time.sleep(min(wait, 90.0))
                    continue
                r.raise_for_status()
                return r.json()
        except Exception as e:  # network hiccup
            last = str(e)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"下载失败：{url}（{last}）。已下载的部分已缓存，稍后重试会从断点继续。")


def era5_to_gotm_meteo(data: dict) -> list[str]:
    """Rows for a GOTM meteo file: u10 v10 airp(hPa) airt(C) hum(%) cloud(0-1) swr(W/m2) precip(m/s)."""
    rows = []
    for i, t in enumerate(data["time"]):
        ws = data["wind_speed_10m"][i]
        wd = data["wind_direction_10m"][i]
        vals = [data[k][i] for k in ERA5_HOURLY]
        if any(v is None for v in vals):
            continue
        # meteorological direction: where the wind comes FROM
        u = -ws * math.sin(math.radians(wd))
        v = -ws * math.cos(math.radians(wd))
        rows.append(
            f"{t.replace('T', ' ')}:00 {u:8.3f} {v:8.3f} {data['surface_pressure'][i]:8.2f} "
            f"{data['temperature_2m'][i]:7.2f} {data['relative_humidity_2m'][i]:6.1f} "
            f"{data['cloud_cover'][i] / 100.0:5.2f} {data['shortwave_radiation'][i]:7.1f} "
            f"{data['precipitation'][i] / 1000.0 / 3600.0:.3e}"
        )
    return rows


# ------------------------------------------------------------- bathymetry
def etopo_grid(lat0: float, lat1: float, lon0: float, lon1: float, stride: int = 1) -> dict:
    """ETOPO altitude (m, negative below sea level) on a lat/lon box from ERDDAP."""
    key = {"box": [lat0, lat1, lon0, lon1], "stride": stride}
    f = _cache_file("etopo", key)
    if f.exists():
        return json.loads(f.read_text())
    q = f"altitude[({lat0}):{stride}:({lat1})][({lon0}):{stride}:({lon1})]"
    url = f"{ERDDAP_ETOPO}?{q}"
    table = None
    last = ""
    for attempt in range(3):
        try:
            with httpx.Client(timeout=180) as c:
                r = c.get(url)
                if r.status_code in (429, 500, 502, 503, 504):
                    last = f"HTTP {r.status_code}"
                    time.sleep(3 * (attempt + 1))
                    continue
                if 400 <= r.status_code < 500:  # a bad request will not succeed on retry
                    raise ValueError(f"HTTP {r.status_code}：请求的范围超出 ETOPO 数据（经度 −180…180，纬度 −90…90）")
                r.raise_for_status()
                table = r.json()["table"]
                break
        except ValueError as e:
            last = str(e)
            break
        except Exception as e:
            last = str(e)
            time.sleep(3 * (attempt + 1))
    if table is None:
        raise RuntimeError(f"ETOPO 下载失败（{last}）")
    rows = table["rows"]
    lats = sorted({row[0] for row in rows})
    lons = sorted({row[1] for row in rows})
    li = {v: i for i, v in enumerate(lats)}
    lj = {v: j for j, v in enumerate(lons)}
    z = np.full((len(lats), len(lons)), np.nan)
    for la, lo, alt in rows:
        z[li[la], lj[lo]] = alt if alt is not None else np.nan
    out = {"lat": lats, "lon": lons, "altitude": z.tolist()}
    f.write_text(json.dumps(out))
    return out


def point_depth(lat: float, lon: float) -> float:
    """Mean water depth (m, positive) around a point (±0.05°)."""
    lon = ((lon + 180.0) % 360.0) - 180.0  # 190°E → −170°
    la0, la1 = max(-89.95, lat - 0.05), min(89.95, lat + 0.05)
    lo0, lo1 = max(-179.99, lon - 0.05), min(179.99, lon + 0.05)  # keep the window on one side of the date line
    if lo1 - lo0 < 0.02:
        lo0, lo1 = (179.89, 179.99) if lon > 0 else (-179.99, -179.89)
    g = etopo_grid(round(la0, 3), round(la1, 3), round(lo0, 3), round(lo1, 3))
    z = np.array(g["altitude"], dtype=float)
    z = z[np.isfinite(z)]
    if z.size == 0:
        raise RuntimeError("该位置没有水深数据")
    d = -float(np.mean(z))
    if d <= 0:
        raise RuntimeError("该位置是陆地（ETOPO 高程为正）")
    return d


# ------------------------------------------------------------------ WOA
def _woa_url(var: str, month: int) -> str:
    folder, period, letter, _, _ = WOA_VARS[var]
    return f"{WOA_BASE}/{folder}/netcdf/{period}/1.00/woa23_{period}_{letter}{month:02d}_01.nc"


@functools.lru_cache(maxsize=16)
def _woa_depth(var: str) -> tuple:
    """Depth axis of one WOA23 variable (monthly nutrients stop at 800 m / 43 levels, T/S go to 1500 m / 57)."""
    from . import dap

    return tuple(float(v) for v in dap.fetch(_woa_url(var, 1), "depth")["depth"])


def _pad_levels(a: np.ndarray, n: int, axis: int) -> np.ndarray:
    """Pad a profile/field with NaN along the depth axis up to n levels (filled down later)."""
    if a.shape[axis] >= n:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (0, n - a.shape[axis])
    return np.pad(a.astype(float), pad, constant_values=np.nan)


def woa_profiles(lat: float, lon: float, variables: list[str], progress: Progress = None) -> dict:
    """Monthly climatological profiles at the nearest wet WOA 1° cell (OPeNDAP over plain HTTP).

    Returns {"depth": [...], var: [[month1 profile], ... [month12]]}; values below the
    deepest observation are filled with the last valid value.
    """
    from . import dap

    key = {"lat": round(lat, 2), "lon": round(lon, 2), "vars": sorted(variables)}
    f = _cache_file("woa", key)
    if f.exists():
        return json.loads(f.read_text())
    out: dict = {}
    first = _woa_url(variables[0], 1)
    axes = dap.fetch(first, "lat,lon")
    lats, lons = axes["lat"], axes["lon"]
    depth = max((_woa_depth(v) for v in variables), key=len)
    out["depth"] = list(depth)
    # find the nearest wet cell from a small surface window
    i0 = int(np.argmin(np.abs(lats - lat))); j0 = int(np.argmin(np.abs(lons - lon)))
    ia, ib, ja, jb = max(0, i0 - 5), min(len(lats) - 1, i0 + 5), max(0, j0 - 5), min(len(lons) - 1, j0 + 5)
    _, _, _, vname0, _ = WOA_VARS[variables[0]]
    surf = dap.fetch(first, f"{vname0}[0][0][{ia}:{ib}][{ja}:{jb}]")[vname0][0, 0]
    ci, cj = _nearest_wet(lats[ia:ib + 1], lons[ja:jb + 1], np.ma.masked_invalid(surf), lat, lon)
    cell = (ia + ci, ja + cj)
    out["cell"] = [float(lats[cell[0]]), float(lons[cell[1]])]
    total = len(variables) * 12
    n = 0
    for var in variables:
        _, _, _, vname, factor = WOA_VARS[var]
        months = []
        for m in range(1, 13):
            _report(progress, f"读取 WOA23 {var} {m} 月", n / total)
            n += 1
            nl = len(_woa_depth(var))
            prof = dap.fetch(_woa_url(var, m), f"{vname}[0][0:{nl - 1}][{cell[0]}][{cell[1]}]")[vname].reshape(-1) * factor
            prof = _pad_levels(prof, len(depth), 0)
            months.append(_fill_down(prof).tolist())
        out[var] = months
    _report(progress, "WOA 完成", 1.0)
    f.write_text(json.dumps(out))
    return out


def woa_box(lat0: float, lat1: float, lon0: float, lon1: float, variables: list[str], progress: Progress = None) -> dict:
    """Monthly WOA23 1° fields on a lat/lon box (one OPeNDAP slice per variable and month, plain HTTP)."""
    from . import dap

    key = {"box": [lat0, lat1, lon0, lon1], "vars": sorted(variables)}
    f = _cache_file("woabox", key, "npz")
    meta_f = f.with_suffix(".json")
    if f.exists() and meta_f.exists():
        meta = json.loads(meta_f.read_text())
        arrs = np.load(f)
        return {**meta, **{v: arrs[v] for v in variables}}
    first = _woa_url(variables[0], 1)
    axes = dap.fetch(first, "lat,lon")
    lats, lons = axes["lat"], axes["lon"]
    depth = max((_woa_depth(v) for v in variables), key=len)
    i0, i1 = int(np.searchsorted(lats, lat0 - 1)), int(np.searchsorted(lats, lat1 + 1))
    j0, j1 = int(np.searchsorted(lons, lon0 - 1)), int(np.searchsorted(lons, lon1 + 1))
    out: dict = {"lat": [float(v) for v in lats[i0:i1]], "lon": [float(v) for v in lons[j0:j1]], "depth": [float(v) for v in depth]}
    total = len(variables) * 12
    n = 0
    for var in variables:
        _, _, _, vname, factor = WOA_VARS[var]
        months = []
        for m in range(1, 13):
            _report(progress, f"读取 WOA23 {var} {m} 月（区域）", n / total)
            n += 1
            nl = len(_woa_depth(var))
            field = dap.fetch(_woa_url(var, m), f"{vname}[0][0:{nl - 1}][{i0}:{i1 - 1}][{j0}:{j1 - 1}]")[vname][0]
            months.append(_pad_levels(field * factor, len(depth), 0))
        out[var] = np.stack(months)
    meta = {k: out[k] for k in ("lat", "lon", "depth")}
    meta_f.write_text(json.dumps(meta))
    np.savez_compressed(f, **{v: out[v] for v in variables})
    _report(progress, "WOA 区域完成", 1.0)
    return out


def woa_point_from_box(box: dict, lat: float, lon: float, variables: list[str]) -> dict | None:
    """Profiles at the nearest wet WOA cell of a box download (same format as woa_profiles)."""
    lats = np.array(box["lat"])
    lons = np.array(box["lon"])
    surf = np.ma.masked_invalid(box[variables[0]][0, 0])
    try:
        i, j = _nearest_wet(lats, lons, surf, lat, lon)
    except RuntimeError:
        return None
    out = {"depth": box["depth"], "cell": [float(lats[i]), float(lons[j])]}
    for v in variables:
        out[v] = [_fill_down(box[v][m, :, i, j]).tolist() for m in range(12)]
    return out


def _nearest_wet(lats, lons, surf, lat, lon) -> tuple[int, int]:
    mask = np.ma.getmaskarray(surf)
    i0 = int(np.argmin(np.abs(lats - lat)))
    j0 = int(np.argmin(np.abs(lons - lon)))
    best = None
    for r in range(0, 6):
        for i in range(max(0, i0 - r), min(len(lats), i0 + r + 1)):
            for j in range(max(0, j0 - r), min(len(lons), j0 + r + 1)):
                if not mask[i, j]:
                    d = (lats[i] - lat) ** 2 + ((lons[j] - lon) * math.cos(math.radians(lat))) ** 2
                    if best is None or d < best[0]:
                        best = (d, i, j)
        if best:
            return best[1], best[2]
    raise RuntimeError("附近没有 WOA 海洋格点")


def _fill_down(prof: np.ndarray) -> np.ndarray:
    good = np.where(np.isfinite(prof))[0]
    if good.size == 0:
        return np.zeros_like(prof)
    last = prof[good[-1]]
    out = prof.copy()
    out[good[-1] + 1 :] = last
    # gaps inside: linear interpolation
    idx = np.arange(prof.size)
    out = np.interp(idx, idx[np.isfinite(out)], out[np.isfinite(out)])
    return out
