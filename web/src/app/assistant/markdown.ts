import { esc } from "../../shared/dom.js";

/**
 * Model text to HTML: escaped first, then a small subset (bold, inline code, line breaks, "-"
 * bullets, numbered lists, "#" headings as bold lines). No links, images or raw HTML.
 */
export function markdown(text: string): string {
  const blocks: string[] = [];
  let para: string[] = [];
  let items: string[] = [];
  let ordered = false;
  const flushPara = () => {
    if (para.length) blocks.push(`<p class="m-p">${para.join("<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (items.length) blocks.push(`<${ordered ? "ol" : "ul"} class="m-list">${items.map(i => `<li>${i}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
    items = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").trim().split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const number = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (bullet || number) {
      flushPara();
      if (items.length && ordered !== Boolean(number)) flushList();
      ordered = Boolean(number);
      items.push(inline((bullet ?? number)![1]!));
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push(`<p class="m-p m-h">${inline(heading[1]!)}</p>`);
    } else if (items.length && /^\s{2,}\S/.test(raw)) {
      // Indented continuation of the last list item.
      items[items.length - 1] += `<br>${inline(line.trim())}`;
    } else {
      flushList();
      para.push(inline(line));
    }
  }
  flushPara();
  flushList();
  return blocks.join("");
}

/** `code` and **bold** (also __bold__); code content is never formatted further. */
function inline(line: string): string {
  return line
    .split(/(`[^`]+`)/)
    .map(part =>
      part.length > 2 && part.startsWith("`") && part.endsWith("`")
        ? `<code>${esc(part.slice(1, -1))}</code>`
        : esc(part).replace(/\*\*(?=\S)(.+?)\*\*|__(?=\S)(.+?)__/g, (_m, a?: string, b?: string) => `<b>${a ?? b}</b>`),
    )
    .join("");
}

/** Plain text of thread HTML (what the chat history sends back to the model). */
export function plainText(html: string): string {
  const marked = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|div|ul|ol|dt|dd|h\d)>/gi, "$&\n").replace(/<li[^>]*>/gi, "$&- ");
  const doc = new DOMParser().parseFromString(marked, "text/html");
  return (doc.body.textContent ?? "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
