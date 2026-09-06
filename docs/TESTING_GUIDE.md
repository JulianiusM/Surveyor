# Testing Guide
<!--
documentation-metadata
audience: developers; maintainers; AI agents
owner: test maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: D12 Vitest and Playwright discovery, layer contracts, environment loading, MariaDB guardrails, E2E lifecycle, current factories/keywords/support paths, commands, coverage, and CI behavior; D14 help authoring, rendered semantic, contextual navigation, and release packaging coverage
source-anchors: package.json; package-lock.json; vitest.config.mts; playwright.config.ts; tsconfig.test.json; tests/env.load.ts; tests/support/env.ts; tests/support/database.ts; tests/unit/; tests/frontend/; tests/integration/; tests/e2e/; tests/factories/; tests/keywords/; scripts/e2e.db.init.ts; tests/.env.test.example; .env.e2e.example; .github/workflows/ci.yml; tests/unit/help-documentation.spec.ts; tests/e2e/help-experience.spec.ts; scripts/check-help-documentation.mjs
next-review: test-layout-command-or-help-validation-change
-->

Surveyor uses two runners with four test layers:

- **Vitest unit tests** for isolated server-side production logic.
- **Vitest frontend tests** for deterministic browser helpers and DOM-adjacent behavior without starting the application.
- **Vitest integration tests** for production services and selected controllers against a real disposable MariaDB schema.
- **Playwright E2E tests** for critical HTTP, session, route, render, and browser-facing workflows against the built application.

The test file suffix is `*.spec.ts`. Runner configuration and the repository tree are the source of truth for inventory; do not hard-code test counts in documentation.

## Safety first

The test suites rebuild databases:

- Integration setup calls `AppDataSource.synchronize(true)` for each integration suite.
- E2E setup clears its database and recreates the schema from entities.

The guards require:

```text
TEST_DB_NAME contains "test"
E2E_DB_NAME contains "e2e"
```

Those name checks reduce risk but do not prove that a database is disposable. Use dedicated local schemas and credentials with no privileges outside those schemas. Never point test settings at development, staging, or production data.

## Prerequisites

Match CI for reproducibility:

- Node.js 24.15.0
- MariaDB 10.11
- Dependencies installed with `npm ci`
- Chromium installed through Playwright for E2E

## Vitest setup

### 1. Create the integration database

Example:

```sql
CREATE DATABASE surveyor_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'surveyor_test'@'127.0.0.1' IDENTIFIED BY 'replace-this-password';
GRANT ALL PRIVILEGES ON surveyor_test.* TO 'surveyor_test'@'127.0.0.1';
FLUSH PRIVILEGES;
```

### 2. Create `tests/.env.test`

```bash
cp tests/.env.test.example tests/.env.test
```

Then set the dedicated credentials:

```dotenv
TEST_DB_HOST=127.0.0.1
TEST_DB_PORT=3306
TEST_DB_USER=surveyor_test
TEST_DB_PASSWORD=replace-this-password
TEST_DB_NAME=surveyor_test
TEST_DB_LOGGING=false
```

`tests/env.load.ts` loads the root `.env`, then `tests/.env.test`, then optional `tests/.env.test.local`. Each dotenv load fills values that are still unset. It then maps `TEST_DB_*` to the ordinary `DB_*` names before application modules import the production datasource.

Process-level environment variables therefore remain authoritative. Keep application development and integration-test database values separate and verify the final target before running database-backed tests.

### 3. Run the desired layer

```bash
npm run test:unit
npm run test:frontend
npm run test:quick
npm run test:integration
npm test
```

`npm test` runs every Vitest layer, including MariaDB integration tests. It is not a database-free shortcut. `npm run test:quick` is the database-free unit-plus-frontend command.

The package `pretest`, `pretest:integration`, and `pretest:ci` hooks regenerate `src/modules/database/__index__.ts` before their corresponding commands. The layer-specific unit and frontend scripts do not have dedicated pre-hooks, but those suites do not initialize the database.

## Vitest configuration

`vitest.config.mts` discovers:

```text
tests/unit/**/*.spec.ts
tests/frontend/**/*.spec.ts
tests/integration/**/*.spec.ts
```

The configuration uses the Node environment, loads `tests/support/env.ts`, and keeps file-level parallelism disabled. Sequential test files are required because integration suites independently rebuild the same disposable schema.

Coverage uses V8 and includes `src/**/*.ts`, excluding migrations, generated database metadata, and declaration-only type files. The CI command writes text, LCOV, JSON, and JUnit outputs.

## Layer contracts

### Unit tests

Use `tests/unit/` when the subject can be exercised without MariaDB, an Express application, filesystem mutation, SMTP, OIDC discovery, or a real browser.

Good subjects include:

- pure transformations and formatting;
- permission-mask helpers;
- allocation and requirements algorithms;
- email rendering that returns text/HTML without sending;
- API input normalization utilities; and
- deterministic job-state helpers.

A current factory-backed pattern is:

```typescript
import {describe, expect, it} from 'vitest';
import {buildDateTotals} from '../../src/modules/lib/util';
import {createDateTotalsCase} from '../factories/dateTotalsFactory';

describe('event registration date totals', () => {
    it('counts registrations across the event window', () => {
        const testCase = createDateTotalsCase();
        expect(buildDateTotals(
            testCase.eventStart,
            testCase.eventEnd,
            testCase.registrations,
        )).toEqual(testCase.expectedTotals);
    });
});
```

Prefer production inputs/outputs over private helper call sequences.

### Frontend tests

Use `tests/frontend/` for browser TypeScript that can be tested deterministically without navigation through a running server. The Vitest environment is still Node, so tests install only the minimal `window`, `document`, storage, element, or event stubs required by the production helper.

Good subjects include:

- form serialization and dynamic row behavior;
- permission-bundle interpretation;
- client-side date/status display decisions;
- UI helper state transitions; and
- local-storage behavior.

Do not assume a global browser DOM. Save and restore every global installed by the test so one frontend spec cannot contaminate another.

### Integration tests

Use `tests/integration/` when correctness depends on TypeORM mappings, transactions, constraints, relationships, persisted queries, or coordination among production service functions. Selected controller orchestration may also be exercised when it can be called directly with production-shaped data and without constructing a full HTTP stack.

Integration suites use the real `AppDataSource` and production entity metadata. They do not replace TypeORM repositories with general-purpose mocks.

The standard lifecycle is:

```typescript
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
    closeIntegrationDatabase,
    initializeIntegrationDatabase,
} from '../support/database';

beforeAll(async () => {
    await initializeIntegrationDatabase();
});

afterAll(async () => {
    await closeIntegrationDatabase();
});

describe('a persisted workflow', () => {
    it('writes and reloads production entities', async () => {
        // Arrange through tests/factories and production service functions.
        // Act through the public workflow operation.
        // Assert persisted state and user-visible projections.
    });
});
```

Each integration file owns a clean schema for its suite. Do not rely on rows created by another spec file. Use `tests/factories/` for valid production-shaped entities/inputs and remove arbitrary sleeps or ordering assumptions.

Narrow spies are appropriate at an external side-effect boundary when the database workflow is the subject. The existing invoice integration suite, for example, spies on the mail-sending function while preserving the production database services. Keep such replacements local, restore them, and assert the observable notification contract.

### E2E tests

Use `tests/e2e/` for a critical journey that requires the actual built server, middleware order, cookies/session state, redirects, Pug rendering, or public route/API behavior.

Playwright is configured for Chromium. Its managed web server runs:

```text
npm run e2e:init
```

That command initializes the E2E database and starts `dist/server.js`; it does not build the application. Build first.

The E2E suite currently uses `APIRequestContext` heavily for focused HTTP workflows. This is still E2E coverage because requests pass through the real built application, routes, middleware, session store, and database.

Use E2E sparingly for high-value flows. Avoid reproducing every service-level edge case in the slowest layer.

## E2E setup

### 1. Create the E2E database

```sql
CREATE DATABASE surveyor_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'surveyor_e2e'@'127.0.0.1' IDENTIFIED BY 'replace-this-password';
GRANT ALL PRIVILEGES ON surveyor_e2e.* TO 'surveyor_e2e'@'127.0.0.1';
FLUSH PRIVILEGES;
```

### 2. Create `.env.e2e`

```bash
cp .env.e2e.example .env.e2e
```

Update the dedicated credentials and seeded local account. Keep:

```dotenv
NODE_ENV=e2e
APP_PORT=3001
ROOT_URL=http://localhost:3001
LOCAL_LOGIN_ENABLED=1
OIDC_ENABLED=0
E2E_DB_NAME=surveyor_e2e
```

The initializer also requires `E2E_ADMIN_USERNAME`, `E2E_ADMIN_EMAIL`, and `E2E_ADMIN_PASSWORD`. It maps the E2E settings through the normal application settings loader when the built server starts.

By default, the initializer recreates the schema from entity metadata and skips historical migrations. Set `E2E_RUN_MIGRATIONS=true` only for an explicit migration exercise whose database and migration expectations have been reviewed.

### 3. Install Chromium and run

```bash
npx playwright install --with-deps chromium
npm run build
npm run e2e
```

Playwright starts and stops the server according to `playwright.config.ts`. Outside CI, it may reuse a server already responding at the configured base URL. Stop unrelated processes or verify the responding instance before trusting the result.

Useful alternatives:

```bash
npm run e2e:prepare   # reset/recreate/seed only
npm run e2e:init      # prepare, then start the compiled application
npm run test:all      # all Vitest layers, build, then Playwright
```

## Factories, keywords, fixtures, and support

| Directory | Contract |
|---|---|
| `tests/factories/` | Build valid production-shaped inputs, entities, expected projections, and E2E form data. |
| `tests/keywords/` | Reusable workflow and assertion functions shared by specs. |
| `tests/fixtures/` | Static fixture assets or seed material. |
| `tests/support/` | Runner environment loading and integration database lifecycle. |

Use a factory when several tests share a non-trivial valid shape. Keep overrides explicit so the important difference is visible in the spec. Use a keyword when several tests repeat a meaningful public workflow, not merely to hide all arrange/act/assert details.

Do not create a new helper path in documentation before it exists in the repository.

## Choosing the layer

| Behavior | Primary layer | Add a broader layer when... |
|---|---|---|
| Pure calculation or normalization | Unit | it also depends on persistence or rendered controls |
| Browser helper with stubbed globals | Frontend | real Pug wiring, navigation, or session state matters |
| Service transaction or relationship | Integration | middleware/route admission is part of the risk |
| Controller using production services | Integration | full request parsing, cookies, redirect, or view rendering matters |
| Authentication, guest, route, or critical creation flow | E2E | keep lower-layer edge cases too |
| Documentation label/path contract | Documentation gate or D14 semantic check | a real interactive journey is also critical |

A change may need several layers, but more layers are not automatically better. Protect each distinct failure mode at the cheapest stable seam.

## Assertions and isolation

- Assert user-visible output, returned domain data, persisted state, emitted email contract, or permission result.
- Avoid assertions on repository-call counts or private implementation order unless that order itself is the contract.
- Use unique identifiers or factory defaults that make failures readable.
- Freeze or inject time for deadline/retention behavior where production functions allow it.
- Close database connections and restore globals/spies in teardown.
- Never make a test depend on a previous spec file.
- Keep external network services out of Vitest; OIDC provider interoperability belongs in a controlled integration environment, while local OIDC helpers can be isolated around their inputs.

## Command matrix

| Command | Database | Build | Browser | Intended use |
|---|---|---|---|---|
| `npm run test:unit` | No | No | No | Isolated server logic. |
| `npm run test:frontend` | No | No | Stubbed globals only | Browser helper logic. |
| `npm run test:quick` | No | No | Stubbed globals only | Fast local regression pass. |
| `npm run test:integration` | Disposable MariaDB | No | No | Persistence and production-service workflows. |
| `npm test` | Disposable MariaDB | No | Stubbed globals only | All Vitest layers. |
| `npm run test:ci` | Disposable MariaDB | No | Stubbed globals only | Vitest coverage and JUnit output for CI. |
| `npm run e2e:prepare` | Destructive E2E schema reset | Existing `dist/` not used | No | Initialize and seed only. |
| `npm run e2e` | Destructive E2E schema reset through managed server | Requires existing `dist/` | Chromium | Focused built-application flows. |
| `npm run test:all` | Both disposable schemas | Yes | Chromium | Full local sequence. |

## CI contract

`.github/workflows/ci.yml` uses Node.js 24.15.0 and MariaDB 10.11. It:

1. Runs `npm run docs:check` before dependency installation.
2. Installs the lockfile with `npm ci`.
3. Creates and grants dedicated `surveyor_test` and `surveyor_e2e` schemas.
4. Writes `tests/.env.test` and `.env.e2e`.
5. Runs `npm run test:ci` with Vitest coverage and JUnit output.
6. Builds the application.
7. Installs or restores Chromium.
8. Runs `npm run e2e` with Playwright JUnit and HTML reports.
9. Uploads reports and coverage artifacts.
10. Runs the configured SonarQube scan.

Locally, run the layer relevant to the change while iterating. Before release-sensitive or cross-boundary work, reproduce the full sequence as closely as practical.

## Troubleshooting

### Integration tests refuse the database

Confirm that `TEST_DB_NAME` contains `test`, points to a disposable schema, and that the user can drop/create tables in that schema. Check for a conflicting process-level `TEST_DB_*` value loaded before the file.

### Integration suites interfere with one another

Do not enable Vitest file parallelism. Each suite rebuilds the shared schema; the committed configuration deliberately serializes files.

### E2E initialization refuses the database

Confirm that `E2E_DB_NAME` contains `e2e`. Do not weaken the guard or reuse another environment's database.

### Playwright reports an unavailable server

Run `npm run build`, verify `.env.e2e`, confirm MariaDB is reachable, and check that the configured port is free. The managed server waits for `/healthz`.

### A unit/frontend-only command cannot import generated database metadata

Prefer importing the production module actually under test without crossing the database bootstrap boundary. When a test legitimately needs entity metadata or the full package pre-hook, run `npm run generate` first or use `npm test`.

### CI passes a layer that fails locally

Compare Node.js, MariaDB, environment files, process-level variables, generated output, Chromium version, and whether an old server is being reused. The workflow files and lockfile are the reproducibility baseline.

## In-app help validation

Use all three layers when changing the help system or a critical user workflow:

```bash
npm run docs:check:help
npm exec -- vitest run tests/unit/help-documentation.spec.ts
npm exec -- playwright test tests/e2e/help-experience.spec.ts
```

The authoring checker validates every maintained guide without starting Surveyor. The unit suite renders the guides through the production help controller and protects task ordering, search, contextual mapping, table-of-contents generation, URI and HTML rejection, local assets, and critical workflow statements against current UI labels. The focused Playwright suite verifies the public search, document navigation, visual aid, and contextual navbar link in the built application.

Feature changes that rename a control or change a documented state must update the guide and the relevant semantic assertion in the same change. A visual change must also follow [In-App Help Visuals](HELP_VISUALS.md).
