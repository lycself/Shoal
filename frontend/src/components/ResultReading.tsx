/**
 * Figure reading for the single-column result tabs (time–depth, annual cycle, profiles,
 * column animation, size spectrum, food web, indicator comparison).
 *
 * Each reader states what the variable is, what this particular figure shows (computed from the
 * plotted data), and the physical / ecological reason, phrased for beginners. Interpretive
 * sentences are only emitted when the data support them (thresholds below), so the text follows
 * the figure instead of a textbook expectation.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useApp } from "../store";
import { fmt, Icon, IconBtn, RightPane } from "./ui";
import { METRIC_INFO, PAIR_INTRO, cascadeText, configKind, infoKey, mechanism, pairKeyOf } from "./ShelfExplain";

// ------------------------------------------------------------------ variable catalogue
type Cat = "temp" | "salt" | "nitrate" | "ammonium" | "phosphate" | "silicate" | "oxygen" | "dic" | "diatoms" | "flagellates" | "pico" | "largephyto"
  | "cyano" | "chl" | "mesozoo" | "microzoo" | "hnf" | "zoo" | "bacteria" | "dom" | "detritus" | "fish" | "benthos" | "meiobenthos" | "mld" | "mixing" | "buoyancy" | "forcing" | "other";

const RULES: [RegExp, Cat][] = [
  [/^temp$|^sst$|^tprof/, "temp"], [/^salt$|^sprof/, "salt"],
  [/^N3_n$|ECO_no3|ergom_nn/, "nitrate"], [/^N4_n$|ECO_nh4|ergom_aa/, "ammonium"], [/^N1_p$|ECO_pho|ergom_po/, "phosphate"], [/^N5_s$|ECO_sil/, "silicate"],
  [/^O2_o$|ECO_oxy|ergom_o2/, "oxygen"], [/^O3_c$|dic/i, "dic"],
  [/^P1_c$|ECO_dia|ergom_pp/, "diatoms"], [/^P2_c$|ECO_fla|ergom_ff/, "flagellates"], [/^P3_c$/, "pico"], [/^P4_c$/, "largephyto"], [/ECO_bg|ergom_bb/, "cyano"],
  [/chl/i, "chl"], [/^Z4_c$|ECO_mesozoo/, "mesozoo"], [/^Z5_c$|ECO_microzoo/, "microzoo"], [/^Z6_c$/, "hnf"], [/ergom_zz/, "zoo"],
  [/^B1_c$/, "bacteria"], [/^R[1-3]_c$|^Q1_c$|ECO_dom/, "dom"], [/^R[4-8]_c$|^Q[67]_c$|ECO_det|ergom_dd/, "detritus"],
  [/^F[12]_c$|fish/, "fish"], [/^MB_c$|^Y[23]_c$/, "benthos"], [/^Y4_c$/, "meiobenthos"], [/^mld/, "mld"], [/^NN$/, "buoyancy"], [/^nu[hms]$|^tke$|^eps$/, "mixing"],
  [/^(u10|v10|airt|rad|airp|hum|cloud|precip|taub|tx|ty)$/, "forcing"],
];
export function varCat(name: string): Cat { return RULES.find(([rx]) => rx.test(name))?.[1] ?? "other"; }

const CAT: Record<Cat, { what: string; season?: string }> = {
  temp: { what: "海水温度。温度决定海水密度（暖水轻、冷水重），上下温差直接影响水柱是否分层。", season: "表层温度随太阳辐射变化，但因海水热容量大，峰值通常比夏至滞后 1–2 个月。" },
  salt: { what: "盐度。在没有径流和平流的一维水柱模型中，盐度主要由向气候态的松弛维持，季节变化较小。" },
  nitrate: { what: "硝酸盐，浮游植物最主要的无机氮来源。", season: "冬季垂向混合将底层硝酸盐带回表层，浓度达到全年最高；春季藻华爆发后，表层硝酸盐被迅速消耗。" },
  ammonium: { what: "铵盐，由浮游动物排泄和细菌矿化产生，属于再生氮源，可被浮游植物优先吸收。", season: "通常在藻华消退后、有机物分解旺盛的季节较高。" },
  phosphate: { what: "磷酸盐，浮游植物生长必需的无机磷来源。", season: "季节变化与硝酸盐类似：冬季混合期偏高，春夏季被表层浮游植物大量吸收。" },
  silicate: { what: "硅酸盐，硅藻形成硅质壳体必需的营养盐。", season: "春季硅藻大量繁殖时会率先耗尽表层硅酸盐，导致硅藻水华结束，随后由不需要硅的鞭毛藻接替。" },
  oxygen: { what: "溶解氧。表层有海气交换和光合作用产氧，底层则以有机物分解耗氧为主。", season: "冬季水温低、溶解度高且整柱混合，溶解氧普遍较高；夏秋季层化阻断上下交换，底层溶解氧逐渐下降。" },
  dic: { what: "溶解无机碳（CO₂、HCO₃⁻ 和 CO₃²⁻ 的总和）。光合作用消耗溶解无机碳，呼吸与矿化则释放溶解无机碳。" },
  diatoms: { what: "硅藻：个体较大的浮游植物，生长迅速但依赖硅酸盐，是温带海区春季藻华的主要类群。", season: "早春光照增强、层化初建且营养盐充足时最先爆发。" },
  flagellates: { what: "微型浮游植物（2–20 µm，以鞭毛藻为主；在 ECOSMO 与 ERGOM 中统称鞭毛藻）：不需要硅酸盐，在低营养盐环境下更具竞争优势。", season: "常在春季硅藻水华消退后的夏季占优。" },
  pico: { what: "超微型浮游植物（< 2 µm）：个体最小，比表面积大，在夏季表层寡营养水体中占优。" },
  largephyto: { what: "小型浮游植物（20–200 µm，如甲藻）：不需要硅酸盐，个体较大，常见于夏季层化水体。" },
  cyano: { what: "蓝藻：具有固氮能力，在温暖且无机氮耗尽的夏季表层占优（波罗的海尤为典型）。" },
  chl: { what: "叶绿素 a：浮游植物的主要光合色素，也是卫星水色遥感直接观测的生物量指标。" },
  mesozoo: { what: "中型浮游动物（桡足类等，约 0.2–2 mm）：浮游食性鱼类的主要饵料。", season: "生物量峰值通常比浮游植物滞后数周。" },
  microzoo: { what: "微型浮游动物（纤毛虫等，约 20–200 µm）：摄食较小粒径的浮游植物和异养鞭毛虫，同时被中型浮游动物捕食。", season: "世代周期短，能较快响应小型藻类的增长。" },
  hnf: { what: "异养鞭毛虫（约 2–20 µm）：摄食细菌和超微型浮游植物，是微食物环的关键中间类群。" },
  zoo: { what: "浮游动物：连接初级生产者与鱼类的中间营养级。", season: "生物量峰值通常比浮游植物滞后数周。" },
  bacteria: { what: "异养细菌：吸收并分解溶解有机物，将无机营养盐重新释放回水体（再矿化）。" },
  dom: { what: "溶解有机物：由浮游生物渗出、排泄和细胞裂解产生，供细菌吸收利用。按降解速率可分为易降解、半易降解和半难降解组分（ERSEM 以 R1–R3 区分，Q1 为沉积物间隙水中的溶解有机物）。" },
  detritus: { what: "颗粒有机碎屑：主要来自死亡浮游生物与粪便颗粒，在沉降过程中及到达海底后被细菌分解为无机营养盐。", season: "春季藻华后显著增加，并向深层沉降。" },
  fish: { what: "鱼类生物量。由于鱼类世代周期长，对环境与饵料变化的完整响应通常需要数年。" },
  benthos: { what: "大型底栖动物（双壳类、多毛类等）：栖息于海底，以沉降的颗粒有机物为食。", season: "通常在春季藻华沉降高峰之后增长。" },
  meiobenthos: { what: "小型底栖动物（线虫、底栖桡足类等，体长 < 1 mm）：栖息于沉积物间隙，摄食细菌和沉积有机物。", season: "随沉降到海底的有机物质通量变化。" },
  mld: { what: "表层混合层深度：受风应力和海面冷却驱动、垂向混合均匀的表层水体厚度。", season: "冬季风浪大且表层冷却对流，混合层较深；夏季表层受热增温，混合层变浅。" },
  mixing: { what: "湍流扩散系数与湍流动能等垂向混合指标：数值越大，上下水层的物质与热量交换越快。" },
  buoyancy: { what: "浮力频率平方 N²：衡量水柱层化稳定度的指标。上下密度差越大，N² 越大，湍流越难穿透跃层。", season: "夏季在温跃层处达到最大，冬季整柱混合时接近 0。" },
  forcing: { what: "大气强迫场（ERA5 再分析数据）：包括风速、气温、短波辐射、气压、湿度与降水，用于驱动海气界面的动量与热通量。" },
  other: { what: "模型输出变量。" },
};
const NUTRIENT = new Set<Cat>(["nitrate", "phosphate", "silicate"]);
const PHYTO = new Set<Cat>(["diatoms", "flagellates", "pico", "largephyto", "cyano", "chl"]);
const ZOO = new Set<Cat>(["mesozoo", "microzoo", "hnf", "zoo"]);

// ------------------------------------------------------------------ small numeric helpers
const finite = (v: any): v is number => typeof v === "number" && isFinite(v);
const mean = (v: (number | null)[]) => { let s = 0, n = 0; for (const x of v) if (finite(x)) { s += x; n++; } return n ? s / n : NaN; };
const monthOf = (iso: string) => +String(iso).slice(5, 7);
const doyMonth = (d: number) => new Date(Date.UTC(2001, 0, Math.round(d))).getUTCMonth() + 1;
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
export function FigAside({ open, figure, reading, toggle }: { open: boolean; figure: ReactNode; reading: ReactNode; toggle?: () => void }) {
  // when the column is too narrow for figure and notes side by side (e.g. the assistant is open), the notes float
  // over the figure's right edge instead of squeezing the figure and clipping their own text
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 760));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // in a narrow column the notes start hidden (the figure needs the room); each press of the book button shows/hides them
  const [local, setLocal] = useState(false);
  const firstOpen = useRef(true);
  useEffect(() => { setLocal(false); }, [narrow]);
  useEffect(() => { if (firstOpen.current) { firstOpen.current = false; return; } if (narrow) setLocal((v) => !v); }, [open]);
  const shown = narrow ? local : open;
  return (
    <div className={`fig-aside ${narrow ? "narrow" : ""}`} ref={ref}>
      <div className="fig-main">{figure}</div>
      <RightPane id="reading" open={shown} onClose={() => (narrow ? setLocal(false) : toggle?.())} initial={340} min={260} max={560} label="读图说明" className="reading-rpane">
        <div className="reading-aside-inner">{reading}</div>
      </RightPane>
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
  const perm = strat.length === 12; // shallower than half the depth all year: permanently stratified
  if (perm) strat = [];
  const neverStrat = !!(m0 && !m0.missing) && !perm && !strat.length;

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
  else if (perm) facts.push(<>混合层全年都浅于水深的一半（{H.toFixed(0)} m 水柱）：水柱常年层化（深水或热带站点常见）。</>);
  else if (neverStrat) facts.push(<>混合层全年都较深：这个站点的水柱基本常年混合，没有稳定的层化期。</>);

  if (se.tropical && (cat === "temp" || NUTRIENT.has(cat))) facts.push(<>热带站点：下文的“冬季 / 夏季”只是相对的冷季和暖季，季节差异通常比温带小得多。</>);
  if (cat === "temp") {
    const dT = sS - sB;
    if (finite(dT)) facts.push(dT > 2 ? <>夏季（{se.sl}）表层 {fmt(sS)} °C、底层 {fmt(sB)} °C，相差 <b>{dT.toFixed(1)} °C</b>：温跃层把水柱分成了上下两层。</> : <>夏季表底温差只有 {dT.toFixed(1)} °C：潮流和风把整根水柱搅得比较均匀。</>);
    if (finite(wS - wB) && Math.abs(wS - wB) < 0.5) facts.push(<>冬季（{se.wl}）表底温差不到 0.5 °C：冬季风大、表层冷却下沉，整柱充分混合。</>);
    why.push(<>表层受热增温后密度降低，浮在冷而重的底层水之上；当风浪和潮流混合不足以打破这一密度梯度时，便形成温跃层。秋季降温和大风使表层密度增大、混合加深，跃层随之逐渐下移直至消失。</>);
  } else if (NUTRIENT.has(cat)) {
    if (finite(wS) && finite(sS) && wS > 0) {
      const r = sS / wS, rp = Math.round(r * 100);
      facts.push(r < 0.1 ? <>表层从冬季的 {fmt(wS)} 降到夏季的 <b>{fmt(sS)}</b> {u}（只剩 {rp}%）：被浮游植物吸收殆尽。</>
        : r < 0.3 ? <>表层从冬季的 {fmt(wS)} 降到夏季的 <b>{fmt(sS)}</b> {u}（剩 {rp}%）：大部分被浮游植物吸收。</>
        : r <= 1 ? <>表层夏季（{fmt(sS)}）仍有冬季（{fmt(wS)}）的 {rp}%：营养盐没有被耗尽，浮游植物更可能受光照限制。</>
        : <>表层夏季（{fmt(sS)}）反而比冬季（{fmt(wS)}）高，是冬季的 {rp}%：这里没有“冬季积累、夏季耗尽”的典型循环，营养盐没有被耗尽，浮游植物更可能受光照限制。</>);
    }
    if (finite(sB) && finite(sS) && sB > 1.5 * sS) facts.push(<>同期底层保持 {fmt(sB)} {u}，是表层的 {fmt(sB / Math.max(sS, 1e-9))} 倍：营养盐留在跃层以下，要等秋冬混合才回到表层。</>);
    why.push(<>浮游植物集中在真光层内吸收营养盐，死亡形成的有机碎屑下沉到深层后经细菌矿化重新释放无机盐。层化期间垂向交换受阻，导致表层营养盐持续耗竭、底层不断累积。</>);
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
    const dcm = PHYTO.has(cat) && kmax >= 0 && depth[kmax] > Math.max(5, 0.1 * H) && prof[kmax] > 1.2 * prof[si];
    if (dcm) facts.push(<>夏季（{se.s3l}）浓度最大的位置在约 <b>{depth[kmax].toFixed(0)} m</b>，比表层高 {Math.round((prof[kmax] / Math.max(prof[si], 1e-9) - 1) * 100)}%：这是次表层叶绿素最大值。</>);
    if (cat === "detritus" && finite(sB) && finite(sS) && sB > 1.5 * sS) facts.push(<>夏季底层是表层的 {fmt(sB / Math.max(sS, 1e-9))} 倍：碎屑在下沉并在底部积累。</>);
    if (PHYTO.has(cat)) {
      const nm = se.nh(pk + 1);
      if (nm >= 3 && nm <= 5) why.push(neverStrat
        ? <>春季光照增强，营养盐经过冬季积累又最充足，于是爆发藻华；这里水柱全年混合，藻华主要由光照的季节变化控制。</>
        : <>春季光照增强、层化刚建立，浮游植物被留在有光的上层，营养盐又最充足，于是爆发藻华；营养盐耗尽后表层浓度下降。</>);
      else if (nm >= 6 && nm <= 9) why.push(dcm
        ? <>这里浮游植物在夏季最多，而不是典型的春华：层化后，跃层附近同时有光（来自上方）和营养盐（来自下方），浮游植物在那里持续生长，次表层的贡献超过了表层的春季峰值。可以对照营养盐的时间–深度图，看跃层下的营养盐是否在被缓慢消耗。</>
        : neverStrat
          ? <>全年混合的水柱里浮游植物主要受光照限制，光最强的夏季长得最快。</>
          : <>这里浮游植物在夏季最多，而不是典型的春华：夏季光照最强，说明营养盐供应（来自底层或分解再生）足以支撑持续生长。可以对照营养盐的时间–深度图核实。</>);
      else why.push(<>浮游植物的生长同时受光照（冬季弱）和营养盐（夏季表层少）限制，峰值出现在两者都较充足的时段。</>);
      if (dcm) why.push(<>夏季上面有光缺营养、下面有营养缺光，只有跃层附近两者兼得，所以浓度最大值下移到次表层。藻类是在那里就地生长的，不是从表层沉下去的。</>);
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
  const site: any = useApp((st) => (st.project as any)?.site_info ?? (st.project as any)?.site);
  const northSea = typeof site?.lat === "number" && typeof site?.lon === "number" && site.lat >= 51 && site.lat <= 61.5 && site.lon >= -4 && site.lon <= 9.5;
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
      const dd = ((((b.dmax - a.dmax + 182) % 365) + 365) % 365) - 182; // shortest way round the year (Dec→Jan is a few days, not 11 months)
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
    else if (se.nh(peakMonth) >= 6 && se.nh(peakMonth) <= 9) why.push(mode === "surface"
      ? <>表层浮游植物在夏季最多，而不是典型的春华：夏季光照最强。水柱全年混合时，浮游植物主要受光照限制，光最强的夏季长得最快；到“时间–深度”页可以看混合层深度和营养盐是否被耗尽。</>
      : <>峰值在夏季而不是典型的春华，可能有两种原因：水柱层化时，跃层附近同时有光和营养盐，浮游植物在次表层就地生长并积累；水柱全年混合时，浮游植物主要受光照限制，光最强的夏季长得最快。到“时间–深度”页看混合层深度和有没有次表层最大值，就能分辨是哪一种。</>);
    else why.push(<>峰值出现在 {peakMonth} 月：浮游植物的生长同时受光照和营养盐限制，峰值落在两者都较充足的时段。</>);
  } else if (CAT[cat].season) why.push(<>{CAT[cat].season}</>);
  if (/^F[12]_c$/.test(v) && northSea) why.push(<>北海站点可与国际底拖网调查（IBTS）的单位捕捞努力量渔获（CPUE）季节变化对照：在北海中部一维模拟中，浮游食性的鱼 1 在夏季随浮游动物增长而上升，且生物量高于鱼 2。<span className="soft">（Vijayakumaran 等 2026）</span></>);
  return <Reading what={<><b>{label}</b>（{modeTxt[mode] ?? mode}）：{CAT[cat].what}</>} facts={facts} why={why}
    how={kind === "annual" ? "横轴是一年中的日期，粗线是分析时段各年同一天的平均，阴影是各年的最小–最大范围；每种颜色代表一次运行。" : "横轴是完整的模拟时间，包括预热年份；可以看出模型是否逐年稳定下来。"} />;
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
    if ((hi - lo) / Math.max(Math.abs(m), 1e-12) < 0.1) shape = "上下几乎一致（充分混合）";
    else if (kmax !== si && kmax !== bi && d[kmax] > 3 && hi > 1.2 * x[si] && hi > 1.2 * x[bi]) shape = `中间高，最大值在约 ${d[kmax].toFixed(0)} m（次表层最大值）`;
    else if (x[si] > x[bi]) shape = `表层高（${fmt(x[si])}）、底层低（${fmt(x[bi])}）`;
    else shape = `底层高（${fmt(x[bi])}）、表层低（${fmt(x[si])}）`;
    facts.push(<><b>{pr.month} 月</b>：{shape}。</>);
  }
  const why: ReactNode[] = [];
  if (cat === "temp") why.push(<>冬季剖面垂向均匀（混合），夏季呈上暖下冷结构，中间温度急剧变化的层段即为温跃层。</>);
  if (NUTRIENT.has(cat)) why.push(<>夏季表层营养盐被浮游植物消耗，底层因有机物矿化而积累，剖面呈上低下高；冬季混合后恢复垂向均匀。</>);
  if (PHYTO.has(cat)) why.push(<>浮游植物生长同时受光照（上层强）和营养盐（下层高）控制，夏季常在两者兼备的跃层附近形成次表层最大值。</>);
  if (cat === "oxygen") why.push(<>层化季节底层与大气隔绝且持续分解耗氧，剖面呈上高下低。</>);
  return <Reading what={<><b>{label}</b>：{CAT[cat].what}</>} facts={facts} why={why}
    how={`纵轴是深度（向下越深），横轴是浓度（${u}）；每种线型代表一个月份（分析时段的月平均），颜色区分不同运行。对比冬夏两季剖面可以直观看到层化的影响。`} />;
}

// ------------------------------------------------------------------ column animation (state at one instant)
export function ColumnReading({ date, depth, temps, mld, phyto, nut, nutMax, hasFish }: { date: string; depth: number[]; temps: number[]; mld?: number | null; phyto: number[]; nut: number[]; nutMax: number; hasFish: boolean }) {
  // `phyto` is the diatom column (P1_c / ECO_dia / ergom_pp) and `nutMax` the maximum over all depths and the whole analysis window
  const si = depth.indexOf(Math.min(...depth)), bi = depth.indexOf(Math.max(...depth)), H = depth[bi];
  const dT = temps[si] - temps[bi];
  const facts: ReactNode[] = [];
  const state = dT > 2 ? "强层化" : dT > 0.5 ? "开始分层" : "充分混合";
  facts.push(<>此刻（{date}）表底温差 <b>{dT.toFixed(1)} °C</b>{finite(mld) ? `，混合层 ${mld.toFixed(0)} m（占水深 ${Math.round((Math.min(mld, H) / H) * 100)}%）` : ""}：水柱<b>{state}</b>。</>);
  if (phyto.length) {
    const k = phyto.indexOf(Math.max(...phyto.filter(finite)));
    if (k >= 0) facts.push(<>硅藻最多的位置在约 <b>{depth[k].toFixed(0)} m</b>{finite(mld) ? (depth[k] > mld + 2 ? "，在混合层以下（次表层）：表层营养盐已耗尽，藻类在跃层附近就地生长（上有光、下有营养盐）" : "，在混合层之内：混合层内分布较均匀") : ""}。</>);
  }
  if (nut.length && nutMax > 0) {
    const r = nut[si] / nutMax;
    facts.push(<>表层营养盐是分析时段全水柱最高值的 <b>{Math.round(r * 100)}%</b>：{r < 0.15 ? "接近耗尽，浮游植物生长受营养盐限制" : r < 0.5 ? "正在被消耗" : "充足"}。</>);
  }
  return <Reading facts={facts}
    why={[<>拖动时间条看一年的循环：冬季混合、营养盐充足但光照弱 → 春季层化建立、藻华爆发 → 夏季表层营养盐耗尽，层化的水柱里藻类在跃层附近就地生长 → 秋冬风暴混合，营养盐回到表层，为下一年做准备。全年混合的浅水站点没有层化这一步，主要看光照的季节变化。</>]}
    how={`左边的水柱按温度着色（暖色为暖水），虚线是混合层底；右边是同一时刻各变量的剖面，每个变量除以它在分析时段的最大值，便于放在一起比较。${hasFish ? "鱼形符号按浮游动物的垂向分布摆放，只是“鱼跟着食物走”的示意，模型中的鱼没有垂向位置。" : ""}`} />;
}

// ------------------------------------------------------------------ MIZER size spectrum
export function SpectrumReading({ ds, wMinF }: { ds: any[]; wMinF?: number }) {
  // fishing threshold: the run's MIZER parameter w_minF when the caller passes it, else the builder default
  const given = finite(wMinF) ? wMinF : finite(ds[0]?.w_minF) ? (ds[0].w_minF as number) : null;
  const wfGiven = given !== null;
  const wf: number = given ?? 80;
  const wfTxt = wfGiven ? `${fmt(wf)} g` : "默认 80 g";
  const stats = ds.map((d) => {
    const xs: number[] = [], ys: number[] = [];
    d.w.forEach((w: number, i: number) => { const y = d.density[i]; if (w >= 1 && w <= 1000 && finite(y) && y > 0) { xs.push(Math.log10(w)); ys.push(Math.log10(y)); } });
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
    let big = 0, all = 0;
    d.w.forEach((w: number, i: number) => { const dw = i ? w - d.w[i - 1] : 0; const b = (d.density[i] ?? 0) * dw; if (finite(b)) { all += b; if (w >= wf) big += b; } });
    return { l: d.label, slope: sxx ? sxy / sxx : NaN, big, all };
  });
  const a = stats[0];
  const facts: ReactNode[] = [];
  if (finite(a.slope)) facts.push(<>{a.l}：1–1000 g 范围内谱斜率约 <b>{a.slope.toFixed(2)}</b>（{a.slope < -1.3 ? "比 −1 陡：大鱼相对较少" : a.slope > -0.7 ? "比 −1 平缓：大鱼相对较多" : "接近 −1"}）；≥ {wfTxt} 的可捕鱼约占总生物量的 {Math.round((a.big / Math.max(a.all, 1e-12)) * 100)}%。</>);
  if (finite(a.all) && a.all > 0 && a.big / a.all < 0.05) facts.push(<>可捕的大鱼（≥ {wfTxt}）几乎没有：MIZER 从很小的鱼苗开始，大鱼要经过多年生长才会出现。预热只有一两年时，谱的大端偏低主要反映“还没长大”，而不是生态结论；研究用途请增加预热年数。</>);
  stats.slice(1).forEach((b) => facts.push(<>{b.l}：斜率 {b.slope.toFixed(2)}，可捕鱼生物量 {sp(pct(a.big, b.big))}，总生物量 {sp(pct(a.all, b.all))}。</>));
  return <Reading what="群落粒径谱：将鱼类群落按个体体重分档，统计各体重区间的生物量密度。MIZER 不区分物种，而是按个体大小刻画捕食与生长过程。"
    facts={facts}
    why={[<>双对数坐标下斜率约为 −1 时，各对数体重区间的总生物量大致相等（经典 Sheldon 谱）。能量沿粒径谱向上传递时存在代谢和同化损耗，因此大个体数量远少于小个体；渔业捕捞进一步移除大个体，使大粒径端斜率变陡。</>,
      <>双向耦合下鱼类摄食会压低饵料生物量，粒径谱整体下移；单向耦合下饵料不受鱼类捕食影响，粒径谱往往偏高。<span className="soft">（Powley 等 2026）</span></>]}
    how={`横轴是个体湿重（对数坐标），纵轴是单位体重区间的生物量密度（对数坐标）；红色虚线是捕捞下限（${wfTxt}），右侧的鱼才会被捕捞。`} />;
}

// ------------------------------------------------------------------ food web state
export function WebReading() {
  return <Reading what="食物网结构：每个节点代表一个生物或物质碳库，箭头表示摄食或物质转移方向（从被摄食者指向捕食者）。"
    facts={[<>节点内的水平条表示该类群在分析时段的年均生物量（同一营养级内归一化比较）：条越长，该类群在当前营养级中的占比越高。</>, <>悬停或点击节点可高亮其上下游连接，追踪特定能量通路（如 硅藻 → 中型浮游动物 → 鱼类）。</>]}
    why={[<>同一营养级内优势类群的变化会改变能量传递效率：以硅藻和中型浮游动物为主的经典食物链向高营养级传递效率较高；而以超微型/微型浮游植物、异养鞭毛虫和细菌为主的微食物环内部周转层级多，呼吸损耗更大。</>]}
    how="自下而上按营养级排列：无机营养盐与碎屑 → 浮游植物 → 浮游动物 → 鱼类与底栖动物。切换运行可对比不同配置下各类群的相对生物量。" />;
}

// ------------------------------------------------------------------ indicator comparison
const E2E_NAME: Record<string, string> = { macrobenthos: "大型底栖", fish1: "鱼 1", fish2: "鱼 2" };
function htlText(spec: any) {
  const h = spec?.htl;
  if (!h || h.kind === "none") return "仅低营养级";
  if (h.kind === "mizer") return h.mizer?.feedback === false ? "MIZER 鱼类（单向，无反馈）" : "MIZER 鱼类（双向反馈）";
  const g = Object.entries(E2E_NAME).filter(([k]) => h.e2e?.[k]).map(([, n]) => n);
  return g.length ? `E2E：${g.join("、")}` : "E2E（未启用功能群）";
}
export function CompareReading({ t, runs }: { t: any; runs: any[] }) {
  if (runs.length < 2) {
    return <div className="reading reading-cols"><h4>怎么读</h4><p>当前展示所选运行在分析时段的年均指标。在左侧再勾选一次运行（第一个勾选的运行作为基准），即可查看相对变化与机制分析。</p></div>;
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
  facts.push(<>以 <b>{A.label}</b>（{htlText(A.spec)}）为基准，对比 <b>{B.label}</b>（{htlText(B.spec)}）。</>);
  if (big.length) facts.push(<>变化最显著的指标：{big.slice(0, 5).map((r: any, i: number) => <span key={r.key}>{i ? "，" : ""}{r.label.trim()} <b>{sp(r.pct[last])}</b></span>)}。</>);
  if (small.length) facts.push(<>变化较小（&lt; 3%）：{small.slice(0, 6).map((r: any) => r.label.trim()).join("、")}。</>);
  const co2 = rows.find((r: any) => r.key === "co2");
  if (co2 && finite(co2.values[0]) && finite(co2.values[last]) && co2.values[0] !== co2.values[last]) {
    const c0 = co2.values[0], c1 = co2.values[last];
    const nearZero = c0 * c1 < 0 || Math.min(Math.abs(c0), Math.abs(c1)) < 0.15 * Math.max(Math.abs(c0), Math.abs(c1));
    facts.push(<>海气 CO₂ 通量从 {fmt(c0)} 变为 {fmt(c1)} {co2.units}（正值表示海洋吸收），差值 {fmt(c1 - c0)}{nearZero ? (c0 * c1 < 0 ? "；两次运行符号相反，建议直接参考绝对差值" : "；其中一个运行接近 0，相对百分比会被放大，建议参考绝对差值") : ""}。</>);
  }
  if (newIn.length) facts.push(<>基准运行中未包含、比较运行中新增的类群：{newIn.join("、")}。</>);
  const cas = cascadeText(chg);
  const why: ReactNode[] = [];
  const intro = pairKey === "ltl>e2e" ? `基准运行仅包含低营养级；比较运行加入了 ${htlText(B.spec).replace("E2E：", "")}，其摄食、排泄和呼吸均反馈至宿主模型。` : kA === "e2e" && kB === "e2e" ? `两次运行的高营养级配置不同：基准为 ${htlText(A.spec)}，比较运行为 ${htlText(B.spec)}，差异来自所增减的功能群。` : PAIR_INTRO[pairKey];
  if (intro) why.push(intro);
  if (cas) why.push(cas);
  for (const r of big.slice(0, 4)) {
    if (cas && /Z5|Z6|microzoo/.test(r.key)) continue; // already covered by the cascade sentence
    const m = mechanism(r.key, pairKey, r.pct[last], { chg }); if (m && !why.includes(m)) why.push(m);
  }
  if (A.spec?.host && B.spec?.host && A.spec.host !== B.spec.host) why.unshift(`注意：两次运行使用了不同的宿主模型（${A.spec.host} vs ${B.spec.host}），结果差异同时包含宿主模型本身的结构差别，不能完全归因于高营养级。`);
  return (
    <div className="reading reading-cols">
      <h4>这组对比说明了什么</h4>
      <ul>{facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
      {collapse.length > 0 && <p className="reading-warn">{collapse.map((r: any) => r.label.trim()).join("、")} 降幅超过 90%，接近耗竭。真实海域极少出现此类情况，通常表明高营养级捕食参数在当前宿主下偏强，或该类群缺少半饱和/低密度保护机制。建议通过“参数扫描”检查捕食率参数，或与文献结果核对。</p>}
      {why.length > 0 && <><h4>为什么</h4>{why.map((x, i) => <p key={i}>{x}</p>)}</>}
      <h4>怎么读</h4>
      <p>表中所有指标均为分析时段的年均值；浮游生物与鱼类为整根水柱的深度积分。百分比变化 = (比较 − 基准) / 基准。左侧第一个勾选的运行作为基准（例如先勾选“仅低营养级”，再勾选耦合鱼类的运行，即可评估高营养级反馈）。</p>
      {runs.length > 2 && <p className="soft">当前勾选了 {runs.length} 次运行，以上文字对比第一个与最后一个运行；柱状图与表格展示全部所选运行。</p>}
    </div>
  );
}
export { infoKey, METRIC_INFO };
