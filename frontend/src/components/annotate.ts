// Shared figure annotations: events read straight off the plotted data, drawn as leader-line callouts.
// Every label here is derived from the same numbers the figure shows, so it can never contradict it.
import { useApp } from "../store";
import { cssVar, fmt } from "./ui";

export { prettyUnit } from "../units";
import { prettyUnit } from "../units";

/** Site latitude of the open project (null when unknown); seasons flip south of the equator. */
export function useSiteLat(): number | null {
  const p: any = useApp((s) => s.project);
  const site = p?.site_info || p?.site;
  return typeof site?.lat === "number" ? site.lat : null;
}

export function doyLabel(doy: number) { const d = new Date(Date.UTC(2001, 0, Math.round(doy))); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; }
export function seasonOf(doy: number, lat: number | null = null) {
  const shifted = lat !== null && lat < 0 ? ((doy + 182 - 1) % 365) + 1 : doy;
  const m = Math.floor(((shifted - 1) / 365) * 12) + 1;
  return m >= 3 && m <= 5 ? "春季" : m >= 6 && m <= 8 ? "夏季" : m >= 9 && m <= 11 ? "秋季" : "冬季";
}

export interface SeasonEvent { x: number | string; y: number; title: string; sub?: string; low?: boolean; detail?: string }

const IS = {
  phyto: (v: string) => /^(P[1-4]_|ECO_(fla|dia|bg)|.*[Cc]hl|ergom_(pp|ff|bb))/.test(v),
  zoo: (v: string) => /^(Z[4-6]_|ECO_(meso|micro)zoo|ergom_zz)/.test(v),
  fish: (v: string) => /^(F1|F2|fish)/.test(v),
  benthos: (v: string) => /^(MB|Y[2-4]_)/.test(v),
  temp: (v: string) => /^(temp|sst|sbt)/.test(v),
  nut: (v: string) => /^(N[1-5]_|ECO_(no3|nh4|pho|sil)|ergom_(nn|aa|po))/.test(v),
  oxy: (v: string) => /^(O2_|ECO_oxy|ergom_o2)/.test(v),
};

/** Seasonal events of an annual cycle (day of year → value): the peak, a clear second peak, and the low point
 *  where it carries meaning (temperature, nutrients, oxygen). Named by what the variable is. */
export function annualEvents(v: string, doy: number[], y: (number | null)[], lat: number | null = null): SeasonEvent[] {
  const pts = doy.map((d, i) => ({ d, y: y[i] })).filter((p) => p.y !== null && isFinite(p.y as number)) as { d: number; y: number }[];
  if (pts.length < 10) return [];
  const hi = pts.reduce((a, b) => (b.y > a.y ? b : a)), lo = pts.reduce((a, b) => (b.y < a.y ? b : a));
  const r = hi.y - lo.y;
  if (!(r > 0) || r < 1e-3 * Math.abs(hi.y)) return [];
  const peakName = (d: number) => IS.phyto(v) ? `${seasonOf(d, lat)}水华` : IS.zoo(v) ? `浮游动物${seasonOf(d, lat)}高峰` : IS.fish(v) ? "鱼类最多" : IS.benthos(v) ? "底栖动物最多" : IS.temp(v) ? "全年最暖" : IS.nut(v) ? "营养盐最高" : IS.oxy(v) ? "溶解氧最高" : "全年最高";
  const out: SeasonEvent[] = [{ x: hi.d, y: hi.y, title: peakName(hi.d), sub: doyLabel(hi.d) }];
  // a second peak: a local maximum at least 30 % of the range above the minimum and 20 days from the main one
  const step = Math.max(1, Math.round(pts.length / 120));
  let second: { d: number; y: number } | null = null;
  for (let i = 3 * step; i < pts.length - 3 * step; i++) {
    const p = pts[i];
    if (Math.abs(p.d - hi.d) < 20 || p.y < lo.y + 0.3 * r) continue;
    if (pts.slice(i - 3 * step, i + 3 * step + 1).every((q) => q.y <= p.y) && (!second || p.y > second.y)) second = p;
  }
  if (second) out.push({ x: second.d, y: second.y, title: IS.phyto(v) || IS.zoo(v) ? `第二次高峰（${seasonOf(second.d, lat)}）` : "第二个高点", sub: doyLabel(second.d) });
  if (IS.temp(v) || IS.nut(v) || IS.oxy(v)) out.push({ x: lo.d, y: lo.y, title: IS.temp(v) ? "全年最冷" : IS.nut(v) ? (lo.y < 0.1 * hi.y ? "被藻类耗尽" : "全年最低") : "溶解氧最低", sub: doyLabel(lo.d), low: true });
  return out.sort((a, b) => +a.x - +b.x);
}

/** Highest (and optionally lowest) point of any series, for figures without a seasonal meaning. */
export function extremeEvents(x: (number | string)[], y: (number | null)[], hiTitle: string, loTitle?: string, xLabel: (x: any) => string = String): SeasonEvent[] {
  const pts = x.map((xx, i) => ({ x: xx, y: y[i] })).filter((p) => p.y !== null && isFinite(p.y as number)) as { x: number | string; y: number }[];
  if (pts.length < 2) return [];
  const hi = pts.reduce((a, b) => (b.y > a.y ? b : a)), lo = pts.reduce((a, b) => (b.y < a.y ? b : a));
  if (hi.y === lo.y) return [];
  const out: SeasonEvent[] = [{ x: hi.x, y: hi.y, title: hiTitle, sub: xLabel(hi.x) }];
  if (loTitle) out.push({ x: lo.x, y: lo.y, title: loTitle, sub: xLabel(lo.x), low: true });
  return out;
}

export interface PlaceSeries { x: (number | string)[]; y: (number | null)[] }
const toNum = (x: number | string) => (typeof x === "number" ? x : Date.parse(x));

/**
 * Where to put each callout so it hides no data: try spots around the point (above, beside, below, near and far),
 * count the plotted points (and interpolated segments) a label box there would cover, plus other labels, and take
 * the cheapest. Coordinates are data units, so the result goes to Plotly with axref/ayref set to the axes.
 */
/** Pixel size of a callout: CJK glyphs one em wide, Latin and digits about 0.6 em, plus padding. */
function labelPx(e: SeasonEvent, second: string): [number, number] {
  const w = (t: string, size: number) => [...t.replace(/<[^>]+>/g, "")].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? size : size * 0.6), 0);
  return [Math.max(w(e.title, 11.5), w(second, 10.5)) + 14, (second ? 30 : 17) + 8];
}

export function placeCallouts(events: SeasonEvent[], series: PlaceSeries[], opts: { xRange?: [number, number]; yRange?: [number, number]; wFrac?: number; hFrac?: number; px?: [number, number]; seconds?: string[] } = {}) {
  const pts: [number, number][] = [];
  for (const s of series) {
    const xs = s.x.map(toNum);
    const fin = s.y.filter((v) => v !== null && isFinite(v as number)) as number[];
    const yspan = (Math.max(...fin) - Math.min(...fin)) || 1;
    const dense = xs.length >= 150;
    for (let i = 0; i < xs.length; i++) {
      const y = s.y[i];
      if (y === null || !isFinite(y)) continue;
      pts.push([xs[i], y]);
      const y2 = s.y[i + 1];
      if (i + 1 >= xs.length || y2 === null || y2 === undefined || !isFinite(y2)) continue;
      // fill in each segment so the line itself counts: every segment of a sparse curve, and the steep ones of a
      // dense curve (a spike between two daily values would otherwise be invisible to the test)
      const steps = dense ? Math.min(12, Math.floor((Math.abs(y2 - y) / yspan) * 40)) : 8;
      for (let k = 1; k < steps; k++) pts.push([xs[i] + ((xs[i + 1] - xs[i]) * k) / steps, y + ((y2 - y) * k) / steps]);
    }
  }
  if (!pts.length) return events.map(() => null);
  const xr = opts.xRange ?? [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  const yr = opts.yRange ?? (() => { const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1])); return [lo, hi + 0.24 * (hi - lo || 1)] as [number, number]; })();
  const xs = xr[1] - xr[0] || 1, ys = yr[1] - yr[0] || 1;
  // plot area in pixels (estimated from the window when the caller does not know it): label boxes are sized from
  // their text, so a long label gets the room it really needs
  const plotPx = opts.px ?? [Math.max(300, window.innerWidth - 780), Math.max(200, window.innerHeight - 300)];
  const placed: [number, number, number, number][] = [];
  return events.map((e, ei) => {
    const [lw, lh] = labelPx(e, opts.seconds?.[ei] ?? "");
    // a little larger than the text itself, so a curve passing just outside the box still clears the label
    const W = Math.max((opts.wFrac ?? 0) * xs, (lw / plotPx[0]) * xs) * 1.12, H = Math.max((opts.hFrac ?? 0) * ys * 0.6, (lh / plotPx[1]) * ys) * 1.15;
    const px = toNum(e.x), py = e.y;
    let best: { cx: number; cy: number; cost: number } | null = null;
    for (const fy of [1.4, 2.2, -1.4, -2.2, 3, -3, 4, -4, 0]) for (const fx of [0, 0.8, -0.8, 1.5, -1.5, 2.2, -2.2]) {
      if (fy === 0 && fx === 0) continue;
      const cx = px + fx * W, cy = py + fy * H;
      const x0 = cx - W / 2, x1 = cx + W / 2, y0 = cy - H / 2, y1 = cy + H / 2;
      if (x0 < xr[0] - 0.02 * xs || x1 > xr[1] + 0.02 * xs || y0 < yr[0] || y1 > yr[1]) continue;
      let hits = 0;
      for (const [x, y] of pts) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) hits++;
      const clash = placed.filter(([a0, a1, b0, b1]) => x0 < a1 && x1 > a0 && y0 < b1 && y1 > b0).length;
      // also keep the label clear of the point itself and of the other events' points
      const own = events.some((q) => { const qx = toNum(q.x); return qx >= x0 && qx <= x1 && q.y >= y0 && q.y <= y1; }) ? 1 : 0;
      // the leader from the point to the label should not run through the data either
      let cross = 0;
      for (let k = 1; k < 10; k++) {
        const lx = px + ((cx - px) * k) / 10, ly = py + ((cy - py) * k) / 10, rx = xs * 0.006, ry = ys * 0.02;
        for (const [x, y] of pts) if (Math.abs(x - lx) < rx && Math.abs(y - ly) < ry) { cross++; break; }
      }
      const cost = hits * 10 + clash * 100 + own * 20 + cross * 4 + Math.hypot(fx, fy);
      if (!best || cost < best.cost) best = { cx, cy, cost };
    }
    if (!best) return null;
    placed.push([best.cx - W / 2, best.cx + W / 2, best.cy - H / 2, best.cy + H / 2]);
    return { ax: typeof e.x === "string" ? new Date(best.cx).toISOString() : best.cx, ay: best.cy };
  });
}

/** Plotly annotations + a marker trace for a list of events. Labels sit on the page colour; with `series` given they
 *  are placed where they cover no data (see placeCallouts), otherwise they use fixed pixel offsets. */
export function eventLayer(events: SeasonEvent[], opts: { units?: string; xaxis?: string; yaxis?: string; digits?: number; color?: string; series?: PlaceSeries[]; xRange?: [number, number]; yRange?: [number, number]; wFrac?: number; hFrac?: number; px?: [number, number] } = {}) {
  const glow = opts.color ?? cssVar("--glow");
  const u = prettyUnit(opts.units);
  const xref = opts.xaxis ?? "x", yref = opts.yaxis ?? "y";
  const seconds = events.map((e) => e.detail ?? `${e.sub ? `${e.sub} · ` : ""}${fmt(e.y, opts.digits ?? 3)}${u ? ` ${u}` : ""}`);
  const spots = opts.series ? placeCallouts(events, opts.series, { ...opts, seconds }) : events.map(() => null);
  // fallback: stagger callouts whose points are close together so their labels never sit on top of each other
  const num = (x: number | string) => (typeof x === "number" ? x : Date.parse(x));
  const xs = events.map((e) => num(e.x)), span = (Math.max(...xs) - Math.min(...xs)) || 1;
  const place = events.map(() => ({ ax: 0, ay: -34 }));
  events.forEach((e, i) => {
    if (e.low) { place[i] = { ax: 0, ay: -30 }; return; }
    const near = events.slice(0, i).some((q, j) => !q.low && Math.abs(xs[j] - xs[i]) < 0.18 * Math.max(span, 1));
    if (near) place[i] = { ax: xs[i] >= xs[i - 1] ? 70 : -70, ay: -34 - 26 * (i % 3) };
  });
  const annotations = events.map((e, i) => ({
    x: e.x, y: e.y, xref, yref, showarrow: true, arrowhead: 0, arrowwidth: 1, arrowcolor: glow, standoff: 4, borderpad: 3,
    ...(spots[i] ? { axref: xref, ayref: yref, ax: spots[i]!.ax, ay: spots[i]!.ay, xanchor: "center", yanchor: "middle" } : { ax: place[i].ax, ay: place[i].ay }),
    text: (() => { const second = seconds[i]; return `<b>${e.title}</b>${second ? `<br><span style="font-size:10.5px;color:${cssVar("--fg-soft")}">${second}</span>` : ""}`; })(),
    align: "center", font: { size: 11.5, color: cssVar("--fg-strong") }, bgcolor: cssVar("--bg"),
  }));
  const marker = events.length ? {
    x: events.map((e) => e.x), y: events.map((e) => e.y), xaxis: xref, yaxis: yref, type: "scatter", mode: "markers",
    marker: { size: 7, color: glow, line: { width: 1.5, color: cssVar("--bg") } }, hoverinfo: "skip", showlegend: false,
  } : null;
  return { annotations, marker };
}

/** Head-room so callouts above the highest point stay inside the axes. */
export function headroom(ys: (number | null)[], top = 0.24, bottom = 0.04): [number, number] | undefined {
  const v = ys.filter((y) => y !== null && isFinite(y as number)) as number[];
  if (!v.length) return undefined;
  const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || Math.abs(hi) || 1;
  return [lo - bottom * r, hi + top * r];
}

/** Running mean over a number of days, whatever the output interval. */
export function smoothDays(time: string[], values: (number | null)[], days: number): (number | null)[] {
  if (values.length < 3) return values;
  const t0 = Date.parse(time[0]), t1 = Date.parse(time[time.length - 1]);
  const perDay = (values.length - 1) / Math.max(1e-6, (t1 - t0) / 86400000);
  const half = Math.max(0, Math.round((days * perDay) / 2));
  if (!half) return values;
  return values.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) if (values[j] !== null) { s += values[j]!; n++; }
    return n ? s / n : null;
  });
}


/** Depth of the steepest vertical gradient in a profile (thermocline, nutricline…); null when the column is uniform. */
export function clineDepth(depth: number[], values: (number | null)[], minRel = 0.02): number | null {
  const fin = values.filter((x) => x !== null && isFinite(x as number)) as number[];
  if (fin.length < 3) return null;
  const range = Math.max(...fin) - Math.min(...fin);
  let best = 0, z: number | null = null;
  for (let k = 1; k < depth.length; k++) {
    const a = values[k - 1], b = values[k];
    if (a === null || b === null) continue;
    const g = Math.abs(b - a) / Math.max(1e-6, Math.abs(depth[k] - depth[k - 1]));
    if (g > best) { best = g; z = (depth[k] + depth[k - 1]) / 2; }
  }
  // ignore columns whose whole top-to-bottom contrast is a few percent of the value
  return range > minRel * Math.max(...fin.map(Math.abs)) ? z : null;
}
