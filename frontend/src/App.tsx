import { Fragment, useEffect, useRef, useState } from "react";
import { api, connectEvents, on, onConnection } from "./api";
import { ConfirmHost, Icon, IconBtn, Loading, Logo, MenuEntry, MenuList, Modal, Progress, RightPane, StatusBadge, Toasts, TooltipLayer } from "./components/ui";
import { ask } from "./dialog";
import { Page, SIDE_COLLAPSED, SIDE_MAX, SIDE_MIN, useApp } from "./store";
import HomePage from "./pages/HomePage";
import SitePage from "./pages/SitePage";
import FoodWebPage from "./pages/FoodWebPage";
import ExperimentsPage from "./pages/ExperimentsPage";
import ResultsPage from "./pages/ResultsPage";
import ShelfPage from "./pages/ShelfPage";
import PrimerPage from "./pages/PrimerPage";
import { UpdateBanner, useAppInfo, useUpdateHash } from "./components/AppUpdate";
import SettingsPage from "./pages/SettingsPage";
import AssistantPanel from "./components/AssistantPanel";

const PAGES: { id: Page; label: string; icon: string; project?: boolean }[] = [
  { id: "home", label: "项目", icon: "home" },
  { id: "site", label: "站点与物理", icon: "location", project: true },
  { id: "foodweb", label: "食物网配置", icon: "type-hierarchy", project: true },
  { id: "experiments", label: "实验与运行", icon: "beaker", project: true },
  { id: "results", label: "结果分析", icon: "graph-line", project: true },
  { id: "shelf", label: "三维陆架", icon: "globe", project: true },
];
const BOTTOM: { id: Page; label: string; icon: string }[] = [
  { id: "primer", label: "入门教程", icon: "mortar-board" },
  { id: "settings", label: "设置", icon: "settings-gear" },
];
const SHORTCUTS: [string, string][] = [
  ["Ctrl/⌘ + 1…6", "切换工作流页面"], ["Ctrl/⌘ + N", "新建项目"], ["Ctrl/⌘ + B", "折叠 / 展开侧栏"],
  ["Ctrl/⌘ + J", "任务面板"], ["Ctrl/⌘ + Shift + A", "AI 助手"], ["Esc", "关闭对话框"],
];

export default function App() {
  const s = useApp();
  const { page, setPage, project, jobs, collapsed, panelOpen, setPanelOpen, assistantOpen, theme, setTheme } = s;
  const [conn, setConn] = useState("connecting");
  const finished = useRef({ ok: 0, bad: 0 });
  const [dialog, setDialog] = useState<"about" | "keys" | null>(null);
  // sidebar width while its edge is being dragged (null = not dragging, use the stored width)
  const [liveSide, setLiveSide] = useState<number | null>(null);
  const sideW = liveSide ?? (collapsed ? SIDE_COLLAPSED : s.sideWidth);
  const dragSide = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, start = collapsed ? SIDE_COLLAPSED : s.sideWidth;
    let result = start;
    document.body.classList.add("dragging");
    const move = (ev: MouseEvent) => { result = start + ev.clientX - x0; setLiveSide(Math.max(SIDE_COLLAPSED, Math.min(SIDE_MAX, result))); };
    const up = () => {
      document.body.classList.remove("dragging");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setLiveSide(null);
      if (result < (SIDE_COLLAPSED + SIDE_MIN) / 2) s.setCollapsed(true);  // dragged narrow: snap to the icon strip
      else { s.setSideWidth(result); if (collapsed) s.setCollapsed(false); }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  // narrow windows: fold the main sidebar to its icon strip when the window becomes narrower than 1280 px
  // (only on crossing, so a user who opens it again on a small screen keeps it open)
  useEffect(() => {
    let wide = window.innerWidth >= 1280;
    if (!wide && !useApp.getState().collapsed) s.setCollapsed(true);
    const on = () => { const w = window.innerWidth >= 1280; if (wide && !w && !useApp.getState().collapsed) s.setCollapsed(true); wide = w; };
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  // clicking the page you are on while the sidebar is an icon strip opens it, as in AVAS
  const navTo = (p: Page) => { if (p === page && collapsed) s.setCollapsed(false); else setPage(p); };

  useEffect(() => {
    setTheme(theme);
    connectEvents();
    s.loadStatic().catch(() => s.toast("无法连接计算服务：请在终端运行 pnpm dev（它会同时启动界面和计算服务，端口 8765）", "bad"));
    s.refreshProjects().catch(() => {});
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onMq = () => useApp.getState().theme === "auto" && setTheme("auto");
    mq?.addEventListener?.("change", onMq);
    const offs = [
      onConnection(setConn),
      on("hello", (p) => s.setJobs(p.jobs)),
      on("job", (j) => {
        s.upsertJob(j);
        if (j.status === "failed") s.toast(`${j.label}：失败 — ${String(j.error ?? "").slice(0, 160)}`, "bad");
        if (j.status === "done" && j.kind !== "run") s.toast(`${j.label}：完成`, "ok");
        // runs come in batches: one message when the last queued run of the batch has finished
        if (j.kind === "run" && ["done", "failed"].includes(j.status)) {
          finished.current[j.status === "done" ? "ok" : "bad"]++;
          const busy = Object.values(useApp.getState().jobs).some((x: any) => x.kind === "run" && ["queued", "running"].includes(x.status));
          if (!busy) {
            const { ok, bad } = finished.current;
            finished.current = { ok: 0, bad: 0 };
            if (ok) s.toast(`${ok} 次运行完成${bad ? `，${bad} 次失败` : ""}`, bad ? "bad" : "ok", { label: "查看结果", onClick: () => useApp.getState().setPage("results") });
          }
        }
        if (["done", "failed"].includes(j.status) && j.project === useApp.getState().projectId) s.refreshProject();
      }),
      on("project", () => s.refreshProject()),
    ];
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const st = useApp.getState();
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); st.toggleCollapsed(); }
      else if (k === "j") { e.preventDefault(); st.setPanelOpen(!st.panelOpen); }
      else if (k === "a" && e.shiftKey) { e.preventDefault(); st.toggleAssistant(); }
      else if (k === "n" && !e.shiftKey) { e.preventDefault(); st.setPage("home"); setTimeout(() => window.dispatchEvent(new Event("new-project")), 30); }
      else if (/^[1-6]$/.test(e.key)) { e.preventDefault(); st.setPage(PAGES[+e.key - 1].id); }
    };
    window.addEventListener("keydown", key);
    return () => { offs.forEach((f) => f()); window.removeEventListener("keydown", key); mq?.removeEventListener?.("change", onMq); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { document.title = project ? `${project.name} — Shoal` : "Shoal"; }, [project?.name]);
  useUpdateHash();
  const appInfo = useAppInfo();

  const active = Object.values(jobs).filter((j) => j.status === "running" || j.status === "queued");
  const runningRuns = active.filter((j) => j.kind === "run").length;
  const meanProgress = active.length ? active.reduce((a, j) => a + (j.progress || 0), 0) / active.length : 0;
  const isProjectPage = PAGES.find((i) => i.id === page)?.project;
  const Pg = { home: HomePage, site: SitePage, foodweb: FoodWebPage, experiments: ExperimentsPage, results: ResultsPage, shelf: ShelfPage, primer: PrimerPage, settings: SettingsPage }[page] ?? HomePage;
  const k = s.kernel?.kernel;
  const stopAll = async () => { for (const j of active) await api.post(`/jobs/${j.id}/cancel`); };

  const menus: { label: string; items: () => MenuEntry[] }[] = [
    { label: "文件", items: () => [
      { label: "新建项目…", icon: "new-folder", shortcut: "Ctrl+N", onClick: () => { setPage("home"); setTimeout(() => window.dispatchEvent(new Event("new-project")), 30); } },
      { label: "打开项目", icon: "folder-opened", disabled: !s.projects.length, submenu: s.projects.map((p) => ({ label: p.name, checked: p.id === project?.id, onClick: () => s.openProject(p.id) })) },
      { label: "项目概览", icon: "home", disabled: !project, onClick: () => setPage("home") },
      { label: "关闭项目", icon: "close", disabled: !project, onClick: () => { setPage("home"); s.openProject(null); } },
      { label: "把当前项目移到回收站…", icon: "trash", disabled: !project, onClick: async () => {
        if (!project || !(await ask(`将项目“${project.name}”移到回收站（workspace/trash）？可以从那里手动恢复。`, { danger: true, ok: "移到回收站" }))) return;
        await api.del(`/projects/${project.id}`); s.toast("已移到回收站", "ok"); setPage("home"); await s.openProject(null); s.refreshProjects();
      } },
      { type: "separator" },
      { label: "设置…", icon: "settings-gear", onClick: () => setPage("settings") },
    ] },
    { label: "运行", items: () => [
      { label: "运行实验…", icon: "play", disabled: !project, onClick: () => setPage("experiments") },
      { label: "构建 / 更新站点数据", icon: "cloud-download", disabled: !project, onClick: async () => { if (project!.site_status === "ready" && !(await ask("重新下载并生成站点的气象、气候态和地形数据？已有的运行结果不受影响。", { ok: "重新构建" }))) return; await api.post(`/projects/${project!.id}/site/build`); s.refreshProject(); setPage("site"); } },
      { label: "陆架集合（三维）…", icon: "globe", disabled: !project, onClick: () => setPage("shelf") },
      { type: "separator" },
      { label: `停止全部任务${active.length ? `（${active.length}）` : ""}`, icon: "debug-stop", disabled: !active.length, danger: true, onClick: stopAll },
      { label: "任务面板", icon: "layout-panel", shortcut: "Ctrl+J", checked: panelOpen, onClick: () => setPanelOpen(!panelOpen) },
    ] },
    { label: "视图", items: () => [
      ...PAGES.map((p, i) => ({ label: p.label, shortcut: `Ctrl+${i + 1}`, checked: page === p.id, disabled: p.project && !project, onClick: () => setPage(p.id) })),
      { type: "separator" as const },
      { label: "折叠侧栏", shortcut: "Ctrl+B", checked: collapsed, onClick: s.toggleCollapsed },
      { label: "任务面板", shortcut: "Ctrl+J", checked: panelOpen, onClick: () => setPanelOpen(!panelOpen) },
      { label: "AI 助手", shortcut: "Ctrl+Shift+A", checked: assistantOpen, onClick: s.toggleAssistant },
      { type: "separator" as const },
      { label: "主题", submenu: ([["light", "浅色"], ["dark", "深色"], ["auto", "跟随系统"]] as const).map(([v, l]) => ({ label: l, checked: theme === v, onClick: () => setTheme(v) })) },
    ] },
    { label: "帮助", items: () => [
      { label: "入门教程", icon: "mortar-board", onClick: () => setPage("primer") },
      { label: "软件使用说明", icon: "book", onClick: () => setPage("primer", { chapter: "00-guide" }) },
      { label: "研究问题", icon: "note", submenu: [
        { label: "对照实验怎么设计、怎么读", onClick: () => setPage("primer", { chapter: "13-designs" }) },
        { label: "鱼的反馈要不要算：单向与双向", onClick: () => setPage("primer", { chapter: "09-paper1" }) },
        { label: "鱼和底栖的影响，换宿主还一样吗", onClick: () => setPage("primer", { chapter: "10-paper2" }) },
      ] },
      { label: "键盘快捷键", icon: "keyboard", onClick: () => setDialog("keys") },
      { type: "separator" },
      { label: "关于 Shoal", icon: "info", onClick: () => setDialog("about") },
    ] },
  ];

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <MenuBar menus={menus} title={project ? `${project.name} — Shoal` : "Shoal"}>
        <IconBtn icon="play" title="运行实验" disabled={!project} onClick={() => setPage("experiments")} />
        <IconBtn icon="debug-stop" title={active.length ? `停止全部任务（${active.length}）` : "没有运行中的任务"} disabled={!active.length} onClick={stopAll} />
        <span className="vsep" />
        <IconBtn icon={panelOpen ? "layout-panel" : "layout-panel-off"} title="任务面板（Ctrl+J）" onClick={() => setPanelOpen(!panelOpen)} />
        <span className="vsep" />
        <IconBtn icon="sparkle" title="AI 助手（Ctrl+Shift+A）" active={assistantOpen} onClick={s.toggleAssistant} />
      </MenuBar>

      <UpdateBanner />
      <div className="shell-body">
        <nav className={`activity ${liveSide == null ? "animate" : ""}`} style={{ width: sideW }}>
          <div className="side-head" data-tip={`计算内核 GOTM ${k?.gotm?.split(" ")[0] ?? "?"}`}>Shoal {appInfo?.version ?? "…"}</div>
          {PAGES.map((it) => (
            <div key={it.id} className={`nav-item ${page === it.id ? "active" : ""} ${it.project && !project ? "disabled" : ""}`} data-tip={collapsed ? it.label : undefined} onClick={() => navTo(it.id)}>
              <span className="nav-icon"><Icon name={it.icon} /></span>
              <span className="nav-label">{it.label}</span>
              {it.id === "experiments" && runningRuns > 0 && <span className="nav-count">{runningRuns}</span>}
              {it.id === "site" && project && project.site_status !== "ready" && <span className="nav-dot" />}
            </div>
          ))}
          <div className="nav-bottom">
            {BOTTOM.map((it) => (
              <div key={it.id} className={`nav-item ${page === it.id ? "active" : ""}`} data-tip={collapsed ? it.label : undefined} onClick={() => navTo(it.id)}>
                <span className="nav-icon"><Icon name={it.icon} /></span><span className="nav-label">{it.label}</span>
              </div>
            ))}
            <div className="nav-item sidebar-toggle" role="button" aria-label={collapsed ? "展开侧栏" : "收起侧栏"} data-tip={collapsed ? "展开侧栏（Ctrl+B）" : "收起侧栏（Ctrl+B），也可以拖动右边缘"} onClick={s.toggleCollapsed}>
              <span className="nav-icon"><Icon name={collapsed ? "chevron-right" : "chevron-left"} /></span><span className="nav-label">收起</span>
            </div>
          </div>
        </nav>
        <div className="sash" onMouseDown={dragSide} onDoubleClick={s.toggleCollapsed} data-tip="拖动调整侧栏宽度，拖到最窄只留图标；双击收起或展开" />
        <div className="workspace">
          <main className="editor">
            {!project && s.projectLoading ? <Loading text="打开项目…" /> : isProjectPage && !project ? (
              <div className="empty"><Icon name="folder-opened" /><div className="title">没有打开的项目</div><button className="btn primary" onClick={() => setPage("home")}>新建或打开项目</button></div>
            ) : <Pg />}
          </main>
          <RightPane id="assistant" open={assistantOpen} onClose={s.toggleAssistant} initial={400} min={320} max={720} label="AI 助手" className="assist-rpane"><AssistantPanel /></RightPane>
        </div>
      </div>

      {panelOpen && <TaskPanel onClose={() => setPanelOpen(false)} />}

      <footer className={`statusbar ${active.length ? "running" : ""}`}>
        <button className="status-item" title="后端连接">
          <span className={`status-dot ${conn === "open" ? "" : conn === "connecting" ? "wait" : "off"}`} />
          {conn === "open" ? "计算服务已连接" : conn === "connecting" ? "正在连接计算服务…" : "计算服务未连接"}
        </button>
        {project && <button className="status-item" onClick={() => setPage("site")}><Icon name="location" />{project.site_info?.name ?? project.site?.name}</button>}
        {project && project.site_status !== "ready" && <button className="status-item" onClick={() => setPage("site")}><Icon name="warning" />站点{project.site_status === "building" ? "构建中" : "未就绪"}</button>}
        <span className="grow" />
        <button className="status-item" onClick={() => setPanelOpen(!panelOpen)}>
          {active.length ? <><Icon name="sync" spin />{active.length} 个任务 · {Math.round(meanProgress * 100)}%<Progress value={meanProgress} style={{ width: 70, background: "rgba(255,255,255,.3)" }} /></> : <><Icon name="check-all" />任务队列空闲</>}
        </button>
        {k && <button className="status-item" onClick={() => setDialog("about")} title="计算内核"><Icon name="server-process" />GOTM {k.gotm?.split(" ")[0] ?? "?"} · FABM {k.fabm?.split(" ")[0] ?? "?"}</button>}
      </footer>
      {dialog === "keys" && (
        <Modal title="键盘快捷键" icon="keyboard" onClose={() => setDialog(null)} width={460}>
          <table className="table">{SHORTCUTS.map(([a, b]) => <tr key={a}><td className="mono">{a}</td><td>{b}</td></tr>)}</table>
        </Modal>
      )}
      {dialog === "about" && (
        <Modal title="关于 Shoal" icon="info" onClose={() => setDialog(null)} width={560}>
          <div className="col" style={{ gap: 12 }}>
            <div>浅海生态模拟工作台：把海水物理、营养盐、浮游生物和鱼放进同一个模型里一起算。计算内核为 GOTM–FABM，耦合 ERSEM / ECOSMO / ERGOM 低营养级模型与 FABM-MIZER / E2E 高营养级模块。</div>
            <div className="small mono">Shoal {appInfo?.version ?? "…"}{appInfo?.desktop ? "（安装版）" : "（源码版）"} · {appInfo?.platform}</div>
            <div className="small muted">名字的由来：shoal 在英语里既是“浅海、浅滩”，也是“鱼群”，正好是本软件模拟的地方和对象。</div>
            {k && <div className="kv small">{[["GOTM", k.gotm], ["FABM", k.fabm], ["ERSEM", k.ersem], ["FABM-MIZER", k.mizer], ["E2E", k.e2e?.source === "official" ? "官方 ECOSMO E2E v2.0" : "按论文方程重写"], ["编译", k.built]].map(([a, b]) => <Fragment key={String(a)}><span className="k" key={a}>{a}</span><span className="v mono" key={a + "v"}>{b ?? "–"}</span></Fragment>)}</div>}
            <div className="small muted" style={{ lineHeight: 1.7 }}>
              参考文献：Powley et al. (2026) Prog. Oceanogr. 243, 103701 · Vijayakumaran et al. (2026) EGUsphere-2026-3078 · Burchard et al. (1999) GOTM · Bruggeman &amp; Bolding (2014) FABM · Butenschön et al. (2016) ERSEM。<br />
              数据：ERA5（Copernicus C3S，经 Open-Meteo）· World Ocean Atlas 2023（NOAA NCEI）· ETOPO 2022（NOAA）。<br />
              许可证：GNU GPL 第 3 版或更高版本；第三方组件的许可证见 <a href="https://github.com/lycself/Shoal/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">THIRD_PARTY_NOTICES</a>。
            </div>
          </div>
        </Modal>
      )}
      <Toasts />
      <ConfirmHost />
      <TooltipLayer />
    </div>
  );
}

function MenuBar({ menus, title, children }: { menus: { label: string; items: () => MenuEntry[] }[]; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { projects, project, openProject, setPage } = useApp();
  const [titleMenu, setTitleMenu] = useState(false);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(null); setTitleMenu(false); } };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, []);
  return (
    <header className="menubar" ref={ref}>
      <div className="menubar-logo" data-tip="Shoal：浅海生态模拟工作台"><Logo size={18} /></div>
      {menus.map((m, i) => (
        <button key={m.label} className={`menubar-item ${open === i ? "open" : ""}`} onMouseDown={(e) => { e.preventDefault(); setTitleMenu(false); setOpen(open === i ? null : i); }} onMouseEnter={() => open !== null && setOpen(i)}>
          {m.label}
          {open === i && <MenuList items={m.items()} onDone={() => setOpen(null)} />}
        </button>
      ))}
      <div className="menubar-title" onMouseDown={(e) => { e.preventDefault(); setOpen(null); setTitleMenu(!titleMenu); }} title="切换项目">
        {title} <Icon name="chevron-down" style={{ fontSize: 12 }} />
        {titleMenu && (
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: "100%", textAlign: "left" }}>
            <MenuList onDone={() => setTitleMenu(false)} items={[
              ...projects.map((p) => ({ label: p.name, checked: p.id === project?.id, onClick: () => openProject(p.id) })),
              { type: "separator" as const },
              { label: "新建项目…", icon: "new-folder", onClick: () => { setPage("home"); setTimeout(() => window.dispatchEvent(new Event("new-project")), 30); } },
            ]} />
          </div>
        )}
      </div>
      <div className="menubar-tools">{children}</div>
    </header>
  );
}

function TaskPanel({ onClose }: { onClose: () => void }) {
  const jobs = Object.values(useApp((s) => s.jobs)).sort((a, b) => (a.created < b.created ? 1 : -1));
  const kindLabel: Record<string, [string, string]> = { run: ["运行", "play"], site: ["站点", "location"], shelf: ["陆架", "globe"] };
  return (
    <section className="bottom-panel">
      <div className="panel-head">
        <span className="panel-tab">任务</span>
        <span className="soft small">{jobs.filter((j) => j.status === "running").length} 运行 · {jobs.filter((j) => j.status === "queued").length} 排队 · 共 {jobs.length}</span>
        <span className="grow" />
        <IconBtn icon="close" title="关闭面板" size="sm" onClick={onClose} />
      </div>
      <div className="panel-body">
        <table className="table">
          <thead><tr><th style={{ width: 80 }}>类型</th><th>任务</th><th style={{ width: 110 }}>状态</th><th style={{ width: 220 }}>进度</th><th>信息</th><th style={{ width: 150 }}>提交时间</th><th style={{ width: 50 }} /></tr></thead>
          <tbody>
            {jobs.slice(0, 200).map((j) => (
              <tr key={j.id}>
                <td><span className="tag"><Icon name={kindLabel[j.kind]?.[1] ?? "circle"} />{kindLabel[j.kind]?.[0] ?? j.kind}</span></td>
                <td style={{ color: "var(--fg-strong)" }}>{j.label}</td>
                <td><StatusBadge status={j.status} /></td>
                <td>{j.status === "running" || j.status === "queued" ? <div className="row"><Progress value={j.progress} style={{ flex: 1 }} /><span className="soft small num">{Math.round(j.progress * 100)}%</span></div> : <span className="soft">–</span>}</td>
                <td className={j.error ? "danger-text small" : "soft small"} style={{ maxWidth: 420 }}><div className="ellipsis" title={j.error ?? j.message}>{j.error ?? j.message}</div></td>
                <td className="soft small num">{j.created.replace("T", " ")}</td>
                <td>{(j.status === "running" || j.status === "queued") && <IconBtn icon="debug-stop" title="停止" danger size="sm" onClick={() => api.post(`/jobs/${j.id}/cancel`)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!jobs.length && <div className="empty" style={{ height: 140 }}>还没有任务</div>}
      </div>
    </section>
  );
}
