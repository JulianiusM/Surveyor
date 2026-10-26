# Database Guidelines
<!--
documentation-metadata
audience: GitHub Copilot; database contributors
owner: project maintainers
status: current
last-verified: 2026-10-12
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: mandatory central policy routing; former rule summaries consolidated into authoritative policies
source-anchors: docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; docs/DATABASE.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; migrationDataSource.ts; scripts/runMigration.ts; src/backend/migrations/; src/backend/modules/database/; tests/integration/
next-review: explicit-maintainer-policy-amendment
-->

Read the [Development Policy](../../docs/policies/DEVELOPMENT_POLICY.md#database-and-migration-safety) before database work, together with the [Documentation Policy](../../docs/policies/DOCUMENTATION_POLICY.md) and required [agent entry point](../../AGENTS.md).

[Database and Migrations](../../docs/DATABASE.md) owns the settings-aware procedures; the [Testing Guide](../../docs/TESTING_GUIDE.md) owns disposable-suite setup. This navigation aid does not maintain another schema, migration or persistence-test policy.
