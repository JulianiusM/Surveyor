# Staged frontend upgrade amendment
<!--
documentation-metadata
audience: operators; maintainers
owner: application operators
status: migration-pending
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: approved frontend release/coexistence delta consolidated; no installed-folder or rollback rehearsal claimed
source-anchors: .github/workflows/release.yml; package.json; src/modules/frontendPilotRenderer.ts; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md; docs/UPGRADING.md
next-review: frontend-production-cutover
canonical-merge-target: docs/UPGRADING.md
production-reference: 2dfa257 native documentation; not evidence of installed production
-->

Merge this amendment into [Upgrading and Rolling Back](../../UPGRADING.md) at authorized frontend cutover,
reconcile changes and remove the copy. Preserve canonical backup, file-retention, targeting and rollback procedures.

Install matching Express, client/SSR, generated contract/catalog and reviewed pilot Help artifacts.
Runtime pilot Help is `docs/user-guide/<locale>/`; native `docs/user-guide/` stays unchanged.
Staged maintainer documents are never runtime resources. D5 adds no retained old-asset directory or external steps:
compatible loaded edits may finish; clean idle views reload once; missing chunks/incompatible commands retain drafts.

Initial cutover retains native destinations for workflows awaiting migration. The approved shared-backend target
keeps business policy in existing controllers/pure DBAL and lets native/v1 adapters retire independently.
Use ordinary smoke verification plus emitted assets/hydration/required controls; SSR HTML alone proves neither.
D3 corrects unreleased v1 in place; D2 adds no Packing revision schema/replacement migration.
Release-specific migrations/rollback compatibility remain canonical. Final checks belong to the [review](../PILOT_PARITY_REVIEW.md);
documentation reports remain advisory and no deployment rehearsal is claimed.
