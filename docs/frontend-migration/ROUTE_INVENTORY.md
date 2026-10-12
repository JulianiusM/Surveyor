# Frontend Migration Route Inventory
<!--
documentation-metadata
audience: maintainers; developers; frontend migration reviewers
owner: application maintainers
status: current
last-verified: 2026-10-04
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: source-reviewed page, form, API, factory-expanded, identity, token, help, and binary route inventory; request execution and browser verification not performed
source-anchors: src/app.ts; src/routes/; src/middleware/guestFlowFactory.ts; src/middleware/adminApiFactory.ts; src/middleware/assignFlowFactory.ts; src/middleware/entityHeaderUpdateHandler.ts; src/middleware/permissionMiddleware.ts; src/middleware/paramHandler.ts; src/controller/; src/public/js/; src/views/; docs/PERMISSIONS_REFERENCE.md
next-review: frontend-migration-contract-design
-->

This is the source-reviewed route baseline for the frontend migration. It records the current transport and its
owners so that a future SPA preserves entry points and observable workflows. It is not a proposed v1 API or a claim
that every listed route was exercised. The separate [visual baseline](VISUAL_BASELINE.md) records the subset used
in a controlled application/browser capture; mail and external identity-provider flows were not exercised.

The [second-pass edge-case records](EDGE_CASES.md) describe state-dependent admission, identity, failure and
concurrency behavior that route names and middleware lists alone cannot express.

Routes were traced from [application mounts](../../src/app.ts) through the [API mounts](../../src/routes/api.ts),
feature routers, and the factories listed below. A path appearing only in a comment is not treated as a registered
route. For example, the guest-flow header mentions an edit-token path, but the current factory does not register it.
The implemented guest login entry is `/guest/:id/login/:token`.

## Reading the inventory

- `{feature}` expands only to the features explicitly listed beside a table. `:id`, `:poolId`, and other colon names
  are Express path parameters. Prefixes in table introductions are part of every listed suffix.
- **HTML** means a rendered page; **redirect** means normal browser navigation; **JSON** means the current
  `{status, message, data}` response convention unless stated otherwise; **file** means a binary/image response.
- **Account** means `isAuthenticated`: a full user account and active profile. **Session** means `isLoggedIn`: a user
  or guest identity and active profile. The words **participant**, **owner**, and named permissions refer to server
  checks, not UI visibility.
- Permission names denote the actual route guard or controller policy. Item guards use the item/parent fallback
  logic in [permissionMiddleware](../../src/middleware/permissionMiddleware.ts); an item check is not interchangeable
  with a root-only check. Controller validation, membership, lifecycle, capacity, and ownership rules still apply.
- Payload entries describe the transport and important fields. They do not replace the controller's complete field
  schema. Most current handlers accept `req.body` without a published wire contract.

The common request pipeline loads the database session, validates its identity, and populates common request locals
before dispatching page or API routes. Invalid stored sessions can cause a redirect before API dispatch. Page auth
middleware also redirects, while API permission guards throw structured errors. The
[HTTP helper](../../src/public/js/core/http.ts) documents why a fetch that follows a login redirect must not be taken
as a successful mutation. The [renderer](../../src/modules/renderer.ts) supplies JSON envelopes; the
[generic error handler](../../src/middleware/genericErrorHandler.ts) selects HTML versus JSON for expected/API errors.
There is no universal API-native session bootstrap or version prefix in this baseline.

## Application mounts, home, and help

[app.ts](../../src/app.ts) mounts `/`, `/users`, `/guest`, `/survey`, `/packing`, `/drivers`, `/activity`, `/event`,
`/help`, and `/api`. `/api` mounts `/users`, `/survey`, `/packing`, `/drivers`, `/activity`, and `/event`.
Static public assets are served before the session middleware; uploaded files are served by their feature routes.

| Method and path | Input/output | Control owner and preservation notes |
|---|---|---|
| `GET /` | HTML home | [Home router](../../src/routes/index.ts); ordinary navigation and creation/sign-in links. |
| `GET /healthz` | Text `ok` | Application health endpoint; keep outside SPA fallback routing. |
| `GET /help` | HTML task index | [Help router](../../src/routes/help.ts) and [help controller](../../src/controller/helpController.ts); no feature auth guard. |
| `GET /help/search?q=...` | HTML search results | Searches fixed release-shipped guides; retain search query and ordinary-link navigation. |
| `GET /help/:docName` | HTML maintained guide | Fixed help source and document validation; preserve document URLs and anchors. |
| `GET /help/assets/:assetName` | File | Controller resolves allowed local assets; missing assets are 404; response sets `nosniff`. |

Help remains trusted release-shipped content from `docs/user-guide/`. A client renderer must preserve the
[help trust boundary](../policies/DOCUMENTATION_POLICY.md#in-app-help-trust-boundary); the migration does not authorize
user-editable or remote help sources. Unknown API paths and unknown page paths currently reach their respective
error handling chains, not a generic SPA document.

## Identity, account, profile, and guest entry

Owner for this table: [users router](../../src/routes/users.ts),
[guest router](../../src/routes/guests.ts), [user controller](../../src/controller/userController.ts), and
[OIDC module](../../src/modules/oidc.ts). Native forms and links are in
[user views](../../src/views/users). These flows cannot be inferred from `/api/users`.

| Method and path | Action, input, and output | Server guard/control |
|---|---|---|
| `GET /users` | Redirect to `/users/dashboard` | Dashboard handles session admission. |
| `GET /users/register` | HTML registration form; `next` context | Local-login setting; redirects to OIDC login when local login is disabled. |
| `POST /users/register` | Native form; create inactive account and send activation email; HTML result | Local-login setting; controller validates registration and optional `next`. |
| `GET /users/login` | HTML sign-in and guest-recovery forms; `next` context | Local-login setting; redirects to OIDC login when local login is disabled. |
| `POST /users/login` | Native credentials; establish session; redirect to `next` or dashboard | Local-login setting and controller authentication. |
| `GET /users/logout` | End session/provider logout; redirect | Controller chooses provider/local destination; route can use `next`. This is currently a navigation endpoint. |
| `GET /users/forgot-password` | HTML recovery form | Local-login setting. |
| `POST /users/forgot-password` | Native `username`; request reset email; HTML result | Local-login setting and controller recovery policy. |
| `GET /users/reset-password/:token` | Validate token; HTML password form | Local-login setting and reset-token validation. |
| `POST /users/reset-password/:token` | Native password fields; HTML result | Local-login setting, token and password validation. |
| `GET /users/activate/:token` | Activate account; redirect to login, preserving optional `next` | Local-login setting and activation-token validation. |
| `GET /users/oidc/login` | Start authorization; redirect to provider | OIDC setting; session-owned authorization state/PKCE. |
| `GET /users/oidc/callback` | Validate provider callback; establish application session; redirect to dashboard | OIDC setting and controller/provider response checks. Current callback destination is dashboard. |
| `GET /users/dashboard` | HTML overview; URL-selected bounded collections/regions | Session; controller scopes data to active profile; `private, no-store`. |
| `GET /users/account/delete` | HTML confirmation | Session. |
| `POST /users/account/delete` | Native confirmation fields; delete through controller; redirect | Session; account/guest-specific controller behavior. |
| `GET /users/profile` | HTML active profile | Session. |
| `POST /users/profile` | Native profile fields; update and redirect to profile | Session; controller validates the active profile. |
| `GET /users/profile/delete` | HTML profile-deactivation confirmation | Account. |
| `POST /users/profile/delete` | Native confirmation; deactivate, choose another active profile, redirect to management | Account and controller ownership. |
| `GET /users/profile/change/:id` | Change active profile; redirect to dashboard | Account; controller validates selectable profile. This currently changes state during navigation. |
| `GET /users/profile/create` | HTML new-profile form | Account. |
| `POST /users/profile/create` | Native profile fields; create and redirect to management | Account; account ID comes from session. |
| `GET /users/profile/manage` | HTML account's profile list | Account; account ID comes from session. |
| `GET /users/profile/migrate/request` | HTML migration token for active profile | Session, including guest profiles. |
| `GET /users/profile/migrate/show` | HTML token-entry form | Account. |
| `POST /users/profile/migrate/show` | Native `token`; HTML source-profile review | Account; token resolved by controller. |
| `POST /users/profile/migrate/execute` | Native `token`; migrate to current account; redirect to management | Account; target account comes from session. |
| `GET /guest/recovery` | Redirect to `/users/login` | Recovery form is part of login. |
| `POST /guest/recovery` | Native `email`; send recovery links; HTML result | Controller recovery lookup and mail behavior. |
| `GET /guest/:id/login/:token` | Authenticate guest; redirect to `next` or dashboard | Guest ID/token validation; establishes the same application session. |

Activation/reset/recovery emails construct these server URLs. Keep their token validation, consumption, destination,
and failure behavior when the surrounding pages change. OIDC navigation remains a server/provider exchange rather
than an ordinary JSON mutation. Active-profile switching changes the identity under which every subsequent read and
write occurs; SPA caches and pending work must respect that boundary.

## Shared entity page and native-form routes

The [guest-flow factory](../../src/middleware/guestFlowFactory.ts) is used by all five feature page routers:
[survey](../../src/routes/survey.ts), [packing](../../src/routes/packing.ts),
[drivers](../../src/routes/drivers.ts), [activity](../../src/routes/activity.ts), and
[event](../../src/routes/event.ts). The prefix is `/{feature}`, where `{feature}` is exactly
`survey`, `packing`, `drivers`, `activity`, or `event`.

| Method and suffix | Action, input, and output | Server guard/control |
|---|---|---|
| `GET /create` | HTML creation form; optional `eventId` preselection | Account; allowed initial event is projected by the controller. Events themselves have no parent-event choice. |
| `POST /create` | Multipart feature fields and optional `headerImg`; create; redirect to new detail page | Account; actual `event_id` body selection is authorized; feature `preprocessCreate`, `createEntity`, and `afterCreateItems` hooks. Validation failures re-render form data. |
| `GET /:id/guest` | HTML guest entry; redirect to detail if already acting as a profile | Root loader; supplies entity context and feature-specific guest-registration advice. |
| `POST /:id/guest` | Native `username`, optional `email`; create guest/session, optionally email recovery link; redirect | Root loader; required name, normalized email, controller/service registration and persisted session. |
| `GET /:id/duplicate` | HTML prefilled creation form | `DATA_DUPLICATE` guard; feature `fetchForDuplicate`; target event choice is authorized separately. Duplication does not copy archival state. |
| `POST /:id/delete` | Native destructive action; redirect to dashboard | Owner guard; feature `deleteEntity`; header cleanup stays separate from archival. |
| `GET /:id/header` | Image file | Root lookup plus configured-directory containment and file-existence checks. Registered before the factory's detail-page admission middleware. |
| `GET /:id` | HTML detail page | Factory admission, feature `fetchForView`, shared archival and property projections. |

For linked entities, detail admission delegates to `canAccessEntityView` for the event context. For standalone detail
views, an absent active profile redirects to the feature's guest-entry page. Root permission metadata and admin data
are attached by shared middleware, but **this does not give surveys the peer features' general permission model**.
The [permission reference](../PERMISSIONS_REFERENCE.md) and survey decisions remain authoritative for that exception.

| Feature | Controller hooks | Creation and detail view owners |
|---|---|---|
| Survey | [surveyController](../../src/controller/surveyController.ts) | [survey-create](../../src/views/surveyor/survey-create.pug), [survey-vote](../../src/views/surveyor/survey-vote.pug) |
| Packing | [packingController](../../src/controller/packingController.ts) | [packing-create](../../src/views/packing/packing-create.pug), [packing-view](../../src/views/packing/packing-view.pug) |
| Drivers | [driversController](../../src/controller/driversController.ts) | [drivers-create](../../src/views/drivers/drivers-create.pug), [drivers-view](../../src/views/drivers/drivers-view.pug) |
| Activity | [activityController](../../src/controller/activityController.ts) | [activity-create](../../src/views/activity/activity-create.pug), [activity-view](../../src/views/activity/activity-view.pug) |
| Event | [eventController](../../src/controller/eventController.ts) | [event-create](../../src/views/event/event-create.pug), [event-view](../../src/views/event/event-view.pug) |

### Additional page, form, and export routes

| Method and path | Action, input, and output | Server guard/control |
|---|---|---|
| `POST /survey/:id/add-combination` | Native `weekday` and `nthWeek`; add combination; flash and redirect | Detail admission inherited from mounted factory; survey controller; any admitted participant may add combinations. No organizer-only restriction. |
| `POST /survey/:id/submit` | Native response fields; save answers; flash and redirect | Detail admission and session-profile survey controller checks. |
| `GET /activity/:id/export/schedule` | Render printable HTML schedule | Factory admission plus `DATA_EXPORT`; `getScheduleExport`; [schedule view](../../src/views/activity/export/schedule.pug). This route is not a PDF response. |
| `GET /event/:id/register` | Redirect to `/event/:id` | Factory admission; navigation alias rather than a separate registration page. |
| `GET /event/:id/admin` | HTML event administration | Factory admission plus `ACCESS_ADMIN`; shared event projection and property presentation; [dashboard view](../../src/views/event/event-dashboard.pug). |
| `GET /event/:id/export/participants` | PDF response | Factory admission plus `DATA_EXPORT` and `ACCESS_PARTICIPANTS`; event controller and [PDF module](../../src/modules/lib/pdf.ts). |
| `GET /event/:id/export/invoice-pools/:poolId/shares` | Saved-shares PDF attachment; query-selected export options; `no-store` | Session and `MANAGE_ASSIGNMENTS`; invoice controller checks event/pool and saved calculation; [invoice exports](../../src/modules/invoice/exports.ts). |

Survey POST failures are caught by its action wrapper, flashed, and redirected back to the survey. They are not JSON
validation responses. The explicit participant combination rule is recorded in
[DEC-001](../decisions/DEC-001-SURVEY-COMBINATION-AUTHORIZATION.md); survey creation's separate permission rule is in
[DEC-005](../decisions/DEC-005-SURVEY-CREATION-PERMISSIONS.md).

Event registration bypass links use `/event/:id?regToken=...`. The page router loads `regToken`, the event view renders
it into a hidden form field, and the browser submits it with attendance data. The actual URL builders are in
[reg-links](../../src/public/js/modules/reg-links.ts). The controller checks deadline eligibility and consumes a
single-use link in the same transaction as registration. Preserve the query through entry/navigation and do not
consume it merely because a SPA loaded or prefetched the page.

## Factory-expanded API routes

The following routes are registered by executable factories, so a scan of literal feature-router paths alone misses
them. The prefix is `/api/{feature}` with the applicability column defining the exact expansion.

| Methods and suffix | Applies to | Input/output and control owner |
|---|---|---|
| `POST /:id/admins` | Activity, packing, drivers, event | JSON `profileId` and `preset`/`perms`/`mask`; JSON result; `MANAGE_PERMISSIONS`; `addAdmin`. |
| `PATCH /:id/admins/:profileId` | Activity, packing, drivers, event | JSON `perms` or `mask`; JSON result; `MANAGE_PERMISSIONS`; `updateAdmin`. |
| `DELETE /:id/admins/:profileId` | Activity, packing, drivers, event | JSON result; `MANAGE_PERMISSIONS`; `removeAdmin`. |
| `POST /:id/archive` | All five | Validated empty body; JSON `{archive}`; controller-owned authority, survey owner exception. |
| `POST /:id/restore` | All five | Validated empty body; JSON `{archive}`; controller-owned authority and parent-event restrictions. |
| `POST /:id/archive/automation` | All five routes registered | JSON `{paused}`; JSON `{archive}`; controller allows only independently scheduled roots. Registration does not grant automation support to surveys, packing, or drivers. |
| `POST /:id/update` | Activity, packing, drivers, survey | JSON feature property patch; JSON result; `requireEntityPropertyUpdate` plus feature normalization/locked writes. Survey is owner-only. |
| `POST /:id/event` | Activity, packing, drivers | JSON `{eventId, expectedEventId}`; JSON reassociation/navigation result; controller checks old and new contexts under locks; activity invalidates recommendation context. |
| `PUT /:id/header` | All five | Multipart field `image`; JSON result; `EDIT_META` guard plus feature image handler. |
| `DELETE /:id/header` | All five | JSON result; `EDIT_META` guard plus feature image handler. |
| `POST /:id/assign` | Activity, packing, drivers | JSON `itemId`; JSON result; `ACCESS_VIEW`, session-profile identity, item-to-root scope, and feature policy. |
| `POST /:id/unassign` | Activity, packing, drivers | JSON `itemId`; same shared identity/scope guards and feature policy. |
| `POST /:id/take-role` | Activity | JSON `itemId`, `role`, optional overlap confirmation; JSON result; activity self-assignment authorization and binding-deadline rule. |
| `POST /:id/leave-role` | Activity | Same transport and activity authorization boundary as take-role. |

Sources: [admin/property/archive factory](../../src/middleware/adminApiFactory.ts),
[assignment factory](../../src/middleware/assignFlowFactory.ts),
[header factory](../../src/middleware/entityHeaderUpdateHandler.ts), and
[entity admin controller](../../src/controller/entityAdminController.ts).
For activity, ordinary assign/unassign also have activity self-assignment and binding-deadline checks. Packing/drivers
retain their own assignment/capacity rules. The shared assignment action derives `profileId` from the session through
[performAPIAction](../../src/modules/lib/util.ts), not from an arbitrary client-selected assignee.

Permanent deletion is absent from the archival factory. Its native owner-only page route remains separate. Event's
`POST /:id/update` is registered by the event API router rather than the shared property factory. Surveys have no
registered admin/default-permission or assignment-factory API routes.

## User and overview API

Source: [user API router](../../src/routes/api/users.ts), user controller, and user-search factory above.

| Method and path | Input/output | Control and browser owner |
|---|---|---|
| `POST /api/users/guest/email` | JSON `email`; success/error envelope indicating presence | Rate limited; guest-account lookup; [register-guest](../../src/public/js/register-guest.ts). Native guest creation/recovery remains a separate action. |
| `GET /api/users/search?q=...&limit=...` | JSON profile-search results | Rate-limited shared search; `searchUsers`/`searchUsersSecure`; [admin-matrix](../../src/public/js/modules/admin-matrix.ts). No explicit auth middleware is attached by this route factory. |
| `GET /api/users/overview` | Query-selected collection/region and namespaced navigation; JSON `{html, url, regionId}` | Controller authenticates user/guest and scopes membership; `private, no-store`; [entity-cards-overview](../../src/public/js/modules/entity-cards-overview.ts). HTML is rendered with [overview-region](../../src/views/users/overview-region.pug). |
| `POST /api/users/overview/:entityType/:id/visibility` | JSON personal visibility command; JSON updated state | Controller authenticates active profile; persistence checks current overview membership. Personal visibility does not archive or delete shared records. |

Overview navigation preserves normal anchor/form URLs as a no-script path. Its browser enhancement loads a bounded
region, checks the envelope and region identity, replaces Pug HTML, retains search focus/selection, updates history,
and offers retry after failure. A client data API must replace this HTML dependency while preserving the visible
behavior and the distinction between truly empty collections and filtered-out results.

## Packing and drivers API

Prefixes: `/api/packing` and `/api/drivers`. Both also register the applicable factory routes above.
Owners: [packing API](../../src/routes/api/packing.ts), [drivers API](../../src/routes/api/drivers.ts), their feature
controllers, [packing browser entry](../../src/public/js/packing.ts), [drivers browser entry](../../src/public/js/drivers.ts),
and [shared browser helpers](../../src/public/js/shared).

| Method and suffix | Input/action; output | Guard |
|---|---|---|
| `POST /:id/description` | JSON description patch; JSON result | `EDIT_DESC`; controller preserves authorized parent context during locked save. |
| `POST /:id/reorder` | JSON `orders`; reorder items; JSON result | `ITEM_EDIT`. |
| `POST /:id/items` | JSON item fields; quick-add; JSON result | `ITEM_ADD`. |
| `POST /:id/item/:itemId/description` | JSON description; JSON result | Item `EDIT_DESC`, parent fallback `ITEM_EDIT` or `ITEM_EDIT_DESC`. |
| `POST /:id/item/:itemId/attr` | JSON selected attribute/value; JSON result | Item `EDIT_META`, parent fallback `ITEM_EDIT`. |
| `POST /:id/assignment/:assignId/delete` | Delete assignment; JSON result | Item/assignment `MANAGE_ASSIGNMENTS` guard. |
| `POST /:id/settings` | JSON permission/default settings; JSON result | `MANAGE_PERMISSIONS`. |
| `POST /:id/item/:itemId/delete` | Delete item; JSON result | Item `ITEM_DELETE`, parent fallback `ITEM_DELETE`. |
| `POST /:id/item/:itemId/required` | Packing only: JSON `flag`; set required-by-all; JSON result | Item `EDIT_META`, parent fallback `ITEM_EDIT`. This route is not registered for drivers. |

The API does not expose a general JSON list-detail/items read replacing `fetchForView`; current initial state is
rendered into the Pug page. Shared DOM helpers perform commands, inline updates and reloads; they are not an
independent server-state cache or a complete data API.

## Activity API

Prefix: `/api/activity`. Owners: [activity API](../../src/routes/api/activity.ts),
[activity controller](../../src/controller/activityController.ts),
[activity browser modules](../../src/public/js/modules/activity), and
[recommendation jobs](../../src/modules/activity/recommendationJobs.ts). Factory routes above are also registered.
Every row returns JSON; automatic generation returns HTTP 202 with job/coalescing data.

| Method and suffix | Input/action; returned data | Guard |
|---|---|---|
| `POST /:id/description` | Description patch; message | `EDIT_DESC`. |
| `POST /:id/text-field` | New free-text field; `{id}` | `MANAGE_REQUIREMENTS`. |
| `POST /:id/text-field/:textFieldId` | Text-field edit; message | `ACCESS_VIEW`; controller applies field-level permission/content rules. |
| `POST /:id/text-field/:textFieldId/delete` | Delete text field; message | `MANAGE_REQUIREMENTS`. |
| `POST /:id/roles` | Add role(s); returned roles | `MANAGE_ASSIGNMENTS`. |
| `POST /:id/slot/:slotId/warnings` | Assignment-warning preview from body and actor context | `ACCESS_VIEW`; controller ownership/eligibility projection. |
| `GET /:id/requirements` | Requirements data | `MANAGE_REQUIREMENTS`. |
| `GET /:id/requirements/baseline` | Calculated baseline requirement | `MANAGE_REQUIREMENTS`. |
| `POST /:id/requirements` | Requirements body; save result | `MANAGE_REQUIREMENTS`. |
| `GET /:id/recommendations` | Recommendations and review context | `MANAGE_ASSIGNMENTS`. |
| `POST /:id/recommendations` | Review/draft edit body; message and warnings | `MANAGE_ASSIGNMENTS`; controller validates context and review rules. |
| `POST /:id/recommendations/warnings` | Warning preview for proposed recommendation operation | `MANAGE_ASSIGNMENTS`. |
| `POST /:id/recommendations/auto` | Queue generation; `{job, coalesced}` | `MANAGE_ASSIGNMENTS`; queue capacity/lifecycle checks; 202. |
| `GET /:id/recommendations/auto/:jobId` | Job status/result metadata | `MANAGE_ASSIGNMENTS`; controller scopes job to plan. |
| `POST /:id/recommendations/apply` | Apply body; applied/skipped counts and warnings | `MANAGE_ASSIGNMENTS`; locked controller decisions. |
| `POST /:id/slot/reorder` | JSON `order`; reorder slots | `ITEM_EDIT`; distinct payload key from packing/drivers. |
| `POST /:id/slot/add` | Quick-add slot body | `ITEM_ADD`. |
| `POST /:id/slot/:slotId/description` | Description patch | Item `EDIT_DESC`, parent fallback `ITEM_EDIT` or `ITEM_EDIT_DESC`. |
| `POST /:id/slot/:slotId/attr` | Attribute patch | Item `EDIT_META`, parent fallback `ITEM_EDIT` or `ITEM_EDIT_META`; controller receives permission bundle. |
| `POST /:id/assignment/:assignId/delete` | Delete assignment | Item/assignment `MANAGE_ASSIGNMENTS` guard. |
| `POST /:id/settings` | Permission/default settings | `MANAGE_PERMISSIONS`. |
| `POST /:id/slot/:slotId/delete` | Delete slot | Item `ITEM_DELETE`, parent fallback `ITEM_DELETE`. |
| `POST /:id/slot/:slotId/addRole` | Add role configuration to slot | Item `EDIT_META`, parent fallback `ITEM_EDIT`. |
| `POST /:id/slot/:slotId/roles/admin` | Manage role assignments | Item and parent `MANAGE_ASSIGNMENTS`. |

Self-assignment, role changes, overlap confirmation, binding deadlines, manual recommendation drafts, rejection
memory, generated jobs, stale results and bulk application are distinct commands. A generic CRUD replacement must
not collapse those semantics. The main activity projection still arrives through the HTML detail page.

## Event API

Prefix: `/api/event`. Owners: [event API](../../src/routes/api/event.ts),
[event controller](../../src/controller/eventController.ts), [events browser entry](../../src/public/js/events.ts),
[participant module](../../src/public/js/modules/event-participant.ts), and
[registration-link module](../../src/public/js/modules/reg-links.ts). Factory admin/archive/header routes also apply.

| Method and suffix | Input/action; output | Guard/control |
|---|---|---|
| `GET /link-options` | Query-filtered authorized event choices/cursor; JSON; `no-store` | Controller authenticates and applies event-link authorization; registered before `/:id` middleware. |
| `POST /:id/register` | Attendance, dietary fields, optional `regToken`; JSON result | `ACCESS_REGISTRATION`; controller enforces session profile, dates, deadline/update policy and one-time-token consumption. |
| `POST /:id/register/delete` | Cancel own registration; JSON result | Owner/event-participant route guard; controller resolves actor and cancellation policy. |
| `POST /:id/update` | Event settings/property body; JSON result | Controller uses attached permission bundle; this route does not have a separate `requirePermissionApi` wrapper. |
| `POST /:id/settings` | Default/permission settings; JSON result | `MANAGE_PERMISSIONS`. |
| `GET /:id/links` | Registration-bypass link rows; JSON | `MANAGE_REGISTRATIONS`. |
| `POST /:id/links` | Link options including optional expiry; JSON `{id, token}` | `MANAGE_REGISTRATIONS`; controller creates single-use bypass. |
| `DELETE /:id/links/:linkId` | Revoke link; JSON result | `MANAGE_REGISTRATIONS`; controller event scope. |
| `GET /:id/participants` | Participant rows and supporting summary data; JSON | `ACCESS_PARTICIPANTS`. |
| `DELETE /:id/registrations/:regId` | Delete registration; JSON result | `MANAGE_REGISTRATIONS`; controller event scope. |
| `PATCH /:id/registrations/:regId` | Attendance-date changes; JSON result | `MANAGE_REGISTRATIONS`; controller receives permission bundle and validates dates. |

There is no general JSON event-detail or invoice-pool collection read. Current event detail/admin pages provide
initial pool, capability and participation state; focused API reads refresh participants and links.

## Invoice-pool API

Prefix: `/api/event/:id/invoice-pools`. The nested router uses `mergeParams: true` and the event root loaded by its
parent. Owners: [invoice router](../../src/routes/api/eventInvoices.ts),
[eventPoolController](../../src/controller/eventPoolController.ts), [invoice modules](../../src/modules/invoice),
[events browser entry](../../src/public/js/events.ts), and
[participant invoice submission](../../src/public/js/modules/invoice-submission.ts).

Unless a row says otherwise, input is a JSON command body and output is a JSON envelope. **Manager** means the
event's `MANAGE_ASSIGNMENTS` route guard. **Event actor** means the owner/event-participant route guard; the invoice
controller still checks registration, pool membership, ownership, allowed status and event/pool scope.

| Method and suffix | Action/important input or output | Guard/control |
|---|---|---|
| `POST /` | Create pool; returns `{id}` | Manager. |
| `POST /:poolId` | Update pool settings | Manager. |
| `POST /:poolId/assignments` | Save pool allocation/member settings | Manager. |
| `POST /:poolId/submission-state` | Change participant submission access; `status`, `expectedRevision` | Manager; only allowed before financial closure; locked revision check. |
| `POST /:poolId/takeovers` | Save personal coverage responsibility | Event actor; controller applies actor-specific ownership. |
| `POST /:poolId/takeovers/manage` | Save manager-selected coverage responsibility | Manager. |
| `POST /:poolId/surcharges` | Add signed adjustment and its allocation options | Manager. |
| `POST /:poolId/surcharges/:surchargeId/delete` | Remove adjustment | Manager; pool scope. |
| `POST /:poolId/submit` | Multipart participant invoice, field `proof` | Event actor; participant ownership, required proof and submission-state checks. |
| `POST /:poolId/invoices/organizer` | Multipart organizer-entered invoice, optional `proof`/participant attribution; returns `{id}` | Explicit active profile plus manager; independent recorder audit and selected invoice owner. |
| `POST /:poolId/invoices/:invoiceId/approve` | Accept submitted invoice; body can carry corrections | Manager; controller/feature status checks. |
| `POST /:poolId/invoices/:invoiceId/close` | Organizer closure of invoice | Manager; controller checks actor and lifecycle. |
| `POST /:poolId/invoices/:invoiceId/close-self` | Submitter closure of invoice | Event actor; controller applies personal ownership rather than manager override. |
| `POST /:poolId/invoices/:invoiceId/decline` | Reject submitted invoice | Manager; controller/feature status checks. |
| `POST /:poolId/invoices/:invoiceId/revise` | Correct counted invoice; confirmation/revision fields | Explicit active profile plus manager; locked confirmation/revision/status rules. |
| `POST /:poolId/invoices/:invoiceId/reject-accepted` | Reject counted invoice while keeping history; confirmation/revision fields | Explicit active profile plus manager; locked confirmation/revision/status rules. |
| `POST /:poolId/invoices/:invoiceId/retract` | Retract own unreviewed submission; `confirmed`, `expectedRevision` | Explicit active profile; controller enforces submitter ownership and eligible state. No manager route guard substitutes for ownership. |
| `POST /:poolId/close` | Calculate and close; optional request revision/email settings | Manager; calculation is rechecked and committed under pool lock. |
| `POST /:poolId/recalculate` | Recalculate a closed pool; optional request revision/email settings | Manager; preserves settlement and saved-input rules. |
| `GET /:poolId/preview` | Read-only calculation preview; JSON; `no-store` | Manager; no implicit calculation commit. |
| `POST /:poolId/rollback` | Restore saved calculation inputs; returns recalculation/external-change state | Manager; preserve saved shares/payments and rollback policy. |
| `POST /:poolId/notify` | Request settlement emails; optional expected revision; delivery-request result | Manager; closed calculation and notification policy. |
| `POST /:poolId/shares/:shareId/pay` | Set `isPaid` for saved signed share | Manager; payment/refund meaning comes from authoritative saved balance; controller coordinates notification. |
| `GET /:poolId/invoices/:invoiceId/proof` | Proof file | Controller requires active profile, event/pool scope and submitter or manager access; path containment/file existence. |

Existing revision checks are feature-specific. A successful response does not mean that a background email was
delivered. Notifications occur after committed business changes, and retries must preserve those boundaries.
Participant invoice submission refreshes authoritative history through page navigation after confirmed success,
restoring the history hash and enclosing collapsed sections. There is no participant-history JSON read that a new
client can simply start calling.

## Transport, fallback, and SPA coverage gaps

| Boundary | Current behavior to preserve | Work required before replacing the legacy surface |
|---|---|---|
| Native forms | Account, profile, guest, creation and survey workflows post ordinary forms; validation may re-render or flash/redirect. | Expose equivalent typed commands/read models while preserving server entry links and intentional error recovery. Do not treat an existing JSON mutation as a replacement for its full page workflow. |
| Initial data and permissions | Detail/creation/admin Pug receives controller projections and permission data; many APIs return only messages after mutations. | Add complete authorized reads and explicit capabilities; keep controllers as policy owners. Define every existing command, including deliberate exceptions. |
| Fragments and reloads | Dashboard API wraps a Pug fragment; invoice commands refresh authoritative page state through reloads, preserving selected pool/history context. | Replace with typed data reads and shared client components; retain URL/history/focus/retry behavior. |
| Auth/session failure | Page redirects and global session validation can reach fetch callers; API failures otherwise use envelopes. | Make new API auth failures consistently machine-readable; preserve drafts and require explicit command success before refreshing/discarding input. |
| Multi-client writes | Locks and selected expected revisions already protect specific workflows; ordinary parent timestamps are not complete page revisions. | Define query refresh and command-conflict contracts, covering legacy writers during coexistence. Polling must not overwrite dirty forms. |
| Uploads | Create uses `headerImg`; header update uses `image`; invoices use `proof`; existing formats and limits are server-controlled. | Include multipart contracts, empty/optional-file semantics, cleanup and visible validation. Preserve the distinct field names until a versioned migration explicitly adapts them. |
| Downloads and printing | Header/proof/help images are files; event participant and share exports are PDF; activity schedule export is HTML. | Keep authorized binary endpoints and print layout, including saved-calculation export behavior; exclude these from SPA fallback. |
| Browser URLs | Query-selected dashboard regions, event context, `regToken`, token paths, help anchors and ordinary new-tab links are meaningful. | Preserve deep links, reload/back/forward and bookmark entry; mount SPA fallback only for migrated page routes. |
| Feature rollback | Existing controllers serve the legacy page and command families together. | Retain a coherent legacy route/UI option until each feature has equivalent reads, commands and observable behavior. This inventory does not establish a feature flag or rollback implementation. |

Header images accept JPEG/PNG/GIF; invoice proofs also accept PDF. The current per-file limit is 10 MiB, enforced by
[fileCommons](../../src/modules/lib/fileCommons.ts). The invoice proof controller separately checks access and
configured-directory containment in [proofs](../../src/modules/invoice/proofs.ts). These are existing transport
requirements, not new frontend policy.

No universal no-JavaScript completion claim is made: native forms and ordinary links coexist with controls that
require browser modules. Preserve the verified native fallback where it exists; assess each enhanced workflow in
the behavior inventory before removing its current route.

## Verification limits and follow-up

This inventory is based on source inspection of all feature route files and executable registration factories,
selected controller checks, native form actions, browser request consumers, and the canonical architecture,
development, permission, and documentation guidance. Methods and paths were reviewed as registrations, including
factory applicability and router mounts; a live Express stack was not enumerated.

The baseline still needs browser/request evidence for session expiry, no-script fallback, stale permissions,
multi-client conflicts, upload failure recovery, binary exports, one-time-link use, and identity-provider callbacks.
Route existence and the presence of a test file are not evidence that these flows passed in this environment.
Payload field-by-field contracts, status-code normalization, locale negotiation and cache/revision semantics belong
to the later contract-design step; they are not silently assumed by this inventory.
