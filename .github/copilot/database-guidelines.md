# Database Guidelines
<!--
documentation-metadata
audience: GitHub Copilot; database contributors
owner: project maintainers
status: current
last-verified: 2026-09-06
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: D13 single schema/migration rule, target safety, persistence-test boundary, and canonical procedure delegation
source-anchors: docs/DATABASE.md; docs/DEVELOPMENT.md; docs/TESTING_GUIDE.md; migrationDataSource.ts; scripts/runMigration.ts; src/migrations/; src/modules/database/; tests/integration/
next-review: none
-->

**A persistent schema change requires the matching entity change and a reviewed migration for existing installations.**

Follow [Database and Migrations](../../docs/DATABASE.md) and the database section of the
[Development Guide](../../docs/DEVELOPMENT.md). Use the settings-aware package wrappers, generate the TypeORM index when
required, and prove the effective database target before a schema-changing command.

Never run schema synchronization, schema drop, migration experiments, or test resets against production, staging,
shared development data, or any database that is not explicitly disposable. Test and E2E credentials must be confined
to their dedicated schemas.

When persistence is under test, use the real TypeORM metadata and guarded MariaDB integration database rather than
datasource, repository, or core-service mocks. The [Testing Guide](../../docs/TESTING_GUIDE.md) defines the permitted
external-boundary replacements and destructive-test safeguards.
