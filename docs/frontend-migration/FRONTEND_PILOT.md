# Frontend foundation pilot
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-15
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: dynamic-page-only automatic document reload and confirmed-command follow-up contract reconciled with scoped client/build verification in paired review; excluded backend remedies stay deferred
source-anchors: docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md; src/routes/frontendPilot.ts; src/routes/api/v1/; src/controller/packingController.ts; src/frontend/; src/modules/frontendPilotRenderer.ts; src/modules/frontendDevelopment.ts; src/modules/api/; src/modules/localization/; contracts/api/v1/; package.json; vite.config.mts; tests/frontend/; tests/integration/; tests/e2e/
next-review: next-migration-slice-or-authorized-cutover
-->

The opt-in Vue pilot migrates Packing/Help and their necessary identity, overview and shared foundation journeys.
Native application routes remain available as the visual/behavioral reference. The comparator is
`2dfa2573c64178f54684cc4877b5a945f66e24c8`, subject only to explicit exceptions in the
[foundation decision ledger](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments).
This guide describes ownership and scope; the [paired review](PILOT_PARITY_REVIEW.md) owns
completed scoped acceptance and execution evidence, including its remaining limits.

## Migration boundary and current iteration

The original 2026-10-08 iteration requires complete Help/Packing and their entry/foundation behavior.
The 2026-10-14 P1 implementation adds profile editing, account profile listing/creation and existing switching (P1A),
profile-token issuance, entry, private preview and explicit transfer (P1B), profile deactivation and full/guest account
deletion (P1C), plus opt-in landing and common message/error presentation (P1D). The maintainer's
[parity-only clarification](FRONTEND_FOUNDATION_DESIGN.md#authorized-parity-only-migration-clarification-2026-10-14)
excludes existing backend remedies rather than making them prerequisites. Their backlog records remain open.
Overview and other scaffolds retain their remaining migration TODOs. Subsequent slices cover surveys, events,
activity plans, drivers lists and invoice pools. Implemented portions retain native behavior and maintainability
requirements; the paired review records actual scoped checks.

The maintainer's 2026-10-14 A2 correction supersedes P1's added profile field-edit/create transaction wrappers.
Their adapters now invoke the unchanged native operations and confirm with a simple prepared acknowledgement.
Session/roster display refresh remains separate from confirmed success; its Retry performs reads/navigation only.
Earlier registration/login/profile-switch atomicity and the exclusion of general backend remedies remain intact.

Preserve native UI/UX and business behavior except for explicitly approved changes. Native guide prose/images remain
the reference; approved reference cleanup does not import pilot behavior into production guidance. The optional
[profile](PROFILE.md) owns temporary rules and stages only changed guide sections/fragments. Unchanged guidance
comes from approved canonical guides; complete reviewed temporary output is prepared before cutover. General policies,
AI instructions, decision records and Help-authoring rules remain active. New localized pilot Help stays directly
in its runtime corpus. Default-route cutover requires separate authorization.

Packing business operations now share existing controller owners with removable native/v1 transport adapters and
central method permission definitions. Pilot action grants are independent of detail-page membership where native
policy permits the action; private metadata/access projections remain bounded. Creation, metadata, item/membership
writes and counters are shared, as are existing reorder/delete/default hooks and administration/event/image owners.
Transport normalization, feedback and conditional-write differences remain explicit. Final checks and the reproduced
coexistence lock defect belong to the paired review; this is no overall acceptance claim.
Existing permission inconsistency is tracked as `IMP-022`, rather than silently becoming new policy.
The exact duplicate URL after login is an explicitly approved native exception.

## Entry points and preserved journeys

| Pilot route family | Contract |
|---|---|
| `/frontend-pilot` | Bounded mixed overview; native membership, search and personal visibility; other feature destinations remain native until migrated. |
| `/frontend-pilot/home` | Explicit opt-in native-equivalent landing; captured quick-create suggestion, account/guest welcome and migrated Packing versus native remaining creation destinations. The Overview root stays unchanged. |
| `/frontend-pilot/message` | Admitted informational/command feedback; route query data cannot supply message authority. Common error presentation retains server-selected status and development-only diagnostics. |
| `/frontend-pilot/users/profile`, `/frontend-pilot/users/profile/manage`, `/frontend-pilot/users/profile/create` | Current profile editing for accounts/guests; account-only owned roster/creation and existing profile switching. Creation preserves the active profile. |
| `/frontend-pilot/users/profile/migrate/request`, `/frontend-pilot/users/profile/migrate/show`, `/frontend-pilot/users/profile/migrate/execute` | Native token issuance and explicit transfer retain document delivery. An explicit generated read-only POST previews the token while the mounted Vue form owns its draft/result; a fixed nonsecret fragment preserves Back/Forward without storing capabilities. The receiving active profile and former-owner cleanup rules stay unchanged; no stronger backend token/transaction guarantee is introduced. |
| `/frontend-pilot/users/profile/delete`, `/frontend-pilot/users/account/delete` | Native profile-name/username confirmations, account/guest distinctions, remaining-profile selection and provider/root logout destinations. Document delivery preserves existing error statuses and partial-failure behavior; it does not repair the excluded backend defects. |
| `/frontend-pilot/packing/create` | Account/profile admission, event preselection, initial items and optional image. |
| `/frontend-pilot/packing/<id>` | Authorized Packing detail; guest/event admission precedes page rendering. |
| `/frontend-pilot/packing/<id>/duplicate` | Existing duplicate permission/copy boundaries; rejected submission returns login to this exact duplicate destination. |
| Packing guest entry/recovery | Native fields, notices, title, canonical detail/success destinations and invalid-token outcomes. |
| Pilot login/register/recovery/reset | Existing account policy, return context and confirmed destinations; provider/token boundaries remain ordinary navigation. |
| `/frontend-pilot/help` | Complete localized read-only Help SSR, search, links and SPA hydration. |
| `/api/v1` | Generated JSON/multipart contract; existing controllers own policy and pure DBAL owns persistence. |

Inspect the route table and authored contract for exact paths. These families do not authorize a wildcard HTML
fallback for APIs, missing assets, tokens or exports. Privacy/imprint links keep their configured external
destinations; `/healthz` remains Express-owned.

Standalone Packing without an active profile enters its equivalent guest journey. Attached lists retain the existing
event-registration/effective-view policy. Duplicate GET permission is independent of account-only creation POST.
Invalid guest links and expired stored identity retain their native rejection/reauthentication presentation,
including provider logout evidence where applicable.

Confirmed guest registration navigates to canonical detail with its personal-link feedback. Confirmed recovery
uses its native message destination; unknown or pending commands retain input and recovery controls.
Login/account-only creation retains exact return context. Surveys' existing admission exception remains deliberate.

## Packing behavior

The Vue feature owns creation/duplication, metadata/settings, items and assignments independently of native browser
modules. It does not consume Pug fragments or delegate controls to the native Packing view.

Preserve inline item editing, quick add, drag ordering, Everyone switching, self-assignment and authorized removal of
another assignment. Settings have permission-filtered Details, Header image, Access, Event and Actions panels.
Each panel owns its independent draft/operation; permission matrices and administrators retain their existing rules.
Creation/duplication preserve native collectors, optional fields, validation, copy boundaries and image behavior.

The local Packed? checklist retains `packed_<list UUID>_<item UUID>` with value `1`. It remains personal browser state
rather than a profile-scoped server preference. Packing has no export or automatic-archival control to infer from peers.
Shared archival, personal hiding, hard deletion and file retention remain separate.

Native no-op actions remain available and use their operation-specific receipt without an empty write.
Known server validation clears passwords where native forms do; local validation or unusable delivery retains them.
Pristine metadata Save retains its informational outcome. Inline feedback preserves native placement, Close/focus and
fallback behavior; ordinary full flashes keep their own presentation.

## Logical owners

This table describes the implemented logical owners. The paired review records scoped acceptance and evidence
for the approved coexistence remedy.

| Owner | Responsibility |
|---|---|
| `contracts/api/v1/` | Authored operation shapes/policy; generated declarations and runtime validators are consumers. |
| Existing controllers | Shared operation checks, authorization and contextual errors; native/v1 transport adapters can retire independently. |
| Existing database services | Queries, locks, transactions and persistence, with controller callbacks for checks against locked data. |
| `src/frontend/app/` | Router, application/session scope, transport, query keys/cache and update coordination. |
| `src/frontend/features/<feature>/api.ts` | Feature operations, validators, dependencies and endpoint-specific policy. |
| `src/frontend/composables/` | Generic entry/read/navigation, draft/command/recovery, feedback and injected authorized-image lifetimes. |
| `src/frontend/components/` | Shared application controls with explicit props/events and accessibility ownership. |
| `src/modules/frontendPilotRenderer.ts` | Express manifests and request-local same-component Vue SSR. |
| `src/locales/<locale>.json` and shared translator | One discovered catalog per language, generated keys/parameters and i18next-vue integration. |
| `docs/user-guide/en/`, `docs/user-guide/de/` | Reviewed release-owned pilot articles/images; native Help keeps `docs/user-guide/`. |

Reuse these owners rather than adding wrappers, forwarding modules, validators, state stores or policy copies.
Shared type-only contracts are `.d.ts`. Comments explain nontrivial intent and boundary decisions; templates document
required data and browser hooks. Feature state travels through renderer `data` and explicit template arguments.

Reka owns shared dialog/tab focus and keyboard behavior. Mixed navigation/overview disclosures use the existing
`AppNavigationDropdown`: native details/Tab/embedded-control behavior, outside dismissal, Escape focus return and
shared placement. Public Reka menu/popover semantics do not fit that native interaction; this is the original
conditional primitive choice, not a technology amendment.

## Ownership and normal development

`npm run server` integrates the normal Express workflow with Vite middleware/HMR, the legacy browser watcher and
serialized authored contract/catalog regeneration. Express restarts only after generated consumers are complete.
Use the maintained `vite.config.mts` and project root explicitly; emitted config siblings must not take precedence.

The renderer transforms source entry/style URLs before inserting the rendered Vue tree. Express retains native
static/help ownership and Vite handles its `/app/` namespace. Transforming the full SSR document or rebasing URLs twice
can leave convincing but inactive HTML; verify the document's emitted URLs and real mounted controls.

`npm run build` generates contracts/catalogs, compiles Express/native assets, checks client/SSR Vue scopes and builds
separate client/SSR destinations. The release contains coherent artifacts and runtime SSR dependencies.
Production needs no Vite server or runtime schema compiler. Generated declarations, validators, locale resources
and `dist/` remain ignored. Exact scripts and dependency versions belong to executable package configuration.

The actual Express/Vite/SSR/HTTP module fixture lives in `tests/integration/frontend-development-runtime.spec.ts`.
Its exercised boundary needs no persistence, so the existing database-free Vitest project and `test:quick` selection
retain it without schema initialization. Source-development browser workflows remain separate integration evidence;
neither source fixture establishes built-application E2E. The [Testing amendments](staged/TESTING_GUIDE.md#frontend-compiler-and-build-scopes)
own runner details, while the [review](PILOT_PARITY_REVIEW.md) owns actual execution.

## Progressive loading (2026-10-08)

Refined Req6A adds the initial interactive skeleton until client initialization; the following data-loading policy
continues after that boundary. Overview waits for session bootstrap, then each active region loads independently in
parallel. Hidden regions start on opening. Unknown membership never renders zero/count/empty assertions; a ready region need not wait for a
slow sibling. Help retains complete server content.

`LoadingSkeleton` supplies shared field/table/card/article/line shapes, a localized status, responsive geometry and
reduced-motion behavior. Use it for client initialization or missing pending data. Background reads retain scoped
confirmed content and drafts; validated denial clears protected content. Lazy navigation can show shared progress without discarding work.

## Identity, refresh and edits

Query keys capture actor/profile/resource and meaningful filters; locale belongs only to language-owned projections.
Profile/logout/context changes retire private reads/cache, commands and authority. Late responses cannot restore
old scopes. Hidden tabs pause reads; focused/reconnected active views use the shared bounded retry/cooldown policy.

Healthy shared reads refresh every 30 seconds; ordinary eligible recovery targets roughly one minute while honoring
server deadlines. Explicit Retry observes its corresponding read and time boundary; it never submits a command.
Temporary failure retains readable data with its successful-read receipt/deadline in explicit UTC.
A fulfilled canceled observer refetch is not fresh authority; use the shared fresh-read continuation.

Drafts keep original/local/remote values separate. A confirmed command acknowledges submitted values; only the next
fresh admitted read grants a new baseline/token. Saved-plus-failed-refresh remains saved with blocked stale authority.
A same-actor session-read pause cannot turn a confirmed write into an obsolete result: retain its receipt and release
only the completed input while presenting the failed-refresh warning. Actual actor retirement still retires its result.
D2 compares touched current fields under locks, including useful setup fields, and preserves unrelated edits.
Native last-write request shapes remain unchanged; the shared controller adapts their distinct transport guarantees.

Unknown writes never replay automatically. Reconcile/recover reads can inform review but cannot prove an unknown
creation failed. Command state and draft protection can outlive retired editors. Whole-page deletion consent precedes
the write; confirmed navigation retains its destination/receipt through canceled or failed delivery.
Dialog close checks its own draft subtree; route/identity/release departures resolve the whole affected tree.

D5 replacement detection uses ordinary session refresh. Under the explicit 2026-10-15 amendment, automatic
full-document reload is limited to admitted dynamic Overview and Packing detail content; creation, duplication,
user-management, Help and static error/completion presentations are excluded. Eligible pages still require clean
drafts, no pending/unknown command and working loop protection. Compatible mounted edits may finish; missing lazy
chunks or incompatible commands preserve drafts and guarded deliberate recovery on every page. Periodic content
reads and session/security revalidation retain their existing contracts.

## Localization and native rendering

English/German UI/API text uses the same typed translator and request/application-local i18next-vue binding.
The current preference is a browser cookie; account/guest persistence and full email/PDF/Pug localization are future
work. Locale changes translate labels in place without replacing drafts, focus, selection, dialogs or machine values.

Pilot articles/images are reviewed runtime content under `docs/user-guide/<locale>/`, selected by the same catalog's
`help.directory`. Each language owns its content, stable anchors, search snippets, captions and raster assets.
Native English Help remains unchanged. Staged maintainer documents are never selected, searched, served or packaged
as runtime Help. Adding a language requires a complete catalog and generation. Complete localized Help is preferred;
missing corpora/articles/required figures select the complete reviewed English article with all its own assets,
visible localized disclosure and English navigation/search markers. The explicit Oct13 amendment supersedes the
earlier individual-figure fallback; authored local references and asset requests stay within one language.
The chosen interface locale remains selected and actual article language is explicit.
Unsafe existing translated content still fails validation. The direct decision is retained in the foundation ledger.

Read-only Help GET/search, article links and anchors work without JavaScript and hydrate the same Vue components.
Under the [refined Req6A delivery amendment](FRONTEND_FOUNDATION_DESIGN.md#authorized-interactive-startup-delivery-clarification-2026-10-13),
initial interactive Packing, Overview and identity/guest content uses shared skeletons until client initialization.
Genuinely functional static content/messages remain available; JavaScript-only shell controls wait for initialization.
Disabled JavaScript or failed loading/initialization exposes an independent localized JavaScript-required notice,
with no normal-looking dead controls or navigation. Existing mounted drafts and warm recovery behavior remain.
The eight unused interactive pilot POST fallback adapters retire while API commands, native/shared backend operations
and identity/capability/provider admission GETs remain. Actual adoption and current verification belong to the review;
SSR technology/build/dependencies remain, with no operative interactive fallback promised.

## Verification and further migration

Focused Help/frontend/type/build checks are recorded in the [review](PILOT_PARITY_REVIEW.md);
shared operations/method policy, approved coexistence locking and safe public-action parity are implemented. Final
execution evidence is owned by that review. Historical suite counts/captures do not
certify changed inputs. Report actual commands, source scope, failures and
unmet prerequisites; hosted CI, deployment replay and live providers/mail are separate claims.

Follow the [migration contribution handoff](FRONTEND_FOUNDATION_DESIGN.md#migration-contribution-handoff) for each next
slice, the [Testing amendments](staged/TESTING_GUIDE.md#risk-and-test-cost) and unchanged
[canonical assertion guidance](../TESTING_GUIDE.md#assertions-and-isolation) for unique detection value.
Preserve baseline IDs, native comparison and feature exceptions. Default-route cutover requires complete feature
parity and direct authorization. Reconcile the amendments and independently review complete temporary output before
verbatim cutover under the
[current staging amendment](FRONTEND_FOUNDATION_DESIGN.md#authorized-amendment-staging-and-risk-mitigation-2026-10-14);
production documents are not edited for migration. Documentation reports never gate application delivery.
