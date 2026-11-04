import {CipherSuite, HkdfSha256} from '@hpke/core'
import {DhkemX25519HkdfSha256} from '@hpke/dhkem-x25519'
import {Chacha20Poly1305} from '@hpke/chacha20poly1305'
import {base64Decode, base64Encode} from '../../src/crypto/envelope.js'
import {hexToBytes} from '../../src/crypto/hex.js'
import type {ClientRecipient} from '../../src/crypto/recipient.js'

const suite = new CipherSuite({kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305()})

/** Test keeper: seal a fixture's contribution after applying its adversarial mutations. */
export async function sealIbeFixture(row: Record<string, unknown>, client: ClientRecipient, requestHash: Uint8Array): Promise<Record<string, unknown>> {
  const {extraction_share, ...reply} = row
  const epoch = new Uint8Array(8)
  new DataView(epoch.buffer).setBigUint64(0, BigInt(row.epoch as number))
  const id = row.identifier as number
  const aad = new Uint8Array([...requestHash, id >>> 8, id & 255, ...epoch, ...base64Decode(row.verifying_share as string)])
  const pk = await suite.kem.deserializePublicKey(hexToBytes(client.recipient.public_key))
  const sealed = await suite.seal({recipientPublicKey: pk, info: new TextEncoder().encode('keykeeper:sealed-decryption-share:v1')}, base64Decode(extraction_share as string), aad)
  return {...reply, sealed_share: {enc: base64Encode(new Uint8Array(sealed.enc)), ciphertext: base64Encode(new Uint8Array(sealed.ct))}}
}
