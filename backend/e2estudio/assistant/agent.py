"""AI assistant: OpenAI-compatible chat completions with tools over the project store.

The assistant can read projects, configurations and results, search the primer,
start simulations, and *propose* configuration changes. Proposals are never
written by the assistant itself: the UI shows them and the user applies them
(unless auto-apply is enabled in settings).
"""
from __future__ import annotations

import copy
import json
import re
import threading
import traceback
import uuid
from pathlib import Path

from .. import events, projects, results
from ..config import REPO, load_settings
from ..ecosystem import builder
from ..ecosystem.hosts import HOSTS, host_summary

PRIMER_DIR = REPO / "frontend" / "src" / "primer" / "content"
CONVERSATIONS: dict[str, list[dict]] = {}
PROPOSALS: dict[str, dict] = {}

SYSTEM = """你是 E2E Studio 的科研助手，帮助学生和同行理解并使用海洋端到端（end-to-end）生态模型。
软件的计算内核是 GOTM（一维水柱湍流模型）+ FABM（生态模块耦合框架），生态模块包括：
- 低营养级宿主：ERSEM、ECOSMO、ERGOM；
- 高营养级：FABM-MIZER 群落粒径谱鱼类（Powley et al. 2026, Prog. Oceanogr., 双向耦合 ERSEM–MIZER，对比单向/离线耦合）；
  ECOSMO E2E v2.0 的鱼类与大型底栖功能群（Vijayakumaran et al. 2026, EGUsphere，同一模块接入三个宿主，五组实验）。
  注意：E2E 模块目前是按已发表方程实现的版本（不是官方代码），参数 θ 等文献未给出的值是本软件的默认假设。
- 三维：陆架尺度“水柱集合”（每个网格点一个 GOTM 水柱，无水平输运）。
回答要求：用中文；先给结论再解释物理/生态机制；引用数值时说明来自哪个运行和时间窗口；不确定时直说。
需要修改配置时调用 propose_config_change 生成提案，由用户批准；不要声称已修改。"""

TOOLS = [
    {"type": "function", "function": {"name": "list_projects", "description": "列出所有项目", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_project", "description": "项目详情：站点、模拟设置、生态配置列表、实验与运行",
                                      "parameters": {"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}}},
    {"type": "function", "function": {"name": "get_config", "description": "读取一个生态配置的完整 spec（宿主、高营养级模块、参数覆盖）",
                                      "parameters": {"type": "object", "properties": {"project_id": {"type": "string"}, "config_id": {"type": "string"}}, "required": ["project_id", "config_id"]}}},
    {"type": "function", "function": {"name": "host_info", "description": "低营养级宿主及高营养级模块的默认参数（文献表格值）",
                                      "parameters": {"type": "object", "properties": {"host": {"type": "string", "enum": list(HOSTS)}}, "required": ["host"]}}},
    {"type": "function", "function": {"name": "propose_config_change", "description": "提出对生态配置的修改（深度合并到 spec），可另存为新配置。用户批准后才生效。",
                                      "parameters": {"type": "object", "properties": {
                                          "project_id": {"type": "string"}, "config_id": {"type": "string"},
                                          "spec_patch": {"type": "object", "description": "例如 {\"htl\": {\"e2e\": {\"params\": {\"F1\": {\"m\": 0.002}}}}} 或 {\"ltl\": {\"zoo_mortality_factor\": 1.2}}"},
                                          "new_name": {"type": "string", "description": "若给出则另存为新配置"},
                                          "reason": {"type": "string"}},
                                          "required": ["project_id", "config_id", "spec_patch", "reason"]}}},
    {"type": "function", "function": {"name": "run_configs", "description": "用项目的站点与模拟设置运行若干配置（每个配置一次 GOTM 运行）",
                                      "parameters": {"type": "object", "properties": {"project_id": {"type": "string"}, "config_ids": {"type": "array", "items": {"type": "string"}}}, "required": ["project_id", "config_ids"]}}},
    {"type": "function", "function": {"name": "list_runs", "description": "项目的运行记录（状态、配置、耗时）",
                                      "parameters": {"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}}},
    {"type": "function", "function": {"name": "compare_runs", "description": "比较若干运行在分析时段内的年均指标（浮游植物/动物、鱼类、底栖、NPP、CO2 通量等）及相对第一个运行的百分比变化",
                                      "parameters": {"type": "object", "properties": {"project_id": {"type": "string"}, "run_ids": {"type": "array", "items": {"type": "string"}}}, "required": ["project_id", "run_ids"]}}},
    {"type": "function", "function": {"name": "variable_stats", "description": "某变量的年循环统计（深度积分/表层/底层/平均），用于描述季节变化",
                                      "parameters": {"type": "object", "properties": {"project_id": {"type": "string"}, "run_id": {"type": "string"}, "var": {"type": "string"},
                                                                                      "mode": {"type": "string", "enum": ["integral", "surface", "bottom", "mean"]}}, "required": ["project_id", "run_id", "var"]}}},
    {"type": "function", "function": {"name": "list_output_variables", "description": "运行输出中可用的变量（按类别）",
                                      "parameters": {"type": "object", "properties": {"project_id": {"type": "string"}, "run_id": {"type": "string"}}, "required": ["project_id", "run_id"]}}},
    {"type": "function", "function": {"name": "primer_search", "description": "在“入门教程”章节中检索相关段落",
                                      "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
]


def _deep_merge(a: dict, b: dict) -> dict:
    out = copy.deepcopy(a)
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _tool(name: str, args: dict, conv: str) -> object:
    if name == "list_projects":
        return [{"id": p["id"], "name": p["name"], "designs": p.get("designs") or p.get("template"), "site_status": p.get("site_status")} for p in projects.list_projects()]
    if name == "get_project":
        pid = args["project_id"]
        p = projects.get_project(pid)
        return {"project": {k: p.get(k) for k in ("id", "name", "description", "paper", "site", "site_status", "simulation", "site_info")},
                "configs": [{"id": c["id"], "name": c["name"], "host": c["spec"]["host"], "htl": c["spec"]["htl"]["kind"], "description": c.get("description")} for c in projects.list_configs(pid)],
                "experiments": [{"id": e["id"], "name": e["name"], "items": e["items"]} for e in projects.list_experiments(pid)],
                "runs": [{"id": r["id"], "label": r["label"], "status": r["status"]} for r in projects.list_runs(pid)[:30]]}
    if name == "get_config":
        return projects.get_config(args["project_id"], args["config_id"])
    if name == "host_info":
        return {"host": host_summary(HOSTS[args["host"]]), "htl_defaults": builder.htl_parameter_table(args["host"])}
    if name == "propose_config_change":
        cfg = projects.get_config(args["project_id"], args["config_id"])
        new_spec = builder.normalize_spec(_deep_merge(cfg["spec"], args["spec_patch"]))
        builder.build_fabm_yaml(new_spec)  # validate
        prop = {"id": uuid.uuid4().hex[:8], "project_id": args["project_id"], "config_id": args["config_id"],
                "config_name": cfg["name"], "new_name": args.get("new_name"), "spec_patch": args["spec_patch"],
                "spec": new_spec, "reason": args.get("reason", ""), "status": "pending"}
        PROPOSALS[prop["id"]] = prop
        if load_settings()["assistant"].get("auto_apply"):
            apply_proposal({"id": prop["id"]})
        events.emit("assistant", {"conv": conv, "type": "proposal", "proposal": prop})
        return {"proposal_id": prop["id"], "status": PROPOSALS[prop["id"]]["status"], "note": "已提交给用户审批"}
    if name == "run_configs":
        from ..runner import get_runner

        items = [{"config_id": c} for c in args["config_ids"]]
        runs = get_runner().start_runs(args["project_id"], items)
        return [{"run_id": r["id"], "label": r["label"]} for r in runs]
    if name == "list_runs":
        return [{"id": r["id"], "label": r["label"], "status": r["status"], "config_id": r.get("config_id"), "elapsed": r.get("elapsed"),
                 "analysis_start": (r.get("timing") or {}).get("analysis_start")} for r in projects.list_runs(args["project_id"])[:40]]
    if name == "compare_runs":
        pid = args["project_id"]
        runs = [(projects.get_run(pid, r)["label"], projects.run_dir(pid, r), projects.get_run(pid, r)) for r in args["run_ids"]]
        return results.compare(runs)
    if name == "variable_stats":
        pid = args["project_id"]
        run = projects.get_run(pid, args["run_id"])
        start = (run.get("timing") or {}).get("analysis_start")
        ac = results.annual_cycle([(run["label"], projects.run_dir(pid, args["run_id"]))], args["var"], args.get("mode", "integral"), start)
        s = ac["series"][0]
        if s.get("missing"):
            return {"error": "变量不存在"}
        vals = [v for v in s["mean"] if v is not None]
        imax = s["mean"].index(max(vals))
        imin = s["mean"].index(min(vals))
        monthly = [round(sum(x for x in s["mean"][i * 30:(i + 1) * 30] if x is not None) / 30, 4) for i in range(12)]
        return {"units": ac["units"], "annual_mean": sum(vals) / len(vals), "max": max(vals), "max_doy": s["doy"][imax],
                "min": min(vals), "min_doy": s["doy"][imin], "monthly_means": monthly}
    if name == "list_output_variables":
        v = results.list_variables(projects.run_dir(args["project_id"], args["run_id"]))
        return {g["label"]: [x["name"] for x in g["vars"]][:60] for g in v["groups"]}
    if name == "primer_search":
        return primer_search(args["query"])
    raise ValueError(f"未知工具 {name}")


def primer_search(query: str, k: int = 5) -> list[dict]:
    terms = [t for t in re.split(r"[\s,，。、]+", query.lower()) if t]
    hits = []
    for f in sorted(PRIMER_DIR.glob("*.md")):
        text = f.read_text(encoding="utf-8")
        for para in re.split(r"\n\s*\n", text):
            low = para.lower()
            score = sum(low.count(t) for t in terms)
            # Chinese: count character bigram overlap
            for t in terms:
                if re.search(r"[一-鿿]", t):
                    score += sum(1 for i in range(len(t) - 1) if t[i:i + 2] in para)
            if score:
                hits.append((score, f.stem, para.strip()[:900]))
    hits.sort(reverse=True)
    return [{"chapter": c, "text": t} for _, c, t in hits[:k]]


def _client(cfg: dict):
    from openai import OpenAI

    return OpenAI(base_url=cfg.get("base_url") or None, api_key=cfg.get("api_key") or "none", timeout=120)


def test_connection(data: dict) -> dict:
    cfg = dict(load_settings()["assistant"])
    cfg.update({k: v for k, v in data.items() if v})
    try:
        r = _client(cfg).chat.completions.create(model=cfg["model"], messages=[{"role": "user", "content": "回复 OK"}], max_tokens=5)
        return {"ok": True, "reply": r.choices[0].message.content}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def start_chat(data: dict) -> dict:
    conv = data.get("conv") or uuid.uuid4().hex[:10]
    msgs = CONVERSATIONS.setdefault(conv, [{"role": "system", "content": SYSTEM}])
    ctx = data.get("context") or {}
    text = data["message"]
    if ctx:
        text += "\n\n[界面上下文] " + json.dumps(ctx, ensure_ascii=False)
    msgs.append({"role": "user", "content": text})
    threading.Thread(target=_loop, args=(conv,), daemon=True).start()
    return {"conv": conv}


def _loop(conv: str) -> None:
    cfg = load_settings()["assistant"]
    msgs = CONVERSATIONS[conv]
    if not cfg.get("api_key") and "localhost" not in (cfg.get("base_url") or "") and "127.0.0.1" not in (cfg.get("base_url") or ""):
        events.emit("assistant", {"conv": conv, "type": "error", "text": "尚未配置 AI 服务：请在“设置 → AI 助手”中填写接口地址、模型和 API Key（本地模型可不填 Key）。"})
        return
    try:
        client = _client(cfg)
        for _ in range(12):
            r = client.chat.completions.create(model=cfg["model"], messages=msgs, tools=TOOLS, temperature=0.3)
            m = r.choices[0].message
            entry = {"role": "assistant", "content": m.content or ""}
            if m.tool_calls:
                entry["tool_calls"] = [{"id": t.id, "type": "function", "function": {"name": t.function.name, "arguments": t.function.arguments}} for t in m.tool_calls]
            msgs.append(entry)
            if m.content:
                events.emit("assistant", {"conv": conv, "type": "text", "text": m.content, "final": not m.tool_calls})
            if not m.tool_calls:
                break
            for t in m.tool_calls:
                try:
                    args = json.loads(t.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                events.emit("assistant", {"conv": conv, "type": "tool", "name": t.function.name, "args": args})
                try:
                    res = _tool(t.function.name, args, conv)
                except Exception as e:
                    res = {"error": str(e)}
                content = json.dumps(res, ensure_ascii=False, default=str)
                if len(content) > 12000:
                    content = content[:12000] + "…(截断)"
                msgs.append({"role": "tool", "tool_call_id": t.id, "content": content})
        events.emit("assistant", {"conv": conv, "type": "done"})
    except Exception as e:
        traceback.print_exc()
        events.emit("assistant", {"conv": conv, "type": "error", "text": f"AI 服务调用失败：{e}"})


def apply_proposal(data: dict) -> dict:
    prop = PROPOSALS.get(data["id"])
    if not prop:
        raise KeyError("提案不存在或已过期")
    if data.get("reject"):
        prop["status"] = "rejected"
        return prop
    pid = prop["project_id"]
    cfg = projects.get_config(pid, prop["config_id"])
    if prop.get("new_name"):
        saved = projects.save_config(pid, {"name": prop["new_name"], "description": prop.get("reason", ""), "spec": prop["spec"],
                                           "origin": f"AI 助手提案（基于 {cfg['name']}）"})
    else:
        saved = projects.save_config(pid, {**cfg, "spec": prop["spec"]})
    prop["status"] = "applied"
    prop["saved_config_id"] = saved["id"]
    events.emit("configs", {"project": pid})
    return prop
