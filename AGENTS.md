# AI Agent Guide for Surveyor
<!--
documentation-metadata
audience: AI coding agents; maintainers
owner: project maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: non-blocking documentation policy and optional report/test routing; D13 repository-wide agent contract, source precedence, change boundaries, test selection, database safety, documentation rules, and canonical-reference routing; D14 implemented fixed-source in-app help validation and maintained visual-asset rules
source-anchors: docs/DOCUMENTATION_POLICY.md; README.md; docs/ARCHITECTURE.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; docs/CONFIGURATION.md; docs/DATABASE.md; docs/OPERATIONS.md; docs/UPGRADING.md; docs/PERMISSIONS_REFERENCE.md; docs/DOCUMENTATION_MIGRATION_STATUS.md; package.json; repository-tree; scripts/check-help-documentation.mjs; docs/HELP_VISUALS.md
next-review: AI-instruction-or-help-trust-boundary-change
-->

This is the repository-wide entry point for coding agents. It intentionally contains only durable rules. Current
commands, versions, paths, architecture, and operating procedures belong in the canonical documents linked below and
in executable repository configuration, not in duplicated AI summaries.

## Authority and evidence

For repository facts, follow the order defined in the [documentation policy](docs/DOCUMENTATION_POLICY.md):

1. Feature-specific executable behavior and tests, including routes, controllers, services, entities, views, browser
   code, package scripts, and workflows.
2. Explicit maintainer or product decisions.
3. References generated directly from implementation sources.
4. Canonical maintained user, maintainer, and operator documentation.
5. AI instruction files, including this one.

The user-requested scope still governs the task. Do not use an AI summary to override current code, tests, an explicit
decision, or a canonical document. When sources disagree, inspect the affected implementation and record the conflict
rather than silently choosing the most convenient statement.

Deliberate feature differences are part of the product contract. A transient implementation defect is not. During
this documentation migration, record such defects once in
[`docs/documentation-remediation.yml`](docs/documentation-remediation.yml), keep the details in migration-control
material, and write product documentation for the coherent working contract. Do not spread temporary warnings or
workarounds through user, operator, maintainer, or AI documentation.

## Start every task by narrowing the scope

1. Read the request and the relevant canonical document from the routing table below.
2. Inspect the current implementation and tests for the exact feature or boundary being changed.
3. Check the working tree and preserve unrelated user changes.
4. Identify affected boundaries: database, authorization, files, UI labels, tests, user help, maintainer guidance,
   operator procedures, and AI summaries.
5. Make the smallest coherent change. Do not refactor unrelated code or invent a new architecture while solving a
   localized task.

A documentation-only task may inspect source and tests but must not alter runtime behavior. The only exception is a
separately authorized, explicitly targeted change to the in-app help integration itself.

## Canonical routing

| Task | Canonical starting point |
|---|---|
| Understand or start the repository | [Project README](README.md) |
| Understand runtime and module boundaries | [Architecture](docs/ARCHITECTURE.md) |
| Follow development patterns or add a feature | [Development Guide](docs/DEVELOPMENT.md) |
| Select, configure, or run tests | [Testing Guide](docs/TESTING_GUIDE.md) |
| Change settings or authentication configuration | [Configuration Reference](docs/CONFIGURATION.md) |
| Change entities, migrations, or database operations | [Database and Migrations](docs/DATABASE.md) |
| Change permissions or administration behavior | [Permission System Reference](docs/PERMISSIONS_REFERENCE.md) |
| Change production deployment, storage, backup, or recovery | [Production Operations](docs/OPERATIONS.md) and [Upgrading and Rolling Back](docs/UPGRADING.md) |
| Change end-user behavior or visible labels | [In-app user guides](docs/user-guide/) plus the relevant Pug and browser code |
| Change documentation structure or trust assumptions | [Documentation Policy](docs/DOCUMENTATION_POLICY.md) |
| Continue the documentation migration | [Migration Status](docs/DOCUMENTATION_MIGRATION_STATUS.md) and [remediation backlog](docs/documentation-remediation.yml) |

Use `package.json`, runner configuration, workflows, and the repository tree as the authority for current script and
path inventories. Do not copy dependency versions, test counts, branch lists, or command matrices into AI files.

## Implementation rules

- Follow the neighboring implementation before introducing a new pattern. Surveyor uses practical route, controller,
  functional database-service, entity, middleware, Pug, and browser-module boundaries described in the architecture
  guide.
- Preserve strict TypeScript behavior and existing local style. Choose an interface or type alias according to the
  existing contract; do not apply blanket style slogans that conflict with nearby code.
- Keep visible labels, form field names, routes, controller parsing, and user documentation aligned.
- Enforce authentication, authorization, validation, and ownership on the server. UI visibility is not an authorization
  boundary.
- Do not hand-edit or commit generated or ignored outputs. Regenerate them through the repository scripts when a
  verification step requires them.
- Never commit credentials, local environment files, uploaded data, reports, or other ignored runtime state.

## One test-selection rule

**Use the cheapest stable test layer that protects the observable behavior; add another layer only when the risk crosses
that layer's boundary.** Do not require unit, integration, frontend, and E2E coverage for every change.

| Layer | Use it when the behavior requires this boundary |
|---|---|
| `tests/unit/` | Isolated production logic with no database, HTTP application, external service, or real browser. |
| `tests/frontend/` | Browser helpers or DOM behavior that can run with explicit, restored globals under Vitest. |
| `tests/integration/` | TypeORM persistence, entity relationships, transactions, or selected controller orchestration against the guarded disposable MariaDB schema. |
| `tests/e2e/` | A critical built-application workflow whose route, middleware, session, rendering, and database integration matter together. |

`npm run test:quick` is the database-free unit-plus-frontend check. `npm test` includes the database-backed integration
suite. Read the testing guide before running integration or E2E commands because both suites rebuild their selected
schemas.

Test production behavior rather than test-only helpers or private implementation details. When persistence is the
behavior under test, use the real TypeORM metadata and disposable integration database instead of repository or core
service mocks. A narrow replacement at a true external side-effect boundary is acceptable when it keeps the production
workflow intact.

## One database and migration rule

**A persistent schema change requires the matching entity change and a reviewed migration for existing installations.**
Use Surveyor's settings-aware package wrappers and the procedures in the database guide. Verify the effective database
target before every schema-changing command.

Never use schema synchronization, schema drop, or test reset procedures against production, staging, shared
development data, or any database that is not explicitly disposable. Database-backed tests must use dedicated schemas
and credentials with no privileges beyond those schemas.

## Documentation rules

- Identify affected end-user, maintainer, operator, and AI documentation. Update it when appropriate or record a
  follow-up; documentation work must never block application review, CI, merge, release, or deployment.
- In-app help is task-first: use exact visible labels, give novices a successful shortest path, then include recovery,
  privacy, role, and advanced details without forcing them into the first-use procedure.
- Verify labels and available actions against rendered Pug output and browser code rather than copying old prose.
- The files under `docs/user-guide/` are trusted, release-shipped application content. Use Markdown, keep the required
  metadata comment, and do not introduce active raw HTML, executable attributes, unsafe URI schemes, or unreviewed
  imported or generated content.
- Preserve intentional feature exceptions. Do not infer that a feature implements a capability merely because peer
  features share middleware, entities, or UI components.
- Every maintained Markdown file requires the metadata defined by the documentation policy.

Documentation reports are optional and advisory, including strict mode. Never add them as required CI checks,
application-test assertions against maintained prose, lifecycle hooks, or release prerequisites. Use the reporting
commands in the documentation policy to retain findings; an advisory exit zero does not mean that every check passed.
Help security tests must use synthetic fixtures and remain application tests.

## Verification and reporting

Run the smallest focused checks first, followed by the broader checks justified by the affected boundaries. Use exact
scripts from `package.json`; do not infer that a command prepares databases, builds assets, or supplies credentials
unless its implementation or canonical documentation says so.

Report what was changed, what was verified, and what could not be executed because a prerequisite was unavailable.
Never describe an unrun build, migration, restore, or test suite as passed.
