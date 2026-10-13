# Frontend pilot parity review
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-13
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: approved Packed storage correction and documentation traceability/source-boundary review; current focused/quick tests, Vue-aware test compiler, build and complete frontend engineering checks passed; advisory report inspected with preserved historical fingerprint finding; prior scoped evidence retained separately
source-anchors: src/controller/packingController.ts; src/controller/entityAdminController.ts; src/controller/eventController.ts; src/modules/database/services/PackingService.ts; src/modules/database/services/EntityLifecycleService.ts; src/modules/lib/fileCommons.ts; src/controller/helpController.ts; src/frontend/; contracts/api/v1/; src/locales/; scripts/generate-locales.mjs; tests/unit/frontend-generation.spec.ts; tests/integration/packing-coexistence.spec.ts; tests/integration/packing-management-api.spec.ts; tests/e2e/frontend-pilot-api.spec.ts; docs/frontend-migration/FRONTEND_PILOT.md; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md; docs/frontend-migration/staged/; docs/backlog/documentation-remediation.yml
next-review: next-migration-slice-or-permission-policy-review
-->

The native comparator is `2dfa2573c64178f54684cc4877b5a945f66e24c8`, with explicit exceptions retained in the
[foundation ledger](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments). This record owns current
findings and latest relevant evidence. Superseded procedures, repeated failures/counts and capture transcripts stay
in Git history and ignored artifacts, without another maintained archive.

**Earlier readiness corrections passed within their recorded scopes below.** The maintainer's
2026-10-12 decisions restore the canonical documentation classifications, authorize the bounded native lock remedy,
and permit safe native public-action parity. The independent security/design review found no protected-resource
disclosure or original blanket profile requirement for those narrow operations. Further permission-policy review
remains backlog scope. The direct 2026-10-13 instruction authorizes the reviewed readiness corrections and explicitly
preserves harmless native/v1 same-event no-ops after current authorization, without comparing or writing. The original
precondition choice and this bounded exception both remain in the [foundation ledger](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments).
This record contains dispositions and evidence, never hidden approval requests.

The current review found silent loss of temporary Packed selections during storage failure, seven comment/readability
findings in the full frontend scope, an obsolete native-illustration freeze statement and incorrectly broad
baseline identifiers. The maintainer explicitly authorized their implementation and the bounded Packed fallback,
requiring problems to remain visible. The [single dated amendment](FRONTEND_FOUNDATION_DESIGN.md#authorized-temporary-packed-state-fallback-2026-10-13)
retains native keys and behavior; current evidence is separate from the earlier broad receipts below.

## Implemented disposition (2026-10-13)

| Reviewed issue | Applied correction and boundary |
|---|---|
| Packed storage failures silently reset selected checks during membership/order refresh | Existing Packed owners return storage availability and persistence outcomes. The mounted actor/list retains failed-read values and per-row failed writes; healthy unrelated keys and missing-key false retain their native reread meaning. Persistent EN/DE status explains load/save failure and possible loss of unsaved changes on leave/reload/account/profile change. Explicit Retry writes only outstanding live local selections and rereads, with no HTTP command or automatic replay. Captured actor/admitted list/rendered-row guards reject retired callbacks; denial, context/list change, removed rows and unmount retire fallback. Previously stored or successfully written values are not incorrectly classified as unpersisted. The focused mounted cases close `IMP-043`; native source and persisted keys remain unchanged. |
| Full frontend review exceeded the earlier 25-file readability receipt | Seven comment/readability findings were corrected in existing owners, including substantive lifecycle explanations and lower-risk callback consistency. The current complete 54-file frontend check and independent semantic review complement declaration/DBAL inventory checks; the earlier scoped pass is preserved as prior evidence. No numeric style exception, blanket formatter or scope exclusion is added. |
| Staged asset governance and baseline assertion IDs retained obsolete claims | Existing Help Visuals now names the approved unused-illustration removal and preserves the remaining native comparator. The existing assertion map uses `ENT-03` for event relinking, precise public-method/comparison/Overview IDs and explicit foundation generation scope; it adds actual Packed failure/recovery/retirement assertions. No baseline, decision or staged owner is deleted. |
| Session resumes dispatched private reads before bootstrap admission | Existing context separates presentation `ready`/`isCurrent` from `readsReady`/`mayRead`; current successful bootstrap opens dispatch. Visibility closes admission before publishing the resumed state. Pending, failed or cooldown-blocked bootstrap retains mounted content/drafts without reopening private queries. Transport and actual consumers share the gate. Admitted image/picker lifetimes still retire on actual scope/input/visibility changes. |
| Terminal failures either retried on session resumes or prevented new visits | Existing query-cache `useQueryAdmission` gives each mounted logical-key visit its first GET, including cached terminal denial. Dispatched/joined pending reads consume first admission; equal recreated keys retain it. Later automatic resumes stay paused. Manual recovery and explicit command dependencies use current read eligibility; family recovery selects actual key-bound observer options, preserving hidden/closed/retired consumers. |
| Denied Overview cards retired but derived totals/badges remained | Existing Overview owner stores source/key/read receipts, deriving displayed counts from admitted QueryClient projections. Validated denial retires only that source's aggregates; temporary failure and independently admitted sibling evidence retain their own scope. Unknown membership remains unknown. Eligible initial SSR projections seed the same Page/Region key through shared `overviewQueryParameters`. No second server-data store is introduced. |
| Locale preference changes interrupted machine authority reads | `belongsToLocalizedQueryFamily` selects named Help/Overview actor families for cancellation/invalidation. Language-independent Packing/edit/discovery data and admitted warm machine reads retain their existing authority. |
| Repeated settings composites slowed the next migration slice | Actual Packing adoption of `EntityHeaderEditor`, `EntityEventEditor` and `EntityLifecycleActions` shares repeated presentation and preserves focus through established controls/dialog owners, using props, events and injected operations. `.d.ts` contracts define their inputs; Packing retains drafts, tokens, labels, dependencies and command orchestration. Native feedback initiators and grants remain intact. No generic CRUD engine, controller or service is added. |
| Common policy existed without complete native/v1 adoption | Existing `entityAdminController.entityMethodPermission` supplies common header/event/manage/duplicate grants to native factories, middleware, relink presentation/authorization and Packing policy/capabilities. Settings admission derives existing metadata/method owners. Narrow action baselines, public context/CSRF and lock-time checks remain unchanged; protected projections stay protected. No new grants are introduced. |
| Authored comparison limit rejected real emitted metadata/settings tokens | Common authored `ComparisonToken` supplies the 4,096-character bound; `FieldComparisonToken` composes that bound with existing strong edit-token syntax. Generated request/response validation and the controller decoder consume those owners. Approved same-event no-op ignores even missing/empty/oversized evidence after current source/target authorization; actual relationship changes retain required comparison and 428/412 behavior. |
| Stale generated JavaScript shadowed maintained permission TypeScript | Existing locale generator detects only its reserved `permissions.js`/`.js.map` siblings. Check mode reports without mutation; normal generation retires only validated exact regular-file paths before publishing TypeScript. Symlinks/redirected parents fail safely, unrelated files remain. A real isolated output-tree regression protects both modes; collision scans retain their original scope. |
| Relocation left duplicate backend business owners | Existing Packing controller shares creation, metadata, item/membership writes, counters and reorder/delete/default hooks. Existing event/admin/lifecycle/image owners supply their shared behavior. Native/v1 adapters retain protocol/normalization/error/feedback differences and retire independently. |
| Native/v1 assignment deadlock | Approved native assignment coordination locks the root in shared mode before the item in exclusive mode; v1 retains its exclusive root lock. Actual production-controller schedules now complete in both orders and for different items, with capacity, deletion-race and removal behavior preserved. |
| Inherited native permission/coercion quirks | Preserve native item description/write versus display grants, raw Everyone omission/missing-row outcomes, signed/null capacity inputs and SQL rounding, sparse order and partial failure. `IMP-022`/`IMP-023` and other native defects remain distinct from migration corrections. |
| Repeated metadata structural validation | The normalized HTTP adapter validates once; the typed controller operation consumes the admitted patch. Native Joi diagnostics remain its adapter contract. |
| Shared setup/image projections | Preserve numeric default-mask bits through the existing permission owner; controller administrator operation returns domain outcomes; parent/privacy and archival projections use existing owners and the transaction manager. Image replacement uses the existing committed previous-image receipt, with v1 post-commit cleanup. The separately approved automatic-archival remedy closes `IMP-042` through its own real queued date/restore/job schedules and independent one-primary-read review. |
| Help source and future-language fallback | One canonical `docs/user-guide/` root contains native English plus adjacent `en/`, `de/` and approved catalog directories. The unauthorized separate pilot root is retired. Missing locale/topic/figure uses reviewed pilot English with visible notice, English result markers and actual content language. Unsafe/unreadable/escaped existing sources fail normally. Staging is never application input. |
| Readability and policy execution | Purposeful contracts, separate internal step explanations, accurate state/authorization terminology and logical spacing accompany the current owned changes. Measurable TypeScript/Vue checks complement independent human review; instructions alone and comment presence are insufficient. No native layout redesign is included. |
| Documentation history/ownership | Repeated backlog/history is substantially consolidated while original IDs remain. Root guides, policies, ADRs, feature references, backlog and migration records follow the approved classifications. The mistaken intermediate rename is explicitly corrected to original `docs/user-guide/`, without treating it as design precedent. Approved cleanup removes only the unreferenced obsolete controls illustration and maintainer-only Activity Help paragraph. |
| Staged guidance diverged from source | One existing playbook now includes concrete shared operations/adoption, session/read/visit admission, count receipts, locale-family ownership, settings composites, generator hygiene, every-writer/FK review and precise baseline-to-assertion links. Canonical runner facts are corrected editorially; prospective pilot deltas stay staged. Opt-in coexistence is distinct from an independently approved full default cutover. No unique baseline/design/staged record is deleted. |

The [coverage map](TEST_COVERAGE.md#pilot-baseline-to-implementation-assertions) links baseline IDs to implementation
owners and concrete assertions. Aggregate passing counts alone do not establish full feature parity.

## Approved runtime boundaries

The native assignment root lock can extend waits behind exclusive list writers. That bounded consequence was approved;
it does not authorize a general lock framework. The original failing schedule remains recoverable in Git history;
maintained acceptance tests exercise the remedy through actual shared production controllers and foreign keys.

Public permissions remain explicit native grants, not default edit/manage authority. Anonymous comparison tokens use
captured session context without fabricating a profile. Protected projections, identity hydration, method/field grants,
actual route-parent scope, closed payloads and authorization before conditional responses remain enforced.
The [permission-review backlog](../backlog/documentation-remediation.yml) owns broader review and any future rework;
its existence does not allege a newly discovered vulnerability or authorize changing native permission policy.

## Original choices and reusable lessons

The ledger retains original choices and D1–D5/Oct8 amendments, including the i18next-vue restoration, current-value
comparison, reconcile-only commands, folder replacement, JavaScript and progressive-loading decisions. Direct
instructions preserve the original canonical Help path and visible English fallback, and authorize the bounded
readiness corrections above. Recorded historic approval
provenance is distinct from independently reconstructed conversation receipts; that earlier evidence limit is retained
here once and is not turned into repeated approval requests.

| Unique lesson | Required practice for the next slice |
|---|---|
| Initial translation/watch substitutions and source-only success | Preserve original technology decisions; exercise actual emitted source URLs, mounted controls and authored-input regeneration only when their owners change. |
| Passing broad tests missed parity/consumer details | Trace native GET/POST/controller/rendered outcomes by actor, including no-op/coercion/feedback/destinations. Test actual adoption, receipt lifetime and browser validity rather than helpers alone. |
| Recovered caches could carry retired authority | Preserve raw original/local/current state, forward cancellation through classification, and require a dispatched admitted read. Equal successful data can renew authority; retained canceled data cannot. |
| Frozen native fixes changed the comparator | Compare immutable reference first; keep inherited defects/diagnostics separate and seek direct approval for unintended consequences. |
| Source policy/lock comments overstated sharing | Named controller operations and independently specified runtime fixtures prove ownership/source boundaries; actual native/v1/FK schedules distinguish inference from reproduced failure. |

## All requested review criteria

| Criterion | Current disposition |
|---|---|
| Original vision and completeness | Bounded Help/Packing/required entry foundation and authorized readiness corrections are implemented, with completed scoped execution below. Other migrations/default-route cutover remain future scope. |
| Original design and authorization | Selected stack preserved; original choices and dated amendments remain visible. Unapproved runtime consequences remain unapplied. |
| Modularity, DRY and single source of truth | Existing controllers own shared operations/policy; adapters own protocols; pure DBAL owns persistence/locks. Actual consumers adopt shared grants, query admission and settings composites. Generated contracts/catalogs and admitted query projections remain authoritative. |
| Comments, readability and formatting | Named operations/presentation helpers, purposeful transaction/command/template comments and logical boundaries; no blanket refactor or new forwarding modules. |
| Core coding principles | Shared type-only contracts are `.d.ts`; renderer data is explicit; business checks/contextual errors remain outside DBAL. |
| Technical debt | Duplicate ownership/validation/staging defects, read-admission/aggregate leaks and generated-source collision corrected. Inherited native defects and future permission review remain in their existing backlog owners. Environment/operator limits are disclosed below. |
| Repository/documentation cleanliness | Current evidence replaces repeated run histories; durable contracts, IDs, classifications and original decision rationale remain. No speculative deletion, new document destination, rule exception or fingerprint rebaseline is introduced. Native content remains the reference. |
| Consistent implementation guideline | One staged Development playbook plus baseline-to-owner/assertion map covers policy, transport, drafts, privacy, SSR, Help, recovery and cost-based verification. |
| Designed versus implemented architecture | Shared controller/pure-DBAL structure matches the target. Existing context/query owners and presentation composites absorb readiness lessons. Approved coexistence, public-action and same-event adjustments remain explicit dated amendments. |
| Staged consistency | Technical pilot deltas remain staged; original choices are amended explicitly; current execution is owned here once. |

## Prior scoped verification and limits

These receipts belong to the earlier readiness correction and predate the current Packed/readability/documentation
correction. They retain their original scopes and limits; they are not renewed by the current mounted tests or build.

| Check | Current receipt and scope |
|---|---|
| Focused real Packing persistence | Current guarded selection: five files, 74 tests passed, including real emitted comparison tokens, native/v1 same-event no-ops, public grants, protected reads, minimal baselines and coexistence schedules. Effective dedicated port/schema credentials were checked before the database run. |
| Native/v1 coordination | Retained production-controller schedules exercise both execution orders, parallel different-item assignments, deletion races and preserved removals/overwrite within the current guarded selection. No unrelated writer schedule is certified. |
| Database-free quick/frontend scope | Final normal quick suite: 61 files, 1,336 tests passed after all source/test refinements. Includes cold visits, reused Help Back, joined reads, shared-key observer selection and actual canceled warm authority recovery; concrete assertions are linked in the coverage map. |
| Guarded integration scope | The current 74-test selection is the affected persistence boundary; no new complete integration-suite run is claimed. |
| Compiler scopes | Current server and final Vue-aware test compilers passed, including the latest mounted regressions; the normal build passed its server/frontend/SSR graphs. No whole native/editor-graph certification. |
| Built browser/HTTP selection | Current guarded built selection: four suites, 60 tests passed, one existing disabled-authentication-configuration case skipped. Includes actual native/v1 no-op HTTP, native Pug factory flows and pilot settings/image/locale/Help SSR behavior. The skipped configuration remains unrun; this selection is not the full browser suite or visual matrix. |
| Integrated source development | Three current source-mode journeys passed: executable source assets/locale navigation, pre-hydration Overview search and mounted Packing controls/real commands without document replacement. Dynamic authored-input/HMR verification remains separate. |
| Authored-input regeneration/HMR | Four current checks passed: actual CSS HMR and restoration preserve document/focused control/draft; authored contract/catalog regeneration reaches its ready marker before Express restart and updates the mounted label. All three probed authored files were restored byte-for-byte and generated API/catalog values restored. Source-mode journeys alone are not this evidence. |
| Installed-folder recovery | Four actual behavior assertions verified in the guarded installed copy: replacement removes old assets and changes build ID while API compatibility stays equal; a clean tab reloads its document exactly once and focus does not reload again; an actual removed old chunk returns 404 while a dirty tab retains its document/draft; an older compatible client completes one real persisted 201 command. Core proof is retained separately from the combined helper's later capture-fixture failure and the successful corrected capture invocation; no whole-helper or operator-rehearsal pass is inferred. |
| Selected paired captures and inspection | Separate corrected invocation passed 20 settled native/pilot desktop/mobile captures using equal fixture/actor/viewport scenes. Actual inspection accepts event controls/options, header/action panel geometry, detail columns/Quick Add and Help columns/figures at the selected sizes. Established pilot locale/manual-refresh controls and the native one-time-flash vertical offset remain explicit differences. All four Help scenes have complete article images. This is source-scoped visual acceptance, not exact-pixel, whole-prose or full-application-matrix certification. |
| Native reference and structural scans | Current tracked native layout/browser/view and DBAL paths have no diff against the task starting HEAD. Original 133-file immutable-reference comparison retains only the previously approved exceptions; this readiness change adds none. |
| Documentation reporting | Current report after authored-probe restoration: 87 Markdown files and 1,458 links; no broken links, metadata, classification, command/path or stale-term findings. Help authoring: 32 Markdown files, 585 links and nine images, clean. The single historical source-fingerprint mismatch stays advisory, with no rebaseline or exception change. |
| Engineering enforcement | Final explicit full-file owned-source check: 25 executable files, 224 nontrivial operations, zero findings. The 288-file authored executable inventory, global declaration filenames and all 11 authored DBAL services remain covered. No whole-checkout readability certification or persistent exclusion is introduced. |
| Independent source review | Separate review accepts shared grant adoption, controller/DBAL boundaries, bounded comparison validation, exact generator cleanup, key-bound actual-observer dependency reads and native preservation. Root independently accepts the concrete documentation diff and inspected selected visual scenes; executed receipts retain their distinct scopes. |
| Production build | Current normal `npm run build` passed generation, server, frontend, client, SSR and packaging-copy scopes. Existing Sass/dynamic-import warnings remain; no whole-editor-graph claim. |

Native nullable-date diagnostics and previously observed narrow creation/Help layout limits remain inherited. No native
UI/compiler repair is authorized by this correction. Local checks do not certify hosted CI, live OIDC/mail, a new full
visual matrix, production cutover or operator rehearsal. Documentation reports remain advisory
and never become application, CI, release or deployment gates.

## Current correction verification (2026-10-13)

Current source corrections and their actual checks are recorded separately from the prior persistence, browser,
HMR, installed-folder and visual receipts. No new browser, persistence, HMR, installed-folder or visual run is claimed.

| Executed check | Current result and scope |
|---|---|
| Database-free quick suite | `npm run test:quick`: 61 files, 1,346 tests passed. The subsequent explicit test-mock signature correction preserves runtime behavior; the final focused selection and Vue-aware compiler passed after it. This covers current unit/frontend production consumers, including the Packed and shared-read regressions; it is not database integration or real-browser evidence. |
| Focused mounted production consumers | `node node_modules/vitest/vitest.mjs run --config vitest.config.mts --project database-free tests/frontend/frontend-pilot-editor.spec.ts tests/frontend/frontend-pilot.spec.ts`: two files, 114 tests passed. Four initial storage-loss cases reproduced the defect before correction; ten new cases cover getter/read/set/remove failures, persistent EN/DE notice, failed/successful local Retry without HTTP, healthy rereads/missing keys, removed rows, list/remount/unmount/detached callbacks, actor retirement and retained authorized 503 behavior. |
| Complete frontend engineering scope | `node scripts/check-development-policy.mjs --all` with explicit repeated `--file` arguments for all 54 authored frontend executable files and `--json`: 54 readability files, 204 nontrivial operations, zero findings; separately changed index findings zero. Declaration/DBAL checks cover the 288-file authored executable inventory and all 11 authored DBAL services. Independent review accepts the actual new source/test behavior, and the root reviewer separately accepts the five readability owners. The checker covers the complete authored frontend; semantic acceptance covers the changed owners, not whole-checkout readability certification. |
| Normal production build | `npm run build` passed generation, server, frontend, client/SSR, native assets and copy scopes after the final guards. Existing Sass deprecation and ineffective dynamic-import warnings remain. This does not certify hosted CI, an operator rehearsal or a new visual matrix. |
| Vue-aware test compilation | `.\node_modules\.bin\vue-tsc.cmd --project tsconfig.test.json --noEmit` passed after correcting one test mock's explicit signature. The final two-file/114-test focused command also passed after that type-only correction. Scope is the test-import graph and reached production/SFC declarations; unimported native browser/editor sources and their inherited nullable-date diagnostics remain outside this claim. |
| Native preservation and independent review | Against hashes for 617 tracked files captured at this implementation turn's start, only 21 owned source/documentation/test files changed; protected native, controller, middleware, DBAL and root Help paths have zero changes. The additional checklist receipt is a `.d.ts` contract. Independent source review accepts final local guards, warning lifetime and absence of HTTP/server replay. This preserves the existing dirty-worktree baseline and does not renew historical immutable-reference, browser or visual evidence. |
| Advisory documentation report | `npm run docs:check:strict` inspected 87 Markdown files and 1,465 links: zero broken-link, metadata, classification, missing-command/path or stale-term findings. The one historical source-fingerprint mismatch remains advisory, with its baseline preserved. Help authoring inspected 32 Markdown files, 585 links and nine images, including all 32 raw-HTML checks, with zero warnings/errors. These structural/authoring receipts do not establish fresh pixel inspection, browser behavior or release packaging. |
