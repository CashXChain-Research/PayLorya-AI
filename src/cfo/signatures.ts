/**
 * Payments waiting for their owner's wallet signature. In memory, like the execution that waits on
 * it: a restart drops the wait, the payment then fails and nothing was paid (the transaction was
 * never signed). Keyed by workspace and payment; a delivery must name the transaction it signs.
 */
export class SignatureDesk {
  private readonly waiting = new Map<string, { txHash: string; resolve: (witnessSet: string) => void; reject: (error: Error) => void }>();

  /** Waits for the witness set of `txHash`; rejects after `timeoutMs` or when declined. */
  wait(key: string, txHash: string, timeoutMs: number): Promise<string> {
    this.waiting.get(key)?.reject(new Error("A newer transaction replaced this one"));
    return new Promise<string>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        if (this.waiting.get(key)?.txHash === txHash) this.waiting.delete(key);
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error("Not signed in time: nothing was paid. Approve the payment again to retry."));
      }, timeoutMs);
      this.waiting.set(key, {
        txHash,
        resolve: w => (done(), resolve(w)),
        reject: e => (done(), reject(e)),
      });
    });
  }

  /** "delivered", or why not: nothing is waiting, or the signature is for another transaction. */
  deliver(key: string, txHash: string, witnessSet: string): "delivered" | "not_waiting" | "other_tx" {
    const w = this.waiting.get(key);
    if (!w) return "not_waiting";
    if (w.txHash !== txHash) return "other_tx";
    w.resolve(witnessSet);
    return "delivered";
  }

  decline(key: string): boolean {
    const w = this.waiting.get(key);
    if (!w) return false;
    w.reject(new Error("Declined in the wallet: nothing was paid."));
    return true;
  }
}
