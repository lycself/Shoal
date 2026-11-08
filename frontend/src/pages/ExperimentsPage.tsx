import { useEffect, useState } from "react";
import { ask } from "../dialog";
import { api, on } from "../api";
import { Btn, Check, Empty, Icon, IconBtn, Loading, Modal, Notice, Progress, Select, Split, StatusBadge, useAsync, HelpLink, PanelToggle } from "../components/ui";
import { HOST_LABEL, HTL_LABEL, useApp } from "../store";

export default function ExperimentsPage() {
  const { project, jobs, toast, setPage, setSelectedRuns, revision } = useApp();
  const p = project!;
  const exps = useAsync(() => api.get<any[]>(`/projects/${p.id}/experiments`), [p.id, revision]);
  const configs = useAsync(() => api.get<any[]>(`/projects/${p.id}/configs`), [p.id, revision]);
  const runs = useAsync(() => api.get<any[]>(`/projects/${p.id}/runs`), [p.id, revision]);
  const [sel, setSel] = useState<string>("");
  const [edit, setEdit] = useState<any | null>(null);
  const [file, setFile] = useState<{ rid: string; name: string } | null>(null);
  const [scan, setScan] = useState(false);
  useEffect(() => {
    const offs = [on("runs", () => runs.reload()), on("run", (e) => { if (e.project === p.id && ["done", "failed", "cancelled", "running"].includes(e.status)) runs.reload(); })];
    return () => offs.forEach((f) => f());
  }, [p.id]);
  useEffect(() => { if (exps.data && !sel) setSel(exps.data[0]?.id ?? "__all__"); }, [exps.data]);
  useEffect(() => { const h = (e: Event) => setSel((e as CustomEvent).detail); window.addEventListener("experiments-select", h); return () => window.removeEventListener("experiments-select", h); }, []);
  const jobFor = (rid: string) => Object.values(jobs).find((j) => j.run_id === rid);
  const statusOf = (r: any) => jobFor(r.id)?.status ?? r.status;
  const latest = (cid: string) => runs.data?.find((r) => r.config_id === cid);
  const analyze = (ids: string[]) => { setSelectedRuns(ids); setPage("results"); };
  const start = async (e: any, only?: string[]) => {
    try { const rs = await api.post<any[]>(`/projects/${p.id}/experiments/${e.id}/run`, only ? { only } : {}); toast(`已提交 ${rs.length} 次运行`, "ok"); runs.reload(); }
    catch (err: any) { toast(err.message, "bad"); if (/站点/.test(err.message)) setPage("site"); }
  };
  const exp = exps.data?.find((e) => e.id === sel);

  return (
    <div className="page fill">
      <Split header={
      <div className="page-header">
        <div>
          <div className="row"><PanelToggle id="exps" label="实验列表" /><div className="page-title">实验与运行</div><HelpLink chapter="13-designs" title="对照实验怎么设计、怎么读（教程）" /></div>
        </div>
        <div className="page-actions">
          {p.site_status !== "ready" && <span className="badge warn"><Icon name="warning" />站点未就绪</span>}
          <Btn icon="settings" onClick={() => setScan(true)}>参数扫描…</Btn>
          <Btn icon="add" onClick={() => setEdit({ name: "新实验", description: "", items: [] })}>新实验</Btn>
        </div>
      </div>
      } id="exps" label="实验列表" initial={300} side={
        <>
          <div className="tree-head">实验<span className="actions"><IconBtn icon="refresh" title="刷新" size="sm" onClick={() => { exps.reload(); runs.reload(); }} /><PanelToggle id="exps" label="实验列表" inPanel /></span></div>
          <div className="split-scroll">
            {(exps.data ?? []).map((e) => {
              const st = e.items.map((it: any) => { const r = latest(it.config_id); return r ? statusOf(r) : "none"; });
              const done = st.filter((s: string) => s === "done").length, active = st.filter((s: string) => s === "running" || s === "queued").length, failed = st.filter((s: string) => s === "failed").length;
              return (
                <div key={e.id} className={`tree-item flat ${sel === e.id ? "active" : ""}`} onClick={() => setSel(e.id)} style={{ alignItems: "flex-start", paddingTop: 8, paddingBottom: 8 }}>
                  <Icon name={active ? "loading" : done === e.items.length ? "pass-filled" : "beaker"} spin={active > 0} style={{ marginTop: 2, color: active ? "var(--accent)" : done === e.items.length ? "var(--ok)" : undefined }} />
                  <div className="grow">
                    <div style={{ fontWeight: 500, lineHeight: 1.35 }}>{e.name}</div>
                    <div className="meta" style={{ marginTop: 3 }}>{done}/{e.items.length} 完成{active ? ` · ${active} 进行中` : ""}{failed ? ` · ${failed} 失败` : ""}</div>
                    <div style={{ display: "flex", gap: 2, marginTop: 5 }}>
                      {st.map((s: string, i: number) => <span key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: s === "done" ? "var(--ok)" : s === "failed" ? "var(--danger)" : s === "running" || s === "queued" ? "var(--accent)" : "var(--border)" }} />)}
                    </div>
                  </div>
                </div>
              );
            })}
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 6 }} />
            <div className={`tree-item flat ${sel === "__all__" ? "active" : ""}`} onClick={() => setSel("__all__")}>
              <Icon name="history" /><div className="grow">全部运行记录</div><span className="meta">{runs.data?.length ?? 0}</span>
            </div>
          </div>
        </>
      }>
        {sel === "__all__" ? <AllRuns runs={runs.data ?? []} jobFor={jobFor} analyze={analyze} onFile={setFile} reload={runs.reload} pid={p.id} />
          : exp ? (
            <>
              <div className="toolbar">
                <b style={{ color: "var(--fg-strong)", fontSize: 14 }} className="ellipsis">{exp.name}</b>
                <span className="grow" />
                {(() => {
                  // once every item has a finished run, the next step is reading the results, not re-running
                  const allDone = exp.items.length > 0 && exp.items.every((it: any) => latest(it.config_id)?.status === "done");
                  const anyDone = exp.items.some((it: any) => latest(it.config_id)?.status === "done");
                  return <>
                    <Btn size="sm" variant={allDone ? "primary" : undefined} icon="graph-line" disabled={!anyDone}
                      onClick={() => analyze(exp.items.map((it: any) => latest(it.config_id)).filter((r: any) => r?.status === "done").map((r: any) => r.id))}>对比结果</Btn>
                    <Btn size="sm" icon="edit" onClick={() => setEdit(exp)}>编辑</Btn>
                    <div className="divider" />
                    <Btn size="sm" variant={allDone ? undefined : "primary"} icon="run-all" onClick={async () => { if (!allDone || await ask(`这组实验的 ${exp.items.length} 个配置都已经算完。再全部运行一遍会新增一批运行记录（旧的保留），确定吗？`, { ok: "重新运行" })) start(exp); }}>{allDone ? "重新全部运行" : "全部运行"}</Btn>
                  </>;
                })()}
              </div>
              <div className="split-scroll">
                <div style={{ padding: "14px 16px 4px" }}>
                  <div className="muted">{exp.description}</div>
                  {exp.paper && <div className="soft small" style={{ fontStyle: "italic", marginTop: 3 }}>{exp.paper}</div>}
                </div>
                <table className="table" style={{ marginTop: 8 }}>
                  <thead><tr><th style={{ width: "34%" }}>配置</th><th>宿主 · 高营养级</th><th style={{ width: 280 }}>最近一次运行</th><th style={{ width: 120 }} /></tr></thead>
                  <tbody>
                    {exp.items.map((it: any, i: number) => {
                      const c = configs.data?.find((x) => x.id === it.config_id);
                      const r = latest(it.config_id);
                      const j = r && jobFor(r.id);
                      const st = r ? statusOf(r) : null;
                      return (
                        <tr key={it.config_id}>
                          <td>
                            <div className="row" style={{ alignItems: "flex-start" }}>
                              <span className="badge" style={{ minWidth: 22, justifyContent: "center" }}>{i + 1}</span>
                              <div><div className="strong" style={{ fontWeight: 500 }}>{it.label}</div>{c?.description && <div className="sub">{c.description}</div>}</div>
                            </div>
                          </td>
                          <td className="small">{c ? <><span className="tag">{HOST_LABEL[c.spec.host]}</span> <span className="tag">{HTL_LABEL[c.spec.htl.kind]}</span></> : <span className="danger-text">配置已删除</span>}</td>
                          <td>
                            {!r ? <span className="soft">未运行</span> : (
                              <div className="col" style={{ gap: 4 }}>
                                <div className="row"><StatusBadge status={st!} /><span className="soft small num">{(r.created || "").slice(5, 16).replace("T", " ")}</span>{r.elapsed && <span className="soft small num">· {r.elapsed}s</span>}</div>
                                {(st === "running" || st === "queued") && <div className="row"><Progress value={j?.progress ?? 0} style={{ flex: 1 }} /><span className="soft small num">{Math.round((j?.progress ?? 0) * 100)}%</span></div>}
                                {st === "failed" && <div className="danger-text small ellipsis" title={r.error ?? j?.error}>{String(r.error ?? j?.error ?? "").split("\n")[0]}</div>}
                              </div>
                            )}
                          </td>
                          <td className="actions">
                            <IconBtn icon="play" title="运行该配置" onClick={() => start(exp, [it.config_id])} />
                            <IconBtn icon="graph-line" title="分析结果" disabled={r?.status !== "done"} onClick={() => analyze([r.id])} />
                            <IconBtn icon="output" title="查看日志" disabled={!r} onClick={() => setFile({ rid: r.id, name: "gotm.log" })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : exps.loading ? <Loading /> : <Empty icon="beaker" title="还没有实验" action={<Btn icon="add" onClick={() => setEdit({ name: "新实验", description: "", items: [] })}>新实验</Btn>} />}
      </Split>
      {edit && <ExpEditor exp={edit} configs={configs.data ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); exps.reload(); }} />}
      {file && <FileViewer pid={p.id} rid={file.rid} name={file.name} onClose={() => setFile(null)} />}
      {scan && <ScanModal configs={configs.data ?? []} onClose={() => setScan(false)} onCreated={(e) => { setScan(false); exps.reload(); configs.reload(); setSel(e.id); runs.reload(); }} />}
    </div>
  );
}

function ScanModal({ configs, onClose, onCreated }: { configs: any[]; onClose: () => void; onCreated: (e: any) => void }) {
  const { project, hosts, toast } = useApp();
  const [cid, setCid] = useState(configs.find((c) => c.spec.htl.kind !== "none")?.id ?? configs[0]?.id ?? "");
  const cfg = configs.find((c) => c.id === cid);
  const [pkey, setPkey] = useState("");
  const [path, setPath] = useState("");
  const [vals, setVals] = useState("");
  const [start, setStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const opts: { id: string; label: string; param: any; def?: number }[] = [];
  if (cfg) {
    opts.push({ id: "ltl.zoo", label: "浮游动物死亡率倍数（闭合项）", param: { kind: "ltl", key: "zoo_mortality_factor", label: "浮游动物死亡率倍数" }, def: cfg.spec.ltl.zoo_mortality_factor });
    const d = hosts?.htl_defaults?.[cfg.spec.host];
    if (cfg.spec.htl.kind === "e2e" && d) {
      const on: Record<string, boolean> = { MB: cfg.spec.htl.e2e.macrobenthos, F1: cfg.spec.htl.e2e.fish1, F2: cfg.spec.htl.e2e.fish2 };
      for (const g of ["MB", "F1", "F2"]) if (on[g]) for (const r of d[g].params) opts.push({ id: `e2e.${g}.${r.key}`, label: `${g} · ${r.label}（${r.key}）`, param: { kind: "e2e", group: g, key: r.key, label: `${g}.${r.key}` }, def: cfg.spec.htl.e2e.params?.[g]?.[r.key] ?? r.value });
    }
    if (cfg.spec.htl.kind === "mizer" && d) {
      for (const k of ["F", "w_minF", "gamma", "q", "alpha", "beta", "sigma", "R_relax", "z0pre"]) {
        const r = d.mizer.params.find((x: any) => x.key === k);
        if (r) opts.push({ id: `mizer.${k}`, label: `MIZER · ${k}`, param: { kind: "mizer", key: k, label: `MIZER.${k}` }, def: cfg.spec.htl.mizer.params?.[k] ?? r.value });
      }
    }
    opts.push({ id: "override", label: "任意 FABM 参数（路径）", param: { kind: "override", path, label: path.split("/").slice(-1)[0] || "参数" } });
  }
  const sel = opts.find((o) => o.id === pkey) ?? opts[0];
  const values = vals.split(/[,，\s]+/).map(Number).filter((x) => isFinite(x) && vals.trim() !== "");
  const suggest = (def?: number) => def === undefined ? "" : [0.5, 0.75, 1, 1.25, 1.5].map((f) => +(def * f).toPrecision(3)).join(", ");
  // pre-fill a sensible ±50 % sweep around the current value whenever the parameter changes
  useEffect(() => { setVals(suggest(sel?.def)); }, [cid, sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => {
    if (!sel || !values.length) return;
    setBusy(true);
    try {
      const param = sel.id === "override" ? { kind: "override", path, label: path.split("/").slice(-1)[0] } : sel.param;
      const e = await api.post(`/projects/${project!.id}/scan`, { config_id: cid, param, values, start });
      toast(start ? `已创建扫描并提交 ${values.length} 次运行` : "已创建扫描实验", "ok");
      onCreated(e);
    } catch (err: any) { toast(err.message, "bad"); } finally { setBusy(false); }
  };
  return (
    <Modal title="参数扫描" icon="settings" onClose={onClose} width={640} footer={<>
      <Btn onClick={onClose}>取消</Btn>
      <Btn variant="primary" icon={busy ? "loading" : "play"} spin={busy} disabled={busy || !values.length || (sel?.id === "override" && !path)} onClick={create}>{start ? `创建并运行 ${values.length} 次` : "创建"}</Btn>
    </>}>
      <div className="form" style={{ gridTemplateColumns: "100px minmax(0,1fr)" }}>
        <span className="label">基础配置</span>
        <span className="control"><Select value={cid} onChange={(v) => { setCid(v); setPkey(""); }}>{configs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></span>
        <span className="label">参数</span>
        <span className="control"><Select value={sel?.id ?? ""} onChange={(v) => { setPkey(v); setVals(""); }}>{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></span>
        {sel?.id === "override" && <><span className="label">FABM 路径</span><span className="control"><input className="input mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="instances/Z4/parameters/sd" /></span></>}
        {sel?.def !== undefined && <><span className="label">当前值</span><span className="control mono">{sel.def}</span></>}
        <span className="label">取值</span>
        <span className="control"><input className="input mono" value={vals} onChange={(e) => setVals(e.target.value)} placeholder={suggest(sel?.def) || "例如 0.2, 0.4, 0.6, 0.8"} />{sel?.def !== undefined && <Btn size="sm" onClick={() => setVals(suggest(sel.def))}>×0.5…1.5</Btn>}</span>
        <span /><span className="hint">每个取值生成一个配置并放进同一组实验；运行后在“结果分析 → 图版 → 参数扫描响应”查看指标随参数的变化。</span>
        <span /><span className="control"><Check checked={start} onChange={setStart}>创建后立即运行</Check></span>
      </div>
    </Modal>
  );
}

function AllRuns({ runs, jobFor, analyze, onFile, reload, pid }: { runs: any[]; jobFor: (id: string) => any; analyze: (ids: string[]) => void; onFile: (f: { rid: string; name: string }) => void; reload: () => void; pid: string }) {
  const [checked, setChecked] = useState<string[]>([]);
  return (
    <>
      <div className="toolbar">
        <b style={{ color: "var(--fg-strong)", fontSize: 14 }}>全部运行记录</b>
        <span className="soft small">{runs.length} 次</span>
        <span className="grow" />
        <Btn size="sm" icon="graph-line" disabled={!checked.length} onClick={() => analyze(checked)}>对比所选（{checked.length}）</Btn>
      </div>
      <div className="split-scroll">
        <table className="table">
          <thead><tr><th style={{ width: 34 }} /><th>标签</th><th>宿主 · 高营养级</th><th>状态</th><th>模拟时段</th><th className="num">耗时</th><th style={{ width: 210 }} /></tr></thead>
          <tbody>
            {runs.map((r) => {
              const j = jobFor(r.id);
              const st = j?.status ?? r.status;
              return (
                <tr key={r.id} className={checked.includes(r.id) ? "selected" : ""}>
                  <td><Check checked={checked.includes(r.id)} disabled={st !== "done"} onChange={(v) => setChecked(v ? [...checked, r.id] : checked.filter((x) => x !== r.id))} /></td>
                  <td><div className="strong" style={{ fontWeight: 500 }}>{r.label}</div><div className="sub mono">{r.id}</div></td>
                  <td className="small">{HOST_LABEL[r.spec?.host]} · {HTL_LABEL[r.spec?.htl?.kind]}</td>
                  <td><StatusBadge status={st} />{st === "running" && <Progress value={j?.progress ?? 0} style={{ marginTop: 4, width: 110 }} />}</td>
                  <td className="small num">{r.timing ? `${r.timing.start.slice(0, 4)}–${+r.timing.stop.slice(0, 4) - 1}` : "–"}{r.timing && <div className="sub">分析自 {r.timing.analysis_start.slice(0, 4)}</div>}</td>
                  <td className="num">{r.elapsed ? `${r.elapsed}s` : ""}</td>
                  <td className="actions">
                    <IconBtn icon="graph-line" title="分析" disabled={st !== "done"} onClick={() => analyze([r.id])} />
                    <IconBtn icon="output" title="GOTM 日志" onClick={() => onFile({ rid: r.id, name: "gotm.log" })} />
                    <IconBtn icon="file-code" title="fabm.yaml" onClick={() => onFile({ rid: r.id, name: "fabm.yaml" })} />
                    <IconBtn icon="settings" title="gotm.yaml" onClick={() => onFile({ rid: r.id, name: "gotm.yaml" })} />
                    <a className="icon-btn" title="下载 NetCDF" href={st === "done" ? `/api/projects/${pid}/runs/${r.id}/file/result.nc` : undefined} style={st === "done" ? undefined : { opacity: 0.35, pointerEvents: "none" }}><Icon name="cloud-download" /></a>
                    {(st === "running" || st === "queued") && j ? <IconBtn icon="debug-stop" title="停止" danger onClick={() => api.post(`/jobs/${j.id}/cancel`)} />
                      : <IconBtn icon="trash" title="删除" danger onClick={async () => { if (!(await ask("删除该运行及其输出文件？", { danger: true, ok: "删除" }))) return; try { await api.del(`/projects/${pid}/runs/${r.id}`); useApp.getState().toast("已删除运行", "ok"); } catch (e: any) { useApp.getState().toast(`删除失败：${e.message}`, "bad"); } reload(); }} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!runs.length && <Empty icon="history" title="还没有运行记录" />}
      </div>
    </>
  );
}

function ExpEditor({ exp, configs, onClose, onSaved }: { exp: any; configs: any[]; onClose: () => void; onSaved: () => void }) {
  const { project, toast } = useApp();
  const [e, setE] = useState<any>(structuredClone(exp));
  const idx = (id: string) => e.items.findIndex((i: any) => i.config_id === id);
  return (
    <Modal title={exp.id ? "编辑实验" : "新实验"} icon="beaker" onClose={onClose} width={640} footer={<>
      {exp.id && <Btn className="danger-text" icon="trash" onClick={async () => { if (await ask("删除该实验？运行记录会保留。", { danger: true, ok: "删除" })) { await api.del(`/projects/${project!.id}/experiments/${exp.id}`); onSaved(); } }}>删除</Btn>}
      <span className="grow" />
      <Btn onClick={onClose}>取消</Btn>
      <Btn variant="primary" icon="check" onClick={async () => { await api.post(`/projects/${project!.id}/experiments`, e); toast("实验已保存", "ok"); onSaved(); }}>保存</Btn>
    </>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="field"><label>名称</label><input className="input" value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} /></div>
        <div className="field"><label>说明</label><textarea className="input" rows={2} value={e.description} onChange={(x) => setE({ ...e, description: x.target.value })} /></div>
        <Notice kind="plain">勾选参与对比的配置。勾选顺序即对比顺序，第一个作为差值和百分比变化的基准。</Notice>
        <div className="panel" style={{ maxHeight: 320, overflow: "auto" }}>
          {configs.map((c) => (
            <div key={c.id} className="row" style={{ padding: "7px 12px", borderBottom: "1px solid var(--border)" }}>
              <Check checked={idx(c.id) >= 0} onChange={(v) => setE({ ...e, items: v ? [...e.items, { config_id: c.id, label: c.name }] : e.items.filter((i: any) => i.config_id !== c.id) })}>{c.name}</Check>
              <span className="grow" />
              <span className="soft small">{HOST_LABEL[c.spec.host]} · {HTL_LABEL[c.spec.htl.kind]}</span>
              {idx(c.id) >= 0 && <span className="badge solid">{idx(c.id) + 1}</span>}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function FileViewer({ pid, rid, name, onClose }: { pid: string; rid: string; name: string; onClose: () => void }) {
  const f = useAsync(() => api.get<string>(`/projects/${pid}/runs/${rid}/file/${name}`), [pid, rid, name]);
  return (
    <Modal title={`${name}`} icon="file-code" onClose={onClose} width={1040}>
      <div className="soft small mono" style={{ marginBottom: 8 }}>{rid}</div>
      <pre style={{ maxHeight: "68vh", overflow: "auto", background: "var(--bg-sunk)", border: "1px solid var(--border)", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap", margin: 0 }}>{f.loading ? "读取中…" : f.error ?? f.data}</pre>
    </Modal>
  );
}
