# Surveyor Architecture
<!--
documentation-metadata
audience: maintainers; developers; AI agents
owner: architecture maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: non-blocking documentation policy and optional report/test routing; D12 runtime, layer, authentication, authorization, persistence, frontend, background-job, build, release, and testing architecture plus D08 advanced activity requirement, allocation, job, review, and persistence boundaries; help integration remains assigned to D14; D14 fixed-source help search, contextual routing, Markdown validation, local visual assets, and release boundary
source-anchors: package.json; package-lock.json; src/server.ts; src/app.ts; src/routes/; src/controller/; src/middleware/; src/modules/database/; src/modules/activity/requirements.ts; src/modules/activity/fairAssignment.ts; src/modules/activity/recommendationJobs.ts; src/modules/oidc.ts; src/modules/settings.ts; src/modules/permissionEngine.ts; src/modules/invoiceRetention.ts; src/public/js/; src/views/; migrationDataSource.ts; scripts/runMigration.ts; scripts/genTypeormIdx.ts; esbuild.client.js; vitest.config.mts; playwright.config.ts; tests/; .github/workflows/ci.yml; .github/workflows/release.yml; src/controller/helpController.ts; src/routes/help.ts; src/views/help.pug; scripts/check-help-documentation.mjs; docs/HELP_VISUALS.md
next-review: architecture-or-help-delivery-change
-->

Surveyor is a TypeScript monolith that serves HTML and JSON from one Express process. MariaDB stores application records and sessions; the filesystem stores uploaded header images and invoice proofs. Pug renders the primary UI, with focused browser-side TypeScript enhancing interactive pages.

This document defines the current technical shape of the repository. Configuration, database operation, production deployment, and recovery procedures are maintained separately in [Configuration](CONFIGURATION.md), [Database and Migrations](DATABASE.md), [Production Operations](OPERATIONS.md), and [Upgrading and Rolling Back](UPGRADING.md).

## System context

```text
Browser
  | HTTPS in production
  v
Reverse proxy / TLS endpoint
  |
  v
Express 5 application
  |-- Pug HTML and static assets
  |-- JSON API under /api
  |-- database-backed session middleware
  |-- local-account, guest, and OIDC identity flows
  |-- permission and shared feature-flow middleware
  |
  +--> MariaDB: entities, relationships, migrations, sessions
  +--> filesystem: header images and invoice proofs
  +--> SMTP service: activation, recovery, and workflow email
  +--> OIDC provider when enabled
```

Surveyor currently assumes one application process owns its in-process schedules, notably invoice-retention execution. Multiple replicas require deliberately shared upload storage and coordinated ownership of scheduled work; see the [operations runbook](OPERATIONS.md).

## Current technology baseline

The lockfile is authoritative for exact installed dependency versions. The important architecture selections are:

| Area | Current implementation |
|---|---|
| Runtime | Node.js; CI and release workflows use 24.15.0 |
| Language | TypeScript targeting ES2024 |
| Web framework | Express 5.2.x |
| Templates and UI | Pug 3, Bootstrap 5.3, Sass, browser TypeScript |
| Browser build | esbuild |
| Persistence | TypeORM 1.1.x with MariaDB/MySQL driver support; MariaDB 10.11 is the tested workflow baseline |
| Sessions | `express-session` with `connect-typeorm` and the `Session` entity |
| Input validation | Joi and `express-validator`, according to the route or workflow |
| Authentication | Local username/password, guest links, and direct `openid-client` OIDC integration |
| Email | Nodemailer SMTP |
| Tests | Vitest for unit/frontend/integration; Playwright for focused E2E |

## Startup sequence

`src/server.ts` is the runtime entry point. Startup is intentionally ordered:

1. `settings.read()` loads configuration.
2. `initDataSource()` initializes the production TypeORM `DataSource` with `synchronize: false`.
3. `startInvoiceRetentionJob()` performs an immediate invoice cleanup and installs the hourly timer.
4. `src/app.ts` is loaded only after the database exists, because application construction obtains the TypeORM session repository.
5. An HTTP server listens on the configured application port.

A failure in any step logs the error and terminates the process. There is no degraded database-free mode.

### Configuration boundary

`src/modules/settings.ts` owns runtime configuration. The effective order is:

```text
built-in defaults < CSV settings file < environment overrides
```

`SETTINGS_FILE` changes the CSV path. In E2E mode, matching `E2E_*` environment variables take precedence over their ordinary names. The settings store must be initialized before modules rely on `settings.value`.

The runtime `DataSource` reads the initialized settings store. TypeORM command-line operations use `migrationDataSource.ts`; `scripts/runMigration.ts` bridges the normal Surveyor settings into the `DB_*` variables expected by that datasource. Maintainer code must preserve this distinction.

## HTTP application and request pipeline

`src/app.ts` constructs the Express application in this order:

1. Disable the `X-Powered-By` header.
2. Configure Pug views under the compiled `views` directory.
3. Install request logging, JSON and URL-encoded parsing, cookies, and static-file serving.
4. Create a one-day database-backed session with secure cookies in production and `SameSite=Lax`.
5. Enable one trusted proxy hop so secure cookies work behind the documented reverse proxy.
6. Install flash messages.
7. Validate the stored user/guest/profile session on every request; invalid sessions are logged out.
8. Populate common Pug locals, including the active profile, authentication state, version, selected public settings, and return URL.
9. Mount page and API routers.
10. Expose `GET /healthz`, then the 404 and generic error handlers.

Top-level mounts are explicit in `src/app.ts`:

```text
/          home
/api       JSON/API actions
/users     account, profile, dashboard, and OIDC routes
/survey    surveys
/packing   packing lists
/activity  activity plans
/drivers   drivers lists
/event     events and invoice pools
/help      in-app help
/guest     guest recovery and guest-account actions
```

Feature routers are not auto-discovered. A new top-level router must be imported and mounted deliberately. API subrouters are mounted separately in `src/routes/api.ts`.

## Application layers

The codebase uses practical layers rather than a framework-enforced domain architecture. Its database service layer is organized as functional modules, not service classes.

### Routes

`src/routes/` defines URL shape, middleware order, request validation, controller invocation, redirects, and response selection. Page routes use `express.Router`; API routes live under `src/routes/api/` and are mounted by `src/routes/api.ts`.

Asynchronous handlers are wrapped with `asyncHandler` or `asyncParamHandler` from `src/modules/lib/asyncHandler.ts`, allowing the centralized error chain to handle rejected promises.

Several entity types use `createGuestFlowRouter` from `src/middleware/guestFlowFactory.ts` for their common create, view, duplicate, delete, header-image, guest-entry, and event-linking flow. Surveys deliberately reuse that navigation flow without joining the general permission system.

### Controllers

`src/controller/` contains request/response orchestration and feature-level normalization. Controllers commonly:

- normalize or validate posted values;
- call one or more service functions;
- build data for a Pug view or API response;
- choose flash messages, redirects, or expected errors; and
- coordinate file replacement or other cross-service actions.

Most feature controllers export a plain object of functions; other controllers use named function exports. Controllers do not instantiate class-based services and do not directly obtain TypeORM repositories.

### Database services

`src/modules/database/services/` exports functions that query repositories, save entities, and run transactions. Service files are organized by domain, but one function may coordinate several entities when the domain operation requires it. Callers import the module namespace or named functions.

Multi-step writes that must be atomic use TypeORM transactions. Service functions return entities, identifiers, projections, or workflow-specific data rather than HTTP responses.

### Entities, migrations, and subscribers

TypeORM entities are under `src/modules/database/entities/`, migrations under `src/migrations/`, and subscribers under `src/modules/database/subscribers/`.

`scripts/genTypeormIdx.ts` discovers these classes and generates `src/modules/database/__index__.ts`. That generated file is ignored by Git and consumed by both runtime and migration datasources. `npm run generate` runs before builds and the principal Vitest commands, but it must be run explicitly before standalone TypeORM commands on a clean clone.

The production datasource always uses `synchronize: false`. Schema synchronization is reserved for empty disposable development databases and the guarded test/E2E setup. Production schema evolution uses reviewed migrations.

### Middleware and error handling

Current authentication and authorization middleware is implemented in `src/middleware/permissionMiddleware.ts`. Important functions include:

- `isAuthenticated` for full user accounts;
- `isGuest` for guest-backed sessions;
- `isLoggedIn` for either authenticated form;
- `requireOwner` for entity ownership;
- `requireEventParticipant` for event-registration admission;
- `requirePermission` and `requireItemPermission` for entity or item actions; and
- optional/API variants and permission-bundle attachment helpers for rendering and JSON routes.

Shared assignment behavior is assembled by `src/middleware/assignFlowFactory.ts`. Entity administration is assembled by `src/middleware/adminApiFactory.ts` and related controllers.

Expected workflow failures use the custom errors in `src/modules/lib/errors.ts`. `ValidationError` can re-render a form with data; `ExpectedError` represents a user-facing failure; `APIError` carries structured API status/data. Page requests terminate in `handleGenericError`; API requests use the validation and wrapping chain mounted by `src/routes/api.ts`.

## Identity and session architecture

Surveyor separates an authentication record from the profile acting in the application.

### Full accounts

A local `User` can own several `Profile` records. Local registration creates an inactive account, sends an activation token by email, and requires activation before login. Password reset also uses email tokens.

OIDC is implemented directly in `src/modules/oidc.ts`:

1. Discover the provider with `openid-client`.
2. Generate PKCE material and state for each authorization request; use a nonce when provider metadata requires the compatibility path.
3. Store transient values in the database-backed session.
4. Exchange and validate the authorization response at `/users/oidc/callback`.
5. Use ID-token claims and optional userinfo to find, link, or create the local user and profiles.
6. Persist the normal Surveyor session identity and tokens needed for provider logout.

Both local and OIDC users therefore enter the same local account/profile model after authentication.

### Guests

A guest has a private link token and one associated profile. Optional email enables recovery of guest links. Guest participation is persistent server state, not an anonymous browser-only session.

### Active profile

The session stores either a full user or guest authentication object plus the active `profile`. Ownership, participation, assignments, display names, permissions, and dashboard membership are evaluated against that profile. Maintainer changes must not substitute account IDs where a profile ID is required.

Sessions are stored in MariaDB through the `Session` entity. They expire after one day in both cookie and store configuration and are revalidated against current account/profile state on each request.

## Authorization architecture

The general permission system applies to events, activity plans, packing lists, and drivers lists. Surveys are an intentional exception with their own invitation and participation behavior.

For a non-owner, the permission engine combines every applicable grant:

```text
individual | public | authenticated | guest | participant
```

There are no deny records and no override hierarchy. Owners receive the complete permission mask. Item checks may include explicit parent-entity fallback permissions. Page admission, action permission, entity ownership, item ownership, event participation, and delegated administration are related but distinct checks.

The complete bit, preset, default, audience, persistence, and evaluation contracts are maintained in [Permission-System Reference](PERMISSIONS_REFERENCE.md). User-facing recipes are in [Permissions and Sharing](user-guide/PERMISSIONS.md).

## Domain architecture

### Surveys

Surveys primarily coordinate recurring monthly patterns represented by weekday plus first/second/third/fourth/last occurrence. Profiles submit Yes/Maybe/No answers. Every admitted participant may add a combination. Survey participation is link-based and survey-specific; there is no general permission matrix or event linkage.

### Events and invoice pools

Events own date boundaries, capacity, registration/deadline policy, dietary data, participants, linked activity/packing/drivers resources, and invoice pools. Invoice pools coordinate accepted costs, assignments, takeovers, surcharges, calculated shares, and settlement markers. Proof files live on the filesystem while records and review history live in MariaDB.

### Activity plans

Activity plans contain dated slots, optional roles, assignments, shared fields, participant requirements, availability, recommendations, and review operations. The user guide owns the basic and advanced organizer workflows. [Activity Requirements and Assignment Recommendations](ACTIVITY_REQUIREMENTS_ALGORITHM.md) is the canonical technical reference for precedence, coverage, fair allocation, bounded repair, overfill, background jobs, review states, and application persistence.

### Packing lists

Packing lists contain ordered shared item definitions and profile-backed assignments. **Everyone** rows bypass individual assignments. The personal **Packed?** state is browser-local and never reaches the server. Lists may be standalone or linked to events and use the general permission system.

### Drivers lists

A drivers-list row represents a ride offered by the profile that created it. Passenger assignments are separate. Capacity excludes the driver; list participant totals deduplicate assigned passenger profiles. Lists may be standalone or event-linked and use the general permission system.

### Users, guests, and profiles

Identity services manage activation, password reset, OIDC links, guest tokens/recovery, profile creation/default selection, profile migration, and deletion. Relationships throughout the collaboration domains use profiles as the human actor.

## Frontend architecture

### Server-rendered pages

Pug templates under `src/views/` render the primary HTML. Shared layout and module templates provide navigation, entity headers, permissions, cards, forms, and administration controls.

Page rendering uses `src/modules/renderer.ts` to pass consistent status, message, and data objects. Flash messages cover redirect-based workflows.

### Browser TypeScript

Browser code lives under `src/public/js/`:

- `core/` contains shared HTTP, form, navigation, permission, and DOM helpers;
- `shared/` contains reusable page behaviors; and
- feature modules/page entry files implement survey, event, activity, packing, drivers, and account interactions.

`esbuild.client.js` discovers every `.ts` file recursively and emits a corresponding `.gen.js` ES module while preserving the directory layout. Development output is written beside the source and ignored by Git; production output goes to `dist/public/js/`. Relative extensionless imports are rewritten to generated module names.

Sass sources under `src/public/style/` compile to ignored CSS before production assets are copied to `dist/public/`. Pug templates and image/style assets are copied as part of `npm run build`.

## Persistence and lifecycle boundaries

Surveyor's durable state spans more than the database:

| State | Location | Lifecycle concern |
|---|---|---|
| Domain entities, profiles, permissions, tokens, reviews, sessions | MariaDB | Migrations, transaction safety, database backup |
| Header images | `HEADER_IMG_DIR` | Shared/persistent filesystem and paired backup |
| Invoice proofs | `INVOICE_DIR` | Sensitive persistent filesystem, paired backup, retention |
| Configuration and secrets | CSV/environment outside the release | Protected deployment input and recovery material |
| Personal packing check marks | Browser local storage | Deliberately local and not recoverable by the server |

`startInvoiceRetentionJob()` runs cleanup once during startup and then hourly. The configured retention period is evaluated against invoice/event data, and expired records and proof files are purged through the invoice service. This in-process schedule is part of the single-process assumption.

The fixed help source is `docs/user-guide/`, packaged with each release. It is trusted application content, not a user-uploaded documentation store. The detailed trust and future-change boundary is recorded in [DEC-004](decisions/DEC-004-HELP-MARKDOWN-TRUST-MODEL.md).

## Build and release architecture

`npm run build` performs four groups of work:

1. Compile Sass.
2. Generate the TypeORM index and compile server TypeScript to `dist/`.
3. Compile browser TypeScript to `dist/public/js/`.
4. Copy static image/style assets and Pug views into `dist/`.

The manual release workflow first invokes full CI on the selected ref. It then validates and commits the requested version, creates a tag, builds, and produces a tar archive containing:

```text
dist/
docs/
fonts/
package.json          production-only dependency manifest
package-lock.json
.npmrc                omits development dependencies
```

The runtime archive does not include TypeScript source or migration tooling and does not migrate the database automatically. Operators retain a source workspace at the matching tag for migration commands. Runtime archive, source tag, schema, configuration, MariaDB data, and uploads are treated as one release/recovery unit.

## Testing architecture

Vitest discovers `tests/unit/`, `tests/frontend/`, and `tests/integration/`. It runs them in the Node environment with file-level parallelism disabled because integration suites share a guarded disposable MariaDB schema.

Playwright discovers `tests/e2e/`, runs Chromium, initializes the E2E database, and starts the built server through its managed `webServer` command. Factories under `tests/factories/` build production-shaped inputs; reusable workflow/assertion helpers live under `tests/keywords/`; runner and database setup live under `tests/support/`.

The layer contracts, setup files, database safeguards, command matrix, and examples are canonical in [Testing Guide](TESTING_GUIDE.md). Do not maintain test counts in architecture prose; the repository tree and runner configurations are the source of truth.

## Change-impact checklist

Before merging a change, trace it across the boundaries it affects:

1. **Configuration:** setting key, precedence, reference documentation, operator impact.
2. **Database:** entity, generated index, migration, transaction, backup/rollback implications.
3. **HTTP:** route mount, middleware order, validation, controller, error response.
4. **Identity:** account versus profile identifier, guest behavior, session invalidation.
5. **Authorization:** page admission, action permission, ownership, item fallback, survey exception.
6. **Files:** database record and filesystem operation remain consistent on success and failure.
7. **Frontend:** Pug label/control, browser module, generated asset, no-JavaScript behavior where applicable.
8. **Tests:** cheapest stable layer plus integration/E2E coverage for cross-boundary behavior.
9. **Documentation:** user, maintainer, operator, and AI instructions remain aligned with the implemented contract.

## In-app help delivery

The in-app help subsystem is intentionally separate from mutable application data:

1. `src/controller/helpController.ts` discovers Markdown only in `docs/user-guide/` and images only in `docs/user-guide/assets/`.
2. A fixed task-group map orders the guides. The same catalog drives the sidebar and server-side search.
3. Markdown is checked against the DEC-004 authoring contract, converted with Marked, given stable heading IDs, and returned with a level-two/level-three table of contents.
4. Internal guide links become `/help/<guide>` routes, and maintained images become `/help/assets/<file>` routes. Path-containment and filename checks prevent request-controlled traversal.
5. Application requests receive a contextual `helpUrl`; the navbar therefore opens the guide for the current feature while retaining `/help` as the fallback.
6. The release workflow attempts to copy and compare the entire user-guide tree, including images, in a separate advisory step. A mismatch or missing documentation is reported without blocking release.

The renderer inserts validated, release-shipped HTML into the Pug view. This is a trusted-content boundary rather than a generic sanitization service. Changing the source model requires reopening DEC-004.

### Documentation reporting is outside application delivery

The required CI workflow runs application checks only. `scripts/report-documentation.mjs` is an optional maintainer
entry point: structural and help-authoring diagnostics, actual-guide content tests, and tooling regressions are
advisory, with real findings and subprocess exits preserved in reports. The corpus-dependent suites are isolated in
`tests/documentation/`; the required help tests use synthetic renderer fixtures and application-only route assertions.
The release copies and compares documentation in a separate non-blocking step. A missing guide, stale fingerprint,
wording mismatch, or unavailable documentation checker cannot stop CI, builds, merges, or release. Runtime content
rejection remains active; see [Documentation Policy](DOCUMENTATION_POLICY.md).
