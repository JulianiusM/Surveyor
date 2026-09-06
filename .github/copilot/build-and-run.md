# Building and Running
<!--
documentation-metadata
audience: GitHub Copilot; developers
owner: project maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: D13 command-authority and task-routing guidance without duplicated script, version, branch, or deployment inventories
source-anchors: README.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; docs/DATABASE.md; docs/OPERATIONS.md; docs/UPGRADING.md; package.json; .github/workflows/ci.yml; .github/workflows/release.yml
next-review: none
-->

Use `package.json` as the current command inventory. Do not infer that a script builds assets, creates databases,
loads credentials, or prepares another test layer unless its implementation or canonical documentation says so.

| Goal | Authoritative procedure |
|---|---|
| Clean-clone setup and local start | [Project README](../../README.md) |
| Development builds, generated files, and troubleshooting | [Development Guide](../../docs/DEVELOPMENT.md) |
| Test prerequisites and commands | [Testing Guide](../../docs/TESTING_GUIDE.md) |
| Database initialization and migrations | [Database and Migrations](../../docs/DATABASE.md) |
| Production installation and service operation | [Production Operations](../../docs/OPERATIONS.md) |
| Release activation, upgrade, and rollback | [Upgrading and Rolling Back](../../docs/UPGRADING.md) |

Important boundaries:

- `npm test` includes the MariaDB-backed integration layer; it is not the database-free shortcut.
- Playwright runs against the built application, so follow the build and E2E preparation sequence in the testing guide.
- CI and release branch, version, service, and artifact details belong in their workflow files and canonical documents,
  not in this summary.
