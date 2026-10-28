# Database and Migrations

<!--
documentation-metadata
audience: database administrators; operators; site reliability engineers; maintainers
owner: application operators
status: current
last-verified: 2026-10-28
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: approved item-owner/Profile preservation preflights and rollback refusals reconciled against current source; Activity pairing, invoice-proof recovery and targeting guidance retained; no full-bootstrap or deployment certification
source-anchors: src/backend/migrations/1793232000000-AddActivityRecommendationPairing.ts; src/backend/modules/database/entities/activity/ActivityAssignmentRecommendation.ts; src/backend/modules/activity/recommendations.ts; src/backend/migrations/1789862400000-AddEntityArchival.ts; src/backend/modules/database/entities/archive/EntityVisibilityPreference.ts; src/backend/modules/database/services/EntityLifecycleService.ts; src/backend/modules/database/dataSource.ts; migrationDataSource.ts; scripts/runMigration.ts; scripts/genTypeormIdx.ts; scripts/generate-api.mjs; scripts/generate-locales.mjs; src/backend/controller/packingController.ts; src/backend/modules/database/services/PackingService.ts; src/backend/modules/api/contracts.ts; src/backend/modules/database/entities/session/Session.ts; src/backend/migrations; package.json; .github/workflows/ci.yml; src/backend/migrations/1785163809347-AddItemOwners.ts; src/backend/migrations/1785610467095-AddProfiles.ts; src/backend/modules/database/utils/migration-helper.ts
next-review: database-schema-or-targeting-change
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
   `src/backend/modules/settings.ts`, then creates the runtime datasource.
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

`npm run generate` rebuilds `src/backend/modules/database/__index__.ts`, the entity/migration/subscriber index consumed by the
migration datasource, followed by the generated API contracts, validators and language catalogs. Generation does not
connect to MariaDB or change its schema. `npm run generate:db-index` prepares only the TypeORM index. Run generation
before every schema command in a fresh checkout.

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

## Pending owner migrations

Run `1785163809347-AddItemOwners.ts` and `1785610467095-AddProfiles.ts` only through the normal settings-aware migration
workflow. Migration history determines whether they are pending; these repairs do not replay migrations already recorded
as applied. They do not authorize removing migration records or changing an installed release archive.

The item-owner migration checks all four User/Guest references on Packing items and Activity slots before its first
schema write. Its shared helper matches each referenced identifier's physical type, length, numeric signedness,
character set and collation without copying primary-key, uniqueness, generation or default attributes into the new
nullable reference. Compatible populated values remain intact. An incompatible existing column can be aligned only
when every value is NULL. Orphan values, conflicting constraints and unsupported storage, engines or dependencies stop
the migration before changes.

The Profile migration checks ownership on Drivers lists, Packing lists, Events, Activity plans and Surveys, together
with its declared relations and temporary columns, before changing schema or rows. Proven native UUID, text and binary
Profile ownership remains unchanged. Numeric ownership requires a real User reference and an unambiguous mapping to
one Profile. A verified User with no Profile may receive one only when the existing identifier storage supports the
migration's UUID creation; binary Profile storage requires an existing mapping. Backfills retain saved tracking
timestamps. The migration refuses missing Users or Guests, ambiguous mappings, conflicting temporary values and orphan
references before mutation. It also refuses triggers that could fire during its INSERT or UPDATE work and unsupported
text or timestamp conversions.

Item-owner reversal refuses populated owner columns or dependencies that cannot be retired safely. Profile reversal
refuses populated affected tables. Do not clear values, delete rows or remove constraints to bypass these guards.
MariaDB can retain earlier DDL after a failed attempt; inspect that state and retry only when the complete preflight
admits it. Keep the service stopped when migration cannot complete, retain the failure evidence, and use the existing
[paired full rollback](UPGRADING.md#full-rollback-procedure) when safe continuation or reversal cannot be established.

## Free-text storage

Descriptions on activities, roles, packing items, driver entries, and survey combinations use `TEXT`, matching
the existing entity descriptions and activity text fields. Validation limits belong to each operation: metadata
description editors and activity text fields allow 16,000 characters, while Packing creation, Quick Add and general
item updates retain separate existing bounds. Inspect the actual controls and authored API operation rather than
infer a universal character limit from the database's byte-limited `TEXT` type.
Allergy details and dietary comments use nullable `VARCHAR(4000)` columns and accept
4,000 characters. Invoice notes and review explanations retain their existing 4,000-character validation.
Titles, names, locations, identifiers, and file metadata retain their existing column sizes.
The HTTP JSON and URL-encoded form parsers accept requests up to 1 MB so Unicode encoding and collections
of longer items can reach field validation.

Existing installations need `1789776000000-IncreaseFreeTextLimits.ts` through the normal upgrade procedure.
The migration preserves existing text and null values. Reversion checks all affected columns first and refuses
to narrow them if any value exceeds the previous 255-character limit.

## Entity archival state

Migration `1789862400000-AddEntityArchival.ts` introduces the matching entity schema:

| Storage | Purpose |
|---|---|
| Nullable `archived_at` on `events`, `activity_plans`, `packing_lists`, `drivers_lists`, and `surveys` | Direct authoritative archival, inherited from `BaseEntity`. |
| `auto_archive_paused`, initially false, on `events` and `activity_plans` | Persistent manual pause for dated roots; linked plans still inherit their event's state. |
| `entity_visibility_preferences` | One `HIDDEN` or `SHOWN` override per `(profile_id, entity_type, entity_id)`; absence means default. |
| Dated-root eligibility indexes and preference target/profile indexes | Automatic candidate selection, preference lookup, and uniqueness. |

Existing rows begin directly active and unpaused, with no preference rows. The migration does not backfill archival
from dates; the application job owns eligibility. Its conditional additions also support the documented fresh-schema
synchronization followed by migration-history bootstrap. The preference profile FK copies the actual `profiles.id`
type/collation and cascades on profile deletion; polymorphic target validity is enforced by the services.

Inherited archival is computed from the current event relation, never copied to children. Metadata projections use a
consistent `REPEATABLE READ` snapshot. Manual lifecycle changes and personal visibility writes lock the parent event
before a linked root. Preference writes recheck overview membership while holding those locks. Permanent deletion
uses the existing feature service's direct repository delete and database cascades. Its ordinary database write locks
serialize with the preference transaction; deletion does not call the archival service.

The polymorphic target reference has no cascading FK. A preference may remain stored after its entity is deleted,
but it cannot create an overview entry or authorize access: discovery starts from existing entities, and new preference
writes require an existing target and current membership. Normal creation and duplication allocate fresh UUIDs.
Deleting the profile still removes its preferences through the real profile FK.

Automatic updates repeat the current date, direct-state, pause, and standalone predicates after selecting candidates.
Restore clears direct archival and pauses an independent automatic schedule atomically. Linked activities acquire no
independent pause. Neither operation saves a stale full entity,
changes business records, or deletes files.

The down migration preflights all affected tables before DDL and refuses to discard any archived root, non-default
pause, or personal preference. Use explicit restore/resume/default-visibility operations when an intentional empty-state
reversal is appropriate, or the [reviewed full rollback](UPGRADING.md#full-rollback-procedure). Do not delete user state
to bypass the guard. A retained personal preference after membership loss cannot be reset through the overview until
that membership is restored. Preferences for deleted entities are also retained; use the reviewed full rollback when
an explicit empty-state reversal is unavailable or inappropriate. Migration SQL must
be rehearsed separately from tests that only synchronize entity metadata.

## Activity recommendation pairing

Apply `1793232000000-AddActivityRecommendationPairing.ts` through the normal settings-aware upgrade workflow before
starting the matching application release. It adds `pairing_known`, initially false, and nullable `swap_group` to
`activity_assignment_recommendations`. The migration preserves every recommendation and assignment. Existing moves
remain unresolved, even when their source and destination slots are reciprocal; an organizer must explicitly choose
a swap partner or an independent move before applying an unresolved reassignment.

Newly reviewed independent moves have known intent with no group; an explicit swap has one shared group for its two
legs. The down migration checks every present pairing column before dropping either column and refuses reversal if
any known intent or non-null group exists, including a partially applied schema. Do not clear these values or delete
recommendations to bypass the guard. Use the [paired full rollback](UPGRADING.md#full-rollback-procedure) to restore the
pre-upgrade database and persistent files with their matching previous release.

## Sessions are database data

Surveyor stores sessions in MariaDB through `connect-typeorm`. Session cookies and stored sessions have a one-day
lifetime. This has several operational consequences:

- Database loss signs everyone out and can interrupt active forms.
- A database backup contains session rows as well as business data.
- Restoring session rows while keeping the same `SESSION_SECRET` can make restored sessions valid again until they
  expire; rotate the secret when that is not acceptable.
- The session table must be included in schema migration, monitoring, and storage-capacity planning.

## Frontend contracts and persistence

Generated API contracts, validators and language catalogs are application build inputs. They do not replace entity
definitions, reviewed database migrations or the settings-aware database commands above.

Packing edit comparisons use the current relevant values inside existing locked transactions, without an edit-history
table or Packing revision column. A value changed away and back can match an earlier comparison. Financial calculation
revisions and saved settlement history retain their own persistence contracts.

Controllers own authorization and business decisions against the locked evidence supplied by database services.
The services own queries, locks, transactions and persistence. Diagnose conflicting writes through the actual application
operations and database logs; do not bypass the checks or change transaction isolation as an operational workaround.

## Invoice proof ownership

Apply `1793059200000-AddInvoiceProofFiles.ts` through the settings-aware migration workflow before starting the matching
release. It creates `invoice_proof_files` and backfills every exact nonempty stored proof-path spelling, including
case-distinct legacy references. The ledger deliberately has no cascading invoice foreign key: cleanup evidence must
survive Event, registration and invoice deletion. The migration does no filesystem work and preserves financial rows.

New uploads acquire durable ownership before storage opens their file, then attach within the invoice transaction.
Active request/process ownership protects slow uploads. After a crash, the next single-process startup can recover
abandoned work. Cleanup verifies live references and durable state before claiming deletion; a failed unlink remains
retryable. An unavailable configured proof root defers cleanup and retains ownership evidence. File deletion follows committed
record removal, so a database rollback retains a valid invoice's proof.

The down migration refuses to discard a nonempty ledger. Do not delete ownership/recovery rows merely to bypass it.
Use the paired database, files, configuration and release rollback procedure. Backups must include ledger rows and the
entire proof tree, including `.proof-quarantine`, until recovery and final purge are complete. This does not make
database and filesystem operations one atomic transaction.

Historical files with no surviving reference use the explicit [offline reconciliation workflow](OPERATIONS.md#invoice-proof-reconciliation).
Ordinary startup never scans and blindly purges untracked directory contents.

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

The separate archival startup sweep can move eligible historical entities into overview archives after a database
restore. Existing saved pauses and personal preferences are part of the database backup. Review the
[archival configuration](CONFIGURATION.md#automatic-entity-archival) before the restored application starts.

## Database troubleshooting

### Startup exits before listening

The server initializes the settings store, database datasource, invoice-retention cleanup, and entity archival before opening its HTTP
port. Check the service log for connection, authentication, schema, retention, or archival errors. Confirm the selected settings
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
