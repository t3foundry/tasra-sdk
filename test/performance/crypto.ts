// Offline fixture keys only. Keep workload changes visible through the runner's protocol hash.
import assert from 'node:assert/strict'
import {bls12_381 as bls} from '@noble/curves/bls12-381'
import {assembleKey, decryptWithMasterKey, scalarToLe} from '../../src/crypto/kem.ts'
import {encryptEnvelope, fromBytes, toBytes} from '../../src/crypto/envelope.ts'

const key = scalarToLe(123456789n)
const publicKey = bls.G2.ProjectivePoint.BASE.multiply(123456789n).toRawBytes(true)
const slot = new Uint8Array(32).fill(7)
const identity = new TextEncoder().encode('offline-performance-fixture')
const plaintext = new Uint8Array(1024).fill(42)
const encrypted = encryptEnvelope(slot, publicKey, identity, plaintext, 0n)
const shards = [1, 2, 3].map(id => ({id, bytes: scalarToLe(123456789n + 31n * BigInt(id) + 17n * BigInt(id) ** 2n)}))
const sampleCount = 7
const warmup = 2

function measure<T>(name: string, iterations: number, operation: () => T, verify: (result: T) => void) {
  const millisecondsPerOperation: number[] = []
  for (let batch = -warmup; batch < sampleCount; batch++) {
    const outputs: T[] = []
    const start = performance.now()
    for (let iteration = 0; iteration < iterations; iteration++) outputs.push(operation())
    const elapsed = performance.now() - start
    for (const output of outputs) verify(output)
    assert.ok(Number.isFinite(elapsed) && elapsed > 0, 'measurement must be positive')
    if (batch >= 0) millisecondsPerOperation.push(elapsed / iterations)
  }
  return {name, iterations, millisecondsPerOperation}
}

const measurements = [
  measure('encrypt-1KiB', 8,
    () => encryptEnvelope(slot, publicKey, identity, plaintext, 0n),
    envelope => assert.deepEqual(decryptWithMasterKey(key, envelope.ciphertext, identity), plaintext)),
  measure('decrypt-1KiB', 8,
    () => decryptWithMasterKey(key, encrypted.ciphertext, identity),
    output => assert.deepEqual(output, plaintext)),
  measure('serialize-roundtrip-1KiB', 500,
    () => fromBytes(toBytes(encrypted)),
    output => assert.deepEqual(output, encrypted)),
  measure('assemble-3-shards', 500,
    () => assembleKey(shards),
    output => assert.deepEqual(output, key)),
]
console.log(JSON.stringify({measurements, correctness: 'every output asserted outside timed sections'}))
