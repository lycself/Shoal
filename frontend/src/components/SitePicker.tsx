/**
 * Global site picker: a world relief map that zooms into a region on click, a list of shelf
 * seas around the world, coordinate fields, and a live ETOPO depth / land check with notes on
 * how well the model applies at the chosen place.
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import { MapCanvas } from "./MapCanvas";
import { Btn, Select, fmtLatLon } from "./ui";

export const WORLD_SITES: { name: string; lat: number; lon: number; note: string }[] = [
  { name: "北海中部（模型标定站点）", lat: 56.0, lon: 3.0, note: "季节性层化的温带陆架，E2E 与 MIZER 参数的标定站点" },
  { name: "波罗的海·阿科纳海盆", lat: 54.9, lon: 13.8, note: "半封闭、低盐，ERGOM 的原生海区" },
  { name: "亚得里亚海北部", lat: 44.8, lon: 13.0, note: "受河流影响的浅海" },
  { name: "渤海中部", lat: 38.8, lon: 120.0, note: "浅而封闭，冬季强混合" },
  { name: "黄海中部", lat: 35.5, lon: 123.5, note: "夏季有黄海冷水团" },
  { name: "东海陆架（长江口外）", lat: 31.0, lon: 123.0, note: "大河冲淡水与强潮流" },
  { name: "台湾海峡（厦门外）", lat: 24.3, lon: 118.6, note: "亚热带海峡，季风驱动" },
  { name: "南海北部陆架（珠江口外）", lat: 21.5, lon: 114.5, note: "亚热带，季节性弱" },
  { name: "大堡礁泻湖", lat: -19.0, lon: 147.5, note: "热带、南半球" },
  { name: "乔治浅滩 / 缅因湾", lat: 41.5, lon: -67.5, note: "强潮流混合的高生产力浅滩" },
  { name: "白令海东部陆架", lat: 57.5, lon: -165.0, note: "季节性海冰（模型不含海冰）" },
  { name: "本格拉上升流区", lat: -32.0, lon: 17.5, note: "东边界上升流，南半球" },
  { name: "秘鲁上升流区", lat: -12.0, lon: -77.5, note: "世界最高产的渔场之一" },
  { name: "巴塔哥尼亚陆架", lat: -45.0, lon: -63.0, note: "宽阔的南半球温带陆架" },
];

const WORLD: [number, number, number, number] = [-78, 84, -180, 180];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
function regionBox(lat: number, lon: number): [number, number, number, number] {
  const la0 = clamp(Math.floor(lat - 7), -80, 76), lo0 = clamp(Math.floor(lon - 10), -180, 160);
  return [la0, la0 + 14, lo0, lo0 + 20];
}

/** How well the two papers' setup transfers to a place (plain sentences, warnings flagged). */
export function siteNotes(lat: number, lon: number, depth?: number | null): { text: string; warn?: boolean }[] {
  const n: { text: string; warn?: boolean }[] = [];
  const nwes = lat >= 48 && lat <= 62.5 && lon >= -12 && lon <= 13;
  const baltic = lat >= 53.5 && lat <= 66 && lon > 13 && lon <= 30;
  if (nwes) n.push({ text: "位于模型参数的标定海区（西北欧陆架）。" });
  else if (baltic) n.push({ text: "波罗的海是 ERGOM 宿主的原生海区；ERSEM / ECOSMO 与高营养级参数来自北海，需要检验。" });
  else n.push({ text: "标定海区以外：低营养级宿主是通用模型，可以直接使用；高营养级（E2E、MIZER）的参数来自北海，结论应与当地观测对照，并用参数扫描检验敏感度。", warn: true });
  if (lat < 0) n.push({ text: "南半球：季节与北半球相反（7–8 月是冬季），读图说明会按南半球季节解释。" });
  if (Math.abs(lat) < 23.5) n.push({ text: "热带：季节变化弱，“春季藻华—夏季层化”的典型温带图景不一定出现。" });
  if (Math.abs(lat) > 60) n.push({ text: "高纬度：模型不含海冰，冬季冰覆盖的海区物理过程会有偏差。", warn: true });
  if (depth != null && depth > 300) n.push({ text: `水深 ${depth.toFixed(0)} m：本软件面向陆架海（一般 < 200 m）。开阔大洋需要更多层数、更长预热，而且缺少水平输运的影响更大。`, warn: true });
  if (depth != null && depth < 10) n.push({ text: `水深仅 ${depth.toFixed(0)} m：潮间带、海草和底栖附着藻等过程不在模型中。`, warn: true });
  if (!nwes) n.push({ text: "潮流混合默认按北海中部设置；强潮海区（如东海、乔治浅滩）或弱潮海区（如波罗的海、地中海）请在“站点与物理”中调整潮流强度。" });
  return n;
}

export function SitePicker({ lat, lon, onChange, disabled, height = 360 }: { lat: number; lon: number; onChange: (lat: number, lon: number, name?: string) => void; disabled?: boolean; height?: number }) {
  const [box, setBox] = useState<[number, number, number, number]>(() => regionBox(lat, lon));
  const world = box === WORLD || (box[1] - box[0] > 100);
  const [info, setInfo] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    setInfo(null);
    const t = setTimeout(() => api.get(`/point?lat=${lat}&lon=${lon}`).then((r) => alive && setInfo(r)).catch(() => alive && setInfo({ error: "无法获取水深" })), 350);
    return () => { alive = false; clearTimeout(t); };
  }, [lat, lon]);
  const pick = (la: number, lo: number) => {
    const p = [+la.toFixed(2), +lo.toFixed(2)] as const;
    onChange(p[0], p[1]);
    if (world) setBox(regionBox(p[0], p[1]));
  };
  const notes = siteNotes(lat, lon, info?.depth);
  return (
    <div className="col" style={{ gap: 8, opacity: disabled ? 0.55 : 1, pointerEvents: disabled ? "none" : undefined }}>
      <div className="row" style={{ gap: 8 }}>
        <Select size="sm" value="" onChange={(v) => { const s = WORLD_SITES[+v]; if (s) { onChange(s.lat, s.lon, s.name); setBox(regionBox(s.lat, s.lon)); } }} style={{ minWidth: 220 }}>
          <option value="">常用海区…</option>
          {WORLD_SITES.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
        </Select>
        <span className="grow" />
        {world ? <span className="soft small">点击地图放大到该海区</span> : <Btn size="sm" variant="ghost" icon="globe" onClick={() => setBox(WORLD)}>全球</Btn>}
      </div>
      <MapCanvas box={box} marker={{ lat, lon }} height={height} showBathyLegend={!world} onPick={pick} />
      <div className="row wrap" style={{ gap: 12 }}>
        <span className="opt">纬度<input className="input num sm" type="number" step="0.01" min={-80} max={85} value={lat} onChange={(e) => onChange(+e.target.value, lon)} style={{ width: 92 }} /></span>
        <span className="opt">经度<input className="input num sm" type="number" step="0.01" min={-180} max={180} value={lon} onChange={(e) => onChange(lat, +e.target.value)} style={{ width: 92 }} /></span>
        <span className="soft small">{fmtLatLon(lat, lon)} · {info == null ? "查询水深…" : info.land ? <b style={{ color: "var(--danger)" }}>这里是陆地，请选海上的点</b> : info.depth != null ? <>水深 <b style={{ color: "var(--fg-strong)" }}>{info.depth} m</b>（ETOPO 2022）</> : "水深暂时查不到，可在创建后手动填写"}</span>
      </div>
      <div className="reading" style={{ fontSize: 12.5 }}>
        <ul>{notes.map((x, i) => <li key={i} className={x.warn ? "reading-warn" : undefined}>{x.text}</li>)}</ul>
      </div>
    </div>
  );
}

export function useSiteDepth(lat: number, lon: number) {
  const [info, setInfo] = useState<any>(null);
  useEffect(() => { let alive = true; api.get(`/point?lat=${lat}&lon=${lon}`).then((r) => alive && setInfo(r)).catch(() => {}); return () => { alive = false; }; }, [lat, lon]);
  return info;
}
