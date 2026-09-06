# Testing Quick Reference
<!--
documentation-metadata
audience: GitHub Copilot; test contributors
owner: project maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: D13 single test-selection rule, current layer boundaries, database warning, and canonical command delegation
source-anchors: docs/TESTING_GUIDE.md; package.json; vitest.config.mts; playwright.config.ts; tests/; repository-tree
next-review: none
-->

**Use the cheapest stable test layer that protects the observable behavior; add another layer only when the risk crosses
that boundary.** Do not add every layer for every feature.

| Layer | Appropriate boundary |
|---|---|
| `tests/unit/` | Isolated production logic without a database, HTTP application, external service, or real browser. |
| `tests/frontend/` | Browser helpers or DOM behavior under Vitest with explicit, restored globals. |
| `tests/integration/` | TypeORM persistence, relationships, transactions, or selected controller orchestration against a guarded disposable MariaDB schema. |
| `tests/e2e/` | Critical behavior through the built application, routes, middleware, sessions, rendering, and database together. |

Read the [Testing Guide](../../docs/TESTING_GUIDE.md) for environment setup, reset safeguards, factories, helpers,
selectors, coverage, and the current command matrix. `package.json` is the command inventory.

`npm run test:quick` is database-free. `npm test` includes integration tests and therefore requires the disposable
integration database. Integration and E2E setup rebuild their selected schemas; never point them at shared or valuable
data.

Test production behavior rather than test-only helpers. Do not replace TypeORM repositories or core services when
persistence is the subject of the test. Narrow replacements are appropriate only at true external side-effect
boundaries when they preserve the production workflow being exercised.
