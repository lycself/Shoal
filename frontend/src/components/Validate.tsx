import { useApp } from "../store";
import { Plot, seriesColor } from "./Plot";
import { Empty, Icon, Loading, Notice, cssVar, fmt, useAsync } from "./ui";
import { api } from "../api";

const MONTHS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

export function ValidateTab({ pid, run }: { pid: string; run: any }) {
  const dark = useApp((s) => s.dark);
  const setPage = useApp((s) => s.setPage);
  const v = useAsync(() => api.get(`/projects/${pid}/runs/${run.id}/validation`), [pid, run.id]);
  const sp = useAsync(() => api.get(`/projects/${pid}/runs/${run.id}/spinup`), [pid, run.id]);
  const vd: any = v.data, sd: any = sp.data;
  return (
    <div className="split-scroll" style={{ padding: "14px 18px" }}>
      <div className="row" style={{ marginBottom: 12 }}><Icon name="verified" style={{ color: "var(--accent)" }} /><b style={{ color: "var(--fg-strong)" }}>{run.label}</b><span className="soft small">只检查左侧勾选的第一个运行</span></div>

      <div className="section">
        <div className="section-header"><Icon name="pulse" /><h3>稳态检查（预热是否足够）</h3></div>
        {sp.loading ? <Loading /> : sd && (
          <>
            <Notice kind={sd.max_drift_pct == null ? "plain" : sd.max_drift_pct < 1 ? "info" : sd.max_drift_pct < 5 ? "warn" : "danger"} icon={sd.max_drift_pct != null && sd.max_drift_pct < 1 ? "pass" : "warning"}>
              <b>{sd.verdict ?? "年份不足，无法判断"}</b>　最后两个完整年份之间，变化最大的变量变了 {fmt(sd.max_drift_pct)}%。反复使用同一年气象的模拟，应该在分析的那一年之前就稳定下来，否则结果还带着初始值的影子。
              {sd.max_drift_pct != null && sd.max_drift_pct >= 1 && <> <a className="link" onClick={() => setPage("site")}>去“站点与物理”增加预热年数 →</a>（研究用途建议 10–20 年；高营养级比低营养级慢得多）</>}
            </Notice>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16, marginTop: 10 }}>
              <Plot height={300} data={sd.vars.map((x: any, i: number) => {
                const last = x.values[x.values.length - 1];
                return { x: sd.years, y: x.values.map((y: number) => (last ? (y / last) * 100 : null)), type: "scatter", mode: "lines+markers", name: x.name, line: { color: seriesColor(i, dark), width: 1.8 }, marker: { size: 5 } };
              })} layout={{ yaxis: { title: { text: "年均值 / 末年 (%)" } }, xaxis: { title: { text: "模拟年份" }, dtick: 1 }, margin: { t: 10 },
                shapes: [{ type: "line", x0: sd.analysis_from - 0.5, x1: sd.analysis_from - 0.5, yref: "paper", y0: 0, y1: 1, line: { dash: "dot", color: cssVar("--fg-soft") } }],
                legend: { orientation: "v", x: 1.02, y: 1 } }} />
              <div className="panel" style={{ overflow: "auto", maxHeight: 300 }}>
                <table className="table">
                  <thead><tr><th>变量</th><th className="num">末两年变化</th></tr></thead>
                  <tbody>{sd.vars.map((x: any) => (
                    <tr key={x.name}><td><span className="mono">{x.name}</span><div className="sub">{x.long_name}</div></td>
                      <td className="num" style={{ color: x.drift_pct == null ? undefined : Math.abs(x.drift_pct) < 1 ? "var(--ok)" : Math.abs(x.drift_pct) < 5 ? "var(--warn)" : "var(--danger)", fontWeight: 600 }}>{x.drift_pct == null ? "–" : `${x.drift_pct > 0 ? "+" : ""}${x.drift_pct}%`}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="section">
        <div className="section-header"><Icon name="graph-scatter" /><h3>与 WOA23 气候态比较</h3></div>
        {v.loading ? <Loading /> : !vd?.available ? <Notice kind="plain">{vd?.reason ?? "无法验证"}</Notice> : (
          <>
            <Notice kind="warn">{vd.note}</Notice>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(380px,1fr) minmax(0,1.25fr)", gap: 16, marginTop: 12, alignItems: "start" }}>
              <Plot height={430} data={[
                { type: "scatterpolar", r: [1], theta: [0], mode: "markers+text", text: ["WOA"], textposition: "top right", marker: { size: 11, color: cssVar("--fg-strong"), symbol: "star" }, name: "参考（WOA23）" },
                ...vd.vars.map((x: any, i: number) => ({ type: "scatterpolar", r: [x.stats.sd_ratio], theta: [Math.acos(Math.max(-1, Math.min(1, x.stats.r ?? 0))) * 180 / Math.PI], mode: "markers", name: x.label, hovertemplate: `${x.label}<br>r = ${fmt(x.stats.r)}<br>σm/σo = ${fmt(x.stats.sd_ratio)}<extra></extra>`, marker: { size: 12, line: { width: 1, color: dark ? "#111" : "#fff" }, color: seriesColor(i, dark) } })),
              ]} layout={{ showlegend: true, legend: { orientation: "h", y: -0.12, x: 0, font: { size: 11 } }, margin: { l: 40, r: 30, t: 34, b: 10 },
                polar: { sector: [0, 90], bgcolor: "rgba(0,0,0,0)", radialaxis: { range: [0, Math.max(1.6, ...vd.vars.map((x: any) => (x.stats.sd_ratio ?? 0) * 1.1))], title: { text: "σ模式 / σ观测" }, gridcolor: cssVar("--plot-grid") },
                  angularaxis: { direction: "clockwise", rotation: 90, tickvals: [0, 25.8, 45.6, 63.3, 72.5, 84.3, 90], ticktext: ["1", "0.9", "0.7", "0.45", "0.3", "0.1", "0"], gridcolor: cssVar("--plot-grid") } },
                annotations: [{ text: "相关系数", x: 0.85, y: 0.95, xref: "paper", yref: "paper", showarrow: false, font: { size: 11, color: cssVar("--fg-muted") } }], title: { text: "Taylor 图（月 × 深度）" } }} />
              <div className="panel" style={{ overflow: "auto" }}>
                <table className="table dense">
                  <thead><tr><th>变量</th><th className="num">观测均值</th><th className="num">模式均值</th><th className="num">偏差</th><th className="num">RMSE</th><th className="num">r</th><th className="num">σm/σo</th></tr></thead>
                  <tbody>{vd.vars.map((x: any) => (
                    <tr key={x.key}><td style={{ whiteSpace: "nowrap" }}>{x.label}<div className="sub">{x.units} · <span className="mono">{x.model_var}</span></div></td>
                      <td className="num">{fmt(x.stats.obs_mean)}</td><td className="num">{fmt(x.stats.model_mean)}</td>
                      <td className="num" style={{ color: Math.abs(x.stats.bias) > 0.2 * Math.abs(x.stats.obs_mean) ? "var(--danger)" : undefined }}>{x.stats.bias > 0 ? "+" : ""}{fmt(x.stats.bias)}</td>
                      <td className="num">{fmt(x.stats.rmse)}</td><td className="num">{fmt(x.stats.r)}</td><td className="num">{fmt(x.stats.sd_ratio)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <ValidationReading vars={vd.vars} />
            <div className="section-header" style={{ marginTop: 16 }}><h3>表层与底层的季节变化：模式（线）vs WOA23（点）</h3></div>
            <SeasonGrid vars={vd.vars} dark={dark} />
          </>
        )}
      </div>
    </div>
  );
}

function SeasonGrid({ vars, dark }: { vars: any[]; dark: boolean }) {
  const n = vars.length, cols = 3, rows = Math.ceil(n / cols);
  const gx = 0.07, gy = 0.14, w = (1 - gx * (cols - 1)) / cols, h = (1 - gy * (rows - 1)) / rows;
  const traces: any[] = [];
  const layout: any = { margin: { l: 50, r: 10, t: 28, b: 30 }, annotations: [], legend: { orientation: "h", y: -0.06 } };
  vars.forEach((x, i) => {
    const r = Math.floor(i / cols), c = i % cols, k = i + 1;
    const xa = k === 1 ? "x" : `x${k}`, ya = k === 1 ? "y" : `y${k}`;
    layout[k === 1 ? "xaxis" : `xaxis${k}`] = { domain: [c * (w + gx), c * (w + gx) + w], anchor: ya, tickvals: MONTHS.map(Number), ticktext: MONTHS };
    layout[k === 1 ? "yaxis" : `yaxis${k}`] = { domain: [1 - r * (h + gy) - h, 1 - r * (h + gy)], anchor: xa };
    layout.annotations.push({ text: `<b>${x.label}</b> (${x.units})`, xref: "paper", yref: "paper", x: c * (w + gx), y: 1 - r * (h + gy) + 0.01, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 11.5 } });
    const m = MONTHS.map(Number);
    traces.push({ x: m, y: x.surface.model, type: "scatter", mode: "lines", line: { color: seriesColor(1, dark), width: 2 }, name: "表层 · 模式", legendgroup: "s", showlegend: i === 0, xaxis: xa, yaxis: ya });
    traces.push({ x: m, y: x.surface.obs, type: "scatter", mode: "markers", marker: { color: seriesColor(1, dark), size: 6, symbol: "circle-open", line: { width: 1.6 } }, name: "表层 · WOA", legendgroup: "so", showlegend: i === 0, xaxis: xa, yaxis: ya });
    traces.push({ x: m, y: x.bottom.model, type: "scatter", mode: "lines", line: { color: seriesColor(0, dark), width: 2 }, name: "底层 · 模式", legendgroup: "b", showlegend: i === 0, xaxis: xa, yaxis: ya });
    traces.push({ x: m, y: x.bottom.obs, type: "scatter", mode: "markers", marker: { color: seriesColor(0, dark), size: 6, symbol: "square-open", line: { width: 1.6 } }, name: "底层 · WOA", legendgroup: "bo", showlegend: i === 0, xaxis: xa, yaxis: ya });
  });
  if (!n) return <Empty icon="graph" title="无可比较的变量" />;
  return <Plot height={rows * 230 + 70} data={traces} layout={layout} />;
}

/** Which variables the model reproduces, which it does not, and the usual reasons — computed from the statistics. */
function ValidationReading({ vars }: { vars: any[] }) {
  const site = useApp((s) => (s.project as any)?.site_info ?? (s.project as any)?.site);
  const rel = (x: any) => Math.abs(x.stats.bias) / Math.max(Math.abs(x.stats.obs_mean), 1e-12);
  const good = vars.filter((x) => (x.stats.r ?? 0) >= 0.8 && rel(x) < 0.1 && Math.abs((x.stats.sd_ratio ?? 1) - 1) < 0.35);
  const poorR = vars.filter((x) => (x.stats.r ?? 1) < 0.6);
  const biased = vars.filter((x) => rel(x) >= 0.2);
  const over = vars.filter((x) => (x.stats.sd_ratio ?? 1) > 1.4);
  const damp = vars.filter((x) => (x.stats.sd_ratio ?? 1) < 0.6);
  const nwes = site?.lat >= 48 && site?.lat <= 62.5 && site?.lon >= -12 && site?.lon <= 13;
  const names = (a: any[]) => a.map((x) => x.label).join("、");
  return (
    <div className="reading reading-cols" style={{ marginTop: 14 }}>
      <h4>这组比较说明了什么</h4>
      <ul>
        {good.length > 0 && <li><b>{names(good)}</b>：相关系数 ≥ 0.8、偏差 &lt; 10%、变幅接近观测，季节循环和垂向结构都抓住了。</li>}
        {poorR.length > 0 && <li><b>{names(poorR)}</b>：相关系数 &lt; 0.6，季节或垂向的形态与气候态不一致。</li>}
        {biased.length > 0 && <li><b>{names(biased)}</b>：平均偏差超过 20%（{biased.map((x) => `${x.label} ${x.stats.bias > 0 ? "偏高" : "偏低"}`).join("，")}）。</li>}
        {over.length > 0 && <li><b>{names(over)}</b>：模式的变化幅度比观测大（σ模式/σ观测 = {over.map((x) => (x.stats.sd_ratio ?? 0).toFixed(2)).join(" / ")}）。常见原因是混合偏弱：夏季表层过暖、层化过强，或缺少海流对季节变化的调节。</li>}
        {damp.length > 0 && <li><b>{names(damp)}</b>：模式的变化幅度比观测小得多（σ模式/σ观测 = {damp.map((x) => (x.stats.sd_ratio ?? 0).toFixed(2)).join(" / ")}）。营养盐出现这种情况，通常是浮游植物全年吸收过快、冬季也没能恢复，或者真实海区靠海流、河流补充营养盐，一维模型没有这些来源。</li>}
        {!good.length && !poorR.length && !biased.length && !over.length && !damp.length && <li>各变量的偏差和相关都处于中等水平。</li>}
      </ul>
      <h4>为什么会有偏差</h4>
      <p>一维水柱只有垂向过程：没有海流带来的热量和营养盐，没有河流输入，潮流也只是近似。{nwes ? "在模型标定的北海站点，这些简化影响较小。" : "在标定海区以外，这些简化的影响往往更大：例如台湾海峡、东海受季风驱动的海流和长江、闽江等河流输入影响很强，一维模型无法表示。"}温度偏差通常先检查潮流混合强度（“站点与物理”）；营养盐偏差还与生物参数有关。</p>
      <p className="soft">WOA23 同时被用作松弛目标，所以这里的一致不能算独立验证；独立验证需要当地的现场观测。</p>
    </div>
  );
}
