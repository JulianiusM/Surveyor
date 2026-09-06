# Database and Migrations

<!--
documentation-metadata
audience: database administrators; operators; site reliability engineers; maintainers
owner: application operators
status: current
last-verified: 2026-09-05
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: D04 accepted from source review and deployment-practice confirmation for runtime datasource, migration wrapper, schema bootstrap, sessions, backup targeting, and migration commands; controlled execution tracked separately in D04V
source-anchors: src/modules/database/dataSource.ts; migrationDataSource.ts; scripts/runMigration.ts; scripts/genTypeormIdx.ts; src/modules/database/entities/session/Session.ts; src/migrations; package.json; .github/workflows/ci.yml
next-review: D04V
-->

Surveyor uses TypeORM with MariaDB for application data and server-side sessions. The application opens the database
before it starts listening for HTTP requests, but it does **not** apply schema migrations automatically.

This guide defines the supported database workflow. For filesystem backups, service control, and recovery rehearsal,
continue with the [operations runbook](OPERATIONS.md). For release sequencing, use [Upgrading Surveyor](UPGRADING.md).

## Supported baseline

The repository's CI exercises the application with:

- Node.js 24.15.0.
- MariaDB 10.11.
- The `mariadb` TypeORM driver.
- Process timezone `UTC`.

Use MariaDB 10.11 as the production compatibility baseline unless a release explicitly certifies another version. The
runtime datasource sets the database connection timezone to UTC and returns SQL `DATE` columns as date strings rather
than converting them to JavaScript timestamps.

## One database target, two loading stages

Runtime and migration code reach the same database through different stages:

1. The running application reads built-in defaults, the selected CSV file, and environment overrides through
   `src/modules/settings.ts`, then creates the runtime datasource.
2. TypeORM's datasource file reads `DB_TYPE`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` directly from
   the process environment.
3. The repository's `npm run typeorm` wrapper first loads the normal Surveyor settings, maps the resulting database
   values into those environment variables, and only then starts the TypeORM CLI.

**Operational rule:** run migrations through the repository's `npm run typeorm…` commands and set the same
`SETTINGS_FILE` used by the service. Do not call the TypeORM CLI or `migrationDataSource.ts` directly for production
operation. The direct datasource has standalone fallback values and bypasses the CSV loading contract.

The migration tools are TypeScript development tools. The production release archive is a runtime bundle; run schema
operations from a source checkout of the **same release tag**, with all dependencies installed.

## Prepare a migration workspace

Keep a restricted source checkout beside, but separate from, the runtime release directories. For each release:

```bash
git fetch --tags
git worktree add /opt/surveyor/migrations/vX.Y.Z vX.Y.Z
cd /opt/surveyor/migrations/vX.Y.Z
npm ci
npm run generate
```

`npm run generate` rebuilds `src/modules/database/__index__.ts`, the entity/migration/subscriber index consumed by the
migration datasource. Run it before every schema command in a fresh checkout.

Use the service's protected settings file for every command:

```bash
export SETTINGS_FILE=/etc/surveyor/settings.csv
export NODE_ENV=production
export TZ=UTC
```

Do not store a production password in shell history. The wrapper obtains it from the selected settings source.

## Create the database and account

Create a dedicated database and account before running Surveyor. The exact account-management syntax is the database
administrator's responsibility; the following MariaDB example is intentionally limited to one schema:

```sql
CREATE DATABASE surveyor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'surveyor'@'application-host' IDENTIFIED BY 'replace-this-password';
GRANT ALL PRIVILEGES ON surveyor.* TO 'surveyor'@'application-host';
FLUSH PRIVILEGES;
```

The account used for schema setup and upgrades must be able to create and alter tables, indexes, constraints, and
triggers, and to record TypeORM migrations. The running application needs normal read/write access to application and
session tables. The simplest supported arrangement uses the same schema-owning account in the protected settings file.
A stricter privilege split is possible, but it must preserve the same target identity and be rehearsed by the operator.

Restrict MariaDB to the application network, require transport security when the connection crosses an untrusted
network, and include the database in normal monitoring and backup policy.

## Prove the migration target

Before any command that can change a schema, verify all six `DB_*` values in the selected settings source. Do not print
the password. Record at least the following in the change log:

```text
DB_TYPE=mariadb
DB_HOST=<expected host>
DB_PORT=<expected port>
DB_NAME=<expected production database>
DB_USER=<expected account>
SETTINGS_FILE=/etc/surveyor/settings.csv
```

After confirming the redacted target values, show the migrations without applying them:

```bash
npm run typeorm -- migration:show migrationDataSource.ts
```

Stop if the command cannot connect or reports a migration set that does not belong to the release being deployed.
The command proves connectivity and migration state; the redacted settings review above is what proves the intended host
and database name.

## Initialize a new empty database

Use this procedure only for a database that has never contained Surveyor data.

1. Prepare the matching migration workspace and export `SETTINGS_FILE`, `NODE_ENV`, and `TZ` as shown above.
2. Verify that the target database is empty and that the application service is stopped.
3. Generate the TypeORM index:

   ```bash
   npm run generate
   ```

4. Create the current entity schema once:

   ```bash
   npm run typeorm:sync
   ```

5. Apply the repository migrations so migration records, triggers, and conditional adjustments are present:

   ```bash
   npm run typeorm:migrate
   ```

6. Confirm that no migration remains pending:

   ```bash
   npm run typeorm -- migration:show migrationDataSource.ts
   ```

7. Start Surveyor and complete the health, authentication, upload, and email checks in the
   [operations runbook](OPERATIONS.md#post-start-validation).

`schema:sync` is an initial-bootstrap tool, not an upgrade tool. Never run it against an existing production database.

## Upgrade an existing database

For an existing production database:

1. Stage the matching source migration workspace and release bundle.
2. Prove the migration target.
3. Stop the application and take one consistent database-and-files backup set.
4. Inspect pending migrations:

   ```bash
   npm run typeorm -- migration:show migrationDataSource.ts
   ```

5. Apply migrations exactly once:

   ```bash
   npm run typeorm:migrate
   ```

6. Inspect migration status again and retain the command output with the change record.
7. Start only the matching new application release.

The complete maintenance-window and rollback sequence is in [Upgrading Surveyor](UPGRADING.md).

## Command safety

| Command | Appropriate use | Production rule |
|---|---|---|
| `npm run generate` | Rebuild the generated TypeORM index in a source checkout. | Safe and required before schema commands. |
| `npm run typeorm -- migration:show migrationDataSource.ts` | List applied and pending migrations. | Run before and after every upgrade. |
| `npm run typeorm:migrate` | Apply pending migrations. | Supported existing-database upgrade command; back up first. |
| `npm run typeorm:sync` | Create the current schema from entities. | Empty-database bootstrap only. Never use as an upgrade. |
| `npm run typeorm:drop` | Drop every table known to the datasource. | Destructive; never use on production. |
| `npm run typeorm:reset-db` | Generate, drop, synchronize, and migrate a disposable database. | Test/development only; never use on production. |

Do not use migration reversion as the primary production rollback strategy. A release can contain data transformations
or application behavior that is not safely reversible one migration at a time. The supported rollback is to restore the
pre-upgrade database and persistent-file backup as one set and restart the matching previous release.

## Sessions are database data

Surveyor stores sessions in MariaDB through `connect-typeorm`. Session cookies and stored sessions have a one-day
lifetime. This has several operational consequences:

- Database loss signs everyone out and can interrupt active forms.
- A database backup contains session rows as well as business data.
- Restoring session rows while keeping the same `SESSION_SECRET` can make restored sessions valid again until they
  expire; rotate the secret when that is not acceptable.
- The session table must be included in schema migration, monitoring, and storage-capacity planning.

## Database backup

For a consistent application backup, stop the application so a proof upload and its database record cannot change while
the two parts are copied. The [operations runbook](OPERATIONS.md#backup-procedure) gives the complete paired procedure.
A representative database dump is:

```bash
mariadb-dump \
  --defaults-extra-file=/etc/surveyor/db-client.cnf \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  --hex-blob \
  --default-character-set=utf8mb4 \
  surveyor > surveyor.sql
```

Keep credentials in the referenced client file with mode `0600`, not in process arguments. Record the release version,
dump checksum, database server version, and persistent-file archive checksum in the same backup manifest.

## Restore validation

Restore backups regularly into an isolated database and storage root. A successful SQL import alone is insufficient.
The rehearsal must verify:

1. The database import completes without warnings that indicate omitted schema objects.
2. The matching Surveyor release starts and `/healthz` returns `ok`.
3. A full account can sign in using the enabled authentication method.
4. Existing events, profiles, and permissions can be opened.
5. At least one stored header image and one authorized invoice proof can be read.
6. A new disposable upload creates both a database reference and a file in the restored storage root.
7. SMTP is redirected to a controlled sink or otherwise prevented from sending real messages during the rehearsal.
8. The restored instance is never exposed under the production OIDC callback or public hostname.

Invoice retention runs before the HTTP listener starts. A restored database containing invoices older than the configured
retention period is therefore cleaned according to the active policy during startup. Choose the rehearsal configuration
and backup age deliberately, and verify that the observed removals match the approved retention policy.

## Database troubleshooting

### Startup exits before listening

The server initializes the settings store, database datasource, and invoice-retention cleanup before opening its HTTP
port. Check the service log for connection, authentication, schema, or retention errors. Confirm the selected settings
file and database target before retrying.

### Migrations appear to target the wrong database

Stop immediately. Confirm that the command was run through `npm run typeorm…`, from the matching source checkout, with
`SETTINGS_FILE` exported. Do not rely on direct datasource fallback values.

### A migration fails

Leave the application stopped. Preserve the exact output and database logs. Do not run `schema:sync`, `schema:drop`, or
an ad-hoc manual alteration. Determine whether the migration transaction rolled back; then either correct the controlled
migration execution or restore the complete pre-upgrade backup set.

### The service is healthy but database actions fail

`/healthz` is a basic HTTP endpoint, not a continuous database query. Review application and MariaDB logs, connection
limits, storage space, locks, and network reachability. Treat repeated database errors as an incident even if the health
endpoint still returns `ok`.
