# Development Guide
<!--
documentation-metadata
audience: developers; maintainers; AI agents
owner: developer-experience maintainers
status: current
last-verified: 2026-10-04
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: optional organizer participant attribution with independent recorder audit and existing credit/history/proof ownership; unchanged original saved notes before the email calculation disclosure; figures-only typed global calculation breakdown, total/base and optional anonymous payer steps inside a separate example, explanation-free compact PDF, success-only settlement-email dialog closure, and fresh-summary source deduplication; completed correcting-transfer cleanup, direct participant email wording, shared PDF pool-cost explanation, independent overview example disclosure and consistent exemption captions; active paid/refunded payer identity and applied responsibility notices; restored role-specific balance captions; explicit pending-coverage indicators; contextual full pool totals and shares export labels; pure shared coverage evidence owner, unknown legacy baselines and direct-import boundaries; established visual-component reuse and shared PDF sectionTitle; deterministic positive anonymous example selection, honest covering introductions and missing-evidence fallbacks; abbreviated exempt and zero-weight personal explanations; applied versus pending closed takeovers, post-recalculation delta notices and silent rollback; independent OPEN and ORGANIZER_ONLY initial states, default OPEN creation with Invoice submissions choice, reversible participant submission access with confirmation and revision checks, permanent financial closure, and guarded organizer-only migration; notes-first settlement emails with client-dependent native calculation disclosure, complete plain-text content, and opt-in leading actions; covered-participant count/name summaries; Payment due wording; structured anonymous pool examples in preview, organizer details and PDF; concrete complete payer explanations in dialogs and emails, separated from factual notes; cross-pool personal share ledger with one reusable read-only dialog; contextual current-source and saved-settlement totals; explicitly named attendance/factor/weight inputs; adaptive signed adjustment-category provenance and component displays; retained collect/refund totals; compact settlement statuses, nonrepeated PDF row details, and required PDF visual verification; invoice feature-folder orchestration, mandatory JSDoc plus internal step comments, catalog-owned localization-ready messages, prohibition of imported re-exports, calculated-balance-first settlement presentation, and compact payment/refund actions; responsive shares, saved numeric calculation provenance, signed settlement trace, frontend confirmation gates, and controller-owned invoice business operations; explicit controller-owned checks and pure DBAL/no context-specific service errors; implemented permission-filtered entity settings, atomic property updates, authorized event discovery/reassociation, and activity context preservation; source review of bounded mixed-card overview queries, event sub-views, shared membership and lifecycle projections, and fragment navigation; explicit maintainer readability, comments, formatting, declaration-file, module-reuse, renderer-data, and deletion-boundary requirements; archival API, presentation, persistence, and extension-boundary source review; invoice correction and retraction lifecycles, refreshed submission history, and searchable payer rows with beneficiary chips; organizer-entered shared costs, repeat invoice submissions, visible payment feedback, and share breakdown dialogs; named recipient mailer contract, transient alert lifecycle, snapshot relation loading, post-commit invoice review notifications, saved share ledger and PDF export; consistent per-participant rounding, reconciliation totals, and long takeover-list layout; invoice factors, signed adjustments, revision-checked previews, payment carry-forward, rollback snapshots, configurable settlement notifications, and upload feedback; non-blocking documentation policy and optional report/test routing; D12 clean-clone setup, current scripts, settings and schema bootstrap, generated files, observed repository patterns, route registration, test selection, CI branches, and troubleshooting; D14 focused in-app help validation workflow
source-anchors: tests/e2e/invoice-organizer-expenses.spec.ts; tests/integration/organizer-invoices.spec.ts; tests/frontend/invoice-organizer-attribution.spec.ts; src/modules/invoice/settlements.ts; src/modules/invoice/coverage.ts; src/migrations/1790985600000-AddInvoicePoolOrganizerOnlyState.ts; src/modules/invoice/takeovers.ts; tests/unit/invoice-presentation.spec.ts; src/modules/invoice/wording.ts; src/modules/invoice/locales/en.ts; src/modules/invoice/calculation.ts; src/modules/invoice/poolOperations.ts; src/modules/invoice/invoiceOperations.ts; src/modules/invoice/notifications.ts; src/modules/invoice/requests.ts; src/modules/invoice/proofs.ts; src/modules/invoice/exports.ts; src/modules/invoice/presentation.ts; src/types/InvoicePoolTypes.d.ts; src/types/EmailTypes.d.ts; src/types/EntityPropertyTypes.d.ts; src/public/js/modules/entity-properties.ts; src/views/modules/module_entity_properties.pug; tests/integration/entity-properties.spec.ts; tests/integration/activity-property-integrity.spec.ts; tests/e2e/entity-properties.spec.ts; src/types/UserTypes.d.ts; src/modules/renderer.ts; src/routes/api/users.ts; src/views/modules/module_unified_entity_cards.pug; src/public/js/modules/entity-cards-overview.ts; src/public/js/modules/entity-archive.ts; src/modules/database/services/EntityLifecycleService.ts; src/modules/database/services/UserService.ts; src/controller/entityAdminController.ts; src/controller/userController.ts; src/middleware/adminApiFactory.ts; src/types/ArchiveTypes.d.ts; src/views/modules/module_entity_archive.pug; src/migrations/1789689600000-AddInvoiceRetraction.ts; src/migrations/1789603200000-AddOrganizerInvoices.ts; src/modules/email.ts; src/public/js/shared/alerts.ts; src/public/js/notifications.ts; src/routes/event.ts; src/modules/lib/pdf.ts; tests/integration/invoice-admin-feedback.spec.ts; src/migrations/1789516800000-AddInvoiceShareRounding.ts; src/modules/invoice/settlementEmail.ts; src/migrations/1789430400000-AddInvoiceSettlementSnapshots.ts; src/modules/invoice/distribution.ts; src/public/js/modules/invoice-submission.ts; src/controller/eventPoolController.ts; src/modules/database/services/EventInvoiceService.ts; package.json; package-lock.json; README.md; src/server.ts; src/app.ts; src/routes/; src/controller/; src/middleware/; src/modules/settings.ts; src/modules/database/; scripts/genTypeormIdx.ts; scripts/runMigration.ts; migrationDataSource.ts; esbuild.client.js; tsconfig.json; tsconfig.server.json; vitest.config.mts; playwright.config.ts; tests/; .github/workflows/ci.yml; .github/workflows/release.yml; scripts/check-help-documentation.mjs; tests/unit/help-documentation.spec.ts; tests/e2e/help-experience.spec.ts
next-review: development-workflow-or-help-tooling-change
-->

This guide covers a source-checkout development workflow for Surveyor. Production deployment and database maintenance use the separate [operator documentation](OPERATIONS.md).

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

The repository intentionally has no general environment example because the complete supported surface is generated from `src/modules/settings.ts` and maintained in [Configuration Reference](CONFIGURATION.md). For a local account/password instance, this is the minimum practical starting point:

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

This sequence is only for a new empty disposable development database. `schema:sync` constructs the current entity schema; the migration run records and applies migrations needed for migration history, triggers, and conditional adjustments. Existing databases follow [Database and Migrations](DATABASE.md).

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

- the server under Nodemon through `npm run server:dev`; and
- browser TypeScript under the esbuild watcher through `npm run server:client`.

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

`dist/`, generated browser modules, compiled CSS, uploads, local environment files, `settings.csv`, reports, and `src/modules/database/__index__.ts` are ignored build/runtime outputs.

## Build and run commands

| Command | Behavior |
|---|---|
| `npm run server` | Full build, then server and browser-code watchers. |
| `npm run server:dev` | Nodemon + ts-node server only. It assumes generated database metadata and required assets already exist. |
| `npm run server:client` | Browser-code watch build only. |
| `npm run build` | Sass, generated database index, server compile, browser compile, then views/assets copy. |
| `npm run build:sass` | Compile Sass into ignored CSS under `src/public/style/`. |
| `npm run build:server` | Generate the database index and compile server TypeScript into `dist/`. |
| `npm run build:client` | Compile browser TypeScript into `dist/public/js/`. |
| `npm run copy` | Copy current image/style assets and Pug views into `dist/`. |
| `npm run run` | Start `dist/server.js`; it does not build first. |
| `npm run generate` | Rebuild the ignored TypeORM entity/migration/subscriber index. |

### Generated files

Do not hand-edit or commit these generated outputs:

- `src/modules/database/__index__.ts`
- `src/public/js/**/*.gen.js`
- `src/public/js/**/*.gen.js.map`
- `src/public/style/**/*.css`
- `src/public/style/**/*.css.map`
- `dist/`

`esbuild.client.js` recursively discovers browser `.ts` files and emits one `.gen.js` module per source file. In development it writes beside the source; in production it writes into `dist/public/js/`. Extensionless relative imports are rewritten to the generated module names.

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
- General permission grants combine cumulatively. Surveys intentionally use their own participation model. See [Permission-System Reference](PERMISSIONS_REFERENCE.md).

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

Never accept profile IDs, timestamps, stored parent state, or other arbitrary fields from the browser. Follow the [archival authority contract](PERMISSIONS_REFERENCE.md#archival-authority-and-personal-visibility), including the survey exception. A private preference may change placement only after existing overview membership is established.

Render lifecycle actions through `module_entity_archive.pug`, passing the optional notice state in renderer data and
explicit mixin arguments. Personal actions are an explicit card argument; dashboard placement comes from the bounded
overview service. The shared browser module delegates commands so inserted cards work, keeps one page-wide mutation
lock, and waits for structured success before refreshing all appearances. It does not infer archival dates or parent policy.

Archive and restore write only lifecycle fields and do not call deletion, invoice recalculation, or file operations.
Permanent deletion remains the simple repository delete in each existing feature service, with database foreign keys
handling dependent rows. It does not pass through the archival service. Polymorphic visibility preferences may outlive
a deleted target; overview discovery always starts from existing entities, so these rows cannot create cards or grant
access. New and duplicated roots receive fresh IDs and default lifecycle state. See
[Database and Migrations](DATABASE.md#entity-archival-state) for persistence and concurrency details.

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
[Database and Migrations](DATABASE.md). Its down migration refuses while any ORGANIZER_ONLY pool exists; explicitly open
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
[Upgrading and Rolling Back](UPGRADING.md); its existing down guard protects invoices with no registration.

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

The integration suite rebuilds its selected MariaDB schema. The E2E initializer drops and recreates its selected schema. Read [Testing Guide](TESTING_GUIDE.md) before running either and never reuse development or production database names.

## Common change recipes

### Add or change a page workflow

1. Find the existing top-level mount in `src/app.ts`.
2. Add or update the feature route under `src/routes/`.
3. Add normalization/orchestration in the corresponding controller.
4. Add persistence operations in the corresponding service module.
5. Update the Pug view and browser module together when labels, fields, or actions change.
6. Add tests at the lowest useful layer and an integration/E2E check when the change crosses those boundaries.
7. Update the relevant user or maintainer document in the same change.

### Add or change an API action

1. Add the feature route under `src/routes/api/`.
2. Confirm it is mounted by `src/routes/api.ts`.
3. Apply validation and authorization before the mutation.
4. Return through the established structured JSON and API error chain.
5. Cover invalid input, unauthorized input, success, and state persistence.

### Add a client-side module

1. Add the `.ts` source under `src/public/js/` in the appropriate existing directory.
2. Import it from the relevant Pug page or client module using the existing generated-module convention.
3. Run `npm run server:client` while developing or `npm run build:client` for a production build.
4. Add a frontend Vitest test for deterministic helper behavior and Playwright only when real navigation/session/rendering is essential.

### Change a setting

1. Add the field, default, key mapping, and coercion in `src/modules/settings.ts`.
2. Update [Configuration Reference](CONFIGURATION.md).
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

Before requesting review, run the checks appropriate to the change. A broad application change normally warrants:

```bash
npm test
npm run build
npm run e2e
```

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

For development, ensure `npm run server:client` is running. Remove no source files; regenerate the ignored `.gen.js` output by restarting the watcher. For a compiled run, execute `npm run build` before `npm run run`.

### Secure login loops behind a proxy

The production cookie is secure and the application trusts one proxy hop. Confirm HTTPS termination and forwarded-protocol/host headers using the [operations runbook](OPERATIONS.md).

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
[Documentation Policy](DOCUMENTATION_POLICY.md), [Testing Guide](TESTING_GUIDE.md), and [In-App Help Visuals](HELP_VISUALS.md).
