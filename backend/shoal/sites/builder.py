"""Build GOTM water-column sites and per-run GOTM configurations.

A *site* is the physical setting of a project: location, depth, vertical grid,
meteorological forcing and climatological T/S/nutrient profiles. Three kinds:

* ``generated`` — built from open data for any wet point: ERA5 meteorology,
  WOA23 T/S (initial + relaxation) and nutrients (initial + relaxation),
  ETOPO depth. This reproduces the set-up described in Vijayakumaran et al.
  (2026) §3.1 (1D GOTM, ERA5 forcing, WOA relaxation, mimicked tides).
* ``gotm_case`` — one of the official GOTM test cases (e.g. northern North Sea
  ``nns_annual``) which ship their own forcing; works offline.
* ``imported`` — a user-provided GOTM setup directory (e.g. the ECOSMO E2E
  test cases from Zenodo).
"""
from __future__ import annotations

import calendar
import datetime as dt
import json
import shutil
from pathlib import Path
from typing import Callable

from .. import yamlio
from ..config import KERNEL_SRC
from ..data import sources

TEMPLATE_DIR = Path(__file__).parent / "templates"
Progress = Callable[[str, float], None] | None

GOTM_CASES = {
    "nns_annual": {
        "label": "北海北部 PROVESS 1998（GOTM 官方算例）",
        "path": KERNEL_SRC / "gotm-cases" / "nns_annual",
        "lat": 59.33, "lon": 1.28, "depth": 110.0,
        "years": [1998, 1998],
    },
}

SITE_FILE = "site.json"


def _write_profiles(path: Path, depth_axis: list[float], months: list[list[float]], years: range,
                    max_depth: float, scale: float = 1.0) -> None:
    """GOTM profile time series (mid-month climatology repeated for every year)."""
    zs = [d for d in depth_axis if d <= max_depth + 1e-6]
    if not zs or zs[-1] < max_depth:
        zs = zs + [max_depth]
    lines = []
    y0, y1 = years.start - 1, years.stop  # pad one year either side for interpolation
    for y in range(y0, y1 + 1):
        for m in range(1, 13):
            prof = months[m - 1]
            stamp = f"{y:04d}-{m:02d}-15 00:00:00"
            lines.append(f"{stamp}  {len(zs)}  2")
            for z in zs:
                # value at depth z (nearest WOA level at or above z)
                k = max(i for i, d in enumerate(depth_axis) if d <= z + 1e-6) if any(d <= z for d in depth_axis) else 0
                lines.append(f"{-z:10.2f} {prof[k] * scale:12.5f}")
    path.write_text("\n".join(lines) + "\n")


def build_generated_site(site_dir: Path, spec: dict, progress: Progress = None) -> dict:
    """Download data and write forcing files for a generated site.

    spec keys: name, lat, lon, depth (optional; ETOPO when missing), forcing_years [y0, y1]
    """
    site_dir.mkdir(parents=True, exist_ok=True)
    lat, lon = float(spec["lat"]), float(spec["lon"])
    if not spec.get("depth"):
        if progress:
            progress("查询 ETOPO 水深", 0.02)
        spec["depth"] = round(sources.point_depth(lat, lon), 1)
    depth = float(spec["depth"])
    y0, y1 = [int(v) for v in spec["forcing_years"]]

    def sub(lo: float, hi: float):
        return (lambda m, f: progress(m, lo + (hi - lo) * f)) if progress else None

    met = sources.era5_hourly(lat, lon, y0, y1, progress=sub(0.05, 0.5))
    rows = sources.era5_to_gotm_meteo(met)
    (site_dir / "meteo_era5.dat").write_text("\n".join(rows) + "\n")

    woa = sources.woa_profiles(lat, lon, ["temperature", "salinity", "nitrate", "phosphate", "silicate", "oxygen"],
                               progress=sub(0.5, 0.95))
    info = {
        "kind": "generated",
        "name": spec.get("name") or f"{lat:.2f}N {lon:.2f}E",
        "lat": lat, "lon": lon, "depth": depth,
        "forcing_years": [y0, y1],
        "woa_cell": woa.get("cell"),
        "woa_depth": woa["depth"],
        "sources": {
            "meteo": "ERA5 hourly (Copernicus C3S) via Open-Meteo archive API",
            "profiles": "World Ocean Atlas 2023, monthly 1° climatology (NOAA NCEI)",
            "depth": "ETOPO 2022 (NOAA)" if not spec.get("depth_from_user") else "user",
        },
        "created": dt.datetime.now().isoformat(timespec="seconds"),
    }
    (site_dir / "woa.json").write_text(json.dumps(woa))
    (site_dir / SITE_FILE).write_text(json.dumps(info, indent=2, ensure_ascii=False))
    if progress:
        progress("站点数据完成", 1.0)
    return info


def build_case_site(site_dir: Path, case: str) -> dict:
    c = GOTM_CASES[case]
    site_dir.mkdir(parents=True, exist_ok=True)
    for f in Path(c["path"]).iterdir():
        if f.is_file():
            shutil.copy2(f, site_dir / f.name)
    info = {
        "kind": "gotm_case", "case": case, "name": c["label"],
        "lat": c["lat"], "lon": c["lon"], "depth": c["depth"], "forcing_years": c["years"],
        "sources": {"meteo": "GOTM test case (PROVESS 1998)", "profiles": "GOTM test case observations"},
        "created": dt.datetime.now().isoformat(timespec="seconds"),
    }
    (site_dir / SITE_FILE).write_text(json.dumps(info, indent=2, ensure_ascii=False))
    return info


def import_site(site_dir: Path, src: Path) -> dict:
    """Copy a GOTM setup directory (must contain gotm.yaml)."""
    src = Path(src).expanduser()
    if not (src / "gotm.yaml").exists():
        raise ValueError("所选目录中没有 gotm.yaml")
    site_dir.mkdir(parents=True, exist_ok=True)
    for f in src.iterdir():
        if f.is_file() and f.suffix not in (".nc",):
            shutil.copy2(f, site_dir / f.name)
    g = yamlio.load(site_dir / "gotm.yaml")
    loc = g.get("location", {})
    t = g.get("time", {})
    y0 = int(str(t.get("start", "2000"))[:4])
    y1 = int(str(t.get("stop", "2001"))[:4])
    info = {
        "kind": "imported", "name": str(loc.get("name", src.name)),
        "lat": float(loc.get("latitude", 0)), "lon": float(loc.get("longitude", 0)),
        "depth": float(loc.get("depth", 100)), "forcing_years": [y0, max(y0, y1 - (1 if str(t.get("stop", ""))[5:10] == "01-01" else 0))],
        "source_dir": str(src), "sources": {"meteo": f"imported from {src}"},
        "created": dt.datetime.now().isoformat(timespec="seconds"),
    }
    (site_dir / SITE_FILE).write_text(json.dumps(info, indent=2, ensure_ascii=False))
    return info


def load_site(site_dir: Path) -> dict | None:
    f = site_dir / SITE_FILE
    if not f.exists():
        return None
    return json.loads(f.read_text())


# ----------------------------------------------------------------------------
# Repeating / shifting meteorological forcing
# ----------------------------------------------------------------------------
def _shift_rows(rows: list[str], src_year: int, dst_year: int) -> list[str]:
    out = []
    for r in rows:
        if not r.startswith(f"{src_year:04d}-"):
            continue
        md = r[5:10]
        if md == "02-29" and not calendar.isleap(dst_year):
            continue
        out.append(f"{dst_year:04d}" + r[4:])
    return out


def compose_meteo(site_dir: Path, sim_years: list[int], year_map: dict[int, int], out_dir: Path | None = None) -> Path:
    """Write meteo file for the simulated years, mapping each to a forcing year."""
    src = (site_dir / "meteo_era5.dat").read_text().splitlines()
    by_year: dict[int, list[str]] = {}
    for r in src:
        if r.strip():
            by_year.setdefault(int(r[:4]), []).append(r)
    lines: list[str] = []
    for y in sim_years:
        fy = year_map[y]
        lines.extend(_shift_rows(by_year.get(fy, []), fy, y))
    # one extra day so GOTM can interpolate to the final stop time
    last_y = sim_years[-1] + 1
    fy = year_map[sim_years[-1]]
    lines.extend(_shift_rows(by_year.get(fy, []), fy, last_y)[:48])
    out = (out_dir or site_dir) / "meteo.dat"
    out.write_text("\n".join(lines) + "\n")
    return out


# ----------------------------------------------------------------------------
# GOTM configuration for one run
# ----------------------------------------------------------------------------
PHYSICS_OUTPUT = ["temp", "salt", "h", "nuh", "mld_surf", "rad", "u10", "v10", "airt", "taub"]


def simulation_years(sim: dict, site: dict) -> tuple[list[int], dict[int, int]]:
    """Years simulated (incl. spin-up) and the forcing year used for each.

    sim: {"mode": "repeat" | "period", "repeat_year": Y, "years": N, "spinup_years": S,
          "period": [y0, y1]}
    repeat  — Y's forcing repeated (S + N) years; analysis shows the last N years
              (Vijayakumaran et al.: 20 years repeated annual forcing, last year shown)
    period  — S spin-up years cycling the first forcing year, then the real period
    """
    fy0, fy1 = site["forcing_years"]
    s = int(sim.get("spinup_years", 0))
    if sim.get("mode", "repeat") == "repeat":
        Y = int(sim.get("repeat_year", fy1))
        n = int(sim.get("years", 1))
        years = list(range(Y - (s + n) + 1, Y + 1))
        return years, {y: Y for y in years}
    p0, p1 = [int(v) for v in sim.get("period", [fy0, fy1])]
    p0, p1 = max(p0, fy0), min(p1, fy1)
    spin = list(range(p0 - s, p0))
    years = spin + list(range(p0, p1 + 1))
    m = {y: (p0 if y < p0 else y) for y in years}
    return years, m


def make_gotm_yaml(run_dir: Path, site_dir: Path, site: dict, sim: dict, host_inputs: dict,
                   nutrient_inputs: dict, output_vars: list[str]) -> dict:
    """Write gotm.yaml in run_dir. Returns timing info."""
    years, ymap = simulation_years(sim, site)
    if site["kind"] == "generated":
        g = yamlio.load(TEMPLATE_DIR / "gotm_base.yaml")
    else:
        g = yamlio.load(site_dir / "gotm.yaml")
    g["title"] = f"Shoal — {site['name']}"
    loc = g["location"]
    loc["name"] = site["name"]
    loc["latitude"] = float(site["lat"])
    loc["longitude"] = float(site["lon"])
    loc["depth"] = float(site["depth"])
    t = g["time"]
    t["method"] = "start_stop"
    t["start"] = f"{years[0]:04d}-01-01 00:00:00"
    t["stop"] = f"{years[-1] + 1:04d}-01-01 00:00:00"
    t["dt"] = float(sim.get("dt", 1800.0))
    grid = g["grid"]
    grid["nlev"] = int(sim.get("nlev", 83))
    grid["method"] = "analytical"
    grid["ddu"] = float(sim.get("ddu", 0.0))
    grid["ddl"] = float(sim.get("ddl", 0.0))

    if site["kind"] == "generated":
        woa = json.loads((site_dir / "woa.json").read_text())
        rng = range(years[0], years[-1] + 1)
        _write_profiles(run_dir / "tprof.dat", woa["depth"], woa["temperature"], rng, site["depth"])
        _write_profiles(run_dir / "sprof.dat", woa["depth"], woa["salinity"], rng, site["depth"])
        relax_ts = float(sim.get("relax_ts_days", 30.0)) * 86400.0
        for key, fname in (("temperature", "tprof.dat"), ("salinity", "sprof.dat")):
            node = g[key]
            node["method"] = "file"
            node["file"] = fname
            node["column"] = 1
            node["relax"]["tau"] = relax_ts
            node["relax"]["tau_s"] = relax_ts
            node["relax"]["tau_b"] = relax_ts
        g["temperature"]["type"] = "in-situ"
        g["salinity"]["type"] = "practical"
        meteo = compose_meteo(site_dir, years, ymap, run_dir)
        srf = g["surface"]
        for i, k in enumerate(["u10", "v10", "airp", "airt", "hum", "cloud"], start=1):
            srf[k]["method"] = "file"
            srf[k]["file"] = str(meteo)
            srf[k]["column"] = i
        srf["airp"]["scale_factor"] = 100.0
        srf["hum"]["type"] = "relative"
        srf["swr"]["method"] = "file"
        srf["swr"]["file"] = str(meteo)
        srf["swr"]["column"] = 7
        srf["swr"]["type"] = 2
        srf["sst"]["method"] = "constant"
        srf["fluxes"]["method"] = "fairall"
        # mimic tides with an M2 surface-slope oscillation (Vijayakumaran et al. §3.1)
        ep = g["mimic_3d"]["ext_pressure"]
        ep["type"] = "elevation"
        # tide_scale: 0 = no tides, 1 = central North Sea (paper default), 2 = macrotidal shelves
        ts = float(sim.get("tide_scale", 1.0))
        for comp, amp, phase in (("dpdx", sim.get("tide_dpdx", 5.0e-6), 0.0), ("dpdy", sim.get("tide_dpdy", 3.0e-6), 11178.5)):
            ep[comp]["method"] = "tidal"
            ep[comp]["tidal"]["amp_1"] = float(amp) * ts
            ep[comp]["tidal"]["phase_1"] = float(phase)
            ep[comp]["tidal"]["amp_2"] = 0.0
        ep["h"]["method"] = "constant"
        ep["h"]["constant_value"] = 0.0
        g["bottom"]["h0b"] = float(sim.get("bottom_roughness", 0.005))
    else:
        # use the case's own files by absolute path
        _absolutize_files(g, site_dir)
        if site["kind"] == "gotm_case":
            srf = g["surface"]
            if "sst" in srf:
                srf["sst"]["method"] = "constant"
        meteo_years = years
        # GOTM cases cover a single year: the time window must lie inside the forcing
        if years[0] < site["forcing_years"][0] or years[-1] > site["forcing_years"][1]:
            _repeat_case_files(run_dir, site_dir, g, years, ymap)
        del meteo_years

    # FABM
    fb = g["fabm"]
    fb["use"] = True
    fb["yaml_file"] = "fabm.yaml"
    fb["repair_state"] = True
    fb["freshwater_impact"] = False
    inputs = yamlio.cmap()
    for name, value in host_inputs.items():
        inputs[name] = yamlio.cmap({"method": "constant", "constant_value": float(value)})
    if site["kind"] == "generated" and nutrient_inputs:
        woa = json.loads((site_dir / "woa.json").read_text())
        rng = range(years[0], years[-1] + 1)
        tau = float(sim.get("relax_nut_days", 365.0)) * 86400.0
        for woa_var, (gotm_name, scale) in nutrient_inputs.items():
            fname = f"woa_{woa_var}.dat"
            _write_profiles(run_dir / fname, woa["depth"], woa[woa_var], rng, site["depth"], scale=scale)
            inputs[gotm_name] = yamlio.cmap({"method": "file", "file": fname, "relax_tau": tau})
    if inputs:
        fb["input"] = inputs
    elif "input" in fb:
        del fb["input"]

    g["restart"]["load"] = False
    g["output"] = yamlio.cmap({
        "result": yamlio.cmap({
            "time_unit": sim.get("output_unit", "day"),
            "time_step": int(sim.get("output_days", 1)) if sim.get("output_unit", "day") == "day" else 1,
            "time_method": "mean",
            "sync_interval": 1,
            "variables": [yamlio.cmap({"source": v}) for v in PHYSICS_OUTPUT + output_vars],
        })
    })
    yamlio.dump(g, run_dir / "gotm.yaml")
    n_analysis = int(sim.get("years", len(years))) if sim.get("mode", "repeat") == "repeat" else len(years) - int(sim.get("spinup_years", 0))
    n_analysis = max(1, min(n_analysis, len(years)))
    a0 = years[len(years) - n_analysis]
    if sim.get("analysis_from"):
        a0 = max(years[0], min(int(sim["analysis_from"]), years[-1]))
    return {
        "start": t["start"], "stop": t["stop"], "years": years,
        "analysis_start": f"{a0:04d}-01-01",
        "forcing_map": {str(k): v for k, v in ymap.items()},
        "nlev": grid["nlev"], "dt": t["dt"],
    }


def _absolutize_files(node, base: Path) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "file" and isinstance(v, str) and v and not Path(v).is_absolute() and (base / v).exists():
                node[k] = str(base / v)
            else:
                _absolutize_files(v, base)
    elif isinstance(node, list):
        for v in node:
            _absolutize_files(v, base)


def _repeat_case_files(run_dir: Path, site_dir: Path, g, years: list[int], ymap: dict[int, int]) -> None:
    """Re-date every time-series file of a single-year case to cover the simulated years."""
    seen: dict[str, str] = {}

    def visit(node):
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "file" and isinstance(v, str) and v and Path(v).exists() and Path(v).suffix in (".dat", ".prof", ""):
                    if v not in seen:
                        seen[v] = str(_redate_file(Path(v), run_dir, years, ymap))
                    node[k] = seen[v]
                else:
                    visit(v)
        elif isinstance(node, list):
            for v in node:
                visit(v)

    visit(g)


def _redate_file(src: Path, run_dir: Path, years: list[int], ymap: dict[int, int]) -> Path:
    import re

    text = src.read_text().splitlines()
    stamp = re.compile(r"^(\d{4})(-\d\d-\d\d \d\d:\d\d:\d\d)(.*)$")
    blocks: list[tuple[int, str, list[str]]] = []  # (year, rest-of-stamp, lines incl. header)
    cur = None
    for line in text:
        m = stamp.match(line)
        if m:
            cur = [int(m.group(1)), m.group(2) + m.group(3), [line]]
            blocks.append(cur)
        elif cur is not None:
            cur[2].append(line)
    if not blocks:
        return src
    src_year = blocks[0][0]
    out = []
    for y in years + [years[-1] + 1]:
        for by, rest, lines in blocks:
            if by != src_year:
                continue
            if rest[1:6] == "02-29" and not calendar.isleap(y):
                continue
            out.append(f"{y:04d}{rest}")
            out.extend(lines[1:])
    dst = run_dir / f"case_{src.name}"
    dst.write_text("\n".join(out) + "\n")
    return dst
