/** Bounded duplicate-refusing JSON at the public evidence and private recovery boundary. */
export function parseExecutionJson(bytes: Uint8Array, maxBytes: number): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > maxBytes) throw new Error('Execution response exceeds its byte bound')
  try {
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes)
    let position = 0, nodes = 0
    const whitespace = () => {while (/^[\t\n\r ]$/.test(text[position] ?? '')) position++}
    const string = (): string => {
      const start = position++
      while (position < text.length) {
        const char = text[position++]
        if (char === '\\') position++
        else if (char === '"') {
          const decoded = JSON.parse(text.slice(start, position)) as string
          for (const point of decoded) {
            const code = point.charCodeAt(0)
            if (point.length === 1 && code >= 0xd800 && code <= 0xdfff) throw new Error('Invalid execution JSON Unicode scalar')
          }
          return decoded
        }
      }
      throw new Error('Unterminated execution JSON string')
    }
    const value = (depth: number): void => {
      if (depth > 32 || ++nodes > 65_536) throw new Error('Execution JSON exceeds its structural bound')
      whitespace()
      const char = text[position]
      if (char === '"') {string(); return}
      if (char === '{' || char === '[') {
        const object = char === '{', end = object ? '}' : ']', keys = new Set<string>()
        position++; whitespace()
        if (text[position] === end) {position++; return}
        while (position < text.length) {
          whitespace()
          if (object) {
            if (text[position] !== '"') throw new Error('Invalid execution JSON object key')
            const key = string()
            if (keys.has(key)) throw new Error('Duplicate execution JSON key')
            keys.add(key); whitespace()
            if (text[position++] !== ':') throw new Error('Invalid execution JSON object delimiter')
          }
          value(depth + 1); whitespace()
          if (text[position] === end) {position++; return}
          if (text[position++] !== ',') throw new Error('Invalid execution JSON delimiter')
        }
        throw new Error('Unterminated execution JSON container')
      }
      const start = position
      while (position < text.length && !/[\t\n\r ,\]}]/.test(text[position]!)) position++
      if (start === position) throw new Error('Invalid execution JSON value')
      const scalar: unknown = JSON.parse(text.slice(start, position))
      if (typeof scalar === 'number' && (!Number.isFinite(scalar) || Math.abs(scalar) > Number.MAX_SAFE_INTEGER)) throw new Error('Unsafe execution JSON number')
    }
    value(0); whitespace()
    if (position !== text.length) throw new Error('Trailing execution JSON bytes')
    return JSON.parse(text) as unknown
  } catch {throw new Error('Invalid or ambiguous execution response JSON')}
}
