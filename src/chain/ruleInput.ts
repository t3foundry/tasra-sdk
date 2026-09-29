/** Clear authorization policy, not its salted on-chain commitment. */
export interface RuleInput {
  /** Clear rule. OAuth and wallet policies share the DCQL grammar. */
  rule: string
}

/**
 * Require the current input contract before I/O; old fields are not aliases.
 * @param input Rule-bearing input to validate.
 */
export function requireRule(input: RuleInput): string {
  if ('dcqlRule' in input) {
    throw new Error('dcqlRule is not supported; use rule. Saved intents require explicit migration.')
  }
  const {rule} = input
  if (typeof rule !== 'string' || rule.length === 0) throw new Error('rule must be a non-empty string')
  return rule
}
