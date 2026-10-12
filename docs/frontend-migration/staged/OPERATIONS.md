# Staged frontend operations amendment
<!--
documentation-metadata
audience: operators; maintainers
owner: application operators
status: migration-pending
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: approved migration boundaries and prospective operational delta; completed scoped build/runtime evidence owned by paired review; no deployment rehearsal claimed
source-anchors: .github/workflows/release.yml; package.json; src/modules/frontendPilotRenderer.ts; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md; docs/OPERATIONS.md
next-review: frontend-production-cutover
canonical-merge-target: docs/OPERATIONS.md
production-reference: 2dfa257 native documentation; not evidence of the installed production commit
-->

Merge this delta into [Production Operations](../../OPERATIONS.md) only at authorized frontend cutover,
reconcile intervening changes, then remove this copy. Native procedures and assets remain unchanged.

Install one coherent release containing Express, the Vue SSR entry, hashed client assets, generated contracts and
catalogs, and reviewed pilot Help under `docs/user-guide/<locale>/`. The native corpus remains `docs/user-guide/`.
Staged maintainer documents are never runtime resources. Preserve SSR production dependencies; operators run the
existing Node application, with no Vite development server or additional asset service.

Approved D5 supports replacing the current binary folder without retained old assets. Ordinary session refresh
detects the update: compatible mounted edits can finish, a clean idle view reloads once, and missing chunks or
incompatible commands preserve mounted drafts for review. The application owns this behavior.

Use canonical health, backup, restore and file-ownership procedures. Cutover smoke verification also fetches the
document's emitted scripts/styles and exercises hydration and required controls. D2 introduces no packing revision
schema or replacement migration. Documentation reports stay advisory; final execution belongs to the [pilot review](../PILOT_PARITY_REVIEW.md).
