import { bech32 } from "@scure/base";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bech32Encode, cardanoAddressFromHex } from "../web/src/shared/bech32.js";

// @scure/base (already installed with @scure/bip39) is the reference implementation here.
const reference = (hrp: string, bytes: Uint8Array) => bech32.encode(hrp, bech32.toWords(bytes), false);

describe("bech32 for CIP-30 wallet addresses", () => {
  it("matches the BIP-173 vectors", () => {
    expect(bech32Encode("a", new Uint8Array())).toBe("a12uel5l");
    expect(reference("a", new Uint8Array())).toBe("a12uel5l");
  });

  it("matches the reference for address-sized byte strings", () => {
    for (const size of [29, 57, 1, 64]) {
      for (let i = 0; i < 20; i++) {
        const bytes = new Uint8Array(randomBytes(size));
        expect(bech32Encode("addr_test", bytes)).toBe(reference("addr_test", bytes));
      }
    }
  });

  it("turns a wallet's hex bytes back into the CIP-19 address, raw or CBOR-wrapped", () => {
    // CIP-19 test vectors: a base address (type 0) and an enterprise address (type 6) on testnet.
    for (const address of [
      "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae",
      "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz",
    ]) {
      const bytes = Uint8Array.from(bech32.fromWords(bech32.decode(address as `${string}1${string}`, false).words));
      const hex = Buffer.from(bytes).toString("hex");
      expect(cardanoAddressFromHex(hex)).toBe(address);
      expect(cardanoAddressFromHex(`58${bytes.length.toString(16).padStart(2, "0")}${hex}`)).toBe(address);
    }
  });

  it("names mainnet and stake addresses by their header, and refuses Byron", () => {
    const base = new Uint8Array(57);
    base[0] = 0x01; // type 0, mainnet
    expect(cardanoAddressFromHex(Buffer.from(base).toString("hex"))).toMatch(/^addr1/);
    const stake = new Uint8Array(29);
    stake[0] = 0xe0; // reward address, testnet
    expect(cardanoAddressFromHex(Buffer.from(stake).toString("hex"))).toMatch(/^stake_test1/);
    expect(() => cardanoAddressFromHex("82d818")).toThrow(/unsupported/);
  });
});
