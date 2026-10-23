# Staged frontend testing guide amendments
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-22
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: Shared Windows fork IPC handoff and owned temporary-resource cleanup added to retained runner layers and finite evidence requirements; no publication or new execution claim
source-anchors: docs/frontend-migration/documentation-boundary.json; docs/frontend-migration/check-documentation-boundary.mjs; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; src/frontend/; tests/integration/frontend-development-runtime.spec.ts; tests/integration/frontend-session-admission.spec.ts; vitest.config.mts; package.json; src/types/IdentityTypes.d.ts; src/types/FrontendPilotUiTypes.d.ts; src/modules/lib/civilDate.ts; src/types/CivilDateTypes.d.ts; tests/unit/civil-date.spec.ts; tests/e2e/frontend-calendar.spec.ts
next-review: next-authorized-migration-slice-or-cutover
-->

These amendments retain the reviewed frontend guidance without copying unchanged production procedures.
The [profile](../PROFILE.md) governs preparation and review; its [manifest](../documentation-boundary.json)
owns destination mapping and exact operations. Payload links use their mapped production location.
Surrounding notes use this file's location. Preparing complete temporary output does not authorize cutover.

## Runner classification — amendment-01

<!-- delta:amendment-01 -->
The explicit 2026-10-13 decision retains this E2E boundary. Isolated built-browser fixtures belong to the client
layer even when another runner happens to start a server/database. Source-server browser workflows with real
persistence belong to integration coverage; they are not built-application E2E. Exact runner selection comes from
configuration and package scripts; the frontend and compiler contracts below cover their distinct scopes.

Genuine integration of production server components can be database-free when application database persistence lies
outside the exercised boundary. The Express/Vite fixture combines development middleware, shared SSR and HTTP asset
delivery; the session-admission fixture combines actual Express/session middleware and production admission with
synthetic anonymous MemoryStore contexts. Both use the existing database-free selection without initializing a
schema. The session fixture preserves the original middleware Session/save methods, rejects a changed stored
generation instead of adopting it, and leaves cookie-free initial reads uninitialized. Store writes/touches,
response cookies and original object identity are observable assertions; synthetic contexts do not establish real
account/guest ORM identity or domain permission behavior. Those require the existing persistence/system boundaries.
Both fixtures close their owned infrastructure. A mocked response alone does not establish
that integration boundary. The [Development Policy](policies/DEVELOPMENT_POLICY.md#test-selection-and-evidence)
owns this bounded classification; database-backed integration retains real ORM metadata and guarded schema setup.
<!-- /delta:amendment-01 -->

## Frontend tests — amendment-02

<!-- delta:amendment-02 -->
- mounted components, scoped Query/transport consumers and draft/command state;
- initialization, localization and feedback lifetimes; and

<!-- /delta:amendment-02 -->

## Frontend tests — amendment-03

<!-- delta:amendment-03 -->
Do not assume a global browser DOM. Save and restore every global installed by the test, and dispose application
contexts, query observers, timers, listeners and object URLs so one frontend spec cannot contaminate another.

<!-- /delta:amendment-03 -->

## 3. Install Chromium and run — amendment-04

<!-- delta:amendment-04 -->
Playwright starts and stops its managed built server through `playwright.config.ts`, after configured E2E database
preparation. `reuseExistingServer: false` applies locally and in CI. Stop any existing process on the selected port
before E2E so the runner owns the compiled application and prepared database.

Windows defaults to one system worker after native worker exits were observed in parallel runs. Other platforms
retain Playwright's default selection; Linux CI explicitly selects two workers, and CLI overrides remain available.
This bounded local mode takes longer while retaining real concurrent actors within individual tests. It changes no
assertion deadline, retry or validation. A successful serial run does not establish the native exit's cause or
guarantee that it cannot recur.

<!-- /delta:amendment-04 -->

## 3. Install Chromium and run — amendment-05

<!-- delta:amendment-05 -->
npm run test:all      # Vitest, build, isolated client browser and system E2E

<!-- /delta:amendment-05 -->

## Choosing the layer — amendment-06

<!-- delta:amendment-06 -->
| Client helper or mounted component | Frontend | actual browser focus/hydration or integrated session/persistence matters |

<!-- /delta:amendment-06 -->

## Archival coverage — amendment-07

<!-- delta:amendment-07 -->
## Frontend compiler and build scopes

`npm run typecheck:frontend` checks the separate Vue client and SSR configurations. `npm run typecheck:tests` uses
vue-tsc with `tsconfig.test.json` for tests and production/SFC imports reached by that graph. Vitest transpilation
does not type-check assertions or fixtures, and a test-graph pass does not certify every unimported browser source.
Server compilation belongs to `tsconfig.server.json`; Vite compilation alone is not a TypeScript check.

`vitest.config.mts` includes the exact development-runtime and session-admission files under `tests/integration/`
in its `database-free` project and excludes them from its schema-resetting `integration` project. The first combines
Express/Vite/SSR; the second combines actual Express/session middleware, production admission and an in-memory
store to protect response-completion and server-owned input checks. Neither substitutes a database-backed identity
or transaction test. `npm run test:quick` selects that project without copying discovery globs into the package
command. A focused infrastructure run uses the same project with its exact file; `test:integration` still
selects the whole integration directory and therefore includes database-backed suites. Do not describe the quick
selection as unit/client-only or infer a layer from whether its runner starts a database.

Package pre-hooks prepare generated API/localization/database inputs. Direct runners can bypass those hooks;
generate after checkout or authored contract/catalog changes. Generated compile fixtures exercise actual request,
response and problem declaration relationships, including negative cases. Do not add parallel handwritten contracts.

When an isolated SSR assertion measures a fresh rendered tree rather than cold compiler startup, prepare only its
actual lazy route modules in a named `beforeAll` under the existing hook budget. Keep app creation, request data and
rendering inside each unchanged assertion deadline. This follows the existing route-fixture pattern without
pre-rendering output, priming private state or replacing real components. Cold-compilation attribution still needs
evidence; a timeout alone does not establish an application rendering defect.
For an HTTP integration suite with an existing owned listener, prepare its actual built lazy module alongside that
server infrastructure. The profile-document suite resolves exactly one built Overview module and imports it without
a setup request or render. Its real HTTP/bootstrap assertions retain their deadline; this does not measure cold
module initialization as application latency. Keep earlier failed runs visible when recording the focused rerun.

Source HMR, serialized contract/catalog regeneration, coherent production SSR dependencies and release/chunk recovery
cross different boundaries. Exercise the relevant owner when changed; a build or hydration marker alone does not
prove usable controls, request-local identity/locale or release replacement behavior.

## Mounted reads, drafts and commands

Use actual Query/cache/transport consumers where they uniquely detect:

- Missing pending data versus retained background content, independent regions and unknown membership counts.
- Original/local/current values, sparse normalized input and independent settings-section drafts.
- Original/Mine/Current presentation preserving false and numeric zero, with localized boolean wording and empty
  placeholders confined to absent/empty text; test the mounted feature's recovery journey and unchanged write values.
- Field write loss versus readable content, actor/resource retirement and validated denial of protected projections.
- Actual fresh authority after a confirmed write; canceled retained data, idle flags and manual cache aliases are not receipts.
- Saved operations with failed follow-up reads and unknown outcomes without replay or false rollback assumptions.
- Confirmed destination/feedback retention through failed navigation, including retired command editors.
- Receipt-owned transient expiry, repeated renewal, locale reactivity, retired editors and nearest page/dialog hosting.
- Session/bootstrap dispatch admission, visibility/disclosure pause, terminal rejection and Retry-After deadlines.
- Eligible observer selection when shared-key consumers have different visibility or lifecycle.
- Required owning reads with no optional dependent observers, and inactive cached dependencies remaining inactive.
- Closed disclosures pausing recurring polling while retaining initial count reads, admitted snapshots and drafts.
- Equal successful reads restoring a previously rejected binary image without relying on a changed version.
- An already-open editor losing its method grant: visible dispatch controls and handlers agree, with readable drafts retained.
- Aggregate totals/badges retiring with their source authority, while independently admitted siblings remain readable.
- Locale changes canceling translated families only, leaving machine authority reads and drafts intact.
- Explicit value lifetimes across warm/cold routes, actor changes and completion for text, select, checkbox and file inputs.
- Lexical numeric fields through input, change, blur and a sibling render using the shared field option; separately
  retain intentional numeric normalization. Field events alone cannot establish the displayed browser value.
- Finance money/factor/identifier wire strings, unchanged accepted precision and controller normalization, plus
  compatibility/update recovery for older loaded tabs without discarding mounted drafts or replaying commands.
- Activity scalar/array identifier strings and the existing Analyze/Calculate argument adapter's numeric engine
  boundary without mutation of admitted configuration, domain arithmetic or native inputs.

Current focused source selections protect shared frontend owners at their actual layer:

| Boundary | Authored coverage and limit |
|---|---|
| Displayed header and root/child schedule actions | `tests/frontend/frontend-entity-presentation.spec.ts` mounts actual Event/Packing and Settings/child consumers, checking settings admission, image lifetime/removal and shared pause/resume behavior. Existing Event-page and Packing-editor cases retain equal-image-read and pending/draft coverage. HTTP substitution makes these client checks. |
| Denial-producing admission and inactive visits | `tests/frontend/frontend-entry-retirement.spec.ts` uses real Query observers to retain a paused producing denial while removing older token visits and preserving another actor. Event foundation and existing Packing entry cases cover mounted feature adoption and restored admission. |
| Metadata public workflow and read-only notes | Existing Event foundation/Packing management cases exercise the actual metadata adapters and shared editor handle. Event organizer cases update selected participant/summary notes through fresh roster reads, independently of search, and retire missing/empty sources while retaining separate date-draft coverage. |
| Shared fields, Quick Add and recovery | `frontend-pilot-shell` cases exercise native composition/caret/control identity and emitted values; actual browser change/blur and sibling-render checks establish lexical-number display. Packing editor and Drivers cases separately protect Quick Add's deliberate numeric coercion/native rerender normalization, unnamed fields and confirmed/uncertain resets. Event foundation preserves raw creation fields and selected multipart bytes; Survey cases retain ballot-specific fresh-read reconciliation and unknown-creation review. These boundaries retain their own client or built-system classification. |
| Built visual/behavioral delivery | `tests/e2e/frontend-entity-header.spec.ts` compares native/Vue headers at desktop/mobile sizes with images, long titles and parent navigation. `frontend-event-workflows.spec.ts` exercises actual controls, sessions and persistence for attendance, links, notes, permissions, images/lifecycle, deadline/capacity outcomes, uncertain delivery and anonymous grants. Other Event E2E files retain their existing boundaries. |

This is an assertion map, not a claim that a selection ran or passed. Executed inputs, results and limits belong to
the migration review. Inspect equivalent surfaces and their controls rather than infer full parity from a container
width, one representative input or capture success.

Hold/cancel the real post-command read to prove one write and blocked authority until a new admitted read. Equal
successful data is a valid receipt; object identity alone is not. A read cannot prove an unknown creation failed.
Preserve the submitted input and deliberate review. Commands default to no automatic replay.

Packing's local checklist is separate from server snapshots. Test unavailable/throwing storage, per-row pending writes,
healthy rereads/missing keys, visible warning lifetime and explicit local Retry. Background reads never retry writes;
list/context retirement removes temporary fallback without server persistence or a restoration promise.

Real persistence checks cover method-specific projections, touched-field comparison, authorization under locks,
assignment/capacity interleavings, relationship no-ops and changed associations. Keep finance revisions, signed
settlement evidence and recommendation fingerprints at their domain boundaries. General repository mocks cannot
establish any of those guarantees.

## Browser initialization, focus and recovery

Use isolated built-browser checks for SSR/hydration/module delivery and focus when a full backend workflow is not
needed. Use built-application E2E when actual routes, sessions, rendering and persistence are the boundary. Source
development/HMR with real server/persistence belongs to browser integration. Configuration skips are unrun modes.

For ordinary migrated forms and links, assert that the built workflow retains a marker on the current document
and emits no unexpected main-frame navigation request. Select scoped suites by explicit file paths when a filter
also appears in the checkout directory; verify the runner's actual selected cases before treating it as that scope.
Observe the actual generated JSON/multipart operation,
visible completion and persisted effect through the integrated backend. The existing pilot navigation test uses
`document.documentElement.dataset.pilotDocument`; extend that technique in the affected existing suites rather
than introducing another runner, scanner or test framework. A matching final URL, API status or screenshot alone
cannot distinguish Router navigation from a document replacement.

Compare each visible card/form/table/action/footer in the declared scene, including values, constraints, painted
hierarchy, usable fit, destination and collected browser errors; retain raw relative geometry for inspection.
The current profile-workflow matrix covers all five
token/entry/preview/deactivation/account-deletion scenes at 1280px/390px; only independently generated token content
is masked. Packing compares creation, persisted table, Quick Add and Packed restoration. Overview distinguishes a
fresh empty region, populated owner cards and a search with no matches at those same sizes. Matched screenshots
still require individual inspection; one field's geometry cannot establish its surrounding workflow's parity.

Drivers extends its existing built suite with General, expanded image controls, Linked event, Access, Administrators
and Actions comparisons at both sizes. Its actual settings journey submits metadata/defaults, adds/zeros/removes an
administrator, uploads/removes an image, changes the event, archives/restores and deletes through the generated
operations without document replacement. Restricted actions, description-only settings and inherited Event archival
are separate scenes. Native form wrappers and Vue direct actions may have different display or dimensions.
Current comparisons protect visible content, field constraints and selected visual identity, with nonzero painted
areas and independent clipping/interaction checks. Complete raw style and geometry remain attached for review;
they are not all exact comparison assertions.
Shared-component reuse alone cannot establish a feature's injected operation or restricted-control behavior.

Basic Activity adds desktop/mobile functional-interface comparisons for dated creation, schedule/progress, participant status,
shared notes, slot/role/text dialogs, warning review and settings. Wait for the native tab's completed fade before
measuring; an empty transition capture proves no participant parity. Expanded image controls need their own matching
scrolled capture when the modal viewport clips them. Preserve complete measured JSON beside original screenshots.
Real built workflows assert same-document creation/copy, self/organizer assignments, changed-warning rejection and
fresh explicit confirmation, shared-text edits, settings/image/lifecycle/automation, private projections and separate
print documents. The genuine ORM suite retains native engine/transaction checks; the isolated calendar comparison
renders actual native Pug/controller output in an isolated child process across four timezones, without mutating its parent
worker. Retain that native oracle while asserting the approved Vue divergence: one civil-date owner preserves stored
days and Monday weeks across offsets, DST, leap days, year boundaries and the year-1000 preceding Monday. Pure
calendar tests protect invalid inputs and fresh return values; mounted consumers protect selected-language wording,
unchanged dirty nodes and pending review. A genuine ORM read validates the week schema and unchanged saved dates,
assignments and native inputs. Built calendar journeys exercise actual creation, schedules, recommendations and
Event attendance in configured timezone/locale/viewport scenes. Deadline/link timestamps retain their instant
meaning. The Slots total remains the complete saved collection through All/My/Open, fresh receipts and an empty
plan. Source mappings and executed acceptance remain distinct in the migration review.

Advanced Activity adds focused requirement/recommendation component cases and a built Rules workflow. Protect
zero and override precedence through the existing pure requirements engine, unsaved coverage, canceled Reload,
dirty drafts across refreshed snapshots and confirmed saves whose following read fails. Observe only an admitted
domain job identity: status polling and automatic-job completion read saved data without maintenance or dispatch;
explicit generation retains its separate completion trigger. Assert terminal and unavailable jobs, uncertain
dispatch without replay, manual/generated provenance, both reciprocal swap legs and the identical previewed/applied
batch. A changed overlap acknowledgement must reject before saving review or assignments. Compare complete Rules,
coverage, recommendation and manual-dialog surfaces at desktop/mobile sizes, retaining meaningful content/control,
painted hierarchy, fit and accessibility assertions beside individually inspected originals. Existing Activity engines and persistence suites
retain the transactional rules; the Vue rewrite does not duplicate those algorithms in browser tests.

Apply [assertion and isolation guidance](#assertions-and-isolation) to actual actor-owned records too. Administrator
tests use a unique profile and assert its exact identifier; a shared account can accumulate other profiles while
parallel workflows run. Locate an Overview fixture through its ordinary search instead of assuming first-page
membership, retaining the real card/navigation assertions.

Identity completion assertions retain the same confirmed notice while switching English/German and back, checking
the complete conditional former-user/guest deletion wording without command replay or receipt renewal. Existing
native and versioned operation assertions protect the same branch outcomes, original native prose and inherited
partial failures. Catalog completeness alone cannot prove that the actual mounted completion adopts its keys.

Cover Event creation/duplication and selected files, profile token issuance/preview/transfer/deactivation and
account/guest deletion, Event-rendered child deletion and ordinary shell/parent/context links. Include warm entry,
Back/Forward, retained validation input, deliberate cancellation, one pending dispatch, uncertain delivery without
replay, confirmed completion through failed follow-up and actor/visit retirement where applicable. Token issuance
is an explicit action, never a query/prefetch/history effect; secrets and private results remain outside URLs,
Query caches and persistent storage. Keep actual partial backend outcomes rather than asserting new atomicity.

Classify and separately exercise legitimate document transitions: initial/direct arrival, true external
provider/token/email capabilities, provider logout handoff, print/downloads and unmigrated destinations. Preserve
modified-click/new-tab href behavior. Do not reject every navigation request or silently intercept all anchors;
the assertion must name the ordinary SPA operation it protects and the allowed boundary it encounters. These
application assertions and semantic contribution review do not create a documentation or infrastructure CI gate.

Verify request-local SSR identity/locale, escaped validated bootstrap and same-tree hydration. Interactive initial
content uses shared skeletons; successful initialization reveals controls. Readable Help retains functional GET
search, links and anchors. JavaScript-only shell selectors/actions/Retry/dismiss are unavailable before initialization.
The localized startup notice must work independently of the missing/blocked entry module.

Exercise initial and cold scoped placeholders for each page family using the actual route metadata. The built
client browser selection verifies the real SSR/CSS silhouette, one accessible loading status, one animation,
responsive layout and absent dead controls; it does not certify backend admission. Include major structural
differences such as Packing/Drivers columns, Packing's initial-items table, Overview collections and login recovery.
System workflows still use the built application and prepared database. Notification checks use real page/dialog
consumers and commands, assert retained viewport/focus through submission and refresh, and verify shared scope,
renewal, dismissal and expiry. Deliberate dialog entry/return and actual anchor navigation retain their own focus
contracts; they do not authorize notice-induced jumps.

Compare the original baseline with explicit current requirements and approvals. Functional interface parity means
equivalent visible information, available actions and user steps, not exact pixels, DOM identifiers or internal
naming. Keep raw screenshots and measurements for review. Assert meaningful content, control values/constraints,
painted hierarchy, readable labels, reachability, keyboard behavior and usable fit. Responsive wrapping and new
Refresh controls are required behavior; assert their presence and actual fresh reads instead of subtracting them
from geometry to claim whole-image equality. Inventory each admitted data region and assert its page-level or own
healthy Refresh GET, including retained drafts and filters; a successful root read alone does not prove subsection
coverage. Separately protect deliberately narrow post-command reads and private outputs from replay.
Deliberately scrolling tables keep a distinct overflow boundary.
Retain exact business inputs, privacy, no-replay and draft-lifetime assertions. A presentation change justifies
changing only the obsolete assertion it supersedes, never indiscriminate tolerance increases or silently dropping
controls and journeys. Required additions are asserted independently when the native comparator lacks them.

Hydration confirms that client owners mounted; it does not admit a feature's independent reads. Before keyboard or
layout assertions, wait for the current admitted fields and enabled top-level controls of the actual feature or
dialog. Assert readiness through their observable values/states, then exercise the unchanged focus sequence and
measure the complete surface. Fixed sleeps or measurements of a loading skeleton cannot establish that boundary.
For lazy warm navigation, await the destination URL and its own heading before filling an input ID reused by the
previous page. The previous editor can remain visible while delivery finishes; its matching field is not evidence
that the destination owns the control yet.
For debounced discovery, await the response matching the newly typed query and then its settled result controls.
The selected item can already appear in an idle previous page; checking that item or `aria-busy` before the new
search starts can capture loading content instead of the requested comparison surface.
Native modal fixtures use `openModalForE2E` and `closeModalForE2E` for completed lifecycle transitions. A visible,
populated dialog can still be opening, when Bootstrap ignores a close command. Preserve deliberate tests of
interaction during a transition as separate scenarios rather than treating visibility as completed opening.
For a deliberate intermediate-animation assertion, hold the observed native animation through asynchronous data
loading and keyboard work, then finish that same animation before asserting its completed layout and hit targets.
A fixed prolonged duration cannot prove that the transition is still running after network/focus waits. Preserve
the ordinary test deadline, real animation lifecycle and final shown-state/placement/deletion assertions.
Include native-equivalent document titles after initial and warm navigation as well as locale changes. For saved
text, cover empty, single-line and multiline content with literal markup to verify escaping. Capture the surrounding
card and assert placement separately from cropped form/table controls. A full-card image is inspection evidence,
not an assertion of every dimension. Explicitly approved frontend exceptions retain their own expected results;
do not hide them by normalizing away native differences. Survey duplicate checks include every saved description,
weekday and occurrence, plus independent exclusion of answers and the source image.
Survey comparisons additionally inspect complete voting cards and inter-section layout. Integrated Refresh is an
explicit current requirement: assert its usable presentation and read-only operation while preserving ballot drafts.
Earlier comparisons adjusted for its extra row; that historical normalization does not establish current whole-card
acceptance. Empty results retain their
own notice and layout. Wide ballot/result tables exercise
real horizontal overflow, sticky participant headings/cells and the reachable final column at desktop/mobile sizes.
Compare each frontend's delivered page overflow too; a responsive table class alone does not establish its actual
document width or viewport movement.
Owner settings include the complete expanded image and Actions surfaces, keyboard tab selection and Escape focus
return. Archived guest voting and collaborative additions remain available while owner management stays distinct;
archival changes do not imply read-only participation. Temporary same-valued recurrence drafts retain independent
DOM identity; persisted create/copy fixtures retain distinct choices under the existing combination uniqueness
constraint. Removing the final creation row exercises generated rejection and retained-draft recovery before dispatch.
After a command response, wait for its required follow-up read/render to show the saved value and release pending
controls before the next action. A completed HTTP response alone does not establish that the next field/action is enabled.

Exercise actual initial Vue setup, mount and first-readiness failures, including partial handlers: initialization stays
unconfirmed, static navigation/search remains usable and edited-control recovery retains consent. Keep this bounded
initial contract separate from later feature-error handling. Hold/reject route loading, edit genuine static early
input and verify failure/canceled recovery preserves its original control. Automatic reload needs clean state and
working loop protection; deliberate recovery respects pending/unknown work without persisting secrets/files.

When a shared field replaces an existing framework-owned input, characterize the original installed control's
model, DOM spelling, node identity and focus across input, change and unrelated rerenders. A number model does not
promise that its initial spelling survives the next native directive update. Preserve the observed contract rather
than change production behavior to satisfy a newly invented test expectation.

File tests distinguish confirmation from rejection, unknown delivery and background reads. Confirmed upload releases
the feature File and clears the same chooser even when refresh fails; other outcomes retain both. Verify reselection
and focus/input identity instead of replacing nodes merely to make tests pass. A warm form must not display old bytes
when its new draft submits no file.

Committed identity creation requires real ORM atomicity of identity/profile/session and validated prepared output.
Failures before commit leave none of those writes; later mutable context cannot reject a committed receipt. SMTP
failure is delivery uncertainty, not failed creation or permission to replay. Exercise rollback, opposing transitions,
HTTP adoption and receipt privacy at their actual boundaries.

Visual review uses equivalent synthetic records, actors and viewport sizes. Inspect each original image and affected
control; contact sheets and capture success do not establish parity. Test actual keyboard/scroll reachability where
screenshots cannot show lower controls. Label bounded scenes and source scope; do not claim app-wide accessibility
or deployment acceptance from selected checks.

Compare affected surfaces completely: visible wording, control values/states/constraints, labels/help/icons,
typography, readable wrapping and usable action spacing. Include common form actions/footer when the workflow renders
them. Assert meaningful user contracts and recorded browser errors; raw geometry and a JSON attachment remain evidence
for inspection rather than an exact native coordinate contract. Hold actor, persisted data, locale, viewport and loaded fonts equal. Explicitly identify
approved navigation-shell differences instead of hiding real component differences with broad tolerances.
Retain explicit browser-restoration choices such as `autocomplete="off"`; a default can let the browser restore a
shared flag instead of its admitted application owner. Compare that behavior separately from visible wording.
For sticky identity columns, verify actual painted text while the table scrolls past selected or focused answer
labels. A bounding box or computed z-index alone does not prove that another control is not covering the name;
hit-testing the rendered glyph positions protects readability without requiring identical native coordinates.

Event organizer dietary comparisons observe each frontend's ordinary application response without replacing it.
Assert that its rendered badges and derived dietary totals preserve that response's complete values and delivered
order. Register the matching response observer before Refresh, then await its actual subsequent read and rendered
values; the earlier navigation/preload response cannot establish the current rendered order. Compare corresponding dietary
entries/counts/appearance/component layout by choice when the two responses
deliver different sequences; retain all remaining exact text/control assertions and deadlines. This approved
comparison boundary concerns dietary badges/totals only. It does not authorize normalizing other collections,
sorting runtime data or changing shared queries. Raw screenshots and evidence retain the actual rendered order.

Before a database-dependent comparison, verify the effective dedicated target, grants, server version and session
SQL mode. Use the supported CI database baseline and its configured defaults for acceptance. Do not change a shared
database's mode, widen setup deadlines, or add frontend validation to force a native SQL outcome. An alternate local
version/mode may explain diagnostics, but does not certify the supported environment. Report separate preparation
and prepared-schema runs separately from a passing ordinary managed setup command.
Packing's raw-capacity rejection fixtures require the strict SQL mode supplied by that disposable CI/test baseline.
This is a test precondition, not a new production SQL-mode requirement or authorization to change global settings.

## Risk and test cost

Choose incremental protection after retained coverage:

```text
Expected harm without this test = P(regression) × impact × P(unique detection)
Cost = setup/execution time + maintenance + failure diagnosis
```

Use observed evidence when available; otherwise describe likelihood/impact and uncertainty without invented
percentages. Transfer unique observable assertions before retiring duplicates. Money, deletion, privacy,
authorization and demonstrated concurrency failures retain their consequential checks. Similar operation names or
cosmetic fixtures do not prove equivalent coverage. Run affected checks first, then broaden for a changed shared
owner, new failure or unresolved boundary. Measure preparation and diagnosis as well as case count.

## Archival coverage

<!-- /delta:amendment-07 -->

## Command matrix — amendment-08

<!-- delta:amendment-08 -->
| `npm run test:frontend` | No | No | Stubbed globals only | Client helpers and mounted component/state logic. |

<!-- /delta:amendment-08 -->

## CI passes a layer that fails locally — amendment-09

<!-- delta:amendment-09 -->
Compare Node.js, MariaDB, environment files, process-level variables, generated output and Chromium version.
The E2E runner refuses existing-server reuse; check its selected port. Workflow files and the lockfile are the
reproducibility baseline. Record the original failure and measured focused/full reruns rather than widening a timeout
or changing fixtures without establishing the cause.

<!-- /delta:amendment-09 -->

## Runner classification — amendment-10

<!-- delta:amendment-10 -->
- **Vitest integration tests** for production services/controllers against real disposable MariaDB, or genuine integration of production server components when persistence is outside the tested boundary.

<!-- /delta:amendment-10 -->

## Safety first — amendment-11

<!-- delta:amendment-11 -->
- Database-backed integration setup calls `AppDataSource.synchronize(true)` for each suite in the schema-resetting project; the separately selected server-infrastructure fixtures never initialize a database.

<!-- /delta:amendment-11 -->

## 3. Run the desired layer — amendment-12

<!-- delta:amendment-12 -->
`npm test` runs every Vitest layer, including MariaDB integration tests. It is not a database-free shortcut.
`npm run test:quick` selects the configured database-free project: unit/client checks and scoped server-component
integration. The runner configuration owns this selection once.

<!-- /delta:amendment-12 -->

## Command matrix — amendment-13

<!-- delta:amendment-13 -->
| `npm run test:quick` | No | No | Stubbed client globals; real local HTTP listeners for scoped server fixtures | Configured database-free regression selection, including server-component integration. |

<!-- /delta:amendment-13 -->

## Integration tests — amendment-14

<!-- delta:amendment-14 -->
Use `tests/integration/` when correctness depends on TypeORM mappings, transactions, constraints, relationships,
persisted queries or coordination among production services. Selected controller orchestration uses production-shaped
data. Genuine server-component integration may instead exercise actual middleware/rendering/HTTP without application
database persistence. The bounded development-runtime and session-admission fixtures use that boundary rather than
mocked HTTP delivery. Synthetic MemoryStore contexts do not establish stored application identities or ORM behavior.

Database-backed integration uses the real `AppDataSource` and production entity metadata, without general-purpose
repository mocks. The database-free infrastructure selection does not initialize that datasource.

The standard database-backed lifecycle is:

<!-- /delta:amendment-14 -->

## Choosing the layer — amendment-15

<!-- delta:amendment-15 -->
| Controller using production services | Integration | full request parsing, cookies, redirect, or view rendering matters |
| Genuine middleware/rendering/asset delivery | Integration; database-free when application database persistence is outside its boundary | stored application identities, domain workflow or ORM persistence require the integrated application |

<!-- /delta:amendment-15 -->

## Integration tests — amendment-16

<!-- delta:amendment-16 -->
Each database-backed integration file owns a clean schema for its suite. Do not rely on rows created by another
spec file. Use `tests/factories/` for valid production-shaped entities/inputs and remove arbitrary sleeps or ordering
assumptions. The scoped database-free server fixtures instead own and close their local HTTP listeners and any Vite
instance they create.

Use awaited teardown for each owned listener, Vite instance, database connection and temporary fixture after
its children settle, including assertion failures. Remove temporary paths only after verifying their exact resolved
location, ownership and inactive lifecycle; never sweep the user's temporary directory by name shape or age alone.
An abrupt process exit or worker retirement after a timeout can interrupt asynchronous teardown. Inspect its
remaining fixture after the run settles; preserve it when child settlement or ownership is uncertain.
Preserve the current reviewed preparation receipt/output, supported runtime and required verification evidence.
After reviewing their replacement, remove superseded ignored preparation copies and obsolete packaged dependency
trees; retain any source, lockfiles or reports still needed to reproduce their results. Generated runtime contracts
and current build outputs have a separate consumer lifecycle and are not disposable test leftovers.

<!-- /delta:amendment-16 -->

## Vitest configuration — amendment-17

<!-- delta:amendment-17 -->
The configuration uses the Node environment and loads `tests/support/env.ts`. The `database-free` project runs
isolated unit/client files and scoped server-component integration with bounded workers. Windows uses separate
processes after observed native threaded-worker exits without a test result; Linux CI retains threads. The same
concurrency bound, fresh file isolation and UTC environment apply to both pools; the native exit's precise cause
has not been established.

The shared Windows fork worker delivers transformed source through Vitest's existing IPC rather than its optional
per-module temporary-file handoff. This prevents those files and their expensive replacement-style renames; it does
not replace source transformation, mocking, fork isolation, application/database ordering or hook/assertion budgets.
Atomic publication remains appropriate whenever a file handoff or persistent cache is used. The worker extends the
public but experimental `ForksPoolWorker` export, changing only handoff selection and matching factory/worker names;
review that contract on Vitest upgrades. Larger IPC messages trade serialization/memory for the removed filesystem
work. Linux retains its existing thread pool.

The database-backed `integration` project serializes its files because each rebuilds the same disposable schema.
A full local Vitest run orders those projects so database resets do not overlap independent files. Keep database-backed
fixture resets serialized; their requirement does not prohibit isolated database-free parallelism. Exact discovery,
worker limits and project order belong to `vitest.config.mts`.

<!-- /delta:amendment-17 -->

## 1. Create the integration database — amendment-18

<!-- delta:amendment-18 -->
GRANT ALL PRIVILEGES ON `surveyor\_test`.* TO 'surveyor_test'@'127.0.0.1';

<!-- /delta:amendment-18 -->

## 1. Create the E2E database — amendment-19

<!-- delta:amendment-19 -->
GRANT ALL PRIVILEGES ON `surveyor\_e2e`.* TO 'surveyor_e2e'@'127.0.0.1';

<!-- /delta:amendment-19 -->

## E2E environment defaults — amendment-20

<!-- delta:amendment-20 -->
Playwright's managed server and the example environment default `AUTO_ARCHIVE_ENABLED` to `false` so historical
fixtures remain stable. In E2E mode the settings loader still prefers an explicitly supplied
`E2E_AUTO_ARCHIVE_ENABLED` value over that plain setting. Use this override only for an intentional
automatic-archival workflow and verify the effective value before running it. Manual archive/restore and
personal-visibility E2E tests run normally with the automatic job disabled.

<!-- /delta:amendment-20 -->
