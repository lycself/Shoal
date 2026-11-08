import { useEffect, useRef, useState } from "react";
import { api, on } from "../api";
import { Markdown } from "./Markdown";
import { Btn, Icon, IconBtn, useAsync } from "./ui";
import { useApp } from "../store";

interface Item { kind: "user" | "bot" | "tool" | "err" | "proposal"; text?: string; proposal?: any }

const SUGGEST = [
  ["question", "单向耦合和双向耦合的区别是什么？为什么双向耦合会降低碳循环？"],
  ["graph-line", "比较当前选中的运行，总结浮游动物和鱼类的差异"],
  ["layers", "ECOSMO、ERSEM、ERGOM 三个宿主有什么不同？"],
  ["edit", "如果把鱼 1 的死亡率加倍会怎样？请给出修改提案"],
];
const TOOL_LABEL: Record<string, string> = {
  list_projects: "列出项目", get_project: "读取项目", get_config: "读取配置", host_info: "查询宿主参数", propose_config_change: "生成修改提案",
  run_configs: "启动模拟", list_runs: "列出运行", compare_runs: "比较运行", variable_stats: "统计变量", list_output_variables: "列出输出变量", primer_search: "检索入门教程",
};

export default function AssistantPanel() {
  const { toggleAssistant, setPage, assistantOpen } = useApp();
  // is an AI service configured? (re-read whenever the panel opens, e.g. after visiting Settings)
  const cfg = useAsync(() => api.get<any>("/settings"), [assistantOpen]);
  const a = cfg.data?.assistant ?? {};
  const ready = !cfg.data || a.has_key || /localhost|127\.0\.0\.1/.test(a.base_url ?? "");
  const timer = useRef<number | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [conv, setConv] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const convRef = useRef<string | null>(null);
  convRef.current = conv;

  useEffect(() => {
    const off = on("assistant", (e) => {
      if (e.conv !== convRef.current) return;
      if (e.type === "text") setItems((x) => [...x, { kind: "bot", text: e.text }]);
      if (e.type === "tool") setItems((x) => [...x, { kind: "tool", text: TOOL_LABEL[e.name] ?? e.name }]);
      if (e.type === "proposal") setItems((x) => [...x, { kind: "proposal", proposal: e.proposal }]);
      if (e.type === "error") { setItems((x) => [...x, { kind: "err", text: e.text }]); setBusy(false); clearTimeout(timer.current); }
      if (e.type === "done") { setBusy(false); clearTimeout(timer.current); }
    });
    const ask = (ev: Event) => send((ev as CustomEvent).detail);
    window.addEventListener("assistant-ask", ask);
    return () => { off(); window.removeEventListener("assistant-ask", ask); };
  }, []);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [items, busy]);

  async function send(msg: string) {
    if (!msg?.trim()) return;
    setItems((x) => [...x, { kind: "user", text: msg }]);
    setText("");
    setBusy(true);
    const st = useApp.getState();
    // the id is made here, before the request, so no reply event can arrive for a conversation we don't know yet
    const id = convRef.current ?? Math.random().toString(16).slice(2, 12);
    convRef.current = id; setConv(id);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setBusy(false); setItems((x) => [...x, { kind: "err", text: "等了 3 分钟还没有回复：AI 服务可能太慢或连接中断。可以再问一次，或到设置里测试连接。" }]); }, 180000);
    try {
      const r = await api.post("/assistant/chat", { conv: id, message: msg, context: { project_id: st.projectId, page: st.page, selected_run_ids: st.selectedRuns } });
      if (r.error) { setItems((x) => [...x, { kind: "err", text: r.error }]); setBusy(false); clearTimeout(timer.current); }
    } catch (e: any) { setItems((x) => [...x, { kind: "err", text: e.message }]); setBusy(false); clearTimeout(timer.current); }
  }

  return (
    <aside className="assist-pane">
      <div className="assist-head">
        <Icon name="sparkle" style={{ color: "var(--accent)" }} /><b className="grow" style={{ color: "var(--fg-strong)" }}>AI 助手</b>
        <IconBtn icon="add" title="新对话" size="sm" onClick={() => { setItems([]); setConv(null); }} />
        <IconBtn icon="close" title="关闭" size="sm" onClick={toggleAssistant} />
      </div>
      <div className="assist-log" ref={log}>
        {!items.length && !ready && (
          <div className="col" style={{ gap: 10 }}>
            <b style={{ color: "var(--fg-strong)" }}>先接上一个 AI 服务</b>
            <div className="muted small" style={{ lineHeight: 1.7 }}>助手需要一个大模型接口才能回答。到设置里填写接口地址、模型名和 API Key（OpenAI 兼容的服务都可以；本机运行的模型不需要 Key），保存后回到这里就能提问。</div>
            <div><Btn size="sm" icon="settings-gear" onClick={() => setPage("settings")}>去设置 AI 服务</Btn></div>
          </div>
        )}
        {!items.length && ready && (
          <div className="col" style={{ gap: 10 }}>
            <div className="muted small" style={{ lineHeight: 1.6 }}>我可以解释模型原理与方法来源、读取你的项目和结果、检索入门教程、启动模拟，并对配置提出修改建议（需你批准）。</div>
            {SUGGEST.map(([ic, s]) => <button key={s} className="suggest" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        {items.map((it, i) => it.kind === "proposal" ? <Proposal key={i} p={it.proposal} /> : (
          <div key={i} className={`msg ${it.kind}`}>
            {it.kind === "bot" ? <Markdown text={it.text!} /> : it.kind === "tool" ? <><Icon name="tools" />{it.text}</> : it.text}
          </div>
        ))}
        {busy && <div className="msg tool row"><Icon name="loading" spin /><span className="grow">思考中…</span><a className="small" onClick={() => { setBusy(false); clearTimeout(timer.current); }}>不等了</a></div>}
      </div>
      <div className="assist-input">
        <textarea className="input" value={text} disabled={!ready} placeholder={ready ? "提问（Enter 发送，Shift+Enter 换行）" : "配置 AI 服务后可以提问"} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} />
        <div className="row"><span className="soft small grow">上下文：当前项目与已选运行会一并发送</span><IconBtn icon="send" title="发送（Enter）" disabled={busy || !text.trim() || !ready} onClick={() => send(text)} /></div>
      </div>
    </aside>
  );
}

function Proposal({ p }: { p: any }) {
  const { toast, bump } = useApp();
  const [status, setStatus] = useState(p.status);
  const act = async (reject: boolean) => {
    const r = await api.post("/assistant/apply", { id: p.id, reject });
    setStatus(r.status);
    if (!reject) { toast("已应用到配置", "ok"); bump(); }
  };
  return (
    <div className="panel" style={{ borderColor: "var(--accent-line)" }}>
      <div className="panel-bar" style={{ background: "var(--accent-soft)" }}><Icon name="git-pull-request" style={{ color: "var(--accent)" }} /><b className="grow small">{p.new_name ? `另存为“${p.new_name}”` : `修改“${p.config_name}”`}</b></div>
      <div className="panel-pad col" style={{ gap: 8 }}>
        <div className="small">{p.reason}</div>
        <pre style={{ margin: 0, background: "var(--bg-sunk)", padding: 8, borderRadius: 6, fontSize: 11.5, overflow: "auto" }}>{JSON.stringify(p.spec_patch, null, 2)}</pre>
        {status === "pending" ? <div className="row"><Btn size="sm" icon="check" onClick={() => act(false)}>应用</Btn><Btn size="sm" icon="close" onClick={() => act(true)}>拒绝</Btn></div>
          : <span className={`badge ${status === "applied" ? "ok" : ""}`}>{status === "applied" ? "已应用" : "已拒绝"}</span>}
      </div>
    </div>
  );
}
