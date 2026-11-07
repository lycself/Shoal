/**
 * Figure reading for the shelf (column-ensemble) views.
 *
 * Everything a reader needs to turn a map into a statement about the ecosystem:
 *  - what the plotted quantity is (beginner definition),
 *  - what the figure shows, computed from the data (area means, regional contrasts, depth and
 *    cross-metric correlations),
 *  - why it happens, for configuration pairs whose difference is known (one-way vs two-way MIZER,
 *    lower-trophic baseline vs a run with fish),
 *  - how to read the colours, and what the figure cannot tell you.
 *
 * Mechanism sentences are conditioned on the sign of the computed change, so the text never
 * contradicts the map.
 */
import type { ReactNode } from "react";
import { fmt } from "./ui";

export type ConfigKind = "ltl" | "oneway" | "twoway" | "e2e" | "other";

export function configKind(cfg: any): ConfigKind {
  const h = cfg?.spec?.htl;
  if (!h) return "other";
  if (h.kind === "none") return "ltl";
  if (h.kind === "mizer") return h.mizer?.feedback === false ? "oneway" : "twoway";
  if (h.kind === "e2e") return "e2e";
  return "other";
}

/** Key for the mechanism text of a (reference → comparison) pair; "" when no specific explanation applies. */
export function pairKeyOf(cfgA: any, cfgB: any): string {
  const k = `${configKind(cfgA)}>${configKind(cfgB)}`;
  // the closure-replacement sentence only holds when the two-way run really switched the Z4 closure off
  if (k === "oneway>twoway" && cfgB?.spec?.ltl?.z4_cannibalism !== false) return "oneway>twoway-keep";
  if (k === "ltl>twoway" && cfgB?.spec?.ltl?.z4_cannibalism !== false) return "ltl>twoway-keep";
  return k;
}

/** Index of the configuration that should serve as the reference (base) in a comparison. */
export function referenceIndex(kinds: ConfigKind[]): [number, number] {
  const rank: Record<ConfigKind, number> = { ltl: 0, oneway: 1, other: 2, e2e: 3, twoway: 3 };
  const order = kinds.map((k, i) => [rank[k], i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  return [order[0] ?? 0, order[1] ?? (kinds.length > 1 ? 1 : 0)];
}

// ------------------------------------------------------------------ what each quantity is
const INFO: Record<string, { what: string; pattern?: string }> = {
  phyto: { what: "整根水柱里浮游植物的碳总量（深度积分），相当于海洋食物网里的“草”。", pattern: "主要由光照、营养盐供应和垂向混合决定：营养盐补充多、层化适中的海区更高。" },
  zoo: { what: "整根水柱里浮游动物的碳总量，是浮游植物与鱼之间的中间环节。" },
  zoo_Z4_c: { what: "中型浮游动物（桡足类等，约 0.2–2 mm）的碳总量。它们是鱼最主要的食物，也吃微型浮游动物。" },
  zoo_Z5_c: { what: "微型浮游动物（纤毛虫等，约 20–200 µm）的碳总量。它们吃小型浮游植物和鞭毛虫，自己又被中型浮游动物吃。" },
  zoo_Z6_c: { what: "异养鞭毛虫（约 2–20 µm）的碳总量。它们吃细菌和最小的浮游植物，被微型浮游动物吃。" },
  chl: { what: "叶绿素的深度积分，是卫星海色观测能看到的浮游植物色素量。" },
  npp: { what: "净初级生产：浮游植物一年里通过光合作用固定、扣除自身呼吸后的碳，是整个食物网的能量来源。", pattern: "由光照和营养盐共同决定；浅海营养盐容易被混合带回表层，通常更高。" },
  fish_ww: { what: "MIZER 粒径谱上全部鱼的总湿重（每平方米多少克）。", pattern: "在本模型里，鱼的多少取决于它能吃到的浮游生物，因此空间格局通常与浮游动物相似。" },
  landings: { what: "渔获量：按设定的捕捞死亡率每年从鱼群中捕走的湿重。它与可捕的（较大的）鱼成正比。" },
  fish_c_size1: { what: "体重较小的鱼的生物量（粒径谱最小的一段）。" },
  fish_c_size2: { what: "中等体重的鱼的生物量。" },
  fish_c_size3: { what: "体重较大的鱼的生物量（粒径谱最大的一段）。" },
  co2: { what: "一年的海气 CO₂ 通量：正值表示海洋吸收 CO₂，负值表示海洋向大气释放。", pattern: "受温度（溶解度）、生物生产（吸收）与呼吸分解（释放）共同影响。" },
  sst: { what: "表层水温的年平均。", pattern: "由太阳辐射、海气热交换和纬度决定，南暖北冷。" },
  sbt: { what: "底层水温的年平均。", pattern: "层化海区底层夏季不升温，因此比浅水混合区更冷。" },
  F1_c: { what: "E2E 鱼 1（浮游食性鱼，如鲱、鲭）的生物量。" },
  F2_c: { what: "E2E 鱼 2（底栖与鱼食性鱼，如鳕、鲽）的生物量。" },
  MB_c: { what: "E2E 大型底栖动物（贝类、多毛类等）的生物量，它们吃沉降到海底的有机物。" },
};
const MONTHLY_INFO: Record<string, string> = { temp: "sst", F1_c: "F1_c", F2_c: "F2_c", MB_c: "MB_c", fish_c_tot: "fish_ww", Z4_c: "zoo_Z4_c", ECO_mesozoo: "zoo", ergom_zz: "zoo" };
const ALIAS: Record<string, string> = { zoo_ECO_mesozoo: "zoo_Z4_c", zoo_ECO_microzoo: "zoo_Z5_c", zoo_ergom_zz: "zoo" };
export function infoKey(metric: string) { const k = metric.startsWith("monthly:") ? MONTHLY_INFO[metric.slice(8)] ?? metric.slice(8) : metric; return ALIAS[k] ?? k; }
export function canonChg(chg: Record<string, number | null>) { const o: Record<string, number | null> = {}; for (const [k, v] of Object.entries(chg)) o[ALIAS[k] ?? k] = v; return o; }
export { INFO as METRIC_INFO };

// ------------------------------------------------------------------ why it happens
type Ctx = { chg: Record<string, number | null> }; // % change of area means, key → %
const sgn = (x: number | null | undefined, tol = 2) => (x == null ? 0 : x > tol ? 1 : x < -tol ? -1 : 0);

export const PAIR_INTRO: Record<string, string> = {
  "oneway>twoway": "两种配置只差一件事：双向耦合中，鱼吃掉的浮游生物真的从 ERSEM 中扣除，鱼的粪便、排泄和呼吸也回到水里；同时 ERSEM 原来用来代表“看不见的捕食者”的闭合项（中型浮游动物的种内捕食和基础死亡）被关掉。单向耦合中，鱼吃多少都不影响浮游生物。",
  "oneway>twoway-keep": "两种配置只差一件事：双向耦合中，鱼吃掉的浮游生物真的从 ERSEM 中扣除，鱼的粪便、排泄和呼吸也回到水里；单向耦合中，鱼吃多少都不影响浮游生物。（这里双向耦合仍保留了中型浮游动物的闭合死亡项，鱼的捕食是额外叠加的损失。）",
  "ltl>twoway": "基准只有低营养级（没有鱼）；比较配置加入了会吃浮游生物、并把排泄和呼吸返回水体的鱼，同时去掉了中型浮游动物的闭合死亡项。",
  "ltl>twoway-keep": "基准只有低营养级（没有鱼）；比较配置加入了会吃浮游生物、并把排泄和呼吸返回水体的鱼，原有的中型浮游动物死亡项保留，鱼的捕食是叠加的额外损失。",
  "ltl>oneway": "单向耦合中鱼不影响浮游生物，所以浮游生物与只有低营养级的基准应完全相同；差别只会出现在鱼相关的指标上。",
  "ltl>ltl": "两个运行都只有低营养级，差别在低营养级自身的参数（例如浮游动物死亡率）。这类实验用来判断：加入鱼的效果，能不能简单地用“提高浮游动物死亡率”来代替。",
  "ltl>e2e": "基准只有低营养级；比较配置加入了 E2E 功能群（鱼 1、鱼 2、大型底栖），它们的捕食、粪便、死亡和排泄都反馈给宿主模型（修正版还包括呼吸放出的碳和消耗的氧）。",
};

export function mechanism(key: string, pair: string, d: number | null, ctx: Ctx): string | null {
  key = ALIAS[key] ?? key;
  const cc = canonChg(ctx.chg);
  const s = sgn(d);
  const z4 = sgn(cc.zoo_Z4_c), z5 = sgn(cc.zoo_Z5_c);
  const feedback = pair.startsWith("oneway>twoway") || pair.startsWith("ltl>twoway") || pair === "ltl>e2e";
  if (key === "sst" || key === "sbt") return "两个配置的温度完全相同：本模型中生物不反馈物理场，物理强迫一模一样，所以其他指标的差异全部来自生态过程。";
  if (pair === "ltl>oneway" && !/fish|landings/.test(key)) return s === 0 ? "与预期一致：单向耦合的鱼不改变浮游生物。" : "单向耦合本不应改变浮游生物；出现差异请检查两个配置的低营养级设置是否相同。";
  if (!feedback) return null;
  switch (key) {
    case "zoo_Z4_c":
      if (pair === "ltl>e2e") return s < 0 ? "中型浮游动物减少：鱼 1 以它为主要食物，这是叠加在原有死亡之上的额外捕食损失（下行控制）。" : s > 0 ? "中型浮游动物反而增加：鱼同时吃掉了它的竞争者或捕食者，间接效应超过了直接捕食。" : "鱼的直接捕食对中型浮游动物影响很小。";
      if (pair === "oneway>twoway-keep" || pair === "ltl>twoway-keep") return s < 0 ? "中型浮游动物减少：鱼的捕食是叠加在原有死亡项之上的额外损失。" : s > 0 ? "中型浮游动物反而增加：鱼同时也吃它们的竞争者或捕食者，间接效应超过了直接捕食。" : "鱼的直接捕食对中型浮游动物影响很小。";
      if (s < 0) return "中型浮游动物减少：鱼真正吃掉了它们，这项新增的捕食损失大于被关掉的种内捕食和基础死亡。";
      if (s > 0) return "中型浮游动物增加：被关掉的种内捕食和基础死亡多于鱼新增的捕食，净损失变小了。";
      return "鱼的捕食与被关掉的闭合死亡大致抵消。";
    case "zoo_Z5_c":
      if (z4 < 0 && s > 0) return "这是典型的营养级联：中型浮游动物变少 → 它对微型浮游动物的捕食减轻 → 微型浮游动物增加。";
      if (z4 > 0 && s < 0) return "营养级联：中型浮游动物变多 → 吃掉更多微型浮游动物。";
      return "微型浮游动物同时受中型浮游动物捕食和鱼的直接捕食影响，两者方向不同时变化较小。";
    case "zoo_Z6_c":
      if (z5 > 0 && s < 0) return "级联继续往下传：微型浮游动物变多 → 吃掉更多异养鞭毛虫 → 异养鞭毛虫减少。食物链上相隔一级的类群往往反向变化。";
      if (z5 < 0 && s > 0) return "级联往下传：微型浮游动物变少 → 异养鞭毛虫被吃得少而增加。";
      return null;
    case "zoo":
      return "浮游动物总量是各类群之和；当各类群反向变化时（营养级联），总量的变化比单个类群小得多。";
    case "phyto": case "chl": case "npp":
      if (s === 0) return "浮游植物几乎不变：中型浮游动物的变化与微型浮游动物的变化对浮游植物的摄食压力方向相反，大体抵消；而且光照和营养盐才是浮游植物的主要限制。顶层的扰动传到食物链底部时已经很弱。";
      return s > 0 ? "浮游植物增加：对浮游植物的总摄食压力下降，或鱼的排泄把更多营养盐还给水体。" : `浮游植物减少：小型植食者（微型浮游动物）增加后吃掉更多小型藻类${pair.includes("twoway") ? "；MIZER 的鱼也直接摄食较大的藻类" : ""}。`;
    case "fish_ww": case "fish_c_size1": case "fish_c_size2": case "fish_c_size3": case "F1_c": case "F2_c":
      if (pair.startsWith("oneway>twoway")) {
        if (s < 0) return "鱼变少：单向耦合中鱼吃掉的食物不会减少，相当于食物取之不尽，会高估鱼；双向耦合中被吃掉的就真的没了，食物（尤其中型浮游动物）减少，鱼的增长受到限制。这正是“反馈”带来的密度制约。";
        if (s > 0) return "鱼变多：闭合项被关掉后，某些季节鱼能吃到的浮游动物反而更多。";
        return "鱼几乎不变：食物减少的影响较弱。";
      }
      return null;
    case "landings":
      return s === 0 ? null : `渔获量按“捕捞死亡率 × 可捕的大鱼”计算，所以跟着鱼的生物量${s < 0 ? "下降" : "上升"}；大鱼对食物变化更敏感时，渔获的变幅会大于总生物量。`;
    case "co2":
      if (s < 0) return "海洋吸收的 CO₂ 变少（或释放变多）：鱼的呼吸和排泄把碳以 CO₂ 的形式还给水体，使表层溶解无机碳增加。";
      if (s > 0) return "海洋吸收的 CO₂ 变多：生物把更多碳带离表层。";
      return null;
    case "MB_c":
      return "大型底栖动物靠沉降到海底的有机物生活，上层食物网的变化会通过沉降通量间接影响它们。";
  }
  return null;
}

// ------------------------------------------------------------------ statistics helpers
export type Pair = { lat: number; lon: number; depth?: number; a: number | null; b?: number | null; other?: Record<string, number | null> };
type Box = { name: string; box: [number, number, number, number] };

const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN);
const median = (v: number[]) => { if (!v.length) return NaN; const s = [...v].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function pearson(x: number[], y: number[]) {
  const n = x.length; if (n < 8) return NaN;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}
export const DEPTH_BANDS: [string, number, number][] = [["近岸浅水（< 30 m）", 0, 30], ["内陆架（30–60 m）", 30, 60], ["中陆架（60–100 m）", 60, 100], ["外陆架（100–200 m）", 100, 200], ["陆架坡折以外（> 200 m）", 200, 1e9]];
/** Region classifier: the paper's NW European shelf boxes when they cover most columns, depth bands anywhere else. */
export function regionerFor(boxes: Box[], pts: { lat: number; lon: number; depth?: number }[]): (p: { lat: number; lon: number; depth?: number }) => string | null {
  const inside = pts.filter((p) => regionOf(boxes, p.lat, p.lon)).length;
  if (boxes.length && inside >= 0.5 * pts.length) return (p) => regionOf(boxes, p.lat, p.lon);
  return (p) => (p.depth == null ? null : DEPTH_BANDS.find(([, a, b]) => p.depth! >= a && p.depth! < b)?.[0] ?? null);
}
export function regionOf(boxes: Box[], lat: number, lon: number) {
  for (const b of boxes) { const [a0, a1, o0, o1] = b.box; if (lat >= a0 && lat < a1 && lon >= o0 && lon < o1) return b.name; }
  return null;
}
const pct = (a: number, b: number) => (a ? ((b - a) / Math.abs(a)) * 100 : NaN);
const sp = (x: number, d = 1) => `${x > 0 ? "+" : ""}${x.toFixed(d)}%`;

/** % change of area means for every metric shared by two result sets (used for cascade logic). */
export function changeOfMeans(A: any, B: any): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (!A || !B) return out;
  const bi = new Map(B.points.map((p: any) => [p.i, p]));
  for (const k of Object.keys(A.meta ?? {})) {
    const xa: number[] = [], xb: number[] = [];
    for (const p of A.points) { const q: any = bi.get(p.i); const a = p.metrics?.[k], b = q?.metrics?.[k]; if (a != null && b != null) { xa.push(a); xb.push(b); } }
    const ma = mean(xa), mb = mean(xb);
    out[k] = xa.length && Math.abs(ma) > 1e-12 ? pct(ma, mb) : null;
  }
  return out;
}

// ------------------------------------------------------------------ the reading panel
export function FigureReading({ metric, label, unit, mode, pairs, nameA, nameB, descA, descB, pairKey, boxes, chg, otherLabels, res, years, howto }: {
  metric: string; label: string; unit: string; mode: "value" | "diff" | "pct";
  pairs: Pair[]; nameA: string; nameB?: string; descA?: string; descB?: string; pairKey?: string;
  boxes: Box[]; chg: Record<string, number | null>; otherLabels?: Record<string, string>; res: number; years: number; howto?: string;
}) {
  const key = infoKey(metric);
  const info = INFO[key];
  const ok = pairs.filter((p) => p.a != null && isFinite(p.a as number));
  const facts: ReactNode[] = [];
  let mech: string | null = null;
  let warn: string | null = null;

  if (mode === "value") {
    const v = ok.map((p) => p.a as number);
    facts.push(<>全陆架 {v.length} 根水柱的平均值 <b>{fmt(mean(v))}</b> {unit}，中位数 {fmt(median(v))}，范围 {fmt(Math.min(...v))}–{fmt(Math.max(...v))}。</>);
    const reg = regionStats(ok, regionerFor(boxes, ok), (p) => p.a as number);
    if (reg.length >= 2) {
      const hi = reg[0], lo = reg[reg.length - 1];
      facts.push(<>区域平均最高的是 <b>{hi.name}</b>（{fmt(hi.m)} {unit}），最低的是 <b>{lo.name}</b>（{fmt(lo.m)} {unit}），相差 {fmt(hi.m / (lo.m || NaN))} 倍。</>);
    }
    const withD = ok.filter((p) => p.depth != null);
    const r = pearson(withD.map((p) => p.depth as number), withD.map((p) => p.a as number));
    if (isFinite(r) && Math.abs(r) >= 0.35) facts.push(<>{r < 0 ? "越浅的水柱数值越高" : "越深的水柱数值越高"}（与水深的相关系数 r = {r.toFixed(2)}）。{(key === "npp" || key === "phyto") && r < 0 ? " 浅水区常年混合，营养盐不断被带回有光层。" : ""}</>);
    // which other quantity has the most similar spatial pattern
    if (ok[0]?.other) {
      let best: [string, number] | null = null;
      for (const k of Object.keys(ok[0].other!)) {
        if (k === metric || /size|sst|sbt|landings/.test(k) || (otherLabels?.[k] ?? "").startsWith("  ")) continue;
        const xs = ok.filter((p) => p.other?.[k] != null);
        const rr = pearson(xs.map((p) => p.other![k] as number), xs.map((p) => p.a as number));
        if (isFinite(rr) && (!best || Math.abs(rr) > Math.abs(best[1]))) best = [k, rr];
      }
      if (best && Math.abs(best[1]) >= 0.5) facts.push(<>空间格局与 <b>{(otherLabels?.[best[0]] ?? best[0]).trim()}</b> {best[1] > 0 ? "最相似" : "相反"}（r = {best[1].toFixed(2)}）{key === "fish_ww" && /zoo/.test(best[0]) && best[1] > 0 ? "：鱼多的地方正是它的食物多的地方。" : "。"}</>);
    }
  } else {
    const both = ok.filter((p) => p.b != null && isFinite(p.b as number));
    const va = both.map((p) => p.a as number), vb = both.map((p) => p.b as number);
    const ma = mean(va), mb = mean(vb);
    const d = pct(ma, mb);
    const per = both.filter((p) => p.a).map((p) => pct(p.a as number, p.b as number));
    const down = per.filter((x) => x < -1).length, up = per.filter((x) => x > 1).length;
    const signed = key === "co2" || (ma * mb < 0) || Math.abs(ma) < 0.15 * Math.max(...va.map(Math.abs));
    if (!both.length) {
      facts.push(<>两个配置在这一指标上没有可比较的数据。</>);
    } else if (Math.abs(mb - ma) < 1e-9 * Math.max(1, Math.abs(ma))) {
      facts.push(<>两个配置在所有水柱上完全相同（差值为 0）。</>);
      mech = mechanism(key, pairKey ?? "", 0, { chg });
    } else {
      facts.push(<>以 <b>{nameA}</b> 为基准，<b>{nameB}</b> 的陆架平均值从 {fmt(ma)} 变为 {fmt(mb)} {unit}（{signed ? `差 ${fmt(mb - ma)} ${unit}` : <b>{sp(d)}</b>}）。</>);
      const flat = both.length - down - up;
      facts.push(<>{both.length} 根水柱中 <b>{down}</b> 根下降、<b>{up}</b> 根上升{flat > 0 ? `、${flat} 根变化不到 1%` : ""}{Math.abs(d) < 3 && !signed ? "，整体变化很小。" : down > 0.85 * both.length || up > 0.85 * both.length ? "：几乎所有水柱都朝同一个方向变化，说明这是模型机制造成的，不是个别格点的偶然波动。" : "：有升有降，不同海区的反应不一样。"}</>);
      if (!signed && Math.abs(d) >= 3) {
        const reg = regionStats(both, regionerFor(boxes, both), (p) => p.a as number, (p) => p.b as number).filter((r) => r.n >= 3).sort((x, y) => (x.c ?? 0) - (y.c ?? 0));
        if (reg.length >= 2) {
          const strong = d < 0 ? reg[0] : reg[reg.length - 1], weak = d < 0 ? reg[reg.length - 1] : reg[0];
          facts.push(<>变化最大的区域是 <b>{strong.name}</b>（{sp(strong.c!, 0)}），最小的是 <b>{weak.name}</b>（{sp(weak.c!, 0)}）。</>);
        }
      }
      if (mode === "pct" && !signed && isFinite(median(per))) facts.push(<>逐格点百分比的中位数为 {sp(median(per))}；地图上个别格点很大的百分比往往来自基准值很小的水柱。</>);
      if (signed && mode === "pct") warn = "这个量接近 0 或有正有负，百分比会被放大甚至变号，请切换到“差值”查看。";
      mech = mechanism(key, pairKey ?? "", signed ? (mb - ma > 0 ? 100 : mb - ma < 0 ? -100 : 0) : d, { chg });
    }
  }

  return (
    <div className="reading">
      <h4>这是什么</h4>
      <p><b>{label.trim()}</b>{unit ? `（${unit}）` : ""}：{info?.what ?? "所选指标的分析年年平均值。"}</p>
      <h4>这张图说明了什么</h4>
      <ul>{facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
      {warn && <p className="reading-warn">{warn}</p>}
      {mode !== "value" && (pairKey && PAIR_INTRO[pairKey] || mech) && <>
        <h4>为什么会这样</h4>
        {pairKey && PAIR_INTRO[pairKey] && <p>{PAIR_INTRO[pairKey]}</p>}
        {mech && <p>{mech}</p>}
      </>}
      {mode !== "value" && !(pairKey && PAIR_INTRO[pairKey]) && (descA || descB) && <>
        <h4>两个配置的区别</h4>
        <p>{nameA}：{descA || "—"}<br />{nameB}：{descB || "—"}</p>
      </>}
      {mode === "value" && info?.pattern && <><h4>为什么是这样的格局</h4><p>{info.pattern}</p></>}
      <h4>怎么读</h4>
      <p>{howto ?? (mode === "value"
        ? `每个小方块是一根独立计算的一维水柱（${res}° × ${res}°），颜色越深数值越高。浅蓝底色只表示水深；没有方块的海域过浅或过深，未参与计算。悬停可看数值。`
        : `颜色 = ${nameB} ${mode === "pct" ? "相对" : "减去"} ${nameA}${mode === "pct" ? "的百分比" : ""}。红色表示 ${nameB} 更高，蓝色表示更低，白色表示几乎没有差别。色标两端取 98% 格点的范围，少数极端格点显示为最深色。`)}</p>
      <h4>注意</h4>
      <p>格点之间没有海流交换，也没有鱼类洄游；海峡、河口羽流区、陆架坡折等水平输运强的海区，真实情况可能不同。共模拟 {years} 年、只分析最后一年，鱼类可能尚未达到稳态（可在“结果分析 → 验证与稳态”检查单柱的预热）。</p>
    </div>
  );
}

function regionStats(pairs: Pair[], rOf: (p: Pair) => string | null, fa: (p: Pair) => number, fb?: (p: Pair) => number) {
  const g = new Map<string, { a: number[]; b: number[] }>();
  for (const p of pairs) {
    const r = rOf(p); if (!r) continue;
    if (!g.has(r)) g.set(r, { a: [], b: [] });
    g.get(r)!.a.push(fa(p)); if (fb) g.get(r)!.b.push(fb(p));
  }
  return [...g.entries()].map(([name, x]) => ({ name, n: x.a.length, m: mean(x.a), c: fb ? pct(mean(x.a), mean(x.b)) : undefined }))
    .filter((r) => r.n >= 2).sort((x, y) => y.m - x.m);
}

/** One-paragraph synthesis across all panels of the percent-change overview (paper 1, Fig. 5). */
export function cascadeText(chgIn: Record<string, number | null>): string | null {
  const chg = canonChg(chgIn);
  const z4 = sgn(chg.zoo_Z4_c), z5 = sgn(chg.zoo_Z5_c), z6 = sgn(chg.zoo_Z6_c), ph = sgn(chg.phyto, 3);
  if (!(z4 !== 0 && z5 === -z4)) return null;
  return `变化沿食物链一正一负交替：中型浮游动物${z4 < 0 ? "减少" : "增加"} → 微型浮游动物${z5 > 0 ? "增加" : "减少"}${z6 === -z5 && z6 !== 0 ? ` → 异养鞭毛虫${z6 < 0 ? "减少" : "增加"}` : ""}。这就是营养级联：捕食者变少，它的猎物就变多，猎物的猎物又变少。${ph === 0 ? "传到浮游植物时效应已基本抵消，所以浮游植物几乎不变。" : ""}`;
}

export function CascadeSummary({ chg, labels, pairKey, nameA, nameB }: { chg: Record<string, number | null>; labels: Record<string, string>; pairKey?: string; nameA: string; nameB: string }) {
  const keys = ["zoo_Z4_c", "zoo_Z5_c", "zoo_Z6_c", "phyto", "npp", "fish_ww", "landings"].filter((k) => chg[k] != null);
  const parts = keys.map((k) => `${(labels[k] ?? k).trim()} ${sp(chg[k]!)}`);
  const z4 = sgn(chg.zoo_Z4_c), z5 = sgn(chg.zoo_Z5_c), z6 = sgn(chg.zoo_Z6_c), ph = sgn(chg.phyto, 3);
  const cascade = z4 !== 0 && z5 === -z4;
  return (
    <div className="reading reading-wide">
      <h4>这组图说明了什么</h4>
      <p>以 <b>{nameA}</b> 为基准，<b>{nameB}</b> 的陆架平均变化：{parts.join("，")}。</p>
      {cascade && <p>变化沿食物链<b>一正一负交替</b>：中型浮游动物{z4 < 0 ? "减少" : "增加"} → 微型浮游动物{z5 > 0 ? "增加" : "减少"}{z6 === -z5 && z6 !== 0 ? ` → 异养鞭毛虫${z6 < 0 ? "减少" : "增加"}` : ""}，这就是<b>营养级联</b>：捕食者变少，它的猎物就变多，猎物的猎物又变少。{ph === 0 ? "传到浮游植物时效应已基本抵消，所以浮游植物和初级生产几乎不变。" : ""}</p>}
      {pairKey && PAIR_INTRO[pairKey] && <p>{PAIR_INTRO[pairKey]}</p>}
      {pairKey?.startsWith("oneway>twoway") && sgn(chg.fish_ww) < 0 && <p>鱼本身也变少了：单向耦合假设鱼吃不完食物，双向耦合中鱼会把自己的食物吃少，从而限制自身增长。换句话说，不考虑反馈的“离线”鱼类模型在这里高估了鱼类生物量和渔获。可以与 Powley 等 (2026) 图 5 的陆架结果对照。</p>}
      <p className="soft">每个面板的色标固定为 ±40%，便于在指标之间比较；红色为增加，蓝色为减少。</p>
    </div>
  );
}
