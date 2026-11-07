import { useEffect, useState } from "react";
import { api } from "../api";
import { MapCanvas } from "../components/MapCanvas";
import { Btn, Icon, IconBtn, Logo, Modal, StatusBadge, fmtLatLon, useAsync } from "../components/ui";
import { SitePicker, siteNotes } from "../components/SitePicker";
import { Term } from "../components/Term";
import { HOST_LABEL, HTL_LABEL, Page, useApp } from "../store";


export default function HomePage() {
  const { project } = useApp();
  const [showNew, setShowNew] = useState(false);
  const [initial, setInitial] = useState<{ lat: number; lon: number; name?: string } | null>(null);
  useEffect(() => {
    // other pages (e.g. a clicked shelf column) can open the dialog at a given point
    const h = (e: Event) => { setInitial((e as CustomEvent).detail ?? null); setShowNew(true); };
    window.addEventListener("new-project", h);
    return () => window.removeEventListener("new-project", h);
  }, []);
  return (
    <>
      {project ? <ProjectHub onNew={() => setShowNew(true)} /> : <Welcome onNew={() => setShowNew(true)} />}
      {showNew && <NewProject initial={initial} onClose={() => { setShowNew(false); setInitial(null); }} />}
    </>
  );
}

function Welcome({ onNew }: { onNew: () => void }) {
  const { projects, openProject, setPage } = useApp();
  return (
    <div className="page" style={{ maxWidth: 980, paddingTop: 56 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 30, fontWeight: 300, color: "var(--fg-strong)" }}><Logo size={38} />Shoal</div>
      <div className="muted" style={{ marginBottom: 36 }}>浅海生态模拟工作台：从营养盐、浮游生物一直算到鱼，全球任意陆架海都能研究</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 48 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 10 }}>开始</div>
          <button className="action-tile" onClick={onNew}><Icon name="new-folder" className="lead" /><span><span className="t">新建项目…</span><span className="d">在世界地图上选海区，选择要研究的问题</span></span></button>
          <button className="action-tile" onClick={() => setPage("primer", { chapter: "00-guide" })}><Icon name="book" className="lead" /><span><span className="t">软件使用说明</span><span className="d">从站点到结果的完整流程</span></span></button>
          <button className="action-tile" onClick={() => setPage("primer")}><Icon name="mortar-board" className="lead" /><span><span className="t">入门教程</span><span className="d">水柱物理、NPZD、粒径谱、功能群、耦合</span></span></button>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 10 }}>最近的项目</div>
          {!projects.length ? <div className="soft">还没有项目</div> : projects.map((p) => (
            <button key={p.id} className="action-tile" onClick={() => openProject(p.id)}>
              <Icon name="folder" className="lead" />
              <span className="grow"><span className="t">{p.name}</span><span className="d">{p.site?.name} · {p.n_runs ?? 0} 次运行</span></span>
              <StatusBadge status={p.site_status} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Step { n: number; page: Page; title: string; state: "done" | "todo" | "busy" | "warn" | "optional"; facts: React.ReactNode; action: string; onAction?: () => void }

function ProjectHub({ onNew }: { onNew: () => void }) {
  const { project, projects, openProject, setPage, revision, jobs, refreshProjects, toast, setSelectedRuns } = useApp();
  const p = project!;
  const cfgs = useAsync(() => api.get<any[]>(`/projects/${p.id}/configs`), [p.id, revision]);
  const exps = useAsync(() => api.get<any[]>(`/projects/${p.id}/experiments`), [p.id, revision]);
  const runs = useAsync(() => api.get<any[]>(`/projects/${p.id}/runs`), [p.id, revision]);
  const shelves = useAsync(() => api.get<any[]>(`/projects/${p.id}/shelf`), [p.id, revision]);
  const site = p.site_info || p.site;
  const rs = runs.data ?? [];
  const done = rs.filter((r) => r.status === "done");
  const busy = Object.values(jobs).filter((j) => j.project === p.id && (j.status === "running" || j.status === "queued"));
  const siteJob = busy.find((j) => j.kind === "site");
  const hosts = Array.from(new Set((cfgs.data ?? []).map((c) => HOST_LABEL[c.spec.host])));
  const htls = Array.from(new Set((cfgs.data ?? []).map((c) => HTL_LABEL[c.spec.htl.kind])));
  const sim = p.simulation;
  const simYears = sim.mode === "repeat" ? `${sim.repeat_year} 年强迫重复 ${(+sim.years || 1) + (+sim.spinup_years || 0)} 年（末 ${sim.years} 年分析）` : `${sim.period?.[0]}–${sim.period?.[1]}，预热 ${sim.spinup_years ?? 0} 年`;
  const steps: Step[] = [
    { n: 1, page: "site", title: "站点与物理", state: p.site_status === "ready" ? "done" : p.site_status === "building" ? "busy" : "warn",
      facts: <>{site.name} · {site.lat != null ? fmtLatLon(site.lat, site.lon) : ""} · {site.depth ?? "?"} m · {sim.nlev} 层 · {simYears}
        {p.site_status === "building" && siteJob && <div className="small" style={{ color: "var(--accent)", marginTop: 2 }}>正在构建：{siteJob.message ?? "…"}（{Math.round((siteJob.progress ?? 0) * 100)}%）</div>}
        {p.site_status === "error" && <div className="small" style={{ color: "var(--danger)", marginTop: 2 }}>上次构建失败：{String(p.site_error ?? "").slice(0, 160)}。点“重新构建”重试。</div>}</>,
      action: p.site_status === "ready" ? "查看" : p.site_status === "error" ? "重新构建" : "构建站点" },
    { n: 2, page: "foodweb", title: "食物网配置", state: (cfgs.data?.length ?? 0) > 0 ? "done" : "todo",
      facts: <>{cfgs.data?.length ?? 0} 个配置 · 宿主 {hosts.join(" / ") || "–"} · {htls.join(" / ") || "–"}</>, action: "编辑" },
    { n: 3, page: "experiments", title: "实验与运行", state: busy.some((j) => j.kind === "run") ? "busy" : done.length ? "done" : "todo",
      facts: <>{exps.data?.length ?? 0} 组实验 · 完成 {done.length} / {rs.length} 次运行{busy.filter((j) => j.kind === "run").length ? ` · ${busy.filter((j) => j.kind === "run").length} 次运行进行中` : ""}{rs.some((r) => r.status === "failed") ? ` · ${rs.filter((r) => r.status === "failed").length} 次失败` : ""}</>,
      action: done.length || rs.length ? "继续运行" : `全部运行（${(exps.data ?? []).reduce((n, e) => n + (e.items?.length ?? 0), 0)} 次）`,
      // first visit: start every experiment of the template in one click, then show the queue
      onAction: rs.length || p.site_status !== "ready" ? undefined : async () => {
        try {
          let n = 0;
          for (const e of exps.data ?? []) n += (await api.post<any[]>(`/projects/${p.id}/experiments/${e.id}/run`, {})).length;
          toast(`已提交 ${n} 次运行，可以在“实验与运行”中查看进度`, "ok");
        } catch (err: any) { toast(String(err.message), "bad"); }
        setPage("experiments");
      } },
    { n: 4, page: "results", title: "结果分析与图版", state: done.length ? "done" : "todo",
      facts: done.length ? <>可分析 {done.length} 次运行：指标对比、时间–深度矩阵、年循环、差值、粒径谱、食物网差异</> : <>需要至少一次完成的运行</>,
      action: "打开" },
    { n: 5, page: "results", title: "模型验证与稳态检查", state: done.length ? "optional" : "todo",
      facts: <>与 WOA23 气候态比较温盐与营养盐（偏差、RMSE、相关、Taylor 图）；检查预热是否达到稳态</>, action: "验证",
      onAction: () => { if (done[0]) setSelectedRuns([done[0].id]); setPage("results"); setTimeout(() => window.dispatchEvent(new CustomEvent("results-tab", { detail: "validate" })), 50); } },
    { n: 6, page: "shelf", title: "三维陆架（可选）", state: (shelves.data ?? []).some((s) => s.status === "done") ? "done" : (shelves.data ?? []).some((s) => s.status === "running") ? "busy" : "optional",
      facts: <>{shelves.data?.length ?? 0} 项陆架研究 · 水柱集合，空间分布图与区域统计</>, action: "打开" },
  ];
  const stateIcon = { done: ["pass-filled", "var(--ok)"], todo: ["circle-large-outline", "var(--fg-soft)"], busy: ["loading", "var(--accent)"], warn: ["warning", "var(--warn)"], optional: ["circle-large-outline", "var(--fg-soft)"] } as const;
  const notes = site?.lat != null ? siteNotes(site.lat, site.lon, site.depth) : [];
  // the first unfinished step is "next"; while it is still running nothing is highlighted
  const firstOpen = steps.findIndex((x) => x.state !== "done" && x.state !== "optional");
  const nextIdx = firstOpen >= 0 && steps[firstOpen].state !== "busy" ? firstOpen : -1;
  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <div className="page-header">
        <div>
          <div className="page-title">{p.name}</div>
          <div className="page-hint">{p.description}</div>
          {p.paper && <div className="soft small" style={{ marginTop: 2, fontStyle: "italic" }}>方法参考：{p.paper}</div>}
        </div>
        <div className="page-actions"><Btn icon="new-folder" onClick={onNew}>新建项目…</Btn></div>
      </div>
      <div className="hub">
        <section>
          <div className="sec-title">研究流程<span className="soft">按顺序完成，每一步都可以回来修改</span></div>
          <div className="steps">
            {steps.map((s, i) => {
              const [ic, col] = stateIcon[s.state];
              return (
                <div key={s.n} className={`step ${i === nextIdx ? "next" : ""}`}>
                  <span className="step-mark" style={{ color: col }}><Icon name={ic} spin={s.state === "busy"} /></span>
                  <div className="grow">
                    <div className="step-title"><span className="step-n">{s.n}</span>{s.title}{i === nextIdx && <span className="step-next">下一步</span>}</div>
                    <div className="step-facts">{s.facts}</div>
                  </div>
                  <Btn size="sm" variant={i === nextIdx ? "primary" : "ghost"}
                    onClick={async () => {
                      if (s.onAction) return s.onAction();
                      if (s.n === 1 && p.site_status !== "ready" && p.site_status !== "building") await api.post(`/projects/${p.id}/site/build`);
                      if (s.n === 4 && done.length) setSelectedRuns(done.slice(0, 3).map((r) => r.id));
                      setPage(s.page);
                    }}>{s.action}</Btn>
                </div>
              );
            })}
          </div>
        </section>
        <aside className="col" style={{ gap: 26 }}>
          <section>
            <div className="sec-title">站点<span className="soft">{site.name}</span></div>
            {site?.lat != null && <MapCanvas box={[Math.floor(site.lat - 7), Math.ceil(site.lat + 7), Math.floor(site.lon - 11), Math.ceil(site.lon + 11)]} marker={{ lat: site.lat, lon: site.lon }} height={240} showBathyLegend={false} />}
            {site?.lat != null && <div className="soft small" style={{ marginTop: 6 }}>{fmtLatLon(site.lat, site.lon)} · 水深 {site.depth ?? "?"} m</div>}
            {notes.length > 0 && <div className="reading" style={{ fontSize: 12.5, marginTop: 6 }}><ul>{notes.slice(0, 3).map((x, i) => <li key={i} className={x.warn ? "reading-warn" : undefined}>{x.text}</li>)}</ul></div>}
          </section>
          <section>
            <div className="sec-title">最近运行<span className="grow" /><a className="link small" onClick={() => setPage("experiments")}>全部</a></div>
            <div className="plain-list">
              {rs.slice(0, 5).map((r) => (
                <div key={r.id} className="row"><StatusBadge status={r.status} /><span className="grow ellipsis">{r.label}</span><span className="soft small num">{(r.created || "").slice(5, 16).replace("T", " ")}</span></div>
              ))}
              {!rs.length && <div className="soft small">还没有运行</div>}
            </div>
          </section>
          <section>
            <div className="sec-title">其他项目<span className="grow" /><IconBtn icon="refresh" title="刷新" size="sm" onClick={() => refreshProjects()} /></div>
            <div className="plain-list">
              {projects.filter((x) => x.id !== p.id).map((x) => (
                <div key={x.id} className="row hover" onClick={() => openProject(x.id)}>
                  <span className="grow ellipsis" title={x.site?.name}>{x.name}</span>
                  <IconBtn icon="trash" title="移到回收站" danger size="sm" onClick={async (e) => { e.stopPropagation(); if (!confirm(`将项目“${x.name}”移到回收站（workspace/trash）？`)) return; await api.del(`/projects/${x.id}`); toast("已移到回收站", "ok"); refreshProjects(); }} />
                </div>
              ))}
              {projects.length <= 1 && <div className="soft small">没有其他项目</div>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function NewProject({ onClose, initial }: { onClose: () => void; initial?: { lat: number; lon: number; name?: string } | null }) {
  const { refreshProjects, openProject, setPage, toast } = useApp();
  const t = useAsync(() => api.get("/templates"), []);
  const designs: any[] = t.data?.designs ?? [];
  const hostNames: Record<string, string> = t.data?.hosts ?? { ersem: "ERSEM", ecosmo: "ECOSMO", ergom: "ERGOM" };
  const [chosen, setChosen] = useState<string[]>(["topdown"]);
  const [hosts, setHosts] = useState<string[]>(["ersem"]);
  const [name, setName] = useState("");
  const [loc, setLoc] = useState(initial ? { lat: initial.lat, lon: initial.lon, label: initial.name ?? "" } : { lat: 56.0, lon: 3.0, label: "北海中部" });
  const [years, setYears] = useState<[number, number]>([2014, 2014]);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggle = (arr: string[], x: string) => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);
  // how many runs the chosen designs create (shared configurations are counted once by the backend; this is the experiment total)
  const runs = chosen.reduce((n, id) => {
    const d = designs.find((x) => x.id === id);
    if (!d) return n;
    if (d.hosts === "ersem") return n + (d.runs ?? 1);
    if (d.hosts === "multi") return hosts.length >= 2 ? n + hosts.length : n;
    return n + (d.runs_per_host ?? 1) * hosts.length;
  }, 0);
  const needsMulti = chosen.includes("hosts") && hosts.length < 2;
  const advice = hostAdvice(loc.lat, loc.lon);
  const create = async () => {
    setBusy(true);
    try {
      const auto = offline ? "离线演示" : `${loc.label || fmtLatLon(loc.lat, loc.lon, 1)}：${designs.filter((d) => chosen.includes(d.id)).map((d) => d.label).slice(0, 2).join("、")}`;
      const body: any = { name: name || auto, designs: chosen, hosts, offline };
      if (!offline) {
        body.site = { kind: "generated", name: loc.label || fmtLatLon(loc.lat, loc.lon, 1), lat: loc.lat, lon: loc.lon, depth: null, forcing_years: years };
        body.simulation = years[0] === years[1] ? { mode: "repeat", repeat_year: years[1] } : { mode: "period", period: years, spinup_years: 2 };
      }
      const p = await api.post("/projects", body);
      await refreshProjects();
      await openProject(p.id);
      toast(offline ? "项目已创建（离线算例）" : "项目已创建，正在后台下载站点数据", "ok");
      onClose();
      setPage("home");
    } catch (e: any) { toast(String(e.message), "bad"); } finally { setBusy(false); }
  };
  return (
    <Modal title="新建项目" icon="new-folder" onClose={onClose} width={1140} footer={<>
      <span className="soft small grow">{offline ? "离线算例自带强迫数据，不需要联网。" : "创建后会在后台下载该位置的 ERA5 气象、WOA23 剖面和 ETOPO 水深，约 1–3 分钟。"}</span>
      <Btn onClick={onClose}>取消</Btn>
      <Btn variant="primary" icon={busy ? "loading" : "check"} spin={busy} disabled={busy || !chosen.length || !hosts.length || needsMulti} onClick={create}>创建项目（{runs} 次运行）</Btn>
    </>}>
      <div className="newproj">
        <section>
          <div className="sec-title"><span className="step-n">1</span>研究海区<span className="soft">全球任意陆架海</span><span className="grow" />
            <label className="row soft small" style={{ gap: 6, fontWeight: 400, cursor: "pointer" }}><input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} />没有网络：使用离线算例</label></div>
          {offline
            ? <div className="soft" style={{ padding: "40px 0", lineHeight: 1.7 }}>使用 GOTM 官方算例（北海北部 59.33°N 1.28°E，110 m，1998 年）自带的气象与剖面，不需要下载任何数据，适合课堂演示或无网络环境。</div>
            : <SitePicker lat={loc.lat} lon={loc.lon} onChange={(lat, lon, n) => setLoc({ lat, lon, label: n ?? "" })} height={330} />}
          {!offline && <div className="row wrap" style={{ gap: 12, marginTop: 10 }}>
            <span className="opt">站点名称<input className="input sm" value={loc.label} placeholder={fmtLatLon(loc.lat, loc.lon, 1)} onChange={(e) => setLoc({ ...loc, label: e.target.value })} style={{ width: 200 }} /></span>
            <span className="opt">气象年份<input className="input num sm" type="number" value={years[0]} onChange={(e) => setYears([+e.target.value, years[1]])} style={{ width: 70 }} />–<input className="input num sm" type="number" value={years[1]} onChange={(e) => setYears([years[0], +e.target.value])} style={{ width: 70 }} /></span>
            <span className="soft small">同一年：反复使用该年气象直到稳态；不同年：真实年份序列（研究年际变化）。</span>
          </div>}
        </section>
        <section>
          <div className="sec-title"><span className="step-n">2</span>要研究的问题<span className="soft">可多选，每项会生成一组对照实验</span></div>
          <div className="options">
            {designs.map((d) => (
              <label key={d.id} className={`option ${chosen.includes(d.id) ? "on" : ""}`}>
                <input type="checkbox" aria-label={d.label} checked={chosen.includes(d.id)} onChange={() => setChosen(toggle(chosen, d.id))} />
                <span>
                  <span className="t">{d.question}</span>
                  <span className="d"><b className="soft">{d.label}</b>　{d.description}</span>
                  {d.ref && <span className="d soft" style={{ fontStyle: "italic" }}>方法参考：{d.ref}</span>}
                </span>
              </label>
            ))}
          </div>
          <div className="sec-title" style={{ marginTop: 16 }}><span className="step-n">3</span>低营养级模型（<Term k="宿主" />）<span className="soft">负责营养盐和浮游生物；鱼类模块接在它上面</span></div>
          <div className="host-list">
            {Object.entries(hostNames).sort(([a], [b]) => HOST_ORDER.indexOf(a) - HOST_ORDER.indexOf(b)).map(([k, n]) => (
              <label key={k} className="host-row">
                <input type="checkbox" aria-label={n} checked={hosts.includes(k)} onChange={() => setHosts(toggle(hosts, k))} />
                <b>{n}</b>
                <span className="grow">{HOST_INFO[k]?.what}<span className="soft small">　参数调自{HOST_INFO[k]?.tuned}</span></span>
                {!offline && advice.pick === k && <span className="tag">推荐</span>}
              </label>
            ))}
          </div>
          <p className="soft small" style={{ margin: "6px 0 0", lineHeight: 1.65 }}>
            三个模型都可以用在全球任何海区：水温、混合和营养盐来自你选的站点数据，模型只描述生物怎么生长、被吃、死亡。
            “参数调自”是指参数最初在哪片海对照观测调出来的，换到别的海区后，请在“验证”页对照观测检查。{!offline && advice.text}
          </p>
          {needsMulti && <div className="reading-warn small" style={{ marginTop: 6 }}>“宿主模型对比”需要至少选择两个宿主。</div>}
          <div className="sec-title" style={{ marginTop: 16 }}><span className="step-n">4</span>项目名称</div>
          <input className="input" value={name} placeholder={offline ? "离线演示" : `${loc.label || fmtLatLon(loc.lat, loc.lon, 1)}：${designs.filter((d) => chosen.includes(d.id)).map((d) => d.label).slice(0, 2).join("、")}`} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
        </section>
      </div>
    </Modal>
  );
}

const HOST_ORDER = ["ersem", "ecosmo", "ergom"];

/** What each lower-trophic host is like, in one plain sentence, and where its parameters were tuned. */
const HOST_INFO: Record<string, { what: string; tuned: string }> = {
  ersem: { what: "过程最全：4 类浮游植物、3 类浮游动物、细菌、碳酸盐系统和海底沉积物。", tuned: "西北欧陆架" },
  ecosmo: { what: "中等复杂：2 类浮游植物、2 类浮游动物，算得快。", tuned: "北海和波罗的海" },
  ergom: { what: "最简洁：只有 1 类浮游动物，但缺氧、固氮蓝藻和富营养化刻画得好。", tuned: "波罗的海" },
};

/** Which host to start with at a given place, and why (plain language). */
function hostAdvice(lat: number, lon: number): { pick: string; text: string } {
  const baltic = lat >= 53.5 && lat <= 66 && lon > 13 && lon <= 30;
  const nwes = lat >= 48 && lat <= 62.5 && lon >= -12 && lon <= 13;
  if (baltic) return { pick: "ergom", text: "这里是波罗的海，ERGOM 的参数就是在这里调的，可以先用它。" };
  if (nwes) return { pick: "ersem", text: "这里在西北欧陆架，三个模型的参数都比较适用；鱼类模块也是在这里标定的。" };
  return { pick: "ersem", text: "这个海区三个模型都没有专门调过参数。建议先用过程最全的 ERSEM；如果关心缺氧或富营养化（例如大河口外），可以加选 ERGOM。同时选两三个模型并勾选“结论是否依赖所用的低营养级模型”，看结论在不同模型下是否一致，这是在新海区检验结果是否可靠的好办法。" };
}

