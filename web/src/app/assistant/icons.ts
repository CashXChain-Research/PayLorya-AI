const svg = (size: number, stroke: number, body: string): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Icons of the Assistant view (shared ones live in ui.ts). */
export const AI = {
  clip: svg(20, 2, `<path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/>`),
  up: svg(18, 2.4, `<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>`),
  down: svg(16, 2.4, `<path d="M12 5v14M5.5 12.5L12 19l6.5-6.5"/>`),
  file: svg(18, 1.9, `<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>`),
  drop: svg(28, 1.8, `<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>`),
  save: svg(14, 2.2, `<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 20h14"/>`),
  arrow: svg(13, 2.4, `<path d="M5 12h14M13 6l6 6-6 6"/>`),
  spark: svg(13, 2.2, `<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>`),
  ask: svg(13, 2.2, `<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>`),
};

/** The CashXChain mark, as in the nav logo. */
export const MARK = `<svg width="15" height="15" viewBox="0 0 64 64" aria-hidden="true"><path d="M15 15 49 49" stroke="#5cc0d6" stroke-width="10" stroke-linecap="round"/><path d="M49 15 15 49" stroke="#fff" stroke-width="10" stroke-linecap="round"/></svg>`;
