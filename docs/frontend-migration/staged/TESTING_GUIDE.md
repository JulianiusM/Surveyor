# Testing Guide
<!--
documentation-metadata
audience: developers; maintainers; AI agents
owner: test maintainers
status: migration-pending
last-verified: 2026-10-08
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: shared and feature loading-test inventory and built-browser held-read checkpoints; FPR-07 documentation staging and source corrections; prospective frontend replacement, not production cutover or new runtime execution evidence
source-anchors: tests/frontend/frontend-loading-shell.spec.ts; tests/frontend/frontend-content-loading.spec.ts; src/frontend/components/LoadingSkeleton.vue; src/modules/frontendDevelopment.ts; src/frontend/app/mountPreservingDrafts.ts; tests/unit/frontend-development.spec.ts; tests/frontend/frontend-hydration-drafts.spec.ts; tests/e2e/frontend-development.spec.ts; tests/unit/frontend-contracts.spec.ts; tests/unit/frontend-localization.spec.ts; tests/unit/frontend-api-problems.spec.ts; tests/frontend/frontend-pilot.spec.ts; tests/integration/packing-api.spec.ts; tests/e2e/frontend-pilot-api.spec.ts; tests/e2e/frontend-pilot.spec.ts; tests/unit/entity-archival.spec.ts; tests/frontend/entity-archive.spec.ts; tests/frontend/entity-cards-overview.spec.ts; tests/integration/entity-archival.spec.ts; tests/e2e/archival.spec.ts; package.json; package-lock.json; vitest.config.mts; playwright.config.ts; tsconfig.test.json; tests/env.load.ts; tests/support/env.ts; tests/support/database.ts; tests/unit/; tests/frontend/; tests/integration/; tests/e2e/; tests/factories/; tests/keywords/; scripts/e2e.db.init.ts; tests/.env.test.example; .env.e2e.example; .github/workflows/ci.yml; tests/unit/help-documentation.spec.ts; tests/e2e/help-experience.spec.ts; scripts/check-help-documentation.mjs
next-review: frontend-production-cutover
production-reference: 2dfa257 native frontend documentation; reference only, not evidence of an installed production commit
canonical-merge-target: docs/TESTING_GUIDE.md
staging-origin: c42758a frontend pilot documentation; authorized 2026-10-08 migration-only rectification
-->

## Cutover staging

This is the temporary replacement draft for `docs/TESTING_GUIDE.md`. The canonical document continues to describe native
production until frontend cutover. For work on the migration checkout, use this draft with the
[Frontend Pilot](../../FRONTEND_PILOT.md) guide and executable package configuration. Merge the relevant draft into its existing
canonical owner at cutover, reconcile intervening native changes, remove this staging notice and temporary metadata,
and then remove the merged copy. Staging is advisory and introduces no release prerequisite.

The native documentation reference is `2dfa257`; it does not establish which commit is installed in production.
Original design decisions and D1–D5 remain in the linked migration records. This document records prospective
implementation guidance; the paired review owns actual runtime verification evidence.


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

The package pre-hooks for `test`, `test:unit`, `test:frontend`, `test:quick`, `test:integration`, and `test:ci` run `npm run generate` first. This regenerates the TypeORM index, API declarations/validators and localization artifacts without connecting to a database. Unit and frontend test layers remain database-free. Direct `npx vitest` invocations bypass these hooks, so run `npm run generate` first after a clean checkout or source-definition change.

## Vitest configuration

`vitest.config.mts` discovers:

```text
tests/unit/**/*.spec.ts
tests/frontend/**/*.spec.ts
tests/integration/**/*.spec.ts
```

The configuration defaults to the Node environment, loads `tests/support/env.ts`, and keeps file-level parallelism disabled. The Vue plugin transforms SFCs; the packing editor regression opts into happy-dom and restores its mounted app/query state. Sequential test files are required because integration suites independently rebuild the same disposable schema.

Coverage uses V8 and includes TypeScript and Vue components under `src/`, excluding migrations, generated database metadata, and declaration-only type files. The CI command writes text, LCOV, JSON, and JUnit outputs.

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

Playwright's managed server defaults `E2E_AUTO_ARCHIVE_ENABLED` to `false` so historical fixtures remain stable. The
example environment makes this choice explicit. Override it only for an intentional automatic-archival workflow;
manual archive/restore and personal-visibility E2E tests run normally with the automatic job disabled.

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
| Documentation label/path contract | Optional advisory documentation report | Keep application-behavior tests separate from maintained wording and images. |

A change may need several layers, but more layers are not automatically better. Protect each distinct failure mode at the cheapest stable seam.

## Archival coverage

`tests/unit/entity-archival.spec.ts` protects UTC inclusive-date boundaries, direct/inherited state, personal placement,
settings, and scheduling. `tests/frontend/entity-archive.spec.ts` and `entity-cards-overview.spec.ts` cover explicit
commands, success/failure handling, and independent main/archive filters. Keep time deterministic and use `TZ=UTC`,
matching CI and the datasource contract.

Persistence and concurrency belong in `tests/integration/entity-archival.spec.ts` against the guarded real MariaDB
schema. Preserve real entity metadata and exercise parent inheritance, durable restore, membership/privacy, target
deletion cleanup, conditional automatic updates, and unchanged business/file references. Mock only true external
side effects; file-preservation fixtures must not run invoice retention while asserting archival behavior.

`tests/e2e/archival.spec.ts` covers the actual session/API/render/browser boundaries, including collapsed sections,
private placement, authorized lifecycle actions, and inherited event state. Schema synchronization in these suites
does not validate migration SQL: separately rehearse `AddEntityArchival1789862400000` against an existing-schema copy
and the supported fresh-schema bootstrap. Follow [Database and Migrations](../../DATABASE.md) and prove the disposable target
before either rehearsal. Documentation reports remain advisory and are not substitutes for these application checks.

## Frontend pilot coverage

The implemented scope and entry points are in [Frontend Pilot](../../FRONTEND_PILOT.md). Use the boundary that changed:

| Boundary | Focused files |
|---|---|
| Generated contract parity, typed parameters and safe additive browser responses | `tests/unit/frontend-contracts.spec.ts` |
| Shared catalogs and structured API errors | `tests/unit/frontend-localization.spec.ts`, `tests/unit/frontend-api-problems.spec.ts` |
| Refresh, identity isolation, draft/conflict and browser-local packing state | `tests/frontend/frontend-pilot.spec.ts` |
| Rendered editor, packing special states, shell navigation and native locale selection | `tests/frontend/frontend-pilot-editor.spec.ts`, `tests/frontend/frontend-pilot-shell.spec.ts` |
| Packing projections, grants, stale edits, legacy writers and assignment locking | `tests/integration/packing-api.spec.ts` |
| Unknown command recovery, reactive feedback and update coordination | `tests/frontend/frontend-command-recovery.spec.ts`, `tests/frontend/frontend-update-coordinator.spec.ts` |
| Metadata/settings recovery, nullable descriptions and existing packing form behavior | `tests/frontend/packing-management-ui.spec.ts` |
| Complete identity/guest dirty guards and committed navigation | `tests/frontend/frontend-pilot-identity.spec.ts` |
| Eligible read recovery, selected-event authority and native search/history semantics | `tests/frontend/frontend-refresh-navigation.spec.ts` |
| Shared decorative skeletons, localized status, SSR-safe phrasing and lazy-route progress without replacing the mounted draft | `tests/frontend/frontend-loading-shell.spec.ts` |
| Independent Help/Overview loading, complete read-only SSR, language isolation and preserved draft/focus/error/empty semantics | `tests/frontend/frontend-content-loading.spec.ts` |
| Native-equivalent packing HTML and the shared JavaScript-required/read-only fallback | `tests/frontend/frontend-native-fallback.spec.ts`; relevant HTTP cases in `tests/e2e/frontend-pilot-api.spec.ts` |
| Locked settings, native duplicate grants and copied form context | `tests/integration/packing-management-api.spec.ts` |
| Real cookie sessions, context/CSRF admission, conditional reads and v1 HTTP errors | `tests/e2e/frontend-pilot-api.spec.ts` |
| Rendered desktop/mobile pilot behavior, native help fallback and incremental loading under held genuine reads | `tests/e2e/frontend-pilot.spec.ts` |

The loading cases in `tests/e2e/frontend-pilot.spec.ts` hold individual browser reads without replacing their real
responses. The Overview case checks session-only initial HTML, a ready owner region while participation is still
pending, and real reduced-motion styling. The packing/settings case checks the independent table and dialog reads:
authorized metadata accepts a focused draft before the remaining settings arrive, and retains that input after they
load. Held reads are released and interception removed in teardown; they do not change command/retry semantics.

Set `E2E_PILOT_STATE_SCREENSHOTS=true` to optionally retain the mounted loading checkpoints in that suite's ignored
Playwright output: independent Overview regions, pending/loaded packing, and metadata-ready/loaded settings. The
existing capture helper records each checkpoint at desktop/mobile sizes and checks horizontal overflow; optional
pictures require individual inspection and do not constitute automatic visual approval. Follow the ordinary
[E2E database configuration and guarded reset procedure](#e2e-setup) before running the suite. These are application tests;
staged guidance and maintained-prose checks are not required delivery gates. Actual results remain in the paired review.

Run `npm run typecheck:frontend` for Vue client/server type checks and `npm run build` before Playwright. The ordinary
build includes both Vue bundles and packaged API artifacts. Contract/catalog source edits need
`npm run prepare:frontend` for a standalone runner. The root development workflow watches authored inputs and
regenerates them before restarting Express; a standalone source watcher does not supply that workflow. A focused direct runner command
still uses the integration or E2E database setup described above, including its destructive reset behavior.

Packing fixtures that call `createEntity` directly do not receive form permission defaults automatically. When a test
needs public assignment access, persist that intended grant through the creation/settings hook; native forms submit
`defaultPerms[public][0]=ACCESS_VIEW`. Do not weaken the API permission check to compensate for an incomplete fixture.

Frontend completion also requires the [paired visual and behavior review](../../FRONTEND_PILOT.md#visual-and-behavior-review)
against the current application. The optional baseline capture adds HTTP fixtures to a guarded, existing disposable
schema; it does not initialize or reset it. Its capture manifest is evidence for manual inspection, not automatic
visual approval or a required documentation check. Use a separate Playwright `--output` directory when retaining
baseline images under `test-results`, since the runner cleans its selected output directory.

For a bounded follow-up without business fixture changes, the optional
`scripts/capture-frontend-rectification-readonly.cjs` accepts an explicit environment file, an existing packing UUID,
the existing local HTTP port and the disposable schema name. It checks exact database grants; the runtime owner
must separately verify that the HTTP process uses that target. The optional fifth argument `corrections` limits
capture to native/pilot error presentation and metadata recovery, including reachable Review and acknowledgement
without command replay. Omit it for the full focused collection. One native login of an existing fictional account
establishes the session. All browser mutations are then intercepted before dispatch. Its unknown-outcome pictures
simulate response loss against real, unchanged reads and do not prove a backend write. Generated ignored captures
still require individual inspection. The helper performs no fixture creation, schema reset or server management.

Built browser tests do not exercise Vite middleware or source-module hydration. For changes to frontend bootstrap,
development integration or routing, run an actual `npm run server` against explicitly isolated development settings,
then test document-emitted module/style URLs, same-document controls/navigation, HMR and generated-input restart.
Development settings use ordinary `DB_*` names; an `E2E_DB_*` file alone does not select the source server's database.
Never reuse the default reset hook to attach to an existing development server. A separate Playwright configuration
with `webServer` disabled can target a verified disposable source server without initializing its schema.
Set `E2E_FRONTEND_DEVELOPMENT=true` in that separately configured run to include
`tests/e2e/frontend-development.spec.ts`. It exercises actual document-emitted modules and native asset URLs,
locale changes during a held lazy navigation, and text typed before client hydration. It is skipped in ordinary
built-release runs. Keep `TZ=UTC` for deterministic date fixtures, matching the documented archival checks below.
`FRONTEND_BASELINE_RUNTIME=development` selects source Express/Vite for the optional paired capture, with the same
explicit schema acknowledgment and restricted-grant checks. It records source fingerprints and omits startup jobs;
it supplements, rather than substitutes for, checking the normal watcher/startup command and installed release.

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

1. Installs the lockfile with `npm ci`.
2. Creates and grants dedicated `surveyor_test` and `surveyor_e2e` schemas.
3. Writes `tests/.env.test` and `.env.e2e`.
4. Runs `npm run test:ci` with application Vitest coverage and JUnit output.
5. Builds the application.
6. Installs or restores Chromium.
7. Runs `npm run e2e` with application Playwright reports.
8. Uploads reports and coverage artifacts.
9. Runs the configured SonarQube scan.

Documentation checks and tooling regressions are absent from this required sequence. Tests of maintained prose,
images, guide search examples, or documentation completeness live outside application test discovery.

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

### A unit/frontend-only command cannot import generated metadata or contracts

Prefer importing the production module actually under test without crossing the database bootstrap boundary. The normal unit/frontend/quick package scripts regenerate their inputs. For a direct runner invocation, run `npm run generate` first; do not switch to database-backed `npm test` merely to obtain generated files.

### CI passes a layer that fails locally

Compare Node.js, MariaDB, environment files, process-level variables, generated output, Chromium version, and whether an old server is being reused. The workflow files and lockfile are the reproducibility baseline.

## Help runtime tests and optional documentation reports

The normal unit suite in `tests/unit/help-documentation.spec.ts` now tests the executable renderer against synthetic
fixtures: fixed source paths, traversal rejection, metadata stripping, heading generation, URI/HTML rejection, and
contextual route mapping. It must work even when the maintained documentation directory is absent. The normal
Playwright test in `tests/e2e/help-experience.spec.ts` checks the application navbar's contextual link, not a guide's
contents. Neither requires real guide text, images, wording, or a reviewed source fingerprint.

Checks of the actual guides are retained under `tests/documentation/`, not silently deleted or marked passing.
The optional configurations there are separate from the application Vitest and Playwright discovery paths.

```bash
npm run docs:check
npm run docs:check:strict
npm run docs:check:help
npm run docs:test:tooling
npm run docs:test:content
npm run docs:test:browser
```

All of these report commands are advisory and exit zero on findings and tool failures. Their logs and JSON under
`artifacts/documentation/` preserve the actual child exits and distinguish findings from incomplete execution.
The strict command broadens the reported concepts; it is not an enforcement switch.

The first four commands need no dependency installation or database. Content reports use installed Vitest and marked.
Browser reports require the existing build, installed Chromium, controlled environment, and disposable E2E database
specified above. They reuse the normal managed-server configuration, including its destructive E2E initialization.
They are not invoked by application CI, application test scripts, or the release prerequisite chain.

An offline help-authoring finding does not disable the runtime security guard. Unsafe Markdown continues to be rejected
by the running help renderer. Application-security regressions remain real failures; documentation quality does not.

Use findings to improve guides or record follow-up work without delaying application delivery. Visual changes still
require the individual inspection practice in [In-App Help Visuals](../../HELP_VISUALS.md), not an automated delivery gate.
