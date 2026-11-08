import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Markdown, parseFrontMatter } from "../components/Markdown";
import { Btn, Icon } from "../components/ui";
import { useApp } from "../store";
import { askTutor } from "../tutor";

const files = import.meta.glob("../primer/content/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
interface Chapter { id: string; title: string; order: number; summary: string; body: string }
const CHAPTERS: Chapter[] = Object.entries(files).map(([path, raw]) => {
  const { meta, body } = parseFrontMatter(raw);
  const id = meta.id || path.split("/").pop()!.replace(".md", "");
  // the title is shown in the page header; drop the markdown H1 and the AI-review line (shown as a badge)
  const clean = body.replace(/^#\s+.+\n/m, "").replace(/^>\s*本章由 AI 撰写.*\n/m, "");
  return { id, title: meta.title || id, order: +(meta.order ?? 99), summary: meta.summary || "", body: clean };
}).sort((a, b) => a.order - b.order);
const PARTS: [string, (o: number) => boolean][] = [
  ["开始", (o) => o === 0],
  ["基础：从物理到浮游生态", (o) => o >= 1 && o <= 5],
  ["高营养级与耦合", (o) => o >= 6 && o <= 8],
  ["方法来源与拓展", (o) => o >= 9],
];

// below these page widths the panels float over the article (drawers) instead of taking room from it
const NAV_DOCK_WIDTH = 720;
const TOC_DOCK_WIDTH = 1060;

export default function PrimerPage() {
  const { chapter, setPage, learnPanels, setLearnPanel } = useApp();
  const [id, setId] = useState<string>(chapter && CHAPTERS.some((c) => c.id === chapter) ? chapter : CHAPTERS[0]?.id);
  const [q, setQ] = useState("");
  const [active, setActive] = useState("");
  const main = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1400);
  const [drawer, setDrawer] = useState<null | "nav" | "toc">(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    if (el.clientWidth) setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 1400));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);
  useEffect(() => { if (chapter && CHAPTERS.some((c) => c.id === chapter)) setId(chapter); }, [chapter]);
  const open = (cid: string) => { setId(cid); setQ(""); setDrawer(null); setPage("primer", { chapter: cid }); main.current?.scrollTo({ top: 0 }); };
  const cur = CHAPTERS.find((c) => c.id === id)!;
  const idx = CHAPTERS.findIndex((c) => c.id === id);
  const part = PARTS.find(([, f]) => f(cur?.order ?? 0))?.[0];
  const hits = useMemo(() => {
    if (!q.trim()) return null;
    const ql = q.toLowerCase();
    return CHAPTERS.flatMap((c) => {
      const i = c.body.toLowerCase().indexOf(ql);
      if (i < 0 && !c.title.toLowerCase().includes(ql)) return [];
      return [{ c, snip: i >= 0 ? c.body.slice(Math.max(0, i - 40), i + 80).replace(/[#$*>\n]/g, " ") : c.summary }];
    });
  }, [q]);
  const toc = useMemo(() => (cur?.body.match(/^## .+$/gm) ?? []).map((h) => h.slice(3).replace(/\{#.*\}/, "").trim()), [cur]);
  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const h = () => {
      let a = "";
      for (const x of Array.from(el.querySelectorAll(".md h2")) as HTMLElement[]) if (x.getBoundingClientRect().top < el.getBoundingClientRect().top + 90) a = x.textContent?.trim() ?? "";
      setActive(a);
    };
    el.addEventListener("scroll", h);
    h();
    return () => el.removeEventListener("scroll", h);
  }, [id]);
  const goSection = (t: string) => {
    setDrawer(null);
    (Array.from(document.querySelectorAll(".md h2")) as HTMLElement[]).find((h) => h.textContent?.trim() === t)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // docked panels where there is room (remembered between visits), drawers over the article where there is not
  const floating = { nav: width < NAV_DOCK_WIDTH, toc: width < TOC_DOCK_WIDTH };
  const hasToc = toc.length > 0 && !hits;
  const navOpen = floating.nav ? drawer === "nav" : learnPanels.nav;
  const tocOpen = hasToc && (floating.toc ? drawer === "toc" : learnPanels.toc);
  const toggle = (k: "nav" | "toc") => {
    if (floating[k]) setDrawer((d) => (d === k ? null : k));
    else setLearnPanel(k, !learnPanels[k]);
  };

  return (
    <div className="learn" ref={host}>
      <aside className={`learn-nav ${navOpen ? "open" : ""} ${floating.nav ? "drawer" : ""}`} aria-label="章节目录" aria-hidden={!navOpen}>
        <div className="learn-panel-inner">
          <div style={{ padding: "12px 10px 8px" }}><div className="search"><Icon name="search" /><input placeholder="搜索教程" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
          <div className="split-scroll" style={{ padding: "0 6px 14px" }}>
            {PARTS.map(([name, f]) => (
              <div key={name} style={{ marginBottom: 10 }}>
                <div className="learn-part">{name}</div>
                {CHAPTERS.filter((c) => f(c.order)).map((c) => (
                  <button key={c.id} className={`learn-item ${c.id === id ? "active" : ""}`} onClick={() => open(c.id)} title={c.summary} tabIndex={navOpen ? 0 : -1}>
                    <span className="mono soft" style={{ width: 18, fontSize: 11 }}>{String(c.order).padStart(2, "0")}</span>
                    <span className="ellipsis">{c.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </aside>
      <div className="learn-main" ref={main}>
        <div className="learn-bar">
          <button className={`learn-bar-btn ${navOpen ? "on" : ""}`} onClick={() => toggle("nav")} data-tip={navOpen ? "收起章节目录" : "显示章节目录"} aria-pressed={navOpen}><Icon name="list-tree" /><span>章节</span></button>
          <div className="learn-crumbs ellipsis">
            <span className="soft">{part}</span><Icon name="chevron-right" className="soft" /><span>{cur.title}</span>
            {active && <><Icon name="chevron-right" className="soft" /><span className="soft">{active}</span></>}
          </div>
          {hasToc && <button className={`learn-bar-btn ${tocOpen ? "on" : ""}`} onClick={() => toggle("toc")} data-tip={tocOpen ? "收起“本页内容”" : "显示“本页内容”"} aria-pressed={tocOpen}><span>本页内容</span><Icon name="list-selection" /></button>}
        </div>
        {hits ? (
          <div className="learn-article">
            <div className="page-title" style={{ marginBottom: 14 }}>搜索结果</div>
            {!hits.length && <div className="soft">没有匹配的内容</div>}
            {hits.map(({ c, snip }) => (
              <button key={c.id} className="learn-hit" onClick={() => open(c.id)}><b>{c.title}</b><span className="soft small">…{snip}…</span></button>
            ))}
          </div>
        ) : (
          <article className="learn-article">
            <header className="learn-head">
              <div className="learn-kicker">第 {cur.order} 章 · {part}</div>
              <h1 className="page-title" style={{ fontSize: 24 }}>{cur.title}</h1>
              <div className="row" style={{ marginTop: 8 }}>
                {cur.summary && <span className="soft small ellipsis">{cur.summary}</span>}
                <span className="grow" />
                <Btn size="sm" icon="sparkle" onClick={() => askTutor(`请讲解入门教程“${cur.title}”这一章：核心概念、关键方程，以及它们在 Shoal 里对应的设置和结果。`)}>问讲解员</Btn>
              </div>
            </header>
            <Markdown text={cur.body} onChapter={open} />
            <footer className="learn-foot">
              {idx > 0 ? <Btn icon="arrow-left" onClick={() => open(CHAPTERS[idx - 1].id)}>{CHAPTERS[idx - 1].title}</Btn> : <span />}
              {idx < CHAPTERS.length - 1 && <Btn icon="arrow-right" onClick={() => open(CHAPTERS[idx + 1].id)}>{CHAPTERS[idx + 1].title}</Btn>}
            </footer>
          </article>
        )}
      </div>
      {hasToc && (
        <nav className={`learn-toc ${tocOpen ? "open" : ""} ${floating.toc ? "drawer" : ""}`} aria-label="本页内容" aria-hidden={!tocOpen}>
          <div className="learn-panel-inner">
            <div className="learn-part">本页内容</div>
            {toc.map((t) => <button key={t} className={`learn-item ${active === t ? "active" : ""}`} onClick={() => goSection(t)} tabIndex={tocOpen ? 0 : -1}><span className="ellipsis">{t}</span></button>)}
          </div>
        </nav>
      )}
      {drawer && <div className="learn-scrim" onClick={() => setDrawer(null)} />}
    </div>
  );
}
