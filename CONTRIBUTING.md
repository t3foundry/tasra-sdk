# Contribute to Tasra SDK

To build an application, start with the [SDK documentation](docs/README.md).
This guide is for changes to the SDK itself.

## Set up

Use Node.js 24+ for the complete development toolchain:

```sh
npm ci
npm run verify
```

The verification command checks types, lint, behavior, documentation, package contents,
dependencies and the example application. `npm run verify -- --quick` is an iteration
aid; run the complete gate before review. `npm run test:watch` runs tests while editing.
Live tests require a compatible deployment and separate authorization for their effects.

## Propose a change

- Start a focused `feature/<name>` branch from `develop` and target `develop` with the PR.
- Explain the problem, acceptance criteria and compatibility impact.
- Add a behavioral regression test for a reproducible bug where feasible.
- Update application guides, public API reference and skills when their contracts change.
- Run `npm run docs:reference` after changing public declarations and include the result.
- Add user-visible changes to [CHANGELOG.md](CHANGELOG.md).
- Include executed checks and remaining limitations. A passing test is evidence for
  its assertions, not proof that every behavior is correct.

Public documentation and package contents use [publication.json](publication.json).
When adding public files, update that list and the matching `package.json` files list;
`npm run verify` checks both the package archive and documentation links.
Maintenance notes, local configuration, credentials and raw evidence are not public
SDK content. Never include them in examples, pull requests or release artifacts.

Report security vulnerabilities privately using [SECURITY.md](SECURITY.md).
Contributions are licensed under [Apache License 2.0](LICENSE).
