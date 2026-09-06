# GitHub Copilot Instructions for Surveyor
<!--
documentation-metadata
audience: GitHub Copilot; maintainers
owner: project maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: D13 minimal Copilot entry point delegating repository facts to AGENTS.md and canonical maintained documentation
source-anchors: AGENTS.md; docs/DOCUMENTATION_POLICY.md; docs/ARCHITECTURE.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; docs/DATABASE.md; package.json; repository-tree
next-review: D14
-->

Apply [the repository-wide agent guide](../AGENTS.md) before proposing or editing code. This file is deliberately short;
it does not maintain a second copy of Surveyor's architecture, commands, dependency versions, test inventory, or
database procedures.

## Durable rules

1. For repository facts, use executable behavior and tests first, then explicit decisions, generated references,
   canonical maintained documentation, and finally AI summaries.
2. Inspect the relevant implementation and preserve unrelated working-tree changes before editing.
3. Make the smallest coherent change and follow neighboring patterns; do not invent a framework or abstraction that the
   repository does not use.
4. Use the cheapest stable test layer that protects the behavior. Do not add every test layer automatically.
5. Pair persistent schema changes with reviewed migrations, use the settings-aware wrappers, and never run destructive
   or synchronizing database operations against non-disposable data.
6. Keep visible UI labels, server parsing, authorization, tests, and documentation aligned.
7. Do not hand-edit or commit generated outputs, secrets, local environment files, uploads, or reports.
8. A documentation-only task must not change runtime behavior unless a targeted help-integration change is explicitly
   authorized.

## Canonical references

- [Project setup and current scripts](../README.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Development workflow](../docs/DEVELOPMENT.md)
- [Testing contract](../docs/TESTING_GUIDE.md)
- [Database and migrations](../docs/DATABASE.md)
- [Documentation policy and help trust boundary](../docs/DOCUMENTATION_POLICY.md)
- [Documentation migration status](../docs/DOCUMENTATION_MIGRATION_STATUS.md)

Use the topic files under [`.github/copilot/`](copilot/) only as navigation aids. If any AI instruction conflicts with a
canonical source, correct or remove the AI summary rather than changing the implementation to match it.
