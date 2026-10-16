# Frontend pilot parity review
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-16
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: current P0-P2 ordinary SPA correction closed with reviewed consumer adoption and scoped build/compiler/client/ORM/built-application/visual evidence; failed broad run and focused reruns distinguished; E1 exclusion retained; no full-application or cutover acceptance
source-anchors: docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md; docs/frontend-migration/FRONTEND_FULL_IMPLEMENTATION_PLAN.md; docs/frontend-migration/TEST_COVERAGE.md; docs/frontend-migration/staged/; docs/backlog/documentation-remediation.yml; src/controller/; src/modules/database/services/; src/modules/api/; src/modules/lib/session.ts; src/modules/lib/frontendSession.ts; src/frontend/; contracts/api/v1/; src/locales/; scripts/generate-api.mjs; scripts/generate-locales.mjs; scripts/watch-frontend-inputs.mjs; tests/frontend/; tests/integration/; tests/e2e/; vitest.config.mts; playwright.config.ts
next-review: authorized-pilot-correction-verification-or-next-migration-slice
-->

The native design comparator is `2dfa2573c64178f54684cc4877b5a945f66e24c8`; the application-source baseline used in the
session/full-pilot review is `7ff78998667e55df56390a8e8da88e8ace687771`. Neither identifies a deployed site's version.
The [foundation ledger](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments) owns original choices
and dated amendments. This record owns current findings, latest relevant evidence and concise historical dispositions.
Superseded run counts, repeated failures, file inventories and capture transcripts remain in Git and ignored artifacts.
There is no second maintained archive or approval request in this record.

## Current acceptance and correction boundary (2026-10-16)

P0–P2 provide the opt-in Help/Packing, identity/profile, Overview/common presentation and Event implementation.
The whole-application vision remains the [existing phase contracts](FRONTEND_FULL_IMPLEMENTATION_PLAN.md), including
native finance/unmigrated child destinations and separate default-route, publication and retirement decisions.
No task-owned P2 feature may be reclassified as future work to avoid its acceptance criteria.
The maintainer's direct [S1 resolution](FRONTEND_FOUNDATION_DESIGN.md#authorized-implemented-pilot-scope-2026-10-16)
limits this delivery through implemented P2. Later phases begin only after stable repeated reviews of that slice and
an explicit future maintainer trigger; their scope is no longer an unanswered question or implicit continuation.

The latest review completes the authorized ordinary SPA correction with scoped P0–P2 evidence and the limits below.
It does not certify every application state or authorize another phase. The maintainer's
[direct E1/D1 reply](FRONTEND_FOUNDATION_DESIGN.md#direct-production-coexistence-exclusion-and-spa-correction-2026-10-16)
resolves the earlier unanswered decisions:

- `IMP-066` closes by explicit production-scope exclusion. The source review found native Event permission
  writers bypassing the Event lock and a possible intervening write lost without 412. No controlled database
  reproduction ran and no repair is claimed. Native and Vue never coexist in production; the maintainer directs
  no Event coordination fix. The temporary development comparator and approved Packing remedy remain.
- `DESIGN-EVENT-CREATION-TRANSPORT` closes for the implemented current-phase correction. The maintainer rejects
  retaining Event creation/duplication document POST and requests the original ordinary-JavaScript JSON/multipart
  commands and client navigation across equivalent implemented P0–P2 forms/links. Earlier code, prose and passing
  tests supply no retrospective exception approval. The existing [six-step plan](FRONTEND_FULL_IMPLEMENTATION_PLAN.md#current-spa-correction-plan-2026-10-16)
  covers generated adapters, shared Vue consumers, lifecycle/privacy, removal of displaced document-only owners
  and renewed same-document built-application checks. Source adoption and configured workflow evidence are now
  reviewed. The failed broad run and focused positive receipts remain distinct below; closure supplies no blanket
  future exception or stronger backend guarantee. General partial-backend repairs remain excluded.

The pre-D1 independent review read all 92 frontend source/style files and 11 related authored declarations, traced the shared
native/versioned backend owners and checked the original choices and all eight staged guide outputs. Matching Vue
consumers adopt the shared owners below. Safe cleanup corrected stale Overview/dropdown comments, explained the meal
selection transform and removed two unused client `createContext` wrappers/imports. Actual creation uses `createEntry`;
server routes, authored schemas, generated contracts, native frontend sources and runtime behavior remain intact.
The refresh reference now names implemented P2 Event dynamic routes under the already approved subsequent-route
provision. That cleanup supplies neither transport correction nor Event coordination repair; the later direct
decisions above now govern their distinct dispositions.

The full review preceding these corrections withheld full acceptance: a real Event metadata comparison displayed disabled settings as
absent; profile visual tests recorded footer measurements/browser errors without asserting them; a capacity test
assumed an unstated SQL rejection; and this review retained excessive superseded execution history. The maintainer
directly authorized the correction/readiness plan. The findings retain one defect/status owner in the
[central backlog](../backlog/documentation-remediation.yml); source changes and finite passing checks alone do not
establish full visual/behavioral parity.

`IMP-065` owns scalar comparison, `TEST-FRONTEND-PARITY-ASSERTIONS` owns meaningful measured assertions, and
`TEST-FRONTEND-SQL-MODE` owns supported normal-setup/strict-mode verification. `DOC-FRONTEND-REVIEW-HISTORY` records
this consolidation's completed independent/root semantic preservation review. Runtime/test closure requires the
actual relevant execution; documentation cleanup supplies no substitute acceptance.
The fixture-matcher part of `TEST-DATABASE-GRANT-PATTERN` is resolved by the
[conditional C1 review/removal](FRONTEND_FOUNDATION_DESIGN.md#conditional-fixture-check-usefulness-review-and-removal-2026-10-16).
The earlier claim that repairing this automatic check was a mandatory application-parity blocker is withdrawn.
The same backlog owner keeps unchanged inherited CI provisioning separate; no new P2 blocker or grant-repair
approval follows from the removal.

The direct **R1 reply in that review** retains native isolation. The
[October 16 clarification](FRONTEND_FOUNDATION_DESIGN.md#direct-native-isolation-clarification-2026-10-16) distinguishes
separately mutable Vue copies from shared Vue components. Matching Vue consumers share one presentation/logic owner;
native presentation/frontend code remains the unchanged comparator. Backend/domain/controller/DBAL/catalog owners
remain shared. Earlier same-name R1 answers for reload policy or session architecture are separate decisions.

| Acceptance responsibility | Source-reviewed disposition |
|---|---|
| Original vision and design | Selected Vue/TypeScript, Vite, Router, Query, Reka, i18next-vue, OpenAPI and standalone-validator choices remain adopted. Original alternatives, rejected interpretations and dated amendments remain visible in their owners. D1 rejects the Event document-creation exception; its current ordinary SPA correction has reviewed source adoption and scoped verification. The full application and cutover are not complete. |
| Shared frontend implementation | Event/Packing adopt `EntityEntryPage`, `identity/GuestEntryPage`, `EntityHeader`, settings, metadata and access owners. Their two creation pages now adopt `useCreationCommand` in `composables/creation.ts`; Settings, Overview and Event children adopt the three-consumer `useEntityRemoval` in `composables/entityLifecycle.ts`. Matching archive/pause consumers retain their existing lifecycle owner. Feature drafts, grants and distinct semantics stay feature-owned. A helper's existence without actual consumer adoption is insufficient. |
| Shared backend and information hiding | Existing controllers own authorization/business decisions and contextual errors; DBAL owns queries, locks, transactions and persistence. Native/v1 adapters retain protocol differences around those owners. Bounded projections exclude hidden rows, financial aggregates, session internals and storage details. No universal CRUD layer, forwarding controller/service or writable server-data mirror is required. |
| Human maintenance and formatting | Named helpers, purposeful method contracts, separate internal step comments, template lifecycle explanations and logical spacing are required. All shared `src/types/` contracts remain `.d.ts`. Whole-frontend structural checks supplement independent semantic review; neither comment counts nor passing syntax certify readability. |
| Architecture versus implementation | Query owns admitted snapshots, feature/shared-interaction drafts own original/local/current values, Router owns URL state, and Express owns the request Session. Shared admission, command, recovery, feedback, navigation, image and presentation owners implement the architecture. Finance/recommendation semantics remain distinct. |
| Documentation and rapid extension | Existing staged Development supplies the single migration playbook, owner contracts and Event/Packing worked composition. Coverage links native behavior IDs to actual assertions. The live baseline, inventories, profile, phase plan and staged fragments remain useful during coexistence; the retirement inventory governs their later disposition. |
| Debt and parity evidence | Inherited/excluded backend defects remain in the central backlog. Scalar-display, measured-assertion and supported-database corrections have the evidence below. E1 excludes production coexistence coordination; the authorized ordinary SPA transport correction remains current P0–P2 work. Finite comparisons do not establish every actor/state/locale/browser or complete accessibility/PDF/race acceptance. |

## Current verification evidence (2026-10-16)

### Ordinary SPA correction: final scoped verification

Frozen source now uses generated Event creation/duplication and scoped child deletion, private profile token/workflow
commands with read-only warm admission, shared creation/removal owners and Router links for admitted migrated
destinations. Displaced document-only Vue adapters and their unused helper are retired. Independent source review
checked actual consumers, original approval provenance and private/confirmed/unknown lifetimes. The new built
profile source includes actual transfer, wrong/successful deactivation, account/guest deletion, warm issuance/history,
retained `performance.timeOrigin` and observation of main-frame navigation requests. Those built workflows passed
in the main selection. Root's native browser/view diff is empty; native UI inputs remain unchanged. Independent
source/plan and visual reviews retain their exact scopes, separately from the executed results below.

| Current correction verification | Actual result and boundary |
|---|---|
| Complete build and test compiler | Root's fresh `npm run build` passed in 123.517 seconds. The final complete test-project `vue-tsc` check passed in 40.991 seconds after the last test-only corrections; the earlier 66.922-second pass retains its original input scope. Runtime, assertions and deadlines were not relaxed to satisfy compiler output. |
| Complete frontend selection | All 45 files/1004 tests passed in one clean run, 105.75 seconds, using one existing worker and unchanged test deadlines. The first broad run retained 1003 passes and one failure when cold native Pug comparison exceeded its existing 5000 ms deadline during concurrent compiler/ORM work. That failure remains in the ignored receipt; it is not counted as a passing run or a deadline amendment. The earlier focused 30/30 profile result remains separately scoped. |
| Selected real ORM coverage | Four files contain 84 distinct cases. The initial run passed 83 and exposed one new Event assertion expecting `true` from a native tinyint field which returns `1`. A test-only correction now checks native `1/0` separately from projected `true/false`; the entire 16-case Event file then passed in 7.92 seconds. The other three unchanged files' 68 cases passed in the initial run, including partial legacy-context and partial-workflow outcomes. This is combined scoped evidence, not a single clean 84-case rerun or stronger backend finality. |
| Engineering and preserved boundary | Root's current development check reports 355 global sources, 11 DBAL files, 39 readability files and 51 nontrivial operations with zero findings. Production freeze and amendment boundary both report zero findings; whitespace check passed. Structural checks supplement semantic review and establish no application result. |
| Main built-application selection | The nine-file/109-case managed run finished with 103 passed, five failed and one appropriate alternate-configuration skip in 10.3 minutes. Four failures were stale fixture expectations/setup: both header widths expected native parent hrefs, Event duplication omitted its Actions tab, and Packing relink expected a native destination. The fifth was the unchanged item-drag case's 60-second timeout. This failed broad run remains a failed run. |
| Corrected built selection | The five affected cases passed in a fresh 1.1-minute run (68.820 seconds including the wrapper). The four fixture corrections retain exact authorized pilot destinations, add actual parent Router navigation/document checks and open the existing tab before duplication. The unchanged drag case passed in 6.9 seconds and settings relink in 6.6 seconds. No application source, assertion meaning or deadline was relaxed. Across these and the main run, 108 distinct normal-configuration cases have positive evidence; this is not one uniform 109-case pass. |
| Unchanged drag repetition | Three further repetitions passed together in 40.0 seconds, with case durations 7.0/4.7/4.0 seconds. They establish those executions, not a diagnosed or repaired cause of the earlier intermittent timeout. The failed broad result remains an evidence limitation. |
| Applicable alternate configuration | The separately configured authentication-disabled case passed in 33.3 seconds (35.037 seconds including the wrapper). It covers the one appropriately skipped normal-run mode; it is a separate configured result, not an additional normal-run case. |
| Current visible parity review | Independent reviewers inspected all 20 profile-workflow originals (ten native/Vue pairs) and 12 Event/German originals. No unexplained difference was found within the captured surfaces, with independently issued token text and approved shell differences identified. Root also inspected desktop-deactivation and mobile-preview pairs. The built source asserts affected form/header geometry, behavior and browser errors; manual inspection remains distinct from executable assertions and does not establish every locale/state/browser or complete accessibility/PDF parity. |

Current logs and independent receipts remain in ignored `artifacts/frontend-spa-20261016/`, including the main,
corrected, drag-repetition and authentication-disabled runs, `profile-e2e-independent-review.json`,
`docs-plan-source-final-review.json`, `profile-captures-visual-review.json` and `visual-review-backend.json`.
No unresolved application finding remains from this reviewed correction scope. The intermittent drag failure and
finite coverage remain explicit limits; the complete assembled-guide review is a separate documentation operation.
These local runs used Node.js 24.13.0, below the documented 24.15.0 prerequisite; no identical hosted-CI environment
is claimed. Root removed the exact task-owned disposable database container after verification; its cleanup receipt
records the captured container identity and task. No deployment or production-data operation follows from these checks.
General excluded backend remedies, true external/provider/output boundaries, later phases and cutover retain their
separate scope. Documentation reports remain advisory and grant no application or publication approval.

### Earlier comparator and correction receipts

The runs below precede the D1 SPA transport correction. They retain evidence for their recorded source and
unchanged boundaries; they do not certify the new ordinary-command/navigation implementation.

The preceding review reproduced the disabled-setting display defect through the built Event editor. Its matched
native/versioned blank-capacity probe returned 200 and persisted zero on local MariaDB 10.4.32, contrary to the
strict-SQL fixture expectation. That prepared-schema review did not reset the database or change its mode and did
not certify supported MariaDB 10.11 or complete pilot parity. Superseded build/compiler/pass counts remain in Git
and ignored artifacts; the current correction receipts below own renewed evidence.

The authorized correction uses one private presentation helper in `EntityMetadataEditor` for all three columns.
Shared catalog Yes/No wording preserves booleans; zero remains `0`; only null/undefined/empty text uses the placeholder.
Normalization, comparison evidence and submitted values retain their existing owners and raw meanings. The actual
Event adapter's mounted stale-read and lost-save-response cases passed with the existing foundation selection,
7/7. They protect English/German same-DOM translation, unchanged HTTP count and deliberate sparse resolution.

| Correction execution | Actual result and boundary |
|---|---|
| Latest complete re-review execution | A fresh `npm run build` passed. The complete nine-file/105-case `frontend-` selection then ran through ordinary `e2e:init` and the integrated built backend: 104 passed, one appropriate alternate-login-configuration skip, zero failures, in 6.9 minutes. The separate applicable login-disabled case passed in 29.6 seconds. The private task-owned MariaDB 10.11.14 used strict SQL mode and independently verified exact literal disposable-schema grants. No prepared override, server reuse, deadline change or new test was introduced. Logs are in ignored `artifacts/frontend-rereview-20261016/`. |
| Safe-cleanup verification | After comment correction and unused client-wrapper removal, `npm run build:frontend` passed both client/SSR typechecks and bundles. Five existing built cases passed together in 1.7 minutes: Packing creation/duplication, Event creation/duplication and both common-header viewport comparisons. The broad run immediately above precedes this cleanup; its unchanged application assertions are not described as a second complete post-cleanup run. |
| Latest inspected visuals | Root inspected all ten current native/Vue profile-workflow pairs (token, entry, preview, deactivation, account deletion at 1280/390) and the four current Event creation originals. Forms, text and captured geometry agree within the approved shell differences; generated tokens differ by issuance. Workflow tests assert heading/first-field/submit/token geometry and footer visibility, but their captured footer geometry is not asserted. Manual inspection is distinct from executable coverage. The complete browser run does not test the `IMP-066` permission-write schedule. |
| Complete build and compiler | `npm run build` passed, including server, native client and Vue client/SSR. The complete test-project `vue-tsc` check passed again after the final test edits. These do not certify browser or persistence behavior. |
| Complete frontend selection | All 45 files/996 tests passed together in 106.78 seconds, including both new mounted Event comparison/recovery cases. This is one current-source run rather than combined retries; substituted client HTTP remains distinct from backend/system evidence. |
| Standard real ORM selection | `packing-management-api`, `packing-coexistence`, `event-api`, `frontend-profile-administration` and `frontend-profile-workflows` passed together, 87/87 in 92.11 seconds, using ordinary serialized production TypeORM schema setup without a prepared-schema override. The task-owned `surveyor_rectification_test` target on port 23316 used MariaDB 10.11.14, `STRICT_TRANS_TABLES` and credentials restricted to exact literal disposable schemas. The raw-capacity strict-mode case passed. The first run's 86/87 exposed a stale P1 Overview-parent URL/capability expectation; the test-only correction followed the accepted P2 source/phase contract and retained privacy assertions. Both logs remain in ignored `artifacts/frontend-rectification/`. |
| Focused built corrections | All 17 selected built-browser cases passed together through the ordinary managed built application and prepared integrated backend/database. They include the scalar stale-save review, complete profile form/footer assertions and German Event/Packing common-header/settings keyboard/reflow checks. Hydration/data-readiness fixture correction preceded this result; it retained every focus assertion without fixed sleeps or skeleton measurements. |
| Complete pilot E2E selection before C1 | The complete T1 `frontend-` selection ran all nine files/105 cases together through ordinary `e2e:init`, the root-owned built server and integrated MariaDB 10.11.14 with independently verified exact literal grants: 104 passed, one appropriate alternate-authentication configuration skipped, zero failures, in 5.4 minutes. The separate applicable local-login-disabled configuration then passed its one case in 27.8 seconds through the same ordinary setup. The main and alternate receipts remain in ignored `artifacts/frontend-rectification/e2e-t1-final.log` and `e2e-t1-login-disabled.log`. These are two correctly configured runs, not one uniform 105-case pass; the later C1 fixture-only removal has its own scoped verification below. |
| Approved T1 correction | The test observes each frontend's ordinary roster response, separately asserts its complete rendered dietary order/totals, and compares corresponding entries/counts/styles/layout by choice while retaining other exact text/control assertions and deadlines. Independent and root source reviews accept actual adoption and preservation of the bounded approval. The final test-project `vue-tsc` check passed; both focused 1280px/390px organizer cases passed together through standard `e2e:init` in 45.1 seconds and then in the complete run above. The focused responses delivered different native/Vue choice and total sequences at both sizes. Root inspected all four native/Vue roster originals. No runtime/query ordering change or assertion relaxation outside the direct T1 approval occurred. |
| Inspected correction visuals | Root inspected all four current German Event/Packing settings captures at mobile and the 200% desktop-reflow equivalent, plus all four native/Vue profile originals at desktop/mobile. Declared form/footer equality and keyboard/reachability assertions passed. The native one-time-flash offset is an approved surrounding-shell difference; relative compared form geometry remains asserted. These finite scenes do not certify every locale/state or browser-chrome zoom. |
| Conditional C1 removal | After the fixture-only check/plumbing removal, `frontend-identity-api.spec.ts` and `frontend-profile-workflows.spec.ts` passed together through ordinary `e2e:init`: 30 passed, one appropriate alternate-authentication configuration skipped, zero failures, in 2.0 minutes. The task-owned MariaDB 10.11.14 used strict SQL mode and independently verified literal grants on the exact E2E/test schemas. No prepared override, server reuse, deadline change or new tests were introduced. The test-project `vue-tsc` check passed; `check:development` reported 353 authored sources, 11 DBAL owners and zero findings. The fresh independent reviewer accepts the helper and three-line dead CI-plumbing removal with no remaining in-scope recommendation. These are current consumer checks, not a renewed nine-file full-pilot run. |

Two preceding broad runs each finished 103 passed/one configuration skip/one failure. The first, in 6.5 minutes,
timed out on the existing drag journey; its unchanged traced retry passed in 9.0 seconds and all three unchanged
two-worker repetitions passed in 43.8 seconds. Drag also passed in the second broad run, whose 1280px organizer
dietary-sequence comparison failed. Neither earlier receipt is reclassified as a passing uniform run.

The current environment uses Node.js 24.13.0, below the documented 24.15.0 prerequisite; no identical hosted-CI
environment is claimed. Earlier 24 paired read-only GET comparisons
across three records matched. Subsequent tracing proves native-only reads can change the same registration's
dietary sequence from `6,5,4` to `4,5,6` without writes; Vue rendered `4,5,6`. Both frontends use the same
`getParticipantsExtended` → `getEventParticipants` owners, with no nested dietary-row ordering or frontend sort.
The maintainer then explicitly approved the [T1 test-only correction](FRONTEND_FOUNDATION_DESIGN.md#authorized-dietary-parity-assertion-correction-2026-10-16):
each frontend must preserve its ordinary response's dietary order and complete values, while matching corresponding
entries/counts/appearance/layout by choice. Other exact assertions and deadlines remain. Its implementation and new
focused/full verification now have the independently reviewed results above.
The approval does not turn the preceding failed runs into passes.
The first broad drag timeout remains recorded despite its unchanged passing diagnostics/repetitions and passing
second broad run. Runtime, queries and deadlines remain unchanged; only the later explicitly approved T1 dietary
test assertion boundary changes, with all other exact assertions retained.

Prepared-guide semantic review found inherited development/test SQL examples granting on raw underscore schema
patterns despite the existing dedicated-schema requirement. Four exact staged fragment operations now escape those
underscores for the literal `surveyor_dev`, `surveyor_test` and `surveyor_e2e` databases in README/Development/Testing.
The staged Operations recovery paragraph also now includes the implemented Event detail/admin routes. Production
guides, original digests, immutable baseline and application runtime remain unchanged; no publication is claimed.

Git confirms pilot ownership of the old fixture matcher (`f45dad7`, then `7a983c4` and P1 reuse); original specific
approval was not established. The earlier G1 request did not authorize that responsibility and was withdrawn for a
separate retention decision. CI's raw grant statements predate the pilot in `cae7d42`.

The direct C1 answer now requires an unbiased usefulness review and implementation of its recommendations, with G1
conditional on keeping the check. Fresh independent reviewer `/root/fixture_guard_review` recommends removal and
accepts root's actual adoption: no fixture-only grant parser, grant query or read/fixture selector remains; selected
schema checks, compiled metadata, unique fixture rows, exact-ID cleanup and datasource teardown are preserved.
The obsolete three-line E2E CI environment/comment plumbing retires too; integration settings and grant provisioning
are unchanged. The independent report remains in ignored C1 review evidence. This is current forward authorization,
not retroactive approval of the check or its earlier proof claims. No new checker or checker tests are introduced.

Because the check is removed, G1's retention condition is false: no literal-matcher repair or CI grant correction is
implemented under that condition. Dedicated credentials remain a setup requirement, and the staged literal-grant
examples remain valid. The actual inherited CI grant-pattern concern stays visible in its existing owner; it is
neither silently repaired nor promoted into a new P2 blocker. Current consumer execution after removal is recorded
separately above and in ignored `e2e-c1.log`/`e2e-c1-results`; its result is not inferred from the earlier full pilot run.

Earlier same-boundary receipts below retain their original source and environment limits; arithmetic across retries
is not one coherent final-source run. A current build does not renew old HMR, deployment or visual evidence.

## Retained evidence by distinct boundary

| Boundary | Latest relevant prior evidence and practical limit |
|---|---|
| P2 frontend/build | The earlier final P2 frontend/build/compiler selection passed in one scope but missed the later scalar-display defect. Its superseded counts remain in Git; the current complete correction selection above owns this boundary's renewed result. |
| P2 ORM | Fourteen Event tests passed against verified prepared `surveyor_test`, including shared native/v1 capacity and related-child predicates. A temporary harness replaced destructive setup with guarded datasource initialization; no reset/truncation/synchronization ran. This is prepared-schema evidence, not ordinary initialization or a supported-version rerun. |
| P2 built application | All four Event/header files passed together, 24/24, using current-at-that-time `dist/server.js`, real integrated sessions/backend/ORM and prepared `cgd_e2e`. The temporary wrapper changed only the server command. It covered P2A–C controls and actual committed-registration-response loss followed by one-write/read recovery. |
| P2 visual scenes | At 1280px/390px, comparisons cover creation, General/expanded/Access/image settings, registration, roster, note/date/link dialogs, Things to do and Event/Packing headers. They compare declared text, values/states/constraints, geometry and styles. Root/independent reviewers inspected assigned originals in ignored `test-results/p2-implementation-final/`. Approved shell/flash differences and retained native finance remain explicit; PDF bytes are not PDF-layout proof. |
| Identity/profile ORM and HTTP | After session restoration, selected authentication/profile/Packing/public-action suites had 172 distinct passing ORM assertions across runs; final authentication passed 73/73. A later profile-administration run passed 12/12 including real anonymous notice row/cookie/redirect/one-time consumption. These are separate runs, not a final uniform complete integration suite. |
| Identity/profile built workflows | Seventy-eight selected cases have passing evidence across proper login configurations and a corrected real-drag fixture. The initial drag timeout came from only two pixels of movement after scrolling; explicit-position mouse motion retained HTTP/UI/persisted-order assertions. This is finite workflow evidence; no production drag repair, persisted BFCache, live provider or SMTP delivery is certified. |
| Session server integration | Actual Express/session middleware milestones reproduce A/B/C overwrite risk and protect original Session/save/reload identity, rejection of a changed stored generation, no initial anonymous row/cookie, and ordinary explicit save behavior. Synthetic MemoryStore contexts are not real account/guest ORM or global session compare-and-swap evidence. |
| Built client delivery | The isolated client runner passed 21/21 after frontend isolation, including startup/module failure, static denial, deliberate recovery and JavaScript-disabled Help styling. Controlled fixtures exercise actual built modules/browser requests, without integrated backend/database E2E. |
| Source development and HMR | Earlier genuine Express/Vite/SSR/HTTP checks exercise executable source assets, pre-hydration Help/search, controls and composed Sass delivery. Separate earlier authored-input checks exercise CSS HMR with retained focus/draft and serialized API/catalog readiness before restart; probed maintained files were restored byte-for-byte. These distinct old receipts are not renewed by a production build. |
| Installed-folder replacement | Earlier guarded installed-copy assertions verify changed build ID, removal of old assets, one clean automatic reload, real missing old chunk with retained dirty draft, and one compatible persisted 201 command. Core assertions passed separately from a corrected capture invocation; no complete helper pass or operator rehearsal is inferred. |
| Generation/publication tooling | Real watcher fixtures protect API→locale serialization, queued-save readiness publication and invalid-save recovery. Definition freedom regression passes all seven cases against real emitted server/browser validators. Documentation tooling separately protects optional discovery, byte-preserving publication, immutable production/index checks, exact public-file admission and prepared-byte identities. Tool success supplies neither approval nor semantic guide acceptance. |

Earlier paired captures add distinct Help, missing/error, no-JavaScript and retained-draft recovery scenes at 1440/390
and 1280/390. Originals were individually inspected; scrolling/clicking the Review control retained its draft and
issued no replay after a fresh unchanged read. Those uncertainty captures blocked writes before dispatch, unlike
the later real committed-response-loss assertion. Native mobile counters crowd/wrap in both implementations and
tables retain horizontal scrolling. Captures are finite source-scoped evidence, not exact-pixel whole-application
acceptance. Ignored manifests identify actor/data/route/viewport and remain run artifacts rather than maintained
documentation inventories.

## Durable correction dispositions and lessons

The foundation ledger and staged playbook own the contracts; this table retains why the corresponding reviewed
findings closed. Original IDs and general defect dispositions remain in the backlog. Earlier conversation receipts
were unavailable for independent reconstruction in some historical reviews; recorded agent claims alone do not
supply their missing approval. The latest direct user decisions govern the current task.

| Reviewed responsibility | Durable disposition |
|---|---|
| Packing controller ownership and coexistence | Native/v1 creation, metadata, item/membership writes, counters, reorder/delete/default hooks use existing shared owners. The bounded approved native assignment remedy locks root shared before item exclusive, while v1 retains root exclusive. Real production-controller/FK schedules cover both orders, different items, deletion races and removals; they prove only those schedules, not a general lock framework. |
| Native quirks and no-ops | Preserve native item-description/write versus display grants, Everyone omission/missing-row outcomes, signed/null capacity and SQL rounding, sparse/tied order and partial failure. Actual tied-position fixtures match without an invented sort rule. Authorized source/target checks precede harmless same-event no-op; actual changes retain comparison/428/412. `IMP-022/023` remain separate defects. |
| Packing local Packed state (`IMP-043`) | Existing owners preserve failed-read/per-row failed-write selections only in the live admitted actor/list. Healthy rereads and missing-key false retain native meaning. Persistent localized notice and deliberate local Retry do not issue HTTP/replay. Denial, context/list/row retirement and unmount release fallback; successfully stored values are not unpersisted drafts. |
| Command admission (`IMP-044`) | A new `useCommand.run` requires its owner mounted before capture/lease/dispatch. Supported delayed admission while its parent remains live and already-admitted deferred/completing work retain their captured lifetimes. A retired guest continuation cannot silently start another mutation. |
| Startup and file lifetime (`IMP-045/046/047/050`) | Existing startup/mount/update owners protect genuine early input and mounted drafts. Refined Req6A retains SSR/same-tree hydration with interactive skeletons, functional static Help/navigation and an entry-independent localized failure notice. Eight unused interactive POST adapters retire around existing API consumers. Confirmed file operations release the feature File and same native chooser, including failed refresh; rejection/unknown/background reads retain them. Arbitrary later feature failures are outside bounded initial error capture. |
| Scoped identity/mutation finality (`IMP-048/052/053/054/055`) | Existing controller/DBAL completion owners prepare required identity/session/output before their scoped commits. Delivery/SMTP failure is distinct, with no replay. Relink/archive/visibility retain native omitted-completion defaults. Token-free API logout has its bounded owner; truthy provider tokens, including an empty object, retain the separate provider path. No stronger general native guarantee is inferred. |
| Read authority and private counts | Successful current bootstrap opens private dispatch. Session resume pauses reads without erasing readable drafts; first logical-key visit and actual eligible observer dependencies remain explicit. Validated source denial retires its aggregates while independent sibling evidence remains; Query owns the snapshots. Locale cancellation targets translated Help/Overview families only. |
| Comparison/contracts and generated hygiene | One authored bounded comparison token and existing strong field-token syntax cover emitted evidence. Normalized adapters validate once. Exact reserved stale locale-generator JavaScript/map siblings retire safely; symlink/parent escapes and unrelated files remain protected. Authored OpenAPI is the only wire source; definition freedom is distinct from implemented transport support. |
| Shared presentation and feedback (`IMP-061/062`) | Shared action state drives rendered availability and dispatch. Actual static admitted denials survive bootstrap retirement for recovery policy. Confirmed writes survive same-actor read pauses, release completed input and show saved/stale feedback; actual actor retirement still discards old results. Shared receipt, navigation and lifecycle owners preserve caller placement, dismissal locks, wording, focus and refresh. |
| Help and canonical paths | `docs/user-guide/` remains the sole runtime root with reviewed adjacent corpora. Missing locale/topic/required image selects a complete English article with its own assets and visible language notice. Unsafe/unreadable existing sources fail normally; direct asset requests never independently borrow a language. The mistaken intermediate root rename and overbroad native-illustration freeze are corrected without becoming precedent. |
| Readability and consumer proof | Whole-frontend inspection replaced narrower receipts. Complex contracts require meaningful internal phase comments and logical spacing; named helpers and actual mounted consumers matter beyond syntax or component extraction. No numeric style waiver or blanket formatter is introduced. |

## Historical checkpoints retained for linked decisions

### P0 foundation verification (2026-10-14)

P0 diagnosed fixture cost without reproducing a production watcher bug. Its original timeout cause remains unknown;
the bounded actual-session-operation fixture retains complete schemas/catalogs/generators, all lifecycle cycles and
deadlines, with phase diagnostics. Help/permission comment changes preserved comment-free syntax. Build, test graph,
normal quick suite and independent/root review passed in that scope. No database/system/visual/deployment result
follows from these source/tooling checks. Detailed completed sequences remain in Git and ignored `artifacts/frontend-p0/`.

### P1 migration verification (2026-10-14)

This historical P1 receipt describes the then-implemented transport. The direct October 16 D1 reply supersedes its
document-command choice; its unchanged controller reuse and backend exclusions remain. P1A–D implemented profile
administration, transfer, destructive identity and common presentation. Existing native controller operations remain
the business owners. Transfer/deactivation/deletion used deliberate document POSTs in
native order, not a stronger atomic JSON mutation. Private read-only previews remain mounted, out of URLs/cache/
storage; fixed nonsecret fragments support navigation without replay. Native wrong-confirmation 500/submitted input,
last-profile deactivation's partial 400, provider/root destinations and source-owned escaped completion prose remain.
Capability denial does not clear a valid identity. A native side-effecting token GET runs once per document.

Original stronger profile field-edit/create wrappers were superseded by explicit A2 direct `updateProfile`/
`createProfile` reuse. Prepare `MutationResult` before invoking the native operation; subsequent read/navigation
failure cannot reject/replay its confirmation. Native partial failures are inherited, not certified atomic.
R1A/R1B current-token authority, R2 transfer, R3 deactivation and R4 deletion remedies were explicitly excluded as
general backend work; `IMP-006/058–060` remain open. Bounded desktop/mobile workflow comparisons do not prove persisted
BFCache, complete visual acceptance, financial behavior or provider/mail delivery.

### Pilot review follow-up (2026-10-14)

A1 added shared action state with actual current-consumer adoption; A2 restored direct profile-operation reuse;
A3 corrected plan/link metadata; A4 labeled completed DEC-005 dependencies historical. Superseded A5 inferred a
definition prohibition from unused transport removal. The maintainer's October 15 correction rejects that inference;
passing restriction tests and unavailable earlier conversation evidence do not grant approval. Prior scoped build,
mounted, ORM/HTTP, built-system and client-browser receipts retain their own boundaries.

### Definition-guard correction verification (2026-10-15)

The generator's array-parameter/media whitelist bans are removed under the
[DEC-006 correction](../decisions/DEC-006-FRONTEND-FRAMEWORK.md#maintainer-correction-2026-10-15). Real generated
validators accept valid array/object/tagged-union/plain-text definitions and reject malformed instances; seven
cases passed. Existing artifacts remain identical. Runtime query-array decoding/plain-text writers remain removed.
Schema acceptance does not implement HTTP transport. No application/database/browser run is claimed by this change.

### Native-frontend isolation implementation (2026-10-15)

The separately authorized adaptation removed the Vue feedback timer's native import and copied four authored Sass
owners into `src/frontend/styles/`. `application.sass` composes base/Help/overrides once for Vite client/SSR and
pre-JavaScript delivery. Native source/build inputs remain unchanged. Installed Bootstrap 5.3.8 plus the existing
5.3.3 CDN layer are preserved; vendor deduplication was not authorized. Shared images/packages/backend/catalogs remain.
`IMP-063` resolves by temporary coexistence duplication, not a native password-helper extraction.

Dependency inspection accepted the actual client/SSR graph with no native source edge; source maps contain no native
JavaScript/style/view entry. Four copies and compiled base/Help graphs matched their native references. Final genuine
source-runtime and built-client checks passed; 390px/1280px JavaScript-disabled synthetic Help screenshots matched
the in-memory native-style comparator pixel-for-pixel. This is bounded delivery/style evidence, not full native
workflow acceptance. The normal native-inclusive build was intentionally not rerun for that adaptation.

### Pilot session admission correction (2026-10-15)

Actual Express/session HTTP milestones reproduced admission adopting stored B then saving it over later C. The first
remedy introduced writable `req.apiSession`, save observation and locked admission/flash merging without adequately
explaining the changed lifecycle. Its architectural acceptance and earlier `IMP-064` closure are withdrawn;
passing tests, shared files/store and agent-authored amendments cannot authorize that implementation.

The explicit restoration/stateless plan retains one ordinary Express Session/save/reload owner. Stored-generation
mismatch rejects without adopting B or clearing authority. Plain server-hydrated actor data grants no browser
authority. Message-free initial public/session reads project null context/CSRF without row/cookie; authenticated
legacy metadata uses bounded read-only HMAC projection. Explicit identity completion retains its approved final
transaction, including first absent rows; no generic admission transaction/save observer remains.

Public comparison scope without identity/frontend context binds resource, method and exposed current fields;
controllers reauthorize. Configured-origin/Fetch Metadata, non-simple compatibility header and generated decoding
protect its writes. Omitting claims cannot downgrade a context-bearing/authenticated scope. Legacy fallback cannot
conceal malformed newly staged metadata; actor-preserving replies retain their admitted derived context. Final ORM
regressions protect both boundaries. `IMP-064` closes only the original overwrite under the latest authorization.

The later native-flash choice deliberately retains an anonymous row/cookie for an account-required 302/one-time
notice while ordinary initial reads remain uninitialized. The rejected URL/repeated-notice proposal was never
implemented. `ARCH-005` owns whole-session/flash review separately; no global CAS/exhaustive-race guarantee follows.

### Full pilot baseline and migration-readiness re-review (2026-10-15)

Independent frontend/backend and root review traced the complete implemented pilot, native baselines, original
choices, explicit amendments, actual common consumers and staged guidance. It found no then-known implementation
blocker and supported the next authorized vertical slice, without preapproving later modules or cutover. The later
October 16 findings above qualify that readiness assessment rather than being erased by its earlier clean result.
Each module still proves its own grants/projections, drafts, privacy, native geometry and uncertainty behavior.

### P2 Event migration verification (2026-10-16)

The direct P2 request covered foundation, participant and organizer packages. Bounded projections expose own
attendance/count/invoice-existence only as admitted, without the native roster/finance aggregate. Page/admin/roster/
management/export grants remain distinct. Token entry survives guest identity without consumption until deliberate
registration. Native full civil dates, timezone/deadline meaning, empty duplicate deadline, permission serialization,
form controls and rejected-input retention remain. Native registration controls can attempt a server-rejected write
without its write grant. Inherited multi-step creation/token/concurrency limits are not repaired by migration.

### Full P2 completeness and migration-readiness review (2026-10-16)

The first complete review corrected required own reads versus optional active dependents, equal-read image recovery,
closed-disclosure polling/unknown counts, live date-dialog grants, native cancellation no-ops/deadline order, shared
Event method policy and native settings/icon geometry. It removed implementation deviations without inventing
approval. Distinct guest actors, generated required fields and real native selectors corrected fixtures; assertions
and deadlines were preserved. Passing review checks did not certify later duplicate-implementation findings.

### Full P2 implementation completion (2026-10-16)

The subsequent explicit completion request corrected displayed header, metadata-handle, entry-retirement and
lifecycle duplication through actually adopted shared owners. Read-only participant/summary notes resolve current
admitted roster data independently of search; missing/empty/denied sources retire selection while date drafts remain.
Existing Event controller capacity/related-child predicates serve native/v1; five optional-profile declarations
match unchanged runtime public grants. Detail/personal/link-creation/lifecycle requirements remain distinct.

The final P2 run and declared compared scenes are retained in the evidence table above. They established finite
P2A–C behavior and shared-consumer coverage, while the later full-pilot review found scalar-display/assertion gaps.
No prior completion claim overrides those findings or relabels them future work.

## Remaining evidence limits and next-slice handoff

Full parity means the declared implemented pilot journeys and relevant states have meaningful running-app
assertions and inspected matched visual evidence. It is not established merely by source mappings, an aggregate
pass count or selected Event/header scenes. The current selection adds complete profile form/footer and German
shared-settings keyboard/reflow evidence to existing actor, validation and recovery cases. Its finite scope remains
the mapped assertions and inspected scenes; complete locale/state, restricted-actor, zoom and accessibility matrices
are not certified. The failing dietary-order comparison and first-run drag timeout remain explicit above,
without waiving either failure. The approved T1 test correction has its separate implementation/verification scope;
it does not authorize native/backend ordering changes or further phase migration.

The local MariaDB 10.4.32 setup previously exceeded ordinary preparation deadlines; separate guarded preparation
and temporary built-only/prepared-ORM wrappers were disclosed. They preserved real backend delivery/assertions,
but did not establish ordinary setup or MariaDB 10.11 acceptance. The current correction's standard ORM and built
selections renew supported-database/ordinary-setup evidence only for their scopes above. A prior deterministic two-clean-tree generator
check exceeded its unchanged 60-second limit without an assertion mismatch; its cause remains verification debt.
Earlier supported MariaDB 10.11.14 receipts apply only to their older source scopes. Those runs weakened no timeout,
schema scope or source fingerprint to create a pass. The subsequent fixture-only check removal follows the separate
explicit C1 review/decision above; it does not change those earlier execution scopes or certify credential authority.

General defects remain separately owned: native mixed reset (`IMP-051`), provider logout preparation (`IMP-056`),
mixed activation acknowledgement (`IMP-057`), token/transfer/deactivation/deletion remedies, Event capacity race
(`IMP-037`), permission review and `ARCH-005`. Source scheduling exposed some mixed-writer risks without reproducing
every database schedule. They remain excluded backend work, not hidden unfinished frontend features. Persisted
principal language and complete email/PDF/domain localization remain unimplemented targets in active DEC-006.

No finite receipt certifies live OIDC, successful SMTP/inbox delivery, hosted CI, operator restore/deployment,
rendered PDF layout, every timezone/DST input, all permission/concurrency combinations, full-application migration,
default-route cutover, native deletion or guide publication. Application checks stay separate from advisory
documentation diagnostics. Production guides remain protected; prepared output needs actual independent/root
semantic review tied to its current identities and separate publication authorization.

Use the existing [migration contribution handoff](FRONTEND_FOUNDATION_DESIGN.md#migration-contribution-handoff),
[playbook](staged/DEVELOPMENT.md#adding-or-changing-a-feature-view) and [coverage map](TEST_COVERAGE.md) for each authorized
next slice. Drivers adopts the already shared guest/entry/header/settings/metadata/access/lifecycle owners where
their responsibilities match. Distinct ride, survey, activity and finance semantics stay in their owners. Inspect
all current matching Vue consumers and adopt shared changes together; preserve native isolation, actual backend
reuse and every existing phase-specific exception. The live phase plan is a contract, not inferred authorization.
