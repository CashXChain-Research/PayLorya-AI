// Hand-rolled SVG charts. Each chart renders at the container's real pixel width (so text stays
// crisp and readable on phones) and re-renders on resize. Colors come only from base.css tokens.
import { esc } from "../shared/dom.js";
import type { Forecast, Overview } from "./types.js";
import { date, monthLabel, usd } from "./ui.js";

type Cleanup = () => void;

/** Renders draw(width) into el now and whenever el's width changes. */
export function mountChart(el: HTMLElement, draw: (width: number) => string, after?: (el: HTMLElement) => void): Cleanup {
  let last = 0;
  const render = () => {
    const w = Math.floor(el.clientWidth);
    if (!w || w === last) return;
    last = w;
    el.innerHTML = draw(w);
    after?.(el);
  };
  render();
  const ro = new ResizeObserver(() => render());
  ro.observe(el);
  return () => ro.disconnect();
}

/** Rounded "nice" axis maximum and ticks. */
function niceTicks(max: number, min = 0, count = 4): number[] {
  const span = Math.max(1, max - min);
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find(m => m * mag >= raw) ?? 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

/** Grouped bars: money in vs out per month. */
export function inOutChart(monthly: Overview["monthly"]): (w: number) => string {
  return w => {
    const h = 240;
    const pad = { l: 52, r: 8, t: 12, b: 28 };
    const max = Math.max(1, ...monthly.flatMap(m => [m.inUsdMinor, m.outUsdMinor]));
    const ticks = niceTicks(max);
    const top = ticks[ticks.length - 1]!;
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const y = (v: number) => pad.t + ih - (v / top) * ih;
    const slot = iw / Math.max(1, monthly.length);
    const bw = Math.min(22, slot * 0.28);
    let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Money in and out, last ${monthly.length} months">`;
    for (const t of ticks) {
      s += `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${pad.l - 10}" y="${y(t) + 4}" text-anchor="end">${esc(usd(t, { compact: true }))}</text>`;
    }
    monthly.forEach((m, i) => {
      const cx = pad.l + slot * i + slot / 2;
      const hin = Math.max(m.inUsdMinor ? 2 : 0, (m.inUsdMinor / top) * ih);
      const hout = Math.max(m.outUsdMinor ? 2 : 0, (m.outUsdMinor / top) * ih);
      const net = m.inUsdMinor - m.outUsdMinor;
      s += `<g class="bar-g" tabindex="0"><title>${esc(monthLabel(m.month, true))}: in ${esc(usd(m.inUsdMinor))}, out ${esc(usd(m.outUsdMinor))}, net ${esc(usd(net, { sign: true }))}</title>
        <rect class="hit" x="${cx - slot / 2}" y="${pad.t}" width="${slot}" height="${ih}"/>
        <rect class="bar-in" x="${cx - bw - 2}" y="${pad.t + ih - hin}" width="${bw}" height="${hin}" rx="${Math.min(5, bw / 3)}"/>
        <rect class="bar-out" x="${cx + 2}" y="${pad.t + ih - hout}" width="${bw}" height="${hout}" rx="${Math.min(5, bw / 3)}"/>
        <text class="axis" x="${cx}" y="${h - 8}" text-anchor="middle">${esc(monthLabel(m.month))}</text></g>`;
    });
    return s + "</svg>";
  };
}

/** 90-day balance line with event markers and a hover readout. */
export function forecastChart(f: Forecast, height = 260): { draw: (w: number) => string; wire: (el: HTMLElement) => void } {
  const pts = f.points;
  let geo: { x: (i: number) => number; y: (v: number) => number; l: number; r: number; t: number; b: number } | null = null;
  const draw = (w: number) => {
    const h = height;
    const pad = { l: 56, r: 12, t: 16, b: 30 };
    if (pts.length < 2) return `<div class="chart-empty"><span>No forecast yet. <a href="/app/connections">Connect a wallet</a> and <a href="/app/documents">upload invoices</a> to see where your cash is heading.</span></div>`;
    const values = pts.map(p => p.balanceUsdMinor);
    const ticks = niceTicks(Math.max(...values, 0), Math.min(...values, 0));
    const lo = ticks[0]!;
    const hi = ticks[ticks.length - 1]!;
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const x = (i: number) => pad.l + (i / (pts.length - 1)) * iw;
    const y = (v: number) => pad.t + ih - ((v - lo) / Math.max(1, hi - lo)) * ih;
    geo = { x, y, l: pad.l, r: w - pad.r, t: pad.t, b: pad.t + ih };
    let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Cash forecast, next ${f.days} days">
      <defs><linearGradient id="fc-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="fc-stop-a"/><stop offset="1" class="fc-stop-b"/></linearGradient></defs>`;
    for (const t of ticks) {
      s += `<line class="grid${t === 0 && lo < 0 ? " zero" : ""}" x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${pad.l - 10}" y="${y(t) + 4}" text-anchor="end">${esc(usd(t, { compact: true }))}</text>`;
    }
    const step = Math.max(1, Math.round(pts.length / Math.max(2, Math.floor(iw / 90))));
    for (let i = 0; i < pts.length; i += step) {
      s += `<text class="axis" x="${x(i)}" y="${h - 8}" text-anchor="${i === 0 ? "start" : "middle"}">${esc(date(pts[i]!.date, false))}</text>`;
    }
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.balanceUsdMinor).toFixed(1)}`).join("");
    const base = y(Math.max(lo, 0));
    s += `<path class="fc-area" d="${line}L${x(pts.length - 1)},${base}L${x(0)},${base}Z" fill="url(#fc-fill)"/>`;
    s += `<path class="fc-line" d="${line}" pathLength="1"/>`;
    const idx = new Map(pts.map((p, i) => [p.date, i]));
    for (const e of f.events) {
      const i = idx.get(e.date);
      if (i == null) continue;
      const cy = y(pts[i]!.balanceUsdMinor);
      s += `<g class="fc-ev ${e.usdMinor < 0 ? "out" : "in"}"><title>${esc(date(e.date))} · ${esc(e.label)} · ${esc(usd(e.usdMinor, { sign: true }))}</title><line x1="${x(i)}" x2="${x(i)}" y1="${cy}" y2="${pad.t + ih}"/><circle cx="${x(i)}" cy="${cy}" r="4.5"/></g>`;
    }
    s += `<g class="fc-hover" style="display:none"><line class="fc-cross" y1="${pad.t}" y2="${pad.t + ih}"/><circle class="fc-dot" r="5"/></g>`;
    return s + "</svg>";
  };
  const wire = (el: HTMLElement) => {
    const svg = el.querySelector("svg");
    if (!svg || !geo) return;
    let tip = el.parentElement?.querySelector<HTMLElement>(".chart-tip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "chart-tip";
      el.parentElement?.append(tip);
    }
    const g = svg.querySelector<SVGGElement>(".fc-hover")!;
    const cross = g.querySelector("line")!;
    const dot = g.querySelector("circle")!;
    const move = (clientX: number) => {
      if (!geo) return;
      const rect = svg.getBoundingClientRect();
      const px = clientX - rect.left;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(((px - geo.l) / (geo.r - geo.l)) * (pts.length - 1))));
      const p = pts[i]!;
      const cx = geo.x(i);
      const cy = geo.y(p.balanceUsdMinor);
      g.style.display = "";
      cross.setAttribute("x1", String(cx));
      cross.setAttribute("x2", String(cx));
      dot.setAttribute("cx", String(cx));
      dot.setAttribute("cy", String(cy));
      const evs = f.events.filter(e => e.date === p.date);
      tip!.innerHTML = `<span>${esc(date(p.date))}</span><b>${esc(usd(p.balanceUsdMinor))}</b>${evs.map(e => `<em class="${e.usdMinor < 0 ? "out" : "in"}">${esc(e.label)} ${esc(usd(e.usdMinor, { sign: true }))}</em>`).join("")}`;
      tip!.style.opacity = "1";
      const tw = tip!.offsetWidth;
      const left = Math.min(Math.max(cx - tw / 2, 0), rect.width - tw);
      tip!.style.transform = `translate(${left}px, ${Math.max(0, cy - 76)}px)`;
    };
    const hide = () => {
      g.style.display = "none";
      tip!.style.opacity = "0";
    };
    svg.addEventListener("pointermove", e => move(e.clientX));
    svg.addEventListener("pointerleave", hide);
  };
  return { draw, wire };
}

/** Ranked horizontal bars (spend by category). */
export function categoryBars(rows: Array<{ category: string; usdMinor: number }>, limit = 6): string {
  const sorted = [...rows].filter(r => r.usdMinor > 0).sort((a, b) => b.usdMinor - a.usdMinor);
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((a, r) => a + r.usdMinor, 0);
  if (rest > 0) top.push({ category: `Other (${sorted.length - limit})`, usdMinor: rest });
  const total = sorted.reduce((a, r) => a + r.usdMinor, 0) || 1;
  const max = Math.max(1, ...top.map(r => r.usdMinor));
  return `<ul class="hbars">${top
    .map(
      (r, i) => `<li style="--d:${i * 50}ms"><div class="hb-top"><span>${esc(r.category)}</span><b>${esc(usd(r.usdMinor, { cents: false }))}</b><em>${Math.round((r.usdMinor / total) * 100)}%</em></div>
      <div class="hb-track"><i style="width:${Math.max(2, (r.usdMinor / max) * 100).toFixed(1)}%"></i></div></li>`,
    )
    .join("")}</ul>`;
}

/** Tiny inline sparkline path for KPI cards. */
export function sparkline(values: number[], w = 120, h = 36): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - 3 - ((v - min) / Math.max(1, max - min)) * (h - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}"/></svg>`;
}
