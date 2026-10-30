import type { Express } from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { toFacilitatorCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme } from "@x402/cardano/exact/facilitator";
import { blockfrostProvider, CARDANO_NETWORK, type Config } from "./config.js";

/**
 * Fallback facilitator, mounted at /facilitator when LOCAL_FACILITATOR=true.
 * Provider-only: it verifies and broadcasts the buyer-signed tx, holds no funds and no keys.
 */
export function mountLocalFacilitator(app: Express, config: Config): void {
  const signer = toFacilitatorCardanoSigner({
    network: CARDANO_NETWORK,
    provider: blockfrostProvider(config),
    awaitConfirmation: false,
  });
  const facilitator = new x402Facilitator().register(
    CARDANO_NETWORK,
    new ExactCardanoScheme(signer, { acceptMempool: config.CARDANO_L1_CONFIRMATIONS === "-1" }),
  );

  app.post("/facilitator/verify", async (req, res) => {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload?: PaymentPayload;
      paymentRequirements?: PaymentRequirements;
    };
    if (!paymentPayload || !paymentRequirements) {
      res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
      return;
    }
    try {
      res.json(await facilitator.verify(paymentPayload, paymentRequirements));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/facilitator/settle", async (req, res) => {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload?: PaymentPayload;
      paymentRequirements?: PaymentRequirements;
    };
    if (!paymentPayload || !paymentRequirements) {
      res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
      return;
    }
    try {
      res.json(await facilitator.settle(paymentPayload, paymentRequirements));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/facilitator/supported", (_req, res) => {
    res.json(facilitator.getSupported());
  });
}
