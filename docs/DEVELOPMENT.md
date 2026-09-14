# Development Guide
<!--
documentation-metadata
audience: developers; maintainers; AI agents
owner: developer-experience maintainers
status: current
last-verified: 2026-09-14
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: named recipient mailer contract, transient alert lifecycle, snapshot relation loading, post-commit invoice review notifications, saved share ledger and PDF export; consistent per-participant rounding, reconciliation totals, and long takeover-list layout; invoice factors, signed adjustments, revision-checked previews, payment carry-forward, rollback snapshots, configurable settlement notifications, and upload feedback; non-blocking documentation policy and optional report/test routing; D12 clean-clone setup, current scripts, settings and schema bootstrap, generated files, observed repository patterns, route registration, test selection, CI branches, and troubleshooting; D14 focused in-app help validation workflow
source-anchors: src/modules/email.ts; src/public/js/shared/alerts.ts; src/public/js/notifications.ts; src/routes/event.ts; src/modules/lib/pdf.ts; tests/integration/invoice-admin-feedback.spec.ts; src/migrations/1789516800000-AddInvoiceShareRounding.ts; src/modules/lib/invoiceSettlementEmail.ts; src/migrations/1789430400000-AddInvoiceSettlementSnapshots.ts; src/modules/lib/invoiceDistribution.ts; src/public/js/modules/invoice-submission.ts; src/controller/eventPoolController.ts; src/modules/database/services/EventInvoiceService.ts; package.json; package-lock.json; README.md; src/server.ts; src/app.ts; src/routes/; src/controller/; src/middleware/; src/modules/settings.ts; src/modules/database/; scripts/genTypeormIdx.ts; scripts/runMigration.ts; migrationDataSource.ts; esbuild.client.js; tsconfig.json; tsconfig.server.json; vitest.config.mts; playwright.config.ts; tests/; .github/workflows/ci.yml; .github/workflows/release.yml; scripts/check-help-documentation.mjs; tests/unit/help-documentation.spec.ts; tests/e2e/help-experience.spec.ts
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

`notifications.ts` is loaded unconditionally by the shared layout. Its `initAlertDismissal` observer covers server
flashes and inserted or renewed `.alert` / `role="alert"` messages, dismissing each after ten seconds. Use
`showInlineAlert` for text-only transient feedback. Reusable containers can use `scheduleAlertDismissal` with a clearing
callback; cancel their timer when changing to ongoing progress. Persistent conditions use `.status-notice` and
`role="status"`, without alert semantics. Keep required warnings and in-flight financial status visible. Observer cleanup
cancels timers on removal or page exit; restored pages restart observation.

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

### Database changes

A schema change normally requires:

1. Update or add the entity under `src/modules/database/entities/`.
2. Add a migration under `src/migrations/` for existing installations.
3. Run `npm run generate`.
4. Exercise the migration against an appropriate disposable database.
5. Add integration coverage using the production `DataSource` metadata.
6. Update configuration, operator, architecture, or user documentation where the data contract changes.

Never rely on production `synchronize`; it is disabled.

### Invoice pool calculation and saved changes

`eventPoolController.ts` validates organizer input and coordinates settlement through
`EventInvoiceService.ts`. Each `EventPoolAssignment` stores its own `factor` (default `1`, range `0`–`1000`,
up to four decimal places). Assignment membership and exemption are separate from the factor.
New assignments start at `1`; updating existing assignments preserves factors omitted by a caller.

Use this calculation order:

1. Sum effective amounts of Accepted and Closed invoices. Exclude Awaiting-review and Rejected invoices.
2. Subtract the signed sum of adjustments whose `subtractFromPool` is true to obtain the distributable amount.
3. Multiply each non-exempt participant's equal/day/night weight by their factor, then normalize by the sum of
   effective weights. Round each resulting base to cents in the same direction: `roundUpShares=true` (default) uses
   mathematical ceiling; false uses floor. Equal effective weights produce identical bases. Use exact integer ratios
   for the cent boundary; do not distribute leftover cents by participant ID.
4. Add all signed participant adjustments exactly once. Negative amounts are rebates. Factors do not scale adjustments.
5. Deduct effective personal invoice amounts when enabled. Factors do not scale invoice credits.
6. Combine each beneficiary's calculated components into the covering payer without applying the payer's factor again.

`invoiceAmount` is accepted invoice cost, `payableAmount` is the distributable remainder,
`additionalAmount` contains signed non-redistributed adjustments, and `totalAmount` is invoice cost plus those
additional adjustments. Do not clamp a negative distributable remainder. The preview reports the signed rounding
difference between summed rounded bases and the distributable amount; this small surplus or shortfall is intentional.
The reconciliation is `sum(base) + sum(adjustments) = totalAmount + roundingDifference`, then subtract invoice credits
and prior signed settlements to obtain the net remaining balance. Positive outstanding shares minus refunds equals
that net balance. Invoice reimbursement must not be mistaken for a missing share of the pool's gross costs.
A nonzero distributable amount with no positive effective weight must fail before replacing any shares.

Closed pools accept saved settings, assignments, factors, adjustments, and organizer takeover changes.
Calculation inputs invalidate the closed pool through `needsRecalculation` and advance `calculationRevision`.
Attendance and membership changes and accepted invoice changes must also invalidate affected pools.
Payment-state changes update settlement totals and advance the revision to invalidate an outstanding preview, but do not mark the calculation inputs stale. They remain permitted while `needsRecalculation` is true.
Automatic invoice retention is a deliberate exception: deleting expired source records preserves historical settlement
shares and does not itself require recalculation. It still advances the revision to reject a concurrent calculation
that read the deleted records. A later explicit recalculation uses only the records still retained.

`previewPool` prepares the same gross shares used by closing/recalculation and projects prior settlements without writes
or notifications. Its revision must still match when a preview is applied. Recalculation uses saved inputs, preserves
the CLOSED state, and replaces shares in one transaction. A failure keeps the previous shares and payments.

Pool hydration uses `relationLoadStrategy: "query"` inside a `REPEATABLE READ` transaction so multiple child collections
do not multiply into one large join and the pool revision, settings, and saved shares come from one snapshot. Mutations
retain their transaction locks and revision comparisons; optimizing reads must not weaken that boundary.

`projectInvoiceShares` carries money by the actual payer registration. For each previous share, cumulative settlement is
`paymentCreditAmount + (isPaid ? shareAmount : 0)`. The new `shareAmount` is gross liability minus that signed credit.
Positive credits represent money received; negative credits represent payouts made. Repeated calculations preserve the
credit without adding it twice. A previously settled payer who disappears from the new payer set retains a credit-only
share while their event registration exists. Never move that payment to a new covering payer implicitly. Zero remaining
balances are settled automatically. The Paid switch applies to the current residual balance, not to past carried credit.

A successful calculation saves `calculationSnapshot`: pool-local settings, assignments/factors, adjustments, takeovers,
and a fingerprint of external calculation inputs. `rollbackPoolChanges` restores those local inputs transactionally
without touching shares/payment records or sending emails. Event registrations, attendance dates, and invoice reviews
are not reverted. A fingerprint mismatch or missing registration leaves the pool stale after local rollback. Legacy
pools without a snapshot cannot roll back until a successful calculation establishes one.

`sendCalculationEmails` is the pool's stored default; close/recalculate accepts a `sendEmails` override. Notification-only
settings changes do not require recalculation. A separate closed-pool notification endpoint sends the saved settlement
without recalculation. `buildInvoiceSettlementEmail` reads `isPaid`, signed payment credit, and the residual amount so
settled shares never appear outstanding. Notification delivery is queued after persistence, outside the transaction.
Invoice acceptance, rejection, and closure also confirm persistence before queuing SMTP delivery. Catch and log delivery
failures independently of the financial response. If a review loses a concurrent state transition, return 409 and do not
send a notification implying that the losing review succeeded.

The participant upload binder in `src/public/js/modules/invoice-submission.ts` owns progress, busy state, and recovery.
Successful persistence is acknowledged independently of SMTP delivery. An uncertain network outcome must send users
to invoice history before retrying; never automatically resend a proof upload. Keep validation failures distinguishable
from failures where the server may have committed the invoice.

`runInvoiceAdminAction` gives pool mutations immediate busy feedback, blocks repeat actions, and adds a status update
after five seconds. Update ledger amounts and Paid state only from a successful server confirmation; use canonical
saved payment data when restoring controls after navigation or a failed request. Transient outcomes expire after ten
seconds, while the pending state remains visible.

The share ledger searches, filters, sorts, and pages the saved rows in the browser. The portrait A4 PDF export at
`GET /event/:id/export/invoice-pools/:poolId/shares` requires `MANAGE_ASSIGNMENTS` and verifies that the pool belongs to
the event. It exports the complete persisted share set, independent of browser filters, with current payment status,
remaining amounts, and a stale-calculation notice when needed. Export must never recalculate or record payments.

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
