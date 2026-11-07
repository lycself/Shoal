"""Assemble a FABM configuration (fabm.yaml) from an ecosystem *configuration spec*.

A spec is plain JSON edited by the UI:

    {
      "host": "ersem" | "ecosmo" | "ergom",
      "htl": {
        "kind": "none" | "e2e" | "mizer",
        "e2e":   {"macrobenthos": true, "fish1": true, "fish2": true,
                  "params": {"MB": {...}, "F1": {...}, "F2": {...}}},
        "mizer": {"feedback": true, "params": {...}}
      },
      "ltl": {"zoo_mortality_factor": 1.0,
              "z4_cannibalism": true,        # ERSEM mesozooplankton intra-guild predation
              "z4_basal_mortality": true},   # ERSEM Z4 basal + overwintering mortality
      "overrides": [{"path": "instances/P1/parameters/sum", "value": 1.2}]
    }

Default HTL parameters reproduce Vijayakumaran et al. (2026) Tables 1-3 (E2E)
and Powley et al. (2026) Table S1 (FABM-MIZER).
"""
from __future__ import annotations

import copy
from typing import Any

from .. import yamlio
from .hosts import HOSTS, TEMPLATES, Host

# ----------------------------------------------------------------------------
# E2E default parameters (Vijayakumaran et al. 2026, Tables 1-3).
# Per-host values: default, (ERGOM) and [ERSEM] where the tables differ.
# ----------------------------------------------------------------------------
E2E_MB = {
    "m": 0.001, "mu": 0.025, "r": {"default": 0.1, "ergom": 0.2}, "gamma": 0.6, "alpha_dom": 0.3,
    "prey": {  # key: (sigma d-1, preference a)
        "det": (0.1, 0.1), "sed": (0.1, 0.1), "dom": (0.1, 0.1),
        "Pf": (0.1, 0.15), "Pd": (0.1, 0.2), "Zs": (0.1, 0.15), "Zl": (0.1, 0.2),
    },
}
E2E_F1 = {
    "m": {"default": 0.001, "ergom": 0.00113}, "mu": {"default": 0.001, "ergom": 0.00113},
    "r": 0.7, "r_ben": 0.9, "gamma": 0.7, "alpha_dom": 0.3,
    "prey": {"det": (0.0001, 0.1), "MB": (0.005, 0.1), "Zs": (0.033, 0.4), "Zl": (0.033, 0.4)},
}
E2E_F2 = {
    "m": {"default": 0.0005, "ergom": 0.00055}, "mu": {"default": 0.001, "ergom": 0.00105},
    "r": 0.7, "r_ben": 0.9, "gamma": 0.65, "alpha_dom": 0.3,
    "prey": {
        "det": (0.0001, 0.1),
        "MB": ({"default": 0.0045, "ersem": 0.004}, 0.4),
        "Zl": (0.001, 0.1),
        "F1": ({"default": 0.0045, "ersem": 0.004}, 0.4),
    },
}

# Powley et al. (2026) Table S1
MIZER_DEFAULTS = {
    "w_min": 1e-3, "w_inf": 1e6, "nclass": 100,
    "T_dependence": 1, "T_ref": 13.0, "E_a": 0.63,
    "beta": 100.0, "sigma": 2.3025,
    "gamma": 91.32, "q": 0.776,
    "alpha": 0.2, "alpha_eg": 0.3,
    "z0_type": 1, "z0pre": 0.2, "z0exp": -0.25,
    "w_s": 1000.0, "z_s": 0.3, "z_spre": 0.2,
    "ks": 0.0, "SRR": 3, "R_relax": 5.0, "h": 1e9,
    "fishing_type": 1, "w_minF": 80.0, "F": 0.8,
}

PARAM_DOCS = {
    # shown in the UI next to each HTL parameter
    "m": ("死亡率", "d⁻¹"), "mu": ("排泄率（0 °C 参考）", "d⁻¹"), "r": ("摄食半饱和常数", "mmol C m⁻³"),
    "r_ben": ("底栖饵料半饱和常数", "mmol C m⁻³"), "gamma": ("同化效率", "–"), "alpha_dom": ("未同化与死亡进入 DOM 的比例", "–"),
    "theta": ("排泄温度敏感性（活化能）", "eV"), "fishing": ("捕捞死亡率", "d⁻¹"), "c_ini": ("初始生物量", "mg C m⁻²"),
}


def _pick(v: Any, host: str) -> Any:
    if isinstance(v, dict):
        return v.get(host, v.get("default"))
    return v


def default_spec(host: str = "ersem", htl: str = "none") -> dict:
    return {
        "host": host,
        "htl": {
            "kind": htl,
            "e2e": {"macrobenthos": True, "fish1": True, "fish2": True, "params": {}},
            "mizer": {"feedback": True, "params": {}},
        },
        "ltl": {"zoo_mortality_factor": 1.0, "z4_cannibalism": True, "z4_basal_mortality": True},
        "overrides": [],
    }


def normalize_spec(spec: dict) -> dict:
    base = default_spec(spec.get("host", "ersem"))
    out = copy.deepcopy(base)
    for k, v in spec.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            for k2, v2 in v.items():
                if isinstance(v2, dict) and isinstance(out[k].get(k2), dict):
                    out[k][k2].update(v2)
                else:
                    out[k][k2] = v2
        else:
            out[k] = v
    return out


# ----------------------------------------------------------------------------
def build_fabm_yaml(spec: dict) -> Any:
    spec = normalize_spec(spec)
    host = HOSTS[spec["host"]]
    cfg = yamlio.load(TEMPLATES / host.template)
    inst = cfg["instances"]
    cfg["check_conservation"] = False
    cfg["require_initialization"] = True if host.id == "ersem" else cfg.get("require_initialization", False)

    _apply_ltl(inst, host, spec)
    kind = spec["htl"]["kind"]
    if kind == "e2e":
        _add_e2e(inst, host, spec["htl"]["e2e"])
    elif kind == "mizer":
        if host.id != "ersem":
            raise ValueError("FABM-MIZER 多元素版本需要 ERSEM 这样区分碳氮磷的宿主")
        _add_mizer(inst, host, spec["htl"]["mizer"])
    for o in spec.get("overrides", []):
        yamlio.set_path(cfg, o["path"], o["value"])
    return cfg


def _apply_ltl(inst, host: Host, spec: dict) -> None:
    ltl = spec["ltl"]
    f = float(ltl.get("zoo_mortality_factor", 1.0))
    if f != 1.0:
        for name, par in host.zoo_mortality:
            p = inst[name].setdefault("parameters", yamlio.cmap())
            if par in p:
                p[par] = float(p[par]) * f
            else:
                default = {"mZl": 0.10, "mZs": 0.20, "sigma_b": 0.03}.get(par)
                if default is not None:
                    p[par] = default * f
    if host.id == "ersem":
        z4 = inst["Z4"]["parameters"]
        if not ltl.get("z4_cannibalism", True):
            # Powley et al.: intra-guild predation replaced by explicit fish predation
            for i in range(1, int(z4.get("nprey", 0)) + 1):
                if str(inst["Z4"]["coupling"].get(f"prey{i}")) == "Z4":
                    z4[f"suprey{i}"] = 0.0
        if not ltl.get("z4_basal_mortality", True):
            # Powley et al. (2026): basal AND overwintering mortality are replaced by explicit fish predation
            z4["sd"] = 0.0
            z4["mort"] = 0.0


def _targets(host: Host, prefix_det: tuple[str, str, float], params: dict, for_benthos: bool) -> tuple[dict, dict]:
    """Coupling + parameters for E2E waste targets."""
    coupling: dict[str, str] = {}
    det_inst, det_comp, det_scale = prefix_det
    comp = "".join(c for c in det_comp if c in "cnps")
    params["det_composition"] = comp
    for c in comp:
        coupling[f"det_{c}"] = _var(det_inst, c)
        if c == "c" and det_scale != 1.0:
            params["det_c_scale"] = det_scale
    if host.dom:
        dinst, dcomp, _ = host.dom
        dcomp = "".join(c for c in dcomp if c in "cnp")
        params["dom_composition"] = dcomp
        for c in dcomp:
            coupling[f"dom_{c}"] = _var(dinst, c)
    else:
        params["dom_composition"] = "x"
    ex = "ap"
    coupling["nh4"] = host.nh4[0]
    if host.nh4[1] != 1.0:
        params["nh4_scale"] = host.nh4[1]
    coupling["po4"] = host.po4[0]
    if host.po4[1] != 1.0:
        params["po4_scale"] = host.po4[1]
    if host.dic:
        ex += "c"
        coupling["dic"] = host.dic[0]
        params["dic_scale"] = host.dic[1]
    if host.o2:
        ex += "o"
        coupling["o2"] = host.o2[0]
        if host.o2[1] != 1.0:
            params["o2_scale"] = host.o2[1]
    params["excretion_targets"] = ex
    return coupling, params


def _var(inst_or_path: str, constituent: str) -> str:
    """'R6' + 'c' -> 'R6/c'; 'ECO/det' + 'c' -> 'ECO/det' (single currency hosts)."""
    if "/" in inst_or_path:
        return inst_or_path
    return f"{inst_or_path}/{constituent}"


def _prey_entries(host: Host, table: dict, extra_benthic: dict[str, str], params: dict, coupling: dict) -> None:
    """Fill preyN_* parameters/couplings for the prey keys available in this host."""
    n = 0
    for key, (sigma, a) in table["prey"].items():
        sigma = _pick(sigma, host.id)
        if key in host.prey:
            p = host.prey[key]
            n += 1
            params[f"prey{n}_sigma"] = sigma
            params[f"prey{n}_a"] = a
            comp = p.composition
            params[f"prey{n}_composition"] = comp
            if p.c_scale != 1.0:
                params[f"prey{n}_c_scale"] = p.c_scale
            if p.qn is not None:
                params[f"prey{n}_qn"] = p.qn
            if p.qp is not None:
                params[f"prey{n}_qp"] = p.qp
            base = p.instance or p.var
            coupling[f"prey{n}_c"] = p.var
            for c, suffix in (("n", "n"), ("p", "p"), ("s", "s"), ("l", "Chl")):
                if c in comp and p.instance:
                    coupling[f"prey{n}_{c if c != 'l' else 'chl'}"] = f"{base}/{suffix}"
        elif key in ("det", "dom") and (host.det if key == "det" else host.dom):
            inst_, comp, scale = host.det if key == "det" else host.dom
            n += 1
            params[f"prey{n}_sigma"] = sigma
            params[f"prey{n}_a"] = a
            cc = "".join(c for c in comp if c in "cnps")
            params[f"prey{n}_composition"] = cc
            if scale != 1.0:
                params[f"prey{n}_c_scale"] = 1.0 / scale
            coupling[f"prey{n}_c"] = _var(inst_, "c")
            for c in cc:
                if c != "c" and "/" not in inst_:
                    coupling[f"prey{n}_{c}"] = f"{inst_}/{c}"
        elif key == "sed":
            inst_, comp, scale = host.sed
            n += 1
            params[f"prey{n}_sigma"] = sigma
            params[f"prey{n}_a"] = a
            params[f"prey{n}_benthic"] = True
            if scale != 1.0:
                params[f"prey{n}_c_scale"] = 1.0 / scale
            coupling[f"prey{n}_c"] = _var(inst_, "c")
            if "/" not in inst_:
                cc = "".join(c for c in comp if c in "cnp")
                params[f"prey{n}_composition"] = cc
                for c in cc:
                    if c != "c":
                        coupling[f"prey{n}_{c}"] = f"{inst_}/{c}"
        elif key in extra_benthic:
            n += 1
            params[f"prey{n}_sigma"] = sigma
            params[f"prey{n}_a"] = a
            params[f"prey{n}_benthic"] = True
            coupling[f"prey{n}_c"] = extra_benthic[key]
    params["nprey"] = n


def _add_e2e(inst, host: Host, e2e: dict) -> None:
    user = e2e.get("params", {}) or {}
    benthic_prey: dict[str, str] = {}
    if e2e.get("macrobenthos", True):
        params: dict = {"c_ini": 3000.0}
        coupling: dict = {}
        for k in ("m", "mu", "r", "gamma", "alpha_dom"):
            params[k] = _pick(E2E_MB[k], host.id)
        _prey_entries(host, E2E_MB, {}, params, coupling)
        c2, params = _targets(host, host.sed, params, for_benthos=True)
        coupling.update(c2)
        params.update(user.get("MB", {}))
        inst["MB"] = yamlio.cmap({"long_name": "macrobenthos", "model": "e2e/macrobenthos",
                                  "parameters": yamlio.cmap(params), "coupling": yamlio.cmap(coupling),
                                  "initialization": yamlio.cmap({"c": float(params["c_ini"]), "landings": 0.0})})
        benthic_prey["MB"] = "MB/c"
    for name, table, enabled, long_name in (
        ("F1", E2E_F1, e2e.get("fish1", True), "planktivorous fish"),
        ("F2", E2E_F2, e2e.get("fish2", True), "bentho-piscivorous fish"),
    ):
        if not enabled:
            continue
        params = {"c_ini": 1000.0 if name == "F1" else 300.0}
        coupling = {}
        for k in ("m", "mu", "r", "r_ben", "gamma", "alpha_dom"):
            params[k] = _pick(table[k], host.id)
        _prey_entries(host, table, benthic_prey, params, coupling)
        c2, params = _targets(host, host.det, params, for_benthos=False)
        coupling.update(c2)
        params.update(user.get(name, {}))
        inst[name] = yamlio.cmap({"long_name": long_name, "model": "e2e/fish",
                                  "parameters": yamlio.cmap(params), "coupling": yamlio.cmap(coupling),
                                  "initialization": yamlio.cmap({"c": float(params["c_ini"]), "landings": 0.0})})
        if name == "F1":
            benthic_prey["F1"] = "F1/c"


def _add_mizer(inst, host: Host, mz: dict) -> None:
    params = dict(MIZER_DEFAULTS)
    params.update(mz.get("params", {}) or {})
    params["feedback"] = bool(mz.get("feedback", True))
    keys = ["Pd", "Pn", "Pp", "Pf", "Zl", "Zs", "Zh"]  # P1 P2 P3 P4 Z4 Z5 Z6 as in Powley et al.
    coupling: dict = {}
    params["nprey"] = len(keys)
    for i, k in enumerate(keys, start=1):
        p = host.prey[k]
        params[f"w_prey{i}_min"] = float(f"{p.size[0]:.4g}")
        params[f"w_prey{i}_max"] = float(f"{p.size[1]:.4g}")
        coupling[f"prey{i}"] = p.instance
    coupling.update({
        "egested_matter": "R8",       # large POM (Powley et al. section 2.2)
        "respired_carbon": "O3",
        "oxygen_consumed": "O2",
        "excreted_nitrogen": "N4",
        "excreted_phosphorus": "N1",
    })
    init = yamlio.cmap({"landings": 0.0})
    c0 = float(params.pop("c_ini", 0.0)) or None
    nclass = int(params["nclass"])
    for i in range(1, nclass + 1):
        # small seed following a ~w^-1 biomass spectrum; recruitment from the plankton spectrum takes over
        init[f"c{i}"] = c0 if c0 else 0.05
    inst["fish"] = yamlio.cmap({"long_name": "fish community size spectrum", "model": "mizer/multi_element_population",
                                "parameters": yamlio.cmap(params), "coupling": yamlio.cmap(coupling),
                                "initialization": init})


# ----------------------------------------------------------------------------
def htl_parameter_table(host_id: str) -> dict:
    """Default HTL parameter values for the UI (with descriptions)."""
    out = {}
    for name, table in (("MB", E2E_MB), ("F1", E2E_F1), ("F2", E2E_F2)):
        rows = []
        for k in ("m", "mu", "r", "r_ben", "gamma", "alpha_dom"):
            if k in table:
                label, unit = PARAM_DOCS[k]
                rows.append({"key": k, "label": label, "unit": unit, "value": _pick(table[k], host_id)})
        rows.append({"key": "theta", "label": PARAM_DOCS["theta"][0], "unit": "eV", "value": 0.0})
        rows.append({"key": "fishing", "label": PARAM_DOCS["fishing"][0], "unit": "d⁻¹", "value": 0.0})
        prey = []
        for key, (sigma, a) in table["prey"].items():
            prey.append({"key": key, "sigma": _pick(sigma, host_id), "a": a})
        out[name] = {"params": rows, "prey": prey}
    out["mizer"] = {"params": [{"key": k, "value": v} for k, v in MIZER_DEFAULTS.items()]}
    return out
