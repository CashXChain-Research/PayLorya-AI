import { extractPdfText } from "../shared/pdf.js";

/** `accept` for invoice file inputs. */
export const INVOICE_ACCEPT = ".pdf,.txt,.eml,.json,.md,.csv,application/pdf,text/plain,application/json,message/rfc822";
export const MAX_INVOICE_BYTES = 5 * 1024 * 1024;

const TEXT_NAME = /\.(txt|eml|json|md|csv)$/i;

/**
 * Invoice text from a dropped or picked file, read in the browser. The agent then gets the same
 * text input as a pasted invoice. PDFs use their text layer; images and scans need OCR (not here).
 */
export async function readInvoiceFile(file: File): Promise<{ text: string; kind: "pdf" | "text" }> {
  if (file.size > MAX_INVOICE_BYTES) throw new Error("The file is larger than 5 MB");
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    const text = await extractPdfText(file);
    if (!text) throw new Error("This PDF has no text layer (a scan?). Upload a digital PDF or paste the text");
    return { text, kind: "pdf" };
  }
  if (file.type.startsWith("text/") || file.type === "application/json" || file.type === "message/rfc822" || TEXT_NAME.test(file.name)) {
    const text = (await file.text()).trim();
    if (!text) throw new Error("The file is empty");
    return { text, kind: "text" };
  }
  if (file.type.startsWith("image/")) throw new Error("Images need OCR, which this preview does not have. Upload a PDF or text file");
  throw new Error(`Unsupported file type: ${file.name}`);
}
