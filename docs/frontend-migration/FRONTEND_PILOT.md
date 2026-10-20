# Frontend foundation pilot
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-19
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: P6 advanced Activity route composition and shared engine/transport adoption source-reconciled alongside P0-P5; execution belongs to paired review; later phases and separate cutover boundaries retained
source-anchors: docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md; src/routes/frontendPilot.ts; src/routes/api/v1/; src/controller/packingController.ts; src/frontend/; src/modules/frontendPilotRenderer.ts; src/modules/frontendDevelopment.ts; src/modules/api/; src/modules/localization/; contracts/api/v1/; package.json; vite.config.mts; tests/frontend/; tests/integration/; tests/e2e/; src/types/FrontendPilotUiTypes.d.ts
next-review: next-migration-slice-or-authorized-cutover
-->

The opt-in Vue pilot migrates Packing, Help, Events, Drivers, Surveys, Activity planning and their necessary identity, overview and shared foundation journeys.
Native application routes remain available as the visual/behavioral reference. The comparator is
`2dfa2573c64178f54684cc4877b5a945f66e24c8`, subject only to explicit exceptions in the
[foundation decision ledger](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments).
This guide describes ownership and scope; the [paired review](PILOT_PARITY_REVIEW.md) owns
completed scoped acceptance and execution evidence, including its remaining limits.
The [current full-pilot review](PILOT_PARITY_REVIEW.md#full-implemented-pilot-review-2026-10-19)
qualifies prior acceptance with current findings; source mappings and earlier passing selections do not establish
complete visual/behavioral parity for every implemented journey and relevant state.

## Migration boundary and current iteration

The original 2026-10-08 iteration requires complete Help/Packing and their entry/foundation behavior.
The 2026-10-14 P1 implementation adds profile editing, account profile listing/creation and existing switching (P1A),
profile-token issuance, entry, private preview and explicit transfer (P1B), profile deactivation and full/guest account
deletion (P1C), plus opt-in landing and common message/error presentation (P1D). The maintainer's
[parity-only clarification](FRONTEND_FOUNDATION_DESIGN.md#authorized-parity-only-migration-clarification-2026-10-14)
excludes existing backend remedies rather than making them prerequisites. Their backlog records remain open.
P2 adds Event creation/duplication, settings, registration, organizer tools and Things to do. The
[full plan](FRONTEND_FULL_IMPLEMENTATION_PLAN.md) owns the phase contracts for surveys, activity plans,
invoice pools and eventual cutover. Implemented portions retain native behavior and maintainability
requirements; the paired review records actual scoped checks, including the P2 review corrections.
The [October 18 direct clarification](FRONTEND_FOUNDATION_DESIGN.md#direct-frontend-only-implementation-and-native-isolation-clarification-2026-10-18)
retains native isolation, shared Vue owners and shared backend operations, while excluding deeper backend
administration refactoring from the current frontend correction.
The maintainer's [S1 decision](FRONTEND_FOUNDATION_DESIGN.md#authorized-implemented-pilot-scope-2026-10-16) limits the
October 16 delivery through implemented P2; later phases wait for stable repeated reviews and an explicit future trigger.
The maintainer's [October 18 P3 instruction](FRONTEND_FOUNDATION_DESIGN.md#explicit-p3-implementation-trigger-2026-10-18)
starts Drivers under its existing parity contract. P4–P11 and cutover remain separately scoped.
The subsequent [P4 instruction](FRONTEND_FOUNDATION_DESIGN.md#explicit-p4-implementation-trigger-2026-10-18)
starts standalone Surveys. They reuse guest/entry/header/settings/metadata/lifecycle and creation-command owners,
without event association or general permissions. P5–P11 and cutover remain separately scoped.
The subsequent [P5 instruction](FRONTEND_FOUNDATION_DESIGN.md#explicit-p5-implementation-trigger-2026-10-18)
starts basic Activity planning, participation and read-only participant progress. P6–P11 and cutover remain separately scoped.
The subsequent [P6 instruction](FRONTEND_FOUNDATION_DESIGN.md#explicit-p6-implementation-trigger-2026-10-18) starts
advanced requirements, unsaved coverage, recommendation jobs and reviewed changes. Those workflows now compose
the admitted Activity page through generated SPA operations and the existing shared backend engines. P7–P11 and
cutover remain separately scoped; the paired review records actual verification and its limits.

The [direct E1/D1 reply](FRONTEND_FOUNDATION_DESIGN.md#direct-production-coexistence-exclusion-and-spa-correction-2026-10-16)
excludes native/Vue production coexistence coordination and rejects the ordinary Event document-POST exception.
The [completed correction](FRONTEND_FULL_IMPLEMENTATION_PLAN.md#completed-spa-correction-2026-10-16) restored
generated JSON/multipart commands, shared Vue owners and Router navigation across equivalent current P0–P2
forms/links. The route contracts below have reviewed source adoption and fresh scoped same-document application
evidence in the review, including the failed broad run and focused positive receipts. Existing operation ordering and partial outcomes
remain inherited, without new transactions or general identity/token repairs.

The maintainer's 2026-10-14 A2 correction supersedes P1's added profile field-edit/create transaction wrappers.
Their adapters now invoke the unchanged native operations and confirm with a simple prepared acknowledgement.
Session/roster display refresh remains separate from confirmed success; its Retry performs reads/navigation only.
Earlier registration/login/profile-switch atomicity and the exclusion of general backend remedies remain intact.

Preserve native UI/UX and business behavior except for explicitly approved changes. Native guide prose/images remain
the reference; approved reference cleanup does not import pilot behavior into production guidance. The optional
[profile](PROFILE.md) owns temporary rules and stages only changed guide sections/fragments. Unchanged guidance
comes from approved canonical guides; complete reviewed temporary output is prepared before cutover. General policies,
AI instructions, decision records and Help-authoring rules remain active. New localized pilot Help stays directly
in its runtime corpus. Default-route cutover requires separate authorization.

Packing, Event, Drivers and Activity business operations share existing controller owners with removable native/v1 transport adapters and
central method permission definitions. Pilot action grants are independent of detail-page membership where native
policy permits the action; private metadata/access projections remain bounded. Creation, metadata, item/membership
writes and counters are shared, as are existing reorder/delete/default hooks and administration/event/image owners.
Transport normalization, feedback and conditional-write differences remain explicit. Final checks and the reproduced
coexistence lock defect belong to the paired review; this is no overall acceptance claim.
Existing permission inconsistency is tracked as `IMP-022`, rather than silently becoming new policy.
The exact duplicate URL after login is an explicitly approved native exception.

## Entry points and preserved journeys

| Pilot route family | Contract |
|---|---|
| `/frontend-pilot` | Bounded mixed overview; native membership, search and personal visibility; other feature destinations remain native until migrated. |
| `/frontend-pilot/home` | Explicit opt-in native-equivalent landing; captured quick-create suggestion, account/guest welcome and migrated Packing/Event/Drivers/Survey/Activity creation destinations. Other creation destinations remain native. The Overview root stays unchanged. |
| `/frontend-pilot/message` | Admitted informational/command feedback; route query data cannot supply message authority. Common error presentation retains server-selected status and development-only diagnostics. |
| `/frontend-pilot/users/profile`, `/frontend-pilot/users/profile/manage`, `/frontend-pilot/users/profile/create` | Current profile editing for accounts/guests; account-only owned roster/creation and existing profile switching. Creation preserves the active profile. |
| `/frontend-pilot/users/profile/migrate/request`, `/frontend-pilot/users/profile/migrate/show` | Ordinary warm entry, explicit generated token issuance and body-only preview/transfer use SPA command/navigation owners. Private draft/result/token state stays mounted; a fixed nonsecret fragment supports local history without replay. The existing initial token GET compatibility remains distinct. Receiving active profile and former-owner cleanup stay unchanged; no stronger backend token/transaction guarantee is introduced. |
| `/frontend-pilot/users/profile/delete`, `/frontend-pilot/users/account/delete` | Native profile-name/username confirmations, account/guest distinctions and remaining-profile selection through shared SPA commands and internal completion. True provider logout remains an explicit handoff. Validation and possible partial/unknown outcomes remain honest; the excluded backend defects are not repaired. |
| `/frontend-pilot/packing/create` | Account/profile admission, event preselection, initial items and optional image. |
| `/frontend-pilot/packing/<id>` | Authorized Packing detail; guest/event admission precedes page rendering. |
| `/frontend-pilot/packing/<id>/duplicate` | Existing duplicate permission/copy boundaries; rejected submission returns login to this exact duplicate destination. |
| `/frontend-pilot/event/create`, `/frontend-pilot/event/<id>`, `/frontend-pilot/event/<id>/duplicate`, `/frontend-pilot/event/<id>/admin` | Native Event admission, creation/copy boundaries through generated multipart and shared creation/navigation, detail, own registration and permission-filtered organizer/settings tools. Event-rendered child deletion uses its shared command owner; PDF and unmigrated child pages retain native destinations. |
| `/frontend-pilot/event/<id>/guest`, `/frontend-pilot/event/<id>/register` | Guest entry and the register alias preserve `regToken` and return to admitted pilot detail. Native `/event/<id>` and `/event/<id>/register` destinations remain available unchanged. |
| `/frontend-pilot/drivers/create`, `/frontend-pilot/drivers/<id>/duplicate`, `/frontend-pilot/drivers/<id>` | Account-only creation, independent duplicate admission, metadata/defaults/image/event context, ride offers, passenger assignment/removal, edits, ordering and settings through shared controller owners and generated SPA commands. Creation and duplication contain no rides. |
| `/frontend-pilot/survey/create`, `/frontend-pilot/survey/<id>/duplicate`, `/frontend-pilot/survey/<id>` | Standalone recurring choices, independent owner duplicate admission and account-only creation, personal ballot replacement, named results and collaborative combination creation. Owner settings expose metadata/image/archive/duplicate/delete only. Representation ETags do not add write preconditions. Approved R1/R2 correct Vue descriptions and duplicate prefill; native defect records remain open until cutover. |
| `/frontend-pilot/survey/<id>/guest` | Shared guest presentation and existing identity completion; every admitted account/guest profile may vote and add combinations. Overview actions and images use generated Survey operations. |
| `/frontend-pilot/activity/create`, `/frontend-pilot/activity/<id>/duplicate`, `/frontend-pilot/activity/<id>` | Dated creation/copy, schedule and filters, shared text, slots/roles, participation and warning review through shared backend owners. The admitted Rules tab composes requirement drafts/coverage, recommendation jobs and reviewed manual/generated changes in the same document. Private management grants remain independent; recovery and job reads cannot dispatch generation or run maintenance. Settings compose metadata/image/access/Event/lifecycle owners; print remains a separate document. |
| Packing/Event/Drivers/Survey/Activity guest entry/recovery | Shared presentation with feature-specific native fields, notices, title, canonical detail/success destinations and invalid-token outcomes. Drivers and Activity use their `/frontend-pilot/<feature>/<id>/guest` destinations. |
| Pilot login/register/recovery/reset | Existing account policy, return context and confirmed destinations; provider/token boundaries remain ordinary navigation. |
| `/frontend-pilot/help` | Complete localized read-only Help SSR, search, links and SPA hydration. |
| `/api/v1` | Generated JSON/multipart contract; existing controllers own policy and pure DBAL owns persistence. |

Inspect the route table and authored contract for exact paths. These families do not authorize a wildcard HTML
fallback for APIs, missing assets, tokens or exports. Privacy/imprint links keep their configured external
destinations; `/healthz` remains Express-owned.

Standalone Packing without an active profile enters its equivalent guest journey. Attached lists retain the existing
event-registration/effective-view policy. Duplicate GET permission is independent of account-only creation POST.
Invalid guest links and expired stored identity retain their native rejection/reauthentication presentation,
including provider logout evidence where applicable.

Confirmed guest registration navigates to canonical detail with its personal-link feedback. Confirmed recovery
uses its native message destination; unknown or pending commands retain input and recovery controls.
Login/account-only creation retains exact return context. Surveys' existing admission exception remains deliberate.

## Packing behavior

The Vue feature owns creation/duplication, metadata/settings, items and assignments independently of native browser
modules. It does not consume Pug fragments or delegate controls to the native Packing view.

Preserve inline item editing, quick add, drag ordering, Everyone switching, self-assignment and authorized removal of
another assignment. Settings have permission-filtered Details, Header image, Access, Event and Actions panels.
Each panel owns its independent draft/operation; permission matrices and administrators retain their existing rules.
Creation/duplication preserve native collectors, optional fields, validation, copy boundaries and image behavior.

The local Packed? checklist retains `packed_<list UUID>_<item UUID>` with value `1`. It remains personal browser state
rather than a profile-scoped server preference. Packing has no export or automatic-archival control to infer from peers.
Shared archival, personal hiding, hard deletion and file retention remain separate.

Native no-op actions remain available and use their operation-specific receipt without an empty write.
Known server validation clears passwords where native forms do; local validation or unusable delivery retains them.
Pristine metadata Save retains its informational outcome. The October 19 shared-SPA decision supersedes the original
native inline placement/focus rule: transient outcomes use common page/dialog notifications without moving focus or
scroll. Durable validation, review and recovery remain with their existing contextual state owners.

## Drivers behavior

Drivers adopts the same guest entry, displayed header, settings, image, event picker, access and lifecycle owners.
Its list reads, root creation form, basic metadata fields, reorder gesture and passenger controls share the actual
Vue owners used by Packing. Ride offers retain their author profile as driver; offering a ride consumes no passenger
place, and one profile may offer or join multiple rides. Creation/duplication copies no rides or assignments.
The five-column native table has no Packed? or Everyone behavior. Participant counters count distinct assigned
profiles rather than ride authors. Method-only grants remain independent of detail admission; capacity and
foreign-resource checks stay server-owned. Existing IMP-026–028 remain inherited/excluded backend defects.
Overview and Event Things to do use the migrated Drivers destinations and authorized image operation.

Packing/Drivers Quick Add adopts `EntityQuickAdd` for the matching card and description/capacity/submit presentation.
Feature slots retain Packing's editable title and Drivers' readonly actor name; values, collectors and command/reset
decisions remain feature-owned. The shared capacity control retains installed Vue's numeric coercion and DOM updates,
including leading-zero normalization on change/rerender. `EntityDescription` supplies escaped lines for both lists,
Surveys and Event, with explicit paragraph/divider inputs preserving their different surrounding layout.
`EntityListCounters` presents admitted Packing/Drivers counts. Packing, Drivers, Survey and Activity share `EntityListToolbar`,
`EntityDetailReadState` and the existing `CommandFeedback` creation-review presentation, retaining list scrolling,
Survey's Refresh placement, feature wording/timestamps and the existing read/command owners. Local inline denial
uses `useListCommands` without dispatch; generic presentation supplies no feature authority.

## Surveys behavior

Standalone Surveys compose the existing entry/guest, detail-read/command, header, settings, metadata and lifecycle
owners under [SRV-01–05](BEHAVIOR_INVENTORY.md#surveys). Personal ballot drafts retain dirty answers during fresh reads
while newly observed recurring choices enter as No. Named results and collaborative combinations retain their
separate presentation and admission; archival does not disable participant voting or combination creation.

Owner settings add no event association, Access or administrator controls. Representation ETags support read/draft
reconciliation without conditional writes or atomic ballot replacement. Approved frontend exceptions display escaped
saved instructions and prefill every copyable description/weekday/occurrence; copies still exclude answers and image.
Native defect records stay open until cutover. The [P4 assertion map](TEST_COVERAGE.md#p4-surveys-source-to-implementation-assertions-2026-10-18)
owns exact source coverage, and the paired review owns executed results rather than this behavior summary.

## Basic Activity behavior

Activity composes the existing entry, guest, header, creation, settings, metadata, access, Event and lifecycle owners.
Feature components own dated slot drafts, local schedule/participant filters and explicit warning-review intent.
Generated operations reuse the existing Activity controller, assignment/warning engines and DBAL. Current grants,
child ownership and private projections are server-enforced; native client admission remains distinct from method
permission. No new Rules, requirement editor or recommendation workflow belongs to this phase.

The original P5 choice copied different native server-detail and browser-creation calendar algorithms. The
[October 20 approval](FRONTEND_FOUNDATION_DESIGN.md#approved-operations-slot-total-and-calendar-day-corrections-2026-10-20)
supersedes that choice for Vue: one pure civil-date owner supplies creation and versioned detail weeks, and matching
Event/Activity date-only labels preserve the saved day in the selected language. Deadlines and link timestamps remain
instants. The existing Slots badge counts all saved slots independently of All/My/Open, including zero when empty.
Native date-display, blank-total and label-activation defects remain recorded. Vue initial-slot controls have shared visible, associated labels under the R4/R6 usability
requirements; IMP-017 remains open for the unchanged native comparator. Existing role-update and native participant-privacy
dispositions also remain. The new adapter redacts unauthorized participants and sibling details. Role quotas retain the existing
engine and native creation quantity of one; no new quantity editor is inferred. The
[P5 source map](TEST_COVERAGE.md#p5-basic-activity-source-map-2026-10-18) owns assertion mappings, and the paired review
owns actual execution and inspected visual evidence.

## Logical owners

This table describes the implemented logical owners. The paired review records scoped acceptance and evidence
for the approved coexistence remedy.

| Owner | Responsibility |
|---|---|
| `contracts/api/v1/` | Authored operation shapes/policy; generated declarations and runtime validators are consumers. |
| Existing controllers | Shared operation checks, authorization and contextual errors; native/v1 transport adapters can retire independently. |
| Existing database services | Queries, locks, transactions and persistence, with controller callbacks for checks against locked data. |
| `src/frontend/app/` | Router, application/session scope, transport, query keys/cache and update coordination. |
| `src/frontend/features/<feature>/api.ts` | Feature operations, validators, dependencies and endpoint-specific policy. |
| `src/frontend/composables/` | Generic entry/read/navigation, draft/command/recovery, feedback and injected authorized-image lifetimes. |
| `src/frontend/components/` | Shared application controls with explicit props/events and accessibility ownership. |
| `src/modules/frontendPilotRenderer.ts` | Express manifests and request-local same-component Vue SSR. |
| `src/locales/<locale>.json` and shared translator | One discovered catalog per language, generated keys/parameters and i18next-vue integration. |
| `docs/user-guide/en/`, `docs/user-guide/de/` | Reviewed release-owned pilot articles/images; native Help keeps `docs/user-guide/`. |

Reuse these owners rather than adding wrappers, forwarding modules, validators, state stores or policy copies.
Shared type-only contracts are `.d.ts`. Comments explain nontrivial intent and boundary decisions; templates document
required data and browser hooks. Feature state travels through renderer `data` and explicit template arguments.

Event, Packing, Drivers, Survey and Activity detail use the same displayed `EntityHeader`, retaining the native 250px cover image and responsive
parent links. Features supply admitted data, exact image/query operations and current settings state; the separate
Event dashboard heading remains intact. Actual successful query receipts recover missing images after current props
render, with resource/key checks and the existing authorized-image owner. Image upload remains a settings draft.

All five features use `EntityEntryPage` for denial-family dispatch and the existing settings/metadata composites.
Packing, Event, Drivers and Activity additionally supply Access operations; standalone Surveys supply none.
`useMetadataEditorHandle` exposes one mounted metadata workflow. Field opt-in uses the shared nullable-text normalizer;
Event schedule/capacity and Packing item/checklist semantics remain distinct. The existing stateless lifecycle owner
shares archive/restore and Settings/Event-child pause/resume, retaining current caller capabilities, native warnings,
command feedback and read-only recovery. These are adopted implementations, not unused helpers for later consumers.

The existing Event controller shares capacity and child-eligibility rules across native/v1 consumers; DBAL supplies
their data and persistence. Optional-session declarations for independently public methods describe unchanged runtime
admission, with account/profile-required operations retaining their boundaries. The
[Development amendments](staged/DEVELOPMENT.md#backend-and-method-policy-contracts) own the detailed contracts.

Reka owns shared dialog/tab focus and keyboard behavior. Mixed navigation/overview disclosures use the existing
`AppNavigationDropdown`: native details/Tab/embedded-control behavior, outside dismissal, Escape focus return and
shared placement. Public Reka menu/popover semantics do not fit that native interaction; this is the original
conditional primitive choice, not a technology amendment.

## Ownership and normal development

`npm run server` integrates the normal Express workflow with Vite middleware/HMR, the legacy browser watcher and
serialized authored contract/catalog regeneration. Express restarts only after generated consumers are complete.
Use the maintained `vite.config.mts` and project root explicitly; emitted config siblings must not take precedence.

The renderer transforms source entry/style URLs before inserting the rendered Vue tree. Express retains native
static/help ownership and Vite handles its `/app/` namespace. Transforming the full SSR document or rebasing URLs twice
can leave convincing but inactive HTML; verify the document's emitted URLs and real mounted controls.

`npm run build` generates contracts/catalogs, compiles Express/native assets, checks client/SSR Vue scopes and builds
separate client/SSR destinations. The release contains coherent artifacts and runtime SSR dependencies.
Production needs no Vite server or runtime schema compiler. Generated declarations, validators, locale resources
and `dist/` remain ignored. Exact scripts and dependency versions belong to executable package configuration.

The actual Express/Vite/SSR/HTTP module fixture lives in `tests/integration/frontend-development-runtime.spec.ts`;
`frontend-session-admission.spec.ts` separately integrates actual HTTP/session middleware with MemoryStore. These
scoped component boundaries need no application persistence, so the existing database-free Vitest project and
`test:quick` selection retain them without schema initialization. Source-development browser workflows remain
separate integration evidence; neither fixture establishes built-application E2E. The [Testing amendments](staged/TESTING_GUIDE.md#frontend-compiler-and-build-scopes)
own runner details, while the [review](PILOT_PARITY_REVIEW.md) owns actual execution.

## Progressive loading (2026-10-08)

Refined Req6A adds the initial interactive skeleton until client initialization; the following data-loading policy
continues after that boundary. Overview waits for session bootstrap, then each active region loads independently in
parallel. Hidden regions start on opening. Unknown membership never renders zero/count/empty assertions; a ready region need not wait for a
slow sibling. Help retains complete server content.

`LoadingSkeleton` composes page-family layouts from shared field/table/card/list/article/line shapes. Static route
metadata supplies the same presentation to initial rendering and scoped cold reads, with a page frame only where
the real header/card has not already rendered. One localized status and one animation belong to each loading region;
responsive columns and reduced motion remain shared. Use it for client initialization or missing pending data.
Background reads retain scoped confirmed content and drafts; validated denial clears protected content. Lazy
navigation can show shared progress without discarding work.

## Identity, refresh and edits

The [session-ownership correction](FRONTEND_FOUNDATION_DESIGN.md#session-ownership-restoration-and-stateless-initial-visits-2026-10-15)
retains one ordinary Express Session. Bootstrap projects null context/CSRF for an uninitialized anonymous visitor;
it does not persist that Session or issue a cookie. Existing authenticated scope and controller grants remain
server-owned, and explicit identity operations retain their completion transaction. The later
[native-flash decision](FRONTEND_FOUNDATION_DESIGN.md#authorized-native-anonymous-session-flash-2026-10-15)
preserves an anonymous Session for the account-required redirect's one-time notice, without a URL notice parameter
or metadata initialization. The paired review records verification; `ARCH-005` owns the separate whole-session/flash
review, which is not a migration prerequisite.

Query keys capture actor/profile/resource and meaningful filters; locale belongs only to language-owned projections.
Profile/logout/context changes retire private reads/cache, commands and authority. Late responses cannot restore
old scopes. Hidden tabs pause reads; focused/reconnected active views use the shared bounded retry/cooldown policy.

Healthy shared reads refresh every 30 seconds; ordinary eligible recovery targets roughly one minute while honoring
server deadlines. Explicit Retry observes its corresponding read and time boundary; it never submits a command.
Temporary failure retains readable data with its successful-read receipt/deadline in explicit UTC.
A fulfilled canceled observer refetch is not fresh authority; use the shared fresh-read continuation.

Drafts keep original/local/remote values separate. A confirmed command acknowledges submitted values; only the next
fresh admitted read grants a new baseline/token. Saved-plus-failed-refresh remains saved with blocked stale authority.
A same-actor session-read pause cannot turn a confirmed write into an obsolete result: retain its receipt and release
only the completed input while presenting the failed-refresh warning. Actual actor retirement still retires its result.
D2 compares touched current fields under locks, including useful setup fields, and preserves unrelated edits.
Native last-write request shapes remain unchanged; the shared controller adapts their distinct transport guarantees.
Read-only participant notes keep only their summary/participant selection and derive values from the current full
admitted roster, independently of search. Missing sources close the selection; organizer date edits remain genuine
local drafts. Admission denial retires feature-selected query families through the shared entry/cache owners while
preserving the producing denial even when its observer is paused.

Unknown writes never replay automatically. Reconcile/recover reads can inform review but cannot prove an unknown
creation failed. Command state and draft protection can outlive retired editors. Whole-page deletion consent precedes
the write; confirmed navigation retains its destination/receipt through canceled or failed delivery.
Dialog close checks its own draft subtree; route/identity/release departures resolve the whole affected tree.

D5 replacement detection uses ordinary session refresh and the explicit 2026-10-15 route/content classifier. Current
eligible dynamic views are Overview, Packing/Drivers/Survey/Activity detail, and Event detail/admin; creation, duplication,
user-management, Help and static error/completion presentations are excluded. Eligible pages still require clean
drafts, no pending/unknown command and working loop protection. Compatible mounted edits may finish; missing lazy
chunks or incompatible commands preserve drafts and guarded deliberate recovery on every page. Periodic content
reads and session/security revalidation retain their existing contracts.

## Localization and native rendering

English/German UI/API text uses the same typed translator and request/application-local i18next-vue binding.
The current preference is a browser cookie; account/guest persistence and full email/PDF/Pug localization are future
work. Locale changes translate labels in place without replacing drafts, focus, selection, dialogs or machine values.

Pilot articles/images are reviewed runtime content under `docs/user-guide/<locale>/`, selected by the same catalog's
`help.directory`. Each language owns its content, stable anchors, search snippets, captions and raster assets.
Native English Help remains unchanged. Staged maintainer documents are never selected, searched, served or packaged
as runtime Help. Adding a language requires a complete catalog and generation. Complete localized Help is preferred;
missing corpora/articles/required figures select the complete reviewed English article with all its own assets,
visible localized disclosure and English navigation/search markers. The explicit Oct13 amendment supersedes the
earlier individual-figure fallback; authored local references and asset requests stay within one language.
The chosen interface locale remains selected and actual article language is explicit.
Unsafe existing translated content still fails validation. The direct decision is retained in the foundation ledger.

Read-only Help GET/search, article links and anchors work without JavaScript and hydrate the same Vue components.
Under the [refined Req6A delivery amendment](FRONTEND_FOUNDATION_DESIGN.md#authorized-interactive-startup-delivery-clarification-2026-10-13),
initial interactive Packing, Overview and identity/guest content uses shared skeletons until client initialization.
Genuinely functional static content/messages remain available; JavaScript-only shell controls wait for initialization.
Disabled JavaScript or failed loading/initialization exposes an independent localized JavaScript-required notice,
with no normal-looking dead controls or navigation. Existing mounted drafts and warm recovery behavior remain.
The eight unused interactive pilot POST fallback adapters retire while API commands, native/shared backend operations
and identity/capability/provider admission GETs remain. Actual adoption and current verification belong to the review;
SSR technology/build/dependencies remain, with no operative interactive fallback promised.

## Verification and further migration

Focused Help/frontend/type/build checks are recorded in the [review](PILOT_PARITY_REVIEW.md);
shared operations/method policy, approved coexistence locking and safe public-action parity are implemented. Final
execution evidence is owned by that review. Historical suite counts/captures do not
certify changed inputs. Report actual commands, source scope, failures and
unmet prerequisites; hosted CI, deployment replay and live providers/mail are separate claims.

Follow the [migration contribution handoff](FRONTEND_FOUNDATION_DESIGN.md#migration-contribution-handoff) for each next
slice, the [Testing amendments](staged/TESTING_GUIDE.md#risk-and-test-cost) and unchanged
[canonical assertion guidance](../TESTING_GUIDE.md#assertions-and-isolation) for unique detection value.
Preserve behavior-inventory IDs for contract traceability, native comparison and feature exceptions; native DOM
identifiers are not a parity obligation. Default-route cutover requires complete feature
parity and direct authorization. Reconcile the amendments and independently review complete temporary output before
verbatim cutover under the
[current staging amendment](FRONTEND_FOUNDATION_DESIGN.md#authorized-amendment-staging-and-risk-mitigation-2026-10-14);
production documents are not edited for migration. Documentation reports never gate application delivery.
