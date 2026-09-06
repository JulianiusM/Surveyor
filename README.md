# Surveyor
<!--
documentation-metadata
audience: users; developers; operators
owner: project maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: D12 product summary, clean-clone development start, current scripts, test layers, CI branches, release entry points, and repository map; operator execution remains tracked in D04V; D14 help validation and focused command surface
source-anchors: package.json; package-lock.json; src/server.ts; src/app.ts; src/modules/settings.ts; src/modules/oidc.ts; migrationDataSource.ts; scripts/runMigration.ts; vitest.config.mts; playwright.config.ts; tests/; .github/workflows/ci.yml; .github/workflows/release.yml; docs/CONFIGURATION.md; docs/DATABASE.md; docs/OPERATIONS.md; docs/UPGRADING.md; scripts/check-help-documentation.mjs; tests/unit/help-documentation.spec.ts
next-review: repository-command-or-help-tooling-change
-->

Surveyor is a server-rendered collaboration application for recurring-date surveys, events, activity schedules, packing lists, rides, and event cost sharing. It is written in TypeScript and runs as an Express application backed by MariaDB.

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
| Use Surveyor | [In-app user guides](docs/user-guide/README.md) |
| Develop or review the application | [Development Guide](docs/DEVELOPMENT.md) |
| Understand the design | [Architecture](docs/ARCHITECTURE.md) |
| Run tests | [Testing Guide](docs/TESTING_GUIDE.md) |
| Configure a deployment | [Configuration Reference](docs/CONFIGURATION.md) |
| Prepare or migrate the database | [Database and Migrations](docs/DATABASE.md) |
| Operate a production instance | [Production Operations](docs/OPERATIONS.md) |
| Upgrade or roll back | [Upgrading and Rolling Back](docs/UPGRADING.md) |
| Continue the documentation migration | [Documentation Migration Status](docs/DOCUMENTATION_MIGRATION_STATUS.md) |

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
GRANT ALL PRIVILEGES ON surveyor_dev.* TO 'surveyor_dev'@'127.0.0.1';
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

This performs a full build, starts the TypeScript server under Nodemon, and starts the client-side esbuild watcher. Confirm startup with:

```bash
curl http://localhost:3000/healthz
```

A healthy instance returns `ok`.

### 6. Complete the first sign-in

With local login enabled, register an account, open the activation message delivered by the configured SMTP service, activate the account, and then log in. With OIDC enabled, use the configured organization sign-in button instead.

## Common development commands

| Command | Purpose |
|---|---|
| `npm run server` | Build once, then run the server and browser-code watchers together. |
| `npm run server:dev` | Run only the server watcher; existing generated and built assets must already be present. |
| `npm run server:client` | Run only the browser-code watcher. |
| `npm run build` | Generate the TypeORM index, compile server and browser TypeScript, compile Sass, and copy views/assets into `dist/`. |
| `npm run run` | Start the compiled application from `dist/server.js`. |
| `npm run generate` | Regenerate `src/modules/database/__index__.ts`. |
| `npm run typeorm:migrate` | Run pending migrations through Surveyor's settings-aware wrapper. |
| `npm run docs:check` | Validate documentation metadata, links, commands, paths, and registered concepts. |
| `npm run test:quick` | Run database-free unit and frontend Vitest suites. |
| `npm test` | Run all Vitest suites, including MariaDB integration tests. |
| `npm run test:all` | Run Vitest, build the application, and run the Playwright suite. |

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
src/public/js/                        browser TypeScript
src/public/style/                     Sass sources
src/views/                            Pug templates
tests/unit/                            isolated production logic
tests/frontend/                        browser-helper behavior under Vitest
tests/integration/                     MariaDB-backed production-service workflows
tests/e2e/                             Playwright critical flows
docs/user-guide/                       canonical in-app help
docs/                                  maintainer and operator documentation
```

## Test and release automation

Vitest runs the unit, frontend, and integration suites configured in `vitest.config.mts`. Playwright runs the focused browser/API flows configured in `playwright.config.ts` and manages the built server through `npm run e2e:init`.

The CI workflow currently runs for manual dispatch, reusable workflow calls, and pushes or pull requests on `master`, `dev`, and `ts-migration`. It uses Node.js 24.15.0 and MariaDB 10.11, checks documentation before installing dependencies, runs Vitest with coverage, builds the application, and then runs Chromium Playwright checks.

The manual release workflow invokes that CI workflow first. After a successful run, it updates the requested version, tags the selected ref, builds the application, and publishes a production archive containing `dist/`, `docs/`, `fonts/`, `package-lock.json`, and a production-only package manifest. Database migrations are deliberately not executed by the release archive.

## License

Surveyor is licensed under the [Apache License 2.0](LICENSE.md).

```bash
npm run docs:check:help
```
