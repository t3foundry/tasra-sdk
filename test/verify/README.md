# Verification commands

`npm run verify` is the SDK's complete local gate. It builds the package and runs
the offline checks. Use it for ordinary SDK changes.

`npm run verify:all` is a separate live acceptance harness. It provisions or
reuses a deployment, creates and funds an account and slot, runs protocol and SDK
suites, applies load, and executes destructive slashing and recovery scenarios.
Run it only when those network effects are authorized. It writes reports to
`test/verify/out/verify-report.md` and `.json`.

```bash
npm run verify
# Authorized live acceptance only:
npm run verify:all
```

The live harness runs `test/verify/run.ts`. Its phases are controlled by
`KK_VERIFY_BRINGUP`, `KK_VERIFY_BOOTSTRAP`, `KK_VERIFY_CORRECTNESS`,
`KK_VERIFY_RUST`, `KK_VERIFY_PERF`, and `KK_VERIFY_DESTRUCTIVE`; set a phase to
`0` to skip it. All are enabled by default. `KK_VERIFY_BENCH=1` adds Criterion
benchmarks, `KK_VERIFY_WIPE=1` wipes the deployment before bringing it up, and
`KK_KEEP=1` leaves it running after the harness. `KK_VERIFY_DEV_E2E=1` adds
the development verifier suite. `KK_NETWORK_DIR` and `KK_EXPLORER_DIR` select
the adjacent network and explorer repositories.

Only these `verify:*` npm scripts exist for the live harness:

| Command | Purpose |
| --- | --- |
| `npm run verify:all` | Full live harness, including destructive phases |
| `npm run verify:bootstrap` | Live economic onboarding against an already running deployment |

For a single phase, run `verify:all` with all other phase flags set to `0` and
`KK_VERIFY_BRINGUP=0` if the deployment is already running. To bring up or tear
down the deployment directly, run `npx tsx test/verify/bringup.ts` or
`npx tsx test/verify/bringup.ts --down`. The old `verify:up`, `verify:down`,
`verify:correctness`, `verify:perf`, and `verify:destructive` npm commands are
not defined in `package.json`.

This harness is separate from `npm run test:tutorials:live`, which packs the
SDK into a fresh application and runs the selected interactive tutorials.
That tutorial command requires `TASRA_ALLOW_NETWORK_TRANSACTIONS=1`, uses the
downloaded pinned testnet manifest, and pauses for manual AVAX and TSRA funding.
