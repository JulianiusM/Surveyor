# Staged frontend upgrade amendment
<!--
documentation-metadata
audience: operators; maintainers
owner: application operators
status: migration-pending
last-verified: 2026-10-08
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: FPR-07 prospective operational amendment; source boundary and authorized D2/D3/D5 only; no deployment, upgrade, rollback or browser execution claimed
source-anchors: .github/workflows/release.yml; package.json; src/modules/frontendPilotRenderer.ts; src/frontend/app/context.ts; docs/FRONTEND_FOUNDATION_DESIGN.md; docs/UPGRADING.md
next-review: frontend-production-cutover
canonical-merge-target: docs/UPGRADING.md
production-reference: 2dfa257 native frontend documentation; reference only, not evidence of an installed production commit
-->

## Cutover staging

This is a temporary amendment for [Upgrading and Rolling Back](../../UPGRADING.md). Preserve the native production
runbook until frontend cutover, then merge this addition into the existing install/verification sections and
remove the staged copy. Keep the canonical database backup, file retention and rollback procedure unchanged.
The native documentation reference does not identify the commit installed at a particular site.

## Frontend replacement and rollback boundary

Keep each installed frontend release coherent with its Express server, generated contracts/catalogs, server-rendering
entry, client assets and trusted help. Use the normal release build and the existing binary replacement procedure.
Approved D5 adds no retained old-asset directory or external operational prerequisite. Active compatible edits
may finish; a clean idle client reloads once when it detects the replacement. Missing chunks or incompatible
commands keep mounted drafts available for explicit review rather than replaying a write.

For the initial cutover, retain the native destinations of workflows awaiting later migration increments.
Help and packing are the current feature-completeness obligation; implementation of an Overview scaffold does
not establish complete migration of that feature. Reuse the existing smoke verification and include the migrated
route's client assets, hydration and required controls. Keep documentation reports advisory.

D3 corrects the unreleased v1 contract in place. D2 introduces no packing revision schema or replacement migration.
Ordinary release-specific migrations and database rollback compatibility remain governed by the canonical runbook;
this amendment does not authorize authentication, session, permission or domain-rule redesign.
