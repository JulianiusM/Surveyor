# Archival design and implementation record
<!--
documentation-metadata
audience: product maintainers; developers; reviewers
owner: application maintainers
status: current
last-verified: 2026-09-16
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: restored direct service deletion and expanded implementation/mixin comments; corrected module ownership, renderer data, declaration types, and dropdown behavior; implemented archival design, source boundaries, and dated verification records on 2026-09-16; baseline retained as historical reference
source-anchors: src/modules/database/services/EntityLifecycleService.ts; src/modules/database/services/UserService.ts; src/controller/entityAdminController.ts; src/controller/userController.ts; src/middleware/adminApiFactory.ts; src/types/ArchiveTypes.d.ts; src/modules/database/entities/abstract/BaseEntity.ts; src/modules/database/entities/abstract/Base.ts; src/modules/database/entities/event/; src/modules/database/entities/activity/ActivityPlan.ts; src/modules/database/entities/packing/PackingList.ts; src/modules/database/entities/drivers/DriversList.ts; src/modules/database/entities/surveys/Survey.ts; src/modules/database/services/; src/controller/eventController.ts; src/modules/lib/util.ts; src/modules/lib/permissions.ts; src/modules/permissionEngine.ts; src/middleware/guestFlowFactory.ts; src/middleware/permissionMiddleware.ts; src/middleware/entityHeaderUpdateHandler.ts; src/routes/api/; src/views/modules/module_unified_entity_cards.pug; src/views/users/dashboard.pug; src/views/event/event-view.pug; src/public/js/modules/entity-cards-overview.ts; src/modules/settings.ts; src/modules/invoiceRetention.ts; src/server.ts; tests/; package.json
next-review: archival-behavior-or-architecture-change
-->

This design has been implemented in the working tree. It records the accepted behavior, implementation boundaries,
and acceptance criteria; it does not claim deployment to an existing installation. The original source findings in
section 2 describe the starting point. Recommended defaults and behavior below were adopted during implementation.
Current usage and operating instructions belong in the linked user guides and canonical maintainer/operator references.

**1. Required behavior and scope**

Introduce two independent concepts:

- **Authoritative archival** is an entity lifecycle state controlled by an authorized organizer or the automatic job.
  An event's state applies immediately to all attached entities and their contents.
- **Personal visibility** is a persistent choice by the active profile about placement in **Your participation** and
  **Administrable entities**. It never changes the entity's lifecycle or anyone else's overview.

Both are reversible. Archived or personally hidden entities remain discoverable in collapsed overview sections and
accessible through their existing links, subject to the existing access rules.

Archiving and restoring must preserve registrations, answers, assignments, permissions, ownership, invoice data,
settlement state, proof references, header-image references, and files. They must never call entity deletion,
TypeORM soft deletion, image removal, invoice purging, or financial recalculation.

Recommended scope: archival organizes existing entities without introducing a read-only mode. Existing authorized
participation, administration, exports, invoice review, and payment recording remain available after archival.
There is no new notification workflow or independent archival of individual assignments, invoices, or slots.

**2. Findings from the code before implementation**

| Existing boundary | Evidence and consequence |
|---|---|
| Shared root model | [BaseEntity](../src/modules/database/entities/abstract/BaseEntity.ts) is inherited by all five overview entity types. Shared direct archival state belongs here. |
| Dated roots | [Event](../src/modules/database/entities/event/Event.ts) and [ActivityPlan](../src/modules/database/entities/activity/ActivityPlan.ts) have `startDate` and `endDate` stored as SQL `DATE` strings. |
| Event attachments | Activity plans, packing lists, and drivers lists have an optional event relation. Surveys have neither an event relation nor a finite date period. Survey combinations describe recurring calendar choices. |
| Event contents | Registrations, dietary data, bypass links, and invoice pools belong to events; invoices, shares, takeovers, assignments, and surcharges belong to pools. [EventInvoicePool](../src/modules/database/entities/event/EventInvoicePool.ts) has an event FK even though `Event` has no inverse pool collection. |
| Overview identity | [userController.getDashboardEntities](../src/controller/userController.ts) builds both collections for the active `Profile`. Full accounts can have multiple profiles; guests also have profiles. |
| Historical discovery | The administration overview calls [EventService.getActiveManagedEvents](../src/modules/database/services/EventService.ts), which restricts events to `endDate >= today`. Consequently, historical events disappear for delegated administrators. The same function supplies creation/duplication event choices. These use cases must be separated. |
| Shared presentation | [convertToSingleList / convertEntity](../src/modules/lib/util.ts), [the card mixin](../src/views/modules/module_unified_entity_cards.pug), and [entity-cards-overview.ts](../src/public/js/modules/entity-cards-overview.ts) already centralize card rendering and filtering. The event page also uses this mixin for **Things to do**. |
| Authorization | [permissions.ts](../src/modules/lib/permissions.ts) and [permissionEngine.ts](../src/modules/permissionEngine.ts) define cumulative grants, including `EDIT_META`. There is no separate persisted organizer role. Surveys deliberately have a different authorization contract. |
| Configuration and jobs | [settings.ts](../src/modules/settings.ts) owns defaults, CSV keys, coercion, and environment overrides. [server.ts](../src/server.ts) starts an immediate/hourly invoice-retention job after database initialization. |
| Existing deletion | [guestFlowFactory](../src/middleware/guestFlowFactory.ts) calls feature deletion and then removes the header image. [EventInvoiceService.purgeExpiredInvoices](../src/modules/database/services/EventInvoiceService.ts) removes invoice records and proofs. Neither operation is reusable for archival. |

**3. Authoritative lifecycle**

| Entity | Automatic archival | Manual archival | Event inheritance |
|---|---|---|---|
| Event | After its inclusive end date plus the configured delay | Authorized organizer | Governs all attached entities and contents |
| Standalone activity plan | After its inclusive end date plus the same delay | Authorized organizer | None |
| Event-linked activity plan | Follows the event's automatic schedule | Authorized organizer may independently archive it | Always inherits an archived event |
| Packing list / drivers list | No independent automatic deadline | Authorized organizer | Inherits its event when linked |
| Survey | No automatic deadline | Owner | None |

The event controls automatic archival of attached activity plans even when their dates end earlier or later.
Do not derive deadlines from slots, registrations, invoice dates, creation dates, or recurring survey choices.

Persist only **direct** archival on each root. A single policy computes:

```text
effectiveArchived(entity) = entity.archivedAt exists
                            OR linkedEvent.archivedAt exists

archived internal record = effectiveArchived(its enclosing root)
```

The event relationship is the single source of inherited state. Archiving the event is one root write; there is no
window in which some attached lists have been updated and others have not. Every attachment, including nested
records without date periods, becomes effectively archived at that same committed transition. This remains true
when a linked list is fetched independently through its own route.

Restoration rules:

- Restoring an event removes its inherited effect from every attachment. A child that was independently archived
  remains archived. Personal visibility preferences remain untouched.
- A child cannot override an archived parent. Reject a child-level authoritative restore while its event is archived
  with a clear conflict response. Explain the governing event and offer an event restore only to someone authorized
  on that event. The child owner's authority never silently grants authority over the event.
- A direct archive command preserves an existing direct archive timestamp; repeated commands are idempotent.
- Recommended durable restoration: restoring a dated root also pauses its independent automatic archival. An event
  or standalone activity remains active until an organizer manually archives it or selects **Resume automatic
  archival**. Restoring a linked activity creates no independent pause; it follows any later event archival.
  Otherwise the next hourly run would undo the restoration of an expired independent root.
- Changing dates or the configured delay does not implicitly restore existing archives or clear a manual pause.
  New dates govern the next eligibility check for active, unpaused roots. Resuming automation can make an already
  expired root eligible on the next run. Resuming does not itself restore an archived root.

Current event linking happens during creation; there is no supported general attach/detach/reparent operation to
extend. An authorized new child of an archived event inherits that state immediately. If relation editing is added
later, inherited state follows the current parent, while the child's direct state remains its own.

**4. Personal visibility and overview placement**

Recommend one preference per `(profileId, entityType, entityId)`, shared across the two overview collections.
This follows the app's active-profile identity model, supports guests, and keeps separate profiles independent even
when one account owns them. Profile migration preserves the profile ID, so its preferences follow it naturally.

| Personal preference | Authoritative state | Placement in that profile's overview |
|---|---|---|
| Default: no override | Active | Main section |
| Default: no override | Archived, directly or through event | Collapsed **Archived and hidden** section |
| Hidden | Either | Collapsed **Archived and hidden** section |
| Shown | Either | Main section; retain authoritative archive badge when applicable |

Use the labels **Hide for me**, **Show for me**, and **Use default visibility**. An explicit show is a persistent
override, including after a later authoritative archive; **Use default visibility** removes that override.
This third state is necessary: merely clearing a hidden flag would leave a globally archived entity hidden.

Personal hiding of an event affects that event's card only. The required event-wide propagation applies to
authoritative archival. Each attached root has its own personal preference.

First discover current overview membership, then apply archival and visibility. A preference cannot add an entity
to an overview, confer access, retain revoked administration, or substitute for participation. If membership is
lost, the entity disappears from both sections; a retained preference may apply again if membership returns.
Private settings never appear in another profile's responses or in shared entity serialization.

**5. Persistence design**

| Location | Proposed addition | Purpose |
|---|---|---|
| Existing abstract `BaseEntity` | Nullable `archivedAt`, mapped to `archived_at` | Single source for direct archival on all five root tables; `null` means directly active |
| `Event` and `ActivityPlan` | Boolean `autoArchivePaused`, default `false` | Durable organizer override of automatic archival for dated roots |
| New `EntityVisibilityPreference` | `entityType`, `entityId`, `profile`, `visibility: HIDDEN / SHOWN` plus inherited identity/tracking | Persistent personal override; absence means default |

Use the existing `NumericProfileBase` for preferences, with its real profile FK and cascade on actual profile
deletion. Follow [EntityAdminAssignment](../src/modules/database/entities/permissions/EntityAdminAssignment.ts)'s
polymorphic target and unique-key pattern. Use `EntityType`, not `CombEntityType`, because preferences target roots
only. Index `(profile, entityType, entityId)` uniquely and keep a target-leading index for preference lookup.
Add appropriate eligibility indexes on dated roots, verified against the actual candidate query.

Do not persist an `isArchived` boolean in addition to `archivedAt`, inherited child flags, or materialized per-profile
effective state. A historical audit/source table is not required for this feature. The two dated-table pause
declarations share one behavioral policy; they do not need a new inheritance hierarchy or one-field embeddable.

Polymorphic references cannot have one target FK spanning five tables. Preference writes validate the target and
current membership in a transaction, taking the parent event lock before a linked root. An ordinary database DELETE
uses write locks too, so a preference write queued behind deletion observes the missing target and fails.

Permanent deletion remains the original direct repository delete in each feature service, with foreign keys handling
event-owned rows. There is no shared archival deletion wrapper or replacement cleanup framework. Preferences may
remain stored after target deletion, just as existing polymorphic administration metadata can. Reads always start
from existing, eligible entities, so retained rows cannot produce cards or grant access. New and duplicated roots
receive fresh UUIDs. Profile transfers preserve identity; actual profile deletion still cascades preference rows.

Add a reviewed migration matching the entity definitions. Existing rows start directly active and unpaused;
preferences start empty. Follow repository migration helpers, including compatibility with the documented
empty-database schema-sync-then-migrate bootstrap. Align the profile FK's type/collation with the actual schema.
Do not backfill dated archives in SQL: the application job owns date eligibility. A down migration must not silently
discard non-default archive, pause, or preference state; follow the repository's preflight-and-refuse pattern.

**6. Policy, service, controller, and route boundaries**

Keep functional modules and the established route/controller/database-service structure. The boundaries below reflect
the accepted implementation and its readability review; reuse existing administration and user modules for the
responsibilities they already own.

| Boundary | Responsibility |
|---|---|
| `src/modules/archive/policy.ts` | Pure date cutoff, effective-state, and personal placement rules. Accept explicit inputs and `now`; no HTTP, repositories, settings store, or file operations. |
| `src/modules/database/services/EntityLifecycleService.ts` | Private typed root and parent loading, archive/restore transaction locks, lifecycle writes, and automatic candidate processing. Hide repositories and stored archive columns behind named operations; keep deletion in each existing feature service. |
| Existing `src/modules/database/services/UserService.ts` | Load and write active-profile visibility preferences and check single-target overview eligibility using the feature services' predicates. Reuse lifecycle locking for coordinated preference writes. |
| Overview membership seam in existing database services | Share per-domain membership predicates between dashboard discovery and a lightweight single-target eligibility check. `UserService` assembles these calls without duplicating predicates in controllers or adding another forwarding service. |
| Existing `src/controller/entityAdminController.ts` | Normalize lifecycle requests, coordinate authorization and services, and return shared lifecycle state/capabilities. No direct repository access. |
| Existing `src/controller/userController.ts` | Normalize personal visibility requests and assemble the active profile's overview projection. |
| Existing `src/middleware/adminApiFactory.ts` | Register shared archive actions on existing feature API routers using their resource loaders and existing authorization contracts. Survey preserves its owner-only rule. |
| `src/modules/entityArchival.ts` | Validate archival settings, schedule and invoke the service, prevent overlapping local runs, and report outcomes. It owns scheduling only. |

Use one bounded, typed root-type mapping inside persistence where generic dispatch is needed. Do not create another
framework, generic repository hierarchy, or separate type switches in controllers, templates, and browser code.
Service projection types expose direct/inherited state and allowed actions, keeping persistence details private.

For an overview response, collect distinct typed entity references across both collections, then read their lightweight
archive metadata and referenced event metadata in one consistent `REPEATABLE READ` snapshot. Resolve each reference
once and reuse its projection in both collections. Do not mix an event's earlier dashboard load with a later parent
lookup for its children: a concurrent archive could otherwise show contradictory states in one response. Batch parent
reads, including when the parent event itself is absent from that profile's overview; never query once per card.

Recommended API shape, using existing feature mounts and success/error wrappers:

| Endpoint | Contract |
|---|---|
| `POST /api/{type}/:id/archive` | Set direct authoritative archival |
| `POST /api/{type}/:id/restore` | Restore directly and pause independent automation for dated roots; reject any child restore while its event is archived |
| `POST /api/{type}/:id/archive/automation` | Set explicit Boolean `paused` on events and standalone activities; linked activities follow their event's schedule |
| `POST /api/users/overview/:entityType/:id/visibility` | Set `visibility` to `default`, `hidden`, or `shown` for the active profile |

Never use a toggle endpoint whose effect reverses on retries. Strictly allowlist types and payload fields; do not
accept a profile ID, archive timestamp, parent archive state, or arbitrary repository fields from the client.
Return the saved effective state and authorized controls, including whether an event remains the governing source.
Use the existing `asyncHandler`, `APIError`, and renderer success/error conventions.

Recommended authority mapping:

- Require a logged-in account or guest with an active profile for all these mutations.
- Events, activities, packing, and drivers: require effective `EDIT_META` for archive, restore, and automatic-policy
  changes. Owners already receive all permissions. This matches existing date/header/metadata editing.
- Surveys: require ownership, preserving their deliberate exclusion from general permission administration.
- Personal visibility: require current membership in either overview collection and act only on the session profile.
  Use the same membership predicates as discovery, including each feature's participation definition. `ACCESS_VIEW`
  alone is insufficient, and loading every full dashboard entity is unnecessary for a one-target check.

The word organizer therefore means an actor authorized for this metadata operation. Assignment presence,
`ACCESS_ADMIN`, and `MANAGE_ASSIGNMENTS` are not substitutes for `EDIT_META`. Evaluate the same authority rule for
server mutations and card capabilities, using batched permission data/request caches to avoid per-card queries.
All grants continue through the existing permission engine, including intentional audience grants.

**7. Automatic execution and configuration**

Recommended initial settings:

| Setting | Proposed default | Meaning |
|---|---|---|
| `AUTO_ARCHIVE_ENABLED` | `true` | Enables automatic archival; manual and personal actions remain available when disabled |
| `AUTO_ARCHIVE_AFTER_DAYS` | `30` | Non-negative integer number of complete calendar days after the entity's inclusive end date |

The 30-day value and enabled default are recommendations, not existing maintainer decisions. Use one site-wide
delay initially. Per-type delays and per-entity custom delays are unnecessary for the requested scope; the manual
pause provides an explicit exception without duplicating deadline policy.

Extend `Settings`, defaults, CSV mapping, coercion, and the existing environment precedence. Support the normal
`E2E_` override automatically through that loader. Validate finite, non-negative integer delay values and representable
cutoff calculations before starting the job. Do not edit or publish the local `settings.csv`.

Use UTC calendar dates, consistent with existing active-event selectors and the datasource contract. The event's
`timezone` currently comes from the registration deadline timezone and is not reliable period-timezone metadata.

```text
dueAt = UTC midnight immediately after inclusive endDate + AUTO_ARCHIVE_AFTER_DAYS
eligible when now >= dueAt
```

For example, an entity ending on 2026-09-16 with a delay of 30 becomes eligible at 2026-10-17 00:00 UTC.
With delay zero it becomes eligible on 2026-09-17 00:00 UTC, never during its final day.

Start after settings and the database have initialized, following the existing immediate-then-hourly job pattern.
Keep it a separate module and invocation from invoice retention. Capture one `now` per sweep, process roots in
bounded batches with stable keyset progress, and prevent overlapping runs within the process. An uninterrupted
hourly schedule processes an eligible root on the next run; startup catches missed deadlines after downtime.
Manual actions take effect immediately.

For every automatic write, recheck in the actual conditional update or transaction:

```text
archivedAt IS NULL
AND autoArchivePaused = false
AND current endDate is due
AND (root is event OR activity.event_id IS NULL)
```

Never update from a previously selected ID list without repeating these conditions. This protects concurrent
restore, date extension, and attachment changes. Count only successful transitions. Restore clears the timestamp
and pauses independent automation atomically; an automatic job cannot overwrite it using stale selection data. Serialize manual
changes with current state and parent checks, using consistent parent-before-child lock order when both are needed.
Update only archive fields, avoiding saves of stale full entities that could overwrite other business data.

Independent duplicate sweeps must be harmless even though the supported operational model is one application
process. No distributed scheduler is needed for this change. Log counts/failures without personal preference data;
periodic failures are retried on the next sweep. Follow the existing startup failure contract for an unsuccessful
initial run, and use an unreferenced timer. Disabling automation never restores already-archived entities.

**8. Overview and feature UI**

Extend the existing card projection and mixin instead of creating five archive-specific views.

- Under each existing collection, keep the main cards and add an initially collapsed **Archived and hidden**
  subsection with a count. Keep it discoverable even when all cards are archived. Expanding it exposes normal links,
  search, type filters, badges, and authorized actions.
- Reuse the current filtering module for each section. Use unique IDs and independent Bootstrap collapse targets;
  an inner archive section must not close its enclosing collection. Counts and empty states must distinguish no
  membership, no active cards, and no matching filtered cards.
- Separate **Archive for everyone** / **Restore for everyone** from **Hide for me** / **Show for me**. Explain the
  event-wide effect before the authoritative event action. Private actions need no destructive-action warning.
- Show **Archived** or **Archived with event** independently of personal placement. Show **Automatic archival paused**
  with **Resume automatic archival** to authorized organizers of events and standalone activities. Linked activities
  explain that their event governs automatic archival and do not offer an independent automation control.
  Use an event title/link only where the
  current user may see that event; do not expose additional parent information through the badge.
- Reuse shared dialogs, busy/error handling, and alerts. Update only after server success. A reload using existing
  navigation patterns is sufficient initially; it must refresh both appearances when the entity is in both collections
  and all affected event children. Do not calculate lifecycle rules again in browser code.
- Add an archive-status notice and authorized lifecycle actions on the existing feature pages so direct links make
  the state clear. Inherited restoration routes the user to the event rather than pretending the child can override it.

The event's **Things to do** also uses the card mixin. Make personal actions/partitioning an explicit overview option;
do not apply the current profile's private hiding to that shared feature view. When an archived event is opened,
its attached cards and internal data remain available in their normal sections with appropriate archive context.

Split historical managed-event discovery from active event choices. The overview must include all still-managed
events regardless of dates, then partition them through the shared policy. Creation/duplication selectors retain
their current date criterion and exclude archived events by default; personal hiding does not affect them.
An explicitly addressed archived event still follows existing authorization, and any resulting new child inherits
its state. Explain that state on the contextual creation page.

New and duplicated roots start directly active and unpaused, with no personal preferences copied. If created under
an archived event they are effectively archived through inheritance; if created standalone with old dates they
become eligible through the normal automatic policy.

**9. Implementation sequence**

| Step | Work package | Completion evidence |
|---|---|---|
| 1 | Finalize the recommended defaults, profile scope, `EDIT_META` mapping, visibility-only lifecycle, event schedule precedence, and durable restore semantics stated here. Define shared state/projection contracts and pure policy functions. | Policy examples and focused unit tests cover the complete state matrix and date boundary. |
| 2 | Add root fields, dated-root pause fields, preference entity, indexes, and the reviewed migration. Preserve direct repository deletion in existing feature services. | Real-TypeORM persistence tests; migration rehearsal on a disposable existing-schema copy and the supported fresh-schema path. |
| 3 | Implement archival and visibility services, batched parent resolution, shared membership checks, and idempotent/race-safe commands. Separate complete managed-event discovery from the active picker. | Focused integration coverage verifies propagation, restore, privacy, membership, deletion, and concurrency. |
| 4 | Add controller validation and shared API registration to the five feature routers; add the profile visibility endpoint. | Server authorization and invalid-input coverage, including survey and guest exceptions; existing feature APIs remain compatible. |
| 5 | Extend card/view projections, the shared mixin, overview sections, feature notices, and browser bindings. | Frontend behavior checks plus a focused built-application browser workflow. |
| 6 | Add settings and the separate startup/hourly runner. Keep E2E background automation explicitly configured so unrelated fixtures are stable. | Deterministic automatic-service/job checks, settings precedence checks, and startup wiring verification. |
| 7 | Apply the full verification appropriate to these persistence/HTTP/browser boundaries and prepare rollout documentation. | Commands and actual results recorded; prerequisites and any unrun checks reported accurately. |

Do not deploy automatic execution before the discovery and restore UI are available. These work packages can be
reviewed incrementally, but enable the feature only with the complete migration, service, API, and presentation set.

**10. Acceptance and verification matrix**

| Behavior to protect | Cheapest useful layer |
|---|---|
| Inclusive end dates, zero delay, exact cutoff, month/year/leap-day boundaries, consistent UTC behavior | Unit tests of production policy |
| Every direct/inherited/default/hidden/shown combination; no mixing of archive and preference state | Unit tests of production state projection |
| Settings validation, enabled/disabled execution, injected time, repeated/overlapping runner calls | Focused unit tests with replacement only at the scheduling/service boundary |
| Automatic events and standalone activities; undated roots excluded; linked plans follow the event even with different dates | Real-TypeORM integration tests |
| Event archive/restore affects packing, drivers, activities, pools, and nested records immediately; independently archived child remains archived | Integration tests using actual entity relations and central projections |
| Restoring an expired root survives another sweep and restart; resume makes it eligible again; date/config changes follow the stated rules | Integration tests |
| Auto sweep versus manual restore/date extension; repeated commands and duplicate sweeps | Integration tests with controlled concurrent transactions and current-state assertions |
| Private preferences isolate profiles and guests, survive reload/profile transfer, apply in both collections, and disappear from discovery after membership loss | Integration tests |
| Past delegated events remain discoverable; date-limited creation choices retain their contract; shared event cards ignore personal hiding | Integration tests plus the focused browser workflow |
| Default reset removes an override; invalid types/payloads, forged profile IDs, unassociated targets, survey non-owners, and insufficient delegates are rejected | Controller/service integration where sufficient; HTTP assertions in the browser/API workflow for actual middleware |
| Owners and metadata-authorized organizers can archive/restore; ordinary participants can only change their own visibility | HTTP/session workflow coverage |
| No changes to business records, pool revisions/status/shares/payments, permission rows, header/proof paths, or actual file contents after archive and restore | Integration test with complete event fixture and temporary test uploads; exercise both manual and automatic paths |
| Direct view/export/proof access retains existing authorization while archived | Focused built-application workflow, including access denial for unauthorized users |
| Duplicate state reset; preference uniqueness/profile FK; direct root deletion and event cascades; deleted targets absent from overviews despite preferences; migration defaults | Integration tests and explicit migration rehearsal |
| Initially collapsed sections, accessible controls, filters/counts/empty states, busy/failure handling, authoritative versus personal actions | Frontend tests for DOM behavior and one focused Playwright flow for real rendering/session/navigation |

Use the existing factories, [integration database guard](../tests/support/database.ts), and test conventions. Persistence
tests must exercise production TypeORM metadata and services rather than repository mocks. The preservation test
may use temporary uploads as the true external file boundary; it must not invoke invoice retention while asserting
archival behavior.

Start with targeted new/affected specs through the existing `test:unit`, `test:frontend`, and `test:integration`
scripts. Then use `npm run test:quick`, the relevant full integration suites, `npm run build`, and focused
`npm run e2e -- <spec>` as warranted. For the completed feature spanning all these boundaries, run the existing
full validation sequence `npm test`, `npm run build`, and `npm run e2e` once focused checks pass.
Schema synchronization in integration/E2E tests does not validate migration SQL; rehearse that separately.
Read [Testing Guide](TESTING_GUIDE.md) and [Database and Migrations](DATABASE.md), verify the effective disposable
database target before every schema-changing command, and never run resets against shared data.

**11. Rollout and documentation**

Apply the matching migration through the existing settings-aware wrapper before starting the new application.
With the recommended enabled default, already-ended eligible entities move into the archive during the first
startup run. This must be stated in upgrade notes. Operators can explicitly disable automatic archival during
rollout; manual/private behavior still works. Disabling later stops future automatic transitions without undoing
previous ones. Restart is required after changing settings, following the existing configuration contract.

Update **Your Overview**, **Events**, **Activity Plans**, **Packing Lists**, **Drivers Lists**, and **Surveys** help
with the implemented labels and restoration behavior. Update the permissions reference/user guide for the
`EDIT_META` mapping, and the architecture, development, configuration, operations, database, and upgrade references
for the new persistence and job. Keep one canonical operator description of the archival settings. Link existing
retention guidance rather than duplicating it. Durable coding requirements belong in `AGENTS.md` and the development
guide; current paths and implementation details belong in these maintained architecture and development references.

The existing invoice-retention policy continues independently. Archiving neither causes nor prevents that existing
retention operation; restoring an archive cannot recreate anything independently deleted by retention or explicit
deletion. Header images and invoice proofs are never touched by archival itself. If changing retention is desired,
that is separate scope and must not be hidden inside this feature.

Documentation reports remain optional and advisory under [Documentation Policy](DOCUMENTATION_POLICY.md).
Current product help and the affected maintainer/operator references were updated alongside the implementation.

**12. Review criteria for the implementation**

- **DRY:** one cutoff policy, one effective-state resolver, one personal-placement rule, shared lifecycle API
  registration, shared membership predicates, and one card rendering path. No five-feature copies of lifecycle logic.
- **Single source of truth:** direct state lives on the root, inherited state comes from the event relationship,
  personal state comes from the profile preference, and configuration comes from the settings store.
- **Separation of concerns:** timer schedules; services persist; policy computes; controllers orchestrate; middleware
  authorizes; Pug/browser modules present. File deletion and financial workflows remain independent.
- **Information hiding:** clients receive capabilities and effective state, never manipulate stored fields or choose
  another profile. Parent loading, repositories, and persistence mappings stay behind service functions.
- **Established app behavior:** preserve profile identity, survey exceptions, permission aggregation, feature membership
  definitions, direct-link access, functional services, reviewed migrations, generated-file rules, and shared UI patterns.
- **Human readability:** preserve local formatting, use descriptive names and straightforward control flow, and add
  generous purposeful comments for intent, constraints, and nontrivial data flow. Avoid excessive or nested lambdas.
- **Existing module ownership:** extend the established administration and user modules where responsibilities fit;
  keep repository details private, shared type-only contracts in `src/types/*.d.ts`, and optional page state in renderer
  data and explicit Pug arguments. Hard deletion remains a distinct operation.

The implementation keeps shared root persistence and locking in `EntityLifecycleService`. Profile preferences and
single-target overview eligibility checks extend the existing `UserService`; feature services retain their membership
predicates. The existing permission engine supplies batched capabilities. `entityAdminController` and
`adminApiFactory` expose shared lifecycle actions, and `userController` owns personal visibility and overview data.
The shared card and archive Pug mixins and browser modules render the server projection. The separate
`entityArchival` job uses the pure archive policy and central settings store. Migration
`1789862400000-AddEntityArchival` upgrades existing schemas and guards rollback against loss of archive state.

The earlier full-feature verification on 2026-09-16 covered module consolidation, explicit renderer data,
declaration-file contracts, and dropdown fixes. It preceded the final direct-deletion reversion and expanded comment
pass; the focused verification of those corrections is recorded below. All database-backed checks used `TZ=UTC`
and isolated MariaDB 10.11 schemas with restricted test accounts. No production migration or deployment was performed.

| Check | Result |
|---|---|
| `npm test` | 651 tests passed across 38 files, including real-database migration, permanent deletion, file preservation, and canonical visibility-identity checks. |
| `npm run test:frontend -- tests/frontend/entity-cards-overview.spec.ts` | The existing script selected all frontend specs; all 225 tests passed. |
| `npm run build` | Passed for that implementation. |
| Archival browser workflows in the full E2E run | All three passed, including permanent deletion, proof bytes, permissions, archived creation context, and menu bounds/hit-testing at a 360-pixel viewport width. The menu test also opens a dropdown during collapse animation. |
| `npm run e2e -- --workers=2` | 30 passed; the existing invoice lifecycle workflow encountered an HTTP `ECONNRESET` while fetching a preview. |
| `npm run e2e -- tests/e2e/invoice-lifecycle.spec.ts --workers=1` | The affected workflow passed on isolation rerun with no intervening application or test changes. |
| `tsc --project tsconfig.json` using the installed compiler | Reported 45 diagnostics in five unchanged frontend files; none in changed files. The supported production build passed separately. |

The invoice fixture now respects the configured proof directory and uses exclusive file creation. This allowed the
existing retention test to run against isolated uploads without changing invoice runtime behavior. Archival itself
continues to preserve all uploaded files. The dropdown fix removes overview clipping and uses Bootstrap's existing
update API after collapse expansion, retaining keyboard focus and recalculating placement from the completed layout.

The migration rehearsal exercised repeated application to synchronized metadata, a schema with the archival additions
removed and then upgraded, data preservation, profile FK/storage compatibility, index availability, and refusal to
discard non-default state during rollback. It did not use an installation's production data.

**Verification after restoring direct service deletion and expanding comments**

The five feature services now contain their original repository deletion calls, verified against the original Git
revision. The archival service has no permanent-deletion helper. Updated integration checks cover ordinary database
cascades, repeated deletion, absence from overviews despite retained private preferences, profile-FK cleanup, and a
visibility write queued behind an ordinary event DELETE.

| Check | Result |
|---|---|
| `npm test -- tests/integration/entity-archival.spec.ts tests/integration/core-services.spec.ts` | 39 tests passed across both files. |
| `npm run test:frontend` | 225 tests passed across 11 files. |
| `npm run build` | Passed with direct service deletion and the expanded implementation comments. |
| `npm run e2e -- tests/e2e/archival.spec.ts --workers=2` | All three workflows passed, including permanent deletion, dropdown positioning, privacy, permissions, file preservation, and creation-context recovery. |
| Pug compilation comparison | All 13 affected templates compiled; excluding added JavaScript comments, their compiled functions matched the pre-comment baseline. |
| Policy and migration test comment comparison | TypeScript output with comments removed was identical before and after the added explanations. |
| `git diff --check` | Passed. |
