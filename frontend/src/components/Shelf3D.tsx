import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { api } from "../api";
import { useApp } from "../store";
import { sampleScale } from "./MapCanvas";
import { rampCss } from "./Plot";
import { cssVar, fmt, fmtLatLon } from "./ui";

export interface ColumnPoint { lat: number; lon: number; depth: number; value: number | null; label?: string }

const DEPTH_SCALE = 0.0045; // scene units per metre below sea level (vertical exaggeration)
const LAND_SCALE = 0.00035;

function hex(c: string) { return new THREE.Color(c.startsWith("rgb") ? c : c); }

/** 3D shelf: ETOPO relief, translucent sea surface and one prism per simulated water column, coloured by a result. */
export function Shelf3D({ box, points, cell, scale, range, units, height = 560, onPick }: {
  box: [number, number, number, number]; points: ColumnPoint[]; cell: number; scale: [number, number][] | any; range: [number, number]; units?: string; height?: number;
  /** click (not drag) on a column */
  onPick?: (p: ColumnPoint, at: { clientX: number; clientY: number }) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const dark = useApp((s) => s.dark);
  const [mask, setMask] = useState<any>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const state = useRef<{ renderer?: THREE.WebGLRenderer; scene?: THREE.Scene; camera?: THREE.PerspectiveCamera; controls?: OrbitControls; cols?: THREE.Group; raf?: number; dirty?: boolean }>({});
  const [lat0, lat1, lon0, lon1] = box;
  const kx = Math.cos(((lat0 + lat1) / 2) * Math.PI / 180);
  const X = (lon: number) => (lon - (lon0 + lon1) / 2) * kx;
  const Z = (lat: number) => -(lat - (lat0 + lat1) / 2);

  useEffect(() => {
    let alive = true;
    const res = +Math.max(0.08, (lat1 - lat0) / 140).toFixed(3);
    api.get(`/landmask?lat0=${lat0}&lat1=${lat1}&lon0=${lon0}&lon1=${lon1}&res=${res}`).then((m) => alive && setMask(m)).catch(() => {});
    return () => { alive = false; };
  }, [lat0, lat1, lon0, lon1]);

  // scene setup
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(el.clientWidth, height);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, el.clientWidth / height, 0.05, 500);
    const span = Math.max((lon1 - lon0) * kx, lat1 - lat0);
    camera.position.set(0, span * 0.75, span * 0.95);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0, -0.3, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(-span, span * 1.5, span * 0.6);
    scene.add(sun);
    state.current = { renderer, scene, camera, controls, dirty: true };
    const loop = () => {
      state.current.raf = requestAnimationFrame(loop);
      if (controls.update() || state.current.dirty) { renderer.render(scene, camera); state.current.dirty = false; }
    };
    controls.addEventListener("change", () => { state.current.dirty = true; });
    loop();
    const ro = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, height);
      camera.aspect = el.clientWidth / height;
      camera.updateProjectionMatrix();
      state.current.dirty = true;
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(state.current.raf!); ro.disconnect(); controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  // terrain + sea surface
  useEffect(() => {
    const { scene } = state.current;
    if (!scene || !mask) return;
    scene.children.filter((c) => c.userData.terrain).forEach((c) => scene.remove(c));
    const ny = mask.lat.length, nx = mask.lon.length;
    const geo = new THREE.PlaneGeometry(1, 1, nx - 1, ny - 1);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const land = hex(cssVar("--map-land")), shallow = hex(cssVar("--map-sea-shallow")), deep = hex(cssVar("--map-sea-deep"));
    const c = new THREE.Color();
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const k = iy * nx + ix;
        const i = ny - 1 - iy; // plane rows go from top (north) to bottom
        const alt = mask.alt[i][ix];
        const h = alt > 0 ? Math.min(alt, 1500) * LAND_SCALE : alt * DEPTH_SCALE;
        pos.setXYZ(k, X(mask.lon[ix]), h, Z(mask.lat[i]));
        if (alt > 0) c.copy(land).offsetHSL(0, 0, Math.min(0.12, alt / 8000));
        else c.copy(shallow).lerp(deep, Math.min(1, Math.sqrt(-alt / 300)));
        colors.set([c.r, c.g, c.b], k * 3);
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    terrain.userData.terrain = true;
    scene.add(terrain);
    const w = (lon1 - lon0) * kx, d = lat1 - lat0;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: dark ? 0x3d8bfd : 0x6fa8dc, transparent: true, opacity: 0.12, depthWrite: false }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0.001;
    sea.userData.terrain = true;
    scene.add(sea);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.0001, d)), new THREE.LineBasicMaterial({ color: dark ? 0x555a63 : 0xb4bcc6 }));
    frame.userData.terrain = true;
    scene.add(frame);
    state.current.dirty = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mask, dark]);

  // water columns
  useEffect(() => {
    const { scene } = state.current;
    if (!scene) return;
    if (state.current.cols) scene.remove(state.current.cols);
    const g = new THREE.Group();
    const [vmin, vmax] = range;
    for (const p of points) {
      const hgt = p.depth * DEPTH_SCALE;
      const t = p.value == null || !isFinite(p.value) ? null : (p.value - vmin) / (vmax - vmin || 1);
      const color = t === null ? new THREE.Color(0x888888) : new THREE.Color(sampleScale(scale, t));
      const m = new THREE.Mesh(new THREE.BoxGeometry(cell * kx * 0.82, hgt, cell * 0.82), new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.88 }));
      m.position.set(X(p.lon), -hgt / 2 + 0.002, Z(p.lat));
      m.userData = { p };
      g.add(m);
    }
    scene.add(g);
    state.current.cols = g;
    state.current.dirty = true;
  }, [points, range, scale, cell]);

  const ray = new THREE.Raycaster();
  const hovered = useRef<THREE.Mesh | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);
  const pickAt = (e: React.MouseEvent) => {
    const { camera, cols } = state.current;
    const el = host.current;
    if (!camera || !cols || !el) return null;
    const r = el.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / height) * 2 + 1);
    ray.setFromCamera(v, camera);
    return { hit: ray.intersectObjects(cols.children, false)[0], r };
  };
  const setHover = (m: THREE.Mesh | null) => {
    if (hovered.current === m) return;
    if (hovered.current) (hovered.current.material as THREE.MeshLambertMaterial).emissive.setHex(0x000000);
    if (m) (m.material as THREE.MeshLambertMaterial).emissive.setHex(dark ? 0x555555 : 0x333333);
    hovered.current = m;
    state.current.dirty = true;
  };
  const onMove = (e: React.MouseEvent) => {
    const q = pickAt(e);
    if (!q) return;
    if (q.hit) {
      const p = (q.hit.object.userData as any).p as ColumnPoint;
      setHover(q.hit.object as THREE.Mesh);
      setTip({ x: e.clientX - q.r.left, y: e.clientY - q.r.top, text: `${fmtLatLon(p.lat, p.lon)} · 水深 ${p.depth} m — ${fmt(p.value)} ${units ?? ""}${onPick ? "（点击查看详情）" : ""}` });
    } else { setHover(null); setTip(null); }
  };
  const onUp = (e: React.MouseEvent) => {
    const d = down.current;
    down.current = null;
    if (!onPick || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return; // a drag rotates the view
    const q = pickAt(e);
    if (q?.hit) onPick((q.hit.object.userData as any).p, { clientX: e.clientX, clientY: e.clientY });
  };
  return (
    <div style={{ position: "relative" }}>
      <div ref={host} style={{ width: "100%", height, borderRadius: 6, overflow: "hidden", background: dark ? "var(--figure-bg), #16181b" : "#f3f6f9", cursor: hovered.current && onPick ? "pointer" : "grab" }}
        onMouseMove={onMove} onMouseDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; }} onMouseUp={onUp} onMouseLeave={() => { setHover(null); setTip(null); }} />
      {tip && <div className="map-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</div>}
      <div className="row" style={{ position: "absolute", left: 10, bottom: 10, gap: 14 }}>
        <div className="colorbar" style={{ background: "var(--bg-tooltip)", padding: "4px 8px", borderRadius: 5, border: "1px solid var(--border)" }}>
          <span className="num">{fmt(range[0])}</span><span className="ramp" style={{ background: rampCss(scale) }} /><span className="num">{fmt(range[1])}</span>{units && <span>{units}</span>}
        </div>
        <span className="soft small" style={{ background: "var(--bg-tooltip)", padding: "4px 8px", borderRadius: 5, border: "1px solid var(--border)" }}>拖动旋转 · 滚轮缩放 · 右键平移 · 垂向放大约 {Math.round(DEPTH_SCALE * 111000)} 倍</span>
      </div>
    </div>
  );
}
