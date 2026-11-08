import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { Btn, Check, Icon, Loading, Notice, Seg, useAsync } from "../components/ui";
import { useApp } from "../store";
import { UpdateSection } from "../components/AppUpdate";

export default function SettingsPage() {
  const { toast, kernel, theme, setTheme, setDirty } = useApp();
  const s = useAsync(() => api.get("/settings"), []);
  const [form, setForm] = useState<any>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState<string>("");
  useEffect(() => { if (s.data) { setForm(structuredClone(s.data)); setSaved(JSON.stringify(s.data)); } }, [s.data]);
  const dirty = !!form && JSON.stringify(form) !== saved;
  useEffect(() => { setDirty("settings", dirty ? "设置页" : null); return () => setDirty("settings", null); }, [dirty]);
  if (!form) return <Loading />;
  const a = form.assistant;
  const setA = (k: string, v: any) => setForm({ ...form, assistant: { ...a, [k]: v } });
  const save = async () => { const r = await api.put("/settings", form); setForm(structuredClone(r)); setSaved(JSON.stringify(r)); toast("设置已保存（并行数在重启后端后生效）", "ok"); };
  const sys = kernel?.system, k = kernel?.kernel;
  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="page-header">
        <div><div className="page-title">设置</div><div className="page-hint">保存在工作区的 settings.json。主题切换立即生效，其他设置点“保存”后生效。</div></div>
        <div className="page-actions">{dirty && <span className="warn-text small">有未保存的修改</span>}<Btn variant={dirty ? "primary" : undefined} icon="save" disabled={!dirty} onClick={save}>保存</Btn></div>
      </div>

      <div className="section">
        <div className="section-header"><Icon name="color-mode" /><h3>外观</h3></div>
        <div className="form">
          <span className="label">主题</span>
          <span className="control"><Seg value={theme} onChange={setTheme as any} options={[["light", "浅色"], ["dark", "深色"], ["auto", "跟随系统"]]} /></span>
        </div>
      </div>

      <div className="section">
        <div className="section-header"><Icon name="server-process" /><h3>计算</h3></div>
        <div className="form">
          <span className="label">并行 GOTM 进程</span>
          <span className="control"><input className="input num" style={{ maxWidth: 100 }} type="number" min={1} max={sys?.cpu_logical ?? 16} value={form.max_parallel_runs} onChange={(e) => setForm({ ...form, max_parallel_runs: +e.target.value })} /><span className="unit">个</span></span>
          {sys && <><span /><span className="hint">本机 {sys.platform}，{sys.cpu_physical} 物理核 / {sys.cpu_logical} 逻辑核，内存 {sys.memory_total_gb} GB，磁盘剩余 {sys.disk_free_gb} GB。建议不超过物理核数。</span></>}
        </div>
      </div>

      <div className="section">
        <div className="section-header"><Icon name="sparkle" /><h3>AI 助手</h3></div>
        <div className="section-desc">支持任何 OpenAI 兼容接口（OpenAI、DeepSeek、通义千问、Moonshot、本地 Ollama / LM Studio 等）。助手可以读取项目与结果、检索入门教程、启动模拟；修改配置只生成提案，需要你批准。</div>
        <div className="form">
          <span className="label">接口地址</span>
          <span className="control"><input className="input mono" value={a.base_url} onChange={(e) => setA("base_url", e.target.value)} placeholder="https://api.openai.com/v1 · http://localhost:11434/v1" /></span>
          <span className="label">模型</span>
          <span className="control"><input className="input mono" value={a.model} onChange={(e) => setA("model", e.target.value)} placeholder="gpt-4o-mini · deepseek-chat · qwen2.5" /></span>
          <span className="label">API Key</span>
          <span className="control"><input className="input mono" type="password" value={a.api_key ?? ""} onChange={(e) => setA("api_key", e.target.value)} placeholder={a.has_key ? "已保存（留空保持不变）" : "本地模型可留空"} />{a.has_key && <span className="badge ok"><Icon name="pass" />已保存</span>}</span>
          <span className="label">配置修改</span>
          <span className="control"><Check checked={!!a.auto_apply} onChange={(v) => setA("auto_apply", v)}>自动应用助手提出的配置修改（不推荐）</Check></span>
          <span />
          <span className="control">
            <Btn size="sm" icon={testing ? "loading" : "plug"} spin={testing} onClick={async () => { setTesting(true); const r = await api.post("/assistant/test", { base_url: a.base_url, model: a.model, api_key: a.api_key || undefined }); setTesting(false); setTest(r.ok ? { ok: true, text: `连接成功：${r.reply}` } : { ok: false, text: r.error }); }}>测试连接</Btn>
          </span>
          {test && <><span /><Notice kind={test.ok ? "info" : "danger"} icon={test.ok ? "pass" : "error"}>{test.text}</Notice></>}
        </div>
      </div>

      <UpdateSection />

      <div className="section">
        <div className="section-header"><Icon name="package" /><h3>计算内核</h3></div>
        {k && (
          <div className="panel panel-pad">
            <div className="kv">
              {[["GOTM", k.gotm], ["FABM", k.fabm], ["ERSEM", k.ersem], ["FABM-MIZER", k.mizer], ["E2E 模块", k.e2e?.source === "official" ? (k.e2e?.corrections ? "官方 ECOSMO E2E v2.0 + 可选修正补丁" : "官方 ECOSMO E2E v2.0（编译于修正补丁之前）") + "；另含按论文方程重写的对照版本" : "按论文方程重写（未编入官方代码）"], ["可执行文件", k.gotm_path], ["pyfabm", k.pyfabm_available ? "可用" : "不可用"], ["编译时间", k.built ? new Date(k.built).toLocaleString() : "–"]].map(([a1, b]) => (
                <Fragment key={String(a1)}><span className="k">{a1}</span><span className="v mono">{b ?? "–"}</span></Fragment>
              ))}
            </div>
          </div>
        )}
        <div className="hint" style={{ marginTop: 8 }}>重新编译：<code>pnpm kernel</code>。官方 ECOSMO E2E v2.0 源码随软件提供（<code>kernel/vendor/ecosmo-e2e</code>，CC BY 4.0），和按论文方程重写的版本一起编进内核。</div>
      </div>
    </div>
  );
}
