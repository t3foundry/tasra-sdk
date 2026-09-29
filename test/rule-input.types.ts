import type {CreateSlotArgs} from '../src/chain/write.js'
import type {ProvisionRuleArgs} from '../src/chain/provisionRule.js'

// Compiled by the harness type check; never sends a transaction or HTTP request.
function checkRuleInputs(create: (input: CreateSlotArgs) => unknown, provision: (input: ProvisionRuleArgs) => unknown, signer: ProvisionRuleArgs['signer']) {
  const slot = {mode: 'bls' as const, k: 2, n: 3}
  const delivery = {slotId: '0x01' as const, ruleSalt: '0x02' as const, signer}
  create({...slot, rule: 'any'})
  provision({...delivery, rule: 'any'})
  // @ts-expect-error Creation requires rule; the old field is not an alias.
  create({...slot, dcqlRule: 'any'})
  // @ts-expect-error Identical values do not permit an old field.
  create({...slot, rule: 'any', dcqlRule: 'any'})
  // @ts-expect-error An undefined old field is still unsupported.
  create({...slot, rule: 'any', dcqlRule: undefined})
  // @ts-expect-error Provisioning requires rule; the old field is not an alias.
  provision({...delivery, dcqlRule: 'any'})
  // @ts-expect-error Identical values do not permit an old field.
  provision({...delivery, rule: 'any', dcqlRule: 'any'})
  // @ts-expect-error An undefined old field is still unsupported.
  provision({...delivery, rule: 'any', dcqlRule: undefined})
}
void checkRuleInputs
