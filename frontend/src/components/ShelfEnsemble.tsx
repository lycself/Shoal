// Monthly course of every simulated column in a shelf study, drawn as one thin line each.
// At the right edge the lines of each depth zone sweep into one point at the zone's annual mean,
// so the eye reads both the spread of the ensemble and where each zone settles.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { DEPTH_BANDS } from "./ShelfExplain";
import { Empty, Select, cssVar, fmt, fmtLatLon } from "./ui";

const LABEL: Record<string, string> = { temp: "表层温度", F1_c: "鱼 1 生物量", F2_c: "鱼 2 生物量", MB_c: "大型底栖生物量", fish_c_tot: "鱼类群落湿重", Z4_c: "中型浮游动物（深度积分）", ECO_mesozoo: "中型浮游动物", ergom_zz: "浮游动物" };
const UNIT: Record<string, string> = { temp: "°C" };
// sequential by depth: shallow = teal, deep = violet; dark variants are lighter so they read on navy
const BAND_COL: [string, string][] = [["#2a9d8f", "#7fe3d4"], ["#2b8fd1", "#5ab8f0"], ["#2f62c4", "#7d9cf8"], ["#6a46b8", "#ad93f6"], ["#8a3a96", "#dc93df"]]; // design:allow-colour depth-zone ramp
const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
/** Catmull–Rom through the points, as cubic Béziers (smooth without overshooting much at 12 points). */
function smooth(pts: [number, number][]) {
  if (!pts.length) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}
function niceTicks(lo: number, hi: number, n = 5) {
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(10));
  return out;
}

export function ShelfEnsemble({ results }: { results: any[] }) {
  const dark = useApp((s) => s.dark);
  const keys = Object.keys(results[0]?.points?.[0]?.monthly ?? {});
  const [v, setV] = useState(keys.includes("temp") ? "temp" : keys[0]);
  const [ci, setCi] = useState(0);
  const [hoverBand, setHoverBand] = useState<number | null>(null);
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(1000);
  useEffect(() => {
    const ro = new ResizeObserver(() => wrap.current && setW(Math.max(720, wrap.current.clientWidth)));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const r = results[Math.min(ci, results.length - 1)];
  const cols = useMemo(() => (r?.points ?? []).map((p: any, i: number) => {
    const ys = (p.monthly?.[v] ?? []) as (number | null)[];
    const band = DEPTH_BANDS.findIndex(([, a, b]) => (p.depth ?? 0) >= a && (p.depth ?? 0) < b);
    return { i, lat: p.lat, lon: p.lon, depth: p.depth, band, ys };
  }).filter((c: any) => c.ys.length === 12 && c.ys.every((y: any) => y !== null && isFinite(y))), [r, v]);

  const bands = useMemo(() => DEPTH_BANDS.map(([name], b) => {
    const cs = cols.filter((c: any) => c.band === b);
    if (!cs.length) return null;
    const med = MONTHS.map((_, m) => quantile(cs.map((c: any) => c.ys[m]), 0.5));
    const mean = cs.reduce((a: number, c: any) => a + c.ys.reduce((x: number, y: number) => x + y, 0) / 12, 0) / cs.length;
    const peak = med.indexOf(Math.max(...med)), low = med.indexOf(Math.min(...med));
    return { b, name, n: cs.length, med, mean, peak, low, amp: med[peak] - med[low] };
  }).filter(Boolean) as { b: number; name: string; n: number; med: number[]; mean: number; peak: number; low: number; amp: number }[], [cols]);

  if (!keys.length) return <Empty icon="graph-line" title="这个研究没有逐月数据" />;
  if (!cols.length) return <Empty icon="graph-line" title={`所选配置里没有“${LABEL[v] ?? v}”`}>请换一个配置或变量。</Empty>;

  const H = 500, left = 64, top = 24, bottom = 40, labelW = 230, plotR = W - labelW - 90, convX = W - labelW - 14;
  const all = cols.flatMap((c: any) => c.ys as number[]);
  const lo0 = Math.min(...all), hi0 = Math.max(...all), pad = (hi0 - lo0) * 0.06 || 1;
  const lo = lo0 - pad, hi = hi0 + pad;
  const xOf = (m: number) => left + ((plotR - left) * m) / 11;
  const yOf = (y: number) => top + (H - top - bottom) * (1 - (y - lo) / (hi - lo));
  const col = (b: number) => BAND_COL[b][dark ? 1 : 0];
  const unit = UNIT[v] ?? "";
  const soft = cssVar("--fg-soft");

  // labels at each zone's mean, pushed apart so they never overlap
  const GAP = 58;
  const labels = bands.map((z) => ({ ...z, y0: yOf(z.mean), y: yOf(z.mean) })).sort((a, b) => a.y0 - b.y0);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + GAP);
  const over = labels.length ? labels[labels.length - 1].y - (H - bottom - 20) : 0;
  if (over > 0) for (let i = labels.length - 1; i >= 0; i--) labels[i].y = i === labels.length - 1 ? labels[i].y - over : Math.min(labels[i].y, labels[i + 1].y - GAP);

  // ensemble spread per month: 10–90 % range relative to the median (where do the columns disagree most?)
  const spread = MONTHS.map((_, m) => { const xs = cols.map((c: any) => c.ys[m]); const md = quantile(xs, 0.5); return (quantile(xs, 0.9) - quantile(xs, 0.1)) / (Math.abs(md) || 1); });
  const sMax = spread.indexOf(Math.max(...spread)), sMin = spread.indexOf(Math.min(...spread));
  const focusBand = hoverCol !== null ? cols.find((c: any) => c.i === hoverCol)?.band ?? null : hoverBand;
  const hc = hoverCol !== null ? cols.find((c: any) => c.i === hoverCol) : null;
  const zHi = [...bands].sort((a, b) => b.mean - a.mean)[0], zAmp = [...bands].sort((a, b) => b.amp - a.amp)[0];

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap">
        <span className="opt">变量<Select size="sm" value={v} onChange={setV}>{keys.map((k) => <option key={k} value={k}>{LABEL[k] ?? k}</option>)}</Select></span>
        {results.length > 1 && <span className="opt">配置<Select size="sm" value={ci} onChange={(x) => setCi(+x)}>{results.map((x, i) => <option key={i} value={i}>{x.config_name}</option>)}</Select></span>}
        <span className="soft small">{cols.length} 根水柱 · 每条细线是一根水柱的逐月平均</span>
      </div>
      <div ref={wrap} className="ens-wrap">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} onMouseLeave={() => { setHoverCol(null); setHoverBand(null); }}>
          <defs>
            {bands.map((z) => (
              <linearGradient key={z.b} id={`beam-${z.b}`} gradientUnits="userSpaceOnUse" x1={plotR} x2={convX} y1={0} y2={0}>
                <stop offset="0" stopColor={col(z.b)} stopOpacity={0.15} />
                <stop offset="1" stopColor={col(z.b)} stopOpacity={0.9} />
              </linearGradient>
            ))}
            <filter id="ens-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {/* axes */}
          {niceTicks(lo, hi).map((t) => (
            <g key={t}>
              <line x1={left} x2={plotR} y1={yOf(t)} y2={yOf(t)} stroke={cssVar("--plot-grid")} />
              <text x={left - 8} y={yOf(t) + 4} textAnchor="end" fontSize={11} fill={soft}>{fmt(t, 3)}</text>
            </g>
          ))}
          {MONTHS.map((m, k) => <text key={m} x={xOf(k)} y={H - bottom + 18} textAnchor="middle" fontSize={11} fill={soft}>{m}</text>)}
          <text x={14} y={(top + H - bottom) / 2} fontSize={11} fill={soft} textAnchor="middle" transform={`rotate(-90 14 ${(top + H - bottom) / 2})`}>{LABEL[v] ?? v}{unit ? ` (${unit})` : ""}</text>
          <line x1={xOf(sMax)} x2={xOf(sMax)} y1={top} y2={H - bottom} stroke={cssVar("--glow")} strokeOpacity={0.35} strokeDasharray="3 4" />
          <text x={xOf(sMax) + 5} y={top + 10} fontSize={10.5} fill={cssVar("--glow")}>各水柱分歧最大</text>
          {/* the beams after December are not a 13th month: a divider says they lead to each zone's annual mean */}
          <line x1={plotR + 8} x2={plotR + 8} y1={top} y2={H - bottom} stroke={cssVar("--border-strong")} strokeDasharray="2 3" />
          <text x={(plotR + convX) / 2} y={H - bottom + 18} textAnchor="middle" fontSize={11} fill={soft}>全年平均 →</text>
          {/* one line per column, then its beam into the zone point */}
          {cols.map((c: any) => {
            const pts = c.ys.map((y: number, m: number) => [xOf(m), yOf(y)] as [number, number]);
            const z = bands.find((q) => q.b === c.band)!;
            const ex = pts[11][0], ey = pts[11][1], ty = yOf(z.mean), dx = convX - ex;
            const on = focusBand === null || focusBand === c.band;
            const me = hoverCol === c.i;
            const d = smooth(pts);
            const beam = `M${ex},${ey} C${ex + dx * 0.55},${ey} ${convX - dx * 0.45},${ty} ${convX},${ty}`;
            return (
              <g key={c.i} onMouseEnter={() => setHoverCol(c.i)}>
                <path d={d} fill="none" stroke="transparent" strokeWidth={7} />
                <path d={d} fill="none" stroke={col(c.band)} strokeWidth={me ? 2.4 : 1} strokeOpacity={me ? 1 : on ? (dark ? 0.38 : 0.45) : 0.06} />
                <path d={beam} fill="none" stroke={`url(#beam-${c.band})`} strokeWidth={me ? 1.8 : 0.9} strokeOpacity={on ? (me ? 1 : 0.7) : 0.08} />
              </g>
            );
          })}
          {/* zone medians */}
          {bands.map((z) => (
            <path key={z.b} d={smooth(z.med.map((y, m) => [xOf(m), yOf(y)] as [number, number]))} fill="none" stroke={col(z.b)} strokeWidth={2.4}
              strokeOpacity={focusBand === null || focusBand === z.b ? 1 : 0.15} pointerEvents="none" filter={dark ? "url(#ens-glow)" : undefined} />
          ))}
          {/* convergence points and their labels */}
          {labels.map((z) => {
            const on = focusBand === null || focusBand === z.b;
            const lx = convX + 22;
            return (
              <g key={z.b} opacity={on ? 1 : 0.3} onMouseEnter={() => { setHoverCol(null); setHoverBand(z.b); }} style={{ cursor: "default" }}>
                <circle cx={convX} cy={z.y0} r={4} fill={col(z.b)} filter={dark ? "url(#ens-glow)" : undefined} />
                <circle cx={convX} cy={z.y0} r={1.8} fill={dark ? "#fff" : cssVar("--bg")} />
                <path d={`M${convX + 5},${z.y0} L${lx - 6},${z.y} H${W - 8}`} fill="none" stroke={col(z.b)} strokeOpacity={0.6} />
                <text x={lx} y={z.y - 6} fontSize={12} fontWeight={600} fill={cssVar("--fg-strong")}>{z.name}</text>
                <text x={lx} y={z.y + 11} fontSize={10} fill={soft}>{z.n} 根水柱 · 全年平均</text>
                <text x={lx} y={z.y + 27} fontSize={11.5} className="mono" fill={col(z.b)}>{fmt(z.mean, 3)}{unit ? ` ${unit}` : ""}<tspan fill={soft} fontSize={10}>{`  峰值 ${MONTHS[z.peak]}`}</tspan></text>
              </g>
            );
          })}
          {hc && (
            <g pointerEvents="none">
              <rect x={left + 8} y={top + 4} width={250} height={40} rx={5} fill={cssVar("--bg-tooltip")} stroke={cssVar("--border-strong")} />
              <text x={left + 18} y={top + 20} fontSize={12} fontWeight={600} fill={cssVar("--fg-strong")}>{fmtLatLon(hc.lat, hc.lon, 1)} · 水深 {hc.depth?.toFixed(0)} m</text>
              <text x={left + 18} y={top + 36} fontSize={11} fill={soft}>全年 {fmt(Math.min(...hc.ys), 3)} – {fmt(Math.max(...hc.ys), 3)} {unit}，峰值在 {MONTHS[hc.ys.indexOf(Math.max(...hc.ys))]}</text>
            </g>
          )}
        </svg>
      </div>
      <div className="reading-cols">
        <div>
          <h4>这张图说明了什么</h4>
          <p>{zHi.name}的全年平均值最高（{fmt(zHi.mean, 3)}{unit ? ` ${unit}` : ""}）。{bands.length > 1 ? `季节振幅最大的是${zAmp.name}，峰谷差达 ${fmt(zAmp.amp, 3)}${unit ? ` ${unit}` : ""}。` : ""}</p>
          <p>{MONTHS[sMax]}各水柱之间的空间离散度最大，{MONTHS[sMin]}最为一致。离散度大的月份表明该变量受局地水深、层化与营养盐条件控制明显；一致性高的月份则主要由大尺度气象强迫和太阳辐射主导。</p>
        </div>
        <div>
          <h4>怎么读</h4>
          <p>每条细线代表一根模拟水柱 1–12 月的逐月变化，颜色区分水深分区（由浅至深从青绿过渡到紫色），粗线为各水深分区的中位数。</p>
          <p>右侧曲线束收拢至各分区的全年平均值：线束越宽，说明同一水深带内部的空间差异越大。悬停细线可查看对应水柱的经纬度与水深，悬停右侧分区标签可单独高亮该水深带。</p>
        </div>
      </div>
    </div>
  );
}
