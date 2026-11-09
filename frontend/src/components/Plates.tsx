// Figure plates in the layout of the two papers, built from the selected runs.
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { FoodWebGraph } from "./FoodWebGraph";
import { Plot, colorscaleFor, seriesColor } from "./Plot";
import { Empty, Icon, Loading, Notice, Seg, Select, cssVar, fmt, useAsync } from "./ui";
import { annualEvents, eventLayer, headroom, useSiteLat } from "./annotate";

type Host = "ersem" | "ecosmo" | "ergom";
const MGC_N = 79.5663;
/** Same ecological role in each host, converted to common units. */
export const ROLES: Record<string, { label: string; unit: string; depth: boolean; vars: Partial<Record<Host, [string, number]>> }> = {
  nitrate: { label: "硝酸盐", unit: "mmol N m⁻³", depth: true, vars: { ersem: ["N3_n", 1], ecosmo: ["ECO_no3", 1 / MGC_N], ergom: ["ergom_nn", 1] } },
  phosphate: { label: "磷酸盐", unit: "mmol P m⁻³", depth: true, vars: { ersem: ["N1_p", 1], ecosmo: ["ECO_pho", 1 / 1273.06], ergom: ["ergom_po", 1] } },
  silicate: { label: "硅酸盐", unit: "mmol Si m⁻³", depth: true, vars: { ersem: ["N5_s", 1], ecosmo: ["ECO_sil", 1 / MGC_N] } },
  oxygen: { label: "溶解氧", unit: "mmol O₂ m⁻³", depth: true, vars: { ersem: ["O2_o", 1], ecosmo: ["ECO_oxy", 1], ergom: ["ergom_o2", 1] } },
  flagellates: { label: "微型浮游植物 / 鞭毛藻", unit: "mg C m⁻³", depth: true, vars: { ersem: ["P2_c", 1], ecosmo: ["ECO_fla", 1], ergom: ["ergom_ff", MGC_N] } },
  diatoms: { label: "硅藻", unit: "mg C m⁻³", depth: true, vars: { ersem: ["P1_c", 1], ecosmo: ["ECO_dia", 1], ergom: ["ergom_pp", MGC_N] } },
  microzoo: { label: "微型浮游动物", unit: "mg C m⁻³", depth: true, vars: { ersem: ["Z5_c", 1], ecosmo: ["ECO_microzoo", 1] } },
  mesozoo: { label: "中型浮游动物", unit: "mg C m⁻³", depth: true, vars: { ersem: ["Z4_c", 1], ecosmo: ["ECO_mesozoo", 1], ergom: ["ergom_zz", MGC_N] } },
  detritus: { label: "碎屑", unit: "mg C m⁻³", depth: true, vars: { ersem: ["R6_c", 1], ecosmo: ["ECO_det", 1], ergom: ["ergom_dd", MGC_N] } },
  sediment: { label: "沉积有机碳", unit: "mg C m⁻²", depth: false, vars: { ersem: ["Q6_c", 1], ecosmo: ["ECO_sed1", 1], ergom: ["ergom_fl", MGC_N] } },
  temp: { label: "温度", unit: "°C", depth: true, vars: { ersem: ["temp", 1], ecosmo: ["temp", 1], ergom: ["temp", 1] } },
  salt: { label: "盐度", unit: "PSU", depth: true, vars: { ersem: ["salt", 1], ecosmo: ["salt", 1], ergom: ["salt", 1] } },
};
const ROW_SETS: Record<string, [string, string[]]> = {
  physics: ["物理", ["temp", "salt"]],
  nutrients: ["营养盐", ["nitrate", "phosphate", "silicate", "oxygen"]],
  plankton: ["浮游生物", ["flagellates", "diatoms", "microzoo", "mesozoo"]],
  detritus: ["碎屑", ["detritus"]],
};
/** Reading notes under a plate: how to read it and what physical / ecological picture it shows. */
function PlateNote({ read, show, look, tech }: { read: string; show: string[]; look?: string[]; tech?: string }) {
  return (
    <div className="reading reading-cols" style={{ marginTop: 6 }}>
      <h4>怎么读</h4><p>{read}</p>
      <h4>这张图说明了什么</h4><ul>{show.map((x, i) => <li key={i}>{x}</li>)}</ul>
      {look && <><h4>比较各运行时看什么</h4><ul>{look.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {tech && <p className="soft" style={{ marginTop: 8 }}>{tech}</p>}
    </div>
  );
}

const MATRIX_NOTES: Record<string, { show: string[]; look: string[] }> = {
  physics: {
    show: [
      "冬季整根水柱颜色上下一致：大风与海面冷却驱动垂向对流混合，表底水温基本相同。",
      "春季表层受热增温，水柱出现垂向分层并建立温跃层：上层暖而轻、下层冷而重，垂向湍流交换受到抑制。",
      "夏季表层最暖、底层保持低温；秋季大风与降温使混合层逐步加深，直至恢复冬季全水柱混合。潮流强劲的浅水站点则全年基本不分层。",
      "一维水柱模型不包含径流与水平平流，盐度主要由向 WOA23 气候态的松弛维持，季节变化较小。",
    ],
    look: ["由于生物过程不反馈物理场且大气强迫相同，各运行的物理场应当一致；若出现差异，说明垂向层数、模拟时段或强迫设置不同，对比生态变量前需先排查。"],
  },
  nutrients: {
    show: [
      "冬季全水柱混合将底层累积的营养盐带回表层，整根水柱浓度均处于高位。",
      "春季藻华爆发后，温跃层以上的硝酸盐、磷酸盐和硅酸盐被迅速消耗（表层颜色变浅），跃层以下则基本保持高浓度。",
      "夏季底层营养盐缓慢回升：沉降的有机碎屑在深层和海底经细菌再矿化释放无机盐，待秋冬季混合恢复后再补充至表层。",
      "表层溶解氧受海气交换与光合产氧维持而接近饱和；层化季节底层与表层隔绝且持续分解耗氧，浓度逐渐下降。",
    ],
    look: ["引入高营养级后无机营养盐格局通常变化不大；若表层耗尽时间或底层累积强度出现明显差异，说明下行控制已传导至浮游植物吸收或碎屑矿化通量。"],
  },
  plankton: {
    show: [
      "早春硅藻最先形成藻华；表层硅酸盐耗尽后，不需要硅的鞭毛藻在夏季接替占优。",
      "浮游动物生物量峰值通常比浮游植物滞后数周，反映捕食者对饵料增长的世代响应滞后。",
      "夏季浮游植物常在温跃层附近形成次表层叶绿素最大值（DCM）：表层光照充足但营养盐耗尽，深层营养盐充足但光照受限，跃层附近两者兼备。",
    ],
    look: ["加入鱼类的运行中，中型浮游动物峰值通常受捕食压制而降低；若微型浮游动物随之升高，则体现了时间–深度维度上的营养级联。"],
  },
  detritus: {
    show: [
      "颗粒有机碎屑（死亡个体与粪便）在春季藻华后增多并向深层沉降；层化期间主要在跃层以下和近底层累积。",
      "秋冬季混合将底层碎屑重新卷入水柱，伴随细菌矿化将其转化为无机营养盐，供次年春季藻华利用。",
    ],
    look: ["包含大型底栖动物的运行中，近底层碎屑浓度通常更低，因为底栖动物直接摄食沉降到海底的有机颗粒。"],
  },
};

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const MONTH_AXIS = { tickvals: [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], ticktext: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] };

type Plate = "matrix" | "htl" | "bars" | "years" | "fluxdiff" | "scan";

export function PlatesTab({ pid, runs, start }: { pid: string; runs: any[]; start?: string }) {
  const [plate, setPlate] = useState<Plate>("matrix");
  const configs = useAsync(() => api.get<any[]>(`/projects/${pid}/configs`), [pid]);
  const cfgOf = (r: any) => configs.data?.find((c) => c.id === r.config_id);
  const PLATES: [Plate, string, string][] = [
    ["matrix", "变量 × 运行：时间–深度矩阵", "Vijayakumaran 等 2026"],
    ["htl", "高营养级年循环", "Vijayakumaran 等 2026"],
    ["bars", "相对基准的差异", "Vijayakumaran 等 2026"],
    ["years", "多年变化", "Powley 等 2026"],
    ["fluxdiff", "库与通量差异图", "Powley 等 2026"],
    ["scan", "参数扫描响应", "Powley 等 2026"],
  ];
  return (
    <>
      <div className="optbar">
        <span className="opt">图版<Select size="sm" value={plate} onChange={(v) => setPlate(v as Plate)} style={{ minWidth: 260 }}>{PLATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></span>
        <span className="soft small grow">列 / 系列 = 左侧勾选的运行（按勾选顺序，第一个为基准）。导出：图右上角相机按钮（PNG，3 倍分辨率）。</span>
        <span className="soft small">（方法参考：{PLATES.find((x) => x[0] === plate)?.[2]}）</span>
      </div>
      <div className="split-scroll" style={{ padding: "12px 16px" }}>
        {plate === "matrix" && <MatrixPlate pid={pid} runs={runs} start={start} />}
        {plate === "htl" && <HtlPlate pid={pid} runs={runs} start={start} />}
        {plate === "bars" && <BarsPlate pid={pid} runs={runs} start={start} />}
        {plate === "years" && <YearsPlate pid={pid} runs={runs} />}
        {plate === "fluxdiff" && <FluxDiffPlate pid={pid} runs={runs} />}
        {plate === "scan" && <ScanPlate pid={pid} runs={runs} cfgOf={cfgOf} />}
      </div>
    </>
  );
}

function MatrixPlate({ pid, runs, start }: { pid: string; runs: any[]; start?: string }) {
  const dark = useApp((s) => s.dark);
  const [set, setSet] = useState("plankton");
  const roles = ROW_SETS[set][1];
  const data = useAsync(async () => {
    const q = start ? `&start=${start}` : "";
    const cells = await Promise.all(roles.flatMap((role) => runs.map(async (r) => {
      const v = ROLES[role].vars[r.spec.host as Host];
      if (!v) return { role, run: r.id, missing: true };
      try {
        const h = await api.get(`/projects/${pid}/runs/${r.id}/hovmoller?var=${v[0]}${q}`);
        return { role, run: r.id, ...h, values: h.values.map((row: any[]) => row.map((x) => (x == null ? null : x * v[1]))) };
      } catch { return { role, run: r.id, missing: true }; }
    })));
    return cells;
  }, [pid, runs.map((r) => r.id).join(), set, start]);
  const fig = useMemo(() => {
    if (!data.data) return null;
    const nr = roles.length, nc = runs.length;
    const gx = 0.025, gy = 0.06;
    const w = (1 - gx * (nc - 1)) / nc, h = (1 - gy * (nr - 1)) / nr;
    // break long column titles at a natural boundary (full-width paren or a space), never inside a number
    const wrap = (t: string) => {
      if (t.length <= 16) return t;
      if (t.includes("（")) return t.replace(/（/, "<br>（");
      const cut = t.lastIndexOf(" ", 14);
      return cut > 3 ? `${t.slice(0, cut)}<br>${t.slice(cut + 1)}` : t;
    };
    const traces: any[] = [];
    const layout: any = { margin: { l: 58, r: 120, t: 46, b: 30 }, annotations: [], showlegend: false };
    let letter = 0;
    roles.forEach((role, i) => {
      const rowCells = data.data!.filter((c: any) => c.role === role && !c.missing);
      const all = rowCells.flatMap((c: any) => c.values.flat()).filter((x: any) => x != null);
      // sort once (no spread: a matrix with many runs exceeds the JS argument limit)
      all.sort((a: number, b: number) => a - b);
      const zmax = all.length ? all[Math.floor(all.length * 0.995)] : 1;
      const zmin = all.length ? all[0] : 0;
      runs.forEach((r, j) => {
        const idx = i * nc + j + 1;
        const xa = idx === 1 ? "x" : `x${idx}`, ya = idx === 1 ? "y" : `y${idx}`;
        const x0 = j * (w + gx), y1 = 1 - i * (h + gy);
        layout[idx === 1 ? "xaxis" : `xaxis${idx}`] = { domain: [x0, x0 + w], anchor: ya, ...MONTH_AXIS_DATE, showticklabels: i === nr - 1, mirror: true };
        layout[idx === 1 ? "yaxis" : `yaxis${idx}`] = { domain: [y1 - h, y1], anchor: xa, autorange: "reversed", showticklabels: j === 0, title: j === 0 ? { text: "深度 (m)" } : undefined };
        const cell: any = data.data!.find((c: any) => c.role === role && c.run === r.id);
        if (i === 0) layout.annotations.push({ text: `<b>${wrap(r.label)}</b>`, xref: "paper", yref: "paper", x: x0 + w / 2, y: 1.005, yanchor: "bottom", showarrow: false, font: { size: 11 } });
        layout.annotations.push({ text: `(${LETTERS[letter++]})`, xref: "paper", yref: "paper", x: x0 + 0.004, y: y1 - 0.004, xanchor: "left", yanchor: "top", showarrow: false, font: { size: 10.5 }, bgcolor: dark ? "rgba(0,0,0,.4)" : "rgba(255,255,255,.7)" });
        if (!cell || cell.missing) {
          layout.annotations.push({ text: "该宿主无此类群", xref: "paper", yref: "paper", x: x0 + w / 2, y: y1 - h / 2, showarrow: false, font: { size: 11, color: cssVar("--fg-soft") } });
          return;
        }
        traces.push({ type: "heatmap", x: cell.time, y: cell.depth, z: cell.values, xaxis: xa, yaxis: ya, zmin, zmax, colorscale: colorscaleFor(ROLES[role].vars.ersem?.[0] ?? role, dark), zsmooth: "best",
          showscale: j === nc - 1, colorbar: { x: 1.01, xpad: 4, y: y1 - h / 2, len: h * 0.95, thickness: 10, title: { text: ROLES[role].unit, side: "right", font: { size: 10 } } },
          hovertemplate: `${ROLES[role].label}<br>%{x}<br>%{y:.1f} m: %{z:.3g} ${ROLES[role].unit}<extra>${r.label}</extra>` });
      });
      layout.annotations.push({ text: `<b>${ROLES[role].label}</b>`, xref: "paper", yref: "paper", x: 1.12, xanchor: "left", y: 1 - i * (h + gy) - h / 2, textangle: 90, showarrow: false, font: { size: 11.5 } });
    });
    return { traces, layout, height: 70 + nr * 190 };
  }, [data.data, dark]);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row"><span className="soft small">变量组</span><Seg size="sm" value={set} onChange={setSet as any} options={Object.entries(ROW_SETS).map(([k, [l]]) => [k, l] as [string, string])} /></div>
      {data.loading ? <Loading /> : fig && <Plot height={fig.height} data={fig.traces} layout={fig.layout} />}
      <PlateNote read="横轴是一年（J–D），纵轴是深度（向下越深），颜色是浓度；每一列是一个勾选的运行，同一行共用色标，可以直接比较深浅。" show={MATRIX_NOTES[set].show} look={MATRIX_NOTES[set].look}
        tech="每行色标上限取 99.5% 分位数，避免单个峰值压扁颜色。不同宿主的单位已统一：营养盐 mmol m⁻³，浮游生物与碎屑 mg C m⁻³（ERGOM 按 Redfield 比 6.625 换算为碳）。" />
    </div>
  );
}
const MONTH_AXIS_DATE = { tickformat: "%b", dtick: "M2" };

function useAnnual(pid: string, runs: any[], vars: string[], start?: string, mode = "integral") {
  return useAsync(() => Promise.all(vars.map((v) => api.post(`/projects/${pid}/results/annual`, { run_ids: runs.map((r) => r.id), var: v, mode, start }))), [pid, runs.map((r) => r.id).join(), vars.join(), start, mode]);
}

function HtlPlate({ pid, runs, start }: { pid: string; runs: any[]; start?: string }) {
  const dark = useApp((s) => s.dark);
  const lat = useSiteLat();
  const vars = ["MB_c", "F1_c", "F2_c", "fish_c_tot"];
  const titles: Record<string, string> = { MB_c: "大型底栖动物", F1_c: "鱼 1（浮游食性）", F2_c: "鱼 2（底栖 / 鱼食性）", fish_c_tot: "鱼类群落（MIZER，湿重）" };
  const d = useAnnual(pid, runs, vars, start);
  if (d.loading) return <Loading />;
  const panels = (d.data ?? []).map((res: any, i: number) => ({ v: vars[i], res })).filter((p) => p.res.series.some((s: any) => !s.missing));
  if (!panels.length) return <Empty icon="organization" title="所选运行没有高营养级模块" />;
  const n = panels.length, gap = 0.07, w = (1 - gap * (n - 1)) / n;
  const traces: any[] = [];
  const layout: any = { margin: { l: 56, r: 10, t: 34, b: 40 }, annotations: [], legend: { orientation: "h", y: -0.2 } };
  panels.forEach((p, i) => {
    const xa = i ? `x${i + 1}` : "x", ya = i ? `y${i + 1}` : "y";
    layout[i ? `xaxis${i + 1}` : "xaxis"] = { domain: [i * (w + gap), i * (w + gap) + w], anchor: ya, ...MONTH_AXIS };
    layout[i ? `yaxis${i + 1}` : "yaxis"] = { anchor: xa, title: { text: p.res.units || "mg C m⁻²" } };
    layout.annotations.push({ text: `<b>(${LETTERS[i]}) ${titles[p.v]}</b>`, xref: "paper", yref: "paper", x: i * (w + gap), y: 1.02, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 12 } });
    p.res.series.forEach((s: any, k: number) => {
      if (s.missing) return;
      traces.push({ x: s.doy, y: s.mean, type: "scatter", mode: "lines", name: s.label, legendgroup: s.label, showlegend: i === 0, xaxis: xa, yaxis: ya, line: { color: seriesColor(runs.findIndex((r) => r.label === s.label), dark), width: 2 } });
    });
    // the first run's seasonal peak, labelled in the panel
    const s0 = p.res.series.find((x: any) => !x.missing);
    if (s0) {
      // the range covers every run in the panel; the label goes where it covers none of their curves
      const live = p.res.series.filter((x: any) => !x.missing);
      const yr = headroom(live.flatMap((x: any) => x.mean), 0.35);
      const ev = eventLayer(annualEvents(p.v, s0.doy, s0.mean, lat).slice(0, 1).map((e) => ({ ...e, detail: `${e.sub} · ${fmt(e.y, 3)}` })),
        { xaxis: xa, yaxis: ya, series: live.map((x: any) => ({ x: x.doy, y: x.mean })), xRange: [1, 365], yRange: yr, px: [Math.max(160, (window.innerWidth - 760) / n - 40), 300] });
      layout.annotations.push(...ev.annotations);
      if (ev.marker) traces.push(ev.marker);
      layout[i ? `yaxis${i + 1}` : "yaxis"].range = yr;
    }
  });
  return (
    <div className="col" style={{ gap: 8 }}>
      <Plot height={380} data={traces} layout={layout} />
      <PlateNote read="每条曲线代表一次运行，纵轴为全水柱深度积分生物量，横轴为一年中的月份（取分析时段平均）。"
        show={["浮游食性的鱼 1 随浮游动物的季节消长而变化，春夏季饵料增加后生物量随之上升。", "底栖与鱼食性的鱼 2 摄食底栖动物和其他鱼类，饵料来源相对稳定，年内波动较平缓。", "大型底栖动物依赖春季藻华后沉降的有机碎屑，季节峰值比上层浮游生物滞后。"]}
        look={["若站点位于北海，可与国际底拖网调查（IBTS）的季节趋势对照：浮游食性鱼类在夏季开始增长（Vijayakumaran 等 2026）。注意底拖网单位捕捞努力量渔获（CPUE）仅反映相对丰度变化，不宜直接与模拟生物量对比绝对数值。"]} />
    </div>
  );
}

function BarsPlate({ pid, runs, start }: { pid: string; runs: any[]; start?: string }) {
  const dark = useApp((s) => s.dark);
  const roles = ["flagellates", "diatoms", "microzoo", "mesozoo", "detritus"];
  const data = useAsync(async () => {
    const out: Record<string, Record<string, number | null>> = {};
    for (const r of runs) {
      out[r.id] = {};
      await Promise.all(roles.map(async (role) => {
        const v = ROLES[role].vars[r.spec.host as Host];
        if (!v) { out[r.id][role] = null; return; }
        const ts = await api.post(`/projects/${pid}/results/timeseries`, { run_ids: [r.id], var: v[0], mode: "integral", start });
        const vals = (ts.series[0]?.values ?? []).filter((x: any) => x != null);
        out[r.id][role] = vals.length ? (vals.reduce((a: number, b: number) => a + b, 0) / vals.length) * v[1] : null;
      }));
    }
    return out;
  }, [pid, runs.map((r) => r.id).join(), start]);
  if (runs.length < 2) return <Empty icon="graph" title="请至少勾选两次运行">第一个运行作为基准（如“仅低营养级”），其余运行与基准对比。</Empty>;
  if (data.loading || !data.data) return <Loading />;
  const hosts = Array.from(new Set(runs.map((r) => r.spec.host)));
  const base = (host: string) => runs.find((r) => r.spec.host === host)!;
  const n = hosts.length, gap = 0.06, w = (1 - gap * (n - 1)) / n;
  // treatment type from the run's own configuration (not its name)
  const TYPES: [string, string, string][] = [["control", "完整（鱼 + 底栖）− 基准", "#1d5fa8"], ["mb", "大型底栖 − 基准", "#5b9bd5"], ["fish", "鱼类 − 基准", "#a9cbe8"], ["zoo120", "浮游动物死亡率 +20% − 基准", "#c9a227"], ["mizer", "粒径谱鱼类 − 基准", "#7048e8"]]; // design:allow-colour paper-style blues
  const kindOf = (r: any) => {
    const h = r.spec?.htl ?? {}, e = h.e2e ?? {};
    if (h.kind === "none") return (r.spec?.ltl?.zoo_mortality_factor ?? 1) > 1 ? "zoo120" : "ltl";
    if (h.kind === "mizer") return "mizer";
    const mb = e.macrobenthos !== false, fi = e.fish1 !== false || e.fish2 !== false;
    return mb && fi ? "control" : mb ? "mb" : "fish";
  };
  const typeOf = (r: any) => {
    const t = (TYPES.find(([k]) => k === kindOf(r)) ?? ["", r.label, seriesColor(runs.indexOf(r), dark)]) as [string, string, string];
    // the zooplankton-mortality treatment is named after the factor the run actually used
    if (t[0] === "zoo120") { const f = +(r.spec?.ltl?.zoo_mortality_factor ?? 1.2); return [t[0], `浮游动物死亡率 ${f >= 1 ? "+" : ""}${Math.round((f - 1) * 100)}% − 基准`, t[2]] as [string, string, string]; }
    return t;
  };
  const traces: any[] = [];
  const shown = new Set<string>();
  // legend under the plot (above it, it ran into the host titles); category names stay horizontal where they fit
  const layout: any = { barmode: "group", bargap: 0.25, margin: { l: 64, r: 10, t: 30, b: 70 }, annotations: [], legend: { orientation: "h", x: 0, y: -0.28, yanchor: "top", font: { size: 11.5 } } };
  hosts.forEach((h, i) => {
    const xa = i ? `x${i + 1}` : "x", ya = i ? `y${i + 1}` : "y";
    layout[i ? `xaxis${i + 1}` : "xaxis"] = { domain: [i * (w + gap), i * (w + gap) + w], anchor: ya, tickangle: n > 2 ? -30 : 0, automargin: true };
    layout[i ? `yaxis${i + 1}` : "yaxis"] = { anchor: xa, title: i === 0 ? { text: "与基准之差 (mg C m⁻²)" } : undefined, zeroline: true, zerolinewidth: 1.2 };
    layout.annotations.push({ text: `<b>${h.toUpperCase()}</b>`, xref: "paper", yref: "paper", x: i * (w + gap) + w / 2, y: 1.0, yanchor: "bottom", showarrow: false });
    const b = base(h);
    const rank = (r: any) => { const k = TYPES.findIndex(([t]) => t === kindOf(r)); return k < 0 ? 99 : k; };
    runs.filter((r) => r.spec.host === h && r.id !== b.id).sort((x, y) => rank(x) - rank(y)).forEach((r) => {
      const [, tl, col] = typeOf(r);
      const xs = roles.filter((role) => data.data![r.id][role] != null && data.data![b.id][role] != null);
      traces.push({ type: "bar", x: xs.map((role) => ROLES[role].label), y: xs.map((role) => data.data![r.id][role]! - data.data![b.id][role]!), name: tl, legendgroup: tl, showlegend: !shown.has(tl), xaxis: xa, yaxis: ya, marker: { color: col },
        hovertemplate: `%{x}: %{y:.3g} mg C m⁻²<extra>${r.label} − ${b.label}</extra>` });
      shown.add(tl);
    });
  });
  return (
    <div className="col" style={{ gap: 8 }}>
      <Plot height={460} data={traces} layout={layout} />
      <PlateNote read="每个子图对应一个宿主模型；柱高表示相对于该宿主第一个勾选运行（通常为“仅低营养级”）的年均生物量差值，颜色区分不同实验配置（完整耦合、仅大型底栖、仅鱼类、浮游动物死亡率上调）。"
        show={["加入鱼类后中型浮游动物普遍下降，体现捕食者的下行控制。", "加入大型底栖动物后颗粒碎屑普遍减少，反映底栖动物对沉降有机物的摄食消耗。", "“浮游动物死亡率 +20%”用于同仅调高闭合死亡率的做法对照：若其响应与显式加入鱼类相近，说明鱼类对该变量的净效应主要体现为增加浮游动物死亡损失。"]}
        look={["对比同一处理在三个宿主模型中的变化方向是否一致：若方向一致，说明该响应对宿主模型结构不敏感；若方向相反，则取决于宿主对微食物环与碎屑通道的具体刻画。"]}
        tech="指标均为全水柱深度积分的分析期年均值；各处理分别减去同一宿主下的基准运行（Vijayakumaran 等 2026）。" />
    </div>
  );
}

function YearsPlate({ pid, runs }: { pid: string; runs: any[] }) {
  const dark = useApp((s) => s.dark);
  const vars = [["fish_c_tot", "F1_c"], ["Z4_c", "ECO_mesozoo", "ergom_zz"]];
  const data = useAsync(async () => Promise.all(vars.map(async (cands) => {
    const series = await Promise.all(runs.map(async (r) => {
      for (const v of cands) {
        const ts = await api.post(`/projects/${pid}/results/timeseries`, { run_ids: [r.id], var: v, mode: "integral" });
        const s = ts.series[0];
        if (s && !s.missing) {
          const by: Record<string, number[]> = {};
          s.time.forEach((t: string, i: number) => { if (s.values[i] != null) (by[t.slice(0, 4)] ??= []).push(s.values[i]); });
          const years = Object.keys(by).filter((y) => by[y].length > 300 || Object.keys(by).length <= 2);
          return { label: r.label, var: v, units: ts.units, years, means: years.map((y) => by[y].reduce((a, b) => a + b, 0) / by[y].length), start: r.timing?.analysis_start?.slice(0, 4) };
        }
      }
      return null;
    }));
    return series;
  })), [pid, runs.map((r) => r.id).join()]);
  if (data.loading || !data.data) return <Loading />;
  const titles = ["(a) 鱼类", "(b) 中型浮游动物（深度积分）"];
  const traces: any[] = [];
  const layout: any = { grid: { rows: 1, columns: 2, pattern: "independent" }, margin: { l: 60, r: 10, t: 36, b: 40 }, annotations: [], legend: { orientation: "h", y: -0.18 } };
  data.data.forEach((panel: any[], i: number) => {
    const xa = i ? "x2" : "x", ya = i ? "y2" : "y";
    layout.annotations.push({ text: `<b>${titles[i]}</b>`, xref: `${xa} domain`, yref: `${ya} domain`, x: 0, y: 1.04, xanchor: "left", yanchor: "bottom", showarrow: false });
    panel.forEach((s: any, k: number) => {
      if (!s) return;
      traces.push({ x: s.years, y: s.means, type: "scatter", mode: "lines+markers", name: s.label, legendgroup: s.label, showlegend: i === 0, xaxis: xa, yaxis: ya, line: { color: seriesColor(k, dark), width: 2 }, marker: { size: 5 } });
      layout[i ? "yaxis2" : "yaxis"] = { title: { text: s.units } };
    });
    const st = panel.find((s: any) => s?.start)?.start;
    if (st) {
      (layout.shapes ??= []).push({ type: "line", xref: xa, yref: `${ya} domain`, x0: st, x1: st, y0: 0, y1: 1, line: { dash: "dot", color: cssVar("--fg-soft") } });
      layout.annotations.push({ x: st, xref: xa, yref: `${ya} domain`, y: 1, yanchor: "top", xanchor: "left", text: " 分析期开始", showarrow: false, font: { size: 10.5, color: cssVar("--fg-muted") } });
    }
  });
  return (
    <div className="col" style={{ gap: 8 }}>
      <Plot height={380} data={traces} layout={layout} />
      <PlateNote read="横轴为模拟年份，纵轴为年均值；虚线左侧为预热期（spin-up），右侧为分析期。"
        show={["曲线趋于平缓表明模型接近周期稳态：在重复强迫年驱动下，年均值不再出现单调漂移。", "鱼类达到稳态所需时间远长于浮游生物：浮游生物在数周内即可调整，而鱼类需经历多个世代。", "若分析期内的曲线仍在持续上升或下降，说明结果仍受初始条件影响，应适当延长预热年数。"]}
        look={["观察单向与双向耦合的差距是在预热期内逐步拉开并趋于稳定，还是仍在持续扩大；前者表明两组配置的稳态差异可靠。"]}
        tech="也可在不同摄食/清滤率参数下重复此对比，以检验耦合效应对参数的敏感性（Powley 等 2026）。" />
    </div>
  );
}

function FluxDiffPlate({ pid, runs }: { pid: string; runs: any[] }) {
  const [a, b] = runs;
  const data = useAsync(async () => (a && b ? Promise.all([api.get(`/projects/${pid}/runs/${a.id}/foodweb`), api.get(`/projects/${pid}/runs/${b.id}/foodweb`)]) : null), [pid, a?.id, b?.id]);
  if (runs.length < 2) return <Empty icon="type-hierarchy" title="请勾选两次运行">第一个运行作为基准（如“仅 ERSEM”），第二个运行作为比较对象（如“ERSEM–MIZER 双向”）。</Empty>;
  if (data.loading || !data.data) return <Loading />;
  const [ga, gb] = data.data as any[];
  const delta: Record<string, number> = {};
  for (const [k, v] of Object.entries<any>(gb.state ?? {})) {
    const base = ga.state?.[k]?.value;
    if (base && isFinite(base) && base !== 0) delta[k] = ((v.value - base) / Math.abs(base)) * 100;
  }
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row"><b style={{ color: "var(--fg-strong)" }}>{b.label}</b><span className="soft">相对</span><b style={{ color: "var(--fg-strong)" }}>{a.label}</b></div>
      <FoodWebGraph graph={gb} state={gb.state} delta={delta} />
      <PlateNote read="每个节点代表一个碳库（无机营养盐、浮游植物、浮游动物、鱼类、碎屑等），按营养级自下而上排列；节点颜色与数值表示第二个运行相对于第一个运行的百分比变化（红色为增加，蓝色为减少）。基准运行中不含的类群不着色。"
        show={["相邻营养级呈红蓝交替分布，直观反映营养级联效应：捕食者减少使其猎物增加，再下一级被摄食者随之减少。", "越靠近食物链底端，相对变化幅度通常越小，表明高层扰动在向下传递过程中受到多条摄食通路及光照、营养盐限制的缓冲。"]}
        look={["对照各碳库增减方向的交替关系，识别下行控制主要沿哪条食物链分支传递（Powley 等 2026）。"]} />
    </div>
  );
}

function ScanPlate({ pid, runs, cfgOf }: { pid: string; runs: any[]; cfgOf: (r: any) => any }) {
  const dark = useApp((s) => s.dark);
  const pts = runs.map((r) => ({ r, v: cfgOf(r)?.scan_value })).filter((x) => x.v !== undefined);
  const data = useAsync(() => (pts.length >= 2 ? api.post(`/projects/${pid}/results/compare`, { run_ids: pts.map((x) => x.r.id) }) : Promise.resolve(null)), [pid, pts.map((x) => x.r.id).join()]);
  const [metric, setMetric] = useState("");
  useEffect(() => { if (data.data && !metric) setMetric((data.data as any).rows.find((r: any) => /zoo|fish|F1/.test(r.key))?.key ?? (data.data as any).rows[0]?.key); }, [data.data]);
  if (pts.length < 2) return <Empty icon="settings" title="请勾选同一参数扫描中的至少两次运行">在“实验与运行 → 参数扫描”中创建并完成扫描运行后，此处将绘制各指标随参数变化的响应曲线。</Empty>;
  if (data.loading || !data.data) return <Loading />;
  const t: any = data.data;
  const row = t.rows.find((r: any) => r.key === metric);
  const idx = pts.map((p, i) => ({ v: p.v as number, i })).sort((a, b) => a.v - b.v);
  const xs = idx.map((o) => o.v);
  const mid = idx[Math.floor((idx.length - 1) / 2)].i; // reference = middle of the sweep (usually the default)
  const pname = cfgOf(pts[0].r)?.description?.match(/：(.+?) =/)?.[1] ?? cfgOf(pts[0].r)?.name?.split(" =")[0] ?? "参数值";
  const relAll = t.rows.filter((r: any) => r.values[mid]).map((r: any) => ({ r, y: idx.map((o) => (r.values[o.i] == null ? null : ((r.values[o.i] - r.values[mid]) / Math.abs(r.values[mid])) * 100)) }));
  const span = (x: any) => { const v = x.y.filter((y: any) => y != null); return v.length ? Math.max(...v) - Math.min(...v) : 0; };
  // keep panel (b) readable: the six most responsive indicators plus the one picked in (a)
  const rel = relAll.slice().sort((a: any, b: any) => span(b) - span(a)).filter((x: any, k: number) => k < 6 || x.r.key === metric);
  // elasticity ≈ d ln(y) / d ln(p) between the sweep ends — a compact sensitivity ranking
  const lo = idx[0], hi = idx[idx.length - 1];
  const elast = t.rows.map((r: any) => {
    const a = r.values[lo.i], b = r.values[hi.i];
    return { r, e: a > 0 && b > 0 && lo.v > 0 ? Math.log(b / a) / Math.log(hi.v / lo.v) : null };
  }).filter((x: any) => x.e != null).sort((a: any, b: any) => Math.abs(b.e) - Math.abs(a.e));
  return (
    <div className="col" style={{ gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 14 }}>
        <div className="col" style={{ gap: 6 }}>
          <div className="row"><b className="small">(a)</b><Select size="sm" value={metric} onChange={setMetric}>{t.rows.map((r: any) => <option key={r.key} value={r.key}>{r.label.trim()}</option>)}</Select></div>
          <Plot height={380} data={[{ x: xs, y: idx.map((o) => row?.values[o.i]), type: "scatter", mode: "lines+markers", line: { color: seriesColor(0, dark), width: 2.2 }, marker: { size: 8 }, hovertemplate: `${pname} = %{x}<br>%{y:.4g} ${row?.units ?? ""}<extra></extra>` }]}
            layout={{ xaxis: { title: { text: pname } }, yaxis: { title: { text: `${row?.label.trim() ?? ""} (${row?.units ?? ""})` } }, margin: { t: 10, l: 64 } }} />
        </div>
        <div className="col" style={{ gap: 6 }}>
          <div className="row"><b className="small">(b)</b><span className="small soft">响应最大的 6 个指标相对扫描中点（{pname} = {fmt(pts[mid].v)}）的变化</span></div>
          <Plot height={380} data={rel.map((x: any, k: number) => ({ x: xs, y: x.y, type: "scatter", mode: "lines+markers", name: x.r.label.trim(), line: { color: seriesColor(k, dark), width: x.r.key === metric ? 3 : 1.6 }, marker: { size: 5 }, hovertemplate: `${x.r.label.trim()}<br>%{y:+.1f}%<extra></extra>` }))}
            layout={{ xaxis: { title: { text: pname } }, yaxis: { title: { text: "相对变化 (%)" }, zeroline: true }, margin: { t: 10, l: 56, b: 40 }, legend: { orientation: "h", y: -0.22, font: { size: 10.5 } } }} />
        </div>
      </div>
      <div className="section-header"><h3>敏感度排序（弹性系数 ∂ln 指标 / ∂ln 参数，取扫描两端）</h3></div>
      <div className="panel" style={{ overflow: "auto", maxHeight: 260 }}>
        <table className="table dense">
          <thead><tr><th>指标</th><th className="num">{pname} = {fmt(lo.v)}</th><th className="num">{pname} = {fmt(hi.v)}</th><th className="num">弹性</th><th style={{ width: "34%" }}></th></tr></thead>
          <tbody>{elast.map(({ r, e }: any) => (
            <tr key={r.key}><td style={{ whiteSpace: "nowrap" }}>{r.label.trim()}<span className="sub"> {r.units}</span></td>
              <td className="num">{fmt(r.values[lo.i])}</td><td className="num">{fmt(r.values[hi.i])}</td>
              <td className="num" style={{ fontWeight: 600, color: Math.abs(e) > 0.5 ? "var(--danger)" : Math.abs(e) > 0.1 ? "var(--warn)" : undefined }}>{e > 0 ? "+" : ""}{e.toFixed(3)}</td>
              <td><div style={{ position: "relative", height: 8, background: "var(--bg-sunk)", borderRadius: 2 }}><div style={{ position: "absolute", top: 0, bottom: 0, left: e >= 0 ? "50%" : `${50 - Math.min(1, Math.abs(e)) * 50}%`, width: `${Math.min(1, Math.abs(e)) * 50}%`, background: e >= 0 ? "var(--accent)" : "var(--danger)", borderRadius: 2 }} /></div></td></tr>
          ))}</tbody>
        </table>
      </div>
      <PlateNote read="(a) 横轴为参数取值，纵轴为所选指标；(b) 展示响应幅度最大的 6 个指标相对于扫描中点的百分比变化；下表按弹性系数绝对值排序。"
        show={["曲线斜率越陡，说明指标对该参数越敏感；弹性系数为 1 表示参数每增加 1%，指标约增加 1%（|弹性| > 0.5 以红色标出）。", "响应曲线呈非线性弯曲时，表明系统存在阈值或饱和效应（例如饵料受限时鱼类对摄食参数尤为敏感）。", "同一参数往往引起相邻营养级指标反向变化，体现了参数空间中的营养级联。"]}
        look={["弹性系数较大的参数（如捕捞死亡率 F、起捕体重 w_f 及清滤率参数 γ、q）对结果影响显著，应用到具体海区时应优先根据观测资料率定。"]} />
    </div>
  );
}
