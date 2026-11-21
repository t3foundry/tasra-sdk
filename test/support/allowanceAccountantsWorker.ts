// Three fake ADR-0090 accountants on 127.0.0.1, in a worker thread so their signing never runs on the
// event loop under measurement. Each answers `POST /v1/prepaid/allowances/{id}/debits` with a REAL
// BN254 partial of the fixture's 2-of-3 sharing (keykeeper-bls's fixture_2_of_3 polynomial, the same
// derivation as allowanceFixture.ts) and acknowledges `POST .../vouchers`. Posts `{ports}` when listening.
//
// Overlap is COUNTED here, never timed: each member records the peak number of debits it holds at
// once. `{hold: n}` (a message) makes every member hold its debits until n are in flight at that
// member (a 30 s hang guard releases them otherwise; acknowledged `{held: n}` before any debit it
// governs is sent), so rounds that overlap reach n on any host
// while rounds run one after another never do; `{peaks: true}` answers `{peaks}` per member.
import {createServer, type IncomingMessage} from 'node:http'
import {parentPort, workerData} from 'node:worker_threads'
import type {AddressInfo} from 'node:net'
import {keccak_256} from '@noble/hashes/sha3'
import {bn254, bn254_Fr} from '@noble/curves/bn254'
import {bytesToNumberBE} from '@noble/curves/utils.js'
import {toHex, type Hex} from 'viem'
import {debitVoucherDigest, prepaidRequestId, type PaymentIntentWire} from '../../src/committee/payment.js'
import {encodeG1, encodeG2, hashToG1} from '../../src/crypto/bn254.js'
import {hexToBytes} from '../../src/crypto/hex.js'

const {settlement, latencyMs} = workerData as {settlement: Hex; latencyMs: number}
const fr = (label: string) => bn254_Fr.create(bytesToNumberBE(keccak_256(new TextEncoder().encode(label))))
const a0 = fr('keykeeper/bn254/test/a0'), a1 = fr('keykeeper/bn254/test/a1')
const shares = [1n, 2n, 3n].map(x => bn254_Fr.add(a0, bn254_Fr.mul(a1, x)))
const verifyingShares = shares.map(s => toHex(encodeG2(bn254.G2.ProjectivePoint.BASE.multiply(s))))
const sharing = `0x${'5e'.repeat(32)}`

const HOLD_GUARD_MS = 30_000
const inFlight = [0, 0, 0], peaks = [0, 0, 0]
let hold = 0
let gates: Array<{open: Promise<void>; release: () => void}> = []
const gate = () => { let release!: () => void; const open = new Promise<void>(resolve => { release = resolve }); return {open, release} }
parentPort!.on('message', (message: {hold?: number; peaks?: true}) => {
  if (message.hold !== undefined) { hold = message.hold; peaks.fill(0); gates = [gate(), gate(), gate()]; parentPort!.postMessage({held: hold}) }
  if (message.peaks) parentPort!.postMessage({peaks: [...peaks]})
})

const read = async (request: IncomingMessage) => { const chunks: Buffer[] = []; for await (const c of request) chunks.push(c as Buffer); return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> }

const ports = await Promise.all([0, 1, 2].map(member => new Promise<number>(listening => {
  const server = createServer((request, response) => {
    void (async () => {
      const body = await read(request)
      const send = (value: unknown) => { response.writeHead(200, {'content-type': 'application/json'}); response.end(JSON.stringify(value)) }
      if (request.url?.endsWith('/vouchers')) {
        await new Promise(resolve => setTimeout(resolve, latencyMs))
        return send({seq: body.seq, recorded: 'attached'})
      }
      peaks[member] = Math.max(peaks[member]!, ++inFlight[member]!)
      try {
        if (hold > 0) {
          if (inFlight[member]! >= hold) gates[member]!.release()
          let guard: ReturnType<typeof setTimeout> | undefined
          await Promise.race([gates[member]!.open, new Promise(resolve => { guard = setTimeout(resolve, HOLD_GUARD_MS) })])
          clearTimeout(guard)
        }
        await new Promise(resolve => setTimeout(resolve, latencyMs))
      } finally { inFlight[member]!-- }
      const r = body as {intent: PaymentIntentWire; seq: number; previous: {cumulative: string} | null; quote_block: Hex}
      const cost = 40n, cumulative = (r.previous ? BigInt(r.previous.cumulative) : 0n) + cost, requestId = prepaidRequestId(r.intent)
      const digest = debitVoucherDigest(settlement, 43112, {allowanceId: r.intent.allowance_id!, seq: BigInt(r.seq), requestId, cost, cumulative, quoteBlock: r.quote_block})
      send({allowance_id: r.intent.allowance_id, seq: r.seq, request_id: requestId, cost: cost.toString(), cumulative: cumulative.toString(), quote_block: r.quote_block,
        digest, identifier: member + 1, partial: toHex(encodeG1(hashToG1(hexToBytes(digest)).multiply(shares[member]!))), verifying_share: verifyingShares[member],
        sharing, threshold: 2, members: 3})
    })().catch(() => { response.writeHead(500); response.end('fixture failure') })
  })
  server.listen(0, '127.0.0.1', () => listening((server.address() as AddressInfo).port))
})))
parentPort!.postMessage({ports})
