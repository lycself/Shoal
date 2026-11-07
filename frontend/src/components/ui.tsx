import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useApp } from "../store";

/** Codicon glyph (VS Code icon font). */
export function Icon({ name, className = "", spin, style }: { name: string; className?: string; spin?: boolean; style?: React.CSSProperties }) {
  return <i className={`codicon codicon-${name} ${spin ? "spin" : ""} ${className}`} style={style} aria-hidden />;
}

/** Shoal mark: a small school of fish over shallow water (shoal = both "shallow sea" and "school of fish").
 *  Keep in sync with the favicon in index.html. */
export function Logo({ size = 18 }: { size?: number }) {
  const clip = React.useId();
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ display: "block", flex: "none" }}>
      <clipPath id={clip}><rect width="24" height="24" rx="5.5" /></clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect width="24" height="24" style={{ fill: "var(--accent)" }} />
        <path d="M0 18.2c3-1.7 6 1.7 9 0s6 1.7 9 0 6 1.7 9 0V24H0z" fill="#fff" opacity=".28" />
        <path d="M20.5 10.4C18.74 6.99 14.34 6.77 11.7 9.74L8.84 7.54L9.83 10.4L8.84 13.26L11.7 11.06C14.34 14.03 18.74 13.81 20.5 10.4Z" fill="#fff" />
        <path d="M8.3 5.6C7.31 3.68 4.83 3.55 3.34 5.23L1.73 3.99L2.29 5.6L1.73 7.21L3.34 5.97C4.83 7.65 7.31 7.52 8.3 5.6Z" fill="#fff" opacity=".85" />
        <path d="M8.4 14.4C7.5 12.66 5.26 12.55 3.92 14.06L2.46 12.94L2.97 14.4L2.46 15.86L3.92 14.74C5.26 16.25 7.5 16.14 8.4 14.4Z" fill="#fff" opacity=".85" />
      </g>
    </svg>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string; variant?: "primary" | "ghost" | "default"; size?: "sm" | "md"; spin?: boolean };
export function Btn({ icon, variant = "default", size = "md", spin, children, className = "", ...rest }: BtnProps) {
  return (
    <button className={`btn ${variant !== "default" ? variant : ""} ${size === "sm" ? "sm" : ""} ${className}`} {...rest}>
      {icon && <Icon name={icon} spin={spin} />}
      {children}
    </button>
  );
}

export function IconBtn({ icon, title, active, danger, size, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; title: string; active?: boolean; danger?: boolean; size?: "sm" }) {
  return (
    <button className={`icon-btn ${active ? "active" : ""} ${danger ? "danger" : ""} ${size === "sm" ? "sm" : ""}`} title={title} aria-label={title} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

export function Select({ value, onChange, children, size, style, disabled, title }: { value: string | number; onChange: (v: string) => void; children: React.ReactNode; size?: "sm"; style?: React.CSSProperties; disabled?: boolean; title?: string }) {
  return (
    <span className={`select ${size === "sm" ? "sm" : ""}`} style={style} title={title}>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>{children}</select>
      <Icon name="chevron-down" />
    </span>
  );
}

export function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className="check" style={disabled ? { opacity: 0.5, cursor: "default" } : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box"><Icon name="check" /></span>
      {children && <span>{children}</span>}
    </label>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: React.ReactNode }) {
  return (
    <span className="row" style={{ gap: 8, cursor: "pointer" }} onClick={() => onChange(!on)}>
      <span className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange, size }: { value: T; options: [T, string, string?][]; onChange: (v: T) => void; size?: "sm" }) {
  return (
    <div className={`segmented ${size === "sm" ? "sm" : ""}`}>
      {options.map(([v, l, ic]) => (
        <button key={v} className={v === value ? "on" : ""} onClick={() => onChange(v)}>{ic && <Icon name={ic} />}{l}</button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange, right, left }: { value: T; tabs: { id: T; label: string; icon?: string; hidden?: boolean; tip?: string }[]; onChange: (v: T) => void; right?: React.ReactNode; left?: React.ReactNode }) {
  return (
    <div className="tabs">
      {left && <div className="tabs-left">{left}</div>}
      {tabs.filter((t) => !t.hidden).map((t) => (
        <div key={t.id} className={`tab ${value === t.id ? "active" : ""}`} data-tip={t.tip} onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} />}{t.label}
        </div>
      ))}
      <div className="tabs-fill" />
      {right && <div className="row" style={{ paddingRight: 8 }}>{right}</div>}
    </div>
  );
}

export function SubTabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="subtabs">
      {tabs.map(([id, l]) => <div key={id} className={`subtab ${value === id ? "active" : ""}`} onClick={() => onChange(id)}>{l}</div>)}
    </div>
  );
}

const STATUS: Record<string, [string, string, string]> = {
  queued: ["", "排队中", "clock"], running: ["accent", "运行中", "loading"], done: ["ok", "完成", "pass"], failed: ["danger", "失败", "error"],
  cancelled: ["warn", "已取消", "circle-slash"], ready: ["ok", "就绪", "pass"], building: ["accent", "构建中", "loading"], missing: ["warn", "未构建", "warning"],
  error: ["danger", "出错", "error"], planned: ["", "已规划", "circle-large-outline"],
};
export function StatusBadge({ status }: { status: string }) {
  const [cls, label, ic] = STATUS[status] ?? ["", status, "circle-large-outline"];
  return <span className={`badge ${cls}`}><Icon name={ic} spin={ic === "loading"} />{label}</span>;
}

export function Progress({ value, indeterminate, style }: { value?: number; indeterminate?: boolean; style?: React.CSSProperties }) {
  return <div className={`progress ${indeterminate ? "indeterminate" : ""}`} style={style}><i style={{ width: `${Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100)}%` }} /></div>;
}

export function Empty({ icon = "inbox", title, children, action }: { icon?: string; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div className="title">{title}</div>
      {children && <div className="body">{children}</div>}
      {action}
    </div>
  );
}

export function Loading({ text = "加载中…" }: { text?: string }) {
  return <div className="loading"><Icon name="loading" spin />{text}</div>;
}

export function Notice({ kind = "info", icon, children, style }: { kind?: "info" | "warn" | "danger" | "plain"; icon?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const ic = icon ?? { info: "info", warn: "warning", danger: "error", plain: "lightbulb" }[kind];
  return <div className={`notice ${kind === "info" ? "" : kind}`} style={style}><Icon name={ic} /><div className="grow">{children}</div></div>;
}

export function Modal({ title, icon, onClose, children, footer, width }: { title: string; icon?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width: `min(${width}px, 100%)` } : undefined} role="dialog">
        <div className="modal-head">
          {icon && <Icon name={icon} className="lead" />}
          <h2>{title}</h2>
          <IconBtn icon="close" title="关闭" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Anchored popover menu. */
export function Popover({ anchor, onClose, children, width }: { anchor: HTMLElement | null; onClose: () => void; children: React.ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    setPos({ left: Math.min(r.left, window.innerWidth - (width ?? 300) - 8), top: r.bottom + 4 });
  }, [anchor, width]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => window.addEventListener("mousedown", h), 0);
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("mousedown", h); window.removeEventListener("keydown", k); };
  }, [anchor, onClose]);
  return <div ref={ref} className="popover" style={{ left: pos.left, top: pos.top, width }}>{children}</div>;
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind ?? ""}`}>
          <Icon name={t.kind === "ok" ? "pass" : t.kind === "bad" ? "error" : "info"} />
          <div>{t.text}</div>
        </div>
      ))}
    </div>
  );
}

/** Horizontal split with a draggable sash; width persisted per key. */
/**
 * One tooltip for the whole app. Any element with data-tip (or a plain title attribute, which is
 * converted on first hover so the browser's slow native tooltip does not also appear) shows its
 * text after a short delay, kept inside the window.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  useEffect(() => {
    let timer = 0;
    let current: Element | null = null;
    const over = (e: MouseEvent) => {
      const t = e.target as Element;
      const titled = t.closest?.("[title]");
      if (titled && titled.getAttribute("title")) { titled.setAttribute("data-tip", titled.getAttribute("title")!); titled.removeAttribute("title"); }
      const el = t.closest?.("[data-tip]");
      if (el === current) return;
      current = el;
      window.clearTimeout(timer);
      setTip(null);
      if (!el) return;
      timer = window.setTimeout(() => {
        const text = el.getAttribute("data-tip");
        if (!text || !document.contains(el)) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 70;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
      }, 450);
    };
    const hide = () => { window.clearTimeout(timer); current = null; setTip(null); };
    document.addEventListener("mouseover", over);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("wheel", hide, true);
    window.addEventListener("blur", hide);
    return () => { document.removeEventListener("mouseover", over); document.removeEventListener("mousedown", hide, true); document.removeEventListener("wheel", hide, true); window.removeEventListener("blur", hide); };
  }, []);
  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setDx(r.left < 6 ? 6 - r.left : r.right > window.innerWidth - 6 ? window.innerWidth - 6 - r.right : 0);
  }, [tip]);
  if (!tip) return null;
  return <div ref={ref} className="tooltip" role="tooltip" style={{ left: tip.x + dx, top: tip.y, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}>{tip.text}</div>;
}

/* Side panels of the workbench pages (AVAS style). Width and open/closed state live in a small store so
 * the panel and its toggle button (in the page header) stay in step, and both are remembered. */
interface SplitState { w: number; collapsed: boolean }
const splitKey = (id: string) => `e2e.split.${id}`;
const useSplits = create<{ s: Record<string, SplitState>; set: (id: string, v: Partial<SplitState>) => void }>((set, get) => ({
  s: {},
  set: (id, v) => {
    const next = { ...(get().s[id] ?? { w: 280, collapsed: false }), ...v };
    try {
      localStorage.setItem(splitKey(id), String(Math.round(next.w)));
      localStorage.setItem(`${splitKey(id)}.collapsed`, next.collapsed ? "1" : "0");
    } catch { /* ignore */ }
    set({ s: { ...get().s, [id]: next } });
  },
}));
function useSplit(id: string, initial = 280, min = 200, max = 520) {
  const st = useSplits((x) => x.s[id]);
  const setSt = useSplits((x) => x.set);
  const cur: SplitState = st ?? (() => {
    try {
      const w = Number(localStorage.getItem(splitKey(id)) ?? initial) || initial;
      return { w: Math.max(min, Math.min(max, w)), collapsed: localStorage.getItem(`${splitKey(id)}.collapsed`) === "1" };
    } catch { return { w: initial, collapsed: false }; }
  })();
  return { ...cur, update: (v: Partial<SplitState>) => setSt(id, { ...cur, ...v }) };
}

/** The button that opens and closes a page's side panel; put it at the left of the page header. */
export function PanelToggle({ id, label }: { id: string; label: string }) {
  const sp = useSplit(id);
  return <IconBtn icon={sp.collapsed ? "layout-sidebar-left-off" : "layout-sidebar-left"} title={sp.collapsed ? `显示${label}` : `收起${label}（也可以拖动或双击它的右边缘）`} active={!sp.collapsed} onClick={() => sp.update({ collapsed: !sp.collapsed })} />;
}

/**
 * Side panel + main area. The panel slides open and closed (its content keeps its width while it moves);
 * the divider drags to resize, dragging it narrow folds the panel away, double-clicking toggles it. When
 * folded, the divider stays at the edge (drag or double-click it to reopen) and <PanelToggle> in the page
 * header shows the panel again.
 */
export function Split({ id, initial = 280, min = 200, max = 520, side, children, label = "侧栏" }: { id: string; initial?: number; min?: number; max?: number; side: React.ReactNode; children: React.ReactNode; label?: string }) {
  const sp = useSplit(id, initial, min, max);
  const [live, setLive] = useState<number | null>(null);
  // register this panel's own starting width, so <PanelToggle> in the header reopens it at that width
  useEffect(() => { if (!useSplits.getState().s[id]) sp.update({}); }, [id]);
  const drag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, w0 = sp.collapsed ? 0 : sp.w;
    let last = w0;
    document.body.classList.add("dragging");
    const move = (ev: MouseEvent) => { last = w0 + ev.clientX - x0; setLive(Math.max(0, Math.min(max, last))); };
    const up = () => {
      document.body.classList.remove("dragging");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setLive(null);
      if (last < min / 2) sp.update({ collapsed: true });  // dragged narrow: fold the panel away
      else sp.update({ collapsed: false, w: Math.max(min, Math.min(max, last)) });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const w = Math.max(min, Math.min(max, sp.w));
  const width = live ?? (sp.collapsed ? 0 : w);
  return (
    <div className="split">
      <div className={`split-side ${live == null ? "animate" : ""} ${sp.collapsed && live == null ? "closed" : ""}`} style={{ width }} aria-hidden={sp.collapsed} aria-label={label}>
        <div className="split-side-inner" style={{ width: Math.max(live ?? 0, w) }}>{side}</div>
      </div>
      <div className={`sash ${sp.collapsed && live == null ? "sash-closed" : ""}`} onMouseDown={drag} onDoubleClick={() => sp.update({ collapsed: !sp.collapsed })}
        data-tip={sp.collapsed ? `${label}已收起：向右拖动或双击这里展开` : `拖动调整${label}宽度，拖到很窄或双击收起`} />
      <div className="split-main">{children}</div>
    </div>
  );
}

export function Stat({ k, v, unit, delta }: { k: string; v: React.ReactNode; unit?: string; delta?: number | null }) {
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className="v">{v}{unit && <small>{unit}</small>}</span>
      {delta !== undefined && delta !== null && <span className={`d ${delta > 0 ? "ok-text" : delta < 0 ? "danger-text" : "soft"}`}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(delta).toFixed(1)}%</span>}
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (d) => alive && setState({ data: d, error: null, loading: false }),
      (e) => alive && setState({ data: null, error: String(e?.message ?? e), loading: false }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/** min/max without spreading (safe for arrays longer than the JS argument limit) */
export function extent(arr: ArrayLike<number>): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < arr.length; i++) { const x = arr[i]; if (x < lo) lo = x; if (x > hi) hi = x; }
  return [lo, hi];
}

/** Robust symmetric half-range for diverging maps: 98th percentile of |v|, so one outlier cell does not wash out the rest. */
export function robustAbs(vals: number[], q = 0.98): number {
  const a = vals.filter((x) => x != null && isFinite(x)).map(Math.abs).sort((x, y) => x - y);
  if (!a.length) return 1;
  return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))] || a[a.length - 1] || 1;
}

/** 56.00°N 3.00°E / 32.00°S 17.50°E — signed coordinates read badly once sites can be anywhere. */
export function fmtLat(lat: number, d = 2) { return `${Math.abs(lat).toFixed(d)}°${lat >= 0 ? "N" : "S"}`; }
export function fmtLon(lon: number, d = 2) { return `${Math.abs(lon).toFixed(d)}°${lon >= 0 ? "E" : "W"}`; }
export function fmtLatLon(lat: number, lon: number, d = 2) { return `${fmtLat(lat, d)} ${fmtLon(lon, d)}`; }

export function fmt(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || !isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(2);
  return Number(v.toPrecision(digits)).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Ecosystem role → colour token. */
export const ROLE_VAR: Record<string, string> = {
  nutrient: "--eco-nut", phyto: "--eco-phyto", zoo: "--eco-zoo", fish: "--eco-fish", benthos: "--eco-benthos",
  benthic: "--eco-benthos", organic: "--eco-organic", bacteria: "--eco-bact", physics: "--eco-phys", carbon: "--eco-carbon",
};

// ------------------------------------------------------------------ menus
export type MenuEntry =
  | { type: "separator" }
  | { label: string; icon?: string; shortcut?: string; checked?: boolean; disabled?: boolean; danger?: boolean; onClick?: () => void; submenu?: MenuEntry[] };

/** Dropdown menu list (used by the menubar and context menus). */
export function MenuList({ items, onDone }: { items: MenuEntry[]; onDone: () => void }) {
  const [sub, setSub] = useState<number | null>(null);
  return (
    // The list is rendered inside the menubar button that opened it: stop mousedown from reaching that
    // button, which would toggle the menu shut before the item's click fires.
    <div className="menu" onMouseLeave={() => setSub(null)} onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}>
      {items.map((it, i) => "type" in it ? <div key={i} className="menu-sep" /> : (
        <div key={i} className={`menu-row ${it.disabled ? "disabled" : ""} ${it.danger ? "danger" : ""}`}
          onMouseEnter={() => setSub(it.submenu ? i : null)}
          onClick={() => { if (it.disabled || it.submenu) return; it.onClick?.(); onDone(); }}>
          <span className="menu-check">{it.checked ? <Icon name="check" /> : it.icon ? <Icon name={it.icon} /> : null}</span>
          <span className="menu-text">{it.label}</span>
          {it.shortcut && <span className="menu-key">{it.shortcut}</span>}
          {it.submenu && <Icon name="chevron-right" className="menu-key" />}
          {it.submenu && sub === i && <div className="menu-sub"><MenuList items={it.submenu} onDone={onDone} /></div>}
        </div>
      ))}
    </div>
  );
}

/** "?" button that opens a primer chapter (instead of paragraphs of explanatory text on every page). */
export function HelpLink({ chapter, title = "说明" }: { chapter: string; title?: string }) {
  const setPage = useApp((s) => s.setPage);
  return <IconBtn icon="question" title={title} size="sm" onClick={() => setPage("primer", { chapter })} />;
}
