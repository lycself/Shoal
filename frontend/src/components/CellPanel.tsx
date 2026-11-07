/**
 * Details of one shelf column, opened by clicking a grid cell on any shelf map (or a column in
 * the 3D view): where it is, how it ranks, its key indicators in both configurations, and its
 * seasonal cycle — plus a shortcut to study that point in a single-column project.
 */
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../store";
import { Plot, seriesColor } from "./Plot";
import { regionerFor } from "./ShelfExplain";
import { Btn, IconBtn, Seg, fmt, fmtLatLon } from "./ui";

const KEYS = ["phyto", "zoo_Z4_c", "zoo_Z5_c", "npp", "fish_ww", "landings", "co2"];
const MONTHLY_LABEL: Record<string, string> = { temp: "表层温度", Z4_c: "中型浮游动物", fish_c_tot: "鱼类", F1_c: "鱼 1", F2_c: "鱼 2", MB_c: "大型底栖", ECO_mesozoo: "中型浮游动物", ergom_zz: "浮游动物" };

export function CellPanel({ at, point, results, ci, cj, metric, boxes, onClose }: {
  at: { clientX: number; clientY: number }; point: { lat: number; lon: number };
  results: any[]; ci: number; cj?: number; metric: string; boxes: any[]; onClose: () => void;
}) {
  const setPage = useApp((s) => s.setPage);
  const dark = useApp((s) => s.dark);
  const meta = results[0]?.meta ?? {};
  const find = (r: any) => r?.points.find((p: any) => Math.abs(p.lat - point.lat) < 1e-6 && Math.abs(p.lon - point.lon) < 1e-6);
  const A = find(results[ci]), B = cj != null && cj !== ci ? find(results[cj]) : null;
  const monthly = Object.keys(A?.monthly ?? {}).filter((k) => (A.monthly[k] ?? []).some((x: any) => x != null));
  const [mv, setMv] = useState(monthly.find((k) => /fish|F1/.test(k)) ?? monthly[0] ?? "");
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  const region = useMemo(() => (A ? regionerFor(boxes, results[ci].points)(A) : null), [A, boxes]);
  // rank of this column on the shelf for the selected metric
  const rank = useMemo(() => {
    const v = A?.metrics?.[metric];
    if (v == null) return null;
    const all = results[ci].points.map((p: any) => p.metrics?.[metric]).filter((x: any) => x != null).sort((x: number, y: number) => y - x);
    return { n: all.indexOf(v) + 1, of: all.length };
  }, [A, metric]);
  if (!A) return null;
  const keys = [metric, ...KEYS.filter((k) => k !== metric)].filter((k) => meta[k] && A.metrics?.[k] != null);
  const W = 460, left = Math.min(at.clientX + 18, window.innerWidth - W - 12), top = Math.max(56, Math.min(at.clientY - 60, window.innerHeight - 560));
  return (
    <div className="cell-panel" style={{ left, top, width: W, maxHeight: window.innerHeight - top - 12 }} role="dialog" aria-label="水柱详情">
      <div className="row" style={{ gap: 8 }}>
        <b style={{ color: "var(--fg-strong)", whiteSpace: "nowrap" }}>{fmtLatLon(A.lat, A.lon)}</b>
        <span className="soft small">水深 {A.depth} m{region ? ` · ${region}` : ""}</span>
        <span className="grow" />
        <IconBtn icon="close" size="sm" title="关闭（Esc）" onClick={onClose} />
      </div>
      {rank && <div className="soft small" style={{ marginTop: 2 }}>{(meta[metric]?.label ?? metric).trim()}在陆架 {rank.of} 根水柱中排第 <b style={{ color: "var(--fg-strong)" }}>{rank.n}</b>（{rank.n <= rank.of / 4 ? "偏高" : rank.n > (rank.of * 3) / 4 ? "偏低" : "居中"}）</div>}
      <table className="table dense" style={{ marginTop: 8 }}>
        <thead><tr><th>指标</th><th className="num" title={results[ci].config_name}>{short(results[ci].config_name)}</th>{B && <><th className="num" title={results[cj!].config_name}>{short(results[cj!].config_name)}</th><th className="num">变化</th></>}</tr></thead>
        <tbody>{keys.map((k) => {
          const a = A.metrics[k], b = B?.metrics?.[k];
          const ch = B && a && b != null && k !== "co2" ? ((b - a) / Math.abs(a)) * 100 : null;
          return (
            <tr key={k} style={k === metric ? { fontWeight: 600 } : undefined}>
              <td>{meta[k].label.trim().replace(/（.*?）/g, "")}<div className="sub">{meta[k].units}</div></td>
              <td className="num">{fmt(a)}</td>
              {B && <><td className="num">{fmt(b)}</td><td className="num">{ch == null ? (b != null ? fmt(b - a) : "–") : <span className={`delta ${ch > 0 ? "up" : ch < 0 ? "down" : "zero"}`}>{ch > 0 ? "+" : ""}{ch.toFixed(1)}%</span>}</td></>}
            </tr>
          );
        })}</tbody>
      </table>
      {monthly.length > 0 && <>
        <div className="row" style={{ marginTop: 10, gap: 6 }}><span className="small soft">季节循环</span><span className="grow" />
          <Seg size="sm" value={mv} onChange={setMv} options={monthly.slice(0, 4).map((k) => [k, MONTHLY_LABEL[k] ?? k] as [string, string])} /></div>
        <Plot height={170} data={[A, B].filter(Boolean).map((p: any, i: number) => ({ x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], y: p.monthly?.[mv], type: "scatter", mode: "lines+markers", name: short(results[i ? cj! : ci].config_name), line: { color: seriesColor(i, dark), width: 2 }, marker: { size: 4 } }))}
          layout={{ margin: { l: 44, r: 8, t: 6, b: 26 }, xaxis: { tickvals: [1, 4, 7, 10], ticktext: ["1月", "4月", "7月", "10月"] }, showlegend: !!B, legend: { orientation: "h", y: 1.15, font: { size: 10 } } }} />
      </>}
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <Btn size="sm" icon="new-folder" onClick={() => { onClose(); setPage("home"); setTimeout(() => window.dispatchEvent(new CustomEvent("new-project", { detail: { lat: A.lat, lon: A.lon, name: `${fmtLatLon(A.lat, A.lon, 1)} 水柱` } })), 60); }}>以此格点新建项目</Btn>
        <span className="soft small">在一维中做完整实验与验证</span>
      </div>
    </div>
  );
}

const short = (n: string) => (n.length > 12 ? n.replace(/^ERSEM\s*/, "").slice(0, 12) : n);
