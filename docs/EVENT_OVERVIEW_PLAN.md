# Event-card overview design and implementation
<!--
documentation-metadata
audience: product maintainers; developers; reviewers
owner: dashboard feature maintainers
status: current
last-verified: 2026-09-16
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: implemented mixed card overview with expandable event cards, bounded queries and rendering, preserved membership and visibility, shared module ownership, source-reviewed query/navigation contracts, application checks, and measured 500-event/100000-child fixture with latency limitations recorded below
source-anchors: src/controller/userController.ts; src/controller/entityAdminController.ts; src/modules/database/services/UserService.ts; src/modules/database/services/EntityAdminService.ts; src/modules/database/services/EntityLifecycleService.ts; src/modules/database/services/ActivityService.ts; src/modules/database/services/PackingService.ts; src/modules/database/services/DriverService.ts; src/modules/database/services/EventService.ts; src/modules/database/services/SurveyService.ts; src/modules/archive/policy.ts; src/modules/permissionEngine.ts; src/modules/lib/util.ts; src/modules/renderer.ts; src/types/UserTypes.d.ts; src/routes/users.ts; src/routes/api/users.ts; src/views/users/dashboard.pug; src/views/modules/module_unified_entity_cards.pug; src/public/js/modules/entity-cards-overview.ts; src/public/js/modules/entity-archive.ts; tests/frontend/entity-cards-overview.spec.ts; tests/integration/entity-archival.spec.ts; tests/e2e/archival.spec.ts; package.json
next-review: overview-query-or-navigation-contract-change
-->

The implemented overview uses mixed cards: event cards retain their images, titles, and familiar appearance and
expand into a sub-view of the profile's relevant linked entities. This document records the implemented design,
module boundaries, and acceptance criteria for maintaining that behavior. The user procedure is maintained in
[Your Overview](user-guide/DASHBOARD.md).

## 1. Implemented concept

Keep **one mixed card grid** in each existing overview region. Events appear as normal event cards alongside
surveys and other independent cards. An event card gains a **Show linked entities (N)** action when it represents
eligible linked entities. Those children appear inside the event's expanded sub-view instead of separately in the
default grid.

Preserve **Your participation**, **Administrable entities**, and each collection's **Archived and hidden** region.
These existing boundaries still apply. Do not introduce separate Events/Standalone sections, event headings above
the default grid, or independent top-level pagers for different kinds of cards.

Illustrative default view:

```text
Your participation
Search your participation…                       Filter: All types

┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
│ Summer camp image     │ │ Survey image          │ │ Weekend trip image    │
│ Summer camp           │ │ Choose a date         │ │ Weekend trip          │
│ Description…          │ │ Description…          │ │ Description…          │
│ event · existing      │ │ survey · existing     │ │ event · existing      │
│ badges/actions        │ │ badges/actions        │ │ badges/actions        │
│ Show linked entities  │ │                       │ │ Show linked entities  │
│ (8)                   │ │                       │ │ (3)                   │
└───────────────────────┘ └───────────────────────┘ └───────────────────────┘
[Independent activity card] [Packing card] [Other existing cards…]
Cards 1–24 of 61                                           Previous  Next

▸ Archived and hidden
```

Selecting **Show linked entities (8)** opens a focused sub-view within that same overview region:

```text
← Back to overview

┌─────────────────────────────────────────────────────────────────────────┐
│ Summer camp image                                                       │
│ Summer camp · existing description, badges, and event actions            │
│                                                                         │
│ Your participation · 8 linked entities                                   │
│ [Activity card] [Packing card] [Drivers card] [Other eligible cards…]      │
│ Linked entities 1–8 of 8                                 Previous  Next  │
└─────────────────────────────────────────────────────────────────────────┘
```

The selected event card becomes the enclosing card for the sub-view, retaining its image/title and existing
metadata/actions. Only the selected region's mixed grid is replaced. The linked cards reuse the existing responsive
grid and card styling. The event itself is not duplicated among its children.

This focused expansion avoids squeezing a nested grid into a quarter-width card or calculating insertion positions
across responsive rows. It also gives long child collections their own usable page without introducing default
event sections. **Back to overview** returns to the mixed grid using the region's current search/type choice. If those
filters stayed unchanged, restore the saved overview page, scroll position, and triggering-card focus. Changing a
filter resets the overview page; restore focus to that event card if it remains present, otherwise to the region
heading. Browser Back follows the recorded URL navigation history, which may include child-page changes.

### Event-card interaction

- Preserve the existing image/title/body link to the normal event page and the existing archival and owner controls.
  **Show linked entities** is a separate footer action; clicking it must not also follow the event link.
- The button's number counts only linked entities eligible for this collection and visibility region. An event with
  200 attachments and three eligible children shows three. With no eligible children, it remains an ordinary event
  card without an expansion action.
- Load children on demand when the action is used. Render at most one selected event sub-view per region and replace
  its child page on navigation. Returning to the overview discards the child DOM.
- Preserve the event image sizing/cropping convention, title, description, badges, and action styling through a common
  card implementation. The expanded enclosing card occupies the region width; child cards retain the 1/2/3/4-column
  responsive grid.
- Sub-view context names the current collection: **Your participation** or **Administrable entities**. Do not combine
  these membership sets just because the user can reach both. Expansion from **Archived and hidden** retains that region.
- Opening a sub-view is navigation, not a saved preference. No new database preference, per-event expansion setting,
  or flat/grouped mode is necessary.

## 2. Which cards appear where

First determine membership and placement using the existing rules. Then organize the resulting cards:

| Situation in the current collection and visibility region | Presentation |
|---|---|
| Event card and eligible linked children are present | One event card in the mixed grid; its expansion contains those children. |
| Event card is present without eligible linked children | Ordinary event card with its existing actions. |
| Standalone root is present | Ordinary card alongside event cards in the same grid. |
| Child is eligible but its event card is absent from this collection or belongs to the other visibility region | Keep the child as an ordinary card in the mixed grid. Where permitted, add a small event-context link. |
| Both the event and a child qualify in participation and administration | Each collection organizes its own eligible set; appearances in both remain intentional. |

The child-without-parent fallback is essential: hiding an event currently affects only its card. Its children must not
disappear, and a replacement event card must not undo that choice. Likewise, participating in a child must not invent
participation in its event. This fallback stays in the same mixed grid and creates no additional section.

An event card can act as the container only if it independently belongs to the same collection and region, before
search/type filtering. New context on fallback child cards requires the parent's **ACCESS_VIEW** permission, including
any parent title or link. Otherwise render the child normally without private parent details. Preserve the current
presentation of already-eligible event cards; do not invent a new permission prerequisite for their overview membership.

### Exact eligibility of the child sub-view

The child query is the intersection of:

1. the active session profile's existing membership in the selected collection;
2. the selected event relationship;
3. the selected main or hidden region, using each child's own placement;
4. the current search/type filter, when set.

**Your participation** uses the existing feature participation predicates. **Administrable entities** uses the current
owner/administration-assignment predicates. Event ownership, registration, access, or administration does not substitute
for child membership. Do not fetch an event's complete attachment list or reuse the event page's **Things to do** data
as the sub-view's membership source.

| Type | Current participation predicate to retain |
|---|---|
| Event | Registration for the active profile. |
| Activity plan | At least one assignment for the active profile. |
| Packing list | At least one assignment for the active profile. |
| Drivers list | An assignment **and** an item owned by the active profile, as separate conditions. |
| Survey | Any stored response by the active profile, regardless of answer. |

Managed membership includes ownership or an explicit administration assignment, including the existing zero-mask
assignment behavior. Surveys retain owner-only administration and their response-based participation. Under the
present model, surveys are standalone; only activity plans, packing lists, and drivers lists have event relationships.

### Personal visibility and authoritative archival

Resolve these independently for every root, before deciding which children an event card represents. Reuse the
[archive policy](../src/modules/archive/policy.ts): direct/inherited archival supplies the default placement, while
personal hidden/shown choices override only that root's placement.

- Hiding an event leaves visible children as ordinary main-region cards.
- An explicitly shown child of an archived event remains discoverable in the main region, even when the parent card
  is hidden. Its truthful archive badge stays visible.
- A hidden child is absent from its main-region parent's sub-view. In the hidden region, it appears within the event
  only if the event card also belongs there; otherwise it is an ordinary hidden-region card.
- Showing/restoring an event can collect the matching children back under its card on refresh, without modifying any
  child's personal preference.
- Losing parent membership or relinking children recomputes the same placement rules. Surviving eligible children
  become ordinary cards rather than disappearing with an obsolete event container.

Use the session's active profile, including guests; never accept an acting profile from client input. Deduplicate
underlying entities by type and UUID, not UUID alone. One entity appears once within each collection/region, either
directly or inside its event. A sub-view request rechecks parent eligibility and each child's membership and placement.
A known event ID, a previous card, or a permission on the event is insufficient authority to list its children.

## 3. Search, counts, and pagination behavior

### Search all underlying eligible entities

Keep case-insensitive substring matching over an eligible entity's title, description, or type. Apply it on the server
across all qualifying entities, including children in unopened event cards and later pages. Type choices come from
the full eligible region rather than the current page or text search.

A displayed event card can represent a match on itself, a match on its eligible children, or both:

- A matching child retains its event card as the route to that result, even if the event title does not match.
- Filtering to `packing` can therefore show an event card with **3 matching linked entities**. The event card is
  navigation context for those three results; it does not become a matching packing entity.
- Opening that card initially preserves the search/type filter and displays the matching children. A visible
  **Show all my linked entities** action can clear text/type while retaining the collection, visibility region,
  and selected event.
- If only the event itself matches, its expansion can have zero matching children even when it has eligible children.
  Keep the action available using the unfiltered eligible-child total; explain the filtered empty state and provide
  the same clear-filter action.
- Searching a parent event title does not make nonmatching children match. Do not introduce parent-title matching
  inside child queries, which would require another permission-sensitive search policy.

The event card's footer shows its eligible-child count and, while filtered, the matching subset, for example
**Show linked entities — 3 of 8 match**. The sub-view contains only those matching eligible children until filters
are cleared. A wholly empty collection, a main region with only hidden items, no matching results, and a filtered
sub-view with no matching children have distinct messages.

### Distinguish entities from displayed cards

The collection badge retains the count of underlying eligible entities across main and hidden. The hidden badge
retains its eligible-entity count. A region shows **N matching entities**, while the overview pager shows **Cards
1–24 of M**. An event card can represent several underlying matches; it is counted once by the card pager, never as
an extra matching entity. The child pager counts linked entities only and excludes the enclosing event card.

There is **one top-level pager** over the mixed grid. Use alphabetical order by the displayed root's title, then
type and UUID as deterministic ties; do not separately sort/paginate Events and Standalone lists. Inside an event,
use title, then type and UUID. Use defined database collation/normalization consistently for sorting and search.

Retain per-region overview page, shared query/type, selected event, and child page in the URL. Opening/closing does
not change other regions. Filters belong to the region and remain shared between its overview and sub-view; changes,
including **Show all my linked entities**, reset both page numbers. **Back to overview** retains those current filters.
Opening/closing a sub-view and explicit paging create history entries; debounced search updates replace the current
entry. Browser Back/Forward restores the corresponding complete recorded state. A direct sub-view link still offers
a normal **Back to overview** link without requiring prior browser history. If a mutation removes a selected event
or empties a last page, return to the recomputed valid grid/page with the remaining filters.

## 4. Scale and bounded data flow

The server owns limits of **24 cards per overview page** and **24 children per event sub-view**.
Accept validated, overflow-safe page numbers, not an arbitrary client page size or an `all` option. At the requested
hundreds-of-events/hundreds-of-children scale, measure both first and late pages before choosing any additional seek
pagination optimization.

An initial dashboard contains at most 48 cards across its two main regions. Hidden regions start with a shell/count
and load when requested. Each loaded region contains either at most 24 overview cards or one expanded event card
plus 24 children. With all four regions loaded, the maximum is **100 cards**. Replace rather than hide/cache previous
grids and child pages; retain only small navigation state. Closing a hidden region releases its body as well.
This bounds rendered cards, not response time independently of database size.

### Build the mixed page before LIMIT

Keep query orchestration in the existing `UserService`, using the existing feature participation builders and
`EntityAdminService.createManagedEntityQuery` as the membership source of truth:

1. Form eligible roots for one collection/profile and apply effective lifecycle plus personal placement in SQL.
   This unfiltered set decides whether a parent event card exists in the same region.
2. Match text/type against those eligible roots. Parameterize values and escape SQL wildcard characters so literal
   `%` and `_` preserve the existing substring semantics.
3. Map each matching root to one overview entry: itself if it is an event or has no eligible parent event card;
   otherwise its eligible parent event. Group by that representative identity and count underlying matches.
4. Sort and paginate this **single combined set** of event cards and individual cards in SQL. Do not page each type
   independently or fetch all matching roots and group them in Node/Pug.
5. Load only the selected page's card fields. Batch total/matching eligible-child counts for its event cards; never
   issue one child-count query per event. Aggregate overall entity/card counts and type availability from the same
   predicates, returning scalar results rather than all IDs.
6. For a selected event, recheck that its card belongs to the collection/region, then query only its eligible linked
   children with the same predicates and their own page limit. Load the parent card once as the enclosing card.
   Counts and results must not come from a broad event-attachments relation.
7. Batch lifecycle, preferences, and permissions for only the returned references and necessary parent context.
   Reuse `convertEntity`, archival presentation, and `evaluateEntities`. No per-card grant reads or arbitrary parent
   metadata lookups are needed.

The implementation compiles the existing per-type query builders separately and combines their SQL with positional
parameters, preserving repeated parameter names within each branch. Compact intermediate rows carry identity,
placement, and a search-match boolean. Matching roots are grouped by representative identity, with their counts
preserved for totals. Type-qualified root joins supply titles for sorting after grouping; full display fields are
loaded only for the selected page.
The parent relation uses the same event-only membership/placement query instead of materializing the entire root
union again. Queries preserve type/ID identity and existing EXISTS-based membership without duplicating roots.
No query builders, repositories, table names, or transaction managers enter the controller/view contracts.

Use one service-owned read snapshot for page selection, placement, totals, and lifecycle inputs within a response.
Extend existing readers to use that manager where necessary. Let the archival presentation assembler consume the
resulting existing `ArchiveState` projections rather than independently re-reading conflicting lifecycle state.
Different requests may observe later changes; mutation endpoints retain their existing live authorization/locks.

### Policy, query plans, and migrations

SQL placement is a persistence translation of existing policy. Keep lifecycle query support with the existing
root descriptors in `EntityLifecycleService`; keep profile-preference joins and overview composition in
`UserService`. Reuse this composition for parent eligibility, represented children, fallback cards, counts, and pages.

Because SQL cannot execute the pure policy functions, integration-check direct/inherited archive state and
absent/hidden/shown preferences against `isEffectivelyArchived` and `isHiddenInOverview`. Do not duplicate this
translation independently in each feature or introduce a general policy compiler.

Verify actual SQL and EXPLAIN on a disposable fixture of **500 events with 200 linked roots each**, plus standalone
and child-without-eligible-parent roots, mixed memberships, hidden overrides, and inherited archival. Ensure fixed-type
batch queries rather than event/card loops. Database aggregates/scans can still grow with the dataset; record latency,
rows transferred, HTML size, and process/browser memory instead of claiming unmeasured constant-time performance.

Inspect actual indexes before adding any. Likely access paths concern membership profile/entity keys, administration
profile/type/entity keys, and child event/order keys. Leading-wildcard substring searches still require measurement.
No new relationship or business schema is needed. If an index is justified, add its entity declaration and reviewed
migration using the documented settings-aware workflow. Do not introduce materialized overview tables, permission
caches, a search service, or a frontend framework.

## 5. Implementation structure and extension boundaries

| Existing boundary | Reuse or targeted change |
|---|---|
| [userController](../src/controller/userController.ts) | Owns validated, paged overview/sub-view orchestration and explicit renderer data, replacing eager full-dashboard discovery. |
| [UserService](../src/modules/database/services/UserService.ts) | Owns profile-scoped mixed-entry and selected-event reads through its participation registry and preference rules. |
| [EntityAdminService](../src/modules/database/services/EntityAdminService.ts) | Reuse the managed predicate, which already includes owners; avoid redundant owner reads/quadratic merges. |
| [EntityLifecycleService](../src/modules/database/services/EntityLifecycleService.ts) and [archive policy](../src/modules/archive/policy.ts) | Own lifecycle query/snapshot support and the existing source of placement behavior. |
| [entityAdminController](../src/controller/entityAdminController.ts) and [permissionEngine](../src/modules/permissionEngine.ts) | Reuse batched action/context projections; no new grant interpretation. |
| [UserTypes.d.ts](../src/types/UserTypes.d.ts) | Defines shared request/page and optional expansion contracts through Entity/archive types; persistence-only shapes remain private. |
| [module_unified_entity_cards.pug](../src/views/modules/module_unified_entity_cards.pug) | Keep a single card-markup implementation for normal cards, expandable event cards, and child cards. |
| [entity-cards-overview.ts](../src/public/js/modules/entity-cards-overview.ts) | Owns explicit paged overview/sub-view navigation and retains local filtering for unpaged callers. |
| [entity-archive.ts](../src/public/js/modules/entity-archive.ts) | Supports inserted controls through delegation while preserving the page-wide mutation lock and confirmed-success reload. |

### Contracts and persistence

Shared declarations define per-region filter/page/selection input and renderer outputs. An event's optional expansion projection carries
only the navigation URL and server-calculated eligible/matching child counts. Keep it separate from membership,
permissions, and persistent entities; the presence of a button is not authority.

The mixed-entry and selected-event readers live in `UserService`, with lifecycle query support in
`EntityLifecycleService`. They share feature predicates with visibility-write eligibility. The eager production
path and its callers have been replaced; preserve this one definition of membership when extending the overview.
Unrelated feature getters retain their existing contracts.

### Common Pug cards and the expanded surface

Inside the existing card module, the `entityCard` mixin owns the image, linked body,
footer, badges, and actions; `entityCards` owns the responsive grid and invokes that mixin. The event
expansion action is an explicit optional argument. The selected event reuses the same card shell with a deliberate
content slot containing `entityCards` for its children. Child calls do not receive recursive expansion state.

The full page and a layout-free region fragment call the same overview/sub-view mixins. Preserve the current event
page's ungrouped **Things to do**, local filtering, and lack of personal visibility. Do not turn `personalVisibility`
into an implicit transport/layout switch or copy the event-card markup to another template.

Pass state through renderer `data` and explicit mixin arguments, not feature `res.locals`. Add purposeful unbuffered
comments describing inputs, navigation state, child membership, and DOM hooks. Reuse Bootstrap and existing Sass;
scope any expanded-card styling narrowly. Preserve dropdown overflow behavior. A nested child grid is not another
independent `.js-entity-section`; the region still owns its controls and state.

### Page and enhanced navigation share the query path

`/users/dashboard` is the full-page GET route and fallback.
`GET /api/users/overview` in the existing API users router reads a bounded region in overview or selected-event mode.
Both call the same controller normalization/service readers. Validate collection/region/type allowlists, bounded
text, UUIDs, and integer pages; never accept a selected actor profile. Use existing async/error/authentication helpers.

The API returns server-rendered region HTML within the existing renderer success/data envelope and canonical URL state.
The fragment-to-string helper in [renderer](../src/modules/renderer.ts) preserves its existing
view-data shape and Express common locals. Pug remains the sole source of card HTML; user text remains escaped.
Normal links/forms target equivalent full-page state and an appropriate region anchor.

Every read uses the account/guest session's current active profile. Reject expired sessions with a structured error,
and keep responses private/noncacheable. Revalidate stale event selection and return the valid mixed grid if the
parent no longer qualifies; do not silently broaden the children query.

### Browser state and actions

The existing `user-dashboard.ts` initializes explicit paged mode. `entity-cards-overview.ts` handles
expand/back actions, page controls, filters, and URL history from stable region roots. It replaces the selected region's
grid/surface, retaining only navigation and focus/scroll information, and supports browser Back/Forward and direct links.

Reuse `core/http.ts`. Debounce search initially by 300 ms and guard responses with a request generation so obsolete
reads cannot overwrite new filters or a closed sub-view. Cancellation, if added, should be a small backwards-compatible
HTTP-helper option. Coalesce rapid reads. Preserve search focus/caret on replacement, and restore card focus on return.

Give navigation a clear loading state, retry, meaningful empty messages, `aria-busy`, and concise live result counts.
Expose the expand/back relationship accessibly and preserve keyboard operation. Keep existing collapse/dropdown
position updates for the remaining collection/hidden controls. Dispose removed Bootstrap instances/listeners.

`entity-archive.ts` uses delegated handling and finds current controls when a command starts. Keep one page-wide
pending mutation lock, confirmations, original disabled states on error, and full reload after confirmed success.
Serialize incompatible navigation during that lock. Inserted controls must work without duplicate handlers.
After reload, recompute both collections, underlying child placement, and any invalid selected event/page. Existing
duplicate links and permanent-delete forms retain their existing flows.

### Integrated verification and maintained documentation

`docs/user-guide/DASHBOARD.md` documents the implemented labels,
mixed event cards, scoped child sub-views, matching counts, pagination, and visibility fallbacks. Canonical
architecture/development guidance describes the paged queries and fragment rendering. Complete the checks below
and record scale measurements for implementation changes. Update database/upgrade guidance
only if an index migration is introduced. Documentation checks remain advisory, never a delivery prerequisite.

## 6. Acceptance criteria and verification

| Boundary | Required evidence |
|---|---|
| Default appearance | One mixed grid with recognizable event images/titles/cards; no new event/standalone sections, text-heading replacements, or separate top-level pagers. |
| Expansion | An explicit event-card action opens the selected event surface with existing individual cards. Back restores the overview page/focus when filters are unchanged and uses the reset page when they change. The event card is not duplicated among children. |
| Exact child membership | Participation and administration sub-views use their respective current predicates and exclude all other event attachments, even when the actor owns/administers the event. |
| Card reuse | One shared card implementation owns images, body links, badges, and actions for ordinary, parent, and child cards; no duplicate browser HTML construction. |
| Parent absent/hidden | Eligible children remain ordinary cards in the same grid. Their visibility does not depend on creating a synthetic parent card or overriding its hidden state. |
| Identity and privacy | Profile isolation, guests, survey exceptions, owner/admin overlap, zero-mask assignment membership, and permission-safe fallback parent context are preserved. Crafted read requests cannot enumerate unrelated attachments. |
| Lifecycle | Parent/child hidden/shown combinations, inherited archival, independent child archival, and the policy/SQL truth table retain existing behavior. |
| Search/counts | Unloaded children are searchable; their event cards carry matching-child context; counts distinguish underlying matches from displayed cards; one combined grid is paged before hydration. |
| Concurrency | Membership loss, relinking, deletion, and archival between requests recompute valid placement; obsolete responses cannot replace newer navigation/filter state. |
| Scale | The 100,000-child fixture yields bounded rows, projection batches, HTML, and DOM; round trips have no event/card loop. Record query plans, late-page/search latency, transferred bytes, and memory on test hardware. |
| Interaction | Loaded archival actions and the shared mutation lock work; retries, focus, keyboard navigation, Back/Forward, full-page fallback, and narrow-screen dropdowns remain usable. |
| Shared callers | Event Things to do retains its current behavior. Deletion, files, invoice retention, and business membership remain unchanged. |

Select the cheapest layer that protects each boundary:

- Extend `tests/integration/controller-smoke-workflows.spec.ts` and `tests/integration/entity-archival.spec.ts`, or one
  cohesive overview integration spec, using real metadata/services. Include a parent with many attachments but few
  eligible children, disjoint participation/administration sets, parent-card fallback cases, mixed paging, and lifecycle.
- Extend `tests/frontend/entity-cards-overview.spec.ts` for expand/back/history, state isolation, replacement bounds,
  stale reads, retries, and local-mode compatibility. Extend `tests/frontend/entity-archive.spec.ts` for inserted controls.
- Adapt `tests/e2e/archival.spec.ts` to expand an actual event card and use a loaded child action. Add one focused
  mixed-grid/search/paging journey through the built application; do not repeat every database case in E2E.
- Add unit tests only for meaningful pure normalization/projection behavior not already covered at the necessary layer.

Run focused files first, then `npm run test:quick` and `npm run build` for the implementation. Run relevant
`npm run test:integration -- <spec-path>` and `npm run e2e -- <spec-path>` checks only after verifying their dedicated
disposable database targets; E2E requires the prior build. Follow [Testing Guide](TESTING_GUIDE.md) and
[Database and Migrations](DATABASE.md). No unmeasured latency target should be reported as passed.

## 7. Implementation status

The mixed event-card overview is implemented in the existing controller, persistence, Pug, and browser modules.
Source review includes membership, placement, compact query projections, bounded card hydration, permission-safe
parent context, and navigation state. User and maintainer guidance describe the implemented behavior.

The production build and all 396 database-free unit/frontend tests passed. The 35 integration tests in
`entity-overview`, `entity-archival`, and `controller-smoke-workflows`, and all four Chromium E2E workflows in
`entity-overview` and `archival`, also passed against verified disposable schemas. These checks cover membership,
grouping, visibility, paging, literal search, navigation races, and loaded archival actions. Tests used UTC;
integration setup used a 120-second hook timeout on this host. The advisory in-app help check reported no findings.
No schema migration or new dependency was required.

The changed browser modules and their transitive imports passed a scoped strict TypeScript check using the existing
compiler options and repository declarations. Whole-project `tsc --noEmit` still reports unrelated baseline errors
in other browser modules; it is not reported as passing here.

### Scale observations (2026-09-16)

A disposable fixture used 500 events with 200 linked roots each (100,000 total, mixed activity plans, packing lists,
and drivers lists), 60 standalone cards, inherited archival, shown-child overrides, and dense/sparse owner profiles.
The dense profile owned nearly every child. These measurements used Windows, an Intel i7-5930K, 64 GiB RAM,
Node 24.13.0, and a separate local MariaDB 10.4.32 instance with its default 128 MiB buffer pool and 16 MiB temporary
table limits. This differs from the documented MariaDB 10.11 baseline. Other verification work ran concurrently;
the figures are observations, not response-time guarantees or a production capacity certification.

| Service read | Time | SQL statements, including transaction control | Returned cards |
|---|---:|---:|---:|
| First mixed page | 5.98 s | 13 | 24 |
| Last mixed page | 6.15 s | 8 | 10 |
| First event child page | 5.20 s | 17 | 24 plus parent |
| Last event child page | 4.89 s | 17 | 8 plus parent |
| Common child substring | 7.04 s | 13 | 24 |
| Missing substring | 3.67 s | 6 | 0 |
| Hidden region | 2.32 s | 9 | 24 |
| Sparse child-only owner | 0.19 s | 10 | 8 |

A separate warmed first-page read took 4.63 s. The first implementation took about 20 s on the same fixture;
removing wide display fields from intermediate tables and using an event-only parent relation reduced that cost.
`EXPLAIN`/`ANALYZE` confirmed indexed parent/title lookups; the measured final first-page query created no on-disk
temporary tables. Dense ownership still requires scanning many matching roots and aggregating exact counts, while
substring search also reads descriptions. Database work is not constant merely because the output is paged.

Returned service projections were 0.34–18.34 kB before transport (excluding Map entries from JSON serialization).
Observed process heap deltas around those reads were 0.21–2.52 MB; these are before/after samples, not peak-memory
measurements. Independently rendering the actual controller/Pug projections produced an 82,535-byte mixed-region
fragment with 24 cards/762 HTML elements and a 90,777-byte event fragment with 25 cards/699 elements. The browser
journey checks that changing child pages replaces the previous cards and that returning removes the child view.
Query counts depend on the bounded set of entity types on a page, with no per-event or per-card database loop.

Recheck latency on the maintained database version and deployment hardware when setting a response-time budget;
the measured multi-second dense-profile/search cost remains a limitation. No additional index migration was
justified by these plans: the expensive dense scans and substring matching cannot be removed by indexing a page
number or adding a title index.
