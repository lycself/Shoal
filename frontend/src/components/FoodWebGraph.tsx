import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { Check, ROLE_VAR, cssVar, fmt } from "./ui";

export interface FWNode { id: string; level: number; group: string; label: string; role: string; var: string }
export interface FWEdge { from: string; to: string; w: number; kind: string; sigma?: number; feedback?: boolean }

const ROWS: [string, (n: FWNode) => boolean][] = [
  ["顶层鱼类", (n) => n.level >= 3.8],
  ["鱼类", (n) => n.level >= 3 && n.level < 3.8],
  ["中型浮游动物 · 底栖动物", (n) => n.level >= 2.4 && n.level < 3],
  ["小型浮游动物", (n) => n.level >= 1.9 && n.level < 2.4],
  ["初级生产者 · 细菌", (n) => n.level >= 1 && n.level < 1.9],
  ["营养盐 · 有机物 · 沉积物", (n) => n.level < 1],
];
const GROUP_ORDER = ["det", "nut", "pel", "mic", "htl", "ben"];
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const NW = 150, NH = 44;

function mergeNutrients(graph: { nodes: FWNode[]; edges: FWEdge[] }) {
  const nut = graph.nodes.filter((n) => n.role === "nutrient");
  if (nut.length <= 1) return graph;
  const id = "__NUT__";
  const ids = new Set(nut.map((n) => n.id));
  const nodes = [...graph.nodes.filter((n) => !ids.has(n.id)), { id, level: 0, group: "nut", label: "营养盐（N · P · Si）", role: "nutrient", var: nut[0].var }];
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
  const [W, setW] = useState(900);
  const [hover, setHover] = useState<string | null>(null);
  const [showWaste, setShowWaste] = useState(false);
  const [showUptake, setShowUptake] = useState(false);
  useEffect(() => {
    const ro = new ResizeObserver(() => wrap.current && setW(Math.max(640, wrap.current.clientWidth)));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const g = useMemo(() => mergeNutrients(graph), [graph]);

  const layout = useMemo(() => {
    const rows = ROWS.map(([label, f]) => ({ label, nodes: g.nodes.filter(f) })).filter((r) => r.nodes.length);
    const left = 132, right = 24, top = 18, bottom = 18;
    const rowH = Math.max(78, (height - top - bottom) / Math.max(1, rows.length));
    const pos: Record<string, { x: number; y: number }> = {};
    rows.forEach((r, ri) => {
      r.nodes.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.id.localeCompare(b.id));
      const n = r.nodes.length;
      const span = W - left - right;
      r.nodes.forEach((node, i) => {
        pos[node.id] = { x: left + (span * (i + 0.5)) / n, y: top + rowH * (ri + 0.5) };
      });
    });
    return { rows, pos, rowH, top, H: top + bottom + rowH * rows.length, left };
  }, [g, W, height]);

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

  return (
    <div ref={wrap} className="fw-wrap">
      <div className="row" style={{ position: "absolute", right: 10, top: 6, gap: 14, zIndex: 2 }}>
        <Check checked={showUptake} onChange={setShowUptake}><span className="small muted">营养盐吸收</span></Check>
        <Check checked={showWaste} onChange={setShowWaste}><span className="small muted">排泄与碎屑流</span></Check>
      </div>
      <svg width={W} height={layout.H} viewBox={`0 0 ${W} ${layout.H}`} onClick={() => onSelect?.(null)} style={{ display: "block" }}>
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
            <text x={14} y={layout.top + (i + 0.5) * layout.rowH} dominantBaseline="middle" fontSize={11.5} fill={cssVar("--fg-soft")} fontWeight={600}>{r.label}</text>
          </g>
        ))}
        {edges.map((e, i) => {
          const a = layout.pos[e.from], b = layout.pos[e.to];
          if (!a || !b) return null;
          const tgt = nodeById[e.to], src = nodeById[e.from];
          const up = b.y < a.y - 4;
          const y1 = up ? a.y - NH / 2 : a.y + (b.y > a.y + 4 ? NH / 2 : 0);
          const y2 = up ? b.y + NH / 2 + 2 : b.y - (b.y > a.y + 4 ? NH / 2 + 2 : 0);
          const same = Math.abs(a.y - b.y) <= 4;
          const x1 = same ? a.x + (b.x > a.x ? NW / 2 : -NW / 2) : a.x, x2 = same ? b.x - (b.x > a.x ? NW / 2 + 2 : -NW / 2 - 2) : b.x;
          const dy = Math.max(30, Math.abs(y2 - y1) * 0.45);
          const d = same
            ? `M${x1},${a.y} C${(x1 + x2) / 2},${a.y - 40} ${(x1 + x2) / 2},${b.y - 40} ${x2},${b.y}`
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
        })}
        {g.nodes.map((n) => {
          const p = layout.pos[n.id];
          if (!p) return null;
          const s = state?.[n.var];
          const frac = s && maxBy[n.role] ? Math.max(0.03, s.value / maxBy[n.role]) : null;
          const dim = focus && focus !== n.id && !edges.some((e) => (e.from === focus && e.to === n.id) || (e.to === focus && e.from === n.id));
          const c = color(n.role);
          return (
            <g key={n.id} className={`fw-node ${selected === n.id ? "sel" : ""}`} transform={`translate(${p.x - NW / 2},${p.y - NH / 2})`} opacity={dim ? 0.28 : 1}
              onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={(ev) => { ev.stopPropagation(); onSelect?.(n.id); }}>
              <rect className="body" width={NW} height={NH} rx={7} strokeWidth={1} />
              {delta && delta[n.var] !== undefined && (
                <rect width={NW} height={NH} rx={7} fill={delta[n.var] >= 0 ? "#d6453c" : "#2a6fcb"} opacity={Math.min(0.45, 0.08 + Math.abs(delta[n.var]) / 60)} pointerEvents="none" />
              )}
              <rect width={5} height={NH} rx={2} fill={c} />
              <text x={14} y={frac !== null ? 17 : NH / 2 + 1} dominantBaseline="middle" fontSize={12} fontWeight={600} fill={cssVar("--fg-strong")}>{n.label.length > 13 ? n.label.slice(0, 12) + "…" : n.label}</text>
              {delta && delta[n.var] !== undefined && (
                <text x={NW - 8} y={NH / 2 + 1} textAnchor="end" dominantBaseline="middle" fontSize={12} fontWeight={700} fill={cssVar("--fg-strong")}>{delta[n.var] > 0 ? "+" : ""}{delta[n.var].toFixed(1)}%</text>
              )}
              {frac !== null && !delta && (
                <>
                  <rect x={14} y={28} width={NW - 70} height={5} rx={2.5} fill={cssVar("--bg-sunk")} />
                  <rect x={14} y={28} width={(NW - 70) * frac} height={5} rx={2.5} fill={c} />
                  <text x={NW - 8} y={31} textAnchor="end" dominantBaseline="middle" fontSize={10.5} fill={cssVar("--fg-muted")}>{fmt(s!.value, 3)}</text>
                </>
              )}
              <title>{`${n.label}\n输出变量 ${n.var}${s ? `\n年均深度积分 ${fmt(s.value)} ${s.units}` : ""}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="fw-legend" style={{ position: "static", margin: "6px 12px 12px", maxWidth: "none", display: "inline-flex" }}>
        {[["nutrient", "营养盐"], ["phyto", "浮游植物"], ["bacteria", "细菌"], ["zoo", "浮游动物"], ["fish", "鱼类"], ["benthos", "底栖"], ["organic", "有机物"]].map(([r, l]) => (
          <span key={r}><span className="swatch" style={{ background: color(r) }} />{l}</span>
        ))}
        <span>线宽 ∝ 摄食偏好 · {motion ? `流动的光点 = 能量从被吃者流向捕食者，${state ? "越密越快表示摄食压力（偏好 × 饵料生物量）越大" : "越密越快表示偏好越强"} · ` : ""}虚线 = 废物流 / 单向耦合{state ? " · 条形 = 年均生物量（同类相对）" : ""}</span>
      </div>
    </div>
  );
}
