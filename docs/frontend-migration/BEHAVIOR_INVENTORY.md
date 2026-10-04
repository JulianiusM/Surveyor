# Frontend migration behavior inventory
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: current
last-verified: 2026-10-04
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: source-reviewed behavior baseline for existing Pug views, browser TypeScript, feature routes and controllers, and related test sources; records migration parity obligations and explicit feature exceptions; does not claim a migrated frontend, executed tests, or browser validation
source-anchors: src/views/; src/public/js/; src/routes/; src/controller/; src/modules/renderer.ts; src/modules/invoice/; src/modules/activity/; tests/frontend/; tests/integration/; tests/e2e/; docs/ARCHITECTURE.md; docs/DEVELOPMENT.md; docs/PERMISSIONS_REFERENCE.md; docs/TESTING_GUIDE.md; docs/user-guide/; docs/decisions/DEC-001-SURVEY-COMBINATION-AUTHORIZATION.md; docs/decisions/DEC-005-SURVEY-CREATION-PERMISSIONS.md
next-review: frontend-route-cutover-or-user-visible-contract-change
-->

This inventory records the current user-visible contract to carry through the frontend migration. IDs identify
behaviors, not implementation tasks or test results. Keep IDs stable when adding acceptance scenarios or mapping
replacement screens. A group of related controls can share an ID while retaining every state and ownership rule
listed in that row.

The [migration baseline](../FRONTEND_MIGRATION_BASELINE.md) owns the overall status and execution evidence.
The [route inventory](ROUTE_INVENTORY.md) owns HTTP paths and methods; the [test coverage review](TEST_COVERAGE.md)
owns coverage gaps. Implementation links below establish current behavior. Test links identify related existing
test sources, not proof that every row is covered or that any test was run for this document.

The [second-pass edge-case records](EDGE_CASES.md) expand these rows into concrete unusual states, intentional
exceptions and recovery requirements. Use their stable IDs alongside the behavior IDs during migration; a shared
component must not erase a feature-specific rule merely because its controls resemble another feature.

## How to read the delivery column

| Mark | Meaning in the current frontend |
|---|---|
| **N** | Native document link or form submission is present. This records transport, not a claim that every surrounding control works without JavaScript. |
| **J** | The operation or interactive control is implemented in browser JavaScript, usually using JSON requests. |
| **F** | A deliberate no-JavaScript fallback is visible in source. |
| **R** | The current success path refreshes or replaces a document/region. The successful outcome and preserved state matter; the reload itself can be replaced during migration. |
| **O** | A separate output, such as a downloadable PDF or print view, rather than a SPA interaction. |

These marks can appear together. In particular, an ordinary creation form can use **N + J** because JavaScript builds
its required input rows. Do not infer universal no-JavaScript support from server rendering. Conversely, do not remove
an explicit existing fallback as an incidental consequence of replacing a page.

## Shell, navigation and feedback

Sources: [layout](../../src/views/layout.pug), [home](../../src/views/index.pug),
[renderer](../../src/modules/renderer.ts), [navigation helpers](../../src/public/js/core/navigation.ts),
[alert lifecycle](../../src/public/js/shared/alerts.ts), [HTTP client](../../src/public/js/core/http.ts).
Related tests: [public pages](../../tests/e2e/public-availability.spec.ts),
[alert behavior](../../tests/frontend/alerts.spec.ts), [UI helpers](../../tests/frontend/ui-behaviors.spec.ts).

| ID | Observable behavior and actions | Variants and ownership to retain | Delivery |
|---|---|---|---|
| SHL-01 | Open Home, New, Overview and contextual Help; use feature creation links and footer links. | Existing URLs, titles, active feature indication, dark Bootstrap appearance, responsive navigation and configured imprint/privacy destinations. | N + J |
| SHL-02 | Read the current profile name and use account actions. | Signed-out, full-account and guest menus differ; guests are visibly identified. The active profile determines participation, ownership and overview data. | N + J |
| SHL-03 | Receive success, error, warning and progress feedback. | Transient alerts expire after ten seconds; persistent status/warnings and pending progress remain. Modal feedback stays inside its focus context. Preserve useful feedback after a successful operation. | N + J + R |
| SHL-04 | Follow a saved deep link or browser Back/Forward and return from authentication. | Path, query, fragment and permitted return destination are part of the journey; error and message pages remain understandable when a resource or session is unavailable. | N; J for enhanced overview history |
| SHL-05 | Receive confirmation that a command actually succeeded. | A followed login redirect yielding HTTP 200 HTML is not a successful JSON mutation. Preserve drafts on rejection/unconfirmed responses; server authorization remains authoritative. | J |

## Accounts, guests and profiles

Sources: [user routes](../../src/routes/users.ts), [guest routes](../../src/routes/guests.ts),
[user controller](../../src/controller/userController.ts), [guest-entry routing](../../src/middleware/guestFlowFactory.ts),
[account views](../../src/views/users/), [guest-entry behavior](../../src/public/js/register-guest.ts),
[password feedback](../../src/public/js/verify_password.ts).
Related tests: [authentication workflows](../../tests/integration/authentication-workflows.spec.ts),
[core smoke workflows](../../tests/e2e/core-workflows.spec.ts), [public pages](../../tests/e2e/public-availability.spec.ts).
Consult [Getting Started](../user-guide/GETTING_STARTED.md) and [configuration](../CONFIGURATION.md) for the intended
deployment variants. These integration tests do not establish complete browser coverage for profile management or an
external OIDC provider round trip.

| ID | Observable behavior and actions | Variants and ownership to retain | Delivery |
|---|---|---|---|
| ACC-01 | Register a local account and activate it with the emailed token. | Registration creates an initially inactive account with a usable profile; activation consumes its token. Password feedback and repeat-password checking accompany server validation. Local-login configuration controls availability. | N + J |
| ACC-02 | Log in with username or email and log out. | Correct/incorrect credentials, inactive accounts, configured authentication availability, current session and return navigation. Logging out must remove the previous private view context. | N |
| ACC-03 | Request a password reset, open the link and set a new password. | Recovery acknowledgement, invalid/consumed token and successful one-time reset; do not expose an account-existence result through the acknowledgement. | N |
| ACC-04 | Sign in through the configured organization provider. | Provider redirect/callback, account linking/provisioning and logout behavior remain server-controlled; local login can be disabled. External identity navigation is distinct from ordinary in-app navigation. | N |
| GST-01 | Enter a feature through Log in, Recover guest account, Create account or Continue as guest. | An active profile can proceed through its applicable admission rules. A new guest supplies a display name and optional email; the private editing link and recovery guidance remain visible. | N + J |
| GST-02 | Choose recovery or continue as a new guest when the entered email already has a guest account. | Browser choice dialog, optional email and the hidden recovery form are separate from plain guest form submission. Preserve the configured guest-entry confirmation and advice. | J + N |
| GST-03 | Restore a guest session with a private link or recovery email. | Several guest identities can share an email; each link selects its own identity. Invalid token, missing email recovery and return destination stay distinct. Private tokens must not become public card data. | N |
| PRF-01 | Edit the active profile. | Full accounts and guests retain their allowed profile fields. Profile identity is distinct from the account identity used to authenticate. | N |
| PRF-02 | Create and switch profiles on a full account. | Switch only among that account's eligible profiles; a switch changes the whole participation/permission context. Existing profile names and owned/participating resources must not leak between cached views. | N + R |
| PRF-03 | Obtain a migration token, preview the selected profile and transfer it to a full account. | Source profile, receiving account, token validation and explicit execute step remain separate. Preserve controller rules for the previous account/guest owner. | N |
| PRF-04 | Deactivate a profile or delete the current full/guest account. | Confirmation forms and server checks apply. Deactivation selects a remaining eligible profile where supported; account deletion and profile deactivation are different operations. | N + R |

## Personal overview

Sources: [dashboard](../../src/views/users/dashboard.pug),
[cards and region mixins](../../src/views/modules/module_unified_entity_cards.pug),
[overview browser module](../../src/public/js/modules/entity-cards-overview.ts),
[overview controller](../../src/controller/userController.ts),
[overview queries](../../src/modules/database/services/UserService.ts).
Related tests: [navigation](../../tests/frontend/entity-overview-navigation.spec.ts),
[cards](../../tests/frontend/entity-cards-overview.spec.ts), [database overview](../../tests/integration/entity-overview.spec.ts),
[browser overview](../../tests/e2e/entity-overview.spec.ts), [archive/visibility](../../tests/e2e/archival.spec.ts).

| ID | Observable behavior and actions | Variants and ownership to retain | Delivery |
|---|---|---|---|
| OVR-01 | Browse Your participation and administrable entities as independent collections. | Each collection has independent main and Archived and hidden regions. Active-profile membership determines inclusion; owning/administering an event does not invent participation in its children. | N + J |
| OVR-02 | Search, filter by type and page through bounded results. | Independent region URL parameters; preserve the current type on Enter/Search. Empty collection, no matching results and all items being hidden have different messages. Counts distinguish entities from displayed cards. | N + J + F + R |
| OVR-03 | Open an event card's linked entities and return to its overview position. | Group a child only when its event independently belongs to the same collection and region. Otherwise show the child itself. Parent context requires the appropriate event access; never widen child membership to all event attachments. | N + J + R |
| OVR-04 | Open and close Archived and hidden. | Lazy bounded loading, discarded hidden-region content, restored URL state and an ordinary Show archived and hidden link. A noscript type-filter GET form is deliberately supplied. | N + J + F + R |
| OVR-05 | Retry a failed navigation and use Back/Forward during searches. | Obsolete responses/retries cannot replace newer state; preserve other-region state, focused search selection, accessible result announcements and return focus/scroll. | J + R |
| OVR-06 | Open, duplicate, delete, hide/show or archive/restore from a card when permitted. | Owner-only card actions differ from delegated administration. Personal placement does not propagate from an event to children; shared event Things to do uses its own local filtering and ungrouped cards. | N + J + R |

## Shared settings, permission and lifecycle controls

Sources: [settings mixins](../../src/views/modules/module_entity_properties.pug),
[settings browser owner](../../src/public/js/modules/entity-properties.ts),
[settings controller](../../src/controller/entityAdminController.ts),
[permission controls](../../src/views/modules/module_admin_options.pug),
[event picker](../../src/public/js/modules/entity-select.ts), [time-zone picker](../../src/public/js/modules/timezone-select.ts),
[archive controls](../../src/views/modules/module_entity_archive.pug),
[archive policy](../../src/modules/archive/policy.ts), [permission reference](../PERMISSIONS_REFERENCE.md).
Related tests: [settings UI](../../tests/frontend/entity-properties.spec.ts),
[picker behavior](../../tests/frontend/entity-select.spec.ts), [permission matrix](../../tests/frontend/permission-matrix.spec.ts),
[settings persistence](../../tests/integration/entity-properties.spec.ts),
[permission workflows](../../tests/integration/permission-workflows.spec.ts),
[settings browser journeys](../../tests/e2e/entity-properties.spec.ts), [archival](../../tests/e2e/archival.spec.ts).

| ID | Observable behavior and actions | Variants and ownership to retain | Delivery |
|---|---|---|---|
| ENT-01 | Open Entity settings and edit permitted properties. | General, Linked event, Access and Actions appear only when usable. Field subsets follow server authority; property families expand independently. One property save is atomic and sends only changed authorized fields. | J + R |
| ENT-02 | Keep, save, reset or resolve separate section drafts. | Pending writes freeze relevant controls; rejection retains editable drafts. A successful context/permission-changing save refreshes all dependent presentation, not just one field. | J + R |
| ENT-03 | Link, change or remove the event of an activity plan, packing list or drivers list. | Paged authorized discovery; preserved selection outside search results; bounded cursor history; submitted destination reauthorized independently of query context; expected previous relationship checked. Surveys are excluded. | J + R |
| ENT-04 | Select a time zone and edit a local deadline. | Search, common zones, browser detection, aliases and UTC offsets; changing the zone and its displayed local deadline is coordinated, while unrelated property saves preserve the stored instant. | J |
| ENT-05 | Configure Group Permissions and named Administrators. | Cumulative public/guest/authenticated/participant/individual grants, presets, zero-mask revocation and independent audience drafts. Owner keeps full authority; a delegated administrator gets only granted actions. Survey exception remains. | J; native fields during applicable creation flows |
| ENT-06 | Edit an owned/delegated child item using its available controls. | Item-specific grants and action-specific parent fallbacks differ from root grants. An available administration page or visible UI is not blanket authorization. | J |
| ENT-07 | Add, replace or remove a header image. | Existing supported formats, upload validation, authorized resource scope and optional empty image state; survey image controls remain usable. | N during creation; J + R later |
| ENT-08 | Archive or restore shared entities and change supported automatic archival policy. | Peer features require effective metadata authority; surveys require ownership and do not gain unsupported automation. Parent archival affects linked children; restoring a child under an archived parent conflicts. Archive is not deletion, access revocation or a read-only mode. | J + R |
| ENT-09 | Hide or show an entity only for the active profile. | Server checks membership, uses session identity and keeps personal placement independent of shared archival and other profiles. Losing membership removes entitlement to the preference. | J + R |
| ENT-10 | Duplicate or permanently delete an entity through its authorized flow. | Duplication starts the relevant creation workflow; do not assume each feature copies every relation or history. Permanent deletion remains distinct from archive/restore and its confirmation. | N + J + R |

## Surveys

Sources: [creation view](../../src/views/surveyor/survey-create.pug),
[creation browser rows](../../src/public/js/survey-create.ts), [voting view](../../src/views/surveyor/survey-vote.pug),
[survey routes](../../src/routes/survey.ts), [controller](../../src/controller/surveyController.ts),
[collaborative combination decision](../decisions/DEC-001-SURVEY-COMBINATION-AUTHORIZATION.md),
[permission exception decision](../decisions/DEC-005-SURVEY-CREATION-PERMISSIONS.md).
Related tests: [survey workflows](../../tests/integration/survey-workflows.spec.ts),
[core creation smoke tests](../../tests/e2e/core-workflows.spec.ts),
[survey settings](../../tests/e2e/entity-properties.spec.ts).

| ID | Observable behavior and actions | Variants and ownership to retain | Delivery |
|---|---|---|---|
| SRV-01 | Create a survey with title, description, optional header and date combinations. | At least one combination; weekdays and positions 1, 2, 3, 4, LAST represent recurring monthly patterns, not concrete dates. Browser code creates the initial required row and add/remove controls. | N + J |
| SRV-02 | Choose Yes, Maybe or No and Submit the current ballot. | Missing answers initially display No; resubmission replaces that profile's prior ballot. Reject choices from a different survey. Full and guest profiles participate; ballots remain isolated. | N + R |
| SRV-03 | Read All answers. | One named profile row per participant; each combination remains a column, with missing response shown as no. Preserve the distinct no-answers state and table scrolling. | N |
| SRV-04 | Add new combination from the voting page. | Any participant who can open the survey, including a registered guest, can add it. This is deliberately not an owner-only or generic permission-controlled action. | N + R |
| SRV-05 | Manage survey properties, image, archive, duplication and deletion using its own rules. | Survey is standalone; owner-controlled management does not imply owner-only voting/combination creation. No Group Permissions or generic administrator setup is added to survey creation. | N + J + R |

## Events and registration

Sources: [event views](../../src/views/event/), [event browser owner](../../src/public/js/events.ts),
[participant module](../../src/public/js/modules/event-participant.ts),
[registration links](../../src/public/js/modules/reg-links.ts), [event routes](../../src/routes/event.ts),
[event controller](../../src/controller/eventController.ts), [event API](../../src/routes/api/event.ts).
Related tests: [event workflows](../../tests/integration/event-workflows.spec.ts),
[settings workflows](../../tests/e2e/entity-properties.spec.ts), [core creation](../../tests/e2e/core-workflows.spec.ts).

| ID | Observable behavior and actions | Variants and ownership to retain | Delivery |
|---|---|---|---|
| EVT-01 | Create an event with dates, location, description, optional image, capacity, dietary/deadline choices and sharing settings. | Validation preserves the intended field meanings; optional/unlimited capacity and time-zone handling remain aligned with the controller. | N + J |
| EVT-02 | Read event details and Save registration for the active profile. | Not registered/already registered/full; arrival/departure constraints; a repeated save updates rather than duplicates registration. Event ownership has its existing admission semantics. | J + R |
| EVT-03 | Enter or change meal preferences, allergies and additional diet comments. | Conditional fields follow event settings; unique dietary choices and their associated notes persist correctly. Date, diet and cancellation permissions after deadline are independently configurable. | J + R |
| EVT-04 | Change arrival/departure or cancel registration. | Deadline, capacity and registration policy are enforced server-side. Preserve confirmations, rejection feedback and permitted post-deadline variants. | J + R |
| EVT-05 | Use the administration dashboard and participant controls. | Access Admin, Access Participants and Manage Registrations are distinct grants. Search/filter, summary/date totals, participant details, date editing and removal retain authorized visibility. | N + J |
| EVT-06 | Create, list, copy and revoke late-registration links. | Token validity, permitted uses, expiry/usage presentation and consumption stay server-controlled; a bypass link does not become unrestricted event authority. | J |
| EVT-07 | Open linked activity, packing and drivers resources from Things to do. | Feature-specific membership/admission, local card filtering and authorized creation/reassociation remain distinct from dashboard grouping. | N + J |

## Packing lists and drivers lists

Sources: [packing view](../../src/views/packing/packing-view.pug), [packing browser behavior](../../src/public/js/packing.ts),
[drivers view](../../src/views/drivers/drivers-view.pug), [drivers browser behavior](../../src/public/js/drivers.ts),
[shared assignment controls](../../src/public/js/shared/entity-assign.ts),
[inline editing](../../src/public/js/shared/inline-edit.ts), [list actions](../../src/public/js/shared/list-actions.ts),
[reordering](../../src/public/js/shared/drag-drop.ts),
[packing controller](../../src/controller/packingController.ts), [drivers controller](../../src/controller/driversController.ts).
Related tests: [packing persistence](../../tests/integration/packing-workflows.spec.ts),
[drivers persistence](../../tests/integration/drivers-workflows.spec.ts),
[shared browser helpers](../../tests/frontend/core-dynamic-functions.spec.ts),
[core creation smoke tests](../../tests/e2e/core-workflows.spec.ts).

| ID | Observable behavior and actions | Variants and ownership to retain | Delivery |
|---|---|---|---|
| PCK-01 | Create a packing list with initial items, optional event/header and permissions. | At least one item and its ordered title/description/capacity values; standalone and event-linked entry differ. Dynamic item controls are part of creation. | N + J |
| PCK-02 | Take or Remove an item assignment and read assigned/max counts and names. | Duplicate assignment is idempotent; server capacity and linked-event admission apply. Organizer removal is separate from self-removal. | J + R |
| PCK-03 | Add new item, edit allowed cells, reorder or delete an item. | Item ownership/grants and parent fallbacks; inline edit save/cancel, capacity constraints, confirmation and updated summary counts. | J + R |
| PCK-04 | Mark an item Everyone. | Shared requirement bypasses individual assignments and sorts those rows before ordinary items. It is independent of whether a browser marks the item packed. | J + R |
| PCK-05 | Toggle Packed? and restore the checklist on return. | Browser-local storage uses list/item identity. It is not a server assignment, shared completion flag or account-synchronized state. Preserve existing keys/meaning when replacing the UI. | J; local only |
| DRV-01 | Create a drivers list and offer a ride using Add new item. | A row belongs to the offering profile; its profile name is the driver name. One driver can offer multiple journeys. Preserve optional event/header and sharing controls. | N + J |
| DRV-02 | Take or Remove a passenger place. | Capacity counts passengers; offering a ride does not automatically assign the driver or consume a passenger place. A passenger can join multiple rows; registration/admission and capacity remain enforced. | J + R |
| DRV-03 | Edit ride details/capacity, reorder, remove a passenger or delete a ride. | Ride ownership and specific delegated permissions determine actions. Preserve assignment names/counts, capacity validation and confirmation. | J + R |
| DRV-04 | Read list summary counts. | Ride authorship and passenger assignment are distinct; do not inflate passenger/participant counts by counting every driver as an assigned passenger. | N; refreshed after commands |

## Activity plans

Sources: [activity view](../../src/views/activity/activity-view.pug), [schedule parts](../../src/views/activity/parts/),
[activity browser modules](../../src/public/js/modules/activity/),
[activity controller](../../src/controller/activityController.ts), [activity API](../../src/routes/api/activity.ts),
[requirements](../../src/modules/activity/requirements.ts), [assignment engine](../../src/modules/activity/fairAssignment.ts),
[recommendation jobs](../../src/modules/activity/recommendationJobs.ts),
[activity guide](../user-guide/ACTIVITY_PLANS.md).
Related tests: [activity persistence](../../tests/integration/activity-workflows.spec.ts),
[interlinked-plan persistence](../../tests/integration/activity-plan-interlinking.spec.ts),
[context integrity](../../tests/integration/activity-property-integrity.spec.ts),
[coverage UI](../../tests/frontend/activity-requirement-coverage.spec.ts),
[warning UI](../../tests/frontend/activity-recommendation-warnings.spec.ts),
[browser confirmation](../../tests/e2e/activity-plan-interlinking.spec.ts),
[allocation logic](../../tests/unit/activity-auto-assignment.spec.ts).

| ID | Observable behavior and actions | Variants and ownership to retain | Delivery |
|---|---|---|---|
| ACT-01 | Create a dated plan and construct its slots. | Standalone or authorized event association, dynamic slot/date controls, optional roles/description/image and permitted sharing choices. Duplicate creation must retain the relevant source data without becoming a history clone. | N + J |
| ACT-02 | Read the schedule and switch All slots, My slots and Open slots. | Dates/times, role positions, counts, requirement progress and empty/full states; tabs and current context survive successful changes. | N + J |
| ACT-03 | Join/leave a whole slot or take/leave a named role. | General assignment and role assignment differ. Capacity, named-role availability, attendance, deadline, external sign-ups and overlap checks remain server-owned; permitted overfill has its explicit warning/action. | J + R |
| ACT-04 | Review assignment warnings and explicitly confirm an allowed overlap. | Cancellation keeps the draft/warnings without persisting; blocking warnings cannot be bypassed by the confirmation UI. A changed warning requires fresh review. | J |
| ACT-05 | Add/edit/delete/reorder slots and manage slot roles/assignees. | Titles/descriptions/dates/times/capacity and role quantities; item/parent permissions and role/assignment relationships remain intact. Preserve inline and modal editing behavior. | J + R |
| ACT-06 | Read and edit shared text fields. | These are shared plan data, distinct from local filter state; retain add/edit/remove controls, authorized access and text limits. | J + R |
| ACT-07 | Review participants and requirement progress. | Search and assigned/unassigned/status filters; attendance windows, complete/incomplete targets, Free-mode labels and authorized participant details. | N + J |
| ACT-08 | Configure Rules & auto-assign and Save requirement settings. | Advanced workflow requires an event-linked plan. Free/Required, binding deadline, capacity/external/arrival/departure switches, stay-duration table, rounding, role requirements and participant overrides keep their exact meanings. Calculate changes the draft; Save persists it. | J |
| ACT-09 | Check coverage while editing requirements. | Saved/Unsaved changes, incomplete configuration, exact/short/excess capacity, overfill policy and role quota states. Zero is a real target; override precedence is preserved. Coverage does not assign roles or prove timetable feasibility. | J |
| ACT-10 | Reload saved requirements or leave with a dirty requirement draft. | Existing discard confirmation must preserve a cancelled draft. Do not overwrite it with a background server refresh. | J |
| ACT-11 | Auto-generate recommendations and follow progress. | Saved complete Required-mode configuration, QUEUED/RUNNING/COMPLETE/FAILED/STALE outcomes. Generated proposals are not committed assignments. Bounded generation and rejection memory are retained; automatic generation does not fill/move named roles. | J; job polling |
| ACT-12 | Approve, reject, revert or remove a suggestion; stage assignment, unassignment, reassignment or swap. | Manual draft operations and generated pending rows remain distinguishable. Reassignment/swap sources stay in the same plan without named roles; swaps retain both legs. Row warnings remain visible while editing. | J |
| ACT-13 | Save changes and apply the reviewed batch. | Server rechecks the exact draft, overlap acknowledgement, availability and sources. Preserve Applied/skipped counts, retained warnings and review history. Required-over-Free exceptions do not silently remove the other plan's assignment. | J + R |
| ACT-14 | Relink/unlink the plan's event without losing unrelated work. | Context changes invalidate incompatible generated pending work/jobs while preserving committed assignments, manual drafts, overrides and review history according to existing controller/service rules. | J + R |

## Invoice pools, proofs and settlements

Sources: [invoice mixins](../../src/views/modules/module_invoice_pool.pug),
[invoice browser orchestration](../../src/public/js/events.ts),
[submission state machine](../../src/public/js/modules/invoice-submission.ts),
[takeover browser module](../../src/public/js/modules/invoice-takeovers.ts),
[invoice API](../../src/routes/api/eventInvoices.ts), [invoice feature modules](../../src/modules/invoice/),
[invoice guide](../user-guide/INVOICE_POOLS.md).
Related tests: [pool browser journeys](../../tests/e2e/invoice-pools.spec.ts),
[lifecycle browser journeys](../../tests/e2e/invoice-lifecycle.spec.ts),
[organizer expenses](../../tests/e2e/invoice-organizer-expenses.spec.ts),
[preview seam](../../tests/e2e/invoice-preview-seam.spec.ts),
[submission UI](../../tests/frontend/invoice-submission.spec.ts),
[admin UI](../../tests/frontend/invoice-admin-ui.spec.ts),
[calculation preview](../../tests/frontend/invoice-calculation-preview.spec.ts),
[takeover UI](../../tests/frontend/invoice-takeovers.spec.ts),
[invoice persistence](../../tests/integration/invoice-workflows.spec.ts),
[history changes](../../tests/integration/invoice-history-changes.spec.ts),
[organizer attribution](../../tests/integration/organizer-invoices.spec.ts),
[presentation](../../tests/unit/invoice-presentation.spec.ts).

| ID | Observable behavior and actions | Variants and ownership to retain | Delivery |
|---|---|---|---|
| INV-01 | Create and configure an invoice pool. | OPEN/Open for invoices and ORGANIZER_ONLY/Organizer invoices only are independent initial choices, with OPEN default. Preserve name/description, distribution, participants, factors, exemptions and adjustment settings. | J + R |
| INV-02 | Close participant invoices or Open participant invoices. | Reversible submission access before financial closure; confirm and check expected revision. CLOSED does not reopen participant submissions. No ordinary Delete pool or Reopen pool action is invented. | J + R |
| INV-03 | Submit an invoice with amount, description and proof. | Active profile must be registered, assigned/eligible for the pool and allowed to submit. Preserve pool choice, proof validation, pending lock, progress and repeat-submission workflow. | J + R |
| INV-04 | Recover from a slow, rejected or unconfirmed upload. | File transfer completion is not save confirmation. Definite rejection restores the draft; ambiguous delivery stays protected against duplicate submission and offers history inspection. Confirmed success clears only completed invoice inputs and retains applicable pool choice. | J + R |
| INV-05 | Read/search/filter/page participant invoice history and open proofs. | Participant sees their authorized history/proofs; awaiting review, accepted, rejected, closed and retracted remain distinct. Original/corrected values, recorder attribution and reasons are preserved. | N + J; proof output |
| INV-06 | Retract an awaiting-review invoice or Close an accepted invoice. | Retraction is restricted to its submitter and preserves history/proof; closing is restricted to its attributed participant or organizer. Closing an invoice neither removes its cost nor settles the participant's share. | J + R |
| INV-07 | Review invoices as organizer: Accept, correct before acceptance, Reject or Close. | Existing authorization, validation, reasons, original submitted data and review history; accepted and closed costs contribute to calculations, awaiting/rejected/retracted costs do not. | J + R |
| INV-08 | Correct or Reject from pool an accepted/closed invoice. | Explicit review/confirmation and captured pool revision; original evidence remains and current cost changes can require recalculation. Cancellation keeps the source dialog draft. | J + R |
| INV-09 | Add an organizer expense with optional participant attribution. | Pool-only expense and attributed participant expense have different credit/history/proof ownership. Recorder audit stays independent. Organizer expenses can be recorded in a closed pool without immediately changing saved shares. | J + R |
| INV-10 | Edit allocation inputs, participant flags/factors, exemptions, surcharges and rebates. | Per-form drafts/save boundaries; assign-all and individual selection; signed adjustments and their distribution modes. Saved changes in a closed pool mark recalculation needed while existing shares remain usable. | J + R |
| INV-11 | Manage takeovers and inspect who covers whom. | Participant edits only their allowed payer choices in an open pool; organizer scope differs. Applied closed-pool coverage is read-only and separate from pending inputs. Search, payer paging, beneficiary expansion and responsive relationships remain usable. | J + R |
| INV-12 | Preview the saved calculation and review its breakdown/example. | Unsaved allocation drafts prevent a meaningful preview; validate financial values and freeze the reviewed revision. Global contextual figures, optional anonymous example and concrete payer detail remain separate. Preview does not commit shares. | J |
| INV-13 | Close pool & calculate or Recalculate pool. | Confirm the reviewed revision; server controls arithmetic/rounding and one share per payer. Financial closure is permanent; recalculation carries recorded payments/refunds forward and preserves signed credit provenance. | J + R |
| INV-14 | Roll back pending pool changes. | Restore the existing saved calculation/input boundary without confusing rollback with reopening, deletion or reversing recorded transfers. Preserve existing notification behavior. | J + R |
| INV-15 | Read participant/organizer share ledgers and open Share breakdown. | Calculated signed balance, contextual amount-to-pay/collect/refund captions, settled/no-payment states, original notes, saved components and factual calculation steps. One reusable lazy detail dialog supports many rows/pools. | N + J |
| INV-16 | Search, filter, sort, page and Refresh list in share ledgers. | Keep the current action row stable after settlement; defer reordering/status filtering until refresh/control change. A filtered ledger highlights refresh after status changes; Refresh list acknowledges unchanged results too. | J |
| INV-17 | Record/reverse payment or refund status. | Confirm the intended signed saved share; update only after server confirmation. Pending locks, local button spinner and feedback outside moving rows protect repeated actions. Payments can still target saved amounts when recalculation is pending. | J |
| INV-18 | Read pool totals and pending-change notices. | Current source inputs and saved settlement totals are distinct. Preserve full/base cost context, invoice credits, prior settled credits, payment/refund signs, stale-calculation state, exemption/zero-weight explanations and applied-versus-pending coverage notices. | N + J |
| INV-19 | Choose calculation email delivery or Send settlement emails later. | Opt-in actions, named/eligible recipients, authorized saved state and explicit success feedback. Keep original notes before the calculation explanation; native email disclosure and full plain-text content are output behavior. | J + O |
| INV-20 | Access retained proof/history according to role and lifecycle. | Rejection/retraction/closing do not immediately delete the proof or audit history. Existing proof authorization, storage/retention policy and unavailable-proof outcome stay server-owned. | N + O |

## Help and separate outputs

Sources: [help view](../../src/views/help.pug), [help controller](../../src/controller/helpController.ts),
[help routes](../../src/routes/help.ts), [activity export route](../../src/routes/activity.ts),
[activity print view](../../src/views/activity/export/schedule.pug),
[event export routes](../../src/routes/event.ts), [PDF owner](../../src/modules/lib/pdf.ts),
[invoice exports](../../src/modules/invoice/exports.ts),
[settlement email](../../src/modules/invoice/settlementEmail.ts).
Related tests: [help fixtures](../../tests/unit/help-documentation.spec.ts),
[help browser journey](../../tests/e2e/help-experience.spec.ts),
[share PDF definition](../../tests/unit/invoice-shares-pdf.spec.ts),
[settlement email](../../tests/unit/invoice-settlement-email.spec.ts),
[email rendering](../../tests/unit/email-rendering.spec.ts).

| ID | Observable behavior and actions | Variants and ownership to retain | Delivery |
|---|---|---|---|
| HLP-01 | Open contextual Help, Help home, topic navigation and On this page links. | Current route-to-guide mapping, heading fragments, local visuals and readable desktop/mobile layout; guides are fixed release-shipped application content. | N |
| HLP-02 | Search help using a task/control label. | Native GET form, bounded query, empty/no-results/results states, topic/section title and excerpt, result links to useful headings. | N |
| HLP-03 | Render only the supported trusted help source. | Existing Markdown/URI/asset validation and fixed source boundary remain; a component must not turn uploaded or arbitrary remote HTML into trusted help. | Server validation + N |
| EXP-01 | Export schedule and Print/save it using the browser. | Requires Data Export. Preserve current title/dates/event/time-zone context, counts, descriptions/shared notes, assignments and named roles. This is a print-friendly HTML document in a new tab. | N + O; J Print button |
| EXP-02 | Export event participants. | Current route returns PDF with its existing combined export/participant-access permission check. Do not switch it to the unused similarly named Pug export template merely because that file exists. | N + O |
| EXP-03 | Export shares PDF with example or without example. | Manage Assignments and event/pool ownership checks; complete persisted share set regardless of browser filters; current settlement status and stale-calculation indication. The compact variant omits generated explanations/formulas while retaining factual numbers/notes. Export never recalculates or records payments. | N + O |
| EXP-04 | Read emailed activation/recovery/guest/invoice links and invoice explanations. | Existing destinations, recipient identity, HTML/plain-text alternatives and signed financial meaning remain valid across route cutovers. Shared frontend localization must not introduce divergent backend message meanings. | O + N |

PDF layout parity requires representative rendered exports, including long notes/names, negative balances and page
breaks. Definition-level tests alone do not establish that an output is readable. Execution and visual evidence belong
in the baseline record, not as implied success in this source inventory.

## Refresh, drafts and collaboration baseline

Sources: [HTTP helper](../../src/public/js/core/http.ts),
[overview sequencing](../../src/public/js/modules/entity-cards-overview.ts),
[picker sequencing](../../src/public/js/modules/entity-select.ts),
[recommendation review](../../src/public/js/modules/activity/activity-recommendations-schedule.ts),
[job polling](../../src/public/js/modules/activity/activity-recommendation-jobs.ts),
[invoice revisions and ledgers](../../src/public/js/events.ts).

| ID | Current observation or migration scenario | Baseline distinction |
|---|---|---|
| REF-01 | Successful AJAX commands commonly reload; overview navigation replaces bounded HTML fragments. | Reload removal must retain confirmed outcomes, permission/context refresh and preserved drafts/selection. Replacing transport is authorized migration scope; removing the outcome is not. |
| REF-02 | Read sequencing already rejects obsolete overview/picker/warning responses. | Preserve newest-request/draft identity after navigation, filtering and cancellation. A late response must not restore an old profile, region, query or review. |
| REF-03 | Invoice review/calculation captures a pool revision; event relinking captures the expected old relationship. | Keep these existing stale-write protections and the associated reviewed context. A generic refresh cannot replace the version that the user actually confirmed. |
| REF-04 | There is no app-wide periodic shared-data refresh mechanism in the reviewed browser modules. | The event timer updates a displayed deadline; recommendation polling follows one background job. Cross-client periodic refresh/conflict handling is a requested target capability, not an existing feature to claim verified. |
| REF-05 | Drafts, view controls and local packing checks have different ownership from shared server data. | Migration acceptance must exercise background updates during a dirty form, an open confirmation and a filtered ledger, without overwriting the draft or changing local checklist meaning. |
| REF-06 | Profile switching/authentication currently replaces the document. | The future client must clear/re-scope private cached data and permissions when identity changes, and discard outstanding reads from the previous context. This is a parity consequence of avoiding document reloads. |

## Source-review limits and unresolved observations

- **Native transport is not a blanket no-JavaScript guarantee.** The overview explicitly supports ordinary links,
  search and a noscript type filter. Survey voting and help search have native forms. Survey creation has a native
  multipart form but JavaScript builds its initially empty required combination table. Event registration and invoice
  forms rely on browser handlers. Record these separately in migration reviews; no disabled-JavaScript browser run is
  claimed here.
- **Test names are not product contracts.** The core smoke test named “creates an event-scoped survey” passes an
  event query parameter but checks creation/content, not a persisted survey-event relationship. Survey creation's
  controller does not create that relationship; the standalone survey exception controls this inventory. Likewise,
  some drivers persistence tests call assignments “volunteers”; the visible workflow is passenger places.
- **Present files are not necessarily live surfaces.** The event participants export route returns PDF and leaves
  the old Pug rendering call commented out. Route evidence controls EXP-02.
- **Source references are not exhaustive validation.** No claim is made that every role/state combination is already
  tested. In particular, profile lifecycle/OIDC browser flows, disabled-JavaScript behavior and general two-client
  conflict scenarios need explicit coverage review. The linked test review separates existing checks from missing ones.
- **Known migration changes need their own acceptance scenarios.** Periodic refresh, conflict UX, a versioned API and
  application-wide localization are requested future capabilities. Existing invoice wording already uses a shared
  catalog, but that does not establish application-wide localization today. Preserve feature meaning and server
  authority while adding those capabilities.

This document is advisory migration-control material. It does not add a documentation gate to application CI,
review, merge, release or deployment, and does not authorize changing the feature contracts it records.
