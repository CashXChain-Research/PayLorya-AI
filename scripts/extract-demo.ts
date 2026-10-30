import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.js";
import { extractInvoice } from "../src/extract.js";
import { SAMPLE_INVOICES } from "../src/fixtures.js";
import { precheck } from "../src/policy.js";
import { InvoiceSchema } from "../src/types.js";

// Extraction only: this script never constructs a buyer or a payment client.
async function main(): Promise<void> {
  const [name, ...extra] = process.argv.slice(2);
  if (!name || extra.length) {
    throw new Error(`Usage: npm run extract -- <file.txt | sample-name>\nSamples: ${Object.keys(SAMPLE_INVOICES).join(", ")}`);
  }
  const input = Object.hasOwn(SAMPLE_INVOICES, name) ? SAMPLE_INVOICES[name]! : await readFile(name, "utf8");
  let structured;
  try { structured = InvoiceSchema.safeParse(JSON.parse(input)); } catch { /* free text */ }
  const config = loadConfig();
  if (!structured?.success && !config.aiReady) throw new Error("ANTHROPIC_API_KEY is required for free-text extraction; structured Invoice JSON works offline");
  const invoice = structured?.success ? structured.data : await extractInvoice(input, config.CLAUDE_MODEL);
  console.log(JSON.stringify({ invoice, precheck: precheck(invoice), paymentAttempted: false }, null, 2));
}

main().catch(error => {
  // SDK error messages can echo request data; do not print API responses or credentials.
  console.error(error instanceof Error && ["Error", "ExtractionError"].includes(error.constructor.name)
    ? error.message : "Extraction failed; check API access and the configured model");
  process.exitCode = 1;
});
