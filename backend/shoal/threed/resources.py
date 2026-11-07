"""Machine capability check and cost estimate for shelf-scale (3D) simulations."""
from __future__ import annotations

import os
import platform
import shutil

import psutil

from ..config import kernel_info, load_settings, workspace

# Seconds of wall time per simulated year for one water column at 30 levels, dt=1800 s
# (measured on Apple M2; scaled linearly with levels and 1/dt). Used when no 1D run of
# the same configuration exists to calibrate from.
BASE_SEC_PER_YEAR = {"ersem": 2.4, "ecosmo": 0.5, "ergom": 0.35}
HTL_FACTOR = {"none": 1.0, "e2e": 1.15, "mizer": 1.6}
MB_PER_COLUMN_YEAR = 0.9  # monthly-mean output of ~150 variables on 30 levels


def system_info() -> dict:
    vm = psutil.virtual_memory()
    du = shutil.disk_usage(workspace())
    cpu = os.cpu_count() or 1
    try:
        phys = psutil.cpu_count(logical=False) or cpu
    except Exception:
        phys = cpu
    info = kernel_info()
    return {
        "platform": f"{platform.system()} {platform.machine()}",
        "processor": platform.processor() or platform.machine(),
        "cpu_logical": cpu, "cpu_physical": phys,
        "memory_total_gb": round(vm.total / 2**30, 1), "memory_available_gb": round(vm.available / 2**30, 1),
        "disk_free_gb": round(du.free / 2**30, 1),
        "max_parallel_runs": int(load_settings().get("max_parallel_runs", max(1, cpu - 2))),
        "pygetm_available": info.get("pygetm_available", False),
        "gotm_available": info.get("gotm_available", False),
    }


def estimate(n_columns: int, years: int, nlev: int, dt: float, host: str, htl: str,
             calibrated_sec_per_year: float | None = None, n_configs: int = 1) -> dict:
    sysinfo = system_info()
    workers = max(1, min(sysinfo["max_parallel_runs"], sysinfo["cpu_physical"]))
    if calibrated_sec_per_year:
        per_year = calibrated_sec_per_year
        basis = "按本项目一维运行实测速度换算"
    else:
        per_year = BASE_SEC_PER_YEAR.get(host, 2.0) * HTL_FACTOR.get(htl, 1.0) * (nlev / 30.0) * (1800.0 / dt)
        basis = "按内置基准（Apple M2）估算"
    total_cpu = per_year * years * n_columns * n_configs
    wall = total_cpu / workers
    disk_gb = MB_PER_COLUMN_YEAR * (nlev / 30.0) * years * n_columns * n_configs / 1024
    mem_gb = 0.12 * workers + 0.5
    warnings = []
    level = "ok"
    if wall > 3 * 3600:
        warnings.append("预计耗时超过 3 小时：建议降低分辨率、减少年数或层数，或在服务器上运行。")
        level = "heavy"
    elif wall > 1800:
        warnings.append("预计耗时超过 30 分钟，运行期间可以继续使用其他页面。")
        level = "moderate"
    if disk_gb > sysinfo["disk_free_gb"] * 0.5:
        warnings.append("输出可能占用超过一半的剩余磁盘空间。")
        level = "heavy"
    if mem_gb > sysinfo["memory_available_gb"]:
        warnings.append("并行进程所需内存可能超过当前可用内存，建议在设置中降低并行数。")
        level = "heavy"
    if n_columns > 2000:
        warnings.append("网格点超过 2000 个，ERA5 下载可能受到 Open-Meteo 每日请求额度限制。")
    return {
        "system": sysinfo, "workers": workers, "n_columns": n_columns, "years": years, "nlev": nlev, "dt": dt,
        "sec_per_column_year": round(per_year, 2), "basis": basis,
        "cpu_hours": round(total_cpu / 3600, 2), "wall_minutes": round(wall / 60, 1),
        "disk_gb": round(disk_gb, 2), "memory_gb": round(mem_gb, 1),
        "level": level, "warnings": warnings,
        "engine_note": ("当前三维计算采用“水柱集合”：每个网格点运行一个 GOTM–FABM 水柱，"
                        "保留各点的水深、气象强迫与气候态剖面，但不计算水平输运（与 Powley et al. 的离线 MIZER 逐格点运行方式一致；"
                        "NEMO-AMM7 的完整三维水动力需要超算）。"
                        + ("检测到 pygetm，可作为真三维引擎的后续扩展。" if sysinfo["pygetm_available"] else "")),
    }
