import { create } from "zustand";
import { api } from "./api";

export type Page = "home" | "site" | "foodweb" | "experiments" | "results" | "shelf" | "primer" | "settings";

export interface Job {
  id: string;
  kind: "run" | "site" | "shelf";
  project: string;
  label: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  message: string;
  error?: string | null;
  created: string;
  run_id?: string;
  study_id?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  template: string;
  paper: string;
  site: any;
  site_status: "missing" | "building" | "ready" | "error";
  site_error?: string;
  site_info?: any;
  simulation: any;
  created: string;
  modified?: string;
  n_runs?: number;
}

export interface Toast {
  id: number;
  text: string;
  kind?: "ok" | "bad" | "info";
}

interface AppState {
  page: Page;
  setPage: (p: Page, opts?: { chapter?: string }) => void;
  chapter: string | null;
  projects: Project[];
  projectId: string | null;
  project: Project | null;
  jobs: Record<string, Job>;
  hosts: any | null;
  kernel: any | null;
  assistantOpen: boolean;
  toggleAssistant: () => void;
  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"]) => void;
  theme: "auto" | "light" | "dark";
  setTheme: (t: "auto" | "light" | "dark") => void;
  dark: boolean;
  collapsed: boolean;
  toggleCollapsed: () => void;
  setCollapsed: (v: boolean) => void;
  sideWidth: number;
  setSideWidth: (w: number) => void;
  learnPanels: { nav: boolean; toc: boolean };
  setLearnPanel: (k: "nav" | "toc", v: boolean) => void;
  panelOpen: boolean;
  setPanelOpen: (v: boolean) => void;
  selectedRuns: string[];
  setSelectedRuns: (ids: string[]) => void;
  refreshProjects: () => Promise<void>;
  openProject: (id: string | null) => Promise<void>;
  refreshProject: () => Promise<void>;
  upsertJob: (j: Job) => void;
  setJobs: (js: Job[]) => void;
  loadStatic: () => Promise<void>;
  revision: number;
  bump: () => void;
}

// main sidebar: icon strip when collapsed, otherwise resizable between these widths
export const SIDE_COLLAPSED = 48;
export const SIDE_MIN = 160;
export const SIDE_MAX = 360;

function lsGet(k: string, d: string) {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

let toastSeq = 1;

export const useApp = create<AppState>((set, get) => ({
  page: (lsGet("e2e.page", "home") as Page) || "home",
  chapter: lsGet("e2e.chapter", "") || null,
  setPage: (p, opts) => {
    lsSet("e2e.page", p);
    if (opts?.chapter) lsSet("e2e.chapter", opts.chapter);
    set({ page: p, chapter: opts?.chapter ?? get().chapter });
  },
  projects: [],
  projectId: lsGet("e2e.project", "") || null,
  project: null,
  jobs: {},
  hosts: null,
  kernel: null,
  assistantOpen: lsGet("e2e.assistant", "0") === "1",
  toggleAssistant: () => {
    const v = !get().assistantOpen;
    lsSet("e2e.assistant", v ? "1" : "0");
    set({ assistantOpen: v });
  },
  toasts: [],
  toast: (text, kind = "info") => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === "bad" ? 8000 : 4000);
  },
  theme: (lsGet("e2e.theme2", "light") as any) || "light",
  setTheme: (t) => {
    lsSet("e2e.theme2", t);
    const dark = t === "dark" || (t === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    set({ theme: t, dark: !!dark });
  },
  dark: false,
  collapsed: lsGet("e2e.collapsed", "0") === "1",
  toggleCollapsed: () => get().setCollapsed(!get().collapsed),
  setCollapsed: (v) => {
    lsSet("e2e.collapsed", v ? "1" : "0");
    set({ collapsed: v });
  },
  sideWidth: Math.max(SIDE_MIN, Math.min(SIDE_MAX, Number(lsGet("e2e.sideWidth", "208")) || 208)),
  setSideWidth: (w) => {
    const v = Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, w)));
    lsSet("e2e.sideWidth", String(v));
    set({ sideWidth: v });
  },
  learnPanels: { nav: lsGet("e2e.learn.nav", "1") === "1", toc: lsGet("e2e.learn.toc", "1") === "1" },
  setLearnPanel: (k, v) => {
    lsSet(`e2e.learn.${k}`, v ? "1" : "0");
    set({ learnPanels: { ...get().learnPanels, [k]: v } });
  },
  panelOpen: false,
  setPanelOpen: (v) => set({ panelOpen: v }),
  selectedRuns: [],
  setSelectedRuns: (ids) => set({ selectedRuns: ids }),
  refreshProjects: async () => {
    const ps = await api.get<Project[]>("/projects");
    set({ projects: ps });
    const cur = get().projectId;
    if ((!cur || !ps.find((p) => p.id === cur)) && ps.length) await get().openProject(ps[0].id);
    else if (cur) await get().refreshProject();
  },
  openProject: async (id) => {
    lsSet("e2e.project", id ?? "");
    set({ projectId: id, project: null, selectedRuns: [] });
    if (id) {
      try {
        const p = await api.get<Project>(`/projects/${id}`);
        set({ project: p });
      } catch {
        set({ projectId: null });
      }
    }
  },
  refreshProject: async () => {
    const id = get().projectId;
    if (!id) return;
    try {
      const p = await api.get<Project>(`/projects/${id}`);
      set({ project: p, revision: get().revision + 1 });
    } catch {
      /* deleted */
    }
  },
  upsertJob: (j) => set({ jobs: { ...get().jobs, [j.id]: j } }),
  setJobs: (js) => set({ jobs: Object.fromEntries(js.map((j) => [j.id, j])) }),
  loadStatic: async () => {
    const [hosts, kernel] = await Promise.all([api.get("/hosts"), api.get("/kernel")]);
    set({ hosts, kernel });
  },
  revision: 0,
  bump: () => set({ revision: get().revision + 1 }),
}));

export const HOST_LABEL: Record<string, string> = { ersem: "ERSEM", ecosmo: "ECOSMO", ergom: "ERGOM" };
export const HTL_LABEL: Record<string, string> = { none: "无高营养级", e2e: "E2E 功能群", mizer: "MIZER 粒径谱" };
