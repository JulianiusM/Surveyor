# Frontend pilot parity review
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-13
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: prior scoped receipts retained; explicit whole-article Help and general-defect deferral decisions reconciled; JavaScript-only rendering conflict isolated; new correction evidence recorded separately
source-anchors: src/controller/packingController.ts; src/controller/entityAdminController.ts; src/controller/eventController.ts; src/controller/userController.ts; src/modules/database/services/PackingService.ts; src/modules/database/services/EntityLifecycleService.ts; src/modules/database/services/UserService.ts; src/modules/lib/fileCommons.ts; src/modules/overview/api.ts; src/routes/api/v1/overview.ts; src/controller/helpController.ts; src/frontend/; contracts/api/v1/; src/locales/; scripts/generate-locales.mjs; scripts/watch-frontend-inputs.mjs; tests/unit/frontend-generation.spec.ts; tests/frontend/frontend-page-entry.spec.ts; tests/frontend/frontend-command-recovery.spec.ts; tests/frontend/frontend-pilot-identity.spec.ts; tests/frontend/browser/; tests/integration/authentication-workflows.spec.ts; tests/integration/packing-coexistence.spec.ts; tests/integration/packing-management-api.spec.ts; tests/integration/entity-archival.spec.ts; tests/e2e/frontend-pilot-api.spec.ts; tests/e2e/frontend-identity-api.spec.ts; .gitignore; docs/frontend-migration/FRONTEND_PILOT.md; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md; docs/frontend-migration/staged/; docs/backlog/documentation-remediation.yml
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

The subsequently approved startup, header-input and readability/guidance correction is recorded separately below.
Its earlier review identified the startup consequences directly; the maintainer then explicitly approved the full plan
and startup recovery. Prior passing receipts do not certify those changed inputs. Current startup browser/owner
assertions and independent review close `IMP-045`; mounted header assertions and review close `IMP-046`.

The current review found silent loss of temporary Packed selections during storage failure, seven comment/readability
findings in the full frontend scope, an obsolete native-illustration freeze statement and incorrectly broad
baseline identifiers. The maintainer explicitly authorized their implementation and the bounded Packed fallback,
requiring problems to remain visible. The [single dated amendment](FRONTEND_FOUNDATION_DESIGN.md#authorized-temporary-packed-state-fallback-2026-10-13)
retains native keys and behavior; current evidence is separate from the earlier broad receipts below.

## Implemented disposition (2026-10-13)

| Reviewed issue | Applied correction and boundary |
|---|---|
| Packed storage failures silently reset selected checks during membership/order refresh | Existing Packed owners return storage availability and persistence outcomes. The mounted actor/list retains failed-read values and per-row failed writes; healthy unrelated keys and missing-key false retain their native reread meaning. Persistent EN/DE status explains load/save failure and possible loss of unsaved changes on leave/reload/account/profile change. Explicit Retry writes only outstanding live local selections and rereads, with no HTTP command or automatic replay. Captured actor/admitted list/rendered-row guards reject retired callbacks; denial, context/list change, removed rows and unmount retire fallback. Previously stored or successfully written values are not incorrectly classified as unpersisted. The focused mounted cases close `IMP-043`; native source and persisted keys remain unchanged. |
| Full frontend review exceeded the earlier 25-file readability receipt | Seven comment/readability findings were corrected in existing owners, including substantive lifecycle explanations and lower-risk callback consistency. Complete frontend checks and independent semantic review complement declaration/DBAL inventory checks; the superseded narrower receipt remains in Git history. No numeric style exception, blanket formatter or scope exclusion is added. |
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
| Help source and future-language fallback | One canonical `docs/user-guide/` root contains native English plus adjacent `en/`, `de/` and approved catalog directories. The unauthorized separate pilot root is retired. The explicit Oct13 Req. 2B amendment requires complete article fallback: missing locale/topic/required figure selects reviewed English Markdown with its own assets, never translated text with English images. Local authored references stay in their own language; direct asset requests never independently fall back. Visible notice, English result markers and actual content language remain. Unsafe/unreadable/escaped existing sources fail through their established boundaries. Staging is never application input. |
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
| Original vision and completeness | Help/Packing and required entry foundation are the bounded obligation. Completed corrections have scoped evidence below; the JavaScript-only delivery conflict remains open. Canonical Help and whole-article fallback decisions are resolved. General reset/provider/activation defects IMP-051/056/057 are separately deferred and do not block migration acceptance. Other migrations/default-route cutover remain future scope. |
| Original design and authorization | Selected stack preserved; original choices and dated amendments remain visible. Unapproved runtime consequences remain unapplied. |
| Modularity, DRY and single source of truth | Existing controllers own shared operations/policy; adapters own protocols; pure DBAL owns persistence/locks. Actual consumers adopt shared grants, query admission and settings composites. Generated contracts/catalogs and admitted query projections remain authoritative. |
| Comments, readability and formatting | Named operations/presentation helpers, purposeful transaction/command/template comments and logical boundaries; no blanket refactor or new forwarding modules. |
| Core coding principles | Shared type-only contracts are `.d.ts`; renderer data is explicit; business checks/contextual errors remain outside DBAL. |
| Technical debt | Duplicate ownership/validation/staging defects, read-admission/aggregate leaks and generated-source collision corrected. Scoped pilot finality corrections pass; general native mixed-token/provider defects remain backlog scope. The remaining signup-document disposition depends on explicit resolution of the delivery-design conflict. Future permission review retains its existing owner. |
| Repository/documentation cleanliness | Current evidence replaces repeated run histories; durable contracts, IDs, classifications and original decision rationale remain. No speculative deletion, new document destination, rule exception or fingerprint rebaseline is introduced. Native content remains the reference. |
| Consistent implementation guideline | One staged Development playbook plus baseline-to-owner/assertion map covers policy, transport, drafts, privacy, SSR, Help, recovery and cost-based verification. |
| Designed versus implemented architecture | Shared controller/pure-DBAL structure matches the target. Existing context/query owners and presentation composites absorb readiness lessons. Approved coexistence, public-action and same-event adjustments remain explicit dated amendments. |
| Staged consistency | Technical pilot deltas remain staged; original choices are amended explicitly; current execution is owned here once. |

## Prior scoped verification and limits

These distinct receipts belong to earlier corrections and retain their original inputs, scopes and limits. Latest
same-boundary build, compiler, quick-suite, engineering and documentation results appear below; superseded repeated
receipts remain in Git history. A later build or mounted test cannot renew persistence, HMR, deployment or visual proof.

| Check | Retained receipt and scope |
|---|---|
| Focused real Packing persistence | Earlier guarded selection: five files, 74 tests passed, including real emitted comparison tokens, native/v1 same-event no-ops, public grants, protected reads, minimal baselines and coexistence schedules. Effective dedicated port/schema credentials were checked before that database run. This is the affected Packing boundary, not a complete integration-suite run. |
| Native/v1 coordination | Retained production-controller schedules exercise both execution orders, parallel different-item assignments, deletion races and preserved removals/overwrite within that guarded selection. No unrelated writer schedule is certified. |
| Built browser/HTTP selection | Earlier guarded built selection: four suites, 60 tests passed, one existing disabled-authentication-configuration case skipped. Includes actual native/v1 no-op HTTP, native Pug factory flows and pilot settings/image/locale/Help SSR behavior. That configuration did not run in this earlier receipt; its later executed coverage appears below. This selection is not the full browser suite or visual matrix. |
| Integrated source development | Three earlier source-mode journeys passed: executable source assets/locale navigation, pre-hydration Overview search and mounted Packing controls/real commands without document replacement. Their later integration-layer relocation is not another execution. Dynamic authored-input/HMR verification remains separate. |
| Authored-input regeneration/HMR | Four earlier checks passed: actual CSS HMR and restoration preserve document/focused control/draft; authored contract/catalog regeneration reaches its ready marker before Express restart and updates the mounted label. All three probed authored files were restored byte-for-byte and generated API/catalog values restored. Source-mode journeys alone are not this evidence; the latest registry/publication fixture has its own row below. |
| Installed-folder recovery | Four actual behavior assertions verified in the guarded installed copy: replacement removes old assets and changes build ID while API compatibility stays equal; a clean tab reloads its document exactly once and focus does not reload again; an actual removed old chunk returns 404 while a dirty tab retains its document/draft; an older compatible client completes one real persisted 201 command. Core proof is retained separately from the combined helper's later capture-fixture failure and the successful corrected capture invocation; no whole-helper or operator-rehearsal pass is inferred. |
| Selected paired captures and inspection | Separate corrected invocation passed 20 settled native/pilot desktop/mobile captures using equal fixture/actor/viewport scenes. Actual inspection accepts event controls/options, header/action panel geometry, detail columns/Quick Add and Help columns/figures at the selected sizes. Established pilot locale/manual-refresh controls and the native one-time-flash vertical offset remain explicit differences. All four Help scenes have complete article images. This is source-scoped visual acceptance, not exact-pixel, whole-prose or full-application-matrix certification. |
| Native reference and structural scans | That earlier task's tracked native layout/browser/view and DBAL paths had no diff against its starting HEAD. Original 133-file immutable-reference comparison retains the previously approved exceptions. These receipts do not certify later shared-controller/DBAL changes; current preservation has its own scope below. |
| Independent source review | Separate review accepts shared grant adoption, controller/DBAL boundaries, bounded comparison validation, exact generator cleanup, key-bound actual-observer dependency reads and native preservation. Root independently accepts the concrete documentation diff and inspected selected visual scenes; executed receipts retain their distinct scopes. |

Native nullable-date diagnostics and previously observed narrow creation/Help layout limits remain inherited. No native
UI/compiler repair is authorized by this correction. Local checks do not certify hosted CI, live OIDC/mail, a new full
visual matrix, production cutover or operator rehearsal. Documentation reports remain advisory
and never become application, CI, release or deployment gates.

## Retained Packed and readability evidence (2026-10-13)

The unique storage-loss reproduction, corrected production-consumer assertions and preservation review retain their
scope. Their superseded quick/build/compiler/engineering/report receipts belong to Git history; current execution is
recorded separately. These assertions are mounted evidence, not browser, persistence, HMR, deployment or pixel proof.

| Executed check | Retained receipt and scope |
|---|---|
| Focused mounted production consumers | `node node_modules/vitest/vitest.mjs run --config vitest.config.mts --project database-free tests/frontend/frontend-pilot-editor.spec.ts tests/frontend/frontend-pilot.spec.ts`: two files, 114 tests passed. Four initial storage-loss cases reproduced the defect before correction; ten new cases cover getter/read/set/remove failures, persistent EN/DE notice, failed/successful local Retry without HTTP, healthy rereads/missing keys, removed rows, list/remount/unmount/detached callbacks, actor retirement and retained authorized 503 behavior. |
| Native preservation and independent review | Against hashes for 617 tracked files captured at this implementation turn's start, only 21 owned source/documentation/test files changed; protected native, controller, middleware, DBAL and root Help paths have zero changes. The additional checklist receipt is a `.d.ts` contract. Independent source review accepts final local guards, warning lifetime and absence of HTTP/server replay. This preserves the existing dirty-worktree baseline and does not renew historical immutable-reference, browser or visual evidence. |

## Retained command admission evidence (2026-10-13)

The maintainer's conditional approval was fulfilled by a production-consumer/history audit and reproduced stale
submission, rather than inferred from an absent guard alone. A retained callback could start a write after its form
unmounted and create an invisible unknown-outcome lease. Only new `useCommand.run` admission now checks `mounted`;
the already admitted operation/completion body remains unchanged. `IMP-044` records the bounded correction once.
The Foundation amendment and staged Development guidance retain legitimate deferred work and original completion
guarantees. The preceding Packed/readability receipts keep their original scope. This correction does not renew
build, browser, database, HMR, installed-folder or visual evidence.

| Executed check | Result and scope |
|---|---|
| Conditional approval and production/history review | Root and independent frontend review inspected 27 production calls across eight owners; none supports first calling `run` after its owner unmounts. Native guest submission reacquires the current form and returns when absent; closing the pilot guest chooser leaves its command parent mounted. Original design protects already admitted commands, and the Oct11 status-retention correction protects their pending/unknown lifetime. The reason the original `run` lacked its mount guard is undocumented; no deliberate post-retirement first-dispatch exception was found. |
| Baseline reproduction and preservation controls | The corrected four-case baseline selection reproduced two failures: a newly invoked command from a retired owner and the actual retired guest continuation. Two controls passed: delayed advisory completion while its form remains live and an operation admitted before retirement whose request is deliberately deferred. This distinguishes the defect from supported late work. |
| Focused mounted production consumers | `node node_modules/vitest/vitest.mjs run --config vitest.config.mts --project database-free tests/frontend/frontend-page-entry.spec.ts tests/frontend/frontend-command-recovery.spec.ts tests/frontend/frontend-pilot-identity.spec.ts`: three files, 136 tests passed after the entry guard. Covers retired new submissions and the real guest continuation, live delayed admission, already admitted deferred requests, retained settlement/follow-up/recovery/unknown protection, confirmed navigation and identity behavior. This is mounted database-free evidence, not a real-browser or persistence run. |
| Protected boundaries and register | Diff inspection against the starting HEAD found no changes to native browser/views, controllers, routes, middleware, DBAL, root/localized Help, authored contracts or package files. The existing backlog parses as valid YAML and has one closed `IMP-044` disposition. `git diff --check` passed; no new documentation destination, removal or baseline redefinition was introduced. |

## Startup and migration readiness correction (2026-10-13)

The maintainer's explicit instruction to implement the reviewed full plan and approved startup recovery is retained in
the [single dated amendment](FRONTEND_FOUNDATION_DESIGN.md#authorized-startup-recovery-clarification-2026-10-13).
The following dispositions concern this correction only; earlier execution above retains its original scope.

| Reviewed issue | Approved correction and verification boundary |
|---|---|
| Initial route failure loses SSR drafts or repeats reloads without attempt storage | The review reproduced both original failure boundaries. Existing startup/mount/update owners now protect edited SSR controls before route loading and until restoration finishes. Automatic reload requires demonstrably clean state and working loop protection; localized deliberate recovery remains reachable without usable storage or after an automatic marker. Deliberate recovery retains edited-control consent and pending/unknown command guards. No secrets/files are persisted and no command is replayed. The current real-browser entry/owner checks and independent review close high-severity `IMP-045` within the scope below. |
| Confirmed header upload releases the draft but leaves the native chooser selected | The existing declaration contract supplies the feature-owned `selectedFile` to `EntityHeaderEditor`. Confirmed upload, including saved-plus-failed-refresh, releases that file and clears the same native input. Rejected/unknown delivery and background reads retain it. The current mounted checks and independent review close `IMP-046`; no real-browser chooser or persistence result is inferred. |
| Production comment/readability coverage and stale explanation | Nontrivial operation comments explain the real admission, projection, transaction and recovery steps. Metadata field guidance clarifies that locale changes retain language-independent projections and current field authority. The complete owned readability scope and independent semantic review remain separate from syntax success. |
| Approval explanations were not consistently presented in the required format | The central Development Policy now requires its exact four labels/order, specific decision, approval rule/source link and direct question. Delegation passes that format and authorization; root review precedes a delegated user request. AGENTS/Copilot and the staged playbook route to the one policy owner without another rule set or delivery gate. |
| Documentation routing and original-history clarity | The index routes to DEC-006, current Pilot/review and the single contribution recipe. Original D2/D5 rationale remains explicit; the identity-gap section distinguishes its historical inventory from current assertions. No documentation destination, removal, cutover or fingerprint change is introduced. |

## Current follow-up verification (2026-10-13)

The maintainer's explicit requirements retain strict built-system E2E, consistent component value lifetimes,
serialized permission-registry generation and final commits. The table below owns the final executed scopes for these
corrections. Distinct older persistence, HMR, installed-folder, visual and discovery evidence above keeps its original
inputs and limits; passing one boundary cannot certify another.

Local receipts use Node 24.13.0, npm 11.6.2 and the freshly owned MariaDB 10.11.14 schemas. CI specifies Node 24.15.0;
these checks do not claim an identical full CI environment or a hosted CI run.

| Reviewed issue | Final disposition and boundary |
|---|---|
| Isolated browser and source-server tests were classified as E2E | Thirteen isolated client cases use the frontend browser runner without an app server or database. Three source-development journeys retain their assertions under integration/browser and their opt-in prepared source-server runner; relocation is not another source-mode execution. E2E retains the real built application and fully prepared database. |
| Warm creation/duplicate navigation retained released file bytes | The shared null-release owner is adopted by creation and header editors. Warm/cold accepted departure releases draft/native selection; canceled departure, background reads and fragment movement retain the live File/node/text. Mounted assertions and independent review close IMP-047; no OS chooser behavior is inferred. |
| Guest creation preceded stored identity or final response preparation | Existing controller/DBAL owners commit Guest/profile, stored identity and validated serialized completion together. Real ORM, concurrent built HTTP row/link restoration, document 303/actor-global first-GET flash and client retirement assertions pass; independent review closes IMP-048 within this pilot operation. |
| Account or ordinary identity writes preceded completion preparation | API signup prepares account/profile/token/mail/transport outcome, preserves the actor and reveals no activation token. Existing identity completion distinguishes failed mail and releases credentials without replay. Activation, login, private guest-link login and profile switching share locked preparation; native inactive-login resend remains intentional. Completed scoped evidence does not resolve the signup-document or shared native token decisions. |
| Token-free explicit pilot logout saved authority before preparing completion | Existing `logoutUserWithSession` now prepares its anonymous API receipt or document success notice/303 before the stored transition commits. Absence of any truthy tokens object selects this path and is rechecked on locked staging; empty objects retain the provider workflow. Actual ORM, built API/document journeys, final source/build checks and independent review close scoped IMP-055. Native/provider ordering remains unchanged. |
| Pilot password reset and reset-mail had fallible preparation after writes | Cooperating pilot resets prepare API/full SSR before password/token commit and retain the document 200/submitted URL. Reset-mail prepares private link/templates/cached sender/output/optional flash before commit and settles captured delivery afterward, preserving generic known/unknown confirmation. ORM/SSR/system and independent review close pilot reset-mail IMP-052. IMP-051 remains open for native mixed-writer finality. |
| Relink/archive/restore and visibility relied on postcommit projections | Existing typed completion callbacks prepare resulting relink admission and visibility projection on the locked manager. Packing archive/restore skip their unused later archive DTO. Native omitted-completion defaults remain intact. Real rollback/receipt/system assertions and independent source reviews close scoped IMP-053/054. |
| Permission saves bypassed generation or published readiness during a newer save | Exact registry observation, API→locale serialization and process-owned staged readiness use a final queued/stopping check followed by synchronous rename. The held-write reproduction failed before correction and now passes without stale/temp markers. Independent review accepts the normal restart exclusion and closes IMP-049. |

| Executed check | Final result and scope |
|---|---|
| Normal production build | `npm run build` passed after all settled source, including ordinary token-free logout: native/server/client/SSR generation and compilation; 54 operations, 106 schemas, API hash `b27540d1769e`; two locales, 469 messages, catalog hash `bba8551f786d`. Existing Sass/dynamic-import warnings remain. Build success does not certify browser, persistence, deployment or visual behavior. |
| Client browser | Maintained `playwright.frontend.config.ts`: both isolated client files, 13 passed, zero skipped, 13.610 seconds. Actual built startup/SSR/manifest assets and native invoice seam assertions keep their client boundary. No app server, database, temporary runner override or live session result is inferred. |
| Database-free quick selection | `npm run test:quick --ignore-scripts`: 61 files, 1,374 tests passed in 105.84 seconds, using current generated inputs; only redundant generation was omitted. Includes mounted consumers/client helpers and all six watcher regressions. This preceded later backend-only refinements; the current real ORM/system selections cover those changed boundaries. Quick success alone does not certify backend finality. |
| Focused mounted consumers | Four files, 173 passed, including failed-mail signup completion, stale-form refusal, clean reused fields and actual creation/header file lifetimes. These consumer assertions are also covered by the quick selection. No live SMTP, persistence or OS chooser result is inferred. |
| Authentication persistence | `tests/integration/authentication-workflows.spec.ts`: 61 passed in 14.79 seconds under normal Vitest and the unchanged 30-second hook on a fresh, exactly owned strict MariaDB 10.11.14 target. Actual ORM/controller/SSR/cached-sender cases cover Guest/Profile/Session, account/token, activation, ordinary identity, pilot reset/recovery and all eight token-free logout cases, including preparation rollback, later actors and fresh truthy-token refusal. Only external delivery is replaced. Independent nonauthor review accepts the pilot scope; native mixed-writer and provider conditions remain unresolved. |
| Packing, coexistence and archival persistence | `packing-management-api.spec.ts`, `packing-coexistence.spec.ts` and `entity-archival.spec.ts`: 61 passed in 35.59 seconds under normal Vitest on the owned MariaDB 10.11.14 target before the isolated logout addition; these domain owners are unchanged. Covers duplicate/reorder item-only snapshots, minimal grants/privacy, native ordering/lock schedules and new lifecycle/visibility projection/generated-result rollback and native/v1 receipts. Together with renewed authentication, four files and 122 selected tests pass; this is not complete integration or every writer schedule. |
| Built-system workflows | Three actual built pilot system files ran against normal managed `dist/server.js` and fully synchronized/seeded, task-owned MariaDB 10.11.14: 56 passed, one existing disabled-auth configuration case skipped, zero failed/errors in 138.195 seconds. That exact case then passed against the current build with local-login/OIDC disabled in 30.066 seconds, zero skips/failures/errors. All 57 distinct selected cases pass across these two proper configurations; the skip is configuration coverage, not a provider skip. Includes actual ordinary API logout and JavaScript-disabled document logout/locale 303 plus identity, Packing and visibility journeys. This is not the complete application E2E suite, live provider or live SMTP verification. |
| Serialized generation | `tests/unit/frontend-generation.spec.ts`: six passed in 78.73 seconds. Detached actual watcher/generators hold the real readiness write and observe a newer registry callback before release, proving no stale/temp marker; output/hash readiness, invalid-save preservation and recovery also pass. Root independently accepts publication, cleanup and generator compatibility. No maintained input, app server or DB mutation occurs in that tooling fixture. |
| Source readability and compilers | `npm run check:development` received 72 explicit paths: all 55 authored frontend files and 17 changed nonfrontend owners. The renewed logout JSON report records 41 checked sources, 31 touched readability files, 97 nontrivial operations, all 11 global DBAL services and zero errors; changed-index inspection is clean. Earlier unchanged frontend `--all` scope covers 55 files/208 operations. Current server and Vue-aware test compilers pass. Non-src scripts/tests receive manual review; scanner success alone does not prove meaningful comments, DRY or approval. |
| Policy tooling | `npm run test:development-policy`: 17 passed in 149.278 seconds, including real synthetic staged-concealment, Vue, Unicode and declaration/DBAL fixtures. This protects checker behavior; it is not production, comment-quality or approval certification. |
| Preservation and independent review | Against the 684 tracked-file starting snapshot: 61 changed tracked files and two expected moved-test source deletions; protected `src/public/`, `src/views/` and `docs/user-guide/` have zero changes. Shared controller/DBAL changes retain native defaults and scoped approved behavior. Root accepts Packing completion; independent nonauthors accept final visibility and identity/reset/mail adoption. No new documentation destination, plan deletion or fingerprint rebaseline occurs. |
| Whitespace and verification cleanup | Source and owned documentation whitespace checks passed. Root verified both exact task-owned disposable container identities/names/labels before removal, removed only their resolved ignored verification environment files, and confirmed no verification server listener remained on port 3001. Existing schemas/containers and local artifacts are preserved. This cleanup does not claim removal of unrelated resources. |
| Advisory documentation | `npm run docs:check:strict`: 87 Markdown files, 1,499 links; structure status `findings` with exactly one preserved historical `source-baseline-mismatch` and no tool error. Zero broken-link, metadata, classification, missing-script/path or stale-term findings. Strict Help and standalone `npm run docs:check:help` are clean: 32 Markdown files, 585 links, nine images, zero warnings/errors. The historical baseline remains unchanged and advisory; these results do not certify new prose/pixels, runtime behavior, persistence or deployment. |

The subsequent direct decisions confirm canonical `docs/user-guide/` and require same-language complete-article
fallback. Req. 7–9 defer provider logout preparation failure (`IMP-056`), mixed native/pilot reset (`IMP-051`) and mixed
activation acknowledgement (`IMP-057`) as general behavioral defects. Their remedies remain unapplied and require a
separately authorized effort; they are not frontend migration blockers. Earlier bounded finality approvals are retained.
Provider logout currently clears local identity before obtaining the external destination, so discovery failure can
leave local logout committed without confirmed completion; no provider was contacted to reproduce this condition.

Req. 6 now calls for JavaScript-only skeleton delivery. It conflicts with the recorded same-component server-rendering
and readable no-JavaScript Help design, so a separate direct conflict resolution is pending before rendering or
ordinary-form handlers change. This replaces the subject of the earlier signup-document wording question; no new
confirmation text or signup-document adoption has been implemented. `IMP-050` remains unchanged pending that resolution.

### Current Help and deferral evidence (2026-10-13)

The preceding build/browser/database receipts apply to their recorded earlier inputs; they do not certify this Help
correction or the pending JavaScript-only delivery change. Req. 2A/2B is implemented in the existing Help owner and
localized asset adapter. Regional authored hints reuse the existing localization matcher with an optional supported
result, preserving same-corpus hints without accepting unsupported input through its English default. No new controller,
service, language registry or runtime documentation destination is introduced.

| Executed check | Current source scope and result |
|---|---|
| Isolated application logic | The two synthetic Help files and existing frontend-localization unit file: three files, 65 tests passed in 1.88 seconds. Tests cover whole-article selection with different image names, matching title/TOC/navigation/search, exact-language direct assets, unsafe/malformed/unreadable source and same-corpus regional hints. No maintained prose or database fixture is used. |
| Compilers | Server TypeScript and Vue-aware test noEmit checks pass on the settled Help/localization source. No current production build, browser, E2E or database run is claimed by this correction. |
| Engineering and whitespace | `npm run check:development` explicitly covers `src/controller/helpController.ts`, `src/routes/frontendPilot.ts` and `src/modules/localization/translator.ts`: three readability files, 22 nontrivial operations, 43 checked sources, all 11 DBAL services and zero findings; changed-index scope is empty. Full `git diff --check` passes, with existing CRLF conversion notices only. Non-src checker/test changes receive separate semantic review. |
| Advisory report tooling | `node --test scripts/tests/documentation-check.test.mjs`: 42 tests passed in 12.311 seconds, including same-corpus hints, foreign index/search queries, full-size cross-corpus traversal, whole-article missing-asset warnings and independent English reference counts. This protects the advisory checker, not an application or E2E boundary. |
| Preservation and independent review | The 688 authored-file starting snapshot distinguishes this task from the inherited dirty tree: 19 task-changed files, no missing files or protected-source changes. Native `src/public/`, `src/views/` and `docs/user-guide/` content and shared identity/DBAL/provider implementations remain unchanged. Independent nonauthors accept whole-article selection, actual asset-route adoption, shared locale matching, backlog scope and amended documentation. JS6A remains pending; server rendering and ordinary form handlers have not changed. |
| Advisory documentation | Renewed `npm run docs:check:strict` JSON reports 87 Markdown files, 1,504 internal links and only the preserved historical `source-baseline-mismatch`; zero broken-link, metadata, classification, script/path or stale-term findings. Help is clean: 32 Markdown files, 585 links and nine images, with zero errors/warnings. No baseline is replaced, no report is promoted to a delivery gate, and no new prose/pixel or deployed behavior claim follows from this structural result. |

Pilot token locks cover cooperating pilot consumers. Independent source scheduling identifies native reset reading T,
pilot committing its password and clearing T, then the native bcrypt continuation overwriting by username. Native
activation's earlier T read and ID-only update can acknowledge consumed/reissued T: final activation is idempotent,
but that acknowledgement is not single-use proof. No mixed native/pilot database schedule was reproduced; neither
shared conditional-write remedy is authorized by the migration or inferred from earlier approvals.

Earlier local verification refused password-reset fixture mutations because credentials also held an unknown
`cgd_test` grant. Those workflows remain in source and pass on the properly owned restricted target; the fixture guard
still allows only exact explicitly configured dedicated scopes. Earlier MariaDB 10.4 diagnosis measured a 292 ms
connection and 103,408 ms schema preparation; current supported-version runs need no timeout override or reset of those
old local schemas. Generated-output hygiene now ignores `/artifacts/`; no tracked maintained material was there and no
local artifact was removed.

The remaining-v1 source census covers session, locale, Help and Overview reads plus the corrected visibility command.
Session initialization/invalid-authority cleanup are explicit request infrastructure; locale persists only a cookie,
Help reads release-controlled files and Overview uses SELECT snapshots. No further concrete persistence-then-required-
projection defect was found in those routes. Static typed delivery was distinguished from real DB/context/file work;
this manual census is not a universal transport guarantee.

Full migration/cutover, live provider/SMTP, renewed source-development/HMR, hosted CI, deployment rehearsal and a new
visual matrix remain unverified by these current receipts. Their distinct older evidence is retained above.

Startup protection is bounded to route/validator failure before mounting and normal restoration handoff; it does not
promise restoration after an arbitrary mount exception has already changed controls. Native UI/Help, shared business
behavior, original IDs, existing dirty changes and all prior amendments remain protected.
