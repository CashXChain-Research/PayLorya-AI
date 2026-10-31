import type { Express, Request, Response } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactCardanoScheme } from "@x402/cardano/exact/server";
import { CARDANO_NETWORK, type Config } from "./config.js";
import { buildReadinessReport, IdempotencyConflictError, ReadinessLedger } from "./readiness.js";
import { InvoiceSchema, type ReadinessReport } from "./types.js";

export const READINESS_PATH = "/v1/payment-readiness";

/**
 * Seller role: the CxC Payment Readiness API. Any agent can call it; each response costs
 * PRICE_LOVELACE on Cardano Preprod via x402 (`exact` scheme, `authorization` flow).
 */
export function mountSeller(app: Express, config: Config): void {
  const ledger = new ReadinessLedger();

  if (!config.SELLER_ADDRESS) {
    app.post(READINESS_PATH, (_req, res) => {
      res.status(503).json({ error: "x402 not configured: SELLER_ADDRESS missing" });
    });
    return;
  }

  const l1 = config.CARDANO_L1_CONFIRMATIONS;
  const extra = l1 !== undefined ? { confirmationPolicy: { l1Confirmations: Number(l1) } } : undefined;

  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: config.facilitatorUrl }));
  server.register(CARDANO_NETWORK, new ExactCardanoScheme());
  // The buyer only sees invalidReason; invalidMessage and settle errors exist only here.
  server
    .onAfterVerify(async ({ result }) => {
      if (!result.isValid) console.warn(`x402 verify rejected: ${result.invalidReason}${result.invalidMessage ? `: ${result.invalidMessage}` : ""}`);
    })
    .onVerifyFailure(async ({ error }) => console.warn(`x402 verify failed: ${error.message}`))
    .onSettleFailure(async ({ error }) => console.warn(`x402 settle failed: ${error.message}`));

  app.use(
    paymentMiddleware(
      {
        [`POST ${READINESS_PATH}`]: {
          accepts: {
            scheme: "exact",
            network: CARDANO_NETWORK,
            payTo: config.SELLER_ADDRESS,
            price: { amount: config.PRICE_LOVELACE.toString(), asset: "lovelace" },
            ...(extra ? { extra } : {}),
          },
          description: "CxC cross-border payment readiness report",
          mimeType: "application/json",
        },
      },
      server,
    ),
  );

  // Runs after x402 verify and before settle; the middleware withholds this body if
  // settlement fails. Must stay idempotent per Idempotency-Key (handler may be retried).
  app.post(READINESS_PATH, (req: Request, res: Response) => {
    const idempotencyKey = req.header("idempotency-key");
    if (!idempotencyKey) {
      res.status(400).json({ error: "Idempotency-Key header required" });
      return;
    }
    const parsed = InvoiceSchema.safeParse(req.body?.invoice);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid invoice", issues: parsed.error.issues });
      return;
    }
    let report: ReadinessReport;
    try {
      report = buildReadinessReport(parsed.data, idempotencyKey, ledger, {
        amountCeilingMinor: config.DEMO_AMOUNT_CEILING_MINOR,
      });
    } catch (error) {
      if (!(error instanceof IdempotencyConflictError)) throw error;
      res.status(409).json({ error: error.message }); // >= 400: the middleware cancels settlement
      return;
    }
    res.json(report);
  });
}
