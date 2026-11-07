import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { MapCanvas } from "../components/MapCanvas";
import { Plot, colorscaleFor, seriesColor } from "../components/Plot";
import { SitePicker, siteNotes } from "../components/SitePicker";
import { Term } from "../components/Term";
import { Btn, Empty, Icon, Loading, Modal, Notice, Progress, Select, Seg, Split, StatusBadge, Tabs, fmtLatLon, useAsync, HelpLink } from "../components/ui";
import { useApp } from "../store";

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
type Tab = "map" | "meteo" | "woa" | "grid";

export default function SitePage() {
  const { project, jobs, refreshProject } = useApp();
  const p = project!;
  const siteJob = Object.values(jobs).find((j) => j.project === p.id && j.kind === "site" && (j.status === "running" || j.status === "queued"));
  const forcing = useAsync(() => (p.site_status === "ready" ? api.get(`/projects/${p.id}/site/forcing`) : Promise.resolve(null)), [p.id, p.site_status]);
  const [tab, setTab] = useState<Tab>("map");
  const [edit, setEdit] = useState(false);
  const [moveTo, setMoveTo] = useState<{ lat: number; lon: number } | null>(null);
  const site = p.site_info || p.site;
  const kindLabel = { generated: "开放数据生成", gotm_case: "GOTM 官方算例", imported: "导入的 GOTM 设置" }[site.kind as string] ?? site.kind;

  return (
    <div className="page fill">
      <div className="page-header">
        <div>
          <div className="row"><div className="page-title">站点与物理</div><HelpLink chapter="02-water-column" title="一维水柱物理（教程）" /></div>
        </div>
        <div className="page-actions">
          <StatusBadge status={siteJob ? "building" : p.site_status} />
          <Btn icon="edit" onClick={() => { setMoveTo(null); setEdit(true); }}>更换站点</Btn>
          <Btn icon="refresh" disabled={!!siteJob} onClick={async () => { await api.post(`/projects/${p.id}/site/build`); refreshProject(); }}>{p.site_status === "ready" ? "重新构建" : "构建站点"}</Btn>
        </div>
      </div>
      {siteJob && (
        <div className="panel panel-pad">
          <div className="row"><Icon name="loading" spin /><b className="grow">{siteJob.message || "准备中…"}</b><span className="soft num">{Math.round(siteJob.progress * 100)}%</span></div>
          <Progress value={siteJob.progress} style={{ marginTop: 8 }} />
          <div className="hint" style={{ marginTop: 6 }}>首次构建需要下载 ERA5 小时数据和 WOA23 月气候态剖面，约 1–4 分钟；之后使用缓存。</div>
        </div>
      )}
      {p.site_status === "error" && <Notice kind="danger">站点构建失败：{p.site_error}。请检查网络后重试，或改用离线演示站点。</Notice>}

      <Split id="site" label="站点信息与模拟设置" initial={360} min={300} max={480} side={
        <div className="split-scroll">
          <div className="tree-head">站点</div>
          <div style={{ padding: "4px 16px 14px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-strong)" }}>{site.name}</div>
            <div className="soft small" style={{ marginBottom: 10 }}>{kindLabel}</div>
            <div className="kv small">
              <span className="k">位置</span><span className="v num">{fmtLatLon(site.lat, site.lon, 3)}</span>
              <span className="k">水深</span><span className="v num">{site.depth ?? "?"} m</span>
              <span className="k">强迫年份</span><span className="v num">{site.forcing_years?.join(" – ")}</span>
              {site.woa_cell && <><span className="k">WOA 格点</span><span className="v num">{fmtLatLon(site.woa_cell[0], site.woa_cell[1], 1)}</span></>}
              {site.sources && Object.entries(site.sources).map(([k, v]) => (
                <Fragment key={k}><span className="k">{{ meteo: "气象", profiles: "剖面", depth: "水深" }[k] ?? k}</span><span className="v">{String(v)}</span></Fragment>
              ))}
            </div>
            {p.site.note && <div className="soft small" style={{ marginTop: 10, lineHeight: 1.6 }}>{p.site.note}</div>}
            {site.lat != null && <div className="reading" style={{ fontSize: 12.5, marginTop: 10 }}><ul>{siteNotes(site.lat, site.lon, site.depth).map((x, i) => <li key={i} className={x.warn ? "reading-warn" : undefined}>{x.text}</li>)}</ul></div>}
          </div>
          <SimSettings />
        </div>
      }>
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: "map", label: "位置", icon: "map" },
          { id: "meteo", label: "气象强迫", icon: "cloud", hidden: !forcing.data?.meteo },
          { id: "woa", label: "气候态剖面", icon: "layers", hidden: !forcing.data?.woa },
          { id: "grid", label: "垂向网格", icon: "list-flat" },
        ]} />
        <div className="split-scroll" style={{ padding: 16 }}>
          {tab === "map" && <div style={{ padding: 16 }}>
            <MapCanvas box={[Math.floor(site.lat - 7), Math.ceil(site.lat + 7), Math.floor(site.lon - 12), Math.ceil(site.lon + 12)]} marker={{ lat: site.lat, lon: site.lon }} height={540}
              onPick={(lat, lon) => { setMoveTo({ lat: +lat.toFixed(2), lon: +lon.toFixed(2) }); setEdit(true); }} />
            <div className="soft small" style={{ marginTop: 4 }}>鼠标悬停显示坐标与水深；点击地图上的其他位置，可以把站点移到那里。</div>
          </div>}
          {tab === "meteo" && (forcing.loading ? <Loading /> : forcing.data?.meteo ? <MeteoChart m={forcing.data.meteo} /> : <Empty icon="cloud" title="没有 ERA5 图表">该站点使用 GOTM 算例自带的强迫文件。</Empty>)}
          {tab === "woa" && forcing.data?.woa && <WoaView w={forcing.data.woa} depth={site.depth} />}
          {tab === "grid" && <GridView depth={site.depth ?? 80} nlev={p.simulation.nlev} />}
        </div>
      </Split>
      {edit && <SiteEditor at={moveTo} onClose={() => { setEdit(false); setMoveTo(null); }} />}
    </div>
  );
}

function SimSettings() {
  const { project, refreshProject, toast } = useApp();
  const p = project!;
  const [s, setS] = useState<any>(p.simulation);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setS(p.simulation); setDirty(false); }, [p.id, p.simulation]);
  const fy = (p.site_info || p.site).forcing_years || [2014, 2014];
  const total = s.mode === "repeat" ? (+s.years || 1) + (+s.spinup_years || 0) : (Math.min(s.period?.[1] ?? fy[1], fy[1]) - Math.max(s.period?.[0] ?? fy[0], fy[0]) + 1) + (+s.spinup_years || 0);
  const set = (k: string, v: any) => { setS({ ...s, [k]: v }); setDirty(true); };
  const save = async () => { await api.patch(`/projects/${p.id}`, { simulation: s }); toast("模拟设置已保存（下次运行生效）", "ok"); refreshProject(); };
  const num = (k: string, label: string, unit?: string, opt?: any) => (
    <><span className="label"><Term k={label.replace(/^(温盐|营养盐) ?/, "")}>{label}</Term></span><span className="control"><input className="input num" type="number" value={s[k] ?? ""} onChange={(e) => set(k, e.target.value === "" ? null : +e.target.value)} {...opt} />{unit && <span className="unit">{unit}</span>}</span></>
  );
  return (
    <div style={{ borderTop: "1px solid var(--border)" }}>
      <div className="tree-head">模拟设置<span className="actions"><span className="soft" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>{total} 个模拟年</span></span></div>
      <div style={{ padding: "4px 16px 16px" }}>
        <Seg value={s.mode} options={[["repeat", "重复同一年的气象"], ["period", "真实年份序列"]]} onChange={(v) => set("mode", v)} />
        <div className="form" style={{ gridTemplateColumns: "100px minmax(0,1fr)", marginTop: 12 }}>
          {s.mode === "repeat" ? <>{num("repeat_year", "强迫年")}{num("years", "分析年数", "年", { min: 1 })}</> : (
            <>
              <span className="label">时段</span>
              <span className="control">
                <input className="input num" type="number" value={s.period?.[0] ?? fy[0]} onChange={(e) => set("period", [+e.target.value, s.period?.[1] ?? fy[1]])} />–
                <input className="input num" type="number" value={s.period?.[1] ?? fy[1]} onChange={(e) => set("period", [s.period?.[0] ?? fy[0], +e.target.value])} />
              </span>
              {num("analysis_from", "分析起始", "年")}
            </>
          )}
          {num("spinup_years", "预热", "年", { min: 0 })}
          {num("nlev", "垂向层数", "层", { min: 5 })}
          {num("dt", "时间步长", "s")}
          {num("relax_ts_days", "温盐松弛", "天")}
          {num("relax_nut_days", "营养盐松弛", "天")}
          <span className="label">营养盐松弛</span>
          <span className="control"><Select value={s.relax_nutrients === false ? "0" : "1"} onChange={(v) => set("relax_nutrients", v === "1")}><option value="1">开（WOA23）</option><option value="0">关</option></Select></span>
          <span className="label"><Term k="潮流混合" /></span>
          <span className="control"><Select value={String(s.tide_scale ?? 1)} onChange={(v) => set("tide_scale", +v)}>
            <option value="0">无潮（如地中海、波罗的海）</option><option value="0.5">弱</option><option value="1">中等（北海中部，默认）</option><option value="2">强（如东海、乔治浅滩）</option><option value="3">很强（大潮差海湾）</option>
          </Select></span>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>一维模型没有真实潮汐，用周期性的水平压强梯度模拟 M2 潮流带来的底层湍流混合。潮流越强，浅水越容易全年混合、不形成层化。</div>
        <div className="row" style={{ marginTop: 12 }}>
          <Btn variant="primary" size="sm" icon="save" disabled={!dirty} onClick={save}>保存设置</Btn>
          {dirty && <span className="warn-text small">未保存</span>}
        </div>
        <div className="hint" style={{ marginTop: 10, lineHeight: 1.6 }}>
          重复同一年气象：预热年数越多越接近稳态；快速试算可用 4 年预热，研究用途建议 10–20 年。真实年份序列：用于研究年际变化，前几年作为预热。
        </div>
      </div>
    </div>
  );
}

function MeteoChart({ m }: { m: any }) {
  const dark = useApp((s) => s.dark);
  const panels: [string, string, string, number][] = [["airt", "2 m 气温", "°C", 9], ["swr", "向下短波辐射", "W m⁻²", 1], ["wind", "10 m 风速", "m s⁻¹", 0], ["cloud", "云量", "比例", 4]];
  const n = panels.length, gap = 0.035, h = (1 - gap * (n - 1)) / n;
  const data = panels.map(([k, name, , ci], i) => ({ x: m.date, y: m[k], name, type: "scatter", mode: "lines", line: { width: 1.1, color: seriesColor(ci, dark) }, xaxis: "x", yaxis: i ? `y${i + 1}` : "y", hovertemplate: `%{x}<br>${name} %{y}<extra></extra>` }));
  const layout: any = { showlegend: false, margin: { l: 66, r: 20, t: 10, b: 36 }, xaxis: { anchor: `y${n}` }, hovermode: "x unified" };
  panels.forEach(([, name, unit], i) => {
    layout[i ? `yaxis${i + 1}` : "yaxis"] = { domain: [1 - (i + 1) * h - i * gap, 1 - i * gap - i * h], title: { text: `${name}<br><span style="font-size:10px">${unit}</span>` } };
  });
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="muted small">这里画的是 ERA5 气象再分析的日平均值。风把海水搅匀；阳光和气温决定海面得到或失去多少热量。两者一起决定水柱什么时候分层、春季藻华什么时候出现。</div>
      <Plot height={620} data={data} layout={layout} />
    </div>
  );
}

function WoaView({ w, depth }: { w: any; depth?: number }) {
  const dark = useApp((s) => s.dark);
  const [v, setV] = useState("temperature");
  const [mode, setMode] = useState<"section" | "profiles">("section");
  const meta: Record<string, [string, string, string]> = {
    temperature: ["温度", "°C", "temp"], salinity: ["盐度", "PSU", "salt"], nitrate: ["硝酸盐", "mmol N m⁻³", "N3_n"],
    phosphate: ["磷酸盐", "mmol P m⁻³", "N1_p"], silicate: ["硅酸盐", "mmol Si m⁻³", "N5_s"], oxygen: ["溶解氧", "mmol O₂ m⁻³", "O2_o"],
  };
  const z = useMemo(() => (w[v] ?? []).length ? w.depth.map((_: number, k: number) => w[v].map((prof: number[]) => prof[k])) : [], [w, v]);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row">
        <Select value={v} onChange={setV}>{Object.entries(meta).filter(([k]) => w[k]).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Seg value={mode} options={[["section", "月 × 深度", "symbol-color"], ["profiles", "逐月剖面", "graph-line"]]} onChange={setMode} />
        <span className="soft small grow">World Ocean Atlas 2023 的多年月平均剖面。模拟从它开始，之后也一直被它轻轻“拉住”（松弛），弥补一维模型没有海流补给的缺陷。</span>
      </div>
      {mode === "section" ? (
        <Plot height={460} data={[{ type: "heatmap", x: MONTHS, y: w.depth, z, colorscale: colorscaleFor(meta[v][2], dark), colorbar: { title: { text: meta[v][1], side: "right" }, thickness: 12, len: 0.9 }, hovertemplate: "%{x} %{y} m<br>%{z:.3f}<extra></extra>", zsmooth: "best" },
          { type: "contour", x: MONTHS, y: w.depth, z, showscale: false, contours: { coloring: "none", showlabels: true, labelfont: { size: 10, color: dark ? "#ddd" : "#333" } }, line: { color: dark ? "rgba(255,255,255,.45)" : "rgba(0,0,0,.35)", width: 0.8 }, hoverinfo: "skip" }]}
          layout={{ yaxis: { autorange: "reversed", title: { text: "深度 (m)" } }, margin: { l: 60, r: 10, t: 14, b: 36 }, title: { text: `${meta[v][0]}（${meta[v][1]}）` } }} />
      ) : (
        <Plot height={460} data={(w[v] ?? []).map((prof: number[], m: number) => ({
          x: prof, y: w.depth, type: "scatter", mode: "lines", name: MONTHS[m], line: { width: 1.6, color: `hsl(${220 - (Math.cos(((m - 1) / 12) * 2 * Math.PI) * 0.5 + 0.5) * 200}, 65%, ${dark ? 62 : 45}%)` },
        }))} layout={{ yaxis: { autorange: "reversed", title: { text: "深度 (m)" } }, xaxis: { title: { text: meta[v][1] } }, legend: { orientation: "v", x: 1.02, y: 1 }, margin: { r: 90 } }} />
      )}
    </div>
  );
}

function GridView({ depth, nlev }: { depth: number; nlev: number }) {
  const h = depth / nlev;
  const centers = Array.from({ length: nlev }, (_, i) => (i + 0.5) * h);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="muted small">模型把水柱从海面到海底分成 {nlev} 层（每层约 {h.toFixed(2)} m）。层分得越细，越能看清温跃层和次表层的叶绿素高值，但计算更慢。一般每层 1 m 左右就够了。</div>
      <Plot height={460} data={[
        { type: "bar", orientation: "h", y: centers, x: centers.map(() => h), marker: { color: "rgba(10,102,194,.25)", line: { color: "rgba(10,102,194,.8)", width: 0.6 } }, width: centers.map(() => h * 0.92), hovertemplate: "层中心 %{y:.2f} m<br>厚度 %{x:.2f} m<extra></extra>" },
      ]} layout={{ yaxis: { autorange: "reversed", title: { text: "深度 (m)" }, range: [depth, 0] }, xaxis: { title: { text: "层厚 (m)" }, range: [0, h * 1.6] }, showlegend: false, bargap: 0 }} />
    </div>
  );
}

function SiteEditor({ onClose, at }: { onClose: () => void; at?: { lat: number; lon: number } | null }) {
  const { project, refreshProject, toast } = useApp();
  const p = project!;
  const [mode, setMode] = useState<"generated" | "case" | "import">("generated");
  const [s, setS] = useState<any>(at ? { ...p.site, kind: "generated", lat: at.lat, lon: at.lon, depth: null, name: fmtLatLon(at.lat, at.lon, 1) } : { ...p.site, kind: "generated" });
  const [path, setPath] = useState("");
  const save = async (site: any) => {
    if (!confirm("更换站点会删除已下载的气象和剖面数据并重新下载；已有的运行结果会保留。继续吗？")) return;
    await api.patch(`/projects/${p.id}`, { site });
    await api.post(`/projects/${p.id}/site/build`);
    toast("站点已更新，正在重新构建", "ok");
    refreshProject();
    onClose();
  };
  return (
    <Modal title="更换站点" icon="location" onClose={onClose} width={980} footer={<>
      <Btn onClick={onClose}>取消</Btn>
      {mode === "generated" && <Btn variant="primary" icon="cloud-download" onClick={() => save({ ...s, kind: "generated" })}>用开放数据生成</Btn>}
      {mode === "case" && <Btn variant="primary" icon="plug" onClick={() => save({ kind: "gotm_case", case: "nns_annual", name: "北海北部 PROVESS 1998（离线算例）" })}>使用离线算例</Btn>}
      {mode === "import" && <Btn variant="primary" icon="folder-opened" disabled={!path} onClick={() => save({ kind: "imported", path, name: path.split("/").pop() })}>导入目录</Btn>}
    </>}>
      <div className="col" style={{ gap: 12 }}>
        <Seg value={mode} options={[["generated", "任意海域（ERA5 + WOA23 + ETOPO）", "globe"], ["case", "离线算例", "plug"], ["import", "导入 GOTM 目录", "folder"]]} onChange={setMode} />
        {mode === "generated" && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 240px", gap: 22 }}>
            <SitePicker lat={s.lat ?? 56} lon={s.lon ?? 3} onChange={(lat, lon, n) => setS({ ...s, lat, lon, depth: null, name: n ?? fmtLatLon(lat, lon, 1) })} height={360} />
            <div className="col" style={{ gap: 10 }}>
              <div className="field"><label>名称</label><input className="input" value={s.name ?? ""} onChange={(e) => setS({ ...s, name: e.target.value })} /></div>
              <div className="field"><label>水深 m（留空 = ETOPO）</label><input className="input num" type="number" value={s.depth ?? ""} onChange={(e) => setS({ ...s, depth: e.target.value ? +e.target.value : null })} /></div>
              <div className="field"><label>气象年份</label>
                <div className="row"><input className="input num" style={{ width: "100%" }} type="number" value={s.forcing_years?.[0] ?? 2014} onChange={(e) => setS({ ...s, forcing_years: [+e.target.value, s.forcing_years?.[1] ?? 2014] })} />–<input className="input num" style={{ width: "100%" }} type="number" value={s.forcing_years?.[1] ?? 2014} onChange={(e) => setS({ ...s, forcing_years: [s.forcing_years?.[0] ?? 2014, +e.target.value] })} /></div>
              </div>
              <div className="soft small" style={{ lineHeight: 1.6 }}>同一年：反复使用该年的气象做到稳态；不同年：真实年份序列。ERA5 可用 1940 年至今。</div>
            </div>
          </div>
        )}
        {mode === "case" && <Notice kind="plain">使用 GOTM 官方北海北部算例（PROVESS 1998，59.33°N 1.28°E，110 m）自带的气象与剖面，不需要联网。</Notice>}
        {mode === "import" && (
          <div className="col">
            <div className="field"><label>GOTM 设置目录（需包含 gotm.yaml）</label><input className="input mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/…/ecosmo-e2e/testcases/central_north_sea" /></div>
          </div>
        )}
      </div>
    </Modal>
  );
}
