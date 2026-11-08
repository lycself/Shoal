import { useEffect, useRef, useState } from "react";
// @ts-ignore - the dist bundle has no types
import Plotly from "plotly.js-dist-min";
import { useApp } from "../store";
import { Icon, cssVar } from "./ui";

/** Categorical series palette, light / dark variants (readable on both backgrounds). */
const SERIES: [string, string][] = [ // design:allow-colour categorical palette
  ["#1f6fd1", "#5aa5ff"], ["#e8590c", "#ff922b"], ["#2b9348", "#51cf66"], ["#c2255c", "#f06595"],
  ["#7048e8", "#9775fa"], ["#0b8f8f", "#3bc9db"], ["#a8710f", "#fcc419"], ["#495057", "#ced4da"],
  ["#8d5b2f", "#d9a066"], ["#d0453c", "#ff8787"],
];
export function seriesColor(i: number, dark: boolean) {
  return SERIES[i % SERIES.length][dark ? 1 : 0];
}
export const SERIES_COLORS = SERIES.map((c) => c[0]);

/** Colour scales: sequential ones keep lightness order in both themes; diverging ones are neutral at zero. */
const THERMAL: [number, string][] = [[0, "#1d2b6b"], [0.2, "#2f5fa8"], [0.4, "#5ca9c8"], [0.55, "#f2e8b5"], [0.75, "#f0a04b"], [0.9, "#d6492f"], [1, "#8c1d18"]]; // design:allow-colour colormap
const VIRIDIS: [number, string][] = [[0, "#440154"], [0.25, "#3b528b"], [0.5, "#21918c"], [0.75, "#5ec962"], [1, "#fde725"]]; // design:allow-colour colormap
const ALGAE: [number, string][] = [[0, "#f4fbe9"], [0.25, "#bfe3a5"], [0.5, "#6dbb6b"], [0.75, "#2d8a4a"], [1, "#0f4d2e"]]; // design:allow-colour colormap
const AMBER: [number, string][] = [[0, "#fff8e6"], [0.25, "#ffd98a"], [0.5, "#f6a635"], [0.75, "#cf6a0c"], [1, "#7a3605"]]; // design:allow-colour colormap
const DEEP: [number, string][] = [[0, "#fbfdff"], [0.25, "#b7d8ef"], [0.5, "#5ea3d6"], [0.75, "#2463a8"], [1, "#0b2a5b"]]; // design:allow-colour colormap
const NUTRI: [number, string][] = [[0, "#fbf9ff"], [0.25, "#d4c8f7"], [0.5, "#9a83ea"], [0.75, "#6040c4"], [1, "#2d1a74"]]; // design:allow-colour colormap
const MATTER: [number, string][] = [[0, "#fdf6ee"], [0.3, "#e9c79e"], [0.6, "#b98656"], [1, "#5b3a1e"]]; // design:allow-colour colormap
const DIV_L: [number, string][] = [[0, "#2166ac"], [0.25, "#92bedd"], [0.5, "#f7f7f5"], [0.75, "#e5917a"], [1, "#b2182b"]]; // design:allow-colour colormap
const DIV_D: [number, string][] = [[0, "#4c9be8"], [0.25, "#2b5e8c"], [0.5, "#26282c"], [0.75, "#a3493a"], [1, "#ff7b63"]]; // design:allow-colour colormap
const VIRIDIS_D: [number, string][] = [[0, "#2b2050"], [0.25, "#414a8c"], [0.5, "#2b8f8b"], [0.75, "#73c54c"], [1, "#f2e650"]]; // design:allow-colour colormap

/** Dark-theme variant of a white-based sequential scale: low values sink into the panel instead of glaring white. */
function hex(c: string) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); }
function mix(a: string, b: string, t: number) { const x = hex(a), y = hex(b); return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`; }
function at(scale: [number, string][], t: number) {
  for (let i = 1; i < scale.length; i++) if (t <= scale[i][0]) { const [t0, c0] = scale[i - 1], [t1, c1] = scale[i]; return mix(c0, c1, (t - t0) / (t1 - t0 || 1)); }
  return scale[scale.length - 1][1];
}
const darkCache = new Map<[number, string][], [number, string][]>();
function toDark(scale: [number, string][]): [number, string][] {
  if (!darkCache.has(scale)) darkCache.set(scale, [[0, mix("#1d1f23", at(scale, 0.8), 0.18)], [0.3, at(scale, 0.85)], [0.6, at(scale, 0.55)], [0.85, at(scale, 0.3)], [1, mix(at(scale, 0.12), "#ffffff", 0.3)]]);
  return darkCache.get(scale)!;
}

export function colorscaleFor(v: string, dark = false, diverging = false): [number, string][] {
  if (diverging) return dark ? DIV_D : DIV_L;
  const seq = (sc: [number, string][]) => (dark ? toDark(sc) : sc);
  if (/^temp/.test(v)) return THERMAL;
  if (/^(N[1-5]_|ECO_(no3|nh4|pho|sil)|ergom_(nn|aa|po))/.test(v)) return seq(NUTRI);
  if (/^(O2_|ECO_oxy|ergom_o2)/.test(v)) return seq(DEEP);
  if (/^(P[1-4]_|ECO_(fla|dia|bg)|.*[Cc]hl|ergom_(pp|ff|bb))/.test(v)) return seq(ALGAE);
  if (/^(Z[4-6]_|ECO_(meso|micro)zoo|ergom_zz)/.test(v)) return seq(AMBER);
  if (/^(F1|F2|fish)/.test(v)) return seq(DEEP);
  if (/^(R[1-8]_|B1_|ECO_(det|dom)|ergom_dd|Q)/.test(v)) return seq(MATTER);
  return dark ? VIRIDIS_D : VIRIDIS;
}

export function themeLayout(dark: boolean, extra: any = {}): any {
  const fg = cssVar("--fg") || (dark ? "#cdd1d7" : "#2f3640");
  const soft = cssVar("--fg-muted");
  const grid = cssVar("--plot-grid") || (dark ? "#2e3035" : "#eceef1");
  const line = cssVar("--plot-line") || (dark ? "#4a4e56" : "#b4bcc6");
  const axis = { gridcolor: grid, linecolor: line, zerolinecolor: line, tickcolor: line, showline: true, mirror: true, ticks: "outside", ticklen: 4, automargin: true, title: { font: { size: 12, color: soft } } };
  const base: any = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: cssVar("--font") || "sans-serif", size: 11.5, color: fg },
    xaxis: axis,
    yaxis: axis,
    colorway: SERIES.map((c) => c[dark ? 1 : 0]),
    legend: { orientation: "h", y: -0.16, x: 0, bgcolor: "rgba(0,0,0,0)", font: { size: 11.5 } },
    hoverlabel: { bgcolor: cssVar("--bg-tooltip"), bordercolor: cssVar("--border-strong"), font: { color: fg, family: cssVar("--font") } },
    margin: { l: 60, r: 20, t: 30, b: 48 },
    title: { font: { size: 13, color: cssVar("--fg-strong") }, x: 0, xanchor: "left", y: 0.98, pad: { l: 4 } },
  };
  const out = deepMerge(base, extra);
  for (const k of Object.keys(extra)) if (/^[xy]axis\d+$/.test(k)) out[k] = deepMerge(axis, extra[k]);
  return out;
}

function deepMerge(a: any, b: any): any {
  if (typeof b !== "object" || b === null || Array.isArray(b)) return b;
  const o: any = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b)) o[k] = typeof v === "object" && v !== null && !Array.isArray(v) ? deepMerge(o[k], v) : v;
  return o;
}

// Chinese tips for the plot toolbar
Plotly.register({ moduleType: "locale", name: "zh-CN", dictionary: {
  "Zoom": "框选放大", "Pan": "拖动平移", "Zoom in": "放大", "Zoom out": "缩小", "Reset axes": "还原默认视图", "Autoscale": "自动缩放",
  "Download plot as a png": "下载为 PNG 图片", "Download plot": "下载图片", "Box Select": "框选", "Lasso Select": "套索选择",
  "Show closest data on hover": "悬停显示最近的数据", "Compare data on hover": "悬停比较数据", "Toggle Spike Lines": "显示参考线",
  "Reset camera to default": "还原默认视角", "Double-click to zoom back out": "双击还原",
}, format: {} });

/** `layout` may be a function of the plot's real pixel size, so callouts can be placed for the space they really have. */
export function Plot({ data, layout, height, fill, config, onClick }: { data: any[]; layout?: any | ((px: [number, number]) => any); height?: number; fill?: boolean; config?: any; onClick?: (ev: any) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dark = useApp((s) => s.dark);
  const [zoomed, setZoomed] = useState(false);
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const drawRef = useRef<() => void>(() => {});
  const draw = () => {
    const el = ref.current;
    if (!el) return;
    const box: [number, number] = [Math.max(200, el.clientWidth - 90), Math.max(120, (height && !fill ? height : el.clientHeight) - 80)];
    const l = themeLayout(dark, (typeof layout === "function" ? layout(box) : layout) || {});
    if (height && !fill) l.height = height;
    Plotly.react(el, data, l, {
      responsive: true, displaylogo: false, displayModeBar: "hover", locale: "zh-CN", doubleClick: "reset", showTips: false,
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d", "toggleSpikelines"],
      toImageButtonOptions: { format: "png", scale: 3, filename: "shoal" }, ...(config || {}),
    });
  };
  drawRef.current = draw;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    draw();
    setZoomed(false);
    (el as any).removeAllListeners?.("plotly_relayout");
    // any change of an axis range by the user (box zoom, pan, scroll) shows the "还原" button
    (el as any).on?.("plotly_relayout", (ev: any) => {
      const keys = Object.keys(ev || {});
      if (keys.some((k) => /axis\d*\.range/.test(k))) setZoomed(true);
      else if (keys.some((k) => /axis\d*\.autorange/.test(k))) setZoomed(false);
    });
    if (onClick) {
      (el as any).removeAllListeners?.("plotly_click");
      (el as any).on?.("plotly_click", onClick);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, layout, height, dark, config, onClick, fill]);
  useEffect(() => {
    const el = ref.current;
    // resize once the container has settled (e.g. after a side panel slides), not on every animation frame:
    // redrawing a plot 10 times during a 180 ms slide is what made pages flicker
    let t = 0;
    const ro = new ResizeObserver(() => { window.clearTimeout(t); t = window.setTimeout(() => { if (!el || !el.offsetParent) return; if (typeof layoutRef.current === "function") drawRef.current(); else Plotly.Plots.resize(el); }, 140); });
    if (el) ro.observe(el);
    return () => { window.clearTimeout(t); ro.disconnect(); if (el) Plotly.purge(el); };
  }, []);
  return (
    <div className={fill ? "plot-fill" : "plot"} style={fill ? undefined : { height: height ?? 320 }}>
      <div ref={ref} className="plot-canvas" />
      {zoomed && <button type="button" className="plot-reset" onClick={() => { draw(); setZoomed(false); }} title="回到默认大小（也可以双击图）"><Icon name="screen-normal" />还原</button>}
    </div>
  );
}

/** CSS gradient for a Plotly colour scale (for custom legends). */
export function rampCss(scale: [number, string][]) {
  return `linear-gradient(90deg, ${scale.map(([t, c]) => `${c} ${Math.round(t * 100)}%`).join(", ")})`;
}
