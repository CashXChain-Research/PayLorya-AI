import type * as Pdfjs from "pdfjs-dist";

// pdf.js is vendored to /assets/vendor by web/build.ts and only loaded when someone drops a PDF.
const PDFJS_URL = "/assets/vendor/pdf.min.mjs";
const WORKER_URL = "/assets/vendor/pdf.worker.min.mjs";

let loading: Promise<typeof Pdfjs> | undefined;

function pdfjs(): Promise<typeof Pdfjs> {
  loading ??= (import(PDFJS_URL) as Promise<typeof Pdfjs>).then(lib => {
    lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
    return lib;
  });
  return loading;
}

/**
 * Text layer of a PDF, line by line, read in the browser. Scanned PDFs have no text layer and
 * return "" (no OCR here). Only the first pages are read: invoices are short.
 */
export async function extractPdfText(file: Blob, maxPages = 10): Promise<string> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(content.items.map(item => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "")).join(""));
    }
    return pages.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    await task.destroy(); // also ends the worker
  }
}
