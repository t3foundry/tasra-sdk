# Working on Tasra SDK

Read the affected code, public contracts, callers and tests before changing behavior.
Keep changes focused and preserve documented compatibility. Define acceptance criteria,
add behavioral regression tests for reproducible defects, and run `npm run verify`
before reporting completion. Use deterministic evidence; distinguish executed checks,
reasoned conclusions and anything unverified. Never hide failures or weaken checks.

New branches use `feature/<descriptive-name>`. Do not commit, push, publish or change
hosting settings unless authorized. Live or destructive checks need their applicable
authorization; the normal verification gate is offline with respect to the fleet.

See [Contributing](CONTRIBUTING.md) for setup and verification.
