// Bounded memoization of EIP-712 hashing and signer recovery for the paid hot path.
//
// One paid operation rebuilds the same payment, certificate and stage typed data many times
// (every approval reconstructs and then re-verifies them), and each rebuild re-ran the JS
// keccak of every type string and every secp256k1 recovery. Both are PURE functions of their
// exact inputs, so the cache key is the complete input: the domain, primary type, type list and
// message for a hash, and the exact digest plus signature bytes for a recovery. Nothing here
// skips a check: callers still compare the recovered address against their own policy, and an
// input that cannot be keyed unambiguously is simply computed without the cache.
import {hashTypedData, recoverAddress, type Address, type Hex, type TypedDataDefinition} from 'viem'
import {BoundedCache} from './bounded.js'

const hashes = new BoundedCache<string, Hex>(1024)
const signers = new BoundedCache<string, Address>(1024)

// Values the SDK builds typed data from: strings, safe numbers, bigints, booleans, plain
// objects and arrays. Anything else (undefined, NaN, functions, class instances) makes the
// JSON form ambiguous, so it is not keyed at all.
function keyPart(this: unknown, key: string, value: unknown): unknown {
  // Key the holder's own DATA property, never a getter or a toJSON substitute: only a value that
  // reads the same every time can stand for what hashTypedData will read.
  const descriptor = Object.getOwnPropertyDescriptor(this as object, key)
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('unkeyable accessor')
  const original: unknown = descriptor.value
  if (typeof original === 'bigint') return {'\u0000bigint': original.toString()}
  if (original !== value || (original !== null && typeof original === 'object' && 'toJSON' in original)) throw new Error('unkeyable substitute')
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('unkeyable number')
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') throw new Error('unkeyable value')
  if (value !== null && typeof value === 'object') {
    const array = Array.isArray(value)
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('unkeyable object')
    // Every own property must be an enumerable string key (an array's length aside): a hidden
    // field is read by hashTypedData but would be missing from the JSON key.
    if (Object.getOwnPropertySymbols(value).length
      || Object.getOwnPropertyNames(value).length !== Object.keys(value).length + (array ? 1 : 0)) throw new Error('unkeyable hidden property')
  }
  return value
}
function typedDataKey(td: TypedDataDefinition): string | undefined {
  try { return JSON.stringify([td.domain, td.primaryType, td.types, td.message], keyPart) } catch { return undefined }
}

/**
 * `hashTypedData` memoized by the complete typed data (domain, primary type, types, message).
 * @param td Typed data built by the SDK.
 */
export function typedDataHash(td: TypedDataDefinition): Hex {
  const key = typedDataKey(td)
  return key === undefined ? hashTypedData(td) : hashes.getOrCompute(key, () => hashTypedData(td))
}

/**
 * `recoverTypedDataAddress` memoized by the exact digest and signature bytes. The caller still
 * compares the returned address with the signer it independently expects.
 * @param td Typed data the signature claims to sign.
 * @param signature 65-byte hex signature.
 */
export async function recoverTypedDataSigner(td: TypedDataDefinition, signature: Hex): Promise<Address> {
  const hash = typedDataHash(td)
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]*$/.test(signature)) return recoverAddress({hash, signature})
  const key = hash + ':' + signature.slice(2).toLowerCase()
  const known = signers.peek(key)
  if (known !== undefined) return known
  const address = await recoverAddress({hash, signature})
  signers.getOrCompute(key, () => address)
  return address
}
