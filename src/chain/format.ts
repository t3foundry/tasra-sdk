// Display/format helpers for on-chain values. Pure, dependency-free.

/**
 * Abbreviate an address or hash by retaining its leading and trailing digits.
 * @param hex Address or hash, with or without a hexadecimal prefix.
 * @param lead Number of leading hexadecimal digits to retain.
 * @param tail Number of trailing hexadecimal digits to retain.
 */
export function truncateHex(hex: string, lead = 6, tail = 4): string {
  if (!hex) return ''
  const h = hex.startsWith('0x') ? hex : `0x${hex}`
  if (h.length <= 2 + lead + tail) return h
  return `${h.slice(0, 2 + lead)}…${h.slice(-tail)}`
}

/**
 * Format a token amount with thousands separators and truncated fractional digits.
 * @param value Signed integer amount in token base units.
 * @param decimals Number of decimal places used by the token.
 * @param maxFractionDigits Maximum fractional digits retained without rounding.
 */
export function formatUnits(
  value: bigint,
  decimals = 18,
  maxFractionDigits = 4,
): string {
  const neg = value < 0n
  const v = neg ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = v / base
  const frac = v % base
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (maxFractionDigits === 0 || frac === 0n) {
    return `${neg ? '-' : ''}${wholeStr}`
  }
  let fracStr = frac.toString().padStart(decimals, '0').slice(0, maxFractionDigits)
  fracStr = fracStr.replace(/0+$/, '')
  return `${neg ? '-' : ''}${wholeStr}${fracStr ? `.${fracStr}` : ''}`
}

/**
 * Format a basis-points integer (e.g. 1000) as a percentage string ("10%").
 * @param bps Rate in basis points, where 100 basis points is one percent.
 */
export function formatBps(bps: number | bigint): string {
  const n = Number(bps) / 100
  return `${Number.isInteger(n) ? n : n.toFixed(2)}%`
}

/**
 * WAD (1e18 fixed-point) value to a decimal string, e.g. a price.
 * @param wad Signed integer value scaled by 10 to the power of 18.
 * @param maxFractionDigits Maximum fractional digits retained without rounding.
 */
export function formatWad(wad: bigint, maxFractionDigits = 6): string {
  return formatUnits(wad, 18, maxFractionDigits)
}
