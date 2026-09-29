import {fromBytes, type GroupEnvelope} from './envelope.js'
import {base64Decode, base64Encode} from './envelope.js'
import {KK_MIN_B64_LEN, KK_PREFIX} from './constants.js'

// Returns true when the post text carries a Tasra encrypted envelope.
/**
 * Check the Tasra text prefix and minimum length. This does not validate the envelope.
 *
 * @param text - Text payload to inspect for the Tasra prefix.
 */
export function isTasraPost(text: string): boolean {
  return (
    text.startsWith(KK_PREFIX) &&
    text.length >= KK_PREFIX.length + KK_MIN_B64_LEN
  )
}

// Extract the base64 envelope string from a Tasra post text.
export function extractEnvelopeB64(text: string): string {
  return text.slice(KK_PREFIX.length)
}

// Parse the envelope from a Tasra post text. Returns null on malformed input.
/**
 * Decode a Tasra text payload into an envelope; return null for invalid input.
 *
 * @param text - Text payload to inspect and decode.
 */
export function parseTasraPost(text: string): GroupEnvelope | null {
  if (!isTasraPost(text)) return null
  try {
    const b64 = extractEnvelopeB64(text)
    const bytes = base64Decode(b64)
    return fromBytes(bytes)
  } catch {
    return null
  }
}

// Build the post text for an encrypted message.
/**
 * Encode serialized envelope bytes as a Tasra encrypted text payload.
 *
 * @param envelopeBytes - Binary envelope produced by the envelope serializer.
 */
export function buildTasraText(envelopeBytes: Uint8Array): string {
  return `${KK_PREFIX}${base64Encode(envelopeBytes)}`
}
