# Fund a slot for use

Creating a slot prepares its key and access policy. Before signing or decrypting,
add **TASRA usage credits**. The token symbol used by the SDK is **TSRA**.

There are three steps:

1. Send **AVAX to the creator wallet** to pay transaction gas.
2. Buy **TSRA with EURC** from the network's **BondingCurve** contract.
3. Deposit **TSRA into the slot's Settlement balance**.

AVAX is not sent to a slot ID. An Ethereum slot's derived account separately needs
AVAX when it sends Ethereum transactions. Its account balance is not usage credit.

## 1. Fund the creator with AVAX

Run the [creation lesson](create-slot.md) to print your saved creator address.
For the downloaded Fuji manifest, use the
[official Avalanche Fuji C-Chain faucet](https://core.app/tools/testnet-faucet/?subnet=c&token=c)
and send test AVAX to that `0x` address on chain **43113**. The faucet may require
eligibility or a coupon; see [Avalanche's instructions](https://support.avax.network/en/articles/6110239-is-there-an-avax-faucet).
You can also transfer AVAX from a wallet you control on the same network.

Keep enough AVAX for creation, token approvals, purchases and deposits. Then rerun
creation. A nonzero gas balance does not guarantee every transaction can be paid.

## 2. Inspect the saved account and slot

Continue in the same project with its original `network.json`, `network-pin.json`
and private `.tasra/` state. Copy the funding command:

```sh
cp node_modules/tasra-sdk/examples/fund-slot.ts .
npx tsc --noEmit
npx tsx fund-slot.ts .tasra/first-slot status
```

For an application tutorial, replace `.tasra/first-slot` with the directory printed
by that app. It prints a complete status command when its slot needs credit.
The command restores the creator key; it never creates a replacement account.

Keep a terminal demo running while funding it in a second terminal, from the same
project directory. It waits up to 15 minutes. If it has exited, rerunning that demo
creates fresh state; funding its old slot will not resume the exited run. The first-slot
lessons and the web document app save state for later runs.

## 3. Buy TSRA with EURC

The curve accepts **EURC, not AVAX**. First obtain the EURC token configured by your
manifest. The Fuji deployment uses test EURC; this optional command explicitly
mints **10 test EURC** to the saved creator:

```sh
npx tsx fund-slot.ts .tasra/first-slot mint-test-eurc 10000000
```

The SDK permits this only for a supported mock token. Real EURC must be acquired
and transferred to your creator wallet; it cannot be minted with this command.

Choose how much EURC to spend and the smallest TSRA output you will accept.
The following example spends **10 EURC** and requires at least **1 TSRA**. It reverts
if the curve cannot satisfy that minimum; these amounts are an example budget,
not a quoted exchange rate or a guarantee of how many operations you can run.

```sh
npx tsx fund-slot.ts .tasra/first-slot buy 10000000 1000000000000000000
```

Internally the command uses two confirmed SDK calls:

```ts
await writer.approveEurcForCurve(eurcAmount)
await writer.buyTsra(eurcAmount, minimumTsraOut)
```

**Success:** an approval hash, purchase hash and updated wallet TSRA balance.
Buying TSRA does not automatically credit a slot.

## 4. Deposit TSRA into the slot

This example deposits **1 TSRA** from your saved creator wallet:

```sh
npx tsx fund-slot.ts .tasra/first-slot fund 1000000000000000000
npx tsx fund-slot.ts .tasra/first-slot status
```

The SDK approves Settlement and confirms the deposit:

```ts
const {fundTx} = await writer.fundSlot(slotId, slotCredits)
console.log('Funding transaction:', fundTx)
console.log('Slot credit:', await writer.settlementBalance(slotId))
```

**Success:** a funding transaction hash and nonzero slot TSRA credit. Usage consumes
credit; top up according to the selected network's charges. A positive balance
alone does not guarantee sufficient credit for every operation.

All command amounts are **integer base units**: EURC has 6 decimals and TSRA has
18. The output labels these units. No extra token or wallet library is needed.

<details>
<summary>Several slots, transaction retries and recovery</summary>

Fund each slot separately. Add `--slot` with the ID printed by your application:

```sh
npx tsx fund-slot.ts .tasra/first-slot status --slot YOUR_PRINTED_SLOT_ID
npx tsx fund-slot.ts .tasra/first-slot fund 1000000000000000000 --slot YOUR_PRINTED_SLOT_ID
```

Replace `YOUR_PRINTED_SLOT_ID` with the full `0x` slot ID. The command checks that
the slot exists and is not cancelled before depositing. Keep the original network
manifest; a different snapshot is rejected for this saved state.

Each explicit `buy`, `mint-test-eurc` or `fund` invocation submits new transactions.
It is not a resumable payment journal. After a timeout or uncertain result,
inspect the recorded transaction and balances before deciding what to do next.
Do not blindly repeat a purchase or deposit. A confirmed approval may remain even
if its following purchase or deposit fails.

</details>

**Next: [Read your slot →](read-slot.md)**
