import {beforeEach, expect, it, vi} from 'vitest'
import {registeredWalletAuthorization} from '../../src/app/authorization.js'
import type {AuthorizationRequest} from '../../src/app/client.js'
const mocks = vi.hoisted(() => ({open: vi.fn(), result: vi.fn()}))
vi.mock('../../src/chain/registeredOperation.js', () => ({openRegisteredVerifierAgentSession: mocks.open, awaitRegisteredVerifierAgentResult: mocks.result}))
beforeEach(() => {vi.clearAllMocks(); mocks.open.mockResolvedValue({sessionId: 'session'}); mocks.result.mockResolvedValue({token: {slot_id: 'slot'}, verifierProofs: [{}]})})
const request = {chainId: 43112, slotId: '0x' + '01'.repeat(32), action: 'sign', message: new Uint8Array([1]), description: 'Sign note'} as AuthorizationRequest
const client = {} as Parameters<typeof registeredWalletAuthorization>[0]['client']
const signer = {address: `0x${'11'.repeat(20)}` as const, signTypedData: vi.fn()}
it('presents and polls the original registered session with cancellation and progress', async () => {
  const present = vi.fn(), onPhase = vi.fn(), signal = new AbortController().signal
  const authorize = registeredWalletAuthorization({client, signer, present, onPhase, timeoutMs: 1000})
  expect(await authorize({...request, signal})).toMatchObject({token: {slot_id: 'slot'}})
  expect(mocks.open).toHaveBeenCalledWith(client, {...request, signal, signer, delegation: undefined})
  expect(present).toHaveBeenCalledWith({sessionId: 'session'}, signal)
  expect(mocks.result).toHaveBeenCalledWith({sessionId: 'session'}, {signal, onPhase, timeoutMs: 1000})
})
it('does not poll or fall back when presentation fails or is cancelled', async () => {
  await expect(registeredWalletAuthorization({client, signer, present: async () => {throw new Error('wallet refused')}})(request)).rejects.toThrow('wallet refused')
  const controller = new AbortController()
  await expect(registeredWalletAuthorization({client, signer, present: async () => {controller.abort()}})({...request, signal: controller.signal})).rejects.toThrow()
  expect(mocks.result).not.toHaveBeenCalled()
})
it('refuses a grant without verifier membership proofs', async () => {
  mocks.result.mockResolvedValue({token: {}})
  await expect(registeredWalletAuthorization({client, signer, present: vi.fn()})(request)).rejects.toThrow('proofs')
})
