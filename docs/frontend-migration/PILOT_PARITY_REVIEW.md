# Frontend pilot parity review
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-23
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: Approved readiness corrections and final-review deletion receipt admission and Activity cold-read recovery implemented and independently reviewed; renewed scoped execution and separate P11 boundaries retained
source-anchors: docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md; docs/frontend-migration/FRONTEND_FULL_IMPLEMENTATION_PLAN.md; docs/frontend-migration/TEST_COVERAGE.md; docs/frontend-migration/staged/; docs/backlog/documentation-remediation.yml; src/controller/; src/modules/database/services/; src/modules/api/; src/modules/lib/session.ts; src/modules/lib/frontendSession.ts; src/frontend/; contracts/api/v1/; src/locales/; scripts/generate-api.mjs; scripts/generate-locales.mjs; scripts/watch-frontend-inputs.mjs; tests/frontend/; tests/integration/; tests/e2e/; vitest.config.mts; playwright.config.ts; src/types/FrontendPilotUiTypes.d.ts
next-review: authorized-pilot-correction-verification-or-next-migration-slice
-->

The native design comparator is `2dfa2573c64178f54684cc4877b5a945f66e24c8`; the application-source baseline used in the
session/full-pilot review is `7ff78998667e55df56390a8e8da88e8ace687771`. Neither identifies a deployed site's version.
The [foundation ledger](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments) owns original choices
and dated amendments. This record owns current findings, latest relevant evidence and concise historical dispositions.
Superseded run counts, repeated failures, file inventories and capture transcripts remain in Git and ignored artifacts.
There is no second maintained archive or approval request in this record.

## Approved readiness implementation review (2026-10-23)

The maintainer explicitly approved the preceding review's individual R1, R2 and R3 decisions. Implementation starts
from committed P10 corrections at `419e8bbd02ca202aeaf29789ea00a89eafa3d99a` and follows the
[dated amendment](FRONTEND_FOUNDATION_DESIGN.md#approved-readiness-corrections-2026-10-23). The existing owners now
implement all three corrections; no approved remedy is deferred.

The next final review at `ee58f9f057b67d2b18b216eea2b3d751e3f56747` found two further P2 gaps. The maintainer
directly requested their implementation and another review; the
[dated correction](FRONTEND_FOUNDATION_DESIGN.md#authorized-final-review-corrections-2026-10-23) records that bounded
authority separately from R1–R3. Both fixes now use their existing shared owners, with no task-owned remedy deferred.

| Decision | Shared adoption and reviewed behavior |
|---|---|
| R1: composing Enter | `InlineCell` guards input Enter and textarea Ctrl+Enter before default prevention, serving Activity text/schedule, Packing and Drivers through their existing shared control. Activity role entry guards its distinct selection/creation operation the same way. Completed shortcuts, mouse actions and blur retain their existing behavior. Six mounted cases exercise both inline presentations and both role branches; the built Packing editor additionally requires the retained node, untouched composing default, no premature persistence and exactly one later genuine PATCH. Events are synthetic, not an operating-system IME certification. |
| R2: first-attempt deletion consent | `useEntityRemoval` releases original whole-page discard consent in its existing first-attempt `finally`. Confirmed result and read/navigation recovery survive independently, without DELETE replay. Mounted App/Event admin, retained Settings and denied-private-view fallback cases cancel and accept later current-draft departure. The built organizer case confirms a real child DELETE, fails only lazy-module network delivery, then creates a new attendance draft. Forward through genuine same-document Help history preserves the same draft node on cancellation and leaves on acceptance; the persisted arrival date is unchanged. |
| R3: invalidated Overview writes | `queryCache` exposes a read-only reactive projection of the current key's actual invalidation flag, disposing its subscription without another authority/data store. Overview's region handlers and shared card controls block archive, restore, automation, personal visibility and Delete while retaining existing read/navigation admission. Regressions cover warm destination and paused collection reads, background-read failure, locale/key replacement and successful recovery, including direct handler refusal. The built warm-default deletion case holds genuine backend delivery, requires disabled stale-card Delete with no replay, then verifies the removed card disappears and a saved survivor regains its action. |
| Final review: shared deletion admission | The existing confirmed-navigation receipt exposes derived capacity. `useEntityRemoval` uses it for dispatch; Settings, all five Overview card families and Event administrator child controls adopt the same Delete-only restriction. The receipt installs before cancellation/invalidation yields, including when a previous read deadline or shared read pause prevents GET delivery. Later Retry repeats only admitted reads/navigation. Mounted actual Event/Settings cases reject a second parent Delete through both its rendered control and public action event during held cancellation and after failed delivery, preserving Archive and current attendance drafts. The built organizer journey proves one real child DELETE, blocked parent Delete, usable title/Archive controls and retained draft/departure protection. |
| Final review: Activity cold-read Refresh | The existing toolbar now remains outside the data-only schedule branch. Cold recoverable reads retain manual Refresh and its existing pending/cooldown owner; validated 403/404 still retires private controls. Mounted 429/503 cases require deadline-respecting recovery without overlapping reads and retain a later real inline draft. The built Overview-to-Activity journey confirms real entry admission, fails only three genuine detail-response deliveries, then restores the real backend response through one deliberate Refresh without mutation or document navigation. |

Independent nonauthor reviews and root review checked actual production adoption, retained control/value lifetimes,
no-replay behavior, comments and declaration boundaries. The similar-issue trace also inspected every explicit Enter
handler, both whole-page departure-consent consumers and Overview's manual cache seeding/aliases. Search controls
which only suppress parent submission perform no action shortcut; Profile workflow already releases its own lease.
Initial Overview bootstrap cannot revive after a committed SPA departure, and canonical aliases follow an actual
admitted successful read. The final follow-up additionally traced the three removal consumers, all five Overview
families, creation/identity/profile delivery handoffs and matching cold-read controls in Packing, Drivers, Survey
and Activity's advanced workspaces. No additional concrete defect was established within those reviewed boundaries.

The staged contribution and architecture guidance now describes these exact ownership contracts. Complete-guide
review additionally found an inherited Operations promise of a five-second Finance pool notice: only native
presentation owns that timer. Under the already approved common-SPA feedback decision, staged Operations now
describes actual shared pending controls, ten-second transient receipts and durable unresolved/stale conditions,
retaining the useful keep-open/no-repeat guidance. This corrects documentation without adding a timer or changing
runtime behavior. Original decisions and production guides remain preserved.

Verification uses supported Node.js **24.15.0** and the task-owned, schema-restricted MariaDB **10.11.14** runtime.
Ignored `artifacts/frontend-final-fixes-20261023/` retains current commands, failures, baselines and receipts;
`artifacts/frontend-approved-decisions-20261023/` retains the preceding R1–R3 execution history.

| Check | Executed result and limit |
|---|---|
| Full build and test compiler | Server, native assets, Vue client and SSR builds passed. The renewed test typecheck passed after correcting the new system fixture's card locator to the actual link containing its title and description. |
| Complete database-free suite | **2,037/2,037** in **89 files** passed with unchanged existing assertions and deadlines. The first broad run passed 2,036 but the existing clean-tree generator case exceeded its 60-second deadline. The unchanged focused case then passed in 36.34 seconds, followed by the successful normal full renewal. The initial slow phase/cause is unproven; no deadline, generator or runtime repair is claimed. |
| Isolated built-client browser suite | **50/50** passed through the established client runner. These isolated browser fixtures are distinct from integrated E2E. |
| Focused shared-owner regressions | Activity's complete mounted file passed **35/35**, and the corrected page-entry file passed **31/31**. The full renewal includes these files, organizer held/settled delivery cases, shared Settings and Overview regressions; overlapping selections are not additional unique-test totals. Corrected baseline assertions failed before the fixes and passed afterward. |
| Scoped built-application E2E | A normal renewed selection passed **28/28**, with zero failures/skips, across Event organizer, basic Activity and cross-application workflows. The first selection passed 27 but the new Activity fixture assumed a title-only accessible card-link name; its corrected focused journey and the subsequent complete selected renewal passed without changing product names, criteria or deadlines. These are integrated built-app/database tests; the current selection does not rerun the entire E2E inventory. The preceding complete 269-pass/one-configuration-skip receipt remains historical evidence for its earlier source state. |
| Semantic, visual and engineering review | Root and independent nonauthors reviewed actual production adoption, relevant guide changes and three new original English desktop captures: retained-child parent Settings, cold Activity recovery and the restored saved schedule. No sampled visual defect was found. The global 444-source/11-DBAL checks and all eight changed frontend readability owners reported no findings. Final ordinary-file inspection found no emitted JavaScript/map siblings or native/backend/contract/dependency changes. |

Visual observation remains finite to those visible scenes, widths and locales; neither it nor synthetic composing
events proves every browser, input method, actor or state. The prior unexplained Windows worker exit remains historical
evidence, not a diagnosed or repaired fault; the current scoped renewal contains no such exit. The preceding
development SSR/HMR timeout likewise retains its earlier uncertainty. Initial validation encountered three
untracked emitted JavaScript siblings; only those outputs were removed before the corrected baseline, without
changing IDE settings or claiming an established producer. Final source inspection is clean. Native frontend,
backend business sources and production guides are unchanged by this correction. P11/default-route cutover, native
retirement, guide publication, deployment and excluded backend remedies retain their separate authority.

## Whole-frontend production-readiness review (2026-10-23)

The maintainer requested another review of the whole frontend, emphasizing previously missed gaps and production
readiness. The starting tree was clean at `247c99021ce46918dd46cba02d26df78937d5c3f`. Source review covered all
167 authored frontend files: application/composable/identity owners, Activity/Event/Finance, shared components and
the remaining feature/style owners. Relevant declaration, transport, renderer, controller, build and test boundaries
were traced additionally. This is a finite review, not proof of every browser, operating-system input method or
actor/state/locale combination.

The corrections adopt existing owners rather than introduce another controller, service, draft store or query-policy
registry. Native frontend and backend business sources remain unchanged.

| Reviewed gap | Corrected ownership and exercised boundary |
|---|---|
| Refresh released before dependent reads completed | Event's explicit page action now spans its selected reads. The shared fresh-family helper retains the first observed failure but waits for every already-dispatched read before releasing its initiating owner. Held successful and rejected sibling reads retain the draft, busy state and focus policy. |
| Profile workflow teardown and recovery deadlines | A temporary warm admission failure retains the admitted form and its input/secret nodes. Existing session and admission retry availability jointly govern authority Refresh, including recovery while ordinary reads remain paused. Validated denial and actor/visit retirement retain their existing authority. |
| Confirmed deletion did not reconcile cached collections | Shared entity removal cancels older Overview reads and invalidates only the captured actor's collection variants. The existing confirmed-navigation receipt retains selected read-family keys and retries admitted reads/delivery without repeating DELETE or reading the deleted detail. Same-URL, warm filtered-return, held-read, actor-retirement and cooldown cases exercise this boundary. The subsequent approved R3 correction also fences writes during destination/paused-variant recovery. |
| Overview Delete lacked initiating pending state | The region supplies the actual typed row identity to the shared card/action owner. Another family sharing its UUID remains only blocked; rejection retains the initiating control's focus policy. |
| Independent Finance histories and roster changes | Adjustment inspection starts with the uncertain removal owner and shares one saved-data read. Explicit pool creation releases removed checkbox identifiers while preserving surviving choices and pending/unknown submission ownership. |
| Activity title draft silently omitted after grant loss | The shared-text dialog retains its opening field set and refuses partial Save/Review while its title grant is lost. Other metadata editors retain their separately established explicit field-review contract. |
| Settings retained values outlived their actual controls | A selected header File keeps its native chooser hidden and disabled through narrow write loss. Metadata keeps its existing dirty/unknown/pending/recovery owner through the same boundary, with current grants blocking new writes and hidden automatic reads. Regrant restores the retained control/draft; validated read denial still retires protected state. Unknown metadata recovery remains reachable from the dialog footer on another tab. |
| Portal spinner escaped reduced-motion styling | The existing reduced-motion selector includes the dialog portal. A real built-client pending picker spinner now has no animation under the reduced-motion preference. |

The [coverage map](TEST_COVERAGE.md#p10-cross-application-assertion-map-2026-10-23) names the actual assertion
owners, and the [staged playbook](staged/DEVELOPMENT.md) records their reusable contracts without changing distinct
feature review rules. The built root-deletion regression requires genuine successful DELETE and Overview responses,
uses the exact default URL and a warm filtered return, and bounds reconciliation to five seconds so ordinary polling
cannot conceal the original defect.

Three further findings were presented individually in the final conversation response: unfinished composing-Enter
submission/role selection, deletion consent covering later attendance drafts, and enabled writes on invalidated warm
Overview cards. The maintainer explicitly approved R1, R2 and R3 in reply. Their bounded implementation follows the
[dated amendment](FRONTEND_FOUNDATION_DESIGN.md#approved-readiness-corrections-2026-10-23); these are resolved
decisions, not accepted deferrals. The earlier participant-view deletion diagnostic supplied an impossible remove
grant and remains rejected as production evidence. P11, deployment, native removal, guide publication and the
separately excluded backend remedies retain their existing authority boundaries.

This pre-approval review's evidence is retained under ignored `artifacts/frontend-production-review-20261023/`; the mounted consent
proof has its separate `artifacts/frontend-production-consent-review-20261023/` scope. The full build and all
50 built-client browser cases passed. The initial database-free run passed 2,016 cases but exceeded the unchanged
development SSR/HMR and clean-tree-generation deadlines; that failed run is retained. The isolated complete
renewal passed all 2,018 cases with the same deadlines. Four test-fixture type errors were corrected without
changing production behavior, and the final test typecheck passed.

The integrated full run completed with 264 passes, two failures and one local-login configuration skip. The mobile
Activity Reload failure came from its deliberate alternate-focus setup: twelve instrumented cycles retained the
genuine backend response, and all six alternate-focus cycles scrolled before delivery while Reload remained disabled.
The setup now uses native `preventScroll`; both focus outcomes, exact scroll assertions, response gates and deadlines
remain unchanged. The other failure was a zero-duration Windows worker exit before the profile-token case produced
an assertion; its cause remains unknown. Three unchanged targeted token observations passed. The final two complete
affected files then passed all 35 cases. Matching actual case identities across the full and final runs gives 266
enabled cases with passing observations and one configuration skip, not one uninterrupted green full run.

Human review inspected 37 current original images: desktop/mobile Overview and all five card families, one calendar
set and German Finance preview/ledger samples. No additional visual defect was found in those scenes; offscreen
content, other input methods and unsampled actor/state/browser combinations remain outside that observation.
The engineering check covered the full authored declaration/DBAL inventory and all frontend TypeScript/Vue paths,
with no findings; whitespace and native/backend source isolation checks were clean. Current Architecture,
Development and Testing amendments reconcile required-read delivery, captured-actor remounts and focus-test setup
without publishing production guides. Complete eight-guide preparation and independent/root semantic review retain
their own input/output receipts and the existing advisory fingerprint finding. Earlier run/capture receipts below
remain historical evidence for their own source bytes.

## Shared-control adoption and guidance correction (2026-10-23)

The maintainer directly instructed: implement the preceding conversational correction plan fully, review again
and search other areas for similar problems. This authorizes the identified shared-control adoption, stale-test
correction, reliability investigation and existing-guidance reconciliation. Native sources, backend business
behavior, default routing, P11, native retirement, publication, deployment and excluded extensions retain their
existing separate boundaries.

The follow-up running-app review demonstrated that Activity Rules Reload passed its operation only as `disabled`.
`ActionButton` therefore never entered its existing pending-focus lifetime, and Chromium left focus on `BODY`
after completion. The shared owner now separates operation state from optional spinner presentation. Matching
consumers supply actual initiating state through their existing shared wrappers and feature owners; no-spinner
workflows opt out of the spinner independently. A sibling-only disabling condition does not acquire restoration
authority. The same mounted-control, availability, actor-retirement, deliberate-interaction and no-scroll rules
remain in that shared owner rather than per-feature focus helpers.
Specialized Activity role suggestions now adopt that same button with caller-owned list-group styling; no
duplicate action owner is needed. Matching Survey ballot/combination, Event registration Save/Cancel and saved-row
commands identify their initiating form or row instead of making every blocked sibling busy. Shared list, Event
and recommendation recovery controls retain their existing protected recovery state. Overview's held-sibling
regression additionally found that ordinary reconciliation creates no protected recovery state: its presentation
marker now spans every existing family read. Finance's keyed ledger controls pass their complete saved-read
lifetime through the shared footer; its section action also waits for the selected breakdown and blocks overlapping
Refresh dispatch. The shared focus observer now uses its own pre-render queue so completion waits for the actual
enabling DOM patch; the held-sibling regression exposed the earlier synchronous scheduling gap. Same-turn actions
with no disabled DOM patch retain focus without restoration. These markers and scheduling change no query,
command lease, authority or private projection.
The same audit separated Event picker Previous/Next/Retry, creation versus its read-only admission Retry and
profile-workflow authority Refresh versus token/destructive commands. Creation keeps its initiating state through
the existing admission/write handoff. Workflow submission now displays its existing recovery refusal throughout
the entry read after session verification. Finance retains its inherited query-read indicator when no local
initiator is known and suppresses borrowed toolbar progress for a known ledger action. These corrections preserve
the existing request selection, operation order, private caches and recovery leases.

Genuine built-browser probes also reproduced focus loss when Enter disabled a retained inline editor before a
real 412 conflict, and when a login input received a real 401 credential rejection. The common algorithm now lives
once in `usePendingFocus`, adopted by `ActionButton`, `InlineCell`, `FormField` and distinct native locale,
Packing Everyone and Activity role-entry controls. Matching submitted fields receive their own form's pending
state through existing creation/metadata/Quick Add wrappers; distinct native directives explicitly supply their
actual input ref. Fieldset disabling, actor/availability loss, successful removal and deliberate interaction veto
restoration. Field values, validation and intentional rejected-password clearing retain their existing owners.
The same audit distinguishes identity submission from recovery mail and guest registration from modal recovery;
readonly Drivers Quick Add can also initiate Enter and receives its actual form pending state. Modal form actions
use their existing row-operation markers so unrelated removal/revocation only blocks them.

The source audit also found an obsolete progressive-loading assertion requiring the complete empty Overview
form to disappear. It now checks the same retained form and enabled Refresh button while omitting only the
search/filter/count controls. Its independent reads, private-count timing, untouched blank-input removal and
separate dirty-search contracts remain intact. The revoked-Packing E2E fixture no longer assumes Refresh survives
after permission removal: it begins from admitted Refresh, pauses that genuine GET before backend admission,
revokes through the owner and requires the real 403. History retirement and independent Activity access remain
part of the same integrated workflow; neither deadlines nor retries were increased.

Current guidance is reconciled with actual P9/P10 adoption. The API reference now includes the implemented
calculation, settlement, rollback, notification and existing output boundaries, preserving earlier phase choices
and direct implementation triggers. The staged playbook distinguishes initiating pending state from spinner
presentation and unrelated blocking. The coverage map describes observable assertions rather than certifying
execution. A stale final handoff referring to Drivers as the next migration was corrected to existing adoption
across all five entity families, with deliberate feature exceptions retained.

Final correction verification used supported Node.js **24.15.0** and guarded, task-owned MariaDB **10.11.14** schemas.

| Check | Executed result and scope |
|---|---|
| Build and test compiler | Server, native assets, Vue client and SSR builds passed; final test typecheck passed. |
| Normal quick suite | **1,995/1,995** tests in **89** files passed; genuine development-runtime integration passed **2/2** within its unchanged 30-second deadline. |
| Database integration | **521/521** tests in **29** files passed before the final focus-only frontend extraction; backend sources remained unchanged. |
| Isolated browser and disabled authentication | Client browser **49/49** passed with one CLI worker; the separate disabled-authentication built workflow passed **1/1**. |
| Engineering review | Global **444**-file and frontend **161**-file checks reported no findings. |

The 26.9-minute full built-application E2E run recorded **262 passed, 3 failed and 1 expected skip**. After fixture
corrections, the management/Everyone and Help journeys passed; both sticky-control cases still failed because their
setup scrolling had not finished. Explicit instant centering then passed both sticky cases (**2/2**). The retained
case-history matrix therefore records **265 passed and 1 expected skip across 266 unique cases**, combining the full
run and strict targeted renewals. This is not one uninterrupted green full run. Genuine held 401/412 rejection,
fieldset-disabled metadata, Everyone PATCH and locale PUT journeys all have passing executions. Only the existing
Packing/Help E2E spec changed after the full run; production bytes remained identical. The fixtures preserve real
backend responses, complete-visibility, same-node, focus, scroll and persistence assertions without clamping results
or extending deadlines.

An earlier quick attempt failed two source-artifact checks after an unexpected untracked emitted JavaScript sibling
appeared. Its bytes were archived; its writer remains unknown. The final scan covered **899** ordinary files,
including ignored files under `src/`, `tests/`, `scripts/` and root files, checking non-declaration TypeScript files
for emitted JavaScript/source-map siblings: **zero collisions**, with no recurrence. An earlier broad browser run
also lost its server connection for an unexplained reason. Two later unchanged-native reproduction cases passed;
that does not diagnose the earlier server exit.

Four reviewers inspected **276 distinct original PNGs** across the finite native/Vue captures, retaining exact-path
receipts in ignored correction artifacts. Those inspections and passing journeys establish their sampled states,
widths, locales and actions, not every possible visual/behavioral combination. Earlier receipts below retain their
original source and finite scopes. Production-guide publication and P11 remain separately authorized boundaries.

## P10 cross-application integration review (2026-10-23)

The maintainer's [explicit P10 instruction](FRONTEND_FOUNDATION_DESIGN.md#explicit-p10-implementation-trigger-2026-10-23)
authorizes the existing integration contract. The five entity families, Help, identity/profile workflows and
participant/organizer Finance are available through the opt-in Vue application. Inspection of actual shell,
Overview, parent, creation, duplicate, settings and Event administration consumers found no remaining ordinary
native interactive destination. Provider/capability arrivals and authorized image/proof/PDF/print outputs retain
their explicit boundaries. P11, native-source changes/removal, default routing, guide publication, deployment,
principal-language persistence, full output localization and excluded backend remedies remain separate.

The source review found and corrected two Overview integration defects. Failed delivery after a confirmed
non-Packing deletion displayed Packing feedback; the shared completion owner now exposes only the matching
logical owner's retained notice, and Overview translates that original feature message through locale changes.
Retry completes navigation without another DELETE. An empty unfiltered region previously omitted manual Refresh
with its search toolbar; it now keeps the existing Refresh/read owner and stable control while conditionally
omitting search/filter/count fields. Empty wording, private counts and independent region lifetimes remain intact.

Independent Chromium inspection then demonstrated that native disabling blurs a focused button. Keeping its
element mounted alone did not establish focus preservation, despite Happy DOM's result. `ActionButton` now owns
only the transient DOM reference needed to restore an unclaimed pending-control focus without scrolling. Another
pointer/key action, another focused control, window blur, actor retirement, loss of availability or unmount wins.
Optional context injection preserves standalone controls; there is no new request, draft, server snapshot or
authority owner. Both native disabled semantics and initialization barriers remain. Mounted cases model the
browser blur explicitly; the built mixed-family cases hold genuine responses to verify focus and deliberate moves.

The [assertion map](TEST_COVERAGE.md#p10-cross-application-assertion-map-2026-10-23) records the exact source and
test boundaries. Cross-family fixtures preserve deliberate standalone signed-in admission: removing an owner
editor is distinct from denying readable standalone content. The revocation fixture therefore uses a linked
Packing child whose Event admission depends on its explicit grant. Unknown commands commit once, protect canceled
departure, then use deliberate Refresh to inspect saved state after accepted cross-family navigation without replay.
Ordinary same-actor return can reuse its still-fresh admitted cache; this adds no forced-entry read policy.

Root and independent reviews by `/root/navigation`, `/root/overview` and `/root/lifecycle_review` compare the
original accepted owners and dated amendments, actual matching consumers, readability, type-only declarations,
approval provenance and native isolation. Existing controllers/domain/DBAL remain the backend owners. No new
approval conflict, alternate backend implementation or unresolved P10 navigation path was identified. These agent
reviews establish their inspected scope only; the direct maintainer instruction supplies implementation authority.

Staged Architecture/Development now describe complete opt-in navigation and shared focus behavior without obsolete
phase/cutover instructions in production payloads. The unique-contract review found API/toolchain rationale and
future language/output decisions retained in DEC-006, and session/public-grant, current-value/no-op, draft/read,
uncertainty, deployment, Packed fallback, Finance/recommendation and Help contracts retained in mapped guidance.
No control/profile material is retired, no new documentation destination is created, and frozen production guides
remain unchanged. The existing profile/manifest remains the owner of exact preparation and any separately
authorized publication.

Verification uses Node.js **24.15.0** and an independently inspected MariaDB **10.11.14** instance with strict SQL
mode and separate `surveyor_p10_test`/`surveyor_p10_e2e` schemas. Each credential has only its schema's grants;
the pre-existing local database is not reset. Logs, case identities and original images remain under ignored
`artifacts/frontend-p10-20261023/`.

| Verification | Actual evidence and limit |
|---|---|
| Build/compiler | Full server/native/Vue client/SSR build passes. The final Vue client/SSR rebuild includes the shared focus correction. The test compiler checks the current authored tests. |
| Focused database-free | Twelve relevant client suites pass **394 cases**, including the actual-router **54-case** update matrix, retained identity/command/navigation cases and all new mixed-family/focus cases. The genuine Express/Vite runtime fixture separately passes **2/2** on final source in **17.83 seconds** under its unchanged 30-second deadline. |
| Persistence | Overview and profile-administration integration pass **21/21** through actual ORM/controller owners and their independently guarded schema. No backend remedy or new transaction guarantee is claimed. |
| Isolated built browser | All **49/49** existing client-browser cases pass against current built assets. This is client evidence, separate from integrated E2E. |
| Built application | **17 distinct cases** have a passing latest result across the selected broad run, seven-case renewal and one-case unknown-result renewal. They cover all five real creation/duplicate workflows, profile create/switch/edit, transfer/deactivation/preview/history, unknown Finance calculation and the seven new cross-family journeys. The 17-case run itself had **14 passes/3 failures**; the seven-case run had **6 passes/1 failure**. Corrected assertions use the actual Activity title control and Event archive fields, matched resting pointer state, and explicit saved-state Refresh rather than a forced-entry-read assumption. No application behavior or deadline was weakened to resolve those test errors. |
| Visual review | `/root/navigation` individually inspected all **12 desktop originals**, `/root/lifecycle_review` all **12 phone originals**, and root the four full-page originals. Five native/Vue card pairs per width retain matching actors/data, authorized images, visible information and reachable controls at **1280px/390px**. No unexplained difference was found in these **24 English originals**. Required locale/Refresh controls, deliberate current search focus and native one-time setup flash remain explicit differences. This does not certify unseen actors, locales, dialogs, viewports, PDFs or external providers. |
| Engineering/documentation | The complete 443-source declaration/DBAL/session inventory and all seven task-owned source readability files report zero findings; whitespace checks pass. Independent/root semantic review checks actual shared adoption and purposeful comments. Production freeze/amendment checks are clean; the live advisory report has no broken link, metadata, path or classification finding and retains its existing unregistered source fingerprint. |

Three broad database-free attempts did not complete. The first parallel and later one-worker attempts exceeded
the development-runtime fixture's unchanged 30-second deadline; another parallel attempt stalled without a final
result. The owned parent/worker processes were stopped after progress ceased. Its focused final run passes
unchanged, as do the 394 relevant cases above. The cause of the broad-run stalls is not established; this receipt
does **not** call the full quick suite passed. Intermediate test/compiler failures and stopped attempts remain in
the ignored logs. No existing runner configuration, deadline, retry policy, native source or dependency was changed.

P10 is complete within these source and finite verification boundaries. P11 acceptance actions, default routing,
publication, native retirement and deployment remain separate maintainer decisions.

## Full implemented-scope review and migration readiness (2026-10-22)

This review compares implemented P0–P9 with the original baseline and dated decisions, rather than treating the
latest source or passing tests as design authority. The original full-application vision is not complete: P10
cross-application integration and P11 cutover/publication/retirement remain explicitly separate phase contracts.
No matching P0–P9 obligation found in this review is relabeled future work. Repository decision records establish
the recorded authorization history; they cannot independently reconstruct every historical conversational approval.

Independent source review by `/root/shared_architecture`, `/root/docs_decisions` and `/root/parity_review`, followed
by root review, found no additional unauthorized architecture or technology departure in the inspected implemented
scope. Vue/TypeScript, Vite, Router, Query, i18next-vue, app-owned controls and generated OpenAPI/Ajv consumers retain
their selected responsibilities. Matching Vue consumers actually adopt shared presentation and behavior owners:
list/detail reads, commands/recovery, entry/creation, metadata/settings, fields/files, headers, dialogs, notifications
and lifecycle controls. Feature-specific finance, survey, ride and recommendation semantics retain their own owners.
The reviewed complex paths document admission, draft lifetime, ordering and failure recovery; automated readability
checks complement this semantic review rather than proving maintainability on their own.

Both frontends continue to reuse existing backend/domain/controller/DBAL operations and catalogs. The recorded
native-isolation decision deliberately preserves separate native presentation code and shared matching Vue owners.
That temporary presentation duplication is authorized and remains a cutover retirement obligation, not permission
for copied backend logic or parallel Vue implementations. No native or application-runtime source changes were made
by this review. Previously authorized native creation-return changes remain part of the dated comparator exceptions.

The review corrected factual documentation drift in the existing pilot reference, coverage map and staged guides.
Overview's schedule consumers are now explicit. Finance guidance distinguishes native reload/recovery helpers from
Vue's adopted in-place command, ledger, invoice, coverage and uncertainty owners, and retains accepted command-input
precision and generated catalog ownership. The existing replacement manifest maps each new fragment exactly;
its immutable baseline, protected inventory and prior reconciliation receipts remain unchanged. DEC-006 marks P6/P9 integration as implemented
without erasing its original future-target wording. The single staged contribution playbook remains the next-slice
guideline; no competing guide or documentation destination was introduced.

The full E2E run exposed two verification defects: an early native Add-dialog action and an obsolete P8 assertion
for a link replaced by P9's in-place preview. The first now waits for the actual post-read rendered signal while
retaining overlap/cancellation/persistence assertions. The second verifies real preview readiness, cancellation,
the retained document and unchanged saved shares. Neither weakens deadlines or repairs native behavior. The actual
native early-open race is independently reproduced and remains openly recorded as `IMP-086`; native preservation
excludes its repair here. Vue already gates the editor on its admitted recommendation workspace.

The generation investigation adopted an invocation-local cache of successfully prepared output directories.
Writes stay ordered, check mode stays read-only and failures retain their owning artifact. The subsequent cleanup
correction retires obsolete direct browser validators only after all current artifacts are written, checking the
generator banner, regular-file ownership and physical directory containment. Current case-only filename aliases,
foreign files, links and nested trees are preserved; redirected browser directories are rejected before publication,
and check mode reports obsolete outputs without mutation. Real regeneration removed **12 obsolete files**; all **1,116 current artifacts** remain
byte-identical. The real-compiler lifecycle regression and existing two-clean-tree comparison pass. A compiler-option
experiment changed diagnostics and was not adopted. These are bounded tooling changes, with no API or application
behavior change.

All **539 distinct PNG images** in the **1,108 current captures** were actually inspected: the initial reviewed
hash set plus two independently inspected 244-image partitions account for every original and verified duplicate.
They cover the available header/calendar/Event, identity, Overview, Packing, Drivers, Survey, Activity and Finance
states, including renewed Finance captures. Both current one-page PDF variants were rendered and independently/root
inspected. Root also inspected complementary English/German desktop/phone Finance originals and the native failure.
The image inventories and hashes under ignored `artifacts/frontend-review-20261022/` identify the exact files.
No additional unexplained Vue discrepancy was found in this captured set. Unpaired native references, initial
failure captures and intentional local table crops do not independently establish paired Vue parity or reachability.
This complete capture inspection still does not certify unseen viewports, actors, locales, browsers or long PDFs.

Current plans, staging and review records remain active migration material under the existing retirement inventory.
Deleting them before authorized cutover would discard still-needed contracts and reconciliation inputs. Frozen
production guides remain unchanged; preparing and reviewing staged replacements does not publish them. Existing
excluded backend/native defects retain their central owners and explicit dispositions, without new inferred deferrals.

The renewed checks use Node.js **24.15.0** and independently verified MariaDB **10.11.14** disposable schemas with
strict SQL behavior and exact per-schema grants. The pre-existing local database is not reset. Logs, reports,
case identities and image hashes remain in ignored `artifacts/frontend-review-20261022/`; subsequent scoped loader
diagnostics and engineering receipts are in `artifacts/frontend-reconciliation-20261022/`. Final normal-run,
generation and completed-cleanup receipts are in `artifacts/frontend-test-cleanup-20261022/`.

| Verification | Actual result and limit |
|---|---|
| Build and compiler | The full server/native/Vue client/SSR build and test compiler pass. All **1,002** distribution files are byte-identical before and after the supported-runtime rebuild. |
| Database-free checks | The normal **88-file run passes all 1,881 cases**, including all ten generation cases. Every existing deadline remains: the future-contract and two-clean-tree cases retain 60 seconds, and the new cleanup lifecycle case retains 30 seconds. The earlier broad-run timeouts and intermediate two-case failure remain historical failures with their corrections below. |
| Persistence/HTTP integration | The final normal **29-file run passes all 521 cases**, including all twelve profile-administration cases, in 403.40 seconds. Preparation, assertions and deadlines are unchanged. `TEST-FRONTEND-PROFILE-PREPARATION` closes on this executed evidence; earlier 509-pass/twelve-unrun and isolated-timeout checkpoints remain historical failures. |
| Built client browser | All **49** distinct cases have a passing result across the broad run and unchanged one-case renewal after a closed-browser timeout. The broad run itself had 48 passes and one failure. |
| Built-application E2E | All **255** distinct cases have a passing result across the broad run, corrected two-case renewal and separately configured disabled-authentication run. The broad run itself had **252 passes, two failures and one configuration skip**; case-identity reconciliation retains those facts. No assertion deadline was increased. |
| Engineering/documentation | The global declaration/DBAL/session inventory covers 443 sources with zero boundary findings; the separate scoped 175-file readability check covers 586 nontrivial operations with zero findings. Independent/root review checks actual sharing, comments and boundaries. An unrestricted all-source readability scan reports 371 comment and eight nested-anonymous-operation findings outside that 175-file scope; this review makes no code changes to those paths. Production freeze and amendment checks report zero findings; the live advisory report retains only its existing unregistered source fingerprint, and Help checks are clean. |

Independent comparison reproduces all 379 broader readability findings against identical operations and rule
conditions in both original source baselines. They are inherited findings, not newly introduced migration findings;
this review neither repairs them nor supplies separate cleanup authorization.

The reviewed architecture and current shared owners support subsequent authorized migrations without another
foundation redesign. The twelve-case integration blocker is now resolved through the normal runner; no implemented
pilot obligation found by this review is deferred. This scoped readiness finding retains the finite visual/E2E
evidence above and does not approve P10, P11, publication, cutover or unseen behavior.

An unchanged filesystem diagnostic records 192 timed temporary-file renames with **100.759 seconds cumulative
elapsed time** in a **105.448-second** run; all measured asynchronous writes total **460 milliseconds**. The separate
parent-only CPU profile is approximately **95.7% idle**. Independent repository/OS-temp, synchronous/asynchronous,
extension and content probes reproduce the cost. Additional move probes narrow it to the replacement-enabled host
file-move path used by Node; the responsible operating-system component remains unknown. Security software was not
identified as the cause and its settings were not changed. A diagnostic native-loader configuration for already-built
SSR modules still leaves all twelve administration cases unrun at the unchanged hook deadline, and its workflow
worker exits unexpectedly after three passes. That earlier experiment is not adopted.

The accepted correction uses Vitest's public fork-worker extension on Windows with its optional filesystem handoff
disabled. Transformed source uses the existing IPC channel; fork execution, mocking, default file isolation,
two-worker concurrency, guarded database ordering and all existing deadlines remain. Linux retains threads. A
matching factory/worker identity also preserves explicit non-isolated reuse: 49 cases, including hoisted mocks,
pass in one process. The focused filesystem trace records zero module-handoff renames, rather than merely faster
renames. Atomic publication remains appropriate wherever file transport or persistent caching is used. The public
extension API is experimental and must be reviewed on Vitest upgrades; IPC trades temporary file copies for message
serialization and memory. No dependency patch, application import bypass or allowance increase was adopted.

An intermediate full renewal passed 1,879 cases and failed two generation cases: a Redocly child exited with native
code `0xC0000409` after printing successful lint, and the future-contract fixture exceeded its 60-second limit.
No matching owned-PID fault record established the native component or proved an upstream cause. The generator now
disables Redocly's documented optional telemetry/update checks only for its actual lint/bundle children, retaining
their arguments, validation and fatal exit handling. Controlled lint/bundle calls pass in 0.721/0.602 seconds. The
future-contract case now compiles the complete contract with its future additions once, preserving every baseline
and future positive/negative assertion and both actual generated runtimes. Its focused renewal passes in 21.459
seconds under the unchanged 60-second limit. No runtime/dependency upgrade, retry or compiler-option change was made.

Completed, ownership-checked cleanup removed over **2.7 GB** of obsolete generated previews, inactive repository-owned
Vitest and generation-fixture temporary roots, duplicate packaged dependency trees and stale diagnostics. Interrupted
workers and asynchronous teardown abandoned after timeout can leave roots despite fixture `finally` blocks;
repeated previews and packaged dependency copies had also accumulated without retirement. The eight additional
generation roots had exact repository-file identity proofs; their one dependency junction was unlinked separately.
Two empty roots without surviving ownership evidence were preserved. Current runtime/generated/build outputs, visual receipts, authorization receipts and
still-needed historical source/lockfiles were retained. The staged testing guidance now requires owned fixture cleanup
after child completion and retirement of superseded preparations/dependency copies, without a global temporary-file
sweep. The generator itself now prevents the observed obsolete-validator accumulation. No native/backend cleanup or
new infrastructure gate was introduced.

At the earlier October 22 review checkpoint, two untracked JavaScript test files appeared under `tests/frontend/`:
`frontend-drivers.spec.js` and `frontend-event-organizer.spec.js`. They were preserved at that checkpoint. Their
creator remains unestablished; no root/delegate command was identified as their emitter. Both files were absent
and the working tree was clean at the start of the subsequent reconciliation at HEAD `0d1c1c0`. The earlier
763-input preparation receipt includes both paths and therefore describes older source membership; its input
identity does not establish readiness for the current tree. Previously reviewed guide bytes were unchanged.

## P9 calculation, settlement and output implementation review (2026-10-22)

The maintainer's [explicit full P9 instruction](FRONTEND_FOUNDATION_DESIGN.md#explicit-p9-implementation-trigger-2026-10-22)
authorizes all three packages under the existing parity, approval and shared-owner rules. P9 is implemented. No
policy/design override or additional approval is inferred: P10/P11, excluded general backend remedies, native
frontend changes, cutover, production-guide publication and deployment retain their separate boundaries.

`FinanceCalculationReview` obtains a fresh generated decimal-string preview from the existing calculation owner.
It keeps the reviewed revision through background reads, checks the same settings/assignment/adjustment drafts as
native, and consumes apply authority after an attempt. A stale rejection requires another explicit preview.
`FinanceSettlement` captures the signed saved payer row; the shared command owner protects pending work, confirmed
saves with failed following reads and unknown delivery. `FinanceShares` retains only display identities while
showing current admitted financial values. Status filtering/order changes wait for explicit Refresh or controls;
Refresh preserves the current page and acknowledges unchanged results. Matching ledgers and confirmations share
their message, footer and presentation owners.

`FinancePoolOutputs` owns separate rollback and later-email intents, including the existing external-change
rollback result and eligible-recipient count. Current saved totals/rows are visible during unknown-result
inspection before acknowledgement; inspection never replays a write. Both ordinary PDF variants use the complete
authorized saved ledger, independent of browser filters. The existing EventPool operations remain the native/v1
business owners; arithmetic, signed rounding/credits, recorded transfers, mail/PDF English output, proof retention
and per-method grants remain unchanged. Private participant projections do not acquire organizer data.

Executed evidence:

- `npm run build` passed; the final `npm run build:frontend` passed after the scoped preview-layout correction.
  Frontend/client/SSR, server and test TypeScript checks passed.
- Generated-contract and genuine HTTP/controller/ORM finance checks passed **18/18** on the inspected disposable
  `surveyor_test` target. They cover all six new operations, bodyless rollback/notification, stale calculation,
  signed transfer carry, independent grants, parent ownership, output data and notification choices/counts.
- Mounted calculation/output and settlement checks passed **23/23**. Broader existing finance/allocation/review,
  settlement, presentation, mail and PDF checks passed their **200** cases across the focused run and corrected
  organizer-projection rerun. That assertion now checks actual Vue financial controls instead of the retired link.
- `npm run e2e -- tests/e2e/frontend-finance-p9.spec.ts --workers=1 --reporter=line` passed **8/8** against the
  built application and fully prepared disposable `cgd_e2e` target. Real workflows cover initial close, two-browser
  stale previews after settings/payment changes, signed payment/refund recording and reversal, stable filtered rows,
  carried transfers, rollback, dropped committed-response inspection without replay, both PDF downloads and private
  proof/history/breakdown access. Requests remain in the same document where the workflow requires it.
- `npm run check:development` reports **0 findings** across the full authored inventory and all 14 touched source
  files in its readability scope; `git diff --check` is clean. The migration documentation boundary reports **0/0**.
  Advisory documentation/Help reports have no task-created location, metadata, link or Help-authoring finding; the
  existing unregistered source fingerprint remains advisory and was not rebased.

Independent source review by `/root/p9_contract_review` and `/root/p9_settlement_ui`, followed by root review,
checked actual shared adoption, original decision provenance, private reads, cancellation/locale fencing, draft
ownership and no-replay semantics. Source review corrected the initially broader draft guard and made unknown
calculation/output recovery expose actual saved state. Original EN/DE desktop/phone captures exposed overlapping
German preview headings; the preview now uses the existing wide dialog and locale-neutral heading wrapping, with a
painted-text containment assertion. The retained ready-notice state follows the approved common overlay design;
separate resting captures explicitly dismiss that receipt to expose the underlying instructions and totals.

The final visual set contains **48 originals** across English/German and 1280px/390px: native/Vue ready-notice,
resting preview, expanded breakdown/example, ledger, refund confirmation and notification states. The independent
reviewer inspected each original; root inspected representative final originals. Both real one-page PDF variants
were rendered and independently/root inspected: all three signed payer rows remain despite a browser filter, and
only the full variant includes the example. These are finite fixture comparisons, not exact-pixel certification,
long/multipage PDF acceptance, full-pilot acceptance or SMTP-delivery proof. The system runner deliberately uses a
refused local mail socket. Runtime English/German Help and staged contributor guidance match the implemented P9
controls; frozen production/native guides and native frontend sources remain untouched.

## Cross-area correction and scoped verification (2026-10-22)

The maintainer directly instructed implementation of the second review's three bounded fixes. `ActivityRequirements`
now initializes its independent draft from an already admitted cached configuration, retaining its existing dirty-value
guard. Actual parent/Rules-child tests cover fresh-cache re-entry without another GET, stale re-entry with an equal
successful GET, saved controls and live coverage, and private draft retirement when its actor is released.

Personal Overview now adopts the existing Event/standalone Activity schedule controls through its shared card,
region, generated feature operations and lifecycle owner. Its projection exposes native schedule-management state
only to admitted managers. The shared lifecycle owner also selects the meaningful scheduled Activity restore
warning for Overview and Settings, while preserving Event's fuller parent/child warning. Event child cards retain
that shared archive/restore owner; linked Activity has no independent automatic schedule.
Resume retains confirmation, pause remains immediate, and existing command/read recovery retains its ownership.
No recorded exception authorized the omitted controls or warning; this restores the established parity contract.

Event duplication verification now starts from actual saved attendance in both real-ORM and built-application
assertions. The destination excludes attendance while the source retains the same saved registration. Existing
creation, duplicate, registration and persistence operations remain unchanged. The coverage map's earlier
empty-source limitation is removed; the new proof does not establish every duplicate grant or deletion race.
The staged contribution guide records cached draft initialization and the actual Overview automation consumer;
its existing ownership/preservation rules, mapping operations and immutable reconciliation inputs are retained.

Current checks use official Node.js 24.15.0. Persistence and built-application selections use independently verified,
exact-grant disposable MariaDB 10.11.14 schemas with strict SQL behavior.

| Verification | Actual result and limit |
|---|---|
| Build and test compiler | Full server/native/Vue client/SSR build and asset copying pass; the final test compiler passes with current generated inputs. |
| Mounted production consumers | All 156 selected current cases pass across retained receipts: 70 Activity (14 requirements, 27 parent, 29 recommendation), 77 refresh/navigation and nine shared presentation cases. The two cached re-entry regressions failed against earlier source; the initialization fix and actor-retirement assertion pass. These mounted cases substitute HTTP delivery, without persistence or browser-layout certification. |
| Real-ORM integration | Both selected suites pass all 37 cases: 20 archival and 17 Event, including actual schedule capability/privacy projections and nonempty-source attendance duplication. Direct controller/ORM calls do not establish Express or browser behavior. |
| Built application | Both final Overview workflows pass at 1280px/390px; the strengthened Event duplication and retained Event Settings workflows also pass. Actual menus, native/Vue browser confirmation text, cancellation, single command dispatch, persisted flags and retained Vue documents are asserted. Restoring the archived Activity pauses its running schedule; linked Activity exposes no independent schedule. |
| Engineering checks | The complete eight-file executable source scope has no findings; declaration, DBAL and session inventories retain their global scope. Independent source review checks actual adoption and preservation beyond these measurable rules. |

Independent nonauthor review accepts all 16 final original menu captures: eight native/Vue pairs at 1280px/390px
for flat Event, scheduled standalone Activity, expanded Event parent and linked Activity child. Root separately
reviews four original representatives. Menu text, hierarchy, actions and states are readable and equivalent within
these crops; measured browser assertions cover viewport placement. These are menu captures, not whole-page or
browser-chrome images. Browser-owned confirmations are verified through actual dialog events.

Current source/assertion boundaries belong to the [coverage map](TEST_COVERAGE.md). These scoped corrections do not
renew the earlier full-pilot matrix, start P9–P11 or authorize publication, default-route cutover, native removal
or deployment. Native frontend, shared business/DBAL owners and frozen production guides remain unchanged.

## Finance readiness correction and scoped verification (2026-10-21)

The maintainer directly instructed implementation of the preceding review plan. The existing query-key owner now
uses `eventKeys.financeFamily` to match translated Finance audiences and descendants, without a copied Finance
tag or fixed tuple position. The real locale-change consumer retains its actor boundary and excludes unrelated
Event machine projections. The localization reference now identifies Help, Overview and translated Event Finance;
the refresh reference distinguishes implemented P7/P8 from later P9 calculation/settlement. Existing staged
contribution guidance already states these rules and requires no new owner or amendment.

The existing P8 application suite now compares native and Vue invoice acceptance, submitted rejection, accepted
correction/rejection and closure at 1280px/390px. Both renderers inspect the same saved invoices and actual fields,
confirmation facts and Back-to-edit values. Canceled inspections leave saved data unchanged and send no command;
explicit Vue confirmation sends one generated command without replacing the document. Saved results retain the
original invoice amount, description and proof identity separately from effective corrections/rejection.
The desktop fixture retains an OPEN pool; the phone fixture establishes a CLOSED pool and a nonzero saved payer
balance marked paid through existing native operations before accepted changes. Both final reviews expose its
existing recalculation warning. The assertions preserve saved share/settlement presentation after corrections or
rejections while allowing the current pending-recalculation flag to change. This fixture setup does not exercise
or add a Vue P9 calculation interface and does not certify raw payment/refund transfer history.

Current checks use official Node.js 24.15.0; built application workflows use an independently verified, exact-grant
disposable MariaDB 10.11.14 schema with strict SQL behavior.

| Verification | Actual result and limit |
|---|---|
| Build and test compiler | Full server/native/Vue client/SSR build and asset copying pass; `typecheck:tests` passes. |
| Mounted production consumers | All 123 Finance, refresh/navigation and command-recovery cases pass, including both new audience cases exercising actual locale-command cancellation/invalidation across Events and actor scopes. |
| Matched built-application review | Both final 1280px/390px invoice-review cases pass together in 1.4 minutes, including the phone CLOSED-pool fixture with a nonzero saved balance marked paid, against the integrated backend and prepared database. |
| Retained Finance workflows | All nine existing P7/P8 built-application cases pass together in 1.8 minutes, including uncertainty, stale review, allocation/coverage and German 320px/390px workflows. |
| Advisory documentation review | 1,842 links checked in 88 Markdown files; no broken local links or metadata, command or path errors. The existing unregistered source fingerprint remains visible; production-freeze and amendment-boundary checks report zero findings. No baseline was changed. |

Independent nonauthor review accepted all 40 new original scenes: 38 native/Vue English workflow
captures at 1280px/390px and two German acceptance captures at 320px/390px. Unchanged originals were checked for
byte identity against their individually inspected versions; changed final originals were reopened at
original resolution. Root independently inspected final confirmation representatives. The selected information,
warnings, values and actions remain readable within those captures. Native table crop edges and offscreen controls
are not established by an image alone; no complete actor/state/viewport/browser cross-product is certified.

The [coverage map](TEST_COVERAGE.md#finance-family-ownership-and-matched-review-assertions-2026-10-21) owns exact
source/assertion boundaries. These scoped results do not rerun or replace the earlier whole-pilot matrix below,
certify every actor/state/browser/viewport combination, or establish live mail/provider delivery. Native frontend,
backend business operations and frozen production guides retain their existing boundaries. P9–P11, publication,
default-route cutover, native removal and deployment are not started by this correction.

## Full-pilot correction and decision adoption (2026-10-20)

The maintainer directly authorizes the full review's corrections and equivalent issues across all migrated areas
back to the original baseline. The latest R1 question should not have reopened the repeatedly approved native
isolation boundary; the existing decision is reaffirmed, not newly selected. The
[dated correction](FRONTEND_FOUNDATION_DESIGN.md#reaffirmed-isolation-and-authorized-full-pilot-correction-2026-10-20)
records the actual decision-adoption failure and authorized scope. The contribution handoff now requires tracing
existing decisions and their adopted callers before classifying another generic requirement as unresolved.

Finance money, factors and numeric record identifiers use the original decimal-string wire choices. The
[active decision](../decisions/DEC-006-FRONTEND-FRAMEWORK.md#approved-finance-wire-correction-2026-10-20) preserves the
original rule, erroneous future-work account and the explicitly approved command-precision correction. Shared
controller/Joi normalization, saved financial presenters, calculations and persistence remain the same owners.
The existing compatibility family and update recovery protect older loaded clients; no substantive need for JSON
numbers was found and no speculative financial-calculation defect is asserted.
The same baseline-wide review restores Activity role/override identifier strings and arrays through existing
versioned projections and one requirements argument adapter shared by local Analyze and Calculate. Native/Joi
normalization, the pure engine and DBAL retain their numeric internals. Matching browser entity-image and Finance
proof envelopes now adopt the existing `createMultipartForm` owner with an explicit binary-part name; feature
validation, requiredness and original file lifetimes remain separate.

The same full review restores participant PDF export for an actor with the native combined export/participant-read
grant but no administration grant. The versioned full-read/settings admission now includes that existing capability,
and `EventSettings` supplies the existing shared Actions export link. The retained native PDF route, combined
permission check and existing localized participant-PDF label remain authoritative; no administration grant is added.
The final matched Packing review also restores the native shared-assignment switch's explicit `autocomplete="off"`
choice in its existing Vue owner. Browser restoration, state and command behavior keep their established boundaries.

`FormField` owns explicitly lexical numeric controls while retaining its default Vue directive for deliberately
normalized consumers. Matching Finance, Event, Activity and creation fields adopt that shared option. The staged
guide withdraws its earlier assurance that a DOM-string setter alone preserves number spelling. It also reconciles
Finance's translated query family and the shared region/dialog financial text palette. The earlier `IMP-084` report
remains the single defect/history owner rather than a reason to leave equivalent migrated fields unfinished.

Independent original-image review also found selected Survey answer labels painting over sticky participant names.
The existing shared Vue sticky-column style now layers both ballot/result identity cells above those labels;
the existing scrolled-table journeys add actual painted-glyph hit checks in English and German. This applies the
already approved readable-interface decisions. It is separate from whole-document pan (`IMP-075`); the unchanged
native counterpart is recorded once as `IMP-085`, with no migrated correction deferred to future work.

All eleven English and eleven German runtime articles were inspected against current component/catalog owners and
their retained business baseline. Corrected Help describes independent settings saves and close/discard consent,
refresh without resubmission, invoice-history inspection and explicit uncertainty acknowledgement, and the actual
German controls across identity, Overview, Events, Drivers, Surveys, Packing and Finance. The Finance guide retains
its explicit separate **Calculation & settlement** destination; its native calculation, email and PDF instructions
keep their actual English labels. Native flat Help, native/unaffected image bytes, declared heading anchors and
excluded backend remedies retain their existing boundaries. Source reconciliation is not a new running-browser receipt.

The bounded existing Help generator now resolves the Survey diagram's control/example labels from the same locale
catalog as its actual controls, and its fictional SSR session supplies the current generated deployment contract.
Only the German Survey figure is regenerated (`933dbc72ab2b11d5a8e374644e9f117da3fabac903cd3e79835c1619f84d1888`,
1440 × 1252); all eight other native/localized PNGs retain their bytes. Author and independent nonauthor opened the
full image and browser-scaled 768px/298px originals; root reviewed full/298px originals. They confirm correct
first-occurrence/recurrence meaning, German labels and no clipping or overlapping text. The phone export is a small
overview; fine prose still uses the adjacent text and existing full-size link. This is an authored-diagram inspection,
not a new application-browser parity result.

Current correction checks use official Node.js 24.15.0 and an isolated MariaDB 10.11 database where a real database
is required. They are separate from the earlier finite receipts below.

| Verification | Actual current result and limit |
|---|---|
| Build and engineering | Full server/native/Vue build and the final client/SSR rebuild pass. Application and test typechecks pass; the engineering review covers 439 authored sources, 11 DBAL files and 32 reviewed operations with zero errors. Native frontend, DBAL and frozen production-guide diffs remain empty. |
| Unit and mounted coverage | The 86-file quick selection reports 1,840 passes and two new Event fixture-expectation failures. After correcting those expectations, the affected three-file selection passes all 36 cases. All 35 content-loading cases and nine generator cases run and pass within their original budgets. This is not a uniform rerun of the complete quick selection. |
| Shared business integration | All 50 cases in the three real-ORM Finance/Activity/Event specifications pass, including decimal transport, string identifiers, existing business validation and restricted participant-PDF admission. |
| Genuine built-application E2E | The full 243-case selection reports 239 passes, three failures and one expected disabled-authentication configuration skip in 23.4 minutes. Two failures identify the Packing autocomplete omission corrected above; one is an unexplained Windows worker exit (`3221226505`, 0ms, no assertion result). All three pass after the final rebuild in a separate 35.1-second renewal. The skipped configuration case passes separately with local login and OIDC disabled in 21.2 seconds. All 243 distinct cases therefore have a passing execution across these receipts; the broad run itself is not all green, and no worker-crash cause or repair is established. |
| Isolated built-client browser checks | All 49 cases pass against the final rebuilt client in 44.7 seconds. Their HTTP substitution keeps this a client check rather than genuine application/database E2E. |
| Documentation tooling | All 69 generic tooling and 26 boundary-tool cases pass. The Help report checks 32 Markdown files, 587 links and nine images with zero errors or warnings. Live-source and assembled-guide advisory results remain separate from semantic review; the existing unregistered source fingerprint is not silently rebased. |

The existing browser journeys exercise the final lexical controls, deliberately normalized Quick Add, generated
decimal contracts, localized Finance palette/history, restricted Event export, complete Packing controls and shared
Survey sticky-name paint behavior. Independent reviewers opened originals individually at original resolution:
243 Event/Finance/Drivers/Survey images, plus 186 Help/shell/identity/Profile/Overview/Packing and entity-header
images, including the 23 fresh complete Packing renewal images and two earlier failure diagnostics, and all 130
Activity/calendar images (36 calendar, 36 advanced and 58 basic/settings). These are 559 distinct current/renewal
original files, separate from earlier capture inventories. Their actual
scope includes desktop/mobile, English/German and the named saved/loading/stale/uncertain/draft states; it does not
establish every theoretical actor, viewport or interaction combination. Root independently reviewed changed
representatives and current shared-owner adoption. `IMP-084` closes by the implemented and verified shared
correction; `IMP-085` retains only the unchanged native Survey defect under the reaffirmed isolation decision.

Ignored `artifacts/frontend-correction-*` logs, XML/reports and original captures retain the executable evidence;
the [coverage map](TEST_COVERAGE.md#full-pilot-numeric-and-documentation-correction-2026-10-20) owns source/assertion
locations. No assertion, deadline or native business behavior was weakened to obtain these receipts. No publication,
cutover, P9–P11, native removal or deployment follows from this correction.

## P8 organizer and allocation implementation review (2026-10-20)

The [direct P8 instruction](FRONTEND_FOUNDATION_DESIGN.md#explicit-p8-implementation-trigger-2026-10-20) activates
both packages. Organizer pool creation/settings, submission access, optional-proof expenses and invoice review now
have separate Vue command owners. Allocation, factors/exemptions, signed adjustments and participant/organizer
coverage use independent forms. The generated transport adapters call the existing EventPool controller and shared
invoice/pool/takeover operations; no business engine, DBAL, schema or native frontend implementation was replaced.
P9 calculation, settlement and outputs retain the explicit **Calculation & settlement** destination.

Root and independent nonauthor review traced the native comparator, original decisions and amendments, actual
Event consumers, generated contracts, permissions/private reads, file attribution, draft lifetimes and shared
ownership. Matching creation/allocation controls adopt `FinanceEnrollmentFields`; numeric finance inputs adopt
one scroll-protection helper. Existing dialogs, fields, feedback, history and coverage remain shared. Future-default
enrollment stays independent of selecting all current participants. Optional NEW invoice corrections retain the
native acceptance validation boundary; retroactive corrections/rejection retain their separate captured revision
and final review. Original evidence and recorder/paid-by attribution survive correction.

Sibling saves and refreshed props preserve unfinished fields, lexical numbers and selected proof. Confirmed writes
stay confirmed after a failed follow-up read. An uncertain expense remains locked until fresh invoice-history
inspection and explicit acknowledgement, without automatic replay. Filtering keeps factor rows mounted and reveals
an invalid row before validity focus. Adjustment removal retains an unfinished addition. Participant coverage fixes
the payer to the admitted registration; applied closed-pool coverage stays read-only while pending organizer inputs
remain separately editable. These source changes leave saved shares and transfers for P9 recalculation.

Final permission review found an added profile requirement on methods whose native API accepts a public management
grant. Two attempted corrections were rejected before applying by automatic approval review. The maintainer then
received the complete separate requests in the final conversational message and explicitly approved both R1
(pool/allocation) and R2 (invoice review), followed by full implementation and review. The
[dated amendment](FRONTEND_FOUNDATION_DESIGN.md#approved-p8-public-method-parity-2026-10-20) preserves that provenance
and the original October 12 choice. The implemented ten methods now honor existing public management grants.
Protected reads, organizer expenses, retroactive review and participant operations keep their existing identity
requirements. Public writes expose no private finance audience and retain origin/context/CSRF protections.

The subsequent full P8 review found two form-lifecycle defects and corrected them before completion. A confirmed
save followed by a failed read could restore old settings, factors or coverage on Close/reopen and undo the saved
change in a later request. Existing form owners now restore their confirmed/admitted saved-field baseline instead.
Coverage keeps only the current payer's baseline; switching after a failed saved read requires protected fresh
inputs, preserving the payer/selection on failure without replaying coverage rules in another model. Assignment
roster changes during editing or the pending saved read now reconcile stable identities, preserve surviving lexical
factors and add admitted participant defaults. Canonical saved all-membership and discarded unsubmitted values
remain distinct. Root and independent nonauthor review inspected these final corrections and actual consumer adoption.

The final full build passed, including generated inputs, server, native client, Vue client/SSR and copies. The test
TypeScript graph passed again after the final test-only notice step. All 34 selected mounted finance cases across
three files passed. The expanded real-persistence/HTTP suite passed all 12 cases, including native public-method
comparison, all ten approved v1 grants, missing-grant rejection, authenticated context/CSRF checks and mandatory
identity on protected operations. Earlier 11-case and native-only receipts retain their earlier scope. Database
work used verified guarded disposable schemas, schema-scoped credentials and serialized ownership.

All seven selected built Chromium workflows passed again on the final build (three P8 and four retained P7).
They exercise real routes,
middleware, sessions and persistence: optional proof and attribution, captured/stale review and cancellation,
submission-access confirmation, factors/zero/exemption, signed adjustments with retained input, exact-payer editing,
participant coverage, applied versus pending coverage and a dropped committed expense response without replay.
Selected desktop/390-pixel and German phone scenes verify in-document operation, reachable dialog controls and
numeric wheel protection. Root inspected fresh matched settings/allocation originals and German/expense phone
scenes. The desktop settings selector's clipping and missing pool context were corrected before the final build.
The final run's ignored inspection manifest preserves all 56 original captures (13 P8 and 43 P7) with individual
identities and recorded inspection scope. Earlier seven-workflow and allocation-only manifests remain separate
historical evidence rather than being relabeled as this final build.
Independent review opened all 56 final originals individually at full resolution and found no remaining visual,
information or workflow defect within the declared scenes.

An earlier final renewal passed six workflows and failed the allocation case when the approved shared success
notification intercepted the next mobile row action. Inspection confirmed its ordinary enabled dismissal control;
the test now verifies and dismisses that specific success notice before continuing. The same seven workflows then
passed with the original timeouts and all persistence, draft, removal and same-document assertions intact. No forced
click, hidden notification, application-style change or command replay created the pass. The failed run's original
artifacts remain preserved separately from the final passing captures.

Existing English/German runtime Help articles now describe these P8 controls, separate saves, review stages and
uncertain-expense inspection. Their headings/anchors, native provenance and P9 onward instructions remain intact;
the P9 destination is stated explicitly. Inherited P7 upload prose still mentions page reload/history navigation,
and untouched German history/status/P9 passages retain English labels. Those bounded content findings remain for
their respective authorized follow-up rather than being represented as corrected by P8.
The final engineering check reports 439 source files and zero findings; the production freeze/amendment guard
also has zero findings. Help authoring has zero errors/warnings, and the general advisory documentation report
retains only its existing unregistered-source-baseline finding.

Local execution used Node.js 24.13.0 and MariaDB 10.4.32; this does not renew documented Node.js 24.15.0/MariaDB 10.11
acceptance. The finite evidence does not establish exhaustive actor/state/locale/concurrency combinations, live
SMTP/inbox delivery, rendered PDF layout, hosted CI or deployment. Native isolation, excluded backend remedies,
P9–P11, cutover, native retirement and production-guide publication retain their separate boundaries. The
[source/assertion map](TEST_COVERAGE.md#p8-organizer-finance-and-allocation-assertion-map-2026-10-20) owns the
current executable coverage; earlier receipts below keep their original scope.

P8 is implemented under its phase contract and explicit amendments. The full known-criteria review covers approval
provenance, functional/visual parity, localization/responsive usability, actual modular/DRY adoption, readable
contracts/comments, controller/DBAL separation, generated inputs, privacy/identity, drafts/files and honest command
completion/recovery. No task-owned finding or approval decision remains open within this declared scope.

## P7 finance implementation and scoped verification (2026-10-20)

The maintainer's direct instruction to fully implement P7 activates the existing finance phase contract. Event
detail/admin now compose separate personal/organizer saved projections, shared history/totals/signed ledgers,
applied versus pending coverage and lazy protected payer explanations. Participant invoice/proof submission,
revision-reviewed retraction and closing use the existing controller operations. Proof access and retention remain
independent of review status; organizer recorder and attributed participant remain distinct. P8 organizer/allocation
commands retain their working native destinations. No schema, migration, native frontend, default-route or publication
change follows from this instruction.

Root and independent nonauthor review traced actual Event adoption, privacy and denial retirement, generated
contracts, controller/DBAL separation, draft lifetimes and shared presentation ownership. Request-local formatting
extends the existing invoice presenters without changing their native English defaults or numeric decisions.
English frontend messages derive from the existing domain catalog through validated static generation; German
uses the same message contracts. The existing generation/watch owner tracks that source, including atomic
replacement. Matching finance consumers share history, ledger/footer, coverage, calculation and breakdown owners.
The final source comparison preserves searchable admitted context, unfiltered payer counts, tied-balance name
ordering, expanded coverage across paging changes, contextual actions and captured invoice identity in reviews.

Confirmed submission releases only completed fields/File; rejection retains their exact values. Transfer completion
cannot confirm persistence. An uncertain committed response stays blocked until fresh history inspection and
explicit human acknowledgement, with no automatic replay. A locale read retains the same cache-owned admitted
snapshot and mounted draft/File; commands wait for current-language confirmation. Denial retires all language
aliases of that private audience. Built testing discovered and corrected Vue's blur-time normalization of the
invoice amount through the existing field control slot; the amount now retains `013.50` exactly. The inherited
shared-control concern outside P7 is recorded once as `IMP-084`; inherited submission/proof cleanup limits remain
in `IMP-013`, without a backend repair or stronger lifecycle claim.

Executed checks passed: the full build and final affected server/client/SSR builds and typechecks, including the
full test TypeScript graph; 238 invoice
unit cases across seven files; 17 mounted finance cases; five real-persistence/HTTP finance cases; and three
selected catalog-generation/watch regressions (six other cases were not selected). The persistence suite includes
an actual competing pool closure under the root lock: submission returns a definite `409 RESOURCE_CONFLICT`
without saving an invoice. The organizer destination case passed again after its final anchor correction.

All four selected built Chromium workflows have passing receipts. The saved-ledger workflow is renewed on the
final frontend build; history, upload and coverage precede the final organizer-link/dialog-subtitle changes and
cover their unchanged behavior. Actual native organizer navigation and viewport assertions pass at both widths;
the organizer dialog identifies pool and payer, and mobile body scrolling reveals the final saved formula without
moving the Event page.
These runs cover real retained proofs, five history states, exact
draft/File retention through a held language read, transferred-versus-saved progress, dropped committed response
without replay, signed saved balances, settlement history, lazy private reads and applied/pending coverage.
Original native/Vue comparisons use 1280/390 widths, with selected German mobile and locale-transition states.
Root review inspected matched original captures. Independent review opened all 43 accepted originals at their
original resolution, including native breakdowns and the distinct upload/German surfaces, and found no remaining
visual, information or workflow defect within this finite scope.

Local execution used Node.js 24.13.0 and MariaDB 10.4.32, with database suites serialized against the verified
disposable `cgd_e2e` schema and schema-scoped credentials. It does not renew documented Node.js 24.15.0/MariaDB
10.11 acceptance. Engineering diagnostics and whitespace checks are clean; the production freeze/amendment guard
has zero findings. Advisory documentation reporting retains only the existing source-baseline mismatch.

These checks cover the declared P7 journeys, saved states and inspected surfaces. They do not certify exhaustive
actor/state/browser/locale/concurrency combinations, live SMTP/inbox delivery, rendered PDF layout, hosted CI or
deployment. P8–P11, cutover, native retirement and guide publication retain separate authorization. The
[source/assertion map](TEST_COVERAGE.md#p7-finance-source-and-assertion-map-2026-10-20) identifies the executable
boundaries; earlier receipts below retain their original scopes.

## Activity correction follow-up (2026-10-20)

The subsequent full review qualifies the earlier P0–P6 completion receipts with two frontend gaps: Activity can
retain the Participants selection after its last displayed participant disappears, and recommendation review can
select the wrong reciprocal move when several manual operations share the same two slots. The first gap is a page
selection defect; the second is reproduced against the existing frontend draft helper, not a demonstrated backend
application failure.

The maintainer explicitly instructs the correction plan and approves this review's R2 frontend pairing change,
including an explicit counterpart choice for ambiguous saved rows. The
[dated amendment](FRONTEND_FOUNDATION_DESIGN.md#approved-activity-review-pairing-and-available-tab-correction-2026-10-20)
preserves that scope and the original choices. Existing Activity page/draft/dialog owners implement the correction;
native sources and shared server operations remain outside it. `IMP-083` separately records the analogous server
blocking heuristic as a source-based P2 finding, with no claimed backend reproduction or authorized repair.

The existing Activity page now reconciles selection against its admitted tabs, preserving valid selections and
drafts while returning to Schedule when the selected panel disappears. Shared recommendation draft logic supplies
pair labels, review changes and removal; local pair identity stays out of server requests. Ambiguous saved moves
use the existing dialog and form owners for explicit counterpart choice, cancellation and stale-context checks.
Native frontend, backend business logic, contracts and schema remain unchanged.

Final build, client/SSR typechecks and test compiler pass. The quick selection passes all 1,797 tests across 81
files, including 27 Activity and 29 recommendation cases. On Node.js 24.15 and isolated disposable MariaDB 10.11.14
with strict SQL mode, the complete built frontend selection passes 183 of 184 cases with one configuration skip;
that disabled-authentication case separately passes 1/1 with `LOCAL_LOGIN_ENABLED=false`. All five new browser
journeys pass in the full selection. Scoped engineering review reports zero findings across 418 source files,
11 DBAL files and the four changed executable files' 14 nontrivial operations; whitespace checks pass.

Root and independent review individually inspected four chooser originals across the focused and full runs,
covering two captured states at English 1280px and German 390px: labels and actions fit without a confirmed visual
defect. These closed-select dialog captures do not certify the option popup, every viewport or every page state;
the approved new chooser has no native screenshot counterpart.
Browser assertions separately cover the new workflows. Current documentation has no broken link, metadata, path or
classification finding; its existing unregistered fingerprint remains advisory. Earlier runs and original-image
inventories below retain their own source scope. No task-owned frontend correction is deferred, and these checks
do not close the separately excluded backend finding or authorize cutover or publication.

## Current approved interface implementation review (2026-10-20)

The maintainer directly resolves the earlier R2–R7 questions and instructs implementation plus another full review
of all migrated modules against the original baseline and explicit amendments. The
[dated decisions](FRONTEND_FOUNDATION_DESIGN.md#direct-interface-and-shared-spa-decisions-2026-10-19) authorize complete
non-user UI localization, declared/validated Vue component messages, locale-neutral usability including English,
staged first-install reconciliation, integrated Refresh and common non-jumping SPA notices. The German-only R4
proposal is rejected; the broader locale-neutral direction is explicit. These are no longer pending decisions.

Functional interface parity means equivalent information, available actions and user steps. It imposes no exact
native pixels, DOM identifiers or internal names, and explicit requirements/approvals are exceptions by default.
The previous local feedback reveal rule is superseded. Meaningful wording, control constraints, accessibility,
business inputs, privacy, draft lifetimes and no-replay protection remain acceptance requirements. Old copied
restrictions and passing comparator checks cannot substitute for that review.

| Current boundary | Source adoption and evidence |
|---|---|
| Catalogs and component messages | Shared catalogs/generator/translator and RichMessage declare and validate component names across locale/plural variants. Actual Activity progress/hint consumers adopt them; scalar values stay escaped and source badges use catalogs. Independent source review accepts adoption. The original rich-slot deferral and missing-approval findings remain historical; current component/generation checks are included in the complete Vitest result below. This review verifies application-authored text; Chromium's own chooser/validation wording follows the browser language. |
| Authored participant fallback names | The final R2 source sweep found shared Activity presentation owners replacing absent names with English Participant/Profile labels before the versioned projection. Only versioned callers now request explicit fallback provenance from those same owners. One Activity presentation helper serves saved/live participant display and search, override labels/sorting, manual options and staged recommendation rows; literal user names remain data. Local staged provenance never enters command serialization. Independent review accepts the bounded source adoption and unchanged native payload defaults; the 20-case real-ORM selection and 62-case frontend/localization selection pass, including literal names, genuine absent stored names, locale switches and staged-row identity. |
| Localized Event date wording | The R2 sweep found Event summary, saved attendance, roster and registration-link formatting still following the browser language. Their existing presentation helpers and deadline display receive the reactive selected locale. The earlier R2-only correction preserved parsing, timezone/style options, invalid/absent fallbacks and represented values; its 50 mounted cases and rebuilt browser follow-ups pass within that scope. R10 below separately supersedes date-only calendar policy; deadlines and registration-link timestamps retain instant semantics. |
| Responsive presentation | Existing shared frontend styles own locale-neutral header/action/heading/label wrapping; both Rules workspaces adopt them. Final German mobile Event review also found an orphaned final letter in the roster action label. That existing totals/action row now adopts the common wrapping owner; both final built matched cases pass, and all 32 originals were individually inspected, including the complete readable mobile label and totals. Tables retain their columns and local scroll owners; the shared containment correction below adds no business operation, draft or authority owner. |
| Wide Survey document movement | Final baseline review reproduces native's 1111px/2001px whole-document horizontal travel in Vue at 1280px/390px despite working local table scrolling. IMP-075's earlier parity restriction had no separate defect-specific maintainer exclusion; direct R4/R6 supersedes it. The shared Vue table viewport now contains clipped absolute controls. Both rebuilt focused comparisons and the renewed full-system selection pass: all 16 English/German Vue width/travel samples fit the viewport with zero window movement and visible root overflow, while all 29 columns, sticky cells, final-choice label/keyboard interaction and unsaved ballot behavior remain usable. Twelve focused originals were individually inspected; renewed full-system captures remain separately inventoried. Native retains its measured defect and remains unchanged. |
| Initial Activity creation fields | The strengthened real basic-Activity browser journey exposed five initial-slot controls without associated visible labels. The R4/R6 correction composes their existing models/directives through FormField, adds the Remove control's localized accessible name and targets date labels at their actual inputs. Independent source review accepts preserved lexical capacity, constraints and draft ownership. Mounted cases and both rebuilt desktop/mobile comparisons pass, including real German locale selection through the mobile menu. IMP-017 and IMP-078 remain open for the untouched native implementation. |
| Approved saved-slot total | The maintainer directly approved R9 on October 20. The existing Activity badge now counts the admitted saved-slot array, independently of All/My/Open, including zero for an empty plan. Independent source/test review accepts the single-owner adoption; its focused mounted case passes with 24 cases filtered, covering distinct visible sets, retained Open selection through fresh data and GET-only reads. Both repaired desktop/mobile built comparisons pass on current source, with the total visible independently of filters; the unchanged native IMP-076 stays open. |
| Approved calendar-day policy | The maintainer directly approved R10 on October 20, as frontend work with at most minimal backend adjustment. One stateless browser-safe civil-date owner now supplies matching Event/Activity date-only labels and Activity creation/versioned weeks, superseding copied native shifts and separate browser/server algorithms. Independent source/test review accepts the actual callers, strict nullable parsing and feature-owned invalid/absent fallbacks, UTC stepping, padded year-1000 boundary and unchanged instant/deadline paths. Seven focused files pass all 111 cases across pure helpers, the retained native Pug oracle and mounted consumers. All 21 genuine ORM cases pass, including schema validation and unchanged saved dates/assignment/native inputs. Four built calendar cases pass in Los Angeles/Berlin across real DST weekends, EN desktop/DE mobile, creation/detail/recommendation and Event attendance/instant displays; a capture-only follow-up repeats those four successfully with mobile timestamp columns revealed. The final 36 original calendar images are directly inspected, including both timestamp columns in the mobile follow-up; finite image scope is recorded separately below. Native IMP-077, stored values, business calculations, deadlines, assignments and printable output remain unchanged. Earlier source-scoped passes do not certify this correction. |
| Refresh | Existing shared toolbar/read owners serve lists, Activity and Overview. Healthy Event detail/admin, Help and profile edit/management controls adopt them. The final complete read-region audit distinguishes current page/section reads, independent Activity workspaces/job status, Settings/discovery and private workflow commands. It found Event's explicit page action omitted admitted links and Things to do. The existing page owner now includes their eligible current-scope GETs only for explicit page Refresh; command callbacks retain their narrow dependencies. All 14 mounted page cases pass, and both final built matched cases prove complete public/admin reads, retained draft/filter nodes, the same document and no Event writes. Workflow Refresh rechecks admission without regenerating tokens or replaying private previews. No further concrete live-region omission was found in that source inventory. |
| Common notifications | Independent review accepts App/AppDialog scopes and StatusNotice/CommandFeedback receipt rendering, expiry and dismissal. Initial SSR receipts occupy the same hosted stack; descendants use the injected scope and zero-height fallback before its ref mounts. Feature initiator/target/reveal wiring is removed, while durable recovery stays contextual. Recommendation follow-up maintenance suppresses only redundant generic success, retaining progress/results/errors/uncertainty. Current mounted lifetime/SSR cases pass in the complete selection below. Built notification journeys assert stable viewport, no notice focus, persistence and no document replacement. |
| Navigation and persistent notices | Router alone owns deliberate Help anchors and saved history positions, waiting on the mounted Help renderer's existing read/error through the shared navigation module. A real uncached Back journey exposed the former late-read reanchor; the two final built Help cases now pass, including real delayed reads, browser cache expiry, same-anchor reuse, Refresh, retained search input and translation without another jump. Four original desktop/mobile viewport captures were individually inspected; mobile captures show the preserved navigation viewport rather than the complete lower article. Readiness cancellation covers superseded visits, unmount, renderer replacement and application disposal without copied query data or saved positions. Overview's ordinary region announcement keeps focus without implicit scrolling. Activity's persistent requirement progress and registration hint both use StatusNotice without transient expiry or dismissal. |
| First-install summary | Staged Architecture amendment-27 and its exact manifest operation link Database's existing confirmed-empty first-install procedure. Independent review accepts the bounded R5 reconciliation; runtime synchronization, existing-production migrations, frozen guide bytes and database safety remain unchanged. |
| Approved Operations correction | Complete assembled-guide review exposed inherited expense wording that excluded participant attribution although the existing invoice owner and Upgrading guide allow it. The maintainer directly approved R8 on October 20. Staged amendment-08 and its exact manifest fragment now describe optional eligible participant-payer history/credit separately from recorder attribution. Independent review accepts the source/manifest/staged correction, and the complete assembled Operations guide retains its inherited procedures with the corrected paragraph. Independent nonauthor and root review accept all eight assembled guides, including unchanged inherited procedures and a complete Operations reread. The documentation finding closes on that reviewed staged correction; runtime and production Operations bytes remain unchanged. This documentation review does not gate application delivery. |
| Build and engineering | The normal full build passes on Node.js 24.15.0 with the R9/R10 production corrections; all 55 checked current SSR source identities match. Emitted CSS and backend projection inspection remain separately scoped. The final test compiler passes on the exact final capture-test source. Engineering reports zero findings across 418 sources, 11 DBAL files, 61 readability files and 89 reviewed operations. Whitespace passes, with empty native-source and frozen-production-guide diffs. |
| Earlier broad application checks | The complete Vitest selection passes all 108 files and 2264 tests in 627.80 seconds before the later Activity correction; affected selections pass 62 frontend/localization cases, 20 real-ORM cases, 50 Event locale cases and the final 14 Event-page cases. The isolated built-client selection passes 49 cases. The renewed full 219-case system selection passes 218 cases with one expected disabled-login configuration skip, zero unexpected failures and zero flaky cases in 1154.56 seconds. It includes Activity field/provenance and Survey containment; later Event/Activity follow-ups verify four strengthened Activity warning journeys and selected-locale Event wording. The alternate disabled-login configuration passes separately in 25.13 seconds. On the final Event build, 14 of 16 cases pass; two matched cases time out at a test locator still requiring an English heading after German selection. The repaired pair passes both cases in 52.05 seconds, covering all 16 distinct Event cases across that selection and retry, without claiming a uniform final 16-case pass. Earlier stale-response, selector, type and interrupted receipts remain scoped failures. Final tests observe the causal successful read and current rendered values; no sorting, backend behavior, deadline or meaningful assertion was weakened. |
| Current R8–R10 checks | The seven-file R10 focused selection passes 111 tests, the real ORM selection passes all 21 cases, and the R9 focused selection passes its one case with 24 filtered cases. The affected built selection passes 38 of 40 cases; two original basic comparisons fail because their new test projection expected Bootstrap's hidden native empty badge to be measured. The bounded test-only correction asserts the visible Vue total and excludes only that approved new badge from the comparison value, retaining original screenshots/raw measurements. Both repaired cases and four new calendar cases pass together, covering all 44 distinct affected built workflows across the selection and retry. The later four-case capture-only repeat also passes. The first calendar attempt refuses an occupied server port before running tests. No product behavior, server reuse, database initialization or assertion deadline was weakened; unsuccessful receipts retain their actual scope. |
| Current original visual evidence | All 184 current affected originals are directly inspected without prior-byte substitutes: 56 Event, 92 Activity and 36 final timezone-calendar captures. The Activity inventory distinguishes 62 successful initial-run originals from 30 repaired basic-comparison originals. Calendar inventories cover Los Angeles/Berlin DST weekends, EN1280/DE390, and explicitly retain the earlier mobile token-only capture limit while accepting the final timestamp-column view. Exact paths/hashes, adjacent raw measurements and finite offscreen/Chromium limits remain in ignored receipts; no new confirmed visual finding remains in those scenes. Earlier inventories below retain their original source scope. |
| Earlier original visual evidence | The renewed full-system inventory covers all 425 migrated originals: 375 were individually inspected and 50 exactly match previously inspected PNG bytes; 20 native finance originals are outside this frontend scope. Later source-scoped follow-ups add 20 individually inspected Activity warning originals and 56 final Event originals: 52 directly inspected and four exact previously inspected byte matches, including all 32 final matched-pair originals and eight German surfaces. The earlier Event wording inventory retains its action-label finding rather than certifying the correction. Exact inventories retain paths/hashes and exclude failed diagnostic screenshots and attachment copies from accepted scenes. Browser assertions separately protect information/actions/constraints, painted hierarchy, usable fit and preserved SPA state. German capacity labels wrap inside the initial slot; dialogs retain visible headers/actions. Finite scenes and saved sidebar viewports do not certify every offscreen state; screenshots do not replace behavioral assertions. |

IMP-030 and IMP-080 remain open until actual native-to-Vue cutover, even after Vue implementation or successful
checks. Native authored frontend sources, shared domain decisions and DBAL persistence remain unchanged;
bounded versioned name provenance and civil-week presentation reuse existing read inputs without business changes. P7–P11,
cutover, native removal, guide publication, deployment and backend business redesign remain outside this task.

P5/P6 owners implement their phase contracts and direct R2–R10 amendments through the shared architecture, generated
boundaries and migration playbook. IMP-081, IMP-082 and the component-message, maintenance-feedback and healthy-Refresh
findings close on source adoption and the scoped checks above. Explicitly excluded backend/native remedies retain
their recorded scope. The maintainer's October 20 reply separately approves the directly reissued R8, R9 and R10
requests. Their bounded corrections are implemented and independently reviewed with the current checks above; no maintainer
decision remains unanswered. Original parity dispositions and earlier checks remain historical evidence rather than
certification of later source. Independent nonauthor and root review accept the complete eight-guide preparation;
its final input/output identity validation remains a separate documentation operation. Neither that review nor
the application checks authorize future guide publication, deployment or cutover.

## Full implemented-pilot review (2026-10-19)

This pre-decision receipt belongs to `5516a4c94c57d0089375a334eedad37dacf30912`. The maintainer approved
[R1 automatic deadline-job observation](FRONTEND_FOUNDATION_DESIGN.md#approved-automatic-recommendation-job-observation-2026-10-19)
as a frontend-only correction, with IMP-030 open until actual cutover, and requested the complete original-baseline
P0–P6 review. The current approved implementation and verification are recorded above.

That review withheld full readiness: Activity rich placeholders lacked declared validation and specific authority,
German source badges were untranslated, narrow Rules actions crowded, and prior claims of specific healthy-Refresh
visual approval were unsupported. A broader maintenance-feedback patch was rejected by automatic approval review
and was not implemented then. The review reported these decisions directly rather than assigning task-owned gaps
to future work. The subsequent R2–R7 reply resolves their authority; the historical implementation did not approve itself.

Authorized corrections adopted the actual shared Vue controls, recovery/denial lifetimes and upload/binary transport;
retained Free-mode generation gating, role-selection validity, private drafts and no replay; suppressed nonexistent
entry/Reload Saved receipts before publication; and removed an unused recommendation-save route. Native authored
sources and existing business/DBAL owners stayed unchanged. The staged playbook and German Activity Help were reconciled.

On Node.js 24.15.0/MariaDB 10.11.14, the broad Vitest run retained a landing timeout; existing built-module preparation
then passed its unchanged focused deadline. The full system run also retained failures followed by targeted positive
evidence, plus a separate disabled-login configuration. There was no uniform final full-suite pass. The normal build
had Windows child-write failures, including after approved escalation; unchanged direct Vite stages, compilers and
the isolated client selection passed without altering scripts. Causes of worker exits and host write failures were unproven.

Independent review inspected 345 originals within those historical scopes, including strict English advanced pairs
and separate German scenes. Raw Refresh differences and German crowding remained findings; captures supplied no
unrestricted parity or approval. Engineering and frozen-guide boundaries were clean. Eight assembled guides were
read, but the inherited first-install contradiction withheld semantic readiness until the later R5 decision.
Advisory documentation retained the unregistered fingerprint. Detailed results, hashes and failed attempts remain
in ignored `artifacts/pilot-full-review-*`; its verified task-owned runtime and credentials were removed.

P7–P11, cutover, publication, native removal, deployment and excluded backend remedies were not authorized by that review.

## P6 advanced Activity implementation and scoped verification (2026-10-19)

The [explicit P6 trigger](FRONTEND_FOUNDATION_DESIGN.md#explicit-p6-implementation-trigger-2026-10-18) covers
P6A–C/ACT-08–14: requirement drafts and unsaved coverage, explicit generation/domain-job observation, reviewed
generated/manual operations including both swap legs, warning acknowledgement and exact-batch application.
The [P6 source map](TEST_COVERAGE.md#p6-advanced-activity-source-map-2026-10-18) owns detailed assertions and consumers.

The dated implementation reused the pure requirements engine and existing recommendation/controller/DBAL owners.
Private scalar projections and independent method grants did not expose entities or job diagnostics. Feature drafts
stayed separate from Query; denial/Event unlink retired private jobs and dialogs, linked-to-linked changes retained
edits, and unavailable manual selections were cleared. Entry, deliberate Reload, generation completion and confirmed
application retained maintenance triggers; refresh, uncertainty recovery and job polling remained pure reads without replay.

The historical ordinary build passed on Node.js 24.13.0; later frontend/test compilers and focused mounted/domain/
contract checks passed. Real Activity persistence passed on guarded MariaDB 10.4.32, and the combined basic/advanced
built selection passed through the ordinary managed application. This did not renew P5's supported MariaDB 10.11
evidence or establish a repository-wide rerun. Source, engineering and documentation-boundary reviews were clean.
Independent review inspected all 16 advanced originals at 1280px/390px plus eight basic participant/warning originals;
strict English comparisons were finite scenes, not exhaustive locale/browser/accessibility certification.
The participant originals showed Full plan; default ISO date bounds were protected by mounted assertions rather
than those images. Source reconciliation did not renew an older prepared-guide output or authorize publication.

The initial R1 job-observation request was presented only through a tool. The maintainer identified that policy
violation; the request was withdrawn and reissued fully in the conversation before approval. Its later implementation
and IMP-030 cutover condition belong to the current review. IMP-079 retains inherited postcommit regeneration debt;
IMP-080's native clipping later receives the bounded R4 Vue correction while staying open until cutover.

Earlier failures exposed real text/spacing omissions and fixture/capture mistakes; they remained failed and deadlines
were not widened. The initial completion claim missed the rich-placeholder design conflict, which the subsequent
baseline review exposed and direct R3 resolved. Logs/originals remain in ignored `artifacts/p6-*`; the managed server
was stopped. No live provider/mail delivery, exhaustive concurrency, later phase, deployment or publication was certified.

## P5 basic Activity implementation and scoped verification (2026-10-18)

The [explicit P5 trigger](FRONTEND_FOUNDATION_DESIGN.md#explicit-p5-implementation-trigger-2026-10-18) covers
P5A/P5B and ACT-01–07. Dated creation/copy, settings, schedule/filters/progress, shared text, slots/roles, self/
organizer assignment, warning review and separate print were implemented; shell/Overview/Event hosts adopted Activity
SPA destinations. The [P5 source map](TEST_COVERAGE.md#p5-basic-activity-source-map-2026-10-18) owns assertion detail.

Activity adopted existing Vue entry, creation, settings, access, image, lifecycle, inline, read, command and dialog
owners. Dirty descriptions survived remote emptiness; permission loss retained disabled opening fields. A separate
copied-slot read preserved blank titles/signed capacities for correction while creation validation stayed strict.
Native/v1 adapters shared existing Activity business/persistence owners, scoped children and private projections;
no stronger legacy role/default/transaction guarantee was introduced.

The final normal build, test compiler, shared-consumer and Activity/contract/calendar selections passed on Node.js
24.15.0. Real native/versioned Activity persistence and all basic built workflows passed on isolated MariaDB
10.11.14 through ordinary managed setup. Earlier Node.js 24.13.0/MariaDB 10.4.32 results remained separately scoped.
Calendar evidence compared actual native Pug/controller output across four timezones/ranges, DST and year 1000.

Independent review accounted for 56 original desktop/mobile PNGs, including byte-identical counterparts and scrolled
image controls. It caught a capacity-ratio whitespace defect beyond outer-box assertions; the corrected schedule
originals and child measurements were rechecked. Earlier filter/conflict/presentation and fixture failures remained
failed. No exact-image result established unrestricted parity or future authorization.

Native sources stayed untouched. IMP-016/017/018 retained their dispositions; IMP-076/077/078 recorded the native
blank total badge, timezone grouping and date-label defects. Native role quantity one and quota behavior remained;
there was no invented quantity editor. Advanced Rules handoff was preserved until the separately triggered P6.
Engineering/freeze checks were clean; advisory fingerprint debt was not rebaselined. Ignored `artifacts/p5-*` retain
evidence; only the verified task-owned database/volume/credentials were removed. No repository-wide rerun, external
delivery, exhaustive concurrency, cutover, publication or deployment was claimed.

## Complete pilot-readiness correction and scoped verification (2026-10-18)

The maintainer directly authorized the [complete shared-owner correction](FRONTEND_FOUNDATION_DESIGN.md#authorized-complete-pilot-readiness-correction-2026-10-18)
across then-implemented P0–P4. Packing/Drivers shared Quick Add/counters/inline denial; those lists and Survey
shared read toolbar/state, recovery and unknown-creation Review. Matching descriptions, fields and multipart
serialization adopted actual common owners while preserving feature drafts, selected files, Survey merge and native
number coercion. Native frontend and backend business implementations were unchanged.

On the final historical build, normal Vitest/integration, the isolated built-client suite and the complete serial
managed application selection passed, with the expected disabled-login skip separately exercised in its configuration.
An isolated HEAD-plus-task-index source candidate also built using locked installed dependencies through a junction;
this was not a fresh install. Independent reviewers inspected all 270 frontend originals, including 62 Survey
captures; native finance originals were outside this correction. No unexplained painted difference remained in
the declared surfaces, but finite comparisons did not establish every browser/state or full accessibility.

The preceding two-worker system run retained a Windows native worker exit without assertion or proven cause.
The measured one-worker Windows default preserved Linux/CI overrides; Vitest Windows forks retained isolation and
serialized resets. This was a local execution choice, not a diagnosed crash repair or guarantee against recurrence.
Earlier fixture failures involved numeric normalization, lazy destinations, native modal/read readiness and valid
recurrence/schema inputs. Corrections preserved meaningful assertions and deadlines; interrupted runs supplied no result.

This receipt incorrectly called the measured Survey Refresh-row exception approved. The later baseline review
withdrew that provenance claim, and direct R6 supplies the current requirement. Native wide-page/table behavior
remained recorded as IMP-075, with no inferred layout remedy then. Native archival tests coordinated the same observed
animation through AJAX/keyboard interaction before final placement/hit tests; no native runtime change followed.

Engineering/frozen-guide checks were clean, and the existing playbook/staged inventories were reconciled.
Eight-guide semantic acceptance applied only to its exact ignored preparation receipt, not later source or
publication. Evidence remains under `artifacts/pilot-readiness-final-20261018/`; verified task-owned strict MariaDB
10.11.14/volume/credentials were removed. P4 work was not postponed; later phases, external delivery, deployment,
cutover and publication remained outside the declared finite matrix.

## Approved pilot correction and scoped verification (2026-10-18)

This preceding receipt belongs to its dated source under ignored `artifacts/pilot-implementation-20261018/`,
not the current worktree. The maintainer approved the [R1/R2 Survey frontend exceptions](FRONTEND_FOUNDATION_DESIGN.md#approved-pilot-correction-and-survey-frontend-exceptions-2026-10-18):
escaped saved descriptions and complete duplicate description/weekday/occurrence seeds, excluding ballots/images.
Existing projections already supplied the data; no native/controller/DBAL change was needed. IMP-019/020 stayed open
until cutover. Matching fields/files/descriptions, answer appearance and document titles adopted shared Vue owners.

On supported Node.js 24.15.0, real development-runtime investigation identified thousands of ignored artifacts in
Vite's watch tree. Excluding `artifacts/` retained source HMR and passed the unchanged integration deadline;
the investigation retained no renderer/fixture/deadline substitution. Normal build, compiler, database-free and
client-browser checks passed. The complete integrated frontend selection passed with its configuration skip tested
separately; the wider application run retained a native archival failure and was not a complete E2E pass.

Independent review inspected 84 Survey/Event/Packing/Drivers originals at 1280px/390px, with bounded text/control
assertions rather than full-screenshot equality. Actual profile/Drivers/invoice fixture corrections waited for the
proper lazy destination, debounced read or completed modal opening without weakening validation, persistence,
same-document checks or deadlines. A worker exit and one-pixel Overview restoration failure remained undiagnosed;
unchanged focused/repeated positive runs were not a runtime repair. The prolonged native archival animation finished
before its intermediate-state assertion; no application defect was established.

Eight assembled guides received independent/root review for those exact bytes; engineering/boundary reports were
clean except the advisory fingerprint. Source/draft/privacy and approved exceptions were reviewed independently.
Only the verified task-owned MariaDB 10.11.14/volume/credentials were removed. No complete locale/browser/
accessibility matrix, external delivery, later phase, deployment, cutover or publication was certified.

## P4 Surveys implementation and scoped verification (2026-10-18)

The [explicit P4 trigger](FRONTEND_FOUNDATION_DESIGN.md#explicit-p4-implementation-trigger-2026-10-18) authorized
standalone SRV-01–05: creation/copy, independent owner admission, personal ballots, named results, collaborative
combinations, settings and Overview actions. Existing Survey/controller/DBAL and shared Vue owners remained
authoritative. Survey gained no Event association, Access/administrator or automation feature; ETags supported
representation/draft reconciliation without stronger atomic ballot or last-write guarantees.

The historical normal build, compilers, complete frontend selection, real Survey/native/Overview persistence and
all then-configured built Survey workflows passed on strict isolated MariaDB 10.11.14. The standard managed
application proved answered-source duplication excluded ballots and image. Root/nonauthor review inspected all
20 native/Vue originals at 1280px/390px; those finite surfaces did not establish an exhaustive matrix.

Earlier fixture failures involved hidden controls, unsupported archive input, duplicate recurrence/schema values
and a Windows worker crash. An initial task wrapper selected the disposable E2E schema for an integration reset;
the final wrapper separated test/E2E modes and task-owned schemas. No production/shared/external data was touched.
Assertions/deadlines stayed intact; engineering/freeze reports were clean and fingerprint debt remained visible.

Independent/root review corrected initial duplicate GET admission to preserve native independent ownership.
The R1/R2 description/copy requests were fully reviewed and presented but unanswered at this initial receipt, so
native omissions were retained then. The later direct approvals above supersede that disposition, while IMP-019/020
stay open until cutover. Logs/targets/originals remain in ignored `artifacts/p4/`. P5+, external delivery, broader
concurrency/accessibility, deployment, cutover and guide publication were not certified.

## Feedback and module-shaped loading correction (2026-10-18)

The [direct feedback/loading instruction](FRONTEND_FOUNDATION_DESIGN.md#direct-feedback-and-loading-shape-correction-2026-10-18)
originally adopted sticky passive page receipts while retaining local reveal. Direct R7 now supersedes that local
rule. Route metadata and LoadingSkeleton shared decorative module shapes without feature data or authority.

Historical built-client/startup checks passed; separate managed frontend selections and an alternate disabled-login
run covered their distinct configured scopes rather than one complete execution. Independent review inspected
module-shape and sticky before/confirmation/user-scroll originals at 1280px/390px. Browser anchoring retained the
reviewed row while the document offset changed; capture success alone was not viewport proof.

Native Enter editing produced duplicate POSTs/alerts, recorded as excluded IMP-074 without a proven event schedule.
The comparison retained the single Tab/blur path. A JavaScript-disabled skeleton fixture tested the wrong boundary;
holding the real entry module pending corrected it. The development-runtime timeout on below-baseline Node.js
24.13.0 remained failed with unknown cause; supported-runtime diagnosis belongs to the later correction above.
IMP-072/073 closed within their implemented finite scope. Eight-guide review applied to its exact prepared bytes;
ignored `artifacts/frontend-feedback-skeleton/` and Git retain details. No publication or broader acceptance followed.

## Full-pilot review follow-up (2026-10-18)

The maintainer authorized the [frontend-only correction/native boundary](FRONTEND_FOUNDATION_DESIGN.md#direct-frontend-only-implementation-and-native-isolation-clarification-2026-10-18).
Shared lifecycle presentation removed a real inherited-parent-link space (IMP-071); IMP-070 retained excluded deeper
backend administration debt. Corrected fixtures used ordinary search, a unique profile and observed enabled/current
fields, with no extra click, longer deadline or backend change. A pending-control race remained an inference.

Historical Drivers/settings, managed frontend and ORM selections passed with the disabled-login configuration
separately exercised. Database-free evidence preceded the final whitespace-only correction and was followed by
affected client checks; their source scopes were distinct. Independent review inspected all 36 final settings/
restricted/inherited originals, with offscreen Access/mobile appearance explicitly uncertified.

All eight guides received source/byte review for their exact preparation; advisory fingerprint debt remained.
These runs used Node.js 24.13.0 below the supported baseline and isolated strict MariaDB 10.11.14. Ignored
`artifacts/pilot-corrections-20261018/` retain exact evidence. No P3 workflow was silently assigned to a later phase.

## P3 Drivers implementation and scoped verification (2026-10-18)

The [explicit P3 trigger](FRONTEND_FOUNDATION_DESIGN.md#explicit-p3-implementation-trigger-2026-10-18) authorized
DRV-01–04 and related entry/settings responsibilities. The [source map](TEST_COVERAGE.md#p3-drivers-source-to-implementation-assertions-2026-10-18)
owns detailed assertions. Copies omitted rides/assignments; driver identity, passenger capacity and distinct-profile
counts retained native meanings. IMP-026–028 stayed inherited/excluded.

Independent frontend/backend and root review checked actual shared consumers, native method grants, private
projections, preparation and draft/identity lifetimes. Hidden-title evidence, receipt timing, image-label spacing,
destinations, drag feedback and mobile capacity headings were corrected. A delegated test-ownership overlap was
reported and reconciled without losing uncertainty/File cases or granting a new backend remedy.

Build/generation, compiler, database-free and focused/native-versioned ORM selections passed. MariaDB 10.11.14
evidence covered final-place contention, independent grants/private-token projection and preparation rollback.
Built Drivers/pilot/Event/header selections plus corrected parity captures passed in their separate scopes.
Root inspected desktop/mobile originals; selected identical PNGs did not prove blanket pixel parity.

Earlier fixture/generation failures and the real mobile table-width deviation remained historical. Strict
comparisons and deadlines were retained when the capacity heading was corrected. Node.js 24.13.0 was below the
documented baseline; clean engineering/freeze checks did not certify a supported-runtime rerun. Ignored
`artifacts/p3/` retain logs/targets. No later phase, cutover, publication, deployment or native removal followed.

## Current acceptance and correction boundary (2026-10-16)

This heading retains the **October 16 P0–P2 source scope**, before later explicit P3–P6 triggers. The direct
[S1 decision](FRONTEND_FOUNDATION_DESIGN.md#authorized-implemented-pilot-scope-2026-10-16) limited that delivery;
the live [phase contracts](FRONTEND_FULL_IMPLEMENTATION_PLAN.md) did not implicitly authorize subsequent modules.
No task-owned P2 feature could be renamed future work to avoid acceptance.

The full review withheld acceptance for disabled Event values displayed as absent, recorded-but-unasserted visual
evidence, an unsupported SQL-mode assumption, English/nonreactive identity completions and excessive review history.
The maintainer directly authorized readiness correction and [R1 catalog completion](FRONTEND_FOUNDATION_DESIGN.md#approved-catalog-based-identity-completion-notices-2026-10-16).
IMP-065/067–069 and the TEST/DOC readiness findings retain one backlog owner; passing syntax/source checks alone did
not close runtime gaps. The following decisions retain their distinct conversational provenance:

- [E1](FRONTEND_FOUNDATION_DESIGN.md#direct-production-coexistence-exclusion-and-spa-correction-2026-10-16)
  closed IMP-066 by excluding simultaneous native/Vue production use. The Event mixed-writer loss risk was source-based,
  not a controlled database reproduction or repaired defect. The development comparator and approved Packing remedy remained.
- D1 in that same reply rejected ordinary Event document creation/duplication and required the original generated
  JSON/multipart SPA command/navigation owners across implemented P0–P2. Prior code/prose/tests supplied no retrospective
  exception approval; excluded backend finality repairs did not become prerequisites.
- [C1](FRONTEND_FOUNDATION_DESIGN.md#conditional-fixture-check-usefulness-review-and-removal-2026-10-16)
  authorized an unbiased usefulness review/removal of the late fixture matcher, preserving selected schemas and
  unchanged inherited CI grant provisioning. The earlier claim that this checker repair blocked application parity was withdrawn.
- [The R1 native-isolation clarification](FRONTEND_FOUNDATION_DESIGN.md#direct-native-isolation-clarification-2026-10-16)
  allowed separately mutable Vue copies while requiring matching Vue consumers to share owners. Earlier same-name
  R1 replies about reload or Session architecture were separate decisions, not transferable authority.

Independent review traced all then-current frontend/style/declaration inputs, existing backend owners and eight
staged outputs. Shared entry/guest/header/settings/metadata/access, creation/removal, command/read/recovery and
navigation owners were actually adopted. Query kept snapshots, feature drafts kept values, Router kept URL state
and Express kept one Session. Controllers retained business checks and pure DBAL retained persistence; bounded
projections and `.d.ts` contracts preserved information hiding. Safe wrapper/comment cleanup granted no new behavior.

The original Vue/TypeScript/Vite/Router/Query/Reka/i18next-vue/OpenAPI choices, human-readable named methods/internal
comments and single staged playbook remained the intended architecture. That finite P0–P2 review did not certify
every actor/state/locale/browser, complete accessibility/PDF/race coverage, the whole application or cutover.

## Current verification evidence (2026-10-16)

These historical checkpoints retain their dated source scopes. Current verification belongs to the first section.

### Current readiness follow-up

The authorized P0–P2 readiness correction adopted shared catalog completion facts, native Everyone-caption
activation and one notice-margin input across actual consumers, without native/backend behavior changes.
On Node.js 24.15.0/strict MariaDB 10.11.14, ordinary build/compilers, complete client checks, selected workflow ORM
and generation/watch fixtures passed. Two complete ordinary managed selections passed with the expected alternate
configuration skip, separately exercised with local login disabled. Root verified 620 authored inputs matched the
isolated validation checkout; unrelated emitted JavaScript remained untouched.

Independent/root review covered complete profile footers and Packing/Overview body states, with original image
inspection plus hashes for identical counterparts. Eight assembled outputs received exact-byte semantic review
for that preparation, not publication. TEST-FRONTEND-READINESS-PARITY closed only within the declared matrix.
Earlier failures exposed real Everyone activation/margins and invalid fixture visibility/focus assumptions.
Interrupted storage-path/selection attempts supplied no completed result; validation used an exact task-owned
relative upload path without changing application/native source. Earlier failures and unknown causes were retained.

Ignored `.temp/frontend-readiness-20261016/` contains exact receipts and verified database cleanup. The native mobile
Packing table remained wider than the viewport; hidden-column/accessibility and arbitrary actor/browser matrices
were not certified. General backend/external-service/cutover boundaries remained separate.

### Ordinary SPA correction: final scoped verification

This preceding source adopted generated Event creation/scoped child deletion, read-only warm private admission
and explicit profile commands, shared creation/removal and Router destinations. Displaced Vue document adapters
retired. Actual transfer, wrong/successful deactivation, account/guest deletion, warm history/no replay, persistence
and retained document identity were exercised. Native source diffs stayed empty.

Build, compiler and complete frontend checks passed; ORM evidence combined an initial selection with a corrected
native tinyint/boolean assertion, not one uniform rerun. The main managed selection retained failures from stale
destination/tab fixtures and unchanged drag timeout. Targeted corrections, unchanged drag repetitions and the
alternate authentication configuration supplied scoped positive evidence without converting the failed broad run
into a pass or diagnosing the drag failure. Independent reviewers inspected profile/Event/German originals;
token/shell differences and finite visual scope remained explicit.

These runs used Node.js 24.13.0 below the documented prerequisite. Ignored `artifacts/frontend-spa-20261016/` retains
run/source/image/guide-review receipts and verified task-owned cleanup. No hosted environment, stronger backend
finality, live provider/mail, deployment or guide publication was established.

### Earlier comparator and correction receipts

Pre-D1 receipts under ignored `artifacts/frontend-rectification/`, `artifacts/frontend-rereview-20261016/` and C1
artifacts covered their own earlier source, not later matcher/transport changes. Their distinct lessons remain:

- Native/versioned blank capacity both stored zero on non-strict MariaDB 10.4.32. Approved scalar presentation kept
  false/zero/empty distinctions; later ordinary strict MariaDB 10.11.14 checks did not change native numeric validation.
- T1's directly approved test correction retained each response's dietary order and all values while comparing
  choices/counts/painted layout. Native-only reads varied without writes. Passing repeats did not repair drag or
  certify the then-unasserted full profile footer; reflow was not browser zoom.
- Original matcher ownership was traced to `f45dad7`/`7a983c4`, but specific prior authority was unavailable and G1
  was withdrawn. C1's independent usefulness review recommended removal of the parser/query/selector and obsolete CI
  lines while preserving schema safety. Its scoped passes were not a full rerun; inherited CI grant provisioning stayed unchanged.
- Staged SQL examples escaped literal schema underscores, and Event recovery routes were reconciled without changing
  frozen guide bytes, origin digests, application behavior or granting publication/CI grant-repair authority.

Those local runs used below-baseline Node.js 24.13.0. Arithmetic across targeted passes supplied no uniform final-source
run; neither a later production build nor safe comment/wrapper cleanup renewed old HMR, deployment or visual evidence.

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
| Shared presentation and feedback (`IMP-061/062`) | Shared action state drives rendered availability and dispatch. Actual static admitted denials survive bootstrap retirement for recovery policy. Confirmed writes survive same-actor read pauses, release completed input and show saved/stale feedback; actual actor retirement still discards old results. Shared receipt, navigation and lifecycle owners preserve dismissal locks, wording and read lifetimes. Direct R7 supersedes caller placement/native reveal with common page/dialog notifications that do not move focus or scroll. |
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
Each module still proves its own grants/projections, drafts, privacy, visible interface and uncertainty behavior;
the current functional-parity decision above supersedes exact native geometry as a preservation requirement.

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
pass count or selected Event/header scenes. The current complete workflow/footer, Packing body and distinct Overview
assertions and inspected originals supplement the existing actor, validation, recovery and German keyboard/reflow
cases. Their finite scope is the declared matrix and captured surfaces; a complete Cartesian actor/state/locale/browser,
zoom or accessibility matrix is not certified. Earlier dietary-order/drag failures remain historical failures.
T1 retains its separate response-order assertion boundary; it authorizes no native/backend ordering change or later phase.

The local MariaDB 10.4.32 setup previously exceeded ordinary preparation deadlines; separate guarded preparation
and temporary built-only/prepared-ORM wrappers were disclosed. They preserved real backend delivery/assertions,
but did not establish ordinary setup or MariaDB 10.11 acceptance. The current correction's standard ORM and built
selections renew supported-database/ordinary-setup evidence only for their scopes above. Current unchanged generation
fixtures passed on supported Node.js 24.15.0; the older two-tree check's 60-second timeout remains a historical failure
with unknown cause rather than an invented diagnosis or timeout change.
Earlier supported MariaDB 10.11.14 receipts apply only to their older source scopes. Those runs weakened no timeout,
schema scope or source fingerprint to create a pass. The subsequent fixture-only check removal follows the separate
explicit C1 review/decision above; it does not change those earlier execution scopes or certify credential authority.

General defects remain separately owned: native mixed reset (`IMP-051`), provider logout preparation (`IMP-056`),
mixed activation acknowledgement (`IMP-057`), token/transfer/deactivation/deletion remedies, Event capacity race
(`IMP-037`), permission review and `ARCH-005`. Source scheduling exposed some mixed-writer risks without reproducing
every database schedule. They remain excluded backend work, not hidden unfinished frontend features. Persisted
principal language and complete email/PDF/domain localization remain unimplemented targets in active DEC-006.

No finite receipt certifies live OIDC, successful SMTP/inbox delivery, hosted CI, operator restore/deployment,
long or multipage PDF layout, every timezone/DST input, all permission/concurrency combinations, full-application migration,
default-route cutover, native deletion or guide publication. Application checks stay separate from advisory
documentation diagnostics. Production guides remain protected; prepared output needs actual independent/root
semantic review tied to its current identities and separate publication authorization.

Use the existing [migration contribution handoff](FRONTEND_FOUNDATION_DESIGN.md#migration-contribution-handoff),
[playbook](staged/DEVELOPMENT.md#adding-or-changing-a-feature-view) and [coverage map](TEST_COVERAGE.md) for each authorized
follow-up. All five implemented entity families already adopt the shared guest/entry/header/settings/metadata/access/lifecycle
owners where their responsibilities match. Distinct ride, survey, activity and finance semantics stay in their owners. Inspect
all current matching Vue consumers and adopt shared changes together; preserve native isolation, actual backend
reuse and every existing phase-specific exception. The live phase plan is a contract, not inferred authorization.
