# Staged frontend repository guide amendment
<!--
documentation-metadata
audience: maintainers; developers; migration reviewers
owner: application maintainers
status: migration-pending
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: migration entry/routing delta consolidated; implemented corrections and completed scoped execution owned by paired review
source-anchors: README.md; package.json; src/routes/frontendPilot.ts; docs/frontend-migration/FRONTEND_PILOT.md; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md
next-review: frontend-production-cutover
canonical-merge-target: README.md
production-reference: 2dfa257 native documentation; not evidence of the installed production commit
-->

Merge this amendment into the [repository README](../../../README.md) only at authorized cutover; reconcile
intervening changes and remove this copy. Use its unchanged checkout setup, settings and database procedures.
Native implementation/docs/assets remain the comparison reference. Staging contains maintainer drafts, never
runtime content.

## Frontend migration checkout

The opt-in Vue pilot runs under `/frontend-pilot` with a generated versioned API.
Help/Packing and necessary identity/foundation journeys are the current completeness obligation.
Overview and other scaffolds have remaining migration TODOs; native destinations stay available.
Default-route replacement and application-wide migration remain future work.

Packing now demonstrates named shared operations/method policy in existing controllers, with removable native/v1
adapters and pure DBAL. Completed scoped acceptance and the approved coexistence remedy are recorded in the paired review.
Reviewed EN/DE pilot Help is release-owned under `docs/user-guide/<locale>/`;
native English Help remains unchanged under `docs/user-guide/`.

| Goal | Existing owner |
|---|---|
| Current pilot routes/build scope | [Frontend Pilot](../FRONTEND_PILOT.md) |
| Original choices and approved amendments | [Foundation](../FRONTEND_FOUNDATION_DESIGN.md) |
| Implement the next feature | [Single development playbook](DEVELOPMENT.md#implementing-the-next-feature-slice) |
| Understand changed architecture | [Architecture delta](ARCHITECTURE.md) |
| Choose/run checks | [Testing delta](TESTING_GUIDE.md) plus canonical [Testing](../../TESTING_GUIDE.md) |
| Database/deployment operations | Canonical [Database](../../DATABASE.md), [Operations](../../OPERATIONS.md), [Upgrading](../../UPGRADING.md) and staged deltas |
| Review status and actual evidence | [Pilot parity review](../PILOT_PARITY_REVIEW.md) |
| Help source/trust/fallback governance | [Documentation policy delta](DOCUMENTATION_POLICY.md) |

`npm run server` is the integrated development entry, including Vite HMR and ordered contract/catalog regeneration.
`npm run build` creates coherent native/server/client/SSR artifacts. Generated consumers stay ignored.
Exact scripts and versions belong to `package.json`; completed scoped checks and their limits belong to the
[pilot review](../PILOT_PARITY_REVIEW.md).
Documentation reports are optional and never gate application delivery.
