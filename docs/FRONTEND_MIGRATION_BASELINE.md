# Frontend migration baseline
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: current
last-verified: 2026-10-04
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: step-one source inventory and second-pass edge-case review of existing routes, behaviors, permissions, rendering, native fallbacks and test assertions; first-pass application build and controlled browser capture; implementation of the replacement frontend is not included
source-anchors: src/app.ts; src/routes/; src/controller/; src/views/; src/public/js/; src/types/; src/modules/invoice/; src/modules/activity/; tests/; scripts/capture-frontend-baseline.cjs; package.json; esbuild.client.js; playwright.config.ts; docs/ARCHITECTURE.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; docs/DOCUMENTATION_POLICY.md
next-review: frontend-foundation-proof-slice-implementation
-->

This is the first-step baseline for replacing Surveyor's Pug and imperative browser frontend with a more uniform
component application. It records the behavior a replacement must preserve, the current HTTP boundaries, the
assertions already available, and representative visual evidence. It does not implement or finalize a framework,
new API, synchronization protocol, or localization system.

The user requires feature parity, largely preserved appearance, reusable components, periodic shared-data refresh
with conflict resolution, a versioned API with one definition of its contract shapes, and shared frontend/backend
localization. Preserve those requirements when turning this inventory into implementation slices.

## Baseline records

| Record | Purpose | Evidence level |
|---|---|---|
| [Behavior inventory](frontend-migration/BEHAVIOR_INVENTORY.md) | Stable behavior IDs, visible actions, role/ownership variants, lifecycle distinctions and delivery/fallback behavior | Source reviewed; related tests linked without claiming every scenario is covered |
| [Edge cases and special use cases](frontend-migration/EDGE_CASES.md) | Second-pass preservation rules for identity/lifecycle, participation, financial workflows, shared controls and recovery | Source and assertion review; distinguishes implemented protection, confirmed defects and unresolved evidence |
| [Route inventory](frontend-migration/ROUTE_INVENTORY.md) | Current page/form/API routes, factory expansions, guards, response forms, token entry points and exports | Source reviewed; exact implemented routes take precedence over comments |
| [Test coverage map](frontend-migration/TEST_COVERAGE.md) | Existing assertion evidence, its actual layer, and gaps that need protection during migration | Test source reviewed; no claim that application suites were executed |
| [Visual baseline](frontend-migration/VISUAL_BASELINE.md) | Captured desktop/mobile scenes, fixture recipe, disabled-JavaScript check, artifacts and remaining visual gaps | Controlled built-application capture and recorded image review |

Application-source baseline: Git commit `7ff78998667e55df56390a8e8da88e8ace687771`. The working tree was clean at
the start of this task. Source links refer to the working tree and will move with future commits; use the commit
when comparing historical behavior. The metadata baseline above is an existing documentation baseline identifier,
not a claim that its historical fingerprint matches this source commit.

## What the source review establishes

The current frontend is browser TypeScript, not untyped JavaScript throughout. Shared helpers, activity feature
modules, Pug mixins, and pure invoice presentation/wording owners already provide reusable responsibilities.
Migration should retain those boundaries where they remain useful.

There are several rendering and transport models:

- Native page links and form POSTs produce HTML, flash feedback, and redirects.
- Pug supplies globals, JSON script elements and data attributes to browser modules.
- Browser modules construct additional DOM and sometimes duplicate server-rendered presentation.
- The overview fetches server-rendered region HTML inside a JSON envelope and updates browser history.
- Many mutation commands end in a complete reload; individual features restore selected state afterward.

The existing `/api` is an unversioned enhancement surface, not a complete published SPA contract. Initial reads,
creation, survey voting and account/guest/profile flows also live in page routes. The shared HTTP helper accepts
`any`, and some shared declarations contain persistence or renderer types. These are future contract-design inputs;
this baseline does not redefine endpoints or move controller checks into database services.

There is no general periodic shared-data refresh layer in the reviewed browser code. Existing stale-read sequencing,
invoice revision checks, capacity locks and activity recommendation fingerprints remain valuable. Periodic refresh,
draft reconciliation, API-native session expiry, and cache isolation after profile changes need additional acceptance
scenarios when implemented. They must not be described as already verified by this baseline.

## Behavior boundaries that control migration

| Boundary | Preservation requirement | Inventory reference |
|---|---|---|
| Identity | Account, guest, active profile and event registration are distinct identities; preserve private return/token links and profile migration | ACC, GST, PRF |
| Surveys | Preserve the standalone survey and its specific participation/ownership rules; a query parameter or shared factory does not establish event linkage | SRV |
| Overview | Keep bounded server pages, independent collections/regions, correct parent grouping and personal placement | OVR |
| Lifecycle | Shared archival, inherited archival, personal visibility, hard deletion and file retention stay separate | ENT |
| Packing | Shared assignments/capacity differ from the browser-local Packed? checklist, including its existing storage keys | PCK |
| Activity | Keep availability, requirements, overrides, external assignees, generated/manual recommendations, review state and stale-job protection | ACT |
| Invoices | Preserve upload uncertainty, ownership/recorder distinction, independent lifecycle states, reviewed revisions, signed settlement evidence and saved calculation exports | INV, EXP |
| Help | Preserve contextual links, fixed release-shipped Markdown, search and the existing validation boundary | HLP |
| Localization | Extend the existing shared invoice wording owner; do not introduce separate frontend/API dictionaries | SHL, INV, EXP |

The inventory describes intentional product behavior. A transient defect is not an acceptance criterion to reproduce.
Consult the existing [implementation defect register](documentation-remediation.yml) when source and canonical
guidance disagree; record a new confirmed defect there once and keep any remediation separate from this baseline.
Unresolved intent remains a question for the relevant implementation slice.

## Native forms and JavaScript support

SSR does not imply universal no-JavaScript operation. The behavior inventory distinguishes native transport,
JavaScript-required controls, explicit fallback support, document/region replacement, and separate exports.

The overview deliberately provides ordinary links, native search, and a noscript type filter. Native search was
exercised with JavaScript disabled in the visual capture; hidden-region navigation and the type-filter variant remain
uncaptured. Survey voting and help search also expose native forms in source. Creation forms can still require
JavaScript to build their submitted rows; event registration, settings dialogs and invoice actions have browser
handlers. Do not assume these all share one fallback promise.

Future route cutovers must identify which existing fallback they preserve and how. Page reloads can be replaced as
requested, but successful outcomes, field validation, confirmation, focus, draft retention and bookmark behavior
remain part of parity. OIDC provider navigation and separate downloads/print documents are legitimate navigation
boundaries.

## Using the baseline for a migration slice

1. Select the behavior IDs and route families the slice owns. Include empty/populated/error/pending states and each
   relevant actor, rather than treating one owner screenshot as complete feature coverage. Include the corresponding
   edge-case IDs from the second-pass records; they capture intentional differences and failure/recovery boundaries.
2. Reuse the existing business/controller/DBAL operations. Identify required transport projections without exposing
   entities, permissions internals or UI-specific errors through the persistence boundary.
3. Map the existing assertions to the new component/API boundary. Replace implementation-specific DOM/reload checks
   with observable outcomes and retained state; do not delete protection merely because markup changes.
4. Add the cheapest missing checks where risk crosses a boundary. Shared-state writes need real transactional
   evidence; profile/session navigation and browser focus need selected real-browser journeys.
5. Compare the relevant current visual states with the replacement and explicitly account for supported native
   fallbacks, exports and old deep links. Record intended differences separately from accidental regressions.

This inventory is advisory migration-control material. It is not an application-test assertion against prose, a
required CI status, or a prerequisite for review, merge, release or deployment. Existing application correctness
checks remain separate, as required by the [documentation policy](DOCUMENTATION_POLICY.md).

## Work performed and scope limits

- Read current routes and shared route factories, Pug/browser modules, relevant controllers/services, declarations,
  canonical guidance and test assertions. The route inventory cross-check includes literal registrations and
  manually expanded factory paths.
- Built the current application with `npm run build`; it completed successfully. Generated assets remain ignored.
- Added an optional [capture script](../scripts/capture-frontend-baseline.cjs) that uses existing E2E factories and
  public workflows. It does not alter application code, reset/synchronize/migrate the database, or join CI.
- Captured synthetic-data browser evidence against the built Express app; exact environment, results and limitations
  are recorded in the visual baseline. The application's background archival/retention jobs were not started.
- Application unit/frontend/integration/E2E suites were not run for this source inventory. No coverage percentage,
  production-database rehearsal, real OIDC/mail validation or exhaustive accessibility review is claimed.
- The second pass reviewed unusual identity, permission, lifecycle, participation, financial and browser-state paths
  against implementation and test assertions. It added the edge-case records and defect-register entries; it did not
  repeat the first-pass build/captures or execute application suites. In particular, ordinary property forms do not
  have general stale-form revision protection even where a transaction rechecks current server context.
- The optional documentation report found no broken links or missing npm scripts. It also reported existing baseline,
  temporary-output metadata, older source-anchor and unreferenced help-asset findings; its advisory exit is not a
  clean repository-wide documentation result. The new local E2E configuration reference is accounted for in the
  report configuration. Reports remain under `test-results/frontend-baseline/documentation-report/`.

Step 2 is recorded in the [frontend foundation design](FRONTEND_FOUNDATION_DESIGN.md), including the framework,
versioned contract, shared localization and refresh/conflict decisions. The next step is its bounded working proof
slice. API implementation, database revision fields and production route cutover remain subsequent work; this
baseline stays the historical behavior and evidence reference.
