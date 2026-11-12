// The chain ID behind a client, asked once per client instead of before every paid read.
//
// An HTTP or WebSocket transport is bound to one RPC URL for the client's lifetime, and the chain
// behind it does not change under that client, so its answer is kept with the client (a WeakMap:
// it lives exactly as long as the client). Every other transport - an injected EIP-1193 wallet can
// switch chains at any moment - is asked on every call, as before. A failed read is never kept: the
// next caller asks again. Callers still compare the answer with the expected chain on every use.

interface ChainIdSource {
  getChainId(): Promise<number>
  transport?: {type?: string}
}

const FIXED_URL_TRANSPORTS: ReadonlySet<string> = new Set(['http', 'webSocket'])
const known = new WeakMap<object, Promise<number>>()

/**
 * The chain ID `client`'s RPC answers: kept per client for an HTTP or WebSocket transport, read
 * afresh for any other. Rejections are not kept.
 * @param client viem public or wallet client.
 */
export function chainIdOf(client: ChainIdSource): Promise<number> {
  if (!FIXED_URL_TRANSPORTS.has(client.transport?.type ?? '')) return client.getChainId()
  const cached = known.get(client)
  if (cached) return cached
  const read = client.getChainId()
  known.set(client, read)
  read.catch(() => { if (known.get(client) === read) known.delete(client) })
  return read
}
