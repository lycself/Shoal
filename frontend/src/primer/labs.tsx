import type React from "react";
import { createContext, useContext, useMemo, useRef, useState } from "react";
import { askTutor } from "../tutor";
import { Plot } from "../components/Plot";
import { Seg, cssVar, fmt } from "../components/ui";
import { BOLTZMANN, BOX_DEFAULTS, BoxParams, lastYearMax, lastYearMean, preference, runBox, windowPreference } from "./models";

function Slider({ label, value, min, max, step, onChange, unit, log }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string; log?: boolean }) {
  const toS = (v: number) => (log ? Math.log10(v) : v);
  const fromS = (s: number) => (log ? Math.pow(10, s) : s);
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={toS(min)} max={toS(max)} step={log ? 0.01 : step ?? (max - min) / 100} value={toS(value)} onChange={(e) => onChange(fromS(+e.target.value))} />
      <span className="v">{fmt(value, 3)}{unit ? ` ${unit}` : ""}</span>
    </label>
  );
}

const LabReset = createContext<() => void>(() => {});

/** Hosts a lab; "重置" remounts it with its initial parameters. */
export function LabHost({ name }: { name: string }) {
  const [epoch, setEpoch] = useState(0);
  const L = LABS[name];
  if (!L) return <div className="notice warn">未知实验：{name}</div>;
  return <LabReset.Provider value={() => setEpoch((e) => e + 1)}><L key={epoch} /></LabReset.Provider>;
}

function LabShell({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  const kids = Array.isArray(children) ? children : [children];
  const controls = kids.filter((c: any) => c?.type === Slider);
  const rest = kids.filter((c: any) => c?.type !== Slider);
  const body = useRef<HTMLDivElement>(null);
  const reset = useContext(LabReset);
  const ask = () => {
    const el = body.current;
    const params = el ? Array.from(el.querySelectorAll(".slider")).map((s) => s.textContent?.replace(/\s+/g, " ").trim()).join("；") : "";
    const out = el ? Array.from(el.querySelectorAll(".lab-readout")).map((s) => s.textContent?.replace(/\s+/g, " ").trim()).join("；") : "";
    askTutor(`在入门教程的实验“${title}”中，我的设置是：${params || "默认值"}。实验显示：${out || "（见图）"}。请解释这些结果背后的物理与生态机制，以及我应该注意什么。`);
  };
  return (
    <section className="lab">
      <header className="lab-head">
        <i className="codicon codicon-beaker" />
        <b className="grow">{title}</b>
        <button className="btn sm" onClick={reset}><i className="codicon codicon-discard" />重置</button>
        <button className="btn sm" onClick={ask}><i className="codicon codicon-sparkle" />问讲解员</button>
      </header>
      <div className="lab-body" ref={body}>
        {controls.length > 0 && <div className="lab-controls">{controls}</div>}
        {rest}
        {note && <div className="lab-note">{note}</div>}
      </div>
    </section>
  );
}

const MONTH_TICKS = { tickvals: [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], ticktext: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"] };

// 1 ---------------------------------------------------------------- stratification
function Stratification() {
  const [wind, setWind] = useState(8);
  const [q, setQ] = useState(180);
  const [loss, setLoss] = useState(0.1);
  const d = useMemo(() => {
    const days = Array.from({ length: 365 }, (_, i) => i);
    const rho = 1025, cp = 3990, alpha = 2e-4, g = 9.81, cd = 1.3e-3, rhoa = 1.2;
    const ustar = Math.sqrt((rhoa * cd * wind * wind) / rho);
    const mld: number[] = [], crit: number[] = [];
    let h = 80;
    for (const t of days) {
      const Q = q * Math.sin((2 * Math.PI * (t - 80)) / 365) - 20; // net surface heat flux W m-2
      const B0 = (g * alpha * Q) / (rho * cp);
      if (B0 > 0) {
        const L = (2 * 1.25 * ustar ** 3) / B0; // Monin–Obukhov-type equilibrium depth
        h = h + (Math.min(L, 80) - h) * 0.2;
      } else {
        h = Math.min(80, h + 2.5 + (-B0) * 4e6); // convective deepening in autumn/winter
      }
      h = Math.max(5, Math.min(80, h));
      mld.push(h);
      const I0 = 140 * (0.55 - 0.45 * Math.cos((2 * Math.PI * (t - 10)) / 365));
      const kd = 0.1, Ic = 10; // compensation light W m-2
      // Sverdrup critical depth: Zc/(1-exp(-k Zc)) = I0/(k Ic) * mu/(mu+loss) ~ simplified
      const ratio = (I0 / (kd * Ic)) * (1 / (1 + loss * 10));
      crit.push(Math.min(150, ratio));
    }
    return { days, mld, crit };
  }, [wind, q, loss]);
  const bloom = d.days.find((t) => t > 30 && d.mld[t] < d.crit[t]);
  return (
    <LabShell title="混合层与临界深度：春季水华何时开始？" note="简化模型：海面受热时，风搅出的湍流要把轻的暖水往下压，浮力又把它往上托，两者打平的深度就是混合层底（这个深度叫 Monin–Obukhov 长度，风越大越深、加热越强越浅）；海面冷却时，表层水变重下沉，对流把混合层加深。临界深度按 Sverdrup 的思路随光照变化：混合层加深到这个深度时，整层浮游植物的光合作用刚好抵消呼吸和被吃掉的损失。混合层浅于临界深度时浮游植物净生长，水华开始。">
      <Slider label="10 m 风速" value={wind} min={2} max={16} onChange={setWind} unit="m/s" />
      <Slider label="热通量季节振幅" value={q} min={50} max={300} onChange={setQ} unit="W/m²" />
      <Slider label="浮游植物损失（呼吸+摄食）" value={loss} min={0.02} max={0.5} onChange={setLoss} unit="d⁻¹" />
      <Plot height={280} data={[
        { x: d.days, y: d.mld, name: "混合层深度", type: "scatter", line: { color: cssVar("--accent"), width: 2.5 } },
        { x: d.days, y: d.crit, name: "临界深度", type: "scatter", line: { color: cssVar("--eco-phyto"), dash: "dash" } },
      ]} layout={{ yaxis: { autorange: "reversed", title: "深度 m", range: [150, 0] }, xaxis: MONTH_TICKS, shapes: bloom ? [{ type: "line", x0: bloom, x1: bloom, yref: "paper", y0: 0, y1: 1, line: { color: cssVar("--eco-zoo"), dash: "dot" } }] : [] }} />
      <div className="lab-readout">{bloom !== undefined ? <>预测水华开始：约第 <b>{bloom}</b> 天（{Math.floor(bloom / 30.4) + 1} 月）</> : "混合层始终深于临界深度：本年无水华"}</div>
    </LabShell>
  );
}

// 2 ---------------------------------------------------------------- NPZD box
function NpzdBox({ compareOnly }: { compareOnly?: boolean }) {
  const [p, setP] = useState<BoxParams>({ ...BOX_DEFAULTS });
  const set = (k: keyof BoxParams, v: any) => setP({ ...p, [k]: v });
  const res = useMemo(() => runBox(p), [p]);
  const ref = useMemo(() => runBox({ ...p, fish: "none" }), [p]);
  const y = p.years;
  const zoo = lastYearMean(res.t, res.Z, y), zooRef = lastYearMean(ref.t, ref.Z, y);
  return (
    <LabShell title="NPZD 盒子模型 + 鱼类：单向与双向耦合" note="营养盐 N、浮游植物 P、浮游动物 Z、碎屑 D 以 mmol N m⁻³ 计；鱼类以 mg C m⁻² 计，按官方 ECOSMO E2E 代码的写法以浮游动物为食（食物取整个盒子的总量，半饱和常数 0.7 mmol N m⁻²，排泄随温度变化 θ = 0.5 eV），粪便、尸体和排泄全部返回（相当于修正版）。单向耦合：鱼类照常生长，但不从浮游动物中扣除被吃掉的量，也不返还排泄物；鱼吃多少都不会让食物变少，所以会无限制地指数增长（右轴改为对数）。">
      <div className="row" style={{ marginBottom: 10 }}>
        <Seg value={p.fish} options={[["none", "无鱼类"], ["one_way", "单向耦合"], ["two_way", "双向耦合"]]} onChange={(v) => set("fish", v)} />
      </div>
      {!compareOnly && <>
        <Slider label="鱼类初始生物量" value={p.fish0} min={50} max={5000} onChange={(v) => set("fish0", v)} unit="mg C m⁻²" log />
        <Slider label="鱼类摄食率 σ" value={p.sigma} min={0.005} max={0.1} onChange={(v) => set("sigma", v)} unit="d⁻¹" />
        <Slider label="鱼类死亡率 m" value={p.m} min={0.0002} max={0.01} onChange={(v) => set("m", v)} unit="d⁻¹" log />
        <Slider label="浮游动物死亡率（闭合项）" value={p.zmort} min={0.01} max={0.15} onChange={(v) => set("zmort", v)} unit="d⁻¹" />
        <Slider label="初始营养盐" value={p.nut0} min={2} max={16} onChange={(v) => set("nut0", v)} unit="mmol m⁻³" />
      </>}
      <Plot height={300} data={[
        { x: res.t, y: res.P, name: "浮游植物 P", line: { color: cssVar("--eco-phyto") } },
        { x: res.t, y: res.Z, name: "浮游动物 Z", line: { color: cssVar("--eco-zoo"), width: 2.5 } },
        { x: ref.t, y: ref.Z, name: "Z（无鱼类参照）", line: { color: cssVar("--eco-zoo"), dash: "dot", width: 1 } },
        { x: res.t, y: res.N, name: "营养盐 N", line: { color: cssVar("--eco-nut"), width: 1 } },
        ...(p.fish !== "none" ? [{ x: res.t, y: res.F, name: "鱼类 F（右轴）", yaxis: "y2", line: { color: cssVar("--eco-fish") } }] : []),
      ].map((s) => ({ ...s, type: "scatter", mode: "lines" }))} layout={{ xaxis: { title: "天" }, yaxis: { title: "mmol N m⁻³" }, yaxis2: { overlaying: "y", side: "right", title: "mg C m⁻²", showgrid: false, type: p.fish === "one_way" ? "log" : "linear" } }} />
      <div className="lab-readout">
        <span>最后一年平均浮游动物：<b>{fmt(zoo)}</b>（无鱼 {fmt(zooRef)}，{zooRef ? `${fmt(((zoo - zooRef) / zooRef) * 100, 2)}%` : ""}）</span>
        <span>夏季峰值：<b>{fmt(lastYearMax(res.t, res.Z, y))}</b></span>
        {p.fish !== "none" && <span>鱼类：<b>{fmt(res.F[res.F.length - 1])}</b> mg C m⁻²</span>}
      </div>
    </LabShell>
  );
}

// 3 ---------------------------------------------------------------- functional response
function FunctionalResponse() {
  const [sigma, setSigma] = useState(0.1);
  const [r, setR] = useState(0.1);
  const [a1, setA1] = useState(0.2);
  const [a2, setA2] = useState(0.15);
  const [c2, setC2] = useState(20);
  const xs = Array.from({ length: 101 }, (_, i) => i * 2);
  const rMg = r * 6.625 * 12.01;
  const g1 = xs.map((c) => (sigma * a1 * c) / (rMg + a1 * c + a2 * c2));
  const g2 = xs.map((c) => (sigma * a2 * c2) / (rMg + a1 * c + a2 * c2));
  return (
    <LabShell title="Michaelis–Menten 摄食与饵料偏好（E2E 式 1–3）" note="大型底栖动物的写法：G_X = σ a_X C_X / (r + Σ a C)，C 为最底层的浓度，r 以 mmol N m⁻³ 计、乘 79.6 换成碳。饵料 1 增多时，摄食者把更多“注意力”转向它，饵料 2 被摄食的量下降（开关效应）；总摄食在食物充足时趋于 σ。">
      <Slider label="最大摄食率 σ" value={sigma} min={0.01} max={0.3} onChange={setSigma} unit="d⁻¹" />
      <Slider label="半饱和常数 r" value={r} min={0.01} max={2} onChange={setR} unit="mmol N m⁻³" log />
      <Slider label="对饵料 1 的偏好 a₁" value={a1} min={0} max={1} onChange={setA1} />
      <Slider label="对饵料 2 的偏好 a₂" value={a2} min={0} max={1} onChange={setA2} />
      <Slider label="饵料 2 浓度" value={c2} min={0} max={200} onChange={setC2} unit="mg C m⁻³" />
      <Plot height={280} data={[
        { x: xs, y: g1, name: "摄食饵料 1", type: "scatter", line: { color: cssVar("--eco-phyto") } },
        { x: xs, y: g2, name: "摄食饵料 2", type: "scatter", line: { color: cssVar("--eco-zoo") } },
        { x: xs, y: g1.map((v, i) => v + g2[i]), name: "总摄食", type: "scatter", line: { color: cssVar("--accent"), width: 2.5 } },
      ]} layout={{ xaxis: { title: "饵料 1 浓度 (mg C m⁻³)" }, yaxis: { title: "比摄食率 (d⁻¹)" } }} />
    </LabShell>
  );
}

// 4 ---------------------------------------------------------------- size preference
const ERSEM_WINDOWS: [string, number, number, string][] = [
  ["超微型浮游植物 P3", 4.188e-15, 4.188e-12, cssVar("--eco-phyto")], ["微型浮游植物 P2 / 异养鞭毛虫 Z6", 4.188e-12, 4.188e-9, "#5fae6e"],
  ["硅藻 P1 / 小型浮游植物 P4 / 微型浮游动物 Z5", 4.188e-9, 4.188e-6, "#8bc28e"], ["中型浮游动物 Z4", 4.188e-6, 1e-3, cssVar("--eco-zoo")],
]; // design:allow-colour plot bands
function SizePreference() {
  const [beta, setBeta] = useState(100);
  const [sigma, setSigma] = useState(2.3025);
  const preds = [1e-3, 1e-1, 10, 1000];
  const lw = Array.from({ length: 200 }, (_, i) => -16 + (i / 199) * 20);
  return (
    <LabShell title="捕食者–饵料质量比与对数正态偏好（MIZER 式 S10–S12）" note="φ = exp[−ln²(βw_prey/w_pred)/(2σ²)]。β=100 表示最喜欢比自己轻 100 倍的饵料；σ=2.3025（ln 单位）相当于 log10 单位下宽度为 1。表格为各 ERSEM 饵料窗口的平均偏好。">
      <Slider label="最佳质量比 β" value={beta} min={10} max={10000} onChange={setBeta} log />
      <Slider label="偏好宽度 σ" value={sigma} min={0.5} max={4} onChange={setSigma} />
      <Plot height={280} data={preds.map((w, k) => ({ x: lw.map((x) => Math.pow(10, x)), y: lw.map((x) => preference(w, Math.pow(10, x), beta, sigma)), name: `捕食者 ${w} g`, type: "scatter", line: { width: 2 } }))}
        layout={{ xaxis: { type: "log", title: "饵料湿重 (g)" }, yaxis: { title: "偏好 φ", range: [0, 1.05] }, shapes: ERSEM_WINDOWS.map(([, a, b, c]) => ({ type: "rect", x0: a, x1: b, yref: "paper", y0: 0, y1: 1, fillcolor: c, opacity: 0.12, line: { width: 0 } })) }} />
      <table className="table" style={{ marginTop: 8 }}>
        <thead><tr><th>饵料窗口</th>{preds.map((w) => <th key={w} className="num">{w} g 的鱼</th>)}</tr></thead>
        <tbody>{ERSEM_WINDOWS.map(([n, a, b]) => <tr key={n}><td>{n}</td>{preds.map((w) => <td key={w} className="num">{fmt(windowPreference(w, a, b, beta, sigma), 2)}</td>)}</tr>)}</tbody>
      </table>
    </LabShell>
  );
}

// 5 ---------------------------------------------------------------- spectrum slope
function SpectrumSlope() {
  const [te, setTe] = useState(0.1);
  const [beta, setBeta] = useState(100);
  const lam = 2 - Math.log(te) / Math.log(beta); // abundance-density exponent N(w) ~ w^-lambda
  const ws = Array.from({ length: 60 }, (_, i) => Math.pow(10, -12 + i * 0.3));
  return (
    <LabShell title="粒径谱斜率与营养级传递效率" note={`若每升高一个营养级（体重增加 β 倍）只传递比例 ε 的能量，则丰度密度 N(w) ∝ w^-λ，λ = 2 − ln ε / ln β。当前 λ = ${lam.toFixed(2)}；每个对数粒径区间的生物量 ∝ w^(2−λ)。Sheldon 观测到海洋中生物量在对数区间内大致相等（λ≈2）。`}>
      <Slider label="传递效率 ε" value={te} min={0.02} max={0.3} onChange={setTe} />
      <Slider label="捕食者/饵料质量比 β" value={beta} min={10} max={10000} onChange={setBeta} log />
      <Plot height={260} data={[
        { x: ws, y: ws.map((w) => Math.pow(w, 2 - lam) / Math.pow(1e-12, 2 - lam)), name: "每对数区间生物量（相对值）", type: "scatter", line: { color: cssVar("--accent"), width: 2.5 } },
      ]} layout={{ xaxis: { type: "log", title: "个体湿重 w (g)" }, yaxis: { type: "log", title: "相对生物量" } }} />
    </LabShell>
  );
}

// 6 ---------------------------------------------------------------- arrhenius
function Arrhenius() {
  const [ea, setEa] = useState(0.63);
  const [theta, setTheta] = useState(0.5);
  const Ts = Array.from({ length: 31 }, (_, i) => i);
  const mizer = Ts.map((T) => Math.exp((ea / BOLTZMANN) * (1 / 286.15 - 1 / (T + 273.15))));
  const e2e = Ts.map((T) => Math.exp((theta / BOLTZMANN) * ((T + 273.15 - 273.15) / ((T + 273.15) * 273.15))));
  return (
    <LabShell title="温度依赖：Arrhenius 因子" note="MIZER（式 S21）以 13 °C 为参考温度，因子在 13 °C 时为 1；E2E 排泄（式 4、11）以 0 °C 为参考，θ 越大升温越快。Vijayakumaran 等 (2026) 未给出 θ；官方算例里鱼取 θ = 0.5 eV（10 °C 时约为 0 °C 的 2.1 倍），大型底栖取 0（不随温度变）。">
      <Slider label="MIZER 活化能 E_a" value={ea} min={0} max={1.2} onChange={setEa} unit="eV" />
      <Slider label="E2E 排泄参数 θ" value={theta} min={0} max={1.2} onChange={setTheta} unit="eV" />
      <Plot height={260} data={[
        { x: Ts, y: mizer, name: "MIZER 速率因子（参考 13 °C）", type: "scatter", line: { color: cssVar("--eco-fish"), width: 2.5 } },
        { x: Ts, y: e2e, name: "E2E 排泄因子（参考 0 °C）", type: "scatter", line: { color: cssVar("--eco-zoo"), width: 2.5 } },
      ]} layout={{ xaxis: { title: "温度 (°C)" }, yaxis: { title: "相对速率" } }} />
    </LabShell>
  );
}

// 7 ---------------------------------------------------------------- fish vertical
function FishVertical() {
  const [zmax, setZmax] = useState(25);
  const [width, setWidth] = useState(8);
  const [mld, setMld] = useState(20);
  const H = 73;
  const z = Array.from({ length: 74 }, (_, i) => i);
  const prey = z.map((d) => 0.15 + Math.exp(-((d - zmax) ** 2) / (2 * width * width)));
  const tot = prey.reduce((a, b) => a + b, 0);
  const f = prey.map((v) => v / tot); // per metre (dz = 1 m)
  const T = z.map((d) => (d < mld ? 16 : 16 - 8 * (1 - Math.exp(-(d - mld) / 6))));
  const Teff = f.reduce((s, v, i) => s + v * T[i], 0);
  const Tmean = T.reduce((a, b) => a + b, 0) / T.length;
  const interaction = 1 / f.reduce((s, v) => s + v * v, 0);
  return (
    <LabShell title="鱼类随饵料垂向分布（MIZER 式 S3–S5、S14）" note="f(z) = P(z)/∫P dz。鱼类“感受”到的温度是按 f(z) 加权的平均值；相互作用深度 1/∫f² dz 越小，鱼与鱼之间相遇越频繁（同类捕食更强）。">
      <Slider label="饵料极大值深度" value={zmax} min={2} max={70} onChange={setZmax} unit="m" />
      <Slider label="饵料层厚度" value={width} min={2} max={40} onChange={setWidth} unit="m" />
      <Slider label="混合层深度" value={mld} min={5} max={73} onChange={setMld} unit="m" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Plot height={280} data={[
          { x: f.map((v) => v * H), y: z, name: "鱼类分布 f(z)·H", type: "scatter", line: { color: cssVar("--eco-fish"), width: 2.5 } },
          { x: T.map((v) => v / 16), y: z, name: "温度 / 16 °C", type: "scatter", line: { color: cssVar("--eco-phys"), dash: "dot" } },
        ]} layout={{ yaxis: { autorange: "reversed", title: "深度 m" }, xaxis: { title: "相对值" } }} />
        <div className="col lab-readout" style={{ justifyContent: "center", gap: 10 }}>
          <div>鱼类感受温度：<b>{Teff.toFixed(2)} °C</b>（水柱平均 {Tmean.toFixed(2)} °C）</div>
          <div>相互作用深度：<b>{interaction.toFixed(1)} m</b>（水深 {H} m）</div>
          <div className="lab-note">饵料集中在温跃层下的冷水时，鱼类代谢变慢；饵料越集中，同类之间的捕食越强。</div>
        </div>
      </div>
    </LabShell>
  );
}

// 8 ---------------------------------------------------------------- coupling compare
function CouplingCompare() {
  const [fish0, setFish0] = useState(1000);
  const runs = useMemo(() => (["none", "one_way", "two_way"] as const).map((m) => {
    const r = runBox({ ...BOX_DEFAULTS, fish: m, fish0 });
    const y = BOX_DEFAULTS.years;
    return { m, zoo: lastYearMean(r.t, r.Z, y), phy: lastYearMean(r.t, r.P, y), fish: r.F[r.F.length - 1], det: lastYearMean(r.t, r.D, y) };
  }), [fish0]);
  const lab = { none: "无鱼类", one_way: "单向", two_way: "双向" };
  return (
    <LabShell title="单向 vs 双向：同样的鱼，不同的世界" note="单向耦合中鱼类以“没有被吃过”的浮游动物为食，往往高估鱼类；双向耦合中被吃掉的浮游动物真实地减少，并通过排泄与碎屑把营养盐还给生态系统。">
      <Slider label="鱼类初始生物量" value={fish0} min={100} max={5000} onChange={setFish0} unit="mg C m⁻²" log />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Plot height={260} data={[
          { type: "bar", x: runs.map((r) => lab[r.m]), y: runs.map((r) => r.zoo), name: "浮游动物", marker: { color: cssVar("--eco-zoo") } },
          { type: "bar", x: runs.map((r) => lab[r.m]), y: runs.map((r) => r.phy), name: "浮游植物", marker: { color: cssVar("--eco-phyto") } },
          { type: "bar", x: runs.map((r) => lab[r.m]), y: runs.map((r) => r.det), name: "碎屑", marker: { color: cssVar("--eco-organic") } },
        ]} layout={{ barmode: "group", yaxis: { title: "年均 mmol N m⁻³" } }} />
        <Plot height={260} data={[{ type: "bar", x: runs.filter((r) => r.m !== "none").map((r) => lab[r.m]), y: runs.filter((r) => r.m !== "none").map((r) => r.fish), marker: { color: cssVar("--eco-fish") }, name: "鱼类" }]}
          layout={{ yaxis: { title: "末年鱼类 mg C m⁻²" } }} />
      </div>
    </LabShell>
  );
}

export const LABS: Record<string, () => React.ReactElement> = {
  stratification: Stratification,
  npzd_box: () => <NpzdBox />,
  functional_response: FunctionalResponse,
  size_preference: SizePreference,
  spectrum_slope: SpectrumSlope,
  arrhenius: Arrhenius,
  fish_vertical: FishVertical,
  coupling_compare: CouplingCompare,
};
