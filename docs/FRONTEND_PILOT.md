# Frontend foundation pilot
<!--
documentation-metadata
audience: maintainers; frontend developers; API developers; migration reviewers
owner: frontend migration maintainers
status: current
last-verified: 2026-10-07
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: independent packing, management, mixed overview and identity workflows; prior permission-specific paired review; focused desktop/mobile overview and language-owned help-figure smoke checks; full English/German help corpus through API, SSR and SPA; generated contracts, conditional commands and build integration
source-anchors: contracts/api/v1/; scripts/generate-api.mjs; scripts/generate-locales.mjs; src/frontend/; src/routes/api/v1.ts; src/routes/frontendPilot.ts; src/modules/api/; src/modules/packing/api.ts; src/modules/frontendPilotRenderer.ts; src/modules/localization/translator.ts; src/migrations/1791072000000-AddPackingMetadataRevision.ts; package.json; vite.config.mts; tests/unit/frontend-contracts.spec.ts; tests/unit/frontend-generation.spec.ts; tests/unit/frontend-localization.spec.ts; tests/frontend/frontend-pilot.spec.ts; tests/integration/packing-api.spec.ts; tests/integration/packing-metadata-migration.spec.ts; tests/e2e/frontend-pilot-api.spec.ts; tests/e2e/frontend-pilot.spec.ts
next-review: frontend-pilot-scope-or-default-route-cutover
-->

Step 3 of the [foundation design](FRONTEND_FOUNDATION_DESIGN.md) now implements an independent, opt-in packing
frontend. Open `/frontend-pilot`, `/frontend-pilot/packing/<list UUID>` or `/frontend-pilot/help`. Packing routes,
creation, duplication, overview placement, settings and required identity transitions use Vue and the versioned API.
The pilot does not load legacy browser modules, consume Pug fragments or delegate packing controls to the old view.
Anonymous packing links show the pilot's guest entry form; login, registration, recovery and emailed return links
remain inside the pilot.

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

Vue pages compose shared action, dialog and feedback controls. Reka supplies dialog focus/keyboard behavior; existing
Bootstrap styling supplies the visual baseline. TanStack Query owns server snapshots; form drafts own their original,
local and latest remote values separately. There is no additional server-data store.

| Authored owner | Generated consumer or responsibility |
|---|---|
| `contracts/api/v1/*.yaml` | Shared `src/types/api/*.d.ts`, standalone validators and operation metadata; browser client and server import the same declarations |
| `src/locales/<locale>.json` | Discovered locale manifest, typed keys/parameters, bundled resources and fixed help-corpus directory; browser and API use the same translator |
| `docs/user-guide/` and locale subdirectories | Full trusted help articles; the selected catalog chooses the same corpus for API, native help, Vue SSR and SPA |
| `src/modules/packing/api.ts` | Authorized projections and commands; existing packing controller/service owners retain native operations and persistence |
| `src/frontend/app/` | Request-scoped API transport, session/context boundary, routing and app setup |
| `src/frontend/composables/` | Explicit metadata reconciliation and legacy checklist persistence |
| `src/frontend/components/` | Shared application controls |
| `src/modules/frontendPilotRenderer.ts` | Express manifest loading and request-isolated Vue rendering |

Import contracts directly from their owner. Do not copy wire interfaces into components, validators or controllers,
or add forwarding modules. Runtime validators are generated from the contract with strict requests/server outputs;
browser responses permit additive fields. Known Problem variants retain correlated code/status/message/parameter
types. Unknown future errors may display validated safe details but cannot activate known machine behavior.

`npm run server` builds once and runs the existing server/legacy watchers plus the two Vite watch builds. Pilot asset
outputs stay separate from legacy esbuild outputs. Vue source changes require a browser refresh during development;
the watch workflow does not host a second application server. After changing contracts/catalogs, rerun
`npm run prepare:frontend` (or restart `npm run server`) to regenerate their consumers.

`npm run build` generates contracts/catalogs, compiles Express and the legacy browser modules, type-checks both Vue
entries, builds the client and SSR artifacts, then copies the existing assets/views. The release archive already
includes `dist/`; runtime Vue/localization dependencies remain production dependencies. Vite, schema tools and Ajv
are build tools. Standalone validators include their executable helpers and do not compile schemas at startup.

Generated declarations, `.generated/`, bundled locale resources and all `dist/` output are ignored. A clean checkout
must recreate them through the package scripts. `npm run generate:api -- --check` and
`npm run generate:locales -- --check` verify existing outputs against their authored sources.

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

Metadata reads return a scoped ETag. Saves require `If-Match`: missing review returns 428; stale review returns 412.
Only submitted editable fields are changed, with omitted fields distinct from explicit clearing. Dirty input survives
refresh and locale changes. A stale save exposes original, local and remote values, with explicit review before
reapplying. Narrowed authority closes or disables the editor rather than submitting hidden fields.

Inline items have their own edit token; ordering has a collection token. Defaults, administrators, header replacement
and event reassociation use the reviewed settings token. An unrelated assignment does not stale an item draft.
An inline stale write retains the local value and requires explicit review of the refreshed item. Settings and quick
add also retain failed drafts. Commands whose response is lost are never automatically repeated. Pending writes and
unsaved fields prevent silent navigation/discard; changing identity clears data belonging to the previous identity.

The revision covers metadata writers in both frontends, including native title/description/property updates and
packing event/archive context transitions. Assignment changes do not stale metadata editors. The v1 assignment
command serializes current parent/list/item context and is naturally idempotent for desired self-membership, including
historical duplicate-row removal. This does not claim that all legacy assignment endpoints have acquired the new
aggregate locking policy, or that permission revocation/regrant has a persisted monotonic revision.

## Localization and native rendering

English and German pilot UI/API messages come from the same catalog path and typed translator. To add a language,
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
figures with its own text, captions and alt descriptions. See [Help Visual Assets](HELP_VISUALS.md) for authoring.

Help GET links and search forms render the same Vue component tree on the server and hydrate into client navigation.
They work with JavaScript disabled. The existing fixed-source help controller still owns document loading, validation
and trusted rendered HTML. Each server render owns its session, locale, router and query state; bootstrap JSON escapes
script delimiters. Packing initially renders a loading shell and loads its authorized content through the API.
Packing and identity forms require JavaScript in this opt-in slice. Their native no-JavaScript rendering has not
been migrated; the no-JavaScript comparison and fallback guarantee here apply to help only.

## Schema and verification boundaries

Existing installations need the reviewed [packing revision migration](../src/migrations/1791072000000-AddPackingMetadataRevision.ts)
before running this build. Follow [Database and Migrations](DATABASE.md): inspect the effective target, back up and run
the settings-aware migration wrapper. No migration or reset is authorized against shared data by a pilot test command.
Rollback must retain compatible legacy revision writers or disable v1 conditional writes while older binaries run.

The focused application checks are:

- Unit: `tests/unit/frontend-contracts.spec.ts`, `frontend-generation.spec.ts`, `frontend-localization.spec.ts` and
  `frontend-api-problems.spec.ts` cover executable contracts/catalogs and safe transport errors.
- Frontend: `tests/frontend/frontend-pilot.spec.ts` covers drafts, transport, late responses, context/locale handling,
  cooldown and local checklist keys; `frontend-pilot-editor.spec.ts` verifies the actual editor remains mounted with
  its focused dirty input while a localized list response is delayed. The rendered shell/help tests cover navigation,
  the help table of contents and the server-rendered selected locale; packing component tests cover empty/header
  states, authorized parent links and Everyone's existing-assignment exception.
- Integration: `tests/integration/packing-api.spec.ts` and `packing-metadata-migration.spec.ts` exercise real locks,
  revisions, admission, capacity, duplication and migration preservation in a guarded disposable schema.
- Browser/HTTP: `tests/e2e/frontend-pilot.spec.ts` and `frontend-pilot-api.spec.ts` exercise the built application,
  session/privacy/CSRF, stale writes, uncertain responses, mobile actions and JavaScript-disabled help.

Use `npm run test:quick` for the database-free regression pass and `npm run typecheck:frontend` for both Vue entries.
Before integration/E2E runs, follow the [Testing Guide](TESTING_GUIDE.md), prove that the selected schemas are disposable
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
`FRONTEND_BASELINE_DISPOSABLE_DATABASE`, following the [Testing Guide](TESTING_GUIDE.md),
build first, then run the script. It requires credentials restricted to that single schema, adds synthetic fixtures through real HTTP
routes and runs its own built server without resetting the schema or running process-level retention jobs. It
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
actors and fixtures for the second phase. Do not change built assets during a capture phase. An existing gallery
can be regenerated with `node scripts/capture-frontend-baseline.cjs --gallery <capture directory>` without database
access. When running Playwright afterward, use a separate `--output` directory so its cleanup preserves the images.

The [paired review record](frontend-migration/PILOT_PARITY_REVIEW.md) identifies corrected differences, exercised
edge cases and the capture evidence. Review includes owner, account and guest administrators, read-only and
individual write grants, every accessible settings panel, creation/duplication, anonymous entry and localized help.
The native title/description/counter regressions are corrected before capturing the intended baseline. No packing
operation may depend on an **Open current view** control. Future slices repeat this review for their own complete
permission and behavior surface.

## Verification record

The current correction replaces the earlier bounded pilot and its incomplete visual approval. Build/type checks,
passing narrow tests and isolated pilot screenshots do not establish feature parity. The
[paired review](frontend-migration/PILOT_PARITY_REVIEW.md) records the frozen-build comparison and its actual limits.

The 7 October 2026 verification uses Chromium and dedicated local MariaDB integration/E2E schemas with separate
restricted credentials. Integration suites rebuild only their explicitly disposable schema. The capture harness
and owned built-app server add synthetic records without running schema reset or process-level retention jobs.
No existing application database is reset. The review record separately identifies an excluded misconfigured
diagnostic; successful verification uses the explicitly selected disposable targets.

The preceding packing/identity correction passed `npm run build`, both Vue entry type checks and all 837 database-free cases
across 46 files. The guarded authentication and packing-management persistence suites passed 25 and 10 cases.
All nine built HTTP checks and all nine browser journeys passed, including binary image transport, typed multipart
creation, identity admission, private guest-link returns, mobile picker bounds/focus, permission-filtered settings,
inline conflicts and overview visibility/lifecycle. The paired review records visual evidence separately from these
application checks.

That correction's frozen-build capture `2026-10-07T16-49-34-114Z` completed 472 screenshots and 15 behavior checks without
browser errors or failed requests. Every original was visually inspected, including permission-specific desktop/
mobile packing/settings, identity feedback and all English/German help bodies. Fourteen additional selected
screenshots cover stale review, uncertain/confirmed saves and cancelled/discarded navigation. The
[review record](frontend-migration/PILOT_PARITY_REVIEW.md) links the gallery/manifest and retained confirmation
evidence, records deliberate differences and excludes incomplete or misconfigured diagnostics.

The subsequent mixed-overview and self-contained help-figure fixes passed `npm run build:server` and
`npm run build:frontend`, including both Vue entry type checks. Focused help and overview regression checks passed.
Two built-browser smoke journeys covered mixed membership, type filters, personal visibility, event children and
language-owned figures/full-size links in native and pilot help, including JavaScript-disabled navigation. All 21
selected desktop/mobile captures and the three final German PNGs were opened individually and inspected without
finding a regression. Per the maintainer's explicit scope, the full paired comparison was not repeated. These
targeted results supplement the preceding review; its frozen build is not the current artifact. The review record
identifies the current fingerprints, checks and remaining execution limits.

A subsequent user-help correction removes implementation information from English and German text, captions and
navigation pictures. The core documentation instructions now forbid these details in all user-facing content.
Focused checks cover all 20 articles at desktop/mobile sizes, and individual inspection covers both revised PNGs
and 16 selected help captures. A reference-table readability regression found during that inspection was corrected
in the shared help stylesheet and rechecked in native and pilot help. See the review record for this correction's
evidence and the narrower build/test scope.

Logs, screenshots, manifests and browser reports remain ignored local artifacts under
`.temp/frontend-foundation/` and `test-results/`. No default application route has moved. Verification covers the
recorded Chromium sizes and permission states, not other browser engines or a complete application cutover.
