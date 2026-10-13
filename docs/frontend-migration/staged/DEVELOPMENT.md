# Staged frontend development guidance
<!--
documentation-metadata
audience: maintainers; frontend developers; API developers; AI coding agents
owner: application maintainers
status: migration-pending
last-verified: 2026-10-13
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: existing migration recipe extended with approved readiness read admission, derived privacy, scoped locale recovery, shared action adoption, generated comparison constraints, settings ownership and visible temporary Packed-state fallback; execution owned by review
source-anchors: package.json; src/controller/packingController.ts; src/modules/database/services/; contracts/api/v1/; src/frontend/; src/modules/frontendPilotRenderer.ts; src/modules/frontendDevelopment.ts; scripts/watch-frontend-inputs.mjs; src/types/; tests/integration/packing-public-actions.spec.ts; tests/integration/packing-coexistence.spec.ts; tests/e2e/frontend-pilot-api.spec.ts; docs/DEVELOPMENT.md; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md
next-review: frontend-production-cutover
canonical-merge-target: docs/DEVELOPMENT.md
production-reference: 2dfa257 native documentation; not evidence of an installed production commit
-->

## Cutover staging

This is the migration delta and single contribution playbook for [Development](../../DEVELOPMENT.md).
Use canonical guidance for unchanged checkout setup, settings, database safety, native modules and domain-specific
implementation. Do not copy those sections here. At authorized cutover, merge relevant guidance into the existing
canonical sections, reconcile intervening changes and remove this copy. Staged documents never become runtime input.

Native implementation, canonical/user/AI documents and images remain the reference, subject only to explicit
exceptions in the [foundation ledger](../FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments).
One canonical Help tree holds native English at `docs/user-guide/` and reviewed pilot languages in its catalog directories.
Editorial cleanup is authorized; pilot technical changes stay staged and native guide prose/assets remain the comparator.

Packing now demonstrates named shared business operations and central method policy inside its existing controller,
with independent native/v1 transport adapters and pure DBAL. Existing administration/event/image owners supply shared
behavior at their own boundaries. The handoff below follows that implementation and its approved bounded lock remedy;
final acceptance remains in the review. Subsequent modules reuse these owners rather than copy backend logic.

## Normal development and generated sources

Use the root `npm run server` workflow: initial build, Express/Vite middleware and HMR, native browser watcher,
and serialized contract/catalog regeneration. Authored-input completion triggers Express restart; generated outputs
must not restart it mid-generation. Source serving explicitly uses `vite.config.mts` and the project root.
Production runs matching built artifacts through Express without a Vite server.

Authored OpenAPI/YAML and catalog JSON are single sources. Package generation creates declaration files, validators,
operation policy, typed translation keys/parameters and runtime resources. Generated output stays ignored.
Use `npm run prepare:frontend` for the contract/catalog boundary and the exact build/type/test scripts in
`package.json`; do not hand-edit generated files or assume a direct runner invocation prepares them.

Normal locale generation retires only its known compiled `permissions.js`/`.js.map` siblings before publishing current
`permissions.ts`; extensionless imports must not select a stale emitted copy. Exact output-root paths, entry types and
real parent containment are checked before removal. `--check` reports a collision without rewriting/deleting it.
Preserve the whole authored-tree collision regression and unrelated generated neighbors; do not add an exclusion or
general directory cleanup to obtain a pass.

Keep browser, native assets, server and SSR outputs separate. Client and SSR use the same release/compilation mode.
Production dependencies must include packages externalized by SSR; standalone validators include runtime helpers
without compiling schemas at startup. No database entity, settings secret, filesystem or server-only import may
enter the browser graph.

## Implementing the next feature slice

Use one authorized route family and the [behavior/edge-case baseline](../FRONTEND_MIGRATION_BASELINE.md#using-the-baseline-for-a-migration-slice).
Help/Packing are the current complete slice; other scaffolds remain future increments.
Resolve conflicting instructions and potentially unintended consequences directly before dependent implementation.
A document, test expectation or implementation result cannot supply user permission.

| Handoff | Existing owner |
|---|---|
| Wire shape → generated types/validators | `contracts/api/v1/`, `scripts/generate-api.mjs`; import declaration contracts directly. |
| Business operation → permitted projection | Existing feature controller; native/v1 adapters translate transport around one named policy owner. |
| Locked context → checks/write | Existing DBAL transaction/lock operation invokes a named controller callback. |
| DTO → browser operation | `features/<feature>/api.ts`, shared `app/transport.ts`, generated operation/feature validators. |
| Entry/read → authorized view | `composables/pageEntry.ts`, `app/queryKeys.ts`, `app/queryCache.ts`; feature supplies policy/dependencies. |
| Snapshot → draft/command/recovery | `metadataDraft.ts`, `command.ts`, shared feedback/confirmed-navigation/read owners. |
| Route → SSR/hydration | Existing Express pilot route/renderer and `app/createApp.ts`, `mountPreservingDrafts.ts`. |
| Repeated interaction → presentation | Shared components/composables; explicit props/events and injected operations. |
| Language → UI/server/Help | Catalog, shared translator, i18next-vue and reviewed runtime corpus. |

Frontend paths in this table are relative to `src/frontend/`. Create a module only when an existing logical owner
cannot comfortably hold its responsibility. Do not add another router, HTTP wrapper, state store, controller,
validator or service simply to make this table symmetrical.

Packing supplies the concrete backend handoff example. `packingMethodPermissions` in its existing controller owns
action requirements consumed by native middleware, v1 checks and capability projections; root property fields reuse
the existing administration field policy. `savePackingMetadata`, `addPackingItem`, `applyPackingItemPatch` and
`applyPackingMembership` own the corresponding writes/checks. Native/v1 adapters retain normalization, error/feedback
and conditional-write differences. Existing reorder/remove/default operations accept the service-managed transaction
when v1 coordinates more than one write. `eventController.authorizeEventLink` checks the locked destination, and
`entityAdminController.applyEntityAdministrator` returns domain outcomes for each adapter's own response mapping.
These are owning operations, not forwarding wrappers or business rules in DBAL. A next feature follows its own native
policy and contracts rather than copying Packing's grants or persistence shapes.

The existing `entityAdminController.entityMethodPermission` supplies common header, event-link, permission-management
and duplication requirements. Native header/duplicate factories, administrator middleware and Packing's method map
consume this owner. Keep actor/profile admission and feature exceptions alongside their established consumers; a
shared grant does not imply a shared page-admission rule.

For each mutation, keep a short compatibility account in the feature's contract/test evidence: native decoding,
actor/page/action grants, normalization, no-op outcomes, lock/check location, response/feedback and destinations.
Mark intentional native/v1 protocol differences and inherited defects explicitly. The current map in
[Test Coverage](../TEST_COVERAGE.md#pilot-baseline-to-implementation-assertions) links this handoff to precise assertions;
the review owns actual execution and remaining limits. Do not leave duplicated backend operations for a later cleanup.

1. **Trace the native contract.** Follow page GET, form POST, collectors, controller, DBAL and rendered controls.
   Compare the complete native delta against `2dfa257`, including committed drift. Identify each approved exception.
   Include owner, guest and restricted actors, field coercion, omitted/null/false, no-op outcomes, destinations,
   feedback, focus and hidden/empty/archived states. Peer features are evidence to inspect, not a universal policy.

2. **Expose the smallest useful read through shared policy.** Author the operation/schema once in its v1 YAML.
   Reuse the owning controller projection and method permission definition; do not serialize entities, sessions,
   permission internals or hidden edit data. Keep contextual validation/errors in the controller.
   Read/page admission and independently granted action admission remain distinct where native behavior requires it.
   Native/v1 adapters preserve transport differences without copying business decisions.

3. **Connect the scoped browser operation.** Use generated operation declarations/validators and the app-local
   transport. Capture identity/resource/route scope and pass the same AbortSignal through HTTP decoding,
   classification and cooldown owners. Query keys contain actor/resource/meaningful filters; locale belongs only
   to language-owned content. Shared keys/families name dependencies without teaching generic owners a feature.

4. **Wire entry, routing and SSR before editing.** Extend explicit Express/Vue routes rather than a wildcard HTML
   fallback. Preserve provider, token, email-link, print and download boundaries. Entry preflights use shared
   `usePageEntry` where the native journey has an admission decision; public read-only views can use a direct query.
   Request-local SSR renders the same Vue tree and makes no self-HTTP call. Initial seeds check live document/scope
   eligibility when evaluated; Back, eviction or an actor change cannot replay retired SSR data.

5. **Complete read/recovery behavior.** Start queries only when identity, hydration, visibility and activity permit.
   Retire obsolete generations and preserve server cooldowns. Missing pending data uses shared skeletons;
   temporary failure retains confirmed scoped data/drafts and its stale notice. Validated denial clears private
   content. Explicit Retry is an eligible read only and observes its actual deadline and last successful receipt.
   A canceled observer refetch may fulfill with retained data; fresh authority requires a new admitted read.

6. **Add independent drafts and commands.** Use the existing draft/command owners, with feature field normalization
   and operation-specific feedback. Original, local and remote values stay separate. D2 compares touched fields
   under locks; financial/recommendation commands retain their separate revisions/reviews. Submit deliberate changes.
   Confirmation acknowledges submitted values; only a later fresh read supplies current grants/token/baseline.
   Failed refresh remains a saved command with stale authority. Unknown delivery never automatically replays.
   Independently granted writes need independently granted baseline reads. Filter both values and comparison
   hashes by the actual method policy; do not require broader detail admission or a token obtained before revocation.
   Packing's item/order, defaults, single-admin, header and description baselines demonstrate this without disclosing
   unrelated fields, assignments, rosters or parent metadata. Actor admission follows each native method, not one
   blanket profile rule; public tokens bind the captured context and never a common anonymous identity.

7. **Compose native presentation through shared contracts.** Reuse fields, inline editors, dialogs/tabs, action
   buttons, permission matrix, pickers, skeletons, notices and images where behavior is shared. A feature supplies
   values/capabilities/events/operations; the control owns visual/accessibility interaction, not authorization.
   Match labels, input attributes, no-op behavior, ordering, spacing, disclosure, focus and responsive geometry.
   Keep complex feature composites separate when their semantics differ.

8. **Verify the changed boundary and hand off.** Apply [risk and test cost](TESTING_GUIDE.md#risk-and-test-cost),
   preserve unique assertions and inspect the actual production consumers of shared corrections.
   Check compiler scope honestly and compare affected native/pilot scenes using the same records/actors/sizes.
   Obtain a final review by someone who made none of the corrections. Record actual commands, failures and limits in
   the existing review; update these staged owners and retire completed sequences without another report/registry.
   A passing build, helper test or screenshot alone does not establish feature completeness.

When coordination changes, enumerate every native/v1 writer and actual lock order, including self/admin removal,
item deletion, relationship changes and foreign-key locks. A comment claiming a shared lock is not scheduling
evidence. Use controlled milestones in the real disposable-DB operation path to distinguish a source inference,
reproduced failure and verified bounded remedy. Preserve native coercion/outcomes and disclose any potentially
unintended lock or access consequence directly before dependent implementation.

The approved 2026-10-12 Packing example now takes native list-S before item-X; v1 keeps root-X before item-X.
The production coexistence cases exercise both arrival orders, parallel native items, deletion during root discovery,
native self/admin removal and later item overwrite. Preserve those schedules when touching these owners. Copying the
root lock to every writer would change native concurrency; a new module needs its own inspected writers and approval.

The approved [same-event no-op decision](../FRONTEND_FOUNDATION_DESIGN.md#authorized-same-event-no-op-clarification-2026-10-13)
is an operation-specific exception. Current source/target permissions still precede a harmless result; reviewed
comparison is required only when that association actually changes. Preserve the native adapter's no-op outcome and
do not generalize this exception into a command retry or precondition bypass.

### Worked extension: one metadata field

Adding an editable field follows one coherent path:

1. Inspect its native input policy and owner/restricted behavior. Decide whether the wire contract actually changes;
   reuse a generated field if it already exists.
2. Update the owning YAML request/projection once and generate consumers. Keep sparse omission versus explicit clearing.
3. Extend the named shared controller policy/projection and field permission definition. A contextual check against
   current locked state belongs in its controller callback inside the existing DBAL transaction.
4. Add catalog messages and bind the shared field in the feature editor. Supply normalization to `MetadataDraft`
   only when the field needs it; dirty comparison and submission use the same meaning.
5. Run the existing named command and fresh-authority continuation. Test unrelated remote changes, overlap, denial
   and confirmed-save/failed-read only where those distinct risks cross the changed boundary.
6. Compare the actual mounted native/pilot control and update the affected staged delta.

A read-only slice stops before editor/command work, but still owns admission, privacy, cancellation, retry,
localization and visual behavior. No universal CRUD engine or wrapper per HTML element is needed.

## Backend and method-policy contracts

Controllers own business rules, authentication/authorization decisions, contextual validation and user-facing errors.
DBAL services own queries, locks, transactions and persistence; no APIError/ExpectedError or UI-specific exceptions.
When authorization depends on locked context, pass a named controller operation into the existing service-managed
transaction rather than checking outside the lock or moving policy into the service.

The approved shared-backend target uses central method permission definitions inside the existing controller.
Native/v1 entry points consult those definitions. They may decode/coerce differently, return different envelopes or
apply v1 preconditions, but must not independently decide capacity, ownership, deletion or access policy.
Page membership must not silently narrow a separately granted native action; edit-token projections remain private.

Follow each policy definition to its production consumers, including generic factories, header preflight/write,
duplicate entry, administrator changes and relinking. Shared operations alone do not remove a copied permission
literal. Derive the rule through its existing controller owner and pass it into a factory when needed; preserve other
features' defaults, actor requirements and deliberate exceptions. Generic middleware must not import a feature's
controller merely to discover its policy, and no DBAL owner may choose the grant.

Conditional-header limits are authored contract constraints, including the full token emitted by metadata/settings
reads. Reuse generated schema/operation validation through the existing transport and comparison owner. A decoder's
safety bound must agree with the wire shape rather than silently reject the application's own issued token. Verify
generated input/output consumers with a realistic full token and an oversized rejected token.

The [approved 2026-10-12 amendment](../FRONTEND_FOUNDATION_DESIGN.md#explicit-canonical-location-and-action-decisions-2026-10-12)
replaces the initial pilot's blanket profile requirement only where existing native methods permit public grants:

| Packing admission boundary | Implemented scope |
|---|---|
| Captured context; optional profile; fresh method grant | Item edit/order/delete and their minimal baselines; administrator assignment removal; default/admin CRUD and scoped baselines; account-profile discovery; header baseline/preflight/write; description-only GET/PATCH. |
| Active profile and existing operation policy | Full detail, metadata, settings and header bytes; mixed metadata writes, creation/Quick Add, self-assignment, archive/restore, event changes and owner deletion. |
| Existing entry policy | Session/Help and create/resource/duplicate entries retain their declared native admission; a duplicate GET does not grant account-only creation. |

Public baselines carry only the method's values/hashes and bind the captured context; profile tokens preserve their
established scope. Context checks, mutation CSRF, conditional comparisons and authorization before `304` still apply.
Header admission runs before upload bytes and again under the write lock. Scoped account-profile discovery reuses
the native 120-search/10-minute per-IP limiter: native text stays native, and v1 emits its localized Problem.
Do not generalize this matrix to another feature or expose its full settings page merely to obtain one edit token.

Existing native permission inconsistency is tracked as `IMP-022`; reuse that register entry and preserve native
behavior until its separately approved remedy. A displayed/disabled control is never server authority.
Inherited parent permissions, owner, guest, archive, personal hide and permanent deletion remain distinct concepts.

Preserve deletion in its existing feature service and keep file retention separate from archive/restore.
The bounded archival and approved native assignment remedies do not authorize a general lock framework. Any coexistence scheduling
change needs the actual native/v1 interleaving and existing policy preserved.

Shared type-only contracts remain declaration files under `src/types/`. Use neighboring interface/type conventions.
Optional feature state uses renderer `data` and explicit Pug mixin arguments; keep `res.locals` for common request
infrastructure. Pug comments are unbuffered and explain data, branches and browser hooks.

## Entry, canonical delivery and native outcomes

Keep native admission and canonical navigation separate from temporary resource reads.
Capture the intended destination/notice once; commit it only through the shared confirmed-navigation owner.
Failed or canceled delivery retains that same completion, including across actor remount, without replaying a command.

Preserve exact duplicate return through the approved shared guest-flow owner/forms. Preserve surveys' exceptions.
Invalid guest tokens and expired stored identity keep their known native status/message/provider boundaries.
Read retries cannot consume a reset/activation/guest capability or submit a creation.

A configuration-denied login/register journey uses the native full error presentation, not an invented empty form.
Confirmed recovery/guest registration uses its native canonical destination; inline success on the old form is
not equivalent. Pending/unknown states retain inputs and explicit review.

Fragments and modified-click hrefs preserve ordinary navigation semantics. Region navigation reads a target before
history commit, merges only its region into current query state and adopts server-clamped pages/parent removal.
Failure or obsolete response leaves the current URL/cards/focus intact. Search draft/caret and sibling regions survive.

## Commands, drafts and retained work

Use application-root draft protection with feature/dialog subtrees. Dialog close resolves its own work; route,
identity/update and whole-page destructive departures resolve every affected descendant.
Pending/unknown command state may outlive an editor; retiring a component does not certify delivery.

Obtain whole-page deletion consent before writing. Retain confirmed deletion/creation destination and one-time
receipt through failed navigation. Do not discard other drafts because a button was hidden or capability changed.
Field write loss disables saving while readable drafts remain cancelable; actor/read denial retires protected state.

Unknown outcomes are reviewed through reads. Reconcile-only recovery never retries automatically or proves an
unknown creation failed. Financial/recommendation commands preserve their specific revision/fingerprint protocol.
A saved command followed by failed refresh is saved, not a failed mutation.

No-op validation/feedback precedes confirmation, cross-form discard and writes where native forms do.
Preserve empty/null/false/omission independently. Machine/raw number drafts must survive framework coercion:
inline capacity acceptance, creation bounds and SQL persistence are different policies.

## Read authority and recovery

Packing's checklist keeps its native browser-local keys and remains separate from query snapshots and server
assignments. Follow the [approved temporary fallback](../FRONTEND_FOUNDATION_DESIGN.md#authorized-temporary-packed-state-fallback-2026-10-13)
when browser storage is unavailable or throws: preserve checks only for the mounted actor/list visit. Show a
persistent localized notice explaining the load/save failure and possible loss of unsaved changes on leave/reload
or account/profile change. Failed reads cannot establish that previously stored or successfully written checks
are unpersisted. Successful rereads still observe external changes; a real missing key is unchecked unless a failed
toggle write still owns that item's selected value. Explicit Retry reattempts outstanding browser-storage writes
and reads only; keep the notice while reads fail or writes remain outstanding. Background reads never replay them.
Before a retained local callback writes, check its mounted actor, admitted current list and live/rendered row;
Retry prunes removed rows before retrying. Dispose fallback and pending writes on list/context change, unmount or
admitted-resource retirement. Preserve profile-independent persisted keys and keep this state outside the server.

Authorized cache data is presentation, not perpetual command permission. Controller admission rechecks every write.
Identity/profile/resource/route generations retire reads, caches and tokens; a late response cannot repopulate them.
Language-independent machine state uses one authority across languages. Locale-owned Help/Overview projections have
their own locale keys; a prior-language grant cannot restore revoked edit authority.

Presentation readiness and automatic-read admission are separate. Focus, visibility and reconnect recovery first
require a current successful session bootstrap before private queries resume. A pending, failed or cooldown-blocked
bootstrap cannot reopen those queries. Retain mounted readable data and drafts during ordinary revalidation;
validated identity change still retires the old actor. Apply this admission to every automatic query consumer, not
only the explicit refetch continuation, and keep server Retry-After and observer disposal intact.
The existing app context's `readsReady`/`mayRead` contract supplies that gate; `ready`/`isCurrent` retain their
presentation/result-generation responsibilities. Automatic query consumers use `useQueryAdmission` in the existing
query-cache owner. It applies `mayObserve(key, firstRead)` per mounted logical-key visit: a fresh visit gets its own
GET despite a cached terminal failure, while a dispatched or joined pending read consumes that first admission.
An equal recreated key does not start another visit. Later session resumes keep terminal failures paused.
Deliberate manual recovery uses `mayRead` within its read deadline.
The shared transport also checks dispatch admission, while an already admitted image/picker operation retains its
captured lifetime during ordinary bootstrap pause. Actual actor/input/visibility retirement still disposes it.

Explicit command-dependency refresh uses each actual observer's key-bound `surveyorRead` metadata, with current
eligibility and disposal rechecked after cancellation. A terminal-paused readable observer can recover through its
own authored query function; hidden, closed, retired and changed-key observers cannot. Do not select query-level
last-writer options or create a parallel query-policy registry.

Forward cancellation through decoding and classification. A fulfilled TanStack observer refetch can contain canceled
retained data; fresh continuation uses the existing query-cache owner (`refetchFreshQuery`/`refetchFreshQueries`).
Await the actually dispatched admitted read, retaining command/authority fences until it settles.
Equal successful data can restore authority; object identity, timestamps or idle flags alone cannot.

Temporary errors retain confirmed readable data and raw drafts with the last successful scoped receipt.
Validated denial retires private projections/entry variants. Only another admitted read restores them; cache aliases
and stale SSR seeds cannot. Review readable-data loss separately from write loss.

Retire derived membership totals, hidden badges and related counts with the projection that supplied them. A denied
region must not leave its previous private aggregates visible after its cards/cache disappear. Derive current
presentation from admitted source scopes/receipts through the existing feature owner; do not mirror server counts in
a second store. Temporary failure retains confirmed scoped evidence, while independently admitted siblings retain
only their own evidence. Unknown membership has no zero/count/empty assertion.

Healthy active shared queries use the 30-second cadence and eligible recovery within roughly one minute.
Honor Retry-After, hidden-tab pause and observer disposal. Safe reads may retry; commands do not.
Use shared `useReadRetry`/`useReadRetryAt` and notice controls for actual eligible GETs.
The deadline timer changes availability, never starts a GET or renews unrelated feedback.

## Bootstrap, hydration and scoped completion

Each SSR request owns app, router, query client, translator and authorized bootstrap.
Escape script delimiters in bootstrap JSON. Do not serialize persistence/session/private edit data through convenience
objects. Locale/request state cannot live in a singleton that leaks between users.

The shared mount preserves pre-hydration drafts on their original controls; explicitly opted-in non-text/file controls
use `data-hydration-draft`. Hydration recovery does not upload files or submit commands.
An SSR seed is eligible only for its live document/actor at use time, not because a captured closure once matched.

SSR parent aggregates use the same admitted QueryClient projections as child regions. Seed only the currently eligible
initial document before parent badges render; Page/Region share `overviewQueryParameters` from the existing Overview
API owner so their generated query keys identify the same data. This does not turn an old seed or manual cache write
into fresh post-command authority.

Express serves native static/Help resources; Vite transforms entry/style URLs before inserting the Vue tree.
Test the actual emitted URLs and mounted usable controls, not a hydration marker. Keep HMR and authored-input restart
checks conditional on changes to those owners, rather than rerunning them for every module.

## Progressive loading and shared placeholders

Initial interactive HTML waits for authoritative session bootstrap, not every independent feature projection.
Overview active regions load in parallel; unopened hidden regions wait. Read-only Help retains complete SSR.
Resource data arrives through the owning scoped query without renderer self-HTTP requests.

Use `LoadingSkeleton` for missing pending data. Its shapes are decorative, with one localized status; they invent no
records, membership count or command. Respect reduced motion and existing responsive geometry.
Do not replace readable same-resource content/drafts on ordinary background reads or display a false empty state.

Independent siblings render when ready. Initial failure has a clear error/retry; unknown membership has no zero count.
Identity/resource transitions cannot retain another scope's content. Same-resource locale refresh may retain user
values/machine state while labels react; article content must match the selected corpus or its visibly disclosed
approved English fallback, with actual content language identified.

## Shared presentation, feedback and images

Shared controls have explicit data/capability/value/event contracts. Generic controls cannot import feature API
owners or choose private query families; inject the operation and let the feature name its affected resources.
Keep feature-specific validation and financial semantics out of generic form/inline/action components.

Extract a settings composite when an actual repeated interaction can share its data, events and injected operations.
The composite shares repeated presentation and local interaction, preserving focus through established controls and
dialog owners; the feature retains query dependencies,
authorization inputs, draft reconciliation and command orchestration. Preserve independent tab/panel drafts and native
layout. File size alone does not establish a new module boundary, and extraction must not create a universal CRUD
engine, forwarding controller or backend service.
`EntityHeaderEditor`, `EntityEventEditor` and `EntityLifecycleActions` demonstrate this presentation/event boundary;
their props contracts live in `src/types/FrontendEntitySettingsTypes.d.ts`. Packing supplies admitted state, independent
file/relationship drafts, lifecycle commands, injected event discovery, tokens and labels.

Match native feedback per operation. Inline notices own Close/focus/scroll placement and a live fallback when their
initiator detaches/hides. Full flashes keep native presentation. Capture initiating elements before awaits.
Receipt identity controls dismissal/renewal: repeated outcomes renew, locale/render changes do not revive notices.
Confirmed destinations/receipts survive failed delivery; warnings clear only through their own successful recovery.

Dialogs share one focus trap/dismissal owner, pending close lock and actual invoker return. Features can supply the
native body-field initial target. Tabs retain independent drafts and freeze while necessary work is pending.
Avoid simultaneous Vue/Bootstrap DOM ownership. Mixed navigation disclosures keep their established native key policy.

Authorized images use the shared injected read/lifetime owner with cancellation, generation checks and object-URL
cleanup. A missing optional image does not fail the whole resource. Equal successful reads can restore a failed
image; access denial cannot be repaired by a retained URL or foreign-scope result.

## Localization and runtime Help

One catalog per language supplies UI/API text, generated keys/parameters and fixed `help.directory`.
Use the shared typed translator and request/application-local i18next-vue binding; no second frontend/backend dictionary.
Plain interpolation remains escaped; locale changes preserve drafts, focus and machine-value parsing.

Cancel/invalidate only named language-owned query families from the existing query-key owner after a confirmed locale
change. Machine values, user-authored titles, event options and edit authority retain their existing language-independent
keys and in-flight reads. Avoid tuple-position matching or a second family registry. A locale change must not cancel
the fresh post-command read that restores metadata/settings authority merely because labels were translated.
`belongsToLocalizedQueryFamily` selects the existing Help/Overview families from the query-key owner.

One fixed `docs/user-guide/` tree contains native English and adjacent pilot EN/DE catalog directories, reviewed and
packaged with the application. Native guide prose/images remain the reference. Staged maintainer drafts are never searched,
read, served or selected by the application. Runtime source/security tests use independently specified synthetic
fixtures rather than maintained prose or expectations taken from the source selector under test.

Prefer complete localized articles, stable anchors, search text and raster images/captions/alt descriptions.
Missing corpora/articles/figures use reviewed pilot English with the localized fallback notice, English navigation/search
markers and actual `contentLocale`; retain the selected interface locale. Invalid existing localized content fails
rather than fall back. Source directories stay fixed and staging cannot supply missing content.
Keep user-facing prose/pixels task-focused; provenance/framework/API/storage/permission internals belong in maintainer
records. Any changed picture requires individual full-resolution and reduced-size inspection.
Persisted principal preferences, email/PDF and application-wide localization remain future work.

## Baseline-to-observable verification

Use [Testing](TESTING_GUIDE.md) for layer selection and actual compiler scope. Test outcomes at production consumers:
shared helper adoption, cancellation, authority, focused control behavior and native/v1 scheduling where affected.
Transfer unique assertions before retiring similar tests. Financial/destructive/privacy/authorization/concurrency
boundaries remain protected; mocking persistence is not a substitute for real disposable-DB evidence.

Compare affected native/pilot views with identical records/actors/desktop-mobile sizes. Inspect original images,
labels, keyboard/focus, validation/no-op behavior and confirmed/unknown delivery. A screenshot capture success is
not visual approval. Disabled JavaScript retains readable Help and the approved interactive message/read-only contract.

Follow all review criteria in the [paired review](../PILOT_PARITY_REVIEW.md#all-requested-review-criteria).
Record source scope, commands, results, failures, prerequisites and independent reviewer provenance.
The paired review owns latest execution and any remaining limits; do not narrow checks, repeat superseded run history
or claim unrun suites. Source implementation and focused passes do not certify the final build/browser run.
Documentation reports are optional and advisory, never required application tests or CI/release gates.
