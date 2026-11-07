"""Prepare run directories (gotm.yaml + fabm.yaml) for a project's runs."""
from __future__ import annotations

import contextlib
import io
import os
import re
import sys
from pathlib import Path

from . import yamlio
from .ecosystem import builder
from .ecosystem.hosts import HOSTS
from .sites import builder as sites

HTL_INSTANCES = ("MB", "F1", "F2", "fish")
CURATED_DIAG = [
    r"netPI$", r"^O3_(fair|pCO2|pH|Om_cal|TA)$", r"^light_parEIR$", r"^ECO_(primprod|secprod|parmean)$",
    r"^total_(carbon|nitrogen|phosphorus|silicate)", r"^zenithAngle_", r"^ergom_",
]
SKIP_DIAG = re.compile(r"(_sms|_sfl|_bfl|_w|_tot_calculator.*|_calculator_result)$|^fish_(f|g|reproduction)\d+$|_int_|food_density")


@contextlib.contextmanager
def _quiet():
    """Silence FABM's Fortran stdout while loading a model with pyfabm."""
    fd = sys.stdout.fileno() if hasattr(sys.stdout, "fileno") else None
    try:
        saved = os.dup(1)
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, 1)
        try:
            yield
        finally:
            os.dup2(saved, 1)
            os.close(devnull)
            os.close(saved)
    except (OSError, io.UnsupportedOperation):
        yield
    del fd


def describe_fabm(fabm_yaml: Path) -> dict:
    """State and diagnostic variables of a FABM configuration.

    pyfabm keeps global Fortran state and FABM stops the process on fatal
    configuration errors, so the model is loaded in a child process.
    """
    import json
    import subprocess

    proc = subprocess.run([sys.executable, "-m", "e2estudio.describe", str(fabm_yaml)],
                          capture_output=True, text=True, cwd=str(Path(__file__).resolve().parents[1]), timeout=120)
    marker = "@@JSON@@"
    if proc.returncode != 0 or marker not in proc.stdout:
        msg = (proc.stdout + proc.stderr).strip().splitlines()
        err = [l for l in msg if "FATAL" in l or "rror" in l] or msg[-5:]
        raise RuntimeError("FABM 配置无效：" + " | ".join(l.strip() for l in err[:4]))
    return json.loads(proc.stdout.split(marker, 1)[1])


def select_output(desc: dict) -> list[str]:
    names = [v["name"] for v in desc["state"]]
    for d in desc["diagnostic"]:
        n = d["name"]
        if SKIP_DIAG.search(n):
            continue
        inst = n.split("_", 1)[0]
        if inst in HTL_INSTANCES and d["output"]:
            names.append(n)
        elif any(re.search(p, n) for p in CURATED_DIAG) and d["output"]:
            names.append(n)
    seen = set()
    return [n for n in names if not (n in seen or seen.add(n))]


def prepare_run(run_dir: Path, site_dir: Path, site: dict, sim: dict, spec: dict) -> dict:
    run_dir.mkdir(parents=True, exist_ok=True)
    spec = builder.normalize_spec(spec)
    host = HOSTS[spec["host"]]
    cfg = builder.build_fabm_yaml(spec)
    yamlio.dump(cfg, run_dir / "fabm.yaml")
    desc = describe_fabm(run_dir / "fabm.yaml")
    out_vars = select_output(desc)
    timing = sites.make_gotm_yaml(run_dir, site_dir, site, sim, host.fabm_inputs,
                                  host.nutrient_inputs if sim.get("relax_nutrients", True) else {}, out_vars)
    return {"timing": timing, "n_output": len(out_vars), "host": host.id, "htl": spec["htl"]["kind"]}
