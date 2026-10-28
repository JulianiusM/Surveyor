# Testing Guide
<!--
documentation-metadata
audience: developers; maintainers; AI agents
owner: test maintainers
status: current
last-verified: 2026-10-28
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: release-publication local-origin regressions and explicit system-fixture identity budgets reconciled; prior installed SSR, fork worker, browser and guarded database boundaries retained; no deployment or exhaustive verification claim
source-anchors: package.json; src/backend/app.ts; src/frontend/; src/backend/routes/; src/backend/controller/; src/backend/modules/database/; src/backend/modules/api/; contracts/api/v1/; src/common/locales/; scripts/generate-api.mjs; scripts/generate-locales.mjs; scripts/watch-frontend-inputs.mjs; scripts/release-publication.mjs; scripts/tests/release-publication.test.mjs; .github/workflows/ci.yml; .github/workflows/release.yml; vite.config.mts; vitest.config.mts; playwright.config.ts; playwright.frontend.config.ts; playwright.integration.config.ts; docs/decisions/DEC-006-FRONTEND-FRAMEWORK.md
next-review: test-layout-command-or-help-validation-change
-->

Surveyor uses two runners with four test layers:

- **Vitest unit tests** for isolated server-side production logic.
- **Client tests** under Vitest for deterministic browser helpers/DOM behavior, or Playwright for isolated browser behavior using built assets.
- **Vitest integration tests** for production services/controllers against real disposable MariaDB, or genuine integration of production server components when persistence is outside the tested boundary.
- **Playwright E2E tests** for critical system workflows against the built application and its fully prepared real database.

The explicit 2026-10-13 decision retains this E2E boundary. Isolated built-browser fixtures belong to the client
layer even when another runner happens to start a server/database. Source-server browser workflows with real
persistence belong to integration coverage; they are not built-application E2E. Exact runner selection comes from
configuration and package scripts; the frontend and compiler contracts below cover their distinct scopes.

Genuine integration of production server components can be database-free when application database persistence lies
outside the exercised boundary. The Express/Vite fixture combines development middleware, shared SSR and HTTP asset
delivery; the session-admission fixture combines actual Express/session middleware and production admission with
synthetic anonymous MemoryStore contexts. Both use the existing database-free selection without initializing a
schema. The session fixture preserves the original middleware Session/save methods, rejects a changed stored
generation instead of adopting it, and leaves cookie-free initial reads uninitialized. Store writes/touches,
response cookies and original object identity are observable assertions; synthetic contexts do not establish real
account/guest ORM identity or domain permission behavior. Those require the existing persistence/system boundaries.
The shared-entity-routing fixture combines real Express/session middleware, authoritative context admission,
generated validation and the restored route factories. Injected feature callbacks keep persistence outside this
boundary; receipt ordering, scoped delivery and upload ownership checks do not establish ORM rollback or complete
identity/provider journeys. It uses the same database-free selection and closes its owned server, store and temporary
uploads. These fixtures close their owned infrastructure. A mocked response alone does not establish
that integration boundary. The [Development Policy](policies/DEVELOPMENT_POLICY.md#test-selection-and-evidence)
owns this bounded classification; database-backed integration retains real ORM metadata and guarded schema setup.

The API-routing fixture composes the actual API root, version selector and domain routers over Express/session
HTTP. Anonymous reads and rejected inputs keep persistence outside the boundary; it checks protocol selection,
early parser errors and generated admission without claiming authenticated workflows or database rollback.
The isolated generic-error fixture separately exercises last-resort delivery when API projection or localization fails.

The development runtime fixture follows the Vue export-helper import emitted by a real component and rejects
neighboring/private aliases. Successful entry/component fetches alone do not establish browser initialization;
actual source-server browser checks must also observe hydration and module delivery errors.

The test file suffix is `*.spec.ts`. Runner configuration and the repository tree are the source of truth for inventory; do not hard-code test counts in documentation.

## Safety first

The test suites rebuild databases:

- Database-backed integration setup calls `AppDataSource.synchronize(true)` for each suite in the schema-resetting project; the separately selected server-infrastructure fixtures never initialize a database.
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
GRANT ALL PRIVILEGES ON `surveyor\_test`.* TO 'surveyor_test'@'127.0.0.1';
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

`npm test` runs every Vitest layer, including MariaDB integration tests. It is not a database-free shortcut.
`npm run test:quick` selects the configured database-free project: unit/client checks and scoped server-component
integration. The runner configuration owns this selection once.

The normal Vitest package scripts have pre-hooks that run `npm run generate`, including the unit, frontend and quick
commands. Generation prepares `src/backend/modules/database/__index__.ts` and authored API/localization consumers without
connecting to a database. Direct runner invocations bypass package hooks; prepare current inputs after checkout or an
authored input change. The scripts in `package.json` own the exact preparation sequence.

Release-publication regressions use Node's test runner: `node --test scripts/tests/release-publication.test.mjs`.
They create disposable local Git origins and archives to verify tested-source identity, version-only commits,
archive validation, atomic branch/tag publication and failure diagnostics with credentials redacted. The existing CI
database-free stage executes this suite separately from Vitest; it publishes no hosted release.

## Vitest configuration

`vitest.config.mts` discovers:

```text
tests/unit/**/*.spec.ts
tests/frontend/**/*.spec.ts
tests/integration/**/*.spec.ts
```

The configuration uses the Node environment and loads `tests/support/env.ts`. The `database-free` project runs
isolated unit/client files and scoped server-component integration with bounded workers. Windows uses separate
processes after observed native threaded-worker exits without a test result; Linux CI retains threads. The same
concurrency bound, fresh file isolation and UTC environment apply to both pools; the native exit's precise cause
has not been established.

The shared configuration explicitly sets `clearMocks: false` to retain the existing mock-history behavior when
using Vitest 5, whose default clears calls before each test. Individual fixtures still own their intended mock
reset/restore boundaries; an upgrade must not erase setup evidence merely to obtain a passing assertion. Review
the [official migration guidance](https://vitest.dev/guide/migration/) when changing the runner and keep its V8
coverage package on the matching release.

The shared Windows fork worker delivers transformed source through Vitest's existing IPC rather than its optional
per-module temporary-file handoff. This prevents those files and their expensive replacement-style renames; it does
not replace source transformation, mocking, fork isolation, application/database ordering or hook/assertion budgets.
Atomic publication remains appropriate whenever a file handoff or persistent cache is used. The worker extends the
public but experimental `ForksPoolWorker` export, changing only handoff selection and matching factory/worker names;
review that contract on Vitest upgrades. Larger IPC messages trade serialization/memory for the removed filesystem
work. Linux retains its existing thread pool.

The database-backed `integration` project serializes its files because each rebuilds the same disposable schema.
A full local Vitest run orders those projects so database resets do not overlap independent files. Keep database-backed
fixture resets serialized; their requirement does not prohibit isolated database-free parallelism. Exact discovery,
worker limits and project order belong to `vitest.config.mts`.

Coverage uses V8 over the configured TypeScript/Vue source inventory, excluding migrations, generated database
metadata and declaration contracts. It does not measure template/Sass visual parity. The CI command writes text,
LCOV, JSON and JUnit outputs; `vitest.config.mts` owns the exact inclusion/exclusion inventory.

## Layer contracts

### Unit tests

Use `tests/unit/` when the subject can be exercised without MariaDB, an Express application, application/user filesystem
side effects, SMTP, OIDC discovery or a real browser. Established offline generator/Help tooling fixtures may use
isolated temporary trees with guarded cleanup; they do not write application or user storage. The centralized
[development policy](policies/DEVELOPMENT_POLICY.md#test-selection-and-evidence) owns the test-layer boundary.

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
import {buildDateTotals} from '../../src/backend/modules/lib/util';
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

Use `tests/frontend/` for deterministic client behavior. Vitest tests install only the browser globals needed by the
production helper. Isolated real-browser tests live in `tests/frontend/browser/` and use the separate client
Playwright runner; Vitest excludes that directory. They exercise built modules, controls, templates or hydration
without claiming the integrated server/session/database boundary. Their normal package command prepares its build;
direct runner invocations require current artifacts. They do not initialize a database or start an app server.

Good subjects include:

- form serialization and dynamic row behavior;
- permission-bundle interpretation;
- client-side date/status display decisions;
- mounted components, scoped Query/transport consumers and draft/command state;
- initialization, localization and feedback lifetimes; and
- local-storage behavior.

Do not assume a global browser DOM. Save and restore every global installed by the test, and dispose application
contexts, query observers, timers, listeners and object URLs so one frontend spec cannot contaminate another.

### Integration tests

Use `tests/integration/` when correctness depends on TypeORM mappings, transactions, constraints, relationships,
persisted queries or coordination among production services. Selected controller orchestration uses production-shaped
data. Genuine server-component integration may instead exercise actual middleware/rendering/HTTP without application
database persistence. The bounded development-runtime and session-admission fixtures use that boundary rather than
mocked HTTP delivery. Synthetic MemoryStore contexts do not establish stored application identities or ORM behavior.

Database-backed integration uses the real `AppDataSource` and production entity metadata, without general-purpose
repository mocks. The database-free infrastructure selection does not initialize that datasource.

The standard database-backed lifecycle is:

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

Each database-backed integration file owns a clean schema for its suite. Do not rely on rows created by another
spec file. Use `tests/factories/` for valid production-shaped entities/inputs and remove arbitrary sleeps or ordering
assumptions. The scoped database-free server fixtures instead own and close their local HTTP listeners and any Vite
instance they create.

Use awaited teardown for each owned listener, Vite instance, database connection and temporary fixture after
its children settle, including assertion failures. Remove temporary paths only after verifying their exact resolved
location, ownership and inactive lifecycle; never sweep the user's temporary directory by name shape or age alone.
An abrupt process exit or worker retirement after a timeout can interrupt asynchronous teardown. Inspect its
remaining fixture after the run settles; preserve it when child settlement or ownership is uncertain.
Preserve the current reviewed preparation receipt/output, supported runtime and required verification evidence.
After reviewing their replacement, remove superseded ignored preparation copies and obsolete packaged dependency
trees; retain any source, lockfiles or reports still needed to reproduce their results. Generated runtime contracts
and current build outputs have a separate consumer lifecycle and are not disposable test leftovers.

Narrow spies are appropriate at an external side-effect boundary when the database workflow is the subject. The existing invoice integration suite, for example, spies on the mail-sending function while preserving the production database services. Keep such replacements local, restore them, and assert the observable notification contract.

### E2E tests

Use `tests/e2e/` only for a critical journey through the actual built application with its fully prepared database,
routes, middleware, sessions and rendering integrated as in the production setup. A manufactured document or fully
intercepted client fixture is client coverage, regardless of whether an unused database/server is running.

Playwright is configured for Chromium. Its managed web server runs:

```text
npm run e2e:init
```

That command initializes the E2E database and starts `dist/backend/server.js`; it does not build the application. Build first.

The E2E suite currently uses `APIRequestContext` heavily for focused HTTP workflows. This is still E2E coverage because requests pass through the real built application, routes, middleware, session store, and database.

Use E2E sparingly for high-value flows. Avoid reproducing every service-level edge case in the slowest layer.

## E2E setup

### 1. Create the E2E database

```sql
CREATE DATABASE surveyor_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'surveyor_e2e'@'127.0.0.1' IDENTIFIED BY 'replace-this-password';
GRANT ALL PRIVILEGES ON `surveyor\_e2e`.* TO 'surveyor_e2e'@'127.0.0.1';
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

Playwright's managed server and the example environment default `AUTO_ARCHIVE_ENABLED` to `false` so historical
fixtures remain stable. In E2E mode the settings loader still prefers an explicitly supplied
`E2E_AUTO_ARCHIVE_ENABLED` value over that plain setting. Use this override only for an intentional
automatic-archival workflow and verify the effective value before running it. Manual archive/restore and
personal-visibility E2E tests run normally with the automatic job disabled.

By default, the initializer recreates the schema from entity metadata and skips historical migrations. Set `E2E_RUN_MIGRATIONS=true` only for an explicit migration exercise whose database and migration expectations have been reviewed.

### 3. Install Chromium and run

```bash
npx playwright install --with-deps chromium
npm run build
npm run e2e
```

Playwright starts and stops its managed built server through `playwright.config.ts`, after configured E2E database
preparation. `reuseExistingServer: false` applies locally and in CI. Stop any existing process on the selected port
before E2E so the runner owns the compiled application and prepared database.

The managed system server receives explicit larger identity-admission limits because its independent actors share
one loopback address and seeded account. The runner configuration owns those fixture budgets; focused admission
checks exercise exhaustion, expiry, shared identifiers and retry feedback using small limits.

Windows defaults to one system worker after native worker exits were observed in parallel runs. Other platforms
retain Playwright's default selection; Linux CI explicitly selects two workers, and CLI overrides remain available.
This bounded local mode takes longer while retaining real concurrent actors within individual tests. It changes no
assertion deadline, retry or validation. A successful serial run does not establish the native exit's cause or
guarantee that it cannot recur.

Useful alternatives:

```bash
npm run e2e:prepare   # reset/recreate/seed only
npm run e2e:init      # prepare, then start the compiled application
npm run test:all      # Vitest, build, isolated client browser and system E2E
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
| Client helper or mounted component | Frontend | actual browser focus/hydration or integrated session/persistence matters |
| Service transaction or relationship | Integration | middleware/route admission is part of the risk |
| Controller using production services | Integration | full request parsing, cookies, redirect, or view rendering matters |
| Genuine middleware/rendering/asset delivery | Integration; database-free when application database persistence is outside its boundary | stored application identities, domain workflow or ORM persistence require the integrated application |
| Authentication, guest, route, or critical creation flow | E2E | keep lower-layer edge cases too |
| Documentation label/path contract | Optional advisory documentation report | Keep application-behavior tests separate from maintained wording and images. |

A change may need several layers, but more layers are not automatically better. Protect each distinct failure mode at the cheapest stable seam.

## Frontend compiler and build scopes

`npm run typecheck:frontend` checks the separate Vue client and SSR configurations. `npm run typecheck:tests` uses
vue-tsc with `tsconfig.test.json` for tests and production/SFC imports reached by that graph. Vitest transpilation
does not type-check assertions or fixtures, and a test-graph pass does not certify every unimported browser source.
Server compilation belongs to `tsconfig.server.json`; Vite compilation alone is not a TypeScript check.

`vitest.config.mts` includes the exact development-runtime and session-admission files under `tests/integration/`
in its `database-free` project and excludes them from its schema-resetting `integration` project. The first combines
Express/Vite/SSR; the second combines actual Express/session middleware, production admission and an in-memory
store to protect response-completion and server-owned input checks. Neither substitutes a database-backed identity
or transaction test. `npm run test:quick` selects that project without copying discovery globs into the package
command. A focused infrastructure run uses the same project with its exact file; `test:integration` still
selects the whole integration directory and therefore includes database-backed suites. Do not describe the quick
selection as unit/client-only or infer a layer from whether its runner starts a database.

Package pre-hooks prepare generated API/localization/database inputs. Direct runners can bypass those hooks;
generate after checkout or authored contract/catalog changes. Generated compile fixtures exercise actual request,
response and problem declaration relationships, including negative cases. Do not add parallel handwritten contracts.

When an isolated SSR assertion measures a fresh rendered tree rather than cold compiler startup, prepare only its
actual lazy route modules in a named `beforeAll` under the existing hook budget. Keep app creation, request data and
rendering inside each unchanged assertion deadline. This follows the existing route-fixture pattern without
pre-rendering output, priming private state or replacing real components. Cold-compilation attribution still needs
evidence; a timeout alone does not establish an application rendering defect.
For an HTTP integration suite with an existing owned listener, prepare its actual built lazy modules alongside that
server infrastructure. The profile suites use [`tests/support/frontendRenderer.ts`](../tests/support/frontendRenderer.ts)
to prepare the installed renderer and only their own declared built graphs, rejecting missing or ambiguous modules.
This evaluates code without a setup request, render, actor or query-cache priming. Real backend HTTP/bootstrap
assertions and hook/assertion deadlines remain unchanged; this does not measure cold module initialization as
application latency. Keep earlier failed runs visible when recording the focused rerun.
Vitest externalizes only the installed `dist/frontend-server/` graph to Node, matching production loading rather
than transforming an already compiled release again. Authored TypeScript/Vue sources retain normal transformation
and isolation; the installed graph intentionally uses Node's module cache rather than source mocks or HMR.

Source HMR, serialized contract/catalog regeneration, coherent production SSR dependencies and release/chunk recovery
cross different boundaries. Exercise the relevant owner when changed; a build or hydration marker alone does not
prove usable controls, request-local identity/locale or release replacement behavior.

## Mounted reads, drafts and commands

Use actual Query/cache/transport consumers where they uniquely detect:

- Missing pending data versus retained background content, independent regions and unknown membership counts.
- Original/local/current values, sparse normalized input and independent settings-section drafts.
- Original/Mine/Current presentation preserving false and numeric zero, with localized boolean wording and empty
  placeholders confined to absent/empty text; test the mounted feature's recovery journey and unchanged write values.
- Field write loss versus readable content, actor/resource retirement and validated denial of protected projections.
- Actual fresh authority after a confirmed write; canceled retained data, idle flags and manual cache aliases are not receipts.
- Saved operations with failed follow-up reads and unknown outcomes without replay or false rollback assumptions.
- Confirmed destination/feedback retention through failed navigation, including retired command editors.
- Receipt-owned transient expiry, repeated renewal, locale reactivity, retired editors and nearest page/dialog hosting.
- Session/bootstrap dispatch admission, visibility/disclosure pause, terminal rejection and Retry-After deadlines.
- Eligible observer selection when shared-key consumers have different visibility or lifecycle.
- Required owning reads with no optional dependent observers, and inactive cached dependencies remaining inactive.
- Closed disclosures pausing recurring polling while retaining initial count reads, admitted snapshots and drafts.
- Equal successful reads restoring a previously rejected binary image without relying on a changed version.
- An already-open editor losing its method grant: visible dispatch controls and handlers agree, with readable drafts retained.
- Aggregate totals/badges retiring with their source authority, while independently admitted siblings remain readable.
- Locale changes canceling translated families only, leaving machine authority reads and drafts intact.
- Explicit value lifetimes across warm/cold routes, actor changes and completion for text, select, checkbox and file inputs.
- Lexical numeric fields through input, change, blur and a sibling render using the shared field option; separately
  retain intentional numeric normalization. Field events alone cannot establish the displayed browser value.
- Finance money/factor/identifier wire strings, unchanged accepted precision and controller normalization, plus
  compatibility/update recovery for older loaded tabs without discarding mounted drafts or replaying commands.
- Activity scalar/array identifier strings and the existing Analyze/Calculate argument adapter's numeric engine
  boundary without mutation of admitted configuration, domain arithmetic or native inputs.

Current focused source selections protect shared frontend owners at their actual layer:

| Boundary | Authored coverage and limit |
|---|---|
| Displayed header and root/child schedule actions | `tests/frontend/frontend-entity-presentation.spec.ts` mounts actual Event/Packing and Settings/child consumers, checking settings admission, image lifetime/removal and shared pause/resume behavior. Existing Event-page and Packing-editor cases retain equal-image-read and pending/draft coverage. HTTP substitution makes these client checks. |
| Denial-producing admission and inactive visits | `tests/frontend/frontend-entry-retirement.spec.ts` uses real Query observers to retain a paused producing denial while removing older token visits and preserving another actor. Event foundation and existing Packing entry cases cover mounted feature adoption and restored admission. |
| Metadata public workflow and read-only notes | Existing Event foundation/Packing management cases exercise the actual metadata adapters and shared editor handle. Event organizer cases update selected participant/summary notes through fresh roster reads, independently of search, and retire missing/empty sources while retaining separate date-draft coverage. |
| Shared fields, Quick Add and recovery | `frontend-shell` cases exercise native composition/caret/control identity and emitted values; actual browser change/blur and sibling-render checks establish lexical-number display. Packing editor and Drivers cases separately protect Quick Add's deliberate numeric coercion/native rerender normalization, unnamed fields and confirmed/uncertain resets. Event foundation preserves raw creation fields and selected multipart bytes; Survey cases retain ballot-specific fresh-read reconciliation and unknown-creation review. These boundaries retain their own client or built-system classification. |
| Built visual/behavioral delivery | `tests/e2e/frontend-entity-header.spec.ts` checks rendered headers at desktop/mobile sizes with images, long titles and parent navigation. `frontend-event-workflows.spec.ts` exercises actual controls, sessions and persistence for attendance, links, notes, permissions, images/lifecycle, deadline/capacity outcomes, uncertain delivery and anonymous grants. Other Event E2E files retain their existing boundaries. |

This is an assertion map, not a claim that a selection ran or passed. Executed inputs, results and limits belong to
the actual run artifacts. Inspect equivalent surfaces and their controls rather than infer full parity from a container
width, one representative input or capture success.

Hold/cancel the real post-command read to prove one write and blocked authority until a new admitted read. Equal
successful data is a valid receipt; object identity alone is not. A read cannot prove an unknown creation failed.
Preserve the submitted input and deliberate review. Commands default to no automatic replay.

Packing's local checklist is separate from server snapshots. Test unavailable/throwing storage, per-row pending writes,
healthy rereads/missing keys, visible warning lifetime and explicit local Retry. Background reads never retry writes;
list/context retirement removes temporary fallback without server persistence or a restoration promise.

Real persistence checks cover method-specific projections, touched-field comparison, authorization under locks,
assignment/capacity interleavings, relationship no-ops and changed associations. Keep finance revisions, signed
settlement evidence and recommendation fingerprints at their domain boundaries. General repository mocks cannot
establish any of those guarantees.

## Browser initialization, focus and recovery

Use isolated built-browser checks for SSR/hydration/module delivery and focus when a full backend workflow is not
needed. Use built-application E2E when actual routes, sessions, rendering and persistence are the boundary. Source
development/HMR with real server/persistence belongs to browser integration. Configuration skips are unrun modes.

Isolate completion-induced scrolling from deliberate test setup. When moving focus to prove that a pending
operation must not reclaim it, use native `focus({preventScroll: true})` for that setup move. An ordinary focus
can start smooth scrolling before the held response is released. Preserve exact completion scroll assertions;
do not turn setup movement into an application failure or widen the comparison to conceal it.

For ordinary migrated forms and links, assert that the built workflow retains a marker on the current document
and emits no unexpected main-frame navigation request. Select scoped suites by explicit file paths when a filter
also appears in the checkout directory; verify the runner's actual selected cases before treating it as that scope.
Observe the actual generated JSON/multipart operation,
visible completion and persisted effect through the integrated backend. The existing frontend navigation test uses
`document.documentElement.dataset.frontendDocument`; extend that technique in the affected existing suites rather
than introducing another runner, scanner or test framework. A matching final URL, API status or screenshot alone
cannot distinguish Router navigation from a document replacement.

Compare each visible card/form/table/action/footer in the declared scene, including values, constraints, painted
hierarchy, usable fit, destination and collected browser errors; retain raw relative geometry for inspection.
The current profile-workflow matrix covers all five
token/entry/preview/deactivation/account-deletion scenes at 1280px/390px; only independently generated token content
is masked. Packing compares creation, persisted table, Quick Add and Packed restoration. Overview distinguishes a
fresh empty region, populated owner cards and a search with no matches at those same sizes. Matched screenshots
still require individual inspection; one field's geometry cannot establish its surrounding workflow's parity.

Drivers extends its existing built suite with General, expanded image controls, Linked event, Access, Administrators
and Actions comparisons at both sizes. Its actual settings journey submits metadata/defaults, adds/zeros/removes an
administrator, uploads/removes an image, changes the event, archives/restores and deletes through the generated
operations without document replacement. Restricted actions, description-only settings and inherited Event archival
are separate scenes. Native form wrappers and Vue direct actions may have different display or dimensions.
Current comparisons protect visible content, field constraints and selected visual identity, with nonzero painted
areas and independent clipping/interaction checks. Complete raw style and geometry remain attached for review;
they are not all exact comparison assertions.
Shared-component reuse alone cannot establish a feature's injected operation or restricted-control behavior.

Basic Activity adds desktop/mobile functional-interface comparisons for dated creation, schedule/progress, participant status,
shared notes, slot/role/text dialogs, warning review and settings. Wait for complete rendered content before
measuring; an empty transition capture proves no participant behavior. Expanded image controls need their own matching
scrolled capture when the modal viewport clips them. Preserve complete measured JSON beside original screenshots.
Real built workflows assert same-document creation/copy, self/organizer assignments, changed-warning rejection and
fresh explicit confirmation, shared-text edits, settings/image/lifecycle/automation, private projections and separate
print documents. The genuine ORM suite retains shared engine/transaction checks. The civil-date owner preserves stored
days and Monday weeks across offsets, DST, leap days, year boundaries and the year-1000 preceding Monday. Pure
calendar tests protect invalid inputs and fresh return values; mounted consumers protect selected-language wording,
unchanged dirty nodes and pending review. A genuine ORM read validates the week schema and unchanged saved dates,
assignments and native inputs. Built calendar journeys exercise actual creation, schedules, recommendations and
Event attendance in configured timezone/locale/viewport scenes. Deadline/link timestamps retain their instant
meaning. The Slots total remains the complete saved collection through All/My/Open, fresh receipts and an empty
plan. Source mappings describe intended coverage; executed results retain their actual scope in run artifacts.

Advanced Activity adds focused requirement/recommendation component cases and a built Rules workflow. Protect
zero and override precedence through the existing pure requirements engine, unsaved coverage, canceled Reload,
dirty drafts across refreshed snapshots and confirmed saves whose following read fails. Observe only an admitted
domain job identity: status polling and automatic-job completion read saved data without maintenance or dispatch;
explicit generation retains its separate completion trigger. Assert terminal and unavailable jobs, uncertain
dispatch without replay, manual/generated provenance, both reciprocal swap legs and the identical previewed/applied
batch. A changed overlap acknowledgement must reject before saving review or assignments. Compare complete Rules,
coverage, recommendation and manual-dialog surfaces at desktop/mobile sizes, retaining meaningful content/control,
painted hierarchy, fit and accessibility assertions beside individually inspected originals. Existing Activity engines and persistence suites
retain the transactional rules; the Vue rewrite does not duplicate those algorithms in browser tests.

Apply [assertion and isolation guidance](#assertions-and-isolation) to actual actor-owned records too. Administrator
tests use a unique profile and assert its exact identifier; a shared account can accumulate other profiles while
parallel workflows run. Locate an Overview fixture through its ordinary search instead of assuming first-page
membership, retaining the real card/navigation assertions.

Identity completion assertions retain the same confirmed notice while switching English/German and back, checking
the complete conditional former-user/guest deletion wording without command replay or receipt renewal. Existing
controller and versioned operation assertions protect the same branch outcomes, established prose and inherited
partial failures. Catalog completeness alone cannot prove that the actual mounted completion adopts its keys.

Cover Event creation/duplication and selected files, profile token issuance/preview/transfer/deactivation and
account/guest deletion, Event-rendered child deletion and ordinary shell/parent/context links. Include warm entry,
Back/Forward, retained validation input, deliberate cancellation, one pending dispatch, uncertain delivery without
replay, confirmed completion through failed follow-up and actor/visit retirement where applicable. Token issuance
is an explicit action, never a query/prefetch/history effect; secrets and private results remain outside URLs,
Query caches and persistent storage. Keep actual partial backend outcomes rather than asserting new atomicity.

Classify and separately exercise legitimate document transitions: initial/direct arrival, true external
provider/token/email capabilities, provider logout handoff and print/downloads. Preserve
modified-click/new-tab href behavior. Do not reject every navigation request or silently intercept all anchors;
the assertion must name the ordinary SPA operation it protects and the allowed boundary it encounters. These
application assertions and semantic contribution review do not create a documentation or infrastructure CI gate.

Verify request-local SSR identity/locale, escaped validated bootstrap and same-tree hydration. Interactive initial
content uses shared skeletons; successful initialization reveals controls. Readable Help retains functional GET
search, links and anchors. JavaScript-only shell selectors/actions/Retry/dismiss are unavailable before initialization.
The localized startup notice must work independently of the missing/blocked entry module.

Exercise initial and cold scoped placeholders for each page family using the actual route metadata. The built
client browser selection verifies the real SSR/CSS silhouette, one accessible loading status, one animation,
responsive layout and absent dead controls; it does not certify backend admission. Include major structural
differences such as Packing/Drivers columns, Packing's initial-items table, Overview collections and login recovery.
System workflows still use the built application and prepared database. Notification checks use real page/dialog
consumers and commands, assert retained viewport/focus through submission and refresh, and verify shared scope,
renewal, dismissal and expiry. Deliberate dialog entry/return and actual anchor navigation retain their own focus
contracts; they do not authorize notice-induced jumps.

Compare the recorded last native screenshots and measurements with explicit current requirements and approvals.
The retired native renderer is historical evidence; current browser tests exercise the canonical Vue application.
Functional interface parity means
equivalent visible information, available actions and user steps, not exact pixels, DOM identifiers or internal
naming. Keep raw screenshots and measurements for review. Assert meaningful content, control values/constraints,
painted hierarchy, readable labels, reachability, keyboard behavior and usable fit. Responsive wrapping and new
Refresh controls are required behavior; assert their presence and actual fresh reads instead of subtracting them
from geometry to claim whole-image equality. Inventory each admitted data region and assert its page-level or own
healthy Refresh GET, including retained drafts and filters; a successful root read alone does not prove subsection
coverage. Separately protect deliberately narrow post-command reads and private outputs from replay.
Deliberately scrolling tables keep a distinct overflow boundary.
Retain exact business inputs, privacy, no-replay and draft-lifetime assertions. A presentation change justifies
changing only the obsolete assertion it supersedes, never indiscriminate tolerance increases or silently dropping
controls and journeys. Required additions are asserted independently when the recorded native reference lacks them.

Hydration confirms that client owners mounted; it does not admit a feature's independent reads. Before keyboard or
layout assertions, wait for the current admitted fields and enabled top-level controls of the actual feature or
dialog. Assert readiness through their observable values/states, then exercise the unchanged focus sequence and
measure the complete surface. Fixed sleeps or measurements of a loading skeleton cannot establish that boundary.
For lazy warm navigation, await the destination URL and its own heading before filling an input ID reused by the
previous page. The previous editor can remain visible while delivery finishes; its matching field is not evidence
that the destination owns the control yet.
For debounced discovery, await the response matching the newly typed query and then its settled result controls.
The selected item can already appear in an idle previous page; checking that item or `aria-busy` before the new
search starts can capture loading content instead of the requested comparison surface.
Wait for the rendered dialog's actual readiness and animation completion before asserting layout and hit targets.
Preserve deliberate interaction-during-transition tests as separate scenarios. A fixed prolonged duration cannot
prove that a transition still runs after network/focus waits; keep the ordinary test deadline and final state assertions.
Include the preserved document titles after initial and warm navigation as well as locale changes. For saved
text, cover empty, single-line and multiline content with literal markup to verify escaping. Capture the surrounding
card and assert placement separately from cropped form/table controls. A full-card image is inspection evidence,
not an assertion of every dimension. Explicitly approved frontend exceptions retain their own expected results;
do not hide them by normalizing away differences from the recorded reference. Survey duplicate checks include every saved description,
weekday and occurrence, plus independent exclusion of answers and the source image.
Survey comparisons additionally inspect complete voting cards and inter-section layout. Integrated Refresh is an
explicit current requirement: assert its usable presentation and read-only operation while preserving ballot drafts.
Earlier comparisons adjusted for its extra row; that historical normalization does not establish current whole-card
acceptance. Empty results retain their
own notice and layout. Wide ballot/result tables exercise
real horizontal overflow, sticky participant headings/cells and the reachable final column at desktop/mobile sizes.
Measure the current delivered page overflow too; a responsive table class alone does not establish its actual
document width or viewport movement. Preserve recorded native measurements separately for historical review.
Owner settings include the complete expanded image and Actions surfaces, keyboard tab selection and Escape focus
return. Archived guest voting and collaborative additions remain available while owner management stays distinct;
archival changes do not imply read-only participation. Temporary same-valued recurrence drafts retain independent
DOM identity; persisted create/copy fixtures retain distinct choices under the existing combination uniqueness
constraint. Removing the final creation row exercises generated rejection and retained-draft recovery before dispatch.
After a command response, wait for its required follow-up read/render to show the saved value and release pending
controls before the next action. A completed HTTP response alone does not establish that the next field/action is enabled.

Exercise actual initial Vue setup, mount and first-readiness failures, including partial handlers: initialization stays
unconfirmed, static navigation/search remains usable and edited-control recovery retains consent. Keep this bounded
initial contract separate from later feature-error handling. Hold/reject route loading, edit genuine static early
input and verify failure/canceled recovery preserves its original control. Automatic reload needs clean state and
working loop protection; deliberate recovery respects pending/unknown work without persisting secrets/files.

When a shared field replaces an existing framework-owned input, characterize the original installed control's
model, DOM spelling, node identity and focus across input, change and unrelated rerenders. A number model does not
promise that its initial spelling survives the next native directive update. Preserve the observed contract rather
than change production behavior to satisfy a newly invented test expectation.

File tests distinguish confirmation from rejection, unknown delivery and background reads. Confirmed upload releases
the feature File and clears the same chooser even when refresh fails; other outcomes retain both. Verify reselection
and focus/input identity instead of replacing nodes merely to make tests pass. A warm form must not display old bytes
when its new draft submits no file.

Committed identity creation requires real ORM atomicity of identity/profile/session and validated prepared output.
Failures before commit leave none of those writes; later mutable context cannot reject a committed receipt. SMTP
failure is delivery uncertainty, not failed creation or permission to replay. Exercise rollback, opposing transitions,
HTTP adoption and receipt privacy at their actual boundaries.

Visual review uses equivalent synthetic records, actors and viewport sizes. Inspect each original image and affected
control; contact sheets and capture success do not establish parity. Test actual keyboard/scroll reachability where
screenshots cannot show lower controls. Label bounded scenes and source scope; do not claim app-wide accessibility
or deployment acceptance from selected checks.

Compare affected surfaces completely: visible wording, control values/states/constraints, labels/help/icons,
typography, readable wrapping and usable action spacing. Include common form actions/footer when the workflow renders
them. Assert meaningful user contracts and recorded browser errors; raw geometry and a JSON attachment remain evidence
for inspection rather than an exact native coordinate contract. Hold actor, persisted data, locale, viewport and loaded fonts equal. Explicitly identify
approved navigation-shell differences instead of hiding real component differences with broad tolerances.
Retain explicit browser-restoration choices such as `autocomplete="off"`; a default can let the browser restore a
shared flag instead of its admitted application owner. Compare that behavior separately from visible wording.
For sticky identity columns, verify actual painted text while the table scrolls past selected or focused answer
labels. A bounding box or computed z-index alone does not prove that another control is not covering the name;
hit-testing the rendered glyph positions protects readability without requiring identical native coordinates.

Event organizer dietary checks observe the current application's ordinary response without replacing it.
Assert that its rendered badges and derived dietary totals preserve that response's complete values and delivered
order. Register the matching response observer before Refresh, then await its actual subsequent read and rendered
values; the earlier navigation/preload response cannot establish the current rendered order. When reviewing recorded
native evidence whose dietary sequence differs, compare corresponding entries/counts/appearance/component layout
by choice. Retain all current response-order assertions, remaining exact text/control assertions and deadlines.
This historical comparison boundary concerns dietary badges/totals only. It does not authorize normalizing other
collections, sorting runtime data or changing shared queries. Raw screenshots retain the actual rendered order.

Before a database-dependent comparison, verify the effective dedicated target, grants, server version and session
SQL mode. Use the supported CI database baseline and its configured defaults for acceptance. Do not change a shared
database's mode, widen setup deadlines, or add frontend validation to force a native SQL outcome. An alternate local
version/mode may explain diagnostics, but does not certify the supported environment. Report separate preparation
and prepared-schema runs separately from a passing ordinary managed setup command.
Packing's raw-capacity rejection fixtures require the strict SQL mode supplied by that disposable CI/test baseline.
This is a test precondition, not a new production SQL-mode requirement or authorization to change global settings.

## Risk and test cost

Choose incremental protection after retained coverage:

```text
Expected harm without this test = P(regression) × impact × P(unique detection)
Cost = setup/execution time + maintenance + failure diagnosis
```

Use observed evidence when available; otherwise describe likelihood/impact and uncertainty without invented
percentages. Transfer unique observable assertions before retiring duplicates. Money, deletion, privacy,
authorization and demonstrated concurrency failures retain their consequential checks. Similar operation names or
cosmetic fixtures do not prove equivalent coverage. Run affected checks first, then broaden for a changed shared
owner, new failure or unresolved boundary. Measure preparation and diagnosis as well as case count.

## Archival coverage

`tests/unit/entity-archival.spec.ts` protects UTC inclusive-date boundaries, direct/inherited state, personal placement,
settings, and scheduling. Mounted entity presentation and Overview cases protect explicit commands, success/failure
handling and independent collection controls through the shared Vue owners. Keep time deterministic and use `TZ=UTC`,

matching CI and the datasource contract.

Persistence and concurrency belong in `tests/integration/entity-archival.spec.ts` against the guarded real MariaDB
schema. Preserve real entity metadata and exercise parent inheritance, durable restore, membership/privacy, target
deletion cleanup, conditional automatic updates, and unchanged business/file references. Mock only true external
side effects; file-preservation fixtures must not run invoice retention while asserting archival behavior.

`tests/e2e/frontend-core.spec.ts` covers Overview archive/restore and personal visibility through the built application.
`tests/e2e/frontend-cutover.spec.ts` separately protects inherited child state, retained saved-proof bytes and export
access after archival. `tests/e2e/frontend-cross-application-lifecycle.spec.ts` protects session expiry, denial and
uncertain-command lifecycle boundaries; it is not the archival placement suite. Schema synchronization in these suites
does not validate migration SQL: separately rehearse `AddEntityArchival1789862400000` against an existing-schema copy
and the supported fresh-schema bootstrap. Follow [Database and Migrations](DATABASE.md) and prove the disposable target
before either rehearsal. Documentation reports remain advisory and are not substitutes for these application checks.

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
| `npm run test:frontend` | No | No | Stubbed globals only | Client helpers and mounted component/state logic. |
| `npm run test:quick` | No | No | Stubbed client globals; real local HTTP listeners for scoped server fixtures | Configured database-free regression selection, including server-component integration. |
| `npm run test:frontend:browser` | No | Yes, through its pre-hook | Chromium | Isolated client behavior with built assets. |
| `npm run test:integration` | Disposable MariaDB | No | No | Persistence and production-service workflows. |
| `npm run test:integration:browser` | Caller-owned disposable schema | Caller supplies source server | Chromium | Source-runtime integration; no runner-owned initialization. |
| `npm test` | Disposable MariaDB | No | Stubbed globals only | All Vitest layers. |
| `npm run test:ci` | Disposable MariaDB | No | Stubbed globals only | Vitest coverage and JUnit output for CI. |
| `npm run e2e:prepare` | Destructive E2E schema reset | Existing `dist/` not used | No | Initialize and seed only. |
| `npm run e2e` | Destructive E2E schema reset through managed server | Requires existing `dist/` | Chromium | Focused built-application flows. |
| `npm run test:all` | Both disposable schemas | Yes | Chromium | Full local sequence. |

## CI contract

`.github/workflows/ci.yml` uses Node.js 24.15.0 and MariaDB 10.11. Database-free, integration and browser stages run on
separate runners with their own MariaDB service and dedicated schemas. Each installs the lockfile with `npm ci` and
writes `tests/.env.test` and `.env.e2e` for those guarded disposable targets.

The two Vitest stages generate inputs, then select their respective project with coverage, JUnit and mergeable
reports. The database-free stage also runs the Vue-aware test compiler; integration files remain serialized.
The browser stage builds the application, installs or restores Chromium and runs the isolated client and integrated
system Playwright suites with separate reports. A client assertion failure does not suppress the independent E2E run.
Runner/workflow files own exact worker limits, timeouts and preparation order.

Reports are uploaded even after failures. A separate collection job replays the Vitest reports and merges coverage
without rerunning application suites, then performs the configured analysis after successful verification. Separate
stages retain the same application boundaries; their independence does not permit parallel resets within one schema.

Documentation checks and tooling regressions are absent from this required sequence. Tests of maintained prose,
images, guide search examples, or documentation completeness live outside application test discovery.

Locally, run the layer relevant to the change while iterating. Before release-sensitive or cross-boundary work, reproduce the full sequence as closely as practical.

## Troubleshooting

### Integration tests refuse the database

Confirm that `TEST_DB_NAME` contains `test`, points to a disposable schema, and that the user can drop/create tables in that schema. Check for a conflicting process-level `TEST_DB_*` value loaded before the file.

### Integration suites interfere with one another

Do not enable file parallelism for the `integration` project. Its suites rebuild one shared disposable schema and
the committed configuration serializes them. Database-free files have independent isolates and may use their
configured bounded workers. Concurrent database-backed runs require genuinely separate disposable targets.

### E2E initialization refuses the database

Confirm that `E2E_DB_NAME` contains `e2e`. Do not weaken the guard or reuse another environment's database.

### Playwright reports an unavailable server

Run `npm run build`, verify `.env.e2e`, confirm MariaDB is reachable, and check that the configured port is free. The managed server waits for `/healthz`.

### A unit/frontend-only command cannot import generated database metadata

Prefer importing the production module actually under test without crossing the database bootstrap boundary.
Normal unit/frontend package scripts prepare generated inputs through their own pre-hooks. If a direct runner
legitimately needs generated metadata/contracts, run `npm run generate` first; generation is not a database test.

### CI passes a layer that fails locally

Compare Node.js, MariaDB, environment files, process-level variables, generated output and Chromium version.
The E2E runner refuses existing-server reuse; check its selected port. Workflow files and the lockfile are the
reproducibility baseline. Record the original failure and measured focused/full reruns rather than widening a timeout
or changing fixtures without establishing the cause.

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
require the individual inspection practice in [In-App Help Visuals](features/help/HELP_VISUALS.md), not an automated delivery gate.
