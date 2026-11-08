import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { colorscaleFor, rampCss } from "./Plot";
import { cssVar, extent, fmt, fmtLatLon } from "./ui";

export interface MapPoint { lat: number; lon: number; value?: number | null; label?: string }

type Scale = [number, string][];
const OCEAN: Scale = [[0, "#eef7fb"], [0.35, "#a8d3e6"], [0.7, "#3d8ab8"], [1, "#0f3d66"]]; // design:allow-colour colormap

function hex2rgb(h: string): [number, number, number] {
  const m = h.replace("#", "");
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
export function sampleScale(scale: Scale, t: number): string {
  const x = Math.max(0, Math.min(1, isFinite(t) ? t : 0));
  for (let i = 1; i < scale.length; i++) {
    if (x <= scale[i][0]) {
      const [t0, c0] = scale[i - 1], [t1, c1] = scale[i];
      const f = (x - t0) / (t1 - t0 || 1);
      const a = hex2rgb(c0), b = hex2rgb(c1);
      return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
    }
  }
  return scale[scale.length - 1][1];
}

function parseColor(c: string): [number, number, number] {
  if (c.startsWith("#")) return hex2rgb(c);
  const m = c.match(/\d+(\.\d+)?/g);
  return m ? [+m[0], +m[1], +m[2]] : [200, 200, 200];
}

/** Marching squares: line segments of the iso-line `level` on a lat/lon grid (in grid index space). */
function isoSegments(z: number[][], level: number): [number, number, number, number][] {
  const ny = z.length, nx = z[0]?.length ?? 0;
  const segs: [number, number, number, number][] = [];
  const interp = (a: number, b: number) => (level - a) / (b - a || 1e-9);
  for (let i = 0; i < ny - 1; i++) {
    for (let j = 0; j < nx - 1; j++) {
      const a = z[i][j], b = z[i][j + 1], c = z[i + 1][j + 1], d = z[i + 1][j];
      const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const top: [number, number] = [i, j + interp(a, b)];
      const right: [number, number] = [i + interp(b, c), j + 1];
      const bottom: [number, number] = [i + 1, j + interp(d, c)];
      const left: [number, number] = [i + interp(a, d), j];
      const add = (p: [number, number], q: [number, number]) => segs.push([p[0], p[1], q[0], q[1]]);
      switch (idx) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break;
        case 5: add(left, top); add(bottom, right); break;
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(left, top); break;
        case 10: add(top, right); add(left, bottom); break;
      }
    }
  }
  return segs;
}

export function MapCanvas({ box, points = [], cell, scale, range, onPick, marker, height = 440, units, title, varName, diverging, showBathyLegend, outlines, compact, onPointClick, selected, highlightBox }: {
  box: [number, number, number, number];
  points?: MapPoint[];
  cell?: number;
  scale?: Scale;
  range?: [number, number];
  onPick?: (lat: number, lon: number) => void;
  marker?: { lat: number; lon: number } | null;
  height?: number;
  units?: string;
  title?: string;
  varName?: string;
  diverging?: boolean;
  showBathyLegend?: boolean;
  outlines?: { box: [number, number, number, number]; label: string }[];
  compact?: boolean;
  /** click on a data cell (grid maps) — e.g. to open a details panel */
  onPointClick?: (p: MapPoint, at: { clientX: number; clientY: number }) => void;
  /** cell drawn with a persistent outline (the one whose details are open) */
  selected?: { lat: number; lon: number } | null;
  /** a region box to emphasise (e.g. while hovering a table row) */
  highlightBox?: [number, number, number, number] | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const dark = useApp((s) => s.dark);
  const [mask, setMask] = useState<any>(null);
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[]; pt: MapPoint | null } | null>(null);
  const [w, setW] = useState(640);
  const [lat0, lat1, lon0, lon1] = box;
  const span = Math.max(lat1 - lat0, (lon1 - lon0) * 0.6);
  // world-scale views use one coarse, cached grid; regional views get finer relief
  const res = span > 60 ? 0.5 : +Math.max(0.04, Math.min(0.2, span / 220)).toFixed(3);
  const sc: Scale = scale ?? (varName ? colorscaleFor(varName, dark, diverging) : colorscaleFor("", dark, diverging));

  useEffect(() => {
    let alive = true;
    setMask(null);
    api.get(`/landmask?lat0=${lat0}&lat1=${lat1}&lon0=${lon0}&lon1=${lon1}&res=${res}`).then((m) => alive && setMask(m)).catch(() => {});
    return () => { alive = false; };
  }, [lat0, lat1, lon0, lon1, res]);
  useEffect(() => {
    const ro = new ResizeObserver(() => wrap.current && setW(wrap.current.clientWidth));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const [vmin, vmax] = useMemo(() => {
    if (range) return range;
    const v = points.map((p) => p.value).filter((x): x is number => x !== null && x !== undefined && isFinite(x));
    if (!v.length) return [0, 1];
    return extent(v);
  }, [points, range]);

  const M = compact ? { l: 34, r: 6, t: 6, b: 20 } : { l: 44, r: 10, t: 8, b: 26 };
  const kx = Math.cos(((lat0 + lat1) / 2) * Math.PI / 180);
  const aspect = ((lon1 - lon0) * kx) / (lat1 - lat0);
  const availW = Math.max(200, w - M.l - M.r);
  const PH = Math.min(height - M.t - M.b, availW / aspect);
  const PW = PH * aspect;
  const W = PW + M.l + M.r, H = PH + M.t + M.b;
  const X = (lon: number) => M.l + ((lon - lon0) / (lon1 - lon0)) * PW;
  const Y = (lat: number) => M.t + ((lat1 - lat) / (lat1 - lat0)) * PH;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.save();
    g.beginPath(); g.rect(M.l, M.t, PW, PH); g.clip();
    const seaS = parseColor(cssVar("--map-sea-shallow")), seaD = parseColor(cssVar("--map-sea-deep")), land = parseColor(cssVar("--map-land"));
    g.fillStyle = `rgb(${seaS.join(",")})`;
    g.fillRect(M.l, M.t, PW, PH);
    if (mask) {
      // raster at grid resolution, then scaled with smoothing for a continuous look
      const ny = mask.lat.length, nx = mask.lon.length;
      const off = document.createElement("canvas");
      off.width = nx; off.height = ny;
      const og = off.getContext("2d")!;
      const img = og.createImageData(nx, ny);
      for (let i = 0; i < ny; i++) {
        const row = ny - 1 - i; // lat ascending -> image top is north
        for (let j = 0; j < nx; j++) {
          const z = mask.alt[i][j];
          const k = (row * nx + j) * 4;
          let col: number[];
          if (z > 0) col = land;
          else {
            const t = Math.min(1, Math.sqrt(-z / 300));
            col = seaS.map((v, q) => v + (seaD[q] - v) * t);
          }
          img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
        }
      }
      og.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      const dlat = (mask.lat[ny - 1] - mask.lat[0]) / Math.max(1, ny - 1), dlon = (mask.lon[nx - 1] - mask.lon[0]) / Math.max(1, nx - 1);
      const x0 = X(mask.lon[0] - dlon / 2), x1 = X(mask.lon[nx - 1] + dlon / 2), y0 = Y(mask.lat[ny - 1] + dlat / 2), y1 = Y(mask.lat[0] - dlat / 2);
      g.drawImage(off, x0, y0, x1 - x0, y1 - y0);
      const toXY = (ii: number, jj: number): [number, number] => [X(mask.lon[0] + jj * dlon), Y(mask.lat[0] + ii * dlat)];
      const stroke = (segs: [number, number, number, number][], color: string, width: number, dash: number[] = []) => {
        g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash);
        g.beginPath();
        for (const [i1, j1, i2, j2] of segs) { const [a, b] = toXY(i1, j1); const [cc, d] = toXY(i2, j2); g.moveTo(a, b); g.lineTo(cc, d); }
        g.stroke();
        g.setLineDash([]);
      };
      for (const dep of [50, 100, 200]) stroke(isoSegments(mask.alt, -dep), cssVar("--map-contour"), 0.8, dep === 200 ? [] : [3, 3]);
      stroke(isoSegments(mask.alt, 0), cssVar("--map-land-edge"), 1.1);
    }
    // data cells / points
    for (const p of points) {
      const t = p.value === null || p.value === undefined || !isFinite(p.value) ? null : (p.value - vmin) / (vmax - vmin || 1);
      const fill = t === null ? cssVar("--fg-soft") : sampleScale(sc, t);
      if (cell) {
        const xa = X(p.lon - cell / 2), xb = X(p.lon + cell / 2), ya = Y(p.lat + cell / 2), yb = Y(p.lat - cell / 2);
        g.globalAlpha = 0.92;
        g.fillStyle = fill;
        g.fillRect(xa + 0.5, ya + 0.5, xb - xa - 1, yb - ya - 1);
        g.globalAlpha = 1;
      } else {
        g.fillStyle = fill;
        g.strokeStyle = dark ? "rgba(0,0,0,.6)" : "rgba(255,255,255,.9)";
        g.lineWidth = 1.2;
        g.beginPath(); g.arc(X(p.lon), Y(p.lat), 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    }
    if (outlines) {
      g.strokeStyle = cssVar("--fg-strong"); g.lineWidth = 1.2; g.setLineDash([4, 3]);
      g.font = `600 10.5px ${cssVar("--font")}`; g.fillStyle = cssVar("--fg-strong"); g.textAlign = "left"; g.textBaseline = "top";
      for (const o of outlines) {
        const [a0, a1, o0, o1] = o.box;
        g.strokeRect(X(o0), Y(a1), X(o1) - X(o0), Y(a0) - Y(a1));
      }
      g.setLineDash([]);
      // labels at box centres with a halo so overlapping boxes stay legible
      g.textAlign = "center"; g.textBaseline = "middle";
      for (const o of outlines) {
        const [a0, a1, o0, o1] = o.box;
        const cx = (X(o0) + X(o1)) / 2, cy = (Y(a0) + Y(a1)) / 2;
        const w = g.measureText(o.label).width + 8;
        g.fillStyle = cssVar("--bg"); g.globalAlpha = 0.85;
        g.fillRect(cx - w / 2, cy - 8, w, 16);
        g.globalAlpha = 1; g.fillStyle = cssVar("--fg-strong");
        g.fillText(o.label, cx, cy);
      }
    }
    if (marker) {
      const x = X(marker.lon), y = Y(marker.lat);
      g.fillStyle = cssVar("--danger");
      g.strokeStyle = "#fff"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x - 9, y - 12, x - 7, y - 22, x, y - 22); g.bezierCurveTo(x + 7, y - 22, x + 9, y - 12, x, y); g.fill(); g.stroke();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(x, y - 15, 3, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // frame, graticule, ticks
    const big = Math.max(lat1 - lat0, lon1 - lon0);
    const step = big > 120 ? 30 : big > 40 ? 10 : big > 16 ? 4 : big > 6 ? 2 : 1;
    g.strokeStyle = cssVar("--map-grid"); g.lineWidth = 0.7;
    g.fillStyle = cssVar("--fg-muted"); g.font = `10.5px ${cssVar("--font")}`;
    g.textAlign = "right"; g.textBaseline = "middle";
    for (let la = Math.ceil(lat0 / step) * step; la <= lat1 + 1e-9; la += step) {
      const y = Y(la);
      g.beginPath(); g.moveTo(M.l, y); g.lineTo(M.l + PW, y); g.stroke();
      g.fillText(la === 0 ? "0°" : `${Math.abs(la)}°${la < 0 ? "S" : "N"}`, M.l - 6, y);
    }
    g.textAlign = "center"; g.textBaseline = "top";
    for (let lo = Math.ceil(lon0 / step) * step; lo <= lon1 + 1e-9; lo += step) {
      const x = X(lo);
      g.beginPath(); g.moveTo(x, M.t); g.lineTo(x, M.t + PH); g.stroke();
      g.fillText(lo === 0 ? "0°" : `${Math.abs(lo)}°${lo < 0 ? "W" : "E"}`, x, M.t + PH + 6);
    }
    g.strokeStyle = cssVar("--border-strong"); g.lineWidth = 1;
    g.strokeRect(M.l + 0.5, M.t + 0.5, PW - 1, PH - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mask, points, W, H, vmin, vmax, marker, dark, cell, JSON.stringify(sc), outlines]);

  const locate = (e: React.MouseEvent) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { x, y, lat: lat1 - ((y - M.t) / PH) * (lat1 - lat0), lon: lon0 + ((x - M.l) / PW) * (lon1 - lon0), inside: x >= M.l && x <= M.l + PW && y >= M.t && y <= M.t + PH };
  };
  const hasValues = points.some((p) => p.value !== undefined && p.value !== null);
  // relief at the cursor from the ETOPO grid already loaded for the basemap
  const reliefAt = (lat: number, lon: number): number | null => {
    if (!mask) return null;
    const la: number[] = mask.lat, lo: number[] = mask.lon;
    const i = Math.round(((lat - la[0]) / (la[la.length - 1] - la[0])) * (la.length - 1));
    const j = Math.round(((lon - lo[0]) / (lo[lo.length - 1] - lo[0])) * (lo.length - 1));
    return i >= 0 && i < la.length && j >= 0 && j < lo.length ? mask.alt[i][j] : null;
  };
  const nearest = (lat: number, lon: number) => {
    let best: MapPoint | null = null, bd = Infinity;
    for (const q of points) { const d = (q.lat - lat) ** 2 + ((q.lon - lon) * kx) ** 2; if (d < bd) { bd = d; best = q; } }
    return best && Math.sqrt(bd) < (cell ? cell * 0.72 : 0.35) ? best : null;
  };
  const cellRect = (q: { lat: number; lon: number }) => {
    const h = (cell ?? 0.3) / 2;
    const x0 = X(q.lon - h), x1 = X(q.lon + h), y0 = Y(q.lat + h), y1 = Y(q.lat - h);
    return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
  };
  const hov = tip?.pt ?? null;
  const frac = hov && hov.value != null && isFinite(hov.value) ? Math.max(0, Math.min(1, (hov.value - vmin) / (vmax - vmin || 1))) : null;
  return (
    <div ref={wrap} style={{ width: "100%" }}>
      {title && <div className="small muted" style={{ marginBottom: 6 }}>{title}</div>}
      <div className="map-frame">
        <canvas ref={ref} style={{ cursor: onPick ? "crosshair" : hov && onPointClick ? "pointer" : "default" }}
          onClick={(e) => {
            const p = locate(e);
            if (!p.inside) return;
            const q = nearest(p.lat, p.lon);
            if (q && onPointClick) return onPointClick(q, { clientX: e.clientX, clientY: e.clientY });
            if (onPick) onPick(+p.lat.toFixed(3), +p.lon.toFixed(3));
          }}
          onMouseMove={(e) => {
            const p = locate(e);
            if (!p.inside) return setTip(null);
            const q = nearest(p.lat, p.lon);
            const z = reliefAt(p.lat, p.lon);
            const relief = z == null ? "" : z < 0 ? `水深 ${Math.round(-z)} m` : `陆地 · 海拔 ${Math.round(z)} m`;
            const lines = q
              ? [fmtLatLon(q.lat, q.lon), ...(q.value != null ? [`${fmt(q.value)} ${units ?? ""}`] : []), ...(q.label ? [q.label] : []), ...(onPointClick ? ["点击查看这根水柱的详情"] : [])]
              : [fmtLatLon(p.lat, p.lon), ...(relief ? [relief] : []), ...(onPick ? ["点击选为站点"] : [])];
            setTip({ x: p.x, y: p.y, lines, pt: q });
          }}
          onMouseLeave={() => setTip(null)} />
        {highlightBox && (() => { const [a0, a1, o0, o1] = highlightBox; return <div className="map-region-hl" style={{ left: X(o0), top: Y(a1), width: X(o1) - X(o0), height: Y(a0) - Y(a1) }} />; })()}
        {hov && cell && <div className="map-cell-hover" style={cellRect(hov)} />}
        {selected && cell && <div className="map-cell-selected" style={cellRect(selected)} />}
        {tip && <div className="map-tip" style={{ left: Math.min(tip.x + 14, W - 200), top: tip.y + 14 }}>{tip.lines.map((l, i) => <div key={i} className={i === 0 ? "t" : l.startsWith("点击") ? "h" : undefined}>{l}</div>)}</div>}
      </div>
      <div className="row wrap" style={{ marginTop: 6, gap: 18, paddingLeft: M.l, maxWidth: W, overflow: "hidden" }}>
        {hasValues && (
          <div className="colorbar">
            <span className="num">{fmt(vmin)}</span>
            <span className="ramp" style={{ background: rampCss(sc), position: "relative" }}>{frac != null && <i className="ramp-mark" style={{ left: `${frac * 100}%` }} />}</span>
            <span className="num">{fmt(vmax)}</span>
            {units && <span style={{ whiteSpace: "nowrap" }}>{units}</span>}
          </div>
        )}
        {(showBathyLegend ?? !hasValues) && (
          <div className="colorbar">
            <span>水深</span>
            <span className="ramp" style={{ width: 110, background: `linear-gradient(90deg, ${cssVar("--map-sea-shallow")}, ${cssVar("--map-sea-deep")})` }} />
            <span>0–300 m · 等深线 50 / 100 / 200 m</span>
          </div>
        )}
      </div>
    </div>
  );
}

export { OCEAN as OCEAN_SCALE };
