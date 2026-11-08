"""Project store.

<workspace>/projects/<pid>/
    project.json            name, site spec, simulation settings, template
    site/                   forcing files (site.json, meteo, WOA profiles) — built by a site job
    configs/<cid>.json      ecosystem configuration specs (host + HTL modules + overrides)
    experiments/<eid>.json  experiment = ordered set of runs (config + label)
    runs/<rid>/             gotm.yaml, fabm.yaml, result.nc, gotm.log, run.json
    shelf/                  3D column-ensemble set-ups and results
"""
from __future__ import annotations

import datetime as dt
import json
import re
import shutil
import uuid
from pathlib import Path

from .config import projects_dir
from .ecosystem import builder

PAPER1 = "Powley et al. (2026) Prog. Oceanogr. 243, 103701"
PAPER2 = "Vijayakumaran et al. (2026) EGUsphere-2026-3078 (ECOSMO E2E v2.0)"


def _now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def _slug(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower()
    return (s[:24] or "project") + "-" + uuid.uuid4().hex[:6]


def _read(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def _write(p: Path, data: dict) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


def project_dir(pid: str) -> Path:
    d = projects_dir() / pid
    if not d.is_dir() or not (d / "project.json").exists():
        raise KeyError(f"项目不存在：{pid}")
    return d


# ----------------------------------------------------------------- templates
SITE_PRESETS = {
    "central_north_sea": {
        "kind": "generated", "name": "北海中部 56°N 3°E", "lat": 56.0, "lon": 3.0, "depth": 73.0,
        "forcing_years": [2014, 2014],
        "note": "季节性层化的温带陆架站点（73 m）；ECOSMO E2E 的基准站点（Vijayakumaran et al. 2026 §3.1）",
    },
    "central_north_sea_long": {
        "kind": "generated", "name": "北海中部 56°N 3°E（1981–2017）", "lat": 56.0, "lon": 3.0, "depth": 73.0,
        "forcing_years": [1981, 2017],
        "note": "1981–2017 真实年份序列（Powley et al. 2026 的模拟期）",
    },
    "northern_north_sea_case": {
        "kind": "gotm_case", "case": "nns_annual", "name": "北海北部 PROVESS 1998（离线算例）",
        "note": "GOTM 官方算例，自带强迫数据，无需联网",
    },
}

SIM_PRESETS = {
    "paper2": {"mode": "repeat", "repeat_year": 2014, "years": 1, "spinup_years": 19, "dt": 1800.0, "nlev": 83,
               "relax_ts_days": 30.0, "relax_nut_days": 365.0, "relax_nutrients": True},
    "paper2_quick": {"mode": "repeat", "repeat_year": 2014, "years": 1, "spinup_years": 4, "dt": 1800.0, "nlev": 83,
                     "relax_ts_days": 30.0, "relax_nut_days": 365.0, "relax_nutrients": True},
    "paper1": {"mode": "period", "period": [1981, 2017], "spinup_years": 5, "analysis_from": 1986, "dt": 1800.0,
               "nlev": 51, "relax_ts_days": 30.0, "relax_nut_days": 365.0, "relax_nutrients": True},
    "case": {"mode": "repeat", "repeat_year": 1998, "years": 1, "spinup_years": 2, "dt": 1800.0, "nlev": 55,
             "relax_nutrients": False},
}


def _cfg(name: str, desc: str, spec: dict, origin: str) -> dict:
    return {"name": name, "description": desc, "spec": builder.normalize_spec(spec), "origin": origin}


HOST_NAME = {"ecosmo": "ECOSMO", "ersem": "ERSEM", "ergom": "ERGOM"}

# Experiment designs: each answers one research question and creates its own configurations.
# "ref" is the published study the design follows (shown as a citation, not as the design's identity).
DESIGNS = {
    "baseline": {
        "label": "单个低营养级模型", "hosts": "any",
        "question": "站点的物理与低营养级生态是什么样的？",
        "description": "只运行所选宿主的低营养级模型，作为起点；之后可以在食物网编辑器中添加高营养级。",
        "runs_per_host": 1, "ref": "",
    },
    "topdown": {
        "label": "高营养级的下行控制", "hosts": "any",
        "question": "鱼和底栖动物对浮游生物有多大影响？",
        "description": "每个宿主 5 个对照：仅低营养级 / 加大型底栖 / 加鱼类 / 鱼类+底栖（完整）/ 只提高浮游动物死亡率 20%（看鱼的作用能不能用“浮游动物多死一点”来代替）。",
        "runs_per_host": 5, "ref": PAPER2 + " §3.3",
    },
    "hosts": {
        "label": "宿主模型对比", "hosts": "multi",
        "question": "结论是否依赖所用的低营养级模型？",
        "description": "同一套功能群高营养级（鱼 1、鱼 2、大型底栖）分别接入所选的每个宿主，比较响应是否一致。需要选两个以上宿主。",
        "runs_per_host": 1, "ref": PAPER2 + " §3.5",
    },
    "coupling": {
        "label": "耦合方式：单向 vs 双向", "hosts": "ersem",
        "question": "鱼的反馈会改变浮游生物和鱼本身吗？",
        "description": "ERSEM 宿主上的粒径谱鱼类群落（MIZER）：基线 / 单向（鱼不影响浮游生物）/ 双向（捕食、排泄、呼吸反馈）。",
        "runs": 3, "ref": PAPER1 + " §2.3",
    },
    "framework": {
        "label": "高营养级表示方式：功能群 vs 粒径谱", "hosts": "ersem",
        "question": "用功能群还是粒径谱表示鱼，结论有何不同？",
        "description": "同一个 ERSEM 水柱上分别接入功能群（E2E：鱼 1、鱼 2、大型底栖）和粒径谱（MIZER，100 个粒径级），并与无鱼基线比较。",
        "runs": 3, "ref": f"{PAPER1}; {PAPER2}",
    },
}


def design_contents(designs: list[str], hosts: list[str]) -> tuple[list[dict], list[dict]]:
    """(configs, experiments) for a set of experiment designs and lower-trophic hosts."""
    hosts = [h for h in hosts if h in HOST_NAME] or ["ersem"]
    configs: dict[str, dict] = {}
    experiments: list[dict] = []

    def cfg(key: str, name: str, desc: str, spec: dict, ref: str) -> str:
        if key not in configs:
            c = _cfg(name, desc, spec, ref)
            c["key"] = key
            configs[key] = c
        return key

    def e2e_cfgs(h: str) -> dict[str, str]:
        L = HOST_NAME[h]
        zoo = 0.8 if h == "ecosmo" else 1.0  # ECOSMO's zooplankton closure is lowered when fish are coupled
        ref = DESIGNS["topdown"]["ref"]
        return {
            "ltl": cfg(f"{h}_ltl", f"{L} 仅低营养级", "没有鱼类和大型底栖动物，作为基线", {"host": h, "htl": {"kind": "none"}}, ref),
            "mb": cfg(f"{h}_mb", f"{L} + 大型底栖", "只耦合大型底栖功能群", {"host": h, "htl": {"kind": "e2e", "e2e": {"macrobenthos": True, "fish1": False, "fish2": False}}, "ltl": {"zoo_mortality_factor": zoo}}, ref),
            "fish": cfg(f"{h}_fish", f"{L} + 鱼类", "两个鱼类功能群（浮游食性、底栖/鱼食性），没有大型底栖", {"host": h, "htl": {"kind": "e2e", "e2e": {"macrobenthos": False, "fish1": True, "fish2": True}}, "ltl": {"zoo_mortality_factor": zoo}}, ref),
            "control": cfg(f"{h}_control", f"{L} + 鱼类 + 底栖（完整）", "两个鱼类功能群和大型底栖动物，最完整的配置", {"host": h, "htl": {"kind": "e2e"}, "ltl": {"zoo_mortality_factor": zoo}}, ref),
            "zoo120": cfg(f"{h}_zoo120", f"{L} 浮游动物死亡率 +20%", "没有鱼，只把浮游动物死亡率提高 20%：用“多死一点”代替鱼的捕食", {"host": h, "htl": {"kind": "none"}, "ltl": {"zoo_mortality_factor": 1.2}}, ref),
        }

    def mizer_cfgs() -> dict[str, str]:
        ref = DESIGNS["coupling"]["ref"]
        return {
            "baseline": cfg("ersem_ltl", "ERSEM 仅低营养级", "没有鱼类和大型底栖动物，作为基线", {"host": "ersem", "htl": {"kind": "none"}}, ref),
            "offline": cfg("mizer_offline", "ERSEM + MIZER 单向", "鱼由浮游生物驱动，但鱼的捕食不影响浮游生物（feedback: false）", {"host": "ersem", "htl": {"kind": "mizer", "mizer": {"feedback": False}}}, ref),
            "twoway": cfg("mizer_twoway", "ERSEM + MIZER 双向", "鱼的捕食、排泄与呼吸反馈给 ERSEM；中型浮游动物的种内捕食与基础死亡由鱼的捕食取代", {"host": "ersem", "htl": {"kind": "mizer", "mizer": {"feedback": True}}, "ltl": {"z4_cannibalism": False, "z4_basal_mortality": False}}, ref),
        }

    for d in designs:
        D = DESIGNS.get(d)
        if not D:
            continue
        if d == "baseline":
            for h in hosts:
                k = cfg(f"{h}_ltl", f"{HOST_NAME[h]} 仅低营养级", "没有鱼类和大型底栖动物，作为基线", {"host": h, "htl": {"kind": "none"}}, "")
                experiments.append({"name": f"{HOST_NAME[h]} 低营养级", "description": D["question"], "paper": "", "items": [{"key": k, "label": configs[k]["name"]}]})
        elif d == "topdown":
            for h in hosts:
                c = e2e_cfgs(h)
                order = ["ltl", "mb", "fish", "control", "zoo120"]
                experiments.append({"name": f"下行控制 · {HOST_NAME[h]}", "description": D["description"], "paper": D["ref"],
                                    "items": [{"key": c[k], "label": configs[c[k]]["name"]} for k in order]})
        elif d == "hosts" and len(hosts) >= 2:
            items = [{"key": e2e_cfgs(h)["control"], "label": f"{HOST_NAME[h]} 完整"} for h in hosts]
            experiments.append({"name": "宿主模型对比", "description": D["description"], "paper": D["ref"], "items": items})
        elif d == "coupling":
            c = mizer_cfgs()
            experiments.append({"name": "耦合方式：单向 vs 双向", "description": D["description"], "paper": D["ref"],
                                "items": [{"key": c[k], "label": configs[c[k]]["name"]} for k in ("baseline", "offline", "twoway")]})
        elif d == "framework":
            m, e = mizer_cfgs(), e2e_cfgs("ersem")
            experiments.append({"name": "功能群 vs 粒径谱", "description": D["description"], "paper": D["ref"],
                                "items": [{"key": m["baseline"], "label": "ERSEM 仅低营养级"}, {"key": e["control"], "label": "ERSEM + 功能群（E2E）"}, {"key": m["twoway"], "label": "ERSEM + 粒径谱（MIZER 双向）"}]})
    # the low-trophic baseline of the MIZER designs and of the E2E designs is the same configuration
    return list(configs.values()), experiments


# Old template ids map onto designs, so saved links and the assistant keep working.
TEMPLATES = {
    "paper2": {"designs": ["topdown", "hosts"], "hosts": ["ecosmo", "ersem", "ergom"]},
    "paper1": {"designs": ["coupling"], "hosts": ["ersem"], "site": "central_north_sea_long", "sim": "paper1"},
    "union": {"designs": ["topdown", "coupling", "framework"], "hosts": ["ersem"]},
    "offline_demo": {"designs": ["topdown", "coupling", "framework"], "hosts": ["ersem"], "site": "northern_north_sea_case", "sim": "case"},
    "blank": {"designs": ["baseline"], "hosts": ["ersem"]},
}


def describe_designs(designs: list[str], hosts: list[str]) -> tuple[str, str]:
    labels = [DESIGNS[d]["label"] for d in designs if d in DESIGNS]
    refs = sorted({part.split(" §")[0].strip() for d in designs for part in DESIGNS.get(d, {}).get("ref", "").split(";") if part.strip()})
    desc = "；".join(labels) + f"（宿主：{' / '.join(HOST_NAME[h] for h in hosts if h in HOST_NAME)}）"
    return desc, "; ".join(refs)


# ------------------------------------------------------------------- CRUD
def list_projects() -> list[dict]:
    out = []
    for d in sorted(projects_dir().iterdir()):
        f = d / "project.json"
        if f.exists():
            try:
                p = _read(f)
                p["n_runs"] = len(list((d / "runs").glob("*/run.json"))) if (d / "runs").exists() else 0
                out.append(p)
            except Exception:
                continue
    out.sort(key=lambda p: p.get("modified", p.get("created", "")), reverse=True)
    return out


def create_project(name: str, template: str = "", site: dict | None = None, simulation: dict | None = None,
                   description: str = "", designs: list[str] | None = None, hosts: list[str] | None = None,
                   offline: bool = False) -> dict:
    t = TEMPLATES.get(template, {}) if template else {}
    designs = designs or t.get("designs") or ["baseline"]
    hosts = hosts or t.get("hosts") or ["ersem"]
    bad = [d for d in designs if d not in DESIGNS] + [h for h in hosts if h not in HOST_NAME]
    if bad:
        raise ValueError(f"未知的实验设计或宿主：{', '.join(bad)}")
    if "hosts" in designs and len(hosts) < 2:
        raise ValueError("“宿主模型对比”需要至少选择两个宿主")
    if offline:
        t = {**t, "site": "northern_north_sea_case", "sim": "case"}
    site_key = t.get("site", "central_north_sea")
    sim = dict(SIM_PRESETS[t.get("sim", "paper2_quick")])
    auto_desc, refs = describe_designs(designs, hosts)
    site_spec = dict(site or SITE_PRESETS[site_key])
    pid = _slug(name or "project")
    d = projects_dir() / pid
    d.mkdir(parents=True)
    if simulation:
        sim.update(simulation)
    if site_spec.get("kind") == "generated" and sim.get("mode") == "repeat":
        sim["repeat_year"] = int(site_spec["forcing_years"][-1])
    proj = {
        "id": pid, "name": name or f"{site_spec.get('name', '新站点')}", "description": description or auto_desc,
        "designs": designs, "hosts": hosts, "paper": refs, "site": site_spec, "site_status": "missing",
        "simulation": sim, "created": _now(), "modified": _now(),
    }
    _write(d / "project.json", proj)
    configs, experiments = design_contents(designs, hosts)
    key_to_id = {}
    for c in configs:
        cid = uuid.uuid4().hex[:8]
        key_to_id[c["key"]] = cid
        _write(d / "configs" / f"{cid}.json", {"id": cid, "created": _now(), **c})
    for e in experiments:
        eid = uuid.uuid4().hex[:8]
        items = [{"config_id": key_to_id[i["key"]], "label": i["label"]} for i in e["items"]]
        _write(d / "experiments" / f"{eid}.json", {"id": eid, "created": _now(), "name": e["name"],
                                                   "description": e["description"], "paper": e["paper"], "items": items})
    return proj


def get_project(pid: str) -> dict:
    d = project_dir(pid)
    p = _read(d / "project.json")
    from .sites.builder import load_site

    p["site_info"] = load_site(d / "site")
    if p["site_info"] and p.get("site_status") != "building":
        p["site_status"] = "ready"
    return p


def update_project(pid: str, patch: dict) -> dict:
    d = project_dir(pid)
    p = _read(d / "project.json")
    for k in ("name", "description", "simulation", "site", "site_status", "notes"):
        if k in patch:
            if k == "simulation" and isinstance(patch[k], dict):
                p.setdefault("simulation", {}).update(patch[k])
            else:
                p[k] = patch[k]
    if "site" in patch:
        # a new site spec invalidates downloaded forcing
        shutil.rmtree(d / "site", ignore_errors=True)
        p["site_status"] = "missing"
    p["modified"] = _now()
    _write(d / "project.json", p)
    return get_project(pid)


def delete_project(pid: str) -> None:
    d = project_dir(pid)
    trash = projects_dir().parent / "trash"
    trash.mkdir(exist_ok=True)
    shutil.move(str(d), str(trash / f"{pid}-{dt.datetime.now():%Y%m%d%H%M%S}"))


# configs
def list_configs(pid: str) -> list[dict]:
    d = project_dir(pid) / "configs"
    return sorted((_read(f) for f in d.glob("*.json")), key=lambda c: c.get("created", "")) if d.exists() else []


def get_config(pid: str, cid: str) -> dict:
    return _read(project_dir(pid) / "configs" / f"{cid}.json")


def save_config(pid: str, data: dict) -> dict:
    d = project_dir(pid) / "configs"
    cid = data.get("id") or uuid.uuid4().hex[:8]
    old = {}
    if (d / f"{cid}.json").exists():
        old = _read(d / f"{cid}.json")
    c = {**old, **data, "id": cid}
    c["spec"] = builder.normalize_spec(c.get("spec", {}))
    c.setdefault("created", _now())
    c["modified"] = _now()
    builder.build_fabm_yaml(c["spec"])  # validate
    _write(d / f"{cid}.json", c)
    return c


def delete_config(pid: str, cid: str) -> None:
    (project_dir(pid) / "configs" / f"{cid}.json").unlink(missing_ok=True)


# experiments
def list_experiments(pid: str) -> list[dict]:
    d = project_dir(pid) / "experiments"
    return sorted((_read(f) for f in d.glob("*.json")), key=lambda c: c.get("created", "")) if d.exists() else []


def save_experiment(pid: str, data: dict) -> dict:
    d = project_dir(pid) / "experiments"
    eid = data.get("id") or uuid.uuid4().hex[:8]
    old = _read(d / f"{eid}.json") if (d / f"{eid}.json").exists() else {}
    e = {**old, **data, "id": eid}
    e.setdefault("created", _now())
    _write(d / f"{eid}.json", e)
    return e


def delete_experiment(pid: str, eid: str) -> None:
    (project_dir(pid) / "experiments" / f"{eid}.json").unlink(missing_ok=True)


# runs
def list_runs(pid: str) -> list[dict]:
    d = project_dir(pid) / "runs"
    if not d.exists():
        return []
    runs = []
    for f in d.glob("*/run.json"):
        try:
            runs.append(_read(f))
        except Exception:
            pass
    runs.sort(key=lambda r: r.get("created", ""), reverse=True)
    return runs


def get_run(pid: str, rid: str) -> dict:
    return _read(project_dir(pid) / "runs" / rid / "run.json")


def run_dir(pid: str, rid: str) -> Path:
    return project_dir(pid) / "runs" / rid


def write_run(pid: str, run: dict) -> None:
    _write(project_dir(pid) / "runs" / run["id"] / "run.json", run)


def delete_run(pid: str, rid: str) -> None:
    shutil.rmtree(project_dir(pid) / "runs" / rid, ignore_errors=True)


# ------------------------------------------------------------- parameter scans
def _apply_param(spec: dict, param: dict, value) -> dict:
    import copy

    s = copy.deepcopy(spec)
    kind = param["kind"]
    if kind == "e2e":
        s["htl"]["e2e"].setdefault("params", {}).setdefault(param["group"], {})[param["key"]] = value
    elif kind == "mizer":
        s["htl"]["mizer"].setdefault("params", {})[param["key"]] = value
    elif kind == "ltl":
        s["ltl"][param["key"]] = value
    elif kind == "override":
        s["overrides"] = [o for o in s.get("overrides", []) if o["path"] != param["path"]] + [{"path": param["path"], "value": value}]
    else:
        raise ValueError(f"未知参数类型 {kind}")
    return s


def create_scan(pid: str, data: dict) -> dict:
    """One configuration per value of a parameter, grouped in an experiment with scan metadata."""
    base = get_config(pid, data["config_id"])
    param = data["param"]
    values = [float(v) for v in data["values"]]
    if not values:
        raise ValueError("请至少给出一个取值")
    label = param.get("label") or param.get("key") or param.get("path")
    items = []
    for v in values:
        spec = _apply_param(base["spec"], param, v)
        c = save_config(pid, {"name": f"{base['name']} · {label}={v:g}", "description": f"参数扫描：{label} = {v:g}（基于 {base['name']}）",
                              "spec": spec, "origin": f"参数扫描（{base['name']}）", "scan_value": v})
        items.append({"config_id": c["id"], "label": f"{label} = {v:g}"})
    exp = save_experiment(pid, {"name": data.get("name") or f"参数扫描：{label}（{base['name']}）",
                                "description": f"{label} 取 {', '.join(f'{v:g}' for v in values)}，其余设置同“{base['name']}”。",
                                "paper": "", "items": items,
                                "scan": {"param": param, "label": label, "values": values, "base_config": base["id"]}})
    return exp
