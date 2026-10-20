# Versioned API and shared contract design
<!--
documentation-metadata
audience: maintainers; API developers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-20
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: Original decimal-string money/factor/identifier choices restored with explicitly preserved accepted command precision; P0-P8 shared operations, native isolation and later-phase exclusions retained; actual execution belongs to paired review
source-anchors: contracts/api/v1/; scripts/generate-api.mjs; src/modules/api/; src/controller/packingController.ts; src/controller/activityController.ts; src/modules/activity/; src/routes/api/v1/; src/frontend/app/transport.ts; src/frontend/features/; src/types/; tests/integration/packing-public-actions.spec.ts; tests/integration/packing-coexistence.spec.ts; tests/e2e/frontend-pilot-api.spec.ts; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md
next-review: next-contract-migration-or-authorized-cutover
-->

Authored OpenAPI 3.1 YAML is the single wire-shape authority. Generate declaration contracts and runtime validators;
expose `/api/v1` beside native routes. Business decisions belong to existing controllers and pure DBAL retains
transactions/persistence. A DTO deliberately differs from an entity; one wire shape must never be handwritten again.

The [baseline](FRONTEND_MIGRATION_BASELINE.md) owns behavior/route exceptions.
[Foundation](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments) owns original choices and dated
amendments. The [approved finance correction](../decisions/DEC-006-FRONTEND-FRAMEWORK.md#approved-finance-wire-correction-2026-10-20)
retains the original decimal-string transport with explicitly preserved accepted command precision. Current
Help/Packing/Event/Drivers/Survey/Activity/finance/overview/identity contracts are authoritative in their YAML
rather than a second maintained endpoint matrix.

## Implemented foundation boundary

The generated contract/client/validator/session/locale framework is present.
Packing, Event, Drivers and Activity use named shared operations and central method permission definitions in their existing controllers.
Native middleware, v1 authorization and capability projections consume that policy. Existing administration/
image operations retain their own owners. Adapters decode/present native and generated v1 protocols; conditional
comparison remains v1-specific. Source ownership consolidation and the approved coexistence remedy are implemented;
final execution and its limits are tracked separately in the review.

Standalone Surveys reuse their existing controller operations through generated JSON/multipart contracts. Admission
and owner-only settings remain independent of the general permission matrix; Surveys expose no Access or event
association operations. Their metadata ETags identify representations for frontend draft reconciliation only and
do not add write preconditions, atomic ballot replacement or stronger image/persistence guarantees.

Activity's P5/P6 contracts cover schedules, slots/roles, participation, requirement settings, recommendation jobs and
reviewed changes through the existing controller and domain engines. Private requirements and recommendation
projections retain independent method admission. Deliberate recommendation maintenance is a command; ordinary
snapshot and known-job reads cannot maintain rows or enqueue work. Reviewed application retains the exact batch,
current overlap acknowledgement and existing server provenance/application decisions, without stronger inherited
completion guarantees.

The same original identifier contract applies to Activity roles, overrides and role-ID arrays. Versioned controller
projections and browser drafts retain decimal strings; the existing frontend requirements helper adapts arguments
for the unchanged numeric pure engine at one shared boundary used by Analyze and Calculate. Existing native/Joi
normalization and DBAL remain authoritative rather than acquiring a second domain representation.

The P7 finance slice added separate participant/organizer saved projections and lazy saved-share breakdowns.
Personal metadata is limited to eligible pools and own invoice/share contexts; unrelated pools, other invoices,
contacts and financial aggregates remain private. Applied coverage is distinct from pending organizer inputs.
Proof delivery reuses existing authorization independently of review state. Multipart submission, retraction and
participant closing adapt the existing invoice operations with prepared acknowledgements; stale retraction and
lock-time submission rejection are definite conflicts. Upload progress shares the browser transport's generated response/actor checks and cannot
confirm persistence. That original slice excluded organizer and takeover commands and repaired no inherited backend defects.

The [P8 instruction](FRONTEND_FOUNDATION_DESIGN.md#explicit-p8-implementation-trigger-2026-10-20) extends the same
finance contract with pool creation/settings, submission access, organizer expenses and invoice review, followed by
enrollment, factors/exemptions, signed adjustments and participant/organizer takeover inputs. New adapters invoke
the existing EventPool controller operations; they add no financial calculation or settlement business owner.
Organizer reads still require both page and management grants, while organizer commands retain their independent
native management grant. The separately [approved R1/R2 correction](FRONTEND_FOUNDATION_DESIGN.md#approved-p8-public-method-parity-2026-10-20)
preserves profile-less public grants for pool creation/settings/submission access, assignments, adjustment
addition/removal, organizer coverage and invoice acceptance/decline/organizer closure. Expense recording and
retroactive review retain their profile requirements; no command admits a private read audience.
Participant commands require event registration and keep the existing own-invoice or
self-payer boundaries. The organizer projection includes current settings, assignments and adjustments. Participant
coverage choices disclose only the assigned names/contact details already available in the native eligible OPEN-pool
chooser; top-level organizer rosters, unrelated pools and other participants' invoice details stay private.
Current coverage inputs remain separate from the saved applied roster and pending closed-pool groups.

Help has one canonical release-owned tree: native English at `docs/user-guide/`, with pilot language corpora in its
catalog-selected directories such as `en/` and `de/`. Staged maintainer documents are never runtime sources.
Final build/application/concurrency/browser evidence belongs to the [review](PILOT_PARITY_REVIEW.md).

## Contract authority and toolchain

The [active framework decision](../decisions/DEC-006-FRONTEND-FRAMEWORK.md#shared-api-contract-decision) preserves
the original OpenAPI/standalone compiler choice, alternatives and rationale. The
[Development contract guidance](staged/DEVELOPMENT.md#contract-authoring-and-generated-consumers) owns the current
artifact inventory, generation pipeline, strictness and authoring procedure. Generated declarations/validators
consume the authored YAML; transport adapters remain outside business/controller ownership.

### Schema definitions and implemented transport

The same [Development owner](staged/DEVELOPMENT.md#contract-authoring-and-generated-consumers) records schema-authoring
preferences, implemented HTTP transport and bounded password/capacity extensions. The
[2026-10-15 maintainer correction](../decisions/DEC-006-FRONTEND-FRAMEWORK.md#maintainer-correction-2026-10-15)
resolves the earlier agent interpretation: removal of unused implementation did not authorize definition bans.
Array/object/union parameter schemas and response media definitions are distinct from the decoder and response
delivery capabilities actually implemented. Accepting their definitions does not restore unused runtime behavior.
The [transport decision history](../decisions/DEC-006-FRONTEND-FRAMEWORK.md#authorized-transport-scope-restoration-2026-10-14)
also distinguishes the original selected repeated-query-array/text-output capability from its later implementation
and explicitly approved removal; an unused capability was not an unselected design.

## Server boundaries and DTO projection

The approved shared-backend target reuses named controller operations for native/v1.
Adapters decode their own request and select response/error presentation; controllers own authorization, capacity,
ownership, validation, orchestration and contextual errors. DBAL owns queries/locks/transactions/persistence.
Checks needing locked current data execute as named controller callbacks inside the existing transaction.

Central method permission definitions belong in the controller and apply native policy to pilot actions.
Keep action admission independent of page membership when native action grants allow it; edit authority/projections
must remain private. Inherited permission mismatch is `IMP-022`, not a reason to silently tighten or broaden policy.
UI capability snapshots guide presentation and never authorize writes.

DTOs expose only actor-permitted data/capabilities. Never serialize entities, sessions, PermBundle, filesystem paths
or hidden original values into generic contract objects. Preserve feature-specific owner/guest/archive/child-scope
and disclosure policy rather than generalizing Packing rules to surveys or finance.

## Identity, sessions, and request context

Use same-origin cookie sessions. Session bootstrap distinguishes anonymous/account/guest, active profile and event
registration; return only UI-needed identity/entry/locale/CSRF data, never session IDs/provider/guest tokens. The
[2026-10-15 ownership amendment](FRONTEND_FOUNDATION_DESIGN.md#session-ownership-restoration-and-stateless-initial-visits-2026-10-15)
supersedes the original mandatory anonymous-context initialization. GET bootstrap reads the ordinary Express Session;
an uninitialized anonymous candidate has a null context/CSRF pair and gains no stored row/cookie from that read.
Existing authenticated sessions lacking SPA fields receive bounded server-session-bound read-only compatibility
metadata; explicit identity operations retain the stored random generation and approved completion transaction.
The [native-flash decision](FRONTEND_FOUNDATION_DESIGN.md#authorized-native-anonymous-session-flash-2026-10-15)
separately retains anonymous Session persistence for an intentional document redirect notice; it does not turn
API bootstrap into an initializer or add context/CSRF metadata to that feedback Session.

Subsequent v1 requests with server context send `X-Surveyor-Context`. The server compares authoritative generation before
private reads/commands; stale context yields `SESSION_CONTEXT_CHANGED`, while missing/expired context follows its
declared error. Omitting claims never downgrades a context-bearing or authenticated scope to public. Admission can
reject newer stored identity evidence, but never adopts another writable Session. Login/logout/profile/guest transitions rotate context.
A caller's profile ID is not authority.

The browser checks captured context/identity epoch before adopting results. Intentional switches resolve drafts,
retire private queries and bootstrap the new identity. A command already admitted for the original actor may finish;
aborting HTTP is not transaction rollback and cannot justify replay as another actor.

The API mount precedes HTML/OIDC redirect handling. Structured API expiry stays JSON; known invalid credentials/token
are confirmed rejections rather than global identity invalidation.
Identity operations admit the captured old scope, including a public null scope without identity or frontend context,
and bind successful identity transitions to the new context. First completion allocates no empty session before validation/preparation.
Stored-context rechecks protect slow transitions; this is not a session-store compare-and-swap guarantee.

Stored-context mutations validate session CSRF and same-origin metadata, including multipart. Sessionless mutations
require affirmative configured-origin/Fetch Metadata evidence and the non-simple compatibility header before exact
generated operation decoding; no permissive CORS exception is introduced. A custom header or SameSite alone is not
the entire policy, and these transport checks never authenticate or grant feature permission.
Native adapters retain established transport/status/flash semantics; no new native hidden conflict fields are claimed.

`X-Surveyor-Locale` chooses supported response language; localized results declare Content-Language.
Private/identity/sensitive responses follow endpoint caching policy. Reauthorize conditional reads before 304;
ETag/Vary is never authority. Context/local locale scope cannot leak into a singleton cache.

## Wire values and partial updates

| Value | Preserved wire meaning |
|---|---|
| UUID identifiers | UUID strings where the real identifier is UUID, never entity objects. |
| Numeric record identifier | Canonical positive decimal string; undisclosed handles null. Existing owning server operations perform internal conversion. |
| Ordinary edit token | Opaque current-value comparison, distinct from reviewed financial revision/history. |
| Financial command amount | Plain decimal string without exponent or locale separators; preserve precision accepted by the existing operation, including its sign/range/precision checks. |
| Saved financial amount | Signed fixed-two-decimal string from the existing shared financial presenter; no new rounding or browser calculation. |
| Financial factor | Canonical four-place decimal string within the existing operation's range; preserve zero and existing arithmetic. |
| Civil date / instant | YYYY-MM-DD independent of browser timezone / normalized RFC3339 UTC. |
| Local deadline | Explicit local date/time plus owning IANA timezone policy, not new Date guesses. |
| Boolean | JSON true/false; legacy checkbox decoding belongs to native adapter. |
| Omitted/null/empty | Omission preserves, null clears nullable values, empty follows field normalization; no global empty-to-null conversion. |
| Array | Ordering/set semantics are operation-specific; explicit empty may clear rather than omit. |

PATCH is an authored sparse editable object, not full replacement or generic JSON Merge Patch.
Reject unknown/read-only fields and empty writes. A title update cannot alter unrelated description/image/event/
permission/date state. Shared operation normalization preserves native semantics without changing frozen form
validation or duplicating business decisions.

## Responses, errors, and localization

Successful JSON DTOs use declared HTTP/media/status policy; legacy envelopes remain native adapter behavior.
Handle 204/304 before JSON parsing. HTML 200 or an invalid response cannot confirm a command.

V1 failures use RFC 9457 application/problem+json with matching status, safe localized detail/request ID and correlated
code/messageKey/typed params; validation adds bounded field pointers/violation codes.
Never return raw validators, SQL/stack/payload/cookie/path details.
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)

Keep known code/status/message/parameter variants correlated. Unknown future errors can show validated safe detail
but cannot trigger known machine actions. Translated text is never machine state.
Successful profile workflow completion also uses a generated catalog notice rather than a copied or inherited
English string. The existing controller branches project their completed former-owner cleanup facts once; Vue
retains the notice key for reactive translation without parsing prose or repeating the business decision.
Native caller wording and existing partial/uncertain outcomes retain their behavior under the
[approved R1 adaptation](FRONTEND_FOUNDATION_DESIGN.md#approved-catalog-based-identity-completion-notices-2026-10-16).
401 credentials differs from expiry, 403 field/action denial from parent read loss, and 404 foreign child from global
resource disappearance. Follow each operation's authored disclosure policy.

## Current-value comparisons and conditional reads

Approved D2 supersedes the monotonic Packing metadata revision and broad cross-panel comparison.
Scoped tokens hash current relevant values plus actor/resource context; no counter/history/lease/presence infrastructure.
Native request bodies/last-write behavior remain unchanged. A native write changes current values compared by v1;
native original-value submission or overlap feedback is not implemented or promised.

| Operation | Comparison boundary |
|---|---|
| Metadata | Sparse submitted fields under parent/root context locks; preserve unrelated changes. |
| Item/Everyone | Item current-value token and locked field/capacity policy. |
| Item order | Exact reviewed membership/order token. |
| Event link/default masks/admin setup | Relevant current setup fields and independently granted owning policy. |
| Capacity-sensitive assignments | Existing locked count/membership/idempotent behavior; not metadata revision. |
| Recommendations | Existing generation-context fingerprint and overlap acknowledgement; application retains native source, provenance and eligibility checks. |
| Finance | Existing calculation revision for submission access, retraction and reviewed accepted-invoice changes; ordinary settings/allocation saves gain no generalized If-Match protocol. |

Missing required If-Match is 428; mismatched touched comparison is 412 without a write.
Weak/wildcard tags do not bypass application comparison. This is an authored field protocol carried in If-Match,
not a promise of monotonic history: change-away/change-back can match prior values.

The [explicit 2026-10-13 amendment](FRONTEND_FOUNDATION_DESIGN.md#authorized-same-event-no-op-clarification-2026-10-13)
preserves a narrow exception: selecting the already linked event returns `changed: false` after current source/target
authorization, ignoring comparison-header presence/value entirely. This includes empty, stale, weak, wildcard or
oversized supplied evidence. Native and v1 perform no association write in that case.
A changed association retains the expected relationship and v1 reviewed-field comparison inside the existing locks.
Do not apply this exception to unrelated commands or treat a no-op receipt as a fresh edit baseline.

Authored `ComparisonToken` owns the accepted If-Match bound; `FieldComparisonToken` adds the existing field-token syntax.
`EventIfMatch` is an optional transport string because the approved unchanged branch never examines that evidence;
applying a token constraint there would reject a harmless native/v1 result. Actual changed-event callbacks still require
the same bounded field comparison under locks. Generated comparison consumers must accept every token the corresponding
admitted read can emit, including full metadata/settings projections. Preserve
the same schema constraint through generated validation and the owning decoder; do not maintain an unrelated smaller
header limit or duplicate the bound across adapters. The owning decoder uses generated `FieldComparisonToken` validation.
Keep malformed, weak and wildcard input distinct from a missing required precondition, and verify both actual
generated consumers and rejected oversized input.

Dirty refresh preserves original/local/current. Unrelated remote changes can advance untouched fields; overlaps
require explicit review/reapply. A 412 response cannot disclose hidden values.
Reconciliation never automatically writes. Conditional GET rechecks current actor/scope before unchanged responses.

An independently permitted conditional write must have a usable independently permitted baseline read. Packing's
item-edit baseline returns only method-permitted fields and hashes; its order baseline returns only item IDs/positions
and the existing order token. Defaults, one administrator, header and description have equally bounded baselines;
none borrows detail/settings admission or a previously issued private token. Reauthorize before `304`, and filter
comparison hashes as well as visible values. These reads do not disclose unrelated fields, rosters or parent context.
The YAML owns `getPackingDescription`/`updatePackingDescription`, `getPackingDefaultsBaseline`,
`getPackingAdminBaseline` and `getPackingHeaderBaseline`; do not reconstruct their shapes from full settings.

### Approved public-method and coexistence amendment (2026-10-12)

The initial pilot's blanket profile requirement narrowed independently granted native methods. The explicit
[maintainer amendment](FRONTEND_FOUNDATION_DESIGN.md#explicit-canonical-location-and-action-decisions-2026-10-12)
admitted those methods using captured session context without inventing a shared anonymous actor. The Oct15
ownership amendment above replaces that per-visitor requirement for sessionless public projections. Item
edit/order/delete, administrator assignment removal, default/admin management, scoped profile discovery, header
write/preflight and the legacy description-only action follow current native method grants. The authored description,
defaults, administrator and header baseline operations expose only their permitted comparison state. Profile-required
reads and commands retain their original boundary; the [admission matrix](staged/DEVELOPMENT.md#backend-and-method-policy-contracts)
distinguishes them. Existing-context checks, the corresponding mutation protection and fresh authorization remain
mandatory. Conditional tokens remain profile/session-bound where identity exists; a sessionless baseline binds
resource/operation, visible field set and current values, never an anonymous principal or permission.

Native and v1 profile discovery share the existing per-IP 120-search/10-minute budget. Native rate-limit text remains
unchanged; v1 maps rejection through its existing localized Problem owner. No global permission redesign is implied.

The approved native assignment remedy takes the list's shared lock before the item's exclusive lock. It preserves
parallel native assignments on different items while v1 retains its exclusive root-before-item/order coordination.
Native removal/overwrite outcomes and missing-item handling remain unchanged. This bounded correction removes the
reproduced FK/root-item cycle; it does not promise that unrelated future writers are free of deadlocks.

## Commands, multipart and recovery

D4 is reconcile-only without operation tracking. Commands retry zero times by default.
A lost response is unknown until endpoint-specific evidence establishes more; reads cannot prove an unknown creation
failed. Preserve input, explicit review and acknowledged departure. Confirmed save plus failed read remains saved.

Creation/duplication, uploads, delete and finance have distinct unknown-outcome semantics.
Do not replay uploads, rebase reviewed money, invent idempotency guarantees or infer rollback from cancellation.
Reapply is an explicit new user action against reviewed current state.

File commands retain existing size/type/storage/ownership/retention checks and post-commit side effects.
Multipart validation owns its decoded JSON and file parts separately; MIME allowlists alone do not prove content or
extension/MIME pairing. Image/print/download/provider boundaries stay explicit document/binary operations.
Never expose filesystem paths or introduce server self-HTTP.

P8 organizer expenses use the existing named `data`/`proof` multipart envelope with optional proof and paid-by
attribution, distinct from participant submissions' mandatory proof. The route admits the organizer before receiving
bytes, validates the authored closed shape and prepares its fixed acknowledgement before entering the existing
operation. That owner retains recorder attribution, membership, proof-type and rejected-upload cleanup decisions.
JSON review/allocation commands use the same prepared acknowledgement boundary without postcommit admission.
Existing precommit revision/lifecycle conflicts remain definite rejections; a successful shared write followed by
lost delivery remains uncertain, without replay or speculative rollback. Confirmed writes remain saved through a
failed follow-up read. P9 calculation, settlement and notification commands and separately authorized cutover remain
outside this implementation.

## Coexistence, rollout, and verification

Native/v1 adapters translate distinct input/status/feedback around shared controller operations and pure DBAL.
Neither route is redirected into the other's HTTP endpoint. Stronger v1 preconditions do not add fields/conflict
behavior to frozen native forms. Adapters retire independently only after consumers migrate and cutover is approved.

D3 corrects unreleased v1 in place. The [Development compatibility procedure](staged/DEVELOPMENT.md#contract-authoring-and-generated-consumers)
preserves released contracts and distinguishes additive from breaking changes; it does not authorize another
unreleased pilot version. D5 current-folder replacement uses the shared session/release protocol; incompatible
commands retain drafts.

Generate before checks, preserve declaration-only contracts and feature-local validators, and verify actual native/
v1 authorization/private projections. Real TypeORM coexistence cases protect touched-field and capacity scheduling;
mounted consumers protect unknown/confirmed recovery; source/SSR/build boundaries receive their focused checks.
Latest execution and remaining limits belong to the [review](PILOT_PARITY_REVIEW.md). Documentation reports remain advisory.
