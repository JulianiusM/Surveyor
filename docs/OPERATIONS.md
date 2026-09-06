# Production Operations Runbook

<!--
documentation-metadata
audience: operators; site reliability engineers; incident responders; maintainers
owner: application operators
status: current
last-verified: 2026-09-05
verification-baseline: docs-baseline-2026-09-05-d00
verification-scope: D04 accepted from source review and deployment-practice confirmation for release contents, bootstrap, sessions, proxy behavior, health, logs, persistent files, SMTP/OIDC, retention, backup, restore, and service management; D06 invoice-proof privacy, storage, and retention linkage verified; controlled execution tracked separately in D04V
source-anchors: .github/workflows/release.yml; package.json; docs/user-guide/INVOICE_POOLS.md; src/server.ts; src/app.ts; src/modules/settings.ts; src/modules/database/dataSource.ts; src/modules/invoiceRetention.ts; src/modules/database/services/EventInvoiceService.ts; src/modules/lib/fileCommons.ts; src/modules/lib/pdf.ts; src/controller/helpController.ts; src/controller/eventPoolController.ts; src/modules/email.ts; src/modules/oidc.ts
next-review: D04V
-->

This runbook covers one production Surveyor instance deployed from the release archive. Read the
[configuration reference](CONFIGURATION.md) and [database guide](DATABASE.md) before the first installation. Use the
separate [upgrade procedure](UPGRADING.md) for an existing instance.

## Operational model

A Surveyor release archive contains the compiled application in `dist/`, its matching `docs/` and `fonts/`, and the
production dependency manifests. It does not replace the need for:

- A protected external settings file.
- A prepared MariaDB schema.
- Persistent upload storage.
- A reverse proxy that terminates HTTPS.
- A matching source checkout for TypeORM schema commands.
- Normal host, database, SMTP, identity-provider, and backup monitoring.

Run the Node process with the release root as its working directory. PDF fonts, the packaged in-app help, and relative
upload paths depend on the release layout and working directory.

The runbook assumes one application process for one local upload root. Database-backed sessions allow process restarts,
but local uploaded files and the hourly invoice-retention job mean that horizontal scaling requires a deliberately
shared filesystem and coordinated job ownership. Do not add replicas without designing and testing those two concerns.

## Recommended filesystem layout

Use immutable versioned release directories and keep state outside them:

```text
/opt/surveyor/releases/vX.Y.Z/       extracted release
/opt/surveyor/current                symlink to active release
/opt/surveyor/migrations/vX.Y.Z/     matching source migration workspace
/etc/surveyor/settings.csv           protected configuration
/etc/surveyor/db-client.cnf          backup-client credentials
/var/lib/surveyor/uploads/           persistent uploaded files
/var/backups/surveyor/               protected backup sets
```

Inside each release directory, create `uploads` as a symlink to the persistent root:

```bash
ln -s /var/lib/surveyor/uploads /opt/surveyor/releases/vX.Y.Z/uploads
```

Keep the configured paths relative and below this symlink:

```csv
INVOICE_DIR,uploads/invoices/
HEADER_IMG_DIR,uploads/headerImgs/
```

Do not point `docs/user-guide/` at a writable data volume. In-app help is reviewed application content and must remain
the copy packaged with the matching release.

## First installation from a release archive

The release and CI baseline is Node.js 24.15.0. Use a dedicated unprivileged account, illustrated below as `surveyor`.
Adapt account and package-management commands to the operating system without changing the directory and permission
principles.

### 1. Create service directories

```bash
install -d -o root -g root -m 0755 /opt/surveyor/releases
install -d -o surveyor -g surveyor -m 0750 /opt/surveyor/migrations
install -d -o surveyor -g surveyor -m 0750 /var/lib/surveyor/uploads/invoices
install -d -o surveyor -g surveyor -m 0750 /var/lib/surveyor/uploads/headerImgs
install -d -o root -g surveyor -m 0750 /etc/surveyor
install -d -o root -g surveyor -m 0750 /var/backups/surveyor
```

### 2. Extract and verify the release

Verify the archive checksum against the release record before extraction. Then stage it without replacing the active
symlink:

```bash
install -d -o surveyor -g surveyor -m 0755 /opt/surveyor/releases/vX.Y.Z
sudo -u surveyor tar -xzf surveyor-vX.Y.Z.tar.gz -C /opt/surveyor/releases/vX.Y.Z
cd /opt/surveyor/releases/vX.Y.Z
```

A valid release root contains at least:

```text
dist/
docs/
fonts/
package.json
package-lock.json
.npmrc
```

The `docs/user-guide/` directory must be present because the application serves it as in-app help.

### 3. Install runtime dependencies

From the staged release root:

```bash
sudo -u surveyor npm ci --omit=dev
chown -R root:root /opt/surveyor/releases/vX.Y.Z
```

After dependency installation, the versioned runtime tree is made read-only to the service account. Do not run a build in the release directory. The archive already contains the compiled output, and its package manifest
is stripped of development dependencies.

### 4. Attach persistent files

```bash
ln -s /var/lib/surveyor/uploads /opt/surveyor/releases/vX.Y.Z/uploads
```

Confirm the service account can create and remove a temporary file in both persistent child directories, then remove the
test file.

### 5. Create the protected configuration

Create `/etc/surveyor/settings.csv` from the production example in [Configuration Reference](CONFIGURATION.md). Use mode
`0600`, owned by the service account, and replace every placeholder.

At minimum, review:

- Public URL and listening port.
- Stable session secret.
- Database target and password.
- Local/OIDC sign-in mode.
- SMTP relay and sender.
- Relative persistent paths and invoice retention.
- Imprint and privacy-policy URLs.

### 6. Initialize the database

Prepare the matching tagged source checkout and initialize the empty database using
[Database and Migrations](DATABASE.md#initialize-a-new-empty-database). Do not start the application before that step
succeeds.

### 7. Activate the release

```bash
ln -sfn /opt/surveyor/releases/vX.Y.Z /opt/surveyor/current
```

Install the service and reverse-proxy configuration below, start the service, and complete
[post-start validation](#post-start-validation) before opening user traffic.

## Service management with systemd

A representative unit is:

```ini
[Unit]
Description=Surveyor collaboration service
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
Type=simple
User=surveyor
Group=surveyor
WorkingDirectory=/opt/surveyor/current
Environment=NODE_ENV=production
Environment=TZ=UTC
Environment=SETTINGS_FILE=/etc/surveyor/settings.csv
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5s
TimeoutStopSec=30s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/surveyor

[Install]
WantedBy=multi-user.target
```

The exact Node path and database unit name vary by host. The unit must retain:

- `WorkingDirectory=/opt/surveyor/current`.
- `NODE_ENV=production`, so cookies are HTTPS-only.
- The explicit settings-file path.
- Write access only to persistent application state.

After writing or changing the unit:

```bash
systemctl daemon-reload
systemctl enable --now surveyor
systemctl status surveyor
```

Normal controls:

```bash
systemctl start surveyor
systemctl stop surveyor
systemctl restart surveyor
journalctl -u surveyor --since today
```

Startup order is settings, database connection, initial invoice-retention cleanup, application loading, and finally the
HTTP listener. A failure in any pre-listen step exits the process with a non-zero status.

## Reverse proxy and TLS

Surveyor creates an HTTP listener on `APP_PORT`; terminate TLS at a trusted reverse proxy. The application trusts exactly
one proxy hop and uses forwarded host and scheme information during OIDC callback validation. Restrict direct access to
`APP_PORT` so clients cannot bypass or forge that trusted hop.

Representative NGINX configuration:

```nginx
server {
    listen 80;
    server_name surveyor.example.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name surveyor.example.org;

    ssl_certificate     /etc/letsencrypt/live/surveyor.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/surveyor.example.org/privkey.pem;

    client_max_body_size 11m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Use the real certificate locations and public host. Set `ROOT_URL` to the same public HTTPS origin, with no trailing
slash. Register this exact OIDC callback when OIDC is enabled:

```text
https://surveyor.example.org/users/oidc/callback
```

The application accepts uploads up to 10 MiB, so the proxy request-size limit must be at least that large. Preserve POST
request bodies and do not cache authenticated HTML, API responses, header images, or invoice proofs.

## Health, monitoring, and logs

### Health endpoint

```bash
curl --fail --silent --show-error https://surveyor.example.org/healthz
```

A healthy response is HTTP 200 with body:

```text
ok
```

The listener opens only after the initial database connection and retention cleanup succeed, so a newly started healthy
process has completed those startup stages. The endpoint is nevertheless a basic HTTP health check; it does not send a
test email or continuously query MariaDB. Monitor dependencies separately and alert on application error logs as well as
health failures.

Suggested probes:

- Every minute: HTTPS `/healthz`, expected status 200 and body `ok`.
- Every few minutes: public home page status and certificate validity.
- Continuously: process restart count, CPU, memory, filesystem capacity, MariaDB availability and connections.
- Daily: recent successful backup, SMTP queue/errors, identity-provider errors, and invoice-retention messages.

### Logging

Surveyor writes startup, request, retention, email, and error output to standard output/error. Under systemd, collect it
from the journal or forward it to the normal centralized logging system.

The request logger includes request paths. Account activation, password reset, invitations, and personal access can use
tokens in paths. Restrict log access, redact tokens before exporting logs, and apply an approved retention period. Do
not paste unredacted request URLs into tickets or public channels.

Useful commands:

```bash
journalctl -u surveyor -f
journalctl -u surveyor -p warning --since '1 hour ago'
journalctl -u surveyor --since '2026-09-05 12:00:00' --until '2026-09-05 13:00:00'
```

## Persistent files

Surveyor stores two classes of user-uploaded files outside the database:

| Data | Default relative path | Accepted content | Limit | Required treatment |
|---|---|---|---:|---|
| Entity header images | `uploads/headerImgs/` | JPEG, PNG, GIF | 10 MiB per file | Persistent; back up with the database. |
| Invoice proof files | `uploads/invoices/` | JPEG, PNG, GIF, PDF | 10 MiB per file | Sensitive persistent data; back up with the database and apply retention policy. |

The database stores paths that refer to these files. Restoring only the database produces missing images and proofs;
restoring only files leaves orphaned content. Always treat the database dump and both directories as one backup set.

The application creates missing upload directories lazily, but production operators should create them with restrictive
permissions before startup. Keep them below relative `uploads/` in the working directory. Do not place them inside
`dist/`, `docs/`, or another release-owned directory.

### Invoice retention

On every startup, before the HTTP listener opens, Surveyor permanently removes invoice records and proof files whose
event end date is on or before the configured month-based cutoff. It repeats the cleanup hourly. After deletion, affected
invoice-pool totals are recalculated.

Set `INVOICE_RETENTION_MONTHS` to the approved non-negative integer and account for this behavior during restores. A value
of `0` makes events ending on or before the current date immediately eligible. Protect and monitor the invoice directory;
failed file deletion is best-effort, while the associated database record is still subject to retention processing.

Backup copies of invoice proofs are separate retained copies. Apply the same privacy and deletion policy to backup
retention and disposal.

For the participant- and organizer-visible invoice lifecycle, proof-access boundary, and settlement workflow, see
[Invoice Pools and Payments](user-guide/INVOICE_POOLS.md#privacy-proof-access-storage-and-retention).

## Mail and sign-in smoke tests

SMTP is not verified during startup. Test it after first deployment, credential rotation, restore, or upgrade by using a
controlled account and checking both application logs and actual delivery. Exercise at least:

- Local registration and **Activate account**, when local login is enabled.
- **Reset password**, when local login is enabled.
- Guest recovery for a controlled guest email address.
- One event or invoice notification used by the deployment.

Confirm sender alignment, links using the public `ROOT_URL`, and the imprint/privacy footer.

For each enabled sign-in mode:

- Local: register or use a controlled activated account, sign in, sign out, and sign in again.
- OIDC: start organization sign-in, complete the callback at `/users/oidc/callback`, open **Your overview**, sign out, and
  confirm the provider return path.
- Mixed: confirm both choices remain visible and usable.

Never perform production smoke tests with real participant addresses unless the notification is expected and approved.

## Post-start validation

Complete all checks before ending a maintenance window:

1. `systemctl status surveyor` shows one stable running process without a restart loop.
2. Logs show database initialization, no startup failure, and no unexpected retention error.
3. HTTPS `/healthz` returns `200` and `ok`.
4. The public home page loads over HTTPS with the expected service name and legal links.
5. The in-app help opens and corresponds to the deployed release.
6. Every enabled full-account sign-in path succeeds.
7. A controlled guest invitation/recovery path succeeds.
8. A controlled header image can be uploaded and read again.
9. A controlled invoice proof can be uploaded and read by an authorized profile.
10. A test service email is delivered with working public links.
11. The active release version shown by the application matches the change record.
12. Database, upload filesystem, certificate, and backup monitors are green.

Remove disposable test data according to normal application and retention procedures.

## Backup procedure

Take a consistent backup before every upgrade and on the normal schedule. Stopping the service is the supported way to
keep database records and uploaded files synchronized during the snapshot.

### 1. Prepare credentials and destination

Create a MariaDB client file readable only by root or the backup account:

```ini
[client]
host=127.0.0.1
port=3306
user=surveyor-backup
password=replace-with-backup-password
```

```bash
chmod 0600 /etc/surveyor/db-client.cnf
install -d -o root -g surveyor -m 0750 /var/backups/surveyor/2026-09-05T120000Z
```

### 2. Stop writes

```bash
systemctl stop surveyor
```

Confirm the process has exited before copying data.

### 3. Dump MariaDB

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
  surveyor > /var/backups/surveyor/2026-09-05T120000Z/surveyor.sql
```

### 4. Archive persistent files and configuration

```bash
tar -C /var/lib/surveyor -czf /var/backups/surveyor/2026-09-05T120000Z/uploads.tar.gz uploads
install -m 0600 /etc/surveyor/settings.csv /var/backups/surveyor/2026-09-05T120000Z/settings.csv
readlink -f /opt/surveyor/current > /var/backups/surveyor/2026-09-05T120000Z/release-path.txt
```

Encrypt the backup according to organizational policy. The settings copy contains secrets.

### 5. Create and verify a manifest

```bash
cd /var/backups/surveyor/2026-09-05T120000Z
sha256sum surveyor.sql uploads.tar.gz settings.csv release-path.txt > SHA256SUMS
sha256sum --check SHA256SUMS
```

Record the Surveyor version, MariaDB version, host, timestamp, retention setting, and operator in the backup/change
record.

### 6. Resume and validate

```bash
systemctl start surveyor
curl --fail --silent --show-error https://surveyor.example.org/healthz
```

Review startup and retention logs before declaring the backup window complete.

## Restore procedure

Rehearse this procedure regularly in an isolated environment. Never use the production public hostname, OIDC callback,
or live outbound SMTP while validating a backup.

1. Select one complete backup set and verify `SHA256SUMS`.
2. Provision an empty MariaDB database and persistent upload root.
3. Install the exact Surveyor release recorded in `release-path.txt` or the backup manifest.
4. Stop the isolated Surveyor service.
5. Import the database:

   ```bash
   mariadb --defaults-extra-file=/etc/surveyor/db-client.cnf surveyor < surveyor.sql
   ```

6. Restore the upload archive with ownership preserved for the service account:

   ```bash
   tar -xzf uploads.tar.gz -C /var/lib/surveyor
   chown -R surveyor:surveyor /var/lib/surveyor/uploads
   ```

7. Restore or reconstruct a protected settings file for the isolated host. Use a non-production `ROOT_URL`, controlled
   SMTP sink, and identity-provider client registered for that environment.
8. Decide whether restored sessions may remain valid. To force sign-out, set a new `SESSION_SECRET` before startup.
9. Start the service. Remember that invoice retention runs before the listener opens and may remove data that has passed
   the configured retention cutoff.
10. Perform every restore-validation check in the [database guide](DATABASE.md#restore-validation), including one stored
    header image and one authorized invoice proof.
11. Destroy or securely retain the rehearsal environment according to the data-handling policy.

For production disaster recovery, keep the service inaccessible until the complete database-and-files set and matching
release pass validation.

## Common incidents

### Service repeatedly exits

Inspect the earliest error in the journal. Verify configuration-file readability, database connectivity and schema,
`INVOICE_RETENTION_MONTHS`, release working directory, and Node version. Startup never reaches the listener when database
initialization or initial retention cleanup fails.

### Reverse proxy returns 502

Confirm the service is running and listening on `APP_PORT`, then query `http://127.0.0.1:APP_PORT/healthz` from the host.
Check local firewall policy, proxy upstream port, and restart loops.

### Sign-in redirects loop or secure cookies are missing

Confirm `NODE_ENV=production`, public HTTPS `ROOT_URL`, exactly one trusted proxy hop, and forwarded host/scheme headers.
For OIDC, verify the provider's exact callback URL and issuer/client settings.

### Email-dependent actions appear to succeed but no mail arrives

Review `Error sending email` log entries, SMTP authentication, TLS mode/port, relay policy, sender verification, and spam
or bounce logs. SMTP failure is logged and does not make `/healthz` fail.

### Header images or invoice proofs are missing

Verify the `uploads` symlink, service-account permissions, mounted persistent volume, and matching database/file backup
set. Do not create replacement database paths manually. Invoice proofs may also have been removed by the configured
retention policy.

### Health is green but user actions fail

Treat `/healthz` as basic HTTP liveness. Check MariaDB, disk capacity, application errors, SMTP, OIDC, and the reverse
proxy independently.

## Decommissioning

Before retiring an instance:

1. Disable new traffic and stop the service.
2. Take and verify the final backup if retention policy requires one.
3. Revoke OIDC, SMTP, and database credentials.
4. Remove DNS, proxy, and certificate configuration.
5. Apply approved retention and secure-erasure procedures to the database, invoice proofs, header images, settings,
   logs, and backups.
6. Record the final disposition and deletion dates.
