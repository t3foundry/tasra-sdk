# Understand TASRA

TASRA lets your application sign transactions and protect data using keys managed
by a network of cooperating servers. The SDK connects your TypeScript application
to that network and handles the steps needed to use those keys.

Your first goal is to understand a **slot**, then connect without creating anything.

## What is a slot?

A slot is a network-managed key with a rule describing who may use it. It has a
public ID that your application saves and uses to find it again. A slot is not a
folder for documents or a user account in your database.

Choose its mode according to what your application needs:

| Application need | Slot mode |
|---|---|
| Send Ethereum transactions from an account | `ecdsa` |
| Sign a document or another exact message | `frost` |
| Encrypt data and control who can decrypt it | `bls` |

The cooperating servers are called **keepers**. Their signing threshold is separate
from the number of people allowed to use the slot.

## Creator and user

The **creator** sets up the slot, chooses its access rule and pays the required
network fees. A **user** satisfies that rule to request an operation. Creating a
slot does not automatically authorize every operation on it.

On Avalanche, the creator needs **AVAX for transaction fees**. The slot needs
**TASRA usage credits** before signing or decryption. Buy TASRA with EURC through
the bonding curve, then deposit it into the slot. The creation lesson walks you
through [funding](funding.md).

## Learn in this order

1. [Connect](getting-started.md) using a manifest downloaded from
   [tasra-releases](https://github.com/t3-foundry/tasra-releases).
2. [Create one slot](create-slot.md).
3. [Read its public state](read-slot.md).
4. [Manage its lifetime](manage-slot.md). Learn renewal first; keep the slot for
   later lessons and cancel it when finished.
5. [Give a user access](access-control.md).
6. [Sign or encrypt](signing-and-encryption.md), then add other workflows as needed.

**Next:** [Connect your first TypeScript application](getting-started.md).
