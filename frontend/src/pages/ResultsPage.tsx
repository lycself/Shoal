import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { FoodWebGraph } from "../components/FoodWebGraph";
import { sampleScale } from "../components/MapCanvas";
import { Plot, colorscaleFor, seriesColor } from "../components/Plot";
import { Btn, Check, Empty, Icon, IconBtn, Loading, Notice, Select, Seg, Split, Stat, Tabs, cssVar, extent, fmt, useAsync, PanelToggle } from "../components/ui";
import { HOST_LABEL, HTL_LABEL, useApp } from "../store";
import { PlatesTab } from "../components/Plates";
import { varName } from "../varnames";
import { annualEvents, eventLayer, extremeEvents, headroom, smoothDays, useSiteLat } from "../components/annotate";
import { ValidateTab } from "../components/Validate";
import { ColumnReading, CompareReading, FigAside, HovReading, ProfileReading, ReadingToggle, SeriesReading, SpectrumReading, WebReading, useReadingOpen } from "../components/ResultReading";

type Tab = "compare" | "plates" | "hov" | "column" | "series" | "profile" | "spectrum" | "web" | "validate";
const MONTH_AXIS = { tickvals: [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], ticktext: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"] };

export default function ResultsPage() {
  const { project, selectedRuns, setSelectedRuns, revision, dark } = useApp();
  const p = project!;
  const runs = useAsync(() => api.get<any[]>(`/projects/${p.id}/runs`), [p.id, revision]);
  const exps = useAsync(() => api.get<any[]>(`/projects/${p.id}/experiments`), [p.id, revision]);
  const done = (runs.data ?? []).filter((r) => r.status === "done");
  const sel = selectedRuns.filter((id) => done.some((r) => r.id === id));
  // a run picked for the user on arrival is provisional: the user's first tick replaces it, so it never
  // silently becomes the baseline of a comparison the user set up
  const provisional = useRef<string | null>(null);
  useEffect(() => { if (runs.data && !sel.length && done.length) { setSelectedRuns([done[0].id]); provisional.current = done[0].id; } }, [runs.data]);
  const selRuns = sel.map((id) => done.find((r) => r.id === id)!).filter(Boolean);
  const [tab, setTab] = useState<Tab>("compare");
  const [win, setWin] = useState<"analysis" | "all">("analysis");
  useEffect(() => {
    const h = (e: Event) => setTab((e as CustomEvent).detail as Tab);
    window.addEventListener("results-tab", h);
    return () => window.removeEventListener("results-tab", h);
  }, []);
  const [v, setV] = useState("");
  const vars = useAsync(() => (selRuns[0] ? api.get(`/projects/${p.id}/runs/${selRuns[0].id}/variables`) : Promise.resolve(null)), [p.id, selRuns[0]?.id]);
  const start = win === "analysis" ? selRuns.map((r) => r.timing?.analysis_start).sort().reverse()[0] : undefined;
  const hasMizer = selRuns.some((r) => r.spec?.htl?.kind === "mizer");
  const allVars: any[] = vars.data?.groups.flatMap((g: any) => g.vars) ?? [];
  const curVar = allVars.find((x) => x.name === v);
  useEffect(() => {
    if (!vars.data || curVar) return;
    const pref = ["Z4_c", "ECO_mesozoo", "ergom_zz", "P1_c", "temp"];
    setV(pref.find((x) => allVars.some((y) => y.name === x)) ?? allVars[0]?.name ?? "temp");
  }, [vars.data]);

  useEffect(() => {
    // depth-only views: fall back to a depth-resolved variable
    if ((tab === "hov" || tab === "profile") && curVar && !curVar.depth) {
      const pref = ["temp", "P1_c", "ECO_dia", "ergom_pp", "N3_n"];
      const d = pref.find((x) => allVars.some((y) => y.name === x && y.depth)) ?? allVars.find((y) => y.depth)?.name;
      if (d) setV(d);
    }
  }, [tab, curVar?.name]);

  if (runs.loading && !runs.data) return <Loading />;
  if (!done.length) return <div className="page"><Empty icon="graph-line" title="还没有完成的运行" action={<Btn icon="beaker" onClick={() => useApp.getState().setPage("experiments")}>去实验与运行</Btn>}>先在“实验与运行”页运行一组实验，结果会出现在这里。</Empty></div>;

  return (
    <div className="page fill">
      <Split id="results" label="运行与变量列表" initial={300} min={240} max={460} side={
        <SidePanel runs={done} exps={exps.data ?? []} sel={sel} provisional={provisional} setSel={setSelectedRuns} vars={vars.data} v={v} setV={setV} win={win} setWin={setWin} dark={dark} />
      }>
        <Tabs value={tab} onChange={setTab} left={<PanelToggle id="results" label="运行与变量列表" />} tabs={[
          { id: "compare", label: "指标对比", icon: "table", tip: "各运行的年平均指标，以及相对第一个勾选运行的变化" },
          { id: "plates", label: "图版", icon: "files", tip: "排好版、可直接放进报告的多面板图" },
          { id: "hov", label: "时间–深度", icon: "symbol-color", tip: "横轴时间、纵轴深度、颜色表示浓度的图，一眼看出季节和分层" },
          { id: "column", label: "水柱动画", icon: "play-circle", tip: "像放电影一样看一年里水柱从上到下的变化" },
          { id: "series", label: "时间序列", icon: "graph-line", tip: "某个量随时间的变化，可以看年循环" },
          { id: "profile", label: "垂向剖面", icon: "arrow-down", tip: "选几个月份，看从海面到海底的分布" },
          { id: "spectrum", label: "粒径谱", icon: "graph-scatter", tip: "按鱼的个体大小看生物量分布（MIZER）", hidden: !hasMizer },
          { id: "web", label: "食物网状态", icon: "type-hierarchy", tip: "谁吃谁，以及各类群的多少" },
          { id: "validate", label: "验证与稳态", icon: "verified", tip: "预热够不够、与观测气候平均值比得怎么样" },
        ]} />
        {!selRuns.length ? <Empty icon="checklist" title="在左侧勾选至少一个运行" /> : (
          <div className="split-main" style={{ minHeight: 0 }}>
            {tab === "compare" && <CompareTab pid={p.id} runs={selRuns} />}
            {tab === "plates" && <PlatesTab pid={p.id} runs={selRuns} start={start} />}
            {tab === "validate" && <ValidateTab pid={p.id} run={selRuns[0]} />}
            {tab === "hov" && <HovTab pid={p.id} runs={selRuns} v={v} curVar={curVar} start={start} />}
            {tab === "column" && <ColumnTab pid={p.id} run={selRuns[0]} allVars={allVars} start={start} />}
            {tab === "series" && <SeriesTab pid={p.id} runs={selRuns} v={v} curVar={curVar} start={start} />}
            {tab === "profile" && <ProfileTab pid={p.id} runs={selRuns} v={v} curVar={curVar} start={start} />}
            {tab === "spectrum" && <SpectrumTab pid={p.id} runs={selRuns.filter((r) => r.spec?.htl?.kind === "mizer")} />}
            {tab === "web" && <WebTab pid={p.id} runs={selRuns} />}
          </div>
        )}
      </Split>
    </div>
  );
}

// ---------------------------------------------------------------- side panel
function SidePanel({ runs, exps, sel, provisional, setSel, vars, v, setV, win, setWin, dark }: any) {
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const out: { id: string; name: string; runs: any[] }[] = [];
    const used = new Set<string>();
    for (const e of exps) {
      const rs = runs.filter((r: any) => r.experiment_id === e.id);
      if (rs.length) { out.push({ id: e.id, name: e.name, runs: rs }); rs.forEach((r: any) => used.add(r.id)); }
    }
    const rest = runs.filter((r: any) => !used.has(r.id));
    if (rest.length) out.push({ id: "_rest", name: "其他运行", runs: rest });
    return out;
  }, [runs, exps]);
  const toggle = (id: string) => {
    const auto = provisional.current;
    provisional.current = null;
    if (auto && sel.length === 1 && sel[0] === auto && id !== auto) return setSel([id]);
    setSel(sel.includes(id) ? sel.filter((x: string) => x !== id) : [...sel, id]);
  };
  const baseRun = sel.length > 1 ? runs.find((r: any) => r.id === sel[0]) : null;
  return (
    <>
      <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid var(--border)" }}>
        <Seg value={win} onChange={setWin} size="sm" options={[["analysis", "分析时段"], ["all", "全部年份"]]} />
      </div>
      <div style={{ flex: "1 1 50%", minHeight: 120, display: "flex", flexDirection: "column", borderBottom: "1px solid var(--border)" }}>
        <div className="tree-head">运行<span className="actions"><span className="soft" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>已选 {sel.length}</span>{sel.length > 0 && <IconBtn icon="clear-all" title="清空选择" size="sm" onClick={() => setSel([])} />}</span></div>
        {baseRun && <div className="small" style={{ padding: "2px 12px 6px", color: "var(--fg-muted)" }}>基准：<b style={{ color: "var(--fg-strong)" }}>{baseRun.label}</b><span className="soft">（第一个勾选的运行，其余与它比较）</span></div>}
        <div className="split-scroll">
          {groups.map((g) => (
            <div key={g.id}>
              <div className="tree-group" data-tip={closed[g.id] ? "展开这一组" : "收起这一组"} onClick={() => setClosed({ ...closed, [g.id]: !closed[g.id] })}><Icon name={closed[g.id] ? "chevron-right" : "chevron-down"} /><span className="ellipsis">{g.name}</span></div>
              {!closed[g.id] && g.runs.map((r: any) => {
                const i = sel.indexOf(r.id);
                return (
                  <div key={r.id} className={`tree-item ${i >= 0 ? "active" : ""}`} style={{ paddingLeft: 16 }} onClick={() => toggle(r.id)} title={`${r.id}\n${HOST_LABEL[r.spec?.host]} · ${HTL_LABEL[r.spec?.htl?.kind]}`}>
                    <Check checked={i >= 0} onChange={() => toggle(r.id)} />
                    {i >= 0 ? <span className="swatch round" style={{ background: seriesColor(i, dark) }} /> : <span className="swatch round" style={{ background: "var(--border)" }} />}
                    <div className="grow"><div className="ellipsis">{r.label}</div><div className="meta">{(r.created || "").slice(5, 16).replace("T", " ")}{i === 0 && sel.length > 1 ? " · 基准" : ""}</div></div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: "1 1 50%", minHeight: 120, display: "flex", flexDirection: "column" }}>
        <div className="tree-head">变量</div>
        <div style={{ padding: "0 10px 6px" }}><div className="search"><Icon name="search" /><input placeholder="搜索变量（名称或含义）" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        <div className="split-scroll">
          {!vars ? <Loading /> : vars.groups.map((g: any) => {
            const vs = g.vars.filter((x: any) => !q || (x.name + x.long_name).toLowerCase().includes(q.toLowerCase()));
            if (!vs.length) return null;
            const key = "v_" + g.id;
            const shut = q ? false : closed[key] ?? !["physics", "fish", "zoo", "phyto"].includes(g.id);
            return (
              <div key={g.id}>
                <div className="tree-group" data-tip={shut ? "展开这一组" : "收起这一组"} onClick={() => setClosed({ ...closed, [key]: !shut })}><Icon name={shut ? "chevron-right" : "chevron-down"} />{g.label}<span className="soft" style={{ marginLeft: "auto", fontWeight: 500 }}>{vs.length}</span></div>
                {!shut && vs.map((x: any) => (
                  <div key={x.name} className={`tree-item ${x.name === v ? "active" : ""}`} onClick={() => setV(x.name)} title={`${x.long_name}${x.units ? ` (${x.units})` : ""}`}>
                    <Icon name={x.depth ? "symbol-array" : "symbol-number"} />
                    <div className="grow"><div className="ellipsis">{varName(x.name) ?? x.long_name}</div><div className="meta ellipsis mono">{x.name}{varName(x.name) ? ` · ${x.long_name}` : ""}</div></div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function VarTitle({ curVar }: { curVar?: any }) {
  if (!curVar) return null;
  const zh = varName(curVar.name);
  return <span className="row" style={{ gap: 6 }} title={curVar.long_name}><b style={{ color: "var(--fg-strong)" }}>{zh ?? curVar.long_name}</b><span className="soft ellipsis"><span className="mono">{curVar.name}</span>{curVar.units ? ` · ${curVar.units}` : ""}</span></span>;
}

export function downloadCsv(name: string, rows: any[][]) {
  const csv = "\ufeff" + rows.map((r) => r.map((c) => (c == null ? "" : /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ------------------------------------------------------------------ compare
const KPI_KEYS = ["phyto", "zoo", "zoo_Z4_c", "F1_c", "fish_ww", "MB_c", "npp", "co2"];
function CompareTab({ pid, runs }: { pid: string; runs: any[] }) {
  const dark = useApp((s) => s.dark);
  const d = useAsync(() => api.post(`/projects/${pid}/results/compare`, { run_ids: runs.map((r) => r.id) }), [pid, runs.map((r) => r.id).join()]);
  if (d.loading) return <Loading text="计算分析时段内的年均指标…" />;
  if (d.error) return <div style={{ padding: 16 }}><Notice kind="danger">{d.error}</Notice></div>;
  const t: any = d.data;
  const last0 = runs.length - 1;
  const kpis = KPI_KEYS.map((k) => t.rows.find((r: any) => r.key === k)).filter((r: any) => r && r.values[last0] !== null).slice(0, 6);
  const pctRows = t.rows.filter((r: any) => !r.label.startsWith("  ") && r.pct.slice(1).some((x: any) => x !== null) && !["sst", "sbt"].includes(r.key));
  const last = runs.length - 1;
  return (
    <div className="split-scroll" style={{ padding: "16px 18px" }}>
      <div className="section">
        <div className="section-header"><Icon name="dashboard" /><h3>{runs.length > 1 ? `“${t.labels[last]}” 相对 “${t.labels[0]}”` : t.labels[0]}</h3><span className="soft small">分析时段年均值</span></div>
        <div className="stats">
          {kpis.map((r: any) => <Stat key={r.key} k={r.label.trim()} v={fmt(r.values[last])} unit={r.units} delta={runs.length > 1 ? r.pct[last] : undefined} />)}
        </div>
      </div>
      {runs.length > 1 && pctRows.length > 0 && (
        <div className="section">
          <div className="section-header"><Icon name="graph" /><h3>相对基准的百分比变化</h3></div>
          <Plot height={Math.max(240, pctRows.length * 30 + 70)} data={t.labels.slice(1).map((l: string, k: number) => ({
            type: "bar", orientation: "h", name: l, y: pctRows.map((r: any) => r.label.trim()), x: pctRows.map((r: any) => r.pct[k + 1]),
            marker: { color: seriesColor(k + 1, dark) }, hovertemplate: "%{y}: %{x:+.1f}%<extra>" + l + "</extra>",
            texttemplate: "%{x:+.1f}%", textposition: "outside", cliponaxis: false, textfont: { size: 11, color: cssVar("--fg-muted") },
          }))} layout={{ barmode: "group", xaxis: { title: { text: `相对“${t.labels[0]}”的变化 (%)` }, zeroline: true, zerolinewidth: 1.5 }, yaxis: { autorange: "reversed" }, margin: { l: 200, t: 34 }, legend: { orientation: "h", y: 1.02, yanchor: "bottom", x: 0 } }} />
        </div>
      )}
      <div className="section"><CompareReading t={t} runs={runs} /></div>
      <div className="section">
        <div className="section-header"><Icon name="table" /><h3>指标表</h3><div className="section-actions"><Btn size="sm" icon="export" onClick={() => downloadCsv("指标对比.csv", [["指标", "单位", ...t.labels], ...t.rows.map((r: any) => [r.label.trim(), r.units, ...r.values])])}>导出 CSV</Btn></div></div>
        <div className="panel" style={{ overflow: "auto" }}>
          <table className="table">
            <thead><tr><th>指标</th><th>单位</th>{t.labels.map((l: string, i: number) => <th key={i} className="num"><span className="row" style={{ justifyContent: "flex-end", gap: 6 }}><span className="swatch round" style={{ background: seriesColor(i, dark) }} />{l}</span></th>)}</tr></thead>
            <tbody>{t.rows.map((r: any) => (
              <tr key={r.key}>
                <td style={{ paddingLeft: r.label.startsWith("  ") ? 30 : 12, color: r.label.startsWith("  ") ? "var(--fg-muted)" : undefined }}>{r.label.trim()}</td>
                <td className="soft small">{r.units}</td>
                {r.values.map((v: any, i: number) => <td key={i} className="num">{fmt(v)}{i > 0 && r.pct[i] !== null && <span className={`delta ${r.pct[i] > 0 ? "up" : r.pct[i] < 0 ? "down" : "zero"}`}>{r.pct[i] > 0 ? "+" : ""}{r.pct[i]}%</span>}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- hov
function HovTab({ pid, runs, v, curVar, start }: { pid: string; runs: any[]; v: string; curVar: any; start?: string }) {
  const dark = useApp((s) => s.dark);
  const [diff, setDiff] = useState(false);
  const [mld, setMld] = useState(true);
  const [contour, setContour] = useState(false);
  const [open, toggle] = useReadingOpen();
  const [probe, setProbe] = useState<{ t: string; z: number; at: { clientX: number; clientY: number } } | null>(null);
  const isDepth = curVar?.depth;
  const data = useAsync(async () => {
    if (!v || !isDepth) return null;
    const q = start ? `&start=${start}` : "";
    const panels = diff && runs.length >= 2
      ? await Promise.all(runs.slice(1).map((r) => api.post(`/projects/${pid}/results/difference`, { a: runs[0].id, b: r.id, var: v, start }).then((d) => ({ ...d, label: `${r.label} − ${runs[0].label}` }))))
      : await Promise.all(runs.map((r) => api.get(`/projects/${pid}/runs/${r.id}/hovmoller?var=${encodeURIComponent(v)}${q}`).then((d) => ({ ...d, label: r.label }))));
    const m = mld ? await api.post(`/projects/${pid}/results/timeseries`, { run_ids: (diff ? runs.slice(1) : runs).map((r) => r.id), var: "mld_surf", mode: "integral", start }).catch(() => null) : null;
    return { panels, mld: m?.series ?? [] };
  }, [pid, v, runs.map((r) => r.id).join(), start, diff, mld, isDepth]);
  const fig = useMemo(() => {
    if (!data.data) return null;
    const ps = data.data.panels as any[];
    const all = ps.flatMap((d) => d.values.flat()).filter((x: any) => x !== null) as number[];
    let [zmin, zmax] = extent(all);
    if (diff) { const m = Math.max(Math.abs(zmin), Math.abs(zmax)); zmin = -m; zmax = m; }
    const n = ps.length, gap = 0.06, h = (1 - gap * (n - 1)) / n;
    const traces: any[] = [];
    const layout: any = { margin: { l: 64, r: 16, t: 26, b: 40 }, annotations: [], showlegend: false };
    ps.forEach((d, i) => {
      const ya = i ? `y${i + 1}` : "y";
      traces.push({ type: contour ? "contour" : "heatmap", x: d.time, y: d.depth, z: d.values, xaxis: "x", yaxis: ya, colorscale: colorscaleFor(v, dark, diff), zmin, zmax, zmid: diff ? 0 : undefined,
        showscale: i === 0, colorbar: { title: { text: d.units, side: "right" }, thickness: 12, len: Math.min(1, 0.95), y: 0.5 }, zsmooth: contour ? undefined : "best",
        contours: contour ? { coloring: "heatmap", showlines: true } : undefined, line: contour ? { width: 0.4, color: "rgba(0,0,0,.25)" } : undefined,
        hovertemplate: `%{x}<br>%{y:.1f} m<br>%{z:.4g} ${d.units}<extra>${d.label}</extra>` });
      let maxNote = "";
      const ms = data.data!.mld[i];
      if (ms && !ms.missing) {
        // hourly mixed-layer depth flickers with every gust; a 7-day running mean shows the seasonal shape
        const sm = smoothDays(ms.time, ms.values, 7);
        traces.push({ type: "scatter", mode: "lines", x: ms.time, y: sm, xaxis: "x", yaxis: ya, line: { color: dark ? "#ffffff" : "#111111", width: 1.4, dash: "dot" }, hovertemplate: "混合层深度（7 天平均）%{y:.1f} m<extra></extra>" });
      }
      // the strongest cell of the panel: where and when the variable peaks (or changes most, for differences)
      let best = { v: -Infinity, j: 0, k: 0 };
      d.values.forEach((row: (number | null)[], k: number) => row.forEach((x, j) => { if (x !== null && (diff ? Math.abs(x) : x) > best.v) best = { v: diff ? Math.abs(x) : x, j, k }; }));
      if (isFinite(best.v)) {
        const val = d.values[best.k][best.j];
        // on a heatmap any label box hides colour, so the point gets a ring and the words go into the panel title
        traces.push({ type: "scatter", mode: "markers", x: [d.time[best.j]], y: [d.depth[best.k]], xaxis: "x", yaxis: ya, hoverinfo: "skip", showlegend: false,
          marker: { size: 13, color: "rgba(0,0,0,0)", line: { width: 2, color: dark ? "#ffffff" : "#111111" } } });
        maxNote = `　<span style="color:${cssVar("--fg-muted")}">○ ${diff ? (val >= 0 ? "增加最多" : "减少最多") : "最大值"}：${String(d.time[best.j]).slice(0, 10)} · ${d.depth[best.k].toFixed(0)} m · ${fmt(val, 3)} ${d.units ?? ""}</span>`;
      }
      const y0 = 1 - (i + 1) * h - i * gap, y1 = y0 + h;
      // all panels share one depth range, so runs on different grids line up and labels stay inside their panel
      layout[i ? `yaxis${i + 1}` : "yaxis"] = { domain: [y0, y1], title: { text: "深度 (m)" }, range: [Math.max(...ps.map((q: any) => Math.max(...q.depth))), 0] };
      layout.annotations.push({ text: `<b>${d.label}</b>${maxNote}`, xref: "paper", yref: "paper", x: 0, y: y1 + 0.005, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 12 } });
    });
    layout.xaxis = { anchor: n > 1 ? `y${n}` : "y" };
    if (probe) layout.shapes = [{ type: "line", xref: "x", yref: "paper", x0: probe.t, x1: probe.t, y0: 0, y1: 1, line: { color: dark ? "#fff" : "#111", width: 1, dash: "dash" } }];
    return { traces, layout };
  }, [data.data, dark, diff, contour, v, probe]);
  return (
    <>
      <div className="optbar">
        <VarTitle curVar={curVar} />
        <span className="grow" />
        <Check checked={mld} onChange={setMld}>叠加混合层深度</Check>
        <Check checked={contour} onChange={setContour}>等值线</Check>
        {runs.length >= 2 && <Check checked={diff} onChange={setDiff}>与基准的差值</Check>}
        <ReadingToggle open={open} toggle={toggle} />
      </div>
      {!isDepth ? <Empty icon="symbol-array" title="请在左侧选择一个随深度变化的变量">时间–深度图（Hovmöller 图）需要三维（时间 × 深度）变量，例如温度、营养盐、浮游生物。</Empty>
        : data.loading ? <Loading text="读取输出…" /> : data.error ? <div style={{ padding: 16 }}><Notice kind="danger">{data.error}</Notice></div>
        : fig && <FigAside open={open} toggle={toggle} figure={<>
            <Plot fill data={fig.traces} layout={fig.layout} onClick={(ev: any) => { const pt = ev.points?.[0]; if (pt) setProbe({ t: String(pt.x), z: +pt.y, at: { clientX: ev.event?.clientX ?? 400, clientY: ev.event?.clientY ?? 300 } }); }} />
            <div className="soft small" style={{ padding: "2px 10px" }}>点击图中任一点：查看该时刻的垂向剖面和该深度的时间序列</div>
            {probe && <HovProbe probe={probe} panels={data.data!.panels as any[]} onClose={() => setProbe(null)} />}
          </>}
          reading={<HovReading panels={data.data!.panels as any[]} mld={data.data!.mld} v={v} label={varName(v) ?? (curVar?.long_name || v)} diff={diff} />} />}
    </>
  );
}

/** Popup for a clicked time–depth point: the profile at that time and the series at that depth, for every panel. */
function HovProbe({ probe, panels, onClose }: { probe: { t: string; z: number; at: { clientX: number; clientY: number } }; panels: any[]; onClose: () => void }) {
  const dark = useApp((s) => s.dark);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  const p0 = panels[0];
  const j = Math.max(0, p0.time.findIndex((x: string) => x >= probe.t.slice(0, 10)));
  const k = p0.depth.reduce((b: number, d: number, i: number) => (Math.abs(d - probe.z) < Math.abs(p0.depth[b] - probe.z) ? i : b), 0);
  const u = p0.units ?? "";
  const W = 420, left = Math.min(probe.at.clientX + 18, window.innerWidth - W - 12), top = Math.max(56, Math.min(probe.at.clientY - 80, window.innerHeight - 520));
  const val = p0.values[k]?.[j];
  return (
    <div className="cell-panel" style={{ left, top, width: W, maxHeight: window.innerHeight - top - 12 }} role="dialog" aria-label="剖面与时间序列">
      <div className="row"><b style={{ color: "var(--fg-strong)" }}>{p0.time[j]} · {p0.depth[k].toFixed(1)} m</b><span className="soft small">{fmt(val)} {u}</span><span className="grow" /><IconBtn icon="close" size="sm" title="关闭（Esc）" onClick={onClose} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "150px minmax(0,1fr)", gap: 8, marginTop: 6 }}>
        <Plot height={230} data={panels.map((p, i) => ({ x: p.values.map((row: any[]) => row[j]), y: p.depth, type: "scatter", mode: "lines", name: p.label, line: { color: seriesColor(i, dark), width: 1.8 } }))}
          layout={{ margin: { l: 34, r: 4, t: 18, b: 28 }, showlegend: false, title: { text: "该时刻剖面", font: { size: 11 } }, xaxis: { type: "linear" }, yaxis: { autorange: "reversed", type: "linear" }, shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: p0.depth[k], y1: p0.depth[k], line: { dash: "dot", width: 1, color: "#888" } }] }} />
        <Plot height={230} data={panels.map((p, i) => ({ x: p.time, y: p.values[k], type: "scatter", mode: "lines", name: p.label, line: { color: seriesColor(i, dark), width: 1.4 } }))}
          layout={{ margin: { l: 40, r: 6, t: 18, b: 28 }, showlegend: panels.length > 1, legend: { orientation: "h", y: -0.25, font: { size: 10 } }, title: { text: `${p0.depth[k].toFixed(0)} m 处的时间序列`, font: { size: 11 } }, xaxis: { type: "date" }, yaxis: { type: "linear" }, shapes: [{ type: "line", yref: "paper", x0: p0.time[j], x1: p0.time[j], y0: 0, y1: 1, line: { dash: "dot", width: 1, color: "#888" } }] }} />
      </div>
      <div className="soft small" style={{ marginTop: 4 }}>剖面里虚线是所选深度；时间序列里虚线是所选时刻。</div>
    </div>
  );
}

// ------------------------------------------------------------------ column
const FISH_PATH = "M0 0c4-4 10-5 15-2l4-3v10l-4-3c-5 3-11 2-15-2z";
function ColumnTab({ pid, run, allVars, start }: { pid: string; run: any; allVars: any[]; start?: string }) {
  const dark = useApp((s) => s.dark);
  const pick = (prefs: string[]) => prefs.find((x) => allVars.some((y) => y.name === x && y.depth)) ?? null;
  const keys = useMemo(() => allVars.length ? {
    temp: "temp", nut: pick(["N3_n", "ECO_no3", "ergom_nn"]), phyto: pick(["P1_c", "ECO_dia", "ergom_pp"]),
    phyto2: pick(["P2_c", "ECO_fla", "ergom_ff"]), zoo: pick(["Z4_c", "ECO_mesozoo", "ergom_zz"]), det: pick(["R6_c", "ECO_det", "ergom_dd"]),
  } : null, [allVars]);
  const fishVar = ["F1_c", "fish_c_tot"].find((x) => allVars.some((y) => y.name === x));
  const data = useAsync(async () => {
    if (!keys) return null;
    const q = start ? `&start=${start}` : "";
    const ent = await Promise.all(Object.entries(keys).filter(([, v]) => v).map(async ([k, v]) => [k, await api.get(`/projects/${pid}/runs/${run.id}/hovmoller?var=${v}${q}`)] as const));
    const fish = fishVar ? await api.post(`/projects/${pid}/results/timeseries`, { run_ids: [run.id], var: fishVar, mode: "integral", start }).catch(() => null) : null;
    const mld = await api.post(`/projects/${pid}/results/timeseries`, { run_ids: [run.id], var: "mld_surf", mode: "integral", start }).catch(() => null);
    return { ...Object.fromEntries(ent), fish, mld } as any;
  }, [pid, run.id, keys, start]);
  const [t, setT] = useState(180);
  const [play, setPlay] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const n = data.data?.temp?.time?.length ?? 0;
  useEffect(() => {
    if (!play) return;
    timer.current = window.setInterval(() => setT((x) => (x + 1) % Math.max(1, n)), 70);
    return () => clearInterval(timer.current);
  }, [play, n]);
  if (data.loading || !data.data) return <Loading text="读取输出…" />;
  const d = data.data;
  const ti = Math.min(t, n - 1);
  const depth: number[] = d.temp.depth;
  const H = Math.max(...depth);
  const col = (k: string) => d[k] ? d[k].values.map((row: any[]) => row[ti]) : [];
  const maxOf = (k: string) => d[k] ? extent(d[k].values.flat().filter((x: any) => x !== null))[1] : 1;
  const rel = (k: string) => col(k).map((x: number) => x / (maxOf(k) || 1));
  const temps = col("temp");
  const tAll = d.temp.values.flat().filter((x: any) => x !== null);
  const [tmin, tmax] = extent(tAll);
  const mldNow = d.mld?.series?.[0]?.values?.[ti];
  const fishS = d.fish?.series?.[0];
  const zooRel = keys!.zoo ? rel("zoo") : [];
  const SVG_H = 520, top = 30, bot = 34, rulerX = 50, colX = 62, colW = 104, COL_W = 380;
  const yOf = (z: number) => top + (z / H) * (SVG_H - top - bot);
  // fish drawn at depths of high food (zooplankton), size ∝ local share
  const fishMarks = zooRel.map((w: number, i: number) => ({ w, z: depth[i] })).filter((f: any, i: number) => i % Math.max(1, Math.round(depth.length / 14)) === 0 && f.w > 0.25);
  // features of today's column, each read straight off the profiles drawn beside it
  const callouts: Callout[] = [];
  if (mldNow !== undefined && mldNow !== null) callouts.push({ z: Math.min(H, mldNow), title: "混合层底", sub: "风和对流把海水搅匀到这里", value: `${mldNow.toFixed(0)} m` });
  let gMax = 0, gZ = 0;
  for (let i = 1; i < depth.length; i++) {
    const g = (temps[i - 1] - temps[i]) / Math.max(1e-6, depth[i] - depth[i - 1]);
    if (g > gMax) { gMax = g; gZ = (depth[i - 1] + depth[i]) / 2; }
  }
  if (gMax > 0.05) callouts.push({ z: gZ, title: "温跃层", sub: "温度下降最快，上下层很难交换", value: `${gZ.toFixed(0)} m · ${gMax.toFixed(2)} °C/m` });
  // all phytoplankton groups drawn here (P1 + P2, or the host's equivalents), so the label can say 浮游植物
  const p1 = keys!.phyto ? col("phyto") : [], p2 = keys!.phyto2 ? col("phyto2") : [];
  const ph = p1.map((x: number | null, i: number) => (x ?? 0) + (p2[i] ?? 0));
  const phMax = Math.max(0, ...ph);
  if (phMax > 0) {
    const k = ph.indexOf(phMax), zk = depth[k];
    const fin = ph.filter((x: number) => x > 0), uniform = (Math.max(...fin) - Math.min(...fin)) / phMax < 0.1;
    const below = mldNow !== undefined && mldNow !== null && zk > mldNow + 1;
    // a subsurface maximum grows in place under the mixed layer (light from above, nutrients from below)
    const sub = uniform ? "混合层内分布均匀，没有明显的峰" : below ? "表层营养盐已耗尽，藻类在跃层附近就地生长（上有光、下有营养盐）" : "在混合层里：光和营养盐都够";
    callouts.push({ z: zk, title: uniform ? "浮游植物（均匀）" : "浮游植物最多处", sub, value: uniform ? "全柱接近" : `${zk.toFixed(0)} m`, color: cssVar("--eco-phyto") });
  }
  const series = [
    { k: "nut", name: `营养盐 ${keys!.nut}`, c: "--eco-nut", w: 1.6, dash: "solid" },
    { k: "phyto", name: `浮游植物 ${keys!.phyto}`, c: "--eco-phyto", w: 2.6, dash: "solid" },
    { k: "phyto2", name: `浮游植物 ${keys!.phyto2}`, c: "--eco-phyto", w: 1.4, dash: "dash" },
    { k: "zoo", name: `浮游动物 ${keys!.zoo}`, c: "--eco-zoo", w: 2.6, dash: "solid" },
    { k: "det", name: `碎屑 ${keys!.det}`, c: "--eco-organic", w: 1.4, dash: "dot" },
  ].filter((s) => d[s.k]);
  return (
    <>
      <div className="optbar">
        <Btn size="sm" icon={play ? "debug-pause" : "play"} onClick={() => setPlay(!play)}>{play ? "暂停" : "播放"}</Btn>
        <input type="range" min={0} max={Math.max(0, n - 1)} value={ti} onChange={(e) => { setPlay(false); setT(+e.target.value); }} style={{ flex: 1, accentColor: "var(--accent)", minWidth: 200 }} />
        <b className="mono" style={{ width: 92, color: "var(--fg-strong)" }}>{d.temp.time[ti]}</b>
        <span className="soft small ellipsis" style={{ maxWidth: 220 }}>{run.label}</span>
      </div>
      <div className="split-scroll" style={{ padding: "10px 14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "380px minmax(0,1fr)", gap: 12 }}>
          <svg viewBox={`0 0 ${COL_W} ${SVG_H}`} style={{ width: COL_W }}>
            <text x={colX + colW / 2} y={10} textAnchor="middle" fontSize={11} fill={cssVar("--fg-muted")} fontWeight={600}>水柱 · 温度 · 鱼类示意</text>
            {depth.map((z, i) => {
              const z0 = i === 0 ? 0 : (depth[i - 1] + z) / 2, z1 = i === depth.length - 1 ? H : (z + depth[i + 1]) / 2;
              const f = (temps[i] - tmin) / (tmax - tmin || 1);
              return <rect key={i} x={colX} y={yOf(z0)} width={colW} height={Math.max(0.6, yOf(z1) - yOf(z0) + 0.6)} fill={sampleScale(colorscaleFor("temp"), f)} />;
            })}
            {mldNow !== undefined && mldNow !== null && (
              <line x1={colX} x2={colX + colW} y1={yOf(Math.min(H, mldNow))} y2={yOf(Math.min(H, mldNow))} stroke={dark ? "#fff" : "#111"} strokeDasharray="4 3" strokeWidth={1.2} />
            )}
            {fishS && fishMarks.map((f: any, i: number) => (
              <path key={i} d={FISH_PATH} transform={`translate(${colX + 14 + ((i * 37) % (colW - 34))},${yOf(f.z) - 2}) scale(${0.7 + 0.8 * f.w})`} fill={cssVar("--eco-fish")} opacity={0.85} />
            ))}
            <rect x={colX} y={SVG_H - bot} width={colW} height={10} fill={cssVar("--eco-benthos")} opacity={0.75} />
            <rect x={colX} y={top} width={colW} height={SVG_H - top - bot} fill="none" stroke={cssVar("--border-strong")} />
            <DepthRuler x={rulerX} H={H} yOf={yOf} />
            <text x={12} y={SVG_H / 2} fontSize={10.5} fill={cssVar("--fg-soft")} transform={`rotate(-90 12 ${SVG_H / 2})`} textAnchor="middle">深度 (m)</text>
            <text x={colX + colW / 2} y={SVG_H - 6} textAnchor="middle" fontSize={10.5} fill={cssVar("--fg-soft")}>海底 · 底栖</text>
            <defs><linearGradient id="tg" x1="0" x2="1">{colorscaleFor("temp").map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}</linearGradient></defs>
            <rect x={colX} y={17} width={colW} height={5} rx={1} fill="url(#tg)" />
            <text x={colX - 4} y={22} textAnchor="end" fontSize={9.5} fill={cssVar("--fg-soft")}>{tmin.toFixed(0)}°</text>
            <text x={colX + colW + 4} y={22} fontSize={9.5} fill={cssVar("--fg-soft")}>{tmax.toFixed(0)}°C</text>
            <DepthCallouts x={colX + colW} yOf={yOf} top={top} bottom={SVG_H - bot} items={callouts} />
          </svg>
          <div className="col" style={{ gap: 6 }}>
            <Plot height={SVG_H} data={[
              { x: temps, y: depth, name: "温度 °C", xaxis: "x", line: { color: cssVar("--eco-phys"), width: 2 } },
              ...series.map((s) => ({ x: rel(s.k), y: depth, name: s.name, xaxis: "x2", line: { color: cssVar(s.c), width: s.w, dash: s.dash } })),
            ].map((s) => ({ ...s, type: "scatter", mode: "lines" }))} layout={{
              yaxis: { autorange: "reversed", title: { text: "深度 (m)" }, range: [H, 0] },
              xaxis: { title: { text: "温度 (°C)" }, domain: [0, 0.28], range: [tmin - 0.5, tmax + 0.5] },
              xaxis2: { title: { text: "相对浓度（各变量 ÷ 其分析时段最大值）" }, domain: [0.36, 1], range: [0, 1.05], anchor: "y" },
              legend: { orientation: "h", y: -0.12 }, margin: { t: 14 },
            }} />
          </div>
        </div>
        {fishS && !fishS.missing && (
          <Plot height={190} data={[
            { x: fishS.time, y: fishS.values, type: "scatter", mode: "lines", line: { color: cssVar("--eco-fish"), width: 1.8 }, fill: "tozeroy", fillcolor: "rgba(24,100,171,.08)", name: "鱼类" },
          ]} layout={{ title: { text: `鱼类生物量 ${fishVar}（${d.fish.units}）` }, margin: { t: 30, b: 30 }, showlegend: false, yaxis: { type: "linear", rangemode: "tozero" }, xaxis: { type: "date" },
            shapes: [{ type: "line", x0: d.temp.time[ti], x1: d.temp.time[ti], yref: "paper", y0: 0, y1: 1, line: { color: cssVar("--danger"), width: 1.5, dash: "dot" } }] }} />
        )}
        <div className="reading-cols" style={{ marginTop: 12 }}>
          <ColumnReading date={d.temp.time[ti]} depth={depth} temps={temps} mld={mldNow} phyto={keys!.phyto ? col("phyto") : []} nut={keys!.nut ? col("nut") : []} nutMax={keys!.nut ? maxOf("nut") : 0} hasFish={!!fishS} />
        </div>
      </div>
    </>
  );
}

/** A ruler like a survey tape: a minor tick every step, a labelled major tick every five. */
function niceStep(H: number) {
  const raw = H / 40, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= raw) ?? 10 * p;
}
function DepthRuler({ x, H, yOf }: { x: number; H: number; yOf: (z: number) => number }) {
  const step = niceStep(H);
  const ticks: number[] = [];
  for (let z = 0; z <= H + 1e-6; z += step) ticks.push(+z.toFixed(6));
  const c = cssVar("--fg-soft");
  return (
    <g>
      <line x1={x} x2={x} y1={yOf(0)} y2={yOf(H)} stroke={c} strokeOpacity={0.5} />
      {ticks.map((z, i) => {
        const major = i % 5 === 0;
        return (
          <g key={i}>
            <line x1={x - (major ? 9 : 4)} x2={x} y1={yOf(z)} y2={yOf(z)} stroke={c} strokeOpacity={major ? 0.9 : 0.45} />
            {major && <text x={x - 12} y={yOf(z) + 3.5} textAnchor="end" fontSize={10} fill={c}>{+z.toFixed(1)}</text>}
          </g>
        );
      })}
    </g>
  );
}

interface Callout { z: number; title: string; sub: string; value: string; color?: string }
/** Labels pinned to depths with elbow leader lines; labels are pushed apart so they never overlap. */
function DepthCallouts({ x, yOf, top, bottom, items }: { x: number; yOf: (z: number) => number; top: number; bottom: number; items: Callout[] }) {
  const GAP = 62, lx = x + 22;
  const sorted = [...items].sort((a, b) => a.z - b.z).map((c) => ({ ...c, y0: yOf(c.z), y: yOf(c.z) }));
  for (let i = 1; i < sorted.length; i++) sorted[i].y = Math.max(sorted[i].y, sorted[i - 1].y + GAP);
  const over = sorted.length ? sorted[sorted.length - 1].y - (bottom - 30) : 0;
  if (over > 0) for (let i = sorted.length - 1; i >= 0; i--) sorted[i].y = Math.max(top + 4, i === sorted.length - 1 ? sorted[i].y - over : Math.min(sorted[i].y, sorted[i + 1].y - GAP));
  const glow = cssVar("--glow");
  return (
    <g>
      {sorted.map((c, i) => (
        <g key={i}>
          <circle cx={x} cy={c.y0} r={2.2} fill={c.color ?? glow} />
          <path d={`M${x},${c.y0} H${x + 8} L${lx - 4},${c.y} H${lx + 132}`} fill="none" stroke={c.color ?? glow} strokeOpacity={0.75} strokeWidth={1} />
          <text x={lx} y={c.y - 5} fontSize={12} fontWeight={600} fill={cssVar("--fg-strong")}>{c.title}</text>
          <text x={lx} y={c.y + 11} fontSize={9.5} fill={cssVar("--fg-soft")}>{c.sub.length > 15 ? <><tspan x={lx}>{c.sub.slice(0, 15)}</tspan><tspan x={lx} dy={12}>{c.sub.slice(15)}</tspan></> : c.sub}</text>
          <text x={lx} y={c.y + (c.sub.length > 15 ? 38 : 26)} fontSize={11} className="mono" fill={c.color ?? glow}>{c.value}</text>
        </g>
      ))}
    </g>
  );
}

// ------------------------------------------------------------------ series
function SeriesTab({ pid, runs, v, curVar, start }: { pid: string; runs: any[]; v: string; curVar: any; start?: string }) {
  const dark = useApp((s) => s.dark);
  const [mode, setMode] = useState<"integral" | "mean" | "surface" | "bottom">("integral");
  const [kind, setKind] = useState<"annual" | "series">("annual");
  const [open, toggle] = useReadingOpen();
  const repeat = useApp((s) => s.project?.simulation?.mode === "repeat");
  const data = useAsync(() => v ? api.post(`/projects/${pid}/results/${kind === "annual" ? "annual" : "timeseries"}`, { run_ids: runs.map((r) => r.id), var: v, mode, start }) : Promise.resolve(null), [pid, v, mode, kind, runs.map((r) => r.id).join(), start]);
  const traces: any[] = [];
  (data.data as any)?.series?.forEach((s: any, i: number) => {
    if (s.missing) return;
    const c = seriesColor(i, dark);
    if (kind === "annual") {
      if (s.years > 1) {
        traces.push({ x: s.doy, y: s.max, type: "scatter", mode: "lines", line: { width: 0 }, showlegend: false, hoverinfo: "skip" });
        traces.push({ x: s.doy, y: s.min, type: "scatter", mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: c + "22", showlegend: false, hoverinfo: "skip" });
      }
      const solo = (data.data as any).series.filter((x: any) => !x.missing).length === 1;
      traces.push({ x: s.doy, y: s.mean, type: "scatter", mode: "lines", name: s.label, line: { color: c, width: 2.2 }, ...(solo ? { fill: "tozeroy", fillcolor: c + "18" } : {}) });
    } else traces.push({ x: s.time, y: s.values, type: "scatter", mode: "lines", name: s.label, line: { color: c, width: 1.6 } });
  });
  const lat = useSiteLat();
  const units = (data.data as any)?.units ?? "";
  const live = ((data.data as any)?.series ?? []).filter((x: any) => !x.missing);
  const first = live[0];
  // the first (reference) run carries the callouts: seasonal events on the annual cycle, extremes on the full record
  const events = !first ? [] : kind === "annual" ? annualEvents(v, first.doy, first.mean, lat)
    : extremeEvents(first.time, first.values, "整段最高", "整段最低", (t: string) => String(t).slice(0, 10));
  const ys = live.flatMap((x: any) => kind === "annual" ? [...x.mean, ...(x.years > 1 ? [...x.min, ...x.max] : [])] : x.values);
  // callouts go where they cover no curve: every plotted series counts as an obstacle
  const ev = eventLayer(events, { units, series: live.map((x: any) => (kind === "annual" ? { x: x.doy, y: x.mean } : { x: x.time, y: x.values })), yRange: headroom(ys), xRange: kind === "annual" ? [1, 365] : undefined });
  if (ev.marker) traces.push(ev.marker);
  const annotations = ev.annotations;
  return (
    <>
      <div className="optbar">
        <VarTitle curVar={curVar} />
        <span className="grow" />
        {curVar?.depth && <Seg size="sm" value={mode} options={[["integral", "深度积分"], ["mean", "深度平均"], ["surface", "表层"], ["bottom", "底层"]]} onChange={setMode} />}
        <Seg size="sm" value={kind} options={[["annual", "年循环"], ["series", "完整序列"]]} onChange={setKind} />
        <IconBtn icon="export" title="导出 CSV" disabled={!data.data} onClick={() => {
          const ss = ((data.data as any)?.series ?? []).filter((x: any) => !x.missing);
          const xs = kind === "annual" ? ss[0]?.doy ?? [] : ss[0]?.time ?? [];
          downloadCsv(`${v}_${kind}.csv`, [[kind === "annual" ? "日序" : "日期", ...ss.map((x: any) => `${x.label} (${(data.data as any).units})`)], ...xs.map((x: any, i: number) => [x, ...ss.map((q: any) => (kind === "annual" ? q.mean : q.values)[i])])]);
        }} />
        <ReadingToggle open={open} toggle={toggle} />
      </div>
      {data.loading ? <Loading /> : (
        <FigAside open={open} toggle={toggle} figure={<Plot fill data={traces} layout={{ xaxis: kind === "annual" ? { ...MONTH_AXIS, title: { text: "年内日序" } } : { title: { text: "时间" } }, yaxis: { title: { text: units }, ...(events.length ? { range: headroom(ys) } : {}) }, hovermode: "x unified", margin: { t: 16 }, annotations }} />}
          reading={<SeriesReading data={data.data} kind={kind} v={v} label={varName(v) ?? (curVar?.long_name || v)} mode={curVar?.depth ? mode : "integral"} repeat={repeat} />} />
      )}
    </>
  );
}

// ----------------------------------------------------------------- profile
function ProfileTab({ pid, runs, v, curVar, start }: { pid: string; runs: any[]; v: string; curVar: any; start?: string }) {
  const dark = useApp((s) => s.dark);
  const [months, setMonths] = useState([1, 4, 7, 10]);
  const [open, toggle] = useReadingOpen();
  const data = useAsync(() => v && curVar?.depth ? api.post(`/projects/${pid}/results/profiles`, { run_ids: runs.map((r) => r.id), var: v, months, start }) : Promise.resolve(null), [pid, v, months.join(), runs.map((r) => r.id).join(), start, curVar?.depth]);
  const dashes = ["solid", "dash", "dot", "dashdot", "longdash", "longdashdot"];
  return (
    <>
      <div className="optbar">
        <VarTitle curVar={curVar} />
        <span className="grow" />
        <span className="soft small">月份</span>
        <div className="segmented sm">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => <button key={m} className={months.includes(m) ? "on" : ""} onClick={() => setMonths(months.includes(m) ? months.filter((x) => x !== m) : [...months, m].sort((a, b) => a - b))}>{m}</button>)}
        </div>
        <ReadingToggle open={open} toggle={toggle} />
      </div>
      {!curVar?.depth ? <Empty icon="symbol-array" title="请选择一个随深度变化的变量" /> : data.loading ? <Loading /> : (
        <FigAside open={open} toggle={toggle} reading={<ProfileReading data={data.data} v={v} label={varName(v) ?? (curVar?.long_name || v)} />} figure={
          <ProfilePlot profiles={(data.data as any)?.profiles ?? []} units={(data.data as any)?.units} runs={runs} months={months} dashes={dashes} dark={dark} />} />
      )}
    </>
  );
}

/** Profiles fill the pane; each profile's maximum is marked with its depth (subsurface maxima are the story). */
function ProfilePlot({ profiles, units, runs, months, dashes, dark }: { profiles: any[]; units?: string; runs: any[]; months: number[]; dashes: string[]; dark: boolean }) {
  const traces: any[] = [];
  const events: { x: number; y: number; title: string; detail: string; c: string }[] = [];
  profiles.forEach((pr: any) => {
    const ri = runs.findIndex((r) => r.label === pr.label);
    const c = seriesColor(Math.max(0, ri), dark);
    traces.push({ x: pr.values, y: pr.depth, type: "scatter", mode: "lines", name: runs.length > 1 ? `${pr.label} · ${pr.month}月` : `${pr.month}月`, line: { color: c, dash: dashes[months.indexOf(pr.month) % dashes.length], width: 2 } });
    const vals = (pr.values as (number | null)[]).map((x) => (x === null ? -Infinity : x));
    const k = vals.indexOf(Math.max(...vals));
    if (k < 0 || !isFinite(vals[k]) || profiles.length > 8) return;
    // same rule as the reading beside the figure: a well-mixed profile has no maximum worth pointing at
    const fin = vals.filter(isFinite), mean = fin.reduce((x, y) => x + y, 0) / fin.length;
    if ((Math.max(...fin) - Math.min(...fin)) / Math.max(Math.abs(mean), 1e-12) < 0.1) return;
    events.push({ x: pr.values[k], y: pr.depth[k], title: `${pr.month}月最大`, detail: pr.depth[k] < 2 ? "表层" : `${pr.depth[k].toFixed(0)} m`, c });
  });
  // the x range gets a margin on the right so labels have empty room next to the curves
  const allX = profiles.flatMap((p: any) => p.values).filter((v: any) => v !== null && isFinite(v)) as number[];
  const allD = profiles.flatMap((p: any) => p.depth) as number[];
  const xr: [number, number] = allX.length ? [Math.min(0, ...allX), Math.max(...allX) * 1.3] : [0, 1];
  const dr: [number, number] = allD.length ? [Math.min(...allD) - 1, Math.max(...allD) + 1] : [0, 1];
  const ev = eventLayer(events, { series: profiles.map((p: any) => ({ x: p.values, y: p.depth })), xRange: xr, yRange: dr, wFrac: 0.2, hFrac: 0.07 });
  ev.annotations.forEach((a: any, i: number) => { a.arrowcolor = events[i].c; });
  events.forEach((e) => traces.push({ x: [e.x], y: [e.y], type: "scatter", mode: "markers", marker: { size: 7, color: e.c, line: { width: 1.5, color: cssVar("--bg") } }, showlegend: false, hoverinfo: "skip" }));
  return <Plot fill data={traces} layout={{ yaxis: { range: [dr[1], dr[0]], title: { text: "深度 (m)" } }, xaxis: { title: { text: units }, range: xr }, legend: { orientation: "h", x: 0, y: -0.1, yanchor: "top" }, margin: { r: 30, t: 14, b: 70 }, annotations: ev.annotations }} />;
}

/** Least-squares slope of log10 density against log10 weight over the fished-and-forage range. */
function spectrumSlope(w: number[], dens: (number | null)[], lo = 1, hi = 1000) {
  const pts = w.map((x, i) => [x, dens[i]] as [number, number | null]).filter(([x, y]) => x >= lo && x <= hi && y !== null && y > 0).map(([x, y]) => [Math.log10(x), Math.log10(y!)]);
  if (pts.length < 5) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0), sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  return sxx ? sxy / sxx : null;
}

// ----------------------------------------------------------------- spectrum
function SpectrumTab({ pid, runs }: { pid: string; runs: any[] }) {
  const dark = useApp((s) => s.dark);
  const [view, setView] = useState<"spectrum" | "time">("spectrum");
  const [open, toggle] = useReadingOpen();
  const data = useAsync(() => Promise.all(runs.map((r) => api.get(`/projects/${pid}/runs/${r.id}/spectrum`).then((d) => ({ ...d, label: r.label })))), [pid, runs.map((r) => r.id).join()]);
  if (!runs.length) return <Empty icon="graph-scatter" title="所选运行中没有 MIZER 粒径谱鱼类" />;
  if (data.loading) return <Loading />;
  if (data.error) return <div style={{ padding: 16 }}><Notice kind="danger">{data.error}</Notice></div>;
  const ds = data.data as any[];
  // size grid and fishing threshold come from the run's own MIZER parameters (defaults match the builder)
  const mp = runs[0]?.spec?.htl?.mizer?.params ?? {};
  const wF = +(mp.w_minF ?? 80), ncl = +(mp.nclass ?? 100), wlo = +(mp.w_min ?? 1e-3), whi = +(mp.w_inf ?? 1e6);
  const wtxt = (w: number) => (w >= 1e6 ? `${w / 1e6} t` : w >= 1e3 ? `${w / 1e3} kg` : w >= 1 ? `${w} g` : `${w * 1e3} mg`);
  return (
    <>
      <div className="optbar">
        <b style={{ color: "var(--fg-strong)" }}>群落粒径谱</b><span className="soft small">FABM-MIZER，{ncl} 个粒径级（{wtxt(wlo)} – {wtxt(whi)}）</span>
        <span className="grow" />
        <Seg size="sm" value={view} options={[["spectrum", "粒径谱"], ["time", "随时间演变"]]} onChange={setView} />
        <ReadingToggle open={open} toggle={toggle} />
      </div>
      <FigAside open={open} toggle={toggle} reading={<SpectrumReading ds={ds} wMinF={wF} />} figure={
        view === "spectrum" ? (
          <Plot fill data={ds.map((d, i) => ({ x: d.w, y: d.density, type: "scatter", mode: "lines", name: d.label, line: { color: seriesColor(i, dark), width: 2.4 } }))}
            layout={{ xaxis: { type: "log", title: { text: "个体湿重 w (g)" }, exponentformat: "power" }, yaxis: { type: "log", title: { text: "生物量密度 (g m⁻² g⁻¹)" }, exponentformat: "power" }, margin: { t: 16 },
              shapes: [{ type: "line", x0: wF, x1: wF, yref: "paper", y0: 0, y1: 1, line: { dash: "dot", color: cssVar("--danger"), width: 1.2 } }],
              annotations: [{ x: Math.log10(wF), y: 0.98, yref: "paper", text: ` 捕捞下限 ${wtxt(wF)}`, showarrow: false, font: { size: 11, color: cssVar("--danger") }, xanchor: "left" },
                ...ds.map((d, i) => { const sl = spectrumSlope(d.w, d.density); return sl === null ? null : { xref: "paper", yref: "paper", x: 0.01, y: 0.04 + i * 0.07, xanchor: "left", yanchor: "bottom", showarrow: false, bgcolor: cssVar("--bg"),
                  text: `<span style="color:${seriesColor(i, dark)}">●</span> ${ds.length > 1 ? `${d.label}：` : ""}1–1000 g 拟合斜率 <b>${sl.toFixed(2)}</b><span style="color:${cssVar("--fg-soft")}">（约 −1 表示各对数粒径级的总生物量相近）</span>`, font: { size: 11.5, color: cssVar("--fg-strong") } }; }).filter(Boolean)] }} />
        ) : (
          <Plot fill data={[{ type: "heatmap", x: ds[0].time, y: ds[0].w, z: ds[0].log10_biomass_time, colorscale: colorscaleFor("", dark), colorbar: { title: { text: "log₁₀ g m⁻²", side: "right" }, thickness: 12 }, zsmooth: "best" }]}
            layout={{ title: { text: `${ds[0].label} · 各粒径级生物量` }, yaxis: { type: "log", title: { text: "w (g)" }, exponentformat: "power" }, margin: { t: 34 } }} />
        )} />
    </>
  );
}

// ----------------------------------------------------------------- food web
function WebTab({ pid, runs }: { pid: string; runs: any[] }) {
  const [i, setI] = useState(0);
  const run = runs[Math.min(i, runs.length - 1)];
  const data = useAsync(() => api.get(`/projects/${pid}/runs/${run.id}/foodweb`), [pid, run.id]);
  const [sel, setSel] = useState<string | null>(null);
  const [open, toggle] = useReadingOpen();
  return (
    <>
      <div className="optbar">
        <span className="soft small">运行</span>
        <Select size="sm" value={i} onChange={(x) => setI(+x)}>{runs.map((r, k) => <option key={r.id} value={k}>{r.label}</option>)}</Select>
        <span className="grow" />
        <ReadingToggle open={open} toggle={toggle} />
      </div>
      <FigAside open={open} toggle={toggle} reading={<WebReading />} figure={<div className="split-scroll">{data.loading ? <Loading /> : data.data && <FoodWebGraph graph={data.data as any} state={(data.data as any).state} onSelect={setSel} selected={sel} />}</div>} />
    </>
  );
}
