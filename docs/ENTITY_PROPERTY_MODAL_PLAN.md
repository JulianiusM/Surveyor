# Entity property modal concept and implementation plan
<!--
documentation-metadata
audience: product maintainers; developers; reviewers
owner: entity feature maintainers
status: current
last-verified: 2026-10-03
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: implemented entity property dialogs, permission boundaries, event selection and reassociation, archival presentation, module reuse, and verification evidence recorded below
source-anchors: src/middleware/guestFlowFactory.ts; src/middleware/adminApiFactory.ts; src/middleware/entityHeaderUpdateHandler.ts; src/controller/entityAdminController.ts; src/controller/eventController.ts; src/controller/activityController.ts; src/controller/packingController.ts; src/controller/driversController.ts; src/controller/surveyController.ts; src/modules/database/services/EventService.ts; src/modules/database/services/EntityLifecycleService.ts; src/modules/permissionEngine.ts; src/views/modules/module_entity_header.pug; src/views/modules/module_entity_archive.pug; src/views/modules/module_entity_select.pug; src/views/event/event-dashboard.pug; src/public/js/modules/activity/activity-slot-editor.ts; src/public/js/modules/entity-select.ts; src/public/js/modules/entity-header.ts; src/public/js/modules/entity-archive.ts; tests/e2e/archival.spec.ts; docs/documentation-remediation.yml; package.json
next-review: entity-property-modal-contract-change
-->

This design has been implemented. The numbered sections retain the design constraints and implementation sequence;
the final section records delivered boundaries and verification evidence.
The task covers the existing root entity views: events, activity plans, packing lists, drivers lists, and surveys.
The central requirement is one dedicated, permission-aware **Entity settings** dialog on each applicable view.

## 1. Scope and existing boundaries

The existing application provides most of the required infrastructure:

| Responsibility | Existing implementation to retain or extend |
|---|---|
| Shared entity header and image UI | `src/views/modules/module_entity_header.pug`, `src/public/js/modules/entity-header.ts` |
| Shared create/view/duplicate/delete flow | `src/middleware/guestFlowFactory.ts` |
| Permission evaluation and rendering bundle | `src/modules/permissionEngine.ts`, `src/middleware/permissionMiddleware.ts`, `src/types/PermissionTypes.d.ts` |
| Lifecycle commands and authorized presentation | `src/controller/entityAdminController.ts`, `src/middleware/adminApiFactory.ts`, `src/modules/database/services/EntityLifecycleService.ts` |
| Archive controls and browser commands | `src/views/modules/module_entity_archive.pug`, `src/public/js/modules/entity-archive.ts` |
| Event picker | `src/views/modules/module_entity_select.pug`, `src/public/js/modules/entity-select.ts` |
| Event property normalization and persistence | `src/controller/eventController.ts`, `src/modules/database/services/EventService.ts` |
| Feature-specific properties | Existing activity, packing, drivers, and survey controllers and database services |
| Reference modal integration | `src/views/activity/activity-view.pug`, `src/public/js/modules/activity/activity-slot-editor.ts` |

Activity, packing, and drivers roots already have nullable event relationships. Their post-creation link/unlink
operations can use that schema. Events and surveys do not acquire an event selector: events are parents, and surveys
are intentionally standalone. Survey title/description editing is a new owner-only capability; it does not introduce
the general permission matrix, event linkage, or a new survey administration model.

Invoice pools retain their existing parent-event workflow and permissions. Slots, items, assignments, shared text
fields, invoice operations, and participant administration keep their specialized editors. This change concerns root
properties and root actions, not every edit dialog in the application.

The implemented root properties and event relationships require no schema migration. Any later index or additional
persistent concurrency field must have an entity change and reviewed migration.

## 2. Dialog concept

Place one **Entity settings** button in the shared header, alongside the existing navigation. Show it only when the
active profile has at least one available setting or action. Event dashboard users open the same component from that
page; the ordinary event view does not require `ACCESS_ADMIN` merely to expose independently granted edit permissions.

Use the existing Bootstrap modal conventions: a large, scrollable dialog, labeled title, close button, keyboard focus
handling, inline validation, pending submission state, and success followed by a server-rendered refresh. On mobile,
keep the header and action controls reachable without a competing inner scroll area.

The dialog separates **General**, **Linked event**, **Access**, and **Actions**. Only permitted panels appear;
a single available panel needs no tab navigation. The first permitted property family opens automatically.

```text
Entity settings — Summer camp activity plan                       [Close]
[General]   [Linked event]   [Access]   [Actions]

General (selected)
  Details [expanded]
    Title                        [______________________________]
    Description                  [______________________________]
  Dates and time [expand]
  Registration [expand, events only]
  Dietary requirements [expand, events only]
                                              [Save properties]
  Header image [expand]
```

**Linked event** has search, expandable date/state filters, an independent current selection, and **Previous page** /
**Next page** navigation over bounded result pages. **Access** switches between **Group Permissions** and
**Administrators**; the group editor shows one **Permission audience** at a time while preserving all audience drafts.
Permissions are grouped by their existing metadata keys and presets remain available in a compact disclosure.
**Actions** contains authorized archival explanations and commands, duplication/export, and owner-only permanent deletion.
The time-zone chooser retains search, common zones, browser detection, aliases, and UTC offset labels in either host.

The sections have explicit operations, not a global save that chains unrelated HTTP requests. **Save properties** is
one atomic property update; **Save event link** is a separate association transaction. Image upload, archival,
permission management, duplication, and deletion retain their existing commands and response conventions. This makes
success and failure unambiguous when file operations, navigation, and database updates have different boundaries.

Opening the modal initializes drafts from saved state. Cancel/close discards unsaved input. Before a command that
refreshes or leaves the page, require the user to save or discard other dirty sections; do not silently lose drafts.
During a write, prevent competing writes from the dialog and retain the existing page-wide archival mutation lock.
Errors stay inside the relevant section, preserve input, and leave the dialog open. Suppress duplicate submissions.

Render unauthorized fields, sections, and action forms as absent, including hidden inputs and empty section headings.
Do not serialize edit-only data for controls that were omitted. The browser submits only fields actually edited in
the authorized form. Server authorization remains authoritative if permissions change after rendering.

Move root title/description editing into this dialog. Descriptions on the main page become ordinary text; remove only
their root-level inline-edit bindings and hints. Item and slot inline editing remains as implemented. Move header
upload/removal into the dialog, reusing the existing image handler and endpoints without opening a nested modal.

Move the existing Group Permissions/delegated administrator controls into a conditional dialog section through
`permissionManagement`. Remove the superseded property/permission forms rather than maintain a second editor. Keep
activity **Rules & auto-assign**, event registrations, pools, and similar specialized workspaces where they belong;
authorized navigation actions can close the modal and open those existing tabs/pages.

`permissionManagement` includes an Add administrator modal of its own. Give that existing mixin/handler an inline
host mode inside Entity settings, reusing its selection and submission logic. Initialize its search when the inline
section opens rather than relying only on `shown.bs.modal`. Test adding an administrator and cancel/focus behavior.

The existing image, archival, permission-matrix, and administrator handlers need a small explicit host integration:
optional section-local feedback targets, a before-command dirty check, and shared pending/refresh coordination. Keep
their ordinary defaults for overview and other consumers. Do not attach another archive listener or duplicate its
page-wide lock. Feedback behind the modal backdrop and independent automatic reloads would violate the draft/error
behavior above, so moving markup alone is insufficient.

## 3. Permission contract

Use the active profile, existing effective permission evaluation, and current API rules. Ownership, an administrator
assignment, `ACCESS_ADMIN`, and a particular edit permission are distinct concepts. The modal's trigger uses the union
of its available capabilities, never a generic administrator check.

| Field or action | Required authorization and availability |
|---|---|
| Title, for event/activity/packing/drivers | `EDIT_TITLE`; add missing root update support through existing feature modules |
| Description, for those four types | `EDIT_DESC`; retain existing description endpoint compatibility |
| Event dates, location, deadline, time zone, registration deadline policy | `EDIT_META` |
| Event maximum participants | `EDIT_CAPACITY` |
| Event dietary requirement/comment/update policy | `MANAGE_REQUIREMENTS`, including profiles with no other edit permission |
| Activity date range | `EDIT_META`; validate against existing slots before applying |
| Survey title and description | Owner only, consistent with the survey-specific model |
| Header image upload/removal | Existing header API's `EDIT_META` evaluation, including its shared survey route |
| Duplicate | Existing `DATA_DUPLICATE` rule and full-account creation prerequisite |
| Archive/restore | Existing `ArchivePresentation` capabilities: effective `EDIT_META` for the four permission-managed types; survey owner only |
| Pause/resume automatic archival | Existing `canManageAutomation`; available only for events and standalone activity plans |
| Permanent deletion | Existing owner-only POST route; no substitute permission bit |
| Group Permissions / delegated administrators | `MANAGE_PERMISSIONS`; omit for surveys |
| Export and specialized navigation | Each existing route's exact guard; for example event participant export requires both `DATA_EXPORT` and `ACCESS_PARTICIPANTS` |
| Change/clear linked event | Proposed extension: `EDIT_META` on the child using its currently persisted relationship |
| Choose a non-null destination event | Additionally, effective `MANAGE_ASSIGNMENTS` on that destination event |

Post-creation event linking composes the established permission rules in the last two rows. The implementation checks
metadata and create-under-event authorities. Unlinking needs no target event permission. Relinking does not additionally
require management of the old event: authority over the child controls its relationship. Do not authorize the child
against the proposed new event, which could grant participant-audience access that the caller does not yet possess.

For target events, supply the event's own ID as the permission descriptor's `eventId`, so participant-audience grants
are evaluated. Effective grants can come from ownership, individual permissions, or supported audiences; an explicit
administrator-assignment row alone is neither necessary nor sufficient.

Surveys retain the actual shared image/duplicate API guards and their explicit owner-only lifecycle behavior. Do not
infer all survey controls from a blanket generic permission matrix. New survey property writes use an explicit owner
guard, while rendering matches the guard of each existing action.

For new property APIs, centralize field-to-permission checks and capability projection in the existing administration
controller where shared behavior fits. Feature controllers retain their own schemas and normalization. Shared
declarations go in `.d.ts` files; executable field policies stay in their owning `.ts` module. The browser consumes
server-projected capabilities instead of maintaining another field permission table.

## 4. Event selection during creation and editing

Replace the active-managed-event-only picker path with one reusable authorized event selection workflow. **All events**
means all events the current profile is authorized to attach to, including past, deadline-closed, and archived events.
Do not expose unrelated private events, their titles, or global result counts.

Default to all date periods and all archival/deadline states. Provide:

- Text search using the established title/description search behavior.
- Optional date range, with interval-overlap semantics: event end is on/after From, and start is on/before To.
- Period: **All**, **Upcoming**, **Ongoing**, **Ended**, derived from inclusive event dates.
- Archive state: **All**, **Active**, **Archived**, derived from authoritative archival state.
- Registration deadline: **All**, **Not passed / no deadline**, **Passed**. Reuse existing deadline/time-zone semantics;
  a passed deadline does not necessarily prohibit registration or organizer actions.
- **Reset filters**, explicit **No event**, and bounded result navigation.

There is no general event `closed` flag to invent. Dates, registration deadline, and archival are separate dimensions.
Display title, date range, and concise state badges per result. The current choice remains visible outside the result
list when filters or pagination exclude it. Selection is draft state until saved; clearing it must submit an explicit
null association. Never silently choose the first result or discard the current association when a query is empty.

The existing picker content becomes a reusable mixin/browser component. Creation uses it in its standalone picker
modal; entity settings embeds it inside the already open modal. Bootstrap dialogs must not be nested. Use prefixed DOM
IDs, safe text insertion, keyboard-operable choices, visible loading/errors, an accessible result announcement, and
request-generation/abort handling so an older response cannot replace a newer search.

Add a collection endpoint such as `GET /api/event/link-options`, registered before the `/:id` middleware. Require an
active profile; creation retains its existing full-account prerequisite. Put query normalization and projection in
`eventController`, and database candidate selection in `EventService`. Return only the authorized picker projection
through the normal structured response. Do not expose repositories, raw entities, participant data, or permission rows.

Use stable date-plus-ID ordering and bounded batches. The permission engine supplies active audiences, profile, and
the required permission bit for SQL filtering before LIMIT. Reuse `evaluateEntities` for final batch authorization
without per-result permission queries, including grant changes between discovery and evaluation. Candidate selection
must not restrict itself to owner/admin overview membership, which has a different meaning. Return 25 authorized
results with one authorized lookahead to determine continuation; encrypted cursors bind the profile and filters.
Expose no raw denied-event IDs or unfiltered counts. Keep one browser result page and a bounded cursor history, and
test both thousands of matches and sparse permissions without forcing users through empty pages.

Resolve a selected event separately with the same authorization predicate, so contextual creation, duplication, filter
changes, and validation recovery preserve a legitimate selected event even if it is outside the returned page. If an
existing child references an event the caller can no longer select, preserve the unchanged reference; allow authorized
unlinking, and reveal event details/navigation only under the existing disclosure rules.

Creation and post-creation changes must authorize the event that will actually be saved. Normalize `event_id` once at
the request boundary. A contextual `?eventId=` is a preselection, not authorization; the submitted selection is checked
again. Use that validated result when invoking the existing creation controller. Do not preserve an independent,
unconsumed injected field or allow request data to select a different unvalidated event.

## 5. Association changes and activity-plan integrity

Use an explicit operation, for example `POST /api/{activity|packing|drivers}/:id/event`, with this logical payload:

```json
{"eventId": "7e5fb956-f52f-4a24-a070-0a6483fbe4c2", "expectedEventId": null}
```

This example links a standalone root; use JSON `null` as `eventId` to unlink. Both fields accept only UUIDs or null. Reject
unknown fields, invalid IDs, non-linkable entity types, missing targets, and unauthorized choices. Require
`expectedEventId` to detect another editor changing the relationship; an already-applied identical target may return
idempotent success after authorization, while a different intervening change returns a conflict.

Keep HTTP orchestration and shared authorization in `entityAdminController`, with registration through the existing
`adminApiFactory` for linkable types only. Extend the existing locked-root transaction work in
`EntityLifecycleService` for association changes: that module already owns the root-type map, parent reads, and
parent-before-child locking. It must expose a domain operation, not repositories or table names to controllers.
Activity-specific dependent writes remain in `ActivityService`/`ActivityRecommendationService` and participate in the
same transaction; lifecycle code must not absorb recommendation algorithms or requirement rules.

Within the transaction:

1. Discover the old parent, lock existing old/new events in deterministic ID order, then lock and reload the child.
2. Verify the expected relationship, target existence, and authorization against current persisted state. Existing
   permission helpers may accept a transaction manager where needed; do not create a second authorization engine.
3. Persist the relation through TypeORM's `event` relationship, using `null` to unlink; `eventId` is a relation-ID
   projection and must not be mistaken for a writable relation column.
4. Apply necessary activity recommendation invalidation in the same transaction, then commit.
5. Recompute permissions, admission, and archive presentation. Refresh the page or return a safe established fallback
   navigation if the caller's old participant-derived access no longer admits the entity page.

Preserve the root ID, owner, grants, business records, files, personal visibility preferences, direct `archivedAt`, and
stored automatic-archive pause choice. Archival inheritance follows the newly selected event immediately. Unlinking
removes only inherited archival; it does not restore an independently archived root. A newly standalone activity plan
resumes eligibility for its own existing automatic schedule. Do not silently pause that schedule or copy the old
event's archive timestamp into the child. Explain relevant consequences only inside the authorized dialog.

Activity plans require extra integration because event membership feeds requirements and recommendations:

- Preserve committed slots, roles, assignments, requirement settings, profile overrides, and review history. Relinking
  is not cancellation of existing participants or a conversion of plan-local rules into event-owned records.
- Existing assignments can now involve profiles outside the new event. Show the impact before saving; retain them and
  use existing external-assignee rules for subsequent actions. Do not register profiles in the destination automatically.
- Reuse the existing target eligibility checks for generation, review, and application, respecting
  `allowExternalAssignees` and standalone-plan behavior. Stored overrides alone must not confer eligibility. Do not
  blanket-delete or disable every nonregistered override, since eligible external assignees are supported.
- Requirement editing must preserve unchanged overrides whose profiles are outside the new event. Represent those
  saved targets explicitly; never default an unmatched target to the first available participant. Distinguish unchanged
  stored rows from new/changed targets, retaining the current authorization and membership rules for the latter.
  Merge retained state in the existing requirement service transaction so an unrelated settings save cannot erase
  overrides. This preservation rule does not broaden who may receive a newly created override.
- Clear obsolete generated, unreviewed pending recommendations on a changed relationship. Preserve manual drafts and
  reviewed/applied/rejected history; revalidate retained actionable rows before application. State this effect in the
  dialog confirmation, and ensure background invalidation does not erase review history.
- Invalidate in-flight recommendation jobs through the existing job coordinator and include event identity in the
  context fingerprint. Verify the expected event relationship under the persistence transaction's plan lock before
  saving a job result, with relinking using the same lock. Retain the existing full-context freshness checks as well;
  the plan lock alone does not stabilize registrations or every requirement write. The guarantee added here is that
  relinking cannot race a stale relationship-based result into persistence, not a general concurrency rewrite.
- Recalculate participant projections, requirement coverage, and future recommendations from the destination context.
  Event-dependent tools become unavailable on unlink as their existing contracts require; saved settings remain.

Property date changes follow the same care: an activity date-range update must reject a range that excludes saved
slots, rather than silently move or delete them. Preserve slot dates and assignments, validate start/end ordering, and
invalidate date-dependent generated work as appropriate. Do not clamp a plan to its new event's dates automatically.

## 6. Minimal archival presentation

On the entity view, show nothing when active. When effectively archived, show only **This entity is archived.** as a
persistent status notice. Remove the public **Archival** panel, management buttons, automation explanations, restoration
instructions, and the separate **Archived with event**/paused-automation prose from this location.

Inside **Entity settings**, reuse `ArchivePresentation` and `entityArchiveActions` for authorized archival controls and
the fuller explanation: direct versus inherited archival, the need to restore a parent first, independent child
archival, automatic scheduling, and pause/resume state. Render this section only with archival-management authority;
having an unrelated title or duplicate permission must not expose organizer guidance. Parent links continue to use
the controller's authorized `eventUrl`.

Apply the same minimum to entity cards: an **Archived** badge is sufficient. Keep existing authorized card commands
and the separate personal **Hide for me**, **Show for me**, and **Use default visibility** actions. Remove explanatory
archival prose and automation status from participant-facing card menus; the full explanation belongs in the dialog.
Personal overview preferences never grant lifecycle authority and need not become root property fields.

Creation-time selected-event information belongs inside the organizer's event selector. Explain inherited archival
when choosing an archived destination there, not in an additional general page hint. Existing access, editing,
registration rules, and file retention continue to operate independently of archival.

## 7. Implementation ownership and sequence

No new controller or database service is needed. Add only a cohesive shared modal view/browser component where there
is no existing component with that responsibility; reuse the existing header, picker, image, permission, and archival
components for their established responsibilities.

| Step | Concrete work | Completion evidence |
|---|---|---|
| 1. Define contracts and close affected authorization gaps | Add modal/capability declarations in `src/types/EntityPropertyTypes.d.ts`; extend `EventTypes.d.ts` for picker query/results and `UserTypes.d.ts` only where shared flow config changes. Centralize supported fields/capabilities in existing controllers. Resolve the affected prerequisites tracked as IMP-009 and IMP-032 in the remediation backlog. | Exact field/action permission matrix; unauthorized property/target requests rejected before writes; no runtime types in `.ts` files under `src/types/` |
| 2. Property updates | Retain event `POST /:id/update`; add equivalent root update routes for activity/packing/drivers/survey in their existing API routers. Keep feature validation and service persistence together. Add missing title changes and owner-only survey changes; preserve optional-field omission and explicit clearing. Make a property save atomic. | Title-only, description-only, metadata-only, requirements-only, capacity-only, and owner cases work without submitting forbidden fields; invalid combined edits make no partial changes |
| 3. Event discovery and creation | Implement the collection query/controller and picker projection. Extend the existing picker with filters, paging, No event, preserved selection, and inline/modal hosts. Replace `getCreationData`'s active-only choices, normalize and authorize actual submitted selection, and preserve validation-recovery values. | Closed/past/archived authorized events are discoverable in ordinary creation as well as contextual creation and duplication; denied events remain undisclosed |
| 4. Post-creation association | Add link/unlink route registration and shared controller operation, extend lifecycle locking, and integrate activity invalidation through existing activity services/jobs. | Standalone-to-linked, linked-to-standalone, and event-to-event changes preserve records and lifecycle fields; stale relationship/job writes conflict safely |
| 5. Shared dialog and integration | Add `src/views/modules/module_entity_properties.pug` and `src/public/js/modules/entity-properties.ts`. Extend existing image/permission/archive handlers with optional dialog hosting, and extract reusable event-specific field markup. Give the event picker and Add administrator content inline hosts. Initialize from existing page entries, including the existing `stub.ts` initialization used by surveys. Pass all optional state through `data.entityProperties`, `data.archive`, and mixin arguments. | One working modal on each root view and event dashboard, correct focus/errors/drafts, no nested modals, no unauthorized DOM controls or duplicate event handlers; resolve IMP-033 through this integration |
| 6. Move controls and simplify notices | Replace root inline description editing, separate image dialog, event property form, and moved permission Settings controls. Integrate duplicate/delete/export actions through their original routes. Split minimal notices from managerial archive detail, including cards and picker context. | Existing workflows remain reachable; ordinary participants see only the archived condition; detailed help is inside authorized modal sections |
| 7. Verification and documentation | Run focused application checks, then justified broader checks. Update guides for the actual final labels and workflows; update permission/development/architecture references only where their contracts changed. | The acceptance cases below pass, unrun prerequisites are reported, and the plan is updated to distinguish delivered and remaining work |

For event fields, keep the existing names that forms and controllers accept and normalize exactly once. Dates,
checkboxes, nullable capacity, blank descriptions, and deadline time zones need explicit handling. Unchecked rendered
checkboxes must be submitted as false using the agreed controller representation; omitted unauthorized fields must
remain omitted. Do not rewrite deadline/time-zone fields during an unrelated title-only save.

Existing `/:id/description` endpoints should delegate to the same normalized description update behavior, preserving
their public contract without parallel validation rules. Do not create a generic property bag capable of writing
ownership, grants, archive timestamps, file paths, or arbitrary entity fields. Do not aggregate image/file operations,
archival, and hard deletion into the property update transaction.

Follow local formatting. Use named handlers and short, readable loops; do not copy the slot editor's nested lambdas
into a new generalized framework. Purposeful comments must explain the field contract, permission source, association
effects, lock ordering, job races, and action boundaries. Pug `//-` comments must document each mixin's inputs,
conditional sections, renderer data, and browser DOM hooks. Avoid unrelated formatting or module refactoring.

## 8. Verification plan and acceptance cases

Use the cheapest layer that protects each changed boundary, following [Testing Guide](TESTING_GUIDE.md). Do not add all
layers to every control.

| Boundary | Focused coverage |
|---|---|
| Modal/picker browser behavior | Frontend tests for capability-specific payloads, dirty-section handling, reset/cancel, inline failures, duplicate submission prevention, clearing selection, filters, paging, stale responses, and image/archive integration |
| Rendered permissions | Synthetic Pug render coverage or existing view-test patterns: unauthorized elements/data absent; modal absent when empty; single-permission and survey-owner cases; only minimal public archival state |
| API authorization | Extend actual application route tests for forged fields, wrong active profile, non-owner deletion/survey changes, creation body/query mismatch, and target permissions, independent of UI checks |
| Persistence | Real TypeORM integration tests for atomic property saves; link/unlink/relink; null/omitted relation behavior; archived targets; direct vs inherited archive state; record/file preservation; destination deletion and concurrent relationship/archival changes |
| Activity context | Focused existing activity/job tests plus persistence cases for preserved assignments/rules/history, external-assignee eligibility, unchanged old-event overrides during later requirements saves, stale background results, pending recommendation invalidation, and excluded-slot date-range rejection |
| Built workflow | A small Playwright path opens settings, changes properties, links an archived event, unlinks it, verifies participant display, and exercises a failure without losing drafts; check mobile layout and focus. Reuse existing authorization/archival scenarios rather than duplicate a large matrix in E2E. |

Extend existing suites such as `tests/integration/permission-workflows.spec.ts`,
`tests/integration/event-workflows.spec.ts`, `tests/integration/activity-workflows.spec.ts`,
`tests/integration/entity-archival.spec.ts`, and relevant feature suites. Reuse production factories and guarded database
support. The existing E2E archival scenario that expects an archived event to be absent from the ordinary creation
picker must change to test discovery and correct selection/validation recovery.

Acceptance includes these independently observable cases:

- A participant with no root edit/action authority sees no settings button and no organizer archival explanation.
- A title-only editor sees Title but no Description, image, linking, or lifecycle controls; requirements-only event
  editors can use their dietary controls without dashboard admission or unrelated edit rights.
- A delegated metadata editor can change an image and manage archival but cannot permanently delete the root.
- A user with only duplicate permission sees the action only when the existing account prerequisite can complete it.
- An event assignment with insufficient bits does not grant link eligibility; valid audience-derived grants do.
- Past, registration-deadline-passed, and archived events remain selectable when authorized, across result pages.
- Changing filters never saves, clears, or changes the selected event. Explicit unlinking preserves children and files.
- Linking an archived event produces only the minimum public archived hint. Unlinking preserves a direct archive and
  recalculates inherited state and standalone scheduling without implicit restoration.
- An activity relink cannot apply a stale background result or silently remove committed assignments/review history.
- Surveys retain standalone voting and owner controls; their new title/description editor and existing images work.
- A server-side denial leaves the dialog open with the user's draft and does not partially save another field.

After implementation, use `npx vitest run tests/.../specific.spec.ts` for focused files, then `npm run test:quick`.
The package layer scripts already include a directory selector, so appending a filename does not narrow that directory.
Run database-backed suites only after verifying the guarded, disposable database target. Run `npm run build` and focused `npm run e2e -- ...` scenarios with the prepared disposable
E2E environment. Do not describe an unrun suite as passed; do not run reset/schema commands against shared data.

Update the task-first user guides for activity plans, packing lists, drivers lists, events, surveys, permissions, and
dashboard/card changes. Keep exact labels synchronized with rendered views. Review maintained help visuals for any
moved controls. Operator/configuration guidance and AI summaries need no change unless implementation actually changes
those contracts. Documentation reports remain optional and advisory, never application test or release prerequisites.

## 9. Implementation and verification evidence

The 2026-10-03 revision moves business checks and request-specific errors into controllers. Existing services retain
only queries, locks, transaction boundaries, and writes; controller callbacks validate the locked snapshots before
persistence. Lifecycle services return coherent raw snapshots; controllers calculate inherited state, independent
scheduling, and permitted commands. The UI revision adds focused tabs, compact permission editing, full timezone
feature parity, and bounded event pages.

The implementation adds one shared modal and browser host, extends the existing feature controllers/services and
administration/lifecycle boundaries, and keeps all shared contracts in declaration files. Existing event relationships
support linking without a schema migration. Deletion remains in each feature service; surveys remain standalone.

The shared event picker now serves creation and later linking, including authorized archived and historical events.
Property writes are atomic, filtered per field on both server and UI, and submitted as changed fields only. Inline
selectors and administrator controls avoid nested dialogs. Archival detail is confined to authorized modal content.
Activity relinking preserves saved assignments, rules, overrides, and history; stale generated work cannot commit.

User guides and canonical architecture, development, and permission references reflect the new controls. An obsolete
controls illustration has been removed from the guide and retained as an authoring reference pending refresh; this is
the advisory `DOC-ENTITY-PROPERTIES-VISUAL` follow-up in the remediation record.

Verification on 2026-10-03 used separate disposable MariaDB schemas and schema-scoped roles for integration and E2E:

- `npm run build` passed. The final controller and browser revisions separately passed `build:server`, `build:client`,
  and the view-copy step.
- Final `TZ=UTC npm run test:quick` passed all 422 tests. Frontend coverage includes paging through 2,625 results,
  lazy/deferred searches, complete hidden-audience payloads, failed responses, and restored timezone behavior.
- `TZ=UTC npm run test:integration` passed all 296 tests. The final property file was repeated after its last assertion
  change: all 14 cases passed, including 2,400 matching events across grant sources, literal search characters, batched
  event-owner membership, and post-link admission. The large-event case completed in 879 ms on this local database;
  that observation is not a production latency guarantee.
- The final `npm run e2e -- tests/e2e/entity-properties.spec.ts tests/e2e/archival.spec.ts --workers=1` passed all eight
  scenarios. The preceding combined run also passed all 16 existing `core-workflows.spec.ts` scenarios. Final fixes
  aligned tests with collapsed filters/tabs and removed decorative administrator icons from accessible control names.
- Real-browser desktop and 390-pixel phone inspection found no page errors or horizontal overflow. Tab state, property
  groups, inline timezone selection, compact audience editing, and event selection were inspected.
- `npx tsc --project tsconfig.test.json --noEmit` still reports existing errors in unchanged `event-participant.ts`,
  invoice/migration tests, and a shared test factory. None are in changed source/tests; the server typecheck/build passes.
- `git diff --check` passed. The advisory documentation report has no broken links, missing paths, or missing scripts.
  Remaining findings concern the historical source fingerprint, metadata in local ignored reports, and the retired
  illustration retained for the documented visual follow-up.

No schema change or migration is required. Verification used the isolated local MariaDB container, which was returned
to its original stopped state afterward. Generated reports, uploads, screenshots, and local test settings are not
maintained changes.
