/** Alice and Bob use separate credentials to send from one threshold Ethereum account. */
import {randomBytes} from 'node:crypto'
import {createTutorial, stopped} from './tutorial-support.js'

async function main() {
  // 1. Public manifest, fresh creator wallet, issuer and holder credentials.
  const {tasra, awaitUsageCredit, wallet: creator, store, directory, save, policy, authorize, proveServerRefusal} =
    await createTutorial('shared-account', 'TreasurySigner', 'treasury-signer')

  // 2. The SDK commits the policy, creates the slot, waits for keys and provisions it.
  const account = await tasra.slots.create({name: 'treasury', mode: 'ecdsa', policy: policy(['alice', 'bob']),
    threshold: {k: 2, n: 3}, verifiers: {committee: 3, quorum: 2}})
  await awaitUsageCredit(account.slotId)
  const address = await account.getAddress()
  await creator.transfer('fund-treasury', {to: address, value: 10n ** 16n}, store)
  console.log(`Shared Ethereum account: ${address} (slot ${account.slotId})`)

  // 3. Each holder authorizes a transfer. The SDK signs, journals and confirms it.
  const receipts = []
  for (const name of ['alice', 'bob']) {
    const wallet = await tasra.wallets.fromSlot(account.slotId, {authorize: authorize(name),
      description: `${name}: treasury self-transfer`, signal: AbortSignal.timeout(120_000)})
    const nonce = await wallet.getTransactionCount()
    const transaction = await wallet.transfer(`${name}-transfer`, {to: address, value: 0n}, store)
    if (!transaction.receipt || !transaction.hash || transaction.receipt.from.toLowerCase() !== address.toLowerCase()) {
      throw new Error('Missing confirmed transaction from the shared account')
    }
    save(`${name}-receipt.json`, transaction.receipt)
    receipts.push({user: name, hash: transaction.hash, nonce, from: transaction.receipt.from,
      blockNumber: transaction.receipt.blockNumber.toString()})
    console.log(`${name}: confirmed ${transaction.hash} (nonce ${nonce})`)
  }
  if (receipts.map(receipt => receipt.nonce).join(',') !== '0,1') throw new Error('Unexpected shared-account nonces')

  // 4. Prove Mallory is refused by the server, not merely filtered by the wallet.
  const nonceBefore = await tasra.chain.client.getTransactionCount({address, blockTag: 'pending'})
  const result = await proveServerRefusal(account.slotId, 'mallory', 'sign', {message: randomBytes(32)})
  const nonceAfter = await tasra.chain.client.getTransactionCount({address, blockTag: 'pending'})
  if (nonceAfter !== nonceBefore) throw new Error('Account nonce changed during denial check')
  save('evidence.json', {chainId: tasra.deployment.chainId, addresses: tasra.deployment.addresses,
    slotId: account.slotId, address, createdAt: new Date().toISOString(), receipts,
    mallory: {result, nonceBefore, nonceAfter}})
  console.log(`PASS: Alice and Bob used one account; Mallory was refused. Evidence: ${directory}/evidence.json`)
}

main().catch(stopped)
