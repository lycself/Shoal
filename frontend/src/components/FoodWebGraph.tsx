import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { Check, ROLE_VAR, cssVar, fmt } from "./ui";

export interface FWNode { id: string; level: number; group: string; label: string; role: string; var: string }
export interface FWEdge { from: string; to: string; w: number; kind: string; sigma?: number; feedback?: boolean }

const ROWS: [string, (n: FWNode) => boolean][] = [
  ["顶层鱼类", (n) => n.level >= 3.8],
  ["鱼类", (n) => n.level >= 3 && n.level < 3.8],
  ["中型浮游动物 · 底栖动物", (n) => n.level >= 2.4 && n.level < 3],
  ["微型浮游动物 · 鞭毛虫", (n) => n.level >= 1.9 && n.level < 2.4],
  ["初级生产者 · 细菌", (n) => n.level >= 1 && n.level < 1.9],
  ["营养盐 · 有机物 · 沉积物", (n) => n.level < 1],
];
const GROUP_ORDER = ["det", "nut", "pel", "mic", "htl", "ben"];
/** Rough text width: CJK glyphs are one em, Latin and digits a little over half. */
const textW = (t: string, size: number) => [...t].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? size : size * 0.6), 0);
/** Up to two lines that fit maxW; breaks at a space or a CJK boundary, ellipsis on overflow. */
function wrap2(t: string, maxW: number, size: number): string[] {
  if (textW(t, size) <= maxW) return [t];
  const chars = [...t];
  let i = 0, w = 0;
  while (i < chars.length && w + textW(chars[i], size) <= maxW) w += textW(chars[i++], size);
  const sp = chars.slice(0, i).lastIndexOf(" ");
  const cut = sp > 2 ? sp : i;
  const first = chars.slice(0, cut).join("").trim(), rest = chars.slice(cut).join("").trim();
  if (textW(rest, size) <= maxW) return [first, rest];
  let r = "";
  for (const ch of rest) { if (textW(r + ch + "…", size) > maxW) break; r += ch; }
  return [first, r + "…"];
}
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function mergeNutrients(graph: { nodes: FWNode[]; edges: FWEdge[] }) {
  const nut = graph.nodes.filter((n) => n.role === "nutrient");
  if (nut.length <= 1) return graph;
  const id = "__NUT__";
  const ids = new Set(nut.map((n) => n.id));
  const nodes = [...graph.nodes.filter((n) => !ids.has(n.id)), { id, level: 0, group: "nut", label: "营养盐 N/P/Si", role: "nutrient", var: nut[0].var }];
  const seen = new Set<string>();
  const edges: FWEdge[] = [];
  for (const e of graph.edges) {
    const f = ids.has(e.from) ? id : e.from, t = ids.has(e.to) ? id : e.to;
    const k = `${f}>${t}>${e.kind}`;
    if (f === t || seen.has(k)) continue;
    seen.add(k);
    edges.push({ ...e, from: f, to: t });
  }
  return { nodes, edges };
}

export function FoodWebGraph({ graph, state, delta, onSelect, selected, height = 520 }: {
  graph: { nodes: FWNode[]; edges: FWEdge[]; htl?: string };
  state?: Record<string, { value: number; units: string }>;
  delta?: Record<string, number>;
  onSelect?: (id: string | null) => void;
  selected?: string | null;
  height?: number;
}) {
  const dark = useApp((s) => s.dark);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  // the layout is never narrower than 640 px; a narrower pane shows the whole graph scaled down instead of clipping it
  const [boxW, setBoxW] = useState(900);
  const W = Math.max(640, boxW), scale = Math.min(1, boxW / W);
  const [availH, setAvailH] = useState(height);
  const [hover, setHover] = useState<string | null>(null);
  const [showWaste, setShowWaste] = useState(false);
  const [showUptake, setShowUptake] = useState(false);
  useEffect(() => {
    // the graph fills its pane: width from the wrapper, height from the canvas area left after the legend
    const ro = new ResizeObserver(() => {
      if (wrap.current) setBoxW(wrap.current.clientWidth);
      if (canvas.current) setAvailH(Math.max(height, canvas.current.clientHeight / Math.min(1, (wrap.current?.clientWidth ?? 640) / 640)));
    });
    if (wrap.current) ro.observe(wrap.current);
    if (canvas.current) ro.observe(canvas.current);
    return () => ro.disconnect();
  }, []);
  const g = useMemo(() => mergeNutrients(graph), [graph]);

  const layout = useMemo(() => {
    const rows = ROWS.map(([label, f]) => ({ label, nodes: g.nodes.filter(f) })).filter((r) => r.nodes.length);
    // row names sit in the top-left corner of each band, so the nodes get the full width
    const left = 14, right = 14, top = 34, bottom = 14;
    const rowH = Math.max(78, (availH - top - bottom) / Math.max(1, rows.length));
    const maxN = Math.max(1, ...rows.map((r) => r.nodes.length));
    // nodes grow with the pane but always fit their row with a gap
    // compact cards with wide gaps: lines that skip a row pass between cards instead of through them
    const NW = Math.max(100, Math.min(156, (W - left - right) / maxN - 44));
    const NH = Math.max(48, Math.min(56, rowH * 0.45));
    const pos: Record<string, { x: number; y: number; row: number }> = {};
    rows.forEach((r, ri) => {
      r.nodes.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.id.localeCompare(b.id));
      const n = r.nodes.length;
      const span = W - left - right;
      r.nodes.forEach((node, i) => {
        pos[node.id] = { x: left + (span * (i + 0.5)) / n, y: top + rowH * (ri + 0.5), row: ri };
      });
    });
    return { rows, pos, rowH, top, H: top + bottom + rowH * rows.length, left, NW, NH };
  }, [g, W, availH]);
  const { NW, NH } = layout;
  const fs = Math.min(1.12, NH / 50);

  const color = (role: string) => cssVar(ROLE_VAR[role] ?? "--fg-soft");
  const focus = hover ?? selected ?? null;
  const linked = (e: FWEdge) => !focus || e.from === focus || e.to === focus;
  const nodeById = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  const maxBy: Record<string, number> = {};
  if (state) for (const n of g.nodes) { const v = state[n.var]?.value; if (v && v > 0) maxBy[n.role] = Math.max(maxBy[n.role] ?? 0, v); }
  const edges = g.edges.filter((e) => (e.kind !== "waste" || showWaste) && (e.kind !== "uptake" || showUptake));
  // Feeding pressure of a link: preference a × prey biomass (a Holling type-II intake is proportional to it at low prey).
  // Without a run (the configuration page) only the preference is known, so a alone sets it.
  const pressure = useMemo(() => {
    const raw = edges.map((e) => {
      if (e.kind !== "htl" && e.kind !== "ltl") return 0;
      const prey = state?.[nodeById[e.from]?.var ?? ""]?.value;
      return state ? (prey && prey > 0 ? e.w * prey : 0) : e.w;
    });
    // biomasses span orders of magnitude: compress with a square root so mid-sized links stay visible
    const top = Math.max(1e-12, ...raw.map(Math.sqrt));
    return raw.map((x) => Math.sqrt(x) / top);
  }, [edges, state]);
  const motion = !reducedMotion();

  // where each line meets a card: lines sharing a card side are spread along it (sorted by where they go),
  // instead of all leaving from the centre of the card
  const ports = (() => {
    const side: Record<string, { i: number; ox: number }[]> = {};
    edges.forEach((e, i) => {
      const a = layout.pos[e.from], b = layout.pos[e.to];
      if (!a || !b || a.row === b.row) return;
      const up = b.row < a.row;
      (side[`${e.from}|${up ? "t" : "b"}`] ??= []).push({ i, ox: b.x });
      (side[`${e.to}|${up ? "b" : "t"}`] ??= []).push({ i: -i - 1, ox: a.x });
    });
    const off: Record<number, number> = {};
    for (const list of Object.values(side)) {
      list.sort((p, q) => p.ox - q.ox);
      list.forEach((p, k) => { off[p.i] = ((k + 0.5) / list.length - 0.5) * NW * 0.7; });
    }
    return off;
  })();
  // a line that skips a row passes through the gap between that row's cards nearest to its path
  const gapX = (row: number, x: number) => {
    const xs = layout.rows[row].nodes.map((n) => layout.pos[n.id].x).sort((p, q) => p - q);
    if (xs.every((cx) => Math.abs(cx - x) > NW / 2 + 10)) return x;
    const gaps = [xs[0] - NW / 2 - 14, ...xs.slice(1).map((cx, k) => (cx + xs[k]) / 2), xs[xs.length - 1] + NW / 2 + 14];
    return gaps.reduce((best, g) => (Math.abs(g - x) < Math.abs(best - x) ? g : best), gaps[0]);
  };
  const through = (pts: [number, number][]) => {
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let k = 0; k < pts.length - 1; k++) {
      const [x0, y0] = pts[k], [x1, y1] = pts[k + 1], my = (y0 + y1) / 2;
      d += ` C${x0},${my} ${x1},${my} ${x1},${y1}`;
    }
    return d;
  };
  const drawEdges = (layer: "under" | "top") => edges.map((e, i) => {
          if (layer === "top" ? !(focus && linked(e)) : focus && linked(e)) return null;
          const a = layout.pos[e.from], b = layout.pos[e.to];
          if (!a || !b) return null;
          const tgt = nodeById[e.to], src = nodeById[e.from];
          const up = b.y < a.y - 4;
          const y1 = up ? a.y - NH / 2 : a.y + (b.y > a.y + 4 ? NH / 2 : 0);
          const y2 = up ? b.y + NH / 2 + 2 : b.y - (b.y > a.y + 4 ? NH / 2 + 2 : 0);
          const same = Math.abs(a.y - b.y) <= 4;
          const x1 = same ? a.x + (b.x > a.x ? NW / 2 : -NW / 2) : a.x + (ports[i] ?? 0), x2 = same ? b.x - (b.x > a.x ? NW / 2 + 2 : -NW / 2 - 2) : b.x + (ports[-i - 1] ?? 0);
          const dy = Math.max(30, Math.abs(y2 - y1) * 0.45);
          const skip = Math.abs(a.row - b.row) > 1;
          const mids: [number, number][] = [];
          if (skip) for (let r = Math.min(a.row, b.row) + 1; r < Math.max(a.row, b.row); r++) {
            const yr = layout.top + layout.rowH * (r + 0.5), t = (yr - y1) / (y2 - y1 || 1);
            mids.push([gapX(r, x1 + (x2 - x1) * t), yr]);
          }
          if (up) mids.reverse();
          const d = same
            ? `M${x1},${a.y} C${(x1 + x2) / 2},${a.y - 40} ${(x1 + x2) / 2},${b.y - 40} ${x2},${b.y}`
            : skip ? through([[x1, y1], ...(up ? mids.sort((p, q) => q[1] - p[1]) : mids.sort((p, q) => p[1] - q[1])), [x2, y2]])
            : `M${x1},${y1} C${x1},${up ? y1 - dy : y1 + dy} ${x2},${up ? y2 + dy : y2 - dy} ${x2},${y2}`;
          const waste = e.kind === "waste", uptake = e.kind === "uptake";
          const role = waste ? "organic" : uptake ? "nutrient" : tgt?.role ?? "zoo";
          const wd = waste || uptake ? 1.2 : 0.9 + 3.2 * Math.min(1, e.w);
          const on = linked(e);
          const pr = pressure[i];
          const flows = motion && on && pr > 0.04;
          // 1–4 particles per link; stronger links carry more and faster ones
          const nP = flows ? Math.max(1, Math.round(1 + 3 * pr)) : 0;
          const dur = 5.5 - 3 * pr;
          return (
            <g key={i}>
              {dark && on && pr > 0.04 && <path d={d} fill="none" stroke={color(role)} strokeWidth={wd + 6} strokeOpacity={focus ? 0.16 : 0.07} strokeLinecap="round" pointerEvents="none" />}
              <path d={d} fill="none" stroke={color(role)} strokeWidth={wd} strokeOpacity={on ? (focus ? 0.95 : flows ? 0.42 : 0.55) : 0.07}
                strokeDasharray={waste || e.feedback === false ? "5 4" : undefined} markerEnd={on && (!flows || focus) ? `url(#ar-${role})` : undefined} strokeLinecap="round">
                <title>{`${src?.label ?? e.from} → ${tgt?.label ?? e.to}${e.kind === "htl" || e.kind === "ltl" ? `\n偏好 a = ${e.w}${e.sigma ? `，摄食率 σ = ${e.sigma} d⁻¹` : ""}` : ""}${state && pr > 0 ? `\n相对摄食压力 ${(pr * 100).toFixed(0)}%（偏好 × 饵料生物量）` : ""}${e.feedback === false ? "\n单向耦合：鱼类不改变饵料" : ""}`}</title>
              </path>
              {Array.from({ length: nP }, (_, k) => (
                <circle key={k} r={1.6 + 1.4 * pr} fill={color(role)} stroke={dark ? "rgba(255,255,255,.85)" : "none"} strokeWidth={0.6} opacity={0} pointerEvents="none" filter={dark ? "url(#fw-glow)" : undefined}>
                  <animateMotion dur={`${dur}s`} begin={`${(-k * dur) / nP - (i % 7) * 0.37}s`} repeatCount="indefinite" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
                  <animate attributeName="opacity" dur={`${dur}s`} begin={`${(-k * dur) / nP - (i % 7) * 0.37}s`} repeatCount="indefinite" values="0;0.95;0.95;0" keyTimes="0;0.12;0.85;1" />
                </circle>
              ))}
            </g>
          );
        });
  return (
    <div ref={wrap} className="fw-wrap">
      <div ref={canvas} className="fw-canvas" style={{ minHeight: height }}>
      <svg width={W * scale} height={layout.H * scale} viewBox={`0 0 ${W} ${layout.H}`} onClick={() => onSelect?.(null)} style={{ display: "block", position: "absolute", inset: 0 }}>
        <defs>
          <filter id="fw-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="halo" />
            <feMerge><feMergeNode in="halo" /><feMergeNode in="halo" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {["phyto", "zoo", "fish", "benthos", "organic", "nutrient", "bacteria", "benthic"].map((r) => (
            <marker key={r} id={`ar-${r}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M0 1L9 5L0 9z" fill={color(r)} />
            </marker>
          ))}
        </defs>
        {layout.rows.map((r, i) => (
          <g key={r.label}>
            <rect x={0} y={layout.top + i * layout.rowH} width={W} height={layout.rowH} fill={i % 2 ? "transparent" : cssVar("--bg-side")} opacity={0.7} />
          </g>
        ))}
        {drawEdges("under")}
        {/* band names sit on a pill above the lines, so no line runs through the text */}
        {layout.rows.map((r, i) => (
          <g key={`lab-${r.label}`} pointerEvents="none">
            <rect x={6} y={layout.top + i * layout.rowH + 4} width={[...r.label].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 11 : 6.2), 0) + 12} height={17} rx={8.5} fill={cssVar("--bg")} stroke={cssVar("--border")} />
            <text x={12} y={layout.top + i * layout.rowH + 16} fontSize={11} fill={cssVar("--fg-soft")} fontWeight={600}>{r.label}</text>
          </g>
        ))}
        {g.nodes.map((n) => {
          const p = layout.pos[n.id];
          if (!p) return null;
          const s = state?.[n.var];
          const frac = s && maxBy[n.role] ? Math.max(0.03, s.value / maxBy[n.role]) : null;
          const dim = focus && focus !== n.id && !edges.some((e) => (e.from === focus && e.to === n.id) || (e.to === focus && e.from === n.id));
          const c = color(n.role);
          return (
            <g key={n.id} className={`fw-node ${selected === n.id ? "sel" : ""}`} transform={`translate(${p.x - NW / 2},${p.y - NH / 2})`}
              onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={(ev) => { ev.stopPropagation(); onSelect?.(n.id); }}>
              <rect className="body" width={NW} height={NH} rx={7} strokeWidth={1} />
              {/* the card stays opaque when dimmed (only its contents fade), so lines behind it don't show through */}
              <g opacity={dim ? 0.3 : 1}>
              {delta && delta[n.var] !== undefined && (
                <rect width={NW} height={NH} rx={7} fill={delta[n.var] >= 0 ? "#d6453c" : "#2a6fcb"} opacity={Math.min(0.45, 0.08 + Math.abs(delta[n.var]) / 60)} pointerEvents="none" />
              )}
              <rect width={5} height={NH} rx={2} fill={c} />
              {(() => {
                // "中型浮游动物 Z4" → name, then the model's code on a small second line (never broken mid-word)
                const m = /^(.*\S)\s+([A-Z][A-Za-z0-9/–\-]*)$/.exec(n.label);
                if (m) {
                  const size = 11.5 * fs, avail = NW - (delta && delta[n.var] !== undefined ? 70 : 22);
                  const name = wrap2(m[1], avail, size)[0];
                  const y0 = frac !== null ? (NH - 12) / 2 - 5 : NH / 2 - 6;
                  return <text x={14} y={y0} dominantBaseline="middle" fill={cssVar("--fg-strong")}><tspan fontSize={size} fontWeight={600}>{name}</tspan><tspan x={14} dy={size * 1.15} fontSize={9.5 * fs} fill={cssVar("--fg-soft")} className="mono">{m[2]}</tspan></text>;
                }
                const size = 12 * fs, lines = wrap2(n.label, NW - (delta && delta[n.var] !== undefined ? 70 : 22), size);
                const lh = size * 1.25, y0 = frac !== null ? (NH - 12) / 2 - ((lines.length - 1) * lh) / 2 + 1 : NH / 2 - ((lines.length - 1) * lh) / 2 + 1;
                return <text x={14} y={y0} dominantBaseline="middle" fontSize={size} fontWeight={600} fill={cssVar("--fg-strong")}>{lines.map((l, k) => <tspan key={k} x={14} dy={k ? lh : 0}>{l}</tspan>)}</text>;
              })()}
              {delta && delta[n.var] !== undefined && (
                <text x={NW - 8} y={NH / 2 + 1} textAnchor="end" dominantBaseline="middle" fontSize={12 * fs} fontWeight={700} fill={cssVar("--fg-strong")}>{delta[n.var] > 0 ? "+" : ""}{delta[n.var].toFixed(1)}%</text>
              )}
              {frac !== null && !delta && (
                <>
                  <rect x={14} y={NH - 13} width={Math.max(20, NW - 70)} height={5} rx={2.5} fill={cssVar("--bg-sunk")} />
                  <rect x={14} y={NH - 13} width={Math.max(20, NW - 70) * frac} height={5} rx={2.5} fill={c} />
                  <text x={NW - 8} y={NH - 10} textAnchor="end" dominantBaseline="middle" fontSize={10.5 * fs} fill={cssVar("--fg-muted")}>{fmt(s!.value, 3)}</text>
                </>
              )}
              </g>
              <title>{`${n.label}\n输出变量 ${n.var}${s ? `\n年均深度积分 ${fmt(s.value)} ${s.units}` : ""}`}</title>
            </g>
          );
        })}
        {/* lines of the node under the pointer go over the cards, so they read as one unbroken path */}
        {focus && drawEdges("top")}
      </svg>
      </div>
      <div className="fw-legend" style={{ position: "static", margin: 0, padding: "8px 14px 10px", maxWidth: "none", display: "flex", background: "none", border: 0, borderTop: "1px solid var(--border)", borderRadius: 0 }}>
        <span style={{ gap: 12, marginRight: 8 }}><span className="soft">显示</span><Check checked={showUptake} onChange={setShowUptake}><span className="small">营养盐吸收</span></Check><Check checked={showWaste} onChange={setShowWaste}><span className="small">排泄与碎屑流</span></Check></span>
        {[["nutrient", "营养盐"], ["phyto", "浮游植物"], ["bacteria", "细菌"], ["zoo", "浮游动物"], ["fish", "鱼类"], ["benthos", "底栖"], ["organic", "有机物"]].map(([r, l]) => (
          <span key={r}><span className="swatch" style={{ background: color(r) }} />{l}</span>
        ))}
        <span>线越粗，捕食者越偏爱这种食物 · {motion ? `流动的光点 = 能量从被吃者流向捕食者，${state ? "越密越快表示摄食压力（偏好 × 饵料生物量）越大" : "越密越快表示偏好越强"} · ` : ""}虚线 = 废物流 / 单向耦合{state ? " · 条形 = 年均生物量（同类相对）" : ""}</span>
      </div>
    </div>
  );
}
