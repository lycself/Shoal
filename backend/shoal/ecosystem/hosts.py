"""Lower-trophic-level (LTL) host models and how higher trophic levels plug into them.

Each host describes
* the FABM template (a complete, runnable fabm.yaml),
* *roles*: which host variables play phytoplankton / zooplankton / detritus /
  DOM / sediment / nutrient parts for the HTL couplings in Vijayakumaran et al.
  (2026) section 3.2 and Powley et al. (2026) Table 1,
* unit conversions to the E2E internal currency (mg C; mmol N, P, Si, O2),
* zooplankton mortality parameters (for "+20 % zooplankton mortality" closure
  experiments and for the reduced closure when fish are explicit),
* which WOA climatologies relax which nutrient state variables.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

TEMPLATES = Path(__file__).parent / "templates"

CMASS = 12.011
MGC_PER_MMOLN = 6.625 * 12.01      # ECOSMO / Redfield: mg C per mmol N
MGC_PER_MMOLP = 106.0 * 12.01      # mg C per mmol P
MGC_PER_MMOLSI = 6.625 * 12.01     # ECOSMO silicate carbon units


@dataclass
class Prey:
    key: str                 # role key used by HTL tables, e.g. "Zl" (large zooplankton)
    label: str               # human label
    var: str                 # FABM path of the carbon (or main currency) variable, e.g. "Z4/c"
    composition: str = "c"   # for E2E: which constituents to link (c n p s l)
    c_scale: float = 1.0     # host unit -> mg C
    qn: float | None = None  # N:C (mmol N / mg C) when n not tracked
    qp: float | None = None
    instance: str | None = None   # FABM instance holding the variable (ERSEM: one per group)
    size: tuple[float, float] | None = None  # wet mass range (g) for size-based predators (MIZER)


@dataclass
class Host:
    id: str
    label: str
    reference: str
    template: str
    description: str
    prey: dict[str, Prey]
    det: tuple[str, str, float]          # (instance path prefix, composition, scale internal->host)
    dom: tuple[str, str, float] | None
    sed: tuple[str, str, float]          # bottom pool
    nh4: tuple[str, float]
    po4: tuple[str, float]
    dic: tuple[str, float] | None
    o2: tuple[str, float] | None
    zoo_mortality: list[tuple[str, str]]  # (instance, parameter)
    nutrient_inputs: dict[str, tuple[str, float]]  # WOA variable -> (GOTM name, scale)
    fabm_inputs: dict[str, float] = field(default_factory=dict)
    chlorophyll: list[str] = field(default_factory=list)
    phyto_carbon: list[str] = field(default_factory=list)
    zoo_carbon: list[str] = field(default_factory=list)
    npp: list[str] = field(default_factory=list)


def esd2mass(esd_min_um: float, esd_max_um: float) -> tuple[float, float]:
    """Wet mass range (g) of spheres with the given ESD range (Powley et al. Table 1)."""
    import math

    f = lambda d: math.pi / 6.0 * (d * 1e-4) ** 3  # cm^3 ~ g
    return f(esd_min_um), f(esd_max_um)


HOSTS: dict[str, Host] = {
    "ersem": Host(
        id="ersem",
        label="ERSEM",
        reference="Butenschön et al. (2016) GMD 9, 1293",
        template="ersem.yaml",
        description="欧洲区域海洋生态系统模型：包含 4 类浮游植物、3 类浮游动物、异养细菌、3 类溶解有机物与 3 粒级颗粒碎屑，核算碳、氮、磷、硅、氧五种元素并含底栖子模型，支持耦合 E2E 与 MIZER。",
        prey={
            "Pd": Prey("Pd", "硅藻 P1", "P1/c", "cnpsl", instance="P1", size=esd2mass(20, 200)),
            "Pn": Prey("Pn", "微型浮游植物 P2", "P2/c", "cnpl", instance="P2", size=esd2mass(2, 20)),
            "Pp": Prey("Pp", "超微型浮游植物 P3", "P3/c", "cnpl", instance="P3", size=esd2mass(0.2, 2)),
            "Pf": Prey("Pf", "小型浮游植物 P4（20–200 µm）", "P4/c", "cnpl", instance="P4", size=esd2mass(20, 200)),
            "Zl": Prey("Zl", "中型浮游动物 Z4", "Z4/c", "c", qn=0.0126, qp=0.000786, instance="Z4", size=(4.188e-6, 1e-3)),
            "Zs": Prey("Zs", "微型浮游动物 Z5", "Z5/c", "cnp", instance="Z5", size=esd2mass(20, 200)),
            "Zh": Prey("Zh", "异养鞭毛虫 Z6", "Z6/c", "cnp", instance="Z6", size=esd2mass(2, 20)),
        },
        det=("R6", "cnps", 1.0),
        dom=("R1", "cnp", 1.0),
        sed=("Q6", "cnps", 1.0),
        nh4=("N4/n", 1.0),
        po4=("N1/p", 1.0),
        dic=("O3/c", 1.0 / CMASS),
        o2=("O2/o", 1.0),
        zoo_mortality=[("Z4", "sd"), ("Z4", "mort"), ("Z5", "sd"), ("Z6", "sd")],
        nutrient_inputs={"nitrate": ("N3_n", 1.0), "phosphate": ("N1_p", 1.0), "silicate": ("N5_s", 1.0), "oxygen": ("O2_o", 1.0)},
        fabm_inputs={"mole_fraction_of_carbon_dioxide_in_air": 385.0, "absorption_of_silt": 0.07, "bottom_stress": 0.0},
        chlorophyll=["P1_Chl", "P2_Chl", "P3_Chl", "P4_Chl"],
        phyto_carbon=["P1_c", "P2_c", "P3_c", "P4_c"],
        zoo_carbon=["Z4_c", "Z5_c", "Z6_c"],
        npp=["P1_netPI", "P2_netPI", "P3_netPI", "P4_netPI"],
    ),
    "ecosmo": Host(
        id="ecosmo",
        label="ECOSMO",
        reference="Daewel & Schrum (2013) J. Mar. Syst. 119-120",
        template="ecosmo.yaml",
        description="ECOSMO II：包含硅藻、鞭毛藻（可选蓝藻）、微型与中型浮游动物、颗粒碎屑、溶解有机物与沉积物库，核算氮、磷、硅循环并以碳当量（mg C）为单位，是 ECOSMO E2E 的原生宿主模型。",
        prey={
            "Pf": Prey("Pf", "鞭毛藻 fla", "ECO/fla", "c"),
            "Pd": Prey("Pd", "硅藻 dia", "ECO/dia", "c"),
            "Zs": Prey("Zs", "微型浮游动物 microzoo", "ECO/microzoo", "c"),
            "Zl": Prey("Zl", "中型浮游动物 mesozoo", "ECO/mesozoo", "c"),
        },
        det=("ECO/det", "c", 1.0),
        dom=("ECO/dom", "c", 1.0),
        sed=("ECO/sed1", "c", 1.0),
        nh4=("ECO/nh4", MGC_PER_MMOLN),
        po4=("ECO/pho", MGC_PER_MMOLP),
        dic=("CO2/dic", 1.0 / CMASS),
        o2=("ECO/oxy", 1.0),
        zoo_mortality=[("ECO", "mZl"), ("ECO", "mZs")],
        nutrient_inputs={"nitrate": ("ECO_no3", MGC_PER_MMOLN), "phosphate": ("ECO_pho", MGC_PER_MMOLP), "silicate": ("ECO_sil", MGC_PER_MMOLSI), "oxygen": ("ECO_oxy", 1.0)},
        fabm_inputs={"mole_fraction_of_carbon_dioxide_in_air": 385.0},
        chlorophyll=["ECO_diachl", "ECO_flachl"],
        phyto_carbon=["ECO_dia", "ECO_fla"],
        zoo_carbon=["ECO_mesozoo", "ECO_microzoo"],
        npp=["ECO_primprod"],
    ),
    "ergom": Host(
        id="ergom",
        label="ERGOM",
        reference="Neumann (2000) J. Mar. Syst. 25; Neumann et al. (2002)",
        template="ergom.yaml",
        description="波罗的海生态区域海洋模型：包含硅藻、鞭毛藻、固氮蓝藻、单一浮游动物、颗粒碎屑与絮状沉积层，核算氮、磷循环与底层缺氧过程，以氮为基本核算单位。",
        prey={
            "Pd": Prey("Pd", "硅藻 pp", "ergom/pp", "c", c_scale=MGC_PER_MMOLN),
            "Pf": Prey("Pf", "鞭毛藻 ff", "ergom/ff", "c", c_scale=MGC_PER_MMOLN),
            "Zl": Prey("Zl", "浮游动物 zz", "ergom/zz", "c", c_scale=MGC_PER_MMOLN),
        },
        det=("ergom/dd", "c", 1.0 / MGC_PER_MMOLN),
        dom=None,
        sed=("ergom/fl", "c", 1.0 / MGC_PER_MMOLN),
        nh4=("ergom/aa", 1.0),
        po4=("ergom/po", 1.0),
        dic=None,
        o2=("ergom/o2", 1.0),
        zoo_mortality=[("ergom", "sigma_b")],
        nutrient_inputs={"nitrate": ("ergom_nn", 1.0), "phosphate": ("ergom_po", 1.0), "oxygen": ("ergom_o2", 1.0)},
        fabm_inputs={},
        chlorophyll=["ergom_tot_chla"],
        phyto_carbon=["ergom_pp", "ergom_ff", "ergom_bb"],
        zoo_carbon=["ergom_zz"],
        npp=[],
    ),
}


def host_summary(h: Host) -> dict:
    return {
        "id": h.id,
        "label": h.label,
        "reference": h.reference,
        "description": h.description,
        "prey": [{"key": p.key, "label": p.label, "var": p.var} for p in h.prey.values()],
        "has_dom": h.dom is not None,
        "supports_mizer": h.id == "ersem",
    }
