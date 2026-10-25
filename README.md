# Surveyor
<!--
documentation-metadata
audience: users; developers; operators
owner: project maintainers
status: current
last-verified: 2026-10-25
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: P11 cutover guidance reconciled with canonical routing, Vue rendering and native browser retirement; inherited domain and database safety retained; no deployment or exhaustive verification claim
source-anchors: package.json; package-lock.json; src/server.ts; src/app.ts; src/modules/settings.ts; src/modules/oidc.ts; migrationDataSource.ts; scripts/runMigration.ts; vitest.config.mts; playwright.config.ts; tests/; .github/workflows/ci.yml; .github/workflows/release.yml; docs/CONFIGURATION.md; docs/DATABASE.md; docs/OPERATIONS.md; docs/UPGRADING.md; scripts/check-help-documentation.mjs; tests/unit/help-documentation.spec.ts; src/frontend/; contracts/api/v1/; src/locales/; src/modules/frontendRenderer.ts; src/modules/frontendDevelopment.ts; scripts/generate-api.mjs; scripts/generate-locales.mjs; scripts/watch-frontend-inputs.mjs; vite.config.mts; tsconfig.frontend.json; tsconfig.frontend-ssr.json; tsconfig.test.json; playwright.frontend.config.ts; playwright.integration.config.ts
next-review: repository-command-or-help-tooling-change
-->

Surveyor is a collaboration application for recurring-date surveys, events, activity schedules, packing lists, rides,
and event cost sharing. TypeScript, Vue and Express provide request-local server rendering and browser interaction;
MariaDB stores application records and sessions. Existing controllers own shared business behavior and database
services own persistence.

## Features

- **Surveys** — organize recurring monthly dates with Yes/Maybe/No votes on weekday and week-of-month patterns.
- **Events** — manage registrations, attendance dates, dietary information, participant administration, and invoice pools.
- **Activity plans** — schedule time slots and roles, collect availability, and support assisted assignment planning.
- **Packing lists** — coordinate shared responsibilities while keeping each browser's personal **Packed?** checklist local.
- **Drivers lists** — offer rides, manage passenger capacity, and coordinate event-linked transport.
- **Profiles and guests** — let one account act through several participant profiles and allow invitation-based guest participation.

## Choose the right documentation

| Goal | Start here |
|---|---|
| Use Surveyor | [In-app user guides](docs/user-guide/en/README.md) |
| Develop or review the application | [Development Guide](docs/DEVELOPMENT.md) |
| Understand the design | [Architecture](docs/ARCHITECTURE.md) |
| Run tests | [Testing Guide](docs/TESTING_GUIDE.md) |
| Configure a deployment | [Configuration Reference](docs/CONFIGURATION.md) |
| Prepare or migrate the database | [Database and Migrations](docs/DATABASE.md) |
| Operate a production instance | [Production Operations](docs/OPERATIONS.md) |
| Upgrade or roll back | [Upgrading and Rolling Back](docs/UPGRADING.md) |
| Review documentation remediation | [Remediation backlog](docs/backlog/documentation-remediation.yml) |

The complete inventory and review state are in [`docs/README.md`](docs/README.md).

## Development quick start

This path creates a disposable local development instance from a clean clone. Production installations must use the [operations runbook](docs/OPERATIONS.md) instead.

### Prerequisites

Use the versions exercised by the repository workflows:

- Node.js 24.15.0
- npm from that Node.js installation
- MariaDB 10.11
- Git

### 1. Install the locked dependencies

```bash
git clone https://github.com/JulianiusM/Surveyor.git
cd Surveyor
npm ci
```

### 2. Create an empty development database

Create a database and a dedicated account with schema privileges. Adapt the host and password to your local MariaDB installation.

```sql
CREATE DATABASE surveyor_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'surveyor_dev'@'127.0.0.1' IDENTIFIED BY 'replace-this-password';
GRANT ALL PRIVILEGES ON `surveyor\_dev`.* TO 'surveyor_dev'@'127.0.0.1';
FLUSH PRIVILEGES;
```

### 3. Create the local configuration

Create an ignored `.env` file in the repository root:

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

The SMTP values must point to a real development mail catcher or test SMTP service if you use local registration, password reset, or guest recovery. For organization sign-in instead, configure OIDC as described in the [Configuration Reference](docs/CONFIGURATION.md); the registered callback path is `/users/oidc/callback`.

Surveyor reads built-in defaults, then its CSV settings file, then environment overrides. See the configuration reference before adding more settings or changing precedence.

### 4. Create the schema

The generated TypeORM index is not committed, so generate it before invoking the TypeORM wrapper. The following commands are for a new, empty, disposable development database:

```bash
npm run generate
npm run typeorm:sync
npm run typeorm:migrate
```

Do not run schema synchronization or destructive TypeORM commands against a production database. Existing databases follow [Database and Migrations](docs/DATABASE.md).

### 5. Start the development server

```bash
npm run server
```

This performs a full build, starts the TypeScript server under Nodemon with Express-hosted Vite middleware/HMR,
and starts serialized API/catalog generation. Confirm startup with:


```bash
curl http://localhost:3000/healthz
```

A healthy instance returns `ok`.

### 6. Complete the first sign-in

With local login enabled, register an account, open the activation message delivered by the configured SMTP service, activate the account, and then log in. With OIDC enabled, use the configured organization sign-in button instead.

## Common development commands

| Command | Purpose |
|---|---|
| `npm run server` | Build once, then run Express/Vite HMR and authored-input generation together. |
| `npm run server:dev` | Run only the server watcher; existing generated and built assets must already be present. |
| `npm run server:frontend` | Watch authored API contracts, locale catalogs and the permission registry; publish readiness after ordered generation. |
| `npm run build` | Clean `dist/`, generate shared inputs, compile server and Vue client/SSR output, compile print CSS, and copy print views/shared assets. |
| `npm run run` | Start the compiled application from `dist/server.js`. |
| `npm run generate` | Regenerate the TypeORM index and shared API/localization consumers without connecting to a database. |
| `npm run typecheck:frontend` | Check the Vue client and SSR TypeScript scopes. |
| `npm run typecheck:tests` | Check the Vue-aware test import graph. |
| `npm run typeorm:migrate` | Run pending migrations through Surveyor's settings-aware wrapper. |
| `npm run docs:check` | Produce an optional advisory report on documentation; never fail application delivery. |
| `npm run test:quick` | Select the configured database-free Vitest project: unit/client checks and scoped Express/Vite server integration. |
| `npm test` | Run all Vitest suites, including MariaDB integration tests. |
| `npm run test:frontend:browser` | Build and run isolated real-browser client checks; no system database is supplied by this runner. |
| `npm run test:all` | Run Vitest, build, isolated client-browser checks and built-application E2E. |

The [Development Guide](docs/DEVELOPMENT.md) contains database safety, generated-file behavior, change recipes, and troubleshooting. The [Testing Guide](docs/TESTING_GUIDE.md) contains the exact environment and runner contracts.

## Repository map

```text
src/server.ts                         startup sequencing and HTTP server
src/app.ts                            Express middleware, sessions, routes, health endpoint
src/routes/                           page routes and top-level API router
src/controller/                       request/response orchestration
src/middleware/                       authentication, authorization, validation, and shared flows
src/modules/database/entities/        TypeORM entities
src/modules/database/services/        database and transaction functions
src/modules/database/subscribers/     TypeORM subscribers
src/migrations/                       TypeORM migrations
src/frontend/                         Vue app, components, composables and feature views
contracts/api/v1/                     authored wire schemas
src/locales/                          shared browser/server catalogs
src/types/                            shared declaration contracts (.d.ts)
src/public/style/                     standalone print stylesheet
src/views/                             standalone Activity/Event print templates
tests/unit/                            isolated production logic
tests/frontend/                        client helpers/mounted Vue and isolated browser checks
tests/integration/                     database-backed workflows and genuine isolated server-component integration
tests/e2e/                             Playwright critical flows
docs/user-guide/                       canonical in-app help
docs/                                  maintainer and operator documentation
```

## Test and release automation

Vitest runs the unit, client and integration suites configured in `vitest.config.mts`. The isolated client-browser
runner uses built assets through `playwright.frontend.config.ts`. Built-application E2E uses `playwright.config.ts`
and owns the prepared database and compiled server through `npm run e2e:init`; it never reuses an arbitrary server.

The CI workflow currently runs for manual dispatch, reusable workflow calls, and pushes or pull requests on `master`, `dev`, and `ts-migration`. It uses Node.js 24.15.0 and MariaDB 10.11, installs dependencies, runs application Vitest tests with coverage, builds the application, and then runs the separate Chromium client and system checks.

The manual release workflow invokes that CI workflow first. After a successful run, it updates the requested version, tags the selected ref, builds the application, and publishes a production archive containing `dist/`, `docs/`, `fonts/`, `package-lock.json`, and a production-only package manifest. Database migrations are deliberately not executed by the release archive.

Documentation reporting is deliberately outside required CI. Use `npm run docs:check` or
`npm run docs:check:strict` on demand; both retain findings and exit zero. Actual-guide content tests use the optional
commands in the [Testing Guide](docs/TESTING_GUIDE.md), not the required application suites. The release attempts to
include documentation in a separate non-blocking step; missing help or a copy mismatch is reported without blocking the release.

## License

Surveyor is licensed under the [Apache License 2.0](LICENSE.md).

```bash
npm run docs:check:help
```
