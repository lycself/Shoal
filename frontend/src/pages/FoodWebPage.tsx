import { Term } from "../components/Term";
import { ask } from "../dialog";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { FoodWebGraph } from "../components/FoodWebGraph";
import { Btn, Empty, Icon, IconBtn, Loading, Notice, Select, Seg, Split, Switch, Tabs, useAsync, HelpLink, PanelToggle } from "../components/ui";
import { HOST_LABEL, HTL_LABEL, useApp } from "../store";

const HTL_NAMES: Record<string, string> = { MB: "大型底栖动物 MB", F1: "鱼 1 · 浮游食性", F2: "鱼 2 · 底栖 / 鱼食性" };
const PREY_LABEL: Record<string, string> = { det: "碎屑", sed: "沉积有机物", dom: "溶解有机物", Pf: "鞭毛藻 / 小型浮游植物", Pd: "硅藻", Zs: "微型浮游动物", Zl: "中型浮游动物", MB: "大型底栖动物", F1: "鱼 1" };
const HTL_ICON: Record<string, string> = { none: "circle-large-outline", e2e: "organization", mizer: "graph-scatter" };

export default function FoodWebPage() {
  const { project } = useApp();
  const p = project!;
  const configs = useAsync(() => api.get<any[]>(`/projects/${p.id}/configs`), [p.id]);
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => { if (configs.data && (!sel || !configs.data.find((c) => c.id === sel))) setSel(configs.data[0]?.id ?? null); }, [configs.data]);
  const cur = configs.data?.find((c) => c.id === sel);
  const groups = useMemo(() => {
    const g: Record<string, any[]> = {};
    (configs.data ?? []).forEach((c) => (g[c.spec.host] ??= []).push(c));
    return g;
  }, [configs.data]);
  const add = async () => {
    if (!(await useApp.getState().confirmLeave())) return;
    const c = await api.post(`/projects/${p.id}/configs`, { name: "新配置", description: "", spec: { host: "ersem", htl: { kind: "none" } } });
    configs.reload(); setSel(c.id);
  };
  return (
    <div className="page fill">
      <div className="page-header">
        <div>
          <div className="row"><PanelToggle id="foodweb" label="配置列表" /><div className="page-title">食物网配置</div><HelpLink chapter="05-hosts" title="三个宿主与高营养级模块（教程）" /></div>
        </div>
      </div>
      <Split id="foodweb" label="配置列表" initial={270} side={
        <>
          <div className="tree-head">配置<span className="actions"><IconBtn icon="add" title="新配置" size="sm" onClick={add} /><IconBtn icon="refresh" title="刷新" size="sm" onClick={configs.reload} /></span></div>
          <div className="split-scroll">
            {configs.loading && !configs.data && <Loading />}
            {Object.entries(groups).map(([h, cs]) => (
              <div key={h}>
                <div className="tree-group" data-tip={open[h] === false ? "展开这一组" : "收起这一组"} onClick={() => setOpen({ ...open, [h]: open[h] === false })}>
                  <Icon name={open[h] === false ? "chevron-right" : "chevron-down"} />{HOST_LABEL[h]}<span className="soft" style={{ marginLeft: "auto", fontWeight: 500 }}>{cs.length}</span>
                </div>
                {open[h] !== false && cs.map((c) => (
                  <div key={c.id} className={`tree-item ${c.id === sel ? "active" : ""}`} onClick={async () => { if (c.id !== sel && await useApp.getState().confirmLeave()) setSel(c.id); }} title={c.description}>
                    <Icon name={HTL_ICON[c.spec.htl.kind]} />
                    <div className="grow">
                      <div className="ellipsis">{c.name}</div>
                      <div className="meta">{HTL_LABEL[c.spec.htl.kind]}{c.spec.htl.kind === "mizer" ? (c.spec.htl.mizer.feedback ? " · 双向" : " · 单向") : ""}{c.spec.ltl.zoo_mortality_factor !== 1 ? ` · 浮游动物死亡 ×${c.spec.ltl.zoo_mortality_factor}` : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      }>
        {cur ? <ConfigEditor key={cur.id} cfg={cur} onSaved={(c) => { configs.reload(); setSel(c.id); }} onDeleted={() => { configs.reload(); setSel(null); }} /> : <Empty icon="type-hierarchy" title="选择或新建一个配置" />}
      </Split>
    </div>
  );
}

function ConfigEditor({ cfg, onSaved, onDeleted }: { cfg: any; onSaved: (c: any) => void; onDeleted: () => void }) {
  const { project, hosts, toast, setPage } = useApp();
  const p = project!;
  const [c, setC] = useState<any>(cfg);
  const [dirty, setDirty] = useState(false);
  const markDirty = useApp((s) => s.setDirty);
  useEffect(() => { markDirty("foodweb", dirty ? `配置“${c.name}”` : null); return () => markDirty("foodweb", null); }, [dirty, c.name]);
  const [graph, setGraph] = useState<any>(null);
  const [yaml, setYaml] = useState<string | null>(null);
  const [tab, setTab] = useState<"graph" | "comp" | "params" | "yaml">("graph");
  const [nodeSel, setNodeSel] = useState<string | null>(null);
  const spec = c.spec;
  const upd = (fn: (s: any) => void) => { const s = structuredClone(c.spec); fn(s); setC({ ...c, spec: s }); setDirty(true); };
  useEffect(() => {
    let alive = true;
    api.post("/foodweb", spec).then((g) => alive && setGraph(g)).catch((e) => toast(e.message, "bad"));
    if (tab === "yaml") api.post<string>("/fabm_yaml", spec).then((y) => alive && setYaml(y));
    return () => { alive = false; };
  }, [JSON.stringify(spec), tab]);
  const engine: string = spec.htl.e2e?.engine ?? hosts?.e2e_engines?.default ?? "reimplementation";
  const defaults = hosts?.htl_defaults_by_engine?.[engine]?.[spec.host] ?? hosts?.htl_defaults?.[spec.host];
  const hostInfo = hosts?.hosts?.find((h: any) => h.id === spec.host);
  const save = async (asNew = false) => {
    try {
      const body = asNew ? { ...c, id: undefined, name: c.name + "（副本）", created: undefined } : c;
      const saved = await api.post(`/projects/${p.id}/configs`, body);
      setDirty(false); toast(asNew ? "已另存为新配置" : "配置已保存", "ok"); onSaved(saved);
    } catch (e: any) { toast(e.message, "bad"); }
  };
  const run = async () => {
    if (dirty) await save();
    // a single run belongs to no experiment: show it in the full run list, where it actually appears
    try {
      await api.post(`/projects/${p.id}/runs`, { items: [{ config_id: c.id, label: c.name }] });
      toast(`“${c.name}”已加入运行队列`, "ok", { label: "查看运行", onClick: () => { setPage("experiments"); setTimeout(() => window.dispatchEvent(new CustomEvent("experiments-select", { detail: "__all__" })), 60); } });
    }
    catch (e: any) { toast(e.message, "bad"); }
  };
  return (
    <>
      <div className="toolbar">
        <input className="input" style={{ width: 320, fontWeight: 600 }} value={c.name} onChange={(e) => { setC({ ...c, name: e.target.value }); setDirty(true); }} />
        {dirty && <span className="badge warn">未保存</span>}
        <div className="divider" />
        <Btn variant="primary" size="sm" icon="save" disabled={!dirty} onClick={() => save()}>保存</Btn>
        <Btn size="sm" icon="copy" onClick={() => save(true)}>另存为</Btn>
        <Btn size="sm" icon="play" onClick={run}>运行</Btn>
        <span className="grow" />
        <span className="soft small">{HOST_LABEL[spec.host]} · {HTL_LABEL[spec.htl.kind]}</span>
        <IconBtn icon="trash" title="删除配置" danger onClick={async () => {
          const exps = await api.get<any[]>(`/projects/${p.id}/experiments`).catch(() => []);
          const used = exps.filter((e: any) => e.items?.some((it: any) => it.config_id === c.id)).map((e: any) => `“${e.name}”`);
          if (!(await ask(used.length ? `配置“${c.name}”被实验 ${used.join("、")} 使用。删除后这些实验里会少一项（已有运行结果保留）。确定删除吗？` : `删除配置“${c.name}”？已有运行结果保留。`, { danger: true, ok: "删除" }))) return;
          try { await api.del(`/projects/${p.id}/configs/${c.id}`); setDirty(false); toast("已删除配置", "ok"); onDeleted(); } catch (e: any) { toast(`删除失败：${e.message}`, "bad"); }
        }} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "graph", label: "食物网", icon: "type-hierarchy" },
        { id: "comp", label: "组成", icon: "settings" },
        { id: "params", label: "高营养级参数", icon: "symbol-parameter" },
        { id: "yaml", label: "fabm.yaml", icon: "file-code" },
      ]} />
      <div className="split-scroll" style={tab === "graph" ? { padding: 0 } : { padding: "18px 22px" }}>
        {tab === "graph" && (graph ? (
          <div className="fw-fill">
            <FoodWebGraph graph={graph} onSelect={setNodeSel} selected={nodeSel} />
            {nodeSel && <NodeInfo graph={graph} id={nodeSel} />}
          </div>
        ) : <Loading />)}
        {tab === "comp" && (
          <div style={{ maxWidth: 820 }}>
            <div className="section">
              <div className="form">
                <span className="label">说明</span>
                <span className="control"><textarea className="input" rows={2} value={c.description ?? ""} onChange={(e) => { setC({ ...c, description: e.target.value }); setDirty(true); }} /></span>
                {c.origin && <><span className="label">来源</span><span className="control soft small">{c.origin}</span></>}
                <span className="label">低营养级模型（<Term k="宿主" />）</span>
                <span className="control">
                  <Select value={spec.host} onChange={(v) => upd((s) => { s.host = v; if (v !== "ersem" && s.htl.kind === "mizer") s.htl.kind = "none"; })}>
                    {hosts?.hosts?.map((h: any) => <option key={h.id} value={h.id}>{h.label}</option>)}
                  </Select>
                </span>
                <span />
                <span className="hint">{hostInfo?.description}（{hostInfo?.reference}）</span>
                <span className="label">高营养级</span>
                <span className="control">
                  <Seg value={spec.htl.kind} onChange={(v: string) => upd((s) => { s.htl.kind = v; })} options={[["none", "无"], ["e2e", "E2E 功能群", "organization"], ...(hostInfo?.supports_mizer ? [["mizer", "MIZER 粒径谱", "graph-scatter"]] : []) as any]} />
                </span>
                {spec.htl.kind === "e2e" && (
                  <>
                    <span className="label top">E2E 功能群</span>
                    <span className="control col" style={{ alignItems: "flex-start", gap: 8 }}>
                      {(["macrobenthos", "fish1", "fish2"] as const).map((k) => (
                        <Switch key={k} on={spec.htl.e2e[k]} onChange={(v) => upd((s) => { s.htl.e2e[k] = v; })} label={{ macrobenthos: "大型底栖动物（底层，摄食碎屑、沉积物与浮游生物）", fish1: "鱼 1 · 浮游食性（摄食浮游动物）", fish2: "鱼 2 · 底栖 / 鱼食性（摄食鱼 1 与底栖动物）" }[k]} />
                      ))}
                    </span>
                    <span className="label">计算代码</span>
                    <span className="control">
                      <Seg value={engine} onChange={(v: string) => upd((s) => { s.htl.e2e.engine = v; })}
                        options={[...(hosts?.e2e_engines?.official_available ? [["official", "官方代码", "verified"]] : []), ["reimplementation", "按论文方程重写", "beaker"]] as any} />
                    </span>
                    <span /><span className="hint">{engine === "official"
                      ? "ECOSMO E2E v2.0 作者发布的 Fortran 代码，参数取自其发布的算例。鱼是随深度分布的浓度，跟着饵料走。"
                      : hosts?.e2e_engines?.official_available
                        ? "本软件按论文方程自己写的版本，只用于和官方代码对照：结果与官方代码有明显差别（见教程第 12 章）。"
                        : "内核里没有官方代码，只能用本软件按论文方程重写的版本。重新编译内核（pnpm kernel）就会把官方代码一起编进去。"}</span>
                    {engine === "official" && (
                      <>
                        <span className="label">物质收支</span>
                        <span className="control">
                          {hosts?.e2e_engines?.corrections_available
                            ? <Seg value={spec.htl.e2e.corrected ? "fixed" : "orig"} onChange={(v: string) => upd((s) => { s.htl.e2e.corrected = v === "fixed"; })}
                                options={[["orig", "原样（论文所用代码）"], ["fixed", "修正版（收支闭合）", "check"]] as any} />
                            : <span className="soft">内核编译于修正补丁之前，重新运行 pnpm kernel 后可选修正版</span>}
                        </span>
                        <span /><span className="hint">{spec.htl.e2e.corrected
                          ? "改正官方代码里 5 处让物质凭空消失、凭空产生或方向弄反的地方（见教程第 7 章），其余公式和参数不变。鱼和底栖动物不再让宿主里的元素凭空增减，鱼呼吸消耗氧气。第一年结果与论文几乎相同，多年后硅酸盐和硅藻明显更多。"
                          : "逐行运行作者发布的代码，ERSEM 宿主下能重现论文的参考结果。但代码里鱼的一部分粪便和尸体凭空消失，呼吸放出的碳不回到水里，鱼呼吸反而产生氧气，硅被不断扣掉（多年后硅酸盐减半）。研究物质循环或浮游植物时请选修正版。"}</span>
                      </>
                    )}
                  </>
                )}
                {spec.htl.kind === "mizer" && (
                  <>
                    <span className="label">鱼会不会影响食物</span>
                    <span className="control"><Seg value={spec.htl.mizer.feedback ? "two" : "one"} options={[["two", "双向（有反馈）"], ["one", "单向（无反馈 / 离线）"]]} onChange={(v) => upd((s) => { s.htl.mizer.feedback = v === "two"; })} /></span>
                    <span /><span className="hint"><Term k="单向耦合">单向</Term>：鱼照常吃、照常长，但吃掉的不从浮游生物里扣，粪便和排泄也不回到水里。<Term k="双向耦合">双向</Term>：鱼和它的食物互相影响，更接近真实情况。</span>
                  </>
                )}
              </div>
            </div>
            <div className="section">
              <div className="section-header"><Icon name="symbol-misc" /><h3>浮游动物的额外死亡（<Term k="闭合项" />）</h3></div>
              <div className="form">
                <span className="label">浮游动物死亡率</span>
                <span className="control"><input className="input num" style={{ maxWidth: 120 }} type="number" step="0.05" value={spec.ltl.zoo_mortality_factor} onChange={(e) => upd((s) => { s.ltl.zoo_mortality_factor = +e.target.value; })} /><span className="unit">× 宿主默认值</span></span>
                <span /><span className="hint">“浮游动物死亡率 +20%”对照用 1.2；ECOSMO 耦合鱼类时默认 0.8（Vijayakumaran 等 2026）。</span>
                {spec.host === "ersem" && (
                  <>
                    <span className="label top">ERSEM Z4</span>
                    <span className="control col" style={{ alignItems: "flex-start", gap: 8 }}>
                      <Switch on={spec.ltl.z4_cannibalism} onChange={(v) => upd((s) => { s.ltl.z4_cannibalism = v; })} label="中型浮游动物种内捕食（闭合项）" />
                      <Switch on={spec.ltl.z4_basal_mortality} onChange={(v) => upd((s) => { s.ltl.z4_basal_mortality = v; })} label="Z4 基础死亡与越冬死亡" />
                      <span className="hint">双向耦合 MIZER 时通常关闭这两项，由显式的鱼类捕食取代（Powley 等 2026）。</span>
                    </span>
                  </>
                )}
              </div>
            </div>
            <Overrides spec={spec} upd={upd} />
          </div>
        )}
        {tab === "params" && (spec.htl.kind === "none" ? <Empty icon="circle-large-outline" title="没有高营养级模块">这个配置里没有鱼。模型用一个额外的浮游动物死亡率代替没有画出来的捕食者。想加入鱼，到“组成”页添加功能群（E2E）或粒径谱（MIZER）。</Empty>
          : spec.htl.kind === "e2e" ? <E2EParams spec={spec} defaults={defaults} upd={upd} /> : <MizerParams spec={spec} defaults={defaults} upd={upd} />)}
        {tab === "yaml" && <pre style={{ margin: 0, padding: 14, background: "var(--bg-sunk)", borderRadius: 8, border: "1px solid var(--border)", overflow: "auto" }}>{yaml ?? "生成中…"}</pre>}
      </div>
    </>
  );
}

function NodeInfo({ graph, id }: { graph: any; id: string }) {
  const n = graph.nodes.find((x: any) => x.id === id);
  const lab = (i: string) => graph.nodes.find((x: any) => x.id === i)?.label ?? i;
  const ins = graph.edges.filter((e: any) => e.to === id && e.kind !== "uptake");
  const outs = graph.edges.filter((e: any) => e.from === id && e.kind !== "uptake");
  if (!n) return null;
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "12px 18px", display: "grid", gridTemplateColumns: "220px 1fr 1fr", gap: 18 }}>
      <div><b style={{ color: "var(--fg-strong)" }}>{n.label}</b><div className="soft small mono">{n.var}</div></div>
      <div><div className="eyebrow" style={{ marginBottom: 4 }}>食物来源</div>{ins.length ? ins.map((e: any) => <div key={e.from} className="small">{lab(e.from)} <span className="soft">偏好 {e.w}{e.sigma ? ` · σ ${e.sigma} d⁻¹` : ""}</span></div>) : <span className="soft small">–</span>}</div>
      <div><div className="eyebrow" style={{ marginBottom: 4 }}>被谁摄食 / 去向</div>{outs.length ? outs.map((e: any) => <div key={e.to} className="small">{lab(e.to)} <span className="soft">{e.kind === "waste" ? "废物流" : `偏好 ${e.w}`}</span></div>) : <span className="soft small">–</span>}</div>
    </div>
  );
}

function ParamInput({ value, def, onChange }: { value: number | undefined; def: number; onChange: (v: number | undefined) => void }) {
  const changed = value !== undefined && value !== def;
  return (
    <span className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
      <input className="input sm num" style={{ width: 96, fontWeight: changed ? 700 : 400, borderColor: changed ? "var(--accent)" : undefined }} type="number" step="any" value={value ?? def}
        onChange={(e) => onChange(e.target.value === "" || +e.target.value === def ? undefined : +e.target.value)} />
      {changed ? <IconBtn icon="discard" title={`恢复默认 ${def}`} size="sm" onClick={() => onChange(undefined)} /> : <span style={{ width: 24 }} />}
    </span>
  );
}

function E2EParams({ spec, defaults, upd }: { spec: any; defaults: any; upd: (fn: (s: any) => void) => void }) {
  if (!defaults) return <Loading />;
  const enabled: Record<string, boolean> = { MB: spec.htl.e2e.macrobenthos, F1: spec.htl.e2e.fish1, F2: spec.htl.e2e.fish2 };
  return (
    <div className="col" style={{ gap: 22, maxWidth: 1100 }}>
      {defaults.engine === "official"
        ? <Notice kind="plain">默认值取自官方 ECOSMO E2E v2.0 发布的 {HOST_LABEL[spec.host]} 算例。半饱和常数（摄食达到最大值一半时的食物量）按氮计，代码内部乘 79.6 换算成碳。鱼的半饱和常数和整个水柱的食物总量比较，单位是每平方米（mmol N m⁻²），论文表和代码注释里写的“每立方米”是标注错误，计算本身没有问题；大型底栖动物的和海底最底层的浓度比较（mmol N m⁻³）。修改过的值以蓝框和粗体显示。</Notice>
        : <Notice kind="plain">默认值按 {HOST_LABEL[spec.host]} 宿主取值。这个重写版本里，半饱和常数按碳计（mmol C m⁻³），和水柱平均的食物浓度比较，与官方代码的单位不同。θ 与 γ<sub>MB</sub> 文献未给出，为本软件的默认值；修改过的值以蓝框和粗体显示。<span className="soft">（参数来源：Vijayakumaran 等 2026，表 1–3）</span></Notice>}
      {(["MB", "F1", "F2"] as const).filter((k) => enabled[k]).map((k) => {
        const user = spec.htl.e2e.params?.[k] ?? {};
        const set = (key: string, v: number | undefined) => upd((s) => { s.htl.e2e.params ??= {}; s.htl.e2e.params[k] ??= {}; if (v === undefined) delete s.htl.e2e.params[k][key]; else s.htl.e2e.params[k][key] = v; });
        return (
          <div key={k}>
            <div className="section-header"><Icon name={k === "MB" ? "layers" : "symbol-event"} /><h3>{HTL_NAMES[k]}</h3></div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16 }}>
              <div className="panel" style={{ overflow: "hidden" }}>
                <table className="table">
                  <thead><tr><th>参数</th><th>含义</th><th className="num">值</th><th>单位</th></tr></thead>
                  <tbody>{defaults[k].params.map((r: any) => (
                    <tr key={r.key}><td className="mono" data-tip={r.official ? `官方代码里的参数名：${r.official}` : undefined}>{r.official ?? r.key}</td><td>{r.label}</td><td><ParamInput value={user[r.key]} def={r.value} onChange={(v) => set(r.key, v)} /></td><td className="soft small">{r.unit}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="panel" style={{ overflow: "hidden" }}>
                <table className="table">
                  <thead><tr><th>饵料</th><th className="num">摄食率 σ (d⁻¹)</th><th className="num">偏好 a</th></tr></thead>
                  <tbody>{defaults[k].prey.map((r: any) => (
                    <tr key={r.key}><td>{PREY_LABEL[r.key] ?? r.key}</td><td className="num">{r.sigma}</td><td className="num"><span className="row" style={{ justifyContent: "flex-end" }}><span style={{ width: 50, height: 5, borderRadius: 3, background: "var(--bg-sunk)", position: "relative" }}><span style={{ position: "absolute", inset: 0, width: `${r.a * 100}%`, background: "var(--eco-fish)", borderRadius: 3 }} /></span>{r.a}</span></td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}
      <div className="hint">饵料的摄食率与偏好可在“组成 → 高级参数覆盖”中按 FABM 参数名修改，例如 {defaults.engine === "official"
        ? <><code>instances/F1/parameters/Gr2</code>、<code>pref2</code>（编号见 fabm.yaml）。</>
        : <><code>instances/F1/parameters/prey3_a</code>（编号见 fabm.yaml）。</>}</div>
    </div>
  );
}

const MIZER_DOC: Record<string, [string, string]> = {
  gamma: ["体积搜索率前因子 γ", "m³ yr⁻¹ g⁻q"], q: ["搜索率质量指数 q", "–"], beta: ["最佳捕食者/饵料质量比 β", "–"], sigma: ["饵料偏好宽度 σ", "ln 单位"],
  alpha: ["同化效率 α", "–"], alpha_eg: ["排遗比例", "–"], z0pre: ["背景死亡率前因子", "yr⁻¹"], z0exp: ["背景死亡率指数", "–"], w_s: ["衰老死亡起始质量", "g"],
  z_s: ["衰老死亡指数", "–"], z_spre: ["衰老死亡前因子", "yr⁻¹"], R_relax: ["补充量松弛速率", "d⁻¹"], F: ["捕捞死亡率 F", "yr⁻¹"], w_minF: ["可捕最小质量 w_f", "g"],
  fishing_type: ["捕捞方式（1 = 刀刃）", ""], T_ref: ["参考温度", "°C"], E_a: ["活化能", "eV"], w_min: ["卵质量", "g"], w_inf: ["最大粒径级", "g"], nclass: ["粒径级数", ""],
  h: ["最大摄食率前因子", "yr⁻¹ g⁻ⁿ"], ks: ["标准代谢前因子", "yr⁻¹"], SRR: ["补充方式（3 = 浮游生物谱外推）", ""], T_dependence: ["温度依赖（1 = Arrhenius）", ""], z0_type: ["背景死亡类型", ""],
};

function MizerParams({ spec, defaults, upd }: { spec: any; defaults: any; upd: (fn: (s: any) => void) => void }) {
  const user = spec.htl.mizer.params ?? {};
  return (
    <div className="col" style={{ gap: 14, maxWidth: 900 }}>
      <Notice kind="plain">默认值来自 Powley et al. (2026) 表 S1。γ、q 依据 Acuña et al. (2011) 重新拟合；原 Blanchard (2009) 的 γ = 640、q = 0.82 会使双向耦合时中型浮游动物崩溃。</Notice>
      <div className="panel" style={{ overflow: "hidden" }}>
        <table className="table">
          <thead><tr><th>参数</th><th>含义</th><th className="num">值</th><th>单位</th></tr></thead>
          <tbody>{defaults?.mizer?.params.map((r: any) => (
            <tr key={r.key}><td className="mono">{r.key}</td><td>{MIZER_DOC[r.key]?.[0] ?? ""}</td>
              <td><ParamInput value={user[r.key]} def={r.value} onChange={(v) => upd((s) => { s.htl.mizer.params ??= {}; if (v === undefined) delete s.htl.mizer.params[r.key]; else s.htl.mizer.params[r.key] = v; })} /></td>
              <td className="soft small">{MIZER_DOC[r.key]?.[1]}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function Overrides({ spec, upd }: { spec: any; upd: (fn: (s: any) => void) => void }) {
  const [path, setPath] = useState("");
  const [val, setVal] = useState("");
  const list = spec.overrides ?? [];
  return (
    <div className="section">
      <div className="section-header"><Icon name="json" /><h3>高级参数覆盖</h3></div>
      <div className="section-desc">高级用法：按路径改写模型设置文件 fabm.yaml 里的任何一个参数，例如 <code>instances/P1/parameters/sum</code>（硅藻的最大生长率）。不确定时不要改。</div>
      <div className="panel" style={{ overflow: "hidden" }}>
        <table className="table">
          <thead><tr><th>路径</th><th className="num">值</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {list.map((o: any, i: number) => (
              <tr key={i}><td className="mono">{o.path}</td><td className="num strong">{String(o.value)}</td><td><IconBtn icon="close" title="移除" size="sm" onClick={() => upd((s) => { s.overrides.splice(i, 1); })} /></td></tr>
            ))}
            <tr>
              <td><input className="input sm mono" style={{ width: "100%" }} placeholder="instances/Z4/parameters/sd" value={path} onChange={(e) => setPath(e.target.value)} /></td>
              <td><input className="input sm num" style={{ width: 110 }} placeholder="值" value={val} onChange={(e) => setVal(e.target.value)} /></td>
              <td><IconBtn icon="add" title="添加" size="sm" disabled={!path} onClick={() => { const v = val === "true" ? true : val === "false" ? false : isNaN(+val) ? val : +val; upd((s) => { s.overrides = [...(s.overrides ?? []), { path, value: v }]; }); setPath(""); setVal(""); }} /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
