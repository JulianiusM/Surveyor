# Building and Running
<!--
documentation-metadata
audience: GitHub Copilot; developers
owner: project maintainers
status: current
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: mandatory policy routing and command authority without duplicated script, version, branch or deployment inventories
source-anchors: AGENTS.md; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; README.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; docs/DATABASE.md; docs/OPERATIONS.md; docs/UPGRADING.md; package.json; .github/workflows/ci.yml; .github/workflows/release.yml
next-review: explicit-maintainer-policy-amendment
-->

Read BOTH [Development Policy](../../docs/policies/DEVELOPMENT_POLICY.md) and
[Documentation Policy](../../docs/policies/DOCUMENTATION_POLICY.md) through the required [agent entry point](../../AGENTS.md).
Use `package.json` and the following canonical guides for current procedures; this file owns no separate rules.

| Goal | Authoritative procedure |
|---|---|
| Clean-clone setup and local start | [Project README](../../README.md) |
| Development builds, generated files, and troubleshooting | [Development Guide](../../docs/DEVELOPMENT.md) |
| Test prerequisites and commands | [Testing Guide](../../docs/TESTING_GUIDE.md) |
| Database initialization and migrations | [Database and Migrations](../../docs/DATABASE.md) |
| Production installation and service operation | [Production Operations](../../docs/OPERATIONS.md) |
| Release activation, upgrade, and rollback | [Upgrading and Rolling Back](../../docs/UPGRADING.md) |

The policies own test selection, database safety, command evidence and approval; executable workflows own current CI
and release behavior. This navigation aid does not duplicate their inventories.
