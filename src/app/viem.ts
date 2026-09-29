import {hashMessage, hashTypedData, keccak256, serializeSignature, serializeTransaction, hexToBytes, toHex, recoverAddress,
  type Hex, type LocalAccount, type TransactionSerializable, type TypedDataDefinition} from 'viem'
import {toAccount} from 'viem/accounts'
import type {AuthorizedOperationOptions, EcdsaSlot} from './client.js'
import {TasraApplicationError} from './client.js'

/**
 * Use a Tasra slot as a viem account. Every signing call gets fresh authorization;
 * this adapter never broadcasts a transaction. Pass it to viem's createWalletClient.
 * @param slot Ready threshold ECDSA slot.
 * @param options Fresh authorization callback and operation controls.
 * @returns Viem account that verifies signatures before returning them.
 */
export async function toViemAccount(slot: EcdsaSlot, options: AuthorizedOperationOptions): Promise<LocalAccount> {
  const address = await slot.getAddress()
  const sign = async (hash: Hex) => {
    if ((await slot.getAddress()).toLowerCase() !== address.toLowerCase()) throw new TasraApplicationError('SLOT_CHANGED', 'Slot account changed; construct a new viem account')
    const result = await slot.signDigest(hexToBytes(hash), options)
    const signature = {r: toHex(result.r), s: toHex(result.s), yParity: result.yParity}
    if ((await recoverAddress({hash, signature})).toLowerCase() !== address.toLowerCase()) throw new TasraApplicationError('SLOT_CHANGED', 'Signature belongs to a different account; construct a new viem account')
    return signature
  }
  return toAccount({address,
    async sign({hash}) { return serializeSignature(await sign(hash)) },
    async signMessage({message}) { return serializeSignature(await sign(hashMessage(message))) },
    async signTypedData(data) { return serializeSignature(await sign(hashTypedData(data as TypedDataDefinition))) },
    async signTransaction(transaction, serializerOptions) {
      const serialize = (serializerOptions?.serializer ?? serializeTransaction) as (tx: TransactionSerializable, signature?: {r: Hex; s: Hex; yParity: number}) => Hex
      const tx = transaction as TransactionSerializable
      return serialize(tx, await sign(keccak256(serialize(tx))))
    },
  })
}
