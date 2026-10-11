# Development Guide
<!--
documentation-metadata
audience: developers; maintainers; AI agents
owner: developer-experience maintainers
status: migration-pending
last-verified: 2026-10-11
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: 2026-10-11 contribution recipe reconciled with actual native-oracle/decision evidence, shared command/read authority, silent image recovery, validated admission retirement, scoped successful-read receipts, Retry timing, safe diagnostics, deliberate read-only recovery and selected localization binding; semantic first-read premises, accessible controls/focus, geometry/scroll ownership and actual normal source/HMR/regeneration lessons verified; original decisions/progressive-loading rules retained; exact bounded execution and current image/deployment evidence belongs to the paired review; prospective frontend replacement, not production cutover
source-anchors: src/frontend/components/LoadingSkeleton.vue; src/frontend/features/help/HelpPage.vue; src/frontend/features/overview/OverviewPage.vue; src/frontend/features/overview/OverviewRegion.vue; tests/frontend/frontend-content-loading.spec.ts; src/modules/frontendDevelopment.ts; src/frontend/app/mountPreservingDrafts.ts; tests/unit/frontend-development.spec.ts; tests/frontend/frontend-hydration-drafts.spec.ts; tests/e2e/frontend-development.spec.ts; src/controller/helpController.ts; docs/user-guide/de/; tests/unit/help-localization.spec.ts; contracts/api/v1/; src/locales/; src/frontend/; src/routes/frontendPilot.ts; src/routes/api/v1.ts; scripts/generate-api.mjs; scripts/generate-locales.mjs; vite.config.mts; tests/e2e/invoice-organizer-expenses.spec.ts; tests/integration/organizer-invoices.spec.ts; tests/frontend/invoice-organizer-attribution.spec.ts; src/modules/invoice/settlements.ts; src/modules/invoice/coverage.ts; src/migrations/1790985600000-AddInvoicePoolOrganizerOnlyState.ts; src/modules/invoice/takeovers.ts; tests/unit/invoice-presentation.spec.ts; src/modules/invoice/wording.ts; src/modules/invoice/locales/en.ts; src/modules/invoice/calculation.ts; src/modules/invoice/poolOperations.ts; src/modules/invoice/invoiceOperations.ts; src/modules/invoice/notifications.ts; src/modules/invoice/requests.ts; src/modules/invoice/proofs.ts; src/modules/invoice/exports.ts; src/modules/invoice/presentation.ts; src/types/InvoicePoolTypes.d.ts; src/types/EmailTypes.d.ts; src/types/EntityPropertyTypes.d.ts; src/public/js/modules/entity-properties.ts; src/views/modules/module_entity_properties.pug; tests/integration/entity-properties.spec.ts; tests/integration/activity-property-integrity.spec.ts; tests/e2e/entity-properties.spec.ts; src/types/UserTypes.d.ts; src/modules/renderer.ts; src/routes/api/users.ts; src/views/modules/module_unified_entity_cards.pug; src/public/js/modules/entity-cards-overview.ts; src/public/js/modules/entity-archive.ts; src/modules/database/services/EntityLifecycleService.ts; src/modules/database/services/UserService.ts; src/controller/entityAdminController.ts; src/controller/userController.ts; src/middleware/adminApiFactory.ts; src/types/ArchiveTypes.d.ts; src/views/modules/module_entity_archive.pug; src/migrations/1789689600000-AddInvoiceRetraction.ts; src/migrations/1789603200000-AddOrganizerInvoices.ts; src/modules/email.ts; src/public/js/shared/alerts.ts; src/public/js/notifications.ts; src/routes/event.ts; src/modules/lib/pdf.ts; tests/integration/invoice-admin-feedback.spec.ts; src/migrations/1789516800000-AddInvoiceShareRounding.ts; src/modules/invoice/settlementEmail.ts; src/migrations/1789430400000-AddInvoiceSettlementSnapshots.ts; src/modules/invoice/distribution.ts; src/public/js/modules/invoice-submission.ts; src/controller/eventPoolController.ts; src/modules/database/services/EventInvoiceService.ts; package.json; package-lock.json; README.md; src/server.ts; src/app.ts; src/routes/; src/controller/; src/middleware/; src/modules/settings.ts; src/modules/database/; scripts/genTypeormIdx.ts; scripts/runMigration.ts; migrationDataSource.ts; esbuild.client.js; tsconfig.json; tsconfig.server.json; vitest.config.mts; playwright.config.ts; tests/; .github/workflows/ci.yml; .github/workflows/release.yml; scripts/check-help-documentation.mjs; tests/unit/help-documentation.spec.ts; tests/e2e/help-experience.spec.ts
next-review: frontend-production-cutover
production-reference: 2dfa257 native frontend documentation; reference only, not evidence of an installed production commit
canonical-merge-target: docs/DEVELOPMENT.md
staging-origin: c42758a frontend pilot documentation; authorized 2026-10-08 migration-only rectification
-->

## Cutover staging

This is the temporary replacement draft for `docs/DEVELOPMENT.md`. The canonical document continues to describe native
production until frontend cutover. For work on the migration checkout, use this draft with the
[Frontend Pilot](../../FRONTEND_PILOT.md) guide and executable package configuration. Merge the relevant draft into its existing
canonical owner at cutover, reconcile intervening native changes, remove this staging notice and temporary metadata,
and then remove the merged copy. Staging is advisory and introduces no release prerequisite.

The native documentation reference is `2dfa257`; it does not establish which commit is installed in production.
Original design decisions and D1–D5 remain in the linked migration records. This document records prospective
implementation guidance; the paired review owns actual runtime verification evidence.


This guide covers a source-checkout development workflow for Surveyor. Production deployment and database maintenance use the separate [operator documentation](../../OPERATIONS.md).

## Prerequisites

Match the automated workflows unless a change explicitly targets another supported version:

- Node.js 24.15.0
- npm from that Node.js installation
- MariaDB 10.11
- Git

The project has no containerized application-development stack. `docker-compose.mariadb.test.yml` is a test-database convenience file, not a complete Surveyor environment.

## Clean-clone setup

### 1. Install dependencies

```bash
git clone https://github.com/JulianiusM/Surveyor.git
cd Surveyor
npm ci
```

Use `npm ci` for a clean checkout because `package-lock.json` is the dependency source used by CI and release builds. Use `npm install` only when intentionally changing dependency declarations and the lockfile.

### 2. Create a development database

Create an empty database and a dedicated development account. One example for a local TCP connection is:

```sql
CREATE DATABASE surveyor_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'surveyor_dev'@'127.0.0.1' IDENTIFIED BY 'replace-this-password';
GRANT ALL PRIVILEGES ON surveyor_dev.* TO 'surveyor_dev'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Never point development reset or synchronization commands at a shared, staging, or production schema.

### 3. Create `.env`

The repository intentionally has no general environment example because the complete supported surface is generated from `src/modules/settings.ts` and maintained in [Configuration Reference](../../CONFIGURATION.md). For a local account/password instance, this is the minimum practical starting point:

```dotenv
NODE_ENV=development
APP_PORT=3000
ROOT_URL=http://localhost:3000

DB_TYPE=mariadb
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=surveyor_dev
DB_USER=surveyor_dev
DB_PASSWORD=replace-this-password

SESSION_SECRET=replace-with-a-long-random-value
LOCAL_LOGIN_ENABLED=1
OIDC_ENABLED=0

SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=0
SMTP_POOL=0
SMTP_EMAIL=surveyor@example.test
SMTP_USER=surveyor
SMTP_PASSWORD=surveyor
```

Point SMTP at a development mail catcher or test service. Local registration, activation, password reset, guest recovery, and several workflow notifications depend on email.

For organization sign-in, configure `OIDC_ISSUER_BASE_URL`, the client credentials, and the other OIDC keys from the configuration reference, then register the callback path `/users/oidc/callback`. Local and OIDC login may be enabled together. At least one usable full-account login path should be configured for development.

Runtime settings use this precedence:

```text
built-in defaults < CSV settings file < environment overrides
```

Do not introduce a second settings loader or read configuration directly in feature code. The TypeORM command-line datasource is the controlled exception; `scripts/runMigration.ts` maps the initialized settings store to its expected `DB_*` variables.

### 4. Create the empty schema

The entity/migration index is generated and ignored, so a clean clone must generate it before a standalone TypeORM command:

```bash
npm run generate
npm run typeorm:sync
npm run typeorm:migrate
```

This sequence is only for a new empty disposable development database. `schema:sync` constructs the current entity schema; the migration run records and applies migrations needed for migration history, triggers, and conditional adjustments. Existing databases follow [Database and Migrations](../../DATABASE.md).

The convenience command below drops the selected schema first and is therefore destructive:

```bash
npm run typeorm:reset-db
```

Use it only after independently confirming that the selected database is disposable.

### 5. Start Surveyor

```bash
npm run server
```

`npm run server` performs a full build and then runs:

- the server under Nodemon through `npm run server:dev`;
- legacy browser TypeScript under the esbuild watcher through `npm run server:client`; and
- authored API/catalog regeneration through `npm run server:frontend`.

The Express development process hosts Vite middleware and HMR for Vue code and its SSR entry. The authored-input
watcher serializes dependent generation and writes its completion marker before Nodemon restarts Express. Use the
root `npm run server` workflow for automatic generation; `prepare:frontend` remains useful for standalone checks.

Check the instance:

```bash
curl http://localhost:3000/healthz
```

A healthy process returns `ok`. Complete a local activation email or an OIDC login to verify the configured identity path.

## Project structure

```text
src/server.ts                      ordered process bootstrap
src/app.ts                         Express application and top-level route mounts
src/routes/                        page routers
src/routes/api/                    feature API routers
src/controller/                    request and response orchestration
src/middleware/                    shared request flows and authorization
src/modules/database/entities/     TypeORM entities
src/modules/database/services/     database and transaction functions
src/modules/database/subscribers/  TypeORM subscribers
src/migrations/                    TypeORM migrations
src/modules/lib/                   cross-feature utilities and contracts
src/public/js/                     browser TypeScript
src/public/style/                  Sass sources
src/views/                         Pug templates
src/frontend/                      Vue pilot app, components, feature views and styles
contracts/api/v1/                   authored OpenAPI operations and wire schemas
src/locales/                       shared pilot UI/API language catalogs
tests/unit/                        isolated production logic
tests/frontend/                    browser-helper behavior under Vitest
tests/integration/                 MariaDB-backed workflows
tests/e2e/                         Playwright critical flows
tests/factories/                   production-shaped test data
tests/keywords/                    reusable test workflows and assertions
tests/support/                     runner environment and database setup
docs/user-guide/                   canonical in-app help
docs/                              maintainer and operator documentation
```

`dist/`, generated browser modules, compiled CSS, uploads, local environment files, `settings.csv`, reports, and the generated outputs listed below are ignored build/runtime files.
Do not retain adjacent same-name `.js` copies of `.ts` modules under `src/`, including generated TypeScript
registries. Extensionless imports can select such a copy before the maintained source even when type checks pass;
inspect the actual resolved inputs when checks disagree. The existing generation suite checks this collision across
all of `src/`; differently named legacy `.gen.js` outputs retain their established build ownership. Retain an
unexpected copy outside the source tree while establishing its provenance instead of assuming its creator.

## Build and run commands

| Command | Behavior |
|---|---|
| `npm run server` | Full build, then Express/Vite HMR, legacy browser and authored frontend-input watchers. |
| `npm run server:dev` | Nodemon + ts-node server only. It assumes generated database/API/catalog outputs and required assets already exist. |
| `npm run server:client` | Legacy browser-code watch build only. |
| `npm run server:frontend` | Watch authored contracts/catalogs and regenerate dependent artifacts serially; Express owns Vite HMR. |
| `npm run build` | Sass, generated database/API/catalog artifacts, server and both frontend builds, then views/assets copy. |
| `npm run build:sass` | Compile Sass into ignored CSS under `src/public/style/`. |
| `npm run build:server` | Run all generation, compile server TypeScript into `dist/`, and copy runtime API contract artifacts. |
| `npm run build:client` | Compile legacy browser TypeScript into `dist/public/js/`, then build the Vue pilot. |
| `npm run build:frontend` | Typecheck Vue code and build client assets plus the server renderer. |
| `npm run typecheck:frontend` | Prepare frontend outputs and typecheck client/server Vue projects. |
| `npm run copy` | Copy current image/style assets and Pug views into `dist/`. |
| `npm run run` | Start `dist/server.js`; it does not build first. |
| `npm run generate` | Rebuild the TypeORM index, API declarations/validators, and locale outputs. |
| `npm run prepare:frontend` | Regenerate API and locale outputs without database index generation or asset builds. |

### Generated files

Do not hand-edit or commit these generated outputs:

- `src/modules/database/__index__.ts`
- `src/types/api/`
- `.generated/api/v1/`
- `src/types/LocalizationTypes.d.ts`
- `src/modules/localization/generated/`
- `src/public/js/**/*.gen.js`
- `src/public/js/**/*.gen.js.map`
- `src/public/style/**/*.css`
- `src/public/style/**/*.css.map`
- `dist/`

`esbuild.client.js` recursively discovers browser `.ts` files and emits one `.gen.js` module per source file. In development it writes beside the source; in production it writes into `dist/public/js/`. Extensionless relative imports are rewritten to the generated module names.

### Frontend pilot contributions

The [Frontend Pilot](../../FRONTEND_PILOT.md) describes the independent packing/overview/identity/help slice and its explicit `/frontend-pilot` entry points. Author API shapes and operation IDs in `contracts/api/v1/`; import generated declarations directly from their owning `.d.ts` file and use the generated validators at request/response boundaries. Avoid a second handwritten DTO or validation schema. Keep business authorization in the feature controller/module and persistence/locks in its database service.

Add pilot UI/API translations through `src/locales/<locale>.json`, following the English catalog's complete keys and parameters. `npm run prepare:frontend` discovers catalogs and checks them against the authored API message contract. Reuse `src/frontend/components/` and feature modules for Vue changes; the existing Pug routes remain available for workflows outside this pilot. Generation and packaging are part of the normal build, and generated output must not be edited or committed.

Each language catalog also owns a `help.directory` entry selecting its release-shipped Markdown corpus beneath
`docs/user-guide/`. English uses `"."`, so the maintained English guides remain their only authored source; German
uses `"de"`. Add a language by adding its complete catalog and corresponding guide directory, then regenerate the
catalog manifest. The same resolver selects article bodies, navigation titles, search results and API messages for
the Express renderer and Vue application. Translate every article, including procedures, caveats, tables and figure
explanations; translating only navigation labels or result snippets is insufficient.

Each article owns stable fragment IDs through its hidden `heading-anchors` metadata, preserving topic/section
semantics without reading another language's article. Every language supplies equivalent figures with its own
text, captions and alt descriptions; a missing article or picture never borrows another corpus.
Relative guide links retain the selected locale, and Vue rewrites them to its own help route for both server-rendered
HTML and client navigation. Missing translated articles produce a localized error rather than an English article
under translated navigation. A locale directory is fixed release content, never an upload path or remote source;
the existing trusted-Markdown validation and metadata rules still apply. Use synthetic fixtures for runtime tests;
maintained-corpus completeness and link reviews remain advisory documentation work.

Before calling a frontend slice complete, visually inspect every implemented screen and significant state against
the current application using the same records, actors and desktop/mobile sizes, and compare their behavior. Include
permission restrictions, empty and archived data, dialogs, navigation and any native fallback. Passing builds,
component tests or screenshots viewed in isolation do not establish parity. Correct unexplained differences and
record deliberate SPA behavior changes and deferred controls explicitly. The [pilot review](../../FRONTEND_PILOT.md#visual-and-behavior-review)
describes the paired capture workflow; default route cutover requires the complete feature baseline; current iteration completeness is limited to help, packing and their necessary shared foundation.

### Implementing the next feature slice

Primary design choices are binding. An alternative listed in a design record requires active, explicit user approval
before substitution; record the original choice, reason and approved amendment. A later rewrite does not authorize it.
The [foundation decision ledger](../../FRONTEND_FOUNDATION_DESIGN.md#authorized-rectification-2026-10-07) records D1–D5.
Keep the native comparison separate from that authorization record: identify each observed difference, its native
executable owner and the specific approved amendment, if any, in the existing paired review. Approval of the general
migration does not approve changed labels, focus, validation, no-op actions or permission-dependent visibility.

For a conditional library choice, explain why its primitive fits or does not fit the required native interaction.
The framework decision selects Reka for dialog, confirmation, menu and combobox wrappers where its primitives fit;
native inputs remain appropriate. A fit assessment is not authorization to replace a primary choice. Resolve a
departure with the maintainer before implementation, retaining the original decision and dated amendment. Neither
passing tests nor implementation prose can supply that approval.

The pilot's mixed navigation and overview menus share `AppNavigationDropdown` and native disclosure semantics.
The installed public Reka menu introduces registered items and roving/hover focus; Popover introduces dialog,
autofocus and positioning behavior. Neither preserves these native links and form controls unchanged;
`DismissableLayer` is not a stable public export. Keep the wrapper's ordinary Tab, embedded-control keys,
outside-pointer/focus dismissal, Escape focus return and arrow policy together, with shared placement. Dialogs
and tabs continue using the selected Reka primitives. Reassess a future wrapper's fit instead of copying this
bounded assessment to a different interaction.

Use this recipe when implementing the next authorized feature increment. The completed pilot review is not a
prerequisite to repeat before fixing its known findings. For a future module, use the existing baseline and
feature-specific edge cases to constrain the requested increment:

1. Identify the increment's existing journeys, labels, admission, permissions and mutation owners. Preserve native
   business behavior, visual layout and deliberate feature exceptions. Trace both GET and submitted-form admission;
   an explicit guest page and a duplicate form can have different admission from detail and creation. Help and packing are the current completeness obligation;
   Overview and other scaffolds keep purposeful TODOs for the remaining migration, without being excluded forever.
2. Extend the unreleased v1 YAML in place. Declare status, media, retry policy and precondition once. Use decimal
   strings for packing assignment IDs, including nullable read handles, and reuse shared schema references. Run
   the existing generator for declaration-file types and strict Ajv request/response validators; do not hand-write
   parallel DTOs, structural validators or a locale registry. Keep shared type-only contracts under `src/types/`
   as `.d.ts` files.
3. Adapt existing controllers and DBAL operations. Reuse declared permission middleware and the existing policy
   helpers for HTML and API admission. Reuse `hasAccountProfile` and `getEntityViewAdmission` where those established
   policies apply, rather than reimplementing them in a route or Vue component. Keep controller-owned business checks inside the relevant existing transaction when
   they depend on locked rows. Migration adapters preserve existing authentication and domain behavior; broader
   authentication, authorization, legacy race and lock redesign remain separate native work. The native remediation
   backlog never tracks migration or pilot work.
4. Reuse the application transport, context gate, query-key/invalidation owners, debounce helper and read scheduler.
   Keep authoritative snapshots, original edit baselines and local input separate. Scope reads by actor and resource;
   include locale in the query identity only when the server representation varies by language. Reject late results.
   Use `usePageEntry` for server-owned render, redirect and denied decisions, including
   canonical redirects and one-time notice severity. It also retires results when a lazy destination is pending.
   A confirmed locale preference advances its own generation; an older session read can still report a real actor
   change without reverting that preference. Healthy visible reads retain the 30-second cadence and recover toward roughly
   one-minute convergence under a responsive backend, respecting cooldown, hidden tabs and disposed observers.
   Closed selectors consume their owner's current authority; they do not invent continuous hidden search polling.
5. Compose the shared form, dialog, command, draft, feedback and departure owners. Use complete dirty predicates
   and established empty/null equivalence. `useDraftProtection` composes nested editors into their nearest owner;
   the application shell owns the whole-page root, and a dialog can still check its own subtree on Close. Preserve drafts through refresh
   and cancellation, and release them only after accepted navigation commits. A confirmed write stays saved even
   when its follow-up read fails. The additive typed command outcome separates confirmation from refresh; accepted
   submitted values are distinct from the last authoritative revision and cannot supply a new write token. Unknown commands remain explicit until reconciliation or acknowledged exit;
   recovery stays reachable and never automatically replays a command. Secrets stay in the mounted form.
6. Use centralized catalogs with the typed i18next-vue interface. Keep machine values and entered content separate
   from translated labels. Interactive migrated pages require JavaScript; a clear shared message or genuinely
   read-only server result supplies the disabled-JavaScript fallback. Same-component SSR/hydration remains
   available. Preserve native route, filter/history, focus, visual and form semantics for JavaScript-enabled use.
   Guest registration preserves the submitted display name. Native browser collection owns its existing item
   trimming and empty-row rules; JSON validation must not silently normalize stored user text. Author native form
   structure in the same contract source; a narrow transport decoder may retain established scalar coercions.
   The shared guest-flow factory supplies the form action and exact login return destination to every consumer,
   including modules outside the current frontend slice. The approved duplicate-return amendment preserves
   `<entity>/<id>/duplicate` after login; do not substitute the module's ordinary create URL.
7. Reuse update coordination for mounted dirty, pending and uncertain states. Compatible forms can finish across
   replacement of the current binary folder; do not require retained old assets, external deployment services,
   persisted secrets/drafts or reload loops. Explain state ownership, nontrivial comparisons, authorization and
   recovery with named helpers, purposeful internal comments and logical blank lines. Follow neighboring style.
8. Run only the cheapest checks protecting the changed observable boundary. Compare affected native/pilot roles,
   states and desktop/mobile behavior, including the agreed JavaScript-required/read-only fallback. Verify the
   normal `npm run server` path when build/watch/hydration changes are touched, rather than treating a successful
   built SSR screenshot as development evidence. Record actual execution and limitations in the paired review.
   Preserve production documentation and feature help; stage necessary maintainer/operator replacements here
   until cutover. One global localization guide owns language choice and language counterparts. Documentation
   reports remain advisory; no application assertions or delivery checks depend on maintained prose or images.

The shared client mount preserves text entered or autofilled into native forms while modules download. Future SSR
forms use that boundary rather than introducing their own input replay. Hidden admission fields, identity selectors
and submissions are never replayed; secrets remain only in the mounted form and temporary mount-local snapshot.
Navigation-related asynchronous work must also account for a pending lazy destination, before `currentRoute` changes.

The context retains a confirmed identity result while its authoritative session read is unavailable. A successful
Retry delivers its personal link only to the matching actor; a mismatching identity retires it. This private result
is separate from the shared entry owner's confirmed destination. `useConfirmedNavigation` retains delivery after a
healthy bootstrap too: cancelled or failed lazy navigation, an identity remount, or retirement of the submitting
editor must not make the confirmed command available again. Retry repeats navigation only. The shell supplies
recovery when that editor is gone; a different committed document or authoritative actor retires the destination.
Pending delivery blocks departure, and an undelivered confirmed result prevents silent browser or update reload.
Keep these receipts application-local; never persist secrets, drafts or a second copy of server resources.
Repeated consumers supply a stable logical identity to `useConfirmedNavigation`; its component-type namespace
isolates simultaneous regions while retaining the same owner across an actor-driven remount.

Confirmed message destinations use the shared entry completion operation and an actor-scoped, memory-only presentation
receipt. Guest recovery from every entry form finishes at the same recovery URL and existing message card. Its direct
GET retains the native login redirect; neither an arbitrary URL nor reload reconstructs a prior success. Native form
POSTs use the same destination and existing controller operation.

Draft preservation does not authorize a different rejected-form contract. Known server-rejected identity submissions
clear password fields exactly as native POST-rendered forms do; local validation and unknown delivery retain mounted
input. Keep non-secret values according to the native form. Configuration-denied identity routes use the native full
Error page, including when configuration changes before a submitted command is rejected. Preserve native no-op
actions too: pristine metadata Save remains available, displays its informational message and sends no mutation.
Use native focus styling unless a specific observable departure has been approved.

Check response compatibility against the actual validator used by an already mounted client, not only regenerated
consumers. A new required or always-emitted field can break a strict older client within the same compatibility
family. Preserve ordinary read shapes and use an explicit opt-in request for additional contextual data where
needed; the pilot's `selectedEvent` is optional and emitted only when `eventId` was requested. This does not require
old-asset hosting or another API version. Test old request shapes alongside the new context before claiming a safe
folder replacement.

Use `useDraftProtection.retainCommand` for admitted pending or unknown work that can outlive its editor. Retain only
the captured actor/epoch, visit and status; denied controls and private query data must still retire. The lease covers
a required conflict read and releases after known settlement, obsolete authority or deliberate acknowledgement of
uncertainty. Unmount alone cannot release an unresolved operation. Before irreversible deletion, obtain the whole
page's draft decision through `prepareDeparture`, before sending the write. Retain accepted consent through failed
delivery and later private-editor retirement, without bypassing another pending command or repeating the prompt.

Use `useCommand.recover` and its shared `recovering` status for authority recovery after an unknown identity or mail
command. Its retained lease protects the full read, including session bootstrap and an eligible feature read.
Pass the recovery callback's actor/document/mount predicate into any follow-up read; a retired form must not start
another query or publish feedback. An unchanged session does not prove that creation or mail failed. Release the
read's busy lease when it settles while retaining uncertainty until a genuine actor transition or acknowledgement.
Desired-state `reconcile` uses that protection while a command is unknown; ordinary resource Refresh remains
navigable. Capture the reviewed command as well as its actor/document/mount so an earlier read cannot acknowledge
or replace feedback for a later mutation. Check `reconcile`'s boolean eligibility before opening a Review prompt
or clearing feedback; a retired read must not trigger those follow-up actions.

Keep late-result presentation separate from operation settlement. A held command must not repopulate an evicted
private cache, trigger a retired observer's explicit refetch, or restore fields revoked by a newer read. A current
recovery read can still offer deliberate Review of the remaining authorized fields after an unknown write. Use the
generic `MetadataDraft` comparison/review algorithm with caller-owned field policies; Packing's empty-description
equivalence belongs to its consumer. Preserve omitted values, explicit nulls, zero and false. Confirmed submitted
values acknowledge a save; only current authoritative reads provide the next values, grants and write token.
Denied read authority must also retire retained region snapshots: an old cache object cannot restore cards that
the same actor's denial already removed; restoration requires a new admitted read under the current scope.
Apply that rule at the shared admission owner too. `PilotPageEntrySource.key` identifies a language-independent
admission family; `usePageEntry` applies the same barrier to typed denials and validated HTTP read denials. A typed
denial retains its producing response; a transport denial retires that query's old private payload too. Its
`onDenied` callback selects additional feature projections, preserving independent public-entry policy and
already-copied drafts. A fresh scoped render read supersedes old denials; cache hits and captured SSR seeds cannot.
Retained denial authority must not conceal the current recovery read's diagnostic or Retry deadline. Keep the
projection blocked until admission succeeds while presenting the latest scoped failed-read outcome and cooldown.
Every `initialData` evaluation checks live `initialDocumentFor` eligibility, including after eviction and a return
visit. Recheck actor, document and admission generation after asynchronous cancellation before publishing a result.
After creation-context denial, keep only an already initialized local form's recovery fields and its original file
input mounted, with the fieldset and command handlers disabled. Retire server-owned event names, pickers, audience
definitions and presets. A fresh admitted GET restores those capabilities; a cold denied context mounts no form.
Do not hide an input and later replace its FileList, or create a second file store to preserve this recovery boundary.
Pending writes and protected recovery freeze Settings tab selection as well as the controls inside the current panel.
Pass pending interaction separately from mutation-disabled state. An unknown parent blocks another write while
read/Review recovery remains reachable; an actual pending parent freezes those recovery controls too. Do not use
one disabled flag for both policies or allow a programmatic event to bypass the pending owner.

Shared read lifetimes accept feature-owned operations rather than importing a feature API. `useAuthorizedImage`
owns actor/resource/version retirement, abort and object-URL cleanup; its injected binary read owns the endpoint.
Optional image failures remain silent. The shared image owner respects `canRetryRead` and the common read interval,
with a bounded timer only while the current image is missing; a successful ordinary/manual JSON read can recover
that same-version image, including equal JSON. It retains a healthy blob and adds no image warning or visible Retry.
A cancelled image response must retire before decoding its error or recording a cooldown, so a late response cannot
disable a newer image read. JSON consumers' deliberate Retry uses the separate existing `useReadRetry` control owner.
Shared cache eviction likewise accepts caller-selected query families. Feature-specific key formats and containing
projections remain feature-owned; Packing's legacy checklist helper lives beside its view, without a forwarding layer.
Classify successful representations before choosing a key. Packing detail, metadata, settings and event options
contain machine state or user-authored content, so they share one current actor/resource projection across languages.
A newer successful read with fewer editable fields must remain authoritative when language changes; returning to
an older language must not revive cached grants. Locale changes still cancel and invalidate reads. Help and Overview
contain language-owned content and keep locale in their keys; a future localized picker provider may do so too.
Help's browser-safe navigation policy likewise preserves native paths, queries and fragments without adding a
feature-specific return control or injecting Packing context into generic links.

Native initial data uses `initialDocumentFor` and the shared bootstrap codec. Every declared bootstrap field has a
validation owner, and decoding retains the complete validated object rather than maintaining another reconstruction
whitelist. A later actor, different document visit or reused token route must obtain fresh admission; going Back
cannot revive consumed initial feedback or a used token. Same-document fragments do not discard drafts or receipts.
The shared mount preserves existing text/autofill drafts and restores non-text drafts only when their owner marks
the actual control `data-hydration-draft`. Number, checkbox, select and file inputs use that opt-in; shared permission
components expose `hydration-draft` for their checkbox masks, leaving audience navigation unmarked. Restore only
the same connected, editable node with unchanged type, marker, ID and name. Checkbox choices retain their value;
selects retain their multiple flag, option nodes/values and selected-option admission. Keep selected files local as
their original ephemeral `FileList`; never serialize them or transfer values by field name to another view.
The asynchronous mount first settles mounted admission, then each restored draft through Vue's next tick before
the next composite edit. After draft restoration,
the entry client starts ordinary reads and publishes its hydration-complete marker. Hidden admission fields,
identity/locale selectors and immediate-command controls never opt in; no submission or upload is replayed.
Read admission fences actor, epoch, resource, document and locale, including a pending lazy destination before the
router commits. A confirmed business result remains valid across a locale-only change; delivery uses the current
presentation language while retaining its captured actor and origin.

Keep command confirmation and read causality separate. Confirming submitted values acknowledges that operation;
it does not authorize an older read to overwrite a newer snapshot or restore its grants. Retire a response whose
read admission became obsolete even when the command that triggered it was confirmed. Preserve the shared command
owner's pending, confirmed and unknown outcomes in each consumer instead of translating them into local booleans.

JSON and binary failures share the application's validated Problem envelope boundary. Preserve a structurally valid
future error's safe detail without treating its unfamiliar code as a known authentication or permission transition.
Malformed envelopes do not supply trustworthy machine decisions. Keep status, media and retry handling in the shared
transport; feature presenters choose native wording only after the Problem has been validated. Test actual image
and command consumers as well as the transport, since a shared helper passing does not prove correct integration.
Use the transport's shared `isReadDenial` predicate for terminal read authority too. A raw HTTP 401/403/404 with an
unusable envelope does not authorize unmounting a private editor or discarding its local draft. A validated confirmed
read rejection follows the terminal-status policy; unfamiliar detail alone does not grant a known machine code.
Ordinary session/query freshness applies that envelope validation before making a client error terminal too.
Unusable 400/403 reads retain the approved ordinary recovery bound; 429 and server Retry-After keep their separate
deadline behavior. Test the real mounted observer's recovery, without replaying a command or merely checking a timer.
Temporary-read warnings also show the original approved last-successful-refresh information through the shared
StatusNotice and translator formatter. Pass the query owner's update time only for a readable current-scope
projection; do not create another timestamp store or add it to healthy native views. Keep the existing read warning
and Refresh reachable while a metadata draft remains mounted.
Display the owning server Retry deadline too, using `useReadRetryAt` with the same availability owner that disables
the control. A disabled button alone does not explain when recovery is available. The shared StatusNotice and
`readFailureMessage` present validated query issues and safe future details; arbitrary network or malformed payload
text stays hidden. Keep a successful-read receipt inside an existing scoped presentation owner when pagination or
a localized query can replace its cache key, and remove it with that owner rather than borrowing another query's
time. Session bootstrap owns its actual successful-read receipt separately from resource-query freshness.

Provide deliberate read-only recovery for recoverable Help, selector, guest-title and cold-admission failures too;
static or token-checking reads need not poll to expose Retry. A genuinely typed denial preserves its native error
surface, and a token-consuming action or command is never repeated by a read-recovery control. Reuse the context's
bounded jittered retry policy instead of adding another scheduler. Contextual notices use `usePilot().messages`
so the selected i18next-vue binding also observes same-language resource updates; standalone no-context notices
retain their fixed fallback. Test that actual contextual component with the real plugin and retained draft node.

Preserve native transport projection alongside strict v1 validation. Shared normalization and the existing locked
business operation must retain native optional-field/no-op behavior and established validation diagnostics. A narrow
adapter may restore the legacy error data expected by its browser consumer; typed v1 codes, statuses and parameters
remain unchanged. Compare those native consumers directly rather than changing global error handling.
Compare HTML response status separately from its embedded Problem and the v1 response. A native validation failure
may render Error 500 while its approved wire cause is 401; preserve both owning contracts instead of applying the
API classifier's status to the document. Typed security and admission failures retain their established status.
Native metadata maximum diagnostics retain UTF-16 counting using authored bounds through the existing
[contract helper](../../../src/modules/api/contracts.ts); ordinary v1 metadata string bounds retain JSON Schema's
code-point meaning. Registration/reset instead author the native eight-unit password minimum through the bounded
UTF-16 extension described in the [API design](../API_CONTRACT_DESIGN.md#the-supported-schema-and-transport-subset).
Keep that explicit selection separate from standard bounds; do not copy limits or change all string semantics.
The native creation adapter acquires no additional text validation limits.
Derive authored request constraints and browser field attributes from the accepted native input policy, not a
generic preferred bound. Native password fields have no maximum length; the generated password schemas and Vue
controls must preserve that acceptance. Registration/reset criteria and login admission remain separate policies.
Forgotten-username and standalone guest-recovery inputs likewise retain their native unbounded acceptance; guest
registration's email lookup keeps its own bounded authored variant. A reused field name does not make those
operation-specific input policies interchangeable.

Browser constraints and submission validation are operation-specific too. Retain native metadata `maxlength`, while
creation, quick-add and inline title/description controls acquire no extra length attribute. Compare required,
minimum and validation triggers separately for creation/new-item controls and existing-item edits. Native inline
capacity admits zero, negative, nullable and raw decimal drafts; preserve the raw transport through the existing
locked operation and let its parameterized database update own coercion and failure. The authored finite scalar
union describes that transport. Do not add a browser minimum, implicit `reportValidity`, JavaScript rounding or a
second SQL-limit policy. An unbounded native control is not proof that every value can be persisted.

Route wrappers relinquish page-title ownership to their mounted feature except when presenting an admission error.
The existing `usePageTitle` helper accepts an undefined title for that handover. Reactive effects calculate output
from their declared inputs; they must not also subscribe to a shared output that another mounted owner writes.

Use the shared `PageMessage` for full information, success and error pages. Its shared shell marker preserves native
message-page spacing without changing ordinary pages or hiding real notices. Shared form labels let the icon's
existing margin own its text spacing; extra template whitespace changes narrow-screen wrapping. The shared footer
preserves native icon adjacency and nonbreaking separators through translated text. Correct shared
presentation in these owners rather than adding feature-specific layout overrides.
Shared dialogs initially focus their native container. A feature can supply a body-field target when its native
workflow does so, as the event picker does; the wrapper still owns the trap and returns focus to the actual invoker.
Keep that opening policy separate from inline command feedback's native Close focus and region-navigation focus.

Feedback policy is explicit at the shared owner. Native full message pages and ordinary transient outcomes expire
their alert body after the shared ten-second dismissal interval once visible; expiry leaves the message page,
Home action and confirmed receipt intact.
Keep that default flash presentation distinct from native inline feedback. An operation opts into inline presentation
through `PilotCommandFeedback`, supplying its native plain-message key and initiating event or element. Capture the
initiator before awaiting a command, because `currentTarget` expires after dispatch. The shared feedback owner finds
the native section, modal fallback or page live-alert host; `StatusNotice` supplies inline Close, focus and scrolling
only for that presentation. If the target detaches or becomes hidden, retain the same receipt in its live fallback
instead of preserving revoked controls or displaying an invisible confirmation. Do not add Close or focus behavior
to ordinary full-page flashes.
Native no-op branches precede confirmation, cross-form discard and writes where the existing form does. Keep their
actions available and use the corresponding informational or successful receipt without an empty PATCH. Likewise,
retain native local validation for enabled Upload/Add actions and existing confirmation boundaries. Feature-selected
success keys distinguish properties, images, event links, permissions, named administrators and lifecycle commands;
a generic Saved message does not establish parity with each native outcome. Canonical creation/deletion delivery
retains its typed one-time native notice through the shared confirmed-navigation owner.
Pending work, uncertainty and unresolved read/refresh warnings remain durable until their corresponding recovery or
acknowledgement. A successful read clears only its own warning, including an equal-JSON response. Retain typed message
keys and parameters for reactive translation, and keep one-time notices through their intended committed redirect.
Use `useReadRetry` for every explicit Retry that depends on a server deadline, including creation, metadata, detail
reads, selectors and failed Overview targets. A reactive computed cannot observe time passing on its own, and an
inactive observer cannot supply that wakeup. The helper delegates to `canRetryRead` and wakes only to update
availability at the server deadline; it never starts a GET on its own. Guard the handler with the same availability.
Do not derive lifetime from translated text, let unrelated mutations renew an alert, or report a saved command as
failed because its dependent read or destination failed.
Repeated identical validation or no-op outcomes are new receipts. Use the shared feedback owner's `errorRenewal`
so each receives its full native dismissal interval; locale changes and unrelated renders do not renew it.
Check the binding in each actual consumer, including shell actions: Header logout uses the command's receipt,
not translated error text, to renew its notice. A shared helper test alone does not prove that adoption.
Success receipts and full `PageMessage` outcomes follow the same rule. Renew by document/outcome identity, never by
translated text; a locale change must neither revive an expired body nor steal inline focus. The Vue timer delegates
to the shared native alert implementation with receipt-owned renewal, leaving native content-renewal behavior intact.
When native wording depends on the operation, pass a named `problemKey` presenter to the existing command/feedback
owner. Select only from validated known Problems; keep their wire code/status and unknown safe-detail handling.
Do not rewrite a generic API error globally to imitate one form's message.

Read-driven region navigation follows the native URL contract: read the target before committing history, merge
only that region into the latest query, and adopt server-clamped pages or a removed parent. Failed/obsolete target reads
retain the current URL, cards and focus. Preserve modified-click hrefs and independent filters; closing a hidden
region clears its open, parent and child-page parameters together. Reuse the existing query/delivery owners rather
than adding per-tab server navigation state.
Adopt the server's native normalized search text on ordinary initial/bookmarked reads as well as confirmed target
navigation, only while the field still represents its unchanged route input. A newer typed draft or pending target
keeps its own confirmation and focus. Pending authority and local drafts keep progressive controls mounted; only a
confirmed empty unfiltered region without a draft may remove its toolbar. Exercise equal-JSON Refresh and Back
against actual query/cache behavior without assuming object identity across different query keys.

### Baseline-to-observable verification

Use the existing baseline, feature edge cases and paired review as the review owners; do not introduce another plan
or registry. For each changed journey, connect its relevant behavior/edge-case IDs to the native executable owner,
the implemented consumer, the observable assertion and any explicit approved exception or remaining limit.

1. Establish the native oracle independently. Trace its routes, middleware, controller, Pug and browser collector,
   then compare native and pilot using the same records, actors, grants and entered values. Verify GET and POST
   admission separately, exact statuses/destinations/query context, validation order, payload semantics, visible
   labels and available actions, including pristine submits and controls that remain present without a write.
   Compare accessible names, roles, expanded/selected state, keyboard behavior and focus against native markup as
   well as the actual browser tree. A visually equivalent wrapper does not authorize different button semantics.
   Compare field types, required/min/max/step/length attributes, browser validation and authored wire constraints;
   a new client or schema limit is an observable change requiring approval, even when ordinary fixtures fit within it.
   Check the actual submission trigger and accepted operation domain, including supplementary-character length
   units and raw numeric/null/blank/decimal edits where native persistence supplies their interpretation.
   Distinguish known server rejection from local validation and unknown delivery when comparing retained secrets.
   Two consumers of the same new API do not independently prove native parity.
   Resolve each observed difference against the original approved decisions before changing either implementation
   or expected output. Keep unexplained failures visible in the paired review rather than editing the design or a
   capture expectation to make the new behavior its own oracle.
   Synchronize a fixture with committed observable state before its next action: a debounced search can replace
   its native disclosure after a premature click. Wait for the canonical URL and completed region read rather than
   extending arbitrary delays or weakening selectors. Check the current generated label and native accessible role;
   a valid conditional GET may finish with 304 instead of 200. Preserve failed diagnostic runs and distinguish a
   demonstrated harness assumption from an actual application difference before correcting either.
2. Exercise lifetime transitions at the production boundary. Hold an actual or synthetic HTTP response, then change
   actor, resource, document, locale or permission, or unmount the submitting editor before releasing it. Check that
   pending and unknown work remains guarded while obsolete values, grants, caches and explicit observer reads retire.
   Include newer successful reads during held writes, partially revoked fields, equal-JSON recovery, cancelled
   navigation, fragments and Back/Forward visits. Include a successful read that narrows field authority, then return
   to another language with its read held. Test an old cached projection appearing after a denial, recovery
   through a new admitted read, and Retry becoming available as a server deadline elapses without another request.
   Preserve local values, focus and original edit baselines.
3. Distinguish known rejection, confirmed persistence and unknown response loss. Test confirmed write followed by
   failed refresh, failed identity bootstrap and failed/cancelled lazy delivery independently. Retry must send only
   the eligible read or navigation, never the original command. Check whole-page consent before deletion, detached
   pending status, browser/update reload guards, reachable uncertainty Review and deliberate acknowledged exit.
4. Cross the real startup boundary when it changes. Test the HTML-emitted bootstrap and module/style URLs through
   the actual entry decoder and mounted app, including native denied and confirmed POST documents. A directly
   constructed context or SSR string cannot prove hydration preserved those outcomes. Wait for an actual hydrated
   control before testing SPA listeners; separately verify edits made before hydration through the shared mount.
   The root hydration marker does not mean a progressively loaded feature has completed its first admitted read.
   Before replacing/stopping a server or following a feature action, wait for that usable control/card and its region's
   completed read; a visible shell cannot establish a cold-route import or permission precondition.
   Exercise every draft control category the form renders: text/textarea, numeric values, checked/unchecked choices,
   selects and files. Check the resulting draft and eventual submitted payload, not only retained DOM appearance.
   Keep non-text restoration opt-in for draft controls and prove hidden admission fields and immediate-command
   controls are excluded. Hydration must not replay a command or initiate a file upload.
   Run the normal source workflow when development integration changes and the built workflow for release behavior.
   Assert the same document survives early editing and hydration; evidence HTML must not trigger a development
   reload. Follow the [Testing Guide](TESTING_GUIDE.md#frontend-pilot-coverage) for the separate watcher checks.
5. Compare presentation and behavior independently at desktop and mobile sizes. Load the actual fonts, icons and
   styles; inspect significant roles, empty/error states, dialogs, selectors, narrow wrapping and focus. Include the
   complete ten-second transient lifetime and durable recovery states, not just the first screenshot. Use exact
   native text, native no-op/validation availability, inline Close/focus/placement and stable measured geometry where
   that boundary matters. Preserve native wrapper/text-node placement and the gaps that follow from it. Compare
   horizontal-scroll ownership of ancillary hints and controls too; equal unscrolled dimensions do not prove that
   they move, clip or remain keyboard-reachable with the same container. Check locale changes after expiry and
   feedback delivery after its initiating host hides or
   retires. Retain and individually inspect changed images. Record source/build identifiers, executed checks,
   excluded failures and limits in the existing paired review. Do not describe an earlier build, missing provider
   round trip or unrun journey as current verification.

Choose the cheapest stable test layer for each distinct risk; broaden only when another boundary requires it.
An independent source review checks ownership and approval against the original decisions as well as the assertions.
Documentation reports remain optional and advisory. Maintained prose and images are never application-test or CI
assertion inputs, and documentation reconciliation introduces no delivery gate.

### Progressive loading and shared placeholders

The explicitly approved [2026-10-08 delivery amendment](../../FRONTEND_FOUNDATION_DESIGN.md#authorized-progressive-delivery-amendment-2026-10-08)
keeps the same Vue SSR/hydration architecture while allowing interactive reads to complete independently. Initial
Overview waits for authoritative session bootstrap, then sends its shared shell. Mounted active collection/visibility
regions load through their existing scoped API/controller instead of delaying HTML for a sequential four-region
projection. Closed hidden regions start on opening; a hidden deep link can load before its main-region counts.
Help retains complete authorized SSR content, and the server renderer does not call its own HTTP routes.

Reuse `src/frontend/components/LoadingSkeleton.vue` instead of feature-specific loading markup. Its `variant`
selects `lines`, `form`, `table`, `cards` or `article`; `lines` is the default. `rows` defaults to three decorative
repetitions, not a known number of records or fields. Its optional `label` overrides the shared localized
`common.loading` status only when the owning region needs a more precise accessible explanation. Shared CSS owns
responsive geometry and reduced-motion behavior. The stable `data-loading-skeleton` attribute identifies the variant
for focused behavior checks without coupling tests to decorative shapes.

- Mount real independent controls as soon as their required authority permits. Query results replace only their
  own missing-content placeholder; a slow sibling must not hide already-ready content or gate the whole page.
- Show an initial skeleton only while scoped data is genuinely missing and the query is pending, with no terminal
  read error. `isFetching` alone also describes background work, so it must not replace confirmed articles, cards,
  input controls, selected values or drafts. Mark confirmed content busy during background reads, while leaving the
  initial skeleton's live status outside an `aria-busy="true"` ancestor so its announcement is delivered immediately.
- Preserve original edit baselines and local input independently of server snapshots. Background reads must not
  recreate focused controls or erase unsent input. Keep existing cancellation and late-response guards. Never use
  a generic previous-data fallback across identities or resources. A same-resource locale read may retain
  user-authored values and machine state while labels translate reactively; language-owned article bodies must
  match the selected locale rather than borrowing the previous language's content.
- Unknown counts use a neutral placeholder or remain absent until authority arrives; they do not claim zero or
  trigger an empty/no-match branch. Confirmed empties and failures retain the existing feature-specific semantics.
  End initial skeletons after a terminal error rather than displaying indefinite loading alongside the notice.
- Let each loading region announce one localized status. Decorative companion placeholders can be hidden from
  assistive technology; shapes themselves have no field, table, focus or count authority. Preserve loaded semantic
  headings, labels and result relationships. Reuse shared reduced-motion styling rather than adding local animation.
- Retain complete read-only SSR where the feature requires it. Interactive no-JavaScript pages expose the approved
  shared message/Help fallback; skeletons must not turn that fallback into an indefinite loading promise.

Use the cheapest test boundary that demonstrates observable incremental behavior. Deferred synthetic HTTP responses
can prove that one region becomes usable before another, a focused draft survives reads, locale bodies remain isolated,
and real empty/error responses end placeholders. `tests/frontend/frontend-content-loading.spec.ts` exercises those
Help/Overview boundaries and same-component SSR without maintained-prose assertions. Shared shell/component and
feature-owned identity/selector tests protect their respective boundaries; a real-browser check is warranted when
hydration, route download or responsive visual geometry is the changed behavior. Record actual execution in the paired
review, not as an implied release condition in this staged guidance.
Verify real hydrated controls after changing these effects: readable server HTML alone cannot expose a browser
update loop.

Admission failures reuse the existing `PageMessage` card and Home action, preserving the native status and avoiding
resource queries. Unknown-command review describes uncertainty independently of whether current values changed;
an unchanged snapshot still needs deliberate acknowledgement, but must not be labelled as a detected conflict.

For example, adding another editable setup field changes its authored PATCH/read schema, named controller comparison
and shared form binding. The existing command, feedback, context, localization, refresh and update owners supply the
rest. A complex financial command keeps its established review protocol instead of inheriting this field example.

## Current code patterns

The repository is not governed by a single formatting tool or a class-per-file convention. Follow the neighboring production code and preserve these architectural boundaries.

### Readability and shared contracts

Human readability and the established application patterns are acceptance criteria, alongside DRY, separation of
concerns, a single source of truth, and information hiding. Preserve local indentation, spacing, wrapping, and naming.
Keep formatting changes within the work being reviewed.

Visual consistency is a core acceptance criterion across the application and its exports. Reuse established
components, spacing, typography, and interaction patterns before adding a feature-specific treatment. PDF sections
use the existing shared `sectionTitle` style and document conventions; formulas remain readable as one complete
equation per row. Any change affecting PDF output requires regeneration and visual inspection of every affected page
before another PDF-affecting change.

Every complex method requires method-level JSDoc describing its contract **and internal code comments explaining its
steps**. JSDoc does not count toward the internal-comment requirement. Place purposeful comments at the meaningful
phases so a maintainer can follow input selection, checks, transformations, writes, side effects, and recovery in
execution order. Explain intent and constraints, especially transaction ordering, authorization, inherited state,
and exceptional behavior. Keep comments current; do not substitute a summary above the method for an explanation
inside it or repeat obvious expressions mechanically.

Pug templates and mixins need the same level of explanation. Document each mixin's parameters, required render data,
shared request context, meaningful branches, and browser-facing DOM hooks with unbuffered `//-` comments. Explain why
page scripts and optional state are loaded at that page boundary, especially where the same mixin serves different views.

Use descriptive names, named helpers, and straightforward control flow. Avoid excessive anonymous functions, nested
lambdas, or chained transformations that make a workflow difficult to follow. Short callbacks remain useful for an
obvious mapping, predicate, or established framework boundary.

Re-exporting imported functions, values, or types is forbidden. Import directly from the module that owns the
implementation or declaration; do not introduce forwarding exports or barrel modules to preserve an old import path.

Once a feature has a central wording catalog, all of its visible messages, labels, help text, accessibility text,
validation feedback, emails, and exports must use it. Distributed feature strings are prohibited. Use stable typed
keys, complete messages with named parameters, and locale-aware plural forms; do not concatenate translated fragments,
insert English verbs, or append English plural suffixes. Select wording and plural rules from the same supported
catalog, with an explicit fallback. User-entered content and immutable historical notes remain data.

Shared type-only contracts belong in `.d.ts` files under `src/types/`, following the existing declaration-file pattern.
Executable constants and functions belong in `.ts` modules. Keep private implementation types and repository details
inside the module that owns them instead of exporting them merely to connect newly introduced layers.

### Routes

- Use `express.Router()` in a feature route module.
- Mount a page router explicitly in `src/app.ts`.
- Mount a feature API router in `src/routes/api.ts`.
- Mount a versioned pilot API router in `src/routes/api/v1.ts`; keep pilot page routes explicitly allowlisted in `src/routes/frontendPilot.ts`.
- Keep middleware order visible in the route definition.
- Wrap asynchronous request and parameter handlers with `asyncHandler` or `asyncParamHandler`.
- Reuse `createGuestFlowRouter` where the entity follows its common create/view/duplicate/delete/guest model; do not force a feature into that model when its behavior differs.

### Controllers and services

- Controllers normalize request data, coordinate services, prepare render data, and choose redirects/messages.
- Put business/authorization/validation checks and context-specific errors in the controller layer or its dedicated
  feature modules. Controllers orchestrate these modules and the existing services. Services must not
  throw `APIError`, `ExpectedError`, or other request/UI-specific errors: they are pure DBAL.
- Database services are functional database service modules that export functions; they do not require a service class or dependency-injection container.
- Extend an existing controller, service, or middleware module when the responsibility already belongs there. Keep cohesive operations together; a new module must have a distinct responsibility, not just forward calls to another module.
- Keep repository access and transactions in `src/modules/database/services/` rather than routes or controllers or the feature modules they orchestrate.
- Expose operations that describe the domain workflow. Keep repository selection, query construction, and lock ordering private to the persistence boundary.
- Use a TypeORM transaction for multi-record writes that must succeed or fail together.
- For a rule requiring locked data, let the service own transaction creation and locking, then invoke a named
  operation from the corresponding controller or its feature module with the locked rows and manager. Checks and
  writes remain inside that transaction; never weaken atomicity by moving the check before lock acquisition.
- Preserve the distinction between account IDs, guest IDs, profile IDs, entity IDs, item IDs, and event-registration IDs.

### Authentication and permissions

- Local login, guest identity, and OIDC all converge on the session's active profile.
- The OIDC implementation uses `openid-client` directly and persists PKCE/state material in the database-backed session.
- Use the middleware exported by `src/middleware/permissionMiddleware.ts`; do not invent a parallel authorization vocabulary.
- Page admission, action permission, entity ownership, item ownership, event participation, and delegated administration are separate checks.
- General permission grants combine cumulatively. Surveys intentionally use their own participation model. See [Permission-System Reference](../../PERMISSIONS_REFERENCE.md).

### Errors and responses

- Throw `ValidationError` when a page form must be re-rendered with submitted data.
- Throw `ExpectedError` for an anticipated user-facing failure.
- Throw `APIError` for structured API failures.
- Let the page or API error chain format the response; avoid independent ad hoc catch-and-response logic unless the neighboring workflow deliberately uses flash-and-redirect behavior.
- Use `src/modules/renderer.ts` for the established page/JSON response shape.

### Views and browser code

- Keep visible labels and form field names aligned with controllers and user documentation.
- Put reusable Pug fragments under `src/views/modules/` and feature views under the existing feature directory.
- Pass optional feature and page state through the renderer's `data` object and explicit Pug mixin arguments. Reserve `res.locals` for the established common request infrastructure; do not introduce a second feature-state channel there.
- Put shared browser behavior under `src/public/js/core/` or `src/public/js/shared/`; keep page-specific behavior in its feature module.
- Treat generated `.gen.js` files as outputs, not source.
- Consider both the server-rendered fallback and enhanced browser behavior when changing a form or action.

`notifications.ts` is loaded unconditionally by the shared layout. Its `initAlertDismissal` observer covers server
flashes and inserted or renewed `.alert` / `role="alert"` messages, dismissing each after ten seconds. Use
`showInlineAlert` for text-only transient feedback. Reusable containers can use `scheduleAlertDismissal` with a clearing
callback; cancel their timer when changing to ongoing progress. Persistent conditions use `.status-notice` and
`role="status"`, without alert semantics. Keep required warnings and in-flight financial status visible. Observer cleanup
cancels timers on removal or page exit; restored pages restart observation.

### Root property dialogs

Keep the field-to-permission policy and page projection in `entityAdminController`; add feature normalization to the
existing feature controller and atomic persistence to its existing database service. Pass `data.entityProperties`
and `data.archive` explicitly to the shared modal. Shared contracts belong in `src/types/EntityPropertyTypes.d.ts`.
Only editable values enter the projection, and the browser sends only changed fields. APIs reject unknown or
unauthorized fields before persistence; an omitted checkbox is unchanged, while an explicit false clears it.

`entity-properties.ts` owns draft restoration, local feedback, and the dialog write lock. Existing command modules
acquire its host through `ui-helpers` and keep their established endpoints. Validate local prerequisites before
starting a command. Hidden picker fields need captured initial values for cancellation because changing a hidden
input also changes its DOM default. Preserve current drafts when an export opens another tab. Presentation-only
audience/search controls opt out of draft tracking. Tab changes retain drafts; native validity reporting opens any
collapsed property family containing an invalid field before focusing it.

Event creation and `POST /api/{activity|packing|drivers}/:id/event` authorize the submitted destination with effective
`MANAGE_ASSIGNMENTS`. Reassociation also needs the child's current `EDIT_META` and the expected previous event ID.
Keep relationship persistence and deterministic parent/child locking inside `EntityLifecycleService`; activity
invalidation is decided by the activity controller using its existing persistence/job boundaries. Picker options come
from `GET /api/event/link-options`, with server validation, permission-prefiltered database pages, a final engine check,
and opaque continuation tokens. The browser replaces result pages and retains only current/saved selection labels
plus a bounded cursor history. Never substitute assignment presence
or ownership alone for the shared cumulative evaluator.

### Named email delivery

Every mailer entry point requires an `EmailRecipient` with `{name, address}`. Use the actual account, guest, or active
profile name; do not infer a person's name from their email address. `resolveEmailRecipientName` collapses whitespace
and selects the first nonblank name from actual identity values, such as a profile name followed by its owner's name or
username. Registration stores the normalized display name and falls back to the submitted username when it is blank.
Addresses containing line breaks are rejected. Nodemailer receives an Address object in `to` so
the recipient display name is preserved. `renderEmail(subject, content, recipient)` supplies exactly one named greeting
before the heading in HTML and plain text, including for older string content or content with an explicit greeting.
Text and recipient names are escaped in HTML, and action URLs retain the HTTP(S)-only check. `createMailOptions` exposes
the same rendering boundary for tests without SMTP delivery.

Shared email contracts live in `src/types/EmailTypes.d.ts`, with direct imports rather than type re-exports from
the mailer. `sectionGroups` can group existing structured sections under one title. A group with `disclosure: true`
uses native `details`/`summary` semantics: supporting clients collapse it until activated, while its actual contents
stay in the HTML without CSS hiding, a hidden attribute, scripts, or checkbox controls. Email sanitizers and native
disclosure support differ; do not promise a particular client's collapsed rendering without client verification.
The plain-text alternative always includes the group title and all section facts, formulas, rounding notes, and links.
`actionPosition: 'beforeSections'` places the main action after the message context but before ordinary sections and
groups in both alternatives. Omitted options preserve the existing layout and action order for other notifications.

### Database changes

A schema change normally requires:

1. Update or add the entity under `src/modules/database/entities/`.
2. Add a migration under `src/migrations/` for existing installations.
3. Run `npm run generate`.
4. Exercise the migration against an appropriate disposable database.
5. Add integration coverage using the production `DataSource` metadata.
6. Update configuration, operator, architecture, or user documentation where the data contract changes.

Never rely on production `synchronize`; it is disabled.

### Entity archival

The existing `entityAdminController` owns shared lifecycle actions and authorized presentation, while `userController`
owns personal overview visibility. `adminApiFactory` registers the shared lifecycle API. `EntityLifecycleService`
keeps root selection, parent loading, transaction locks, and archive/restore writes together;
the existing `UserService` owns profile visibility persistence and single-target membership queries; `userController`
decides eligibility under its service-managed lock. Feature services
retain their own membership predicates. `modules/archive/policy.ts` is the single computation boundary, and
`getArchivePresentations` supplies authorized controls to shared cards and notices. Keep these rules out of individual
feature controllers and avoid per-card parent queries.

The shared API commands are explicit and retry-safe:

| Request | Body |
|---|---|
| `POST /api/{type}/:id/archive` | `{}` |
| `POST /api/{type}/:id/restore` | `{}` |
| `POST /api/{type}/:id/archive/automation` | `{ "paused": true }` or `{ "paused": false }` |
| `POST /api/users/overview/:entityType/:id/visibility` | `{ "visibility": "default" }`, `{ "visibility": "hidden" }`, or `{ "visibility": "shown" }` |

Never accept profile IDs, timestamps, stored parent state, or other arbitrary fields from the browser. Follow the [archival authority contract](../../PERMISSIONS_REFERENCE.md#archival-authority-and-personal-visibility), including the survey exception. A private preference may change placement only after existing overview membership is established.

Render lifecycle actions through `module_entity_archive.pug`, passing the optional notice state in renderer data and
explicit mixin arguments. Personal actions are an explicit card argument; dashboard placement comes from the bounded
overview service. The shared browser module delegates commands so inserted cards work, keeps one page-wide mutation
lock, and waits for structured success before refreshing all appearances. It does not infer archival dates or parent policy.

Archive and restore write only lifecycle fields and do not call deletion, invoice recalculation, or file operations.
Permanent deletion remains the simple repository delete in each existing feature service, with database foreign keys
handling dependent rows. It does not pass through the archival service. Polymorphic visibility preferences may outlive
a deleted target; overview discovery always starts from existing entities, so these rows cannot create cards or grant
access. New and duplicated roots receive fresh IDs and default lifecycle state. See
[Database and Migrations](../../DATABASE.md#entity-archival-state) for persistence and concurrency details.

### Paged profile overview

Keep overview persistence in `UserService.getOverviewPages`, request normalization and presentation in
`userController`, and shared contracts in `types/UserTypes.d.ts`. Reuse the feature participation query builders and
`EntityAdminService.createManagedEntityQuery`; drivers participation, survey ownership, and zero-mask administration
assignments retain their existing meanings. Event registration or ownership never grants membership in every child.

The service joins personal preferences and uses `EntityLifecycleService` for shared archival query inputs. SQL
placement must agree with `isEffectivelyArchived` and `isHiddenInOverview`. An event represents a child only when both
independently qualify in the same collection and region, before filtering. Apply text/type matching to the underlying
roots, map matching children to those eligible parent cards, then sort and page the combined grid in SQL. Escape
literal search wildcards and retain type/UUID identity. Reuse those predicates for counts, selected-event children,
and fallback cards; do not group or filter a complete hydrated dashboard in application or browser code.

One service-owned read snapshot covers cards, totals, placement, and lifecycle inputs. Pass its raw `ArchiveSnapshotEntry`
map to `getArchivePresentations`; the shared controller projects effective state without rereading after paging. Batch permission projection for the returned
cards and their necessary parents; a fallback parent's title and link require its `ACCESS_VIEW`. Never reuse a
rendered expansion button as authorization for a later read. The selected event and each child are revalidated on
every request, and stale selections/pages resolve to the remaining valid overview.

The full-page and region API routes share controller normalization and server-owned page limits. Their namespaced
URL state preserves independent collection/region filters, pages, and selection. Both render through the existing
`data` channel: `renderer.renderWithDataToString` uses Express locals for a layout-free fragment without creating a
second card implementation. `entityCard` owns ordinary, expandable, and enclosing-card markup; `entityCards` owns
the responsive grid. Keep paged navigation an explicit browser initialization option so shared event **Things to do**
retains local filtering. Replace previous region content, release closed hidden bodies, and keep request-generation
checks and the archival mutation lock when extending navigation. Database work can grow with membership size even
though returned cards and DOM are bounded; measure query plans and first/late-page behavior before adding indexes.

### Invoice pool calculation and saved changes

`eventPoolController.ts` provides route implementations by orchestrating request context, DBAL data, and the
business modules under `src/modules/invoice/`, following the existing activity feature-folder pattern. It does not
contain the allocation algorithm, persistence policy, message construction, or proof-retention implementation.

| Owner | Responsibility |
|---|---|
| `requests.ts` | Existing request-field validation and normalization. |
| `calculation.ts`, `distribution.ts`, `settlements.ts` | Shared preview/commit allocation, exact rounding and provenance, and signed cumulative settlement projection. |
| `poolOperations.ts`, `invoiceOperations.ts`, `takeovers.ts` | Locked business transitions, input restoration, review policy, and coverage changes. |
| `coverage.ts` | Pure shared saved-coverage evidence selection, pair normalization, pending comparison, and applied old-to-new deltas. |
| `state.ts`, `validation.ts` | Reused revision/membership policy and financial/revision constraints. |
| `wording.ts`, `locales/en.ts`, `presentation.ts` | Catalog lookup, complete messages, plural selection, and consistent signed balance/status presentation. |
| `notifications.ts`, `settlementEmail.ts`, `exports.ts` | Post-commit notices and saved-share email/PDF presentation. |
| `proofs.ts`, `retention.ts` | Proof ownership and configured filesystem boundary, plus the existing cleanup schedule. |

Named feature operations run business checks inside `EventInvoiceService.withLockedPool`, then use DBAL reads and
writes with that transaction manager. `EventInvoiceService.ts` owns queries, root locks, transactions, persistence,
and stored aggregate columns. It throws no request-specific errors and decides no review, calculation, rollback,
or file policy. Repository details stay inside the service. Callers import each module directly; nothing forwards
another module's exports. Each `EventPoolAssignment` stores its own `factor` (default `1`, range `0`–`1000`,
up to four decimal places). Assignment membership and exemption are separate from the factor.
New assignments start at `1`; updating existing assignments preserves factors omitted by a caller.

The shared browser-safe `coverage.ts` policy imports only declaration contracts. Both `poolOperations.ts` and
`presentation.ts` consume it directly; business operations do not depend on a renderer, and the presenter exposes
helpers only on its explicitly passed renderer object. No consumer re-exports those imports. Keep this common
evidence policy separate from locked takeover writes and pure DBAL persistence.

Pool status has three values. OPEN permits participant submissions and self-service takeovers; ORGANIZER_ONLY displays
**Organizer invoices only** and closes both participant actions while retaining organizer costs, invoice review,
allocation editing, and calculation. OPEN and ORGANIZER_ONLY are independent initial states: creation's
**Invoice submissions** field offers **Open for invoices** and **Organizer invoices only**. Omitted initial status
keeps OPEN as the established default; a pool may also be created directly as ORGANIZER_ONLY. Either state can close
directly through the existing financial calculation, with no mandatory submission-access transition beforehand.
**Close participant invoices** and **Open participant invoices**
use a frontend review gate and `POST .../submission-state` with only `status: 'OPEN' | 'ORGANIZER_ONLY'` and the current
`expectedRevision`; confirmation is not an additional API field. The route requires `MANAGE_ASSIGNMENTS`, the
controller checks event ownership, and the named pool operation repeats lifecycle/revision checks under the same
root lock as invoice submission. A changed state advances the revision to invalidate a preview without replacing
costs, assignments, shares, or settlements. Either OPEN or ORGANIZER_ONLY can use the existing calculation command to become
CLOSED; this submission-access operation always rejects CLOSED pools. Organizer expenses remain available in every
state, and invoice review keeps its existing rules.

Apply `1790985600000-AddInvoicePoolOrganizerOnlyState.ts` when upgrading an existing database to support ORGANIZER_ONLY. The entity
enum and migration must be deployed together through the settings-aware migration workflow in
[Database and Migrations](../../DATABASE.md). Its down migration refuses while any ORGANIZER_ONLY pool exists; explicitly open
participant invoices or calculate and close those pools before downgrading. The migration never decides a business
transition or silently changes participant submission access. It extends the committed OPEN/CLOSED enum directly;
draft, unreleased enum values are not migration compatibility cases.

`POST /api/event/:eventId/invoice-pools/:poolId/invoices/organizer` records an organizer-entered invoice. Require an
authenticated profile, `MANAGE_ASSIGNMENTS`, and a pool belonging to the event; event registration is not required.
Validate a positive amount with at most two decimal places and a nonblank description; proof is optional, with the
existing image/PDF validation and size limit when provided. The optional `registrationId` identifies the participant
who paid. Leave it absent for the existing shared-expense default; selecting it must not create pool membership.
Validate the selected registration's event and pool eligibility inside the named invoice operation under the service's
pool-root lock. Persist APPROVED with the selected registration or null, independently recording `recordedByProfile`
and a `recordedByName` snapshot. Profile deletion sets the audit relation to null while keeping the name snapshot.
Participant submissions keep their registration and required-proof contract. Organizer creation remains available in
all pool states and sends no creation email.

Organizer creation uses `postOrganizerExpense` and `lockOnUncertainFailure`: a confirmed API 4xx rejection permits
correction, while network failures, server errors, or unconfirmed responses retain the form lock and a persistent
**Reload and check saved invoices** recovery action. Do not automatically retry this non-idempotent cost creation.

Organizer invoices contribute to accepted shared costs. An unassigned invoice creates no personal invoice credit,
including for a recorder who attends the event. An attributed invoice reuses the selected registration's existing
credit, own-history, receipt authorization, and own Accepted-invoice Close rules; enabled invoice deduction credits
that participant or their covering payer. Use the central **Paid by participant (optional)** and
**No participant — shared pool expense** labels, and explain the exact **Deduct submitter invoices from their share**
setting beside the selector. Optional proof applies to either choice. Adding an invoice to a closed pool advances its
revision and marks it stale without changing saved shares or payment markers. The existing nullable registration
relationship supports this option without a new entity change or migration. Keep the committed
`1789603200000-AddOrganizerInvoices.ts` migration unchanged and follow the recorder-audit rollback preflight in
[Upgrading and Rolling Back](../../UPGRADING.md); its existing down guard protects invoices with no registration.

Use this calculation order:

1. Sum effective amounts of Accepted and Closed invoices. Exclude Awaiting review, Rejected, and Retracted invoices.
2. Subtract the signed sum of adjustments whose `subtractFromPool` is true to obtain the distributable amount.
3. Multiply each non-exempt participant's equal/day/night weight by their factor, then normalize by the sum of
   effective weights. Round each resulting base to cents in the same direction: `roundUpShares=true` (default) uses
   mathematical ceiling; false uses floor. Equal effective weights produce identical bases. Use exact integer ratios
   for the cent boundary; do not distribute leftover cents by participant ID.
4. Add all signed participant adjustments exactly once. Negative amounts are rebates. Factors do not scale adjustments.
5. Deduct effective registration-attributed invoice amounts when enabled, including organizer-entered invoices assigned
   to a participant. Unassigned organizer expenses create no personal invoice credit. Factors do not scale invoice credits.
6. Combine each beneficiary's calculated components into the covering payer without applying the payer's factor again.

`invoiceAmount` is accepted invoice cost, `payableAmount` is the distributable remainder,
`additionalAmount` contains signed on-top adjustments, and `totalAmount` is invoice cost plus those
on-top adjustments. Do not clamp a negative distributable remainder. The preview reports the signed rounding
difference between summed rounded bases and the distributable amount; this small surplus or shortfall is intentional.
The reconciliation is `sum(base) + sum(adjustments) = totalAmount + roundingDifference`, then subtract invoice credits
and prior signed settlements to obtain the net calculated balance. Positive outstanding shares plus signed refunds equals
that net balance. Invoice reimbursement must not be mistaken for a missing share of the pool's gross costs.
A nonzero distributable amount with no positive effective weight must fail before replacing any shares.

Closed pools accept saved settings, assignments, factors, adjustments, and organizer takeover changes.
Calculation inputs invalidate the closed pool through `needsRecalculation` and advance `calculationRevision`.
Closed takeover changes are pending inputs: saving them sends no coverage notification. Read-only views select
applied pairs from the frozen snapshot, falling back to saved contribution attribution only when the takeover list
is unavailable. An explicitly saved empty list remains authoritative; baseline legacy data must never infer applied
coverage from current maps or parsed notes. Before CLOSED, current planning inputs count as known evidence. For CLOSED,
neither a saved takeover list nor saved contribution attribution means an unknown baseline; the pending comparison
returns false rather than inventing an old empty state. Show applied coverage first and **Pending takeover changes**
separately when a known normalized baseline differs, with the organizer chooser editing only those pending inputs.
The header and pending coverage group also show **Takeover changes pending**, keeping a staged relationship visible
before the pool or its detailed draft is expanded.
For an unknown legacy baseline, show the provenance warning and current editable inputs as
**Takeovers for next calculation** without claiming an applied delta.
These applied/pending overviews belong to organizer administration. Participant submission and takeover pool choices
remain OPEN-only; closed personal coverage stays inside the frozen payer explanation rather than additional pool cards.
Attendance and membership changes and accepted invoice changes must also invalidate affected pools.
Payment-state changes update settlement totals and advance the revision to invalidate an outstanding preview, but do not mark the calculation inputs stale. They remain permitted while `needsRecalculation` is true.
Automatic invoice retention is a deliberate exception: deleting expired source records preserves historical settlement
shares and does not itself require recalculation. It still advances the revision to reject a concurrent calculation
that read the deleted records. A later explicit recalculation uses only the records still retained.

`previewPool` prepares the same gross shares used by closing/recalculation and projects prior settlements without writes
or notifications. Its revision must still match when a preview is applied. Recalculation uses saved inputs, preserves
the CLOSED state, and replaces shares in one transaction. A failure keeps the previous shares and payments.
The same locked commit compares previously applied coverage with the final new snapshot, then returns the added and
removed pairs for post-commit notification. Intermediate staged edits, no-op changes, and failed calculations send
no coverage notices. First closure does not repeat planning notifications. These coverage notices remain independent
of `sendCalculationEmails` and a calculation's `sendEmails` override, which control only settlement messages.
A legacy calculation without applied evidence establishes its first baseline without speculative coverage notices.

The optional saved `settledRegistrationIds` identify active nonzero signed carried settlements. Derive those IDs and
credits from one cent accumulator: prior `paymentCreditAmount` plus each newly settled signed `shareAmount`, grouped
by actual payer. Never seed them from old IDs or dates. Preview and commit preserve a correcting share until its transfer
is recorded; the next recalculation clears fully consumed credit and its indicator. Remove a zero covered orphan row,
but keep an allocated exempt zero row as an ordinary share with no historical settlement date. Hard-deleted registrations are excluded.
Resolve retained exemption and coverage indicators through the pure frozen-evidence owner, ignoring pending inputs.
Compare old and new applied responsibility under the existing root lock, then send **Your payment responsibility changed**
after commit independently of optional calculation messages. Exclude those payers from optional bulk messages to
avoid duplicates. Staging, rollback and unchanged recalculation do not repeat the notice. These IDs carry no inferred
gross transaction amounts. Share ledgers, breakdowns, emails and PDF notes use the same localized presentation.

Pool hydration uses `relationLoadStrategy: "query"` inside a `REPEATABLE READ` transaction so multiple child collections
do not multiply into one large join and the pool revision, settings, and saved shares come from one snapshot. Mutations
retain their transaction locks and revision comparisons; optimizing reads must not weaken that boundary.

`projectInvoiceShares` carries money by the actual payer registration. For each previous share, cumulative settlement is
`paymentCreditAmount + (isPaid ? shareAmount : 0)`. The new `shareAmount` is gross liability minus that signed credit.
Positive credits represent money received; negative credits represent refunds made. Repeated calculations preserve the
credit without adding it twice. A previously settled payer who disappears from the new payer set retains a credit-only
share while their event registration exists and a nonzero carried credit remains. Never move that payment to a new covering payer implicitly. A zero
calculated balance requires no transfer. **Record payment** / **Record refund** and **Undo payment** / **Undo refund**
apply to the saved calculated balance, not to past carried credit. Their review dialog is a frontend gate: the existing payment API still accepts
the same `isPaid` payload. Acceptance, rejection, closure, and adjustment removal also have frontend review gates;
existing revision-checked correction/retraction contracts remain unchanged.

`wording.ts` and `locales/en.ts` own all invoice feature wording, including interface help, confirmation and validation
messages, accessibility labels, emails, exports, and operational feedback. Stable typed keys identify whole messages;
named parameters and `Intl.PluralRules` prepare them for later catalogs without distributed English fragments.
The current language is English; regional variants and unsupported locales resolve predictably to a supported catalog.
The client build emits the pure wording/presentation owners and locale catalogs under `shared/invoice/` as ordinary
browser modules. It resolves their direct source imports to those assets; do not copy the catalog, re-export its
bindings through a frontend wrapper, or expose server-side invoice business modules as browser entries.

`presentation.ts` owns signed financial presentation and the single settlement-status rule used by Pug, browser
updates, emails, and PDF exports. The primary **Calculated balance** is the saved `shareAmount` after carried credits,
and stays visible whether settled or not. Status labels contain at most two words: **Payment due** means the named payer
must pay; **Refund due** means the named payer must receive a refund. Recorded transfers use **Paid** or **Refunded**;
a zero balance uses **No payment**. The **Settled** filter combines those final states.
Internally, the unsettled amount becomes zero on settlement, while the signed calculated balance preserves the
amount recorded. Aggregate unpaid transfers use that unsettled amount; views need no duplicate settled or unsettled
component row when the calculated balance and status already explain the transfer. Refunds stay negative throughout.
Compact settlement buttons retain their action label while saving and overlay progress on the existing icon.
The saved result updates status and action wording without recreating or automatically reordering payer rows.
The legacy persisted `creditAmount` stays a positive magnitude and is projected once for display.

Pass presentation helpers through renderer `data` and explicit mixin arguments; serialize the label catalog for
browser controls. Programmatic DOM hooks are independent of translated labels. Settlement actions use the same
compact outlined button style as the rest of the ledger, with an explicit review gate before any request.

Each newly saved calculation adds optional numeric `explanation` data to the existing JSON snapshot. Attendance totals,
eligible units, factors, exemption flags, per-participant contributions, and exact integer weight ratios come from the
same calculator used for the allocation. Takeovers combine already rounded contributions. Views, notifications, and
exports read that saved explanation; they never reconstruct it from subsequently edited inputs or parsed notes.
Older snapshots keep their saved amounts and show that the numeric basis is unavailable until explicit recalculation.
This JSON extension requires no entity or schema migration. Shared contracts remain in `src/types/InvoicePoolTypes.d.ts`.

Keep invoice overviews focused on meaningful source and settlement context. The collapsed closed-pool header preserves
**Full pool total**, **Payments due**, and signed **Refunds due**. Expanded summaries keep those primary amounts and show
**Base to distribute** when redistributed adjustments are used. The two due totals remain present when every share is settled;
zero outstanding money must not make the settlement summary disappear. Preserve these transfer totals in previews as well.
Distinguish redistributed surcharges, redistributed rebates, on-top surcharges, and on-top rebates whenever each is used.
Positive and negative totals must remain separate even if they cancel: a zero net amount does not mean no adjustment
was applied. A redistributed surcharge reduces the base to distribute; a redistributed rebate increases it. On-top
adjustments leave that base unchanged but change the full total and the affected payer's result.
Fresh CLOSED summaries with known saved cost provenance omit duplicate source amounts already listed in the global
breakdown. Open, stale, and legacy summaries retain applicable current source costs and adjustment categories.
Nonzero **Accepted invoice costs** remain available: the effective amounts of Accepted invoices not yet marked Closed,
rather than Awaiting-review submissions. Saved details retain applicable
**Invoice credit**, **Previously settled**, **Payments received**, negative **Refunds paid**, and **Rounding difference**.
Received/refunded totals show only positive/negative balances marked settled in this saved calculation. Keep carried
credits separately as **Previously settled**, including a zero net aggregate when opposing carried credits are present.
Never infer gross historical payments or refunds from an already netted carried credit.
When stale, label **Current pool costs** and **Saved settlement totals** separately. Preview reconciliation and share
component rows/columns expose invoice credits, previous settlements, adjustments, and rounding differences only when
applicable. Omit unused amount rows and unrelated derived totals without removing meaningful financial context.
Keep the signed calculated balance primary, with settlement status independent of that amount and saved notes available
in **View breakdown**; omitting inapplicable zero components must not remove the audit trail.

`presentation.ts` owns shared structured calculation projections. Keep contextual source data and explanatory
arithmetic separate as a core representation rule. `invoicePoolCalculationBreakdown` returns the metrics-only
`InvoiceCalculationOverview`, containing global saved cost figures, used signed adjustment categories, and contextual
assigned-participant, day/night, eligible-unit, exemption, and total-weight metrics. Its type has no formula,
description, or note-item fields. Never place equations or explanatory prose inside the global **Calculation breakdown**.
Missing inputs are a labelled **Saved calculation inputs: Not saved** metric, rather than a prose section or an
invented calculation. For legacy numeric evidence, keep known amounts and use **Full pool total: Unavailable** when
saved provenance cannot establish that figure. Available contextual figures remain in organizer details, previews,
and both PDF variants.
`invoicePoolCalculation` places total/base cost arithmetic and explanation first in **Example calculation**, followed
by one qualifying anonymous payer's arithmetic. Reuse the same saved cost basis for figures and example operands;
renderers must not derive another set of totals or flatten formulas into metric strings. `invoicePayerCalculation`
explains the actual selected payer's complete calculation in the breakdown dialog and settlement email. Keep that personal explanation
inside the breakdown; do not attach an independent pool example or personal-calculation block above each ledger row.
Use the saved real names for every own and covered contribution, suppress unrelated payers, and combine already
rounded base shares before applicable adjustments, invoice credits, and prior settled credits determine the saved
balance. When takeovers are used, show the actual covered count and names before individual beneficiary formulas.
A former payer's credit-only row must never borrow another payer's attendance or base formula.

The anonymous example considers only supplied saved shares with a positive `shareAmount` and an own, nonexempt
contribution attributed to that same payer. Exclude covered participants, exempt payers, refunds, and zero balances.
Prefer candidates without beneficiaries, then candidates with positive own effective weight within each coverage
group, then an own redistributed surcharge before the largest number of actual nondefault-factor, adjustment-category, invoice-credit, and prior-credit
features. Reuse the financial component projection so cancelling signed source categories still count and unreliable
historical categories keep their honest net fallback. Break ties by saved registration identity; names, current
profile, and input ordering must not choose a different example. Order covered contributions by saved identity too.
A positive fixed balance with no own automatic weight may serve as a factual fallback, showing its zero-base inputs
without division. If coverage is unavoidable, its introduction states the true number of other beneficiaries before
any payer formula. If no candidate qualifies, retain a cost-only **Example calculation** when saved numeric evidence
can explain the pool totals; its introduction names that purpose and introduces no participant. Never manufacture a
refund, exempt, or legacy personal example from missing provenance. Entirely missing explanation data produces no
example heading; legacy numeric evidence may retain honest cost arithmetic while disclosing unavailable provenance.

Personal explanations abbreviate exempt or zero-weight rows when none of their own or covered contributions has
positive nonexempt weight. Omit unrelated shared cost/divisor sections while retaining coverage names, exemptions,
actual zero-weight inputs, applicable fixed adjustments and credits, and the signed saved final balance. If an
eligible covered contribution has positive weight, retain the shared context needed to follow its base calculation.
Personal explanations retain relevant self-contained distribution numbers and omit the global **Full pool total**
equation; explain only the payer's applicable on-top adjustments beside their final balance. Pool cost explanations
separately name **Invoice costs**, **Base to distribute**, and **Full pool total** when used adjustment modes make those
scopes differ. Full pool total is invoice costs plus signed on-top adjustments; base to distribute is invoice costs
minus signed redistributed adjustments. Ordinary pools without adjustments use one cost metric; explain that equality
only inside **Example calculation**, preserving the ordinary labels. Keep used signed adjustment categories and relevant
cost scopes distinct even when their amounts coincide. An older snapshot lacking category evidence discloses the
unavailable full total within the example. Redistributed adjustments move costs between
the shared base and the affected payer without changing the full pool total; on-top adjustments change the full pool
total and affected payer's balance without changing the shared base.

These projections use shared arithmetic building blocks and `.d.ts` contracts. Keep the metrics-only overview distinct
from explanatory sections with named formula terms, results, and rounding notes. Render explanation structures as
labelled, formatted steps in Pug and email; render global figures only as labels and values. Avoid a large unformatted
paragraph or a separate renderer-specific formula implementation. Name every applicable multiplier
and divisor, including attendance in the saved distribution mode, share factor, and total weight. Use actual saved
values and rounded contributions. Explain only used adjustment categories and why they change the shared base or
full total. Saved calculation notes record actual facts; they neither replace the arithmetic explanation nor become
anonymous examples. Keep the original `share.note` intact and escaped in app, PDF, and email; its established bullet
separator only divides saved items for rendering. Ordinary email messages, labels, and actions directly address the
recipient; immutable notes and the full named explanation retain their recorded attribution and authored descriptions.
Never synthesize replacement notes, rewrite historical phrasing, or put a second **Saved source notes** section inside
the calculation. Settlement emails show **Saved calculation notes** before and outside the optional
**Calculation explanation** disclosure. Keep the main signed balance, status, context, and leading action visible
before either section; plain text retains every original note and concrete calculation step.
All explanatory sentences and component labels remain catalog-owned. New snapshots may store optional numeric
adjustment provenance in the existing JSON contract. For older snapshots, read available frozen provenance or disclose
its absence; never infer gross categories from a net zero amount, parse notes as numeric evidence, or use current edits.

A successful calculation saves `calculationSnapshot`: pool-local settings, assignments/factors, adjustments, takeovers,
and a fingerprint of external calculation inputs. `rollbackPoolChanges` restores those local inputs transactionally
without touching shares/payment records or sending emails. Event registrations, attendance dates, invoice reviews,
and organizer-entered invoices are not reverted. The external fingerprint includes every counted invoice's identity,
registration attribution, and effective amount, including both unassigned and participant-attributed organizer costs.
Adding either kind after calculation leaves the pool stale after local rollback. A fingerprint mismatch or
missing registration leaves the pool stale after local rollback. Legacy
pools without a snapshot cannot roll back until a successful calculation establishes one.
Rollback uses the same pure coverage selector to restore older contribution-certified pairs when the explicit
takeover list is missing. If neither frozen source is available, reject with the existing incomplete-snapshot error
before any input writes; retain current inputs, shares, and payment records without inventing prior coverage.

`sendCalculationEmails` is the pool's stored default; close/recalculate accepts a `sendEmails` override. Notification-only
settings changes do not require recalculation. A separate closed-pool notification endpoint sends the saved settlement
without recalculation. Its organizer dialog closes only after confirmed success and pending-state cleanup; failed or
unconfirmed requests keep the dialog open with feedback and restore its controls. Preserve the existing endpoint and
request contract. `buildInvoiceSettlementEmail` reads `isPaid`, signed payment credit, and the residual amount so
settled shares never appear outstanding. Notification delivery is queued after persistence, outside the transaction.
Invoice acceptance, rejection, and closure also confirm persistence before queuing SMTP delivery. Catch and log delivery
failures independently of the financial response. If a review loses a concurrent state transition, return 409 and do not
send a notification implying that the losing review succeeded.
For participant-attributed organizer invoices, calculation credits, review notifications, and own-history/proof access
follow the existing registration relationship; the independent recorder audit does not confer ownership or change the
recipient. Creation itself retains its existing no-mail behavior.

Accepted and Closed invoices support `POST .../invoices/:invoiceId/revise` and `reject-accepted` for authenticated
organizers with `MANAGE_ASSIGNMENTS`. Both require JSON `confirmed: true` and the current pool `expectedRevision`;
an extra confirmation dialog displays the proposed change before committing. Revision accepts explicit
`correctedAmount: number | null` and `correctedDescription: string | null`, with null restoring the original value.
It preserves the Accepted/Closed status and original fields. Retroactive rejection requires `rejectionReason`, changes
status to REJECTED, and retains existing corrections as well as original details, proof, and recorder attribution.
Both invalidate a closed pool without changing saved shares or payments. These external invoice changes survive
pool-local rollback and are included by the next calculation. The original submission and current correction fields
are preserved; there is no separate chronological review-audit table.

`POST .../invoices/:invoiceId/retract` uses the same confirmation/revision contract but requires ownership of the NEW
invoice through the active profile's registration, with no administrator override. It works in all three pool states,
persists RETRACTED, and retains details/proof. Because NEW invoices were not counted, retraction advances the pool
revision while preserving its current stale flag, shares, and payments. Named correction/rejection/retraction receipts
are queued after commit. Apply `1789689600000-AddInvoiceRetraction.ts` to extend the stored enum; its down migration
refuses while Retracted invoices exist instead of rewriting or deleting history.

The participant upload binder in `src/public/js/modules/invoice-submission.ts` owns progress, busy state, and recovery.
Successful persistence is acknowledged independently of SMTP delivery, clears only amount/description/proof, preserves
the selected pool in event-scoped session storage, and refreshes the page after a short success message. The
`#invoiceHistory` hook reopens the invoice sections. Inputs stay locked until navigation so no new draft can be lost;
the refreshed binder clears browser-restored invoice fields and restores the available pool selection. Each request
captures its own `FormData` before controls are disabled; completed-request callbacks cannot trigger duplicate navigation.
An uncertain network outcome must send users
to invoice history before retrying; never automatically resend a proof upload. Keep validation failures distinguishable
from failures where the server may have committed the invoice.

`runInvoiceAdminAction` gives pool mutations immediate busy feedback, blocks repeat actions, and adds a status update
after five seconds. Update ledger amounts and settlement state only from a successful server confirmation; use canonical
saved payment data when restoring controls after navigation or a failed request. Transient outcomes use the shared
`showInlineAlert`: page actions target `#liveAlerts`, and dialogs target their local `.pool-form-status` within the
modal's focus trap. Alerts are brought into view and expire after ten seconds. Confirmed outcomes survive an automatic
reload through event-scoped session storage and are restored after invoice-history navigation. Pending states remain
visible until completion. Settlement buttons show their own spinner; longer progress text goes below the ledger so inserting
it cannot move the clicked row. **Refresh list** acknowledges every click, including unchanged results.

The share ledger searches, filters, sorts, and pages the saved rows in the browser. Confirmed payments update row status
without rerendering the current list, keeping settlement actions in their current rows. **Refresh list**
or a search/filter/sort/page change reapplies the controls; an active status filter highlights the refresh action after
a payment update. Participants use the same ledger design across their own pool shares, with pool-name search,
status filters, sorting, configurable page size, and pagination suitable for hundreds of pools. Reuse the existing
browser ledger behavior and one read-only modal, filling the selected row's structured data lazily rather than creating
a modal for every pool. The **Share breakdown** dialog shows saved components, formatted concrete calculation steps,
and separate saved notes without expanding the table. Settlement emails place notes before the full calculation explanation. The portrait A4 PDF export at
`GET /event/:id/export/invoice-pools/:poolId/shares` requires `MANAGE_ASSIGNMENTS` and verifies that the pool belongs to
the event. It exports the complete persisted share set, independent of browser filters, with current payment status
and a stale-calculation notice when needed. Export must never recalculate or record payments.

The descriptive caption under the calculated balance uses only its saved sign and settlement marker: organizer
**Amount to collect** or **Amount to pay out**, participant **Amount to pay** or **Refund to receive**, and
**Already settled** or **No payment due**. This restores the existing caption behavior without adding another amount.

Both shares PDF variants place the global **Calculation breakdown** above the table as a list of contextual numbers,
including applicable cost, adjustment, and distribution metrics. The default **Export shares PDF with example** adds
**Example calculation**: total/base cost explanations and arithmetic, followed by one anonymous payer's steps when
a positive payer with reliable saved contribution evidence qualifies. A usable cost-only example remains valid
without a qualifying payer; never invent a person to keep that explanation visible.
**Export shares PDF without example** selects `?example=false`, validated by the existing invoice request module into
`InvoiceSharesPdfOptions.includeExampleCalculation`. It omits every generated explanation and formula, including
transfer-scope and stale-calculation paragraphs. Authorization, global contextual figures, saved share rows, original
factual notes, settlement status and dates, and settlement totals remain identical. A stale compact PDF uses the short
**Recalculation required** label. Do not render an empty example heading when numeric explanation data is entirely absent.
Organizer pool views put that structured example in a separate collapsed **Example calculation** disclosure beside
the figures-only **Calculation breakdown**. Previews use the same separate, collapsed sibling disclosure; their
global breakdown must remain exclusively a list of contextual numbers.
Keep this pool-level example distinct from concrete payer explanations in dialogs and emails. Combine any general
calculation hint with the example and omit
implementation references such as screen filters. The table owns every payer's applicable component amounts,
calculated balance, and settlement status. Preserve saved row notes,
but do not repeat the calculated balance or add the base formula beneath every payer. A recorded settlement contributes
its date to the notes, without repeating the amount already visible in the table. **Saved settlement totals** retain
**Payments due** and signed **Refunds due**, applicable invoice credits and previously settled credits, and transfers
recorded in this calculation as **Payments received** and negative **Refunds paid**. Do not infer gross historical
transfers from netted credits or repeat derived net balances and payer counts.
Reuse the shared `sectionTitle` heading for **Calculation breakdown**, the example, **Saved settlement totals**, and
**Calculated shares**.
In the with-example variant, keep one complete formula per row; independent equations must not share a cramped
side-by-side row. The without-example variant must not render formulas or explanatory paragraphs anywhere.
The PDF's `pageBreakBefore` policy moves every visible financial cell with ordinary saved notes. Allow oversized notes
to wrap across pages normally; globally unbreakable groups or `dontBreakRows` can lose content and must not be used.
After every change affecting PDF content or layout, regenerate representative exports and visually inspect every page,
including long names, detailed notes, negative amounts, and page breaks. Definition-level tests alone cannot verify
the rendered PDF's readability or prevent visual regressions.

Takeover overviews use Bootstrap tables with one payer per row and beneficiary badges in the adjacent cell.
`initTakeoverOverviews` in `src/public/js/modules/invoice-takeovers.ts` searches payer and beneficiary names and pages
by payer. Each group initially shows six beneficiaries; **Show all** expands its badges within a bounded scroll area,
and **Show fewer** collapses them. A beneficiary search reveals matching badges beyond the initial preview.
Editing stays in **Manage takeovers**, opened directly for the selected payer by the row's **Edit** button.
Applied coverage in a CLOSED pool is read-only; row editing belongs to its separate pending-input overview.
On small screens the same table cells stack with their labels, retaining the payer and beneficiary relationship.

Protect calculation arithmetic with unit tests, persistence and recalculation with the invoice integration suite,
and upload state transitions with frontend tests. Use a real browser for dialog wiring and the saved-edit workflow.

## Test selection

Use the cheapest layer that protects the behavior, then add broader coverage when a boundary is crossed:

```bash
npm run test:unit          # isolated server-side logic
npm run test:frontend      # browser helper and DOM-adjacent logic
npm run test:quick         # unit + frontend
npm run test:integration   # production services/workflows against disposable MariaDB
npm test                   # all Vitest layers
npm run build
npm run e2e                # focused Playwright flows; managed built server
npm run test:all           # all Vitest layers + build + Playwright
```

The integration suite rebuilds its selected MariaDB schema. The E2E initializer drops and recreates its selected schema. Read [Testing Guide](../../TESTING_GUIDE.md) before running either and never reuse development or production database names.

## Common change recipes

### Add or change a page workflow

1. Find the existing top-level mount in `src/app.ts`.
2. Add or update the feature route under `src/routes/`.
3. Add normalization/orchestration in the corresponding controller.
4. Add persistence operations in the corresponding service module.
5. Update the Pug view and browser module together when labels, fields, or actions change.
6. Add tests at the lowest useful layer and an integration/E2E check when the change crosses those boundaries.
7. Update the relevant user or maintainer document in the same change.

### Add or change a legacy API action

For a migrated action, follow [Implementing the next feature slice](#implementing-the-next-feature-slice): author its
v1 operation/schema and extend the existing `src/routes/api/v1.ts` feature mount and owning controller/module. The
following route recipe applies to native legacy APIs, not to the migration's generated v1 contract.

1. Add the feature route under `src/routes/api/`.
2. Confirm it is mounted by `src/routes/api.ts`.
3. Apply validation and authorization before the mutation.
4. Return through the established structured JSON and API error chain.
5. Cover invalid input, unauthorized input, success, and state persistence.

### Add a legacy client-side module

For Vue components or feature views, use the pilot contribution recipe and the existing Express/Vite development
workflow. The following generated-module convention applies only to native Pug/browser TypeScript.

1. Add the `.ts` source under `src/public/js/` in the appropriate existing directory.
2. Import it from the relevant Pug page or client module using the existing generated-module convention.
3. Run `npm run server:client` while developing or `npm run build:client` for a production build.
4. Add a frontend Vitest test for deterministic helper behavior and Playwright only when real navigation/session/rendering is essential.

### Change a setting

1. Add the field, default, key mapping, and coercion in `src/modules/settings.ts`.
2. Update [Configuration Reference](../../CONFIGURATION.md).
3. Check E2E-prefixed behavior when the setting affects E2E startup.
4. Evaluate database, release, secret, and upgrade implications.
5. Add a documentation-check or test assertion if future drift would be costly.

## Git and automation

The repository does not currently enforce a branch-name pattern or commit-message convention in committed configuration. Follow the maintainer's requested workflow rather than inventing one in documentation.

The CI workflow runs for manual dispatch, reusable calls, and pushes or pull requests on:

```text
master
dev
ts-migration
```

Before requesting review, select the cheapest stable checks protecting the changed observable behavior using the
[Testing Guide](TESTING_GUIDE.md#choosing-the-layer). A broader change may cross persistence, release-build or real-browser
boundaries and justify checks at those layers; it does not require every suite. Follow the guide and executable
package scripts for the selected commands and preparation. Database-backed integration and E2E checks require a
verified disposable target and restricted credentials; do not infer database preparation from a command name.

Documentation reports are optional, not review or delivery prerequisites. Use `npm run docs:check` for maintainer
feedback; findings, metadata, baseline changes, or unavailable documentation tools must not block application work.

The manual release workflow invokes full CI, updates the requested semantic version, commits the version files, tags the selected ref, builds, and publishes the production archive. Do not manually alter generated release contents as a substitute for changing source and rebuilding.

## Debugging and troubleshooting

### Startup fails before the server listens

Startup requires settings, MariaDB, invoice-retention and entity-archival initialization, and application construction. Read the first error printed by `src/server.ts`; common causes are an unreachable database, a missing generated TypeORM index, invalid database credentials or archival configuration, or a schema that has not been initialized/migrated.

### A standalone TypeORM command cannot load entities

Run:

```bash
npm run generate
```

Then repeat the settings-aware `npm run typeorm -- ...` command. Confirm `SETTINGS_FILE` and the effective database target before any destructive operation.

### Browser changes do not appear

For legacy browser code, ensure `npm run server:client` is running. Use `npm run server` for Express-hosted Vue HMR
and automatic authored-input regeneration. `npm run server:frontend` alone watches contracts/catalogs; it does not
run the application. Inspect generator errors if an input edit is not reflected; `npm run prepare:frontend` is a
standalone diagnostic. Remove no source files. For a compiled run, execute `npm run build` before `npm run run`.

### Secure login loops behind a proxy

The production cookie is secure and the application trusts one proxy hop. Confirm HTTPS termination and forwarded-protocol/host headers using the [operations runbook](../../OPERATIONS.md).

### Local registration succeeds but no activation message arrives

Surveyor logs SMTP send failures and does not provide a built-in mailbox. Verify the configured development SMTP service, sender, credentials, and `ROOT_URL`.

### Tests refuse to reset a database

This is a safety feature. Vitest integration setup requires `TEST_DB_NAME` to contain `test`; the E2E initializer requires `E2E_DB_NAME` to contain `e2e`. Create dedicated schemas rather than weakening the guard.

### Review in-app help changes

In-app guides are application content, but their maintenance is not a delivery prerequisite. Optional reports can
help identify wording, link, asset, and workflow drift:

```bash
npm run docs:check
npm run docs:check:strict
npm run docs:test:content
```

For an actual help-renderer or routing code change, run the relevant application fixture tests. To review the maintained
help pages in a browser, use the optional browser report after preparing its disposable environment. Neither corpus
checks nor documentation findings block CI or release. Reporting and visual-inspection practices are described in
[Documentation Policy](../../DOCUMENTATION_POLICY.md), [Testing Guide](../../TESTING_GUIDE.md), and [In-App Help Visuals](../../HELP_VISUALS.md).
