import { Fragment, useEffect, useMemo, useState } from "react";
import { api, on } from "../api";
import { MapCanvas } from "../components/MapCanvas";
import { Btn, Check, Empty, Icon, IconBtn, Loading, Modal, Notice, Progress, Select, Seg, Split, Stat, StatusBadge, Tabs, fmt, robustAbs, useAsync, HelpLink, PanelToggle } from "../components/ui";
import { ShelfEnsemble } from "../components/ShelfEnsemble";
import { Shelf3DView, ShelfPlates, ShelfRegions } from "../components/ShelfViews";
import { FigureReading, changeOfMeans, configKind, pairKeyOf, referenceIndex } from "../components/ShelfExplain";
import { CellPanel } from "../components/CellPanel";
import { ReadingToggle, useReadingOpen } from "../components/ResultReading";
import { HOST_LABEL, useApp } from "../store";

const AMM7: [number, number, number, number] = [48, 62, -12, 10];
/** Shelf seas around the world (south, north, west, east) for the study planner. */
const SHELF_SEAS: [string, [number, number, number, number]][] = [
  ["西北欧陆架（AMM7 区域）", AMM7], ["北海", [51, 61.5, -4, 9]], ["波罗的海", [53.5, 60, 12, 24]],
  ["渤海与黄海", [33, 41, 117, 127]], ["东海陆架", [26, 33, 119, 128]], ["台湾海峡", [22, 26, 116, 121]], ["南海北部陆架", [18, 23, 108, 118]],
  ["缅因湾与乔治浅滩", [40, 45, -71, -65]], ["白令海东部陆架", [54, 62, -175, -158]],
  ["本格拉上升流区", [-35, -28, 14, 19]], ["巴塔哥尼亚陆架", [-52, -38, -68, -56]], ["澳大利亚东南陆架", [-40, -32, 145, 154]],
];
const MONTHLY_LABEL: Record<string, string> = { temp: "表层温度", F1_c: "鱼 1 生物量", F2_c: "鱼 2 生物量", MB_c: "大型底栖生物量", fish_c_tot: "鱼类群落湿重", Z4_c: "中型浮游动物（深度积分）", ECO_mesozoo: "中型浮游动物", ergom_zz: "浮游动物" };
const MONTHLY_VAR: Record<string, string> = { temp: "temp", F1_c: "F1_c", F2_c: "F2_c", MB_c: "MB_c", fish_c_tot: "fish_c_tot", Z4_c: "Z4_c", ECO_mesozoo: "ECO_mesozoo", ergom_zz: "ergom_zz" };
const METRIC_VAR: Record<string, string> = { phyto: "P1_c", zoo: "Z4_c", zoo_Z4_c: "Z4_c", zoo_Z5_c: "Z5_c", zoo_Z6_c: "Z6_c", landings: "fish_c_tot", fish_c_size1: "fish_c_tot", fish_c_size2: "fish_c_tot", fish_c_size3: "fish_c_tot", chl: "P1_Chl", npp: "P1_c", F1_c: "F1_c", F2_c: "F2_c", MB_c: "MB_c", fish_ww: "fish_c_tot", co2: "O3_c", sst: "temp", sbt: "temp" };

export default function ShelfPage() {
  const { project, jobs, setPage } = useApp();
  const p = project!;
  const studies = useAsync(() => api.get<any[]>(`/projects/${p.id}/shelf`), [p.id]);
  const [sel, setSel] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  useEffect(() => on("shelf", () => studies.reload()), []);
  useEffect(() => { if (!sel && studies.data?.length) setSel(studies.data[0].id); }, [studies.data]);
  const job = Object.values(jobs).find((j) => j.kind === "shelf" && j.study_id === sel && (j.status === "running" || j.status === "queued"));
  return (
    <div className="page fill">
      <div className="page-header">
        <div>
          <div className="row"><PanelToggle id="shelf" label="研究列表" /><div className="page-title">三维陆架</div><span className="badge">水柱集合</span><HelpLink chapter="11-shelf-3d" title="从水柱到陆架（教程）" /></div>
        </div>
        <div className="page-actions"><Btn icon="add" onClick={() => setPlanning(true)}>新建研究</Btn></div>
      </div>
      <Split id="shelf" label="研究列表" initial={260} side={
        <>
          <div className="tree-head">研究<span className="actions"><IconBtn icon="add" title="新建" size="sm" onClick={() => setPlanning(true)} /></span></div>
          <div className="split-scroll">
            {(studies.data ?? []).map((s) => (
              <div key={s.id} className={`tree-item flat ${s.id === sel ? "active" : ""}`} onClick={() => setSel(s.id)} style={{ paddingTop: 7, paddingBottom: 7 }}>
                <Icon name="globe" />
                <div className="grow"><div className="ellipsis" style={{ fontWeight: 500 }}>{s.name}</div><div className="meta">{s.res}° · {s.years} 年 · {s.config_ids.length} 个配置</div></div>
                <StatusBadge status={s.status} />
              </div>
            ))}
            {!studies.loading && !studies.data?.length && <Empty icon="globe" title="还没有陆架研究"><Btn icon="add" onClick={() => setPlanning(true)}>新建</Btn></Empty>}
          </div>
        </>
      }>
        {sel ? <StudyView key={sel} pid={p.id} sid={sel} job={job} onDeleted={() => { setSel(null); studies.reload(); }} onChanged={() => studies.reload()} />
          : <Empty icon="globe" title="新建一个陆架研究">选择区域与分辨率 → 评估算力 → 开始计算。</Empty>}
      </Split>
      {planning && <PlanModal pid={p.id} onClose={() => setPlanning(false)} onCreated={(s) => { setPlanning(false); studies.reload(); setSel(s.id); }} />}
    </div>
  );
}

function EstimatePanel({ est }: { est: any }) {
  const s = est.system;
  const level = est.level === "heavy" ? "danger" : est.level === "moderate" ? "warn" : "info";
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="stats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <Stat k="网格水柱" v={est.n_columns} />
        <Stat k="预计耗时" v={est.wall_minutes < 60 ? est.wall_minutes : (est.wall_minutes / 60).toFixed(1)} unit={est.wall_minutes < 60 ? "分钟" : "小时"} />
        <Stat k="CPU 时" v={est.cpu_hours} />
        <Stat k="磁盘" v={est.disk_gb} unit="GB" />
      </div>
      {est.warnings.length ? est.warnings.map((w: string) => <Notice key={w} kind={level === "info" ? "warn" : (level as any)}>{w}</Notice>)
        : <Notice kind="info" icon="pass">算力充足，可以直接开始。</Notice>}
      <div className="kv small">
        <span className="k">本机</span><span className="v">{s.platform} · {s.cpu_physical} 物理核 / {s.cpu_logical} 逻辑核 · 可用内存 {s.memory_available_gb}/{s.memory_total_gb} GB · 磁盘剩余 {s.disk_free_gb} GB</span>
        <span className="k">并行进程</span><span className="v">{est.workers}（可在设置中修改）</span>
        <span className="k">速度基准</span><span className="v">{est.sec_per_column_year} 秒 / 水柱·年 — {est.basis}</span>
        {est.per_config?.map((c: any) => <Fragment key={c.config}><span className="k">{c.config}</span><span className="v">{c.wall_minutes} 分钟</span></Fragment>)}
      </div>
      <div className="hint" style={{ lineHeight: 1.6 }}>{est.engine_note}</div>
    </div>
  );
}

function PlanModal({ pid, onClose, onCreated }: { pid: string; onClose: () => void; onCreated: (s: any) => void }) {
  const { toast } = useApp();
  const configs = useAsync(() => api.get<any[]>(`/projects/${pid}/configs`), [pid]);
  const site = useApp((s) => (s.project as any)?.site_info ?? (s.project as any)?.site);
  // start from the project's own sea: the paper box near the NW European shelf, a box around the site elsewhere
  const nearPaper = site?.lat >= 46 && site?.lat <= 64 && site?.lon >= -14 && site?.lon <= 12;
  const initBox: [number, number, number, number] = !site?.lat || nearPaper ? AMM7 : [Math.floor(site.lat - 4), Math.ceil(site.lat + 4), Math.floor(site.lon - 5), Math.ceil(site.lon + 5)];
  const [f, setF] = useState({ name: nearPaper || !site?.lat ? "西北欧陆架" : `${site.name ?? "站点"}周边陆架`, box: initBox, res: nearPaper ? 1.0 : 0.5, min_depth: 15, max_depth: 200, forcing_year: 2014, years: 3, nlev: 30, dt: 1800, tide_scale: (useApp.getState().project as any)?.simulation?.tide_scale ?? 1, config_ids: [] as string[] });
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (configs.data && !f.config_ids.length) {
      // a reference without fish plus the most complete coupled configuration
      const kind = (c: any) => c.spec?.htl?.kind === "none" && (c.spec?.ltl?.zoo_mortality_factor ?? 1) <= 1 ? 0 : c.spec?.htl?.kind === "mizer" && c.spec.htl.mizer?.feedback !== false ? 1 : c.spec?.htl?.kind === "e2e" ? 2 : 9;
      const ref = configs.data.find((c) => kind(c) === 0), cmp = configs.data.find((c) => kind(c) === 1) ?? configs.data.find((c) => kind(c) === 2);
      const pick = [ref, cmp].filter(Boolean).map((c: any) => c.id);
      setF((x) => ({ ...x, config_ids: pick.length ? pick : configs.data!.slice(0, 1).map((c) => c.id) }));
    }
  }, [configs.data]);
  const doPlan = async () => { setBusy(true); try { setPlan(await api.post(`/projects/${pid}/shelf/plan`, f)); } catch (e: any) { toast(e.message, "bad"); } finally { setBusy(false); } };
  const create = async (start: boolean) => {
    if (start && plan?.estimate?.level === "heavy" && !confirm(`预计耗时 ${plan.estimate.wall_minutes} 分钟，资源占用较高。仍然开始？`)) return;
    setBusy(true);
    try {
      const s = await api.post(`/projects/${pid}/shelf`, f);
      if (start) await api.post(`/projects/${pid}/shelf/${s.id}/start`);
      toast(start ? "陆架研究已开始" : "已保存", "ok"); onCreated(s);
    } catch (e: any) { toast(e.message, "bad"); } finally { setBusy(false); }
  };
  const set = (k: string, v: any) => { setF({ ...f, [k]: v }); setPlan(null); };
  const box = (i: number, v: number) => set("box", f.box.map((x, k) => (k === i ? v : x)));
  return (
    <Modal title="新建陆架研究" icon="globe" onClose={onClose} width={1100} footer={<>
      <span className="soft small grow">{plan ? "确认网格与资源后开始；计算在后台进行，可随时停止。" : "第一步：评估网格与算力。"}</span>
      <Btn onClick={onClose}>取消</Btn>
      <Btn icon={busy && !plan ? "loading" : "pulse"} spin={busy && !plan} disabled={busy} onClick={doPlan}>评估网格与算力</Btn>
      <Btn disabled={!plan || busy} onClick={() => create(false)}>仅保存</Btn>
      <Btn variant="primary" icon="play" disabled={!plan || busy || !f.config_ids.length} onClick={() => create(true)}>开始计算</Btn>
    </>}>
      <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0,1fr)", gap: 22 }}>
        <div className="col" style={{ gap: 12 }}>
          <div className="field"><label>名称</label><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="field"><label>海区</label>
            <Select value="" onChange={(v) => { const x = SHELF_SEAS[+v]; if (x) setF({ ...f, name: x[0].replace(/（.*）/, ""), box: x[1] }); setPlan(null); }}>
              <option value="">选择常用陆架海…</option>
              {SHELF_SEAS.map(([n], i) => <option key={n} value={i}>{n}</option>)}
            </Select>
          </div>
          <div className="field"><label>区域（南 / 北 / 西 / 东，度；南纬、西经用负数）</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {["南界 °N", "北界 °N", "西界 °E", "东界 °E"].map((l, i) => <input key={l} className="input num" type="number" title={l} value={f.box[i]} onChange={(e) => box(i, +e.target.value)} />)}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field"><label>分辨率</label><Select value={f.res} onChange={(v) => set("res", +v)}>{[2, 1, 0.5, 0.25].map((r) => <option key={r} value={r}>{r}°</option>)}</Select></div>
            <div className="field"><label>强迫年</label><input className="input num" type="number" value={f.forcing_year} onChange={(e) => set("forcing_year", +e.target.value)} /></div>
            <div className="field"><label>最浅 (m)</label><input className="input num" type="number" value={f.min_depth} onChange={(e) => set("min_depth", +e.target.value)} /></div>
            <div className="field"><label>最深 (m)</label><input className="input num" type="number" value={f.max_depth} onChange={(e) => set("max_depth", +e.target.value)} /></div>
            <div className="field"><label>模拟年数（含预热）</label><input className="input num" type="number" min={1} value={f.years} onChange={(e) => set("years", +e.target.value)} /></div>
            <div className="field"><label>垂向层数</label><input className="input num" type="number" value={f.nlev} onChange={(e) => set("nlev", +e.target.value)} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label>潮流混合</label><Select value={String(f.tide_scale)} onChange={(v) => set("tide_scale", +v)}><option value="0">无潮</option><option value="0.5">弱</option><option value="1">中等（北海中部）</option><option value="2">强</option><option value="3">很强</option></Select></div>
          </div>
          <div className="field"><label>配置（每个配置在所有水柱上各跑一遍，选两个可画差值图）</label>
            <div className="panel" style={{ maxHeight: 200, overflow: "auto", padding: "4px 0" }}>
              {configs.data?.map((c) => (
                <div key={c.id} className="row" style={{ padding: "4px 10px" }}>
                  <Check checked={f.config_ids.includes(c.id)} onChange={(v) => set("config_ids", v ? [...f.config_ids, c.id] : f.config_ids.filter((x) => x !== c.id))}><span className="small">{c.name}</span></Check>
                  <span className="grow" /><span className="soft small">{HOST_LABEL[c.spec.host]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col" style={{ gap: 14 }}>
          <MapCanvas box={f.box} cell={plan ? f.res : undefined} points={(plan?.grid?.points ?? []).map((q: any) => ({ lat: q.lat, lon: q.lon, value: q.depth, label: "平均水深" }))} varName="O2_o" units="m"
            height={380} title={plan ? `${plan.grid.points.length} 个水柱（颜色为格点平均水深）` : "点击“评估网格与算力”查看网格"} />
          {plan && <EstimatePanel est={plan.estimate} />}
        </div>
      </div>
    </Modal>
  );
}

function StudyView({ pid, sid, job, onDeleted, onChanged }: { pid: string; sid: string; job: any; onDeleted: () => void; onChanged: () => void }) {
  const { toast } = useApp();
  const res = useAsync(() => api.get(`/projects/${pid}/shelf/${sid}/results`), [pid, sid, job?.status]);
  const cfgs = useAsync(() => api.get<any[]>(`/projects/${pid}/configs`), [pid]);
  const boxes = useAsync(() => api.get<any[]>(`/shelf_regions`), []);
  const study = res.data?.study;
  const results: any[] = res.data?.results ?? [];
  const [ci, setCi] = useState(0);
  const [cj, setCj] = useState(1);
  const [cmp, setCmp] = useState<"value" | "diff" | "pct">("value");
  const [metric, setMetric] = useState("");
  const [month, setMonth] = useState(0);
  const [view, setView] = useState<"map" | "plates" | "regions" | "3d" | "ensemble">("map");
  const [cellSel, setCellSel] = useState<{ point: { lat: number; lon: number }; at: { clientX: number; clientY: number } } | null>(null);
  const [readOpen, toggleRead] = useReadingOpen();
  const cfgOf = (r: any) => (cfgs.data ?? []).find((c) => c.id === r?.config_id);
  // the reference (base) is the simpler configuration: low-trophic only, then one-way coupling
  const [refSet, setRefSet] = useState(false);
  useEffect(() => {
    if (refSet || !results.length || !cfgs.data) return;
    const [a, b] = referenceIndex(results.map((r) => configKind(cfgOf(r))));
    setCi(a); setCj(b); setRefSet(true);
  }, [results.length, cfgs.data]);
  const meta = results[0]?.meta ?? {};
  const monthlyKeys = Object.keys(results[0]?.points?.[0]?.monthly ?? {});
  const metricKeys = [...Object.keys(meta), ...monthlyKeys.map((k) => `monthly:${k}`)];
  // default to a metric that exists in the configuration on screen (a fish-free baseline has no fish biomass)
  const has = (k: string, i: number) => (results[i]?.points ?? []).some((p: any) => p.metrics?.[k] != null);
  useEffect(() => {
    if (metric || !metricKeys.length || !refSet) return;
    const both = (k: string) => has(k, ci) && (results.length < 2 || has(k, cj));
    setMetric(metricKeys.find((k) => /fish_ww|F1_c/.test(k) && both(k)) ?? metricKeys.find((k) => k === "zoo_Z4_c" && both(k)) ?? metricKeys.find((k) => /zoo/.test(k)) ?? metricKeys[0]);
  }, [metricKeys.join(), refSet]);
  const valueOf = (pt: any) => metric.startsWith("monthly:") ? (month === 0 ? avg(pt.monthly?.[metric.slice(8)]) : pt.monthly?.[metric.slice(8)]?.[month - 1]) : pt.metrics?.[metric];
  const points = useMemo(() => {
    const a = results[ci];
    if (!a) return [];
    const byI = new Map((results[cj]?.points ?? []).map((q: any) => [q.i, q]));
    return a.points.map((q: any) => {
      let v = valueOf(q);
      if (cmp !== "value" && results[cj]) {
        const qb: any = byI.get(q.i);
        const vb = qb ? valueOf(qb) : null;
        v = vb == null || v == null ? null : cmp === "diff" ? vb - v : v ? ((vb - v) / Math.abs(v)) * 100 : null;
      }
      return { lat: q.lat, lon: q.lon, value: v, label: `水深 ${q.depth} m` };
    });
  }, [results, ci, cj, cmp, metric, month]);
  const pairs = useMemo(() => {
    const a = results[ci];
    if (!a) return [];
    const byI = new Map((results[cj]?.points ?? []).map((q: any) => [q.i, q]));
    return a.points.map((q: any) => { const qb: any = byI.get(q.i); return { lat: q.lat, lon: q.lon, depth: q.depth, a: valueOf(q), b: qb ? valueOf(qb) : null, other: q.metrics }; });
  }, [results, ci, cj, metric, month]);
  const chg = useMemo(() => changeOfMeans(results[ci], results[cj]), [results, ci, cj]);
  const vals = points.map((q: any) => q.value).filter((x: any) => x != null && isFinite(x));
  const range: [number, number] | undefined = cmp !== "value" && vals.length ? (() => { const m = robustAbs(vals); return [-m, m] as [number, number]; })() : undefined;
  const unit = cmp === "pct" ? "%" : metric.startsWith("monthly:") ? "" : meta[metric]?.units;
  const label = metric.startsWith("monthly:") ? MONTHLY_LABEL[metric.slice(8)] ?? metric.slice(8) : meta[metric]?.label;
  const varName = metric.startsWith("monthly:") ? MONTHLY_VAR[metric.slice(8)] ?? "" : METRIC_VAR[metric] ?? "";
  if (res.loading && !res.data) return <Loading />;
  if (!study) return null;
  const st = job?.status ?? study.status;
  return (
    <>
      <div className="toolbar">
        <b style={{ color: "var(--fg-strong)", fontSize: 14 }}>{study.name}</b>
        <StatusBadge status={st} />
        <span className="soft small ellipsis">{study.box.join(" / ")} · {study.res}° · {study.min_depth}–{study.max_depth} m · {study.forcing_year} 年强迫 · {study.years} 年（末年分析）· {study.nlev} 层</span>
        <span className="grow" />
        {!job && st !== "running" && <Btn size="sm" variant={study.status === "done" ? undefined : "primary"} icon={study.status === "done" ? "refresh" : "play"} onClick={async () => { if (study.status === "done" && !confirm("重新计算会覆盖现有结果，确定吗？")) return; await api.post(`/projects/${pid}/shelf/${sid}/start`); toast("已开始", "ok"); onChanged(); }}>{study.status === "done" ? "重新计算" : "开始计算"}</Btn>}
        {job && <Btn size="sm" icon="debug-stop" className="danger-text" onClick={() => api.post(`/jobs/${job.id}/cancel`)}>停止</Btn>}
        <IconBtn icon="trash" title="删除研究" danger onClick={async () => { if (confirm("删除该陆架研究及其全部输出？")) { await api.del(`/projects/${pid}/shelf/${sid}`); onDeleted(); } }} />
      </div>
      {job && <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}><div className="row"><Icon name="loading" spin /><span className="grow">{job.message || "准备中…"}</span><span className="soft num">{Math.round(job.progress * 100)}%</span></div><Progress value={job.progress} style={{ marginTop: 6 }} /></div>}
      {study.error && !job && study.status === "failed" && <div style={{ padding: 12 }}><Notice kind="danger">{study.error}</Notice></div>}
      {!results.length ? (
        <div className="split-scroll" style={{ padding: 16 }}>{study.estimate ? <EstimatePanel est={study.estimate} /> : <Empty icon="globe" title="尚无结果" />}</div>
      ) : (
        <>
          <Tabs value={view} onChange={setView} tabs={[
            { id: "map", label: "空间分布", icon: "map", tip: "每个格点一根水柱，颜色表示所选指标；点击格点看详情" },
            { id: "plates", label: "图版", icon: "files", tip: "两种配置并排对比的多面板图" },
            { id: "regions", label: "区域统计", icon: "table", tip: "按海区或水深分区的平均值" },
            { id: "3d", label: "三维视图", icon: "globe", tip: "立体地形和水柱，直观看出哪里浅、哪里深" },
            { id: "ensemble", label: "逐月走势", icon: "pulse", tip: "每根水柱一条线，看各处的季节变化有多一致、按水深分区落在哪里" },
          ]} />
          {cellSel && view === "map" && <CellPanel at={cellSel.at} point={cellSel.point} results={results} ci={ci} cj={cmp !== "value" ? cj : (results.length > 1 ? cj : undefined)} metric={metric.startsWith("monthly:") ? "fish_ww" : metric} boxes={boxes.data ?? []} onClose={() => setCellSel(null)} />}
          {view === "plates" && <div className="split-scroll" style={{ padding: 16 }}><ShelfPlates study={study} results={results} configs={cfgs.data ?? []} boxes={boxes.data ?? []} /></div>}
          {view === "regions" && <div className="split-scroll" style={{ padding: 16 }}><ShelfRegions pid={pid} sid={sid} study={study} configs={cfgs.data ?? []} results={results} /></div>}
          {view === "ensemble" && <div className="split-scroll" style={{ padding: 16 }}><ShelfEnsemble results={results} /></div>}
          {view === "3d" && <div className="split-scroll" style={{ padding: 16 }}><Shelf3DView study={study} results={results} boxes={boxes.data ?? []} configs={cfgs.data ?? []} /></div>}
          {view === "map" && <>
          <div className="optbar">
            <span className="opt">指标<Select size="sm" value={metric} onChange={setMetric} style={{ minWidth: 220 }}>
              <optgroup label="分析年年均">{metricKeys.filter((k) => !k.startsWith("monthly:")).map((k) => <option key={k} value={k}>{meta[k].label.startsWith("  ") ? `　└ ${meta[k].label.trim()}` : meta[k].label}</option>)}</optgroup>
              <optgroup label="逐月">{metricKeys.filter((k) => k.startsWith("monthly:")).map((k) => <option key={k} value={k}>{MONTHLY_LABEL[k.slice(8)] ?? k.slice(8)}</option>)}</optgroup>
            </Select></span>
            {results.length > 1 && <Seg size="sm" value={cmp} options={[["value", "数值"], ["diff", "差值"], ["pct", "% 变化"]]} onChange={setCmp} />}
            <span className="opt">{cmp === "value" ? "配置" : "基准"}<Select size="sm" value={ci} onChange={(v) => setCi(+v)}>{results.map((r, i) => <option key={i} value={i}>{r.config_name}</option>)}</Select></span>
            {results.length > 1 && cmp !== "value" && <>
              <IconBtn icon="arrow-swap" size="sm" title="交换基准与比较" onClick={() => { setCi(cj); setCj(ci); }} />
              <span className="opt">比较<Select size="sm" value={cj} onChange={(v) => setCj(+v)}>{results.map((r, i) => <option key={i} value={i}>{r.config_name}</option>)}</Select></span>
            </>}
            {metric.startsWith("monthly:") && <span className="opt" style={{ flex: 1, minWidth: 220 }}>月份<input type="range" min={0} max={12} value={month} onChange={(e) => setMonth(+e.target.value)} style={{ flex: 1, accentColor: "var(--accent)" }} /><b style={{ width: 40, color: "var(--fg-strong)" }}>{month === 0 ? "年均" : `${month}月`}</b></span>}
            <span className="grow" />
            <ReadingToggle open={readOpen} toggle={toggleRead} />
          </div>
          <div className="split-scroll" style={{ padding: "16px 20px 24px" }}>
            {!metric.startsWith("monthly:") && metric && !has(metric, ci) && <div className="reading-warn small" style={{ marginBottom: 8 }}>“{(label ?? metric).trim()}”在 {results[ci]?.config_name} 中不存在（这个配置没有该类群）。请切换“{cmp === "value" ? "配置" : "基准"}”，或换一个指标。</div>}
            <div className={`figure-with-reading ${readOpen ? "" : "closed"}`}>
              <MapCanvas box={study.box} cell={study.res} points={points} varName={varName} diverging={cmp !== "value"} range={range} units={unit} height={520}
                onPointClick={(p, at) => setCellSel({ point: { lat: p.lat, lon: p.lon }, at })} selected={cellSel?.point}
                title={`${(label ?? "").trim()}${cmp === "value" ? ` · ${results[ci]?.config_name}` : cmp === "diff" ? `：${results[cj]?.config_name} − ${results[ci]?.config_name}` : `：${results[cj]?.config_name} 相对 ${results[ci]?.config_name} 的变化`}`} />
              {readOpen && <div>
              <FigureReading metric={metric} label={label ?? metric} unit={metric.startsWith("monthly:") ? "" : meta[metric]?.units ?? ""} mode={cmp}
                pairs={pairs} nameA={results[ci]?.config_name} nameB={results[cj]?.config_name}
                descA={cfgOf(results[ci])?.description} descB={cfgOf(results[cj])?.description}
                pairKey={pairKeyOf(cfgOf(results[ci]), cfgOf(results[cj]))} boxes={boxes.data ?? []}
                chg={chg} otherLabels={Object.fromEntries(Object.entries(meta).map(([k, m]: any) => [k, m.label]))} res={study.res} years={study.years} />
              </div>}
            </div>
          </div>
          </>}
        </>
      )}
    </>
  );
}

function avg(a?: (number | null)[]): number | null {
  const v = (a ?? []).filter((x): x is number => x != null && isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
