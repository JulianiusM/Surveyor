# Development Guide
<!--
documentation-metadata
audience: developers; maintainers; AI agents
owner: developer-experience maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: D12 clean-clone setup, current scripts, settings and schema bootstrap, generated files, observed repository patterns, route registration, test selection, CI branches, and troubleshooting; D14 focused in-app help validation workflow
source-anchors: package.json; package-lock.json; README.md; src/server.ts; src/app.ts; src/routes/; src/controller/; src/middleware/; src/modules/settings.ts; src/modules/database/; scripts/genTypeormIdx.ts; scripts/runMigration.ts; migrationDataSource.ts; esbuild.client.js; tsconfig.json; tsconfig.server.json; vitest.config.mts; playwright.config.ts; tests/; .github/workflows/ci.yml; .github/workflows/release.yml; scripts/check-help-documentation.mjs; tests/unit/help-documentation.spec.ts; tests/e2e/help-experience.spec.ts
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

### Routes

- Use `express.Router()` in a feature route module.
- Mount a page router explicitly in `src/app.ts`.
- Mount a feature API router in `src/routes/api.ts`.
- Keep middleware order visible in the route definition.
- Wrap asynchronous request and parameter handlers with `asyncHandler` or `asyncParamHandler`.
- Reuse `createGuestFlowRouter` where the entity follows its common create/view/duplicate/delete/guest model; do not force a feature into that model when its behavior differs.

### Controllers and services

- Controllers normalize request data, coordinate services, prepare render data, and choose redirects/messages.
- Database services are functional database service modules that export functions; they do not require a service class or dependency-injection container.
- Keep repository access and transactions in `src/modules/database/services/` rather than routes or controllers.
- Use a TypeORM transaction for multi-record writes that must succeed or fail together.
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
- Put shared browser behavior under `src/public/js/core/` or `src/public/js/shared/`; keep page-specific behavior in its feature module.
- Treat generated `.gen.js` files as outputs, not source.
- Consider both the server-rendered fallback and enhanced browser behavior when changing a form or action.

### Database changes

A schema change normally requires:

1. Update or add the entity under `src/modules/database/entities/`.
2. Add a migration under `src/migrations/` for existing installations.
3. Run `npm run generate`.
4. Exercise the migration against an appropriate disposable database.
5. Add integration coverage using the production `DataSource` metadata.
6. Update configuration, operator, architecture, or user documentation where the data contract changes.

Never rely on production `synchronize`; it is disabled.

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
npm run docs:check
npm test
npm run build
npm run e2e
```

The manual release workflow invokes full CI, updates the requested semantic version, commits the version files, tags the selected ref, builds, and publishes the production archive. Do not manually alter generated release contents as a substitute for changing source and rebuilding.

## Debugging and troubleshooting

### Startup fails before the server listens

Startup requires settings, MariaDB, invoice-retention initialization, and application construction. Read the first error printed by `src/server.ts`; common causes are an unreachable database, a missing generated TypeORM index, invalid database credentials, or a schema that has not been initialized/migrated.

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

### Validate in-app help changes

In-app guides are application content, not a detached handbook. After changing a visible label, critical workflow, help renderer, contextual mapping, or guide visual, run:

```bash
npm run docs:check
npm run docs:check:strict
npm exec -- vitest run tests/unit/help-documentation.spec.ts
```

Run the focused Playwright help suite when routing, rendering, search, or contextual links change. The authoring gate and visual ownership rules are described in [Documentation Policy](DOCUMENTATION_POLICY.md) and [In-App Help Visuals](HELP_VISUALS.md).
