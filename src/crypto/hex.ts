// Utility: 0x-prefixed hex string to Uint8Array (32 bytes for slot IDs).
/**
 * Decode hexadecimal text, accepting an optional 0x prefix. Reject odd-length input; callers must validate hexadecimal characters before decoding.
 *
 * @param hex - Hexadecimal bytes, with an optional 0x prefix.
 */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length hex string: ${clean}`)
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

// Utility: Uint8Array to 0x-prefixed hex string.
export function bytesToHex(bytes: Uint8Array): string {
  return (
    '0x' +
    Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  )
}
