# Shared data refresh and conflict design
<!--
documentation-metadata
audience: maintainers; frontend developers; API developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-16
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: implemented P2 Event dynamic reload scope reconciled with the existing subsequent-route provision; retained refresh/draft boundaries and anonymous context distinction; no new concurrency guarantee
source-anchors: src/frontend/app/context.ts; src/frontend/app/createApp.ts; src/frontend/app/queryCache.ts; src/frontend/app/queryKeys.ts; src/frontend/composables/; src/frontend/features/packing/; src/frontend/features/event/; src/frontend/features/overview/; src/modules/api/session.ts; src/modules/database/services/PackingService.ts; contracts/api/v1/
next-review: next-refresh-migration-or-authorized-cutover
-->

TanStack Query owns server snapshots, feature drafts own unsaved values and Vue Router owns durable navigation.
A request/application-local context coordinates identity, locale and update state without another data store.
The original protocol and dated amendments remain in [Foundation](FRONTEND_FOUNDATION_DESIGN.md).
[API](API_CONTRACT_DESIGN.md) owns wire/precondition shapes; [Development](staged/DEVELOPMENT.md) owns contribution steps.

## Implemented Packing boundary

The pilot implements scoped reads, draft reconciliation, capacity-sensitive operations and independent metadata/
item/order/setup comparisons. Approved D2 replaces the original persisted Packing metadata revision with touched
current-value tokens under existing locks, including useful setup fields. No relationship history or live-editing
infrastructure is added. Financial revisions and recommendation fingerprints retain their own guarantees.

Native/v1 adapters now invoke named shared operations and central method policy in the existing Packing controller.
V1 independently granted actions no longer impose unrelated detail-page membership; private projections retain their
own grants. Completed scoped execution and the approved coexistence remedy belong to the review.
Native last-write bodies remain unchanged; a changed native value participates in later v1 comparison.
Persistence reuse must not leave duplicated business policy or impose page membership on separately permitted actions.

## State ownership

| State | Owner and lifetime |
|---|---|
| Authorized DTO/query receipt | Query cache, captured identity/resource/filter/locale scope; never mutate it as a form. |
| Original/local/remote draft | Feature MetadataDraft or specialized owner, independent from background cache replacement. |
| Pending/unknown/confirmed command | Shared command/completion owner; may outlive a component. |
| URL/search/page/fragment | Router plus feature delivery policy; commit only admitted navigation. |
| Locale/identity/update | App context and shared translator; transitions retire private generations. |
| Packed? checklist | Existing Packing browser-local storage contract, not generic/profile server state. |

The [approved Packed fallback](FRONTEND_FOUNDATION_DESIGN.md#authorized-temporary-packed-state-fallback-2026-10-13)
preserves the native key/value contract. Healthy checklist rereads observe external changes and a missing key returns
unchecked, except where an outstanding failed toggle still owns that item's selected value. Failed reads/writes
retain the mounted actor/list visit's observed or selected checks. A persistent localized notice explains that some
checks could not be loaded or saved and unsaved changes may be lost on leave/reload or account/profile change.
A failed read alone does not classify a previously stored or successfully written value as unpersisted.
Explicit Retry reattempts only outstanding local writes and reads; background reads do not replay writes.
Keep the notice while reads fail or writes remain outstanding. Retire fallback and pending local writes on list/
context change, unmount or validated resource retirement; persisted keys remain profile-independent. Local callbacks
check their mounted actor, admitted list and live/rendered row before writing; Retry prunes departed rows first.
Neither grants a server write, automatic replay or restoration promise for unsaved changes after departure.
Shared item commands and polling remain independent of local storage.

Generic cache/command/feedback owners accept caller-selected families/policy rather than importing feature endpoints.
Capabilities are display guidance; controllers authorize every write.

## Authorized refresh clarification (2026-10-08)

Healthy active shared views use 30-second polling. Eligible ordinary recovery targets convergence within roughly
one minute instead of the original generic two-minute failed-read delay. Server cooldowns, hidden-tab behavior,
observer disposal and request sequencing still apply. This is a bounded policy, not a freshness SLA, live feed or
arbitrary age-based command prohibition.

## Initial refresh policy

| Read | Policy |
|---|---|
| Visible active detail/overview/settings | Read on entry; explicitly configured stale/poll/focus/reconnect policy, healthy 30-second cadence. |
| Closed/unmounted section | Stop observations/intervals; begin hidden region on opening. |
| Session | Entry/focus/reconnect/identity signal and periodic visible checks, coordinated before private reads. |
| Picker | Debounced bounded search; initial selected title independent of filter; open/active observations only. |
| Static catalog/Help | No shared-data polling; language/release-owned content reads when required. |
| Reviewed finance preview | Explicit preview/refresh; stale detection cannot replace reviewed values/token. |
| Recommendation/job | Existing job-specific backoff/expiry/terminal rules. |

The last two rows describe intended future frontend integrations, not implemented pilot query consumers.
[DEC-006](../decisions/DEC-006-FRONTEND-FRAMEWORK.md#deferred-localization-and-domain-integration-targets) preserves
their durable status and domain boundaries; it supplies no implementation approval.

Honor Retry-After and per-client jitter. Safe reads can retry with bounded shared backoff; commands default to zero.
Do not run independent interval/retry timers against the same failed endpoint.
Hidden polling is off; focus/reconnect refresh follows authoritative session revalidation.

Automatic-read admission is distinct from mounted presentation readiness. Pause private query dispatch while session
bootstrap is pending, failed or blocked by its server cooldown; only a current successful bootstrap reopens that
admission. Ordinary revalidation retains confirmed readable content and drafts. Validated actor changes still retire
the old private scope. Gate every automatic consumer, including visibility-triggered enabled queries, rather than
only awaiting bootstrap before an explicit refetch.
The existing app context exposes `readsReady`/`mayRead` for dispatch and retains `ready`/`isCurrent` for presentation
and result-generation checks. Existing `useQueryAdmission` applies `mayObserve(key, firstRead)` per mounted logical-key
visit. A fresh visit can recheck a cached terminal denial; actual dispatch or joining an existing pending read consumes
first admission, and later automatic resumes keep the failure paused. Explicit dependency refresh selects the actual
eligible observer and rechecks its key-bound metadata after cancellation, without reading hidden or retired regions.
Deliberate manual recovery remains eligible through `mayRead` and its own deadline. Transport checks the same dispatch
admission. Already admitted image/picker reads retain their captured lifetime during ordinary bootstrap pause, while
actual actor/input/visibility retirement still disposes them. Focus recovery shares an observer read already started
by successful admission instead of canceling/restarting it.

Conditional GET, where supported, can retain equal DTOs and refresh receipts without moving focus.
It still requires authorization before 304 and does not eliminate query cost.
Private application cache remains in memory, without persisted query/service-worker private DTO storage.
Measure actual read cost before adding feeds/websockets or increasing cadence.

## Errors and cancellation

Forward the same AbortSignal through HTTP, decoding, classification and cooldown owners.
Reject obsolete actor/resource/route/locale generations in addition to physical cancellation.

| Outcome | Required behavior |
|---|---|
| Temporary read failure | Retain confirmed readable content/drafts and show corresponding last-success/deadline/retry state. |
| 429/retryable 503 | Honor server deadline; unavailable Retry never starts an early read. |
| Known invalid input/credential | Confirmed rejection with its operation feedback; no loop or global expiry inference. |
| Actual identity expiry/context mismatch | Retire old private scope, bootstrap/recover without replay under another actor. |
| Validated read denial/disappearance | Remove protected projections and relevant cached appearances; a stale alias cannot restore them. |
| Narrow field/foreign-child rejection | Keep distinct from parent read loss; revalidate only affected authority/dependencies. |
| Intentional navigation/cancel | Ignore retired completion without an invented network-error toast. |

A fulfilled TanStack observer refetch may return canceled retained data or reuse an older cold fetch.
`refetchFreshQuery`/`refetchFreshQueries` in the existing cache owner retire older reads, recheck captured admission
and await a newly dispatched successful underlying promise. Cancellation cannot advance baseline/token or release
awaiting authority. Equal actual successful data can; object identity/idle flags/timestamps alone cannot.

Background authority adoption uses actual successful read events for the exact current key.
Manual cache writes and old-fetch aliases are not receipts. A fresh admitted read restores denied projections;
old SSR closures/back navigation cannot replay a seed after eviction or actor retirement.

Features name dependencies when access disappears: detail/editor/picker/card/parent appearances can differ from
public guest/copy policy. Retire late responses within selected families, not every actor/resource indiscriminately.
Field write loss disables saving while readable drafts remain explicit; actor/read loss clears protected state.

An aggregate's lifetime follows the admitted projection that supplied it. When a validated Overview-region denial
retires its cards/cache, retire its private totals and hidden/membership badges too. A temporary failure retains the
successful scoped evidence; independently admitted siblings may retain only their own aggregates. Derive this from
existing source scopes/receipts rather than a second server-count store, and never interpret lost authority as zero.

## Identity changes and multiple tabs

Server session context and browser epoch jointly bind reads/commands to captured actors where identity exists.
The [Oct15 session-ownership amendment](FRONTEND_FOUNDATION_DESIGN.md#session-ownership-restoration-and-stateless-initial-visits-2026-10-15)
removes mandatory anonymous initialization: sessionless projections use null metadata and only the app-local epoch
for late-result/cache lifetimes. That epoch is not server authority. A changed cookie with stored context still
requires matching server evidence; omitted fields cannot turn its current identity into an anonymous actor.
Login/logout/profile/guest transitions rotate context. Before an intentional switch, resolve dirty/pending work,
retire old scope, bootstrap the new context and then admit queries.

A previously admitted command may complete for its original actor; abort is not rollback.
Its late result cannot populate a new actor view, and an old tab cannot silently submit as a changed cookie's profile.
Cross-tab messages are data-free invalidation hints, never DTOs/cookies/credentials.
Focus/periodic checks cover missed signals and native/external transitions; no instantaneous disconnected-tab erasure
or atomic session-store compare-and-swap is claimed.

Confirmed private identity/completion survives only in its matching scope through temporary read/delivery failure.
After successful identity transition, retire/drain obsolete bootstrap before accepting private guest-link results.
Cancellation/rejection restores the visible active selection, without replaying identity commands.

## Draft refresh and ordinary metadata conflicts

Keep original, local and current values independent. Normalization is supplied by the feature and used identically
for dirtiness/submission; missing values remain omitted and null/false/empty retain field meaning.
Refresh clean fields immediately. Unrelated remote changes can advance untouched baselines while local patches survive.
Overlapping values/grant changes offer explicit review rather than silently rebasing dirty input.

D2 comparisons are current-value checks, not monotonic history: change-away/change-back can match an old token.
Compare only submitted fields under required actor/parent/root/item locks. Missing/stale preconditions use the
authored API error; do not reveal hidden current values or merge semantically coupled fields automatically.

Confirmation acknowledges submitted values for presentation. Only a fresh admitted post-command read supplies
current token/grants/baseline. A failed/canceled read leaves saved values visible with blocked stale authority.
An equal successful read can restore that authority without requiring different JSON.

## Commands whose conflict and retry rules differ

| Workflow | Preserve |
|---|---|
| Creation/duplication | Unknown result retains draft/review; a read cannot prove creation failed; explicit reapply is a new action. |
| Assignment | Locked capacity/membership/idempotent semantics; no optimistic final count or metadata-token substitute. |
| Order/setup | Exact relevant membership/current fields; sparse policy and independent drafts. |
| Upload | File/input retention and existing ownership/uncertainty; no automatic replay or assumed rollback. |
| Finance/payment/refund | Command-specific revision, preview, saved-versus-pending and signed evidence; never generic merge/rebase. |
| Recommendation review | Existing fingerprint/job/stale-review protocol. |
| Archive/hide/delete | Separate shared lifecycle, personal placement, hard deletion and file retention. |

D4 is reconcile-only without operation tracking. Recovery reads inform explicit review; they do not automatically
retry writes or prove an unknown operation failed. Saved-plus-failed-refresh remains saved.
A following read suppressed during same-actor session revalidation retains the confirmed write result and warning;
only actual captured-actor retirement discards that result. The feature releases completed input without replaying
the operation or treating stale read authority as renewed.
Whole-page destructive departure obtains consent before writing; captured unknown/pending states can outlive editors.

## Dependent refresh and presentation stability

Commands invalidate only named affected families, not every query. Retire pre-command reads before authority
continuation. Dialog sections keep separate baselines/drafts; close resolves its subtree, whole-page/identity/update
departure resolves all affected work.

Confirmed navigation retains canonical destination and one-time receipt through failed/canceled delivery.
Transient feedback expiry/renewal follows receipt identity, not translated text or unrelated renders.
Read notices clear through their own recovery; Retry deadline availability never starts commands.

Region navigation reads before history commit, merges one region into latest URL and adopts server clamping.
Failed/obsolete targets keep current cards/URL/focus. Preserve sibling state, modified-click hrefs, search caret,
fragments and pending drafts. Optional images inject feature operations and own cancellation/object-URL lifetime.

D5 ordinary session refresh detects binary-folder replacement. The explicit 2026-10-15 amendment limits automatic
full-document reload to eligible dynamic route/content. Its initial Overview and Packing detail scope now also
includes P2 Event detail/administration under the approved subsequent-dynamic-route provision (2026-10-16).
Creation, duplication, user-management, Help and static admitted error/completion content are excluded even when
untouched. Compatible
loaded edits may finish; eligible reloads still require clean state, no pending/unknown command and working loop
protection. Missing chunks/incompatible commands retain mounted drafts and guarded deliberate recovery on every
page; no retained asset service is required. This document-replacement policy does not change periodic content reads
or session/security revalidation.

## Verification boundary

Use real mounted query/transport consumers for cancellation/authority, actual controller/DBAL calls for coexistence,
and selected browser focus/navigation/SSR cases when their boundary is affected.
Keep native/v1 action policy and private projection scenarios independent of full-page membership.
Future finance/activity slices preserve baseline exception IDs and existing server protocols.

Completed scoped correction evidence and its limits belong to the [review](PILOT_PARITY_REVIEW.md).
Use the [risk procedure](staged/TESTING_GUIDE.md#risk-and-test-cost), not a mandatory full-stack test cross-product.
Documentation reports remain advisory.
