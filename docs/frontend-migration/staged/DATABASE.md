# Staged frontend database amendments
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-14
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: digest-guarded frontend amendments preserve complete reviewed candidate guidance; unchanged production procedures stay in their existing owners; no runtime or cutover execution claimed
source-anchors: docs/frontend-migration/documentation-boundary.json; docs/frontend-migration/check-documentation-boundary.mjs; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; src/frontend/; package.json
next-review: next-authorized-migration-slice-or-cutover
-->

These amendments retain the reviewed frontend guidance without copying unchanged production procedures.
The [profile](../PROFILE.md) governs preparation and review; its [manifest](../documentation-boundary.json)
owns destination mapping and exact operations. Payload links use their mapped production location.
Surrounding notes use this file's location. Preparing complete temporary output does not authorize cutover.

## Prepare a migration workspace — amendment-01

<!-- delta:amendment-01 -->
migration datasource, followed by the generated API contracts, validators and language catalogs. Generation does not
connect to MariaDB or change its schema. `npm run generate:db-index` prepares only the TypeORM index. Run generation
before every schema command in a fresh checkout.

<!-- /delta:amendment-01 -->

## Database backup — amendment-02

<!-- delta:amendment-02 -->
## Frontend contracts and persistence

Generated API contracts, validators and language catalogs are application build inputs. They do not replace entity
definitions, reviewed database migrations or the settings-aware database commands above.

Packing edit comparisons use the current relevant values inside existing locked transactions, without an edit-history
table or Packing revision column. A value changed away and back can match an earlier comparison. Financial calculation
revisions and saved settlement history retain their own persistence contracts.

Controllers own authorization and business decisions against the locked evidence supplied by database services.
The services own queries, locks, transactions and persistence. Diagnose conflicting writes through the actual application
operations and database logs; do not bypass the checks or change transaction isolation as an operational workaround.

## Database backup

<!-- /delta:amendment-02 -->
