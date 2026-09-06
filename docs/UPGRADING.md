# Upgrading and Rolling Back Surveyor

<!--
documentation-metadata
audience: operators; site reliability engineers; database administrators; maintainers
owner: application operators
status: current
last-verified: 2026-09-05
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: D04 accepted from source review and deployment-practice confirmation for release packaging, versioned deployment, dependency installation, migration ordering, persistent-state backup, validation, and rollback; controlled execution tracked separately in D04V
source-anchors: .github/workflows/release.yml; package.json; scripts/runMigration.ts; migrationDataSource.ts; src/server.ts; src/modules/settings.ts; src/modules/invoiceRetention.ts; docs/DATABASE.md; docs/OPERATIONS.md
next-review: D04V
-->

Use this procedure for every production version change. It assumes the versioned layout and service controls in the
[production operations runbook](OPERATIONS.md).

Surveyor does not run database migrations at startup and does not define a zero-downtime rolling-upgrade protocol.
Perform upgrades in a maintenance window with one application process stopped while the database and persistent files
are captured and the schema is changed.

## Release units

A deployable version consists of three matching parts:

1. The release archive containing compiled `dist/`, `docs/`, `fonts/`, and production dependency manifests.
2. A source checkout of the same `vX.Y.Z` tag for TypeORM migration commands.
3. The database schema and persistent upload data after that release's migration procedure has completed.

Do not mix the runtime bundle, migration workspace, or in-app guides from different versions. Keep the previous release
and its pre-upgrade backup until the new version has passed validation and the rollback window has closed.

## Before scheduling the change

Review the release notes and repository diff for:

- New or changed migrations under `src/migrations/`.
- New configuration keys or changed defaults in `src/modules/settings.ts`.
- Changed persistent paths, upload behavior, retention, SMTP, or OIDC requirements.
- The Node.js and MariaDB compatibility baseline.
- Changes that make data written by the new release incompatible with the old release.

Confirm that the most recent backup restore rehearsal is successful. Estimate database dump, file archive, migration,
and validation time using production-sized copies—not an empty development database.

Prepare an explicit rollback decision point, responsible operator, and maintenance communication before touching the
production schema.

## Stage the new version while the old version runs

### 1. Verify and extract the release

```bash
sha256sum surveyor-vX.Y.Z.tar.gz
# Compare the printed value with the approved release-asset digest before continuing.
install -d -o surveyor -g surveyor -m 0755 /opt/surveyor/releases/vX.Y.Z
sudo -u surveyor tar -xzf surveyor-vX.Y.Z.tar.gz -C /opt/surveyor/releases/vX.Y.Z
cd /opt/surveyor/releases/vX.Y.Z
sudo -u surveyor npm ci --omit=dev
chown -R root:root /opt/surveyor/releases/vX.Y.Z
ln -s /var/lib/surveyor/uploads uploads
```

Confirm the archive includes `dist/`, `docs/user-guide/`, `fonts/`, `package.json`, and `package-lock.json`. Do not replace
`/opt/surveyor/current` yet.

The release workflow does not create a sidecar checksum file. Obtain the expected digest from the approved release
record or artifact-verification system, compare it independently, and record the verified value in the change record.

### 2. Prepare the matching migration workspace

```bash
git fetch --tags
git worktree add /opt/surveyor/migrations/vX.Y.Z vX.Y.Z
cd /opt/surveyor/migrations/vX.Y.Z
npm ci
npm run generate
```

Verify that both the runtime package and source checkout report the intended version:

```bash
node -p "require('/opt/surveyor/releases/vX.Y.Z/package.json').version"
node -p "require('/opt/surveyor/migrations/vX.Y.Z/package.json').version"
```

The values must match the release tag.

### 3. Review configuration without changing it

Compare the new [configuration reference](CONFIGURATION.md) with the protected production settings. Add required values
before the window, but do not rotate unrelated secrets during the same change unless planned.

Keep these service variables available for migration commands:

```bash
export SETTINGS_FILE=/etc/surveyor/settings.csv
export NODE_ENV=production
export TZ=UTC
```

From the new migration workspace, prove the target and inspect pending migrations:

```bash
npm run typeorm -- migration:show migrationDataSource.ts
```

Stop if the host, database, migration list, or release version is not the expected one.

## Maintenance-window procedure

### 1. Stop application writes

```bash
systemctl stop surveyor
systemctl is-active surveyor
```

Proceed only when the service is inactive and the reverse proxy is serving the maintenance response or otherwise
preventing user traffic.

### 2. Take a complete pre-upgrade backup

Follow the [backup procedure](OPERATIONS.md#backup-procedure) after the service is stopped. The set must contain:

- A MariaDB dump including schema objects and migration history.
- Both persistent upload directories.
- The protected settings file.
- The exact previous release path and version.
- Checksums and a change manifest.

Verify the checksums before applying a migration. This backup is the primary rollback boundary.

### 3. Apply database migrations once

From the new version's source migration workspace:

```bash
cd /opt/surveyor/migrations/vX.Y.Z
export SETTINGS_FILE=/etc/surveyor/settings.csv
export NODE_ENV=production
export TZ=UTC
npm run generate
npm run typeorm -- migration:show migrationDataSource.ts
npm run typeorm:migrate
npm run typeorm -- migration:show migrationDataSource.ts
```

Retain the complete command output. Do not use `schema:sync`, `schema:drop`, `typeorm:reset-db`, or direct TypeORM CLI
commands on an existing production database.

If migration execution fails, do not start either application version until the schema state is understood. Follow
[Migration failure](#migration-failure) below.

### 4. Activate the new release

```bash
ln -sfn /opt/surveyor/releases/vX.Y.Z /opt/surveyor/current
readlink -f /opt/surveyor/current
```

Confirm that `uploads` in the new release points to `/var/lib/surveyor/uploads` and that the service account can read the
release and write both persistent upload directories.

### 5. Start and validate

```bash
systemctl start surveyor
systemctl status surveyor
journalctl -u surveyor --since '5 minutes ago'
curl --fail --silent --show-error https://surveyor.example.org/healthz
```

Startup performs the database connection and invoice-retention cleanup before opening the HTTP listener. Review the
retention output before continuing; old invoice records and proofs that meet the configured cutoff may be removed at
this point.

Run the complete [post-start validation checklist](OPERATIONS.md#post-start-validation), including:

- Public page and in-app help from the new release.
- Every enabled sign-in method and sign-out.
- Controlled guest access/recovery.
- Header image and invoice-proof persistence.
- Transactional email delivery.
- Version display, legal links, database monitoring, disk capacity, and backup monitoring.

Only then remove the maintenance response and reopen normal traffic.

### 6. Observe the new release

During the rollback window, monitor:

- Process exits and restarts.
- HTTP error rates and latency.
- MariaDB errors, locks, connections, and storage growth.
- SMTP and OIDC failures.
- Upload/read errors and filesystem capacity.
- Invoice-retention actions.

Keep the previous runtime directory, migration workspace, and pre-upgrade backup until the change is formally accepted.

## Rollback decision

Roll back when the release cannot pass validation within the maintenance window, causes data-integrity or authorization
risk, or shows a failure that cannot be corrected safely without additional unreviewed production changes.

Do not assume that switching the release symlink alone is safe after migrations or new-version writes. The previous
application may not understand the new schema or data.

## Full rollback procedure

The supported conservative rollback restores the complete pre-upgrade state.

1. Re-enable the maintenance response and stop Surveyor:

   ```bash
   systemctl stop surveyor
   ```

2. Preserve diagnostic logs and the failed database/file state separately if incident analysis requires it.
3. Verify the checksums of the pre-upgrade backup set.
4. Restore the pre-upgrade MariaDB dump into the production database according to
   [Restore procedure](OPERATIONS.md#restore-procedure).
5. Restore the paired pre-upgrade `uploads` archive and configuration.
6. Point `current` back to the recorded previous release:

   ```bash
   ln -sfn /opt/surveyor/releases/vPREVIOUS /opt/surveyor/current
   ```

7. Confirm the previous release's `uploads` symlink and dependency installation.
8. Start the service and run the full post-start validation checklist against the restored state.
9. Reopen traffic only after the old version, database, files, authentication, and email behavior all pass.
10. Record the rollback, evidence, user impact, and disposition of the failed release.

When the new release was staged but no migration ran and no new-version process accepted writes, switching the symlink
back may be sufficient. The operator must prove those conditions; otherwise use the full restore.

## Migration failure

If `npm run typeorm:migrate` exits unsuccessfully:

1. Keep Surveyor stopped.
2. Save command output, MariaDB logs, migration status, and the exact release/source revisions.
3. Do not run the migration repeatedly without understanding whether it partially applied.
4. Do not use schema synchronization or ad-hoc SQL to force the application to start.
5. Determine, from the migration and database transaction state, whether the failed operation rolled back completely.
6. Either apply a reviewed correction through the same controlled migration path or restore the complete pre-upgrade
   backup set.

Starting the old release against an uncertain or partially upgraded schema is not a recovery procedure.

## Configuration-only changes

For a configuration change with no release or schema change:

1. Back up the current settings file.
2. Edit the protected file atomically.
3. Validate values using [Configuration Reference](CONFIGURATION.md).
4. Restart Surveyor.
5. Run the relevant health, authentication, email, upload, and legal-link checks.
6. Roll back by restoring the previous settings file and restarting if validation fails.

Changing `SESSION_SECRET` is an intentional sign-out event. Database, SMTP, OIDC, retention, upload-path, and public URL
changes require their corresponding focused validation and should not be bundled casually.

## Upgrade record template

Keep this information with every production change:

```text
Change ID:
Operator:
Maintenance start/end:
Previous Surveyor version:
New Surveyor version:
Release archive SHA-256:
Runtime Node.js version:
MariaDB version:
SETTINGS_FILE path:
Database host/name/user (password omitted):
Pending migrations before:
Pending migrations after:
Backup set and SHA-256 manifest:
Previous release path:
New release path:
Persistent upload root:
Health result:
Local login result:
OIDC result:
Guest recovery result:
Header image result:
Invoice proof result:
Email result:
Retention observations:
Rollback deadline:
Outcome:
```

## Cleanup after acceptance

After the rollback window and backup policy permit cleanup:

- Remove obsolete release and migration-workspace directories, retaining at least the approved rollback version.
- Keep `docs/` paired with each retained runtime release.
- Never delete `/var/lib/surveyor/uploads` as part of release cleanup.
- Retain or dispose of pre-upgrade backups according to the approved backup and privacy schedules.
- Remove temporary smoke-test data and revoke any temporary test credentials.
