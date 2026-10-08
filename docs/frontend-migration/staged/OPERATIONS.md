# Staged frontend production operations amendment
<!--
documentation-metadata
audience: operators; maintainers
owner: application operators
status: migration-pending
last-verified: 2026-10-08
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: FPR-07 prospective operational amendment; source boundary and authorized D2/D3/D5 only; no deployment, upgrade, rollback or browser execution claimed
source-anchors: .github/workflows/release.yml; package.json; src/modules/frontendPilotRenderer.ts; src/frontend/app/context.ts; docs/FRONTEND_FOUNDATION_DESIGN.md; docs/OPERATIONS.md
next-review: frontend-production-cutover
canonical-merge-target: docs/OPERATIONS.md
production-reference: 2dfa257 native frontend documentation; reference only, not evidence of an installed production commit
-->

## Cutover staging

This is a temporary amendment for the existing [Production Operations](../../OPERATIONS.md) runbook, not a new
runbook. Preserve the native production procedure until frontend cutover, then merge the applicable additions
below into the existing release and health sections and remove this copy. Reconcile intervening operational
changes; the native reference is not evidence of the commit deployed at a site. Documentation remains advisory.

## Frontend artifact boundary

Install a coherent release produced by the existing build/package workflow: Express server output, the Vue
server-rendering entry, hashed client assets, generated contract/localization runtime artifacts and the matching
trusted help content belong to the same release. Preserve production runtime dependencies needed by server
rendering; Vite remains a development/build dependency. Operators do not run a frontend development server.

Approved D5 supports replacement of the current binary folder with no retained old frontend assets, secondary
asset service or additional deployment protocol. The client detects the changed release through ordinary session
refresh. A compatible mounted edit can finish; an idle clean client reloads once, while drafts remain mounted
if a missing chunk or incompatible command requires review. These are application responsibilities, not new
operator steps or promises that all older clients can submit indefinitely.

Use the existing health, startup and smoke procedures. At frontend cutover, the application smoke should also
fetch document-emitted client/style URLs and exercise a required migrated help/packing route with JavaScript.
A server-rendered screenshot alone does not establish hydration. Disabled JavaScript may show a clear message
or a genuinely read-only page. Native routes for future migration increments retain their existing destinations.

Database targeting, backup, restore, trusted help packaging and file ownership continue to use the canonical
runbook. D2 removes the unreleased packing revision schema: this frontend rectification adds no database migration,
new schema synchronization step or broad locking/authentication requirement.
