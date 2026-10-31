// Extraction only: prints the Invoice extracted from a sample or file and the local precheck.
// Never pays: no buyer agent, wallet or x402 client is created. Free text needs ANTHROPIC_API_KEY;
// structured Invoice JSON skips the model, as in the agent.
//   npm run extract -- <file | sample-name>
import { readFile } from "node:fs/promises";
import { loadConfig, type Config } from "../src/config.js";
import { extractInvoice } from "../src/extract.js";
import { sampleInvoices } from "../src/fixtures.js";
import { precheck } from "../src/policy.js";
import { InvoiceSchema, type Invoice } from "../src/types.js";

/** Same rule as BuyerAgent.extract. */
function structured(text: string): Invoice | undefined {
  try {
    const parsed = InvoiceSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function main(args: string[], config: Config): Promise<number> {
  const samples = sampleInvoices(config.SUPPLIER_CARDANO_ADDRESS);
  const usage = `usage: npm run extract -- <file | sample-name>\nsamples: ${Object.keys(samples).join(", ")}`;
  const [name] = args;
  if (args.length !== 1 || !name) {
    console.error(usage);
    return 1;
  }

  let text: string;
  let input: string;
  if (Object.hasOwn(samples, name)) {
    text = samples[name]!;
    input = `sample ${name}`;
  } else {
    try {
      text = await readFile(name, "utf8");
    } catch {
      console.error(`${name} is neither a sample nor a readable file\n${usage}`);
      return 1;
    }
    input = `file ${name}`;
  }

  let invoice = structured(text);
  const extractedBy = invoice ? "structured JSON" : config.CLAUDE_MODEL;
  if (!invoice) {
    if (!config.aiReady) {
      console.error("ANTHROPIC_API_KEY is not set: free text cannot be extracted (structured Invoice JSON works without it)");
      return 1;
    }
    invoice = await extractInvoice(text, config.CLAUDE_MODEL);
  }
  console.log(JSON.stringify({ input, extractedBy, invoice, precheck: precheck(invoice) }, null, 2));
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2), loadConfig());
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
