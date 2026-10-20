# Frontend pilot parity review
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-20
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: authorized P7 finance implementation, independent semantic review and finite running-app evidence recorded alongside retained Activity corrections and P0-P6 history; native/backend exclusions and cutover conditions retained
source-anchors: docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md; docs/frontend-migration/FRONTEND_FULL_IMPLEMENTATION_PLAN.md; docs/frontend-migration/TEST_COVERAGE.md; docs/frontend-migration/staged/; docs/backlog/documentation-remediation.yml; src/controller/; src/modules/database/services/; src/modules/api/; src/modules/lib/session.ts; src/modules/lib/frontendSession.ts; src/frontend/; contracts/api/v1/; src/locales/; scripts/generate-api.mjs; scripts/generate-locales.mjs; scripts/watch-frontend-inputs.mjs; tests/frontend/; tests/integration/; tests/e2e/; vitest.config.mts; playwright.config.ts; src/types/FrontendPilotUiTypes.d.ts
next-review: authorized-pilot-correction-verification-or-next-migration-slice
-->

The native design comparator is `2dfa2573c64178f54684cc4877b5a945f66e24c8`; the application-source baseline used in the
session/full-pilot review is `7ff78998667e55df56390a8e8da88e8ace687771`. Neither identifies a deployed site's version.
The [foundation ledger](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments) owns original choices
and dated amendments. This record owns current findings, latest relevant evidence and concise historical dispositions.
Superseded run counts, repeated failures, file inventories and capture transcripts remain in Git and ignored artifacts.
There is no second maintained archive or approval request in this record.

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
