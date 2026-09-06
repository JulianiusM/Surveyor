# Permission System Reference
<!--
documentation-metadata
audience: maintainers; security reviewers; advanced documentation contributors
owner: permission-system maintainers
status: current
last-verified: 2026-09-05
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: D03 permission evaluation, storage, audience predicates, page admission, middleware, item fallback, UI management, generated bit/preset/default reference, and survey exclusion
source-anchors: src/modules/lib/permissions.ts; src/modules/permissionEngine.ts; src/types/PermissionTypes.d.ts; src/middleware/permissionMiddleware.ts; src/middleware/guestFlowFactory.ts; src/middleware/adminApiFactory.ts; src/controller/entityAdminController.ts; src/modules/database/services/EntityAdminService.ts; src/modules/database/entities/permissions/EntityPermissions.ts; src/modules/database/entities/permissions/EntityAdminAssignment.ts; src/views/modules/module_perm_matrix.pug; src/views/modules/module_admin_matrix.pug; src/views/modules/module_admin_options.pug; src/public/js/modules/perm-matrix.ts; src/public/js/modules/admin-matrix.ts; src/routes/event.ts; src/routes/api/event.ts; src/routes/api/activity.ts; src/routes/api/packing.ts; src/routes/api/drivers.ts
next-review: D12,D14
-->

This is the canonical maintainer reference for Surveyor’s general permission engine. The end-user, novice-first explanation is [Permissions and Sharing](user-guide/PERMISSIONS.md).

## Scope

The active product contract applies to:

- Events.
- Activity plans and activity slots.
- Packing lists and packing items.
- Drivers lists and driver rows.
- Event registrations where routes evaluate them as items.

**Surveys are an intentional exception.** Although shared types include `survey` and `surveyItem`, current survey creation, views, routes, and controllers do not participate in the general audience/default/administrator permission UI. Do not infer survey authorization from common middleware metadata or add survey recipes to the general permission guide. See [DEC-005](decisions/DEC-005-SURVEY-CREATION-PERMISSIONS.md) and [DEC-001](decisions/DEC-001-SURVEY-COMBINATION-AUTHORIZATION.md).

## Authoritative model

For a non-owner subject, the engine calculates one effective bitmask by applying bitwise OR to every applicable grant:

```text
effective = individual
          | public
          | (full-account profile ? authenticated : 0)
          | (active guest-backed or full-account-backed profile ? guest : 0)
          | (registered for subject.eventId ? participant : 0)
```

If the active profile owns the subject, evaluation returns `ALL_MASK` immediately.

There are no deny bits and no override precedence. A zero individual mask cannot remove an audience grant. A profile-specific grant does not replace public or audience defaults.

### Audience predicates

| Source | Predicate in `computeMaskFor` |
|---|---|
| Individual | Active `session.profile.id` has an `EntityAdminAssignment` for the subject type and ID. |
| Public | Applied whenever a stored public default exists, regardless of account type. |
| Authenticated | Active profile has `profile.user.id`. |
| Guest | Active profile has either `profile.user.id` or `profile.guest.id`; this deliberately includes full-account profiles. |
| Participant | Subject has an `eventId`, active profile exists, and `isRegisteredForEvent(profileId, eventId)` returns true. |
| Owner | Active profile ID equals `ownerId`; returns `ALL_MASK`. |

A full-account event participant with an individual assignment can therefore receive five non-owner sources simultaneously: individual, public, guest, authenticated, and participant.

## Session establishment and page admission

Permission evaluation is not the only access layer. `createGuestFlow` installs a safe-zone middleware for most feature pages:

1. For an event-linked resource, a registered participant enters without an additional page-level bit check.
2. A nonparticipant with an active profile enters only when the effective entity mask contains `ACCESS_VIEW`.
3. Other nonparticipants receive the event-registration error.
4. For an unlinked resource, and for feature routes configured without linked-resource enforcement, any active profile enters.
5. A visitor without an active profile is redirected to the feature’s guest-entry page.

Consequently, audience permissions are capability grants and only a conditional page-admission mechanism. Clearing all masks is not a universal confidentiality boundary for unlinked resources. Action routes and rendered controls must still enforce their specific bits.

## Persistence

### Audience defaults

`EntityPermissions` stores one unsigned integer mask for each `(entityType, entityId, audience)` tuple in `entity_permissions`. Valid audiences are `participant`, `guest`, `authenticated`, and `public`.

`updatePerms` only changes audiences present in its options. A provided mask of zero clears that audience; an omitted audience remains unchanged. `saveDefaultPermsFromBody` converts posted permission keys into masks before persistence.

### Profile-specific grants

`EntityAdminAssignment` stores one unsigned integer mask for each `(entityType, entityId, profile)` tuple in `entity_admin_assignments`.

The UI calls these rows **Administrators**, but the row itself is only a profile-specific grant source. It does not imply `ACCESS_ADMIN`, `MANAGE_PERMISSIONS`, or any other capability. A zero-mask row still exists and can make the entity appear in **Administrable entities** because managed-entity discovery can query assignment presence with mask zero.

The administrator picker uses `searchUsersSecure`, which inner-joins `Profile.user`; the current UI can select full-account profiles, not guest-only profiles.

## Generated permission-bit reference

The rows below are generated from the order and values in `PERM` in `src/modules/lib/permissions.ts`. Descriptions are maintained interpretations of current route and view usage.

<!-- generated-from: src/modules/lib/permissions.ts#PERM -->
| Key | UI label | Value | Hex | Category | Current contract |
|---|---|---:|---:|---|---|
| `EDIT_TITLE` | Edit Title | 1 | `0x1` | Editing | Entity title mutation; item-title routes may instead use an item permission with parent fallback. |
| `EDIT_DESC` | Edit Desc | 2 | `0x2` | Editing | Entity description mutation; child descriptions commonly accept item EDIT_DESC or parent ITEM_EDIT / ITEM_EDIT_DESC. |
| `EDIT_CAPACITY` | Edit Capacity | 4 | `0x4` | Editing | Entity capacity mutation and supported child-capacity edits. |
| `EDIT_META` | Edit Meta | 8 | `0x8` | Editing | Entity metadata and header-image mutation; supported child metadata checks use item EDIT_META with explicit parent fallback. |
| `ITEM_ADD` | Item Add | 16 | `0x10` | Items | Create a child item/slot/driver row on the parent entity. |
| `ITEM_EDIT` | Item Edit | 32 | `0x20` | Items | Reorder children and broad parent fallback for several child edit operations. |
| `ITEM_EDIT_DESC` | Item Edit Desc | 262144 | `0x40000` | Items | Narrow parent fallback for child description edits. |
| `ITEM_EDIT_META` | Item Edit Meta | 1048576 | `0x100000` | Items | Narrow parent fallback for activity-slot metadata edits. |
| `ITEM_DELETE` | Item Delete | 64 | `0x40` | Items | Delete a child item when the route accepts the same parent fallback. |
| `MANAGE_ASSIGNMENTS` | Manage Assignments | 128 | `0x80` | Management | Administrative assignment/role operations, event invoice-pool operations, linked-entity creation checks, and selected deadline bypasses. |
| `MANAGE_REQUIREMENTS` | Manage Requirements | 256 | `0x100` | Management | Event dietary requirement settings and activity requirement/rule/shared-field management. |
| `MANAGE_REGISTRATIONS` | Manage Registrations | 512 | `0x200` | Management | Event registration-link and participant-registration administration. |
| `MANAGE_PERMISSIONS` | Manage Permissions | 65536 | `0x10000` | Management | Audience-default and profile-specific grant administration. |
| `DATA_EXPORT` | Data Export | 1024 | `0x400` | Data | Feature exports; event participant export checks the combined mask DATA_EXPORT \| ACCESS_PARTICIPANTS. |
| `DATA_DUPLICATE` | Data Duplicate | 2048 | `0x800` | Data | Duplicate-page authorization before the normal creation flow. |
| `ACCESS_REGISTRATION` | Access Registration | 4096 | `0x1000` | Access | Event registration endpoint and matching browser-side precheck. |
| `ACCESS_VIEW` | Access View | 8192 | `0x2000` | Access | Nonparticipant admission to event-linked resources and several self-service/collaborative APIs. |
| `ACCESS_CREATE` | Access Create | 16384 | `0x4000` | Access | Stored and exposed in presets/defaults; no current request guard uses it as the sole top-level creation authorization. |
| `ACCESS_ADMIN` | Access Admin | 32768 | `0x8000` | Access | Event administration-dashboard admission. |
| `ACCESS_PARTICIPANTS` | Access Participants | 131072 | `0x20000` | Access | Participant/assignee visibility and event participant API access. |
| `ACCESS_ITEMS` | Access Items | 524288 | `0x80000` | Access | Visibility of an event’s related-entity lists. |
<!-- end-generated -->

`ALL_MASK` is `2097151` (`0x1fffff`), the OR of every current bit.

### Important non-equivalences

- `ACCESS_ADMIN` opens the Event administration dashboard; it is not “all admin permissions.”
- `MANAGE_PERMISSIONS` authorizes audience and individual grant changes; on an event, a delegated permission manager also needs `ACCESS_ADMIN` to reach the dashboard.
- `MANAGE_ASSIGNMENTS` authorizes administrative assignment operations. Several self-service assignment actions instead require `ACCESS_VIEW` plus feature constraints.
- `ACCESS_CREATE` is present in the generated UI and defaults, but current top-level creation remains controlled by full-account and feature-specific route prerequisites.
- Event participant export requires the combined mask `DATA_EXPORT | ACCESS_PARTICIPANTS`.

## Generated preset reference

The rows below are generated from `DEFAULT_PERM` in `src/modules/lib/permissions.ts`.

<!-- generated-from: src/modules/lib/permissions.ts#DEFAULT_PERM -->
| Key | UI label | Value | Hex | Members |
|---|---|---:|---:|---|
| `FULL_EDIT` | Full Edit | 15 | `0xf` | `EDIT_TITLE`, `EDIT_DESC`, `EDIT_CAPACITY`, `EDIT_META` |
| `FULL_ITEM` | Full Item | 1310832 | `0x140070` | `ITEM_ADD`, `ITEM_EDIT`, `ITEM_EDIT_DESC`, `ITEM_EDIT_META`, `ITEM_DELETE` |
| `FULL_MANAGE` | Full Manage | 66432 | `0x10380` | `MANAGE_ASSIGNMENTS`, `MANAGE_REQUIREMENTS`, `MANAGE_REGISTRATIONS`, `MANAGE_PERMISSIONS` |
| `FULL_DATA` | Full Data | 3072 | `0xc00` | `DATA_EXPORT`, `DATA_DUPLICATE` |
| `FULL_ACCESS` | Full Access | 716800 | `0xaf000` | `ACCESS_REGISTRATION`, `ACCESS_CREATE`, `ACCESS_VIEW`, `ACCESS_ADMIN`, `ACCESS_PARTICIPANTS`, `ACCESS_ITEMS` |
| `ADMIN` | Admin | 2097151 | `0x1fffff` | `EDIT_TITLE`, `EDIT_DESC`, `EDIT_CAPACITY`, `EDIT_META`, `ITEM_ADD`, `ITEM_EDIT`, `ITEM_EDIT_DESC`, `ITEM_EDIT_META`, `ITEM_DELETE`, `MANAGE_ASSIGNMENTS`, `MANAGE_REQUIREMENTS`, `MANAGE_REGISTRATIONS`, `MANAGE_PERMISSIONS`, `DATA_EXPORT`, `DATA_DUPLICATE`, `ACCESS_REGISTRATION`, `ACCESS_CREATE`, `ACCESS_VIEW`, `ACCESS_ADMIN`, `ACCESS_PARTICIPANTS`, `ACCESS_ITEMS` |
| `DEFAULT_ENTITY` | Default Entity | 552960 | `0x87000` | `ACCESS_REGISTRATION`, `ACCESS_VIEW`, `ACCESS_CREATE`, `ACCESS_ITEMS` |
<!-- end-generated -->

The client-side matrix applies a preset by setting every checkbox in that one matrix section to whether its bit is present in the preset mask. Presets therefore **replace** the section’s selection. **All** sets every checkbox; **None** clears every checkbox.

## Initial defaults

`getInitialPerms` supplies creation-form defaults:

| Entity type | Initial masks |
|---|---|
| `event` | `public = DEFAULT_ENTITY`; `participant = ACCESS_PARTICIPANTS` |
| `activity` | `public = DEFAULT_ENTITY` |
| `packing` | `public = DEFAULT_ENTITY` |
| `drivers` | `public = DEFAULT_ENTITY` |

Other audience keys are absent and therefore render as zero. `DEFAULT_ENTITY` is `ACCESS_REGISTRATION | ACCESS_VIEW | ACCESS_CREATE | ACCESS_ITEMS`, value `552960` (`0x87000`).

Do not apply this table to surveys. Survey creation deliberately does not persist or render the general matrix.

## Entity and item evaluation

`evaluateSubject` handles two subject kinds:

- An entity produces a `PermView` with its effective mask and parent mask zero.
- An item calculates both the parent entity mask and the item’s own mask. The item may have its own owner, audience rows, and individual rows.

`PermView.has(key)` tests the subject’s own mask only. `PermView.allow(key, parentKey)` returns true when the subject has `key` or the parent has any accepted fallback key. If no parent key is supplied, the same key is used as the default fallback.

`requireItemPermission*` mirrors that contract at the middleware layer through `can(subject, requiredPerm, requiredParentPerm)`.

### Current explicit parent fallbacks

| Child operation | Child bit | Accepted parent bit or bits |
|---|---|---|
| Activity, packing, or driver child description | `EDIT_DESC` | `ITEM_EDIT` or `ITEM_EDIT_DESC` |
| Activity-slot metadata/attributes | `EDIT_META` | `ITEM_EDIT` or `ITEM_EDIT_META` |
| Packing/driver child attributes and activity role addition | `EDIT_META` | `ITEM_EDIT` |
| Child deletion | `ITEM_DELETE` | `ITEM_DELETE` |
| Child assignment administration | `MANAGE_ASSIGNMENTS` | `MANAGE_ASSIGNMENTS` |

Reordering is an entity-level `ITEM_EDIT` check; adding a child is an entity-level `ITEM_ADD` check. Fallbacks are route-specific, not global inheritance rules.

## Middleware and rendering contracts

- `requirePermission` and `requirePermissionApi` evaluate entity subjects and reject when the required mask is absent.
- `requireItemPermission` and `requireItemPermissionApi` evaluate item plus parent and can accept explicit parent alternatives.
- A required mask can combine bits. `hasPerm(mask, required)` succeeds only when all bits in the combined required mask are present.
- `attachPermBundle` supplies entity and item `PermView` instances to Pug.
- `attachPermMeta` supplies generated labels, current/default audience masks, and presets.
- `attachAdminData` supplies profile-specific rows.
- Group and administrator mutation APIs are guarded by `MANAGE_PERMISSIONS`.

Client-side checks improve feedback and visibility but are not the security boundary. Every mutation must retain the matching server-side middleware or controller authorization.

## UI contract

### Group Permissions

The reusable matrix renders the four audiences in this order: Participant, Guest, Authenticated, Public. Each section offers every generated bit, every generated preset, **All**, and **None**. Existing entities save through **Update permissions**; creation forms submit the checked keys with the feature form.

### Administrators

The administrator matrix supports:

- **Add** → **Add administrator**.
- Search under **User (name or email)**.
- Optional **Initial preset**.
- Per-profile presets, **All**, **None**, and individual checkboxes.
- **Save** and **Remove**.

Adding with no preset or explicit keys stores a zero mask. Removing a row removes only the individual source; effective permissions may remain through audiences or ownership.

## Scenario truth table

The table assumes an unowned subject and masks named `P`, `G`, `A`, `R`, and `I` for Public, Guest, Authenticated, Participant, and Individual.

| Active context | Effective mask |
|---|---|
| No profile | `P` |
| Guest-backed profile, not participant | `I \| P \| G` |
| Full-account profile, not participant | `I \| P \| G \| A` |
| Guest-backed event participant | `I \| P \| G \| R` |
| Full-account event participant | `I \| P \| G \| A \| R` |
| Owner profile | `ALL_MASK` |

This truth table is a grant calculation, not a promise that each page route admits a session in every row. Apply the safe-zone rules above.

## Change checklist

When changing a permission bit, predicate, default, preset, route guard, or UI control:

1. Update `PERM` or `DEFAULT_PERM` as the single generated source where appropriate.
2. Review every server-side `requirePermission*`, `requireItemPermission*`, and direct `can` call.
3. Review Pug and browser-side checks for matching visibility and feedback.
4. Review creation defaults and stored audience migration implications.
5. Regenerate and compare both tables in this reference and the complete label table in the user guide.
6. Add scenario tests for overlapping audiences, owner behavior, item fallback, and linked-resource admission.
7. Update affected feature guides in the same behavior change.
8. Keep surveys excluded unless an explicit product decision changes DEC-005.

## Validation anchors

The D03 documentation package validates:

- Exact permission keys, values, labels, preset membership, and initial defaults against `src/modules/lib/permissions.ts`.
- Cumulative source combinations against `computeMaskFor`.
- Linked and unlinked page-admission descriptions against `guestFlowFactory.ts`.
- Parent fallback examples against the API route middleware.
- Matrix labels and replace-selection behavior against Pug and browser modules.
- Survey exclusion against the feature-specific decision records and survey creation/view paths.
