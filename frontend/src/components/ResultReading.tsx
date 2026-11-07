/**
 * Figure reading for the single-column result tabs (time–depth, annual cycle, profiles,
 * column animation, size spectrum, food web, indicator comparison).
 *
 * Each reader states what the variable is, what this particular figure shows (computed from the
 * plotted data), and the physical / ecological reason, phrased for beginners. Interpretive
 * sentences are only emitted when the data support them (thresholds below), so the text follows
 * the figure instead of a textbook expectation.
 */
import { useState, type ReactNode } from "react";
import { useApp } from "../store";
import { fmt, Icon, IconBtn } from "./ui";
import { METRIC_INFO, PAIR_INTRO, cascadeText, configKind, infoKey, mechanism, pairKeyOf } from "./ShelfExplain";

// ------------------------------------------------------------------ variable catalogue
type Cat = "temp" | "salt" | "nitrate" | "ammonium" | "phosphate" | "silicate" | "oxygen" | "dic" | "diatoms" | "flagellates" | "pico" | "largephyto"
  | "cyano" | "chl" | "mesozoo" | "microzoo" | "hnf" | "zoo" | "bacteria" | "dom" | "detritus" | "fish" | "benthos" | "mld" | "mixing" | "forcing" | "other";

const RULES: [RegExp, Cat][] = [
  [/^temp$|^sst$|^tprof/, "temp"], [/^salt$|^sprof/, "salt"],
  [/^N3_n$|ECO_no3|ergom_nn/, "nitrate"], [/^N4_n$|ECO_nh4|ergom_aa/, "ammonium"], [/^N1_p$|ECO_pho|ergom_po/, "phosphate"], [/^N5_s$|ECO_sil/, "silicate"],
  [/^O2_o$|ECO_oxy|ergom_o2/, "oxygen"], [/^O3_c$|dic/i, "dic"],
  [/^P1_c$|ECO_dia|ergom_pp/, "diatoms"], [/^P2_c$|ECO_fla|ergom_ff/, "flagellates"], [/^P3_c$/, "pico"], [/^P4_c$/, "largephyto"], [/ECO_bg|ergom_bb/, "cyano"],
  [/chl/i, "chl"], [/^Z4_c$|ECO_mesozoo/, "mesozoo"], [/^Z5_c$|ECO_microzoo/, "microzoo"], [/^Z6_c$/, "hnf"], [/ergom_zz/, "zoo"],
  [/^B1_c$/, "bacteria"], [/^R1_c$|ECO_dom/, "dom"], [/^R[2-8]_c$|ECO_det|ergom_dd|^Q[1-7]_c$/, "detritus"],
  [/^F[12]_c$|fish/, "fish"], [/^MB_c$|^Y[2-4]_c$/, "benthos"], [/^mld/, "mld"], [/^nu[hms]$|^tke$|^eps$|^NN$/, "mixing"],
  [/^(u10|v10|airt|rad|airp|hum|cloud|precip|taub|tx|ty)$/, "forcing"],
];
export function varCat(name: string): Cat { return RULES.find(([rx]) => rx.test(name))?.[1] ?? "other"; }

const CAT: Record<Cat, { what: string; season?: string }> = {
  temp: { what: "海水温度。它决定水的密度：暖水轻、冷水重，所以温度的上下差异直接决定水柱是否分层。", season: "表层温度随太阳辐射变化，但峰值比夏至晚 1–2 个月：海水热容量大，要经过整个夏天才升到最高。" },
  salt: { what: "盐度。在没有河流和平流的一维模型中，主要由向气候态的松弛维持，变化很小。" },
  nitrate: { what: "硝酸盐，浮游植物最主要的氮源。", season: "冬季混合把底层的硝酸盐带上来，表层最高；春季藻华后表层迅速被吃光。" },
  ammonium: { what: "铵盐，由浮游动物排泄和细菌分解产生，是“再生”的氮，浮游植物也能直接吸收。", season: "藻华之后、分解旺盛的季节较高。" },
  phosphate: { what: "磷酸盐，浮游植物必需的磷源。", season: "与硝酸盐类似：冬季高、春夏被表层浮游植物耗尽。" },
  silicate: { what: "硅酸盐，硅藻造壳必需。", season: "春季硅藻最先把它耗尽，所以硅藻的藻华往往最早结束，之后由不需要硅的鞭毛藻接替。" },
  oxygen: { what: "溶解氧。表层与大气交换并有光合作用产氧；底层只有分解耗氧。", season: "冷水能溶解更多氧，冬季整柱较高；层化季节底层得不到补充，逐渐下降。" },
  dic: { what: "溶解无机碳（主要是 CO₂ 的各种形态）。光合作用消耗它，呼吸和分解产生它。" },
  diatoms: { what: "硅藻：较大的浮游植物，需要硅，生长快，是春季藻华的主角。", season: "早春光照增强、层化刚建立、营养盐最充足时最先爆发。" },
  flagellates: { what: "鞭毛藻等小型浮游植物：不需要硅，在低营养盐环境中竞争力强。", season: "硅藻退场后的夏季更重要。" },
  pico: { what: "微微型浮游植物（< 2 µm）：个体最小，在营养盐贫乏的夏季表层占优。" },
  largephyto: { what: "大型浮游植物（如甲藻）。" },
  cyano: { what: "蓝藻：可以固氮，在温暖、氮缺乏的夏季占优（波罗的海尤其明显）。" },
  chl: { what: "叶绿素：浮游植物的光合色素，卫星海色观测看到的就是它。" },
  mesozoo: { what: "中型浮游动物（桡足类等，约 0.2–2 mm）：鱼最主要的食物。", season: "峰值通常比浮游植物晚几周：先有食物，捕食者才跟着多起来。" },
  microzoo: { what: "微型浮游动物（纤毛虫等，约 20–200 µm）：吃小型浮游植物和鞭毛虫，又被中型浮游动物吃。", season: "能很快跟上小型藻类的增长。" },
  hnf: { what: "异养鞭毛虫（约 2–20 µm）：吃细菌和最小的浮游植物，是“微食物环”的一环。" },
  zoo: { what: "浮游动物：连接浮游植物与鱼的中间环节。", season: "峰值通常比浮游植物晚几周。" },
  bacteria: { what: "细菌：分解溶解有机物，把营养盐重新释放到水中。" },
  dom: { what: "溶解有机物：浮游生物渗出和分解产生，是细菌的食物。" },
  detritus: { what: "颗粒碎屑：死亡的浮游生物和粪便。它们下沉，在途中和海底被分解成营养盐。", season: "藻华之后增加，并逐渐沉向底层。" },
  fish: { what: "鱼的生物量。鱼要经历多个世代才能对环境变化作出完整响应，所以变化比浮游生物慢得多。" },
  benthos: { what: "大型底栖动物（贝类、多毛类等）：以沉降到海底的有机物为食。", season: "在春华后的沉降高峰之后增加。" },
  mld: { what: "表层混合层深度：从海面向下被风和冷却充分搅匀的那一层有多厚。", season: "冬季深（风大、表层冷却下沉），夏季浅（表层增温形成稳定的“盖子”）。" },
  mixing: { what: "湍流扩散系数等混合强度指标：数值越大，上下层交换越快。" },
  forcing: { what: "气象强迫（来自 ERA5 再分析）：风、气温、辐射等，驱动整个物理过程。" },
  other: { what: "模型输出变量。" },
};
const NUTRIENT = new Set<Cat>(["nitrate", "phosphate", "silicate"]);
const PHYTO = new Set<Cat>(["diatoms", "flagellates", "pico", "largephyto", "cyano", "chl"]);
const ZOO = new Set<Cat>(["mesozoo", "microzoo", "hnf", "zoo"]);

// ------------------------------------------------------------------ small numeric helpers
const finite = (v: any): v is number => typeof v === "number" && isFinite(v);
const mean = (v: (number | null)[]) => { let s = 0, n = 0; for (const x of v) if (finite(x)) { s += x; n++; } return n ? s / n : NaN; };
const monthOf = (iso: string) => +String(iso).slice(5, 7);
const doyMonth = (d: number) => Math.min(12, Math.floor((d - 1) / 30.44) + 1);
const sp = (x: number, d = 1) => `${x > 0 ? "+" : ""}${x.toFixed(d)}%`;
const pct = (a: number, b: number) => (a ? ((b - a) / Math.abs(a)) * 100 : NaN);
function monthlyMean(vals: (number | null)[], times: string[], months: number[]) {
  const sel = vals.filter((_, i) => months.includes(monthOf(times[i])));
  return mean(sel);
}
function range(months: number[]) {
  if (!months.length) return "";
  return months.length === 1 ? `${months[0]} 月` : `${months[0]}–${months[months.length - 1]} 月`;
}

// ------------------------------------------------------------------ seasons follow the site's hemisphere
export function useSeason() {
  const lat: number = useApp((s) => (s.project as any)?.site_info?.lat ?? (s.project as any)?.site?.lat ?? 50);
  const south = lat < 0;
  return {
    south, tropical: Math.abs(lat) < 23.5,
    winter: south ? [7, 8] : [1, 2], summer: south ? [1, 2] : [7, 8], summer3: south ? [12, 1, 2] : [6, 7, 8],
    wl: south ? "7–8 月" : "1–2 月", sl: south ? "1–2 月" : "7–8 月", s3l: south ? "12–2 月" : "6–8 月",
    /** month expressed as the equivalent northern-hemisphere month (for spring/summer classification) */
    nh: (m: number) => (south ? ((m + 5) % 12) + 1 : m),
  };
}

// ------------------------------------------------------------------ layout: figure + collapsible reading aside
export function useReadingOpen(): [boolean, () => void] {
  // open by default on wide windows; on narrow ones the figure needs the room (the book icon opens it)
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem("e2e.reading"); return v == null ? window.innerWidth >= 1280 : v === "1"; } catch { return true; } });
  return [open, () => { const v = !open; setOpen(v); try { localStorage.setItem("e2e.reading", v ? "1" : "0"); } catch { /* ignore */ } }];
}
export function ReadingToggle({ open, toggle }: { open: boolean; toggle: () => void }) {
  return <IconBtn icon="book" size="sm" title={open ? "收起读图说明" : "显示读图说明"} active={open} onClick={toggle} />;
}
/** Figure with the reading panel on its right. The panel slides open and closed; the book button
 *  (<ReadingToggle>) in the tab's option bar is its switch, as AVAS puts panel toggles in the bar above. */
export function FigAside({ open, figure, reading }: { open: boolean; figure: ReactNode; reading: ReactNode; toggle?: () => void }) {
  return (
    <div className="fig-aside">
      <div className="fig-main">{figure}</div>
      <aside className={`reading-aside ${open ? "open" : ""}`} aria-hidden={!open} aria-label="读图说明">
        <div className="reading-aside-inner">{reading}</div>
      </aside>
    </div>
  );
}

function Reading({ what, facts, why, how, note }: { what?: ReactNode; facts: ReactNode[]; why?: ReactNode[]; how: string; note?: string }) {
  const w = (why ?? []).filter(Boolean);
  return (
    <div className="reading">
      {what && <><h4>这是什么</h4><p>{what}</p></>}
      <h4>这张图说明了什么</h4>
      {facts.length ? <ul>{facts.map((f, i) => <li key={i}>{f}</li>)}</ul> : <p className="soft">数据不足，无法给出结论。</p>}
      {w.length > 0 && <><h4>为什么</h4>{w.map((x, i) => <p key={i}>{x}</p>)}</>}
      <h4>怎么读</h4><p>{how}</p>
      {note && <><h4>注意</h4><p>{note}</p></>}
    </div>
  );
}

// ------------------------------------------------------------------ time–depth (Hovmöller)
export function HovReading({ panels, mld, v, label, diff }: { panels: any[]; mld: any[]; v: string; label: string; diff: boolean }) {
  const cat = varCat(v);
  const se = useSeason();
  const p = panels[0];
  if (!p) return null;
  const depth: number[] = p.depth, time: string[] = p.time, vals: (number | null)[][] = p.values, u = p.units ?? "";
  const si = depth.indexOf(Math.min(...depth)), bi = depth.indexOf(Math.max(...depth)), H = depth[bi];
  const facts: ReactNode[] = [], why: ReactNode[] = [];
  const S = vals[si], B = vals[bi];
  const wS = monthlyMean(S, time, se.winter), sS = monthlyMean(S, time, se.summer), wB = monthlyMean(B, time, se.winter), sB = monthlyMean(B, time, se.summer);

  // stratified months from the mixed-layer depth
  const m0 = mld?.[0];
  let strat: number[] = [];
  if (m0 && !m0.missing) for (let m = 1; m <= 12; m++) { const x = monthlyMean(m0.values, m0.time, [m]); if (finite(x) && x < 0.5 * H) strat.push(m); }
  if (strat.length === 12) strat = [];

  if (diff) {
    let s = 0, n = 0, pos = 0, best = { a: 0, t: "", z: 0 };
    vals.forEach((row, k) => row.forEach((x, j) => { if (!finite(x)) return; s += x; n++; if (x > 0) pos++; if (Math.abs(x) > Math.abs(best.a)) best = { a: x, t: time[j], z: depth[k] }; }));
    // where (depth) and when (month) the difference is concentrated
    const prof = depth.map((_, k) => mean(vals[k]));
    const kz = prof.reduce((bk, x, k) => (finite(x) && Math.abs(x) > Math.abs(prof[bk] ?? 0) ? k : bk), 0);
    const colMean = time.map((_, j) => mean(vals.map((row) => row[j])));
    const mon = Array.from({ length: 12 }, (_, m) => monthlyMean(colMean, time, [m + 1]));
    const km = mon.reduce((bk, x, k) => (finite(x) && Math.abs(x) > Math.abs(mon[bk] ?? 0) ? k : bk), 0);
    facts.push(<>{p.label}：时间–深度平均差值 <b>{fmt(s / n)}</b> {u}，{Math.round((pos / n) * 100)}% 的时空点为正（比较运行更高）。</>);
    facts.push(<>时间平均的差异在约 <b>{depth[kz].toFixed(0)} m</b> 最大（{fmt(prof[kz])}），季节上集中在 <b>{km + 1} 月</b>；单点最大差异出现在 {best.t.slice(0, 7)}、约 {best.z.toFixed(0)} m（{fmt(best.a)}）。</>);
    why.push(<>差值图回答“改动发生在何时、何深度”：如果差异集中在春夏的上层，说明改动主要通过藻华和摄食起作用；集中在底层则多与碎屑沉降和分解有关。</>);
    return <Reading what={<><b>{label}</b>：{CAT[cat].what}</>} facts={facts} why={why} how="颜色 = 比较运行 − 基准运行（左侧第一个勾选的运行）。红色表示比较运行更高，蓝色更低，白色几乎相同；色标两端对称。" />;
  }

  // global maximum
  let mx = { v: -Infinity, t: "", z: 0 };
  vals.forEach((row, k) => row.forEach((x, j) => { if (finite(x) && x > mx.v) mx = { v: x, t: time[j], z: depth[k] }; }));
  if (finite(mx.v)) facts.push(<>最大值 <b>{fmt(mx.v)}</b> {u}，出现在 {mx.t.slice(0, 7)}、约 {mx.z.toFixed(0)} m 深处。</>);
  if (strat.length) facts.push(<>混合层在 <b>{range(strat)}</b> 浅于水深的一半（{H.toFixed(0)} m 水柱）：这段时间水柱处于层化状态，其余月份基本混合。</>);
  else if (m0 && !m0.missing) facts.push(<>混合层全年都较深：这个站点的水柱基本常年混合，没有稳定的层化期。</>);

  if (se.tropical && (cat === "temp" || NUTRIENT.has(cat))) facts.push(<>热带站点：下文的“冬季 / 夏季”只是相对的冷季和暖季，季节差异通常比温带小得多。</>);
  if (cat === "temp") {
    const dT = sS - sB;
    if (finite(dT)) facts.push(dT > 2 ? <>夏季（{se.sl}）表层 {fmt(sS)} °C、底层 {fmt(sB)} °C，相差 <b>{dT.toFixed(1)} °C</b>：温跃层把水柱分成了上下两层。</> : <>夏季表底温差只有 {dT.toFixed(1)} °C：潮流和风把整根水柱搅得比较均匀。</>);
    if (finite(wS - wB) && Math.abs(wS - wB) < 0.5) facts.push(<>冬季（{se.wl}）表底温差不到 0.5 °C：冬季风大、表层冷却下沉，整柱充分混合。</>);
    why.push(<>表层吸收太阳热量后变轻，像盖子一样浮在冷而重的底层水上；风和潮流的搅拌不足以打破这个密度差时，就形成温跃层。秋季降温和风暴使表层变重，跃层逐渐下移直到消失。</>);
  } else if (NUTRIENT.has(cat)) {
    if (finite(wS) && finite(sS) && wS > 0) facts.push(sS < 0.3 * wS ? <>表层从冬季的 {fmt(wS)} 降到夏季的 <b>{fmt(sS)}</b> {u}（只剩 {Math.round((sS / wS) * 100)}%）：被浮游植物吸收殆尽。</> : <>表层夏季（{fmt(sS)}）仍有冬季（{fmt(wS)}）的 {Math.round((sS / wS) * 100)}%：营养盐没有被耗尽，浮游植物更可能受光照限制。</>);
    if (finite(sB) && finite(sS) && sB > 1.5 * sS) facts.push(<>同期底层保持 {fmt(sB)} {u}，是表层的 {fmt(sB / Math.max(sS, 1e-9))} 倍：营养盐被“锁”在跃层以下，要等秋冬混合才回到表层。</>);
    why.push(<>浮游植物只能在有光的上层生长，它们吸收营养盐后死亡下沉，把营养盐带到深处分解释放。层化期间上下几乎不交换，于是上层越来越“饿”，下层越积越多。</>);
  } else if (cat === "oxygen") {
    if (finite(wB) && finite(sB) && wB > 0) facts.push(sB < 0.9 * wB ? <>底层溶解氧从冬季 {fmt(wB)} 降到夏季 <b>{fmt(sB)}</b> {u}（下降 {Math.round((1 - sB / wB) * 100)}%）。</> : <>底层溶解氧夏季（{fmt(sB)}）与冬季（{fmt(wB)}）接近：底层没有明显耗氧。</>);
    why.push(<>表层与大气交换并有光合作用产氧；层化后底层被隔开，沉下来的有机物分解持续耗氧却得不到补充。陆架海夏季底层缺氧就是这样形成的。冷水溶解氧更多，所以冬季整柱也偏高。</>);
  } else if (PHYTO.has(cat) || ZOO.has(cat) || cat === "detritus" || cat === "bacteria" || cat === "dom") {
    // column-mean seasonal peak
    const colMean = time.map((_, j) => mean(vals.map((row) => row[j])));
    const monthly = Array.from({ length: 12 }, (_, m) => monthlyMean(colMean, time, [m + 1]));
    const pk = monthly.indexOf(Math.max(...monthly.filter(finite)));
    if (pk >= 0) facts.push(<>整柱平均在 <b>{pk + 1} 月</b>最高。</>);
    // summer sub-surface maximum
    const prof = depth.map((_, k) => monthlyMean(vals[k], time, se.summer3));
    const kmax = prof.indexOf(Math.max(...prof.filter(finite)));
    if (PHYTO.has(cat) && kmax >= 0 && depth[kmax] > Math.max(5, 0.1 * H) && prof[kmax] > 1.2 * prof[si]) facts.push(<>夏季（{se.s3l}）浓度最大的位置在约 <b>{depth[kmax].toFixed(0)} m</b>，比表层高 {Math.round((prof[kmax] / Math.max(prof[si], 1e-9) - 1) * 100)}%：这是次表层叶绿素最大值。</>);
    if (cat === "detritus" && finite(sB) && finite(sS) && sB > 1.5 * sS) facts.push(<>夏季底层是表层的 {fmt(sB / Math.max(sS, 1e-9))} 倍：碎屑在下沉并在底部积累。</>);
    if (PHYTO.has(cat)) {
      if (se.nh(pk + 1) >= 3 && se.nh(pk + 1) <= 5) why.push(<>春季光照增强、层化刚建立，浮游植物被留在有光的上层，营养盐又最充足，于是爆发藻华；营养盐耗尽后表层浓度下降。</>);
      else if (se.nh(pk + 1) >= 6 && se.nh(pk + 1) <= 9) why.push(<>这里浮游植物在夏季最多，而不是典型的春华：层化后，跃层附近同时有光（来自上方）和营养盐（来自下方），浮游植物在那里持续生长，次表层的贡献超过了表层的春季峰值。可以对照营养盐的时间–深度图，看跃层下的营养盐是否在被缓慢消耗。</>);
      else why.push(<>浮游植物的生长同时受光照（冬季弱）和营养盐（夏季表层少）限制，峰值出现在两者都较充足的时段。</>);
      why.push(<>夏季上面有光缺营养、下面有营养缺光，只有跃层附近两者兼得，所以浓度最大值常下移到次表层。</>);
    }
    if (ZOO.has(cat)) why.push(<>浮游动物以浮游植物（或更小的浮游动物）为食，食物先增长，它们才跟着增长，所以峰值滞后几周；它们的捕食又会压低浮游植物，帮助结束藻华。</>);
    if (cat === "detritus") why.push(<>死亡的浮游生物和粪便比水重，会下沉；层化期间混合弱，它们沉到跃层以下和海底附近，在那里被细菌分解，消耗氧并释放营养盐。</>);
  } else if (CAT[cat].season) why.push(<>{CAT[cat].season}</>);

  if (panels.length > 1) {
    const base = mean(vals.flat());
    const others = panels.slice(1).map((q) => ({ l: q.label, d: pct(base, mean((q.values as any[]).flat())) })).filter((x) => finite(x.d));
    if (others.length) facts.push(<>与 {p.label} 相比，时间–深度平均：{others.map((x, i) => <span key={i}>{i ? "；" : ""}{x.l} <b>{sp(x.d)}</b></span>)}。想看差异发生在何时何地，勾选“与基准的差值”。</>);
  }
  return <Reading what={<><b>{label}</b>：{CAT[cat].what}</>} facts={facts} why={why}
    how="横轴是时间，纵轴是深度（向下越深），颜色是浓度；黑色虚线是表层混合层深度，虚线以上的水被充分搅匀。多个运行时上下排列、共用色标。" />;
}

// ------------------------------------------------------------------ annual cycle / full series
export function SeriesReading({ data, kind, v, label, mode, repeat }: { data: any; kind: "annual" | "series"; v: string; label: string; mode: string; repeat: boolean }) {
  const cat = varCat(v);
  const se = useSeason();
  const ss = (data?.series ?? []).filter((s: any) => !s.missing);
  if (!ss.length) return null;
  const u = data.units ?? "";
  const facts: ReactNode[] = [], why: ReactNode[] = [];
  const modeTxt: Record<string, string> = { integral: "整根水柱的总量（深度积分）", mean: "全水柱平均", surface: "表层", bottom: "底层" };
  if (kind === "annual") {
    const info = ss.map((s: any) => {
      const m = s.mean as number[]; const vv = m.filter(finite);
      const imax = m.indexOf(Math.max(...vv)), imin = m.indexOf(Math.min(...vv));
      return { s, max: m[imax], dmax: s.doy[imax], min: m[imin], dmin: s.doy[imin], avg: mean(m) };
    });
    const a = info[0];
    facts.push(<>{a.s.label}：峰值在约 <b>{doyMonth(a.dmax)} 月</b>（{fmt(a.max)} {u}），最低在 {doyMonth(a.dmin)} 月（{fmt(a.min)}），全年平均 {fmt(a.avg)}{a.min > 0 ? `，季节最高是最低的 ${fmt(a.max / a.min)} 倍` : ""}。</>);
    info.slice(1).forEach((b: any) => {
      const dd = b.dmax - a.dmax;
      facts.push(<>{b.s.label}：年均 <b>{sp(pct(a.avg, b.avg))}</b>，峰值{Math.abs(dd) < 4 ? "时间基本相同" : `${dd > 0 ? "推迟" : "提前"}约 ${Math.abs(dd)} 天`}，峰值高度 {sp(pct(a.max, b.max))}。</>);
    });
    if (a.s.years > 1) {
      const w = mean((a.s.max as number[]).map((x: number, i: number) => (x - a.s.min[i]) / Math.max(Math.abs(a.s.mean[i]), 1e-12)));
      if (repeat) facts.push(w > 0.05 ? <>阴影（{a.s.years} 年的最小–最大）平均宽 ±{Math.round(w * 50)}%：每年用的是同一年的强迫，各年本应相同，阴影较宽说明模型仍在逐年漂移，尚未达到周期稳态。</> : <>阴影几乎看不见（各年差异 &lt; 5%）：重复强迫下各年几乎一样，模型已接近周期稳态。</>);
      else facts.push(<>阴影是 {a.s.years} 年的最小–最大范围，反映真实气象的年际差异。</>);
    }
  } else {
    const s = ss[0], t: string[] = s.time, vals: number[] = s.values;
    const y0 = t[0]?.slice(0, 4), y1 = t[t.length - 1]?.slice(0, 4);
    const first = mean(vals.filter((_, i) => t[i].startsWith(y0))), last = mean(vals.filter((_, i) => t[i].startsWith(y1)));
    if (finite(first) && finite(last)) facts.push(<>{s.label}：{y0} 年平均 {fmt(first)}，{y1} 年平均 {fmt(last)} {u}（{sp(pct(first, last))}）。{repeat ? (Math.abs(pct(first, last)) > 5 ? "重复强迫下首末年仍相差较大，说明有长期漂移。" : "首末年接近，说明没有明显的长期漂移。") : ""}</>);
  }
  let peakMonth = 0;
  if (kind === "annual") { const m = ss[0].mean as number[]; peakMonth = doyMonth(ss[0].doy[m.indexOf(Math.max(...m.filter(finite)))]); }
  if (PHYTO.has(cat) && kind === "annual") {
    if (se.nh(peakMonth) >= 3 && se.nh(peakMonth) <= 5) why.push(<>峰值在春季：光照增强、层化刚建立、营养盐最充足，浮游植物爆发藻华；之后表层营养盐耗尽而下降。秋季风暴把底层营养盐重新搅上来，有时会出现第二个较小的秋华。</>);
    else if (se.nh(peakMonth) >= 6 && se.nh(peakMonth) <= 9) why.push(<>峰值在夏季而不是典型的春华：层化后跃层附近同时有光和营养盐，浮游植物在次表层持续生长并积累。到“时间–深度”页可以看到这个次表层最大值。</>);
    else why.push(<>峰值出现在 {peakMonth} 月：浮游植物的生长同时受光照和营养盐限制，峰值落在两者都较充足的时段。</>);
  } else if (CAT[cat].season) why.push(<>{CAT[cat].season}</>);
  if (cat === "fish") why.push(<>Vijayakumaran 等 (2026)用 IBTS 拖网调查的单位捕捞量（CPUE）年循环与模拟的鱼 1 / 鱼 2 比较：鱼 1 在夏季开始上升、生物量高于鱼 2。</>);
  return <Reading what={<><b>{label}</b>（{modeTxt[mode] ?? mode}）：{CAT[cat].what}</>} facts={facts} why={why}
    how={kind === "annual" ? "横轴是一年中的日期，粗线是分析时段各年同一天的平均，阴影是各年的最小–最大范围；每种颜色是一个运行。" : "横轴是完整的模拟时间，包括预热年份；可以看出模型是否逐年稳定下来。"} />;
}

// ------------------------------------------------------------------ vertical profiles
export function ProfileReading({ data, v, label }: { data: any; v: string; label: string }) {
  const cat = varCat(v);
  const prs = (data?.profiles ?? []) as any[];
  if (!prs.length) return null;
  const u = data.units ?? "";
  const first = prs[0].label;
  const facts: ReactNode[] = [];
  for (const pr of prs.filter((x) => x.label === first)) {
    const d: number[] = pr.depth, x: number[] = pr.values;
    const si = d.indexOf(Math.min(...d)), bi = d.indexOf(Math.max(...d));
    const vv = x.filter(finite), lo = Math.min(...vv), hi = Math.max(...vv), m = mean(x);
    const kmax = x.indexOf(hi);
    let shape: string;
    if (!vv.length) continue;
    if ((hi - lo) / Math.max(Math.abs(m), 1e-12) < 0.1) shape = "上下几乎一样（充分混合）";
    else if (kmax !== si && kmax !== bi && d[kmax] > 3 && hi > 1.2 * x[si] && hi > 1.2 * x[bi]) shape = `中间高，最大值在约 ${d[kmax].toFixed(0)} m（次表层最大值）`;
    else if (x[si] > x[bi]) shape = `表层高（${fmt(x[si])}）、底层低（${fmt(x[bi])}）`;
    else shape = `底层高（${fmt(x[bi])}）、表层低（${fmt(x[si])}）`;
    facts.push(<><b>{pr.month} 月</b>：{shape}。</>);
  }
  const why: ReactNode[] = [];
  if (cat === "temp") why.push(<>冬季剖面竖直（混合），夏季上暖下冷、中间温度急变的一段就是温跃层。</>);
  if (NUTRIENT.has(cat)) why.push(<>夏季表层营养盐被浮游植物吃光，底层因分解而积累，所以剖面“上低下高”；冬季混合后又变竖直。</>);
  if (PHYTO.has(cat)) why.push(<>浮游植物需要光（上面多）和营养盐（下面多），夏季两者在跃层附近兼得，常出现次表层最大值。</>);
  if (cat === "oxygen") why.push(<>层化季节底层得不到大气补氧，分解持续耗氧，剖面“上高下低”。</>);
  return <Reading what={<><b>{label}</b>：{CAT[cat].what}</>} facts={facts} why={why}
    how={`纵轴是深度（向下越深），横轴是浓度（${u}）；每种线型是一个月份（分析时段的月平均），颜色区分运行。比较冬季和夏季的剖面，最能看出层化的作用。`} />;
}

// ------------------------------------------------------------------ column animation (state at one instant)
export function ColumnReading({ date, depth, temps, mld, phyto, nut, nutMax, hasFish }: { date: string; depth: number[]; temps: number[]; mld?: number | null; phyto: number[]; nut: number[]; nutMax: number; hasFish: boolean }) {
  const si = depth.indexOf(Math.min(...depth)), bi = depth.indexOf(Math.max(...depth)), H = depth[bi];
  const dT = temps[si] - temps[bi];
  const facts: ReactNode[] = [];
  const state = dT > 2 ? "强层化" : dT > 0.5 ? "开始分层" : "充分混合";
  facts.push(<>此刻（{date}）表底温差 <b>{dT.toFixed(1)} °C</b>{finite(mld) ? `，混合层 ${mld.toFixed(0)} m（占水深 ${Math.round((Math.min(mld, H) / H) * 100)}%）` : ""}：水柱<b>{state}</b>。</>);
  if (phyto.length) {
    const k = phyto.indexOf(Math.max(...phyto.filter(finite)));
    if (k >= 0) facts.push(<>浮游植物最多的位置在约 <b>{depth[k].toFixed(0)} m</b>{finite(mld) ? (depth[k] > mld + 2 ? "，在混合层以下（次表层）" : "，在混合层之内") : ""}。</>);
  }
  if (nut.length && nutMax > 0) {
    const r = nut[si] / nutMax;
    facts.push(<>表层营养盐是全年最高值的 <b>{Math.round(r * 100)}%</b>：{r < 0.15 ? "接近耗尽，浮游植物生长受营养盐限制" : r < 0.5 ? "正在被消耗" : "充足"}。</>);
  }
  return <Reading facts={facts}
    why={[<>拖动时间条看一年的循环：冬季混合、营养盐充足但光照弱 → 春季层化建立、藻华爆发 → 夏季表层营养盐耗尽、浮游植物退到次表层 → 秋冬风暴混合，营养盐回到表层，为下一年做准备。</>]}
    how={`左边的水柱按温度着色（暖色为暖水），虚线是混合层底；右边是同一时刻各变量的剖面，每个变量除以它全年的最大值，便于放在一起比较。${hasFish ? "鱼形符号按浮游动物的垂向分布摆放，只是“鱼跟着食物走”的示意，模型中的鱼没有垂向位置。" : ""}`} />;
}

// ------------------------------------------------------------------ MIZER size spectrum
export function SpectrumReading({ ds }: { ds: any[] }) {
  const stats = ds.map((d) => {
    const xs: number[] = [], ys: number[] = [];
    d.w.forEach((w: number, i: number) => { const y = d.density[i]; if (w >= 1 && w <= 1000 && finite(y) && y > 0) { xs.push(Math.log10(w)); ys.push(Math.log10(y)); } });
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
    let big = 0, all = 0;
    d.w.forEach((w: number, i: number) => { const dw = i ? w - d.w[i - 1] : 0; const b = (d.density[i] ?? 0) * dw; if (finite(b)) { all += b; if (w >= 80) big += b; } });
    return { l: d.label, slope: sxx ? sxy / sxx : NaN, big, all };
  });
  const a = stats[0];
  const facts: ReactNode[] = [];
  if (finite(a.slope)) facts.push(<>{a.l}：1–1000 g 范围内谱斜率约 <b>{a.slope.toFixed(2)}</b>（{a.slope < -1.3 ? "比 −1 陡：大鱼相对较少" : a.slope > -0.7 ? "比 −1 平缓：大鱼相对较多" : "接近 −1"}）；≥ 80 g 的可捕鱼约占总生物量的 {Math.round((a.big / Math.max(a.all, 1e-12)) * 100)}%。</>);
  if (finite(a.all) && a.all > 0 && a.big / a.all < 0.05) facts.push(<>可捕的大鱼（≥ 80 g）几乎没有：MIZER 从很小的鱼苗开始，大鱼要经过多年生长才会出现。预热只有一两年时，谱的大端偏低主要反映“还没长大”，而不是生态结论；研究用途请增加预热年数。</>);
  stats.slice(1).forEach((b) => facts.push(<>{b.l}：斜率 {b.slope.toFixed(2)}，可捕鱼生物量 {sp(pct(a.big, b.big))}，总生物量 {sp(pct(a.all, b.all))}。</>));
  return <Reading what="群落粒径谱：把所有鱼按个体体重分档，看每个体重档有多少生物量。它不分物种，只关心“多大”，因为在海洋里“谁吃谁”主要由个体大小决定。"
    facts={facts}
    why={[<>斜率 −1（双对数坐标下）表示每个对数体重区间的生物量大致相等，这是经典的 Sheldon 谱。能量每向上传一级只有一小部分被转化，所以大鱼通常更少；捕捞会额外移除大鱼，使谱的大端变陡。</>,
      <>双向耦合时鱼会把自己的食物吃少，粒径谱整体降低；单向耦合时食物不受鱼的影响，谱往往偏高（参考 Powley 等 2026 图 S3/S4）。</>]}
    how="横轴是个体湿重（对数坐标），纵轴是单位体重区间的生物量密度（对数坐标）；红色虚线是捕捞下限 80 g，右侧的鱼才会被捕捞。" />;
}

// ------------------------------------------------------------------ food web state
export function WebReading() {
  return <Reading what="食物网：每个节点是一个生物或物质库，箭头表示谁吃谁（物质从被吃者流向捕食者）。"
    facts={[<>节点里的条形是该类群在分析时段的年均生物量，在同一营养级内相对比较：条越长，说明这个类群在当前运行中越重要。</>, <>悬停或点击节点会高亮它的食物和捕食者，可以追踪一条能量通路，例如 硅藻 → 中型浮游动物 → 鱼。</>]}
    why={[<>同一营养级里哪个类群占优，决定了能量走哪条路：以硅藻和中型浮游动物为主的“经典食物链”把更多能量传给鱼；以小型藻类、微型浮游动物和细菌为主的“微食物环”中，能量在小生物之间多次周转、损耗更大。</>]}
    how="从下往上是营养级：营养盐与碎屑 → 浮游植物 → 浮游动物 → 鱼与底栖动物。切换运行可以比较不同配置下各类群的相对大小。" />;
}

// ------------------------------------------------------------------ indicator comparison
const E2E_NAME: Record<string, string> = { macrobenthos: "大型底栖", fish1: "鱼 1", fish2: "鱼 2" };
function htlText(spec: any) {
  const h = spec?.htl;
  if (!h || h.kind === "none") return "只有低营养级";
  if (h.kind === "mizer") return h.mizer?.feedback === false ? "MIZER 鱼类（单向，无反馈）" : "MIZER 鱼类（双向反馈）";
  const g = Object.entries(E2E_NAME).filter(([k]) => h.e2e?.[k]).map(([, n]) => n);
  return g.length ? `E2E：${g.join("、")}` : "E2E（未启用功能群）";
}
export function CompareReading({ t, runs }: { t: any; runs: any[] }) {
  if (runs.length < 2) {
    return <div className="reading reading-cols"><h4>怎么读</h4><p>这里是所选运行在分析时段的年均指标。在左侧再勾选一个运行（第一个勾选的作为基准），就能看到相对变化和机制解释。</p></div>;
  }
  const last = runs.length - 1;
  const A = runs[0], B = runs[last];
  const rows = t.rows.filter((r: any) => !["sst", "sbt"].includes(r.key));
  const chg: Record<string, number | null> = Object.fromEntries(rows.map((r: any) => [r.key, r.pct[last]]));
  const signed = (r: any) => r.key === "co2" || (finite(r.values[0]) && finite(r.values[last]) && r.values[0] * r.values[last] < 0);
  const big = rows.filter((r: any) => finite(r.pct[last]) && !signed(r) && Math.abs(r.pct[last]) >= 3).sort((x: any, y: any) => Math.abs(y.pct[last]) - Math.abs(x.pct[last]));
  const small = rows.filter((r: any) => finite(r.pct[last]) && !signed(r) && Math.abs(r.pct[last]) < 3 && !r.label.startsWith("  "));
  const newIn = [...new Set(rows.filter((r: any) => r.values[0] == null && finite(r.values[last]) && !r.label.startsWith("  ")).map((r: any) => r.label.trim().replace(/\s*(生物量|湿重|生产|渔获量)$/, "")))];
  const collapse = rows.filter((r: any) => finite(r.pct[last]) && r.pct[last] <= -90);
  const pairKey = pairKeyOf({ spec: A.spec }, { spec: B.spec });
  const kA = configKind({ spec: A.spec }), kB = configKind({ spec: B.spec });
  const facts: ReactNode[] = [];
  facts.push(<>以 <b>{A.label}</b>（{htlText(A.spec)}）为基准，<b>{B.label}</b>（{htlText(B.spec)}）。</>);
  if (big.length) facts.push(<>变化最大的：{big.slice(0, 5).map((r: any, i: number) => <span key={r.key}>{i ? "，" : ""}{r.label.trim()} <b>{sp(r.pct[last])}</b></span>)}。</>);
  if (small.length) facts.push(<>几乎不变（&lt; 3%）：{small.slice(0, 6).map((r: any) => r.label.trim()).join("、")}。</>);
  const co2 = rows.find((r: any) => r.key === "co2");
  if (co2 && finite(co2.values[0]) && finite(co2.values[last]) && co2.values[0] !== co2.values[last]) facts.push(<>海气 CO₂ 通量从 {fmt(co2.values[0])} 变为 {fmt(co2.values[last])} {co2.units}（正值为海洋吸收）；这个量接近 0，请看差值而不是百分比。</>);
  if (newIn.length) facts.push(<>基准中没有、比较运行中新出现的类群：{newIn.join("、")}（无法算百分比）。</>);
  const cas = cascadeText(chg);
  const why: ReactNode[] = [];
  const intro = pairKey === "ltl>e2e" ? `基准只有低营养级；比较运行加入了 ${htlText(B.spec).replace("E2E：", "")}，它们的摄食、排泄和呼吸都反馈给宿主模型。` : kA === "e2e" && kB === "e2e" ? `两个运行的高营养级组成不同：基准是 ${htlText(A.spec)}，比较是 ${htlText(B.spec)}。差异来自多出来或少掉的那些功能群。` : PAIR_INTRO[pairKey];
  if (intro) why.push(intro);
  if (cas) why.push(cas);
  for (const r of big.slice(0, 4)) {
    if (cas && /Z5|Z6|microzoo/.test(r.key)) continue; // already covered by the cascade sentence
    const m = mechanism(r.key, pairKey, r.pct[last], { chg }); if (m && !why.includes(m)) why.push(m);
  }
  if (A.spec?.host && B.spec?.host && A.spec.host !== B.spec.host) why.unshift(`注意：两个运行的宿主模型不同（${A.spec.host} vs ${B.spec.host}），差异同时包含宿主本身的差别，不能只归因于高营养级。`);
  return (
    <div className="reading reading-cols">
      <h4>这组对比说明了什么</h4>
      <ul>{facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
      {collapse.length > 0 && <p className="reading-warn">{collapse.map((r: any) => r.label.trim()).join("、")} 下降超过 90%，几乎消失。真实海洋中很少出现这种情况，通常说明高营养级的捕食参数在这个宿主中偏强，或该类群缺少避难所（例如没有最低生物量）。用于研究前，建议用“参数扫描”检查捕食参数，或对照已发表的同类结果。</p>}
      {why.length > 0 && <><h4>为什么</h4>{why.map((x, i) => <p key={i}>{x}</p>)}</>}
      <h4>怎么读</h4>
      <p>所有指标都是分析时段的年平均；浮游生物和鱼是整根水柱的总量（深度积分）。百分比 = (比较 − 基准) / 基准。左侧第一个勾选的运行就是基准：例如先勾选“仅低营养级”，再勾选加入鱼类的运行，就能看到高营养级的作用。</p>
      {runs.length > 2 && <p className="soft">勾选了 {runs.length} 个运行，以上文字比较第一个与最后一个；柱状图和表格包含全部运行。</p>}
    </div>
  );
}
export { infoKey, METRIC_INFO };
