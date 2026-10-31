// Bech32 (BIP-173) encoding, enough to turn the hex address bytes a CIP-30 wallet returns into the
// addr_test1… form. Cardano addresses exceed BIP-173's 90-character limit, which Cardano lifts.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATOR[i]!;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const codes = [...hrp].map(c => c.charCodeAt(0));
  return [...codes.map(c => c >> 5), 0, ...codes.map(c => c & 31)];
}

/** 8-bit bytes to 5-bit words, zero-padded at the end. */
export function toWords(bytes: Uint8Array): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = ((acc << 8) | b) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

export function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const words = toWords(bytes);
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map(w => CHARSET[w]).join("")}`;
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new Error("not hex");
  return Uint8Array.from(hex.match(/../g)!, h => parseInt(h, 16));
}

/**
 * A Cardano Shelley address from the hex bytes a CIP-30 wallet returns, as bech32. Also takes the
 * bytes wrapped as a CBOR byte string, which some wallets returned before CIP-30 settled on raw bytes.
 * Throws for Byron and unknown address types.
 */
export function cardanoAddressFromHex(hex: string): string {
  let bytes = hexToBytes(hex);
  // 0x58 <len>: a CBOR byte string. As a raw header it would be a pointer address on network 8, which does not exist.
  if (bytes[0] === 0x58 && bytes[1] === bytes.length - 2) bytes = bytes.subarray(2);
  const header = bytes[0];
  if (header === undefined) throw new Error("empty address");
  const type = header >> 4;
  const testnet = (header & 0x0f) === 0;
  if (type <= 7) return bech32Encode(testnet ? "addr_test" : "addr", bytes);
  if (type === 14 || type === 15) return bech32Encode(testnet ? "stake_test" : "stake", bytes);
  throw new Error("unsupported Cardano address type");
}
