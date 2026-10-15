# Staged frontend development amendments
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-15
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: maintainer-corrected definition freedom distinguished from implemented transport; shared action-state and native profile-operation reuse guidance retained; no new runtime transport or cutover verification
source-anchors: docs/frontend-migration/documentation-boundary.json; docs/frontend-migration/check-documentation-boundary.mjs; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; src/frontend/; contracts/api/v1/; scripts/generate-api.mjs; src/modules/api/transport.ts; src/modules/localization/translator.ts; src/routes/api/v1.ts; package.json
next-review: next-authorized-migration-slice-or-cutover
-->

These amendments retain the reviewed frontend guidance without copying unchanged production procedures.
The [profile](../PROFILE.md) governs preparation and review; its [manifest](../documentation-boundary.json)
owns destination mapping and exact operations. Payload links use their mapped production location.
Surrounding notes use this file's location. Preparing complete temporary output does not authorize cutover.

## Components, contracts and browser state — amendment-01

<!-- delta:amendment-01 -->
### Components, contracts and browser state

Keep visible labels, field names, controllers and Help aligned. Features live under `src/frontend/features/`; their
`api.ts` owns generated operation/validator selection and uses `app/transport.ts`. Shared components/composables accept
explicit values, capabilities, events and injected operations. They own presentation/accessibility, not feature
endpoints or permission policy. The following contracts describe how those owners work together; the
[Architecture](ARCHITECTURE.md#frontend-architecture) defines the wider runtime boundary.

#### Ownership handoffs

| Handoff | Existing owner |
|---|---|
| Wire shape to generated types/validators | `contracts/api/v1/`, `scripts/generate-api.mjs`; import declaration contracts directly. |
| Business operation to permitted projection | Existing feature controller; transport adapters use its named operation and method policy. |
| Locked context to checks/write | Existing DBAL transaction/lock operation invokes a named controller callback. |
| DTO to browser operation | `features/<feature>/api.ts`, `app/transport.ts`, generated operation and feature validators. |
| Entry/read to authorized view | `composables/pageEntry.ts`, `app/queryKeys.ts`, `app/queryCache.ts`; the feature supplies policy/dependencies. |
| Snapshot to draft/command/recovery | `metadataDraft.ts`, `command.ts`, shared feedback, confirmed-navigation and fresh-read owners. |
| Route to SSR/hydration | Existing Express route/renderer, `app/serializeBootstrap.ts`, `createApp.ts` and `mountPreservingDrafts.ts`. |
| Initial content to usable controls | `app/context.ts` initialization helpers, route metadata and existing shell/shared controls. |
| Repeated interaction to presentation | Shared components/composables; explicit props/events and injected operations. |
| Language to UI/server/Help | Catalog, shared translator, i18next-vue and reviewed runtime corpus. |

Frontend paths in this table are relative to `src/frontend/`. Create a module only when an existing logical owner
cannot comfortably hold its responsibility. Do not add another router, HTTP wrapper, state store, controller,
validator or service simply to make this table symmetrical. Reuse existing styles, logo/favicon and pure browser
helpers through their actual owners rather than copying them into a frontend-specific asset tree.

#### Contract authoring and generated consumers

Author wire shapes and operation policy once in OpenAPI 3.1.1 with JSON Schema draft 2020-12 under
`contracts/api/v1/`. The [framework decision](decisions/DEC-006-FRONTEND-FRAMEWORK.md#shared-api-contract-decision)
retains the original toolchain choice and alternatives; executable package scripts own exact dependency versions.

| Input or generated artifact | Responsibility |
|---|---|
| `openapi.yaml`, feature YAML and `common.yaml` | Operation IDs, paths, security, statuses, media, feature shapes and genuinely shared subshapes. |
| `.generated/api/v1/openapi.json` and `operations.json` | Bundled local description and derived operation/schema metadata; packaged with the matching server validators. |
| `src/types/api/v1.d.ts` and `validation-v1.d.ts` | Runtime-free wire declarations and validator signatures referring to those declarations. |
| `.generated/api/v1/server.cjs` and `browser/` | Standalone server validators and lazy browser validators compiled from the same authored constraints. |
| Existing server transport and feature `api.ts` | Decode declared transport, select generated validation and present outcomes around the existing business owner. |

`scripts/generate-api.mjs` parses local YAML, rejects duplicate keys/remote references and uses Redocly to lint/bundle
the description. openapi-typescript emits declarations without runtime enums. Strict Ajv 2020 plus ajv-formats
compiles standalone validators and their required runtime helpers. Feature chunks load their own validators;
neither the browser nor server startup compiles schemas. openapi-fetch consumes the generated paths while
`app/transport.ts` supplies headers, runtime validation, cancellation and status classification, retaining the Response.
Types alone cannot validate received JSON. Do not introduce another schema language, validator configuration or router.

Use explicit scalars, object properties/required, arrays, local references, enums/const, bounds/patterns and simple
tagged `oneOf` unions. JSON null uses a type union rather than OpenAPI 3.0 `nullable`. Mutation bodies reject unknown
fields; browser response validation accepts compatible additions while error parameters retain their authored shape.
Separate create/update/read semantics and permitted projections. Avoid recursive polymorphism, arbitrary maps,
deep `allOf`, remote references and custom executable vocabulary; `readOnly`/`writeOnly` cannot enforce disclosure.
These shape preferences require author/reviewer judgment, not generator bans on arrays, objects or unions.
Strict Ajv validation still rejects unknown schema vocabulary. Do not disable strictness or enable coercion,
default insertion or additional-field removal. Timezone existence and cross-field business checks remain named
controller operations.

Two implemented constraints preserve existing field behavior. Registration/reset author
`x-surveyor-min-length-utf16: 8`, because native password validation counts UTF-16 units; ordinary JSON Schema string
bounds count code points, and passwords acquire no maximum. Existing-item capacity admits the number/string/null
primitive union and passes the raw scalar to the existing signed nullable SQL column. Database rounding/range/failure
remain authoritative; creation/new-item validation stays separate. Do not generalize either extension into coercion
or a copied database-limit policy. Native metadata diagnostics remain owned by their native adapter.

The current HTTP adapter decodes single scalar path/query/header values, JSON and Packing multipart, and delivers
JSON or scoped binary image responses. Creation decodes the `data` JSON part once against its authored nested schema
and handles `image` separately. Repeated query parameters, absent/empty values and malformed input stay distinct.
The maintainer's [2026-10-15 correction](decisions/DEC-006-FRONTEND-FRAMEWORK.md#maintainer-correction-2026-10-15)
clarifies that removal of unused implementation did not authorize definition restrictions. Parameter schemas may
use arrays, objects and unions; response definitions may declare media such as `text/plain`. Generating their
contracts, metadata and validators does not restore repeated-query-array decoding or plain-text response delivery.
Validate actual standalone consumers and compile-time null/false/optional/tagged cases rather than handwritten copies
of the wire contract.

Use each operation's declared status/media rather than the native envelope. Handle `204`/`304` before JSON parsing;
HTML `200` or invalid delivery cannot confirm a command. RFC 9457 Problems keep code/status/messageKey/parameters
correlated, with safe localized detail and bounded field pointers. Unknown future errors may display validated detail
without triggering known machine actions. Credential rejection, field denial and foreign-child absence retain their
operation-specific meaning. Private localized representations carry `Content-Language`, applicable `Vary` and
`private, no-store`; cache headers never authorize data or expose validators, SQL, session or filesystem details.

For a released API version, additive response fields and optional operations can remain compatible. Removing or
renaming fields, changing their type/meaning, adding mandatory input or changing an existing operation's authorization
or outcome is breaking: obtain an explicit version/migration decision and retain the supported released contract
until consumer retirement is authorized. The unreleased-v1 correction does not authorize another pilot version.

#### Adding or changing a feature view

1. **Identify its actual contract.** Follow page admission, request parsing, controller decisions, DBAL and rendered
   controls. Include owner, guest and restricted actors; coercion; omission/null/false; no-op outcomes; destinations;
   feedback; focus; and hidden/empty/archived states. Peer features are evidence to inspect, not a universal policy.

2. **Expose the smallest useful projection.** Author the operation/schema once in its v1 YAML. Reuse the owning
   controller projection and method permission definition; do not serialize entities, sessions, permission internals
   or hidden edit data. Keep contextual validation/errors in the controller. Read/page admission and independently
   granted action admission stay distinct. Transport adapters may preserve different envelopes or coercion without
   copying business decisions.

3. **Connect the scoped browser operation.** Use generated declarations/validators and the app-local transport.
   Capture identity/resource/route scope and pass the same AbortSignal through HTTP decoding, classification and
   cooldown owners. Query keys contain actor/resource/meaningful filters; locale belongs only to translated content.
   Shared keys/families name dependencies without teaching generic owners a feature.

4. **Wire entry, routing and SSR before editing.** Extend explicit Express/Vue routes rather than a wildcard HTML
   fallback. Preserve provider, token, email-link, print and download boundaries. Entry preflights use `usePageEntry`
   where the journey has an admission decision; public read-only views can use a direct query. Request-local SSR
   renders the same Vue tree without self-HTTP. Initial seeds check live document/scope eligibility when evaluated;
   Back, eviction or actor change cannot replay retired SSR data. Use `requiresClientInitialization` and existing
   route metadata for initial content; shared controls use `useClientInitialization`. Cover shell controls as well
   as the feature body so JavaScript failure cannot leave a normal-looking action which cannot work.

5. **Complete read/recovery behavior.** Start queries only when identity, hydration, visibility and activity permit.
   Retire obsolete generations and preserve server cooldowns. Missing pending data uses shared skeletons; temporary
   failure retains confirmed scoped data/drafts and its stale notice. Validated denial clears private content.
   Explicit Retry is an eligible read which observes its actual deadline and last successful receipt. A canceled
   observer refetch may fulfill with retained data; fresh authority requires a new admitted read.

   Use the existing context-owned `useActionState` for an operation's live eligibility, pending and blocked inputs.
   Pass that state to `ActionButton` (or its disabled/pending refs to a native control), and call its `isAvailable()`
   before dispatch. The control and handler must share this decision, including session revalidation and cooldowns;
   an enabled-looking action must not silently stop at an undisclosed read gate. `usePageEntry`, `useCommand` and
   `useDocumentForm` expose their own action states so callers reuse their lifecycle decisions. Keep read admission
   in the read owner: session recovery must remain available while ordinary reads wait, local Cancel/draft controls
   need no read admission, and already admitted commands retain their captured completion lifetime. This derived
   state stores no drafts, server data or authority and never retries an operation automatically.

6. **Add independent drafts and commands.** Use the existing draft/command owners with feature normalization and
   operation-specific feedback. Original, local and remote values stay separate. Current-value comparisons check
   touched fields under locks; financial/recommendation commands retain their separate revisions/reviews. Submit
   deliberate changes. Confirmation acknowledges submitted values; only a fresh read supplies current grants/token
   and baseline. Failed refresh remains saved with stale authority. Unknown delivery never automatically replays.
   Independently granted writes need independently granted baseline reads: filter values and comparison hashes by
   the actual method policy rather than require broader detail admission or a token obtained before revocation.
   Public tokens bind the captured context, never one common anonymous identity.

7. **Compose presentation through shared contracts.** Reuse fields, inline editors, dialogs/tabs, action buttons,
   permission matrix, pickers, skeletons, notices and images where behavior is shared. A feature supplies values,
   capabilities, events and operations; controls own visual/accessibility interaction. Preserve labels, attributes,
   no-op behavior, ordering, spacing, disclosure, focus and responsive geometry. Keep feature composites separate
   where their semantics differ.

8. **Verify the changed boundary.** Apply [risk and test cost](TESTING_GUIDE.md#risk-and-test-cost), preserve unique
   assertions and inspect actual consumers of shared corrections. Check compiler scope honestly and test the
   affected mounted controls/reads/commands. Use equivalent records, actors and sizes for visual checks. Obtain an
   independent semantic review and report actual commands, failures and limits. A build, helper test or screenshot
   alone cannot establish feature completeness.

When coordination changes, enumerate every active writer and actual lock order, including self/admin removal,
item deletion, relationship changes and foreign-key locks. A comment claiming a shared lock is not scheduling
evidence. Use controlled milestones in the real disposable-database operation path to distinguish source inference,
reproduced failure and verified remedy. Do not generalize one feature's locking or harmless no-op policy to another.
Authorization still precedes an unchanged relationship outcome; reviewed comparison is needed when the relationship
changes. Resolve potentially unintended access or concurrency changes directly before dependent implementation.

#### Worked extension: one metadata field

Adding an editable field follows one coherent path:

1. Inspect its input policy and owner/restricted behavior. Decide whether the wire contract actually changes; reuse
   a generated field if it already exists.
2. Update the owning YAML request/projection once and generate consumers. Keep sparse omission versus explicit
   clearing, including null/false/empty.
3. Extend the named shared controller policy/projection and field permission definition. A contextual check against
   current locked state belongs in its controller callback inside the existing DBAL transaction.
4. Add catalog messages and bind the shared field in the feature editor. Supply normalization to `MetadataDraft`
   only when the field needs it; dirty comparison and submission use the same meaning.
5. Run the existing named command and fresh-authority continuation. Test unrelated remote changes, overlap, denial
   and confirmed-save/failed-read where those distinct risks cross the changed boundary.
6. Check the actual mounted control, its submitted value and its release/retention behavior; update affected Help
   and canonical guidance when the visible contract changes.

A read-only view stops before editor/command work but still owns admission, privacy, cancellation, retry,
localization and visual behavior. No universal CRUD engine or wrapper per HTML element is needed.

#### Backend and method-policy contracts

The [controller/DBAL rules](#controllers-and-services) apply to every transport. Central method permission definitions
live in the existing controller. Adapters can decode/coerce differently, return different envelopes or apply their
declared preconditions; capacity, ownership, deletion and access policy remain one shared business implementation.
Page membership must not silently narrow a separately granted action, and edit-token projections stay private.

Packing supplies a concrete ownership example. `packingMethodPermissions` owns requirements consumed by middleware,
v1 checks and capability projections; root property fields reuse the existing administration field policy.
`savePackingMetadata`, `addPackingItem`, `applyPackingItemPatch` and `applyPackingMembership` own the corresponding
writes/checks. Reorder/remove/default operations accept the existing service-managed transaction when an adapter
coordinates several writes. `eventController.authorizeEventLink` checks the locked destination;
`entityAdminController.applyEntityAdministrator` returns domain outcomes for each adapter's response mapping.
These are owning operations, not forwarding wrappers or business rules in DBAL. Another feature follows its own
policy/contracts rather than copying Packing's grants or persistence shapes.

`entityAdminController.entityMethodPermission` supplies common header, event-link, permission-management and
duplication requirements. Header/duplicate factories, administrator middleware and Packing's method map consume
this owner. Keep actor/profile admission and feature exceptions alongside their established consumers; a shared
grant does not imply a shared page-admission rule. Follow the definition to every actual consumer, including header
preflight/write, duplicate entry, administrators and relinking. Shared operations do not by themselves remove a
copied permission literal. Pass the owning rule into a generic factory; middleware must not import a feature's
controller merely to discover policy, and DBAL must not choose the grant.

Conditional-header limits are authored contract constraints, including the full token emitted by metadata/settings
reads. Reuse generated schema/operation validation through the existing transport and comparison owner. A decoder's
safety bound must agree with the wire shape rather than reject the application's own issued token. Verify generated
input/output consumers with a realistic full token and an oversized rejected token.

Packing's method-specific reads illustrate independent action admission:

| Admission boundary | Current Packing scope |
|---|---|
| Captured context; optional profile; fresh method grant | Item edit/order/delete and minimal baselines; administrator assignment removal; default/admin CRUD and scoped baselines; account-profile discovery; header baseline/preflight/write; description-only GET/PATCH. |
| Active profile and existing operation policy | Full detail, metadata, settings and header bytes; mixed metadata writes, creation/Quick Add, self-assignment, archive/restore, event changes and owner deletion. |
| Existing entry policy | Session/Help and create/resource/duplicate entries retain their own admission; duplicate GET does not grant account-only creation. |

Public baselines carry only the method's values/hashes and bind the captured context; profile tokens keep their own
scope. Context checks, mutation CSRF, conditional comparisons and authorization before `304` still apply.
Header admission runs before upload bytes and again under the write lock. Scoped account-profile discovery uses
the existing 120-search/10-minute per-IP limiter; the adapter owns its localized Problem presentation. Do not
generalize this matrix to another feature or expose a full settings page merely to obtain one edit token.
Packing's item/order, defaults, single-admin, header and description baselines omit unrelated fields, assignments,
rosters and parent metadata. A displayed or disabled control is never server authority. Inherited permissions,
owner, guest, archival, personal visibility and permanent deletion remain distinct concepts.

Keep a short operation account in its contract/test evidence: decoding, actor/page/action grants, normalization,
no-op outcomes, lock/check location, response/feedback and destinations. Inspect deliberate differences rather than
turn peer behavior into policy. General defects and unrelated backend behavior changes follow the
[separate-work boundary](policies/DEVELOPMENT_POLICY.md#scope-of-separately-authorized-work); a contract or backlog
entry does not authorize their implementation. Reusing an existing business operation does not make its recorded
defects a prerequisite for a presentation/transport adaptation. Apply new-code security and delivery requirements
without claiming stronger legacy guarantees or introducing another postcommit rejection.

#### Entry, canonical delivery and outcomes

Keep server-owned admission/canonical navigation separate from temporary resource reads. `usePageEntry` owns the
entry decision. Capture the intended destination/notice once and commit it through the shared confirmed-navigation
owner. Failed or canceled delivery retains the same completion, including across actor remount, without replaying
a command. A navigation Retry repeats delivery only.

Preserve exact duplicate return through the shared guest-flow owner/forms and surveys' distinct policy. Invalid
guest tokens and expired stored identity keep their established status, message and provider boundaries. Read retries
cannot consume a reset/activation/guest capability or submit a creation. A configuration-denied login/register
journey uses its full error presentation rather than an empty form. Confirmed recovery/guest registration uses its
canonical destination; inline success on the old form is not equivalent. Pending/unknown states retain input and
explicit review.

Common landing/message/error presentation consumes explicit request-local data through the existing bootstrap codec.
Validate scalar shapes without coercion; retain a captured landing suggestion through SSR/hydration. Known plain
message keys translate in place; literal details remain escaped, and stacks follow server-owned development admission.
Route query data cannot create outcomes or diagnostics. Reused feedback retains its original completion lifetime
through locale changes. Optional complete-title and Home-destination inputs preserve existing consumer defaults.

Fragments and modified-click hrefs preserve ordinary navigation semantics. Region navigation reads the target before
history commit, merges only its region into current query state and adopts server-clamped pages/parent removal.
Failure or obsolete response leaves the URL/cards/focus intact. Search draft/caret and sibling regions survive.

#### Commands, drafts and retained work

TanStack Query owns authorized snapshots, feature drafts own original/local/current values and Router owns URL
state. `MetadataDraft` applies feature normalization consistently to dirtiness and sparse submission; omission,
null/false/empty remain distinct. No-op validation/feedback precedes confirmation, cross-form discard and writes
where the workflow requires it. Machine/raw number drafts survive framework coercion: inline capacity acceptance,
creation bounds and SQL persistence are different policies.

Use application-root draft protection with feature/dialog subtrees. Dialog close resolves its own work; route,
identity/update and whole-page destructive departures resolve every affected descendant. Pending/unknown command
state may outlive an editor; retiring a component does not certify delivery.

Admit a new `useCommand.run` only while its owning component remains mounted. Reject a retained callback after
unmount before capturing presentation/actor scope, retaining a status lease or invoking the operation. Retained
completion state protects an admitted command; it cannot grant another submission from a retired owner. Preserve
legitimate deferrals: a child chooser can close while its command owner stays mounted, and an operation admitted
before unmount can defer its request or finish settlement, follow-up reads and confirmed navigation under its
captured scope. Do not substitute cancellation of in-flight work or treat every dialog close as owner retirement.

Obtain whole-page deletion consent before writing. Retain confirmed deletion/creation destination and its one-time
receipt through failed navigation. Do not discard other drafts because a button was hidden or capability changed.
Field write loss disables saving while readable drafts remain cancelable; actor/read denial retires protected state.
Confirmation acknowledges submitted values; only a fresh admitted read restores grants/token and baseline.
A saved command followed by failed refresh remains saved with stale authority, not a failed mutation.

Unknown outcomes are reviewed through reads without automatic replay. Reconciliation cannot prove that an unknown
creation failed; preserve submitted input and require deliberate review or acknowledged departure. Financial and
recommendation commands retain their specific revision/fingerprint protocol rather than a generic comparison rule.

For inherited mutations which can partially complete, use deliberate document POSTs through existing controller
owners and native operation order, rather than a new atomic JSON envelope or backend repair. Keep interactive
skeleton/readiness and ordinary href entry with private bootstrap projections. Invoke a side-effecting capability
GET once per document admission, never through query refresh/prefetch. A read-only capability preview may use an
explicit generated POST contract: keep its secret in the body and retain the entry draft/validated result only in
mounted feature state. A fixed nonsecret fragment supports Back/Forward without secret URLs, query caches,
persistent storage or replay; capability denial is a presentation outcome, not loss of the viewing identity.
Document commands use `requireFrontendFormContext` for shared context, CSRF, origin and compatibility checks.
`useDocumentForm` shares draft protection, admits only the deliberate POST's unload and keeps guards for other pending
or unknown commands, identity changes, Router navigation and updates. It never fetches or retries that command.
Preserve native `ValidationError` confirmation status 500 and submitted values, `ExpectedError` statuses, and the
existing logout/provider destination. Existing controller
completion words remain escaped source-owned output when no message key is supplied; do not parse them to reconstruct
cleanup decisions. Newly authored interface and validation text uses the shared catalog. This transport does not
claim stronger backend completion guarantees.

Guest registration, API account signup and activation use the existing user controller's `commitIdentityCompletion`
through `UserService.withIdentitySessionTransaction`. The controller owns expiry/context checks, staged identity and
result preparation; pure DBAL owns the manager, row lock and persistence. Prepare required projections and serialized
replies before final commit through the existing session/transport owners. API envelopes cross generated validators;
admission GET completion prepares its notice/redirect. A precommit session check followed by a separate session save
leaves a partial mutation and does not satisfy this boundary.

Use `registerGuestWithSession` for Guest/profile plus stored identity, `registerUserWithSession` for inactive
User/profile/activation token, and `activateAccountWithSession` for token consumption. API account signup preserves
the current actor and never returns its activation token; document activation stages redirect/flash in the token
transaction. Adopt only the completed detached receipt, without a response-time session read/write which can
substitute another tab's actor or reject an already committed operation.

After registration commits, SMTP selects an already prepared delivery outcome. Guest email failure remains advisory
feedback with the confirmed personal link; account failure uses its completion surface and keeps activation required.
SMTP acceptance does not guarantee inbox delivery. Never recreate identity, replay registration or treat network
uncertainty as rollback evidence. Keep database/session schedules and client adoption/retirement assertions separate
from helper-only evidence. Do not generalize this operation boundary to every session/provider workflow.

Login, private guest-link login and profile switching use `loginUserWithSession`, `loginGuestWithSession` and
`changeActiveProfileWithSession` with the same completion owner. `prepareIdentityReply` finishes the API projection
before locked identity save commits; delivery adopts the prepared receipt outside rejection handling. Private
guest-link GET prepares its notice/302 under that owner. Credential, profile ownership and return-path decisions
remain shared. An inactive account's activation resend belongs before the identity transaction: its refreshed
token must survive intended login rejection. Provider logout keeps its separate operation boundary.

Profile administration uses `getIdentityProfile` for account/guest fields and `getIdentityProfiles` for the account-only
roster. The original P1 implementation wrapped field editing and additional-profile creation in the identity
completion transaction. The maintainer's A2 correction (2026-10-14) restores direct reuse of `updateProfile` and
`createProfile`, with their native persistence/session-save behavior. Prepare the simple generated `MutationResult`
before invoking either operation; deliver it without another context read, projection or save. This does not extend
registration/login/profile-switch atomicity to ordinary profile fields. Shared confirmed navigation refreshes session
display after acknowledgement and retains read/navigation-only Retry. Retire old profile/roster snapshots before
adopting fresh settings; display failure never rejects, repeats or reopens the confirmed write.

Explicit API logout uses `logoutUserWithSession` only when `session.tokens` is not truthy; an empty object still
selects the protected provider path. Recheck that classification on locked staging before clearing authority.
Prepare the generated anonymous API receipt in the transaction, then adopt the detached completion without another
session save. The mounted caller owns its admitted navigation; token-bearing provider paths retain their own order.

Password reset uses `resetPasswordWithSession` to check the token under its account lock and prepare the API receipt
through `prepareValidatedJson` before password/token mutation commits. `sendPreparedJson` delivers the captured
receipt without another session write. Serialization failure leaves original token/password state intact. The
token-admission GET remains distinct from mutation. A lock protects only its cooperating writers; inspect all active
operation paths before claiming a broader atomicity guarantee.

Reset-mail uses `requestPasswordResetWithSession` with shared username-first account resolution. Prepare token,
private link/templates, cached sender and generic API result in the same transaction. Cached sender setup makes no
SMTP connection; captured delivery follows commit through the existing mail owner. Keep known/unknown accounts'
generic confirmation and established errors, without account-found/delivery metadata. Forgot-mail and inactive-login
resend keep their own operation boundaries. No later session read/write may reinterpret the completed operation.

Shared relink/archive/restore owners accept typed `EntityMutationCompletion` preparation inside their existing locked
transaction. Packing relink evaluates resulting view admission through the manager-aware owner, including unchanged
and unlink outcomes; archive/restore prepare their invariant acknowledgement without an unused later archive DTO.
Omitted completion retains each existing caller's default presentation. Do not copy lifecycle business checks into
an adapter or treat every static typed response as another database projection.

Personal visibility uses the user controller's optional typed completion and manager-aware archive projection. The
Overview adapter maps visibility, archived and overviewHidden once under the lock, then its route uses
`prepareValidatedJson`/`sendPreparedJson`. Membership/private preference and shared archival stay separate. Callers
which omit the completion retain their presentation; they do not acquire another frontend's response protocol.

#### Read authority and recovery

Packing's checklist uses its established browser-local keys, separate from query snapshots and server assignments.
When browser storage is unavailable or throws, preserve checks only for the mounted actor/list visit. Show a
persistent localized load/save-failure notice explaining possible loss of unsaved changes on leave/reload or
account/profile change. Failed reads cannot establish that previously stored or successfully written checks are
unpersisted. Successful rereads observe external changes; a real missing key is unchecked unless a failed toggle
write still owns the item's selected value. Explicit Retry reattempts outstanding browser-storage writes and reads
only; keep the notice while reads fail or writes remain outstanding. Background reads never replay writes.

Before a retained local callback writes, check its mounted actor, admitted current list and live/rendered row.
Retry prunes removed rows before retrying. Dispose fallback and pending writes on list/context change, unmount or
admitted-resource retirement. Preserve profile-independent persisted keys and keep this state outside the server.

Authorized cache data is presentation, not perpetual command permission. Controller admission rechecks every write.
Identity/profile/resource/route generations retire reads, caches and tokens; late responses cannot repopulate them.
Language-independent machine state uses one authority across languages. Locale-owned Help/Overview projections have
their own locale keys; a prior-language grant cannot restore revoked edit authority.

Presentation readiness and automatic-read admission are separate. Focus, visibility and reconnect recovery require
a current successful session bootstrap before private queries resume. A pending, failed or cooldown-blocked bootstrap
cannot reopen those queries. Retain mounted readable data/drafts during ordinary revalidation; validated identity
change retires the old actor. Apply admission to every automatic query consumer, not only explicit refetch.
The context's `readsReady`/`mayRead` contract supplies this gate; `ready`/`isCurrent` retain their presentation and
result-generation responsibilities. Automatic consumers use `useQueryAdmission` in the existing query-cache owner.
It applies `mayObserve(key, firstRead)` per mounted logical-key visit: a fresh visit gets its own GET despite cached
terminal failure, while a dispatched or joined pending read consumes first admission. Recreating an equal key does
not start another visit. Later session resumes keep terminal failures paused. Deliberate manual recovery uses
`mayRead` within its read deadline.

Shared transport also checks dispatch admission. An already admitted image/picker operation keeps its captured
lifetime during ordinary bootstrap pause; actual actor/input/visibility retirement still disposes it.
Explicit command-dependency refresh uses each observer's key-bound `surveyorRead` metadata, rechecking current
eligibility/disposal after cancellation. A terminal-paused readable observer can recover through its own authored
query function; hidden, closed, retired and changed-key observers cannot. Do not select query-level last-writer
options or create a parallel query-policy registry.

Forward the same AbortSignal through decoding and classification. A fulfilled TanStack observer refetch can contain
canceled retained data; fresh continuation uses `refetchFreshQuery`/`refetchFreshQueries` in the query-cache owner.
Await the actually dispatched admitted read, retaining command/authority fences until it settles. Equal successful
data can restore authority; object identity, timestamps and idle flags alone cannot. Temporary errors retain
confirmed readable data and raw drafts with their last successful scoped receipt. Validated denial retires private
projections/entry variants; only another admitted read restores them, not cache aliases or stale SSR seeds.
Review readable-data loss separately from write loss.

Retire derived membership totals, hidden badges and related counts with the projection supplying them. A denied
region must not leave private aggregates after its cards/cache disappear. Derive presentation from admitted source
scopes/receipts through the existing feature owner; do not mirror server counts in a second store. Temporary failure
retains confirmed scoped evidence; independently admitted siblings retain only their own evidence. Unknown membership
has no zero/count/empty assertion.

Healthy active shared queries use the 30-second cadence and eligible recovery within roughly one minute. Honor
Retry-After, hidden-tab pause and observer disposal. Safe reads may retry; commands do not. Use shared `useReadRetry`
and `useReadRetryAt` with notice controls for eligible GETs. The deadline timer changes availability; it never starts
a GET or renews unrelated feedback.

#### Bootstrap, hydration and scoped completion

Each SSR request owns its app, router, QueryClient, translator and authorized bootstrap. Escape script delimiters in
bootstrap JSON. Do not serialize persistence/session/private edit data through convenience objects. Request/locale
state cannot live in a singleton. When adding a bootstrap field, update its declaration contract and the exhaustive
field-validator map in `app/serializeBootstrap.ts`. Validate the complete wire object before reactive state;
generated lazy feature validators remain schema owners rather than duplicate renderer/page checks.
`decodeBootstrap` owns exhaustive browser validation. `serializeBootstrap` only serializes/escapes inert JSON;
successful SSR serialization is not proof that every bootstrap field was validated for the browser.

The context helper derives initialization needs from route metadata and admitted denial/completion evidence; the
shell uses `context.hydrated` and `LoadingSkeleton`. Do not copy route classification or add another control/read
readiness policy. `initializePilotApp` stages initial feature mounting through `initialContentReady` inside bounded
Vue error capture. That internal step admits neither actions nor scoped reads. Initialization succeeds only after
mounting and first readiness render; captured failure restores `context.hydrated` to false while retaining partial
draft/command owners. Readable denials/completions and Help GET search, article links and anchors stay functional
static content before JavaScript runs.

Shared initialization also gates JavaScript-only shell selectors, actions, Retry and dismiss controls. Genuine links
and mobile navigation disclosures remain reachable. The renderer's independent localized failure notice works before
the entry executes, including disabled, missing, blocked or failed initialization. A normal-looking control must not
depend on an uninitialized client. Initial setup/mount/first-readiness failure cannot leave the app marked initialized.
If a failed attempt attached handlers, genuine static links and Help GET search still navigate through their HTML
owners, retaining edited-control consent. This bounded initial boundary does not replace later feature-error owners.

Shared mount preserves genuine static pre-hydration drafts, such as Help search, on original controls. Explicitly
opted-in non-text/file controls use `data-hydration-draft` where admitted. Recovery uploads no files and submits no
commands. Interactive initial inputs are skeletons; mounted feature drafts keep their own protection. An SSR seed
is eligible only for its live document/actor at use time, not because a captured closure once matched.

Startup protection precedes asynchronous route loading and mounted router guards. Retain edited static controls
through failed initial chunks/bootstrap; keep the initial guard until mount restoration finishes. Automatic departure
needs demonstrably clean state and a working loop marker; unavailable storage leaves visible localized recovery.
Deliberate recovery can bypass the automatic-attempt marker but still confirms edited-control loss and respects
pending/unknown command protection. Reuse startup, mount and update owners; never persist secrets/files or replay
commands to recover startup.

SSR parent aggregates use the same admitted QueryClient projections as child regions. Seed only the eligible initial
document before parent badges render. Page/Region share `overviewQueryParameters` from the existing Overview API
owner, so generated query keys identify the same data. An old seed or manual cache write never becomes fresh
post-command authority.

Express serves shared static/Help resources; Vite transforms entry/style URLs before inserting the Vue tree.
Test emitted URLs and mounted usable controls, not a hydration marker. HMR/authored-input restart checks are relevant
when their owners change; they are not required again for every unrelated feature view.

#### Progressive loading and shared placeholders

Initial interactive HTML is the shared skeleton until client initialization, separate from authoritative session
admission and independently pending feature projections. Once initialized, Overview active regions load in parallel;
unopened hidden regions wait. Readable Help retains complete SSR and functional GET search/links. Resource data
arrives through its owning scoped query without renderer self-HTTP.

Use `LoadingSkeleton` for client initialization and missing pending data. Shapes are decorative, with one localized
status; they invent no records, membership count or command. Respect reduced motion and existing responsive geometry.
Never replace readable same-resource content/drafts on ordinary background reads or show a false empty state.
Independent siblings render when ready. Initial failure has clear error/Retry; unknown membership has no zero count.
Identity/resource transitions cannot retain another scope's content. Same-resource locale refresh retains user
values/machine state while labels react. Article content matches its selected corpus or visibly disclosed complete
English fallback, with actual content language identified.

#### Shared presentation, feedback and images

Shared controls have explicit data/capability/value/event contracts. Generic controls cannot import feature API
owners or choose private query families; inject operations and let the feature name affected resources. Keep feature
validation and financial semantics outside generic form/inline/action components. Native controls, semantic tables,
Bootstrap-compatible geometry and suitable Reka dialog/tab primitives remain the shared presentation strategy.

Extract a settings composite only when repeated interaction shares its data, events and injected operations. It
owns repeated presentation/local interaction and focus through established controls/dialogs. The feature retains
query dependencies, authorization input, draft reconciliation and command orchestration. Preserve independent panel
drafts and layout. File size alone is not a module boundary, and extraction cannot justify a universal CRUD engine,
forwarding controller or backend service. `EntityHeaderEditor`, `EntityEventEditor` and `EntityLifecycleActions`
demonstrate this boundary; their props contracts live in `src/types/FrontendEntitySettingsTypes.d.ts`. Packing supplies
admitted state, independent file/relationship drafts, lifecycle commands, injected event discovery, tokens and labels.

Audit logical value lifetime, including warm navigation. Feature drafts and controls must agree after accepted
departure, target changes and confirmed reset. Ordinary reads, fragments and canceled departure retain live values;
component lifetime alone cannot identify current form scope. `composables/fileSelection.ts` holds only a DOM ref and
clears the same chooser when the feature releases its File to null. Its watcher is not immediate, so initial setup
cannot erase pre-hydration selection before restoration. Release decisions, dirtiness, commands and tokens stay
in their feature owners.

Header upload passes feature-owned `selectedFile` through the declaration contract. Confirmation releases the draft
even when follow-up fails; the editor clears the same input through the shared release owner so the same file can be
selected again. Rejection, unknown delivery and background reads retain bytes/input. Do not infer release from changed
header URL, token or translated filename, recreate the input or emit another selection event to reset it.

`feedback.ts` binds notices to semantic receipts and reuses `scheduleAlertDismissal` from
`src/public/js/shared/alerts.ts` with its ten-second lifetime. Repeated outcomes renew; locale/render changes neither
renew expiry nor revive dismissed notices. Persistent conditions use status semantics and remain visible. Capture
initiating elements before awaits. Inline notices own Close, focus/scroll placement and a live modal/page fallback
when their initiator detaches/hides, without restoring revoked controls. Full flashes retain their presentation.
Confirmed destinations/receipts survive failed delivery; warnings clear only through their own successful recovery.
Dispose timers/listeners and preserve page-cache restoration behavior.

Dialogs share one focus trap/dismissal owner, pending close lock and actual invoker return. Features can supply the
body-field initial target. Tabs retain independent drafts and freeze while necessary work is pending. Avoid
simultaneous Vue/Bootstrap DOM ownership. Mixed navigation disclosures use the existing app-owned wrapper and its
established native key policy.

Authorized images use the shared injected read/lifetime owner with cancellation, generation checks and object-URL
cleanup. A missing optional image does not fail the resource. Equal successful reads can restore a failed image;
access denial cannot be repaired by a retained URL or foreign-scope result.

#### Localization and runtime Help

One catalog per language supplies localized UI/API text, generated keys/parameters and fixed `help.directory`.
Use the shared typed translator and request/application-local i18next-vue binding, without a second dictionary.
Plain interpolation stays escaped; locale changes preserve drafts, focus and machine-value parsing. User-authored
titles and other content remain data rather than translation keys.

The implemented catalog grammar is plain text and cardinal plurals. Generation checks complete keys, parameters and
plural variants; raw markup or unsupported rich/context/ordinal forms are not executable message extensions.
The current preference is a server-issued browser cookie, not a User/Guest or participation-profile database field.
The [framework decision](decisions/DEC-006-FRONTEND-FRAMEWORK.md#deferred-localization-and-domain-integration-targets)
retains the original intended persistence and output-localization choices with their unimplemented status.

After confirmed locale change, cancel/invalidate only named translated query families from the existing query-key
owner. Machine values, user titles, event options and edit authority retain language-independent keys/in-flight
reads. Avoid tuple-position matching or another family registry. Translation cannot cancel the fresh post-command
read restoring metadata/settings authority. `belongsToLocalizedQueryFamily` selects existing Help/Overview families.

One fixed `docs/user-guide/` tree contains reviewed catalog-selected corpora and adjacent assets packaged with the
application. Only the trusted reviewed Help source is searched/read/served. Runtime source/security tests use
independently specified synthetic fixtures, not maintained prose or expectations taken from the selector under test.
The [Documentation Policy](policies/DOCUMENTATION_POLICY.md#localized-help) owns source/fallback authoring rules.

Prefer complete localized articles, stable anchors, search text and raster images/captions/alt descriptions.
Missing corpus/article/required figure selects the complete reviewed English article and its own assets, with
localized fallback notice, English navigation/search markers and actual `contentLocale`; interface locale stays
selected. Never resolve one missing figure across languages or author a cross-language local reference. Article,
navigation and search projections share complete-source selection. Invalid existing localized content fails rather
than fall back. Source directories stay fixed. Authored hints use `resolveSupportedLocale`: a regional hint may name
the same corpus, but unsupported or other-corpus hints cannot pass through passive English negotiation.

Keep Help prose/pixels task-focused; framework/API/storage/permission internals belong in maintainer guidance.
Every changed picture needs individual full-resolution and reduced-size inspection. An untrusted content source
requires reopening [DEC-004](decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md) before admission.


<!-- /delta:amendment-01 -->

## 5. Start Surveyor — amendment-02

<!-- delta:amendment-02 -->
- Express under Nodemon through `npm run server:dev`, with Vite middleware/HMR;
- existing browser modules under `npm run server:client`; and
- serialized contract/catalog generation under `npm run server:frontend`.

Authored inputs are `contracts/api/v1/`, `src/locales/` and the exact permission registry
`src/modules/lib/permissions.ts`. The watcher observes the registry's parent so atomic editor replacement remains
visible, generates API before locales and publishes `.generated/frontend-ready.json` only after the current successful
batch. Failed or superseded batches keep watching without restarting Express with partial inputs. Other library
saves retain ordinary server restart behavior. Source serving explicitly uses `vite.config.mts` and the repository
root. Production runs matching built artifacts without a Vite server.

<!-- /delta:amendment-02 -->

## Project structure — amendment-03

<!-- delta:amendment-03 -->
src/frontend/                      Vue app, components, composables and feature views
contracts/api/v1/                   authored API schema and operation policy
src/locales/                        shared UI/server catalogs
src/types/                          shared .d.ts contracts
src/public/js/                     existing browser modules and shared helpers

<!-- /delta:amendment-03 -->

## Project structure — amendment-04

<!-- delta:amendment-04 -->
tests/frontend/                    client helpers/mounted Vue and isolated browser checks
tests/integration/                 database-backed workflows and genuine isolated server-component integration

<!-- /delta:amendment-04 -->

## Build and run commands — amendment-05

<!-- delta:amendment-05 -->
| `npm run server` | Full build, then Express/Vite HMR, existing browser watch and ordered authored-input generation. |

<!-- /delta:amendment-05 -->

## Build and run commands — amendment-06

<!-- delta:amendment-06 -->
| `npm run server:frontend` | Watch contracts, catalogs and permission declarations; publish successful generation readiness. |
| `npm run build` | Sass, database/API/catalog generation, server compile, existing browser and Vue client/SSR builds, then views/assets copy. |

<!-- /delta:amendment-06 -->

## Build and run commands — amendment-07

<!-- delta:amendment-07 -->
| `npm run build:server` | Generate shared inputs, compile server TypeScript into `dist/` and copy runtime contract artifacts. |
| `npm run build:client` | Build existing browser modules and the Vue client/SSR output. |
| `npm run build:frontend` | Check and build the separate Vue client and SSR scopes through Vite. |
| `npm run typecheck:frontend` | Check both Vue client and SSR configurations. |
| `npm run typecheck:tests` | Check the Vue-aware test import graph without executing tests. |

<!-- /delta:amendment-07 -->

## Build and run commands — amendment-08

<!-- delta:amendment-08 -->
| `npm run generate` | Rebuild database metadata and API/localization consumers without a database connection. |
| `npm run prepare:frontend` | Generate the authored API and locale boundaries only. |

<!-- /delta:amendment-08 -->

## Generated files — amendment-09

<!-- delta:amendment-09 -->
- `.generated/api/` and `.generated/frontend-ready.json`
- `src/types/api/` generated declarations and `src/types/LocalizationTypes.d.ts`
- `src/modules/localization/generated/`
- `src/public/js/**/*.gen.js`

<!-- /delta:amendment-09 -->

## Current code patterns — amendment-10

<!-- delta:amendment-10 -->
Vite owns separate client/SSR outputs. Browser, server and SSR compiler scopes are explicit; no filesystem, settings
secret or ORM entity belongs in the browser graph. Client and SSR outputs use the same release/compilation mode.
Externalized SSR packages remain production dependencies; standalone validators include their runtime helpers
without compiling schemas at application startup.
Normal locale generation retires only its known compiled `permissions.js`/`.js.map` siblings before emitting current
`permissions.ts`, so extensionless imports cannot select stale emitted code. Exact output-root paths, entry types
and real parent containment are checked before removal. `--check` reports a collision without rewriting/deleting
files. Preserve the whole authored-tree collision regression and unrelated generated neighbors rather than adding
exclusions or general directory cleanup.

## Current code patterns

<!-- /delta:amendment-10 -->

## Readability and shared contracts — amendment-11

<!-- delta:amendment-11 -->
Vue templates and composables need equivalent explanations of explicit inputs, scoped data, meaningful branches,
draft/command lifetimes and DOM hooks. Document nontrivial methods with a contract and internal comments describing
their meaningful steps. Existing Pug consumers use unbuffered `//-` comments for mixin inputs and render branches;
optional feature state still uses renderer `data` and explicit arguments, never a second `res.locals` channel.

<!-- /delta:amendment-11 -->

## Routes — amendment-12

<!-- delta:amendment-12 -->
- Mount versioned feature adapters in `src/routes/api/v1.ts`; existing API consumers keep their `src/routes/api.ts`
  owner. `src/app.ts` mounts v1 before the existing HTML session-expiry redirect and view locals so structured errors
  and explicit context admission remain inside the versioned boundary.

<!-- /delta:amendment-12 -->

## Errors and responses — amendment-13

<!-- delta:amendment-13 -->
- Use the established page renderer and response adapters rather than create another response convention.

Versioned adapters use the generated request/result contracts and `ApiProblem` boundary. For new or deliberately
changed business behavior, prepare and validate a final mutation receipt before commit; a later mutable-context check
or session save must not reject an already committed operation. Scope-preserving consumers follow the
[existing-operation boundary](policies/DEVELOPMENT_POLICY.md#scope-of-separately-authorized-work) without requiring
unapproved legacy repairs. Delivery failure remains distinct from business rejection. Services never own
transport-specific errors.
Vue HTML is produced by the existing `src/modules/frontendPilotRenderer.ts` owner; existing adapters under
`src/modules/renderer.ts` retain their actual consumers. Both reuse controller projections rather than duplicate
business behavior inside templates or components.

<!-- /delta:amendment-13 -->

## Root property dialogs — amendment-14

<!-- delta:amendment-14 -->
existing feature controller and atomic persistence to its existing database service. Pass admitted field/capability
projections explicitly to shared controls. Shared contracts remain `.d.ts` declarations.

<!-- /delta:amendment-14 -->

## Root property dialogs — amendment-15

<!-- delta:amendment-15 -->
Feature draft/query/command owners coordinate each dialog's independent sections. Shared header/event/lifecycle
panels provide repeated layout and explicit events; they retain no business tokens or second file draft. Validate local
prerequisites before admitting a command. Keep selection IDs separate from discovery labels. Exports/modified clicks
leave the source draft protected, while tab changes retain independent input. Presentation-only audience/search state
does not become a business patch. Validity reporting reveals the invalid field's family before focusing it.

<!-- /delta:amendment-15 -->

## Root property dialogs — amendment-16

<!-- delta:amendment-16 -->
Event creation and association writes authorize the submitted destination with effective

<!-- /delta:amendment-16 -->

## Root property dialogs — amendment-17

<!-- delta:amendment-17 -->
invalidation is decided by the activity controller using its existing persistence/job boundaries. Shared discovery
owners provide server validation, permission-prefiltered database pages, a final engine check and opaque continuation
tokens. EventPicker receives the feature's generated discovery operation and query families: Packing injects
`searchPackingEvents` through `PackingApi.events` at `/api/v1/packing-lists/events`. The existing
`GET /api/event/link-options` adapter is a separate consumer of those business owners, not the component's transport.
The shared picker replaces result pages and retains only current/saved selection labels

<!-- /delta:amendment-17 -->

## Root property dialogs — amendment-18

<!-- delta:amendment-18 -->
Closing resolves section drafts; changing tabs preserves them. Before a departing command, resolve other dirty
sections through shared departure protection. Ordinary refresh preserves live drafts. Pending work freezes dismissal and competing commands,

<!-- /delta:amendment-18 -->

## Root property dialogs — amendment-19

<!-- delta:amendment-19 -->
is idempotent. Persist the TypeORM relation rather than its relation-ID projection; prepare required resulting
admission/capabilities before final commit. Preserve root identity, grants, files, direct archival and stored pause state.

<!-- /delta:amendment-19 -->

## Entity archival — amendment-20

<!-- delta:amendment-20 -->
owns personal overview visibility. Existing `adminApiFactory` adapters and generated v1 adapters share those
business owners. `EntityLifecycleService`

<!-- /delta:amendment-20 -->

## Entity archival — amendment-21

<!-- delta:amendment-21 -->
The existing adapter commands are explicit and retry-safe:

<!-- /delta:amendment-21 -->

## Entity archival — amendment-22

<!-- delta:amendment-22 -->
Vue controls receive feature-owned generated operations rather than calling these adapters directly. Packing injects
`archivePackingList` and `restorePackingList` through `PackingApi`; Overview injects
`setOverviewVisibility` through its API owner. Each uses the shared transport/validated result and existing
`entityAdminController` or `userController` operation. Neither reusable lifecycle presentation nor a second
controller/service duplicates grants, root/parent policy or visibility eligibility.

Never accept profile IDs, timestamps, stored parent state, or other arbitrary fields from the browser. Follow the [archival authority contract](PERMISSIONS_REFERENCE.md#archival-authority-and-personal-visibility), including the survey exception. A private preference may change placement only after existing overview membership is established.

<!-- /delta:amendment-22 -->

## Entity archival — amendment-23

<!-- delta:amendment-23 -->
Render lifecycle actions through explicit authorized component projections. Personal actions remain an explicit
card contract; placement comes from the bounded overview service. Commands wait for validated confirmation before
refreshing named affected appearances. The presentation owner never infers archival dates or parent policy.

<!-- /delta:amendment-23 -->

## Paged profile overview — amendment-24

<!-- delta:amendment-24 -->
Overview adapters share controller normalization and server-owned page limits. Namespaced URL state preserves each
collection/region's filters, pages and selection. `OverviewRegion`, `OverviewItems` and `OverviewCard` divide read/navigation,
grid and card presentation without another server-data store. Read before history commitment; preserve sibling state,
modified-click hrefs, search caret and focus through failed/obsolete delivery. Retire source-owned aggregate receipts
with denied cards; unknown membership is not zero. Shared event **Things to do** retains local filtering. Database work
can grow with membership even when returned cards/DOM are bounded; measure plans and paging before adding indexes.

<!-- /delta:amendment-24 -->

## Invoice pool calculation and saved changes — amendment-25

<!-- delta:amendment-25 -->
`presentation.ts` owns signed financial presentation and the single settlement-status rule used by the interface,
emails, and PDF exports. The primary **Calculated balance** is the saved `shareAmount` after carried credits,

<!-- /delta:amendment-25 -->

## Invoice pool calculation and saved changes — amendment-26

<!-- delta:amendment-26 -->
Use the existing pure presentation/wording owners directly and pass explicit values to shared controls. Avoid a
second renderer formula or copied catalog. Programmatic hooks are independent of translated labels. Settlement actions use the same

<!-- /delta:amendment-26 -->

## Invoice pool calculation and saved changes — amendment-27

<!-- delta:amendment-27 -->
labelled, formatted steps in the interface and email; render global figures only as labels and values. Avoid a large unformatted

<!-- /delta:amendment-27 -->

## Test selection — amendment-28

<!-- delta:amendment-28 -->
npm run test:frontend:browser # isolated built-browser client behavior
npm run test:all           # Vitest + build + client browser + system E2E

<!-- /delta:amendment-28 -->

## Add or change a page workflow — amendment-29

<!-- delta:amendment-29 -->
5. Update the feature component, generated read/command contract and shared catalog together when values or actions change.

<!-- /delta:amendment-29 -->

## Add or change an API action — amendment-30

<!-- delta:amendment-30 -->
1. Author the versioned operation/schema once in `contracts/api/v1/` and regenerate its consumers.
2. Add its adapter under the existing API route owner and confirm explicit mounting.

<!-- /delta:amendment-30 -->

## Add or change an API action — amendment-31

<!-- delta:amendment-31 -->
4. Use generated validation and the shared API error chain. Prepare a mutation's validated receipt before commit for
   new or deliberately changed business behavior; unchanged shared operations retain their recorded scope under the
   [development policy](policies/DEVELOPMENT_POLICY.md#scope-of-separately-authorized-work).

<!-- /delta:amendment-31 -->

## Add a client-side module — amendment-32

<!-- delta:amendment-32 -->
1. Reuse an existing component/composable; add a feature owner under `src/frontend/` only when its responsibility is distinct.
2. Import its actual declaration/domain owner directly, with no forwarding exports or browser-unsafe dependency.
3. Use the integrated `npm run server` workflow for HMR; check client/SSR through `npm run typecheck:frontend` and build through `npm run build:frontend`.
4. Add a mounted client/helper check at the cheapest meaningful boundary; use isolated browser or system E2E only for its distinct risk.

<!-- /delta:amendment-32 -->

## Browser changes do not appear — amendment-33

<!-- delta:amendment-33 -->
Use the integrated `npm run server` workflow for Vue HMR and ordered generated inputs. Existing esbuild consumers
still use `server:client`; do not remove source or hand-edit generated modules. If an authored contract/catalog save
fails, correct it and wait for successful readiness before relying on a restart. For compiled runs, build before run.

<!-- /delta:amendment-33 -->

## Test selection — amendment-34

<!-- delta:amendment-34 -->
npm run test:quick         # configured database-free project, including scoped server integration

<!-- /delta:amendment-34 -->

## Test selection — amendment-35

<!-- delta:amendment-35 -->
The database-backed integration project rebuilds its selected MariaDB schema; the genuinely database-free
Express/Vite integration fixture uses the other existing project without a schema reset. The E2E initializer drops
and recreates its selected schema. Read [Testing Guide](TESTING_GUIDE.md) before database-backed suites and never
reuse development or production database names.

<!-- /delta:amendment-35 -->
