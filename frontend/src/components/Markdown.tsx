import katex from "katex";
import { marked } from "marked";
import { useMemo } from "react";
import { LabHost } from "../primer/labs";
import { useApp } from "../store";

function renderMath(src: string): string {
  // protect math before markdown processing
  const store: string[] = [];
  const put = (html: string) => `@@MATH${store.push(html) - 1}@@`;
  let s = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => put(katex.renderToString(m.trim(), { displayMode: true, throwOnError: false, strict: false })));
  s = s.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_, pre, m) => pre + put(katex.renderToString(m.trim(), { displayMode: false, throwOnError: false, strict: false })));
  let html = marked.parse(s, { async: false, gfm: true }) as string;
  html = html.replace(/@@MATH(\d+)@@/g, (_, i) => store[+i]);
  return html;
}

export function parseFrontMatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  m[1].split("\n").forEach((l) => {
    const i = l.indexOf(":");
    if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  });
  return { meta, body: text.slice(m[0].length) };
}

export function Markdown({ text, onChapter }: { text: string; onChapter?: (id: string) => void }) {
  const setPage = useApp((s) => s.setPage);
  const parts = useMemo(() => {
    const out: { kind: "md" | "lab"; content: string }[] = [];
    const lines = text.split("\n");
    let buf: string[] = [];
    for (const l of lines) {
      const m = l.match(/^:::\s*lab\s+([a-z_]+)\s*$/);
      if (m) {
        if (buf.length) out.push({ kind: "md", content: renderMath(buf.join("\n")) });
        out.push({ kind: "lab", content: m[1] });
        buf = [];
      } else buf.push(l);
    }
    if (buf.length) out.push({ kind: "md", content: renderMath(buf.join("\n")) });
    return out;
  }, [text]);
  const click = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (href.startsWith("app:")) {
      e.preventDefault();
      setPage(href.slice(4) as any);
    } else if (href.startsWith("chapter:")) {
      e.preventDefault();
      onChapter?.(href.slice(8));
    } else if (/^https?:/.test(href)) {
      a.setAttribute("target", "_blank");
    }
  };
  return (
    <div className="md" onClick={click}>
      {parts.map((p, i) => {
        if (p.kind === "lab") {
          return <LabHost key={i} name={p.content} />;
        }
        return <div key={i} dangerouslySetInnerHTML={{ __html: p.content }} />;
      })}
    </div>
  );
}
