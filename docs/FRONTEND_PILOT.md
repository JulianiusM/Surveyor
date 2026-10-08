# Frontend foundation pilot
<!--
documentation-metadata
audience: maintainers; frontend developers; API developers; migration reviewers
owner: frontend migration maintainers
status: current
last-verified: 2026-10-08
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: shared skeleton, progressive independent reads and preserved draft/focus loading boundaries; implemented frontend rectification under the maintainer-directed migration-only scope and independent deferral of backend hardening; actual execution evidence remains in the paired review record; ordinary development loading, hydration, lazy navigation, HMR and serialized generator restart verification; approved D1–D5 rectification source/ownership and documentation consistency review; independent packing, management, mixed overview and identity workflows; prior permission-specific paired review; focused desktop/mobile overview and language-owned help-figure smoke checks; full English/German help corpus through API, SSR and SPA; generated contracts, conditional commands and build integration
source-anchors: src/frontend/components/LoadingSkeleton.vue; tests/frontend/frontend-loading-shell.spec.ts; tests/frontend/frontend-content-loading.spec.ts; docs/documentation-remediation.yml; src/modules/frontendDevelopment.ts; src/frontend/app/mountPreservingDrafts.ts; tests/unit/frontend-development.spec.ts; tests/frontend/frontend-hydration-drafts.spec.ts; tests/e2e/frontend-development.spec.ts; contracts/api/v1/; scripts/generate-api.mjs; scripts/generate-locales.mjs; src/frontend/; src/routes/api/v1.ts; src/routes/frontendPilot.ts; src/modules/api/; src/modules/packing/api.ts; src/modules/frontendPilotRenderer.ts; src/modules/localization/translator.ts; package.json; vite.config.mts; tests/unit/frontend-contracts.spec.ts; tests/unit/frontend-generation.spec.ts; tests/unit/frontend-localization.spec.ts; tests/frontend/frontend-pilot.spec.ts; tests/integration/packing-api.spec.ts; tests/e2e/frontend-pilot-api.spec.ts; tests/e2e/frontend-pilot.spec.ts
next-review: frontend-pilot-scope-or-default-route-cutover
-->

## Migration boundary and current iteration (2026-10-08)

The task is to migrate the existing frontend to the approved architecture while preserving the native application's
business behavior and nearly identical UI/UX. Backend work is limited to the contract, projection and adapter support
needed by that migration. Reuse existing controller operations, permission declarations, authentication flows and
DBAL transactions; do not turn frontend migration into authentication redesign, broader authorization hardening,
new domain validation or repository-wide locking changes. Preserve the already approved D1–D5 amendments.

| Area | Current iteration obligation |
|---|---|
| Help and packing | Complete their frontend migration against the existing behavior and edge-case baseline. |
| Shared frontend foundation and necessary identity/selectors | Complete the infrastructure and existing journeys needed to use help and packing. This does not complete broader account or event administration. |
| Overview and other implemented feature scaffolds | Review their implemented parts for native behavior, modularity and readability; mark missing migration work with purposeful TODOs. |
| Remaining native feature workflows and outputs | Retain their existing destinations and contracts until their migration increments. They remain in the eventual migration scope. |

The pilot expands over successive iterations until it covers the approved native migration scope. A future feature
is not permanently excluded, and its existing code is not exempt from review. Distinguish implementation presence,
feature completeness and actual verification; missing future functionality is not the same as a behavioral regression.

### Rectification implementation (2026-10-08)

The completed review and the maintainer's migration-only scope supplied these corrections. Implementation did not
repeat that review or add an authentication system, authorization framework, schema change or repository-wide
locking protocol. The corrections preserve native business rules and the approved D1–D5 amendments; arbitrary
cache age does not become a new write restriction.

| Correction | Implemented ownership and behavior | Verification owner |
|---|---|---|
| FPR-01 Metadata/settings recovery | The existing metadata editor exposes Refresh and deliberate Review after an unknown PATCH, including an unchanged token. The dialog owns one departure decision for its drafts and uncertainty. Empty/null descriptions share dirty/conflict semantics. A confirmed save stays confirmed after a related read failure. | `tests/frontend/packing-management-ui.spec.ts`; existing draft and command cases |
| FPR-02 Freshness and selected events | Ordinary eligible recovery is capped at 60 seconds; healthy 30-second refreshes, server cooldown and visibility rules remain. Corresponding session recovery clears its stale notice. Authoritative null clears a picker's display independently of the selected draft ID, with current-parent and obsolete-response handling. | `tests/frontend/frontend-refresh-navigation.spec.ts`; `frontend-pilot.spec.ts` |
| FPR-03 Identity/guest drafts | The existing command owner composes dirty, pending and unknown state across route, identity, update and browser departures. Every entered field participates; cancellation retains input and committed navigation or confirmed submission releases it. Passwords remain mounted-form state only. | `tests/frontend/frontend-pilot-identity.spec.ts`; `frontend-command-recovery.spec.ts` |
| FPR-04 Implemented overview scaffold | Search uses the shared 300 ms debounce and retires obsolete reads immediately. Filters/search replace history; navigation pushes it. Other regions, focused input and pending navigation are preserved. Source TODOs retain the remaining migration obligation. | `tests/frontend/frontend-refresh-navigation.spec.ts`; existing overview/hydration cases |
| FPR-05 HTML admission and fallback | Packing HTML reuses native loaders, page admission and declared permissions before rendering. Duplicate GET retains its own native grant independently of account-only creation POST and supplies the existing public form context for initial/SPA copies. Hydrated pages expose the localized unsupported-JavaScript message outside the hydration tree; read-only help/admission content stays readable. | `tests/frontend/frontend-native-fallback.spec.ts`; selected pilot HTTP/browser cases |
| FPR-06 Reuse and readability | Root/item field declarations serve packing capabilities and submitted-field checks without changing native grant timing or parent fallbacks. Named helpers, purposeful comments and logical spacing replace the identified nested/compacted code. Shared contracts remain `.d.ts`; unfinished header/card/route boundaries have TODOs. | Existing permission, command and component checks; server and frontend type checks |
| FPR-07 Documentation staging | Production guidance describes native behavior. Necessary replacement guidance, prospective images and one global localization guide per language are staged with canonical merge targets and preserved native baselines. Original decisions and authorized amendments remain recorded. | Optional documentation reports and individually inspected maintained figures |
| FPR-08 Verification | Focused observable regressions, database-free checks, builds and justified real HTTP/browser checks verify the changed boundaries. Exact execution outcomes and limitations belong to the paired review record. | [Paired review](frontend-migration/PILOT_PARITY_REVIEW.md) |

The execution plan is retired into this implementation record. Actual execution evidence remains separate from
source presence; the table does not certify an unrun database, browser, provider or deployment check. Use the
cheapest stable test layer for each observable outcome. Documentation reports remain advisory and never gate
application delivery.

Migration guidance is maintained in [staged development guidance](frontend-migration/staged/DEVELOPMENT.md),
with [architecture](frontend-migration/staged/ARCHITECTURE.md), [testing](frontend-migration/staged/TESTING_GUIDE.md),
[database](frontend-migration/staged/DATABASE.md) and [README](frontend-migration/staged/README.md) replacements.
The staged [OPERATIONS](frontend-migration/staged/OPERATIONS.md)/[UPGRADING](frontend-migration/staged/UPGRADING.md) supplements
merge into their existing canonical sections. At production cutover, reconcile intervening native changes before
merging the corresponding released guidance and removing its staging copy. Publish the single global localization
guide in each supported language and use the staged navigation imagery with it; feature help remains about existing
user tasks. This staging does not itself authorize production cutover.

Authentication/session redesign, a general controller-method authorization framework, broader legacy race
remediation and lock hardening are deferred as `BACKEND-HARDENING-01` in the
[existing backlog](documentation-remediation.yml). They are a separately scoped follow-up, not a migration
prerequisite. Deferral does not authorize weakening existing protections or introducing new migration defects.

Step 3 of the [foundation design](FRONTEND_FOUNDATION_DESIGN.md) now implements an independent, opt-in packing
frontend. Open `/frontend-pilot`, `/frontend-pilot/packing/<list UUID>` or `/frontend-pilot/help`. Packing routes,
creation, duplication, overview placement, settings and required identity transitions use Vue and the versioned API.
The pilot does not load legacy browser modules, consume Pug fragments or delegate packing controls to the old view.
Standalone packing links without an active profile redirect to the pilot's guest entry form. Attached lists retain
native event/view admission before guest entry. Login, registration, recovery and emailed return links remain
inside the pilot.

The packing page retains inline item editing, quick add, drag ordering, Everyone switching, self-assignment and
authorized removal of another assignment. Settings retain permission-filtered Details, Header image, Access,
Event and Actions panels. Creation preserves optional headers/events and initial items; duplication preserves its
existing copy boundaries. The browser-local `packed_<list UUID>_<item UUID>` checklist still stores value `1`.
Packing has no export or automatic-archival control in the existing implementation; peer-feature controls are not
inferred from shared settings.

Default application routes remain unchanged. Surveys, activity plans, events, drivers lists, invoice pools and full
account/profile administration are subsequent feature slices. Their existing outward links are distinct from packing
operations. The pilot landing page offers four independently searched/paged participation and ownership regions,
including hidden entries and event containers. Unfiltered regions include all five authorized overview entity types;
search and explicit type selection use the same membership and counts as the native overview. Packing destinations
and commands stay within the pilot; the other feature cards keep their existing feature destinations. Preserve other
features' [recorded exceptions](frontend-migration/EDGE_CASES.md) when migrating their editors and commands.

## Ownership and normal development

Vue pages compose shared action, dialog, feedback, tabs, permission matrices and event pickers. Reka supplies focus/keyboard behavior; existing
Bootstrap styling supplies the visual baseline. TanStack Query owns server snapshots; form drafts own their original,
local and latest remote values separately. There is no additional server-data store.

| Authored owner | Generated consumer or responsibility |
|---|---|
| `contracts/api/v1/*.yaml` | Shared `src/types/api/*.d.ts`, standalone validators and operation metadata; browser client and server import the same declarations |
| `src/locales/<locale>.json` | Discovered locale manifest, typed keys/parameters, bundled resources and fixed help-corpus directory; browser and API use the same translator |
| `docs/user-guide/` and locale subdirectories | Full trusted help articles; the selected catalog chooses the same corpus for API, native help, Vue SSR and SPA |
| `src/modules/packing/api.ts` | Authorized projections and commands; existing packing controller/service owners retain native operations and persistence |
| `src/frontend/app/` | Common transport, session/context boundary, named query keys, update coordination, routing and app setup |
| `src/frontend/features/<feature>/api.ts` | Feature-owned API operations and validators; overview owns the mixed collection independently of packing |
| `src/frontend/composables/` | Explicit metadata reconciliation and legacy checklist persistence |
| `src/frontend/components/` | Shared application controls |
| `src/modules/frontendPilotRenderer.ts` | Express manifest loading and request-isolated Vue rendering |

Import contracts directly from their owner. Do not copy wire interfaces into components, validators or controllers,
or add forwarding modules. Runtime validators are generated from the contract with strict requests/server outputs;
browser responses permit additive fields. Known Problem variants retain correlated code/status/message/parameter
types. Unknown future errors may display validated safe details but cannot activate known machine behavior.

`npm run server` builds once and runs Express with Vite middleware/HMR, the legacy browser watcher and the
authored-input watcher. Vue edits update through the selected development integration. Contract/catalog edits
regenerate consumers serially and restart Express after completion. `npm run prepare:frontend` remains a standalone
check. Production uses built assets in separate directories and does not depend on Vite or other development packages.
Both Vite build commands explicitly select production compilation, including when the initial build runs inside the
development workflow. Vue source serving still uses development compilation. Client and SSR artifacts must come from
the same compilation mode and release; replacement tests swap the complete binary folder together.
Development and both builds explicitly select the maintained `vite.config.mts`; source initialization also binds the
project root. An emitted sibling config must not silently take precedence or make startup depend on the caller's directory.
Nodemon ignores authored locale catalogs as well as generated consumers: the authored-input watcher publishes its
completion marker after both generators finish, and that marker is the sole restart trigger for those input edits.

Express owns page navigation, native static files and help assets. The renderer passes only source entry/style URLs
through Vite's HTML transform; inserting the rendered component tree afterward keeps those Express URLs unchanged.
Vite middleware handles its `/app/` namespace and restores the request URL on fallthrough. Do not prepend its base
before the transform or transform the complete server-rendered page: either can break hydration while leaving a
convincing but inactive HTML page. Tests must fetch the script/style URLs emitted by the document itself.

`npm run build` generates contracts/catalogs, compiles Express and the legacy browser modules, type-checks both Vue
entries, builds the client and SSR artifacts, then copies the existing assets/views. The release archive already
includes `dist/`; runtime Vue/localization dependencies remain production dependencies. Vite, schema tools and Ajv
are build tools. Standalone validators include their executable helpers and do not compile schemas at startup.

Generated declarations, `.generated/`, bundled locale resources and all `dist/` output are ignored. A clean checkout
must recreate them through the package scripts. `npm run generate:api -- --check` and
`npm run generate:locales -- --check` verify existing outputs against their authored sources.

## Progressive loading (2026-10-08)

The maintainer explicitly requested visible skeletons and independent delivery for slow pages. The shared
`LoadingSkeleton.vue` supplies field, table, card, article and short-line shapes in the existing Bootstrap theme.
Decorative shapes expose no invented records, counts or controls; one localized status announces each loading
region. Responsive layouts and reduced-motion styling apply across migrated features.

Initial interactive Overview HTML carries the authoritative session and region shells. Mounted regions read through
their existing authorized endpoints independently; an open hidden region starts without waiting for main-region
counts. Read-only help retains its complete server-rendered article. Packing, creation/duplication, metadata,
identity admission, guest entry, help navigation and event discovery use skeletons only while their initial required
projection is missing. Confirmed empty results and terminal errors retain their existing presentations.

Packing settings can start metadata alongside the full settings read using the list's known metadata capability as
a scheduling hint. Each response still owns its permissions and token. Available fields appear immediately, and
the same metadata draft remains mounted as other settings arrive. Loaded projections and focused drafts remain
visible during ordinary background reads, including a failed same-resource locale read; confirmed access loss
clears protected content through the existing owner. A pending lazy navigation displays shared progress over the
current view, with destination focus applied only after navigation commits.

This changes loading delivery under the recorded [design amendment](FRONTEND_FOUNDATION_DESIGN.md), preserving
domain behavior, command admission and the current iteration scope. Subsequent modules follow the
[staged loading recipe](frontend-migration/staged/DEVELOPMENT.md). Actual execution and visual evidence belong in
the [paired review record](frontend-migration/PILOT_PARITY_REVIEW.md).

## Identity, refresh and edits

`GET /api/v1/session` projects the active profile, available profile names/IDs, login/logout links, locale,
opaque context/CSRF values and public shell configuration: version, legal links and enabled login choices. It does
not expose private settings. API admission reloads the authoritative stored session and captures one principal/profile
for the request. Local, guest and OIDC login, logout and active-profile changes rotate the context; switching away
and back cannot restore an old tab's context. Context is a staleness guard, not an authorization credential.

Scoped requests require `X-Surveyor-Context`; commands additionally require `X-CSRF-Token` and same-origin policy.
Private endpoints return structured Problems rather than login HTML. Context loss clears private caches/drafts and
rebootstraps. Each command remains attributed to its captured actor if another tab changes identity after admission.

Visible pages refresh on a roughly 30-second jittered interval and on focus/reconnect after session revalidation.
Hidden pages pause reads. Scope and locale guards discard obsolete responses. Reads use bounded retry/backoff and
respect `Retry-After`; mutations do not retry automatically. A successful command followed by a failed read reports
that it was saved. A lost mutation response reports uncertainty and requires a fresh read instead of replay.

Metadata reads return a scoped comparison token. Saves require `If-Match`: missing review returns 428; a changed
submitted field returns 412. Disjoint current-value changes can proceed without overwriting one another.
Only submitted editable fields are changed, with omitted fields distinct from explicit clearing. Dirty input survives
refresh and locale changes. A stale save exposes original, local and remote values, with explicit review before
reapplying. Narrowed authority closes or disables the editor rather than submitting hidden fields.

Inline items have a per-field edit token; ordering has a collection token. Defaults submit only changed audiences.
Existing administrators have bounded per-row tokens; header/event changes compare their own current fields. An unrelated assignment does not stale an item draft.
An inline stale write retains the local value and requires explicit review of the refreshed item. Settings and quick
add also retain failed drafts. Commands whose response is lost are never automatically repeated. Pending writes and
unsaved fields prevent silent navigation/discard; changing identity clears data belonging to the previous identity.

Approved D2 removed the unreleased packing metadata counter/migration in place. Native and v1 packing writers
share controller-owned operations and capacity coordination. Current-value comparisons cover all useful editable
fields, including setup; fresh authorization remains server-owned. Desired self-membership is naturally idempotent,
including historical duplicate-row removal. No edit history, relationship counter or operation tracking is added.

A successful read cannot confirm an unknown creation. Quick-add keeps its input blocked until explicit review of
the refreshed rows; list creation permits acknowledged departure to check the overview. Identity/email uncertainty
also retains input and provides acknowledged exit. Confirmed saves remain saved when the subsequent read fails.
Known error keys/parameters are retained and translated reactively when the language changes.

Deployment identity is separate from API compatibility. Ordinary session refresh detects replacement of the current
release folder; compatible loaded forms may finish before a clean idle view reloads once. A retired lazy chunk
defers reload while any mounted draft or command needs attention. Incompatible commands reject before side effects.
No retained old asset directories, shared asset store, service worker or persisted draft recovery is required.

## Localization and native rendering

English and German pilot UI/API messages come from the same catalog path and typed translator. The restored
primary Vue binding is i18next-vue over that shared core; translation state is application/request isolated. To add a language,
add one complete catalog using the English catalog's namespaces, keys, parameter declarations and language metadata,
set its fixed `help.directory`, and add the complete translated article corpus there. Then regenerate. Discovery,
validation and typed locale choices follow automatically. Text values remain plain text;
Vue and server rendering escape them at output boundaries.

The pilot locale preference is a browser cookie. Request headers, the cookie and supported `Accept-Language` candidates
select a request-local translator. Persisted account/guest preferences, full Pug/email/PDF localization, invoice wording
integration, rich translated slots and additional-language grammar are subsequent work. English and German each
provide all ten help articles, including instructions, tables, privacy and advanced sections. Switching language
changes article bodies, headings, topic labels, search snippets and navigation together. Heading anchors remain
stable through language-owned heading metadata, so translated articles retain existing deep links without reading
another language's articles. Images and full-size links resolve within the selected language's asset directory;
missing localized content never falls back to another corpus. Each language supplies equivalent instructional
figures with its own text, captions and alt descriptions. See the [staged Help Visual Assets](frontend-migration/staged/HELP_VISUALS.md) for prospective frontend authoring; the canonical visual guide retains native production guidance.

Help GET links and search forms render the same Vue component tree on the server and hydrate into client navigation.
Read-only help remains usable with JavaScript disabled, and admission/error content remains readable. The existing
fixed-source help controller still owns document loading, validation and trusted rendered HTML. Each server render
owns its session, locale, router and query state; bootstrap JSON escapes script delimiters.

Interactive packing, overview, identity and guest pages require JavaScript. With JavaScript disabled, the shared
localized message and help link replace the hydrated page, including any server-rendered forms or overview controls.
Their rendered initial state does not promise an operative no-JavaScript workflow. Guarded native POST/redirect/GET
adapters still reuse the existing controller operations for identity and guest admission; their presence does not
make those forms available through the disabled-JavaScript presentation. Packing controls load through the API.

## Schema and verification boundaries

This unreleased v1 pilot is corrected in place under approved D3. Lightweight comparison adds no persistent
packing schema. The earlier unreleased metadata migration was removed; do not create another API version or
replacement migration for that abandoned pilot-only column. Any already-applied disposable test schema may be
rebuilt only through its guarded procedure. Shared database changes require the normal [database guide](DATABASE.md).

The focused application checks are:

- Unit: `tests/unit/frontend-contracts.spec.ts`, `frontend-generation.spec.ts`, `frontend-localization.spec.ts` and
  `frontend-api-problems.spec.ts` cover executable contracts/catalogs and safe transport errors.
- Frontend: `tests/frontend/frontend-pilot.spec.ts` covers drafts, transport, late responses, context/locale handling,
  cooldown and local checklist keys; `frontend-pilot-editor.spec.ts` verifies the actual editor remains mounted with
  its focused dirty input while a localized list response is delayed. The rendered shell/help tests cover navigation,
  the help table of contents and the server-rendered selected locale; packing component tests cover empty/header
  states, authorized parent links and Everyone's existing-assignment exception.
- Integration: `tests/integration/packing-api.spec.ts` and `packing-management-api.spec.ts` exercise real locks,
  touched-field comparisons, admission, capacity and duplication in a guarded disposable schema.
- Browser/HTTP: `tests/e2e/frontend-pilot.spec.ts` and `frontend-pilot-api.spec.ts` exercise the built application,
  session/privacy/CSRF, stale writes, uncertain responses, mobile actions and JavaScript-disabled help.

Use `npm run test:quick` for the database-free regression pass and `npm run typecheck:frontend` for both Vue entries.
Before integration/E2E runs, follow the [staged Testing Guide](frontend-migration/staged/TESTING_GUIDE.md), prove that the selected schemas are disposable
and credentials restricted to them, and build before Playwright. These are bounded proof checks, not full feature
parity, a performance benchmark or an accessibility certification.

## Visual and behavior review

Every frontend slice must be compared visually and behaviorally against the current implementation before it is
called complete. Inspect every implemented screen and significant state at desktop and mobile sizes with identical
records, actors, permissions and local checklist state. Include dialogs, navigation, empty and archived data, special
assignment states and JavaScript-disabled fallback where supported. Build/type/test success and isolated pilot
screenshots are insufficient. Correct unexplained differences, then rebuild and repeat the paired review. Record
deliberate SPA additions and deferred controls; complete feature parity remains a prerequisite for default cutover.

The existing optional `scripts/capture-frontend-baseline.cjs` supports `FRONTEND_BASELINE_MODE=pilot`. Select an
explicitly disposable local E2E environment through `E2E_DOTENV_FILE` and acknowledge its schema name through
`FRONTEND_BASELINE_DISPOSABLE_DATABASE`, following the [staged Testing Guide](frontend-migration/staged/TESTING_GUIDE.md),
build first, then run the script. It requires credentials restricted to that single schema, adds synthetic fixtures through real HTTP
routes and runs its own built server without resetting the schema or running process-level retention jobs. Set
`FRONTEND_BASELINE_RUNTIME=development` to compare source Express, Vue SSR and the Vite browser graph instead.
The same database/grant checks apply; source inputs are fingerprinted alongside built assets. This capture still
omits startup jobs and watchers, so separately exercise `npm run server` for startup, HMR and input regeneration. It
captures each current/pilot pair at 1440×1000 and 390×844, and writes an ignored manifest and side-by-side gallery.
Open original screenshots as well as the gallery; automatic capture success is not visual approval.
For the built browser journeys, `E2E_PILOT_STATE_SCREENSHOTS=true` also records desktop/mobile checkpoints for
stale-edit review, uncertain saves and cancelled/discarded navigation. Retain their separate Playwright output and
report directories. Browser-owned confirmation dialogs are observed through their actual type, message and
decisions; page screenshots show the resulting state rather than invented dialog chrome.
`FRONTEND_BASELINE_SCOPE=identity` limits a diagnostic run to registration, activation, recovery, reset and login
feedback. The full review uses the default scope. Mail capture replaces delivery only; real controller workflows
create the single-use links, which remain in memory and are redacted from saved evidence.

Set `FRONTEND_BASELINE_TWO_PHASE=1` only when recording a before/after correction: after the initial capture reports
its output directory, rebuild, then write `rebuild.ready` there. The script restarts its server and retains the same
actors and fixtures for the second phase. Do not change built assets or selected runtime sources during a capture phase. An existing gallery
can be regenerated with `node scripts/capture-frontend-baseline.cjs --gallery <capture directory>` without database
access. When running Playwright afterward, use a separate `--output` directory so its cleanup preserves the images.

The [paired review record](frontend-migration/PILOT_PARITY_REVIEW.md) identifies corrected differences, exercised
edge cases and the capture evidence. Review includes owner, account and guest administrators, read-only and
individual write grants, every accessible settings panel, creation/duplication, anonymous entry and localized help.
The native title/description/counter regressions are corrected before capturing the intended baseline. No packing
operation may depend on an **Open current view** control. Future slices repeat this review for their own complete
permission and behavior surface.

## Verification record

The [paired review record](frontend-migration/PILOT_PARITY_REVIEW.md) owns dated build/test/capture evidence,
corrected differences, excluded diagnostics and the actual browser/role limits. Its historical accepted pilot
captures do not approve a later build. Each implementation change still needs the affected paired visual and
behavior review described above. Reports and screenshots remain ignored local artifacts; no default route has moved.
