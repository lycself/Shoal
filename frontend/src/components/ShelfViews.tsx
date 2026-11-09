// Shelf (3D) result views: paper-1-style map plates, regional table, 3D relief.
import { useMemo, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { MapCanvas } from "./MapCanvas";
import { colorscaleFor } from "./Plot";
import { Shelf3D } from "./Shelf3D";
import { Btn, Empty, Icon, IconBtn, Loading, Notice, Select, Seg, fmt, robustAbs, useAsync } from "./ui";
import { CellPanel } from "./CellPanel";
import { CascadeSummary, DEPTH_BANDS, FigureReading, changeOfMeans, configKind, pairKeyOf, referenceIndex } from "./ShelfExplain";

const METRIC_VAR: Record<string, string> = { phyto: "P1_c", zoo: "Z4_c", zoo_Z4_c: "Z4_c", zoo_Z5_c: "Z5_c", zoo_Z6_c: "Z6_c", chl: "P1_Chl", npp: "P1_c", F1_c: "F1_c", F2_c: "F2_c", MB_c: "MB_c", fish_ww: "fish_c_tot", landings: "fish_c_tot", co2: "O3_c", sst: "temp", sbt: "temp" };
const optLabel = (l: string) => (l.startsWith("  ") ? `　└ ${l.trim()}` : l);
const PCT_SET = ["phyto", "zoo_Z5_c", "zoo_Z6_c", "chl", "zoo_Z4_c", "co2", "npp", "fish_ww", "landings"];

function avg(v: number[]) { return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

export function ShelfPlates({ study, results, configs = [], boxes = [] }: { study: any; results: any[]; configs?: any[]; boxes?: any[] }) {
  const meta = results[0]?.meta ?? {};
  const keys = Object.keys(meta);
  const cfgOf = (r: any) => configs.find((c) => c.id === r?.config_id);
  const [kind, setKind] = useState<"triple" | "pct">("triple");
  const [ref0, ref1] = referenceIndex(results.map((r) => configKind(cfgOf(r))));
  // default to a metric both configurations on screen have (a fish-free baseline has no fish biomass), fish first
  const hasIn = (r: any, k: string) => (r?.points ?? []).some((p: any) => p.metrics?.[k] != null);
  const both = keys.filter((k) => hasIn(results[ref0], k) && hasIn(results[ref1], k));
  const [metric, setMetric] = useState(both.find((k) => /fish_ww|F1_c/.test(k)) ?? both.find((k) => /^zoo_Z4|^zoo$/.test(k)) ?? both[0] ?? keys[0]);
  const [pick, setPick] = useState<[number, number] | null>(null);
  const [ia, ib] = pick ?? [ref0, ref1];
  const A = results[ia], B = results[ib];
  const chg = useMemo(() => changeOfMeans(A, B), [A, B]);
  const pairKey = pairKeyOf(cfgOf(A), cfgOf(B));
  const labels = Object.fromEntries(Object.entries(meta).map(([k, m]: any) => [k, m.label]));
  const [cellSel, setCellSel] = useState<{ point: { lat: number; lon: number }; at: { clientX: number; clientY: number }; metric: string } | null>(null);
  const cellClick = (m: string) => (p: any, at: any) => setCellSel({ point: { lat: p.lat, lon: p.lon }, at, metric: m });
  if (results.length < 2) return <Empty icon="globe" title="需要两个配置的结果">在新建陆架研究时选择两个配置（例如单向与双向耦合），才能绘制差值图版。</Empty>;
  const byI = (r: any) => new Map(r.points.map((p: any) => [p.i, p]));
  const mb = byI(B);
  const pts = (r: any, m: string) => r.points.map((p: any) => ({ lat: p.lat, lon: p.lon, value: p.metrics?.[m] ?? null }));
  const diff = (m: string, pct: boolean) => A.points.map((p: any) => {
    const q: any = mb.get(p.i);
    const a = p.metrics?.[m], b = q?.metrics?.[m];
    const v = a == null || b == null ? null : pct ? (a ? ((b - a) / Math.abs(a)) * 100 : null) : b - a;
    return { lat: p.lat, lon: p.lon, value: v };
  });
  const vals = [...pts(A, metric), ...pts(B, metric)].map((p) => p.value).filter((x: any) => x != null) as number[];
  const shared: [number, number] = vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
  const sym = (arr: any[]): [number, number] => { const m = robustAbs(arr.map((p) => p.value)); return [-m, m]; };
  const box = study.box;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row wrap">
        <Seg size="sm" value={kind} onChange={setKind} options={[["triple", "两配置 + 差值"], ["pct", "多指标百分比变化"]]} />
        {kind === "triple" && <span className="opt">指标<Select size="sm" value={metric} onChange={setMetric}>{keys.map((k) => <option key={k} value={k}>{optLabel(meta[k].label)}</option>)}</Select></span>}
        <span className="opt">基准<Select size="sm" value={ia} onChange={(v) => setPick([+v, +v === ib ? ia : ib])}>{results.map((r, i) => <option key={i} value={i}>{r.config_name}</option>)}</Select></span>
        {/* the swap button stays with the picker it swaps, even when the toolbar wraps */}
        <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}><IconBtn icon="arrow-swap" size="sm" title="交换基准与比较" onClick={() => setPick([ib, ia])} />
        <span className="opt">比较<Select size="sm" value={ib} onChange={(v) => setPick([+v === ia ? ib : ia, +v])}>{results.map((r, i) => <option key={i} value={i}>{r.config_name}</option>)}</Select></span></span>
      </div>
      {kind === "triple" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 14 }}>
          <MapCanvas compact box={box} cell={study.res} points={pts(A, metric)} range={shared} varName={METRIC_VAR[metric] ?? ""} units={meta[metric]?.units} height={360} title={`(a) ${A.config_name}`} showBathyLegend={false} onPointClick={cellClick(metric)} selected={cellSel?.point} />
          <MapCanvas compact box={box} cell={study.res} points={pts(B, metric)} range={shared} varName={METRIC_VAR[metric] ?? ""} units={meta[metric]?.units} height={360} title={`(b) ${B.config_name}`} showBathyLegend={false} onPointClick={cellClick(metric)} selected={cellSel?.point} />
          <MapCanvas compact box={box} cell={study.res} points={diff(metric, false)} range={sym(diff(metric, false))} varName="x" diverging units={meta[metric]?.units} height={360} title="(c) 差值 (b) − (a)" showBathyLegend={false} onPointClick={cellClick(metric)} selected={cellSel?.point} />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 14 }}>
          {PCT_SET.filter((k) => meta[k]).map((k, i) => (
            <MapCanvas key={k} compact box={box} cell={study.res} points={diff(k, true)} range={[-40, 40]} varName="x" diverging units="%" height={300} title={`(${"abcdefghi"[i]}) ${meta[k].label.trim()}`} showBathyLegend={false} onPointClick={cellClick(k)} selected={cellSel?.point} />
          ))}
        </div>
      )}
      {cellSel && <CellPanel at={cellSel.at} point={cellSel.point} results={results} ci={ia} cj={ib} metric={cellSel.metric} boxes={boxes} onClose={() => setCellSel(null)} />}
      {kind === "triple" ? (
        <div className="reading-cols">
          <FigureReading metric={metric} label={meta[metric]?.label ?? metric} unit={meta[metric]?.units ?? ""} mode="diff"
            pairs={A.points.map((p: any) => ({ lat: p.lat, lon: p.lon, depth: p.depth, a: p.metrics?.[metric] ?? null, b: (mb.get(p.i) as any)?.metrics?.[metric] ?? null }))}
            nameA={A.config_name} nameB={B.config_name} descA={cfgOf(A)?.description} descB={cfgOf(B)?.description}
            pairKey={pairKey} boxes={boxes} chg={chg} res={study.res} years={study.years} />
          <p className="soft small" style={{ marginTop: 8 }}>(a)(b) 共用色标，可以直接比较深浅；(c) 是 (b) 减 (a)。</p>
        </div>
      ) : <CascadeSummary chg={chg} labels={labels} pairKey={pairKey} nameA={A.config_name} nameB={B.config_name} />}
    </div>
  );
}

export function ShelfRegions({ pid, sid, study, configs = [], results = [] }: { pid: string; sid: string; study: any; configs?: any[]; results?: any[] }) {
  const d = useAsync(() => api.get(`/projects/${pid}/shelf/${sid}/regions`), [pid, sid]);
  const boxes = useAsync(() => api.get<any[]>(`/shelf_regions`), []);
  const [metric, setMetric] = useState("fish_ww");
  const [hl, setHl] = useState<string | null>(null);
  if (d.loading || !d.data) return <Loading />;
  const raw: any = d.data;
  // reference configuration first, so the change column reads "comparison relative to reference"
  const kinds = raw.configs.map((c: any) => configKind(configs.find((x) => x.id === c.config_id)));
  const [r0, r1] = referenceIndex(kinds);
  const order = raw.configs.length > 1 ? [r0, r1, ...raw.configs.map((_: any, i: number) => i).filter((i: number) => i !== r0 && i !== r1)] : [0];
  const t: any = { ...raw, configs: order.map((i: number) => raw.configs[i]) };
  const keys = Object.keys(t.metrics);
  const m = keys.includes(metric) ? metric : keys[0];
  const regs = t.regions.filter((r: string) => t.configs.some((c: any) => c.table[r]));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(280px,340px)", gap: 18, alignItems: "start" }}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row"><span className="opt">指标<Select size="sm" value={m} onChange={setMetric}>{keys.map((k) => <option key={k} value={k}>{optLabel(t.metrics[k].label)}</option>)}</Select></span><span className="soft small">{t.metrics[m]?.units}</span></div>
        <div className="panel" style={{ overflow: "auto" }}>
          <table className="table dense">
            <thead><tr><th>区域</th><th className="num">水柱</th><th className="num" style={{ whiteSpace: "nowrap" }}>面积 10³ km²</th>{t.configs.map((c: any) => <th key={c.config_id} className="num" style={{ whiteSpace: "normal", minWidth: 80 }} title={c.config_name}>{c.config_name}</th>)}{t.configs.length > 1 && <th className="num">变化</th>}</tr></thead>
            <tbody>{regs.map((r: string) => {
              const vals = t.configs.map((c: any) => c.table[r]?.mean?.[m] ?? null);
              const ch = vals.length > 1 && vals[0] ? ((vals[vals.length - 1] - vals[0]) / Math.abs(vals[0])) * 100 : null;
              const info = t.configs[0].table[r];
              return (
                <tr key={r} style={r === "全部陆架" ? { fontWeight: 600 } : undefined} onMouseEnter={() => setHl(r)} onMouseLeave={() => setHl(null)} className={hl === r ? "selected" : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}>{r}</td><td className="num">{info?.n ?? "–"}</td><td className="num">{info ? fmt(info.area_km2 / 1000) : "–"}</td>
                  {vals.map((v: any, i: number) => <td key={i} className="num">{fmt(v)}</td>)}
                  {t.configs.length > 1 && <td className="num"><span className={`delta ${ch == null ? "zero" : ch > 0 ? "up" : "down"}`}>{ch == null ? "–" : `${ch > 0 ? "+" : ""}${ch.toFixed(1)}%`}</span></td>}
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <RegionReading t={t} m={m} regs={regs} />
        <div className="hint">{t.note}</div>
      </div>
      {t.scheme === "boxes"
        ? <MapCanvas box={study.box} cell={study.res} points={[]} outlines={(boxes.data ?? []).map((b: any) => ({ box: b.box, label: b.name }))} highlightBox={(boxes.data ?? []).find((b: any) => b.name === hl)?.box ?? null} height={460} title="区域划分（Powley 等 2026 所用区域的矩形近似）；悬停表格行可高亮区域" />
        : <MapCanvas box={study.box} cell={study.res} points={(results[0]?.points ?? []).filter((p: any) => !hl || hl === "全部陆架" || bandOf(p.depth) === hl).map((p: any) => ({ lat: p.lat, lon: p.lon, value: p.depth, label: `水深 ${p.depth} m · ${bandOf(p.depth)}` }))} range={[0, 200]} varName="O2_o" units="m" height={460} title="各水柱的水深（分区界线 30 / 60 / 100 / 200 m）" />}
    </div>
  );
}

const bandOf = (d: number) => DEPTH_BANDS.find(([, a, b]) => d >= a && d < b)?.[0] ?? "";

function RegionReading({ t, m, regs }: { t: any; m: string; regs: string[] }) {
  const named = regs.filter((r) => r !== "全部陆架");
  const val = (ci: number, r: string) => t.configs[ci]?.table[r]?.mean?.[m] ?? null;
  // describe the first configuration that actually has this metric (e.g. a baseline has no fish)
  const ci0 = Math.max(0, t.configs.findIndex((_: any, i: number) => named.some((r) => val(i, r) != null)));
  const c0 = named.map((r) => [r, val(ci0, r)] as [string, number | null]).filter((x) => x[1] != null).sort((a, b) => (b[1] as number) - (a[1] as number));
  const two = t.configs.length > 1 && ci0 === 0;
  const ch = two ? named.map((r) => { const a = val(0, r), b = val(t.configs.length - 1, r); return [r, a ? ((b - a) / Math.abs(a)) * 100 : null] as [string, number | null]; }).filter((x) => x[1] != null).sort((a, b) => (a[1] as number) - (b[1] as number)) : [];
  const u = t.metrics[m]?.units ?? "";
  if (c0.length < 2) return null;
  const allNeg = ch.length && ch.every((x) => (x[1] as number) < 0), allPos = ch.length && ch.every((x) => (x[1] as number) > 0);
  return (
    <div className="reading">
      <h4>这张表说明了什么</h4>
      <ul>
        {ci0 > 0 && <li>基准 <b>{t.configs[0].config_name}</b> 中没有这个类群，所以无法计算变化；下面描述 <b>{t.configs[ci0].config_name}</b> 的空间格局。</li>}
        <li>在 <b>{t.configs[ci0].config_name}</b> 中，{(t.metrics[m]?.label ?? m).trim()}最高的是 <b>{c0[0][0]}</b>（{fmt(c0[0][1])} {u}），最低的是 <b>{c0[c0.length - 1][0]}</b>（{fmt(c0[c0.length - 1][1])} {u}）。</li>
        {two && ch.length >= 2 && <li>换成 <b>{t.configs[t.configs.length - 1].config_name}</b> 后，{allNeg ? "所有区域都下降" : allPos ? "所有区域都上升" : "各区域有升有降"}；变化最大的是 <b>{(allPos ? ch[ch.length - 1] : ch[0])[0]}</b>（{(((allPos ? ch[ch.length - 1] : ch[0])[1]) as number).toFixed(0)}%），最小的是 <b>{(allPos ? ch[0] : ch[ch.length - 1])[0]}</b>（{(((allPos ? ch[0] : ch[ch.length - 1])[1]) as number).toFixed(0)}%）。</li>}
      </ul>
      <h4>为什么各区域不同</h4>
      {t.scheme === "boxes"
        ? <p>区域差异主要来自水深和层化：南部北海、英吉利海峡这类浅海常年被潮流混合，营养盐不断被带回表层；北部北海、凯尔特海等较深的海区夏季层化，表层营养盐被耗尽后生产受限。同一个耦合机制在不同区域的强弱，也取决于当地食物网中被鱼吃掉的那部分浮游生物所占的比例。</p>
        : <p>这里按水深分区，因为水深最能概括陆架海的物理状态：浅水区容易被潮流和风搅匀，营养盐不断回到表层；较深的中、外陆架季节性层化，表层营养盐被耗尽后生产受限。陆架坡折附近还可能有上升流或内波带来的额外营养盐（一维水柱无法表示）。</p>}
      <p className="soft">“水柱”列是该区域参与计算的格点数，格点少的区域统计不太稳定。</p>
    </div>
  );
}

export function Shelf3DView({ study, results, boxes = [], configs = [] }: { study: any; results: any[]; boxes?: any[]; configs?: any[] }) {
  const [r0, r1] = referenceIndex(results.map((r) => configKind(configs.find((c) => c.id === r.config_id))));
  const dark = useApp((s) => s.dark);
  const meta = results[0]?.meta ?? {};
  const keys = Object.keys(meta);
  const [metric, setMetric] = useState(keys.find((k) => /fish_ww|F1_c/.test(k)) ?? keys[0]);
  const [ci, setCi] = useState(0);
  const [cellSel, setCellSel] = useState<{ point: { lat: number; lon: number }; at: { clientX: number; clientY: number } } | null>(null);
  const depthOf = useMemo(() => new Map((study.points ?? []).map((p: any) => [p.i, p.depth])), [study]);
  const r = results[ci];
  const points = r.points.map((p: any) => ({ lat: p.lat, lon: p.lon, depth: p.depth ?? depthOf.get(p.i) ?? 50, value: p.metrics?.[metric] ?? null }));
  const vals = points.map((p: any) => p.value).filter((x: any) => x != null) as number[];
  const range: [number, number] = vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap">
        <span className="opt">指标<Select size="sm" value={metric} onChange={setMetric}>{keys.map((k) => <option key={k} value={k}>{optLabel(meta[k].label)}</option>)}</Select></span>
        <span className="opt">配置<Select size="sm" value={ci} onChange={(v) => setCi(+v)}>{results.map((x, i) => <option key={i} value={i}>{x.config_name}</option>)}</Select></span>

      </div>
      <Shelf3D box={study.box} points={points} cell={study.res} scale={colorscaleFor(METRIC_VAR[metric] ?? "", dark)} range={range} units={meta[metric]?.units} height={600}
        onPick={(p, at) => setCellSel({ point: { lat: p.lat, lon: p.lon }, at })} />
      {cellSel && <CellPanel at={cellSel.at} point={cellSel.point} results={results} ci={results.length > 1 ? r0 : ci} cj={results.length > 1 ? r1 : undefined} metric={metric} boxes={boxes} onClose={() => setCellSel(null)} />}
      <div className="reading-cols">
        <FigureReading metric={metric} label={meta[metric]?.label ?? metric} unit={meta[metric]?.units ?? ""} mode="value"
          pairs={points.map((p: any) => ({ lat: p.lat, lon: p.lon, depth: p.depth, a: p.value, other: r.points.find((q: any) => q.lat === p.lat && q.lon === p.lon)?.metrics }))}
          nameA={r.config_name} boxes={boxes} chg={{}} otherLabels={Object.fromEntries(Object.entries(meta).map(([k, m]: any) => [k, m.label]))} res={study.res} years={study.years}
          howto="每根柱体代表一根一维模拟水柱：柱高表示水深（经垂向夸大，放大倍数见左下角），颜色表示所选指标；周边海底地形来自 ETOPO 2022。左键拖动旋转、滚轮缩放、右键平移。结合地形与柱体颜色，可以直观对比指标在浅滩、陆架平原与深水海槽之间的分布差异。" />
      </div>
    </div>
  );
}
