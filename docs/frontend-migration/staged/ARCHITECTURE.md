# Staged frontend architecture amendment
<!--
documentation-metadata
audience: maintainers; developers; migration reviewers
owner: application maintainers
status: migration-pending
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: implemented shared-operation/method-policy, request-local frontend and canonical Help boundaries; completed scoped execution and approved coexistence remedy tracked in review
source-anchors: src/controller/packingController.ts; src/modules/database/services/; src/frontend/; src/modules/frontendPilotRenderer.ts; src/modules/frontendDevelopment.ts; src/controller/helpController.ts; contracts/api/v1/; src/locales/; docs/ARCHITECTURE.md
next-review: frontend-production-cutover
canonical-merge-target: docs/ARCHITECTURE.md
production-reference: 2dfa257 native documentation; not evidence of the installed production commit
-->

## Cutover staging

This amendment supplies changed frontend sections for [Architecture](../../ARCHITECTURE.md).
Unchanged HTTP/session/domain/persistence/lifecycle guidance remains in that canonical owner.
At authorized cutover, reconcile intervening changes, merge this delta and remove the copy.
Native implementation/docs/assets remain the reference; staged resources are never application input.

The selected stack and dated amendments belong to [Foundation](../FRONTEND_FOUNDATION_DESIGN.md).
[Development](DEVELOPMENT.md#implementing-the-next-feature-slice) owns contribution steps;
[Pilot](../FRONTEND_PILOT.md) owns current route/build scope; the review owns acceptance.

## Versioned frontend boundary

`src/frontend/` contains the Vue application, router, shared components/composables and feature views.
TanStack Query owns authorized server snapshots; feature drafts own unsaved original/local/remote state.
Router owns durable navigation. There is no second server-data store or universal CRUD engine.
Bootstrap-compatible presentation preserves the native appearance; suitable Reka primitives supply complex focus/
keyboard behavior behind app-owned controls.

`contracts/api/v1/` is the authored wire schema. Generation emits shared `.d.ts` declarations and standalone
validators/operation metadata for browser/server. DTOs are deliberate projections, not serialized ORM/session/
permission objects. Request/server outputs are strict; browser responses permit compatible additive fields.

Catalog JSON supplies one discovered language definition, typed messages/parameters, shared resources and fixed
runtime Help directory. i18next-vue uses the same typed core with request/application-local state.

## Shared backend ownership

The implementation places shared business behavior and central method permission definitions inside existing
controllers. Native/v1 adapters retain operation-specific decoding/coercion, response/error presentation and
preconditions around those operations; either adapter can retire independently.
DBAL owns only queries, locks, transactions and persistence. Controller checks depending on locked state execute
as named callbacks inside those transactions.

Packing's `createEntity`, `savePackingMetadata`, `addPackingItem`, `applyPackingItemPatch`, `applyPackingMembership`
and `packingCounters` share native/v1 behavior; existing reorder/delete/default hooks accept coordinated managers.
`packingMethodPermissions` supplies native middleware, v1 checks and capabilities. Existing controllers also own
administrator domain outcomes, event attachment/parent privacy and archival projection; the existing image-swap owner
supplies a committed previous-image receipt. No parallel backend cleanup layer remains for these operations.
Completed scoped execution and the approved coexistence remedy belong to the review.

Page/read admission and independently granted action permission remain separate where native policy requires it.
The pilot must match native method policy without exposing private edit projections. Existing permission
inconsistency is tracked as `IMP-022`; preserve native behavior until a separately approved remedy.
UI visibility never authorizes a command. Native/v1 transport differences do not justify duplicated capacity,
ownership, permission or lifecycle decisions.

Shared archival, personal visibility, deletion and file retention retain their canonical owners.
The bounded archival deadlock repair is an explicit exception, not a broad transaction redesign.
Native/v1 coexistence changes require real scheduling evidence and unchanged business outcomes.

## Request-local SSR and progressive delivery

Express owns authentication, sessions, routing and explicit pilot document entry points. Every Vue SSR request
owns app, router, query cache, locale and scoped bootstrap; no renderer self-HTTP or shared private cache.
The browser hydrates the same tree. Bootstrap escapes script delimiters and exposes only authorized DTOs.

Help receives complete server content and supports native GET/search without JavaScript.
Interactive migrated pages require JavaScript and provide the approved shared message/read-only outcome when disabled.
Overview renders its session-authorized shell, then independently loads active collection/visibility regions.
Hidden regions begin on opening; slow siblings do not hold ready regions. Unknown membership never claims empty/counts.

Shared skeletons display missing pending data with localized status and reduced-motion behavior.
Background reads retain confirmed scoped content/drafts; validated denial clears private content.
Initial failure exposes error/retry. Language-owned bodies must match the selected locale.

## Shared read, draft and command contracts

Resource keys capture actor/profile/resource/filters and locale only for language-owned representations.
Late responses, stale SSR seeds and cache aliases cannot restore retired authority after context/permission changes.
Machine/user-authored data keeps one authority across locale changes; image reads inject a feature-owned operation.

Healthy shared reads use 30-second refresh and bounded eligible recovery, honoring Retry-After, hidden tabs,
cancellation and observer disposal. A successful admitted read supplies its scoped receipt.
Canceled observer refetch fulfillment with retained data is not fresh authority.

Drafts do not mutate query snapshots. D2 compares touched current fields under locks and preserves unrelated changes.
Financial/recommendation commands retain their specific revisions/reviews. Native last-write request shapes remain
unchanged; transport adapters use the shared business operation without adding native conflict fields.

Commands have confirmed, rejected and unknown outcomes. Confirmation acknowledges submitted values; only a later fresh
read restores current token/grants/baseline. Saved-plus-failed-read stays saved. Unknown delivery retains input and
review without automatic replay. Draft/command departure protection can outlive an editor; confirmed navigation
retains canonical destination and one-time receipt through failed delivery.

Generic controls receive values/capabilities/events/injected operations. They own presentation/accessibility,
not feature endpoints or business permission policy. Feature API/query owners select private dependencies.
Comments and `.d.ts` contracts explain these boundaries; renderer feature state uses `data` and explicit mixin arguments.

## Runtime Help sources

Native Help reads unchanged English `docs/user-guide/`.
The explicitly approved pilot runtime source is `docs/user-guide/en/` or `docs/user-guide/de/`,
selected through catalog `help.directory`. Each corpus owns articles, stable anchors, search and images.
No source selector reads `docs/frontend-migration/staged/`; that directory contains maintainer deltas only.

The existing Help controller owns discovery, trusted Markdown validation, TOC/search and asset containment.
Keep one renderer/security boundary and distinct native/pilot URLs; language-owned missing content is not borrowed
silently from another corpus. Missing translated articles/assets use reviewed English with the visible disclosure
defined in the [staged Help amendment](DOCUMENTATION_POLICY.md). Runtime Help remains reviewed release-shipped content
under DEC-004.
Opening an editor/upload/tenant/remote source requires a separate trust-model decision before implementation.

## Build and delivery

Express-hosted Vite middleware/HMR serves development while ordered contract/catalog regeneration coordinates restart.
Production loads coherent built server/client/SSR/contract/locale/Help artifacts, with no Vite development server.
Emitters have separate output directories; generated files remain ignored and production SSR dependencies are retained.

D5 supports current-folder replacement without retained old assets: session refresh detects updates, compatible
mounted edits may finish, and an idle clean view reloads once. Missing chunks/incompatible commands retain drafts.

Default routes/native browser consumers stay available until their complete feature migration and authorized cutover.
Remove an adapter/legacy entry only when its consumers have retired. Completed scoped source/build/browser evidence
and its limits belong to the [review](../PILOT_PARITY_REVIEW.md); documentation reports remain advisory.
