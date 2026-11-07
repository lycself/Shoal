"""Derive a food-web graph (nodes + trophic edges) from an ecosystem spec.

The graph is built from the actual FABM configuration the run uses, so what the
user sees is what the kernel computes: every ``preyN`` coupling becomes an edge
weighted by the predator's preference for that prey.
"""
from __future__ import annotations

import re

from .builder import build_fabm_yaml, normalize_spec

# (level, column group, label, colour role)
ERSEM_NODES = {
    "N3": (0, "nut", "硝酸盐 N3", "nutrient"), "N4": (0, "nut", "铵盐 N4", "nutrient"),
    "N1": (0, "nut", "磷酸盐 N1", "nutrient"), "N5": (0, "nut", "硅酸盐 N5", "nutrient"),
    "P1": (1, "pel", "硅藻 P1", "phyto"), "P2": (1, "pel", "微型藻 P2", "phyto"),
    "P3": (1, "pel", "超微型藻 P3", "phyto"), "P4": (1, "pel", "小型藻 P4", "phyto"),
    "B1": (1.5, "mic", "细菌 B1", "bacteria"),
    "Z6": (2, "pel", "纳米鞭毛虫 Z6", "zoo"), "Z5": (2, "pel", "小型浮游动物 Z5", "zoo"),
    "Z4": (2.5, "pel", "中型浮游动物 Z4", "zoo"),
    "R1": (0.5, "det", "溶解有机物 R1–R3", "organic"), "R6": (0.5, "det", "颗粒有机物 R4/R6/R8", "organic"),
    "Q6": (0, "ben", "沉积有机物 Q6", "benthic"),
}
ECOSMO_NODES = {
    "ECO/no3": (0, "nut", "硝酸盐", "nutrient"), "ECO/nh4": (0, "nut", "铵盐", "nutrient"),
    "ECO/pho": (0, "nut", "磷酸盐", "nutrient"), "ECO/sil": (0, "nut", "硅酸盐", "nutrient"),
    "ECO/dia": (1, "pel", "硅藻", "phyto"), "ECO/fla": (1, "pel", "鞭毛藻", "phyto"),
    "ECO/microzoo": (2, "pel", "小型浮游动物", "zoo"), "ECO/mesozoo": (2.5, "pel", "中型浮游动物", "zoo"),
    "ECO/det": (0.5, "det", "碎屑", "organic"), "ECO/dom": (0.5, "det", "溶解有机物", "organic"),
    "ECO/sed1": (0, "ben", "沉积有机物", "benthic"),
}
ECOSMO_EDGES = [
    ("ECO/no3", "ECO/dia", 1), ("ECO/nh4", "ECO/dia", 1), ("ECO/no3", "ECO/fla", 1), ("ECO/nh4", "ECO/fla", 1),
    ("ECO/pho", "ECO/dia", 1), ("ECO/sil", "ECO/dia", 1), ("ECO/pho", "ECO/fla", 1),
    ("ECO/fla", "ECO/microzoo", 0.68), ("ECO/dia", "ECO/microzoo", 0.24), ("ECO/det", "ECO/microzoo", 0.08),
    ("ECO/dia", "ECO/mesozoo", 0.72), ("ECO/microzoo", "ECO/mesozoo", 0.12), ("ECO/fla", "ECO/mesozoo", 0.08), ("ECO/det", "ECO/mesozoo", 0.08),
]
ERGOM_NODES = {
    "ergom/nn": (0, "nut", "硝酸盐", "nutrient"), "ergom/aa": (0, "nut", "铵盐", "nutrient"), "ergom/po": (0, "nut", "磷酸盐", "nutrient"),
    "ergom/pp": (1, "pel", "硅藻", "phyto"), "ergom/ff": (1, "pel", "鞭毛藻", "phyto"), "ergom/bb": (1, "pel", "蓝藻", "phyto"),
    "ergom/zz": (2, "pel", "浮游动物", "zoo"), "ergom/dd": (0.5, "det", "碎屑", "organic"), "ergom/fl": (0, "ben", "絮状沉积层", "benthic"),
}
ERGOM_EDGES = [
    ("ergom/nn", "ergom/pp", 1), ("ergom/aa", "ergom/pp", 1), ("ergom/nn", "ergom/ff", 1), ("ergom/aa", "ergom/ff", 1),
    ("ergom/po", "ergom/pp", 1), ("ergom/po", "ergom/ff", 1), ("ergom/po", "ergom/bb", 1),
    ("ergom/pp", "ergom/zz", 1), ("ergom/ff", "ergom/zz", 1), ("ergom/bb", "ergom/zz", 0.3),
]
HTL_NODES = {
    "MB": (2.6, "ben", "大型底栖动物 MB", "benthos"),
    "F1": (3.2, "htl", "鱼 1 浮游食性", "fish"),
    "F2": (4.0, "htl", "鱼 2 底栖/鱼食性", "fish"),
    "fish": (3.5, "htl", "鱼类粒径谱（MIZER，100 级）", "fish"),
}


def _node_of(path: str) -> str:
    """Map a FABM variable path to a node id."""
    p = str(path)
    if p.startswith(("ECO/", "ergom/")):
        return p
    inst = p.split("/")[0]
    if inst in ("R2", "R3"):
        return "R1"
    if inst in ("R4", "R8"):
        return "R6"
    return inst


def build_graph(spec: dict) -> dict:
    spec = normalize_spec(spec)
    cfg = build_fabm_yaml(spec)
    inst = cfg["instances"]
    host = spec["host"]
    nodes = {"ersem": ERSEM_NODES, "ecosmo": ECOSMO_NODES, "ergom": ERGOM_NODES}[host].copy()
    edges: list[dict] = []
    if host == "ecosmo":
        edges += [{"from": a, "to": b, "w": w, "kind": "ltl"} for a, b, w in ECOSMO_EDGES]
    elif host == "ergom":
        edges += [{"from": a, "to": b, "w": w, "kind": "ltl"} for a, b, w in ERGOM_EDGES]
    else:
        for p in ("P1", "P2", "P3", "P4"):
            for n in ("N3", "N4", "N1"):
                edges.append({"from": n, "to": p, "w": 1, "kind": "uptake"})
        edges.append({"from": "N5", "to": "P1", "w": 1, "kind": "uptake"})
        edges.append({"from": "R1", "to": "B1", "w": 1, "kind": "ltl"})
        # ERSEM zooplankton preferences from the actual configuration
        for z in ("Z4", "Z5", "Z6"):
            par = inst[z].get("parameters", {})
            cpl = inst[z].get("coupling", {})
            for i in range(1, int(par.get("nprey", 0)) + 1):
                prey = cpl.get(f"prey{i}")
                w = float(par.get(f"suprey{i}", 0))
                if prey and w > 0:
                    edges.append({"from": _node_of(prey), "to": z, "w": w, "kind": "ltl"})
    for name, (lvl, col, label, role) in HTL_NODES.items():
        if name in inst:
            nodes[name] = (lvl, col, label, role)
    for name in ("MB", "F1", "F2"):
        if name not in inst:
            continue
        par = inst[name]["parameters"]
        cpl = inst[name]["coupling"]
        for i in range(1, int(par.get("nprey", 0)) + 1):
            prey = cpl.get(f"prey{i}_c")
            if prey:
                edges.append({"from": _node_of(prey), "to": name, "w": float(par.get(f"prey{i}_a", 0)),
                              "sigma": float(par.get(f"prey{i}_sigma", 0)), "kind": "htl"})
        det = cpl.get("det_c")
        if det:
            edges.append({"from": name, "to": _node_of(det), "w": 0.3, "kind": "waste"})
    if "fish" in inst:
        cpl = inst["fish"]["coupling"]
        par = inst["fish"]["parameters"]
        for i in range(1, int(par.get("nprey", 0)) + 1):
            prey = cpl.get(f"prey{i}")
            if prey:
                edges.append({"from": _node_of(prey), "to": "fish", "w": 0.5, "kind": "htl",
                              "feedback": bool(par.get("feedback", True))})
        edges.append({"from": "fish", "to": _node_of(cpl.get("egested_matter", "R6")), "w": 0.3, "kind": "waste",
                      "feedback": bool(par.get("feedback", True))})
    present = {e["from"] for e in edges} | {e["to"] for e in edges} | set(nodes)
    out_nodes = []
    for nid, (lvl, col, label, role) in nodes.items():
        if nid in present:
            out_nodes.append({"id": nid, "level": lvl, "group": col, "label": label, "role": role,
                              "var": _output_var(nid)})
    known = {n["id"] for n in out_nodes}
    edges = [e for e in edges if e["from"] in known and e["to"] in known]
    return {"host": host, "nodes": out_nodes, "edges": edges, "htl": spec["htl"]["kind"]}


def _output_var(nid: str) -> str:
    if "/" in nid:
        return nid.replace("/", "_")
    if re.match(r"^N[1-5]$", nid):
        return {"N1": "N1_p", "N3": "N3_n", "N4": "N4_n", "N5": "N5_s"}[nid]
    return f"{nid}_c"
