# Staged frontend database amendment
<!--
documentation-metadata
audience: maintainers; operators; database administrators
owner: application operators
status: migration-pending
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: approved schema/generation/coexistence delta consolidated; completed scoped concurrency evidence owned by paired review; no installed-schema migration or operator rehearsal claimed
source-anchors: package.json; src/modules/database/services/PackingService.ts; src/modules/database/services/EntityLifecycleService.ts; docs/DATABASE.md; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md
next-review: frontend-production-cutover
canonical-merge-target: docs/DATABASE.md
production-reference: 2dfa257 native documentation; not evidence of the installed production commit
-->

Merge this delta into [Database and Migrations](../../DATABASE.md) at authorized cutover, reconcile intervening
changes and remove this copy. All unchanged targeting, credential, backup, migration and rollback procedures remain
canonical. Staged documentation is never runtime input.

## Generated index and frontend artifacts

`npm run generate` prepares the TypeORM index and API/localization consumers without connecting to a database.
`npm run generate:db-index` prepares only the index. Use the settings-aware package wrappers for migrations.
A persistent schema change still requires matching entities and a reviewed migration for existing installations.

## Packing comparison and coexistence

Approved D2 removed the unreleased Packing metadata revision column/increments/migration in favor of current-value
comparisons under existing locks, including useful setup fields. This correction introduces no replacement Packing
schema. Financial revisions and existing archival migrations retain their own contracts.

A developer who applied the abandoned pilot migration must inspect that local schema before changing it.
Only an explicitly disposable database may use reset/synchronization procedures; do not infer disposability from its
name or convert this frontend correction into a production reset/reversion instruction.

The implemented shared-backend structure uses native/v1 controller operations/method policy and existing persistence
services. Scoped acceptance and the approved native shared-root-before-item remedy are recorded in the review;
v1 retains its exclusive root-before-item coordination.
Transport/conflict protocols can differ; native writers
retain last-write request behavior while changed current values affect later
v1 comparison. Preserve controller-owned checks inside service-managed transactions and required lock ordering.
The bounded archival and approved native assignment remedies grant no broad locking redesign.

Verify coexistence through actual native/v1 operations against guarded disposable MariaDB, not repository mocks.
Confirm the effective database target before every schema-changing/test-reset command using canonical procedures.
Completed scoped concurrency evidence and its limits belong to the [pilot review](../PILOT_PARITY_REVIEW.md).
