# Shared data refresh and conflict design
<!--
documentation-metadata
audience: frontend developers; API developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-08
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: FPR-07 explicitly authorized 2026-10-08 scope/fallback/documentation amendments and staging; original choices/D1-D5 retained; no new runtime verification claimed; approved D1–D5 rectification source/ownership and documentation consistency review; actual execution evidence remains in the paired review record; source review of expanded packing metadata/item/order/settings tokens, overview refresh, identity transitions and command recovery; distinguishes implemented behavior from remaining cross-feature targets; no application, database or browser checks run for this documentation update
source-anchors: docs/frontend-migration/EDGE_CASES.md; docs/frontend-migration/IDENTITY_LIFECYCLE_EDGE_CASES.md; docs/frontend-migration/PARTICIPATION_EDGE_CASES.md; docs/frontend-migration/INVOICE_EDGE_CASES.md; src/frontend/app/context.ts; src/frontend/app/api.ts; src/frontend/app/queryCache.ts; src/frontend/composables/command.ts; src/frontend/components/InlineCell.vue; src/frontend/features/packing/PackingPage.vue; src/frontend/features/packing/PackingSettings.vue; src/frontend/features/overview/OverviewRegion.vue; src/frontend/features/overview/OverviewPage.vue; src/modules/packing/api.ts; src/routes/api/v1/auth.ts; tests/frontend/frontend-pilot.spec.ts; tests/frontend/frontend-pilot-identity.spec.ts; tests/frontend/packing-management-ui.spec.ts; src/public/js/modules/entity-cards-overview.ts; src/public/js/modules/entity-select.ts; src/public/js/modules/entity-properties.ts; src/public/js/modules/invoice-submission.ts; src/modules/activity/recommendationJobs.ts; src/modules/invoice/poolOperations.ts; src/controller/entityAdminController.ts
next-review: packing-invalidation-or-next-feature-migration
-->

Use TanStack Vue Query for authoritative server snapshots and small explicit draft objects for edits. Refreshing
server data must not mutate an open form, silently accept a new financial preview or turn an unconfirmed write into
a retry. This remains the cross-feature direction for the [foundation](../FRONTEND_FOUNDATION_DESIGN.md), not a claim
about the complete legacy frontend. The [opt-in implementation](../FRONTEND_PILOT.md) now covers packing management,
creation, settings, overview and necessary identity entry through v1. Its refresh/draft policies extend beyond the
original metadata/self-assignment proof. Financial, activity and other feature policies below remain future work.

The [API design](API_CONTRACT_DESIGN.md) owns wire preconditions and status codes; the
[edge-case records](EDGE_CASES.md) own existing product exceptions. The policies below connect those boundaries to
the browser and supply scenarios for implementation and review.

## Implemented packing boundary

[The app context](../../src/frontend/app/context.ts) owns session bootstrap, identity epochs, a request-local query
client, visible-tab focus/reconnect checks, read retries and locale changes. [The transport](../../src/frontend/app/transport.ts)
checks generated DTOs, captured identity and confirmed command responses; it never retries a mutation automatically.
[PackingPage](../../src/frontend/features/packing/PackingPage.vue) polls the scoped detail representation;
[PackingSettings](../../src/frontend/features/packing/PackingSettings.vue) keeps independent metadata, ACL, event and
file draft state; [OverviewRegion](../../src/frontend/features/overview/OverviewRegion.vue) owns one bounded region.
The four participant/owner × main/hidden regions retain independent query parameters. Hidden regions open on matching
deep links through [OverviewPage](../../src/frontend/features/overview/OverviewPage.vue).

| Reviewed state | Implemented comparison and recovery |
|---|---|
| Root title/description | Opaque comparison hashes of current fields; sparse writes compare touched fields under locks, adopt disjoint refreshes and retain overlapping drafts for explicit review |
| Inline item fields/Everyone | Item `editToken` hashes current values and actor/resource scope; fresh authority is checked under the item lock, and the shared editor compares its displayed field |
| Item order | Captured `orderToken` includes current item membership/positions; additions, removals or changed order require a fresh review before resubmitting |
| Defaults/admin masks | Sparse audience patches compare changed masks; each administrator has its own token. Unrelated setup edits do not block a draft; actual overlapping changes require review |
| Event association | Desired and original event remain separate; actual relink checks `expectedEventId` and the reviewed settings token under existing controller locks |
| Header replacement | Selected file retains the reviewed settings token; scoped blob reads use opaque header versions and revoke obsolete object URLs |
| Creation/duplication | Explicit local draft; no creation replay after response loss and no generic idempotency key |
| Self-assignment/visibility | Explicit desired state with the existing server no-op policy; commands still require confirmation and subsequent authoritative reads |

Approved D2 replaces the earlier persisted packing metadata/context counter with current-value comparisons,
including setup fields. No packing revision column or new relationship history is needed. These tokens do not
promise change-away-and-back detection; fresh authorization and atomic capacity checks remain mandatory. [The API owner](../../src/modules/packing/api.ts)
and [API design](API_CONTRACT_DESIGN.md) define the exact coverage and 428/412 versus semantic 409 outcomes.

## State ownership

| State | Owner and lifetime |
|---|---|
| Server DTO and read status | Query cache, keyed by API version, identity scope, locale where representation varies, resource type/ID and normalized filters |
| User draft | Feature/editor instance: original values and edit token, current input, validation, remote-change notice; never a mutable reference into cached DTOs |
| Routing/search/tab context | Router query/hash or a small component owner, preserving existing deep-link and independent-region semantics |
| Pending command | Command instance bound to its original actor, resource and submitted input; survives a read failure without being reclassified as an unsaved draft |
| Local Packed checklist | Existing browser-local list/item key; neither query data nor an account/profile preference |
| Session/locale | Small app owner; changes coordinate cache, drafts, requests and translations explicitly |

Use feature-owned query functions and keys, not fetch calls scattered through components. Multiple components reading
the same key share one cached query. Do not mirror those DTOs into another global store. A detail query must not
silently prefetch every item, participant, proof, historical ledger or linked feature behind an unopened section.

## Authorized refresh clarification (2026-10-08)

The rectification retains the healthy 30-second cadence and targets roughly one-minute convergence for active
shared views under a responsive backend. Honor server cooldown, pause hidden/unmounted observers, and reuse one
scheduler for interval, return/focus/reconnect and read recovery. Clear only the notice belonging to a recovered
operation. Dirty forms still receive authoritative snapshots without replacing their input or original baselines.
Closed selectors use current authority supplied by their owner and keep draft IDs separate; they do not poll
hidden searches continuously. Late responses cannot restore an invalidated selection or obsolete navigation.

This expressly supersedes the original generic failed-read delay capped at two minutes in the initial policy
below. The old policy remains design history, not the rectification target. The amendment introduces no automatic
write retry, arbitrary age-based command prohibition, new relationship history or backend hardening project.
Actual implementation and focused verification belong in the pilot guide and paired review.

## Initial refresh policy

These are the starting policies, not library defaults or a freshness SLA. Packing detail, open settings and
visible overview regions use 30-second polling with per-client jitter; collapsed regions stop reading. Shared
pickers debounce searches for 200 ms and read only when open or resolving an initial selected title:

| Read | Initial policy |
|---|---|
| Active visible shared detail/overview region | Read on entry; stale after 15 seconds; poll at 30 seconds with per-client jitter |
| Open participant/list section | Same policy while observed; stop its interval when closed/unmounted |
| Identity bootstrap | Revalidate on app entry, focus/reconnect, identity signal and periodic visible activity; at most 30 seconds between visible checks initially |
| Picker search | Debounced request on user input, current bounded page only; event choices may refresh while open, with no closed-picker polling |
| Reviewed invoice preview | Explicit open/Refresh preview; polling may detect that it is stale but must not replace the reviewed values/token |
| Activity job | Retain the job-specific status/backoff/expiry policy; stop when terminal or its scope is obsolete |
| Static catalogs/help content | Versioned build/catalog assets; no shared-data polling |

Configure hidden-tab polling off. Refresh active reads on focus and reconnect after session revalidation. A manual
refresh is available for recoverable stale reads; distinguish a network refresh from the invoice ledger's existing
local Refresh list action. Do not poll writes, identity search, token-consuming routes or exports.

TanStack exposes configurable intervals and focus handling; set policy explicitly instead of inheriting defaults.
[Query options](https://tanstack.com/query/latest/docs/framework/vue/reference/useQuery),
[focus refetching](https://tanstack.com/query/latest/docs/framework/vue/guides/window-focus-refetching)

Use conditional reads where the API offers a view ETag. An unchanged result keeps the existing DTO and updates
freshness without rebuilding the form or moving focus. Reauthorize every conditional read before returning 304;
an old ETag cannot authorize a private response. The application query cache stays in memory: do not persist private
DTOs in query storage or a service worker cache. Browser HTTP caching separately follows the API's private/no-cache
or no-store policy. Conditional requests can save response bytes but do not themselves eliminate server query cost.

At 30 seconds, one active detail query produces roughly two scheduled reads per visible client per minute, plus
navigation/focus/commands. Measure real authorized read cost and concurrent-tab load before increasing polling.
The initial implementation needs no global change feed, websocket server or event bus. If measured load later
justifies server-sent invalidations, add them behind the same query invalidation boundary.

## Errors and cancellation

Pass each query's AbortSignal through the typed transport to fetch. TanStack does not automatically cancel every
unused promise unless the consumer uses its signal; additionally reject obsolete results using the local identity
and request generation. [Query cancellation](https://tanstack.com/query/latest/docs/framework/vue/guides/query-cancellation)

| Outcome | Browser behavior |
|---|---|
| Temporary failed read | Retain last confirmed readable data, show stale/retry state and last successful refresh; do not render an empty collection |
| Network/temporary 5xx | At most two read retries with jittered backoff; then suspend the regular interval for that failure cycle and use increasing retry delay capped at two minutes |
| 429 or retryable 503 | Honor Retry-After before another scheduled/manual automatic request; keep the draft and display retry timing |
| 400 validation/input rejection | Show query or validation issue; no automatic retry loop; legacy statuses retain their own adapter mapping |
| Expired/auth-required 401 | Stop private queries, clear private cached display, retain only permitted recovery context and begin structured reauthentication; known invalid login/token credentials are ordinary confirmed rejections |
| Context mismatch | Clear the obsolete identity scope and bootstrap the current one; never replay the failed command as the new profile |
| Confirmed read denial or resource disappearance | Remove protected resource projections and their cached appearances; explain unavailable access without exposing private names or stale authorized DTOs |
| Navigation/cancelled read | Ignore its completion; do not show a network-error toast for intentional cancellation |

Implement scheduling/backoff once in the query policy so a retry timer and a normal interval cannot hammer the same
failed endpoint independently. Reconnect/focus may request a fresh check when policy allows it; route unmount disposes
its observers. Existing server rate limits remain meaningful.

A read-side 403/404 that establishes lost access or disappearance also removes the entity's cached card, picker and
parent/detail appearances in the current scope. Cancel their obsolete reads and reject late results so removed private
data cannot reappear. Do not merely mark those copies stale until the next interval. A rejected edit or foreign child
ID does not by itself establish loss of read access to the whole parent: keep that narrower outcome distinct and
revalidate the affected capabilities. Preserve each endpoint's disclosure policy.

The current [packing eviction helper](../../src/frontend/app/queryCache.ts) cancels/removes that list's scoped detail,
metadata, settings, profile-search and guest-entry keys, plus the current actor's mixed overview and event
picker query families. Removing these bounded collections avoids manufacturing partially redacted DTOs. Other lists'
detail entries, other features and other actor scopes are retained. The transport/context tests exercise a delayed
overview read so its earlier result cannot restore the evicted card. Future features need their own dependency owners.
Current HTTP responses are private/no-store; application query caching is separate from browser-cache policy.

Mutation retries default to zero even where a query library offers retry options. A command may expose a deliberate
retry only through its endpoint-specific contract. Transport abort is not server transaction rollback.
[TanStack mutation guidance](https://tanstack.com/query/latest/docs/framework/vue/guides/mutations)

## Identity changes and multiple tabs

Session bootstrap returns an opaque context identifying the current session generation and active actor/profile.
All subsequent v1 reads and writes send `X-Surveyor-Context`; the server rejects a mismatch before returning resource
data or admitting a command. A request-scoped actor remains fixed throughout that operation. Each response is also
checked against the query's captured context and the browser's current local identity epoch.

On profile switch, login/logout or a cross-tab identity signal:

1. Resolve this tab's dirty drafts and pending command state before a user-initiated switch. Do not pretend an
   already admitted command was cancelled by aborting its request.
2. Pause new commands, increment the local epoch, cancel reads and clear the old private query/draft scope.
3. Bootstrap the new session and locale, then admit new queries under its context.
4. Broadcast only an invalidation hint to other same-origin tabs; no private DTO, cookie or credential is broadcast.

Another tab may switch identity while this tab's command is already admitted. That command may complete for the
original actor; its late result must never populate the new actor's screen. New commands from an old tab get a context
mismatch rather than silently acting as the cookie's new profile. Focus/periodic session checks cover missed or
unsupported cross-tab signals. This design does not claim instantaneous removal from a disconnected tab or revocation
of bytes already delivered to a browser; current server authorization always controls subsequent reads/writes.

The current context owner broadcasts a data-free identity hint after confirming a successful SPA transition and
listens without rebroadcasting received hints. Native/external identity changes still rely on focus/periodic checks;
there is no instantaneous cross-protocol notification guarantee. A successful identity command retires the old local generation, drains any older
in-flight bootstrap and obtains a fresh authoritative session before accepting a private guest link. Its new response
context must match that session. Form reuse resets completed/register/reset state, while cancelled or rejected
profile switches restore the visible selection to the active profile. These boundaries have focused source-linked
[transport/context](../../tests/frontend/frontend-pilot.spec.ts) and
[mounted navigation](../../tests/frontend/frontend-pilot-identity.spec.ts) assertions.

Recheck the session-audience hydration discrepancy in EC-ID-11 through real routes before trusting capability DTOs.
Do not infer authenticated/guest audiences from whatever optional ORM relations happen to be present in a cached
session object. The versioned API's authority must be explicit and derived from the current server identity.

## Draft refresh and ordinary metadata conflicts

When a form is clean, a successful read may replace its saved values. When it is dirty, keep three separate values:
the original snapshot **B**, local draft **D**, and latest authorized remote snapshot **R**. Background reads update R
and clean display regions. Disjoint changes may advance the baseline/token while retaining the sparse draft;
overlapping changes keep the original baseline and require explicit review.

| Field comparison | Suggested reconciliation after a rejected stale save |
|---|---|
| D equals B | The user did not edit it; use R |
| R equals B | Only the local draft changed; retain D |
| D equals R | Both reached the same value; no field disagreement |
| All differ | Show original, mine and current; require an explicit choice |

After 412, load current authorized metadata, explain the changed fields and preserve the user's draft. Offer a
reviewed merge/discard; never automatically submit the merge. A deliberate retry uses the newly reviewed edit token.
Only edited authorized fields are included in the PATCH. A later concurrent change can cause another 412.

Strings, null, absent fields, false and zero remain distinct according to the contract. Do not run this generic merge
over ordered slot operations, permission masks, file replacement, relationship moves or financial calculations:
those require their feature-specific review. If permission disappears while editing, show the appropriate access
state and stop saving; a hidden old control or retained draft is not permission to write.

Treat semantically coupled fields as one reconciliation unit. In particular, a local deadline and its IANA timezone
must be reviewed and reapplied together; combining one editor's deadline with another's timezone can change the
intended instant despite each field looking independently conflict-free. An unrelated save preserves the original
deadline/zone pair and existing fallback semantics (EC-UI-02/06 and EC-ID-34).

Packing conditional writes compare current touched fields inside shared controller-owned operations used by
native and v1 adapters. Assignment-only changes and unrelated setup fields do not invalidate a description edit.
The API design separates comparison tokens from full-view read tags, rechecks authorization and retains 428/412.
The unreleased metadata counter and migration were removed under approved D2; financial revisions remain unchanged.

## Commands whose conflict and retry rules differ

| Command | Preserve and expose |
|---|---|
| Packing/driver self-assignment | Existing locked idempotence; repeat desired membership rather than an ambiguous toggle; 409 for a genuinely new assignment that loses capacity |
| Event attendance | Existing updates at full capacity and independent deadline rules; repair the documented capacity check/write gap before claiming atomic final-place protection |
| Event association | Packing compares expected event plus its event field token under locks for an actual move. An authorized already-achieved target remains a no-op before token comparison; other feature migrations retain their own contracts |
| Invoice submission | Unknown result leads to authoritative history reconciliation; no automatic retry or manufactured server idempotency guarantee |
| Invoice close/recalculate/review | Preserve each command's revision and confirmation rules, saved-versus-pending amounts and stale rejection; obtain a fresh preview/review where the command requires it |
| Invoice payment/refund | Preserve existing payment rules; payments advance the pool calculation revision and invalidate earlier previews, but the current payment request does not itself require an expectedRevision precondition |
| Activity recommendation application | Keep reviewed operation set, warning digest, job provenance and locked context; generic metadata merge cannot substitute for these checks |
| Personal visibility | Set the explicit desired state and invalidate its scoped appearances; never confuse it with shared archive/restore/delete |
| Local Packed | Immediate local change under the existing key, without API write, server refresh or profile-specific migration |

A timeout produces an **unknown** command outcome unless the server definitively rejected it. Keep its captured input
and recovery route; do not label it “not saved.” A successful read cannot confirm which row an unknown creation
produced or prove that a registration/email command failed. Those drafts remain blocked from resubmission until
the user reviews the current state and explicitly acknowledges the uncertainty, or acknowledges leaving the draft.
Desired-state updates may reconcile from an authoritative read without replaying their command.
Conversely, after a confirmed successful write, a failed refresh is
a stale-display problem, not a failed mutation. Show confirmation with retry-read recovery, without inviting a second
invoice, duplicated token consumption or another financial action. The existing organizer response-loss browser
journey is valuable evidence to port; the participant-upload and JIT-read variants still need focused coverage.

Optimistic updates are limited initially to local presentation and endpoints whose desired-state/idempotency policy
has been established. Keep capacity-sensitive assignments and all financial effects pending until server confirmation.
The point is a consistent command lifecycle, not identical optimism for every feature.

An infrequent application release is detected through the existing session refresh. The coordinator reloads once
when every active form is clean and no command is pending or uncertain. A compatible loaded form can finish first;
an incompatible write is rejected before side effects. Feature owners register their draft guards with this shared
coordinator rather than adding reload loops or requiring old release assets to remain served.

## Dependent refresh and presentation stability

Feature command owners declare the affected query families explicitly. They should invalidate only current-scope
data and use an authoritative mutation response when available. Avoid a central list of every business relationship
inside the generic HTTP client.

| Successful change | Related reads to reconsider |
|---|---|
| Assignment/registration | Row state, aggregate counts, own participation and affected overview membership; financial enrollment where applicable |
| Metadata | Detail/header, metadata editor, matching overview card and affected picker labels |
| Association | Child detail, old/new event collections, admission/capabilities, inherited archive and activity context |
| Archive/restore/visibility | Shared archive projection and relevant personal overview regions, without changing files or unrelated profiles |
| Invoice/review/payment | Current input totals, saved ledger/payment state, stale notices and preview freshness according to actual operation |
| Profile/session/locale | Identity scope disposal or locale-dependent representation refresh, following the respective identity/catalog policy |

Avoid replacing a table row under the pointer while its settlement action is pending. Preserve the current invoice
ledger's deferred reordering/status filtering, query search focus/caret, selected event and active activity tab.
An identity or permission change takes precedence over keeping stale private content visible. Refresh does not
annihilate modal focus, hide persistent status or reset local Packed colors.

## Implementation and subsequent-slice scenarios

Use deterministic fake clocks/deferred reads at the frontend boundary and actual transactions only where needed:

- A remote title changes while a local description is dirty; adopt the title and current baseline while keeping
  the sparse description edit. A later overlapping description change rejects and requires explicit review.
- Two clients change the same field; the loser sees a field conflict and no write occurs before a deliberate retry.
- A legacy writer changes metadata while the Vue form is open; the same conditional-write protection applies.
- An assignment-only change refreshes counts without causing an unrelated metadata conflict or clearing Packed.
- A profile switches before an old read resolves; neither the old response nor a new-cookie response can enter the
  old query scope. A command admitted before the switch is reconciled as the original actor's command.
- A write succeeds and the following read fails; retry refresh does not submit the command again.
- Hidden/unmounted routes stop their intervals; reconnect/refocus produces bounded requests and respects Retry-After.
- A permission is revoked while a dialog is open; the draft cannot bypass the server and protected data is removed
  from detail, cached cards and pickers when current read access is denied. A field-only edit denial does not remove
  unrelated readable data, and a late read cannot restore an evicted private projection.
- When an event editor is migrated, concurrent deadline/timezone changes are reconciled as a pair; an unrelated
  metadata edit cannot reinterpret the saved deadline.

These remain acceptance scenarios, not a blanket claim of coverage. The source-linked packing
[management component](../../tests/frontend/packing-management-ui.spec.ts),
[controller/DBAL integration](../../tests/integration/packing-management-api.spec.ts), and
[HTTP](../../tests/e2e/frontend-pilot-api.spec.ts) suites now cover selected implemented boundaries. Current run and
visual-review evidence belongs to the [pilot record](../FRONTEND_PILOT.md). No application tests or database commands
were run for this documentation update; use the cheapest meaningful layer for each remaining scenario.
