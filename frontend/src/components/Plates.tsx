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
      "冬季整根水柱颜色上下一致：风和冷却使海水充分混合，温度从表到底几乎相同。",
      "春季表层先变暖，颜色开始上下分层，形成温跃层：暖而轻的表层水“盖”在冷而重的底层水上，两层之间几乎不交换。",
      "夏季表层最暖、底层仍冷；秋季风暴和降温使跃层逐渐下移直到消失，回到冬季的混合状态。常年被潮流搅动的浅水站点则全年基本不分层。",
      "盐度在一维模型中没有河流和平流，主要由向 WOA 气候态的松弛维持，因此变化很小。",
    ],
    look: ["各运行的物理场应完全相同：生物不反馈物理，强迫也一样。如果不同，说明运行设置（层数、时间、强迫）不一致，比较其他变量前要先排查。"],
  },
  nutrients: {
    show: [
      "冬季混合把底层富含营养盐的水带到表层，整根水柱营养盐都高。",
      "春季藻华在温跃层以上迅速把硝酸盐、磷酸盐和硅酸盐吃光（表层颜色变浅），而跃层以下的营养盐几乎不被利用。",
      "底层的营养盐在夏季缓慢增加：沉下来的有机物在那里被细菌分解，营养盐被“再矿化”，要等到秋冬混合才能回到表层。",
      "溶解氧在表层与大气交换，接近饱和；层化季节底层因分解耗氧而下降；陆架海夏季底层缺氧就是这样形成的。",
    ],
    look: ["高营养级运行的营养盐通常变化不大；若表层营养盐耗尽的时间或底层积累明显不同，说明下行控制已经影响到浮游植物的吸收或有机物的分解。"],
  },
  plankton: {
    show: [
      "春季硅藻最先爆发（春华）；表层硅酸盐耗尽后，不需要硅的鞭毛藻在夏季接替。",
      "浮游动物的峰值比浮游植物晚几周：捕食者跟着食物增长，这是捕食—被捕食关系在时间上的“滞后”。",
      "夏季浮游植物常集中在温跃层附近形成次表层最大值：上面有光但营养盐已耗尽，下面有营养盐但光太弱，跃层处两者兼得。",
    ],
    look: ["加入鱼的运行中，中型浮游动物的峰值通常更低（被鱼吃掉）；如果微型浮游动物反而更高，就是营养级联在时间—深度上的表现。"],
  },
  detritus: {
    show: [
      "碎屑（死亡的生物和粪便）在春华之后增加，并逐渐沉向底层；在层化季节，它们在跃层以下和海底附近积累。",
      "秋冬混合把碎屑重新搅散，同时它们被细菌分解成营养盐，为来年的春华“储备”养分。",
    ],
    look: ["有大型底栖动物的运行中，底层碎屑往往更少：底栖动物以沉降到海底的有机物为食。"],
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
      <PlateNote read="每条线是一个运行，纵轴是整根水柱的生物量（深度积分），横轴是一年中的月份，取分析时段的平均。"
        show={["浮游食性的鱼 1 跟着浮游动物的季节变化：春夏食物增加后开始增长。", "鱼 2（底栖与鱼食性）吃底栖动物和其他鱼，食物来源更稳定，季节变化较平缓。", "大型底栖动物依赖春华后沉降的有机物，响应比浮游生物晚。"]}
        look={["如果站点在北海，可以对照底拖网调查（IBTS）的季节规律：浮游食性鱼类在夏季开始增多（方法参考：Vijayakumaran 等 2026）。拖网的单位捕捞量只反映相对多少，不能直接和模型生物量比数值。"]} />
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
  if (runs.length < 2) return <Empty icon="graph" title="至少勾选两个运行">第一个运行是基准，例如“仅低营养级”；其余运行与它比较。</Empty>;
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
      <PlateNote read="每个面板是一个宿主模型；柱子是相对该宿主第一个勾选运行（建议“仅低营养级”）的差值，颜色区分处理：完整（鱼 + 底栖）、仅底栖、仅鱼类、只提高浮游动物死亡率。"
        show={["加入鱼后浮游动物通常减少：这是“下行控制”，捕食者压低了猎物。", "加入大型底栖动物后碎屑通常减少：底栖动物吃掉了沉到海底的有机物。", "“浮游动物死亡率 +20%”是只调低营养级闭合项的对照：如果它的效果和加入鱼相似，说明鱼的作用在这里主要相当于额外的浮游动物死亡。"]}
        look={["同一处理在三个宿主中方向是否一致：三个宿主方向一致，结论就比较可靠；不一致，说明结论取决于用了哪个宿主模型。这是判断结论是否稳健的关键。"]}
        tech="深度积分、分析时段年均；每个处理减去同一宿主的“仅低营养级”运行（方法参考：Vijayakumaran 等 2026）。" />
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
    if (st) (layout.shapes ??= []).push({ type: "line", xref: xa, yref: `${ya} domain`, x0: st, x1: st, y0: 0, y1: 1, line: { dash: "dot", color: cssVar("--fg-soft") } });
  });
  return (
    <div className="col" style={{ gap: 8 }}>
      <Plot height={380} data={traces} layout={layout} />
      <PlateNote read="横轴是模拟年份，纵轴是年平均值；虚线左边是预热期，右边才是用于分析的年份。"
        show={["曲线逐渐变平说明模型接近“周期稳态”：每年重复同样的强迫，结果不再逐年漂移。", "鱼类比浮游生物慢得多才稳定：浮游生物几周就能调整，鱼要经历多个世代。", "如果分析年份的曲线仍在明显上升或下降，结论可能受初始值影响，应增加预热年数。"]}
        look={["离线（单向）与双向耦合的差异是在预热中逐渐拉开、然后稳定，还是一直在变：前者说明差异是稳健的。"]}
        tech="同样的比较也可以在不同清滤参数下重复，看差异是否稳健（方法参考：Powley 等 2026）。" />
    </div>
  );
}

function FluxDiffPlate({ pid, runs }: { pid: string; runs: any[] }) {
  const [a, b] = runs;
  const data = useAsync(async () => (a && b ? Promise.all([api.get(`/projects/${pid}/runs/${a.id}/foodweb`), api.get(`/projects/${pid}/runs/${b.id}/foodweb`)]) : null), [pid, a?.id, b?.id]);
  if (runs.length < 2) return <Empty icon="type-hierarchy" title="勾选两个运行">第一个为基准（如“仅 ERSEM”），第二个为比较对象（如“ERSEM–MIZER 双向”）。</Empty>;
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
      <PlateNote read="每个节点是一个碳库（营养盐、浮游植物、浮游动物、鱼、碎屑……），按营养级从下到上排列；颜色和数字是第二个运行相对第一个运行的百分比变化，红色增加、蓝色减少。基准中不存在的类群（如鱼类）不着色。"
        show={["相邻营养级颜色一红一蓝交替，就是营养级联：某个捕食者变少，它的猎物变多，猎物的猎物又变少。", "越往食物链底部，变化通常越小：扰动在逐级传递中被其他过程（光、营养盐、其他捕食者）缓冲。"]}
        look={["看哪些碳库的变化方向一致、哪些相反：方向相反的相邻营养级就是级联（方法参考：Powley 等 2026）。"]} />
    </div>
  );
}

function ScanPlate({ pid, runs, cfgOf }: { pid: string; runs: any[]; cfgOf: (r: any) => any }) {
  const dark = useApp((s) => s.dark);
  const pts = runs.map((r) => ({ r, v: cfgOf(r)?.scan_value })).filter((x) => x.v !== undefined);
  const data = useAsync(() => (pts.length >= 2 ? api.post(`/projects/${pid}/results/compare`, { run_ids: pts.map((x) => x.r.id) }) : Promise.resolve(null)), [pid, pts.map((x) => x.r.id).join()]);
  const [metric, setMetric] = useState("");
  useEffect(() => { if (data.data && !metric) setMetric((data.data as any).rows.find((r: any) => /zoo|fish|F1/.test(r.key))?.key ?? (data.data as any).rows[0]?.key); }, [data.data]);
  if (pts.length < 2) return <Empty icon="settings" title="勾选同一参数扫描中的至少两个运行">在“实验与运行 → 参数扫描”中创建扫描并运行后，这里显示指标随参数的响应曲线。</Empty>;
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
      <PlateNote read="(a) 横轴是参数值，纵轴是所选指标；(b) 是响应最大的几个指标相对扫描中点的百分比变化；下表按弹性排序。"
        show={["曲线越陡，指标对这个参数越敏感；弹性 = 1 表示参数增加 1% 时指标增加约 1%，|弹性| 大于 0.5 标红。", "曲线弯曲（非线性）说明存在阈值或饱和，例如食物不足时鱼对捕食参数特别敏感。", "同一个参数往往让食物链上相邻的类群反向变化，这是营养级联在参数空间中的表现。"]}
        look={["弹性大的参数应优先用观测标定，例如捕捞参数（F、w_f）和清滤率（γ、q）。参数扫描把一系列短期试算自动化（方法参考：Powley 等 2026）。"]} />
    </div>
  );
}
