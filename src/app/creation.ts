import {toHex, type Address, type Hex} from 'viem'
import {createTasraWriteClient, type CommitRevealOptions, type CreateSlotArgs, type TasraWriteClient, type WriteClientWalletConfig} from '../chain/write.js'
import {TasraError} from '../errors.js'
import {protocolHex} from '../committee/receipts.js'
import {defineDeployment, type TasraDeployment} from './deployment.js'

export interface SlotCreationJournal {
  schemaVersion: 1
  deployment: TasraDeployment
  creator: Address
  /** Private durable data: includes the rule and its salt. Do not put in public evidence. */
  intent: CreateSlotArgs & {slotId: Hex; salt: Hex; ruleSalt: Hex}
  commit?: {phase: 'submitting' | 'submitted' | 'confirmed'; hash?: Hex}
  reveal?: {phase: 'submitting' | 'submitted' | 'confirmed'; hash?: Hex; seeded?: boolean}
  result?: Awaited<ReturnType<TasraWriteClient['createSlotCommitReveal']>>
}
export class CreationReconciliationRequiredError extends TasraError {
  constructor(readonly slotId: Hex, readonly step: 'commit' | 'reveal') {
    super(`${step} outcome is unknown for ${slotId}; recover its transaction hash before resuming`)
  }
}

/** Prepare without I/O. Save this private journal durably before requesting creation. */
export function prepareSlot(deployment: TasraDeployment, creator: Address, input: CreateSlotArgs): SlotCreationJournal {
  const config = defineDeployment(deployment)
  protocolHex(creator, 20, 'creator')
  if (!Number.isSafeInteger(input.k) || !Number.isSafeInteger(input.n) || input.k < 1 || input.k > input.n || input.n > 65535) throw new TasraError('Invalid slot threshold')
  if (!input.dcqlRule || input.exportable) throw new TasraError('Prepared creation requires a rule and a non-exportable slot')
  const random = () => toHex(crypto.getRandomValues(new Uint8Array(32)))
  const intent = {...structuredClone(input), slotId: input.slotId ?? random(), salt: input.salt ?? random(), ruleSalt: input.ruleSalt ?? random(), tags: input.tags?.slice() ?? ['keykeeper']}
  for (const field of ['slotId', 'salt', 'ruleSalt'] as const) protocolHex(intent[field], 32, field)
  return {schemaVersion: 1, deployment: structuredClone(config), creator, intent}
}

/**
 * Create or resume ONE persisted intent. The store must atomically save each snapshot
 * before resolving and serialize runs for this intent (one process/tab at a time).
 * Known transaction hashes are waited on, never resubmitted. If a transport or crash
 * loses a submission hash, reconcile with the wallet before resuming. Abort stops local
 * work; it cannot cancel a transaction already submitted to the network.
 * Returns after on-chain creation; DKG and creator provisioning are separate stages.
 */
export async function createPreparedSlot(input: SlotCreationJournal, config: {
  wallet: WriteClientWalletConfig['wallet']
  persist: (journal: SlotCreationJournal) => Promise<void>
  options?: Omit<CommitRevealOptions, 'recovery'>
}): Promise<SlotCreationJournal> {
  const journal = structuredClone(input), deployment = defineDeployment(journal.deployment)
  if (journal.schemaVersion !== 1 || !journal.intent.slotId || !journal.intent.ruleSalt || !journal.intent.salt) throw new TasraError('Incomplete creation journal')
  prepareSlot(deployment, journal.creator, journal.intent)
  if (config.wallet.account.address.toLowerCase() !== journal.creator.toLowerCase() || config.wallet.chain.id !== deployment.chainId) throw new TasraError('Creation wallet differs from the saved creator or chain')
  config.options?.signal?.throwIfAborted()
  for (const step of ['commit', 'reveal'] as const) {
    if (journal[step] && !journal[step].hash) throw new CreationReconciliationRequiredError(journal.intent.slotId, step)
    if (journal[step]?.hash) protocolHex(journal[step].hash, 32, `${step} hash`)
  }
  if (journal.reveal && !journal.commit) throw new TasraError('Reveal journal has no commit')
  const writer = createTasraWriteClient({rpcUrl: deployment.rpcUrl, addresses: deployment.addresses, chainId: deployment.chainId, wallet: config.wallet})
  if (await writer.pub.getChainId() !== deployment.chainId) throw new TasraError('Creation RPC chain differs from the saved deployment')
  // Even a fresh journal is persisted here: a caller cannot accidentally omit the initial save.
  await config.persist(structuredClone(journal))
  const result = await writer.createSlotCommitReveal({...journal.intent, ...config.options, recovery: {
    commitTx: journal.commit?.hash, revealTx: journal.reveal?.hash, seeded: journal.reveal?.seeded,
    async onTransaction(event) {
      journal[event.step] = {phase: event.phase, hash: event.hash, ...(event.step === 'reveal' ? {seeded: event.seeded} : {})}
      await config.persist(structuredClone(journal))
    },
  }})
  journal.result = result
  await config.persist(structuredClone(journal))
  return journal
}
