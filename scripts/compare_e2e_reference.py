# Validate Shoal against the official ECOSMO E2E reference output (model_output/*/result_*.nc).
# Run the official test case with kernel/install/bin/gotm (gotm.yaml upgraded with
# kernel/src/gotm/scripts/python/update_setup.py), then compare. See README, section ECOSMO E2E.
"""Compare a GOTM run against an ECOSMO E2E reference output.

usage: python compare.py <ref.nc> <run.nc> [label]
Prints, per variable, the depth-integrated (or bottom) mean over the last 10 years, the relative
difference, the correlation of the daily series and the max abs relative difference.
"""
import sys

import netCDF4 as nc
import numpy as np

ref, run = nc.Dataset(sys.argv[1]), nc.Dataset(sys.argv[2])
label = sys.argv[3] if len(sys.argv) > 3 else ""
VARS = ["temp", "N3_n", "N1_p", "P1_c", "P2_c", "P3_c", "P4_c", "Z4_c", "Z5_c", "Z6_c", "B1_c", "R6_c", "Q6_c",
        "MB_c", "FISH1_Fishint", "FISH2_Fishint", "FISH1_F1prey1", "FISH1_F1prey2", "FISH2_F1prey2", "FISH2_F1MB1"]


def series(d, k):
    v = d[k][:]
    v = np.ma.filled(v.astype(float), np.nan)
    if v.ndim == 4:  # time z lat lon -> depth integral (temp: depth mean)
        h = np.ma.filled(d["h"][:].astype(float), np.nan)[..., 0, 0]
        x = v[..., 0, 0]
        return (x * h).sum(1) / (h.sum(1) if k == "temp" else 1.0)
    return v.reshape(v.shape[0], -1)[:, 0]


n = min(len(ref["time"]), len(run["time"]))
last = slice(n - 3652, n)
print(f"{label}: {n} days compared, means over the last 10 years")
print(f"{'variable':<16}{'reference':>13}{'this run':>13}{'rel.diff':>10}{'corr':>8}{'max|rd|':>9}")
for k in VARS:
    alias = lambda d, k: k if k in d.variables else (k.replace("_Fishint", "_c") if k.endswith("_Fishint") and k.replace("_Fishint", "_c") in d.variables else None)
    ka, kb = alias(ref, k), alias(run, k)
    if not ka or not kb or k.startswith("FISH") and "_F1" in k and kb != k:
        continue
    a, b = series(ref, ka)[:n], series(run, kb)[:n]
    ma, mb = np.nanmean(a[last]), np.nanmean(b[last])
    rd = (mb - ma) / abs(ma) if ma else np.nan
    ok = np.isfinite(a) & np.isfinite(b)
    corr = np.corrcoef(a[ok], b[ok])[0, 1] if ok.sum() > 2 and np.std(a[ok]) > 0 and np.std(b[ok]) > 0 else np.nan
    mx = np.nanmax(np.abs(b[last] - a[last])) / max(abs(ma), 1e-30)
    print(f"{k:<16}{ma:13.4g}{mb:13.4g}{rd:10.2%}{corr:8.3f}{mx:9.2%}")
