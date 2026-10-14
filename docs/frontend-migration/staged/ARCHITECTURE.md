# Staged frontend architecture amendments
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-14
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: digest-guarded frontend amendments preserve complete reviewed candidate guidance; unchanged production procedures stay in their existing owners; no runtime or cutover execution claimed
source-anchors: docs/frontend-migration/documentation-boundary.json; docs/frontend-migration/check-documentation-boundary.mjs; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; src/frontend/; package.json
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
Interactive initial content shows the shared skeleton until client initialization succeeds. Readable results and
Help retain genuinely functional static HTML, GET search, links and anchors. JavaScript-dependent shell controls wait
for initialization; an independent localized notice covers disabled, missing or failed JavaScript. Initial Vue error
capture covers setup, mount and the first readiness render; later feature failures retain their existing owners.

`mountPreservingDrafts` retains early edits on original admitted controls, with explicit opt-in for non-text/file
inputs. Startup protection exists before route loading and transfers to mounted owners after restoration. Automatic
reload needs clean state and a working loop marker; deliberate recovery respects draft consent and pending/unknown
work. Recovery never persists secrets/files or replays writes.

### Shared contracts, state and commands

`contracts/api/v1/` owns wire schemas and operation policy. Generation emits declaration contracts and standalone
runtime validators; no second handwritten wire schema or runtime schema compilation exists. Transport adapters decode
and present around the same controller business owners. Page admission, method grants and private projections remain
separate; reusable controls never grant authority.

TanStack Query owns authorized snapshots; feature drafts own original/local/current values and Router owns URL state.
`app/queryKeys.ts` names actor/resource/filter families, adding locale only for translated representations.
`app/context.ts` coordinates identity generations, session admission, language and updates without another data store.
Ordinary session recovery pauses dispatch while readable content/drafts remain; actual actor retirement and validated
resource denial retire protected state. `useQueryAdmission` keeps each observer's eligibility bound to its logical key.
A canceled refetch or manual cache alias is not a fresh receipt; shared fresh-read helpers distinguish actual success.

Healthy active shared reads use 30-second polling and bounded recovery, honoring Retry-After, hidden tabs and disposal.
Closed regions do not poll. Locale changes retire translated families only. `MetadataDraft` applies feature normalization
to dirty comparison and sparse submission; touched-current-value comparisons occur under existing locks. Finance
revisions and recommendation fingerprints retain their separate semantics. Confirmation acknowledges submitted values;
only a fresh admitted read restores tokens/grants. Failed follow-up remains saved; unknown delivery retains input and
explicit review without automatic replay.

`command.ts`, `pageEntry.ts` and `feedback.ts` share status, departure protection, canonical delivery and receipt-owned
messages. Pending/unknown status may outlive an editor without retaining its fields. Confirmed navigation retries
delivery only. Transient notices use the existing `scheduleAlertDismissal`; persistent conditions remain visible.
Controls and feature drafts share an explicit value lifetime, including file release after confirmation.

Financial interaction retains its domain boundaries: pool actions lock relevant controls, report delayed progress
after five seconds and display saved state only after confirmation. Payment feedback stays outside filtered share
rows, and detailed saved share/coverage information has its own dialog. Confirmed participant submission clears
invoice-specific inputs while retaining the available pool selection; pending/uncertain uploads prevent duplicate work.


<!-- /delta:amendment-01 -->

## Browser builds and shared assets — amendment-02

<!-- delta:amendment-02 -->
### Browser builds and shared assets

Vue application code lives under `src/frontend/`. Feature `api.ts` owners consume generated operations/validators
through `app/transport.ts`; app-owned controls receive explicit values, capabilities, events and injected operations.
Existing browser modules under `src/public/js/` retain separate consumers:

- `core/` contains shared HTTP, form, navigation, permission, and DOM helpers;
- `shared/` contains reusable page behaviors; and
- feature modules/page entry files implement survey, event, activity, packing, drivers, and account interactions.

`esbuild.client.js` discovers every `.ts` file recursively and emits a corresponding `.gen.js` ES module while preserving the directory layout. Development output is written beside the source and ignored by Git; production output goes to `dist/public/js/`. Relative extensionless imports are rewritten to generated module names.

Sass sources under `src/public/style/` compile to ignored CSS before assets are copied to `dist/public/`.
Vue feedback directly reuses `src/public/js/shared/alerts.ts`; the renderer/header use the shared styles, logo and
favicon. These helpers/assets belong to their actual consumers, not to one renderer. Vite emits separate client/SSR
artifacts; Express-hosted Vite middleware supplies development HMR, while production uses coherent built artifacts.


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
Feature composites remain separate where domain semantics differ. Repeated header, event and lifecycle panels use
`EntityHeaderEditor`, `EntityEventEditor` and `EntityLifecycleActions`; the feature retains drafts, tokens and query
dependencies. Reka supplies suitable dialog/tab focus behavior. Mixed navigation uses the shared disclosure owner
without competing Bootstrap DOM ownership. Time-zone search, detection, aliases and UTC offsets retain their
feature-owned meaning alongside unchanged deadline instants.

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
Vitest discovers unit, frontend and integration files. Its isolated database-free project uses bounded workers;
integration files remain serialized because they rebuild one guarded disposable MariaDB schema.

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
