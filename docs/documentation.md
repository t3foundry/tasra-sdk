# Writing SDK documentation

A developer should be able to identify the right guide, run the code, and recognize
success without a workshop presenter. Optimize for that result before adding pages.

## Patterns we use

| Reference | Pattern adopted here |
|---|---|
| [Viem getting started](https://viem.sh/docs/getting-started) | Install, configure a client, perform one operation. This is the closest match to Tasra's TypeScript and chain APIs. |
| [Supabase JavaScript initialization](https://supabase.com/docs/reference/javascript/initializing) | State required inputs and their sources; show a small example before optional variants. |
| [Diátaxis tutorials](https://diataxis.fr/tutorials/) | Keep the first tutorial focused on a concrete result. Put conceptual depth and reference material elsewhere. |

These are design references, not a ranking of every SDK's documentation.

## Page requirements

- **Quickstart:** one outcome, prerequisites, installation from an empty folder,
  a complete TypeScript file, the run command, expected output, common failures,
  and a next step. No unexplained application helpers.
- **Task guide:** the user's goal, where each required input comes from, working
  code, success and failure behavior, and links to relevant API details.
- **API reference:** purpose, import path, required and optional parameters, return
  value, example, and failure behavior. Mark fragments that depend on earlier setup.
- **Explanation:** architecture and tradeoffs, linked from the task that needs them.

Keep deployment configuration in `tasra-releases`; pin pointer and manifest to the
same reviewed commit. Local addresses belong in explicitly labeled development
examples. Distinguish deployed service versions from the SDK package version.

## Verify before publishing

1. Copy the documented code into a fresh application and run the documented commands.
2. Type-check shipped examples and check relative links and section anchors.
3. Record the package/version, environment, command, output, and what was actually
   demonstrated. Contract reads, local crypto, and credential-gated operations
   are separate results.
4. For a live authorization guide, test success and denial on a compatible fleet.
   Mark untested prerequisites or operations explicitly.

Examples intended for an unreleased SDK must explain how to install its packed
artifact. Do not advertise new files as already present in a published npm version.

[Documentation index](README.md)
