# Staged frontend architecture amendments
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-23
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: approved composition, first-attempt consent and Overview write-freshness ownership reconciled with full-application navigation and shared frontend/backend boundaries; no publication or new execution claim
source-anchors: docs/frontend-migration/documentation-boundary.json; docs/frontend-migration/check-documentation-boundary.mjs; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; src/frontend/; contracts/api/v1/; scripts/generate-api.mjs; src/modules/api/transport.ts; src/modules/api/session.ts; src/modules/lib/session.ts; src/modules/lib/frontendSession.ts; src/modules/localization/translator.ts; src/routes/api/v1.ts; vitest.config.mts; package.json; src/types/IdentityTypes.d.ts; src/types/FrontendPilotUiTypes.d.ts; src/modules/lib/civilDate.ts; src/types/CivilDateTypes.d.ts
next-review: next-authorized-migration-slice-or-cutover
-->

These amendments retain the reviewed frontend guidance without copying unchanged production procedures.
The [profile](../PROFILE.md) governs preparation and review; its [manifest](../documentation-boundary.json)
owns destination mapping and exact operations. Payload links use their mapped production location.
Surrounding notes use this file's location. Preparing complete temporary output does not authorize cutover.

## Request-local rendering and initialization / Shared contracts, state and commands — amendment-01

<!-- delta:amendment-01 -->
### Request-local rendering and initialization

`src/frontend/app/createApp.ts` constructs the same Vue tree for server rendering and browser hydration.
`src/modules/frontendPilotRenderer.ts` is the existing Express renderer owner; it supplies authorized bootstrap data
and coherent built manifest assets without making HTTP calls to its own application. Each request owns its app,
router, QueryClient, locale instance and bootstrap. Private state never lives in a module singleton or persisted cache.

`serializeBootstrap.ts` escapes inert script-element JSON; `decodeBootstrap` validates every declared field before
reactive state is created. Feature validators load with their view. Shared type-only contracts remain `.d.ts` files.
Interactive initial content shows a shared page-family skeleton until client initialization succeeds. Route metadata
selects its decorative composition; scoped missing-data regions reuse the same field/card/table primitives inside
their existing layout. Presentation never reads private data, admits a command or invents actual record counts.
Readable results and Help retain genuinely functional static HTML, GET search, links and anchors. JavaScript-dependent
shell controls wait for initialization; an independent localized notice covers disabled, missing or failed JavaScript. Initial Vue error
capture covers setup, mount and the first readiness render; later feature failures retain their existing owners.

`mountPreservingDrafts` retains early edits on original admitted controls, with explicit opt-in for non-text/file
inputs. Startup protection exists before route loading and transfers to mounted owners after restoration. Automatic
reload additionally requires explicitly eligible dynamic route/content, clean state and a working loop marker.
Overview, Packing/Drivers/Survey/Activity detail and Event detail/admin opt in. Creation, duplication, user-management, Help and
static admitted errors/completions remain excluded. Route metadata and the existing content classifier feed the shared update owner without copied
field policy. The context consumes actor/visit-bound static predicates from mounted `usePageEntry` owners without
mirroring query data. Initial-bootstrap retirement does not retire a visible denial; fresh admission restores dynamic
eligibility, and owner/actor disposal releases classification. App, SSR and automatic recovery share this result.
Deliberate recovery retains draft consent and pending/unknown guards on every page. Recovery never
persists secrets/files or replays writes. Session/security revalidation and scoped reads remain separate.

### Shared contracts, state and commands

`contracts/api/v1/` owns wire schemas and operation policy. Generation emits declaration contracts and standalone
runtime validators; no second handwritten wire schema or runtime schema compilation exists. Transport adapters decode
and present around the same controller business owners. Page admission, method grants and private projections remain
separate; reusable controls never grant authority.

Express's ordinary `req.session` is the single request Session. Admission checks current stored generation without
adopting another snapshot; its plain hydrated actor captures identity for the operation. Initial session projection
and public rendering without feedback create no anonymous row/cookie and return null context/CSRF where none exists.
Existing authenticated records can project bounded legacy metadata without a write; explicit identity transitions retain their existing
completion owner. Browser claims/epochs/capabilities never grant authority. Controllers and stored server identity
remain authoritative, including public grant-only methods without an invented anonymous principal. An intentional
account-required document redirect retains native anonymous Session/flash persistence and one-time consumption,
without a URL notice or metadata initialization. Ordinary saves and native expiry/provider effects retain their
owners. The [Development guidance](DEVELOPMENT.md#backend-and-method-policy-contracts) describes these boundaries.

The [Development contract guidance](DEVELOPMENT.md#contract-authoring-and-generated-consumers) owns supported
schema/transport styles, strict generated validation and released-version compatibility. The shared translator and
catalogs currently serve UI/API text and reviewed Help; language preference is a browser cookie. Grammar supports
plain text/cardinal plurals and declared, validated component placeholders through the shared RichMessage owner;
scalar values stay escaped text and catalogs cannot supply HTML. Principal-language persistence and full localization
of email, PDF and other invoice output remain intended
future decisions in [DEC-006](decisions/DEC-006-FRONTEND-FRAMEWORK.md#deferred-localization-and-domain-integration-targets),
without an implemented production capability.

TanStack Query owns authorized snapshots; feature or shared interaction drafts own original/local/current values and Router owns URL state.
`app/queryKeys.ts` names actor/resource/filter families, adding locale only for translated representations.
`app/context.ts` coordinates identity generations, session admission, language and updates without another data store.
Ordinary session recovery pauses dispatch while readable content/drafts remain; actual actor retirement and validated
resource denial retire protected state. `useQueryAdmission` keeps each observer's eligibility bound to its logical key.
A canceled refetch or manual cache alias is not a fresh receipt; shared fresh-read helpers distinguish actual success.
`EntityEntryPage` dispatches denial retirement through that shared cache owner. Packing, Event, Drivers, Survey and Activity select
the affected query families; inactive copies retire without discarding a live creation draft. The producing admission family
survives inactive-family removal even when initialization or session revalidation pauses its observer, because that
query still owns the displayed denial. The shared component infers no feature permissions or query-key positions.

Healthy active shared reads use 30-second polling and bounded recovery, honoring Retry-After, hidden tabs and disposal.
Closed regions do not poll. Locale changes retire translated families only. `MetadataDraft` applies feature normalization
to dirty comparison and sparse submission; touched-current-value comparisons occur under existing locks. Finance
revisions and recommendation fingerprints retain their separate semantics. Confirmation acknowledges submitted values;
only a fresh admitted read restores tokens/grants. Failed follow-up remains saved; unknown delivery retains input and
explicit review without automatic replay.
A same-actor read pause does not retire a confirmed command. Preserve its returned result and failed-refresh warning
so the feature can release completed input; actual captured-actor retirement still retires the result.

Overview additionally derives the current Query's actual invalidation state through the shared query-cache owner.
Its region/card consumers pause archive, restore, automation, personal visibility and Delete controls/dispatch while
retaining readable cards and existing navigation/filter/paging/expansion/Refresh admission. This write-only boundary
also applies to failed background reads and locale invalidation, including prolonged recovery, without another
freshness store or deleted-entity registry.

`command.ts`, `pageEntry.ts` and `feedback.ts` share status, departure protection, canonical delivery and receipt-owned
messages. Pending/unknown status may outlive an editor without retaining its fields. Confirmed navigation retries
only its required reads and destination delivery, never the confirmed command. The frontend feedback owner manages
transient notice scheduling/cancellation; persistent conditions remain visible.

`useEntityRemoval` retains original whole-page discard approval only through the first delivery attempt. Later Retry
or another departure consults the same root draft guard again, including newer sibling edits or earlier unchanged
drafts. A failed delivery retains the confirmed result and selected-read/navigation receipt independently of consent.

`observePageNavigation` shares router subscriptions, latest pending destination and disposal across App, Header,
Overview and page-entry/confirmed-transition consumers, retaining each caller's URL boundary and callbacks.
The same navigation module coordinates Router scrolling with a mounted page's reactive render readiness. Help
exposes its existing admitted read/error and destination; Router remains the only anchor/history scroll owner.
This registration holds no article payload, query state or saved-position copy and cannot trigger a read.
Controls and feature drafts share an explicit value lifetime, including file release after confirmation.
`CommandFeedback` shares command receipt presentation across actual identity, Packing, Event, Drivers, Survey, Activity and Overview consumers;
`StatusNotice` presents actions with optional injected state and emits actions. Omitting state retains shared
`ActionButton` initialization and caller-handler guards. Features retain wording and recovery operations; durable
conditions remain in their meaningful context and transient notifications use the common page/dialog scope below.
These controls introduce no second receipt, query or draft owner.
`command.reconcileSafely` is the deliberate UI recovery boundary; causal command dependencies retain rejecting
fresh reads. `useSettingsAccessRetirement` shares selected editor-cache retirement and scoped recovery across all
five detail Settings consumers. Event admission/detail share one intent-specific denial-family selection, preserving
independent method grants and the producing observer's error/recovery state. Existing API transport functions share
upload completion, multipart decoding and confined stored-binary delivery across the five feature adapters; feature
admission, parser policy, cleanup and business operations remain with their existing owners.

Transient command notifications share page/dialog hosts supplied by `App` and `AppDialog`. Their sticky zero-height
anchor and bounded overlay stack preserve content position without focusing a notice or scrolling the document.
The injected `noticeTargetKey` is a read-only presentation reference, not query, draft or authority state.
`CommandFeedback` chooses shared notification presentation; `StatusNotice` owns rendering, expiry, renewal,
dismissal and diagnostics. Durable validation/recovery stays contextual. Features do not recreate notice placement.
`composables/entityLifecycle.ts` supplies `createEntityLifecycle` to Settings, Overview and Event Things to do through
their existing API, command and current translator. It shares archive/restore confirmation, desired-state dispatch and
success wording. Settings, Overview and the Event child adapter share its pause/resume operation where the admitted
projection exposes an independent schedule; linked Activity has no independent automatic controls. Pause is immediate,
and resume asks for the existing elapsed-schedule confirmation. Callers retain eligibility, wording and refresh
lifetimes; the helper adds no state or backend business policy.

Event, Packing, Drivers, Survey and Activity detail adopt one displayed `EntityHeader`. Features supply the admitted title/icon, optional parent
URL, image operation/version/query key and settings availability. The header preserves the 250px cover image and
responsive parent tracks; Event's dashboard heading remains separate. It composes `useAuthorizedImage` and actual
successful query receipts. Receipt recovery waits for current props after rendering and checks the same resource/key
before consulting the image owner, so an admitted removal cannot recover old bytes. Parent destinations and feature
authority remain unchanged. Image upload editing remains the distinct `EntityHeaderEditor` responsibility.

`FormField` owns matching text/textarea labels and native controls. `FileField` composes its label/control slot for
creation and header-editing choosers, while the feature retains selected bytes, admission and command lifetime.
`EntityDescription` renders escaped read-only lines for Packing, Drivers, Surveys, Event and Activity. Explicit paragraph
hooks/classes and the optional native divider preserve list geometry; Event keeps its own labeled column and ordinary
paragraph margins. `EntityQuickAdd` shares Packing/Drivers card, description/capacity controls and submit layout while
features supply their distinct title controls, values and commands. The installed native number directive retains
coercion and DOM updates, including leading-zero normalization on change/rerender; feature drafts still hold a number
or remaining input text. No shared control stores another draft or grants authority.
`FormField` preserves native composition/caret handling, with an explicit lexical-number path for string drafts
and the existing native directive for intentional numeric normalization. Feature-owned parsing, constraints,
readonly state and explicit label content retain their existing meaning. The transport's
`createMultipartForm` shares creation/header serialization across all five entity features and the same Finance
proof envelope with an explicitly named binary part. It selects no operation, validates no second schema and
copies no file lifetime; required versus optional images/proofs remain with the feature.
The existing `usePageTitle` owner accepts catalog-owned complete journey titles when native prefixes or branding
differ from visible headings. SSR, initial hydration, warm navigation and locale changes consume that same owner.

Packing, Event, Drivers, Survey and Activity adopt `EntityEntryPage` for admission presentation, `EntitySettingsDialog` for settings composition
and `EntityMetadataEditor` for metadata draft/command reconciliation. Packing, Event, Drivers and Activity additionally adopt
`EntityAccessEditor` for audience/administrator interaction; standalone Surveys supply no Access operations.
Generated feature APIs, query families, field controls and normalization remain injected. Lower controls
and declaration contracts retain explicit data/events rather than infer feature authority. The shared identity
`GuestEntryPage` owns name/email, advisory lookup and confirmed/unknown identity completion for all five resource types;
each feature supplies its read, registration operation and exact return destination.
Their metadata field adapters expose the same mounted editor through `useMetadataEditorHandle`; its derived
flags and methods retain one underlying draft/command owner. Their nullable text fields use the existing
`metadataDraft.ts` normalizer, while Event capacity and deadline semantics remain feature-owned.

Event reads separate detail/admin intent, participant roster, link management, metadata and settings projections under
their existing grants. Detail includes own attendance and counts, with only a bounded invoice-presence flag; it does
not disclose a roster or finance aggregate. Registration alone spends a supplied bypass token. Event creation and
duplication use the ordinary generated multipart command and shared Vue creation/navigation owners, preserving
native preprocessing, upload, creation and permission initialization in their existing order. Event creation and the
`EntityListCreation` used by Packing, Drivers and Activity adopt `useCreationCommand`; Settings, Overview and Event-child deletion
adopt `useEntityRemoval`. Packing/Drivers also share `BasicEntityMetadataFields`, `useListDetail`, `useListReorder`,
`EntityAssignees` and `EntityAssignmentActions`, retaining Packing's checklist/Everyone behavior and Drivers' distinct
driver/passenger meanings in their feature owners. Activity also adopts `EntityAssignees`; its remove-control slot
preserves native spacing and data hooks under the shared disclosed-identity guard. `AppTabList` shares native tab
keyboard behavior and Reka focus ownership across Settings and Activity, while feature panels retain their lifetimes.
`AppAccordionButton` shares trigger presentation and initialized activation across matching Event, Overview and
administrator disclosures without owning open panels or reads. These shared Vue owners compose existing
command/consent/confirmed-navigation lifetimes, while features retain their fields and
generated operations. Packing/Drivers/Survey/Activity compose `useListCommands` from the existing detail-read owner for
cooldowns, explicit stale recovery, guarded post-command refresh and deliberate unknown-creation review. Features
inject their actual fresh read and dirty policy, including Survey's ballot merge; Packing/Drivers/Activity opt into their
common permission wording and shared denial notifications. The composition keeps no second snapshot/draft and never repeats a mutation.
`EntityListCounters` shares Packing/Drivers' admitted counter panel; `EntityListToolbar` supplies integrated Refresh
to list/Activity details, Event detail/admin, Help, profile administration and profile workflows through each existing read owner.
Features retain admitted projections, cooldown and dirty-value policy; creation/static content invents no read.
`EntityDetailReadState` shares the list details' denied/stale/cold fragment and skeleton through explicit
state/timestamp props and a Survey Refresh slot; it owns no query or authority. `CommandFeedback`'s optional creation
review descriptor shares the unknown-creation paragraph/button while features retain eligibility, wording, margins
and the existing review operation.

Activity's basic components own dated slot drafts, local filters and warning-review intent. Existing `InlineCell`
owns inline values, comparison and conflict recovery; optional tag/multiline inputs change presentation only.
Its Enter/Ctrl+Enter handler leaves active text composition to the browser before preventing any default or saving.
Activity's distinct role input applies that same composition boundary before selecting/creating a role. Ordinary
shortcuts, blur and mouse actions retain their existing owners; the native reference remains unchanged.
Active description flags retain that same editor through a remote empty value, and slot modals retain opening fields
while current permission loss disables submission. Native client admission remains separate from server method grants.
The schedule badge derives the complete saved-slot total independently of local filters. One pure browser-safe
`civilDate.ts` owner supplies Activity creation and versioned detail weeks, plus matching Event/Activity date-only
display. Its structural declaration lives under `src/types/`; UTC calendar stepping and explicit UTC formatting
preserve the saved day while the selected locale controls wording. This approved presentation correction replaces
the original separate native browser/server algorithms without changing persistence, business calculations, native
rendering, printable output or instant/deadline ownership.

`ActivityRequirements` owns its lexical settings draft and saved calculation context. It composes the existing
`ActivityParticipants` presentation with unsaved results from the shared pure requirements engine; ordinary reads
cannot overwrite dirty controls. Engine inputs are structural values, and the shared `RoundingMode` declaration
keeps browser compilation independent of ORM entity metadata without changing the database column or algorithm.
`ActivityRecommendations` owns local review rows, exact submitted batches and domain-job identity. Its schedule
and manual editor share feature presentation, while `ActivityWarnings` and the established dialog/command owners
retain warning acknowledgement, pending locks and recovery. Server snapshots remain in Query.

Recommendation entry, explicit Reload, explicit generation completion and confirmed application retain the native
maintenance invocations through a deliberate command. Recovery uses a pure snapshot; job polling observes only
the captured domain job. Neither read path maintains rows or enqueues work. The existing Activity controller and
engines retain eligibility, provenance, reciprocal moves, collision privacy, application and inherited completion
behavior. Versioned projections select scalars, including former-participant override labels, and omit raw job diagnostics.

Versioned reads and guest identity completion cannot create an Event; the adapter does not strengthen inherited multi-step creation
finality. Ordinary profile workflow and Event child-deletion commands follow the same SPA transport boundary,
without importing their excluded backend repairs. Router owns ordinary migrated links; true provider/capability
arrivals and outputs retain explicit document ownership. Token issuance is deliberate
command work, never Query, prefetch or history restoration; private output stays in its admitted mounted lifetime.
Transfer/deactivation branches expose the same typed former-owner cleanup facts to native wording and generated
catalog notices. Account/guest deletion uses that notice path too. Vue retains message keys through the
existing completion/navigation/notice owners, so a visible confirmation reacts to language changes. No adapter
parses prose or repeats a cleanup decision; native wording and operation sequencing remain unchanged.
The controller's capacity predicate serves native/v1 display and registration admission; its child-eligibility
predicate serves native/v1 related projections and scoped lifecycle rechecks. DBAL supplies counts, rows, locks and
persistence rather than deciding either rule. Optional-session method declarations describe the existing public
grant boundary; they do not change runtime authentication or widen profile-required operations.

Participant notes dialogs retain only a summary or participant-ID selection. Displayed notes derive from the full
current admitted roster, independently of local search; removed sources close the selection. Organizer attendance
dates are genuine local drafts and remain separate from those read-only notes and background replacements.

Finance composes the admitted Event page with distinct participant/organizer projections, shared saved history,
totals, ledgers, coverage and lazy protected explanations. Independent pool, invoice-review, enrollment, factor,
adjustment and coverage forms retain their own lexical drafts and confirmed saved-field baselines through sibling
saves and failed follow-up reads. Matching controls use the shared `FormField` lexical-number option and the existing
finance wheel guard; intentionally normalized numeric consumers keep their existing binding. One Finance palette
supplies readable secondary text in the admitted region and shared dialogs, including dialogs rendered outside
their feature subtree.

Financial command money uses decimal strings retaining accepted precision; saved money uses the existing shared
fixed-two-decimal presenter. Factors and numeric identifiers retain their canonical decimal-string contracts.
Existing controller normalization, calculations and DBAL remain shared; Vue performs no replacement arithmetic.
Locale-owned Finance reads retire through the same query-family owner as Help and Overview without invalidating
untranslated Event snapshots. Pending uploads distinguish transferred bytes from saved confirmation; an unknown
outcome requires fresh history inspection and explicit acknowledgement without replay. Confirmed submission clears
completed invoice fields while retaining an eligible pool. Calculation, settlement and output operations keep their
existing domain boundaries and independent reviewed evidence.


<!-- /delta:amendment-01 -->

## Browser builds and shared assets — amendment-02

<!-- delta:amendment-02 -->
### Browser builds and shared assets

Vue application code lives under `src/frontend/`. Feature `api.ts` owners consume generated operations/validators
through `app/transport.ts`; app-owned controls receive explicit values, capabilities, events and injected operations.
Application presentation helpers and styles belong under `src/frontend/`, shared by their actual consumers.
The client entry and development renderer reference the same authored `styles/application.sass` root. It owns the
cascade once: base `style.sass`, `help.sass`, then `pilot.css`. `style.sass` owns its accordion/timezone imports,
including the installed Bootstrap layer. Vite emits separate client/SSR artifacts; the existing renderer uses that
source stylesheet link in development and the client manifest in installed releases, including styled
server-rendered/static content before JavaScript initialization. Preserve the
effective stylesheet order, CDN/compiled Bootstrap layers and styled pre-JavaScript content. Responsive overrides
belong in the shared authored presentation owner; generated output is never an authored source.

The frontend feedback owner supplies notice lifetime; existing backend/domain/catalog owners remain shared.
Logo/favicon image assets and third-party Bootstrap/icons retain their real consumers independently of application
presentation code. Express-hosted Vite middleware supplies development HMR; production uses coherent built artifacts.


<!-- /delta:amendment-02 -->

## Introduction — amendment-03

<!-- delta:amendment-03 -->
Surveyor is a TypeScript monolith that serves HTML and JSON from one Express process. MariaDB stores application
records and sessions; the filesystem stores uploaded header images and invoice proofs. Vue supplies request-local
server rendering and browser interaction. Express retains routing, sessions, authorization and deployment ownership;
the same existing controllers and database services serve every transport.

<!-- /delta:amendment-03 -->

## System context — amendment-04

<!-- delta:amendment-04 -->
  |-- request-local Vue HTML and static assets
  |-- generated versioned JSON/multipart API
  |-- existing document/API adapters for provider, download and other feature boundaries

<!-- /delta:amendment-04 -->

## Current technology baseline — amendment-05

<!-- delta:amendment-05 -->
| Component UI | Vue 3/TypeScript, Bootstrap-compatible presentation, native controls and suitable Reka UI primitives |
| Routing and server snapshots | Vue Router and TanStack Vue Query; feature-owned drafts remain separate |
| Browser/SSR build | Vite with separate client and SSR outputs; existing esbuild output retains its own consumers |
| Shared localization | i18next with i18next-vue, generated typed keys/parameters and shared catalogs |

<!-- /delta:amendment-05 -->

## Current technology baseline — amendment-06

<!-- delta:amendment-06 -->
| Input validation | Authored OpenAPI with generated declarations/Ajv standalone validators; existing Joi/express-validator adapters retain operation-specific decoding |

<!-- /delta:amendment-06 -->

## HTTP application and request pipeline — amendment-07

<!-- delta:amendment-07 -->
3. Install request logging, JSON and URL-encoded parsing, cookies, development middleware and static-file serving.
4. Enable one trusted proxy hop so secure cookies work behind the documented reverse proxy.
5. Create a one-day database-backed session with secure cookies in production and `SameSite=Lax`.

<!-- /delta:amendment-07 -->

## HTTP application and request pipeline — amendment-08

<!-- delta:amendment-08 -->
7. Mount `/api/v1` and the explicit Vue document router before the existing HTML session-expiry redirect and template locals.
8. Validate the stored user/guest/profile session for the remaining routes; invalid sessions are logged out.
9. Populate common view locals, including the active profile, authentication state, version, selected public settings, and return URL.
10. Mount the remaining page and API routers.
11. Expose `GET /healthz`, then the 404, versioned parsing-error and generic error handlers.

Versioned routes own their structured expiry/`ApiProblem` handling and explicit session/context admission. They do
not pass through the existing HTML/OIDC redirect branch. The concrete document-route mount remains owned by
`src/app.ts`; its current renderer/router identifiers do not establish a different final URL scheme.

<!-- /delta:amendment-08 -->

## HTTP application and request pipeline — amendment-09

<!-- delta:amendment-09 -->
/api/v1    generated-contract API, mounted separately before HTML expiry handling
/users     account, profile, dashboard, and OIDC routes

<!-- /delta:amendment-09 -->

## HTTP application and request pipeline — amendment-10

<!-- delta:amendment-10 -->
Feature routers are not auto-discovered. A new top-level router must be imported and mounted deliberately.
Existing API subrouters are mounted in `src/routes/api.ts`; versioned subrouters are mounted by the separate
`src/routes/api/v1.ts` owner, which `src/app.ts` mounts explicitly.

<!-- /delta:amendment-10 -->

## Routes — amendment-11

<!-- delta:amendment-11 -->
`src/routes/` defines URL shape, middleware order, request validation, controller invocation, redirects, and response
selection. Page routes use `express.Router`; API routes live under `src/routes/api/`. Existing and versioned route
families have the explicit router owners described above.

<!-- /delta:amendment-11 -->

## Controllers — amendment-12

<!-- delta:amendment-12 -->
- build authorized page/SSR or API projections;

<!-- /delta:amendment-12 -->

## Authorization architecture — amendment-13

<!-- delta:amendment-13 -->
The complete bit, preset, default, audience, persistence, and evaluation contracts are maintained in [Permission-System Reference](PERMISSIONS_REFERENCE.md). User-facing recipes are in [Permissions and Sharing](user-guide/en/PERMISSIONS.md).

<!-- /delta:amendment-13 -->

## Entity settings — amendment-14

<!-- delta:amendment-14 -->
The existing `entityAdminController` supplies root field/method policy and authorized settings projections.

<!-- /delta:amendment-14 -->

## Entity settings — amendment-15

<!-- delta:amendment-15 -->
App-owned components/composables host image, permission, administrator and archival commands through explicit
props/events and injected operations. Each section has its own draft and save boundary; pending writes freeze controls
and successful writes obtain fresh permissions/context. General, Linked event, Access, and Actions tabs appear only when

<!-- /delta:amendment-15 -->

## Entity settings — amendment-16

<!-- delta:amendment-16 -->
Feature composites remain separate where domain semantics differ. Packing, Event, Drivers, Survey and Activity use
`EntitySettingsDialog` for matching settings reads, independent drafts and captured tokens. It composes
`EntityMetadataEditor`, `EntityHeaderEditor` and `EntityLifecycleActions`; Packing, Event, Drivers and Activity additionally
supply `EntityAccessEditor` operations. Standalone Surveys supply neither Access nor event-association operations.
Features inject operations, query families, field policy and native wording; Packing, Drivers and Activity supply their
`EntityEventEditor` operations. Reka supplies dialog/tab focus behavior.
Mixed navigation uses the shared disclosure owner without competing Bootstrap DOM ownership. Shared timezone
controls retain feature-owned deadline meaning, including omission of unchanged instants.

<!-- /delta:amendment-16 -->

## Profile overview — amendment-17

<!-- delta:amendment-17 -->
Existing Overview adapters share controller normalization and these service reads. The versioned projection supplies
independent regions to `OverviewRegion`, `OverviewItems` and `OverviewCard`. Each loaded region renders at most one
page or enclosing event plus a child page; hidden regions load on opening. Enhanced navigation reads before history
commit, merges only its region into the latest URL and adopts server clamping. Failure preserves cards, URL and focus;
validated denial retires private cards and source-owned totals. Ordinary modified clicks retain their href.
Shared event **Things to do** retains its local filtering and ungrouped membership semantics.

<!-- /delta:amendment-17 -->

## Entity archival and personal visibility — amendment-18

<!-- delta:amendment-18 -->
| App-owned lifecycle/card controls and feature query owners | Server-calculated state, bounded navigation, explicit commands and authorized refresh after success. |

<!-- /delta:amendment-18 -->

## Entity archival and personal visibility — amendment-19

<!-- delta:amendment-19 -->
Optional lifecycle presentation travels through explicit component data/events and the owning controller projection. Shared contracts

<!-- /delta:amendment-19 -->

## Build and release architecture — amendment-20

<!-- delta:amendment-20 -->
2. Generate the TypeORM index, API contracts and locale consumers, then compile server TypeScript to `dist/`.
3. Compile existing browser modules plus Vite client/SSR output, with separate Vue-aware compiler scopes.

<!-- /delta:amendment-20 -->

## Testing architecture — amendment-21

<!-- delta:amendment-21 -->
Vitest discovers unit, frontend and integration files. Its database-free project uses bounded workers for isolated
logic/client checks and scoped server-component integration. The database-backed integration project
remains serialized because it rebuilds one guarded disposable MariaDB schema. Test layer describes the exercised
production boundary; the database-free runner selection does not turn a real server-component integration into a
unit/client test. The [Testing Guide](TESTING_GUIDE.md#vitest-configuration) owns exact selection and commands.

<!-- /delta:amendment-21 -->

## Testing architecture — amendment-22

<!-- delta:amendment-22 -->
Playwright E2E initializes its database and owns the built server without existing-server reuse. Isolated built-browser
checks use `playwright.frontend.config.ts`; source-server/persistence checks use the integration runner. Factories under
`tests/factories/` supply production-shaped data, with workflows in `tests/keywords/` and setup in `tests/support/`.

<!-- /delta:amendment-22 -->

## Change-impact checklist — amendment-23

<!-- delta:amendment-23 -->
7. **Frontend:** component/control, scoped query, separate draft, generated asset, SSR/initialization and static behavior.

<!-- /delta:amendment-23 -->

## In-app help delivery — amendment-24

<!-- delta:amendment-24 -->
1. `src/controller/helpController.ts` selects reviewed articles and adjacent assets inside the fixed `docs/user-guide/` tree, using the shared catalog's supported corpus mapping.

<!-- /delta:amendment-24 -->

## In-app help delivery — amendment-25

<!-- delta:amendment-25 -->
4. Existing Help adapters map logical topics and assets to their declared routes. Path-containment and filename checks prevent request-controlled traversal; requests never choose a filesystem root.

<!-- /delta:amendment-25 -->

## In-app help delivery — amendment-26

<!-- delta:amendment-26 -->
The renderer inserts validated, release-shipped HTML into the Help component. Prefer complete localized articles;
missing corpora/articles/required figures select the complete reviewed English article and its own assets, with visible
fallback and actual content-language disclosure. Never mix translated prose with English figures; invalid existing
source fails rather than hiding behind fallback. This trusted-content boundary is not a generic sanitization service.
Changing the source model requires reopening DEC-004.

<!-- /delta:amendment-26 -->

## Entities, migrations, and subscribers — amendment-27

<!-- delta:amendment-27 -->
The production datasource always uses `synchronize: false`. Empty disposable development databases and guarded
test/E2E setup retain their schema-synchronization workflows. For a confirmed empty production database that has
never held Surveyor data, follow the one-time [Database initialization procedure](DATABASE.md#initialize-a-new-empty-database).
Existing production schema evolution uses reviewed migrations; synchronization is not an upgrade tool.

<!-- /delta:amendment-27 -->

## Events and invoice pools — amendment-28

<!-- delta:amendment-28 -->
`wording.ts` and its locale catalog own native invoice interface and shared email/PDF/export messages.
Vue interface projections use the shared generated translator. `presentation.ts` supplies the common
settlement-status rule. The primary saved **Calculated balance** stays visible after payment or refund. The compact

<!-- /delta:amendment-28 -->
