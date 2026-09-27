// Compile-time API boundaries: these assertions fail if typed handles broaden accidentally.
import type {BlsSlot, EcdsaSlot, FrostSlot} from '../src/app/index.js'
type Assert<T extends true> = T
export type BlsCannotSignEthereum = Assert<'signDigest' extends keyof BlsSlot ? false : true>
export type EcdsaCannotDecrypt = Assert<'decrypt' extends keyof EcdsaSlot ? false : true>
export type FrostCannotDecrypt = Assert<'decrypt' extends keyof FrostSlot ? false : true>
export type AddressNeedsNoCredentials = Assert<Parameters<EcdsaSlot['getAddress']> extends [] ? true : false>
