// Version, automatic updates and quitting for the installed (desktop) app.
import { ask } from "../dialog";
// The backend checks GitHub on its own (see backend/shoal/desktop/updater.py); this page only shows the
// state and starts the update. A failed check is shown as a line of text: it never blocks anything.
import { useEffect } from "react";
import { create } from "zustand";
import { api } from "../api";
import { Btn, Icon, Notice, Progress } from "./ui";
import { useApp } from "../store";

export interface UpdateState {
  phase: "idle" | "checking" | "available" | "latest" | "error" | "downloading" | "installing";
  current: string;
  latest: { version: string; notes: string; published?: string; size?: number } | null;
  error: string | null;
  checked: number | null;
  progress: { downloaded: number; total: number | null } | null;
  result: { ok: boolean; message: string; log?: string } | null;
  can_install: boolean;
  cannot_install_reason: string | null;
  releases_page: string;
}
export interface AppInfo { version: string; desktop: boolean; frozen: boolean; platform: string; active_jobs: number; update: UpdateState }

const useInfo = create<{ info: AppInfo | null; busy: boolean; refresh: () => Promise<void> }>((set) => ({
  info: null,
  busy: false,
  refresh: async () => {
    try { set({ info: await api.get<AppInfo>("/app") }); } catch { /* backend restarting: keep the last state */ }
  },
}));

export function useAppInfo() {
  const { info, refresh } = useInfo();
  useEffect(() => {
    refresh();
    const fast = info?.update.phase === "downloading" || info?.update.phase === "installing" || info?.update.phase === "checking";
    const t = window.setInterval(refresh, fast ? 1000 : 60_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [info?.update.phase]);
  return info;
}

const MB = (n?: number | null) => (n == null ? "?" : `${(n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1)} MB`);
const HIDE_KEY = "shoal.update.hidden";

async function checkNow() {
  useInfo.setState({ busy: true });
  try { await api.post("/app/update/check"); } finally { useInfo.setState({ busy: false }); await useInfo.getState().refresh(); }
}

async function installNow(toast: (m: string, k?: "ok" | "bad" | "info") => void) {
  try { await api.post("/app/update/install"); } catch (e: any) { toast(e.message, "bad"); }
  await useInfo.getState().refresh();
}

/** One line above the page when a new version exists, while it downloads, or after an update. */
export function UpdateBanner() {
  const info = useAppInfo();
  const { setPage } = useApp();
  if (!info?.desktop) return null;
  const u = info.update;
  if (u.result) {
    return (
      <div className={`app-banner ${u.result.ok ? "" : "danger"}`} role="status">
        <Icon name={u.result.ok ? "pass" : "warning"} />
        <span className="grow">{u.result.message}{!u.result.ok && u.result.log ? `（日志：${u.result.log}）` : ""}</span>
        <button className="btn sm" onClick={async () => { await api.post("/app/update/dismiss"); useInfo.getState().refresh(); }}>知道了</button>
      </div>
    );
  }
  if (u.phase === "downloading" || u.phase === "installing") {
    const p = u.progress;
    return (
      <div className="app-banner" role="status">
        <Icon name="sync" spin />
        <span className="grow">{u.phase === "installing" ? "正在安装新版本，Shoal 会自动关闭并重新打开…" : `正在下载 Shoal ${u.latest?.version}：${MB(p?.downloaded)} / ${MB(p?.total)}`}</span>
        {u.phase === "downloading" && <Progress value={p?.total ? p.downloaded / p.total : undefined} indeterminate={!p?.total} style={{ width: 140 }} />}
      </div>
    );
  }
  let hidden = "";
  try { hidden = localStorage.getItem(HIDE_KEY) ?? ""; } catch { /* private window */ }
  if (u.phase !== "available" || !u.latest || hidden === u.latest.version) return null;
  return (
    <div className="app-banner" role="status">
      <Icon name="cloud-download" />
      <span className="grow">Shoal {u.latest.version} 已发布（当前 {u.current}）。</span>
      <button className="btn sm primary" onClick={() => { setPage("settings"); setTimeout(() => document.getElementById("update")?.scrollIntoView({ behavior: "smooth" }), 50); }}>查看并更新</button>
      <button className="btn sm" data-tip="这个版本不再提示；设置页里仍可更新" onClick={() => { try { localStorage.setItem(HIDE_KEY, u.latest!.version); } catch { /* ignore */ } useInfo.getState().refresh(); }}>以后再说</button>
    </div>
  );
}

/** Settings → 软件版本与更新 (and 退出 Shoal for the installed app). */
export function UpdateSection() {
  const info = useAppInfo();
  const { toast } = useApp();
  const busy = useInfo((s) => s.busy);
  if (!info) return null;
  const u = info.update;
  const checking = busy || u.phase === "checking";
  const working = u.phase === "downloading" || u.phase === "installing";
  const quit = async () => {
    const n = info.active_jobs;
    if (n && !(await ask(`还有 ${n} 个计算在运行，退出会停止它们。确定退出吗？`, { danger: true, ok: "退出" }))) return;
    try { await api.post("/app/quit", { force: true }); toast("Shoal 正在退出，可以关闭这个页面了", "ok"); } catch (e: any) { toast(e.message, "bad"); }
  };
  return (
    <div className="section" id="update">
      <div className="section-header"><Icon name="versions" /><h3>软件版本与更新</h3></div>
      <div className="section-desc">
        {info.desktop
          ? "Shoal 每隔几小时在后台查一次 GitHub 上有没有新版本。查不到（比如没联网）也不影响使用。更新时会下载完整安装包，校验无误后自动替换并重新打开 Shoal，项目和数据都不受影响。"
          : "现在是从源码运行（pnpm dev）。源码版本用 git pull 更新，然后重新编译内核、重启。"}
      </div>
      <div className="form">
        <span className="label">当前版本</span>
        <span className="control mono">Shoal {info.version} · {info.platform}</span>
        {info.desktop && <>
          <span className="label">最新版本</span>
          <span className="control">
            {checking ? <span className="muted"><Icon name="loading" spin /> 正在检查…</span>
              : u.phase === "error" ? <span className="muted">{u.error}</span>
              : u.latest ? <span>{u.latest.version}{u.phase === "available" ? "（可以更新）" : u.phase === "latest" ? "（已是最新）" : ""}{u.latest.published ? <span className="muted">，发布于 {new Date(u.latest.published).toLocaleDateString()}</span> : null}</span>
              : <span className="muted">尚未检查</span>}
            <Btn size="sm" icon="refresh" disabled={checking || working} onClick={checkNow}>检查更新</Btn>
          </span>
        </>}
      </div>
      {info.desktop && u.phase === "available" && u.latest && (
        <div className="update-box">
          {u.latest.notes && <><div className="label">更新内容</div><div className="update-notes">{u.latest.notes}</div></>}
          {!u.can_install
            ? <Notice kind="warn" icon="warning">{u.cannot_install_reason} <a href={u.releases_page} target="_blank" rel="noreferrer">打开下载页</a></Notice>
            : info.active_jobs > 0
              ? <Notice kind="warn" icon="warning">还有 {info.active_jobs} 个计算在运行。等它们结束（或在任务面板里停止）后才能更新。</Notice>
              : null}
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <Btn variant="primary" icon="cloud-download" disabled={!u.can_install || info.active_jobs > 0 || working} onClick={() => installNow(toast)}>
              下载并更新到 {u.latest.version}{u.latest.size ? `（${MB(u.latest.size)}）` : ""}
            </Btn>
            <a className="btn" href={u.releases_page} target="_blank" rel="noreferrer">手动下载</a>
          </div>
        </div>
      )}
      {info.desktop && working && (
        <div className="update-box">
          {u.phase === "installing" ? "正在安装，Shoal 会自动关闭并重新打开。" : `正在下载：${MB(u.progress?.downloaded)} / ${MB(u.progress?.total)}`}
          <Progress value={u.progress?.total ? u.progress.downloaded / u.progress.total : undefined} indeterminate={u.phase === "installing" || !u.progress?.total} style={{ marginTop: 8 }} />
        </div>
      )}
      {info.desktop && u.phase === "error" && u.error?.startsWith("更新失败") && <Notice kind="danger" icon="error" style={{ marginTop: 10 }}>{u.error}</Notice>}
      {info.desktop && (
        <div className="form" style={{ marginTop: 14 }}>
          <span className="label">退出</span>
          <span className="control">
            <Btn size="sm" icon="close" onClick={quit}>退出 Shoal</Btn>
            <span className="hint">关掉浏览器页面不会结束 Shoal，计算会继续在后台进行。点托盘（macOS 菜单栏）里的 Shoal 图标可以重新打开页面。</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** Opening http://…/#update (the tray's "有新版本" item) jumps to the update section. */
export function useUpdateHash() {
  const { setPage } = useApp();
  useEffect(() => {
    const go = () => {
      if (location.hash !== "#update") return;
      setPage("settings");
      setTimeout(() => document.getElementById("update")?.scrollIntoView({ behavior: "smooth" }), 80);
      history.replaceState(null, "", location.pathname);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
}
