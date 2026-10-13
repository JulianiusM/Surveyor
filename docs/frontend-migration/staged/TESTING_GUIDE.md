# Staged frontend testing guidance
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: application maintainers
status: migration-pending
last-verified: 2026-10-13
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: strict E2E/client/source-integration classification retained; refined Req6A skeleton/static startup, failure notice and API completion assertions reconciled; executed results remain in paired review
source-anchors: package.json; vitest.config.mts; playwright.config.ts; playwright.frontend.config.ts; playwright.integration.config.ts; tsconfig.test.json; tsconfig.server.json; tsconfig.frontend.json; tsconfig.frontend-ssr.json; tests/support/database.ts; tests/support/env.ts; tests/unit/; tests/frontend/; tests/integration/; tests/e2e/; .github/workflows/ci.yml; docs/TESTING_GUIDE.md
next-review: frontend-production-cutover
canonical-merge-target: docs/TESTING_GUIDE.md
production-reference: 2dfa257 native documentation; not evidence of the installed production commit
-->

## Cutover staging

This is the frontend delta for [Testing](../../TESTING_GUIDE.md), which retains unchanged setup, environment,
database guards and operator procedures. At authorized cutover, reconcile changes, merge this guidance into existing
sections and remove the copy. Staged documents are never runtime inputs or required prose assertions.

The [Development playbook](DEVELOPMENT.md#implementing-the-next-feature-slice) owns implementation handoffs.
The [pilot review](../PILOT_PARITY_REVIEW.md) records actual final commands/results and limits.
Historical counts/timings do not establish acceptance of changed inputs.

## Choose the cheapest stable boundary

| Layer | Observable behavior requiring it |
|---|---|
| Unit | Pure production logic with no database, HTTP app, external service or real browser. |
| Frontend/client | Browser helpers/DOM/mounted Vue under Vitest; isolated built-browser workflows under the client Playwright runner. |
| Integration | TypeORM metadata/relationships, locked controller orchestration and persistence against guarded disposable MariaDB. |
| E2E | Built application with a fully prepared database, exercising the integrated routes, middleware, sessions, rendering and persistence. |

The explicit 2026-10-13 decision reaffirms the original E2E boundary. Earlier staged wording also called isolated
focus/source/hydration checks E2E; that classification is superseded, not evidence that such fixtures exercise a
production system. A server/database running alongside a manufactured document does not change the tested boundary.
Source development workflows requiring a live server/schema belong to integration coverage; isolated browser
fixtures belong only to the client layer. Classification changes preserve their assertions rather than deleting them.

Add another layer only when risk crosses that boundary. A shared helper assertion cannot prove a feature adopted it.
Repository/service mocks cannot establish transaction behavior. Replace only a true external side effect when the
production workflow remains intact. Frontend tests restore globals, dispose apps/queries/timers/listeners and use
fresh inputs instead of shared mutable snapshots.

## Generated inputs and focused commands

Package pre-hooks prepare generated consumers for normal test/typecheck scripts.
Direct Vitest/Playwright/compiler invocations can bypass hooks; prepare inputs after a clean checkout or authored
contract/catalog change. Generation does not connect to the database.

```powershell
npm run generate
npm run test:quick
npm run typecheck:frontend
npm run typecheck:tests
```

These commands have different scopes. `test:quick` is database-free unit plus frontend; it is not an integration
check. The exact package scripts are authoritative. To select one changed frontend file without also selecting
the whole directory, use the prepared direct runner:

```powershell
npx vitest run --config vitest.config.mts tests/frontend/frontend-command-recovery.spec.ts
```

Adding a filename to a script that already selects the whole directory may still run that directory.
Use named test filters only when their actual selection is appropriate; report filtered/unexecuted cases honestly.

`npm run test:frontend:browser` builds the required native/client/SSR artifacts through its normal pre-hook, then
selects only `tests/frontend/browser/` with `playwright.frontend.config.ts`. It loads no E2E environment, starts no
server and initializes no database. After a current normal build, `--ignore-scripts` skips only that repeated build.
Vitest excludes this Playwright directory rather than attempting to execute its browser tests.

`npm run test:integration:browser` selects `tests/integration/browser/` with `playwright.integration.config.ts`.
It requires the already-owned source server and fully prepared disposable schema described by that suite. The legacy
`E2E_FRONTEND_DEVELOPMENT=true` selector remains compatible; its name does not classify these source checks as E2E.
The command neither builds/starts a server nor resets a database. Vitest's ORM project excludes this directory.

The E2E runner owns `dist/server.js`, its schema initialization and built assets. It explicitly disables the frontend
development renderer and refuses to reuse an arbitrary local server; a busy selected port must be resolved before
running it. This enforces the 2026-10-13 system-test decision rather than trusting a process already listening there.
The managed system server also uses a refused local SMTP socket for deterministic delivery-failure coverage without
external email. Application mail preparation and transport still run; live-provider delivery remains separate evidence.

## Static checking

`npm run typecheck:frontend` checks both client and SSR Vue configurations.
The server build owns `tsconfig.server.json`; `npm run typecheck:tests` uses vue-tsc and `tsconfig.test.json`
for test entries, shared declarations and production/SFC imports reached by those entries.
Vitest transpilation does not type-check test assertions, mounted fixtures or all SFC imports.

The current test-import graph is narrower than the old all-production-TypeScript graph. A PASS must describe that
scope. The broad editor graph still has two inherited native nullable-date diagnostics; they are not suppressed,
fixed or excluded through this documentation change. Server/client/SSR/test scopes do not certify every unimported
native browser source. Changes to required check scope need explicit resolution, not a convenient clean result.

Generated compile fixtures protect actual request/response/problem declaration relationships and negative cases.
Do not add parallel handwritten types to make fixtures compile.

## Database-backed checks

Read canonical [database safety](../../TESTING_GUIDE.md) before integration or E2E commands: selected schemas are
rebuilt. Confirm effective host/schema/credentials and explicit disposability; names containing test/e2e alone
do not prove safe targets. Use restricted credentials with no privileges outside their dedicated schemas.
Never reset development, staging, production or shared data.

Integration files rebuild the same schema and remain serialized. Database-free workers are independently isolated.
Follow runner configuration rather than parallelizing fixture resets for speed.

Shared-operation/method-policy consolidation is applied. Its final persistence selection invokes actual native/v1
operations against real TypeORM metadata.
Keep page membership separate from action authorization, private edit-token projection, touched-field comparison,
capacity and assignment interleavings. The opposing native item/FK and v1 root/item schedule reproduced a real
MariaDB deadlock. The approved 2026-10-12 remedy now takes a native shared root lock before the exclusive item lock;
v1 keeps its exclusive root coordination. Production-controller regressions cover both arrival orders, parallel
different-item assignments, deletion races and preserved removals; their execution belongs to the
[review](../PILOT_PARITY_REVIEW.md). Preserve the historical failure separately from evidence for the remedy.
Any future scheduling change still needs direct authorization and bounded verification; v1/v1 coverage alone does
not establish coexistence.

## Mounted read, draft and command evidence

Retain actual-consumer checks where they uniquely detect:

- Missing initial data versus background refresh; parallel regions and no invented empty/count state.
- Dirty/original/local/remote values, independent dialog drafts and changed-field submission.
- Field write loss versus readable content, validated denial, actor/locale retirement and stale SSR/cache aliases.
- Confirmed write followed by failed/canceled read; blocked token/baseline authority until a new admitted receipt.
- Unknown command recovery without replay or a false conclusion about an unknown creation.
- Retained completion/destination/one-time feedback through canceled navigation and retired editors.
- Receipt-owned expiry, repeated outcome renewal, reactive translation and detached initiating hosts.
- Shared read Retry deadlines without automatic writes/GETs or unrelated-warning clearing.
- Focus/visibility/reconnect waits for successful session bootstrap without unmounting readable drafts; failed or
  cooldown-blocked bootstrap cannot dispatch private queries.
- Session resume preserves terminal resource/image read rejection; deliberate recovery and an admitted projection
  refresh remain distinct from automatic observers. Held admitted image/picker operations survive an ordinary pause,
  and focus recovery shares the already-started read rather than canceling/restarting it.
- A new mounted logical-key visit rechecks cached terminal rejection; joined pending reads consume that first
  admission. Explicit dependencies recover readable terminal-paused observers through their own query functions,
  including shared-key siblings, without reading hidden/closed/retired consumers or using last-writer options.
- Validated region denial retires its derived totals/badges with cards/cache; temporary failure and independently
  admitted siblings retain their own confirmed evidence without an invented zero count.
- Confirmed locale change cancels only language-owned families and preserves an in-flight machine authority read.
- Packed checks retain mounted-visit selections through unavailable/throwing storage and background reads, with a
  persistent localized notice about load/save failure and unsaved-change loss on leave/reload/account/profile change.
  Failed reads do not imply that previously stored or successfully written checks are unpersisted. Healthy rereads
  still adopt external changes and missing keys as unchecked for items without outstanding failed writes. Explicit local
  Retry reattempts only pending browser-storage writes/reads and clears the notice only after they succeed; polling
  never replays writes. List/context change, remount or validated denial retires fallback without server commands.
  Retained callbacks reject detached/foreign rows and changed actors; Retry prunes removed rows before writing.

Use real query/cache/transport behavior for authority regressions. A fulfilled observer refetch may return retained
pre-write data after cancellation; hold and cancel the actual mounted post-write read, prove one write, and restore
authority through a new admitted read. Equal successful data is a valid receipt; object identity/idle flags are not.

Generated comparison fixtures exercise realistic full metadata/settings tokens through the actual declared header,
browser transport and owning decoder, including oversized rejection. Real persistence checks distinguish the approved
same-event no-op from a changed association: current source/target authorization remains required, comparison data is
ignored only for the harmless result, and changed relationships retain their expected/current preconditions. Preserve
native transport outcomes and verify every factory/preflight consumer of shared action policy.

## Browser, visual and source boundaries

Use E2E for critical direct-URL, Back/forward/fragment, admission/destination, duplicate-return and browser-validity
journeys which exercise the built application and fully prepared database together. Isolated focus, hydration and
native-template/built-module checks use the client browser runner. Source-loader/HMR workflows with real server
persistence use the selected browser integration runner. Exercise usable controls, not only a hydration marker.
Configuration-dependent skips are unrun modes unless executed separately.

Paired visual checks use the same synthetic records, actors and desktop/mobile sizes. Inspect original-resolution
screenshots and affected controls; capture success or a contact sheet alone is not visual approval.
Native comparator overflow/feedback defects stay disclosed without changing frozen source or test oracles.
A focused owner/control change does not require another whole application capture matrix.

Source/Vite HMR, authored-input regeneration/restart, production-without-development-dependencies and installed-folder
replacement cross separate boundaries. Exercise them when affected; ordinary feature migration does not need every
rehearsal repeated. Keep current-release/chunk recovery and mounted drafts under D5.

SSR checks prove request-local identity/locale, escaped bootstrap, same-tree hydration and absence of private leaks.
Under the [refined initial-delivery amendment](../FRONTEND_FOUNDATION_DESIGN.md#authorized-interactive-startup-delivery-clarification-2026-10-13),
interactive initial pages show the shared skeleton; successful initialization reveals the existing controls. Readable
denials/completions and Help retain static output, native GET search, links and anchors. Verify JavaScript-dependent
shell selectors/actions/Retry/dismiss are unavailable before initialization while native links/mobile disclosures work.
The localized JavaScript-required notice must remain independent of the module it diagnoses: disabled JavaScript,
missing/blocked entry delivery and failed initialization cannot leave normal-looking dead controls or navigation.
Exercise actual initial Vue setup/mounted and first-readiness failure, including a partially attached application: initialization stays
unconfirmed, the notice remains visible, genuine native links/Help GET search still work and edited-control recovery
keeps its consent. Do not broaden those initial checks into a redesign of later component-error handling.
Retained SSR artifacts and same-tree hydration still need their ordinary production build and browser boundaries.

Startup checks cover the interval before mounted guards exist: hold or reject actual route loading, edit a genuinely
static control such as Help search and verify it survives failure and cancelled recovery. Earlier edited login/create
SSR cases describe the superseded interactive markup and cannot certify this contract. Automatic reload needs
clean-state evidence and a working
loop marker; unavailable storage must expose localized deliberate recovery. Explicit recovery may bypass an automatic
attempt marker but still requires edited-control consent and preserves pending/unknown command guards. Verify the
initial guard is released only after mount restoration; a helper test without the actual entry consumer is insufficient.
Neither browser storage nor recovery may persist secrets/files or replay commands.

Retired interactive pilot POST adapters need built-application checks that they cannot create identities or perform
commands. Existing APIs, capability/admission GETs and native routes retain their respective behavior. Test current
API completion through the real generated validator/serializer and captured delivery rather than preserving an unused
document callback solely for a test. Retain unique earlier document results as historical receipts in the paired review.

Mounted header checks distinguish confirmation from rejection/unknown delivery and background refresh. Confirmed
upload releases the feature-owned file and clears the same native input, including saved-plus-failed-refresh; the
other outcomes retain both. Verify reselection of the same file and preserve input identity/focus rather than using
an unmount/remount as a test substitute. Add real-browser coverage only for a boundary the mounted evidence cannot prove.

Review all reused/restored controls against their current use-case: should this admitted form still contain the value?
Compare rendered text/select/checkbox/file values, feature-owned drafts and submitted inputs after warm/cold navigation,
actor changes, hydration and completion. Preserve intended drafts, but released values must clear the actual controls.
In particular, a warm creation/duplicate route must not display an old FileList when its new draft submits no file.
Do not silently discard a user action or apply a blanket reset to controls whose live drafts remain intentional.

Committed identity creation requires real-ORM Guest/Profile/session atomicity and the actual HTTP adoption path.
Context/expiry/validation/persistence failures before commit leave none of those writes; a prepared completion receipt
must not rehydrate or reject against a later mutable actor after commit. SMTP failure is a delivery outcome, not failed
creation or permission to replay it. Exercise opposing transitions, rollback, response autosave and committed receipt
privacy; a helper-only guard test cannot establish these boundaries.

## Help security versus maintained prose

Native English Help remains `docs/user-guide/`; reviewed EN/DE pilot Help is `docs/user-guide/<locale>/`.
Staged maintainer content must never be read/searched/served by application selectors.
Synthetic fixtures specify permitted source roots independently and exercise forbidden staging, traversal,
Markdown URI/HTML/image validation and locale-owned asset behavior.

Maintained guide text/images are documentation, not required application assertions.
Optional content/browser reports remain outside mandatory application test discovery. Changing a runtime source
or trust model still requires application security coverage; introducing tenant/upload/editor/remote Help needs
a separate DEC-004 decision.

## Risk and test cost

Evaluate incremental protection after retained coverage and review:

```text
Expected harm without this test = P(regression) × impact × P(unique detection)
Cost = setup/execution time + maintenance + failure diagnosis
```

Use incident/change evidence when available. Otherwise label ordinal likelihood/impact and uncertainty; their
product is a prioritization score, not a measured probability. Never invent percentages.

- Name retained inputs, boundaries and observable assertions before deleting an explicit/effective duplicate.
  Transfer unique observations first. Similar operation names across layers do not establish equivalence.
- Keep consequential money, deletion, privacy, authorization and demonstrated race checks even with low estimated
  likelihood. Preserve production-consumer evidence that exposed defects.
- Use representative equivalent cosmetic inputs while keeping genuinely distinct branches. Reuse compilation/setup,
  render fresh values and cache neither mutable state nor expected outputs.
- During iteration run affected files and necessary type/build scopes. Broaden for a new failure, changed shared
  owner or unresolved risk; full visual/deployment/source replay is conditional, not a per-module ritual.
- Measure wall time, imports/setup and diagnosis as well as case count. Improve repeated preparation/serialization
  before dropping coverage. A ten-minute routine CI target is a target; report local and hosted measurements separately.

The earlier native deletion/privacy transfer gaps show why sampling cannot certify all removed tests.
Keep actual native deletion-owner assertions and whole-response denied-identity exclusion where their retained
fixtures already provide unique detection. Do not add another broad cross-product merely to increase counts.

## CI and reporting

Executable CI currently separates database-free, serial integration and browser stages, with isolated runner setup.
The browser stage retains separate client and E2E runner/report boundaries after its normal build. Report merging
does not rerun suites. Preserve distinct application checks and configured diagnostics.
Node/MariaDB versions, worker limits, stage timeout and exact preparation order belong to workflow/runner files,
rather than duplicated command matrices.

Application correctness checks remain required; documentation reports/tooling/content checks stay advisory.
Optional `docs:check`, `docs:check:strict`, `docs:check:help` and `docs:test:*` report findings/failures/tool errors.
An exit zero does not mean every diagnostic passed. See canonical [Documentation Policy](../../policies/DOCUMENTATION_POLICY.md).
Record only actual final execution and prerequisites in the existing review; do not rebaseline or suppress findings
to obtain green, or claim hosted CI/live providers/mail/production cutover from local evidence.
