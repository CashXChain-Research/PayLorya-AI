// Light Markdown for assistant replies: paragraphs, headings, **bold**, *italic*, `code`,
// lists, simple tables, fenced code, links. Escapes everything first, so only our own tags survive.
import { esc } from "../shared/dom.js";

function inline(s: string): string {
  let out = esc(s);
  const codes: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g, (_, text: string, href: string) => {
      const ext = href.startsWith("http");
      return `<a href="${href}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`;
    });
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)] ?? "");
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) =>
  l
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(c => c.trim());

export function markdown(src: string): string {
  const lines = src.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) buf.push(lines[i++]!);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(4, h[1]!.length + 2);
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
      i++;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isSep(lines[i + 1]!)) {
      const head = cells(line);
      const align = cells(lines[i + 1]!).map(c => (/:$/.test(c) ? "num" : ""));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!)) rows.push(cells(lines[i++]!));
      const num = (c: string, j: number) =>
        align[j] === "num" || /^[-−+]?\s?(?:[A-Z]{3}\s)?[$€£]?\s?[\d,.]+\s?(?:%|k|m|tADA|ADA|[A-Z]{3})?$/.test(c);
      out.push(
        `<div class="md-table"><table><thead><tr>${head.map((c, j) => `<th${align[j] ? ' class="num"' : ""}>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map(r => `<tr>${head.map((_, j) => `<td${num(r[j] ?? "", j) ? ' class="num"' : ""}>${inline(r[j] ?? "")}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) {
        let item = lines[i]!.replace(/^\s*([-*•]|\d+[.)])\s+/, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) item += " " + lines[i++]!.trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) buf.push(lines[i++]!.replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,4}\s|```|>\s?)/.test(lines[i]!) &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!) &&
      !(isTableRow(lines[i]!) && i + 1 < lines.length && isSep(lines[i + 1]!))
    )
      para.push(lines[i++]!);
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return out.join("");
}
